#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sanitizeAiGraderNfcValidationOutput } from "./aiGraderNfcValidationRedaction.mjs";
import { createDisposableCleanupPlan, isLocalDockerEndpoint } from "./aiGraderNfcValidationSafety.mjs";

const ACK = "--ack-disposable-local-postgres";
const SERVICE = "ai-grader-nfc-validation-postgres";
const DB_USER = "tenkings_nfc_validation";
const DB_NAME = "tenkings_ai_grader_nfc_validation";
const TARGET_MIGRATIONS = [
  "20260712160000_ai_grader_nfc_static_url_v1",
  "20260716225000_ai_grader_nfc_feiju_f8215_chip_type",
  "20260716230000_ai_grader_nfc_feiju_f8215_gototags_two_click",
];
const SENTINEL = "AI_GRADER_NFC_DISPOSABLE_VALIDATION";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../..");
const composeFile = resolve(repositoryRoot, "docker-compose.ai-grader-nfc-migration-validation.yml");
const migrationsDir = resolve(repositoryRoot, "packages/database/prisma/migrations");
const absentSql = resolve(scriptDir, "validateAiGraderNfcSchemaAbsent.sql");
const appliedSql = resolve(scriptDir, "validateAiGraderNfcMigration.sql");
const serviceValidationScript = resolve(scriptDir, "validateAiGraderNfcServiceAgainstPostgres.mjs");
const readinessValidationScript = resolve(scriptDir, "validateAiGraderNfcSchemaReadinessAgainstPostgres.mjs");
const advisoryLockValidationScript = resolve(
  repositoryRoot,
  "frontend/nextjs-app/scripts/validate-ai-grader-advisory-locks-postgres.ts",
);
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
  serviceValidationScript,
  readinessValidationScript,
  advisoryLockValidationScript,
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

const migrationCount = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(migrationsDir, entry.name, "migration.sql")))
  .length;
if (migrationCount < 1) fail("No Prisma migrations were found.");

let cleanupRequired = false;
const cleanupPlan = createDisposableCleanupPlan(composeArgs);
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
    try {
      cleanup();
    } finally {
      process.exit(exitCode);
    }
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
  };

  run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "validate", "--schema", "prisma/schema.prisma"], {
    env: databaseEnv,
    label: "validating the Prisma schema against disposable configuration",
  });
  run(pnpm, ["--filter", "@tenkings/database", "generate"], {
    env: databaseEnv,
    label: "generating the disposable Prisma client",
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
  run(pnpm, ["--filter", "@tenkings/database", "exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    env: databaseEnv,
    label: "deploying the full Prisma migration chain to the empty database",
  });

  const firstLedger = migrationLedgerSnapshot(migrationCount);
  const appliedResult = runSqlFile(appliedSql, "verifying NFC catalog objects, constraints, and database lifecycle behavior");
  if (!appliedResult.includes("AI_GRADER_NFC_MIGRATION_VALIDATION_PASS")) {
    fail("The NFC migration SQL validation did not reach its PASS marker.");
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
    `[nfc-migration-validation] PASS: ${migrationCount} migrations, NFC catalog/constraint/lifecycle checks, and second-deploy no-op verified; disposable storage destroyed.`,
  );
}
