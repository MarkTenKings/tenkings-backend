import assert from 'node:assert/strict';
import test from 'node:test';
import { saveStaffInventoryPhoto } from '../lib/staffInventoryPhotoRequest';

const input = () => ({ image: 'data:image/jpeg;base64,fixture', uploadId: '11111111-1111-4111-8111-111111111111', headers: { Authorization: 'Bearer fixture' }, signal: new AbortController().signal });
const photo = { photo_key: 'inventory-photos/fixture/photo.jpg', photo_url: 'https://fixture.invalid/private.jpg' };

test('a slow first transfer can finish after the old 35-second deadline without a second upload', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve!: (value: Response) => void, signal: AbortSignal | undefined, calls = 0;
  const pending = saveStaffInventoryPhoto(input(), { fetchImpl: (async (_url, init) => { calls++; signal = init?.signal as AbortSignal; return new Promise<Response>(r => { resolve = r; }); }) as typeof fetch });
  t.mock.timers.tick(40_000);
  assert.equal(signal?.aborted, false); assert.equal(calls, 1);
  resolve(Response.json(photo)); assert.deepEqual(await pending, photo);
  t.mock.timers.reset();
});

test('a lost first response recovers automatically using byte-identical JSON and the same upload identity', async () => {
  const bodies: string[] = [];
  const result = await saveStaffInventoryPhoto(input(), { fetchImpl: (async (_url, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new TypeError('Network connection lost');
    return Response.json(photo);
  }) as typeof fetch });
  assert.deepEqual(result, photo); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[1]).upload_id, input().uploadId);
});

test('temporary server failures get at most one recovery; authorization and invalid input never retry', async () => {
  for (const [status, expected] of [[503, 2], [429, 2], [401, 1], [403, 1], [400, 1], [413, 1]]) {
    let calls = 0;
    await assert.rejects(saveStaffInventoryPhoto(input(), { fetchImpl: (async () => { calls++; return Response.json({}, { status }); }) as typeof fetch }));
    assert.equal(calls, expected);
  }
});

test('timeout recovery has a fresh signal and ignores an eventual result from the first attempt', async () => {
  const signals: AbortSignal[] = []; let resolve!: (value: Response) => void;
  const result = await saveStaffInventoryPhoto(input(), { timeoutMs: 10, fetchImpl: (async (_url, init) => {
    signals.push(init?.signal as AbortSignal);
    if (signals.length === 1) return new Promise<Response>(r => { resolve = r; });
    assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
    return Response.json(photo);
  }) as typeof fetch });
  resolve(Response.json({ ...photo, photo_key: 'late' }));
  assert.deepEqual(result, photo); assert.equal(signals.length, 2);
});

test('closing during upload or recovery backoff cancels the operation and never starts another upload', async () => {
  for (const phase of ['upload', 'backoff']) {
    const controller = new AbortController(); let calls = 0;
    const pending = saveStaffInventoryPhoto({ ...input(), signal: controller.signal }, { fetchImpl: (async () => {
      calls++;
      if (phase === 'upload') { controller.abort(); return new Promise<Response>(() => {}); }
      setTimeout(() => controller.abort(), 5); throw new TypeError('Network');
    }) as typeof fetch });
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1);
  }
});
