import * as sharedContracts from "@tenkings/shared";

export const FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION =
  "fixed_rig_photometric_evidence_v1" as const;

/**
 * A row-major scalar plane. Photometric V1 deliberately accepts already-decoded
 * numeric planes so image decoding remains an evidence-ingestion concern. The
 * heatmap/report renderer is not accepted as an input here.
 */
export interface FixedRigScalarPlaneV1 {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface FixedRigPhotometricChannelInputV1 {
  channel: number;
  image: FixedRigScalarPlaneV1;
  /** Per-pixel 0..1 acquisition/calibration confidence. */
  confidence?: FixedRigScalarPlaneV1;
  /** Used only when a per-pixel confidence plane is unavailable. */
  channelConfidence?: number;
  sourceEvidenceId: string;
  sourceSha256: string;
}

export interface FixedRigFlatFieldChannelCalibrationV1 {
  channel: number;
  /**
   * Relative response to a certified uniform target. A value of 1 is nominal;
   * measured signal is divided by this response pixel by pixel.
   */
  relativeResponse: FixedRigScalarPlaneV1;
  /** Optional registered per-pixel sensor/dark offset in raw digital units. */
  darkOffset?: FixedRigScalarPlaneV1;
  sourceEvidenceId: string;
  sourceSha256: string;
}

export interface FixedRigIlluminationPatternChannelCalibrationV1 {
  channel: number;
  /**
   * Expected zero-mean channel-selective residual in normalized sensor units.
   * This is learned from the designated calibration target and normalized-card
   * coordinates; it is never inferred from the card being graded.
   */
  expectedDirectionalResidual: FixedRigScalarPlaneV1;
  sourceEvidenceId: string;
  sourceSha256: string;
}

export interface FixedRigPhotometricCalibrationProfileV1 {
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  coordinateFrame: "normalized_card_portrait_pixels";
  width: number;
  height: number;
  sensorMaximumValue: number;
  isFinalized: boolean;
  isCalibrated: boolean;
  flatFieldChannels: FixedRigFlatFieldChannelCalibrationV1[];
  illuminationPatternChannels?: FixedRigIlluminationPatternChannelCalibrationV1[];
  sourceEvidenceIds: string[];
}

export interface FixedRigSurfaceEvidenceThresholdsV1 {
  minValidPixelCoverage: number;
  minValidDirectionalObservations: number;
  minCorroboratingChannels: number;
  commonModeChannelFraction: number;
  glareSuppressionOverlapFraction: number;
  maxClippedPixelFraction: number;
  minLightingChannelConfidence: number;
  alternateChannelRecoveryMinCoverage: number;
  fullyObscuredCoverageThreshold: number;
  saturationNormalizedThreshold: number;
  underexposureNormalizedThreshold: number;
  commonModeSpecularMinResponse: number;
  commonModeMaxRelativeSpread: number;
  commonModeLowerQuantile: number;
  commonModeUpperQuantile: number;
  calibratedPatternMinCosineSimilarity: number;
  calibratedPatternMaxRelativeResidual: number;
  directionalResidualThreshold: number;
  corroboratingPixelFraction: number;
  minConnectedComponentPixels: number;
  minimumUngradableRegionPixels: number;
}

export interface FixedRigCorrectedPhotometricChannelV1 {
  channel: number;
  sourceEvidenceId: string;
  sourceSha256: string;
  flatFieldSourceEvidenceId: string;
  flatFieldSourceSha256: string;
  /** Dark-subtracted, flat-field-corrected response normalized by sensor max. */
  correctedResponse: Float32Array;
  /** Common-mode and calibrated fixture-pattern response removed. */
  directionalResidual: Float32Array;
  /** One only where this channel can support a physical finding. */
  validDirectionalObservationMask: Uint8Array;
  saturationMask: Uint8Array;
  underexposureMask: Uint8Array;
  lowConfidenceMask: Uint8Array;
}

export type FixedRigPhotometricEvidenceStatusV1 =
  | "computed"
  | "insufficient_evidence";

export interface FixedRigPhotometricEvidenceV1 {
  version: typeof FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION;
  status: FixedRigPhotometricEvidenceStatusV1;
  coordinateFrame: "normalized_card_portrait_pixels";
  width: number;
  height: number;
  channelCount: number;
  calibration: {
    profileId: string;
    version: string;
    sha256: string;
    sourceEvidenceIds: string[];
    finalizedAndCalibrated: true;
  };
  thresholdSetVersion: string;
  thresholdSetId: string;
  thresholdSetHash: string;
  flatFieldCorrectionApplied: true;
  channels: FixedRigCorrectedPhotometricChannelV1[];
  /** Median registered response across usable channels before residual removal. */
  commonModeResponse: Float32Array;
  /** Best-fit scale of the calibrated channel-selective illumination vector. */
  calibratedPatternScale: Float32Array;
  /** Cosine similarity to the calibrated channel-selective illumination vector. */
  calibratedPatternSimilarity: Float32Array;
  usableDirectionalObservationCount: Uint8Array;
  clippingMask: Uint8Array;
  commonModeSpecularMask: Uint8Array;
  calibratedIlluminationPatternMask: Uint8Array;
  specularOrIlluminationMask: Uint8Array;
  lowConfidenceMask: Uint8Array;
  insufficientDirectionalObservationsMask: Uint8Array;
  invalidIlluminationMask: Uint8Array;
  gradeRelevantMask: Uint8Array;
  gradeRelevantMaskSourceEvidenceId: string;
  gradeRelevantMaskSourceSha256: string;
  ungradableRegions: Array<{
    regionId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    pixelCount: number;
    affectedGradeRelevantPixelFraction: number;
    requiresRecapture: true;
  }>;
  coverage: {
    framePixelCount: number;
    gradeRelevantPixelCount: number;
    validPixelCount: number;
    totalPixelCount: number;
    validPixelFraction: number;
    clippedPixelFraction: number;
    commonModeSpecularPixelFraction: number;
    calibratedPatternPixelFraction: number;
    invalidPixelFraction: number;
  };
  evidenceLimitations: Array<{
    code:
      | "excessive_clipping"
      | "insufficient_valid_coverage"
      | "fully_obscured"
      | "low_lighting_confidence"
      | "calibrated_illumination_pattern"
      | "localized_ungradable_region";
    affectedPixelFraction: number;
    requiresRecapture: boolean;
    message: string;
  }>;
}

export interface BuildFixedRigPhotometricEvidenceV1Input {
  channels: FixedRigPhotometricChannelInputV1[];
  calibration: FixedRigPhotometricCalibrationProfileV1;
  /**
   * Optional registered dark control. When supplied, it is subtracted in
   * addition to any channel-specific calibrated dark offset.
   */
  darkControl: FixedRigScalarPlaneV1;
  gradeRelevantMask: FixedRigScalarPlaneV1;
  gradeRelevantMaskSourceEvidenceId: string;
  gradeRelevantMaskSourceSha256: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function fraction(count: number, total: number): number {
  return total > 0 ? round(count / total) : 0;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function assertFiniteFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite fraction in 0..1.`);
  }
}

function assertPlane(
  label: string,
  plane: FixedRigScalarPlaneV1,
  width: number,
  height: number,
): void {
  if (
    !Number.isInteger(plane.width) ||
    !Number.isInteger(plane.height) ||
    plane.width !== width ||
    plane.height !== height ||
    plane.data.length !== width * height
  ) {
    throw new Error(`${label} must exactly match the calibrated ${width}x${height} coordinate frame.`);
  }
}

function centralSurfaceEvidenceThresholds(): FixedRigSurfaceEvidenceThresholdsV1 {
  const manifest = (sharedContracts as unknown as {
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST?: unknown;
  }).MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST as {
    surfaceEvidence?: Partial<FixedRigSurfaceEvidenceThresholdsV1>;
    version?: string;
  } | undefined;
  if (!manifest) {
    throw new Error("@tenkings/shared is missing MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.");
  }
  const thresholds = manifest.surfaceEvidence;
  if (!thresholds) {
    throw new Error("Mathematical Grading V1 threshold manifest is missing surfaceEvidence.");
  }
  const required: Array<keyof FixedRigSurfaceEvidenceThresholdsV1> = [
    "minValidPixelCoverage",
    "minValidDirectionalObservations",
    "minCorroboratingChannels",
    "commonModeChannelFraction",
    "glareSuppressionOverlapFraction",
    "maxClippedPixelFraction",
    "minLightingChannelConfidence",
    "alternateChannelRecoveryMinCoverage",
    "fullyObscuredCoverageThreshold",
    "saturationNormalizedThreshold",
    "underexposureNormalizedThreshold",
    "commonModeSpecularMinResponse",
    "commonModeMaxRelativeSpread",
    "commonModeLowerQuantile",
    "commonModeUpperQuantile",
    "calibratedPatternMinCosineSimilarity",
    "calibratedPatternMaxRelativeResidual",
    "directionalResidualThreshold",
    "corroboratingPixelFraction",
    "minConnectedComponentPixels",
    "minimumUngradableRegionPixels",
  ];
  for (const key of required) {
    if (!Number.isFinite(thresholds[key])) {
      throw new Error(`Mathematical Grading V1 surfaceEvidence.${key} is required.`);
    }
  }
  return thresholds as FixedRigSurfaceEvidenceThresholdsV1;
}

export function resolveFixedRigSurfaceEvidenceThresholdsV1(
): FixedRigSurfaceEvidenceThresholdsV1 {
  const thresholds = centralSurfaceEvidenceThresholds();
  const fractionKeys: Array<keyof FixedRigSurfaceEvidenceThresholdsV1> = [
    "minValidPixelCoverage",
    "commonModeChannelFraction",
    "glareSuppressionOverlapFraction",
    "maxClippedPixelFraction",
    "minLightingChannelConfidence",
    "alternateChannelRecoveryMinCoverage",
    "fullyObscuredCoverageThreshold",
    "saturationNormalizedThreshold",
    "underexposureNormalizedThreshold",
    "commonModeSpecularMinResponse",
    "commonModeMaxRelativeSpread",
    "commonModeLowerQuantile",
    "commonModeUpperQuantile",
    "calibratedPatternMinCosineSimilarity",
    "calibratedPatternMaxRelativeResidual",
    "directionalResidualThreshold",
    "corroboratingPixelFraction",
  ];
  for (const key of fractionKeys) assertFiniteFraction(`surfaceEvidence.${key}`, thresholds[key]);
  if (thresholds.commonModeLowerQuantile >= thresholds.commonModeUpperQuantile) {
    throw new Error(
      "surfaceEvidence common-mode quantiles must be strictly increasing.",
    );
  }
  for (const key of [
    "minValidDirectionalObservations",
    "minCorroboratingChannels",
    "minConnectedComponentPixels",
    "minimumUngradableRegionPixels",
  ] as const) {
    if (!Number.isInteger(thresholds[key]) || thresholds[key] < 1) {
      throw new Error(`surfaceEvidence.${key} must be a positive integer.`);
    }
  }
  return thresholds;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function quantile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return (sorted[lower] ?? 0) * (1 - mix) + (sorted[upper] ?? 0) * mix;
}

function ungradableRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  minimumPixels: number,
  gradeRelevantPixelCount: number,
): FixedRigPhotometricEvidenceV1["ungradableRegions"] {
  const visited = new Uint8Array(mask.length);
  const regions: FixedRigPhotometricEvidenceV1["ungradableRegions"] = [];
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (cursor < queue.length) {
      const index = queue[cursor++] as number;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (queue.length < minimumPixels) continue;
    regions.push({
      regionId: `ungradable-${regions.length + 1}`,
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixelCount: queue.length,
      affectedGradeRelevantPixelFraction: fraction(
        queue.length,
        gradeRelevantPixelCount,
      ),
      requiresRecapture: true,
    });
  }
  return regions;
}

function thresholdSetIdentity(): { version: string; id: string; hash: string } {
  const manifest = (sharedContracts as unknown as {
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST?: unknown;
  }).MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST as {
    version?: string;
    thresholdSetVersion?: string;
    manifestVersion?: string;
    thresholdSetId?: string;
    sourceHash?: string;
  } | undefined;
  if (!manifest) {
    return { version: "mathematical_grading_v1", id: "mathematical_grading_v1", hash: "unavailable" };
  }
  const id = manifest.thresholdSetId ?? "mathematical_grading_v1";
  return {
    version: manifest.version ?? manifest.thresholdSetVersion ?? manifest.manifestVersion ?? id,
    id,
    hash: manifest.sourceHash ?? "unavailable",
  };
}

function validateBuildInput(
  input: BuildFixedRigPhotometricEvidenceV1Input,
  thresholds: FixedRigSurfaceEvidenceThresholdsV1,
): void {
  const { calibration } = input;
  if (!calibration.isFinalized || !calibration.isCalibrated) {
    throw new Error("Photometric V1 requires a finalized calibrated profile; no uncalibrated fallback is permitted.");
  }
  if (
    calibration.coordinateFrame !== "normalized_card_portrait_pixels" ||
    !Number.isInteger(calibration.width) ||
    !Number.isInteger(calibration.height) ||
    calibration.width < 1 ||
    calibration.height < 1
  ) {
    throw new Error("Photometric V1 requires a non-empty normalized-card calibration coordinate frame.");
  }
  if (!Number.isFinite(calibration.sensorMaximumValue) || calibration.sensorMaximumValue <= 0) {
    throw new Error("Photometric calibration sensorMaximumValue must be positive.");
  }
  if (!isSha256(calibration.calibrationSha256)) {
    throw new Error("Photometric calibration must carry its immutable SHA-256.");
  }
  assertPlane(
    "Grade-relevant outer-card mask",
    input.gradeRelevantMask,
    calibration.width,
    calibration.height,
  );
  if (
    Array.from(input.gradeRelevantMask.data).some(
      (value) => Number(value) !== 0 && Number(value) !== 1,
    )
  ) {
    throw new Error("Grade-relevant outer-card mask must be exact binary evidence.");
  }
  if (
    !input.gradeRelevantMaskSourceEvidenceId ||
    !isSha256(input.gradeRelevantMaskSourceSha256)
  ) {
    throw new Error(
      "Grade-relevant outer-card mask requires immutable evidence identity and SHA-256.",
    );
  }
  if (input.channels.length < thresholds.minValidDirectionalObservations) {
    throw new Error("Photometric V1 has fewer channels than the minimum directional-observation policy.");
  }
  const channelIds = input.channels.map((entry) => entry.channel);
  if (new Set(channelIds).size !== channelIds.length || channelIds.some((channel) => !Number.isInteger(channel) || channel < 1)) {
    throw new Error("Photometric channels must have unique positive integer identities.");
  }
  const flatByChannel = new Map(calibration.flatFieldChannels.map((entry) => [entry.channel, entry]));
  const patternByChannel = new Map(
    (calibration.illuminationPatternChannels ?? []).map((entry) => [entry.channel, entry]),
  );
  if (flatByChannel.size !== input.channels.length) {
    throw new Error("Every photometric channel requires one unique flat-field calibration.");
  }
  for (const channel of input.channels) {
    assertPlane(`Channel ${channel.channel} image`, channel.image, calibration.width, calibration.height);
    if (channel.confidence) {
      assertPlane(`Channel ${channel.channel} confidence`, channel.confidence, calibration.width, calibration.height);
    }
    if (!channel.confidence && channel.channelConfidence === undefined) {
      throw new Error(
        `Channel ${channel.channel} requires measured per-pixel or channel confidence.`,
      );
    }
    if (channel.channelConfidence !== undefined) {
      assertFiniteFraction(
        `Channel ${channel.channel} confidence`,
        channel.channelConfidence,
      );
    }
    if (!isSha256(channel.sourceSha256)) {
      throw new Error(`Channel ${channel.channel} source SHA-256 is invalid.`);
    }
    const flat = flatByChannel.get(channel.channel);
    if (!flat) throw new Error(`Channel ${channel.channel} is missing flat-field calibration.`);
    assertPlane(`Channel ${channel.channel} flat field`, flat.relativeResponse, calibration.width, calibration.height);
    if (flat.darkOffset) {
      assertPlane(`Channel ${channel.channel} dark offset`, flat.darkOffset, calibration.width, calibration.height);
    }
    if (!isSha256(flat.sourceSha256)) {
      throw new Error(`Channel ${channel.channel} flat-field SHA-256 is invalid.`);
    }
    const pattern = patternByChannel.get(channel.channel);
    if (pattern) {
      assertPlane(
        `Channel ${channel.channel} illumination pattern`,
        pattern.expectedDirectionalResidual,
        calibration.width,
        calibration.height,
      );
      if (!isSha256(pattern.sourceSha256)) {
        throw new Error(`Channel ${channel.channel} illumination-pattern SHA-256 is invalid.`);
      }
    }
  }
  assertPlane("Registered dark control", input.darkControl, calibration.width, calibration.height);
}

/**
 * Builds deterministic, grade-eligible directional evidence. Capture-quality
 * masks are retained as limitations only; this function never creates a card
 * defect or condition deduction.
 */
export function buildFixedRigPhotometricEvidenceV1(
  input: BuildFixedRigPhotometricEvidenceV1Input,
): FixedRigPhotometricEvidenceV1 {
  const thresholds = resolveFixedRigSurfaceEvidenceThresholdsV1();
  validateBuildInput(input, thresholds);

  const orderedInputs = [...input.channels].sort((left, right) => left.channel - right.channel);
  const { calibration } = input;
  const pixelCount = calibration.width * calibration.height;
  const flatByChannel = new Map(calibration.flatFieldChannels.map((entry) => [entry.channel, entry]));
  const patternByChannel = new Map(
    (calibration.illuminationPatternChannels ?? []).map((entry) => [entry.channel, entry]),
  );

  const correctedChannels: FixedRigCorrectedPhotometricChannelV1[] = orderedInputs.map((channel) => {
    const flat = flatByChannel.get(channel.channel) as FixedRigFlatFieldChannelCalibrationV1;
    return {
      channel: channel.channel,
      sourceEvidenceId: channel.sourceEvidenceId,
      sourceSha256: channel.sourceSha256.toLowerCase(),
      flatFieldSourceEvidenceId: flat.sourceEvidenceId,
      flatFieldSourceSha256: flat.sourceSha256.toLowerCase(),
      correctedResponse: new Float32Array(pixelCount),
      directionalResidual: new Float32Array(pixelCount),
      validDirectionalObservationMask: new Uint8Array(pixelCount),
      saturationMask: new Uint8Array(pixelCount),
      underexposureMask: new Uint8Array(pixelCount),
      lowConfidenceMask: new Uint8Array(pixelCount),
    };
  });

  const commonModeResponse = new Float32Array(pixelCount);
  const calibratedPatternScale = new Float32Array(pixelCount);
  const calibratedPatternSimilarity = new Float32Array(pixelCount);
  const usableDirectionalObservationCount = new Uint8Array(pixelCount);
  const clippingMask = new Uint8Array(pixelCount);
  const commonModeSpecularMask = new Uint8Array(pixelCount);
  const calibratedIlluminationPatternMask = new Uint8Array(pixelCount);
  const specularOrIlluminationMask = new Uint8Array(pixelCount);
  const lowConfidenceMask = new Uint8Array(pixelCount);
  const insufficientDirectionalObservationsMask = new Uint8Array(pixelCount);
  const invalidIlluminationMask = new Uint8Array(pixelCount);
  const gradeRelevantMask = new Uint8Array(
    Array.from(input.gradeRelevantMask.data, (value) => Number(value)),
  );

  for (let index = 0; index < pixelCount; index += 1) {
    if (!gradeRelevantMask[index]) {
      invalidIlluminationMask[index] = 1;
      continue;
    }
    const responses: number[] = [];
    const initialValidity: boolean[] = [];
    let saturatedChannels = 0;
    let lowConfidenceChannels = 0;

    for (let channelIndex = 0; channelIndex < orderedInputs.length; channelIndex += 1) {
      const inputChannel = orderedInputs[channelIndex] as FixedRigPhotometricChannelInputV1;
      const outputChannel = correctedChannels[channelIndex] as FixedRigCorrectedPhotometricChannelV1;
      const flat = flatByChannel.get(inputChannel.channel) as FixedRigFlatFieldChannelCalibrationV1;
      const rawValue = Number(inputChannel.image.data[index]);
      const registeredDark = Number(input.darkControl.data[index]);
      const calibratedDark = Number(flat.darkOffset?.data[index] ?? 0);
      const flatResponse = Number(flat.relativeResponse.data[index]);
      const confidence = Number(
        inputChannel.confidence?.data[index] ??
        inputChannel.channelConfidence,
      );
      if (
        !Number.isFinite(rawValue) ||
        !Number.isFinite(registeredDark) ||
        !Number.isFinite(calibratedDark) ||
        !Number.isFinite(flatResponse) ||
        flatResponse <= 0 ||
        !Number.isFinite(confidence)
      ) {
        outputChannel.lowConfidenceMask[index] = 1;
        responses.push(0);
        initialValidity.push(false);
        lowConfidenceChannels += 1;
        continue;
      }
      const rawNormalized = rawValue / calibration.sensorMaximumValue;
      const signal = Math.max(0, rawValue - registeredDark - calibratedDark);
      const corrected = signal / flatResponse / calibration.sensorMaximumValue;
      outputChannel.correctedResponse[index] = corrected;
      responses.push(corrected);

      const saturated = rawNormalized >= thresholds.saturationNormalizedThreshold;
      const underexposed = corrected <= thresholds.underexposureNormalizedThreshold;
      const lowConfidence = confidence < thresholds.minLightingChannelConfidence;
      if (saturated) {
        outputChannel.saturationMask[index] = 1;
        saturatedChannels += 1;
      }
      if (underexposed) outputChannel.underexposureMask[index] = 1;
      if (lowConfidence) {
        outputChannel.lowConfidenceMask[index] = 1;
        lowConfidenceChannels += 1;
      }
      initialValidity.push(!saturated && !underexposed && !lowConfidence);
    }

    const initiallyUsable = responses.filter((_, channelIndex) => initialValidity[channelIndex]);
    const commonMode = median(initiallyUsable);
    commonModeResponse[index] = commonMode;
    if (saturatedChannels > 0) clippingMask[index] = 1;
    if (lowConfidenceChannels > orderedInputs.length - thresholds.minValidDirectionalObservations) {
      lowConfidenceMask[index] = 1;
    }

    const brightChannelCount = responses.filter(
      (response, channelIndex) => initialValidity[channelIndex] && response >= thresholds.commonModeSpecularMinResponse,
    ).length;
    const responseSpread = initiallyUsable.length
      ? (
        quantile(initiallyUsable, thresholds.commonModeUpperQuantile) -
        quantile(initiallyUsable, thresholds.commonModeLowerQuantile)
      ) / Math.max(commonMode, Number.EPSILON)
      : Number.POSITIVE_INFINITY;
    const commonModeSpecular =
      brightChannelCount / orderedInputs.length >= thresholds.commonModeChannelFraction &&
      responseSpread <= thresholds.commonModeMaxRelativeSpread;
    if (commonModeSpecular) commonModeSpecularMask[index] = 1;

    // The common-mode baseline is computed only from usable observations.
    // Reusing a median that includes clipped/underexposed channels would let
    // evidence-quality failures leak back into the directional residual.
    const observedCentered = responses.map((response) => response - commonMode);
    const expected = orderedInputs.map((channel) =>
      Number(patternByChannel.get(channel.channel)?.expectedDirectionalResidual.data[index] ?? 0),
    );
    let observedNormSquared = 0;
    let expectedNormSquared = 0;
    let dot = 0;
    for (let channelIndex = 0; channelIndex < responses.length; channelIndex += 1) {
      const observedValue = observedCentered[channelIndex] ?? 0;
      const expectedValue = expected[channelIndex] ?? 0;
      observedNormSquared += observedValue * observedValue;
      expectedNormSquared += expectedValue * expectedValue;
      dot += observedValue * expectedValue;
    }
    const observedNorm = Math.sqrt(observedNormSquared);
    const expectedNorm = Math.sqrt(expectedNormSquared);
    const cosine = observedNorm > Number.EPSILON && expectedNorm > Number.EPSILON
      ? dot / (observedNorm * expectedNorm)
      : 0;
    const scale = expectedNormSquared > Number.EPSILON ? Math.max(0, dot / expectedNormSquared) : 0;
    let residualNormSquared = 0;
    for (let channelIndex = 0; channelIndex < responses.length; channelIndex += 1) {
      const difference = (observedCentered[channelIndex] ?? 0) - scale * (expected[channelIndex] ?? 0);
      residualNormSquared += difference * difference;
    }
    const relativePatternResidual = observedNorm > Number.EPSILON
      ? Math.sqrt(residualNormSquared) / observedNorm
      : 1;
    calibratedPatternScale[index] = scale;
    calibratedPatternSimilarity[index] = cosine;
    const calibratedPatternExplainsPixel =
      expectedNorm / Math.sqrt(Math.max(1, expected.length)) >= thresholds.directionalResidualThreshold &&
      cosine >= thresholds.calibratedPatternMinCosineSimilarity &&
      relativePatternResidual <= thresholds.calibratedPatternMaxRelativeResidual;
    if (calibratedPatternExplainsPixel) calibratedIlluminationPatternMask[index] = 1;

    let usable = 0;
    for (let channelIndex = 0; channelIndex < responses.length; channelIndex += 1) {
      const outputChannel = correctedChannels[channelIndex] as FixedRigCorrectedPhotometricChannelV1;
      const residual = (observedCentered[channelIndex] ?? 0) - scale * (expected[channelIndex] ?? 0);
      outputChannel.directionalResidual[index] = residual;
      const channelExplainedByCalibratedPattern =
        calibratedPatternExplainsPixel &&
        Math.abs(scale * (expected[channelIndex] ?? 0)) >= thresholds.directionalResidualThreshold;
      const valid =
        initialValidity[channelIndex] &&
        !commonModeSpecular &&
        !channelExplainedByCalibratedPattern;
      if (valid) {
        outputChannel.validDirectionalObservationMask[index] = 1;
        usable += 1;
      }
    }
    usableDirectionalObservationCount[index] = usable;
    if (commonModeSpecular || calibratedPatternExplainsPixel) specularOrIlluminationMask[index] = 1;
    if (usable < thresholds.minValidDirectionalObservations) {
      insufficientDirectionalObservationsMask[index] = 1;
      invalidIlluminationMask[index] = 1;
    }
  }

  let validPixelCount = 0;
  let clippedPixelCount = 0;
  let commonModeSpecularPixelCount = 0;
  let calibratedPatternPixelCount = 0;
  let lowConfidencePixelCount = 0;
  let gradeRelevantPixelCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (!gradeRelevantMask[index]) continue;
    gradeRelevantPixelCount += 1;
    if (!invalidIlluminationMask[index]) validPixelCount += 1;
    if (clippingMask[index]) clippedPixelCount += 1;
    if (commonModeSpecularMask[index]) commonModeSpecularPixelCount += 1;
    if (calibratedIlluminationPatternMask[index]) calibratedPatternPixelCount += 1;
    if (lowConfidenceMask[index]) lowConfidencePixelCount += 1;
  }
  if (gradeRelevantPixelCount === 0) {
    throw new Error("Grade-relevant outer-card mask contains no card pixels.");
  }
  const validPixelFraction = fraction(validPixelCount, gradeRelevantPixelCount);
  const clippedPixelFraction = fraction(clippedPixelCount, gradeRelevantPixelCount);
  const invalidPixelFraction = fraction(
    gradeRelevantPixelCount - validPixelCount,
    gradeRelevantPixelCount,
  );
  const commonModeSpecularPixelFraction = fraction(
    commonModeSpecularPixelCount,
    gradeRelevantPixelCount,
  );
  const calibratedPatternPixelFraction = fraction(
    calibratedPatternPixelCount,
    gradeRelevantPixelCount,
  );
  const lowConfidencePixelFraction = fraction(
    lowConfidencePixelCount,
    gradeRelevantPixelCount,
  );
  const localizedUngradableMask = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    localizedUngradableMask[index] =
      gradeRelevantMask[index] && insufficientDirectionalObservationsMask[index]
        ? 1
        : 0;
  }
  const localizedUngradableRegions = ungradableRegions(
    localizedUngradableMask,
    calibration.width,
    calibration.height,
    thresholds.minimumUngradableRegionPixels,
    gradeRelevantPixelCount,
  );
  const evidenceLimitations: FixedRigPhotometricEvidenceV1["evidenceLimitations"] = [];
  if (clippedPixelFraction > thresholds.maxClippedPixelFraction) {
    evidenceLimitations.push({
      code: "excessive_clipping",
      affectedPixelFraction: clippedPixelFraction,
      requiresRecapture: validPixelFraction < thresholds.minValidPixelCoverage,
      message: "Clipped pixels were excluded from condition evidence; clipping never becomes card damage.",
    });
  }
  if (lowConfidencePixelFraction > 0) {
    evidenceLimitations.push({
      code: "low_lighting_confidence",
      affectedPixelFraction: lowConfidencePixelFraction,
      requiresRecapture: validPixelFraction < thresholds.minValidPixelCoverage,
      message: "Low-confidence lighting observations were excluded and did not affect condition score.",
    });
  }
  if (calibratedPatternPixelFraction > 0) {
    evidenceLimitations.push({
      code: "calibrated_illumination_pattern",
      affectedPixelFraction: calibratedPatternPixelFraction,
      requiresRecapture: validPixelFraction < thresholds.minValidPixelCoverage,
      message: "A calibrated channel-selective illumination signature was classified as lighting evidence, not damage.",
    });
  }
  if (validPixelFraction < thresholds.minValidPixelCoverage) {
    evidenceLimitations.push({
      code: "insufficient_valid_coverage",
      affectedPixelFraction: invalidPixelFraction,
      requiresRecapture: true,
      message: "Too little valid directional evidence remains for a calibrated surface condition score.",
    });
  }
  if (validPixelFraction <= thresholds.fullyObscuredCoverageThreshold) {
    evidenceLimitations.push({
      code: "fully_obscured",
      affectedPixelFraction: invalidPixelFraction,
      requiresRecapture: true,
      message: "The usable channels do not resolve this surface; it is ungradable, not defect-free.",
    });
  }
  for (const region of localizedUngradableRegions) {
    evidenceLimitations.push({
      code: "localized_ungradable_region",
      affectedPixelFraction: region.affectedGradeRelevantPixelFraction,
      requiresRecapture: true,
      message:
        `Region ${region.regionId} has no manifest-sufficient usable directional evidence; it is ungradable, not defect-free.`,
    });
  }

  const thresholdIdentity = thresholdSetIdentity();
  return {
    version: FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION,
    status:
      validPixelFraction >= thresholds.minValidPixelCoverage &&
      validPixelFraction > thresholds.fullyObscuredCoverageThreshold &&
      localizedUngradableRegions.length === 0
        ? "computed"
        : "insufficient_evidence",
    coordinateFrame: "normalized_card_portrait_pixels",
    width: calibration.width,
    height: calibration.height,
    channelCount: orderedInputs.length,
    calibration: {
      profileId: calibration.calibrationProfileId,
      version: calibration.calibrationVersion,
      sha256: calibration.calibrationSha256.toLowerCase(),
      sourceEvidenceIds: [...calibration.sourceEvidenceIds],
      finalizedAndCalibrated: true,
    },
    thresholdSetVersion: thresholdIdentity.version,
    thresholdSetId: thresholdIdentity.id,
    thresholdSetHash: thresholdIdentity.hash,
    flatFieldCorrectionApplied: true,
    channels: correctedChannels,
    commonModeResponse,
    calibratedPatternScale,
    calibratedPatternSimilarity,
    usableDirectionalObservationCount,
    clippingMask,
    commonModeSpecularMask,
    calibratedIlluminationPatternMask,
    specularOrIlluminationMask,
    lowConfidenceMask,
    insufficientDirectionalObservationsMask,
    invalidIlluminationMask,
    gradeRelevantMask,
    gradeRelevantMaskSourceEvidenceId:
      input.gradeRelevantMaskSourceEvidenceId,
    gradeRelevantMaskSourceSha256:
      input.gradeRelevantMaskSourceSha256.toLowerCase(),
    ungradableRegions: localizedUngradableRegions,
    coverage: {
      validPixelCount,
      totalPixelCount: gradeRelevantPixelCount,
      framePixelCount: pixelCount,
      gradeRelevantPixelCount,
      validPixelFraction,
      clippedPixelFraction,
      commonModeSpecularPixelFraction,
      calibratedPatternPixelFraction,
      invalidPixelFraction,
    },
    evidenceLimitations,
  };
}
