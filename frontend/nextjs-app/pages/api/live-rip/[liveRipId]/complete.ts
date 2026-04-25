import type { NextApiRequest, NextApiResponse } from "next";
import { LiveRipStatus, prisma } from "@tenkings/database";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const liveRipId = Array.isArray(req.query.liveRipId) ? req.query.liveRipId[0] : req.query.liveRipId;
  if (!liveRipId) {
    return res.status(400).json({ message: "Missing live rip id" });
  }

  try {
    const session = await requireUserSession(req);
    const liveRip = await prisma.liveRip.findUnique({ where: { id: liveRipId } });
    if (!liveRip || liveRip.userId !== session.user.id || liveRip.isGoldenTicket) {
      return res.status(404).json({ message: "Live rip not found" });
    }

    const now = new Date();
    const updated = await prisma.liveRip.update({
      where: { id: liveRip.id },
      data: {
        status: LiveRipStatus.COMPLETE,
        endedAt: liveRip.endedAt ?? now,
        startedAt: liveRip.startedAt ?? now,
      },
      select: {
        id: true,
        slug: true,
        status: true,
        endedAt: true,
      },
    });

    return res.status(200).json({
      liveRip: {
        id: updated.id,
        slug: updated.slug,
        status: updated.status,
        endedAt: updated.endedAt?.toISOString() ?? null,
        watchUrl: `/live/${updated.slug}`,
      },
    });
  } catch (error) {
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
