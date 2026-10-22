import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createOwnershipProofValidator, OWNERSHIP_PROOF_VALIDATOR } from '../src/card-ownership-proof-validator.mjs';
import { plan } from './fixtures/card-ownership-proof-fixtures.mjs';

// Actual decoder qualification only. This local fixture launcher deliberately
// does NOT establish a qualified network/native-memory sandbox for integration.
function fixture(override) {
  const launches = [];
  const validator = createOwnershipProofValidator({ sandbox: { network: 'none', maxMemoryBytes: 1024 ** 3,
    launch(spec) {
      launches.push(spec);
      return override?.(spec) ?? spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } } });
  return { validator, launches };
}
const image = format => sharp({ create: { width: 16, height: 12, channels: 4, background: { r: 10, g: 50, b: 190, alpha: 0.6 } } })[format]().toBuffer();
const refuse = (promise, code) => assert.rejects(promise, e => !code || e.code === code);

test('default validator remains unavailable and invalid sandbox cannot be enabled', async () => {
  await refuse(createOwnershipProofValidator().validate(), 'OWNERSHIP_PROOF_VALIDATOR_UNAVAILABLE');
  assert.throws(() => createOwnershipProofValidator({ sandbox: { launch() {}, network: 'host', maxMemoryBytes: 1024 ** 3 } }));
});
test('actual JPEG and alpha PNG fully decode with exact original hashes, no derivative and private cleanup', async () => {
  for (const format of ['jpeg', 'png']) {
    const bytes = await image(format), p = plan(bytes, { declaredType: `image/${format}` }), f = fixture();
    const result = await f.validator.validate({ plan: p, bytes });
    assert.equal(result.mime, p.declaredType); assert.equal(result.originalSha256, p.sha256); assert.equal(result.originalByteCount, bytes.length);
    assert.equal(result.width, 16); assert.equal(result.height, 12); assert.equal(result.pixels, 192);
    assert.equal(result.decoderVersion, 'sharp-0.33.5/libvips-8.15.3');
    assert.deepEqual(f.launches[0].env, { UV_THREADPOOL_SIZE: '1', VIPS_CONCURRENCY: '1' });
    assert.deepEqual(f.launches[0].limits, { network: 'none', maxMemoryBytes: 1024 ** 3, timeoutMs: 15_000 });
    await assert.rejects(access(f.launches[0].privateDirectory));
  }
});
test('actual pinned native HEIC is validated without fabricated FRONT/BACK descriptors', async () => {
  const bytes = await readFile(new URL('../../atlas-photo-runtime/test/fixtures/colors-no-alpha.heic', import.meta.url));
  const p = plan(bytes, { declaredType: 'image/heic' }), f = fixture(), result = await f.validator.validate({ plan: p, bytes });
  assert.equal(result.decoderVersion, 'libheif-1.23.2/libde265-1.1.1'); assert.equal(result.originalSha256, p.sha256);
  assert.ok(result.width >= 2 && result.height >= 2 && result.pixels <= OWNERSHIP_PROOF_VALIDATOR.maxPixels);
  await assert.rejects(access(f.launches[0].privateDirectory));
});
test('multi-MiB original JPEG remains exact through full decode', async () => {
  const bytes = await sharp(randomBytes(1600 * 1200 * 3), { raw: { width: 1600, height: 1200, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  assert.ok(bytes.length > 2 * 1024 * 1024 && bytes.length < 20 * 1024 * 1024);
  const p = plan(bytes, { declaredType: 'image/jpeg' }), result = await fixture().validator.validate({ plan: p, bytes });
  assert.equal(result.originalSha256, p.sha256); assert.equal(result.originalByteCount, bytes.length); assert.equal(result.pixels, 1_920_000);
});
test('pixel bomb header is refused before full raster allocation', async () => {
  const bytes = Buffer.from(await image('png'));
  bytes.writeUInt32BE(26_000_001, 16); bytes.writeUInt32BE(2, 20);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  await refuse(fixture().validator.validate({ plan: plan(bytes), bytes }));
});
test('MIME spoof, PDF, trailing/truncated streams, multiframe HEIC and unsupported alpha refuse', async () => {
  const png = await image('png');
  for (const [bytes, mime] of [[png, 'image/jpeg'], [Buffer.from('%PDF-1.7\nscript'), 'image/png'],
    [Buffer.concat([png, Buffer.from('extra')]), 'image/png'], [png.subarray(0, png.length - 20), 'image/png']]) {
    const f = fixture(); await refuse(f.validator.validate({ plan: plan(bytes, { declaredType: mime }), bytes }));
    await assert.rejects(access(f.launches[0].privateDirectory));
  }
  for (const name of ['two-images.heic', 'colors-with-alpha.heic']) {
    const bytes = await readFile(new URL(`../../atlas-photo-runtime/test/fixtures/${name}`, import.meta.url));
    await refuse(fixture().validator.validate({ plan: plan(bytes, { declaredType: 'image/heic' }), bytes }));
  }
});
test('source byte/hash/size mismatch and preabort refuse before launching a decoder', async () => {
  const bytes = await image('png'), p = plan(bytes), f = fixture(), abort = new AbortController(); abort.abort();
  await refuse(f.validator.validate({ plan: p, bytes, signal: abort.signal }), 'OWNERSHIP_PROOF_VALIDATION_CANCELLED');
  await refuse(f.validator.validate({ plan: p, bytes: bytes.subarray(1) }), 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await refuse(f.validator.validate({ plan: p, bytes: changed }), 'OWNERSHIP_PROOF_SOURCE_MISMATCH'); assert.equal(f.launches.length, 0);
});
test('cancel kills active child and awaits close before cleaning private source', async () => {
  const bytes = await image('png'), abort = new AbortController(); let child;
  const f = fixture(spec => {
    child = spawn(spec.executable, ['-e', 'process.stdin.resume(); setInterval(() => {},1000)'], { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('spawn', () => abort.abort()); return child;
  });
  await refuse(f.validator.validate({ plan: plan(bytes), bytes, signal: abort.signal }), 'OWNERSHIP_PROOF_VALIDATION_CANCELLED');
  assert.equal(child.signalCode, 'SIGKILL'); await assert.rejects(access(f.launches[0].privateDirectory));
});
test('worker output overflow and private original mutation are refused with cleanup', async () => {
  const bytes = await image('png');
  const loud = fixture(spec => spawn(spec.executable, ['-e', 'process.stdout.write("x".repeat(20000)); setInterval(()=>{},1000)'],
    { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] }));
  await refuse(loud.validator.validate({ plan: plan(bytes), bytes }), 'OWNERSHIP_PROOF_VALIDATOR_PROTOCOL');
  await assert.rejects(access(loud.launches[0].privateDirectory));
  const changed = fixture(spec => {
    const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('close', () => writeFileSync(join(spec.privateDirectory, 'original'), Buffer.alloc(bytes.length)));
    return child;
  });
  await refuse(changed.validator.validate({ plan: plan(bytes), bytes }), 'OWNERSHIP_PROOF_SOURCE_MISMATCH');
  await assert.rejects(access(changed.launches[0].privateDirectory));
});
