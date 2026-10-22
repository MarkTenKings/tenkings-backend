import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
import { createCollectionPreferencesHandler } from '../lib/server/collection-preferences-http.mjs';
import { createPreferenceFixture, prefId, AID, CID } from './collection-preferences-fixture.mjs';

const path = '/api/customer/collection/preferences';
const save = (patch = {}) => ({ requestId: prefId(80), expectedPreferenceRevision: 0, visibility: 'PRIVATE', offersDisabled: true, ...patch });
function fixture(enabled = true) {
  const f = createPreferenceFixture(), guard = f.state.assertRequest;
  f.admissions = 0;
  f.state.assertRequest = req => { f.admissions++; return guard(req); };
  f.state.clientAddress = () => { assert.fail('Preference routes must not reach the general customer gateway'); };
  f.state.collectionPreferences = { handler: enabled ? createCollectionPreferencesHandler(f.options) : null };
  f.handler = createHandler(f.state);
  return f;
}

test('customer catch-all mounts only the scoped preferences handler, with one signed admission', async () => {
  const f = fixture();
  const current = await f.invoke();
  assert.equal(current.code, 200); assert.equal(current.value.accountId, AID);
  const input = save();
  const written = await f.invoke({ method: 'POST', body: input });
  assert.equal(written.code, 200); assert.deepEqual(written.value.receipt.input, input);
  const recovered = await f.invoke({ path: `/api/customer/collection/preference-requests/${input.requestId}` });
  assert.deepEqual(recovered.value.receipt, written.value.receipt);
  const card = await f.invoke({ path: `/api/customer/collection/cards/${CID}/preferences` });
  assert.equal(card.code, 200); assert.equal(card.value.cardPreferences.cardId, CID);
  assert.equal(f.admissions, 4); assert.equal(f.records.size, 1);
  assert.match(current.headers['cache-control'], /private, no-store/);
});

test('disabled preferences and invalid route/method cannot reach a broad writer or database', async () => {
  const disabled = fixture(false), response = await disabled.invoke();
  assert.equal(response.code, 503); assert.equal(disabled.stats.begins, 0);
  for (const request of [
    { path: path + '?accountId=' + AID },
    { method: 'DELETE' },
    { method: 'POST', path: `/api/customer/collection/preference-requests/${prefId(80)}`, body: save() },
    { method: 'POST', body: { ...save(), action: 'propose_transfer' } },
    { method: 'POST', body: save(), signed: false },
  ]) {
    const f = fixture(), result = await f.invoke(request);
    assert(result.code >= 400); assert.equal(f.stats.begins, 0); assert.equal(f.records.size, 0);
  }
});

test('routed postcommit access loss stays uncertain; exact historical recovery never adds another save', async () => {
  const f = fixture(), input = save();
  f.afterCommit = async () => { if (f.records.size) { f.afterCommit = null; f.liveAccount = null; } };
  const lost = await f.invoke({ method: 'POST', body: input });
  assert.equal(lost.code, 401); assert.equal(f.records.size, 1);
  assert.deepEqual(lost.value, { error: 'PREFERENCES_ACCESS_ENDED' });
  f.liveAccount = AID;
  const recovered = await f.invoke({ path: `/api/customer/collection/preference-requests/${input.requestId}` });
  assert.equal(recovered.code, 200); assert.deepEqual(recovered.value.receipt.input, input);
  const repeated = await f.invoke({ method: 'POST', body: input });
  assert.deepEqual(repeated.value.receipt, recovered.value.receipt); assert.equal(f.records.size, 1);
});
