import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";
import { createDraftVersionPayload, normalizeDraftRows } from "../../../../../lib/server/setOpsDrafts";

const saveSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType),
  rows: z.array(z.record(z.unknown())),
});

type ResponseBody =
  | {
      draftId: string;
      version: {
        id: string;
        version: number;
        versionHash: string;
        rowCount: number;
        errorCount: number;
        blockingErrorCount: number;
        createdAt: string;
      };
      summary: {
        rowCount: number;
        errorCount: number;
        blockingErrorCount: number;
      };
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.draft.version.save",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const payload = saveSchema.parse(req.body ?? {});
    const setId = normalizeSetLabel(payload.setId);
    if (!setId) {
      return res.status(400).json({ message: "setId is required" });
    }

    const draft = await prisma.setDraft.upsert({
      where: { setId },
      update: {
        normalizedLabel: setId,
        status: "REVIEW_REQUIRED",
      },
      create: {
        setId,
        normalizedLabel: setId,
        status: "REVIEW_REQUIRED",
        createdById: admin.user.id,
      },
      select: { id: true },
    });

    const normalized = normalizeDraftRows({
      datasetType: payload.datasetType,
      fallbackSetId: setId,
      rawPayload: payload.rows,
    });

    const versionPayload = createDraftVersionPayload({
      setId,
      datasetType: payload.datasetType,
      rows: normalized.rows,
    });

    const latestVersion = await prisma.setDraftVersion.findFirst({
      where: { draftId: draft.id },
      orderBy: [{ version: "desc" }],
      select: { version: true },
    });

    const version = await prisma.setDraftVersion.create({
      data: {
        draftId: draft.id,
        version: (latestVersion?.version ?? 0) + 1,
        versionHash: versionPayload.versionHash,
        dataJson: versionPayload.dataJson,
        validationJson: versionPayload.validationJson,
        rowCount: versionPayload.rowCount,
        errorCount: versionPayload.errorCount,
        blockingErrorCount: versionPayload.blockingErrorCount,
        createdById: admin.user.id,
      },
      select: {
        id: true,
        version: true,
        versionHash: true,
        rowCount: true,
        errorCount: true,
        blockingErrorCount: true,
        createdAt: true,
      },
    });

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.draft.version.save",
      status: SetAuditStatus.SUCCESS,
      setId,
      draftId: draft.id,
      draftVersionId: version.id,
      metadata: {
        datasetType: payload.datasetType,
        rowCount: version.rowCount,
        blockingErrorCount: version.blockingErrorCount,
      },
    });

    return res.status(200).json({
      draftId: draft.id,
      version: {
        id: version.id,
        version: version.version,
        versionHash: version.versionHash,
        rowCount: version.rowCount,
        errorCount: version.errorCount,
        blockingErrorCount: version.blockingErrorCount,
        createdAt: version.createdAt.toISOString(),
      },
      summary: {
        rowCount: version.rowCount,
        errorCount: version.errorCount,
        blockingErrorCount: version.blockingErrorCount,
      },
      audit: audit
        ? {
            id: audit.id,
            status: audit.status,
            action: audit.action,
            createdAt: audit.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    const isValidation = error instanceof z.ZodError;

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.draft.version.save",
      status: isValidation ? SetAuditStatus.DENIED : SetAuditStatus.FAILURE,
      setId: attemptedSetId || null,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    if (isValidation) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
