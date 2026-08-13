const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const packageRoot = join(__dirname, "..");
const migration = readFileSync(join(
  packageRoot,
  "prisma",
  "migrations",
  "20260813120000_speedster_map_registration_lessons",
  "migration.sql",
), "utf8");
const validator = readFileSync(join(
  packageRoot,
  "scripts",
  "validateSpeedsterMapRegistrationLesson.sql",
), "utf8");
const runner = readFileSync(join(
  packageRoot,
  "scripts",
  "runAiGraderNfcMigrationValidation.mjs",
), "utf8");

test("registration-lesson migration is one explicit PostgreSQL transaction", () => {
  assert.match(migration, /BEGIN;[\s\S]*CREATE TABLE "AiGraderV2MapRegistrationLesson"/);
  assert.match(migration, /CREATE TRIGGER "AiGraderV2MapRegistrationLesson_append_only"[\s\S]*COMMIT;\s*$/);
  assert.equal((migration.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((migration.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.ok(migration.indexOf("BEGIN;") < migration.indexOf("CREATE TABLE"));
  assert.ok(migration.indexOf("COMMIT;") > migration.indexOf("CREATE TRIGGER"));
});

test("disposable SQL fixture proves insert, constraints, immutability, and rollback cleanup", () => {
  for (const required of [
    "20260813120000_speedster_map_registration_lessons",
    "Valid registration lesson insert did not persist",
    "Expected registration lesson foreign-key rejection",
    "Expected registration lesson CHECK rejection",
    "Expected registration lesson UPDATE rejection",
    "Expected registration lesson DELETE rejection",
    "Registration lesson fixture rows survived rollback",
    "SPEEDSTER_MAP_REGISTRATION_LESSON_VALIDATION_PASS",
  ]) assert.ok(validator.includes(required), `Disposable fixture omits: ${required}`);
  assert.match(validator, /EXCEPTION WHEN foreign_key_violation/);
  assert.match(validator, /EXCEPTION WHEN check_violation/);
  assert.match(validator, /UPDATE "AiGraderV2MapRegistrationLesson"/);
  assert.match(validator, /DELETE FROM "AiGraderV2MapRegistrationLesson"/);
  assert.match(validator, /BEGIN;/);
  assert.match(validator, /ROLLBACK;/);
  assert.ok(validator.indexOf("ROLLBACK;") < validator.indexOf("fixture rows survived rollback"));
  assert.doesNotMatch(validator, /TRUNCATE|DROP DATABASE|DROP SCHEMA/i);
});

test("contained migration runner executes the fixture before ledger-stable second deploy", () => {
  const fixturePosition = runner.indexOf("verifying Speedster registration-lesson constraints");
  const secondDeployPosition = runner.indexOf("deploying the full migration chain a second time to prove no-op behavior");
  assert.ok(fixturePosition > 0);
  assert.ok(secondDeployPosition > fixturePosition);
  assert.match(runner, /validateSpeedsterMapRegistrationLesson\.sql/);
  assert.match(runner, /20260813120000_speedster_map_registration_lessons/);
  assert.match(runner, /migrationLedgerSnapshot/);
  assert.match(runner, /if \(secondLedger !== firstLedger\)/);
  assert.match(runner, /destroying the disposable PostgreSQL container and storage/);
});
