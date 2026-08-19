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

export const SPEEDSTER_DETECT_FAILURE_VERSION = "speedster-detect-failure-v1" as const;

export type SpeedsterDetectFailureStage =
  | "IMAGE_LOAD"
  | "DETECTOR_EXECUTION"
  | "RESPONSE_ASSEMBLY";

export type SpeedsterDetectFailureEvidence = Readonly<{
  version: typeof SPEEDSTER_DETECT_FAILURE_VERSION;
  code: "SPEEDSTER_DETECT_INVALID_INPUT" | "SPEEDSTER_DETECT_FAILED";
  stage: SpeedsterDetectFailureStage;
  side: SpeedsterCardSide;
  requestTraceId: string;
  exceptionType: string;
  message: string;
  durationMs: number;
  stack: readonly Readonly<{ file: string; line: number; function: string }>[];
  stackTruncated: boolean;
  viewId?: string;
}>;

export const SPEEDSTER_DETECT_TRANSPORT_FIELD = "_speedsterDetectTransport" as const;

export class SpeedsterDetectUpstreamError extends Error {
  readonly side: SpeedsterCardSide;
  readonly requestTraceId: string;
  readonly upstreamStatus: number;
  readonly workerIdentity: SpeedsterDetectWorkerIdentity;
  readonly upstreamDurationMs: number;
  readonly failureEvidence: SpeedsterDetectFailureEvidence | null;

  constructor(input: {
    side: SpeedsterCardSide;
    requestTraceId: string;
    upstreamStatus: number;
    workerIdentity?: string | null;
    upstreamDurationMs: number;
    failureEvidence?: SpeedsterDetectFailureEvidence | null;
  }) {
    super(`RunPod detector returned HTTP ${input.upstreamStatus}.`);
    this.name = "SpeedsterDetectUpstreamError";
    this.side = input.side;
    this.requestTraceId = input.requestTraceId;
    this.upstreamStatus = input.upstreamStatus;
    this.workerIdentity = boundedWorkerIdentity(input.workerIdentity);
    this.upstreamDurationMs = boundedDuration(input.upstreamDurationMs);
    this.failureEvidence = input.failureEvidence ?? null;
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

const FAILURE_CODE = new Set(["SPEEDSTER_DETECT_INVALID_INPUT", "SPEEDSTER_DETECT_FAILED"]);
const FAILURE_STAGE = new Set(["IMAGE_LOAD", "DETECTOR_EXECUTION", "RESPONSE_ASSEMBLY"]);
const SAFE_EXCEPTION_TYPE = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function boundedFailureText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(?:Bearer\s+)?(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted-credential]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
  return sanitized || null;
}

export function speedsterDetectFailureEvidence(
  value: unknown,
  expected: Readonly<{ side: SpeedsterCardSide; requestTraceId: string }>,
): SpeedsterDetectFailureEvidence | null {
  if (!isRecord(value) || !isRecord(value.detail)) return null;
  const detail = value.detail;
  if (
    detail.version !== SPEEDSTER_DETECT_FAILURE_VERSION
    || !FAILURE_CODE.has(String(detail.code))
    || !FAILURE_STAGE.has(String(detail.stage))
    || detail.side !== expected.side
    || detail.requestTraceId !== expected.requestTraceId
    || typeof detail.exceptionType !== "string"
    || !SAFE_EXCEPTION_TYPE.test(detail.exceptionType)
    || typeof detail.durationMs !== "number"
    || !Number.isFinite(detail.durationMs)
    || detail.durationMs < 0
    || typeof detail.stackTruncated !== "boolean"
    || !Array.isArray(detail.stack)
    || detail.stack.length > 40
  ) return null;
  const message = boundedFailureText(detail.message, 300);
  if (!message) return null;
  const stack = detail.stack.map((entry) => {
    if (!isRecord(entry)
      || typeof entry.line !== "number" || !Number.isSafeInteger(entry.line) || entry.line < 1
      || entry.line > 10_000_000) return null;
    const file = boundedFailureText(entry.file, 240);
    const fn = boundedFailureText(entry.function, 160);
    return file && fn ? { file, line: entry.line, function: fn } : null;
  });
  if (stack.some((entry) => !entry)) return null;
  const viewId = detail.viewId === undefined ? null : boundedFailureText(detail.viewId, 180);
  if (detail.viewId !== undefined && !viewId) return null;
  return {
    version: SPEEDSTER_DETECT_FAILURE_VERSION,
    code: detail.code as SpeedsterDetectFailureEvidence["code"],
    stage: detail.stage as SpeedsterDetectFailureStage,
    side: expected.side,
    requestTraceId: expected.requestTraceId,
    exceptionType: detail.exceptionType,
    message,
    durationMs: boundedDuration(detail.durationMs),
    stack: stack as NonNullable<(typeof stack)[number]>[],
    stackTruncated: detail.stackTruncated,
    ...(viewId ? { viewId } : {}),
  };
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
