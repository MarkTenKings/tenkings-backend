#!/usr/bin/env node
// Own loopback cluster only. Never accepts an application DATABASE_URL.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir, cp, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

if (!process.argv.includes('--ack-disposable-local-postgres') || !process.env.INVENTORY_TEST_TOOLS_DIR) throw Error('Provide isolated INVENTORY_TEST_TOOLS_DIR and --ack-disposable-local-postgres.');
const testRequire = createRequire(join(resolve(process.env.INVENTORY_TEST_TOOLS_DIR), 'package.json'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(testRequire.resolve('embedded-postgres')).href);
const { Client } = testRequire('pg');
const dbRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(dbRoot, '../..'), frontend = join(repo, 'frontend/nextjs-app');
const dbRequire = createRequire(join(dbRoot, 'package.json')), frontendRequire = createRequire(join(frontend, 'package.json'));
const temp = await mkdtemp(join(tmpdir(), 'tk-set-catalog-'));
const listener = createServer(); await new Promise((r, j) => listener.once('error', j).listen(0, '127.0.0.1', r));
const port = listener.address().port; await new Promise(r => listener.close(r));
const password = randomBytes(24).toString('hex'), database = 'tenkings_set_catalog_disposable';
const cluster = new EmbeddedPostgres({ databaseDir: join(temp, 'db'), user: 'postgres', password, port, persistent: true,
  createPostgresUser: false, initdbFlags: ['--encoding=UTF8'], postgresFlags: ['-h', '127.0.0.1', '-k', temp], onLog() {}, onError() {} });
const childEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(childEnv, { DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`, TEN_KINGS_CATALOG_DISPOSABLE_VALIDATION: '1',
  SET_CATALOG_EVIDENCE_ENABLED: 'true', NEXT_PUBLIC_ADMIN_USER_IDS: 'catalog-fixture-human', NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' });
let started = false, client;
async function run(args, cwd = repo, quiet = false) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { const safe = String(chunk).replaceAll(password, '[test-secret]'); output += safe; if (!quiet) process.stdout.write(safe); });
    child.once('error', rej); child.once('close', code => code === 0 ? res(output) : rej(Error(`Disposable catalog test failed: ${output}`)));
  });
}
try {
  await cluster.initialise(); await cluster.start(); started = true; await cluster.createDatabase(database);
  client = new Client({ connectionString: childEnv.DATABASE_URL }); await client.connect();
  const version = (await client.query('SHOW server_version')).rows[0].server_version;
  if (!version.startsWith('17.')) throw Error('This reviewed runner requires disposable PostgreSQL 17.');
  console.log('Disposable loopback PostgreSQL:', version);
  const schema = join(temp, 'prisma'); await mkdir(schema);
  await copyFile(join(dbRoot, 'prisma/schema.prisma'), join(schema, 'schema.prisma'));
  await cp(join(dbRoot, 'prisma/migrations'), join(schema, 'migrations'), { recursive: true });
  const migrate = [dbRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(schema, 'schema.prisma')];
  await run(migrate, repo, true);
  const before = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  const second = await run(migrate, repo, true);
  const after = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  if (!/No pending migrations to apply/i.test(second) || JSON.stringify(before) !== JSON.stringify(after)) throw Error('Second deployment was not an exact no-op.');
  console.log(`Full migration chain: ${after.length}; second deploy no-op, identical ledger.`);
  await run(['--test', join(dbRoot, 'tests/setCatalogEvidencePostgres.test.js')]);
  await run([frontendRequire.resolve('tsx/cli'), '--test', 'tests/setCatalogEvidencePostgres.test.ts'], frontend);
} finally {
  if (client) await client.end(); if (started) await cluster.stop();
  await rm(temp, { recursive: true, force: true }); console.log('Owned catalog PostgreSQL stopped and temporary cluster removed.');
}
