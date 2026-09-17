import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hashManifest, validateManifest, type CatalogManifest } from '@tenkings/card-catalog-evidence';
import { createSetCatalogEvidenceService } from '../lib/server/setCatalogEvidence';
import { prepareCatalogVerification } from '../lib/server/setCatalogEvidenceMedia';
import type { AdminSession } from '../lib/server/admin';

// The real loader/writer consume these records; no database or provider is used.
async function setup() {
  const { fixture, queryFor } = await import(pathToFileURL(resolve(dirname(require.resolve('@tenkings/card-catalog-evidence')), '../tests/fixtures.mjs')).href);
  const candidate: CatalogManifest = fixture('SPORTS'); candidate.images = [];
  const artifacts = new Map<string, Buffer>();
  for (const source of candidate.sources) {
    source.sourceRef = `catalog:sha256:${source.sha256}`;
    artifacts.set(source.sourceRef, Buffer.from(`synthetic bytes ${source.sourceId}`));
  }
  const manifest = validateManifest(candidate);
  const grant = { basis: 'owned_original', detail: 'Synthetic local regression fixture.', consumers: ['inventory', 'atlas'] };
  const reviewEvidence = { sources: manifest.sources.map(s => ({ sourceId: s.sourceId, taxonomySourceId: s.kind === 'OFFICIAL_CHECKLIST' ? s.sourceId : null, classificationNote: 'Synthetic fixture.', grant })), images: [] };
  const prepared = await prepareCatalogVerification(manifest, reviewEvidence, async ref => artifacts.get(ref)!);
  const row = { id: 'fixture:publication', draftId: manifest.setOps.draftId, draftVersionId: manifest.setOps.draftVersionId,
    setApprovalId: 'fixture:review', revision: 1, manifestJson: manifest, manifestSha256: hashManifest(manifest), verificationJson: prepared.verification,
    verificationSha256: prepared.verificationSha256, reviewedById: 'fixture:reviewer', reviewedAt: new Date('2026-09-16T00:00:01.000Z'), supersedesPublicationId: null };
  const draft = { id: row.draftId, setId: manifest.set.setId, status: 'APPROVED', archivedAt: null as Date | null, currentCatalogPublicationId: row.id };
  const version = { id: row.draftVersionId, draftId: row.draftId, version: 1, versionHash: manifest.setOps.legacyVersionHash, blockingErrorCount: 0 };
  const approval = { id: row.setApprovalId, decision: 'APPROVED', draftId: row.draftId, draftVersionId: row.draftVersionId, approvedById: row.reviewedById,
    versionHash: version.versionHash, createdAt: row.reviewedAt, diffSummaryJson: { catalogPublicationId: row.id, manifestSha256: row.manifestSha256, verificationSha256: row.verificationSha256 } };
  const state = { latestVersion: { ...version }, seedJobs: 0, replacements: 0, approvals: [{ ...approval }] };
  const tx = {
    $queryRaw: async () => [],
    setDraft: { findUnique: async () => draft },
    setCatalogEvidencePublication: { findUnique: async () => row, findFirst: async () => row },
    setDraftVersion: { findUnique: async () => version, findFirst: async () => state.latestVersion },
    setSeedJob: { count: async () => state.seedJobs }, setReplaceJob: { count: async () => state.replacements },
    setApproval: { findUnique: async () => approval, findFirst: async (input: { where: { id: { not: string }; createdAt: { gte: Date } } }) => state.approvals.find(a => a.id !== input.where.id.not && a.createdAt >= input.where.createdAt.gte) ?? null },
    setProgram: { findMany: async () => manifest.programs.map(p => ({ ...p, id: p.rowId })) },
    setCard: { findMany: async () => manifest.cards.map(c => ({ ...c, id: c.cardId, cardNumber: c.number, playerName: c.name })) },
    setParallel: { findMany: async () => manifest.printings.map(p => ({ ...p, id: p.parallelRowId })) },
    setVariation: { findMany: async () => [] },
    setParallelScope: { findMany: async () => manifest.printings.map(p => ({ ...p, id: p.scopeRowId, formatKey: null, channelKey: null })) },
    setTaxonomySource: { findMany: async () => manifest.sources.filter(s => s.kind === 'OFFICIAL_CHECKLIST').map(s => ({ id: s.sourceId, sourceKind: s.kind, sourceUrl: s.sourceUrl })) },
  };
  const db = { $transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx) };
  const service = createSetCatalogEvidenceService({ db: db as never, readArtifact: async ref => artifacts.get(ref)! });
  const pin = { publicationId: row.id, setId: draft.setId, revision: row.revision, manifestSha256: row.manifestSha256 };
  const actor: AdminSession = { authority: 'local-database', sessionId: 'fixture:session', tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 3600000), user: { id: row.reviewedById, displayName: null, phone: null } };
  const request = { manifest, reviewEvidence, manifestSha256: row.manifestSha256, verificationSha256: row.verificationSha256,
    expectedCurrent: null, expectedHistory: null, acknowledgement: 'PUBLISH REVIEWED CATALOG EVIDENCE' };
  const unavailable = async () => {
    assert.equal(await service.loadCurrentSetCatalogPublication({ setId: pin.setId }), null);
    assert.equal(await service.isSetCatalogPublicationCurrent(pin, 'atlas'), false);
    await assert.rejects(service.lookupPublishedSetCatalogEvidence({ publication: pin, query: queryFor(manifest) }), (e: unknown) => (e as { statusCode: number }).statusCode === 404);
    await assert.rejects(service.readPublishedSetCatalogImage({ publication: pin, imageId: 'unavailable' }), /unavailable/);
    const replay = await service.publishSetCatalogEvidence(request, actor);
    assert.equal(replay.outcome, 'replay'); assert.equal(replay.current, false);
  };
  return { state, draft, version, approval, service, pin, unavailable };
}

test('latest draft, ordinary approval and active operations cannot restore stale full-manifest authority', async t => {
  const previous = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  try {
    await t.test('a newer clean draft remains unavailable after ordinary approval', async () => {
      const f = await setup(); assert.deepEqual(await f.service.loadCurrentSetCatalogPublication({ setId: f.pin.setId }), f.pin);
      f.draft.status = 'REVIEW_REQUIRED'; f.state.latestVersion = { ...f.version, id: 'fixture:new-version', version: 2 };
      await f.unavailable(); f.draft.status = 'APPROVED'; await f.unavailable();
    });
    await t.test('archive, unarchive and same-version ordinary reapproval require fresh full review', async () => {
      const f = await setup(); f.draft.archivedAt = new Date(); f.draft.status = 'ARCHIVED'; await f.unavailable();
      f.draft.archivedAt = null; f.draft.status = 'DRAFT'; await f.unavailable();
      f.state.approvals.push({ ...f.approval, id: 'fixture:legacy-reapprove', createdAt: new Date(f.approval.createdAt.getTime() + 1) });
      f.draft.status = 'APPROVED'; await f.unavailable();
    });
    await t.test('later rejection and ambiguous review timestamp ties cannot supply current authority', async () => {
      for (const decision of ['APPROVED', 'REJECTED']) {
        const f = await setup(); f.state.approvals.push({ ...f.approval, id: 'fixture:later-legacy-review', decision }); await f.unavailable();
      }
    });
    await t.test('blocking validation errors and active seed/replace work suspend all current reads and replay receipts', async () => {
      const f = await setup(); f.state.latestVersion.blockingErrorCount = 1; await f.unavailable(); f.state.latestVersion.blockingErrorCount = 0;
      f.state.seedJobs = 1; await f.unavailable(); f.state.seedJobs = 0; f.state.replacements = 1; await f.unavailable();
      f.state.replacements = 0; assert.deepEqual(await f.service.loadCurrentSetCatalogPublication({ setId: f.pin.setId }), f.pin);
    });
  } finally { if (previous === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = previous; }
});
