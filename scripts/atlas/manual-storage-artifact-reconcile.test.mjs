import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconcile } from './manual-storage-artifact-reconcile.mjs';
const bytes = Buffer.alloc(65, 65), sha = b => createHash('sha256').update(b).digest('hex');
const profile = { target: { key: 'synthetic-only' }, payloadSha256: sha(bytes), requiredHeaders: { 'x-amz-meta-atlas-manual-lineage-sha256': 'synthetic-lineage' } };
function fixture({ absent = false, mutate, unknownDelete = false } = {}) {
  const calls = []; let present = !absent;
  return { calls, async send(req) {
    calls.push(req);
    assert.ok(['head', 'get', 'delete'].includes(req.operation)); assert.equal(req.target.key, profile.target.key);
    if (req.operation === 'delete') { if (unknownDelete) throw Error('lost'); present = false; return { status: 204, headers: {} }; }
    if (!present) return { status: 404, headers: {} };
    const result = { status: 200, headers: { 'content-length': '65', 'content-type': 'application/json', etag: '"owned"',
      'x-amz-meta-atlas-manual-lineage-sha256': 'synthetic-lineage', 'x-amz-checksum-sha256': 'known-wrong-header' },
      ...(req.operation === 'get' ? { bytes } : {}) };
    mutate?.(result, req); return result;
  } };
}
test('exact byte/lineage ownership permits one delete despite mismatched provider checksum, absence proved twice', async () => {
  const transport = fixture(); const result = await reconcile({ profile, transport });
  assert.equal(result.status, 'VERIFIED_ABSENT'); assert.deepEqual(result.counts, { requests: 5, putAttempts: 0, deleteAttempts: 1 });
  assert.equal(result.releaseQualified, false); assert.equal(result.events[1].nativeChecksum, 'DIFFERS_FROM_EXPECTED');
});
test('HEAD and GET absence requires no delete', async () => {
  const result = await reconcile({ profile, transport: fixture({ absent: true }) });
  assert.equal(result.status, 'VERIFIED_ABSENT'); assert.deepEqual(result.counts, { requests: 2, putAttempts: 0, deleteAttempts: 0 });
});
for (const [name, mutate] of [
  ['wrong bytes', (r, q) => { if (q.operation === 'get') r.bytes = Buffer.alloc(65); }],
  ['wrong lineage', r => r.headers['x-amz-meta-atlas-manual-lineage-sha256'] = 'alien'],
  ['version', r => r.headers['x-amz-version-id'] = 'version'],
  ['length', r => r.headers['content-length'] = '66'],
  ['etag race', (r, q) => { if (q.operation === 'get') r.headers.etag = '"changed"'; }],
]) test(`${name} prevents deletion`, async () => {
  const result = await reconcile({ profile, transport: fixture({ mutate }) });
  assert.equal(result.status, 'RECONCILIATION_REQUIRED'); assert.equal(result.counts.deleteAttempts, 0);
});
test('unknown delete is never retried', async () => {
  const transport = fixture({ unknownDelete: true }); const result = await reconcile({ profile, transport });
  assert.equal(result.status, 'RECONCILIATION_REQUIRED'); assert.equal(result.counts.deleteAttempts, 1); assert.equal(transport.calls.length, 3);
});
