#!/usr/bin/env node
/** Test-only, credential-free source benchmark. Owns every database it creates. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, mkdir, copyFile, writeFile, symlink, readdir } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
if (!args.includes('--ack-disposable-local-postgres')) throw Error('Explicit disposable acknowledgement required');
const out = option('--out');
if (!out || !isAbsolute(out)) throw Error('--out must be a new absolute private directory');
const frozenPrisma = option('--prisma-client-root');
if (!frozenPrisma || !isAbsolute(frozenPrisma)) throw Error('--prisma-client-root must name an isolated frozen client directory');
const toolRoot = process.env.INVENTORY_TEST_TOOLS_DIR;
if (!toolRoot) throw Error('Isolated INVENTORY_TEST_TOOLS_DIR required');
if (!process.version.startsWith('v22.')) throw Error('Run using the qualified Node 22 runtime');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireTools = createRequire(join(resolve(toolRoot), 'package.json'));
const requireDb = createRequire(join(repo, 'packages/database/package.json'));
const requireFront = createRequire(join(repo, 'frontend/nextjs-app/package.json'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireTools.resolve('embedded-postgres')).href);
const { Client } = requireTools('pg');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: tmpdir(), TMPDIR: tmpdir(),
  NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true' };
await mkdir(out, { mode: 0o700 });
const temp = await mkdtemp(join(tmpdir(), 'tk-intake-benchmark-'));
const schedulingDiagnostic = args.includes('--diagnostic-scheduling');
const startedAt = Date.now(), capMs = (schedulingDiagnostic ? 30 : 90) * 60 * 1000;
let cluster, admin, started = false;
const run = (command, commandArgs, options = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { cwd: options.cwd ?? repo, env: options.env ?? cleanEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; if (options.echo) process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { stderr += bytes; if (options.echo) process.stderr.write(bytes); });
  let killTimer;
  const timer = setTimeout(() => {
    // tsx launches a child Node process; terminate the entire owned process group.
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
  }, Math.max(1, Math.min(options.timeoutMs ?? capMs, capMs - (Date.now() - startedAt))));
  child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); reject(error); });
  child.once('close', code => { clearTimeout(timer); clearTimeout(killTimer); code === 0 ? resolveRun(stdout) : reject(Error(`${commandArgs[0]} failed (${code}): ${stderr.slice(-3000)}`)); });
});
const git = (...gitArgs) => run('/usr/bin/git', gitArgs);
const artifact = async (name, value) => writeFile(join(out, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
try {
  const refs = { A: (await git('rev-parse', `${option('--baseline', '60572cec')}^{commit}`)).trim(), B: (await git('rev-parse', `${option('--candidate', '31b86535')}^{commit}`)).trim() };
  const frozenClientFiles = [];
  async function clientLedger(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), name = join(prefix, entry.name);
      if (entry.isDirectory()) await clientLedger(path, name);
      else if (entry.isFile()) frozenClientFiles.push({ path: name, sha256: sha(await readFile(path)) });
    }
  }
  await clientLedger(frozenPrisma);
  frozenClientFiles.sort((a, b) => a.path.localeCompare(b.path));
  await artifact('prisma-client-files.json', frozenClientFiles);
  const smoke = args.includes('--smoke');
  const scenarios = option('--scenarios', schedulingDiagnostic ? 'idle,thumbnail' : 'idle,thumbnail,timeout,rate-limit').split(',');
  const sessions = option('--sessions', schedulingDiagnostic ? '3' : '1,3').split(',').map(Number);
  assert.ok(scenarios.every(x => ['idle', 'thumbnail', 'timeout', 'rate-limit'].includes(x)) && new Set(scenarios).size === scenarios.length);
  assert.ok(sessions.every(x => [1, 3].includes(x)) && new Set(sessions).size === sessions.length);
  if (schedulingDiagnostic) { assert.deepEqual(scenarios, ['idle', 'thumbnail']); assert.deepEqual(sessions, [3]); }
  const scriptPath = join(repo, 'frontend/nextjs-app/scripts/benchmark-staff-intake.ts');
  const protocol = { schema_version: 1, purpose: 'source DB regression; no browser, camera, upload or recognition latency claim', refs,
    node: process.version, host: { platform: platform(), arch: arch(), cpus: cpus().length, cpu_model: cpus()[0]?.model }, dependencies: { tsx: requireFront('tsx/package.json').version, sharp: requireFront('sharp/package.json').version, prisma: requireDb('prisma/package.json').version }, prisma_client_ledger_sha256: sha(JSON.stringify(frozenClientFiles)), prisma_schema_sha256: sha(await readFile(join(frozenPrisma, 'node_modules/.prisma/client/schema.prisma'))), scenarios, sessions, order: ['A', 'B', 'B', 'A'], warmups: smoke ? 1 : 5, measured: smoke ? 2 : 50,
    seed_units: smoke ? 40 : 2000, seed_pending: smoke ? 16 : 256, seed_completed: smoke ? 2 : 16,
    pool_connections: 8, provider_delay_ms: 250, larger_images: false, catalog: false, untimed_admission_probe: true, cap_ms: capMs,
    scheduling_diagnostic: schedulingDiagnostic, scheduling_instrumentation: schedulingDiagnostic ? { backend_pid_query_per_transaction: true, event_loop_tick_ms: 10, independent_observer_poll_ms: 10, observer_reuses_one_connection_budget: true, no_scheduling_adjustment: true } : null,
    p95_margin: { absolute_ms: 50, fraction: 0.1 }, smoke, script_sha256: sha(await readFile(scriptPath)), runner_sha256: sha(await readFile(fileURLToPath(import.meta.url))) };
  await writeFile(join(out, 'executed-runner.mjs'), await readFile(fileURLToPath(import.meta.url)), { mode: 0o600, flag: 'wx' });
  await writeFile(join(out, 'executed-child.ts'), await readFile(scriptPath), { mode: 0o600, flag: 'wx' });
  await artifact('protocol.json', protocol);
  await artifact('protocol-hash.json', { sha256: sha(Buffer.from(`${JSON.stringify(protocol, null, 2)}\n`)) });
  const sourcePaths = ['packages/database/src', 'packages/database/prisma', 'packages/database/package.json', 'packages/shared/src', 'packages/shared/package.json',
    'packages/ebay-sold-comps-v2/src', 'packages/ebay-sold-comps-v2/package.json', 'frontend/nextjs-app/lib', 'frontend/nextjs-app/constants', 'frontend/nextjs-app/pages/api/v2/admin/inventory/workspace.ts',
    'frontend/nextjs-app/tsconfig.json', 'frontend/nextjs-app/package.json', 'package.json', 'tsconfig.base.json'];
  const trees = {};
  for (const arm of ['A', 'B']) {
    const tree = join(temp, arm); await mkdir(tree); trees[arm] = tree;
    const archive = join(temp, `${arm}.tar`);
    await git('archive', '--format=tar', `--output=${archive}`, refs[arm], ...sourcePaths);
    await run('/usr/bin/tar', ['-xf', archive, '-C', tree]);
    await artifact(`source-${arm}.json`, { commit: refs[arm], archive_sha256: sha(await readFile(archive)), files: (await git('ls-tree', '-r', refs[arm], '--', ...sourcePaths)).trim().split('\n') });
    await symlink(join(repo, 'node_modules'), join(tree, 'node_modules'));
    for (const path of ['packages/database', 'packages/shared', 'packages/ebay-sold-comps-v2', 'frontend/nextjs-app']) {
      await symlink(join(repo, path, 'node_modules'), join(tree, path, 'node_modules'));
    }
    await mkdir(join(tree, 'frontend/nextjs-app/scripts'), { recursive: true });
    await copyFile(scriptPath, join(tree, 'frontend/nextjs-app/scripts/benchmark-staff-intake.ts'));
    const configPath = join(tree, 'frontend/nextjs-app/tsconfig.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.compilerOptions.paths['@prisma/client'] = [join(frozenPrisma, 'node_modules/@prisma/client')];
    await writeFile(configPath, JSON.stringify(config));
  }
  const listener = createServer(); await new Promise((resolveListen, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = listener.address().port; await new Promise(resolveClose => listener.close(resolveClose));
  const password = randomBytes(24).toString('hex');
  cluster = new EmbeddedPostgres({ databaseDir: join(temp, 'db'), user: 'postgres', password, port, persistent: true, createPostgresUser: false, initdbFlags: ['--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1', '-k', temp], onLog() {}, onError() {} });
  await cluster.initialise(); await cluster.start(); started = true;
  const url = name => `postgresql://postgres:${password}@127.0.0.1:${port}/${name}?connection_limit=8&pool_timeout=5`;
  admin = new Client({ connectionString: url('postgres') }); await admin.connect();
  const identity = (await admin.query("SELECT version() AS version, current_setting('server_encoding') AS encoding")).rows[0];
  assert.match(identity.version, /PostgreSQL 17\./); assert.equal(identity.encoding, 'UTF8'); await artifact('postgres.json', identity);
  await admin.query('CREATE DATABASE tk_intake_template');
  const childEnv = name => ({ ...cleanEnv, DATABASE_URL: url(name), TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION: '1', TK_BENCHMARK_OWNED_DATABASE: name });
  const schema = join(trees.A, 'packages/database/prisma/schema.prisma');
  const prismaCli = requireDb.resolve('prisma/build/index.js');
  await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], { env: childEnv('tk_intake_template') });
  const ledgerClient = new Client({ connectionString: url('tk_intake_template') }); await ledgerClient.connect();
  const ledger = async () => (await ledgerClient.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  const before = await ledger();
  await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], { env: childEnv('tk_intake_template') });
  assert.deepEqual(await ledger(), before); await artifact('migration-ledger.json', before); await ledgerClient.end();
  const invoke = (arm, dbName, config) => run(process.execPath, [requireFront.resolve('tsx/cli'), '--tsconfig', join(trees[arm], 'frontend/nextjs-app/tsconfig.json'), join(trees[arm], 'frontend/nextjs-app/scripts/benchmark-staff-intake.ts'), JSON.stringify({ ...config, observer_launch: { loader: pathToFileURL(requireFront.resolve('tsx')).href, tsconfig: join(trees[arm], 'frontend/nextjs-app/tsconfig.json') } })], { cwd: trees[arm], env: childEnv(dbName), echo: true });
  await invoke('A', 'tk_intake_template', { mode: 'seed', protocol, output: join(out, 'seed.json') });
  const blocks = [];
  for (const count of sessions) for (const scenario of scenarios) for (const [index, arm] of protocol.order.entries()) {
    if (Date.now() - startedAt >= capMs) throw Error(`${capMs / 60000}-minute cap reached; partial results retained`);
    const name = `tk_intake_${blocks.length}`, output = join(out, `block-${String(blocks.length).padStart(2, '0')}.json`);
    await admin.query(`CREATE DATABASE ${name} TEMPLATE tk_intake_template`);
    const block = { mode: 'measure', protocol, arm, scenario, sessions: count, index, output };
    console.log(JSON.stringify({ block: blocks.length, arm, scenario, sessions: count }));
    await invoke(arm, name, block);
    blocks.push(JSON.parse(await readFile(output, 'utf8')));
    // Only this runner's explicitly created database, after its child disconnected.
    await admin.query(`DROP DATABASE ${name}`);
  }
  const metrics = ['lease_ms', 'photo_verify_ms', 'save_ack_ms', 'save_tx_ms', 'queue_lock_ms'];
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] ?? null;
  const comparisons = [];
  for (const count of sessions) for (const scenario of scenarios) for (const metric of metrics) {
    const selected = blocks.filter(b => b.sessions === count && b.scenario === scenario);
    const stats = arm => { const values = selected.filter(b => b.arm === arm).flatMap(b => b.samples.filter(s => !s.warmup).map(s => s[metric])); return { n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values) }; };
    const A = stats('A'), B = stats('B'), margin = Math.max(50, .1 * A.p95);
    const repetitions = [[0, 1], [3, 2]].map(([a, b]) => {
      const av = percentile(selected.find(x => x.index === a).samples.filter(x => !x.warmup).map(x => x[metric]), .95);
      const bv = percentile(selected.find(x => x.index === b).samples.filter(x => !x.warmup).map(x => x[metric]), .95);
      return { baseline_p95: av, candidate_p95: bv, pass: bv - av <= Math.max(50, .1 * av) };
    });
    comparisons.push({ sessions: count, scenario, metric, A, B, margin_ms: margin, pass: B.p95 - A.p95 <= margin && repetitions.every(x => x.pass), repetitions });
  }
  const headroom = comparisons.filter(x => x.scenario !== 'idle').map(row => { const idle = comparisons.find(x => x.sessions === row.sessions && x.scenario === 'idle' && x.metric === row.metric); return { sessions: row.sessions, scenario: row.scenario, metric: row.metric, pass: !!idle && row.B.p95 - idle.B.p95 <= Math.max(50, .1 * idle.B.p95), idle_p95: idle?.B.p95 ?? null, loaded_p95: row.B.p95 }; });
  const completeMatrix = sessions.length === 2 && scenarios.length === 4;
  const result = { complete: true, complete_matrix: completeMatrix, smoke, scope: protocol.purpose, refs, elapsed_ms: Date.now() - startedAt,
    pass: !smoke && completeMatrix && comparisons.every(x => x.pass) && headroom.every(x => x.pass) && blocks.every(x => x.hard_gates_pass),
    diagnostic_timing_pass: schedulingDiagnostic && !smoke ? comparisons.every(x => x.pass) && headroom.every(x => x.pass) && blocks.every(x => x.hard_gates_pass) : null, comparisons, headroom,
    measured_saves: blocks.reduce((n, b) => n + b.samples.filter(x => !x.warmup).length, 0), missing_release_proof: ['real browser / camera', 'photo upload', 'recognition', 'iPhone / simultaneous staff', 'real provider variance'] };
  await artifact('summary.json', result); console.log(JSON.stringify({ complete: true, pass: result.pass, measured_saves: result.measured_saves, output: out }));
} catch (error) {
  await artifact('incomplete.json', { complete: false, error: String(error.message).replace(/postgresql:\/\/[^\s"']+/g, '[redacted-db-url]'), elapsed_ms: Date.now() - startedAt });
  throw error;
} finally {
  if (admin) await admin.end();
  if (started) await cluster.stop();
  await rm(temp, { recursive: true, force: true });
  console.log('Owned benchmark cluster and temporary source trees removed.');
}
