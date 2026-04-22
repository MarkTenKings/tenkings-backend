import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { hasKioskControl } from "../../../../lib/server/kioskAuth";
import { kioskSessionInclude } from "../../../../lib/server/kioskSession";
import { completeKioskSession } from "../../../../lib/server/kioskCompletion";

const completeSchema = z.object({
  videoUrl: z.string().url("Video URL must be valid").optional(),
  thumbnailUrl: z.string().url().optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  featured: z.boolean().optional(),
  publish: z.boolean().optional().default(true),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

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

  try {
    const payload = completeSchema.parse(req.body ?? {});
    const completed = await completeKioskSession(session.id, payload);
    return res.status(200).json({ session: completed.serialized });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("kiosk complete error", error);
    return res.status(500).json({ message: "Failed to close kiosk session" });
  }
}
