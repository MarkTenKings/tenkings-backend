import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { generateControlToken, hashControlToken, ensureKioskSecret } from "../../../lib/server/kioskAuth";
import { kioskSessionInclude, serializeKioskSession } from "../../../lib/server/kioskSession";
import {
  buildMuxPlaybackUrl,
  createMuxLiveStream,
  muxCredentialsConfigured,
} from "../../../lib/server/mux";

const DEFAULT_COUNTDOWN = Number(process.env.KIOSK_COUNTDOWN_SECONDS ?? 10);
const DEFAULT_LIVE = Number(process.env.KIOSK_LIVE_SECONDS ?? 30);

const startSchema = z.object({
  packId: z.string().uuid("packId must be a valid UUID"),
  locationId: z.string().uuid().optional(),
  code: z.string().min(1).optional(),
  countdownSeconds: z.number().int().min(3).max(120).optional(),
  liveSeconds: z.number().int().min(10).max(300).optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!ensureKioskSecret(req)) {
    return res.status(401).json({ message: "Invalid kiosk secret" });
  }

  try {
    const payload = startSchema.parse(req.body ?? {});

    const pack = await prisma.packInstance.findUnique({
      where: { id: payload.packId },
      include: {
        packDefinition: true,
      },
    });

    if (!pack) {
      return res.status(404).json({ message: "Pack not found" });
    }

    if (pack.status !== "UNOPENED") {
      return res.status(400).json({ message: "Pack has already been opened" });
    }

    const code = payload.code?.trim() || pack.id;

    const existing = await prisma.kioskSession.findFirst({
      where: {
        OR: [
          { code },
          { packInstanceId: pack.id, status: { notIn: ["COMPLETE", "CANCELLED"] } },
        ],
      },
    });

    if (existing) {
      return res.status(409).json({ message: "An active kiosk session already exists for this pack" });
    }

    if (!muxCredentialsConfigured()) {
      return res.status(500).json({ message: "Mux credentials are not configured" });
    }

    const controlToken = generateControlToken();
    const countdownSeconds = payload.countdownSeconds ?? DEFAULT_COUNTDOWN;
    const liveSeconds = payload.liveSeconds ?? DEFAULT_LIVE;

    const session = await prisma.kioskSession.create({
      data: {
        code,
        controlTokenHash: hashControlToken(controlToken),
        packInstanceId: pack.id,
        locationId: payload.locationId ?? null,
        countdownSeconds,
        liveSeconds,
        countdownStartedAt: new Date(),
      },
      include: kioskSessionInclude,
    });

    try {
      const muxStream = await createMuxLiveStream({
        passthrough: session.id,
        livestreamName: pack.packDefinition?.name ?? `Pack ${pack.id}`,
      });

      const playbackId = muxStream.playback_ids?.[0]?.id ?? null;
      await prisma.kioskSession.update({
        where: { id: session.id },
        data: {
          muxStreamId: muxStream.id,
          muxStreamKey: muxStream.stream_key,
          muxPlaybackId: playbackId,
          videoUrl: playbackId ? buildMuxPlaybackUrl(playbackId) : session.videoUrl,
        },
      });

      const updatedSession = await prisma.kioskSession.findUnique({
        where: { id: session.id },
        include: kioskSessionInclude,
      });

      if (!updatedSession) {
        throw new Error("Failed to load kiosk session after Mux initialization");
      }

      return res.status(201).json({
        session: serializeKioskSession(updatedSession),
        controlToken,
      });
    } catch (error) {
      console.error("Kiosk start mux error", error);
      await prisma.kioskSession.delete({ where: { id: session.id } });
      return res.status(500).json({ message: "Failed to configure Mux live stream" });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("Kiosk start error", error);
    return res.status(500).json({ message: "Failed to start kiosk session" });
  }
}
