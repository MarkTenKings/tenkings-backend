import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { renderLabelV4, LABEL_V4_RENDERER_PROFILE, LABEL_V4_RENDERER_PROFILE_HASH } from '../src/label-v4.mjs';
import { validateLabelV4Artwork, renderLabelBlackInkSvg, renderLabelSheetSvg } from '../src/label-sheet.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const packet = identity => ({ identity, cardProfile: 'POKEMON', finalGrade: 8.5, reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1 });
const identities = [
  { cardName: 'Sylveon ex', year: '2024', manufacturer: 'The Pokémon Company International', productSet: 'Scarlet & Violet—Surging Sparks', cardNumber: '086/191', parallel: 'English Holofoil' },
  { cardName: 'Articuno', year: '2022', manufacturer: 'The Pokémon Company International', productSet: 'Sword & Shield—Silver Tempest', cardNumber: '036/195', parallel: 'English Cosmos Holofoil' },
];
const overflowIdentities = [
  { ...identities[0], parallel: 'English Special Illustration Rare Holofoil · Red' },
  { ...identities[0], manufacturer: 'Unknown Independent Trading Card Company' },
];
function part(svg, name) {
  const start = svg.indexOf(`<g data-part="${name}"`); assert.ok(start >= 0);
  const tags = /<\/?g\b[^>]*>/g; tags.lastIndex = start; let depth = 0, token;
  while ((token = tags.exec(svg))) { depth += token[0].startsWith('</') ? -1 : 1; if (!depth) return svg.slice(start, tags.lastIndex); }
  throw new Error('UNBALANCED_GROUP');
}

test('ordinary Pokémon captions use the short maker and omit product set while preserving the full approved source', () => {
  for (const identity of identities) {
    const source = packet(identity), result = renderLabelV4(source, { previewMaterial: 'holo' });
    assert.equal(result.state, 'READY'); assert.deepEqual(result.source, source);
    assert.notEqual(result.source.identity, source.identity);
    assert.equal(result.diagnostics.metadata.text, `#${identity.cardNumber} ${identity.parallel.toUpperCase()} · ${identity.year} POKÉMON`);
    assert.equal(result.diagnostics.textLayout, undefined);
    assert.ok(result.diagnostics.metadata.inkHeightMm >= 1 && result.diagnostics.metadata.inkHeightMm <= 1.5);
    assert.equal(result.source.identity.manufacturer, identity.manufacturer);
    assert.equal(result.source.identity.productSet, identity.productSet);
    assert.equal(result.source.finalGrade, 8.5);
    assert.equal(renderLabelV4(source, { previewMaterial: 'gold' }).printSvg, result.printSvg);
  }
});

test('long approved variants and unknown manufacturers retain bounded readable wrapping with no clipping or text omission', () => {
  for (const identity of overflowIdentities) {
    const source = packet(identity), result = renderLabelV4(source, { previewMaterial: 'holo' });
    assert.equal(result.state, 'READY'); assert.deepEqual(result.source, source);
    const layout = result.diagnostics.textLayout;
    assert.equal(layout.version, 'compact-caption-three-line-v2'); assert.ok(layout.metadata.length >= 2 && layout.metadata.length <= 3);
    assert.equal(layout.wrapping, 'TOKEN_WRAP');
    assert.equal(layout.name.map(line => line.text).join(' '), identity.cardName.toUpperCase());
    assert.equal(layout.metadata.map(line => line.text).join(' '), result.diagnostics.metadata.text);
    assert.ok(layout.metadata.every(line => !/^[·&]|[·&]$/u.test(line.text)), 'no separator is stranded to gain a tiny type-size difference');
    assert.ok(result.diagnostics.metadata.text.includes(identity.parallel.toUpperCase()));
    if (identity.manufacturer.startsWith('Unknown')) assert.ok(result.diagnostics.metadata.text.includes(identity.manufacturer.toUpperCase()));
    assert.ok(!result.diagnostics.metadata.text.includes(identity.productSet.toUpperCase()));
    assert.equal(result.source.finalGrade, 8.5);
    for (const line of layout.name) assert.ok(line.heightMm >= 2.8 && line.heightMm <= 3.6);
    for (const line of layout.metadata) assert.ok(line.heightMm >= 1 && line.heightMm <= 1.5);
    assert.equal(new Set(layout.metadata.map(line => line.heightMm)).size, 1);
    const boxes = [...layout.name, ...layout.metadata];
    for (const [index, box] of boxes.entries()) {
      assert.equal(box.xMm, 15.8); assert.ok(box.widthMm <= 28.500001);
      assert.ok(box.yMm >= 4.55 && box.yMm + box.heightMm <= 14.300001);
      if (index) assert.ok(box.yMm - boxes[index - 1].yMm - boxes[index - 1].heightMm >= 0.199999, 'visible line boxes cannot overlap');
    }
    const short = renderLabelV4(packet({ ...identity, manufacturer: null, productSet: null, parallel: null }));
    const stripText = svg => svg.replace(part(svg, 'name'), 'NAME').replace(part(svg, 'metadata'), 'METADATA');
    assert.equal(stripText(result.printSvg), stripText(short.printSvg), 'only name and metadata paths may change; original cuts, static foil/waveform, grade and certificate remain exact');
    assert.equal(renderLabelV4(source, { previewMaterial: 'gold' }).printSvg, result.printSvg);
  }
});

test('overflow name and metadata retain every opaque glyph pixel through physical cuts and the full ink mask', async () => {
  for (const identity of overflowIdentities) {
    const result = renderLabelV4(packet(identity));
    const defs = result.printSvg.match(/<defs>([^]*?)<\/defs>/)[1];
    for (const name of ['name', 'metadata']) {
      const svg = clipped => `<svg xmlns="http://www.w3.org/2000/svg" width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082"><defs>${defs}</defs><g fill="white" ${clipped ? `clip-path="url(#body)" ${name === 'metadata' ? 'mask="url(#ink)"' : ''}` : ''}>${part(result.printSvg, name)}</g></svg>`;
      const [original, clipped] = await Promise.all([false, true].map(value => sharp(Buffer.from(svg(value)), { density: 600 }).ensureAlpha().raw().toBuffer()));
      let maximumLoss = 0;
      for (let i = 3; i < original.length; i += 4) maximumLoss = Math.max(maximumLoss, original[i] - clipped[i]);
      assert.ok(maximumLoss <= 16, `${identity.cardName} ${name} lost ${maximumLoss}/255 alpha through cuts, foil or other text`);
    }
  }
});

test('compact captions update formerly short labels, ignore set length, and preserve null-identity artwork bytes', () => {
  const previous = [
    { source: { ...packet({ playerName: 'Kobe Bryant', year: '1996–97', manufacturer: 'Topps', productSet: 'Basketball', cardNumber: '138' }), cardProfile: 'SPORTS' },
      print: '8d0004c3de99fa168b9f53359e8173b87be87dd1fc8f16bae4d4b7304bd955d7', gold: '008269a7333fdf65e9430eb212598e63a3c6cf96dbfccee1dae3ce797525ae61', holo: '108bf0f4cbed960f2cf0f18fcd3d2128c78e29c7145b51e7450e40ddab12e4e3' },
    { source: { ...packet({ cardName: 'Alakazam', year: '1999', manufacturer: 'Pokémon', productSet: 'Base Set', cardNumber: '1/102', parallel: 'Holo' }), finalGrade: 9.5 },
      print: '55a22a160a32b0cf64e58b4de4c430b1b04dd45b42e0d1efdb02db1920e05cfd', gold: '3cdbb2cb37c5e384ce9312cec493e2301f1d4fcdb7bb49e74d1430020daeda8b', holo: '47888e0cc2671e5fa4ecd552d032efbd3044137ff578107f26805d0493751316' },
    { source: { ...packet({ cardName: null, year: null, manufacturer: null, productSet: null, cardNumber: null, parallel: null }), finalGrade: 9.5 },
      print: '739d55ac3cc038a168d5acd93a1c0d493379399c0e92faef9934df348f78a9c7', gold: 'e9caa9ffc9efa3cb421ff6536d1ecd3eab57265573d0732904d1a16fd83f7d17', holo: '277405d348a3cedbd6d76c0885a1cb28ad6dd010507407bc8d4c4c99b5cd2e1d' },
  ];
  for (const fixture of previous) for (const previewMaterial of ['gold', 'holo']) {
    const rendered = renderLabelV4(fixture.source, { previewMaterial });
    const compare = fixture.source.identity.productSet ? assert.notEqual : assert.equal;
    compare(sha(rendered.printSvg), fixture.print); compare(sha(rendered.previewSvg), fixture[previewMaterial]);
    assert.equal(rendered.diagnostics.textLayout, undefined);
    const longSet = renderLabelV4({ ...fixture.source, identity: { ...fixture.source.identity, productSet: 'Retained complete product name '.repeat(16) } }, { previewMaterial });
    assert.equal(longSet.printSvg, rendered.printSvg); assert.equal(longSet.previewSvg, rendered.previewSvg);
  }
});

test('overflow stays explicit when a caption field cannot fit and null identity never acquires a name', () => {
  for (const field of ['parallel', 'manufacturer']) for (const value of ['W'.repeat(150), 'Full confirmed display detail '.repeat(16)]) {
    const source = packet({ ...identities[0], [field]: value }), result = renderLabelV4(source);
    assert.equal(result.state, 'NEEDS_LAYOUT'); assert.equal(result.diagnostics.code, 'METADATA_OVERFLOW');
    assert.deepEqual(result.source, source); assert.equal(result.printSvg, undefined);
  }
  const source = packet({ ...identities[0], cardName: null }), result = renderLabelV4(source);
  assert.equal(result.state, 'READY'); assert.deepEqual(result.source, source);
  assert.equal(part(result.printSvg, 'name'), '<g data-part="name"></g>');
  assert.equal(result.diagnostics.metadata.text, '#086/191 ENGLISH HOLOFOIL · 2024 POKÉMON');
  assert.equal(LABEL_V4_RENDERER_PROFILE.metadataOverflowRules.maximumLines, 3);
});

test('semantic wrapping preserves punctuation inside an approved variant and keeps the year with its maker', () => {
  const identity = { ...identities[0], parallel: 'English Holofoil · Red', manufacturer: 'Specialist Card Maker' }, result = renderLabelV4(packet(identity));
  assert.equal(result.state, 'READY'); assert.equal(result.diagnostics.textLayout.wrapping, 'SEMANTIC_FIELDS');
  assert.deepEqual(result.diagnostics.metadata.lines, ['#086/191 ENGLISH HOLOFOIL · RED', '2024 SPECIALIST CARD MAKER']);
  assert.equal(result.source.identity.parallel, 'English Holofoil · Red');
});

test('overflow measurement uses the same Unicode normalization as its outlined glyphs without changing source', () => {
  for (const original of [identities[0], { ...overflowIdentities[1], manufacturer: 'Pokémon Independent Trading Card Company' }]) {
    const identity = { ...original, manufacturer: original.manufacturer.normalize('NFD') };
    const result = renderLabelV4(packet(identity)), composed = renderLabelV4(packet(original));
    assert.equal(result.state, 'READY'); assert.deepEqual(result.source.identity, identity);
    assert.equal(result.printSvg, composed.printSvg); assert.equal(result.previewSvg, composed.previewSvg);
    assert.equal(result.diagnostics.metadata.inkHeightMm, composed.diagnostics.metadata.inkHeightMm);
  }
});

test('the bounded 128-token search retains oversized source and refuses text that cannot fit', () => {
  assert.equal(LABEL_V4_RENDERER_PROFILE.metadataOverflowRules.maximumTokens, 128);
  for (const [count, word] of [[128, 'I'], [128, 'WWW'], [129, 'I']]) {
    const source = packet({ cardName: 'Mew', parallel: Array(count).fill(word).join(' ') });
    const result = renderLabelV4(source);
    assert.equal(result.state, 'NEEDS_LAYOUT'); assert.equal(result.diagnostics.code, 'METADATA_OVERFLOW');
    assert.deepEqual(result.source, source); assert.equal(result.printSvg, undefined);
  }
});

test('retained pre-compact PRINT bytes remain valid for original and black-ink exports without rerendering their source', () => {
  // Captured from renderer profile 4b2e6e37 before the compact-caption change.
  const printSvg = gunzipSync(readFileSync(new URL('./label-v4-previous-caption.svg.gz', import.meta.url))).toString('utf8');
  const artworkHash = '5a862f7cd2dd6c3e5e0d43ad4b3b7a00184bea931fe4164fbb06e396505e1428';
  const saved = { printSvg, artworkHash, rendererProfileHash: '4b2e6e37a9207cbb6224bd599065b9c95183a60bf8ee699836ef9c25a4dd7ed5' };
  assert.equal(sha(printSvg), artworkHash); assert.equal(validateLabelV4Artwork(saved), printSvg);
  assert.notEqual(LABEL_V4_RENDERER_PROFILE_HASH, saved.rendererProfileHash);
  assert.equal(LABEL_V4_RENDERER_PROFILE.version, 'atlas-v4-outlined-label-compact-caption-v2');
  assert.equal(LABEL_V4_RENDERER_PROFILE.metadataCaptionRules.includeProductSet, false);
  const current = renderLabelV4(packet(identities[0]));
  const withoutDynamicText = svg => svg.replace(part(svg, 'name'), 'NAME').replace(part(svg, 'metadata'), 'METADATA');
  assert.equal(withoutDynamicText(current.printSvg), withoutDynamicText(printSvg), 'prior artwork differs only in the compact caption and its associated text layout');
  assert.match(renderLabelBlackInkSvg(saved), /data-print-mode="BLACK_INK_TRANSPARENT"/);
  for (const blackInkTransparent of [false, true]) assert.match(renderLabelSheetSvg([{ ...saved, slot: 1 }], { blackInkTransparent }), /data-slot="1"/);
  assert.equal(saved.printSvg, printSvg); assert.equal(saved.artworkHash, artworkHash);
});
