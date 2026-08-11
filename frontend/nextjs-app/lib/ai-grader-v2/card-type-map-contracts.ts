import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
  SpeedsterReviewFinding,
} from "./contracts";
import type { SpeedsterSessionIdentity } from "./identity";

export const SPEEDSTER_MAP_SCHEMA_VERSION = "speedster-card-type-map-v1" as const;
export const SPEEDSTER_MAP_REGISTRATION_VERSION = "opencv-human-anchor-registration-v1" as const;
export const SPEEDSTER_MAP_FILTER_POLICY_VERSION = "speedster-map-filter-containment-v1" as const;
export const SPEEDSTER_MAP_FILTER_RULE_ID = "human-zone-full-contour-containment-v1" as const;
export const SPEEDSTER_MAP_ZONE_OVERLAP_METHOD = "candidate-contour-segment-containment-v1" as const;

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

export type SpeedsterMapZoneSemanticType =
  | "PRINT_TEXT"
  | "PRINT_LOGO"
  | "PRINT_ARTWORK"
  | "PRINT_BORDER"
  | "PRINT_FOIL"
  | "OTHER_PRINT_CONTEXT";

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

export type SpeedsterMapZone = Readonly<{
  id: string;
  label: string;
  semanticType: SpeedsterMapZoneSemanticType;
  polygon: readonly SpeedsterPoint[];
}>;

export type SpeedsterCardTypeMapSide = Readonly<{
  side: SpeedsterCardSide;
  referenceInspection: SpeedsterMapReferenceEvidence;
  sourcePhysicalQuadSha256: string;
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: readonly SpeedsterMapAnchor[];
  zones: readonly SpeedsterMapZone[];
}>;

export type SpeedsterCardTypeMapBody = Readonly<{
  schemaVersion: typeof SPEEDSTER_MAP_SCHEMA_VERSION;
  front: SpeedsterCardTypeMapSide;
  back: SpeedsterCardTypeMapSide;
}>;

export type SpeedsterMapRegistration = Readonly<{
  version: typeof SPEEDSTER_MAP_REGISTRATION_VERSION;
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
  filterPolicyVersion: typeof SPEEDSTER_MAP_FILTER_POLICY_VERSION;
  ruleId: typeof SPEEDSTER_MAP_FILTER_RULE_ID;
  ruleInputs: Readonly<{
    findingOrigin: "DETECTOR" | "MEMORY";
    requiredCoverageRatio: 1;
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

export function canonicalSpeedsterMapKeyJson(key: SpeedsterCardTypeMapKey): string {
  return JSON.stringify(key);
}
