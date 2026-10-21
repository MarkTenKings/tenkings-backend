import { createHash } from 'node:crypto';
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';
import { processedPhoto } from '@atlas/manual-intake/contract';

export const GALLERY_LIMITS = Object.freeze({ imageBytes: 768 * 1024, edge: 768, inputBytes: 256 * 1024 * 1024,
  pixels: 52_000_000, timeoutMs: 30000 });
const HASH = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const valid = value => requireThat(value, 503, 'GALLERY_SOURCE_INVALID');
const changed = value => requireThat(value, 409, 'GALLERY_SOURCE_CHANGED');
const text = value => typeof value === 'string' && value.trim() && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
const json = (content, hash) => { valid(typeof content === 'string' && digest(content) === hash); return JSON.parse(content); };

/** SELECT-only snapshot: details.read() deliberately is not used because it
 * inserts an absent row. Manual ACL locks precede intake locks, as in writes. */
export function createGallerySnapshot({ boundary, intakeRepository }) {
  return async (staff, cardId) => {
    uuid(cardId);
    return boundary.transaction(staff, async ({ tx, principal, refresh }) => {
      const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE', cardId);
      principal = (await refresh()).principal;
      const card = await intakeRepository.authorizeInTransaction(tx, principal, cardId, { lock: 'SHARE' });
      let manual = null, approval = null, details = null;
      if (row) {
        requireThat(row.owner_id === principal.id || ['readers', 'editors', 'approvers'].some(key => row[key]?.includes(principal.id)), 404, 'MANUAL_CARD_NOT_FOUND');
        manual = { revision: row.revision, contentHash: row.content_hash, draft: json(row.content, row.content_hash) };
        const [saved] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid ORDER BY source_revision DESC LIMIT 1', cardId);
        if (saved) {
          json(saved.report, saved.report_hash);
          valid(HASH.test(saved.source_hash)); uuid(saved.action_id);
          approval = { actionId: saved.action_id, sourceHash: saved.source_hash, reportHash: saved.report_hash,
            approvedAt: new Date(saved.approved_at).toISOString() };
        }
      } else {
        const [saved] = await tx.$queryRawUnsafe('SELECT revision,content,content_hash FROM atlas_manual_connected.details WHERE card_id=$1::uuid', cardId);
        if (saved) details = { revision: saved.revision, contentHash: saved.content_hash, value: json(saved.content, saved.content_hash) };
      }
      requireThat((await refresh()).principal.id === principal.id, 401, 'SIGN_IN_REQUIRED');
      return { staffId: principal.id, card, manual, approval, details };
    });
  };
}

function sourceCurrent({ card, manual }) {
  return Boolean(card.sourceHash && manual?.draft.source?.sourceHash === card.sourceHash
    && ['FRONT', 'BACK'].every(side => manual.draft.source.uploads?.[side] === card.sides[side].upload?.uploadId));
}
function binding(snapshot) {
  const { card, manual } = snapshot, upload = card.sides.FRONT.upload;
  if (!upload?.source || !upload.verification) return null;
  valid(upload.side === 'FRONT' && upload.plan.binding.cardId === card.cardId && upload.plan.binding.side === 'FRONT'
    && upload.plan.binding.version === upload.version && upload.plan.uploadId === upload.uploadId
    && upload.verification.sha256 === upload.plan.expected.sha256 && HASH.test(upload.verification.sha256));
  return { cardId: card.cardId, intakeRevision: card.revision, sourceHash: card.sourceHash, side: 'FRONT',
    uploadId: upload.uploadId, version: upload.version, originalSha256: upload.verification.sha256,
    manualRevision: manual?.revision ?? null, manualContentHash: manual?.contentHash ?? null };
}
function fence(snapshot) {
  return canonical({ staffId: snapshot.staffId, cardId: snapshot.card.cardId, revision: snapshot.card.revision, sourceHash: snapshot.card.sourceHash,
    sides: snapshot.card.sides, manual: snapshot.manual && { revision: snapshot.manual.revision, contentHash: snapshot.manual.contentHash },
    approval: snapshot.approval, details: snapshot.details && { revision: snapshot.details.revision, contentHash: snapshot.details.contentHash } });
}
export function galleryMetadata(snapshot) {
  uuid(snapshot.staffId);
  const { card, manual, approval, details } = snapshot, current = sourceCurrent(snapshot);
  let title = { state: 'UNKNOWN', text: null, source: null };
  const name = current ? text(manual.draft.identity?.playerName) ?? text(manual.draft.identity?.cardName)
    : !manual && card.sourceHash && details?.value.sourceHash === card.sourceHash ? text(details.value.fields?.name) : null;
  if (name) title = { state: 'CURRENT', text: name, source: manual ? 'MANUAL' : 'SAVED_DETAILS' };
  const approved = Boolean(current && approval?.sourceHash === manual.contentHash);
  let state = 'UNKNOWN';
  if (manual) {
    if (current) state = approved ? 'APPROVED_CURRENT' : approval ? 'CHANGED_SINCE_APPROVAL' : 'SAVED_DRAFT';
    else if (HASH.test(manual.draft.source?.sourceHash ?? '')) state = 'PHOTOS_CHANGED';
  }
  const front = binding(snapshot);
  return { schema: 'atlas-staff-card-gallery-v1', staffId: snapshot.staffId, cardId: card.cardId, intakeRevision: card.revision, sourceHash: card.sourceHash,
    manual: manual ? { revision: manual.revision, contentHash: manual.contentHash, sourceCurrent: current } : null,
    title, review: { state, approval: approval ? { ...approval, current: approved } : null },
    front: { state: front ? 'READY' : 'UNAVAILABLE', binding: front } };
}

/** A private display derivative, not grading evidence. White compositing is
 * display-only; the retained original/decoded frame is never modified. */
export async function generateGalleryPreview({ bytes, frame, signal }) {
  const { default: sharp } = await import('sharp');
  signal.throwIfAborted();
  const options = { limitInputPixels: GALLERY_LIMITS.pixels, failOn: 'error', sequentialRead: true };
  const metadata = await sharp(bytes, options).metadata();
  valid(metadata.format === 'png' && (metadata.pages ?? 1) === 1
    && metadata.width === frame.raster.dimensions.width && metadata.height === frame.raster.dimensions.height);
  let result;
  for (const quality of [85, 65]) {
    result = await sharp(bytes, options).flatten({ background: '#ffffff' })
      .resize({ width: GALLERY_LIMITS.edge, height: GALLERY_LIMITS.edge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: false }).timeout({ seconds: 25 }).toBuffer({ resolveWithObject: true });
    signal.throwIfAborted(); if (result.data.length <= GALLERY_LIMITS.imageBytes) break;
  }
  return { bytes: result.data, width: result.info.width, height: result.info.height };
}

export function createStaffCardGallery({ snapshot, intake, storage, limited = work => work(), generate = generateGalleryPreview }) {
  valid(typeof snapshot === 'function' && typeof intake?.readSource === 'function' && typeof storage?.readDecodedFrame === 'function');
  async function after(staff, cardId, before) {
    const current = await snapshot(staff, cardId);
    requireThat(current.staffId === before.staffId, 401, 'SIGN_IN_REQUIRED'); changed(fence(current) === fence(before));
  }
  return Object.freeze({
    async read(staff, cardId) {
      const before = await snapshot(staff, cardId), result = galleryMetadata(before);
      await after(staff, cardId, before); return result;
    },
    async preview(staff, cardId, expected) {
      const before = await snapshot(staff, cardId), selected = binding(before);
      requireThat(selected, 404, 'GALLERY_PREVIEW_UNAVAILABLE');
      changed(canonical(selected) === canonical({ cardId, side: 'FRONT', ...expected }));
      return limited(async () => {
        // Waiting for bounded CPU capacity does not extend an old access grant.
        await after(staff, cardId, before);
        const signal = AbortSignal.timeout(GALLERY_LIMITS.timeoutMs);
        const source = await intake.readSource(staff, cardId, selected.uploadId, { signal });
        changed(canonical(source.upload) === canonical(before.card.sides.FRONT.upload));
        const photo = processedPhoto(source.photo, source.upload.plan, source.upload.verification), frame = photo.decodedFrame;
        const dims = frame.raster.dimensions;
        valid(photo.original.content.sha256 === selected.originalSha256 && photo.original.binding.cardId === cardId
          && photo.original.binding.side === 'FRONT' && photo.original.binding.version === selected.version
          && photo.original.uploadId === selected.uploadId && frame.schemaVersion === 1 && frame.raster.content.mime === 'image/png'
          && Number.isSafeInteger(frame.raster.content.byteCount) && frame.raster.content.byteCount > 0
          && frame.raster.content.byteCount <= GALLERY_LIMITS.inputBytes
          && Number.isSafeInteger(dims.width) && Number.isSafeInteger(dims.height) && dims.width >= 2 && dims.height >= 2
          && dims.width * dims.height <= GALLERY_LIMITS.pixels);
        const found = await storage.readDecodedFrame({ frame, original: photo.original, decodePlan: photo.decodePlan, signal });
        valid(found.bytes instanceof Uint8Array && found.bytes.length === frame.raster.content.byteCount
          && found.byteCount === found.bytes.length && found.sha256 === frame.raster.content.sha256
          && found.contentType === 'image/png' && canonical(found.object) === canonical(frame.raster.object)
          && sha(found.bytes) === frame.raster.content.sha256);
        await after(staff, cardId, before);
        const output = await generate({ bytes: found.bytes, frame, signal });
        valid(output?.bytes instanceof Uint8Array && output.bytes.length > 0 && output.bytes.length <= GALLERY_LIMITS.imageBytes
          && output.bytes[0] === 255 && output.bytes[1] === 216 && output.bytes[2] === 255
          && Number.isSafeInteger(output.width) && Number.isSafeInteger(output.height) && output.width >= 2 && output.height >= 2
          && output.width <= Math.min(GALLERY_LIMITS.edge, dims.width) && output.height <= Math.min(GALLERY_LIMITS.edge, dims.height)
          && Math.abs(output.width * dims.height - output.height * dims.width) <= Math.max(dims.width, dims.height));
        signal.throwIfAborted(); await after(staff, cardId, before);
        const bytes = Buffer.from(output.bytes);
        return { schema: 'atlas-staff-gallery-preview-v1', staffId: before.staffId, binding: selected,
          image: { mime: 'image/jpeg', byteCount: bytes.length, sha256: sha(bytes), width: output.width, height: output.height, base64: bytes.toString('base64') },
          display: { source: 'ORIGINAL_UPLOAD', fit: 'inside', crop: false, background: '#ffffff', sourceFrameSha256: frame.raster.content.sha256 } };
      });
    },
  });
}
