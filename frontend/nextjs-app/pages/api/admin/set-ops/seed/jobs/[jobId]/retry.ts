import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, SetAuditStatus, SetSeedJobStatus, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../../../lib/server/setOps";
import { runSeedJob } from "../../../../../../../lib/server/setOpsSeed";

type ResponseBody =
  | {
      job: {
        id: string;
        status: string;
        queueCount: number | null;
        createdAt: string;
        completedAt: string | null;
        errorMessage: string | null;
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
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "approver")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.seed.jobs.retry",
        status: SetAuditStatus.DENIED,
        reason: roleDeniedMessage("approver"),
      });
      return res.status(403).json({ message: roleDeniedMessage("approver") });
    }

    if (!jobId) {
      return res.status(400).json({ message: "jobId is required" });
    }

    const existing = await prisma.setSeedJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        draftId: true,
        draftVersionId: true,
        runArgsJson: true,
        draft: {
          select: {
            id: true,
            setId: true,
          },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Seed job not found" });
    }

    if (!existing.draftVersionId) {
      return res.status(400).json({ message: "Seed job is missing draftVersionId" });
    }

    const draftVersion = await prisma.setDraftVersion.findUnique({
      where: { id: existing.draftVersionId },
      select: { id: true, dataJson: true },
    });

    if (!draftVersion) {
      return res.status(404).json({ message: "Draft version for retry not found" });
    }

    const retryJob = await prisma.setSeedJob.create({
      data: {
        draftId: existing.draftId,
        draftVersionId: existing.draftVersionId,
        status: SetSeedJobStatus.QUEUED,
        requestedById: admin.user.id,
        retryOfId: existing.id,
        runArgsJson: (existing.runArgsJson ?? {}) as Prisma.InputJsonValue,
        progressJson: {
          processed: 0,
          total: 0,
          inserted: 0,
          updated: 0,
          failed: 0,
          skipped: 0,
        } as Prisma.InputJsonValue,
        logsJson: ["seed:retry_queued"] as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        status: true,
        queueCount: true,
        createdAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });

    const summary = await runSeedJob({
      jobId: retryJob.id,
      setId: existing.draft.setId,
      draftDataJson: draftVersion.dataJson,
    });

    const refreshed = await prisma.setSeedJob.findUnique({
      where: { id: retryJob.id },
      select: {
        id: true,
        status: true,
        queueCount: true,
        createdAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });

    if (!refreshed) {
      return res.status(500).json({ message: "Failed to reload retry job" });
    }

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.seed.jobs.retry",
      status: summary.status === SetSeedJobStatus.FAILED ? SetAuditStatus.FAILURE : SetAuditStatus.SUCCESS,
      setId: existing.draft.setId,
      draftId: existing.draft.id,
      draftVersionId: existing.draftVersionId,
      seedJobId: refreshed.id,
      metadata: {
        retryOfId: existing.id,
        status: summary.status,
        processed: summary.processed,
        failed: summary.failed,
        queueCount: summary.queueCount,
      },
    });

    return res.status(200).json({
      job: {
        id: refreshed.id,
        status: refreshed.status,
        queueCount: refreshed.queueCount,
        createdAt: refreshed.createdAt.toISOString(),
        completedAt: refreshed.completedAt ? refreshed.completedAt.toISOString() : null,
        errorMessage: refreshed.errorMessage,
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
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.seed.jobs.retry",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
