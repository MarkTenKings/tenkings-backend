#!/usr/bin/env node
// Creates its own disposable cluster. Never accepts DATABASE_URL or a remote
// host. Install test tools separately; no database test dependency ships at runtime.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, mkdir, cp, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const toolRoot = process.env.INVENTORY_TEST_TOOLS_DIR;
if (!toolRoot || !process.argv.includes('--ack-disposable-local-postgres')) throw new Error('Provide isolated INVENTORY_TEST_TOOLS_DIR and --ack-disposable-local-postgres');
const testRequire = createRequire(join(resolve(toolRoot), 'package.json'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(testRequire.resolve('embedded-postgres')).href);
const { Client } = testRequire('pg');
const dbRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(dbRoot, '../..');
const localRequire = createRequire(join(dbRoot, 'package.json'));
const temp = await mkdtemp(join(tmpdir(), 'tk-inventory-v2-'));
const listener = createServer();
await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const password = randomBytes(24).toString('hex');
const database = 'tenkings_inventory_v2_disposable';
const cluster = new EmbeddedPostgres({ databaseDir: join(temp, 'db'), user: 'postgres', password, port,
  persistent: true, createPostgresUser: false,
  postgresFlags: ['-h', '127.0.0.1', '-k', temp], onLog() {}, onError() {} });
let started = false;
let client;
const childEnv = { ...process.env, DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`,
  TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION: '1' };
async function run(args, quiet = false) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repo, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (!quiet) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => { output += chunk; if (!quiet) process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(quiet ? output.replaceAll(password, '[test-secret-redacted]') : 'Disposable test process failed; see TAP output above.')));
  });
}
async function stageReviewedMigration(schemaRoot, migrationName, proposalName) {
  const reviewed = await readFile(join(dbRoot, 'schema-proposals', proposalName));
  const candidate = join(schemaRoot, 'migrations', migrationName);
  await mkdir(candidate, { recursive: true });
  const path = join(candidate, 'migration.sql');
  try {
    // Only an absent file in this disposable tree may be created. Published
    // migrations must retain the exact reviewed bytes, including comments.
    await writeFile(path, reviewed, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readFile(path)).equals(reviewed)) throw new Error(`Published migration ${migrationName} differs from its reviewed SQL; preserved without replacement.`);
  }
}
try {
  await cluster.initialise(); await cluster.start(); started = true;
  await cluster.createDatabase(database);
  client = new Client({ connectionString: childEnv.DATABASE_URL }); await client.connect();
  const version = (await client.query('SELECT version()')).rows[0].version;
  console.log('Disposable loopback PostgreSQL:', version);
  const prismaCli = localRequire.resolve('prisma/build/index.js');
  // Copy the published migration tree, then verify both inventory files against
  // their immutable reviewed artifacts. A pre-publication checkout may add a
  // missing file here only; the repository is never changed by validation.
  const schemaRoot = join(temp, 'validation-schema');
  await mkdir(schemaRoot);
  await copyFile(join(dbRoot, 'prisma/schema.prisma'), join(schemaRoot, 'schema.prisma'));
  await cp(join(dbRoot, 'prisma/migrations'), join(schemaRoot, 'migrations'), { recursive: true });
  await stageReviewedMigration(schemaRoot, '20260907190000_card_inventory_events_v2', '20260907_card_inventory_events_v2.sql');
  await stageReviewedMigration(schemaRoot, '20260908190000_inventory_workflow_events_v2', '20260908_inventory_workflow_events_v2.sql');
  const args = [prismaCli, 'migrate', 'deploy', '--schema', join(schemaRoot, 'schema.prisma')];
  await run(args, true);
  const before = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  await run(args, true);
  const after = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Second Prisma deploy changed the migration ledger');
  console.log(`Full Prisma chain: ${after.length} migrations; second deploy unchanged.`);
  await run(['--test', join(dbRoot, 'tests/cardInventoryV2Postgres.test.js')]);
  await run(['--test', join(dbRoot, 'tests/inventoryWorkflowV2Postgres.test.js')]);
  await run(['--test', join(dbRoot, 'tests/staffInventoryV2Postgres.test.js')]);
  await run(['--test', join(dbRoot, 'tests/staffInventoryResearchV2Postgres.test.js')]);
  if (process.env.INVENTORY_TEST_EXPORT_PATH) {
    const { PrismaClient } = localRequire('@prisma/client');
    const { exportCardInventoryPageV2 } = localRequire('./dist/database/src/cardInventoryV2Read.js');
    const source = new PrismaClient({ datasources: { db: { url: childEnv.DATABASE_URL } } });
    const pages = [];
    try {
      let after_sequence = 0, snapshot_through_sequence;
      do {
        const page = await exportCardInventoryPageV2(source, { after_sequence, limit: 3, snapshot_through_sequence });
        pages.push(page); after_sequence = page.page.through_sequence; snapshot_through_sequence = page.snapshot_through_sequence;
      } while (after_sequence < snapshot_through_sequence);
    } finally { await source.$disconnect(); }
    await writeFile(process.env.INVENTORY_TEST_EXPORT_PATH, JSON.stringify({ test_only: true,
      source_system: 'ten-kings-card-platform-v2', pages }), { mode: 0o600 });
  }
} finally {
  if (client) await client.end();
  if (started) await cluster.stop();
  await rm(temp, { recursive: true, force: true });
  console.log('Disposable PostgreSQL stopped; its temporary cluster removed.');
}
