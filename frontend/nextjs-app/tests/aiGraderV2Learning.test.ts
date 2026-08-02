import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  SPEEDSTER_FINGERPRINT_SIZE,
  updateSpeedsterLearningBank,
} from "../lib/ai-grader-v2/learning";

const fingerprint = [1, ...Array.from({ length: SPEEDSTER_FINGERPRINT_SIZE - 1 }, () => 0)];
const finding = {
  id: "finding-1",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "VISIBLE_WHITENING",
  detectedDefectType: "VISIBLE_WHITENING",
  origin: "DETECTOR",
  confidence: 0.8,
  featureFingerprint: fingerprint,
  canonicalContour: [],
  sourceViewId: "ORIGINAL",
  supportingViewIds: [],
  reviewResult: "ACCEPTED",
  measurement: {
    widthMm: 1,
    heightMm: 1,
    areaMm2: 1,
    zonePercent: 1,
    multiplier: 1,
    weightedAreaMm2: 1,
    subgradeEffect: 0,
  },
} as const;

test("accepted and removed detector findings update opposite prototypes", () => {
  const bank = updateSpeedsterLearningBank(undefined, [
    finding,
    { ...finding, id: "finding-2", reviewResult: "REMOVED" },
  ]);
  const type = bank.types.VISIBLE_WHITENING;

  assert.equal(type?.positive?.count, 1);
  assert.equal(type?.negative?.count, 1);
  assert.deepEqual(type?.positive?.sum, fingerprint);
  assert.deepEqual(type?.negative?.sum, fingerprint);
});

test("one relabel teaches away from the detected type and toward the reviewed type", () => {
  const bank = updateSpeedsterLearningBank(undefined, [{
    ...finding,
    defectType: "LIGHT_SCRATCH_SCUFF",
    reviewResult: "TYPE_CORRECTED",
  }]);

  assert.equal(bank.types.VISIBLE_WHITENING?.negative?.count, 1);
  assert.equal(bank.types.LIGHT_SCRATCH_SCUFF?.positive?.count, 1);
});

test("Smart-Mark provenance persists without fabricating a SAM fingerprint", () => {
  const bank = updateSpeedsterLearningBank(undefined, [{
    ...finding,
    origin: "SMART_MARK",
    reviewResult: "SMART_MARKED",
    featureFingerprint: undefined,
  }]);

  assert.deepEqual(bank, { version: 1, types: {} });
});

test("one global bank is injected into every detect request and updated in completion", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const schema = readFileSync(`${root}/../../packages/database/prisma/schema.prisma`, "utf8");
  const migration = readFileSync(
    `${root}/../../packages/database/prisma/migrations/20260801190000_ai_grader_v2_learning_bank/migration.sql`,
    "utf8",
  );
  const proxy = readFileSync(`${root}/pages/api/admin/ai-grader-v2/image/[action].ts`, "utf8");
  const completion = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/complete-label.ts`,
    "utf8",
  );

  assert.match(schema, /model AiGraderV2LearningBank/);
  assert.match(migration, /CREATE TABLE "AiGraderV2LearningBank"/);
  assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\b/i);
  assert.match(proxy, /action !== "detect"/);
  assert.match(proxy, /learningBank: cleanSpeedsterLearningBank/);
  assert.match(completion, /updateSpeedsterLearningBank\(currentLearningBank, input\.reviewedDefects\)/);
});
