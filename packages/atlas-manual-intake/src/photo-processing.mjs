import { descriptorSha256 } from '@atlas/photo-core';
import { deriveSdrWorkingPhoto, verifyAndDecodePhoto } from '@atlas/photo-runtime';
import { processedPhoto, requireThat } from './contract.mjs';

/** Explicit owner-selected treatment: retain the byte-identical HDR original,
 * keep the rich primary PNG, and derive a separate full-size SDR working PNG.
 * Uses the same injected private photo storage as direct upload verification.
 * No resizing, browser conversion, primary overwrite or remote URL fetching.
 */
export function createPhotoProcessor({ storage, keyPrefix, decodeLimits }) {
  requireThat(typeof storage?.writeDecodedFrame === 'function' && typeof keyPrefix === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,100}$/.test(keyPrefix) && !keyPrefix.includes('..') && !keyPrefix.endsWith('/'),
  500, 'INTAKE_CONFIG_INVALID');
  const limits = Object.freeze(structuredClone(decodeLimits));
  return async ({ uploadPlan, verification, bytes, signal }) => {
    const decoded = await verifyAndDecodePhoto({ uploadPlan, observedObject: verification.object, bytes,
      limits, heicHdrPolicy: 'retain-hdr-use-sdr-base', jpegHdrPolicy: 'retain-hdr-use-sdr-base', signal });
    const sourceHash = descriptorSha256({ original: decoded.original, decodePlan: decoded.decodePlan,
      raster: decoded.raster, treatment: decoded.treatment });
    const prefix = `${keyPrefix}/derived/${uploadPlan.binding.cardId}/${uploadPlan.uploadId}`;
    const decodedFrame = await storage.writeDecodedFrame(decoded, {
      id: `${uploadPlan.uploadId}:decoded:${sourceHash}`, key: `${prefix}/decoded-${sourceHash}.png`, signal });
    const working = await deriveSdrWorkingPhoto(decoded, { limits, signal });
    const workingHash = descriptorSha256({ sourceHash, raster: working.raster, treatment: working.treatment, workingImage: working.workingImage });
    const workingFrame = await storage.writeDecodedFrame(working, {
      id: `${uploadPlan.uploadId}:working:${workingHash}`, key: `${prefix}/working-${workingHash}.png`, signal });
    return processedPhoto({ original: decoded.original, decodePlan: decoded.decodePlan, decodedFrame, workingFrame }, uploadPlan, verification);
  };
}
