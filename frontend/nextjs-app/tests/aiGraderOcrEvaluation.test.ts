import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  evaluateAiGraderOcrCases,
  parseAiGraderOcrEvaluationCase,
} from "../lib/server/aiGraderOcrEvaluation";

test("offline evaluator reports per-field metrics and aggregate latency without corpus values", async () => {
  const root = path.join(process.cwd(), "tests", "fixtures", "ai-grader-ocr-evaluator");
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const cases = [];
  for (const entry of manifest.cases) {
    cases.push(parseAiGraderOcrEvaluationCase({
      groundTruth: JSON.parse(await readFile(path.join(root, entry.groundTruthFile), "utf8")),
      result: JSON.parse(await readFile(path.join(root, entry.resultFile), "utf8")),
    }));
  }
  const summary = evaluateAiGraderOcrCases(cases);
  assert.equal(summary.caseCount, 2);
  assert.equal(summary.fields.category.precision, 1);
  assert.equal(summary.fields.productSet.precision, 1);
  assert.equal(summary.fields.productSet.recall, 0.5);
  assert.equal(summary.fields.productSet.supportedCoverage, 0.5);
  assert.equal(summary.fields.productSet.disagreementRate, 0.5);
  assert.equal(summary.fields.cardName.unknownRate, 0.5);
  assert.deepEqual(summary.latency, { sampleCount: 2, meanMs: 1500, p95Ms: 1800 });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("Synthetic Player"), false);
  assert.match(summary.note, /do not establish production accuracy/);
});

test("offline evaluator rejects malformed state/value contracts and empty corpora", () => {
  assert.throws(() => evaluateAiGraderOcrCases([]), /At least one/);
  assert.throws(() => parseAiGraderOcrEvaluationCase({
    groundTruth: { fields: {} },
    result: { latencyMs: 10, fields: {} },
  }), /aggregate evaluator contract/);
});
