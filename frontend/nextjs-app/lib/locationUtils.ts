import { haversineDistance as computeHaversineDistance } from "./geo";

export const ONLINE_LOCATION_SLUG = "online-collect-tenkings-co";
export const NEARBY_DISTANCE_M = 1609;

export type OpenStatus = "open" | "closed" | "event_only" | "unknown";

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return computeHaversineDistance(lat1, lng1, lat2, lng2);
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (miles < 0.1) {
    return "You're here";
  }
  if (miles < 10) {
    return `${miles.toFixed(1)} mi`;
  }
  return `${Math.round(miles)} mi`;
}

export function formatTimeAgo(dateStr: string): string {
  const timestamp = new Date(dateStr);
  if (Number.isNaN(timestamp.getTime())) {
    return "";
  }

  const diffMs = Date.now() - timestamp.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)} weeks ago`;
  }
  return `${Math.floor(diffDays / 30)} months ago`;
}

function parseHourValue(rawHour: string, ampm: string): number {
  const [hourPart, minutePart = "0"] = rawHour.split(":");
  let hour = parseInt(hourPart ?? "0", 10);
  const minute = parseInt(minutePart ?? "0", 10);

  if (ampm === "pm" && hour !== 12) {
    hour += 12;
  }
  if (ampm === "am" && hour === 12) {
    hour = 0;
  }

  return hour + minute / 60;
}

function isCurrentDayInRange(startDay: string, endDay: string | undefined, currentDay: number) {
  const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const startIdx = dayNames.indexOf(startDay.slice(0, 3));
  const endIdx = endDay ? dayNames.indexOf(endDay.slice(0, 3)) : startIdx;

  if (startIdx === -1) {
    return false;
  }

  const effectiveEndIdx = endIdx === -1 ? startIdx : endIdx;
  return effectiveEndIdx >= startIdx
    ? currentDay >= startIdx && currentDay <= effectiveEndIdx
    : currentDay >= startIdx || currentDay <= effectiveEndIdx;
}

export function parseOpenStatus(hours: string | null, locationType: string | null): OpenStatus {
  if (locationType === "arena" || locationType === "stadium") {
    return "event_only";
  }
  if (!hours) {
    return "unknown";
  }

  const lowerHours = hours
    .toLowerCase()
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (lowerHours.includes("event")) {
    return "event_only";
  }
  if (lowerHours.includes("24/7") || lowerHours.includes("open 24 hours")) {
    return "open";
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  try {
    const normalized = lowerHours.replace(/\|/g, ",");
    const segments = normalized
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (const segment of segments) {
      const dayOnlyMatch = segment.match(/^([a-z]+)(?:\s*-\s*([a-z]+))?:?\s+(.+)$/i);
      if (dayOnlyMatch) {
        const [, startDay, endDay, dayHours] = dayOnlyMatch;
        if (isCurrentDayInRange(startDay, endDay, currentDay)) {
          if (dayHours.includes("closed")) {
            return "closed";
          }
          if (dayHours.includes("open 24 hours") || dayHours.includes("24 hours")) {
            return "open";
          }
        }
      }

      const match = segment.match(
        /^([a-z]+)(?:\s*-\s*([a-z]+))?:?\s+(\d+(?::\d+)?)\s*(am|pm)\s*[-–—]\s*(\d+(?::\d+)?)\s*(am|pm)$/i,
      );

      if (!match) {
        continue;
      }

      const [, startDay, endDay, openHour, openAmPm, closeHour, closeAmPm] = match;
      if (!isCurrentDayInRange(startDay, endDay, currentDay)) {
        continue;
      }

      const openTime = parseHourValue(openHour, openAmPm.toLowerCase());
      const closeTime = parseHourValue(closeHour, closeAmPm.toLowerCase());

      if (openTime <= closeTime) {
        return currentHour >= openTime && currentHour < closeTime ? "open" : "closed";
      }

      return currentHour >= openTime || currentHour < closeTime ? "open" : "closed";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}
