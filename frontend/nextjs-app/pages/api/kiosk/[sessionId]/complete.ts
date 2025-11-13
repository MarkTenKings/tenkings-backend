import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { hasKioskControl } from "../../../../lib/server/kioskAuth";
import { kioskSessionInclude, serializeKioskSession } from "../../../../lib/server/kioskSession";
import { slugify } from "../../../../lib/slugify";
import { buildMuxPlaybackUrl } from "../../../../lib/server/mux";

const completeSchema = z.object({
  videoUrl: z.string().url("Video URL must be valid").optional(),
  thumbnailUrl: z.string().url().optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  featured: z.boolean().optional(),
  publish: z.boolean().optional().default(true),
});

function extractRevealName(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const maybeName = (payload as Record<string, unknown>).name;
  return typeof maybeName === "string" ? maybeName : undefined;
}

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
    const now = new Date();

    const fallbackPlaybackUrl = session.muxPlaybackId ? buildMuxPlaybackUrl(session.muxPlaybackId) : null;
    const finalVideoUrl = payload.videoUrl ?? fallbackPlaybackUrl ?? null;

    if (payload.publish && finalVideoUrl) {
      const revealName = extractRevealName(session.revealPayload) || session.revealItem?.name;
      const baseTitle = payload.title?.trim() || revealName || "Live Rip";
      const baseSlugInput = payload.title?.trim() || `${session.code}-${baseTitle}`;
      let slugBase = slugify(baseSlugInput);
      if (!slugBase) {
        slugBase = slugify(baseTitle) || `tenkings-live-${session.id.slice(0, 8)}`;
      }

      let candidateSlug = slugBase;
      let attempt = 1;
      while (await prisma.liveRip.findUnique({ where: { slug: candidateSlug } })) {
        candidateSlug = `${slugBase}-${attempt++}`;
      }

      await prisma.liveRip.create({
        data: {
          slug: candidateSlug,
          title: baseTitle,
          description: payload.description?.trim() || null,
          videoUrl: finalVideoUrl,
          thumbnailUrl: payload.thumbnailUrl ?? session.thumbnailUrl ?? null,
          locationId: session.locationId,
          featured: payload.featured ?? true,
          kioskSessionId: session.id,
        },
      });
    }

    const updated = await prisma.kioskSession.update({
      where: { id: session.id },
      data: {
        status: payload.publish ? "COMPLETE" : session.status,
        videoUrl: finalVideoUrl ?? session.videoUrl,
        thumbnailUrl: payload.thumbnailUrl ?? session.thumbnailUrl,
        completedAt: now,
      },
      include: kioskSessionInclude,
    });

    if (session.packInstanceId) {
      await prisma.packInstance.update({
        where: { id: session.packInstanceId },
        data: { status: "OPENED" },
      });
    }

    return res.status(200).json({ session: serializeKioskSession(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("kiosk complete error", error);
    return res.status(500).json({ message: "Failed to close kiosk session" });
  }
}
