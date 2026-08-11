import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { SpeedsterMeasuredDefect } from "../lib/ai-grader-v2/contracts";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_REGISTRATION_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  speedsterCardTypeMapKey,
} from "../lib/ai-grader-v2/card-type-map-contracts";
import { SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION } from "../lib/ai-grader-v2/learning-calibration-v2";
import type { SpeedsterPinnedMapFilterInput } from "../lib/ai-grader-v2/map-filter";
import {
  replaySpeedsterMapFilter,
  SPEEDSTER_MAP_FILTER_VERIFICATION_STATUS,
  type SpeedsterMapFilterReplayCard,
} from "../lib/ai-grader-v2/map-filter-replay";

const sha = "a".repeat(64);
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
const finding = (id: string, x: number, origin: "DETECTOR" | "SMART_MARK" = "DETECTOR"):
SpeedsterMeasuredDefect => ({
  id,
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  detectedDefectType: "LIGHT_SCRATCH_SCUFF",
  origin,
  confidence: 0.9,
  canonicalContour: [{ x, y: 0.2 }, { x: x + 0.05, y: 0.2 }, { x: x + 0.05, y: 0.25 }],
  sourceViewId: "FRONT:ORIGINAL",
  supportingViewIds: [],
  reviewResult: origin === "SMART_MARK" ? "SMART_MARKED" : "UNREVIEWED",
  measurement,
});
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
const capture = {
  front: { centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 } },
  back: { centeringBorders: { leftMm: 10, rightMm: 10, topMm: 10, bottomMm: 10 } },
};
const boundaryComparisons = [{
  side: "FRONT" as const,
  savedHumanBoundary: { x: 1 },
  projectedBoundary: { x: 2 },
  boundaryReprojectionErrorPx: 1,
  savedCenteringRatio: [50, 50],
  replayCenteringRatio: [50, 50],
  centeringRatioDifference: 0,
  savedCenteringGrade: 10,
  replayCenteringGrade: 10,
  centeringGradeDifference: 0,
}];

function card(overrides: Partial<SpeedsterMapFilterReplayCard> = {}): SpeedsterMapFilterReplayCard {
  return {
    sessionId: "held-out-session-1234567890",
    cardIdentity: identity,
    detectorVersion: SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION,
    corpus: "HELD_OUT",
    map,
    capture,
    findings: [
      { finding: finding("FRONT:fake:SURFACE", 0.2), humanTruth: "HUMAN_REMOVED_FAKE", printOverlap: true },
      { finding: finding("FRONT:real:SURFACE", 0.3), humanTruth: "HUMAN_KEPT_REAL", printOverlap: true },
      { finding: finding("FRONT:smart:SURFACE", 0.2, "SMART_MARK"), humanTruth: "HUMAN_KEPT_REAL", printOverlap: true },
      { finding: finding("FRONT:outside:SURFACE", 0.7), humanTruth: "HUMAN_KEPT_REAL", printOverlap: false },
    ],
    boundaryComparisons,
    ...overrides,
  };
}

test("replay reports exact decisions, retention denominators, held-out separation, and immediate real-finding alerts", () => {
  const result = replaySpeedsterMapFilter([card()]);

  assert.equal(result.status, SPEEDSTER_MAP_FILTER_VERIFICATION_STATUS);
  assert.equal(result.zeroWrite, true);
  assert.equal(result.totals.heldOutCards, 1);
  assert.equal(result.totals.contaminatedCards, 0);
  assert.equal(result.totals.fakesFiltered, 1);
  assert.equal(result.totals.realFindingsFiltered, 1);
  assert.equal(result.totals.allRealRetention, 2 / 3);
  assert.equal(result.totals.printOverlapRealFindingsFiltered, 1);
  assert.equal(result.totals.printOverlapRealRetention, 1 / 2);
  assert.equal(result.totals.mapCoveredRealRetention, 2 / 3);
  assert.equal(result.totals.actuallyFilterEligibleRealRetention, 1 / 2);
  assert.equal(result.immediateAlertRequired, true);
  assert.equal(result.immediateAlerts.length, 1);
  assert.equal(result.immediateAlerts[0].imageCrop.x, 0.3);
  assert.equal(result.immediateAlerts[0].imageCrop.y, 0.2);
  assert.ok(Math.abs(result.immediateAlerts[0].imageCrop.width - 0.05) < 1e-12);
  assert.ok(Math.abs(result.immediateAlerts[0].imageCrop.height - 0.05) < 1e-12);
  assert.equal(result.immediateAlerts[0].mapRevisionId, map.revision.revisionId);
  assert.equal(result.immediateAlerts[0].ruleId, "human-zone-full-contour-containment-v1");
  assert.equal(result.perCard[0].mapCoverage.status, "COVERED");
  assert.equal(result.perCard[0].mapCoverage.independentValidation, true);
  assert.deepEqual(result.perCard[0].boundaryComparisons, boundaryComparisons);
});

test("replay keeps contaminated training-card results descriptive and reports missing or unusable maps", () => {
  const contaminated = card({
    sessionId: map.revision.sourceSessionId,
    corpus: "CONTAMINATED_50",
  });
  const missing = card({ sessionId: "missing-map-session-1234567", map: null });
  const unusable = card({
    sessionId: "unusable-map-session-12345",
    detectorVersion: "wrong-detector-version",
  });

  const result = replaySpeedsterMapFilter([contaminated, missing, unusable]);

  assert.equal(result.contamination.singleCopyResults, "DESCRIPTIVE_ONLY");
  assert.equal(result.contamination.trainingCardsAreIndependentValidation, false);
  assert.equal(result.contaminated[0].mapCoverage.trainingCard, true);
  assert.equal(result.contaminated[0].mapCoverage.independentValidation, false);
  assert.deepEqual(result.missingMaps, [missing.sessionId]);
  assert.equal(result.unusableMaps[0].sessionId, unusable.sessionId);
  assert.match(result.unusableMaps[0].error, /incompatible detector/i);
});

test("the replay CLI is an explicit local JSON reader with no database, provider, or file-write path", () => {
  const appRoot = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(`${appRoot}/../../scripts/ai-grader/replay-speedster-map-filter.ts`, "utf8");

  assert.match(source, /readFile/);
  assert.match(source, /process\.stdout\.write/);
  assert.doesNotMatch(source, /@tenkings\/database|Prisma|fetch\(|writeFile|appendFile|createWriteStream/);
});
