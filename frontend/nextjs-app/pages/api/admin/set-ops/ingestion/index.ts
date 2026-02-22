import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus, SetDatasetType, SetIngestionJobStatus, type Prisma } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";

const createJobSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType),
  sourceUrl: z.string().trim().url().optional().nullable(),
  parserVersion: z.string().trim().min(1).max(120).default("manual-v1"),
  sourceProvider: z.string().trim().max(120).optional(),
  sourceQuery: z.record(z.string(), z.unknown()).optional(),
  sourceFetchMeta: z.record(z.string(), z.unknown()).optional(),
  rawPayload: z.unknown(),
});

type JobRow = {
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

type ResponseBody =
  | {
      jobs: JobRow[];
      total: number;
    }
  | {
      job: JobRow;
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

function toJobRow(job: {
  id: string;
  setId: string;
  draftId: string | null;
  datasetType: string;
  sourceUrl: string | null;
  parserVersion: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  parsedAt: Date | null;
  reviewedAt: Date | null;
  parseSummaryJson: unknown;
}): JobRow {
  const summary =
    job.parseSummaryJson && typeof job.parseSummaryJson === "object" && !Array.isArray(job.parseSummaryJson)
      ? (job.parseSummaryJson as Record<string, unknown>)
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

  return {
    id: job.id,
    setId: job.setId,
    draftId: job.draftId,
    datasetType: job.datasetType,
    sourceUrl: job.sourceUrl ?? null,
    parserVersion: job.parserVersion,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    parsedAt: job.parsedAt ? job.parsedAt.toISOString() : null,
    reviewedAt: job.reviewedAt ? job.reviewedAt.toISOString() : null,
    sourceProvider,
    sourceQuery,
    sourceFetchMeta,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? req.query.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.ingestion.access",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    if (req.method === "GET") {
      const setId = normalizeSetLabel(typeof req.query.setId === "string" ? req.query.setId : "");
      const status = String(req.query.status ?? "").trim().toUpperCase();
      const datasetType = String(req.query.datasetType ?? "").trim().toUpperCase();
      const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));

      const where: {
        setId?: string;
        status?: SetIngestionJobStatus;
        datasetType?: SetDatasetType;
      } = {};

      if (setId) {
        where.setId = setId;
      }
      if (status && status in SetIngestionJobStatus) {
        where.status = status as SetIngestionJobStatus;
      }
      if (datasetType && datasetType in SetDatasetType) {
        where.datasetType = datasetType as SetDatasetType;
      }

      const jobs = await prisma.setIngestionJob.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take: limit,
        select: {
          id: true,
          setId: true,
          draftId: true,
          datasetType: true,
          sourceUrl: true,
          parserVersion: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          parsedAt: true,
          reviewedAt: true,
          parseSummaryJson: true,
        },
      });

      return res.status(200).json({
        jobs: jobs.map(toJobRow),
        total: jobs.length,
      });
    }

    if (req.method === "POST") {
      const payload = createJobSchema.parse(req.body ?? {});
      const setId = normalizeSetLabel(payload.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }

      const draft = await prisma.setDraft.upsert({
        where: { setId },
        update: {
          normalizedLabel: setId,
        },
        create: {
          setId,
          normalizedLabel: setId,
          status: "DRAFT",
          createdById: admin.user.id,
        },
        select: { id: true },
      });

      const job = await prisma.setIngestionJob.create({
        data: {
          setId,
          draftId: draft.id,
          datasetType: payload.datasetType,
          sourceUrl: payload.sourceUrl ? payload.sourceUrl.trim() : null,
          rawPayload: payload.rawPayload as Prisma.InputJsonValue,
          parserVersion: payload.parserVersion,
          status: SetIngestionJobStatus.QUEUED,
          parseSummaryJson: {
            sourceProvider: payload.sourceProvider || "MANUAL_UPLOAD",
            sourceQuery: payload.sourceQuery ?? null,
            sourceFetchMeta: payload.sourceFetchMeta ?? null,
          } as Prisma.InputJsonValue,
          createdById: admin.user.id,
        },
        select: {
          id: true,
          setId: true,
          draftId: true,
          datasetType: true,
          sourceUrl: true,
          parserVersion: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          parsedAt: true,
          reviewedAt: true,
          parseSummaryJson: true,
        },
      });

      const audit = await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.ingestion.create",
        status: SetAuditStatus.SUCCESS,
        setId,
        draftId: draft.id,
        ingestionJobId: job.id,
        metadata: {
          datasetType: payload.datasetType,
          parserVersion: payload.parserVersion,
          hasSourceUrl: Boolean(payload.sourceUrl),
          sourceProvider: payload.sourceProvider || "MANUAL_UPLOAD",
        },
      });

      return res.status(200).json({
        job: toJobRow(job),
        audit: audit
          ? {
              id: audit.id,
              status: audit.status,
              action: audit.action,
              createdAt: audit.createdAt.toISOString(),
            }
          : null,
      });
    }

    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const isValidation = error instanceof z.ZodError;

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.ingestion.error",
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
