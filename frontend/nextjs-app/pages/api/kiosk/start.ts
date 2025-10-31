import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { prisma, PackFulfillmentStatus, QrCodeType, KioskSessionStatus } from "@tenkings/database";
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

const startSchema = z
  .object({
    packCode: z.string().min(4).optional(),
    packId: z.string().uuid("packId must be a valid UUID").optional(),
    locationId: z.string().uuid().optional(),
    code: z.string().min(1).optional(),
    countdownSeconds: z.number().int().min(3).max(120).optional(),
    liveSeconds: z.number().int().min(10).max(300).optional(),
  })
  .refine((value) => Boolean(value.packCode || value.packId), {
    message: "Provide a packCode or packId",
    path: ["packCode"],
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
    const packCode = payload.packCode?.trim() ?? null;

    let packQr = null as { id: string; code: string; serial: string | null } | null;

    const pack = packCode
      ? await (async () => {
          const qr = await prisma.qrCode.findUnique({
            where: { code: packCode },
            include: {
              packInstance: {
                include: {
                  packDefinition: true,
                  packQrCode: true,
                },
              },
            },
          });

          if (!qr || qr.type !== QrCodeType.PACK) {
            return null;
          }

          if (!qr.packInstance) {
            return null;
          }

          packQr = { id: qr.id, code: qr.code, serial: qr.serial };
          return qr.packInstance;
        })()
      : await prisma.packInstance.findUnique({
          where: { id: payload.packId! },
          include: {
            packDefinition: true,
            packQrCode: true,
          },
        });

    if (!pack) {
      return res.status(404).json({ message: "Pack not found" });
    }

    if (!packQr && pack.packQrCode) {
      packQr = { id: pack.packQrCode.id, code: pack.packQrCode.code, serial: pack.packQrCode.serial };
    }

    if (!packQr) {
      return res.status(400).json({ message: "Pack has not been labeled" });
    }

    if (pack.status !== "UNOPENED") {
      return res.status(400).json({ message: "Pack has already been opened" });
    }

    if (
      pack.fulfillmentStatus !== PackFulfillmentStatus.PACKED &&
      pack.fulfillmentStatus !== PackFulfillmentStatus.LOADED
    ) {
      return res.status(409).json({ message: "Pack is not ready for kiosk use" });
    }

    const effectiveLocationId = payload.locationId ?? pack.locationId ?? null;

    if (!effectiveLocationId) {
      return res.status(400).json({ message: "Pack is not assigned to a location" });
    }

    if (pack.locationId && payload.locationId && pack.locationId !== payload.locationId) {
      return res.status(409).json({ message: "Pack is allocated to a different location" });
    }

    const sessionCode = payload.code?.trim() || packQr.code;

    const conflictConditions: Prisma.KioskSessionWhereInput[] = [
      { code: sessionCode },
      { packInstanceId: pack.id, status: { notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED] } },
      { packQrCodeId: packQr.id, status: { notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED] } },
    ];

    const existing = await prisma.kioskSession.findFirst({
      where: {
        OR: conflictConditions,
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
    const timestamp = new Date();

    const session = await prisma.$transaction(async (tx) => {
      if (pack.locationId !== effectiveLocationId) {
        await tx.packInstance.update({ where: { id: pack.id }, data: { locationId: effectiveLocationId } });
      }

      if (pack.fulfillmentStatus !== PackFulfillmentStatus.LOADED || !pack.loadedAt) {
        await tx.packInstance.update({
          where: { id: pack.id },
          data: {
            fulfillmentStatus: PackFulfillmentStatus.LOADED,
            loadedAt: pack.loadedAt ?? timestamp,
          },
        });
      }

      return tx.kioskSession.create({
        data: {
          code: sessionCode,
          controlTokenHash: hashControlToken(controlToken),
          packInstanceId: pack.id,
          packQrCodeId: packQr?.id ?? null,
          locationId: effectiveLocationId,
          countdownSeconds,
          liveSeconds,
          countdownStartedAt: timestamp,
        },
        include: kioskSessionInclude,
      });
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
