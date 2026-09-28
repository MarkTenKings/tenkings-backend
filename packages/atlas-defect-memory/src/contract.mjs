import { canonical, digest, immutable, object, requireThat, uuid } from '../../atlas-manual-service/src/contract.mjs';

export { canonical, digest, immutable, object, requireThat, uuid };
export const SIDES = ['FRONT', 'BACK'];
export const DEFECT_TYPES = ['FAINT_COLOR_VARIATION', 'VISIBLE_WHITENING', 'FRAYING', 'CHIPPING_EXPOSED_STOCK',
  'LIFTING_DEFORMATION', 'LIGHT_SCRATCH_SCUFF', 'VISIBLE_SCRATCH_PRINT_COATING_LOSS', 'DENT_MATERIAL_DAMAGE', 'PEELING_HEAVY_DAMAGE'];
export const hash = value => requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 503, 'MEMORY_EVIDENCE_INVALID');
export function text(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value), 503, 'MEMORY_EVIDENCE_INVALID');
}
const normalized = value => value == null || value.trim() === '' ? null : value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
/** Conservative family match: unrelated sets, variants and layout types never
 * borrow design-specific false-positive lessons. Card number is retained for
 * ranking, not a claim that all cards in a set have identical printed art. */
export function deriveDesignContext(profile, identity) {
  requireThat(['SPORTS', 'POKEMON'].includes(profile) && identity && typeof identity === 'object', 400, 'MEMORY_DESIGN_REQUIRED');
  for (const field of ['year', 'productSet', ...(profile === 'SPORTS' ? ['manufacturer'] : ['layoutType'])]) text(identity[field]);
  const design = { version: 'atlas-defect-design-v1', category: profile, year: normalized(identity.year),
    manufacturer: profile === 'SPORTS' ? normalized(identity.manufacturer) : null, productSet: normalized(identity.productSet),
    parallel: normalized(identity.parallel), insert: profile === 'SPORTS' ? normalized(identity.insert) : null,
    layoutType: profile === 'POKEMON' ? normalized(identity.layoutType) : null, cardNumber: normalized(identity.cardNumber) };
  validateDesign(design); return immutable(design);
}
export function validateDesign(design) {
  object(design, ['version', 'category', 'year', 'manufacturer', 'productSet', 'parallel', 'insert', 'layoutType', 'cardNumber']);
  requireThat(design.version === 'atlas-defect-design-v1' && ['SPORTS', 'POKEMON'].includes(design.category), 503, 'MEMORY_DESIGN_INVALID');
  for (const [key, value] of Object.entries(design)) if (!['version', 'category'].includes(key) && value !== null) {
    text(value); requireThat(value === normalized(value), 503, 'MEMORY_DESIGN_INVALID');
  }
  requireThat(design.year && design.productSet && (design.category === 'SPORTS' ? design.manufacturer && design.layoutType === null
    : design.manufacturer === null && design.insert === null && ['pokemon', 'trainer', 'energy'].includes(design.layoutType)), 503, 'MEMORY_DESIGN_INVALID');
  return design;
}
export function designKey(design) { validateDesign(design); const { cardNumber: _card, ...family } = design; return digest(canonical(family)); }
export function validateFrame(frame) {
  object(frame, ['imageVersion', 'originalSha256', 'preparationVersion', 'frameId', 'inspectionImageSha256', 'rectifiedImageSha256']);
  text(frame.frameId);
  for (const field of ['imageVersion', 'preparationVersion']) requireThat(Number.isSafeInteger(frame[field]) && frame[field] > 0, 503, 'MEMORY_FRAME_INVALID');
  for (const field of ['originalSha256', 'inspectionImageSha256', 'rectifiedImageSha256']) hash(frame[field]);
}
export function validateSource(source) {
  object(source, ['cardId', 'actionId', 'actorId', 'resultRevision', 'contentHash', 'nativeSourceHash', 'frame']);
  uuid(source.cardId); uuid(source.actionId); uuid(source.actorId); hash(source.contentHash); hash(source.nativeSourceHash); validateFrame(source.frame);
  requireThat(Number.isSafeInteger(source.resultRevision) && source.resultRevision > 1, 503, 'MEMORY_EVIDENCE_INVALID');
}
export function validateExemplar(value, source) {
  object(value, ['crop', 'trace', 'cropTransform']);
  const transform = value.cropTransform;
  object(transform, ['version', 'coordinateSpace', 'imageSha256', 'x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight']);
  requireThat(transform.version === 'atlas-reviewed-crop-v1' && transform.coordinateSpace === 'RECTIFIED_CARD_PIXELS'
    && transform.imageSha256 === source.frame.rectifiedImageSha256 && transform.sourceWidth === 1270 && transform.sourceHeight === 1778,
  503, 'MEMORY_CROP_INVALID');
  for (const name of ['x', 'y', 'width', 'height']) requireThat(Number.isSafeInteger(transform[name]) && transform[name] >= (name === 'x' || name === 'y' ? 0 : 1), 503, 'MEMORY_CROP_INVALID');
  requireThat(transform.x + transform.width <= 1270 && transform.y + transform.height <= 1778, 503, 'MEMORY_CROP_INVALID');
  object(value.crop, ['ref', 'sourceHash', 'width', 'height', 'mime', 'sha256']);
  object(value.trace, ['ref', 'sourceHash', 'sha256']);
  requireThat(value.crop.width === transform.width && value.crop.height === transform.height && value.crop.mime === 'image/png', 503, 'MEMORY_CROP_INVALID');
  for (const [name, kind] of [['crop', 'REVIEWED_CROP'], ['trace', 'REVIEWED_TRACE']]) {
    const part = value[name]; hash(part.sourceHash); hash(part.sha256);
    object(part.ref, ['key', 'sha256', 'byteCount', 'lineageSha256', 'cardId', 'kind']);
    requireThat(part.ref.cardId === source.cardId && part.ref.kind === kind && Number.isSafeInteger(part.ref.byteCount)
      && part.ref.byteCount > 0 && part.ref.byteCount <= 16777216, 503, 'MEMORY_EXEMPLAR_INVALID');
    hash(part.ref.sha256); hash(part.ref.lineageSha256);
    requireThat(part.ref.lineageSha256 === digest(canonical({ cardId: source.cardId, kind, sourceHash: part.sourceHash }))
      && typeof part.ref.key === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_/-]*\.json$/.test(part.ref.key)
      && part.ref.key.endsWith(`/${source.cardId}/${kind}/${part.ref.lineageSha256}-${part.ref.sha256}.json`), 503, 'MEMORY_EXEMPLAR_INVALID');
  }
}
export function validateLesson(lesson) {
  object(lesson, ['id', 'findingId', 'side', 'disposition', 'defectType', 'previousDefectType', 'design', 'source', 'exemplar', 'proposalReview']);
  hash(lesson.id); text(lesson.findingId); validateDesign(lesson.design); validateSource(lesson.source); validateExemplar(lesson.exemplar, lesson.source);
  requireThat(SIDES.includes(lesson.side) && ['ACCEPTED', 'CORRECTED', 'REJECTED', 'ADDED'].includes(lesson.disposition)
    && DEFECT_TYPES.includes(lesson.defectType) && (lesson.previousDefectType === null || DEFECT_TYPES.includes(lesson.previousDefectType)), 503, 'MEMORY_LESSON_INVALID');
  if (lesson.proposalReview !== null) {
    const review = lesson.proposalReview;
    object(review, ['analysisId', 'proposalId', 'reviewerId', 'reviewedAt', 'action', 'proposalDefectType', 'proposalSha256']);
    uuid(review.analysisId); text(review.proposalId); uuid(review.reviewerId); hash(review.proposalSha256);
    requireThat(['ACCEPT', 'REJECT', 'TRACE_SAVE'].includes(review.action) && DEFECT_TYPES.includes(review.proposalDefectType)
      && typeof review.reviewedAt === 'string' && Number.isFinite(Date.parse(review.reviewedAt)), 503, 'MEMORY_REVIEW_INVALID');
  }
  const { id, ...body } = lesson; requireThat(id === digest(canonical(body)), 503, 'MEMORY_LESSON_INVALID'); return lesson;
}
export function retrievalDigest(value) { const { sha256: _sha, ...body } = value; return digest(canonical(body, { maxBytes: 524288 })); }
export function validateFreshness(value) {
  object(value, ['version', 'activeReleaseId', 'activeReleaseSha256', 'unavailableSources', 'policy', 'role', 'fallback',
    ...(Object.hasOwn(value, 'decisions') ? ['decisions'] : []), ...(Object.hasOwn(value, 'unavailableLessons') ? ['unavailableLessons'] : []),
    ...(Object.hasOwn(value, 'roleSelection') ? ['roleSelection'] : []),
    ...(Object.hasOwn(value, 'qualification') ? ['qualification'] : [])]);
  if (value.qualification) { object(value.qualification, ['status', 'reason', 'bindingSha256']); hash(value.qualification.bindingSha256);
    requireThat(['QUALIFIED', 'BASELINE'].includes(value.qualification.status)
      && (value.qualification.reason === null || value.qualification.reason === 'RUNTIME_POLICY_CHANGED'), 503, 'MEMORY_RETRIEVAL_INVALID'); }
  if (value.roleSelection) { object(value.roleSelection, ['sha256', 'policySha256', 'registrySha256', 'reviewerQualitySha256', 'status', 'reason']);
    for (const k of ['sha256', 'policySha256', 'registrySha256', 'reviewerQualitySha256']) hash(value.roleSelection[k]);
    requireThat(['READY', 'BASELINE'].includes(value.roleSelection.status)
      && (value.roleSelection.reason === null || ['POLICY_EXPIRED', 'RUNTIME_POLICY_CHANGED', 'POLICY_INVALID'].includes(value.roleSelection.reason)), 503, 'MEMORY_RETRIEVAL_INVALID'); }
  hash(value.activeReleaseSha256);
  requireThat(value.version === 'atlas-learning-freshness-v1' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.activeReleaseId)
    && Number.isSafeInteger(value.unavailableSources) && value.unavailableSources >= 0
    && ['legacy-defect-family-v1', 'balanced-defect-v1'].includes(value.policy) && value.role === 'DEFECT_PROPOSER'
    && ['ELIGIBLE_EXAMPLES', 'BASELINE_WITHOUT_EXAMPLES'].includes(value.fallback), 503, 'MEMORY_RETRIEVAL_INVALID');
  if (value.decisions) {
    requireThat(Array.isArray(value.decisions) && value.decisions.length <= 96, 503, 'MEMORY_RETRIEVAL_INVALID');
    for (const decision of value.decisions) {
      object(decision, ['id', 'selected', 'reason']); hash(decision.id);
      requireThat(typeof decision.selected === 'boolean' && ['DUPLICATE', 'SAME_SOURCE', 'DESIGN_MISMATCH', 'SIDE_MISMATCH',
        'NEGATIVE_REQUIRES_EXACT_DESIGN', 'BUDGET', 'SOURCE_QUOTA', 'DISPOSITION_QUOTA', 'EXACT_DESIGN', 'MATCHING_FAMILY'].includes(decision.reason),
      503, 'MEMORY_RETRIEVAL_INVALID');
    }
  }
  if (value.unavailableLessons) {
    requireThat(Array.isArray(value.unavailableLessons) && value.unavailableLessons.length <= 32, 503, 'MEMORY_RETRIEVAL_INVALID');
    for (const lesson of value.unavailableLessons) {
      object(lesson, ['id', 'reason']); hash(lesson.id);
      requireThat(['EXEMPLAR_UNVERIFIED', 'EXEMPLAR_UNAVAILABLE'].includes(lesson.reason), 503, 'MEMORY_RETRIEVAL_INVALID');
    }
  }
}
export function validateRetrieval(value) {
  object(value, ['version', 'revision', 'generation', 'status', 'pendingPublications', 'lessonIds', 'lessons', 'sha256',
    ...(Object.hasOwn(value, 'freshness') ? ['freshness'] : [])]);
  if (value.freshness) validateFreshness(value.freshness);
  requireThat(value.version === 'atlas-defect-memory-retrieval-v1' && Number.isSafeInteger(value.generation) && value.generation >= 0
    && new RegExp(`^m1:${value.generation}:[a-f0-9]{64}$`).test(value.revision)
    && ['READY', 'EMPTY_REVIEWED_BANK', 'PUBLICATION_PENDING'].includes(value.status)
    && Number.isSafeInteger(value.pendingPublications) && value.pendingPublications >= 0
    && Array.isArray(value.lessons) && value.lessons.length <= 32 && Array.isArray(value.lessonIds), 503, 'MEMORY_RETRIEVAL_INVALID');
  value.lessons.forEach(validateLesson);
  requireThat(canonical(value.lessonIds) === canonical(value.lessons.map(lesson => lesson.id)) && new Set(value.lessonIds).size === value.lessonIds.length
    && (value.status === 'PUBLICATION_PENDING') === (value.pendingPublications > 0)
    && (value.status !== 'EMPTY_REVIEWED_BANK' || value.lessons.length === 0)
    && (value.status !== 'READY' || value.lessons.length > 0)
    && value.sha256 === retrievalDigest(value), 503, 'MEMORY_RETRIEVAL_INVALID');
  return immutable(JSON.parse(canonical(value, { maxBytes: 524288 })));
}
