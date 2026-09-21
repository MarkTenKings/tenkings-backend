import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AdminSession } from '../lib/server/admin';
import { createSportsCatalogPreparationService, StaleSportsPreparationSnapshotError } from '../lib/server/setCatalogSportsPreparation';
import { normalizeDraftRows } from '../lib/server/setOpsDrafts';
import { evaluateDraftQuality } from '../lib/server/setOpsCsvContract';
import plan from '../lib/server/setCatalogSportsPreparationPlan.json';
import fixture from './setCatalogSportsPreparationFixture.json';

// Explicit in-memory transaction simulator, not PostgreSQL lock/concurrency proof.
// Canonical identity IDs are from the dated committed reconciliation; all sessions,
// audit events and mutations below exist only in this synthetic fixture.
type Row = Record<string, unknown>;
type State = Record<string, Row[]>;
const clone = <T>(value: T): T => structuredClone(value);
const read = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../../../docs/plans/catalog-pilot-20260916', name), 'utf8'));
const report = read('sports-reconciliation-report.unreviewed.json');
const packet = read('sports-publication-pilot.unsubmitted.json');
const sourceBytes = new Map<string, Buffer>(packet.sourceEvidence.map((s: { sourceRef: string; localEvidencePath: string }) => [s.sourceRef, readFileSync(s.localEvidencePath)]));
const actor: AdminSession = { authority: 'local-database', sessionId: 'fixture-session', tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 3600000), user: { id: 'fixture-human', displayName: null, phone: null } };
function initial(): State {
  return {
    setDraft: [{ id: plan.existingBinding.draftId, setId: plan.setId, status: 'APPROVED', archivedAt: null, currentCatalogPublicationId: null }],
    setProgram: clone(fixture.programs), setDraftVersion: clone(fixture.versions),
    setCard: report.rows.filter((r: Row) => r.status === 'exact_program_number_name_match').map((r: Row) => ({ id: r.canonicalCardId, setId: plan.setId,
      programId: r.canonicalProgramId, cardNumber: r.printedCardNumber, playerName: r.observedCanonicalName,
      team: (r.teamComparison as Row).observed, isRookie: null, sourceId: '9e347dd0-d75a-4662-a39b-ca3567cdc150' })),
    setTaxonomySource: report.sourceMetadata.map((s: Row) => ({ id: s.id, setId: plan.setId, ingestionJobId: 'fixture-existing-job', sourceKind: s.sourceKind, artifactType: s.artifactType, sourceUrl: null })),
    setIngestionJob: Array.from({ length: 8 }, (_, i) => ({ id: `fixture-existing-job-${i}`, setId: plan.setId, draftId: plan.existingBinding.draftId, status: 'APPROVED', sourceUrl: null, parserVersion: 'fixture-legacy' })),
    setParallel: [], setParallelScope: [], setAuditEvent: [], setSeedJob: [], setReplaceJob: [], setCatalogEvidencePublication: [],
  };
}
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const condition = value as { in?: unknown[]; notIn?: unknown[] };
      return condition.in ? condition.in.includes(row[key]) : condition.notIn ? !condition.notIn.includes(row[key]) : false;
    }
    return row[key] === value;
  });
}
function project(row: Row, select?: Record<string, boolean>) { return select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row; }
function harness() {
  let state = initial(), queue = Promise.resolve(), active = false;
  const calls: string[] = [], sql: string[] = [];
  const controls = { failCreate: '', loseResponse: false, badCount: '', mutateDuringCreate: false, denyLock: false };
  const db = { $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
    const prior = queue; let release!: () => void; queue = new Promise<void>(done => { release = done; }); await prior;
    const working = clone(state); active = true;
    const tx: Record<string, unknown> = {
      $executeRaw: async (strings: TemplateStringsArray) => { const text = strings.join('?'); sql.push(text); if (controls.denyLock && text.startsWith('LOCK TABLE')) throw Error('fixture lock_timeout'); return 0; },
      $queryRaw: async (strings: TemplateStringsArray) => { sql.push(strings.join('?')); return []; },
    };
    for (const table of Object.keys(working)) {
      const find = ({ where, take, select, orderBy }: { where?: Row; take?: number; select?: Record<string, boolean>; orderBy?: unknown } = {}) => {
        let rows = working[table].filter(row => matches(row, where));
        if (orderBy) rows = [...rows].sort((a,b) => String(a.id).localeCompare(String(b.id)));
        return rows.slice(0, take ?? rows.length).map(row => clone(project(row, select)));
      };
      tx[table] = { findMany: async (args: Parameters<typeof find>[0]) => find(args),
        findUnique: async (args: Parameters<typeof find>[0]) => find(args)[0] ?? null,
        count: async ({ where }: { where?: Row } = {}) => working[table].filter(row => matches(row, where)).length + (controls.badCount === table ? 1 : 0),
        create: async ({ data }: { data: Row }) => {
          calls.push(`${table}.create`); if (controls.failCreate === table) throw Error(`fixture ${table} failure`);
          if (!['setIngestionJob','setTaxonomySource','setParallel','setParallelScope','setAuditEvent'].includes(table)) assert.fail(`Forbidden create ${table}`);
          if (working[table].some(r => r.id === data.id)) throw Error('fixture duplicate id');
          const normalized = { ...data }; if (normalized.visualCuesJson === Prisma.DbNull) normalized.visualCuesJson = null;
          const row = clone(normalized); working[table].push(row);
          if (controls.mutateDuringCreate && table === 'setParallel') working.setCard[0].team = 'Changed concurrently in fixture';
          return clone(row);
        },
        update: () => assert.fail(`Forbidden update ${table}`), upsert: () => assert.fail(`Forbidden upsert ${table}`), deleteMany: () => assert.fail(`Forbidden delete ${table}`),
      };
    }
    try {
      const result = await fn(tx); state = working;
      if (controls.loseResponse) { controls.loseResponse = false; throw Error('fixture response lost after commit'); }
      return result;
    } finally { active = false; release(); }
  } };
  let tamperBytes = false;
  const service = createSportsCatalogPreparationService({ db: db as unknown as PrismaClient, readArtifact: async ref => {
    assert.equal(active, false, 'No source/storage work may run under a transaction lock.');
    const bytes = sourceBytes.get(ref); assert.ok(bytes); return tamperBytes ? Buffer.from('damaged') : bytes;
  } });
  return { service, controls, calls, sql, state: () => state, tamper: () => { tamperBytes = true; },
    request: async () => { const preview = await service.preview(actor); return { schemaVersion: 'setops-sports-additive-preparation-request/v1', idempotencyKey: randomUUID(),
      expectedSnapshotSha256: preview.snapshotSha256, proposalSha256: preview.proposalSha256, acknowledgement: 'PREPARE PENDING SPORTS CATALOG MAPPINGS' }; } };
}
async function enabled(run: () => Promise<void>) {
  const old = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  try { await run(); } finally { if (old === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = old; }
}

test('one bounded transaction creates isolated pending source jobs and mappings without rewriting identities/history', () => enabled(async () => {
  const f = harness(), before = clone(f.state()), request = await f.request();
  assert.deepEqual(f.calls, []);
  const result = await f.service.stage(request, actor), after = f.state();
  assert.equal(result.outcome, 'recorded'); assert.equal(after.setIngestionJob.length, 10); assert.equal(after.setTaxonomySource.length, 8);
  assert.equal(after.setParallel.length, 3); assert.equal(after.setParallelScope.length, 3); assert.equal(after.setAuditEvent.length, 1);
  for (const key of ['setCard','setProgram','setDraftVersion','setDraft','setCatalogEvidencePublication']) assert.deepEqual(after[key], before[key]);
  for (const job of after.setIngestionJob.slice(8)) {
    assert.equal(job.status, 'REVIEW_REQUIRED'); assert.equal(job.draftId, null); assert.equal(job.reviewedAt, null);
    assert.equal(job.createdById, actor.user.id);
    // This proves only payload quality rejection, not handler immutability. The
    // old Build Draft handler can still bind/FAIL the odds job after this result;
    // activation requires its separate early parser-version guard and handler test.
    const normalized = normalizeDraftRows({ datasetType: job.datasetType as 'PLAYER_WORKSHEET' | 'PARALLEL_DB', fallbackSetId: plan.setId, rawPayload: job.rawPayload });
    assert.equal(normalized.rows.length, 0);
    assert.equal(evaluateDraftQuality({ datasetType: job.datasetType as 'PLAYER_WORKSHEET' | 'PARALLEL_DB', rows: normalized.rows, summary: normalized.summary }).decision, 'REJECT');
  }
  for (const source of after.setTaxonomySource.slice(6)) assert(result.receipt.ids.jobs.includes(String(source.ingestionJobId)));
  assert.deepEqual((after.setTaxonomySource[6].metadataJson as { sourceRows: unknown[] }).sourceRows, plan.sources[0].data.metadataJson.sourceRows);
  assert(result.receipt.applicability.every(a => a.status === 'unknown')); assert.equal(result.receipt.applicability.length, 9);
  assert(f.sql.some(q => q === 'LOCK TABLE "SetTaxonomySource", "SetParallel", "SetParallelScope" IN SHARE ROW EXCLUSIVE MODE'));
  assert(f.sql.some(q => q.includes("lock_timeout = '750ms'")));
}));

test('fixed recipe preserves the original eight-create proposal and preview cannot mutate source authority', () => enabled(async () => {
  const bytes = readFileSync(resolve(__dirname, '../../../docs/plans/catalog-pilot-20260916/sports-additive-taxonomy-proposal.unsubmitted.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), plan.proposalSha256);
  const proposal = JSON.parse(bytes.toString());
  for (const [name, model] of [['sources','SetTaxonomySource'], ['parallels','SetParallel'], ['scopes','SetParallelScope']] as const) {
    assert.deepEqual(plan[name].map(row => row.data), proposal.operations.filter((op: Row) => op.model === model).map((op: Row) => op.data));
  }
  const f = harness(), first = await f.service.preview(actor);
  first.preserved.cards.count = 0; first.applicability[0].cardId = 'mutated-client-copy';
  const second = await f.service.preview(actor);
  assert.equal(second.preserved.cards.count, 379); assert.equal(second.applicability[0].cardId, plan.existingBinding.cards[0].cardId);
  assert.equal(second.snapshotSha256, first.snapshotSha256); assert.deepEqual(f.calls, []);
}));

test('same-key concurrent calls and uncertain-response retry produce one complete receipt with no duplicates', () => enabled(async () => {
  const f = harness(), request = await f.request();
  const results = await Promise.all([f.service.stage(request, actor), f.service.stage(request, actor)]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['recorded','replay']); assert.equal(results[0].receiptSha256, results[1].receiptSha256);
  assert.equal(f.state().setAuditEvent.length, 1); assert.equal(f.state().setIngestionJob.length, 10);
  const lost = harness(), same = await lost.request(); lost.controls.loseResponse = true;
  await assert.rejects(lost.service.stage(same, actor), /response lost/);
  assert.equal((await lost.service.stage(same, actor)).outcome, 'replay'); assert.equal(lost.state().setParallel.length, 3);
}));

test('different concurrent request keys cannot duplicate an occupied source/parallel/scope cohort', () => enabled(async () => {
  const f = harness(), a = await f.request(), b = { ...a, idempotencyKey: randomUUID() };
  const results = await Promise.allSettled([f.service.stage(a, actor), f.service.stage(b, actor)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.state().setAuditEvent.length, 1);
  assert.equal(f.state().setTaxonomySource.length, 8); assert.equal(f.state().setParallelScope.length, 3);
}));

test('any create/audit failure rolls back jobs, sources, printings and receipt together', () => enabled(async () => {
  for (const table of ['setIngestionJob','setTaxonomySource','setParallel','setParallelScope','setAuditEvent']) {
    const f = harness(), before = clone(f.state()), request = await f.request(); f.controls.failCreate = table;
    await assert.rejects(f.service.stage(request, actor), /fixture/); assert.deepEqual(f.state(), before);
  }
}));

test('stale metadata/counts/identity rosters and changed rows during preparation fail without retained writes', () => enabled(async () => {
  const f = harness(), request = await f.request(); f.state().setCard[0].team = 'New metadata'; const baseline = clone(f.state());
  await assert.rejects(f.service.stage(request, actor), error => error instanceof StaleSportsPreparationSnapshotError
    && error.idempotencyKey === request.idempotencyKey && error.expectedSnapshotSha256 === request.expectedSnapshotSha256
    && /snapshot changed/.test(error.message)); assert.deepEqual(f.state(), baseline);
  for (const mode of ['count','id','during']) {
    const next = harness(), req = await next.request();
    if (mode === 'count') next.controls.badCount = 'setCard';
    if (mode === 'id') next.state().setCard[0].id = 'changed';
    if (mode === 'during') next.controls.mutateDuringCreate = true;
    const before = clone(next.state()); await assert.rejects(next.service.stage(req, actor)); assert.deepEqual(next.state(), before);
  }
}));

test('occupied keys fail closed even when an existing source is secondary or another parallel label normalizes identically', () => enabled(async () => {
  for (const table of ['setTaxonomySource','setParallel','setParallelScope']) {
    const f = harness(), request = await f.request();
    if (table === 'setTaxonomySource') f.state()[table].push({ id: 'occupied-source', setId: plan.setId, sourceUrl: plan.sources[0].data.sourceUrl, sourceKind: 'TRUSTED_SECONDARY' });
    if (table === 'setParallel') f.state()[table].push({ id: 'occupied-parallel', setId: plan.setId, parallelId: 'unexpected', label: 'ORANGE  REFRACTOR' });
    if (table === 'setParallelScope') f.state()[table].push({ id: 'occupied-scope', ...plan.scopes[0].data });
    await assert.rejects(f.service.stage(request, actor), error => error instanceof Error && /occupied/.test(error.message)
      && !(error instanceof StaleSportsPreparationSnapshotError)); assert.deepEqual(f.calls, []);
  }
}));

test('unknown request versions, changed pins, unauthorized actors and source bytes cannot write', () => enabled(async () => {
  const f = harness(), request = await f.request();
  for (const patch of [{ schemaVersion: 'setops-sports-additive-preparation-request/v2' }, { proposalSha256: '0'.repeat(64) }, { approved: true }]) {
    await assert.rejects(f.service.stage({ ...request, ...patch }, actor));
  }
  await assert.rejects(f.service.stage(request, { ...actor, authority: 'operator-key' }), /human admin/);
  f.tamper(); await assert.rejects(f.service.stage(request, actor), /source bytes differ/); assert.deepEqual(f.calls, []);
}));

test('replay never repairs changed jobs or elevates a pending source; lock timeouts have no automatic retry', () => enabled(async () => {
  const f = harness(), request = await f.request(); await f.service.stage(request, actor);
  await assert.rejects(f.service.stage({ ...request, expectedSnapshotSha256: '0'.repeat(64) }, actor), error => error instanceof Error
    && /different evidence/.test(error.message) && !(error instanceof StaleSportsPreparationSnapshotError));
  f.state().setIngestionJob[8].status = 'APPROVED'; const before = clone(f.state());
  await assert.rejects(f.service.stage(request, actor), /missing or changed/); assert.deepEqual(f.state(), before);
  const locked = harness(), req = await locked.request(); locked.controls.denyLock = true;
  await assert.rejects(locked.service.stage(req, actor), /lock_timeout/); assert.deepEqual(locked.calls, []);
  assert.equal(locked.sql.filter(q => q.startsWith('LOCK TABLE')).length, 1);
}));
