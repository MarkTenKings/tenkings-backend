import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInflate } from 'node:zlib';
import { Readable } from 'node:stream';
import { LABEL_JIG_25 as jig } from '../src/label-sheet-25.mjs';
import { LABEL_25_EXPORT_PROFILES } from '../src/label-sheet.mjs';
import { renderApprovedBBack, approvedBHash } from '../src/label-approved-b-artwork.mjs';
const directory = new URL('../../../frontend/atlas-app/assets/label-templates/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('atlas-25-backs-manifest.json', directory)));
async function* rows(bytes) {
  const chunks = [], stride = 9764 * 4 + 1;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  let pending = Buffer.alloc(0);
  for await (const bytes of Readable.from(chunks).pipe(createInflate())) {
    pending = Buffer.concat([pending, bytes]); let offset = 0;
    while (pending.length - offset >= stride) { assert.equal(pending[offset], 0); yield pending.subarray(offset + 1, offset + stride); offset += stride; }
    pending = Buffer.from(pending.subarray(offset));
  }
  assert.equal(pending.length, 0);
}
test('all three reusable backs retain the exact canvas, 25 artwork bounds, binary alpha and pinned artwork/profile', async () => {
  assert.equal(manifest.jigHash, jig.jigHash); assert.equal(manifest.artworkHash, approvedBHash(renderApprovedBBack()));
  assert.deepEqual(manifest.outputs.map(o => o.filename), ['atlas-25-back-black.png', 'atlas-25-back-gold.png', 'atlas-25-back-silver.png']);
  const frames = jig.slots.map(f => ({ left: Math.floor(f.xMm / 310 * 9764) - 1, right: Math.ceil((f.xMm + f.widthMm) / 310 * 9764) + 1,
    top: Math.floor(f.yMm / 400 * 12598) - 1, bottom: Math.ceil((f.yMm + f.heightMm) / 400 * 12598) + 1, ink: 0 }));
  for (const output of manifest.outputs) {
    const bytes = readFileSync(new URL(output.filename, directory));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), output.sha256); assert.equal(bytes.length, output.byteCount);
    assert.equal(output.renderProfileHash, LABEL_25_EXPORT_PROFILES.find(p => p.id === output.exportProfileId).hash);
    assert.equal(bytes.readUInt32BE(16), 9764); assert.equal(bytes.readUInt32BE(20), 12598);
    const phys = bytes.indexOf(Buffer.from('pHYs'));
    assert.equal(bytes.readUInt32BE(phys + 4), Math.round(9764 / .310)); assert.equal(bytes.readUInt32BE(phys + 8), Math.round(12598 / .400));
    const black = output.filename.includes('black'); frames.forEach(f => { f.ink = 0; }); let y = 0;
    for await (const row of rows(bytes)) {
      const active = frames.filter(f => y >= f.top && y < f.bottom).sort((a, b) => a.left - b.left); let index = 0;
      for (let x = 0; x < 9764; x++) {
        const offset = x * 4, alpha = row[offset + 3];
        if (alpha !== 0 && alpha !== 255) assert.fail('Nonbinary alpha');
        if (!alpha) { if (row[offset] || row[offset + 1] || row[offset + 2]) assert.fail('Nonzero transparent RGB'); continue; }
        while (active[index] && x >= active[index].right) index++;
        const frame = active[index];
        if (!frame || x < frame.left) assert.fail(`Ink outside artwork bounds at ${x},${y}`);
        if (black && (row[offset] || row[offset + 1] || row[offset + 2])) assert.fail('Nonblack ink in blank/foil output');
        frame.ink++;
      }
      y++;
    }
    assert.equal(y, 12598); assert(frames.every(frame => frame.ink > 1000));
  }
});
