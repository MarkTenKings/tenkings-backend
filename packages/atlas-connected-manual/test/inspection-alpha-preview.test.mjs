import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { digest } from '@atlas/manual-service/contract';
import { createInspectionAlphaPreviewResolver, INSPECTION_ALPHA_PREVIEW_POLICY } from '../src/inspection-alpha-preview.mjs';
import { encodeInspectionAlphaPreview } from '../src/inspection-alpha-preview-encoder.mjs';

const origin = 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com';
const sourceBytes = await sharp({ create: { width: 1350, height: 1858, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 1270, height: 1778, channels: 4, background: { r: 190, g: 35, b: 30, alpha: 1 } } }).png().toBuffer(), left: 40, top: 40 }])
  .webp({ lossless: true }).toBuffer();
const previewBytes = await sharp(sourceBytes).resize(558, 768, { fit: 'fill' }).webp({ quality: 78, alphaQuality: 100, effort: 4 }).toBuffer();
const savedFor = (bytes = sourceBytes) => ({ descriptor: { purpose: 'inspection', raster: {
  content: { mime: 'image/webp', sha256: digest(bytes), byteCount: bytes.length }, dimensions: { width: 1350, height: 1858 },
} } });
const missing = () => Object.assign(Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
const conflict = () => Object.assign(Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  const objects = new Map(), calls = [], signs = []; let reads = 0, encodes = 0;
  const client = { async send(command, { abortSignal } = {}) {
    abortSignal?.throwIfAborted(); const input = command.input, kind = command.constructor.name; calls.push({ kind, input });
    await options.beforeSend?.(kind, input);
    if (kind === 'GetObjectCommand') {
      const value = objects.get(input.Key); if (!value) throw missing();
      return { ...value, Metadata: { ...value.Metadata }, Body: Readable.from([value.bytes]) };
    }
    assert.equal(kind, 'PutObjectCommand'); assert.equal(input.IfNoneMatch, '*');
    if (objects.has(input.Key)) throw conflict();
    objects.set(input.Key, { bytes: Buffer.from(input.Body), Metadata: { ...input.Metadata }, ContentType: input.ContentType,
      ContentLength: input.ContentLength, ChecksumSHA256: input.ChecksumSHA256, ETag: '"immutable-' + digest(input.Body) + '"',
      ...(options.unversioned ? {} : { VersionId: 'version-1' }) });
    if (options.loseWriteReply) throw Error('lost write reply');
    return {};
  } };
  const storage = { async readDerivative(input) { reads++; return options.readSource ? options.readSource(input) : { bytes: sourceBytes }; } };
  const sign = async (_client, command, settings) => { signs.push({ input: command.input, settings }); return options.sign
    ? options.sign(command, settings) : origin + '/' + command.input.Key + '?signature=' + signs.length; };
  const encode = async (bytes, { signal }) => { encodes++; return options.encode ? options.encode(bytes, { signal }) : encodeInspectionAlphaPreview(bytes, { signal }); };
  const args = { storage, client, sign, encode, bucket: 'atlas-private', keyPrefix: 'atlas/inspection-alpha-previews',
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}), ...(options.maxJobs ? { maxJobs: options.maxJobs } : {}) };
  return { ...args, objects, calls, signs, resolver: createInspectionAlphaPreviewResolver(args),
    get reads() { return reads; }, get encodes() { return encodes; } };
}

test('historical approved source gets an immutable alpha WebP without changing source or persisting URL', async () => {
  const f = fixture(), saved = savedFor(), original = structuredClone(saved), originalBytes = Buffer.from(sourceBytes);
  const value = await f.resolver.resolve({ saved });
  assert.deepEqual(saved, original); assert.deepEqual(sourceBytes, originalBytes);
  assert.equal(value.policyVersion, INSPECTION_ALPHA_PREVIEW_POLICY); assert.equal(value.sourceSha256, saved.descriptor.raster.content.sha256);
  assert.equal(value.width, 558); assert.equal(value.height, 768); assert.equal(value.mime, 'image/webp');
  assert.equal(f.reads, 1); assert.equal(f.encodes, 1); assert.equal(f.objects.size, 1);
  const record = [...f.objects.values()][0]; assert.equal(digest(record.bytes), value.sha256); assert.equal(record.bytes.length, value.byteCount);
  assert.equal(JSON.stringify(record.Metadata).includes('https:'), false);
  const { data, info } = await sharp(record.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 558); assert.equal(info.height, 768); assert.equal(info.channels, 4);
  assert.equal(data[3], 0, 'the original inspection padding stays transparent');
  assert.equal(data[(384 * 558 + 279) * 4 + 3], 255, 'card pixels remain opaque');
  assert.ok(data.some((value, i) => i % 4 === 3 && value > 0 && value < 255), 'resized edges retain partial alpha');
  const again = await f.resolver.resolve({ saved });
  assert.equal(again.sha256, value.sha256); assert.notEqual(again.url, value.url); assert.equal(f.reads, 1); assert.equal(f.encodes, 1);
  assert.equal(f.signs.length, 2); assert.deepEqual(f.signs.map(entry => entry.settings.expiresIn), [120, 120]);
  assert.equal(f.signs[0].input.VersionId, 'version-1');
});

test('unversioned cache URLs require no unsupported browser headers with the actual SDK signer', async () => {
  const client = new S3Client({ region: 'us-east-1', endpoint: origin,
    credentials: { accessKeyId: 'local-fixture', secretAccessKey: 'local-fixture-secret' } });
  const f = fixture({ unversioned: true, encode: async () => previewBytes,
    sign: (command, settings) => getSignedUrl(client, command, settings) });
  try {
    const value = await f.resolver.resolve({ saved: savedFor() });
    assert.equal(f.signs[0].input.VersionId, undefined); assert.equal(f.signs[0].input.IfMatch, undefined);
    assert.equal(new URL(value.url).searchParams.get('X-Amz-SignedHeaders'), 'host');
    assert.equal(new URL(value.url).searchParams.get('X-Amz-Expires'), '120');
  } finally { client.destroy(); }
});

test('one cancelled caller does not cancel another caller sharing the same bounded work', async () => {
  const started = deferred(), release = deferred(); let sharedSignal;
  const f = fixture({ encode: async (_bytes, { signal }) => { sharedSignal = signal; started.resolve(); await release.promise; return previewBytes; } });
  const controller = new AbortController(), reason = Error('caller left');
  const first = f.resolver.resolve({ saved: savedFor(), signal: controller.signal });
  const second = f.resolver.resolve({ saved: savedFor() });
  await started.promise; controller.abort(reason); await assert.rejects(first, error => error === reason);
  assert.equal(sharedSignal.aborted, false); release.resolve();
  await second; assert.equal(f.reads, 1); assert.equal(f.encodes, 1); assert.equal(f.signs.length, 1);
});

test('separate processes race create-only and converge on the same winning bytes', async () => {
  const barrier = deferred(); let arrivals = 0;
  const f = fixture({ encode: async () => previewBytes, beforeSend: async kind => {
    if (kind === 'PutObjectCommand') { if (++arrivals === 2) barrier.resolve(); await barrier.promise; }
  } });
  const other = createInspectionAlphaPreviewResolver({ storage: f.storage, client: f.client, sign: f.sign, encode: f.encode,
    bucket: f.bucket, keyPrefix: f.keyPrefix });
  const [one, two] = await Promise.all([f.resolver.resolve({ saved: savedFor() }), other.resolve({ saved: savedFor() })]);
  assert.equal(f.objects.size, 1); assert.equal(one.sha256, two.sha256); assert.equal(f.encodes, 2); assert.equal(f.signs.length, 2);
});

test('a lost immutable write reply reconciles the same key', async () => {
  const f = fixture({ loseWriteReply: true, encode: async () => previewBytes });
  await f.resolver.resolve({ saved: savedFor() });
  assert.equal(f.objects.size, 1); assert.equal(f.calls.filter(value => value.kind === 'PutObjectCommand').length, 1);
});

test('corrupt cache bytes, metadata, dimensions and object headers never sign or overwrite', async t => {
  const alternateDimensions = await sharp({ create: { width: 16, height: 16, channels: 4, background: 'red' } }).webp().toBuffer();
  for (const [name, mutate] of Object.entries({
    bytes: record => { record.bytes[record.bytes.length - 1] ^= 1; },
    binding: record => { record.Metadata['atlas-alpha-binding'] = '0'.repeat(64); },
    length: record => { record.ContentLength++; },
    range: record => { record.ContentRange = 'bytes 0-20/100'; },
    encoding: record => { record.ContentEncoding = 'gzip'; },
    dimensions: record => { record.bytes = alternateDimensions; record.ContentLength = alternateDimensions.length;
      record.Metadata['atlas-output-sha256'] = digest(alternateDimensions); record.ChecksumSHA256 = Buffer.from(digest(alternateDimensions), 'hex').toString('base64'); },
  })) await t.test(name, async () => {
    const f = fixture({ encode: async () => previewBytes }); await f.resolver.resolve({ saved: savedFor() });
    mutate([...f.objects.values()][0]); const prior = f.calls.filter(value => value.kind === 'PutObjectCommand').length;
    await assert.rejects(f.resolver.resolve({ saved: savedFor() }));
    assert.equal(f.signs.length, 1); assert.equal(f.calls.filter(value => value.kind === 'PutObjectCommand').length, prior);
  });
});

test('source byte hash/length mismatch and noncanonical source declarations are rejected before writes', async () => {
  for (const bytes of [Buffer.from('wrong'), Buffer.alloc(sourceBytes.length)]) {
    const f = fixture({ readSource: async () => ({ bytes }) }); await assert.rejects(f.resolver.resolve({ saved: savedFor() }));
    assert.equal(f.encodes, 0); assert.equal(f.objects.size, 0); assert.equal(f.signs.length, 0);
  }
  for (const mutate of [saved => { saved.descriptor.raster.content.byteCount = 50 * 1024 * 1024 + 1; },
    saved => { saved.descriptor.raster.dimensions.width = 1351; }, saved => { saved.descriptor.purpose = 'preview'; },
    saved => { saved.descriptor.raster.content.mime = 'image/png'; }]) {
    const f = fixture(), saved = savedFor(); mutate(saved); await assert.rejects(f.resolver.resolve({ saved })); assert.equal(f.calls.length, 0);
  }
});

test('native encoder refuses false canonical dimensions and never creates an output', async () => {
  const wrong = await sharp({ create: { width: 1350, height: 1859, channels: 4, background: 'red' } }).webp().toBuffer();
  const f = fixture({ readSource: async () => ({ bytes: wrong }) });
  await assert.rejects(f.resolver.resolve({ saved: savedFor(wrong) })); assert.equal(f.objects.size, 0); assert.equal(f.signs.length, 0);
});

test('native child is killed on deadline and settles only after closing', async () => {
  await assert.rejects(encodeInspectionAlphaPreview(sourceBytes, { signal: AbortSignal.timeout(1) }));
});

test('output bytes above one MiB are refused before storage', async () => {
  const f = fixture({ encode: async () => Buffer.alloc(1024 * 1024 + 1) });
  await assert.rejects(f.resolver.resolve({ saved: savedFor() })); assert.equal(f.objects.size, 0); assert.equal(f.signs.length, 0);
});

test('one active job and bounded unique queue still allow source singleflight', async () => {
  const started = deferred(), release = deferred(); let active = 0, peak = 0;
  const alternate = Buffer.from('second verified source');
  const f = fixture({ maxJobs: 2, readSource: async ({ descriptor }) => ({ bytes: descriptor.raster.content.sha256 === digest(sourceBytes) ? sourceBytes : alternate }),
    encode: async () => { active++; peak = Math.max(peak, active); started.resolve(); await release.promise; active--; return previewBytes; } });
  const first = f.resolver.resolve({ saved: savedFor() }); await started.promise;
  const duplicate = f.resolver.resolve({ saved: savedFor() });
  const second = f.resolver.resolve({ saved: savedFor(alternate) });
  await assert.rejects(f.resolver.resolve({ saved: savedFor(Buffer.from('third source')) }), { code: 'INSPECTION_ALPHA_BUSY' });
  assert.equal(f.encodes, 1); release.resolve(); await Promise.all([first, duplicate, second]);
  assert.equal(peak, 1); assert.equal(f.encodes, 2); assert.equal(f.signs.length, 3);
});

test('expired shared work cannot write and does not release CPU admission until it actually settles', async () => {
  const started = deferred(), release = deferred(); let timedOutSignal;
  const f = fixture({ timeoutMs: 30, maxJobs: 1, encode: async (_bytes, { signal }) => {
    timedOutSignal = signal; started.resolve(); await release.promise; return previewBytes;
  } });
  const first = f.resolver.resolve({ saved: savedFor() }); await started.promise;
  await assert.rejects(first, /INSPECTION_ALPHA_TIMEOUT/); assert.equal(timedOutSignal.aborted, true);
  await assert.rejects(f.resolver.resolve({ saved: savedFor(Buffer.from('different')) }), { code: 'INSPECTION_ALPHA_BUSY' });
  release.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.objects.size, 0); assert.equal(f.signs.length, 0);
});

test('optional signing has a finite deadline even without a caller signal', async () => {
  const f = fixture({ timeoutMs: 50, encode: async () => previewBytes, sign: async () => new Promise(() => {}) });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(f.resolver.resolve({ saved: savedFor() })); } finally { clearTimeout(keepAlive); }
  assert.equal(f.objects.size, 1);
});

test('unsupported conditional storage does not fall back to an unconditional put', async () => {
  const f = fixture({ encode: async () => previewBytes, beforeSend: async kind => {
    if (kind === 'PutObjectCommand') throw Object.assign(Error('unsupported'), { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } });
  } });
  await assert.rejects(f.resolver.resolve({ saved: savedFor() })); assert.equal(f.objects.size, 0);
  assert.equal(f.calls.filter(value => value.kind === 'PutObjectCommand').length, 1);
});
