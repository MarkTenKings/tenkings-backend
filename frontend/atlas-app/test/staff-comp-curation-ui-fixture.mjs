// Synthetic fixture only. Actual saved-market service, curation service,
// HTTP adapter and browser parsers; no database, network, provider or storage.
import assert from 'node:assert/strict';
import { createPresentationMarketService } from '../../../packages/atlas-connected-manual/src/presentation-market-service.mjs';
import { httpFixture, jsonResponse } from './staff-comp-curation-fixture.mjs';
export { deferred, realSavedV2 } from './staff-comp-curation-fixture.mjs';
export async function compUIFixture(options) {
  const f = await httpFixture(options), traffic = [], metadataHooks = {};
  const state = await f.service.read(f.staff, f.cardId, f.readInput);
  const b = state.binding;
  const card = { cardId: f.cardId, approvalActionId: f.actionId, mode: f.staff.mode, sourceRevision: b.sourceRevision, sourceHash: b.sourceHash,
    report: { state: 'PUBLISHED', publicToken: b.publicToken, version: b.publicVersion, publicHash: b.publicHash, reportHash: b.reportHash } };
  let actor = f.staff, pool = true;
  const saved = createPresentationMarketService({ repository: {
    async latestMarket(staff, cardId) { assert.equal(staff, f.staff); assert.equal(cardId, f.cardId); return pool ? f.previewId : null; },
    async market(staff, cardId, previewId) { assert.equal(staff, f.staff); assert.equal(cardId, f.cardId); assert.equal(previewId, f.previewId);
      return { state: f.market.state, input: JSON.parse(f.market.request), saved: JSON.parse(f.market.result) }; },
  }, artifacts: { async read(ref, expected) {
    const record = JSON.parse(f.market.result); assert.deepEqual(ref, record.ref); assert.equal(expected.sourceHash, record.artifactHash);
    return structuredClone(f.preview);
  } } });
  const statusPath = `/api/staff/manual-connected/cards/${f.cardId}/presentation/market`;
  async function request(input) {
    traffic.push({ method: input.method, path: input.path, body: input.body, signal: input.signal });
    if (input.path === '/api/staff/session') {
      assert.equal(input.method, 'GET'); await metadataHooks.session?.(); return jsonResponse({ staff: actor }, actor ? 200 : 401);
    }
    if (input.path === statusPath) {
      assert.equal(input.method, 'GET'); await metadataHooks.status?.();
      return jsonResponse(metadataHooks.payload ? await metadataHooks.payload() : await saved.status(f.staff, f.cardId));
    }
    assert.ok(input.path.startsWith(`/api/staff/comp-curation/cards/${f.cardId}`)); return f.request(input);
  }
  return { ...f, card, request, statusPath, traffic, metadataHooks,
    setPool(value) { pool = value; }, setSession(value) { actor = value; f.setActor(value); } };
}
export async function flush() { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); }
