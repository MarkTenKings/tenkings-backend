import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
  SpeedsterReviewFinding,
} from "./contracts";
import type { SpeedsterSessionIdentity } from "./identity";

export const SPEEDSTER_MAP_SCHEMA_VERSION = "speedster-card-type-map-v1" as const;
export const SPEEDSTER_MAP_SCHEMA_VERSION_V2 = "speedster-card-type-map-v2" as const;
export const SPEEDSTER_MAP_REGISTRATION_VERSION = "opencv-human-anchor-registration-v1" as const;
export const SPEEDSTER_MAP_REGISTRATION_VERSION_V2 = "opencv-redundant-ransac-registration-v2" as const;
export const SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION = "speedster-map-registration-acceptance-v2" as const;
export const SPEEDSTER_MAP_FILTER_POLICY_VERSION = "speedster-map-filter-containment-v1" as const;
export const SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2 = "speedster-map-filter-authority-padding-v2" as const;
export const SPEEDSTER_MAP_FILTER_RULE_ID = "human-zone-full-contour-containment-v1" as const;
export const SPEEDSTER_MAP_FILTER_RULE_ID_V2 = "human-authorized-padded-zone-full-contour-v2" as const;
export const SPEEDSTER_MAP_ZONE_OVERLAP_METHOD = "candidate-contour-segment-containment-v1" as const;
export const SPEEDSTER_MAP_FILTER_PADDING_MM = 0.6 as const;

export type SpeedsterMapSchemaVersion =
  | typeof SPEEDSTER_MAP_SCHEMA_VERSION
  | typeof SPEEDSTER_MAP_SCHEMA_VERSION_V2;
export type SpeedsterMapFilterPolicyVersion =
  | typeof SPEEDSTER_MAP_FILTER_POLICY_VERSION
  | typeof SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2;
export type SpeedsterMapFilterRuleId =
  | typeof SPEEDSTER_MAP_FILTER_RULE_ID
  | typeof SPEEDSTER_MAP_FILTER_RULE_ID_V2;

export type SpeedsterMapScope = "EXACT" | "FAMILY";

/**
 * Legacy exact-card key. Its shape and serialization are intentionally frozen
 * so every existing map hash and immutable revision remains valid.
 */
export type SpeedsterCardTypeMapKey = Readonly<{
  category: "SPORTS";
  year: string;
  manufacturer: string;
  productSet: string;
  insert: string | null;
  parallel: string | null;
  playerName: string;
  cardNumber: string | null;
}> | Readonly<{
  category: "POKEMON";
  year: string;
  productSet: string;
  parallel: string | null;
  cardName: string;
  cardNumber: string | null;
}>;

export type SpeedsterFamilyCardTypeMapKey = Readonly<{
  scope: "FAMILY";
  category: "SPORTS";
  year: string;
  manufacturer: string;
  productSet: string;
  insert: string | null;
  parallel: string | null;
}> | Readonly<{
  scope: "FAMILY";
  category: "POKEMON";
  year: string;
  productSet: string;
  parallel: string | null;
}>;

export type SpeedsterMapMatchKey = SpeedsterCardTypeMapKey | SpeedsterFamilyCardTypeMapKey;

export type SpeedsterMapZoneSemanticType =
  | "PRINT_TEXT"
  | "PRINT_LOGO"
  | "PRINT_ARTWORK"
  | "PRINT_BORDER"
  | "PRINT_FOIL"
  | "OTHER_PRINT_CONTEXT";

export type SpeedsterMapZoneContentType =
  | "HEADER"
  | "ARTWORK"
  | "SPECIES_STRIP"
  | "ATTACK"
  | "STATS_BAR"
  | "ARTIST_AND_CARD_ID"
  | "FLAVOR_TEXT"
  | "COPYRIGHT"
  | "OTHER";

export type SpeedsterMapZoneProposalSource =
  | "HUMAN"
  | "POKEMON_STANDARD_TEMPLATE"
  | "VISUAL_SNAP"
  | "COPIED_COMPATIBLE_MAP";

export type SpeedsterMapReferenceEvidence = Readonly<{
  storageKey: string;
  sha256: string;
}>;

export type SpeedsterMapAnchor = Readonly<{
  id: string;
  label: string;
  point: SpeedsterPoint;
  referencePatch: SpeedsterMapReferenceEvidence;
}>;

export type SpeedsterMapDesignBoundary =
  | Readonly<{ kind: "QUAD"; points: SpeedsterQuad }>
  | Readonly<{ kind: "FULL_BLEED" }>;

type SpeedsterMapZoneBase = Readonly<{
  id: string;
  label: string;
  semanticType: SpeedsterMapZoneSemanticType;
  polygon: readonly SpeedsterPoint[];
}>;

export type SpeedsterLegacyMapZone = SpeedsterMapZoneBase;

export type SpeedsterMapZoneV2 = SpeedsterMapZoneBase & Readonly<{
  contentType: SpeedsterMapZoneContentType;
  filterAuthority: boolean;
  filterAuthoritySource: "TYPE_DEFAULT" | "HUMAN_OVERRIDE";
  filterPaddingMm: typeof SPEEDSTER_MAP_FILTER_PADDING_MM;
  proposalSource: SpeedsterMapZoneProposalSource;
  proposalConfidence: number | null;
}>;

export type SpeedsterMapZone = SpeedsterLegacyMapZone | SpeedsterMapZoneV2;

export function isSpeedsterMapZoneV2(zone: SpeedsterMapZone): zone is SpeedsterMapZoneV2 {
  return "filterAuthority" in zone;
}

export function speedsterDefaultFilterAuthority(type: SpeedsterMapZoneSemanticType): boolean {
  return type === "PRINT_TEXT" || type === "PRINT_LOGO" || type === "PRINT_BORDER";
}

export type SpeedsterCardTypeMapSide = Readonly<{
  side: SpeedsterCardSide;
  referenceInspection: SpeedsterMapReferenceEvidence;
  sourcePhysicalQuadSha256: string;
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: readonly SpeedsterMapAnchor[];
  zones: readonly SpeedsterMapZone[];
}>;

export type SpeedsterCardTypeMapBody = Readonly<{
  schemaVersion: SpeedsterMapSchemaVersion;
  front: SpeedsterCardTypeMapSide;
  back: SpeedsterCardTypeMapSide;
}>;

export type SpeedsterMapRegistration = Readonly<{
  version: typeof SPEEDSTER_MAP_REGISTRATION_VERSION | typeof SPEEDSTER_MAP_REGISTRATION_VERSION_V2;
  side: SpeedsterCardSide;
  mapRevisionId: string;
  currentPhysicalQuadSha256: string;
  currentInspectionSha256: string;
  homography: readonly [number, number, number, number, number, number, number, number, number];
  anchors: readonly Readonly<{
    anchorId: string;
    expectedPoint: SpeedsterPoint;
    locatedPoint: SpeedsterPoint;
    score: number;
  }>[];
  projectedDesignBoundary: SpeedsterMapDesignBoundary;
  projectedZones: readonly SpeedsterMapZone[];
  candidateProvenance?: Readonly<{
    candidateId: string;
    source: "ORIGINAL_REFERENCE" | "REGISTRATION_LESSON" | "HUMAN_CORRECTION";
    lessonId?: string;
  }>;
  acceptance?: Readonly<{
    policyVersion: typeof SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION;
    mode: "AUTOMATIC_RANSAC" | "HUMAN_CONFIRMED";
    featureCount: number;
    usableFeatureCount: number;
    inlierCount: number;
    inlierFraction: number;
    perAnchorFeatureCounts: readonly [number, number, number, number];
    perAnchorInlierCounts: readonly [number, number, number, number];
    medianReprojectionErrorPx: number;
    maxReprojectionErrorPx: number;
  }>;
  /** Opaque server authority; required for every newly submitted capture binding. */
  serverReceipt?: string;
}>;

export type SpeedsterMapRegistrationAnchorDiagnostic = Readonly<{
  anchorId: string;
  expectedPoint: SpeedsterPoint;
  trackedPoint: SpeedsterPoint | null;
  locatedPoint: SpeedsterPoint | null;
  score: number;
  status: "TRACKED" | "LOW_CONFIDENCE" | "FAILED" | "OUT_OF_CARD";
}>;

export type SpeedsterMapRegistrationFailure = Readonly<{
  algorithmVersion: typeof SPEEDSTER_MAP_REGISTRATION_VERSION_V2;
  policyVersion: typeof SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION;
  accepted: false;
  failureCode: string;
  message: string;
  candidateCount: number;
  candidateIds: readonly string[];
  binding: Readonly<{
    side: SpeedsterCardSide;
    mapRevisionId: string;
    currentInspectionSha256: string;
    currentPhysicalQuadSha256: string;
    candidates: readonly Readonly<{
      candidateId: string;
      referenceInspectionSha256: string;
    }>[];
  }>;
  bestCandidate: Readonly<{
    candidateId: string;
    provenance: "ORIGINAL_REFERENCE" | "REGISTRATION_LESSON";
    accepted: false;
    failureCode: string;
    message: string;
    anchors: readonly SpeedsterMapRegistrationAnchorDiagnostic[];
    featureCount: number;
    usableFeatureCount: number;
    inlierCount: number;
    inlierFraction: number;
    perAnchorFeatureCounts: readonly [number, number, number, number];
    perAnchorInlierCounts: readonly [number, number, number, number];
    medianReprojectionErrorPx: number | null;
    maxReprojectionErrorPx: number | null;
  }>;
}>;

export type SpeedsterMapZoneOverlap = Readonly<{
  method: typeof SPEEDSTER_MAP_ZONE_OVERLAP_METHOD;
  coveredVertices: number;
  totalVertices: number;
  ratio: number;
  fullyContained: boolean;
}>;

export type SpeedsterFilterDecisionEvidence = Readonly<{
  finding: SpeedsterReviewFinding;
  cardIdentity: SpeedsterSessionIdentity;
  mapId: string;
  mapRevisionId: string;
  zoneId: string;
  zoneType: SpeedsterMapZoneSemanticType;
  zoneOverlap: SpeedsterMapZoneOverlap;
  filterPolicyVersion: SpeedsterMapFilterPolicyVersion;
  ruleId: SpeedsterMapFilterRuleId;
  ruleInputs: Readonly<{
    findingOrigin: "DETECTOR" | "MEMORY";
    requiredCoverageRatio: 1;
    filterAuthority?: true;
    filterPaddingMm?: typeof SPEEDSTER_MAP_FILTER_PADDING_MM;
  }>;
  detectorVersion: string;
}>;

const MAP_GEOMETRY_EPSILON = 1e-10;

function cross(left: SpeedsterPoint, middle: SpeedsterPoint, right: SpeedsterPoint) {
  return (middle.x - left.x) * (right.y - middle.y)
    - (middle.y - left.y) * (right.x - middle.x);
}

export function isSpeedsterStrictConvexPolygon(points: readonly SpeedsterPoint[]) {
  if (!isSpeedsterSimplePolygon(points)) return false;
  let orientation = 0;
  for (let index = 0; index < points.length; index += 1) {
    const turn = cross(
      points[index],
      points[(index + 1) % points.length],
      points[(index + 2) % points.length],
    );
    if (Math.abs(turn) <= MAP_GEOMETRY_EPSILON) return false;
    const nextOrientation = Math.sign(turn);
    if (orientation !== 0 && nextOrientation !== orientation) return false;
    orientation = nextOrientation;
  }
  return true;
}

function onSegment(point: SpeedsterPoint, left: SpeedsterPoint, right: SpeedsterPoint) {
  return Math.abs(cross(left, point, right)) <= MAP_GEOMETRY_EPSILON
    && point.x >= Math.min(left.x, right.x) - MAP_GEOMETRY_EPSILON
    && point.x <= Math.max(left.x, right.x) + MAP_GEOMETRY_EPSILON
    && point.y >= Math.min(left.y, right.y) - MAP_GEOMETRY_EPSILON
    && point.y <= Math.max(left.y, right.y) + MAP_GEOMETRY_EPSILON;
}

function segmentsIntersect(
  firstStart: SpeedsterPoint,
  firstEnd: SpeedsterPoint,
  secondStart: SpeedsterPoint,
  secondEnd: SpeedsterPoint,
) {
  const firstLeft = cross(firstStart, firstEnd, secondStart);
  const firstRight = cross(firstStart, firstEnd, secondEnd);
  const secondLeft = cross(secondStart, secondEnd, firstStart);
  const secondRight = cross(secondStart, secondEnd, firstEnd);
  if (
    Math.sign(firstLeft) !== Math.sign(firstRight)
    && Math.sign(secondLeft) !== Math.sign(secondRight)
    && Math.abs(firstLeft) > MAP_GEOMETRY_EPSILON
    && Math.abs(firstRight) > MAP_GEOMETRY_EPSILON
    && Math.abs(secondLeft) > MAP_GEOMETRY_EPSILON
    && Math.abs(secondRight) > MAP_GEOMETRY_EPSILON
  ) return true;
  return onSegment(secondStart, firstStart, firstEnd)
    || onSegment(secondEnd, firstStart, firstEnd)
    || onSegment(firstStart, secondStart, secondEnd)
    || onSegment(firstEnd, secondStart, secondEnd);
}

export function isSpeedsterSimplePolygon(points: readonly SpeedsterPoint[]) {
  if (points.length < 3) return false;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (
        Math.abs(points[left].x - points[right].x) <= MAP_GEOMETRY_EPSILON
        && Math.abs(points[left].y - points[right].y) <= MAP_GEOMETRY_EPSILON
      ) return false;
    }
  }
  const twiceArea = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (Math.abs(twiceArea) <= MAP_GEOMETRY_EPSILON) return false;
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return false;
      }
    }
  }
  return true;
}

export function isSpeedsterNondegenerateAnchorSet(points: readonly SpeedsterPoint[]) {
  if (points.length !== 4) return false;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (
        Math.abs(points[left].x - points[right].x) <= MAP_GEOMETRY_EPSILON
        && Math.abs(points[left].y - points[right].y) <= MAP_GEOMETRY_EPSILON
      ) return false;
    }
  }
  for (let first = 0; first < points.length - 2; first += 1) {
    for (let second = first + 1; second < points.length - 1; second += 1) {
      for (let third = second + 1; third < points.length; third += 1) {
        if (Math.abs(cross(points[first], points[second], points[third])) <= MAP_GEOMETRY_EPSILON) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Map lookup is exact after this deliberately narrow normalization. Punctuation
 * remains significant, and null/blank normalize together. No fuzzy or fallback
 * map lookup is permitted.
 */
export function normalizeSpeedsterMapKeyText(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

export function speedsterCardTypeMapKey(
  category: "SPORTS" | "POKEMON",
  identity: SpeedsterSessionIdentity,
): SpeedsterCardTypeMapKey {
  const required = (value: string | null | undefined, field: string) => {
    const normalized = normalizeSpeedsterMapKeyText(value);
    if (!normalized) throw new Error(`Speedster map key is missing ${field}.`);
    return normalized;
  };
  const optional = (value: string | null | undefined) => normalizeSpeedsterMapKeyText(value);
  if (category === "SPORTS") {
    if (!("playerName" in identity)) throw new Error("Sports map identity is category-incompatible.");
    return {
      category,
      year: required(identity.year, "year"),
      manufacturer: required(identity.manufacturer, "manufacturer"),
      productSet: required(identity.productSet, "productSet"),
      insert: optional(identity.insert),
      parallel: optional(identity.parallel),
      playerName: required(identity.playerName, "playerName"),
      cardNumber: optional(identity.cardNumber),
    };
  }
  if (!("cardName" in identity)) throw new Error("Pokemon map identity is category-incompatible.");
  return {
    category,
    year: required(identity.year, "year"),
    productSet: required(identity.productSet, "productSet"),
    parallel: optional(identity.parallel),
    cardName: required(identity.cardName, "cardName"),
    cardNumber: optional(identity.cardNumber),
  };
}

export function speedsterFamilyCardTypeMapKey(
  category: "SPORTS" | "POKEMON",
  identity: SpeedsterSessionIdentity,
): SpeedsterFamilyCardTypeMapKey {
  const required = (value: string | null | undefined, field: string) => {
    const normalized = normalizeSpeedsterMapKeyText(value);
    if (!normalized) throw new Error(`Speedster family map key is missing ${field}.`);
    return normalized;
  };
  const optional = (value: string | null | undefined) => normalizeSpeedsterMapKeyText(value);
  if (category === "SPORTS") {
    if (!("playerName" in identity)) throw new Error("Sports family map identity is category-incompatible.");
    return {
      scope: "FAMILY",
      category,
      year: required(identity.year, "year"),
      manufacturer: required(identity.manufacturer, "manufacturer"),
      productSet: required(identity.productSet, "productSet"),
      insert: optional(identity.insert),
      parallel: optional(identity.parallel),
    };
  }
  if (!("cardName" in identity)) throw new Error("Pokemon family map identity is category-incompatible.");
  return {
    scope: "FAMILY",
    category,
    year: required(identity.year, "year"),
    productSet: required(identity.productSet, "productSet"),
    parallel: optional(identity.parallel),
  };
}

export function speedsterMapScopeForKey(key: SpeedsterMapMatchKey): SpeedsterMapScope {
  return "scope" in key && key.scope === "FAMILY" ? "FAMILY" : "EXACT";
}

export function canonicalSpeedsterMapKeyJson(key: SpeedsterMapMatchKey): string {
  return JSON.stringify(key);
}
