import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import {
  prisma,
  SetApprovalDecision,
  SetAuditStatus,
  SetIngestionJobStatus,
  SetSeedJobStatus,
  type Prisma,
} from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../lib/server/setOps";
import { extractDraftRows, summarizeDraftDiff } from "../../../../lib/server/setOpsDrafts";
import { runSeedJob } from "../../../../lib/server/setOpsSeed";
import { ensureNoActiveSetReplaceJob } from "../../../../lib/server/setOpsReplace";

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
      variantSync:
        | {
            jobId: string;
            status: string;
            processed: number;
            inserted: number;
            updated: number;
            failed: number;
            skipped: number;
            queueCount: number;
            durationMs: number;
            errorMessage: string | null;
          }
        | null;
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

    let variantSync: {
      jobId: string;
      status: string;
      processed: number;
      inserted: number;
      updated: number;
      failed: number;
      skipped: number;
      queueCount: number;
      durationMs: number;
      errorMessage: string | null;
    } | null = null;

    if (payload.decision === SetApprovalDecision.APPROVED) {
      await ensureNoActiveSetReplaceJob(setId);

      const seedJob = await prisma.setSeedJob.create({
        data: {
          draftId: draft.id,
          draftVersionId: draftVersion.id,
          status: SetSeedJobStatus.QUEUED,
          requestedById: admin.user.id,
          runArgsJson: {
            setId,
            draftVersionId: draftVersion.id,
            triggeredBy: "approval",
          } as Prisma.InputJsonValue,
          progressJson: {
            processed: 0,
            total: 0,
            inserted: 0,
            updated: 0,
            failed: 0,
            skipped: 0,
          } as Prisma.InputJsonValue,
          logsJson: ["seed:queued", "seed:trigger=approval"] as Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      try {
        const summary = await runSeedJob({
          jobId: seedJob.id,
          setId,
          draftDataJson: draftVersion.dataJson,
        });

        const refreshedSeed = await prisma.setSeedJob.findUnique({
          where: { id: seedJob.id },
          select: {
            id: true,
            status: true,
            queueCount: true,
            errorMessage: true,
          },
        });

        variantSync = {
          jobId: seedJob.id,
          status: refreshedSeed?.status ?? summary.status,
          processed: summary.processed,
          inserted: summary.inserted,
          updated: summary.updated,
          failed: summary.failed,
          skipped: summary.skipped,
          queueCount: refreshedSeed?.queueCount ?? summary.queueCount,
          durationMs: summary.durationMs,
          errorMessage: refreshedSeed?.errorMessage ?? null,
        };

        const syncFailed =
          variantSync.status !== SetSeedJobStatus.COMPLETE ||
          variantSync.failed > 0 ||
          Boolean(variantSync.errorMessage);

        if (syncFailed) {
          const failureMessage =
            variantSync.errorMessage ||
            `Auto-sync failed (status=${variantSync.status}, failed=${variantSync.failed}).`;

          await writeSetOpsAuditEvent({
            req,
            admin,
            action: "set_ops.seed.jobs.start",
            status: SetAuditStatus.FAILURE,
            setId,
            draftId: draft.id,
            draftVersionId: draftVersion.id,
            seedJobId: seedJob.id,
            reason: failureMessage,
            metadata: {
              trigger: "approval",
              status: variantSync.status,
              processed: variantSync.processed,
              inserted: variantSync.inserted,
              updated: variantSync.updated,
              failed: variantSync.failed,
              skipped: variantSync.skipped,
              queueCount: variantSync.queueCount,
              durationMs: variantSync.durationMs,
            },
          });

          return res.status(409).json({
            message: `Approve blocked: variant sync failed. ${failureMessage}`,
          });
        }

        await writeSetOpsAuditEvent({
          req,
          admin,
          action: "set_ops.seed.jobs.start",
          status: SetAuditStatus.SUCCESS,
          setId,
          draftId: draft.id,
          draftVersionId: draftVersion.id,
          seedJobId: seedJob.id,
          metadata: {
            trigger: "approval",
            status: variantSync.status,
            processed: variantSync.processed,
            inserted: variantSync.inserted,
            updated: variantSync.updated,
            failed: variantSync.failed,
            skipped: variantSync.skipped,
            queueCount: variantSync.queueCount,
            durationMs: variantSync.durationMs,
          },
        });
      } catch (seedError) {
        const failureMessage = seedError instanceof Error ? seedError.message : "Variant sync failed after approval.";
        await writeSetOpsAuditEvent({
          req,
          admin,
          action: "set_ops.seed.jobs.start",
          status: SetAuditStatus.FAILURE,
          setId,
          draftId: draft.id,
          draftVersionId: draftVersion.id,
          seedJobId: seedJob.id,
          reason: failureMessage,
          metadata: {
            trigger: "approval",
          },
        });
        return res.status(409).json({
          message: `Approve blocked: variant sync failed. ${failureMessage}`,
        });
      }
    }

    const approval = await prisma.setApproval.create({
      data: {
        draftId: draft.id,
        draftVersionId: draftVersion.id,
        decision: payload.decision,
        reason: payload.reason ?? null,
        diffSummaryJson: diffSummary as Prisma.InputJsonValue,
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
        variantSync: variantSync
          ? {
              jobId: variantSync.jobId,
              status: variantSync.status,
              failed: variantSync.failed,
            }
          : null,
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
      variantSync,
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
