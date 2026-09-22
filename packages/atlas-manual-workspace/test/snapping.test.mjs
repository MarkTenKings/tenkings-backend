import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildSpeedsterGradientMap, snapSpeedsterPoint } from '../dist/gradient-snap.js';

test('snapping extraction retains every implementation byte of the reviewed engine', () => {
  const manifest = JSON.parse(readFileSync(new URL('../snapping-extraction.json', import.meta.url)));
  const original = readFileSync(new URL(`../../../${manifest.source}`, import.meta.url), 'utf8');
  const extracted = readFileSync(new URL('../src/gradient-snap.ts', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(original).digest('hex'), manifest.sourceSha256);
  assert.equal(extracted, original.replace('"./contracts"', '"@atlas/grading-core/contracts"'));
});

test('the existing snapping engine finds a measured rectangular boundary without moving flat-field points', () => {
  const width = 300, height = 400, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, level = x >= 40 && x <= 260 && y >= 50 && y <= 350 ? 240 : 20;
    data.set([level, level, level, 255], i);
  }
  const map = buildSpeedsterGradientMap({ data, width, height });
  const snapped = snapSpeedsterPoint(map, { x: 45/(width-1), y: 55/(height-1) }, { inwardX: 1, inwardY: 1, sampleStart: 8, sampleLength: 125 });
  assert.ok(Math.abs(snapped.x*(width-1)-40) <= 1);
  assert.ok(Math.abs(snapped.y*(height-1)-50) <= 1);
  const point = { x: .5, y: .5 };
  assert.deepEqual(snapSpeedsterPoint(map, point, { inwardX: 1, inwardY: 1 }), point);
});
