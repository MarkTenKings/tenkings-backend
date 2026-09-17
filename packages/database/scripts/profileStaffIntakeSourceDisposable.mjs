#!/usr/bin/env node
/** New source-profile tool. Preparation does not export trees or start PostgreSQL. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile, mkdir, writeFile, symlink, readdir, statfs } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute, basename } from 'node:path';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2), option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const prepare = args.includes('--prepare-only'), execute = args.includes('--run-coordinated-profile');
assert.notEqual(prepare, execute, 'Choose prepare-only or coordinator-released profile');
if (execute) assert.ok(args.includes('--ack-disposable-local-postgres'));
const out = option('--out'), frozen = option('--prisma-client-root');
assert.ok(out && isAbsolute(out) && frozen && isAbsolute(frozen), 'New absolute output and frozen-client paths required');
assert.ok(process.version.startsWith('v22.'));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), reqFront = createRequire(join(repo, 'frontend/nextjs-app/package.json')), reqDb = createRequire(join(repo, 'packages/database/package.json'));
const ts = reqFront('typescript'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const childFile = 'profile-staff-intake-source.ts', childPath = join(repo, 'frontend/nextjs-app/scripts', childFile), seedPath = join(repo, 'frontend/nextjs-app/scripts/benchmark-staff-intake.ts');
const cleanEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, ...(process.env.HOME ? { HOME: process.env.HOME } : {}), TMPDIR: tmpdir(), NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', AWS_EC2_METADATA_DISABLED: 'true' };
const began = Date.now(), cap = 600000, workCap = cap - 30000, processes = new Map(), stopController = new AbortController(); let expired = false, temp, postgresChild, postgresClosed, admin, watchdog, diskMonitor, diskFailure, interruptSignal;
const guard = () => { if (interruptSignal) throw Error(`Source profile interrupted by ${interruptSignal}; owned cleanup required`); if (expired || Date.now() - began >= workCap) { expired = true; throw Error('Source-profile work deadline reached; final 30 seconds reserved for owned cleanup within 10-minute cap'); } };
const killOwned = () => { for (const pid of processes.keys()) { try { process.kill(-pid, 'SIGTERM'); } catch {} } };
const interruptPostgres = () => { if (postgresChild?.pid) { try { process.kill(-postgresChild.pid, 'SIGINT'); } catch {} } };
const abort = () => { expired = true; stopController.abort(); killOwned(); interruptPostgres(); };
const interrupt = signal => { interruptSignal ??= signal; process.exitCode = interruptSignal === 'SIGINT' ? 130 : 143; abort(); };
const onSigint = () => interrupt('SIGINT'), onSigterm = () => interrupt('SIGTERM');
const bounded = async promise => { guard(); let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { abort(); reject(Error('Source-profile work deadline reached; cleanup reserve begins')); }, Math.max(1, workCap - (Date.now() - began))); })]); } finally { clearTimeout(timer); } };
const run = (command, commandArgs, options = {}) => { guard(); return new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { cwd: options.cwd ?? repo, env: options.env ?? cleanEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); if (child.pid) processes.set(child.pid, child);
  let stdout = '', stderr = '', killTimer;
  child.stdout.on('data', b => { stdout += b; if (options.echo) process.stdout.write(b); }); child.stderr.on('data', b => { stderr = (stderr + b).slice(-10000); });
  const requestStop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000); };
  const timer = setTimeout(requestStop, Math.max(1, Math.min(options.timeout ?? workCap, workCap - (Date.now() - began))));
  stopController.signal.addEventListener('abort', requestStop, { once: true });
  const finished = () => { clearTimeout(timer); clearTimeout(killTimer); stopController.signal.removeEventListener('abort', requestStop); processes.delete(child.pid); };
  child.once('error', error => { finished(); reject(error); });
  child.once('close', code => { finished(); code === 0 && !interruptSignal ? resolveRun(stdout) : reject(Error(`Owned command failed (${code}${interruptSignal ? `, ${interruptSignal}` : ''}): ${stderr.replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]').slice(-3000)}`)); });
}); };
const git = (...a) => run('/usr/bin/git', a), artifact = (name, value) => writeFile(join(out, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const diskSamples = [];
const disk = async (launch = false) => { const fs = await statfs(out), bytes = fs.bavail * fs.bsize; diskSamples.push({ at_ms: Date.now(), available_bytes: bytes, launch }); assert.ok(bytes >= 2147483648 + (launch ? 268435456 : 0), launch ? 'Launch requires 2 GiB plus 256 MiB reserve' : 'At least 2 GiB free required; disk floor is not relaxed'); };
const waitClosed = async (child, promise, ms) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  let timer; try { return await Promise.race([promise.then(() => true), new Promise(resolveWait => { timer = setTimeout(() => resolveWait(false), ms); })]); } finally { clearTimeout(timer); }
};
await mkdir(out, { mode: 0o700 });
const overlay = (source, path) => {
  assert.ok(!source.includes('__TK_INTAKE_SOURCE_PROFILE__'), 'Source must be uninstrumented');
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true), edits = [], found = [];
  const wrap = (fn, metadata) => {
    const name = fn.name.text, token = '__tkSourceProfileBoundary';
    edits.push([fn.body.getStart(sf) + 1, `\nconst ${token} = (globalThis as any).__TK_INTAKE_SOURCE_PROFILE__?.begin(${JSON.stringify(name)}, ${metadata}); try {\n`]);
    edits.push([fn.body.end - 1, `\n} finally { (globalThis as any).__TK_INTAKE_SOURCE_PROFILE__?.end(${token}); }\n`]); found.push(name);
  };
  for (const fn of sf.statements.filter(ts.isFunctionDeclaration)) {
    if (!fn.body || !fn.name) continue;
    const name = fn.name.text;
    if (name === 'recordStaffInventoryV2' || name === 'readWorkflowHistoryV2') wrap(fn, '{}');
    if (name === 'recordInventoryWorkflowEventV2') wrap(fn, '{ event_kind: (input as any)?.event_kind ?? null }');
    if (name === 'replayWorkflowEventsV2') wrap(fn, '{ event_count: events.length }');
    if (name === 'verifyWorkflowRowV2') { edits.push([fn.body.getStart(sf) + 1, '\n(globalThis as any).__TK_INTAKE_SOURCE_PROFILE__?.count("verifyWorkflowRowV2");\n']); found.push(name); }
    if (name === 'exportInventoryWorkflowPageV2') {
      const selected = fn.body.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'selected'));
      assert.ok(selected); const token = '__tkSourcePageValidation';
      edits.push([selected.getStart(sf), `const ${token} = (globalThis as any).__TK_INTAKE_SOURCE_PROFILE__?.begin("verify_and_parse_history_page", { row_count: rows.length, after_sequence: after }); try {\n`]);
      edits.push([fn.body.end - 1, `\n} finally { (globalThis as any).__TK_INTAKE_SOURCE_PROFILE__?.end(${token}); }\n`]); found.push('verify_and_parse_history_page');
    }
  }
  const expected = path.endsWith('cardPlatformV2.ts') ? ['recordStaffInventoryV2', 'recordInventoryWorkflowEventV2'] : path.endsWith('inventoryWorkflowV2Read.ts') ? ['readWorkflowHistoryV2', 'verifyWorkflowRowV2', 'verify_and_parse_history_page'] : ['replayWorkflowEventsV2'];
  assert.deepEqual(found.sort(), expected.sort());
  let text = source; for (const [offset, insert] of edits.sort((a, b) => b[0] - a[0])) text = text.slice(0, offset) + insert + text.slice(offset);
  const syntax = ts.transpileModule(text, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.equal((syntax.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, 'Overlay syntax must validate');
  return { text, boundaries: found };
};
let cleanup = { attempted: false, stopped: false, removed: false, errors: [] };
process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
try {
  const preregPath = join(repo, 'docs/plans/2026-09-16-intake-source-profile-protocol.json'), preregBytes = await readFile(preregPath), spec = JSON.parse(preregBytes);
  assert.equal(spec.cap_ms, cap); assert.equal(spec.work_cap_ms, workCap); assert.equal(spec.minimum_free_disk_bytes, 2147483648); assert.equal(spec.launch_reserve_bytes, 268435456); assert.equal(spec.maximum_profile_saves_total, 12);
  assert.deepEqual(spec.refs, { A: '60572cec895ad63d4ab826cd366f6475b04e725a', B: '31b8653559d8553208de8591f2d30c419642953a' });
  const clientFiles = []; async function ledger(dir, prefix = '') { for (const entry of await readdir(dir, { withFileTypes: true })) { const file = join(dir, entry.name), name = join(prefix, entry.name); if (entry.isDirectory()) await ledger(file, name); else if (entry.isFile()) clientFiles.push({ path: name, sha256: sha(await readFile(file)) }); } }
  await ledger(frozen); clientFiles.sort((a, b) => a.path.localeCompare(b.path)); assert.equal(sha(JSON.stringify(clientFiles)), spec.frozen_client_ledger_sha256); await artifact('prisma-client-files.json', clientFiles);
  const seedBytes = await readFile(seedPath); assert.equal(sha(seedBytes), spec.original_seed_child_sha256);
  const overlays = {}; const overlayLedger = [];
  for (const arm of spec.arms) { overlays[arm] = {}; for (const [path, expected] of Object.entries(spec.original_source_sha256)) {
    const source = await git('show', `${spec.refs[arm]}:${path}`); assert.equal(sha(source), expected);
    const patched = overlay(source, path); overlays[arm][path] = patched.text;
    overlayLedger.push({ arm, path, original_sha256: sha(source), instrumented_sha256: sha(patched.text), boundaries: patched.boundaries });
    await writeFile(join(out, `${arm}.${basename(path)}.original`), source, { flag: 'wx', mode: 0o600 }); await writeFile(join(out, `${arm}.${basename(path)}.instrumented`), patched.text, { flag: 'wx', mode: 0o600 });
  } }
  const protocol = { ...spec, node: process.version, host: { platform: platform(), arch: arch(), cpus: cpus().length, cpu_model: cpus()[0]?.model }, dependencies: { tsx: reqFront('tsx/package.json').version, typescript: ts.version, sharp: reqFront('sharp/package.json').version, prisma: reqDb('prisma/package.json').version }, preregistration_sha256: sha(preregBytes), runner_sha256: sha(await readFile(fileURLToPath(import.meta.url))), child_sha256: sha(await readFile(childPath)), overlays: overlayLedger };
  assert.equal(protocol.dependencies.prisma, '5.22.0'); assert.equal(protocol.dependencies.sharp, '0.33.5');
  await writeFile(join(out, 'executed-runner.mjs'), await readFile(fileURLToPath(import.meta.url)), { flag: 'wx', mode: 0o600 }); await writeFile(join(out, 'executed-child.ts'), await readFile(childPath), { flag: 'wx', mode: 0o600 }); await writeFile(join(out, 'seed-child.ts'), seedBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(join(out, 'preregistration.json'), preregBytes, { flag: 'wx', mode: 0o600 }); await artifact('protocol.json', protocol); await artifact('protocol-hash.json', { sha256: sha(JSON.stringify(protocol, null, 2) + '\n') });
  guard();
  if (prepare) console.log(JSON.stringify({ prepared: true, profile_saves: 0, database_started: false, source_trees_exported: false, output: out }));
  else {
    await disk(true); guard(); temp = await mkdtemp(join(tmpdir(), 'tk-intake-source-profile-'));
    watchdog = setTimeout(abort, Math.max(1, workCap - (Date.now() - began)));
    diskMonitor = setInterval(() => { void disk().catch(error => { diskFailure = error.message; abort(); }); }, 1000);
    const toolRoot = process.env.INVENTORY_TEST_TOOLS_DIR; assert.ok(toolRoot); const reqTools = createRequire(join(resolve(toolRoot), 'package.json'));
    assert.equal(platform(), 'darwin'); assert.equal(arch(), 'arm64');
    const binaries = await import(pathToFileURL(reqTools.resolve('@embedded-postgres/darwin-arm64')).href); const { Client } = reqTools('pg');
    await artifact('postgres-tools.json', { package: '@embedded-postgres/darwin-arm64', binary_sha256: { initdb: sha(await readFile(binaries.initdb)), postgres: sha(await readFile(binaries.postgres)) }, driver: reqTools('pg/package.json').version });
    const sourcePaths = ['packages/database/src', 'packages/database/prisma', 'packages/database/package.json', 'packages/shared/src', 'packages/shared/package.json', 'packages/ebay-sold-comps-v2/src', 'packages/ebay-sold-comps-v2/package.json', 'frontend/nextjs-app/lib', 'frontend/nextjs-app/constants', 'frontend/nextjs-app/pages/api/v2/admin/inventory/workspace.ts', 'frontend/nextjs-app/tsconfig.json', 'frontend/nextjs-app/package.json', 'package.json', 'tsconfig.base.json'];
    const trees = {};
    for (const arm of spec.arms) {
      const tree = join(temp, arm); await mkdir(tree); trees[arm] = tree; const tar = join(temp, `${arm}.tar`);
      await git('archive', '--format=tar', `--output=${tar}`, spec.refs[arm], ...sourcePaths); await run('/usr/bin/tar', ['-xf', tar, '-C', tree]);
      await artifact(`source-${arm}.json`, { commit: spec.refs[arm], archive_sha256: sha(await readFile(tar)), files: (await git('ls-tree', '-r', spec.refs[arm], '--', ...sourcePaths)).trim().split('\n') });
      await rm(tar);
      await symlink(join(repo, 'node_modules'), join(tree, 'node_modules')); for (const path of ['packages/database', 'packages/shared', 'packages/ebay-sold-comps-v2', 'frontend/nextjs-app']) await symlink(join(repo, path, 'node_modules'), join(tree, path, 'node_modules'));
      await mkdir(join(tree, 'frontend/nextjs-app/scripts'), { recursive: true }); await writeFile(join(tree, 'frontend/nextjs-app/scripts', childFile), await readFile(childPath)); await writeFile(join(tree, 'frontend/nextjs-app/scripts/benchmark-staff-intake.ts'), seedBytes);
      const configFile = join(tree, 'frontend/nextjs-app/tsconfig.json'), config = JSON.parse(await readFile(configFile, 'utf8')); config.compilerOptions.paths['@prisma/client'] = [join(frozen, 'node_modules/@prisma/client')]; await writeFile(configFile, JSON.stringify(config));
    }
    const listener = createServer(); await bounded(new Promise((done, reject) => listener.once('error', reject).listen(0, '127.0.0.1', done))); const port = listener.address().port; await new Promise(done => listener.close(done));
    const password = randomBytes(24).toString('hex'), passwordFile = join(temp, 'owned-password'), pgEnv = { ...cleanEnv, LC_MESSAGES: 'en_US.UTF-8' };
    await writeFile(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
    try { await run(binaries.initdb, [`--pgdata=${join(temp, 'db')}`, '--auth=password', '--username=postgres', `--pwfile=${passwordFile}`, '--lc-messages=en_US.UTF-8', '--encoding=UTF8'], { env: pgEnv }); } finally { await rm(passwordFile, { force: true }); }
    guard(); await disk();
    let ready, rejectReady, pgErrors = '';
    const readyPromise = new Promise((resolveReady, reject) => { ready = resolveReady; rejectReady = reject; });
    postgresChild = spawn(binaries.postgres, ['-D', join(temp, 'db'), '-p', String(port), '-h', '127.0.0.1', '-k', temp], { env: pgEnv, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    postgresClosed = new Promise(resolveClose => { postgresChild.once('close', code => { rejectReady(Error(`Owned PostgreSQL exited (${code}): ${pgErrors.slice(-1000)}`)); resolveClose(); }); postgresChild.once('error', error => { rejectReady(error); resolveClose(); }); });
    postgresChild.stderr.on('data', bytes => { pgErrors = (pgErrors + bytes).slice(-5000); if (pgErrors.includes('database system is ready to accept connections')) ready(); });
    await bounded(readyPromise); guard();
    await artifact('owned-process.json', { postgres_pid: postgresChild.pid, temporary_root: temp, runner_pid: process.pid });
    const url = name => `postgresql://postgres:${password}@127.0.0.1:${port}/${name}?connection_limit=4&pool_timeout=5`, env = name => ({ ...cleanEnv, DATABASE_URL: url(name), TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION: '1', TK_BENCHMARK_OWNED_DATABASE: name });
    const connectAdmin = async () => { guard(); admin = new Client({ connectionString: url('postgres'), connectionTimeoutMillis: 10000, query_timeout: 30000 }); admin.on('error', abort); await bounded(admin.connect()); };
    await connectAdmin(); const identity = (await bounded(admin.query("SELECT version() AS version, current_setting('server_encoding') AS encoding"))).rows[0]; assert.match(identity.version, /PostgreSQL 17\./); assert.equal(identity.encoding, 'UTF8'); await artifact('postgres.json', identity);
    await bounded(admin.query('CREATE DATABASE tk_intake_template')); const schema = join(trees.A, 'packages/database/prisma/schema.prisma');
    const migrate = () => run(process.execPath, [reqDb.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { cwd: trees.A, env: env('tk_intake_template') });
    await migrate(); const ledgerDb = new Client({ connectionString: url('tk_intake_template'), connectionTimeoutMillis: 10000, query_timeout: 30000 }); ledgerDb.on('error', abort); await bounded(ledgerDb.connect());
    try { const before = (await bounded(ledgerDb.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name'))).rows; await migrate(); assert.deepEqual((await bounded(ledgerDb.query('SELECT migration_name, checksum, finished_at FROM "_prisma_migrations" ORDER BY migration_name'))).rows, before); await artifact('migration-ledger.json', before); } finally { await ledgerDb.end(); }
    await admin.end(); admin = null;
    const invoke = (arm, name, file, config, timeout) => run(process.execPath, [reqFront.resolve('tsx/cli'), '--tsconfig', join(trees[arm], 'frontend/nextjs-app/tsconfig.json'), join(trees[arm], 'frontend/nextjs-app/scripts', file), JSON.stringify(config)], { cwd: trees[arm], env: env(name), timeout, echo: true });
    await disk(); await invoke('A', 'tk_intake_template', 'benchmark-staff-intake.ts', { mode: 'seed', protocol, output: join(out, 'seed.json') }, spec.seed_cap_ms);
    // Only now apply sealed probe overlays in owned snapshots. The seed ran original source.
    for (const arm of spec.arms) for (const [path, instrumented] of Object.entries(overlays[arm])) { guard(); await writeFile(join(trees[arm], path), instrumented); }
    const profiles = [];
    for (const arm of spec.arms) {
      await disk(); await connectAdmin(); const name = `tk_intake_profile_${arm}`, output = join(out, `profile-${arm}.json`);
      await bounded(admin.query(`CREATE DATABASE "${name}" TEMPLATE tk_intake_template`)); await admin.end(); admin = null;
      await disk();
      await invoke(arm, name, childFile, { arm, protocol, output }); profiles.push(JSON.parse(await readFile(output, 'utf8')));
      await connectAdmin(); await bounded(admin.query(`DROP DATABASE "${name}"`)); await admin.end(); admin = null;
    }
    guard(); assert.equal(profiles.reduce((n, p) => n + p.samples.length, 0), 12); assert.ok(profiles.every(p => p.complete));
    await artifact('summary.json', { complete: true, release_pass: false, refs: spec.refs, profile_saves: 12, setup_writer_calls: spec.setup_writer_calls, elapsed_ms: Date.now() - began, profiles: profiles.map(p => ({ arm: p.arm, capture: p.capture })) });
    console.log(JSON.stringify({ complete: true, profile_saves: 12, release_pass: false, output: out }));
  }
} catch (error) { await artifact('incomplete.json', { complete: false, error: String(error.message).replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]'), interrupt_signal: interruptSignal ?? null, disk_failure: diskFailure ?? null, elapsed_ms: Date.now() - began }); if (!interruptSignal) throw error; }
finally {
  clearTimeout(watchdog); clearInterval(diskMonitor); killOwned();
  if (admin) { try { await admin.end(); } catch (error) { cleanup.errors.push(String(error.message)); } }
  const remaining = [...processes.values()];
  for (const child of remaining) { const closed = new Promise(done => child.once('close', done)); if (!await waitClosed(child, closed, 5000)) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} if (!await waitClosed(child, closed, 5000)) cleanup.errors.push(`Owned child ${child.pid} did not close`); } }
  if (postgresChild) {
    cleanup.attempted = true; interruptPostgres(); cleanup.stopped = await waitClosed(postgresChild, postgresClosed, 10000);
    if (!cleanup.stopped) { try { process.kill(-postgresChild.pid, 'SIGKILL'); } catch {} cleanup.stopped = await waitClosed(postgresChild, postgresClosed, 5000); }
    if (!cleanup.stopped) cleanup.errors.push('Owned PostgreSQL did not close; preserve temporary directory for recovery');
  }
  if (temp && (!postgresChild || cleanup.stopped) && cleanup.errors.length === 0) { await rm(temp, { recursive: true, force: true }); cleanup.removed = true; }
  if (!prepare) { await artifact('disk.json', diskSamples); await artifact('cleanup.json', { ...cleanup, interrupt_signal: interruptSignal ?? null, retained_temporary_root: cleanup.removed ? null : temp ?? null }); console.log(JSON.stringify({ cleanup })); if (cleanup.errors.length && !interruptSignal) process.exitCode = 1; }
  process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm);
}
