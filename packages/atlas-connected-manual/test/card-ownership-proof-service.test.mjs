import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnershipProofService } from '../src/card-ownership-proof-service.mjs';
import { plan, validation, found, now, ids } from './fixtures/card-ownership-proof-fixtures.mjs';
const bytes = Buffer.from('synthetic private proof'), data = { bundleId: ids.bundleId, objectId: ids.objectId };
const refuse = (promise, code) => assert.rejects(promise, e => e.code === code);
function fixture({ onRead, onSign, onValidate, onRetain } = {}) {
  const p = plan(bytes), calls = [], retained = []; let reads = 0;
  const gateway = { async readPlan(cookie, csrf, input) {
    calls.push('auth'); assert.equal(cookie, 'private-cookie'); assert.equal(csrf, 'private-csrf'); assert.deepEqual(input, data);
    return structuredClone(onRead?.(++reads, p) ?? p);
  }, async retainObject(cookie, csrf, input, observation) {
    calls.push('retain'); assert.equal(cookie, 'private-cookie'); assert.equal(csrf, 'private-csrf'); assert.deepEqual(input, data);
    retained.push(structuredClone(observation)); return onRetain?.(observation) ?? observation;
  } };
  const storage = { async signUpload() { calls.push('sign'); onSign?.(); return { schema: 'atlas-ownership-proof-put-v2', ...data,
    planHash: p.planHash, byteCount: p.byteCount, sha256: p.sha256, url: 'private-capability' }; },
  async readOriginal() { calls.push('read'); return found(p, bytes); } };
  const validator = { async validate(args) { calls.push('validate'); onValidate?.(args); return validation(p); } };
  return { calls, retained, service: createOwnershipProofService({ gateway, storage, validator, now: () => now }) };
}
test('complete fences live source before/after read+decode+atomic adoption, never claims ownership or exposes storage', async () => {
  const f = fixture(), result = await f.service.complete('private-cookie', 'private-csrf', data);
  assert.deepEqual(f.calls, ['auth', 'read', 'auth', 'validate', 'auth', 'retain', 'auth']);
  assert.equal(result.state, 'RETAINED'); assert.equal(result.sha256, plan(bytes).sha256);
  assert.equal(f.retained.length, 1); assert.equal(f.retained[0].validation.originalSha256, result.sha256);
  assert.equal(result.accountId, ids.accountId); assert.ok(!('object' in result) && !('ownership' in result));
  assert.deepEqual(Object.keys(f.service), ['sign', 'complete']);
});
test('no customer observation/account/key accepted and CSRF required before I/O', async () => {
  const f = fixture();
  await refuse(f.service.complete('private-cookie', 'private-csrf', { ...data, observation: {} }), 'INVALID_OWNERSHIP_PROOF');
  await refuse(f.service.complete('private-cookie', '', data), 'CSRF_REQUIRED'); assert.equal(f.calls.length, 0);
});
test('sign response carries only the refreshed server account identity', async () => {
  const f = fixture(), result = await f.service.sign('private-cookie', 'private-csrf', data);
  assert.equal(result.accountId, ids.accountId); assert.equal(result.objectId, ids.objectId);
  assert.deepEqual(f.calls, ['auth', 'sign', 'auth']);
});
test('sign refreshes authority and changed account, approval, policy or expiry cannot expose URL', async () => {
  for (const change of [{ accountId: '20000000-0000-4000-8000-000000000001' }, { approvalActionId: '20000000-0000-4000-8000-000000000002' },
    { policyRevision: 2 }, { uploadPolicyRevision: 2 }]) {
    const f = fixture({ onRead: n => n === 2 ? plan(bytes, change) : undefined });
    await refuse(f.service.sign('private-cookie', 'private-csrf', data), 'OWNERSHIP_PROOF_SOURCE_CHANGED');
    assert.deepEqual(f.calls, ['auth', 'sign', 'auth']);
  }
});
test('revocation at every external wait refuses emission/adoption; final SQL remains authoritative', async () => {
  for (const at of [2, 3, 4]) {
    const f = fixture({ onRead: n => { if (n === at) throw Object.assign(Error('revoked'), { code: 'SIGN_IN_REQUIRED' }); } });
    await refuse(f.service.complete('private-cookie', 'private-csrf', data), 'SIGN_IN_REQUIRED');
    assert.equal(f.retained.length, at === 4 ? 1 : 0);
  }
  const f = fixture({ onRetain: () => { throw Object.assign(Error('expiry after lock'), { code: 'SIGN_IN_REQUIRED' }); } });
  await refuse(f.service.complete('private-cookie', 'private-csrf', data), 'SIGN_IN_REQUIRED');
  assert.equal(f.calls.filter(x => x === 'retain').length, 1);
});
test('decoder source mutation is rejected, owned byte buffer wiped; no retry after unknown CAS', async () => {
  let owned;
  const bad = fixture({ onValidate: ({ bytes }) => { owned = bytes; bytes[0] ^= 1; } });
  await refuse(bad.service.complete('private-cookie', 'private-csrf', data), 'OWNERSHIP_PROOF_VALIDATOR_RESPONSE_INVALID');
  assert.ok(owned.every(x => x === 0)); assert.equal(bad.retained.length, 0);
  const unknown = fixture({ onRetain: () => { throw Object.assign(Error('unknown'), { code: 'DB_OUTCOME_UNKNOWN' }); } });
  await refuse(unknown.service.complete('private-cookie', 'private-csrf', data), 'DB_OUTCOME_UNKNOWN');
  assert.equal(unknown.calls.filter(x => x === 'retain').length, 1);
});
test('cancelled operation starts no read and expired plan cannot reach storage', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await refuse(f.service.complete('private-cookie', 'private-csrf', data, { signal: controller.signal }), 'OWNERSHIP_PROOF_CANCELLED');
  assert.equal(f.calls.length, 0);
  const expired = fixture({ onRead: () => plan(bytes, { expiresAt: new Date(now).toISOString() }) });
  await refuse(expired.service.complete('private-cookie', 'private-csrf', data), 'OWNERSHIP_PROOF_PLAN_EXPIRED'); assert.deepEqual(expired.calls, ['auth']);
});
