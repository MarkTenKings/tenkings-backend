import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  BaslerPylonClient,
  type BaslerCaptureStillResult,
  type BaslerFixedRigSideBatchResult,
  type BaslerOperatorPreviewWindowResult,
} from "./baslerPylonClient";
import type { BaslerLeimacMacroPackageManifest } from "./baslerLeimacFullRig";
import { ACCEPTED_BASLER_LEIMAC_LIGHTING_PROFILE_ID } from "./baslerLeimacFullRig";
import { assertBaslerLeimacSyncSmokeOutputDirAllowed, type BaslerLeimacImageStats } from "./baslerLeimacSync";
import {
  PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
  buildPreliminarySurfaceIntelligenceV0,
  mergeSurfaceAnalysisWithSurfaceIntelligence,
  type SurfaceIntelligenceNormalizedCardProjection,
} from "./fixedRigSurfaceIntelligence";
import {
  LIGHT_DIRECTION_CALIBRATION_PROFILE_VERSION,
  PRELIMINARY_NORMAL_RELIEF_PROXY_VERSION,
  buildLightDirectionCalibrationArtifacts,
  mergeSurfaceAnalysisWithLightDirection,
} from "./fixedRigLightDirectionCalibration";
import {
  PROVISIONAL_GRADE_RULES_VERSION,
  PROVISIONAL_GRADE_STORY_ENGINE_VERSION,
  buildFixedRigProvisionalGradeStory,
  type FixedRigProvisionalGradeStoryResult,
} from "./fixedRigProvisionalGradeStory";
import {
  NORMALIZED_CARD_HEIGHT_PIXELS,
  NORMALIZED_CARD_WIDTH_PIXELS,
  detectAndNormalizeCardImage,
  normalizeCardImageWithGeometry,
  type CardGeometryMetadata,
  type CardGeometryManualOverride,
  type CardGeometryNormalizedArtifact,
  type CardGeometryNormalizationResult,
} from "./cardGeometry";
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

export type FixedRigCaptureProfile = "full_forensic" | "production_fast";

export const FIXED_RIG_CAPTURE_PROFILES: Record<
  FixedRigCaptureProfile,
  {
    rawFormat: "png" | "tiff";
    evidenceRoles: "full_forensic";
    note: string;
  }
> = {
  full_forensic: {
    rawFormat: "png",
    evidenceRoles: "full_forensic",
    note: "Lossless PNG raw evidence with dark control, all-on, accepted profile, and channels 1-8.",
  },
  production_fast: {
    rawFormat: "tiff",
    evidenceRoles: "full_forensic",
    note:
      "Lossless TIFF raw evidence reduces PNG encoding work while preserving dark control, all-on, accepted profile, and channels 1-8. Dell timing acceptance is still required.",
  },
};

export type FixedRigDisplayTransform = "none" | "rotate90cw" | "rotate90ccw" | "rotate180";
export type FixedRigOrientationUsed = "raw_landscape_rotated_to_portrait" | "raw_portrait";

export type FixedRigCardSide = "front" | "back";
export type FixedRigReferenceType =
  | "card_dimensions"
  | "fixed_metric_rulers"
  | "metric_ruler"
  | "cutting_mat"
  | "measurement_board"
  | "certified_target"
  | "unknown";
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
  profileSource: "operator_preview" | "browser_live_tuning" | "default" | "cli_override";
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
  status: "draft" | "rough_reference_unvalidated" | "ruler_reference_unvalidated" | "repeatability_checked" | "production_candidate" | "rejected";
  isCalibrated: false;
  referenceType: FixedRigReferenceType;
  referencePhysicalWidthMm: number;
  referencePhysicalHeightMm: number;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  horizontalPixelDistance?: number;
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  verticalPixelDistance?: number;
  calibrationImagePath?: string;
  rawCoordinateFrame: "basler_sensor_pixels" | "normalized_card_portrait_pixels";
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
  framingGate?: FixedRigFramingGate;
  productionReadiness?: FixedRigProductionReadinessSummary;
  overlayUsesCalibrationProfileId?: string;
  overlayScaleSource?: "fixed_metric_rulers" | "card_dimensions" | "not_computed";
  overlayCoordinateFrame?: "ai_grader_card_portrait_display";
  expectedCardRectMm?: { widthMm: number; heightMm: number };
  expectedCardRectPx?: { width: number; height: number };
  detectedCardRectPx?: { x: number; y: number; width: number; height: number };
  alignmentDeltaPx?: { x: number; y: number };
  alignmentDeltaMm?: { x: number; y: number };
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

export interface FixedRigFramingGate {
  status: "pass" | "warn" | "fail";
  marginLeftPx?: number;
  marginRightPx?: number;
  marginTopPx?: number;
  marginBottomPx?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  marginTopMm?: number;
  marginBottomMm?: number;
  centerOffsetPx?: { x: number; y: number };
  centerOffsetMm?: { x: number; y: number };
  aspectRatioError?: number;
  overlayAlignmentStatus?: "pass" | "warn" | "fail";
  warnings: string[];
}

export interface FixedRigProductionReadinessSummary {
  status: "production_candidate" | "warn" | "rejected";
  gates: {
    rulerCalibration: "pass" | "warn" | "fail";
    framing: "pass" | "warn" | "fail";
    overlayAlignment: "pass" | "warn" | "fail";
    repeatability: "pass" | "warn" | "fail" | "not_checked";
    lightingProfile: "pass" | "fail";
    finalSafeOff: "pass" | "not_confirmed";
  };
  blockers: string[];
  diagnosticOnlyAllowedWithOperatorAcceptance: boolean;
  note: string;
}

export interface FixedRigCardBoundary {
  status: "detected" | "not_computed";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  coverage?: number;
  confidence: number;
  source?: "image_analysis" | "normalized_from_detected_geometry" | "normalized_from_manual_geometry";
  confidenceBasis?: CardGeometryMetadata["confidenceBasis"];
  detectionUsed?: boolean;
  manualOverrideUsed?: boolean;
  sourcePlacementState?: CardGeometryMetadata["placementState"];
  sourceWarnings?: string[];
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
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
  source: "approximate_detected_boundary" | "normalized_card_boundary" | "not_computed";
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
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
  displayTransform?: FixedRigDisplayTransform;
  displayCoordinateFrame?: "ai_grader_card_portrait_display";
  rawEvidenceUnmodified: true;
  overlaysBakedIntoRawEvidence: false;
  note: string;
}

export interface FixedRigDisplayArtifact {
  kind:
    | "portrait_display_image"
    | "roi_crop"
    | "surface_heatmap"
    | "surface_vision_image"
    | "confidence_mask"
    | "normalized_channel_image"
    | "normal_proxy_map"
    | "gradient_magnitude_map"
    | "relief_proxy_map";
  outputFilePath: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png";
  imageWidth: number;
  imageHeight: number;
  rawSourceFilePath: string;
  rawSourceSha256?: string;
  rawCoordinateFrame: "basler_sensor_pixels";
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
  displayTransform: FixedRigDisplayTransform;
  displayCoordinateFrame: "ai_grader_card_portrait_display";
  roiId?: FixedRigRoiDefinition["id"];
  rawRect?: { x: number; y: number; width: number; height: number };
  analysisRect?: { x: number; y: number; width: number; height: number };
  displayRect?: { x: number; y: number; width: number; height: number };
  rawEvidenceUnmodified: true;
  artifactRole?:
    | "true_view"
    | "roi_crop"
    | "surface_heatmap"
    | "surface_vision"
    | "glare_mask"
    | "underexposure_mask"
    | "normalized_channel"
    | "normal_proxy"
    | "gradient_magnitude"
    | "relief_proxy"
    | "confidence_map";
  sourceInputPaths?: string[];
  physicalDirectionMappingStatus?: "pending" | "inferred" | "confirmed";
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
  category?: "surface";
  analysisGeometry?: {
    coordinateFrame: "normalized_card";
    units: "fraction";
    sourceSha256: string;
    normalizedArtifactSha256: string;
    shape:
      | { type: "box"; x: number; y: number; width: number; height: number }
      | { type: "polygon"; points: Array<{ x: number; y: number }> };
  };
  displayRect?: { x: number; y: number; width: number; height: number };
  displayCoordinateFrame?: "ai_grader_card_portrait_display" | "normalized_card_portrait_pixels";
  rawRect?: { x: number; y: number; width: number; height: number };
  rawCoordinateFrame?: "basler_sensor_pixels";
  analysisRect?: { x: number; y: number; width: number; height: number };
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
  sourceChannels: number[];
  strongestChannel?: number;
  physicalDirectionMappingStatus?: "pending" | "inferred" | "confirmed";
  anomalyProxyScore: number;
  severityProxy: number;
  severityBand: "low" | "medium" | "high";
  confidence?: number;
  confidenceBand?: "low" | "medium" | "high";
  needsDinoLiteFollowUp: boolean;
  evidenceRefs?: Record<string, unknown>;
  explanation?: string;
}

export interface FixedRigSurfaceAnalysis {
  detectorId: "preliminary_surface_anomaly_detector_v0" | typeof PRELIMINARY_SURFACE_INTELLIGENCE_VERSION;
  status: "not_computed" | "computed_diagnostic" | "insufficient_evidence";
  version?: typeof PRELIMINARY_SURFACE_INTELLIGENCE_VERSION;
  registration: {
    status: "assumed_fixed_rig" | "normalized_geometry_transform" | "not_computed";
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
  surfaceVision?: FixedRigDisplayArtifact;
  glareMask?: FixedRigDisplayArtifact;
  underexposureMask?: FixedRigDisplayArtifact;
  normalProxy?: FixedRigDisplayArtifact;
  gradientMagnitude?: FixedRigDisplayArtifact;
  reliefProxy?: FixedRigDisplayArtifact;
  confidenceMap?: FixedRigDisplayArtifact;
  physicalDirectionMappingStatus?: "pending" | "inferred" | "confirmed";
  normalization?: Record<string, unknown>;
  masks?: Record<string, unknown>;
  lightDirection?: Record<string, unknown>;
  confidence?: {
    score: number;
    band: "low" | "medium" | "high";
    warnings: string[];
  };
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

export interface FixedRigWarmEvidencePackageInput {
  outputDir: string;
  side: FixedRigCardSide;
  captureProfile?: FixedRigCaptureProfile;
  activeLightingProfile?: FixedRigActiveLightingProfile;
  pylonRoot?: string;
  pylonTimeoutMs?: number;
  baslerBridgeScript?: string;
  env?: NodeJS.ProcessEnv;
  leimacHost: string;
  leimacPort?: number;
  leimacUnit?: number;
  cameraIndex?: number;
  exposureUs?: number;
  gain?: number;
  lensModel?: string;
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: FixedRigReferenceType;
  referenceWidthMm?: number;
  referenceHeightMm?: number;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  /**
   * Legacy fixture hint retained for bridge compatibility. It never overrides
   * automatic geometry or creates a normalized artifact.
   */
  cardBoundaryRect?: { x: number; y: number; width: number; height: number };
  /** Explicit operator action required to use manual card geometry. */
  manualGeometryOverride?: CardGeometryManualOverride;
}

export interface FixedRigWarmSideCaptureBatch {
  executionPath: "warm_full_forensic_runner";
  packageId: string;
  packageDir: string;
  sideDir: string;
  side: FixedRigCardSide;
  captureProfile: FixedRigCaptureProfile;
  rawEvidenceFormat: "png" | "tiff";
  /** True only when captureFixedRigWarmSideBatch actually completed against the rig. */
  hardwareMeasurement?: boolean;
  activeLightingProfile: FixedRigActiveLightingProfile;
  batch: BaslerFixedRigSideBatchResult;
  exposureUs: number;
  gain: number;
  lensModel?: string;
  fixtureLabel?: string;
  fixtureId?: string;
  referenceType?: FixedRigReferenceType;
  referenceWidthMm?: number;
  referenceHeightMm?: number;
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  cardBoundaryRect?: { x: number; y: number; width: number; height: number };
  manualGeometryOverride?: CardGeometryManualOverride;
}

export interface FixedRigWarmEvidencePackageResult {
  executionPath: "warm_full_forensic_runner";
  packageId: string;
  packageDir: string;
  manifestPath: string;
  analysisPath: string;
  previewReportPath: string;
  manifest: Record<string, unknown>;
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

export interface FixedRigUnifiedDiagnosticCardReportResult {
  packageId: string;
  packageDir: string;
  reportPath: string;
  manifestPath: string;
  analysisPath: string;
  status: "computed_diagnostic" | "insufficient_evidence";
  evidenceClass: typeof FIXED_RIG_V1_EVIDENCE_CLASS;
  isCalibrated: false;
  finalGradeComputed: false;
  certifiedClaim: false;
  frontPackageDir: string;
  backPackageDir: string;
  frontReportPath?: string;
  backReportPath?: string;
  activeLightingProfile?: FixedRigActiveLightingProfile;
  fixtureCalibrationProfile?: FixedRigFixtureCalibrationProfile;
  framingGateStatus?: string;
  overlayAlignmentStatus?: string;
  warnings: string[];
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
      profileSource:
        parsed.profileSource === "operator_preview" ||
        parsed.profileSource === "browser_live_tuning" ||
        parsed.profileSource === "cli_override"
          ? parsed.profileSource
          : "default",
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

export function applyFixedRigCardBoundaryOverride(
  quality: FixedRigQualityMetrics,
  rect: { x: number; y: number; width: number; height: number }
): FixedRigQualityMetrics {
  const cardBoundary: FixedRigCardBoundary = {
    status: "detected",
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    coverage: roundMetric((rect.width * rect.height) / Math.max(1, quality.width * quality.height), 6),
    confidence: 0.75,
    reason: "Operator-entered raw sensor card boundary override for fixed-rig ruler calibration audit.",
  };
  const overlayAlignment = buildFixedRigOverlayAlignmentMetrics({
    imageWidth: quality.width,
    imageHeight: quality.height,
    boundary: cardBoundary,
    pixelToMm: buildFixedRigPixelToMmEstimate(cardBoundary),
  });
  const warnings = [
    ...quality.warnings.filter((warning) => !/boundary|coverage|framing|tray|height|touches/i.test(warning)),
    ...overlayAlignment.warnings,
    "Card boundary was operator-entered for fixed-rig ruler calibration; verify overlay alignment visually before production-candidate use.",
  ];
  return {
    ...quality,
    cardBoundary,
    framing: {
      status: overlayAlignment.overlayAlignmentStatus === "fail" ? "warning" : "acceptable_for_smoke",
      cardCoverageEstimate: cardBoundary.coverage,
      warnings: overlayAlignment.warnings,
    },
    overlayAlignment,
    warnings,
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
  horizontalSpanMm?: number;
  horizontalStartPx?: { x: number; y: number };
  horizontalEndPx?: { x: number; y: number };
  verticalSpanMm?: number;
  verticalStartPx?: { x: number; y: number };
  verticalEndPx?: { x: number; y: number };
  calibrationImagePath?: string;
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
  const referenceType = input.referenceType ?? (input.horizontalSpanMm || input.verticalSpanMm ? "fixed_metric_rulers" : "card_dimensions");
  const horizontalPixelDistance =
    input.horizontalStartPx && input.horizontalEndPx ? roundMetric(pointDistance(input.horizontalStartPx, input.horizontalEndPx), 4) : undefined;
  const verticalPixelDistance =
    input.verticalStartPx && input.verticalEndPx ? roundMetric(pointDistance(input.verticalStartPx, input.verticalEndPx), 4) : undefined;
  const hasRulerCalibration =
    referenceType === "fixed_metric_rulers" &&
    horizontalPixelDistance !== undefined &&
    verticalPixelDistance !== undefined &&
    horizontalPixelDistance > 0 &&
    verticalPixelDistance > 0 &&
    input.horizontalSpanMm !== undefined &&
    input.horizontalSpanMm > 0 &&
    input.verticalSpanMm !== undefined &&
    input.verticalSpanMm > 0;
  const isRawLandscape = width !== undefined && height !== undefined && width >= height;
  const physicalX = isRawLandscape ? Math.max(referencePhysicalWidthMm, referencePhysicalHeightMm) : Math.min(referencePhysicalWidthMm, referencePhysicalHeightMm);
  const physicalY = isRawLandscape ? Math.min(referencePhysicalWidthMm, referencePhysicalHeightMm) : Math.max(referencePhysicalWidthMm, referencePhysicalHeightMm);
  const mmPerPixelX = hasRulerCalibration
    ? roundMetric(input.horizontalSpanMm! / horizontalPixelDistance!, 6)
    : width && width > 0
      ? roundMetric(physicalX / width, 6)
      : undefined;
  const mmPerPixelY = hasRulerCalibration
    ? roundMetric(input.verticalSpanMm! / verticalPixelDistance!, 6)
    : height && height > 0
      ? roundMetric(physicalY / height, 6)
      : undefined;
  const pixelPerMmX = mmPerPixelX ? roundMetric(1 / mmPerPixelX, 4) : undefined;
  const pixelPerMmY = mmPerPixelY ? roundMetric(1 / mmPerPixelY, 4) : undefined;
  const tolerance = 0.08;
  const relativeDifference =
    mmPerPixelX && mmPerPixelY ? roundMetric(Math.abs(mmPerPixelX - mmPerPixelY) / Math.max(mmPerPixelX, mmPerPixelY), 4) : undefined;
  const consistencyStatus = relativeDifference === undefined ? "not_computed" : relativeDifference <= tolerance ? "pass" : "warn";
  const activeLightingProfile = input.activeLightingProfile ?? buildFixedRigActiveLightingProfile();
  const overlayAlignment =
    input.cardBoundary && input.rawImageWidth && input.rawImageHeight
      ? buildFixedRigOverlayAlignmentMetrics({
          imageWidth: input.rawImageWidth,
          imageHeight: input.rawImageHeight,
          boundary: input.cardBoundary,
          pixelToMm:
            mmPerPixelX && mmPerPixelY
              ? {
                  pixelToMmEstimateX: mmPerPixelX,
                  pixelToMmEstimateY: mmPerPixelY,
                  pixelToMmEstimateStatus: "estimated_uncalibrated" as const,
                  pixelToMmOrientationUsed: isRawLandscape ? "raw_landscape_rotated_to_portrait" : "raw_portrait",
                  pixelToMmConsistency: { status: consistencyStatus, ...(relativeDifference !== undefined ? { relativeDifference } : {}), tolerance },
                }
              : undefined,
        })
      : undefined;
  const framingGate = buildFixedRigFramingGate({
    imageWidth: input.rawImageWidth,
    imageHeight: input.rawImageHeight,
    boundary: input.cardBoundary,
    overlayAlignment,
    mmPerPixelX,
    mmPerPixelY,
  });
  const productionReadiness = buildFixedRigProductionReadinessSummary({
    referenceType,
    rulerCalibrationStatus: hasRulerCalibration ? consistencyStatus : "fail",
    framingGate,
    overlayAlignmentStatus: overlayAlignment?.overlayAlignmentStatus,
    repeatabilityStatus: input.status === "repeatability_checked" ? "warn" : "not_checked",
    lightingProfile: activeLightingProfile,
    finalSafeOffConfirmed: false,
  });
  const status =
    input.status ??
    (productionReadiness.status === "production_candidate"
      ? "production_candidate"
      : referenceType === "fixed_metric_rulers"
        ? "ruler_reference_unvalidated"
        : referenceType === "certified_target"
          ? "draft"
          : "rough_reference_unvalidated");
  const expectedCardRectPx =
    mmPerPixelX && mmPerPixelY
      ? { width: roundMetric(referencePhysicalWidthMm / mmPerPixelX, 2), height: roundMetric(referencePhysicalHeightMm / mmPerPixelY, 2) }
      : undefined;
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
    ...(input.horizontalSpanMm !== undefined ? { horizontalSpanMm: input.horizontalSpanMm } : {}),
    ...(input.horizontalStartPx ? { horizontalStartPx: input.horizontalStartPx } : {}),
    ...(input.horizontalEndPx ? { horizontalEndPx: input.horizontalEndPx } : {}),
    ...(horizontalPixelDistance !== undefined ? { horizontalPixelDistance } : {}),
    ...(input.verticalSpanMm !== undefined ? { verticalSpanMm: input.verticalSpanMm } : {}),
    ...(input.verticalStartPx ? { verticalStartPx: input.verticalStartPx } : {}),
    ...(input.verticalEndPx ? { verticalEndPx: input.verticalEndPx } : {}),
    ...(verticalPixelDistance !== undefined ? { verticalPixelDistance } : {}),
    ...(input.calibrationImagePath ? { calibrationImagePath: input.calibrationImagePath } : {}),
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
    framingGate,
    productionReadiness,
    overlayUsesCalibrationProfileId: input.profileId,
    overlayScaleSource: hasRulerCalibration ? "fixed_metric_rulers" : referenceType === "card_dimensions" ? "card_dimensions" : "not_computed",
    overlayCoordinateFrame: "ai_grader_card_portrait_display",
    expectedCardRectMm: { widthMm: referencePhysicalWidthMm, heightMm: referencePhysicalHeightMm },
    ...(expectedCardRectPx ? { expectedCardRectPx } : {}),
    ...(input.cardBoundary?.status === "detected" && input.cardBoundary.x != null && input.cardBoundary.y != null && width && height
      ? {
          detectedCardRectPx: { x: input.cardBoundary.x, y: input.cardBoundary.y, width, height },
          ...(overlayAlignment?.centerOffsetPx ? { alignmentDeltaPx: overlayAlignment.centerOffsetPx } : {}),
          ...(overlayAlignment?.centerOffsetMm ? { alignmentDeltaMm: overlayAlignment.centerOffsetMm } : {}),
        }
      : {}),
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
        : referenceType === "fixed_metric_rulers"
          ? "Fixed metric rulers are the measurement reference, but this is still an unvalidated local fixture calibration; isCalibrated remains false."
          : "Rough fixture calibration only. Reference is not a certified machine-vision target; isCalibrated remains false.",
  };
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function buildFixedRigFramingGate(input: {
  imageWidth?: number;
  imageHeight?: number;
  boundary?: FixedRigCardBoundary;
  overlayAlignment?: FixedRigOverlayAlignmentMetrics;
  mmPerPixelX?: number;
  mmPerPixelY?: number;
}): FixedRigFramingGate {
  const warnings: string[] = [];
  const boundary = input.boundary;
  if (boundary?.status !== "detected" || boundary.x == null || boundary.y == null || !boundary.width || !boundary.height) {
    return { status: "fail", overlayAlignmentStatus: input.overlayAlignment?.overlayAlignmentStatus, warnings: ["Card boundary was not detected."] };
  }
  const imageWidth = input.imageWidth ?? 0;
  const imageHeight = input.imageHeight ?? 0;
  const marginLeftPx = boundary.x;
  const marginTopPx = boundary.y;
  const marginRightPx = imageWidth - (boundary.x + boundary.width);
  const marginBottomPx = imageHeight - (boundary.y + boundary.height);
  const minMargin = Math.min(marginLeftPx, marginRightPx, marginTopPx, marginBottomPx);
  const aspectRatio = boundary.width >= boundary.height ? boundary.width / boundary.height : boundary.height / boundary.width;
  const expectedAspectRatio = FIXED_RIG_DEFAULT_CARD_HEIGHT_MM / FIXED_RIG_DEFAULT_CARD_WIDTH_MM;
  const aspectRatioError = roundMetric(Math.abs(aspectRatio - expectedAspectRatio) / expectedAspectRatio, 6);
  if (minMargin <= 0) warnings.push("Card touches the image boundary; fixed-rig framing gate fails.");
  else if (minMargin <= 20) warnings.push("Card is within 20 px of the image boundary; add margin before production-candidate use.");
  if (aspectRatioError > 0.1) warnings.push("Detected card aspect ratio is outside the strict framing tolerance.");
  else if (aspectRatioError > 0.05) warnings.push("Detected card aspect ratio is near the framing tolerance.");
  if (input.overlayAlignment?.overlayAlignmentStatus === "fail") warnings.push("Overlay alignment failed.");
  if (input.overlayAlignment?.overlayAlignmentStatus === "warn") warnings.push("Overlay alignment warning is present.");
  const status = warnings.some((warning) => /fails|failed|touches|outside/i.test(warning)) ? "fail" : warnings.length ? "warn" : "pass";
  return {
    status,
    marginLeftPx,
    marginRightPx,
    marginTopPx,
    marginBottomPx,
    ...(input.mmPerPixelX ? { marginLeftMm: roundMetric(marginLeftPx * input.mmPerPixelX, 3), marginRightMm: roundMetric(marginRightPx * input.mmPerPixelX, 3) } : {}),
    ...(input.mmPerPixelY ? { marginTopMm: roundMetric(marginTopPx * input.mmPerPixelY, 3), marginBottomMm: roundMetric(marginBottomPx * input.mmPerPixelY, 3) } : {}),
    ...(input.overlayAlignment?.centerOffsetPx ? { centerOffsetPx: input.overlayAlignment.centerOffsetPx } : {}),
    ...(input.overlayAlignment?.centerOffsetMm ? { centerOffsetMm: input.overlayAlignment.centerOffsetMm } : {}),
    aspectRatioError,
    overlayAlignmentStatus: input.overlayAlignment?.overlayAlignmentStatus,
    warnings,
  };
}

export function buildFixedRigProductionReadinessSummary(input: {
  referenceType: FixedRigReferenceType;
  rulerCalibrationStatus: "pass" | "warn" | "fail" | "not_computed";
  framingGate?: FixedRigFramingGate;
  overlayAlignmentStatus?: "pass" | "warn" | "fail";
  repeatabilityStatus?: "pass" | "warn" | "fail" | "not_checked";
  lightingProfile?: FixedRigActiveLightingProfile;
  finalSafeOffConfirmed?: boolean;
}): FixedRigProductionReadinessSummary {
  const gates = {
    rulerCalibration: input.referenceType === "fixed_metric_rulers" && input.rulerCalibrationStatus === "pass" ? "pass" : input.rulerCalibrationStatus === "warn" ? "warn" : "fail",
    framing: input.framingGate?.status ?? "fail",
    overlayAlignment: input.overlayAlignmentStatus ?? "fail",
    repeatability: input.repeatabilityStatus ?? "not_checked",
    lightingProfile: input.lightingProfile ? "pass" : "fail",
    finalSafeOff: input.finalSafeOffConfirmed ? "pass" : "not_confirmed",
  } as const;
  const blockers: string[] = [];
  if (gates.rulerCalibration !== "pass") blockers.push("Ruler calibration is not passing.");
  if (gates.framing !== "pass") blockers.push("Strict framing/margin gate is not passing.");
  if (gates.overlayAlignment !== "pass") blockers.push("Overlay alignment gate is not passing.");
  if (gates.repeatability !== "pass") blockers.push("Remove/re-place repeatability has not passed.");
  if (gates.lightingProfile !== "pass") blockers.push("Lighting profile is not locked/recorded.");
  if (gates.finalSafeOff !== "pass") blockers.push("Final physical ring-light off confirmation is not recorded in this artifact.");
  return {
    status: blockers.length === 0 ? "production_candidate" : blockers.some((blocker) => /not passing|not passed|not recorded/i.test(blocker)) ? "rejected" : "warn",
    gates,
    blockers,
    diagnosticOnlyAllowedWithOperatorAcceptance: blockers.length > 0,
    note:
      "Production-candidate means fixed-rig setup gates passed for diagnostic acquisition only; it is not final grading, a certificate, or certified calibration.",
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
  fixtureCalibrationProfile?: FixedRigFixtureCalibrationProfile;
}): FixedRigRepeatabilityRun {
  const pixelToMm = buildFixedRigPixelToMmEstimate(input.quality.cardBoundary);
  const centerOffsetPx = input.quality.overlayAlignment?.centerOffsetPx;
  const mmPerPixelX = input.fixtureCalibrationProfile?.mmPerPixelX ?? pixelToMm.pixelToMmEstimateX;
  const mmPerPixelY = input.fixtureCalibrationProfile?.mmPerPixelY ?? pixelToMm.pixelToMmEstimateY;
  const centerOffsetMm =
    centerOffsetPx && mmPerPixelX && mmPerPixelY
      ? { x: roundMetric(centerOffsetPx.x * mmPerPixelX, 4), y: roundMetric(centerOffsetPx.y * mmPerPixelY, 4) }
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
    ...(mmPerPixelX !== undefined ? { pixelToMmEstimateX: mmPerPixelX } : {}),
    ...(mmPerPixelY !== undefined ? { pixelToMmEstimateY: mmPerPixelY } : {}),
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

function diagnosticElementInsufficient(reason: string): FixedRigDiagnosticElement {
  return { status: "insufficient_evidence", confidence: 0, metrics: {}, warnings: [reason] };
}

export function buildFixedRigSurfaceAnalysis(input: {
  side: FixedRigCardSide;
  channels?: Array<{ channel: number; stats?: FixedRigQualityMetrics; displayImage?: FixedRigDisplayArtifact }>;
  roiDefinitions?: FixedRigRoiDefinition[];
  warnings?: string[];
  registrationStatus?: "assumed_fixed_rig" | "normalized_geometry_transform";
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
  const anomalyValues = perChannelStats.map((channel) => channel.anomalyProxyMetric).filter((value): value is number => Number.isFinite(value));
  const sortedAnomalyValues = [...anomalyValues].sort((a, b) => a - b);
  const medianAnomaly =
    sortedAnomalyValues.length > 0
      ? sortedAnomalyValues[Math.floor(sortedAnomalyValues.length / 2)]
      : undefined;
  const strongest = [...perChannelStats]
    .filter((channel) => Number.isFinite(channel.anomalyProxyMetric))
    .sort((a, b) => (b.anomalyProxyMetric ?? 0) - (a.anomalyProxyMetric ?? 0));
  const candidateChannels = strongest.filter((channel) => {
    if (medianAnomaly === undefined || channel.anomalyProxyMetric === undefined) return false;
    return channel.anomalyProxyMetric >= medianAnomaly * 1.12 || (channel.clippedPixelFraction ?? 0) > 0.02;
  });
  const centerSurface = input.roiDefinitions?.find((roi) => roi.id === "center-surface" && roi.status === "computed");
  const centerSurfaceUsesNormalizedCoordinates = centerSurface?.analysisCoordinateFrame === "normalized_card_portrait_pixels";
  const centerSurfaceRawRect = centerSurfaceUsesNormalizedCoordinates ? undefined : centerSurface?.rawRect ?? centerSurface?.rect;
  const centerSurfaceAnalysisRect = centerSurfaceUsesNormalizedCoordinates ? centerSurface?.rect : undefined;
  const maxCandidateScore = candidateChannels.length ? Math.max(...candidateChannels.map((channel) => channel.anomalyProxyMetric ?? 0)) : 0;
  const candidateScore = medianAnomaly !== undefined ? roundMetric(Math.max(0, maxCandidateScore - medianAnomaly), 4) : 0;
  const severityBand: FixedRigSurfaceAnomalyCandidate["severityBand"] =
    candidateScore > 180 ? "high" : candidateScore > 60 ? "medium" : "low";
  const candidates: FixedRigSurfaceAnomalyCandidate[] =
    perChannelStats.length >= 8 && candidateChannels.length > 0
      ? [
          {
            candidateId: `${input.side}-surface-candidate-001`,
            side: input.side,
            ...(centerSurface?.displayRect
              ? {
                  displayRect: centerSurface.displayRect,
                  displayCoordinateFrame: centerSurfaceUsesNormalizedCoordinates
                    ? "normalized_card_portrait_pixels" as const
                    : "ai_grader_card_portrait_display" as const,
                }
              : {}),
            ...(centerSurfaceRawRect
              ? { rawRect: centerSurfaceRawRect, rawCoordinateFrame: "basler_sensor_pixels" as const }
              : {}),
            ...(centerSurfaceAnalysisRect
              ? {
                  analysisRect: centerSurfaceAnalysisRect,
                  analysisCoordinateFrame: "normalized_card_portrait_pixels" as const,
                }
              : {}),
            sourceChannels: candidateChannels.map((channel) => channel.channel),
            anomalyProxyScore: candidateScore,
            severityProxy: candidateScore,
            severityBand,
            needsDinoLiteFollowUp: severityBand !== "low" || candidateChannels.some((channel) => (channel.clippedPixelFraction ?? 0) > 0.02),
          },
        ]
      : [];
  const status: FixedRigSurfaceAnalysis["status"] =
    perChannelStats.length >= 8 ? "computed_diagnostic" : "insufficient_evidence";
  return {
    detectorId: "preliminary_surface_anomaly_detector_v0",
    status,
    registration: {
      status: input.registrationStatus ?? "assumed_fixed_rig",
      note:
        input.registrationStatus === "normalized_geometry_transform"
          ? "All card-visible channels reuse the authoritative full-resolution all-on card transform in normalized_card_portrait_pixels."
          : "Per-channel images are assumed aligned by the fixed fixture; no explicit registration or homography is computed in this provisional diagnostic workflow.",
    },
    perChannelStats,
    candidates,
    warnings: [
      "Surface anomaly detector is preliminary; no final surface grade is computed.",
      "Candidate boxes are provisional_diagnostic only and must be confirmed by later calibrated analysis or Dino-Lite follow-up.",
      ...(perChannelStats.length >= 8 ? [] : ["Eight per-channel images are required for provisional surface anomaly analysis."]),
      ...(candidates.length ? [] : ["No provisional surface candidates exceeded the V0 outlier threshold."]),
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
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
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
  const mmPerPixelX = input.fixtureCalibrationProfile?.mmPerPixelX;
  const mmPerPixelY = input.fixtureCalibrationProfile?.mmPerPixelY;
  const fixedRulerScaleReady =
    input.fixtureCalibrationProfile?.referenceType === "fixed_metric_rulers" &&
    input.fixtureCalibrationProfile.pixelToMmConsistency?.status === "pass" &&
    !!mmPerPixelX &&
    !!mmPerPixelY;
  const framingReady = input.fixtureCalibrationProfile?.framingGate?.status === "pass" && alignment?.overlayAlignmentStatus === "pass";
  const horizontalImbalancePx = left !== undefined && right !== undefined ? Math.abs(left - right) : undefined;
  const verticalImbalancePx = top !== undefined && bottom !== undefined ? Math.abs(top - bottom) : undefined;
  const horizontalImbalanceMm = horizontalImbalancePx !== undefined && mmPerPixelX ? roundMetric(horizontalImbalancePx * mmPerPixelX, 4) : undefined;
  const verticalImbalanceMm = verticalImbalancePx !== undefined && mmPerPixelY ? roundMetric(verticalImbalancePx * mmPerPixelY, 4) : undefined;
  const horizontalCenteringPercent = lrTotal ? roundMetric((Math.min(left ?? 0, right ?? 0) / lrTotal) * 100, 2) : undefined;
  const verticalCenteringPercent = tbTotal ? roundMetric((Math.min(top ?? 0, bottom ?? 0) / tbTotal) * 100, 2) : undefined;
  const centeringScore =
    horizontalCenteringPercent !== undefined && verticalCenteringPercent !== undefined
      ? roundMetric(Math.max(0, Math.min(10, ((horizontalCenteringPercent + verticalCenteringPercent) / 100) * 10)), 2)
      : undefined;
  const centering =
    input.analysisCoordinateFrame === "normalized_card_portrait_pixels"
      ? diagnosticElementNotComputed(
          "Printed-design centering is not yet computed in normalized card coordinates; camera-frame placement offset is intentionally excluded from grading.",
        )
      : boundary?.status === "detected" && lrTotal && tbTotal && fixedRulerScaleReady && framingReady
      ? {
          status: "computed_diagnostic" as const,
          score: centeringScore,
          confidence: 0.72,
          metrics: {
            scoreType: "provisional_diagnostic",
            leftPx: left,
            rightPx: right,
            topPx: top,
            bottomPx: bottom,
            ...(left !== undefined && mmPerPixelX ? { leftMm: roundMetric(left * mmPerPixelX, 4) } : {}),
            ...(right !== undefined && mmPerPixelX ? { rightMm: roundMetric(right * mmPerPixelX, 4) } : {}),
            ...(top !== undefined && mmPerPixelY ? { topMm: roundMetric(top * mmPerPixelY, 4) } : {}),
            ...(bottom !== undefined && mmPerPixelY ? { bottomMm: roundMetric(bottom * mmPerPixelY, 4) } : {}),
            horizontalCenteringPercent,
            verticalCenteringPercent,
            horizontalImbalancePx,
            verticalImbalancePx,
            horizontalImbalanceMm,
            verticalImbalanceMm,
            overlayAlignmentStatus: alignment?.overlayAlignmentStatus,
            expectedCardPhysicalSizeMm: {
              width: FIXED_RIG_DEFAULT_CARD_WIDTH_MM,
              height: FIXED_RIG_DEFAULT_CARD_HEIGHT_MM,
            },
          },
          warnings: ["Centering score is provisional_diagnostic only and is not a final grade."],
        }
      : boundary?.status === "detected"
        ? diagnosticElementInsufficient("Fixed-ruler scale, framing gate, or overlay alignment is not passing; centering is insufficient_evidence.")
        : diagnosticElementNotComputed("Card boundary/margins unavailable; centering diagnostic not computed.");
  const roiById = new Map((input.roiDefinitions ?? []).map((roi) => [roi.id, roi]));
  const roiMetric = (roiId: FixedRigRoiDefinition["id"], label: string): FixedRigDiagnosticElement => {
    const roi = roiById.get(roiId);
    if (!roi || roi.status !== "computed") return diagnosticElementNotComputed(`${label} ROI unavailable.`);
    return {
      status: "computed_diagnostic",
      confidence: input.quality?.cardBoundary.status === "detected" ? 0.35 : 0.15,
      score: input.quality
        ? roundMetric(
            Math.max(
              0,
              Math.min(10, 10 - input.quality.clippedPixelFraction * 40 - input.quality.darkPixelFraction * 8 + Math.min(input.quality.sharpnessScore, 500) / 250)
            ),
            2
          )
        : undefined,
      metrics: {
        scoreType: "provisional_diagnostic",
        roiId,
        rect: roi.rect,
        rawRect: roi.rawRect,
        displayRect: roi.displayRect,
        sharpnessProxy: input.quality?.sharpnessScore,
        clippedPixelFraction: input.quality?.clippedPixelFraction,
        darkPixelFraction: input.quality?.darkPixelFraction,
        edgeRoughnessProxy: input.quality ? roundMetric(input.quality.sharpnessScore * (1 + input.quality.clippedPixelFraction), 4) : undefined,
        contrastTextureProxy: input.quality ? roundMetric(input.quality.mean * Math.max(0, 1 - input.quality.darkPixelFraction), 4) : undefined,
        highFrequencyDefectProxy: input.quality
          ? roundMetric(input.quality.sharpnessScore * Math.max(input.quality.clippedPixelFraction, input.quality.darkPixelFraction), 4)
          : undefined,
        visibleBoundaryCompleteness: input.quality?.cardBoundary.status === "detected" && framingReady ? "pass" : "warn",
      },
      warnings: [
        `${label} ROI proxy metrics are provisional_diagnostic only and not a production corner/edge grade.`,
        ...(input.quality && input.quality.clippedPixelFraction > 0.02 ? ["Image clipping may bias this ROI diagnostic."] : []),
      ],
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
      score:
        input.surfaceAnalysis?.status === "computed_diagnostic"
          ? roundMetric(Math.max(0, 10 - Math.min(10, (input.surfaceAnalysis.candidates[0]?.severityProxy ?? 0) / 50)), 2)
          : undefined,
      metrics: {
        scoreType: "provisional_diagnostic",
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
  const firstBoundary = findBrightBoundary(data, width, height, threshold, { left: 0, top: 0, right: width, bottom: height });
  const firstCoverage =
    firstBoundary.width > 0 && firstBoundary.height > 0 ? (firstBoundary.width * firstBoundary.height) / Math.max(1, width * height) : 0;
  const insetBoundary =
    firstCoverage > 0.95
      ? findBrightBoundary(data, width, height, threshold, {
          left: Math.round(width * 0.1),
          top: Math.round(height * 0.1),
          right: Math.round(width * 0.9),
          bottom: Math.round(height * 0.9),
        })
      : firstBoundary;
  const boundaryWidth = insetBoundary.width;
  const boundaryHeight = insetBoundary.height;
  const coverage = boundaryWidth > 0 && boundaryHeight > 0 ? (boundaryWidth * boundaryHeight) / Math.max(1, width * height) : 0;
  const boundary: FixedRigCardBoundary =
    coverage > 0.05
      ? {
          status: "detected",
          x: insetBoundary.x,
          y: insetBoundary.y,
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

function findBrightBoundary(
  data: Buffer,
  width: number,
  height: number,
  threshold: number,
  bounds: { left: number; top: number; right: number; bottom: number }
): { x: number; y: number; width: number; height: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const left = Math.max(0, Math.min(width, bounds.left));
  const top = Math.max(0, Math.min(height, bounds.top));
  const right = Math.max(left, Math.min(width, bounds.right));
  const bottom = Math.max(top, Math.min(height, bounds.bottom));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const value = data[y * width + x] ?? 0;
      if (value >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX >= minX && maxY >= minY ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : { x: 0, y: 0, width: 0, height: 0 };
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

export function transformPointForDisplay(
  point: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
  transform: FixedRigDisplayTransform
): { x: number; y: number } {
  if (transform === "none") return { ...point };
  if (transform === "rotate180") return { x: imageWidth - point.x, y: imageHeight - point.y };
  if (transform === "rotate90ccw") return { x: point.y, y: imageWidth - point.x };
  return { x: imageHeight - point.y, y: point.x };
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
  rulerSpans?: Array<{ label: string; start: { x: number; y: number }; end: { x: number; y: number }; spanMm: number }>;
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
  const rulerSpans = input.rulerSpans ?? [];
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
    ${rulerSpans
      .map(
        (span) => `<line x1="${span.start.x}" y1="${span.start.y}" x2="${span.end.x}" y2="${span.end.y}" stroke="#ffffff" stroke-width="7"/>
    <line x1="${span.start.x}" y1="${span.start.y}" x2="${span.end.x}" y2="${span.end.y}" stroke="#111111" stroke-width="3"/>
    <text x="${Math.round((span.start.x + span.end.x) / 2) + 12}" y="${Math.round((span.start.y + span.end.y) / 2) - 12}" class="label small">${escapeHtml(span.label)} ${escapeHtml(span.spanMm)}mm</text>`
      )
      .join("")}
    <text x="24" y="44" class="label">${escapeHtml(input.title ?? "Fixed-rig preview overlay")}</text>
    <text x="24" y="${height - 58}" class="label small">Uncalibrated grid / overlay. Raw evidence image is unmodified.</text>
    <text x="24" y="${height - 24}" class="label small">Yellow: template. Green: detected boundary. White/black: ruler spans. Orange/pink/lime: ROIs.</text>
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
  rawSourceImagePath?: string;
  outputDir: string;
  filePrefix: string;
  transform?: FixedRigDisplayTransform;
  rawSourceSha256?: string;
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
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
    rawSourceFilePath: input.rawSourceImagePath ?? input.sourceImagePath,
    ...(input.rawSourceSha256 ? { rawSourceSha256: input.rawSourceSha256 } : {}),
    rawCoordinateFrame: "basler_sensor_pixels",
    ...(input.analysisCoordinateFrame ? { analysisCoordinateFrame: input.analysisCoordinateFrame } : {}),
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
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
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
      ...(input.analysisCoordinateFrame ? { analysisCoordinateFrame: input.analysisCoordinateFrame } : {}),
      displayTransform: input.displayTransform,
      displayCoordinateFrame: "ai_grader_card_portrait_display",
      roiId: roi.id,
      ...(input.analysisCoordinateFrame
        ? { analysisRect: roi.displayRect }
        : { rawRect: roi.rawRect ?? roi.rect }),
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
  fixtureCalibrationProfile?: FixedRigFixtureCalibrationProfile;
  title?: string;
  displayTransform?: FixedRigDisplayTransform;
  analysisCoordinateFrame?: "normalized_card_portrait_pixels";
}): Promise<FixedRigOverlayArtifact> {
  await mkdir(input.outputDir, { recursive: true });
  const metadata = await sharp(input.sourceImagePath).metadata();
  const imageWidth = metadata.width ?? input.quality?.width ?? 0;
  const imageHeight = metadata.height ?? input.quality?.height ?? 0;
  const outputFilePath = path.join(input.outputDir, `${input.filePrefix}-overlay.png`);
  const rawWidth = input.quality?.width && input.quality?.height && input.displayTransform && input.displayTransform !== "none" ? imageHeight : imageWidth;
  const rawHeight = input.quality?.width && input.quality?.height && input.displayTransform && input.displayTransform !== "none" ? imageWidth : imageHeight;
  const transform = input.displayTransform ?? "none";
  const rulerSpans: Array<{ label: string; start: { x: number; y: number }; end: { x: number; y: number }; spanMm: number }> = [];
  if (input.fixtureCalibrationProfile?.horizontalStartPx && input.fixtureCalibrationProfile.horizontalEndPx && input.fixtureCalibrationProfile.horizontalSpanMm) {
    rulerSpans.push({
      label: "Horizontal ruler",
      start: transformPointForDisplay(input.fixtureCalibrationProfile.horizontalStartPx, rawWidth, rawHeight, transform),
      end: transformPointForDisplay(input.fixtureCalibrationProfile.horizontalEndPx, rawWidth, rawHeight, transform),
      spanMm: input.fixtureCalibrationProfile.horizontalSpanMm,
    });
  }
  if (input.fixtureCalibrationProfile?.verticalStartPx && input.fixtureCalibrationProfile.verticalEndPx && input.fixtureCalibrationProfile.verticalSpanMm) {
    rulerSpans.push({
      label: "Vertical ruler",
      start: transformPointForDisplay(input.fixtureCalibrationProfile.verticalStartPx, rawWidth, rawHeight, transform),
      end: transformPointForDisplay(input.fixtureCalibrationProfile.verticalEndPx, rawWidth, rawHeight, transform),
      spanMm: input.fixtureCalibrationProfile.verticalSpanMm,
    });
  }
  const svg = buildFixedRigOverlaySvg({
    width: imageWidth,
    height: imageHeight,
    quality: input.quality,
    roiDefinitions: input.roiDefinitions,
    rulerSpans,
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
    ...(input.analysisCoordinateFrame ? { analysisCoordinateFrame: input.analysisCoordinateFrame } : {}),
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
          fixtureCalibrationProfile: input.fixtureCalibrationProfile,
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

export async function captureFixedRigWarmSideBatch(input: FixedRigWarmEvidencePackageInput): Promise<FixedRigWarmSideCaptureBatch> {
  assertFixedRigOutputDirAllowed(input.outputDir);
  const { packageId, packageDir } = await createFixedRigPackageDir(input.outputDir, "ai-grader-fixed-rig-v1-evidence-package");
  const sideDir = path.join(packageDir, input.side);
  await mkdir(sideDir, { recursive: true });
  const activeLightingProfile =
    input.activeLightingProfile ??
    buildFixedRigActiveLightingProfile({
      selectedDutyPercent: FIXED_RIG_SELECTED_LEIMAC_DUTY,
      profileSource: "default",
    });
  const exposureUs = input.exposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US;
  const gain = input.gain ?? FIXED_RIG_SELECTED_GAIN;
  const captureProfile = input.captureProfile ?? "full_forensic";
  const captureProfilePlan = FIXED_RIG_CAPTURE_PROFILES[captureProfile];
  const env = input.env ?? process.env;
  const baslerClient = new BaslerPylonClient({
    pylonRoot: input.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
    bridgeScriptPath: input.baslerBridgeScript,
    timeoutMs: input.pylonTimeoutMs,
    env,
  });
  const batch = await baslerClient.captureFixedRigSideBatch({
    outputDir: sideDir,
    side: input.side,
    selectedChannels: activeLightingProfile.selectedChannels,
    cameraIndex: input.cameraIndex,
    savedFormat: captureProfilePlan.rawFormat,
    lensModel: input.lensModel ?? env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
    exposureUs,
    gain,
    leimacHost: input.leimacHost,
    leimacPort: input.leimacPort,
    leimacUnit: input.leimacUnit,
    dutyPercent: activeLightingProfile.selectedDutyPercent,
  });
  return {
    executionPath: "warm_full_forensic_runner",
    packageId,
    packageDir,
    sideDir,
    side: input.side,
    captureProfile,
    rawEvidenceFormat: captureProfilePlan.rawFormat,
    hardwareMeasurement: true,
    activeLightingProfile,
    batch,
    exposureUs,
    gain,
    lensModel: input.lensModel ?? env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
    fixtureLabel: input.fixtureLabel,
    fixtureId: input.fixtureId,
    referenceType: input.referenceType,
    referenceWidthMm: input.referenceWidthMm,
    referenceHeightMm: input.referenceHeightMm,
    horizontalSpanMm: input.horizontalSpanMm,
    horizontalStartPx: input.horizontalStartPx,
    horizontalEndPx: input.horizontalEndPx,
    verticalSpanMm: input.verticalSpanMm,
    verticalStartPx: input.verticalStartPx,
    verticalEndPx: input.verticalEndPx,
    cardBoundaryRect: input.cardBoundaryRect,
    manualGeometryOverride: input.manualGeometryOverride,
  };
}

const FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY = 2;
const FIXED_RIG_MIN_NORMALIZATION_SOURCE_WIDTH_PIXELS = 1000;
const FIXED_RIG_MIN_NORMALIZATION_SOURCE_HEIGHT_PIXELS = 1400;
const FIXED_RIG_MAX_NORMALIZATION_UPSCALE = 1.2;
const FIXED_RIG_SEMANTIC_ORIENTATION_WARNING =
  "Rectangle geometry normalizes card shape and in-plane rotation, but cannot determine printed top versus a 180-degree reversal; the operator must keep the printed top toward the top of the preview.";

function uniqueWarnings(warnings: Array<string | undefined>): string[] {
  return [...new Set(warnings.filter((warning): warning is string => Boolean(warning?.trim())))];
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await operation(items[index]!, index);
      }
    }),
  );
  return results;
}

function applyFixedRigNormalizedCardBoundary(
  quality: FixedRigQualityMetrics,
  geometry: CardGeometryMetadata,
): FixedRigQualityMetrics {
  const normalizedGeometrySource =
    geometry.geometrySource === "manual_override"
      ? "normalized_from_manual_geometry"
      : "normalized_from_detected_geometry";
  const sourceDescription =
    geometry.geometrySource === "manual_override"
      ? "explicit operator-confirmed manual geometry"
      : "automatic detected geometry";
  const sourceWarnings = uniqueWarnings([
    ...geometry.warnings,
    FIXED_RIG_SEMANTIC_ORIENTATION_WARNING,
  ]);
  const normalizedOutcomeNote =
    `Canonical full-card boundary in normalized_card_portrait_pixels derived from ${sourceDescription}; ` +
    `source confidence ${geometry.confidence} (${geometry.confidenceBasis}) and placement state ${geometry.placementState} are preserved, not recomputed as perfect detection.`;
  const cardBoundary: FixedRigCardBoundary = {
    status: "detected",
    x: 0,
    y: 0,
    width: quality.width,
    height: quality.height,
    coverage: 1,
    confidence: geometry.confidence,
    source: normalizedGeometrySource,
    confidenceBasis: geometry.confidenceBasis,
    detectionUsed: geometry.detectionUsed,
    manualOverrideUsed: geometry.manualOverrideUsed,
    sourcePlacementState: geometry.placementState,
    sourceWarnings,
    reason: normalizedOutcomeNote,
  };
  const expectedAspectRatio = roundMetric(FIXED_RIG_DEFAULT_CARD_WIDTH_MM / FIXED_RIG_DEFAULT_CARD_HEIGHT_MM, 6);
  const overlayAlignment: FixedRigOverlayAlignmentMetrics = {
    templateRect: { x: 0, y: 0, width: quality.width, height: quality.height },
    detectedBoundaryRect: { x: 0, y: 0, width: quality.width, height: quality.height },
    centerOffsetPx: { x: 0, y: 0 },
    centerOffsetMm: { x: 0, y: 0 },
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    marginBottom: 0,
    detectedAspectRatio: roundMetric(quality.width / Math.max(1, quality.height), 6),
    expectedAspectRatio,
    orientationUsed: "raw_portrait",
    overlayAlignmentStatus: "pass",
    warnings: uniqueWarnings([
      "Normalized coordinate alignment passed because the derived card artifact fills the canonical frame; this is not a source detection-confidence result.",
      ...sourceWarnings,
    ]),
  };
  return {
    ...quality,
    cardBoundary,
    framing: {
      status: "acceptable_for_smoke",
      cardCoverageEstimate: 1,
      warnings: uniqueWarnings([
        "Canonical output framing is complete after normalization; source placement quality remains recorded separately.",
        ...sourceWarnings,
      ]),
    },
    overlayAlignment,
    warnings: uniqueWarnings([
      ...quality.warnings,
      normalizedOutcomeNote,
      ...sourceWarnings,
    ]),
  };
}

function normalizedCardRoiDefinitions(
  width: number,
  height: number,
  geometry: CardGeometryMetadata,
): FixedRigRoiDefinition[] {
  const sourceDescription =
    geometry.geometrySource === "manual_override"
      ? "explicit operator-confirmed manual geometry"
      : "automatic detected geometry";
  const boundary: FixedRigCardBoundary = {
    status: "detected",
    x: 0,
    y: 0,
    width,
    height,
    coverage: 1,
    confidence: geometry.confidence,
    source:
      geometry.geometrySource === "manual_override"
        ? "normalized_from_manual_geometry"
        : "normalized_from_detected_geometry",
    confidenceBasis: geometry.confidenceBasis,
    detectionUsed: geometry.detectionUsed,
    manualOverrideUsed: geometry.manualOverrideUsed,
    sourcePlacementState: geometry.placementState,
    sourceWarnings: uniqueWarnings([...geometry.warnings, FIXED_RIG_SEMANTIC_ORIENTATION_WARNING]),
    reason:
      `Canonical full-card ROI boundary derived from ${sourceDescription}; source confidence ` +
      `${geometry.confidence} (${geometry.confidenceBasis}) is preserved.`,
  };
  return buildFixedRigRoiDefinitions(boundary).map((roi) => {
    if (roi.status !== "computed" || !roi.rect) return roi;
    const { rawCoordinateFrame: _rawCoordinateFrame, ...safe } = roi;
    return {
      ...safe,
      source: "normalized_card_boundary",
      displayRect: { ...roi.rect },
      analysisCoordinateFrame: "normalized_card_portrait_pixels",
      displayCoordinateFrame: "ai_grader_card_portrait_display",
    };
  });
}

function normalizedArtifactAsDisplay(
  artifact: CardGeometryNormalizedArtifact,
  rawCapture: BaslerCaptureStillResult,
  kind: "portrait_display_image" | "normalized_channel_image",
): FixedRigDisplayArtifact {
  return {
    kind,
    outputFilePath: artifact.localOutputPath,
    sha256: artifact.sha256,
    byteSize: artifact.byteSize,
    mimeType: "image/png",
    imageWidth: artifact.imageWidth,
    imageHeight: artifact.imageHeight,
    rawSourceFilePath: rawCapture.outputFilePath,
    rawSourceSha256: rawCapture.sha256,
    rawCoordinateFrame: "basler_sensor_pixels",
    analysisCoordinateFrame: "normalized_card_portrait_pixels",
    displayTransform: "none",
    displayCoordinateFrame: "ai_grader_card_portrait_display",
    rawEvidenceUnmodified: true,
    ...(kind === "normalized_channel_image" ? { artifactRole: "normalized_channel" as const } : { artifactRole: "true_view" as const }),
    note:
      "Existing lossless normalized card artifact reused directly for display/analysis; no duplicate image encode was performed. Raw Basler evidence remains unchanged.",
  };
}

function assertFullResolutionNormalizationUsable(
  normalizedCard: CardGeometryNormalizationResult,
  manualGeometryOverride: CardGeometryManualOverride | undefined,
  side: FixedRigCardSide,
): asserts normalizedCard is CardGeometryNormalizationResult & { normalizedArtifact: CardGeometryNormalizedArtifact } {
  if (!normalizedCard.rawEvidencePreserved) {
    throw new Error(`AI Grader ${side} full-resolution normalization detected a raw evidence integrity change; processing stopped.`);
  }
  if (!normalizedCard.normalizedArtifact) {
    throw new Error(`AI Grader ${side} full-resolution geometry did not produce a normalized card artifact; reposition the card and retry.`);
  }
  const artifact = normalizedCard.normalizedArtifact;
  if (
    artifact.sourceCropWidth < FIXED_RIG_MIN_NORMALIZATION_SOURCE_WIDTH_PIXELS ||
    artifact.sourceCropHeight < FIXED_RIG_MIN_NORMALIZATION_SOURCE_HEIGHT_PIXELS ||
    artifact.scaleX > FIXED_RIG_MAX_NORMALIZATION_UPSCALE ||
    artifact.scaleY > FIXED_RIG_MAX_NORMALIZATION_UPSCALE
  ) {
    throw new Error(
      `AI Grader ${side} full-resolution geometry failed the grading-resolution gate ` +
      `(source crop ${artifact.sourceCropWidth}x${artifact.sourceCropHeight}, scale ${artifact.scaleX}x${artifact.scaleY}; ` +
      `requires at least ${FIXED_RIG_MIN_NORMALIZATION_SOURCE_WIDTH_PIXELS}x${FIXED_RIG_MIN_NORMALIZATION_SOURCE_HEIGHT_PIXELS} ` +
      `and no more than ${FIXED_RIG_MAX_NORMALIZATION_UPSCALE}x upscaling). Move the card to the fixed plate position and retry.`,
    );
  }
  const geometry = normalizedCard.geometry;
  if (manualGeometryOverride) {
    if (geometry.geometrySource !== "manual_override" || geometry.captureMode !== "manual_capture" || geometry.manualOverrideUsed !== true || geometry.detectionUsed !== false) {
      throw new Error(`AI Grader ${side} explicit manual capture did not produce coherent full-resolution manual geometry; processing stopped.`);
    }
    return;
  }
  if (geometry.geometrySource !== "detected" || geometry.captureMode !== "automatic_detection" || geometry.detectionUsed !== true || geometry.manualOverrideUsed === true || geometry.placementState !== "ready") {
    throw new Error(
      `AI Grader ${side} full-resolution detected geometry is not normalization-ready (state=${geometry.placementState}, source=${geometry.geometrySource}); reposition the card and retry.`,
    );
  }
}

async function verifyRawCaptureIntegrity(
  captures: Array<{ role: string; capture: BaslerCaptureStillResult }>,
): Promise<{ verified: true; coordinateFrame: "basler_sensor_pixels"; roles: Array<{ role: string; sha256: string; byteSize: number; preserved: true }> }> {
  const roles = await Promise.all(captures.map(async ({ role, capture }) => {
    const current = await fileMetadata(capture.outputFilePath);
    if (current.sha256 !== capture.sha256 || current.byteSize !== capture.byteSize) {
      throw new Error(`AI Grader raw evidence integrity verification failed for ${role}; processing stopped.`);
    }
    return { role, sha256: current.sha256, byteSize: current.byteSize, preserved: true as const };
  }));
  return { verified: true, coordinateFrame: "basler_sensor_pixels", roles };
}

export async function processFixedRigWarmSideBatch(captureBatch: FixedRigWarmSideCaptureBatch): Promise<FixedRigWarmEvidencePackageResult> {
  const processingStartedAtMs = Date.now();
  const processingStartedAt = new Date(processingStartedAtMs).toISOString();
  const processingTiming: Record<string, { durationMs: number }> = {};
  const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const startedAtMs = Date.now();
    try {
      return await operation();
    } finally {
      processingTiming[name] = { durationMs: Math.max(0, Date.now() - startedAtMs) };
    }
  };
  const {
    packageId,
    packageDir,
    sideDir,
    side,
    captureProfile,
    rawEvidenceFormat,
    hardwareMeasurement,
    activeLightingProfile,
    batch,
    exposureUs,
    gain,
    fixtureLabel,
    fixtureId,
    referenceType,
    referenceWidthMm,
    referenceHeightMm,
    horizontalSpanMm,
    horizontalStartPx,
    horizontalEndPx,
    verticalSpanMm,
    verticalStartPx,
    verticalEndPx,
    cardBoundaryRect,
    manualGeometryOverride,
  } = captureBatch;
  const rawRoleCaptures = [
    batch.captures.darkControl,
    batch.captures.allOn,
    batch.captures.acceptedProfile,
    ...batch.captures.channels,
  ];
  const sumCaptureTiming = (phase: "grab" | "save" | "hash") =>
    Math.round(
      rawRoleCaptures.reduce((total, role) => {
        const duration = Number((role.capture as BaslerCaptureStillResult & { timing?: Record<string, { durationMs?: number }> }).timing?.[phase]?.durationMs);
        return total + (Number.isFinite(duration) ? duration : 0);
      }, 0) * 10
    ) / 10;
  const openedAtMs = batch.openedAt ? Date.parse(batch.openedAt) : Number.NaN;
  const finishedAtMs = batch.finishedAt ? Date.parse(batch.finishedAt) : Number.NaN;
  const sideCaptureTotalMs = Number.isFinite(openedAtMs) && Number.isFinite(finishedAtMs)
    ? Math.max(0, finishedAtMs - openedAtMs)
    : undefined;
  const captureTiming = {
    previewReadyAt: undefined,
    edgeDetectionReadyAt: undefined,
    operatorOrAutoTriggerAt: batch.openedAt,
    lightingProfileChanges: batch.leimac?.triggerSetup ?? undefined,
    frameCaptureMs: sumCaptureTiming("grab"),
    fileWritesMs: sumCaptureTiming("save"),
    fileHashMs: sumCaptureTiming("hash"),
    baslerOpenConfigureMs: Number((batch.timing as any)?.warmCameraOpenConfigure?.durationMs ?? 0),
    gradingForensicRunnerMs: sideCaptureTotalMs,
    totalSideMs: sideCaptureTotalMs,
    targetSideMs: 5000,
    targetProven:
      hardwareMeasurement === true && typeof sideCaptureTotalMs === "number"
        ? sideCaptureTotalMs <= 5000
        : false,
    captureProfile,
    rawEvidenceFormat,
    hardwareMeasurement: hardwareMeasurement === true,
    hardwareMeasurementRequired: hardwareMeasurement !== true,
  };
  const darkControlCapture = batch.captures.darkControl.capture;
  const orderedChannelRoles = batch.captures.channels
    .slice()
    .sort((a, b) => Number(a.channel ?? 0) - Number(b.channel ?? 0));
  const normalizedCard = await timed("cropDeskew", () =>
    detectAndNormalizeCardImage({
      sourceImagePath: batch.captures.allOn.capture.outputFilePath,
      normalizedOutputPath: path.join(sideDir, "normalized", `${side}-normalized-card.png`),
      side,
      sourceImageId: `${packageId}-${side}-all-on`,
      sourceFrameId: `${side}-all-on-${String(batch.captures.allOn.capture.sha256).slice(0, 16)}`,
      timestamp: batch.captures.allOn.capture.timestamp,
      ...(manualGeometryOverride ? { manualOverride: manualGeometryOverride } : {}),
    })
  );
  assertFullResolutionNormalizationUsable(normalizedCard, manualGeometryOverride, side);
  const authoritativeGeometry: CardGeometryMetadata = normalizedCard.geometry;
  const normalizeVisibleRole = async (
    role: BaslerFixedRigSideBatchResult["captures"]["allOn"],
    fileLabel: string,
  ) => {
    const registration = await normalizeCardImageWithGeometry({
      sourceImagePath: role.capture.outputFilePath,
      normalizedOutputPath: path.join(sideDir, "normalized", `${side}-${fileLabel}-normalized.png`),
      geometry: authoritativeGeometry,
    });
    if (!registration.rawEvidencePreserved || !registration.normalizedArtifact) {
      throw new Error(`AI Grader ${side} ${fileLabel} normalization did not preserve raw evidence or produce an artifact; processing stopped.`);
    }
    return { ...registration, normalizedArtifact: registration.normalizedArtifact };
  };
  const visibleRoleNormalizationInputs = [
    { role: batch.captures.acceptedProfile, fileLabel: "accepted-profile" },
    ...orderedChannelRoles.map((role) => ({ role, fileLabel: `channel-${Number(role.channel)}` })),
  ];
  const visibleRoleRegistrations = await timed("registeredRoleNormalization", () =>
    mapWithConcurrency(
      visibleRoleNormalizationInputs,
      FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY,
      ({ role, fileLabel }) => normalizeVisibleRole(role, fileLabel),
    )
  );
  const acceptedRegistration = visibleRoleRegistrations[0]!;
  const channelRegistrations = visibleRoleRegistrations.slice(1);
  const analyzeNormalizedRole = async (
    role: BaslerFixedRigSideBatchResult["captures"]["allOn"],
    analysisArtifact: CardGeometryNormalizedArtifact,
  ) => {
    const stats = applyFixedRigNormalizedCardBoundary(
      await analyzeFixedRigMacroQuality(analysisArtifact.localOutputPath),
      authoritativeGeometry,
    );
    const quadrantBrightness = await analyzeFixedRigQuadrants(analysisArtifact.localOutputPath);
    return {
      label: role.label,
      channel: role.channel,
      frames: role.frames ?? [],
      writes: role.writes ?? [],
      capture: role.capture,
      analysisArtifact,
      analysisCoordinateFrame: "normalized_card_portrait_pixels" as const,
      stats,
      quadrantBrightness,
    };
  };
  const [darkStats, acquisitionPlacementQuality] = await timed("rawImageAnalysis", () =>
    Promise.all([
      analyzeFixedRigMacroQuality(darkControlCapture.outputFilePath),
      analyzeFixedRigMacroQuality(batch.captures.allOn.capture.outputFilePath),
    ])
  );
  const normalizedRoleAnalysisInputs = [
    { role: batch.captures.allOn, artifact: normalizedCard.normalizedArtifact },
    { role: batch.captures.acceptedProfile, artifact: acceptedRegistration.normalizedArtifact },
    ...orderedChannelRoles.map((role, index) => ({
      role,
      artifact: channelRegistrations[index]!.normalizedArtifact,
    })),
  ];
  const normalizedRoleAnalyses = await timed("normalizedImageAnalysis", () =>
    mapWithConcurrency(
      normalizedRoleAnalysisInputs,
      FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY,
      ({ role, artifact }) => analyzeNormalizedRole(role, artifact),
    )
  );
  const allOn = normalizedRoleAnalyses[0]!;
  const acceptedProfile = normalizedRoleAnalyses[1]!;
  const channels = normalizedRoleAnalyses.slice(2).map((channelAnalysis, index) => ({
    ...channelAnalysis,
    channel: Number(orderedChannelRoles[index]!.channel),
  }));
  const channelDisplayImages: Array<{ channel: number; displayImage: FixedRigDisplayArtifact }> = channels.map((channelCapture) => ({
    channel: channelCapture.channel,
    displayImage: normalizedArtifactAsDisplay(
      channelCapture.analysisArtifact,
      channelCapture.capture,
      "normalized_channel_image",
    ),
  }));
  const roiDefinitions = normalizedCardRoiDefinitions(
    allOn.stats.width,
    allOn.stats.height,
    authoritativeGeometry,
  );
  const displayImage = normalizedArtifactAsDisplay(
    normalizedCard.normalizedArtifact,
    allOn.capture,
    "portrait_display_image",
  );
  const [overlayPreview, roiCrops] = await timed("roiDisplayGeneration", async () => Promise.all([
    createFixedRigOverlayPreview({
      sourceImagePath: displayImage.outputFilePath,
      outputDir: sideDir,
      filePrefix: `${side}-all-on`,
      quality: transformQualityForDisplay(allOn.stats, displayImage.displayTransform),
      roiDefinitions: roiDefinitions.map((roi) => (roi.displayRect ? { ...roi, rect: roi.displayRect } : roi)),
      title: `${side} evidence overlay`,
      displayTransform: displayImage.displayTransform,
      analysisCoordinateFrame: "normalized_card_portrait_pixels",
    }),
    createFixedRigRoiCrops({
      sourceDisplayImagePath: displayImage.outputFilePath,
      rawSourceImagePath: allOn.capture.outputFilePath,
      outputDir: path.join(sideDir, "roi-crops"),
      rois: roiDefinitions,
      displayTransform: displayImage.displayTransform,
      rawSourceSha256: allOn.capture.sha256,
      filePrefix: side,
      analysisCoordinateFrame: "normalized_card_portrait_pixels",
    }),
  ]));
  const surfaceAnalysis = buildFixedRigSurfaceAnalysis({
    side,
    channels: channels.map((channelCapture) => ({
      channel: channelCapture.channel,
      stats: channelCapture.stats,
      displayImage: channelDisplayImages.find((entry) => entry.channel === channelCapture.channel)?.displayImage,
    })),
    roiDefinitions,
    warnings: allOn.stats.warnings,
    registrationStatus: "normalized_geometry_transform",
  });
  const acquisitionFixtureCalibrationProfile = buildFixedRigFixtureCalibrationProfile({
    profileId: `${packageId}-${side}-rough-fixture-profile`,
    fixtureLabel: fixtureLabel ?? "operator-built-fixed-position-v1-fixture",
    fixtureId,
    referenceType: referenceType ?? "card_dimensions",
    referencePhysicalWidthMm: referenceWidthMm,
    referencePhysicalHeightMm: referenceHeightMm,
    horizontalSpanMm,
    horizontalStartPx,
    horizontalEndPx,
    verticalSpanMm,
    verticalStartPx,
    verticalEndPx,
    calibrationImagePath: allOn.capture.outputFilePath,
    rawImageWidth: acquisitionPlacementQuality.width,
    rawImageHeight: acquisitionPlacementQuality.height,
    cardBoundary: acquisitionPlacementQuality.cardBoundary,
    activeLightingProfile,
    exposureUs,
    gain,
    operatorAccepted: true,
    operatorNotes:
      referenceType === "fixed_metric_rulers"
        ? "Generated from warm fixed-rig V1 evidence package using operator-supplied fixed-ruler spans; still uncalibrated and diagnostic only."
        : "Generated from warm fixed-rig V1 evidence package; rough reference uses standard card dimensions.",
  });
  const normalizedProfileBase = buildFixedRigFixtureCalibrationProfile({
    profileId: `${packageId}-${side}-normalized-analysis-profile`,
    fixtureLabel: fixtureLabel ?? "operator-built-fixed-position-v1-fixture",
    fixtureId,
    referenceType: "card_dimensions",
    referencePhysicalWidthMm: FIXED_RIG_DEFAULT_CARD_WIDTH_MM,
    referencePhysicalHeightMm: FIXED_RIG_DEFAULT_CARD_HEIGHT_MM,
    rawImageWidth: allOn.stats.width,
    rawImageHeight: allOn.stats.height,
    cardBoundary: allOn.stats.cardBoundary,
    displayTransform: "none",
    activeLightingProfile,
    exposureUs,
    gain,
    operatorAccepted: true,
    operatorNotes:
      "Canonical 1200x1680 normalized card analysis uses standard 63.5x88.9 mm card dimensions. Raw ruler points and camera-frame placement remain only in acquisitionFixtureCalibrationProfile.",
  });
  const acquisitionReadiness = acquisitionFixtureCalibrationProfile.productionReadiness;
  const normalizedBaseReadiness = normalizedProfileBase.productionReadiness;
  const sourceGeometryReadinessNote =
    authoritativeGeometry.geometrySource === "manual_override"
      ? "Canonical framing came from explicit operator-confirmed manual geometry; automatic detection was not used and detector confidence remains 0."
      : `Canonical framing came from automatic geometry with source confidence ${authoritativeGeometry.confidence} (${authoritativeGeometry.confidenceBasis}) and placement state ${authoritativeGeometry.placementState}.`;
  const normalizedReadinessBlockers = uniqueWarnings([
    ...(normalizedBaseReadiness?.blockers ?? []).filter(
      (blocker) => !/framing|overlay alignment/i.test(blocker),
    ),
    authoritativeGeometry.geometrySource === "manual_override"
      ? "Automatic card geometry was not used; normalization used explicit operator-confirmed manual geometry."
      : undefined,
  ]);
  const normalizedProductionReadiness: FixedRigProductionReadinessSummary = {
    status: normalizedBaseReadiness?.status ?? "rejected",
    gates: {
      rulerCalibration: "fail",
      framing: "pass",
      overlayAlignment: "pass",
      repeatability: acquisitionReadiness?.gates.repeatability ?? "not_checked",
      lightingProfile: normalizedBaseReadiness?.gates.lightingProfile ?? "pass",
      finalSafeOff: acquisitionReadiness?.gates.finalSafeOff ?? "not_confirmed",
    },
    blockers: normalizedReadinessBlockers,
    diagnosticOnlyAllowedWithOperatorAcceptance:
      normalizedBaseReadiness?.diagnosticOnlyAllowedWithOperatorAcceptance ?? true,
    note:
      `Canonical output framing and acquisition geometry quality are separate. ${sourceGeometryReadinessNote} ` +
      "Grade inputs use normalized_card_portrait_pixels and do not use camera-frame offset.",
  };
  const fixtureCalibrationProfile: FixedRigFixtureCalibrationProfile & {
    analysisCoordinateFrame: "normalized_card_portrait_pixels";
    acquisitionPlacementExcludedFromGrade: true;
    acquisitionProfileId: string;
    normalizedCoordinateOutcome: {
      framingStatus: "pass";
      overlayAlignmentStatus: "pass";
      boundaryFillsCanonicalFrame: true;
      sourceGeometryQualityPreservedSeparately: true;
    };
    sourceGeometry: {
      geometrySource: CardGeometryMetadata["geometrySource"];
      captureMode: CardGeometryMetadata["captureMode"];
      detectionUsed: boolean;
      manualOverrideUsed: boolean;
      confidence: number;
      confidenceBasis: CardGeometryMetadata["confidenceBasis"];
      placementState: CardGeometryMetadata["placementState"];
      warnings: string[];
    };
    semanticOrientation: {
      status: "not_resolved_from_rectangle_geometry";
      operatorRequirement: string;
      limitation: string;
    };
  } = {
    ...normalizedProfileBase,
    rawCoordinateFrame: "normalized_card_portrait_pixels",
    detectedCardRectPx: { x: 0, y: 0, width: allOn.stats.width, height: allOn.stats.height },
    alignmentDeltaPx: { x: 0, y: 0 },
    alignmentDeltaMm: { x: 0, y: 0 },
    framingGate: {
      status: "pass" as const,
      marginLeftPx: 0,
      marginRightPx: 0,
      marginTopPx: 0,
      marginBottomPx: 0,
      centerOffsetPx: { x: 0, y: 0 },
      centerOffsetMm: { x: 0, y: 0 },
      aspectRatioError: 0,
      overlayAlignmentStatus: "pass" as const,
      warnings: uniqueWarnings([
        `Canonical-frame pass is a derived-coordinate outcome, not source detection perfection; source confidence remains ${authoritativeGeometry.confidence} (${authoritativeGeometry.confidenceBasis}) with placement state ${authoritativeGeometry.placementState}.`,
        ...authoritativeGeometry.warnings,
        FIXED_RIG_SEMANTIC_ORIENTATION_WARNING,
      ]),
    },
    productionReadiness: normalizedProductionReadiness,
    analysisCoordinateFrame: "normalized_card_portrait_pixels" as const,
    acquisitionPlacementExcludedFromGrade: true as const,
    acquisitionProfileId: acquisitionFixtureCalibrationProfile.profileId,
    normalizedCoordinateOutcome: {
      framingStatus: "pass" as const,
      overlayAlignmentStatus: "pass" as const,
      boundaryFillsCanonicalFrame: true as const,
      sourceGeometryQualityPreservedSeparately: true as const,
    },
    sourceGeometry: {
      geometrySource: authoritativeGeometry.geometrySource,
      captureMode: authoritativeGeometry.captureMode,
      detectionUsed: authoritativeGeometry.detectionUsed,
      manualOverrideUsed: authoritativeGeometry.manualOverrideUsed,
      confidence: authoritativeGeometry.confidence,
      confidenceBasis: authoritativeGeometry.confidenceBasis,
      placementState: authoritativeGeometry.placementState,
      warnings: [...authoritativeGeometry.warnings],
    },
    semanticOrientation: {
      status: "not_resolved_from_rectangle_geometry" as const,
      operatorRequirement: "Keep the printed top of the card toward the top of the live preview before capture.",
      limitation: FIXED_RIG_SEMANTIC_ORIENTATION_WARNING,
    },
    operatorNotes:
      `Grade inputs use canonical 1200x1680 normalized card coordinates and standard card dimensions. ${sourceGeometryReadinessNote} ` +
      "Camera-frame placement and raw ruler coordinates are retained only in acquisition diagnostics and excluded from grading.",
  };
  const diagnosticGrading = buildFixedRigDiagnosticGradingResult({
    side,
    quality: allOn.stats,
    roiDefinitions,
    fixtureCalibrationProfile,
    surfaceAnalysis,
    analysisCoordinateFrame: "normalized_card_portrait_pixels",
  });
  const rawEvidenceIntegrity = await timed("rawEvidenceIntegrity", () => verifyRawCaptureIntegrity([
    { role: "dark_control", capture: batch.captures.darkControl.capture },
    { role: "all_on", capture: batch.captures.allOn.capture },
    { role: "accepted_profile", capture: batch.captures.acceptedProfile.capture },
    ...orderedChannelRoles.map((role) => ({ role: `channel_${Number(role.channel)}`, capture: role.capture })),
  ]));
  const analysisCoordinateSystem = {
    version: "fixed-rig-normalized-card-analysis-v1",
    coordinateFrame: "normalized_card_portrait_pixels" as const,
    authoritativeGeometryRole: "all_on" as const,
    authoritativeGeometrySource: authoritativeGeometry.geometrySource,
    fullResolutionGeometryRequired: manualGeometryOverride ? "explicit_manual_capture" : "detected_ready",
    transformReusedForRoles: ["accepted_profile", ...orderedChannelRoles.map((role) => `channel_${Number(role.channel)}`)],
    acquisitionPlacementExcludedFromGrade: true,
    rawCoordinateFrame: "basler_sensor_pixels" as const,
    rawEvidenceIntegrityVerified: rawEvidenceIntegrity.verified,
    normalizedCoordinateOutcome: {
      framingStatus: "pass" as const,
      overlayAlignmentStatus: "pass" as const,
      boundaryFillsCanonicalFrame: true,
      note: "This describes the derived canonical image only and does not replace or upgrade source geometry confidence.",
    },
    sourceGeometry: {
      geometrySource: authoritativeGeometry.geometrySource,
      captureMode: authoritativeGeometry.captureMode,
      detectionUsed: authoritativeGeometry.detectionUsed,
      manualOverrideUsed: authoritativeGeometry.manualOverrideUsed,
      confidence: authoritativeGeometry.confidence,
      confidenceBasis: authoritativeGeometry.confidenceBasis,
      placementState: authoritativeGeometry.placementState,
      warnings: [...authoritativeGeometry.warnings],
    },
    semanticOrientation: {
      status: "not_resolved_from_rectangle_geometry" as const,
      operatorRequirement: "Keep the printed top of the card toward the top of the live preview before capture.",
      limitation: FIXED_RIG_SEMANTIC_ORIENTATION_WARNING,
    },
    processingConcurrency: {
      normalizedRoleNormalization: FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY,
      normalizedImageAnalysis: FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY,
      note: "Lossless normalized image operations are bounded to reduce Sharp worker and memory contention with live preview/back positioning.",
    },
    transform: {
      method: "authoritative_all_on_geometry_rotation_crop_canonical_resize_v1",
      geometryVersion: authoritativeGeometry.version,
      corners: authoritativeGeometry.corners,
      rotationDegrees: authoritativeGeometry.rotationDegrees,
      sourceImage: { ...authoritativeGeometry.image },
      outputImage: {
        width: normalizedCard.normalizedArtifact.imageWidth,
        height: normalizedCard.normalizedArtifact.imageHeight,
      },
      deskewAppliedDegrees: normalizedCard.normalizedArtifact.deskewAppliedDegrees,
      geometricResamplingApplied: normalizedCard.normalizedArtifact.geometricResamplingApplied,
      encodingLossless: normalizedCard.normalizedArtifact.encodingLossless,
      sourceCropWidth: normalizedCard.normalizedArtifact.sourceCropWidth,
      sourceCropHeight: normalizedCard.normalizedArtifact.sourceCropHeight,
      scaleX: normalizedCard.normalizedArtifact.scaleX,
      scaleY: normalizedCard.normalizedArtifact.scaleY,
      sourceResolutionGate: {
        status: "pass" as const,
        minimumSourceWidthPixels: FIXED_RIG_MIN_NORMALIZATION_SOURCE_WIDTH_PIXELS,
        minimumSourceHeightPixels: FIXED_RIG_MIN_NORMALIZATION_SOURCE_HEIGHT_PIXELS,
        maximumUpscale: FIXED_RIG_MAX_NORMALIZATION_UPSCALE,
        observedSourceWidthPixels: normalizedCard.normalizedArtifact.sourceCropWidth,
        observedSourceHeightPixels: normalizedCard.normalizedArtifact.sourceCropHeight,
        observedScaleX: normalizedCard.normalizedArtifact.scaleX,
        observedScaleY: normalizedCard.normalizedArtifact.scaleY,
      },
    },
  };
  const sideEvidence = {
    side,
    safeOffBeforeDark: batch.leimac?.safeOffStart,
    darkControl: { capture: darkControlCapture, stats: darkStats },
    allOn,
    acceptedProfile,
    channels,
    channelDisplayImages,
    roiDefinitions,
    displayImage,
    overlayPreview,
    roiCrops,
    normalizedCard,
    analysisCoordinateSystem,
    acquisitionPlacementDiagnostics: {
      coordinateFrame: "basler_sensor_pixels",
      quality: acquisitionPlacementQuality,
      geometry: authoritativeGeometry,
      excludedFromGrade: true,
    },
    acquisitionFixtureCalibrationProfile,
    fixtureCalibrationProfile,
    rawEvidenceIntegrity,
    surfaceAnalysis,
    diagnosticGrading,
  };
  const manifest = {
    packageId,
    packageDir,
    status: "completed",
    evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
    isCalibrated: false,
    rawCoordinateFrame: "basler_sensor_pixels",
    displayCoordinateFrame: "ai_grader_card_portrait_display",
    evidenceSide: side,
    captureProfile,
    captureProfilePlan: {
      rawEvidenceFormat,
      evidenceRoles: FIXED_RIG_CAPTURE_PROFILES[captureProfile].evidenceRoles,
      availableCaptureProfiles: ["full_forensic", "production_fast"],
      previousStableProfile: "full_forensic",
      productionFastOptIn: captureProfile === "production_fast",
      speedAcceptance: "pending_supervised_dell_timing",
      note: FIXED_RIG_CAPTURE_PROFILES[captureProfile].note,
    },
    geometryPolicy: {
      mode: manualGeometryOverride ? "manual_capture" : "automatic_detection",
      geometrySource: normalizedCard.geometry.geometrySource,
      detectionUsed: normalizedCard.geometry.detectionUsed,
      manualOverrideUsed: normalizedCard.geometry.manualOverrideUsed === true,
      legacyCardBoundaryRectIgnored: Boolean(cardBoundaryRect && !manualGeometryOverride),
      normalizedArtifactCreated: Boolean(normalizedCard.normalizedArtifact),
    },
    analysisCoordinateSystem,
    rawEvidenceIntegrity,
    captureTiming,
    processingTiming: {
      startedAt: processingStartedAt,
      phases: processingTiming,
      totalDurationMs: Math.max(0, Date.now() - processingStartedAtMs),
      frontProcessingMayOverlapFlip: side === "front",
      concurrencyLimits: {
        normalizedRoleNormalization: FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY,
        normalizedImageAnalysis: FIXED_RIG_NORMALIZED_PROCESSING_CONCURRENCY,
      },
    },
    executionPath: "warm_full_forensic_runner",
    activeLightingProfile,
    exposureUs,
    gain,
    warmBatch: {
      openedAt: batch.openedAt,
      finishedAt: batch.finishedAt,
      persistentBaslerSession: batch.persistentBaslerSession,
      persistentLeimacSession: batch.persistentLeimacSession,
      selectedChannels: batch.selectedChannels,
      dutyTenthsPercent: batch.dutyTenthsPercent,
      timing: batch.timing,
      safety: batch.safety,
    },
    safeOffStart: batch.leimac?.safeOffStart,
    safeOffEnd: batch.leimac?.safeOffEnd,
    [side]: sideEvidence,
    suggestedDinoLiteTargets: { status: "not_computed", reason: "surface anomaly detector not implemented yet" },
    note:
      `Warm fixed-rig V1 ${captureProfile} profile evidence package only; no final grade, certificate, or certified grading claim. Full evidence roles preserved.`,
  };
  const manifestPath = path.join(packageDir, "manifest.json");
  const analysisPath = path.join(packageDir, "analysis.json");
  const previewReportPath = path.join(packageDir, "preview-report.html");
  const manifestWithPaths = { ...manifest, manifestPath, analysisPath, previewReportPath };
  await timed("metadataWrites", async () => {
    await writeJsonArtifact(manifestPath, manifestWithPaths);
    await writeJsonArtifact(analysisPath, {
    status: "computed_diagnostic",
    evidenceClass: manifest.evidenceClass,
    executionPath: "warm_full_forensic_runner",
    captureProfile,
    rawEvidenceFormat,
    captureTiming,
    activeLightingProfile,
    [side]: {
      allOn: allOn.stats,
      acceptedProfile: acceptedProfile.stats,
      geometry: normalizedCard.geometry,
      normalizedCard,
      analysisCoordinateSystem,
      acquisitionPlacementDiagnostics: sideEvidence.acquisitionPlacementDiagnostics,
      rawEvidenceIntegrity,
      fixtureCalibrationProfile,
      surfaceAnalysis,
      diagnosticGrading,
    },
    finalGradeComputed: false,
    certifiedClaim: false,
    });
    await writeFile(previewReportPath, renderWarmFixedRigEvidencePackageReport({ side, activeLightingProfile, sideEvidence, manifest: manifestWithPaths }), "utf-8");
  });
  return {
    executionPath: "warm_full_forensic_runner",
    packageId,
    packageDir,
    manifestPath,
    analysisPath,
    previewReportPath,
    manifest: manifestWithPaths,
  };
}

export async function createFixedRigWarmEvidencePackage(input: FixedRigWarmEvidencePackageInput): Promise<FixedRigWarmEvidencePackageResult> {
  return processFixedRigWarmSideBatch(await captureFixedRigWarmSideBatch(input));
}

function renderWarmFixedRigEvidencePackageReport(input: {
  side: FixedRigCardSide;
  activeLightingProfile: FixedRigActiveLightingProfile;
  sideEvidence: {
    displayImage: FixedRigDisplayArtifact;
    overlayPreview: FixedRigOverlayArtifact;
    acceptedProfile: { capture: BaslerCaptureStillResult };
    channelDisplayImages: Array<{ channel: number; displayImage: FixedRigDisplayArtifact }>;
    roiCrops: FixedRigDisplayArtifact[];
    normalizedCard: CardGeometryNormalizationResult;
    fixtureCalibrationProfile: FixedRigFixtureCalibrationProfile;
    surfaceAnalysis: FixedRigSurfaceAnalysis;
    diagnosticGrading: FixedRigDiagnosticGradingResult;
  };
  manifest: Record<string, unknown>;
}): string {
  const side = input.side;
  const sideTitle = side === "front" ? "Front" : "Back";
  const normalizedImage = input.sideEvidence.normalizedCard.normalizedArtifact?.localOutputPath;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Warm Fixed-Rig V1 Evidence Package - Provisional Diagnostic</title><style>body{font-family:Arial,sans-serif;margin:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}img{max-width:100%;border:1px solid #aaa;background:#111}.warn{border-left:4px solid #a33;padding:8px 12px;background:#fff}.banner{border:2px solid #a33;background:#fff4f4;padding:12px 16px;font-weight:bold}table{border-collapse:collapse;width:100%;margin:8px 0 16px}td,th{border:1px solid #bbb;padding:6px 8px;text-align:left}</style></head><body><h1>Warm Fixed-Rig V1 Evidence Package</h1><p class="banner">Provisional Diagnostic Only - Not Certified - No Final Grade</p><p class="warn">The explicitly selected capture profile preserved dark control, all-on, accepted profile, and Leimac channels 1-8. Raw Basler evidence remains in sensor coordinates; normalized/display/ROI assets are derived outputs.</p><p>Execution path warm_full_forensic_runner. Duty ${escapeHtml(input.activeLightingProfile.selectedDutyPercent)}% PWM ${escapeHtml(input.activeLightingProfile.actualLeimacPwmStep)}; channels ${escapeHtml(input.activeLightingProfile.selectedChannels.join(", "))}; source ${escapeHtml(input.activeLightingProfile.profileSource)}.</p><h2>${sideTitle} Normalized Card</h2><p>Placement ${escapeHtml(input.sideEvidence.normalizedCard.geometry.placementState)}; geometry ${escapeHtml(input.sideEvidence.normalizedCard.geometry.geometrySource)}; capture ${escapeHtml(input.sideEvidence.normalizedCard.geometry.captureMode ?? "automatic_detection")}; rotation ${escapeHtml(input.sideEvidence.normalizedCard.geometry.rotationDegrees ?? "not detected")} degrees; confidence ${escapeHtml(input.sideEvidence.normalizedCard.geometry.confidence)}.</p>${normalizedImage ? `<img src="${escapeHtml(normalizedImage)}" alt="${side} normalized crop and deskew artifact">` : "<p>Automatic geometry did not produce a normalized artifact. Reposition and recapture, or use an explicit operator-confirmed manual capture override.</p>"}<h2>${sideTitle} Portrait Evidence</h2><img src="${escapeHtml(input.sideEvidence.displayImage.outputFilePath)}" alt="${side} portrait all-on"><img src="${escapeHtml(input.sideEvidence.overlayPreview.outputFilePath)}" alt="${side} portrait overlay"><p>Accepted profile raw capture: ${escapeHtml(input.sideEvidence.acceptedProfile.capture.outputFilePath)}</p><p>Rough profile: ${escapeHtml(input.sideEvidence.fixtureCalibrationProfile.status)}; pixel/mm ${escapeHtml(input.sideEvidence.fixtureCalibrationProfile.mmPerPixelX ?? "not_computed")} x ${escapeHtml(input.sideEvidence.fixtureCalibrationProfile.mmPerPixelY ?? "not_computed")}; diagnostic grading ${escapeHtml(input.sideEvidence.diagnosticGrading.status)}; surface ${escapeHtml(input.sideEvidence.surfaceAnalysis.status)}; candidates ${escapeHtml(input.sideEvidence.surfaceAnalysis.candidates.length)}.</p><table><tr><th>Centering</th><td>${escapeHtml(input.sideEvidence.diagnosticGrading.centering.status)} score ${escapeHtml(input.sideEvidence.diagnosticGrading.centering.score ?? "not_computed")}</td></tr><tr><th>Corners</th><td>TL ${escapeHtml(input.sideEvidence.diagnosticGrading.corners.topLeft.status)}, TR ${escapeHtml(input.sideEvidence.diagnosticGrading.corners.topRight.status)}, BR ${escapeHtml(input.sideEvidence.diagnosticGrading.corners.bottomRight.status)}, BL ${escapeHtml(input.sideEvidence.diagnosticGrading.corners.bottomLeft.status)}</td></tr><tr><th>Edges</th><td>T ${escapeHtml(input.sideEvidence.diagnosticGrading.edges.top.status)}, R ${escapeHtml(input.sideEvidence.diagnosticGrading.edges.right.status)}, B ${escapeHtml(input.sideEvidence.diagnosticGrading.edges.bottom.status)}, L ${escapeHtml(input.sideEvidence.diagnosticGrading.edges.left.status)}</td></tr><tr><th>Surface candidates</th><td>${escapeHtml(input.sideEvidence.surfaceAnalysis.candidates.map((candidate) => `${candidate.candidateId} ${candidate.severityBand} ${candidate.anomalyProxyScore}`).join(", ") || "none")}</td></tr></table><h3>${sideTitle} 8-channel portrait displays</h3><div class="grid">${input.sideEvidence.channelDisplayImages.map((entry) => `<figure><img src="${escapeHtml(entry.displayImage.outputFilePath)}" alt="${side} channel ${entry.channel} portrait"><figcaption>${side} channel ${entry.channel}</figcaption></figure>`).join("")}</div><h2>ROI Crops</h2><div class="grid">${input.sideEvidence.roiCrops.map((crop) => `<figure><img src="${escapeHtml(crop.outputFilePath)}" alt="${escapeHtml(crop.roiId)}"><figcaption>${escapeHtml(crop.roiId)}</figcaption></figure>`).join("")}</div><h2>Diagnostic JSON</h2><pre>${escapeHtml(JSON.stringify({ diagnosticGrading: input.sideEvidence.diagnosticGrading, geometry: input.sideEvidence.normalizedCard.geometry, manifest: input.manifest }, null, 2))}</pre></body></html>`;
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
  const framing = profile.framingGate;
  const production = profile.productionReadiness;
  return `<table><tbody>
    <tr><th>Status</th><td>${escapeHtml(profile.status)}</td></tr>
    <tr><th>isCalibrated</th><td>${escapeHtml(profile.isCalibrated)}</td></tr>
    <tr><th>Fixture</th><td>${escapeHtml(profile.fixtureLabel)} ${escapeHtml(profile.fixtureId ?? "")}</td></tr>
    <tr><th>Reference</th><td>${escapeHtml(profile.referenceType)} ${escapeHtml(profile.referencePhysicalWidthMm)}mm x ${escapeHtml(profile.referencePhysicalHeightMm)}mm</td></tr>
    <tr><th>Ruler spans</th><td>horizontal ${escapeHtml(profile.horizontalSpanMm ?? "not_supplied")}mm ${escapeHtml(profile.horizontalStartPx ? `${profile.horizontalStartPx.x},${profile.horizontalStartPx.y}` : "")} -> ${escapeHtml(profile.horizontalEndPx ? `${profile.horizontalEndPx.x},${profile.horizontalEndPx.y}` : "")}; vertical ${escapeHtml(profile.verticalSpanMm ?? "not_supplied")}mm ${escapeHtml(profile.verticalStartPx ? `${profile.verticalStartPx.x},${profile.verticalStartPx.y}` : "")} -> ${escapeHtml(profile.verticalEndPx ? `${profile.verticalEndPx.x},${profile.verticalEndPx.y}` : "")}</td></tr>
    <tr><th>Calibration image</th><td>${escapeHtml(profile.calibrationImagePath ?? "not_captured")}</td></tr>
    <tr><th>Coordinate frames</th><td>raw=${escapeHtml(profile.rawCoordinateFrame)}, transform=${escapeHtml(profile.displayTransform)}, display=${escapeHtml(profile.displayCoordinateFrame)}</td></tr>
    <tr><th>Pixel/mm</th><td>${escapeHtml(profile.pixelPerMmX ?? "not_computed")} x ${escapeHtml(profile.pixelPerMmY ?? "not_computed")}</td></tr>
    <tr><th>mm/pixel</th><td>${escapeHtml(profile.mmPerPixelX ?? "not_computed")} x ${escapeHtml(profile.mmPerPixelY ?? "not_computed")}</td></tr>
    <tr><th>X/Y consistency</th><td>${escapeHtml(profile.pixelToMmConsistency.status)} ${escapeHtml(profile.pixelToMmConsistency.relativeDifference ?? "")} ${escapeHtml(profile.pixelToMmConsistency.warning ?? "")}</td></tr>
    <tr><th>Aspect</th><td>expected ${escapeHtml(profile.expectedCardAspectRatio)}; detected ${escapeHtml(profile.detectedCardAspectRatio ?? "not_computed")}</td></tr>
    <tr><th>Framing gate</th><td>${escapeHtml(framing?.status ?? "not_computed")} margins px=${escapeHtml(framing ? `${framing.marginLeftPx}/${framing.marginRightPx}/${framing.marginTopPx}/${framing.marginBottomPx}` : "")}; margins mm=${escapeHtml(framing ? `${framing.marginLeftMm ?? ""}/${framing.marginRightMm ?? ""}/${framing.marginTopMm ?? ""}/${framing.marginBottomMm ?? ""}` : "")}; aspectError=${escapeHtml(framing?.aspectRatioError ?? "")}; warnings=${escapeHtml(framing?.warnings.join("; ") ?? "")}</td></tr>
    <tr><th>Overlay scale</th><td>profile=${escapeHtml(profile.overlayUsesCalibrationProfileId ?? "")}; source=${escapeHtml(profile.overlayScaleSource ?? "not_computed")}; expectedCardRectPx=${escapeHtml(profile.expectedCardRectPx ? `${profile.expectedCardRectPx.width} x ${profile.expectedCardRectPx.height}` : "not_computed")}; detectedCardRectPx=${escapeHtml(profile.detectedCardRectPx ? `${profile.detectedCardRectPx.x},${profile.detectedCardRectPx.y},${profile.detectedCardRectPx.width},${profile.detectedCardRectPx.height}` : "not_computed")}; deltaPx=${escapeHtml(profile.alignmentDeltaPx ? `${profile.alignmentDeltaPx.x},${profile.alignmentDeltaPx.y}` : "not_computed")}</td></tr>
    <tr><th>Production readiness</th><td>${escapeHtml(production?.status ?? "not_computed")} gates=${escapeHtml(production ? JSON.stringify(production.gates) : "")}; blockers=${escapeHtml(production?.blockers.join("; ") ?? "")}</td></tr>
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

type FixedRigEvidencePackageJson = Record<string, any>;

async function readJsonFile(filePath: string): Promise<FixedRigEvidencePackageJson> {
  return JSON.parse(await readFile(filePath, "utf-8")) as FixedRigEvidencePackageJson;
}

function evidenceSideFromPackage(manifest: FixedRigEvidencePackageJson, side: FixedRigCardSide): FixedRigEvidencePackageJson | undefined {
  const value = manifest[side];
  return value && typeof value === "object" ? value : undefined;
}

function sideDiagnosticFromAnalysis(analysis: FixedRigEvidencePackageJson, side: FixedRigCardSide): FixedRigEvidencePackageJson | undefined {
  const value = analysis[side]?.diagnosticGrading;
  return value && typeof value === "object" ? value : undefined;
}

function sideSurfaceFromAnalysis(analysis: FixedRigEvidencePackageJson, side: FixedRigCardSide): FixedRigEvidencePackageJson | undefined {
  const value = analysis[side]?.surfaceAnalysis;
  return value && typeof value === "object" ? value : undefined;
}

function sideAllOnStats(side: FixedRigEvidencePackageJson | undefined): FixedRigQualityMetrics | undefined {
  return side?.allOn?.stats;
}

function sideClippingWarning(sideLabel: string, stats: FixedRigQualityMetrics | undefined): string | undefined {
  const clipped = stats?.clippedPixelFraction;
  if (clipped === undefined) return `${sideLabel} clipping metrics are unavailable.`;
  if (clipped > 0.1) return `${sideLabel} clipping is high (${clipped}); lower preview duty and/or exposure before relying on diagnostics.`;
  if (clipped > 0.02) return `${sideLabel} clipping exceeds the soft target (${clipped}); confidence is reduced.`;
  return undefined;
}

function diagnosticStatusText(diagnostic: FixedRigEvidencePackageJson | undefined, element: string): string {
  const value = diagnostic?.[element];
  if (!value || typeof value !== "object") return "insufficient_evidence";
  const score = value.score === undefined ? "" : ` score ${value.score}`;
  return `${value.status ?? "not_computed"}${score}`;
}

function cornerStatusText(diagnostic: FixedRigEvidencePackageJson | undefined): string {
  const corners = diagnostic?.corners ?? {};
  return [
    `TL ${corners.topLeft?.status ?? "not_computed"}`,
    `TR ${corners.topRight?.status ?? "not_computed"}`,
    `BR ${corners.bottomRight?.status ?? "not_computed"}`,
    `BL ${corners.bottomLeft?.status ?? "not_computed"}`,
  ].join(", ");
}

function edgeStatusText(diagnostic: FixedRigEvidencePackageJson | undefined): string {
  const edges = diagnostic?.edges ?? {};
  return [
    `T ${edges.top?.status ?? "not_computed"}`,
    `R ${edges.right?.status ?? "not_computed"}`,
    `B ${edges.bottom?.status ?? "not_computed"}`,
    `L ${edges.left?.status ?? "not_computed"}`,
  ].join(", ");
}

function surfaceCandidateText(surface: FixedRigEvidencePackageJson | undefined): string {
  const candidates = Array.isArray(surface?.candidates) ? surface.candidates : [];
  if (!candidates.length) return "No V0 candidate emitted.";
  return candidates
    .map((candidate) => `${candidate.candidateId ?? "candidate"} ${candidate.severityBand ?? "unknown"} ${candidate.anomalyProxyScore ?? ""}`.trim())
    .join(", ");
}

function premiumMetricCard(label: string, value: unknown, note?: string): string {
  return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
}

function reportImage(filePath: string | undefined, alt: string): string {
  if (!filePath) return `<div class="missing">Missing ${escapeHtml(alt)}</div>`;
  return `<img src="${escapeHtml(filePath)}" alt="${escapeHtml(alt)}">`;
}

function callout(label: string, status: string, className: string): string {
  return `<div class="callout ${escapeHtml(className)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(status)}</strong><small>provisional_diagnostic</small></div>`;
}

function roiGallery(sideLabel: string, side: FixedRigEvidencePackageJson | undefined): string {
  const crops = Array.isArray(side?.roiCrops) ? side.roiCrops : [];
  if (!crops.length) return `<p>${escapeHtml(sideLabel)} ROI crops are unavailable.</p>`;
  return `<div class="thumb-grid">${crops
    .map(
      (crop) =>
        `<figure>${reportImage(crop.outputFilePath, `${sideLabel} ${crop.roiId ?? "ROI"} crop`)}<figcaption>${escapeHtml(sideLabel)} ${escapeHtml(crop.roiId ?? "ROI")}</figcaption></figure>`
    )
    .join("")}</div>`;
}

function channelGallery(sideLabel: string, side: FixedRigEvidencePackageJson | undefined): string {
  const channels = Array.isArray(side?.channelDisplayImages) ? side.channelDisplayImages : [];
  if (!channels.length) return `<p>${escapeHtml(sideLabel)} channel displays are unavailable.</p>`;
  return `<div class="thumb-grid compact">${channels
    .map(
      (entry) =>
        `<figure>${reportImage(entry.displayImage?.outputFilePath, `${sideLabel} channel ${entry.channel}`)}<figcaption>${escapeHtml(sideLabel)} channel ${escapeHtml(entry.channel)}</figcaption></figure>`
    )
    .join("")}</div>`;
}

function lightDirectionSummary(surface: FixedRigEvidencePackageJson | undefined): string {
  const lightDirection = surface?.lightDirection;
  if (!lightDirection || lightDirection.status === "missing") return "Light direction prep artifacts are unavailable.";
  const profile = lightDirection.profile ?? {};
  const confidence = lightDirection.confidence ?? {};
  return `Status ${lightDirection.status}; mapping ${profile.physicalDirectionMappingStatus ?? "pending"}; flat field ${profile.flatFieldStatus ?? "unknown"}; normal map ${profile.normalMapStatus ?? "unknown"}; confidence ${confidence.band ?? "unknown"} ${confidence.score ?? ""}`.trim();
}

function channelBalanceTable(surface: FixedRigEvidencePackageJson | undefined): string {
  const rows = Array.isArray(surface?.lightDirection?.channelBalance) ? surface.lightDirection.channelBalance : [];
  if (!rows.length) return "<p>Channel balance metrics are unavailable.</p>";
  return `<table><thead><tr><th>Channel</th><th>Mean</th><th>Max</th><th>Clipped</th><th>Dark</th><th>Ratio vs median</th><th>Recommended scale</th></tr></thead><tbody>
    ${rows
      .map(
        (row: FixedRigEvidencePackageJson) =>
          `<tr><td>${escapeHtml(row.channel)}</td><td>${escapeHtml(row.mean)}</td><td>${escapeHtml(row.max)}</td><td>${escapeHtml(row.clippedPixelFraction)}</td><td>${escapeHtml(row.darkPixelFraction)}</td><td>${escapeHtml(row.responseRatioVsMedian)}</td><td>${escapeHtml(row.recommendedIntensityScale)}</td></tr>`
      )
      .join("")}
  </tbody></table>`;
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function artifactRef(artifact: FixedRigEvidencePackageJson | undefined, label: string, role: string): FixedRigEvidencePackageJson {
  return artifact?.outputFilePath
    ? {
        label,
        role,
        outputFilePath: artifact.outputFilePath,
        rawSourceSha256: artifact.rawSourceSha256,
        displayTransform: artifact.displayTransform,
        rawCoordinateFrame: artifact.rawCoordinateFrame,
        displayCoordinateFrame: artifact.displayCoordinateFrame,
        imageWidth: artifact.imageWidth,
        imageHeight: artifact.imageHeight,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
        artifactRole: artifact.artifactRole,
        sourceInputPaths: artifact.sourceInputPaths,
        physicalDirectionMappingStatus: artifact.physicalDirectionMappingStatus,
      }
    : { label, role, status: "missing" };
}

function diagnosticElementSummary(element: FixedRigEvidencePackageJson | undefined): FixedRigEvidencePackageJson {
  return {
    status: element?.status ?? "insufficient_evidence",
    score: element?.score ?? null,
    confidence: element?.confidence ?? 0,
    warnings: Array.isArray(element?.warnings) ? element.warnings : [],
  };
}

function diagnosticSideSummary(diagnostic: FixedRigEvidencePackageJson | undefined): FixedRigEvidencePackageJson {
  return {
    centering: diagnosticElementSummary(diagnostic?.centering),
    corners: {
      topLeft: diagnosticElementSummary(diagnostic?.corners?.topLeft),
      topRight: diagnosticElementSummary(diagnostic?.corners?.topRight),
      bottomRight: diagnosticElementSummary(diagnostic?.corners?.bottomRight),
      bottomLeft: diagnosticElementSummary(diagnostic?.corners?.bottomLeft),
    },
    edges: {
      top: diagnosticElementSummary(diagnostic?.edges?.top),
      right: diagnosticElementSummary(diagnostic?.edges?.right),
      bottom: diagnosticElementSummary(diagnostic?.edges?.bottom),
      left: diagnosticElementSummary(diagnostic?.edges?.left),
    },
    surface: diagnosticElementSummary(diagnostic?.surface),
    warnings: Array.isArray(diagnostic?.warnings) ? diagnostic.warnings : [],
  };
}

function normalizeCandidate(candidate: FixedRigEvidencePackageJson, side: FixedRigCardSide): FixedRigEvidencePackageJson {
  return {
    candidateId: candidate.candidateId ?? `${side}-surface-candidate`,
    side,
    category: "surface",
    severityBand: candidate.severityBand ?? "low",
    confidence: candidate.confidenceBand ?? candidate.confidence ?? "low",
    anomalyProxyScore: candidate.anomalyProxyScore ?? candidate.severityProxy ?? 0,
    severityProxy: candidate.severityProxy ?? candidate.anomalyProxyScore ?? 0,
    analysisGeometry: candidate.analysisGeometry,
    analysisRect: candidate.analysisRect,
    analysisCoordinateFrame: candidate.analysisCoordinateFrame,
    displayRect: candidate.displayRect,
    displayCoordinateFrame: candidate.displayCoordinateFrame,
    rawRect: candidate.rawRect,
    rawCoordinateFrame: candidate.rawCoordinateFrame,
    sourceChannels: Array.isArray(candidate.sourceChannels) ? candidate.sourceChannels : [],
    strongestChannel: candidate.strongestChannel,
    physicalDirectionMappingStatus: candidate.physicalDirectionMappingStatus ?? "pending",
    needsDinoLiteFollowUp: Boolean(candidate.needsDinoLiteFollowUp),
    evidenceRefs: candidate.evidenceRefs,
    explanation:
      candidate.explanation ??
      "Surface Vision V0 highlighted this provisional candidate from directional light evidence. It is not a final surface grade.",
  };
}

function visionLabSidePayload(input: {
  sideName: FixedRigCardSide;
  side: FixedRigEvidencePackageJson | undefined;
  diagnostic: FixedRigEvidencePackageJson | undefined;
  surface: FixedRigEvidencePackageJson | undefined;
  stats: FixedRigQualityMetrics | undefined;
  clippingWarning?: string;
}): FixedRigEvidencePackageJson {
  const channels = Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    const fromSide = Array.isArray(input.side?.channelDisplayImages)
      ? input.side.channelDisplayImages.find((entry: FixedRigEvidencePackageJson) => Number(entry.channel) === channel)
      : undefined;
    const fromSurface = Array.isArray(input.surface?.perChannelStats)
      ? input.surface.perChannelStats.find((entry: FixedRigEvidencePackageJson) => Number(entry.channel) === channel)
      : undefined;
    return {
      channel,
      label: `Channel ${channel}`,
      mappingStatus: "physical_direction_calibration_pending",
      image: artifactRef(fromSide?.displayImage ?? fromSurface?.portraitDisplayImage, `${input.sideName} channel ${channel}`, "directional_light_channel"),
      stats: fromSurface
        ? {
            mean: fromSurface.mean,
            max: fromSurface.max,
            clippedPixelFraction: fromSurface.clippedPixelFraction,
            darkPixelFraction: fromSurface.darkPixelFraction,
            sharpnessScore: fromSurface.sharpnessScore,
            anomalyProxyMetric: fromSurface.anomalyProxyMetric,
          }
        : undefined,
    };
  });
  const candidates = Array.isArray(input.surface?.candidates)
    ? input.surface.candidates.map((candidate: FixedRigEvidencePackageJson) => normalizeCandidate(candidate, input.sideName))
    : [];
  const roiCrops = Array.isArray(input.side?.roiCrops)
    ? input.side.roiCrops.map((crop: FixedRigEvidencePackageJson) => ({
        roiId: crop.roiId,
        label: crop.roiId ?? "ROI",
        outputFilePath: crop.outputFilePath,
        coordinateFrame: crop.displayCoordinateFrame ?? "ai_grader_card_portrait_display",
        rawCoordinateFrame: crop.rawCoordinateFrame ?? "basler_sensor_pixels",
      }))
    : [];
  const confidenceWarnings = [
    input.clippingWarning,
    ...(Array.isArray(input.stats?.warnings) ? input.stats.warnings : []),
    ...(Array.isArray(input.diagnostic?.warnings) ? input.diagnostic.warnings : []),
    ...(Array.isArray(input.surface?.warnings) ? input.surface.warnings : []),
  ].filter(Boolean);
  return {
    side: input.sideName,
    status: input.side ? "available" : "insufficient_evidence",
    trueView: artifactRef(input.side?.displayImage, `${input.sideName} True View portrait image`, "true_view"),
    overlay: artifactRef(input.side?.overlayPreview, `${input.sideName} measurement overlay/debug image`, "measurement_overlay"),
    allOn: artifactRef(input.side?.allOn?.capture, `${input.sideName} all-on raw evidence`, "all_on_raw"),
    acceptedProfile: artifactRef(input.side?.acceptedProfile?.capture, `${input.sideName} accepted-profile raw evidence`, "accepted_profile_raw"),
    heatmap: artifactRef(input.surface?.heatmap, `${input.sideName} anomaly heatmap`, "surface_heatmap"),
    surfaceVision: artifactRef(input.surface?.surfaceVision, `${input.sideName} Surface Vision V0`, "surface_vision"),
    glareMask: artifactRef(input.surface?.glareMask, `${input.sideName} glare/clipping mask`, "confidence_mask"),
    underexposureMask: artifactRef(input.surface?.underexposureMask, `${input.sideName} underexposure mask`, "confidence_mask"),
    normalProxy: artifactRef(input.surface?.normalProxy, `${input.sideName} preliminary normal proxy`, "normal_proxy"),
    gradientMagnitude: artifactRef(input.surface?.gradientMagnitude, `${input.sideName} gradient magnitude proxy`, "gradient_magnitude"),
    reliefProxy: artifactRef(input.surface?.reliefProxy, `${input.sideName} relief proxy`, "relief_proxy"),
    confidenceMap: artifactRef(input.surface?.confidenceMap, `${input.sideName} light-direction confidence map`, "confidence_map"),
    channels,
    roiCrops,
    candidates,
    surfaceIntelligence: input.surface
      ? {
          detectorId: input.surface.detectorId,
          version: input.surface.version,
          status: input.surface.status,
          confidence: input.surface.confidence,
          normalization: input.surface.normalization,
          masks: input.surface.masks,
          physicalDirectionMappingStatus: input.surface.physicalDirectionMappingStatus,
        }
      : { status: "missing" },
    lightDirection: input.surface?.lightDirection ?? { status: "missing" },
    diagnostics: diagnosticSideSummary(input.diagnostic),
    quality: input.stats
      ? {
          mean: input.stats.mean,
          max: input.stats.max,
          clippedPixelFraction: input.stats.clippedPixelFraction,
          darkPixelFraction: input.stats.darkPixelFraction,
          sharpnessScore: input.stats.sharpnessScore,
          cardBoundary: input.stats.cardBoundary,
          overlayAlignment: input.stats.overlayAlignment,
        }
      : { status: "missing" },
    confidenceWarnings,
  };
}

function buildVisionLabData(input: {
  packageId: string;
  generatedAt: string;
  front: FixedRigEvidencePackageJson | undefined;
  back: FixedRigEvidencePackageJson | undefined;
  frontDiagnostic: FixedRigEvidencePackageJson | undefined;
  backDiagnostic: FixedRigEvidencePackageJson | undefined;
  frontSurface: FixedRigEvidencePackageJson | undefined;
  backSurface: FixedRigEvidencePackageJson | undefined;
  frontStats: FixedRigQualityMetrics | undefined;
  backStats: FixedRigQualityMetrics | undefined;
  activeProfile: FixedRigEvidencePackageJson | undefined;
  fixtureProfile: FixedRigEvidencePackageJson | undefined;
  provisionalGradeStory?: FixedRigProvisionalGradeStoryResult;
  warnings: string[];
}): FixedRigEvidencePackageJson {
  const frontClipping = sideClippingWarning("Front", input.frontStats);
  const backClipping = sideClippingWarning("Back", input.backStats);
  const measurementAvailable =
    input.fixtureProfile?.referenceType === "fixed_metric_rulers" &&
    typeof input.fixtureProfile?.mmPerPixelX === "number" &&
    typeof input.fixtureProfile?.mmPerPixelY === "number";
  return {
    schemaVersion: "ten-kings-vision-lab-v0.1",
    packageId: input.packageId,
    generatedAt: input.generatedAt,
    mode: "local_static_report",
    banner: "Provisional Diagnostic - Not Certified - No Final Grade",
    evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
    isCalibrated: false,
    finalGradeComputed: false,
    certifiedClaim: false,
    imagingNote:
      "Monochrome Basler evidence is used for high-detail surface analysis. Later color photography can be added as a customer visual layer.",
    surfaceVisionNote:
      "Surface Vision V0 - directional light evidence visualization. This is not certified photometric stereo.",
    normalReliefProxyNote:
      "Preliminary normal/relief proxy - approximate directional model. Physical light vectors are not certified, so this is not certified photometric stereo.",
    channelMappingStatus: "physical_direction_calibration_pending",
    provisionalGradeStory: input.provisionalGradeStory,
    gradeImpactCandidates: input.provisionalGradeStory?.gradeImpactCandidates ?? [],
    activeLightingProfile: input.activeProfile,
    measurementOverlay: {
      status: measurementAvailable ? "available" : "unavailable",
      unavailableReason: measurementAvailable ? undefined : "Ruler calibration metadata is missing; measurement overlay is not guessed.",
      calibrationProfileId: input.fixtureProfile?.profileId,
      referenceType: input.fixtureProfile?.referenceType,
      mmPerPixelX: input.fixtureProfile?.mmPerPixelX,
      mmPerPixelY: input.fixtureProfile?.mmPerPixelY,
      pixelsPerMmX: input.fixtureProfile?.pixelPerMmX,
      pixelsPerMmY: input.fixtureProfile?.pixelPerMmY,
      rawCoordinateFrame: input.fixtureProfile?.rawCoordinateFrame ?? "basler_sensor_pixels",
      displayTransform: input.fixtureProfile?.displayTransform,
      displayCoordinateFrame: input.fixtureProfile?.displayCoordinateFrame ?? "ai_grader_card_portrait_display",
      expectedCardRectMm: { width: FIXED_RIG_DEFAULT_CARD_WIDTH_MM, height: FIXED_RIG_DEFAULT_CARD_HEIGHT_MM },
      expectedCardRectPx: input.fixtureProfile?.expectedCardRectPx,
      detectedCardRectPx: input.fixtureProfile?.detectedCardRectPx,
      alignmentDeltaPx: input.fixtureProfile?.alignmentDeltaPx,
      alignmentDeltaMm: input.fixtureProfile?.alignmentDeltaMm,
      framingGate: input.fixtureProfile?.framingGate,
      overlayScaleSource: input.fixtureProfile?.overlayScaleSource,
    },
    confidenceLens: {
      clippingWarnings: [frontClipping, backClipping].filter(Boolean),
      focusFramingWarnings: input.warnings,
      note: "Confidence Lens highlights where evidence is strong or weak; it does not change raw evidence files.",
    },
    severityFilters: ["low", "medium", "high"],
    views: [
      "true_view",
      "surface_vision",
      "heatmap",
      "normal_proxy",
      "relief_proxy",
      "confidence_map",
      "light_sweep",
      "measurement_overlay",
      "confidence_lens",
      "evidence_replay",
    ],
    sides: {
      front: visionLabSidePayload({
        sideName: "front",
        side: input.front,
        diagnostic: input.frontDiagnostic,
        surface: input.frontSurface,
        stats: input.frontStats,
        clippingWarning: frontClipping,
      }),
      back: visionLabSidePayload({
        sideName: "back",
        side: input.back,
        diagnostic: input.backDiagnostic,
        surface: input.backSurface,
        stats: input.backStats,
        clippingWarning: backClipping,
      }),
    },
  };
}

function visionLabSection(data: FixedRigEvidencePackageJson): string {
  return `<section class="vision-lab" id="ten-kings-vision-lab" data-vision-lab>
    <div class="lab-header">
      <div>
        <p class="eyebrow">Ten Kings Vision Lab V0</p>
        <h2>Interactive Evidence Inspection</h2>
        <p class="lab-intro">Premium forensic intelligence view for front/back Basler evidence, 8-channel directional lighting, measurement overlays, and confidence review.</p>
      </div>
      <div class="lab-mode" role="group" aria-label="Vision Lab mode">
        <button type="button" class="lab-pill active" data-lab-mode="collector">Collector Mode</button>
        <button type="button" class="lab-pill" data-lab-mode="expert">Expert Mode</button>
      </div>
    </div>
    <div class="lab-shell">
      <aside class="lab-sidebar" aria-label="Vision Lab controls">
        <div class="lab-control-group">
          <span class="control-label">Side</span>
          <div class="segmented">
            <button type="button" class="active" data-side="front">Front</button>
            <button type="button" data-side="back">Back</button>
          </div>
        </div>
        <div class="lab-control-group">
          <span class="control-label">View</span>
          <div class="view-stack">
            <button type="button" class="active" data-view="true_view">True View</button>
            <button type="button" data-view="surface_vision">Surface Vision</button>
            <button type="button" data-view="heatmap">Heatmap</button>
            <button type="button" data-view="normal_proxy">Normal Proxy</button>
            <button type="button" data-view="relief_proxy">Relief Proxy</button>
            <button type="button" data-view="confidence_map">Confidence Map</button>
            <button type="button" data-view="light_sweep">Light Sweep Wheel</button>
            <button type="button" data-view="measurement_overlay">Measurement Overlay</button>
            <button type="button" data-view="confidence_lens">Confidence Lens</button>
            <button type="button" data-view="evidence_replay">Evidence Replay</button>
          </div>
        </div>
        <div class="lab-control-group">
          <span class="control-label">Light Sweep</span>
          <div class="light-wheel" aria-label="8-channel light wheel">
            ${Array.from({ length: 8 }, (_, index) => `<button type="button" data-channel="${index + 1}" style="--i:${index};">Channel ${index + 1}</button>`).join("")}
          </div>
          <p class="lab-note">Physical direction calibration pending; channels are labeled numerically.</p>
        </div>
        <div class="lab-control-group">
          <span class="control-label">Severity</span>
          <label><input type="checkbox" data-severity="low" checked> Low</label>
          <label><input type="checkbox" data-severity="medium" checked> Medium</label>
          <label><input type="checkbox" data-severity="high" checked> High</label>
        </div>
        <div class="lab-control-group">
          <span class="control-label">Zoom / Pan</span>
          <div class="segmented">
            <button type="button" data-zoom="fit">Fit</button>
            <button type="button" data-zoom="100">100%</button>
            <button type="button" data-zoom="in">+</button>
            <button type="button" data-zoom="out">-</button>
          </div>
          <p class="lab-note">Drag the image area to pan when zoomed.</p>
        </div>
      </aside>
      <div class="lab-workspace">
        <div class="lab-status-row">
          <span id="lab-view-label">True View</span>
          <span id="lab-evidence-state">Loading local evidence refs</span>
        </div>
        <div class="lab-viewer" id="lab-viewer">
          <div class="lab-image-plane" id="lab-image-plane">
            <img id="lab-main-image" alt="Vision Lab active evidence view">
            <img id="lab-overlay-image" alt="Vision Lab overlay layer">
            <div id="lab-marker-layer" class="lab-marker-layer" aria-label="Anomaly markers"></div>
          </div>
          <div class="missing lab-empty" id="lab-empty-state">Evidence unavailable for this mode.</div>
        </div>
        <div class="lab-panel-grid">
          <section class="lab-panel">
            <h3>Element Status</h3>
            <div id="lab-element-status"></div>
          </section>
          <section class="lab-panel">
            <h3>Evidence Replay</h3>
            <div id="lab-replay"></div>
          </section>
          <section class="lab-panel expert-only">
            <h3>Channel Balance</h3>
            <div id="lab-channel-balance"></div>
          </section>
          <section class="lab-panel expert-only">
            <h3>Light Direction Status</h3>
            <div id="lab-light-direction"></div>
          </section>
          <section class="lab-panel expert-only">
            <h3>Expert Data</h3>
            <pre id="lab-expert-json"></pre>
          </section>
        </div>
      </div>
    </div>
    <script type="application/json" id="vision-lab-data">${scriptJson(data)}</script>
    <script>
      (function () {
        const data = JSON.parse(document.getElementById("vision-lab-data").textContent);
        const state = { side: "front", view: "true_view", channel: 1, zoom: 1, panX: 0, panY: 0, mode: "collector", severities: new Set(["low", "medium", "high"]) };
        const main = document.getElementById("lab-main-image");
        const overlay = document.getElementById("lab-overlay-image");
        const markers = document.getElementById("lab-marker-layer");
        const empty = document.getElementById("lab-empty-state");
        const plane = document.getElementById("lab-image-plane");
        const status = document.getElementById("lab-evidence-state");
        const label = document.getElementById("lab-view-label");
        const elementStatus = document.getElementById("lab-element-status");
        const replay = document.getElementById("lab-replay");
        const expert = document.getElementById("lab-expert-json");
        const viewLabels = {
          true_view: "True View",
          surface_vision: "Surface Vision V0",
          heatmap: "Heatmap",
          normal_proxy: "Normal Proxy",
          relief_proxy: "Relief Proxy",
          confidence_map: "Confidence Map",
          light_sweep: "Light Sweep Wheel",
          measurement_overlay: "Measurement Overlay",
          confidence_lens: "Confidence Lens",
          evidence_replay: "Evidence Replay"
        };
        function sideData() { return data.sides[state.side] || {}; }
        function imageFor(side) {
          if (state.view === "light_sweep") return side.channels?.find((entry) => entry.channel === state.channel)?.image;
          if (state.view === "heatmap") return side.heatmap?.outputFilePath ? side.heatmap : side.trueView;
          if (state.view === "surface_vision") return side.surfaceVision?.outputFilePath ? side.surfaceVision : side.channels?.find((entry) => entry.channel === state.channel)?.image || side.trueView;
          if (state.view === "normal_proxy") return side.normalProxy?.outputFilePath ? side.normalProxy : side.trueView;
          if (state.view === "relief_proxy") return side.reliefProxy?.outputFilePath ? side.reliefProxy : side.trueView;
          if (state.view === "confidence_map") return side.confidenceMap?.outputFilePath ? side.confidenceMap : side.trueView;
          if (state.view === "confidence_lens") return side.glareMask?.outputFilePath ? side.glareMask : side.overlay?.outputFilePath ? side.overlay : side.trueView;
          return side.trueView;
        }
        function setButtons(selector, attr, value) {
          document.querySelectorAll(selector).forEach((button) => button.classList.toggle("active", button.getAttribute(attr) === String(value)));
        }
        function escapeText(value) {
          return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
        }
        function renderMarkers(side) {
          markers.innerHTML = "";
          const visible = (side.candidates || []).filter((candidate) => state.severities.has(candidate.severityBand || "low"));
          visible.forEach((candidate) => {
            const rect = candidate.displayRect;
            if (!rect) return;
            const frameWidth = side.trueView?.imageWidth || side.overlay?.imageWidth || 1;
            const frameHeight = side.trueView?.imageHeight || side.overlay?.imageHeight || 1;
            const marker = document.createElement("button");
            marker.type = "button";
            marker.className = "lab-marker severity-" + (candidate.severityBand || "low");
            marker.style.left = (rect.x / frameWidth) * 100 + "%";
            marker.style.top = (rect.y / frameHeight) * 100 + "%";
            marker.style.width = Math.max((rect.width / frameWidth) * 100, 1.4) + "%";
            marker.style.height = Math.max((rect.height / frameHeight) * 100, 1.4) + "%";
            marker.title = candidate.candidateId + " " + candidate.severityBand;
            marker.addEventListener("click", () => renderReplay(side, candidate));
            markers.appendChild(marker);
          });
        }
        function renderElementStatus(side) {
          const d = side.diagnostics || {};
          elementStatus.innerHTML = [
            ["Centering", d.centering],
            ["Corners", d.corners],
            ["Edges", d.edges],
            ["Surface", d.surface],
            ["Normal Proxy", side.lightDirection?.status]
          ].map(([name, value]) => {
            const statusValue = typeof value === "string" ? value : value?.status || Object.values(value || {}).map((entry) => entry.status).join(", ") || "insufficient_evidence";
            return "<div class=\\"lab-mini-row\\"><span>" + escapeText(name) + "</span><strong>" + escapeText(statusValue) + "</strong></div>";
          }).join("");
        }
        function renderReplay(side, selected) {
          const candidates = selected ? [selected] : (side.candidates || []);
          if (!candidates.length) {
            replay.innerHTML = "<p>No provisional anomaly candidates were emitted for this side.</p>";
            return;
          }
          replay.innerHTML = candidates.map((candidate) => {
            const refs = candidate.evidenceRefs || {};
            const sourceRefs = Array.isArray(refs.sourceChannels) ? refs.sourceChannels.map((entry) => "Channel " + escapeText(entry.channel)).join(", ") : "";
            return "<article class=\\"replay-card severity-" + escapeText(candidate.severityBand || "low") + "\\"><strong>" + escapeText(candidate.candidateId) + "</strong><span>" + escapeText(candidate.severityBand || "low") + " severity / confidence " + escapeText(candidate.confidence || "low") + "</span><p>" + escapeText(candidate.explanation) + "</p><small>Source channels: " + escapeText((candidate.sourceChannels || []).join(", ") || "not computed") + " / strongest " + escapeText(candidate.strongestChannel || "not computed") + " / Dino-Lite follow-up: " + escapeText(candidate.needsDinoLiteFollowUp) + "</small><small>Evidence replay: heatmap " + escapeText(refs.heatmap || "missing") + " / surface vision " + escapeText(refs.surfaceVision || "missing") + " / " + sourceRefs + "</small></article>";
          }).join("");
        }
        function renderExpert(side) {
          const channelBalance = side.lightDirection?.channelBalance || side.lightDirection?.profile?.channelMetadata || [];
          document.getElementById("lab-channel-balance").innerHTML = Array.isArray(channelBalance) && channelBalance.length
            ? channelBalance.slice(0, 8).map((entry) => "<div class=\\"lab-mini-row\\"><span>Channel " + escapeText(entry.channel || entry.channelNumber) + "</span><strong>" + escapeText(entry.responseRatioVsMedian || entry.intensityScale || "unknown") + "</strong></div>").join("")
            : "<p>Channel balance is unavailable.</p>";
          const profile = side.lightDirection?.profile || {};
          document.getElementById("lab-light-direction").innerHTML = [
            ["Profile", profile.profileId || "missing"],
            ["Mapping", profile.physicalDirectionMappingStatus || "pending"],
            ["Flat field", profile.flatFieldStatus || "unknown"],
            ["Normal map", profile.normalMapStatus || "unknown"],
            ["Certified photometric stereo", profile.isCertifiedPhotometricStereo === false ? "false" : "not claimed"]
          ].map(([name, value]) => "<div class=\\"lab-mini-row\\"><span>" + escapeText(name) + "</span><strong>" + escapeText(value) + "</strong></div>").join("");
          expert.textContent = JSON.stringify({
            schemaVersion: data.schemaVersion,
            measurementOverlay: data.measurementOverlay,
            confidenceLens: data.confidenceLens,
            side,
          }, null, 2);
        }
        function update() {
          const side = sideData();
          const image = imageFor(side);
          const src = image?.outputFilePath;
          label.textContent = viewLabels[state.view] || state.view;
          main.style.display = src ? "block" : "none";
          empty.style.display = src ? "none" : "block";
          if (src) main.src = src;
          const showOverlay = state.view === "measurement_overlay" || state.view === "confidence_lens";
          overlay.style.display = showOverlay && side.overlay?.outputFilePath ? "block" : "none";
          if (showOverlay && side.overlay?.outputFilePath) overlay.src = side.overlay.outputFilePath;
          markers.style.display = ["heatmap", "surface_vision", "evidence_replay"].includes(state.view) ? "block" : "none";
          plane.style.transform = "translate(" + state.panX + "px, " + state.panY + "px) scale(" + state.zoom + ")";
          status.textContent = side.status === "available" ? state.side + " evidence ready" : state.side + " evidence insufficient";
          if (state.view === "surface_vision" && image?.status === "missing") status.textContent = "Surface Vision data is insufficient for this side.";
          if (state.view === "heatmap" && side.heatmap?.status === "missing") status.textContent = "Heatmap unavailable; showing True View with candidate markers when available.";
          if (state.view === "normal_proxy" && side.normalProxy?.status === "missing") status.textContent = "Normal proxy unavailable; physical light-direction prep evidence is insufficient.";
          if (state.view === "relief_proxy" && side.reliefProxy?.status === "missing") status.textContent = "Relief proxy unavailable; physical light-direction prep evidence is insufficient.";
          if (state.view === "confidence_map" && side.confidenceMap?.status === "missing") status.textContent = "Confidence map unavailable; showing True View.";
          if (state.view === "confidence_lens" && side.glareMask?.status === "missing") status.textContent = "Confidence mask unavailable; showing overlay/True View with warnings.";
          renderMarkers(side);
          renderElementStatus(side);
          renderReplay(side);
          renderExpert(side);
          setButtons("[data-side]", "data-side", state.side);
          setButtons("[data-view]", "data-view", state.view);
          setButtons("[data-channel]", "data-channel", state.channel);
          document.querySelector(".vision-lab").classList.toggle("expert-mode", state.mode === "expert");
        }
        document.querySelectorAll("[data-side]").forEach((button) => button.addEventListener("click", () => { state.side = button.dataset.side; update(); }));
        document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; update(); }));
        document.querySelectorAll("[data-channel]").forEach((button) => button.addEventListener("click", () => { state.channel = Number(button.dataset.channel); state.view = "light_sweep"; update(); }));
        document.querySelectorAll("[data-lab-mode]").forEach((button) => button.addEventListener("click", () => {
          state.mode = button.dataset.labMode;
          document.querySelectorAll("[data-lab-mode]").forEach((entry) => entry.classList.toggle("active", entry === button));
          update();
        }));
        document.querySelectorAll("[data-severity]").forEach((checkbox) => checkbox.addEventListener("change", () => {
          if (checkbox.checked) state.severities.add(checkbox.dataset.severity); else state.severities.delete(checkbox.dataset.severity);
          update();
        }));
        document.querySelectorAll("[data-zoom]").forEach((button) => button.addEventListener("click", () => {
          const action = button.dataset.zoom;
          if (action === "fit") { state.zoom = 1; state.panX = 0; state.panY = 0; }
          if (action === "100") state.zoom = 1;
          if (action === "in") state.zoom = Math.min(4, state.zoom + 0.25);
          if (action === "out") state.zoom = Math.max(0.5, state.zoom - 0.25);
          update();
        }));
        let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;
        document.getElementById("lab-viewer").addEventListener("pointerdown", (event) => {
          dragging = true; startX = event.clientX; startY = event.clientY; baseX = state.panX; baseY = state.panY;
        });
        window.addEventListener("pointerup", () => { dragging = false; });
        window.addEventListener("pointermove", (event) => {
          if (!dragging) return;
          state.panX = baseX + event.clientX - startX;
          state.panY = baseY + event.clientY - startY;
          update();
        });
        update();
      })();
    </script>
  </section>`;
}

function diagnosticTable(title: string, diagnostic: FixedRigEvidencePackageJson | undefined): string {
  return `<section class="panel">
    <h3>${escapeHtml(title)}</h3>
    <table><tbody>
      <tr><th>Centering</th><td>${escapeHtml(diagnosticStatusText(diagnostic, "centering"))}</td></tr>
      <tr><th>Corners</th><td>${escapeHtml(cornerStatusText(diagnostic))}</td></tr>
      <tr><th>Edges</th><td>${escapeHtml(edgeStatusText(diagnostic))}</td></tr>
      <tr><th>Surface</th><td>${escapeHtml(diagnosticStatusText(diagnostic, "surface"))}</td></tr>
      <tr><th>Warnings</th><td>${escapeHtml(Array.isArray(diagnostic?.warnings) ? diagnostic.warnings.join("; ") : "none")}</td></tr>
    </tbody></table>
  </section>`;
}

function elementScoreText(element: FixedRigProvisionalGradeStoryResult["elementScores"][keyof FixedRigProvisionalGradeStoryResult["elementScores"]] | undefined): string {
  if (!element) return "insufficient_evidence";
  if (element.status !== "provisional_diagnostic") return "insufficient_evidence";
  return `${element.score ?? "not_scored"} / 10 (${element.confidenceBand} confidence)`;
}

function gradeValueText(story: FixedRigProvisionalGradeStoryResult | undefined): string {
  if (!story || story.status !== "provisional_diagnostic_grade" || story.provisionalOverallGrade === undefined) return "Insufficient Evidence";
  return `${story.provisionalOverallGrade} / 10`;
}

function gradeStorySummarySection(story: FixedRigProvisionalGradeStoryResult | undefined): string {
  if (!story) return "";
  return `<section>
    <h2>Grade Story Engine</h2>
    <div class="summary-grid">
      <p class="panel"><strong>Story Mode:</strong><br>${escapeHtml(story.story.summary)}</p>
      <p class="good"><strong>Strongest positive finding:</strong><br>${escapeHtml(story.story.strongestPositiveFinding)}</p>
      <p class="warning"><strong>Strongest warning:</strong><br>${escapeHtml(story.story.strongestWarning)}</p>
      <p class="panel"><strong>Confidence:</strong><br>${escapeHtml(`${story.confidence.band} (${story.confidence.score}) - ${story.confidence.explanation}`)}</p>
    </div>
    <h3>Element Scores</h3>
    <div class="metric-grid">
      ${premiumMetricCard("Centering", elementScoreText(story.elementScores.centering), story.elementScores.centering.explanation)}
      ${premiumMetricCard("Corners", elementScoreText(story.elementScores.corners), story.elementScores.corners.weakestFinding ?? story.elementScores.corners.explanation)}
      ${premiumMetricCard("Edges", elementScoreText(story.elementScores.edges), story.elementScores.edges.weakestFinding ?? story.elementScores.edges.explanation)}
      ${premiumMetricCard("Surface", elementScoreText(story.elementScores.surface), story.elementScores.surface.weakestFinding ?? story.elementScores.surface.explanation)}
    </div>
    <p class="warning">This is a provisional_diagnostic_grade only. certificationStatus=${escapeHtml(story.certificationStatus)}; finalGradeComputed=${escapeHtml(story.finalGradeComputed)}; certifiedClaim=${escapeHtml(story.certifiedClaim)}; labelGenerated=${escapeHtml(story.labelGenerated)}; qrGenerated=${escapeHtml(story.qrGenerated)}; certificateGenerated=${escapeHtml(story.certificateGenerated)}.</p>
  </section>`;
}

function whyNot10Section(story: FixedRigProvisionalGradeStoryResult | undefined): string {
  if (!story) return "";
  const reasons = story.whyNot10.length
    ? story.whyNot10
    : [
        {
          id: "why-not-10-none",
          category: "confidence",
          severity: "low",
          reason: "No V0 grade-impact reason was emitted. The result is still provisional and not certified.",
          evidenceRefs: ["analysis.provisionalGradeStory"],
        },
      ];
  return `<section>
    <h2>Why Not 10?</h2>
    <div class="summary-grid">
      ${reasons
        .map(
          (reason) =>
            `<article class="panel"><h3>${escapeHtml(reason.category)} / ${escapeHtml(reason.severity)}</h3><p>${escapeHtml(reason.reason)}</p><small>Evidence: ${escapeHtml(reason.evidenceRefs.join(", "))}</small></article>`
        )
        .join("")}
    </div>
  </section>`;
}

function gradeImpactSection(story: FixedRigProvisionalGradeStoryResult | undefined): string {
  if (!story) return "";
  const candidates = story.gradeImpactCandidates;
  return `<section>
    <h2>Grade-Impact Candidates</h2>
    ${
      candidates.length
        ? `<table><thead><tr><th>ID</th><th>Category</th><th>Side</th><th>Severity</th><th>Impact</th><th>Evidence</th><th>Explanation</th></tr></thead><tbody>${candidates
            .map(
              (candidate) =>
                `<tr><td>${escapeHtml(candidate.id)}</td><td>${escapeHtml(candidate.category)}</td><td>${escapeHtml(candidate.side)}</td><td>${escapeHtml(candidate.severity)} / ${escapeHtml(candidate.confidenceBand)}</td><td>${escapeHtml(candidate.provisionalGradeImpact)}</td><td>${escapeHtml(candidate.evidenceRefs.join(", "))}${candidate.sourceChannels?.length ? `<br>Channels ${escapeHtml(candidate.sourceChannels.join(", "))}` : ""}</td><td>${escapeHtml(candidate.explanation)} ${escapeHtml(candidate.recommendedFollowUp ?? "")}</td></tr>`
            )
            .join("")}</tbody></table>`
        : "<p>No grade-impact candidates were emitted by V0.</p>"
    }
  </section>`;
}

function gradeGateSection(story: FixedRigProvisionalGradeStoryResult | undefined): string {
  if (!story) return "";
  return `<section class="expert-only-section">
    <h2>Provisional Grade Rules</h2>
    <p class="warning">The formulas below are provisional_diagnostic only. They do not create a certified/final Ten Kings grade.</p>
    <table><tbody>
      <tr><th>Rules version</th><td>${escapeHtml(story.rulesVersion)}</td></tr>
      <tr><th>Weights</th><td>${escapeHtml(JSON.stringify(story.formulas.weights))}</td></tr>
      <tr><th>Clipping soft threshold</th><td>${escapeHtml(story.formulas.clippingSoftThreshold)}</td></tr>
      <tr><th>Sharpness soft threshold</th><td>${escapeHtml(story.formulas.sharpnessSoftThreshold)}</td></tr>
      <tr><th>Cap rules</th><td>${escapeHtml(story.formulas.capRules.join("; "))}</td></tr>
    </tbody></table>
    <h3>Gate Summary</h3>
    <table><thead><tr><th>Gate</th><th>Status</th><th>Summary</th><th>Evidence</th></tr></thead><tbody>
      ${story.gates.results
        .map((result) => `<tr><td>${escapeHtml(result.gate)}</td><td>${escapeHtml(result.status)}</td><td>${escapeHtml(result.summary)}</td><td>${escapeHtml(result.evidenceRefs.join(", "))}</td></tr>`)
        .join("")}
    </tbody></table>
    <h3>Story Claims</h3>
    <table><thead><tr><th>Claim</th><th>Category</th><th>Evidence</th></tr></thead><tbody>
      ${story.story.claims
        .map((claim) => `<tr><td>${escapeHtml(claim.text)}</td><td>${escapeHtml(claim.category)}</td><td>${escapeHtml(claim.evidenceRefs.join(", "))}</td></tr>`)
        .join("")}
    </tbody></table>
  </section>`;
}

function renderUnifiedFixedRigCardReport(input: {
  packageId: string;
  generatedAt: string;
  frontPackageDir: string;
  backPackageDir: string;
  frontManifest: FixedRigEvidencePackageJson;
  backManifest: FixedRigEvidencePackageJson;
  frontAnalysis: FixedRigEvidencePackageJson;
  backAnalysis: FixedRigEvidencePackageJson;
  warnings: string[];
  visionLabData?: FixedRigEvidencePackageJson;
  provisionalGradeStory?: FixedRigProvisionalGradeStoryResult;
}): string {
  const front = evidenceSideFromPackage(input.frontManifest, "front");
  const back = evidenceSideFromPackage(input.backManifest, "back");
  const frontDiagnostic = sideDiagnosticFromAnalysis(input.frontAnalysis, "front") ?? front?.diagnosticGrading;
  const backDiagnostic = sideDiagnosticFromAnalysis(input.backAnalysis, "back") ?? back?.diagnosticGrading;
  const frontSurface = sideSurfaceFromAnalysis(input.frontAnalysis, "front") ?? front?.surfaceAnalysis;
  const backSurface = sideSurfaceFromAnalysis(input.backAnalysis, "back") ?? back?.surfaceAnalysis;
  const activeProfile = input.frontManifest.activeLightingProfile ?? input.backManifest.activeLightingProfile;
  const fixtureProfile = front?.fixtureCalibrationProfile ?? back?.fixtureCalibrationProfile;
  const frontStats = sideAllOnStats(front);
  const backStats = sideAllOnStats(back);
  const frontNormalizedPath = front?.normalizedCard?.normalizedArtifact?.localOutputPath;
  const backNormalizedPath = back?.normalizedCard?.normalizedArtifact?.localOutputPath;
  const clippingWarnings = [sideClippingWarning("Front", frontStats), sideClippingWarning("Back", backStats)].filter(
    (warning): warning is string => Boolean(warning)
  );
  const strongestWarning = [...clippingWarnings, ...input.warnings][0] ?? "No blocking warning was emitted.";
  const topCandidate = [frontSurface, backSurface]
    .flatMap((surface) => (Array.isArray(surface?.candidates) ? surface.candidates : []))
    .sort((a, b) => Number(b.anomalyProxyScore ?? 0) - Number(a.anomalyProxyScore ?? 0))[0];
  const positiveFinding =
    fixtureProfile?.framingGate?.status === "pass" && (fixtureProfile?.pixelToMmConsistency?.status === "pass" || fixtureProfile?.pixelToMmConsistency?.status === undefined)
      ? "Fixed-ruler scale, framing, and overlay gates passed for this provisional diagnostic run."
      : "Front/back evidence packages were generated with portrait displays, overlays, ROI crops, and 8-channel evidence.";
  const provisionalGradeStory =
    input.provisionalGradeStory ??
    buildFixedRigProvisionalGradeStory({
      packageId: input.packageId,
      generatedAt: input.generatedAt,
      frontDiagnostic,
      backDiagnostic,
      frontSurface,
      backSurface,
      frontStats,
      backStats,
      fixtureProfile,
      frontFixtureProfile: front?.fixtureCalibrationProfile,
      backFixtureProfile: back?.fixtureCalibrationProfile,
      activeLightingProfile: activeProfile,
      warnings: [...clippingWarnings, ...input.warnings],
      allowAcceptedWarnings: true,
    });
  const visionLabData =
    input.visionLabData ??
    buildVisionLabData({
      packageId: input.packageId,
      generatedAt: input.generatedAt,
      front,
      back,
      frontDiagnostic,
      backDiagnostic,
      frontSurface,
      backSurface,
      frontStats,
      backStats,
      activeProfile,
      fixtureProfile,
      provisionalGradeStory,
      warnings: [...clippingWarnings, ...input.warnings],
    });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ten Kings Fixed-Rig Provisional Diagnostic Report</title>
  <style>
    :root { color-scheme: light; --ink:#171717; --muted:#68645d; --paper:#f7f3ea; --panel:#fffdf8; --line:#d8d0c1; --gold:#b88a2d; --red:#9f2a2a; --blue:#1f5f7a; --green:#26734d; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Arial, Helvetica, sans-serif; color:var(--ink); background:var(--paper); }
    main { max-width:1280px; margin:0 auto; padding:28px; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; border-bottom:1px solid var(--line); padding-bottom:18px; }
    h1,h2,h3 { margin:0 0 12px; letter-spacing:0; }
    h1 { font-size:30px; }
    h2 { font-size:22px; margin-top:34px; }
    h3 { font-size:17px; }
    p { line-height:1.45; }
    .brand { font-weight:700; text-transform:uppercase; color:#312a1b; letter-spacing:1px; }
    .status { display:inline-block; border:1px solid var(--red); color:var(--red); background:#fff4f1; padding:8px 12px; font-weight:700; border-radius:4px; }
    .meta { color:var(--muted); font-size:13px; margin-top:8px; }
    .hero { margin-top:24px; display:grid; grid-template-columns:1fr minmax(320px,420px) 1fr; gap:22px; align-items:center; }
    .grade-box { grid-column:1 / 4; text-align:center; padding:18px; border:1px solid var(--line); background:var(--panel); }
    .grade-box strong { display:block; font-size:38px; margin-top:4px; }
    .card-stage { grid-column:2; text-align:center; }
    .card-stage img { max-height:760px; max-width:100%; border:1px solid #2c2c2c; background:#111; box-shadow:0 12px 30px rgba(0,0,0,.18); }
    .callout-col { display:grid; gap:14px; }
    .callout { border:1px solid var(--line); background:var(--panel); padding:14px; min-height:82px; position:relative; }
    .callout span { display:block; color:var(--muted); font-size:13px; text-transform:uppercase; }
    .callout strong { display:block; margin-top:8px; font-size:16px; }
    .callout small { color:var(--blue); }
    .summary-grid, .metric-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
    .panel, .metric-card { border:1px solid var(--line); background:var(--panel); padding:16px; }
    .metric-card span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; }
    .metric-card strong { display:block; font-size:20px; margin-top:6px; }
    .metric-card small { display:block; color:var(--muted); margin-top:6px; }
    .warning { border-left:5px solid var(--red); background:#fff8f5; padding:12px 14px; }
    .good { border-left:5px solid var(--green); background:#f5fff9; padding:12px 14px; }
    .side-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .image-pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    img { max-width:100%; background:#111; }
    figure { margin:0; }
    figcaption { font-size:12px; color:var(--muted); margin-top:6px; word-break:break-all; }
    .thumb-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
    .thumb-grid.compact { grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); }
    table { border-collapse:collapse; width:100%; margin:10px 0 0; background:var(--panel); }
    th,td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
    th { width:210px; background:#faf6ed; }
    pre { white-space:pre-wrap; word-break:break-word; background:#24211d; color:#fff; padding:14px; overflow:auto; }
    .missing { border:1px dashed var(--line); padding:20px; color:var(--muted); background:#fff; }
    .eyebrow { margin:0 0 6px; color:#b99651; font-size:12px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; }
    .vision-lab { margin-top:36px; border:1px solid #2f332f; background:#11120f; color:#f4efe4; box-shadow:0 20px 46px rgba(0,0,0,.22); }
    .lab-header { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; padding:22px; border-bottom:1px solid #2f332f; background:#171813; }
    .vision-lab h2, .vision-lab h3 { color:#fffaf0; }
    .lab-intro { max-width:780px; margin:0; color:#c9c0ae; }
    .lab-mode, .segmented { display:flex; flex-wrap:wrap; gap:8px; }
    .lab-pill, .segmented button, .view-stack button, .light-wheel button { border:1px solid #514833; background:#211f18; color:#f4efe4; padding:9px 11px; border-radius:4px; cursor:pointer; font:inherit; }
    .lab-pill.active, .segmented button.active, .view-stack button.active, .light-wheel button.active { border-color:#d5ad5b; background:#3a2c13; color:#fff3ce; }
    .lab-shell { display:grid; grid-template-columns:280px minmax(0,1fr); min-height:720px; }
    .lab-sidebar { border-right:1px solid #2f332f; padding:18px; background:#151610; }
    .lab-control-group { border-bottom:1px solid #2b2b24; padding:0 0 16px; margin-bottom:16px; }
    .control-label { display:block; margin-bottom:9px; color:#c7a969; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.9px; }
    .view-stack { display:grid; gap:7px; }
    .view-stack button { text-align:left; }
    .lab-note { margin:8px 0 0; color:#aaa08e; font-size:12px; }
    .light-wheel { position:relative; width:184px; height:184px; margin:6px auto 8px; border:1px solid #4e4737; border-radius:50%; background:radial-gradient(circle at center,#25231c 0 31%,#151610 32% 100%); }
    .light-wheel button { position:absolute; left:50%; top:50%; width:76px; min-height:34px; margin:-17px 0 0 -38px; padding:5px; font-size:11px; transform:rotate(calc(var(--i) * 45deg)) translate(0,-72px) rotate(calc(var(--i) * -45deg)); }
    .lab-workspace { min-width:0; padding:18px; }
    .lab-status-row { display:flex; justify-content:space-between; gap:12px; color:#d4c8b2; padding:0 0 12px; }
    .lab-viewer { position:relative; min-height:560px; overflow:hidden; border:1px solid #39372e; background:#050505; display:flex; align-items:center; justify-content:center; touch-action:none; }
    .lab-image-plane { position:relative; transform-origin:center center; transition:transform .08s linear; }
    #lab-main-image { display:block; max-height:720px; max-width:100%; object-fit:contain; }
    #lab-overlay-image { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; opacity:.74; pointer-events:none; mix-blend-mode:screen; }
    .lab-marker-layer { position:absolute; inset:0; pointer-events:none; }
    .lab-marker { position:absolute; border:2px solid #f1d35f; background:rgba(241,211,95,.12); border-radius:4px; pointer-events:auto; }
    .lab-marker.severity-low { border-color:#68b879; }
    .lab-marker.severity-medium { border-color:#e6b650; }
    .lab-marker.severity-high { border-color:#d95d4f; }
    .lab-empty { position:absolute; max-width:420px; text-align:center; }
    .lab-panel-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px; }
    .lab-panel { border:1px solid #39372e; background:#191914; padding:14px; }
    .lab-mini-row { display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #2f332f; padding:8px 0; }
    .lab-mini-row span { color:#c9c0ae; }
    .replay-card { border-left:4px solid #68b879; background:#222018; padding:10px; margin-bottom:9px; }
    .replay-card span, .replay-card small { display:block; color:#c9c0ae; margin-top:4px; }
    .replay-card.severity-medium { border-color:#e6b650; }
    .replay-card.severity-high { border-color:#d95d4f; }
    .expert-only { display:none; }
    .expert-mode .expert-only { display:block; grid-column:1 / -1; }
    .grade-subline { margin:6px 0 0; color:var(--muted); font-weight:700; }
    .formula-note { color:var(--muted); font-size:13px; }
    @media (max-width:900px) { .hero,.side-grid,.image-pair { grid-template-columns:1fr; } .grade-box,.card-stage { grid-column:auto; } }
    @media (max-width:900px) { .lab-header,.lab-shell,.lab-panel-grid { grid-template-columns:1fr; display:grid; } .lab-sidebar { border-right:0; border-bottom:1px solid #2f332f; } }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand">Ten Kings</div>
      <h1>AI Fixed-Rig Card Diagnostic Report</h1>
      <div class="meta">Report/session ID: ${escapeHtml(input.packageId)}<br>Generated: ${escapeHtml(input.generatedAt)}</div>
    </div>
    <div class="status">Provisional Diagnostic - Not Certified - No Final Grade</div>
  </header>

  <section class="hero">
    <div class="grade-box">
      <span>Provisional Diagnostic Grade</span>
      <strong>${escapeHtml(gradeValueText(provisionalGradeStory))}</strong>
      <p class="grade-subline">Confidence ${escapeHtml(provisionalGradeStory.confidence.band)} (${escapeHtml(provisionalGradeStory.confidence.score)})</p>
      <p>Not Certified - No Final Grade. finalGradeComputed=false; certifiedClaim=false.</p>
    </div>
    <div class="callout-col">
      ${callout("Centering", elementScoreText(provisionalGradeStory.elementScores.centering), "center")}
      ${callout("Corners", elementScoreText(provisionalGradeStory.elementScores.corners), "corners")}
    </div>
    <div class="card-stage">
      ${reportImage(frontNormalizedPath ?? front?.displayImage?.outputFilePath, "front normalized portrait card image")}
    </div>
    <div class="callout-col">
      ${callout("Edges", elementScoreText(provisionalGradeStory.elementScores.edges), "edges")}
      ${callout("Surface", elementScoreText(provisionalGradeStory.elementScores.surface), "surface")}
    </div>
  </section>

  <section>
    <h2>Diagnostic Summary</h2>
    <div class="summary-grid">
      <p class="good"><strong>Strongest positive finding:</strong><br>${escapeHtml(positiveFinding)}</p>
      <p class="warning"><strong>Strongest warning:</strong><br>${escapeHtml(strongestWarning)}</p>
      <p class="panel"><strong>Top anomaly candidate:</strong><br>${escapeHtml(topCandidate ? `${topCandidate.candidateId} ${topCandidate.severityBand} ${topCandidate.anomalyProxyScore}` : "No candidate emitted.")}</p>
      <p class="panel"><strong>Why this is not final:</strong><br>Evidence class is ${escapeHtml(FIXED_RIG_V1_EVIDENCE_CLASS)}, isCalibrated=false, and all scores are provisional_diagnostic only.</p>
    </div>
  </section>

  ${gradeStorySummarySection(provisionalGradeStory)}
  ${whyNot10Section(provisionalGradeStory)}
  ${gradeImpactSection(provisionalGradeStory)}

  ${visionLabSection(visionLabData)}

  <section>
    <h2>Card Session Metadata</h2>
    <div class="metric-grid">
      ${premiumMetricCard("Accepted duty", `${activeProfile?.selectedDutyPercent ?? "unknown"}%`, `PWM ${activeProfile?.actualLeimacPwmStep ?? "unknown"}`)}
      ${premiumMetricCard("Channels", activeProfile?.selectedChannels?.join(", ") ?? "unknown")}
      ${premiumMetricCard("Lighting source", activeProfile?.profileSource ?? "unknown")}
      ${premiumMetricCard("Evidence class", FIXED_RIG_V1_EVIDENCE_CLASS, "isCalibrated=false")}
    </div>
  </section>

  <section>
    <h2>Clipping and Lighting Warnings</h2>
    <div class="metric-grid">
      ${premiumMetricCard("Front clipped fraction", frontStats?.clippedPixelFraction ?? "not_computed", "Soft target <= 0.02")}
      ${premiumMetricCard("Back clipped fraction", backStats?.clippedPixelFraction ?? "not_computed", "Soft target <= 0.02")}
    </div>
    <p class="warning">${escapeHtml(clippingWarnings.join(" ") || "No clipping warning above threshold.")}</p>
  </section>

  <section>
    <h2>Front and Back Evidence</h2>
    <div class="side-grid">
      <div class="panel"><h3>Front</h3><p>Geometry ${escapeHtml(front?.normalizedCard?.geometry?.geometrySource ?? "not_detected")}; placement ${escapeHtml(front?.normalizedCard?.geometry?.placementState ?? "not_detected")}.</p><div class="image-pair">${reportImage(frontNormalizedPath ?? front?.displayImage?.outputFilePath, "front normalized evidence")}${reportImage(front?.overlayPreview?.outputFilePath, "front overlay/debug image")}</div></div>
      <div class="panel"><h3>Back</h3><p>Geometry ${escapeHtml(back?.normalizedCard?.geometry?.geometrySource ?? "not_detected")}; placement ${escapeHtml(back?.normalizedCard?.geometry?.placementState ?? "not_detected")}.</p><div class="image-pair">${reportImage(backNormalizedPath ?? back?.displayImage?.outputFilePath, "back normalized evidence")}${reportImage(back?.overlayPreview?.outputFilePath, "back overlay/debug image")}</div></div>
    </div>
  </section>

  <section>
    <h2>Centering Diagnostics</h2>
    <div class="side-grid">${diagnosticTable("Front diagnostic elements", frontDiagnostic)}${diagnosticTable("Back diagnostic elements", backDiagnostic)}</div>
  </section>

  <section>
    <h2>Corner ROI Crops</h2>
    <div class="side-grid"><div>${roiGallery("front", { ...front, roiCrops: (front?.roiCrops ?? []).filter((crop: any) => String(crop.roiId).includes("corner")) })}</div><div>${roiGallery("back", { ...back, roiCrops: (back?.roiCrops ?? []).filter((crop: any) => String(crop.roiId).includes("corner")) })}</div></div>
  </section>

  <section>
    <h2>Edge ROI Crops</h2>
    <div class="side-grid"><div>${roiGallery("front", { ...front, roiCrops: (front?.roiCrops ?? []).filter((crop: any) => String(crop.roiId).includes("edge")) })}</div><div>${roiGallery("back", { ...back, roiCrops: (back?.roiCrops ?? []).filter((crop: any) => String(crop.roiId).includes("edge")) })}</div></div>
  </section>

  <section>
    <h2>Surface Evidence and Anomaly Diagnostics</h2>
    <div class="side-grid">
      <div class="panel"><h3>Front Surface</h3><p>${escapeHtml(surfaceCandidateText(frontSurface))}</p><div class="image-pair">${reportImage(frontSurface?.surfaceVision?.outputFilePath, "front Surface Vision V0")}${reportImage(frontSurface?.heatmap?.outputFilePath, "front surface heatmap")}</div>${roiGallery("front", { ...front, roiCrops: (front?.roiCrops ?? []).filter((crop: any) => String(crop.roiId).includes("surface")) })}</div>
      <div class="panel"><h3>Back Surface</h3><p>${escapeHtml(surfaceCandidateText(backSurface))}</p><div class="image-pair">${reportImage(backSurface?.surfaceVision?.outputFilePath, "back Surface Vision V0")}${reportImage(backSurface?.heatmap?.outputFilePath, "back surface heatmap")}</div>${roiGallery("back", { ...back, roiCrops: (back?.roiCrops ?? []).filter((crop: any) => String(crop.roiId).includes("surface")) })}</div>
    </div>
    <p class="warning">Surface Intelligence V0 is directional-light evidence visualization only. Physical Leimac direction mapping is pending, and this report does not compute a final surface grade.</p>
    <h3>8-Channel Evidence</h3>
    <div class="side-grid"><div>${channelGallery("front", front)}</div><div>${channelGallery("back", back)}</div></div>
  </section>

  <section>
    <h2>Light Direction / Normal Proxy Foundation</h2>
    <p class="warning">Preliminary normal/relief proxy uses an approximate directional model. This is not certified photometric stereo and not a final surface grade.</p>
    <div class="side-grid">
      <div class="panel">
        <h3>Front Light Direction Prep</h3>
        <p>${escapeHtml(lightDirectionSummary(frontSurface))}</p>
        <div class="image-pair">${reportImage(frontSurface?.normalProxy?.outputFilePath, "front preliminary normal proxy")}${reportImage(frontSurface?.reliefProxy?.outputFilePath, "front relief proxy")}</div>
        <div class="image-pair">${reportImage(frontSurface?.gradientMagnitude?.outputFilePath, "front gradient magnitude proxy")}${reportImage(frontSurface?.confidenceMap?.outputFilePath, "front light-direction confidence map")}</div>
        ${channelBalanceTable(frontSurface)}
      </div>
      <div class="panel">
        <h3>Back Light Direction Prep</h3>
        <p>${escapeHtml(lightDirectionSummary(backSurface))}</p>
        <div class="image-pair">${reportImage(backSurface?.normalProxy?.outputFilePath, "back preliminary normal proxy")}${reportImage(backSurface?.reliefProxy?.outputFilePath, "back relief proxy")}</div>
        <div class="image-pair">${reportImage(backSurface?.gradientMagnitude?.outputFilePath, "back gradient magnitude proxy")}${reportImage(backSurface?.confidenceMap?.outputFilePath, "back light-direction confidence map")}</div>
        ${channelBalanceTable(backSurface)}
      </div>
    </div>
  </section>

  <section>
    <h2>Evidence Gallery</h2>
    <h3>All ROI Crops</h3>
    <div class="side-grid"><div>${roiGallery("front", front)}</div><div>${roiGallery("back", back)}</div></div>
  </section>

  <section>
    <h2>Technical Appendix</h2>
    <h3>Calibration Profile</h3>
    ${fixtureCalibrationTable(fixtureProfile)}
    <h3>Lighting Profile</h3>
    ${activeLightingProfileTable(activeProfile)}
    <h3>Front Quality</h3>
    ${qualityTable(frontStats)}
    <h3>Back Quality</h3>
    ${qualityTable(backStats)}
    ${gradeGateSection(provisionalGradeStory)}
    <h3>Raw Source Folders</h3>
    <table><tbody>
      <tr><th>Front package</th><td>${escapeHtml(input.frontPackageDir)}</td></tr>
      <tr><th>Back package</th><td>${escapeHtml(input.backPackageDir)}</td></tr>
      <tr><th>Raw evidence rule</th><td>Raw Basler evidence remains clean in basler_sensor_pixels; overlays and ROI crops are derived report/debug assets.</td></tr>
      <tr><th>Claims</th><td>finalGradeComputed=false; certifiedClaim=false; no certificate/certified grading claim.</td></tr>
    </tbody></table>
    <h3>Combined Diagnostic JSON</h3>
    <pre>${escapeHtml(JSON.stringify({ front: frontDiagnostic, back: backDiagnostic, warnings: [...clippingWarnings, ...input.warnings] }, null, 2))}</pre>
  </section>
</main>
</body>
</html>
`;
}

function surfaceIntelligenceChannels(side: FixedRigEvidencePackageJson | undefined, surface: FixedRigEvidencePackageJson | undefined): Array<{
  channel: number;
  displayImage?: FixedRigEvidencePackageJson;
  stats?: FixedRigEvidencePackageJson;
}> {
  return Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    const fromSide = Array.isArray(side?.channelDisplayImages)
      ? side.channelDisplayImages.find((entry: FixedRigEvidencePackageJson) => Number(entry.channel) === channel)
      : undefined;
    const fromSurface = Array.isArray(surface?.perChannelStats)
      ? surface.perChannelStats.find((entry: FixedRigEvidencePackageJson) => Number(entry.channel) === channel)
      : undefined;
    return {
      channel,
      displayImage: fromSide?.displayImage ?? fromSurface?.portraitDisplayImage,
      stats: fromSurface,
    };
  });
}

function surfaceIntelligenceNormalizedCardProjection(
  side: FixedRigEvidencePackageJson | undefined,
): SurfaceIntelligenceNormalizedCardProjection | undefined {
  const geometry = side?.normalizedCard?.geometry;
  const artifact = side?.normalizedCard?.normalizedArtifact;
  const displayImage = side?.displayImage;
  const corners = geometry?.corners;
  const image = geometry?.image;
  const displayTransform = displayImage?.displayTransform;
  const normalizedSourceSha256 = artifact?.sourceSha256;
  const normalizedArtifactSha256 = artifact?.sha256;
  const displaySourceSha256 = displayImage?.rawSourceSha256;
  if (
    !artifact?.localOutputPath ||
    !/^[a-f0-9]{64}$/i.test(normalizedSourceSha256 ?? "") ||
    !/^[a-f0-9]{64}$/i.test(normalizedArtifactSha256 ?? "") ||
    normalizedSourceSha256?.toLowerCase() !== String(displaySourceSha256 ?? "").toLowerCase()
  ) return undefined;

  if (displayImage?.analysisCoordinateFrame === "normalized_card_portrait_pixels") {
    if (
      artifact.coordinateFrame !== "normalized_card_portrait_pixels" ||
      displayTransform !== "none" ||
      String(displayImage.sha256 ?? "").toLowerCase() !== normalizedArtifactSha256?.toLowerCase() ||
      artifact.imageWidth !== NORMALIZED_CARD_WIDTH_PIXELS ||
      artifact.imageHeight !== NORMALIZED_CARD_HEIGHT_PIXELS ||
      displayImage.imageWidth !== artifact.imageWidth ||
      displayImage.imageHeight !== artifact.imageHeight
    ) return undefined;
    return {
      projectionMode: "normalized_card_direct",
      inputCoordinateFrame: "normalized_card_portrait_pixels",
      sourceSha256: normalizedSourceSha256,
      normalizedArtifactSha256,
      normalizedImageWidth: artifact.imageWidth,
      normalizedImageHeight: artifact.imageHeight,
    };
  }

  if (
    !corners ||
    !image ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    !Number.isFinite(geometry?.rotationDegrees) ||
    !["none", "rotate90cw", "rotate90ccw", "rotate180"].includes(displayTransform)
  ) return undefined;
  const expectedDisplayWidth = displayTransform === "rotate90cw" || displayTransform === "rotate90ccw" ? image.height : image.width;
  const expectedDisplayHeight = displayTransform === "rotate90cw" || displayTransform === "rotate90ccw" ? image.width : image.height;
  if (displayImage?.imageWidth !== expectedDisplayWidth || displayImage?.imageHeight !== expectedDisplayHeight) return undefined;
  return {
    projectionMode: "source_display_rotation_crop",
    inputCoordinateFrame: "ai_grader_card_portrait_display",
    sourceSha256: normalizedSourceSha256,
    normalizedArtifactSha256,
    sourceImageWidth: image.width,
    sourceImageHeight: image.height,
    displayTransform,
    rotationDegrees: geometry.rotationDegrees,
    ...(Number.isFinite(artifact.deskewAppliedDegrees)
      ? { deskewAppliedDegrees: Number(artifact.deskewAppliedDegrees) }
      : {}),
    corners,
  };
}

function withSurfaceAnalysisForSide(
  analysis: FixedRigEvidencePackageJson,
  side: FixedRigCardSide,
  surfaceAnalysis: FixedRigEvidencePackageJson | undefined
): FixedRigEvidencePackageJson {
  if (!surfaceAnalysis) return analysis;
  const sideAnalysis = analysis[side] ?? {};
  const diagnosticGrading = sideAnalysis.diagnosticGrading
    ? {
        ...sideAnalysis.diagnosticGrading,
        surface: {
          ...(sideAnalysis.diagnosticGrading.surface ?? {}),
          status: surfaceAnalysis.status ?? sideAnalysis.diagnosticGrading.surface?.status ?? "computed_diagnostic",
          surfaceAnalysis,
        },
      }
    : undefined;
  return {
    ...analysis,
    [side]: {
      ...sideAnalysis,
      surfaceAnalysis,
      ...(diagnosticGrading ? { diagnosticGrading } : {}),
    },
  };
}

export async function createUnifiedFixedRigDiagnosticCardReport(input: {
  frontPackageDir: string;
  backPackageDir: string;
  outputDir: string;
}): Promise<FixedRigUnifiedDiagnosticCardReportResult> {
  const { packageId, packageDir } = await createFixedRigPackageDir(input.outputDir, "ai-grader-fixed-rig-v1-unified-diagnostic-report");
  const generatedAt = new Date().toISOString();
  const [frontManifest, backManifest, frontAnalysis, backAnalysis] = await Promise.all([
    readJsonFile(path.join(input.frontPackageDir, "manifest.json")),
    readJsonFile(path.join(input.backPackageDir, "manifest.json")),
    readJsonFile(path.join(input.frontPackageDir, "analysis.json")),
    readJsonFile(path.join(input.backPackageDir, "analysis.json")),
  ]);
  const front = evidenceSideFromPackage(frontManifest, "front");
  const back = evidenceSideFromPackage(backManifest, "back");
  const baseWarnings = [
    ...(front ? [] : ["Front evidence package is missing front-side evidence; unified report is insufficient_evidence."]),
    ...(back ? [] : ["Back evidence package is missing back-side evidence; unified report is insufficient_evidence."]),
    sideClippingWarning("Front", sideAllOnStats(front)),
    sideClippingWarning("Back", sideAllOnStats(back)),
  ].filter((warning): warning is string => Boolean(warning));
  const status: FixedRigUnifiedDiagnosticCardReportResult["status"] = front && back ? "computed_diagnostic" : "insufficient_evidence";
  const activeLightingProfile = frontManifest.activeLightingProfile ?? backManifest.activeLightingProfile;
  const fixtureCalibrationProfile = front?.fixtureCalibrationProfile ?? back?.fixtureCalibrationProfile;
  const reportPath = path.join(packageDir, "provisional-diagnostic-report.html");
  const manifestPath = path.join(packageDir, "manifest.json");
  const analysisPath = path.join(packageDir, "analysis.json");
  const frontDiagnostic = sideDiagnosticFromAnalysis(frontAnalysis, "front") ?? front?.diagnosticGrading;
  const backDiagnostic = sideDiagnosticFromAnalysis(backAnalysis, "back") ?? back?.diagnosticGrading;
  const frontSurface = sideSurfaceFromAnalysis(frontAnalysis, "front") ?? front?.surfaceAnalysis;
  const backSurface = sideSurfaceFromAnalysis(backAnalysis, "back") ?? back?.surfaceAnalysis;
  const frontStats = sideAllOnStats(front);
  const backStats = sideAllOnStats(back);
  const frontSurfaceIntelligence = front
    ? await buildPreliminarySurfaceIntelligenceV0({
        side: "front",
        outputDir: path.join(packageDir, "surface-intelligence", "front"),
        trueView: front.displayImage,
        allOn: front.displayImage,
        acceptedProfile: front.acceptedProfile?.displayImage,
        channelImages: surfaceIntelligenceChannels(front, frontSurface),
        roiDefinitions: front.roiDefinitions,
        roiCrops: front.roiCrops,
        quality: frontStats,
        inheritedWarnings: baseWarnings,
        registrationStatus:
          front.analysisCoordinateSystem?.coordinateFrame === "normalized_card_portrait_pixels"
            ? "normalized_geometry_transform"
            : "assumed_fixed_rig",
        normalizedCardProjection: surfaceIntelligenceNormalizedCardProjection(front),
      })
    : undefined;
  const backSurfaceIntelligence = back
    ? await buildPreliminarySurfaceIntelligenceV0({
        side: "back",
        outputDir: path.join(packageDir, "surface-intelligence", "back"),
        trueView: back.displayImage,
        allOn: back.displayImage,
        acceptedProfile: back.acceptedProfile?.displayImage,
        channelImages: surfaceIntelligenceChannels(back, backSurface),
        roiDefinitions: back.roiDefinitions,
        roiCrops: back.roiCrops,
        quality: backStats,
        inheritedWarnings: baseWarnings,
        registrationStatus:
          back.analysisCoordinateSystem?.coordinateFrame === "normalized_card_portrait_pixels"
            ? "normalized_geometry_transform"
            : "assumed_fixed_rig",
        normalizedCardProjection: surfaceIntelligenceNormalizedCardProjection(back),
      })
    : undefined;
  const enhancedFrontSurface = frontSurfaceIntelligence ? mergeSurfaceAnalysisWithSurfaceIntelligence(frontSurface, frontSurfaceIntelligence) : frontSurface;
  const enhancedBackSurface = backSurfaceIntelligence ? mergeSurfaceAnalysisWithSurfaceIntelligence(backSurface, backSurfaceIntelligence) : backSurface;
  const frontLightDirection = front
    ? await buildLightDirectionCalibrationArtifacts({
        side: "front",
        outputDir: path.join(packageDir, "light-direction", "front"),
        trueView: front.displayImage,
        darkControl: front.darkControl?.displayImage,
        allOn: front.displayImage,
        channelImages: surfaceIntelligenceChannels(front, enhancedFrontSurface),
        roiDefinitions: front.roiDefinitions,
        inheritedWarnings: [...baseWarnings, ...(enhancedFrontSurface?.warnings ?? [])],
        fixtureId: fixtureCalibrationProfile?.fixtureId ?? fixtureCalibrationProfile?.fixtureLabel,
        leimacModel: "IDMU-P8B-24",
        cameraModel: front.allOn?.capture?.camera?.modelName ?? front.displayImage?.camera?.modelName,
        ...(front.analysisCoordinateSystem?.coordinateFrame === "normalized_card_portrait_pixels" &&
        Number.isFinite(front.normalizedCard?.normalizedArtifact?.deskewAppliedDegrees)
          ? {
              lightVectorCoordinateTransform: {
                sourceCoordinateFrame: "basler_sensor_pixels" as const,
                targetCoordinateFrame: "normalized_card_portrait_pixels" as const,
                clockwiseRotationDegrees: front.normalizedCard.normalizedArtifact.deskewAppliedDegrees,
                source: "authoritative_card_normalization" as const,
              },
            }
          : {}),
      })
    : undefined;
  const backLightDirection = back
    ? await buildLightDirectionCalibrationArtifacts({
        side: "back",
        outputDir: path.join(packageDir, "light-direction", "back"),
        trueView: back.displayImage,
        darkControl: back.darkControl?.displayImage,
        allOn: back.displayImage,
        channelImages: surfaceIntelligenceChannels(back, enhancedBackSurface),
        roiDefinitions: back.roiDefinitions,
        inheritedWarnings: [...baseWarnings, ...(enhancedBackSurface?.warnings ?? [])],
        fixtureId: fixtureCalibrationProfile?.fixtureId ?? fixtureCalibrationProfile?.fixtureLabel,
        leimacModel: "IDMU-P8B-24",
        cameraModel: back.allOn?.capture?.camera?.modelName ?? back.displayImage?.camera?.modelName,
        ...(back.analysisCoordinateSystem?.coordinateFrame === "normalized_card_portrait_pixels" &&
        Number.isFinite(back.normalizedCard?.normalizedArtifact?.deskewAppliedDegrees)
          ? {
              lightVectorCoordinateTransform: {
                sourceCoordinateFrame: "basler_sensor_pixels" as const,
                targetCoordinateFrame: "normalized_card_portrait_pixels" as const,
                clockwiseRotationDegrees: back.normalizedCard.normalizedArtifact.deskewAppliedDegrees,
                source: "authoritative_card_normalization" as const,
              },
            }
          : {}),
      })
    : undefined;
  const enhancedFrontSurfaceWithLight = frontLightDirection ? mergeSurfaceAnalysisWithLightDirection(enhancedFrontSurface, frontLightDirection) : enhancedFrontSurface;
  const enhancedBackSurfaceWithLight = backLightDirection ? mergeSurfaceAnalysisWithLightDirection(enhancedBackSurface, backLightDirection) : enhancedBackSurface;
  const enhancedFrontAnalysis = withSurfaceAnalysisForSide(frontAnalysis, "front", enhancedFrontSurfaceWithLight);
  const enhancedBackAnalysis = withSurfaceAnalysisForSide(backAnalysis, "back", enhancedBackSurfaceWithLight);
  const warnings = Array.from(
    new Set([
      ...baseWarnings,
      ...(enhancedFrontSurfaceWithLight?.warnings ?? []),
      ...(enhancedBackSurfaceWithLight?.warnings ?? []),
    ])
  );
  const provisionalGradeStory = buildFixedRigProvisionalGradeStory({
    packageId,
    generatedAt,
    frontDiagnostic,
    backDiagnostic,
    frontSurface: enhancedFrontSurfaceWithLight,
    backSurface: enhancedBackSurfaceWithLight,
    frontStats,
    backStats,
    fixtureProfile: fixtureCalibrationProfile,
    frontFixtureProfile: front?.fixtureCalibrationProfile,
    backFixtureProfile: back?.fixtureCalibrationProfile,
    activeLightingProfile,
    warnings,
    allowAcceptedWarnings: true,
  });
  const visionLabData = buildVisionLabData({
    packageId,
    generatedAt,
    front,
    back,
    frontDiagnostic,
    backDiagnostic,
    frontSurface: enhancedFrontSurfaceWithLight,
    backSurface: enhancedBackSurfaceWithLight,
    frontStats,
    backStats,
    activeProfile: activeLightingProfile,
    fixtureProfile: fixtureCalibrationProfile,
    provisionalGradeStory,
    warnings,
  });
  const reportHtml = renderUnifiedFixedRigCardReport({
    packageId,
    generatedAt,
    frontPackageDir: input.frontPackageDir,
    backPackageDir: input.backPackageDir,
    frontManifest,
    backManifest,
    frontAnalysis: enhancedFrontAnalysis,
    backAnalysis: enhancedBackAnalysis,
    warnings,
    visionLabData,
    provisionalGradeStory,
  });
  const result: FixedRigUnifiedDiagnosticCardReportResult = {
    packageId,
    packageDir,
    reportPath,
    manifestPath,
    analysisPath,
    status,
    evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
    isCalibrated: false,
    finalGradeComputed: false,
    certifiedClaim: false,
    frontPackageDir: input.frontPackageDir,
    backPackageDir: input.backPackageDir,
    frontReportPath: frontManifest.previewReportPath,
    backReportPath: backManifest.previewReportPath,
    activeLightingProfile,
    fixtureCalibrationProfile,
    framingGateStatus: fixtureCalibrationProfile?.framingGate?.status,
    overlayAlignmentStatus: fixtureCalibrationProfile?.framingGate?.overlayAlignmentStatus,
    warnings,
  };
  await writeJsonArtifact(manifestPath, {
    ...result,
    generatedAt,
    geometry: {
      front: front?.normalizedCard?.geometry,
      back: back?.normalizedCard?.geometry,
    },
    normalizedArtifacts: {
      front: front?.normalizedCard?.normalizedArtifact,
      back: back?.normalizedCard?.normalizedArtifact,
      rawEvidencePreserved:
        (front?.rawEvidenceIntegrity?.verified ?? front?.normalizedCard?.rawEvidencePreserved) === true &&
        (back?.rawEvidenceIntegrity?.verified ?? back?.normalizedCard?.rawEvidencePreserved) === true,
      rawEvidenceIntegrity: {
        front: front?.rawEvidenceIntegrity,
        back: back?.rawEvidenceIntegrity,
      },
    },
    captureTiming: {
      front: frontManifest.captureTiming,
      back: backManifest.captureTiming,
      frontProcessing: frontManifest.processingTiming,
      backProcessing: backManifest.processingTiming,
    },
    sourceReports: {
      front: frontManifest.previewReportPath,
      back: backManifest.previewReportPath,
    },
    reportContains: {
      frontEvidenceImages: Boolean(front?.displayImage?.outputFilePath),
      backEvidenceImages: Boolean(back?.displayImage?.outputFilePath),
      normalizedFrontCard: Boolean(front?.normalizedCard?.normalizedArtifact?.localOutputPath),
      normalizedBackCard: Boolean(back?.normalizedCard?.normalizedArtifact?.localOutputPath),
      centeringDiagnostic: Boolean(front?.diagnosticGrading?.centering || frontAnalysis.front?.diagnosticGrading?.centering) && Boolean(back?.diagnosticGrading?.centering || backAnalysis.back?.diagnosticGrading?.centering),
      cornerDiagnostics: Boolean(front?.diagnosticGrading?.corners || frontAnalysis.front?.diagnosticGrading?.corners) && Boolean(back?.diagnosticGrading?.corners || backAnalysis.back?.diagnosticGrading?.corners),
      edgeDiagnostics: Boolean(front?.diagnosticGrading?.edges || frontAnalysis.front?.diagnosticGrading?.edges) && Boolean(back?.diagnosticGrading?.edges || backAnalysis.back?.diagnosticGrading?.edges),
      surfaceAnomalyDiagnostic: Boolean(front?.surfaceAnalysis || enhancedFrontAnalysis.front?.surfaceAnalysis) && Boolean(back?.surfaceAnalysis || enhancedBackAnalysis.back?.surfaceAnalysis),
      visionLab: true,
      trueView: true,
      surfaceVision: true,
      heatmap: true,
      surfaceIntelligenceV0: Boolean(
        enhancedFrontSurfaceWithLight?.surfaceVision ||
          enhancedFrontSurfaceWithLight?.heatmap ||
          enhancedBackSurfaceWithLight?.surfaceVision ||
          enhancedBackSurfaceWithLight?.heatmap
      ),
      lightDirectionCalibration: Boolean(frontLightDirection?.profile || backLightDirection?.profile),
      normalProxy: Boolean(enhancedFrontSurfaceWithLight?.normalProxy || enhancedBackSurfaceWithLight?.normalProxy),
      reliefProxy: Boolean(enhancedFrontSurfaceWithLight?.reliefProxy || enhancedBackSurfaceWithLight?.reliefProxy),
      confidenceMap: Boolean(enhancedFrontSurfaceWithLight?.confidenceMap || enhancedBackSurfaceWithLight?.confidenceMap),
      provisionalDiagnosticGrade: provisionalGradeStory.status === "provisional_diagnostic_grade",
      gradeStoryEngine: true,
      whyNot10: true,
      gradeImpactCandidates: true,
      collectorExpertGradeModes: true,
      lightSweepWheel: true,
      measurementOverlay: true,
      confidenceLens: true,
      evidenceReplay: true,
      finalGrade: false,
      labelQrOrCertificate: false,
      certificateOrCertifiedClaim: false,
    },
    provisionalGradeStory: {
      schemaVersion: PROVISIONAL_GRADE_STORY_ENGINE_VERSION,
      rulesVersion: PROVISIONAL_GRADE_RULES_VERSION,
      status: provisionalGradeStory.status,
      provisionalGradeComputed: provisionalGradeStory.provisionalGradeComputed,
      provisionalOverallGrade: provisionalGradeStory.provisionalOverallGrade,
      confidence: provisionalGradeStory.confidence,
      gateSummary: provisionalGradeStory.gates,
      finalGradeComputed: false,
      certifiedClaim: false,
      labelGenerated: false,
      qrGenerated: false,
      certificateGenerated: false,
    },
    visionLab: {
      schemaVersion: visionLabData.schemaVersion,
      localStaticHtml: true,
      modes: ["Collector Mode", "Expert Mode"],
      views: visionLabData.views,
      dataContract: {
        frontBackTrueViewImageRefs: true,
        frontBackOverlayImageRefs: true,
        frontBackChannelImageRefs1Through8: true,
        heatmapRefs: true,
        surfaceVisionRefs: true,
        normalProxyRefs: true,
        reliefProxyRefs: true,
        confidenceMapRefs: true,
        channelBalanceMetrics: true,
        lightDirectionProfileMetadata: true,
        sourceChannelAttribution: true,
        provisionalGradeStory: true,
        gradeImpactCandidates: true,
        whyNot10Reasons: true,
        anomalyCandidateList: true,
        measurementOverlayMetadata: true,
        calibrationProfileMetadata: true,
        clippingFocusConfidenceWarnings: true,
      },
      noServerRequired: true,
      noFinalGrade: true,
      noCertificateOrCertifiedClaim: true,
    },
    note: "Unified front/back provisional diagnostic report only. No final grade, certificate, or certified grading claim is made.",
  });
  await writeJsonArtifact(analysisPath, {
    status,
    evidenceClass: FIXED_RIG_V1_EVIDENCE_CLASS,
    geometry: {
      front: front?.normalizedCard?.geometry,
      back: back?.normalizedCard?.geometry,
    },
    normalizedArtifacts: {
      front: front?.normalizedCard?.normalizedArtifact,
      back: back?.normalizedCard?.normalizedArtifact,
    },
    captureTiming: {
      front: frontManifest.captureTiming,
      back: backManifest.captureTiming,
      frontProcessing: frontManifest.processingTiming,
      backProcessing: backManifest.processingTiming,
    },
    front: enhancedFrontAnalysis.front,
    back: enhancedBackAnalysis.back,
    surfaceIntelligence: {
      detectorId: PRELIMINARY_SURFACE_INTELLIGENCE_VERSION,
      front: enhancedFrontSurfaceWithLight,
      back: enhancedBackSurfaceWithLight,
    },
    lightDirectionCalibration: {
      profileVersion: LIGHT_DIRECTION_CALIBRATION_PROFILE_VERSION,
      proxyVersion: PRELIMINARY_NORMAL_RELIEF_PROXY_VERSION,
      front: frontLightDirection,
      back: backLightDirection,
    },
    provisionalGradeStory,
    visionLab: visionLabData,
    combinedWarnings: warnings,
    finalGradeComputed: false,
    certifiedClaim: false,
    labelGenerated: false,
    qrGenerated: false,
    certificateGenerated: false,
  });
  await writeFile(reportPath, reportHtml, "utf-8");
  return result;
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
