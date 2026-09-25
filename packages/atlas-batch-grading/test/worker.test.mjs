import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { batchActionId, createBatchWorker, parseBatchInput } from '../src/index.mjs';

async function until(check) { for (let i = 0; i < 300; i++) { if (check()) return; await delay(5); } assert.fail('worker did not settle'); }
function fixture(count = 50) {
  const staff = { id: randomUUID() }, rows = Array.from({ length: count }, (_, index) => ({ key: index.toString(16).padStart(64, '0'),
    cardId: randomUUID(), sourceHash: 'a'.repeat(64), stage: 'PREPARE', state: 'QUEUED', evidence: {}, attempts: 0 }));
  let running = 0, peak = 0;
  const repo = {
    async claim(actor, claimId, maximum) {
      assert.equal(actor, staff); if (running >= maximum) return null;
      const row = rows.find(item => item.state === 'QUEUED'); if (!row) return null;
      Object.assign(row, { state: 'RUNNING', claimId, attempts: row.attempts + 1 }); running++; peak = Math.max(peak, running);
      return { ...structuredClone(row), analysisActionId: batchActionId(row.key, 'ANALYZE') };
    },
    async renew(actor, job) { return rows.find(row => row.key === job.key).claimId === job.claimId; },
    async finish(actor, job, outcome) {
      const row = rows.find(item => item.key === job.key); if (row.claimId !== job.claimId) return false;
      running--; row.claimId = null;
      Object.assign(row, { state: outcome.kind === 'REVIEW' ? 'REVIEW' : outcome.kind === 'ATTENTION' ? 'NEEDS_ATTENTION' : 'QUEUED',
        evidence: { ...row.evidence, ...outcome.evidence }, code: outcome.code });
      if (outcome.kind === 'CONTINUE') row.stage = row.stage === 'PREPARE' ? 'ANALYZE' : 'REPORT';
      return true;
    },
  };
  return { staff, rows, repo, get peak() { return peak; } };
}

test('accepts a 50-card batch, rejects duplicates, unbound fields and 51 cards', () => {
  const value = { actionId: randomUUID(), cards: Array.from({ length: 50 }, () => ({ cardId: randomUUID(), sourceHash: 'a'.repeat(64) })) };
  assert.equal(parseBatchInput(value).cards.length, 50);
  assert.throws(() => parseBatchInput({ ...value, cards: [...value.cards, value.cards[0]] }), /BATCH_INPUT_INVALID/);
  assert.throws(() => parseBatchInput({ ...value, cards: [value.cards[0], value.cards[0]] }), /BATCH_INPUT_INVALID/);
  assert.throws(() => parseBatchInput({ ...value, authority: 'HUMAN' }), /BATCH_INPUT_INVALID/);
});
test('50 independent cards progress with bounded actual concurrency and one failure does not block the others', async () => {
  const f = fixture(), visited = [];
  const worker = createBatchWorker({ repository: f.repo, concurrency: 2, prepare: { async run(actor, job) {
    visited.push(`${job.key}:${job.stage}`); await delay(1);
    if (job.key === f.rows[3].key && job.stage === 'ANALYZE') throw Object.assign(Error('lost response'), { code: 'BATCH_ANALYSIS_UNCERTAIN' });
    return job.stage === 'REPORT' ? { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash, reportHash: 'b'.repeat(64), manualRevision: 1 } } : { kind: 'CONTINUE' };
  } } });
  try {
    worker.wake(f.staff); worker.wake(f.staff); await until(() => f.rows.every(row => ['REVIEW', 'NEEDS_ATTENTION'].includes(row.state)));
    assert.equal(f.peak, 2); assert.equal(f.rows.filter(row => row.state === 'REVIEW').length, 49);
    assert.equal(f.rows[3].code, 'BATCH_ANALYSIS_UNCERTAIN'); assert.equal(new Set(visited).size, visited.length);
  } finally { worker.stop(); }
});
test('resume uses the same analysis identity after an uncertain request and process replacement', async () => {
  const f = fixture(1), identities = [], responses = new Map();
  const prepare = { async run(actor, job) {
    if (job.stage === 'PREPARE') return { kind: 'CONTINUE' };
    if (job.stage === 'ANALYZE') {
      identities.push(job.analysisActionId);
      if (!responses.has(job.analysisActionId)) { responses.set(job.analysisActionId, 'accepted'); throw Error('response lost after durable dispatch'); }
      return { kind: 'CONTINUE' };
    }
    return { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash, reportHash: 'c'.repeat(64), manualRevision: 2 } };
  } };
  const first = createBatchWorker({ repository: f.repo, prepare }); first.wake(f.staff);
  await until(() => f.rows[0].state === 'NEEDS_ATTENTION'); first.stop(); f.rows[0].state = 'QUEUED';
  const second = createBatchWorker({ repository: f.repo, prepare });
  try { second.wake(f.staff); await until(() => f.rows[0].state === 'REVIEW'); assert.equal(identities.length, 2); assert.equal(new Set(identities).size, 1); assert.equal(responses.size, 1); }
  finally { second.stop(); }
});
test('cannot label a partial stage or a human-authority payload review-ready', async () => {
  for (const authority of ['HUMAN', 'MACHINE_PROPOSAL']) {
    const f = fixture(1);
    const worker = createBatchWorker({ repository: f.repo, prepare: { async run() { return { kind: 'REVIEW', evidence: { authority, sourceHash: 'a'.repeat(64), manualRevision: 1, reportHash: 'b'.repeat(64) } }; } } });
    try { worker.wake(f.staff); await until(() => f.rows[0].state === 'NEEDS_ATTENTION'); assert.equal(f.rows[0].code, 'BATCH_OUTCOME_INVALID'); }
    finally { worker.stop(); }
  }
});
test('lost lease aborts the stage and cannot publish a ready result', async () => {
  const f = fixture(1); f.rows[0].stage = 'REPORT'; let aborted = false;
  f.repo.renew = async () => false;
  const worker = createBatchWorker({ repository: f.repo, heartbeatMs: 10, prepare: { async run(actor, job, { signal }) {
    await delay(25); aborted = signal.aborted;
    return { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash, reportHash: 'b'.repeat(64), manualRevision: 1 } };
  } } });
  try { worker.wake(f.staff); await until(() => f.rows[0].state === 'NEEDS_ATTENTION'); assert.equal(aborted, true); assert.equal(f.rows[0].code, 'BATCH_LEASE_LOST'); }
  finally { worker.stop(); }
});
test('stop is permanent and creates no later claims', async () => {
  const f = fixture(2), worker = createBatchWorker({ repository: f.repo, prepare: { run: () => { throw Error('must not execute'); } } });
  worker.stop(); assert.equal(worker.wake(f.staff), false); await worker.tick(f.staff); assert.equal(f.rows.every(row => row.attempts === 0), true);
});
test('shutdown waits for the running stage and durable finish without claiming the next card', async () => {
  const f = fixture(2); let release, finishing, finishRelease;
  const stage = new Promise(resolve => { release = resolve; });
  const finish = new Promise(resolve => { finishRelease = resolve; });
  const originalFinish = f.repo.finish;
  f.repo.finish = async (...args) => { finishing = true; await finish; return originalFinish(...args); };
  const worker = createBatchWorker({ repository: f.repo, concurrency: 1, prepare: { async run() { await stage; return { kind: 'CONTINUE' }; } } });
  let stopped = false;
  try {
    worker.wake(f.staff); await until(() => worker.status().active === 1);
    const stopping = worker.stop().then(() => { stopped = true; });
    await delay(5); assert.equal(stopped, false);
    release(); await until(() => finishing); assert.equal(stopped, false);
    finishRelease(); await stopping;
    assert.equal(f.rows[0].stage, 'ANALYZE'); assert.equal(f.rows[0].state, 'QUEUED');
    assert.equal(f.rows[1].attempts, 0); assert.equal(worker.status().active, 0);
  } finally { release(); finishRelease(); await worker.stop(); }
});
test('shutdown returns a concurrently committed claim without dispatching its stage', async () => {
  const f = fixture(1); let release, claimed = false, effects = 0;
  const pending = new Promise(resolve => { release = resolve; }), originalClaim = f.repo.claim;
  f.repo.claim = async (...args) => { const job = await originalClaim(...args); claimed = true; await pending; return job; };
  const worker = createBatchWorker({ repository: f.repo, prepare: { async run() { effects++; return { kind: 'CONTINUE' }; } } });
  try {
    worker.wake(f.staff); await until(() => claimed); let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; }); await delay(5); assert.equal(stopped, false);
    release(); await stopping;
    assert.equal(effects, 0); assert.equal(f.rows[0].stage, 'PREPARE'); assert.equal(f.rows[0].state, 'QUEUED');
    assert.equal(worker.status().authenticatedOwners, 0);
  } finally { release(); await worker.stop(); }
});
test('shutdown also waits for a lease renewal already in flight before releasing database custody', async () => {
  const f = fixture(1); let release, renewRelease, renewing = false;
  const stage = new Promise(resolve => { release = resolve; }), renewal = new Promise(resolve => { renewRelease = resolve; });
  f.repo.renew = async () => { renewing = true; await renewal; return true; };
  const worker = createBatchWorker({ repository: f.repo, heartbeatMs: 10, prepare: { async run() { await stage; return { kind: 'CONTINUE' }; } } });
  try {
    worker.wake(f.staff); await until(() => renewing); let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; }); release();
    await until(() => f.rows[0].stage === 'ANALYZE'); assert.equal(stopped, false);
    renewRelease(); await stopping; assert.equal(worker.status().active, 0);
  } finally { release(); renewRelease(); await worker.stop(); }
});
for(const [code,stage,status] of [['MANUAL_PROCESSING_BUSY','ANALYZE',503],['GEOMETRY_QUEUE_FULL','PREPARE',429]])test(`temporary ${code} waits on the same job instead of requiring human recovery`,async()=>{
 const f=fixture(1),actions=[];let refused=false;
 const worker=createBatchWorker({repository:f.repo,prepare:{async run(_staff,job){
  if(job.stage===stage){actions.push(job.analysisActionId);if(!refused){refused=true;throw Object.assign(new Error('Busy'),{code,status});}}
  return job.stage==='REPORT'?{kind:'REVIEW',evidence:{authority:'MACHINE_PROPOSAL',sourceHash:job.sourceHash,reportHash:'a'.repeat(64),manualRevision:1}}:{kind:'CONTINUE'};
 }}});
 try{worker.wake(f.staff);await until(()=>f.rows[0].state==='REVIEW');assert.equal(actions.length,2);assert.equal(new Set(actions).size,1);assert.equal(f.rows[0].code,undefined);}
 finally{worker.stop();}
});

for (const stage of ['PREPARE', 'ANALYZE', 'REPORT']) test(`storage outage recovers automatically on the same action with durable backoff: ${stage}`, async () => {
  const f = fixture(1), identities = [], outcomes = [];
  f.rows[0].stage = stage; f.rows[0].evidence = { retained: 'existing evidence' };
  const finish = f.repo.finish;
  f.repo.finish = async (...args) => { outcomes.push(args[2]); return finish(...args); };
  let failures = 0;
  const worker = createBatchWorker({ repository: f.repo, prepare: { async run(_staff, job) {
    identities.push([job.key, job.cardId, job.sourceHash, job.analysisActionId]);
    if (failures++ < 3) throw Object.assign(Error('transport unavailable'), { code: 'PHOTO_STORAGE_UNAVAILABLE' });
    return job.stage === 'REPORT' ? { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash,
      reportHash: 'b'.repeat(64), manualRevision: 1 } } : { kind: 'CONTINUE' };
  } } });
  try {
    worker.wake(f.staff); await until(() => f.rows[0].state === 'REVIEW');
    assert.equal(new Set(identities.map(value => JSON.stringify(value))).size, 1);
    assert.deepEqual(outcomes.slice(0, 3).map(value => [value.kind, value.retryAfterMs, value.evidence.storageRetryCount]),
      [['WAIT', 3000, 1], ['WAIT', 6000, 2], ['WAIT', 12000, 3]]);
    assert.equal(f.rows[0].evidence.retained, 'existing evidence'); assert.equal(f.rows[0].evidence.storageRetryCount, 3);
  } finally { await worker.stop(); }
});

test('Prisma raw-query contention retries the same durable action, but SQL permission and evidence errors remain attention', async () => {
  for (const sqlstate of ['40001','40P01','55P03','57014','42501','P0001']) {
    const retryable = ['40001','40P01','55P03','57014'].includes(sqlstate), f = fixture(1), actions = [], outcomes = [];
    const finish = f.repo.finish;
    f.repo.finish = async (...args) => { outcomes.push(args[2]); return finish(...args); };
    let thrown = false;
    const worker = createBatchWorker({ repository: f.repo, prepare: { async run(_staff, job) {
      actions.push(job.analysisActionId);
      if (!thrown) { thrown = true; throw Object.assign(Error('raw query failed'), { code: 'P2010', meta: { code: sqlstate } }); }
      return job.stage === 'REPORT' ? { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash,
        reportHash: 'b'.repeat(64), manualRevision: 1 } } : { kind: 'CONTINUE' };
    } } });
    try {
      worker.wake(f.staff); await until(() => f.rows[0].state === (retryable ? 'REVIEW' : 'NEEDS_ATTENTION'));
      assert.equal(outcomes[0].kind, retryable ? 'WAIT' : 'ATTENTION'); assert.equal(new Set(actions).size, 1);
      if (retryable) assert.equal(outcomes[0].retryAfterMs, 3000);
      else assert.equal(actions.length, 1);
    } finally { await worker.stop(); }
  }
});

test('report child interruptions retry only that report, with durable backoff and no new analysis', async () => {
  for (const code of ['BATCH_REPORT_UNAVAILABLE', 'BATCH_REPORT_TIMEOUT', 'BATCH_REPORT_FAILED',
    'BATCH_REPORT_PROTOCOL', 'BATCH_REPORT_COMPUTE_INVALID', 'BATCH_REPORT_LIMIT', 'BATCH_REPORT_CLEANUP_UNCERTAIN']) {
    const retryable = ['BATCH_REPORT_UNAVAILABLE', 'BATCH_REPORT_TIMEOUT', 'BATCH_REPORT_FAILED'].includes(code);
    const f = fixture(1), actions = [], outcomes = [];
    f.rows[0].stage = 'REPORT'; f.rows[0].evidence = { analysisId: 'retained-result' };
    const finish = f.repo.finish;
    f.repo.finish = async (...args) => { outcomes.push(args[2]); return finish(...args); };
    const worker = createBatchWorker({ repository: f.repo, prepare: { async run(_staff, job) {
      assert.equal(job.stage, 'REPORT'); actions.push(job.analysisActionId);
      if (actions.length <= 2) throw Object.assign(Error('child interrupted'), { code });
      return { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash,
        reportHash: 'b'.repeat(64), manualRevision: 1 } };
    } } });
    try {
      worker.wake(f.staff); await until(() => f.rows[0].state === (retryable ? 'REVIEW' : 'NEEDS_ATTENTION'));
      assert.equal(new Set(actions).size, 1);
      assert.equal(f.rows[0].evidence.analysisId, 'retained-result');
      if (retryable) {
        assert.equal(actions.length, 3);
        assert.deepEqual(outcomes.slice(0, 2).map(x => [x.kind, x.retryAfterMs, x.evidence.transportRetryCount]),
          [['WAIT', 3000, 1], ['WAIT', 6000, 2]]);
      } else { assert.equal(actions.length, 1); assert.equal(outcomes[0].kind, 'ATTENTION'); }
    } finally { await worker.stop(); }
  }
});

test('storage retry backoff survives worker replacement and ordinary waits without changing action identity', async () => {
  const f = fixture(1), identities = [], outcomes = [];
  f.rows[0].evidence = { retained: 'same source evidence' };
  const finish = f.repo.finish;
  let first, stopping;
  f.repo.finish = async (...args) => {
    outcomes.push(args[2]); const saved = await finish(...args);
    if (args[2].evidence?.storageRetryCount === 1 && !stopping) stopping = first.stop();
    return saved;
  };
  const failStorage = job => {
    identities.push([job.key, job.cardId, job.sourceHash, job.analysisActionId]);
    throw Object.assign(Error('transport unavailable'), { code: 'PHOTO_STORAGE_UNAVAILABLE' });
  };
  first = createBatchWorker({ repository: f.repo, prepare: { run: async (_staff, job) => failStorage(job) } });
  first.wake(f.staff); await until(() => Boolean(stopping)); await stopping;
  assert.equal(f.rows[0].state, 'QUEUED'); assert.equal(f.rows[0].evidence.storageRetryCount, 1);
  let ordinaryWait = false, retried = false;
  const second = createBatchWorker({ repository: f.repo, prepare: { async run(_staff, job) {
    if (!ordinaryWait) { ordinaryWait = true; return { kind: 'WAIT', retryAfterMs: 3000 }; }
    if (!retried) { retried = true; return failStorage(job); }
    return job.stage === 'REPORT' ? { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash,
      reportHash: 'b'.repeat(64), manualRevision: 1 } } : { kind: 'CONTINUE' };
  } } });
  try {
    second.wake(f.staff); await until(() => f.rows[0].state === 'REVIEW');
    assert.equal(identities.length, 2); assert.equal(new Set(identities.map(value => JSON.stringify(value))).size, 1);
    assert.equal(f.rows[0].evidence.storageRetryCount, 2);
    assert.deepEqual(outcomes.slice(0, 3).map(value => value.evidence?.storageRetryCount ?? value.kind), [1, 'WAIT', 2]);
    assert.equal(outcomes[2].retryAfterMs, 6000);
  } finally { await first.stop(); await second.stop(); }
});

test('storage failures cannot retry with expired authorization, an abort, or an invalid saved budget', async () => {
  for (const variant of [{ status: 401 }, { status: 403 }, { name: 'AbortError' }, { budget: -1 }, { budget: '1' }, { budget: null }, { budget: 1000001 }]) {
    const f = fixture(1), outcomes = [];
    if (Object.hasOwn(variant, 'budget')) f.rows[0].evidence.storageRetryCount = variant.budget;
    const finish = f.repo.finish;
    f.repo.finish = async (...args) => { outcomes.push(args[2]); return finish(...args); };
    const worker = createBatchWorker({ repository: f.repo, prepare: { async run() {
      throw Object.assign(Error('transport unavailable'), { code: 'PHOTO_STORAGE_UNAVAILABLE', status: variant.status, name: variant.name ?? 'Error' });
    } } });
    try {
      worker.wake(f.staff); await until(() => f.rows[0].state === 'NEEDS_ATTENTION');
      assert.equal(f.rows[0].attempts, 1); assert.equal(outcomes.length, 1); assert.equal(outcomes[0].kind, 'ATTENTION');
      if (variant.status) assert.equal(worker.status().authenticatedOwners, 0);
    } finally { await worker.stop(); }
  }
});

for (const reason of ['lease loss', 'shutdown']) test(`storage failure cannot spend a retry after ${reason}`, async () => {
  const f = fixture(1), outcomes = []; let entered = false, release;
  const gate = new Promise(resolve => { release = resolve; }), finish = f.repo.finish;
  f.repo.finish = async (...args) => { outcomes.push(args[2]); return finish(...args); };
  if (reason === 'lease loss') f.repo.renew = async () => false;
  const worker = createBatchWorker({ repository: f.repo, heartbeatMs: 10, prepare: { async run() {
    entered = true;
    if (reason === 'lease loss') await delay(25); else await gate;
    throw Object.assign(Error('transport unavailable'), { code: 'PHOTO_STORAGE_UNAVAILABLE' });
  } } });
  try {
    worker.wake(f.staff); await until(() => entered);
    if (reason === 'shutdown') { const stopping = worker.stop(); release(); await stopping; }
    else await until(() => f.rows[0].state === 'NEEDS_ATTENTION');
    assert.equal(f.rows[0].attempts, 1); assert.equal(outcomes[0].kind, reason === 'shutdown' ? 'WAIT' : 'ATTENTION');
    assert.equal(f.rows[0].evidence.storageRetryCount, undefined);
  } finally { release(); await worker.stop(); }
});

test('stage diagnostics identify the failure without exposing exception messages or blocking durable finish', async () => {
  for (const diagnosticThrows of [false, true]) {
    const f = fixture(1), observed = [];
    f.rows[0].stage = 'REPORT';
    const failure = new TypeError('secret token and https://private.invalid/photo?signature=secret');
    failure.stack = 'TypeError: secret token\n    at buildMachineReport (file:///workspace/packages/atlas-connected-manual/src/batch-preparation.mjs:42:7)\n    at internal';
    const worker = createBatchWorker({ repository: f.repo, prepare: { async run() { throw failure; } },
      onError(error) { observed.push(error); if (diagnosticThrows) throw new Error('logger failed'); } });
    try {
      worker.wake(f.staff); await until(() => f.rows[0].state === 'NEEDS_ATTENTION');
      assert.equal(f.rows[0].code, 'BATCH_STAGE_INTERRUPTED'); assert.equal(observed.length, 1);
      assert.equal(observed[0].stage, 'REPORT'); assert.equal(observed[0].errorType, 'TypeError');
      assert.equal(observed[0].location, 'packages/atlas-connected-manual/src/batch-preparation.mjs:42:7');
      assert.equal(JSON.stringify(observed[0]).includes('secret'), false);
      assert.equal(observed[0].message, 'BATCH_STAGE_INTERRUPTED'); assert.equal(observed[0].cause, undefined);
    } finally { await worker.stop(); }
  }
});

test('transaction diagnostics preserve safe timing and the existing exact-action retry even when the logger fails', async () => {
  const f = fixture(1), observed = [], outcomes = [], actions = [];
  f.rows[0].stage = 'ANALYZE';
  const finish = f.repo.finish;
  f.repo.finish = async (...args) => { outcomes.push(args[2]); return finish(...args); };
  let failed = false;
  const worker = createBatchWorker({ repository: f.repo, prepare: { async run(_staff, job) {
    actions.push(job.analysisActionId);
    if (!failed) {
      failed = true;
      throw Object.assign(new Error('postgresql://private-password@db/private'), { code: 'P2028', meta: {
        error: 'Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5278 ms passed since the start of the transaction.' } });
    }
    return job.stage === 'ANALYZE' ? { kind: 'CONTINUE' } : { kind: 'REVIEW', evidence: {
      authority: 'MACHINE_PROPOSAL', sourceHash: job.sourceHash, reportHash: 'b'.repeat(64), manualRevision: 1 } };
  } }, onError(error) { observed.push(error); throw Error('logger failed'); } });
  try {
    worker.wake(f.staff); await until(() => f.rows[0].state === 'REVIEW');
    assert.equal(observed.length, 1);
    const { location, ...safe } = JSON.parse(JSON.stringify(observed[0]));
    assert.match(location, /^packages\/atlas-batch-grading\/src\/index\.mjs:\d+:\d+$/);
    assert.deepEqual(safe, { code: 'P2028', stage: 'ANALYZE',
      transactionFailureCategory: 'ACTIVE_TIMEOUT', transactionTimeoutMs: 5000, transactionElapsedMs: 5278, errorType: 'Error' });
    assert.equal(observed[0].message, 'P2028'); assert.equal(observed[0].meta, undefined);
    assert.deepEqual(outcomes[0], { kind: 'WAIT', retryAfterMs: 3000, evidence: { transportRetryCount: 1 } });
    assert.equal(new Set(actions).size, 1);
  } finally { await worker.stop(); }
});
