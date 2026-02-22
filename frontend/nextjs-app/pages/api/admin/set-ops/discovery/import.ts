import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import { canPerformSetOpsRole, roleDeniedMessage, writeSetOpsAuditEvent } from "../../../../../lib/server/setOps";
import { importDiscoveredSource } from "../../../../../lib/server/setOpsDiscovery";

const importSchema = z.object({
  setId: z.string().trim().optional(),
  datasetType: z.nativeEnum(SetDatasetType),
  sourceUrl: z.string().trim().url(),
  sourceProvider: z.string().trim().max(120).optional(),
  sourceTitle: z.string().trim().max(300).optional(),
  parserVersion: z.string().trim().max(120).optional(),
  discoveryQuery: z.record(z.string(), z.unknown()).optional(),
});

type ResponseBody =
  | {
      job: {
        id: string;
        setId: string;
        draftId: string | null;
        datasetType: string;
        sourceUrl: string | null;
        parserVersion: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        parsedAt: string | null;
        reviewedAt: string | null;
        sourceProvider: string | null;
        sourceQuery: Record<string, unknown> | null;
        sourceFetchMeta: Record<string, unknown> | null;
      };
      preview: {
        setId: string;
        rowCount: number;
        parserName: string;
        sourceProvider: string;
        sourceUrl: string;
        fetchedAt: string;
        fetchAttempts: number;
        sampleRows: Array<Record<string, unknown>>;
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
        action: "set_ops.discovery.import",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const payload = importSchema.parse(req.body ?? {});
    const imported = await importDiscoveredSource({
      setId: payload.setId || null,
      datasetType: payload.datasetType,
      sourceUrl: payload.sourceUrl,
      sourceProvider: payload.sourceProvider || null,
      sourceTitle: payload.sourceTitle || null,
      parserVersion: payload.parserVersion || null,
      discoveryQuery: payload.discoveryQuery ?? null,
      createdById: admin.user.id,
    });

    const summary =
      imported.job.parseSummaryJson &&
      typeof imported.job.parseSummaryJson === "object" &&
      !Array.isArray(imported.job.parseSummaryJson)
        ? (imported.job.parseSummaryJson as Record<string, unknown>)
        : null;
    const sourceProvider = summary && typeof summary.sourceProvider === "string" ? summary.sourceProvider : null;
    const sourceQuery =
      summary && summary.sourceQuery && typeof summary.sourceQuery === "object" && !Array.isArray(summary.sourceQuery)
        ? (summary.sourceQuery as Record<string, unknown>)
        : null;
    const sourceFetchMeta =
      summary && summary.sourceFetchMeta && typeof summary.sourceFetchMeta === "object" && !Array.isArray(summary.sourceFetchMeta)
        ? (summary.sourceFetchMeta as Record<string, unknown>)
        : null;

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.discovery.import",
      status: SetAuditStatus.SUCCESS,
      setId: imported.preview.setId,
      draftId: imported.job.draftId ?? null,
      ingestionJobId: imported.job.id,
      metadata: {
        datasetType: payload.datasetType,
        sourceUrl: payload.sourceUrl,
        sourceProvider: payload.sourceProvider || imported.preview.sourceProvider,
        parserVersion: payload.parserVersion || null,
        parserName: imported.preview.parserName,
        rowCount: imported.preview.rowCount,
      },
    });

    return res.status(200).json({
      job: {
        id: imported.job.id,
        setId: imported.job.setId,
        draftId: imported.job.draftId ?? null,
        datasetType: imported.job.datasetType,
        sourceUrl: imported.job.sourceUrl ?? null,
        parserVersion: imported.job.parserVersion,
        status: imported.job.status,
        createdAt: imported.job.createdAt.toISOString(),
        updatedAt: imported.job.updatedAt.toISOString(),
        parsedAt: imported.job.parsedAt ? imported.job.parsedAt.toISOString() : null,
        reviewedAt: imported.job.reviewedAt ? imported.job.reviewedAt.toISOString() : null,
        sourceProvider,
        sourceQuery,
        sourceFetchMeta,
      },
      preview: imported.preview,
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
      action: "set_ops.discovery.import",
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
