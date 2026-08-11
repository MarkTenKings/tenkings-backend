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
export const SPEEDSTER_MAP_ZONE_OVERLAP_METHOD = "candidate-contour-vertex-coverage-v1" as const;

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
