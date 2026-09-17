import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { verifyAndDecodePhoto, describeDecodedFrame } from '../src/index.mjs';
import { inspectHeifExif, qualifyHeifIcc } from '../src/heif-metadata.mjs';
import { code, orient, request, sha256 } from './helpers.mjs';
import { cropProperty, gridFixture, orientationExif, withExif, withProperties } from './heif-fixture-helpers.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));
const base = await fixture('colors-no-alpha.heic');
const raw = png => sharp(png, { ignoreIcc: true }).raw().toBuffer();
const wrap = tiff => Buffer.concat([Buffer.alloc(4), tiff]);
const transformations = [[], [['imir', Buffer.from([1])]], [['irot', Buffer.from([2])]],
  [['imir', Buffer.from([0])]], [['irot', Buffer.from([1])], ['imir', Buffer.from([0])]],
  [['irot', Buffer.from([3])]], [['irot', Buffer.from([3])], ['imir', Buffer.from([0])]], [['irot', Buffer.from([1])]]];

for (const little of [false, true]) test(`HEIF Exif orientation is descriptive for all eight TIFF values (${little ? 'II' : 'MM'})`, async () => {
  const expected = await raw((await verifyAndDecodePhoto(request(base))).png);
  for (let orientation = 1; orientation <= 8; orientation++) {
    const tiff = orientationExif(orientation, little), bytes = withExif(base, tiff, { prefix: Buffer.from('Exif\0\0') });
    assert.deepEqual(inspectHeifExif(wrap(tiff)), { orientation, ifdCount: 1 });
    const result = await verifyAndDecodePhoto(request(bytes));
    assert.equal(result.original.content.sha256, sha256(bytes));
    assert.equal(result.decodePlan.metadata.orientation, 1);
    assert.equal(result.decodePlan.metadata.orientationSource, 'identity');
    assert.deepEqual(await raw(result.png), expected);
    assert.equal((await sharp(result.png).metadata()).exif, undefined);
  }
});

test('conflicting Exif cannot apply a second transform to any qualified HEIF rotation/mirror', async () => {
  const expected = await raw((await verifyAndDecodePhoto(request(base))).png);
  for (let orientation = 1; orientation <= 8; orientation++) {
    const bytes = withExif(withProperties(base, transformations[orientation - 1]), orientationExif(8));
    const result = await verifyAndDecodePhoto(request(bytes));
    assert.equal(result.decodePlan.metadata.orientation, orientation);
    assert.deepEqual(await raw(result.png), orient(expected, 64, 64, 3, orientation));
  }
});

// A complete ordinary graph: IFD0 -> Exif -> interoperability, GPS and IFD1.
// MakerNote and an embedded JPEG thumbnail are bounded opaque bytes.
function graph() {
  const t = Buffer.alloc(236); t.write('MM'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  function ifd(at, entries, next = 0) {
    t.writeUInt16BE(entries.length, at);
    entries.forEach(([tag, type, count, value], i) => {
      const p = at + 2 + i * 12; t.writeUInt16BE(tag, p); t.writeUInt16BE(type, p + 2); t.writeUInt32BE(count, p + 4);
      if (type === 3 && count === 1) t.writeUInt16BE(value, p + 8); else t.writeUInt32BE(value, p + 8);
    });
    t.writeUInt32BE(next, at + 2 + entries.length * 12);
  }
  ifd(8, [[0x0112, 3, 1, 6], [0x8769, 4, 1, 50], [0x8825, 4, 1, 98]], 122);
  ifd(50, [[0xa005, 4, 1, 80], [0x927c, 7, 12, 200]]);
  ifd(80, [[1, 2, 4, 0x52393800]]);
  ifd(98, [[0, 1, 4, 0x02030000]]);
  ifd(122, [[0x0112, 3, 1, 1], [0x0201, 4, 1, 212], [0x0202, 4, 1, 24]]);
  t.write('opaque maker', 200); t.writeUInt16BE(0xffd8, 212); t.writeUInt16BE(0xffd9, 234);
  return t;
}

test('ordinary Exif/GPS/interop/thumbnail graph is fully bounded before real HEVC decoding', async () => {
  const tiff = graph(); assert.deepEqual(inspectHeifExif(wrap(tiff)), { orientation: 6, ifdCount: 5 });
  const bytes = withExif(base, tiff), result = await verifyAndDecodePhoto(request(bytes));
  assert.equal(result.decodePlan.metadata.orientation, 1);
  assert.equal((await sharp(result.png).metadata()).exif, undefined);
  const grid = withExif(gridFixture(base, { padding: [0, 0], primaryProperties: [cropProperty(104, 104), ['irot', Buffer.from([3])]] }), tiff);
  assert.equal((await verifyAndDecodePhoto(request(grid))).decodePlan.metadata.orientation, 6);
  await assert.rejects(verifyAndDecodePhoto(request(withExif(gridFixture(base), tiff, { associatedId: 1 }))), code('PHOTO_GEOMETRY_UNSUPPORTED'));
});

test('malformed linked IFDs, orientation, offsets, duplicate tags and cycles are refused before adoption', async () => {
  const changes = [
    t => t.writeUInt32BE(99999, 4), t => t.writeUInt32BE(8, 30), // outside/cycle Exif pointer
    t => t.writeUInt32BE(230, 30), t => t.writeUInt32BE(1000, 72), // truncated IFD/MakerNote
    t => t.writeUInt16BE(9, 18), t => t.writeUInt16BE(4, 12), // invalid orientation/type
    t => t.writeUInt16BE(0x0112, 22), t => t.writeUInt32BE(9999, 156), // duplicate/thumbnail extent
    t => t.writeUInt32BE(50, 72), // MakerNote overlaps an IFD
  ];
  for (const change of changes) {
    const tiff = graph(); change(tiff);
    assert.throws(() => inspectHeifExif(wrap(tiff)), code('PHOTO_GEOMETRY_UNSUPPORTED'));
    await assert.rejects(verifyAndDecodePhoto(request(withExif(base, tiff))), code('PHOTO_GEOMETRY_UNSUPPORTED'));
  }
  const offset = wrap(orientationExif(1)); offset.writeUInt32BE(0xffffffff);
  assert.throws(() => inspectHeifExif(offset), code('PHOTO_GEOMETRY_UNSUPPORTED'));
  await assert.rejects(verifyAndDecodePhoto(request(withExif(withExif(base, orientationExif(1)), orientationExif(6)))), code('PHOTO_GEOMETRY_UNSUPPORTED'));
});

function samples(png) {
  const chunks = []; for (let at = 8; at < png.length;) { const n = png.readUInt32BE(at); if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + n)); at += n + 12; }
  const rows = inflateSync(Buffer.concat(chunks)), height = png.readUInt32BE(20), row = png.readUInt32BE(16) * (png[24] === 16 ? 6 : 3), data = Buffer.alloc(height * row);
  for (let y = 0; y < height; y++) { assert.equal(rows[y * (row + 1)], 0); rows.copy(data, y * row, y * (row + 1) + 1, (y + 1) * (row + 1)); }
  return data;
}

for (const [file, name] of [['sRGB-v4.icc', 'sRGB'], ['DisplayP3-v4.icc', 'Display P3']]) {
  test(`qualified ${name} ICC is preserved with every native 8/10/12-bit sample`, async () => {
    const icc = await fixture(file); assert.equal(qualifyHeifIcc(icc), name);
    for (const depth of [8, 10, 12]) {
      const source = depth === 8 ? base : await fixture(`rgb${depth}.heic`), prior = await verifyAndDecodePhoto(request(source));
      const bytes = withExif(withProperties(source, [['colr', Buffer.concat([Buffer.from('prof'), icc])]]), orientationExif(7));
      const result = await verifyAndDecodePhoto(request(bytes)), meta = await sharp(result.png).metadata();
      assert.deepEqual(samples(result.png), samples(prior.png));
      assert.deepEqual(meta.icc, icc); assert.equal(meta.exif, undefined);
      assert.equal(result.treatment.bitDepth, depth === 8 ? 8 : 16);
      assert.equal(result.treatment.colorSpace, name); assert.equal(result.treatment.colorTreatment, 'preserved');
      assert.equal(result.treatment.hdrTreatment, 'not-present'); assert.equal(result.original.metadata.iccSha256, sha256(icc));
      assert.equal(result.original.content.sha256, sha256(bytes));
      const frame = describeDecodedFrame(result, { id: 'icc-frame', object: { key: 'frames/icc.png', versionId: 'v1' } });
      assert.equal(frame.treatment.colorSpace, name);
      if (depth > 8) { const values = new Set(); for (let i = 0, s = samples(result.png); i < s.length; i += 2) values.add(s.readUInt16BE(i)); assert.ok(values.size > 256); }
    }
  });
}

test('grid ICC may be on the primary alone or matching tiles; conflicts and unknown profile bytes refuse', async () => {
  const p3 = Buffer.concat([Buffer.from('prof'), await fixture('DisplayP3-v4.icc')]);
  const srgb = Buffer.concat([Buffer.from('prof'), await fixture('sRGB-v4.icc')]);
  const expected = await verifyAndDecodePhoto(request(gridFixture(base)));
  for (const tileColor of [null, p3]) {
    const result = await verifyAndDecodePhoto(request(withExif(gridFixture(base, { color: p3, tileColor }), graph())));
    assert.equal(result.treatment.colorSpace, 'Display P3'); assert.deepEqual(samples(result.png), samples(expected.png));
  }
  await assert.rejects(verifyAndDecodePhoto(request(gridFixture(base, { color: p3, tileColor: srgb }))), code('PHOTO_COLOR_UNSUPPORTED'));
  await assert.rejects(verifyAndDecodePhoto(request(withProperties(base, [['colr', p3], ['colr', p3]]))), code('PHOTO_COLOR_UNSUPPORTED'));
  for (const icc of [Buffer.alloc(0), Buffer.from('bad-profile'), Buffer.from(p3.subarray(4))]) {
    if (icc.length === 480) icc[100] ^= 1;
    await assert.rejects(verifyAndDecodePhoto(request(withProperties(base, [['colr', Buffer.concat([Buffer.from('prof'), icc])]]))), code('PHOTO_COLOR_UNSUPPORTED'));
  }
});

test('ICC does not override HDR refusal or qualify NCLX-only P3', async () => {
  const icc = Buffer.concat([Buffer.from('prof'), await fixture('DisplayP3-v4.icc')]);
  for (const transfer of [16, 18]) {
    const nclx = Buffer.from('6e636c78000c000d000680', 'hex'); nclx.writeUInt16BE(transfer, 6);
    await assert.rejects(verifyAndDecodePhoto(request(withProperties(base, [['colr', icc], ['colr', nclx]]))), code('PHOTO_HDR_UNSUPPORTED'));
  }
  await assert.rejects(verifyAndDecodePhoto(request(withProperties(base, [['colr', Buffer.from('6e636c78000c000d000680', 'hex')]]))), code('PHOTO_COLOR_UNSUPPORTED'));
});

test('an inherited grid ICC requires every tile to carry the matching profile', async () => {
  const p3 = Buffer.concat([Buffer.from('prof'), await fixture('DisplayP3-v4.icc')]);
  const unprofiled = await verifyAndDecodePhoto(request(base));
  assert.equal(unprofiled.treatment.colorTreatment, 'unmanaged');
  // No primary ICC: matching explicit profiles on every tile qualify inheritance.
  const uniform = await verifyAndDecodePhoto(request(gridFixture(base, { color: null, tileColor: p3 })));
  assert.equal(uniform.treatment.colorSpace, 'Display P3');
  assert.equal(uniform.treatment.colorTreatment, 'preserved');
  // libheif copies only the first tile's ICC to its primary handle. That alone
  // cannot qualify the other tiles when their source color remains unknown.
  for (const tileColorIds of [[1], [1, 2, 3]]) {
    await assert.rejects(verifyAndDecodePhoto(request(gridFixture(base,
      { color: null, tileColor: p3, tileColorIds }))), code('PHOTO_COLOR_UNSUPPORTED'));
  }
  // An explicit primary profile still governs the complete image, including
  // tiles with no redundant profile and tiles with the same redundant profile.
  for (const tileColorIds of [[], [1]]) {
    const result = await verifyAndDecodePhoto(request(gridFixture(base,
      { color: p3, tileColor: p3, tileColorIds })));
    assert.equal(result.treatment.colorSpace, 'Display P3');
    assert.equal(result.treatment.colorTreatment, 'preserved');
    assert.deepEqual(samples(result.png), samples(uniform.png));
  }
});
