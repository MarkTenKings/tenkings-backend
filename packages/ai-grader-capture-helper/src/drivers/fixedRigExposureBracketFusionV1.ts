import type {
  FixedRigFlatFieldChannelCalibrationV1,
  FixedRigPhotometricChannelInputV1,
  FixedRigScalarPlaneV1,
} from "./fixedRigPhotometricEvidenceV1";

export const FIXED_RIG_EXPOSURE_BRACKET_FUSION_V1_VERSION =
  "fixed_rig_exposure_bracket_fusion_v1" as const;

export const FIXED_RIG_EXPOSURE_BRACKET_V1_EXPOSURES_US =
  [15_000, 30_000, 37_500] as const;
export const FIXED_RIG_EXPOSURE_BRACKET_V1_ISOLATED_DUTY_TENTHS_PERCENT = 24;
export const FIXED_RIG_EXPOSURE_BRACKET_V1_SETTLE_MS = 0;
export const FIXED_RIG_EXPOSURE_BRACKET_V1_REFERENCE_COUNT = 3;
export const FIXED_RIG_EXPOSURE_BRACKET_V1_TARGET_EXPOSURE_US = 45_000;

export interface FixedRigExposureBracketPlaneV1 {
  exposureUs: number;
  plane: FixedRigScalarPlaneV1;
  sourceEvidenceId: string;
  sourceSha256: string;
}

export interface FixedRigExposureBracketChannelV1 {
  channel: number;
  channelConfidence: number;
  observations: FixedRigExposureBracketPlaneV1[];
}

export interface BuildFixedRigExposureBracketFusionV1Input {
  width: number;
  height: number;
  sensorMaximumValue: number;
  gradeRelevantMask: FixedRigScalarPlaneV1;
  references: FixedRigExposureBracketPlaneV1[];
  channels: FixedRigExposureBracketChannelV1[];
  flatFieldChannels: FixedRigFlatFieldChannelCalibrationV1[];
}

export interface FixedRigExposureBracketFusionV1 {
  version: typeof FIXED_RIG_EXPOSURE_BRACKET_FUSION_V1_VERSION;
  exposuresUs: number[];
  isolatedDutyTenthsPercent: 24;
  settleMs: 0;
  targetExposureUs: 45_000;
  channels: FixedRigPhotometricChannelInputV1[];
  darkNoiseByExposure: Array<{
    exposureUs: number;
    n95RawDu: number;
    adaptiveNoiseGuardRawDu: number;
    referenceEvidenceIds: string[];
    referenceSha256s: string[];
  }>;
  selectedFusedClippingMask: Uint8Array;
  adaptiveRawGuardFailureMask: Uint8Array;
  normalizedFloorFailureMask: Uint8Array;
}

function assertPlane(
  plane: FixedRigScalarPlaneV1,
  width: number,
  height: number,
  label: string,
): void {
  if (
    plane.width !== width ||
    plane.height !== height ||
    plane.data.length !== width * height
  ) {
    throw new Error(`${label} does not match the normalized-card frame.`);
  }
}

function exactExposureSet(values: readonly number[], label: string): void {
  const expected = FIXED_RIG_EXPOSURE_BRACKET_V1_EXPOSURES_US;
  const ordered = [...values].sort((left, right) => left - right);
  if (
    ordered.length !== expected.length ||
    ordered.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label} must contain exact exposures ${expected.join(",")} us once each.`,
    );
  }
}

function quantile95(values: Float32Array): number {
  values.sort();
  const position = 0.95 * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return Number(values[lower]) * (1 - mix) + Number(values[upper]) * mix;
}

function sha256(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} requires an exact SHA-256.`);
  }
  return normalized;
}

/**
 * Reproduces the authenticated ambient-blocked tau1 oracle. Selection is made
 * in raw detector units before flat-field/exposure normalization.
 */
export function buildFixedRigExposureBracketFusionV1(
  input: BuildFixedRigExposureBracketFusionV1Input,
): FixedRigExposureBracketFusionV1 {
  const pixelCount = input.width * input.height;
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.sensorMaximumValue !== 255
  ) {
    throw new Error("Exposure-bracket V1 requires a non-empty Mono8 normalized-card frame.");
  }
  assertPlane(input.gradeRelevantMask, input.width, input.height, "Expected-card mask");
  if (
    Array.from(input.gradeRelevantMask.data).some(
      (value) => Number(value) !== 0 && Number(value) !== 1,
    )
  ) {
    throw new Error("Exposure-bracket V1 expected-card mask must be exact binary evidence.");
  }
  if (input.channels.length !== 8) {
    throw new Error("Exposure-bracket V1 requires directional channels 1 through 8.");
  }
  const channelIndexes = input.channels.map((entry) => entry.channel).sort((a, b) => a - b);
  if (channelIndexes.some((channel, index) => channel !== index + 1)) {
    throw new Error("Exposure-bracket V1 requires directional channels 1 through 8 exactly once.");
  }
  const referencesByExposure = new Map<number, FixedRigExposureBracketPlaneV1[]>();
  for (const reference of input.references) {
    assertPlane(reference.plane, input.width, input.height, "Bracket reference");
    sha256(reference.sourceSha256, "Bracket reference");
    const entries = referencesByExposure.get(reference.exposureUs) ?? [];
    entries.push(reference);
    referencesByExposure.set(reference.exposureUs, entries);
  }
  exactExposureSet([...referencesByExposure.keys()], "Bracket references");
  for (const exposureUs of FIXED_RIG_EXPOSURE_BRACKET_V1_EXPOSURES_US) {
    if (
      referencesByExposure.get(exposureUs)?.length !==
      FIXED_RIG_EXPOSURE_BRACKET_V1_REFERENCE_COUNT
    ) {
      throw new Error(`Exposure ${exposureUs} us requires exactly three fresh references.`);
    }
  }
  const flatByChannel = new Map(
    input.flatFieldChannels.map((entry) => [entry.channel, entry]),
  );
  if (flatByChannel.size !== 8) {
    throw new Error("Exposure-bracket V1 requires one calibrated flat field per channel.");
  }
  const darkMeanByExposure = new Map<number, Float32Array>();
  const noiseByExposure = new Map<number, number>();
  const darkNoiseByExposure: FixedRigExposureBracketFusionV1["darkNoiseByExposure"] = [];
  for (const exposureUs of FIXED_RIG_EXPOSURE_BRACKET_V1_EXPOSURES_US) {
    const references = referencesByExposure.get(exposureUs)!;
    const mean = new Float32Array(pixelCount);
    const pairwise = new Float32Array(pixelCount * 3);
    for (let index = 0; index < pixelCount; index += 1) {
      const first = Number(references[0]!.plane.data[index]);
      const second = Number(references[1]!.plane.data[index]);
      const third = Number(references[2]!.plane.data[index]);
      if (![first, second, third].every((value) =>
        Number.isFinite(value) && value >= 0 && value <= input.sensorMaximumValue)) {
        throw new Error(`Exposure ${exposureUs} us reference contains non-Mono8 data.`);
      }
      mean[index] = (first + second + third) / 3;
      pairwise[index] = Math.abs(first - second);
      pairwise[pixelCount + index] = Math.abs(first - third);
      pairwise[pixelCount * 2 + index] = Math.abs(second - third);
    }
    const n95RawDu = Math.max(1, quantile95(pairwise));
    darkMeanByExposure.set(exposureUs, mean);
    noiseByExposure.set(exposureUs, n95RawDu);
    darkNoiseByExposure.push({
      exposureUs,
      n95RawDu,
      adaptiveNoiseGuardRawDu: n95RawDu + 1,
      referenceEvidenceIds: references.map((entry) => entry.sourceEvidenceId),
      referenceSha256s: references.map((entry) =>
        sha256(entry.sourceSha256, "Bracket reference")),
    });
  }

  const selectedFusedClippingMask = new Uint8Array(pixelCount);
  const selectedCount = new Uint8Array(pixelCount);
  const normalizedCount = new Uint8Array(pixelCount);
  const channels = [...input.channels]
    .sort((left, right) => left.channel - right.channel)
    .map((channel): FixedRigPhotometricChannelInputV1 => {
      if (
        !Number.isFinite(channel.channelConfidence) ||
        channel.channelConfidence < 0 ||
        channel.channelConfidence > 1
      ) {
        throw new Error(`Channel ${channel.channel} confidence is not a measured fraction.`);
      }
      exactExposureSet(
        channel.observations.map((entry) => entry.exposureUs),
        `Channel ${channel.channel}`,
      );
      const observationByExposure = new Map(
        channel.observations.map((entry) => [entry.exposureUs, entry]),
      );
      const flat = flatByChannel.get(channel.channel);
      if (!flat) throw new Error(`Channel ${channel.channel} has no calibrated flat field.`);
      assertPlane(
        flat.relativeResponse,
        input.width,
        input.height,
        `Channel ${channel.channel} flat field`,
      );
      const correctedResponse = new Float32Array(pixelCount);
      const eligibleMask = new Uint8Array(pixelCount);
      const clippingMask = new Uint8Array(pixelCount);
      const selectedExposureUs = new Uint32Array(pixelCount);
      for (const exposureUs of [...FIXED_RIG_EXPOSURE_BRACKET_V1_EXPOSURES_US].reverse()) {
        const observation = observationByExposure.get(exposureUs)!;
        assertPlane(
          observation.plane,
          input.width,
          input.height,
          `Channel ${channel.channel} ${exposureUs} us observation`,
        );
        sha256(observation.sourceSha256, "Bracket observation");
        const dark = darkMeanByExposure.get(exposureUs)!;
        const noiseGuard = noiseByExposure.get(exposureUs)! + 1;
        for (let index = 0; index < pixelCount; index += 1) {
          if (!Number(input.gradeRelevantMask.data[index]) || selectedExposureUs[index]) continue;
          const raw = Number(observation.plane.data[index]);
          const flatResponse = Number(flat.relativeResponse.data[index]);
          if (
            !Number.isFinite(raw) ||
            raw < 0 ||
            raw > input.sensorMaximumValue ||
            !Number.isFinite(flatResponse) ||
            flatResponse <= 0
          ) {
            continue;
          }
          const sourceClipped =
            raw >= 0.98 * input.sensorMaximumValue;
          const signal = raw - Number(dark[index]);
          const guard = Math.max(
            0.01 * input.sensorMaximumValue * flatResponse,
            noiseGuard,
          );
          if (sourceClipped || signal <= guard) continue;
          selectedExposureUs[index] = exposureUs;
          eligibleMask[index] = 1;
          selectedCount[index] += 1;
          const corrected =
            signal *
            (FIXED_RIG_EXPOSURE_BRACKET_V1_TARGET_EXPOSURE_US / exposureUs) /
            flatResponse /
            input.sensorMaximumValue;
          correctedResponse[index] = corrected;
          if (corrected > 0.01) normalizedCount[index] += 1;
        }
      }
      return {
        channel: channel.channel,
        image: {
          width: input.width,
          height: input.height,
          data: new Float32Array(pixelCount),
        },
        channelConfidence: channel.channelConfidence,
        sourceEvidenceId:
          `exposure-bracket-v1-channel-${channel.channel}`,
        sourceSha256: sha256(
          channel.observations
            .slice()
            .sort((left, right) => left.exposureUs - right.exposureUs)[2]!
            .sourceSha256,
          "Bracket observation",
        ),
        fusedObservation: {
          correctedResponse,
          eligibleMask,
          clippingMask,
          selectedExposureUs,
          sourceEvidenceIds: channel.observations.map((entry) => entry.sourceEvidenceId),
          sourceSha256s: channel.observations.map((entry) =>
            sha256(entry.sourceSha256, "Bracket observation")),
        },
      };
    });
  const adaptiveRawGuardFailureMask = new Uint8Array(pixelCount);
  const normalizedFloorFailureMask = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (!Number(input.gradeRelevantMask.data[index])) continue;
    if (selectedCount[index] < 3) adaptiveRawGuardFailureMask[index] = 1;
    else if (normalizedCount[index] < 3) normalizedFloorFailureMask[index] = 1;
  }
  return {
    version: FIXED_RIG_EXPOSURE_BRACKET_FUSION_V1_VERSION,
    exposuresUs: [...FIXED_RIG_EXPOSURE_BRACKET_V1_EXPOSURES_US],
    isolatedDutyTenthsPercent:
      FIXED_RIG_EXPOSURE_BRACKET_V1_ISOLATED_DUTY_TENTHS_PERCENT,
    settleMs: FIXED_RIG_EXPOSURE_BRACKET_V1_SETTLE_MS,
    targetExposureUs: FIXED_RIG_EXPOSURE_BRACKET_V1_TARGET_EXPOSURE_US,
    channels,
    darkNoiseByExposure,
    selectedFusedClippingMask,
    adaptiveRawGuardFailureMask,
    normalizedFloorFailureMask,
  };
}
