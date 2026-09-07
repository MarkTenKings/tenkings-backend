import { buildAdminHeaders } from "../adminHeaders";
import type { SpeedsterCardSide } from "./contracts";
import { runSpeedsterImageRequest } from "./image-service";

type OriginalImageResponse = {
  side?: SpeedsterCardSide;
  storageKey?: string;
  imageUrl?: string;
  message?: string;
};

type OriginalImageFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchSpeedsterOriginalImageUrl(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  storageKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: OriginalImageFetch;
}): Promise<string> {
  const fetcher = input.fetcher ?? fetch;
  const { response, payload } = await runSpeedsterImageRequest(
    `${input.side.toLowerCase()} exact source refresh`,
    { signal: input.signal, timeoutMs: input.timeoutMs },
    async (signal) => {
      const response = await fetcher(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(input.sessionId)}/original-image?side=${input.side}&storageKey=${encodeURIComponent(input.storageKey)}`,
        {
          method: "GET",
          headers: buildAdminHeaders(input.token),
          cache: "no-store",
          signal,
        },
      );
      const payload = await response.json().catch(() => ({})) as OriginalImageResponse;
      return { response, payload };
    },
  );
  if (!response.ok || payload.side !== input.side || payload.storageKey !== input.storageKey || !payload.imageUrl) {
    throw new Error(payload.message ?? `The exact ${input.side.toLowerCase()} original image could not be refreshed.`);
  }
  return payload.imageUrl;
}
