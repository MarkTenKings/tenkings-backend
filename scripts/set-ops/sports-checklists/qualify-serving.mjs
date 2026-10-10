// Offline serving qualification. Run each command in a fresh Node process:
//   node qualify-serving.mjs identities INDEX.json IDENTITIES.json
//   node qualify-serving.mjs memory INDEX.json IDENTITIES.json RESULT.json
//   node qualify-serving.mjs equality INDEX.json BASELINE.json[.gz] RESULT.json
// The baseline may be a v1 catalog or v2 index. No network or source writes.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createManufacturerChecklistVariantProvider } from '../../../packages/card-catalog-evidence/src/manufacturer-checklist.mjs';

const [mode, indexPath, inputPath, resultPath] = process.argv.slice(2);
assert.ok(['identities', 'memory', 'equality'].includes(mode) && indexPath && inputPath && (mode === 'identities' || resultPath), 'See usage at top of script');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = await readFile(indexPath), catalog = JSON.parse(raw), indexHash = hash(raw);
assert.equal(catalog.schemaVersion, 'manufacturer-checklist-index/v2');
const root = dirname(resolve(indexPath));
const providerSourceHash = hash(await readFile(new URL('../../../packages/card-catalog-evidence/src/manufacturer-checklist.mjs', import.meta.url)));
const metadata = ({ shard, ...source }) => source;
const cells = (data, row) => row.slice(1).map(value => data.strings ? data.strings[value] : value);
const identityFor = (source, data, row) => {
  const [, cardNumber, name] = cells(data, row);
  return { category: 'SPORTS', manufacturer: source.manufacturer, year: source.year, setName: source.setName, name, cardNumber, language: null };
};
async function shardBytes(directory, descriptor) {
  assert.match(descriptor.sha256, /^[a-f0-9]{64}$/);
  assert.equal(descriptor.path, `manufacturer-checklists/${descriptor.sha256}.json.gz`);
  const bytes = await readFile(resolve(directory, descriptor.path));
  assert.equal(bytes.length, descriptor.compressedBytes);
  assert.equal(hash(bytes), descriptor.sha256);
  return bytes;
}
async function payload(directory, source) {
  const decoded = gunzipSync(await shardBytes(directory, source.shard), { maxOutputLength: 8 * 1024 * 1024 });
  assert.equal(decoded.length, source.shard.decodedBytes);
  assert.equal(hash(decoded), source.shard.decodedSha256);
  const data = JSON.parse(decoded);
  assert.equal(data.schemaVersion, 'manufacturer-checklist/v1');
  assert.equal(data.complete, false);
  assert.deepEqual(data.sources, [metadata(source)]);
  assert.equal(data.rows.length, source.shard.rowCount);
  assert.ok(data.rows.every(row => row[0] === 0));
  return data;
}
async function save(path, result) {
  const receipt = { ...result, observedAt: new Date().toISOString(), node: process.version, providerSourceHash, indexHash, noNetwork: true };
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(receipt));
}

if (mode === 'identities') {
  const identities = [];
  for (const source of catalog.sources) {
    const data = await payload(root, source);
    if (data.rows.length) identities.push({ identity: identityFor(source, data, data.rows[0]), shard: source.shard.path });
  }
  await writeFile(inputPath, JSON.stringify({ indexHash, identities }), { flag: 'wx' });
  console.log(JSON.stringify({ indexHash, identities: identities.length }));
} else if (mode === 'memory') {
  const fixture = JSON.parse(await readFile(inputPath));
  assert.equal(fixture.indexHash, indexHash, 'Lookup fixtures must be generated from this exact index');
  assert.deepEqual(fixture.identities.map(value => value.shard), catalog.sources.filter(value => value.shard.rowCount).map(value => value.shard.path));
  let reads = 0, active = 0, maxConcurrentReads = 0, candidates = 0;
  const loads = new Map();
  const provider = createManufacturerChecklistVariantProvider({ catalog, loadShard: async descriptor => {
    reads++; loads.set(descriptor.path, (loads.get(descriptor.path) ?? 0) + 1);
    active++; maxConcurrentReads = Math.max(active, maxConcurrentReads);
    try { return await shardBytes(root, descriptor); } finally { active--; }
  } });
  const started = performance.now(), initialRss = process.memoryUsage().rss;
  for (let pass = 0; pass < 2; pass++) for (const { identity } of fixture.identities)
    candidates += (await provider.prepare(identity)).candidates.length;
  const concurrent = fixture.identities.slice(0, 16);
  await Promise.all(concurrent.map(({ identity }) => provider.prepare(identity)));
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  assert.equal(maxConcurrentReads, 1);
  assert.ok(fixture.identities.every(value => loads.has(value.shard)), 'Every nonempty source was loaded');
  assert.ok(peakRssBytes < 512 * 1024 * 1024, 'Catalog-only qualification must leave headroom in a 1 GiB worker');
  await save(resultPath, { pass: true, sourceCount: catalog.sources.length, explicitRows: catalog.sources.reduce((sum, source) => sum + source.shard.rowCount, 0),
    sequentialPrepares: fixture.identities.length * 2, concurrentPrepares: concurrent.length, candidates, reads, uniqueShardsRead: loads.size,
    shardsReloadedAfterEviction: [...loads.values()].filter(count => count > 1).length, maxConcurrentReads,
    initialRss, finalRss: process.memoryUsage().rss, peakRssBytes, elapsedMs: Math.round(performance.now() - started), manualGc: false });
} else {
  const baselineBytes = await readFile(inputPath);
  const baseline = JSON.parse(inputPath.endsWith('.gz') ? gunzipSync(baselineBytes, { maxOutputLength: 96 * 1024 * 1024 }) : baselineBytes);
  assert.ok(['manufacturer-checklist/v1', 'manufacturer-checklist-index/v2'].includes(baseline.schemaVersion));
  const sharded = baseline.schemaVersion === 'manufacturer-checklist-index/v2';
  const baselineRoot = dirname(resolve(inputPath)), baselineRows = new Map();
  if (!sharded) {
    let previous = -1;
    for (const row of baseline.rows) {
      assert.ok(row[0] >= previous, 'Preserved monolith must retain source order'); previous = row[0];
      if (!baselineRows.has(row[0])) baselineRows.set(row[0], []);
      baselineRows.get(row[0]).push(row);
    }
  }
  assert.ok(catalog.sources.length >= baseline.sources.length);
  // Restrict comparison to preserved sources; genuinely new evidence can add choices.
  const retained = { ...catalog, sources: catalog.sources.slice(0, baseline.sources.length) };
  const prior = createManufacturerChecklistVariantProvider({ catalog: baseline, loadShard: descriptor => shardBytes(baselineRoot, descriptor) });
  const next = createManufacturerChecklistVariantProvider({ catalog: retained, loadShard: descriptor => shardBytes(root, descriptor) });
  let comparedSources = 0, retainedRows = 0, candidateCount = 0;
  for (let i = 0; i < baseline.sources.length; i++) {
    const source = sharded ? metadata(baseline.sources[i]) : baseline.sources[i];
    assert.deepEqual(metadata(retained.sources[i]), source, `Source metadata/order ${i}`);
    const original = sharded ? await payload(baselineRoot, baseline.sources[i]) : { ...baseline, rows: baselineRows.get(i) ?? [] };
    const updated = await payload(root, retained.sources[i]);
    assert.equal(updated.rows.length, original.rows.length, `Source row count ${i}`);
    for (let j = 0; j < original.rows.length; j++) assert.deepEqual(cells(updated, updated.rows[j]), cells(original, original.rows[j]), `Source ${i} row ${j}`);
    retainedRows += original.rows.length;
    if (original.rows.length) {
      const identity = identityFor(source, original, original.rows[0]);
      const actual = await next.prepare(identity);
      assert.deepEqual(actual, await prior.prepare(identity), `Candidate result ${i}`);
      candidateCount += actual.candidates.length; comparedSources++;
    }
  }
  await save(resultPath, { pass: true, baselineHash: hash(baselineBytes), comparedSources, retainedRows, candidateCount,
    allRetainedRowsAndSourceOrderExact: true, completeResultsIdenticalForOneIdentityPerSource: true, includesCandidateIdsLocatorsAndDiagnostics: true });
}
