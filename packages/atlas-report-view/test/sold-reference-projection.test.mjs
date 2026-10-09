import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { projectSelectedSoldReferences } from '../src/sold-reference-projection.mjs';
const require = createRequire(new URL('../../atlas-manual-workspace/package.json', import.meta.url));
const built = await require('esbuild').build({ entryPoints: [fileURLToPath(new URL('../../ebay-sold-comps-v2/src/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022' });
const code = built.outputFiles[0].text;
const engine = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const input = { category: 'POKEMON', cardName: 'Charmander', year: '2023', productSet: 'Scarlet Violet 151', cardNumber: '004' };
function candidate(overrides = {}) {
  return engine.parseEbaySoldCompsV2Candidate({ title: '2023 Charmander Scarlet Violet 151 004 PSA 9',
    itemId: '123456789012', url: 'https://www.ebay.com/itm/123456789012', soldPrice: '40.00', soldCurrency: 'USD',
    bestOfferAccepted: false, endedAt: '2026-09-21', ...overrides }, input);
}
const result = candidates => ({ source: engine.EBAY_SOLD_COMPS_V2_SOURCE, engineVersion: engine.EBAY_SOLD_COMPS_V2_ENGINE_VERSION, retrievedAt: '2026-09-22T00:00:00Z', candidates });
test('actual existing parser output projects only explicitly selected disclosed graded USD sales', () => {
  const value = candidate(); assert.ok(value);
  const before = structuredClone(value), projected = projectSelectedSoldReferences(result([value]), [value.id]);
  assert.equal(projected.sales[0].currency, 'USD'); assert.equal(projected.sales[0].priceMinor, 4000);
  assert.equal(projected.sales[0].grader, 'PSA'); assert.equal(projected.sales[0].grade, '9'); assert.equal(projected.sales[0].soldAt, '2026-09-21T00:00:00.000Z');
  assert.equal(Object.hasOwn(projected, 'estimate'), false); assert.deepEqual(value, before);
});
test('real parser best-offer, foreign-currency, missing status and raw outputs cannot become invented sale prices', () => {
  for (const overrides of [{ bestOfferAccepted: true }, { soldCurrency: 'CAD' }, { bestOfferAccepted: undefined },
    { title: '2023 Charmander Scarlet Violet 151 004 ungraded' }]) {
    const value = candidate(overrides); assert.ok(value); assert.throws(() => projectSelectedSoldReferences(result([value]), [value.id]), /SELECTION_INVALID/);
  }
});
test('empty selections stay absent and stale or duplicated selections fail instead of selecting alternatives', () => {
  const value = candidate(), source = result([value]); assert.equal(projectSelectedSoldReferences(source, []), null);
  for (const ids of [['missing'], [value.id, value.id]]) assert.throws(() => projectSelectedSoldReferences(source, ids));
  assert.throws(() => projectSelectedSoldReferences({ ...source, engineVersion: 'unknown' }, [value.id]));
});
test('grade metadata cannot contradict the grader and absent identity checks never establish a match', () => {
  const value = candidate();
  for (const gradeEvidence of [{ status: 'RAW', designation: null }, { status: 'GRADED', designation: 'BLACK_LABEL' },
    { status: 'GRADED', designation: 'PERFECT' }, { status: 'anything', designation: null }]) {
    assert.throws(() => projectSelectedSoldReferences(result([{ ...value, gradeEvidence }]), [value.id]));
  }
  const variantEvidence = { status: 'MATCH', observed: { language: ['english'], finish: ['reverse holo'], parallelSignals: ['reverse holo'] } };
  const sale = projectSelectedSoldReferences(result([{ ...value, variantEvidence }]), [value.id]).sales[0];
  assert.equal(sale.identityStatus, 'UNKNOWN'); assert.equal(sale.variant, 'reverse holo');
});
