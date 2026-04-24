import type { NextApiRequest, NextApiResponse } from "next";
import { KioskSessionStatus, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";

type ResponseBody =
  | {
      alreadyCancelled: boolean;
      session: {
        id: string;
        status: KioskSessionStatus;
        completedAt: string | null;
      };
      message: string;
    }
  | {
      message: string;
    };

const ACTIVE_GOLDEN_QUEUE_STATUSES = new Set<KioskSessionStatus>([
  KioskSessionStatus.COUNTDOWN,
  KioskSessionStatus.LIVE,
  KioskSessionStatus.REVEAL,
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  try {
    const admin = await requireAdminSession(req);

    const existing = await prisma.kioskSession.findUnique({
      where: {
        id: sessionId,
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
        isGoldenTicket: true,
      },
    });

    if (!existing || !existing.isGoldenTicket) {
      return res.status(404).json({ message: "Golden Ticket session not found" });
    }

    if (existing.status === KioskSessionStatus.CANCELLED) {
      return res.status(200).json({
        alreadyCancelled: true,
        session: {
          id: existing.id,
          status: existing.status,
          completedAt: existing.completedAt ? existing.completedAt.toISOString() : null,
        },
        message: "Golden Ticket session was already cancelled.",
      });
    }

    if (!ACTIVE_GOLDEN_QUEUE_STATUSES.has(existing.status)) {
      return res.status(409).json({ message: "Only active Golden Ticket sessions can be cancelled." });
    }

    const killedAt = new Date();
    const updated = await prisma.kioskSession.update({
      where: {
        id: existing.id,
      },
      data: {
        status: KioskSessionStatus.CANCELLED,
        completedAt: existing.completedAt ?? killedAt,
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
      },
    });

    const actorLabel = admin.user.displayName ?? admin.user.phone ?? admin.user.id;

    return res.status(200).json({
      alreadyCancelled: false,
      session: {
        id: updated.id,
        status: updated.status,
        completedAt: updated.completedAt ? updated.completedAt.toISOString() : null,
      },
      message: `Golden Ticket session cancelled by ${actorLabel}.`,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
