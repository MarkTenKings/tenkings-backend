import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { inventoryHash } from '@tenkings/database';
import type { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import { createStaffInventoryCatalogReconciler, prepareInventoryCatalogObservation, createCatalogProposalInbox,
  INVENTORY_CATALOG_SCAN_ACTION, INVENTORY_CATALOG_OBSERVATION_PRINCIPAL, type CompletedInventoryCatalogSource } from '../lib/server/staffInventoryCatalogObservations';
import { createCatalogProposalsHandler } from '../pages/api/admin/set-ops/catalog/proposals';
import { hash, uuid, source, proposalRow, reviewer } from './catalogObservationFixtures';

const previous = process.env.SET_CATALOG_EVIDENCE_ENABLED;
process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
after(() => { if (previous === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = previous; });
const flags = { SET_CATALOG_EVIDENCE_ENABLED: 'true', STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED: 'true' };
const run = { remainingBudgetMs: 20_000 };
type Audit = { id: string; action: string; status: string; reason: string; requestId?: string; metadataJson: Record<string, unknown> };
function scanner(rows: CompletedInventoryCatalogSource[]) {
  const audits: Audit[] = [], proposals = new Map<string, ReturnType<typeof proposalRow>>(), transactionBounds: unknown[] = [];
  let intake = false, busy = false, intakeReads = 0, failedWrite = false, failIntakeRead = 0;
  const key = (row: CompletedInventoryCatalogSource) => `inventory:research:${row.id}|inventory-observation:v1:${row.inputHash}:${row.resultHash}`;
  const revisionHash = (row: CompletedInventoryCatalogSource) => createHash('sha256').update(`v1:${row.id}:${row.inputHash}:${row.resultHash}`).digest('hex');
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, options: unknown) => { transactionBounds.push(options); return fn(db); },
    $executeRaw: async (sql: { sql?: string; values?: unknown[] }) => {
      if (!sql.sql?.startsWith('INSERT INTO "SetCatalogObservationProposal"')) return 0;
      if (failedWrite) throw Error('Synthetic transient connection failure');
      const v = sql.values!, p = JSON.parse(String(v[5])), authority = JSON.parse(String(v[9])), idempotency = `${p.observationId}|${p.inputRevision}`;
      if (!proposals.has(idempotency)) proposals.set(idempotency, { id: String(v[0]), producer: p.producer, observationId: p.observationId, inputRevision: p.inputRevision,
        physicalCardRef: p.physicalCardRef, proposalJson: p, proposalSha256: String(v[6]), actorKind: authority.actorKind, actorRef: authority.actorRef,
        bindingJson: authority, bindingSha256: String(v[10]), submittedById: null, submittedAt: new Date('2026-09-16T12:00:02.000Z') });
      return 1;
    },
    $queryRaw: async (sql: { sql?: string; values?: unknown[] } | TemplateStringsArray) => {
      const text = 'sql' in sql ? sql.sql! : Array.from(sql as TemplateStringsArray).join('?');
      if (text.includes('pg_try_advisory_xact_lock')) return [{ locked: !busy }];
      if (text.includes('StaffInventoryIntakeLeaseV2')) { if (++intakeReads === failIntakeRead) throw Error('Synthetic process interruption'); return [{ active: intake }]; }
      assert.ok(text.includes('FROM "StaffInventoryResearchJobV2"'), text);
      assert.ok(text.includes('octet_length') && text.includes('ORDER BY j.id LIMIT'), 'source query bounds bytes and keyset page');
      const cursor = (sql as { values: unknown[] }).values[3] as string | null;
      return rows.filter(row => (!cursor || row.id > cursor) && !proposals.has(key(row)) && !audits.some(a => a.reason === 'invalid_revision' && a.requestId === revisionHash(row))).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 8);
    },
    setAuditEvent: {
      findFirst: async ({ where }: { where: { reason: string; requestId?: string } }) => [...audits].reverse().find(a => a.reason === where.reason && (!where.requestId || a.requestId === where.requestId)) ?? null,
      create: async ({ data }: { data: Omit<Audit, 'id'> }) => { const audit = { ...data, id: uuid(audits.length + 5000) }; audits.push(audit); return audit; },
    },
    setCatalogObservationProposal: { findUniqueOrThrow: async ({ where }: { where: { producer_observationId_inputRevision: { observationId: string; inputRevision: string } } }) => {
      const p = where.producer_observationId_inputRevision; return proposals.get(`${p.observationId}|${p.inputRevision}`)!;
    } },
  };
  return { db: db as unknown as PrismaClient, audits, proposals, transactionBounds, key,
    intake: (value: boolean) => { intake = value; }, busy: (value: boolean) => { busy = value; }, failWrites: (value: boolean) => { failedWrite = value; },
    failIntakeRead: (n: number) => { failIntakeRead = n; } };
}

test('verified completed research becomes deterministic metadata with exact stable card and JPEG lineage', () => {
  for (const [category, expected] of [['Pokémon', 'POKEMON'], ['Sports cards', 'SPORTS']]) {
    const row = source(1, category), prepared = prepareInventoryCatalogObservation(row), p = prepared.proposal;
    assert.notEqual(row.descriptionHash, inventoryHash(JSON.parse(row.input).description), 'full saved-description hash is not the flattened projection hash');
    assert.equal(canonicalJson(prepared), canonicalJson(prepareInventoryCatalogObservation(row)));
    assert.equal(p.identity.category, expected); assert.equal(p.physicalCardRef.length, 79);
    assert.deepEqual([p.identity.setId, p.identity.programId, p.identity.cardId, p.identity.printingId], [null, null, null, null]);
    assert.equal(p.sources.length, 3); assert.deepEqual(p.images, []); assert.equal(p.basedOnPublication, null);
    assert.ok(p.sources.every(s => s.originKeys.includes(`inventory-unit:${row.unitId}`) && s.originKeys.includes(`inventory-input:${row.inputHash}`) && s.originKeys.includes(`inventory-result:${row.resultHash}`)));
    assert.ok(p.sources.every(s => s.kind === 'PHYSICAL_OBSERVATION' && s.sourceUrl === null));
    assert.match(p.note, /Unreviewed machine/); assert.match(p.note, /original-capture lineage and dimensions are unknown/); assert.match(p.note, /Research outcome: unresolved/);
    assert.doesNotMatch(canonicalJson(prepared), /inventory-photos\/|research-evidence\/|Possible finish requires review/);
    assert.equal(prepared.authority.actorRef, INVENTORY_CATALOG_OBSERVATION_PRINCIPAL); assert.equal(prepared.authority.userId, null);
    assert.equal(prepared.authority.binding.evidenceSha256, hash(p));
  }
});
test('input/result/immutable attempt/photo inconsistencies and unrepresentable lineage fail closed', () => {
  for (const change of [
    (r: ReturnType<typeof source>) => { r.inputHash = '0'.repeat(64); },
    (r: ReturnType<typeof source>) => { r.resultHash = '0'.repeat(64); },
    (r: ReturnType<typeof source>) => { r.completedAttempt.result.identity.reason = 'Changed retained immutable result.'; },
    (r: ReturnType<typeof source>) => { const p = JSON.parse(r.input); p.front_photo_key = p.back_photo_key; r.input = JSON.stringify(p); r.inputHash = inventoryHash(p); },
    (r: ReturnType<typeof source>) => { r.descriptionHash = '0'.repeat(64); },
    (r: ReturnType<typeof source>) => { r.unitId = 'private/card'; const p = JSON.parse(r.input), result = JSON.parse(r.result); p.unit_id = result.unit_id = r.unitId; r.input = JSON.stringify(p); r.inputHash = inventoryHash(p); r.result = JSON.stringify(result); r.resultHash = inventoryHash(result); r.completedAttempt.result = result; },
  ]) { const row = source(); change(row); assert.throws(() => prepareInventoryCatalogObservation(row)); }
  assert.throws(() => prepareInventoryCatalogObservation(source(1, 'Other')), /UNSUPPORTED_CATEGORY/);
  assert.throws(() => prepareInventoryCatalogObservation({ ...source(), result: null }), /SOURCE_TOO_LARGE/);
});
test('an explicit new completed result is a new immutable revision, with the same physical card', () => {
  const row = source(), first = prepareInventoryCatalogObservation(row).proposal;
  const result = JSON.parse(row.result); result.identity.reason = 'New completed research observation.';
  row.result = JSON.stringify(result); row.resultHash = inventoryHash(result); row.completedAttempt.result = result;
  const next = prepareInventoryCatalogObservation(row).proposal;
  assert.equal(next.physicalCardRef, first.physicalCardRef); assert.equal(next.observationId, first.observationId); assert.notEqual(next.inputRevision, first.inputRevision);
});
test('disabled flags, insufficient budget and cancellation do not touch the database', async () => {
  const db = { $transaction: () => assert.fail('No database work permitted.') } as unknown as PrismaClient;
  for (const env of [{}, { SET_CATALOG_EVIDENCE_ENABLED: 'true' }, { STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED: 'true' }]) {
    assert.equal((await createStaffInventoryCatalogReconciler({ db, env })(run)).status, 'disabled');
  }
  const reconcile = createStaffInventoryCatalogReconciler({ db, env: flags });
  for (const remainingBudgetMs of [19_999, NaN, Infinity]) assert.equal((await reconcile({ remainingBudgetMs })).status, 'budget');
  assert.equal((await reconcile({ ...run, signal: AbortSignal.abort() })).status, 'budget');
});
test('any active intake lease or scanner admission contention skips proposals and checkpoints', async () => {
  const f = scanner([source()]), reconcile = createStaffInventoryCatalogReconciler({ db: f.db, env: flags });
  f.intake(true); assert.equal((await reconcile(run)).status, 'intake'); f.intake(false); f.busy(true); assert.equal((await reconcile(run)).status, 'busy');
  assert.equal(f.audits.length, 0); assert.equal(f.proposals.size, 0);
});
test('invalid old revision cannot starve a later contribution; idle passes stop checkpoint writes', async () => {
  const f = scanner([{ ...source(1), inputHash: '0'.repeat(64) }, source(2)]), reconcile = createStaffInventoryCatalogReconciler({ db: f.db, env: flags });
  const result = await reconcile(run); assert.equal(result.invalid, 1); assert.equal(result.recorded, 1);
  const skip = f.audits.find(a => a.reason === 'invalid_revision')!;
  assert.equal(skip.action, INVENTORY_CATALOG_SCAN_ACTION); assert.match(skip.requestId!, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(skip.metadataJson).sort(), ['actorKind', 'actorRef', 'errorCode', 'revisionSha256', 'schemaVersion']);
  assert.doesNotMatch(JSON.stringify(skip), /inv:fixture|inventory-photos|Synthetic card/);
  assert.equal((await reconcile(run)).status, 'wrapped'); const writes = f.audits.length;
  assert.equal((await reconcile(run)).status, 'idle'); assert.equal((await reconcile(run)).status, 'idle'); assert.equal(f.audits.length, writes);
  assert.ok(f.transactionBounds.every(b => (b as { timeout: number; maxWait: number }).timeout === 3000 && (b as { maxWait: number }).maxWait === 1000));
});
test('reserved pages survive process interruption and transient writer failure through bounded wrap and exact retry', async () => {
  const f = scanner([source()]), reconcile = createStaffInventoryCatalogReconciler({ db: f.db, env: flags });
  f.failIntakeRead(3); await assert.rejects(reconcile(run), /process interruption/);
  assert.equal(f.audits.length, 1); assert.equal(f.proposals.size, 0);
  assert.equal((await reconcile(run)).status, 'wrapped');
  f.failWrites(true); assert.equal((await reconcile(run)).failed, 1); assert.equal(f.audits.filter(a => a.reason === 'invalid_revision').length, 0);
  f.failWrites(false); assert.equal((await reconcile(run)).status, 'wrapped'); assert.equal((await reconcile(run)).recorded, 1);
  assert.equal(f.proposals.size, 1);
});
test('real immutable proposal writer rejects a changed existing payload and never reports it as accepted', async () => {
  const row = source(), f = scanner([row]), existing = proposalRow(); existing.proposalJson.note = 'Changed same-key payload.';
  // Simulate a same-key insert racing the scan snapshot. The writer must compare
  // the exact stored hash/payload after ON CONFLICT rather than count success.
  const ordinary = f.db.$queryRaw.bind(f.db);
  f.db.$queryRaw = (async (...args: unknown[]) => {
    const result = await (ordinary as (...a: unknown[]) => Promise<unknown>)(...args);
    if (String((args[0] as { sql?: string }).sql).includes('FROM "StaffInventoryResearchJobV2"')) f.proposals.set(f.key(row), existing);
    return result;
  }) as typeof f.db.$queryRaw;
  const result = await createStaffInventoryCatalogReconciler({ db: f.db, env: flags })(run);
  assert.equal(result.recorded + result.replayed, 0); assert.equal(result.failed, 1);
});
test('overlapping scanner snapshots converge on one immutable proposal through the real writer', async () => {
  const f = scanner([source()]), reconcile = createStaffInventoryCatalogReconciler({ db: f.db, env: flags });
  // Let both mocked transactions see the pending snapshot. Production admission
  // is stricter (try-advisory lock), but recovery/wrap can still revisit work
  // while the first writer is completing outside that short lock.
  const results = await Promise.all([reconcile(run), reconcile(run)]);
  assert.equal(f.proposals.size, 1); assert.equal(results.reduce((n, r) => n + r.recorded, 0), 1);
  assert.equal(results.reduce((n, r) => n + r.replayed, 0), 1); assert.ok(results.every(r => r.failed === 0));
});
test('budget expiry after page reservation defers work without provider or writer calls', async () => {
  const f = scanner([source()]); let calls = 0;
  const result = await createStaffInventoryCatalogReconciler({ db: f.db, env: flags, now: () => ++calls < 5 ? 0 : 6000 })(run);
  assert.equal(result.deferred, 1); assert.equal(f.proposals.size, 0);
});

test('human inbox verifies exact immutable proposal and authority binding; hash mismatch and static sessions fail', async () => {
  const row = proposalRow(); let queries = 0;
  const db = { $queryRaw: async (sql: { sql: string }) => { queries++; assert.match(sql.sql, /CASE WHEN octet_length/); return [row]; } } as unknown as PrismaClient;
  const inbox = createCatalogProposalInbox(db), pin = { proposalId: row.id, proposalSha256: row.proposalSha256 };
  const list = await inbox.list({}, reviewer); assert.equal(list.items.length, 1);
  const detail = await inbox.detail(pin, reviewer); assert.equal(hash(JSON.parse(detail.canonicalProposalJson)), row.proposalSha256);
  assert.deepEqual(detail.reviewLink, { ...pin, sourceIds: [], reviewNote: '' });
  await assert.rejects(inbox.detail({ ...pin, proposalSha256: '0'.repeat(64) }, reviewer), /differs/);
  const before = queries;
  await assert.rejects(inbox.list({}, { ...reviewer, authority: 'operator-key' }), /human admin/); assert.equal(queries, before);
  await assert.rejects(inbox.list({ cursor: 'forged' }, reviewer), /cursor/);
  row.bindingJson.binding.evidenceSha256 = '0'.repeat(64); row.bindingSha256 = hash(row.bindingJson);
  await assert.rejects(inbox.detail(pin, reviewer), /integrity/); assert.equal((await inbox.list({}, reviewer)).unavailableCount, 1);
});
test('bounded inbox advances past unavailable records using immutable timestamp/id keysets', async () => {
  const rows = Array.from({ length: 11 }, (_, i) => proposalRow(i + 1)).reverse(); rows[0].proposalSha256 = '0'.repeat(64);
  let requestValues: unknown[] = [];
  const inbox = createCatalogProposalInbox({ $queryRaw: async (sql: { values: unknown[] }) => { requestValues = sql.values; return rows; } } as unknown as PrismaClient);
  const first = await inbox.list({ producer: 'inventory' }, reviewer); assert.equal(first.items.length, 9); assert.equal(first.unavailableCount, 1); assert.ok(first.nextCursor);
  await inbox.list({ producer: 'inventory', cursor: first.nextCursor! }, reviewer);
  assert.ok(requestValues.includes(rows[9].id)); assert.ok(requestValues.includes(rows[9].submittedAt.toISOString())); assert.equal(requestValues.at(-1), 11);
});
test('an oversized proposal is withheld as one exact unit, never returned as partial evidence', async () => {
  const row = { ...proposalRow(), proposalJson: null };
  const inbox = createCatalogProposalInbox({ $queryRaw: async () => [row] } as unknown as PrismaClient);
  const list = await inbox.list({}, reviewer); assert.equal(list.items.length, 0); assert.equal(list.unavailableCount, 1);
  await assert.rejects(inbox.detail({ proposalId: row.id, proposalSha256: row.proposalSha256 }, reviewer), /exceeds/);
});
test('proposal HTTP surface is human-only GET with private bounded responses and no authority in query', async () => {
  const headers: Record<string, unknown> = {}; let status = 0, data: unknown, calls = 0;
  const res = { setHeader: (k: string, v: unknown) => { headers[k] = v; }, status: (s: number) => { status = s; return res; }, json: (v: unknown) => { data = v; return res; } } as unknown as NextApiResponse;
  const handler = createCatalogProposalsHandler({ requireHuman: async (_req, role) => { assert.equal(role, 'reviewer'); return reviewer; },
    inbox: { list: async () => { calls++; return { schemaVersion: 'catalog-proposal-inbox/v1', disposition: 'requires_authorized_review', items: [], unavailableCount: 0, nextCursor: null }; }, detail: async () => assert.fail('Unexpected detail') } });
  await handler({ method: 'GET', query: {}, headers: {} } as NextApiRequest, res); assert.equal(status, 200); assert.equal(calls, 1); assert.equal(headers['Cache-Control'], 'private, no-store');
  await handler({ method: 'GET', query: { actorKind: 'service' }, headers: {} } as unknown as NextApiRequest, res); assert.equal(status, 400); assert.equal(calls, 1);
  await handler({ method: 'POST', query: {}, headers: {} } as NextApiRequest, res); assert.equal(status, 405); assert.equal(headers.Allow, 'GET');
  await createCatalogProposalsHandler()({ method: 'GET', query: {}, headers: { 'x-operator-key': 'fixture-static-key' } } as unknown as NextApiRequest, res);
  assert.equal(status, 401); assert.match(JSON.stringify(data), /Static operator/);
});
