import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../src/repository.mjs';
import { createManualIntake } from '../src/service.mjs';
import { createPhotoProcessor } from '../src/photo-processing.mjs';
import { document } from '../src/contract.mjs';
import { memoryPhotoStorage, sha } from '../test/helpers.mjs';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';

const output = process.env.ATLAS_INTAKE_EVIDENCE;
assert(output && resolve(output) === output, 'Supply an absolute owned evidence directory');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
const checks = [], record = (name, evidence = true) => checks.push({ name, evidence });
const denied = (promise, code) => assert.rejects(promise, error => error.code === code);
let connection = fixture.connect();
async function login(phone) {
  const boot = await connection.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await connection.auth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-intake');
  const verified = await connection.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-intake');
  const signed = `${cookie}; ${fixture.config.cookies.session}=${verified.token}`;
  return { cookie: signed, csrf: verified.csrf, staff: await connection.auth.authenticate(signed, verified.csrf) };
}
const byteStore = memoryPhotoStorage(), { storage } = byteStore;
const processor = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
  maxInputBytes: 96 * 1024 * 1024, maxPixels: 50_000_000, maxRasterBytes: 400_000_000,
  maxOutputBytes: 96 * 1024 * 1024, timeoutMs: 10000 } });
let processPhoto = processor;
const compose = () => {
  const repository = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'intake', maxOriginalBytes: 64 * 1024 * 1024 });
  const service = createManualIntake({ repository, storage, artifacts: fixture.artifacts,
    processPhoto: options => processPhoto(options) });
  return { repository, service };
};
let { repository, service } = compose();
const bytes = rgb16Png(12, 16), input = side => ({ requestId: randomUUID(), side, expectedVersion: 0, sha256: sha(bytes), byteCount: bytes.length });
let stopped;
try {
  await fixture.cluster.sql(await readFile(new URL('../sql/proposal.sql', import.meta.url), 'utf8'), [], fixture.database.name);
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  await writeFile(join(output, 'startup.json'), JSON.stringify({ owned: true, directory: fixture.cluster.directory,
    nativeOriginalBytes: bytes.length, fixture: 'synthetic images and synthetic SMS, actual staff auth and PostgreSQL' }, null, 2));
  const owner = await login('+12025550141'), observer = await login('+12025550142'), other = await login('+12025550143');
  const request = { requestId: randomUUID(), label: 'Native phone card' }, first = await service.create(owner.staff, request), cardId = first.card.cardId;
  assert.equal(first.card.sides.FRONT.version, 0); assert.equal(first.card.ready, false);
  assert.deepEqual(await service.create(owner.staff, request), first);
  await denied(service.create(owner.staff, { ...request, label: 'changed' }), 'INTAKE_REQUEST_ID_CONFLICT');
  await denied(service.create(observer.staff, { requestId: randomUUID(), label: '' }), 'INTAKE_CARD_ACCESS_DENIED');
  await denied(service.read({ ...owner.staff }, cardId), 'SIGN_IN_REQUIRED');
  await denied(service.read(other.staff, cardId), 'INTAKE_CARD_NOT_FOUND');
  assert.equal((await service.list(other.staff)).cards.length, 0);
  record('real cookie/CSRF authentication, opaque handle, owner/observer denial, card provision before any photo and exact create replay');

  const frontInput = input('FRONT'), backInput = input('BACK');
  const [front, back] = await Promise.all([service.plan(owner.staff, cardId, frontInput), service.plan(owner.staff, cardId, backInput)]);
  const f1 = front.upload.uploadId, b1 = back.upload.uploadId;
  assert.equal((await service.read(owner.staff, cardId)).card.sides.FRONT.version, 1);
  assert.equal((await service.read(owner.staff, cardId)).card.sides.BACK.version, 1);
  assert.equal((await service.plan(owner.staff, cardId, frontInput)).upload.uploadId, f1);
  await denied(service.plan(owner.staff, cardId, { ...frontInput, sha256: 'f'.repeat(64) }), 'INTAKE_REQUEST_ID_CONFLICT');
  await denied(service.plan(other.staff, cardId, input('FRONT')), 'INTAKE_CARD_NOT_FOUND');
  await denied(service.plan(owner.staff, cardId, input('FRONT')), 'INTAKE_SIDE_STALE');
  record('independent simultaneous Front/Back plan versions, exact lost-plan replay, altered replay, stale and foreign-owner denial');

  await denied(service.complete(owner.staff, cardId, f1), 'INTAKE_UPLOAD_ABSENT');
  const signed = await service.sign(owner.staff, cardId, f1);
  assert.equal(signed.headers['If-None-Match'], '*'); assert.equal(signed.headers['Content-Type'], 'application/octet-stream');
  assert.equal(signed.headers['x-amz-checksum-sha256'], Buffer.from(sha(bytes), 'hex').toString('base64'));
  await storage.writeOriginal({ uploadPlan: front.upload.plan, bytes });
  await storage.writeOriginal({ uploadPlan: back.upload.plan, bytes });
  const saved = await service.complete(owner.staff, cardId, f1);
  assert(saved.upload.verification.object.versionId); assert.equal(saved.upload.source, null);
  const completeCalls = byteStore.calls.length;
  assert.deepEqual((await service.complete(owner.staff, cardId, f1)).upload.verification, saved.upload.verification);
  assert.equal(byteStore.calls.length, completeCalls);
  await denied(repository.recordVerification(owner.staff, cardId, f1, { ...saved.upload.verification,
    object: { ...saved.upload.verification.object, versionId: 'different-version' } }), 'INTAKE_UPLOAD_CONFLICT');
  record('interrupted upload remains pending; exact signed conditions; full checksum readback; immutable provider-version receipt and lost-completion replay');

  processPhoto = async () => { throw Object.assign(new Error('synthetic unsupported image'), { code: 'PHOTO_DECODE_UNSUPPORTED' }); };
  await denied(service.prepare(owner.staff, cardId, f1), 'PHOTO_DECODE_UNSUPPORTED');
  assert.deepEqual((await service.upload(owner.staff, cardId, f1)).upload.verification, saved.upload.verification);
  assert.deepEqual((await storage.readOriginal({ uploadPlan: front.upload.plan, object: saved.upload.verification.object })).bytes, bytes);
  processPhoto = processor;
  await service.prepare(owner.staff, cardId, f1); await service.prepare(owner.staff, cardId, b1);
  const pair = await service.verifiedPair(owner.staff, cardId);
  assert.equal(pair.sides.FRONT.photo.workingFrame.schemaVersion, 2);
  assert.equal(pair.sides.FRONT.photo.decodedFrame.treatment.bitDepth, 16);
  assert.equal(pair.sides.FRONT.photo.workingFrame.treatment.bitDepth, 8);
  await connection.boundary.transaction(owner.staff, ({ tx, principal }) => repository.assertCurrentPair(tx, principal, { cardId, sourceHash: pair.sourceHash }));
  record('decoder failure preserves verified original; actual decoder and SDR working frames persist independently; full pair artifact hydration and source fence');

  const backBefore = (await service.read(owner.staff, cardId)).card.sides.BACK;
  const front2 = await service.plan(owner.staff, cardId, { ...input('FRONT'), expectedVersion: 1 });
  assert.deepEqual(front2.card.sides.BACK, backBefore); assert.equal(front2.card.ready, false);
  await denied(connection.boundary.transaction(owner.staff, ({ tx, principal }) => repository.assertCurrentPair(tx, principal,
    { cardId, sourceHash: pair.sourceHash })), 'INTAKE_PAIR_STALE');
  await denied(service.sign(owner.staff, cardId, f1), 'INTAKE_SIDE_STALE');
  const stillHistorical = await service.readSource(owner.staff, cardId, f1);
  assert.deepEqual(stillHistorical.photo, pair.sides.FRONT.photo);
  await storage.writeOriginal({ uploadPlan: front2.upload.plan, bytes });
  let started, release;
  const began = new Promise(done => { started = done; }), paused = new Promise(done => { release = done; });
  processPhoto = async options => { started(); await paused; return processor(options); };
  const late = service.prepare(owner.staff, cardId, front2.upload.uploadId); await began;
  const front3 = await service.plan(owner.staff, cardId, { ...input('FRONT'), expectedVersion: 2 });
  const otherCard = await service.create(other.staff, { requestId: randomUUID(), label: 'independent grader' });
  assert(otherCard.card.cardId); release(); await late; processPhoto = processor;
  const afterLate = (await service.read(owner.staff, cardId)).card;
  assert.equal(afterLate.sides.FRONT.upload.uploadId, front3.upload.uploadId); assert.equal(afterLate.ready, false);
  assert.deepEqual(afterLate.sides.BACK, backBefore);
  await storage.writeOriginal({ uploadPlan: front3.upload.plan, bytes }); await service.prepare(owner.staff, cardId, front3.upload.uploadId);
  record('new source immediately fences old manual actions; late completed preparation stays historical; Back preserved; another grader creates while CPU is paused');

  const raced = await Promise.allSettled([1, 2].map(() => service.plan(owner.staff, cardId, { ...input('BACK'), expectedVersion: 1 })));
  assert.equal(raced.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(raced.find(item => item.status === 'rejected').reason.code, 'INTAKE_SIDE_STALE');
  const nextBack = raced.find(item => item.status === 'fulfilled').value.upload;
  await storage.writeOriginal({ uploadPlan: nextBack.plan, bytes });
  const object = byteStore.objects.get(nextBack.plan.object.key).at(-1), originalBytes = object.bytes;
  object.bytes = Buffer.from(originalBytes); object.bytes[20] ^= 1;
  await denied(service.complete(owner.staff, cardId, nextBack.uploadId), 'PHOTO_STORAGE_CONFLICT');
  assert.equal((await service.upload(owner.staff, cardId, nextBack.uploadId)).upload.verification, null);
  object.bytes = originalBytes; await service.prepare(owner.staff, cardId, nextBack.uploadId);
  record('same-side concurrent requests select only one new version; wrong actual SHA256 cannot produce verified receipt');

  const currentPair = await service.verifiedPair(owner.staff, cardId);
  const oldVersion = (await service.upload(owner.staff, cardId, f1)).upload.verification.object.versionId;
  const historicalObject = byteStore.objects.get(front.upload.plan.object.key).at(-1);
  byteStore.record({ Key: front.upload.plan.object.key, Body: Buffer.alloc(bytes.length, 7), ContentType: historicalObject.ContentType, Metadata: historicalObject.Metadata });
  assert.equal((await service.complete(owner.staff, cardId, f1)).upload.verification.object.versionId, oldVersion);
  assert.deepEqual((await storage.readOriginal({ uploadPlan: front.upload.plan,
    object: pair.sides.FRONT.photo.original.object })).bytes, bytes);
  record('later external object version never replaces verified original version; reads remain pinned to original exact bytes');

  await assert.rejects(connection.manualClient.$executeRawUnsafe('UPDATE atlas_manual_intake.card SET owner_id=$1::uuid WHERE id=$2::uuid', otherCard.card.cardId, cardId));
  await assert.rejects(connection.manualClient.$executeRawUnsafe('DELETE FROM atlas_manual_intake.upload WHERE card_id=$1::uuid', cardId));
  await assert.rejects(fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_intake.upload SET plan=plan||' ' WHERE id=$1::uuid", f1));
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_manual_intake.upload WHERE id=$1::uuid', f1));
  const compact = await fixture.admin.$queryRawUnsafe('SELECT max(octet_length(plan)+coalesce(octet_length(verification),0)+coalesce(octet_length(source),0)) AS bytes FROM atlas_manual_intake.upload');
  assert(compact[0].bytes < 8192);
  record('restricted role denies owner/delete; immutable upload SQL rejects even admin edits/deletes; no image bytes in database', { maximumUploadMetadataBytes: compact[0].bytes });

  await connection.close(); connection = fixture.connect(); ({ repository, service } = compose());
  owner.staff = await connection.auth.authenticate(owner.cookie, owner.csrf);
  assert.deepEqual(await service.verifiedPair(owner.staff, cardId), currentPair);
  assert.equal((await service.plan(owner.staff, cardId, frontInput)).upload.uploadId, f1);
  const page1 = await service.list(owner.staff, { limit: 1 }); assert.equal(page1.cards.length, 1);
  await denied(service.list(owner.staff, { cursor: otherCard.card.cardId }), 'INTAKE_CARD_NOT_FOUND');
  record('fresh clients reauthenticate same durable session and restore exact artifacts, historical plan replay, per-owner pagination');

  const pendingInput = { ...input('FRONT'), expectedVersion: 3 }, revoked = await service.plan(owner.staff, cardId, pendingInput);
  await storage.writeOriginal({ uploadPlan: revoked.upload.plan, bytes });
  let entered, proceed;
  const enteredGate = new Promise(done => { entered = done; }), proceedGate = new Promise(done => { proceed = done; });
  processPhoto = async options => { entered(); await proceedGate; return processor(options); };
  const revokedWork = service.prepare(owner.staff, cardId, revoked.upload.uploadId); await enteredGate;
  await connection.auth.logout(owner.cookie, owner.csrf); proceed();
  await denied(revokedWork, 'SIGN_IN_REQUIRED');
  const stored = await fixture.admin.$queryRawUnsafe('SELECT verification,source FROM atlas_manual_intake.upload WHERE id=$1::uuid', revoked.upload.uploadId);
  assert(stored[0].verification); assert.equal(stored[0].source, null);
  record('logout during processor work fences source commit while keeping already verified native original');
  await writeFile(join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', assertions: checks.length, output }));
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ code: error.code, message: error.message, checks }, null, 2)); throw error;
} finally {
  stopped = await fixture.stop();
  await writeFile(join(output, 'cleanup.json'), JSON.stringify({ stopped: true, result: stopped ?? null,
    directory: fixture.cluster.directory, cleanup: 'owned helper verifies exact process and removes only its owned data' }, null, 2));
}
