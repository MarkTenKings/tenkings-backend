import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createReportPhotoClient } from '../lib/report-photo-client.mjs';

const cardId = '00000000-0000-4000-8000-000000000001', staffId = '00000000-0000-4000-8000-000000000002';
const approvalActionId = '00000000-0000-4000-8000-000000000003', uploadId = '00000000-0000-4000-8000-000000000004';
const error = code => Object.assign(new Error(code), { code });
function fixture() {
  const calls = [], rows = new Map();
  const storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
  const current = { revision: 0, approvalActionId, presentation: null }, photo = new Blob(['exact original photograph bytes'], { type: 'image/jpeg' });
  const f = { calls, rows, storage, current, photo, uploaded: false, completed: false, planLost: false, completeLost: false, putLost: false };
  f.request = async (path, options) => {
    calls.push({ path, body: structuredClone(options?.body) });
    if (!options) return structuredClone(current);
    if (path.endsWith('/uploads')) { if (f.planLost) { f.planLost = false; throw error('NETWORK_LOST'); } return { uploadId }; }
    if (path.endsWith('/sign')) return { state: 'UPLOAD', method: 'PUT', url: 'https://private.example.test/photo?signature=test', headers: { 'Content-Type': 'image/jpeg' } };
    if (path.endsWith('/complete')) {
      if (!f.uploaded) throw error('PRESENTATION_UPLOAD_ABSENT');
      f.completed = true; current.revision = 1; current.presentation = { slabPhoto: { url: '/verified-photo.webp' } };
      if (f.completeLost) { f.completeLost = false; throw error('NETWORK_LOST'); }
      return structuredClone(current);
    }
    if (path.endsWith('/remove')) { current.revision = 2; current.presentation = {}; if (f.removeLost) { f.removeLost = false; throw error('NETWORK_LOST'); } return structuredClone(current); }
    throw error('UNEXPECTED_REQUEST');
  };
  f.fetchImpl = async (url, options) => { f.put = { url, options }; f.putCount = (f.putCount ?? 0) + 1; f.uploaded = true; if (f.putLost) throw error('LOST_PUT_REPLY'); return { ok: true }; };
  f.client = () => createReportPhotoClient({ cardId, staffId, request: f.request, storage, fetchImpl: f.fetchImpl, cryptoImpl: webcrypto });
  return f;
}
test('optional photo uploads unchanged bytes once and requires server completion before clearing its request', async () => {
  const f = fixture(), client = f.client(); await client.upload(f.photo, f.current, 'Actual slab');
  assert.equal(f.put.options.body, f.photo); assert.equal(f.put.options.credentials, 'omit'); assert.equal(f.put.options.redirect, 'error');
  assert.equal(f.putCount, 1); assert.equal(f.completed, true); assert.equal(client.pending(), null);
  const plan = f.calls.find(call => call.path.endsWith('/uploads')).body;
  assert.equal(plan.byteCount, f.photo.size); assert.match(plan.sha256, /^[a-f0-9]{64}$/); assert.equal(plan.approvalActionId, approvalActionId);
});
test('lost PUT reply reconciles saved bytes and a lost completion resumes without another PUT or new plan', async () => {
  const f = fixture(); f.putLost = true; f.completeLost = true; const client = f.client();
  await assert.rejects(client.upload(f.photo, f.current, 'Actual slab'), /NETWORK_LOST/);
  assert.equal(client.pending().uploadId, uploadId);
  const restored = f.client(); await restored.resume();
  assert.equal(f.putCount, 1); assert.equal(f.calls.filter(call => call.path.endsWith('/uploads')).length, 1); assert.equal(restored.pending(), null);
});
test('unknown plan reuses its exact request and checks completion before asking for the original file', async () => {
  const f = fixture(); f.planLost = true; const client = f.client();
  await assert.rejects(client.upload(f.photo, f.current, 'Actual slab'), /NETWORK_LOST/);
  const intent = client.pending().input;
  await assert.rejects(f.client().resume(), /PRESENTATION_SAVED_FILE_REQUIRED/);
  const plans = f.calls.filter(call => call.path.endsWith('/uploads')); assert.equal(plans.length, 2); assert.deepEqual(plans[0].body, plans[1].body);
  await assert.rejects(f.client().resume(new Blob(['different file'])), /PRESENTATION_SAVED_FILE_MISMATCH/);
  assert.deepEqual(f.client().pending().input, intent); assert.equal(f.putCount, undefined);
  await f.client().resume(f.photo); assert.equal(f.putCount, 1); assert.equal(f.client().pending(), null);
});
test('pending requests block replacements and isolated staff/card storage cannot expose another operation', async () => {
  const f = fixture(); f.planLost = true; const client = f.client(); await assert.rejects(client.upload(f.photo, f.current, 'Actual slab'));
  await assert.rejects(client.upload(f.photo, f.current, 'Different request'), /PRESENTATION_REQUEST_PENDING/);
  const other = createReportPhotoClient({ cardId, staffId: '00000000-0000-4000-8000-000000000099', request: f.request, storage: f.storage });
  assert.equal(other.pending(), null); assert.equal(f.calls.length, 1);
});
test('uncertain removal retains exact intent; supersession requires fresh server evidence', async () => {
  const f = fixture(), client = f.client(); await client.upload(f.photo, f.current, 'Actual slab'); f.removeLost = true;
  await assert.rejects(client.remove(f.current), /NETWORK_LOST/); const saved = client.pending();
  await client.resume(); const calls = f.calls.filter(call => call.path.endsWith('/remove')); assert.deepEqual(calls[0].body, calls[1].body); assert.equal(client.pending(), null);
  f.storage.setItem(`atlas-report-photo:${staffId}:${cardId}`, JSON.stringify(saved)); f.current.revision = saved.input.expectedRevision;
  await assert.rejects(client.reconcileSuperseded(), /PRESENTATION_REQUEST_CURRENT/); assert.ok(client.pending());
  f.current.revision++; await client.reconcileSuperseded(); assert.equal(client.pending(), null);
});
