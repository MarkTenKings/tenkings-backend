import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import { canonicalJson, validateManifest, type CatalogManifest } from '@tenkings/card-catalog-evidence';
import { assertCatalogGrants, catalogReviewEvidenceSchema, hashCatalogVerification, parseCatalogVerification,
  prepareCatalogVerification } from '../lib/server/setCatalogEvidenceMedia';
import { createSetCatalogEvidenceService } from '../lib/server/setCatalogEvidence';
import { createCardCatalogServiceHandler } from '../lib/server/cardCatalogService';
import type { AdminSession } from '../lib/server/admin';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
const imageGrant = { basis: 'owned_original', detail: 'Synthetic test image only; no real ownership assertion.', consumers: ['inventory'] };
async function setup(withImage = false) {
  const { fixture, queryFor } = await import(pathToFileURL(resolve(dirname(require.resolve('@tenkings/card-catalog-evidence')), '../tests/fixtures.mjs')).href);
  const candidate: CatalogManifest = fixture('SPORTS');
  const artifacts = new Map<string, Buffer>();
  for (const source of candidate.sources) {
    const bytes = Buffer.from(`synthetic bytes ${source.sourceId}`);
    source.sourceRef = `catalog:sha256:${digest(bytes)}`; artifacts.set(source.sourceRef, bytes);
  }
  if (!withImage) candidate.images = [];
  else {
    const image = candidate.images[0], bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'white' } }).png().toBuffer();
    Object.assign(image, { sha256: digest(bytes), mediaRef: `catalog:sha256:${digest(bytes)}`, width: 2, height: 3, mimeType: 'image/png' });
    artifacts.set(image.mediaRef, bytes);
  }
  const manifest = validateManifest(candidate);
  const reviewEvidence = { schemaVersion: 'setops-catalog-review-evidence/v2', sources: manifest.sources.map(s => ({
    sourceId: s.sourceId, taxonomySourceId: s.kind === 'OFFICIAL_CHECKLIST' ? s.sourceId : null, classificationNote: 'Synthetic classification fixture.',
    factUse: { purpose: 'catalog_facts', sourceSha256: s.sha256, detail: 'Proposed internal factual lookup; not a license or approval.', consumers: ['inventory', 'atlas'] },
  })), images: manifest.images.map(i => ({ imageId: i.imageId, grant: clone(imageGrant) })) };
  type Publication = Prisma.SetCatalogEvidencePublicationUncheckedCreateInput;
  type Approval = Prisma.SetApprovalUncheckedCreateInput & { id: string };
  let publication: Publication | null = null;
  const approvals: Approval[] = [], writes: string[] = [], reads: string[] = [];
  const draft = { id: manifest.setOps.draftId, setId: manifest.set.setId, status: 'APPROVED', archivedAt: null, currentCatalogPublicationId: null as string | null };
  const version = { id: manifest.setOps.draftVersionId, draftId: draft.id, version: 1, versionHash: manifest.setOps.legacyVersionHash, blockingErrorCount: 0 };
  const taxonomySources = manifest.sources.filter(s => s.kind === 'OFFICIAL_CHECKLIST').map(s => ({ id: s.sourceId, sourceKind: s.kind as string, sourceUrl: s.sourceUrl }));
  const cards = manifest.cards.map(c => ({ ...c, id: c.cardId, cardNumber: c.number, playerName: c.name }));
  const tx = {
    $queryRaw: async () => [],
    setDraft: { findUnique: async () => draft, update: async ({ data }: { data: { currentCatalogPublicationId: string } }) => { writes.push('SetDraft.pointer'); Object.assign(draft, data); return draft; } },
    setDraftVersion: { findUnique: async () => version, findFirst: async () => version },
    setCatalogEvidencePublication: {
      findUnique: async () => publication, findFirst: async () => publication, findUniqueOrThrow: async () => { assert.ok(publication); return publication; },
      create: async ({ data }: { data: Publication }) => { writes.push('SetCatalogEvidencePublication.create'); publication = clone(data); return publication; },
    },
    setApproval: {
      findUnique: async ({ where }: { where: { id: string } }) => approvals.find(a => a.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { id: { not: string } } }) => approvals.find(a => a.id !== where.id.not) ?? null,
      create: async ({ data }: { data: Prisma.SetApprovalUncheckedCreateInput }) => { writes.push('SetApproval.create'); const row = { ...data, id: 'fixture-fact-review' }; approvals.push(row); return row; },
    },
    setAuditEvent: { create: async () => { writes.push('SetAuditEvent.create'); return {}; } },
    setSeedJob: { count: async () => 0 }, setReplaceJob: { count: async () => 0 },
    setProgram: { findMany: async () => manifest.programs.map(p => ({ ...p, id: p.rowId })) },
    setCard: { findMany: async () => cards },
    setParallel: { findMany: async () => manifest.printings.map(p => ({ ...p, id: p.parallelRowId })) },
    setVariation: { findMany: async () => [] },
    setParallelScope: { findMany: async () => manifest.printings.map(p => ({ ...p, id: p.scopeRowId, formatKey: null, channelKey: null })) },
    setTaxonomySource: { findMany: async () => taxonomySources },
  };
  const db = { $transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx) };
  const read = async (ref: string) => { reads.push(ref); const bytes = artifacts.get(ref); assert.ok(bytes); return bytes; };
  const service = createSetCatalogEvidenceService({ db: db as never, readArtifact: read });
  const actor: AdminSession = { authority: 'local-database', sessionId: 'fixture-human-session', tokenHash: digest('fixture-human-token'),
    expiresAt: new Date(Date.now() + 3_600_000), user: { id: 'fixture-human-reviewer', displayName: null, phone: null } };
  const packet = { manifest, reviewEvidence };
  const request = async () => {
    const preview = await service.previewSetCatalogEvidence(packet, actor);
    return { ...packet, manifestSha256: preview.manifestSha256, verificationSha256: preview.verificationSha256,
      expectedCurrent: preview.expectedCurrent, expectedHistory: preview.expectedHistory, acknowledgement: 'PUBLISH REVIEWED CATALOG EVIDENCE' };
  };
  return { manifest, reviewEvidence, packet, service, actor, request, artifacts, read, reads, writes, cards, taxonomySources,
    publication: () => publication, approvals, query: queryFor(manifest) };
}

test('legacy verification source grants round-trip without a version upgrade, added fields or changed hash', () => {
  const h = 'a'.repeat(64);
  const legacy = { schemaVersion: 'setops-catalog-verification/v1', sources: [{ sourceId: 'fixture-source', taxonomySourceId: 'fixture-taxonomy',
    classificationNote: 'Synthetic legacy classification.', grant: { basis: 'permission', detail: 'Synthetic legacy recorded grant.', consumers: ['inventory'] } }],
    images: [], artifacts: [{ ref: `catalog:sha256:${h}`, sha256: h, byteSize: 10 }] };
  const before = canonicalJson(legacy), hash = digest(before), parsed = parseCatalogVerification(legacy);
  assert.equal(hash, 'a988de570ef4929ba6cfe04c910a1f9acdaca1931ff3e2d6bda62c2ba9a2c537');
  assert.equal(canonicalJson(parsed), before); assert.equal(hashCatalogVerification(parsed), hash);
  assert.equal(parsed.schemaVersion, 'setops-catalog-verification/v1'); assert.equal('factUse' in parsed.sources[0], false);
  assert.equal('observations' in parsed, false);
  assert.throws(() => parseCatalogVerification({ ...legacy, schemaVersion: 'setops-catalog-verification/v2' }));
  assert.throws(() => parseCatalogVerification({ ...legacy, schemaVersion: 'setops-catalog-verification/v3' }));
});

test('unversioned legacy review preparation still emits only verification v1 with its original source grants', async () => {
  const f = await setup();
  const legacy = { sources: f.reviewEvidence.sources.map(({ sourceId, taxonomySourceId, classificationNote }) => ({
    sourceId, taxonomySourceId, classificationNote, grant: { basis: 'permission', detail: 'Synthetic legacy fixture only.', consumers: ['inventory'] },
  })), images: [] };
  const prepared = await prepareCatalogVerification(f.manifest, legacy, f.read);
  assert.equal(prepared.verification.schemaVersion, 'setops-catalog-verification/v1');
  assert.deepEqual(prepared.verification.sources, legacy.sources);
  assert.throws(() => assertCatalogGrants(f.manifest, prepared.verification, 'atlas'), /not granted/);
});

test('fact roster is exact, checksum-bound and scoped to explicitly named consumers', async () => {
  const f = await setup(), prepared = await prepareCatalogVerification(f.manifest, f.reviewEvidence, f.read);
  assert.equal(prepared.verification.schemaVersion, 'setops-catalog-verification/v2');
  assertCatalogGrants(f.manifest, prepared.verification, 'inventory'); assertCatalogGrants(f.manifest, prepared.verification, 'atlas');
  const deny = clone(f.reviewEvidence); deny.sources[0].factUse.consumers = ['inventory'];
  const restricted = await prepareCatalogVerification(f.manifest, deny, f.read);
  assert.throws(() => assertCatalogGrants(f.manifest, restricted.verification, 'atlas'), /not authorized/);
  for (const change of ['missing', 'duplicate', 'extra', 'hash']) {
    const input = clone(f.reviewEvidence);
    if (change === 'missing') input.sources.pop();
    if (change === 'duplicate') input.sources[1] = clone(input.sources[0]);
    if (change === 'extra') input.sources.push({ ...clone(input.sources[0]), sourceId: 'unbound-source' });
    if (change === 'hash') input.sources[0].factUse.sourceSha256 = '0'.repeat(64);
    await assert.rejects(prepareCatalogVerification(f.manifest, input, f.read));
  }
  await assert.rejects(prepareCatalogVerification(f.manifest, f.reviewEvidence, async () => Buffer.from('tampered')));
});

test('explicit version and fact-use purpose cannot be downgraded, mixed with grants, or replaced by ownership', async () => {
  const f = await setup();
  for (const mutate of [
    (value: Record<string, unknown>) => { delete value.schemaVersion; },
    (value: Record<string, unknown>) => { value.schemaVersion = 'setops-catalog-review-evidence/v1'; },
    (value: Record<string, unknown>) => { value.schemaVersion = 'setops-catalog-review-evidence/v3'; },
  ]) { const input = clone(f.reviewEvidence); mutate(input); assert.equal(catalogReviewEvidenceSchema.safeParse(input).success, false); }
  for (const patch of [{ basis: 'owned_original' }, { purpose: 'image_reuse' }, { consumers: ['public'] }, { consumers: ['atlas', 'atlas'] }]) {
    const input = clone(f.reviewEvidence); Object.assign(input.sources[0].factUse, patch);
    assert.equal(catalogReviewEvidenceSchema.safeParse(input).success, false);
  }
  const mixed = clone(f.reviewEvidence); Object.assign(mixed.sources[0], { grant: imageGrant });
  assert.equal(catalogReviewEvidenceSchema.safeParse(mixed).success, false);
});

test('source fact use never replaces image grants or enlarges their consumer scope', async () => {
  const f = await setup(true);
  await assert.rejects(prepareCatalogVerification(f.manifest, { ...f.reviewEvidence, images: [] }, f.read), /rosters/);
  const substitute = { ...f.reviewEvidence, images: [{ imageId: f.manifest.images[0].imageId, factUse: f.reviewEvidence.sources[0].factUse }] };
  assert.equal(catalogReviewEvidenceSchema.safeParse(substitute).success, false);
  const prepared = await prepareCatalogVerification(f.manifest, f.reviewEvidence, f.read);
  assertCatalogGrants(f.manifest, prepared.verification, 'inventory');
  assert.throws(() => assertCatalogGrants(f.manifest, prepared.verification, 'atlas'), /not granted/);
});

test('real preview/publication/lookup validators retain human authority, taxonomy and immutable evidence binding', async () => {
  const previous = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  try {
    const f = await setup(), request = await f.request();
    assert.deepEqual(f.writes, []); assert.equal(f.publication(), null);
    await assert.rejects(f.service.publishSetCatalogEvidence(request, { ...f.actor, authority: 'operator-key' }), /human admin/);
    const changed = clone(request); changed.reviewEvidence.sources[0].factUse.detail += ' Changed after review.';
    await assert.rejects(f.service.publishSetCatalogEvidence(changed, f.actor), /changed/);
    const wrongHash = clone(request); wrongHash.reviewEvidence.sources[0].factUse.sourceSha256 = '0'.repeat(64);
    await assert.rejects(f.service.publishSetCatalogEvidence(wrongHash, f.actor), /exact source bytes/);
    f.taxonomySources[0].sourceKind = 'TRUSTED_SECONDARY'; await assert.rejects(f.request(), /classification/);
    f.taxonomySources[0].sourceKind = 'OFFICIAL_CHECKLIST';
    const originalName = f.cards[0].playerName; f.cards[0].playerName = 'Wrong card'; await assert.rejects(f.request(), /card identity/); f.cards[0].playerName = originalName;
    assert.deepEqual(f.writes, []);
    const published = await f.service.publishSetCatalogEvidence(request, f.actor);
    assert.equal(published.outcome, 'recorded'); assert.equal(f.publication()?.reviewedById, f.actor.user.id);
    assert.deepEqual(f.writes, ['SetApproval.create','SetCatalogEvidencePublication.create','SetAuditEvent.create','SetDraft.pointer']);
    assert.equal(parseCatalogVerification(f.publication()!.verificationJson).schemaVersion, 'setops-catalog-verification/v2');
    const lookup = await f.service.lookupPublishedSetCatalogEvidence({ publication: published.publication, query: f.query, consumer: 'atlas' });
    assert.equal(lookup.authority, 'host_authorized_setops_publication'); assert(lookup.candidates.length > 0);
    assert(lookup.candidates.every(c => c.images.length === 0));
    assert.deepEqual(lookup.sources, f.manifest.sources); // References/hashes, never source-file bytes.
    const stored = f.publication()!; const corrupted = clone(stored.verificationJson) as unknown as typeof f.reviewEvidence;
    corrupted.sources[0].factUse.consumers = ['inventory']; stored.verificationJson = corrupted as unknown as Prisma.InputJsonValue;
    await assert.rejects(f.service.lookupPublishedSetCatalogEvidence({ publication: published.publication, query: f.query, consumer: 'atlas' }), /integrity/);
  } finally { if (previous === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = previous; }
});

test('published fact consumer denials remain active and Atlas cannot download PDF/source artifacts', async () => {
  const previous = process.env.SET_CATALOG_EVIDENCE_ENABLED; process.env.SET_CATALOG_EVIDENCE_ENABLED = 'true';
  try {
    const f = await setup(); f.reviewEvidence.sources[0].factUse.consumers = ['inventory'];
    const published = await f.service.publishSetCatalogEvidence(await f.request(), f.actor);
    await assert.rejects(f.service.lookupPublishedSetCatalogEvidence({ publication: published.publication, query: f.query, consumer: 'atlas' }), /not authorized/);
    const allowed = await setup(), pin = (await allowed.service.publishSetCatalogEvidence(await allowed.request(), allowed.actor)).publication;
    allowed.reads.length = 0;
    await assert.rejects(allowed.service.readPublishedSetCatalogImage({ publication: pin, imageId: allowed.manifest.sources[0].sourceId, consumer: 'atlas' }), /Image is not/);
    assert.deepEqual(allowed.reads, []);
    const token = 'x'.repeat(43), handler = createCardCatalogServiceHandler('media', { service: allowed.service,
      env: { SET_CATALOG_EVIDENCE_ENABLED: 'true', CATALOG_ATLAS_SERVICE_ENABLED: 'true', CATALOG_ATLAS_SERVICE_TOKEN_SHA256: digest(token), CATALOG_ATLAS_SERVICE_SCOPES: 'media' } });
    let status = 0;
    const res = { setHeader() {}, status(value: number) { status = value; return this; }, json() { return this; }, send() { assert.fail('Source PDF must not be returned.'); } } as unknown as NextApiResponse;
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: { publication: pin, sourceRef: allowed.manifest.sources[0].sourceRef } } as NextApiRequest, res);
    assert.equal(status, 400); assert.deepEqual(allowed.reads, []);
  } finally { if (previous === undefined) delete process.env.SET_CATALOG_EVIDENCE_ENABLED; else process.env.SET_CATALOG_EVIDENCE_ENABLED = previous; }
});
