import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetApprovalDecision, SetAuditStatus, SetIngestionJobStatus } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../lib/server/setOps";
import { extractDraftRows, summarizeDraftDiff } from "../../../../lib/server/setOpsDrafts";

const approvalSchema = z.object({
  setId: z.string().min(1),
  draftVersionId: z.string().min(1).optional(),
  decision: z.nativeEnum(SetApprovalDecision),
  reason: z.string().trim().max(500).optional(),
});

type ResponseBody =
  | {
      approval: {
        id: string;
        decision: string;
        draftVersionId: string;
        versionHash: string;
        createdAt: string;
      };
      draftStatus: string;
      diffSummary: ReturnType<typeof summarizeDraftDiff>;
      blockingErrorCount: number;
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

    if (!canPerformSetOpsRole(admin, "approver")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.approval.write",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("approver"),
      });
      return res.status(403).json({ message: roleDeniedMessage("approver") });
    }

    const payload = approvalSchema.parse(req.body ?? {});
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

    const draftVersion = payload.draftVersionId
      ? await prisma.setDraftVersion.findFirst({
          where: {
            id: payload.draftVersionId,
            draftId: draft.id,
          },
          select: {
            id: true,
            versionHash: true,
            blockingErrorCount: true,
            dataJson: true,
          },
        })
      : await prisma.setDraftVersion.findFirst({
          where: { draftId: draft.id },
          orderBy: [{ version: "desc" }],
          select: {
            id: true,
            versionHash: true,
            blockingErrorCount: true,
            dataJson: true,
          },
        });

    if (!draftVersion) {
      return res.status(404).json({ message: "Draft version not found" });
    }

    const blockingErrorCount = draftVersion.blockingErrorCount;
    if (payload.decision === SetApprovalDecision.APPROVED && blockingErrorCount > 0) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.approval.write",
        status: SetAuditStatus.DENIED,
        setId,
        draftId: draft.id,
        draftVersionId: draftVersion.id,
        reason: "blocking_errors_present",
        metadata: {
          blockingErrorCount,
        },
      });
      return res.status(400).json({
        message: `Cannot approve draft while blocking errors exist (${blockingErrorCount})`,
      });
    }

    const previousApproved = await prisma.setApproval.findFirst({
      where: {
        draftId: draft.id,
        decision: SetApprovalDecision.APPROVED,
      },
      orderBy: [{ createdAt: "desc" }],
      select: { draftVersionId: true },
    });

    const previousVersion = previousApproved
      ? await prisma.setDraftVersion.findUnique({
          where: { id: previousApproved.draftVersionId },
          select: { dataJson: true },
        })
      : null;

    const previousRows = extractDraftRows(previousVersion?.dataJson ?? null);
    const nextRows = extractDraftRows(draftVersion.dataJson);
    const diffSummary = summarizeDraftDiff(previousRows, nextRows);

    const approval = await prisma.setApproval.create({
      data: {
        draftId: draft.id,
        draftVersionId: draftVersion.id,
        decision: payload.decision,
        reason: payload.reason ?? null,
        diffSummaryJson: diffSummary,
        versionHash: draftVersion.versionHash,
        approvedById: admin.user.id,
      },
      select: {
        id: true,
        decision: true,
        draftVersionId: true,
        versionHash: true,
        createdAt: true,
      },
    });

    const draftStatus = payload.decision === SetApprovalDecision.APPROVED ? "APPROVED" : "REJECTED";

    await prisma.setDraft.update({
      where: { id: draft.id },
      data: {
        status: draftStatus,
      },
    });

    await prisma.setIngestionJob.updateMany({
      where: {
        draftId: draft.id,
        status: {
          in: [SetIngestionJobStatus.QUEUED, SetIngestionJobStatus.PARSED, SetIngestionJobStatus.REVIEW_REQUIRED],
        },
      },
      data: {
        status: payload.decision === SetApprovalDecision.APPROVED ? SetIngestionJobStatus.APPROVED : SetIngestionJobStatus.REJECTED,
        reviewedAt: new Date(),
      },
    });

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.approval.write",
      status: SetAuditStatus.SUCCESS,
      setId,
      draftId: draft.id,
      draftVersionId: draftVersion.id,
      approvalId: approval.id,
      metadata: {
        decision: payload.decision,
        diffSummary,
        blockingErrorCount,
      },
    });

    return res.status(200).json({
      approval: {
        id: approval.id,
        decision: approval.decision,
        draftVersionId: approval.draftVersionId,
        versionHash: approval.versionHash,
        createdAt: approval.createdAt.toISOString(),
      },
      draftStatus,
      diffSummary,
      blockingErrorCount,
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
      action: "set_ops.approval.write",
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
