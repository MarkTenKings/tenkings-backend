import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import type { ComputeRouteResponse, DirectionStep } from "../../../lib/kingsHunt";

const GOOGLE_ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

const payloadSchema = z.object({
  originLat: z.number().finite(),
  originLng: z.number().finite(),
  destLat: z.number().finite().optional(),
  destLng: z.number().finite().optional(),
  destinationLat: z.number().finite().optional(),
  destinationLng: z.number().finite().optional(),
  locationSlug: z.string().min(1).optional(),
});

function parseDurationSeconds(value: unknown): number {
  if (typeof value === "string" && value.endsWith("s")) {
    const seconds = Number(value.slice(0, -1));
    return Number.isFinite(seconds) ? seconds : 0;
  }

  return 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ message: "Missing GOOGLE_MAPS_API_KEY" });
  }

  try {
    const payload = payloadSchema.parse(req.body ?? {});
    const destinationLat = payload.destLat ?? payload.destinationLat;
    const destinationLng = payload.destLng ?? payload.destinationLng;

    if (destinationLat == null || destinationLng == null) {
      return res.status(400).json({ message: "Destination coordinates are required" });
    }

    const response = await fetch(GOOGLE_ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "routes.duration",
          "routes.distanceMeters",
          "routes.polyline.encodedPolyline",
          "routes.legs.steps.navigationInstruction.instructions",
          "routes.legs.steps.distanceMeters",
          "routes.legs.steps.staticDuration",
          "routes.legs.steps.startLocation.latLng",
          "routes.legs.steps.endLocation.latLng",
          "routes.warnings",
        ].join(","),
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: payload.originLat,
              longitude: payload.originLng,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destinationLat,
              longitude: destinationLng,
            },
          },
        },
        travelMode: "WALK",
        computeAlternativeRoutes: false,
        polylineQuality: "HIGH_QUALITY",
        polylineEncoding: "ENCODED_POLYLINE",
        languageCode: "en-US",
        units: "IMPERIAL",
      }),
    });

    const rawPayload = (await response.json().catch(() => null)) as
      | {
          routes?: Array<{
            duration?: string;
            distanceMeters?: number;
            polyline?: { encodedPolyline?: string };
            warnings?: string[];
            legs?: Array<{
              steps?: Array<{
                navigationInstruction?: { instructions?: string };
                distanceMeters?: number;
                staticDuration?: string;
                startLocation?: { latLng?: { latitude?: number; longitude?: number } };
                endLocation?: { latLng?: { latitude?: number; longitude?: number } };
              }>;
            }>;
          }>;
          error?: { message?: string };
        }
      | null;

    if (!response.ok) {
      return res.status(502).json({
        message: rawPayload?.error?.message ?? "Failed to compute Google walking route",
      });
    }

    const route = rawPayload?.routes?.[0];
    if (!route?.polyline?.encodedPolyline) {
      return res.status(404).json({ message: "No walking route found" });
    }

    const steps: DirectionStep[] =
      route.legs?.[0]?.steps?.map((step) => ({
        instruction: step.navigationInstruction?.instructions ?? "",
        distanceM: step.distanceMeters ?? 0,
        durationSec: parseDurationSeconds(step.staticDuration),
        startLat: step.startLocation?.latLng?.latitude ?? 0,
        startLng: step.startLocation?.latLng?.longitude ?? 0,
        endLat: step.endLocation?.latLng?.latitude ?? 0,
        endLng: step.endLocation?.latLng?.longitude ?? 0,
      })) ?? [];

    const result: ComputeRouteResponse = {
      polyline: route.polyline.encodedPolyline,
      distanceM: route.distanceMeters ?? 0,
      durationSec: parseDurationSeconds(route.duration),
      steps,
      warnings: route.warnings ?? [],
    };

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid route request" });
    }

    console.error("kingshunt route failed", error);
    return res.status(500).json({ message: "Unable to compute walking route" });
  }
}
