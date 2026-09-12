import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createIntakeClient } from '../src/client.mjs';
import { memoryJournal, sha } from './helpers.mjs';
const cardId = '00000000-0000-4000-8000-000000000001', uploadId = '00000000-0000-4000-8000-000000000002';
const fail = code => Object.assign(new Error(code), { code });
function setup({ losePlan = false, losePut = false, failPrepare = false } = {}) {
  const journal = memoryJournal(), calls = []; let plan = null, original = null, putCount = 0;
  const request = async (url, { body }) => {
    calls.push({ url, body });
    if (url.endsWith('/uploads')) {
      if (plan) assert.deepEqual(body, plan); else plan = body;
      if (losePlan) { losePlan = false; throw fail('NETWORK_LOST'); }
      return { upload: { uploadId } };
    }
    if (url.endsWith('/complete')) {
      if (!original) throw fail('INTAKE_UPLOAD_ABSENT');
      return { upload: { uploadId, verification: { sha256: sha(original), byteCount: original.length } } };
    }
    if (url.endsWith('/sign')) return { state: 'UPLOAD', method: 'PUT', uploadId, byteCount: plan.byteCount,
      url: 'https://storage.invalid/exact-key', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*',
        'x-amz-checksum-sha256': Buffer.from(plan.sha256, 'hex').toString('base64') } };
    if (url.endsWith('/prepare')) {
      if (failPrepare) { failPrepare = false; throw fail('PHOTO_DECODE_TIMEOUT'); }
      return { upload: { uploadId, source: { ref: 'synthetic' } } };
    }
    throw new Error(`Unexpected ${url}`);
  };
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://storage.invalid/exact-key'); assert.equal(options.method, 'PUT');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['If-None-Match'], '*'); assert.equal(options.headers['Content-Type'], 'application/octet-stream');
    original = Buffer.from(await options.body.arrayBuffer()); putCount++;
    assert.equal(sha(original), plan.sha256);
    if (losePut) { losePut = false; throw fail('NETWORK_LOST'); }
    return { status: 200 };
  };
  const client = () => createIntakeClient({ request, journal, fetchImpl, cryptoImpl: webcrypto });
  return { journal, calls, client, get puts() { return putCount; }, get original() { return original; } };
}
test('lost plan reply survives client recreation and replays exact request and untouched Blob', async () => {
  const fixture = setup({ losePlan: true }), file = new Blob([Uint8Array.from([0, 11, 23, 255])]);
  await assert.rejects(fixture.client().upload(cardId, 'FRONT', 0, file), { code: 'NETWORK_LOST' });
  const pending = await fixture.client().pending(); assert.equal(pending.length, 1);
  await fixture.client().resume(pending[0].id);
  assert.equal(fixture.puts, 1); assert.deepEqual(fixture.original, Buffer.from(await file.arrayBuffer()));
  assert.equal((await fixture.client().pending()).length, 0);
  const plans = fixture.calls.filter(call => call.url.endsWith('/uploads')); assert.deepEqual(plans[0], plans[1]);
});
test('lost successful PUT response reconciles exact key and never blindly uploads twice', async () => {
  const fixture = setup({ losePut: true });
  await fixture.client().upload(cardId, 'FRONT', 0, new Blob(['unchanged-native-photo']));
  assert.equal(fixture.puts, 1); assert.equal(fixture.calls.filter(call => call.url.endsWith('/complete')).length, 2);
});
test('working preparation failure retains pending original for same-upload resume after reload', async () => {
  const fixture = setup({ failPrepare: true });
  await assert.rejects(fixture.client().upload(cardId, 'BACK', 0, new Blob(['original'])), { code: 'PHOTO_DECODE_TIMEOUT' });
  const [pending] = await fixture.client().pending(); assert.equal(pending.value.uploadId, uploadId);
  await fixture.client().resume(pending.id); assert.equal(fixture.puts, 1);
  assert.equal((await fixture.client().pending()).length, 0);
});
test('verified unsupported work can release its local pending Blob after fresh receipt confirmation', async () => {
  const fixture = setup({ failPrepare: true });
  await assert.rejects(fixture.client().upload(cardId, 'BACK', 0, new Blob(['original'])));
  const [pending] = await fixture.client().pending(); assert.equal(pending.value.verified, true);
  await fixture.client().forgetVerified(pending.id);
  assert.equal((await fixture.client().pending()).length, 0); assert.equal(fixture.puts, 1);
});
test('persisted byte corruption refuses before dispatch and keeps exact pending plan', async () => {
  const fixture = setup({ losePlan: true });
  await assert.rejects(fixture.client().upload(cardId, 'FRONT', 0, new Blob(['original'])));
  const [pending] = await fixture.client().pending(); pending.value.file = new Blob(['differen']);
  await assert.rejects(fixture.client().resume(pending.id), { code: 'INTAKE_PENDING_BYTES_CONFLICT' });
  assert.equal(fixture.puts, 0); assert.equal((await fixture.client().pending()).length, 1);
});
