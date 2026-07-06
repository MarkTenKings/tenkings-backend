import type {
  AiGraderLiveLightingStatus,
  AiGraderLocalReportHistory,
  AiGraderLocalStationPreviewStatus,
  AiGraderLocalStationStatus,
  AiGraderStationAction,
} from "./aiGraderLocalStation";
import type { AiGraderReportBundle } from "./aiGraderReportBundle";

export const DEFAULT_AI_GRADER_STATION_BRIDGE_URL = "http://127.0.0.1:47652";
export const AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY = "tenkings.aiGraderStation.bridgeUrl";
export const AI_GRADER_STATION_TOKEN_STORAGE_KEY = "tenkings.aiGraderStation.stationToken";

export type AiGraderStationBridgeCallInput = {
  baseUrl: string;
  stationToken: string;
  action: AiGraderStationAction;
  body?: Record<string, unknown>;
};

export type AiGraderStationBridgeHealth = {
  ok: boolean;
  bridgeVersion: string;
  mode: "mock" | "real";
  localOnly: true;
  tokenRequired: true;
  pairingAvailable?: boolean;
  pairingCodeExpiresAt?: string;
  hardwareActionsEnabled: boolean;
  allowedOrigins: string[];
};

export type AiGraderStationBridgePairingResult = {
  bridgeUrl: string;
  stationToken: string;
  localOnly: true;
  tokenStorage: "browser_localStorage_only";
  hardwareActionsEnabled: boolean;
};

export type AiGraderStationPreviewFrame = {
  blob: Blob;
  contentType: string;
  byteLength: number;
  frameIndex?: number;
  capturedAt?: string;
};

export type AiGraderStationPreviewStreamHandlers = {
  signal?: AbortSignal;
  onOpen?: (contentType: string) => void;
  onFrame?: (frame: AiGraderStationPreviewFrame) => void;
  onError?: (error: Error) => void;
};

export function normalizeAiGraderStationBridgeUrl(input: string) {
  const trimmed = input.trim() || DEFAULT_AI_GRADER_STATION_BRIDGE_URL;
  const url = new URL(trimmed);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:") {
    throw new Error("AI Grader station bridge URL must use http:// loopback.");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new Error("AI Grader station bridge URL must point to localhost or 127.0.0.1.");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function actionPath(action: AiGraderStationAction) {
  if (action === "status") return "/status";
  if (action === "latest-report") return "/latest-report";
  if (action === "session-manifest") return "/session-manifest";
  return `/actions/${encodeURIComponent(action)}`;
}

export async function fetchAiGraderStationBridgeHealth(
  input: { baseUrl: string },
  fetchImpl: typeof fetch = fetch
): Promise<AiGraderStationBridgeHealth> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  const response = await fetchImpl(`${baseUrl}/health`, { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge health check failed.");
  }
  return payload as AiGraderStationBridgeHealth;
}

export async function pairAiGraderStationBridge(
  input: { baseUrl: string; pairingCode: string },
  fetchImpl: typeof fetch = fetch
): Promise<AiGraderStationBridgePairingResult> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  const pairingCode = input.pairingCode.trim();
  if (!pairingCode) {
    throw new Error("AI Grader station bridge pairing code is required.");
  }
  const response = await fetchImpl(`${baseUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge pairing failed.");
  }
  const result = payload.result as AiGraderStationBridgePairingResult | undefined;
  if (!result?.stationToken?.trim()) {
    throw new Error("AI Grader local station bridge pairing did not return a usable local token.");
  }
  return result;
}

export async function callAiGraderStationBridge(input: AiGraderStationBridgeCallInput): Promise<AiGraderLocalStationStatus> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const method = input.action === "status" || input.action === "latest-report" || input.action === "session-manifest" ? "GET" : "POST";
  const response = await fetch(`${baseUrl}${actionPath(input.action)}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-ai-grader-station-token": input.stationToken,
    },
    body: method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge request failed.");
  }
  return payload.result as AiGraderLocalStationStatus;
}

async function bridgeGetJson<T>(
  input: { baseUrl: string; stationToken: string; path: string },
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}${input.path}`, {
    method: "GET",
    headers: {
      "x-ai-grader-station-token": input.stationToken,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge request failed.");
  }
  return payload.result as T;
}

export async function fetchAiGraderStationPreviewStatus(input: {
  baseUrl: string;
  stationToken: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationPreviewStatus> {
  return bridgeGetJson<AiGraderLocalStationPreviewStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/preview/status",
  }, fetchImpl);
}

export async function stopAiGraderStationPreview(input: {
  baseUrl: string;
  stationToken: string;
  reason?: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLocalStationPreviewStatus> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}/preview/stop`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-grader-station-token": input.stationToken,
    },
    body: JSON.stringify({ reason: input.reason ?? "operator requested preview stop" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader preview stream could not be stopped.");
  }
  return payload.result as AiGraderLocalStationPreviewStatus;
}

async function bridgePostJson<T>(
  input: { baseUrl: string; stationToken: string; path: string; body?: Record<string, unknown>; keepalive?: boolean },
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}${input.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-grader-station-token": input.stationToken,
    },
    body: JSON.stringify(input.body ?? {}),
    keepalive: input.keepalive,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? payload.error?.message ?? "AI Grader local station bridge request failed.");
  }
  return payload.result as T;
}

export async function fetchAiGraderLiveLightingStatus(input: {
  baseUrl: string;
  stationToken: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgeGetJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/status",
  }, fetchImpl);
}

export async function applyAiGraderLiveLighting(input: {
  baseUrl: string;
  stationToken: string;
  enabled: boolean;
  dutyPercent: number;
  channels: number[];
  reason?: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgePostJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/apply",
    body: {
      enabled: input.enabled,
      dutyPercent: input.dutyPercent,
      channels: input.channels,
      reason: input.reason ?? "browser live lighting apply",
    },
  }, fetchImpl);
}

export async function safeOffAiGraderLiveLighting(input: {
  baseUrl: string;
  stationToken: string;
  reason?: string;
  keepalive?: boolean;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgePostJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/safe-off",
    body: { reason: input.reason ?? "browser live lighting safe-off" },
    keepalive: input.keepalive,
  }, fetchImpl);
}

export async function acceptAiGraderLiveLightingProfile(input: {
  baseUrl: string;
  stationToken: string;
  dutyPercent: number;
  channels: number[];
  exposureUs: number;
  gain: number;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgePostJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/accept",
    body: {
      dutyPercent: input.dutyPercent,
      channels: input.channels,
      exposureUs: input.exposureUs,
      gain: input.gain,
    },
  }, fetchImpl);
}

export async function heartbeatAiGraderLiveLighting(input: {
  baseUrl: string;
  stationToken: string;
  reason?: string;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderLiveLightingStatus> {
  return bridgePostJson<AiGraderLiveLightingStatus>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/lighting/heartbeat",
    body: { reason: input.reason ?? "browser live lighting heartbeat" },
  }, fetchImpl);
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

function indexOfBytes(buffer: Uint8Array, target: Uint8Array, from = 0) {
  if (!target.length) return -1;
  for (let index = Math.max(0, from); index <= buffer.length - target.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < target.length; offset += 1) {
      if (buffer[index + offset] !== target[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function headerValue(headerText: string, name: string) {
  const pattern = new RegExp(`^${name}:\\s*(.+)$`, "im");
  return headerText.match(pattern)?.[1]?.trim();
}

function boundaryFromContentType(contentType: string) {
  return contentType.match(/boundary="?([^";]+)"?/i)?.[1] ?? "tenkings-ai-grader-preview";
}

export async function openAiGraderStationPreviewStream(
  input: {
    baseUrl: string;
    stationToken: string;
  },
  handlers: AiGraderStationPreviewStreamHandlers = {},
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}/preview/stream`, {
    method: "GET",
    headers: {
      "x-ai-grader-station-token": input.stationToken,
    },
    signal: handlers.signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = "AI Grader preview stream could not be opened.";
    try {
      const payload = JSON.parse(text);
      message = payload.message ?? payload.error?.message ?? message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") ?? "";
  handlers.onOpen?.(contentType);
  const boundaryBytes = new TextEncoder().encode(`--${boundaryFromContentType(contentType)}`);
  const headerEndBytes = new TextEncoder().encode("\r\n\r\n");
  const crlfBytes = new TextEncoder().encode("\r\n");
  const decoder = new TextDecoder("ascii");
  const reader = response.body.getReader();
  let buffer = new Uint8Array();
  let expectedLength: number | null = null;
  let currentContentType = "image/jpeg";
  let currentFrameIndex: number | undefined;
  let currentCapturedAt: string | undefined;

  const parseAvailableFrames = () => {
    while (true) {
      if (expectedLength === null) {
        const boundaryIndex = indexOfBytes(buffer, boundaryBytes);
        if (boundaryIndex < 0) {
          if (buffer.length > boundaryBytes.length) buffer = buffer.slice(buffer.length - boundaryBytes.length);
          return;
        }
        if (boundaryIndex > 0) buffer = buffer.slice(boundaryIndex);
        const headerEndIndex = indexOfBytes(buffer, headerEndBytes);
        if (headerEndIndex < 0) return;
        const headerText = decoder.decode(buffer.slice(0, headerEndIndex));
        const lengthValue = Number(headerValue(headerText, "Content-Length"));
        if (!Number.isInteger(lengthValue) || lengthValue <= 0) {
          buffer = buffer.slice(headerEndIndex + headerEndBytes.length);
          continue;
        }
        currentContentType = headerValue(headerText, "Content-Type") ?? "image/jpeg";
        const frameIndexValue = Number(headerValue(headerText, "X-AI-Grader-Frame-Index"));
        currentFrameIndex = Number.isFinite(frameIndexValue) ? frameIndexValue : undefined;
        currentCapturedAt = headerValue(headerText, "X-AI-Grader-Captured-At");
        expectedLength = lengthValue;
        buffer = buffer.slice(headerEndIndex + headerEndBytes.length);
      }
      if (buffer.length < expectedLength) return;
      const frameBytes = buffer.slice(0, expectedLength);
      buffer = buffer.slice(expectedLength);
      if (indexOfBytes(buffer, crlfBytes) === 0) buffer = buffer.slice(crlfBytes.length);
      handlers.onFrame?.({
        blob: new Blob([frameBytes], { type: currentContentType }),
        contentType: currentContentType,
        byteLength: frameBytes.length,
        frameIndex: currentFrameIndex,
        capturedAt: currentCapturedAt,
      });
      expectedLength = null;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        buffer = concatBytes(buffer, value);
        parseAvailableFrames();
      }
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("AI Grader preview stream failed.");
    if (normalized.name !== "AbortError") handlers.onError?.(normalized);
    if (normalized.name !== "AbortError") throw normalized;
  }
}

export async function fetchAiGraderStationReportBundle(input: {
  baseUrl: string;
  stationToken: string;
  reportId: string;
  includeAssetBodies?: boolean;
}, fetchImpl: typeof fetch = fetch): Promise<AiGraderReportBundle> {
  const query = input.includeAssetBodies ? "?includeAssetBodies=1" : "";
  const result = await bridgeGetJson<{ reportId: string; bundle: AiGraderReportBundle; source: string }>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: `/reports/${encodeURIComponent(input.reportId)}/bundle${query}`,
  }, fetchImpl);
  return result.bundle;
}

export async function fetchAiGraderStationReportHtml(
  input: {
    baseUrl: string;
    stationToken: string;
    reportId: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetchImpl(`${baseUrl}/reports/${encodeURIComponent(input.reportId)}/html`, {
    method: "GET",
    headers: {
      "x-ai-grader-station-token": input.stationToken,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = "AI Grader local station report could not be opened.";
    try {
      const payload = JSON.parse(text);
      message = payload.message ?? payload.error?.message ?? message;
    } catch {
      if (text.trim()) message = text.trim();
    }
    throw new Error(message);
  }
  return text;
}

export async function fetchAiGraderStationReportHistory(input: {
  baseUrl: string;
  stationToken: string;
}): Promise<AiGraderLocalReportHistory> {
  return bridgeGetJson<AiGraderLocalReportHistory>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: "/report-history",
  });
}

export function aiGraderStationReportHtmlBridgeUrl(input: {
  baseUrl: string;
  reportId: string;
}) {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  return `${baseUrl}/reports/${encodeURIComponent(input.reportId)}/html`;
}
