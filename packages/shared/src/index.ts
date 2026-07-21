// Shared DTOs and interfaces for TenKings services.
export interface User {
  id: string;
  email: string;
}

export interface Item {
  id: string;
  name: string;
  set: string;
  number?: string;
  language?: string;
  foil?: boolean;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  amount: number;
  type: "credit" | "debit";
  createdAt: string;
  note?: string;
}

export interface Listing {
  id: string;
  itemId: string;
  sellerId: string;
  price: number;
  status: "ACTIVE" | "SOLD" | "REMOVED";
}

export interface PackDefinition {
  id: string;
  name: string;
  description?: string;
  price?: number;
  inventoryCount?: number;
  tiers: Array<{ tier: string; odds: number }>;
}

export {
  buildEbaySoldUrlFromText,
  buildEbaySoldUrlFromQuery,
  buildComparableEbayUrls,
} from "./ebay";
export type { EbayComparableUrls } from "./ebay";
export type { CardAttributes, AttributeExtractionOptions } from "./cardAttributes";
export { extractCardAttributes, inferPlayerNameFromText } from "./cardAttributes";
export type {
  CardClassificationPayload,
  NormalizedClassification,
  NormalizedClassificationSport,
  NormalizedClassificationTcg,
  NormalizedClassificationComics,
  NormalizedPricingEntry,
  NormalizedClassificationLinks,
  ClassificationCategory,
  ClassificationSnapshotLike,
  ClassificationSnapshotSummaryLike,
} from "./classification";
export {
  buildClassificationPayload,
  createClassificationPayloadFromAttributes,
  buildNormalizedClassificationFromXimilar,
  parseClassificationPayload,
  getCardAttributesFromClassification,
  getNormalizedClassification,
} from "./classification";
export type { SetOpsDuplicateKeyInput } from "./setOpsNormalizer";
export {
  decodeHtmlEntities,
  normalizeSetLabel,
  normalizeParallelLabel,
  normalizeCardNumber,
  normalizePlayerSeed,
  normalizeListingId,
  normalizeSetOpsOddsText,
  looksLikeSetOpsOddsValue,
  parseSetOpsOddsNumeric,
  buildSetOpsDuplicateKey,
  buildSetDeleteConfirmationPhrase,
  isSetDeleteConfirmationValid,
} from "./setOpsNormalizer";
export {
  normalizeCardIdentityPlayerName,
  normalizeCardIdentityPlayerNameBase,
} from "./cardIdentity";
export type {
  KingsreviewCompMatchQuality,
  KingsreviewCompMatchContext,
  KingsreviewCompKeyComparisonField,
  KingsreviewCompKeyComparison,
  KingsreviewCompMatchResult,
  KingsreviewCompCandidate,
} from "./kingsreviewCompMatch";
export {
  normalizeCompMatchText,
  tokenizeCompMatchText,
  tokenOverlapScore,
  normalizeEbayItemSpecifics,
  buildKingsreviewCompMatchContext,
  fuzzyPlayerMatch,
  fuzzySetMatch,
  fuzzyParallelMatch,
  scoreKingsreviewComp,
  annotateAndSortKingsreviewComps,
} from "./kingsreviewCompMatch";
export type {
  OcrLlmAttemptFormat,
  OcrLlmAttempt,
  OcrLlmAttemptResult,
  ResolveOcrLlmAttemptInput,
  ResolveOcrLlmAttemptOutput,
} from "./ocrLlmFallback";
export {
  isStructuredOutputUnsupported,
  buildOcrLlmAttemptPlan,
  resolveOcrLlmAttempt,
} from "./ocrLlmFallback";
export type {
  AiGraderValidationIssue,
  AiGraderValidationIssueCode,
  AiGraderValidationResult,
  AlgorithmVersionSeed,
  AuthProfileLifecycleDecision,
  AuthReportClaimBoundaryInput,
  AuthRunContract,
  AuthRunStatus,
  AuthVerdict,
  ArmInterlockStateValidationInput,
  ArmInterlockStatus,
  ArmPosition,
  BuildFusionActionInput,
  BuildMicroSpotPackageIdInput,
  BuildMacroSuspectRegionIdInput,
  BuildStandardSpotPlanInput,
  CardCoordinateNormalizationInput,
  CardIdentityInput,
  CardIdentityValidationOptions,
  CardPrintProfileContract,
  CardToStageTransformInput,
  CaptureManifest,
  CaptureManifestFrame,
  CaptureManifestModeValidationOptions,
  CaptureSide,
  CenteringMeasurement,
  CalibrationFreshnessOptions,
  CalibrationSnapshotContract,
  CalibrationType,
  CertificateStatus,
  CoordinateUnit,
  CustodyEventContract,
  CustodyEventType,
  DeviceCapabilityManifest,
  DeviceHealthStatus,
  DeviceType,
  DustCorrectionBoundsInput,
  EvidenceArtifactContract,
  EvidenceClass,
  EvidenceArtifactRef,
  FusionAction,
  FusionActionType,
  GradeCertificateContract,
  GradingCaptureKind,
  GradingElement,
  GradingMode,
  MacroPipelineOutput,
  MacroSuspectRegion,
  MacroSuspectRegionSelectionOptions,
  MicroPackageFusionValidationOptions,
  MicroSpotElement,
  MicroSpotCapturePackage,
  MicroSpotFrameKey,
  ModePlan,
  OfficeGradeRunRequest,
  OrchestratorEvent,
  OrchestratorEventType,
  OrchestratorGuardResults,
  OrchestratorGuardValue,
  OrchestratorState,
  OrchestratorTransitionInput,
  OrchestratorTransitionResult,
  PhysicalGateResult,
  PhysicalGateDecision,
  PhysicalGateKind,
  PhysicalGateStatus,
  PrintProfileStatus,
  PublicReportClaimCheck,
  PublicReportDisclosure,
  Rect,
  ReplayRunInput,
  ReplayToleranceFailure,
  ReplayToleranceResult,
  RuntimeEnvironmentFingerprint,
  RuntimeEnvironmentFingerprintInput,
  StageTravelBoundsMicrons,
  StandardSpotPlan,
  StandardSpotPlanElement,
  StandardSpotPlanSpot,
  StandardFusionInput,
  StandardFusionOutput,
  StandardFusionOutputValidationOptions,
  StandardFusionScopeValidationInput,
  RequiredCalibrationSetOptions,
  ThresholdSetVersionSeed,
} from "./aiGrader";
export * from "./aiGraderDefectFindings";
export * from "./aiGraderDefectFindingsV2";
export * from "./aiGraderReportBundles";
export * from "./aiGraderReportBundlesV03";
export * from "./aiGraderMathematicalCalibrationV1";
export * from "./aiGraderPokemonStandardCornerProfileV1";
export {
  COLOR_CHECKER_MAX_MEAN_DELTA_E,
  DEFAULT_REQUIRED_CALIBRATION_TYPES,
  DEFAULT_STANDARD_SURFACE_TOP_N,
  DEFAULT_SURFACE_SUSPECT_THRESHOLD,
  FOCUS_BASELINE_MAX_DROP_PERCENT,
  LED_MAX_CHANNEL_DEVIATION_PERCENT,
  MICROSCOPE_SCALE_MAX_MISMATCH_PERCENT,
  ORCHESTRATOR_NAMED_ERROR_STATES,
  STANDARD_CORNERS_PER_SIDE,
  STANDARD_EDGES_PER_SIDE,
  STAGE_TRANSFORM_MAX_RMS_RESIDUAL_MICRONS,
  buildInitialAiGraderAlgorithmVersions,
  buildInitialAiGraderThresholdSets,
  buildFusionAction,
  buildMacroSuspectRegionId,
  buildMicroSpotPackageId,
  buildModePlan,
  buildRuntimeEnvironmentFingerprint,
  buildStandardSpotPlan,
  normalizeBackSideCardCoordinates,
  resolveAuthVerdictFromProfileState,
  sortAndSelectStandardSurfaceSuspects,
  transitionOrchestratorState,
  validateAlgorithmVersionSeed,
  validateArmInterlockForState,
  validateAuthProfileLifecycleTransition,
  validateAuthReportClaimBoundary,
  validateAuthRunContract,
  validateCardToStageTransformInput,
  validateCardIdentityInput,
  validateCardPrintProfileContract,
  validateCalibrationFreshness,
  validateCalibrationSnapshotContract,
  validateCaptureManifest,
  validateCaptureManifestForMode,
  validateCaptureManifestFrame,
  validateCenteringIgnoresMicroEvidence,
  validateCertificateAllowedForMode,
  validateCertificateAllowedByPhysicalGates,
  validateCertificateEvidenceReadiness,
  validateCustodyChainForCertificate,
  validateCustodyEventContract,
  validateDeviceCapabilityManifest,
  validateDustCorrectionBounds,
  validateEvidenceArtifactContract,
  validateFusionAction,
  validateMacroPipelineOutput,
  validateMacroSuspectRegion,
  validateMacroCaptureArmGate,
  validateMicroscopeCaptureArmGate,
  validateMicroPackageForFusion,
  validateMicroSpotCaptureFrames,
  validateMicroSpotCapturePackage,
  validatePhysicalGateResult,
  validatePublicClaimText,
  validatePublicReportDisclosure,
  validateReplayTolerance,
  validateRequiredCalibrationSet,
  validateRuntimeEnvironmentFingerprint,
  validateStandardFusionInput,
  validateStandardFusionOutput,
  validateStandardFusionScope,
  validateStandardSpotPlan,
  validateThresholdSetVersionSeed,
} from "./aiGrader";
