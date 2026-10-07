#!/usr/bin/env node
// Creates its own loopback-only cluster. It accepts no database URL or existing data directory.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baseline = "db899e953226563bafc156da6bec3710fe5e65b8";
const target = "20260908010000_speedster_prepared_evidence_authority";
const audit = "20260818153000_speedster_audit_evidence_append_only";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (["--postgres-bin", "--pg-module"].includes(args[index])) { assert(args[++index] && !args[index].startsWith("--"), "Argument value is missing"); continue; }
  assert(["--ack-disposable-local-postgres", "--repository-chain"].includes(args[index]), `Unknown fixture argument: ${args[index]}`);
}
const repositoryChain = args.includes("--repository-chain");
assert(args.includes("--ack-disposable-local-postgres"), "Explicit disposable fixture acknowledgement is required");
assert(!process.env.DATABASE_URL && !process.env.DIRECT_URL && !process.env.PGHOST && !process.env.PGDATA,
  "Refusing inherited database configuration; invoke this harness with a scrubbed environment");
const binArgument = args.indexOf("--postgres-bin");
assert(binArgument >= 0 && args[binArgument + 1], "--postgres-bin must identify local PostgreSQL binaries");
const bin = realpathSync(args[binArgument + 1]);
const pgArgument = args.indexOf("--pg-module");
assert(pgArgument >= 0 && args[pgArgument + 1], "--pg-module must identify a local installed pg client");
const pgModule = realpathSync(args[pgArgument + 1]);
const fixture = realpathSync(mkdtempSync(join(tmpdir(), "atlas-preparation-db-")));
const data = join(fixture, "data");
const nonce = randomBytes(10).toString("hex");
const user = "preparation_fixture";
const database = `preparation_fixture_${nonce}`;
const password = randomBytes(24).toString("hex");
const passwordFile = join(fixture, "fixture-password");
writeFileSync(passwordFile, password, { mode: 0o600 });
const sentinel = { version: 1, nonce, data, database, ownerPid: process.pid, uid: process.getuid?.(), createdByHarness: true };
writeFileSync(join(fixture, "ownership.json"), JSON.stringify(sentinel, null, 2), { mode: 0o600 });
const pristineEnv = { HOME: process.env.HOME ?? tmpdir(), PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", PRISMA_HIDE_UPDATE_MESSAGE: "1" };
const logFile = join(fixture, "validation.log");
let log = "";
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", env: pristineEnv, ...options });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[fixture-password]");
  log += output;
  writeFileSync(logFile, log, { mode: 0o600 });
  if (result.error || result.status !== 0) throw new Error(`Fixture command failed: ${command}\n${output}`, { cause: result.error });
  return String(result.stdout ?? "");
}

const port = await new Promise((done, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const assigned = server.address().port;
    server.close((error) => error ? reject(error) : done(assigned));
  });
});
const databaseEnv = { ...pristineEnv, PGPASSWORD: password, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: user, PGDATABASE: database,
  DATABASE_URL: `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?connection_limit=8`,
  SPEEDSTER_PREPARATION_FIXTURE_NONCE: nonce, SPEEDSTER_PREPARATION_FIXTURE_DATA: data, SPEEDSTER_PREPARATION_PG_MODULE: pgModule };
const sqlClient = `
  const {Client} = require(process.env.SPEEDSTER_PREPARATION_PG_MODULE);
  const fs = require('node:fs');
  const client = new Client();
  (async () => {
    await client.connect();
    try {
      const results = await client.query(fs.readFileSync(0, 'utf8'));
      for (const result of Array.isArray(results) ? results : [results]) {
        for (const row of result.rows) console.log(Object.values(row).join('\\t'));
      }
    } finally { await client.end(); }
  })().catch(error => { console.error(error.message); process.exitCode=1; });
`;
const sql = (query, db = database) => run(process.execPath, ["-e", sqlClient], { env: { ...databaseEnv, PGDATABASE: db }, input: query }).trim();
const prismaCli = resolve(root, "packages/database/node_modules/prisma/build/index.js");
const repositoryMigrations = join(root, "packages/database/prisma/migrations");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (path) => sha256(readFileSync(path));
const migrationInventory = (directory) => readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, "migration.sql")))
  .map(({ name }) => ({ name, sha256: fileHash(join(directory, name, "migration.sql")), byteCount: statSync(join(directory, name, "migration.sql")).size }))
  .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const ledgerSnapshot = () => sql('SELECT coalesce(json_agg(m ORDER BY migration_name, id)::text, \'[]\') FROM "_prisma_migrations" m');
function assertMigrationLedger(snapshot, inventory) {
  const rows = JSON.parse(snapshot);
  assert.equal(rows.length, inventory.length, "Migration ledger must contain exactly the declared chain");
  for (const entry of inventory) {
    const matches = rows.filter((row) => row.migration_name === entry.name);
    assert.equal(matches.length, 1, `Exactly one migration row is required for ${entry.name}`);
    const row = matches[0];
    assert(row.finished_at && row.rolled_back_at === null && row.applied_steps_count > 0, `Migration did not finish cleanly: ${entry.name}`);
    assert.equal(row.checksum, entry.sha256, `Migration checksum changed: ${entry.name}`);
  }
}

function validateLocationForeignKeys() {
  const parent = JSON.parse(sql(`SELECT json_build_object('type', format_type(a.atttypid, a.atttypmod), 'primaryKey', EXISTS (
    SELECT 1 FROM pg_constraint p WHERE p.conrelid = a.attrelid AND p.contype = 'p' AND p.conkey = ARRAY[a.attnum]
  ))::text FROM pg_attribute a WHERE a.attrelid = 'public."Location"'::regclass AND a.attname = 'id' AND NOT a.attisdropped`));
  assert.deepEqual(parent, { type: "uuid", primaryKey: true });
  const observed = JSON.parse(sql(`SELECT coalesce(json_agg(row_to_json(f) ORDER BY f.name)::text, '[]') FROM (
    SELECT c.conname AS name, t.relname AS "table", n.nspname AS "schema",
      ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.ord) AS columns,
      ARRAY(SELECT format_type(a.atttypid, a.atttypmod) FROM unnest(c.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.ord) AS types,
      ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY k.ord) AS "referencedColumns",
      c.confupdtype::text AS "onUpdate", c.confdeltype::text AS "onDelete", c.confmatchtype::text AS "match",
      c.convalidated AS validated, c.condeferrable AS deferrable, c.condeferred AS deferred
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f' AND c.confrelid = 'public."Location"'::regclass
  ) f`));
  // Independent expected catalog from the unchanged historical SQL. PostgreSQL
  // action codes: c=CASCADE, n=SET NULL, r=RESTRICT; s=SIMPLE match.
  const expected = [
    ["AutoFillSession", "locationId", "c"], ["CollectibleCardV2", "locationId", "r"],
    ["Conversation", "locationId", "n"], ["GoldenTicket", "sourceLocationId", "n"],
    ["InventoryBatch", "locationId", "c"], ["Item", "locationId", "n"],
    ["KioskSession", "locationId", "n"], ["LiveRip", "locationId", "n"],
    ["LocationRestock", "locationId", "c"], ["LocationVisit", "locationId", "c"],
    ["NavigationSession", "locationId", "c"], ["PackInstance", "locationId", "n"],
    ["PackLabel", "locationId", "n"], ["PackRecipe", "locationId", "c"],
    ["QrCode", "locationId", "n"], ["stocker_stops", "locationId", "r"],
  ].map(([table, column, onDelete]) => ({ name: `${table}_${column}_fkey`, table, schema: "public", columns: [column], types: ["uuid"],
    referencedColumns: ["id"], onUpdate: "c", onDelete, match: "s", validated: true, deferrable: false, deferred: false }));
  writeFileSync(join(fixture, "location-foreign-keys.json"), JSON.stringify({ parent, expected, observed }, null, 2));
  assert.deepEqual(observed, expected, "All 16 historical Location UUID foreign keys and original actions must remain intact");
  log += "PREPARATION_REPOSITORY_LOCATION_UUID_FOREIGN_KEYS_PASS 16 constraints\n";
  writeFileSync(logFile, log, { mode: 0o600 });
  return { count: observed.length, types: "uuid", validated: true, originalActions: true };
}

let started = false;
let declaredChain;
let outcome = { ok: false, evidenceDirectory: fixture };
let failure;
try {
  const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
  const sourceTreeSha = run("git", ["rev-parse", "HEAD^{tree}"]).trim();
  const sourceStatus = run("git", ["status", "--porcelain"]).trim();
  if (repositoryChain) assert.equal(sourceStatus, "", "Repository-chain proof requires a clean committed source tree");
  const sourceFiles = ["packages/database/prisma/schema.prisma", "packages/database/prisma/migrations/migration_lock.toml", "pnpm-lock.yaml",
    "packages/database/scripts/runSpeedsterPreparationValidation.mjs", "frontend/nextjs-app/scripts/validate-speedster-preparation-postgres.ts"]
    .map((path) => ({ path, sha256: fileHash(join(root, path)) }));
  const sourceMigrations = migrationInventory(repositoryMigrations);
  assert(sourceMigrations.some(({ name }) => name === target), "The preparation migration is missing");
  declaredChain = { mode: repositoryChain ? "REPOSITORY_CHAIN" : "SYNTHETIC_BASELINE", sourceCommit, sourceTreeSha, sourceStatus,
    sourceFiles, sourceMigrations, sourceMigrationSha256: sha256(JSON.stringify(sourceMigrations)),
    postgresVersion: run(join(bin, "postgres"), ["--version"]).trim(), nodeVersion: process.version };
  writeFileSync(join(fixture, "declared-chain.json"), JSON.stringify(declaredChain, null, 2));
  run(join(bin, "initdb"), ["-D", data, "--username", user, "--pwfile", passwordFile, "--auth-host=scram-sha-256", "--auth-local=reject", "--encoding=UTF8", "--locale=C"]);
  started = true; // Cleanup also checks status if pg_ctl start itself fails.
  run(join(bin, "pg_ctl"), ["-D", data, "-l", join(fixture, "postgresql.log"), "-o", `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, "-w", "start"]);
  assert.equal(sql("SELECT current_setting('data_directory')", "postgres"), data);
  assert.equal(sql("SELECT current_setting('listen_addresses')", "postgres"), "127.0.0.1");
  sql(`CREATE DATABASE "${database}"`, "postgres");
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");

  const schemaDirectory = join(fixture, "schema");
  const migrations = join(schemaDirectory, "migrations");
  mkdirSync(migrations, { recursive: true });
  if (repositoryChain) {
    // Copy every actual source migration byte-for-byte in lexical order. Never
    // generate a baseline, omit constraints, resolve migrations or push a schema.
    for (const { name } of sourceMigrations) cpSync(join(repositoryMigrations, name), join(migrations, name), { recursive: true });
    assert.deepEqual(migrationInventory(migrations), sourceMigrations);
    declaredChain.fixtureOnlyExcludedForeignKeys = [];
  } else {
    // Retained only for reproducing the earlier, explicitly limited fixture proof.
    const baselineSchema = join(fixture, "baseline.prisma");
    writeFileSync(baselineSchema, run("git", ["show", `${baseline}:packages/database/prisma/schema.prisma`]));
    const generatedBaselineSql = run(process.execPath, [prismaCli, "migrate", "diff", "--from-empty", "--to-schema-datamodel", baselineSchema, "--script"], { env: databaseEnv });
    // The exact mainline baseline has unrelated UUID/TEXT foreign-key mismatches
    // (first observed for stocker_stops and Item). Enumerate those from generated
    // SQL and retain every omitted statement as evidence. Grading/session/audit
    // foreign keys and every other type mismatch remain fail-closed and unmodified.
    const columnTypes = new Map();
    for (const table of generatedBaselineSql.matchAll(/CREATE TABLE "([^"]+)" \(\n([\s\S]*?)\n\);/g)) {
      columnTypes.set(table[1], new Map([...table[2].matchAll(/^\s+"([^"]+)" (\w+)/gm)].map((column) => [column[1], column[2]])));
    }
    const columns = (value) => [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const excludedBaselineForeignKeys = [];
    for (const fk of generatedBaselineSql.matchAll(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "([^"]+)"\(([^)]+)\).*;$/gm)) {
      const from = columns(fk[3]).map((column) => columnTypes.get(fk[1])?.get(column));
      const to = columns(fk[5]).map((column) => columnTypes.get(fk[4])?.get(column));
      if (from.every((type, index) => type === to[index])) continue;
      assert(!/^AiGrader/.test(fk[1]) && !/^AiGrader/.test(fk[4]), "Grading prerequisite foreign keys cannot be omitted");
      assert(from.every((type, index) => type === to[index] || [type, to[index]].sort().join() === "TEXT,UUID"), "Unexpected baseline foreign-key mismatch");
      excludedBaselineForeignKeys.push(fk[0]);
    }
    assert(excludedBaselineForeignKeys.some((line) => line.includes('"stocker_stops_locationId_fkey"')));
    let baselineSql = generatedBaselineSql;
    for (const statement of excludedBaselineForeignKeys) baselineSql = baselineSql.replace(statement, "-- Fixture-only omission: unrelated baseline UUID/TEXT foreign key.");
    mkdirSync(join(migrations, "00000000000000_preparation_mainline_fixture"), { recursive: true });
    writeFileSync(join(migrations, "00000000000000_preparation_mainline_fixture", "migration.sql"), baselineSql);
    for (const name of [audit, target]) cpSync(join(root, "packages/database/prisma/migrations", name), join(migrations, name), { recursive: true });
    declaredChain.baselineCommit = baseline;
    declaredChain.fixtureOnlyExcludedForeignKeys = excludedBaselineForeignKeys;
  }
  cpSync(join(repositoryMigrations, "migration_lock.toml"), join(migrations, "migration_lock.toml"));
  const schema = join(schemaDirectory, "schema.prisma");
  cpSync(join(root, "packages/database/prisma/schema.prisma"), schema);
  declaredChain.migrationFiles = migrationInventory(migrations);
  declaredChain.migrations = declaredChain.migrationFiles.map(({ name }) => name);
  writeFileSync(join(fixture, "declared-chain.json"), JSON.stringify(declaredChain, null, 2));
  run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { env: databaseEnv });
  const initialLedger = ledgerSnapshot();
  assertMigrationLedger(initialLedger, declaredChain.migrationFiles);
  writeFileSync(join(fixture, "ledger-before.json"), initialLedger);
  const locationForeignKeys = repositoryChain ? validateLocationForeignKeys() : null;
  sql(`CREATE TABLE "PreparationFixtureSentinel" (nonce TEXT PRIMARY KEY); INSERT INTO "PreparationFixtureSentinel" VALUES ('${nonce}')`);
  run(process.execPath, [resolve(root, "frontend/nextjs-app/node_modules/tsx/dist/cli.mjs"), resolve(root, "frontend/nextjs-app/scripts/validate-speedster-preparation-postgres.ts")], { env: databaseEnv, cwd: resolve(root, "frontend/nextjs-app") });
  const ledgerBefore = ledgerSnapshot();
  assert.equal(ledgerBefore, initialLedger, "Runtime fixtures must not change the migration ledger");
  const second = run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { env: databaseEnv });
  assert.match(second, /No pending migrations to apply/);
  const ledgerAfter = ledgerSnapshot();
  writeFileSync(join(fixture, "ledger-after.json"), ledgerAfter);
  assert.equal(ledgerAfter, ledgerBefore);
  assertMigrationLedger(ledgerAfter, declaredChain.migrationFiles);
  assert.deepEqual(migrationInventory(repositoryMigrations), sourceMigrations, "Source migrations changed during validation");
  assert.deepEqual(migrationInventory(migrations), declaredChain.migrationFiles, "Copied migrations changed during validation");
  for (const entry of sourceFiles) assert.equal(fileHash(join(root, entry.path)), entry.sha256, `Source changed during validation: ${entry.path}`);
  if (repositoryChain) {
    assert.equal(run("git", ["rev-parse", "HEAD"]).trim(), sourceCommit);
    assert.equal(run("git", ["status", "--porcelain"]).trim(), "", "Source tree changed during validation");
  }
  outcome = { ...outcome, ok: true, locationForeignKeys, secondDeploy: "NO_OP", ledgerSha256: sha256(ledgerAfter) };
} catch (error) {
  failure = error;
  outcome.error = String(error).replaceAll(password, "[fixture-password]");
} finally {
  // Retain all fixture logs/data for inspection. Stop only the cluster we created.
  try {
    assert.deepEqual(JSON.parse(readFileSync(join(fixture, "ownership.json"), "utf8")), sentinel);
    assert.equal(statSync(fixture).uid, process.getuid?.());
    if (started) {
      const status = spawnSync(join(bin, "pg_ctl"), ["-D", data, "status"], { env: pristineEnv, encoding: "utf8" });
      if (status.status === 0) run(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
      else assert.equal(status.status, 3, "Could not determine status of the owned fixture cluster");
      assert.equal(spawnSync(join(bin, "pg_ctl"), ["-D", data, "status"], { env: pristineEnv, encoding: "utf8" }).status, 3,
        "Owned cluster was not stopped");
    }
    outcome.clusterState = started ? "STOPPED" : "NOT_STARTED";
  } catch (error) {
    failure ??= error;
    outcome.ok = false;
    outcome.cleanupError = String(error).replaceAll(password, "[fixture-password]");
    outcome.clusterState = "UNVERIFIED";
  }
  writeFileSync(join(fixture, "result.json"), JSON.stringify({ ...outcome, declaredChain }, null, 2));
}
console[outcome.ok ? "log" : "error"](`PREPARATION_DISPOSABLE_POSTGRES_${outcome.ok ? "PASS" : "FAILED"} ${fixture}`);
if (failure) throw failure;
