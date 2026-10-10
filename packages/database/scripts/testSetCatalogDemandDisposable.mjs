#!/usr/bin/env node
/** Owned loopback database only. No production URL, provider, storage write,
 * model call, source generation, dependency installation or deployment. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir, cp, copyFile, readFile, writeFile, statfs, access } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
assert.equal(process.version, 'v22.23.2');
assert.deepEqual(process.argv.slice(2), ['--ack-disposable-local-postgres']);
assert.ok(isAbsolute(process.env.INVENTORY_TEST_TOOLS_DIR ?? ''));
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SHADOW_DATABASE_URL']) assert.ok(!process.env[key], 'Do not launch with an application database URL.');
const space = await statfs(tmpdir()); assert.ok(space.bavail * space.bsize > 512 * 1024 * 1024, 'At least 512 MiB free is required for an owned disposable database.');
const testRequire = createRequire(join(resolve(process.env.INVENTORY_TEST_TOOLS_DIR), 'package.json'));
const { Client } = testRequire('pg');
assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
const pgBin = join(resolve(process.env.INVENTORY_TEST_TOOLS_DIR), 'node_modules/@embedded-postgres/darwin-arm64/native/bin');
for (const name of ['initdb', 'pg_ctl', 'postgres']) await access(join(pgBin, name));
const dbRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), repo = resolve(dbRoot, '../..'), frontend = join(repo, 'frontend/nextjs-app');
const dbRequire = createRequire(join(dbRoot, 'package.json')), frontendRequire = createRequire(join(frontend, 'package.json'));
const temp = await mkdtemp(join(tmpdir(), 'tk-catalog-demand-'));
const listener = createServer(); await new Promise((r, j) => listener.once('error', j).listen(0, '127.0.0.1', r));
const port = listener.address().port; await new Promise(r => listener.close(r));
const password = randomBytes(24).toString('hex'), nonce = randomBytes(24).toString('hex'), database = 'tenkings_catalog_demand_disposable';
const dataDir = join(temp, 'db'); assert.match(temp, /^[/A-Za-z0-9_.-]+$/);
const childEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(childEnv, { DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`, TEN_KINGS_CATALOG_DEMAND_DISPOSABLE: '1',
  TEN_KINGS_CATALOG_DEMAND_OWNERSHIP: join(temp, 'fixture-ownership.json'), TEN_KINGS_CATALOG_DEMAND_NONCE: nonce,
  SET_CATALOG_EVIDENCE_ENABLED: 'true', NEXT_PUBLIC_ADMIN_USER_IDS: 'catalog-demand-fixture-human', NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1' });
let started = false, client;
async function native(name, args) {
  return new Promise((res, rej) => {
    const child = spawn(join(pgBin, name), args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output += String(bytes).replaceAll(password, '[test-secret]'); });
    child.once('error', error => { clearTimeout(timer); rej(error); }); child.once('close', code => { clearTimeout(timer); code === 0 ? res(output) : rej(Error(`Owned PostgreSQL ${name} failed: ${output}`)); });
  });
}
async function run(args, cwd = repo, quiet = false) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { const safe = String(chunk).replaceAll(password, '[test-secret]'); output += safe; if (!quiet) process.stdout.write(safe); });
    child.once('error', rej); child.once('close', code => code === 0 ? res(output) : rej(Error(`Disposable catalog test failed: ${output}`)));
  });
}
try {
  const passwordFile = join(temp, 'initdb-password'); await writeFile(passwordFile, password, { mode: 0o600 });
  await native('initdb', ['-D', dataDir, '--username=postgres', `--pwfile=${passwordFile}`, '--auth-host=scram-sha-256', '--auth-local=trust', '--encoding=UTF8']);
  await rm(passwordFile);
  await native('pg_ctl', ['-D', dataDir, '-l', join(temp, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${temp} -c timezone=America/Los_Angeles`, '-w', 'start']); started = true;
  const bootstrap = new Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
  try { await bootstrap.connect(); await bootstrap.query(`CREATE DATABASE ${database}`); } finally { await bootstrap.end(); }
  const pid = Number((await readFile(join(temp, 'db/postmaster.pid'), 'utf8')).split('\n')[0]); assert.ok(pid > 1);
  await writeFile(childEnv.TEN_KINGS_CATALOG_DEMAND_OWNERSHIP, JSON.stringify({ schema_version: 1, owner_uid: process.getuid(), postgres_pid: pid, nonce,
    database_url_sha256: createHash('sha256').update(childEnv.DATABASE_URL).digest('hex') }), { mode: 0o600 });
  client = new Client({ connectionString: childEnv.DATABASE_URL }); await client.connect();
  const version = (await client.query('SHOW server_version')).rows[0].server_version; assert.ok(version.startsWith('17.'));
  assert.equal((await client.query('SHOW TimeZone')).rows[0].TimeZone, 'America/Los_Angeles');
  const schema = join(temp, 'prisma'); await mkdir(schema);
  await copyFile(join(dbRoot, 'prisma/schema.prisma'), join(schema, 'schema.prisma'));
  await cp(join(dbRoot, 'prisma/migrations'), join(schema, 'migrations'), { recursive: true });
  const migrate = [dbRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(schema, 'schema.prisma')];
  await run(migrate, repo, true);
  const before = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  const second = await run(migrate, repo, true);
  const after = (await client.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  assert.match(second, /No pending migrations to apply/i); assert.deepEqual(after, before);
  console.log(`Owned PostgreSQL ${version}; full migration chain ${after.length}; second deploy exact no-op.`);
  await run([frontendRequire.resolve('tsx/cli'), '--test', 'tests/setCatalogDemandPostgres.test.ts'], frontend);
} finally {
  if (client) await client.end();
  // pg_ctl may lose its acknowledgement after starting the owned server. Never
  // remove a possibly running cluster; stop its exact data directory first.
  const hasPid = await access(join(dataDir, 'postmaster.pid')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (started || hasPid) await native('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
  await rm(temp, { recursive: true, force: true }); console.log('Owned catalog-demand PostgreSQL stopped; temporary cluster removed.');
}
