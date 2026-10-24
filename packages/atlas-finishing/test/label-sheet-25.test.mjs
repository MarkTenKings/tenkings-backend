import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LABEL_JIG_25 as jig, LABEL_25_PROFILE_DEFINITIONS as profiles, label25SlotTransform, label25PhysicalSlot } from '../src/label-sheet-25.mjs';
import { renderLabelSheetSvg, renderLabelSheetPng } from '../src/label-sheet.mjs';
import { renderApprovedBLabel } from '../src/label-approved-b.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const profile = (page, mode = 'black-ink-transparent', side = 'FRONT') => profiles.find(p => p.page === page && p.mode === mode && p.side === side).id;
const label = index => renderApprovedBLabel({ identity: { playerName: index % 2 ? 'Michael Jordan' : 'Alakazam', year: index % 2 ? '1998–99' : '2000', productSet: index % 2 ? 'Black Diamond' : 'Team Rocket', cardNumber: String(index) }, finalGrade: 8, reportNumber: `ATLAS-TEST-${index}`, approvalVersion: 1, cardProfile: index % 2 ? 'SPORTS' : 'POKEMON' });

test('25 equal cutouts exactly match every independently transformed SVG position, including uneven spacing', () => {
  const bytes = readFileSync(new URL('../assets/jigs/atlas-label-jig-25-source.svg', import.meta.url)), svg = bytes.toString();
  assert.equal(hash(bytes), jig.sourceSvgHash);
  assert.equal(hash(readFileSync(new URL('../assets/jigs/atlas-label-jig-25-source.xs', import.meta.url))), jig.sourceXsHash);
  const { jigHash, ...geometry } = jig; assert.equal(hash(stable(geometry)), jigHash);
  const bounds = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert(Math.abs(bounds[2] - 310) < 1e-9 && Math.abs(bounds[3] - 400) < 1e-9);
  const paths = [...svg.matchAll(/<path\b[^>]+>/g)].filter(([path]) => path.includes('stroke="#fe0002"'));
  const cutouts = paths.map(([path]) => {
    const m = path.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
    const values = path.match(/ d="([^"]+)"/)[1].match(/[-+]?\d*\.?\d+/g).map(Number);
    const points = [];
    for (let i = 0; i < values.length; i += 2) points.push([m[0] * values[i] + m[2] * values[i + 1] + m[4] - bounds[0], m[1] * values[i] + m[3] * values[i + 1] + m[5] - bounds[1]]);
    const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
    return [x, y, Math.max(...points.map(p => p[0])) - x, Math.max(...points.map(p => p[1])) - y].map(n => Number(n.toFixed(6)));
  }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.equal(cutouts.length, 25); assert.equal(jig.slots.filter(s => s.rotationDeg === 90).length, 18);
  for (const [index, frame] of jig.slots.entries()) {
    const c = frame.cutout;
    assert.deepEqual([c.xMm, c.yMm, c.widthMm, c.heightMm], cutouts[index]);
    assert.deepEqual([c.widthMm, c.heightMm].sort((a, b) => a - b), [21.582, 69.842]);
    assert(Math.abs(frame.xMm - c.xMm - .75) < 1e-9 && Math.abs(frame.yMm - c.yMm - .75) < 1e-9);
    assert.deepEqual([frame.widthMm, frame.heightMm].sort((a, b) => a - b), [20.082, 68.342]);
    assert(frame.xMm >= 0 && frame.yMm >= 0 && frame.xMm + frame.widthMm <= 310 && frame.yMm + frame.heightMm <= 400);
    for (const other of jig.slots.slice(index + 1)) assert(frame.xMm + frame.widthMm < other.xMm || other.xMm + other.widthMm < frame.xMm || frame.yMm + frame.heightMm < other.yMm || other.yMm + other.heightMm < frame.yMm);
  }
});

test('page membership is strict and SVG transforms preserve original label size in both orientations', () => {
  const item = label(1), id = profile(2);
  const svg = renderLabelSheetSvg([{ ...item, slot: 26 }, { ...item, slot: 32 }], { exportProfileId: id });
  assert(svg.includes(`<g data-slot="1" transform="${label25SlotTransform(1)}">`));
  assert(svg.includes(`<g data-slot="7" transform="${label25SlotTransform(7)}">`));
  assert.deepEqual([...svg.matchAll(/<g data-slot="\d+" transform="([^"]+)"/g)].map(match => match[1]), [label25SlotTransform(1), label25SlotTransform(7)]);
  assert.equal(label25PhysicalSlot(50, id), 25);
  for (const slot of [0, 1, 25, 51, 26.5]) assert.throws(() => renderLabelSheetSvg([{ ...item, slot }], { exportProfileId: id }), /LABEL_SLOT_INVALID/);
  assert.throws(() => renderLabelSheetSvg([], { exportProfileId: id }), /ITEMS_INVALID/);
  assert.throws(() => renderLabelSheetSvg([{ ...item, slot: 26 }], { exportProfileId: `${id}-unknown` }), /PROFILE_INVALID/);
});

test('actual 25-front PNG and partial page 2 agree at every occupied pixel, within bounded raster resources', { timeout: 180_000 }, async () => {
  const items = jig.slots.map(({ slot }) => ({ ...label(slot), slot }));
  assert(items.every(item => item.state === 'READY'));
  const full = await renderLabelSheetPng(items, { exportProfileId: profile(1) });
  const occupied = [1, 7, 16, 25], selected = occupied.map(slot => ({ ...items[slot - 1], slot: slot + 25 }));
  const partial = await renderLabelSheetPng(selected, { exportProfileId: profile(2) });
  for (const result of [full, partial]) {
    assert.equal(result.bytes.readUInt32BE(16), 9764); assert.equal(result.bytes.readUInt32BE(20), 12598);
    const at = result.bytes.indexOf(Buffer.from('pHYs'));
    assert.equal(result.bytes.readUInt32BE(at + 4), Math.round(9764 / .310)); assert.equal(result.bytes.readUInt32BE(at + 8), Math.round(12598 / .400));
    assert.equal(result.manifest.jigHash, jig.jigHash);
    const receipt = result.manifest.rasterReceipt;
    assert(receipt.elapsedMs < 180_000 && receipt.peakRssBytes < 1024 ** 3);
    assert(receipt.maxRasterFrameBytes <= 640 * 2160 * 4 && receipt.maxCachedFrameBytes <= 10 * 640 * 2160 * 4);
    assert.equal(receipt.blackInkOnly, true); assert.equal(receipt.alphaBinary, true);
  }
  assert.equal(full.manifest.rasterReceipt.rasterizedFrames, 25);
  assert.deepEqual(partial.manifest.slotMapping, occupied.map(position => ({ sourceSlot: position + 25, position })));
  assert.deepEqual(partial.manifest.orderedArtwork.map(row => row.slot), [26, 32, 41, 50]);
  for (const frame of jig.slots) {
    const left = Math.floor(frame.xMm / 310 * 9764), top = Math.floor(frame.yMm / 400 * 12598);
    const rect = { left, top, width: Math.ceil((frame.xMm + frame.widthMm) / 310 * 9764) - left, height: Math.ceil((frame.yMm + frame.heightMm) / 400 * 12598) - top };
    const actual = await sharp(partial.bytes).extract(rect).raw().toBuffer();
    if (occupied.includes(frame.slot)) assert.deepEqual(actual, await sharp(full.bytes).extract(rect).raw().toBuffer());
    else assert(actual.every(value => value === 0), `Unused physical position ${frame.slot} must stay transparent`);
  }
});
