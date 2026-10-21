import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { memoryPhotoStorage } from '../../atlas-manual-intake/test/helpers.mjs';
import { withProperties } from '../../atlas-photo-runtime/test/heif-fixture-helpers.mjs';
import { createGallerySnapshot, createStaffCardGallery, galleryMetadata, generateGalleryPreview, GALLERY_LIMITS } from '../src/staff-card-gallery.mjs';

const clone = value => structuredClone(value);
const refusal = (code, status = 403) => Object.assign(Error(code), { code, status });
async function fixture(bytes) {
  const memory = memoryPhotoStorage(), cardId = randomUUID(), uploadId = randomUUID(), pairId = randomUUID();
  bytes ??= await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 500, height: 800, channels: 3, background: '#a92328' } }).png().toBuffer(), left: 200, top: 200 }]).withIccProfile('srgb').png().toBuffer();
  const plan = { schemaVersion: 1, uploadId, binding: { cardId, pairId, side: 'FRONT', version: 2 },
    object: { key: `intake/originals/${uploadId}`, versionId: null }, expected: { sha256: digest(bytes), byteCount: bytes.length } };
  const found = await memory.storage.writeOriginal({ uploadPlan: plan, bytes });
  const verification = { object: found.object, sha256: found.sha256, byteCount: found.byteCount, contentType: found.contentType };
  const process = createPhotoProcessor({ storage: memory.storage, keyPrefix: 'intake', decodeLimits: {
    maxInputBytes: 4000000, maxPixels: 2000000, maxRasterBytes: 16000000, maxOutputBytes: 16000000, timeoutMs: 10000 } });
  const photo = await process({ uploadPlan: plan, verification, bytes });
  const upload = { uploadId, requestId: randomUUID(), side: 'FRONT', version: 2, plan, verification, source: { photoSourceHash: 'b'.repeat(64), ref: { key: 'fixture-source' } } };
  const snapshot = { staffId: randomUUID(), card: { cardId, revision: 5, sourceHash: 'a'.repeat(64), sides: { FRONT: { version: 2, upload }, BACK: { version: 1, upload: { uploadId: randomUUID() } } } }, manual: null, approval: null, details: null };
  snapshot.manual = { revision: 6, contentHash: 'c'.repeat(64), draft: { identity: { playerName: 'Saved player' }, source: { sourceHash: snapshot.card.sourceHash,
    uploads: { FRONT: uploadId, BACK: snapshot.card.sides.BACK.upload.uploadId } } } };
  const f = { snapshot, upload, photo, memory, snapshots: 0, pixels: 0, sourceReads: 0, generate: undefined };
  f.dependencies = { snapshot: async () => { f.snapshots++; if (f.onSnapshot) await f.onSnapshot(); return clone(f.snapshot); },
    intake: { readSource: async () => { f.sourceReads++; return { upload: clone(f.upload), photo: clone(f.photo) }; } },
    storage: { readDecodedFrame: async input => { f.pixels++; assert.equal(input.frame.id, f.photo.decodedFrame.id); assert.notEqual(input.frame.id, f.photo.workingFrame.id);
      const result = await memory.storage.readDecodedFrame(input); if (f.onPixels) await f.onPixels(result); return result; } } };
  f.reader = () => createStaffCardGallery({ ...f.dependencies, ...(f.generate ? { generate: f.generate } : {}) });
  f.expected = () => { const { cardId: _card, side: _side, ...expected } = galleryMetadata(f.snapshot).front.binding; return expected; };
  return f;
}
const base = await fixture();
function fresh() {
  const f = { ...base, snapshot: clone(base.snapshot), upload: clone(base.upload), photo: clone(base.photo), snapshots: 0, pixels: 0, sourceReads: 0 };
  f.dependencies = { snapshot: async () => { f.snapshots++; await f.onSnapshot?.(); return clone(f.snapshot); },
    intake: { readSource: async () => { f.sourceReads++; return { upload: clone(f.upload), photo: clone(f.photo) }; } },
    storage: { readDecodedFrame: async input => { f.pixels++; assert.equal(input.frame.id, f.photo.decodedFrame.id); const result = await f.memory.storage.readDecodedFrame(input); await f.onPixels?.(result); return result; } } };
  f.reader = () => createStaffCardGallery({ ...f.dependencies, ...(f.generate ? { generate: f.generate } : {}) });
  f.expected = () => { const { cardId: _card, side: _side, ...expected } = galleryMetadata(f.snapshot).front.binding; return expected; }; return f;
}

test('actual original decoded pixels produce bounded uncropped JPEG; originals/history and storage stay unchanged', async () => {
  const f = fresh(), before = canonical(f.snapshot), puts = f.memory.calls.filter(x => x.name === 'PutObjectCommand').length;
  const response = await f.reader().preview({}, f.snapshot.card.cardId, f.expected());
  assert.equal(response.staffId, f.snapshot.staffId); assert.equal((await f.reader().read({}, f.snapshot.card.cardId)).staffId, f.snapshot.staffId);
  const bytes = Buffer.from(response.image.base64, 'base64'), metadata = await sharp(bytes).metadata();
  assert.equal(digest(bytes), response.image.sha256); assert.equal(bytes.length, response.image.byteCount); assert(bytes.length <= GALLERY_LIMITS.imageBytes);
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [576, 768, 'jpeg']);
  const pixel = await sharp(bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer(); assert(pixel.every(v => v >= 250));
  assert.deepEqual(response.display, { source: 'ORIGINAL_UPLOAD', fit: 'inside', crop: false, background: '#ffffff', sourceFrameSha256: f.photo.decodedFrame.raster.content.sha256 });
  assert.equal(canonical(f.snapshot), before); assert.equal(f.memory.calls.filter(x => x.name === 'PutObjectCommand').length, puts);
  assert.equal(f.pixels, 1); assert.equal(f.sourceReads, 1); assert.equal(f.snapshots, 6);
  assert(Buffer.byteLength(JSON.stringify(response)) < 2 * 1024 * 1024);
});
test('HEIC originals use their retained PNG decode without rereading or delivering raw HEIC', async () => {
  const raw = await readFile(new URL('../../atlas-photo-runtime/test/fixtures/colors-no-alpha.heic', import.meta.url));
  const icc = await readFile(new URL('../../atlas-photo-runtime/test/fixtures/DisplayP3-v4.icc', import.meta.url));
  // The stock codec corpus is unmanaged; add its explicit qualified profile,
  // preserving compressed HEVC bytes, as in the native working-image fixtures.
  const bytes = withProperties(raw, [['colr', Buffer.concat([Buffer.from('prof'), icc])]]);
  const f = await fixture(bytes), before = f.memory.calls.length;
  const result = await f.reader().preview({}, f.snapshot.card.cardId, f.expected());
  assert.equal(result.binding.originalSha256, digest(bytes)); assert.equal(result.image.mime, 'image/jpeg');
  assert.notEqual(result.image.sha256, digest(bytes));
  const reads = f.memory.calls.slice(before);
  assert.deepEqual(reads.map(c => c.name), ['HeadObjectCommand', 'GetObjectCommand']);
  assert(reads.every(c => c.input.Key === f.photo.decodedFrame.raster.object.key));
});
test('display-only alpha compositing is explicit white, keeps bounds and does not change source bytes', async () => {
  const bytes = await sharp({ create: { width: 40, height: 60, channels: 4, background: '#00000000' } }).png().toBuffer(), before = digest(bytes);
  const output = await generateGalleryPreview({ bytes, frame: { raster: { dimensions: { width: 40, height: 60 } } }, signal: AbortSignal.timeout(5000) });
  assert.deepEqual([output.width,output.height],[40,60]); assert.equal(digest(bytes),before);
  const raw = await sharp(output.bytes).raw().toBuffer(); assert(raw.every(v=>v>=250));
});
test('saved metadata distinguishes current approval, changed draft, changed photos and unknown legacy facts', async () => {
  const f = fresh(); const read = () => f.reader().read({}, f.snapshot.card.cardId);
  assert.equal((await read()).review.state, 'SAVED_DRAFT');
  f.snapshot.approval = { actionId: randomUUID(), sourceHash: f.snapshot.manual.contentHash, reportHash: 'd'.repeat(64), approvedAt: '2026-10-21T00:00:00.000Z' };
  const historical = clone(f.snapshot.approval);
  assert.equal((await read()).review.state, 'APPROVED_CURRENT');
  f.snapshot.manual.contentHash = 'e'.repeat(64); assert.equal((await read()).review.state, 'CHANGED_SINCE_APPROVAL');
  f.snapshot.card.sourceHash = 'f'.repeat(64); let result = await read(); assert.equal(result.review.state, 'PHOTOS_CHANGED'); assert.equal(result.title.text, null); assert.equal(result.review.approval.current, false);
  delete f.snapshot.manual.draft.source; result = await read(); assert.equal(result.review.state, 'UNKNOWN'); assert.equal(result.title.state, 'UNKNOWN');
  assert.deepEqual(f.snapshot.approval, historical); assert.equal(f.pixels, 0); assert.equal(f.sourceReads, 0);
  f.snapshot.manual = null; f.snapshot.approval = null; f.snapshot.details = { revision: 1, contentHash: 'e'.repeat(64), value: { sourceHash: f.snapshot.card.sourceHash, fields: { name: 'Saved intake title' } } };
  assert.equal((await read()).title.source, 'SAVED_DETAILS'); f.snapshot.details.value.sourceHash = null; assert.equal((await read()).title.text, null);
});
test('binding mismatch refuses before source or pixel reads; missing or half-pair originals remain truthful', async () => {
  for (const key of ['intakeRevision', 'sourceHash', 'uploadId', 'version', 'originalSha256', 'manualRevision', 'manualContentHash']) {
    const f = fresh(), expected = f.expected(); expected[key] = typeof expected[key] === 'number' ? expected[key] + 1 : 'wrong';
    await assert.rejects(f.reader().preview({}, f.snapshot.card.cardId, expected), { code: 'GALLERY_SOURCE_CHANGED' }); assert.equal(f.sourceReads, 0); assert.equal(f.pixels, 0);
  }
  const f = fresh(); f.snapshot.card.sourceHash = null; assert.equal((await f.reader().read({}, f.snapshot.card.cardId)).front.binding.sourceHash, null);
  f.snapshot.card.sides.FRONT.upload.source = null; const result = await f.reader().read({}, f.snapshot.card.cardId); assert.deepEqual(result.front, { state: 'UNAVAILABLE', binding: null });
  await assert.rejects(f.reader().preview({}, f.snapshot.card.cardId, {}), { code: 'GALLERY_PREVIEW_UNAVAILABLE' });
});
test('revocation, replacement, manual edits and approval changes during pixel read release neither pixels nor stale metadata', async () => {
  for (const change of ['revoke', 'account', 'upload', 'manual', 'approval']) {
    const f = fresh(); f.onPixels = () => {
      if (change === 'revoke') f.onSnapshot = () => { throw refusal('STAFF_ACCESS_REVOKED'); };
      if (change === 'account') f.snapshot.staffId = randomUUID();
      if (change === 'upload') f.snapshot.card.sides.FRONT.upload.uploadId = randomUUID();
      if (change === 'manual') f.snapshot.manual.contentHash = 'f'.repeat(64);
      if (change === 'approval') f.snapshot.approval = { actionId: randomUUID() };
    };
    f.generate = () => assert.fail('No Sharp work after failed recheck');
    await assert.rejects(f.reader().preview({}, f.snapshot.card.cardId, f.expected()), { code: change === 'revoke' ? 'STAFF_ACCESS_REVOKED' : change === 'account' ? 'SIGN_IN_REQUIRED' : 'GALLERY_SOURCE_CHANGED' });
  }
  const f = fresh(); f.onSnapshot = () => { if (f.snapshots === 2) throw refusal('INTAKE_CARD_DELETED', 410); };
  await assert.rejects(f.reader().read({}, f.snapshot.card.cardId), { code: 'INTAKE_CARD_DELETED' });
});
test('corrupt retained hash/dimensions/original binding refuse before display generation', async () => {
  for (const change of ['bytes', 'object', 'original', 'dimensions']) {
    const f = fresh(); f.generate = () => assert.fail('Invalid source cannot reach generation');
    if (change === 'bytes') f.onPixels = found => { found.bytes = Buffer.from('corrupt'); };
    if (change === 'object') f.onPixels = found => { found.object = { key: 'other', versionId: null }; };
    if (change === 'original') f.photo.original.content.sha256 = 'f'.repeat(64);
    if (change === 'dimensions') f.photo.decodedFrame.raster.dimensions.width++;
    await assert.rejects(f.reader().preview({}, f.snapshot.card.cardId, f.expected()));
  }
  const f = fresh(); f.generate = async () => { f.onSnapshot = () => { throw refusal('SIGN_IN_REQUIRED', 401); }; return { bytes: Buffer.from([255, 216, 255, 0]), width: 576, height: 768 }; };
  await assert.rejects(f.reader().preview({}, f.snapshot.card.cardId, f.expected()), { code: 'SIGN_IN_REQUIRED' });
});
test('SELECT-only snapshot respects manual ACL and missing saved details without inserting any records', async () => {
  const f = fresh(), principal = { id: randomUUID(), role: 'REVIEWER' }, calls = []; let manual = null, approved = null, details = null;
  const boundary = { transaction: async (_staff, work) => work({ principal, refresh: async () => ({ principal }), tx: {
    $executeRawUnsafe: () => assert.fail('Gallery cannot execute writes'), $queryRawUnsafe: async sql => { calls.push(sql); assert(sql.startsWith('SELECT '));
      if (sql.includes('FROM atlas_manual.card ')) return manual ? [manual] : [];
      if (sql.includes('FROM atlas_manual.approval ')) return approved ? [approved] : [];
      if (sql.includes('FROM atlas_manual_connected.details ')) return details ? [details] : []; assert.fail(sql);
    } } }) };
  const snapshot = createGallerySnapshot({ boundary, intakeRepository: { authorizeInTransaction: async (_tx, actor, cardId, options) => { assert.equal(actor, principal); assert.equal(cardId, f.snapshot.card.cardId); assert.deepEqual(options, { lock: 'SHARE' }); return clone(f.snapshot.card); } } });
  const empty = await snapshot({}, f.snapshot.card.cardId); assert.equal(empty.manual, null); assert.equal(empty.staffId, principal.id); assert.equal(calls.length, 2);
  manual = { owner_id: randomUUID(), readers: [], editors: [], approvers: [], revision: 1, content: canonical(f.snapshot.manual.draft), content_hash: digest(canonical(f.snapshot.manual.draft)) };
  await assert.rejects(snapshot({}, f.snapshot.card.cardId), { code: 'MANUAL_CARD_NOT_FOUND' });
  manual.readers = [principal.id]; approved = { action_id: randomUUID(), source_hash: manual.content_hash, report: '{}', report_hash: digest('{}'), approved_at: new Date('2026-10-21T00:00:00Z') };
  const result = await snapshot({}, f.snapshot.card.cardId); assert.equal(result.approval.reportHash, digest('{}')); assert.equal(result.manual.contentHash, manual.content_hash);
  manual.content = '{}'; await assert.rejects(snapshot({}, f.snapshot.card.cardId), { code: 'GALLERY_SOURCE_INVALID' });
});
