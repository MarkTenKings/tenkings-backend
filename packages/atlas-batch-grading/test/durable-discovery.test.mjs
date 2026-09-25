import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { batchActionId, createBatchWorker } from '../src/index.mjs';

async function until(check) {
  for (let i = 0; i < 400; i++) { if (check()) return; await delay(5); }
  assert.fail('Durable worker did not settle');
}
function fixture(count = 20) {
  const actors = [{ id: randomUUID() }, { id: randomUUID() }], events = [];
  const rows = Array.from({ length: count }, (_, n) => ({ key: n.toString(16).padStart(64, '0'),
    ownerId: actors[n % actors.length].id, state: 'QUEUED', stage: 'ANALYZE', sourceHash: 'a'.repeat(64),
    evidence: {}, attempts: 0, analysisActionId: batchActionId(String(n), 'ANALYZE') }));
  let peak = 0, pendingDiscovery = null;
  const repository = {
    async discoverOwners() { if (pendingDiscovery) await pendingDiscovery; return actors; },
    async claim(actor, claimId, maximum, analysisMaximum) {
      assert(actors.includes(actor), 'opaque machine handle is retained');
      events.push({ type: 'claim', ownerId: actor.id, maximum, analysisMaximum });
      if (rows.filter(row => row.state === 'RUNNING').length >= maximum) return null;
      const row = rows.find(row => row.state === 'QUEUED' && row.ownerId === actor.id);
      if (!row) return null;
      Object.assign(row, { state: 'RUNNING', claimId, attempts: row.attempts + 1 });
      peak = Math.max(peak, rows.filter(row => row.state === 'RUNNING').length);
      return structuredClone(row);
    },
    async renew(actor, job) { return rows.find(row => row.key === job.key)?.claimId === job.claimId; },
    async finish(actor, job, result) {
      const row = rows.find(row => row.key === job.key);
      if (row.claimId !== job.claimId) return false;
      events.push({ type: 'finish', key: job.key, result });
      row.claimId = null; row.state = result.kind === 'REVIEW' ? 'REVIEW' : result.kind === 'ATTENTION' ? 'NEEDS_ATTENTION' : 'QUEUED';
      row.evidence = { ...row.evidence, ...result.evidence };
      if (result.kind === 'CONTINUE') row.stage = 'REPORT';
      return true;
    },
  };
  return { actors, rows, events, repository, get peak() { return peak; }, holdDiscovery: promise => { pendingDiscovery = promise; } };
}
const ready = job => ({ kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL',
  sourceHash: job.sourceHash, manualRevision: 1, reportHash: 'b'.repeat(64) } });

test('startup discovers durable work without a wake or browser handle, overlapping twenty analyses fairly', async () => {
  const f = fixture(), entered = [], errors = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const worker = createBatchWorker({ repository: f.repository, concurrency: 20, analysisConcurrency: 20,
    onError: error => errors.push(error), prepare: { async run(actor, job) {
      if (job.stage === 'ANALYZE') { entered.push(actor.id); await barrier; return { kind: 'CONTINUE' }; }
      return ready(job);
    } } });
  try {
    await until(() => entered.length === 20);
    assert.equal(f.peak, 20);
    assert.equal(entered.filter(id => id === f.actors[0].id).length, 10);
    assert(entered.slice(0, 10).every((id, index) => id === f.actors[index % 2].id));
    assert(f.events.filter(event => event.type === 'claim').every(event => event.analysisMaximum === 20));
    release(); await until(() => f.rows.every(row => row.state === 'REVIEW'));
    assert.deepEqual(errors, []);
  } finally { release(); await worker.stop(); }
});

test('startup replacement discovers a saved wait, keeping the exact analysis action after socket loss', async () => {
  const f = fixture(1), actions = []; let first, stopping;
  const finish = f.repository.finish;
  f.repository.finish = async (...args) => {
    const result = await finish(...args);
    if (args[2].kind === 'WAIT' && !stopping) stopping = first.stop();
    return result;
  };
  first = createBatchWorker({ repository: f.repository, prepare: { async run(_actor, job) {
    actions.push(job.analysisActionId); throw Object.assign(Error('Lost socket after dispatch'), { code: 'ECONNRESET' });
  } } });
  await until(() => stopping); await stopping;
  assert.equal(f.rows[0].state, 'QUEUED'); assert.equal(f.rows[0].evidence.transportRetryCount, 1);
  const replacement = createBatchWorker({ repository: f.repository, prepare: { async run(_actor, job) {
    if (job.stage === 'ANALYZE') { actions.push(job.analysisActionId); return { kind: 'CONTINUE' }; }
    return ready(job);
  } } });
  try {
    await until(() => f.rows[0].state === 'REVIEW');
    assert.equal(actions.length, 2); assert.equal(new Set(actions).size, 1);
    assert.equal(f.rows[0].evidence.transportRetryCount, 1);
  } finally { await first.stop(); await replacement.stop(); }
});

test('stop fences a discovery already in flight and never claims its returned owners', async () => {
  const f = fixture(1); let release;
  f.holdDiscovery(new Promise(resolve => { release = resolve; }));
  const worker = createBatchWorker({ repository: f.repository, prepare: { async run() { assert.fail('stopped stage'); } } });
  await delay(0); const stopping = worker.stop(); release(); await stopping;
  assert.equal(f.events.length, 0); assert.equal(worker.status().active, 0);
});

test('execution concurrency and provider reservations receive separate bounds', async () => {
  const f = fixture(3), worker = createBatchWorker({ repository: f.repository, concurrency: 2, analysisConcurrency: 20,
    prepare: { async run(_actor, job) { await delay(1); return job.stage === 'REPORT' ? ready(job) : { kind: 'CONTINUE' }; } } });
  try {
    await until(() => f.rows.every(row => row.state === 'REVIEW'));
    assert.equal(f.peak, 2); assert(f.events.filter(event => event.type === 'claim').every(event => event.maximum === 2 && event.analysisMaximum === 20));
  } finally { await worker.stop(); }
});

test('cold construction and browser wake perform no database discovery until the private host starts', async () => {
  const f = fixture(1); let scans = 0;
  const discover = f.repository.discoverOwners;
  f.repository.discoverOwners = async () => { scans++; return discover(); };
  const worker = createBatchWorker({ repository: f.repository, autoStart: false,
    prepare: { async run(_actor, job) { return job.stage === 'REPORT' ? ready(job) : { kind: 'CONTINUE' }; } } });
  try {
    worker.wake(f.actors[0]); await worker.tick(); await delay(10);
    assert.equal(scans, 0); assert.equal(f.events.length, 0); assert.equal(worker.status().started, false);
    assert.equal(worker.start(), true); assert.equal(worker.start(), false);
    await until(() => f.rows[0].state === 'REVIEW'); assert(scans > 0);
  } finally { await worker.stop(); }
  assert.equal(worker.start(), false);
  const neverStarted = createBatchWorker({ repository: f.repository, autoStart: false, prepare: { run: () => assert.fail() } });
  await neverStarted.stop(); const prior = scans; assert.equal(neverStarted.start(), false); await delay(0); assert.equal(scans, prior);
});
