import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { catalogDemandKey, normalizeCatalogDemand, catalogDemandResultHash, validateCatalogDemandResult, filterCatalogDemandResult, canonicalJson, isCatalogDemandSourceUrl } from '../src/index.mjs';
const hash = x => createHash('sha256').update(canonicalJson(x)).digest('hex');
const demand = { category: 'SPORTS', year: '2024', manufacturer: 'Topps', setName: 'Chrome', language: null };
function fixture() {
  const source = { url: 'https://www.topps.com/files/2024-chrome.pdf', sha256: 'a'.repeat(64), kind: 'manufacturer', byteSize: 20 }; source.sourceId = hash({ url: source.url, sha256: source.sha256 });
  const result = { schemaVersion: 'catalog-demand-result/v1', demandKey: catalogDemandKey(demand), demand, state: 'READY', attempt: 1, coverage: 'partial', sources: [source],
    choices: [{ rowId: 'b'.repeat(64), identity: { ...demand, name: 'Example Player', cardNumber: '025' }, parallel: 'Gold Refractor /50', sourceId: source.sourceId, locator: 'row:1', diagnostics: ['Confirm the physical finish.'] }], context: [], problems: ['UNREVIEWED_SOURCE_CANDIDATES'], capturedAt: '2026-10-09T00:00:00.000Z', snapshotHash: '' };
  result.snapshotHash = catalogDemandResultHash(result); return result;
}
test('demand shares a public set key across physical cards but never across year/category/language', () => {
  assert.equal(catalogDemandKey({ ...demand, cardId: 'private', photo: 'private' }), catalogDemandKey({ ...demand, setName: 'chrome' }));
  for (const change of [{ year: '2025' }, { category: 'POKEMON' }, { language: 'ja' }, { manufacturer: 'Panini' }]) assert.notEqual(catalogDemandKey(demand), catalogDemandKey({ ...demand, ...change }));
  assert.deepEqual(Object.keys(normalizeCatalogDemand({ ...demand, privateNotes: 'never sent' })), ['category', 'year', 'manufacturer', 'setName', 'language']);
  for (const setName of ['https://private.test/x', '/Users/secret/key', 'sk-abcdef0123456789', '<secret>']) assert.throws(() => normalizeCatalogDemand({ ...demand, setName }));
});
test('strict pending-source contract cannot smuggle canonical authority, image permission or altered source bytes', () => {
  const good = fixture(); assert.equal(validateCatalogDemandResult(good).coverage, 'partial');
  for (const modify of [x => x.canonical = 'made-up', x => x.choices[0].canonical = 'made-up', x => x.sources[0].sha256 = 'c'.repeat(64), x => x.choices[0].identity.category = 'POKEMON', x => x.sources[0].kind = 'secondary']) {
    const bad = structuredClone(good); modify(bad); bad.snapshotHash = catalogDemandResultHash(bad); assert.throws(() => validateCatalogDemandResult(bad));
  }
});
test('same-card filters accept leading zeros and preserve prefix/denominator/name distinctions', () => {
  const r = fixture(); assert.equal(filterCatalogDemandResult(r, { name: 'Example Player', cardNumber: '25' }).choices.length, 1);
  for (const card of [{ name: 'Other Player', cardNumber: '25' }, { name: 'Example Player', cardNumber: 'RC25' }]) assert.equal(filterCatalogDemandResult(r, card).choices.length, 0);
  r.choices[0].identity.cardNumber = 'RC01/RC025'; r.snapshotHash = catalogDemandResultHash(r);
  assert.equal(filterCatalogDemandResult(r, { name: 'Example Player', cardNumber: 'RC1/RC25' }).choices.length, 1);
  assert.equal(filterCatalogDemandResult(r, { name: 'Example Player', cardNumber: 'RC1/113' }).choices.length, 0);
});
test('fixed source hosts reject navigation, lookalikes, private URL components and unrelated CDN paths', () => {
  assert.ok(isCatalogDemandSourceUrl('https://cdn.shopify.com/s/files/1/0662/9749/5709/files/checklist.pdf'));
  for (const url of ['https://topps.com/', 'https://topps.com.evil.test/card.pdf', 'https://topps.com/account/foo', 'https://topps.com/x?token=private', 'https://user@topps.com/x', 'https://cdn.shopify.com/s/files/1/other.pdf', 'http://topps.com/x']) assert.equal(isCatalogDemandSourceUrl(url), false, url);
});
