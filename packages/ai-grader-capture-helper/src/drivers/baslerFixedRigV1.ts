import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { BaslerCaptureStillResult } from "./baslerPylonClient";
import type { BaslerLeimacMacroPackageManifest } from "./baslerLeimacFullRig";
import { ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID } from "./baslerLeimacFullRig";
import { assertBaslerLeimacSyncSmokeOutputDirAllowed, type BaslerLeimacImageStats } from "./baslerLeimacSync";
import {
  LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
  buildLeimacIdmuSafeOffFrames,
  composeLeimacIdmuChannelWriteFrame,
  composeLeimacIdmuExplicitChannelWriteFrame,
  leimacIdmuDutyPercentToSteps,
  normalizeLeimacIdmuDutyPercent,
  type LeimacIdmuCommandResult,
  type LeimacIdmuSafeOffResult,
  type LeimacIdmuTriggerActivationMode,
  type LeimacIdmuWriteFrame,
  type LeimacIdmuWriteResult,
} from "./leimacIdmuClient";

export const BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION = "RUN BASLER FIXED RIG FOCUS ASSIST";
export const BASLER_FIXED_RIG_OPERATOR_PREVIEW_CONFIRMATION = "RUN BASLER FIXED RIG OPERATOR PREVIEW";
export const AI_GRADER_FIXED_RIG_V1_CONFIRMATION = "RUN AI GRADER FIXED RIG V1 LOCAL";
export const LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION = "RUN LEIMAC CHANNEL CHARACTERIZATION";
export const FIXED_RIG_V1_EVIDENCE_CLASS = "macro_fixed_rig_v1_uncalibrated";
export const FIXED_RIG_CALIBRATION_PROFILE_VERSION = "fixed-rig-v1-calibration-profile-v0.1";
export const FIXED_RIG_DEFAULT_CARD_WIDTH_MM = 63.5;
export const FIXED_RIG_DEFAULT_CARD_HEIGHT_MM = 88.9;
export const FIXED_RIG_SELECTED_EXPOSURE_US = 45000;
export const FIXED_RIG_SELECTED_GAIN = 0;
export const FIXED_RIG_SELECTED_LEIMAC_DUTY = 1.2;

export type FixedRigCardSide = "front" | "back";
export type FixedRigCalibrationStatus =
  | "uncalibrated"
  | "preview_assisted"
  | "focus_assisted"
  | "framing_assisted"
  | "channel_characterized"
  | "ready_for_repeatability";

export interface FixedRigSelectedPolarity {
  baslerLineInverter: true;
  leimacTriggerActivation: "LevelLow";
}

export interface FixedRigCalibrationProfile {
  profileId: string;
  profileVersion: typeof FIXED_RIG_CALIBRATION_PROFILE_VERSION;
  createdAt: string;
  cameraModel?: string | null;
  cameraSerial?: string | null;
  cameraSerialRedacted: true;
  lensModel?: string | null;
  imageWidth: number;
  imageHeight: number;
  selectedExposureUs: number;
  selectedGain: number;
  selectedLeimacDuty: number;
  selectedLightingProfileId: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  selectedPolarity: FixedRigSelectedPolarity;
  cardPhysicalWidthMm: number;
  cardPhysicalHeightMm: number;
  pixelToMmEstimateX?: number;
  pixelToMmEstimateY?: number;
  pixelToMmEstimateStatus: "not_computed" | "estimated_uncalibrated";
  lensDistortionCalibrated: false;
  lightingCalibrated: false;
  focusLockedByOperator: boolean;
  isCalibrated: false;
  calibrationStatus: FixedRigCalibrationStatus;
  warning: string;
}

export interface FixedRigCardBoundary {
  status: "detected" | "not_computed";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  coverage?: number;
  confidence: number;
  reason?: string;
}

export interface FixedRigRoiDefinition {
  id:
    | "full-card"
    | "top-left-corner"
    | "top-right-corner"
    | "bottom-right-corner"
    | "bottom-left-corner"
    | "top-edge"
    | "right-edge"
    | "bottom-edge"
    | "left-edge"
    | "center-surface"
    | "upper-surface"
    | "lower-surface";
  label: string;
  type: "corner" | "edge" | "surface";
  status: "computed" | "not_computed";
  rect?: { x: number; y: number; width: number; height: number };
  source: "approximate_detected_boundary" | "not_computed";
}

export interface FixedRigQualityMetrics extends BaslerLeimacImageStats {
  clippedPixelFraction: number;
  darkPixelFraction: number;
  sharpnessScore: number;
  cardBoundary: FixedRigCardBoundary;
  framing: {
    status: "acceptable_for_smoke" | "warning" | "not_computed";
    cardCoverageEstimate?: number;
    warnings: string[];
  };
  focus: {
    status: "manual_review" | "warning";
    sharpnessScore: number;
    recommendation: string;
  };
  warnings: string[];
}

export interface FixedRigOverlayArtifact {
  kind: "preview_overlay" | "roi_contact_sheet";
  outputFilePath: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png";
  imageWidth: number;
  imageHeight: number;
  rawEvidenceUnmodified: true;
  overlaysBakedIntoRawEvidence: false;
  note: string;
}

export interface FixedRigSuggestedDinoLiteTargets {
  status: "not_computed";
  reason: "surface anomaly detector not implemented yet";
  suggestedDinoLiteTargets: [];
}

export interface FixedRigLightingProfilePlan {
  dryRun: true;
  selectedLightingProfile: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  channelMappingStatus: "unknown";
  profiles: Array<{
    id: string;
    name: string;
    role: "dark_control" | "macro_overview" | "directional_candidate" | "surface_screening_candidate";
    applySupportedInPr38: false;
    plannedChannels: "unknown_pending_channel_mapping" | "all_channels";
    note: string;
  }>;
  safety: {
    writesApplied: false;
    lightsCommanded: false;
    persistentSaved: false;
    channelPhysicalMappingInvented: false;
  };
}

export interface FixedRigOperatorPreviewManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  previewReportPath?: string;
  status: "planned" | "preview_captured" | "aborted";
  mode: "snapshot_preview";
  operatorModeRequired: true;
  startAiGradingAutomatically: false;
  controls: {
    startAiGradingContinue: "operator_decision_only";
    abort: "operator_decision_only";
    refreshRecapturePreview: "rerun_command";
    safeOffAvailableIfLeimacEngaged: true;
  };
  previewCapture?: BaslerCaptureStillResult;
  quality?: FixedRigQualityMetrics;
  roiDefinitions: FixedRigRoiDefinition[];
  overlayPreview?: FixedRigOverlayArtifact;
  calibrationProfile: FixedRigCalibrationProfile;
  readiness: {
    status: "ready_for_operator_review" | "not_ready";
    warnings: string[];
    uncalibratedGridWarning: string;
  };
  safety: {
    localOnly: true;
    ambientPreviewOnly: true;
    leimacRequired: false;
    leimacEngaged: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    overlaysBakedIntoRawEvidence: false;
  };
  note: string;
}

export interface FixedRigFocusAssistManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  previewReportPath?: string;
  status: "planned" | "captured" | "aborted";
  selectedLightingProfile: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  macroPackage?: BaslerLeimacMacroPackageManifest;
  quality?: FixedRigQualityMetrics;
  roiDefinitions: FixedRigRoiDefinition[];
  overlayPreview?: FixedRigOverlayArtifact;
  calibrationProfile: FixedRigCalibrationProfile;
  suggestedDinoLiteTargets: FixedRigSuggestedDinoLiteTargets;
  operatorGuidance: {
    manualFocusOnly: true;
    autofocusClaimed: false;
    guidance: string[];
  };
  calibration: {
    isCalibrated: false;
    evidenceClass: typeof FIXED_RIG_V1_EVIDENCE_CLASS;
    calibrationStatus: FixedRigCalibrationStatus;
  };
  safety: {
    localOnly: true;
    safeOffBefore: boolean;
    safeOffAfter: boolean;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    finalLightOffConfirmedByMark: boolean;
  };
  note: string;
}

export interface FixedRigSideCapture {
  side: FixedRigCardSide;
  instruction: string;
  macroPackage: BaslerLeimacMacroPackageManifest;
  quality: FixedRigQualityMetrics;
  roiDefinitions: FixedRigRoiDefinition[];
  calibrationProfile: FixedRigCalibrationProfile;
  overlayPreview?: FixedRigOverlayArtifact;
  analysis: {
    status: "computed" | "not_computed";
    materiallyBrighter: boolean;
    qualityWarnings: string[];
    boundaryStatus: FixedRigCardBoundary["status"];
    notComputedReason?: string;
  };
}

export interface FixedRigV1LocalManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
  status: "planned" | "completed" | "aborted";
  selectedLightingProfile: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  workflow: {
    mode: "fixed_overhead_basler_v1";
    humanSteps: string[];
    baslerRole: "primary_macro_overview_measurement_screening";
    dinoliteRole: "optional_manual_detail_confirmation";
    automationNotRequiredForV1: Array<"dobot" | "openbuilds" | "robotic_arm" | "dinolite_full_card_tiling">;
  };
  front?: FixedRigSideCapture;
  back?: FixedRigSideCapture;
  lightingProfilePlan: FixedRigLightingProfilePlan;
  followUpPlan: {
    status: "not_computed" | "computed";
    suggestedDinoLiteTargets: Array<{
      side: FixedRigCardSide;
      roiId: FixedRigRoiDefinition["id"];
      reason: string;
    }>;
    note: string;
  };
  calibration: {
    isCalibrated: false;
    evidenceClass: typeof FIXED_RIG_V1_EVIDENCE_CLASS;
    profile: FixedRigCalibrationProfile;
    requiredNext: Array<"pixel_to_mm" | "lens_distortion" | "lighting_profile_calibration" | "repeatability">;
  };
  safety: {
    localOnly: true;
    offlineOnly: true;
    productionUpload: false;
    databaseWrites: false;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    safeOffBeforeFront: boolean;
    safeOffAfterFront: boolean;
    safeOffBeforeBack: boolean;
    safeOffAfterBack: boolean;
    finalLightOffConfirmedByMark: boolean;
  };
  warnings: string[];
  note: string;
}

export interface FixedRigQuadrantBrightnessSummary {
  topLeftMean: number;
  topRightMean: number;
  bottomRightMean: number;
  bottomLeftMean: number;
  brightestQuadrant: "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
  directionalInference: {
    status: "not_computed" | "inferred";
    confidence: number;
    note: string;
  };
}

export interface LeimacChannelCharacterizationChannel {
  channel: number;
  label: string;
  status: "planned" | "captured" | "failed";
  frames: LeimacIdmuWriteFrame[];
  safeOffBefore?: LeimacIdmuSafeOffResult;
  safeOffAfter?: LeimacIdmuSafeOffResult;
  writes?: LeimacIdmuWriteResult[];
  capture?: BaslerCaptureStillResult;
  stats?: FixedRigQualityMetrics;
  quadrantBrightness?: FixedRigQuadrantBrightnessSummary;
  error?: string;
}

export interface LeimacChannelCharacterizationManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
  status: "planned" | "completed" | "aborted";
  dutyPercent: number;
  dutySteps: number;
  exposureUs: number;
  gain: number;
  selectedLightingProfileId: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  selectedPolarity: FixedRigSelectedPolarity;
  channelToPhysicalMappingStatus: "unknown" | "inferred" | "confirmed";
  darkControl?: {
    capture: BaslerCaptureStillResult;
    stats: FixedRigQualityMetrics;
  };
  allOn?: {
    frames: LeimacIdmuWriteFrame[];
    capture?: BaslerCaptureStillResult;
    stats?: FixedRigQualityMetrics;
    quadrantBrightness?: FixedRigQuadrantBrightnessSummary;
  };
  channels: LeimacChannelCharacterizationChannel[];
  unitInfo?: LeimacIdmuCommandResult;
  calibrationProfile: FixedRigCalibrationProfile;
  safety: {
    localOnly: true;
    safeOffBeforeEachChannel: true;
    safeOffAfterEachChannel: true;
    dutyCapPercent: 5;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    channelPhysicalMappingInvented: false;
    finalLightOffConfirmedByMark: boolean;
  };
  warnings: string[];
  note: string;
}

function roundMetric(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function fileMetadata(filePath: string): Promise<{ sha256: string; byteSize: number }> {
  const [bytes, stats] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: stats.size,
  };
}

export function assertFixedRigOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  return assertBaslerLeimacSyncSmokeOutputDirAllowed(outputDir, repoRoot);
}

export async function createFixedRigPackageDir(parentOutputDir: string, prefix: string): Promise<{
  packageId: string;
  packageDir: string;
}> {
  const outputRoot = assertFixedRigOutputDirAllowed(parentOutputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const packageId = `${prefix}-${timestamp}`;
  const packageDir = path.join(outputRoot, packageId);
  await mkdir(packageDir, { recursive: true });
  return { packageId, packageDir };
}

export function buildFixedRigPixelToMmEstimate(
  boundary: FixedRigCardBoundary | undefined,
  cardPhysicalWidthMm = FIXED_RIG_DEFAULT_CARD_WIDTH_MM,
  cardPhysicalHeightMm = FIXED_RIG_DEFAULT_CARD_HEIGHT_MM
): {
  pixelToMmEstimateX?: number;
  pixelToMmEstimateY?: number;
  pixelToMmEstimateStatus: FixedRigCalibrationProfile["pixelToMmEstimateStatus"];
} {
  if (boundary?.status !== "detected" || !boundary.width || !boundary.height) {
    return { pixelToMmEstimateStatus: "not_computed" };
  }
  return {
    pixelToMmEstimateX: roundMetric(cardPhysicalWidthMm / boundary.width, 6),
    pixelToMmEstimateY: roundMetric(cardPhysicalHeightMm / boundary.height, 6),
    pixelToMmEstimateStatus: "estimated_uncalibrated",
  };
}

export function buildFixedRigCalibrationProfile(input: {
  profileId?: string;
  createdAt?: string;
  cameraModel?: string | null;
  cameraSerial?: string | null;
  lensModel?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  selectedExposureUs?: number;
  selectedGain?: number | null;
  selectedLeimacDuty?: number;
  cardBoundary?: FixedRigCardBoundary;
  cardPhysicalWidthMm?: number;
  cardPhysicalHeightMm?: number;
  focusLockedByOperator?: boolean;
  calibrationStatus?: FixedRigCalibrationStatus;
} = {}): FixedRigCalibrationProfile {
  const cardPhysicalWidthMm = input.cardPhysicalWidthMm ?? FIXED_RIG_DEFAULT_CARD_WIDTH_MM;
  const cardPhysicalHeightMm = input.cardPhysicalHeightMm ?? FIXED_RIG_DEFAULT_CARD_HEIGHT_MM;
  const pixelToMm = buildFixedRigPixelToMmEstimate(input.cardBoundary, cardPhysicalWidthMm, cardPhysicalHeightMm);
  return {
    profileId: input.profileId ?? "fixed-rig-v1-local-uncalibrated",
    profileVersion: FIXED_RIG_CALIBRATION_PROFILE_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    cameraModel: input.cameraModel ?? null,
    cameraSerial: input.cameraSerial ? "redacted" : null,
    cameraSerialRedacted: true,
    lensModel: input.lensModel ?? null,
    imageWidth: input.imageWidth ?? 2448,
    imageHeight: input.imageHeight ?? 2048,
    selectedExposureUs: input.selectedExposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: input.selectedGain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: input.selectedLeimacDuty ?? FIXED_RIG_SELECTED_LEIMAC_DUTY,
    selectedLightingProfileId: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    selectedPolarity: {
      baslerLineInverter: true,
      leimacTriggerActivation: "LevelLow",
    },
    cardPhysicalWidthMm,
    cardPhysicalHeightMm,
    ...pixelToMm,
    lensDistortionCalibrated: false,
    lightingCalibrated: false,
    focusLockedByOperator: input.focusLockedByOperator ?? false,
    isCalibrated: false,
    calibrationStatus: input.calibrationStatus ?? "uncalibrated",
    warning:
      "Local fixed-rig profile is a calibration foundation only; pixel/mm values are estimates when present and no calibrated evidence claim is made.",
  };
}

export function buildFixedRigLightingProfilePlan(): FixedRigLightingProfilePlan {
  return {
    dryRun: true,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    channelMappingStatus: "unknown",
    profiles: [
      {
        id: "dark-control-v0",
        name: "Dark control",
        role: "dark_control",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Capture with Leimac safe-off before synced macro evidence.",
      },
      {
        id: "line2-inverter-level-low-v0",
        name: "All-channel synced macro",
        role: "macro_overview",
        applySupportedInPr38: false,
        plannedChannels: "all_channels",
        note: "Accepted PR #36/PR #37 low-duty profile; currently the only applied profile in fixed-rig V1 smoke.",
      },
      {
        id: "directional-left-right-candidate-v0",
        name: "Left/right directional candidate",
        role: "directional_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Dry-run placeholder until Leimac channel-to-physical-segment mapping is calibrated.",
      },
      {
        id: "per-channel-1-through-8-characterization-v0",
        name: "Per-channel 1 through 8 characterization",
        role: "directional_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "PR #39 characterization labels channels numerically only; physical position remains unknown until reviewed.",
      },
      {
        id: "directional-top-bottom-candidate-v0",
        name: "Top/bottom directional candidate",
        role: "directional_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Dry-run placeholder until Leimac channel-to-physical-segment mapping is calibrated.",
      },
      {
        id: "surface-scratch-low-angle-candidate-v0",
        name: "Low-angle surface screening candidate",
        role: "surface_screening_candidate",
        applySupportedInPr38: false,
        plannedChannels: "unknown_pending_channel_mapping",
        note: "Dry-run placeholder; do not infer physical dome segments without measured channel mapping.",
      },
    ],
    safety: {
      writesApplied: false,
      lightsCommanded: false,
      persistentSaved: false,
      channelPhysicalMappingInvented: false,
    },
  };
}

export async function analyzeFixedRigMacroQuality(filePath: string): Promise<FixedRigQualityMetrics> {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width ?? 0;
  const height = info.height ?? 0;
  const count = data.length || 1;
  let min = 255;
  let max = 0;
  let sum = 0;
  let nonZero = 0;
  let bright = 0;
  let clipped = 0;
  let dark = 0;
  const buckets = new Array<number>(8).fill(0);
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    if (value > 0) nonZero += 1;
    if (value >= 32) bright += 1;
    if (value >= 250) clipped += 1;
    if (value <= 8) dark += 1;
    buckets[Math.min(7, Math.floor(value / 32))] += 1;
  }
  const mean = sum / count;
  let gradientSum = 0;
  let gradientCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const left = data[y * width + x - 1] ?? 0;
      const right = data[y * width + x + 1] ?? 0;
      const up = data[(y - 1) * width + x] ?? 0;
      const down = data[(y + 1) * width + x] ?? 0;
      const gx = right - left;
      const gy = down - up;
      gradientSum += gx * gx + gy * gy;
      gradientCount += 1;
    }
  }
  const sharpnessScore = roundMetric(gradientSum / Math.max(1, gradientCount), 4);
  const threshold = Math.max(16, Math.min(96, mean * 0.7));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x] ?? 0;
      if (value >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const boundaryWidth = maxX >= minX ? maxX - minX + 1 : 0;
  const boundaryHeight = maxY >= minY ? maxY - minY + 1 : 0;
  const coverage = boundaryWidth > 0 && boundaryHeight > 0 ? (boundaryWidth * boundaryHeight) / Math.max(1, width * height) : 0;
  const boundary: FixedRigCardBoundary =
    coverage > 0.05
      ? {
          status: "detected",
          x: minX,
          y: minY,
          width: boundaryWidth,
          height: boundaryHeight,
          coverage: roundMetric(coverage, 6),
          confidence: coverage >= 0.35 && coverage <= 0.95 ? 0.65 : 0.35,
        }
      : {
          status: "not_computed",
          confidence: 0,
          reason: "No reliable bright foreground boundary found in the uncalibrated macro image.",
        };
  const warnings: string[] = [];
  const clippedPixelFraction = clipped / count;
  const darkPixelFraction = dark / count;
  if (sharpnessScore < 20) warnings.push("Sharpness is low; manually adjust Basler focus/height and repeat focus assist.");
  if (mean < 15 || darkPixelFraction > 0.8) warnings.push("Image may be underexposed or mostly dark.");
  if (clippedPixelFraction > 0.02) warnings.push("Image has saturated/clipped pixels; reduce exposure, gain, or lighting duty in a later approved profile.");
  if (boundary.status !== "detected") warnings.push("Card boundary was not computed; ROI screening remains not_computed.");
  if (boundary.status === "detected" && (coverage < 0.35 || coverage > 0.95)) {
    warnings.push("Card coverage/framing is outside the preferred smoke range; adjust fixed tray/camera height before calibration.");
  }
  return {
    filePath,
    width,
    height,
    channels: info.channels ?? 1,
    min,
    max,
    mean: roundMetric(mean, 4),
    nonZeroFraction: roundMetric(nonZero / count, 6),
    brightFraction: roundMetric(bright / count, 6),
    histogram: buckets.map((bucketCount, index) => {
      const start = index * 32;
      const end = index === 7 ? 255 : start + 31;
      return {
        range: `${start}-${end}`,
        count: bucketCount,
        fraction: roundMetric(bucketCount / count, 6),
      };
    }),
    clippedPixelFraction: roundMetric(clippedPixelFraction, 6),
    darkPixelFraction: roundMetric(darkPixelFraction, 6),
    sharpnessScore,
    cardBoundary: boundary,
    framing: {
      status: boundary.status === "detected" && coverage >= 0.35 && coverage <= 0.95 ? "acceptable_for_smoke" : "warning",
      ...(boundary.status === "detected" ? { cardCoverageEstimate: roundMetric(coverage, 6) } : {}),
      warnings: warnings.filter((warning) => /boundary|coverage|framing|tray|height/i.test(warning)),
    },
    focus: {
      status: sharpnessScore < 20 ? "warning" : "manual_review",
      sharpnessScore,
      recommendation:
        "Manual focus assist only: repeat after mechanical focus/height changes and prefer the setting where sharpness improves then stabilizes.",
    },
    warnings,
  };
}

export function buildFixedRigRoiDefinitions(boundary: FixedRigCardBoundary): FixedRigRoiDefinition[] {
  const roiBase: Array<Omit<FixedRigRoiDefinition, "status" | "rect" | "source"> & {
    rectRatio: { x: number; y: number; width: number; height: number };
  }> = [
    { id: "full-card", label: "Full card", type: "surface", rectRatio: { x: 0, y: 0, width: 1, height: 1 } },
    { id: "top-left-corner", label: "Top-left corner", type: "corner", rectRatio: { x: 0, y: 0, width: 0.18, height: 0.18 } },
    { id: "top-right-corner", label: "Top-right corner", type: "corner", rectRatio: { x: 0.82, y: 0, width: 0.18, height: 0.18 } },
    { id: "bottom-right-corner", label: "Bottom-right corner", type: "corner", rectRatio: { x: 0.82, y: 0.82, width: 0.18, height: 0.18 } },
    { id: "bottom-left-corner", label: "Bottom-left corner", type: "corner", rectRatio: { x: 0, y: 0.82, width: 0.18, height: 0.18 } },
    { id: "top-edge", label: "Top edge", type: "edge", rectRatio: { x: 0.18, y: 0, width: 0.64, height: 0.12 } },
    { id: "right-edge", label: "Right edge", type: "edge", rectRatio: { x: 0.88, y: 0.18, width: 0.12, height: 0.64 } },
    { id: "bottom-edge", label: "Bottom edge", type: "edge", rectRatio: { x: 0.18, y: 0.88, width: 0.64, height: 0.12 } },
    { id: "left-edge", label: "Left edge", type: "edge", rectRatio: { x: 0, y: 0.18, width: 0.12, height: 0.64 } },
    { id: "center-surface", label: "Center surface", type: "surface", rectRatio: { x: 0.35, y: 0.35, width: 0.3, height: 0.3 } },
    { id: "upper-surface", label: "Upper surface", type: "surface", rectRatio: { x: 0.3, y: 0.18, width: 0.4, height: 0.22 } },
    { id: "lower-surface", label: "Lower surface", type: "surface", rectRatio: { x: 0.3, y: 0.6, width: 0.4, height: 0.22 } },
  ];
  if (boundary.status !== "detected" || boundary.x == null || boundary.y == null || !boundary.width || !boundary.height) {
    return roiBase.map(({ rectRatio: _rectRatio, ...roi }) => ({
      ...roi,
      status: "not_computed",
      source: "not_computed",
    }));
  }
  const boundaryX = boundary.x;
  const boundaryY = boundary.y;
  const boundaryWidth = boundary.width;
  const boundaryHeight = boundary.height;
  return roiBase.map(({ rectRatio, ...roi }) => ({
    ...roi,
    status: "computed",
    source: "approximate_detected_boundary",
    rect: {
      x: Math.round(boundaryX + boundaryWidth * rectRatio.x),
      y: Math.round(boundaryY + boundaryHeight * rectRatio.y),
      width: Math.round(boundaryWidth * rectRatio.width),
      height: Math.round(boundaryHeight * rectRatio.height),
    },
  }));
}

function rectSvg(rect: { x: number; y: number; width: number; height: number }, stroke: string, width = 4): string {
  return `<rect x="${rect.x}" y="${rect.y}" width="${Math.max(1, rect.width)}" height="${Math.max(1, rect.height)}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
}

function buildFixedRigOverlaySvg(input: {
  width: number;
  height: number;
  quality?: FixedRigQualityMetrics;
  roiDefinitions?: FixedRigRoiDefinition[];
  title?: string;
}): string {
  const { width, height } = input;
  const guideHeight = Math.round(height * 0.82);
  const guideWidth = Math.round(guideHeight * (2.5 / 3.5));
  const guideX = Math.round((width - guideWidth) / 2);
  const guideY = Math.round((height - guideHeight) / 2);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const boundary = input.quality?.cardBoundary;
  const rois = input.roiDefinitions ?? [];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
      .label { font-family: Arial, sans-serif; font-size: 28px; fill: #fff; paint-order: stroke; stroke: #000; stroke-width: 4px; }
      .small { font-size: 22px; }
    </style>
    <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#ffffff" stroke-width="2"/>
    ${rectSvg({ x: guideX, y: guideY, width: guideWidth, height: guideHeight }, "#ffd400", 6)}
    <line x1="${centerX}" y1="0" x2="${centerX}" y2="${height}" stroke="#00e5ff" stroke-width="3" stroke-dasharray="18 16"/>
    <line x1="0" y1="${centerY}" x2="${width}" y2="${centerY}" stroke="#00e5ff" stroke-width="3" stroke-dasharray="18 16"/>
    ${boundary?.status === "detected" && boundary.x != null && boundary.y != null && boundary.width && boundary.height ? rectSvg({ x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height }, "#00ff66", 5) : ""}
    ${rois.filter((roi) => roi.status === "computed" && roi.rect && roi.id !== "full-card").map((roi) => rectSvg(roi.rect!, roi.type === "corner" ? "#ff7a00" : roi.type === "edge" ? "#ff4fd8" : "#8cff00", 3)).join("")}
    <text x="24" y="44" class="label">${escapeHtml(input.title ?? "Fixed-rig preview overlay")}</text>
    <text x="24" y="${height - 58}" class="label small">Uncalibrated grid / overlay. Raw evidence image is unmodified.</text>
    <text x="24" y="${height - 24}" class="label small">Yellow: 2.5:3.5 placement guide. Green: detected boundary. Orange/pink/lime: ROIs.</text>
  </svg>`;
}

export async function createFixedRigOverlayPreview(input: {
  sourceImagePath: string;
  outputDir: string;
  filePrefix: string;
  quality?: FixedRigQualityMetrics;
  roiDefinitions?: FixedRigRoiDefinition[];
  title?: string;
}): Promise<FixedRigOverlayArtifact> {
  await mkdir(input.outputDir, { recursive: true });
  const metadata = await sharp(input.sourceImagePath).metadata();
  const imageWidth = metadata.width ?? input.quality?.width ?? 0;
  const imageHeight = metadata.height ?? input.quality?.height ?? 0;
  const outputFilePath = path.join(input.outputDir, `${input.filePrefix}-overlay.png`);
  const svg = buildFixedRigOverlaySvg({
    width: imageWidth,
    height: imageHeight,
    quality: input.quality,
    roiDefinitions: input.roiDefinitions,
    title: input.title,
  });
  await sharp(input.sourceImagePath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outputFilePath);
  const meta = await fileMetadata(outputFilePath);
  return {
    kind: "preview_overlay",
    outputFilePath,
    sha256: meta.sha256,
    byteSize: meta.byteSize,
    mimeType: "image/png",
    imageWidth,
    imageHeight,
    rawEvidenceUnmodified: true,
    overlaysBakedIntoRawEvidence: false,
    note: "Overlay/debug image only. Do not use as raw evidence; raw Basler evidence remains clean.",
  };
}

export function buildFixedRigFocusAssistManifest(input: {
  packageId: string;
  packageDir: string;
  status: FixedRigFocusAssistManifest["status"];
  macroPackage?: BaslerLeimacMacroPackageManifest;
  quality?: FixedRigQualityMetrics;
  overlayPreview?: FixedRigOverlayArtifact;
  safeOffBefore: boolean;
  safeOffAfter: boolean;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  previewReportPath?: string;
}): FixedRigFocusAssistManifest {
  const roiDefinitions = buildFixedRigRoiDefinitions(input.quality?.cardBoundary ?? { status: "not_computed", confidence: 0, reason: "No focus-assist image captured." });
  const syncedCapture = input.macroPackage?.synced?.capture;
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.packageId}-profile`,
    cameraModel: syncedCapture?.camera.modelName ?? syncedCapture?.camera.friendlyName ?? null,
    cameraSerial: syncedCapture?.camera.serialNumber ?? null,
    lensModel: syncedCapture?.calibration.lensModel ?? null,
    imageWidth: input.quality?.width ?? syncedCapture?.imageWidth,
    imageHeight: input.quality?.height ?? syncedCapture?.imageHeight,
    selectedExposureUs: input.macroPackage?.requestedExposureUs ?? syncedCapture?.exposureTime ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: syncedCapture?.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: input.macroPackage?.leimac.dutyPercent ?? FIXED_RIG_SELECTED_LEIMAC_DUTY,
    cardBoundary: input.quality?.cardBoundary,
    calibrationStatus: input.quality?.cardBoundary.status === "detected" ? "framing_assisted" : "focus_assisted",
  });
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    ...(input.macroPackage ? { macroPackage: input.macroPackage } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    roiDefinitions,
    ...(input.overlayPreview ? { overlayPreview: input.overlayPreview } : {}),
    calibrationProfile,
    suggestedDinoLiteTargets: {
      status: "not_computed",
      reason: "surface anomaly detector not implemented yet",
      suggestedDinoLiteTargets: [],
    },
    operatorGuidance: {
      manualFocusOnly: true,
      autofocusClaimed: false,
      guidance: [
        "This is manual focus assist, not autofocus.",
        "Repeat after focus/height adjustments and compare sharpnessScore; prefer the setting where sharpness improves then stabilizes.",
        "The card should fill most of the Basler frame while leaving a visible margin around all edges.",
        "Lock camera height, tray position, and focus after an acceptable setup before calibration work.",
      ],
    },
    calibration: {
      isCalibrated: false,
      evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
      calibrationStatus: calibrationProfile.calibrationStatus,
    },
    safety: {
      localOnly: true,
      safeOffBefore: input.safeOffBefore,
      safeOffAfter: input.safeOffAfter,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    note:
      "Fixed-rig Basler focus/framing assist is local and uncalibrated; it is not autofocus, calibrated macro evidence, a final grade, a certificate, or certified grading.",
  };
}

export function buildFixedRigSideCapture(input: {
  side: FixedRigCardSide;
  macroPackage: BaslerLeimacMacroPackageManifest;
  quality: FixedRigQualityMetrics;
  overlayPreview?: FixedRigOverlayArtifact;
}): FixedRigSideCapture {
  const rois = buildFixedRigRoiDefinitions(input.quality.cardBoundary);
  const syncedCapture = input.macroPackage.synced?.capture;
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.macroPackage.packageId}-${input.side}-profile`,
    cameraModel: syncedCapture?.camera.modelName ?? syncedCapture?.camera.friendlyName ?? null,
    cameraSerial: syncedCapture?.camera.serialNumber ?? null,
    lensModel: syncedCapture?.calibration.lensModel ?? null,
    imageWidth: input.quality.width,
    imageHeight: input.quality.height,
    selectedExposureUs: input.macroPackage.requestedExposureUs ?? syncedCapture?.exposureTime ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: syncedCapture?.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: input.macroPackage.leimac.dutyPercent,
    cardBoundary: input.quality.cardBoundary,
    calibrationStatus: input.quality.cardBoundary.status === "detected" ? "framing_assisted" : "focus_assisted",
  });
  const materiallyBrighter = input.macroPackage.comparison?.materiallyBrighter ?? false;
  const notComputedReason =
    input.quality.cardBoundary.status !== "detected"
      ? "Card boundary was not computed, so fixed-rig ROI analysis remains not_computed."
      : input.quality.warnings.length > 0
        ? "Quality warnings require operator review before scoring."
        : undefined;
  return {
    side: input.side,
    instruction:
      input.side === "front"
        ? "Place card face-up in the fixed tray/position before capture."
        : "Flip card to the back side in the same fixed tray/position before capture.",
    macroPackage: input.macroPackage,
    quality: input.quality,
    roiDefinitions: rois,
    calibrationProfile,
    ...(input.overlayPreview ? { overlayPreview: input.overlayPreview } : {}),
    analysis: {
      status: notComputedReason ? "not_computed" : "computed",
      materiallyBrighter,
      qualityWarnings: input.quality.warnings,
      boundaryStatus: input.quality.cardBoundary.status,
      ...(notComputedReason ? { notComputedReason } : {}),
    },
  };
}

export function buildFixedRigV1LocalManifest(input: {
  packageId: string;
  packageDir: string;
  status: FixedRigV1LocalManifest["status"];
  front?: FixedRigSideCapture;
  back?: FixedRigSideCapture;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
}): FixedRigV1LocalManifest {
  const warnings = [
    ...(input.front?.quality.warnings.map((warning) => `front: ${warning}`) ?? []),
    ...(input.back?.quality.warnings.map((warning) => `back: ${warning}`) ?? []),
  ];
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.analysisPath ? { analysisPath: input.analysisPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    workflow: {
      mode: "fixed_overhead_basler_v1",
      humanSteps: [
        "Place raw card face-up in fixed tray/position.",
        "Start fixed-rig V1 local workflow.",
        "Capture front Basler/Leimac dark control and synced macro.",
        "Flip card to back side in the same fixed tray/position.",
        "Capture back Basler/Leimac dark control and synced macro.",
        "Review macro quality and ROI screening output.",
        "Use Dino-Lite manually only for suggested or operator-requested close-up confirmation.",
      ],
      baslerRole: "primary_macro_overview_measurement_screening",
      dinoliteRole: "optional_manual_detail_confirmation",
      automationNotRequiredForV1: ["dobot", "openbuilds", "robotic_arm", "dinolite_full_card_tiling"],
    },
    ...(input.front ? { front: input.front } : {}),
    ...(input.back ? { back: input.back } : {}),
    lightingProfilePlan: buildFixedRigLightingProfilePlan(),
    followUpPlan: {
      status: "not_computed",
      suggestedDinoLiteTargets: [],
      note:
        "No suggested close-ups computed yet. PR #38 records ROI definitions and quality warnings only; no mature anomaly detector is allowed to fake defects.",
    },
    calibration: {
      isCalibrated: false,
      evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
      profile:
        input.front?.calibrationProfile ??
        input.back?.calibrationProfile ??
        buildFixedRigCalibrationProfile({ profileId: `${input.packageId}-profile`, calibrationStatus: "uncalibrated" }),
      requiredNext: ["pixel_to_mm", "lens_distortion", "lighting_profile_calibration", "repeatability"],
    },
    safety: {
      localOnly: true,
      offlineOnly: true,
      productionUpload: false,
      databaseWrites: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      safeOffBeforeFront: input.front?.macroPackage.safety.safeOffBefore ?? false,
      safeOffAfterFront: input.front?.macroPackage.safety.safeOffAfter ?? false,
      safeOffBeforeBack: input.back?.macroPackage.safety.safeOffBefore ?? false,
      safeOffAfterBack: input.back?.macroPackage.safety.safeOffAfter ?? false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    warnings,
    note:
      "Fixed-rig V1 local workflow output is uncalibrated and offline only; it is not a final AI grade, not a certificate, and not certified grading.",
  };
}

export function buildFixedRigOperatorPreviewManifest(input: {
  packageId: string;
  packageDir: string;
  status: FixedRigOperatorPreviewManifest["status"];
  previewCapture?: BaslerCaptureStillResult;
  quality?: FixedRigQualityMetrics;
  overlayPreview?: FixedRigOverlayArtifact;
  focusLockedByOperator?: boolean;
  manifestPath?: string;
  previewReportPath?: string;
}): FixedRigOperatorPreviewManifest {
  const roiDefinitions = buildFixedRigRoiDefinitions(input.quality?.cardBoundary ?? { status: "not_computed", confidence: 0 });
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.packageId}-profile`,
    cameraModel: input.previewCapture?.camera.modelName ?? input.previewCapture?.camera.friendlyName ?? null,
    cameraSerial: input.previewCapture?.camera.serialNumber ?? null,
    lensModel: input.previewCapture?.calibration.lensModel ?? null,
    imageWidth: input.quality?.width ?? input.previewCapture?.imageWidth,
    imageHeight: input.quality?.height ?? input.previewCapture?.imageHeight,
    selectedExposureUs: input.previewCapture?.exposureTime ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: input.previewCapture?.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: 0,
    cardBoundary: input.quality?.cardBoundary,
    focusLockedByOperator: input.focusLockedByOperator ?? false,
    calibrationStatus: input.status === "preview_captured" ? "preview_assisted" : "uncalibrated",
  });
  const warnings = [
    ...(input.quality?.warnings ?? []),
    "Uncalibrated grid warning: no validated pixel/mm or lens-distortion calibration is loaded.",
  ];
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    mode: "snapshot_preview",
    operatorModeRequired: true,
    startAiGradingAutomatically: false,
    controls: {
      startAiGradingContinue: "operator_decision_only",
      abort: "operator_decision_only",
      refreshRecapturePreview: "rerun_command",
      safeOffAvailableIfLeimacEngaged: true,
    },
    ...(input.previewCapture ? { previewCapture: input.previewCapture } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    roiDefinitions,
    ...(input.overlayPreview ? { overlayPreview: input.overlayPreview } : {}),
    calibrationProfile,
    readiness: {
      status: input.quality && !input.quality.warnings.length ? "ready_for_operator_review" : "not_ready",
      warnings,
      uncalibratedGridWarning: "Grid and ROI guides are uncalibrated until a real calibration target/profile is implemented.",
    },
    safety: {
      localOnly: true,
      ambientPreviewOnly: true,
      leimacRequired: false,
      leimacEngaged: false,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      overlaysBakedIntoRawEvidence: false,
    },
    note:
      "Basler fixed-rig operator preview is manual focus/alignment support only. Snapshot overlays are debug/preview artifacts and are not baked into raw evidence.",
  };
}

function channelValuesFor(selectedChannel: number | "all", activeValue: string, inactiveValue = "0000") {
  return Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    const active = selectedChannel === "all" || selectedChannel === channel;
    return {
      channel,
      value: active ? activeValue : inactiveValue,
      meaning: active ? `PWM duty ${activeValue}` : "PWM duty 0 steps",
    };
  });
}

export function buildLeimacCharacterizationFrames(input: {
  channel: number | "all";
  dutyPercent?: number | string;
  unit?: number | string;
  triggerActivation?: LeimacIdmuTriggerActivationMode;
}): LeimacIdmuWriteFrame[] {
  const dutyPercent = normalizeLeimacIdmuDutyPercent(input.dutyPercent ?? 1);
  const dutyValue = String(leimacIdmuDutyPercentToSteps(dutyPercent)).padStart(4, "0");
  const triggerActivation = input.triggerActivation ?? "LevelLow";
  return [
    ...buildLeimacIdmuSafeOffFrames(input.unit),
    composeLeimacIdmuChannelWriteFrame({
      name: "triggerActivation",
      unit: input.unit,
      value: triggerActivation === "LevelLow" ? "0002" : "0000",
      meaning: triggerActivation,
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "triggerSource",
      unit: input.unit,
      value: "0000",
      meaning: "TRG IN1",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "triggerSynchronizationMode",
      unit: input.unit,
      value: "0000",
      meaning: "Synchronous",
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "lightingOutputDelay",
      unit: input.unit,
      value: "0000",
      meaning: "0 microseconds",
    }),
    composeLeimacIdmuExplicitChannelWriteFrame({
      name: "lightingOutputValue",
      unit: input.unit,
      channelValues: channelValuesFor(input.channel, dutyValue),
    }),
    composeLeimacIdmuChannelWriteFrame({
      name: "asynchronousOutput",
      unit: input.unit,
      value: "0000",
      meaning: "Asynchronous output OFF",
    }),
    composeLeimacIdmuExplicitChannelWriteFrame({
      name: "lightingOutput",
      unit: input.unit,
      channelValues: channelValuesFor(input.channel, "0001", "0000").map((entry) => ({
        ...entry,
        meaning: entry.value === "0001" ? "Lighting output enabled for trigger-controlled characterization" : "Lighting output OFF",
      })),
    }),
  ];
}

export function buildLeimacChannelCharacterizationManifest(input: {
  packageId: string;
  packageDir: string;
  status: LeimacChannelCharacterizationManifest["status"];
  dutyPercent?: number | string;
  exposureUs?: number;
  gain?: number;
  channels?: LeimacChannelCharacterizationChannel[];
  darkControl?: LeimacChannelCharacterizationManifest["darkControl"];
  allOn?: LeimacChannelCharacterizationManifest["allOn"];
  unitInfo?: LeimacIdmuCommandResult;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
}): LeimacChannelCharacterizationManifest {
  const dutyPercent = normalizeLeimacIdmuDutyPercent(input.dutyPercent ?? 1);
  const exposureUs = input.exposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US;
  const channels: LeimacChannelCharacterizationChannel[] =
    input.channels ??
    Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      label: `channel ${index + 1}`,
      status: "planned" as const,
      frames: buildLeimacCharacterizationFrames({ channel: index + 1, dutyPercent }),
    }));
  const anyInferred = channels.some((channel) => channel.quadrantBrightness?.directionalInference.status === "inferred");
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.packageId}-channel-characterization-profile`,
    selectedExposureUs: exposureUs,
    selectedGain: input.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: dutyPercent,
    calibrationStatus: "channel_characterized",
  });
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.analysisPath ? { analysisPath: input.analysisPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    dutyPercent,
    dutySteps: leimacIdmuDutyPercentToSteps(dutyPercent),
    exposureUs,
    gain: input.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLightingProfileId: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    selectedPolarity: {
      baslerLineInverter: true,
      leimacTriggerActivation: "LevelLow",
    },
    channelToPhysicalMappingStatus: anyInferred ? "inferred" : "unknown",
    ...(input.darkControl ? { darkControl: input.darkControl } : {}),
    ...(input.allOn ? { allOn: input.allOn } : {}),
    channels,
    ...(input.unitInfo ? { unitInfo: input.unitInfo } : {}),
    calibrationProfile,
    safety: {
      localOnly: true,
      safeOffBeforeEachChannel: true,
      safeOffAfterEachChannel: true,
      dutyCapPercent: LEIMAC_IDMU_MAX_FIRST_SMOKE_DUTY_PERCENT,
      persistentBaslerSaved: false,
      persistentLeimacSaved: false,
      channelPhysicalMappingInvented: false,
      finalLightOffConfirmedByMark: input.finalLightOffConfirmedByMark ?? false,
    },
    warnings: [
      "Channel labels are numeric only; physical segment mapping is unknown until reviewed and confirmed.",
      "Quadrant brightness, when present, is an inferred diagnostic only and not a physical mapping fact.",
      "No calibrated macro evidence, final grade, certificate, or certified grading claim is made.",
    ],
    note:
      "Leimac 8-channel characterization is a supervised low-duty local diagnostic for future lighting calibration only.",
  };
}

export async function analyzeFixedRigQuadrants(filePath: string): Promise<FixedRigQuadrantBrightnessSummary> {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width ?? 0;
  const height = info.height ?? 0;
  const sums = {
    topLeft: { sum: 0, count: 0 },
    topRight: { sum: 0, count: 0 },
    bottomRight: { sum: 0, count: 0 },
    bottomLeft: { sum: 0, count: 0 },
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x] ?? 0;
      const key =
        y < height / 2
          ? x < width / 2
            ? "topLeft"
            : "topRight"
          : x < width / 2
            ? "bottomLeft"
            : "bottomRight";
      sums[key].sum += value;
      sums[key].count += 1;
    }
  }
  const means = {
    topLeft: roundMetric(sums.topLeft.sum / Math.max(1, sums.topLeft.count), 4),
    topRight: roundMetric(sums.topRight.sum / Math.max(1, sums.topRight.count), 4),
    bottomRight: roundMetric(sums.bottomRight.sum / Math.max(1, sums.bottomRight.count), 4),
    bottomLeft: roundMetric(sums.bottomLeft.sum / Math.max(1, sums.bottomLeft.count), 4),
  };
  const sorted = Object.entries(means).sort((a, b) => b[1] - a[1]) as Array<[keyof typeof means, number]>;
  const brightestQuadrant = sorted[0][0];
  const spread = sorted[0][1] - sorted[sorted.length - 1][1];
  return {
    topLeftMean: means.topLeft,
    topRightMean: means.topRight,
    bottomRightMean: means.bottomRight,
    bottomLeftMean: means.bottomLeft,
    brightestQuadrant,
    directionalInference: {
      status: spread >= 5 ? "inferred" : "not_computed",
      confidence: spread >= 20 ? 0.6 : spread >= 5 ? 0.3 : 0,
      note:
        spread >= 5
          ? "Brightness asymmetry suggests a possible direction, but physical channel mapping is not confirmed."
          : "Quadrant spread is too small for a useful directional inference.",
    },
  };
}

export async function writeFixedRigOperatorPreviewArtifacts(
  manifest: FixedRigOperatorPreviewManifest
): Promise<FixedRigOperatorPreviewManifest> {
  const overlayPreview =
    manifest.previewCapture?.outputFilePath && manifest.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: manifest.previewCapture.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "operator-preview",
          quality: manifest.quality,
          roiDefinitions: manifest.roiDefinitions,
          title: "Operator preview",
        })
      : manifest.overlayPreview;
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, ...(overlayPreview ? { overlayPreview } : {}), manifestPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeFile(previewReportPath, renderFixedRigOperatorPreviewReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeLeimacChannelCharacterizationArtifacts(
  manifest: LeimacChannelCharacterizationManifest
): Promise<LeimacChannelCharacterizationManifest> {
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const analysisPath = path.join(manifest.packageDir, "channel-characterization.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, manifestPath, analysisPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeJsonArtifact(analysisPath, {
    status: manifest.status,
    dutyPercent: manifest.dutyPercent,
    exposureUs: manifest.exposureUs,
    channelToPhysicalMappingStatus: manifest.channelToPhysicalMappingStatus,
    channels: manifest.channels.map((channel) => ({
      channel: channel.channel,
      label: channel.label,
      status: channel.status,
      capture: channel.capture
        ? {
            outputFilePath: channel.capture.outputFilePath,
            sha256: channel.capture.sha256,
            byteSize: channel.capture.byteSize,
            dimensions: { width: channel.capture.imageWidth, height: channel.capture.imageHeight },
          }
        : undefined,
      stats: channel.stats,
      quadrantBrightness: channel.quadrantBrightness,
      error: channel.error,
    })),
    allOn: manifest.allOn,
    darkControl: manifest.darkControl,
    warnings: manifest.warnings,
  });
  await writeFile(previewReportPath, renderLeimacChannelCharacterizationReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeFixedRigFocusAssistArtifacts(
  manifest: FixedRigFocusAssistManifest
): Promise<FixedRigFocusAssistManifest> {
  const syncedPath = manifest.macroPackage?.synced?.capture.outputFilePath;
  const overlayPreview =
    syncedPath && manifest.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: syncedPath,
          outputDir: manifest.packageDir,
          filePrefix: "focus-assist",
          quality: manifest.quality,
          roiDefinitions: manifest.roiDefinitions,
          title: "Focus/framing assist",
        })
      : manifest.overlayPreview;
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, ...(overlayPreview ? { overlayPreview } : {}), manifestPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeFile(previewReportPath, renderFixedRigFocusAssistReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeFixedRigV1Artifacts(manifest: FixedRigV1LocalManifest): Promise<FixedRigV1LocalManifest> {
  const frontOverlay =
    manifest.front?.macroPackage.synced?.capture.outputFilePath && manifest.front.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: manifest.front.macroPackage.synced.capture.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "front",
          quality: manifest.front.quality,
          roiDefinitions: manifest.front.roiDefinitions,
          title: "Front ROI overlay",
        })
      : manifest.front?.overlayPreview;
  const backOverlay =
    manifest.back?.macroPackage.synced?.capture.outputFilePath && manifest.back.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: manifest.back.macroPackage.synced.capture.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "back",
          quality: manifest.back.quality,
          roiDefinitions: manifest.back.roiDefinitions,
          title: "Back ROI overlay",
        })
      : manifest.back?.overlayPreview;
  const manifestWithOverlays: FixedRigV1LocalManifest = {
    ...manifest,
    ...(manifest.front ? { front: { ...manifest.front, ...(frontOverlay ? { overlayPreview: frontOverlay } : {}) } } : {}),
    ...(manifest.back ? { back: { ...manifest.back, ...(backOverlay ? { overlayPreview: backOverlay } : {}) } } : {}),
  };
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const analysisPath = path.join(manifest.packageDir, "analysis.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifestWithOverlays, manifestPath, analysisPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeJsonArtifact(analysisPath, {
    status: manifestWithOverlays.status === "completed" ? "computed" : "not_computed",
    selectedLightingProfile: manifestWithOverlays.selectedLightingProfile,
    front: manifestWithOverlays.front?.analysis,
    back: manifestWithOverlays.back?.analysis,
    followUpPlan: manifestWithOverlays.followUpPlan,
    calibration: manifestWithOverlays.calibration,
    warnings: manifestWithOverlays.warnings,
  });
  await writeFile(previewReportPath, renderFixedRigV1Report(withPaths), "utf-8");
  return withPaths;
}

async function writeJsonArtifact(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageTag(filePath: string | undefined, alt: string): string {
  if (!filePath) return "<p>Not captured.</p>";
  return `<figure><img src="${escapeHtml(filePath)}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(filePath)}</figcaption></figure>`;
}

function qualityTable(quality: FixedRigQualityMetrics | undefined): string {
  if (!quality) return "<p>Quality metrics not available.</p>";
  return `<table><tbody>
    <tr><th>Mean / max</th><td>${quality.mean} / ${quality.max}</td></tr>
    <tr><th>Sharpness score</th><td>${quality.sharpnessScore}</td></tr>
    <tr><th>Clipped pixels</th><td>${quality.clippedPixelFraction}</td></tr>
    <tr><th>Dark pixels</th><td>${quality.darkPixelFraction}</td></tr>
    <tr><th>Card boundary</th><td>${escapeHtml(quality.cardBoundary.status)} ${escapeHtml(quality.cardBoundary.coverage ?? "")}</td></tr>
    <tr><th>Warnings</th><td>${escapeHtml(quality.warnings.join("; ") || "none")}</td></tr>
  </tbody></table>`;
}

function calibrationTable(profile: FixedRigCalibrationProfile | undefined): string {
  if (!profile) return "<p>Calibration profile unavailable.</p>";
  return `<table><tbody>
    <tr><th>Status</th><td>${escapeHtml(profile.calibrationStatus)}</td></tr>
    <tr><th>isCalibrated</th><td>${escapeHtml(profile.isCalibrated)}</td></tr>
    <tr><th>Exposure / gain / duty</th><td>${escapeHtml(profile.selectedExposureUs)} us / ${escapeHtml(profile.selectedGain)} / ${escapeHtml(profile.selectedLeimacDuty)}%</td></tr>
    <tr><th>Polarity</th><td>Basler LineInverter=${escapeHtml(profile.selectedPolarity.baslerLineInverter)}, Leimac TriggerActivation=${escapeHtml(profile.selectedPolarity.leimacTriggerActivation)}</td></tr>
    <tr><th>Pixel/mm estimate</th><td>${escapeHtml(profile.pixelToMmEstimateStatus)} ${escapeHtml(profile.pixelToMmEstimateX ?? "")} ${escapeHtml(profile.pixelToMmEstimateY ?? "")}</td></tr>
    <tr><th>Lens / lighting calibrated</th><td>${escapeHtml(profile.lensDistortionCalibrated)} / ${escapeHtml(profile.lightingCalibrated)}</td></tr>
    <tr><th>Focus locked by operator</th><td>${escapeHtml(profile.focusLockedByOperator)}</td></tr>
  </tbody></table>`;
}

function roiTable(rois: FixedRigRoiDefinition[] | undefined): string {
  if (!rois?.length) return "<p>ROI definitions unavailable.</p>";
  return `<table><thead><tr><th>ROI</th><th>Type</th><th>Status</th><th>Rect</th></tr></thead><tbody>${rois
    .map((roi) => {
      const rect = roi.rect ? `${roi.rect.x},${roi.rect.y},${roi.rect.width},${roi.rect.height}` : "not_computed";
      return `<tr><td>${escapeHtml(roi.label)}</td><td>${escapeHtml(roi.type)}</td><td>${escapeHtml(roi.status)}</td><td>${escapeHtml(rect)}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

function sideSection(side: FixedRigSideCapture | undefined, title: string): string {
  if (!side) return `<section><h2>${escapeHtml(title)}</h2><p>Not captured.</p></section>`;
  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <div class="grid">
      <section><h3>Dark Control</h3>${imageTag(side.macroPackage.darkControl?.capture.outputFilePath, `${title} dark control`)}</section>
      <section><h3>Synced Macro</h3>${imageTag(side.macroPackage.synced?.capture.outputFilePath, `${title} synced macro`)}</section>
    </div>
    <h3>Overlay Preview</h3>
    ${imageTag(side.overlayPreview?.outputFilePath, `${title} ROI overlay preview`)}
    ${qualityTable(side.quality)}
    <h3>Calibration Profile</h3>
    ${calibrationTable(side.calibrationProfile)}
    <h3>ROIs</h3>
    ${roiTable(side.roiDefinitions)}
    <p><strong>ROI status:</strong> ${escapeHtml(side.analysis.boundaryStatus)} | <strong>Analysis:</strong> ${escapeHtml(side.analysis.status)}</p>
  </section>`;
}

export function renderFixedRigFocusAssistReport(manifest: FixedRigFocusAssistManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Basler Fixed-Rig Focus Assist - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>Basler Fixed-Rig Focus Assist</h1>
  <p class="warn">Manual focus assist only. This is not autofocus, not calibrated macro evidence, not a final grade, not a certificate, and not certified grading.</p>
  ${imageTag(manifest.macroPackage?.synced?.capture.outputFilePath, "Focus assist synced macro")}
  <h2>Overlay Preview</h2>
  ${imageTag(manifest.overlayPreview?.outputFilePath, "Focus assist overlay preview")}
  ${qualityTable(manifest.quality)}
  <h2>Calibration Profile</h2>
  ${calibrationTable(manifest.calibrationProfile)}
  <h2>ROIs</h2>
  ${roiTable(manifest.roiDefinitions)}
  <h2>Operator Guidance</h2>
  <ul>${manifest.operatorGuidance.guidance.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <h2>Dino-Lite Follow-Up</h2>
  <p>${escapeHtml(manifest.suggestedDinoLiteTargets.status)}: ${escapeHtml(manifest.suggestedDinoLiteTargets.reason)}</p>
</main></body></html>
`;
}

export function renderFixedRigOperatorPreviewReport(manifest: FixedRigOperatorPreviewManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Basler Fixed-Rig Operator Preview - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
    .controls span { display: inline-block; border: 1px solid #777; padding: 6px 10px; margin-right: 8px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>Basler Fixed-Rig Operator Preview</h1>
  <p class="warn">Manual preview/focus support only. This is snapshot preview mode, not autofocus, not calibrated evidence, and not AI grading.</p>
  <p class="controls"><span>Start AI-Grading / Continue</span><span>Abort</span><span>Refresh / recapture preview</span><span>Safe Off if Leimac engaged</span></p>
  <h2>Raw Preview Snapshot</h2>
  ${imageTag(manifest.previewCapture?.outputFilePath, "Basler operator preview raw snapshot")}
  <h2>Overlay Preview</h2>
  ${imageTag(manifest.overlayPreview?.outputFilePath, "Basler operator preview overlay")}
  ${qualityTable(manifest.quality)}
  <h2>Calibration Profile</h2>
  ${calibrationTable(manifest.calibrationProfile)}
  <h2>ROIs</h2>
  ${roiTable(manifest.roiDefinitions)}
  <h2>Readiness</h2>
  <p>${escapeHtml(manifest.readiness.status)}. ${escapeHtml(manifest.readiness.uncalibratedGridWarning)}</p>
  <ul>${manifest.readiness.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
</main></body></html>
`;
}

export function renderFixedRigV1Report(manifest: FixedRigV1LocalManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Grader Fixed-Rig V1 Local - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>AI Grader Fixed-Rig V1 Local Workflow</h1>
  <p class="warn">Local/offline uncalibrated evidence package only. No final AI grade, certificate, or certified grading claim is made.</p>
  <p><strong>Evidence roles:</strong> Basler is primary macro measurement/screening evidence. Dino-Lite is optional manual detail confirmation for flagged or operator-requested close-ups.</p>
  ${sideSection(manifest.front, "Front Basler Macro")}
  ${sideSection(manifest.back, "Back Basler Macro")}
  <h2>Lighting Profile</h2>
  <p>${escapeHtml(manifest.selectedLightingProfile)}. Multi-light directional profiles are dry-run only until channel mapping is calibrated.</p>
  <h2>Calibration Profile</h2>
  ${calibrationTable(manifest.calibration.profile)}
  <h2>Next Calibration Needed</h2>
  <ul>${manifest.calibration.requiredNext.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  <h2>Dino-Lite Follow-Up</h2>
  <p>${escapeHtml(manifest.followUpPlan.note)}</p>
</main></body></html>
`;
}

function channelCard(channel: LeimacChannelCharacterizationChannel): string {
  const quadrant = channel.quadrantBrightness
    ? `Brightest quadrant: ${channel.quadrantBrightness.brightestQuadrant}; inference ${channel.quadrantBrightness.directionalInference.status} confidence ${channel.quadrantBrightness.directionalInference.confidence}`
    : "Quadrants not computed.";
  return `<section>
    <h3>${escapeHtml(channel.label)}</h3>
    ${imageTag(channel.capture?.outputFilePath, `${channel.label} synced capture`)}
    ${qualityTable(channel.stats)}
    <p>${escapeHtml(quadrant)}</p>
    <p>${escapeHtml(channel.error ?? "")}</p>
  </section>`;
}

export function renderLeimacChannelCharacterizationReport(manifest: LeimacChannelCharacterizationManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Leimac 8-Channel Characterization - Uncalibrated</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1280px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    img { max-width: 100%; border: 1px solid #aaa; background: #111; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>Leimac 8-Channel Characterization</h1>
  <p class="warn">Low-duty local diagnostic only. Channel physical mapping is ${escapeHtml(manifest.channelToPhysicalMappingStatus)}; no calibrated/final/certified claim is made.</p>
  <p>Duty ${escapeHtml(manifest.dutyPercent)}% (${escapeHtml(manifest.dutySteps)}/1000 steps), exposure ${escapeHtml(manifest.exposureUs)} us, gain ${escapeHtml(manifest.gain)}.</p>
  <h2>Dark Control</h2>
  ${imageTag(manifest.darkControl?.capture.outputFilePath, "Channel characterization dark control")}
  ${qualityTable(manifest.darkControl?.stats)}
  <h2>All Channels</h2>
  ${imageTag(manifest.allOn?.capture?.outputFilePath, "Channel characterization all-on capture")}
  ${qualityTable(manifest.allOn?.stats)}
  <h2>Per-Channel Contact Sheet</h2>
  <div class="grid">${manifest.channels.map(channelCard).join("")}</div>
  <h2>Calibration Profile</h2>
  ${calibrationTable(manifest.calibrationProfile)}
  <h2>Warnings</h2>
  <ul>${manifest.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
</main></body></html>
`;
}
