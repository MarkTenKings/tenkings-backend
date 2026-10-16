import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createManufacturerChecklistIdentityReader } from '../src/index.mjs';
import { createManufacturerIdentityIndexBuilder } from '../src/manufacturer-identity-index.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const blobs = new Map(), payloads = [], reads = [], metadataReads = [];
  const sources = [
    { manufacturer: 'Fleer', sport: 'basketball', year: '1992-93', setName: 'Fleer', aliases: [], evidenceAuthority: 'secondary', sourcePublisher: 'Trading Card Database', rows: [[0, 'Slam Dunk', '273', 'Michael Jordan', 'print:item:274']] },
    { manufacturer: 'Upper Deck', sport: 'basketball', year: '1994', setName: 'Rare Air', aliases: ['Jordan Rare Air'], rows: [[0, 'Base', '3', 'Michael Jordan', 'row:3'], [0, 'Base', '9', 'Other Athlete', 'row:9']] },
    { manufacturer: 'Leaf', sport: 'football', year: '2016', setName: 'Army', aliases: [], rows: [[0, 'Base', '56', 'Michael Jordan', 'row:56']] },
  ].map(({ rows, ...metadata }, i) => {
    const source = { ...metadata, url: `https://example.com/checklist/${i}`, sha256: hash(`retained ${i}`) };
    const data = { schemaVersion: 'manufacturer-checklist/v1', complete: false, sources: [source], rows };
    payloads.push(data);
    const decoded = Buffer.from(JSON.stringify(data)), bytes = gzipSync(decoded), sha256 = hash(bytes);
    const shard = { path: `manufacturer-checklists/${sha256}.json.gz`, sha256, decodedSha256: hash(decoded), compressedBytes: bytes.length, decodedBytes: decoded.length, rowCount: rows.length };
    blobs.set(shard.path, bytes); return { ...source, shard };
  });
  const catalog = { schemaVersion: 'manufacturer-checklist-index/v2', complete: false, sources };
  const builder = createManufacturerIdentityIndexBuilder(catalog); payloads.forEach((data, i) => builder.add(i, data));
  const identityIndex = builder.finish();
  const options = { loadCatalog: async () => { metadataReads.push(true); return catalog; }, loadIdentityIndex: async () => identityIndex,
    loadShard: async descriptor => { reads.push(descriptor.path); return blobs.get(descriptor.path); } };
  return { reader: createManufacturerChecklistIdentityReader(options), catalog, identityIndex, options, reads, metadataReads, blobs };
}

test('missing set and number still consult every indexed source by name and return competing identities with provenance', async () => {
  const f = fixture(), result = await f.reader.lookup({ fields: { category: 'SPORTS', name: 'Michael Jordan' } });
  assert.equal(result.status, 'ambiguous'); assert.equal(result.matches.length, 3);
  assert.equal(result.catalog.rowCount, 4); assert.equal(result.catalog.sourceCount, 3); assert.equal(result.catalog.coverage, 'partial');
  assert.equal(f.metadataReads.length, 1); assert.equal(f.reads.length, 3);
  const source = result.matches[0].source;
  assert.equal(source.evidenceAuthority, 'secondary'); assert.equal(source.sourcePublisher, 'Trading Card Database');
  assert.equal(source.locator, 'print:item:274'); assert.match(source.recordId, /^manufacturer-row:v1:/);
  assert.equal(source.sha256, f.catalog.sources[0].sha256); assert.equal(source.shardSha256, f.catalog.sources[0].shard.sha256);
});

test('global name index narrows reads without a set, and exact source rows fill the candidate identity', async () => {
  const f = fixture(), result = await f.reader.lookup({ fields: { category: 'SPORTS', name: 'Other Athlete' } });
  assert.equal(result.status, 'matched'); assert.equal(f.reads.length, 1);
  assert.deepEqual(result.matches[0].identity, { category: 'SPORTS', name: 'Other Athlete', manufacturer: 'Upper Deck', year: '1994', setName: 'Rare Air', cardNumber: '9', language: null });
  assert.equal(result.matches[0].source.locator, 'row:9');
});

test('set, maker, source season, number and sport narrow independently, while partial name retains the full name', async () => {
  const f = fixture();
  const result = await f.reader.lookup({ fields: { category: 'SPORTS', name: 'Jordan', manufacturer: 'Fleer', year: '1992', cardNumber: '0273', sport: 'basketball' } });
  assert.equal(result.status, 'matched'); assert.equal(result.matches[0].identity.year, '1992-93'); assert.equal(result.matches[0].identity.name, 'Michael Jordan'); assert.equal(f.reads.length, 1);
  assert.equal((await f.reader.lookup({ fields: { category: 'SPORTS', manufacturer: 'Upper Deck', setName: 'Jordan Rare Air' } })).matches.length, 2);
  assert.equal((await f.reader.lookup({ fields: { category: 'SPORTS', name: 'Michael Jordan', sport: 'football' } })).matches[0].identity.manufacturer, 'Leaf');
});

test('model proposals narrow first but remain distinguishable from the original field query', async () => {
  const f = fixture(), result = await f.reader.lookup({ fields: { name: 'Michael Jordan' }, proposals: [{ category: 'SPORTS', name: 'Michael Jordan', manufacturer: 'Fleer', year: '1992-93', setName: 'Fleer', cardNumber: '273' }] });
  assert.equal(result.status, 'ambiguous'); assert.equal(result.matches[0].identity.manufacturer, 'Fleer');
  assert.deepEqual(result.matches[0].queryIndices, [1, 0]); assert.equal(result.matches.length, 3);
});

test('empty, unsupported, no match and cancelled lookups are explicit nonblocking outcomes', async () => {
  const f = fixture();
  const empty = await f.reader.lookup({ fields: {} }); assert.equal(empty.status, 'insufficient_evidence'); assert.equal(empty.catalog.rowCount, 4); assert.equal(f.metadataReads.length, 1);
  assert.equal((await f.reader.lookup({ fields: { category: 'POKEMON', name: 'Pikachu' } })).status, 'insufficient_evidence');
  assert.equal((await f.reader.lookup({ fields: { name: 'Not Retained' } })).status, 'no_match'); assert.equal(f.reads.length, 0);
  const aborted = await f.reader.lookup({ fields: { name: 'Michael Jordan' } }, { signal: AbortSignal.abort() }); assert.equal(aborted.status, 'unavailable'); assert.deepEqual(aborted.problems, ['IDENTITY_LOOKUP_ABORTED']);
});

test('old or missing name acceleration data and corrupt source bytes never fabricate a match', async () => {
  const f = fixture(); f.identityIndex.catalogSha256 = 'a'.repeat(64);
  assert.equal((await f.reader.lookup({ fields: { name: 'Michael Jordan' } })).status, 'unavailable'); assert.equal(f.reads.length, 0);
  const g = fixture(); g.blobs.set(g.catalog.sources[0].shard.path, Buffer.from('changed'));
  const result = await g.reader.lookup({ fields: { name: 'Michael Jordan', manufacturer: 'Fleer' } }); assert.equal(result.status, 'unavailable'); assert.equal(result.matches.length, 0);
});

test('result or source bounds remain explicitly ambiguous, and sequential/concurrent repeats share verified reads', async () => {
  const f = fixture();
  const limited = await f.reader.lookup({ fields: { name: 'Michael Jordan' } }, { maxShards: 1 }); assert.equal(limited.status, 'ambiguous'); assert.equal(limited.truncated, true);
  const limitedRows = await f.reader.lookup({ fields: { name: 'Michael Jordan' } }, { maxMatches: 1 }); assert.equal(limitedRows.status, 'ambiguous'); assert.equal(limitedRows.matches.length, 1);
  const before = f.reads.length; await Promise.all([f.reader.lookup({ fields: { name: 'Michael Jordan' } }), f.reader.lookup({ fields: { name: 'Michael Jordan' } })]); assert.equal(f.reads.length, before);
});

test('bundled release lookup resolves the incident Fleer identity with no set and reports all 7.4M retained rows', async () => {
  const result = await createManufacturerChecklistIdentityReader().lookup({ fields: { category: 'SPORTS', name: 'Michael Jordan', manufacturer: 'Fleer', year: '1992-93', cardNumber: '273' } });
  assert.equal(result.status, 'matched'); assert.equal(result.catalog.rowCount, 7439127); assert.equal(result.catalog.sourceCount, 1854);
  assert.equal(result.matches[0].identity.setName, 'Fleer'); assert.equal(result.matches[0].source.sourcePublisher, 'Trading Card Database');
});
