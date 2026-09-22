import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { verifyAndDecodePhoto, describeDecodedFrame, deriveSdrWorkingPhoto } from '../src/index.mjs';
import { verifyHeifContentLightLevel } from '../src/heif.mjs';
import { code, request, sha256 } from './helpers.mjs';
import { gridFixture } from './heif-fixture-helpers.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));
const base = await fixture('colors-no-alpha.heic'), icc = await fixture('Apple-DisplayP3.icc');
assert.equal(icc.length, 536);
assert.equal(sha256(icc), '20789fdbea9835251a4f0796c8bf45cbd964896044886540da21ffc7457af0ab');
const color = Buffer.concat([Buffer.from('prof'), icc]);
const auxiliaryType = 'urn:com:apple:photo:2020:aux:hdrgainmap';
const clli = ['clli', Buffer.from('00cb0040', 'hex')];
const bytes = overrides => gridFixture(base, { color, auxiliaryType, primaryProperties: [clli], tileProperties: [clli], ...overrides });
const decode = (value, overrides = {}) => verifyAndDecodePhoto(request(value, { heicHdrPolicy: 'retain-hdr-use-sdr-base', ...overrides }));
const raw = png => sharp(png, { ignoreIcc: true }).raw().toBuffer();

test('explicit Apple SDR base with matching primary/tile CLLI preserves every pixel, profile, dimension and original byte', async () => {
  const original = bytes(), prior = sha256(original), withClli = await decode(original);
  const withoutClli = await decode(bytes({ primaryProperties: [], tileProperties: [] }));
  assert.deepEqual(await raw(withClli.png), await raw(withoutClli.png));
  assert.deepEqual(withClli.png, withoutClli.png);
  assert.deepEqual(withClli.raster.dimensions, { width: 125, height: 123 });
  assert.deepEqual((await sharp(withClli.png).metadata()).icc, icc);
  assert.equal(withClli.treatment.policyVersion, 'atlas-heif-apple-sdr-base-clli-v1');
  assert.equal(withoutClli.treatment.policyVersion, 'atlas-heif-apple-sdr-base-v1');
  assert.equal(withClli.treatment.hdrTreatment, 'sdr-base');
  assert.equal(withClli.original.metadata.dynamicRange, 'HDR');
  assert.equal(withClli.original.content.sha256, prior); assert.equal(sha256(original), prior);
  assert.equal(describeDecodedFrame(withClli, { id: 'clli', object: { key: 'frames/clli.png', versionId: 'v1' } }).treatment.policyVersion, withClli.treatment.policyVersion);
  const working = await deriveSdrWorkingPhoto(withClli);
  assert.deepEqual(working.raster.dimensions, withClli.raster.dimensions);
  assert.equal(working.workingImage.sourceTreatment.policyVersion, withClli.treatment.policyVersion);
});

test('CLLI never grants permission without explicit policy, Apple auxiliary, exact SDR profile or RGB8 primary', async () => {
  await assert.rejects(decode(bytes(), { heicHdrPolicy: null }), code('PHOTO_HEIC_UNSUPPORTED'));
  await assert.rejects(decode(bytes({ auxiliaryType: null })), code('PHOTO_HDR_UNSUPPORTED'));
  await assert.rejects(decode(bytes({ auxiliaryType: 'urn:unqualified:hdrgainmap' })), code('PHOTO_HEIC_UNSUPPORTED'));
  const compact = Buffer.concat([Buffer.from('prof'), await fixture('DisplayP3-v4.icc')]);
  await assert.rejects(decode(bytes({ color: compact })), code('PHOTO_HDR_UNSUPPORTED'));
  await assert.rejects(decode(gridFixture(await fixture('rgb10.heic'), { color, auxiliaryType, primaryProperties: [clli], tileProperties: [clli] })), code('PHOTO_HDR_UNSUPPORTED'));
});

test('CLLI mismatch, duplicate or malformed metadata refuses, including hidden tile disagreement', async () => {
  for (const change of [
    { tileProperties: [] }, { primaryProperties: [] },
    { tileProperties: [['clli', Buffer.from('00cc0040', 'hex')]] },
    { primaryProperties: [clli, clli] },
    { primaryProperties: [['clli', Buffer.from('00cb004000', 'hex')]] },
  ]) await assert.rejects(decode(bytes(change)));
  const properties = [{ type: 'clli', data: clli[1] }], observed = { maxContentLightLevel: 203, maxPicAverageLightLevel: 64 };
  assert.equal(verifyHeifContentLightLevel(properties, observed, true), true);
  assert.throws(() => verifyHeifContentLightLevel(properties, { ...observed, maxContentLightLevel: 204 }, true), code('PHOTO_SOURCE_MISMATCH'));
  assert.throws(() => verifyHeifContentLightLevel([], observed, true), code('PHOTO_SOURCE_MISMATCH'));
  assert.throws(() => verifyHeifContentLightLevel(properties, observed, false), code('PHOTO_HDR_UNSUPPORTED'));
});

test('CLLI does not admit PQ/HLG or mastering display metadata on either primary or tiles', async () => {
  for (const transfer of [16, 18]) {
    const nclx = Buffer.from('6e636c78000c000d000680', 'hex'); nclx.writeUInt16BE(transfer, 6);
    for (const target of ['primaryProperties', 'tileProperties']) await assert.rejects(decode(bytes({ [target]: [clli, ['colr', nclx]] })), code('PHOTO_HDR_UNSUPPORTED'));
  }
  for (const target of ['primaryProperties', 'tileProperties']) await assert.rejects(decode(bytes({ [target]: [clli, ['mdcv', Buffer.alloc(24)]] })), code('PHOTO_HDR_UNSUPPORTED'));
});
