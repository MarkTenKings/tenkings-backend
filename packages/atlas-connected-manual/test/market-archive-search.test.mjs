import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createMarketArchiveSearchCapability, assertMarketArchiveSearchCapability, ARCHIVE_MARKET_ORIGIN } from '../src/market-archive-search.mjs';
import { createMarketJobStore } from '../src/market-job-store.mjs';
import { createMarketWorker } from '../src/market-worker.mjs';
import { createPresentationMarketService } from '../src/presentation-market-service.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { publicationFixture } from './publication-fixture.mjs';

// Real authority/finishing/reservation/worker modules with a finite SQL adapter.
// SQL semantics/constraints/role privileges are qualified separately in owned PG.
async function fixture({ acl = 'readers' } = {}) {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const actor = { id: randomUUID(), accessVersion: 7, role: 'REVIEWER', mode: f.row.mode, actorKind: 'HUMAN' };
  const card = { id: f.cardId, owner_id: f.actorId, approvers: [], editors: [], readers: [] };
  card[acl].push(actor.id);
  const staff = Object.freeze({}), records = new Map(), jobs = new Map(), sql = [];
  let active = true, refreshes = 0, onRefresh = null, onRead = null, writes = 0, failWrite = false;
  const current = job => active && actor.id === job.actor_id && actor.accessVersion === job.access_version && actor.role === 'REVIEWER'
    && actor.mode === job.mode && [card.owner_id, ...card.approvers, ...card.editors, ...card.readers].includes(job.actor_id)
    && f.row.state === 'PUBLISHED' && f.row.action_id === job.approval_action_id && f.row.source_hash === job.source_hash;
  const tx = {
    async $queryRawUnsafe(query, ...p) {
      sql.push(query);
      if (query.includes('market-archive:card') || query.startsWith('SELECT * FROM atlas_manual.card')) return [structuredClone(card)];
      if (query.includes('market-archive:active')) return active ? [{ id: f.cardId }] : [];
      if (query.includes('market-archive:publication') || query.startsWith('SELECT * FROM atlas_manual.publication')) return [structuredClone(f.row)];
      if (query.includes('market-archive:worker')) { const job = jobs.get(p[0]); return job && job.claim_id === p[1] && current(job) ? [structuredClone(job)] : []; }
      if (query.includes("audit @>")) return [...jobs.values()].filter(j => j.audit.some(a => a.event === 'RECOVERY' && a.requestId === p[2]));
      if (query.includes('m.actor_id request_actor')) { const j = jobs.get(p[0]), m = records.get(p[0]); return j ? [{ ...j, request_actor: m.actor_id, request_hash: m.request_hash }] : []; }
      if (query.startsWith('SELECT request_id FROM atlas_manual.presentation_market')) return records.has(p[1]) ? [{ request_id: p[1] }] : [];
      if (query.startsWith('SELECT state FROM atlas_manual_connected.market_job')) return [...jobs.values()].filter(j => ['QUEUED','RUNNING','REQUESTED','UNKNOWN'].includes(j.state)).slice(0, 1);
      if (query.startsWith('SELECT m.state')) return [];
      if (query.includes('MAX(revision)')) return [{ revision: 0 }];
      if (query.includes("SET state='QUEUED',attempts=0,recoveries=recoveries+1")) {
        const j = jobs.get(p[0]); Object.assign(j, { state: 'QUEUED', attempts: 0, recoveries: j.recoveries + 1 });
        j.audit.push({ event: 'RECOVERY', requestId: p[1], requestHash: p[2], actorId: p[3] }); return [structuredClone(j)];
      }
      if (query.startsWith('SELECT * FROM atlas_manual_connected.market_job')) return query.includes('ORDER BY') ? [...jobs.values()].slice(-1).map(row => structuredClone(row)) : jobs.has(p[0]) ? [structuredClone(jobs.get(p[0]))] : [];
      throw Error(`Unmapped fixture query: ${query.slice(0, 90)}`);
    },
    async $executeRawUnsafe(query, ...p) {
      sql.push(query);
      if (query.startsWith('INSERT INTO atlas_manual.presentation_market')) {
        records.set(p[2], { card_id: p[0], approval_action_id: p[1], request_id: p[2], actor_id: p[3], request: p[4], request_hash: p[5], state: 'STARTED' }); return 1;
      }
      if (query.includes('market-archive:insert')) {
        jobs.set(p[0], { request_id: p[0], card_id: p[1], approval_action_id: p[2], actor_id: p[3], access_version: p[4], mode: p[5],
          origin: ARCHIVE_MARKET_ORIGIN, source_hash: p[6], report_hash: p[7], archive_authority: p[8], archive_authority_hash: p[9],
          state: 'QUEUED', public_hash: null, response: null, response_hash: null, dispatch_id: null, audit: [], attempts: 0, recoveries: 0,
          created_at: new Date().toISOString() }); return 1;
      }
      throw Error(`Unmapped fixture write: ${query.slice(0, 90)}`);
    },
  };
  const boundary = {
    async transaction(handle, work) { assert.equal(handle, staff); const principal = structuredClone(actor);
      return work({ tx, principal, async refresh() { refreshes++; onRefresh?.(refreshes); return { principal: structuredClone(actor) }; } }); },
    async machineTransaction(owner, work) { assert.equal(owner, null); return work({ tx, principal: { mode: actor.mode } }); },
  };
  const artifacts = { ...f.artifacts, async read(...args) { const value = await f.artifacts.read(...args); onRead?.(); return value; },
    async write(...args) { writes++; if (failWrite) { failWrite = false; throw Error('Synthetic artifact unavailable'); } return f.artifacts.write(...args); } };
  const validateAccess = async () => { if (!active) throw Object.assign(Error('deleted'), { code: 'INTAKE_CARD_DELETED' }); };
  const cap = createMarketArchiveSearchCapability({ boundary, artifacts, validateAccess });
  const store = createMarketJobStore({ boundary, validateAccess, archiveSearch: cap });
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0 };
  const reserve = (value = input) => store.reserve(staff, f.cardId, value, { archive: true });
  return { f, actor, card, staff, boundary, artifacts, validateAccess, cap, store, input, reserve, jobs, records, sql, current,
    setActive(value) { active = value; }, onRefresh(value) { onRefresh = value; }, onRead(value) { onRead = value; },
    failWrite() { failWrite = true; }, writes: () => writes };
}
async function workerFixture(options = {}) {
  const f = await fixture(); await f.reserve(); let providerCalls = 0, forbiddenCalls = 0, labels = 0;
  const row = f.jobs.get(f.input.requestId), before = structuredClone(f.f.row);
  const context = publishedMarketQuery(await f.cap.approved.loadPacket(f.staff, f.f.cardId, f.f.actionId));
  const store = { archiveSearch: f.cap,
    async claim() { if (row.state !== 'QUEUED') return null; row.state = 'RUNNING'; row.claim_id = randomUUID(); row.attempts++; return { ...structuredClone(row), response: row.response ? JSON.parse(row.response) : null }; },
    async renew() { return f.current(row); },
    async bind(job, source) { if (!f.current(row)) return false; assert.equal(source.publicHash, f.f.row.public_hash); row.public_hash = source.publicHash; return true; },
    async dispatch() { if (!f.current(row)) return false; assert.equal(row.response, null); row.state = 'REQUESTED'; row.dispatch_id = row.claim_id; return true; },
    async recordResponse(job, response) { row.response = canonical(response); row.response_hash = digest(row.response); return true; },
    async finish(job, result) { if (!f.current(row)) return false; row.state = result.result ? 'READY' : result.disposition === 'RETRY' ? 'QUEUED' : result.disposition; row.result = result.result; row.code = result.code; return true; },
  };
  const forbidden = () => { forbiddenCalls++; throw Error('Publication authority must not be entered'); };
  const worker = createMarketWorker({ store, archiveSearch: options.noCapability ? null : f.cap, artifacts: f.artifacts,
    approved: { loadPacket: forbidden }, publication: { publish: forbidden }, authorityFor: forbidden,
    provider: async () => { providerCalls++; if (options.unknown) throw Error('Unknown dispatch'); return { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
      query: context.query, offset: 0, nextOffset: 0, requestedResultCount: 240, hasMore: false, responsePolicy: 'ATLAS_SLAB_V1', items: [], retrievedAt: new Date().toISOString(), acquisitionDiagnostics: { returnedItemCount: 0, retainedItemCount: 0, missingImageCount: 0 } }; },
    labelMarket: async ({ response }) => { labels++; return { ...response, imageMatch: { policy: 'atlas-market-slab-label-v1', counts: {}, readings: [] } }; },
  });
  return { ...f, row, before, worker, calls: () => providerCalls, forbiddenCalls: () => forbiddenCalls, labels: () => labels };
}

test('cold branded archive capability admits actual reviewer reader/editor with exact durable replay', async () => {
  for (const acl of ['readers','editors']) {
    const f = await fixture({ acl }); assert.equal(f.sql.length, 0);
    const first = await f.reserve(), second = await f.reserve(); assert.deepEqual(Object.fromEntries(Object.entries(second).filter(([key]) => !['request_actor','request_hash'].includes(key))), first);
    const value = JSON.parse(first.archive_authority);
    assert.equal(first.actor_id, f.actor.id); assert.notEqual(first.actor_id, f.card.owner_id);
    assert.equal(value.accessVersion, 7); assert.equal(value.manifestHash, f.f.row.manifest_hash);
    assert.equal(value.publicHash, f.f.row.public_hash); assert.equal(value.requestHash, digest(canonical(f.input)));
    assert.equal(first.public_hash, null); assert.equal(f.jobs.size, 1); assert.equal(f.records.size, 1);
    assert.throws(() => assertMarketArchiveSearchCapability({ ...f.cap }), { code: 'MARKET_ARCHIVE_CONFIGURATION_INVALID' });
    assert.throws(() => createMarketJobStore({ boundary: { ...f.boundary }, validateAccess: f.validateAccess, archiveSearch: f.cap }), { code: 'MARKET_ARCHIVE_CONFIGURATION_INVALID' });
  }
});
test('reservation/replay reject revoked ACL, role, mode, intake, source and same-turn access-version changes', async () => {
  for (const mutate of [f => f.card.readers = [], f => f.actor.role = 'OBSERVER', f => f.actor.actorKind = 'MACHINE',
    f => f.actor.mode = 'PRODUCTION', f => f.setActive(false), f => f.f.row.state = 'PUBLISHING']) {
    const f = await fixture(); mutate(f); await assert.rejects(f.reserve()); assert.equal(f.jobs.size, 0);
  }
  const f = await fixture(); f.onRefresh(n => { if (n === 2) f.actor.accessVersion++; }); await assert.rejects(f.reserve(), { code: 'SIGN_IN_REQUIRED' }); assert.equal(f.jobs.size, 0);
  const replay = await fixture(); await replay.reserve(); replay.actor.accessVersion++; await assert.rejects(replay.reserve(), { code: 'MARKET_ARCHIVE_APPROVAL_STALE' });
  const source = await fixture(); await source.reserve(); source.f.row.source_hash = 'e'.repeat(64); await assert.rejects(source.reserve(), { code: 'MARKET_ARCHIVE_APPROVAL_STALE' });
});
test('UNKNOWN fences fresh requests; retained response recovery preserves original requester and original search', async () => {
  const f = await fixture(); await f.reserve(); const row = f.jobs.get(f.input.requestId);
  row.state = 'UNKNOWN'; await assert.rejects(f.reserve({ ...f.input, requestId: randomUUID() }), { code: 'MARKET_OUTCOME_RECONCILIATION_REQUIRED' });
  row.state = 'FAILED'; row.response = canonical({ responsePolicy: 'ATLAS_SLAB_V1', items: [] }); row.response_hash = digest(row.response);
  const authority = row.archive_authority, next = { ...f.input, requestId: randomUUID() };
  const recovered = await f.reserve(next); assert.equal(recovered.request_id, f.input.requestId); assert.equal(recovered.archive_authority, authority);
  assert.equal(recovered.recoveries, 1); assert.equal((await f.reserve(next)).recoveries, 1); assert.equal(f.jobs.size, 1);
  const other = randomUUID(); f.actor.id = other; f.card.readers.push(other); row.state = 'FAILED';
  await assert.rejects(f.reserve({ ...f.input, requestId: randomUUID() }), { code: 'MARKET_ARCHIVE_APPROVAL_STALE' });
});
test('archive worker reads existing PUBLISHED packet, never publishes/impersonates, and preserves grade/report bytes', async () => {
  const f = await workerFixture(); await f.worker.drainOnce(); assert.equal(f.row.state, 'READY', f.row.code);
  assert.equal(f.calls(), 1); assert.equal(f.forbiddenCalls(), 0); assert.equal(f.labels(), 1); assert.deepEqual(f.f.row, f.before);
});
test('new origin is refused by a worker without capability before any publication/provider/artifact effect', async () => {
  const f = await workerFixture({ noCapability: true }); await f.worker.drainOnce();
  assert.equal(f.calls(), 0); assert.equal(f.forbiddenCalls(), 0); assert.equal(f.writes(), 0);
});
test('access revoked during packet read prevents dispatch; source tampering also prevents dispatch', async () => {
  const f = await workerFixture(); f.onRead(() => { f.card.readers = []; }); await f.worker.drainOnce();
  assert.equal(f.calls(), 0); assert.equal(f.forbiddenCalls(), 0); assert.equal(f.writes(), 0);
  const changed = await workerFixture(); changed.f.row.manifest_hash = 'f'.repeat(64); await changed.worker.drainOnce(); assert.equal(changed.calls(), 0);
});
test('archive unknown dispatch is not repeated and retained response resumes without repurchase', async () => {
  const unknown = await workerFixture({ unknown: true }); await unknown.worker.drainOnce(); await unknown.worker.drainOnce();
  assert.equal(unknown.row.state, 'UNKNOWN'); assert.equal(unknown.calls(), 1);
  const recover = await workerFixture(); recover.failWrite(); await recover.worker.drainOnce();
  assert.equal(recover.row.state, 'QUEUED'); const response = recover.row.response;
  await recover.worker.drainOnce(); assert.equal(recover.row.state, 'READY'); assert.equal(recover.calls(), 1); assert.equal(recover.row.response, response);
});
test('opt-in keeps early legacy polling and public selection authority unchanged; post-publication status uses read-only archive packet', async () => {
  const f = await fixture(); let archiveReads = 0, selected = 0;
  const legacy = { mode: f.f.row.mode, origin: 'APPROVAL', state: 'QUEUED', request_id: randomUUID(), approval_action_id: f.f.actionId, card_id: f.f.cardId, source_hash: f.f.row.source_hash, report_hash: f.f.row.report_hash, public_hash: f.f.row.public_hash, created_at: new Date().toISOString() };
  const jobs = { archiveSearch: f.cap, async latest(staff, id, options) { assert.equal(options, undefined); return legacy; } };
  const repository = { async marketCommitStatus() { selected++; throw Object.assign(Error('Original write scope'), { code: 'MANUAL_CARD_ACCESS_DENIED' }); } };
  const service = createPresentationMarketService({ repository, approved: { loadPacket() { throw Error('owner publication loader'); } }, artifacts: f.artifacts, provider() {}, jobs, archiveSearch: f.cap });
  f.f.row.state = 'PUBLISHING'; assert.equal((await service.status(f.staff, f.f.cardId)).state, 'QUEUED');
  f.f.row.state = 'PUBLISHED'; legacy.state = 'RUNNING'; legacy.response = { source: 'EBAY_SOLD', engineVersion: EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
    query: publishedMarketQuery(await f.cap.approved.loadPacket(f.staff, f.f.cardId, f.f.actionId)).query,
    retrievedAt: new Date().toISOString(), responsePolicy: 'ATLAS_SLAB_V1', items: [] };
  f.onRead(() => { archiveReads++; }); assert.equal((await service.status(f.staff, f.f.cardId)).stage, 'READING_PHOTOS'); assert.ok(archiveReads > 0);
  await assert.rejects(service.select(f.staff, f.f.cardId, { requestId: randomUUID(), approvalActionId: f.f.actionId, expectedRevision: 0, previewId: randomUUID(), selectedIds: ['one'] }), { code: 'MANUAL_CARD_ACCESS_DENIED' }); assert.equal(selected, 1);
});
test('default-off store runs on legacy schema without referring to candidate columns/functions', async () => {
  const f = await fixture(); const store = createMarketJobStore({ boundary: f.boundary, validateAccess: f.validateAccess });
  await store.latest(f.staff, f.f.cardId);
  await assert.rejects(store.reserve(f.staff, f.f.cardId, f.input), { code: 'MANUAL_CARD_ACCESS_DENIED' });
  assert.ok(f.sql.length); assert.ok(f.sql.every(sql => !/archive_authority|market_archive_search_guard/.test(sql)));
  await assert.rejects(store.reserve(f.staff, f.f.cardId, f.input, { archive: true }), { code: 'MARKET_ARCHIVE_CONFIGURATION_REQUIRED' });
});
