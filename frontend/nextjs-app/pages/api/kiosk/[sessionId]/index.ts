import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { kioskSessionInclude, serializeKioskSession } from "../../../../lib/server/kioskSession";
import { hasKioskControl } from "../../../../lib/server/kioskAuth";

async function loadSession(sessionId: string) {
  return prisma.kioskSession.findUnique({
    where: { id: sessionId },
    include: kioskSessionInclude,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  if (req.method === "GET") {
    const session = await loadSession(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    return res.status(200).json({ session: serializeKioskSession(session) });
  }

  if (req.method === "DELETE") {
    const session = await prisma.kioskSession.findUnique({
      where: { id: sessionId },
      include: kioskSessionInclude,
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (!hasKioskControl(req, session.controlTokenHash)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const cancelled = await prisma.kioskSession.update({
      where: { id: sessionId },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
      },
      include: kioskSessionInclude,
    });

    return res.status(200).json({ session: serializeKioskSession(cancelled) });
  }

  res.setHeader("Allow", "GET, DELETE");
  return res.status(405).json({ message: "Method not allowed" });
}
