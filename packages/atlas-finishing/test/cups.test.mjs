import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createCupsPrinter, createFileCupsJournal, createLocalCupsTransport, cupsJobRequest, parseCupsJobResponse } from '../src/cups.mjs';
import { samplePlan } from './manual-fixture.mjs';
const config = { version: 'atlas-cups-printer-v1', qualified: true, qualificationHash: 'e'.repeat(64), renderProfileHash: 'a'.repeat(64), printer: 'Atlas_Test', media: 'Letter', layoutVersion: 'atlas-noir-gold-v1', actualSize: true };
const bytes = Buffer.from('%PDF-1.7\nsynthetic document, no printer is contacted');
const renderDocument = plan => ({ bytes, sha256: createHash('sha256').update(bytes).digest('hex'), planHash: plan.planHash, layoutVersion: plan.label.layoutVersion, renderProfileHash: config.renderProfileHash });
test('durable CUPS intent reopens exact receipt without duplicate spool submission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-cups-test-')); let calls = 0, jobState = 5; const plan = samplePlan();
  const transport = { submit: async () => { calls++; return { jobId: 17, printer: 'Atlas_Test' }; },
    inspect: async () => ({ jobId: 17, name: plan.print.intentId, printer: 'Atlas_Test', state: jobState }) };
  const create = () => createCupsPrinter({ config, journal: createFileCupsJournal({ directory }), transport, renderDocument });
  try {
    assert.equal((await create().prepare({ plan })).state, 'SPOOL_ACCEPTED');
    assert.equal((await create().prepare({ plan })).state, 'SPOOL_ACCEPTED'); assert.equal(calls, 1);
    jobState = 9; assert.equal((await create().status(plan.print.intentId, plan.planHash)).state, 'SPOOL_COMPLETED');
    assert.equal((await create().prepare({ plan })).state, 'SPOOL_COMPLETED'); assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true }); }
});
test('uncertain submit remains unknown after restart and never automatically reprints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-cups-test-')); let calls = 0; const plan = samplePlan();
  const transport = { submit: async () => { calls++; throw new Error('lost response'); }, inspect: async () => { throw new Error('must not guess job'); } };
  try {
    for (let i = 0; i < 2; i++) assert.equal((await createCupsPrinter({ config, journal: createFileCupsJournal({ directory }), transport, renderDocument }).prepare({ plan })).state, 'UNKNOWN');
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true }); }
});
test('native full-sync must finish before spool dispatch and a failed sync never prints', async () => {
  const directory=await mkdtemp(join(tmpdir(),'atlas-cups-fullsync-'));let calls=0,synced=false;
  const transport={submit:async()=>{assert.equal(synced,true);calls++;return{jobId:17,printer:'Atlas_Test'};},inspect:async()=>null};
  try{
    const failed=createFileCupsJournal({directory,fullSync:async()=>{throw new Error('Native sync failed');}});
    await assert.rejects(createCupsPrinter({config,journal:failed,transport,renderDocument}).prepare({plan:samplePlan()}),/Native sync failed/);
    assert.equal(calls,0);
    const recovered=createFileCupsJournal({directory,fullSync:async()=>{synced=true;}});
    assert.equal((await createCupsPrinter({config,journal:recovered,transport,renderDocument}).prepare({plan:samplePlan()})).state,'UNKNOWN');
    assert.equal(calls,0);
    await createCupsPrinter({config,journal:recovered,transport,renderDocument}).prepare({plan:samplePlan({version:4})});
    assert.equal(calls,1);
  }finally{await rm(directory,{recursive:true});}
});
test('printer/profile/document changes and fixture printing fail before dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-cups-test-')); let calls = 0;
  const args = { config, journal: createFileCupsJournal({ directory }), transport: { submit: async () => { calls++; return { jobId: 17, printer: 'Atlas_Test' }; }, inspect: async () => null }, renderDocument };
  try {
    assert.throws(() => createCupsPrinter({ ...args, config: { ...config, printer: '-other' } }));
    await assert.rejects(createCupsPrinter(args).prepare({ plan: samplePlan({ mode: 'LOCAL_FIXTURE' }) }), /FIXTURE/);
    await assert.rejects(createCupsPrinter({ ...args, renderDocument: plan => ({ ...renderDocument(plan), sha256: 'a'.repeat(64) }) }).prepare({ plan: samplePlan() }), /DOCUMENT/);
    assert.equal(calls, 0); await createCupsPrinter(args).prepare({ plan: samplePlan() });
    await assert.rejects(createCupsPrinter({ ...args, config: { ...config, media: 'A4' } }).prepare({ plan: samplePlan() }), /CONFLICT/); assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true }); }
});
test('the print submission owns the exact hashed bytes across async reservation', async () => {
  const mutable = Buffer.from(bytes), plan = samplePlan(); let saved;
  const printer = createCupsPrinter({ config,
    journal: { reserve: async record => { saved = record; mutable.fill(0); return { created: true, record }; }, get: async () => saved, commit: async () => {} },
    renderDocument: input => ({ ...renderDocument(input), bytes: mutable }),
    transport: { submit: async input => { assert.deepEqual(input.bytes, bytes); return { jobId: 19, printer: 'Atlas_Test' }; }, inspect: async () => null },
  });
  assert.equal((await printer.prepare({ plan })).state, 'SPOOL_ACCEPTED');
});
function attr(tag, name, val) {
  const n = Buffer.from(name), v = typeof val === 'number' ? Buffer.alloc(4) : Buffer.from(val); if (typeof val === 'number') v.writeInt32BE(val);
  const head = Buffer.alloc(3), mid = Buffer.alloc(2); head[0] = tag; head.writeUInt16BE(n.length, 1); mid.writeUInt16BE(v.length); return Buffer.concat([head, n, mid, v]);
}
test('IPP status distinguishes completed, canceled and malformed/wrong replies', () => {
  assert.equal(cupsJobRequest(17).readUInt16BE(2), 9);
  const response = state => Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 2]), attr(0x21, 'job-id', 17), attr(0x23, 'job-state', state),
    attr(0x42, 'job-name', 'job'), attr(0x45, 'job-printer-uri', 'ipp://localhost/printers/Atlas_Test'), Buffer.from([3])]);
  assert.deepEqual(parseCupsJobResponse(response(9)), { jobId: 17, state: 9, name: 'job', printer: 'Atlas_Test' });
  assert.equal(parseCupsJobResponse(response(7)).state, 7); assert.throws(() => parseCupsJobResponse(response(9).subarray(0, -1)));
  assert.throws(() => parseCupsJobResponse(Buffer.concat([response(9), Buffer.from([0])])));
});
test('local transport uses exact lp arguments and PDF stdin without shell or inherited environment', async () => {
  const plan = samplePlan(); let captured;
  const spawnImpl = (command, args, options) => {
    captured = { command, args, options }; const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const chunks = []; child.stdin.on('data', chunk => chunks.push(chunk)); child.stdin.on('finish', () => {
      assert.deepEqual(Buffer.concat(chunks), bytes); child.stdout.write('request id is Atlas_Test-17 (1 file(s))\n'); child.emit('close', 0);
    }); return child;
  };
  const result = await createLocalCupsTransport({ spawnImpl }).submit({ printer: 'Atlas_Test', media: 'Letter', title: plan.print.intentId, bytes });
  assert.deepEqual(result, { printer: 'Atlas_Test', jobId: 17 }); assert.equal(captured.command, '/usr/bin/lp'); assert.equal(captured.options.shell, false);
  assert.deepEqual(captured.options.env, { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }); assert.ok(captured.args.includes('print-scaling=none'));
});
