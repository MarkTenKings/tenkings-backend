import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { parseDecodedFrame, transformPoint } from '@atlas/photo-core';
import { verifyAndDecodePhoto, describeDecodedFrame } from '../src/index.mjs';
import { code, limits, request, sha256, orient, rgb16Png, chunk } from './helpers.mjs';

const width = 11, height = 7;
const pixels = Buffer.alloc(width * height * 3);
for (let p = 0; p < width * height; p++) {
  pixels[p * 3] = p * 43 % 255; pixels[p * 3 + 1] = p * 17 % 255; pixels[p * 3 + 2] = p * 71 % 255;
}
async function encoded(format, orientation = 1) {
  return sharp(pixels, { raw: { width, height, channels: 3 } }).withMetadata({ orientation })
    .toFormat(format, format === 'webp' ? { lossless: true } : {}).toBuffer();
}

for (const format of ['png', 'jpeg', 'webp']) {
  test(`${format}: all eight actual EXIF orientations agree with independent pixel and descriptor transforms`, async t => {
    const baseline = await verifyAndDecodePhoto(request(await encoded(format)));
    const baselinePixels = await sharp(baseline.png).raw().toBuffer();
    for (let orientation = 1; orientation <= 8; orientation++) await t.test(`orientation ${orientation}`, async () => {
      const bytes = await encoded(format, orientation), preserved = Buffer.from(bytes);
      const result = await verifyAndDecodePhoto(request(bytes));
      assert.deepEqual(bytes, preserved);
      assert.equal(result.original.content.mime, `image/${format}`);
      assert.equal(result.original.content.sha256, sha256(preserved));
      assert.equal(result.original.metadata.orientation, orientation);
      assert.equal(result.original.metadata.orientationSource, 'exif');
      const actual = await sharp(result.png).raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual(actual.data, orient(baselinePixels, width, height, actual.info.channels, orientation));
      assert.equal(actual.info.width, orientation < 5 ? width : height);
      assert.equal(actual.info.height, orientation < 5 ? height : width);
      const frame = describeDecodedFrame(result, { id: 'frame', object: { key: 'decoded/front', versionId: 'v2' } });
      assert.deepEqual(parseDecodedFrame(frame, result.original, result.decodePlan), frame);
      for (const point of [{ x: 0, y: 0 }, { x: width - 1, y: height - 1 }, { x: 4, y: 2 }]) {
        const target = transformPoint(frame.sourceToFrame, point);
        const originalPixel = baselinePixels.subarray((point.y * width + point.x) * 3, (point.y * width + point.x + 1) * 3);
        const at = (target.y * actual.info.width + target.x) * 3;
        assert.deepEqual(actual.data.subarray(at, at + 3), originalPixel);
      }
      assert.equal((await sharp(result.png).metadata()).orientation, undefined);
      assert.equal(frame.raster.content.byteCount, result.png.length);
      assert.equal(frame.raster.content.sha256, sha256(result.png));
      assert.equal(frame.treatment.hdrTreatment, 'unknown');
    });
  });
}

test('16-bit PNG stays full-size 16-bit with more than 256 distinguishable samples', async () => {
  const bytes = rgb16Png(40, 20), result = await verifyAndDecodePhoto(request(bytes));
  assert.equal(result.original.metadata.bitDepth, 16);
  assert.equal(result.treatment.bitDepth, 16);
  assert.deepEqual(result.raster.dimensions, { width: 40, height: 20 });
  assert.equal(result.png[24], 16);
  const { data } = await sharp(result.png).toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
  const values = new Set();
  for (let at = 0; at < data.length; at += 6) values.add(data.readUInt16LE(at));
  assert.ok(values.size > 256, `retained ${values.size} samples`);
});

test('a 3024 × 4032 synthetic original retains all dimensions without automatic resizing', async () => {
  const bytes = await sharp({ create: { width: 3024, height: 4032, channels: 3, background: '#587da2' } }).png().toBuffer();
  const result = await verifyAndDecodePhoto(request(bytes, { limits: { ...limits,
    maxPixels: 3024 * 4032, maxRasterBytes: 3024 * 4032 * 8 } }));
  assert.deepEqual(result.original.metadata.encoded, { width: 3024, height: 4032 });
  assert.deepEqual(result.raster.dimensions, { width: 3024, height: 4032 });
  assert.equal(result.original.content.sha256, sha256(bytes));
});

test('observes ICC bytes and records actual sRGB conversion while keeping unknown dynamic range', async () => {
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).withIccProfile('p3').png().toBuffer();
  const source = await sharp(bytes).metadata(), result = await verifyAndDecodePhoto(request(bytes));
  const output = await sharp(result.png).metadata();
  assert.equal(result.original.metadata.iccSha256, sha256(source.icc));
  assert.notEqual(sha256(source.icc), sha256(output.icc));
  assert.equal(result.treatment.colorSpace, 'sRGB');
  assert.equal(result.treatment.colorTreatment, 'converted');
  assert.equal(result.original.metadata.dynamicRange, null);
  assert.equal(result.treatment.hdrTreatment, 'unknown');
});

test('alpha is retained in the separate raster', async () => {
  const bytes = await sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const result = await verifyAndDecodePhoto(request(bytes));
  assert.equal(result.treatment.channels, 4);
  const raw = await sharp(result.png).raw().toBuffer();
  for (let at = 3; at < raw.length; at += 4) assert.equal(raw[at], 128);
});

test('exact SHA/length/object checks reject changed input without rewriting it', async () => {
  const bytes = await encoded('png'), input = request(bytes), before = Buffer.from(bytes);
  const wrongHash = structuredClone(input.uploadPlan); wrongHash.expected.sha256 = '0'.repeat(64);
  await assert.rejects(verifyAndDecodePhoto({ ...input, uploadPlan: wrongHash }), code('PHOTO_SOURCE_MISMATCH'));
  await assert.rejects(verifyAndDecodePhoto({ ...input, bytes: bytes.subarray(1) }), code('PHOTO_SOURCE_MISMATCH'));
  await assert.rejects(verifyAndDecodePhoto({ ...input, observedObject: { key: 'other', versionId: 'v1' } }), code('PHOTO_SOURCE_MISMATCH'));
  assert.deepEqual(bytes, before);
});

test('caller mutation after dispatch cannot change the verified snapshot', async () => {
  const bytes = await encoded('png'), expected = sha256(bytes), pending = verifyAndDecodePhoto(request(bytes));
  bytes.fill(0);
  const result = await pending;
  assert.equal(result.original.content.sha256, expected);
  assert.equal(result.raster.dimensions.width, width);
});

test('existing unknown-metadata receipt remains immutable across repeated decoding', async () => {
  const bytes = await encoded('png'), first = await verifyAndDecodePhoto(request(bytes));
  const existingOriginal = { ...first.original, metadata: null };
  const second = await verifyAndDecodePhoto(request(bytes, { existingOriginal }));
  assert.deepEqual(second.original, existingOriginal);
  assert.ok(second.decodePlan.metadata.encoded.width === width);
  const third = await verifyAndDecodePhoto(request(bytes, { existingOriginal: second.original }));
  assert.deepEqual(third.original, second.original);
  assert.equal(third.raster.content.sha256, second.raster.content.sha256);
  await assert.rejects(verifyAndDecodePhoto(request(bytes, { existingOriginal,
    observedObject: { key: 'originals/front', versionId: 'changed' } })), code('PHOTO_UPLOAD_CONFLICT'));
});

test('an independently known dynamic range survives a decoder with no new range observation', async () => {
  const bytes = await encoded('png'), first = await verifyAndDecodePhoto(request(bytes));
  const existingOriginal = { ...first.original, metadata: { ...first.original.metadata, dynamicRange: 'SDR' } };
  const second = await verifyAndDecodePhoto(request(bytes, { existingOriginal }));
  assert.deepEqual(second.original, existingOriginal);
  assert.equal(second.decodePlan.metadata.dynamicRange, 'SDR');
  // Carrying a prior observation does not permit conflicting newly observed
  // orientation or dimensions on those bytes.
  const wrong = { ...existingOriginal, metadata: { ...existingOriginal.metadata, orientation: 3 } };
  await assert.rejects(verifyAndDecodePhoto(request(bytes, { existingOriginal: wrong })), code('PHOTO_SOURCE_MISMATCH'));
});

test('source bytes, pixels, RGBA16 raster budget and encoded output have independent finite bounds', async () => {
  const bytes = await encoded('png');
  for (const bound of [{ maxInputBytes: bytes.length - 1 }, { maxPixels: width * height - 1 },
    { maxRasterBytes: width * height * 8 - 1 }, { maxOutputBytes: 20 }]) {
    await assert.rejects(verifyAndDecodePhoto(request(bytes, { limits: { ...limits, ...bound } })), code('PHOTO_DECODE_LIMIT'));
  }
  for (const bound of [{ timeoutMs: 2_147_483_648 }, { timeoutMs: NaN }, { maxPixels: Infinity }]) {
    await assert.rejects(verifyAndDecodePhoto(request(bytes, { limits: { ...limits, ...bound } })), code('PHOTO_DECODE_LIMIT'));
  }
});

test('malformed real encoded images fail without returning partial frame success', async () => {
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = await encoded(format);
    await assert.rejects(verifyAndDecodePhoto(request(bytes.subarray(0, bytes.length - 5))), code('PHOTO_DECODE_INVALID'));
  }
  await assert.rejects(verifyAndDecodePhoto(request(Buffer.from('<svg></svg>'))), code('PHOTO_FORMAT_UNSUPPORTED'));
  // Keep complete PNG structure but corrupt actual compressed pixel bytes so
  // this failure must be discovered by the real pixel decoder.
  const corrupt = Buffer.from(await encoded('png'));
  const idat = corrupt.indexOf(Buffer.from('IDAT'));
  assert.ok(idat > 0); corrupt[idat + 5] ^= 255;
  await assert.rejects(verifyAndDecodePhoto(request(corrupt)), code('PHOTO_DECODE_INVALID'));
});

test('APNG, animated WebP, MPO and concatenated JPEG are not admitted as a first still frame', async () => {
  const png = await encoded('png');
  const animationControl = Buffer.alloc(8); animationControl.writeUInt32BE(2);
  const apng = Buffer.concat([png.subarray(0, 33), chunk('acTL', animationControl), png.subarray(33)]);
  await assert.rejects(verifyAndDecodePhoto(request(apng)), code('PHOTO_MULTIFRAME_UNSUPPORTED'));
  const webpChunk = (type, data) => {
    const head = Buffer.alloc(8); head.write(type); head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
  };
  const vp8x = Buffer.alloc(10); vp8x[0] = 2; vp8x.writeUIntLE(7, 4, 3); vp8x.writeUIntLE(5, 7, 3);
  const frames = [];
  for (const background of ['red', 'blue']) {
    const still = await sharp({ create: { width: 8, height: 6, channels: 3, background } }).webp().toBuffer();
    const head = Buffer.alloc(16); head.writeUIntLE(7, 6, 3); head.writeUIntLE(5, 9, 3); head.writeUIntLE(20, 12, 3);
    frames.push(webpChunk('ANMF', Buffer.concat([head, still.subarray(12)])));
  }
  const body = Buffer.concat([Buffer.from('WEBP'), webpChunk('VP8X', vp8x), webpChunk('ANIM', Buffer.alloc(6)), ...frames]);
  const riff = Buffer.alloc(8); riff.write('RIFF'); riff.writeUInt32LE(body.length, 4);
  const webp = Buffer.concat([riff, body]);
  assert.equal((await sharp(webp, { animated: true }).metadata()).pages, 2);
  await assert.rejects(verifyAndDecodePhoto(request(webp)), code('PHOTO_MULTIFRAME_UNSUPPORTED'));
  const jpeg = await encoded('jpeg');
  const mpo = Buffer.concat([jpeg.subarray(0, 2), Buffer.from('ffe200064d504600', 'hex'), jpeg.subarray(2)]);
  await assert.rejects(verifyAndDecodePhoto(request(mpo)), code('PHOTO_MULTIFRAME_UNSUPPORTED'));
  await assert.rejects(verifyAndDecodePhoto(request(Buffer.concat([jpeg, jpeg]))), code('PHOTO_DECODE_INVALID'));
});

test('known PNG PQ/HLG HDR flags fail explicitly', async () => {
  const png = await encoded('png');
  for (const transfer of [16, 18]) {
    const hdr = Buffer.concat([png.subarray(0, 33), chunk('cICP', Buffer.from([9, transfer, 0, 1])), png.subarray(33)]);
    await assert.rejects(verifyAndDecodePhoto(request(hdr)), code('PHOTO_HDR_UNSUPPORTED'));
  }
});

test('descriptor binding rejects original-key overwrite and changed returned PNG bytes', async () => {
  const result = await verifyAndDecodePhoto(request(await encoded('png')));
  assert.throws(() => describeDecodedFrame(result, { id: 'frame', object: result.original.object }), code('PHOTO_ORIGINAL_OVERWRITE'));
  result.png[40] ^= 1;
  assert.throws(() => describeDecodedFrame(result, { id: 'frame', object: { key: 'frame', versionId: null } }), code('PHOTO_SOURCE_MISMATCH'));
});
