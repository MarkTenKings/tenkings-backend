import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAiGraderReportEditorialRevisionV1,
  parseAiGraderReportEditorialRevisionV1,
} from "../lib/aiGraderReportRevision";

const baseInput = {
  reportId: "report-operator-review-1",
  sourceReportSchemaVersion: "ai-grader-report-bundle-v0.3",
  sourceBundleSha256: "a".repeat(64),
  revision: 1,
  editedAt: "2026-07-21T18:00:00.000Z",
};

test("operator review requires all four sub-grades and calculates the overall server policy", () => {
  const revision = buildAiGraderReportEditorialRevisionV1({
    ...baseInput,
    scores: { centering: 10, corners: 8.5, edges: 10, surface: 10 },
    content: { cornersExplanation: "Operator confirmed corner wear." },
  });

  assert.equal(revision.calculation.weightedGrade, 9.63);
  assert.equal(revision.calculation.weakestElementCap, 9);
  assert.equal(revision.calculation.overall, 9);
  assert.equal(revision.calculation.labelGrade, 9);
  assert.equal(revision.machineGradePreserved, true);
  assert.equal(
    revision.calculation.severeDefectCapProvenance,
    "none_source_report_has_no_v1_cap",
  );

  assert.throws(
    () => buildAiGraderReportEditorialRevisionV1({
      ...baseInput,
      scores: { centering: 10, corners: 8.5, edges: 10 },
    }),
    /required|number/i,
  );
});

test("operator review preserves an immutable Mathematical V1 severe-defect cap", () => {
  const revision = buildAiGraderReportEditorialRevisionV1({
    ...baseInput,
    scores: { centering: 10, corners: 10, edges: 10, surface: 10 },
    applicableSevereDefectCap: 6,
  });

  assert.equal(revision.calculation.overall, 6);
  assert.equal(revision.calculation.applicableSevereDefectCap, 6);
  assert.equal(
    revision.calculation.severeDefectCapProvenance,
    "immutable_mathematical_v1_finding_ledger",
  );
});

test("operator review parsing rejects calculation tampering and source-hash substitution", () => {
  const revision = buildAiGraderReportEditorialRevisionV1({
    ...baseInput,
    scores: { centering: 9, corners: 9, edges: 9, surface: 9 },
  });
  assert.deepEqual(
    parseAiGraderReportEditorialRevisionV1(revision, baseInput.reportId),
    revision,
  );

  assert.equal(parseAiGraderReportEditorialRevisionV1({
    ...revision,
    calculation: { ...revision.calculation, overall: 10 },
  }), null);
  assert.equal(parseAiGraderReportEditorialRevisionV1({
    ...revision,
    sourceBundleSha256: "not-a-digest",
  }), null);
});
