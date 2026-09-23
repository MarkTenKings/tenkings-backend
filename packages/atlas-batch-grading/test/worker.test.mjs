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
test('temporary native capacity waits on the same job instead of requiring human recovery',async()=>{
 const f=fixture(1),actions=[];let refused=false;
 const worker=createBatchWorker({repository:f.repo,prepare:{async run(_staff,job){
  if(job.stage==='ANALYZE'){actions.push(job.analysisActionId);if(!refused){refused=true;throw Object.assign(new Error('Busy'),{code:'MANUAL_PROCESSING_BUSY',status:503});}}
  return job.stage==='REPORT'?{kind:'REVIEW',evidence:{authority:'MACHINE_PROPOSAL',sourceHash:job.sourceHash,reportHash:'a'.repeat(64),manualRevision:1}}:{kind:'CONTINUE'};
 }}});
 try{worker.wake(f.staff);await until(()=>f.rows[0].state==='REVIEW');assert.equal(actions.length,2);assert.equal(new Set(actions).size,1);assert.equal(f.rows[0].code,undefined);}
 finally{worker.stop();}
});
