const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { WaveshareControllerAdapter, validateWaveshareConfig, waveshareBindingDigest } = require('../dist/waveshare-controller');
const { WaveshareCommandJournal } = require('../dist/waveshare-journal');
const { LinuxWaveshareSerialTransport } = require('../dist/waveshare-serial');
const { waveshareRequest, waveshareResponse, withModbusCrc, WaveshareError } = require('../dist/waveshare-protocol');

function config(overrides = {}) {
  return { adapterId: 'waveshare-modbus-rtu-relay-32ch-v2', mode: 'OFFICIAL_TEST', devicePath: '/dev/serial/by-id/FAKE_TEST_PEER', serialFormat: '9600/8N1',
    endpoints: [{ endpointId: 'boardA', address: 1, expectedFirmwareRegister: 100 }, { endpointId: 'boardB', address: 2, expectedFirmwareRegister: 100 }],
    mapping: [{ doorId: 'DoorSelected', controllerEndpointId: 'boardA', controllerChannel: 32 }, { doorId: 'OtherDoor', controllerEndpointId: 'boardB', controllerChannel: 1 }],
    mappingVersion: 'physical-map-test-1', profileDigest: 'a'.repeat(64), pulseMs: 100, offSettleMs: 300, minimumOffMs: 100, qualificationEvidenceDigest: 'b'.repeat(64), ...overrides };
}
function command(id = 'command-1', second = false) {
  return { commandId: id, doorId: second ? 'OtherDoor' : 'DoorSelected', controllerEndpointId: second ? 'boardB' : 'boardA', controllerChannel: second ? 1 : 32,
    mappingVersion: 'physical-map-test-1', profileDigest: 'a'.repeat(64), attempt: 1, authority: 'CERTIFICATION' };
}
class FakePeer {
  kind = 'FAKE_SERIAL_PEER'; requests = []; pulses = []; activeUntil = 0; maxActive = 0; opened = false; postFault = null; forcedOn = null; firmware = 100; pulseError = false;
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async exchange(action, address, channel) {
    assert.equal(this.opened, true);
    const request = waveshareRequest(action, address, channel);
    const at = performance.now(); this.requests.push({ action, address, channel, at, request });
    if (action === 'pulse100ms') {
      assert.ok(at >= this.activeUntil, 'Physical coil timers must not overlap');
      this.activeUntil = at + 100; this.pulses.push({ address, channel, at });
      if (this.pulseError) throw new WaveshareError('FAKE_LOST_ACK');
      return request;
    }
    if (action === 'coils') {
      if (this.pulses.length && this.postFault === 'timeout') throw new WaveshareError('FAKE_READBACK_TIMEOUT');
      const payload = Buffer.from([address, 1, 4, 0, 0, 0, 0]);
      if (this.forcedOn === address || (this.pulses.length && this.postFault === 'on' && address === 2)) payload[6] = 128;
      const response = withModbusCrc(payload);
      if (this.pulses.length && this.postFault === 'crc') response[8] ^= 1;
      return response;
    }
    const payload = Buffer.from([address, 3, 2, 0, 0]); payload.writeUInt16BE(action === 'address' ? address : this.firmware, 3);
    return withModbusCrc(payload);
  }
}
function setup(t, options = {}, peer = new FakePeer(), path = ':memory:') {
  const cfg = config(options); const journal = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg));
  const adapter = new WaveshareControllerAdapter(cfg, peer, journal);
  t.after(() => adapter.close());
  return { adapter, peer, journal, cfg };
}

test('official read and fixed 100ms vectors; no address/broadcast/channel coercion', () => {
  assert.equal(waveshareRequest('coils', 1).toString('hex'), '0101000000203dd2');
  assert.equal(waveshareRequest('pulse100ms', 1, 1).toString('hex'), '0105020000010db2');
  assert.equal(waveshareRequest('pulse100ms', 1, 32).readUInt16BE(2), 0x021f);
  for (const address of [0, 248, -1, '1', NaN]) assert.throws(() => waveshareRequest('coils', address));
  for (const channel of [0, 33, '1', 1.5]) assert.throws(() => waveshareRequest('pulse100ms', 1, channel));
  for (const action of ['on', 'toggle', 'off', 'all-on']) assert.throws(() => waveshareRequest(action, 1, 1));
  const coils = waveshareResponse(waveshareRequest('coils', 1), withModbusCrc(Buffer.from([1, 1, 4, 1, 0, 0, 128])));
  assert.equal(coils[0], true); assert.equal(coils[31], true); assert.equal(coils.filter(Boolean).length, 2);
});
test('malformed CRC, address, function, count, trailing bytes, exception and wrong echo reject', () => {
  const req = waveshareRequest('coils', 1); const good = withModbusCrc(Buffer.from([1, 1, 4, 0, 0, 0, 0]));
  for (const response of [good.subarray(0, 8), Buffer.concat([good, Buffer.from([0])]), withModbusCrc(Buffer.from([2, 1, 4, 0, 0, 0, 0])), withModbusCrc(Buffer.from([1, 3, 4, 0, 0, 0, 0])), withModbusCrc(Buffer.from([1, 1, 3, 0, 0, 0, 0])), withModbusCrc(Buffer.from([1, 0x81, 4]))]) assert.throws(() => waveshareResponse(req, response));
  assert.throws(() => waveshareResponse(waveshareRequest('pulse100ms', 1, 1), waveshareRequest('pulse100ms', 1, 2)));
});
test('explicit stable identity, endpoints, mapping, fixed pulse and qualification types', () => {
  for (const bad of [{ devicePath: '/dev/ttyUSB0' }, { devicePath: '/dev/serial/by-id/../../ttyUSB0' }, { pulseMs: 200 }, { mode: 'INVALID' }, { qualificationEvidenceDigest: true }, { serialFormat: '9600/8E1' }, { offSettleMs: 0 }, { endpoints: [{ endpointId: 'a', address: 0, expectedFirmwareRegister: 100 }] }, { mapping: [config().mapping[0], config().mapping[0]] }]) assert.throws(() => validateWaveshareConfig(config(bad)));
  assert.throws(() => new LinuxWaveshareSerialTransport({ devicePath: '/dev/ttyUSB0', serialFormat: '9600/8N1', addresses: [1] }));
});
test('unqualified configuration permits only startup reads, never output', async t => {
  const { adapter, peer } = setup(t, { qualificationEvidenceDigest: null });
  assert.equal((await adapter.identity()).ready, false);
  assert.equal((await adapter.sendOpenCommand(command())).outcome, 'REJECTED');
  await adapter.initializeReadOnly();
  assert.equal((await adapter.identity()).ready, false);
  assert.equal((await adapter.identity()).outputState, 'OFF_VERIFIED');
  assert.equal((await adapter.sendOpenCommand(command())).outcome, 'REJECTED');
  assert.equal(peer.pulses.length, 0);
});
test('queue spans both boards, board timer, all-output readback and off gap', async t => {
  const { adapter, peer } = setup(t); await adapter.initializeReadOnly();
  const first = adapter.sendOpenCommand(command());
  const changed = command('command-2', true); const second = adapter.sendOpenCommand(changed); changed.controllerChannel = 31;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await adapter.identity()).ready, false);
  const receipts = await Promise.all([first, second]);
  assert.deepEqual(receipts.map(r => [r.outcome, r.outputState]), [['ACCEPTED', 'OFF_VERIFIED'], ['ACCEPTED', 'OFF_VERIFIED']]);
  assert.deepEqual(peer.pulses.map(p => [p.address, p.channel]), [[1, 32], [2, 1]]);
  assert.ok(peer.pulses[1].at - peer.pulses[0].at >= 500);
  assert.equal(receipts[0].observedDoorId, undefined, 'Relay ACK is not door observation');
  const between = peer.requests.filter(r => r.at > peer.pulses[0].at && r.at < peer.pulses[1].at && r.action === 'coils');
  assert.deepEqual(new Set(between.map(r => r.address)), new Set([1, 2]));
});
test('command mapping and authority validation reject before any output', async t => {
  const { adapter, peer } = setup(t); await adapter.initializeReadOnly();
  for (const changes of [{ profileDigest: 'c'.repeat(64) }, { controllerEndpointId: undefined }, { controllerChannel: 1 }, { mappingVersion: 'other' }, { authority: 'BROWSER' }, { attempt: 2 }]) assert.equal((await adapter.sendOpenCommand({ ...command(), ...changes })).outcome, 'REJECTED');
  assert.equal(peer.pulses.length, 0);
});
test('unmapped output on another board blocks the selected door before write', async t => {
  const { adapter, peer, journal } = setup(t); await adapter.initializeReadOnly(); peer.forcedOn = 2;
  const receipt = await adapter.sendOpenCommand(command());
  assert.equal(receipt.outputState, 'UNCERTAIN'); assert.equal(peer.pulses.length, 0); assert.equal(journal.state().halted, true);
});
for (const fault of ['timeout', 'on', 'crc', 'lost-ack']) test(`post-dispatch ${fault} persists uncertainty and stops queued output`, async t => {
  const { adapter, peer, journal } = setup(t); await adapter.initializeReadOnly();
  if (fault === 'lost-ack') peer.pulseError = true; else peer.postFault = fault;
  const receipts = await Promise.all([adapter.sendOpenCommand(command()), adapter.sendOpenCommand(command('command-2', true))]);
  assert.equal(receipts[0].outcome, 'SENT_UNKNOWN'); assert.equal(receipts[0].outputState, 'UNCERTAIN');
  assert.equal(receipts[1].outcome, 'REJECTED'); assert.equal(peer.pulses.length, 1); assert.equal(journal.state().halted, true);
  assert.equal((await adapter.identity()).ready, false);
});
test('pre-write ledger failure prevents output; post-write persistence failure stays halted', async t => {
  const first = setup(t); await first.adapter.initializeReadOnly(); first.journal.begin = () => { throw new Error('disk full'); };
  assert.equal((await first.adapter.sendOpenCommand(command())).outcome, 'REJECTED'); assert.equal(first.peer.pulses.length, 0);
  const second = setup(t); await second.adapter.initializeReadOnly(); second.journal.complete = () => { throw new Error('disk full'); };
  assert.equal((await second.adapter.sendOpenCommand(command())).outcome, 'SENT_UNKNOWN'); assert.equal(second.peer.pulses.length, 1); assert.equal(second.journal.state().halted, true);
});
test('durable replay survives restart without a second pulse', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-waveshare-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'controller.sqlite'); const cfg = config();
  let journal = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg)); let peer = new FakePeer(); let adapter = new WaveshareControllerAdapter(cfg, peer, journal);
  await adapter.initializeReadOnly(); const original = await adapter.sendOpenCommand(command()); await adapter.close();
  journal = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg)); peer = new FakePeer(); adapter = new WaveshareControllerAdapter(cfg, peer, journal);
  try { await adapter.initializeReadOnly(); assert.deepEqual(await adapter.sendOpenCommand(command()), original); assert.equal(peer.pulses.length, 0); }
  finally { await adapter.close(); }
});
test('interrupted durable attempt is never replayed, startup does not clear halt, explicit recovery keeps outcome unknown', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-waveshare-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'controller.sqlite'); const cfg = config(); const { digest } = require('../dist/util');
  const interrupted = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg)); interrupted.begin(command().commandId, digest(command())); interrupted.close();
  const peer = new FakePeer(); const journal = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg)); const adapter = new WaveshareControllerAdapter(cfg, peer, journal);
  try {
    await adapter.initializeReadOnly(); assert.equal((await adapter.identity()).ready, false); assert.equal(journal.state().halted, true);
    assert.equal((await adapter.sendOpenCommand(command())).outcome, 'REJECTED');
    await adapter.recoverReadOnly('d'.repeat(64)); assert.equal(journal.state().halted, false);
    assert.equal((await adapter.sendOpenCommand(command())).outcome, 'SENT_UNKNOWN'); assert.equal(peer.pulses.length, 0);
  } finally { await adapter.close(); }
});
test('firmware drift and journal configuration drift fail closed', async t => {
  const { adapter, peer } = setup(t); peer.firmware = 101;
  await assert.rejects(adapter.initializeReadOnly(), /FIRMWARE_MISMATCH/); assert.equal(peer.pulses.length, 0);
  const dir = mkdtempSync(join(tmpdir(), 'vault-waveshare-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'controller.sqlite'); const journal = new WaveshareCommandJournal(path, waveshareBindingDigest(config())); journal.close();
  assert.throws(() => new WaveshareCommandJournal(path, waveshareBindingDigest(config({ mappingVersion: 'different' }))), /BINDING_MISMATCH/);
});

for (const pollIdentity of [false, true]) test(`helper death during OFF gap cannot complete or clear halt (identity poll: ${pollIdentity})`, { timeout: 5000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-waveshare-gap-death-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'controller.sqlite'); const cfg = config();
  const peer = new FakePeer();
  // Inject only real-transport policy/health into the in-process peer. A durable
  // journal is used, but this test never spawns a serial helper or opens a tty.
  peer.kind = 'REAL_LINUX_SERIAL'; peer.healthy = true;
  peer.configuredDevicePath = cfg.devicePath;
  peer.configuredAddresses = cfg.endpoints.map(endpoint => endpoint.address);
  const journal = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg));
  const adapter = new WaveshareControllerAdapter(cfg, peer, journal);
  try {
    await adapter.initializeReadOnly();
    const exchange = peer.exchange.bind(peer); let observeDeath;
    const died = new Promise((resolve, reject) => { observeDeath = () => {
      peer.healthy = false;
      (pollIdentity ? adapter.identity() : Promise.resolve()).then(resolve, reject);
    }; });
    peer.exchange = async (action, address, channel) => {
      const response = await exchange(action, address, channel);
      if (peer.pulses.length === 1 && action === 'coils' && address === 2) setImmediate(observeDeath);
      return response;
    };
    const dispatched = Promise.all([adapter.sendOpenCommand(command()), adapter.sendOpenCommand(command('queued-after-death', true))]);
    await died;
    if (pollIdentity) assert.equal(journal.state().reason, 'WAVESHARE_TRANSPORT_LOST_WHILE_IDLE');
    const [first, queued] = await dispatched;
    assert.equal(first.outcome, 'SENT_UNKNOWN'); assert.equal(first.outputState, 'UNCERTAIN');
    assert.equal(queued.outcome, 'REJECTED'); assert.equal(peer.pulses.length, 1);
    assert.equal(journal.state().halted, true);
    assert.equal((await adapter.identity()).ready, false);
    await adapter.close();
    const reopened = new WaveshareCommandJournal(path, waveshareBindingDigest(cfg));
    try { assert.equal(reopened.state().halted, true); } finally { reopened.close(); }
  } finally { await adapter.close(); }
});
test('LIVE controller requires synchronous effect authority and rejects async guard before pulse', async t => {
  const cfg=config({mode:'LIVE'}),peer=new FakePeer(),journal=new WaveshareCommandJournal(':memory:',waveshareBindingDigest(cfg));
  assert.throws(()=>new WaveshareControllerAdapter(cfg,peer,journal),/WAVESHARE_PRODUCTION_AUTHORITY_REQUIRED/);journal.close();
  for(const guard of [async()=>{},async()=>{throw Error('fixture denied');}]){
    const nextJournal=new WaveshareCommandJournal(':memory:',waveshareBindingDigest(cfg));const adapter=new WaveshareControllerAdapter(cfg,peer,nextJournal,guard);t.after(()=>adapter.close());
    await adapter.initializeReadOnly();const result=await adapter.sendOpenCommand(command());assert.equal(result.outcome,'REJECTED');assert.equal(result.outputState,'OFF_VERIFIED');assert.equal(peer.pulses.length,0);
  }
});
test('LIVE authority revoked while first pulse runs blocks a queued second pulse but preserves OFF cleanup',async t=>{
  const cfg=config({mode:'LIVE'}),peer=new FakePeer(),journal=new WaveshareCommandJournal(':memory:',waveshareBindingDigest(cfg));let allowed=true;
  const exchange=peer.exchange.bind(peer);peer.exchange=async(...args)=>{const result=await exchange(...args);if(args[0]==='pulse100ms')allowed=false;return result;};
  const adapter=new WaveshareControllerAdapter(cfg,peer,journal,()=>{if(!allowed)throw Error('synthetic revoked authority');});t.after(()=>adapter.close());await adapter.initializeReadOnly();
  const receipts=await Promise.all([adapter.sendOpenCommand(command()),adapter.sendOpenCommand(command('queued-second',true))]);
  assert.deepEqual(receipts.map(r=>[r.outcome,r.outputState]),[['ACCEPTED','OFF_VERIFIED'],['REJECTED','OFF_VERIFIED']]);assert.equal(peer.pulses.length,1);assert.equal(journal.state().halted,false);
});
