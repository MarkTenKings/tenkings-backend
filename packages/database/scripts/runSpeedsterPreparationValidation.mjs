#!/usr/bin/env node
// Creates its own loopback-only cluster. It accepts no database URL or existing data directory.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baseline = "db899e953226563bafc156da6bec3710fe5e65b8";
const target = "20260908010000_speedster_prepared_evidence_authority";
const audit = "20260818153000_speedster_audit_evidence_append_only";
const args = process.argv.slice(2);
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
let started = false;
try {
  run(join(bin, "initdb"), ["-D", data, "--username", user, "--pwfile", passwordFile, "--auth-host=scram-sha-256", "--auth-local=reject", "--encoding=UTF8", "--locale=C"]);
  run(join(bin, "pg_ctl"), ["-D", data, "-l", join(fixture, "postgresql.log"), "-o", `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, "-w", "start"]);
  started = true;
  assert.equal(sql("SELECT current_setting('data_directory')", "postgres"), data);
  assert.equal(sql("SELECT current_setting('listen_addresses')", "postgres"), "127.0.0.1");
  sql(`CREATE DATABASE "${database}"`, "postgres");
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");

  // Historical repository migrations are not a clean initial schema chain. This
  // declares the exact synthetic mainline baseline, then the audit prerequisite
  // and our real migration. No Vault migration is required or replayed.
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
  const schemaDirectory = join(fixture, "schema");
  const migrations = join(schemaDirectory, "migrations");
  mkdirSync(join(migrations, "00000000000000_preparation_mainline_fixture"), { recursive: true });
  writeFileSync(join(migrations, "00000000000000_preparation_mainline_fixture", "migration.sql"), baselineSql);
  for (const name of [audit, target]) cpSync(join(root, "packages/database/prisma/migrations", name), join(migrations, name), { recursive: true });
  writeFileSync(join(migrations, "migration_lock.toml"), 'provider = "postgresql"\n');
  const schema = join(schemaDirectory, "schema.prisma");
  cpSync(join(root, "packages/database/prisma/schema.prisma"), schema);
  const declaredChain = { baselineCommit: baseline, fixtureOnlyExcludedForeignKeys: excludedBaselineForeignKeys, migrations: ["00000000000000_preparation_mainline_fixture", audit, target], postgresVersion: run(join(bin, "postgres"), ["--version"]).trim() };
  writeFileSync(join(fixture, "declared-chain.json"), JSON.stringify(declaredChain, null, 2));
  run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { env: databaseEnv });
  assert.equal(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'), "3");
  sql(`CREATE TABLE "PreparationFixtureSentinel" (nonce TEXT PRIMARY KEY); INSERT INTO "PreparationFixtureSentinel" VALUES ('${nonce}')`);
  run(process.execPath, [resolve(root, "frontend/nextjs-app/node_modules/tsx/dist/cli.mjs"), resolve(root, "frontend/nextjs-app/scripts/validate-speedster-preparation-postgres.ts")], { env: databaseEnv, cwd: resolve(root, "frontend/nextjs-app") });
  const ledgerBefore = sql('SELECT string_agg(id || checksum || migration_name, \'|\' ORDER BY migration_name) FROM "_prisma_migrations"');
  const second = run(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { env: databaseEnv });
  assert.match(second, /No pending migrations to apply/);
  assert.equal(sql('SELECT string_agg(id || checksum || migration_name, \'|\' ORDER BY migration_name) FROM "_prisma_migrations"'), ledgerBefore);
  writeFileSync(join(fixture, "result.json"), JSON.stringify({ ok: true, declaredChain, secondDeploy: "NO_OP", evidenceDirectory: fixture }, null, 2));
  console.log(`PREPARATION_DISPOSABLE_POSTGRES_PASS ${fixture}`);
} catch (error) {
  writeFileSync(join(fixture, "result.json"), JSON.stringify({ ok: false, error: String(error), evidenceDirectory: fixture }, null, 2));
  console.error(`PREPARATION_DISPOSABLE_POSTGRES_FAILED ${fixture}`);
  throw error;
} finally {
  // Retain all fixture logs/data for inspection. Stop only the cluster we created.
  assert.deepEqual(JSON.parse(readFileSync(join(fixture, "ownership.json"), "utf8")), sentinel);
  if (started) run(join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
}
