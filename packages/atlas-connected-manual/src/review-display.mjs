import { descriptorSha256, parseDecodedFrame, parseDerivative } from '@atlas/photo-core';
import { requireThat } from '@atlas/manual-service/contract';

export const REVIEW_DISPLAY_POLICY = 'atlas-review-display-lossless-v1';
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const LIMITS = Object.freeze({ maxInputBytes: 256 * 1024 * 1024, maxPixels: 52_000_000,
  maxRasterBytes: 512 * 1024 * 1024, maxOutputBytes: 128 * 1024 * 1024, timeoutMs: 30000 });

/** Optional review transport, never a replacement for the authoritative photo.
 * Callers retain their normal current-card/session checks around this read.
 * Encoded objects are immutable derivatives; no card, geometry or grade changes.
 */
export function createReviewDisplayReader({ storage, keyPrefix, limited, generate = async input =>
  (await import('@atlas/photo-runtime')).createReviewDisplay(input), now = Date.now, maxEntries = 128, timeoutMs = 15000 } = {}) {
  requireThat(typeof limited === 'function' && typeof keyPrefix === 'string' && keyPrefix.length
    && Number.isInteger(maxEntries) && maxEntries >= 1 && maxEntries <= 1000
    && Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 15000, 500, 'MANUAL_DISPLAY_CONFIG_INVALID');
  const saved = new Map(), pending = new Map(), failures = new Map();
  const trim = map => { while (map.size > maxEntries) map.delete(map.keys().next().value); };
  async function prepare(photo, signal) {
    const frame = parseDecodedFrame(photo.workingFrame, photo.original, photo.decodePlan);
    const key = descriptorSha256(frame), cached = saved.get(key);
    if (cached) { saved.delete(key); saved.set(key, cached); return cached; }
    return limited(async () => {
      signal.throwIfAborted();
      const found = await storage.readDecodedFrame({ frame, original: photo.original, decodePlan: photo.decodePlan, signal });
      signal.throwIfAborted();
      const result = await generate({ bytes: found.bytes, frame, original: photo.original,
        decodePlan: photo.decodePlan, limits: LIMITS, signal });
      signal.throwIfAborted();
      requireThat(result.policyVersion === REVIEW_DISPLAY_POLICY && result.sourceSha256 === frame.raster.content.sha256
        && result.full.content.mime === 'image/webp' && result.preview.content.mime === 'image/jpeg'
        && result.full.dimensions.width === frame.raster.dimensions.width
        && result.full.dimensions.height === frame.raster.dimensions.height
        && Math.max(result.preview.dimensions.width, result.preview.dimensions.height) <= 768,
      503, 'MANUAL_DISPLAY_BINDING_INVALID');
      const descriptors = {};
      for (const kind of ['full', 'preview']) {
        const output = result[kind], dimensions = output.dimensions;
        const sx = dimensions.width / frame.raster.dimensions.width, sy = dimensions.height / frame.raster.dimensions.height;
        const extension = kind === 'full' ? 'webp' : 'jpg';
        const descriptor = parseDerivative({ schemaVersion: 1, kind: 'derivative',
          id: `${photo.original.uploadId}:review:${kind}:${output.content.sha256}`, purpose: 'preview',
          originalDescriptorSha256: frame.originalDescriptorSha256, frameDescriptorSha256: key,
          raster: { content: output.content, dimensions, object: {
            key: `${keyPrefix}/derived/${photo.original.binding.cardId}/${photo.original.uploadId}/review-v1-${key}-${kind}-${output.content.sha256}.${extension}`,
            versionId: null } },
          frameToDerivative: kind === 'full' ? IDENTITY : [sx, 0, (sx - 1) / 2, 0, sy, (sy - 1) / 2, 0, 0, 1],
          encoder: { name: REVIEW_DISPLAY_POLICY, version: '1', settingsSha256: descriptorSha256({ policyVersion: REVIEW_DISPLAY_POLICY, kind }) },
        }, frame, photo.original, photo.decodePlan);
        descriptors[kind] = await storage.writeDerivative({ descriptor, frame, original: photo.original,
          decodePlan: photo.decodePlan, bytes: output.bytes, signal });
      }
      signal.throwIfAborted();
      saved.set(key, descriptors); trim(saved); return descriptors;
    });
  }
  return async function reviewDisplay(photo) {
    const key = descriptorSha256(photo.workingFrame);
    if ((failures.get(key) ?? 0) > now()) return null;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 18) return null;
    // One deadline belongs to the shared operation, including queue time,
    // storage, native work and grants. Optional display must never strand PNG.
    const controller = new AbortController(), signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(new Error('MANUAL_DISPLAY_TIMEOUT')), timeoutMs);
    const aborted = new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    const work = (async () => {
      const descriptors = await prepare(photo, signal), reads = {};
      for (const kind of ['preview', 'full']) reads[kind] = await storage.createDerivativeRead({ descriptor: descriptors[kind],
        frame: photo.workingFrame, original: photo.original, decodePlan: photo.decodePlan, expiresIn: 300, signal });
      signal.throwIfAborted();
      return { ...reads.full, policyVersion: REVIEW_DISPLAY_POLICY, sourceSha256: photo.workingFrame.raster.content.sha256,
        ...descriptors.full.raster.dimensions, preview: { ...reads.preview, ...descriptors.preview.raster.dimensions } };
    })();
    const operation = Promise.race([work, aborted]).then(value => { failures.delete(key); return value; }).catch(() => {
      // Display optimization cannot strand an otherwise valid saved photo.
      // The caller still returns its hash-bound canonical PNG read descriptor.
      failures.set(key, now() + 30000); trim(failures); return null;
    }).finally(() => { clearTimeout(timeout); pending.delete(key); });
    pending.set(key, operation); return operation;
  };
}
