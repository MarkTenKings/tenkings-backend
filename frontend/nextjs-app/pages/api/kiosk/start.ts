import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { generateControlToken, hashControlToken, ensureKioskSecret } from "../../../lib/server/kioskAuth";
import { kioskSessionInclude, serializeKioskSession } from "../../../lib/server/kioskSession";

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

    return res.status(201).json({
      session: serializeKioskSession(session),
      controlToken,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("Kiosk start error", error);
    return res.status(500).json({ message: "Failed to start kiosk session" });
  }
}
