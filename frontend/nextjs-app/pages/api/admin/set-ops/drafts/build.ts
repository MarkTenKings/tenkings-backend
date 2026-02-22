import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus, SetIngestionJobStatus, type Prisma } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";
import { createDraftVersionPayload, normalizeDraftRows } from "../../../../../lib/server/setOpsDrafts";

const buildSchema = z.object({
  ingestionJobId: z.string().min(1),
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

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.draft.build",
        status: SetAuditStatus.DENIED,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const payload = buildSchema.parse(req.body ?? {});

    const job = await prisma.setIngestionJob.findUnique({
      where: { id: payload.ingestionJobId },
      select: {
        id: true,
        setId: true,
        draftId: true,
        datasetType: true,
        rawPayload: true,
        sourceUrl: true,
      },
    });

    if (!job) {
      return res.status(404).json({ message: "Ingestion job not found" });
    }

    const setId = normalizeSetLabel(job.setId);

    const draft = job.draftId
      ? await prisma.setDraft.findUnique({ where: { id: job.draftId }, select: { id: true } })
      : await prisma.setDraft.findUnique({ where: { setId }, select: { id: true } });

    const draftId = draft?.id
      ? draft.id
      : (
          await prisma.setDraft.create({
            data: {
              setId,
              normalizedLabel: setId,
              status: "DRAFT",
              createdById: admin.user.id,
            },
            select: { id: true },
          })
        ).id;

    const normalized = normalizeDraftRows({
      datasetType: job.datasetType,
      fallbackSetId: setId,
      rawPayload: job.rawPayload,
    });

    const versionPayload = createDraftVersionPayload({
      setId,
      datasetType: job.datasetType,
      rows: normalized.rows,
    });

    const latestVersion = await prisma.setDraftVersion.findFirst({
      where: { draftId },
      orderBy: [{ version: "desc" }],
      select: { version: true },
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const version = await prisma.setDraftVersion.create({
      data: {
        draftId,
        version: nextVersion,
        versionHash: versionPayload.versionHash,
        dataJson: versionPayload.dataJson as Prisma.InputJsonValue,
        validationJson: versionPayload.validationJson as Prisma.InputJsonValue,
        sourceLinksJson: {
          sourceUrl: job.sourceUrl ?? null,
          ingestionJobId: job.id,
        } as Prisma.InputJsonValue,
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

    await prisma.setDraft.update({
      where: { id: draftId },
      data: {
        normalizedLabel: setId,
        status: "REVIEW_REQUIRED",
      },
    });

    await prisma.setIngestionJob.update({
      where: { id: job.id },
      data: {
        draftId,
        status: SetIngestionJobStatus.REVIEW_REQUIRED,
        parsedAt: new Date(),
        reviewedAt: new Date(),
        parseSummaryJson: {
          rowCount: versionPayload.rowCount,
          errorCount: versionPayload.errorCount,
          blockingErrorCount: versionPayload.blockingErrorCount,
          draftVersionId: version.id,
        } as Prisma.InputJsonValue,
      },
    });

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.draft.build",
      status: SetAuditStatus.SUCCESS,
      setId,
      draftId,
      draftVersionId: version.id,
      ingestionJobId: job.id,
      metadata: {
        version: version.version,
        rowCount: version.rowCount,
        errorCount: version.errorCount,
        blockingErrorCount: version.blockingErrorCount,
      },
    });

    return res.status(200).json({
      draftId,
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
      action: "set_ops.draft.build",
      status: isValidation ? SetAuditStatus.DENIED : SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    if (isValidation) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
