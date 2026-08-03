import { buildAdminHeaders } from "../adminHeaders";
import type { SpeedsterCardSide } from "./contracts";

export const SPEEDSTER_REVIEW_IMAGE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;

export const SPEEDSTER_REVIEW_VIEW_TYPES = [
  "ORIGINAL",
  "NORMALIZED",
  "MICRO_DEFECT",
  "DIRECTIONAL",
] as const;

export type SpeedsterReviewViewType = typeof SPEEDSTER_REVIEW_VIEW_TYPES[number];

export type SpeedsterReviewImageUrls = Readonly<Record<
  SpeedsterCardSide,
  {
    master: string;
    views: Readonly<Record<SpeedsterReviewViewType, string>>;
  }
>>;

type ReviewImageResponse = {
  urls?: SpeedsterReviewImageUrls;
  message?: string;
};

type ReviewImageFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchSpeedsterReviewImageUrls(input: {
  token: string;
  sessionId: string;
  fetcher?: ReviewImageFetch;
}): Promise<SpeedsterReviewImageUrls> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(input.sessionId)}/review-images`,
    {
      method: "GET",
      headers: buildAdminHeaders(input.token),
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => ({})) as ReviewImageResponse;
  if (!response.ok || !payload.urls) {
    throw new Error(payload.message ?? "Speedster review images could not be refreshed.");
  }
  return payload.urls;
}

export function createCoalescedReviewImageRefresh<T>(load: () => Promise<T>) {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const request = Promise.resolve().then(load);
    const shared = request.finally(() => {
      if (inFlight === shared) inFlight = null;
    });
    inFlight = shared;
    return shared;
  };
}
