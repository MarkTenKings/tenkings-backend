import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { inspectContainer } from '../src/container.mjs';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto } from '../src/index.mjs';
import { fixture, segment, xml, XMP } from './jpeg-gain-map-fixture.mjs';
import { primaryRegion, primaryXmp } from './jpeg-primary-xmp-fixture.mjs';
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
    assert.equal(decoded.treatment.policyVersion, 'atlas-jpeg-apple-exif-srgb-base-v2');
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

const primaryXmpSegment = text => segment(225, Buffer.concat([XMP, Buffer.from(text)]));
const makePrimaryXmp = (text = primaryXmp, orientation = 1, change = () => {}) => fixture({ change: s => {
  s.icc = null; s.xml = actualShape; s.primaryExtra.push(exif({ orientation }), primaryXmpSegment(text)); change(s);
} });

test('Apple capture/region XMP is retained and bound without cropping, reorienting or changing full-resolution pixels', async t => {
  const { first } = await make({ orientation: 1 });
  const expected = await sharp(first, { ignoreIcc: true }).raw().toBuffer();
  for (let orientation = 1; orientation <= 8; orientation++) await t.test(`orientation ${orientation}`, async () => {
    const { bytes } = await makePrimaryXmp(primaryXmp, orientation), original = Buffer.from(bytes);
    const decoded = await verifyAndDecodePhoto(request(bytes, policy)), working = await deriveSdrWorkingPhoto(decoded);
    assert.deepEqual(bytes, original); assert.equal(decoded.original.content.sha256, sha256(original));
    assert.equal(decoded.original.metadata.dynamicRange, 'HDR');
    assert.equal(decoded.original.metadata.crop, null);
    assert.deepEqual(decoded.raster.dimensions, orientation < 5 ? { width: 24, height: 18 } : { width: 18, height: 24 });
    assert.deepEqual(await sharp(decoded.png, { ignoreIcc: true }).raw().toBuffer(), orient(expected, 24, 18, 3, orientation));
    assert.deepEqual(await sharp(working.png, { ignoreIcc: true }).raw().toBuffer(), orient(expected, 24, 18, 3, orientation));
    assert.deepEqual(working.original, decoded.original);
    assert.equal((await sharp(working.png).metadata()).orientation, undefined);
  });
  const a = await makePrimaryXmp(), b = await makePrimaryXmp(primaryXmp.replace('>0.3<', '>0.4<'));
  assert.notEqual(inspect(a.bytes).jpegHdr.selection.metadataSha256, inspect(b.bytes).jpegHdr.selection.metadataSha256);
  const duplicate = primaryXmp.replace(primaryRegion, primaryRegion + primaryRegion);
  const reordered = duplicate.replace(/( xmlns:xmp=[^\n]+)\n( xmlns:mwg-rs=[^\n]+)/, '$2\n$1');
  assert.equal(inspect((await makePrimaryXmp(reordered)).bytes).jpegHdr.colorSpace, 'sRGB');
});

test('primary XMP admission rejects HDR claims, ambiguity, malformed XML and out-of-bounds region metadata', async t => {
  const cases = [
    ['HDR property', text => text.replace('</rdf:Description>', '<HDRGainMap:HDRGainMapHeadroom>4</HDRGainMap:HDRGainMapHeadroom></rdf:Description>')],
    ['HDR namespace', text => text.replace('xmlns:xmp="http://ns.adobe.com/xap/1.0/"', 'xmlns:xmp="http://ns.apple.com/HDRGainMap/1.0/"')],
    ['extra namespace', text => text.replace('rdf:about=""', 'rdf:about="" xmlns:hdr="http://ns.apple.com/HDRGainMap/1.0/"')],
    ['duplicate namespace', text => text.replace('xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"', 'xmlns:xmp="http://ns.adobe.com/xap/1.0/"')],
    ['duplicate property', text => text.replace('<xmp:CreatorTool>', '<xmp:CreateDate>2026-01-01T12:00:00</xmp:CreateDate><xmp:CreatorTool>')],
    ['XMP orientation', text => text.replace('</rdf:Description>', '<tiff:Orientation>8</tiff:Orientation></rdf:Description>')],
    ['property attribute', text => text.replace('<stArea:x>', '<stArea:x hdr:base="HDR">')],
    ['entity', text => text.replace('>0.3<', '>&gain;<')],
    ['doctype', text => '<!DOCTYPE x [<!ENTITY gain "4">]>' + text],
    ['processing instruction', text => '<?unsafe value?>' + text],
    ['comment', text => text.replace('<rdf:Seq>', '<rdf:Seq><!-- ignored? -->')],
    ['nested property', text => text.replace('>0.3<', '><stArea:x>0.3</stArea:x><')],
    ['truncated', text => text.slice(0, -12)],
    ['trailing payload', text => text + '<HDRGainMap:HDRGainMapHeadroom>4</HDRGainMap:HDRGainMapHeadroom>'],
    ['wrong dimensions', text => text.replace('<stDim:w>24', '<stDim:w>25')],
    ['non-normalized region', text => text.replace('>0.3<', '>1.3<')],
    ['nonfinite region', text => text.replace('>0.3<', '>NaN<')],
    ['no regions', text => text.replace(primaryRegion, '')],
    ['too many regions', text => text.replace(primaryRegion, primaryRegion.repeat(33))],
    ['oversized packet', text => text + ' '.repeat(16_384)],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const { bytes } = await makePrimaryXmp(change(primaryXmp));
    assert.throws(() => inspect(bytes), code('PHOTO_HDR_UNSUPPORTED'));
  });
  for (const [name, change] of [
    ['duplicate packet', s => s.primaryExtra.push(primaryXmpSegment(primaryXmp))],
    ['invalid UTF-8', s => s.primaryExtra.splice(1, 1, primaryXmpSegment(Buffer.from([0xff])))],
    ['HDR base still rejected', s => s.gain.writeUInt32BE(1, 5)],
    ['missing color evidence still rejected', s => s.primaryExtra.shift()],
  ]) await t.test(name, async () => {
    const { bytes } = await makePrimaryXmp(primaryXmp, 1, change);
    assert.throws(() => inspect(bytes), code('PHOTO_HDR_UNSUPPORTED'));
  });
});
