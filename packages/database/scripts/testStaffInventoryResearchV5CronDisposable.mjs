#!/usr/bin/env node
/** V5-enabled default cron wiring qualification only. Never a performance or release gate. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { arch, platform, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  assert.ok(['--prepare-only', '--run-approved', '--ack-disposable-local-postgres', '--out', '--prepared-receipt', '--prepared-seal-sha256'].includes(key), `Unsupported argument: ${key}`);
  assert.ok(!(key in options), `Repeated argument: ${key}`);
  options[key] = ['--out', '--prepared-receipt', '--prepared-seal-sha256'].includes(key) ? args[++i] : true;
  assert.ok(options[key] && !String(options[key]).startsWith('--'), `Missing argument: ${key}`);
}
const prepareOnly = options['--prepare-only'] === true;
assert.equal(Number(prepareOnly) + Number(options['--run-approved'] === true), 1, 'Choose exactly one mode.');
if (prepareOnly) assert.ok(!options['--ack-disposable-local-postgres'] && !options['--prepared-receipt'] && !options['--prepared-seal-sha256']);
else {
  assert.equal(options['--ack-disposable-local-postgres'], true, 'Explicit owned disposable database acknowledgement required.');
  assert.ok(isAbsolute(options['--prepared-receipt'] ?? ''));
  assert.match(options['--prepared-seal-sha256'] ?? '', /^[a-f0-9]{64}$/);
}
assert.ok(isAbsolute(options['--out'] ?? ''), '--out must be a new absolute private directory.');
assert.ok(isAbsolute(process.env.INVENTORY_TEST_TOOLS_DIR ?? ''), 'Existing isolated INVENTORY_TEST_TOOLS_DIR required.');
assert.match(process.version, /^v22\./); assert.equal(platform(), 'darwin'); assert.equal(arch(), 'arm64');
assert.ok(!process.env.DATABASE_URL && !process.env.DIRECT_URL && !process.env.SHADOW_DATABASE_URL, 'Do not launch with a pre-existing database URL.');

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
const frontend = join(repo, 'frontend/nextjs-app');
const out = join(await realpath(dirname(options['--out'])), basename(options['--out']));
assert.ok(relative(repo, out).startsWith('..'), 'Receipts must be outside the source worktree.');
await mkdir(out, { mode: 0o700 });
const requireFront = createRequire(join(frontend, 'package.json'));
const requireDb = createRequire(join(repo, 'packages/database/package.json'));
const requireTools = createRequire(join(await realpath(process.env.INVENTORY_TEST_TOOLS_DIR), 'package.json'));
const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = 'frontend/nextjs-app/tests/staffInventoryResearchV5CronPostgres.test.ts';
const runner = 'packages/database/scripts/testStaffInventoryResearchV5CronDisposable.mjs';
const cleanEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  TMPDIR: tmpdir(), NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true',
  CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', CI: '1', NO_COLOR: '1' };
const capMs = 10 * 60_000, cleanupReserveMs = 30_000, startedAt = Date.now(), deadline = startedAt + capMs - cleanupReserveMs;
const diskFloor = 2 * 1024 ** 3, launchReserve = 256 * 1024 ** 2;
const stop = new AbortController(), groups = new Map(), clients = new Set(), ownedPids = [];
let abortReason, interruptSignal, temp, postgresChild, completed = false, fixtureStarted = false, password = '', pgLog = '', pgLogSize = 0;
const cleanup = { groups_stopped: false, postgres_stopped: false, temporary_removed: false, errors: [] };
const redact = text => String(text).replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]').replaceAll(password || '\0never-a-secret\0', '[owned-password]');
const artifact = (name, value) => writeFile(join(out, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
const alive = pid => { try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const signal = (pid, value) => { try { process.kill(-pid, value); } catch (error) { if (error.code !== 'ESRCH') cleanup.errors.push(`Cannot signal owned group ${pid}: ${error.code}`); } };
const stopGroups = () => { for (const [pid, entry] of groups) signal(pid, entry.postgres ? 'SIGINT' : 'SIGTERM'); };
const abort = reason => { abortReason ??= reason; stop.abort(); stopGroups(); };
const guard = () => { if (Date.now() >= deadline) abort('Ten-minute cap: final thirty seconds reserved for cleanup.'); if (stop.signal.aborted) throw Error(abortReason); };
const interrupt = value => { interruptSignal ??= value; process.exitCode = value === 'SIGINT' ? 130 : 143; abort(`Interrupted by ${value}.`); };
const onSigint = () => interrupt('SIGINT'), onSigterm = () => interrupt('SIGTERM');
process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
const watchdog = setTimeout(() => abort('Work deadline reached; owned cleanup required.'), Math.max(1, deadline - Date.now()));
async function limited(operation, milliseconds, label, work = true) {
  if (work) guard(); let timer, onAbort;
  try {
    return await Promise.race([Promise.resolve().then(() => { if (work) guard(); return operation(); }), new Promise((_, reject) => {
      onAbort = () => reject(Error(abortReason));
      if (work) stop.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { if (work) abort(`${label} exceeded its bound.`); reject(Error(`${label} exceeded its bound.`)); }, Math.max(1, work ? Math.min(milliseconds, deadline - Date.now()) : milliseconds));
    })]);
  } finally { clearTimeout(timer); stop.signal.removeEventListener('abort', onAbort); }
}
async function stopped(pid, milliseconds) {
  const until = Date.now() + Math.max(0, milliseconds);
  while (alive(pid) && Date.now() < until) await new Promise(done => setTimeout(done, 20));
  return !alive(pid);
}
function register(child, postgres = false) {
  assert.ok(child.pid, 'Owned child failed to spawn.'); ownedPids.push(child.pid); groups.set(child.pid, { child, postgres });
}
async function run(command, commandArgs, { env = cleanEnv, cwd = repo, label, timeoutMs = 120_000 } = {}) {
  guard();
  const child = spawn(command, commandArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '', size = 0;
  const closed = new Promise((done, reject) => {
    child.once('error', reject); child.once('close', code => done(code));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      size += bytes.length;
      if (size > 4 * 1024 ** 2) { abort(`${label} exceeded the four MiB output cap.`); return; }
      output += bytes.toString('utf8');
    });
  });
  void closed.catch(() => {}); register(child);
  try {
    const code = await limited(() => closed, timeoutMs, label);
    assert.equal(code, 0, `${label} failed (${code}); inspect its private log.`);
    if (alive(child.pid)) { signal(child.pid, 'SIGTERM'); if (!await stopped(child.pid, 3000)) { signal(child.pid, 'SIGKILL'); await stopped(child.pid, 2000); } }
    assert.equal(alive(child.pid), false, `${label} left an owned process group.`); groups.delete(child.pid);
    return output;
  } finally { await limited(() => writeFile(join(out, `${label}.log`), redact(output), { mode: 0o600, flag: 'wx' }), Math.min(3000, startedAt + capMs - Date.now()), 'Command log receipt', false); }
}
async function disk(minimum) {
  const values = [];
  for (const path of [out, tmpdir()]) { const value = await statfs(path); const available = value.bavail * value.bsize; values.push({ path, available }); assert.ok(available >= minimum, `${minimum} free bytes required on ${path}.`); }
  return values;
}
async function filesLedger(root, relativeNames = []) {
  const values = [];
  const walk = async path => {
    guard();
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!entry.isSymbolicLink(), `Unexpected symlink in sealed tree: ${join(path, entry.name)}`);
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (entry.isFile()) values.push({ path: relative(root, join(path, entry.name)), sha256: sha(await readFile(join(path, entry.name))) });
    }
  };
  for (const name of relativeNames) await walk(join(root, name));
  return values.sort((a, b) => a.path.localeCompare(b.path));
}
async function packageInfo(loader, name) {
  // Some installed packages export only their entry point, not package.json.
  let directory = dirname(loader.resolve(name));
  for (let i = 0; i < 12; i++) {
    const path = join(directory, 'package.json'); let bytes;
    try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (bytes && JSON.parse(bytes.toString('utf8')).name === name) return { root: directory, version: JSON.parse(bytes.toString('utf8')).version, package_sha256: sha(bytes) };
    assert.notEqual(directory, dirname(directory), `Cannot locate installed package ${name}.`); directory = dirname(directory);
  }
  throw Error(`Cannot locate installed package ${name}.`);
}
async function seal() {
  const roots = ['frontend/nextjs-app/lib', 'packages/database/src', 'packages/shared/src', 'packages/ebay-sold-comps-v2/src', 'packages/card-catalog-evidence/src', 'packages/database/prisma'];
  const singles = [fixture, runner, 'frontend/nextjs-app/pages/api/cron/inventory-research.ts', 'frontend/nextjs-app/tsconfig.json', 'package.json', 'pnpm-lock.yaml',
    ...['frontend/nextjs-app', 'packages/database', 'packages/shared', 'packages/ebay-sold-comps-v2', 'packages/card-catalog-evidence'].map(path => `${path}/package.json`)];
  const sources = [...await filesLedger(repo, roots)];
  for (const path of singles) sources.push({ path, sha256: sha(await readFile(join(repo, path))) });
  sources.sort((a, b) => a.path.localeCompare(b.path));
  const clientRequire = createRequire(requireDb.resolve('@prisma/client'));
  const generatedRoot = dirname(clientRequire.resolve('.prisma/client/default'));
  const clientFiles = await filesLedger(generatedRoot, ['']);
  const schema = await readFile(join(repo, 'packages/database/prisma/schema.prisma'), 'utf8');
  const generated = await readFile(join(generatedRoot, 'schema.prisma'), 'utf8');
  const model = (text, name) => { const match = text.match(new RegExp(`model ${name} \\{([\\s\\S]*?)^\\}`, 'm')); assert.ok(match, `Missing active model ${name}.`); return match[1].replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim(); };
  const activeModels = ['Location', 'InventoryWorkflowEventV2', 'StaffInventoryResearchJobV2', 'StaffInventoryIntakeLeaseV2'];
  for (const name of activeModels) assert.equal(model(schema, name), model(generated, name), `Installed generated client differs for active model ${name}. No generation is permitted.`);
  const versions = {};
  for (const [name, loader] of [['prisma', requireDb], ['@prisma/client', requireDb], ['tsx', requireFront], ['sharp', requireFront], ['pg', requireTools], ['@embedded-postgres/darwin-arm64', requireTools]]) {
    versions[name] = await packageInfo(loader, name);
  }
  const pgRoot = versions['@embedded-postgres/darwin-arm64'].root;
  const native = [];
  for (const path of ['native/bin/initdb', 'native/bin/postgres']) native.push({ path: join(pgRoot, path), sha256: sha(await readFile(join(pgRoot, path))) });
  return { schema_version: 1, scope: 'v5-enabled-default-authenticated-cron-functional-only', repo, node: { path: process.execPath, version: process.version, platform: platform(), arch: arch() },
    limits: { total_ms: capMs, cleanup_reserve_ms: cleanupReserveMs, disk_floor_bytes: diskFloor, launch_reserve_bytes: launchReserve, source_timeout_ms: 20_000, detail_timeout_ms: 6000, fixture_timeout_ms: 120_000, max_claims: 3, max_synthetic_searches: 9, max_synthetic_details: 6, max_synthetic_models: 9, max_synthetic_candidate_images: 36, real_provider_calls: 0 },
    sources, generated_client: { root: generatedRoot, files: clientFiles, active_models: activeModels }, versions, native };
}

try {
  const current = await limited(seal, 120_000, 'Source and dependency seal');
  await artifact('launch-seal.json', current);
  const sealBytes = await readFile(join(out, 'launch-seal.json'));
  if (prepareOnly) {
    await artifact('preparation.json', { prepared_only: true, database_started: false, measured_saves: 0, launch_seal_sha256: sha(sealBytes), functional_integration_pass: false, release_pass: false });
    console.log(JSON.stringify({ prepared_only: true, launch_seal_sha256: sha(sealBytes), output: out }));
  } else {
    const approved = await readFile(options['--prepared-receipt']);
    assert.equal(sha(approved), options['--prepared-seal-sha256'], 'Reviewed receipt hash differs.');
    assert.deepEqual(current, JSON.parse(approved), 'Source, runner, client or dependency seal changed. Prepare and review the new bytes.');
    await artifact('launch-disk.json', await disk(diskFloor + launchReserve));
    const { Client } = requireTools('pg');
    temp = await mkdtemp(join(tmpdir(), 'tk-research-v5-cron-'));
    const listener = createServer(); let port;
    try {
      await limited(() => new Promise((done, reject) => listener.once('error', reject).listen(0, '127.0.0.1', done)), 3000, 'Loopback port allocation');
      port = listener.address().port;
    } finally { if (listener.listening) await new Promise(done => listener.close(done)); }
    password = randomBytes(32).toString('hex');
    const passwordFile = join(temp, 'pg-password'); await writeFile(passwordFile, password, { mode: 0o600, flag: 'wx' });
    const pgRoot = current.versions['@embedded-postgres/darwin-arm64'].root;
    const pgEnv = { ...cleanEnv, LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'en_US.UTF-8' };
    await disk(diskFloor);
    await run(join(pgRoot, 'native/bin/initdb'), [`--pgdata=${join(temp, 'db')}`, '--auth=password', '--username=postgres', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--lc-messages=en_US.UTF-8'], { env: pgEnv, label: 'initdb', timeoutMs: 60_000 });
    await rm(passwordFile);
    guard();
    postgresChild = spawn(join(pgRoot, 'native/bin/postgres'), ['-D', join(temp, 'db'), '-p', String(port), '-h', '127.0.0.1', '-k', temp, '-c', 'shared_buffers=32MB', '-c', 'max_connections=12'], { env: pgEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const ready = new Promise((done, reject) => {
      postgresChild.once('error', reject); postgresChild.once('close', code => reject(Error(`Owned PostgreSQL exited (${code}).`)));
      postgresChild.stderr.on('data', bytes => {
        pgLogSize += bytes.length;
        if (pgLogSize > 1024 * 1024) { abort('Owned PostgreSQL exceeded one MiB log cap.'); return; }
        pgLog += bytes.toString('utf8');
        if (pgLog.includes('database system is ready to accept connections')) done();
      });
    });
    void ready.catch(() => {}); register(postgresChild, true);
    postgresChild.once('close', () => { if (!stop.signal.aborted && !completed) abort('Owned PostgreSQL stopped before fixture completion.'); });
    await limited(() => ready, 30_000, 'PostgreSQL readiness');
    const url = name => `postgresql://postgres:${password}@127.0.0.1:${port}/${name}?connection_limit=3`;
    const connection = async name => {
      guard(); const value = new Client({ connectionString: url(name), connectionTimeoutMillis: 5000, query_timeout: 15_000 });
      clients.add(value); value.on('error', () => abort('Owned administrative connection failed.'));
      await limited(() => value.connect(), 5000, 'Administrative connect'); return value;
    };
    const admin = await connection('postgres');
    await limited(() => admin.query('CREATE DATABASE tenkings_research_v5_cron_disposable'), 15_000, 'Create owned database');
    await limited(() => admin.end(), 3000, 'Administrative disconnect'); clients.delete(admin);
    const databaseUrl = url('tenkings_research_v5_cron_disposable'), nonce = randomBytes(24).toString('hex');
    const ownershipFile = join(temp, 'fixture-ownership.json');
    await writeFile(ownershipFile, JSON.stringify({ schema_version: 1, database_url_sha256: sha(new URL(databaseUrl).href), nonce, owner_uid: process.getuid(), postgres_pid: postgresChild.pid, result_file: join(out, 'fixture-result.json') }), { mode: 0o600, flag: 'wx' });
    const migrationEnv = { ...cleanEnv, DATABASE_URL: databaseUrl };
    // Prisma only sees this owned schema directory and clean environment; no
    // checkout .env file is loaded and no generated client is changed.
    const schemaRoot = join(temp, 'schema'); await limited(() => cp(join(repo, 'packages/database/prisma'), schemaRoot, { recursive: true }), 30_000, 'Owned schema copy');
    const migrate = [requireDb.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(schemaRoot, 'schema.prisma')];
    await disk(diskFloor); await run(process.execPath, migrate, { env: migrationEnv, cwd: temp, label: 'migrations-first', timeoutMs: 120_000 });
    const observer = await connection('tenkings_research_v5_cron_disposable');
    const server = (await limited(() => observer.query("SELECT current_database() AS database, host(inet_server_addr()) AS host, current_setting('server_encoding') AS encoding, version() AS version"), 5000, 'Server identity')).rows[0];
    assert.equal(server.database, 'tenkings_research_v5_cron_disposable'); assert.equal(server.host, '127.0.0.1'); assert.equal(server.encoding, 'UTF8');
    const ledger = async () => (await limited(() => observer.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name'), 5000, 'Migration ledger')).rows;
    const before = await ledger(); assert.ok(before.length > 0); assert.ok(before.every(row => row.finished_at && !row.rolled_back_at));
    await run(process.execPath, migrate, { env: migrationEnv, cwd: temp, label: 'migrations-second', timeoutMs: 120_000 });
    assert.deepEqual(await ledger(), before); await artifact('database-and-migrations.json', { server, second_deploy_unchanged: true, migrations: before });
    await limited(() => observer.end(), 3000, 'Observer disconnect'); clients.delete(observer);
    const fixtureEnv = { ...cleanEnv, DATABASE_URL: databaseUrl, TEN_KINGS_RESEARCH_V5_CRON_DISPOSABLE_VALIDATION: '1',
      TEN_KINGS_RESEARCH_V5_CRON_OWNERSHIP_FILE: ownershipFile, TEN_KINGS_RESEARCH_V5_CRON_NONCE: nonce, CARD_STORAGE_MODE: 's3',
      STAFF_INVENTORY_RESEARCH_SALE_DETAILS: 'true', TEN_KINGS_RESEARCH_V5_CRON_RESULT_FILE: join(out, 'fixture-result.json'),
      OPENAI_API_KEY: 'fixture-openai-key', SOLDCOMPS_API_KEY: 'fixture-sold-key', CRON_SECRET: `fixture-cron-${randomBytes(32).toString('hex')}`,
      TSX_TSCONFIG_PATH: join(frontend, 'tsconfig.json') };
    await disk(diskFloor);
    fixtureStarted = true;
    const tap = await run(process.execPath, ['--import', pathToFileURL(requireFront.resolve('tsx')).href, '--test', '--test-reporter=tap', '--test-concurrency=1', join(repo, fixture)], { env: fixtureEnv, cwd: frontend, label: 'v5-default-cron-functional', timeoutMs: 150_000 });
    for (const [name, count] of [['tests', 1], ['pass', 1], ['fail', 0], ['cancelled', 0], ['skipped', 0]]) assert.match(tap, new RegExp(`^# ${name} ${count}$`, 'm'), `The actual fixture must pass without skip: ${name}.`);
    const result = JSON.parse(await readFile(join(out, 'fixture-result.json'), 'utf8'));
    assert.equal(result.claims, 3); assert.equal(result.durable_completions, 3); assert.equal(result.real_provider_calls, 0);
    assert.deepEqual(result.transports, { heads: 6, photoReads: 6, references: 3, archives: 10, searches: 5, details: 4, models: 5, images: 10, unexpected: 0 });
    assert.equal(result.disabled_reader_unchanged, true); assert.equal(result.late_result_unchanged, true);
    assert.equal(result.source_histories_unchanged, true);
    assert.deepEqual(await limited(seal, 120_000, 'Final source seal'), current, 'Source changed during the functional fixture.');
    completed = true;
  }
} catch (error) {
  abort(redact(error.message)); if (!interruptSignal) process.exitCode = 1;
  try { await limited(() => artifact('incomplete.json', { complete: false, functional_integration_pass: false, release_pass: false, error: redact(error.message), interrupt_signal: interruptSignal ?? null }), 3000, 'Failure receipt', false); }
  catch (receiptError) { cleanup.errors.push(redact(receiptError.message)); }
  console.error(redact(error.message));
} finally {
  clearTimeout(watchdog); stopGroups();
  const cleanupDeadline = Math.min(startedAt + capMs, Date.now() + cleanupReserveMs), remaining = maximum => Math.max(1, Math.min(maximum, cleanupDeadline - Date.now()));
  await Promise.allSettled([...clients].map(async client => {
    try { await limited(() => client.end(), remaining(3000), 'Administrative cleanup', false); clients.delete(client); }
    catch (error) { client.connection?.stream?.destroy(); cleanup.errors.push(redact(error.message)); }
  }));
  await Promise.allSettled([...groups].map(async ([pid, { child }]) => {
    if (!await stopped(pid, remaining(5000))) { signal(pid, 'SIGKILL'); await stopped(pid, remaining(5000)); }
    if (alive(pid)) { cleanup.errors.push(`Owned process group ${pid} remains; temporary data retained.`); child.unref(); child.stdout?.destroy(); child.stderr?.destroy(); }
    else groups.delete(pid);
  }));
  cleanup.groups_stopped = groups.size === 0; cleanup.postgres_stopped = !postgresChild || !alive(postgresChild.pid);
  if (temp && cleanup.groups_stopped && cleanup.errors.length === 0) {
    try { await limited(() => rm(temp, { recursive: true, force: true }), remaining(10_000), 'Owned temporary removal', false); cleanup.temporary_removed = true; }
    catch (error) { cleanup.errors.push(redact(error.message)); }
  }
  if (cleanup.errors.length && !interruptSignal) process.exitCode = 1;
  try {
    if (postgresChild) await limited(() => writeFile(join(out, 'postgres.log'), redact(pgLog), { mode: 0o600, flag: 'wx' }), remaining(2000), 'PostgreSQL log receipt', false);
    await limited(() => artifact('cleanup.json', { ...cleanup, owned_process_groups: ownedPids, postgres_pid: postgresChild?.pid ?? null,
      retained_temporary_root: cleanup.temporary_removed ? null : temp ?? null, interrupt_signal: interruptSignal ?? null, elapsed_ms: Date.now() - startedAt }), remaining(3000), 'Cleanup receipt', false);
    if (!prepareOnly) await limited(() => artifact('summary.json', { complete: completed && cleanup.errors.length === 0, functional_integration_pass: completed && cleanup.errors.length === 0,
      release_pass: false, performance_pass: false, actual_default_cron_and_worker_started: fixtureStarted, optional_features: 'sale details ON; catalog/contributions/full-resolution absent/OFF',
      real_provider_calls: 0, real_saves_if_complete: completed ? 3 : null, result_completions_if_complete: completed ? 3 : null,
      limitations: ['Synthetic external transports and model responses', 'No hosted request, browser, camera, upload, recognition or simultaneous-device proof', 'No performance conclusion', 'Hosted detail activation, catalog and full-resolution remain unqualified'], elapsed_ms: Date.now() - startedAt }), remaining(3000), 'Summary receipt', false);
  } catch (error) { process.exitCode ||= 1; console.error(redact(error.message)); }
  process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm);
}
