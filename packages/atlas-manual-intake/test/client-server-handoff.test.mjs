import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import { createIntakeClient } from '../src/client.mjs';
import { memoryJournal, sha } from './helpers.mjs';

const failure = (code, status = 409) => Object.assign(new Error('private transport detail'), { code, status });
function fixture({ lostComplete = false, putStatus = 200, writeObject = true } = {}) {
  const journal = memoryJournal(), plans = new Map(), calls = [], cardId = randomUUID();
  let puts = 0;
  const request = async (path, { body }) => {
    const operation = path.split('/').at(-1); calls.push(operation);
    if (operation === 'uploads') {
      if (!plans.has(body.requestId)) plans.set(body.requestId, { input: body, bytes: null });
      return { upload: { uploadId: body.requestId } };
    }
    const uploadId = path.split('/').at(-2), plan = plans.get(uploadId);
    if (operation === 'sign') return { state: 'UPLOAD', uploadId, method: 'PUT', byteCount: plan.input.byteCount,
      url: `https://fixture.invalid/${uploadId}?PRIVATE_SIGNED_TOKEN=secret`, headers: { 'If-None-Match': '*' } };
    if (operation === 'complete') {
      if (!plan.bytes) throw failure('INTAKE_UPLOAD_ABSENT');
      assert.equal(sha(plan.bytes), plan.input.sha256);
      if (lostComplete) { lostComplete = false; throw failure('MANUAL_SERVICE_TIMEOUT', 504); }
      return { card: { cardId }, upload: { uploadId, verification: { sha256: sha(plan.bytes), byteCount: plan.bytes.length }, source: null } };
    }
    if (operation === 'prepare') throw failure('BROWSER_MUST_NOT_PREPARE');
    throw Error('Unexpected fixture route');
  };
  const fetchImpl = async (url, { body }) => { puts++; const uploadId = new URL(url).pathname.slice(1);
    if (writeObject) plans.get(uploadId).bytes = Buffer.from(await body.arrayBuffer()); return { status: putStatus }; };
  const client = () => createIntakeClient({ request, journal, fetchImpl, cryptoImpl: webcrypto, serverProcessing: true });
  return { client, journal, calls, plans, cardId, get puts() { return puts; } };
}

test('server mode returns after exact original verification without any browser preparation request', async () => {
  const f = fixture(), bytes = new Blob([Uint8Array.of(0,255,2,9)]);
  const result = await f.client().upload(f.cardId,'FRONT',0,bytes);
  assert(result.upload.verification); assert.equal(result.upload.source,null);
  assert.deepEqual(f.calls,['uploads','sign','complete']); assert.equal(f.puts,1); assert.equal((await f.journal.list()).length,0);
  assert.deepEqual([...f.plans.values()][0].bytes,Buffer.from(await bytes.arrayBuffer()));
});

test('lost verified reply resumes the same plan after browser replacement with no second PUT', async () => {
  const f = fixture({ lostComplete: true });
  await assert.rejects(f.client().upload(f.cardId,'BACK',0,new Blob(['native original'])),{ code: 'MANUAL_SERVICE_TIMEOUT' });
  const [pending] = await f.journal.list(), identity = pending.value.uploadId;
  const result = await f.client().resume(pending.id);
  assert.equal(result.upload.uploadId,identity); assert.equal(f.plans.size,1); assert.equal(f.puts,1); assert(!f.calls.includes('prepare'));
});

test('expired/refused PUT retains safe HTTP detail but never credentials and never counts as verified', async () => {
  const f = fixture({ putStatus: 403, writeObject: false });
  await assert.rejects(f.client().upload(f.cardId,'FRONT',0,new Blob(['native'])),error => {
    assert.equal(error.code,'INTAKE_UPLOAD_ABSENT'); assert.equal(error.status,409);
    assert.equal(error.uploadDiagnostic.status,403); assert.equal(error.uploadDiagnostic.code,'INTAKE_UPLOAD_HTTP_ERROR'); return true;
  });
  const [pending] = await f.journal.list(); assert.equal(pending.value.verified,undefined);
  assert.equal(await pending.value.file.text(),'native');
  const diagnostic = JSON.stringify(pending.value.uploadDiagnostic);
  assert.doesNotMatch(diagnostic,/secret|https:|PRIVATE|token|private transport/); assert(!f.calls.includes('prepare'));
});

test('an HTTP error PUT with exact object present is accepted only through server verification', async () => {
  const f = fixture({ putStatus: 412 });
  const result = await f.client().upload(f.cardId,'FRONT',0,new Blob(['exact bytes']));
  assert(result.upload.verification); assert.equal(f.puts,1); assert.equal((await f.journal.list()).length,0);
});

test('closure after verification before journal cleanup recovers without rereading or resending local bytes', async () => {
  const f = fixture(), remove = f.journal.remove; let interrupted = true;
  f.journal.remove = async id => { if(interrupted){ interrupted=false; throw failure('INTAKE_JOURNAL_UNAVAILABLE'); } return remove(id); };
  await assert.rejects(f.client().upload(f.cardId,'BACK',0,new Blob(['original'])),{code:'INTAKE_JOURNAL_UNAVAILABLE'});
  const [pending] = await f.journal.list(); assert.equal(pending.value.verified,true);
  pending.value.file = { size: pending.value.input.byteCount }; // Device byte object no longer readable.
  await f.client().resume(pending.id); assert.equal(f.puts,1); assert.equal(f.plans.size,1); assert.equal((await f.journal.list()).length,0);
});
