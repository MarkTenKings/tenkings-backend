import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  FixedRigCardSide,
  FixedRigDisplayArtifact,
  FixedRigDisplayTransform,
  FixedRigQualityMetrics,
  FixedRigRoiDefinition,
  FixedRigSurfaceAnalysis,
} from "./baslerFixedRigV1";

export const LIGHT_DIRECTION_CALIBRATION_PROFILE_VERSION = "leimac-light-direction-calibration-profile-v0.1";
export const PRELIMINARY_NORMAL_RELIEF_PROXY_VERSION = "preliminary_normal_relief_proxy_v0";

export type LightDirectionProfileStatus =
  | "unknown"
  | "approximate_directional_model"
  | "flat_field_reference_ready"
  | "intensity_balanced"
  | "preliminary_normal_proxy"
  | "rejected";

export type ChannelPhysicalDirectionStatus = "unknown" | "approximate_directional_model" | "calibrated";

export type LightVectorCoordinateFrame = "basler_sensor_pixels" | "normalized_card_portrait_pixels";

export interface AuthoritativeCardDeskewLightVectorTransform {
  sourceCoordinateFrame: "basler_sensor_pixels";
  targetCoordinateFrame: "normalized_card_portrait_pixels";
  clockwiseRotationDegrees: number;
  source: "authoritative_card_normalization";
}

export interface LightVectorCoordinateTransformRecord {
  status:
    | "not_applied_legacy_sensor_coordinates"
    | "applied_authoritative_card_deskew"
    | "rejected_coordinate_mismatch"
    | "rejected_missing_authoritative_card_deskew";
  sourceCoordinateFrame: "basler_sensor_pixels";
  targetCoordinateFrame: LightVectorCoordinateFrame;
  clockwiseRotationDegrees: number | null;
  source: "legacy_raw_sensor_coordinates" | "authoritative_card_normalization" | "unavailable";
}

export interface LightDirectionAuxiliaryImageRegistration {
  status:
    | "registered_same_coordinate_frame"
    | "not_applied_image_unavailable"
    | "not_applied_dimension_mismatch"
    | "not_applied_coordinate_mismatch";
  inputCoordinateFrame: LightVectorCoordinateFrame;
  targetCoordinateFrame: LightVectorCoordinateFrame;
  geometricallyRegistered: boolean;
  note: string;
}

export interface LeimacChannelDirectionMetadata {
  channelNumber: number;
  label: string;
  physicalDirectionStatus: ChannelPhysicalDirectionStatus;
  approximateAngleDegrees?: number;
  lightVector?: { x: number; y: number; z: number };
  sourceApproximateAngleDegrees: number;
  sourceLightVector: { x: number; y: number; z: number };
  lightVectorCoordinateFrame: LightVectorCoordinateFrame;
  coordinateTransformAppliedDegrees: number | null;
  intensityScale: number;
  calibrationSource: "unknown" | "synthetic_even_8_channel_ring_model_unvalidated" | "flat_field_reference" | "operator_review";
  notes: string;
}

export interface LeimacLightDirectionCalibrationProfile {
  profileId: string;
  profileVersion: typeof LIGHT_DIRECTION_CALIBRATION_PROFILE_VERSION;
  fixtureId?: string;
  leimacModel?: string;
  cameraModel?: string;
  channelCount: number;
  channelMetadata: LeimacChannelDirectionMetadata[];
  lightVectorCoordinateFrame: LightVectorCoordinateFrame;
  lightVectorCoordinateTransform: LightVectorCoordinateTransformRecord;
  physicalDirectionMappingStatus: LightDirectionProfileStatus;
  intensityBalancingStatus: LightDirectionProfileStatus;
  flatFieldStatus: LightDirectionProfileStatus;
  normalMapStatus: LightDirectionProfileStatus;
  createdAt: string;
  sourceEvidenceRefs: string[];
  warnings: string[];
  isCertifiedPhotometricStereo: false;
}

export interface LightDirectionChannelBalance {
  channel: number;
  mean: number;
  max: number;
  clippedPixelFraction: number;
  darkPixelFraction: number;
  responseRatioVsMedian: number;
  recommendedIntensityScale: number;
  warnings: string[];
  normalizedChannel?: FixedRigDisplayArtifact;
}

export interface LightDirectionCalibrationImageInput {
  outputFilePath?: string;
  displayTransform?: FixedRigDisplayTransform;
  rawSourceFilePath?: string;
  rawSourceSha256?: string;
  imageWidth?: number;
  imageHeight?: number;
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
}

export interface LightDirectionCalibrationChannelInput {
  channel: number;
  displayImage?: LightDirectionCalibrationImageInput;
  stats?: Partial<FixedRigQualityMetrics>;
}

export interface BuildLightDirectionCalibrationInput {
  side: FixedRigCardSide;
  outputDir: string;
  trueView?: LightDirectionCalibrationImageInput;
  darkControl?: LightDirectionCalibrationImageInput;
  allOn?: LightDirectionCalibrationImageInput;
  channelImages: LightDirectionCalibrationChannelInput[];
  roiDefinitions?: FixedRigRoiDefinition[];
  inheritedWarnings?: string[];
  fixtureId?: string;
  leimacModel?: string;
  cameraModel?: string;
  flatReferenceImage?: LightDirectionCalibrationImageInput;
  lightVectorCoordinateTransform?: AuthoritativeCardDeskewLightVectorTransform;
}

export interface FixedRigLightDirectionCalibrationResult {
  version: typeof PRELIMINARY_NORMAL_RELIEF_PROXY_VERSION;
  status: "computed_diagnostic" | "insufficient_evidence";
  side: FixedRigCardSide;
  profile: LeimacLightDirectionCalibrationProfile;
  profilePath: string;
  resultPath: string;
  normalizedChannels: FixedRigDisplayArtifact[];
  channelBalance: LightDirectionChannelBalance[];
  normalProxy?: FixedRigDisplayArtifact;
  gradientMagnitude?: FixedRigDisplayArtifact;
  reliefProxy?: FixedRigDisplayArtifact;
  confidenceMap?: FixedRigDisplayArtifact;
  normalization: {
    method: "dark_subtracted_flat_field_optional_intensity_balanced_v0";
    darkSubtraction: boolean;
    flatFieldCorrection: boolean;
    fallbackNormalization: boolean;
    fallbackNormalizationReason: string | null;
    cardRect: Rect;
    coordinateFrame: "ai_grader_card_portrait_display" | "normalized_card_portrait_pixels";
    lightVectorCoordinateFrame: LightVectorCoordinateFrame;
    lightVectorCoordinateTransform: LightVectorCoordinateTransformRecord;
    darkControlRegistration: LightDirectionAuxiliaryImageRegistration;
    flatFieldRegistration: LightDirectionAuxiliaryImageRegistration;
  };
  confidence: { score: number; band: "low" | "medium" | "high"; warnings: string[] };
  warnings: string[];
}

interface LoadedImage {
  filePath: string;
  data: Uint8Array;
  width: number;
  height: number;
}

interface LoadedChannel extends LoadedImage {
  channel: number;
  stats?: Partial<FixedRigQualityMetrics>;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function roundMetric(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileMetadata(filePath: string): Promise<{ sha256: string; byteSize: number }> {
  const [bytes, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: stats.size,
  };
}

async function loadGrayscale(filePath: string, resizeTo?: { width: number; height: number }): Promise<LoadedImage> {
  let pipeline = sharp(filePath).greyscale();
  if (resizeTo) pipeline = pipeline.resize(resizeTo.width, resizeTo.height, { fit: "fill" });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return {
    filePath,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((percentileValue / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function cardRectForAnalysis(width: number, height: number, rois?: FixedRigRoiDefinition[]): Rect {
  const fullCard = rois?.find((roi) => roi.id === "full-card" && roi.status === "computed" && (roi.displayRect || roi.rect));
  const rect = fullCard?.displayRect ?? fullCard?.rect;
  if (!rect) return { x: 0, y: 0, width, height };
  const x = clamp(Math.floor(rect.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(rect.y), 0, Math.max(0, height - 1));
  return {
    x,
    y,
    width: clamp(Math.floor(rect.width), 1, width - x),
    height: clamp(Math.floor(rect.height), 1, height - y),
  };
}

function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function sourceDirectionVectorForChannel(channel: number): { angleDegrees: number; vector: { x: number; y: number; z: number } } {
  const angleDegrees = (channel - 1) * 45;
  const radians = (angleDegrees / 180) * Math.PI;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  const z = 0.55;
  const length = Math.sqrt(x * x + y * y + z * z);
  return {
    angleDegrees,
    vector: {
      x: roundMetric(x / length, 6),
      y: roundMetric(y / length, 6),
      z: roundMetric(z / length, 6),
    },
  };
}

function normalizeAngleDegrees(value: number): number {
  const normalized = value % 360;
  return roundMetric(normalized < 0 ? normalized + 360 : normalized, 6);
}

/**
 * Maps the unvalidated even-ring Leimac vector from Basler sensor coordinates
 * into the image coordinate frame produced by the same clockwise card deskew.
 * With no rotation this intentionally returns the legacy raw-sensor vector.
 */
export function mapApproximateLeimacChannelDirection(
  channel: number,
  clockwiseRotationDegrees = 0,
): { angleDegrees: number; vector: { x: number; y: number; z: number } } {
  if (!Number.isInteger(channel) || channel < 1 || channel > 8) {
    throw new Error(`Leimac channel must be an integer from 1 through 8; received ${channel}.`);
  }
  if (!Number.isFinite(clockwiseRotationDegrees)) {
    throw new Error("Light-vector coordinate rotation must be a finite number of degrees.");
  }
  const source = sourceDirectionVectorForChannel(channel);
  if (clockwiseRotationDegrees === 0) return source;
  const radians = (clockwiseRotationDegrees / 180) * Math.PI;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    angleDegrees: normalizeAngleDegrees(source.angleDegrees + clockwiseRotationDegrees),
    vector: {
      x: roundMetric(cosine * source.vector.x - sine * source.vector.y, 6),
      y: roundMetric(sine * source.vector.x + cosine * source.vector.y, 6),
      z: source.vector.z,
    },
  };
}

interface ResolvedLightVectorCoordinates {
  usable: boolean;
  imageCoordinateFrame: "ai_grader_card_portrait_display" | "normalized_card_portrait_pixels";
  lightVectorCoordinateFrame: LightVectorCoordinateFrame;
  clockwiseRotationDegrees: number;
  record: LightVectorCoordinateTransformRecord;
  warnings: string[];
}

function resolveLightVectorCoordinates(input: BuildLightDirectionCalibrationInput): ResolvedLightVectorCoordinates {
  const directionalImages = [
    input.trueView,
    input.allOn,
    ...input.channelImages.map((entry) => entry.displayImage),
  ].filter((entry): entry is LightDirectionCalibrationImageInput => Boolean(entry));
  const normalizedImageCount = directionalImages.filter(
    (entry) => entry.analysisCoordinateFrame === "normalized_card_portrait_pixels",
  ).length;
  const usesNormalizedCardCoordinates = normalizedImageCount > 0;
  const mixesCoordinateFrames = normalizedImageCount > 0 && normalizedImageCount < directionalImages.length;
  const transform = input.lightVectorCoordinateTransform;

  if (mixesCoordinateFrames) {
    return {
      usable: false,
      imageCoordinateFrame: "normalized_card_portrait_pixels",
      lightVectorCoordinateFrame: "basler_sensor_pixels",
      clockwiseRotationDegrees: 0,
      record: {
        status: "rejected_coordinate_mismatch",
        sourceCoordinateFrame: "basler_sensor_pixels",
        targetCoordinateFrame: "normalized_card_portrait_pixels",
        clockwiseRotationDegrees: null,
        source: "unavailable",
      },
      warnings: [
        "Directional normal/relief output was suppressed because channel evidence mixed Basler sensor and normalized-card coordinate frames.",
      ],
    };
  }

  if (usesNormalizedCardCoordinates) {
    const transformIsUsable =
      transform?.sourceCoordinateFrame === "basler_sensor_pixels" &&
      transform.targetCoordinateFrame === "normalized_card_portrait_pixels" &&
      transform.source === "authoritative_card_normalization" &&
      Number.isFinite(transform.clockwiseRotationDegrees);
    if (!transformIsUsable) {
      return {
        usable: false,
        imageCoordinateFrame: "normalized_card_portrait_pixels",
        lightVectorCoordinateFrame: "basler_sensor_pixels",
        clockwiseRotationDegrees: 0,
        record: {
          status: "rejected_missing_authoritative_card_deskew",
          sourceCoordinateFrame: "basler_sensor_pixels",
          targetCoordinateFrame: "normalized_card_portrait_pixels",
          clockwiseRotationDegrees: null,
          source: "unavailable",
        },
        warnings: [
          "Directional normal/relief output was suppressed because normalized-card channel images did not include the authoritative card deskew rotation needed to map sensor-coordinate light vectors.",
        ],
      };
    }
    return {
      usable: true,
      imageCoordinateFrame: "normalized_card_portrait_pixels",
      lightVectorCoordinateFrame: "normalized_card_portrait_pixels",
      clockwiseRotationDegrees: transform.clockwiseRotationDegrees,
      record: {
        status: "applied_authoritative_card_deskew",
        sourceCoordinateFrame: "basler_sensor_pixels",
        targetCoordinateFrame: "normalized_card_portrait_pixels",
        clockwiseRotationDegrees: roundMetric(transform.clockwiseRotationDegrees, 6),
        source: "authoritative_card_normalization",
      },
      warnings: [
        `Approximate channel vectors were rotated ${roundMetric(transform.clockwiseRotationDegrees, 3)} degrees clockwise from basler_sensor_pixels into normalized_card_portrait_pixels using the authoritative card normalization deskew. Physical Leimac channel direction mapping remains unvalidated.`,
      ],
    };
  }

  if (transform) {
    return {
      usable: false,
      imageCoordinateFrame: "ai_grader_card_portrait_display",
      lightVectorCoordinateFrame: "basler_sensor_pixels",
      clockwiseRotationDegrees: 0,
      record: {
        status: "rejected_coordinate_mismatch",
        sourceCoordinateFrame: "basler_sensor_pixels",
        targetCoordinateFrame: "basler_sensor_pixels",
        clockwiseRotationDegrees: null,
        source: "unavailable",
      },
      warnings: [
        "Directional normal/relief output was suppressed because a normalized-card light-vector transform was supplied for legacy sensor-coordinate channel images.",
      ],
    };
  }

  return {
    usable: true,
    imageCoordinateFrame: "ai_grader_card_portrait_display",
    lightVectorCoordinateFrame: "basler_sensor_pixels",
    clockwiseRotationDegrees: 0,
    record: {
      status: "not_applied_legacy_sensor_coordinates",
      sourceCoordinateFrame: "basler_sensor_pixels",
      targetCoordinateFrame: "basler_sensor_pixels",
      clockwiseRotationDegrees: 0,
      source: "legacy_raw_sensor_coordinates",
    },
    warnings: [],
  };
}

function imageInputCoordinateFrame(
  image: LightDirectionCalibrationImageInput | undefined,
): LightVectorCoordinateFrame {
  return image?.analysisCoordinateFrame === "normalized_card_portrait_pixels"
    ? "normalized_card_portrait_pixels"
    : "basler_sensor_pixels";
}

function auxiliaryImageRegistration(input: {
  label: "Dark control" | "Flat-field reference";
  image?: LightDirectionCalibrationImageInput;
  targetCoordinateFrame: LightVectorCoordinateFrame;
  fileAvailable: boolean;
  dimensionsMatch: boolean;
}): LightDirectionAuxiliaryImageRegistration {
  const inputCoordinateFrame = imageInputCoordinateFrame(input.image);
  const base = {
    inputCoordinateFrame,
    targetCoordinateFrame: input.targetCoordinateFrame,
  };
  if (!input.fileAvailable) {
    return {
      ...base,
      status: "not_applied_image_unavailable",
      geometricallyRegistered: false,
      note: `${input.label} was not applied because its image was unavailable.`,
    };
  }
  if (inputCoordinateFrame !== input.targetCoordinateFrame) {
    return {
      ...base,
      status: "not_applied_coordinate_mismatch",
      geometricallyRegistered: false,
      note: `${input.label} was not applied because ${inputCoordinateFrame} evidence was not geometrically registered into ${input.targetCoordinateFrame}.`,
    };
  }
  if (!input.dimensionsMatch) {
    return {
      ...base,
      status: "not_applied_dimension_mismatch",
      geometricallyRegistered: false,
      note: `${input.label} was not applied because its dimensions did not match the analysis images.`,
    };
  }
  return {
    ...base,
      status: "registered_same_coordinate_frame",
      geometricallyRegistered: true,
      note: `${input.label} is registered in ${input.targetCoordinateFrame} without a coordinate-frame mismatch.`,
  };
}

function rgbFromGray(data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length * 3);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 3;
    const value = data[index] ?? 0;
    output[offset] = value;
    output[offset + 1] = value;
    output[offset + 2] = value;
  }
  return output;
}

async function writeArtifact(input: {
  outputFilePath: string;
  kind: FixedRigDisplayArtifact["kind"];
  artifactRole: NonNullable<FixedRigDisplayArtifact["artifactRole"]>;
  width: number;
  height: number;
  rawSourceFilePath: string;
  rawSourceSha256?: string;
  displayTransform?: FixedRigDisplayTransform;
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
  sourceInputPaths: string[];
  note: string;
  buffer: Uint8Array | Buffer;
  channels: 3 | 4;
}): Promise<FixedRigDisplayArtifact> {
  await sharp(input.buffer, {
    raw: {
      width: input.width,
      height: input.height,
      channels: input.channels,
    },
  })
    .png()
    .toFile(input.outputFilePath);
  const meta = await fileMetadata(input.outputFilePath);
  return {
    kind: input.kind,
    outputFilePath: input.outputFilePath,
    sha256: meta.sha256,
    byteSize: meta.byteSize,
    mimeType: "image/png",
    imageWidth: input.width,
    imageHeight: input.height,
    rawSourceFilePath: input.rawSourceFilePath,
    ...(input.rawSourceSha256 ? { rawSourceSha256: input.rawSourceSha256 } : {}),
    rawCoordinateFrame: "basler_sensor_pixels",
    ...(input.analysisCoordinateFrame ? { analysisCoordinateFrame: input.analysisCoordinateFrame } : {}),
    displayTransform: input.displayTransform ?? "none",
    displayCoordinateFrame: "ai_grader_card_portrait_display",
    rawEvidenceUnmodified: true,
    artifactRole: input.artifactRole,
    sourceInputPaths: input.sourceInputPaths,
    physicalDirectionMappingStatus: "pending",
    note: input.note,
  };
}

function computeChannelBalance(input: {
  channels: LoadedChannel[];
  dark?: LoadedImage;
  cardRect: Rect;
}): Array<Omit<LightDirectionChannelBalance, "normalizedChannel">> {
  const means = input.channels.map((channel) => {
    let sum = 0;
    let count = 0;
    let max = 0;
    let clippedCount = 0;
    let darkCount = 0;
    for (let y = input.cardRect.y; y < input.cardRect.y + input.cardRect.height; y += 1) {
      for (let x = input.cardRect.x; x < input.cardRect.x + input.cardRect.width; x += 1) {
        const index = y * channel.width + x;
        const value = clamp((channel.data[index] ?? 0) - (input.dark?.data[index] ?? 0), 0, 255);
        sum += value;
        max = Math.max(max, value);
        clippedCount += value >= 248 ? 1 : 0;
        darkCount += value <= 8 ? 1 : 0;
        count += 1;
      }
    }
    const mean = count ? sum / count : 0;
    return {
      channel: channel.channel,
      stats: channel.stats,
      mean,
      max,
      clippedPixelFraction: count ? clippedCount / count : 0,
      darkPixelFraction: count ? darkCount / count : 0,
    };
  });
  const medianMean = percentile(means.map((entry) => entry.mean), 50) || 1;
  return means.map((entry) => {
    const responseRatio = entry.mean / medianMean;
    const scale = clamp(medianMean / Math.max(1, entry.mean), 0.25, 4);
    const reportedClipped = entry.stats?.clippedPixelFraction ?? entry.clippedPixelFraction;
    const reportedDark = entry.stats?.darkPixelFraction ?? entry.darkPixelFraction;
    const warnings = [
      ...(reportedClipped > 0.02 ? [`Channel ${entry.channel} has saturated/glare pixels (${roundMetric(reportedClipped, 6)}).`] : []),
      ...(reportedDark > 0.35 ? [`Channel ${entry.channel} is underlit/dark (${roundMetric(reportedDark, 6)}).`] : []),
      ...(responseRatio > 1.35 || responseRatio < 0.65 ? [`Channel ${entry.channel} response differs from median (${roundMetric(responseRatio, 4)}x).`] : []),
    ];
    return {
      channel: entry.channel,
      mean: roundMetric(entry.mean, 4),
      max: roundMetric(entry.max, 4),
      clippedPixelFraction: roundMetric(entry.clippedPixelFraction, 6),
      darkPixelFraction: roundMetric(entry.darkPixelFraction, 6),
      responseRatioVsMedian: roundMetric(responseRatio, 4),
      recommendedIntensityScale: roundMetric(scale, 4),
      warnings,
    };
  });
}

function normalizeChannels(input: {
  channels: LoadedChannel[];
  dark?: LoadedImage;
  cardRect: Rect;
  balance: Array<Omit<LightDirectionChannelBalance, "normalizedChannel">>;
}): Array<{ channel: number; data: Uint8Array; scale: number }> {
  const byChannel = new Map(input.balance.map((entry) => [entry.channel, entry]));
  return input.channels.map((channel) => {
    const scale = byChannel.get(channel.channel)?.recommendedIntensityScale ?? 1;
    const output = new Uint8Array(channel.width * channel.height);
    for (let index = 0; index < output.length; index += 1) {
      const x = index % channel.width;
      const y = Math.floor(index / channel.width);
      const corrected = clamp((channel.data[index] ?? 0) - (input.dark?.data[index] ?? 0), 0, 255);
      output[index] = rectContains(input.cardRect, x, y) ? clamp(Math.round(corrected * scale), 0, 255) : 0;
    }
    return { channel: channel.channel, data: output, scale };
  });
}

function buildProxyBuffers(input: {
  normalizedChannels: Array<{ channel: number; data: Uint8Array }>;
  width: number;
  height: number;
  cardRect: Rect;
  lightVectorClockwiseRotationDegrees: number;
}): {
  normal: Uint8Array;
  gradient: Uint8Array;
  relief: Uint8Array;
  confidence: Uint8Array;
  clippingFraction: number;
  darkFraction: number;
  p95Magnitude: number;
} {
  const pixelCount = input.width * input.height;
  const gx = new Float32Array(pixelCount);
  const gy = new Float32Array(pixelCount);
  const base = new Float32Array(pixelCount);
  const magnitudes: number[] = [];
  let clippedCount = 0;
  let darkCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const x = index % input.width;
    const y = Math.floor(index / input.width);
    if (!rectContains(input.cardRect, x, y)) continue;
    const values = input.normalizedChannels.map((channel) => channel.data[index] ?? 0);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    base[index] = mean;
    let localX = 0;
    let localY = 0;
    values.forEach((value, entryIndex) => {
      const channel = input.normalizedChannels[entryIndex]?.channel ?? entryIndex + 1;
      const { vector } = mapApproximateLeimacChannelDirection(
        channel,
        input.lightVectorClockwiseRotationDegrees,
      );
      const centered = value - mean;
      localX += centered * vector.x;
      localY += centered * vector.y;
    });
    gx[index] = localX / Math.max(1, values.length);
    gy[index] = localY / Math.max(1, values.length);
    const magnitude = Math.sqrt(gx[index] * gx[index] + gy[index] * gy[index]);
    magnitudes.push(magnitude);
    clippedCount += values.some((value) => value >= 248) ? 1 : 0;
    darkCount += mean <= 8 ? 1 : 0;
  }
  const p95Magnitude = Math.max(1, percentile(magnitudes, 95));
  const normal = new Uint8Array(pixelCount * 3);
  const gradient = new Uint8Array(pixelCount * 4);
  const relief = new Uint8Array(pixelCount * 3);
  const confidence = new Uint8Array(pixelCount * 4);
  for (let index = 0; index < pixelCount; index += 1) {
    const x = index % input.width;
    const y = Math.floor(index / input.width);
    const normalOffset = index * 3;
    const alphaOffset = index * 4;
    if (!rectContains(input.cardRect, x, y)) {
      normal[normalOffset] = 18;
      normal[normalOffset + 1] = 18;
      normal[normalOffset + 2] = 18;
      relief[normalOffset] = 18;
      relief[normalOffset + 1] = 18;
      relief[normalOffset + 2] = 18;
      gradient[alphaOffset + 3] = 0;
      confidence[alphaOffset + 3] = 0;
      continue;
    }
    const nx = clamp(gx[index] / p95Magnitude, -1, 1);
    const ny = clamp(gy[index] / p95Magnitude, -1, 1);
    const mag = clamp(Math.sqrt(nx * nx + ny * ny), 0, 1);
    normal[normalOffset] = clamp(Math.round(128 + nx * 90), 0, 255);
    normal[normalOffset + 1] = clamp(Math.round(128 + ny * 90), 0, 255);
    normal[normalOffset + 2] = clamp(Math.round(220 - mag * 70), 0, 255);
    const reliefValue = clamp(Math.round(base[index] + nx * 34 - ny * 28 + mag * 48), 0, 255);
    relief[normalOffset] = reliefValue;
    relief[normalOffset + 1] = clamp(Math.round(reliefValue * (1 - mag * 0.18)), 0, 255);
    relief[normalOffset + 2] = clamp(Math.round(reliefValue * (1 + mag * 0.16)), 0, 255);
    gradient[alphaOffset] = mag < 0.25 ? 45 : mag < 0.5 ? 224 : mag < 0.75 ? 230 : 210;
    gradient[alphaOffset + 1] = mag < 0.25 ? 155 : mag < 0.5 ? 194 : mag < 0.75 ? 126 : 54;
    gradient[alphaOffset + 2] = mag < 0.25 ? 86 : mag < 0.5 ? 54 : mag < 0.75 ? 44 : 48;
    gradient[alphaOffset + 3] = clamp(Math.round(42 + mag * 182), 0, 224);
    const evidenceConfidence = clamp(1 - mag * 0.16, 0.25, 0.96);
    confidence[alphaOffset] = clamp(Math.round(45 + (1 - evidenceConfidence) * 180), 0, 255);
    confidence[alphaOffset + 1] = clamp(Math.round(110 + evidenceConfidence * 120), 0, 255);
    confidence[alphaOffset + 2] = 92;
    confidence[alphaOffset + 3] = 172;
  }
  const cardPixels = Math.max(1, input.cardRect.width * input.cardRect.height);
  return {
    normal,
    gradient,
    relief,
    confidence,
    clippingFraction: clippedCount / cardPixels,
    darkFraction: darkCount / cardPixels,
    p95Magnitude,
  };
}

function confidenceBand(score: number): "low" | "medium" | "high" {
  if (score >= 0.72) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function buildProfile(input: {
  side: FixedRigCardSide;
  createdAt: string;
  sourceEvidenceRefs: string[];
  balance: Array<Omit<LightDirectionChannelBalance, "normalizedChannel">>;
  warnings: string[];
  fixtureId?: string;
  leimacModel?: string;
  cameraModel?: string;
  computedProxy: boolean;
  lightVectorCoordinates: ResolvedLightVectorCoordinates;
}): LeimacLightDirectionCalibrationProfile {
  const byChannel = new Map(input.balance.map((entry) => [entry.channel, entry]));
  return {
    profileId: `leimac-direction-profile-${input.side}-${input.createdAt.replace(/[^0-9]/g, "")}`,
    profileVersion: LIGHT_DIRECTION_CALIBRATION_PROFILE_VERSION,
    ...(input.fixtureId ? { fixtureId: input.fixtureId } : {}),
    leimacModel: input.leimacModel ?? "IDMU-P8B-24",
    cameraModel: input.cameraModel,
    channelCount: 8,
    channelMetadata: Array.from({ length: 8 }, (_, index) => {
      const channelNumber = index + 1;
      const sourceDirection = sourceDirectionVectorForChannel(channelNumber);
      const direction = input.lightVectorCoordinates.usable
        ? mapApproximateLeimacChannelDirection(
            channelNumber,
            input.lightVectorCoordinates.clockwiseRotationDegrees,
          )
        : undefined;
      return {
        channelNumber,
        label: `Channel ${channelNumber}`,
        physicalDirectionStatus: input.lightVectorCoordinates.usable
          ? "approximate_directional_model"
          : "unknown",
        ...(direction
          ? {
              approximateAngleDegrees: direction.angleDegrees,
              lightVector: direction.vector,
            }
          : {}),
        sourceApproximateAngleDegrees: sourceDirection.angleDegrees,
        sourceLightVector: sourceDirection.vector,
        lightVectorCoordinateFrame: input.lightVectorCoordinates.lightVectorCoordinateFrame,
        coordinateTransformAppliedDegrees: input.lightVectorCoordinates.usable
          ? roundMetric(input.lightVectorCoordinates.clockwiseRotationDegrees, 6)
          : null,
        intensityScale: byChannel.get(channelNumber)?.recommendedIntensityScale ?? 1,
        calibrationSource: "synthetic_even_8_channel_ring_model_unvalidated",
        notes: input.lightVectorCoordinates.usable
          ? "Approximate even-ring model for preliminary normal/relief proxy only. The vector is expressed in the persisted lightVectorCoordinateFrame; physical Leimac channel direction mapping is not certified."
          : "Approximate sensor-coordinate vector could not be mapped coherently to the channel image coordinate frame; directional output is suppressed.",
      };
    }),
    lightVectorCoordinateFrame: input.lightVectorCoordinates.lightVectorCoordinateFrame,
    lightVectorCoordinateTransform: input.lightVectorCoordinates.record,
    physicalDirectionMappingStatus: input.lightVectorCoordinates.usable
      ? "approximate_directional_model"
      : "rejected",
    intensityBalancingStatus: input.balance.length ? "intensity_balanced" : "unknown",
    flatFieldStatus: "unknown",
    normalMapStatus: input.computedProxy
      ? "preliminary_normal_proxy"
      : input.lightVectorCoordinates.usable
        ? "unknown"
        : "rejected",
    createdAt: input.createdAt,
    sourceEvidenceRefs: input.sourceEvidenceRefs,
    warnings: input.warnings,
    isCertifiedPhotometricStereo: false,
  };
}

export async function buildLightDirectionCalibrationArtifacts(
  input: BuildLightDirectionCalibrationInput
): Promise<FixedRigLightDirectionCalibrationResult> {
  await mkdir(input.outputDir, { recursive: true });
  const orderedInputs = [...input.channelImages].sort((a, b) => a.channel - b.channel);
  const firstPath = orderedInputs.find((entry) => entry.displayImage?.outputFilePath)?.displayImage?.outputFilePath;
  const profilePath = path.join(input.outputDir, `${input.side}-light-direction-profile.json`);
  const resultPath = path.join(input.outputDir, `${input.side}-normal-relief-proxy-v0.json`);
  const createdAt = new Date().toISOString();
  const lightVectorCoordinates = resolveLightVectorCoordinates(input);
  const analysisTargetCoordinateFrame: LightVectorCoordinateFrame =
    lightVectorCoordinates.imageCoordinateFrame === "normalized_card_portrait_pixels"
      ? "normalized_card_portrait_pixels"
      : "basler_sensor_pixels";
  if (!firstPath || !(await fileExists(firstPath))) {
    const darkControlRegistration = auxiliaryImageRegistration({
      label: "Dark control",
      image: input.darkControl,
      targetCoordinateFrame: analysisTargetCoordinateFrame,
      fileAvailable: false,
      dimensionsMatch: false,
    });
    const flatFieldRegistration = auxiliaryImageRegistration({
      label: "Flat-field reference",
      image: input.flatReferenceImage,
      targetCoordinateFrame: analysisTargetCoordinateFrame,
      fileAvailable: false,
      dimensionsMatch: false,
    });
    const warnings = [
      "Light direction calibration status is insufficient_evidence because channel image files were unavailable.",
      "No certified photometric stereo claim is made.",
      ...lightVectorCoordinates.warnings,
      ...(input.inheritedWarnings ?? []),
    ];
    const profile = buildProfile({
      side: input.side,
      createdAt,
      sourceEvidenceRefs: [],
      balance: [],
      warnings,
      fixtureId: input.fixtureId,
      leimacModel: input.leimacModel,
      cameraModel: input.cameraModel,
      computedProxy: false,
      lightVectorCoordinates,
    });
    const result: FixedRigLightDirectionCalibrationResult = {
      version: PRELIMINARY_NORMAL_RELIEF_PROXY_VERSION,
      status: "insufficient_evidence",
      side: input.side,
      profile,
      profilePath,
      resultPath,
      normalizedChannels: [],
      channelBalance: [],
      normalization: {
        method: "dark_subtracted_flat_field_optional_intensity_balanced_v0",
        darkSubtraction: false,
        flatFieldCorrection: false,
        fallbackNormalization: true,
        fallbackNormalizationReason: flatFieldRegistration.note,
        cardRect: { x: 0, y: 0, width: 0, height: 0 },
        coordinateFrame: lightVectorCoordinates.imageCoordinateFrame,
        lightVectorCoordinateFrame: lightVectorCoordinates.lightVectorCoordinateFrame,
        lightVectorCoordinateTransform: lightVectorCoordinates.record,
        darkControlRegistration,
        flatFieldRegistration,
      },
      confidence: { score: 0, band: "low", warnings },
      warnings,
    };
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
    return result;
  }

  const base = await loadGrayscale(firstPath);
  const channels: LoadedChannel[] = [];
  for (const entry of orderedInputs) {
    const filePath = entry.displayImage?.outputFilePath;
    if (!(await fileExists(filePath))) continue;
    const loaded = await loadGrayscale(filePath as string, { width: base.width, height: base.height });
    channels.push({ ...loaded, channel: entry.channel, stats: entry.stats });
  }
  const darkFileAvailable = await fileExists(input.darkControl?.outputFilePath);
  const darkDimensionsMatch =
    input.darkControl?.imageWidth === base.width && input.darkControl?.imageHeight === base.height;
  const darkControlRegistration = auxiliaryImageRegistration({
    label: "Dark control",
    image: input.darkControl,
    targetCoordinateFrame: analysisTargetCoordinateFrame,
    fileAvailable: darkFileAvailable,
    dimensionsMatch: darkDimensionsMatch,
  });
  const dark = darkControlRegistration.status === "registered_same_coordinate_frame"
    ? await loadGrayscale(input.darkControl?.outputFilePath as string, { width: base.width, height: base.height })
    : undefined;
  const flatFileAvailable = await fileExists(input.flatReferenceImage?.outputFilePath);
  const flatDimensionsMatch =
    input.flatReferenceImage?.imageWidth === base.width &&
    input.flatReferenceImage?.imageHeight === base.height;
  const flatFieldRegistration = auxiliaryImageRegistration({
    label: "Flat-field reference",
    image: input.flatReferenceImage,
    targetCoordinateFrame: analysisTargetCoordinateFrame,
    fileAvailable: flatFileAvailable,
    dimensionsMatch: flatDimensionsMatch,
  });
  const flatReferenceReady = flatFieldRegistration.status === "registered_same_coordinate_frame";
  const cardRect = cardRectForAnalysis(base.width, base.height, input.roiDefinitions);
  const sourceInputPaths = channels.map((entry) => entry.filePath);
  const transform = input.trueView?.displayTransform ?? orderedInputs.find((entry) => entry.displayImage?.displayTransform)?.displayImage?.displayTransform ?? "none";
  const trueViewPath = input.trueView?.outputFilePath ?? firstPath;
  const balanceBase = computeChannelBalance({ channels, dark, cardRect });
  const normalizedData = normalizeChannels({ channels, dark, cardRect, balance: balanceBase });
  const normalizedChannels: FixedRigDisplayArtifact[] = [];
  for (const entry of normalizedData) {
    const normalizedPath = path.join(input.outputDir, `${input.side}-channel-${entry.channel}-normalized.png`);
    normalizedChannels.push(
      await writeArtifact({
        outputFilePath: normalizedPath,
        kind: "normalized_channel_image",
        artifactRole: "normalized_channel",
        width: base.width,
        height: base.height,
        rawSourceFilePath: trueViewPath,
        rawSourceSha256: input.trueView?.rawSourceSha256,
        displayTransform: transform,
        ...(lightVectorCoordinates.imageCoordinateFrame === "normalized_card_portrait_pixels"
          ? { analysisCoordinateFrame: "normalized_card_portrait_pixels" as const }
          : {}),
        sourceInputPaths,
        note:
          "Intensity-balanced normalized Leimac channel image for preliminary light-direction calibration. This is derived evidence and not a raw capture.",
        buffer: rgbFromGray(entry.data),
        channels: 3,
      })
    );
  }
  const channelBalance = balanceBase.map((entry) => ({
    ...entry,
    normalizedChannel: normalizedChannels.find((artifact, index) => normalizedData[index]?.channel === entry.channel),
  }));
  const warnings = [
    "Light-direction profile uses an approximate unvalidated even-ring model; physical Leimac channel directions are not certified.",
    "Preliminary normal/relief proxy is not certified photometric stereo and is not a final surface grade.",
    ...lightVectorCoordinates.warnings,
    ...(dark
      ? []
      : [`Dark subtraction input was unavailable in matching analysis coordinates. ${darkControlRegistration.note} Current channel/card statistics were retained without dark subtraction.`]),
    ...(flatReferenceReady
      ? ["Flat-field reference is registered and reference-ready, but the V0 model does not apply pixelwise flat-field correction; current channel intensity balancing remains in use."]
      : [`Flat-field reference is unavailable in matching analysis coordinates. ${flatFieldRegistration.note} Intensity balancing used current channel evidence without flat-field correction.`]),
    ...(channels.length < 8 ? ["Complete 8-channel evidence is preferred for light-direction calibration prep."] : []),
    ...channelBalance.flatMap((entry) => entry.warnings),
    ...(input.inheritedWarnings ?? []),
  ];
  const computedProxy = channels.length >= 4 && lightVectorCoordinates.usable;
  const proxy = computedProxy
    ? buildProxyBuffers({
        normalizedChannels: normalizedData,
        width: base.width,
        height: base.height,
        cardRect,
        lightVectorClockwiseRotationDegrees: lightVectorCoordinates.clockwiseRotationDegrees,
      })
    : undefined;
  const normalProxy = proxy
    ? await writeArtifact({
        outputFilePath: path.join(input.outputDir, `${input.side}-preliminary-normal-proxy.png`),
        kind: "normal_proxy_map",
        artifactRole: "normal_proxy",
        width: base.width,
        height: base.height,
        rawSourceFilePath: trueViewPath,
        rawSourceSha256: input.trueView?.rawSourceSha256,
        displayTransform: transform,
        ...(lightVectorCoordinates.imageCoordinateFrame === "normalized_card_portrait_pixels"
          ? { analysisCoordinateFrame: "normalized_card_portrait_pixels" as const }
          : {}),
        sourceInputPaths,
        note: `Preliminary normal/relief proxy - approximate directional model in ${lightVectorCoordinates.lightVectorCoordinateFrame}. Not certified photometric stereo.`,
        buffer: proxy.normal,
        channels: 3,
      })
    : undefined;
  const gradientMagnitude = proxy
    ? await writeArtifact({
        outputFilePath: path.join(input.outputDir, `${input.side}-gradient-magnitude-proxy.png`),
        kind: "gradient_magnitude_map",
        artifactRole: "gradient_magnitude",
        width: base.width,
        height: base.height,
        rawSourceFilePath: trueViewPath,
        rawSourceSha256: input.trueView?.rawSourceSha256,
        displayTransform: transform,
        ...(lightVectorCoordinates.imageCoordinateFrame === "normalized_card_portrait_pixels"
          ? { analysisCoordinateFrame: "normalized_card_portrait_pixels" as const }
          : {}),
        sourceInputPaths,
        note: "Directional gradient magnitude proxy from normalized 8-channel evidence. Diagnostic only.",
        buffer: proxy.gradient,
        channels: 4,
      })
    : undefined;
  const reliefProxy = proxy
    ? await writeArtifact({
        outputFilePath: path.join(input.outputDir, `${input.side}-surface-relief-proxy.png`),
        kind: "relief_proxy_map",
        artifactRole: "relief_proxy",
        width: base.width,
        height: base.height,
        rawSourceFilePath: trueViewPath,
        rawSourceSha256: input.trueView?.rawSourceSha256,
        displayTransform: transform,
        ...(lightVectorCoordinates.imageCoordinateFrame === "normalized_card_portrait_pixels"
          ? { analysisCoordinateFrame: "normalized_card_portrait_pixels" as const }
          : {}),
        sourceInputPaths,
        note: `Preliminary relief proxy from approximate directional model in ${lightVectorCoordinates.lightVectorCoordinateFrame}. Not a certified depth/normal map.`,
        buffer: proxy.relief,
        channels: 3,
      })
    : undefined;
  const confidenceMap = proxy
    ? await writeArtifact({
        outputFilePath: path.join(input.outputDir, `${input.side}-light-direction-confidence-map.png`),
        kind: "confidence_mask",
        artifactRole: "confidence_map",
        width: base.width,
        height: base.height,
        rawSourceFilePath: trueViewPath,
        rawSourceSha256: input.trueView?.rawSourceSha256,
        displayTransform: transform,
        ...(lightVectorCoordinates.imageCoordinateFrame === "normalized_card_portrait_pixels"
          ? { analysisCoordinateFrame: "normalized_card_portrait_pixels" as const }
          : {}),
        sourceInputPaths,
        note: "Confidence map for preliminary normal/relief proxy. It highlights evidence-strength risk, not a defect by itself.",
        buffer: proxy.confidence,
        channels: 4,
      })
    : undefined;
  const clippingPenalty = (proxy?.clippingFraction ?? 0) > 0.1 ? 0.28 : (proxy?.clippingFraction ?? 0) > 0.02 ? 0.14 : 0;
  const darkPenalty = (proxy?.darkFraction ?? 0) > 0.35 ? 0.14 : 0;
  const channelPenalty = channels.length < 8 ? 0.18 : 0;
  const fallbackPenalty = 0.1;
  const score = computedProxy ? clamp(0.8 - clippingPenalty - darkPenalty - channelPenalty - fallbackPenalty, 0.08, 0.88) : 0;
  const profile = buildProfile({
    side: input.side,
    createdAt,
    sourceEvidenceRefs: sourceInputPaths,
    balance: balanceBase,
    warnings,
    fixtureId: input.fixtureId,
    leimacModel: input.leimacModel,
    cameraModel: input.cameraModel,
    computedProxy,
    lightVectorCoordinates,
  });
  profile.flatFieldStatus = flatReferenceReady ? "flat_field_reference_ready" : "unknown";
  const result: FixedRigLightDirectionCalibrationResult = {
    version: PRELIMINARY_NORMAL_RELIEF_PROXY_VERSION,
    status: computedProxy ? "computed_diagnostic" : "insufficient_evidence",
    side: input.side,
    profile,
    profilePath,
    resultPath,
    normalizedChannels,
    channelBalance,
    ...(normalProxy ? { normalProxy } : {}),
    ...(gradientMagnitude ? { gradientMagnitude } : {}),
    ...(reliefProxy ? { reliefProxy } : {}),
    ...(confidenceMap ? { confidenceMap } : {}),
    normalization: {
      method: "dark_subtracted_flat_field_optional_intensity_balanced_v0",
      darkSubtraction: Boolean(dark),
      flatFieldCorrection: false,
      fallbackNormalization: true,
      fallbackNormalizationReason: flatReferenceReady
        ? "Flat-field reference is registered and reference-ready, but V0 does not apply pixelwise flat-field correction."
        : flatFieldRegistration.note,
      cardRect,
      coordinateFrame: lightVectorCoordinates.imageCoordinateFrame,
      lightVectorCoordinateFrame: lightVectorCoordinates.lightVectorCoordinateFrame,
      lightVectorCoordinateTransform: lightVectorCoordinates.record,
      darkControlRegistration,
      flatFieldRegistration,
    },
    confidence: {
      score: roundMetric(score, 3),
      band: confidenceBand(score),
      warnings: warnings.filter((warning) => /clipping|underlit|flat-field|fallback|Complete 8-channel|certified|coordinate|deskew|suppressed/i.test(warning)),
    },
    warnings,
  };
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  return result;
}

export function mergeSurfaceAnalysisWithLightDirection(
  base: FixedRigSurfaceAnalysis | undefined,
  lightDirection: FixedRigLightDirectionCalibrationResult
): FixedRigSurfaceAnalysis {
  return {
    ...(base ?? {
      detectorId: "preliminary_surface_anomaly_detector_v0" as const,
      status: lightDirection.status,
      registration: {
        status: "assumed_fixed_rig" as const,
        note: "Per-channel portrait images are assumed aligned by the fixed fixture.",
      },
      perChannelStats: [],
      candidates: [],
      warnings: [],
    }),
    ...(lightDirection.normalProxy ? { normalProxy: lightDirection.normalProxy } : {}),
    ...(lightDirection.gradientMagnitude ? { gradientMagnitude: lightDirection.gradientMagnitude } : {}),
    ...(lightDirection.reliefProxy ? { reliefProxy: lightDirection.reliefProxy } : {}),
    ...(lightDirection.confidenceMap ? { confidenceMap: lightDirection.confidenceMap } : {}),
    lightDirection: {
      version: lightDirection.version,
      status: lightDirection.status,
      profile: lightDirection.profile,
      profilePath: lightDirection.profilePath,
      resultPath: lightDirection.resultPath,
      channelBalance: lightDirection.channelBalance,
      normalizedChannels: lightDirection.normalizedChannels,
      normalization: lightDirection.normalization,
      confidence: lightDirection.confidence,
    },
    physicalDirectionMappingStatus: "pending",
    confidence: base?.confidence ?? lightDirection.confidence,
    warnings: Array.from(new Set([...(base?.warnings ?? []), ...lightDirection.warnings])),
  };
}
