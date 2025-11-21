import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import { prisma, PackFulfillmentStatus, QrCodeType, KioskSessionStatus } from "@tenkings/database";
import { z } from "zod";
import { generateControlToken, hashControlToken, ensureKioskSecret } from "../../../lib/server/kioskAuth";
import { kioskSessionInclude, serializeKioskSession } from "../../../lib/server/kioskSession";
import {
  buildMuxPlaybackUrl,
  createMuxLiveStream,
  getMuxSimulcastTargets,
  muxCredentialsConfigured,
  updateMuxLiveStream,
} from "../../../lib/server/mux";
import { normalizeQrInput } from "../../../lib/qrInput";
import { syncPackAssetsLocation } from "../../../lib/server/qrCodes";

const DEFAULT_COUNTDOWN = Number(process.env.KIOSK_COUNTDOWN_SECONDS ?? 10);
const DEFAULT_LIVE = Number(process.env.KIOSK_LIVE_SECONDS ?? 30);
const DEFAULT_REVEAL = Number(process.env.KIOSK_REVEAL_SECONDS ?? 10);
const SESSION_RECOVERY_TIMEOUT_MS = Number(process.env.KIOSK_SESSION_RECOVERY_TIMEOUT_MS ?? 3 * 60 * 1000);

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
    const packCode = normalizeQrInput(payload.packCode);

    let packQr = null as { id: string; code: string; serial: string | null; resetVersion: number } | null;

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

          packQr = { id: qr.id, code: qr.code, serial: qr.serial, resetVersion: qr.resetVersion ?? 0 };
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
      packQr = {
        id: pack.packQrCode.id,
        code: pack.packQrCode.code,
        serial: pack.packQrCode.serial,
        resetVersion: pack.packQrCode.resetVersion ?? 0,
      };
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
    const packResetVersion = packQr.resetVersion ?? 0;

    const conflictConditions: Prisma.KioskSessionWhereInput[] = [
      { code: sessionCode, status: { notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED] } },
      { packInstanceId: pack.id, status: { notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED] } },
      {
        packQrCodeId: packQr.id,
        status: {
          notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED],
        },
      },
    ];

    await autoCancelStaleSessions(conflictConditions);

    const existing = await prisma.kioskSession.findFirst({
      where: {
        OR: conflictConditions,
        status: {
          notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED],
        },
      },
    });

    if (existing) {
      return res.status(409).json({ message: "An active kiosk session already exists for this pack" });
    }

    if (!muxCredentialsConfigured()) {
      return res.status(500).json({ message: "Mux credentials are not configured" });
    }

    const locationRecord = await prisma.location.findUnique({
      where: { id: effectiveLocationId },
      select: {
        id: true,
        name: true,
        muxStreamId: true,
        muxStreamKey: true,
        muxPlaybackId: true,
      },
    });

    if (!locationRecord) {
      return res.status(404).json({ message: "Location not found" });
    }

    let locationMuxStreamId = locationRecord.muxStreamId ?? null;
    let locationMuxStreamKey = locationRecord.muxStreamKey ?? null;
    let locationMuxPlaybackId = locationRecord.muxPlaybackId ?? null;
    let locationMuxDirty = false;

    if (!locationMuxStreamId || !locationMuxStreamKey) {
      try {
        const muxStream = await createMuxLiveStream({
          passthrough: `location:${effectiveLocationId}`,
          livestreamName: locationRecord.name,
          simulcastTargets: getMuxSimulcastTargets(),
        });
        locationMuxStreamId = muxStream.id;
        locationMuxStreamKey = muxStream.stream_key;
        locationMuxPlaybackId = muxStream.playback_ids?.[0]?.id ?? null;
        locationMuxDirty = true;
      } catch (error) {
        console.error("Kiosk start mux provisioning error", error);
        return res.status(500).json({ message: "Failed to provision Mux live stream" });
      }
    }

    if (!locationMuxStreamId || !locationMuxStreamKey) {
      return res.status(500).json({ message: "Mux stream is unavailable for this location" });
    }

    const controlToken = generateControlToken();
    const countdownSeconds = payload.countdownSeconds ?? DEFAULT_COUNTDOWN;
    const liveSeconds = payload.liveSeconds ?? DEFAULT_LIVE;
    const revealSeconds = DEFAULT_REVEAL;
    const timestamp = new Date();
    const playbackUrl = locationMuxPlaybackId ? buildMuxPlaybackUrl(locationMuxPlaybackId) : null;

    const session = await prisma.$transaction(async (tx) => {
      if (pack.fulfillmentStatus !== PackFulfillmentStatus.LOADED || !pack.loadedAt) {
        await tx.packInstance.update({
          where: { id: pack.id },
          data: {
            fulfillmentStatus: PackFulfillmentStatus.LOADED,
            loadedAt: pack.loadedAt ?? timestamp,
          },
        });
      }

      const labelRecord = packQr
        ? await tx.packLabel.findFirst({
            where: { packQrCodeId: packQr.id },
            select: { id: true, cardQrCodeId: true, packQrCodeId: true },
          })
        : null;

      await syncPackAssetsLocation(tx, {
        packInstanceId: pack.id,
        packLabelId: labelRecord?.id ?? null,
        cardQrCodeId: labelRecord?.cardQrCodeId ?? null,
        packQrCodeId: packQr?.id ?? pack.packQrCode?.id ?? null,
        locationId: effectiveLocationId,
      });

      if (locationMuxDirty) {
        await tx.location.update({
          where: { id: effectiveLocationId },
          data: {
            muxStreamId: locationMuxStreamId,
            muxStreamKey: locationMuxStreamKey,
            muxPlaybackId: locationMuxPlaybackId,
          },
        });
      }

      return tx.kioskSession.create({
        data: {
          code: sessionCode,
          controlTokenHash: hashControlToken(controlToken),
          packInstanceId: pack.id,
          packQrCodeId: packQr?.id ?? null,
          packResetVersion,
          packQrCodeSerial: packQr?.serial ?? packQr?.code ?? null,
          locationId: effectiveLocationId,
          countdownSeconds,
          liveSeconds,
          countdownStartedAt: timestamp,
          revealSeconds,
          muxStreamId: locationMuxStreamId,
          muxStreamKey: locationMuxStreamKey,
          muxPlaybackId: locationMuxPlaybackId,
          videoUrl: playbackUrl,
        },
        include: kioskSessionInclude,
      });
    });

    const updatedSession = await prisma.kioskSession.findUnique({
      where: { id: session.id },
      include: kioskSessionInclude,
    });

    if (!updatedSession) {
      return res.status(500).json({ message: "Failed to prepare kiosk session" });
    }

    if (updatedSession.muxStreamId) {
      const passthrough = `session:${updatedSession.id}`;
      updateMuxLiveStream(updatedSession.muxStreamId, {
        passthrough,
        assetPassthrough: passthrough,
      }).catch((error) => {
        console.warn("Kiosk start mux passthrough update failed", error);
      });
    }

    return res.status(201).json({
      session: serializeKioskSession(updatedSession),
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

async function autoCancelStaleSessions(conflictConditions: Prisma.KioskSessionWhereInput[]) {
  if (!SESSION_RECOVERY_TIMEOUT_MS || conflictConditions.length === 0) {
    return;
  }

  const candidates = await prisma.kioskSession.findMany({
    where: {
      OR: conflictConditions,
      status: {
        notIn: [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED],
      },
    },
    select: {
      id: true,
      countdownStartedAt: true,
    },
  });

  if (candidates.length === 0) {
    return;
  }

  const now = Date.now();
  const staleSessions = candidates.filter((session) => now - session.countdownStartedAt.getTime() > SESSION_RECOVERY_TIMEOUT_MS);

  await Promise.all(
    staleSessions.map((session) =>
      prisma.kioskSession
        .update({
          where: { id: session.id },
          data: {
            status: KioskSessionStatus.CANCELLED,
            completedAt: new Date(),
          },
        })
        .then(() => console.warn(`[kiosk-start] Auto-cancelled stale session ${session.id}`))
    )
  );
}
