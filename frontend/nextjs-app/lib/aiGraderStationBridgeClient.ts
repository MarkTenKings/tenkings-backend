import type {
  AiGraderLocalReportHistory,
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

async function bridgeGetJson<T>(input: { baseUrl: string; stationToken: string; path: string }): Promise<T> {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) {
    throw new Error("AI Grader station bridge token is required.");
  }
  const response = await fetch(`${baseUrl}${input.path}`, {
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

export async function fetchAiGraderStationReportBundle(input: {
  baseUrl: string;
  stationToken: string;
  reportId: string;
}): Promise<AiGraderReportBundle> {
  const result = await bridgeGetJson<{ reportId: string; bundle: AiGraderReportBundle; source: string }>({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: `/reports/${encodeURIComponent(input.reportId)}/bundle`,
  });
  return result.bundle;
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
