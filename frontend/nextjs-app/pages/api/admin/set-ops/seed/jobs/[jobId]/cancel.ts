import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, SetAuditStatus, SetSeedJobStatus } from "@tenkings/database";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../../../lib/server/setOps";

type ResponseBody =
  | {
      job: {
        id: string;
        status: string;
        cancelRequestedAt: string | null;
        completedAt: string | null;
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
        action: "set_ops.seed.jobs.cancel",
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
        status: true,
        draft: { select: { setId: true, id: true } },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Seed job not found" });
    }

    if ([SetSeedJobStatus.COMPLETE, SetSeedJobStatus.FAILED, SetSeedJobStatus.CANCELLED].includes(existing.status)) {
      return res.status(400).json({ message: `Cannot cancel job in status ${existing.status}` });
    }

    const cancelled = await prisma.setSeedJob.update({
      where: { id: existing.id },
      data: {
        status: SetSeedJobStatus.CANCELLED,
        cancelRequestedAt: new Date(),
        completedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        cancelRequestedAt: true,
        completedAt: true,
      },
    });

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.seed.jobs.cancel",
      status: SetAuditStatus.SUCCESS,
      setId: existing.draft.setId,
      draftId: existing.draft.id,
      seedJobId: existing.id,
    });

    return res.status(200).json({
      job: {
        id: cancelled.id,
        status: cancelled.status,
        cancelRequestedAt: cancelled.cancelRequestedAt ? cancelled.cancelRequestedAt.toISOString() : null,
        completedAt: cancelled.completedAt ? cancelled.completedAt.toISOString() : null,
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
      action: "set_ops.seed.jobs.cancel",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
