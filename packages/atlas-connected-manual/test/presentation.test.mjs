import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { preparePresentationPhoto, createPresentationService } from '../src/presentation.mjs';
import { createApprovedManualReader } from '../src/publication-reader.mjs';
import { digest, canonical } from '@atlas/manual-service/contract';
import { publicationFixture } from './publication-fixture.mjs';

test('slab photo retains original bytes and full frame while making bounded separate WebP; repeat uses same immutable objects', async () => {
  const { storage, objects } = memoryPhotoStorage();
  const bytes = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#78632b' } }).png().toBuffer();
  const id = randomUUID(), cardId = randomUUID();
  const plan = { schemaVersion: 1, uploadId: id, binding: { cardId, pairId: randomUUID(), side: 'FRONT', version: 1 },
    object: { key: `intake/originals/${cardId}/presentation/${id}`, versionId: null }, expected: { sha256: sha(bytes), byteCount: bytes.length } };
  await storage.writeOriginal({ uploadPlan: plan, bytes });
  const processPhoto = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
    maxInputBytes: 64000000, maxPixels: 52000000, maxRasterBytes: 512000000, maxOutputBytes: 96000000, timeoutMs: 20000 } });
  const args = { upload: { id, plan, request: { alt: 'Actual finished slab' } }, storage, processPhoto, keyPrefix: 'intake' };
  const photo = await preparePresentationPhoto(args);
  assert.deepEqual(photo.media.frame.raster.dimensions, { width: 3000, height: 1000 });
  assert.equal(photo.descriptor.width, 2400); assert.equal(photo.descriptor.height, 800);
  assert.equal(photo.descriptor.contentType, 'image/webp'); assert.equal(photo.media.descriptor.purpose, 'preview');
  const saved = await storage.readDerivative(photo.media);
  assert.equal(sha(saved.bytes), photo.descriptor.sha256);
  const metadata = await sharp(saved.bytes).metadata(); assert.equal(metadata.width, 2400); assert.equal(metadata.format, 'webp');
  assert.deepEqual((await storage.readOriginal({ uploadPlan: plan })).bytes, bytes);
  assert.deepEqual(await preparePresentationPhoto(args), photo); assert.equal(objects.size, 4);
});

test('completed lost response is replayed without new signer, decode, storage or commit; missing original has recoverable code', async () => {
  const done = { presentation: { saved: true }, revision: 1, approvalActionId: randomUUID() };
  const service = createPresentationService({ repository: { loadUpload: async () => ({ done }) }, storage: {}, processPhoto() { throw new Error(); } });
  assert.deepEqual(await service.complete({}, randomUUID(), randomUUID()), done);
  assert.deepEqual(await service.sign({}, randomUUID(), randomUUID()), { state: 'COMPLETE', ...done });
  await assert.rejects(preparePresentationPhoto({ upload: { plan: {} }, storage: { async readOriginal() { throw Object.assign(new Error(), { code: 'PHOTO_OBJECT_NOT_FOUND' }); } } }), { code: 'PRESENTATION_UPLOAD_ABSENT' });
});

async function publicFixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const photoBytes = Buffer.from('separate synthetic slab photo');
  const value = { version: 'atlas-report-presentation-v1', binding: { publicToken: f.row.public_token, approvalVersion: 1, publicHash: f.row.public_hash },
    revision: 1, updatedAt: '2026-09-22T23:00:00.000Z', slabPhoto: { url: `/api/reports/${f.row.public_token}/presentation/image?v=1&revision=1`,
      sha256: digest(photoBytes), byteCount: photoBytes.length, contentType: 'image/webp', width: 100, height: 150, alt: 'Synthetic fixture' } };
  const row = { revision: 1, presentation: canonical(value), presentation_hash: digest(canonical(value)), media: canonical({ fixture: true }), media_hash: digest(canonical({ fixture: true })) };
  let enabled = true, changed = false, corrupt = false;
  const client = { $transaction: async fn => fn({ $queryRawUnsafe: async sql => sql.includes('read_publication') ? enabled ? [f.row] : [] : [changed ? { ...row, presentation_hash: '0'.repeat(64) } : row] }) };
  const storage = { readDerivative: async () => ({ bytes: corrupt ? Buffer.from('corrupt') : photoBytes }) };
  const reader = createApprovedManualReader({ client, storage, artifacts: f.artifacts, presentationEnabled: true });
  const claims = kind => ({ request: { kind, token: f.row.public_token, version: 1, side: null, findingId: null, ...(kind === 'PRESENTATION_IMAGE' ? { presentationRevision: 1 } : {}) }, expiresAt: Date.now() + 30000 });
  return { ...f, reader, claims, photoBytes, row, value, disable() { enabled = false; }, corrupt() { corrupt = true; }, change() { changed = true; }, storage };
}
test('optional presentation is separately versioned and public image matches bound descriptor; grade packet remains identical', async () => {
  const f = await publicFixture(), result = JSON.parse((await f.reader.read(f.claims('REPORT'))).bytes);
  assert.equal(result.publicHash, f.row.public_hash ?? f.value.binding.publicHash); assert.deepEqual(result.presentation, f.value);
  assert.equal(digest(JSON.stringify(result.packet)), f.value.binding.publicHash);
  assert.deepEqual((await f.reader.read(f.claims('PRESENTATION_IMAGE'))).bytes, f.photoBytes);
  const stale = f.claims('PRESENTATION_IMAGE'); stale.request.presentationRevision = 2;
  assert.equal(await f.reader.read(stale), null);
  f.corrupt(); await assert.rejects(f.reader.read(f.claims('PRESENTATION_IMAGE')), { code: 'PRESENTATION_IMAGE_MISMATCH' });
});
test('presentation photo checks public-reader authorization again after storage read', async () => {
  const f = await publicFixture(), original = f.storage.readDerivative;
  f.storage.readDerivative = async () => { const found = await original(); f.disable(); return found; };
  await assert.rejects(f.reader.read(f.claims('PRESENTATION_IMAGE')), { code: 'MANUAL_PUBLICATION_CHANGED' });
});
test('unavailable optional metadata leaves the exact approved grading packet readable', async () => {
  const f = await publicFixture(); f.change();
  const result = JSON.parse((await f.reader.read(f.claims('REPORT'))).bytes);
  assert.equal(digest(JSON.stringify(result.packet)), f.value.binding.publicHash);
  assert.equal(result.presentation?.slabPhoto, undefined);
  await assert.rejects(f.reader.read(f.claims('PRESENTATION_IMAGE')), { code: 'PRESENTATION_CORRUPT' });
});
