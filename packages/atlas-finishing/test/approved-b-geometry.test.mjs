import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderApprovedBLabel, approvedBStyleInputLines, LABEL_APPROVED_B_RENDERER_PROFILE } from '../src/label-approved-b.mjs';
import { approvedBHash, APPROVED_B_ASSETS,
  validateApprovedBArtwork, renderApprovedBBack } from '../src/label-approved-b-artwork.mjs';
import { LABEL_STYLE_ARTWORK } from '../src/label-style-artwork.mjs';
import { LABEL_STYLE_FONT_CATALOG } from '../src/label-style-paint.mjs';
import { prepareLabelStyleRequest, compileLabelStyleSpec } from '../../atlas-connected-manual/src/label-style-contract.mjs';
import { LABEL_STYLE_TEXTURE_POLICY } from '../../atlas-connected-manual/src/label-style-textures.mjs';
import { LABEL_WORDMARK_RASTER_POLICY } from '../../atlas-connected-manual/src/label-wordmark-image.mjs';

const sports = { cardProfile: 'SPORTS', identity: { playerName: 'Michael Jordan', year: '1998–99', manufacturer: 'Upper Deck',
  productSet: 'Black Diamond', cardNumber: '8', parallel: null, insert: null }, finalGrade: 8,
  reportNumber: 'ATLAS-031200997F31', approvalVersion: 1 };
const pokemon = { cardProfile: 'POKEMON', identity: { cardName: 'Alakazam ex', year: '2024', manufacturer: 'Pokémon',
  productSet: 'Paldean Fates', cardNumber: '215/091', parallel: null, insert: null }, finalGrade: 10,
  reportNumber: '000002', approvalVersion: 1 };
const WIDTH = 68.342, HEIGHT = 20.082;
function part(svg, name) {
  const start = svg.indexOf(`<g data-part="${name}"`); assert(start >= 0, name);
  const tags = /<\/?g\b[^>]*>/g; tags.lastIndex = start; let depth = 0, token;
  while ((token = tags.exec(svg))) { depth += token[0].startsWith('</') ? -1 : 1; if (!depth) return svg.slice(start, tags.lastIndex); }
  throw Error('UNBALANCED_GROUP');
}
async function raster(svg) {
  return sharp(Buffer.from(svg), { density: 300 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function pixelsInMmRegion({ data, info }, [left, top, right, bottom]) {
  const rows = [];
  for (let y = Math.ceil(top / HEIGHT * info.height); y < Math.floor(bottom / HEIGHT * info.height); y++) {
    rows.push(data.subarray((y * info.width + Math.ceil(left / WIDTH * info.width)) * 4,
      (y * info.width + Math.floor(right / WIDTH * info.width)) * 4));
  }
  return Buffer.concat(rows);
}

test('approved B pins accepted existing font files, uniform physical geometry and exact stock colors', () => {
  const profile = LABEL_APPROVED_B_RENDERER_PROFILE;
  for (const [name, field] of [['Montserrat', 'headline'], ['RobotoCondensed', 'detail']])
    assert.equal(profile.fonts[field], approvedBHash(readFileSync(new URL(`../assets/v4/fonts/${name}-variable.ttf`, import.meta.url))));
  assert.equal(profile.fonts.headlineWeight, 900); assert.equal(profile.fonts.detailWeight, 700);
  assert.deepEqual(profile.colors, { gold: '#cfad58', holo: '#bacbd1' });
  assert.equal(profile.widthMm, WIDTH); assert.equal(profile.heightMm, HEIGHT);
  assert.equal(profile.photoStyle.wholeNumberGrades, true);
  assert.equal(profile.photoStyle.variantTargetCapMm, 2.5);
  assert.equal(profile.photoStyle.sourceTexturePolicy, LABEL_STYLE_TEXTURE_POLICY);
  assert.equal(profile.photoStyle.originalRasterPolicy, LABEL_WORDMARK_RASTER_POLICY);
  assert.equal(LABEL_STYLE_ARTWORK.grading.scale, 1.25); assert.equal(LABEL_STYLE_ARTWORK.grading.outwardWeightMm, .0125);
  assert.equal(LABEL_STYLE_ARTWORK.source, APPROVED_B_ASSETS.files['front-black.png'].sha256);
  for (const [name, descriptor] of Object.entries(LABEL_STYLE_ARTWORK.files)) {
    const bytes = readFileSync(new URL(`../assets/approved-b/${name}`, import.meta.url));
    assert.equal(approvedBHash(bytes), descriptor.sha256); assert.equal(bytes.length, descriptor.byteCount);
  }
  for (const input of [sports, pokemon]) {
    const result = renderApprovedBLabel(input); assert.equal(result.state, 'READY');
    assert.deepEqual(result.source, input); assert.notEqual(result.source, input);
    for (const svg of [result.printSvg, result.previewSvg, result.backPrintSvg, result.backPreviewSvg]) {
      assert.match(svg, /width="68\.342mm" height="20\.082mm" viewBox="0 0 68\.342 20\.082"/);
      assert.doesNotMatch(svg, /<text\b|font-family=|2\.73in|69\.342mm/);
      for (const [, x, y] of svg.matchAll(/scale\(([-.\d]+),([-.\d]+)\)/g))
        assert.equal(Math.abs(Number(x)), Math.abs(Number(y)), 'dynamic glyphs must preserve aspect ratio');
    }
  }
});

test('names, identity, variants and every grade stay in their regions and clear the padded NFC opening', async () => {
  const regions = { name: [17.4, 2.95, 46.6, 11.2], metadata: [17.4, 10.9, 46.6, 16.7],
    variant: [17.4, 10.9, 46.6, 16.7],
    grade: [58, 4.3, 67.9, 15.2], descriptor: [58, 16, 67.2, 17.9], certificate: [1.8, 17.5, 15.9, 19.15] };
  const cases = Array.from({ length: 10 }, (_, i) => ({ ...sports, finalGrade: 1 + i }));
  cases.push(pokemon, { ...sports, identity: { ...sports.identity, playerName: 'José Ramírez' } },
    { ...sports, identity: { playerName: 'TreVeyon Henderson', year: '2025', manufacturer: 'Panini',
      productSet: 'Rookies & Stars - Thrillers', cardNumber: '20', parallel: 'ICE' } },
    { ...sports, identity: { playerName: 'Mike Trout', year: '2025', manufacturer: 'Topps',
      productSet: 'Topps Chrome 1955 Anniversary', cardNumber: '1', parallel: 'Blue Mini Diamond Refractor',
      sportsAttributes: { version: 'atlas-sports-attributes-public-v1',
        serial: { presence: 'PRESENT', printed: '132/199', numerator: 132, denominator: 199 },
        autograph: { presence: 'UNKNOWN', type: 'UNKNOWN' }, relic: { presence: 'UNKNOWN', windows: [] } } } });
  for (const input of cases) {
    const result = renderApprovedBLabel(input); assert.equal(result.state, 'READY');
    const names = input.finalGrade === 8 || input === pokemon
      ? Object.keys(regions).filter(name => name !== 'variant' || result.diagnostics.metadata.lineRoles.includes('variant'))
      : ['grade', 'descriptor'];
    for (const name of names) {
      const component = part(result.printSvg, name);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}mm" height="${HEIGHT}mm" viewBox="0 0 ${WIDTH} ${HEIGHT}"><g fill="white">${component}</g></svg>`;
      const { data, info } = await raster(svg), [left, top, right, bottom] = regions[name];
      let opaque = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] < 128) continue;
        opaque++; const mmX = (x + .5) * WIDTH / info.width, mmY = (y + .5) * HEIGHT / info.height;
        assert(mmX >= left && mmX <= right && mmY >= top && mmY <= bottom,
          `${input.finalGrade} ${name} escaped dynamic region at ${mmX},${mmY}`);
        // The renderer checks the exact 5.85mm padded circle against vector
        // bounds. Allow 0.05mm here for the center of a 300dpi edge pixel.
        assert(Math.hypot(mmX - 51.8, mmY - 9.75) > 5.80, `${name} entered padded NFC opening`);
      }
      assert(opaque > 5, `${name} must have visible glyphs`);
    }
  }
});

test('ordinary contrast is shared across categories; only exact grade10 uses a foil field and dark primary ink', () => {
  for (const base of [sports, pokemon]) for (let grade = 1; grade <= 10; grade++) {
    const source = { ...base, finalGrade: grade }, result = renderApprovedBLabel(source);
    assert.equal(result.state, 'READY');
    assert.equal(result.diagnostics.style.contrast, grade === 10 ? 'exact10-exposed-foil' : 'shared-below10-black');
    assert.match(result.printSvg, grade === 10 ? /data-style-field="foil"/ : /data-style-field="black"/);
    assert.match(part(result.printSvg, 'metadata'), grade === 10 ? /fill="#090a0b"/ : /fill="#ffffff"/);
    assert.equal(result.printSvg, renderApprovedBLabel(source, { previewMaterial: 'holo' }).printSvg,
      'stock selection must not change the printing geometry or contrast policy');
    assert.deepEqual(result.source, source);
  }
  for (const grade of [0, .5, 1.5, 8.5, 9.5, 10.5, 11, NaN, Infinity, '10'])
    assert.throws(() => renderApprovedBLabel({ ...sports, finalGrade: grade }), /SOURCE_INVALID/);
});

test('photo accent colors stay inside actual variant glyphs with a dark grade10 outline', () => {
  const source = { ...sports, identity: { ...sports.identity, manufacturer: 'Topps', productSet: 'Chrome', parallel: 'Refractor' } };
  const request = prepareLabelStyleRequest({
    approval: { cardId: '8d63e0e2-41f8-4cd0-bad4-54e06e247ec4', actionId: '6d964eee-65a4-442a-b6c5-f92e1bbb460c',
      approvalVersion: 1, publicHash: 'a'.repeat(64), reportHash: 'b'.repeat(64) },
    identity: source.identity, cardProfile: source.cardProfile,
    photos: ['FRONT', 'BACK'].map((side, index) => ({ side, sha256: String(index + 1).repeat(64), contentType: 'image/png',
      width: 32, height: 48, byteCount: 200 })), lines: approvedBStyleInputLines(source.identity, { cardProfile: source.cardProfile }),
  }, { fontCatalog: Object.values(LABEL_STYLE_FONT_CATALOG), defaultFontId: 'knewave' });
  const observationSource = { side: 'FRONT', sha256: request.source.photos[0].sha256, box: { x: .1, y: .2, width: .4, height: .2 },
    basis: 'PRINTED_LETTERING', confidence: 'HIGH', observation: 'Synthetic red brush lettering.' };
  const styleSpec = compileLabelStyleSpec(request, { lines: request.source.lines.map(line => ({ role: line.role,
    letteringMode: 'CATALOG', letteringDescription: '', letteringTraits: [], fontId: line.role === 'variant' ? 'knewave' : 'roboto-condensed',
    fontSource: observationSource, emphasis: 'LARGE', normalizeWordInkHeight: false,
    spans: line.role === 'variant' ? [{ start: 0, end: 9, baseColor: '#ff4b2f', accentColor: '#ff9b7f', pattern: 'NONE', opticalScale: 1,
      source: observationSource }] : [] })) }, { requestSha256: 'c'.repeat(64), responseSha256: 'd'.repeat(64) });
  for (const grade of [8, 10]) {
    const result = renderApprovedBLabel({ ...source, finalGrade: grade }, { styleSpec });
    assert.equal(result.state, 'READY');
    const variant = part(result.printSvg, 'variant'), metadata = part(result.printSvg, 'metadata');
    assert.match(variant, /<path /); assert.match(variant, /fill="#ff4b2f"/);
    assert.doesNotMatch(variant, /<rect\b|<text\b/);
    assert.doesNotMatch(metadata, /#ff4b2f/);
    if (grade === 10) assert.match(variant, /stroke="#090a0b"[^>]*paint-order="stroke fill"/);
    else assert.doesNotMatch(variant, /paint-order="stroke fill"/);
    assert.equal(result.source.identity.parallel, 'Refractor');
  }
  const changed = structuredClone(styleSpec); changed.lines[1].text = 'UNAPPROVED';
  assert.throws(() => renderApprovedBLabel(source, { styleSpec: changed }), /LABEL_STYLE_SPEC_CHANGED/);
});

test('GRADE/REPORT retain their glyph geometry and approved contrast, and the back remains exact pinned artwork', async () => {
  const renders = [renderApprovedBLabel(sports), renderApprovedBLabel({ ...pokemon, finalGrade: 9 }, { previewMaterial: 'holo' }),
    renderApprovedBLabel({ ...sports, finalGrade: 10 }), renderApprovedBLabel(pokemon, { previewMaterial: 'holo' })];
  const glyphs = part(renders[0].printSvg, 'grade-report');
  const mask = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}mm" height="${HEIGHT}mm" viewBox="0 0 ${WIDTH} ${HEIGHT}"><g fill="white">${glyphs}</g></svg>`);
  for (const result of renders) {
    assert.equal(part(result.printSvg, 'grade-report'), glyphs, 'dynamic card fields must not alter the support glyphs');
    const rendered = await raster(result.previewSvg); let solid = 0;
    for (let pixel = 0; pixel < mask.info.width * mask.info.height; pixel++) {
      if (mask.data[pixel * 4 + 3] < 250) continue;
      solid++; const [r, g, b, alpha] = rendered.data.subarray(pixel * 4, pixel * 4 + 4);
      assert(alpha >= 250);
      if (result.source.finalGrade === 10) assert(r < 30 && g < 30 && b < 30, 'grade10 support must be dark against foil');
      else assert(r > 240 && g > 240 && b > 240, 'ordinary support must remain white on black');
    }
    assert(solid > 250, 'both support words must have solid visible pixels');
  }
  const bytes = readFileSync(new URL('../assets/approved-b/back-black.png', import.meta.url));
  assert.equal(approvedBHash(bytes), APPROVED_B_ASSETS.sources['masters/Atlas_Shared_Back.png'].sha256);
  assert.equal(renders[0].backPrintSvg, renders[1].backPrintSvg);
  assert.equal(renders[0].backPrintSvg, renderApprovedBBack());
});

test('oversized or unsupported dynamic fields require explicit layout attention without mutating the approved source', () => {
  for (const [field, text, expected] of [['playerName', 'W'.repeat(100), 'NAME_OVERFLOW'],
    ['playerName', '皮卡丘', 'UNSUPPORTED_GLYPH'], ['parallel', 'Exact confirmed variant '.repeat(20), 'METADATA_OVERFLOW']]) {
    const input = { ...sports, identity: { ...sports.identity, [field]: text } }, result = renderApprovedBLabel(input);
    assert.equal(result.state, 'NEEDS_LAYOUT'); assert.equal(result.diagnostics.code, expected);
    assert.deepEqual(result.source, input); assert.equal(result.printSvg, undefined);
  }
  const cert = renderApprovedBLabel({ ...sports, reportNumber: 'ATLAS-' + 'W'.repeat(80) });
  assert.equal(cert.state, 'NEEDS_LAYOUT'); assert.equal(cert.diagnostics.code, 'CERTIFICATE_OVERFLOW');
});

test('print validation accepts only pinned images and rejects previews, injected resources and wrong back bytes', () => {
  const result = renderApprovedBLabel(sports); assert.equal(validateApprovedBArtwork(result), result.printSvg);
  const invalid = [result.previewSvg,
    result.printSvg.replace('</svg>', '<image href="https://example.com/label.png"/></svg>'),
    result.printSvg.replace('</svg>', '<script>1</script></svg>'),
    result.printSvg.replace('<path ', '<path onload="1" '),
    result.printSvg.replace('data:image/png;base64,', 'data:image/jpeg;base64,'),
    result.printSvg.replace('</svg>', '<path fill="url(https://example.com/x)"/></svg>'),
    renderApprovedBBack().replace('<title>ATLAS shared back', '<title>changed back')];
  for (const printSvg of invalid) assert.throws(() => validateApprovedBArtwork({ printSvg, artworkHash: approvedBHash(printSvg) }), /ARTWORK_INVALID/);
});
