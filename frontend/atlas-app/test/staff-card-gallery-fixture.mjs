import { createHash } from 'node:crypto';
export const uuid = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const staffId = uuid(900);
export function galleryFixture(n = 1) {
  const card = { cardId: uuid(n), revision: 4, sourceHash: 'a'.repeat(64), label: `Upload ${n}`, createdAt: '2026-10-21T12:00:00.000Z',
    sides: { FRONT: { version: 1, upload: { uploadId: uuid(n + 100), version: 1, verification: { sha256: 'b'.repeat(64) } } } } };
  const binding = { cardId: card.cardId, intakeRevision: card.revision, sourceHash: card.sourceHash, side: 'FRONT',
    uploadId: card.sides.FRONT.upload.uploadId, version: 1, originalSha256: 'b'.repeat(64), manualRevision: 3, manualContentHash: 'c'.repeat(64) };
  const metadata = { schema: 'atlas-staff-card-gallery-v1', staffId, cardId: card.cardId, intakeRevision: 4, sourceHash: card.sourceHash,
    manual: { revision: 3, contentHash: 'c'.repeat(64), sourceCurrent: true }, title: { state: 'CURRENT', text: `Synthetic card ${n}`, source: 'MANUAL' },
    review: { state: 'APPROVED_CURRENT', approval: { actionId: uuid(n + 200), sourceHash: 'c'.repeat(64), reportHash: 'd'.repeat(64), approvedAt: '2026-10-21T13:00:00.000Z', current: true } }, front: { state: 'READY', binding } };
  // Deliberately minimal JPEG-framed bytes for transport/hash tests, not a browser image fixture.
  const bytes = Buffer.from([255, 216, 255, 0, 255, 217]);
  const preview = { schema: 'atlas-staff-gallery-preview-v1', staffId, binding: { ...binding },
    image: { mime: 'image/jpeg', byteCount: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), width: 2, height: 3, base64: bytes.toString('base64') },
    display: { source: 'ORIGINAL_UPLOAD', fit: 'inside', crop: false, background: '#ffffff', sourceFrameSha256: 'e'.repeat(64) } };
  return { card, metadata, preview };
}
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
