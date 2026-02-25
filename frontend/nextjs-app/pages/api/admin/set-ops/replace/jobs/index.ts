import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../../lib/server/admin";
import { canPerformSetOpsRole, roleDeniedMessage, writeSetOpsAuditEvent } from "../../../../../../lib/server/setOps";
import {
  buildSetReplaceConfirmationPhrase,
  createSetReplaceJob,
  isSetOpsReplaceWizardEnabled,
  isSetReplaceConfirmationValid,
  listSetReplaceJobs,
  runSetReplaceJob,
  type SetReplaceJobView,
} from "../../../../../../lib/server/setOpsReplace";

const startSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType).default(SetDatasetType.PARALLEL_DB),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
  previewHash: z.string().min(8),
  typedConfirmation: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

type ResponseBody =
  | {
      jobs: SetReplaceJobView[];
      total: number;
    }
  | {
      job: SetReplaceJobView;
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

function hasReplaceRunAccess(admin: AdminSession) {
  const hasReview = canPerformSetOpsRole(admin, "reviewer");
  const hasDelete = canPerformSetOpsRole(admin, "delete");
  const hasApprover = canPerformSetOpsRole(admin, "approver");
  return {
    allowed: hasReview && hasDelete && hasApprover,
    hasReview,
    hasDelete,
    hasApprover,
  };
}

function replaceRoleDeniedMessage(admin: AdminSession) {
  const access = hasReplaceRunAccess(admin);
  if (access.allowed) return null;
  if (!access.hasReview) return roleDeniedMessage("reviewer");
  if (!access.hasDelete && !access.hasApprover) {
    return "Set replace requires both delete and approver roles";
  }
  if (!access.hasDelete) {
    return roleDeniedMessage("delete");
  }
  return roleDeniedMessage("approver");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (!isSetOpsReplaceWizardEnabled()) {
    return res.status(404).json({ message: "Set replace wizard is disabled" });
  }

  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? req.query.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.replace.jobs.access",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    if (req.method === "GET") {
      const setId = normalizeSetLabel(typeof req.query.setId === "string" ? req.query.setId : "");
      const jobId = typeof req.query.jobId === "string" ? req.query.jobId.trim() : "";
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));

      const jobs = await listSetReplaceJobs({
        setId,
        jobId: jobId || undefined,
        limit,
      });

      return res.status(200).json({
        jobs,
        total: jobs.length,
      });
    }

    if (req.method === "POST") {
      const denied = replaceRoleDeniedMessage(admin);
      if (denied) {
        await writeSetOpsAuditEvent({
          req,
          admin,
          action: "set_ops.replace.jobs.start",
          status: SetAuditStatus.DENIED,
          setId: attemptedSetId || null,
          reason: denied,
        });
        return res.status(403).json({ message: denied });
      }

      const payload = startSchema.parse(req.body ?? {});
      const setId = normalizeSetLabel(payload.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }

      if (!isSetReplaceConfirmationValid(setId, payload.typedConfirmation)) {
        return res
          .status(400)
          .json({ message: `Typed confirmation must exactly match: ${buildSetReplaceConfirmationPhrase(setId)}` });
      }

      const created = await createSetReplaceJob({
        req,
        admin,
        setId: payload.setId,
        datasetType: payload.datasetType,
        rows: payload.rows,
        previewHash: payload.previewHash,
        typedConfirmation: payload.typedConfirmation,
        reason: payload.reason ?? null,
      });

      void runSetReplaceJob({
        req,
        admin,
        jobId: created.id,
      }).catch((error) => {
        console.error("[set-ops.replace.jobs] background run failed", error);
      });

      const audit = await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.replace.jobs.start",
        status: SetAuditStatus.SUCCESS,
        setId,
        reason: payload.reason ?? null,
        metadata: {
          datasetType: payload.datasetType,
          previewHash: payload.previewHash,
          replaceJobId: created.id,
        },
      });

      return res.status(202).json({
        job: created,
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
      action: "set_ops.replace.jobs.error",
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
