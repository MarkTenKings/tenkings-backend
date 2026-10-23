import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createCompArtifactReader } from '../src/comp-artifact-reader.mjs';
import { createServingCompCuration } from '../scripts/comp-runtime.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const content = { saved: 'synthetic' }, bytes = Buffer.from(canonical(content));
  const expected = { cardId: randomUUID(), kind: 'MARKET_PREVIEW', sourceHash: 'a'.repeat(64) };
  const settings = { endpoint: 'https://objects.invalid', region: 'test-region', bucket: 'synthetic-comp', prefix: 'atlas-manual/artifacts',
    accessKeyId: 'synthetic-read-key', secretAccessKey: 'synthetic-read-secret' };
  const ref = { cardId: expected.cardId, kind: expected.kind, sha256: digest(bytes), lineageSha256: digest(canonical(expected)), byteCount: bytes.length };
  ref.key = `${settings.prefix}/${ref.cardId}/${ref.kind}/${ref.lineageSha256}-${ref.sha256}.json`;
  const calls = { create: 0, read: 0, destroy: 0 }, hooks = {}, bodies = [];
  class Get { constructor(input) { this.input = input; } }
  const client = { async send(command, options) {
    calls.read++; assert(command instanceof Get); assert.deepEqual(command.input, { Bucket: settings.bucket, Key: ref.key, ChecksumMode: 'ENABLED' });
    assert(options.abortSignal instanceof AbortSignal); await hooks.send?.(options.abortSignal);
    const body = Readable.from([bytes]); bodies.push(body);
    return { ContentLength: bytes.length, ContentType: 'application/json', Body: body,
      Metadata: { 'atlas-manual-lineage-sha256': ref.lineageSha256 }, ...hooks.result };
  }, destroy() { calls.destroy++; } };
  const options = { settings, GetObjectCommand: Get, createClient(input) {
    calls.create++; assert.equal(input.maxAttempts, 1); assert.deepEqual(input.credentials, { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey }); return client;
  } };
  return { content, bytes, expected, settings, ref, calls, hooks, bodies, client, options };
}

test('disabled host is inert and artifact reader is lazy, GET-only and source verified', async () => {
  const env = new Proxy({}, { get(_value, key) { assert.equal(key, 'ATLAS_STAFF_COMP_CURATION'); return undefined; } });
  assert.equal(createServingCompCuration({ env }), null);
  const f = fixture(), runtime = createCompArtifactReader(f.options); assert.equal(f.calls.create, 0);
  assert.deepEqual(Object.keys(runtime.reader), ['read']);
  assert.deepEqual(await runtime.reader.read(f.ref, f.expected), f.content);
  assert.deepEqual(await runtime.reader.read(f.ref, f.expected), f.content);
  assert.equal(f.calls.create, 1); assert.equal(f.calls.read, 2); assert(f.bodies.every(body => body.destroyed));
  await runtime.close(); await runtime.close(); assert.equal(f.calls.destroy, 1);
});

test('unbound kind/lineage never reads; changed bytes, encoding and size fail closed', async () => {
  const f = fixture(), runtime = createCompArtifactReader(f.options);
  await assert.rejects(runtime.reader.read(f.ref, { ...f.expected, kind: 'GRADING_DRAFT' }));
  await assert.rejects(runtime.reader.read(f.ref, { ...f.expected, cardId: randomUUID() })); assert.equal(f.calls.read, 0);
  for (const result of [{ ContentLength: f.bytes.length + 1 }, { ContentEncoding: 'gzip' },
    { Body: Readable.from([Buffer.alloc(f.bytes.length, 1)]) }, { Body: Readable.from([Buffer.alloc(f.bytes.length + 1)]) }]) {
    f.hooks.result = result; await assert.rejects(runtime.reader.read(f.ref, f.expected));
  }
  await runtime.close();
});

test('configuration drift after awaited GET withholds content and destroys body', async () => {
  const f = fixture(), entered = deferred(), resume = deferred();
  f.hooks.send = async () => { entered.resolve(); await resume.promise; };
  const runtime = createCompArtifactReader(f.options), pending = runtime.reader.read(f.ref, f.expected);
  await entered.promise; f.settings.accessKeyId = 'changed-read-key'; resume.resolve();
  await assert.rejects(pending, { code: 'COMP_STORAGE_NOT_CONFIGURED' });
  assert(f.bodies.every(body => body.destroyed)); await runtime.close(); assert.equal(f.calls.destroy, 1);
});

test('close drains accepted read, rejects successor, bounds concurrency and disposes once', async () => {
  const f = fixture(), entered = deferred(), resume = deferred();
  f.hooks.send = async () => { entered.resolve(); await resume.promise; };
  const runtime = createCompArtifactReader(f.options), first = runtime.reader.read(f.ref, f.expected);
  await entered.promise; const second = runtime.reader.read(f.ref, f.expected);
  await assert.rejects(runtime.reader.read(f.ref, f.expected), { code: 'COMP_BUSY' });
  const closing = runtime.close(); await assert.rejects(runtime.reader.read(f.ref, f.expected)); assert.equal(f.calls.destroy, 0);
  resume.resolve(); assert.deepEqual(await first, f.content); assert.deepEqual(await second, f.content);
  await closing; await runtime.close(); assert.equal(f.calls.destroy, 1);
});

test('constructor failures are not retried and invalid owned clients have observed cleanup', async () => {
  for (const mode of ['throws', 'invalid', 'async', 'rejected']) {
    const f = fixture(); f.options.createClient = () => {
      f.calls.create++;
      if (mode === 'throws') throw Error('synthetic constructor');
      if (mode === 'rejected') return Promise.reject(Error('synthetic rejected constructor'));
      const invalid = { destroy() { f.calls.destroy++; } };
      return mode === 'async' ? Promise.resolve(invalid) : invalid;
    };
    const runtime = createCompArtifactReader(f.options);
    await assert.rejects(runtime.reader.read(f.ref, f.expected)); await assert.rejects(runtime.reader.read(f.ref, f.expected));
    assert.equal(f.calls.create, 1);
    if (mode === 'rejected') await assert.rejects(runtime.close(), /synthetic rejected constructor/); else await runtime.close();
    assert.equal(f.calls.destroy, ['invalid', 'async'].includes(mode) ? 1 : 0);
  }
});

test('abort destroys a stalled response body so an admitted read and close both finish', async () => {
  const f = fixture(), entered = deferred(), controller = new AbortController();
  const stalled = new Readable({ read() { entered.resolve(); } });
  f.hooks.result = { Body: stalled };
  const runtime = createCompArtifactReader(f.options), pending = runtime.reader.read(f.ref, f.expected, { signal: controller.signal });
  await entered.promise; const closing = runtime.close(); assert.equal(f.calls.destroy, 0);
  controller.abort(); await assert.rejects(pending); await closing;
  assert.equal(stalled.destroyed, true); assert.equal(f.calls.destroy, 1);
});
