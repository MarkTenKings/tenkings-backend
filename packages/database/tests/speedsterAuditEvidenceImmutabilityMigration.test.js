import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  `${root}/prisma/migrations/20260818153000_speedster_audit_evidence_append_only/migration.sql`,
  "utf8",
);
const validator = readFileSync(
  `${root}/scripts/validateSpeedsterAuditEvidenceImmutability.sql`,
  "utf8",
);
const harness = readFileSync(`${root}/scripts/runAiGraderNfcMigrationValidation.mjs`, "utf8");
const iphoneIntegrityMigration = readFileSync(
  `${root}/prisma/migrations/20260818191500_speedster_iphone_capture_integrity_manifest/migration.sql`,
  "utf8",
);

test("iPhone capture persists planned and ready byte-integrity manifests", () => {
  assert.match(iphoneIntegrityMigration, /ALTER TABLE "AiGraderV2CaptureDevice"/);
  assert.match(iphoneIntegrityMigration, /ADD COLUMN "uploadManifest" JSONB/);
  assert.match(iphoneIntegrityMigration, /ADD COLUMN "readyManifest" JSONB/);
  assert.doesNotMatch(iphoneIntegrityMigration, /^\s*(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP)\b/im);
});

test("Speedster audit evidence migration rejects UPDATE, DELETE, and TRUNCATE on all three ledgers", () => {
  assert.match(migration, /^--[\s\S]*BEGIN;/);
  assert.match(migration, /CREATE FUNCTION "reject_ai_grader_v2_audit_evidence_mutation"/);
  for (const table of [
    "AiGraderV2InstrumentationEvent",
    "AiGraderV2MapFilterDecision",
    "AiGraderV2MapFilterRestoreEvent",
  ]) {
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER "${table}_append_only"[\\s\\S]*BEFORE UPDATE OR DELETE ON "${table}"`),
    );
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER "${table}_no_truncate"[\\s\\S]*BEFORE TRUNCATE ON "${table}"[\\s\\S]*FOR EACH STATEMENT`),
    );
    assert.match(validator, new RegExp(table));
  }
  assert.match(migration, /FOR EACH ROW[\s\S]*COMMIT;\s*$/);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE|DELETE\s+FROM|DROP)\b/im);
});

test("disposable PostgreSQL validator proves catalog, inserts, idempotency, mutation rejection, rollback, and ledger state", () => {
  assert.match(validator, /tgtype = 27::smallint/);
  assert.match(validator, /tgtype = 34::smallint/);
  assert.match(validator, /ON CONFLICT \("eventKey"\) DO NOTHING/);
  assert.match(validator, /ON CONFLICT \("sessionId", "findingId"\) DO NOTHING/);
  assert.match(validator, /UPDATE %I SET "id" = "id"/);
  assert.match(validator, /DELETE FROM %I/);
  assert.match(validator, /TRUNCATE TABLE %I CASCADE/);
  assert.match(validator, /ROLLBACK;/);
  assert.match(validator, /SPEEDSTER_AUDIT_EVIDENCE_IMMUTABILITY_VALIDATION_PASS/);
  assert.match(harness, /validateSpeedsterAuditEvidenceImmutability\.sql/);
  assert.match(harness, /SPEEDSTER_AUDIT_EVIDENCE_IMMUTABILITY_VALIDATION_PASS/);
});
