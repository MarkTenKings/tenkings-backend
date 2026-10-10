import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
const enabled = process.env.TEN_KINGS_CATALOG_DEMAND_DISPOSABLE === '1';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

test('demand and photo proposals use real isolated PostgreSQL transactions and immutable evidence', { skip: !enabled, timeout: 120000 }, async t => {
  const url = new URL(process.env.DATABASE_URL ?? ''); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.protocol, 'postgresql:');
  assert.equal(url.pathname, '/tenkings_catalog_demand_disposable'); assert.ok(url.port); assert.equal(url.username, 'postgres');
  const path = await realpath(process.env.TEN_KINGS_CATALOG_DEMAND_OWNERSHIP ?? ''); assert.equal(basename(path), 'fixture-ownership.json'); assert.ok(basename(dirname(path)).startsWith('tk-catalog-demand-'));
  const ownership = JSON.parse(await readFile(path, 'utf8')); assert.equal(ownership.owner_uid, process.getuid!()); assert.equal(ownership.nonce, process.env.TEN_KINGS_CATALOG_DEMAND_NONCE);
  assert.equal(ownership.database_url_sha256, hash(url.href)); process.kill(ownership.postgres_pid, 0);
  for (const key of Object.keys(process.env)) assert.ok(!/^(OPENAI_API_KEY|SCRYDEX_API_KEY|CARD_STORAGE_SECRET_ACCESS_KEY|AWS_SECRET_ACCESS_KEY|DIRECT_URL|SHADOW_DATABASE_URL)$/.test(key));
  globalThis.fetch = async () => { throw Error('External calls forbidden in disposable fixture.'); };
  const { PrismaClient } = await import('@prisma/client'), db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const { createSetCatalogDemandService } = await import('../lib/server/setCatalogDemand');
  const { createSetCatalogReferenceService, prepareReferenceProposal } = await import('../lib/server/setCatalogReferenceProposals');
  const { canonicalJson, catalogDemandKey, catalogDemandResultHash, prepareObservationProposal } = await import('@tenkings/card-catalog-evidence');
  const { default: sharp } = await import('sharp');
  const digest = (x: unknown) => hash(canonicalJson(x));
  const demand = { category: 'SPORTS' as const, year: '2024', manufacturer: 'Panini', setName: 'Prizm', language: null };
  const acquire = async (d: typeof demand, attempt: number, empty = false) => {
    const bytes = Buffer.from('2024 Panini Prizm exact synthetic source'), sha256 = hash(bytes), url = 'https://www.paniniamerica.net/2024-prizm.csv', sourceId = digest({ url, sha256 });
    const result: any = { schemaVersion: 'catalog-demand-result/v1', demandKey: catalogDemandKey(d), demand: d, state: empty ? 'UNAVAILABLE' : 'READY', attempt, coverage: empty ? 'unknown' : 'partial',
      sources: empty ? [] : [{ sourceId, sha256, url, byteSize: bytes.length, kind: 'manufacturer' }], choices: empty ? [] : [{ rowId: 'a'.repeat(64), identity: { ...d, name: 'Example Player', cardNumber: '25' }, parallel: 'Silver Prizm', sourceId, locator: 'row:1', diagnostics: [] }],
      context: [], problems: ['UNREVIEWED_SOURCE_CANDIDATES'], capturedAt: new Date().toISOString(), snapshotHash: '' };
    result.snapshotHash = catalogDemandResultHash(result); return { result, requests: 1, artifacts: empty ? [] : [{ sourceId, sha256, bytes, contentType: 'text/csv' }] };
  };
  const savedSet = `fixture-approved-${randomUUID()}`;
  let referenceSaved: any;
  const privateArtifacts = new Map<string, Buffer>();
  try {
    // SetDraft.id participates in the current-publication composite relation;
    // match the existing catalog fixture's explicit ID instead of its checked
    // create path treating that read-only FK scalar as a database default.
    await db.setDraft.create({ data: { id: randomUUID(), setId: savedSet, status: 'APPROVED', normalizedLabel: 'Approved original must not change' } });
    await db.setProgram.create({ data: { setId: savedSet, programId: 'base', label: 'Base Set' } });
    await db.setCard.create({ data: { setId: savedSet, programId: 'base', cardNumber: '25', playerName: 'Example Player' } });
    const preserved = async () => JSON.stringify(await Promise.all([db.setDraft.findMany(), db.setCard.findMany(), db.setParallel.findMany(), db.setApproval.findMany(), db.setCatalogEvidencePublication.findMany()]));
    const before = await preserved();
    await t.test('concurrent same-set demands share one acquisition and preserve complete approved rows', async () => {
      let count = 0, release!: () => void, started!: () => void;
      const gate = new Promise<void>(r => { release = r; }), claimed = new Promise<void>(r => { started = r; });
      const service = createSetCatalogDemandService({ db, acquire: async (d, attempt) => { count++; started(); await gate; return acquire(d as typeof demand, attempt); } });
      const first = service({ demand, card: { name: 'Example Player', cardNumber: '025' } });
      await Promise.race([claimed, first.then(result => assert.fail(`Initial demand returned before acquiring: ${JSON.stringify(result)}`))]);
      const [clock] = await db.$queryRaw<{ zone: string; now: Date; leaseUntil: Date }[]>`SELECT current_setting('TimeZone') AS zone, clock_timestamp() AS now, "leaseUntil" FROM "SetCatalogDemandJob" WHERE "demandKey"=${catalogDemandKey(demand)}`;
      assert.ok(clock.leaseUntil > clock.now, `Fresh lease must remain live: ${JSON.stringify(clock)}`);
      const waiting = await Promise.all(Array.from({ length: 4 }, () => service({ demand })));
      assert.ok(waiting.every(r => r.state === 'RUNNING')); assert.equal(count, 1); release();
      const result = await first; assert.equal(result.state, 'READY'); assert.equal(result.choices.length, 1);
      assert.equal((await service({ demand, card: { name: 'Other Player', cardNumber: '25' } })).choices.length, 0); assert.equal(count, 1);
      assert.equal(await preserved(), before);
      await assert.rejects(db.$executeRaw`UPDATE "SetCatalogDemandResult" SET "resultJson"='{}'::jsonb`);
      await assert.rejects(db.$executeRaw`DELETE FROM "SetCatalogDemandSource"`);
      await assert.rejects(db.$executeRaw`UPDATE "SetCatalogDemandJob" SET "demandJson"='{}'::jsonb`);
    });
    await t.test('three unavailable attempts terminate; a third abandoned lease is recoverable without a fourth GET', async () => {
      const d = { ...demand, setName: 'Unavailable fixture' }, key = catalogDemandKey(d); let calls = 0;
      const service = createSetCatalogDemandService({ db, acquire: async (x, attempt) => { calls++; return acquire(x as typeof demand, attempt, true); } });
      for (let n = 1; n <= 3; n++) { const r = await service({ demand: d }); assert.equal(r.attempt, n); await db.$executeRaw`UPDATE "SetCatalogDemandJob" SET "nextAttemptAt"=clock_timestamp()-interval '1 second' WHERE "demandKey"=${key}`; }
      assert.equal((await service({ demand: d })).state, 'UNAVAILABLE'); assert.equal(calls, 3);
      await db.$executeRaw`UPDATE "SetCatalogDemandJob" SET state='RUNNING',"resultHash"=NULL,"leaseToken"='fixture-crash',"leaseUntil"=clock_timestamp()-interval '1 second' WHERE "demandKey"=${key}`;
      assert.equal((await service({ demand: d })).state, 'UNAVAILABLE'); assert.equal(calls, 3);
      const [row] = await db.$queryRaw<{ state: string; leaseToken: string | null }[]>`SELECT state,"leaseToken" FROM "SetCatalogDemandJob" WHERE "demandKey"=${key}`;
      assert.equal(row.state, 'UNAVAILABLE'); assert.equal(row.leaseToken, null);
    });
    await t.test('late old lease cannot overwrite a newly retained result', async () => {
      const d = { ...demand, setName: 'Lease fixture' }, key = catalogDemandKey(d); let release!: () => void, started!: () => void;
      const gate = new Promise<void>(r => { release = r; }), claimed = new Promise<void>(r => { started = r; });
      const old = createSetCatalogDemandService({ db, acquire: async (x, attempt) => { started(); await gate; return acquire(x as typeof demand, attempt); } });
      const pending = old({ demand: d });
      await Promise.race([claimed, pending.then(result => assert.fail(`Lease fixture returned before acquiring: ${JSON.stringify(result)}`))]);
      await db.$executeRaw`UPDATE "SetCatalogDemandJob" SET "leaseUntil"=clock_timestamp()-interval '1 second' WHERE "demandKey"=${key}`;
      const fresh = createSetCatalogDemandService({ db, acquire: (x, attempt) => acquire(x as typeof demand, attempt) });
      const saved = await fresh({ demand: d }); assert.equal(saved.attempt, 2); release(); await assert.rejects(pending, /lease expired/);
      assert.equal((await fresh({ demand: d })).snapshotHash, saved.snapshotHash);
    });
    await t.test('photo submission is atomic and immutable; unknown commit replay does not upload again', async () => {
      const { referenceFixture } = await import('./catalogReferenceFixtures');
      const input = await referenceFixture();
      const actor = { producer: 'atlas' as const, actorKind: 'service' as const, actorRef: 'atlas:card-catalog:v1', userId: null }; let uploads = 0, unknown = true;
      const proxy = new Proxy(db, { get(target, property) { if (property === '$transaction') return async (...args: any[]) => { const value = await (target.$transaction as any)(...args); if (unknown) { unknown = false; throw Error('Synthetic unknown committed response'); } return value; }; const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value; } });
      const service = createSetCatalogReferenceService({ db: proxy, stage: async artifact => { uploads++; privateArtifacts.set(artifact.image.mediaRef, artifact.bytes); } });
      await assert.rejects(service.submit(input, actor), /unknown committed/); const receipt = await service.submit(input, actor);
      assert.equal(receipt.outcome, 'replay'); assert.equal(uploads, 3); assert.equal(receipt.submissionSha256, prepareReferenceProposal(input, actor).submissionSha256);
      const changed = structuredClone(input); changed.images[0].permission.detail = 'Different'; await assert.rejects(service.submit(changed, actor), /replay differs/); assert.equal(uploads, 3);
      await assert.rejects(db.$executeRaw`UPDATE "SetCatalogReferenceSubmission" SET "submissionJson"='{}'::jsonb`);
      assert.equal(await preserved(), before, 'No publication, canonical rows or approved draft was touched.');
      referenceSaved = { input, receipt };
    });
    await t.test('human attaches pending capture to full review, explicitly publishes and reads shared exact/representative images', async () => {
      // @ts-expect-error Synthetic fixture is intentionally outside public package declarations.
      const { fixture } = await import('../../../packages/card-catalog-evidence/tests/fixtures.mjs');
      const { createSetCatalogEvidenceService } = await import('../lib/server/setCatalogEvidence');
      const manifest = fixture('SPORTS'); manifest.images = [];
      const user = await db.user.create({ data: { id: 'catalog-demand-fixture-human', displayName: 'Owned disposable reviewer' } });
      const actor: any = { authority: 'local-database', sessionId: randomUUID(), tokenHash: hash('owned-session'), expiresAt: new Date(Date.now() + 3600000), user: { id: user.id, phone: null, displayName: user.displayName } };
      await db.session.create({ data: { id: actor.sessionId, userId: user.id, tokenHash: actor.tokenHash, expiresAt: actor.expiresAt } });
      await db.setDraft.create({ data: { id: manifest.setOps.draftId, setId: manifest.set.setId, status: 'APPROVED' } });
      await db.setDraftVersion.create({ data: { id: manifest.setOps.draftVersionId, draftId: manifest.setOps.draftId, version: 1, versionHash: manifest.setOps.legacyVersionHash, dataJson: { rows: [], fixture: true } } });
      await db.setApproval.create({ data: { draftId: manifest.setOps.draftId, draftVersionId: manifest.setOps.draftVersionId, decision: 'APPROVED', versionHash: manifest.setOps.legacyVersionHash, approvedById: user.id } });
      const official = manifest.sources[0];
      await db.setTaxonomySource.create({ data: { id: official.sourceId, setId: manifest.set.setId, sourceKind: 'OFFICIAL_CHECKLIST' } });
      for (const source of manifest.sources) { const bytes = Buffer.from(`synthetic bytes ${source.sourceId}`); source.sourceRef = `catalog:sha256:${hash(bytes)}`; privateArtifacts.set(source.sourceRef, bytes); }
      for (const p of manifest.programs) await db.setProgram.create({ data: { id: p.rowId, setId: manifest.set.setId, programId: p.programId, label: p.label, sourceId: official.sourceId } });
      for (const c of manifest.cards) await db.setCard.create({ data: { id: c.cardId, setId: manifest.set.setId, programId: c.programId, cardNumber: c.number, playerName: c.name, sourceId: official.sourceId } });
      const seen = new Set();
      for (const p of manifest.printings) {
        if (!seen.has(p.parallelRowId)) { await db.setParallel.create({ data: { id: p.parallelRowId, setId: manifest.set.setId, parallelId: p.parallelId, label: p.label, sourceId: official.sourceId } }); seen.add(p.parallelRowId); }
        await db.setParallelScope.create({ data: { id: p.scopeRowId, setId: manifest.set.setId, scopeKey: p.scopeRowId, parallelId: p.parallelId, programId: p.programId, sourceId: official.sourceId } });
      }
      const reviewEvidence = { schemaVersion: 'setops-catalog-review-evidence/v2', images: [], sources: manifest.sources.map((s: any) => ({ sourceId: s.sourceId, taxonomySourceId: s.kind === 'OFFICIAL_CHECKLIST' ? s.sourceId : null,
        classificationNote: 'Synthetic fixture', factUse: { purpose: 'catalog_facts', sourceSha256: s.sha256, detail: 'Owned fixture facts', consumers: ['inventory', 'atlas'] } })) };
      const reference = createSetCatalogReferenceService({ db });
      const selected = await reference.prepare({ action: 'prepare', proposalId: referenceSaved.receipt.proposalId, proposalSha256: referenceSaved.receipt.proposalSha256,
        submissionSha256: referenceSaved.receipt.submissionSha256, packet: { manifest, reviewEvidence }, imageId: referenceSaved.input.proposal.images[0].imageId,
        depicted: { cardId: manifest.cards[0].cardId, printingId: manifest.printings[0].printingId }, representsPrintingIds: [manifest.printings[0].printingId],
        visibleDiagnosticIds: [manifest.printings[0].diagnostics[0].id], reviewNote: 'Explicit test reviewer confirms this depicted identity, representative finish and proposed permission.', acknowledgement: 'PREPARE PHOTO FOR FULL CATALOG REVIEW' }, actor);
      assert.equal(await db.setCatalogEvidencePublication.count(), 0, 'Attachment is not publication.');
      const service = createSetCatalogEvidenceService({ db, readArtifact: async ref => { const bytes = privateArtifacts.get(ref); assert.ok(bytes); return bytes; } });
      const preview = await service.previewSetCatalogEvidence(selected.packet, actor);
      const request = { ...selected.packet, manifestSha256: preview.manifestSha256, verificationSha256: preview.verificationSha256, expectedCurrent: preview.expectedCurrent,
        expectedHistory: preview.expectedHistory, acknowledgement: 'PUBLISH REVIEWED CATALOG EVIDENCE' };
      const published = await service.publishSetCatalogEvidence(request, actor); assert.equal(published.outcome, 'recorded');
      assert.equal((await service.publishSetCatalogEvidence(request, actor)).outcome, 'replay');
      for (const consumer of ['atlas', 'inventory'] as const) for (const [index, relationship] of [[0, 'depicts_candidate_identity'], [1, 'representative_finish']] as const) {
        const found = await service.lookupPublishedSetCatalogEvidence({ publication: published.publication, consumer, query: { category: 'SPORTS', setId: manifest.set.setId,
          cardId: manifest.cards[index].cardId, printingLabel: 'Silver', language: 'en', edition: 'standard' } });
        assert.equal(found.candidates[0].images[0].relationship, relationship);
        const actual = await service.readPublishedSetCatalogImage({ publication: published.publication, imageId: found.candidates[0].images[0].imageId, consumer });
        assert.equal(hash(actual.bytes), found.candidates[0].images[0].sha256);
      }
      assert.equal((await db.setDraft.findUniqueOrThrow({ where: { setId: savedSet } })).normalizedLabel, 'Approved original must not change');
    });
    await t.test('new-set admission quota refuses before dispatch while cached set reads still work', async () => {
      const [initial] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "SetCatalogDemandJob"`;
      for (let i = Number(initial.count); i < 20; i++) { const d = { ...demand, setName: `Quota fixture ${i}` }; await db.$executeRaw`INSERT INTO "SetCatalogDemandJob" ("demandKey","demandJson",state) VALUES (${catalogDemandKey(d)},${canonicalJson(d)}::jsonb,'QUEUED')`; }
      const service = createSetCatalogDemandService({ db, acquire: async () => assert.fail('Quota refusal dispatched') });
      await assert.rejects(service({ demand: { ...demand, setName: 'Twenty-first set' } }), /capacity/);
      assert.equal((await service({ demand })).state, 'READY');
    });
  } finally { await db.$disconnect(); }
});
