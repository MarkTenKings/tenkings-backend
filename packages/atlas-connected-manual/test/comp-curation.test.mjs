import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { publicationFixture } from './publication-fixture.mjs';
import { publishedResearchQuery } from '../src/research-market-query.mjs';
import { createPresentationMarket, marketPreviewHash, publishedMarketQuery } from '../src/presentation-market.mjs';
import { createCompCurationService, compCurationGrantSQL } from '../src/comp-curation-service.mjs';
import { COMP_CURATION_METHOD, compCurationInput, compCurationPolicy } from '../src/comp-curation-contract.mjs';

const policy = { version: 'atlas-comp-curation-policy-v1', status: 'LOCAL_PROPOSAL', method: COMP_CURATION_METHOD, recencyDays: 90, rightsStatus: 'UNRESOLVED' };
const now = '2026-10-21T12:00:00.000Z';
async function fixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const manifest = JSON.parse(f.row.manifest), packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const approved = { async loadPacket() { await hooks.artifact?.(); return { packet, publicHash: f.row.public_hash, row: structuredClone(f.row) }; } };
  const previewId = randomUUID(), preview = { version: 'atlas-market-preview-v1', ...publishedResearchQuery({ packet, publicHash: f.row.public_hash }),
    source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0', retrievedAt: '2026-10-20T12:00:00.000Z', candidates: [1000, 2001, 3000].map((priceMinor, i) => ({
      match: 'MATCH', sale: { id: `ebay:${123456789000 + i}`, title: '2026 Fixture Local only Synthetic report PSA 9',
        listingUrl: `https://www.ebay.com/itm/${123456789000 + i}`, soldAt: '2026-10-19T12:00:00.000Z', identityStatus: 'MATCH',
        priceBasis: 'sold', priceMinor, currency: 'USD', raw: false, grader: 'PSA', grade: '9', designation: 'STANDARD' } })) };
  const hooks = {}, rows = [], card = { id: f.cardId, owner_id: f.actorId, approvers: [], editors: [], readers: [] };
  const principal = { id: f.actorId, role: 'REVIEWER', mode: 'LOCAL_FIXTURE' }, staff = {}, calls = { insert: 0, artifact: 0, access: 0, refresh: 0 };
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

test('private saved evidence selection binds immutable approval, facts, policy and integer arithmetic; no protected mutation', async () => {
  const f = await fixture(), before = canonical({ publication: f.row, market: f.market, packet: f.packet });
  const read = await f.service.read(f.staff, f.cardId, { approvalActionId: f.actionId, previewId: f.previewId });
  assert.equal(read.availability, 'READY'); assert.equal(read.revision, 0); assert.equal(read.preview.candidates.length, 3);
  const result = await f.service.decide(f.staff, f.cardId, f.input());
  assert.equal(result.guidance.meanMinor, 2000); assert.equal(result.guidance.sumMinor, 6001); assert.equal(result.guidance.sampleCount, 3);
  assert.equal(result.guidance.askingPriceMinor, null); assert.equal(result.guidance.listingPrice, null);
  assert.equal(result.visibility, 'PRIVATE_INTERNAL'); assert.equal(result.policy.rightsStatus, 'UNRESOLVED'); assert.equal(result.status, 'LOCAL_PROPOSAL');
  assert.equal(result.binding.sourceHash, f.row.source_hash); assert.equal(result.binding.reportHash, f.row.report_hash);
  assert.equal(result.source.previewHash, marketPreviewHash(f.preview)); assert.equal(result.selectedFactsHash, digest(canonical(result.selected)));
  assert.equal(result.revision, 1); assert.equal(f.calls.insert, 1); assert(f.calls.access >= 4);
  assert.equal(canonical({ publication: f.row, market: f.market, packet: f.packet }), before);
});
test('Skip and No suitable are honest no-pool decisions with null guidance and no provider capability', async () => {
  const f = await fixture(), service = createCompCurationService({ ...f.options, policy: null });
  for (const outcome of ['SKIP', 'NO_SUITABLE_COMPS']) {
    const result = await service.decide(f.staff, f.cardId, f.input({ outcome, previewId: null, expectedPreviewHash: null,
      expectedPolicyHash: null, selectedIds: [], reviewedIds: [] }));
    assert.equal(result.sourceStatus, 'NO_SAVED_POOL'); assert.equal(result.guidance, null); assert.equal(result.policy, null); assert.deepEqual(result.selected, []);
  }
  assert.equal(f.calls.artifact, 0); assert.deepEqual(Object.keys(service).sort(), ['decide', 'read']);
  const state = await service.read(f.staff, f.cardId, { approvalActionId: f.actionId, previewId: null });
  assert.equal(state.availability, 'NO_SAVED_POOL'); assert.equal(state.revision, 2);
  assert.equal((await service.read(f.staff, f.cardId, { approvalActionId: f.actionId, previewId: f.previewId })).availability, 'POLICY_REQUIRED');
});
test('strict request never accepts client prices, actor, policy or clock; selected bounds and human review are mandatory', async () => {
  const f = await fixture();
  for (const extra of [{ actorId: f.actorId }, { selectedFacts: [] }, { asOf: now }, { policy }, { priceMinor: 1 }]) assert.throws(() => compCurationInput(f.input(extra)));
  for (const change of [{ selectedIds: [] }, { reviewedIds: [] }, { selectedIds: ['x','x'], reviewedIds: ['x','x'] },
    { selectedIds: ['1','2','3','4','5','6'], reviewedIds: ['1','2','3','4','5','6'] }, { previewId: null, expectedPreviewHash: null }]) assert.throws(() => compCurationInput(f.input(change)));
  assert.throws(() => createCompCurationService({ ...f.options, validateAccess: undefined }), { code: 'COMP_CURATION_CONFIGURATION_INVALID' });
  assert.match(compCurationGrantSQL('atlas_fixture_manual'), /^GRANT SELECT,INSERT ON atlas_manual.comp_curation /);
  for (const role of ['public', 'pg_read_all_data', 'x;DROP TABLE x']) assert.throws(() => compCurationGrantSQL(role));
});
test('real current slab projector and saved v2 artifact retain missing designation: graded guidance unavailable, raw remains separate', async () => {
  const f = await fixture(), source = { packet: f.packet, publicHash: f.row.public_hash }, context = publishedMarketQuery(source);
  const items = ['SLABBED', 'RAW'].map((kind, i) => ({ id: `saved-v2:${i}`, title: `SYNTHETIC original ${kind} sale`,
    listingUrl: `https://www.ebay.com/itm/${123456789100 + i}`, imageUrl: null, soldDate: '2026-10-19',
    soldPriceCents: 1000 + i, currency: 'USD', priceBasis: 'EXACT' }));
  const saved = createPresentationMarket().project(source, { responsePolicy: 'ATLAS_SLAB_V1', source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0',
    query: context.query, retrievedAt: '2026-10-20T12:00:00.000Z', items, acquisitionDiagnostics: { returnedItemCount: 2 },
    imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {}, readings: items.map((item, i) => ({ rowId: item.id,
      evidenceKind: i === 0 ? 'SLABBED' : 'RAW', identityMatch: 'MATCH', numericGrade: i === 0 ? 9 : null,
      gradingCompany: i === 0 ? 'PSA' : null, labelText: null, sha256: null, reason: 'SYNTHETIC qualification only' })) } });
  for (const key of Object.keys(f.preview)) delete f.preview[key]; Object.assign(f.preview, saved.preview); f.savePreview();
  const state = await f.service.read(f.staff, f.cardId, { approvalActionId: f.actionId, previewId: f.previewId });
  const graded = state.preview.candidates.find(row => !row.raw), raw = state.preview.candidates.find(row => row.raw);
  assert.equal(graded.designation, null); assert.equal(graded.eligible, false); assert(graded.reasonCodes.includes('GRADE_DESIGNATION_UNCONFIRMED'));
  await assert.rejects(f.service.decide(f.staff, f.cardId, f.input({ selectedIds: [graded.id], reviewedIds: [graded.id] })), { code: 'COMP_SELECTION_INELIGIBLE' });
  assert.equal(raw.eligible, true);
  const selected = await f.service.decide(f.staff, f.cardId, f.input({ selectedIds: [raw.id], reviewedIds: [raw.id] }));
  assert.equal(selected.guidance.group, 'RAW / condition unverified'); assert.equal(selected.guidance.meanMinor, 1001);
});
test('accepted unknown amounts, stale sales, unknown identity/designation and duplicate eBay aliases cannot contribute', async () => {
  for (const alter of [p => { p.candidates[0].sale.priceBasis = 'accepted_offer_unknown'; }, p => { p.candidates[0].sale.soldAt = '2020-01-01T00:00:00.000Z'; },
    p => { p.candidates[0].match = 'UNKNOWN'; }, p => { p.candidates[0].sale.designation = null; },
    p => { p.candidates[1].sale.listingUrl = 'https://www.ebay.co.uk/itm/other-slug/123456789000?x=1'; }]) {
    const f = await fixture(); alter(f.preview); f.savePreview();
    await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code: 'COMP_SELECTION_INELIGIBLE' }); assert.equal(f.rows.length, 0);
  }
});
test('raw/graded, grader, designation and currency groups are never averaged together; half minor units round up', async () => {
  for (const [alter, code] of [[p => { p.candidates[0].sale.grader = 'SGC'; }, 'COMP_GRADE_GROUP_MIXED'],
    [p => { p.candidates[0].sale.currency = 'CAD'; }, 'COMP_CURRENCY_MIXED'],
    [p => Object.assign(p.candidates[0].sale, { raw: true, grader: null, grade: null, designation: null }), 'COMP_GRADE_GROUP_MIXED']]) {
    const f = await fixture(); alter(f.preview); f.savePreview(); await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code });
  }
  const f = await fixture(), ids = f.preview.candidates.slice(0, 2).map(row => row.sale.id);
  assert.equal((await f.service.decide(f.staff, f.cardId, f.input({ selectedIds: ids, reviewedIds: ids }))).guidance.meanMinor, 1501);
});
test('same actor exact retry returns original receipt after reauthorization without artifact work; changed payload/actor denied', async () => {
  const f = await fixture(), input = f.input(), saved = await f.service.decide(f.staff, f.cardId, input), reads = f.calls.artifact, refreshes = f.calls.refresh;
  f.hooks.artifact = () => assert.fail('Replay must not reread or recompute saved evidence');
  assert.deepEqual(await f.service.decide(f.staff, f.cardId, { ...input, selectedIds: [...input.selectedIds].reverse() }), saved);
  assert.equal(f.calls.artifact, reads); assert(f.calls.refresh > refreshes); assert.equal(f.rows.length, 1);
  await assert.rejects(f.service.decide(f.staff, f.cardId, { ...input, outcome: 'SKIP', selectedIds: [], reviewedIds: [] }), { code: 'COMP_REQUEST_CONFLICT' });
  f.principal.id = randomUUID(); f.card.approvers.push(f.principal.id);
  await assert.rejects(f.service.decide(f.staff, f.cardId, input), { code: 'COMP_REQUEST_CONFLICT' });
});
test('replay must retain current ACL and latest published approval; missing or expired auth never returns cached receipt', async () => {
  const f = await fixture(), input = f.input(); await f.service.decide(f.staff, f.cardId, input);
  f.card.owner_id = randomUUID(); await assert.rejects(f.service.decide(f.staff, f.cardId, input), { code: 'MANUAL_CARD_NOT_FOUND' }); f.card.owner_id = f.actorId;
  f.row.action_id = randomUUID(); await assert.rejects(f.service.decide(f.staff, f.cardId, input), { code: 'COMP_APPROVAL_STALE' }); f.row.action_id = f.actionId;
  f.hooks.replay = () => { f.hooks.refresh = () => requireThat(false, 401, 'SIGN_IN_REQUIRED'); };
  await assert.rejects(f.service.decide(f.staff, f.cardId, input), { code: 'SIGN_IN_REQUIRED' }); assert.equal(f.rows.length, 1);
});
test('expiry, role/account change after card/intake lock and tombstones deny before insert', async () => {
  for (const hook of ['lock', 'access']) {
    const f = await fixture(); f.hooks[hook] = () => { f.principal.id = randomUUID(); };
    await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code: 'SIGN_IN_REQUIRED' }); assert.equal(f.calls.insert, 0);
  }
  const f = await fixture(); f.hooks.access = () => requireThat(false, 410, 'INTAKE_CARD_DISCARDED');
  await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code: 'INTAKE_CARD_DISCARDED' });
  f.hooks.access = () => { f.principal.role = 'OPERATOR'; };
  await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code: 'MANUAL_CARD_ACCESS_DENIED' });
});
test('source/current approval/revision drift between artifact read and commit is rejected', async () => {
  for (const [change, code] of [[f => { f.market.approval_action_id = randomUUID(); }, 'COMP_SAVED_SOURCE_UNAVAILABLE'],
    [f => { f.row.action_id = randomUUID(); }, 'COMP_APPROVAL_SOURCE_MISMATCH'],
    [f => { f.market.request_hash = 'a'.repeat(64); }, 'COMP_CURATION_CORRUPT']]) {
    const f = await fixture(); f.hooks.artifact = () => change(f);
    await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code }); assert.equal(f.rows.length, 0);
  }
  const f = await fixture(); await f.service.decide(f.staff, f.cardId, f.input());
  await assert.rejects(f.service.decide(f.staff, f.cardId, f.input({ expectedSelectionRevision: 0 })), { code: 'COMP_SELECTION_REVISION_STALE' });
});
test('newest publication must itself be published: pending or other state refuses reads, appends and old retries', async () => {
  const f = await fixture(), input = f.input(); await f.service.decide(f.staff, f.cardId, input);
  for (const state of ['PENDING', 'FAILED']) {
    f.row.state = state;
    await assert.rejects(f.service.decide(f.staff, f.cardId, input), { code: 'COMP_APPROVAL_STALE' });
    await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code: 'COMP_APPROVAL_STALE' });
    await assert.rejects(f.service.read(f.staff, f.cardId, { approvalActionId: f.actionId, previewId: f.previewId }), { code: 'COMP_APPROVAL_STALE' });
  }
  assert.equal(f.calls.insert, 1);
});
test('artifact integrity, identity/context, approval report and configured policy hashes are all verified', async () => {
  for (const [change, code] of [[f => { f.preview.candidates[0].sale.priceMinor++; }, 'COMP_SAVED_SOURCE_CORRUPT'],
    [f => { f.preview.query = 'different card'; f.savePreview(); }, 'MARKET_PUBLICATION_MISMATCH'],
    [f => { f.packet.reportHash = 'b'.repeat(64); }, 'COMP_APPROVAL_SOURCE_MISMATCH']]) {
    const f = await fixture(); change(f); await assert.rejects(f.service.decide(f.staff, f.cardId, f.input()), { code });
  }
  const f = await fixture(); await assert.rejects(f.service.decide(f.staff, f.cardId, f.input({ expectedPreviewHash: 'c'.repeat(64) })), { code: 'COMP_SOURCE_CHANGED' });
  await assert.rejects(f.service.decide(f.staff, f.cardId, f.input({ expectedPolicyHash: 'd'.repeat(64) })), { code: 'COMP_POLICY_CHANGED' });
});
test('proposal SQL grants no runtime or public exposure and protects append-only/source/approval bindings', async () => {
  const sql = await readFile(new URL('../sql/comp-curation-proposal.sql', import.meta.url), 'utf8');
  assert.match(sql, /UNREGISTERED LOCAL PROPOSAL/); assert.match(sql, /UNIQUE\(card_id,request_id\)/);
  assert.match(sql, /WHERE pub.card_id=NEW.card_id ORDER BY pub.version DESC/); assert.match(sql, /p.state IS DISTINCT FROM 'PUBLISHED'/);
  assert.match(sql, /Curation saved source mismatch/);
  assert.match(sql, /BEFORE UPDATE OR DELETE/); assert.match(sql, /BEFORE TRUNCATE/); assert.match(sql, /REVOKE ALL ON atlas_manual.comp_curation FROM PUBLIC/);
  assert.doesNotMatch(sql, /GRANT|UPDATE atlas_manual\.(?:publication|presentation|presentation_market)|INSERT INTO atlas_manual\.(?:publication|presentation_market)/);
});
