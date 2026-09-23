import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMacNfcStation, createQualifiedType2Io, encodeApprovedNdef } from '../src/mac-nfc.mjs';
import { createFileMacNfcJournal } from '../src/mac-nfc-journal.mjs';
import { samplePlan } from './manual-fixture.mjs';
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-mac-nfc-test-')), plan = samplePlan();
  const f = { directory, plan, time: 1000, writes: [], connects: 0, locks: 0, signs: 0, acks: 0, removal: true, empty: false,
    lostWrite: false, mismatch: false, badLock: false, hostDown: false, qualified: true, tagChanged: false, expireOnWrite: false };
  const memory = Buffer.alloc(256); memory.set([3, 0, 0xfe], 16);
  const journal = createFileMacNfcJournal({ directory,
    // Synthetic file durability callback only. Production requires native F_FULLFSYNC.
    fullSync: async () => {} });
  const io = createQualifiedType2Io({ firstPage: 4, lastPage: 63, async transmit(command) {
    const page = command[3];
    if (command[1] === 0xb0) {
      const bytes = Buffer.from(memory.subarray(page * 4, page * 4 + 16)); if (f.mismatch && f.writes.length) bytes[0] ^= 1;
      return Buffer.concat([bytes, Buffer.from([0x90, 0])]);
    }
    assert.equal((await journal.read(plan.nfc.intentId)).state, 'WRITE_INTENT');
    assert.equal(command[1], 0xd6); f.writes.push(page); command.subarray(5).copy(memory, page * 4);
    if (f.expireOnWrite) f.time = 200000;
    if (f.lostWrite) throw new Error('Lost device result after physical write');
    return Buffer.from([0x90, 0]);
  } });
  const session = { ...io, async assertSameTag() { if (f.tagChanged) throw new Error('Tag changed'); },
    async waitForRemoval() { return f.removal; }, async close() {} };
  const signer = { capability: { enrolled: true, protectedKey: true, keyId: 'synthetic-key', stationId: 'synthetic-station', enrollmentId: 'synthetic-enrollment' },
    async sign(bytes) { f.signs++; return createHmac('sha256', 'synthetic-key-no-hardware').update(bytes).digest('base64'); },
    async verify(bytes, signature) { return createHmac('sha256', 'synthetic-key-no-hardware').update(bytes).digest('base64') === signature; } };
  const profile = { id: 'atlas-mac-f8215-production-v1', qualified: true, qualificationHash: 'e'.repeat(64), firstUserPage: 4, lastUserPage: 63,
    async identifyWritable() { return f.qualified; }, async lock() { f.locks++; }, async verifyLock() { return !f.badLock; } };
  const authority = { async verifyArm({ plan, association, profileHash, enrollment }) {
    return { intentId: plan.nfc.intentId, planHash: plan.planHash, profileHash, stationId: enrollment.stationId,
      enrollmentId: enrollment.enrollmentId, expiresAt: association.expiresAt, nonce: 'synthetic-signed-host-nonce' };
  } };
  const host = { async acknowledge({ receipt }) { f.acks++; if (f.hostDown) throw new Error('Lost hosted reply');
    return { intentId: receipt.intentId, receiptHash: sha(stable(receipt)), stationId: receipt.stationId, enrollmentId: receipt.enrollmentId, committed: true }; },
  async verifyAcknowledgement(value) { return value; } };
  const pcsc = { async connectExclusive() { f.connects++; return session; }, async observeEmpty() { return f.empty; } };
  f.args = { profile, signer, authority, host, pcsc, journal, clock: () => f.time };
  f.create = () => createMacNfcStation(f.args);
  f.association = { armed: true, stationId: signer.capability.stationId, cardId: plan.binding.cardId,
    approvalActionId: plan.binding.approvalActionId, planHash: plan.planHash, expiresAt: 100000 };
  f.input = { plan, association: f.association }; f.station = f.create(); f.cleanup = () => rm(directory, { recursive: true });
  f.memory = memory; return f;
}
test('explicit qualified arm is cold; tag placement writes exact NDEF header last and separates verified, lock, ack, removal', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.station.prepare(f.input)).state, 'WAITING_FOR_TAG'); assert.equal(f.connects, 0); assert.equal(f.writes.length, 0);
    const result = await f.station.onTagPresent(f.input);
    assert.equal(result.state, 'NFC_COMPLETE'); assert.equal(result.readbackVerified, true); assert.equal(result.lockVerified, true);
    assert.equal(result.removalObserved, true); assert.equal(result.hostedAcknowledged, true); assert.equal(result.assembly, 'NOT_RECORDED');
    const bytes = encodeApprovedNdef(f.plan); assert.deepEqual(f.memory.subarray(16, 16 + bytes.length), bytes);
    assert.equal(f.writes.at(-1), 4); assert.equal(new Set(f.writes).size, bytes.length / 4); assert.equal(f.locks, 1);
    assert.match(bytes.toString(), /atlasgrading.com\/reports\/.+\?v=3/);
    const calls = f.writes.length;
    assert.equal((await f.create().prepare(f.input)).state, 'NFC_COMPLETE');
    assert.equal((await f.create().onTagPresent(f.input)).state, 'NFC_COMPLETE'); assert.equal(f.writes.length, calls); assert.equal(f.connects, 1);
    const saved = await readFile(join(f.directory, 'station.json'), 'utf8'); assert.doesNotMatch(saved, /uid|serial|atr|rawHeader/i);
  } finally { await f.cleanup(); }
});
test('lost write/readback failure and expiry never retry mutation after restart or claim lock', async () => {
  for (const failure of ['lostWrite', 'mismatch', 'expireOnWrite']) {
    const f = await fixture(); f[failure] = true;
    try {
      await f.station.prepare(f.input); const result = await f.station.onTagPresent(f.input);
      assert.equal(result.state, 'UNKNOWN'); assert.equal(result.lockVerified, false); assert.equal(f.locks, 0);
      const written = f.writes.length; f.time = 1000;
      await f.create().prepare(f.input); await f.create().onTagPresent(f.input); await f.create().recover(f.input);
      assert.equal(f.writes.length, written); assert.equal(f.connects, 1);
    } finally { await f.cleanup(); }
  }
});
test('unqualified/nonempty/swapped tags stop before writes; lock rejection retains only readback fact', async () => {
  for (const failure of ['qualified', 'nonempty', 'tagChanged', 'badLock']) {
    const f = await fixture();
    if (failure === 'qualified') f.qualified = false; else if (failure === 'nonempty') f.memory[21] = 99; else f[failure] = true;
    try {
      await f.station.prepare(f.input); const result = await f.station.onTagPresent(f.input);
      assert.equal(result.state, 'UNKNOWN'); assert.equal(result.lockVerified, false); assert.equal(f.signs, 0);
      assert.equal(result.readbackVerified, failure === 'badLock');
      if (failure !== 'badLock') assert.equal(f.writes.length, 0);
    } finally { await f.cleanup(); }
  }
});
test('lost hosted acknowledgement keeps exact signed receipt; restart recovers with no tag mutation and requires native removal', async () => {
  const f = await fixture(); f.hostDown = true; f.removal = false;
  try {
    await f.station.prepare(f.input); let result = await f.station.onTagPresent(f.input);
    assert.equal(result.state, 'WAITING_FOR_HOST_ACK'); assert.equal(result.lockVerified, true); assert.equal(result.hostedAcknowledged, false);
    const writes = f.writes.length, receipt = (await f.args.journal.read(f.plan.nfc.intentId)).receipt;
    f.hostDown = false; result = await f.create().recover(f.input);
    assert.equal(result.state, 'WAITING_FOR_REMOVAL'); assert.equal(result.removalObserved, false); assert.equal(result.hostedAcknowledged, true);
    f.empty = true; result = await f.create().recover(f.input); assert.equal(result.state, 'NFC_COMPLETE');
    assert.equal(f.writes.length, writes); assert.equal(f.connects, 1); assert.equal(f.locks, 1); assert.equal(f.signs, 1);
    assert.deepEqual((await f.args.journal.read(f.plan.nfc.intentId)).receipt, receipt);
  } finally { await f.cleanup(); }
});
test('wrong host acknowledgement cannot release station or fake a saved result', async () => {
  const f = await fixture(); f.args.host.verifyAcknowledgement = async value => ({ ...value, receiptHash: '0'.repeat(64) });
  try {
    await f.station.prepare(f.input); const result = await f.station.onTagPresent(f.input);
    assert.equal(result.state, 'WAITING_FOR_HOST_ACK'); assert.equal(result.removalObserved, true); assert.equal(result.hostedAcknowledged, false);
    const next = samplePlan({ version: 4 });
    await assert.rejects(f.station.prepare({ plan: next, association: { ...f.association, planHash: next.planHash } }), /STATION_BUSY/);
  } finally { await f.cleanup(); }
});
test('recreated journals exclude other intents while UNKNOWN or awaiting removal, and only complete releases the slot', async () => {
  for (const uncertain of [true, false]) {
    const f = await fixture(); f.lostWrite = uncertain; f.removal = false;
    try {
      await f.station.prepare(f.input); let result = await f.station.onTagPresent(f.input);
      assert.equal(result.state, uncertain ? 'UNKNOWN' : 'WAITING_FOR_REMOVAL');
      const originalWrites = f.writes.length, next = samplePlan({ version: 4 });
      const nextInput = { plan: next, association: { ...f.association, planHash: next.planHash } };
      const fresh = () => createMacNfcStation({ ...f.args, journal: createFileMacNfcJournal({ directory: f.directory, fullSync: async () => {} }) });
      await assert.rejects(fresh().prepare(nextInput), /STATION_BUSY/);
      if (!uncertain) {
        f.empty = true; assert.equal((await fresh().recover(f.input)).state, 'NFC_COMPLETE');
        assert.equal((await fresh().prepare(nextInput)).state, 'WAITING_FOR_TAG');
        assert.equal((await fresh().onTagPresent(f.input)).state, 'NFC_COMPLETE');
      }
      assert.equal(f.writes.length, originalWrites); assert.equal(f.connects, 1);
    } finally { await f.cleanup(); }
  }
});
test('profile/signer/authorization gates and qualified page bounds reject before device effects', async () => {
  const f = await fixture();
  try {
    assert.throws(() => createMacNfcStation({ ...f.args, profile: { ...f.args.profile, qualified: false } }), /QUALIFIED/);
    assert.throws(() => createMacNfcStation({ ...f.args, signer: { ...f.args.signer, capability: { ...f.args.signer.capability, protectedKey: false } } }), /SIGNER/);
    await assert.rejects(f.station.prepare({ ...f.input, association: { ...f.association, armed: false } }), /ASSOCIATION/);
    await assert.rejects(f.station.prepare({ plan: samplePlan({ mode: 'LOCAL_FIXTURE' }), association: f.association }), /FIXTURE/);
    const station = createMacNfcStation({ ...f.args, authority: { verifyArm: async () => ({}) } });
    await assert.rejects(station.prepare(f.input), /AUTHORIZATION/);
    const io = createQualifiedType2Io({ firstPage: 4, lastPage: 63, transmit: () => { throw new Error('Must not send'); } });
    await assert.rejects(io.writePage(3, Buffer.alloc(4)), /RANGE/); await assert.rejects(io.read16(62), /RANGE/);
    assert.equal(f.connects, 0); assert.equal(f.writes.length, 0);
  } finally { await f.cleanup(); }
});
test('crashed journal lock and concurrent tag callbacks fail closed without duplicate mutation', async () => {
  const f = await fixture();
  try {
    await f.station.prepare(f.input);
    const results = await Promise.allSettled([f.station.onTagPresent(f.input), f.create().onTagPresent(f.input)]);
    assert.equal(results.filter(value => value.status === 'fulfilled' && value.value.state === 'NFC_COMPLETE').length, 1);
    assert.equal(f.connects, 1);
    await mkdir(join(f.directory, '.mutation'), { mode: 0o700 });
    await assert.rejects(f.create().prepare(f.input)); assert.equal(f.connects, 1);
  } finally { await f.cleanup(); }
});
