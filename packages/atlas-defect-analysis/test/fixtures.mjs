import { deflateSync } from 'node:zlib';
import { digest, canonical } from '../src/contract.mjs';
import { planDefectCrops, buildAstraDefectRequest, MODEL } from '../src/index.mjs';
import { retrievalDigest } from '../../atlas-defect-memory/src/contract.mjs';

export const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const hash = n => digest(String(n));
function crc(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function chunk(kind, value) {
  const type = Buffer.from(kind), output = Buffer.alloc(value.length + 12); output.writeUInt32BE(value.length);
  type.copy(output, 4); value.copy(output, 8); output.writeUInt32BE(crc(Buffer.concat([type, value])), output.length - 4); return output;
}
const cache = new Map();
export function png(width, height, color = 0) {
  const key = `${width}:${height}:${color}`; if (cache.has(key)) return cache.get(key);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, color); for (let i = 0; i < height; i++) pixels[i * (width * 3 + 1)] = 0;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  cache.set(key, bytes); return bytes;
}
export const raster = (width, height, color = 0) => { const bytes = png(width, height, color); return { mime: 'image/png', width, height, sha256: digest(bytes), bytes }; };
export function emptyKnowledge() {
  const value = { version: 'atlas-defect-memory-retrieval-v1', revision: `m1:0:${hash('no-confirmations')}`, generation: 0,
    status: 'EMPTY_REVIEWED_BANK', pendingPublications: 0, lessonIds: [], lessons: [] };
  return { ...value, sha256: retrievalDigest(value) };
}
export function artifactRef(cardId, kind, sourceHash, sha256 = hash(kind), byteCount = 150) {
  const lineageSha256 = digest(canonical({ cardId, kind, sourceHash }));
  return { key: `atlas-manual-artifacts/v1/${cardId}/${kind}/${lineageSha256}-${sha256}.json`, cardId, kind, lineageSha256, sha256, byteCount };
}
export function lesson(disposition = 'CORRECTED') {
  const source = { cardId: id(2), actionId: id(3), actorId: id(4), resultRevision: 2, contentHash: hash('prior-card'), nativeSourceHash: hash('prior-source'),
    frame: { imageVersion: 1, preparationVersion: 1, frameId: 'prior:front', originalSha256: hash('prior-original'),
      inspectionImageSha256: hash('prior-inspection'), rectifiedImageSha256: hash('prior-rectified') } };
  const crop = raster(50, 60, 120), sourceHash = hash('crop-source'), traceHash = hash('trace');
  const body = { findingId: 'human-finding-1', side: 'FRONT', disposition, defectType: 'VISIBLE_WHITENING', previousDefectType: 'FAINT_COLOR_VARIATION', proposalReview: null,
    design: { version: 'atlas-defect-design-v1', category: 'SPORTS', year: '2026', manufacturer: 'fixture', productSet: 'fixture set',
      parallel: null, insert: null, layoutType: null, cardNumber: '1' }, source,
    exemplar: { crop: { ref: artifactRef(source.cardId, 'REVIEWED_CROP', sourceHash), sourceHash, width: crop.width, height: crop.height, mime: crop.mime, sha256: crop.sha256 },
      trace: { ref: artifactRef(source.cardId, 'REVIEWED_TRACE', sourceHash), sourceHash, sha256: traceHash },
      cropTransform: { version: 'atlas-reviewed-crop-v1', coordinateSpace: 'RECTIFIED_CARD_PIXELS', imageSha256: source.frame.rectifiedImageSha256,
        x: 0, y: 0, width: 50, height: 60, sourceWidth: 1270, sourceHeight: 1778 } } };
  return { ...body, id: digest(canonical(body)) };
}
export function withLessons(input, lessons = [lesson()]) {
  const knowledge = { version: 'atlas-defect-memory-retrieval-v1', revision: `m1:1:${hash('confirmation-set')}`, generation: 1,
    status: 'READY', pendingPublications: 0, lessonIds: lessons.map(x => x.id), lessons };
  input.knowledge = { ...knowledge, sha256: retrievalDigest(knowledge) };
  input.lessonImages = lessons.map(l => ({ lessonId: l.id, ...raster(l.exemplar.crop.width, l.exemplar.crop.height, 120),
    traceOverlay: { ...raster(l.exemplar.crop.width, l.exemplar.crop.height, 121), traceSha256: l.exemplar.trace.sha256 } })); return input;
}
export function inputFixture() {
  const input = { analysisId: id(10), cardId: id(1), profile: 'SPORTS', cornerShapes: { FRONT: 'SQUARE', BACK: 'SQUARE' },
    binding: { sourceHash: hash('source'), manualRevision: 3, manualContentHash: hash('manual'), identityRevision: 1, geometryRevision: 2, defectRevision: 1,
      sides: {} }, images: [], knowledge: emptyKnowledge(), lessonImages: [] };
  for (const [i, side] of ['FRONT', 'BACK'].entries()) {
    input.binding.sides[side] = { frame: { imageVersion: 1, originalSha256: hash(side), preparationVersion: 1, frameId: `${side}:frame`,
      inspectionImageSha256: hash(`${side}:webp`), rectifiedImageSha256: hash(`${side}:rectified`) }, findingRevision: 1, reviewRevision: 0 };
    input.images.push({ side, whole: { ...raster(1350, 1858, i * 255), sourceSha256: input.binding.sides[side].frame.inspectionImageSha256 },
      crops: planDefectCrops(side).map(spec => ({ ...spec, ...raster(spec.width, spec.height, i * 255) })) });
  }
  return input;
}
// Independent rectangles keep the legacy fixture and its golden hashes intact.
export function contextInputFixture() {
  const input = inputFixture();
  input.images.forEach((slot, i) => {
    slot.crops = [[0, 0], [611, 0], [0, 865], [611, 865]].map(([x, y], index) =>
      ({ id: `${slot.side}:crop:${index + 1}`, x, y, ...raster(739, 993, i * 255) }));
  });
  return input;
}
export const preparedFixture = () => buildAstraDefectRequest(inputFixture());
export function outputFixture(evidence) {
  return { sourceBindingSha256: evidence.sourceBindingSha256, knowledgeRevision: evidence.knowledge.revision,
    findings: [{ side: 'FRONT', imageId: 'FRONT:crop:1', defectType: 'VISIBLE_WHITENING',
      localContour: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 12 }, { x: 0, y: 12 }], observation: 'Possible light edge damage.',
      uncertainty: 'MEDIUM', lessonIds: [] }], limitations: ['Synthetic fixture has no physical grading authority.'] };
}
export function responseFixture(evidence, value = outputFixture(evidence)) {
  return { id: 'resp_fixture_123', model: MODEL, status: 'completed',
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300, input_tokens_details: { cached_tokens: 25 }, output_tokens_details: { reasoning_tokens: 100 } } };
}
