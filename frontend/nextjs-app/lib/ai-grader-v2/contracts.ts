import type { SpeedsterTraceRleV1 } from "./trace-codec";

export const SPEEDSTER_RULE_VERSION = "TK_SPEEDSTER_2026_07_31" as const;

export type SpeedsterCardProfile = "POKEMON" | "SPORTS";
export type SpeedsterCardSide = "FRONT" | "BACK";
export type SpeedsterConditionZone = "CORNERS" | "EDGES" | "SURFACE";
export type SpeedsterViewType = "ORIGINAL" | "NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL";

export type SpeedsterPoint = {
  x: number;
  y: number;
};

export type SpeedsterQuad = readonly [
  SpeedsterPoint,
  SpeedsterPoint,
  SpeedsterPoint,
  SpeedsterPoint,
];

export type SpeedsterCardGeometry = {
  widthMm: number;
  heightMm: number;
  sourceWidthPx: number;
  sourceHeightPx: number;
  sourceCorners: SpeedsterQuad;
};

export type SpeedsterDefectType =
  | "FAINT_COLOR_VARIATION"
  | "VISIBLE_WHITENING"
  | "FRAYING"
  | "CHIPPING_EXPOSED_STOCK"
  | "LIFTING_DEFORMATION"
  | "LIGHT_SCRATCH_SCUFF"
  | "VISIBLE_SCRATCH_PRINT_COATING_LOSS"
  | "DENT_MATERIAL_DAMAGE"
  | "PEELING_HEAVY_DAMAGE";

export type SpeedsterReviewResult =
  | "UNREVIEWED"
  | "ACCEPTED"
  | "REMOVED"
  | "SMART_MARKED"
  | "TYPE_CORRECTED";

export type SpeedsterDefectOrigin = "DETECTOR" | "SMART_MARK" | "MEMORY";

export type SpeedsterSmartMarkLearning = {
  fingerprintProvenance: "SAM_TRACE" | "HUMAN_BOX_POOL" | "HARD_FAILURE";
  traceAttempts: 0 | 1 | 2;
  proposalOverlapIouGt03: boolean;
  proposalMaxIou: number;
};

export type SpeedsterMemoryProposal = {
  lessonSessionId: string;
  lessonCompletionOrder: number;
  lessonProposalOrder: number;
  lessonOrder: number;
  lessonSourceViewId: SpeedsterViewType;
  similarity: number;
};

export type SpeedsterFindingProvenanceContributor = {
  proposalId: string;
  origin: SpeedsterDefectOrigin;
  sourceViewId: string;
  defectType: SpeedsterDefectType;
  confidence: number;
  rankingConfidence: number;
  memoryProposal?: SpeedsterMemoryProposal;
};

export type SpeedsterFindingProvenance = {
  version: "speedster-finding-provenance-v1";
  primaryProposalId: string;
  contributors: readonly SpeedsterFindingProvenanceContributor[];
};

export type SpeedsterTraceProvenance = Readonly<{
  version: "speedster-trace-provenance-v1";
  sourceViewId: string;
  cropTransform: Readonly<{
    version: "speedster-canonical-crop-affine-v1";
    crop: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>;
  highlighterStrokes: readonly Readonly<{
    canonicalPoints: readonly Readonly<{ x: number; y: number }>[];
    strokeWidthMm: number;
  }>[];
  finalTraceSha256: string;
}>;

export type SpeedsterDefect = {
  id: string;
  side: SpeedsterCardSide;
  zone: SpeedsterConditionZone;
  defectType: SpeedsterDefectType;
  origin?: SpeedsterDefectOrigin;
  detectedDefectType?: SpeedsterDefectType;
  featureFingerprint?: readonly number[];
  featureFingerprintTraceSha256?: string;
  smartMarkLearning?: SpeedsterSmartMarkLearning;
  memoryProposal?: SpeedsterMemoryProposal;
  findingProvenance?: SpeedsterFindingProvenance;
  learningAdjustment?: number;
  confidence: number;
  canonicalContour: readonly SpeedsterPoint[];
  finalTrace?: SpeedsterTraceRleV1;
  traceSha256?: string;
  traceProvenance?: SpeedsterTraceProvenance;
  sourceViewId: string;
  supportingViewIds: readonly string[];
  reviewResult: SpeedsterReviewResult;
};

export type SpeedsterDefectMeasurement = {
  pixelCount?: number;
  widthMm: number;
  heightMm: number;
  areaMm2: number;
  zonePercent: number;
  multiplier: number;
  weightedAreaMm2: number;
  subgradeEffect: number;
};

export type SpeedsterMeasuredDefect = SpeedsterDefect & {
  measurement: SpeedsterDefectMeasurement;
};

export type SpeedsterMeasurementRegion = Readonly<{
  zone: SpeedsterConditionZone;
  canonicalContour: readonly SpeedsterPoint[];
  measurement: SpeedsterDefectMeasurement;
}>;

export type SpeedsterSourceMeasuredDefect = Omit<
  SpeedsterMeasuredDefect,
  "zone" | "canonicalContour" | "measurement"
> & {
  finalTrace?: SpeedsterTraceRleV1;
  traceProvenance?: SpeedsterTraceProvenance;
  measurementRegions: readonly SpeedsterMeasurementRegion[];
};

export type SpeedsterReviewFinding = SpeedsterMeasuredDefect | SpeedsterSourceMeasuredDefect;

export function isSpeedsterSourceMeasuredDefect(
  finding: SpeedsterReviewFinding,
): finding is SpeedsterSourceMeasuredDefect {
  return Array.isArray((finding as SpeedsterSourceMeasuredDefect).measurementRegions);
}

export type SpeedsterDetectorResult = {
  detectorVersion: string;
  defects: readonly SpeedsterDefect[];
};

export type SpeedsterSubgrades = {
  centering: number;
  corners: number;
  edges: number;
  surface: number;
};
