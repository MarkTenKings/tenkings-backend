import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { type LocationLiveStatusResponse, isEventOnlyLocationType } from "../../../../lib/locationStatus";

const CACHE_TTL_MS = 60 * 60 * 1000;

const statusCache = new Map<string, { data: LocationLiveStatusResponse; fetchedAt: number }>();

type GooglePlacesSearchResponse = {
  places?: Array<{
    currentOpeningHours?: {
      openNow?: boolean;
      weekdayDescriptions?: string[];
    };
    regularOpeningHours?: {
      openNow?: boolean;
      weekdayDescriptions?: string[];
    };
  }>;
};

const EMPTY_STATUS: LocationLiveStatusResponse = {
  openNow: null,
  hours: null,
  isEventBased: false,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LocationLiveStatusResponse | { error: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : "";
  if (!locationId) {
    return res.status(400).json({ error: "locationId is required" });
  }

  const cached = statusCache.get(locationId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  const location = await prisma.location.findUnique({
    where: { slug: locationId },
    select: {
      name: true,
      address: true,
      locationType: true,
    },
  });

  if (!location) {
    return res.status(404).json({ error: "Not found" });
  }

  if (isEventOnlyLocationType(location.locationType)) {
    const eventBasedStatus: LocationLiveStatusResponse = {
      openNow: null,
      hours: null,
      isEventBased: true,
    };
    statusCache.set(locationId, { data: eventBasedStatus, fetchedAt: Date.now() });
    return res.status(200).json(eventBasedStatus);
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    statusCache.set(locationId, { data: EMPTY_STATUS, fetchedAt: Date.now() });
    return res.status(200).json(EMPTY_STATUS);
  }

  try {
    const searchResponse = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.currentOpeningHours,places.regularOpeningHours",
      },
      body: JSON.stringify({
        textQuery: `${location.name} ${location.address}`,
        maxResultCount: 1,
      }),
    });

    if (!searchResponse.ok) {
      statusCache.set(locationId, { data: EMPTY_STATUS, fetchedAt: Date.now() });
      return res.status(200).json(EMPTY_STATUS);
    }

    const searchData = (await searchResponse.json()) as GooglePlacesSearchResponse;
    const place = searchData.places?.[0];
    const openingHours = place?.currentOpeningHours ?? place?.regularOpeningHours ?? null;

    const result: LocationLiveStatusResponse = {
      openNow: typeof openingHours?.openNow === "boolean" ? openingHours.openNow : null,
      hours: Array.isArray(openingHours?.weekdayDescriptions) ? openingHours.weekdayDescriptions : null,
      isEventBased: false,
    };

    statusCache.set(locationId, { data: result, fetchedAt: Date.now() });
    return res.status(200).json(result);
  } catch (error) {
    console.error("[locations/live-status] Places API error", error);
    statusCache.set(locationId, { data: EMPTY_STATUS, fetchedAt: Date.now() });
    return res.status(200).json(EMPTY_STATUS);
  }
}
