import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { approvedBMetadataLines, renderApprovedBLabel, isApprovedBRendererProfile,
  LABEL_APPROVED_B_LEGACY_RENDERER_PROFILE_HASH, LABEL_APPROVED_B_RENDERER_PROFILE_HASH,
  LABEL_APPROVED_B_RENDERER_PROFILE } from '../src/label-approved-b.mjs';

const unknown = () => ({ version: 'atlas-sports-attributes-public-v1',
  serial: { presence: 'UNKNOWN', printed: null, numerator: null, denominator: null },
  autograph: { presence: 'UNKNOWN', type: 'UNKNOWN' }, relic: { presence: 'UNKNOWN', windows: [] } });
const serial = (numerator, denominator) => ({ ...unknown(),
  serial: { presence: 'PRESENT', printed: `${numerator}/${denominator}`, numerator, denominator } });
const input = identity => ({ identity, finalGrade: 9, reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1, cardProfile: 'SPORTS' });
const examples = [
  [{ playerName: 'TreVeyon Henderson', cardNumber: '20', year: '2025', manufacturer: 'Panini',
    productSet: 'Rookies & Stars - Thrillers', parallel: 'ICE' },
  ['#20 2025 Panini Rookies & Stars', 'THRILLERS · ICE']],
  [{ playerName: 'Michael Jordan', cardNumber: '8', year: '1998-99', manufacturer: 'Upper Deck',
    productSet: 'Black Diamond', parallel: 'Base' }, ['#8 1998-99 Upper Deck', 'Black Diamond']],
  [{ playerName: 'Nick Kurtz', cardNumber: '93', year: '2025', manufacturer: 'Topps',
    productSet: 'Bowman Chrome', parallel: 'Refractor', sportsAttributes: serial(488, 499) },
  ['#93 2025 Bowman Chrome', 'REFRACTOR /499']],
  [{ playerName: 'Anthony Davis', cardNumber: 'PD-10', year: '2025-26', manufacturer: 'Topps',
    productSet: 'Topps Chrome Basketball', parallel: 'PATENTED',
    sportsAttributes: { ...unknown(), specialFeatures: [{ kind: 'CASE_HIT' }] } },
  ['#PD-10 2025-26 Topps Chrome', 'PATENTED · CASE HIT']],
  [{ playerName: 'Mike Trout', cardNumber: '1', year: '2025', manufacturer: 'Topps',
    productSet: 'Topps Chrome 1955 Anniversary', parallel: 'Blue Mini Diamond Refractor', sportsAttributes: serial(132, 199) },
  ['#1 2025 Topps Chrome 1955 Anniv.', 'BLUE MINI DIAMOND REFRACTOR /199']],
  [{ playerName: 'Michael Jordan', cardNumber: 'NNO', year: null, manufacturer: null,
    productSet: 'Michael Jordan Red Border (unlicensed)', parallel: 'Red Border' },
  ['#NNO (unlicensed)', 'RED BORDER']],
];

test('six reviewed examples keep product and variant on their own rows without changing approved facts', () => {
  for (const [identity, expected] of examples) {
    const source = input(identity), before = structuredClone(source), result = renderApprovedBLabel(source);
    assert.equal(result.state, 'READY', identity.playerName);
    assert.deepEqual(result.diagnostics.metadata.lines, expected);
    assert.deepEqual(result.source, before); assert.deepEqual(source, before);
    assert.equal(result.diagnostics.name.text, identity.playerName.toUpperCase());
    assert.equal(result.diagnostics.certificate.text, `CERT # ${source.reportNumber}`);
    assert.equal(result.diagnostics.grade.value, source.finalGrade);
    assert(result.diagnostics.metadata.capHeightMm >= 1.3);
    assert(result.diagnostics.metadata.capHeightMm <= 1.6);
    assert.deepEqual(result.diagnostics.metadata.lineRoles, expected.map((_, index) =>
      index && result.diagnostics.metadata.semanticLines.variant ? 'variant' : 'identity'));
  }
  const trout = renderApprovedBLabel(input(examples[4][0]));
  assert.deepEqual(trout.diagnostics.metadata.abbreviations, [{ field: 'productSet', from: 'Chrome 1955 Anniversary',
    to: 'Chrome 1955 Anniv.', reason: 'readable-two-line-fit' }]);
  assert.equal(trout.source.identity.productSet, 'Topps Chrome 1955 Anniversary');
  assert.equal(trout.diagnostics.metadata.semanticLines.variant, 'Blue Mini Diamond Refractor /199');
  assert.equal(LABEL_APPROVED_B_RENDERER_PROFILE.detail.maximumLines, 2);
});

function clearance(bounds) {
  const closestX = Math.max(bounds.x, Math.min(51.8, bounds.x + bounds.width));
  const closestY = Math.max(bounds.y, Math.min(9.75, bounds.y + bounds.height));
  return Math.hypot(closestX - 51.8, closestY - 9.75);
}

test('each detail row uses its pinned font metrics, uniform scale and padded circular NFC clearance', () => {
  const faces = {
    RobotoCondensed: fontkit.create(readFileSync(new URL('../assets/v4/fonts/RobotoCondensed-variable.ttf', import.meta.url))).getVariation({ wght: 700 }),
    BebasNeue: fontkit.create(readFileSync(new URL('../assets/approved-b/fonts/BebasNeue-Regular.ttf', import.meta.url))),
  };
  for (const [identity] of examples) {
    const result = renderApprovedBLabel(input(identity)), metadata = result.diagnostics.metadata;
    let lastBottom = 10.37; // Lowest retained two-line name bound.
    for (const [index, bounds] of metadata.bounds.entries()) {
      const variant = metadata.lineRoles[index] === 'variant';
      assert.equal(bounds.font, variant ? 'BebasNeue' : 'RobotoCondensed');
      const face = faces[bounds.font], cap = face.layout('H', { kern: false }).bbox;
      const scale = bounds.capHeightMm / (cap.maxY - cap.minY);
      const bbox = face.layout(metadata.lines[index], { kern: false }).bbox;
      assert(Math.abs(bounds.width - (bbox.maxX - bbox.minX) * scale) < .00002);
      assert(Math.abs(bounds.height - (bbox.maxY - bbox.minY) * scale) < .00002);
      assert(Math.abs(bounds.fontSizePt - scale * face.unitsPerEm / 25.4 * 72) < .00001);
      assert(bounds.capHeightMm >= 1.3 && bounds.capHeightMm <= (variant ? 1.9 : 1.6));
      assert(bounds.x === 17.5 && bounds.width <= 29.000001);
      assert(bounds.y >= 11 && bounds.y > lastBottom);
      lastBottom = bounds.y + bounds.height;
      assert(lastBottom <= 16.600001 && lastBottom < 16.85, 'text must clear certificate frame stroke');
      assert(clearance(bounds) >= 5.85 - .000002, 'detail ink box must clear the NFC aperture plus 0.75mm padding');
    }
    assert.equal(metadata.capHeightMm, Math.min(...metadata.bounds.map(bounds => bounds.capHeightMm)));
    assert.equal(metadata.fontSizePt, Math.min(...metadata.bounds.map(bounds => bounds.fontSizePt)));
    for (const [, x, y] of result.printSvg.matchAll(/scale\(([-.\d]+),([-.\d]+)\)/g))
      assert.equal(Math.abs(Number(x)), Math.abs(Number(y)));
  }
  const trout = renderApprovedBLabel(input(examples[4][0])).diagnostics.metadata;
  assert(trout.bounds[1].capHeightMm > trout.bounds[0].capHeightMm, 'the long variant should still have greater cap height than its identity row');
  const jordan = renderApprovedBLabel(input(examples[1][0])).diagnostics.metadata;
  assert.deepEqual(jordan.bounds.map(bounds => bounds.font), ['RobotoCondensed', 'RobotoCondensed']);
});

test('NFC padding reduces only the colliding Henderson line and never introduces a third player/card-name row', () => {
  const result = renderApprovedBLabel(input(examples[0][0])), name = result.diagnostics.name;
  assert.deepEqual(name.lines, ['TREVEYON', 'HENDERSON']);
  assert.equal(name.heightsMm[0], 3.158929, 'the noncolliding first line retains its original scale');
  assert.equal(name.widthsMm[0], 25.167857);
  assert(name.heightsMm[1] < name.heightsMm[0]);
  assert(Math.abs(name.heightsMm[1] - 3.099018) < .00001, 'shrink only enough to fit the 28.45mm padded width');
  assert(Math.abs(name.widthsMm[1] - 28.45) < .00001);
  assert.equal(name.inkHeightMm, Math.min(...name.heightsMm));
  for (const [identity] of examples) {
    const diagnostics = renderApprovedBLabel(input(identity)).diagnostics.name;
    assert(diagnostics.lines.length <= 2);
    assert(diagnostics.heightsMm.every(height => height >= 1.9));
    for (const bounds of diagnostics.bounds) assert(clearance(bounds) >= 5.85 - .000002);
    if (identity.playerName !== 'TreVeyon Henderson') assert(diagnostics.heightsMm.every(height => height === 3.35));
  }
});

test('manufacturer dedupe retains explicit consumer brand and never guesses an unknown maker', () => {
  for (const [manufacturer, productSet, expected] of [
    ['The Topps Company', 'Topps Chrome', 'Topps Chrome'],
    ['Panini America', '2025 Panini Prizm', 'Panini Prizm'],
    ['The Upper Deck Company', 'Upper Deck Black Diamond', 'Upper Deck Black Diamond'],
    ['Topps', 'Bowman Chrome', 'Bowman Chrome'],
    ['Topps', 'Chrome', 'Topps Chrome'],
    [null, 'Chrome', 'Chrome'], ['Independent Maker', 'Set', 'Independent Maker Set'],
  ]) assert.equal(approvedBMetadataLines({ manufacturer, productSet, year: '2025' }).identity, `2025 ${expected}`);
  assert.equal(approvedBMetadataLines({ manufacturer: 'Panini', productSet: 'Paninimania' }).identity, 'Panini Paninimania');
  assert.equal(approvedBMetadataLines({ playerName: 'Joe Smith', productSet: 'Gold Label', parallel: 'Gold' }).identity, 'Gold Label');
  assert.equal(approvedBMetadataLines({ playerName: 'Michael Jordan', productSet: 'Michael Jordan Red Border (unlicensed)', parallel: 'Red Border' }).identity, '(unlicensed)');
});

test('only explicit bounded display aliases change product spelling and only sport products split at a spaced hyphen', () => {
  const normal = approvedBMetadataLines({ manufacturer: 'Topps', productSet: 'Topps Chrome 1955 Anniversary' });
  assert.equal(normal.identity, 'Topps Chrome 1955 Anniversary'); assert.deepEqual(normal.abbreviations, []);
  assert.equal(approvedBMetadataLines({ productSet: 'Other Anniversary' }, { abbreviate: true }).identity, 'Other Anniversary');
  assert.equal(approvedBMetadataLines({ manufacturer: 'Topps', productSet: 'Topps Chrome Basketball' }).identity, 'Topps Chrome');
  assert.equal(approvedBMetadataLines({ manufacturer: 'Panini', productSet: 'Prizm Basketball' }).identity, 'Panini Prizm Basketball');
  const card = { manufacturer: 'Pokémon', productSet: 'Set - Subset', parallel: 'Holo' };
  assert.deepEqual(approvedBMetadataLines(card, { cardProfile: 'POKEMON' }), { identity: 'Pokémon Set - Subset', variant: 'Holo', abbreviations: [] });
  assert.equal(approvedBMetadataLines({ productSet: 'Rookies & Stars - Thrillers', insert: 'Thrillers', parallel: 'ICE' }).variant, 'Thrillers · ICE');
  assert.equal(approvedBMetadataLines({ productSet: 'Rookies-and-Stars', parallel: 'Base Card' }).variant, '');
});

test('confirmed features use exact serial denominator, real autograph types, explicit patch material and reviewed enum kinds', () => {
  const attributes = { ...serial(7, 99), autograph: { presence: 'PRESENT', type: 'ON_CARD' },
    relic: { presence: 'PRESENT', windows: [{ material: 'Jersey patch' }] },
    specialFeatures: [{ kind: 'SUPER_SHORT_PRINT' }, { kind: 'CASE_HIT' }, { kind: 'SHORT_PRINT' }] };
  assert.equal(approvedBMetadataLines({ parallel: 'Refractor', sportsAttributes: attributes }).variant, 'Refractor /99 · AUTO · PATCH · Case Hit · SP · SSP');
  for (const type of ['ON_CARD', 'STICKER', 'CUT'])
    assert.equal(approvedBMetadataLines({ sportsAttributes: { ...unknown(), autograph: { presence: 'PRESENT', type } } }).variant, 'AUTO');
  for (const type of ['FACSIMILE', 'UNKNOWN'])
    assert.equal(approvedBMetadataLines({ sportsAttributes: { ...unknown(), autograph: { presence: 'PRESENT', type } } }).variant, '');
  for (const material of [null, 'jersey', 'fabric', 'not a patch', 'bat', 'patch-like fabric'])
    assert.equal(approvedBMetadataLines({ sportsAttributes: { ...unknown(), relic: { presence: 'PRESENT', windows: [{ material }] } } }).variant, '');
  assert.equal(approvedBMetadataLines({ parallel: 'Refractor /99', sportsAttributes: serial(7, 99) }).variant, 'Refractor /99');
  assert.equal(approvedBMetadataLines({ insert: 'Patented', productSet: 'Case Hit Collection', sportsAttributes: unknown() }).variant, 'Patented');
  assert.equal(approvedBMetadataLines({ sportsAttributes: attributes }, { cardProfile: 'POKEMON' }).variant, '');
});

test('malformed or unsupported feature claims fail closed and private evidence is never part of display text', () => {
  const invalid = [
    { ...unknown(), version: 'unreviewed' }, { ...serial(7, 99), serial: { ...serial(7, 99).serial, denominator: 100 } },
    { ...serial(7, 99), serial: { ...serial(7, 99).serial, printed: 'not numbered' } },
    { ...unknown(), specialFeatures: [] }, { ...unknown(), specialFeatures: [{ kind: 'CASE_HIT' }, { kind: 'CASE_HIT' }] },
    { ...unknown(), specialFeatures: [{ kind: 'RARE' }] }, { ...unknown(), relic: { presence: 'PRESENT', windows: [] } },
  ];
  for (const sportsAttributes of invalid) assert.throws(() => renderApprovedBLabel(input({ playerName: 'A Player', sportsAttributes })), /SOURCE_INVALID/);
  const privateAttributes = { ...unknown(), version: 'atlas-sports-attributes-v1',
    specialFeatures: [{ kind: 'CASE_HIT', evidence: { type: 'REVIEWED_REFERENCE', sourceTitle: 'Private reference', sourceUrl: 'https://example.com/', matchNote: 'Staff note' } }] };
  const result = renderApprovedBLabel(input({ playerName: 'A Player', sportsAttributes: privateAttributes }));
  assert.equal(result.diagnostics.metadata.text, 'Case Hit');
  assert.doesNotMatch(result.printSvg, /Private reference|example.com|Staff note/);
  assert.deepEqual(result.source.identity.sportsAttributes, privateAttributes);
});

test('unfit product plus variant fails instead of adding a third row, while an empty variant can use two identity rows', () => {
  const base = { playerName: 'A Player', cardNumber: '1', year: '2025', manufacturer: 'Panini',
    productSet: 'National Treasures Collegiate Basketball', parallel: 'Blue' };
  const result = renderApprovedBLabel(input(base));
  assert.equal(result.state, 'NEEDS_LAYOUT'); assert.equal(result.diagnostics.code, 'METADATA_OVERFLOW');
  assert.equal(result.printSvg, undefined); assert.deepEqual(result.source.identity, base);
  const identityOnly = { ...base, parallel: null }, wrapped = renderApprovedBLabel(input(identityOnly));
  assert.equal(wrapped.state, 'READY'); assert.equal(wrapped.diagnostics.metadata.lines.length, 2);
  assert.equal(wrapped.diagnostics.metadata.lines.join(' '), '#1 2025 Panini National Treasures Collegiate Basketball');
  assert.deepEqual(wrapped.diagnostics.metadata.lineRoles, ['identity', 'identity']);
  assert(wrapped.diagnostics.metadata.bounds.every(bounds => bounds.capHeightMm >= 1.3));
  const unfit = renderApprovedBLabel(input({ ...base, productSet: 'W'.repeat(100) }));
  assert.equal(unfit.state, 'NEEDS_LAYOUT'); assert.equal(unfit.diagnostics.code, 'METADATA_OVERFLOW');
  assert.equal(unfit.printSvg, undefined); assert.equal(unfit.source.identity.productSet, 'W'.repeat(100));
});

test('approved-B profile compatibility is limited to the retained physical template and the exact prior renderer', () => {
  assert.equal(LABEL_APPROVED_B_RENDERER_PROFILE.version, 'atlas-approved-b-v1');
  assert.notEqual(LABEL_APPROVED_B_LEGACY_RENDERER_PROFILE_HASH, LABEL_APPROVED_B_RENDERER_PROFILE_HASH);
  assert(isApprovedBRendererProfile('a0491ff4f0a86166371f950c658c3e08397e688fe13f9e60f28abbda88b764ab'));
  assert(isApprovedBRendererProfile(LABEL_APPROVED_B_RENDERER_PROFILE_HASH));
  for (const value of [undefined, null, '', '0'.repeat(64), { hash: LABEL_APPROVED_B_RENDERER_PROFILE_HASH }]) assert(!isApprovedBRendererProfile(value));
});
