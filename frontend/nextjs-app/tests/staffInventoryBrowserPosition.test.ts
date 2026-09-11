import assert from 'node:assert/strict';
import test from 'node:test';
import { readStaffInventoryPosition } from '../lib/staffInventoryBrowserPosition';

function fixture() {
  let success!: PositionCallback, failure!: PositionErrorCallback, options: PositionOptions | undefined;
  const cleared: number[] = [];
  const geolocation = {
    watchPosition(onPosition: PositionCallback, onError: PositionErrorCallback | null | undefined, opts?: PositionOptions) { success = onPosition; failure = onError!; options = opts; return 17; },
    clearWatch(id: number) { cleared.push(id); },
    getCurrentPosition() { throw new Error('Use refinement'); },
  };
  return {
    geolocation, cleared, options: () => options,
    position(accuracy: number, timestamp = Date.now()) { success({ coords: { latitude: 38, longitude: -121, accuracy }, timestamp } as GeolocationPosition); },
    fail(code: number) { failure({ code, message: 'Fixture failure' } as GeolocationPositionError); },
  };
}

test('coarse permission-granted fix refines, emits safe accuracy progress and stops watching', async () => {
  const f = fixture(), messages: string[] = [], controller = new AbortController();
  const promise = readStaffInventoryPosition({ signal: controller.signal, geolocation: f.geolocation, onProgress: m => messages.push(m) });
  f.position(400); f.position(18);
  assert.equal((await promise).accuracy, 18); assert.deepEqual(f.cleared, [17]);
  assert.deepEqual(f.options(), { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  assert.match(messages[0], /400 m accuracy.*Improving/); assert.match(messages[1], /18 m accuracy.*Checking/);
  assert.ok(messages.every(m => !m.includes('-121')));
  f.position(2); assert.equal(messages.length, 2); controller.abort(); assert.deepEqual(f.cleared, [17]);
});

test('bounded deadline returns best usable reading, not the last worse reading', async () => {
  const f = fixture(), controller = new AbortController();
  const promise = readStaffInventoryPosition({ signal: controller.signal, geolocation: f.geolocation, timeoutMs: 20 });
  f.position(300); f.position(110); f.position(700);
  assert.equal((await promise).accuracy, 110); assert.deepEqual(f.cleared, [17]);
});

test('deadline without a valid fresh reading reports timeout and stops observation', async () => {
  const f = fixture(), controller = new AbortController();
  const promise = readStaffInventoryPosition({ signal: controller.signal, geolocation: f.geolocation, timeoutMs: 20 });
  f.position(3, Date.now() - 400000); f.position(Number.NaN); f.position(-1);
  await assert.rejects(promise, (e: { code: number }) => e.code === 3); assert.deepEqual(f.cleared, [17]);
});

test('manual cancellation discards even a good pending fix and ignores late updates', async () => {
  const f = fixture(), controller = new AbortController(), messages: string[] = [];
  const promise = readStaffInventoryPosition({ signal: controller.signal, geolocation: f.geolocation, onProgress: m => messages.push(m) });
  f.position(130); controller.abort();
  await assert.rejects(promise, { name: 'AbortError' }); f.position(5);
  assert.equal(messages.length, 1); assert.deepEqual(f.cleared, [17]);
});

test('denial never reuses an earlier coarse position; unavailable after a position retains it', async () => {
  const denied = fixture(), unavailable = fixture(), signal = new AbortController().signal;
  const first = readStaffInventoryPosition({ signal, geolocation: denied.geolocation });
  denied.position(120); denied.fail(1); await assert.rejects(first, (e: { code: number }) => e.code === 1);
  const second = readStaffInventoryPosition({ signal, geolocation: unavailable.geolocation });
  unavailable.position(120); unavailable.fail(2); assert.equal((await second).accuracy, 120);
  assert.deepEqual(denied.cleared, [17]); assert.deepEqual(unavailable.cleared, [17]);
});

test('pre-cancelled calls never ask for position and synchronous adapters are cleaned up', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(readStaffInventoryPosition({ signal: controller.signal, geolocation: f.geolocation }), { name: 'AbortError' });
  assert.equal(f.options(), undefined);
  const clear: number[] = [];
  const geolocation = { ...f.geolocation, clearWatch(id: number) { clear.push(id); }, watchPosition(received: PositionCallback) { received({ coords: { latitude: 38, longitude: -121, accuracy: 7 }, timestamp: Date.now() } as GeolocationPosition); return 19; } };
  assert.equal((await readStaffInventoryPosition({ signal: new AbortController().signal, geolocation })).accuracy, 7);
  assert.deepEqual(clear, [19]);
});
