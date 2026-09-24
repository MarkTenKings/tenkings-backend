import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { inspectContainer } from '../src/container.mjs';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto } from '../src/index.mjs';
import { fixture, segment, xml } from './jpeg-gain-map-fixture.mjs';
import { code, request, sha256, orient } from './helpers.mjs';
const inspect = bytes => inspectContainer(bytes, { allowAppleJpegSdrBase: true });
const actualShape = xml.replace(/<HDRGainMap:HDRGainMapVersion>[\s\S]*?<\/apdi:AuxiliaryImageType>/,
  '<apdi:AuxiliaryImageType>urn:com:apple:photo:2020:aux:hdrgainmap</apdi:AuxiliaryImageType>\n'
  + '<apdi:NativeFormat>1278226488</apdi:NativeFormat>\n<apdi:StoredFormat>1278226488</apdi:StoredFormat>\n'
  + '<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>\n<HDRGainMap:HDRGainMapHeadroom>2.000000</HDRGainMap:HDRGainMapHeadroom>');
function exif({ orientation = 1, little = false, colorSpace = 1, change = () => {} } = {}) {
  const tiff = Buffer.alloc(56); tiff.write(little ? 'II' : 'MM');
  const u16 = (at, value) => little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at);
  const u32 = (at, value) => little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at);
  u16(2, 42); u32(4, 8); u16(8, 2);
  u16(10, 0x112); u16(12, 3); u32(14, 1); u16(18, orientation);
  u16(22, 0x8769); u16(24, 4); u32(26, 1); u32(30, 38);
  u16(38, 1); u16(40, 0xa001); u16(42, 3); u32(44, 1); u16(48, colorSpace);
  change({ tiff, u16, u32 }); return segment(225, Buffer.concat([Buffer.from('Exif\0\0'), tiff]));
}
const make = options => fixture({ change: s => { s.icc = null; s.xml = actualShape; s.primaryExtra.push(exif(options)); } });
const policy = { jpegHdrPolicy: 'retain-hdr-use-sdr-base' };

test('explicit sRGB Apple gain-map originals retain their complete bytes and exact full-size oriented SDR pixels', async t => {
  const { first } = await make({ orientation: 1 });
  const expected = await sharp(first, { ignoreIcc: true }).raw().toBuffer();
  for (const little of [false, true]) for (let orientation = 1; orientation <= 8; orientation++) await t.test(`${little ? 'II' : 'MM'} orientation ${orientation}`, async () => {
    const { bytes } = await make({ little, orientation }), original = Buffer.from(bytes), parsed = inspect(bytes);
    assert.equal(parsed.jpegHdr.colorSpace, 'sRGB'); assert.equal(parsed.jpegHdr.iccSha256, null);
    const decoded = await verifyAndDecodePhoto(request(bytes, policy)), working = await deriveSdrWorkingPhoto(decoded);
    assert.deepEqual(bytes, original); assert.equal(decoded.original.content.sha256, sha256(original));
    assert.equal(decoded.original.metadata.dynamicRange, 'HDR');
    assert.equal(decoded.treatment.policyVersion, 'atlas-jpeg-apple-exif-srgb-base-v1');
    assert.deepEqual(decoded.raster.dimensions, orientation < 5 ? { width: 24, height: 18 } : { width: 18, height: 24 });
    assert.deepEqual(await sharp(decoded.png, { ignoreIcc: true }).raw().toBuffer(), orient(expected, 24, 18, 3, orientation));
    assert.deepEqual(await sharp(working.png, { ignoreIcc: true }).raw().toBuffer(), orient(expected, 24, 18, 3, orientation));
    assert.deepEqual(working.original, decoded.original); assert.equal((await sharp(working.png).metadata()).orientation, undefined);
  });
});

test('untagged, ambiguous, conflicting and malformed sRGB declarations fail closed', async t => {
  const cases = [
    ['untagged', s => { s.primaryExtra = []; }],
    ['uncalibrated', s => { s.primaryExtra = [exif({ colorSpace: 65535 })]; }],
    ['Adobe RGB', s => { s.primaryExtra = [exif({ colorSpace: 2 })]; }],
    ['duplicate Exif', s => s.primaryExtra.push(exif())],
    ['wrong TIFF magic', s => { s.primaryExtra = [exif({ change: ({ u16 }) => u16(2, 43) })]; }],
    ['outside IFD', s => { s.primaryExtra = [exif({ change: ({ u32 }) => u32(4, 4096) })]; }],
    ['circular IFD', s => { s.primaryExtra = [exif({ change: ({ u32 }) => u32(30, 8) })]; }],
    ['overlapping IFD', s => { s.primaryExtra = [exif({ change: ({ u32 }) => u32(30, 20) })]; }],
    ['wrong pointer type', s => { s.primaryExtra = [exif({ change: ({ u16 }) => u16(24, 3) })]; }],
    ['multiple pointers', s => { s.primaryExtra = [exif({ change: ({ u32 }) => u32(26, 2) })]; }],
    ['wrong color type', s => { s.primaryExtra = [exif({ change: ({ u16 }) => u16(42, 4) })]; }],
    ['multiple color values', s => { s.primaryExtra = [exif({ change: ({ u32 }) => u32(44, 2) })]; }],
    ['duplicate root tag', s => { s.primaryExtra = [exif({ change: ({ u16 }) => u16(10, 0x8769) })]; }],
    ['truncated Exif', s => { s.primaryExtra = [segment(225, Buffer.from('Exif\0\0II'))]; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const { bytes } = await fixture({ change: s => { s.icc = null; s.xml = actualShape; s.primaryExtra.push(exif()); change(s); } });
    assert.throws(() => inspect(bytes), code('PHOTO_HDR_UNSUPPORTED'));
  });
});

test('additional Apple properties are bounded, unique, paired and exactly one-component8', async t => {
  for (const [name, change] of [
    ['missing native', value => value.replace(/<apdi:NativeFormat>[^<]*<\/apdi:NativeFormat>/, '')],
    ['missing stored', value => value.replace(/<apdi:StoredFormat>[^<]*<\/apdi:StoredFormat>/, '')],
    ['different stored', value => value.replace('<apdi:StoredFormat>1278226488', '<apdi:StoredFormat>1278226489')],
    ['duplicate native', value => value.replace('</rdf:Description>', '<apdi:NativeFormat>1278226488</apdi:NativeFormat></rdf:Description>')],
    ['unknown property', value => value.replace('</rdf:Description>', '<apdi:Unknown>1</apdi:Unknown></rdf:Description>')],
    ['entity value', value => value.replace('>1278226488<', '>&one;<')],
    ['extra namespace', value => value.replace('rdf:about=""', 'rdf:about="" xmlns:evil="https://invalid.test"')],
    ['nested element', value => value.replace('>1278226488<', '><apdi:NativeFormat>1278226488</apdi:NativeFormat><')],
  ]) await t.test(name, async () => {
    const { bytes } = await fixture({ change: s => { s.icc = null; s.xml = change(actualShape); s.primaryExtra.push(exif()); } });
    assert.throws(() => inspect(bytes), code('PHOTO_HDR_UNSUPPORTED'));
  });
  const reversed = actualShape.replace('xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/" xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/"',
    'xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/" xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"');
  const { bytes } = await fixture({ change: s => { s.icc = null; s.xml = reversed; s.primaryExtra.push(exif()); } });
  assert.equal(inspect(bytes).jpegHdr.colorSpace, 'sRGB');
});
