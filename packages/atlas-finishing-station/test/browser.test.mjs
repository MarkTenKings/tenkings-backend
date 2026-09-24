import test from 'node:test';
import assert from 'node:assert/strict';
import { createStationBrowserClient, takeStationPairingCode } from '../src/browser.mjs';
const code = 'a'.repeat(43), token = 'b'.repeat(43), plan = { planHash: 'c'.repeat(64), binding: { cardId: 'card', approvalActionId: 'approval' } };
function fixture() {
  const values = new Map(), calls = [], f = { values, calls, loss: false, ready: true, operation: { planHash: plan.planHash, print: { state: 'UNKNOWN' }, nfc: { state: 'WAITING_FOR_TAG' }, completed: false } };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); let result;
    if (url.endsWith('/pair')) result = { credential: token, ready: f.ready, stationId: 'station', enrollmentId: 'enrollment', state: 'READY', protectedKey: true, activePlanHash: null };
    else if (url.endsWith('/prepare')) { if (f.loss) { f.loss = false; throw Error('Lost reply'); } result = f.operation; }
    else if (url.endsWith('/operation') || url.endsWith('/acknowledge')) result = f.operation;
    else result = { ready: f.ready, stationId: 'station', enrollmentId: 'enrollment', state: 'READY', activePlanHash: null };
    return { ok: true, text: async () => JSON.stringify({ ok: true, result }) };
  };
  const request = async (path, options) => { calls.push({ path, options }); return { plan, association: { planHash: plan.planHash } }; };
  f.client = createStationBrowserClient({ fetchImpl, request, storage, uuid: () => 'same-uuid' }); f.options = { fetchImpl, request, storage }; return f;
}
test('pairing code is stripped before any request; no credentials or secrets are persisted', async () => {
  const calls = [], location = { hash: `#atlasStationLaunch=v1&atlasStationPair=${code}`, pathname: '/admin/station', search: '' };
  assert.equal(takeStationPairingCode(location, { state: null, replaceState: (...args) => calls.push(args) }), code);
  assert.deepEqual(calls[0], [null, '', '/admin/station']);
  const f = fixture(); await f.client.pair(code); f.client.select(true); await f.client.finish(plan, 'staff');
  assert.doesNotMatch([...f.values.values()].join(''), new RegExp(`${code}|${token}`));
  assert.equal(f.calls[0].options.credentials, 'omit'); assert.equal(f.calls[0].options.redirect, 'error');
  assert.equal(f.calls.find(value => value.url?.endsWith('/prepare')).options.headers['x-atlas-station-token'], token);
});
test('lost preparation response retains exact arm request and fences other cards until recovery', async () => {
  const f = fixture(); await f.client.pair(code); f.client.select(true); f.loss = true;
  await assert.rejects(f.client.finish(plan, 'staff'), /Lost reply/);
  await assert.rejects(f.client.finish({ ...plan, planHash: 'd'.repeat(64) }, 'staff'), /PREVIOUS_CARD/);
  await f.client.resume('staff'); const bodies = f.calls.filter(value => value.path?.endsWith('/arm')).map(value => value.options.body);
  assert.equal(bodies.length, 1); assert.equal(bodies[0].requestId, 'same-uuid');
  const restarted = createStationBrowserClient(f.options); assert.equal(restarted.snapshot().selected, true); assert.equal(restarted.snapshot().paired, false);
  assert.equal(restarted.snapshot().pending.planHash, plan.planHash);
  await assert.rejects(restarted.resume('other-staff'), /PREVIOUS_CARD/);
});
test('unqualified/unpaired stations cannot be selected and failed durable storage prevents arm', async () => {
  const f = fixture(); assert.throws(() => f.client.select(true), /SETUP_PENDING/); f.ready = false; await f.client.pair(code); assert.throws(() => f.client.select(true), /SETUP_PENDING/);
  const broken = createStationBrowserClient({ ...f.options, storage: { getItem: () => null, setItem: () => { throw Error('quota'); } } });
  f.ready = true; await broken.pair(code); assert.throws(() => broken.select(true), /PERSISTENCE_REQUIRED/);
  assert.equal(f.calls.filter(value => value.path?.endsWith('/arm')).length, 0);
});
test('read and operation never request a new arm; receipts are relayed verbatim without fabricated success', async () => {
  const f = fixture(); await f.client.pair(code); await f.client.read(); await f.client.operation(plan.planHash);
  assert.equal(f.calls.filter(value => value.path?.endsWith('/arm')).length, 0);
  f.operation = { ...f.operation, write: { receipt: { actual: 'signed' }, signature: 'native-signature' } };
  await f.client.operation(plan.planHash);
  assert.deepEqual(f.calls.find(value => value.path?.endsWith('/acknowledge')).options.body, f.operation.write);
});

test('malformed successful local recovery and failed custody relay never request another arm', async () => {
  const f = fixture(); await f.client.pair(code); f.client.select(true); f.loss = true;
  await assert.rejects(f.client.finish(plan, 'staff'));
  f.operation = null; await assert.rejects(f.client.resume('staff'), /STATION_RESPONSE_INVALID/);
  assert.equal(f.calls.filter(value => value.path?.endsWith('/arm')).length, 1);
  f.operation = { planHash: plan.planHash, completed: false, write: { receipt: {}, signature: 'signed' } };
  f.client.setRequest(async () => { throw { code: 'STATION_INTENT_MISSING', status: 404 }; });
  await assert.rejects(f.client.resume('staff')); assert.equal(f.calls.filter(value => value.path?.endsWith('/arm')).length, 1);
});
