import assert from "node:assert/strict";
import test from "node:test";
import {
  SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_MAX_BYTES,
  SPEEDSTER_CAPTURE_REGISTRATION_RECEIPT_MAX_AGE_MS,
  SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION,
  parseSpeedsterCaptureRegistrationDraft,
  readSpeedsterCaptureRegistrationDraft,
  readSpeedsterCaptureRegistrationDraftForCommittedSession,
  removeSpeedsterCaptureRegistrationDraft,
  speedsterCaptureDraftExpiredRegistrationSides,
  speedsterCaptureDraftMatchesCommittedSession,
  speedsterCaptureRegistrationDraftStorageKey,
  writeSpeedsterCaptureRegistrationDraft,
  type SpeedsterCaptureRegistrationDraft,
} from "../lib/ai-grader-v2/capture-registration-draft";
import type { SpeedsterCardSide } from "../lib/ai-grader-v2/contracts";
import type { SpeedsterMapRegistration } from "../lib/ai-grader-v2/card-type-map-contracts";
import type { SpeedsterMapRegistrationFailure } from "../lib/ai-grader-v2/card-type-map-contracts";

const quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function registration(side: SpeedsterCardSide, revisionId: string): SpeedsterMapRegistration {
  return {
    version: "opencv-redundant-ransac-registration-v2",
    side,
    mapRevisionId: revisionId,
    currentPhysicalQuadSha256: "a".repeat(64),
    currentInspectionSha256: "b".repeat(64),
    homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    anchors: quad.map((locatedPoint, index) => ({
      anchorId: `anchor-${index + 1}`,
      expectedPoint: locatedPoint,
      locatedPoint,
      score: 0.95,
    })),
    projectedDesignBoundary: { kind: "FULL_BLEED" },
    projectedZones: [{
      id: "name",
      label: "Card name",
      semanticType: "PRINT_TEXT",
      polygon: quad,
      contentType: "HEADER",
      filterAuthority: true,
      filterAuthoritySource: "TYPE_DEFAULT",
      filterPaddingMm: 0.6,
      proposalSource: "HUMAN",
      proposalConfidence: null,
    }],
    candidateProvenance: { candidateId: `candidate-${side.toLowerCase()}`, source: "ORIGINAL_REFERENCE" },
    acceptance: {
      policyVersion: "speedster-map-registration-acceptance-v2",
      mode: "AUTOMATIC_RANSAC",
      featureCount: 40,
      usableFeatureCount: 32,
      inlierCount: 28,
      inlierFraction: 0.875,
      perAnchorFeatureCounts: [8, 8, 8, 8],
      perAnchorInlierCounts: [7, 7, 7, 7],
      medianReprojectionErrorPx: 0.8,
      maxReprojectionErrorPx: 1.9,
    },
    serverReceipt: `server-signed-receipt-${side.toLowerCase()}-${"c".repeat(64)}`,
  };
}

function sideState(side: SpeedsterCardSide, sessionId: string, mapRegistration?: SpeedsterMapRegistration) {
  const slug = side.toLowerCase();
  return {
    originalStorageKey: `ai-grader-v2/user/${sessionId}/original/${slug}.jpg`,
    corners: quad,
    automaticGeometry: true,
    geometryDiagnostic: { sessionId, attemptId: 1, side, durationMs: 91, corners: "present" as const },
    rectifiedStorageKey: `ai-grader-v2/user/${sessionId}/rectified/${slug}.png`,
    inspectionStorageKey: `ai-grader-v2/user/${sessionId}/inspection/${slug}.png`,
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/user/${sessionId}/views/${slug}-normalized.png`,
      MICRO_DEFECT: `ai-grader-v2/user/${sessionId}/views/${slug}-micro.png`,
      DIRECTIONAL: `ai-grader-v2/user/${sessionId}/views/${slug}-directional.png`,
    },
    proposedCentering: quad,
    detectedBorders: ["top", "right", "bottom", "left"] as const,
    ...(mapRegistration ? { mapRegistration } : {}),
  };
}

function registrationFailure(side: SpeedsterCardSide, revisionId: string): SpeedsterMapRegistrationFailure {
  return {
    algorithmVersion: "opencv-redundant-ransac-registration-v2",
    policyVersion: "speedster-map-registration-acceptance-v2",
    accepted: false,
    failureCode: "LOW_ANCHOR_CONFIDENCE",
    message: "One anchor is low confidence.",
    candidateCount: 1,
    candidateIds: ["original-reference"],
    binding: {
      side,
      mapRevisionId: revisionId,
      currentInspectionSha256: "b".repeat(64),
      currentPhysicalQuadSha256: "a".repeat(64),
      candidates: [{ candidateId: "original-reference", referenceInspectionSha256: "c".repeat(64) }],
    },
    bestCandidate: {
      candidateId: "original-reference",
      provenance: "ORIGINAL_REFERENCE",
      accepted: false,
      failureCode: "LOW_ANCHOR_CONFIDENCE",
      message: "One anchor is low confidence.",
      anchors: quad.map((point, index) => ({
        anchorId: `anchor-${index + 1}`,
        expectedPoint: point,
        trackedPoint: point,
        locatedPoint: point,
        score: index === 0 ? 0.29 : 0.9,
        status: index === 0 ? "LOW_CONFIDENCE" as const : "TRACKED" as const,
      })),
      featureCount: 40,
      usableFeatureCount: 30,
      inlierCount: 20,
      inlierFraction: 2 / 3,
      perAnchorFeatureCounts: [4, 8, 9, 9],
      perAnchorInlierCounts: [1, 6, 7, 6],
      medianReprojectionErrorPx: 0.8,
      maxReprojectionErrorPx: 2.1,
    },
  };
}

function draft(sessionId = "session-a", createdAtMs = 1_000): SpeedsterCaptureRegistrationDraft {
  const revisionId = "revision-r9";
  const front = registration("FRONT", revisionId);
  return {
    version: SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION,
    createdAtMs,
    updatedAtMs: createdAtMs + 50,
    surface: "AI_GRADER",
    sessionId,
    cardProfile: "POKEMON",
    mapBindingStatus: "LOADED",
    activeMapRevisionId: revisionId,
    activeMapScope: "FAMILY",
    activeMapName: "2023 Pokemon MEW EN Reverse Holo",
    cornerShape: "ROUNDED_3_18_MM",
    stage: "MAP_REGISTRATION_INTERRUPTED",
    front: sideState("FRONT", sessionId, front),
    back: sideState("BACK", sessionId),
    interruptions: {
      BACK: {
        message: "Provider rejected the request (HTTP 402).",
        failure: {
          version: "speedster-map-registration-error-v1",
          source: "PROVIDER",
          code: "PROVIDER_HTTP_402",
          httpStatus: 402,
          retryable: false,
          requestId: "request-back-402",
        },
      },
    },
    failures: {},
    failureRequestIds: { BACK: "request-back-402" },
    provisional: { FRONT: front },
    registrationRecordedAtMs: { FRONT: createdAtMs - 10 },
    attemptIds: {},
    operationId: "00000000-0000-4000-8000-000000000001",
    attemptNumbers: { FRONT: 1, BACK: 1 },
    decisionIds: {
      continue: "00000000-0000-4000-8000-000000000002",
      abandonObsoleteMap: "00000000-0000-4000-8000-000000000004",
      retry: { BACK: "00000000-0000-4000-8000-000000000003" },
    },
    correctedAnchors: {},
    registrationFailureSides: { BACK: true },
    mapRegistrationFailed: true,
    mapAuthorityAbandoned: false,
    captureSavePendingRetry: false,
    notice: "Front registration is retained; Back requires an explicit choice.",
  };
}

const binding = (sessionId = "session-a") => ({
  surface: "AI_GRADER" as const,
  sessionId,
  cardProfile: "POKEMON" as const,
  mapBindingStatus: "LOADED" as const,
  activeMapRevisionId: "revision-r9",
  activeMapScope: "FAMILY" as const,
});

test("sanitized capture draft round-trips exact authority without URLs, tokens, or image bytes", () => {
  const storage = new MemoryStorage();
  const input = draft();
  writeSpeedsterCaptureRegistrationDraft(storage, input);
  const serialized = storage.getItem(speedsterCaptureRegistrationDraftStorageKey(input.sessionId));
  assert.ok(serialized);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("admin-token"), false);
  assert.equal(serialized.includes("readUrl"), false);
  assert.equal(serialized.includes("data:image"), false);
  const parsed = readSpeedsterCaptureRegistrationDraft(storage, binding());
  assert.equal(parsed?.provisional.FRONT?.serverReceipt, input.provisional.FRONT?.serverReceipt);
  assert.equal(parsed?.front.mapRegistration?.candidateProvenance?.source, "ORIGINAL_REFERENCE");
  assert.equal(parsed?.front.mapRegistration?.projectedDesignBoundary.kind, "FULL_BLEED");
});

test("capture draft parsing fails closed on binding drift, extra fields, URLs, missing receipts, and malformed V2 zone metadata", () => {
  const input = draft();
  const serialized = JSON.stringify(input);
  assert.equal(parseSpeedsterCaptureRegistrationDraft(serialized, { ...binding(), sessionId: "session-b" }), null);
  assert.equal(parseSpeedsterCaptureRegistrationDraft(serialized, { ...binding(), surface: "CARD_MAPS" }), null);
  assert.equal(parseSpeedsterCaptureRegistrationDraft(serialized, { ...binding(), activeMapRevisionId: "revision-r10" }), null);

  const extra = JSON.parse(serialized);
  extra.adminToken = "must-not-survive";
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(extra), binding()), null);

  const signedUrl = JSON.parse(serialized);
  signedUrl.front.rectifiedStorageKey = "https://signed.example.test/front.png?token=secret";
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(signedUrl), binding()), null);

  const missingReceipt = JSON.parse(serialized);
  delete missingReceipt.front.mapRegistration.serverReceipt;
  delete missingReceipt.provisional.FRONT.serverReceipt;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(missingReceipt), binding()), null);

  const partialV2Zone = JSON.parse(serialized);
  delete partialV2Zone.front.mapRegistration.projectedZones[0].filterAuthority;
  delete partialV2Zone.provisional.FRONT.projectedZones[0].filterAuthority;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(partialV2Zone), binding()), null);
});

test("capture drafts remain per-session and only explicit discard removes the selected session", () => {
  const storage = new MemoryStorage();
  writeSpeedsterCaptureRegistrationDraft(storage, draft("session-a"));
  writeSpeedsterCaptureRegistrationDraft(storage, draft("session-b"));
  removeSpeedsterCaptureRegistrationDraft(storage, "session-b");
  assert.ok(readSpeedsterCaptureRegistrationDraft(storage, binding("session-a")));
  assert.equal(readSpeedsterCaptureRegistrationDraft(storage, binding("session-b")), null);
});

test("committed-capture reconciliation requires exact Front, Back, and map-binding equality", () => {
  const input = mutableClone(draft("committed-session", 10_000));
  const backRegistration = registration("BACK", input.activeMapRevisionId!);
  input.stage = "BACK_CENTERING";
  input.back = mutableClone(sideState("BACK", input.sessionId, backRegistration));
  input.front.centering = { side: "FRONT", innerQuad: mutableClone(quad), borders: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 } };
  input.back.centering = { side: "BACK", innerQuad: mutableClone(quad), borders: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 } };
  input.interruptions = {};
  input.failureRequestIds = {};
  input.provisional.BACK = mutableClone(backRegistration);
  input.registrationRecordedAtMs.BACK = input.updatedAtMs - 1;
  input.decisionIds.retry = {};
  input.registrationFailureSides = {};
  input.mapRegistrationFailed = false;
  input.captureSavePendingRetry = true;
  const committedDraft = input as unknown as SpeedsterCaptureRegistrationDraft;
  const storage = new MemoryStorage();
  writeSpeedsterCaptureRegistrationDraft(storage, committedDraft);
  const selfBound = readSpeedsterCaptureRegistrationDraftForCommittedSession(storage, {
    surface: "AI_GRADER",
    sessionId: committedDraft.sessionId,
    cardProfile: "POKEMON",
  });
  assert.ok(selfBound);
  const persistedSide = (side: typeof input.front) => ({
    originalStorageKey: side.originalStorageKey,
    rectifiedStorageKey: side.rectifiedStorageKey,
    inspectionStorageKey: side.inspectionStorageKey,
    inspectionFrame: side.inspectionFrame,
    viewStorageKeys: side.viewStorageKeys,
    sourceCorners: side.corners,
    transform: side.transform,
    centeringQuad: side.centering!.innerQuad,
    centeringBorders: side.centering!.borders,
  });
  const unsigned = (value: SpeedsterMapRegistration) => {
    const { serverReceipt: _receipt, ...body } = value;
    return body;
  };
  const committed = {
    workflowState: "CAPTURED",
    capture: { cornerShape: committedDraft.cornerShape, front: persistedSide(input.front), back: persistedSide(input.back) },
    mapRevisionId: committedDraft.activeMapRevisionId,
    mapRegistration: {
      front: unsigned(committedDraft.front.mapRegistration!),
      back: unsigned(committedDraft.back.mapRegistration!),
    },
  };
  assert.equal(speedsterCaptureDraftMatchesCommittedSession(selfBound, committed), true);
  assert.equal(speedsterCaptureDraftMatchesCommittedSession(selfBound, {
    ...committed,
    capture: { ...committed.capture, front: { ...committed.capture.front, originalStorageKey: "different" } },
  }), false);
  assert.equal(speedsterCaptureDraftMatchesCommittedSession(selfBound, {
    ...committed,
    mapRevisionId: "revision-r10",
  }), false);
  const provisionalOnly = mutableClone(selfBound);
  delete provisionalOnly.front.mapRegistration;
  delete provisionalOnly.back.mapRegistration;
  assert.equal(speedsterCaptureDraftMatchesCommittedSession(
    provisionalOnly as unknown as SpeedsterCaptureRegistrationDraft,
    committed,
  ), false, "provisional-only registrations can never reconcile a committed map binding");
  assert.ok(storage.getItem(speedsterCaptureRegistrationDraftStorageKey(committedDraft.sessionId)),
    "read-only reconciliation must never clear the preserved draft");
});

test("receipt age is side-specific, future timestamps fail closed, and oversized drafts are rejected", () => {
  const input = draft("session-a", 10_000);
  assert.deepEqual(
    speedsterCaptureDraftExpiredRegistrationSides(input, 9_990 + SPEEDSTER_CAPTURE_REGISTRATION_RECEIPT_MAX_AGE_MS),
    [],
  );
  assert.deepEqual(
    speedsterCaptureDraftExpiredRegistrationSides(input, 9_991 + SPEEDSTER_CAPTURE_REGISTRATION_RECEIPT_MAX_AGE_MS),
    ["FRONT"],
  );

  const back = registration("BACK", input.activeMapRevisionId!);
  const mixedAge: SpeedsterCaptureRegistrationDraft = {
    ...input,
    updatedAtMs: 20_000,
    stage: "FRONT_CENTERING",
    back: sideState("BACK", input.sessionId, back),
    interruptions: {},
    provisional: { FRONT: input.provisional.FRONT, BACK: back },
    registrationRecordedAtMs: { FRONT: 9_990, BACK: 19_990 },
    registrationFailureSides: {},
    mapRegistrationFailed: false,
    mapAuthorityAbandoned: false,
  };
  assert.deepEqual(
    speedsterCaptureDraftExpiredRegistrationSides(mixedAge, 9_991 + SPEEDSTER_CAPTURE_REGISTRATION_RECEIPT_MAX_AGE_MS),
    ["FRONT"],
    "A fresh sibling receipt must survive when only the older side expires",
  );

  const future = JSON.parse(JSON.stringify(input));
  future.createdAtMs = Date.now() + 10 * 60 * 1000;
  future.updatedAtMs = future.createdAtMs;
  future.registrationRecordedAtMs.FRONT = future.createdAtMs;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(future), binding()), null);
  assert.equal(parseSpeedsterCaptureRegistrationDraft(" ".repeat(SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_MAX_BYTES + 1), binding()), null);
});

test("durable stages reject impossible centering order and missing interruption decisions", () => {
  const interrupted = draft();
  const missingRetry = mutableClone(interrupted);
  delete missingRetry.decisionIds.retry.BACK;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(missingRetry), binding()), null);

  const frontCentering = mutableClone(interrupted);
  const backRegistration = registration("BACK", interrupted.activeMapRevisionId!);
  frontCentering.stage = "FRONT_CENTERING";
  frontCentering.back = mutableClone(sideState("BACK", interrupted.sessionId, backRegistration));
  frontCentering.interruptions = {};
  frontCentering.failureRequestIds = {};
  frontCentering.provisional.BACK = mutableClone(backRegistration);
  frontCentering.registrationRecordedAtMs.BACK = frontCentering.updatedAtMs - 1;
  frontCentering.decisionIds.retry = {};
  frontCentering.registrationFailureSides = {};
  frontCentering.mapRegistrationFailed = false;
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(frontCentering), binding()));

  const oneSided = mutableClone(frontCentering);
  delete oneSided.back.mapRegistration;
  delete oneSided.provisional.BACK;
  delete oneSided.registrationRecordedAtMs.BACK;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(oneSided), binding()), null);

  const bodyMismatch = mutableClone(frontCentering);
  bodyMismatch.provisional.FRONT = {
    ...bodyMismatch.provisional.FRONT!,
    acceptance: {
      ...bodyMismatch.provisional.FRONT!.acceptance!,
      maxReprojectionErrorPx: 2.5,
    },
  };
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(bodyMismatch), binding()), null);

  frontCentering.front.centering = {
    side: "FRONT",
    innerQuad: mutableClone(quad),
    borders: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
  };
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(frontCentering), binding()), null);

  const backCentering = mutableClone(frontCentering);
  backCentering.stage = "BACK_CENTERING";
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(backCentering), binding()));
  delete backCentering.front.centering;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(backCentering), binding()), null);

  backCentering.front.centering = {
    side: "FRONT",
    innerQuad: mutableClone(quad),
    borders: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
  };
  backCentering.back.centering = {
    side: "BACK",
    innerQuad: mutableClone(quad),
    borders: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
  };
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(backCentering), binding()), null);
  backCentering.captureSavePendingRetry = true;
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(backCentering), binding()),
    "a failed final save may intentionally retain both centering results for byte-identical retry");

  const abandoned = mutableClone(frontCentering);
  delete abandoned.front.centering;
  delete abandoned.front.mapRegistration;
  delete abandoned.back.mapRegistration;
  abandoned.provisional = {};
  abandoned.registrationRecordedAtMs = {};
  abandoned.registrationFailureSides = { BACK: true };
  abandoned.mapRegistrationFailed = true;
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(abandoned), binding()));

  const authorityAbandoned = mutableClone(abandoned);
  authorityAbandoned.registrationFailureSides = {};
  authorityAbandoned.mapRegistrationFailed = false;
  authorityAbandoned.mapAuthorityAbandoned = true;
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(authorityAbandoned), binding()),
    "explicit map-authority abandonment is distinct from a registration attempt failure");
  authorityAbandoned.provisional.FRONT = mutableClone(interrupted.provisional.FRONT!);
  authorityAbandoned.front.mapRegistration = mutableClone(interrupted.front.mapRegistration!);
  authorityAbandoned.registrationRecordedAtMs.FRONT = authorityAbandoned.updatedAtMs - 1;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(authorityAbandoned), binding()), null,
    "abandoned authority cannot retain any old registration");

  const nonLoaded = mutableClone(abandoned);
  nonLoaded.mapBindingStatus = "NO_MAP";
  nonLoaded.activeMapRevisionId = null;
  nonLoaded.activeMapScope = null;
  nonLoaded.activeMapName = null;
  nonLoaded.registrationFailureSides = {};
  nonLoaded.mapRegistrationFailed = false;
  const noMapBinding = {
    ...binding(),
    mapBindingStatus: "NO_MAP" as const,
    activeMapRevisionId: null,
    activeMapScope: null,
  };
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(nonLoaded), noMapBinding));
  nonLoaded.mapAuthorityAbandoned = true;
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(nonLoaded), noMapBinding),
    "explicitly abandoned old map authority remains durable when current lookup has no map");
  nonLoaded.mapAuthorityAbandoned = false;
  nonLoaded.registrationFailureSides = { BACK: true };
  nonLoaded.mapRegistrationFailed = true;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(nonLoaded), noMapBinding), null);
});

test("rescue drafts require interruption-free failures and one immutable UUID attempt binding per failed side", () => {
  const input = draft();
  const rescue = mutableClone(input);
  rescue.stage = "MAP_REGISTRATION_RESCUE";
  rescue.interruptions = {};
  rescue.failures = { BACK: mutableClone(registrationFailure("BACK", input.activeMapRevisionId!)) };
  rescue.attemptIds = { BACK: "00000000-0000-4000-8000-000000000004" };
  rescue.decisionIds.retry = {};
  assert.ok(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(rescue), binding()));

  rescue.attemptIds.FRONT = "00000000-0000-4000-8000-000000000005";
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(rescue), binding()), null);
  delete rescue.attemptIds.FRONT;

  delete rescue.attemptIds.BACK;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(rescue), binding()), null);

  rescue.attemptIds.BACK = "not-a-uuid";
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(rescue), binding()), null);

  rescue.attemptIds.BACK = "00000000-0000-4000-8000-000000000004";
  rescue.interruptions.BACK = input.interruptions.BACK;
  rescue.decisionIds.retry.BACK = "00000000-0000-4000-8000-000000000003";
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(rescue), binding()), null);

  const interruptedOverlap = mutableClone(input);
  interruptedOverlap.provisional.BACK = mutableClone(registration("BACK", input.activeMapRevisionId!));
  interruptedOverlap.registrationRecordedAtMs.BACK = interruptedOverlap.updatedAtMs - 1;
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(interruptedOverlap), binding()), null);

  const extraRetry = mutableClone(input);
  extraRetry.decisionIds.retry.FRONT = "00000000-0000-4000-8000-000000000006";
  assert.equal(parseSpeedsterCaptureRegistrationDraft(JSON.stringify(extraRetry), binding()), null);
});
