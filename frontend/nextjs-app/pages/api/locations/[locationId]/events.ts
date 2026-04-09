import type { NextApiRequest, NextApiResponse } from "next";
import { type LocationEventsResponse, type LocationEventSummary } from "../../../../lib/locationStatus";

const VENUE_MAP: Record<string, { venueId: string; name: string }> = {
  "sacramento-kings-golden-1-center": { venueId: "KovZpZAEF76A", name: "Golden 1 Center" },
  "sutter-health-park": { venueId: "KovZpZA7kl6A", name: "Sutter Health Park" },
  "dallas-stars-coamerica-center": { venueId: "KovZpZA6AEAA", name: "Comerica Center" },
};

type TicketmasterEventsResponse = {
  _embedded?: {
    events?: Array<{
      id?: string;
      name?: string;
      url?: string;
      dates?: {
        start?: {
          localDate?: string;
          localTime?: string;
        };
      };
      images?: Array<{
        ratio?: string;
        width?: number;
        url?: string;
      }>;
    }>;
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LocationEventsResponse | { error: string }>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : "";
  if (!locationId) {
    return res.status(400).json({ error: "locationId is required" });
  }

  const venue = VENUE_MAP[locationId];
  if (!venue) {
    return res.status(200).json({ events: [] });
  }

  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ events: [] });
  }

  try {
    const params = new URLSearchParams({
      apikey: apiKey,
      venueId: venue.venueId,
      size: "5",
      sort: "date,asc",
      startDateTime: new Date().toISOString().split(".")[0] + "Z",
      countryCode: "US",
    });

    const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`);
    if (!response.ok) {
      return res.status(200).json({ events: [] });
    }

    const payload = (await response.json()) as TicketmasterEventsResponse;
    const events: LocationEventSummary[] = (payload._embedded?.events ?? []).map((event) => ({
      id: event.id ?? `${venue.venueId}-${event.dates?.start?.localDate ?? "unknown"}`,
      name: event.name ?? venue.name,
      date: event.dates?.start?.localDate ?? null,
      time: event.dates?.start?.localTime ?? null,
      url: event.url ?? null,
      image:
        event.images?.find((image) => image.ratio === "16_9" && typeof image.width === "number" && image.width > 500)
          ?.url ??
        event.images?.[0]?.url ??
        null,
    }));

    return res.status(200).json({ events });
  } catch (error) {
    console.error("[locations/events] Ticketmaster API error", error);
    return res.status(200).json({ events: [] });
  }
}
