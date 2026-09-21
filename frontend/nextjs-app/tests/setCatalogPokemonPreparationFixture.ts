import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AdminSession } from '../lib/server/admin';
import { buildTaxonomyIngestRows, createDraftVersionPayload, normalizeDraftRows } from '../lib/server/setOpsDrafts';
import { buildPilotChecklistTaxonomyAdapterOutput } from '../lib/server/taxonomyV2PilotChecklistAdapter';
import { createPokemonCatalogPreparationService } from '../lib/server/setCatalogPokemonPreparation';
import plan from '../lib/server/setCatalogPokemonPreparationPlan.json';

export const actor: AdminSession = { authority: 'local-database', sessionId: 'offline-human-session', tokenHash: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 3600000), user: { id: 'offline-pokemon-human', phone: null, displayName: null } };
export type Row = Record<string, unknown>;
export type State = Record<string, Row[]>;
export const clone = <T>(v: T): T => structuredClone(v);
export const requestDraft = JSON.parse(readFileSync(new URL('../../../docs/plans/catalog-pilot-20260916/pokemon-complete-import.unreviewed.json', import.meta.url), 'utf8')).requestDraft;
const sourcePath = JSON.parse(readFileSync(new URL('../../../docs/plans/catalog-pilot-20260916/source-manifest.draft.json', import.meta.url), 'utf8')).sources.find((s: Row) => s.id === 'pokemon-checklist').local_evidence_path;
const sourceBytes = readFileSync(sourcePath);
export function initial(): State {
  const normalized = normalizeDraftRows({ datasetType: requestDraft.datasetType, fallbackSetId: plan.setId, rawPayload: requestDraft.rawPayload });
  const version = createDraftVersionPayload({ setId: plan.setId, datasetType: requestDraft.datasetType, rows: normalized.rows });
  const initialSummary = { sourceProvider: requestDraft.sourceProvider, sourceQuery: requestDraft.sourceQuery, sourceFetchMeta: requestDraft.sourceFetchMeta, csvContract: null };
  const output = buildPilotChecklistTaxonomyAdapterOutput({ setId: plan.setId, datasetType: requestDraft.datasetType,
    rawPayload: buildTaxonomyIngestRows(normalized.rows), sourceUrl: requestDraft.sourceUrl, parserVersion: requestDraft.parserVersion, parseSummary: initialSummary });
  const sourceId = 'fixture-pokemon-source', jobId = 'fixture-pokemon-job', draftId = 'fixture-pokemon-draft', versionId = 'fixture-pokemon-version';
  return {
    setDraft: [{ id: draftId, setId: plan.setId, status: 'REVIEW_REQUIRED', archivedAt: null, currentCatalogPublicationId: null }],
    setDraftVersion: [{ id: versionId, draftId, version: 1, versionHash: version.versionHash, rowCount: version.rowCount,
      blockingErrorCount: version.blockingErrorCount, dataJson: version.dataJson, sourceLinksJson: { ingestionJobId: jobId, sourceUrl: plan.source.url } }],
    setIngestionJob: [{ id: jobId, setId: plan.setId, draftId, datasetType: 'PLAYER_WORKSHEET', status: 'REVIEW_REQUIRED',
      sourceUrl: plan.source.url, parserVersion: plan.source.parserVersion, rawPayload: clone(requestDraft.rawPayload),
      parseSummaryJson: { ...clone(initialSummary), draftVersionId: versionId, taxonomyIngest: { applied: true, adapter: 'pinned-pilot-checklist-v1', sourceId,
        counts: { programs: 1, cards: 138, variations: 0, parallels: 0, scopes: 0, oddsRows: 0, conflicts: 0, ambiguities: 0, bridges: 0 } } } }],
    setTaxonomySource: [{ id: sourceId, setId: plan.setId, ingestionJobId: jobId, sourceKind: output.sourceKind, artifactType: output.artifactType,
      sourceLabel: output.sourceLabel, sourceUrl: plan.source.url, parserVersion: plan.source.parserVersion,
      metadataJson: { ...output.metadata as Row, parseSummary: clone(initialSummary) } }],
    setProgram: [{ id: 'fixture-pokemon-program', setId: plan.setId, programId: plan.programId, label: plan.programLabel, codePrefix: null, programClass: null, sourceId }],
    setCard: output.cards.map((c, i) => ({ id: `fixture-pokemon-card-${i}`, setId: plan.setId, programId: plan.programId,
      cardNumber: c.cardNumber, playerName: c.playerName, team: null, isRookie: null, sourceId, metadataJson: c.metadata })),
    setParallel: [], setParallelScope: [], setVariation: [], setOddsByFormat: [], setTaxonomyConflict: [], setTaxonomyAmbiguityQueue: [],
    cardVariantTaxonomyMap: [], setApproval: [], setSeedJob: [], setReplaceJob: [], setCatalogEvidencePublication: [], setAuditEvent: [],
  };
}
function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      const filter = value as { in?: unknown[]; notIn?: unknown[] };
      return filter.in ? filter.in.includes(row[key]) : filter.notIn ? !filter.notIn.includes(row[key]) : false;
    }
    return row[key] === value;
  });
}
// An explicitly synthetic, serialized transaction simulator. It does not prove
// PostgreSQL lock behavior or use any database/network connection.
export function harness() {
  let state = initial(), queue = Promise.resolve(), active = false;
  const calls: string[] = [], sql: string[] = [];
  const controls = { failCreateNumber: 0, loseResponse: false, badCount: '', mutateCardDuringCreate: false, denyLock: false, badBytes: false };
  const db = { $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
    const prior = queue; let release!: () => void; queue = new Promise<void>(done => { release = done; }); await prior;
    const working = clone(state); active = true; let creates = 0;
    const tx: Record<string, unknown> = { $executeRaw: async (strings: TemplateStringsArray) => {
      const text = strings.join('?'); sql.push(text); if (controls.denyLock && text.startsWith('LOCK TABLE')) throw Error('fixture lock timeout'); return 0;
    } };
    for (const table of Object.keys(working)) {
      const find = ({ where, take, select, orderBy }: { where?: Row; take?: number; select?: Record<string, boolean>; orderBy?: unknown } = {}) => {
        let rows = working[table].filter(row => matches(row, where));
        if (orderBy) rows = [...rows].sort((a,b) => String(a.id).localeCompare(String(b.id)));
        return rows.slice(0, take ?? rows.length).map(row => clone(select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row));
      };
      tx[table] = { findMany: async (args: Parameters<typeof find>[0]) => find(args), findUnique: async (args: Parameters<typeof find>[0]) => find(args)[0] ?? null,
        count: async ({ where }: { where?: Row } = {}) => working[table].filter(row => matches(row, where)).length + (controls.badCount === table ? 1 : 0),
        create: async ({ data }: { data: Row }) => {
          calls.push(`${table}.create`); creates++;
          if (creates === controls.failCreateNumber) throw Error('fixture insert failure');
          assert(['setParallel','setParallelScope','setAuditEvent'].includes(table), `Forbidden create ${table}`);
          assert(!working[table].some(row => row.id === data.id), 'Duplicate ID');
          const row = { ...data }; if (row.visualCuesJson === Prisma.DbNull) row.visualCuesJson = null;
          working[table].push(clone(row));
          if (controls.mutateCardDuringCreate && table === 'setParallel') working.setCard[0].playerName = 'Incorrect concurrent edit';
          return clone(row);
        }, update: () => assert.fail('No update allowed'), upsert: () => assert.fail('No upsert allowed'), delete: () => assert.fail('No delete allowed') };
    }
    try { const result = await fn(tx); state = working;
      if (controls.loseResponse) { controls.loseResponse = false; throw Error('fixture response lost'); } return result;
    } finally { active = false; release(); }
  } };
  const service = createPokemonCatalogPreparationService({ db: db as unknown as PrismaClient, readArtifact: async ref => {
    assert.equal(active, false); assert.equal(ref, plan.source.ref); return controls.badBytes ? Buffer.from('bad bytes') : sourceBytes;
  } });
  return { service, controls, calls, sql, state: () => state, request: async () => {
    const preview = await service.preview(actor);
    return { schemaVersion: 'setops-pokemon-additive-preparation-request/v1', idempotencyKey: randomUUID(),
      expectedSnapshotSha256: preview.snapshotSha256, proposalSha256: preview.proposalSha256, binding: preview.binding,
      acknowledgement: 'PREPARE PENDING POKEMON CATALOG MAPPINGS' };
  } };
}
export async function enabled(run: () => Promise<void>) {
  const old = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  try { await run(); } finally { if (old === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = old; }
}
