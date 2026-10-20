// Bundled into the static homepage. This uses the same bounded public-grant
// loader as live reports, and the exact report fingerprint implementation.
import { loadPublicImageAccess, createPublicImageAccessLoader } from './public-image-access.mjs';
import { parseInspectionAccess } from '@atlas/service-bridge/inspection-access';
import { SPEEDSTER_CARD_DIMENSIONS } from '@atlas/grading-core/geometry';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { loadVerifiedImage } from '../../../packages/atlas-manual-workspace/src/verified-image.mjs';
import { fingerprintFieldSteps, fingerprintSampleSteps, scheduleFingerprint,
  paintFingerprintPixels, FINGERPRINT_MAX_WIDTH } from '../../../packages/atlas-manual-workspace/src/report-fingerprint.mjs';

export function qualifiedCardDimensions(profile) {
  return Object.hasOwn(SPEEDSTER_CARD_DIMENSIONS, profile) ? { ...SPEEDSTER_CARD_DIMENSIONS[profile] } : null;
}

const sections = new Set(['hero', 'report', 'fingerprint', 'connected']);
const check = (condition, message) => { if (!condition) throw new Error(`ATLAS showcase: ${message}`); };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
const contextSignal = signal => signal ?? new AbortController().signal;

export async function validateShowcaseSource(value, section) {
  check(sections.has(section) && value?.schema === 'atlas-showcase-source-v1' && value.section === section, 'wrong section');
  const packet = parsePublicManualReport(value.packet), binding = value.binding;
  check(packet.mode === 'PRODUCTION' && binding?.publicToken === packet.publicToken
    && binding.approvalVersion === packet.approvalVersion && binding.publicHash === value.publicHash
    && /^[a-f0-9]{64}$/.test(value.publicHash), 'wrong report binding');
  check(await hash(new TextEncoder().encode(JSON.stringify(value.packet))) === value.publicHash, 'report hash mismatch');
  return { ...value, packet };
}

export async function loadShowcaseSource(section, { signal, fetcher } = {}) {
  check(sections.has(section), 'unknown section');
  const bounded = contextSignal(signal);
  const loader = fetcher ? createPublicImageAccessLoader({ fetchImpl: fetcher }) : loadPublicImageAccess;
  const value = await loader(`/api/showcase?section=${section}`, { signal: bounded, parse: value => value });
  const source = await validateShowcaseSource(value, section);
  bounded.throwIfAborted(); return source;
}

async function generatedBlob(asset, signal) {
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  const fingerprint = asset.kind === 'SHOWCASE_FINGERPRINT';
  canvas.width = fingerprint ? FINGERPRINT_MAX_WIDTH : 1270;
  canvas.height = fingerprint ? Math.round(FINGERPRINT_MAX_WIDTH * 1778 / 1270) : 1778;
  const context = canvas.getContext('2d');
  check(context, 'canvas unavailable');
  if (fingerprint && asset.spans.length) {
    const field = await scheduleFingerprint(fingerprintFieldSteps(asset.spans), { signal });
    const sampled = await scheduleFingerprint(fingerprintSampleSteps(field, canvas.width, canvas.height), { signal });
    const image = context.createImageData(canvas.width, canvas.height);
    paintFingerprintPixels(image.data, sampled, 1); context.putImageData(image, 0, 0);
  } else if (!fingerprint) {
    context.fillStyle = '#fff';
    for (const span of asset.spans) context.fillRect(span.x, span.y, span.width, 1);
  }
  signal.throwIfAborted();
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('ATLAS showcase: raster unavailable')), 'image/png'));
  signal.throwIfAborted(); return blob;
}

export async function fetchShowcaseAsset(asset, { signal, fetcher } = {}) {
  const bounded = contextSignal(signal); bounded.throwIfAborted();
  if (asset?.kind === 'SHOWCASE_MASK' || asset?.kind === 'SHOWCASE_FINGERPRINT') return generatedBlob(asset, bounded);
  check(asset?.kind === 'SHOWCASE_ORIGINAL', 'unsupported asset');
  const loader = fetcher ? createPublicImageAccessLoader({ fetchImpl: fetcher }) : loadPublicImageAccess;
  const parsed = await loader(`${asset.src}&delivery=direct`, { signal: bounded,
    parse: value => parseInspectionAccess(value, { publicToken: asset.publicToken,
      approvalVersion: asset.approvalVersion, publicHash: asset.publicHash, side: asset.side,
      sha256: asset.sha256, byteCount: asset.bytes }) });
  // Byte count, exact SHA-256, MIME and deadline remain the existing verifier's
  // responsibility. Blob URLs are local ownership, never saved authority.
  let blob;
  const verified = await loadVerifiedImage(parsed.image, { signal: bounded,
    ...(fetcher ? { fetchImpl: fetcher } : {}),
    urlImpl: { createObjectURL(value) { blob = value; return URL.createObjectURL(value); },
      revokeObjectURL(value) { URL.revokeObjectURL(value); } } });
  // Keep the exact Blob the verifier created after hashing. Fetching its blob:
  // URL would violate the public connect-src policy and needlessly copy bytes.
  try { bounded.throwIfAborted(); check(blob instanceof Blob, 'verified image unavailable'); return blob; }
  finally { verified.dispose(); }
}
