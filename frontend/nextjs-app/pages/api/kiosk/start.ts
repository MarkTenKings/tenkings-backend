import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma, PackFulfillmentStatus, QrCodeType, KioskSessionStatus } from "@tenkings/database";
import { z } from "zod";
import { ONLINE_LOCATION_NAME, ONLINE_LOCATION_SLUG } from "../../../lib/adminInventory";
import { normalizeQrInput } from "../../../lib/qrInput";
import { syncPackAssetsLocation } from "../../../lib/server/qrCodes";
import {
  buildMuxPlaybackUrl,
  buildMuxWhipUploadUrl,
  createMuxLiveStream,
  getMuxSimulcastTargets,
  muxCredentialsConfigured,
  updateMuxLiveStream,
} from "../../../lib/server/mux";
import { kioskSessionInclude, serializeKioskSession } from "../../../lib/server/kioskSession";
import { ensureKioskSecret, generateControlToken, hashControlToken } from "../../../lib/server/kioskAuth";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";

const DEFAULT_COUNTDOWN = Number(process.env.KIOSK_COUNTDOWN_SECONDS ?? 10);
const DEFAULT_LIVE = Number(process.env.KIOSK_LIVE_SECONDS ?? 30);
const DEFAULT_REVEAL = Number(process.env.KIOSK_REVEAL_SECONDS ?? 10);
const SESSION_RECOVERY_TIMEOUT_MS = Number(process.env.KIOSK_SESSION_RECOVERY_TIMEOUT_MS ?? 3 * 60 * 1000);
const BROWSER_BUSY_RETRY_SECONDS = Number(process.env.GOLDEN_TICKET_BUSY_RETRY_SECONDS ?? 20);

const TERMINAL_SESSION_STATUSES: KioskSessionStatus[] = [KioskSessionStatus.COMPLETE, KioskSessionStatus.CANCELLED];

const startSchema = z
  .object({
    packCode: z.string().min(4).optional(),
    packId: z.string().uuid("packId must be a valid UUID").optional(),
    locationId: z.string().uuid().optional(),
    code: z.string().min(1).optional(),
    countdownSeconds: z.number().int().min(3).max(120).optional(),
    liveSeconds: z.number().int().min(10).max(300).optional(),
    ingestMode: z.enum(["OBS", "BROWSER"]).optional(),
    goldenTicketCode: z.string().min(4).optional(),
  })
  .superRefine((value, ctx) => {
    const ingestMode = value.ingestMode ?? "OBS";
    if (ingestMode === "OBS" && !value.packCode && !value.packId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide a packCode or packId",
        path: ["packCode"],
      });
    }
  });

type StartPayload = z.infer<typeof startSchema>;

type PackQrSummary = {
  id: string;
  code: string;
  serial: string | null;
  resetVersion: number;
};

type LocationStreamState = {
  locationRecord: {
    id: string;
    name: string;
    slug: string;
    muxStreamId: string | null;
    muxStreamKey: string | null;
    muxPlaybackId: string | null;
  };
  locationMuxStreamId: string;
  locationMuxStreamKey: string;
  locationMuxPlaybackId: string | null;
  locationMuxDirty: boolean;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const payload = startSchema.parse(req.body ?? {});
    const ingestMode = payload.ingestMode ?? "OBS";

    if (ingestMode === "BROWSER") {
      return await handleBrowserStart(req, res, payload);
    }

    if (!ensureKioskSecret(req)) {
      return res.status(401).json({ message: "Invalid kiosk secret" });
    }

    return await handleObsStart(res, payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("Kiosk start error", error);
    return res.status(500).json({ message: "Failed to start kiosk session" });
  }
}

async function handleObsStart(res: NextApiResponse, payload: StartPayload) {
  const packCode = normalizeQrInput(payload.packCode);

  let packQr = null as PackQrSummary | null;

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
    { code: sessionCode, status: { notIn: TERMINAL_SESSION_STATUSES } },
    { packInstanceId: pack.id, status: { notIn: TERMINAL_SESSION_STATUSES } },
    {
      packQrCodeId: packQr.id,
      status: { notIn: TERMINAL_SESSION_STATUSES },
    },
  ];

  await autoCancelStaleSessions(conflictConditions);

  const existing = await prisma.kioskSession.findFirst({
    where: {
      OR: conflictConditions,
      status: {
        notIn: TERMINAL_SESSION_STATUSES,
      },
    },
  });

  if (existing) {
    return res.status(409).json({ message: "An active kiosk session already exists for this pack" });
  }

  if (!muxCredentialsConfigured()) {
    return res.status(500).json({ message: "Mux credentials are not configured" });
  }

  let muxState: LocationStreamState | null = null;
  try {
    muxState = await ensureLocationMuxStream(effectiveLocationId);
  } catch (error) {
    console.error("Kiosk start mux provisioning error", error);
    return res.status(500).json({ message: "Failed to provision Mux live stream" });
  }

  if (!muxState) {
    return res.status(404).json({ message: "Location not found" });
  }

  const { locationMuxDirty, locationMuxPlaybackId, locationMuxStreamId, locationMuxStreamKey } = muxState;
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
          select: { id: true, itemId: true, cardQrCodeId: true, packQrCodeId: true },
        })
      : null;

    await syncPackAssetsLocation(tx, {
      packInstanceId: pack.id,
      itemId: labelRecord?.itemId ?? null,
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

  applySessionMuxPassthrough(updatedSession.id, updatedSession.muxStreamId);

  return res.status(201).json({
    session: serializeKioskSession(updatedSession),
    controlToken,
  });
}

async function handleBrowserStart(req: NextApiRequest, res: NextApiResponse, payload: StartPayload) {
  const userSession = await (async () => {
    try {
      return await requireUserSession(req);
    } catch (error) {
      const response = toUserErrorResponse(error);
      res.status(response.status).json({ message: response.message });
      return null;
    }
  })();

  if (!userSession) {
    return;
  }

  const normalizedGoldenTicketCode = normalizeQrInput(payload.goldenTicketCode);
  const goldenTicket = normalizedGoldenTicketCode
    ? await prisma.goldenTicket.findUnique({
        where: { code: normalizedGoldenTicketCode },
        select: {
          id: true,
          code: true,
          status: true,
          scannedByUserId: true,
          qrCode: {
            select: {
              id: true,
              type: true,
            },
          },
        },
      })
    : null;

  if (normalizedGoldenTicketCode && !goldenTicket) {
    return res.status(404).json({ message: "Golden ticket not found" });
  }

  if (goldenTicket && goldenTicket.qrCode.type !== QrCodeType.GOLDEN_TICKET) {
    return res.status(400).json({ message: "Golden ticket QR code is invalid" });
  }

  if (goldenTicket?.status === "CLAIMED" || goldenTicket?.status === "FULFILLED" || goldenTicket?.status === "EXPIRED") {
    return res.status(409).json({ message: "Golden ticket is not available for browser reveal" });
  }

  if (
    goldenTicket?.status === "SCANNED" &&
    goldenTicket.scannedByUserId &&
    goldenTicket.scannedByUserId !== userSession.user.id
  ) {
    return res.status(409).json({ message: "Golden ticket is already being claimed by another user" });
  }

  const onlineLocation = await resolveOnlineLocation();

  if (!onlineLocation) {
    return res.status(404).json({ message: "Online location not found" });
  }

  const browserConflictConditions: Prisma.KioskSessionWhereInput[] = [
    {
      locationId: onlineLocation.id,
      ingestMode: "BROWSER",
      status: { notIn: TERMINAL_SESSION_STATUSES },
    },
  ];

  if (goldenTicket) {
    browserConflictConditions.push({
      goldenTicketId: goldenTicket.id,
      status: { notIn: TERMINAL_SESSION_STATUSES },
    });
  }

  await autoCancelStaleSessions(browserConflictConditions);

  const activeBrowserSession = await prisma.kioskSession.findFirst({
    where: {
      OR: browserConflictConditions,
      status: {
        notIn: TERMINAL_SESSION_STATUSES,
      },
    },
    orderBy: { countdownStartedAt: "desc" },
  });

  if (activeBrowserSession) {
    return res.status(409).json({
      error: "ONLINE_STREAM_BUSY",
      retryAfterSeconds: BROWSER_BUSY_RETRY_SECONDS,
    });
  }

  if (!muxCredentialsConfigured()) {
    return res.status(500).json({ message: "Mux credentials are not configured" });
  }

  let muxState: LocationStreamState | null = null;
  try {
    muxState = await ensureLocationMuxStream(onlineLocation.id);
  } catch (error) {
    console.error("Browser kiosk start mux provisioning error", error);
    return res.status(500).json({ message: "Failed to provision Mux live stream" });
  }

  if (!muxState) {
    return res.status(404).json({ message: "Online location not found" });
  }

  const { locationMuxDirty, locationMuxPlaybackId, locationMuxStreamId, locationMuxStreamKey } = muxState;
  const controlToken = generateControlToken();
  const countdownSeconds = payload.countdownSeconds ?? DEFAULT_COUNTDOWN;
  const liveSeconds = payload.liveSeconds ?? DEFAULT_LIVE;
  const revealSeconds = DEFAULT_REVEAL;
  const timestamp = new Date();
  const playbackUrl = locationMuxPlaybackId ? buildMuxPlaybackUrl(locationMuxPlaybackId) : null;
  const whipUploadUrl = buildMuxWhipUploadUrl(locationMuxStreamKey);
  const sessionCode = payload.code?.trim() || goldenTicket?.code || `browser-${controlToken.split("-")[0]}`;

  try {
    const session = await prisma.$transaction(async (tx) => {
      if (locationMuxDirty) {
        await tx.location.update({
          where: { id: onlineLocation.id },
          data: {
            muxStreamId: locationMuxStreamId,
            muxStreamKey: locationMuxStreamKey,
            muxPlaybackId: locationMuxPlaybackId,
          },
        });
      }

      if (goldenTicket) {
        await tx.goldenTicket.update({
          where: { id: goldenTicket.id },
          data: {
            status: "SCANNED",
            scannedAt: timestamp,
            scannedByUserId: userSession.user.id,
          },
        });
      }

      return tx.kioskSession.create({
        data: {
          code: sessionCode,
          controlTokenHash: hashControlToken(controlToken),
          userId: userSession.user.id,
          locationId: onlineLocation.id,
          countdownSeconds,
          liveSeconds,
          revealSeconds,
          countdownStartedAt: timestamp,
          ingestMode: "BROWSER",
          whipUploadUrl,
          isGoldenTicket: Boolean(goldenTicket),
          goldenTicketId: goldenTicket?.id ?? null,
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
      return res.status(500).json({ message: "Failed to prepare browser kiosk session" });
    }

    applySessionMuxPassthrough(updatedSession.id, updatedSession.muxStreamId);

    return res.status(201).json({
      session: serializeKioskSession(updatedSession),
      controlToken,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({ message: "Browser kiosk session already exists for this ticket or code" });
    }
    console.error("Browser kiosk start error", error);
    return res.status(500).json({ message: "Failed to start browser kiosk session" });
  }
}

async function ensureLocationMuxStream(locationId: string): Promise<LocationStreamState | null> {
  const locationRecord = await prisma.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      slug: true,
      muxStreamId: true,
      muxStreamKey: true,
      muxPlaybackId: true,
    },
  });

  if (!locationRecord) {
    return null;
  }

  let locationMuxStreamId = locationRecord.muxStreamId ?? null;
  let locationMuxStreamKey = locationRecord.muxStreamKey ?? null;
  let locationMuxPlaybackId = locationRecord.muxPlaybackId ?? null;
  let locationMuxDirty = false;

  if (!locationMuxStreamId || !locationMuxStreamKey) {
    const muxStream = await createMuxLiveStream({
      passthrough: `location:${locationId}`,
      livestreamName: locationRecord.name,
      simulcastTargets: getMuxSimulcastTargets(),
    });
    locationMuxStreamId = muxStream.id;
    locationMuxStreamKey = muxStream.stream_key;
    locationMuxPlaybackId = muxStream.playback_ids?.[0]?.id ?? null;
    locationMuxDirty = true;
  }

  if (!locationMuxStreamId || !locationMuxStreamKey) {
    throw new Error("Mux stream is unavailable for this location");
  }

  return {
    locationRecord,
    locationMuxStreamId,
    locationMuxStreamKey,
    locationMuxPlaybackId,
    locationMuxDirty,
  };
}

async function resolveOnlineLocation() {
  const explicitOnlineLocationId = process.env.GOLDEN_TICKET_ONLINE_LOCATION_ID?.trim();
  if (explicitOnlineLocationId) {
    return prisma.location.findUnique({
      where: { id: explicitOnlineLocationId },
      select: {
        id: true,
        name: true,
        slug: true,
        muxStreamId: true,
        muxStreamKey: true,
        muxPlaybackId: true,
      },
    });
  }

  return prisma.location.findFirst({
    where: {
      OR: [
        { slug: ONLINE_LOCATION_SLUG },
        { name: ONLINE_LOCATION_NAME },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      muxStreamId: true,
      muxStreamKey: true,
      muxPlaybackId: true,
    },
  });
}

function applySessionMuxPassthrough(sessionId: string, muxStreamId: string | null) {
  if (!muxStreamId) {
    return;
  }

  const passthrough = `session:${sessionId}`;
  updateMuxLiveStream(muxStreamId, {
    passthrough,
    assetPassthrough: passthrough,
  }).catch((error) => {
    console.warn("Kiosk start mux passthrough update failed", error);
  });
}

async function autoCancelStaleSessions(conflictConditions: Prisma.KioskSessionWhereInput[]) {
  if (!SESSION_RECOVERY_TIMEOUT_MS || conflictConditions.length === 0) {
    return;
  }

  const candidates = await prisma.kioskSession.findMany({
    where: {
      OR: conflictConditions,
      status: {
        notIn: TERMINAL_SESSION_STATUSES,
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
