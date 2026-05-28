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
  BuildMicroSpotPackageIdInput,
  BuildMacroSuspectRegionIdInput,
  BuildStandardSpotPlanInput,
  CardCoordinateNormalizationInput,
  CardToStageTransformInput,
  CaptureManifest,
  CaptureManifestFrame,
  CaptureManifestModeValidationOptions,
  CaptureSide,
  CenteringMeasurement,
  CoordinateUnit,
  DeviceCapabilityManifest,
  DeviceHealthStatus,
  DeviceType,
  EvidenceArtifactRef,
  FusionAction,
  FusionActionType,
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
  PhysicalGateStatus,
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
  ThresholdSetVersionSeed,
} from "./aiGrader";
export {
  DEFAULT_STANDARD_SURFACE_TOP_N,
  DEFAULT_SURFACE_SUSPECT_THRESHOLD,
  ORCHESTRATOR_NAMED_ERROR_STATES,
  STANDARD_CORNERS_PER_SIDE,
  STANDARD_EDGES_PER_SIDE,
  buildInitialAiGraderAlgorithmVersions,
  buildInitialAiGraderThresholdSets,
  buildMacroSuspectRegionId,
  buildMicroSpotPackageId,
  buildModePlan,
  buildRuntimeEnvironmentFingerprint,
  buildStandardSpotPlan,
  normalizeBackSideCardCoordinates,
  sortAndSelectStandardSurfaceSuspects,
  transitionOrchestratorState,
  validateAlgorithmVersionSeed,
  validateCardToStageTransformInput,
  validateCaptureManifest,
  validateCaptureManifestForMode,
  validateCaptureManifestFrame,
  validateDeviceCapabilityManifest,
  validateMacroPipelineOutput,
  validateMacroSuspectRegion,
  validateMicroPackageForFusion,
  validateMicroSpotCaptureFrames,
  validateMicroSpotCapturePackage,
  validateReplayTolerance,
  validateRuntimeEnvironmentFingerprint,
  validateStandardSpotPlan,
  validateThresholdSetVersionSeed,
} from "./aiGrader";
