import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from "@tenkings/shared";
import type { FixedRigPhotometricEvidenceV1 } from "./fixedRigPhotometricEvidenceV1";

export const FIXED_RIG_COMMON_MODE_INTERIOR_ADMISSION_V1_VERSION =
  "fixed_rig_common_mode_interior_admission_v1" as const;

interface Component {
  pixels: number[];
  x: number;
  y: number;
  width: number;
  height: number;
}

function components(mask: Uint8Array, width: number, height: number): Component[] {
  const visited = new Uint8Array(mask.length);
  const output: Component[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const pixels = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (cursor < pixels.length) {
      const index = pixels[cursor++]!;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          pixels.push(next);
        }
      }
    }
    output.push({
      pixels,
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }
  return output;
}

export function applyFixedRigCommonModeInteriorAdmissionV1(input: {
  evidence: FixedRigPhotometricEvidenceV1;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  adaptiveRawGuardFailureMask?: Uint8Array;
  normalizedFloorFailureMask?: Uint8Array;
  selectedFusedClippingMask?: Uint8Array;
}): FixedRigPhotometricEvidenceV1 {
  const evidence = input.evidence;
  const policy =
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionSegmentation.regionGeometry;
  const pixelCount = evidence.width * evidence.height;
  const empty = new Uint8Array(pixelCount);
  const adaptive = input.adaptiveRawGuardFailureMask ?? empty;
  const normalizedFloor = input.normalizedFloorFailureMask ?? empty;
  const selectedClipping = input.selectedFusedClippingMask ?? evidence.clippingMask;
  if (
    adaptive.length !== pixelCount ||
    normalizedFloor.length !== pixelCount ||
    selectedClipping.length !== pixelCount
  ) {
    throw new Error("Admission cause masks do not match the normalized-card frame.");
  }
  const invalid = new Uint8Array(pixelCount);
  let invalidPixelCount = 0;
  let selectedClippingPixelCount = 0;
  let exclusivelyCommonMode = true;
  for (let index = 0; index < pixelCount; index += 1) {
    if (!evidence.gradeRelevantMask[index]) continue;
    if (selectedClipping[index]) selectedClippingPixelCount += 1;
    if (!evidence.invalidIlluminationMask[index]) continue;
    invalid[index] = 1;
    invalidPixelCount += 1;
    const channelCause = evidence.channels.some((channel) =>
      Boolean(
        channel.underexposureMask[index] ||
        channel.saturationMask[index] ||
        channel.lowConfidenceMask[index],
      ));
    if (
      !evidence.commonModeSpecularMask[index] ||
      evidence.calibratedIlluminationPatternMask[index] ||
      evidence.lowConfidenceMask[index] ||
      evidence.clippingMask[index] ||
      adaptive[index] ||
      normalizedFloor[index] ||
      channelCause
    ) {
      exclusivelyCommonMode = false;
    }
  }
  const allComponents = components(invalid, evidence.width, evidence.height);
  const qualifying = allComponents.filter((component) =>
    component.pixels.length >= 12);
  const region = qualifying[0];
  const cornerWidth = Math.ceil(policy.cornerRoiSizeMm * input.pixelsPerMmX);
  const cornerHeight = Math.ceil(policy.cornerRoiSizeMm * input.pixelsPerMmY);
  const whollyDeepInterior = Boolean(region) && region!.pixels.every((index) => {
    const x = index % evidence.width;
    const y = Math.floor(index / evidence.width);
    return (
      x >= cornerWidth &&
      x < evidence.width - cornerWidth &&
      y >= cornerHeight &&
      y < evidence.height - cornerHeight
    );
  });
  const admitted =
    evidence.coverage.validPixelFraction >= 0.9999 &&
    selectedClippingPixelCount === 0 &&
    invalidPixelCount <= 24 &&
    exclusivelyCommonMode &&
    qualifying.length === 1 &&
    Boolean(region) &&
    region!.pixels.length >= 12 &&
    region!.pixels.length <= 17 &&
    whollyDeepInterior;
  if (!admitted) return evidence;

  const admissionExcludedCommonModeMask = new Uint8Array(pixelCount);
  for (const index of region!.pixels) admissionExcludedCommonModeMask[index] = 1;
  return {
    ...evidence,
    status: "computed",
    admissionExcludedCommonModeMask,
    admissionAdjustment: {
      version: FIXED_RIG_COMMON_MODE_INTERIOR_ADMISSION_V1_VERSION,
      region: {
        x: region!.x,
        y: region!.y,
        width: region!.width,
        height: region!.height,
        pixelCount: region!.pixels.length,
      },
      totalInvalidPixelCount: invalidPixelCount,
      qualifyingComponentCount: qualifying.length,
      selectedFusedClippingPixelCount: selectedClippingPixelCount,
      allInvalidPixelsExclusivelyCommonMode: true,
      deepInterior: true,
    },
    ungradableRegions: evidence.ungradableRegions.filter(
      (candidate) =>
        candidate.x !== region!.x ||
        candidate.y !== region!.y ||
        candidate.width !== region!.width ||
        candidate.height !== region!.height ||
        candidate.pixelCount !== region!.pixels.length,
    ),
    evidenceLimitations: evidence.evidenceLimitations.filter(
      (limitation) => limitation.code !== "localized_ungradable_region",
    ),
  };
}
