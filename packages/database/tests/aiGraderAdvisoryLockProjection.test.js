const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const repositoryRoot = join(__dirname, "..", "..", "..");
const productionFiles = [
  ["frontend/nextjs-app/lib/server/aiGraderProductionApi.ts", 5],
  ["frontend/nextjs-app/lib/server/aiGraderLabelSheetRuntime.ts", 2],
  ["packages/database/src/aiGraderProductionService.ts", 2],
  ["packages/database/src/aiGraderNfcService.ts", 1],
];

test("every production AI Grader advisory lock returns a Prisma-supported scalar", () => {
  let observed = 0;
  for (const [relativePath, expectedCount] of productionFiles) {
    const source = readFileSync(join(repositoryRoot, relativePath), "utf8");
    const lockCalls = source.match(/pg_advisory_xact_lock\s*\(/g) ?? [];
    const scalarCalls = source.match(
      /SELECT\s+1\s+AS\s+"lockAcquired"\s+FROM\s+pg_advisory_xact_lock\s*\(/g,
    ) ?? [];
    assert.equal(lockCalls.length, expectedCount, `${relativePath} advisory-lock inventory changed`);
    assert.equal(scalarCalls.length, expectedCount, `${relativePath} contains a non-scalar advisory-lock projection`);
    assert.doesNotMatch(source, /SELECT\s+pg_advisory_xact_lock\s*\(/);
    observed += lockCalls.length;
  }
  assert.equal(observed, 10);
});

test("disposable PostgreSQL validation covers all production lock surfaces and late rollback", () => {
  const validation = readFileSync(
    join(repositoryRoot, "frontend/nextjs-app/scripts/validate-ai-grader-advisory-locks-postgres.ts"),
    "utf8",
  );
  const runner = readFileSync(
    join(repositoryRoot, "packages/database/scripts/runAiGraderNfcMigrationValidation.mjs"),
    "utf8",
  );
  for (const required of [
    "createAiGraderCardFromReportRuntime",
    "persistProductionReleaseRuntime",
    "persistAiGraderProductionRelease",
    "persistAiGraderCompsRuntime",
    "persistAiGraderSelectedCompsRuntime",
    "prepareAiGraderLabelSheetPrintRuntime",
    "markAiGraderLabelSheetPrintedRuntime",
    "addAiGraderCardToInventoryRuntime",
    "INJECTED_FAILURE_NOT_REACHED",
    "ROLLBACK_PARTIAL_ROWS",
    "INVENTORY_REPORT_LOCK",
    "INVENTORY_LABEL_LOCK",
    "VOID_PROJECTION_OBSERVED",
    "AI_GRADER_ADVISORY_LOCK_REAL_POSTGRES_VALIDATION_PASS",
  ]) {
    assert.ok(validation.includes(required), `real PostgreSQL validation omits ${required}`);
  }
  assert.match(validation, /SELECT 1 AS "lockAcquired"[\s\S]*FROM pg_advisory_xact_lock/);
  assert.match(runner, /validate-ai-grader-advisory-locks-postgres\.ts/);
  assert.match(runner, /AI_GRADER_ADVISORY_LOCK_REAL_POSTGRES_VALIDATION_PASS/);
});
