import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterMeasuredDefect, SpeedsterReviewFinding } from "../lib/ai-grader-v2/contracts";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
  SPEEDSTER_MAP_FILTER_RULE_ID_V2,
  SPEEDSTER_MAP_FILTER_RULE_ID,
  SPEEDSTER_MAP_REGISTRATION_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION_V2,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import { SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } from "../lib/ai-grader-v2/learning-calibration-v2";
import {
  speedsterBestAuthorizedMapZoneDiagnostic,
  splitSpeedsterMapFilteredCandidates,
  type SpeedsterPinnedMapFilterInput,
} from "../lib/ai-grader-v2/map-filter";
import { harvestSpeedsterLearningSessionV2 } from "../lib/ai-grader-v2/learning-harvest-v2";
import {
  applySpeedsterReviewAction,
  type SpeedsterReviewActionSession,
} from "../lib/server/aiGraderV2ReviewAction";
import { calculateSpeedsterReview } from "../lib/ai-grader-v2/review";
import {
  SPEEDSTER_TRACE_HEIGHT,
  SPEEDSTER_TRACE_PIXEL_COUNT,
  SPEEDSTER_TRACE_WIDTH,
  encodeSpeedsterTraceRleV1,
} from "../lib/ai-grader-v2/trace-codec";
import { rasterizeSpeedsterCanonicalContour } from "../lib/ai-grader-v2/trace-editor";

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

test("canonical detector mask keeps disconnected inside/outside components in review", () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  const paint = (left: number, top: number, width: number, height: number) => {
    for (let y = top; y < top + height; y += 1) {
      pixels.fill(1, y * SPEEDSTER_TRACE_WIDTH + left, y * SPEEDSTER_TRACE_WIDTH + left + width);
    }
  };
  paint(250, 400, 10, 10);
  paint(900, 400, 5, 5);
  const detectorMask = encodeSpeedsterTraceRleV1(pixels);
  const disconnected: SpeedsterMeasuredDefect = {
    ...inside,
    id: "FRONT:disconnected:SURFACE",
    // Deliberately represents only the first component: the exact mask, not
    // this compatibility contour, must own the filter decision.
    canonicalContour: [
      { x: 0.19, y: 0.22 },
      { x: 0.21, y: 0.22 },
      { x: 0.21, y: 0.24 },
    ],
    detectorMask,
    measurement: { ...measurement, pixelCount: 125 },
  };

  const result = splitSpeedsterMapFilteredCandidates({
    findings: [disconnected, smartMark],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map,
  });

  assert.deepEqual(result.activeFindings.map(({ id }) => id), [disconnected.id, smartMark.id]);
  assert.equal(result.filteredDecisions.length, 0);
  const diagnostic = speedsterBestAuthorizedMapZoneDiagnostic(
    disconnected,
    (map.registration as { front: ReturnType<typeof registrationSide> }).front.projectedZones,
  );
  assert.equal(diagnostic?.overlap.method, "candidate-canonical-mask-pixel-containment-v1");
  assert.equal(diagnostic?.overlap.fullyContained, false);
  assert.equal(diagnostic?.overlap.ratio, 0.8);
  assert.equal(detectorMask.height, SPEEDSTER_TRACE_HEIGHT);
});

test("canonical detector mask allows boundary contact but any outside pixel prevents filtering", () => {
  const findingWithPixels = (id: string, coordinates: readonly (readonly [number, number])[]) => {
    const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
    for (const [x, y] of coordinates) pixels[y * SPEEDSTER_TRACE_WIDTH + x] = 1;
    return {
      ...inside,
      id,
      detectorMask: encodeSpeedsterTraceRleV1(pixels),
      measurement: { ...measurement, pixelCount: coordinates.length },
    } satisfies SpeedsterMeasuredDefect;
  };
  const boundaryX = Math.floor(0.5 * (SPEEDSTER_TRACE_WIDTH - 1));
  const boundaryY = Math.floor(0.5 * (SPEEDSTER_TRACE_HEIGHT - 1));
  const contact = findingWithPixels("FRONT:mask-boundary:SURFACE", [
    [boundaryX, boundaryY],
    [boundaryX - 1, boundaryY - 1],
  ]);
  const partial = findingWithPixels("FRONT:mask-partial:SURFACE", [
    [boundaryX - 1, boundaryY - 1],
    [boundaryX + 2, boundaryY],
  ]);

  const result = splitSpeedsterMapFilteredCandidates({
    findings: [contact, partial],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map,
  });

  assert.deepEqual(result.filteredDecisions.map(({ finding }) => finding.id), [contact.id]);
  assert.deepEqual(result.activeFindings.map(({ id }) => id), [partial.id]);
  assert.equal(result.filteredDecisions[0].zoneOverlap.method, "candidate-canonical-mask-pixel-containment-v1");
});

test("v2 separates content from filter authority and applies physical padding without weakening full-contour safety", () => {
  const v2Side = (side: "FRONT" | "BACK") => ({
    ...mapSide(side),
    zones: [{
      ...mapSide(side).zones[0],
      semanticType: "PRINT_TEXT" as const,
      contentType: "ATTACK" as const,
      filterAuthority: side === "FRONT",
      filterAuthoritySource: "HUMAN_OVERRIDE" as const,
      filterPaddingMm: 0.6 as const,
      proposalSource: "HUMAN" as const,
      proposalConfidence: null,
    }],
  });
  const v2Map: SpeedsterPinnedMapFilterInput = {
    ...map,
    revision: {
      ...map.revision,
      mapSchemaVersion: SPEEDSTER_MAP_SCHEMA_VERSION_V2,
      filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
      frontMap: v2Side("FRONT"),
      backMap: v2Side("BACK"),
    },
    registration: {
      front: {
        ...registrationSide("FRONT"),
        projectedZones: v2Side("FRONT").zones.map(({ id, label, semanticType, polygon }) => ({
          id, label, semanticType, polygon,
        })),
      },
      back: {
        ...registrationSide("BACK"),
        projectedZones: v2Side("BACK").zones.map(({ id, label, semanticType, polygon }) => ({
          id, label, semanticType, polygon,
        })),
      },
    },
  };
  const insidePadding = {
    ...inside,
    id: "FRONT:padded:SURFACE",
    canonicalContour: [
      { x: 0.505, y: 0.2 },
      { x: 0.506, y: 0.2 },
      { x: 0.505, y: 0.21 },
    ],
  };
  const beyondPadding = {
    ...insidePadding,
    id: "FRONT:beyond-padding:SURFACE",
    canonicalContour: [
      { x: 0.511, y: 0.2 },
      { x: 0.512, y: 0.2 },
      { x: 0.511, y: 0.21 },
    ],
  };
  const result = splitSpeedsterMapFilteredCandidates({
    findings: [insidePadding, beyondPadding, memoryInside, smartMark],
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    map: v2Map,
  });
  assert.deepEqual(result.filteredDecisions.map(({ finding }) => finding.id), [insidePadding.id]);
  assert.deepEqual(result.activeFindings.map(({ id }) => id), [beyondPadding.id, memoryInside.id, smartMark.id]);
  assert.equal(result.filteredDecisions[0].filterPolicyVersion, SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2);
  assert.equal(result.filteredDecisions[0].ruleId, SPEEDSTER_MAP_FILTER_RULE_ID_V2);
  assert.deepEqual(result.filteredDecisions[0].ruleInputs, {
    findingOrigin: "DETECTOR",
    requiredCoverageRatio: 1,
    filterAuthority: true,
    filterPaddingMm: 0.6,
  });
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

  const fullyContainedZone = {
    ...concaveZone,
    id: "FRONT-full-zone",
    label: "Full print",
    polygon: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ],
  };
  const diagnostic = speedsterBestAuthorizedMapZoneDiagnostic(
    crossing,
    [concaveZone, fullyContainedZone],
  );
  assert.equal(diagnostic?.overlap.ratio, 1, "both candidate zones have all contour vertices inside");
  assert.equal(diagnostic?.overlap.fullyContained, true);
  assert.equal(diagnostic?.zone.id, fullyContainedZone.id);
});

const capture = {
  cornerShape: "SQUARE",
  front: {
    originalStorageKey: `ai-grader-v2/admin-1/${sessionId}/original/front.jpg`,
    rectifiedStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/front/rectified.webp`,
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
    originalStorageKey: `ai-grader-v2/admin-1/${sessionId}/original/back.jpg`,
    rectifiedStorageKey: `ai-grader-v2/admin-1/${sessionId}/prepared/back/rectified.webp`,
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

function detectorResponse(findings: readonly SpeedsterMeasuredDefect[]) {
  const authoritative = findings.map((finding, index) => {
    const candidateId = `raw-${finding.side === "FRONT" ? "a" : "b"}${index.toString(16).padStart(23, "0")}`;
    const pixels = rasterizeSpeedsterCanonicalContour(finding.canonicalContour);
    const detectorMask = encodeSpeedsterTraceRleV1(pixels);
    const pixelCount = pixels.reduce((total, pixel) => total + pixel, 0);
    return {
      finding: {
        ...finding,
        detectorMask,
        measurement: { ...finding.measurement, pixelCount },
        findingProvenance: {
          version: "speedster-finding-provenance-v1" as const,
          primaryProposalId: `${finding.side}:${index}`,
          contributors: [{
            proposalId: `${finding.side}:${index}`,
            rawCandidateId: candidateId,
            origin: finding.origin ?? "DETECTOR",
            sourceViewId: finding.sourceViewId,
            defectType: finding.defectType,
            confidence: finding.confidence,
            rankingConfidence: finding.confidence,
            ...(finding.memoryProposal ? { memoryProposal: finding.memoryProposal } : {}),
          }],
        },
      },
      candidate: {
        version: "speedster-raw-detector-candidate-v1",
        candidateId,
        evidenceOrdinal: index,
        sourceViewId: finding.sourceViewId,
        promptIndex: index,
        maskIndex: 0,
        promptBox: [1, 2, 3, 4],
        defectType: finding.defectType,
        origin: finding.origin ?? "DETECTOR",
        rawConfidence: finding.confidence,
        featureFingerprint: null,
        canonicalMask: detectorMask,
        ...(finding.memoryProposal ? { memoryProposal: finding.memoryProposal } : {}),
      },
      decision: {
        version: "speedster-memory-decision-evidence-v1",
        candidateId,
        policy: "SAM_MEMORY_V2",
        action: "retained",
        adjustment: 0,
        adjustedConfidence: finding.confidence,
        collectionThreshold: 0.5,
        disposition: "RETAINED_FOR_MEASUREMENT",
        diagnostic: { action: "retained", bankVersion: 2 },
      },
    };
  });
  return {
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    defects: authoritative.map(({ finding }) => finding),
    detectorEvidence: {
      version: "speedster-detector-evidence-v1",
      rawCandidates: authoritative.map(({ candidate }) => candidate),
      memoryDecisions: authoritative.map(({ decision }) => decision),
    },
  };
}

test("INITIALIZE shares one Memory object across sequential detectors, then atomically persists the filtered split", async () => {
  const initial = initializeSession(true);
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
      return detectorResponse(body.side === "FRONT" ? [inside] : [outside]);
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
  assert.equal(backStartedWhileFrontPending, false);
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
    async detect() {
      return {
        detectorVersion: "unchanged-pre-map-version",
        defects: [],
        detectorEvidence: {
          version: "speedster-detector-evidence-v1",
          rawCandidates: [],
          memoryDecisions: [],
        },
      };
    },
    async measure() { throw new Error("must not measure"); },
  });
  assert.equal(mapLoads, 0);
  assert.deepEqual(Object.keys(persisted ?? {}).sort(), ["gradeReport", "reviewedDefects"]);
  assert.deepEqual(Object.keys(result).sort(), [
    "detectorAttempts",
    "gradeReport",
    "measurementDeltas",
    "reviewedDefects",
    "traceHashes",
  ]);
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
  }), /map initialization failed/i);
  assert.equal(detected, false);
  assert.equal(persisted, false);
});

test("a pinned family revision applies across card names within the same Card Type", async () => {
  const initial = { ...initializeSession(true), identity: { ...identity, layoutType: "POKEMON" as const } };
  const sourceIdentity = { ...identity, cardName: "Snorlax", cardNumber: "143/196", layoutType: "POKEMON" as const };
  const familyKey = speedsterFamilyCardTypeMapKey("POKEMON", sourceIdentity);
  const familyMap: SpeedsterPinnedMapFilterInput = {
    ...map,
    revision: {
      ...map.revision,
      matchKey: familyKey,
      normalizedIdentity: familyKey,
      displayIdentity: sourceIdentity,
    },
  };
  let persisted = false;

  const result = await applySpeedsterReviewAction({
    sessionId,
    createdByUserId: "admin-1",
    action: { type: "INITIALIZE" },
  }, {
    async loadOwnedSession() { return initial; },
    async loadPinnedMapFilter() { return familyMap; },
    async persistReviewIfRevision() { persisted = true; },
    async presignRead(key) { return `https://local.invalid/${key}`; },
    async learningBankForDetect() { return {}; },
    async detect() {
      return {
        detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
        defects: [],
        detectorEvidence: {
          version: "speedster-detector-evidence-v1",
          rawCandidates: [],
          memoryDecisions: [],
        },
      };
    },
    async measure() { throw new Error("must not measure"); },
  });

  assert.equal(persisted, true);
  assert.deepEqual(result.reviewedDefects, []);
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
