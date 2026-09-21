#!/usr/bin/env node
/** Changed-pagination split comparison. Frozen driver/role logic and failed studies remain untouched. Preparation is DB-free. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, mkdir, copyFile, writeFile, symlink, readdir, statfs } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute, relative } from 'node:path';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const prepareOnly = args.includes('--prepare-only');
const preflight = args.includes('--preflight');
if (preflight) throw Error('This changed-source qualification authorizes one full comparison, no extra preflight');
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
const { Client } = requireTools('pg');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ...(process.env.HOME ? { HOME: process.env.HOME } : {}), TMPDIR: tmpdir(),
  NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true' };
await mkdir(out, { mode: 0o700 });
let temp;
const schedulingDiagnostic = true;
const requiredDisk = 2 * 1024 ** 3;
const assertDisk = async () => { const fs = await statfs(out); assert.ok(fs.bavail * fs.bsize >= requiredDisk, 'At least 2 GiB free required before source export/DB/block creation'); };
const startedAt = Date.now(), capMs = (schedulingDiagnostic ? 30 : 90) * 60 * 1000, cleanupReserveMs = 30000, workDeadline = startedAt + capMs - cleanupReserveMs;
const processes = new Map(), commandPids = [], clients = new Set(), stopController = new AbortController();
let admin, postgresChild, postgresClosed, interruptSignal, abortReason;
const signalGroup = (pid, signal) => { if (pid) { try { process.kill(-pid, signal); } catch {} } };
const groupAlive = pid => { if (!pid) return false; try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const waitGroupStopped = async (pid, milliseconds) => { const until = Date.now() + Math.max(0, milliseconds); while (groupAlive(pid) && Date.now() < until) await new Promise(done => setTimeout(done, 10)); return !groupAlive(pid); };
const killOwned = () => { for (const pid of processes.keys()) signalGroup(pid, 'SIGTERM'); };
const interruptPostgres = () => signalGroup(postgresChild?.pid, 'SIGINT');
const abort = (reason = 'Owned comparison aborted') => { abortReason ??= reason; stopController.abort(); killOwned(); interruptPostgres(); };
const guard = () => { if (stopController.signal.aborted) throw Error(abortReason); if (Date.now() >= workDeadline) { abort('30-minute overall deadline: final 30 seconds reserved for owned cleanup'); throw Error(abortReason); } };
const interrupt = signal => { interruptSignal ??= signal; process.exitCode = interruptSignal === 'SIGINT' ? 130 : 143; abort(`Comparison interrupted by ${interruptSignal}`); };
const onSigint = () => interrupt('SIGINT'), onSigterm = () => interrupt('SIGTERM');
const bounded = async operation => {
  guard(); let timer, onAbort;
  try { return await Promise.race([Promise.resolve().then(() => { guard(); return operation(); }), new Promise((_, reject) => {
    onAbort = () => reject(Error(abortReason)); stopController.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => abort('30-minute overall deadline: cleanup reserve begins'), Math.max(1, workDeadline - Date.now()));
  })]); } finally { clearTimeout(timer); stopController.signal.removeEventListener('abort', onAbort); }
};
const run = (command, commandArgs, options = {}) => { guard(); return new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { cwd: options.cwd ?? repo, env: options.env ?? cleanEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) { processes.set(child.pid, child); commandPids.push(child.pid); }
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; if (options.echo) process.stdout.write(bytes); });
  child.stderr.on('data', bytes => { stderr += bytes; if (options.echo) process.stderr.write(bytes); });
  let killTimer;
  const requestStop = () => {
    // tsx launches a child Node process; terminate the entire owned process group.
    signalGroup(child.pid, 'SIGTERM');
    killTimer ??= setTimeout(() => signalGroup(child.pid, 'SIGKILL'), 5000);
    reject(Error(abortReason ?? 'Owned command deadline reached; cleanup required'));
  };
  const timer = setTimeout(requestStop, Math.max(1, Math.min(options.timeoutMs ?? capMs, workDeadline - Date.now())));
  stopController.signal.addEventListener('abort', requestStop, { once: true });
  const finished = () => { clearTimeout(timer); clearTimeout(killTimer); stopController.signal.removeEventListener('abort', requestStop); };
  child.once('error', error => { finished(); if (!groupAlive(child.pid)) processes.delete(child.pid); reject(error); });
  child.once('close', async code => {
    finished();
    if (code !== 0 || stopController.signal.aborted) {
      if (!groupAlive(child.pid)) processes.delete(child.pid);
      reject(Error(`${commandArgs[0]} failed (${code}): ${abortReason ?? ''} ${stderr.replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]').slice(-3000)}`)); return;
    }
    if (groupAlive(child.pid)) { signalGroup(child.pid, 'SIGTERM'); if (!await waitGroupStopped(child.pid, 5000)) { signalGroup(child.pid, 'SIGKILL'); await waitGroupStopped(child.pid, 5000); } }
    if (groupAlive(child.pid)) { reject(Error(`Owned command group ${child.pid} remains; preserve temporary data`)); return; }
    processes.delete(child.pid);
    code === 0 && !stopController.signal.aborted ? resolveRun(stdout) : reject(Error(`${commandArgs[0]} failed (${code}): ${abortReason ?? ''} ${stderr.replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]').slice(-3000)}`));
  });
}); };
const git = (...gitArgs) => run('/usr/bin/git', gitArgs);
const artifact = async (name, value) => writeFile(join(out, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
const client = connectionString => { const value = new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 30000 }); clients.add(value); value.on('error', error => abort(`Owned administrative connection failed: ${error.message}`)); return value; };
const closeClient = async value => { await bounded(() => value.end()); clients.delete(value); };
const waitClosed = async (child, closed, milliseconds) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  let timer; try { return await Promise.race([closed.then(() => true), new Promise(resolveWait => { timer = setTimeout(() => resolveWait(false), Math.max(1, milliseconds)); })]); } finally { clearTimeout(timer); }
};
const cleanup = { attempted: false, stopped: false, process_groups_stopped: false, removed: false, errors: [] };
const limited = async (operation, milliseconds, label) => {
  let timer; try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} exceeded cleanup budget`)), Math.max(1, milliseconds)); })]); } finally { clearTimeout(timer); }
};
process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
const watchdog = setTimeout(() => abort('30-minute overall deadline: cleanup reserve begins'), Math.max(1, workDeadline - Date.now()));
try {
  const preregPath = join(repo, 'docs/plans/2026-09-16-intake-pagination-comparison-protocol.json');
  const preregBytes = await readFile(preregPath);
  const prereg = JSON.parse(preregBytes);
  assert.equal(prereg.cap_ms, capMs); assert.equal(prereg.cleanup_reserve_ms, cleanupReserveMs);
  assert.equal(prereg.work_cap_ms, capMs - cleanupReserveMs);
  const refs = prereg.refs;
  const sourcePaths = prereg.source_paths;
  assert.deepEqual(refs, { A: '12e13992cd341eeea96dbe0955cc4dbfba67bc1d', B: '80e75b1e26753117b5a0bd1feefa0ee181695454' });
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
  for (const [name, expected] of Object.entries(prereg.frozen_script_sha256)) assert.equal(scriptHashes[name], expected, 'Frozen harness bytes must not drift');
  const runtimeDiff = (await git('diff', '--name-only', refs.A, refs.B, '--', ...sourcePaths)).trim().split('\n').filter(Boolean);
  assert.deepEqual(runtimeDiff, prereg.runtime_changed_paths, 'Only the qualified reader may differ in exported runtime inputs');
  const ts = requireFront('typescript');
  const normalizedBlocks = source => new Map([...source.matchAll(/^(model|enum) (\w+) \{\n[\s\S]*?^\}/gm)].map(match => [match[2], match[0].split('\n').map(line => line.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n')]));
  const frozenBlocks = normalizedBlocks(await readFile(join(frozenPrisma, 'node_modules/.prisma/client/schema.prisma'), 'utf8'));
  const audits = [];
  for (const arm of ['A', 'B']) {
    const files = new Set((await git('ls-tree', '-r', '--name-only', refs[arm], '--', ...sourcePaths)).trim().split('\n'));
    const scriptsByPath = new Map(await Promise.all(scripts.map(async name => [`frontend/nextjs-app/scripts/${name}`, await readFile(join(repo, 'frontend/nextjs-app/scripts', name), 'utf8')])));
    const contents = new Map(scriptsByPath), readSource = async path => { if (!contents.has(path)) { assert.ok(files.has(path), `Unexported source: ${path}`); contents.set(path, await git('show', `${refs[arm]}:${path}`)); } return contents.get(path); };
    const schemaBytes = await readSource('packages/database/prisma/schema.prisma'); assert.equal(sha(schemaBytes), prereg.schema_sha256);
    const blocks = normalizedBlocks(schemaBytes), models = [];
    for (const model of prereg.client_compatibility_models) { assert.ok(frozenBlocks.has(model)); assert.equal(blocks.get(model), frozenBlocks.get(model), `Frozen active model differs: ${model}`); models.push({ model, normalized_sha256: sha(blocks.get(model)) }); }
    const migrationFiles = [...files].filter(path => path.startsWith('packages/database/prisma/migrations/') && path.endsWith('/migration.sql')); assert.equal(migrationFiles.length, prereg.migration_count);
    assert.equal(sha(await readSource('packages/database/src/cardPlatformV2.ts')), prereg.writer_sha256[arm]);
    assert.equal(sha(await readSource('packages/database/src/inventoryWorkflowV2Read.ts')), prereg.reader_sha256[arm]);
    const resolveRelative = (from, specifier) => {
      const path = relative(repo, resolve(repo, dirname(from), specifier));
      const candidates = [path, ...['.ts', '.tsx', '.mjs', '.js', '.json', '.d.ts'].map(ext => path + ext), ...['index.ts', 'index.tsx', 'index.mjs', 'index.js', 'index.d.ts'].map(index => join(path, index))];
      if (/\.m?js$/.test(path)) candidates.push(path.replace(/\.m?js$/, '.ts'));
      const selected = candidates.find(candidate => files.has(candidate) || scriptsByPath.has(candidate));
      assert.ok(selected, `Unexported relative application import: ${from} -> ${specifier}`); return selected;
    };
    const visited = new Set(), dependencies = new Set(), queue = ['frontend/nextjs-app/scripts/benchmark-staff-intake-split-driver.ts', 'frontend/nextjs-app/scripts/benchmark-staff-intake-split-role.ts'];
    while (queue.length) {
      const path = queue.pop(); if (visited.has(path)) continue; visited.add(path);
      const source = await readSource(path); if (path.endsWith('.json')) continue;
      for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
        const specifier = imported.fileName;
        if (specifier.startsWith('.')) queue.push(resolveRelative(path, specifier));
        else if (specifier.startsWith('@tenkings/')) { const target = prereg.workspace_aliases[specifier]; assert.ok(target && files.has(target), `Unpinned workspace import: ${path} -> ${specifier}`); queue.push(target); }
        else dependencies.add(specifier);
      }
    }
    audits.push({ arm, commit: refs[arm], schema_sha256: sha(schemaBytes), migration_count: migrationFiles.length, active_model_compatibility: models,
      frozen_client_added_models_unused: [...blocks.keys()].filter(model => !frozenBlocks.has(model)),
      imported_source_ledger: [...visited].sort().map(path => ({ path, sha256: sha(contents.get(path)) })), external_dependencies: [...dependencies].sort(),
      workspace_resolution: prereg.workspace_aliases, v4_and_contribution_flags: Object.fromEntries(prereg.new_features_off.map(flag => { assert.equal(cleanEnv[flag], undefined); return [flag, 'absent']; })) });
  }
  await artifact('source-compatibility.json', { runtime_diff: runtimeDiff, audits, scope: 'Static conservative import closure includes type/dynamic literal imports; no application module execution or DB. Frozen-client compatibility established for exercised models only.' });
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
  guard();
  if (prepareOnly) { console.log(JSON.stringify({ prepared: true, database_started: false, source_trees_exported: false, measured_saves: 0, output: out })); }
  else {
  await assertDisk(); temp = await mkdtemp(join(tmpdir(), 'tk-intake-split-benchmark-'));

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
    config.compilerOptions.paths['@tenkings/card-catalog-evidence'] = ['../../packages/card-catalog-evidence/src/index.mjs'];
    await writeFile(configPath, JSON.stringify(config));
  }
  const listener = createServer();
  let port;
  try { await bounded(() => new Promise((resolveListen, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolveListen))); port = listener.address().port; }
  finally { if (listener.listening) await new Promise(resolveClose => listener.close(resolveClose)); }
  assert.equal(platform(), 'darwin'); assert.equal(arch(), 'arm64');
  const binaries = await import(pathToFileURL(requireTools.resolve('@embedded-postgres/darwin-arm64')).href);
  const password = randomBytes(24).toString('hex'), passwordFile = join(temp, 'owned-password'), pgEnv = { ...cleanEnv, LC_MESSAGES: 'en_US.UTF-8' };
  await writeFile(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
  try { await run(binaries.initdb, [`--pgdata=${join(temp, 'db')}`, '--auth=password', '--username=postgres', `--pwfile=${passwordFile}`, '--lc-messages=en_US.UTF-8', '--encoding=UTF8'], { env: pgEnv }); }
  finally { await rm(passwordFile, { force: true }); }
  guard();
  let ready, rejectReady, pgErrors = '';
  const readyPromise = new Promise((resolveReady, reject) => { ready = resolveReady; rejectReady = reject; });
  void readyPromise.catch(() => {}); // A deadline immediately after spawn must not leave an unobserved readiness rejection.
  postgresChild = spawn(binaries.postgres, ['-D', join(temp, 'db'), '-p', String(port), '-h', '127.0.0.1', '-k', temp], { env: pgEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  postgresClosed = new Promise(resolveClose => { postgresChild.once('close', code => { rejectReady(Error(`Owned PostgreSQL exited (${code}): ${pgErrors.slice(-1000)}`)); resolveClose(); }); postgresChild.once('error', error => { rejectReady(error); resolveClose(); }); });
  postgresChild.stderr.on('data', bytes => { pgErrors = (pgErrors + bytes).slice(-5000); if (pgErrors.includes('database system is ready to accept connections')) ready(); });
  await bounded(() => readyPromise); guard();
  await artifact('owned-process.json', { runner_pid: process.pid, postgres_pid: postgresChild.pid, temporary_root: temp });
  const url = name => `postgresql://postgres:${password}@127.0.0.1:${port}/${name}?connection_limit=8&pool_timeout=5`;
  admin = client(url('postgres')); await bounded(() => admin.connect());
  const identity = (await bounded(() => admin.query("SELECT version() AS version, current_setting('server_encoding') AS encoding"))).rows[0];
  assert.match(identity.version, /PostgreSQL 17\./); assert.equal(identity.encoding, 'UTF8'); await artifact('postgres.json', identity);
  await bounded(() => admin.query('CREATE DATABASE tk_intake_template'));
  const childEnv = name => ({ ...cleanEnv, DATABASE_URL: url(name), TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION: '1', TK_BENCHMARK_OWNED_DATABASE: name });
  const schema = join(trees.A, 'packages/database/prisma/schema.prisma');
  const prismaCli = requireDb.resolve('prisma/build/index.js');
  await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], { env: childEnv('tk_intake_template') });
  const ledgerClient = client(url('tk_intake_template')); await bounded(() => ledgerClient.connect());
  const ledger = async () => (await bounded(() => ledgerClient.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name'))).rows;
  const before = await ledger();
  await run(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], { env: childEnv('tk_intake_template') });
  assert.deepEqual(await ledger(), before); await artifact('migration-ledger.json', before); await closeClient(ledgerClient);
  const invoke = (arm, dbName, config) => run(process.execPath, [requireFront.resolve('tsx/cli'), '--tsconfig', join(trees[arm], 'frontend/nextjs-app/tsconfig.json'), join(trees[arm], 'frontend/nextjs-app/scripts/benchmark-staff-intake-split-driver.ts'), JSON.stringify({ ...config, launch: { loader: pathToFileURL(requireFront.resolve('tsx')).href, tsconfig: join(trees[arm], 'frontend/nextjs-app/tsconfig.json') } })], { cwd: trees[arm], env: childEnv(dbName), echo: true });
  await closeClient(admin); admin = null;
  await invoke('A', 'tk_intake_template', { mode: 'seed', protocol, output: join(out, 'seed.json') });
  admin = client(url('postgres')); await bounded(() => admin.connect());
  const blocks = [];
  for (const count of sessions) for (const scenario of scenarios) for (const [index, arm] of protocol.order.entries()) {
    guard();
    const name = `tk_intake_${blocks.length}`, output = join(out, `block-${String(blocks.length).padStart(2, '0')}.json`);
    await assertDisk();
    await bounded(() => admin.query(`CREATE DATABASE ${name} TEMPLATE tk_intake_template`));
    await closeClient(admin); admin = null;
    const block = { mode: 'measure', protocol, arm, scenario, sessions: count, index, output };
    console.log(JSON.stringify({ block: blocks.length, arm, scenario, sessions: count }));
    await invoke(arm, name, block);
    blocks.push(JSON.parse(await readFile(output, 'utf8')));
    admin = client(url('postgres')); await bounded(() => admin.connect());
    // Only this runner's explicitly created database, after its child disconnected.
    await bounded(() => admin.query(`DROP DATABASE ${name}`));
  }
  guard();
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
  abort(error.message);
  try { await limited(() => artifact('incomplete.json', { complete: false, error: String(error.message).replace(/postgresql:\/\/[^\s"']+/g, '[redacted-db-url]'), interrupt_signal: interruptSignal ?? null, elapsed_ms: Date.now() - startedAt }), Math.min(3000, startedAt + capMs - Date.now()), 'Incomplete receipt'); }
  catch (receiptError) { cleanup.errors.push(receiptError.message); }
  if (!interruptSignal) { process.exitCode = 1; console.error(String(error.message).replace(/postgresql:\/\/[^\s"']+/g, '[redacted-db-url]')); }
} finally {
  clearTimeout(watchdog); killOwned(); interruptPostgres();
  const cleanupDeadline = Math.min(startedAt + capMs, Date.now() + cleanupReserveMs), remaining = maximum => Math.max(1, Math.min(maximum, cleanupDeadline - Date.now()));
  await Promise.allSettled([...clients].map(async value => { try { await limited(() => value.end(), remaining(3000), 'Administrative disconnect'); clients.delete(value); } catch (error) { cleanup.errors.push(error.message); } }));
  await Promise.allSettled([...processes].map(async ([pid, child]) => {
    if (!await waitGroupStopped(pid, remaining(5000))) { signalGroup(pid, 'SIGKILL'); await waitGroupStopped(pid, remaining(5000)); }
    if (groupAlive(pid)) { cleanup.errors.push(`Owned command group ${pid} remains; preserve data`); child.unref(); child.stdout?.destroy(); child.stderr?.destroy(); }
    else processes.delete(pid);
  }));
  cleanup.process_groups_stopped = processes.size === 0;
  if (postgresChild) {
    cleanup.attempted = true;
    const closed = await waitClosed(postgresChild, postgresClosed, remaining(10000));
    cleanup.stopped = closed && !groupAlive(postgresChild.pid);
    if (!cleanup.stopped) { signalGroup(postgresChild.pid, 'SIGKILL'); const closedAfterKill = await waitClosed(postgresChild, postgresClosed, remaining(5000)); cleanup.stopped = closedAfterKill && await waitGroupStopped(postgresChild.pid, remaining(1000)); }
    if (!cleanup.stopped) { cleanup.errors.push('Owned PostgreSQL remains; preserve data'); postgresChild.unref(); postgresChild.stderr?.destroy(); }
  }
  if (temp && cleanup.process_groups_stopped && (!postgresChild || cleanup.stopped) && cleanup.errors.length === 0) {
    try { await limited(() => rm(temp, { recursive: true, force: true }), remaining(5000), 'Temporary-directory removal'); cleanup.removed = true; }
    catch (error) { cleanup.errors.push(error.message); }
  }
  if (!prepareOnly || interruptSignal || cleanup.errors.length) {
    try { await limited(() => artifact('cleanup.json', { ...cleanup, interrupt_signal: interruptSignal ?? null, command_process_groups: commandPids, postgres_pid: postgresChild?.pid ?? null, retained_temporary_root: cleanup.removed ? null : temp ?? null, elapsed_ms: Date.now() - startedAt }), remaining(3000), 'Cleanup receipt'); }
    catch (error) { cleanup.errors.push(error.message); }
    console.log(JSON.stringify({ cleanup }));
  }
  if (cleanup.errors.length && !interruptSignal) process.exitCode = 1;
  process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm);
}
