import { buildAdminHeaders } from "../adminHeaders";
import type { SpeedsterCardSide } from "./contracts";

export const SPEEDSTER_PREPARED_IMAGE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;

type PreparedImageResponse = {
  side?: SpeedsterCardSide;
  imageUrl?: string;
  message?: string;
};

type PreparedImageFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchSpeedsterPreparedRectifiedImageUrl(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  storageKey: string;
  fetcher?: PreparedImageFetch;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(input.sessionId)}/prepared-image?side=${input.side}&storageKey=${encodeURIComponent(input.storageKey)}`,
    {
      method: "GET",
      headers: buildAdminHeaders(input.token),
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => ({})) as PreparedImageResponse;
  if (!response.ok || payload.side !== input.side || !payload.imageUrl) {
    throw new Error(payload.message ?? `The ${input.side.toLowerCase()} card image could not be refreshed.`);
  }
  return payload.imageUrl;
}
