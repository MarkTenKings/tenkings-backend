import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createIntakeIngestionWorker, assertIngestionLease } from '../src/ingestion.mjs';
import { createManualIntake } from '../src/service.mjs';

const until = async condition => { for (let i = 0; i < 200 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(condition()); };
const error = (code, status) => Object.assign(new Error(code), { code, status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ stages = ['VERIFY','VERIFY'], ...overrides } = {}) {
  const ownerId = randomUUID(), jobs = stages.map(stage => ({ uploadId: randomUUID(), cardId: randomUUID(), ownerId,
    accessVersion: 3, claimId: randomUUID(), attempts: 1, failures: 0, stage, state: 'QUEUED' }));
  const calls = [], outcomes = [], workerErrors = [], handles = new WeakSet();
  const repository = {
    async claim(stage) { const job = jobs.find(j => j.stage === stage && j.state === 'QUEUED');
      if (!job) return null; job.state = 'RUNNING'; calls.push(['claim', stage]); return { ...job }; },
    async renew(job) { calls.push(['renew', job.uploadId]); return true; },
    async finish(job, outcome) { outcomes.push({ job, outcome }); const saved = jobs.find(j => j.uploadId === job.uploadId);
      saved.state = outcome.kind === 'CONTINUE' ? 'QUEUED' : outcome.kind;
      if (outcome.kind === 'CONTINUE') saved.stage = 'PREPARE'; return true; },
  };
  const intake = {
    async complete(staff, cardId, uploadId, options) { assert(handles.has(staff)); assert.equal(options.lease.uploadId, uploadId); calls.push(['complete', uploadId]); },
    async prepare(staff, cardId, uploadId, options) { assert(handles.has(staff)); assert.equal(options.lease.cardId, cardId); calls.push(['prepare', uploadId]); },
  };
  const authorityFor = async job => { assert.equal(job.ownerId, ownerId); const staff = Object.freeze({ id: ownerId }); handles.add(staff); return staff; };
  const f = { jobs, calls, outcomes, workerErrors, repository, intake, authorityFor };
  f.worker = createIntakeIngestionWorker({ repository, intake, authorityFor, intervalMs: 10, heartbeatMs: 10,
    random: () => 0.5, onError: event => workerErrors.push(event), ...overrides });
  return f;
}

test('startup finds queued originals, prepares and hands off without any browser or owner wake', async () => {
  const f = fixture(); assert.equal(f.worker.status().stopped, true);
  f.worker.start();
  try { await until(() => f.jobs.every(job => job.state === 'COMPLETE'));
    assert.equal(f.calls.filter(c => c[0] === 'complete').length, 2);
    assert.equal(f.calls.filter(c => c[0] === 'prepare').length, 2);
    assert.equal(f.outcomes.filter(r => r.outcome.kind === 'CONTINUE').length, 2);
  } finally { await f.worker.stop(); }
});

test('verification remains independent of blocked native preparation and both pools stay bounded', async () => {
  const gate = deferred(), f = fixture({ stages: ['PREPARE','PREPARE','PREPARE','VERIFY','VERIFY','VERIFY','VERIFY'],
    verificationConcurrency: 2, preparationConcurrency: 1 });
  let native = 0, maxNative = 0, verified = 0;
  f.intake.prepare = async () => { native++; maxNative = Math.max(native, maxNative); await gate.promise; native--; };
  f.intake.complete = async () => { verified++; };
  f.worker.start();
  try { await until(() => verified === 4);
    assert.equal(native, 1); assert.equal(maxNative, 1);
    assert.equal(f.jobs.filter(j => j.state === 'COMPLETE').length, 0);
    gate.resolve(); await until(() => f.jobs.every(j => j.state === 'COMPLETE'));
    assert.equal(maxNative, 1);
  } finally { gate.resolve(); await f.worker.stop(); }
});

test('persisted ADMIT work replays the exact existing upload after process replacement', async () => {
  const f = fixture({ stages: ['ADMIT'] }); f.worker.start();
  try { await until(() => f.jobs[0].state === 'COMPLETE');
    assert.deepEqual(f.calls.filter(c => ['prepare','complete'].includes(c[0])), [['prepare', f.jobs[0].uploadId]]);
  } finally { await f.worker.stop(); }
});

test('fast missing-photo backlog yields to already prepared and admission work every cycle', async () => {
  const claims = [], done = deferred(); let verifies = 0;
  const f = fixture({ stages: ['PREPARE', 'ADMIT'], verificationConcurrency: 2,
    preparationConcurrency: 1, admissionConcurrency: 1, intervalMs: 60000 });
  const originalClaim = f.repository.claim;
  f.repository.claim = async (stage, ...args) => {
    // A real database claim yields while the previous absent-object check
    // completes. An arbitrarily replenished backlog must not own the cycle.
    await new Promise(resolve => setImmediate(resolve));
    claims.push(stage);
    if (stage === 'VERIFY' && verifies < 100) return { ...f.jobs[0], stage,
      uploadId: randomUUID(), attempts: ++verifies, failures: 0 };
    return originalClaim(stage, ...args);
  };
  f.repository.finish = async (job, outcome) => {
    f.outcomes.push({ job, outcome });
    if (job.stage === 'ADMIT') done.resolve();
    return true;
  };
  f.intake.complete = async () => { throw error('INTAKE_UPLOAD_ABSENT', 409); };
  f.worker.start();
  try {
    await done.promise;
    assert.equal(claims.indexOf('PREPARE'), 2);
    assert.equal(claims.indexOf('ADMIT'), 3);
    assert.equal(verifies, 2);
    assert(f.outcomes.some(({ job, outcome }) => job.stage === 'ADMIT' && outcome.kind === 'COMPLETE'));
  } finally { await f.worker.stop(); }
});

test('durable machine source/admission success is independent of a failed optional post-commit wake', async () => {
  const cardId=randomUUID(),uploadId=randomUUID(),lease={cardId,uploadId,claimId:randomUUID()},upload={uploadId,
    verification:{sha256:'a'.repeat(64)},source:{ref:'retained source'}},card={cardId,ready:true};let committed=0,wakes=0;
  const intake=createManualIntake({repository:{upload:async()=>({upload}),recordSource:async(staff,id,side,source,options)=>{
    assert.equal(id,cardId);assert.equal(side,uploadId);assert.equal(options.lease,lease);committed++;return {card,upload};
  }},storage:{},artifacts:{},processPhoto:()=>{throw Error('No new native work for ADMIT');},
  sourcePrepared:async()=>{wakes++;throw Error('Optional wake unavailable');}});
  assert.deepEqual(await intake.prepare({},cardId,uploadId,{lease}),{card,upload});assert.equal(committed,1);assert.equal(wakes,0);
});

test('missing upload waits on the same intent indefinitely; native operational retry uses durable failure count', async () => {
  const f = fixture(); f.jobs[0].attempts = 80;
  f.intake.complete = async (staff, cardId, uploadId) => { throw error(uploadId === f.jobs[0].uploadId ? 'INTAKE_UPLOAD_ABSENT' : 'PHOTO_STORAGE_UNAVAILABLE', 503); };
  f.jobs[1].failures = 6; f.worker.start();
  try { await until(() => f.outcomes.length === 2);
    const missing = f.outcomes.find(x => x.job.uploadId === f.jobs[0].uploadId).outcome;
    assert.equal(missing.kind, 'WAIT'); assert.equal(missing.failure, false); assert.equal(missing.retryAfterMs, 60000);
    const outage = f.outcomes.find(x => x.job.uploadId === f.jobs[1].uploadId).outcome;
    assert.equal(outage.kind, 'WAIT'); assert.equal(outage.failure, true); assert.equal(outage.retryAfterMs, 60000);
  } finally { await f.worker.stop(); }
});

test('confirmed outages recover after more than six durable retries without a browser request', async () => {
  const f = fixture({ stages: ['PREPARE'] }), failures = ['PHOTO_STORAGE_UNAVAILABLE', 'PHOTO_STORAGE_TIMEOUT',
    'ECONNRESET', 'ETIMEDOUT', 'P1001', 'P2024', 'P2034', 'UPSTREAM_UNAVAILABLE', 'PHOTO_STORAGE_TIMEOUT'];
  let attempts = 0;
  f.intake.prepare = async () => { const code = failures[attempts++]; if (code) throw error(code, code === 'UPSTREAM_UNAVAILABLE' ? 503 : undefined); };
  f.worker.start();
  try {
    for (let i = 0; i < failures.length; i++) {
      await until(() => f.outcomes.length === i + 1);
      const { job, outcome } = f.outcomes[i];
      assert.equal(outcome.kind, 'WAIT'); assert.equal(outcome.failure, true); assert.equal(outcome.code, failures[i]);
      assert.equal(job.failures, i); assert(outcome.retryAfterMs > 0 && outcome.retryAfterMs <= 60000);
      f.jobs[0].failures++; f.jobs[0].attempts++; f.jobs[0].state = 'QUEUED'; await f.worker.tick();
    }
    await until(() => f.jobs[0].state === 'COMPLETE');
    assert.equal(attempts, 10); assert.equal(new Set(f.outcomes.map(v => v.job.uploadId)).size, 1);
  } finally { await f.worker.stop(); }
});

test('quality, mismatch and permanent access errors remain attention even with a transient HTTP wrapper', async () => {
  for (const code of ['PHOTO_FORMAT_UNSUPPORTED', 'PHOTO_DECODE_INVALID', 'PHOTO_SOURCE_MISMATCH', 'MANUAL_MACHINE_ACCESS_DENIED']) {
    const f = fixture({ stages: ['PREPARE'] }); f.intake.prepare = async () => { throw error(code, 503); }; f.worker.start();
    try { await until(() => f.outcomes.length === 1); assert.equal(f.outcomes[0].outcome.kind, 'ATTENTION'); }
    finally { await f.worker.stop(); }
  }
});

test('wrapped Prisma raw-query retries only confirmed operational SQLSTATEs', async () => {
  for (const [sqlstate, expected] of [['55P03', 'WAIT'], ['40P01', 'WAIT'], ['40001', 'WAIT'], ['57014', 'WAIT'],
    ['23514', 'ATTENTION'], ['42501', 'ATTENTION'], ['42P01', 'ATTENTION'], [undefined, 'ATTENTION']]) {
    const f = fixture({ stages: ['PREPARE'] }); f.jobs[0].failures = 20;
    f.intake.prepare = async () => { throw Object.assign(error('P2010'), { meta: { code: sqlstate } }); }; f.worker.start();
    try { await until(() => f.outcomes.length === 1); assert.equal(f.outcomes[0].outcome.kind, expected, String(sqlstate)); }
    finally { await f.worker.stop(); }
  }
});

test('P2028 emits only its safe failure category while retaining the existing upload retry', async () => {
  const f = fixture({ stages: ['PREPARE'] });
  f.intake.prepare = async () => { throw Object.assign(error('P2028'), { meta: {
    error: 'Unable to start a transaction in the given time.', databaseUrl: 'postgresql://private-password@db/private' } }); };
  f.worker.start();
  try {
    await until(() => f.outcomes.length === 1);
    assert.deepEqual(f.workerErrors, [{ code: 'P2028', transactionFailureCategory: 'START_WAIT' }]);
    assert.deepEqual(f.outcomes[0].outcome, { kind: 'WAIT', code: 'P2028', retryAfterMs: 1000, failure: true });
    assert.equal(f.outcomes[0].job.uploadId, f.jobs[0].uploadId);
  } finally { await f.worker.stop(); }
});

test('owner revocation refuses all effects and saves a safe attention code', async () => {
  const f = fixture({ authorityFor: async () => { throw error('MANUAL_MACHINE_ACCESS_DENIED', 403); } }); f.worker.start();
  try { await until(() => f.outcomes.length === 2);
    assert.equal(f.calls.filter(c => ['prepare','complete'].includes(c[0])).length, 0);
    assert(f.outcomes.every(x => x.outcome.kind === 'ATTENTION' && x.outcome.code === 'MANUAL_MACHINE_ACCESS_DENIED'));
  } finally { await f.worker.stop(); }
});

test('lease loss aborts native work and cannot finish success', async () => {
  const f = fixture({ stages: ['PREPARE'] });
  f.repository.renew = async () => false;
  f.intake.prepare = async (staff, cardId, uploadId, { signal }) => { await new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); };
  f.worker.start();
  try { await until(() => f.outcomes.length === 1);
    assert.equal(f.outcomes[0].outcome.kind, 'WAIT'); assert.equal(f.outcomes[0].outcome.code, 'INTAKE_LEASE_LOST');
  } finally { await f.worker.stop(); }
});

test('shutdown during claim returns the exact lease without beginning storage or native work', async () => {
  const gate = deferred(), entered = deferred(), f = fixture();
  const claim = f.repository.claim;
  f.repository.claim = async (...args) => { const job = await claim(...args); entered.resolve(); await gate.promise; return job; };
  f.worker.start(); await entered.promise; const stop = f.worker.stop(); gate.resolve(); await stop;
  assert.equal(f.calls.filter(c => ['prepare','complete'].includes(c[0])).length, 0);
  assert.equal(f.outcomes[0].outcome.kind, 'WAIT'); assert.equal(f.worker.start(), false);
});

test('evidence adoption requires exact current upload, owner and unexpired durable claim', async () => {
  const card = { id: randomUUID(), owner_id: randomUUID(), front_upload_id: randomUUID(), back_upload_id: null };
  const lease = { cardId: card.id, ownerId: card.owner_id, uploadId: card.front_upload_id, claimId: randomUUID(), accessVersion: 3 };
  let rows = [1], calls = 0; const tx = { async $queryRawUnsafe(sql, ...params) { calls++; assert(sql.includes('lease_until>clock_timestamp()')); assert.deepEqual(params, [lease.uploadId,lease.claimId,3]); return rows; } };
  await assertIngestionLease(tx, card, lease.uploadId, lease); assert.equal(calls, 1);
  rows = []; await assert.rejects(assertIngestionLease(tx, card, lease.uploadId, lease), e => e.code === 'INTAKE_LEASE_LOST');
  rows = [1]; await assert.rejects(assertIngestionLease(tx, { ...card, front_upload_id: randomUUID() }, lease.uploadId, lease), e => e.code === 'INTAKE_LEASE_LOST');
  await assert.rejects(assertIngestionLease(tx, card, lease.uploadId, { ...lease, ownerId: randomUUID() }), e => e.code === 'INTAKE_LEASE_LOST');
});
