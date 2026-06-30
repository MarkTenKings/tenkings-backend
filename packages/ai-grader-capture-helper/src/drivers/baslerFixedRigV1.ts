import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { BaslerCaptureStillResult, BaslerOperatorPreviewWindowResult } from "./baslerPylonClient";
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
export const FIXED_RIG_FIXTURE_CALIBRATION_CONFIRMATION = "RUN FIXED RIG ROUGH FIXTURE CALIBRATION";
export const FIXED_RIG_REPEATABILITY_TEST_CONFIRMATION = "RUN FIXED RIG REPEATABILITY TEST";
export const AI_GRADER_FIXED_RIG_V1_CONFIRMATION = "RUN AI GRADER FIXED RIG V1 LOCAL";
export const AI_GRADER_FIXED_RIG_V1_EVIDENCE_PACKAGE_CONFIRMATION = "RUN FIXED RIG V1 UNCALIBRATED EVIDENCE PACKAGE";
export const LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION = "RUN LEIMAC CHANNEL CHARACTERIZATION";
export const FIXED_RIG_V1_EVIDENCE_CLASS = "macro_fixed_rig_v1_uncalibrated";
export const FIXED_RIG_CALIBRATION_PROFILE_VERSION = "fixed-rig-v1-calibration-profile-v0.1";
export const FIXED_RIG_DEFAULT_CARD_WIDTH_MM = 63.5;
export const FIXED_RIG_DEFAULT_CARD_HEIGHT_MM = 88.9;
export const FIXED_RIG_SELECTED_EXPOSURE_US = 45000;
export const FIXED_RIG_SELECTED_GAIN = 0;
export const FIXED_RIG_SELECTED_LEIMAC_DUTY = 1.2;
export const FIXED_RIG_ACTIVE_LIGHTING_PROFILE_FILENAME = "fixed-rig-active-lighting-profile.json";
export const FIXED_RIG_DEFAULT_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type FixedRigDisplayTransform = "none" | "rotate90cw" | "rotate90ccw" | "rotate180";
export type FixedRigOrientationUsed = "raw_landscape_rotated_to_portrait" | "raw_portrait";

export type FixedRigCardSide = "front" | "back";
export type FixedRigReferenceType = "card_dimensions" | "metric_ruler" | "cutting_mat" | "measurement_board" | "certified_target" | "unknown";
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
  pixelToMmOrientationUsed?: FixedRigOrientationUsed;
  pixelToMmConsistency?: {
    status: "not_computed" | "pass" | "warn";
    relativeDifference?: number;
    tolerance: number;
    warning?: string;
  };
  lensDistortionCalibrated: false;
  lightingCalibrated: false;
  focusLockedByOperator: boolean;
  isCalibrated: false;
  calibrationStatus: FixedRigCalibrationStatus;
  warning: string;
}

export interface FixedRigActiveLightingProfile {
  profileId: string;
  profileVersion: "fixed-rig-active-lighting-profile-v0.1";
  selectedDutyPercent: number;
  actualLeimacPwmStep: number;
  selectedChannels: number[];
  profileSource: "operator_preview" | "default" | "cli_override";
  acceptedAt: string;
  resetToDefault: boolean;
  selectedLightingProfileId: typeof ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID;
  selectedPolarity: FixedRigSelectedPolarity;
  persistentLeimacSaved: false;
  note: string;
}

export interface FixedRigFixtureCalibrationProfile {
  profileId: string;
  profileVersion: "fixed-rig-fixture-calibration-profile-v0.1";
  fixtureId?: string;
  fixtureLabel: string;
  status: "draft" | "rough_reference_unvalidated" | "repeatability_checked" | "rejected";
  isCalibrated: false;
  referenceType: FixedRigReferenceType;
  referencePhysicalWidthMm: number;
  referencePhysicalHeightMm: number;
  rawCoordinateFrame: "basler_sensor_pixels";
  displayTransform: FixedRigDisplayTransform;
  displayCoordinateFrame: "ai_grader_card_portrait_display";
  pixelPerMmX?: number;
  pixelPerMmY?: number;
  mmPerPixelX?: number;
  mmPerPixelY?: number;
  pixelToMmConsistency: {
    status: "not_computed" | "pass" | "warn";
    relativeDifference?: number;
    tolerance: number;
    warning?: string;
  };
  expectedCardAspectRatio: number;
  detectedCardAspectRatio?: number;
  lensDistortionStatus: "not_computed";
  homographyStatus: "not_computed";
  lightingProfileUsed: FixedRigActiveLightingProfile;
  exposureUs: number;
  gain: number;
  dutyPercent: number;
  channels: number[];
  createdAt: string;
  operatorAccepted: boolean;
  operatorNotes?: string;
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
  rawRect?: { x: number; y: number; width: number; height: number };
  displayRect?: { x: number; y: number; width: number; height: number };
  rawCoordinateFrame?: "basler_sensor_pixels";
  displayCoordinateFrame?: "ai_grader_card_portrait_display";
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
  overlayAlignment?: FixedRigOverlayAlignmentMetrics;
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
  rawCoordinateFrame?: "basler_sensor_pixels";
  displayTransform?: FixedRigDisplayTransform;
  displayCoordinateFrame?: "ai_grader_card_portrait_display";
  rawEvidenceUnmodified: true;
  overlaysBakedIntoRawEvidence: false;
  note: string;
}

export interface FixedRigDisplayArtifact {
  kind: "portrait_display_image" | "roi_crop";
  outputFilePath: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png";
  imageWidth: number;
  imageHeight: number;
  rawSourceFilePath: string;
  rawSourceSha256?: string;
  rawCoordinateFrame: "basler_sensor_pixels";
  displayTransform: FixedRigDisplayTransform;
  displayCoordinateFrame: "ai_grader_card_portrait_display";
  roiId?: FixedRigRoiDefinition["id"];
  rawRect?: { x: number; y: number; width: number; height: number };
  displayRect?: { x: number; y: number; width: number; height: number };
  rawEvidenceUnmodified: true;
  note: string;
}

export interface FixedRigOverlayAlignmentMetrics {
  templateRect: { x: number; y: number; width: number; height: number };
  detectedBoundaryRect?: { x: number; y: number; width: number; height: number };
  centerOffsetPx?: { x: number; y: number };
  centerOffsetMm?: { x: number; y: number };
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
  detectedAspectRatio?: number;
  expectedAspectRatio: number;
  orientationUsed: FixedRigOrientationUsed;
  overlayAlignmentStatus: "pass" | "warn" | "fail";
  warnings: string[];
}

export interface FixedRigSuggestedDinoLiteTargets {
  status: "not_computed";
  reason: "surface anomaly detector not implemented yet";
  suggestedDinoLiteTargets: [];
}

export interface FixedRigRepeatabilityRun {
  index: number;
  phase: "no_touch" | "remove_replace";
  capture?: BaslerCaptureStillResult;
  quality: FixedRigQualityMetrics;
  centerOffsetPx?: { x: number; y: number };
  centerOffsetMm?: { x: number; y: number };
  boundaryWidth?: number;
  boundaryHeight?: number;
  pixelToMmEstimateX?: number;
  pixelToMmEstimateY?: number;
  sharpnessScore: number;
  mean: number;
  clippedPixelFraction: number;
  overlayAlignmentStatus: "pass" | "warn" | "fail" | "not_computed";
}

export interface FixedRigRepeatabilitySummary {
  status: "not_computed" | "computed";
  repeatabilityStatus: "pass" | "warn" | "fail";
  runCount: number;
  phase: "no_touch" | "remove_replace" | "combined";
  centerOffsetMeanPx?: number;
  centerOffsetMaxPx?: number;
  centerOffsetMeanMm?: number;
  centerOffsetMaxMm?: number;
  boundaryWidthVariationPx?: number;
  boundaryHeightVariationPx?: number;
  pixelToMmVariation?: number;
  sharpnessVariation?: number;
  meanBrightnessVariation?: number;
  clippingMax?: number;
  overlayAlignmentCounts: { pass: number; warn: number; fail: number; notComputed: number };
  warnings: string[];
}

export interface FixedRigRepeatabilityManifest {
  packageId: string;
  packageDir: string;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
  status: "planned" | "completed" | "aborted";
  phase: "no_touch" | "remove_replace";
  requestedCaptureCount: number;
  activeLightingProfile: FixedRigActiveLightingProfile;
  fixtureCalibrationProfile?: FixedRigFixtureCalibrationProfile;
  runs: FixedRigRepeatabilityRun[];
  summary: FixedRigRepeatabilitySummary;
  safety: {
    localOnly: true;
    diagnosticOnly: true;
    safeOffBeforeEachCapture: boolean;
    safeOffAfterEachCapture: boolean;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
    finalLightOffConfirmedByMark: boolean;
  };
  warning: string;
}

export interface FixedRigDiagnosticElement {
  status: "computed_diagnostic" | "not_computed" | "insufficient_evidence";
  score?: number;
  confidence: number;
  metrics: Record<string, unknown>;
  warnings: string[];
}

export interface FixedRigSurfaceAnomalyCandidate {
  candidateId: string;
  side: FixedRigCardSide;
  displayRect?: { x: number; y: number; width: number; height: number };
  rawRect?: { x: number; y: number; width: number; height: number };
  sourceChannels: number[];
  severityProxy: number;
  needsDinoLiteFollowUp: boolean;
}

export interface FixedRigSurfaceAnalysis {
  detectorId: "preliminary_surface_anomaly_detector_v0";
  status: "not_computed" | "computed_diagnostic" | "insufficient_evidence";
  registration: {
    status: "assumed_fixed_rig" | "not_computed";
    note: string;
  };
  perChannelStats: Array<{
    channel: number;
    mean?: number;
    max?: number;
    clippedPixelFraction?: number;
    darkPixelFraction?: number;
    sharpnessScore?: number;
    anomalyProxyMetric?: number;
    portraitDisplayImage?: FixedRigDisplayArtifact;
  }>;
  heatmap?: FixedRigDisplayArtifact;
  glareMask?: FixedRigDisplayArtifact;
  candidates: FixedRigSurfaceAnomalyCandidate[];
  warnings: string[];
}

export interface FixedRigDiagnosticGradingResult {
  status: "computed_diagnostic" | "not_computed" | "insufficient_evidence";
  diagnosticOnly: true;
  finalGradeComputed: false;
  certifiedClaim: false;
  calibrationStatus: "rough_reference_unvalidated" | "uncalibrated" | "repeatability_checked";
  centering: FixedRigDiagnosticElement;
  corners: Record<"topLeft" | "topRight" | "bottomRight" | "bottomLeft", FixedRigDiagnosticElement>;
  edges: Record<"top" | "right" | "bottom" | "left", FixedRigDiagnosticElement>;
  surface: FixedRigDiagnosticElement & { surfaceAnalysis?: FixedRigSurfaceAnalysis };
  warnings: string[];
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
  status: "planned" | "preview_captured" | "accepted" | "aborted" | "closed";
  mode: "windows_live_stream_preview";
  previewImplementationType: "windows_winforms_pylon_live_stream";
  livePreview?: BaslerOperatorPreviewWindowResult;
  operatorModeRequired: true;
  startAiGradingAutomatically: false;
  controls: {
    startAiGradingContinue: "operator_decision_only";
    abort: "operator_decision_only";
    pauseResume: "operator_control";
    refreshRateStatus: "visible_in_window";
    safeOffAvailableIfLeimacEngaged: true;
  };
  previewCapture?: BaslerCaptureStillResult;
  quality?: FixedRigQualityMetrics;
  roiDefinitions: FixedRigRoiDefinition[];
  overlayPreview?: FixedRigOverlayArtifact;
  displayImage?: FixedRigDisplayArtifact;
  calibrationProfile: FixedRigCalibrationProfile;
  acceptedLightingProfile?: FixedRigActiveLightingProfile;
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
  displayImage?: FixedRigDisplayArtifact;
  calibrationProfile: FixedRigCalibrationProfile;
  activeLightingProfile: FixedRigActiveLightingProfile;
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
  displayImage?: FixedRigDisplayArtifact;
  roiCrops?: FixedRigDisplayArtifact[];
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
  activeLightingProfile: FixedRigActiveLightingProfile;
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

function normalizeChannelList(channels: readonly number[] | undefined): number[] {
  const unique = Array.from(new Set((channels ?? FIXED_RIG_DEFAULT_CHANNELS).map((channel) => Number(channel)))).filter(
    (channel) => Number.isInteger(channel) && channel >= 1 && channel <= 8
  );
  return unique.length ? unique.sort((a, b) => a - b) : [...FIXED_RIG_DEFAULT_CHANNELS];
}

export function buildFixedRigActiveLightingProfile(input: {
  selectedDutyPercent?: number;
  selectedChannels?: readonly number[];
  profileSource?: FixedRigActiveLightingProfile["profileSource"];
  acceptedAt?: string;
  resetToDefault?: boolean;
} = {}): FixedRigActiveLightingProfile {
  const selectedDutyPercent = normalizeLeimacIdmuDutyPercent(input.selectedDutyPercent ?? FIXED_RIG_SELECTED_LEIMAC_DUTY);
  return {
    profileId: "fixed-rig-active-lighting-profile",
    profileVersion: "fixed-rig-active-lighting-profile-v0.1",
    selectedDutyPercent,
    actualLeimacPwmStep: leimacIdmuDutyPercentToSteps(selectedDutyPercent),
    selectedChannels: normalizeChannelList(input.selectedChannels),
    profileSource: input.profileSource ?? "default",
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
    resetToDefault: input.resetToDefault ?? false,
    selectedLightingProfileId: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    selectedPolarity: {
      baslerLineInverter: true,
      leimacTriggerActivation: "LevelLow",
    },
    persistentLeimacSaved: false,
    note:
      "Software-side fixed-rig active lighting profile only. Leimac hardware is still safe-offed on exit; no persistent Leimac User Set is saved.",
  };
}

function fixedRigProfileStoreDir(outputDir: string): string {
  const allowed = assertFixedRigOutputDirAllowed(outputDir);
  const base = path.basename(path.normalize(allowed)).toLowerCase();
  return base.startsWith("fixed-rig") ? path.dirname(allowed) : allowed;
}

export function fixedRigActiveLightingProfilePath(outputDir: string): string {
  return path.join(fixedRigProfileStoreDir(outputDir), FIXED_RIG_ACTIVE_LIGHTING_PROFILE_FILENAME);
}

export async function readFixedRigActiveLightingProfile(outputDir: string): Promise<FixedRigActiveLightingProfile | null> {
  try {
    const parsed = JSON.parse(await readFile(fixedRigActiveLightingProfilePath(outputDir), "utf-8")) as Partial<FixedRigActiveLightingProfile>;
    if (!Number.isFinite(parsed.selectedDutyPercent) || !Array.isArray(parsed.selectedChannels)) return null;
    return buildFixedRigActiveLightingProfile({
      selectedDutyPercent: parsed.selectedDutyPercent,
      selectedChannels: parsed.selectedChannels,
      profileSource: parsed.profileSource === "operator_preview" || parsed.profileSource === "cli_override" ? parsed.profileSource : "default",
      acceptedAt: parsed.acceptedAt,
      resetToDefault: parsed.resetToDefault,
    });
  } catch {
    return null;
  }
}

export async function writeFixedRigActiveLightingProfile(outputDir: string, profile: FixedRigActiveLightingProfile): Promise<string> {
  const filePath = fixedRigActiveLightingProfilePath(outputDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonArtifact(filePath, profile);
  return filePath;
}

export async function resolveFixedRigActiveLightingProfile(input: {
  outputDir: string;
  cliDuty?: number;
  cliChannels?: readonly number[];
  resetToDefault?: boolean;
}): Promise<FixedRigActiveLightingProfile> {
  if (input.resetToDefault) return buildFixedRigActiveLightingProfile({ profileSource: "default", resetToDefault: true });
  if (input.cliDuty != null) {
    return buildFixedRigActiveLightingProfile({
      selectedDutyPercent: input.cliDuty,
      selectedChannels: input.cliChannels,
      profileSource: "cli_override",
    });
  }
  return (await readFixedRigActiveLightingProfile(input.outputDir)) ?? buildFixedRigActiveLightingProfile({ profileSource: "default" });
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
  pixelToMmOrientationUsed?: FixedRigOrientationUsed;
  pixelToMmConsistency?: FixedRigCalibrationProfile["pixelToMmConsistency"];
} {
  if (boundary?.status !== "detected" || !boundary.width || !boundary.height) {
    return {
      pixelToMmEstimateStatus: "not_computed",
      pixelToMmConsistency: { status: "not_computed", tolerance: 0.1 },
    };
  }
  const rawLandscape = boundary.width >= boundary.height;
  const rawWidthMm = rawLandscape ? cardPhysicalHeightMm : cardPhysicalWidthMm;
  const rawHeightMm = rawLandscape ? cardPhysicalWidthMm : cardPhysicalHeightMm;
  const x = roundMetric(rawWidthMm / boundary.width, 6);
  const y = roundMetric(rawHeightMm / boundary.height, 6);
  const relativeDifference = roundMetric(Math.abs(x - y) / Math.max((x + y) / 2, 0.000001), 6);
  const tolerance = 0.1;
  const pass = relativeDifference <= tolerance;
  return {
    pixelToMmEstimateX: x,
    pixelToMmEstimateY: y,
    pixelToMmEstimateStatus: "estimated_uncalibrated",
    pixelToMmOrientationUsed: rawLandscape ? "raw_landscape_rotated_to_portrait" : "raw_portrait",
    pixelToMmConsistency: {
      status: pass ? "pass" : "warn",
      relativeDifference,
      tolerance,
      ...(pass
        ? {}
        : {
            warning:
              "Orientation-corrected X/Y pixel-to-mm estimates diverge; keep profile uncalibrated and review card boundary/display mapping.",
          }),
    },
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

export function buildFixedRigFixtureCalibrationProfile(input: {
  profileId: string;
  fixtureId?: string;
  fixtureLabel?: string;
  status?: FixedRigFixtureCalibrationProfile["status"];
  referenceType?: FixedRigReferenceType;
  referencePhysicalWidthMm?: number;
  referencePhysicalHeightMm?: number;
  rawImageWidth?: number;
  rawImageHeight?: number;
  displayTransform?: FixedRigDisplayTransform;
  cardBoundary?: FixedRigCardBoundary;
  activeLightingProfile?: FixedRigActiveLightingProfile;
  exposureUs?: number;
  gain?: number;
  operatorAccepted?: boolean;
  operatorNotes?: string;
  createdAt?: string;
}): FixedRigFixtureCalibrationProfile {
  const referencePhysicalWidthMm = input.referencePhysicalWidthMm ?? FIXED_RIG_DEFAULT_CARD_WIDTH_MM;
  const referencePhysicalHeightMm = input.referencePhysicalHeightMm ?? FIXED_RIG_DEFAULT_CARD_HEIGHT_MM;
  const width = input.cardBoundary?.width;
  const height = input.cardBoundary?.height;
  const displayTransform =
    input.displayTransform ??
    fixedRigDisplayTransformForDimensions(input.rawImageWidth ?? 2448, input.rawImageHeight ?? 2048);
  const isRawLandscape = width !== undefined && height !== undefined && width >= height;
  const physicalX = isRawLandscape ? Math.max(referencePhysicalWidthMm, referencePhysicalHeightMm) : Math.min(referencePhysicalWidthMm, referencePhysicalHeightMm);
  const physicalY = isRawLandscape ? Math.min(referencePhysicalWidthMm, referencePhysicalHeightMm) : Math.max(referencePhysicalWidthMm, referencePhysicalHeightMm);
  const mmPerPixelX = width && width > 0 ? roundMetric(physicalX / width, 6) : undefined;
  const mmPerPixelY = height && height > 0 ? roundMetric(physicalY / height, 6) : undefined;
  const pixelPerMmX = mmPerPixelX ? roundMetric(1 / mmPerPixelX, 4) : undefined;
  const pixelPerMmY = mmPerPixelY ? roundMetric(1 / mmPerPixelY, 4) : undefined;
  const tolerance = 0.08;
  const relativeDifference =
    mmPerPixelX && mmPerPixelY ? roundMetric(Math.abs(mmPerPixelX - mmPerPixelY) / Math.max(mmPerPixelX, mmPerPixelY), 4) : undefined;
  const consistencyStatus = relativeDifference === undefined ? "not_computed" : relativeDifference <= tolerance ? "pass" : "warn";
  const activeLightingProfile = input.activeLightingProfile ?? buildFixedRigActiveLightingProfile();
  const referenceType = input.referenceType ?? "card_dimensions";
  const status = input.status ?? (referenceType === "certified_target" ? "draft" : "rough_reference_unvalidated");
  return {
    profileId: input.profileId,
    profileVersion: "fixed-rig-fixture-calibration-profile-v0.1",
    ...(input.fixtureId ? { fixtureId: input.fixtureId } : {}),
    fixtureLabel: input.fixtureLabel ?? "operator-built-fixed-position-v1-fixture",
    status,
    isCalibrated: false,
    referenceType,
    referencePhysicalWidthMm,
    referencePhysicalHeightMm,
    rawCoordinateFrame: "basler_sensor_pixels",
    displayTransform,
    displayCoordinateFrame: "ai_grader_card_portrait_display",
    ...(pixelPerMmX !== undefined ? { pixelPerMmX } : {}),
    ...(pixelPerMmY !== undefined ? { pixelPerMmY } : {}),
    ...(mmPerPixelX !== undefined ? { mmPerPixelX } : {}),
    ...(mmPerPixelY !== undefined ? { mmPerPixelY } : {}),
    pixelToMmConsistency: {
      status: consistencyStatus,
      ...(relativeDifference !== undefined ? { relativeDifference } : {}),
      tolerance,
      ...(consistencyStatus === "warn"
        ? { warning: "Rough reference X/Y pixel scale estimates diverge; do not treat this profile as calibrated." }
        : {}),
    },
    expectedCardAspectRatio: roundMetric(Math.max(referencePhysicalWidthMm, referencePhysicalHeightMm) / Math.min(referencePhysicalWidthMm, referencePhysicalHeightMm), 6),
    ...(width && height ? { detectedCardAspectRatio: roundMetric(Math.max(width, height) / Math.min(width, height), 6) } : {}),
    lensDistortionStatus: "not_computed",
    homographyStatus: "not_computed",
    lightingProfileUsed: activeLightingProfile,
    exposureUs: input.exposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    gain: input.gain ?? FIXED_RIG_SELECTED_GAIN,
    dutyPercent: activeLightingProfile.selectedDutyPercent,
    channels: activeLightingProfile.selectedChannels,
    createdAt: input.createdAt ?? new Date().toISOString(),
    operatorAccepted: input.operatorAccepted ?? false,
    ...(input.operatorNotes ? { operatorNotes: input.operatorNotes } : {}),
    warning:
      referenceType === "certified_target"
        ? "Certified target metadata is recorded, but this PR still keeps isCalibrated=false until validated calibration math and acceptance tests exist."
        : "Rough fixture calibration only. Reference is not a certified machine-vision target; isCalibrated remains false.",
  };
}

function distancePx(point?: { x: number; y: number }): number | undefined {
  return point ? Math.sqrt(point.x * point.x + point.y * point.y) : undefined;
}

function range(values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  if (finite.length < 2) return undefined;
  return roundMetric(Math.max(...finite) - Math.min(...finite), 4);
}

function mean(values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  if (!finite.length) return undefined;
  return roundMetric(finite.reduce((sum, value) => sum + value, 0) / finite.length, 4);
}

export function buildFixedRigRepeatabilityRun(input: {
  index: number;
  phase: FixedRigRepeatabilityRun["phase"];
  capture?: BaslerCaptureStillResult;
  quality: FixedRigQualityMetrics;
}): FixedRigRepeatabilityRun {
  const pixelToMm = buildFixedRigPixelToMmEstimate(input.quality.cardBoundary);
  const centerOffsetPx = input.quality.overlayAlignment?.centerOffsetPx;
  const centerOffsetMm =
    centerOffsetPx && pixelToMm.pixelToMmEstimateX && pixelToMm.pixelToMmEstimateY
      ? { x: roundMetric(centerOffsetPx.x * pixelToMm.pixelToMmEstimateX, 4), y: roundMetric(centerOffsetPx.y * pixelToMm.pixelToMmEstimateY, 4) }
      : undefined;
  return {
    index: input.index,
    phase: input.phase,
    ...(input.capture ? { capture: input.capture } : {}),
    quality: input.quality,
    ...(centerOffsetPx ? { centerOffsetPx } : {}),
    ...(centerOffsetMm ? { centerOffsetMm } : {}),
    ...(input.quality.cardBoundary.width !== undefined ? { boundaryWidth: input.quality.cardBoundary.width } : {}),
    ...(input.quality.cardBoundary.height !== undefined ? { boundaryHeight: input.quality.cardBoundary.height } : {}),
    ...(pixelToMm.pixelToMmEstimateX !== undefined ? { pixelToMmEstimateX: pixelToMm.pixelToMmEstimateX } : {}),
    ...(pixelToMm.pixelToMmEstimateY !== undefined ? { pixelToMmEstimateY: pixelToMm.pixelToMmEstimateY } : {}),
    sharpnessScore: input.quality.sharpnessScore,
    mean: input.quality.mean,
    clippedPixelFraction: input.quality.clippedPixelFraction,
    overlayAlignmentStatus: input.quality.overlayAlignment?.overlayAlignmentStatus ?? "not_computed",
  };
}

export function buildFixedRigRepeatabilitySummary(runs: FixedRigRepeatabilityRun[], phase: FixedRigRepeatabilitySummary["phase"]): FixedRigRepeatabilitySummary {
  const centerPx = runs.map((run) => distancePx(run.centerOffsetPx));
  const centerMm = runs.map((run) => distancePx(run.centerOffsetMm));
  const pixelScaleValues = runs.flatMap((run) => [run.pixelToMmEstimateX, run.pixelToMmEstimateY]);
  const overlayAlignmentCounts = {
    pass: runs.filter((run) => run.overlayAlignmentStatus === "pass").length,
    warn: runs.filter((run) => run.overlayAlignmentStatus === "warn").length,
    fail: runs.filter((run) => run.overlayAlignmentStatus === "fail").length,
    notComputed: runs.filter((run) => run.overlayAlignmentStatus === "not_computed").length,
  };
  const warnings: string[] = [];
  const centerOffsetMaxPx = range([0, ...centerPx]) ?? mean(centerPx);
  const boundaryWidthVariationPx = range(runs.map((run) => run.boundaryWidth));
  const boundaryHeightVariationPx = range(runs.map((run) => run.boundaryHeight));
  const pixelToMmVariation = range(pixelScaleValues);
  const sharpnessVariation = range(runs.map((run) => run.sharpnessScore));
  const meanBrightnessVariation = range(runs.map((run) => run.mean));
  const clippingMax = runs.length ? roundMetric(Math.max(...runs.map((run) => run.clippedPixelFraction)), 6) : undefined;
  if (runs.length < 2) warnings.push("Repeatability requires at least two captures for variation metrics.");
  if (overlayAlignmentCounts.fail > 0 || overlayAlignmentCounts.notComputed > 0) warnings.push("One or more captures had failed or missing overlay alignment.");
  if ((centerOffsetMaxPx ?? 0) > 20) warnings.push("Center offset variation is above the rough fixed-fixture warning threshold.");
  if ((boundaryWidthVariationPx ?? 0) > 30 || (boundaryHeightVariationPx ?? 0) > 30) warnings.push("Detected boundary size variation is above the rough fixed-fixture warning threshold.");
  if ((clippingMax ?? 0) > 0.02) warnings.push("At least one repeatability capture exceeded the soft clipping target.");
  const repeatabilityStatus = warnings.some((warning) => /failed|missing/i.test(warning)) ? "fail" : warnings.length ? "warn" : "pass";
  return {
    status: runs.length ? "computed" : "not_computed",
    repeatabilityStatus,
    runCount: runs.length,
    phase,
    ...(mean(centerPx) !== undefined ? { centerOffsetMeanPx: mean(centerPx) } : {}),
    ...(centerOffsetMaxPx !== undefined ? { centerOffsetMaxPx: roundMetric(centerOffsetMaxPx, 4) } : {}),
    ...(mean(centerMm) !== undefined ? { centerOffsetMeanMm: mean(centerMm) } : {}),
    ...(range([0, ...centerMm]) !== undefined ? { centerOffsetMaxMm: range([0, ...centerMm]) } : {}),
    ...(boundaryWidthVariationPx !== undefined ? { boundaryWidthVariationPx } : {}),
    ...(boundaryHeightVariationPx !== undefined ? { boundaryHeightVariationPx } : {}),
    ...(pixelToMmVariation !== undefined ? { pixelToMmVariation } : {}),
    ...(sharpnessVariation !== undefined ? { sharpnessVariation } : {}),
    ...(meanBrightnessVariation !== undefined ? { meanBrightnessVariation } : {}),
    ...(clippingMax !== undefined ? { clippingMax } : {}),
    overlayAlignmentCounts,
    warnings,
  };
}

function diagnosticElementNotComputed(reason: string): FixedRigDiagnosticElement {
  return { status: "not_computed", confidence: 0, metrics: {}, warnings: [reason] };
}

export function buildFixedRigSurfaceAnalysis(input: {
  side: FixedRigCardSide;
  channels?: Array<{ channel: number; stats?: FixedRigQualityMetrics; displayImage?: FixedRigDisplayArtifact }>;
  warnings?: string[];
}): FixedRigSurfaceAnalysis {
  const perChannelStats = (input.channels ?? []).map((channel) => ({
    channel: channel.channel,
    ...(channel.stats
      ? {
          mean: channel.stats.mean,
          max: channel.stats.max,
          clippedPixelFraction: channel.stats.clippedPixelFraction,
          darkPixelFraction: channel.stats.darkPixelFraction,
          sharpnessScore: channel.stats.sharpnessScore,
          anomalyProxyMetric: roundMetric(channel.stats.sharpnessScore * Math.max(0, 1 - channel.stats.clippedPixelFraction), 4),
        }
      : {}),
    ...(channel.displayImage ? { portraitDisplayImage: channel.displayImage } : {}),
  }));
  return {
    detectorId: "preliminary_surface_anomaly_detector_v0",
    status: perChannelStats.length >= 8 ? "not_computed" : "insufficient_evidence",
    registration: {
      status: "assumed_fixed_rig",
      note: "Per-channel images are assumed aligned by the fixed fixture; no explicit registration or homography is computed in PR #39.",
    },
    perChannelStats,
    candidates: [],
    warnings: [
      "Surface anomaly detector is preliminary; no final surface grade is computed.",
      "No robust defect candidate detector is accepted yet, so candidate list remains empty.",
      ...(input.warnings ?? []),
    ],
  };
}

export function buildFixedRigDiagnosticGradingResult(input: {
  side?: FixedRigCardSide;
  quality?: FixedRigQualityMetrics;
  roiDefinitions?: FixedRigRoiDefinition[];
  fixtureCalibrationProfile?: FixedRigFixtureCalibrationProfile;
  repeatabilitySummary?: FixedRigRepeatabilitySummary;
  surfaceAnalysis?: FixedRigSurfaceAnalysis;
}): FixedRigDiagnosticGradingResult {
  const warnings = [
    "Diagnostic-only fixed-rig analysis. No final grade, certificate, or certified grading claim is made.",
    ...(input.fixtureCalibrationProfile?.isCalibrated === false ? ["Fixture profile is not calibrated."] : ["No fixture calibration profile supplied."]),
    ...(input.repeatabilitySummary && input.repeatabilitySummary.repeatabilityStatus !== "pass"
      ? [`Repeatability is ${input.repeatabilitySummary.repeatabilityStatus}.`]
      : []),
    ...(input.quality?.warnings ?? []),
  ];
  const alignment = input.quality?.overlayAlignment;
  const boundary = input.quality?.cardBoundary;
  const left = alignment?.marginLeft;
  const right = alignment?.marginRight;
  const top = alignment?.marginTop;
  const bottom = alignment?.marginBottom;
  const lrTotal = left !== undefined && right !== undefined ? left + right : undefined;
  const tbTotal = top !== undefined && bottom !== undefined ? top + bottom : undefined;
  const centering =
    boundary?.status === "detected" && lrTotal && tbTotal
      ? {
          status: "computed_diagnostic" as const,
          confidence: alignment?.overlayAlignmentStatus === "pass" ? 0.65 : 0.45,
          metrics: {
            leftPx: left,
            rightPx: right,
            topPx: top,
            bottomPx: bottom,
            leftRightPercent: roundMetric((Math.min(left ?? 0, right ?? 0) / lrTotal) * 100, 2),
            topBottomPercent: roundMetric((Math.min(top ?? 0, bottom ?? 0) / tbTotal) * 100, 2),
            overlayAlignmentStatus: alignment?.overlayAlignmentStatus,
          },
          warnings: ["Centering is based on rough detected boundary/template margins and is diagnostic only."],
        }
      : diagnosticElementNotComputed("Card boundary/margins unavailable; centering diagnostic not computed.");
  const roiById = new Map((input.roiDefinitions ?? []).map((roi) => [roi.id, roi]));
  const roiMetric = (roiId: FixedRigRoiDefinition["id"], label: string): FixedRigDiagnosticElement => {
    const roi = roiById.get(roiId);
    if (!roi || roi.status !== "computed") return diagnosticElementNotComputed(`${label} ROI unavailable.`);
    return {
      status: "computed_diagnostic",
      confidence: input.quality?.cardBoundary.status === "detected" ? 0.35 : 0.15,
      metrics: {
        roiId,
        rect: roi.rect,
        rawRect: roi.rawRect,
        displayRect: roi.displayRect,
        sharpnessProxy: input.quality?.sharpnessScore,
        clippedPixelFraction: input.quality?.clippedPixelFraction,
        darkPixelFraction: input.quality?.darkPixelFraction,
      },
      warnings: [`${label} ROI proxy metrics are preliminary and not a production corner/edge grade.`],
    };
  };
  const surfaceWarnings = input.surfaceAnalysis?.warnings ?? ["Surface analysis not supplied."];
  return {
    status: input.quality ? "computed_diagnostic" : "not_computed",
    diagnosticOnly: true,
    finalGradeComputed: false,
    certifiedClaim: false,
    calibrationStatus:
      input.repeatabilitySummary?.repeatabilityStatus === "pass"
        ? "repeatability_checked"
        : input.fixtureCalibrationProfile?.status === "rough_reference_unvalidated"
          ? "rough_reference_unvalidated"
          : "uncalibrated",
    centering,
    corners: {
      topLeft: roiMetric("top-left-corner", "Top-left corner"),
      topRight: roiMetric("top-right-corner", "Top-right corner"),
      bottomRight: roiMetric("bottom-right-corner", "Bottom-right corner"),
      bottomLeft: roiMetric("bottom-left-corner", "Bottom-left corner"),
    },
    edges: {
      top: roiMetric("top-edge", "Top edge"),
      right: roiMetric("right-edge", "Right edge"),
      bottom: roiMetric("bottom-edge", "Bottom edge"),
      left: roiMetric("left-edge", "Left edge"),
    },
    surface: {
      status: input.surfaceAnalysis?.status === "computed_diagnostic" ? "computed_diagnostic" : "not_computed",
      confidence: input.surfaceAnalysis?.status === "computed_diagnostic" ? 0.25 : 0,
      metrics: {
        detectorId: input.surfaceAnalysis?.detectorId ?? "preliminary_surface_anomaly_detector_v0",
        candidateCount: input.surfaceAnalysis?.candidates.length ?? 0,
        perChannelCount: input.surfaceAnalysis?.perChannelStats.length ?? 0,
      },
      warnings: surfaceWarnings,
      ...(input.surfaceAnalysis ? { surfaceAnalysis: input.surfaceAnalysis } : {}),
    },
    warnings,
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
  const overlayAlignment = buildFixedRigOverlayAlignmentMetrics({
    imageWidth: width,
    imageHeight: height,
    boundary,
    pixelToMm: buildFixedRigPixelToMmEstimate(boundary),
  });
  warnings.push(...overlayAlignment.warnings);
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
      status:
        boundary.status === "detected" && coverage >= 0.35 && coverage <= 0.95 && overlayAlignment.overlayAlignmentStatus !== "fail"
          ? "acceptable_for_smoke"
          : "warning",
      ...(boundary.status === "detected" ? { cardCoverageEstimate: roundMetric(coverage, 6) } : {}),
      warnings: warnings.filter((warning) => /boundary|coverage|framing|tray|height/i.test(warning)),
    },
    overlayAlignment,
    focus: {
      status: sharpnessScore < 20 ? "warning" : "manual_review",
      sharpnessScore,
      recommendation:
        "Manual focus assist only: repeat after mechanical focus/height changes and prefer the setting where sharpness improves then stabilizes.",
    },
    warnings,
  };
}

export function fixedRigDisplayTransformForDimensions(width: number, height: number): FixedRigDisplayTransform {
  return width > height ? "rotate90cw" : "none";
}

export function transformRectForDisplay(
  rect: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  transform: FixedRigDisplayTransform
): { x: number; y: number; width: number; height: number } {
  if (transform === "none") return { ...rect };
  if (transform === "rotate180") {
    return { x: imageWidth - rect.x - rect.width, y: imageHeight - rect.y - rect.height, width: rect.width, height: rect.height };
  }
  if (transform === "rotate90ccw") {
    return { x: rect.y, y: imageWidth - rect.x - rect.width, width: rect.height, height: rect.width };
  }
  return { x: imageHeight - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
}

export function buildFixedRigTemplateRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const guideHeight = Math.round(height * 0.82);
  const guideWidth = Math.round(guideHeight * (2.5 / 3.5));
  return {
    x: Math.round((width - guideWidth) / 2),
    y: Math.round((height - guideHeight) / 2),
    width: guideWidth,
    height: guideHeight,
  };
}

export function buildFixedRigOverlayAlignmentMetrics(input: {
  imageWidth: number;
  imageHeight: number;
  boundary?: FixedRigCardBoundary;
  pixelToMm?: ReturnType<typeof buildFixedRigPixelToMmEstimate>;
}): FixedRigOverlayAlignmentMetrics {
  const templateRect = buildFixedRigTemplateRect(input.imageWidth, input.imageHeight);
  const rawLandscape = input.imageWidth > input.imageHeight;
  const warnings: string[] = [];
  const boundary = input.boundary;
  if (boundary?.status !== "detected" || boundary.x == null || boundary.y == null || !boundary.width || !boundary.height) {
    warnings.push("Card boundary was not detected; overlay alignment cannot be audited.");
    return {
      templateRect,
      expectedAspectRatio: roundMetric(2.5 / 3.5, 6),
      orientationUsed: rawLandscape ? "raw_landscape_rotated_to_portrait" : "raw_portrait",
      overlayAlignmentStatus: "fail",
      warnings,
    };
  }
  const detectedBoundaryRect = { x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height };
  const templateCenter = { x: templateRect.x + templateRect.width / 2, y: templateRect.y + templateRect.height / 2 };
  const detectedCenter = { x: boundary.x + boundary.width / 2, y: boundary.y + boundary.height / 2 };
  const centerOffsetPx = {
    x: roundMetric(detectedCenter.x - templateCenter.x, 2),
    y: roundMetric(detectedCenter.y - templateCenter.y, 2),
  };
  const centerOffsetMm =
    input.pixelToMm?.pixelToMmEstimateX && input.pixelToMm.pixelToMmEstimateY
      ? {
          x: roundMetric(centerOffsetPx.x * input.pixelToMm.pixelToMmEstimateX, 3),
          y: roundMetric(centerOffsetPx.y * input.pixelToMm.pixelToMmEstimateY, 3),
        }
      : undefined;
  const marginLeft = boundary.x;
  const marginTop = boundary.y;
  const marginRight = input.imageWidth - (boundary.x + boundary.width);
  const marginBottom = input.imageHeight - (boundary.y + boundary.height);
  const detectedAspectRatio = roundMetric(boundary.width / boundary.height, 6);
  const expectedAspectRatio = roundMetric(rawLandscape ? 3.5 / 2.5 : 2.5 / 3.5, 6);
  const aspectDelta = Math.abs(detectedAspectRatio - expectedAspectRatio) / expectedAspectRatio;
  const minMargin = Math.min(marginLeft, marginRight, marginTop, marginBottom);
  if (minMargin <= 5) warnings.push("Card boundary touches or nearly touches the image frame; add margin before calibration.");
  if (aspectDelta > 0.2) warnings.push("Detected card aspect ratio does not match the expected card orientation; review boundary/display mapping.");
  if (Math.abs(centerOffsetPx.x) > input.imageWidth * 0.18 || Math.abs(centerOffsetPx.y) > input.imageHeight * 0.18) {
    warnings.push("Detected card boundary is substantially off-center from the operator template.");
  }
  return {
    templateRect,
    detectedBoundaryRect,
    centerOffsetPx,
    ...(centerOffsetMm ? { centerOffsetMm } : {}),
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    detectedAspectRatio,
    expectedAspectRatio,
    orientationUsed: rawLandscape ? "raw_landscape_rotated_to_portrait" : "raw_portrait",
    overlayAlignmentStatus: warnings.length ? "warn" : "pass",
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
    rawCoordinateFrame: "basler_sensor_pixels",
  }));
}

export function addFixedRigDisplayRects(
  rois: FixedRigRoiDefinition[],
  imageWidth: number,
  imageHeight: number,
  transform = fixedRigDisplayTransformForDimensions(imageWidth, imageHeight)
): FixedRigRoiDefinition[] {
  return rois.map((roi) => {
    if (roi.status !== "computed" || !roi.rect) return roi;
    const rawRect = roi.rect;
    return {
      ...roi,
      rawRect,
      displayRect: transformRectForDisplay(rawRect, imageWidth, imageHeight, transform),
      rawCoordinateFrame: "basler_sensor_pixels",
      displayCoordinateFrame: "ai_grader_card_portrait_display",
    };
  });
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

export function transformQualityForDisplay(
  quality: FixedRigQualityMetrics | undefined,
  transform: FixedRigDisplayTransform
): FixedRigQualityMetrics | undefined {
  if (!quality || transform === "none") return quality;
  const displayWidth = transform === "rotate90cw" || transform === "rotate90ccw" ? quality.height : quality.width;
  const displayHeight = transform === "rotate90cw" || transform === "rotate90ccw" ? quality.width : quality.height;
  const boundary = quality.cardBoundary;
  const displayBoundary =
    boundary.status === "detected" && boundary.x != null && boundary.y != null && boundary.width && boundary.height
      ? {
          ...boundary,
          ...transformRectForDisplay(
            { x: boundary.x, y: boundary.y, width: boundary.width, height: boundary.height },
            quality.width,
            quality.height,
            transform
          ),
        }
      : boundary;
  return {
    ...quality,
    width: displayWidth,
    height: displayHeight,
    cardBoundary: displayBoundary,
    overlayAlignment: buildFixedRigOverlayAlignmentMetrics({
      imageWidth: displayWidth,
      imageHeight: displayHeight,
      boundary: displayBoundary,
      pixelToMm: buildFixedRigPixelToMmEstimate(displayBoundary),
    }),
  };
}

function roisForDisplayOverlay(rois: FixedRigRoiDefinition[] | undefined): FixedRigRoiDefinition[] | undefined {
  return rois?.map((roi) => (roi.displayRect ? { ...roi, rect: roi.displayRect } : roi));
}

export async function createFixedRigDisplayImage(input: {
  sourceImagePath: string;
  outputDir: string;
  filePrefix: string;
  transform?: FixedRigDisplayTransform;
  rawSourceSha256?: string;
}): Promise<FixedRigDisplayArtifact> {
  await mkdir(input.outputDir, { recursive: true });
  const metadata = await sharp(input.sourceImagePath).metadata();
  const rawWidth = metadata.width ?? 0;
  const rawHeight = metadata.height ?? 0;
  const transform = input.transform ?? fixedRigDisplayTransformForDimensions(rawWidth, rawHeight);
  const outputFilePath = path.join(input.outputDir, `${input.filePrefix}-portrait-display.png`);
  let pipeline = sharp(input.sourceImagePath);
  if (transform === "rotate90cw") pipeline = pipeline.rotate(90);
  if (transform === "rotate90ccw") pipeline = pipeline.rotate(270);
  if (transform === "rotate180") pipeline = pipeline.rotate(180);
  await pipeline.png().toFile(outputFilePath);
  const [meta, displayMeta] = await Promise.all([fileMetadata(outputFilePath), sharp(outputFilePath).metadata()]);
  return {
    kind: "portrait_display_image",
    outputFilePath,
    sha256: meta.sha256,
    byteSize: meta.byteSize,
    mimeType: "image/png",
    imageWidth: displayMeta.width ?? (transform === "none" || transform === "rotate180" ? rawWidth : rawHeight),
    imageHeight: displayMeta.height ?? (transform === "none" || transform === "rotate180" ? rawHeight : rawWidth),
    rawSourceFilePath: input.sourceImagePath,
    ...(input.rawSourceSha256 ? { rawSourceSha256: input.rawSourceSha256 } : {}),
    rawCoordinateFrame: "basler_sensor_pixels",
    displayTransform: transform,
    displayCoordinateFrame: "ai_grader_card_portrait_display",
    rawEvidenceUnmodified: true,
    note: "Derived report/display image only. Raw Basler evidence remains unchanged in sensor coordinates.",
  };
}

export async function createFixedRigRoiCrops(input: {
  sourceDisplayImagePath: string;
  rawSourceImagePath: string;
  outputDir: string;
  rois: FixedRigRoiDefinition[];
  displayTransform: FixedRigDisplayTransform;
  rawSourceSha256?: string;
  filePrefix: string;
}): Promise<FixedRigDisplayArtifact[]> {
  await mkdir(input.outputDir, { recursive: true });
  const crops: FixedRigDisplayArtifact[] = [];
  const displayMetadata = await sharp(input.sourceDisplayImagePath).metadata();
  const displayWidth = displayMetadata.width ?? 0;
  const displayHeight = displayMetadata.height ?? 0;
  for (const roi of input.rois) {
    if (roi.status !== "computed" || !roi.displayRect) continue;
    const left = Math.max(0, Math.min(displayWidth - 1, roi.displayRect.x));
    const top = Math.max(0, Math.min(displayHeight - 1, roi.displayRect.y));
    const width = Math.max(1, Math.min(roi.displayRect.width, displayWidth - left));
    const height = Math.max(1, Math.min(roi.displayRect.height, displayHeight - top));
    const outputFilePath = path.join(input.outputDir, `${input.filePrefix}-${roi.id}-portrait-crop.png`);
    await sharp(input.sourceDisplayImagePath)
      .extract({
        left,
        top,
        width,
        height,
      })
      .png()
      .toFile(outputFilePath);
    const [meta, cropMeta] = await Promise.all([fileMetadata(outputFilePath), sharp(outputFilePath).metadata()]);
    crops.push({
      kind: "roi_crop",
      outputFilePath,
      sha256: meta.sha256,
      byteSize: meta.byteSize,
      mimeType: "image/png",
      imageWidth: cropMeta.width ?? roi.displayRect.width,
      imageHeight: cropMeta.height ?? roi.displayRect.height,
      rawSourceFilePath: input.rawSourceImagePath,
      ...(input.rawSourceSha256 ? { rawSourceSha256: input.rawSourceSha256 } : {}),
      rawCoordinateFrame: "basler_sensor_pixels",
      displayTransform: input.displayTransform,
      displayCoordinateFrame: "ai_grader_card_portrait_display",
      roiId: roi.id,
      rawRect: roi.rawRect ?? roi.rect,
      displayRect: roi.displayRect,
      rawEvidenceUnmodified: true,
      note: "Derived portrait ROI crop for report/debug only; raw evidence remains clean.",
    });
  }
  return crops;
}

export async function createFixedRigOverlayPreview(input: {
  sourceImagePath: string;
  outputDir: string;
  filePrefix: string;
  quality?: FixedRigQualityMetrics;
  roiDefinitions?: FixedRigRoiDefinition[];
  title?: string;
  displayTransform?: FixedRigDisplayTransform;
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
    rawCoordinateFrame: "basler_sensor_pixels",
    displayTransform: input.displayTransform ?? "none",
    displayCoordinateFrame: "ai_grader_card_portrait_display",
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
  activeLightingProfile?: FixedRigActiveLightingProfile;
  manifestPath?: string;
  previewReportPath?: string;
}): FixedRigFocusAssistManifest {
  const roiDefinitions = addFixedRigDisplayRects(
    buildFixedRigRoiDefinitions(input.quality?.cardBoundary ?? { status: "not_computed", confidence: 0, reason: "No focus-assist image captured." }),
    input.quality?.width ?? 2448,
    input.quality?.height ?? 2048
  );
  const syncedCapture = input.macroPackage?.synced?.capture;
  const activeLightingProfile =
    input.activeLightingProfile ??
    buildFixedRigActiveLightingProfile({ selectedDutyPercent: input.macroPackage?.leimac.dutyPercent, profileSource: "default" });
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.packageId}-profile`,
    cameraModel: syncedCapture?.camera.modelName ?? syncedCapture?.camera.friendlyName ?? null,
    cameraSerial: syncedCapture?.camera.serialNumber ?? null,
    lensModel: syncedCapture?.calibration.lensModel ?? null,
    imageWidth: input.quality?.width ?? syncedCapture?.imageWidth,
    imageHeight: input.quality?.height ?? syncedCapture?.imageHeight,
    selectedExposureUs: input.macroPackage?.requestedExposureUs ?? syncedCapture?.exposureTime ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: syncedCapture?.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: activeLightingProfile.selectedDutyPercent,
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
    activeLightingProfile,
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
  activeLightingProfile?: FixedRigActiveLightingProfile;
  overlayPreview?: FixedRigOverlayArtifact;
}): FixedRigSideCapture {
  const rois = addFixedRigDisplayRects(buildFixedRigRoiDefinitions(input.quality.cardBoundary), input.quality.width, input.quality.height);
  const syncedCapture = input.macroPackage.synced?.capture;
  const activeLightingProfile =
    input.activeLightingProfile ??
    buildFixedRigActiveLightingProfile({ selectedDutyPercent: input.macroPackage.leimac.dutyPercent, profileSource: "default" });
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.macroPackage.packageId}-${input.side}-profile`,
    cameraModel: syncedCapture?.camera.modelName ?? syncedCapture?.camera.friendlyName ?? null,
    cameraSerial: syncedCapture?.camera.serialNumber ?? null,
    lensModel: syncedCapture?.calibration.lensModel ?? null,
    imageWidth: input.quality.width,
    imageHeight: input.quality.height,
    selectedExposureUs: input.macroPackage.requestedExposureUs ?? syncedCapture?.exposureTime ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: syncedCapture?.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: activeLightingProfile.selectedDutyPercent,
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
  activeLightingProfile?: FixedRigActiveLightingProfile;
  finalLightOffConfirmedByMark?: boolean;
  manifestPath?: string;
  analysisPath?: string;
  previewReportPath?: string;
}): FixedRigV1LocalManifest {
  const warnings = [
    ...(input.front?.quality.warnings.map((warning) => `front: ${warning}`) ?? []),
    ...(input.back?.quality.warnings.map((warning) => `back: ${warning}`) ?? []),
  ];
  const activeLightingProfile =
    input.activeLightingProfile ??
    buildFixedRigActiveLightingProfile({
      selectedDutyPercent: input.front?.calibrationProfile.selectedLeimacDuty ?? input.back?.calibrationProfile.selectedLeimacDuty,
      profileSource: "default",
    });
  return {
    packageId: input.packageId,
    packageDir: input.packageDir,
    ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
    ...(input.analysisPath ? { analysisPath: input.analysisPath } : {}),
    ...(input.previewReportPath ? { previewReportPath: input.previewReportPath } : {}),
    status: input.status,
    selectedLightingProfile: ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID,
    activeLightingProfile,
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
  livePreview?: BaslerOperatorPreviewWindowResult;
  previewCapture?: BaslerCaptureStillResult;
  quality?: FixedRigQualityMetrics;
  overlayPreview?: FixedRigOverlayArtifact;
  focusLockedByOperator?: boolean;
  acceptedLightingProfile?: FixedRigActiveLightingProfile;
  manifestPath?: string;
  previewReportPath?: string;
}): FixedRigOperatorPreviewManifest {
  const roiDefinitions = addFixedRigDisplayRects(
    buildFixedRigRoiDefinitions(input.quality?.cardBoundary ?? { status: "not_computed", confidence: 0 }),
    input.quality?.width ?? 2448,
    input.quality?.height ?? 2048
  );
  const previewDuty = input.livePreview?.previewLighting.requestedDutyPercent ?? input.livePreview?.previewLighting.currentDutyPercent;
  const acceptedLightingProfile =
    input.acceptedLightingProfile ??
    buildFixedRigActiveLightingProfile({
      selectedDutyPercent: previewDuty ?? FIXED_RIG_SELECTED_LEIMAC_DUTY,
      selectedChannels: input.livePreview?.previewLighting.selectedChannels,
      profileSource: input.status === "accepted" ? "operator_preview" : "default",
      resetToDefault:
        input.status === "accepted" &&
        previewDuty === FIXED_RIG_SELECTED_LEIMAC_DUTY &&
        JSON.stringify(normalizeChannelList(input.livePreview?.previewLighting.selectedChannels)) === JSON.stringify([...FIXED_RIG_DEFAULT_CHANNELS]),
    });
  const calibrationProfile = buildFixedRigCalibrationProfile({
    profileId: `${input.packageId}-profile`,
    cameraModel: input.previewCapture?.camera.modelName ?? input.previewCapture?.camera.friendlyName ?? null,
    cameraSerial: input.previewCapture?.camera.serialNumber ?? null,
    lensModel: input.previewCapture?.calibration.lensModel ?? null,
    imageWidth: input.quality?.width ?? input.previewCapture?.imageWidth,
    imageHeight: input.quality?.height ?? input.previewCapture?.imageHeight,
    selectedExposureUs: input.previewCapture?.exposureTime ?? FIXED_RIG_SELECTED_EXPOSURE_US,
    selectedGain: input.previewCapture?.gain ?? FIXED_RIG_SELECTED_GAIN,
    selectedLeimacDuty: acceptedLightingProfile.selectedDutyPercent,
    cardBoundary: input.quality?.cardBoundary,
    focusLockedByOperator: input.focusLockedByOperator ?? false,
    calibrationStatus: input.status === "preview_captured" || input.status === "accepted" ? "preview_assisted" : "uncalibrated",
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
    mode: "windows_live_stream_preview",
    previewImplementationType: "windows_winforms_pylon_live_stream",
    ...(input.livePreview ? { livePreview: input.livePreview } : {}),
    operatorModeRequired: true,
    startAiGradingAutomatically: false,
    controls: {
      startAiGradingContinue: "operator_decision_only",
      abort: "operator_decision_only",
      pauseResume: "operator_control",
      refreshRateStatus: "visible_in_window",
      safeOffAvailableIfLeimacEngaged: true,
    },
    ...(input.previewCapture ? { previewCapture: input.previewCapture } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    roiDefinitions,
    ...(input.overlayPreview ? { overlayPreview: input.overlayPreview } : {}),
    calibrationProfile,
    acceptedLightingProfile,
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
      "Basler fixed-rig operator preview is manual focus/alignment support only. The operator acceptance path is a visible Windows pylon live-stream preview window; saved PNG/report artifacts are diagnostic only and overlays are not baked into raw evidence.",
  };
}

function channelValuesFor(selectedChannel: number | "all" | readonly number[], activeValue: string, inactiveValue = "0000") {
  const selectedChannels = Array.isArray(selectedChannel) ? normalizeChannelList(selectedChannel) : null;
  return Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    const active = selectedChannel === "all" || selectedChannel === channel || selectedChannels?.includes(channel);
    return {
      channel,
      value: active ? activeValue : inactiveValue,
      meaning: active ? `PWM duty ${activeValue}` : "PWM duty 0 steps",
    };
  });
}

export function buildLeimacCharacterizationFrames(input: {
  channel: number | "all" | readonly number[];
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
  const displayImage =
    manifest.previewCapture?.outputFilePath
      ? await createFixedRigDisplayImage({
          sourceImagePath: manifest.previewCapture.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "operator-preview",
          rawSourceSha256: manifest.previewCapture.sha256,
        })
      : manifest.displayImage;
  const overlayPreview =
    displayImage?.outputFilePath && manifest.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: displayImage.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "operator-preview",
          quality: transformQualityForDisplay(manifest.quality, displayImage.displayTransform),
          roiDefinitions: roisForDisplayOverlay(manifest.roiDefinitions),
          title: "Operator preview",
          displayTransform: displayImage.displayTransform,
        })
      : manifest.overlayPreview;
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, ...(displayImage ? { displayImage } : {}), ...(overlayPreview ? { overlayPreview } : {}), manifestPath, previewReportPath };
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
  const displayImage =
    syncedPath
      ? await createFixedRigDisplayImage({
          sourceImagePath: syncedPath,
          outputDir: manifest.packageDir,
          filePrefix: "focus-assist",
          rawSourceSha256: manifest.macroPackage?.synced?.capture.sha256,
        })
      : manifest.displayImage;
  const overlayPreview =
    displayImage?.outputFilePath && manifest.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: displayImage.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "focus-assist",
          quality: transformQualityForDisplay(manifest.quality, displayImage.displayTransform),
          roiDefinitions: roisForDisplayOverlay(manifest.roiDefinitions),
          title: "Focus/framing assist",
          displayTransform: displayImage.displayTransform,
        })
      : manifest.overlayPreview;
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, ...(displayImage ? { displayImage } : {}), ...(overlayPreview ? { overlayPreview } : {}), manifestPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeFile(previewReportPath, renderFixedRigFocusAssistReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeFixedRigFixtureCalibrationArtifacts(input: {
  packageId: string;
  packageDir: string;
  status: "planned" | "captured" | "aborted";
  activeLightingProfile: FixedRigActiveLightingProfile;
  macroPackage?: BaslerLeimacMacroPackageManifest;
  quality?: FixedRigQualityMetrics;
  fixtureCalibrationProfile: FixedRigFixtureCalibrationProfile;
  safeOffBefore: boolean;
  safeOffAfter: boolean;
}): Promise<{
  packageId: string;
  packageDir: string;
  manifestPath: string;
  analysisPath: string;
  previewReportPath: string;
  status: typeof input.status;
  activeLightingProfile: FixedRigActiveLightingProfile;
  macroPackage?: BaslerLeimacMacroPackageManifest;
  quality?: FixedRigQualityMetrics;
  displayImage?: FixedRigDisplayArtifact;
  overlayPreview?: FixedRigOverlayArtifact;
  roiDefinitions: FixedRigRoiDefinition[];
  fixtureCalibrationProfile: FixedRigFixtureCalibrationProfile;
  safety: {
    localOnly: true;
    diagnosticOnly: true;
    safeOffBefore: boolean;
    safeOffAfter: boolean;
    persistentBaslerSaved: false;
    persistentLeimacSaved: false;
  };
  warning: string;
}> {
  const syncedCapture = input.macroPackage?.synced?.capture;
  const roiDefinitions = addFixedRigDisplayRects(
    buildFixedRigRoiDefinitions(input.quality?.cardBoundary ?? { status: "not_computed", confidence: 0 }),
    input.quality?.width ?? syncedCapture?.imageWidth ?? 2448,
    input.quality?.height ?? syncedCapture?.imageHeight ?? 2048
  );
  const displayImage = syncedCapture
    ? await createFixedRigDisplayImage({
        sourceImagePath: syncedCapture.outputFilePath,
        outputDir: input.packageDir,
        filePrefix: "fixture-calibration",
        rawSourceSha256: syncedCapture.sha256,
      })
    : undefined;
  const overlayPreview =
    displayImage && input.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: displayImage.outputFilePath,
          outputDir: input.packageDir,
          filePrefix: "fixture-calibration",
          quality: transformQualityForDisplay(input.quality, displayImage.displayTransform),
          roiDefinitions: roisForDisplayOverlay(roiDefinitions),
          title: "Rough fixture calibration overlay",
          displayTransform: displayImage.displayTransform,
        })
      : undefined;
  const manifestPath = path.join(input.packageDir, "manifest.json");
  const analysisPath = path.join(input.packageDir, "analysis.json");
  const previewReportPath = path.join(input.packageDir, "preview-report.html");
  const manifest = {
    packageId: input.packageId,
    packageDir: input.packageDir,
    manifestPath,
    analysisPath,
    previewReportPath,
    status: input.status,
    activeLightingProfile: input.activeLightingProfile,
    ...(input.macroPackage ? { macroPackage: input.macroPackage } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(displayImage ? { displayImage } : {}),
    ...(overlayPreview ? { overlayPreview } : {}),
    roiDefinitions,
    fixtureCalibrationProfile: input.fixtureCalibrationProfile,
    safety: {
      localOnly: true as const,
      diagnosticOnly: true as const,
      safeOffBefore: input.safeOffBefore,
      safeOffAfter: input.safeOffAfter,
      persistentBaslerSaved: false as const,
      persistentLeimacSaved: false as const,
    },
    warning:
      "Rough fixed-fixture calibration only. This is not production calibration, does not set isCalibrated=true, and does not support final/certified grading claims.",
  };
  await writeJsonArtifact(manifestPath, manifest);
  await writeJsonArtifact(analysisPath, {
    status: input.status === "captured" ? "computed_diagnostic" : "not_computed",
    fixtureCalibrationProfile: input.fixtureCalibrationProfile,
    quality: input.quality,
    activeLightingProfile: input.activeLightingProfile,
    warning: manifest.warning,
  });
  await writeFile(previewReportPath, renderFixedRigFixtureCalibrationReport(manifest), "utf-8");
  return manifest;
}

export async function writeFixedRigRepeatabilityArtifacts(manifest: FixedRigRepeatabilityManifest): Promise<FixedRigRepeatabilityManifest> {
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const analysisPath = path.join(manifest.packageDir, "analysis.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifest, manifestPath, analysisPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeJsonArtifact(analysisPath, {
    status: manifest.status === "completed" ? "computed_diagnostic" : "not_computed",
    phase: manifest.phase,
    activeLightingProfile: manifest.activeLightingProfile,
    fixtureCalibrationProfile: manifest.fixtureCalibrationProfile,
    summary: manifest.summary,
    warning: manifest.warning,
  });
  await writeFile(previewReportPath, renderFixedRigRepeatabilityReport(withPaths), "utf-8");
  return withPaths;
}

export async function writeFixedRigV1Artifacts(manifest: FixedRigV1LocalManifest): Promise<FixedRigV1LocalManifest> {
  const frontDisplay =
    manifest.front?.macroPackage.synced?.capture.outputFilePath
      ? await createFixedRigDisplayImage({
          sourceImagePath: manifest.front.macroPackage.synced.capture.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "front",
          rawSourceSha256: manifest.front.macroPackage.synced.capture.sha256,
        })
      : manifest.front?.displayImage;
  const backDisplay =
    manifest.back?.macroPackage.synced?.capture.outputFilePath
      ? await createFixedRigDisplayImage({
          sourceImagePath: manifest.back.macroPackage.synced.capture.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "back",
          rawSourceSha256: manifest.back.macroPackage.synced.capture.sha256,
        })
      : manifest.back?.displayImage;
  const frontOverlay =
    frontDisplay?.outputFilePath && manifest.front?.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: frontDisplay.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "front",
          quality: transformQualityForDisplay(manifest.front.quality, frontDisplay.displayTransform),
          roiDefinitions: roisForDisplayOverlay(manifest.front.roiDefinitions),
          title: "Front ROI overlay",
          displayTransform: frontDisplay.displayTransform,
        })
      : manifest.front?.overlayPreview;
  const backOverlay =
    backDisplay?.outputFilePath && manifest.back?.quality
      ? await createFixedRigOverlayPreview({
          sourceImagePath: backDisplay.outputFilePath,
          outputDir: manifest.packageDir,
          filePrefix: "back",
          quality: transformQualityForDisplay(manifest.back.quality, backDisplay.displayTransform),
          roiDefinitions: roisForDisplayOverlay(manifest.back.roiDefinitions),
          title: "Back ROI overlay",
          displayTransform: backDisplay.displayTransform,
        })
      : manifest.back?.overlayPreview;
  const frontRoiCrops =
    frontDisplay && manifest.front?.macroPackage.synced?.capture
      ? await createFixedRigRoiCrops({
          sourceDisplayImagePath: frontDisplay.outputFilePath,
          rawSourceImagePath: manifest.front.macroPackage.synced.capture.outputFilePath,
          outputDir: path.join(manifest.packageDir, "front-roi-crops"),
          rois: manifest.front.roiDefinitions,
          displayTransform: frontDisplay.displayTransform,
          rawSourceSha256: manifest.front.macroPackage.synced.capture.sha256,
          filePrefix: "front",
        })
      : manifest.front?.roiCrops;
  const backRoiCrops =
    backDisplay && manifest.back?.macroPackage.synced?.capture
      ? await createFixedRigRoiCrops({
          sourceDisplayImagePath: backDisplay.outputFilePath,
          rawSourceImagePath: manifest.back.macroPackage.synced.capture.outputFilePath,
          outputDir: path.join(manifest.packageDir, "back-roi-crops"),
          rois: manifest.back.roiDefinitions,
          displayTransform: backDisplay.displayTransform,
          rawSourceSha256: manifest.back.macroPackage.synced.capture.sha256,
          filePrefix: "back",
        })
      : manifest.back?.roiCrops;
  const manifestWithOverlays: FixedRigV1LocalManifest = {
    ...manifest,
    ...(manifest.front
      ? { front: { ...manifest.front, ...(frontDisplay ? { displayImage: frontDisplay } : {}), ...(frontOverlay ? { overlayPreview: frontOverlay } : {}), ...(frontRoiCrops ? { roiCrops: frontRoiCrops } : {}) } }
      : {}),
    ...(manifest.back
      ? { back: { ...manifest.back, ...(backDisplay ? { displayImage: backDisplay } : {}), ...(backOverlay ? { overlayPreview: backOverlay } : {}), ...(backRoiCrops ? { roiCrops: backRoiCrops } : {}) } }
      : {}),
  };
  const manifestPath = path.join(manifest.packageDir, "manifest.json");
  const analysisPath = path.join(manifest.packageDir, "analysis.json");
  const previewReportPath = path.join(manifest.packageDir, "preview-report.html");
  const withPaths = { ...manifestWithOverlays, manifestPath, analysisPath, previewReportPath };
  await writeJsonArtifact(manifestPath, withPaths);
  await writeJsonArtifact(analysisPath, {
    status: manifestWithOverlays.status === "completed" ? "computed" : "not_computed",
    selectedLightingProfile: manifestWithOverlays.selectedLightingProfile,
    activeLightingProfile: manifestWithOverlays.activeLightingProfile,
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
  const alignment = quality.overlayAlignment;
  return `<table><tbody>
    <tr><th>Mean / max</th><td>${quality.mean} / ${quality.max}</td></tr>
    <tr><th>Sharpness score</th><td>${quality.sharpnessScore}</td></tr>
    <tr><th>Clipped pixels</th><td>${quality.clippedPixelFraction}</td></tr>
    <tr><th>Dark pixels</th><td>${quality.darkPixelFraction}</td></tr>
    <tr><th>Card boundary</th><td>${escapeHtml(quality.cardBoundary.status)} ${escapeHtml(quality.cardBoundary.coverage ?? "")}</td></tr>
    <tr><th>Overlay alignment</th><td>${escapeHtml(alignment?.overlayAlignmentStatus ?? "not_computed")} center=${escapeHtml(alignment?.centerOffsetPx ? `${alignment.centerOffsetPx.x},${alignment.centerOffsetPx.y}px` : "")}; margins=${escapeHtml(alignment ? `${alignment.marginLeft}/${alignment.marginRight}/${alignment.marginTop}/${alignment.marginBottom}` : "")}; aspect=${escapeHtml(alignment?.detectedAspectRatio ?? "")}/${escapeHtml(alignment?.expectedAspectRatio ?? "")}</td></tr>
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
    <tr><th>Pixel/mm orientation</th><td>${escapeHtml(profile.pixelToMmOrientationUsed ?? "not_computed")} consistency=${escapeHtml(profile.pixelToMmConsistency?.status ?? "not_computed")} diff=${escapeHtml(profile.pixelToMmConsistency?.relativeDifference ?? "")}</td></tr>
    <tr><th>Lens / lighting calibrated</th><td>${escapeHtml(profile.lensDistortionCalibrated)} / ${escapeHtml(profile.lightingCalibrated)}</td></tr>
    <tr><th>Focus locked by operator</th><td>${escapeHtml(profile.focusLockedByOperator)}</td></tr>
  </tbody></table>`;
}

function activeLightingProfileTable(profile: FixedRigActiveLightingProfile | undefined): string {
  if (!profile) return "<p>Active lighting profile unavailable.</p>";
  return `<table><tbody>
    <tr><th>Duty</th><td>${escapeHtml(profile.selectedDutyPercent)}% / PWM ${escapeHtml(profile.actualLeimacPwmStep)}</td></tr>
    <tr><th>Channels</th><td>${escapeHtml(profile.selectedChannels.join(", "))}</td></tr>
    <tr><th>Source</th><td>${escapeHtml(profile.profileSource)}</td></tr>
    <tr><th>Accepted at</th><td>${escapeHtml(profile.acceptedAt)}</td></tr>
    <tr><th>Reset to default</th><td>${escapeHtml(profile.resetToDefault)}</td></tr>
    <tr><th>Persistent Leimac save</th><td>${escapeHtml(profile.persistentLeimacSaved)}</td></tr>
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

function fixtureCalibrationTable(profile: FixedRigFixtureCalibrationProfile | undefined): string {
  if (!profile) return "<p>Fixture calibration profile unavailable.</p>";
  return `<table><tbody>
    <tr><th>Status</th><td>${escapeHtml(profile.status)}</td></tr>
    <tr><th>isCalibrated</th><td>${escapeHtml(profile.isCalibrated)}</td></tr>
    <tr><th>Fixture</th><td>${escapeHtml(profile.fixtureLabel)} ${escapeHtml(profile.fixtureId ?? "")}</td></tr>
    <tr><th>Reference</th><td>${escapeHtml(profile.referenceType)} ${escapeHtml(profile.referencePhysicalWidthMm)}mm x ${escapeHtml(profile.referencePhysicalHeightMm)}mm</td></tr>
    <tr><th>Coordinate frames</th><td>raw=${escapeHtml(profile.rawCoordinateFrame)}, transform=${escapeHtml(profile.displayTransform)}, display=${escapeHtml(profile.displayCoordinateFrame)}</td></tr>
    <tr><th>Pixel/mm</th><td>${escapeHtml(profile.pixelPerMmX ?? "not_computed")} x ${escapeHtml(profile.pixelPerMmY ?? "not_computed")}</td></tr>
    <tr><th>mm/pixel</th><td>${escapeHtml(profile.mmPerPixelX ?? "not_computed")} x ${escapeHtml(profile.mmPerPixelY ?? "not_computed")}</td></tr>
    <tr><th>X/Y consistency</th><td>${escapeHtml(profile.pixelToMmConsistency.status)} ${escapeHtml(profile.pixelToMmConsistency.relativeDifference ?? "")} ${escapeHtml(profile.pixelToMmConsistency.warning ?? "")}</td></tr>
    <tr><th>Aspect</th><td>expected ${escapeHtml(profile.expectedCardAspectRatio)}; detected ${escapeHtml(profile.detectedCardAspectRatio ?? "not_computed")}</td></tr>
    <tr><th>Lens / homography</th><td>${escapeHtml(profile.lensDistortionStatus)} / ${escapeHtml(profile.homographyStatus)}</td></tr>
    <tr><th>Lighting</th><td>${escapeHtml(profile.dutyPercent)}% PWM ${escapeHtml(profile.lightingProfileUsed.actualLeimacPwmStep)} channels ${escapeHtml(profile.channels.join(", "))}</td></tr>
    <tr><th>Operator accepted</th><td>${escapeHtml(profile.operatorAccepted)}</td></tr>
    <tr><th>Warning</th><td>${escapeHtml(profile.warning)}</td></tr>
  </tbody></table>`;
}

function repeatabilityTable(summary: FixedRigRepeatabilitySummary | undefined): string {
  if (!summary) return "<p>Repeatability summary unavailable.</p>";
  return `<table><tbody>
    <tr><th>Status</th><td>${escapeHtml(summary.repeatabilityStatus)}</td></tr>
    <tr><th>Phase / runs</th><td>${escapeHtml(summary.phase)} / ${escapeHtml(summary.runCount)}</td></tr>
    <tr><th>Center offset px mean/max</th><td>${escapeHtml(summary.centerOffsetMeanPx ?? "not_computed")} / ${escapeHtml(summary.centerOffsetMaxPx ?? "not_computed")}</td></tr>
    <tr><th>Center offset mm mean/max</th><td>${escapeHtml(summary.centerOffsetMeanMm ?? "not_computed")} / ${escapeHtml(summary.centerOffsetMaxMm ?? "not_computed")}</td></tr>
    <tr><th>Boundary variation px</th><td>w=${escapeHtml(summary.boundaryWidthVariationPx ?? "not_computed")}; h=${escapeHtml(summary.boundaryHeightVariationPx ?? "not_computed")}</td></tr>
    <tr><th>Pixel/mm variation</th><td>${escapeHtml(summary.pixelToMmVariation ?? "not_computed")}</td></tr>
    <tr><th>Sharpness / brightness variation</th><td>${escapeHtml(summary.sharpnessVariation ?? "not_computed")} / ${escapeHtml(summary.meanBrightnessVariation ?? "not_computed")}</td></tr>
    <tr><th>Max clipping</th><td>${escapeHtml(summary.clippingMax ?? "not_computed")}</td></tr>
    <tr><th>Overlay counts</th><td>pass ${escapeHtml(summary.overlayAlignmentCounts.pass)}, warn ${escapeHtml(summary.overlayAlignmentCounts.warn)}, fail ${escapeHtml(summary.overlayAlignmentCounts.fail)}, not computed ${escapeHtml(summary.overlayAlignmentCounts.notComputed)}</td></tr>
    <tr><th>Warnings</th><td>${escapeHtml(summary.warnings.join("; ") || "none")}</td></tr>
  </tbody></table>`;
}

function diagnosticElementTable(title: string, element: FixedRigDiagnosticElement | undefined): string {
  if (!element) return `<h3>${escapeHtml(title)}</h3><p>Not computed.</p>`;
  return `<h3>${escapeHtml(title)}</h3><table><tbody>
    <tr><th>Status</th><td>${escapeHtml(element.status)}</td></tr>
    <tr><th>Score</th><td>${escapeHtml(element.score ?? "omitted_diagnostic_only")}</td></tr>
    <tr><th>Confidence</th><td>${escapeHtml(element.confidence)}</td></tr>
    <tr><th>Metrics</th><td><pre>${escapeHtml(JSON.stringify(element.metrics, null, 2))}</pre></td></tr>
    <tr><th>Warnings</th><td>${escapeHtml(element.warnings.join("; ") || "none")}</td></tr>
  </tbody></table>`;
}

function diagnosticGradingSection(result: FixedRigDiagnosticGradingResult | undefined): string {
  if (!result) return "<h2>Preliminary Diagnostic Grading</h2><p>Not computed.</p>";
  return `<h2>Preliminary Diagnostic Grading</h2>
    <p class="warn">Diagnostic only. finalGradeComputed=${escapeHtml(result.finalGradeComputed)}; certifiedClaim=${escapeHtml(result.certifiedClaim)}.</p>
    <p>Status ${escapeHtml(result.status)}; calibration status ${escapeHtml(result.calibrationStatus)}.</p>
    ${diagnosticElementTable("Centering", result.centering)}
    ${diagnosticElementTable("Top-left corner", result.corners.topLeft)}
    ${diagnosticElementTable("Top-right corner", result.corners.topRight)}
    ${diagnosticElementTable("Bottom-right corner", result.corners.bottomRight)}
    ${diagnosticElementTable("Bottom-left corner", result.corners.bottomLeft)}
    ${diagnosticElementTable("Top edge", result.edges.top)}
    ${diagnosticElementTable("Right edge", result.edges.right)}
    ${diagnosticElementTable("Bottom edge", result.edges.bottom)}
    ${diagnosticElementTable("Left edge", result.edges.left)}
    ${diagnosticElementTable("Surface", result.surface)}
    <h3>Diagnostic warnings</h3><ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`;
}

function surfaceAnalysisSection(analysis: FixedRigSurfaceAnalysis | undefined): string {
  if (!analysis) return "<h2>8-Channel Surface Analysis</h2><p>Not computed.</p>";
  return `<h2>8-Channel Surface Analysis</h2>
    <p>Status ${escapeHtml(analysis.status)}; detector ${escapeHtml(analysis.detectorId)}. ${escapeHtml(analysis.registration.note)}</p>
    <table><thead><tr><th>Channel</th><th>Mean</th><th>Max</th><th>Clipped</th><th>Dark</th><th>Sharpness</th><th>Anomaly proxy</th></tr></thead><tbody>
      ${analysis.perChannelStats.map((channel) => `<tr><td>${escapeHtml(channel.channel)}</td><td>${escapeHtml(channel.mean ?? "")}</td><td>${escapeHtml(channel.max ?? "")}</td><td>${escapeHtml(channel.clippedPixelFraction ?? "")}</td><td>${escapeHtml(channel.darkPixelFraction ?? "")}</td><td>${escapeHtml(channel.sharpnessScore ?? "")}</td><td>${escapeHtml(channel.anomalyProxyMetric ?? "")}</td></tr>`).join("")}
    </tbody></table>
    <div class="grid">${analysis.perChannelStats.map((channel) => imageTag(channel.portraitDisplayImage?.outputFilePath, `channel ${channel.channel} portrait display`)).join("")}</div>
    <p>Candidates: ${escapeHtml(analysis.candidates.length)}. ${escapeHtml(analysis.warnings.join("; "))}</p>`;
}

function sideSection(side: FixedRigSideCapture | undefined, title: string): string {
  if (!side) return `<section><h2>${escapeHtml(title)}</h2><p>Not captured.</p></section>`;
  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <div class="grid">
      <section><h3>Dark Control</h3>${imageTag(side.macroPackage.darkControl?.capture.outputFilePath, `${title} dark control`)}</section>
      <section><h3>Raw Synced Macro</h3>${imageTag(side.macroPackage.synced?.capture.outputFilePath, `${title} raw synced macro`)}</section>
      <section><h3>Portrait Display Macro</h3>${imageTag(side.displayImage?.outputFilePath, `${title} portrait display macro`)}</section>
    </div>
    <h3>Overlay Preview</h3>
    ${imageTag(side.overlayPreview?.outputFilePath, `${title} ROI overlay preview`)}
    <h3>Portrait ROI Crops</h3>
    <div class="grid">${(side.roiCrops ?? []).map((crop) => `<section><h4>${escapeHtml(crop.roiId ?? "crop")}</h4>${imageTag(crop.outputFilePath, `${title} ${crop.roiId ?? "ROI"} portrait crop`)}</section>`).join("") || "<p>ROI crops not generated.</p>"}</div>
    ${qualityTable(side.quality)}
    <h3>Calibration Profile</h3>
    ${calibrationTable(side.calibrationProfile)}
    <h3>ROIs</h3>
    ${roiTable(side.roiDefinitions)}
    <p><strong>ROI status:</strong> ${escapeHtml(side.analysis.boundaryStatus)} | <strong>Analysis:</strong> ${escapeHtml(side.analysis.status)}</p>
  </section>`;
}

export function renderFixedRigFixtureCalibrationReport(manifest: {
  status: string;
  activeLightingProfile: FixedRigActiveLightingProfile;
  quality?: FixedRigQualityMetrics;
  displayImage?: FixedRigDisplayArtifact;
  overlayPreview?: FixedRigOverlayArtifact;
  roiDefinitions: FixedRigRoiDefinition[];
  fixtureCalibrationProfile: FixedRigFixtureCalibrationProfile;
  warning: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fixed-Rig Rough Fixture Calibration - Diagnostic</title>
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
  <h1>Fixed-Rig Rough Fixture Calibration</h1>
  <p class="warn">${escapeHtml(manifest.warning)} No final grade, certificate, or certified grading claim is made.</p>
  <h2>Active Lighting Profile</h2>
  ${activeLightingProfileTable(manifest.activeLightingProfile)}
  <h2>Rough Fixture Calibration Profile</h2>
  ${fixtureCalibrationTable(manifest.fixtureCalibrationProfile)}
  <h2>Portrait Display Image</h2>
  ${imageTag(manifest.displayImage?.outputFilePath, "rough fixture calibration portrait display")}
  <h2>Overlay Audit</h2>
  ${imageTag(manifest.overlayPreview?.outputFilePath, "rough fixture calibration overlay")}
  ${qualityTable(manifest.quality)}
  <h2>ROIs</h2>
  ${roiTable(manifest.roiDefinitions)}
</main></body></html>
`;
}

export function renderFixedRigRepeatabilityReport(manifest: FixedRigRepeatabilityManifest): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fixed-Rig Repeatability Test - Diagnostic</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #171717; background: #f7f7f4; }
    main { max-width: 1180px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; }
    .warn { border-left: 4px solid #a33; padding: 8px 12px; background: #fff; }
  </style>
</head>
<body><main>
  <h1>Fixed-Rig Repeatability Test</h1>
  <p class="warn">${escapeHtml(manifest.warning)} Diagnostic only; this does not make the rig calibrated.</p>
  <h2>Active Lighting Profile</h2>
  ${activeLightingProfileTable(manifest.activeLightingProfile)}
  <h2>Fixture Calibration Profile</h2>
  ${fixtureCalibrationTable(manifest.fixtureCalibrationProfile)}
  <h2>Repeatability Summary</h2>
  ${repeatabilityTable(manifest.summary)}
  <h2>Runs</h2>
  <table><thead><tr><th>#</th><th>Phase</th><th>Mean</th><th>Clipped</th><th>Sharpness</th><th>Center px</th><th>Boundary</th><th>Overlay</th><th>Capture</th></tr></thead><tbody>
    ${manifest.runs.map((run) => `<tr><td>${escapeHtml(run.index)}</td><td>${escapeHtml(run.phase)}</td><td>${escapeHtml(run.mean)}</td><td>${escapeHtml(run.clippedPixelFraction)}</td><td>${escapeHtml(run.sharpnessScore)}</td><td>${escapeHtml(run.centerOffsetPx ? `${run.centerOffsetPx.x},${run.centerOffsetPx.y}` : "not_computed")}</td><td>${escapeHtml(run.boundaryWidth ?? "")} x ${escapeHtml(run.boundaryHeight ?? "")}</td><td>${escapeHtml(run.overlayAlignmentStatus)}</td><td>${escapeHtml(run.capture?.outputFilePath ?? "")}</td></tr>`).join("")}
  </tbody></table>
</main></body></html>
`;
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
  <h2>Portrait Display Image</h2>
  ${imageTag(manifest.displayImage?.outputFilePath, "Focus assist portrait display macro")}
  <h2>Raw Synced Macro</h2>
  ${imageTag(manifest.macroPackage?.synced?.capture.outputFilePath, "Focus assist raw synced macro")}
  <h2>Overlay Preview</h2>
  ${imageTag(manifest.overlayPreview?.outputFilePath, "Focus assist overlay preview")}
  ${qualityTable(manifest.quality)}
  <h2>Active Lighting Profile</h2>
  ${activeLightingProfileTable(manifest.activeLightingProfile)}
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
  <p class="warn">Manual preview/focus support only. Acceptance requires the visible Windows pylon live-stream preview window; saved files below are diagnostics only. This is not autofocus, not calibrated evidence, and not AI grading.</p>
  <p class="controls"><span>Accept / Start / Continue</span><span>Abort / Close</span><span>Pause / Resume</span><span>Refresh rate status</span><span>Safe Off if Leimac engaged</span></p>
  <h2>Window Result</h2>
  <table><tbody>
    <tr><th>Implementation</th><td>${escapeHtml(manifest.previewImplementationType)}</td></tr>
    <tr><th>Window visible</th><td>${escapeHtml(String(manifest.livePreview?.windowVisible ?? false))}</td></tr>
    <tr><th>Frames update automatically</th><td>${escapeHtml(String(manifest.livePreview?.framesUpdateAutomatically ?? false))}</td></tr>
    <tr><th>FPS</th><td>${escapeHtml(String(manifest.livePreview?.fps ?? "not recorded"))}</td></tr>
    <tr><th>Frame age</th><td>${escapeHtml(String(manifest.livePreview?.frameAgeMs ?? "not recorded"))} ms</td></tr>
    <tr><th>Frame source</th><td>${escapeHtml(manifest.livePreview?.frameSource ?? "not recorded")}</td></tr>
    <tr><th>Skipped stale frames</th><td>${escapeHtml(String(manifest.livePreview?.skippedStaleFrames ?? "not recorded"))}</td></tr>
    <tr><th>Frames displayed</th><td>${escapeHtml(String(manifest.livePreview?.framesDisplayed ?? "not recorded"))}</td></tr>
    <tr><th>Overlay visible</th><td>${escapeHtml(String(manifest.livePreview?.overlayVisible ?? false))}</td></tr>
    <tr><th>Metrics visible</th><td>${escapeHtml(String(manifest.livePreview?.metricsVisible ?? false))}</td></tr>
    <tr><th>Display orientation</th><td>${escapeHtml(manifest.livePreview?.displayOrientation ?? "not recorded")}</td></tr>
    <tr><th>Sidebar layout</th><td>${escapeHtml(manifest.livePreview?.sidebarLayout ?? "not recorded")}</td></tr>
    <tr><th>Preview lighting controls</th><td>${escapeHtml(String(manifest.livePreview?.previewLighting.controlsVisible ?? false))}</td></tr>
    <tr><th>Preview duty</th><td>requested ${escapeHtml(String(manifest.livePreview?.previewLighting.requestedDutyPercent ?? manifest.livePreview?.previewLighting.currentDutyPercent ?? "not recorded"))}%; applied ${escapeHtml(String(manifest.livePreview?.previewLighting.actualAppliedDutyPercent ?? "not recorded"))}% / PWM ${escapeHtml(String(manifest.livePreview?.previewLighting.actualAppliedPwmValue ?? "not recorded"))}; default V1 marker ${escapeHtml(String(manifest.livePreview?.previewLighting.defaultV1DutyMarkerPercent ?? 1.2))}%</td></tr>
    <tr><th>Lighting ACK latency</th><td>${escapeHtml(String(manifest.livePreview?.previewLighting.lastApplyLatencyMs ?? "not recorded"))} ms</td></tr>
    <tr><th>Preview channels</th><td>${escapeHtml((manifest.livePreview?.previewLighting.selectedChannels ?? []).join(", ") || "none")}; mapping ${escapeHtml(manifest.livePreview?.previewLighting.channelMappingStatus ?? "unknown_uncalibrated")}</td></tr>
    <tr><th>Operator decision</th><td>${escapeHtml(manifest.livePreview?.operatorDecision ?? "not recorded")}</td></tr>
  </tbody></table>
  <h2>Diagnostic Raw Preview Snapshot</h2>
  ${imageTag(manifest.previewCapture?.outputFilePath, "Basler operator preview diagnostic raw snapshot")}
  <h2>Diagnostic Portrait Display Snapshot</h2>
  ${imageTag(manifest.displayImage?.outputFilePath, "Basler operator preview diagnostic portrait display snapshot")}
  <h2>Diagnostic Overlay Preview</h2>
  ${imageTag(manifest.overlayPreview?.outputFilePath, "Basler operator preview overlay")}
  ${qualityTable(manifest.quality)}
  <h2>Accepted Lighting Profile</h2>
  ${activeLightingProfileTable(manifest.acceptedLightingProfile)}
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
  <h2>Active Lighting Profile</h2>
  ${activeLightingProfileTable(manifest.activeLightingProfile)}
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
