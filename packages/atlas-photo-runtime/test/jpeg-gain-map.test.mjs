import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectContainer } from '../src/container.mjs';
import { verifyAndDecodePhoto } from '../src/index.mjs';
import { code, request, sha256 } from './helpers.mjs';
import { fixture, segment, ISO, XMP, ICC } from './jpeg-gain-map-fixture.mjs';
const inspect = bytes => inspectContainer(bytes, { allowAppleJpegSdrBase: true });

test('qualified two-image JPEG binds exact primary, auxiliary and metadata spans in both TIFF byte orders', async () => {
  for (const little of [false, true]) {
    const { bytes, first, secondary, spec } = await fixture({ little }), before = Buffer.from(bytes);
    const { jpegHdr } = inspect(bytes);
    assert.deepEqual(bytes, before);
    assert.equal(jpegHdr.primaryWidth, 24); assert.equal(jpegHdr.primaryHeight, 18);
    assert.equal(jpegHdr.gainMapWidth, 12); assert.equal(jpegHdr.gainMapHeight, 9);
    assert.equal(jpegHdr.iccSha256, sha256(spec.icc));
    assert.equal(jpegHdr.selection.kind, 'primary-jpeg-sdr-base');
    assert.equal(jpegHdr.selection.primaryByteCount, first.length);
    assert.equal(jpegHdr.selection.gainMapByteCount, secondary.length);
    assert.equal(jpegHdr.selection.gainMapSha256, sha256(secondary));
    assert.match(jpegHdr.selection.metadataSha256, /^[0-9a-f]{64}$/);
    assert.throws(() => inspectContainer(bytes), code('PHOTO_MULTIFRAME_UNSUPPORTED'));
    // Structural recognition cannot allow an unqualified ICC into the worker.
    await assert.rejects(verifyAndDecodePhoto(request(bytes, { jpegHdrPolicy: 'retain-hdr-use-sdr-base' })), code('PHOTO_COLOR_UNSUPPORTED'));
  }
});

test('MPF offsets, versions, counts, attributes, dependent images and full byte coverage fail closed', async t => {
  const mutations = [
    ['IFD offset', ({ u32 }) => u32(4, 9)], ['extra tag', ({ u16 }) => u16(8, 4)],
    ['version', ({ tiff }) => tiff.write('0200', 18)], ['three images', ({ u32 }) => u32(30, 3)],
    ['entry array size', ({ u32 }) => u32(38, 48)], ['entry array offset', ({ u32 }) => u32(42, 52)],
    ['next IFD', ({ u32 }) => u32(46, 8)], ['unrelated primary', ({ u32 }) => u32(50, 0x020001)],
    ['primary size', ({ u32 }) => u32(54, 1)], ['primary offset', ({ u32 }) => u32(58, 1)],
    ['primary dependency', ({ u32 }) => u32(62, 1)], ['aux type', ({ u32 }) => u32(66, 0x30000)],
    ['aux size', ({ u32 }) => u32(70, 1)], ['overlap', ({ u32 }) => u32(74, 20)],
    ['overflow offset', ({ u32 }) => u32(74, 0xffffffff)], ['aux dependency', ({ u32 }) => u32(78, 1)],
  ];
  for (const [name, patchIndex] of mutations) await t.test(name, async () => {
    const { bytes } = await fixture({ change: spec => { spec.patchIndex = patchIndex; } });
    assert.throws(() => inspect(bytes), code('PHOTO_HDR_UNSUPPORTED'));
  });
  for (const [name, change] of [
    ['trailing image', s => { s.trailing = s.aux; }], ['gap', s => { s.gap = Buffer.from([0]); }],
    ['duplicate MPF', s => s.primaryExtra.push(segment(226, Buffer.from('MPF\0')))],
    ['nested MPF', s => s.auxExtra.push(segment(226, Buffer.from('MPF\0')))],
    ['RGB auxiliary', s => { s.aux = s.primary; }],
  ]) await t.test(name, async () => {
    const { bytes } = await fixture({ change });
    assert.throws(() => inspect(bytes), error => ['PHOTO_HDR_UNSUPPORTED', 'PHOTO_DECODE_INVALID'].includes(error.code));
  });
});

test('gain-map ISO and Apple XMP claims are required, closed, forward SDR and internally consistent', async t => {
  const cases = [
    ['ISO writer version', s => { s.gain[3] = 1; }], ['primary ISO version', s => { s.primaryIso[3] = 1; }],
    ['multichannel', s => { s.gain[4] |= 128; }], ['backward direction', s => { s.gain[4] |= 4; }],
    ['common denominator', s => { s.gain[4] |= 8; }], ['wrong color space', s => { s.gain[4] = 0; }],
    ['zero denominator', s => s.gain.writeUInt32BE(0, 17)], ['HDR base', s => s.gain.writeUInt32BE(1, 5)],
    ['zero gamma', s => s.gain.writeUInt32BE(0, 37)], ['reverse gain', s => s.gain.writeInt32BE(2, 21)],
    ['negative offset', s => s.gain.writeInt32BE(-1, 45)],
    ['duplicate ISO', s => s.auxExtra.push(segment(226, Buffer.concat([ISO, s.gain])))],
    ['duplicate XMP', s => s.auxExtra.push(segment(225, Buffer.concat([XMP, Buffer.from(s.xml)])))],
    ['primary XMP', s => s.primaryExtra.push(segment(225, Buffer.concat([XMP, Buffer.from(s.xml)])))],
    ['wrong namespace', s => { s.xml = s.xml.replace('ns.apple.com/HDRGainMap', 'invalid.test/HDRGainMap'); }],
    ['wrong auxiliary', s => { s.xml = s.xml.replace('aux:hdrgainmap', 'aux:disparity'); }],
    ['wrong version', s => { s.xml = s.xml.replace('131072', '131073'); }],
    ['headroom disagreement', s => { s.xml = s.xml.replace('2.000000', '3.000000'); }],
    ['DTD entity', s => { s.xml = '<!DOCTYPE x [<!ENTITY x "2">]>' + s.xml; }],
    ['duplicate property', s => { s.xml = s.xml.replace('</rdf:Description>', '<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion></rdf:Description>'); }],
    ['extra payload', s => { s.xml += '<unrelated/>'; }],
    ['split ICC', s => s.primaryExtra.push(segment(226, Buffer.concat([ICC, Buffer.from([2, 2]), s.icc])))],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const { bytes } = await fixture({ change }); assert.throws(() => inspect(bytes), code('PHOTO_HDR_UNSUPPORTED'));
  });
});

test('truncated/concatenated JPEG, omitted MP index and invalid explicit policy remain refused', async () => {
  const { bytes, first, secondary } = await fixture();
  for (const truncated of [bytes.subarray(0, 20), bytes.subarray(0, first.length - 2), bytes.subarray(0, bytes.length - 2)])
    assert.throws(() => inspect(truncated));
  const noMP = Buffer.concat([first.subarray(0, 2), first.subarray(92), secondary]);
  assert.throws(() => inspect(noMP));
  await assert.rejects(verifyAndDecodePhoto(request(bytes, { jpegHdrPolicy: 'allow-all-mpo' })), code('PHOTO_HDR_UNSUPPORTED'));
});

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { deriveSdrWorkingPhoto, describeDecodedFrame } from '../src/index.mjs';
import { orient, limits } from './helpers.mjs';
import { colorOracle } from './color-oracle.mjs';
const appleIcc = await readFile(new URL('./fixtures/Apple-DisplayP3.icc', import.meta.url));
function exifOrientation(orientation) {
  const tiff = Buffer.alloc(26); tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x112, 10); tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18);
  return segment(225, Buffer.concat([Buffer.from('Exif\0\0'), tiff]));
}
const policy = { jpegHdrPolicy: 'retain-hdr-use-sdr-base' };

test('qualified synthetic Apple JPEG preserves the HDR original and independently verified SDR color/orientation for all eight EXIF codes', async t => {
  const { bytes, first } = await fixture({ change: s => { s.icc = appleIcc; } });
  const base = await verifyAndDecodePhoto(request(bytes, policy));
  const baseline = await sharp(base.png, { ignoreIcc: true }).raw().toBuffer();
  const native = await sharp(first, { ignoreIcc: true }).raw().toBuffer(), outputMeta = await sharp(base.png).metadata();
  let max = 0, changes = 0;
  for (let i = 0; i < native.length; i += 3) {
    const expected = colorOracle(appleIcc, outputMeta.icc, [...native.subarray(i, i + 3)]);
    for (let c = 0; c < 3; c++) { max = Math.max(max, Math.abs(baseline[i + c] - expected[c])); if (native[i + c] !== baseline[i + c]) changes++; }
  }
  assert.ok(max <= 2, `independent ICC error ${max}`); assert.ok(changes > 0);
  for (let orientation = 1; orientation <= 8; orientation++) await t.test(`orientation ${orientation}`, async () => {
    const { bytes } = await fixture({ change: s => { s.icc = appleIcc; s.primaryExtra.push(exifOrientation(orientation)); } });
    const before = Buffer.from(bytes), rich = await verifyAndDecodePhoto(request(bytes, policy));
    const working = await deriveSdrWorkingPhoto(rich);
    assert.deepEqual(await sharp(working.png, { ignoreIcc: true }).raw().toBuffer(), orient(baseline, 24, 18, 3, orientation));
    assert.deepEqual(await sharp(rich.png, { ignoreIcc: true }).raw().toBuffer(), await sharp(working.png, { ignoreIcc: true }).raw().toBuffer());
    assert.deepEqual(bytes, before); assert.equal(rich.original.content.sha256, sha256(before));
    assert.equal(rich.original.metadata.dynamicRange, 'HDR');
    assert.equal(rich.treatment.policyVersion, 'atlas-jpeg-apple-sdr-base-srgb-v1');
    assert.equal(rich.treatment.hdrTreatment, 'sdr-base'); assert.equal((await sharp(working.png).metadata()).orientation, undefined);
    assert.deepEqual(working.original, rich.original); assert.deepEqual(working.decodePlan, rich.decodePlan);
    assert.equal(describeDecodedFrame(working, { id: 'synthetic-working', object: { key: 'working/front', versionId: '1' } }).schemaVersion, 2);
  });
});

test('JPEG gain-map admission enforces actual entropy, resource bounds and immutable unknown-metadata retries', async () => {
  const { bytes } = await fixture({ change: s => { s.icc = appleIcc; } });
  await assert.rejects(verifyAndDecodePhoto(request(bytes)), code('PHOTO_MULTIFRAME_UNSUPPORTED'));
  const first = await verifyAndDecodePhoto(request(bytes, policy));
  const existingOriginal = { ...first.original, metadata: null };
  const retry = await verifyAndDecodePhoto(request(bytes, { ...policy, existingOriginal }));
  assert.deepEqual(retry.original, existingOriginal); assert.equal(retry.raster.content.sha256, first.raster.content.sha256);
  for (const bound of [{ maxPixels: 24 * 18 - 1 }, { maxRasterBytes: 24 * 18 * 8 - 1 }, { maxOutputBytes: 20 }])
    await assert.rejects(verifyAndDecodePhoto(request(bytes, { ...policy, limits: { ...limits, ...bound } })), code('PHOTO_DECODE_LIMIT'));
  const corrupt = await fixture({ change: s => { s.icc = appleIcc;
    const sos = s.aux.indexOf(Buffer.from([255, 218])); assert.ok(sos > 0);
    const entropy = sos + 2 + s.aux.readUInt16BE(sos + 2);
    s.aux = Buffer.concat([s.aux.subarray(0, entropy), Buffer.from([255, 217])]);
  } });
  assert.ok(inspect(corrupt.bytes).jpegHdr);
  await assert.rejects(verifyAndDecodePhoto(request(corrupt.bytes, policy)), error => error.code === 'PHOTO_DECODE_INVALID');
});
