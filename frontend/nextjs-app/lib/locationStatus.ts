export const LOCATION_STATUS_VALUES = ["active", "coming_soon", "offline"] as const;
export type LocationStatusValue = (typeof LOCATION_STATUS_VALUES)[number];

export type LocationLiveStatusResponse = {
  openNow: boolean | null;
  hours: string[] | null;
  isEventBased: boolean;
};

export type LocationEventSummary = {
  id: string;
  name: string;
  date: string | null;
  time: string | null;
  url: string | null;
  image: string | null;
};

export type LocationEventsResponse = {
  events: LocationEventSummary[];
};

export function isComingSoonLocation(status: string | null | undefined): boolean {
  return status === "coming_soon";
}

export function isEventOnlyLocationType(locationType: string | null | undefined): boolean {
  return locationType === "arena" || locationType === "stadium";
}
