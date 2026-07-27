import sharp from "sharp";

export const PREVIEW_FRAME_STABILITY_VERSION =
  "ten-kings-preview-frame-stability-v1" as const;
export const PREVIEW_FRAME_STABILITY_WIDTH = 96;
export const PREVIEW_FRAME_STABILITY_HEIGHT = 128;

const CHANGED_PIXEL_DELTA = 6;
const MAX_STABLE_MEAN_ABSOLUTE_DELTA = 0.85;
const MAX_STABLE_CHANGED_PIXEL_FRACTION = 0.012;
const MIN_PHOTOMETRIC_VARIANCE = 1e-6;
const MIN_PHOTOMETRIC_SCALE = 0.5;
const MAX_PHOTOMETRIC_SCALE = 2;

export interface PreviewFrameStabilityFingerprint {
  version: typeof PREVIEW_FRAME_STABILITY_VERSION;
  width: typeof PREVIEW_FRAME_STABILITY_WIDTH;
  height: typeof PREVIEW_FRAME_STABILITY_HEIGHT;
  pixels: Buffer;
}

export interface PreviewFrameStabilityComparison {
  stable: boolean;
  meanAbsoluteDelta: number;
  changedPixelFraction: number;
}

function verifyFingerprint(
  value: PreviewFrameStabilityFingerprint,
): void {
  if (
    value.version !== PREVIEW_FRAME_STABILITY_VERSION ||
    value.width !== PREVIEW_FRAME_STABILITY_WIDTH ||
    value.height !== PREVIEW_FRAME_STABILITY_HEIGHT ||
    !Buffer.isBuffer(value.pixels) ||
    value.pixels.length !==
      PREVIEW_FRAME_STABILITY_WIDTH * PREVIEW_FRAME_STABILITY_HEIGHT
  ) {
    throw new Error("Preview frame stability fingerprint is invalid.");
  }
}

/**
 * Produces only a tiny grayscale motion fingerprint. This path never estimates
 * card geometry and has no capture or measurement authority.
 */
export async function buildPreviewFrameStabilityFingerprint(
  imageBuffer: Buffer,
): Promise<PreviewFrameStabilityFingerprint> {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 1) {
    throw new Error("Preview stability input must contain an encoded image.");
  }
  const { data, info } = await sharp(imageBuffer, { failOn: "error" })
    .rotate()
    .resize(PREVIEW_FRAME_STABILITY_WIDTH, PREVIEW_FRAME_STABILITY_HEIGHT, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== PREVIEW_FRAME_STABILITY_WIDTH ||
    info.height !== PREVIEW_FRAME_STABILITY_HEIGHT ||
    info.channels !== 1
  ) {
    throw new Error("Preview stability fingerprint dimensions are invalid.");
  }
  return {
    version: PREVIEW_FRAME_STABILITY_VERSION,
    width: PREVIEW_FRAME_STABILITY_WIDTH,
    height: PREVIEW_FRAME_STABILITY_HEIGHT,
    pixels: Buffer.from(data),
  };
}

export function comparePreviewFrameStability(
  previous: PreviewFrameStabilityFingerprint,
  current: PreviewFrameStabilityFingerprint,
): PreviewFrameStabilityComparison {
  verifyFingerprint(previous);
  verifyFingerprint(current);
  let previousTotal = 0;
  let currentTotal = 0;
  for (let index = 0; index < current.pixels.length; index += 1) {
    previousTotal += previous.pixels[index];
    currentTotal += current.pixels[index];
  }
  const previousMean = previousTotal / previous.pixels.length;
  const currentMean = currentTotal / current.pixels.length;
  let previousVariance = 0;
  let covariance = 0;
  for (let index = 0; index < current.pixels.length; index += 1) {
    const previousCentered = previous.pixels[index] - previousMean;
    previousVariance += previousCentered * previousCentered;
    covariance += previousCentered * (current.pixels[index] - currentMean);
  }
  const photometricScale = Math.min(
    MAX_PHOTOMETRIC_SCALE,
    Math.max(
      MIN_PHOTOMETRIC_SCALE,
      previousVariance > MIN_PHOTOMETRIC_VARIANCE
        ? covariance / previousVariance
        : 1,
    ),
  );
  const photometricOffset = currentMean - photometricScale * previousMean;
  let absoluteDelta = 0;
  let changedPixels = 0;
  for (let index = 0; index < current.pixels.length; index += 1) {
    const alignedPrevious =
      photometricScale * previous.pixels[index] + photometricOffset;
    const delta = Math.abs(current.pixels[index] - alignedPrevious);
    absoluteDelta += delta;
    if (delta >= CHANGED_PIXEL_DELTA) changedPixels += 1;
  }
  const meanAbsoluteDelta = absoluteDelta / current.pixels.length;
  const changedPixelFraction = changedPixels / current.pixels.length;
  return {
    stable:
      meanAbsoluteDelta <= MAX_STABLE_MEAN_ABSOLUTE_DELTA &&
      changedPixelFraction <= MAX_STABLE_CHANGED_PIXEL_FRACTION,
    meanAbsoluteDelta,
    changedPixelFraction,
  };
}
