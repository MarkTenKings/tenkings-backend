import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStationController } from '../src/controller.mjs';
import { createStationJournal } from '../src/journal.mjs';
import { createFileMacNfcJournal } from '../../atlas-finishing/src/mac-nfc-journal.mjs';
import { samplePlan } from '../../atlas-finishing/test/manual-fixture.mjs';
import { encodeApprovedNdef } from '../../atlas-finishing/src/mac-nfc.mjs';
import { createStationSigner, stationCanonical, stationHash, stationProfileHash } from '../../atlas-finishing/src/station-protocol.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(read, match) { for (let i = 0; i < 150; i++) { const result = await read(); if (match(result)) { await pause(20); return result; } await pause(10); } assert.fail('Bounded fixture wait expired'); }
async function fixture({ qualified = true, loseWrite = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-bridge-unit-')), pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const host = createStationSigner({ keyId: 'fixture-host', privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const station = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), spki = station.publicKey.export({ type: 'spki', format: 'der' });
  const profile = { id: 'atlas-mac-f8215-production-v1', qualificationHash: 'd'.repeat(64), firstUserPage: 4, lastUserPage: 63 }; profile.profileHash = stationProfileHash(profile);
  const config = { stationId: 'synthetic-station', enrollmentId: '11111111-2222-4333-8444-555555555555', keyId: 'synthetic-key', protectionEvidenceHash: 'e'.repeat(64), hostKeyId: host.keyId, hostPublicKeySpki: host.publicKeySpki, profile };
  const key = { ...config, protectedKey: true, publicKeySpki: spki.toString('base64'), fingerprint: stationHash(spki) };
  const journal = createStationJournal({ directory: join(dir, 'bridge'), fullSync: async () => {} });
  const nfcJournal = createFileMacNfcJournal({ directory: join(dir, 'nfc'), fullSync: async () => {} });
  const f = { dir, config, host, journal, nfcJournal, time: 1000, calls: [], prints: 0, writes: 0, present: true, removed: true, completed: false, resets: 0 };
  const signReceipt = receipt => sign('sha256', Buffer.from(stationCanonical(receipt)), { key: station.privateKey, dsaEncoding: 'der' }).toString('base64url');
  const memory = Buffer.alloc(256); memory.set([3,0,254],16);
  const native = { shutdown() {}, resetAfterCompletion() { f.resets++; }, async request(op, body) {
    f.calls.push(op);
    if (op === 'arm') return { state: qualified ? 'WAITING_FOR_TAG' : 'VERIFIED_UNQUALIFIED' };
    if (op === 'restore-receipt') return { restored: true, state: 'WAITING_FOR_REMOVAL' };
    if (op === 'presence') return f.present ? { state: 'PRESENT', selected: 0 } : { state: 'EMPTY', selected: null };
    if (op === 'open') return { opened: true };
    if (op === 'identify-qualified') return { qualified };
    if (op === 'same-tag') return { sameTag: true };
    if (op === 'read16') return { hex: memory.subarray(body.page * 4, body.page * 4 + 16).toString('hex') };
    if (op === 'write4') { f.writes++; Buffer.from(body.hex, 'hex').copy(memory, body.page * 4); if (loseWrite) throw Error('LOST_WRITE'); return { written: true }; }
    if (op === 'lock-qualified') return { locked: true };
    if (op === 'verify-lock') return { lockVerified: true };
    if (op === 'sign-receipt' || op === 'sign-removal') return { signature: signReceipt(body.receipt) };
    if (op === 'wait-removed') return { removed: f.removed };
    if (op === 'observe-empty') return { empty: f.removed };
    return {};
  } };
  const printer = { capability: { qualified: true }, async prepare() { f.prints++; return { state: 'SPOOL_ACCEPTED' }; }, async status() { return { state: 'SPOOL_ACCEPTED' }; } };
  const args = { config, native, journal, nfcJournal, printer, capabilities: { qualifiedProfileAvailable: qualified }, key, now: () => f.time };
  f.controller = createStationController(args); f.restart = () => { f.controller.stop(); f.controller = createStationController(args); return f.controller; };
  const enrolled = { version: 'atlas-mac-station-enrollment-v1', origin: 'https://atlasgrading.com', stationId: config.stationId, enrollmentId: config.enrollmentId, keyId: config.keyId,
    keyFingerprint: key.fingerprint, protectionEvidenceHash: config.protectionEvidenceHash, state: 'ACTIVE', profileHash: profile.profileHash, qualificationHash: profile.qualificationHash, activationId: 'fixture-activation', issuedAt: 900 };
  await f.controller.enroll({ authorization: await host.signClaims(enrolled) });
  f.input = async (plan = samplePlan()) => {
    const { cardId, approvalActionId, publicHash, reportHash, approvalVersion, reportNumber } = plan.binding;
    const claims = { version: 'atlas-mac-nfc-arm-v1', origin: 'https://atlasgrading.com', stationId: config.stationId, enrollmentId: config.enrollmentId, keyId: config.keyId,
      intentId: plan.nfc.intentId, planHash: plan.planHash, profileHash: profile.profileHash, qualificationHash: profile.qualificationHash, activationId: enrolled.activationId,
      cardId, approvalActionId, publicHash, reportHash, approvalVersion, reportNumber, url: plan.nfc.url, ndefHash: stationHash(encodeApprovedNdef(plan)),
      firstUserPage: profile.firstUserPage, lastUserPage: profile.lastUserPage, nonce: 'N'.repeat(43), issuedAt: 900, expiresAt: 100000 };
    return { plan, association: { armed: true, stationId: config.stationId, planHash: plan.planHash, cardId, approvalActionId, expiresAt: claims.expiresAt, authorization: await host.signClaims(claims) } };
  };
  f.ack = async (kind, receipt) => host.signClaims({ version: 'atlas-mac-nfc-ack-v1', kind, intentId: receipt.intentId, receiptHash: stationHash(stationCanonical(receipt)),
    enrollmentId: receipt.enrollmentId, stationId: receipt.stationId, planHash: receipt.planHash, authorizationHash: receipt.authorizationHash, committed: true, recordedAt: f.time });
  f.cleanup = async () => { f.controller.stop(); await pause(50); await rm(dir, { recursive: true, force: true }); }; return f;
}
test('real composition stays cold with empty native qualification; source-mismatched arms cannot print or write', async () => {
  const f = await fixture({ qualified: false }); try {
    assert.equal((await f.controller.status()).state, 'SETUP_PENDING'); await assert.rejects(f.controller.prepare(await f.input()), /SETUP_PENDING/);
    assert.equal(f.prints, 0); assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
  const g = await fixture(); try {
    const input = await g.input(); input.association.authorization.payload = input.association.authorization.payload.slice(0, -1) + 'A';
    await assert.rejects(g.controller.prepare(input)); assert.equal(g.prints, 0); assert.equal(g.writes, 0);
  } finally { await g.cleanup(); }
});
test('independent print/NFC dispatch retains durable receipt, verifies both hosted acknowledgements, and fences the next card until removal completion', async () => {
  const f = await fixture(); try {
    const input = await f.input(); await f.controller.prepare(input);
    const written = await waitFor(() => f.nfcJournal.read(input.plan.nfc.intentId), value => value?.receipt);
    assert.equal(f.prints, 1); assert.ok(f.writes > 0);
    await assert.rejects(f.controller.prepare(await f.input(samplePlan({ version: 4 }))), /PREVIOUS_CARD_UNRESOLVED/);
    const writes = f.writes;
    await f.controller.acknowledge({ authorization: await f.ack('WRITE', written.receipt) });
    const removed = await waitFor(() => f.journal.get(input.plan.planHash), value => value?.removal);
    assert.equal((await f.journal.state()).active, input.plan.planHash);
    const ack = await f.ack('REMOVAL', removed.removal.receipt);
    const done = await f.controller.acknowledge({ authorization: ack }); assert.equal(done.completed, true); assert.equal(done.nfc.state, 'COMPLETE');
    assert.equal((await f.journal.state()).active, null); assert.equal(f.resets, 1);
    await f.controller.acknowledge({ authorization: ack }); assert.equal(f.resets, 1);
    await f.controller.prepare(input); assert.equal(f.prints, 1); assert.equal(f.writes, writes);
  } finally { await f.cleanup(); }
});
test('lost write outcome survives restart and never reprints, rewrites or emits completion', async () => {
  const f = await fixture({ loseWrite: true }); try {
    const input = await f.input(); await f.controller.prepare(input);
    await waitFor(() => f.nfcJournal.read(input.plan.nfc.intentId), value => value?.state === 'UNKNOWN');
    const writes = f.writes; f.restart(); await f.controller.prepare(input); await pause(30);
    const status = await f.controller.operation({ planHash: input.plan.planHash });
    assert.equal(status.nfc.state, 'UNKNOWN'); assert.equal(status.completed, false); assert.equal(f.prints, 1); assert.equal(f.writes, writes);
  } finally { await f.cleanup(); }
});
test('unexpired restart recovers a signed WRITE receipt through custody-only native restore and no printing/writing', async () => {
  const f = await fixture(); try {
    const input = await f.input(); await f.controller.prepare(input);
    const written = await waitFor(() => f.nfcJournal.read(input.plan.nfc.intentId), value => value?.receipt);
    const writes = f.writes; f.restart();
    await f.controller.acknowledge({ authorization: await f.ack('WRITE', written.receipt) });
    await waitFor(() => f.journal.get(input.plan.planHash), value => value?.removal);
    assert.ok(f.calls.includes('restore-receipt')); assert.equal(f.writes, writes); assert.equal(f.prints, 1);
  } finally { await f.cleanup(); }
});

test('expired restart reconciles the exact saved host acknowledgement without native arm, RF observation or new signatures', async () => {
  const f = await fixture(); f.removed = false;
  try {
    const input = await f.input(); await f.controller.prepare(input);
    const written = await waitFor(() => f.nfcJournal.read(input.plan.nfc.intentId), value => value?.receipt);
    const ack = await f.ack('WRITE', written.receipt), writes = f.writes;
    f.time = 100001; f.restart(); const before = f.calls.length;
    await f.controller.acknowledge({ authorization: ack });
    await waitFor(() => f.nfcJournal.read(input.plan.nfc.intentId), value => value?.hostedAcknowledged);
    assert.deepEqual(f.calls.slice(before), []); assert.equal(f.writes, writes); assert.equal(f.prints, 1);
    const state = await f.journal.get(input.plan.planHash); assert.equal(state.completed, false); assert.equal(state.removal, null);
    assert.equal((await f.journal.state()).active, input.plan.planHash);
  } finally { await f.cleanup(); }
});

test('crash after bridge reservation before NFC reservation can prepare only the missing same NFC intent, never reprint', async () => {
  const f = await fixture(); try {
    const input = await f.input(); await f.journal.reserve(input);
    assert.equal(await f.nfcJournal.read(input.plan.nfc.intentId), null);
    f.restart(); await f.controller.operation({ planHash: input.plan.planHash });
    await waitFor(() => f.nfcJournal.read(input.plan.nfc.intentId), value => value?.receipt);
    assert.equal(f.prints, 0); assert.ok(f.writes > 0);
  } finally { await f.cleanup(); }
});
