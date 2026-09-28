// Finite, owned disposable PostgreSQL qualification. Never accepts a database URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createIntakeRepository, intakeGrantSQL, ingestionGrantSQL } from '../src/repository.mjs';
import { createManualIntake } from '../src/service.mjs';
import { createPhotoProcessor } from '../src/photo-processing.mjs';
import { memoryPhotoStorage, sha } from '../test/helpers.mjs';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';

const output = process.env.ATLAS_INTAKE_EVIDENCE;
assert(output && resolve(output) === output, 'Supply an absolute owned evidence directory');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
const connection = fixture.connect(), checks = [];
const record = name => checks.push({ name, passed: true });
const denied = (promise, code) => assert.rejects(promise, error => error.code === code);
const { storage } = memoryPhotoStorage(), bytes = rgb16Png(12, 16);
const processor = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
  maxInputBytes: 96 * 1024 * 1024, maxPixels: 50_000_000, maxRasterBytes: 400_000_000,
  maxOutputBytes: 96 * 1024 * 1024, timeoutMs: 10000 } });
let processPhoto = processor, processed = 0;
const compose = (options = {}) => {
  const repository = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'intake',
    maxOriginalBytes: 64 * 1024 * 1024, includeIngestionStatus: true, ...options });
  return createManualIntake({ repository, storage, artifacts: fixture.artifacts,
    processPhoto: value => { processed++; return processPhoto(value); } });
};
const service = compose();
async function login(phone) {
  const boot = await connection.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await connection.auth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-normal-recovery');
  const verified = await connection.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-normal-recovery');
  const signed = `${cookie}; ${fixture.config.cookies.session}=${verified.token}`;
  return { cookie: signed, csrf: verified.csrf, staff: await connection.auth.authenticate(signed, verified.csrf) };
}
const queue = async uploadId => (await fixture.admin.$queryRawUnsafe(
  'SELECT * FROM atlas_manual_intake.ingestion WHERE upload_id=$1::uuid', uploadId))[0];
// These synthetic states are created only inside the owned disposable fixture.
async function attention(uploadId) {
  await fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual_intake.ingestion SET state='ATTENTION',
    stage='PREPARE',code='PHOTO_DECODE_UNSUPPORTED',attempts=greatest(attempts,3),failures=3,
    claim_id=NULL,lease_until=NULL WHERE upload_id=$1::uuid`, uploadId);
  return queue(uploadId);
}
async function plan(staff, cardId, side = 'FRONT', expectedVersion = 0) {
  const result = await service.plan(staff, cardId, { requestId: randomUUID(), side, expectedVersion,
    sha256: sha(bytes), byteCount: bytes.length });
  await storage.writeOriginal({ uploadPlan: result.upload.plan, bytes });
  await service.complete(staff, cardId, result.upload.uploadId);
  return result.upload;
}
async function card(staff) {
  const created = await service.create(staff, { requestId: randomUUID(), label: 'Owned recovery qualification' });
  return { cardId: created.card.cardId, upload: await plan(staff, created.card.cardId) };
}
function assertPreserved(before, after, changed = []) {
  for (const key of Object.keys(before)) if (!changed.includes(key)) assert.deepEqual(after[key], before[key], key);
}
try {
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql(ingestionGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await writeFile(join(output, 'startup.json'), JSON.stringify({ owned: true, directory: fixture.cluster.directory,
    fixture: 'Synthetic photos/SMS; real native decoder, current staff authentication, restricted role and full migration chain',
    productionAccess: false }, null, 2), { mode: 0o600 });
  const owner = await login('+12025550141'), other = await login('+12025550143');
  const first = await card(owner.staff), initial = await attention(first.upload.uploadId);
  const verified = (await service.upload(owner.staff, first.cardId, first.upload.uploadId)).upload;
  let sourceHooks = 0, pairHooks = 0;
  const hooked = compose({ sourceCommitted: async ({ tx, uploadId, card }) => {
    sourceHooks++;
    const [state] = await tx.$queryRawUnsafe('SELECT state,code FROM atlas_manual_intake.ingestion WHERE upload_id=$1::uuid', uploadId);
    assert.equal(state.state, 'COMPLETE'); assert.equal(state.code, null);
    assert.equal(card.ingestion[card.sides.FRONT.upload.uploadId === uploadId ? 'FRONT' : 'BACK'].state, 'COMPLETE');
  }, pairCommitted: async ({ card }) => { assert.equal(card.ready, true); pairHooks++; } });
  const recovered = await hooked.prepare(owner.staff, first.cardId, first.upload.uploadId);
  assert.equal(recovered.card.ingestion.FRONT.state, 'COMPLETE');
  assert.equal(recovered.card.ingestion.FRONT.stage, 'ADMIT');
  assert.equal(recovered.card.ingestion.FRONT.code, null);
  const completed = await queue(first.upload.uploadId);
  assert.equal(completed.failures, 0);
  assertPreserved(initial, completed, ['state', 'stage', 'code', 'failures', 'updated_at']);
  assert.deepEqual(recovered.upload.verification, verified.verification);
  assert.deepEqual(recovered.upload.plan, verified.plan);
  assert.deepEqual((await storage.readOriginal({ uploadPlan: verified.plan, object: verified.verification.object })).bytes, bytes);
  assert.equal(sourceHooks, 1); assert.equal(pairHooks, 0);
  record('Current ATTENTION resolves atomically before hooks/view; original bytes, immutable identity and attempt history remain exact');

  const decodeCount = processed;
  await attention(first.upload.uploadId);
  const replay = await hooked.prepare(owner.staff, first.cardId, first.upload.uploadId);
  assert.deepEqual(replay.upload, recovered.upload); assert.equal(processed, decodeCount);
  assert.equal(replay.card.ingestion.FRONT.state, 'COMPLETE');
  const back = await plan(owner.staff, first.cardId, 'BACK'); await attention(back.uploadId);
  const ready = await hooked.prepare(owner.staff, first.cardId, back.uploadId);
  assert.equal(ready.card.ready, true); assert.equal(pairHooks, 1);
  record('Already-prepared replay clears stale attention without decoding; second side still invokes normal prepared-pair admission hook');

  for (const withLease of [false, true]) {
    const running = await card(owner.staff), claimId = randomUUID();
    await fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual_intake.ingestion SET state='RUNNING',claim_id=$2::uuid,
      lease_until=clock_timestamp()+interval '2 minutes',attempts=2 WHERE upload_id=$1::uuid`, running.upload.uploadId, claimId);
    const before = await queue(running.upload.uploadId);
    const lease = { cardId: running.cardId, uploadId: running.upload.uploadId, ownerId: before.owner_id,
      accessVersion: before.access_version, claimId };
    const prepared = await service.prepare(owner.staff, running.cardId, running.upload.uploadId, withLease ? { lease } : {});
    assert(prepared.upload.source); assert.deepEqual(await queue(running.upload.uploadId), before);
  }
  record('Both active leased worker preparation and unleased manual preparation preserve RUNNING claim/lease and every queue field');

  const queued = await card(owner.staff);
  await service.prepare(owner.staff, queued.cardId, queued.upload.uploadId);
  assert.equal((await queue(queued.upload.uploadId)).state, 'QUEUED');
  assert.equal((await queue(queued.upload.uploadId)).stage, 'ADMIT');
  const completeBefore = await queue(first.upload.uploadId);
  await service.prepare(owner.staff, first.cardId, first.upload.uploadId);
  assert.deepEqual(await queue(first.upload.uploadId), completeBefore);
  const superseded = await card(owner.staff);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_intake.ingestion SET state='SUPERSEDED' WHERE upload_id=$1::uuid", superseded.upload.uploadId);
  const supersededBefore = await queue(superseded.upload.uploadId);
  await service.prepare(owner.staff, superseded.cardId, superseded.upload.uploadId);
  assert.deepEqual(await queue(superseded.upload.uploadId), supersededBefore);
  const legacy = await card(owner.staff), legacyBefore = await attention(legacy.upload.uploadId);
  await compose({ includeIngestionStatus: false }).prepare(owner.staff, legacy.cardId, legacy.upload.uploadId);
  assert.deepEqual(await queue(legacy.upload.uploadId), legacyBefore);
  record('QUEUED retains normal trigger progression; COMPLETE/SUPERSEDED and legacy non-ingestion composition remain unchanged');

  const rollback = await card(owner.staff), rollbackBefore = await attention(rollback.upload.uploadId);
  const failSource = compose({ sourceCommitted: async () => { throw Object.assign(new Error('Synthetic source hook failure'), { code: 'FIXTURE_SOURCE_HOOK' }); } });
  await denied(failSource.prepare(owner.staff, rollback.cardId, rollback.upload.uploadId), 'FIXTURE_SOURCE_HOOK');
  assert.deepEqual(await queue(rollback.upload.uploadId), rollbackBefore);
  assert.equal((await service.upload(owner.staff, rollback.cardId, rollback.upload.uploadId)).upload.source, null);
  const pairBefore = await attention(first.upload.uploadId), sourceBefore = (await service.upload(owner.staff, first.cardId, first.upload.uploadId)).upload;
  const failPair = compose({ pairCommitted: async () => { throw Object.assign(new Error('Synthetic pair hook failure'), { code: 'FIXTURE_PAIR_HOOK' }); } });
  await denied(failPair.prepare(owner.staff, first.cardId, first.upload.uploadId), 'FIXTURE_PAIR_HOOK');
  assert.deepEqual(await queue(first.upload.uploadId), pairBefore);
  assert.deepEqual((await service.upload(owner.staff, first.cardId, first.upload.uploadId)).upload, sourceBefore);
  record('New-source hook failure and prepared-replay pair hook failure roll back queue changes together with source transaction');

  await denied(service.prepare(other.staff, rollback.cardId, rollback.upload.uploadId), 'INTAKE_CARD_NOT_FOUND');
  await denied(service.prepare({ ...owner.staff }, rollback.cardId, rollback.upload.uploadId), 'SIGN_IN_REQUIRED');
  assert.deepEqual(await queue(rollback.upload.uploadId), rollbackBefore);
  record('Foreign owner and forged/copied staff handles cannot resolve attention');

  const stale = await card(owner.staff), staleBefore = await attention(stale.upload.uploadId);
  let entered, release;
  const enteredGate = new Promise(done => { entered = done; }), releaseGate = new Promise(done => { release = done; });
  processPhoto = async value => { entered(); await releaseGate; return processor(value); };
  const pending = service.prepare(owner.staff, stale.cardId, stale.upload.uploadId); await enteredGate;
  const replacement = await plan(owner.staff, stale.cardId, 'FRONT', 1);
  release(); const late = await pending; processPhoto = processor;
  assert.equal(late.card.sides.FRONT.upload.uploadId, replacement.uploadId); assert(late.upload.source);
  assert.deepEqual(await queue(stale.upload.uploadId), staleBefore);
  await denied(service.prepare(owner.staff, stale.cardId, stale.upload.uploadId), 'INTAKE_SIDE_STALE');
  record('Replaced side during native work retains historical source and old attention; stale retry cannot clear it');

  const revoked = await card(other.staff), revokedBefore = await attention(revoked.upload.uploadId);
  let started, proceed;
  const startedGate = new Promise(done => { started = done; }), proceedGate = new Promise(done => { proceed = done; });
  processPhoto = async value => { started(); await proceedGate; return processor(value); };
  const revokedWork = service.prepare(other.staff, revoked.cardId, revoked.upload.uploadId); await startedGate;
  await connection.auth.logout(other.cookie, other.csrf); proceed();
  await denied(revokedWork, 'SIGN_IN_REQUIRED'); processPhoto = processor;
  assert.deepEqual(await queue(revoked.upload.uploadId), revokedBefore);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT source FROM atlas_manual_intake.upload WHERE id=$1::uuid', revoked.upload.uploadId))[0].source, null);
  record('Revocation during preparation preserves attention and fences late source adoption');

  const oldAccess = await card(owner.staff), oldAccessBefore = await attention(oldAccess.upload.uploadId);
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid', oldAccessBefore.owner_id);
  const renewed = await login('+12025550141');
  const refreshed = await service.prepare(renewed.staff, oldAccess.cardId, oldAccess.upload.uploadId);
  assert(refreshed.upload.source); assert.deepEqual(await queue(oldAccess.upload.uploadId), oldAccessBefore);
  record('Newly authenticated access version cannot rewrite an older access-version ingestion intent');

  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks, actualNativePreparations: processed }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', assertions: checks.length, output }));
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ code: error.code, message: error.message, checks }, null, 2), { mode: 0o600 });
  throw error;
} finally {
  await fixture.stop();
  await writeFile(join(output, 'cleanup.json'), JSON.stringify({ stopped: true, directory: fixture.cluster.directory,
    cleanup: 'Owned helper verifies and removes only its exact disposable cluster' }, null, 2), { mode: 0o600 });
}
