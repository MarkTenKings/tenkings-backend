import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";

export const SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE = "UNAVAILABLE" as const;

export type SpeedsterDetectWorkerIdentity =
  | string
  | typeof SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE;

export type SpeedsterDetectTransportEvidence = Readonly<{
  upstreamStatus: number;
  workerIdentity: SpeedsterDetectWorkerIdentity;
  upstreamDurationMs: number;
}>;

export const SPEEDSTER_DETECT_TRANSPORT_FIELD = "_speedsterDetectTransport" as const;

export class SpeedsterDetectUpstreamError extends Error {
  readonly side: SpeedsterCardSide;
  readonly requestTraceId: string;
  readonly upstreamStatus: number;
  readonly workerIdentity: SpeedsterDetectWorkerIdentity;
  readonly upstreamDurationMs: number;

  constructor(input: {
    side: SpeedsterCardSide;
    requestTraceId: string;
    upstreamStatus: number;
    workerIdentity?: string | null;
    upstreamDurationMs: number;
  }) {
    super(`RunPod detector returned HTTP ${input.upstreamStatus}.`);
    this.name = "SpeedsterDetectUpstreamError";
    this.side = input.side;
    this.requestTraceId = input.requestTraceId;
    this.upstreamStatus = input.upstreamStatus;
    this.workerIdentity = boundedWorkerIdentity(input.workerIdentity);
    this.upstreamDurationMs = boundedDuration(input.upstreamDurationMs);
  }
}

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function boundedWorkerIdentity(value: unknown): SpeedsterDetectWorkerIdentity {
  return typeof value === "string" && WORKER_ID.test(value.trim())
    ? value.trim()
    : SPEEDSTER_DETECT_WORKER_ID_UNAVAILABLE;
}

export function boundedDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), 30 * 60 * 1000)
    : 0;
}

export function speedsterDetectTransportEvidence(
  value: unknown,
): SpeedsterDetectTransportEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const raw = candidate[SPEEDSTER_DETECT_TRANSPORT_FIELD];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const transport = raw as Record<string, unknown>;
  if (
    typeof transport.upstreamStatus !== "number"
    || !Number.isInteger(transport.upstreamStatus)
    || transport.upstreamStatus < 100
    || transport.upstreamStatus > 599
  ) {
    return null;
  }
  return {
    upstreamStatus: transport.upstreamStatus,
    workerIdentity: boundedWorkerIdentity(transport.workerIdentity),
    upstreamDurationMs: boundedDuration(transport.upstreamDurationMs),
  };
}
