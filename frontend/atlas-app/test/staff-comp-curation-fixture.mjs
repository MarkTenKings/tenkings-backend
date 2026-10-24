// Synthetic in-memory boundary/artifacts only; runs the existing service unchanged.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
import { publishedResearchQuery } from '../../../packages/atlas-connected-manual/src/research-market-query.mjs';
import { createPresentationMarket, marketPreviewHash, publishedMarketQuery } from '../../../packages/atlas-connected-manual/src/presentation-market.mjs';
import { createCompCurationService } from '../../../packages/atlas-connected-manual/src/comp-curation-service.mjs';
import { COMP_CURATION_METHOD, compCurationPolicy } from '../../../packages/atlas-connected-manual/src/comp-curation-contract.mjs';
import { createStaffCompCurationHandler } from '../lib/server/staff-comp-curation-http.mjs';

const policy = { version: 'atlas-comp-curation-policy-v1', status: 'LOCAL_PROPOSAL', method: COMP_CURATION_METHOD, recencyDays: 90, rightsStatus: 'UNRESOLVED' };
const now = '2026-10-21T12:00:00.000Z';
export async function curationFixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const approved = { async loadPacket() { await hooks.artifact?.(); return { packet, publicHash: f.row.public_hash, row: structuredClone(f.row) }; } };
  const previewId = randomUUID(), preview = { version: 'atlas-market-preview-v1', ...publishedResearchQuery({ packet, publicHash: f.row.public_hash }),
    source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0', retrievedAt: '2026-10-20T12:00:00.000Z', candidates: [1000, 2001, 3000].map((priceMinor, i) => ({
      match: 'MATCH', sale: { id: `ebay:${123456789000 + i}`, title: '2026 Fixture Local only Synthetic report PSA 9',
        listingUrl: `https://www.ebay.com/itm/${123456789000 + i}`, soldAt: '2026-10-19T12:00:00.000Z', identityStatus: 'MATCH',
        priceBasis: 'sold', priceMinor, currency: 'USD', raw: false, grader: 'PSA', grade: '9', designation: 'STANDARD' } })) };
  const hooks = {}, rows = [], card = { id: f.cardId, owner_id: f.actorId, approvers: [], editors: [], readers: [] };
  const principal = { id: f.actorId, role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, staff = { id: f.actorId, role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, calls = { insert: 0, artifact: 0, access: 0, refresh: 0 };
  const request = canonical({ requestId: previewId, approvalActionId: f.actionId, expectedRevision: 0 });
  const market = { card_id: f.cardId, approval_action_id: f.actionId, request_id: previewId, state: 'READY', request, request_hash: digest(request) };
  const ref = { kind: 'MARKET_PREVIEW', syntheticOnly: true };
  function savePreview() { market.result = canonical({ state: 'READY', ref, artifactHash: digest(JSON.stringify(preview)), sourceHash: marketPreviewHash(preview) }); market.result_hash = digest(market.result); }
  savePreview();
  const tx = {
    async $queryRawUnsafe(sql, ...args) {
      if (sql.includes('curation:card')) { await hooks.lock?.(); return [structuredClone(card)]; }
      if (sql.includes('curation:publication')) return [structuredClone(f.row)];
      if (sql.includes('curation:latest')) return rows.filter(row => row.approval_action_id === args[1]).slice(-1);
      if (sql.includes('curation:market')) return [structuredClone(market)];
      if (sql.includes('curation:replay')) { await hooks.replay?.(); return rows.filter(row => row.request_id === args[1]); }
      assert.fail(`Unexpected query: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...args) {
      assert.match(sql, /curation:insert/); calls.insert++;
      rows.push(Object.fromEntries(['card_id','approval_action_id','revision','request_id','actor_id','request','request_hash','binding','binding_hash','source','source_hash','selected_facts','selected_facts_hash','receipt','receipt_hash'].map((key, i) => [key, args[i]])));
      return 1;
    },
  };
  const boundary = { async transaction(value, work) {
    requireThat(value === staff, 401, 'SIGN_IN_REQUIRED');
    const refresh = async () => { calls.refresh++; await hooks.refresh?.(); return { principal: structuredClone(principal), now: new Date(now) }; };
    const before = rows.length;
    try { const result = await work({ tx, ...await refresh(), refresh }); await refresh(); return result; }
    catch (error) { rows.splice(before); throw error; }
  } };
  const artifacts = { async read(actualRef, expected) { calls.artifact++; assert.deepEqual(actualRef, ref); assert.equal(expected.cardId, f.cardId);
    assert.equal(expected.kind, 'MARKET_PREVIEW'); assert.equal(expected.sourceHash, JSON.parse(market.result).artifactHash); return structuredClone(preview); } };
  const validateAccess = async () => { calls.access++; await hooks.access?.(); };
  const options = { boundary, approved, artifacts, validateAccess, policy }, service = createCompCurationService(options);
  const input = (overrides = {}) => ({ requestId: randomUUID(), approvalActionId: f.actionId, expectedSelectionRevision: rows.length, previewId,
    expectedPreviewHash: marketPreviewHash(preview), outcome: 'SELECTED', selectedIds: preview.candidates.map(row => row.sale.id),
    reviewedIds: preview.candidates.map(row => row.sale.id), expectedPolicyHash: compCurationPolicy(policy).hash, ...overrides });
  return { ...f, staff, hooks, principal, card, rows, market, preview, savePreview, calls, options, service, input, previewId, packet };
}

export async function httpFixture({ policyDisabled = false, selectionPolicy = null, designationReviewsEnabled = false } = {}) {
  const f = await curationFixture();
  let actor = f.staff, authCalls = 0, guardCalls = 0;
  const auth = { async authenticate(cookie, csrf) {
    authCalls++; await f.hooks.auth?.(authCalls);
    requireThat(cookie === 'fixture=session' && actor, 401, 'SIGN_IN_REQUIRED');
    if (csrf !== undefined) requireThat(csrf === 'fixture-csrf', 403, 'CSRF_REQUIRED');
    return actor;
  } };
  const service = policyDisabled || selectionPolicy !== null ? createCompCurationService({ ...f.options, policy: null, selectionPolicy, designationReviewsEnabled }) : f.service;
  const options = { auth, service, designationReviewsEnabled, origin: 'http://127.0.0.1:4318', assertRequest() { guardCalls++; f.hooks.ingress?.(); } };
  const handler = createStaffCompCurationHandler(options);
  const exchanges = [];
  async function request({ method, path, body, signal }, change = {}) {
    const req = { method, url: path, headers: { cookie: 'fixture=session', ...(method === 'POST' ? {
      origin: options.origin, 'content-type': 'application/json', 'x-atlas-csrf': 'fixture-csrf', 'sec-fetch-site': 'same-origin' } : {}) },
      body: method === 'GET' ? '' : body, ...change };
    let status = 200, payload; const headers = new Headers({ 'content-type': 'application/json' });
    const res = { setHeader(k, v) { headers.set(k, v); }, status(v) { status = v; return this; }, json(v) { payload = v; } };
    await handler(req, res); exchanges.push({ method, path, body, status, payload });
    await f.hooks.response?.({ method, path, payload, signal });
    return new Response(JSON.stringify(payload), { status, headers });
  }
  const readInput = { approvalActionId: f.actionId, previewId: f.previewId };
  const readPath = `/api/staff/comp-curation/cards/${f.cardId}?approvalActionId=${f.actionId}&previewId=${f.previewId}`;
  return { ...f, service, options, handler, request, exchanges, readInput, readPath, decisionPath: `/api/staff/comp-curation/cards/${f.cardId}/decision`,
    setActor(value) { actor = value; }, get authCalls() { return authCalls; }, get guardCalls() { return guardCalls; } };
}
export function realSavedV2(f) {
  const source = { packet: f.packet, publicHash: f.row.public_hash }, context = publishedMarketQuery(source);
  const items = ['SLABBED', 'RAW'].map((kind, i) => ({ id: `saved-v2:${i}`, title: `SYNTHETIC original ${kind} sale`,
    listingUrl: `https://www.ebay.com/itm/${123456789100 + i}`, imageUrl: null, soldDate: '2026-10-19', soldPriceCents: 1000 + i, currency: 'USD', priceBasis: 'EXACT' }));
  const saved = createPresentationMarket().project(source, { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0',
    query: context.query, retrievedAt: '2026-10-20T12:00:00.000Z', items, acquisitionDiagnostics: { returnedItemCount: 2 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {}, readings: items.map((item, i) => ({ rowId: item.id,
      evidenceKind: i === 0 ? 'SLABBED' : 'RAW', identityMatch: 'MATCH', numericGrade: i === 0 ? 9 : null, gradingCompany: i === 0 ? 'PSA' : null,
      labelText: null, sha256: null, reason: 'SYNTHETIC qualification only' })) } });
  for (const key of Object.keys(f.preview)) delete f.preview[key]; Object.assign(f.preview, saved.preview); f.savePreview();
}
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
export const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
