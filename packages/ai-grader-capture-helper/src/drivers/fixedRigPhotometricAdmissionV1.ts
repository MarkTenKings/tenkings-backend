import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from "@tenkings/shared";
import type { FixedRigPhotometricEvidenceV1 } from "./fixedRigPhotometricEvidenceV1";

export const FIXED_RIG_COMMON_MODE_INTERIOR_ADMISSION_V1_VERSION =
  "fixed_rig_common_mode_interior_admission_v1" as const;
export const FIXED_RIG_OBSERVABLE_LOCALIZED_EVIDENCE_ADMISSION_V1_VERSION =
  "fixed_rig_observable_localized_evidence_admission_v1" as const;

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
    admissionExcludedTopologyMask: admissionExcludedCommonModeMask,
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
      allInvalidComponentPixelCounts: allComponents
        .map((component) => component.pixels.length)
        .sort((left, right) => right - left),
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

/**
 * Converts localized "fog" from a whole-side veto into excluded evidence.
 *
 * This does not make one invalid pixel valid, prove it clean, or allow it to
 * become a defect. Only genuinely fully obscured evidence remains a
 * measurement blocker. Ordinary partial/foggy coverage remains excluded from
 * defect masks and is carried as private quality/U95 context.
 */
export function applyFixedRigObservableLocalizedEvidenceAdmissionV1(
  evidence: FixedRigPhotometricEvidenceV1,
): FixedRigPhotometricEvidenceV1 {
  if (evidence.status === "computed") return evidence;
  if (evidence.coverage.validPixelCount <= 0) return evidence;

  const pixelCount = evidence.width * evidence.height;
  const topologyMask = new Uint8Array(pixelCount);
  let localizedUngradablePixelCount = 0;
  for (const region of evidence.ungradableRegions) {
    localizedUngradablePixelCount += region.pixelCount;
  }
  for (let index = 0; index < pixelCount; index += 1) {
    if (
      evidence.gradeRelevantMask[index] &&
      evidence.invalidIlluminationMask[index]
    ) {
      topologyMask[index] = 1;
    }
  }
  return {
    ...evidence,
    status: "computed",
    admissionExcludedTopologyMask: topologyMask,
    observableEvidenceAdmission: {
      version:
        FIXED_RIG_OBSERVABLE_LOCALIZED_EVIDENCE_ADMISSION_V1_VERSION,
      validPixelFraction: evidence.coverage.validPixelFraction,
      invalidPixelFraction: evidence.coverage.invalidPixelFraction,
      localizedUngradableRegionCount: evidence.ungradableRegions.length,
      localizedUngradablePixelCount,
      localizedPixelsRemainExcludedFromScoring: true,
      scoreConfidenceMustUseValidCoverage: true,
    },
    evidenceLimitations: evidence.evidenceLimitations.map((limitation) => ({
      ...limitation,
      requiresRecapture: false,
      message:
        limitation.message +
        " Invalid pixels remain excluded; observable measurements proceed with private reduced confidence/U95.",
    })),
  };
}
