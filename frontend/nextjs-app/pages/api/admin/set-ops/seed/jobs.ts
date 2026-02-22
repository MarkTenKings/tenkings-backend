import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus, SetApprovalDecision, SetSeedJobStatus } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";
import { runSeedJob } from "../../../../../lib/server/setOpsSeed";

const startSchema = z.object({
  setId: z.string().min(1),
  draftVersionId: z.string().min(1).optional(),
});

type SeedJobRow = {
  id: string;
  draftId: string;
  draftVersionId: string | null;
  status: string;
  queueCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  logs: string[];
  setId: string;
};

type ResponseBody =
  | {
      jobs: SeedJobRow[];
      total: number;
    }
  | {
      job: SeedJobRow;
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

function toSeedJobRow(job: {
  id: string;
  draftId: string;
  draftVersionId: string | null;
  status: string;
  queueCount: number | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  progressJson: unknown;
  resultJson: unknown;
  logsJson: unknown;
  draft: { setId: string };
}): SeedJobRow {
  return {
    id: job.id,
    draftId: job.draftId,
    draftVersionId: job.draftVersionId,
    status: job.status,
    queueCount: job.queueCount ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    cancelRequestedAt: job.cancelRequestedAt ? job.cancelRequestedAt.toISOString() : null,
    progress: (job.progressJson as Record<string, unknown> | null) ?? null,
    result: (job.resultJson as Record<string, unknown> | null) ?? null,
    logs: Array.isArray(job.logsJson) ? job.logsJson.map((entry) => String(entry)) : [],
    setId: job.draft.setId,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? req.query.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "approver")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.seed.jobs.access",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("approver"),
      });
      return res.status(403).json({ message: roleDeniedMessage("approver") });
    }

    if (req.method === "GET") {
      const setId = normalizeSetLabel(typeof req.query.setId === "string" ? req.query.setId : "");
      const status = String(req.query.status ?? "").trim().toUpperCase();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60) || 60));

      const jobs = await prisma.setSeedJob.findMany({
        where: {
          ...(setId
            ? {
                draft: {
                  setId,
                },
              }
            : {}),
          ...(status && status in SetSeedJobStatus
            ? {
                status: status as SetSeedJobStatus,
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }],
        take: limit,
        select: {
          id: true,
          draftId: true,
          draftVersionId: true,
          status: true,
          queueCount: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          startedAt: true,
          completedAt: true,
          cancelRequestedAt: true,
          progressJson: true,
          resultJson: true,
          logsJson: true,
          draft: { select: { setId: true } },
        },
      });

      return res.status(200).json({
        jobs: jobs.map(toSeedJobRow),
        total: jobs.length,
      });
    }

    if (req.method === "POST") {
      const payload = startSchema.parse(req.body ?? {});
      const setId = normalizeSetLabel(payload.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }

      const draft = await prisma.setDraft.findUnique({
        where: { setId },
        select: { id: true },
      });

      if (!draft) {
        return res.status(404).json({ message: "Draft not found for set" });
      }

      const approvedVersionId = payload.draftVersionId
        ? payload.draftVersionId
        : (
            await prisma.setApproval.findFirst({
              where: {
                draftId: draft.id,
                decision: SetApprovalDecision.APPROVED,
              },
              orderBy: [{ createdAt: "desc" }],
              select: { draftVersionId: true },
            })
          )?.draftVersionId;

      if (!approvedVersionId) {
        return res.status(400).json({ message: "No approved draft version available for seed" });
      }

      const approvedLink = await prisma.setApproval.findFirst({
        where: {
          draftId: draft.id,
          draftVersionId: approvedVersionId,
          decision: SetApprovalDecision.APPROVED,
        },
        select: { id: true },
      });

      if (!approvedLink) {
        return res.status(400).json({ message: "Selected draft version is not approved" });
      }

      const draftVersion = await prisma.setDraftVersion.findUnique({
        where: { id: approvedVersionId },
        select: {
          id: true,
          dataJson: true,
        },
      });

      if (!draftVersion) {
        return res.status(404).json({ message: "Approved draft version not found" });
      }

      const seedJob = await prisma.setSeedJob.create({
        data: {
          draftId: draft.id,
          draftVersionId: draftVersion.id,
          status: SetSeedJobStatus.QUEUED,
          requestedById: admin.user.id,
          runArgsJson: {
            setId,
            draftVersionId: draftVersion.id,
          },
          progressJson: {
            processed: 0,
            total: 0,
            inserted: 0,
            updated: 0,
            failed: 0,
            skipped: 0,
          },
          logsJson: ["seed:queued"],
        },
        select: {
          id: true,
          draftId: true,
          draftVersionId: true,
          status: true,
          queueCount: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          startedAt: true,
          completedAt: true,
          cancelRequestedAt: true,
          progressJson: true,
          resultJson: true,
          logsJson: true,
          draft: { select: { setId: true } },
        },
      });

      const summary = await runSeedJob({
        jobId: seedJob.id,
        setId,
        draftDataJson: draftVersion.dataJson,
      });

      const refreshed = await prisma.setSeedJob.findUnique({
        where: { id: seedJob.id },
        select: {
          id: true,
          draftId: true,
          draftVersionId: true,
          status: true,
          queueCount: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          startedAt: true,
          completedAt: true,
          cancelRequestedAt: true,
          progressJson: true,
          resultJson: true,
          logsJson: true,
          draft: { select: { setId: true } },
        },
      });

      if (!refreshed) {
        return res.status(500).json({ message: "Failed to reload seed job" });
      }

      const audit = await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.seed.jobs.start",
        status: summary.status === SetSeedJobStatus.FAILED ? SetAuditStatus.FAILURE : SetAuditStatus.SUCCESS,
        setId,
        draftId: draft.id,
        draftVersionId: draftVersion.id,
        seedJobId: seedJob.id,
        metadata: {
          status: summary.status,
          processed: summary.processed,
          inserted: summary.inserted,
          updated: summary.updated,
          failed: summary.failed,
          skipped: summary.skipped,
          queueCount: summary.queueCount,
          durationMs: summary.durationMs,
        },
      });

      return res.status(200).json({
        job: toSeedJobRow(refreshed),
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
      action: "set_ops.seed.jobs.error",
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
