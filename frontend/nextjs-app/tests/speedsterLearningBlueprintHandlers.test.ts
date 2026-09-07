import assert from "node:assert/strict";
import test from "node:test";

import {
  projectLearningBlueprintComparison,
  type LearningBlueprintEventRow,
  type LearningBlueprintGeometryRow,
  type LearningBlueprintSessionRow,
} from "../lib/server/speedsterLearningBlueprint";
import {
  SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION,
  SPEEDSTER_PHYSICAL_GEOMETRY_REASON,
  speedsterPhysicalGeometryLessonKey,
} from "../lib/server/speedsterPhysicalGeometryLessons";

function session(
  id: string,
  mapRevisionId: string | null = null,
  mapId: string | null = null,
): LearningBlueprintSessionRow {
  return {
    id,
    createdByUserId: "admin-1",
    cardProfile: "POKEMON",
    workflowState: "COMPLETED",
    identity: { cardName: id, productSet: "Test Set" },
    capture: {},
    reviewedDefects: [],
    gradeReport: { overall: { displayGrade: 9 } },
    mapRevisionId,
    mapRevision: mapId ? { mapId } : null,
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
  };
}

const firstId = "speedster-session-first-12345";
const secondId = "speedster-session-second-1234";

const proposal = [
  { x: 0.08, y: 0.06 },
  { x: 0.92, y: 0.06 },
  { x: 0.92, y: 0.94 },
  { x: 0.08, y: 0.94 },
] as const;
const corrected = [
  { x: 0.1, y: 0.08 },
  { x: 0.9, y: 0.08 },
  { x: 0.9, y: 0.92 },
  { x: 0.1, y: 0.92 },
] as const;

function geometryComparison(status: "USED" | "REJECTED" | "SKIPPED", finalCaptureLinked = false) {
  const mapId = "map-1";
  const mapRevisionId = "map-revision-1";
  const earlier = session(firstId, mapRevisionId, mapId);
  const later = session(secondId, mapRevisionId, mapId);
  const source = {
    id: "evidence-source-1",
    sessionId: earlier.id,
    createdByUserId: earlier.createdByUserId,
    side: "BACK",
    mode: "PHYSICAL_OUTER",
    matColor: "BLACK",
    outcome: "ACCEPTED",
    engineVersion: "speedster-color-geometry-v2",
    policyProvenance: "OWNER_APPROVED_VISIBLE_OUTLINE_V2",
    sourceImageSha256: "a".repeat(64),
    proposal,
    confirmedQuad: corrected,
    diagnostics: {},
    proposalChanged: true,
    createdAt: new Date("2026-08-20T01:00:00Z"),
  } satisfies LearningBlueprintGeometryRow;
  const lessonKey = speedsterPhysicalGeometryLessonKey({
    ...source,
    mapId,
    mapRevisionId,
  });
  const scanEventKey = `${later.id}:physical-geometry-lessons:event-1`;
  const laterEvidence = {
    ...source,
    id: "evidence-later-1",
    sessionId: later.id,
    diagnostics: status === "USED" && finalCaptureLinked ? {
      learning: {
        version: "speedster-physical-geometry-learning-v1",
        targetSessionId: later.id,
        side: "BACK",
        reasonCode: "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH",
        lessonKey,
        sourceEvidenceId: source.id,
        sourceSessionId: earlier.id,
        mapId,
        mapRevisionId,
        scanEventKey,
        lessonDraftChangedByOperator: false,
      },
    } : {},
    proposalChanged: false,
    createdAt: new Date("2026-08-20T02:00:00Z"),
  } satisfies LearningBlueprintGeometryRow;
  const reasonCode = status === "USED"
    ? "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH"
    : status === "REJECTED" ? "BASE_PROPOSAL_MISMATCH" : "ACTIVE_MAP_REVISION_MISMATCH";
  const event = {
    eventKey: scanEventKey,
    sessionId: later.id,
    createdByUserId: later.createdByUserId,
    category: "GEOMETRY_LEARNING",
    eventType: "PHYSICAL_GEOMETRY_LESSON_SCAN_VERDICTS_RECORDED",
    findingId: null,
    details: {
      version: SPEEDSTER_PHYSICAL_GEOMETRY_LEDGER_VERSION,
      targetSessionId: later.id,
      side: "BACK",
      mapId,
      activeMapRevisionId: mapRevisionId,
      reasonCatalog: { [reasonCode]: SPEEDSTER_PHYSICAL_GEOMETRY_REASON[reasonCode] },
      verdicts: [{
        lessonKey,
        evidenceId: source.id,
        sourceSessionId: earlier.id,
        mapId,
        mapRevisionId,
        status,
        reasonCode,
      }],
    },
    createdAt: new Date("2026-08-20T02:00:00Z"),
  } satisfies LearningBlueprintEventRow;
  return projectLearningBlueprintComparison({
    first: earlier,
    second: later,
    firstLabel: { sourceSessionId: earlier.id, certificateSequence: 1, createdAt: new Date("2026-08-20T01:00:00Z") },
    secondLabel: { sourceSessionId: later.id, certificateSequence: 2, createdAt: new Date("2026-08-20T02:00:00Z") },
    geometry: [source, laterEvidence],
    events: [event],
    filtered: [],
    presignRead: async () => { throw new Error("Unexpected image signing"); },
  });
}

test("geometry USED without matching final diagnostics remains unproven", async () => {
  const result = await geometryComparison("USED");
  assert.equal(result.trails.length, 1);
  assert.equal(result.trails[0].nextScan.status, "UNPROVEN");
  assert.deepEqual(result.trails[0].nextScan.reasonCodes, ["FINAL_CAPTURE_LEARNING_LINK_MISSING"]);
  assert.equal(result.trails[0].nextScan.finalCaptureLinked, false);
  assert.deepEqual(result.trails[0].nextScan.targetAnchors, []);
  assert.equal(result.pairSummary.unproven, 1);
  assert.equal(result.pairSummary.repeatedMistakesProven, 0);
});

test("rejected and skipped verdicts keep exact reasons and never become red repeat evidence", async () => {
  for (const status of ["REJECTED", "SKIPPED"] as const) {
    const result = await geometryComparison(status);
    assert.equal(result.trails[0].nextScan.status, status);
    const reasonCode = status === "REJECTED" ? "BASE_PROPOSAL_MISMATCH" : "ACTIVE_MAP_REVISION_MISMATCH";
    assert.deepEqual(result.trails[0].nextScan.reasons, [SPEEDSTER_PHYSICAL_GEOMETRY_REASON[reasonCode]]);
    assert.equal(result.trails[0].repeatedMistake, "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE");
    assert.equal(result.pairSummary.repeatedMistakesProven, 0);
    assert.equal(result.pairSummary[status === "REJECTED" ? "rejected" : "skipped"], 1);
    assert.deepEqual(result.trails[0].nextScan.targetAnchors, []);
  }
});

test("an exact final geometry link supplies the later-card marker anchor", async () => {
  const result = await geometryComparison("USED", true);
  assert.equal(result.trails[0].nextScan.status, "USED");
  assert.deepEqual(result.trails[0].sourceAnchor, {
    kind: "GEOMETRY",
    evidenceId: "evidence-source-1",
    side: "BACK",
  });
  assert.deepEqual(result.trails[0].nextScan.targetAnchors, [{
    kind: "GEOMETRY",
    evidenceId: "evidence-later-1",
    side: "BACK",
  }]);
});
