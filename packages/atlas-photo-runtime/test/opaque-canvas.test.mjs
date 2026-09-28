import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { parseDecodedFrame } from '@atlas/photo-core';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '../src/index.mjs';
import { request, code, sha256 } from './helpers.mjs';

const fixture = name => readFile(new URL(`./fixtures/browser-canvas/${name}`, import.meta.url));
const describe = result => describeDecodedFrame(result, { id: 'opaque-working',
  object: { key: 'working/front.png', versionId: '1' } });

test('WebKit opaque P3 canvas PNG retains RGBA but prepares exact full-size RGB without replacing the original', async () => {
  const bytes = await fixture('opaque-p3.png'), originalHash = sha256(bytes);
  assert.equal(bytes[25], 6, 'Real WebKit output has an RGBA IHDR even with alpha:false');
  const decoded = await verifyAndDecodePhoto(request(bytes)), sourceBefore = Buffer.from(decoded.png);
  assert.equal(decoded.treatment.channels, 4);
  const source = await sharp(decoded.png, { ignoreIcc: true }).raw().toBuffer();
  assert(source.every((value, index) => index % 4 !== 3 || value === 255));
  const expectedRgb = Buffer.alloc(source.length / 4 * 3);
  for (let input = 0, output = 0; input < source.length; input += 4, output += 3) source.copy(expectedRgb, output, input, input + 3);
  const working = await deriveSdrWorkingPhoto(decoded);
  assert.deepEqual(await sharp(working.png, { ignoreIcc: true }).raw().toBuffer(), expectedRgb);
  assert.deepEqual(working.raster.dimensions, { width: 48, height: 64 });
  assert.deepEqual(working.original, decoded.original);
  assert.deepEqual(working.decodePlan, decoded.decodePlan);
  assert.deepEqual(working.workingImage.sourceRaster, decoded.raster);
  assert.deepEqual(working.workingImage.sourceTreatment, decoded.treatment);
  assert.deepEqual(decoded.png, sourceBefore);
  assert.equal(sha256(bytes), originalHash);
  assert.equal(working.treatment.policyVersion, 'atlas-sdr-working-srgb8-opaque-alpha-v4');
  assert.equal(working.treatment.channels, 3);
  assert.equal(working.treatment.hdrTreatment, 'unknown');
  const frame = describe(working);
  assert.equal(frame.schemaVersion, 2);
  assert.deepEqual(frame.sourceToFrame, decoded.decodePlan.geometry.matrix);
  for (const mutate of [
    value => { value.workingImage.policyVersion = 'atlas-sdr-working-srgb8-v2'; value.treatment.policyVersion = 'atlas-sdr-working-srgb8-v2'; },
    value => { value.workingImage.sourceTreatment.channels = 3; },
    value => { value.workingImage.sourceTreatment.bitDepth = 16; },
    value => { value.workingImage.sourceTreatment.policyVersion = 'unqualified-alpha'; },
    value => { value.workingImage.sourceTreatment.colorSpace = 'Display P3'; },
    value => { value.workingImage.geometryTreatment = 'flattened'; },
  ]) {
    const changed = structuredClone(frame); mutate(changed);
    assert.throws(() => parseDecodedFrame(changed, decoded.original, decoded.decodePlan));
  }
});

test('one translucent pixel at the final canvas corner refuses; no background is invented', async () => {
  const decoded = await verifyAndDecodePhoto(request(await fixture('one-translucent-pixel.png')));
  const source = await sharp(decoded.png, { ignoreIcc: true }).raw().toBuffer();
  assert(source.subarray(0, -4).every((value, index) => index % 4 !== 3 || value === 255));
  assert(source.at(-1) < 255);
  await assert.rejects(deriveSdrWorkingPhoto(decoded), code('PHOTO_COLOR_UNSUPPORTED'));
});

test('opaque-alpha qualification retains source integrity, resource bounds and cancellation', async () => {
  const decoded = await verifyAndDecodePhoto(request(await fixture('opaque-p3.png')));
  const changed = { ...decoded, png: Buffer.from(decoded.png) }; changed.png[changed.png.length - 1] ^= 1;
  await assert.rejects(deriveSdrWorkingPhoto(changed), code('PHOTO_SOURCE_MISMATCH'));
  await assert.rejects(deriveSdrWorkingPhoto(decoded, { signal: AbortSignal.abort() }), code('PHOTO_DECODE_CANCELLED'));
  for (const limits of [{ ...decoded.decodePlan.limits, maxPixels: 10 },
    { ...decoded.decodePlan.limits, maxOutputBytes: 10 }, { ...decoded.decodePlan.limits, timeoutMs: 1 }]) {
    await assert.rejects(deriveSdrWorkingPhoto(decoded, { limits }), error => ['PHOTO_DECODE_LIMIT', 'PHOTO_DECODE_TIMEOUT'].includes(error.code));
  }
});

test('opaque-alpha policy does not broaden unsupported 16-bit alpha or HDR admission', async () => {
  const png = await sharp(await fixture('opaque-p3.png')).toColourspace('rgb16').png().toBuffer();
  const decoded = await verifyAndDecodePhoto(request(png));
  assert.equal(decoded.treatment.channels, 4);
  assert.equal(decoded.treatment.bitDepth, 16);
  await assert.rejects(deriveSdrWorkingPhoto(decoded), code('PHOTO_COLOR_UNSUPPORTED'));
  const original = await verifyAndDecodePhoto(request(await fixture('opaque-p3.png')));
  for (const policy of ['preserved', 'tone-mapped']) {
    const changed = structuredClone(original); changed.treatment.hdrTreatment = policy;
    await assert.rejects(deriveSdrWorkingPhoto(changed), code('PHOTO_HDR_UNSUPPORTED'));
  }
});
