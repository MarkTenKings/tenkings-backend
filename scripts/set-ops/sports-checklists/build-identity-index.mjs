// Offline deterministic derived index. Does not acquire or change source rows.
// node scripts/set-ops/sports-checklists/build-identity-index.mjs [DATA_DIRECTORY]
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createManufacturerIdentityIndexBuilder, manufacturerIdentityCanonical } from '../../../packages/card-catalog-evidence/src/manufacturer-identity-index.mjs';

const root = resolve(process.argv[2] ?? 'packages/card-catalog-evidence/data');
const hash = value => createHash('sha256').update(value).digest('hex');
const index = JSON.parse(await readFile(resolve(root, 'manufacturer-checklists.index.json')));
assert.equal(index.schemaVersion, 'manufacturer-checklist-index/v2');
assert.equal(index.complete, false);
const builder = createManufacturerIdentityIndexBuilder(index);
for (const [sourceIndex, { shard, ...source }] of index.sources.entries()) {
  assert.match(shard.sha256, /^[a-f0-9]{64}$/);
  assert.equal(shard.path, `manufacturer-checklists/${shard.sha256}.json.gz`);
  const bytes = await readFile(resolve(root, shard.path));
  assert.equal(bytes.length, shard.compressedBytes); assert.equal(hash(bytes), shard.sha256);
  const decoded = gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 });
  assert.equal(decoded.length, shard.decodedBytes); assert.equal(hash(decoded), shard.decodedSha256);
  const data = JSON.parse(decoded);
  assert.equal(data.schemaVersion, 'manufacturer-checklist/v1'); assert.equal(data.complete, false);
  assert.equal(manufacturerIdentityCanonical(data.sources), manufacturerIdentityCanonical([source]));
  assert.equal(data.rows.length, shard.rowCount);
  assert(data.rows.every(row => Array.isArray(row) && row.length === 5 && row[0] === 0));
  builder.add(sourceIndex, data);
}
const data = builder.finish(), bytes = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
await writeFile(resolve(root, 'manufacturer-identities.index.json.gz'), bytes);
console.log(JSON.stringify({ catalogSha256: data.catalogSha256, sourceCount: data.sourceCount, rowCount: data.rowCount, names: data.names.length, compressedBytes: bytes.length, sha256: hash(bytes) }));
