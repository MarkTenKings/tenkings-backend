#!/usr/bin/env node
/** New split-process test harness; prepare-only is DB-free. Original failed harness remains untouched. Owns every database it creates. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, mkdir, copyFile, writeFile, symlink, readdir, statfs } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const prepareOnly = args.includes('--prepare-only');
const preflight = args.includes('--preflight');
if (!prepareOnly && !preflight && !args.includes('--run-approved-split-diagnostic')) throw Error('Use --prepare-only; execution requires coordinating-agent protocol/hash review');
if (!prepareOnly && !args.includes('--ack-disposable-local-postgres')) throw Error('Explicit disposable acknowledgement required');
if ([prepareOnly, preflight, args.includes('--run-approved-split-diagnostic')].filter(Boolean).length !== 1) throw Error('Choose exactly one mode');
for (const flag of ['--baseline', '--candidate', '--sessions', '--scenarios', '--smoke', '--diagnostic-scheduling']) if (args.includes(flag)) throw Error('Frozen split protocol forbids workload/source overrides');
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
const cleanEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ...(process.env.HOME ? { HOME: process.env.HOME } : {}), TMPDIR: tmpdir(),
  NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true' };
await mkdir(out, { mode: 0o700 });
let temp;
const schedulingDiagnostic = true;
const requiredDisk = 2 * 1024 ** 3;
const assertDisk = async () => { const fs = await statfs(out); assert.ok(fs.bavail * fs.bsize >= requiredDisk, 'At least 2 GiB free required before source export/DB/block creation'); };
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
  const preregPath = join(repo, 'docs/plans/2026-09-16-intake-split-process-protocol.json');
  const preregBytes = await readFile(preregPath);
  const prereg = JSON.parse(preregBytes);
  const refs = prereg.refs;
  assert.deepEqual(refs, { A: '60572cec895ad63d4ab826cd366f6475b04e725a', B: '31b8653559d8553208de8591f2d30c419642953a' });
  for (const ref of Object.values(refs)) assert.equal((await git('rev-parse', `${ref}^{commit}`)).trim(), ref);
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
  const smoke = preflight;
  const scenarios = ['idle', 'thumbnail'], sessions = [3];
  const scripts = ['benchmark-staff-intake-split-driver.ts', 'benchmark-staff-intake-split-role.ts', 'benchmark-staff-intake-split-ipc.ts'];
  const scriptHashes = {};
  for (const name of scripts) { const bytes = await readFile(join(repo, 'frontend/nextjs-app/scripts', name)); scriptHashes[name] = sha(bytes); await writeFile(join(out, `executed-${name}`), bytes, { mode: 0o600, flag: 'wx' }); }
  assert.equal(sha(JSON.stringify(frozenClientFiles)), prereg.frozen_client_ledger_sha256, 'Exact original frozen client required');
  const protocol = { ...prereg, node: process.version, host: { platform: platform(), arch: arch(), cpus: cpus().length, cpu_model: cpus()[0]?.model },
    dependencies: { tsx: requireFront('tsx/package.json').version, sharp: requireFront('sharp/package.json').version, prisma: requireDb('prisma/package.json').version },
    prisma_client_ledger_sha256: sha(JSON.stringify(frozenClientFiles)), prisma_schema_sha256: sha(await readFile(join(frozenPrisma, 'node_modules/.prisma/client/schema.prisma'))),
    warmups: smoke ? 1 : 5, measured: smoke ? 2 : 50, seed_units: smoke ? 40 : 2000, seed_pending: smoke ? 16 : 256, seed_completed: smoke ? 2 : 16,
    smoke, cap_ms: capMs, script_sha256: scriptHashes, runner_sha256: sha(await readFile(fileURLToPath(import.meta.url))), preregistration_sha256: sha(preregBytes),
    deployment_receipt_sha256: sha(await readFile(join(repo, prereg.deployment_receipt))) };
  assert.equal(protocol.dependencies.prisma, '5.22.0'); assert.equal(protocol.dependencies.sharp, '0.33.5');
  await writeFile(join(out, 'executed-runner.mjs'), await readFile(fileURLToPath(import.meta.url)), { mode: 0o600, flag: 'wx' });
  await writeFile(join(out, 'preregistration.json'), preregBytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(out, 'function-descriptors.json'), await readFile(join(repo, prereg.deployment_receipt)), { mode: 0o600, flag: 'wx' });
  await artifact('protocol.json', protocol);
  await artifact('protocol-hash.json', { sha256: sha(Buffer.from(`${JSON.stringify(protocol, null, 2)}\n`)) });
  if (prepareOnly) { console.log(JSON.stringify({ prepared: true, database_started: false, source_trees_exported: false, measured_saves: 0, output: out })); }
  else {
  await assertDisk(); temp = await mkdtemp(join(tmpdir(), 'tk-intake-split-benchmark-'));
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
    for (const name of scripts) await copyFile(join(repo, 'frontend/nextjs-app/scripts', name), join(tree, 'frontend/nextjs-app/scripts', name));
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
  const invoke = (arm, dbName, config) => run(process.execPath, [requireFront.resolve('tsx/cli'), '--tsconfig', join(trees[arm], 'frontend/nextjs-app/tsconfig.json'), join(trees[arm], 'frontend/nextjs-app/scripts/benchmark-staff-intake-split-driver.ts'), JSON.stringify({ ...config, launch: { loader: pathToFileURL(requireFront.resolve('tsx')).href, tsconfig: join(trees[arm], 'frontend/nextjs-app/tsconfig.json') } })], { cwd: trees[arm], env: childEnv(dbName), echo: true });
  await admin.end(); admin = null;
  await invoke('A', 'tk_intake_template', { mode: 'seed', protocol, output: join(out, 'seed.json') });
  admin = new Client({ connectionString: url('postgres') }); await admin.connect();
  const blocks = [];
  for (const count of sessions) for (const scenario of scenarios) for (const [index, arm] of protocol.order.entries()) {
    if (Date.now() - startedAt >= capMs) throw Error(`${capMs / 60000}-minute cap reached; partial results retained`);
    const name = `tk_intake_${blocks.length}`, output = join(out, `block-${String(blocks.length).padStart(2, '0')}.json`);
    await assertDisk();
    await admin.query(`CREATE DATABASE ${name} TEMPLATE tk_intake_template`);
    await admin.end(); admin = null;
    const block = { mode: 'measure', protocol, arm, scenario, sessions: count, index, output };
    console.log(JSON.stringify({ block: blocks.length, arm, scenario, sessions: count }));
    await invoke(arm, name, block);
    blocks.push(JSON.parse(await readFile(output, 'utf8')));
    admin = new Client({ connectionString: url('postgres') }); await admin.connect();
    // Only this runner's explicitly created database, after its child disconnected.
    await admin.query(`DROP DATABASE ${name}`);
  }
  const metrics = [...prereg.legacy_gate_metrics, ...prereg.additional_gate_metrics];
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
    pass: false,
    legacy_timing_pass: !smoke && comparisons.filter(x => prereg.legacy_gate_metrics.includes(x.metric)).every(x => x.pass) && headroom.filter(x => prereg.legacy_gate_metrics.includes(x.metric)).every(x => x.pass) && blocks.every(x => x.hard_gates_pass),
    photo_wall_pass: !smoke && comparisons.filter(x => x.metric === 'photo_wall_ms').every(x => x.pass) && headroom.filter(x => x.metric === 'photo_wall_ms').every(x => x.pass),
    diagnostic_timing_pass: schedulingDiagnostic && !smoke ? comparisons.every(x => x.pass) && headroom.every(x => x.pass) && blocks.every(x => x.hard_gates_pass) : null, comparisons, headroom,
    measured_saves: blocks.reduce((n, b) => n + b.samples.filter(x => !x.warmup).length, 0), missing_release_proof: ['real browser / camera', 'photo upload', 'recognition', 'iPhone / simultaneous staff', 'real provider variance'] };
  assert.equal(result.measured_saves, smoke ? 48 : 1200);
  await artifact('summary.json', result); console.log(JSON.stringify({ complete: true, pass: result.pass, measured_saves: result.measured_saves, output: out }));
  }
} catch (error) {
  await artifact('incomplete.json', { complete: false, error: String(error.message).replace(/postgresql:\/\/[^\s"']+/g, '[redacted-db-url]'), elapsed_ms: Date.now() - startedAt });
  throw error;
} finally {
  if (admin) await admin.end();
  if (started) await cluster.stop();
  if (temp) { await rm(temp, { recursive: true, force: true }); console.log('Owned split benchmark cluster and temporary source trees removed.'); }
}
