import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '../src/index.mjs';
import { request, rgb16Png, sha256, chunk, code } from './helpers.mjs';
import { withProperties } from './heif-fixture-helpers.mjs';

async function assertPixelsAndProfile(actual, previous, bitDepth) {
  const a = await sharp(actual).metadata(), b = await sharp(previous).metadata();
  for (const field of ['width', 'height', 'channels', 'depth', 'orientation', 'space']) assert.equal(a[field], b[field], field);
  assert.deepEqual(a.icc, b.icc);
  const samples = png => sharp(png, { ignoreIcc: true }).toColourspace(bitDepth === 16 ? 'rgb16' : 'srgb')
    .raw({ depth: bitDepth === 16 ? 'ushort' : 'uchar' }).toBuffer();
  assert.deepEqual(await samples(actual), await samples(previous));
}

test('v2 deflate effort preserves all decoded samples, ICC, orientation and RGB/RGBA8/16 dimensions', async () => {
  const pixels = Buffer.alloc(73 * 51 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 43 + (i >>> 7) * 19) % 256;
  const image = () => sharp(pixels, { raw: { width: 73, height: 51, channels: 3 } });
  const originals = [
    await image().withIccProfile('p3').withMetadata({ orientation: 6 }).jpeg().toBuffer(),
    await image().withIccProfile('srgb').png().toBuffer(),
    await image().withMetadata({ orientation: 2 }).webp({ lossless: true }).toBuffer(),
    rgb16Png(40, 20),
    await image().ensureAlpha(.5).png().toBuffer(),
  ];
  for (const original of originals) {
    const unchanged = Buffer.from(original), actual = await verifyAndDecodePhoto(request(original));
    const color = actual.treatment.bitDepth === 16 ? 'rgb16' : 'srgb';
    const previous = await sharp(original, { failOn: 'warning', sequentialRead: true }).rotate()
      .pipelineColourspace(color).withIccProfile('srgb').toColourspace(color)
      .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }).toBuffer();
    await assertPixelsAndProfile(actual.png, previous, actual.treatment.bitDepth);
    assert.equal(actual.treatment.policyVersion, 'atlas-native-raster-srgb-v2');
    assert.deepEqual(original, unchanged); assert.equal(actual.original.content.sha256, sha256(unchanged));
  }
});

test('v2 working encoder preserves exact prior full-size ICC-converted output for P3 RGB8/10/12', async () => {
  const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));
  const profile = Buffer.concat([Buffer.from('prof'), await fixture('DisplayP3-v4.icc')]);
  for (const file of ['colors-no-alpha.heic', 'rgb10.heic', 'rgb12.heic']) {
    const original = withProperties(await fixture(file), [['colr', profile]]);
    const rich = await verifyAndDecodePhoto(request(original)), preserved = Buffer.from(rich.png);
    const actual = await deriveSdrWorkingPhoto(rich);
    const previous = await sharp(rich.png, { failOn: 'warning', sequentialRead: true }).pipelineColourspace('srgb')
      .withIccProfile('srgb').toColourspace('srgb').png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }).toBuffer();
    await assertPixelsAndProfile(actual.png, previous, 8); assert.deepEqual(rich.png, preserved);
    assert.equal(actual.workingImage.policyVersion, 'atlas-sdr-working-srgb8-v2');
    const frame = describeDecodedFrame(actual, { id: 'frame', object: { key: 'frame', versionId: 'v1' } });
    const legacy = structuredClone(frame); legacy.treatment.policyVersion = legacy.workingImage.policyVersion = 'atlas-sdr-working-srgb8-v1';
    assert.deepEqual(parseDecodedFrame(legacy, actual.original, actual.decodePlan), legacy);
    assert.notEqual(descriptorSha256(frame), descriptorSha256(legacy));
    const unknown = structuredClone(frame); unknown.treatment.policyVersion = unknown.workingImage.policyVersion = 'atlas-sdr-working-srgb8-v99';
    assert.throws(() => parseDecodedFrame(unknown, actual.original, actual.decodePlan));
  }
});

test('qualified RGB8 identity policy retains every PNG byte and rejects descriptor provenance drift', async () => {
  const original = await sharp({ create: { width: 119, height: 83, channels: 3, background: '#3872a4' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rich = await verifyAndDecodePhoto(request(original)), actual = await deriveSdrWorkingPhoto(rich);
  assert.equal(actual.workingImage.policyVersion, 'atlas-sdr-working-srgb8-identity-v3');
  assert.deepEqual(actual.png, rich.png); assert.deepEqual(actual.raster.content, rich.raster.content);
  const prior = await sharp(rich.png).pipelineColourspace('srgb').withIccProfile('srgb').toColourspace('srgb')
    .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false }).toBuffer();
  await assertPixelsAndProfile(actual.png, prior, 8);
  const frame = describeDecodedFrame(actual, { id: 'identity-frame', object: { key: 'working/front', versionId: '1' } });
  for (const mutate of [v => v.workingImage.sourceRaster.content.sha256 = 'a'.repeat(64),
    v => v.workingImage.sourceTreatment.policyVersion = 'unqualified', v => v.workingImage.sourceTreatment.version = 'other',
    v => v.workingImage.sourceTreatment.bitDepth = 16, v => v.workingImage.sourceTreatment.colorTreatment = 'preserved',
    v => v.workingImage.sourceTreatment.colorSpace = 'Display P3']) {
    const changed = structuredClone(frame); mutate(changed);
    assert.throws(() => parseDecodedFrame(changed, actual.original, actual.decodePlan));
  }
  const unqualified = { ...rich, treatment: { ...rich.treatment, policyVersion: 'other-runtime-policy' } };
  assert.equal((await deriveSdrWorkingPhoto(unqualified)).workingImage.policyVersion, 'atlas-sdr-working-srgb8-v2');
  const high = await verifyAndDecodePhoto(request(rgb16Png(40, 20)));
  assert.equal((await deriveSdrWorkingPhoto(high)).workingImage.policyVersion, 'atlas-sdr-working-srgb8-v2');
});

test('identity path checks full PNG entropy and output bounds before copying any accepted output', async () => {
  const original = await sharp({ create: { width: 61, height: 39, channels: 3, background: '#92aa34' } }).png().toBuffer();
  const rich = await verifyAndDecodePhoto(request(original));
  const typeAt = rich.png.indexOf(Buffer.from('IDAT')), length = rich.png.readUInt32BE(typeAt - 4);
  const payload = Buffer.from(rich.png.subarray(typeAt + 4, typeAt + 4 + length)); payload[0] ^= 255;
  const png = Buffer.concat([rich.png.subarray(0, typeAt - 4), chunk('IDAT', payload), rich.png.subarray(typeAt + length + 8)]);
  const corrupt = { ...rich, png, raster: { ...rich.raster, content: { ...rich.raster.content, byteCount: png.length, sha256: sha256(png) } } };
  await assert.rejects(deriveSdrWorkingPhoto(corrupt), code('PHOTO_DECODE_INVALID'));
  await assert.rejects(deriveSdrWorkingPhoto(rich, { limits: { ...rich.decodePlan.limits, maxOutputBytes: rich.png.length - 1 } }), code('PHOTO_DECODE_LIMIT'));
});
