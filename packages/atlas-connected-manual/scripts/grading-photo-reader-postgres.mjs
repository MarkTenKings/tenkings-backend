import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createIntakeRepository } from '@atlas/manual-intake/repository';
import { document } from '@atlas/manual-intake/contract';
import { canonical, digest } from '@atlas/manual-service/contract';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '@atlas/photo-runtime';
import { createStoredGradingPhotoReader } from '../src/grading-photo-reader.mjs';
import { REPORT_IMAGE_RECIPE } from '../src/report-image-provider.mjs';
import { savedGradingPhoto } from '../test/grading-photo-fixture.mjs';

/** Synthetic upload, saved image and actual isolated-role projection. No image
 * provider, queue execution or external object store participates in this proof. */
export async function validateGradingPhotoReader({ fixture, connection, workerClient, machine, staff }) {
  const intake = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'synthetic-grading', maxOriginalBytes: 2_000_000 });
  const requestId = randomUUID(), created = await intake.create(staff, { requestId, label: 'Synthetic generated image reader' });
  const cardId = created.card.cardId, side = 'FRONT';
  const bytes = await sharp({ create: { width: 48, height: 64, channels: 3, background: '#abcdef' } }).withIccProfile('srgb').png().toBuffer();
  const planned = await intake.plan(staff, cardId, { requestId: randomUUID(), side, expectedVersion: 0, sha256: digest(bytes), byteCount: bytes.length });
  const upload = planned.upload, observed = { object: upload.plan.object, sha256: digest(bytes), byteCount: bytes.length, contentType: 'application/octet-stream' };
  await intake.recordVerification(staff, cardId, upload.uploadId, observed);
  const decoded = await verifyAndDecodePhoto({ bytes, uploadPlan: upload.plan, observedObject: observed.object,
    limits: { maxInputBytes: 2_000_000, maxPixels: 1_000_000, maxRasterBytes: 8_000_000, maxOutputBytes: 4_000_000, timeoutMs: 5000 } });
  const working = await deriveSdrWorkingPhoto(decoded), frame = describeDecodedFrame(working, { id: 'working', object: { key: `synthetic/working/${upload.uploadId}.png`, versionId: null } });
  const photo = { original: working.original, decodePlan: working.decodePlan, workingFrame: frame };
  await intake.recordSource(staff, cardId, upload.uploadId, { verificationHash: document(observed).hash, source: { synthetic: true } });
  const saved = await savedGradingPhoto(photo), media = canonical({ original: photo.original, decodePlan: photo.decodePlan, frame, descriptor: frame });
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.card_image_intent(upload_id,card_id,mode) VALUES($1::uuid,$2::uuid,'LOCAL_FIXTURE')`, upload.uploadId, cardId);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.report_image_job
    (key,source_hash,recipe_hash,recipe,mode,source_card_id,source_media,source_media_hash,state,result,result_hash)
    VALUES($1,$2,$3,$4,'LOCAL_FIXTURE',$5::uuid,$6,$7,'READY',$8,$9)`, saved.row.key, saved.row.source_hash,
  saved.row.recipe_hash, canonical(REPORT_IMAGE_RECIPE), cardId, media, digest(media), saved.row.result, saved.row.result_hash);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.card_image_binding(upload_id,card_id,side,original_sha256,job_key)
    VALUES($1::uuid,$2::uuid,'FRONT',$3,$4)`, upload.uploadId, cardId, photo.original.content.sha256, saved.row.key);
  const reader = createStoredGradingPhotoReader({ boundary: machine, storage: { async readDecodedFrame(input) {
    assert.deepEqual(input.frame, saved.frame); return { bytes: saved.bytes };
  } } });
  const input = { cardId, uploadId: upload.uploadId, side, photo };
  assert.equal(await reader.isPhotoPrepared(input), true);
  const found = await reader.readGradingPhoto(input); assert.deepEqual(found.bytes, saved.bytes); assert.deepEqual(found.photo.workingFrame, saved.frame);
  const query = (card, id, face, mode) => workerClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.read_grading_photo($1::uuid,$2::uuid,$3,$4)', card, id, face, mode);
  for (const args of [[randomUUID(), upload.uploadId, side, 'LOCAL_FIXTURE'], [cardId, randomUUID(), side, 'LOCAL_FIXTURE'],
    [cardId, upload.uploadId, 'BACK', 'LOCAL_FIXTURE'], [cardId, upload.uploadId, side, 'PRODUCTION']]) assert.deepEqual(await query(...args), []);
  for (const table of ['report_image_job', 'card_image_binding', 'card_image_intent']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
    const [row] = await workerClient.$queryRawUnsafe('SELECT has_table_privilege(current_user,$1,$2) allowed', `atlas_manual_connected.${table}`, privilege);
    assert.equal(row.allowed, false, `${table}:${privilege}`);
  }
  const [publicAccess] = await fixture.admin.$queryRawUnsafe(`SELECT NOT EXISTS(SELECT 1 FROM pg_proc p,
    LATERAL aclexplode(p.proacl) a WHERE p.oid='atlas_manual_connected.read_grading_photo(uuid,uuid,text,text)'::regprocedure
    AND a.grantee=0 AND a.privilege_type='EXECUTE') denied`); assert.equal(publicAccess.denied, true);
  await intake.plan(staff, cardId, { requestId: randomUUID(), side, expectedVersion: planned.card.sides.FRONT.version, sha256: digest(bytes), byteCount: bytes.length });
  assert.deepEqual(await query(cardId, upload.uploadId, side, 'LOCAL_FIXTURE'), []);
  await assert.rejects(reader.readGradingPhoto(input), { code: 'GRADING_IMAGE_PENDING' });
  assert.equal((await fixture.admin.$queryRawUnsafe('SELECT result_hash FROM atlas_manual_connected.report_image_job WHERE key=$1', saved.row.key))[0].result_hash, saved.row.result_hash);
  return ['isolated role reads exact generated grading pixels via narrow current-upload/mode projection without image provider; wrong card, upload, side, mode and replaced source return no image',
    'all seven image job/binding/intent table privileges remain denied to isolated worker; PUBLIC cannot execute projection; saved image evidence stays immutable'];
}
