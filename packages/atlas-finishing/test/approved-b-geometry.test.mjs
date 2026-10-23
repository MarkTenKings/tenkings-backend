import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderApprovedBLabel, LABEL_APPROVED_B_RENDERER_PROFILE } from '../src/label-approved-b.mjs';
import { approvedBHash, APPROVED_B_ASSETS, buildApprovedBFront, colorApprovedBArtwork,
  validateApprovedBArtwork, renderApprovedBBack } from '../src/label-approved-b-artwork.mjs';

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
    grade: [58, 4.3, 67.9, 15.2], descriptor: [58, 16, 67.2, 17.9], certificate: [17.4, 16.75, 47.3, 19.4] };
  const cases = Array.from({ length: 19 }, (_, i) => ({ ...sports, finalGrade: 1 + i / 2 }));
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

test('variant paths are stock cutouts while identity paths retain the white support layer', () => {
  const result = renderApprovedBLabel({ ...sports, identity: { ...sports.identity, manufacturer: 'Topps', productSet: 'Chrome', parallel: 'Refractor' } });
  assert.equal(result.state, 'READY');
  const variant = part(result.printSvg, 'variant'), metadata = part(result.printSvg, 'metadata');
  const defsEnd = result.printSvg.indexOf('</defs>'), supportStart = result.printSvg.indexOf('<g id="approved-support"');
  assert(result.printSvg.indexOf(variant) < defsEnd, 'variant must cut through the black plate to the stock');
  assert(result.printSvg.indexOf(metadata) > supportStart, 'identity must remain in the white support layer');
  assert.match(variant, /<path /); assert.match(metadata, /<path /);
  assert.equal(result.source.identity.parallel, 'Refractor');
  assert.equal(result.diagnostics.metadata.lines.at(-1), 'REFRACTOR');
});

test('fixed GRADE/REPORT pixels survive every front composition and the back remains exact pinned artwork', async () => {
  const renders = [renderApprovedBLabel(sports), renderApprovedBLabel(pokemon, { previewMaterial: 'holo' })];
  const brand = colorApprovedBArtwork(buildApprovedBFront({ title: 'Illustration', cutouts: '', support: '' }));
  const results = [];
  for (const svg of [...renders.flatMap(value => [value.printSvg, value.previewSvg]), brand]) {
    const crop = pixelsInMmRegion(await raster(svg), [48.7, 15.2, 54.9, 18.7]);
    let white = 0;
    for (let i = 0; i < crop.length; i += 4) if (crop[i] > 240 && crop[i + 1] > 240 && crop[i + 2] > 240 && crop[i + 3] > 128) white++;
    assert(white > 400, `both support words must remain visibly white (${white} white pixels)`); results.push(crop);
  }
  for (const crop of results.slice(1)) assert.deepEqual(crop, results[0], 'dynamic card fields must not alter the support words');
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
