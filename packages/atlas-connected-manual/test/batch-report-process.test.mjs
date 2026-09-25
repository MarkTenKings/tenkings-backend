import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createBatchReportProcess } from '../src/batch-report-process.mjs';
import { createWorkLimiter } from '../src/index.mjs';
import { buildMachineReport } from '../src/batch-preparation.mjs';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';

function fixture(proposals = false) {
  const quad = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
  return { card: { cardId: 'synthetic-card', revision: 1, contentHash: 'a'.repeat(64), draft: { source: { sourceHash: 'b'.repeat(64) } } },
    state: { defects: workspace(false), geometry: { profile: 'SPORTS', sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { printed: { quad }, prepared: { id: side } }])) },
      identity: { playerName: 'Synthetic player', year: '2026', manufacturer: 'Fixture', productSet: 'Isolation test' } },
    analysis: { status: 'READY', analysisId: 'synthetic-analysis', limitations: [], proposals: proposals ? ['FRONT', 'BACK'].map((side, i) => ({
      id: 'shape-' + i, side, defectType: 'LIGHT_SCRATCH_SCUFF', reviewStatus: 'UNREVIEWED', canonicalContour: [
        { x: .2, y: .2 }, { x: .22, y: .2 }, { x: .22, y: .22 }, { x: .2, y: .22 }] })) : [] },
    pythonExecutable: process.env.ATLAS_MEASUREMENT_PYTHON ?? '/unused/python',
    measurementLimits: { maxInputBytes: 16 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, maxFindings: 200, timeoutMs: 90000 } };
}
const prefix = `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';import {spawn} from 'node:child_process';import {join,dirname} from 'node:path';
let raw='';for await(const chunk of process.stdin)raw+=chunk;const request=JSON.parse(raw);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function output(report){const bytes=Buffer.from(JSON.stringify(report));writeFileSync(request.outputPath,bytes,{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({ok:true,inputSha256:request.inputSha256,output:{filename:'output.json',byteCount:bytes.length,sha256:hash(bytes)}}));}
`;
async function owned(t, script = null, options = {}) {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'atlas-report-test-')));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const path = script === null ? undefined : join(temporaryRoot, 'fixture-worker.mjs');
  if (path) await writeFile(path, prefix + script, { flag: 'wx', mode: 0o600 });
  let active = 0, peak = 0;
  const limited = async work => { active++; peak = Math.max(active, peak); try { return await work(); } finally { active--; } };
  return { temporaryRoot, run: createBatchReportProcess({ limited, temporaryRoot, ...(path ? { path } : {}), ...options }),
    active: () => active, peak: () => peak, jobs: async () => (await readdir(temporaryRoot)).filter(x => x.startsWith('atlas-report-')) };
}
async function waitFile(path) {
  const deadline = performance.now() + 5000;
  while (true) { try { return await readFile(path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT' || performance.now() > deadline) throw e; await delay(10); } }
}

test('real isolated report equals the pure builder and preserves machine-only authority', async t => {
  const f = await owned(t), input = fixture(), expected = await buildMachineReport(input);
  assert.deepEqual(await f.run(input), expected); assert.equal(f.active(), 0); assert.deepEqual(await f.jobs(), []);
});
test('native isolated reports preserve exact measurement receipts, traces and grades', { skip: !process.env.ATLAS_MEASUREMENT_PYTHON }, async t => {
  const f = await owned(t), input = fixture(true), expected = await buildMachineReport(input);
  assert.deepEqual(await f.run(input), expected); assert.equal(f.active(), 0); assert.deepEqual(await f.jobs(), []);
});
test('child receives only the explicit environment, no Node flags, and the same owned TMPDIR', async t => {
  const f = await owned(t, `output({authority:'MACHINE_PROPOSAL',certification:null,keys:Object.keys(process.env).sort(),args:process.execArgv,tmp:process.env.TMPDIR,cwd:process.cwd()});`);
  const old = process.env.ATLAS_REPORT_SECRET_SENTINEL; process.env.ATLAS_REPORT_SECRET_SENTINEL = 'must-not-cross';
  try {
    const result = await f.run(fixture());
    assert.deepEqual(result.keys.filter(key => process.platform !== 'darwin' || key !== '__CF_USER_TEXT_ENCODING'), ['OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'PATH', 'PYTHONNOUSERSITE', 'TMPDIR']);
    assert.deepEqual(result.args, []); assert.equal(result.tmp, result.cwd); assert.equal(result.tmp.startsWith(f.temporaryRoot + '/atlas-report-'), true);
  } finally { if (old === undefined) delete process.env.ATLAS_REPORT_SECRET_SENTINEL; else process.env.ATLAS_REPORT_SECRET_SENTINEL = old; }
  assert.deepEqual(await f.jobs(), []);
});
test('queued reports are snapshotted and abort before any child or temporary job starts', async t => {
  let admit; const queue = new Promise(resolve => { admit = resolve; });
  const f = await owned(t, `output({authority:'MACHINE_PROPOSAL',certification:null});`, { limited: async work => { await queue; return work(); } });
  const controller = new AbortController(), pending = f.run({ ...fixture(), signal: controller.signal });
  controller.abort(); admit();
  await assert.rejects(pending, { code: 'BATCH_INTERRUPTED' }); assert.deepEqual(await f.jobs(), []);
});
test('input bounds and malformed responses stop safely without leaving scratch', async t => {
  const f = await owned(t, `process.stdout.write('invalid protocol');`);
  await assert.rejects(f.run({ ...fixture(), state: 'x'.repeat(16 * 1024 * 1024) }), { code: 'BATCH_REPORT_LIMIT' });
  await assert.rejects(f.run(fixture()), { code: 'BATCH_REPORT_PROTOCOL' }); assert.deepEqual(await f.jobs(), []);
});
test('oversized stdout and output files are rejected and cleaned', async t => {
  const stdout = await owned(t, `process.stdout.write('x'.repeat(32769));setInterval(()=>{},1000);`, { cancelGraceMs: 30 });
  await assert.rejects(stdout.run(fixture()), { code: 'BATCH_REPORT_PROTOCOL' }); assert.deepEqual(await stdout.jobs(), []);
  const output = await owned(t, `output({authority:'MACHINE_PROPOSAL',certification:null,large:'x'.repeat(16*1024*1024)});`);
  await assert.rejects(output.run(fixture()), { code: 'BATCH_REPORT_LIMIT' }); assert.deepEqual(await output.jobs(), []);
});
test('worker validation errors retain safe existing codes and leave no temporary job', async t => {
  const f = await owned(t), input = fixture(); input.analysis.status = 'UNKNOWN';
  await assert.rejects(f.run(input), { code: 'BATCH_ANALYSIS_NOT_READY', status: 409 }); assert.deepEqual(await f.jobs(), []);
});
test('timeout kills an event-loop-blocked report process and reclaims its permit', async t => {
  const f = await owned(t, `while(true){}`, { timeoutMs: 100, cancelGraceMs: 30 });
  await assert.rejects(f.run(fixture()), { code: 'BATCH_REPORT_TIMEOUT' }); assert.equal(f.active(), 0); assert.deepEqual(await f.jobs(), []);
});
test('abort first allows the child to reap a descendant before the parent returns', async t => {
  const f = await owned(t, `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync(join(dirname(process.cwd()),'ready'),String(child.pid));
process.once('SIGTERM',()=>{child.kill('SIGKILL');child.once('close',()=>{writeFileSync(join(dirname(process.cwd()),'graceful'),'reaped');process.exit(0);});});setInterval(()=>{},1000);`);
  const controller = new AbortController(), pending = f.run({ ...fixture(), signal: controller.signal });
  const pid = Number(await waitFile(join(f.temporaryRoot, 'ready'))); controller.abort();
  await assert.rejects(pending, { code: 'BATCH_INTERRUPTED' });
  assert.equal(await readFile(join(f.temporaryRoot, 'graceful'), 'utf8'), 'reaped');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); assert.equal(f.active(), 0); assert.deepEqual(await f.jobs(), []);
});
test('unexpected worker exit kills and reaps its still-running orphan group before release', async t => {
  const f = await owned(t, `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
writeFileSync(join(dirname(process.cwd()),'orphan'),String(child.pid));process.exit(7);`);
  const started = performance.now();
  await assert.rejects(f.run(fixture()), { code: 'BATCH_REPORT_FAILED' });
  assert.ok(performance.now() - started < 5000, 'orphan pipes must not wait for the report deadline');
  const pid = Number(await readFile(join(f.temporaryRoot, 'orphan'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); assert.equal(f.active(), 0); assert.deepEqual(await f.jobs(), []);
});

test('unknown report logic failures remain permanent compute errors', async t => {
  const f = await owned(t), input = fixture(); input.state.geometry = null;
  await assert.rejects(f.run(input), { code: 'BATCH_REPORT_COMPUTE_INVALID' });
  assert.deepEqual(await f.jobs(), []);
});
test('two real native permits bound three CPU jobs and retain queued snapshots while the parent stays responsive', async t => {
  const script = `const input=JSON.parse(readFileSync(request.inputPath));const log=join(dirname(process.cwd()),'events');
const event=kind=>appendFileSync(log,JSON.stringify({kind,id:input.card.cardId,time:process.hrtime.bigint().toString()})+'\\n');
event('start');const end=performance.now()+450;while(performance.now()<end){}event('end');
output({authority:'MACHINE_PROPOSAL',certification:null,id:input.card.cardId});`;
  const f = await owned(t, script, { limited: createWorkLimiter(2, { maxQueue: 1 }) });
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  const inputs = [1, 2, 3].map(id => { const value = fixture(); value.card.cardId = 'snapshot-' + id; return value; });
  try {
    const pending = inputs.map(value => f.run(value)); inputs[2].card.cardId = 'mutated-after-queue';
    const results = await Promise.all(pending);
    assert.deepEqual(results.map(x => x.id), ['snapshot-1', 'snapshot-2', 'snapshot-3']);
  } finally { clearInterval(timer); }
  const events = (await readFile(join(f.temporaryRoot, 'events'), 'utf8')).trim().split('\n').map(JSON.parse)
    .sort((a, b) => BigInt(a.time) < BigInt(b.time) ? -1 : 1);
  let active = 0, peak = 0;
  for (const event of events) { active += event.kind === 'start' ? 1 : -1; peak = Math.max(peak, active); }
  assert.equal(active, 0); assert.equal(peak, 2); assert.ok(ticks >= 5, 'parent timers must progress during CPU work');
  assert.ok(events.findIndex(x => x.id === 'snapshot-3' && x.kind === 'start') > events.findIndex(x => x.kind === 'end'));
  assert.deepEqual(await f.jobs(), []);
});
