import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { presignPrivateSpeedsterUploadUrl, presignReadUrl } from "../../../../../lib/server/storage";
import { sanitizeSpeedsterUnitQuad } from "../../../../../lib/ai-grader-v2/geometry";
import {
  parseSpeedsterReviewFindings,
  stripSpeedsterFindingPrivateFields,
} from "../../../../../lib/ai-grader-v2/review-findings";
import {
  decodeSpeedsterTraceBitmapWireV1,
  encodeSpeedsterTraceBitmapWireV1,
} from "../../../../../lib/ai-grader-v2/trace-bitmap-wire";
import {
  decodeSpeedsterTraceRleV1,
  encodeSpeedsterTraceRleV1,
  parseSpeedsterTraceRleV1,
} from "../../../../../lib/ai-grader-v2/trace-codec";
import { SPEEDSTER_REVIEW_VIEW_TYPES } from "../../../../../lib/ai-grader-v2/review-image-urls";
import {
  hashSpeedsterMapStorageEvidence,
  loadEffectiveActiveSpeedsterMapRevision,
  parseSpeedsterMapRegistration,
  speedsterMapMatchKeyHash,
  speedsterPhysicalQuadHash,
} from "../../../../../lib/server/speedsterCardTypeMaps";
import { canonicalizeSpeedsterSessionIdentity } from "../../../../../lib/ai-grader-v2/identity";
import {
  ensureSpeedsterRegistrationLessonEvidenceSnapshot,
  loadVerifiedSpeedsterRegistrationLessonCandidates,
  persistSpeedsterRegistrationLesson,
  type SpeedsterRegistrationLessonCandidate,
} from "../../../../../lib/server/speedsterMapRegistrationLessons";
import {
  speedsterCardTypeMapKey,
  type SpeedsterMapRegistrationFailure,
} from "../../../../../lib/ai-grader-v2/card-type-map-contracts";
import { issueSpeedsterMapRegistrationReceipt } from "../../../../../lib/server/speedsterMapRegistrationAuthority";
import {
  insertSpeedsterInstrumentationEventWithConflictDetection,
  speedsterMapRegistrationAttemptEvent,
  type SpeedsterMapRegistrationAttemptOutcome,
} from "../../../../../lib/server/aiGraderV2Instrumentation";
import {
  SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION,
  parseSpeedsterColorGeometryProposal,
  type SpeedsterColorGeometryMode,
  type SpeedsterMatColor,
} from "../../../../../lib/ai-grader-v2/color-geometry";
import {
  issueSpeedsterColorGeometryReceipt,
  type SpeedsterColorGeometryReceiptBinding,
} from "../../../../../lib/server/speedsterColorGeometryAuthority";
import {
  isAuthorizedSpeedsterOriginalStorageKey,
  isAuthorizedSpeedsterPreparedStorageKeys,
  isAuthorizedSpeedsterInspectionStorageKey,
  speedsterOriginalStorageGeneration,
  speedsterPreparedStorageKeys,
  speedsterPreparedStorageGenerationForInspection,
} from "../../../../../lib/server/aiGraderV2IphoneCapture";

const ACTIONS = new Set(["geometry", "prepare", "color-geometry", "trace-proposal", "map-registration"]);
export const SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT_MS = 55_000;
export const SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION = "speedster-map-registration-error-v1" as const;
export const SPEEDSTER_MAP_REGISTRATION_AUDIT_HEADER = "X-Speedster-Map-Registration-Audit" as const;
export const SPEEDSTER_MAP_REGISTRATION_AUDIT_WAIT_MS = 250;

type SpeedsterMapRegistrationErrorSource =
  | "PROVIDER_GATEWAY"
  | "PROVIDER"
  | "PROVIDER_NETWORK"
  | "TEN_KINGS_API";

export function speedsterMapRegistrationErrorEnvelope(input: Readonly<{
  source: SpeedsterMapRegistrationErrorSource;
  code: string;
  httpStatus: number | null;
  retryable: boolean;
  requestId: string;
}>) {
  return {
    version: SPEEDSTER_MAP_REGISTRATION_ERROR_VERSION,
    source: input.source,
    code: input.code,
    httpStatus: input.httpStatus,
    retryable: input.retryable,
    requestId: input.requestId,
  };
}

export function classifySpeedsterMapRegistrationUpstreamFailure(input: Readonly<{
  status: number;
  mode: "AUTOMATIC" | "HUMAN_RESCUE";
  requestId: string;
}>) {
  const gateway = input.status === 502 || input.status === 503;
  const source = gateway ? "PROVIDER_GATEWAY" as const : "PROVIDER" as const;
  const code = gateway ? `PROVIDER_GATEWAY_HTTP_${input.status}` : `PROVIDER_HTTP_${input.status}`;
  const retryable = input.mode === "AUTOMATIC" && gateway;
  return {
    source,
    code,
    retryable,
    ...(input.status === 402 ? {
      message: `CARD MAP provider rejected the request (HTTP 402) (request ${input.requestId}). No map was applied.`,
    } : {}),
    registrationError: speedsterMapRegistrationErrorEnvelope({
      source,
      code,
      httpStatus: input.status,
      retryable,
      requestId: input.requestId,
    }),
  };
}

export function speedsterMapRegistrationAuditFailureSignal(requestId: string) {
  return {
    headerValue: "write-failed" as const,
    responseFields: {
      registrationAuditWarning: {
        status: "WRITE_FAILED" as const,
        requestId,
      },
    },
  };
}

export function speedsterMapRegistrationTimeoutEnvelope(requestId: string) {
  return speedsterMapRegistrationErrorEnvelope({
    source: "PROVIDER",
    code: "PROVIDER_TIMEOUT",
    httpStatus: 504,
    retryable: false,
    requestId,
  });
}

export async function settleSpeedsterMapRegistrationAuditWrite(
  write: () => Promise<unknown>,
  waitMs = SPEEDSTER_MAP_REGISTRATION_AUDIT_WAIT_MS,
): Promise<"RECORDED" | "WRITE_FAILED" | "TIMED_OUT"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tracked = Promise.resolve().then(write).then(
    () => "RECORDED" as const,
    () => "WRITE_FAILED" as const,
  );
  const deadline = new Promise<"TIMED_OUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMED_OUT"), waitMs);
  });
  const result = await Promise.race([tracked, deadline]);
  if (timer) clearTimeout(timer);
  return result;
}

export class SpeedsterImageUpstreamTimeoutError extends Error {
  constructor(readonly action: string, readonly timeoutMs: number) {
    super(`Speedster ${action} upstream timed out after ${timeoutMs}ms.`);
    this.name = "SpeedsterImageUpstreamTimeoutError";
  }
}

export async function fetchSpeedsterImageUpstream(input: Readonly<{
  url: string;
  action: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}>): Promise<{ response: Response; payload: unknown }> {
  const timeoutMs = input.timeoutMs ?? SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline?.(new SpeedsterImageUpstreamTimeoutError(input.action, timeoutMs));
  }, timeoutMs);
  try {
    return await Promise.race([
      (async () => {
        const response = await (input.fetchImpl ?? fetch)(input.url, {
          method: "POST",
          headers: input.headers,
          body: input.body,
          signal: controller.signal,
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          payload = {};
        }
        return { response, payload };
      })(),
      deadline,
    ]);
  } catch (error) {
    if (timedOut) throw new SpeedsterImageUpstreamTimeoutError(input.action, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function speedsterServiceHeaders() {
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

type TraceEvidenceDependencies = {
  findOwnedCapture: (
    sessionId: string,
    createdByUserId: string,
  ) => Promise<{ capture: unknown; reviewedDefects?: unknown } | null>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
  presignUpload?: (storageKey: string, contentType: string) => Promise<string>;
  findOwnedMapSession?: (
    sessionId: string,
    createdByUserId: string,
  ) => Promise<{
    id: string;
    createdByUserId: string;
    cardProfile: string;
    workflowState: string;
    identity: unknown;
  } | null>;
  loadActiveMap?: typeof loadEffectiveActiveSpeedsterMapRevision;
  hashMapEvidence?: typeof hashSpeedsterMapStorageEvidence;
  loadRegistrationLessons?: typeof loadVerifiedSpeedsterRegistrationLessonCandidates;
  snapshotRegistrationEvidence?: typeof ensureSpeedsterRegistrationLessonEvidenceSnapshot;
};

const traceEvidenceDependencies: TraceEvidenceDependencies = {
  findOwnedCapture: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { capture: true, reviewedDefects: true },
  }),
  presignRead: presignReadUrl,
  presignUpload: (storageKey, contentType) => presignPrivateSpeedsterUploadUrl({
    storageKey,
    contentType,
  }),
  findOwnedMapSession: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
    },
  }),
  loadActiveMap: loadEffectiveActiveSpeedsterMapRevision,
  hashMapEvidence: hashSpeedsterMapStorageEvidence,
  loadRegistrationLessons: loadVerifiedSpeedsterRegistrationLessonCandidates,
  snapshotRegistrationEvidence: ensureSpeedsterRegistrationLessonEvidenceSnapshot,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSpeedsterMapRegistrationOrchestration(value: unknown) {
  if (!isRecord(value)
    || Object.keys(value).sort().join("\0") !== [
      "attemptNumber",
      "operationId",
      "successfulSiblingPreservedAtAttemptStart",
      "trigger",
    ].join("\0")
    || typeof value.operationId !== "string" || !UUID.test(value.operationId)
    || !Number.isSafeInteger(value.attemptNumber) || (value.attemptNumber as number) < 1 || (value.attemptNumber as number) > 50
    || !["INITIAL", "AUTOMATIC_RETRY", "MANUAL_RETRY", "HUMAN_RESCUE"].includes(String(value.trigger))
    || typeof value.successfulSiblingPreservedAtAttemptStart !== "boolean") {
    throw new Error("Speedster map registration orchestration metadata is invalid.");
  }
  return {
    operationId: value.operationId,
    attemptNumber: value.attemptNumber as number,
    trigger: value.trigger as "INITIAL" | "AUTOMATIC_RETRY" | "MANUAL_RETRY" | "HUMAN_RESCUE",
    successfulSiblingPreservedAtAttemptStart: value.successfulSiblingPreservedAtAttemptStart,
  };
}

export function resolveSpeedsterMapRegistrationOrchestration(
  value: unknown,
  mode: "AUTOMATIC" | "HUMAN_RESCUE",
  _requestId: string,
) {
  if (value === undefined) {
    throw new Error("This Speedster client is stale. Refresh the page before current-engine Card Map registration; no compatibility geometry was synthesized.");
  }
  const orchestration = parseSpeedsterMapRegistrationOrchestration(value);
  if ((mode === "HUMAN_RESCUE") !== (orchestration.trigger === "HUMAN_RESCUE")
    || (orchestration.trigger === "INITIAL" && (
      orchestration.attemptNumber !== 1
      || orchestration.successfulSiblingPreservedAtAttemptStart
    ))
    || (orchestration.trigger !== "INITIAL" && orchestration.attemptNumber < 2)) {
    throw new Error("Speedster map registration orchestration sequence is invalid.");
  }
  return { ...orchestration, orchestrationMetadataSource: "CLIENT_REPORTED" as const };
}

export function sanitizeSpeedsterGeometryPayload(
  payload: unknown,
  expected?: Readonly<{ mode: SpeedsterColorGeometryMode; matColor: SpeedsterMatColor }>,
): unknown {
  if (!isRecord(payload)) return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, "corners")) {
    throw new Error("Speedster physical geometry omitted its corner authority.");
  }
  const corners = payload.corners === null ? null : sanitizeSpeedsterUnitQuad(payload.corners);
  if (payload.corners !== null && !corners) {
    throw new Error("Speedster physical geometry returned an invalid perimeter quad.");
  }
  if (!expected) return { ...payload, corners };
  const colorGeometry = parseSpeedsterColorGeometryProposal(payload.colorGeometry, expected);
  if (colorGeometry.engineVersion !== SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION) {
    throw new Error("The retired Color Geometry engine cannot enter a new grade. Refresh after the current service is live; no old-engine result was accepted.");
  }
  if ((colorGeometry.outcome === "ACCEPTED") !== Boolean(corners)) {
    throw new Error("Speedster physical geometry corners contradict the Color outcome authority.");
  }
  if (colorGeometry.outcome === "ACCEPTED"
    && JSON.stringify(corners) !== JSON.stringify(colorGeometry.proposal)) {
    throw new Error("Speedster physical geometry does not match its accepted color proposal.");
  }
  return {
    ...payload,
    corners,
    colorGeometry,
  };
}

export function sanitizeSpeedsterPreparePayload(
  payload: unknown,
  expected: Readonly<{ matColor: SpeedsterMatColor }>,
): unknown {
  if (!isRecord(payload)) return payload;
  const borders = payload.borders === null ? null : sanitizeSpeedsterUnitQuad(payload.borders);
  if (payload.borders !== null && !borders) throw new Error("Speedster prepare returned malformed centering geometry.");
  const colorGeometry = parseSpeedsterColorGeometryProposal(payload.colorGeometry, {
    mode: "PRINTED_FRAME",
    matColor: expected.matColor,
  });
  if (colorGeometry.engineVersion !== SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION) {
    throw new Error("The retired Color Geometry engine cannot enter a new grade. Refresh after the current service is live; no old-engine result was accepted.");
  }
  if (colorGeometry.outcome === "ACCEPTED"
    && JSON.stringify(borders) !== JSON.stringify(colorGeometry.proposal)) {
    throw new Error("Speedster centering geometry does not match its accepted color proposal.");
  }
  if (colorGeometry.outcome !== "ACCEPTED" && borders !== null) {
    throw new Error("Speedster prepare returned hidden centering fallback geometry.");
  }
  return {
    ...payload,
    borders,
    colorGeometry,
  };
}

export function sanitizeSpeedsterColorGeometryPayload(
  payload: unknown,
  expected: Readonly<{ mode: SpeedsterColorGeometryMode; matColor: SpeedsterMatColor }>,
): unknown {
  if (!isRecord(payload)) return payload;
  const colorGeometry = parseSpeedsterColorGeometryProposal(payload.colorGeometry, expected);
  if (colorGeometry.engineVersion !== SPEEDSTER_COLOR_GEOMETRY_ENGINE_VERSION) {
    throw new Error("The retired Color Geometry engine cannot enter a new grade. Refresh after the current service is live; no old-engine result was accepted.");
  }
  return {
    ...payload,
    colorGeometry,
  };
}

function sanitizedUpstreamText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted-credential]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted-credential]")
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi, "[redacted-image]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
  return sanitized || undefined;
}

export function sanitizeSpeedsterTraceProposalFailure(
  payload: unknown,
  requestId: string,
) {
  const fields = isRecord(payload) ? payload : {};
  const detail = isRecord(fields.detail) ? fields.detail : null;
  const upstream = sanitizedUpstreamText(
    detail?.message ?? fields.detail ?? fields.message,
    300,
  )?.replace(/[.]+$/, "");
  return {
    message: `SAM proposal failed: ${upstream ?? "upstream service error"} (request ${requestId}).`,
    requestId,
  };
}

export function sanitizeSpeedsterImageFailure(
  payload: unknown,
  action: string,
  requestId: string,
) {
  const fields = isRecord(payload) ? payload : {};
  const detail = isRecord(fields.detail) ? fields.detail : null;
  const upstream = sanitizedUpstreamText(
    detail?.message ?? fields.detail ?? fields.message,
    300,
  )?.replace(/[.]+$/, "");
  return {
    message: `Speedster ${action} failed: ${upstream ?? "upstream service error"} (request ${requestId}).`,
    requestId,
  };
}

const finiteDiagnosticPoint = (value: unknown) => {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number"
    || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
};

export function parseSpeedsterRegistrationFailure(value: unknown): SpeedsterMapRegistrationFailure {
  const failure = isRecord(value) ? value : null;
  const best = failure && isRecord(failure.bestCandidate) ? failure.bestCandidate : null;
  const binding = failure && isRecord(failure.binding) ? failure.binding : null;
  if (
    !failure || !best || !binding
    || failure.algorithmVersion !== "opencv-redundant-ransac-registration-v2"
    || failure.policyVersion !== "speedster-map-registration-acceptance-v2"
    || failure.accepted !== false
    || typeof failure.failureCode !== "string"
    || typeof failure.message !== "string"
    || !Number.isSafeInteger(failure.candidateCount)
    || (failure.candidateCount as number) < 1 || (failure.candidateCount as number) > 4
    || !Array.isArray(failure.candidateIds)
    || failure.candidateIds.length !== failure.candidateCount
    || failure.candidateIds.some((entry) => typeof entry !== "string" || !entry || entry.length > 80)
    || failure.candidateIds[0] !== "original-reference"
    || new Set(failure.candidateIds).size !== failure.candidateIds.length
    || (binding.side !== "FRONT" && binding.side !== "BACK")
    || typeof binding.mapRevisionId !== "string" || !binding.mapRevisionId || binding.mapRevisionId.length > 100
    || typeof binding.currentInspectionSha256 !== "string" || !SHA256_HEX.test(binding.currentInspectionSha256)
    || typeof binding.currentPhysicalQuadSha256 !== "string" || !SHA256_HEX.test(binding.currentPhysicalQuadSha256)
    || !Array.isArray(binding.candidates) || binding.candidates.length !== failure.candidateCount
    || typeof best.candidateId !== "string"
    || !failure.candidateIds.includes(best.candidateId)
    || (best.provenance !== "ORIGINAL_REFERENCE" && best.provenance !== "REGISTRATION_LESSON")
    || best.accepted !== false
    || typeof best.failureCode !== "string"
    || typeof best.message !== "string"
    || !Array.isArray(best.anchors) || best.anchors.length !== 4
  ) throw new Error("Map registration failure diagnostics were malformed.");
  const bindingCandidates = binding.candidates.map((entry) => {
    if (!isRecord(entry)
      || typeof entry.candidateId !== "string" || !entry.candidateId || entry.candidateId.length > 80
      || typeof entry.referenceInspectionSha256 !== "string"
      || !SHA256_HEX.test(entry.referenceInspectionSha256)) {
      throw new Error("Map registration failure binding was malformed.");
    }
    return {
      candidateId: entry.candidateId,
      referenceInspectionSha256: entry.referenceInspectionSha256,
    };
  });
  if (bindingCandidates.map(({ candidateId }) => candidateId).join("\0")
    !== failure.candidateIds.join("\0")) {
    throw new Error("Map registration failure binding was malformed.");
  }
  const integer = (entry: unknown, maximum = 100) => (
    Number.isSafeInteger(entry) && (entry as number) >= 0 && (entry as number) <= maximum
      ? entry as number
      : (() => { throw new Error("Map registration failure diagnostics were malformed."); })()
  );
  const fraction = (entry: unknown) => (
    typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && entry <= 1
      ? entry
      : (() => { throw new Error("Map registration failure diagnostics were malformed."); })()
  );
  const nullableError = (entry: unknown) => entry === null
    ? null
    : typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && entry <= 10_000
      ? entry
      : (() => { throw new Error("Map registration failure diagnostics were malformed."); })();
  const countVector = (entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 4) throw new Error("Map registration failure diagnostics were malformed.");
    return entry.map((count) => integer(count)) as [number, number, number, number];
  };
  const anchors = best.anchors.map((entry) => {
    if (!isRecord(entry) || typeof entry.anchorId !== "string"
      || !entry.anchorId || entry.anchorId.length > 80
      || !isRecord(entry.expectedPoint)
      || typeof entry.expectedPoint.x !== "number" || typeof entry.expectedPoint.y !== "number"
      || !Number.isFinite(entry.expectedPoint.x) || !Number.isFinite(entry.expectedPoint.y)
      || entry.expectedPoint.x < 0 || entry.expectedPoint.x > 1
      || entry.expectedPoint.y < 0 || entry.expectedPoint.y > 1
      || !["TRACKED", "LOW_CONFIDENCE", "FAILED", "OUT_OF_CARD"].includes(String(entry.status))) {
      throw new Error("Map registration failure anchor diagnostics were malformed.");
    }
    const trackedPoint = entry.trackedPoint === null ? null : finiteDiagnosticPoint(entry.trackedPoint);
    const locatedPoint = entry.locatedPoint === null ? null : finiteDiagnosticPoint(entry.locatedPoint);
    if ((entry.trackedPoint !== null && !trackedPoint) || (entry.locatedPoint !== null && !locatedPoint)) {
      throw new Error("Map registration failure anchor diagnostics were malformed.");
    }
    return {
      anchorId: entry.anchorId.slice(0, 80),
      expectedPoint: { x: entry.expectedPoint.x, y: entry.expectedPoint.y },
      trackedPoint,
      locatedPoint,
      score: fraction(entry.score),
      status: entry.status as "TRACKED" | "LOW_CONFIDENCE" | "FAILED" | "OUT_OF_CARD",
    };
  });
  if (new Set(anchors.map(({ anchorId }) => anchorId)).size !== 4) {
    throw new Error("Map registration failure anchor diagnostics were malformed.");
  }
  return {
    algorithmVersion: "opencv-redundant-ransac-registration-v2",
    policyVersion: "speedster-map-registration-acceptance-v2",
    accepted: false,
    failureCode: failure.failureCode.slice(0, 100),
    message: sanitizedUpstreamText(failure.message, 240) ?? "Registration did not pass acceptance policy.",
    candidateCount: integer(failure.candidateCount, 4),
    candidateIds: failure.candidateIds as string[],
    binding: {
      side: binding.side,
      mapRevisionId: binding.mapRevisionId,
      currentInspectionSha256: binding.currentInspectionSha256,
      currentPhysicalQuadSha256: binding.currentPhysicalQuadSha256,
      candidates: bindingCandidates,
    },
    bestCandidate: {
      candidateId: best.candidateId.slice(0, 80),
      provenance: best.provenance,
      accepted: false,
      failureCode: best.failureCode.slice(0, 100),
      message: sanitizedUpstreamText(best.message, 240) ?? "Registration candidate failed.",
      anchors,
      featureCount: integer(best.featureCount),
      usableFeatureCount: integer(best.usableFeatureCount),
      inlierCount: integer(best.inlierCount),
      inlierFraction: fraction(best.inlierFraction),
      perAnchorFeatureCounts: countVector(best.perAnchorFeatureCounts),
      perAnchorInlierCounts: countVector(best.perAnchorInlierCounts),
      medianReprojectionErrorPx: nullableError(best.medianReprojectionErrorPx),
      maxReprojectionErrorPx: nullableError(best.maxReprojectionErrorPx),
    },
  };
}

export function selectSpeedsterRegistrationLessonCandidates(
  available: readonly SpeedsterRegistrationLessonCandidate[],
  automaticFailure?: SpeedsterMapRegistrationFailure,
) {
  if (!automaticFailure) return available;
  const candidateIds = automaticFailure.candidateIds;
  if (candidateIds[0] !== "original-reference" || new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Registration rescue candidate provenance is invalid.");
  }
  const availableById = new Map(available.map((candidate) => [candidate.lessonId, candidate]));
  const selected = candidateIds.slice(1).map((candidateId) => availableById.get(candidateId));
  if (selected.some((candidate) => !candidate)) {
    throw new Error("Registration rescue candidate evidence is no longer available.");
  }
  return selected as readonly SpeedsterRegistrationLessonCandidate[];
}

export function assertSpeedsterRegistrationCandidateAuthority(
  registration: ReturnType<typeof parseSpeedsterMapRegistration>,
  serviceRequestBody: Record<string, unknown>,
  rescue: boolean,
) {
  if (registration.version !== "opencv-redundant-ransac-registration-v2") return;
  const provenance = registration.candidateProvenance;
  if (!provenance) throw new Error("Registration result lacks candidate provenance.");
  if (provenance.source === "ORIGINAL_REFERENCE") {
    if (rescue || provenance.candidateId !== "original-reference" || provenance.lessonId !== undefined) {
      throw new Error("Registration result does not match the exact original-reference authority.");
    }
    return;
  }
  if (provenance.source === "REGISTRATION_LESSON") {
    const roster = Array.isArray(serviceRequestBody.lessonCandidates)
      ? serviceRequestBody.lessonCandidates
      : [];
    const authorized = provenance.lessonId === provenance.candidateId && roster.some((candidate) => (
      isRecord(candidate)
      && candidate.candidateId === provenance.candidateId
      && typeof candidate.referenceInspectionSha256 === "string"
      && /^[a-f0-9]{64}$/.test(candidate.referenceInspectionSha256)
    ));
    if (rescue || !authorized) {
      throw new Error("Registration result selected a lesson outside the exact server-verified candidate roster.");
    }
    return;
  }
  if (!rescue || provenance.source !== "HUMAN_CORRECTION"
    || !provenance.lessonId || provenance.candidateId !== provenance.lessonId) {
    throw new Error("Human registration result lacks the exact persisted lesson authority.");
  }
}

export async function speedsterServiceBody(
  action: string,
  body: Record<string, unknown>,
  createdByUserId?: string,
  evidenceDeps: TraceEvidenceDependencies = traceEvidenceDependencies,
  requestTraceId?: string,
) {
  if ((action === "geometry" || action === "prepare" || action === "color-geometry") && createdByUserId) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const side = body.side === "FRONT" || body.side === "BACK" ? body.side : null;
    const matColor = body.matColor === "BLACK" || body.matColor === "WHITE" || body.matColor === "MAGENTA"
      ? body.matColor
      : null;
    const sourceImageStorageKey = typeof body.sourceImageStorageKey === "string"
      ? body.sourceImageStorageKey.trim()
      : "";
    if (action === "prepare" && body.outputUploads !== undefined) {
      throw new Error("Browser-selected Speedster prepared output destinations are not accepted.");
    }
    const authorizedSource = side ? isAuthorizedSpeedsterOriginalStorageKey({
      storageKey: sourceImageStorageKey,
      userId: createdByUserId,
      sessionId,
      side,
    }) : false;
    const findOwnedMapSession = evidenceDeps.findOwnedMapSession ?? traceEvidenceDependencies.findOwnedMapSession;
    const hashEvidence = evidenceDeps.hashMapEvidence ?? traceEvidenceDependencies.hashMapEvidence;
    if (!sessionId || !side || !matColor || !authorizedSource
      || !findOwnedMapSession || !hashEvidence) {
      throw new Error("Speedster color geometry source binding is invalid.");
    }
    const session = await findOwnedMapSession(sessionId, createdByUserId);
    if (!session || session.workflowState !== "DRAFT") {
      throw new Error("Speedster color geometry draft was not found.");
    }
    const sourceImageSha256 = await hashEvidence(sourceImageStorageKey);
    if (!SHA256_HEX.test(sourceImageSha256)) {
      throw new Error("Speedster color geometry source image hash is unavailable.");
    }
    const base = {
      imageUrl: await evidenceDeps.presignRead(sourceImageStorageKey, 60 * 10),
      matColor,
    };
    if (action === "geometry") {
      return {
        ...base,
        colorGeometryAuthorityBinding: {
          sessionId,
          side,
          mode: "PHYSICAL_OUTER",
          sourceImageStorageKey,
          sourceImageSha256,
          matColor,
          physicalQuadSha256: null,
        },
      };
    }
    const corners = sanitizeSpeedsterUnitQuad(body.corners);
    if (!corners || JSON.stringify(corners) !== JSON.stringify(body.corners)) {
      throw new Error("Speedster printed-frame rectification input is invalid.");
    }
    if (action === "color-geometry") {
      const mode = body.mode === "PHYSICAL_OUTER" || body.mode === "PRINTED_FRAME"
        ? body.mode
        : null;
      if (!mode) throw new Error("Speedster color geometry recovery mode is invalid.");
      if (mode === "PHYSICAL_OUTER") {
        return {
          ...base,
          mode,
          colorGeometryAuthorityBinding: {
            sessionId,
            side,
            mode,
            sourceImageStorageKey,
            sourceImageSha256,
            matColor,
            physicalQuadSha256: null,
          },
        };
      }
      return {
        ...base,
        mode,
        corners,
        colorGeometryAuthorityBinding: {
          sessionId,
          side,
          mode,
          sourceImageStorageKey,
          sourceImageSha256,
          matColor,
          physicalQuadSha256: speedsterPhysicalQuadHash(corners),
        },
      };
    }
    const sourceGeneration = speedsterOriginalStorageGeneration({
      storageKey: sourceImageStorageKey,
      userId: createdByUserId,
      sessionId,
      side,
    });
    const presignPreparedUpload = evidenceDeps.presignUpload
      ?? (evidenceDeps === traceEvidenceDependencies ? traceEvidenceDependencies.presignUpload : undefined);
    if (sourceGeneration === undefined || !presignPreparedUpload) {
      throw new Error("Speedster printed-frame output authority is unavailable.");
    }
    const preparedKeys = speedsterPreparedStorageKeys(
      createdByUserId,
      sessionId,
      side,
      sourceGeneration ?? undefined,
    );
    const [rectified, inspection, normalized, microDefect, directional] = await Promise.all([
      presignPreparedUpload(preparedKeys.RECTIFIED, "image/webp"),
      presignPreparedUpload(preparedKeys.INSPECTION, "image/webp"),
      presignPreparedUpload(preparedKeys.NORMALIZED, "image/webp"),
      presignPreparedUpload(preparedKeys.MICRO_DEFECT, "image/webp"),
      presignPreparedUpload(preparedKeys.DIRECTIONAL, "image/webp"),
    ]);
    return {
      ...base,
      corners,
      outputUploads: {
        rectified,
        inspection,
        normalized,
        microDefect,
        directional,
      },
      colorGeometryAuthorityBinding: {
        sessionId,
        side,
        mode: "PRINTED_FRAME",
        sourceImageStorageKey,
        sourceImageSha256,
        matColor,
        physicalQuadSha256: speedsterPhysicalQuadHash(corners),
      },
    };
  }
  if (action === "map-registration" && createdByUserId) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const side = body.side === "FRONT" || body.side === "BACK" ? body.side : null;
    const rawQuad = body.currentPhysicalQuad;
    const currentPhysicalQuad = sanitizeSpeedsterUnitQuad(rawQuad);
    const currentInspectionStorageKey = typeof body.currentInspectionStorageKey === "string"
      ? body.currentInspectionStorageKey.trim()
      : "";
    const currentOriginalStorageKey = typeof body.currentOriginalStorageKey === "string"
      ? body.currentOriginalStorageKey.trim()
      : "";
    if (!sessionId || !side || !currentPhysicalQuad || JSON.stringify(currentPhysicalQuad) !== JSON.stringify(rawQuad)
      || !isAuthorizedSpeedsterInspectionStorageKey({
        storageKey: currentInspectionStorageKey,
        userId: createdByUserId,
        sessionId,
        side: side ?? "FRONT",
      }) || !isAuthorizedSpeedsterOriginalStorageKey({
        storageKey: currentOriginalStorageKey,
        userId: createdByUserId,
        sessionId,
        side: side ?? "FRONT",
      }) || speedsterOriginalStorageGeneration({
        storageKey: currentOriginalStorageKey,
        userId: createdByUserId,
        sessionId,
        side: side ?? "FRONT",
      }) !== speedsterPreparedStorageGenerationForInspection({
        storageKey: currentInspectionStorageKey,
        userId: createdByUserId,
        sessionId,
        side: side ?? "FRONT",
      })) {
      throw new Error("Speedster map registration request is invalid.");
    }
    const findOwnedMapSession = evidenceDeps.findOwnedMapSession ?? traceEvidenceDependencies.findOwnedMapSession;
    const loadActiveMap = evidenceDeps.loadActiveMap ?? traceEvidenceDependencies.loadActiveMap;
    const hashMapEvidence = evidenceDeps.hashMapEvidence ?? traceEvidenceDependencies.hashMapEvidence;
    const loadRegistrationLessons = evidenceDeps.loadRegistrationLessons
      ?? (evidenceDeps === traceEvidenceDependencies
        ? traceEvidenceDependencies.loadRegistrationLessons
        : async () => []);
    const snapshotRegistrationEvidence = evidenceDeps.snapshotRegistrationEvidence
      ?? (evidenceDeps === traceEvidenceDependencies
        ? traceEvidenceDependencies.snapshotRegistrationEvidence
        : undefined);
    if (!findOwnedMapSession || !loadActiveMap || !hashMapEvidence || !loadRegistrationLessons) {
      throw new Error("Speedster map registration dependencies are unavailable.");
    }
    const session = await findOwnedMapSession(sessionId, createdByUserId);
    if (!session || (session.workflowState !== "DRAFT" && session.workflowState !== "CAPTURED")) {
      throw new Error("Speedster map registration session was not found.");
    }
    if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
      throw new Error("Speedster map registration category is unsupported.");
    }
    const identity = canonicalizeSpeedsterSessionIdentity(session.cardProfile, session.identity);
    const selectedMap = await loadActiveMap({ cardProfile: session.cardProfile, identity });
    if (!selectedMap) throw new Error("No active CARD MAP exists for this card identity.");
    const revision = selectedMap.revision;
    const mapSide = side === "FRONT" ? revision.frontMap : revision.backMap;
    if (mapSide.side !== side) throw new Error("Active TRAIN map side is incoherent.");
    const preparedCurrentStorageKey = currentInspectionStorageKey;
    const [referenceSha256, currentInspectionSha256] = await Promise.all([
      hashMapEvidence(mapSide.referenceInspection.storageKey),
      hashMapEvidence(preparedCurrentStorageKey),
    ]);
    if (referenceSha256 !== mapSide.referenceInspection.sha256) {
      throw new Error("Active TRAIN map reference evidence failed hash verification.");
    }
    const rescue = body.rescue === true;
    let correctedAnchors: Array<{ id: string; point: { x: number; y: number } }> | undefined;
    let automaticFailure: SpeedsterMapRegistrationFailure | undefined;
    let rescueAttemptId: string | undefined;
    if (rescue) {
      automaticFailure = parseSpeedsterRegistrationFailure(body.automaticFailure);
      rescueAttemptId = typeof body.rescueAttemptId === "string" ? body.rescueAttemptId.trim() : "";
      const currentPhysicalQuadSha256 = speedsterPhysicalQuadHash(currentPhysicalQuad);
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(rescueAttemptId)
        || automaticFailure.binding.side !== side
        || automaticFailure.binding.mapRevisionId !== revision.revisionId
        || automaticFailure.binding.currentInspectionSha256 !== currentInspectionSha256
        || automaticFailure.binding.currentPhysicalQuadSha256 !== currentPhysicalQuadSha256
        || automaticFailure.binding.candidates[0]?.candidateId !== "original-reference"
        || automaticFailure.binding.candidates[0]?.referenceInspectionSha256 !== referenceSha256) {
        throw new Error("Registration rescue no longer matches the active map revision and exact evidence. Run registration again; no lesson was saved.");
      }
      if (!Array.isArray(body.correctedAnchors) || body.correctedAnchors.length !== 4) {
        throw new Error("Speedster map registration rescue requires four corrected anchors.");
      }
      correctedAnchors = body.correctedAnchors.map((entry, index) => {
        if (!isRecord(entry) || typeof entry.anchorId !== "string" || !isRecord(entry.point)
          || typeof entry.point.x !== "number" || typeof entry.point.y !== "number"
          || !Number.isFinite(entry.point.x) || !Number.isFinite(entry.point.y)
          || entry.point.x < 0 || entry.point.x > 1 || entry.point.y < 0 || entry.point.y > 1) {
          throw new Error(`Corrected registration anchor ${index + 1} must be inside the current physical card.`);
        }
        return { id: entry.anchorId, point: { x: entry.point.x, y: entry.point.y } };
      });
      if (correctedAnchors.map(({ id }) => id).join("\0") !== mapSide.anchors.map(({ id }) => id).join("\0")) {
        throw new Error("Corrected registration anchor identities do not match the immutable map.");
      }
    }
    const availableLessonCandidates = await loadRegistrationLessons({
      mapRevisionId: revision.revisionId,
      side,
      expectedAnchors: mapSide.anchors.map(({ id, point }) => ({ id, point })),
      hashEvidence: hashMapEvidence,
    });
    const lessonCandidates = selectSpeedsterRegistrationLessonCandidates(
      availableLessonCandidates,
      automaticFailure,
    );
    const expectedBindingCandidates = [
      { candidateId: "original-reference", referenceInspectionSha256: referenceSha256 },
      ...lessonCandidates.map((candidate) => ({
        candidateId: candidate.lessonId,
        referenceInspectionSha256: candidate.currentInspectionSha256,
      })),
    ];
    if (automaticFailure
      && JSON.stringify(automaticFailure.binding.candidates) !== JSON.stringify(expectedBindingCandidates)) {
      throw new Error("Registration rescue candidate evidence no longer matches the original failure. Run registration again; no lesson was saved.");
    }
    let currentStorageKey = preparedCurrentStorageKey;
    let lessonEvidenceStorageKey: string | undefined;
    if (automaticFailure) {
      if (!snapshotRegistrationEvidence || !rescueAttemptId) {
        throw new Error("Registration rescue immutable evidence storage is unavailable.");
      }
      const snapshot = await snapshotRegistrationEvidence({
        operatorAdminId: createdByUserId,
        evidenceSessionId: sessionId,
        mapRevisionId: revision.revisionId,
        side,
        rescueAttemptId,
        sourceStorageKey: preparedCurrentStorageKey,
        expectedSha256: currentInspectionSha256,
        hashEvidence: hashMapEvidence,
      });
      currentStorageKey = snapshot.storageKey;
      lessonEvidenceStorageKey = snapshot.storageKey;
    }
    const lessonRequests = await Promise.all(lessonCandidates.map(async (candidate) => ({
      candidateId: candidate.lessonId,
      referenceInspectionSha256: candidate.currentInspectionSha256,
      referenceImage: { imageUrl: await evidenceDeps.presignRead(candidate.currentInspectionKey, 60 * 10) },
      anchors: candidate.anchors,
      sourceHomography: candidate.sourceHomography,
    })));
    return {
      referenceImage: {
        imageUrl: await evidenceDeps.presignRead(mapSide.referenceInspection.storageKey, 60 * 10),
      },
      currentImage: {
        imageUrl: await evidenceDeps.presignRead(currentStorageKey, 60 * 10),
      },
      mapId: revision.mapId,
      mapRevisionId: revision.revisionId,
      side,
      currentPhysicalQuadSha256: speedsterPhysicalQuadHash(currentPhysicalQuad),
      currentInspectionSha256,
      referenceInspectionSha256: referenceSha256,
      anchors: mapSide.anchors.map(({ id, point }) => ({ id, point })),
      designBoundary: mapSide.designBoundary,
      zones: mapSide.zones,
      lessonCandidates: lessonRequests,
      ...(correctedAnchors ? { correctedAnchors } : {}),
      ...(automaticFailure ? { automaticFailure } : {}),
      ...(lessonEvidenceStorageKey ? { lessonEvidenceStorageKey } : {}),
      ...(automaticFailure ? { lessonMapMatchKeyHash: revision.matchKeyHash } : {}),
      ...(automaticFailure ? { lessonMapScope: selectedMap.appliedScope } : {}),
      ...(automaticFailure ? {
        lessonExactMatchKeyHash: speedsterMapMatchKeyHash(speedsterCardTypeMapKey(session.cardProfile, identity)),
      } : {}),
    };
  }
  if (action === "trace-proposal" && createdByUserId) {
    const { sessionId, currentTraceWire, ...proposal } = body;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("Speedster trace proposal requires an owned session.");
    }
    const side = proposal.side === "FRONT" || proposal.side === "BACK" ? proposal.side : null;
    if (!side) throw new Error("Speedster trace proposal side is invalid.");
    const owned = await evidenceDeps.findOwnedCapture(sessionId.trim(), createdByUserId);
    if (!owned) throw new Error("Speedster trace proposal session was not found.");
    const capture = isRecord(owned.capture) ? owned.capture : null;
    const cornerShape = capture?.cornerShape === "SQUARE" || capture?.cornerShape === "ROUNDED_3_18_MM"
      ? capture.cornerShape
      : null;
    const persistedSide = capture && isRecord(capture[side.toLowerCase()])
      ? capture[side.toLowerCase()] as Record<string, unknown>
      : null;
    const reviewedDefects = parseSpeedsterReviewFindings(owned.reviewedDefects ?? []);
    const findingId = proposal.findingId === null
      ? null
      : typeof proposal.findingId === "string" && proposal.findingId.trim()
        ? proposal.findingId.trim()
        : undefined;
    if (findingId === undefined) throw new Error("Speedster trace proposal finding ID is invalid.");
    const target = findingId === null
      ? null
      : reviewedDefects.find((finding) => finding.id === findingId);
    if (findingId !== null && (!target || target.side !== side || target.reviewResult === "REMOVED")) {
      throw new Error("Speedster trace proposal finding is not active on this side.");
    }
    const sourceViewId = target?.sourceViewId ?? `${side}:ORIGINAL`;
    const view = sourceViewId.startsWith(`${side}:`)
      ? sourceViewId.slice(side.length + 1)
      : null;
    if (!SPEEDSTER_REVIEW_VIEW_TYPES.includes(view as typeof SPEEDSTER_REVIEW_VIEW_TYPES[number])) {
      throw new Error("Speedster trace proposal source view is invalid.");
    }
    const persistedViewKeys = isRecord(persistedSide?.viewStorageKeys) ? persistedSide.viewStorageKeys : null;
    const persistedKeys = {
      ORIGINAL: persistedSide?.inspectionStorageKey,
      NORMALIZED: persistedViewKeys?.NORMALIZED,
      MICRO_DEFECT: persistedViewKeys?.MICRO_DEFECT,
      DIRECTIONAL: persistedViewKeys?.DIRECTIONAL,
    };
    if (
      typeof persistedSide?.rectifiedStorageKey !== "string"
      || typeof persistedKeys.ORIGINAL !== "string"
      || typeof persistedKeys.NORMALIZED !== "string"
      || typeof persistedKeys.MICRO_DEFECT !== "string"
      || typeof persistedKeys.DIRECTIONAL !== "string"
      || !isAuthorizedSpeedsterPreparedStorageKeys({
        userId: createdByUserId,
        sessionId: sessionId.trim(),
        side,
        rectifiedStorageKey: persistedSide.rectifiedStorageKey,
        inspectionStorageKey: persistedKeys.ORIGINAL,
        viewStorageKeys: {
          NORMALIZED: persistedKeys.NORMALIZED,
          MICRO_DEFECT: persistedKeys.MICRO_DEFECT,
          DIRECTIONAL: persistedKeys.DIRECTIONAL,
        },
      }) ||
      !cornerShape || !isRecord(persistedSide?.inspectionFrame)
    ) {
      throw new Error("Speedster trace proposal evidence is not owned by this session.");
    }
    const expectedStorageKey = persistedKeys[view as keyof typeof persistedKeys] as string;
    const currentTrace = currentTraceWire === null || currentTraceWire === undefined
      ? null
      : encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(currentTraceWire));
    return {
      side,
      cornerShape,
      evidenceView: {
        id: sourceViewId,
        imageUrl: await evidenceDeps.presignRead(expectedStorageKey, 60 * 10),
        inspectionFrame: persistedSide.inspectionFrame,
      },
      findingId,
      sourceViewId,
      stroke: proposal.stroke,
      currentTrace,
      findings: reviewedDefects
        .filter((finding) => finding.side === side && finding.reviewResult !== "REMOVED" && finding.id !== findingId)
        .map(stripSpeedsterFindingPrivateFields),
      ...(requestTraceId ? { requestTraceId } : {}),
    };
  }
  return body;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const requestTraceId = randomUUID();
  const requestStartedAtMs = Date.now();
  const requestedAction = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const requestedSide = req.body?.side === "FRONT" || req.body?.side === "BACK" ? req.body.side : null;
  const requestedSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
  const requestedMode = req.body?.rescue === true ? "HUMAN_RESCUE" as const : "AUTOMATIC" as const;
  let registrationContext: Readonly<{
    sessionId: string;
    createdByUserId: string;
    side: "FRONT" | "BACK";
    mode: "AUTOMATIC" | "HUMAN_RESCUE";
    operationId: string;
    attemptNumber: number;
    trigger: "INITIAL" | "AUTOMATIC_RETRY" | "MANUAL_RETRY" | "HUMAN_RESCUE";
    orchestrationMetadataSource: "CLIENT_REPORTED" | "SERVER_STALE_CLIENT_COMPATIBILITY";
    mapRevisionId: string;
    currentInspectionSha256: string;
    currentPhysicalQuadSha256: string;
    successfulSiblingPreservedAtAttemptStart: boolean;
  }> | null = null;
  let registrationUpstreamStarted = false;
  let registrationUpstreamCompleted = false;
  let registrationAuditWarning: Readonly<{
    status: "WRITE_FAILED";
    requestId: string;
  }> | null = null;
  const registrationAuditResponseFields = () => registrationAuditWarning
    ? { registrationAuditWarning }
    : {};
  const recordRegistrationAttempt = async (result: SpeedsterMapRegistrationAttemptOutcome) => {
    if (!registrationContext) return;
    const attemptEvent = speedsterMapRegistrationAttemptEvent({
        ...registrationContext,
        requestId: requestTraceId,
        durationMs: Date.now() - requestStartedAtMs,
        result,
      });
    const auditResult = await settleSpeedsterMapRegistrationAuditWrite(
      () => insertSpeedsterInstrumentationEventWithConflictDetection(prisma, attemptEvent),
    );
    if (auditResult === "RECORDED") {
      res.setHeader(SPEEDSTER_MAP_REGISTRATION_AUDIT_HEADER, "recorded");
    } else {
      const signal = speedsterMapRegistrationAuditFailureSignal(requestTraceId);
      registrationAuditWarning = signal.responseFields.registrationAuditWarning;
      res.setHeader(SPEEDSTER_MAP_REGISTRATION_AUDIT_HEADER, signal.headerValue);
      console.warn(JSON.stringify({
        event: "SPEEDSTER_MAP_REGISTRATION_ATTEMPT_INSTRUMENTATION_FAILED",
        requestId: requestTraceId,
        side: registrationContext.side,
        operationId: registrationContext.operationId,
        attemptNumber: registrationContext.attemptNumber,
        auditResult,
        outcome: result.outcome,
        ...(result.outcome === "SUCCEEDED"
          ? { mapRevisionId: result.mapRevisionId }
          : { errorCode: result.code, httpStatus: result.httpStatus }),
      }));
    }
  };
  res.setHeader("X-Request-ID", requestTraceId);
  try {
    const admin = await requireAdminSession(req);
    const action = requestedAction;
    if (!action || !ACTIONS.has(action)) {
      return res.status(404).json({ message: "Unknown Speedster image action" });
    }

    const serviceRequestBody = await speedsterServiceBody(
      action,
      req.body ?? {},
      admin.user.id,
      traceEvidenceDependencies,
      action === "trace-proposal" ? requestTraceId : undefined,
    ) as Record<string, unknown>;
    if (action === "map-registration" && requestedSide && requestedSessionId) {
      const orchestration = resolveSpeedsterMapRegistrationOrchestration(
        req.body?.orchestration,
        requestedMode,
        requestTraceId,
      );
      const mapRevisionId = typeof serviceRequestBody.mapRevisionId === "string" ? serviceRequestBody.mapRevisionId : "";
      const currentInspectionSha256 = typeof serviceRequestBody.currentInspectionSha256 === "string"
        ? serviceRequestBody.currentInspectionSha256
        : "";
      const currentPhysicalQuadSha256 = typeof serviceRequestBody.currentPhysicalQuadSha256 === "string"
        ? serviceRequestBody.currentPhysicalQuadSha256
        : "";
      if (!mapRevisionId || mapRevisionId.length > 100
        || !SHA256_HEX.test(currentInspectionSha256)
        || !SHA256_HEX.test(currentPhysicalQuadSha256)) {
        throw new Error("Speedster map registration instrumentation evidence is invalid.");
      }
      registrationContext = {
        sessionId: requestedSessionId,
        createdByUserId: admin.user.id,
        side: requestedSide,
        mode: requestedMode,
        ...orchestration,
        mapRevisionId,
        currentInspectionSha256,
        currentPhysicalQuadSha256,
      };
    }
    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new Error("AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");
    const lessonEvidenceStorageKey = typeof serviceRequestBody.lessonEvidenceStorageKey === "string"
      ? serviceRequestBody.lessonEvidenceStorageKey
      : undefined;
    const lessonMapMatchKeyHash = typeof serviceRequestBody.lessonMapMatchKeyHash === "string"
      ? serviceRequestBody.lessonMapMatchKeyHash
      : undefined;
    const lessonMapScope = serviceRequestBody.lessonMapScope === "EXACT" || serviceRequestBody.lessonMapScope === "FAMILY"
      ? serviceRequestBody.lessonMapScope
      : undefined;
    const lessonExactMatchKeyHash = typeof serviceRequestBody.lessonExactMatchKeyHash === "string"
      ? serviceRequestBody.lessonExactMatchKeyHash
      : undefined;
    const colorGeometryAuthorityBinding = isRecord(serviceRequestBody.colorGeometryAuthorityBinding)
      ? serviceRequestBody.colorGeometryAuthorityBinding
      : undefined;
    const {
      lessonEvidenceStorageKey: _privateLessonEvidenceStorageKey,
      lessonMapMatchKeyHash: _privateLessonMapMatchKeyHash,
      lessonMapScope: _privateLessonMapScope,
      lessonExactMatchKeyHash: _privateLessonExactMatchKeyHash,
      colorGeometryAuthorityBinding: _privateColorGeometryAuthorityBinding,
      ...upstreamServiceRequestBody
    } = serviceRequestBody;
    const upstreamInput = {
      url: `${serviceUrl}/${action}`,
      headers: speedsterServiceHeaders(),
      body: JSON.stringify(upstreamServiceRequestBody),
    };
    if (action === "map-registration") registrationUpstreamStarted = true;
    const upstreamResult = action === "geometry" || action === "color-geometry" || action === "map-registration"
      ? await fetchSpeedsterImageUpstream({ ...upstreamInput, action })
      : await (async () => {
          const response = await fetch(upstreamInput.url, {
            method: "POST",
            headers: upstreamInput.headers,
            body: upstreamInput.body,
          });
          return { response, payload: await response.json().catch(() => ({})) };
        })();
    if (action === "map-registration") registrationUpstreamCompleted = true;
    const { response, payload } = upstreamResult;
    if (action === "trace-proposal" && !response.ok) {
      return res.status(response.status).json(
        sanitizeSpeedsterTraceProposalFailure(payload, requestTraceId),
      );
    }
    if (action === "map-registration" && response.status === 422) {
      try {
        const detail = isRecord(payload) ? payload.detail : null;
        const registrationFailure = parseSpeedsterRegistrationFailure(detail);
        await recordRegistrationAttempt({
          outcome: "HUMAN_CORRECTION_REQUIRED",
          source: "PROVIDER",
          code: "HUMAN_CORRECTION_REQUIRED",
          httpStatus: 422,
          retryEligible: false,
        });
        return res.status(422).json({
          message: `CARD MAP registration needs human anchor correction on ${registrationFailure.bestCandidate.anchors.filter((anchor) => anchor.status !== "TRACKED").length || "one or more"} anchors (request ${requestTraceId}).`,
          requestId: requestTraceId,
          registrationFailure,
          ...registrationAuditResponseFields(),
        });
      } catch {
        await recordRegistrationAttempt({
          outcome: "FAILED",
          source: "TEN_KINGS_API",
          code: "MALFORMED_PROVIDER_FAILURE_DIAGNOSTICS",
          httpStatus: 502,
          retryEligible: false,
        });
        return res.status(502).json({
          message: `CARD MAP registration returned invalid failure diagnostics (request ${requestTraceId}). No map was applied.`,
          requestId: requestTraceId,
          registrationError: speedsterMapRegistrationErrorEnvelope({
            source: "TEN_KINGS_API",
            code: "MALFORMED_PROVIDER_FAILURE_DIAGNOSTICS",
            httpStatus: 502,
            retryable: false,
            requestId: requestTraceId,
          }),
          ...registrationAuditResponseFields(),
        });
      }
    }
    if (!response.ok) {
      if (action === "map-registration") {
        const classification = classifySpeedsterMapRegistrationUpstreamFailure({
          status: response.status,
          mode: requestedMode,
          requestId: requestTraceId,
        });
        await recordRegistrationAttempt({
          outcome: "FAILED",
          source: classification.source,
          code: classification.code,
          httpStatus: response.status,
          retryEligible: classification.retryable,
        });
        const sanitized = classification.message
          ? { message: classification.message, requestId: requestTraceId }
          : sanitizeSpeedsterImageFailure(payload, action, requestTraceId);
        return res.status(response.status).json({
          ...sanitized,
          registrationError: classification.registrationError,
          ...registrationAuditResponseFields(),
        });
      }
      return res.status(response.status).json(
        sanitizeSpeedsterImageFailure(payload, action, requestTraceId),
      );
    }
    const requestedMat = req.body?.matColor === "BLACK" || req.body?.matColor === "WHITE" || req.body?.matColor === "MAGENTA"
      ? req.body.matColor as SpeedsterMatColor
      : null;
    let safePayload = action === "geometry" && response.ok
      ? (() => {
          if (!requestedMat) throw new Error("Speedster geometry mat selection is invalid.");
          return sanitizeSpeedsterGeometryPayload(payload, { mode: "PHYSICAL_OUTER", matColor: requestedMat });
        })()
      : action === "prepare" && response.ok
        ? (() => {
            if (!requestedMat) throw new Error("Speedster prepare mat selection is invalid.");
            return sanitizeSpeedsterPreparePayload(payload, { matColor: requestedMat });
          })()
      : action === "color-geometry" && response.ok
        ? (() => {
            if (!requestedMat) throw new Error("Speedster color geometry recovery mat selection is invalid.");
            const mode = req.body?.mode === "PHYSICAL_OUTER" || req.body?.mode === "PRINTED_FRAME"
              ? req.body.mode as SpeedsterColorGeometryMode
              : null;
            if (!mode) throw new Error("Speedster color geometry recovery mode is invalid.");
            return sanitizeSpeedsterColorGeometryPayload(payload, { mode, matColor: requestedMat });
          })()
      : action === "trace-proposal" && response.ok
        ? (() => {
            const trace = parseSpeedsterTraceRleV1(
              payload && typeof payload === "object" && "trace" in payload ? payload.trace : null,
            );
            return {
              traceWire: encodeSpeedsterTraceBitmapWireV1(
                decodeSpeedsterTraceRleV1(trace),
                trace.sha256,
              ),
            };
          })()
        : action === "map-registration" && response.ok
          ? parseSpeedsterMapRegistration(payload, {
              side: serviceRequestBody.side as "FRONT" | "BACK",
              mapRevisionId: serviceRequestBody.mapRevisionId as string,
              zones: serviceRequestBody.zones as Parameters<typeof parseSpeedsterMapRegistration>[1]["zones"],
              anchors: serviceRequestBody.anchors as Parameters<typeof parseSpeedsterMapRegistration>[1]["anchors"],
              designBoundary: serviceRequestBody.designBoundary as Parameters<typeof parseSpeedsterMapRegistration>[1]["designBoundary"],
            })
        : payload;
    if ((action === "geometry" || action === "prepare" || action === "color-geometry") && response.ok) {
      if (!colorGeometryAuthorityBinding) {
        throw new Error("Speedster color geometry result lacks exact source authority.");
      }
      const result = (safePayload as { colorGeometry?: unknown }).colorGeometry;
      const receiptBinding = {
        ...colorGeometryAuthorityBinding,
        operatorAdminId: admin.user.id,
        result,
      } as SpeedsterColorGeometryReceiptBinding;
      safePayload = {
        ...(safePayload as Record<string, unknown>),
        colorGeometryReceipt: issueSpeedsterColorGeometryReceipt(receiptBinding),
      };
    }
    if (action === "map-registration" && response.ok && req.body?.rescue === true) {
      const registration = safePayload as ReturnType<typeof parseSpeedsterMapRegistration>;
      const automaticFailure = parseSpeedsterRegistrationFailure(
        isRecord(payload) ? payload.automaticFailure : null,
      );
      const submittedFailure = parseSpeedsterRegistrationFailure(req.body.automaticFailure);
      if (JSON.stringify(submittedFailure) !== JSON.stringify(automaticFailure)) {
        throw new Error("Registration rescue diagnostics changed during server validation; no lesson was saved.");
      }
      const corrected = Array.isArray(req.body.correctedAnchors)
        ? req.body.correctedAnchors.map((entry: unknown) => {
            if (!isRecord(entry) || typeof entry.anchorId !== "string") {
              throw new Error("Registration rescue corrected anchors are malformed.");
            }
            return { anchorId: entry.anchorId, point: finiteDiagnosticPoint(entry.point) };
          })
        : [];
      if (corrected.length !== 4 || corrected.some((entry: { point: unknown }) => !entry.point)) {
        throw new Error("Registration rescue corrected anchors are malformed.");
      }
      const currentPhysicalQuad = sanitizeSpeedsterUnitQuad(req.body.currentPhysicalQuad);
      const sessionId = typeof req.body.sessionId === "string" ? req.body.sessionId.trim() : "";
      const rescueAttemptId = typeof req.body.rescueAttemptId === "string" ? req.body.rescueAttemptId.trim() : "";
      if (!currentPhysicalQuad || !sessionId || !lessonEvidenceStorageKey || !lessonMapMatchKeyHash
        || !lessonMapScope || !lessonExactMatchKeyHash) {
        throw new Error("Registration rescue immutable evidence identity is malformed.");
      }
      const lesson = await persistSpeedsterRegistrationLesson({
        operatorAdminId: admin.user.id,
        expectedMapId: serviceRequestBody.mapId as string,
        expectedMatchKeyHash: lessonMapMatchKeyHash,
        expectedScope: lessonMapScope,
        expectedExactMatchKeyHash: lessonExactMatchKeyHash,
        mapRevisionId: registration.mapRevisionId,
        side: registration.side,
        evidenceSessionId: sessionId,
        currentInspectionKey: lessonEvidenceStorageKey,
        currentInspectionSha256: registration.currentInspectionSha256,
        currentPhysicalQuad,
        originalExpectedAnchors: (serviceRequestBody.anchors as Array<{ id: string; point: { x: number; y: number } }>),
        automaticDiagnostics: automaticFailure,
        humanCorrectedAnchors: corrected as Array<{ anchorId: string; point: { x: number; y: number } }>,
        validatedRegistration: registration,
        rescueAttemptId,
      });
      safePayload = {
        ...lesson.registration,
        candidateProvenance: {
          ...lesson.registration.candidateProvenance,
          candidateId: lesson.lessonId,
          lessonId: lesson.lessonId,
        },
      };
    }
    if (action === "map-registration" && response.ok) {
      const registration = safePayload as ReturnType<typeof parseSpeedsterMapRegistration>;
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
      if (!sessionId) throw new Error("Speedster registration receipt session identity is unavailable.");
      assertSpeedsterRegistrationCandidateAuthority(registration, serviceRequestBody, req.body?.rescue === true);
      safePayload = {
        ...registration,
        serverReceipt: issueSpeedsterMapRegistrationReceipt({
          operatorAdminId: admin.user.id,
          sessionId,
          registration,
        }),
      };
      await recordRegistrationAttempt({
        outcome: "SUCCEEDED",
        mapRevisionId: registration.mapRevisionId,
      });
      safePayload = { ...safePayload, ...registrationAuditResponseFields() };
    }
    return res.status(response.status).json(safePayload);
  } catch (error) {
    if (error instanceof SpeedsterImageUpstreamTimeoutError) {
      console.warn(JSON.stringify({
        event: "SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT",
        action: error.action,
        timeoutMs: error.timeoutMs,
        requestId: requestTraceId,
      }));
      if (requestedAction === "map-registration") {
        await recordRegistrationAttempt({
          outcome: "FAILED",
          source: "PROVIDER",
          code: "PROVIDER_TIMEOUT",
          httpStatus: 504,
          retryEligible: false,
        });
      }
      return res.status(504).json({
        message: `Speedster ${error.action} service did not respond in time. Your photos and current geometry are preserved; retry this step.`,
        requestId: requestTraceId,
        ...(requestedAction === "map-registration" ? {
          registrationError: speedsterMapRegistrationTimeoutEnvelope(requestTraceId),
          ...registrationAuditResponseFields(),
        } : {}),
      });
    }
    const mapped = toErrorResponse(error);
    if (requestedAction === "map-registration") {
      const providerNetwork = registrationUpstreamStarted
        && !registrationUpstreamCompleted
        && error instanceof TypeError;
      const source = providerNetwork ? "PROVIDER_NETWORK" as const : "TEN_KINGS_API" as const;
      const code = providerNetwork
        ? "NETWORK_NO_HTTP_RESPONSE"
        : mapped.status === 401 || mapped.status === 403
          ? "TEN_KINGS_AUTHORIZATION_REJECTED"
          : registrationUpstreamCompleted
            ? "TEN_KINGS_REGISTRATION_VALIDATION_FAILED"
            : "TEN_KINGS_REGISTRATION_REQUEST_REJECTED";
      const status = providerNetwork ? 502 : mapped.status;
      const retryable = requestedMode === "AUTOMATIC" && providerNetwork;
      await recordRegistrationAttempt({
        outcome: "FAILED",
        source,
        code,
        httpStatus: status,
        retryEligible: retryable,
      });
      return res.status(status).json({
        message: providerNetwork
          ? `CARD MAP registration received no HTTP response from the provider (request ${requestTraceId}). No map was applied.`
          : mapped.message,
        requestId: requestTraceId,
        registrationError: speedsterMapRegistrationErrorEnvelope({
          source,
          code,
          httpStatus: status,
          retryable,
          requestId: requestTraceId,
        }),
        ...registrationAuditResponseFields(),
      });
    }
    return res.status(mapped.status).json({ message: mapped.message, requestId: requestTraceId });
  }
}
