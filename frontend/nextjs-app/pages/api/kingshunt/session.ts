import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { computeDistanceToMachine } from "../../../lib/server/kingsHunt";
import { checkGeofence } from "../../../lib/geo";

const payloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  entryMethod: z.string().min(1).optional(),
  qrCodeId: z.string().min(1).nullable().optional(),
  visitorId: z.string().min(1).optional(),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  checkpointsReached: z.number().int().min(0).optional(),
  journeyStartedAt: z.string().datetime().optional(),
  journeyCompletedAt: z.string().datetime().optional(),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const payload = payloadSchema.parse(req.body ?? {});

    if (payload.sessionId) {
      const existingSession = await prisma.navigationSession.findUnique({
        where: { id: payload.sessionId },
        include: {
          location: true,
        },
      });

      if (!existingSession) {
        return res.status(404).json({ message: "Navigation session not found" });
      }

      const geofence =
        typeof payload.lat === "number" && typeof payload.lng === "number"
          ? checkGeofence(existingSession.location, { lat: payload.lat, lng: payload.lng })
          : null;

      const session = await prisma.navigationSession.update({
        where: { id: payload.sessionId },
        data: {
          userLat: payload.lat,
          userLng: payload.lng,
          isAtVenue: geofence?.isInside ?? existingSession.isAtVenue,
          distanceToMachineM:
            typeof payload.lat === "number" && typeof payload.lng === "number"
              ? computeDistanceToMachine(existingSession.location, payload.lat, payload.lng)
              : existingSession.distanceToMachineM,
          checkpointsReached: payload.checkpointsReached,
          tkdEarned: 0,
          journeyStartedAt: payload.journeyStartedAt ? new Date(payload.journeyStartedAt) : existingSession.journeyStartedAt,
          journeyCompletedAt: payload.journeyCompletedAt ? new Date(payload.journeyCompletedAt) : existingSession.journeyCompletedAt,
        },
      });

      return res.status(200).json({
        sessionId: session.id,
        checkpointsReached: session.checkpointsReached,
        journeyCompletedAt: session.journeyCompletedAt?.toISOString() ?? null,
      });
    }

    if (!payload.locationId || !payload.entryMethod) {
      return res.status(400).json({ message: "locationId and entryMethod are required" });
    }

    const location = await prisma.location.findUnique({
      where: { id: payload.locationId },
    });

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    const geofence =
      typeof payload.lat === "number" && typeof payload.lng === "number"
        ? checkGeofence(location, { lat: payload.lat, lng: payload.lng })
        : null;

    const session = await prisma.navigationSession.create({
      data: {
        locationId: payload.locationId,
        entryMethod: payload.entryMethod,
        qrCodeId: payload.qrCodeId ?? null,
        userLat: payload.lat ?? null,
        userLng: payload.lng ?? null,
        isAtVenue: geofence?.isInside ?? false,
        distanceToMachineM:
          typeof payload.lat === "number" && typeof payload.lng === "number"
            ? computeDistanceToMachine(location, payload.lat, payload.lng)
            : null,
        checkpointsReached: payload.checkpointsReached ?? 0,
        tkdEarned: 0,
        journeyStartedAt: payload.journeyStartedAt ? new Date(payload.journeyStartedAt) : null,
        journeyCompletedAt: payload.journeyCompletedAt ? new Date(payload.journeyCompletedAt) : null,
        userAgent: req.headers["user-agent"] ?? null,
        referrer: req.headers.referer ?? null,
      },
    });

    await prisma.locationVisit.create({
      data: {
        locationId: payload.locationId,
        source:
          payload.qrCodeId != null
            ? "qr"
            : payload.entryMethod.includes("gps")
              ? "gps"
              : "manual",
        navigationSessionId: session.id,
      },
    });

    return res.status(200).json({
      sessionId: session.id,
      checkpointsReached: session.checkpointsReached,
      journeyCompletedAt: session.journeyCompletedAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid session payload" });
    }

    console.error("kingshunt session failed", error);
    return res.status(500).json({ message: "Unable to save navigation session" });
  }
}
