const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const packageRoot = join(__dirname, "..");
const validator = readFileSync(join(packageRoot, "scripts/validateSpeedsterLayoutKeyV2.sql"), "utf8");
const runner = readFileSync(join(packageRoot, "scripts/runAiGraderNfcMigrationValidation.mjs"), "utf8");

test("layout-key V2 migration is additive, transactional, and makes legacy authority append-only", () => {
  const sql = readFileSync(join(
    __dirname,
    "../prisma/migrations/20260813200000_speedster_pokemon_layout_key_v2/migration.sql",
  ), "utf8");
  assert.equal(sql.trimStart().startsWith("-- Additive compatibility guard only."), true);
  assert.equal(sql.includes("BEGIN;"), true);
  assert.equal(sql.trimEnd().endsWith("COMMIT;"), true);
  for (const required of [
    'CREATE TYPE "AiGraderV2PokemonLayoutType"',
    'CREATE TABLE "AiGraderV2LegacyMapLayoutAuthority"',
    'UNIQUE INDEX "AiGraderV2LegacyMapLayoutAuthority_sourceSessionId_key"',
    'BEFORE UPDATE ON "AiGraderV2LegacyMapLayoutAuthority"',
    'BEFORE DELETE ON "AiGraderV2LegacyMapLayoutAuthority"',
    "AiGraderV2LegacyMapLayoutAuthority is append-only",
    'BEFORE UPDATE ON "AiGraderV2CardTypeMapRevision"',
    'BEFORE DELETE ON "AiGraderV2CardTypeMapRevision"',
    "AiGraderV2CardTypeMapRevision is append-only",
    'NOT ("identity" ? \'layoutType\')',
    "IN ('POKEMON', 'TRAINER', 'ENERGY')",
  ]) assert.equal(sql.includes(required), true, `missing migration contract: ${required}`);
  for (const forbidden of [
    'UPDATE "AiGraderV2Session"',
    'DELETE FROM "AiGraderV2Session"',
    'ALTER COLUMN "identity"',
  ]) assert.equal(sql.includes(forbidden), false, `history-mutating migration statement: ${forbidden}`);
});

test("disposable Layout V2 fixture proves catalog, identities, immutable rows, rollback, and stable second deploy", () => {
  for (const required of [
    "20260813200000_speedster_pokemon_layout_key_v2",
    "Expected SPORTS layoutType identity rejection",
    "Expected unknown Pokémon layoutType rejection",
    "Expected one-time legacy source authority rejection",
    "Expected legacy authority UPDATE rejection",
    "Expected legacy authority DELETE rejection",
    "Expected Card Map revision UPDATE rejection",
    "Expected Card Map revision DELETE rejection",
    "ctid = authority_ctid AND xmin = authority_xmin",
    "ctid = revision_ctid AND xmin = revision_xmin",
    "Layout V2 fixture rows survived rollback",
    "SPEEDSTER_LAYOUT_KEY_V2_VALIDATION_PASS",
  ]) assert.ok(validator.includes(required), `Disposable Layout V2 fixture omits: ${required}`);
  assert.match(validator, /BEGIN;[\s\S]*ROLLBACK;/);
  assert.doesNotMatch(validator, /TRUNCATE|DROP DATABASE|DROP SCHEMA/i);

  const fixturePosition = runner.indexOf("verifying Layout Key V2 catalog");
  const secondDeployPosition = runner.indexOf("deploying the full migration chain a second time to prove no-op behavior");
  assert.ok(fixturePosition > 0);
  assert.ok(secondDeployPosition > fixturePosition);
  assert.match(runner, /validateSpeedsterLayoutKeyV2\.sql/);
  assert.match(runner, /20260813200000_speedster_pokemon_layout_key_v2/);
  assert.match(runner, /deploying the isolated pre-Layout-V2 migration chain/);
  assert.match(runner, /preLayoutV2Snapshot/);
  assert.match(runner, /postLayoutV2Snapshot/);
  assert.match(runner, /identity byte representation, ctid, or xmin/);
  assert.match(runner, /copiedPreLayoutMigrationCount !== migrationCount - 1/);
  assert.match(runner, /preLayoutLedgerCount !== String\(migrationCount - 1\)/);
  assert.match(runner, /postLayoutLedgerCount !== String\(migrationCount\)/);
  assert.match(runner, /cleanLayoutMigrationCount !== "1"/);
  assert.match(runner, /remainingUpgradeFixtureCount !== "0"/);
  assert.match(runner, /reconciling the fully migrated database with the repository migration tree/);
  assert.match(runner, /\["--filter", "@tenkings\/shared", "build"\]/,
    "the disposable lifecycle rehearsal must build its runtime dependency itself");
  assert.match(runner, /Repository migration-tree reconciliation was not an explicit no-op/);
  assert.match(runner, /function cleanupUpgradeSchema\(\)/);
  assert.match(runner, /cleanupUpgradeSchema\(\);[\s\S]*cleanup\(\);/);
  assert.match(runner, /Temporary schema cleanup also failed/);
  assert.match(runner, /speedster-layout-v2-upgrade-fixture-layoutless/);
  assert.match(runner, /speedster-layout-v2-upgrade-fixture-explicit/);
  assert.match(runner, /if \(secondLedger !== firstLedger\)/);
});
