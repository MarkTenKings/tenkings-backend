import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { computeDistanceToMachine, computeIsAtVenue, kingsHuntLocationSelect } from "../../../lib/server/kingsHunt";

const payloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  entryMethod: z.string().min(1).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  qrCodeId: z.string().min(1).optional().nullable(),
  journeyStartedAt: z.string().datetime().optional(),
  journeyCompletedAt: z.string().datetime().optional(),
  checkpointsReached: z.number().int().min(0).optional(),
  tkdEarned: z.number().int().min(0).optional(),
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
          location: {
            select: kingsHuntLocationSelect,
          },
        },
      });

      if (!existingSession) {
        return res.status(404).json({ message: "Navigation session not found" });
      }

      const nextLat = payload.lat ?? undefined;
      const nextLng = payload.lng ?? undefined;
      const distanceToMachineM =
        typeof nextLat === "number" && typeof nextLng === "number"
          ? computeDistanceToMachine(existingSession.location, nextLat, nextLng)
          : undefined;
      const isAtVenue =
        typeof nextLat === "number" && typeof nextLng === "number"
          ? computeIsAtVenue(existingSession.location, nextLat, nextLng)
          : undefined;

      const session = await prisma.navigationSession.update({
        where: { id: payload.sessionId },
        data: {
          userLat: nextLat,
          userLng: nextLng,
          isAtVenue,
          distanceToMachineM,
          journeyStartedAt: payload.journeyStartedAt ? new Date(payload.journeyStartedAt) : undefined,
          journeyCompletedAt: payload.journeyCompletedAt ? new Date(payload.journeyCompletedAt) : undefined,
          checkpointsReached: payload.checkpointsReached,
          tkdEarned: payload.tkdEarned,
        },
      });

      return res.status(200).json({ sessionId: session.id });
    }

    if (!payload.locationId || !payload.entryMethod) {
      return res.status(400).json({ message: "locationId and entryMethod are required" });
    }

    const location = await prisma.location.findUnique({
      where: { id: payload.locationId },
      select: kingsHuntLocationSelect,
    });

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    const hasCoordinates = typeof payload.lat === "number" && typeof payload.lng === "number";
    const session = await prisma.navigationSession.create({
      data: {
        locationId: payload.locationId,
        entryMethod: payload.entryMethod,
        userLat: payload.lat ?? null,
        userLng: payload.lng ?? null,
        isAtVenue: hasCoordinates ? computeIsAtVenue(location, payload.lat!, payload.lng!) : false,
        distanceToMachineM: hasCoordinates ? computeDistanceToMachine(location, payload.lat!, payload.lng!) : null,
        qrCodeId: payload.qrCodeId ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        referrer: req.headers.referer ?? null,
        journeyStartedAt: payload.journeyStartedAt ? new Date(payload.journeyStartedAt) : null,
        journeyCompletedAt: payload.journeyCompletedAt ? new Date(payload.journeyCompletedAt) : null,
        checkpointsReached: payload.checkpointsReached ?? 0,
        tkdEarned: payload.tkdEarned ?? 0,
      },
    });

    return res.status(200).json({ sessionId: session.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid session payload" });
    }

    console.error("kingshunt session failed", error);
    return res.status(500).json({ message: "Unable to save navigation session" });
  }
}
