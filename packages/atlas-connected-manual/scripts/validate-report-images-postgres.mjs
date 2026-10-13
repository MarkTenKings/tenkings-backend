// Finite owned synthetic PostgreSQL qualification. Never accepts an existing DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createMachineStaffBoundary, machineGrantSQL } from '@atlas/manual-service/machine-auth';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { canonical, digest } from '@atlas/manual-service/contract';
import sharp from 'sharp';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '@atlas/photo-runtime';
import { document } from '@atlas/manual-intake/contract';
import { createIntakeRepository, intakeGrantSQL } from '@atlas/manual-intake/repository';
import { createPublicationRepository, publicationGrantSQL } from '../src/publication-repository.mjs';
import { createManualPublication } from '../src/publication.mjs';
import { createReportImageStore, reportImageGrantSQL } from '../src/report-image-store.mjs';
import { recordCardImageIntent } from '../src/card-image-store.mjs';
import { REPORT_IMAGE_RECIPE } from '../src/report-image-provider.mjs';
import { publicationFixture } from '../test/publication-fixture.mjs';

const output = process.env.ATLAS_REPORT_IMAGES_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute owned evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2)), connection = fixture.connect();
try {
  for (const grant of [machineGrantSQL, intakeGrantSQL, publicationGrantSQL, reportImageGrantSQL])
    await fixture.cluster.sql(grant('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection;
  const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await auth.send(browser, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'report-image-fixture');
  const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'report-image-fixture');
  const staff = await auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  const principal = await boundary.transaction(staff, async ({ principal }) => principal);
  const machine = createMachineStaffBoundary({ boundary, auth, manualClient });
  const store = createReportImageStore({ boundary: machine, client: manualClient }), checks = [];
  const intake = createIntakeRepository({ boundary, keyPrefix: 'synthetic-cutout', maxOriginalBytes: 2_000_000, sourceCommitted: recordCardImageIntent });
  async function publish() {
    const pub = await publicationFixture(), createId = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Synthetic report image qualification')`, pub.cardId, randomUUID(), principal.id, createId, digest(createId));
    const repository = createPublicationRepository({ boundary }), manual = createManualRepository({ boundary, approvalCommitted: repository.approvalCommitted });
    await manual.provision(staff, { cardId: pub.cardId, draft: pub.draft });
    const service = createManualService({ repository: manual, reduce: ({ card }) => card.draft, buildReport: async () => pub.approval });
    await service.execute(staff, pub.cardId, { actionId: pub.actionId, expectedRevision: 1, action: { type: 'APPROVE_REPORT', reportHash: pub.row.report_hash, reviewed: true } });
    const publication = createManualPublication({ repository, artifacts: pub.artifacts, storage: pub.storage,
      readSource: async (_staff, _id, upload) => ({ photo: pub.photos[upload.side] }) });
    await publication.publish(staff, pub.cardId, pub.actionId);
    return { row: (await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=$1::uuid', pub.cardId))[0], createId, pub };
  }
  async function prepare(entry, side, color, compressionLevel = 9) {
    const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: color } })
      .withIccProfile('srgb').png({ compressionLevel }).toBuffer();
    const current = await intake.read(staff, entry.row.card_id);
    const { upload } = await intake.plan(staff, entry.row.card_id, { requestId: randomUUID(), side,
      expectedVersion: current.card.sides[side].version, sha256: digest(bytes), byteCount: bytes.length });
    const observed = { object: upload.plan.object, sha256: digest(bytes), byteCount: bytes.length, contentType: 'application/octet-stream' };
    await intake.recordVerification(staff, entry.row.card_id, upload.uploadId, observed);
    const decoded = await verifyAndDecodePhoto({ bytes, uploadPlan: upload.plan, observedObject: observed.object,
      limits: { maxInputBytes: 2_000_000, maxPixels: 1_000_000, maxRasterBytes: 8_000_000, maxOutputBytes: 4_000_000, timeoutMs: 5000 } });
    const working = await deriveSdrWorkingPhoto(decoded);
    const descriptor = describeDecodedFrame(working, { id: 'working', object: { key: `synthetic/working/${upload.uploadId}.png`, versionId: null } });
    const media = { descriptor, frame: descriptor, original: working.original, decodePlan: working.decodePlan };
    await intake.recordSource(staff, entry.row.card_id, upload.uploadId,
      { verificationHash: document(observed).hash, source: { fixture: 'saved private PHOTO_SOURCE', sha256: digest(canonical(media)) } });
    const candidate = (await store.photoCandidates(32)).find(x => x.upload_id === upload.uploadId);
    assert(candidate); assert(await store.photoIntent(entry.row.card_id, upload.uploadId, side));
    return { candidate, media };
  }
  const countJobs = async () => Number((await fixture.admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual_connected.report_image_job'))[0].n);
  const bind = (entry, side, photo) => store.bindPhotoToPublication(entry.row, side, { ...photo.media,
    descriptor: { raster: { content: { sha256: digest(entry.pub.bytes[side]) } } } });
  const first = await publish(), second = await publish();
  const before = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication ORDER BY card_id');
  assert.equal((await store.candidates()).length, 2);
  const f1 = await prepare(first, 'FRONT', '#abcdef', 0), f2 = await prepare(second, 'FRONT', '#abcdef', 9);
  assert.notEqual(f1.media.original.content.sha256, f2.media.original.content.sha256);
  assert.equal(f1.media.descriptor.raster.content.sha256, f2.media.descriptor.raster.content.sha256);
  await assert.rejects(store.enqueuePhoto(f1.candidate, f2.media, REPORT_IMAGE_RECIPE), { code: 'REPORT_IMAGE_SOURCE_MISMATCH' });
  const mutated = structuredClone(f1.media); mutated.descriptor.sourceToFrame[2]++;
  await assert.rejects(store.enqueuePhoto(f1.candidate, mutated, REPORT_IMAGE_RECIPE), { code: 'PHOTO_SOURCE_MISMATCH' });
  const alteredPlan = structuredClone(f1.media); alteredPlan.original.object.versionId = 'not-verified';
  await assert.rejects(store.enqueuePhoto(f1.candidate, alteredPlan, REPORT_IMAGE_RECIPE));
  assert.equal(await countJobs(), 0);
  const front = await store.enqueuePhoto(f1.candidate, f1.media, REPORT_IMAGE_RECIPE);
  assert.equal(await store.enqueuePhoto(f1.candidate, f1.media, REPORT_IMAGE_RECIPE), front);
  const alternateFront = await store.enqueuePhoto(f2.candidate, f2.media, REPORT_IMAGE_RECIPE);
  assert.notEqual(alternateFront, front, 'Different upload IDs require separately bound generated-image jobs');
  const b1 = await prepare(first, 'BACK', '#123456'), b2 = await prepare(second, 'BACK', '#123456');
  const back = await store.enqueuePhoto(b1.candidate, b1.media, REPORT_IMAGE_RECIPE);
  const alternateBack = await store.enqueuePhoto(b2.candidate, b2.media, REPORT_IMAGE_RECIPE);
  assert.equal(b1.media.original.content.sha256,b2.media.original.content.sha256);
  assert.notEqual(alternateBack,back,'Identical bytes on different uploads cannot share generated-image authority');
  assert.equal((await store.photoCandidates()).length, 0);
  assert.equal(await countJobs(), 4);
  assert.equal((await store.photo(second.row.card_id, f2.candidate.upload_id, 'FRONT')).bound_original_sha256, f2.media.original.content.sha256);
  assert.equal(await store.photo(second.row.card_id, f2.candidate.upload_id, 'BACK'), null);
  for (const [entry, frontPhoto, backPhoto] of [[first, f1, b1], [second, f2, b2]]) {
    assert(await bind(entry, 'FRONT', frontPhoto)); assert(await bind(entry, 'BACK', backPhoto)); assert(await bind(entry, 'FRONT', frontPhoto));
  }
  assert.equal((await store.candidates()).length, 0); assert.equal(await countJobs(), 4);
  assert.equal('enqueue' in store, false, 'Retired publication enqueue/import cannot execute');
  checks.push('verified current uploads admit jobs before grading; different upload IDs use separate jobs even with identical original bytes or decoded pixels; same-upload retry is idempotent');
  checks.push('wrong upload, changed working transform and unverified original are refused before enqueue; binding reports and repeated discovery create no new jobs');
  assert.equal(await store.claim(2, 'f'.repeat(64)), null);
  assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT sum(attempts) n FROM atlas_manual_connected.report_image_job'))[0].n), 0);
  let claims = (await Promise.all([store.claim(4), store.claim(4), store.claim(4), store.claim(4)])).filter(Boolean);
  while (claims.length < 4) { const next = await store.claim(4); assert(next); claims.push(next); }
  assert.equal(claims.length,4);assert.equal(await store.claim(4), null);
  const a = claims.find(x => x.key === front), b = claims.find(x => x.key === back), alternate = claims.find(x => x.key === alternateFront), alternateBackClaim = claims.find(x => x.key === alternateBack);
  assert(await store.renew(a)); assert.equal(await store.dispatch({ ...a, claim_id: randomUUID() }), false);
  assert(await store.dispatch(a)); assert(await store.recordReceipt(a, { providerRequestId: 'req_a', usage: { output_tokens: 10 } }));
  assert.equal(await store.recordReceipt(a, { providerRequestId: 'req_a' }), false);
  assert(await store.finish(a, { result: { fixture: true }, receipt: { providerRequestId: 'req_a' } }));
  assert((await store.ready(first.row, 'FRONT')).result.fixture); assert.equal(await store.ready(second.row, 'FRONT'),null);
  assert(await store.dispatch(alternate));assert(await store.finish(alternate,{result:{fixture:true},receipt:{providerRequestId:'req_alternate'}}));
  assert((await store.ready(second.row,'FRONT')).result.fixture);
  assert(await store.dispatch(alternateBackClaim));assert(await store.finish(alternateBackClaim,{result:{fixture:true},receipt:{providerRequestId:'req_alternate_back'}}));
  assert.deepEqual((await store.readyMany(first.row)).map(job => job.side), ['FRONT']);
  assert.deepEqual(await store.readyMany({ ...first.row, manifest_hash: 'd'.repeat(64) }), []);
  assert.equal(await store.ready({ ...first.row, manifest_hash: 'd'.repeat(64) }, 'FRONT'), null);
  await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET state='QUEUED',result=NULL,result_hash=NULL WHERE key=$1", front), /immutable/);
  checks.push('global bounded claims, renewable claim fencing, exact publication selection, immutable ready output and retired publication enqueue removal pass');
  assert(await store.dispatch(b));
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", b.key);
  assert.equal(await store.finish(b, { result: { stale: true } }), false);
  assert.equal(await store.claim(2), null);
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT state FROM atlas_manual_connected.report_image_job WHERE key=$1', b.key))[0].state, 'UNKNOWN');
  assert(await store.recordReceipt(b, { providerRequestId: 'req_late', usage: { output_tokens: 20 } }));
  // Replacing a current upload revokes queued/running authorization. A paid
  // request receipt remains appendable, but cannot become a current cutout.
  const replaced = await publish(), old = await prepare(replaced, 'FRONT', '#2255cc');
  const oldKey = await store.enqueuePhoto(old.candidate, old.media, REPORT_IMAGE_RECIPE);
  const staleClaim = await store.claim(1); assert.equal(staleClaim.key, oldKey); assert(await store.dispatch(staleClaim));
  const replacement = await prepare(replaced, 'FRONT', '#ff9933');
  assert.equal(await store.photoIntent(replaced.row.card_id, old.candidate.upload_id, 'FRONT'), false);
  assert.equal(await store.photo(replaced.row.card_id, old.candidate.upload_id, 'FRONT'), null);
  assert.equal(await store.renew(staleClaim), false); assert.equal(await store.finish(staleClaim, { result: { stale: true } }), false);
  assert(await store.recordReceipt(staleClaim, { providerRequestId: 'req_replaced' }));
  await assert.rejects(store.enqueuePhoto(old.candidate, old.media, REPORT_IMAGE_RECIPE), { code: 'REPORT_IMAGE_SOURCE_CHANGED' });
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", oldKey);
  assert.equal(await store.claim(1), null);
  const replacementKey = await store.enqueuePhoto(replacement.candidate, replacement.media, REPORT_IMAGE_RECIPE);
  const replacementClaim = await store.claim(1); assert.equal(replacementClaim.key, replacementKey);
  // A second replacement before the paid dispatch prevents any request.
  await prepare(replaced, 'FRONT', '#335577');
  assert.equal(await store.dispatch(replacementClaim), false);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1", replacementKey);
  assert.equal(await store.claim(1), null);
  checks.push('replacement before dispatch prevents the request; replacement after dispatch fences adoption and retains the paid receipt without reissuing it');
  const third = await publish(), thirdPhoto = await prepare(third, 'FRONT', '#ccaa11');
  const thirdKey = await store.enqueuePhoto(thirdPhoto.candidate, thirdPhoto.media, REPORT_IMAGE_RECIPE);
  let retry = await store.claim(1); assert.equal(retry.key, thirdKey); assert(await store.dispatch(retry));
  await store.recordReceipt(retry, { status: 429 });
  assert(await store.finish(retry, { code: 'REPORT_IMAGE_RATE_LIMITED', disposition: 'RETRY', receipt: { status: 429 } }));
  assert.equal(await store.claim(1), null);
  for (let attempt = 2; attempt <= 6; attempt++) {
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.report_image_job SET available_at=clock_timestamp()-interval '1 second' WHERE key=$1", thirdKey);
    retry = await store.claim(1); assert.equal(retry.attempts, attempt); await store.dispatch(retry);
    await store.recordReceipt(retry, { status: 429 }); await store.finish(retry, { code: 'REPORT_IMAGE_RATE_LIMITED', disposition: 'RETRY' });
  }
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT state FROM atlas_manual_connected.report_image_job WHERE key=$1', thirdKey))[0].state, 'FAILED');
  checks.push('crash after dispatch becomes UNKNOWN without reissue; late receipt is retained; explicit rejected-request retry backs off and stops after six attempts');
  const fourth = await publish(), fourthPhoto = await prepare(fourth, 'FRONT', '#ddbb22');
  const fourthKey = await store.enqueuePhoto(fourthPhoto.candidate, fourthPhoto.media, REPORT_IMAGE_RECIPE);
  const retiring = await store.claim(1); assert.equal(retiring.key, fourthKey); await store.dispatch(retiring);
  const tombstone = randomUUID();
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
    VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`, principal.id, tombstone, digest('{}'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, principal.id, fourth.createId, fourth.row.card_id, tombstone);
  assert.equal(await store.renew(retiring), false); assert.equal(await store.finish(retiring, { result: { invalid: true } }), false);
  assert(await store.recordReceipt(retiring, { providerRequestId: 'req_retired', usage: { output_tokens: 30 } }));
  assert.equal(await store.ready(fourth.row, 'FRONT'), null);
  const after = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=ANY($1::uuid[]) ORDER BY card_id', before.map(x => x.card_id));
  assert.deepEqual(after, before);
  const [permissions] = await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_manual','atlas_manual_connected.report_image_job','DELETE') can_delete,
    has_column_privilege('atlas_fixture_manual','atlas_manual_connected.report_image_job','recipe','UPDATE') can_rewrite_recipe`);
  assert.deepEqual(permissions, { can_delete: false, can_rewrite_recipe: false });
  checks.push('retirement fences publication/adoption while retaining late paid outcome receipts; immutable approved publications and narrow grants remain unchanged');
  const evidence = { status: 'REPORT_IMAGES_POSTGRES_PASS', fixtureDirectory: fixture.cluster.directory, providerCalls: 0, productionDataEffects: false, checks };
  await writeFile(join(output, 'report-images-postgres.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await connection.close(); await fixture.stop();
  await writeFile(join(output, 'cleanup.json'), await readFile(join(fixture.cluster.directory, 'cleanup.json')), { mode: 0o600 });
}
