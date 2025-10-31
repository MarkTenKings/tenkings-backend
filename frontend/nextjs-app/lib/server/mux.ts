import crypto from "node:crypto";

const MUX_API_BASE = "https://api.mux.com/video/v1";

const muxTokenId = process.env.MUX_TOKEN_ID ?? "";
const muxTokenSecret = process.env.MUX_TOKEN_SECRET ?? "";
const muxWebhookSecret = process.env.MUX_WEBHOOK_SECRET ?? "";

function ensureCredentials() {
  if (!muxTokenId || !muxTokenSecret) {
    throw new Error("Mux credentials are not configured. Set MUX_TOKEN_ID and MUX_TOKEN_SECRET.");
  }
}

function authHeader() {
  ensureCredentials();
  const encoded = Buffer.from(`${muxTokenId}:${muxTokenSecret}`).toString("base64");
  return `Basic ${encoded}`;
}

interface MuxResponse<T> {
  data: T;
}

async function muxRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader());
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${MUX_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mux API error (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as MuxResponse<T>;
  return payload.data;
}

export interface MuxPlayback {
  id: string;
  policy: string;
}

export interface MuxLiveStream {
  id: string;
  status: string;
  stream_key: string;
  playback_ids?: MuxPlayback[];
  active_asset_id?: string | null;
}

export interface MuxAssetPlayback {
  id: string;
  policy: string;
}

export interface MuxAsset {
  id: string;
  status: string;
  playback_ids?: MuxAssetPlayback[];
  duration?: number | null;
}

export async function createMuxLiveStream(params: {
  passthrough: string;
  livestreamName?: string;
  simulcastTargets?: Array<{
    streamKey: string;
    url: string;
  }>;
}) {
  const body: Record<string, unknown> = {
    passthrough: params.passthrough,
    playback_policy: ["public"],
    new_asset_settings: {
      playback_policy: ["public"],
    },
    reconnect_window: 120,
  };

  if (params.livestreamName) {
    body.name = params.livestreamName;
  }

  if (params.simulcastTargets?.length) {
    body.simulcast_targets = params.simulcastTargets.map((target) => ({
      stream_key: target.streamKey,
      url: target.url,
    }));
  }

  return muxRequest<MuxLiveStream>("/live-streams", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getMuxLiveStream(liveStreamId: string) {
  return muxRequest<MuxLiveStream>(`/live-streams/${liveStreamId}`);
}

export async function disableMuxLiveStream(liveStreamId: string) {
  await muxRequest<void>(`/live-streams/${liveStreamId}/disable`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function deleteMuxLiveStream(liveStreamId: string) {
  await muxRequest<void>(`/live-streams/${liveStreamId}`, {
    method: "DELETE",
  });
}

export async function getMuxAsset(assetId: string) {
  return muxRequest<MuxAsset>(`/assets/${assetId}`);
}

export function buildMuxPlaybackUrl(playbackId: string, format: "m3u8" | "mp4" = "m3u8") {
  return `https://stream.mux.com/${playbackId}.${format}`;
}

export function verifyMuxWebhookSignature(rawBody: string, signatureHeader: string | null | undefined) {
  if (!muxWebhookSecret) {
    throw new Error("MUX_WEBHOOK_SECRET is not configured.");
  }
  if (!signatureHeader) {
    return false;
  }

  const parts = signatureHeader.split(",");
  let timestamp = "";
  let signature = "";
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1") {
      signature = value;
    }
  }

  if (!timestamp || !signature) {
    return false;
  }

  const payload = `${timestamp}.${rawBody}`;
  const computed = crypto.createHmac("sha256", muxWebhookSecret).update(payload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(computed, "hex"));
  } catch (error) {
    return false;
  }
}

export function muxCredentialsConfigured() {
  return Boolean(muxTokenId && muxTokenSecret);
}
