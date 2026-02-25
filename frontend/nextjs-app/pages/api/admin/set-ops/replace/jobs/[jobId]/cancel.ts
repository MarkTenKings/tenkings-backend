import type { NextApiRequest, NextApiResponse } from "next";
import { SetAuditStatus } from "@tenkings/database";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../../../lib/server/admin";
import { canPerformSetOpsRole, roleDeniedMessage, writeSetOpsAuditEvent } from "../../../../../../../lib/server/setOps";
import {
  isSetOpsReplaceWizardEnabled,
  requestSetReplaceCancel,
  type SetReplaceJobView,
} from "../../../../../../../lib/server/setOpsReplace";

type ResponseBody =
  | {
      job: SetReplaceJobView;
    }
  | { message: string };

function hasReplaceCancelAccess(admin: AdminSession) {
  return canPerformSetOpsRole(admin, "reviewer") && canPerformSetOpsRole(admin, "delete") && canPerformSetOpsRole(admin, "approver");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (!isSetOpsReplaceWizardEnabled()) {
    return res.status(404).json({ message: "Set replace wizard is disabled" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  const jobId = String(req.query.jobId ?? "").trim();

  try {
    admin = await requireAdminSession(req);

    if (!hasReplaceCancelAccess(admin)) {
      const denied = !canPerformSetOpsRole(admin, "reviewer")
        ? roleDeniedMessage("reviewer")
        : !canPerformSetOpsRole(admin, "delete")
        ? roleDeniedMessage("delete")
        : roleDeniedMessage("approver");

      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.replace.cancel",
        status: SetAuditStatus.DENIED,
        reason: denied,
      });

      return res.status(403).json({ message: denied });
    }

    if (!jobId) {
      return res.status(400).json({ message: "jobId is required" });
    }

    const cancelled = await requestSetReplaceCancel({
      req,
      admin,
      jobId,
      reason: typeof req.body?.reason === "string" ? req.body.reason : null,
    });

    return res.status(200).json({
      job: cancelled,
    });
  } catch (error) {
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.replace.cancel",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
