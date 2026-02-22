import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma, SetAuditStatus } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../lib/server/admin";
import {
  canPerformSetOpsRole,
  roleDeniedMessage,
  writeSetOpsAuditEvent,
} from "../../../../lib/server/setOps";

const archiveSchema = z.object({
  setId: z.string().min(1),
  archived: z.boolean().optional().default(true),
  note: z.string().trim().max(500).optional(),
});

type ResponseBody =
  | {
      draft: {
        id: string;
        setId: string;
        normalizedLabel: string | null;
        status: string;
        archivedAt: string | null;
        updatedAt: string;
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
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "admin")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.archive.update",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("admin"),
      });
      return res.status(403).json({ message: roleDeniedMessage("admin") });
    }

    const payload = archiveSchema.parse(req.body ?? {});
    const setId = normalizeSetLabel(payload.setId);
    if (!setId) {
      return res.status(400).json({ message: "setId is required" });
    }

    const now = new Date();
    const existing = await prisma.setDraft.findUnique({
      where: { setId },
      select: { id: true, status: true },
    });

    let draft;

    if (existing) {
      draft = await prisma.setDraft.update({
        where: { id: existing.id },
        data: payload.archived
          ? {
              status: "ARCHIVED",
              archivedAt: now,
              archivedById: admin.user.id,
              normalizedLabel: normalizeSetLabel(setId),
            }
          : {
              status: existing.status === "ARCHIVED" ? "DRAFT" : existing.status,
              archivedAt: null,
              archivedById: null,
              normalizedLabel: normalizeSetLabel(setId),
            },
        select: {
          id: true,
          setId: true,
          normalizedLabel: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
        },
      });
    } else {
      draft = await prisma.setDraft.create({
        data: {
          setId,
          normalizedLabel: normalizeSetLabel(setId),
          status: payload.archived ? "ARCHIVED" : "DRAFT",
          archivedAt: payload.archived ? now : null,
          archivedById: payload.archived ? admin.user.id : null,
          createdById: admin.user.id,
        },
        select: {
          id: true,
          setId: true,
          normalizedLabel: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
        },
      });
    }

    const audit = await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.archive.update",
      status: SetAuditStatus.SUCCESS,
      setId,
      draftId: draft.id,
      metadata: {
        archived: payload.archived,
        note: payload.note ?? null,
      },
    });

    return res.status(200).json({
      draft: {
        id: draft.id,
        setId: draft.setId,
        normalizedLabel: draft.normalizedLabel ?? null,
        status: draft.status,
        archivedAt: draft.archivedAt ? draft.archivedAt.toISOString() : null,
        updatedAt: draft.updatedAt.toISOString(),
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
    const isValidation = error instanceof z.ZodError;

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.archive.update",
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
