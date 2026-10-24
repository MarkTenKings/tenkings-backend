import test from 'node:test';
import assert from 'node:assert/strict';
import { labelStyleContrast, labelStyleColorForBlack, labelStyleContrastAgainstBlack } from '../src/label-style-contrast.mjs';

const span = (baseColor, accentColor = baseColor, pattern = 'NONE') => ({ baseColor, accentColor, pattern });
const rgb = color => [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16));

test('clear photo-derived red and ice colors remain exactly unchanged', () => {
  for (const color of ['#ff4b2f', '#ff5a50', '#92e2ff', '#92E2FF', '#ffffff']) {
    assert.ok(labelStyleContrastAgainstBlack(color) >= 4.5);
    assert.equal(labelStyleColorForBlack(color), color);
  }
});

test('dark blue rises by proportional RGB scaling before any white blending', () => {
  const input = '#123b52', output = labelStyleColorForBlack(input), a = rgb(input), b = rgb(output);
  assert.notEqual(output, input); assert.ok(labelStyleContrastAgainstBlack(output) >= 4.5);
  const factor = b[2] / a[2];
  assert.ok(b[2] < 255, 'this hue reaches target before saturating its largest channel');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(b[i] - a[i] * factor) <= 1);
  assert.equal(labelStyleColorForBlack(output), output);
});

test('saturated blue uses minimal white blending and black has a defined neutral fallback', () => {
  const blue = labelStyleColorForBlack('#00007f'), channels = rgb(blue);
  assert.equal(channels[2], 255); assert.equal(channels[0], channels[1]);
  assert.ok(labelStyleContrastAgainstBlack(blue) >= 4.5);
  const less = `#${(channels[0] - 1).toString(16).padStart(2, '0').repeat(2)}ff`;
  assert.ok(labelStyleContrastAgainstBlack(less) < 4.5);
  const black = labelStyleColorForBlack('#000000');
  assert.equal(new Set(rgb(black)).size, 1); assert.ok(labelStyleContrastAgainstBlack(black) >= 4.5);
});

test('both finishes share identical adjusted flat palettes; only grade10 adds its dark edge', () => {
  const recipe = { spans: [span('#123b52', '#70150e'), span('#ff4b2f', '#92e2ff')] }, before = JSON.stringify(recipe);
  const ordinary = labelStyleContrast({ recipe }), inverted = labelStyleContrast({ recipe, inverted: true });
  assert.deepEqual(ordinary.spanColors, inverted.spanColors);
  assert.equal(ordinary.spanColors.length, recipe.spans.length);
  assert.equal(ordinary.outlineMm, 0); assert.equal(inverted.outlineMm, .045); assert.equal(inverted.outlineColor, '#090a0b');
  assert.equal(JSON.stringify(recipe), before);
  for (const colors of ordinary.spanColors) for (const color of Object.values(colors)) assert.ok(labelStyleContrastAgainstBlack(color) >= 4.5);
});

test('photographic/procedural patterns retain their exact colors and source payload while receiving fine edges', () => {
  const recipe = { spans: ['DIAMOND', 'SHIMMER', 'STRIPES'].map(pattern => ({ ...span('#123b52', '#70150e', pattern), source: { sha256: 'a'.repeat(64) } })) };
  const original = structuredClone(recipe), ordinary = labelStyleContrast({ recipe }), inverted = labelStyleContrast({ recipe, inverted: true });
  assert.deepEqual(ordinary.spanColors, recipe.spans.map(({ baseColor, accentColor }) => ({ baseColor, accentColor })));
  assert.deepEqual(ordinary.spanColors, inverted.spanColors); assert.deepEqual(recipe, original);
  assert.equal(ordinary.outlineColor, '#ffffff'); assert.equal(ordinary.outlineMm, .025); assert.equal(inverted.outlineMm, .045);
  assert.equal(Object.hasOwn(ordinary, 'spanTextures'), false, 'the policy does not rewrite a texture payload');
  assert.deepEqual(labelStyleContrast({ recipe: { spans: [] }, inverted: true }), { spanColors: [], outlineColor: '#090a0b', outlineMm: 0 });
});

test('malformed colors, patterns and oversized span inputs are rejected', () => {
  for (const color of ['#fff', 'url(#paint)', '#12xx52', null]) assert.throws(() => labelStyleColorForBlack(color), /LABEL_STYLE_CONTRAST_INVALID/);
  for (const recipe of [{ spans: [span('#123456', '#ffffff', 'IMAGE')] }, { spans: Array.from({ length: 33 }, () => span('#ffffff')) }, {}]) {
    assert.throws(() => labelStyleContrast({ recipe }), /LABEL_STYLE_CONTRAST_INVALID/);
  }
});
