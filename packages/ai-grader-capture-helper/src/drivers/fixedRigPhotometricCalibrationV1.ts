import { createHash } from "node:crypto";
import {
  validateMathematicalCalibrationProfileV1,
  type MathematicalCalibrationProfileV1,
} from "@tenkings/shared";
import type { FixedRigPhysicalCalibrationArtifactV1 } from "./fixedRigPhysicalCalibrationV1";
import type {
  FixedRigPhotometricCalibrationProfileV1,
  FixedRigScalarPlaneV1,
} from "./fixedRigPhotometricEvidenceV1";

export const FIXED_RIG_PHOTOMETRIC_CALIBRATION_V1_VERSION =
  "fixed_rig_photometric_calibration_adapter_v1" as const;
export const FIXED_RIG_PHOTOMETRIC_CALIBRATION_SOURCE_ALGORITHM_V1 =
  "opencv_physical_calibration_analysis_v1" as const;

interface HashBoundArtifactV1 {
  artifactSha256: string;
  hashPolicy: string;
}

export interface FixedRigFlatFieldArtifactV1 extends HashBoundArtifactV1 {
  schemaVersion: "ten-kings-flat-field-artifact-v1";
  algorithmVersion: string;
  channelIndex: number;
  sourceEvidence: Array<{ evidenceId: string; sha256: string; role: string }>;
  darkControlEvidence: Array<{ evidenceId: string; sha256: string; role: string }>;
  sourceWidthPx: number;
  sourceHeightPx: number;
  gainGrid: { width: number; height: number; values: number[] };
  correctedResidualSamples: number[];
  responseScale: number;
  correctedMaximumDeviationFraction: number;
}

export interface FixedRigIlluminationPatternArtifactV1 extends HashBoundArtifactV1 {
  schemaVersion: "ten-kings-illumination-pattern-artifact-v1";
  algorithmVersion: string;
  coordinateFrame: "normalized_card_portrait_pixels";
  grid: { width: number; height: number };
  channels: Array<{
    channelIndex: number;
    sourceEvidence: Array<{ evidenceId: string; sha256: string; role: string }>;
    expectedDirectionalResidual: number[];
  }>;
}

export interface BuildFixedRigPhotometricCalibrationV1Input {
  calibrationProfile: MathematicalCalibrationProfileV1;
  physicalArtifact: FixedRigPhysicalCalibrationArtifactV1;
  sensorMaximumValue: number;
  flatFieldArtifacts: Array<{
    fileBytes: Uint8Array;
  }>;
  illuminationPatternArtifact: {
    fileBytes: Uint8Array;
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

const PRESERVED_JSON_NUMBER_KEY = "\u0000ten-kings-exact-json-number-v1";
const JSON_NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/**
 * Preserve the producer's exact JSON number lexemes while canonicalizing key
 * order. Python and JavaScript serialize a few equal numbers differently
 * (`0.0` versus `0`, or exponent zero padding), so parsing to a JS number and
 * re-stringifying would create a second, incompatible hash authority.
 */
function wrapExactJsonNumbers(jsonText: string): string {
  let output = "";
  for (let index = 0; index < jsonText.length;) {
    const character = jsonText[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < jsonText.length) {
        if (jsonText.charCodeAt(index) === 92) {
          index += 2;
          continue;
        }
        if (jsonText[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      output += jsonText.slice(start, index);
      continue;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      const token = JSON_NUMBER_TOKEN.exec(jsonText.slice(index))?.[0];
      if (!token) throw new Error("Exact JSON contains an invalid number token.");
      output += JSON.stringify({ [PRESERVED_JSON_NUMBER_KEY]: token });
      index += token.length;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

function canonicalJsonWithPreservedNumbers(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonWithPreservedNumbers).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length === 1 &&
      keys[0] === PRESERVED_JSON_NUMBER_KEY &&
      typeof record[PRESERVED_JSON_NUMBER_KEY] === "string"
    ) {
      const token = record[PRESERVED_JSON_NUMBER_KEY];
      if (!JSON_NUMBER_TOKEN.test(token) || JSON_NUMBER_TOKEN.exec(token)?.[0] !== token) {
        throw new Error("Exact JSON contains an invalid preserved number token.");
      }
      return token;
    }
    return "{" + keys.sort((left, right) => left.localeCompare(right))
      .map((key) => JSON.stringify(key) + ":" +
        canonicalJsonWithPreservedNumbers(record[key]))
      .join(",") + "}";
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Exact JSON contains an unsupported value.");
  return serialized;
}

function exactJsonCanonicalContentSha256(jsonText: string, label: string): string {
  let preserved: unknown;
  try {
    preserved = JSON.parse(wrapExactJsonNumbers(jsonText));
  } catch {
    throw new Error(label + " must be valid UTF-8 JSON.");
  }
  if (!preserved || typeof preserved !== "object" || Array.isArray(preserved)) {
    throw new Error(label + " must contain one JSON object.");
  }
  const withoutHash = { ...(preserved as Record<string, unknown>) };
  delete withoutHash.artifactSha256;
  return createHash("sha256")
    .update(canonicalJsonWithPreservedNumbers(withoutHash))
    .digest("hex");
}

function verifyDeclaredContentHashPolicy(
  artifact: HashBoundArtifactV1,
  label: string,
): void {
  if (
    artifact.hashPolicy !== "sha256-canonical-json-with-artifactSha256-omitted" ||
    !/^[a-f0-9]{64}$/.test(artifact.artifactSha256)
  ) {
    throw new Error(label + " does not use the V1 canonical artifact hash policy.");
  }
}

function parseExactArtifactFile<T extends HashBoundArtifactV1>(
  fileBytes: Uint8Array,
  label: string,
): { fileSha256: string; artifact: T } {
  if (!(fileBytes instanceof Uint8Array) || fileBytes.byteLength === 0) {
    throw new Error(label + " exact file bytes are required.");
  }
  const jsonText = Buffer.from(fileBytes).toString("utf8");
  let artifact: T;
  try {
    artifact = JSON.parse(jsonText) as T;
  } catch {
    throw new Error(label + " must be valid UTF-8 JSON.");
  }
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error(label + " must contain one JSON object.");
  }
  verifyDeclaredContentHashPolicy(artifact, label);
  if (exactJsonCanonicalContentSha256(jsonText, label) !== artifact.artifactSha256) {
    throw new Error(label + " canonical content SHA-256 mismatch.");
  }
  return {
    fileSha256: createHash("sha256").update(fileBytes).digest("hex"),
    artifact,
  };
}

function exactEvidenceMatches(
  artifactEvidence: readonly { evidenceId: string; sha256: string; role: string }[],
  physicalEvidence: readonly { evidenceId: string; sha256: string; role: string }[],
): boolean {
  const keys = (entries: readonly { evidenceId: string; sha256: string; role: string }[]) =>
    entries.map((entry) => `${entry.evidenceId}\u0000${entry.sha256}\u0000${entry.role}`).sort();
  return JSON.stringify(keys(artifactEvidence)) === JSON.stringify(keys(physicalEvidence));
}

function maximumRelativeDeviation(values: readonly number[], label: string): number {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(label + " must contain finite positive acceptance samples.");
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.max(...values.map((value) => Math.abs(value / average - 1)));
}

function approximatelyEqual(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-6;
}

function finitePlane(
  width: number,
  height: number,
  values: readonly number[],
  label: string,
  positive = false,
): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    values.length !== width * height ||
    values.some((value) => !Number.isFinite(value) || (positive && value <= 0))
  ) {
    throw new Error(
      label + " must contain one " + (positive ? "positive " : "") +
      "finite value per grid pixel.",
    );
  }
}

function bilinearPlane(
  sourceWidth: number,
  sourceHeight: number,
  source: readonly number[],
  width: number,
  height: number,
): Float32Array {
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height === 1 ? 0 : (y * (sourceHeight - 1)) / (height - 1);
    const top = Math.floor(sourceY);
    const bottom = Math.min(sourceHeight - 1, top + 1);
    const yMix = sourceY - top;
    for (let x = 0; x < width; x += 1) {
      const sourceX = width === 1 ? 0 : (x * (sourceWidth - 1)) / (width - 1);
      const left = Math.floor(sourceX);
      const right = Math.min(sourceWidth - 1, left + 1);
      const xMix = sourceX - left;
      const topValue =
        source[top * sourceWidth + left]! * (1 - xMix) +
        source[top * sourceWidth + right]! * xMix;
      const bottomValue =
        source[bottom * sourceWidth + left]! * (1 - xMix) +
        source[bottom * sourceWidth + right]! * xMix;
      output[y * width + x] = topValue * (1 - yMix) + bottomValue * yMix;
    }
  }
  return output;
}

function responsePlaneFromGain(
  width: number,
  height: number,
  gainGrid: FixedRigFlatFieldArtifactV1["gainGrid"],
): FixedRigScalarPlaneV1 {
  finitePlane(gainGrid.width, gainGrid.height, gainGrid.values, "flat-field gain grid", true);
  const responseGrid = gainGrid.values.map((gain) => 1 / gain);
  const mean = responseGrid.reduce((sum, value) => sum + value, 0) / responseGrid.length;
  return {
    width,
    height,
    data: bilinearPlane(
      gainGrid.width,
      gainGrid.height,
      responseGrid.map((value) => value / mean),
      width,
      height,
    ),
  };
}

export function buildFixedRigPhotometricCalibrationProfileV1(
  input: BuildFixedRigPhotometricCalibrationV1Input,
): FixedRigPhotometricCalibrationProfileV1 {
  const validation = validateMathematicalCalibrationProfileV1(input.calibrationProfile);
  if (!validation.valid || !validation.isCalibrated || !validation.profile) {
    throw new Error("Photometric V1 requires a finalized physical calibration profile.");
  }
  const profile = validation.profile;
  const physicalArtifactHash = sha256Canonical((() => {
    const { artifactSha256: _artifactSha256, ...withoutHash } = input.physicalArtifact;
    return withoutHash;
  })());
  verifyDeclaredContentHashPolicy(
    input.physicalArtifact,
    "physical calibration artifact",
  );
  if (physicalArtifactHash !== input.physicalArtifact.artifactSha256) {
    throw new Error("Physical calibration artifact canonical content SHA-256 mismatch.");
  }
  if (
    input.physicalArtifact.artifactSha256 !== profile.artifactSha256 ||
    input.physicalArtifact.profileId !== profile.profileId ||
    input.physicalArtifact.calibrationVersion !== profile.calibrationVersion
  ) {
    throw new Error(
      "Physical calibration artifact identity does not match the finalized profile.",
    );
  }
  if (!Number.isFinite(input.sensorMaximumValue) || input.sensorMaximumValue <= 0) {
    throw new Error("sensorMaximumValue must be finite and positive.");
  }
  if (input.flatFieldArtifacts.length !== profile.channels.length) {
    throw new Error("Every calibrated channel requires one exact flat-field artifact.");
  }
  const exactFlatFieldArtifacts = input.flatFieldArtifacts.map((entry, index) =>
    parseExactArtifactFile<FixedRigFlatFieldArtifactV1>(
      entry.fileBytes,
      "flat-field artifact " + (index + 1),
    ),
  );
  const exactPatternArtifact =
    parseExactArtifactFile<FixedRigIlluminationPatternArtifactV1>(
      input.illuminationPatternArtifact.fileBytes,
      "illumination-pattern artifact",
    );
  const physicalChannels = new Map(
    input.physicalArtifact.inputs.channels.map((channel) => [
      channel.channelIndex,
      channel,
    ]),
  );
  const flatFieldsByChannel = new Map(
    exactFlatFieldArtifacts.map((entry) => [entry.artifact.channelIndex, entry]),
  );
  if (flatFieldsByChannel.size !== exactFlatFieldArtifacts.length) {
    throw new Error("Flat-field channel artifacts must be unique.");
  }
  for (const entry of exactFlatFieldArtifacts) {
    const physical = physicalChannels.get(entry.artifact.channelIndex);
    const artifact = entry.artifact;
    if (
      !/^[a-f0-9]{64}$/.test(entry.fileSha256) ||
      !physical ||
      physical.flatFieldArtifactSha256 !== entry.fileSha256 ||
      physical.flatFieldArtifactId.length === 0
    ) {
      throw new Error(
        "Channel " + entry.artifact.channelIndex +
        " flat-field file hash is not calibration-bound.",
      );
    }
    if (
      artifact.schemaVersion !== "ten-kings-flat-field-artifact-v1" ||
      artifact.algorithmVersion !== FIXED_RIG_PHOTOMETRIC_CALIBRATION_SOURCE_ALGORITHM_V1 ||
      !Number.isInteger(artifact.sourceWidthPx) ||
      artifact.sourceWidthPx <= 1 ||
      !Number.isInteger(artifact.sourceHeightPx) ||
      artifact.sourceHeightPx <= 1 ||
      !Number.isFinite(artifact.responseScale) ||
      artifact.responseScale <= 0
    ) {
      throw new Error(
        "Channel " + artifact.channelIndex + " flat-field artifact metadata is invalid.",
      );
    }
    finitePlane(
      artifact.gainGrid.width,
      artifact.gainGrid.height,
      artifact.gainGrid.values,
      "channel " + artifact.channelIndex + " flat-field gain grid",
      true,
    );
    const recomputedDeviation = maximumRelativeDeviation(
      artifact.correctedResidualSamples,
      "channel " + artifact.channelIndex + " corrected flat-field residuals",
    );
    const profileChannel = profile.channels.find(
      (channel) => channel.channelIndex === artifact.channelIndex,
    );
    if (
      !profileChannel ||
      !approximatelyEqual(recomputedDeviation, artifact.correctedMaximumDeviationFraction) ||
      !approximatelyEqual(recomputedDeviation, physical.maxFlatFieldDeviationFraction ?? Number.NaN) ||
      !approximatelyEqual(recomputedDeviation, profileChannel.maxFlatFieldDeviationFraction) ||
      !approximatelyEqual(artifact.responseScale, physical.responseScale) ||
      !approximatelyEqual(artifact.responseScale, profileChannel.responseScale) ||
      !exactEvidenceMatches(artifact.sourceEvidence, physical.flatFieldFrameEvidence) ||
      !exactEvidenceMatches(artifact.darkControlEvidence, physical.darkControlFrameEvidence)
    ) {
      throw new Error(
        "Channel " + artifact.channelIndex +
        " flat-field response, evidence, or acceptance statistic does not match the finalized physical calibration.",
      );
    }
  }

  const patternEntry = exactPatternArtifact;
  if (
    patternEntry.artifact.schemaVersion !== "ten-kings-illumination-pattern-artifact-v1" ||
    patternEntry.artifact.algorithmVersion !== FIXED_RIG_PHOTOMETRIC_CALIBRATION_SOURCE_ALGORITHM_V1 ||
    patternEntry.artifact.coordinateFrame !== "normalized_card_portrait_pixels"
  ) {
    throw new Error("Illumination-pattern artifact metadata is invalid.");
  }
  if (
    !Number.isInteger(patternEntry.artifact.grid.width) ||
    !Number.isInteger(patternEntry.artifact.grid.height) ||
    patternEntry.artifact.grid.width <= 0 ||
    patternEntry.artifact.grid.height <= 0
  ) {
    throw new Error("Illumination-pattern artifact grid dimensions are invalid.");
  }
  const patternByChannel = new Map(
    patternEntry.artifact.channels.map((channel) => [channel.channelIndex, channel]),
  );
  if (patternByChannel.size !== profile.channels.length) {
    throw new Error(
      "Illumination-pattern artifact must contain every calibrated channel exactly once.",
    );
  }
  const width = profile.normalizedWidthPx;
  const height = profile.normalizedHeightPx;
  const flatFieldChannels = profile.channels.map((channel) => {
    const flat = flatFieldsByChannel.get(channel.channelIndex);
    if (!flat) {
      throw new Error("Missing channel " + channel.channelIndex + " flat field.");
    }
    return {
      channel: channel.channelIndex,
      relativeResponse: responsePlaneFromGain(width, height, flat.artifact.gainGrid),
      sourceEvidenceId:
        flat.artifact.sourceEvidence[0]?.evidenceId ??
        "flat-field-channel-" + channel.channelIndex,
      sourceSha256: flat.fileSha256,
    };
  });
  const illuminationPatternChannels = profile.channels.map((channel) => {
    const physical = physicalChannels.get(channel.channelIndex);
    const pattern = patternByChannel.get(channel.channelIndex);
    if (!physical || !pattern) {
      throw new Error(
        "Missing channel " + channel.channelIndex + " illumination pattern.",
      );
    }
    if (
      physical.illuminationPatternArtifactSha256 !== patternEntry.fileSha256 ||
      physical.illuminationPatternArtifactId.length === 0
    ) {
      throw new Error(
        "Channel " + channel.channelIndex +
        " illumination-pattern file hash is not calibration-bound.",
      );
    }
    finitePlane(
      patternEntry.artifact.grid.width,
      patternEntry.artifact.grid.height,
      pattern.expectedDirectionalResidual,
      "channel " + channel.channelIndex + " illumination pattern",
    );
    const maximumAbsoluteResidual = Math.max(
      ...pattern.expectedDirectionalResidual.map((value) => Math.abs(value)),
    );
    if (
      !approximatelyEqual(
        maximumAbsoluteResidual,
        physical.maximumAbsoluteExpectedDirectionalResidual ?? Number.NaN,
      ) ||
      !exactEvidenceMatches(pattern.sourceEvidence, physical.illuminationPatternFrameEvidence)
    ) {
      throw new Error(
        "Channel " + channel.channelIndex +
        " illumination-pattern evidence or response does not match the finalized physical calibration.",
      );
    }
    return {
      channel: channel.channelIndex,
      expectedDirectionalResidual: {
        width,
        height,
        data: bilinearPlane(
          patternEntry.artifact.grid.width,
          patternEntry.artifact.grid.height,
          pattern.expectedDirectionalResidual,
          width,
          height,
        ),
      },
      sourceEvidenceId:
        pattern.sourceEvidence[0]?.evidenceId ??
        "illumination-pattern-channel-" + channel.channelIndex,
      sourceSha256: patternEntry.fileSha256,
    };
  });
  return {
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256,
    coordinateFrame: "normalized_card_portrait_pixels",
    width,
    height,
    sensorMaximumValue: input.sensorMaximumValue,
    isFinalized: true,
    isCalibrated: true,
    flatFieldChannels,
    illuminationPatternChannels,
    sourceEvidenceIds: [
      ...flatFieldChannels.map((channel) => channel.sourceEvidenceId),
      ...illuminationPatternChannels.map((channel) => channel.sourceEvidenceId),
    ],
  };
}
