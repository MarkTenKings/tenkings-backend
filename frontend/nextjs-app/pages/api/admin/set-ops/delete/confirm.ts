import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus, type Prisma } from "@tenkings/database";
import { buildSetDeleteConfirmationPhrase, isSetDeleteConfirmationValid, normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  computeSetDeleteImpact,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../../lib/server/setOps";

const confirmSchema = z.object({
  setId: z.string().min(1),
  typedConfirmation: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

type ResponseBody =
  | {
      ok: true;
      setId: string;
      impact: Awaited<ReturnType<typeof computeSetDeleteImpact>>;
      audit: { id: string; status: string; action: string; createdAt: string };
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
        action: "set_ops.delete.confirm",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("delete"),
      });
      return res.status(403).json({ message: roleDeniedMessage("delete") });
    }

    const payload = confirmSchema.parse(req.body ?? {});
    const rawSetId = String(payload.setId || "").trim();
    const setId = normalizeSetLabel(rawSetId);
    const confirmationSetId = setId || rawSetId;
    if (!rawSetId) {
      return res.status(400).json({ message: "setId is required" });
    }
    const setIdCandidates = Array.from(new Set([rawSetId, setId].filter(Boolean)));

    const expectedPhrase = buildSetDeleteConfirmationPhrase(confirmationSetId);
    if (!isSetDeleteConfirmationValid(confirmationSetId, payload.typedConfirmation)) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.delete.confirm",
        status: SetAuditStatus.DENIED,
        setId: confirmationSetId,
        reason: "typed_confirmation_mismatch",
        metadata: {
          expectedPhrase,
          typedConfirmation: payload.typedConfirmation.trim(),
        },
      });
      return res.status(400).json({ message: `Typed confirmation must exactly match: ${expectedPhrase}` });
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const impact = await computeSetDeleteImpact(tx as unknown as Parameters<typeof computeSetDeleteImpact>[0], rawSetId);

      await tx.cardVariantReferenceImage.deleteMany({
        where: {
          setId: { in: setIdCandidates },
        },
      });
      await tx.cardVariant.deleteMany({
        where: {
          setId: { in: setIdCandidates },
        },
      });
      await tx.setDraft.deleteMany({
        where: {
          setId: { in: setIdCandidates },
        },
      });

      const audit = await tx.setAuditEvent.create({
        data: {
          actorId: admin?.user.id ?? null,
          action: "set_ops.delete.confirm",
          status: SetAuditStatus.SUCCESS,
          setId: confirmationSetId,
          reason: payload.reason || null,
          metadataJson: {
            setIdCandidates,
            rowsDeleted: impact.rowsToDelete,
            totalRowsDeleted: impact.totalRowsToDelete,
            auditEventsForSet: impact.auditEventsForSet,
          } as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          status: true,
          action: true,
          createdAt: true,
        },
      });

      return { impact, audit };
    });

    return res.status(200).json({
      ok: true,
      setId: confirmationSetId,
      impact: result.impact,
      audit: {
        id: result.audit.id,
        status: result.audit.status,
        action: result.audit.action,
        createdAt: result.audit.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const isValidation = error instanceof z.ZodError;

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.delete.confirm",
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
