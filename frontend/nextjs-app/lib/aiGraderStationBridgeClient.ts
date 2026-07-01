import type { AiGraderLocalStationStatus, AiGraderStationAction } from "./aiGraderLocalStation";

export const DEFAULT_AI_GRADER_STATION_BRIDGE_URL = "http://127.0.0.1:47652";

export type AiGraderStationBridgeCallInput = {
  baseUrl: string;
  stationToken: string;
  action: AiGraderStationAction;
  body?: Record<string, unknown>;
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
