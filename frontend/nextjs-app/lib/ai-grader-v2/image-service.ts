import { buildAdminHeaders } from "../adminHeaders";
import { toCardMapOperatorMessage } from "./card-map-copy";
import type {
  SpeedsterCardSide,
  SpeedsterQuad,
} from "./contracts";
import type { SpeedsterInspectionFrame } from "./inspection-frame";
import type { SpeedsterTraceBitmapWireV1 } from "./trace-bitmap-wire";
import type { SpeedsterCanonicalPixel } from "./trace-editor";
import type {
  SpeedsterMapRegistration,
  SpeedsterMapRegistrationFailure,
} from "./card-type-map-contracts";
import type { SpeedsterColorGeometryProposal, SpeedsterMatColor } from "./color-geometry";

type ImageAction = "geometry" | "prepare" | "color-geometry" | "trace-proposal" | "map-registration";

export const SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION = "speedster-map-registration-error-v1" as const;

export type SpeedsterMapRegistrationRequestFailure = Readonly<{
  version: typeof SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION;
  source: "PROVIDER_GATEWAY" | "PROVIDER" | "PROVIDER_NETWORK" | "TEN_KINGS_API" | "CLIENT_NETWORK" | "CLIENT_PROTOCOL";
  code: string;
  httpStatus: number | null;
  retryable: boolean;
  requestId: string | null;
}>;

export type SpeedsterMapRegistrationAuditWarning = Readonly<{
  status: "WRITE_FAILED";
  requestId: string;
}>;

const registrationAuditWarnings = new WeakMap<object, SpeedsterMapRegistrationAuditWarning>();

export type SpeedsterMapRegistrationOrchestration = Readonly<{
  operationId: string;
  attemptNumber: number;
  trigger: "INITIAL" | "AUTOMATIC_RETRY" | "MANUAL_RETRY" | "HUMAN_RESCUE";
  successfulSiblingPreservedAtAttemptStart: boolean;
}>;

export class SpeedsterMapRegistrationError extends Error {
  constructor(
    message: string,
    readonly failure: SpeedsterMapRegistrationFailure,
    readonly requestId: string | null,
    readonly auditWarning: SpeedsterMapRegistrationAuditWarning | null = null,
  ) {
    super(message);
    this.name = "SpeedsterMapRegistrationError";
  }
}

export class SpeedsterMapRegistrationRequestError extends Error {
  constructor(
    message: string,
    readonly failure: SpeedsterMapRegistrationRequestFailure,
    readonly auditWarning: SpeedsterMapRegistrationAuditWarning | null = null,
  ) {
    super(message);
    this.name = "SpeedsterMapRegistrationRequestError";
  }
}

export function parseSpeedsterMapRegistrationAuditWarning(value: unknown): SpeedsterMapRegistrationAuditWarning | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const warning = value as Record<string, unknown>;
  if (warning.status !== "WRITE_FAILED"
    || typeof warning.requestId !== "string"
    || !/^[A-Za-z0-9-]{8,80}$/.test(warning.requestId)) return null;
  return { status: "WRITE_FAILED", requestId: warning.requestId };
}

export function speedsterMapRegistrationAuditWarningFor(value: unknown): SpeedsterMapRegistrationAuditWarning | null {
  return value && typeof value === "object" ? registrationAuditWarnings.get(value) ?? null : null;
}

const REGISTRATION_ERROR_SOURCES = new Set<SpeedsterMapRegistrationRequestFailure["source"]>([
  "PROVIDER_GATEWAY",
  "PROVIDER",
  "PROVIDER_NETWORK",
  "TEN_KINGS_API",
  "CLIENT_NETWORK",
  "CLIENT_PROTOCOL",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function parseSpeedsterMapRegistrationRequestFailure(
  value: unknown,
  actualStatus: number,
  automaticMode: boolean,
  fallbackRequestId: string | null,
): SpeedsterMapRegistrationRequestFailure | null {
  if (!isRecord(value)
    || Object.keys(value).sort().join("\0") !== [
      "code", "httpStatus", "requestId", "retryable", "source", "version",
    ].join("\0")) return null;
  const failure = value;
  const requestId = typeof failure.requestId === "string" && /^[A-Za-z0-9-]{8,80}$/.test(failure.requestId)
    ? failure.requestId
    : fallbackRequestId;
  if (
    failure.version !== SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION
    || typeof failure.source !== "string"
    || !REGISTRATION_ERROR_SOURCES.has(failure.source as SpeedsterMapRegistrationRequestFailure["source"])
    || typeof failure.code !== "string"
    || !/^[A-Z0-9_:-]{3,80}$/.test(failure.code)
    || failure.httpStatus !== actualStatus
    || typeof failure.retryable !== "boolean"
  ) return null;
  const source = failure.source as SpeedsterMapRegistrationRequestFailure["source"];
  const code = failure.code;
  const coherent = source === "PROVIDER_GATEWAY"
    ? (actualStatus === 502 || actualStatus === 503)
      && code === `PROVIDER_GATEWAY_HTTP_${actualStatus}`
      && failure.retryable === automaticMode
    : source === "PROVIDER"
      ? ((code === `PROVIDER_HTTP_${actualStatus}` && failure.retryable === false)
        || (actualStatus === 504 && code === "PROVIDER_TIMEOUT" && failure.retryable === false))
      : source === "PROVIDER_NETWORK"
        ? actualStatus === 502
          && code === "NETWORK_NO_HTTP_RESPONSE"
          && failure.retryable === automaticMode
        : source === "TEN_KINGS_API"
          ? [
              "TEN_KINGS_AUTHORIZATION_REJECTED",
              "TEN_KINGS_REGISTRATION_VALIDATION_FAILED",
              "TEN_KINGS_REGISTRATION_REQUEST_REJECTED",
              "MALFORMED_PROVIDER_FAILURE_DIAGNOSTICS",
            ].includes(code)
            && failure.retryable === false
            && (code !== "TEN_KINGS_AUTHORIZATION_REJECTED" || actualStatus === 401 || actualStatus === 403)
            && (code !== "MALFORMED_PROVIDER_FAILURE_DIAGNOSTICS" || actualStatus === 502)
          : false;
  if (!coherent) return null;
  return {
    version: SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION,
    source,
    code,
    httpStatus: actualStatus,
    retryable: failure.retryable,
    requestId,
  };
}

export function parseSpeedsterMapRegistrationFailurePayload(
  value: unknown,
  expectedSide: SpeedsterCardSide,
): SpeedsterMapRegistrationFailure | null {
  if (!isRecord(value) || !isRecord(value.binding) || !isRecord(value.bestCandidate)
    || !hasExactKeys(value, [
      "accepted", "algorithmVersion", "bestCandidate", "binding", "candidateCount",
      "candidateIds", "failureCode", "message", "policyVersion",
    ])
    || !hasExactKeys(value.binding, [
      "candidates", "currentInspectionSha256", "currentPhysicalQuadSha256", "mapRevisionId", "side",
    ])
    || !hasExactKeys(value.bestCandidate, [
      "accepted", "anchors", "candidateId", "failureCode", "featureCount", "inlierCount",
      "inlierFraction", "maxReprojectionErrorPx", "medianReprojectionErrorPx", "message",
      "perAnchorFeatureCounts", "perAnchorInlierCounts", "provenance", "usableFeatureCount",
    ])) return null;
  const failure = value;
  const binding = value.binding;
  const best = value.bestCandidate;
  if (failure.algorithmVersion !== "opencv-redundant-ransac-registration-v2"
    || failure.policyVersion !== "speedster-map-registration-acceptance-v2"
    || failure.accepted !== false
    || typeof failure.failureCode !== "string" || !/^[A-Z0-9_:-]{1,100}$/.test(failure.failureCode)
    || typeof failure.message !== "string" || failure.message.length < 1 || failure.message.length > 240
    || !Number.isSafeInteger(failure.candidateCount)
    || (failure.candidateCount as number) < 1 || (failure.candidateCount as number) > 4
    || !Array.isArray(failure.candidateIds)
    || failure.candidateIds.length !== failure.candidateCount
    || failure.candidateIds.some((candidate) => typeof candidate !== "string" || candidate.length < 1 || candidate.length > 80)
    || failure.candidateIds[0] !== "original-reference"
    || new Set(failure.candidateIds).size !== failure.candidateIds.length
    || binding.side !== expectedSide
    || typeof binding.mapRevisionId !== "string" || binding.mapRevisionId.length < 1 || binding.mapRevisionId.length > 100
    || typeof binding.currentInspectionSha256 !== "string" || !SHA256_HEX.test(binding.currentInspectionSha256)
    || typeof binding.currentPhysicalQuadSha256 !== "string" || !SHA256_HEX.test(binding.currentPhysicalQuadSha256)
    || !Array.isArray(binding.candidates) || binding.candidates.length !== failure.candidateCount
    || typeof best.candidateId !== "string" || !failure.candidateIds.includes(best.candidateId)
    || (best.provenance !== "ORIGINAL_REFERENCE" && best.provenance !== "REGISTRATION_LESSON")
    || best.accepted !== false
    || typeof best.failureCode !== "string" || !/^[A-Z0-9_:-]{1,100}$/.test(best.failureCode)
    || typeof best.message !== "string" || best.message.length < 1 || best.message.length > 240
    || !Array.isArray(best.anchors) || best.anchors.length !== 4) return null;
  const candidates = binding.candidates.map((candidate) => {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["candidateId", "referenceInspectionSha256"])
      || typeof candidate.candidateId !== "string" || candidate.candidateId.length < 1 || candidate.candidateId.length > 80
      || typeof candidate.referenceInspectionSha256 !== "string" || !SHA256_HEX.test(candidate.referenceInspectionSha256)) return null;
    return {
      candidateId: candidate.candidateId,
      referenceInspectionSha256: candidate.referenceInspectionSha256,
    };
  });
  if (candidates.some((candidate) => !candidate)
    || candidates.map((candidate) => candidate?.candidateId).join("\0") !== failure.candidateIds.join("\0")) return null;
  const boundedInteger = (entry: unknown, maximum = 100) => Number.isSafeInteger(entry)
    && (entry as number) >= 0 && (entry as number) <= maximum ? entry as number : null;
  const boundedFraction = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry)
    && entry >= 0 && entry <= 1 ? entry : null;
  const boundedError = (entry: unknown) => entry === null
    ? null
    : typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && entry <= 10_000 ? entry : undefined;
  const countVector = (entry: unknown) => Array.isArray(entry) && entry.length === 4
    && entry.every((count) => boundedInteger(count) !== null)
    ? entry as [number, number, number, number]
    : null;
  const point = (entry: unknown, unit: boolean) => isRecord(entry) && hasExactKeys(entry, ["x", "y"])
    && typeof entry.x === "number" && Number.isFinite(entry.x)
    && typeof entry.y === "number" && Number.isFinite(entry.y)
    && (!unit || (entry.x >= 0 && entry.x <= 1 && entry.y >= 0 && entry.y <= 1))
    ? { x: entry.x, y: entry.y }
    : null;
  const anchors = best.anchors.map((anchor) => {
    if (!isRecord(anchor) || !hasExactKeys(anchor, [
      "anchorId", "expectedPoint", "locatedPoint", "score", "status", "trackedPoint",
    ])
      || typeof anchor.anchorId !== "string" || anchor.anchorId.length < 1 || anchor.anchorId.length > 80
      || !["TRACKED", "LOW_CONFIDENCE", "FAILED", "OUT_OF_CARD"].includes(String(anchor.status))) return null;
    const expectedPoint = point(anchor.expectedPoint, true);
    const trackedPoint = anchor.trackedPoint === null ? null : point(anchor.trackedPoint, false);
    const locatedPoint = anchor.locatedPoint === null ? null : point(anchor.locatedPoint, false);
    const score = boundedFraction(anchor.score);
    if (!expectedPoint || (anchor.trackedPoint !== null && !trackedPoint)
      || (anchor.locatedPoint !== null && !locatedPoint) || score === null) return null;
    return {
      anchorId: anchor.anchorId,
      expectedPoint,
      trackedPoint,
      locatedPoint,
      score,
      status: anchor.status as "TRACKED" | "LOW_CONFIDENCE" | "FAILED" | "OUT_OF_CARD",
    };
  });
  const featureCount = boundedInteger(best.featureCount);
  const usableFeatureCount = boundedInteger(best.usableFeatureCount);
  const inlierCount = boundedInteger(best.inlierCount);
  const inlierFraction = boundedFraction(best.inlierFraction);
  const perAnchorFeatureCounts = countVector(best.perAnchorFeatureCounts);
  const perAnchorInlierCounts = countVector(best.perAnchorInlierCounts);
  const medianReprojectionErrorPx = boundedError(best.medianReprojectionErrorPx);
  const maxReprojectionErrorPx = boundedError(best.maxReprojectionErrorPx);
  if (anchors.some((anchor) => !anchor)
    || new Set(anchors.map((anchor) => anchor?.anchorId)).size !== 4
    || featureCount === null || usableFeatureCount === null || inlierCount === null || inlierFraction === null
    || !perAnchorFeatureCounts || !perAnchorInlierCounts
    || medianReprojectionErrorPx === undefined || maxReprojectionErrorPx === undefined) return null;
  return {
    algorithmVersion: "opencv-redundant-ransac-registration-v2",
    policyVersion: "speedster-map-registration-acceptance-v2",
    accepted: false,
    failureCode: failure.failureCode,
    message: failure.message,
    candidateCount: failure.candidateCount as number,
    candidateIds: failure.candidateIds as string[],
    binding: {
      side: expectedSide,
      mapRevisionId: binding.mapRevisionId,
      currentInspectionSha256: binding.currentInspectionSha256,
      currentPhysicalQuadSha256: binding.currentPhysicalQuadSha256,
      candidates: candidates as Array<{ candidateId: string; referenceInspectionSha256: string }>,
    },
    bestCandidate: {
      candidateId: best.candidateId,
      provenance: best.provenance,
      accepted: false,
      failureCode: best.failureCode,
      message: best.message,
      anchors: anchors as NonNullable<(typeof anchors)[number]>[],
      featureCount,
      usableFeatureCount,
      inlierCount,
      inlierFraction,
      perAnchorFeatureCounts,
      perAnchorInlierCounts,
      medianReprojectionErrorPx,
      maxReprojectionErrorPx,
    },
  };
}
export type SpeedsterGeometryResponse = {
  width: number;
  height: number;
  corners: SpeedsterQuad | null;
  colorGeometry: SpeedsterColorGeometryProposal;
  colorGeometryReceipt: string;
};

export type SpeedsterPrepareResponse = {
  width: number;
  height: number;
  transform: readonly number[];
  borders: SpeedsterQuad;
  detectedBorders: readonly ("top" | "right" | "bottom" | "left")[];
  inspectionFrame: SpeedsterInspectionFrame;
  colorGeometry: SpeedsterColorGeometryProposal;
  colorGeometryReceipt: string;
};

export type SpeedsterColorGeometryResponse = {
  width: number;
  height: number;
  colorGeometry: SpeedsterColorGeometryProposal;
  colorGeometryReceipt: string;
};

type PreparedArtifact = "RECTIFIED" | "INSPECTION" | "NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL";
type ArtifactPlan = { storageKey: string; readUrl: string };
export type SpeedsterPreparedOutputPlan = Readonly<Record<PreparedArtifact, ArtifactPlan>>;

export const SPEEDSTER_IMAGE_REQUEST_TIMEOUT_MS = 65_000;

export type SpeedsterImageRequestOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export async function runSpeedsterImageRequest<T>(
  action: string,
  options: SpeedsterImageRequestOptions = {},
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? SPEEDSTER_IMAGE_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const abortFromCaller = () => {
    controller.abort(options.signal?.reason);
    rejectDeadline?.(new Error(`Speedster ${action} was interrupted. Your photos and current geometry are preserved; retry this step.`));
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline?.(new Error(`Speedster ${action} request deadline expired.`));
  }, timeoutMs);
  try {
    if (options.signal?.aborted) abortFromCaller();
    return await Promise.race([request(controller.signal), deadline]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Speedster ${action} timed out. Your photos and current geometry are preserved; retry this step.`);
    }
    if (controller.signal.aborted) {
      throw new Error(`Speedster ${action} was interrupted. Your photos and current geometry are preserved; retry this step.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fetchSpeedsterImageResponse(
  input: RequestInfo | URL,
  init: RequestInit,
  action: string,
  options: SpeedsterImageRequestOptions = {},
) {
  return runSpeedsterImageRequest(action, options, (signal) => fetch(input, { ...init, signal }));
}

async function fetchSpeedsterImageJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  action: string,
  options: SpeedsterImageRequestOptions = {},
): Promise<{ response: Response; payload: T }> {
  return runSpeedsterImageRequest(action, options, async (signal) => {
    const response = await fetch(input, { ...init, signal });
    let payload: T;
    try {
      payload = await response.json() as T;
    } catch (error) {
      if (signal.aborted) throw error;
      payload = {} as T;
    }
    return { response, payload };
  });
}

async function fetchSpeedsterImageJsonWithoutDeadline<T>(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ response: Response; payload: T }> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T;
  return { response, payload };
}

async function postImageAction<T>(
  token: string,
  action: ImageAction,
  body: Record<string, unknown>,
  options?: SpeedsterImageRequestOptions,
): Promise<T> {
  const input = `/api/admin/ai-grader-v2/image/${action}`;
  const init = {
    method: "POST",
    headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  };
  type FailurePayload = T & {
    message?: string;
    detail?: string;
    requestId?: string;
    registrationError?: unknown;
    registrationAuditWarning?: unknown;
  };
  let response: Response;
  let payload: FailurePayload;
  try {
    ({ response, payload } = options
      ? await fetchSpeedsterImageJson<FailurePayload>(input, init, action, options)
      : await fetchSpeedsterImageJsonWithoutDeadline<FailurePayload>(input, init));
  } catch (error) {
    if (action === "map-registration" && error instanceof TypeError) {
      const automaticMode = body.rescue !== true;
      throw new SpeedsterMapRegistrationRequestError(
        "CARD MAP registration received no HTTP response. Your photos and geometry are preserved.",
        {
          version: SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION,
          source: "CLIENT_NETWORK",
          code: "NETWORK_NO_HTTP_RESPONSE",
          httpStatus: null,
          retryable: automaticMode,
          requestId: null,
        },
      );
    }
    throw error;
  }
  if (!response.ok) {
    const operatorMessage = toCardMapOperatorMessage(payload.message ?? payload.detail ?? `Speedster ${action} failed.`);
    const requestId = typeof payload.requestId === "string" && /^[A-Za-z0-9-]{8,80}$/.test(payload.requestId)
      ? payload.requestId
      : null;
    const message = requestId && !operatorMessage.includes(requestId)
      ? `${operatorMessage} (request ${requestId})`
      : operatorMessage;
    const auditWarning = parseSpeedsterMapRegistrationAuditWarning(payload.registrationAuditWarning);
    if (
      action === "map-registration"
      && response.status === 422
      && payload
      && typeof payload === "object"
      && "registrationFailure" in payload
    ) {
      const side = body.side === "FRONT" || body.side === "BACK" ? body.side : null;
      const registrationFailure = side
        ? parseSpeedsterMapRegistrationFailurePayload(
            (payload as { registrationFailure: unknown }).registrationFailure,
            side,
          )
        : null;
      if (!registrationFailure) {
        throw new SpeedsterMapRegistrationRequestError(
          `CARD MAP registration returned malformed human-correction diagnostics (HTTP 422)${requestId ? ` (request ${requestId})` : ""}. No map was applied.`,
          {
            version: SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION,
            source: "CLIENT_PROTOCOL",
            code: "MALFORMED_REGISTRATION_FAILURE_DIAGNOSTICS",
            httpStatus: 422,
            retryable: false,
            requestId,
          },
          auditWarning,
        );
      }
      throw new SpeedsterMapRegistrationError(
        message,
        registrationFailure,
        requestId,
        auditWarning,
      );
    }
    if (action === "map-registration") {
      const registrationFailure = parseSpeedsterMapRegistrationRequestFailure(
        payload.registrationError,
        response.status,
        body.rescue !== true,
        requestId,
      );
      if (!registrationFailure) {
        throw new SpeedsterMapRegistrationRequestError(
          `CARD MAP registration returned contradictory or malformed error evidence (HTTP ${response.status})${requestId ? ` (request ${requestId})` : ""}. No map was applied.`,
          {
            version: SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION,
            source: "CLIENT_PROTOCOL",
            code: "CONTRADICTORY_OR_MALFORMED_ERROR_ENVELOPE",
            httpStatus: response.status,
            retryable: false,
            requestId,
          },
          auditWarning,
        );
      }
      throw new SpeedsterMapRegistrationRequestError(message, registrationFailure, auditWarning);
    }
    throw new Error(message);
  }
  if (action === "map-registration") {
    const warning = parseSpeedsterMapRegistrationAuditWarning(payload.registrationAuditWarning);
    const { registrationAuditWarning: _registrationAuditWarning, ...registration } = payload;
    if (warning) registrationAuditWarnings.set(registration, warning);
    return registration as T;
  }
  return payload;
}

export const speedsterImageService = {
  proposeGeometry(
    token: string,
    input: Readonly<{
      sessionId: string;
      side: SpeedsterCardSide;
      imageUrl: string;
      sourceImageStorageKey: string;
      matColor: SpeedsterMatColor;
    }>,
    options: SpeedsterImageRequestOptions = {},
  ) {
    return postImageAction<SpeedsterGeometryResponse>(token, "geometry", { ...input }, options);
  },
  prepare(
    token: string,
    imageUrl: string,
    binding: Readonly<{
      sessionId: string;
      side: SpeedsterCardSide;
      sourceImageStorageKey: string;
    }>,
    corners: SpeedsterQuad,
    matColor: SpeedsterMatColor,
    options?: SpeedsterImageRequestOptions,
  ) {
    return postImageAction<SpeedsterPrepareResponse>(token, "prepare", {
      imageUrl,
      ...binding,
      corners,
      matColor,
    }, options);
  },
  recoverColorGeometry(
    token: string,
    input: Readonly<{
      sessionId: string;
      side: SpeedsterCardSide;
      sourceImageStorageKey: string;
      mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
      matColor: SpeedsterMatColor;
      corners: SpeedsterQuad;
    }>,
    options: SpeedsterImageRequestOptions = {},
  ) {
    return postImageAction<SpeedsterColorGeometryResponse>(token, "color-geometry", input, options);
  },
  traceProposal(
    token: string,
    input: {
      sessionId: string;
      side: SpeedsterCardSide;
      findingId: string | null;
      stroke: {
        canonicalPoints: readonly SpeedsterCanonicalPixel[];
        strokeWidthPixels: number;
        strokeWidthMm: number;
        cropTransformVersion: "speedster-canonical-crop-affine-v1";
      };
      currentTraceWire: SpeedsterTraceBitmapWireV1 | null;
    },
    options?: SpeedsterImageRequestOptions,
  ) {
    return postImageAction<{ traceWire: SpeedsterTraceBitmapWireV1 }>(token, "trace-proposal", input, options);
  },
  registerMap(
    token: string,
    input: {
      sessionId: string;
      side: SpeedsterCardSide;
      currentPhysicalQuad: SpeedsterQuad;
      currentOriginalStorageKey: string;
      currentInspectionStorageKey: string;
      orchestration: SpeedsterMapRegistrationOrchestration;
    },
    options: SpeedsterImageRequestOptions = {},
  ) {
    return postImageAction<SpeedsterMapRegistration>(
      token,
      "map-registration",
      input,
      options,
    );
  },
  rescueMapRegistration(
    token: string,
    input: {
      sessionId: string;
      side: SpeedsterCardSide;
      currentPhysicalQuad: SpeedsterQuad;
      currentOriginalStorageKey: string;
      currentInspectionStorageKey: string;
      rescueAttemptId: string;
      automaticFailure: SpeedsterMapRegistrationFailure;
      correctedAnchors: readonly Readonly<{ anchorId: string; point: { x: number; y: number } }>[];
      orchestration: SpeedsterMapRegistrationOrchestration;
    },
    options: SpeedsterImageRequestOptions = {},
  ) {
    return postImageAction<SpeedsterMapRegistration>(
      token,
      "map-registration",
      { ...input, rescue: true },
      options,
    );
  },
};

export async function uploadSpeedsterOriginal(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  file: File;
  targetedRecapture?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ storageKey: string; readUrl: string }> {
  const { response: planResponse, payload: plan } = await fetchSpeedsterImageJson<{
    storageKey?: string;
    uploadUrl?: string;
    readUrl?: string;
    message?: string;
  }>("/api/admin/ai-grader-v2/upload-plan", {
    method: "POST",
    headers: buildAdminHeaders(input.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId: input.sessionId,
      side: input.side,
      kind: "ORIGINAL",
      contentType: input.file.type,
      ...(input.targetedRecapture ? { targetedRecapture: true } : {}),
    }),
  }, `${input.side.toLowerCase()} upload planning`, input);
  if (!planResponse.ok || !plan.storageKey || !plan.uploadUrl || !plan.readUrl) {
    throw new Error(toCardMapOperatorMessage(plan.message ?? "Speedster upload could not be prepared."));
  }

  const uploadResponse = await fetchSpeedsterImageResponse(plan.uploadUrl, {
    method: "PUT",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": input.file.type },
    body: input.file,
  }, `${input.side.toLowerCase()} original upload`, input);
  if (!uploadResponse.ok) throw new Error(`Speedster upload failed (HTTP ${uploadResponse.status}).`);
  return { storageKey: plan.storageKey, readUrl: plan.readUrl };
}

export async function planSpeedsterPreparedOutputs(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  sourceImageStorageKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SpeedsterPreparedOutputPlan> {
  const { response, payload } = await fetchSpeedsterImageJson<{
    outputs?: SpeedsterPreparedOutputPlan;
    message?: string;
  }>("/api/admin/ai-grader-v2/upload-plan", {
    method: "POST",
    headers: buildAdminHeaders(input.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId: input.sessionId,
      side: input.side,
      kind: "PREPARED",
      sourceImageStorageKey: input.sourceImageStorageKey,
    }),
  }, `${input.side.toLowerCase()} output planning`, input);
  if (!response.ok || !payload.outputs) {
    throw new Error(toCardMapOperatorMessage(payload.message ?? "Speedster output storage could not be prepared."));
  }
  return payload.outputs;
}
