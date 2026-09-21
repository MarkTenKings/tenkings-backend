import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import test from 'node:test';
import type { AdminSession } from '../lib/server/admin';
import type { Prisma } from '@prisma/client';

const enabled = process.env.TEN_KINGS_POKEMON_PREPARATION_DISPOSABLE_VALIDATION === '1';
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => value !== null && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(value);
const hash = (value: unknown) => digest(canonical(value));

// No application/Prisma runtime import precedes the owned-loopback receipt.
// All row IDs and the human session are disposable. The 138 source observations
// and pinned bytes are real; this fixture confers no review/publication rights.
test('bounded Pokémon preparation qualifies the actual service on owned PostgreSQL', { skip: !enabled, timeout: 120_000 }, async t => {
  assert.equal(process.version, 'v22.23.2');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.protocol, 'postgresql:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/tenkings_pokemon_preparation_disposable'); assert.ok(url.port);
  assert.equal(url.username, 'postgres'); assert.ok(url.password);
  const receiptPath = await realpath(process.env.TEN_KINGS_POKEMON_PREPARATION_OWNERSHIP_FILE ?? '');
  assert.equal(basename(receiptPath), 'fixture-ownership.json'); assert.ok(basename(dirname(receiptPath)).startsWith('tk-pokemon-preparation-'));
  const ownership = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(ownership.schema_version, 1); assert.equal(ownership.database_url_sha256, digest(url.href));
  assert.equal(ownership.nonce, process.env.TEN_KINGS_POKEMON_PREPARATION_NONCE); assert.match(ownership.nonce, /^[a-f0-9]{48}$/);
  assert.equal(ownership.owner_uid, process.getuid!()); assert.ok(Number.isSafeInteger(ownership.postgres_pid) && ownership.postgres_pid > 1);
  process.kill(ownership.postgres_pid, 0);
  assert.equal(process.env.SET_CATALOG_EVIDENCE_ENABLED, 'true');
  for (const key of Object.keys(process.env)) assert.ok(!/^(OPENAI_API_KEY|SOLD_?COMPS_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|DIRECT_URL|SHADOW_DATABASE_URL)$/.test(key), `Unexpected credential variable: ${key}`);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('No external HTTP is allowed in this fixture.'); };
  const { PrismaClient } = await import('@prisma/client');
  const { createPokemonCatalogPreparationService, StalePokemonPreparationSnapshotError } = await import('../lib/server/setCatalogPokemonPreparation');
  const { normalizeDraftRows, createDraftVersionPayload, buildTaxonomyIngestRows } = await import('../lib/server/setOpsDrafts');
  const { buildPilotChecklistTaxonomyAdapterOutput } = await import('../lib/server/taxonomyV2PilotChecklistAdapter');
  const plan = JSON.parse(await readFile(resolve(__dirname, '../lib/server/setCatalogPokemonPreparationPlan.json'), 'utf8'));
  const docs = resolve(__dirname, '../../../docs/plans/catalog-pilot-20260916');
  const wrapperBytes = await readFile(resolve(docs, 'pokemon-complete-import.unreviewed.json'));
  assert.equal(digest(wrapperBytes), 'a36171566277e391764aae473df273a3c5fe26e54d4faa53d7802c2843d65a21');
  const input = JSON.parse(wrapperBytes.toString('utf8')).requestDraft;
  const manifest = JSON.parse(await readFile(resolve(docs, 'source-manifest.draft.json'), 'utf8'));
  const source = manifest.sources.find((s: { id: string }) => s.id === 'pokemon-checklist');
  const bytes = await readFile(source.local_evidence_path);
  assert.equal(bytes.length, 2227474); assert.equal(digest(bytes), 'd597ba707c20f1f8ec11e4809bb1f6e85bb0e502c05a93df41f36116a56dc923');
  assert.equal(plan.source.sha256, digest(bytes)); assert.equal(plan.source.byteSize, bytes.length);
  assert.equal(plan.setId, 'Black & White-Legendary Treasures'); assert.equal(plan.cards.length, 138);
  assert.equal(hash(input.rawPayload), plan.source.rawPayloadSha256); assert.equal(hash(input.sourceFetchMeta), plan.source.sourceFetchMetaSha256);
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const competitor = new PrismaClient({ datasources: { db: { url: url.href } } });
  const service = createPokemonCatalogPreparationService({ db, readArtifact: async ref => { assert.equal(ref, plan.source.ref); return bytes; } });
  const insertTables = ['SetParallel', 'SetParallelScope', 'SetAuditEvent'];
  const lockedTables = ['SetTaxonomySource', 'SetProgram', 'SetCard', 'SetParallel', 'SetParallelScope', 'SetDraft', 'SetDraftVersion',
    'SetIngestionJob', 'SetApproval', 'SetSeedJob', 'SetReplaceJob', 'SetCatalogEvidencePublication', 'SetVariation', 'SetOddsByFormat',
    'SetTaxonomyConflict', 'SetTaxonomyAmbiguityQueue', 'CardVariantTaxonomyMap'];
  try {
    const identity = await db.$queryRawUnsafe<Array<{ database: string; host: string; encoding: string }>>("SELECT current_database() AS database, host(inet_server_addr()) AS host, current_setting('server_encoding') AS encoding");
    assert.deepEqual(identity, [{ database: 'tenkings_pokemon_preparation_disposable', host: '127.0.0.1', encoding: 'UTF8' }]);
    for (const table of [...lockedTables, 'SetAuditEvent']) {
      const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${table}"`);
      assert.equal(rows[0].n, 0n, 'Never replace an existing fixture/catalog.');
    }
    const triggers = await db.$queryRawUnsafe<Array<{ name: string }>>('SELECT tgname AS name FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal', 'SetAuditEvent_catalog_immutable');
    assert.equal(triggers.length, 1, 'The canonical append-only migration must be installed.');
    const user = await db.user.create({ data: { id: randomUUID(), displayName: 'DISPOSABLE POKEMON PREPARATION FIXTURE' } });
    const actor: AdminSession = { authority: 'local-database', sessionId: 'fixture-session', tokenHash: 'f'.repeat(64), expiresAt: new Date(Date.now() + 3600000), user: { id: user.id, displayName: user.displayName, phone: null } };
    const draftId = randomUUID(), jobId = randomUUID(), sourceId = randomUUID(), versionId = randomUUID(), programRowId = randomUUID();
    const normalized = normalizeDraftRows({ datasetType: input.datasetType, fallbackSetId: plan.setId, rawPayload: input.rawPayload });
    const version = createDraftVersionPayload({ setId: plan.setId, datasetType: input.datasetType, rows: normalized.rows });
    version.dataJson.generatedAt = '2026-09-21T00:00:00.000Z';
    const { generatedAt: _generatedAt, ...versionContent } = version.dataJson;
    assert.equal(version.rowCount, 138); assert.equal(version.blockingErrorCount, 0);
    assert.equal(version.versionHash, plan.worksheet.versionHash); assert.equal(hash(versionContent), plan.worksheet.contentSha256);
    const initialSummary = { sourceProvider: input.sourceProvider, sourceQuery: input.sourceQuery, sourceFetchMeta: input.sourceFetchMeta, csvContract: null };
    const output = buildPilotChecklistTaxonomyAdapterOutput({ setId: plan.setId, datasetType: input.datasetType,
      rawPayload: buildTaxonomyIngestRows(normalized.rows), sourceUrl: input.sourceUrl, parserVersion: input.parserVersion, parseSummary: initialSummary });
    assert.equal(output.cards.length, 138);
    for (const card of output.cards) {
      const expected = plan.cards.find((c: { number: string }) => c.number === card.cardNumber);
      assert.ok(expected); assert.equal(card.playerName, expected.name); assert.equal(hash(card.metadata), expected.metadataSha256);
    }
    await db.setDraft.create({ data: { id: draftId, setId: plan.setId, normalizedLabel: plan.setId, status: 'REVIEW_REQUIRED' } });
    const summary = { ...initialSummary, draftVersionId: versionId, taxonomyIngest: { applied: true, adapter: 'pinned-pilot-checklist-v1', sourceId,
      counts: { programs: 1, cards: 138, variations: 0, parallels: 0, scopes: 0, oddsRows: 0, conflicts: 0, ambiguities: 0, bridges: 0 } } };
    await db.setIngestionJob.create({ data: { id: jobId, setId: plan.setId, draftId, datasetType: 'PLAYER_WORKSHEET', status: 'REVIEW_REQUIRED',
      sourceUrl: input.sourceUrl, parserVersion: input.parserVersion, rawPayload: input.rawPayload, parseSummaryJson: summary } });
    await db.setTaxonomySource.create({ data: { id: sourceId, setId: plan.setId, ingestionJobId: jobId, artifactType: output.artifactType,
      sourceKind: output.sourceKind, sourceLabel: output.sourceLabel, sourceUrl: input.sourceUrl, parserVersion: input.parserVersion,
      metadataJson: { ...output.metadata as Prisma.JsonObject, parseSummary: initialSummary } as Prisma.InputJsonValue } });
    await db.setProgram.create({ data: { id: programRowId, setId: plan.setId, programId: plan.programId, label: plan.programLabel, sourceId } });
    await db.setCard.createMany({ data: output.cards.map(card => ({ id: randomUUID(), setId: plan.setId, programId: plan.programId,
      cardNumber: card.cardNumber, playerName: card.playerName, team: null, isRookie: null, sourceId, metadataJson: card.metadata as Prisma.InputJsonValue })) });
    await db.setDraftVersion.create({ data: { id: versionId, draftId, version: 1, versionHash: version.versionHash, dataJson: version.dataJson as Prisma.InputJsonValue,
      validationJson: version.validationJson, sourceLinksJson: { sourceUrl: input.sourceUrl, ingestionJobId: jobId }, rowCount: 138, blockingErrorCount: 0 } });
    const preserved = async () => JSON.stringify(await Promise.all([
      db.setCard.findMany({ orderBy: { id: 'asc' } }), db.setProgram.findMany({ orderBy: { id: 'asc' } }),
      db.setDraftVersion.findMany({ orderBy: { id: 'asc' } }), db.setDraft.findMany({ orderBy: { id: 'asc' } }),
      db.setTaxonomySource.findMany({ orderBy: { id: 'asc' } }), db.setIngestionJob.findMany({ orderBy: { id: 'asc' } }),
    ]));
    const counts = async () => Promise.all([db.setIngestionJob.count(), db.setTaxonomySource.count(), db.setProgram.count(), db.setCard.count(),
      db.setDraftVersion.count(), db.setParallel.count(), db.setParallelScope.count(), db.setAuditEvent.count(), db.setApproval.count(), db.setCatalogEvidencePublication.count(),
      db.setVariation.count(), db.setOddsByFormat.count(), db.setTaxonomyConflict.count(), db.setTaxonomyAmbiguityQueue.count(), db.cardVariantTaxonomyMap.count()]);
    const baseline = await preserved(), initialCounts = await counts();
    assert.deepEqual(initialCounts, [1,1,1,138,1,0,0,0,0,0,0,0,0,0,0]);
    const unchanged = async () => { assert.deepEqual(await counts(), initialCounts); assert.equal(await preserved(), baseline); };
    const request = async () => { const p = await service.preview(actor); return { schemaVersion: 'setops-pokemon-additive-preparation-request/v1', idempotencyKey: randomUUID(),
      expectedSnapshotSha256: p.snapshotSha256, proposalSha256: p.proposalSha256, binding: p.binding, acknowledgement: 'PREPARE PENDING POKEMON CATALOG MAPPINGS' }; };

    await t.test('ordinary writes conflict with all seventeen protected tables near the 750 ms lock deadline', async () => {
      for (const table of lockedTables) {
        const r = await request();
        await competitor.$transaction(async tx => {
          // Even zero-row UPDATE takes the ordinary RowExclusiveLock.
          await tx.$executeRawUnsafe(`UPDATE "${table}" SET id = id WHERE false`);
          const started = Date.now();
          await assert.rejects(service.stage(r, actor), /lock timeout|lock_timeout|55P03/);
          const elapsed = Date.now() - started;
          assert.ok(elapsed >= 600 && elapsed < 5000, `Lock timeout must remain bounded; observed ${elapsed} ms on ${table}.`);
        }, { timeout: 8000 });
        await unchanged();
      }
    });

    await t.test('request hashes, every row binding, human authority and exact source bytes fail closed', async () => {
      const r = await request();
      await assert.rejects(service.stage({ ...r, proposalSha256: '0'.repeat(64) }, actor));
      await assert.rejects(service.stage({ ...r, expectedSnapshotSha256: '0'.repeat(64) }, actor), StalePokemonPreparationSnapshotError);
      for (const key of Object.keys(r.binding)) await assert.rejects(service.stage({ ...r, binding: { ...r.binding, [key]: randomUUID() } }, actor), StalePokemonPreparationSnapshotError);
      await assert.rejects(service.stage(r, { ...actor, authority: 'operator-key' }), /human admin/);
      const badBytes = createPokemonCatalogPreparationService({ db, readArtifact: async () => Buffer.from('wrong pinned bytes') });
      await assert.rejects(badBytes.stage(r, actor), /source bytes differ/);
      await unchanged();
    });

    await t.test('stale metadata, changed card/version and detached source/job states cannot add rows', async () => {
      const r = await request();
      await db.$executeRaw`UPDATE "SetIngestionJob" SET "parseSummaryJson" = "parseSummaryJson" || '{"note":"changed after preview"}'::jsonb WHERE id = ${jobId}`;
      await assert.rejects(service.stage(r, actor), StalePokemonPreparationSnapshotError);
      await db.$executeRaw`UPDATE "SetIngestionJob" SET "parseSummaryJson" = ${JSON.stringify(summary)}::jsonb WHERE id = ${jobId}`;
      const card = await db.setCard.findFirstOrThrow({ where: { cardNumber: '1' } });
      await db.$executeRaw`UPDATE "SetCard" SET "playerName" = 'Wrong fixture name' WHERE id = ${card.id}`;
      await assert.rejects(service.stage(r, actor), /identity or original source observation changed/);
      await db.$executeRaw`UPDATE "SetCard" SET "playerName" = ${card.playerName} WHERE id = ${card.id}`;
      await db.$executeRaw`UPDATE "SetDraftVersion" SET "versionHash" = 'wrong' WHERE id = ${versionId}`;
      await assert.rejects(service.stage(r, actor), /original latest clean/);
      await db.$executeRaw`UPDATE "SetDraftVersion" SET "versionHash" = ${version.versionHash} WHERE id = ${versionId}`;
      await db.$executeRaw`UPDATE "SetTaxonomySource" SET "ingestionJobId" = NULL WHERE id = ${sourceId}`;
      await assert.rejects(service.stage(r, actor), /source binding changed/);
      await db.$executeRaw`UPDATE "SetTaxonomySource" SET "ingestionJobId" = ${jobId} WHERE id = ${sourceId}`;
      await db.$executeRaw`UPDATE "SetIngestionJob" SET status = 'APPROVED' WHERE id = ${jobId}`;
      await assert.rejects(service.stage(r, actor), /successful Pokémon checklist ingestion/);
      await db.$executeRaw`UPDATE "SetIngestionJob" SET status = 'REVIEW_REQUIRED' WHERE id = ${jobId}`;
      await unchanged();
    });

    await t.test('a 501-row real version roster rejects before writes instead of accepting a truncated snapshot', async () => {
      const r = await request(), extraIds = Array.from({ length: 500 }, () => randomUUID());
      await db.setDraftVersion.createMany({ data: extraIds.map((id, i) => ({ id, draftId, version: i + 2, versionHash: version.versionHash, dataJson: { fixtureOnlyCapProbe: true } })) });
      try {
        await assert.rejects(service.preview(actor), /count-accounted/);
        await assert.rejects(service.stage(r, actor), /count-accounted/);
        assert.equal(await db.setParallel.count(), 0); assert.equal(await db.setAuditEvent.count(), 0);
      } finally { await db.setDraftVersion.deleteMany({ where: { id: { in: extraIds } } }); }
      await unchanged();
    });

    await t.test('each of the four data creates and the receipt create rolls the actual transaction back', async () => {
      await db.$executeRawUnsafe(`CREATE FUNCTION pokemon_fixture_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE n integer; BEGIN n := COALESCE(NULLIF(current_setting('tenkings.fixture_count', true), ''), '0')::integer + 1; PERFORM set_config('tenkings.fixture_count', n::text, true); IF n = TG_ARGV[0]::integer THEN RAISE EXCEPTION 'pokemon fixture insert failure'; END IF; RETURN NEW; END $$`);
      try {
        for (let failAt = 1; failAt <= 5; failAt++) {
          for (const table of insertTables) await db.$executeRawUnsafe(`CREATE TRIGGER pokemon_fixture_fail_insert BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION pokemon_fixture_fail_insert('${failAt}')`);
          try { await assert.rejects(service.stage(await request(), actor), /pokemon fixture insert failure/); }
          finally { for (const table of insertTables) await db.$executeRawUnsafe(`DROP TRIGGER pokemon_fixture_fail_insert ON "${table}"`); }
          await unchanged();
        }
      } finally { await db.$executeRawUnsafe('DROP FUNCTION pokemon_fixture_fail_insert()'); }
    });

    let committed: Awaited<ReturnType<typeof service.stage>>, committedRequest: Awaited<ReturnType<typeof request>>;
    const completeCounts = [1,1,1,138,1,2,2,1,0,0,0,0,0,0,0];
    await t.test('concurrent same-key calls commit once and a discarded-response replay returns identical bytes', async () => {
      committedRequest = await request();
      const results = await Promise.all([service.stage(committedRequest, actor), service.stage(committedRequest, actor)]);
      assert.deepEqual(results.map(r => r.outcome).sort(), ['recorded', 'replay']); assert.deepEqual(results[0].receipt, results[1].receipt);
      committed = results[0]; assert.equal(results[0].receiptSha256, results[1].receiptSha256);
      const replay = await service.stage(committedRequest, actor); assert.equal(replay.outcome, 'replay'); assert.deepEqual(replay.receipt, committed.receipt);
      await assert.rejects(service.stage({ ...committedRequest, idempotencyKey: randomUUID() }, actor), /already exist/);
      await assert.rejects(service.stage(committedRequest, { ...actor, user: { ...actor.user, id: randomUUID() } }), /different evidence or reviewer/);
      assert.deepEqual(await counts(), completeCounts); assert.equal(await preserved(), baseline);
    });

    await t.test('original source stays pending, four new rows keep unknown scope, and every existing byte is preserved', async () => {
      const parallels = await db.setParallel.findMany({ orderBy: { parallelId: 'asc' } }), scopes = await db.setParallelScope.findMany();
      assert.deepEqual(parallels.map(p => p.label).sort(), ['parallel set', 'standard set']); assert.equal(scopes.length, 2);
      assert.ok(parallels.every(p => p.sourceId === sourceId && p.serialDenominator === null && p.serialText === null && p.finishFamily === null && p.visualCuesJson === null));
      assert.ok(scopes.every(s => s.sourceId === sourceId && s.programId === plan.programId && s.variationId === null && s.formatKey === null && s.channelKey === null));
      const job = await db.setIngestionJob.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal(job.status, 'REVIEW_REQUIRED'); assert.equal(job.reviewedAt, null);
      assert.equal(await db.setTaxonomySource.count({ where: { id: sourceId, OR: [{ ingestionJobId: null }, { ingestionJob: { status: 'APPROVED' } }] } }), 0);
      assert.equal(committed.receipt.applicability, 'unknown'); assert.equal(committed.receipt.approved, false); assert.equal(committed.receipt.publication, null);
      assert.deepEqual(await counts(), completeCounts); assert.equal(await preserved(), baseline);
    });

    await t.test('append-only SQL trigger protects the receipt and replay cannot repair altered mappings', async () => {
      const id = `pokemon-catalog-preparation:${committedRequest.idempotencyKey}`;
      const audit = await db.setAuditEvent.findUniqueOrThrow({ where: { id } });
      await assert.rejects(db.setAuditEvent.update({ where: { id }, data: { reason: 'attempted fixture mutation' } }), /append-only/);
      await assert.rejects(db.setAuditEvent.delete({ where: { id } }), /append-only/);
      await db.$executeRaw`UPDATE "SetParallel" SET "finishFamily" = 'invented fixture foil' WHERE id = ${committed.receipt.ids.parallels[0]}`;
      await assert.rejects(service.stage(committedRequest, actor), /changed or are missing/);
      assert.equal((await db.setParallel.findUniqueOrThrow({ where: { id: committed.receipt.ids.parallels[0] } })).finishFamily, 'invented fixture foil');
      await db.$executeRaw`UPDATE "SetParallel" SET "finishFamily" = NULL WHERE id = ${committed.receipt.ids.parallels[0]}`;
      assert.equal((await service.stage(committedRequest, actor)).receiptSha256, committed.receiptSha256);
      assert.deepEqual(await db.setAuditEvent.findUniqueOrThrow({ where: { id } }), audit);
      assert.deepEqual(await counts(), completeCounts); assert.equal(await preserved(), baseline);
    });
  } finally { await Promise.allSettled([db.$disconnect(), competitor.$disconnect()]); globalThis.fetch = oldFetch; }
});
