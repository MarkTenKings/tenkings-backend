import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { verifyAndDecodePhoto } from '../src/index.mjs';
import { code, request, sha256 } from './helpers.mjs';

for (const [name, checksum] of [
  ['colors-no-alpha.heic', '76f82ffc717a647b1c9c2551e5ea0545832a2d3216c7540f7e5b092282a04b63'],
  ['colors-no-alpha-thumbnail.heic', 'b610c6224a5cbd1f57122ee0adae4ba38b952a22fe72e9cfaf5dfad93513dc2f'],
]) test(`real HEIC ${name} receives an explicit unsupported outcome and retains exact bytes`, async () => {
  const bytes = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  assert.equal(sha256(bytes), checksum);
  await assert.rejects(verifyAndDecodePhoto(request(bytes)), code('PHOTO_HEIC_UNSUPPORTED'));
  assert.equal(sha256(bytes), checksum);
});

test('an unrelated BMFF codec is not mislabeled as HEIC', async () => {
  const ftyp = Buffer.from('00000018667479706176696600000000617669666d696631', 'hex');
  await assert.rejects(verifyAndDecodePhoto(request(ftyp)), code('PHOTO_FORMAT_UNSUPPORTED'));
});
