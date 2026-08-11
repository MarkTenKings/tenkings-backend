import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterMeasuredDefect, SpeedsterReviewFinding } from "../lib/ai-grader-v2/contracts";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_RULE_ID,
  SPEEDSTER_MAP_REGISTRATION_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  speedsterCardTypeMapKey,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import { SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } from "../lib/ai-grader-v2/learning-calibration-v2";
import {
  splitSpeedsterMapFilteredCandidates,
  type SpeedsterPinnedMapFilterInput,
} from "../lib/ai-grader-v2/map-filter";
import { harvestSpeedsterLearningSessionV2 } from "../lib/ai-grader-v2/learning-harvest-v2";
import {
  applySpeedsterReviewAction,
  type SpeedsterReviewActionSession,
} from "../lib/server/aiGraderV2ReviewAction";
import { calculateSpeedsterReview } from "../lib/ai-grader-v2/review";

const sessionId = "session-12345678901234567890";
const identity = {
  cardName: "Cubone",
  year: "1999",
  productSet: "Jungle",
  parallel: null,
  cardNumber: "50/64",
};
const measurement = {
  widthMm: 1,
  heightMm: 1,
  areaMm2: 1,
  zonePercent: 0.2,
  multiplier: 1,
  weightedAreaMm2: 1,
  subgradeEffect: 0.1,
};
const inside: SpeedsterMeasuredDefect = {
  id: "FRONT:inside:SURFACE",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  detectedDefectType: "LIGHT_SCRATCH_SCUFF",
  origin: "DETECTOR",
  confidence: 0.91,
  canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: ["FRONT:DIRECTIONAL"],
  reviewResult: "UNREVIEWED",
  measurement,
};
const outside: SpeedsterMeasuredDefect = {
  ...inside,
  id: "BACK:outside:SURFACE",
  side: "BACK",
  origin: "MEMORY",
  canonicalContour: [{ x: 0.7, y: 0.7 }, { x: 0.8, y: 0.7 }, { x: 0.8, y: 0.8 }],
  sourceViewId: "BACK:ORIGINAL",
  supportingViewIds: [],
  memoryProposal: {
    lessonSessionId: "lesson-session-1234567890",
    lessonCompletionOrder: 7,
    lessonProposalOrder: 2,
    lessonOrder: 0,
    lessonSourceViewId: "ORIGINAL",
    similarity: 0.94,
  },
};
const smartMark: SpeedsterMeasuredDefect = {
  ...inside,
  id: "FRONT:smart:SURFACE",
  origin: "SMART_MARK",
  reviewResult: "SMART_MARKED",
};
const memoryInside: SpeedsterMeasuredDefect = {
  ...outside,
  id: "BACK:memory-inside:SURFACE",
  canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.3 }],
};
const sha = "a".repeat(64);
const anchorPoints = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;
const mapSide = (side: "FRONT" | "BACK") => ({
  side,
  referenceInspection: { storageKey: `private/${side.toLowerCase()}.webp`, sha256: sha },
  sourcePhysicalQuadSha256: sha,
  designBoundary: { kind: "FULL_BLEED" as const },
  anchors: anchorPoints.map((point, index) => ({
    id: `${side}-anchor-${index + 1}`,
    label: `Anchor ${index + 1}`,
    point,
    referencePatch: { storageKey: `private/${side.toLowerCase()}-anchor.webp`, sha256: sha },
  })),
  zones: [{
    id: `${side}-print-zone`,
    label: "Printed artwork",
    semanticType: "PRINT_ARTWORK" as const,
    polygon: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }],
  }],
});
const registrationSide = (side: "FRONT" | "BACK") => ({
  version: SPEEDSTER_MAP_REGISTRATION_VERSION,
  side,
  mapRevisionId: "map-revision-1234567890123",
  currentPhysicalQuadSha256: sha,
  currentInspectionSha256: sha,
  homography: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
  anchors: anchorPoints.map((point, index) => ({
    anchorId: `${side}-anchor-${index + 1}`,
    expectedPoint: point,
    locatedPoint: point,
    score: 1,
  })),
  projectedDesignBoundary: { kind: "FULL_BLEED" as const },
  projectedZones: mapSide(side).zones,
});
const map: SpeedsterPinnedMapFilterInput = {
  revision: {
    mapId: "map-12345678901234567890",
    revisionId: "map-revision-1234567890123",
    version: 1,
    matchKeyHash: sha,
    matchKey: speedsterCardTypeMapKey("POKEMON", identity),
    displayIdentity: identity,
    normalizedIdentity: speedsterCardTypeMapKey("POKEMON", identity),
    authorAdminId: "admin-1",
    mapSchemaVersion: SPEEDSTER_MAP_SCHEMA_VERSION,
    filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
    revisionHash: sha,
    sourceSessionId: "training-session-1234567890",
    frontMap: mapSide("FRONT"),
    backMap: mapSide("BACK"),
    supersedesRevisionId: null,
    createdAt: new Date("2026-08-10T00:00:00.000Z"),
  },
  registration: { front: registrationSide("FRONT"), back: registrationSide("BACK") },
};

test("the frozen full-contour rule splits Detector/Memory candidates and Smart-Marks bypass filtering", () => {
  const result = splitSpeedsterMapFilteredCandidates({
    findings: [inside, memoryInside, outside, smartMark],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map,
  });
  assert.deepEqual(result.activeFindings.map(({ id }) => id), [outside.id, smartMark.id]);
  assert.equal(result.filteredDecisions.length, 2);
  const [decision] = result.filteredDecisions;
  assert.equal(decision.finding, inside);
  assert.equal(decision.mapId, map.revision.mapId);
  assert.equal(decision.mapRevisionId, map.revision.revisionId);
  assert.equal(decision.zoneId, "FRONT-print-zone");
  assert.deepEqual(decision.zoneOverlap, {
    method: "candidate-contour-segment-containment-v1",
    coveredVertices: 3,
    totalVertices: 3,
    ratio: 1,
    fullyContained: true,
  });
  assert.equal(decision.ruleId, SPEEDSTER_MAP_FILTER_RULE_ID);
  assert.equal(decision.filterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION);
  assert.equal(decision.detectorVersion, SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION);
  assert.equal(JSON.stringify(decision).includes("canonicalContour"), true);
  assert.equal(result.filteredDecisions[1].finding.origin, "MEMORY");
  assert.equal(result.filteredDecisions[1].ruleInputs.findingOrigin, "MEMORY");
});

test("partial containment stays in active review and invalid registration fails without deleting evidence", () => {
  const boundary = {
    ...inside,
    id: "FRONT:boundary:SURFACE",
    canonicalContour: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.3, y: 0.3 }],
  };
  assert.deepEqual(splitSpeedsterMapFilteredCandidates({
    findings: [boundary],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map,
  }).activeFindings, [boundary]);
  const onZoneBoundary = {
    ...inside,
    id: "FRONT:on-zone-boundary:SURFACE",
    canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.3, y: 0.3 }],
  };
  assert.equal(splitSpeedsterMapFilteredCandidates({
    findings: [onZoneBoundary],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map,
  }).filteredDecisions.length, 1);
  assert.throws(() => splitSpeedsterMapFilteredCandidates({
    findings: [inside],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map: { ...map, registration: { front: { ...registrationSide("FRONT"), mapRevisionId: "wrong" }, back: registrationSide("BACK") } },
  }), /registration/i);
  const frontRegistration = registrationSide("FRONT");
  assert.throws(() => splitSpeedsterMapFilteredCandidates({
    findings: [inside],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map: {
      ...map,
      registration: {
        front: {
          ...frontRegistration,
          projectedZones: frontRegistration.projectedZones.map((candidateZone) => ({
            ...candidateZone,
            polygon: candidateZone.polygon.map((candidatePoint, index) =>
              index === 0 ? { x: 0.2, y: 0.1 } : candidatePoint),
          })),
        },
        back: registrationSide("BACK"),
      },
    },
  }), /projected zone geometry/i);
  assert.throws(() => splitSpeedsterMapFilteredCandidates({
    findings: [inside],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map: {
      ...map,
      registration: {
        front: {
          ...frontRegistration,
          anchors: frontRegistration.anchors.map((candidateAnchor) => ({
            ...candidateAnchor,
            locatedPoint: { x: 0.2, y: 0.1 },
          })),
        },
        back: registrationSide("BACK"),
      },
    },
  }), /anchors are degenerate|anchor projection/i);
  const designBoundary = {
    kind: "QUAD" as const,
    points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] as const,
  };
  assert.throws(() => splitSpeedsterMapFilteredCandidates({
    findings: [inside],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map: {
      ...map,
      revision: {
        ...map.revision,
        frontMap: { ...map.revision.frontMap, designBoundary },
      },
      registration: {
        front: {
          ...frontRegistration,
          projectedDesignBoundary: {
            ...designBoundary,
            points: designBoundary.points.map((candidatePoint, index) =>
              index === 0 ? { x: 0.2, y: 0.1 } : candidatePoint) as unknown as typeof designBoundary.points,
          },
        },
        back: registrationSide("BACK"),
      },
    },
  }), /design boundary/i);
  assert.equal(inside.reviewResult, "UNREVIEWED");
});

test("full-contour containment rejects an edge that exits a valid concave zone while allowing boundary contact", () => {
  const concaveZone = {
    id: "FRONT-concave-zone",
    label: "Concave print",
    semanticType: "PRINT_ARTWORK" as const,
    polygon: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.65, y: 0.9 },
      { x: 0.65, y: 0.35 },
      { x: 0.35, y: 0.35 },
      { x: 0.35, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };
  const crossing = {
    ...inside,
    id: "FRONT:concave-crossing:SURFACE",
    canonicalContour: [{ x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }, { x: 0.5, y: 0.2 }],
  };
  const boundaryContact = {
    ...inside,
    id: "FRONT:concave-boundary:SURFACE",
    canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.35, y: 0.35 }, { x: 0.2, y: 0.4 }],
  };
  const frontRegistration = registrationSide("FRONT");
  const concaveMap = {
    ...map,
    revision: {
      ...map.revision,
      frontMap: { ...map.revision.frontMap, zones: [concaveZone] },
    },
    registration: {
      ...(map.registration as { front: typeof frontRegistration; back: ReturnType<typeof registrationSide> }),
      front: { ...frontRegistration, projectedZones: [concaveZone] },
    },
  };
  const result = splitSpeedsterMapFilteredCandidates({
    findings: [crossing, boundaryContact],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map: concaveMap,
  });
  assert.deepEqual(result.activeFindings.map(({ id }) => id), [crossing.id]);
  assert.deepEqual(result.filteredDecisions.map(({ finding }) => finding.id), [boundaryContact.id]);
  assert.equal(result.filteredDecisions[0].zoneOverlap.fullyContained, true);
});

const capture = {
  cornerShape: "SQUARE",
  front: {
    inspectionStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/front/inspection.webp`,
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/admin-1/${sessionId}/prepared/front/normalized.webp`,
      MICRO_DEFECT: `ai-grader-v2/admin-1/${sessionId}/prepared/front/micro_defect.webp`,
      DIRECTIONAL: `ai-grader-v2/admin-1/${sessionId}/prepared/front/directional.webp`,
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
  back: {
    inspectionStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/back/inspection.webp`,
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    viewStorageKeys: {
      NORMALIZED: `ai-grader-v2/admin-1/${sessionId}/prepared/back/normalized.webp`,
      MICRO_DEFECT: `ai-grader-v2/admin-1/${sessionId}/prepared/back/micro_defect.webp`,
      DIRECTIONAL: `ai-grader-v2/admin-1/${sessionId}/prepared/back/directional.webp`,
    },
    centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 },
  },
};

function initializeSession(withMap: boolean): SpeedsterReviewActionSession {
  return {
    id: sessionId,
    createdByUserId: "admin-1",
    cardProfile: "POKEMON",
    workflowState: "CAPTURED",
    identity,
    capture,
    reviewedDefects: [],
    gradeReport: {},
    ...(withMap ? {
      mapRevisionId: map.revision.revisionId,
      mapFilterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
      mapRegistration: map.registration,
    } : {}),
    updatedAt: new Date("2026-08-10T00:00:00.000Z"),
  };
}

test("INITIALIZE shares one Memory object across simultaneous detectors, then atomically persists the filtered split", async () => {
  const initial = initializeSession(true);
  const instrumentedInside = {
    ...inside,
    findingProvenance: {
      version: "speedster-finding-provenance-v1" as const,
      primaryProposalId: "FRONT:0",
      contributors: [{
        proposalId: "FRONT:0",
        origin: "DETECTOR" as const,
        sourceViewId: inside.sourceViewId,
        defectType: inside.defectType,
        confidence: inside.confidence,
        rankingConfidence: inside.confidence,
      }],
    },
  };
  const sharedLearningBank = { version: "GLOBAL" };
  let learningBankCalls = 0;
  const detectorLearningBanks: unknown[] = [];
  let frontSettled = false;
  let backStartedWhileFrontPending = false;
  let detectorReturns = 0;
  let persistedAfterDetectorPair = false;
  let instrumentation: readonly { operatorAction?: string | null; details?: unknown }[] = [];
  let persisted: {
    reviewedDefects: readonly unknown[];
    gradeReport: unknown;
    filterDecisions?: readonly unknown[];
  } | null = null;
  const result = await applySpeedsterReviewAction({
    sessionId,
    createdByUserId: "admin-1",
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async loadPinnedMapFilter() { return map; },
    async persistReviewIfRevision(_identity, _updatedAt, data) {
      persistedAfterDetectorPair = detectorReturns === 2;
      persisted = data;
    },
    async presignRead(key) { return `https://local.invalid/${key}`; },
    async learningBankForDetect() {
      learningBankCalls += 1;
      return sharedLearningBank;
    },
    async detect(body) {
      detectorLearningBanks.push(body.learningBank);
      assert.equal(body.learningBank, sharedLearningBank);
      if (body.side === "FRONT") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        frontSettled = true;
      } else {
        backStartedWhileFrontPending = !frontSettled;
      }
      detectorReturns += 1;
      return {
        detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
        defects: body.side === "FRONT" ? [instrumentedInside] : [outside],
      };
    },
    async measure() { throw new Error("must not measure"); },
    async recordInstrumentation(events) { instrumentation = events; },
  });
  const saved = persisted as unknown as {
    reviewedDefects: SpeedsterReviewFinding[];
    gradeReport: unknown;
    filterDecisions: unknown[];
  };
  assert.equal(learningBankCalls, 1);
  assert.equal(detectorLearningBanks.length, 2);
  assert.ok(detectorLearningBanks.every((candidate) => candidate === sharedLearningBank));
  assert.equal(backStartedWhileFrontPending, true);
  assert.equal(detectorReturns, 2);
  assert.equal(persistedAfterDetectorPair, true);
  assert.deepEqual(saved.reviewedDefects.map(({ id }) => id), [outside.id]);
  assert.equal(saved.filterDecisions.length, 1);
  const [savedDecision] = saved.filterDecisions as Array<Record<string, unknown>>;
  assert.deepEqual(savedDecision.cardIdentity, identity);
  assert.equal(savedDecision.mapId, map.revision.mapId);
  assert.equal(savedDecision.mapRevisionId, map.revision.revisionId);
  assert.equal(savedDecision.zoneType, "PRINT_ARTWORK");
  assert.equal(savedDecision.filterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION);
  assert.equal(savedDecision.ruleId, SPEEDSTER_MAP_FILTER_RULE_ID);
  assert.deepEqual(savedDecision.ruleInputs, { findingOrigin: "DETECTOR", requiredCoverageRatio: 1 });
  assert.equal(savedDecision.detectorVersion, SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION);
  assert.match(JSON.stringify(savedDecision.finding), /speedster-finding-provenance-v1/);
  assert.equal(instrumentation.some(({ operatorAction }) => operatorAction === "FILTER_REMOVED"), true);
  assert.deepEqual(result.reviewedDefects.map(({ id }) => id), [outside.id]);
  assert.deepEqual(
    result.gradeReport,
    {
      ...calculateSpeedsterReview(capture, [outside]).grade,
      detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    },
  );
  assert.equal(JSON.stringify(result).includes("filteredDecisions"), false);
  assert.equal((result.gradeReport as { detectorVersion: string }).detectorVersion, SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION);
});

test("no map leaves the existing result/persist shape unchanged and does not invoke a map loader", async () => {
  const initial = initializeSession(false);
  let mapLoads = 0;
  let persisted: Record<string, unknown> | null = null;
  const result = await applySpeedsterReviewAction({
    sessionId,
    createdByUserId: "admin-1",
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async loadPinnedMapFilter() { mapLoads += 1; return map; },
    async persistReviewIfRevision(_identity, _updatedAt, data) { persisted = data; },
    async presignRead(key) { return `https://local.invalid/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() { return { detectorVersion: "unchanged-pre-map-version", defects: [] }; },
    async measure() { throw new Error("must not measure"); },
  });
  assert.equal(mapLoads, 0);
  assert.deepEqual(Object.keys(persisted ?? {}).sort(), ["gradeReport", "reviewedDefects"]);
  assert.deepEqual(Object.keys(result).sort(), ["gradeReport", "measurementDeltas", "reviewedDefects", "traceHashes"]);
});

test("invalid pinned map is a controlled initialization failure with no persistence", async () => {
  const initial = initializeSession(true);
  let persisted = false;
  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId,
    createdByUserId: "admin-1",
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async loadPinnedMapFilter() { throw new Error("revision hash mismatch"); },
    async persistReviewIfRevision() { persisted = true; },
    async presignRead(key) { return `https://local.invalid/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() { throw new Error("must not detect"); },
    async measure() { throw new Error("must not measure"); },
  }), /map initialization failed: revision hash mismatch/i);
  assert.equal(persisted, false);
});

test("a pinned revision for a different exact card key fails visibly before detection or persistence", async () => {
  const initial = initializeSession(true);
  const wrongIdentity = { ...identity, cardName: "Pikachu" };
  const wrongMap: SpeedsterPinnedMapFilterInput = {
    ...map,
    revision: {
      ...map.revision,
      matchKey: speedsterCardTypeMapKey("POKEMON", wrongIdentity),
      normalizedIdentity: speedsterCardTypeMapKey("POKEMON", wrongIdentity),
      displayIdentity: wrongIdentity,
    },
  };
  let detected = false;
  let persisted = false;

  await assert.rejects(() => applySpeedsterReviewAction({
    sessionId,
    createdByUserId: "admin-1",
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async loadPinnedMapFilter() { return wrongMap; },
    async persistReviewIfRevision() { persisted = true; },
    async presignRead(key) { return `https://local.invalid/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() { detected = true; throw new Error("must not detect"); },
    async measure() { throw new Error("must not measure"); },
  }), /exact card-type key does not match the session identity/i);
  assert.equal(detected, false);
  assert.equal(persisted, false);
});

test("filter decisions cannot masquerade as human-negative Memory lessons", () => {
  const split = splitSpeedsterMapFilteredCandidates({
    findings: [inside, outside],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map,
  });
  const harvested = harvestSpeedsterLearningSessionV2({
    sessionId,
    completedAt: "2026-08-10T00:00:00.000Z",
    completionOrder: 1,
    fingerprintVersion: "sam3-fpn-mean-32-v1",
    reviewedDefects: split.activeFindings,
  });
  assert.equal(harvested.history.lessons.some(({ polarity }) => polarity === "NEGATIVE"), false);
  assert.equal(split.filteredDecisions[0].finding.reviewResult, "UNREVIEWED");
});
