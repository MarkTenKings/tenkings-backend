#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sanitizeAiGraderNfcValidationOutput } from "./aiGraderNfcValidationRedaction.mjs";
import { createDisposableCleanupPlan, isLocalDockerEndpoint } from "./aiGraderNfcValidationSafety.mjs";

const ACK = "--ack-disposable-local-postgres";
const SERVICE = "ai-grader-nfc-validation-postgres";
const DB_USER = "tenkings_nfc_validation";
const DB_NAME = "tenkings_ai_grader_nfc_validation";
const SPEEDSTER_LAYOUT_V2_MIGRATION = "20260813200000_speedster_pokemon_layout_key_v2";
const SPEEDSTER_COLOR_GEOMETRY_MIGRATION = "20260816100000_speedster_color_geometry_evidence";
const SPEEDSTER_COLOR_GEOMETRY_V2_CONSTRAINT_MIGRATION = "20260819220000_speedster_color_geometry_v2_constraints";
const SPEEDSTER_AUDIT_IMMUTABILITY_MIGRATION = "20260818153000_speedster_audit_evidence_append_only";
const TARGET_MIGRATIONS = [
  "20260712160000_ai_grader_nfc_static_url_v1",
  "20260716225000_ai_grader_nfc_feiju_f8215_chip_type",
  "20260716230000_ai_grader_nfc_feiju_f8215_gototags_two_click",
  "20260718150000_ai_grader_design_reference_v1",
  "20260721183000_ai_grader_calibration_activation_registry",
  "20260813120000_speedster_map_registration_lessons",
  SPEEDSTER_LAYOUT_V2_MIGRATION,
  SPEEDSTER_COLOR_GEOMETRY_MIGRATION,
  SPEEDSTER_COLOR_GEOMETRY_V2_CONSTRAINT_MIGRATION,
  SPEEDSTER_AUDIT_IMMUTABILITY_MIGRATION,
];
const SENTINEL = "AI_GRADER_NFC_DISPOSABLE_VALIDATION";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../..");
const composeFile = resolve(repositoryRoot, "docker-compose.ai-grader-nfc-migration-validation.yml");
const migrationsDir = resolve(repositoryRoot, "packages/database/prisma/migrations");
const prismaSchema = resolve(repositoryRoot, "packages/database/prisma/schema.prisma");
const absentSql = resolve(scriptDir, "validateAiGraderNfcSchemaAbsent.sql");
const appliedSql = resolve(scriptDir, "validateAiGraderNfcMigration.sql");
const mathematicalCalibrationSnapshotSql = resolve(
  scriptDir,
  "validateAiGraderMathematicalCalibrationSnapshot.sql",
);
const calibrationActivationRegistrySql = resolve(
  scriptDir,
  "validateAiGraderCalibrationActivationRegistry.sql",
);
const speedsterMapRegistrationLessonSql = resolve(
  scriptDir,
  "validateSpeedsterMapRegistrationLesson.sql",
);
const speedsterLayoutKeyV2Sql = resolve(scriptDir, "validateSpeedsterLayoutKeyV2.sql");
const speedsterColorGeometryEvidenceSql = resolve(scriptDir, "validateSpeedsterColorGeometryEvidence.sql");
const speedsterAuditEvidenceImmutabilitySql = resolve(
  scriptDir,
  "validateSpeedsterAuditEvidenceImmutability.sql",
);
const serviceValidationScript = resolve(scriptDir, "validateAiGraderNfcServiceAgainstPostgres.mjs");
const readinessValidationScript = resolve(scriptDir, "validateAiGraderNfcSchemaReadinessAgainstPostgres.mjs");
const advisoryLockValidationScript = resolve(
  repositoryRoot,
  "frontend/nextjs-app/scripts/validate-ai-grader-advisory-locks-postgres.ts",
);
const cardPlatformV2ValidationScript = resolve(scriptDir, "validateCardPlatformV2AgainstPostgres.mjs");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function fail(message) {
  throw new Error(message);
}

if (!process.argv.includes(ACK)) {
  fail(
    `Refusing to start a database without explicit acknowledgement. Re-run with ${ACK}; only a disposable, loopback-published local PostgreSQL container is permitted.`,
  );
}

for (const requiredPath of [
  composeFile,
  migrationsDir,
  absentSql,
  appliedSql,
  mathematicalCalibrationSnapshotSql,
  calibrationActivationRegistrySql,
  speedsterMapRegistrationLessonSql,
  speedsterLayoutKeyV2Sql,
  speedsterColorGeometryEvidenceSql,
  speedsterAuditEvidenceImmutabilitySql,
  serviceValidationScript,
  readinessValidationScript,
  advisoryLockValidationScript,
  cardPlatformV2ValidationScript,
]) {
  if (!existsSync(requiredPath)) fail("NFC migration validation support is incomplete.");
}

const password = randomBytes(32).toString("base64url");
const project = `tenkings-nfc-validation-${process.pid}-${randomBytes(4).toString("hex")}`;
const composeArgs = ["compose", "-p", project, "-f", composeFile];
const composeEnv = {
  ...process.env,
  AI_GRADER_NFC_VALIDATION_DB_USER: DB_USER,
  AI_GRADER_NFC_VALIDATION_DB_PASSWORD: password,
  AI_GRADER_NFC_VALIDATION_DB_NAME: DB_NAME,
};

function sanitize(value) {
  return sanitizeAiGraderNfcValidationOutput(value, { databasePassword: password });
}

function run(command, args, options = {}) {
  if (options.announce !== false) {
    console.log(`[nfc-migration-validation] ${options.label ?? "running required command"}`);
  }
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: options.env ?? composeEnv,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error || result.status !== 0) {
    const detail = sanitize(result.error?.message ?? output).trim().slice(-4000);
    fail(`${options.label ?? "Required command"} failed.${detail ? `\n${detail}` : ""}`);
  }
  return output.trim();
}

function assertLocalDockerEngine() {
  const endpoint = run(
    docker,
    ["context", "inspect", "--format", "{{ (index .Endpoints \"docker\").Host }}"],
    { label: "verifying that the Docker engine is local" },
  ).trim();
  if (isLocalDockerEndpoint(endpoint)) return;
  fail("Refusing to use a remote Docker context for disposable NFC migration validation.");
}

function psqlArgs(...tail) {
  return [
    ...composeArgs,
    "exec",
    "-T",
    SERVICE,
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    DB_USER,
    "--dbname",
    DB_NAME,
    ...tail,
  ];
}

function runSqlFile(path, label) {
  return run(docker, psqlArgs(), {
    label,
    input: readFileSync(path, "utf8"),
  });
}

function queryScalar(sql, label) {
  return run(docker, psqlArgs("--tuples-only", "--no-align", "--command", sql), {
    label,
    announce: false,
  }).trim();
}

function migrationLedgerSnapshot(expectedMigrationCount) {
  const snapshot = queryScalar(
    `SELECT count(*)::text || ':' ||
       coalesce(md5(string_agg(
         concat_ws(E'\\x1f',
           "id",
           "checksum",
           coalesce(to_char("finished_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
           "migration_name",
           coalesce("logs", ''),
           coalesce(to_char("rolled_back_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
           to_char("started_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
           "applied_steps_count"::text
         ),
         E'\\x1e' ORDER BY "migration_name", "id"
       )), md5(''))
       FROM "_prisma_migrations"`,
    "reading the disposable migration ledger",
  );
  const match = /^(\d+):([a-f0-9]{32})$/.exec(snapshot);
  if (!match) fail("The disposable Prisma migration ledger returned an invalid summary.");
  const appliedCount = Number.parseInt(match[1], 10);
  if (appliedCount !== expectedMigrationCount) {
    fail(`Expected ${expectedMigrationCount} applied migrations in the disposable database; found ${appliedCount}.`);
  }
  const unfinished = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
       WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`,
    "checking for unfinished disposable migrations",
  );
  if (unfinished !== "0") fail("The disposable database contains an unfinished migration.");
  for (const targetMigration of TARGET_MIGRATIONS) {
    const targetCount = queryScalar(
      `SELECT count(*) FROM "_prisma_migrations"
         WHERE "migration_name" = '${targetMigration}'
           AND "finished_at" IS NOT NULL
           AND "rolled_back_at" IS NULL`,
      "checking each NFC migration ledger entry",
    );
    if (targetCount !== "1") fail("Each NFC migration must have exactly one successful ledger entry.");
  }
  return snapshot;
}

function localPublishedPort() {
  const output = run(
    docker,
    [...composeArgs, "port", SERVICE, "5432"],
    { label: "resolving the disposable loopback PostgreSQL port", announce: false },
  );
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/.exec(lines.at(-1) ?? "");
  if (!match || !isLocalDockerEndpoint(`tcp://${match[1]}:${match[2]}`)) {
    fail("The disposable PostgreSQL port is not published on loopback only.");
  }
  const port = Number.parseInt(match[2], 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("The disposable PostgreSQL port is invalid.");
  }
  return port;
}

function legacySessionSnapshot() {
  return queryScalar(
    `SELECT count(*)::text || ':' || md5(string_agg(
       concat_ws(E'\\x1f', "id", ctid::text, xmin::text,
         encode(convert_to("identity"::text, 'UTF8'), 'hex'), row_to_json(session_row)::text),
       E'\\x1e' ORDER BY "id"))
       FROM "AiGraderV2Session" session_row
      WHERE "id" LIKE 'speedster-layout-v2-upgrade-fixture-%'`,
    "snapshotting pre-existing Speedster identity rows",
  );
}

const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(migrationsDir, entry.name, "migration.sql")))
  .map((entry) => entry.name)
  .sort();
const migrationCount = migrationNames.length;
if (migrationCount < 1) fail("No Prisma migrations were found.");
const preLayoutMigrationNames = migrationNames.filter((name) => name < SPEEDSTER_LAYOUT_V2_MIGRATION);
const postLayoutMigrationNames = migrationNames.filter((name) => name > SPEEDSTER_LAYOUT_V2_MIGRATION);
if (!migrationNames.includes(SPEEDSTER_LAYOUT_V2_MIGRATION)) {
  fail("The Layout Key V2 migration is missing from the repository tree.");
}
if (!postLayoutMigrationNames.includes(SPEEDSTER_COLOR_GEOMETRY_MIGRATION)) {
  fail("The Color Geometry migration must remain ordered after Layout Key V2.");
}
if (!postLayoutMigrationNames.includes(SPEEDSTER_COLOR_GEOMETRY_V2_CONSTRAINT_MIGRATION)) {
  fail("The Color Geometry v2 constraint migration must remain ordered after Layout Key V2.");
}
if (!postLayoutMigrationNames.includes(SPEEDSTER_AUDIT_IMMUTABILITY_MIGRATION)) {
  fail("The Speedster audit immutability migration must remain ordered after Layout Key V2.");
}

let cleanupRequired = false;
let upgradeSchemaRoot;
const cleanupPlan = createDisposableCleanupPlan(composeArgs);
function cleanupUpgradeSchema() {
  if (!upgradeSchemaRoot) return;
  const exactUpgradeSchemaRoot = upgradeSchemaRoot;
  upgradeSchemaRoot = undefined;
  rmSync(exactUpgradeSchemaRoot, { recursive: true, force: true });
}
function cleanup() {
  if (!cleanupRequired) return;
  const cleanupArgs = cleanupPlan.claim();
  if (!cleanupArgs) return;
  run(docker, cleanupArgs, {
    label: "destroying the disposable PostgreSQL container and storage",
  });
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    let cleanupFailure = false;
    try {
      cleanupUpgradeSchema();
    } catch {
      cleanupFailure = true;
    }
    try {
      cleanup();
    } catch {
      cleanupFailure = true;
    }
    if (cleanupFailure) console.error("[nfc-migration-validation] Signal cleanup was incomplete.");
    process.exit(exitCode);
  });
}

let primaryError;
try {
  assertLocalDockerEngine();
  cleanupRequired = true;
  run(docker, [...composeArgs, "up", "-d", "--wait", "--wait-timeout", "90"], {
    label: "starting isolated tmpfs-backed PostgreSQL",
  });

  const port = localPublishedPort();
  const databaseUrl =
    `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(password)}` +
    `@127.0.0.1:${port}/${encodeURIComponent(DB_NAME)}?schema=public`;
  const databaseEnv = {
    ...composeEnv,
    DATABASE_URL: databaseUrl,
    [SENTINEL]: "1",
    TEN_KINGS_V2_DISPOSABLE_VALIDATION: "1",
  };

  upgradeSchemaRoot = mkdtempSync(resolve(tmpdir(), "tenkings-layout-v2-upgrade-"));
  const upgradePrismaDir = resolve(upgradeSchemaRoot, "prisma");
  const upgradeMigrationsDir = resolve(upgradePrismaDir, "migrations");
  const upgradeSchema = resolve(upgradePrismaDir, "schema.prisma");
  mkdirSync(upgradeMigrationsDir, { recursive: true });
  copyFileSync(prismaSchema, upgradeSchema);
  copyFileSync(resolve(migrationsDir, "migration_lock.toml"), resolve(upgradeMigrationsDir, "migration_lock.toml"));
  for (const migrationName of preLayoutMigrationNames) {
    cpSync(resolve(migrationsDir, migrationName), resolve(upgradeMigrationsDir, migrationName), { recursive: true });
  }

  run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "validate", "--schema", "prisma/schema.prisma"], {
    env: databaseEnv,
    label: "validating the Prisma schema against disposable configuration",
  });
  run(pnpm, ["--filter", "@tenkings/database", "generate"], {
    env: databaseEnv,
    label: "generating the disposable Prisma client",
  });
  run(pnpm, ["--filter", "@tenkings/shared", "build"], {
    env: databaseEnv,
    label: "building the shared package required by database lifecycle validation",
  });
  run(pnpm, ["--filter", "@tenkings/database", "build"], {
    env: databaseEnv,
    label: "building the database package for live readiness and lifecycle validation",
  });

  const absentResult = runSqlFile(absentSql, "verifying the NFC schema is absent before migration deploy");
  if (!absentResult.includes("AI_GRADER_NFC_SCHEMA_ABSENT_VALIDATION_PASS")) {
    fail("The NFC schema-absence validation did not reach its PASS marker.");
  }
  const absentRuntimeResult = run(
    process.execPath,
    [readinessValidationScript, "--expect=absent"],
    {
      env: databaseEnv,
      label: "requiring the real NFC schema readiness probe to report not ready before deploy",
    },
  );
  if (!absentRuntimeResult.includes("AI_GRADER_NFC_SCHEMA_ABSENT_RUNTIME_VALIDATION_PASS")) {
    fail("The pre-deploy NFC schema readiness probe did not reach its PASS marker.");
  }
  run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "deploy", "--schema", upgradeSchema], {
    env: databaseEnv,
    label: "deploying the isolated pre-Layout-V2 migration chain",
  });
  const preLayoutLedgerCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    "proving the pre-Layout-V2 migration ledger count",
  );
  if (preLayoutLedgerCount !== String(preLayoutMigrationNames.length)) {
    fail(`Expected ${preLayoutMigrationNames.length} clean pre-Layout-V2 migration rows; found ${preLayoutLedgerCount}.`);
  }
  const prematureLayoutMigrationCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "migration_name" = '20260813200000_speedster_pokemon_layout_key_v2'`,
    "proving Layout Key V2 is absent before the staged upgrade",
  );
  if (prematureLayoutMigrationCount !== "0") fail("Layout Key V2 was present before the staged upgrade.");
  run(docker, psqlArgs("--command", `
    INSERT INTO "AiGraderV2Session" (
      "id", "createdByUserId", "cardProfile", "workflowState", "ruleVersion",
      "identity", "capture", "reviewedDefects", "gradeReport", "updatedAt"
    ) VALUES
      ('speedster-layout-v2-upgrade-fixture-layoutless', 'layout-v2-upgrade-admin', 'POKEMON', 'CAPTURED', 'speedster-v2',
       '{"category":"POKEMON","year":"2023","productSet":"MEW EN","parallel":"REVERSE HOLO","cardName":"LEGACY","cardNumber":"001/165"}'::jsonb,
       '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '2026-08-13T20:00:00.000Z'::timestamptz),
      ('speedster-layout-v2-upgrade-fixture-explicit', 'layout-v2-upgrade-admin', 'POKEMON', 'CAPTURED', 'speedster-v2',
       '{"category":"POKEMON","layoutType":"TRAINER","year":"2023","productSet":"MEW EN","parallel":"REVERSE HOLO","cardName":"TRAINER","cardNumber":"100/165"}'::jsonb,
       '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '2026-08-13T20:00:00.000Z'::timestamptz)
  `), { label: "inserting pre-Layout-V2 historical identity fixtures" });
  const preLayoutV2Snapshot = legacySessionSnapshot();
  cpSync(
    resolve(migrationsDir, SPEEDSTER_LAYOUT_V2_MIGRATION),
    resolve(upgradeMigrationsDir, SPEEDSTER_LAYOUT_V2_MIGRATION),
    { recursive: true },
  );
  run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "deploy", "--schema", upgradeSchema], {
    env: databaseEnv,
    label: "deploying Layout Key V2 over pre-existing historical identity rows",
  });
  const postLayoutLedgerCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    "proving the post-Layout-V2 migration ledger count",
  );
  if (postLayoutLedgerCount !== String(preLayoutMigrationNames.length + 1)) {
    fail(`Expected ${preLayoutMigrationNames.length + 1} clean rows immediately after Layout Key V2; found ${postLayoutLedgerCount}.`);
  }
  const cleanLayoutMigrationCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "migration_name" = '20260813200000_speedster_pokemon_layout_key_v2'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL`,
    "proving exactly one clean Layout Key V2 ledger row",
  );
  if (cleanLayoutMigrationCount !== "1") fail("Layout Key V2 must have exactly one clean ledger row.");
  const postLayoutV2Snapshot = legacySessionSnapshot();
  if (postLayoutV2Snapshot !== preLayoutV2Snapshot) {
    fail("Layout Key V2 changed a pre-existing Speedster session row, identity byte representation, ctid, or xmin.");
  }
  run(docker, psqlArgs("--command", `
    DELETE FROM "AiGraderV2Session"
     WHERE "id" LIKE 'speedster-layout-v2-upgrade-fixture-%'
  `), { label: "removing isolated Layout V2 upgrade fixtures" });
  const remainingUpgradeFixtureCount = queryScalar(
    `SELECT count(*) FROM "AiGraderV2Session"
      WHERE "id" LIKE 'speedster-layout-v2-upgrade-fixture-%'`,
    "proving isolated Layout V2 upgrade fixtures were removed",
  );
  if (remainingUpgradeFixtureCount !== "0") fail("Layout V2 upgrade fixtures were not fully removed.");
  for (const migrationName of postLayoutMigrationNames) {
    cpSync(resolve(migrationsDir, migrationName), resolve(upgradeMigrationsDir, migrationName), { recursive: true });
  }
  run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "deploy", "--schema", upgradeSchema], {
    env: databaseEnv,
    label: "deploying all ordered post-Layout-V2 migrations",
  });
  const finalStagedLedgerCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    "proving the complete staged migration ledger count",
  );
  if (finalStagedLedgerCount !== String(migrationCount)) {
    fail(`Expected ${migrationCount} clean rows after all post-Layout-V2 migrations; found ${finalStagedLedgerCount}.`);
  }
  const cleanColorGeometryMigrationCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "migration_name" = '${SPEEDSTER_COLOR_GEOMETRY_MIGRATION}'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL`,
    "proving exactly one clean Color Geometry ledger row after Layout Key V2",
  );
  if (cleanColorGeometryMigrationCount !== "1") {
    fail("Color Geometry must have exactly one clean ledger row after Layout Key V2.");
  }
  const cleanColorGeometryV2ConstraintMigrationCount = queryScalar(
    `SELECT count(*) FROM "_prisma_migrations"
      WHERE "migration_name" = '${SPEEDSTER_COLOR_GEOMETRY_V2_CONSTRAINT_MIGRATION}'
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL`,
    "proving exactly one clean Color Geometry v2 constraint ledger row after Layout Key V2",
  );
  if (cleanColorGeometryV2ConstraintMigrationCount !== "1") {
    fail("Color Geometry v2 constraints must have exactly one clean ledger row after Layout Key V2.");
  }
  const repositoryTreeReconciliation = run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    env: databaseEnv,
    label: "reconciling the fully migrated database with the repository migration tree",
  });
  if (!/No pending migrations to apply/i.test(repositoryTreeReconciliation)) {
    fail("Repository migration-tree reconciliation was not an explicit no-op.");
  }

  const firstLedger = migrationLedgerSnapshot(migrationCount);
  const appliedResult = runSqlFile(appliedSql, "verifying NFC catalog objects, constraints, and database lifecycle behavior");
  if (!appliedResult.includes("AI_GRADER_NFC_MIGRATION_VALIDATION_PASS")) {
    fail("The NFC migration SQL validation did not reach its PASS marker.");
  }
  const mathematicalCalibrationResult = runSqlFile(
    mathematicalCalibrationSnapshotSql,
    "verifying the Mathematical V1 CalibrationSnapshot catalog, exact identity, trust, validity, and immutability",
  );
  if (!mathematicalCalibrationResult.includes("AI_GRADER_MATHEMATICAL_CALIBRATION_SNAPSHOT_VALIDATION_PASS")) {
    fail("The Mathematical V1 CalibrationSnapshot SQL validation did not reach its PASS marker.");
  }
  const calibrationActivationResult = runSqlFile(
    calibrationActivationRegistrySql,
    "verifying append-only Mathematical Calibration activation, mutual exclusion, reactivation, and historical bindings",
  );
  if (!calibrationActivationResult.includes("AI_GRADER_CALIBRATION_ACTIVATION_REGISTRY_VALIDATION_PASS")) {
    fail("The Mathematical Calibration activation registry SQL validation did not reach its PASS marker.");
  }
  const speedsterMapRegistrationLessonResult = runSqlFile(
    speedsterMapRegistrationLessonSql,
    "verifying Speedster registration-lesson constraints, append-only behavior, and fixture rollback",
  );
  if (!speedsterMapRegistrationLessonResult.includes("SPEEDSTER_MAP_REGISTRATION_LESSON_VALIDATION_PASS")) {
    fail("The Speedster registration-lesson SQL validation did not reach its PASS marker.");
  }
  const speedsterLayoutKeyV2Result = runSqlFile(
    speedsterLayoutKeyV2Sql,
    "verifying Layout Key V2 catalog, identities, one-time authority, revision immutability, and rollback",
  );
  if (!speedsterLayoutKeyV2Result.includes("SPEEDSTER_LAYOUT_KEY_V2_VALIDATION_PASS")) {
    fail("The Layout Key V2 SQL validation did not reach its PASS marker.");
  }
  const speedsterColorGeometryResult = runSqlFile(
    speedsterColorGeometryEvidenceSql,
    "verifying Speedster Color Geometry constraints, outcomes, append-only behavior, and fixture rollback",
  );
  if (!speedsterColorGeometryResult.includes("SPEEDSTER_COLOR_GEOMETRY_EVIDENCE_VALIDATION_PASS")) {
    fail("The Speedster Color Geometry SQL validation did not reach its PASS marker.");
  }
  const speedsterAuditImmutabilityResult = runSqlFile(
    speedsterAuditEvidenceImmutabilitySql,
    "verifying Speedster instrumentation, Map Filter decision, and restore evidence immutability",
  );
  if (!speedsterAuditImmutabilityResult.includes("SPEEDSTER_AUDIT_EVIDENCE_IMMUTABILITY_VALIDATION_PASS")) {
    fail("The Speedster audit evidence immutability SQL validation did not reach its PASS marker.");
  }
  const readyRuntimeResult = run(
    process.execPath,
    [readinessValidationScript, "--expect=ready"],
    {
      env: databaseEnv,
      label: "requiring the real NFC schema readiness probe to report ready after deploy",
    },
  );
  if (!readyRuntimeResult.includes("AI_GRADER_NFC_SCHEMA_READY_RUNTIME_VALIDATION_PASS")) {
    fail("The post-deploy NFC schema readiness probe did not reach its PASS marker.");
  }
  const serviceResult = run(process.execPath, [serviceValidationScript], {
    env: databaseEnv,
    label: "running reserve, completion, revoke, replace, and expiry through the real NFC service",
  });
  if (!serviceResult.includes("AI_GRADER_NFC_REAL_SERVICE_VALIDATION_PASS")) {
    fail("The real NFC service validation did not reach its PASS marker.");
  }
  const advisoryLockResult = run(
    pnpm,
    ["--filter", "@tenkings/nextjs-app", "exec", "tsx", advisoryLockValidationScript],
    {
      env: databaseEnv,
      label: "running publication, Label V1, comps, inventory, rollback, and advisory locking through real Prisma/PostgreSQL",
    },
  );
  if (!advisoryLockResult.includes("AI_GRADER_ADVISORY_LOCK_REAL_POSTGRES_VALIDATION_PASS")) {
    fail("The real AI Grader advisory-lock validation did not reach its PASS marker.");
  }
  const cardPlatformV2Result = run(process.execPath, [cardPlatformV2ValidationScript], {
    env: databaseEnv,
    label: "running card creation rollback, concurrency, identity, and append-only checks through real Prisma/PostgreSQL",
  });
  if (!cardPlatformV2Result.includes("TEN_KINGS_V2_CARD_PLATFORM_REAL_POSTGRES_VALIDATION_PASS")) {
    fail("The real Card Platform V2 validation did not reach its PASS marker.");
  }

  const secondDeploy = run(
    pnpm,
    ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      env: databaseEnv,
      label: "deploying the full migration chain a second time to prove no-op behavior",
    },
  );
  if (!/No pending migrations to apply/i.test(secondDeploy)) {
    fail("The second Prisma migration deploy did not report a no-op.");
  }
  const secondLedger = migrationLedgerSnapshot(migrationCount);
  if (secondLedger !== firstLedger) fail("The migration ledger changed during the second deploy.");

  const statusOutput = run(
    pnpm,
    ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "status", "--schema", "prisma/schema.prisma"],
    {
      env: databaseEnv,
      label: "checking final disposable migration status",
    },
  );
  if (!/Database schema is up to date/i.test(statusOutput)) {
    fail("Prisma did not report the disposable schema as up to date.");
  }
  const finalReadyRuntimeResult = run(
    process.execPath,
    [readinessValidationScript, "--expect=ready"],
    {
      env: databaseEnv,
      label: "requiring the NFC schema readiness probe to remain ready after the no-op deploy",
    },
  );
  if (!finalReadyRuntimeResult.includes("AI_GRADER_NFC_SCHEMA_READY_RUNTIME_VALIDATION_PASS")) {
    fail("The final NFC schema readiness probe did not reach its PASS marker.");
  }
} catch (error) {
  primaryError = error;
} finally {
  try {
    cleanupUpgradeSchema();
  } catch (upgradeSchemaCleanupError) {
    if (!primaryError) primaryError = upgradeSchemaCleanupError;
    else console.error("[nfc-migration-validation] Temporary schema cleanup also failed.");
  }
  try {
    cleanup();
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else console.error("[nfc-migration-validation] Cleanup also failed; inspect local Docker state.");
  }
}

if (primaryError) {
  console.error(`[nfc-migration-validation] FAILED: ${sanitize(primaryError.message)}`);
  process.exitCode = 1;
} else {
  console.log(
    `[nfc-migration-validation] PASS: ${migrationCount} migrations, NFC plus Mathematical V1, Speedster registration lessons, Layout Key V2, Speedster Color Geometry v2 evidence constraints, Speedster audit evidence immutability, and Card Platform V2 catalog, constraint, lifecycle, immutability, rollback, concurrency, reactivation, and second-deploy no-op checks verified; disposable storage destroyed.`,
  );
}
