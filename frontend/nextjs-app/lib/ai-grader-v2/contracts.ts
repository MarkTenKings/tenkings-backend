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

export type SpeedsterDefectOrigin = "DETECTOR" | "SMART_MARK";

export type SpeedsterDefect = {
  id: string;
  side: SpeedsterCardSide;
  zone: SpeedsterConditionZone;
  defectType: SpeedsterDefectType;
  origin?: SpeedsterDefectOrigin;
  detectedDefectType?: SpeedsterDefectType;
  confidence: number;
  canonicalContour: readonly SpeedsterPoint[];
  sourceViewId: string;
  supportingViewIds: readonly string[];
  reviewResult: SpeedsterReviewResult;
};

export type SpeedsterDefectMeasurement = {
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
