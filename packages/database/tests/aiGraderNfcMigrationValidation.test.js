const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const packageRoot = join(__dirname, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const scriptsRoot = join(packageRoot, "scripts");
const migration = [readFileSync(
  join(packageRoot, "prisma", "migrations", "20260712160000_ai_grader_nfc_static_url_v1", "migration.sql"),
  "utf8",
), readFileSync(
  join(packageRoot, "prisma", "migrations", "20260716225000_ai_grader_nfc_feiju_f8215_chip_type", "migration.sql"),
  "utf8",
), readFileSync(
  join(packageRoot, "prisma", "migrations", "20260716230000_ai_grader_nfc_feiju_f8215_gototags_two_click", "migration.sql"),
  "utf8",
)].join("\n");
const compose = readFileSync(
  join(repositoryRoot, "docker-compose.ai-grader-nfc-migration-validation.yml"),
  "utf8",
);
const harness = readFileSync(join(scriptsRoot, "runAiGraderNfcMigrationValidation.mjs"), "utf8");
const absentSql = readFileSync(join(scriptsRoot, "validateAiGraderNfcSchemaAbsent.sql"), "utf8");
const appliedSql = readFileSync(join(scriptsRoot, "validateAiGraderNfcMigration.sql"), "utf8");
const serviceValidation = readFileSync(
  join(scriptsRoot, "validateAiGraderNfcServiceAgainstPostgres.mjs"),
  "utf8",
);
const readinessValidation = readFileSync(
  join(scriptsRoot, "validateAiGraderNfcSchemaReadinessAgainstPostgres.mjs"),
  "utf8",
);

test("disposable NFC migration compose target is ephemeral and loopback-only", () => {
  assert.match(compose, /127\.0\.0\.1::5432/);
  assert.match(compose, /tmpfs:/);
  assert.match(compose, /\/var\/lib\/postgresql\/data:rw,noexec,nosuid/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{AI_GRADER_NFC_VALIDATION_DB_PASSWORD:\?/);
  assert.match(compose, /restart: "no"/);
  assert.doesNotMatch(compose, /container_name:/);
  assert.doesNotMatch(compose, /^volumes:/m);
});

test("orchestrator refuses implicit or remote execution and always tears down", () => {
  assert.match(harness, /--ack-disposable-local-postgres/);
  assert.match(harness, /Refusing to use a remote Docker context/);
  assert.match(harness, /context", "inspect"/);
  assert.match(harness, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(harness, /127\.0\.0\.1/);
  assert.match(harness, /createDisposableCleanupPlan\(composeArgs\)/);
  assert.match(harness, /finally \{/);
  assert.match(harness, /sanitizeAiGraderNfcValidationOutput\(value, \{ databasePassword: password \}\)/);
  assert.doesNotMatch(harness, /tenkings_nfc_validation:[^$\n]+@127\.0\.0\.1/);
});

test("orchestrator refusal executes before Docker without the explicit acknowledgement", async () => {
  const runnerUrl = pathToFileURL(join(scriptsRoot, "runAiGraderNfcMigrationValidation.mjs"));
  runnerUrl.searchParams.set("refusal-test", String(Date.now()));
  await assert.rejects(
    import(runnerUrl.href),
    (error) => /explicit acknowledgement/.test(error.message) && !/Docker engine/.test(error.message),
  );
});

test("orchestrator proves absent/ready runtime states, full deploy, and second-deploy no-op", () => {
  const absentPosition = harness.indexOf("--expect=absent");
  const deployPosition = harness.indexOf('"migrate", "deploy"');
  const readyPosition = harness.indexOf("--expect=ready");
  const secondDeployPosition = harness.indexOf(
    "deploying the full migration chain a second time to prove no-op behavior",
  );
  assert.ok(absentPosition > 0);
  assert.ok(deployPosition > absentPosition);
  assert.ok(readyPosition > deployPosition);
  assert.ok(secondDeployPosition > readyPosition);
  assert.match(harness, /No pending migrations to apply/);
  assert.match(harness, /migrationLedgerSnapshot/);
  assert.match(harness, /"applied_steps_count"::text/);
  assert.match(harness, /coalesce\("logs", ''\)/);
  assert.match(harness, /remain ready after the no-op deploy/);
  assert.match(harness, /Database schema is up to date/);
  assert.match(absentSql, /AI_GRADER_NFC_SCHEMA_ABSENT_VALIDATION_PASS/);
  assert.match(appliedSql, /AI_GRADER_NFC_MIGRATION_VALIDATION_PASS/);
  assert.match(harness, /20260716225000_ai_grader_nfc_feiju_f8215_chip_type/);
  assert.match(harness, /20260716230000_ai_grader_nfc_feiju_f8215_gototags_two_click/);
});

test("live SQL validator names every migrated constraint, index, trigger, enum, and table", () => {
  const quotedNames = (pattern) => Array.from(migration.matchAll(pattern), (match) => match[1]);
  const expectedNames = new Set([
    ...quotedNames(/CONSTRAINT "([^"]+)"/g),
    ...quotedNames(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g),
    ...quotedNames(/CREATE TRIGGER "([^"]+)"/g),
    ...quotedNames(/CREATE TYPE "([^"]+)"/g),
    ...quotedNames(/CREATE TABLE "([^"]+)"/g),
  ]);
  assert.ok(expectedNames.size > 50);
  for (const name of expectedNames) {
    assert.ok(appliedSql.includes(name), `Live migration validator omits ${name}`);
  }
});

test("live SQL validator requires exact ordinary and partial index catalog definitions", () => {
  assert.match(appliedSql, /CREATE TEMP VIEW _AiGraderNfcActualIndexes/);
  assert.match(appliedSql, /index_metadata\.indisunique AS is_unique/);
  assert.match(appliedSql, /index_metadata\.indisprimary AS is_primary/);
  assert.match(appliedSql, /index_metadata\.indpred IS NULL AS has_no_predicate/);
  assert.match(appliedSql, /index_metadata\.indexprs IS NULL AS has_no_expressions/);
  assert.match(appliedSql, /index_metadata\.indnatts = index_metadata\.indnkeyatts AS has_no_included_columns/);
  assert.match(appliedSql, /actual\.key_columns IS DISTINCT FROM expected\.key_columns/);
  assert.match(appliedSql, /actual\.normalized_predicate IS DISTINCT FROM expected\.normalized_predicate/);
  assert.match(appliedSql, /actual\.access_method <> 'btree'/);
  assert.match(appliedSql, /NFC ordinary indexes are not exact/);
  assert.match(appliedSql, /NFC partial unique indexes are not exact/);
});

test("live SQL validator canonicalizes every CHECK and exact immutable trigger/function catalog", () => {
  assert.match(appliedSql, /CREATE TEMP TABLE _AiGraderNfcExpectedTagChecks/);
  assert.match(appliedSql, /CREATE TEMP TABLE _AiGraderNfcExpectedAttemptChecks/);
  assert.match(appliedSql, /CREATE TEMP TABLE _AiGraderNfcExpectedAuditChecks/);
  assert.match(appliedSql, /pg_get_constraintdef\(constraint_object\.oid, true\)/);
  assert.match(appliedSql, /FULL JOIN actual USING \(table_name, constraint_name\)/);
  assert.match(appliedSql, /actual\.normalized_definition IS DISTINCT FROM expected\.normalized_definition/);
  assert.match(appliedSql, /NFC check constraints are not exact/);
  assert.match(appliedSql, /trigger_function\.prokind <> 'f'/);
  assert.match(appliedSql, /trigger_function\.prorettype <> 'pg_catalog\.trigger'::regtype/);
  assert.match(appliedSql, /trigger_function\.prosrc/);
  assert.match(appliedSql, /\('AiGraderNfcAuditEvent_immutable_update', 19::smallint\)/);
  assert.match(appliedSql, /\('AiGraderNfcAuditEvent_immutable_delete', 11::smallint\)/);
  assert.match(appliedSql, /FULL JOIN actual USING \(trigger_name\)/);
  assert.match(appliedSql, /NFC immutable audit triggers are not exact/);
});

test("live SQL validator exercises safety constraints and rolls fixture data back", () => {
  for (const required of [
    "duplicate open report",
    "duplicate open card",
    "duplicate open item",
    "second live attempt for one tag",
    "duplicate attempt idempotency key",
    "duplicate active UID fingerprint",
    "malformed readback evidence",
    "oversized NFC tag metadata",
    "oversized NFC audit details",
    "immutable NFC audit update",
    "immutable NFC audit delete",
    "revoke-before-replacement",
  ]) {
    assert.ok(appliedSql.includes(required), `Missing database behavior assertion: ${required}`);
  }
  assert.match(appliedSql, /BEGIN;/);
  assert.match(appliedSql, /ROLLBACK;/);
});

test("real PostgreSQL phase uses compiled service and ephemeral signed attestation", () => {
  for (const required of [
    "buildAiGraderPublishAuthorityRecord",
    "generateKeyPairSync",
    "buildAiGraderNfcOperationalAttestationStatement",
    "Promise.all",
    "initAiGraderNfcProgramming",
    "completeAiGraderNfcProgramming",
    "revokeAiGraderNfcTag",
    "replaceAiGraderNfcTag",
    "AI_GRADER_NFC_ATTEMPT_EXPIRED",
    "AI_GRADER_NFC_REAL_SERVICE_VALIDATION_PASS",
  ]) {
    assert.ok(serviceValidation.includes(required), `Missing real service proof: ${required}`);
  }
  assert.match(serviceValidation, /!Object\.hasOwn\(status, "uidFingerprintSha256"\)/);
  assert.doesNotMatch(serviceValidation, /console\.log\([^)]*(attemptToken|keyId|uidFingerprint)/);
  assert.doesNotMatch(serviceValidation, /assert\.(?:equal|notEqual|deepEqual|match)\([^\n]*(?:attemptToken|attestationChallenge|signature|uidFingerprint)/);
  assert.match(serviceValidation, /sha256\(concurrentRetry\.attemptToken\) === sha256\(first\.attemptToken\)/);
  assert.match(serviceValidation, /REPORT_ADVISORY_LOCK_NOT_ENFORCED/);
  assert.match(serviceValidation, /SELECT 1 AS "lockAcquired"[\s\S]*FROM pg_advisory_xact_lock/);
  assert.match(readFileSync(join(packageRoot, "src", "aiGraderNfcService.ts"), "utf8"), /readbackEvidence: Prisma\.DbNull/);
  assert.match(serviceValidation, /const \[active, activeRetry\] = await Promise\.all/);
  assert.match(serviceValidation, /const \[replacement, replacementRetry\] = await Promise\.all/);
  assert.match(serviceValidation, /ATOMIC_ACTIVE_REVOKE_BEFORE_REPLACEMENT/);
  assert.match(serviceValidation, /const \[revoked, revokedRetry\] = await Promise\.all/);
  assert.match(readinessValidation, /readAiGraderNfcSchemaReadiness/);
  assert.match(readinessValidation, /--expect=/);
});

test("validation safety helpers reject remote targets and scope destructive cleanup exactly", async () => {
  const safety = await import(pathToFileURL(join(scriptsRoot, "aiGraderNfcValidationSafety.mjs")).href);
  const secretHost = "remote-secret-host.example";
  assert.throws(
    () => safety.assertDisposableDatabaseTarget({
      acknowledgement: "1",
      databaseUrl: `postgresql://wrong-user:secret@${secretHost}/wrong-db`,
      expectedUser: "tenkings_nfc_validation",
      expectedDatabase: "tenkings_ai_grader_nfc_validation",
    }),
    (error) => error.message === "AI_GRADER_NFC_VALIDATION_DATABASE_HOST_REFUSED" && !error.message.includes(secretHost),
  );
  assert.equal(safety.isLocalDockerEndpoint("tcp://192.0.2.50:2375"), false);
  assert.equal(safety.isLocalDockerEndpoint("tcp://127.0.0.1:2375"), true);
  const composeArgs = ["compose", "-p", "fixed-test-project", "-f", "fixed-compose.yml"];
  assert.deepEqual(
    safety.buildDisposableCleanupArgs(composeArgs),
    [...composeArgs, "down", "--volumes", "--remove-orphans"],
  );
  assert.deepEqual(composeArgs, ["compose", "-p", "fixed-test-project", "-f", "fixed-compose.yml"]);
  const cleanupPlan = safety.createDisposableCleanupPlan(composeArgs);
  assert.deepEqual(cleanupPlan.claim(), [...composeArgs, "down", "--volumes", "--remove-orphans"]);
  assert.equal(cleanupPlan.claim(), null);
});

test("validation failure redaction removes database and NFC secret-shaped values", async () => {
  const redaction = await import(pathToFileURL(join(scriptsRoot, "aiGraderNfcValidationRedaction.mjs")).href);
  const password = "database-password-sentinel";
  const sentinels = [
    password,
    "T".repeat(43),
    "C".repeat(43),
    "S".repeat(86),
    "a".repeat(64),
    "K".repeat(64),
    "P".repeat(120),
  ];
  const failure = [
    `DATABASE_URL=postgresql://tenkings_nfc_validation:${password}@127.0.0.1:5432/tenkings_ai_grader_nfc_validation`,
    `attemptToken: '${sentinels[1]}'`,
    `attestationChallenge=${sentinels[2]}`,
    `signature: ${sentinels[3]}`,
    `uidFingerprintSha256: ${sentinels[4]}`,
    `workstationKeyId: ${sentinels[5]}`,
    `publicSpkiDerBase64: ${sentinels[6]}`,
  ].join("\n");
  const sanitized = redaction.sanitizeAiGraderNfcValidationOutput(failure, { databasePassword: password });
  for (const sentinel of sentinels) assert.equal(sanitized.includes(sentinel), false);
  assert.match(sanitized, /<redacted-database-url>|DATABASE_URL=<redacted>/);
  assert.match(sanitized, /<redacted-sensitive-value>/);
});

test("migration validation JavaScript parses without executing Docker", () => {
  for (const file of [
    "runAiGraderNfcMigrationValidation.mjs",
    "validateAiGraderNfcServiceAgainstPostgres.mjs",
    "validateAiGraderNfcSchemaReadinessAgainstPostgres.mjs",
    "aiGraderNfcValidationRedaction.mjs",
    "aiGraderNfcValidationSafety.mjs",
  ]) {
    const result = spawnSync(process.execPath, ["--check", join(scriptsRoot, file)], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
