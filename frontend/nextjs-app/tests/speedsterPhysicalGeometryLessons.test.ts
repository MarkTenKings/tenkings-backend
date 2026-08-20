import assert from "node:assert/strict";
import test from "node:test";

import type { SpeedsterColorGeometryProposal } from "../lib/ai-grader-v2/color-geometry";
import {
  evaluateSpeedsterPhysicalGeometryLessons,
  recordSpeedsterPhysicalGeometryLessonScan,
  SPEEDSTER_PHYSICAL_GEOMETRY_MAX_LESSONS,
  speedsterPhysicalGeometryLessonKey,
  verifySpeedsterPhysicalGeometryLearningCapture,
  type SpeedsterPhysicalGeometryLessonRow,
} from "../lib/server/speedsterPhysicalGeometryLessons";

const baseQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;
const correctedQuad = [
  { x: 0.08, y: 0.09 },
  { x: 0.92, y: 0.09 },
  { x: 0.91, y: 0.92 },
  { x: 0.09, y: 0.91 },
] as const;

const proposal = (quad: typeof baseQuad | null = baseQuad): SpeedsterColorGeometryProposal => ({
  version: "speedster-color-geometry-proposal-v1",
  engineVersion: "speedster-color-geometry-v2",
  authority: "PROPOSER_ONLY",
  policyProvenance: "OWNER_APPROVED_VISIBLE_OUTLINE_V2",
  mode: "PHYSICAL_OUTER",
  outcome: quad ? "ACCEPTED" : "INSUFFICIENT_EVIDENCE",
  matColor: "BLACK",
  proposal: quad,
  contrastFloorDeltaE: 18,
  minimumSideSupport: 0.7,
  sideEvidence: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, {
    medianContrastDeltaE: 30,
    supportFraction: 0.8,
    sampleCount: 100,
    candidateCount: 1,
    ambiguous: false,
  }])) as SpeedsterColorGeometryProposal["sideEvidence"],
  ambiguity: { candidateCount: 1, runnerUpScoreRatio: null, ambiguous: false },
  advisory: null,
});

const row = (overrides: Partial<SpeedsterPhysicalGeometryLessonRow> = {}): SpeedsterPhysicalGeometryLessonRow => ({
  id: "evidence-1",
  sessionId: "source-session-1",
  mapId: "map-1",
  mapRevisionId: "revision-2",
  side: "BACK",
  mode: "PHYSICAL_OUTER",
  matColor: "BLACK",
  outcome: "ACCEPTED",
  engineVersion: "speedster-color-geometry-v2",
  policyProvenance: "OWNER_APPROVED_VISIBLE_OUTLINE_V2",
  sourceImageSha256: "a".repeat(64),
  proposal: baseQuad,
  confirmedQuad: correctedQuad,
  proposalChanged: true,
  createdAt: new Date("2026-08-20T12:00:00.000Z"),
  ...overrides,
});

const evaluate = (
  rows: readonly SpeedsterPhysicalGeometryLessonRow[],
  currentProposal: SpeedsterColorGeometryProposal = proposal(),
) => evaluateSpeedsterPhysicalGeometryLessons({
  targetSessionId: "target-session-1",
  createdByUserId: "admin-1",
  side: "BACK",
  mapId: "map-1",
  activeMapRevisionId: "revision-2",
  matColor: "BLACK",
  sourceImageSha256: "a".repeat(64),
  currentProposal,
  rows,
});

test("reuses only the newest exact approved physical correction", () => {
  const older = row();
  const newer = row({
    id: "evidence-2",
    sessionId: "source-session-2",
    confirmedQuad: correctedQuad.map((point) => ({ x: point.x + 0.01, y: point.y })),
    createdAt: new Date("2026-08-20T13:00:00.000Z"),
  });
  const result = evaluate([older, newer]);
  assert.equal(result.learning.usedLesson?.evidenceId, "evidence-2");
  assert.deepEqual(result.learning.usedLesson?.suggestedQuad, newer.confirmedQuad);
  assert.deepEqual(result.verdicts.map(({ evidenceId, status, reasonCode }) => ({ evidenceId, status, reasonCode })), [
    { evidenceId: "evidence-1", status: "SKIPPED", reasonCode: "SUPERSEDED_BY_NEWER_MATCH" },
    { evidenceId: "evidence-2", status: "USED", reasonCode: "EXACT_SOURCE_AND_BASE_PROPOSAL_MATCH" },
  ]);
});

test("records exact skip and rejection reasons without guessing", () => {
  const result = evaluate([
    row({ id: "old-revision", mapRevisionId: "revision-1" }),
    row({ id: "wrong-mat", matColor: "WHITE" }),
    row({ id: "other-photo", sourceImageSha256: "b".repeat(64) }),
    row({ id: "old-engine", engineVersion: "speedster-color-geometry-v1" }),
    row({ id: "bad-proposal", proposal: [{ x: 2, y: 2 }] }),
    row({ id: "bad-confirmed", confirmedQuad: [{ x: 2, y: 2 }] }),
    row({ id: "unchanged-correction", proposal: correctedQuad }),
    row({
      id: "changed-base",
      proposal: correctedQuad.map((point) => ({ x: point.x + 0.01, y: point.y })),
    }),
  ]);
  assert.equal(result.learning.usedLesson, null);
  assert.deepEqual(Object.fromEntries(result.verdicts.map(({ evidenceId, status, reasonCode }) => [evidenceId, [status, reasonCode]])), {
    "old-revision": ["SKIPPED", "ACTIVE_MAP_REVISION_MISMATCH"],
    "wrong-mat": ["SKIPPED", "MAT_COLOR_MISMATCH"],
    "other-photo": ["SKIPPED", "SOURCE_IMAGE_SHA256_MISMATCH"],
    "old-engine": ["REJECTED", "ENGINE_OR_POLICY_MISMATCH"],
    "bad-proposal": ["REJECTED", "MALFORMED_PROPOSAL"],
    "bad-confirmed": ["REJECTED", "MALFORMED_CONFIRMED_QUAD"],
    "unchanged-correction": ["REJECTED", "CORRECTION_NOT_CHANGED"],
    "changed-base": ["REJECTED", "BASE_PROPOSAL_MISMATCH"],
  });
});

test("an unavailable current engine outline rejects otherwise matching lessons", () => {
  const result = evaluate([row()], proposal(null));
  assert.equal(result.learning.usedLesson, null);
  assert.equal(result.verdicts[0]?.status, "REJECTED");
  assert.equal(result.verdicts[0]?.reasonCode, "CURRENT_ENGINE_PROPOSAL_UNAVAILABLE");
});

test("lesson and scan keys are deterministic and do not include timestamps or request IDs", () => {
  const first = evaluate([row()]);
  const second = evaluate([row()]);
  assert.equal(first.learning.scanEventKey, second.learning.scanEventKey);
  assert.equal(first.event.eventKey, second.event.eventKey);
  assert.equal(speedsterPhysicalGeometryLessonKey(row()), speedsterPhysicalGeometryLessonKey(row()));
  assert.equal(first.event.category, "GEOMETRY_LEARNING");
  assert.equal(first.event.eventType, "PHYSICAL_GEOMETRY_LESSON_SCAN_VERDICTS_RECORDED");
});

test("fails closed instead of silently truncating an oversized lesson roster", () => {
  const rows = Array.from({ length: SPEEDSTER_PHYSICAL_GEOMETRY_MAX_LESSONS + 1 }, (_, index) => row({ id: `evidence-${index}` }));
  assert.throws(() => evaluate(rows), /bounded size/);
});

test("returns a learned suggestion only after its append-only ledger insert succeeds", async () => {
  let insertSql = "";
  let duplicateReads = 0;
  const inserted = await recordSpeedsterPhysicalGeometryLessonScan({
    async $executeRaw(query) {
      insertSql = query.sql;
      return 1;
    },
    async $queryRaw<T>() {
      duplicateReads += 1;
      return [] as unknown as T;
    },
  }, {
    targetSessionId: "target-session-1",
    createdByUserId: "admin-1",
    side: "BACK",
    mapId: "map-1",
    activeMapRevisionId: "revision-2",
    matColor: "BLACK",
    sourceImageSha256: "a".repeat(64),
    currentProposal: proposal(),
    rows: [row()],
  });
  assert.equal(inserted.learning.usedLesson?.evidenceId, "evidence-1");
  assert.equal(duplicateReads, 0);
  assert.match(insertSql, /ON CONFLICT \("eventKey"\) DO NOTHING/);
  assert.doesNotMatch(insertSql, /\bDO UPDATE\b|\bUPDATE\b|\bDELETE\b/i);

  await assert.rejects(
    recordSpeedsterPhysicalGeometryLessonScan({
      async $executeRaw() { throw new Error("ledger unavailable"); },
      async $queryRaw<T>() { return [] as unknown as T; },
    }, {
      targetSessionId: "target-session-1",
      createdByUserId: "admin-1",
      side: "BACK",
      mapId: "map-1",
      activeMapRevisionId: "revision-2",
      matColor: "BLACK",
      sourceImageSha256: "a".repeat(64),
      currentProposal: proposal(),
      rows: [row()],
    }),
    /ledger unavailable/,
  );
});

test("final capture joins the exact used lesson, scan ledger, source evidence, and operator draft", async () => {
  const source = row();
  const evaluated = evaluate([source]);
  const verify = (learning: unknown = evaluated.learning, evidence = source) => (
    verifySpeedsterPhysicalGeometryLearningCapture({
      learning,
      targetSessionId: "target-session-1",
      createdByUserId: "admin-1",
      side: "BACK",
      finalMapRevisionId: "revision-2",
      sourceImageSha256: "a".repeat(64),
      currentProposal: proposal(),
      confirmedQuad: correctedQuad,
      async loadEvent() {
        return {
          eventKey: evaluated.event.eventKey,
          sessionId: evaluated.event.sessionId,
          createdByUserId: evaluated.event.createdByUserId,
          category: evaluated.event.category,
          eventType: evaluated.event.eventType,
          details: evaluated.event.details,
        };
      },
      async loadEvidence() {
        return { ...evidence, createdByUserId: "admin-1", workflowState: "COMPLETED" };
      },
    })
  );

  const diagnostics = await verify();
  assert.equal(diagnostics.scanEventKey, evaluated.event.eventKey);
  assert.equal(diagnostics.sourceEvidenceId, source.id);
  assert.equal(diagnostics.lessonDraftChangedByOperator, false);

  const forged = structuredClone(evaluated.learning);
  forged.usedLesson!.evidenceId = "different-evidence";
  await assert.rejects(verify(forged), /missing or inconsistent|invalid|does not match/);
  await assert.rejects(
    verify(evaluated.learning, { ...source, sourceImageSha256: "b".repeat(64) }),
    /missing or inconsistent/,
  );
});
