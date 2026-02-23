import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  computeSetDeleteImpact,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";

const dryRunSchema = z.object({
  setId: z.string().min(1),
});

type ResponseBody =
  | {
      impact: Awaited<ReturnType<typeof computeSetDeleteImpact>>;
      audit: { id: string; status: string; action: string; createdAt: string } | null;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  const attemptedRawSetId = String(req.body?.setId ?? "").trim();
  const attemptedSetId = normalizeSetLabel(attemptedRawSetId);

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "delete")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.delete.dry_run",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("delete"),
      });
      return res.status(403).json({ message: roleDeniedMessage("delete") });
    }

    const payload = dryRunSchema.parse(req.body ?? {});
    const rawSetId = String(payload.setId || "").trim();
    const setId = normalizeSetLabel(rawSetId);
    if (!rawSetId) {
      return res.status(400).json({ message: "setId is required" });
    }

    const impact = await computeSetDeleteImpact(prisma, rawSetId);
    const auditSetId = setId || rawSetId;

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.delete.dry_run",
      status: SetAuditStatus.SUCCESS,
      setId: auditSetId,
      metadata: {
        totalRowsToDelete: impact.totalRowsToDelete,
        rowsToDelete: impact.rowsToDelete,
        auditEventsForSet: impact.auditEventsForSet,
      },
    });

    return res.status(200).json({
      impact,
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
      action: "set_ops.delete.dry_run",
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
