import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { descriptorSha256, parseDecodedFrame, parseDerivative } from '@atlas/photo-core';
import { PreparationError } from './process.mjs';
import { hashOwnedBytes } from './hash-bytes.mjs';

export const PREPARATION_LOSSLESS_SETTINGS = Object.freeze({ format: 'webp', lossless: true, sourceBitDepth: 8,
  policyVersion: 'atlas-prepared-lossless-webp-v1' });
export const PREPARATION_LEGACY_SETTINGS = Object.freeze({ format: 'webp', quality: 92, sourceBitDepth: 8 });
export const INSPECTION_PREVIEW_POLICY = 'atlas-inspection-preview-v1';
const PREVIEW_SETTINGS = Object.freeze({ format: 'jpeg', quality: 78, maxEdge: 768, sourceBitDepth: 8, policyVersion: INSPECTION_PREVIEW_POLICY });
const requireThat = (ok, code = 'PREPARATION_OUTPUT_INVALID') => { if (!ok) throw new PreparationError(code); };
export const sameEncoder = (value, expected) => Boolean(value && descriptorSha256(value) === descriptorSha256(expected));

export async function readInspectionPreview(result, directory, { total, maxOutputBytes, signal }) {
  if (sameEncoder(result.encoderSettings, PREPARATION_LEGACY_SETTINGS)) {
    requireThat(result.inspectionPreview === undefined);
    return undefined;
  }
  requireThat(sameEncoder(result.encoderSettings, PREPARATION_LOSSLESS_SETTINGS));
  const output = result.inspectionPreview;
  requireThat(output && output.filename === 'inspection-preview.jpg' && output.mime === 'image/jpeg'
    && output.policyVersion === INSPECTION_PREVIEW_POLICY && output.sourceSha256 === result.frames.inspection.sha256
    && output.width === 558 && output.height === 768);
  const path = join(directory, output.filename), size = (await stat(path)).size;
  requireThat(Number.isSafeInteger(size) && size > 0 && size <= 1024 * 1024 && size === output.byteCount
    && total + size <= maxOutputBytes, 'PREPARATION_LIMIT');
  const bytes = await readFile(path);
  requireThat(await hashOwnedBytes(bytes, signal) === output.sha256);
  return { ...output, bytes };
}

/** The small display derivative is outside canonical preparation outputs and
 * cannot serve as inspection, model evidence or review approval authority. */
export function describePreparationPreview(result, source, { id, object }) {
  const frame = parseDecodedFrame(source.frame, source.original, source.decodePlan), output = result.inspectionPreview;
  requireThat(sameEncoder(result.encoderSettings, PREPARATION_LOSSLESS_SETTINGS));
  requireThat(output && result.frameDescriptorSha256 === descriptorSha256(frame)
    && output.bytes instanceof Uint8Array && output.bytes.byteLength === output.byteCount
    && output.byteCount > 0 && output.byteCount <= 1024 * 1024
    && createHash('sha256').update(output.bytes).digest('hex') === output.sha256
    && output.mime === 'image/jpeg' && output.width === 558 && output.height === 768
    && output.policyVersion === INSPECTION_PREVIEW_POLICY
    && output.sourceSha256 === result.frame.inspection.sha256
    && output.sourceSha256 === result.outputs.inspection.sha256, 'PREPARATION_SOURCE_MISMATCH');
  return parseDerivative({ schemaVersion: 1, kind: 'derivative', id, purpose: 'preview',
    originalDescriptorSha256: frame.originalDescriptorSha256, frameDescriptorSha256: descriptorSha256(frame),
    raster: { content: { mime: output.mime, sha256: output.sha256, byteCount: output.byteCount },
      dimensions: { width: output.width, height: output.height }, object }, frameToDerivative: output.frameToDerivative,
    encoder: { name: 'opencv-jpeg', version: result.identity.opencv, settingsSha256: descriptorSha256(PREVIEW_SETTINGS) },
  }, frame, source.original, source.decodePlan);
}
