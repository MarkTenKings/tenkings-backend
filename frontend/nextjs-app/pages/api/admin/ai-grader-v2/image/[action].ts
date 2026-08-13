import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "node:crypto";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { presignReadUrl } from "../../../../../lib/server/storage";
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
  speedsterPhysicalQuadHash,
} from "../../../../../lib/server/speedsterCardTypeMaps";
import { canonicalizeSpeedsterSessionIdentity } from "../../../../../lib/ai-grader-v2/identity";
import {
  ensureSpeedsterRegistrationLessonEvidenceSnapshot,
  loadVerifiedSpeedsterRegistrationLessonCandidates,
  persistSpeedsterRegistrationLesson,
  type SpeedsterRegistrationLessonCandidate,
} from "../../../../../lib/server/speedsterMapRegistrationLessons";
import type {
  SpeedsterMapRegistrationFailure,
} from "../../../../../lib/ai-grader-v2/card-type-map-contracts";

const ACTIONS = new Set(["geometry", "prepare", "trace-proposal", "map-registration"]);
export const SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT_MS = 55_000;

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

export function sanitizeSpeedsterGeometryPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  return {
    ...payload,
    corners: sanitizeSpeedsterUnitQuad(payload.corners),
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

export async function speedsterServiceBody(
  action: string,
  body: Record<string, unknown>,
  createdByUserId?: string,
  evidenceDeps: TraceEvidenceDependencies = traceEvidenceDependencies,
  requestTraceId?: string,
) {
  if (action === "map-registration" && createdByUserId) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const side = body.side === "FRONT" || body.side === "BACK" ? body.side : null;
    const rawQuad = body.currentPhysicalQuad;
    const currentPhysicalQuad = sanitizeSpeedsterUnitQuad(rawQuad);
    if (!sessionId || !side || !currentPhysicalQuad || JSON.stringify(currentPhysicalQuad) !== JSON.stringify(rawQuad)) {
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
    const preparedCurrentStorageKey = `ai-grader-v2/${createdByUserId}/${sessionId}/prepared/${side.toLowerCase()}/inspection.webp`;
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
    const prefix = `ai-grader-v2/${createdByUserId}/${sessionId.trim()}/prepared/${side.toLowerCase()}`;
    const expectedKeys = {
      ORIGINAL: `${prefix}/inspection.webp`,
      NORMALIZED: `${prefix}/normalized.webp`,
      MICRO_DEFECT: `${prefix}/micro_defect.webp`,
      DIRECTIONAL: `${prefix}/directional.webp`,
    } as const;
    const persistedViewKeys = isRecord(persistedSide?.viewStorageKeys) ? persistedSide.viewStorageKeys : null;
    const persistedKeys = {
      ORIGINAL: persistedSide?.inspectionStorageKey,
      NORMALIZED: persistedViewKeys?.NORMALIZED,
      MICRO_DEFECT: persistedViewKeys?.MICRO_DEFECT,
      DIRECTIONAL: persistedViewKeys?.DIRECTIONAL,
    };
    if (
      SPEEDSTER_REVIEW_VIEW_TYPES.some((candidate) => persistedKeys[candidate] !== expectedKeys[candidate]) ||
      !cornerShape || !isRecord(persistedSide?.inspectionFrame)
    ) {
      throw new Error("Speedster trace proposal evidence is not owned by this session.");
    }
    const expectedStorageKey = expectedKeys[view as keyof typeof expectedKeys];
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
  res.setHeader("X-Request-ID", requestTraceId);
  try {
    const admin = await requireAdminSession(req);
    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (!action || !ACTIONS.has(action)) {
      return res.status(404).json({ message: "Unknown Speedster image action" });
    }

    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new Error("AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");

    const serviceRequestBody = await speedsterServiceBody(
      action,
      req.body ?? {},
      admin.user.id,
      traceEvidenceDependencies,
      action === "trace-proposal" ? requestTraceId : undefined,
    ) as Record<string, unknown>;
    const lessonEvidenceStorageKey = typeof serviceRequestBody.lessonEvidenceStorageKey === "string"
      ? serviceRequestBody.lessonEvidenceStorageKey
      : undefined;
    const { lessonEvidenceStorageKey: _privateLessonEvidenceStorageKey, ...upstreamServiceRequestBody } = serviceRequestBody;
    const upstreamInput = {
      url: `${serviceUrl}/${action}`,
      headers: speedsterServiceHeaders(),
      body: JSON.stringify(upstreamServiceRequestBody),
    };
    const { response, payload } = action === "geometry" || action === "map-registration"
      ? await fetchSpeedsterImageUpstream({ ...upstreamInput, action })
      : await (async () => {
          const response = await fetch(upstreamInput.url, {
            method: "POST",
            headers: upstreamInput.headers,
            body: upstreamInput.body,
          });
          return { response, payload: await response.json().catch(() => ({})) };
        })();
    if (action === "trace-proposal" && !response.ok) {
      return res.status(response.status).json(
        sanitizeSpeedsterTraceProposalFailure(payload, requestTraceId),
      );
    }
    if (action === "map-registration" && response.status === 422) {
      try {
        const detail = isRecord(payload) ? payload.detail : null;
        const registrationFailure = parseSpeedsterRegistrationFailure(detail);
        return res.status(422).json({
          message: `CARD MAP registration needs human anchor correction on ${registrationFailure.bestCandidate.anchors.filter((anchor) => anchor.status !== "TRACKED").length || "one or more"} anchors (request ${requestTraceId}).`,
          requestId: requestTraceId,
          registrationFailure,
        });
      } catch {
        return res.status(502).json({
          message: `CARD MAP registration returned invalid failure diagnostics (request ${requestTraceId}). No map was applied.`,
          requestId: requestTraceId,
        });
      }
    }
    if (!response.ok) {
      return res.status(response.status).json(
        sanitizeSpeedsterImageFailure(payload, action, requestTraceId),
      );
    }
    let safePayload = action === "geometry" && response.ok
      ? sanitizeSpeedsterGeometryPayload(payload)
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
      if (!currentPhysicalQuad || !sessionId || !lessonEvidenceStorageKey) {
        throw new Error("Registration rescue immutable evidence identity is malformed.");
      }
      const lesson = await persistSpeedsterRegistrationLesson({
        operatorAdminId: admin.user.id,
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
    return res.status(response.status).json(safePayload);
  } catch (error) {
    if (error instanceof SpeedsterImageUpstreamTimeoutError) {
      console.warn(JSON.stringify({
        event: "SPEEDSTER_IMAGE_UPSTREAM_TIMEOUT",
        action: error.action,
        timeoutMs: error.timeoutMs,
        requestId: requestTraceId,
      }));
      return res.status(504).json({
        message: `Speedster ${error.action} service did not respond in time. Your photos and current geometry are preserved; retry this step.`,
        requestId: requestTraceId,
      });
    }
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message, requestId: requestTraceId });
  }
}
