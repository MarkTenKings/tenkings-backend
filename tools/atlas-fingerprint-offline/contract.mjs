// Standalone copied-data contract. Only Node's hash primitive is imported;
// no ATLAS package, runtime, credentials, acquisition or grading calculation.
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ manifestBytes: 65536, packetBytes: 8 * 1024 * 1024,
  imageBytes: 50 * 1024 * 1024, packageBytes: 109 * 1024 * 1024, findings: 400,
  jsonDepth: 32, jsonNodes: 1000000, tracePixels: 2258060 });
export const FILES = Object.freeze(['manifest.json', 'packet.json', 'front.webp', 'back.webp']);
const HASH = /^[a-f0-9]{64}$/;
const SIDES = ['FRONT', 'BACK'];
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
export function requireFact(ok, code = 'REFERENCE_CONTRACT_INVALID') {
  if (!ok) throw Object.assign(new Error(code), { code });
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sha = value => typeof value === 'string' && HASH.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, max = 180) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const n = Date.parse(value); return Number.isFinite(n) && new Date(n).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}

/** Bounded UTF-8 JSON, including duplicate-key refusal. JSON.parse alone would
 * silently discard a conflicting earlier approval/hash field. No revivers. */
export function parseJson(bytes, maxBytes) {
  requireFact(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= maxBytes, 'REFERENCE_JSON_SIZE');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { requireFact(false, 'REFERENCE_JSON_ENCODING'); }
  let at = 0, nodes = 0;
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const space = () => { while (/[ \t\r\n]/.test(source[at] ?? '') && at < source.length) at++; };
  function string() {
    const start = at++; let escaped = false;
    while (at < source.length) {
      const c = source[at++];
      if (c === '"' && !escaped) { try { return JSON.parse(source.slice(start, at)); } catch { break; } }
      if (c === '\\' && !escaped) escaped = true; else escaped = false;
    }
    requireFact(false, 'REFERENCE_JSON_INVALID');
  }
  function read(depth) {
    requireFact(depth <= LIMITS.jsonDepth && ++nodes <= LIMITS.jsonNodes, 'REFERENCE_JSON_COMPLEXITY'); space();
    const c = source[at];
    if (c === '"') return string();
    if (c === '{') {
      at++; space(); const value = {};
      if (source[at] === '}') { at++; return value; }
      for (;;) {
        requireFact(source[at] === '"', 'REFERENCE_JSON_INVALID'); const key = string();
        requireFact(!['__proto__', 'prototype', 'constructor'].includes(key) && !Object.hasOwn(value, key), 'REFERENCE_JSON_DUPLICATE_OR_UNSAFE_KEY');
        space(); requireFact(source[at++] === ':', 'REFERENCE_JSON_INVALID'); value[key] = read(depth + 1); space();
        if (source[at] === '}') { at++; return value; }
        requireFact(source[at++] === ',', 'REFERENCE_JSON_INVALID'); space();
      }
    }
    if (c === '[') {
      at++; space(); const value = []; if (source[at] === ']') { at++; return value; }
      for (;;) { value.push(read(depth + 1)); space(); if (source[at] === ']') { at++; return value; }
        requireFact(source[at++] === ',', 'REFERENCE_JSON_INVALID'); }
    }
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) if (source.startsWith(token, at)) { at += token.length; return value; }
    numberToken.lastIndex = at; const number = numberToken.exec(source);
    requireFact(number && Number.isFinite(Number(number[0])), 'REFERENCE_JSON_INVALID'); at += number[0].length; return Number(number[0]);
  }
  const value = read(0); space(); requireFact(at === source.length, 'REFERENCE_JSON_INVALID'); return value;
}

export function parseManifest(bytes) {
  const m = parseJson(bytes, LIMITS.manifestBytes);
  requireFact(exact(m, ['schema', 'copy', 'approval', 'packet', 'images', 'geometrySha256', 'traces'])
    && m.schema === 'atlas-fingerprint-offline-reference-v1');
  requireFact(exact(m.copy, ['kind', 'humanSupplied', 'copyReference', 'copiedAt', 'sourceClass'])
    && m.copy.kind === 'OFFLINE_COPY' && m.copy.humanSupplied === true && text(m.copy.copyReference)
    && timestamp(m.copy.copiedAt) && ['DECLARED_APPROVED_COPY', 'SYNTHETIC_FIXTURE'].includes(m.copy.sourceClass), 'REFERENCE_COPY_DECLARATION_REQUIRED');
  const a = m.approval;
  requireFact(exact(a, ['publicToken', 'reportNumber', 'version', 'approvedAt', 'publicHash', 'reportHash', 'identitySha256'])
    && /^ar_[A-Za-z0-9_-]{24}$/.test(a.publicToken) && /^ATLAS-[A-F0-9]{12}$/.test(a.reportNumber)
    && integer(a.version, 1, 2147483647) && timestamp(a.approvedAt)
    && ['publicHash', 'reportHash', 'identitySha256'].every(key => sha(a[key]))
    && Date.parse(m.copy.copiedAt) >= Date.parse(a.approvedAt));
  requireFact(exact(m.packet, ['path', 'sha256', 'byteCount']) && m.packet.path === 'packet.json'
    && m.packet.sha256 === a.publicHash && integer(m.packet.byteCount, 1, LIMITS.packetBytes));
  requireFact(exact(m.images, SIDES) && sha(m.geometrySha256));
  for (const side of SIDES) {
    const i = m.images[side];
    requireFact(exact(i, ['path', 'role', 'sha256', 'byteCount', 'contentType', 'width', 'height'])
      && i.path === `${side.toLowerCase()}.webp` && i.role === 'APPROVED_INSPECTION_DERIVATIVE'
      && sha(i.sha256) && integer(i.byteCount, 20, LIMITS.imageBytes)
      && i.contentType === 'image/webp' && i.width === 1350 && i.height === 1858, 'REFERENCE_INSPECTION_MEDIA_REQUIRED');
  }
  requireFact(m.packet.byteCount + m.images.FRONT.byteCount + m.images.BACK.byteCount + bytes.byteLength <= LIMITS.packageBytes, 'REFERENCE_PACKAGE_SIZE');
  requireFact(Array.isArray(m.traces) && m.traces.length <= LIMITS.findings && m.traces.every(t => exact(t, ['findingId', 'side', 'sha256'])
    && text(t.findingId) && SIDES.includes(t.side) && (t.sha256 === null || sha(t.sha256)))
    && new Set(m.traces.map(t => t.findingId)).size === m.traces.length);
  return m;
}

const point = p => exact(p, ['x', 'y']) && ['x', 'y'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1);
function quad(q) {
  requireFact(Array.isArray(q) && q.length === 4 && q.every(point), 'REFERENCE_GEOMETRY_INVALID');
  let sign;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    requireFact(Math.abs(cross) > 1e-10 && (sign === undefined || Math.sign(cross) === sign), 'REFERENCE_GEOMETRY_INVALID'); sign = Math.sign(cross);
  }
}
function trace(t) {
  requireFact(exact(t, ['format', 'width', 'height', 'origin', 'order', 'runs', 'sha256'])
    && t.format === 'TK_SPEEDSTER_TRACE_RLE_V1' && t.width === 1270 && t.height === 1778 && t.origin === 'TOP_LEFT' && t.order === 'ROW_MAJOR_Y_X'
    && sha(t.sha256) && Array.isArray(t.runs) && t.runs.length > 0 && t.runs.length <= LIMITS.tracePixels + 1, 'REFERENCE_TRACE_INVALID');
  let total = 0, occupied = 0;
  for (let i = 0; i < t.runs.length; i++) { const n = t.runs[i]; requireFact(integer(n, i ? 1 : 0, LIMITS.tracePixels), 'REFERENCE_TRACE_INVALID'); total += n; if (i % 2) occupied += n; }
  requireFact(total === LIMITS.tracePixels && occupied > 0, 'REFERENCE_TRACE_INVALID');
  // Frozen external data format, independently implemented with node:crypto.
  const preimage = `${t.format}\n${t.width}\n${t.height}\n${t.origin}\n${t.order}\n0\n${t.runs.join(',')}\n`;
  requireFact(digest(preimage) === t.sha256, 'REFERENCE_TRACE_HASH_MISMATCH'); return t.sha256;
}

/** Checks copied bindings, masks and geometry, never recalculates a grade.
 * reportHash is an opaque approved-record identifier: the original private
 * report serialization is not supplied here, so its digest is NOT re-proven. */
export function validatePacket(bytes, manifest) {
  requireFact(bytes.byteLength === manifest.packet.byteCount && digest(bytes) === manifest.approval.publicHash, 'REFERENCE_PACKET_HASH_MISMATCH');
  const p = parseJson(bytes, LIMITS.packetBytes), a = manifest.approval;
  requireFact(exact(p, ['version', 'publicToken', 'reportNumber', 'approvalVersion', 'approvedAt', 'mode', 'reportHash', 'report', 'images', 'geometry'])
    && p.version === 'atlas-public-manual-report-v2' && p.publicToken === a.publicToken && p.reportNumber === a.reportNumber
    && p.approvalVersion === a.version && p.approvedAt === a.approvedAt && p.reportHash === a.reportHash
    && p.mode === (manifest.copy.sourceClass === 'SYNTHETIC_FIXTURE' ? 'LOCAL_FIXTURE' : 'PRODUCTION'), 'REFERENCE_APPROVAL_MISMATCH');
  const r = p.report;
  requireFact(exact(r, ['version', 'ruleVersion', 'cardProfile', 'identity', 'draftRevision', 'inspection', 'grade', 'finalGrade', 'finalGradePolicy', 'findings', 'findingCounts'])
    && r.version === 'atlas-manual-draft-report-v2' && text(r.ruleVersion) && ['SPORTS', 'POKEMON'].includes(r.cardProfile)
    && object(r.identity) && digest(canonical(r.identity)) === a.identitySha256 && integer(r.draftRevision, 1, 2147483647)
    && object(r.grade) && typeof r.finalGrade === 'number' && r.finalGrade >= 0 && r.finalGrade <= 10 && Number.isInteger(r.finalGrade * 2)
    && ['atlas-final-half-point-v1', 'atlas-final-whole-point-v1'].includes(r.finalGradePolicy)
    && (r.finalGradePolicy !== 'atlas-final-whole-point-v1' || integer(r.finalGrade, 1, 10)), 'REFERENCE_REPORT_INVALID');
  requireFact(exact(r.inspection, ['method', 'front', 'back']) && r.inspection.method === 'HUMAN' && exact(p.images, SIDES) && exact(p.geometry, SIDES));
  for (const side of SIDES) {
    const i = p.images[side], m = manifest.images[side], inspected = r.inspection[side.toLowerCase()];
    requireFact(exact(i, ['sha256', 'byteCount', 'width', 'height', 'contentType']) && Object.keys(i).every(key => i[key] === m[key])
      && exact(inspected, ['inspected', 'imageSha256', 'findingRevision']) && inspected.inspected === true
      && inspected.imageSha256 === i.sha256 && integer(inspected.findingRevision, 1, 2147483647), 'REFERENCE_IMAGE_BINDING_MISMATCH');
    requireFact(exact(p.geometry[side], ['physicalQuad', 'printedQuad']), 'REFERENCE_GEOMETRY_INVALID');
    quad(p.geometry[side].physicalQuad); quad(p.geometry[side].printedQuad);
  }
  requireFact(digest(canonical(p.geometry)) === manifest.geometrySha256, 'REFERENCE_GEOMETRY_HASH_MISMATCH');
  requireFact(Array.isArray(r.findings) && r.findings.length <= LIMITS.findings && exact(r.findingCounts, ['total', 'included', 'removed', 'unreviewed'])
    && r.findingCounts.total === r.findings.length && r.findingCounts.included === r.findings.length
    && r.findingCounts.removed === 0 && r.findingCounts.unreviewed === 0, 'REFERENCE_FINDINGS_INVALID');
  const index = r.findings.map(f => {
    requireFact(object(f), 'REFERENCE_FINDINGS_INVALID');
    const base = ['id', 'side', 'defectType', 'confidence', 'sourceViewId', 'supportingViewIds', 'reviewResult'];
    const fields = Object.hasOwn(f, 'finalTrace') ? [...base, 'finalTrace', 'traceProvenance', 'measurementRegions']
      : [...base, 'zone', 'canonicalContour', 'measurement', ...(Object.hasOwn(f, 'detectorMask') ? ['detectorMask'] : [])];
    requireFact(exact(f, fields) && text(f.id) && SIDES.includes(f.side) && text(f.defectType) && typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1
      && f.sourceViewId === f.side && Array.isArray(f.supportingViewIds) && f.supportingViewIds.length <= 2 && f.supportingViewIds.every(s => SIDES.includes(s))
      && ['ACCEPTED', 'SMART_MARKED', 'TYPE_CORRECTED'].includes(f.reviewResult), 'REFERENCE_FINDINGS_INVALID');
    const regions = f.finalTrace ? f.measurementRegions : [{ zone: f.zone, canonicalContour: f.canonicalContour, measurement: f.measurement }];
    requireFact(Array.isArray(regions) && regions.length <= 3 && regions.every(region => exact(region, ['zone', 'canonicalContour', 'measurement'])
      && ['CORNERS', 'EDGES', 'SURFACE'].includes(region.zone) && object(region.measurement) && Array.isArray(region.canonicalContour)
      && region.canonicalContour.length >= 3 && region.canonicalContour.length <= 100000 && region.canonicalContour.every(point)), 'REFERENCE_FINDINGS_INVALID');
    const mask = f.finalTrace ?? f.detectorMask, maskHash = mask ? trace(mask) : null;
    if (f.finalTrace) requireFact(exact(f.traceProvenance, ['finalTraceSha256']) && f.traceProvenance.finalTraceSha256 === maskHash, 'REFERENCE_TRACE_HASH_MISMATCH');
    return { findingId: f.id, side: f.side, sha256: maskHash };
  });
  requireFact(new Set(index.map(f => f.findingId)).size === index.length, 'REFERENCE_FINDINGS_INVALID');
  const sorted = values => [...values].sort((x, y) => x.findingId < y.findingId ? -1 : x.findingId > y.findingId ? 1 : 0);
  requireFact(canonical(sorted(index)) === canonical(sorted(manifest.traces)), 'REFERENCE_TRACE_INDEX_MISMATCH');
  return { identity: r.identity, findingCount: index.length, availableTraces: index.filter(t => t.sha256 !== null).length };
}

/** Static WebP framing/dimensions only. This is NOT an image decoder: accepted
 * bitstreams still require a separately isolated decoder before any display. */
export function validateImage(bytes, descriptor) {
  requireFact(Buffer.isBuffer(bytes), 'REFERENCE_IMAGE_BYTES_REQUIRED');
  requireFact(bytes.byteLength === descriptor.byteCount && digest(bytes) === descriptor.sha256, 'REFERENCE_IMAGE_HASH_MISMATCH');
  requireFact(bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.readUInt32LE(4) + 8 === bytes.length
    && bytes.toString('ascii', 8, 12) === 'WEBP', 'REFERENCE_WEBP_HEADER_INVALID');
  let at = 12, dimensions = null, canvas = null, chunks = 0;
  while (at < bytes.length) {
    requireFact(at + 8 <= bytes.length && ++chunks <= 16, 'REFERENCE_WEBP_HEADER_INVALID');
    const kind = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4), start = at + 8, end = start + length;
    requireFact(['VP8X', 'VP8 ', 'VP8L', 'ICCP', 'ALPH', 'EXIF', 'XMP '].includes(kind) && length > 0 && end + (length % 2) <= bytes.length
      && (!(length % 2) || bytes[end] === 0), 'REFERENCE_WEBP_HEADER_INVALID');
    if (kind === 'VP8X') {
      requireFact(at === 12 && length === 10 && !canvas && !(bytes[start] & 2), 'REFERENCE_WEBP_HEADER_INVALID');
      canvas = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    } else if (kind === 'VP8 ' || kind === 'VP8L') {
      requireFact(!dimensions, 'REFERENCE_WEBP_HEADER_INVALID');
      if (kind === 'VP8 ') {
        requireFact(length >= 10 && !(bytes[start] & 1) && bytes.subarray(start + 3, start + 6).equals(Buffer.from([157, 1, 42])), 'REFERENCE_WEBP_HEADER_INVALID');
        dimensions = { width: bytes.readUInt16LE(start + 6) & 16383, height: bytes.readUInt16LE(start + 8) & 16383 };
      } else {
        requireFact(length >= 5 && bytes[start] === 47 && bytes[start + 4] >> 5 === 0, 'REFERENCE_WEBP_HEADER_INVALID');
        const bits = bytes.readUInt32LE(start + 1); dimensions = { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
      }
    }
    at = end + (length % 2);
  }
  requireFact(dimensions && dimensions.width === descriptor.width && dimensions.height === descriptor.height
    && (!canvas || canvas.width === dimensions.width && canvas.height === dimensions.height), 'REFERENCE_IMAGE_DIMENSIONS_MISMATCH');
}
