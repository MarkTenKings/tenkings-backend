import type { NextApiRequest, NextApiResponse } from "next";
import { SetAuditStatus, SetDatasetType, prisma } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";
import { extractDraftRows } from "../../../../../lib/server/setOpsDrafts";

type DraftVersionRow = {
  id: string;
  version: number;
  versionHash: string;
  rowCount: number;
  errorCount: number;
  blockingErrorCount: number;
  createdAt: string;
};

type ResponseBody =
  | {
      draft: {
        id: string;
        setId: string;
        normalizedLabel: string | null;
        status: string;
        archivedAt: string | null;
        updatedAt: string;
      };
      versions: DraftVersionRow[];
      latestVersion: {
        id: string;
        version: number;
        versionHash: string;
        rowCount: number;
        errorCount: number;
        blockingErrorCount: number;
        createdAt: string;
        datasetType: string | null;
        rows: ReturnType<typeof extractDraftRows>;
      } | null;
      latestApprovedVersionId: string | null;
    }
  | { message: string };

function datasetTypeFromJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const datasetType = String((value as Record<string, unknown>).datasetType || "").trim().toUpperCase();
  if (datasetType in SetDatasetType) {
    return datasetType;
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(typeof req.query.setId === "string" ? req.query.setId : "");

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.drafts.read",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const setId = normalizeSetLabel(typeof req.query.setId === "string" ? req.query.setId : "");
    if (!setId) {
      return res.status(400).json({ message: "setId is required" });
    }

    const requestedDatasetType = String(req.query.datasetType ?? "").trim().toUpperCase();
    const datasetTypeFilter = requestedDatasetType && requestedDatasetType in SetDatasetType ? requestedDatasetType : null;

    const draft = await prisma.setDraft.findUnique({
      where: { setId },
      select: {
        id: true,
        setId: true,
        normalizedLabel: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
      },
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft not found for set" });
    }

    const versionsRaw = await prisma.setDraftVersion.findMany({
      where: { draftId: draft.id },
      orderBy: [{ version: "desc" }],
      take: 50,
      select: {
        id: true,
        version: true,
        versionHash: true,
        rowCount: true,
        errorCount: true,
        blockingErrorCount: true,
        createdAt: true,
        dataJson: true,
      },
    });

    const versionsFiltered = versionsRaw.filter((version) => {
      if (!datasetTypeFilter) return true;
      return datasetTypeFromJson(version.dataJson) === datasetTypeFilter;
    });

    const latest = versionsFiltered[0] ?? null;

    const latestApproved = await prisma.setApproval.findFirst({
      where: {
        draftId: draft.id,
        decision: "APPROVED",
      },
      orderBy: [{ createdAt: "desc" }],
      select: { draftVersionId: true },
    });

    return res.status(200).json({
      draft: {
        id: draft.id,
        setId: draft.setId,
        normalizedLabel: draft.normalizedLabel ?? null,
        status: draft.status,
        archivedAt: draft.archivedAt ? draft.archivedAt.toISOString() : null,
        updatedAt: draft.updatedAt.toISOString(),
      },
      versions: versionsFiltered.map((version) => ({
        id: version.id,
        version: version.version,
        versionHash: version.versionHash,
        rowCount: version.rowCount,
        errorCount: version.errorCount,
        blockingErrorCount: version.blockingErrorCount,
        createdAt: version.createdAt.toISOString(),
      })),
      latestVersion: latest
        ? {
            id: latest.id,
            version: latest.version,
            versionHash: latest.versionHash,
            rowCount: latest.rowCount,
            errorCount: latest.errorCount,
            blockingErrorCount: latest.blockingErrorCount,
            createdAt: latest.createdAt.toISOString(),
            datasetType: datasetTypeFromJson(latest.dataJson),
            rows: extractDraftRows(latest.dataJson),
          }
        : null,
      latestApprovedVersionId: latestApproved?.draftVersionId ?? null,
    });
  } catch (error) {
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.drafts.read",
      status: SetAuditStatus.FAILURE,
      setId: attemptedSetId || null,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
