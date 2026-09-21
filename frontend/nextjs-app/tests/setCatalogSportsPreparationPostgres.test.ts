import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import test from 'node:test';
import type { AdminSession } from '../lib/server/admin';

const enabled = process.env.TEN_KINGS_SPORTS_PREPARATION_DISPOSABLE_VALIDATION === '1';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

// Application/Prisma imports occur only after the owned-loopback receipt passes.
// Canonical IDs are reproduced inside a disposable fixture; version payloads and
// sessions are synthetic and confer no real source review or publication authority.
test('bounded sports preparation uses real PostgreSQL locks, rollback and append-only receipts', { skip: !enabled, timeout: 120_000 }, async t => {
  assert.ok(process.version.startsWith('v22.'));
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/tenkings_sports_preparation_disposable'); assert.ok(url.port);
  assert.equal(url.username, 'postgres'); assert.ok(url.password);
  const receiptPath = await realpath(process.env.TEN_KINGS_SPORTS_PREPARATION_OWNERSHIP_FILE ?? '');
  assert.equal(basename(receiptPath), 'fixture-ownership.json'); assert.ok(basename(dirname(receiptPath)).startsWith('tk-sports-preparation-'));
  const ownership = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(ownership.schema_version, 1); assert.equal(ownership.database_url_sha256, digest(url.href));
  assert.equal(ownership.nonce, process.env.TEN_KINGS_SPORTS_PREPARATION_NONCE); assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
  assert.equal(ownership.owner_uid, process.getuid!()); assert.ok(Number.isSafeInteger(ownership.postgres_pid) && ownership.postgres_pid > 1);
  process.kill(ownership.postgres_pid, 0);
  assert.equal(process.env.SET_CATALOG_EVIDENCE_ENABLED, 'true');
  for (const key of Object.keys(process.env)) assert.ok(!/^(OPENAI_API_KEY|SOLD_?COMPS_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|DIRECT_URL|SHADOW_DATABASE_URL)$/.test(key), `Unexpected credential variable: ${key}`);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('No external HTTP is allowed in this fixture.'); };
  const { PrismaClient } = await import('@prisma/client');
  const { createSportsCatalogPreparationService } = await import('../lib/server/setCatalogSportsPreparation');
  const plan = JSON.parse(await readFile(resolve(__dirname, '../lib/server/setCatalogSportsPreparationPlan.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(__dirname, 'setCatalogSportsPreparationFixture.json'), 'utf8'));
  const docs = resolve(__dirname, '../../../docs/plans/catalog-pilot-20260916');
  const report = JSON.parse(await readFile(resolve(docs, 'sports-reconciliation-report.unreviewed.json'), 'utf8'));
  const packet = JSON.parse(await readFile(resolve(docs, 'sports-publication-pilot.unsubmitted.json'), 'utf8'));
  const artifacts = new Map<string, Buffer>();
  for (const source of packet.sourceEvidence) artifacts.set(source.sourceRef, await readFile(source.localEvidencePath));
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const competitor = new PrismaClient({ datasources: { db: { url: url.href } } });
  const service = createSportsCatalogPreparationService({ db, readArtifact: async ref => { const bytes = artifacts.get(ref); assert.ok(bytes); return bytes; } });
  const tables = ['SetIngestionJob', 'SetTaxonomySource', 'SetParallel', 'SetParallelScope', 'SetAuditEvent'] as const;
  try {
    const identity = await db.$queryRawUnsafe<Array<{ database: string; host: string; encoding: string }>>("SELECT current_database() AS database, host(inet_server_addr()) AS host, current_setting('server_encoding') AS encoding");
    assert.deepEqual(identity, [{ database: 'tenkings_sports_preparation_disposable', host: '127.0.0.1', encoding: 'UTF8' }]);
    assert.equal(await db.setDraft.count({ where: { setId: plan.setId } }), 0, 'Never replace an existing fixture/catalog.');
    const triggers = await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT tgname AS name FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal', 'SetAuditEvent_catalog_immutable');
    assert.equal(triggers.length, 1, 'The canonical append-only migration must be installed.');
    const user = await db.user.create({ data: { id: randomUUID(), displayName: 'DISPOSABLE SPORTS PREPARATION FIXTURE' } });
    const actor: AdminSession = { authority: 'local-database', sessionId: 'fixture-session', tokenHash: 'f'.repeat(64), expiresAt: new Date(Date.now() + 3600000), user: { id: user.id, displayName: user.displayName, phone: null } };
    await db.setDraft.create({ data: { id: plan.existingBinding.draftId, setId: plan.setId, status: 'APPROVED' } });
    for (const version of fixture.versions) await db.setDraftVersion.create({ data: { ...version, dataJson: { fixture: true, notRealVersionPayload: true } } });
    const oldJobs = Array.from({ length: 8 }, () => randomUUID());
    await db.setIngestionJob.createMany({ data: oldJobs.map(id => ({ id, setId: plan.setId, draftId: plan.existingBinding.draftId, datasetType: 'PLAYER_WORKSHEET' as const, parserVersion: 'fixture-legacy', status: 'APPROVED' as const })) });
    for (const [index, source] of report.sourceMetadata.entries()) await db.setTaxonomySource.create({ data: { id: source.id, setId: plan.setId, sourceKind: source.sourceKind, artifactType: source.artifactType, ingestionJobId: oldJobs[index] } });
    await db.setProgram.createMany({ data: fixture.programs });
    const cardRows = report.rows.filter((r: { status: string }) => r.status === 'exact_program_number_name_match');
    await db.setCard.createMany({ data: cardRows.map((r: { canonicalCardId: string; canonicalProgramId: string; printedCardNumber: string; observedCanonicalName: string; teamComparison: { observed: string | null } }) => ({ id: r.canonicalCardId, setId: plan.setId, programId: r.canonicalProgramId, cardNumber: r.printedCardNumber, playerName: r.observedCanonicalName, team: r.teamComparison.observed, sourceId: '9e347dd0-d75a-4662-a39b-ca3567cdc150' })) });
    const preserved = async () => JSON.stringify(await Promise.all([
      db.setCard.findMany({ where: { setId: plan.setId }, orderBy: { id: 'asc' } }), db.setProgram.findMany({ where: { setId: plan.setId }, orderBy: { id: 'asc' } }),
      db.setDraftVersion.findMany({ where: { draftId: plan.existingBinding.draftId }, orderBy: { id: 'asc' } }), db.setDraft.findUnique({ where: { id: plan.existingBinding.draftId } }),
    ]));
    const baseline = await preserved();
    const counts = async () => Promise.all([db.setIngestionJob.count(), db.setTaxonomySource.count(), db.setParallel.count(), db.setParallelScope.count(), db.setAuditEvent.count(), db.setApproval.count(), db.setCatalogEvidencePublication.count()]);
    const request = async () => { const p = await service.preview(actor); return { schemaVersion: 'setops-sports-additive-preparation-request/v1', idempotencyKey: randomUUID(), expectedSnapshotSha256: p.snapshotSha256, proposalSha256: p.proposalSha256, acknowledgement: 'PREPARE PENDING SPORTS CATALOG MAPPINGS' }; };
    const initialCounts = await counts(); assert.deepEqual(initialCounts, [8,6,0,0,0,0,0]);

    await t.test('real ordinary writes conflict with each target-table lock and fail fast without partial creates', async () => {
      for (const table of ['SetTaxonomySource', 'SetParallel', 'SetParallelScope']) {
        const input = await request();
        await competitor.$transaction(async tx => {
          // UPDATE acquires the ordinary RowExclusiveLock even with zero rows.
          await tx.$executeRawUnsafe(`UPDATE "${table}" SET "setId" = "setId" WHERE false`);
          const started = Date.now();
          await assert.rejects(service.stage(input, actor), /lock timeout|lock_timeout|55P03/);
          assert.ok(Date.now() - started < 5000, 'Lock contention must fail within the bounded transaction, not wait indefinitely.');
        }, { timeout: 8000 });
        assert.deepEqual(await counts(), initialCounts); assert.equal(await preserved(), baseline);
      }
    });

    await t.test('an occupied source URL or a stale metadata snapshot cannot stage', async () => {
      const input = await request(), selected = await db.setCard.findUniqueOrThrow({ where: { id: plan.existingBinding.cards[0].cardId } });
      await db.$executeRaw`UPDATE "SetCard" SET team = 'Changed fixture team' WHERE id = ${selected.id}`;
      await assert.rejects(service.stage(input, actor), /snapshot changed/);
      await db.$executeRaw`UPDATE "SetCard" SET team = ${selected.team} WHERE id = ${selected.id}`;
      const occupied = await db.setTaxonomySource.create({ data: { setId: plan.setId, sourceKind: 'TRUSTED_SECONDARY', sourceUrl: plan.sources[0].data.sourceUrl } });
      try { await assert.rejects(service.stage(input, actor), /occupied/); }
      finally { await db.setTaxonomySource.delete({ where: { id: occupied.id } }); }
      assert.deepEqual(await counts(), initialCounts); assert.equal(await preserved(), baseline);
    });

    await t.test('failure at every one of ten data creates and the receipt create rolls the real transaction back', async () => {
      await db.$executeRawUnsafe(`CREATE FUNCTION sports_fixture_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE n integer; BEGIN n := COALESCE(NULLIF(current_setting('tenkings.fixture_count', true), ''), '0')::integer + 1; PERFORM set_config('tenkings.fixture_count', n::text, true); IF n = TG_ARGV[0]::integer THEN RAISE EXCEPTION 'sports fixture insert failure'; END IF; RETURN NEW; END $$`);
      try {
        for (let failAt = 1; failAt <= 11; failAt++) {
          for (const table of tables) await db.$executeRawUnsafe(`CREATE TRIGGER sports_fixture_fail_insert BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION sports_fixture_fail_insert('${failAt}')`);
          try { await assert.rejects(service.stage(await request(), actor), /sports fixture insert failure/); }
          finally { for (const table of tables) await db.$executeRawUnsafe(`DROP TRIGGER sports_fixture_fail_insert ON "${table}"`); }
          assert.deepEqual(await counts(), initialCounts); assert.equal(await preserved(), baseline);
        }
      } finally { await db.$executeRawUnsafe('DROP FUNCTION sports_fixture_fail_insert()'); }
    });

    let committed: Awaited<ReturnType<typeof service.stage>>;
    let committedRequest: Awaited<ReturnType<typeof request>>;
    await t.test('actual concurrent same-key calls record once; unknown-response retry returns the same immutable receipt', async () => {
      committedRequest = await request();
      const results = await Promise.all([service.stage(committedRequest, actor), service.stage(committedRequest, actor)]);
      assert.deepEqual(results.map(r => r.outcome).sort(), ['recorded', 'replay']); assert.equal(results[0].receiptSha256, results[1].receiptSha256);
      committed = results[0];
      assert.equal((await service.stage(committedRequest, actor)).receiptSha256, committed.receiptSha256, 'Caller can discard an unknown first response and retry its original key.');
      await assert.rejects(service.stage({ ...committedRequest, idempotencyKey: randomUUID() }, actor), /occupied/);
      assert.deepEqual(await counts(), [10,8,3,3,1,0,0]); assert.equal(await preserved(), baseline);
    });

    await t.test('pending jobs stay outside draft approval and every created source has a real non-null job binding', async () => {
      const jobs = await db.setIngestionJob.findMany({ where: { id: { in: committed.receipt.ids.jobs } } });
      assert.equal(jobs.length, 2);
      assert.ok(jobs.every(job => job.status === 'REVIEW_REQUIRED' && job.draftId === null && job.reviewedAt === null && job.parserVersion === 'catalog-sports-additive-preparation/v1'));
      const sources = await db.setTaxonomySource.findMany({ where: { id: { in: committed.receipt.ids.sources } } });
      assert.equal(sources.length, 2); assert.ok(sources.every(source => source.ingestionJobId && committed.receipt.ids.jobs.includes(source.ingestionJobId)));
      const legacyVisible = await db.setTaxonomySource.count({ where: { id: { in: committed.receipt.ids.sources }, OR: [{ ingestionJobId: null }, { ingestionJob: { status: 'APPROVED' } }] } });
      assert.equal(legacyVisible, 0);
      assert.equal(await db.setIngestionJob.count({ where: { id: { in: committed.receipt.ids.jobs }, draftId: plan.existingBinding.draftId } }), 0);
      assert.equal(committed.receipt.applicability.length, 9); assert.ok(committed.receipt.applicability.every(a => a.status === 'unknown'));
    });

    await t.test('the real catalog audit trigger blocks receipt update/delete and tampered rows cannot be repaired by replay', async () => {
      const id = `sports-catalog-preparation:${committedRequest.idempotencyKey}`;
      await assert.rejects(db.setAuditEvent.update({ where: { id }, data: { reason: 'attempted fixture mutation' } }), /append-only/);
      await assert.rejects(db.setAuditEvent.delete({ where: { id } }), /append-only/);
      await db.setIngestionJob.update({ where: { id: committed.receipt.ids.jobs[0] }, data: { status: 'FAILED' } });
      await assert.rejects(service.stage(committedRequest, actor), /missing or changed/);
      assert.equal((await db.setIngestionJob.findUniqueOrThrow({ where: { id: committed.receipt.ids.jobs[0] } })).status, 'FAILED');
      assert.deepEqual(await counts(), [10,8,3,3,1,0,0]); assert.equal(await preserved(), baseline);
    });
  } finally { await Promise.allSettled([db.$disconnect(), competitor.$disconnect()]); globalThis.fetch = oldFetch; }
});
