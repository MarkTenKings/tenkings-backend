import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createIntakeRepository, intakeGrantSQL } from '@atlas/manual-intake/repository';
import { createManualIntake } from '@atlas/manual-intake';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { descriptorSha256 } from '@atlas/photo-core';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createDetailsStore, connectedGrantSQL } from '../src/details.mjs';
import { createEarlyGeometryStore, earlyGeometryGrantSQL, recordEarlyGeometryIntent } from '../src/early-geometry-store.mjs';
import { geometryCacheInput } from '../src/early-geometry.mjs';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';

/** Explicitly called only inside createOwnedManualFixture; no ambient DB URL. */
export async function runEarlyGeometryPostgres({ fixture, output }) {
  assert(fixture?.cluster?.directory && fixture?.database?.name.startsWith('atlas_'));
  const checks = [], record = text => checks.push(text);
  const [installed] = await fixture.admin.$queryRawUnsafe("SELECT to_regclass('atlas_manual_connected.early_geometry')::text AS relation");
  if (!installed.relation) await fixture.cluster.sql(await readFile(new URL('../sql/early-geometry-proposal.sql', import.meta.url), 'utf8'), [], fixture.database.name);
  for (const grants of [intakeGrantSQL, connectedGrantSQL, earlyGeometryGrantSQL]) await fixture.cluster.sql(grants('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), { boundary, manualClient, auth } = connection;
  try {
    async function login() {
      const boot = await auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
      const challenge = await auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'fixture-early-geometry');
      const verified = await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-early-geometry');
      return auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
    }
    const staff = await login(), { storage } = memoryPhotoStorage();
    const repository = createIntakeRepository({ boundary, keyPrefix: 'intake', maxOriginalBytes: 1000000, sourceCommitted: recordEarlyGeometryIntent });
    const processPhoto = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
      maxInputBytes: 1000000, maxPixels: 1000000, maxRasterBytes: 8000000, maxOutputBytes: 1000000, timeoutMs: 10000 } });
    const intake = createManualIntake({ repository, storage, artifacts: fixture.artifacts, processPhoto });
    const details = createDetailsStore({ boundary, intakeRepository: repository });
    const store = createEarlyGeometryStore({ boundary, intakeRepository: repository, receiptClient: manualClient });
    const engine = { policy: 'atlas-early-photo-geometry-v1', runtime: { identity: { sources: {}, opencv: 'fixture' } }, limits: {} }, engineHash = digest(canonical(engine));
    const create = async () => (await intake.create(staff, { requestId: randomUUID(), label: 'Owned early geometry SQL proof' })).card.cardId;
    async function upload(cardId, side, expectedVersion = 0, service = intake) {
      const bytes = rgb16Png(12, 16);
      const plan = await service.plan(staff, cardId, { requestId: randomUUID(), side, expectedVersion, sha256: sha(bytes), byteCount: bytes.length });
      await storage.writeOriginal({ uploadPlan: plan.upload.plan, bytes });
      await service.complete(staff, cardId, plan.upload.uploadId);
      const result = await service.prepare(staff, cardId, plan.upload.uploadId);
      const { photo } = await service.readSource(staff, cardId, plan.upload.uploadId);
      const settings = (await details.read(staff, cardId)).details;
      return { ...result, input: geometryCacheInput(result.upload, photo, settings, engine) };
    }
    const cardId = await create(), front = await upload(cardId, 'FRONT');
    const intent = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.early_geometry_intent WHERE upload_id=$1::uuid', front.upload.uploadId);
    assert.equal(intent.length, 1); assert.equal(front.card.ready, false);
    const discovered = await store.pending(engineHash); assert(discovered.some(r => r.upload_id === front.upload.uploadId));
    assert.equal(await store.stage(front.input), true);
    const first = await store.ensure(staff, front.input), duplicate = await store.ensure(staff, front.input);
    assert.equal(first.key, duplicate.key); assert.equal(first.state, 'QUEUED');
    record('source commit durably stamps intent with no profile/opposite photo; background discovery and duplicate scheduling share one exact job');

    const rollbackId = await create();
    const refusedRepository = createIntakeRepository({ boundary, keyPrefix: 'intake', maxOriginalBytes: 1000000,
      sourceCommitted: async value => { await recordEarlyGeometryIntent(value); throw new Error('Synthetic post-intent transaction failure'); } });
    const refusedIntake = createManualIntake({ repository: refusedRepository, storage, artifacts: fixture.artifacts, processPhoto });
    await assert.rejects(upload(rollbackId, 'FRONT', 0, refusedIntake), /Synthetic post-intent transaction failure/);
    const [rollback] = await fixture.admin.$queryRawUnsafe(`SELECT u.source,(SELECT count(*)::int FROM atlas_manual_connected.early_geometry_intent i WHERE i.upload_id=u.id) AS intents
      FROM atlas_manual_intake.upload u WHERE card_id=$1::uuid`, rollbackId);
    assert.equal(rollback.source, null); assert.equal(rollback.intents, 0);
    record('deliberate failure after intent insert rolls back source and intent together while retaining original verification');

    const back = await upload(cardId, 'BACK'), otherId = await create(), other = await upload(otherId, 'FRONT');
    await store.ensure(staff, back.input); await store.ensure(staff, other.input);
    const before = (await intake.read(staff, cardId)).card;
    const claims = await Promise.all([store.claim(engineHash, randomUUID()), store.claim(engineHash, randomUUID()), store.claim(engineHash, randomUUID())]);
    assert.equal(claims.filter(Boolean).length, 2);
    const [one, two] = claims.filter(Boolean);
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", one.key);
    const recovered = await store.claim(engineHash, randomUUID()); assert(recovered); assert.notEqual(recovered.claimId, one.claimId);
    assert.equal(await store.finish(one, 'NEEDS_REVIEW', { proof: 'stale synthetic claim' }), false);
    assert.equal(await store.finish(recovered, 'NEEDS_REVIEW', { proof: 'current synthetic claim' }), true);
    assert.equal(await store.finish(two, 'NEEDS_REVIEW', { proof: 'second synthetic claim' }), true);
    assert.deepEqual((await intake.read(staff, cardId)).card, before);
    record('three concurrent DB claimers obtain only two leases; expired lease recovery fences old completion; geometry changes neither selected originals nor pair identity/revision');

    const pending = await store.claim(engineHash, randomUUID()); assert(pending);
    const priorInput = pending.input;
    await upload(priorInput.cardId, priorInput.side, priorInput.plan.binding.version);
    assert.equal(await store.finish(pending, 'NEEDS_REVIEW', { proof: 'late replaced photo' }), false);
    assert.equal((await store.read(staff, pending.input.cardId, pending.key)).state, 'FAILED');
    await assert.rejects(store.ensure(staff, priorInput), e => e.code === 'GEOMETRY_PHOTO_CHANGED');
    record('replacement during processing refuses both stale completion and stale authenticated rescheduling');

    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET state='QUEUED',result=NULL,attempts=3 WHERE key=$1", one.key);
    assert.equal(await store.claim(engineHash, randomUUID()), null);
    assert.equal((await store.read(staff, one.input.cardId, one.key)).state, 'FAILED');
    record('three interrupted automatic attempts terminate; only a new exact authenticated retry can reset the bound');

    const replay = await store.read(staff, one.input.cardId, one.key);
    const currentUpload = (await intake.read(staff, one.input.cardId)).card.sides[one.input.side].upload;
    if (currentUpload.uploadId === one.input.uploadId) {
      const retried = await store.ensure(staff, one.input, { retry: true }); assert.equal(retried.state, 'QUEUED');
      const [principal] = await fixture.admin.$queryRawUnsafe('SELECT owner_id FROM atlas_manual_intake.card WHERE id=$1::uuid', one.input.cardId);
      await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "revokedAt"=clock_timestamp(),"accessVersion"="accessVersion"+1 WHERE id=$1::uuid', principal.owner_id);
      assert.equal(await store.claim(engineHash, randomUUID()), null);
      await assert.rejects(store.ensure(staff, one.input), e => e.code === 'SIGN_IN_REQUIRED');
      record('revoked reviewer/accessVersion prevents native claims and expired staff handles cannot authorize a retry');
    } else assert(replay);
    const forged = structuredClone(front.input); forged.photoSource.photoSourceHash = 'f'.repeat(64);
    assert.equal(await store.stage(forged), false);
    record('background queue refuses a payload whose retained source does not match the selected original');

    const receipt = { status: 'PASS', productionEffects: false, checks, engineHash, database: fixture.database.name };
    await writeFile(join(output, 'early-geometry-postgres.json'), JSON.stringify(receipt, null, 2)); return receipt;
  } finally { await connection.close(); }
}
