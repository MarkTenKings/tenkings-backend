import { normalizeAiGraderStationBridgeUrl } from "./aiGraderStationBridgeClient";
import {
  MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS,
  MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT,
  parseMathematicalCalibrationV1_2SessionMutationRequestDto,
  parseReplaceMathematicalCalibrationV1_2PoseRequestDto,
  parseStartMathematicalCalibrationV1_2SessionRequestDto,
  validateMathematicalCalibrationV1_2SessionListResponseDto,
  validateMathematicalCalibrationV1_2SessionStatusDto,
  type MathematicalCalibrationV1_2SessionListResponseDto,
  type MathematicalCalibrationV1_2SessionMutationRequestDto,
  type MathematicalCalibrationV1_2SessionStatusDto,
  type ReplaceMathematicalCalibrationV1_2PoseRequestDto,
  type StartMathematicalCalibrationV1_2SessionRequestDto,
} from "./aiGraderMathematicalCalibrationV1_2Contract";

export type MathematicalCalibrationV1_2ClientAction =
  | "start"
  | "capture"
  | "retry"
  | "replacePose"
  | "analyze"
  | "finalize";

const OPERATION_BY_ACTION = {
  start: "mathematical-calibration-v1.2-start",
  capture: "mathematical-calibration-v1.2-capture",
  retry: "mathematical-calibration-v1.2-retry",
  replacePose: "mathematical-calibration-v1.2-replace-pose",
  analyze: "mathematical-calibration-v1.2-analyze",
  finalize: "mathematical-calibration-v1.2-finalize",
} as const;

export class MathematicalCalibrationV1_2ClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = "MATHEMATICAL_CALIBRATION_V1_2_CLIENT_FAILED") {
    super(message);
    this.name = "MathematicalCalibrationV1_2ClientError";
    this.status = status;
    this.code = code;
  }
}

function exactToken(value: string) {
  const token = value.trim();
  if (!token) throw new MathematicalCalibrationV1_2ClientError("Paired station token is required.", 401);
  return token;
}

async function payload(response: Response) {
  return response.json().catch(() => ({})) as Promise<unknown>;
}

function failure(value: unknown, response: Response) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const nested = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
  return new MathematicalCalibrationV1_2ClientError(
    typeof body.message === "string" ? body.message
      : typeof nested.message === "string" ? nested.message
        : "Mathematical Calibration V1.2 request failed.",
    response.status,
    typeof body.code === "string" ? body.code : "MATHEMATICAL_CALIBRATION_V1_2_REQUEST_FAILED",
  );
}

async function localRequest(
  input: {
    baseUrl: string;
    stationToken: string;
    path: string;
    method: "GET" | "POST";
    body?: unknown;
    expectedOperation: string;
  },
  fetchImpl: typeof fetch,
) {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  const response = await fetchImpl(`${baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      "x-ai-grader-station-token": exactToken(input.stationToken),
      ...(input.method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(input.method === "POST" ? { body: JSON.stringify(input.body ?? {}) } : {}),
    cache: "no-store",
  });
  const body = await payload(response);
  if (!response.ok) throw failure(body, response);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MathematicalCalibrationV1_2ClientError("V1.2 helper response must be one exact object.", 502);
  }
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.operation !== input.expectedOperation || !("result" in record)) {
    throw new MathematicalCalibrationV1_2ClientError(
      "V1.2 helper response operation did not match the requested route.",
      502,
      "MATHEMATICAL_CALIBRATION_V1_2_RESPONSE_MISMATCH",
    );
  }
  return record.result;
}

export async function listMathematicalCalibrationV1_2Sessions(
  input: { baseUrl: string; stationToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MathematicalCalibrationV1_2SessionListResponseDto> {
  const result = await localRequest({
    ...input,
    path: MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.sessions,
    method: "GET",
    expectedOperation: "mathematical-calibration-v1.2-sessions",
  }, fetchImpl);
  return validateMathematicalCalibrationV1_2SessionListResponseDto(result);
}

export async function readMathematicalCalibrationV1_2Status(
  input: { baseUrl: string; stationToken: string; sessionId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
  const session = parseMathematicalCalibrationV1_2SessionMutationRequestDto({
    sessionId: input.sessionId,
    expectedRevision: "0".repeat(64),
  });
  const query = new URLSearchParams({ sessionId: session.sessionId });
  const result = await localRequest({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: `${MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.status}?${query.toString()}`,
    method: "GET",
    expectedOperation: "mathematical-calibration-v1.2-status",
  }, fetchImpl);
  return validateMathematicalCalibrationV1_2SessionStatusDto(result);
}

export async function startMathematicalCalibrationV1_2Session(
  input: { baseUrl: string; stationToken: string; request: StartMathematicalCalibrationV1_2SessionRequestDto },
  fetchImpl: typeof fetch = fetch,
): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
  const request = parseStartMathematicalCalibrationV1_2SessionRequestDto(input.request);
  const result = await localRequest({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.start,
    method: "POST",
    body: request,
    expectedOperation: OPERATION_BY_ACTION.start,
  }, fetchImpl);
  return validateMathematicalCalibrationV1_2SessionStatusDto(result);
}

export async function mutateMathematicalCalibrationV1_2Session(
  input: {
    baseUrl: string;
    stationToken: string;
    action: Exclude<MathematicalCalibrationV1_2ClientAction, "start" | "replacePose">;
    request: MathematicalCalibrationV1_2SessionMutationRequestDto;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
  const request = parseMathematicalCalibrationV1_2SessionMutationRequestDto(input.request);
  const result = await localRequest({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS[input.action],
    method: "POST",
    body: request,
    expectedOperation: OPERATION_BY_ACTION[input.action],
  }, fetchImpl);
  return validateMathematicalCalibrationV1_2SessionStatusDto(result);
}

export async function replaceMathematicalCalibrationV1_2Pose(
  input: {
    baseUrl: string;
    stationToken: string;
    request: Omit<ReplaceMathematicalCalibrationV1_2PoseRequestDto, "acknowledgement">;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
  const request = parseReplaceMathematicalCalibrationV1_2PoseRequestDto({
    ...input.request,
    acknowledgement: MATHEMATICAL_CALIBRATION_V1_2_REPLACEMENT_ACKNOWLEDGEMENT,
  });
  const result = await localRequest({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    path: MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS.replacePose,
    method: "POST",
    body: request,
    expectedOperation: OPERATION_BY_ACTION.replacePose,
  }, fetchImpl);
  return validateMathematicalCalibrationV1_2SessionStatusDto(result);
}
