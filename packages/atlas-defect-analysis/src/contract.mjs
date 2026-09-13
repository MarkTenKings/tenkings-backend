import { createHash } from 'node:crypto';

export class DefectAnalysisError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'DefectAnalysisError'; this.code = code; this.status = status; }
}
export function check(ok, code = 'DEFECT_ANALYSIS_INVALID', status = 400) { if (!ok) throw new DefectAnalysisError(code, status); }
export function object(value, keys) {
  check(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key)));
}
export function string(value, max = 512) { check(typeof value === 'string' && value.length > 0 && value.length <= max
  && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value)); return value; }
export function integer(value, min = 0, max = 2147483646) { check(Number.isSafeInteger(value) && value >= min && value <= max); return value; }
export function sha(value) { check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); return value; }
export function uuid(value) { check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)); return value; }
export const digest = value => createHash('sha256').update(value).digest('hex');
export function canonical(value, maxBytes = 65536) {
  const walk = (v, depth) => {
    check(depth < 32, 'DEFECT_ANALYSIS_LIMIT', 413);
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') { check(v.length <= maxBytes, 'DEFECT_ANALYSIS_LIMIT', 413); return JSON.stringify(v); }
    if (typeof v === 'number') { check(Number.isFinite(v)); return JSON.stringify(v); }
    if (Array.isArray(v)) return `[${v.map(x => walk(x, depth + 1)).join(',')}]`;
    check(v && Object.getPrototypeOf(v) === Object.prototype);
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${walk(v[k], depth + 1)}`).join(',')}}`;
  };
  const result = walk(value, 0); check(Buffer.byteLength(result) <= maxBytes, 'DEFECT_ANALYSIS_LIMIT', 413); return result;
}
export function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value;
}
export const clone = value => frozen(JSON.parse(canonical(value, 1048576)));
export const SIDES = Object.freeze(['FRONT', 'BACK']);
// Exact unchanged taxonomy from grading-core/contracts.ts. No grading weights here.
export const DEFECT_TYPES = Object.freeze(['FAINT_COLOR_VARIATION', 'VISIBLE_WHITENING', 'FRAYING', 'CHIPPING_EXPOSED_STOCK',
  'LIFTING_DEFORMATION', 'LIGHT_SCRATCH_SCUFF', 'VISIBLE_SCRATCH_PRINT_COATING_LOSS', 'DENT_MATERIAL_DAMAGE', 'PEELING_HEAVY_DAMAGE']);
export function frame(value) {
  object(value, ['imageVersion', 'originalSha256', 'preparationVersion', 'frameId', 'inspectionImageSha256', 'rectifiedImageSha256']);
  integer(value.imageVersion, 1); integer(value.preparationVersion, 1); string(value.frameId);
  for (const k of ['originalSha256', 'inspectionImageSha256', 'rectifiedImageSha256']) sha(value[k]);
  check(value.inspectionImageSha256 !== value.rectifiedImageSha256);
}
export function parseBinding(value) {
  object(value, ['sourceHash', 'manualRevision', 'manualContentHash', 'identityRevision', 'geometryRevision', 'defectRevision', 'sides']);
  sha(value.sourceHash); sha(value.manualContentHash);
  for (const k of ['manualRevision', 'identityRevision', 'geometryRevision', 'defectRevision']) integer(value[k], 1);
  object(value.sides, SIDES);
  for (const side of SIDES) {
    const slot = value.sides[side]; object(slot, ['frame', 'findingRevision', 'reviewRevision']); frame(slot.frame);
    integer(slot.findingRevision, 1); integer(slot.reviewRevision);
  }
  return clone(value);
}
export function assertCurrentBinding(captured, current) {
  check(canonical(parseBinding(captured)) === canonical(parseBinding(current)), 'DEFECT_ANALYSIS_STALE', 409);
}
export function reference(value) {
  // Same immutable artifact descriptor as manual-service/artifacts. Its complete
  // bytes remain under the host's authenticated, hash-verified artifact reader.
  object(value, ['key', 'sha256', 'byteCount', 'lineageSha256', 'cardId', 'kind']);
  uuid(value.cardId); sha(value.sha256); sha(value.lineageSha256); integer(value.byteCount, 1, 16 * 1024 * 1024);
  check(typeof value.kind === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value.kind)
    && typeof value.key === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_/-]*\.json$/.test(value.key)
    && value.key.endsWith(`/${value.cardId}/${value.kind}/${value.lineageSha256}-${value.sha256}.json`), 'DEFECT_ANALYSIS_ARTIFACT_REQUIRED');
  const encoded = canonical(value, 8192);
  check(!/(?:data:|https?:|"(?:bytes|base64|pixels|mask|traceWire)"\s*:)/i.test(encoded), 'DEFECT_ANALYSIS_ARTIFACT_REQUIRED');
  return JSON.parse(encoded);
}
