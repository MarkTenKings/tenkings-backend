import { createHash, randomUUID } from "node:crypto";
import { Prisma as PrismaRuntime } from "@prisma/client";
import {
  prisma,
  type Prisma,
} from "@tenkings/database";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  canonicalSpeedsterMapKeyJson,
  isSpeedsterNondegenerateAnchorSet,
  isSpeedsterSimplePolygon,
  isSpeedsterStrictConvexPolygon,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
  speedsterMapScopeForKey,
  type SpeedsterCardTypeMapSide,
  type SpeedsterMapAnchor,
  type SpeedsterMapDesignBoundary,
  type SpeedsterMapMatchKey,
  type SpeedsterMapReferenceEvidence,
  type SpeedsterMapRegistration,
  type SpeedsterMapScope,
  type SpeedsterMapZone,
} from "../ai-grader-v2/card-type-map-contracts";
import type {
  SpeedsterCardProfile,
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../ai-grader-v2/contracts";
import {
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "../ai-grader-v2/identity";
import {
  AI_GRADER_STORAGE_MAX_OBJECT_BYTES,
  openStorageObjectRead,
  presignReadUrl,
} from "./storage";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MAP_LABEL_LENGTH = 80;

export class SpeedsterMapIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeedsterMapIntegrityError";
  }
}

export type SpeedsterMapTrainingSideInput = Readonly<{
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: readonly Readonly<Pick<SpeedsterMapAnchor, "id" | "label" | "point">>[];
  zones: readonly SpeedsterMapZone[];
}>;

export type SpeedsterMapSourceSide = Readonly<{
  side: SpeedsterCardSide;
  originalStorageKey: string;
  rectifiedStorageKey: string;
  inspectionStorageKey: string;
  sourceCorners: SpeedsterQuad;
  centeringQuad: SpeedsterQuad;
  centeringBorders: Readonly<{
    leftMm: number;
    rightMm: number;
    topMm: number;
    bottomMm: number;
  }>;
  inspectionFrame: Readonly<{
    width: number;
    height: number;
    cardBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>;
  transform: readonly number[];
  viewStorageKeys: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
}>;

export type SpeedsterMapSourceSession = Readonly<{
  id: string;
  createdByUserId: string;
  cardProfile: SpeedsterCardProfile;
  workflowState: string;
  identity: SpeedsterSessionIdentity;
  cornerShape: "SQUARE" | "ROUNDED_3_18_MM";
  front: SpeedsterMapSourceSide;
  back: SpeedsterMapSourceSide;
}>;

export type SpeedsterMapRevisionHashPayload = Readonly<{
  mapId: string;
  version: number;
  matchKeyHash: string;
  matchKey: SpeedsterMapMatchKey;
  displayIdentity: SpeedsterSessionIdentity;
  normalizedIdentity: SpeedsterMapMatchKey;
  sourceSessionId: string;
  authorAdminId: string;
  frontMap: SpeedsterCardTypeMapSide;
  backMap: SpeedsterCardTypeMapSide;
  mapSchemaVersion: typeof SPEEDSTER_MAP_SCHEMA_VERSION;
  filterPolicyVersion: typeof SPEEDSTER_MAP_FILTER_POLICY_VERSION;
  supersedesRevisionId: string | null;
}>;

export type SpeedsterLoadedMapRevision = SpeedsterMapRevisionHashPayload & Readonly<{
  revisionId: string;
  revisionHash: string;
  createdAt: Date;
}>;

export type SpeedsterMapRevisionSummary = Readonly<{
  revisionId: string;
  version: number;
  revisionHash: string;
  createdAt: string;
  sourceSessionId: string;
  authorAdminId: string;
  current: boolean;
}>;

export type SpeedsterAppliedMapRevision = Readonly<{
  revision: SpeedsterLoadedMapRevision;
  appliedScope: SpeedsterMapScope;
  appliedMapName: string;
  sourceProvenance: Readonly<{
    sourceSessionId: string;
    sourceIdentity: SpeedsterSessionIdentity;
  }>;
}>;

type MapRevisionRecord = Readonly<{
  id: string;
  mapId: string;
  version: number;
  matchKeyHash: string;
  matchKey: unknown;
  displayIdentity: unknown;
  normalizedIdentity: unknown;
  sourceSessionId: string;
  authorAdminId: string;
  frontMap: unknown;
  backMap: unknown;
  mapSchemaVersion: string;
  filterPolicyVersion: string;
  revisionHash: string;
  supersedesRevisionId: string | null;
  createdAt: Date;
}>;

type ActiveMapRecord = Readonly<{
  id: string;
  matchKeyHash: string;
  currentRevisionId: string | null;
  currentRevision: MapRevisionRecord | null;
}>;

export type SpeedsterMapLookupDependencies = Readonly<{
  findActiveMap: (matchKeyHash: string) => Promise<ActiveMapRecord | null>;
  findActiveMaps?: (matchKeyHashes: readonly string[]) => Promise<readonly ActiveMapRecord[]>;
  findPinnedRevision: (mapRevisionId: string) => Promise<MapRevisionRecord | null>;
}>;

const mapRevisionSelect = {
  id: true,
  mapId: true,
  version: true,
  matchKeyHash: true,
  matchKey: true,
  displayIdentity: true,
  normalizedIdentity: true,
  sourceSessionId: true,
  authorAdminId: true,
  frontMap: true,
  backMap: true,
  mapSchemaVersion: true,
  filterPolicyVersion: true,
  revisionHash: true,
  supersedesRevisionId: true,
  createdAt: true,
} satisfies Prisma.AiGraderV2CardTypeMapRevisionSelect;

const defaultLookupDependencies: SpeedsterMapLookupDependencies = {
  findActiveMap: (matchKeyHash) => prisma.aiGraderV2CardTypeMap.findUnique({
    where: { matchKeyHash },
    select: {
      id: true,
      matchKeyHash: true,
      currentRevisionId: true,
      currentRevision: { select: mapRevisionSelect },
    },
  }),
  findActiveMaps: (matchKeyHashes) => prisma.aiGraderV2CardTypeMap.findMany({
    where: { matchKeyHash: { in: [...matchKeyHashes] } },
    select: {
      id: true,
      matchKeyHash: true,
      currentRevisionId: true,
      currentRevision: { select: mapRevisionSelect },
    },
  }),
  findPinnedRevision: (id) => prisma.aiGraderV2CardTypeMapRevision.findUnique({
    where: { id },
    select: mapRevisionSelect,
  }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SpeedsterMapIntegrityError(`${label} has unsupported fields.`);
  }
}

function point(value: unknown, label: string): SpeedsterPoint {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  exactObjectKeys(value, ["x", "y"], label);
  if (
    typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0 || value.x > 1 ||
    typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 1
  ) {
    throw new SpeedsterMapIntegrityError(`${label} must use finite unit-grid coordinates.`);
  }
  return { x: value.x, y: value.y };
}

function quad(value: unknown, label: string): SpeedsterQuad {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new SpeedsterMapIntegrityError(`${label} must contain exactly four points.`);
  }
  return [
    point(value[0], `${label}[0]`),
    point(value[1], `${label}[1]`),
    point(value[2], `${label}[2]`),
    point(value[3], `${label}[3]`),
  ];
}

function nonEmptyText(value: unknown, label: string, maximum = MAX_MAP_LABEL_LENGTH) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new SpeedsterMapIntegrityError(`${label} is invalid.`);
  }
  return value.trim();
}

function referenceEvidence(value: unknown, label: string): SpeedsterMapReferenceEvidence {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  exactObjectKeys(value, ["storageKey", "sha256"], label);
  const storageKey = nonEmptyText(value.storageKey, `${label}.storageKey`, 500);
  const sha256 = nonEmptyText(value.sha256, `${label}.sha256`, 64).toLowerCase();
  if (!SHA256.test(sha256)) throw new SpeedsterMapIntegrityError(`${label}.sha256 is invalid.`);
  return { storageKey, sha256 };
}

function designBoundary(value: unknown, label: string): SpeedsterMapDesignBoundary {
  if (!isRecord(value) || (value.kind !== "QUAD" && value.kind !== "FULL_BLEED")) {
    throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  }
  if (value.kind === "FULL_BLEED") {
    exactObjectKeys(value, ["kind"], label);
    return { kind: "FULL_BLEED" };
  }
  exactObjectKeys(value, ["kind", "points"], label);
  const points = quad(value.points, `${label}.points`);
  if (!isSpeedsterStrictConvexPolygon(points)) {
    throw new SpeedsterMapIntegrityError(`${label} must be a non-collapsed convex quadrilateral in perimeter order.`);
  }
  return { kind: "QUAD", points };
}

const ZONE_TYPES = new Set([
  "PRINT_TEXT",
  "PRINT_LOGO",
  "PRINT_ARTWORK",
  "PRINT_BORDER",
  "PRINT_FOIL",
  "OTHER_PRINT_CONTEXT",
]);

function mapZone(value: unknown, label: string): SpeedsterMapZone {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  exactObjectKeys(value, ["id", "label", "semanticType", "polygon"], label);
  const id = nonEmptyText(value.id, `${label}.id`);
  const zoneLabel = nonEmptyText(value.label, `${label}.label`);
  if (typeof value.semanticType !== "string" || !ZONE_TYPES.has(value.semanticType)) {
    throw new SpeedsterMapIntegrityError(`${label}.semanticType is invalid.`);
  }
  if (!Array.isArray(value.polygon) || value.polygon.length < 3 || value.polygon.length > 64) {
    throw new SpeedsterMapIntegrityError(`${label}.polygon must contain 3-64 points.`);
  }
  const polygon = value.polygon.map((candidate, index) => point(candidate, `${label}.polygon[${index}]`));
  if (!isSpeedsterSimplePolygon(polygon)) {
    throw new SpeedsterMapIntegrityError(`${label}.polygon must be a non-collapsed simple polygon in perimeter order.`);
  }
  return {
    id,
    label: zoneLabel,
    semanticType: value.semanticType as SpeedsterMapZone["semanticType"],
    polygon,
  };
}

function mapAnchor(value: unknown, label: string): SpeedsterMapAnchor {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  exactObjectKeys(value, ["id", "label", "point", "referencePatch"], label);
  return {
    id: nonEmptyText(value.id, `${label}.id`),
    label: nonEmptyText(value.label, `${label}.label`),
    point: point(value.point, `${label}.point`),
    referencePatch: referenceEvidence(value.referencePatch, `${label}.referencePatch`),
  };
}

export function parseSpeedsterMapSide(value: unknown, expectedSide: SpeedsterCardSide): SpeedsterCardTypeMapSide {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${expectedSide} map is malformed.`);
  exactObjectKeys(value, [
    "side",
    "referenceInspection",
    "sourcePhysicalQuadSha256",
    "designBoundary",
    "anchors",
    "zones",
  ], `${expectedSide} map`);
  if (value.side !== expectedSide) throw new SpeedsterMapIntegrityError(`${expectedSide} map side is wrong.`);
  const sourcePhysicalQuadSha256 = nonEmptyText(
    value.sourcePhysicalQuadSha256,
    `${expectedSide} map sourcePhysicalQuadSha256`,
    64,
  ).toLowerCase();
  if (!SHA256.test(sourcePhysicalQuadSha256)) {
    throw new SpeedsterMapIntegrityError(`${expectedSide} map physical-quad hash is invalid.`);
  }
  if (!Array.isArray(value.anchors) || value.anchors.length !== 4) {
    throw new SpeedsterMapIntegrityError(`${expectedSide} map requires exactly four human anchors.`);
  }
  if (!Array.isArray(value.zones) || value.zones.length < 1 || value.zones.length > 100) {
    throw new SpeedsterMapIntegrityError(`${expectedSide} map requires 1-100 human zones.`);
  }
  const anchors = value.anchors.map((candidate, index) => mapAnchor(candidate, `${expectedSide}.anchors[${index}]`));
  const zones = value.zones.map((candidate, index) => mapZone(candidate, `${expectedSide}.zones[${index}]`));
  if (new Set(anchors.map((anchor) => anchor.id)).size !== anchors.length) {
    throw new SpeedsterMapIntegrityError(`${expectedSide} map anchor IDs must be unique.`);
  }
  if (!isSpeedsterNondegenerateAnchorSet(anchors.map((anchor) => anchor.point))) {
    throw new SpeedsterMapIntegrityError(`${expectedSide} map anchors must be four distinct non-collinear design points.`);
  }
  if (new Set(zones.map((zone) => zone.id)).size !== zones.length) {
    throw new SpeedsterMapIntegrityError(`${expectedSide} map zone IDs must be unique.`);
  }
  return {
    side: expectedSide,
    referenceInspection: referenceEvidence(value.referenceInspection, `${expectedSide}.referenceInspection`),
    sourcePhysicalQuadSha256,
    designBoundary: designBoundary(value.designBoundary, `${expectedSide}.designBoundary`),
    anchors,
    zones,
  };
}

export function parseSpeedsterMapRegistration(
  value: unknown,
  expected: Readonly<{ side: SpeedsterCardSide; mapRevisionId: string }>,
): SpeedsterMapRegistration {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError("Current-copy map registration is malformed.");
  exactObjectKeys(value, [
    "version",
    "side",
    "mapRevisionId",
    "currentPhysicalQuadSha256",
    "currentInspectionSha256",
    "homography",
    "anchors",
    "projectedDesignBoundary",
    "projectedZones",
  ], "Current-copy map registration");
  if (
    value.version !== "opencv-human-anchor-registration-v1" ||
    value.side !== expected.side ||
    value.mapRevisionId !== expected.mapRevisionId
  ) {
    throw new SpeedsterMapIntegrityError("Current-copy map registration identity is wrong.");
  }
  const currentPhysicalQuadSha256 = nonEmptyText(value.currentPhysicalQuadSha256, "Registration physical-quad hash", 64);
  const currentInspectionSha256 = nonEmptyText(value.currentInspectionSha256, "Registration inspection hash", 64);
  if (!SHA256.test(currentPhysicalQuadSha256) || !SHA256.test(currentInspectionSha256)) {
    throw new SpeedsterMapIntegrityError("Current-copy map registration evidence hash is invalid.");
  }
  if (!Array.isArray(value.homography) || value.homography.length !== 9) {
    throw new SpeedsterMapIntegrityError("Current-copy map homography is invalid.");
  }
  const homography = value.homography.map((entry, index) => parseFiniteNumber(entry, `Registration homography[${index}]`));
  if (!Array.isArray(value.anchors) || value.anchors.length !== 4) {
    throw new SpeedsterMapIntegrityError("Current-copy map registration requires four located anchors.");
  }
  const anchors = value.anchors.map((entry, index) => {
    if (!isRecord(entry)) throw new SpeedsterMapIntegrityError(`Registration anchor[${index}] is malformed.`);
    exactObjectKeys(entry, ["anchorId", "expectedPoint", "locatedPoint", "score"], `Registration anchor[${index}]`);
    const score = parseFiniteNumber(entry.score, `Registration anchor[${index}].score`);
    if (score < 0 || score > 1) throw new SpeedsterMapIntegrityError(`Registration anchor[${index}].score is invalid.`);
    return {
      anchorId: nonEmptyText(entry.anchorId, `Registration anchor[${index}].anchorId`),
      expectedPoint: point(entry.expectedPoint, `Registration anchor[${index}].expectedPoint`),
      locatedPoint: point(entry.locatedPoint, `Registration anchor[${index}].locatedPoint`),
      score,
    };
  });
  if (!isSpeedsterNondegenerateAnchorSet(anchors.map((entry) => entry.locatedPoint))) {
    throw new SpeedsterMapIntegrityError("Current-copy map registration located anchors are degenerate.");
  }
  if (!Array.isArray(value.projectedZones) || value.projectedZones.length < 1 || value.projectedZones.length > 100) {
    throw new SpeedsterMapIntegrityError("Current-copy map registration zones are invalid.");
  }
  return {
    version: "opencv-human-anchor-registration-v1",
    side: expected.side,
    mapRevisionId: expected.mapRevisionId,
    currentPhysicalQuadSha256,
    currentInspectionSha256,
    homography: homography as unknown as SpeedsterMapRegistration["homography"],
    anchors,
    projectedDesignBoundary: designBoundary(value.projectedDesignBoundary, "Projected design boundary"),
    projectedZones: value.projectedZones.map((zone, index) => mapZone(zone, `Projected zone[${index}]`)),
  };
}

function parseMapKey(value: unknown, label: string): SpeedsterMapMatchKey {
  if (!isRecord(value) || (value.category !== "SPORTS" && value.category !== "POKEMON")) {
    throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  }
  if (value.scope === "FAMILY") {
    const familyIdentity = value.category === "SPORTS"
      ? {
          playerName: "family-source-provenance",
          year: value.year,
          manufacturer: value.manufacturer,
          productSet: value.productSet,
          insert: value.insert,
          parallel: value.parallel,
          cardNumber: null,
        }
      : {
          cardName: "family-source-provenance",
          year: value.year,
          productSet: value.productSet,
          parallel: value.parallel,
          cardNumber: null,
        };
    let parsed: SpeedsterMapMatchKey;
    try {
      parsed = speedsterFamilyCardTypeMapKey(value.category, familyIdentity as SpeedsterSessionIdentity);
    } catch {
      throw new SpeedsterMapIntegrityError(`${label} contains an invalid category-aware family identity.`);
    }
    if (canonicalJson(parsed) !== canonicalJson(value)) {
      throw new SpeedsterMapIntegrityError(`${label} is not normalized by the family-key contract.`);
    }
    return parsed;
  }
  const displayCandidate = value.category === "SPORTS"
    ? {
        playerName: value.playerName,
        year: value.year,
        manufacturer: value.manufacturer,
        productSet: value.productSet,
        insert: value.insert,
        parallel: value.parallel,
        cardNumber: value.cardNumber,
      }
    : {
        cardName: value.cardName,
        year: value.year,
        productSet: value.productSet,
        parallel: value.parallel,
        cardNumber: value.cardNumber,
      };
  let parsedIdentity: SpeedsterSessionIdentity;
  try {
    parsedIdentity = canonicalizeSpeedsterSessionIdentity(value.category, displayCandidate);
  } catch {
    throw new SpeedsterMapIntegrityError(`${label} contains an invalid category-aware identity.`);
  }
  const parsed = speedsterCardTypeMapKey(value.category, parsedIdentity);
  if (canonicalJson(parsed) !== canonicalJson(value)) {
    throw new SpeedsterMapIntegrityError(`${label} is not normalized by the frozen exact-key contract.`);
  }
  return parsed;
}

function parseDisplayIdentity(cardProfile: SpeedsterCardProfile, value: unknown): SpeedsterSessionIdentity {
  try {
    return canonicalizeSpeedsterSessionIdentity(cardProfile, value);
  } catch {
    throw new SpeedsterMapIntegrityError("Map display identity is invalid.");
  }
}

function normalizedJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SpeedsterMapIntegrityError("Map hash payload contains a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizedJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizedJsonValue(value[key])]));
  }
  throw new SpeedsterMapIntegrityError("Map hash payload contains a non-JSON value.");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizedJsonValue(value));
}

export function canonicalSpeedsterMapRevisionPayload(payload: SpeedsterMapRevisionHashPayload): string {
  return canonicalJson({
    mapId: payload.mapId,
    version: payload.version,
    matchKeyHash: payload.matchKeyHash,
    matchKey: payload.matchKey,
    displayIdentity: payload.displayIdentity,
    normalizedIdentity: payload.normalizedIdentity,
    sourceSessionId: payload.sourceSessionId,
    authorAdminId: payload.authorAdminId,
    frontMap: payload.frontMap,
    backMap: payload.backMap,
    mapSchemaVersion: payload.mapSchemaVersion,
    filterPolicyVersion: payload.filterPolicyVersion,
    supersedesRevisionId: payload.supersedesRevisionId,
  });
}

export function speedsterMapRevisionHash(payload: SpeedsterMapRevisionHashPayload): string {
  return createHash("sha256").update(canonicalSpeedsterMapRevisionPayload(payload)).digest("hex");
}

export function speedsterMapMatchKeyHash(key: SpeedsterMapMatchKey): string {
  return createHash("sha256").update(canonicalSpeedsterMapKeyJson(key)).digest("hex");
}

export function speedsterPhysicalQuadHash(value: SpeedsterQuad) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function loadedPayload(record: MapRevisionRecord): SpeedsterLoadedMapRevision {
  if (!Number.isSafeInteger(record.version) || record.version < 1) {
    throw new SpeedsterMapIntegrityError("Map revision version is invalid.");
  }
  if (!SHA256.test(record.matchKeyHash) || !SHA256.test(record.revisionHash)) {
    throw new SpeedsterMapIntegrityError("Map revision hash identity is invalid.");
  }
  const rawKey = parseMapKey(record.matchKey, "Map match key");
  const cardProfile = rawKey.category;
  const normalizedIdentity = parseMapKey(record.normalizedIdentity, "Map normalized identity");
  const displayIdentity = parseDisplayIdentity(cardProfile, record.displayIdentity);
  const payload: SpeedsterMapRevisionHashPayload = {
    mapId: record.mapId,
    version: record.version,
    matchKeyHash: record.matchKeyHash,
    matchKey: rawKey,
    displayIdentity,
    normalizedIdentity,
    sourceSessionId: record.sourceSessionId,
    authorAdminId: record.authorAdminId,
    frontMap: parseSpeedsterMapSide(record.frontMap, "FRONT"),
    backMap: parseSpeedsterMapSide(record.backMap, "BACK"),
    mapSchemaVersion: record.mapSchemaVersion as typeof SPEEDSTER_MAP_SCHEMA_VERSION,
    filterPolicyVersion: record.filterPolicyVersion as typeof SPEEDSTER_MAP_FILTER_POLICY_VERSION,
    supersedesRevisionId: record.supersedesRevisionId,
  };
  if (payload.mapSchemaVersion !== SPEEDSTER_MAP_SCHEMA_VERSION) {
    throw new SpeedsterMapIntegrityError("Map revision schema version is unsupported.");
  }
  if (payload.filterPolicyVersion !== SPEEDSTER_MAP_FILTER_POLICY_VERSION) {
    throw new SpeedsterMapIntegrityError("Map revision filter-policy version is unsupported.");
  }
  if (speedsterMapMatchKeyHash(rawKey) !== record.matchKeyHash) {
    throw new SpeedsterMapIntegrityError("Map revision key hash does not match its key.");
  }
  if (canonicalSpeedsterMapKeyJson(rawKey) !== canonicalSpeedsterMapKeyJson(normalizedIdentity)) {
    throw new SpeedsterMapIntegrityError("Map normalized identity does not match its key.");
  }
  if (speedsterMapRevisionHash(payload) !== record.revisionHash) {
    throw new SpeedsterMapIntegrityError("Map revision hash verification failed.");
  }
  return {
    revisionId: record.id,
    ...payload,
    revisionHash: record.revisionHash,
    createdAt: record.createdAt,
  };
}

export function validateSpeedsterLoadedMapRevision(
  record: MapRevisionRecord,
  expected: Readonly<{ matchKeyHash?: string; mapRevisionId?: string }> = {},
): SpeedsterLoadedMapRevision {
  if (expected.mapRevisionId && record.id !== expected.mapRevisionId) {
    throw new SpeedsterMapIntegrityError("Loaded map revision does not match the pinned revision.");
  }
  if (expected.matchKeyHash && record.matchKeyHash !== expected.matchKeyHash) {
    throw new SpeedsterMapIntegrityError("Loaded map revision does not match the card-type key.");
  }
  return loadedPayload(record);
}

function speedsterMapKeyForScope(
  scope: SpeedsterMapScope,
  cardProfile: SpeedsterCardProfile,
  identity: SpeedsterSessionIdentity,
) {
  return scope === "FAMILY"
    ? speedsterFamilyCardTypeMapKey(cardProfile, identity)
    : speedsterCardTypeMapKey(cardProfile, identity);
}

export function speedsterMapDisplayName(
  scope: SpeedsterMapScope,
  cardProfile: SpeedsterCardProfile,
  identity: SpeedsterSessionIdentity,
) {
  const canonical = canonicalizeSpeedsterSessionIdentity(cardProfile, identity);
  if (cardProfile === "SPORTS" && "playerName" in canonical) {
    const family = [canonical.year, canonical.manufacturer, canonical.productSet, canonical.insert, canonical.parallel]
      .filter((value): value is string => Boolean(value));
    return scope === "FAMILY"
      ? family.join(" · ")
      : [...family, canonical.playerName, canonical.cardNumber ? `#${canonical.cardNumber}` : null]
          .filter((value): value is string => Boolean(value))
          .join(" · ");
  }
  if (cardProfile === "POKEMON" && "cardName" in canonical) {
    const family = [canonical.year, canonical.productSet, canonical.parallel]
      .filter((value): value is string => Boolean(value));
    return scope === "FAMILY"
      ? family.join(" · ")
      : [...family, canonical.cardName, canonical.cardNumber ? `#${canonical.cardNumber}` : null]
          .filter((value): value is string => Boolean(value))
          .join(" · ");
  }
  throw new SpeedsterMapIntegrityError("Map display identity is category-incompatible.");
}

function validateActiveMap(
  map: ActiveMapRecord,
  matchKeyHash: string,
  label: "Exact" | "Family",
) {
  if (map.matchKeyHash !== matchKeyHash || !map.currentRevisionId || !map.currentRevision) {
    throw new SpeedsterMapIntegrityError(`${label} card-type map has no coherent active revision.`);
  }
  if (map.currentRevisionId !== map.currentRevision.id || map.id !== map.currentRevision.mapId) {
    throw new SpeedsterMapIntegrityError(`${label} card-type map active-revision relationship is invalid.`);
  }
  return validateSpeedsterLoadedMapRevision(map.currentRevision, { matchKeyHash });
}

export async function loadScopedActiveSpeedsterMapRevision(
  input: Readonly<{
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
    scope: SpeedsterMapScope;
  }>,
  deps: SpeedsterMapLookupDependencies = defaultLookupDependencies,
): Promise<SpeedsterLoadedMapRevision | null> {
  const matchKeyHash = speedsterMapMatchKeyHash(
    speedsterMapKeyForScope(input.scope, input.cardProfile, input.identity),
  );
  const map = await deps.findActiveMap(matchKeyHash);
  return map ? validateActiveMap(map, matchKeyHash, input.scope === "EXACT" ? "Exact" : "Family") : null;
}

export async function loadExactActiveSpeedsterMapRevision(
  input: Readonly<{ cardProfile: SpeedsterCardProfile; identity: SpeedsterSessionIdentity }>,
  deps: SpeedsterMapLookupDependencies = defaultLookupDependencies,
): Promise<SpeedsterLoadedMapRevision | null> {
  return loadScopedActiveSpeedsterMapRevision({ ...input, scope: "EXACT" }, deps);
}

export async function loadEffectiveActiveSpeedsterMapRevision(
  input: Readonly<{ cardProfile: SpeedsterCardProfile; identity: SpeedsterSessionIdentity }>,
  deps: SpeedsterMapLookupDependencies = defaultLookupDependencies,
): Promise<SpeedsterAppliedMapRevision | null> {
  const exactHash = speedsterMapMatchKeyHash(speedsterCardTypeMapKey(input.cardProfile, input.identity));
  const familyHash = speedsterMapMatchKeyHash(speedsterFamilyCardTypeMapKey(input.cardProfile, input.identity));
  const maps = deps.findActiveMaps
    ? await deps.findActiveMaps([exactHash, familyHash])
    : (await Promise.all([deps.findActiveMap(exactHash), deps.findActiveMap(familyHash)]))
        .filter((map): map is ActiveMapRecord => Boolean(map));
  const exact = maps.find((map) => map.matchKeyHash === exactHash);
  const family = maps.find((map) => map.matchKeyHash === familyHash);
  const scope: SpeedsterMapScope | null = exact ? "EXACT" : family ? "FAMILY" : null;
  const selected = exact ?? family;
  if (!scope || !selected) return null;
  const revision = validateActiveMap(selected, scope === "EXACT" ? exactHash : familyHash, scope === "EXACT" ? "Exact" : "Family");
  return {
    revision,
    appliedScope: scope,
    appliedMapName: speedsterMapDisplayName(scope, input.cardProfile, revision.displayIdentity),
    sourceProvenance: {
      sourceSessionId: revision.sourceSessionId,
      sourceIdentity: revision.displayIdentity,
    },
  };
}

export function assertSpeedsterMapRevisionAppliesToIdentity(
  revision: SpeedsterLoadedMapRevision,
  input: Readonly<{ cardProfile: SpeedsterCardProfile; identity: SpeedsterSessionIdentity }>,
) {
  const scope = speedsterMapScopeForKey(revision.matchKey);
  if (revision.matchKey.category !== input.cardProfile) {
    throw new SpeedsterMapIntegrityError("Pinned map category does not match the session identity.");
  }
  const expected = speedsterMapKeyForScope(scope, input.cardProfile, input.identity);
  if (canonicalSpeedsterMapKeyJson(expected) !== canonicalSpeedsterMapKeyJson(revision.matchKey)) {
    throw new SpeedsterMapIntegrityError("Pinned map does not apply to the session card type.");
  }
}

export async function loadPinnedSpeedsterMapRevision(
  input: Readonly<{ sessionId: string; mapRevisionId: string }>,
  deps: SpeedsterMapLookupDependencies = defaultLookupDependencies,
): Promise<SpeedsterLoadedMapRevision> {
  const revision = await deps.findPinnedRevision(input.mapRevisionId);
  if (!revision) throw new SpeedsterMapIntegrityError("Pinned map revision was not found.");
  const loaded = validateSpeedsterLoadedMapRevision(revision, { mapRevisionId: input.mapRevisionId });
  // The session ID is intentionally an explicit caller binding. The revision's
  // source session may differ because one map applies to later exact-key copies.
  if (!input.sessionId.trim()) throw new SpeedsterMapIntegrityError("Pinned map session identity is invalid.");
  return loaded;
}

function parseFiniteNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SpeedsterMapIntegrityError(`${label} must be finite.`);
  }
  return value;
}

function parseSourceSide(
  value: unknown,
  side: SpeedsterCardSide,
  userId: string,
  sessionId: string,
): SpeedsterMapSourceSide {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${side} capture evidence is missing.`);
  const expectedPreparedPrefix = `ai-grader-v2/${userId}/${sessionId}/prepared/${side.toLowerCase()}`;
  const originalStorageKey = nonEmptyText(value.originalStorageKey, `${side} original key`, 500);
  const rectifiedStorageKey = nonEmptyText(value.rectifiedStorageKey, `${side} rectified key`, 500);
  const inspectionStorageKey = nonEmptyText(value.inspectionStorageKey, `${side} inspection key`, 500);
  if (
    !originalStorageKey.startsWith(`ai-grader-v2/${userId}/${sessionId}/original/${side.toLowerCase()}.`) ||
    rectifiedStorageKey !== `${expectedPreparedPrefix}/rectified.webp` ||
    inspectionStorageKey !== `${expectedPreparedPrefix}/inspection.webp`
  ) {
    throw new SpeedsterMapIntegrityError(`${side} source images are not bound to this Speedster session.`);
  }
  const viewStorageKeys = isRecord(value.viewStorageKeys) ? value.viewStorageKeys : null;
  const expectedViews = {
    NORMALIZED: `${expectedPreparedPrefix}/normalized.webp`,
    MICRO_DEFECT: `${expectedPreparedPrefix}/micro_defect.webp`,
    DIRECTIONAL: `${expectedPreparedPrefix}/directional.webp`,
  } as const;
  if (!viewStorageKeys || Object.entries(expectedViews).some(([view, key]) => viewStorageKeys[view] !== key)) {
    throw new SpeedsterMapIntegrityError(`${side} prepared views are not bound to this Speedster session.`);
  }
  const frame = isRecord(value.inspectionFrame) ? value.inspectionFrame : null;
  const bounds = frame && isRecord(frame.cardBounds) ? frame.cardBounds : null;
  if (
    !frame || !bounds || frame.width !== 1350 || frame.height !== 1858 ||
    bounds.x !== 40 || bounds.y !== 40 || bounds.width !== 1270 || bounds.height !== 1778
  ) {
    throw new SpeedsterMapIntegrityError(`${side} inspection frame is not the frozen 2 mm frame.`);
  }
  const borders = isRecord(value.centeringBorders) ? value.centeringBorders : null;
  if (!borders) throw new SpeedsterMapIntegrityError(`${side} centering evidence is missing.`);
  const transform = Array.isArray(value.transform)
    ? value.transform.map((entry, index) => parseFiniteNumber(entry, `${side} transform[${index}]`))
    : [];
  if (transform.length !== 9) throw new SpeedsterMapIntegrityError(`${side} physical transform is invalid.`);
  return {
    side,
    originalStorageKey,
    rectifiedStorageKey,
    inspectionStorageKey,
    sourceCorners: quad(value.sourceCorners, `${side} source corners`),
    centeringQuad: quad(value.centeringQuad, `${side} centering quad`),
    centeringBorders: {
      leftMm: parseFiniteNumber(borders.leftMm, `${side} left centering border`),
      rightMm: parseFiniteNumber(borders.rightMm, `${side} right centering border`),
      topMm: parseFiniteNumber(borders.topMm, `${side} top centering border`),
      bottomMm: parseFiniteNumber(borders.bottomMm, `${side} bottom centering border`),
    },
    inspectionFrame: {
      width: 1350,
      height: 1858,
      cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
    },
    transform,
    viewStorageKeys: expectedViews,
  };
}

export function parseSpeedsterMapSourceSession(record: Readonly<{
  id: string;
  createdByUserId: string;
  cardProfile: string;
  workflowState: string;
  identity: unknown;
  capture: unknown;
}>): SpeedsterMapSourceSession {
  if (record.cardProfile !== "SPORTS" && record.cardProfile !== "POKEMON") {
    throw new SpeedsterMapIntegrityError("TRAIN source category is unsupported.");
  }
  let identity: SpeedsterSessionIdentity;
  try {
    identity = canonicalizeSpeedsterSessionIdentity(record.cardProfile, record.identity);
  } catch {
    throw new SpeedsterMapIntegrityError("TRAIN source identity is malformed.");
  }
  const capture = isRecord(record.capture) ? record.capture : null;
  if (!capture || (capture.cornerShape !== "SQUARE" && capture.cornerShape !== "ROUNDED_3_18_MM")) {
    throw new SpeedsterMapIntegrityError("TRAIN source physical-card geometry is missing.");
  }
  return {
    id: record.id,
    createdByUserId: record.createdByUserId,
    cardProfile: record.cardProfile,
    workflowState: record.workflowState,
    identity,
    cornerShape: capture.cornerShape,
    front: parseSourceSide(capture.front, "FRONT", record.createdByUserId, record.id),
    back: parseSourceSide(capture.back, "BACK", record.createdByUserId, record.id),
  };
}

export async function hashSpeedsterMapStorageEvidence(
  storageKey: string,
  openRead: typeof openStorageObjectRead = openStorageObjectRead,
) {
  const read = await openRead(storageKey);
  if (read.storageKey !== storageKey || !read.body || typeof read.body[Symbol.asyncIterator] !== "function") {
    read.body?.destroy?.();
    throw new SpeedsterMapIntegrityError("TRAIN reference evidence could not be read coherently.");
  }
  if (!Number.isSafeInteger(read.byteSize) || (read.byteSize ?? 0) < 1 || (read.byteSize ?? 0) > AI_GRADER_STORAGE_MAX_OBJECT_BYTES) {
    read.body.destroy?.();
    throw new SpeedsterMapIntegrityError("TRAIN reference evidence has an invalid bounded byte size.");
  }
  const digest = createHash("sha256");
  let received = 0;
  for await (const rawChunk of read.body) {
    if (!(rawChunk instanceof Uint8Array)) {
      read.body.destroy?.();
      throw new SpeedsterMapIntegrityError("TRAIN reference evidence returned an invalid stream chunk.");
    }
    received += rawChunk.byteLength;
    if (received > AI_GRADER_STORAGE_MAX_OBJECT_BYTES || received > (read.byteSize as number)) {
      read.body.destroy?.();
      throw new SpeedsterMapIntegrityError("TRAIN reference evidence exceeded its bounded byte size.");
    }
    digest.update(Buffer.from(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength));
  }
  if (received !== read.byteSize) {
    throw new SpeedsterMapIntegrityError("TRAIN reference evidence byte size changed while hashing.");
  }
  return digest.digest("hex");
}

function trainingInputSide(
  value: SpeedsterMapTrainingSideInput,
  source: SpeedsterMapSourceSide,
  reference: SpeedsterMapReferenceEvidence,
): SpeedsterCardTypeMapSide {
  const raw: SpeedsterCardTypeMapSide = {
    side: source.side,
    referenceInspection: reference,
    sourcePhysicalQuadSha256: speedsterPhysicalQuadHash(source.sourceCorners),
    designBoundary: value.designBoundary,
    anchors: value.anchors.map((anchor) => ({ ...anchor, referencePatch: reference })),
    zones: value.zones,
  };
  return parseSpeedsterMapSide(raw, source.side);
}

export function speedsterIdentityMapRegistration(
  sideMap: SpeedsterCardTypeMapSide,
  source: SpeedsterMapSourceSide,
  mapRevisionId: string,
): SpeedsterMapRegistration {
  const identityHomography = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
  return parseSpeedsterMapRegistration({
    version: "opencv-human-anchor-registration-v1",
    side: source.side,
    mapRevisionId,
    currentPhysicalQuadSha256: speedsterPhysicalQuadHash(source.sourceCorners),
    currentInspectionSha256: sideMap.referenceInspection.sha256,
    homography: identityHomography,
    anchors: sideMap.anchors.map((anchor) => ({
      anchorId: anchor.id,
      expectedPoint: anchor.point,
      locatedPoint: anchor.point,
      score: 1,
    })),
    projectedDesignBoundary: sideMap.designBoundary,
    projectedZones: sideMap.zones,
  }, { side: source.side, mapRevisionId });
}

export type SpeedsterMapSaveResult = Readonly<{
  mapId: string;
  revision: SpeedsterLoadedMapRevision;
}>;

type SpeedsterMapWriteTransaction = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "$queryRaw" | "aiGraderV2CardTypeMap" | "aiGraderV2CardTypeMapRevision" | "aiGraderV2Session"
>;

export type SpeedsterMapTransactionRunner = <Result>(
  operation: (tx: SpeedsterMapWriteTransaction) => Promise<Result>,
) => Promise<Result>;

async function assertCapturedTrainSourceIsUninitialized(
  tx: SpeedsterMapWriteTransaction,
  source: SpeedsterMapSourceSession,
) {
  if (source.workflowState !== "CAPTURED") return null;
  await tx.$queryRaw`
    SELECT "id"
    FROM "AiGraderV2Session"
    WHERE "id" = ${source.id} AND "createdByUserId" = ${source.createdByUserId}
    FOR UPDATE
  `;
  const current = await tx.aiGraderV2Session.findFirst({
    where: { id: source.id, createdByUserId: source.createdByUserId },
    select: {
      workflowState: true,
      reviewedDefects: true,
      gradeReport: true,
      mapRevisionId: true,
      mapFilterDecisions: { take: 1, select: { id: true } },
    },
  });
  if (
    !current
    || current.workflowState !== "CAPTURED"
    || !Array.isArray(current.reviewedDefects)
    || current.reviewedDefects.length !== 0
    || !isRecord(current.gradeReport)
    || Object.keys(current.gradeReport).length !== 0
    || current.mapFilterDecisions.length !== 0
  ) {
    throw new SpeedsterMapIntegrityError(
      "Captured-card TRAIN can change its pinned map only before detector review is initialized.",
    );
  }
  return current;
}

async function capturedExactOverrideRevisionId(
  tx: SpeedsterMapWriteTransaction,
  source: SpeedsterMapSourceSession,
  scope: SpeedsterMapScope,
) {
  if (scope !== "FAMILY" || source.workflowState !== "CAPTURED") return null;
  const exactHash = speedsterMapMatchKeyHash(speedsterCardTypeMapKey(source.cardProfile, source.identity));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`speedster-map:${exactHash}`}, 0))`;
  const exact = await tx.aiGraderV2CardTypeMap.findUnique({
    where: { matchKeyHash: exactHash },
    select: { currentRevisionId: true },
  });
  return exact?.currentRevisionId ?? null;
}

async function clearCapturedFamilyBindingIfStale(
  tx: SpeedsterMapWriteTransaction,
  source: SpeedsterMapSourceSession,
  currentMapRevisionId: string | null | undefined,
  exactOverrideRevisionId: string | null,
) {
  if (
    source.workflowState !== "CAPTURED"
    || !exactOverrideRevisionId
    || !currentMapRevisionId
    || currentMapRevisionId === exactOverrideRevisionId
  ) return;
  const cleared = await tx.aiGraderV2Session.updateMany({
    where: {
      id: source.id,
      createdByUserId: source.createdByUserId,
      workflowState: "CAPTURED",
    },
    data: {
      mapRevisionId: null,
      mapFilterPolicyVersion: null,
      mapRegistration: PrismaRuntime.DbNull,
    },
  });
  if (cleared.count !== 1) {
    throw new SpeedsterMapIntegrityError("Captured source could not return safely to manual map review.");
  }
}

export type SpeedsterCapturedRestoreRegistration = (
  source: SpeedsterMapSourceSession,
  revision: Readonly<{
    revisionId: string;
    mapId: string;
    frontMap: SpeedsterCardTypeMapSide;
    backMap: SpeedsterCardTypeMapSide;
  }>,
) => Promise<Readonly<{ front: SpeedsterMapRegistration; back: SpeedsterMapRegistration }>>;

async function registerRestoredMapSide(
  source: SpeedsterMapSourceSide,
  mapId: string,
  revisionId: string,
  sideMap: SpeedsterCardTypeMapSide,
) {
  const [referenceSha256, currentInspectionSha256] = await Promise.all([
    hashSpeedsterMapStorageEvidence(sideMap.referenceInspection.storageKey),
    hashSpeedsterMapStorageEvidence(source.inspectionStorageKey),
  ]);
  if (referenceSha256 !== sideMap.referenceInspection.sha256) {
    throw new SpeedsterMapIntegrityError("Restored TRAIN map reference evidence failed hash verification.");
  }
  const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
  if (!serviceUrl) throw new SpeedsterMapIntegrityError("AI_GRADER_SPEEDSTER_SERVICE_URL is not configured.");
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  const [referenceUrl, currentUrl] = await Promise.all([
    presignReadUrl(sideMap.referenceInspection.storageKey, 60 * 10),
    presignReadUrl(source.inspectionStorageKey, 60 * 10),
  ]);
  const response = await fetch(`${serviceUrl}/map-registration`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      referenceImage: { imageUrl: referenceUrl },
      currentImage: { imageUrl: currentUrl },
      mapId,
      mapRevisionId: revisionId,
      side: source.side,
      currentPhysicalQuadSha256: speedsterPhysicalQuadHash(source.sourceCorners),
      currentInspectionSha256,
      anchors: sideMap.anchors.map(({ id, point }) => ({ id, point })),
      designBoundary: sideMap.designBoundary,
      zones: sideMap.zones,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SpeedsterMapIntegrityError(`Restored ${source.side} TRAIN map could not register to the current copy.`);
  }
  return parseSpeedsterMapRegistration(payload, { side: source.side, mapRevisionId: revisionId });
}

const registerCapturedRestore: SpeedsterCapturedRestoreRegistration = async (source, revision) => {
  const [front, back] = await Promise.all([
    registerRestoredMapSide(source.front, revision.mapId, revision.revisionId, revision.frontMap),
    registerRestoredMapSide(source.back, revision.mapId, revision.revisionId, revision.backMap),
  ]);
  return { front, back };
};

export async function saveSpeedsterCardTypeMapRevision(input: Readonly<{
  source: SpeedsterMapSourceSession;
  authorAdminId: string;
  scope?: SpeedsterMapScope;
  front: SpeedsterMapTrainingSideInput;
  back: SpeedsterMapTrainingSideInput;
  hashEvidence?: typeof hashSpeedsterMapStorageEvidence;
  transaction?: SpeedsterMapTransactionRunner;
}>): Promise<SpeedsterMapSaveResult> {
  const scope = input.scope ?? "EXACT";
  const key = speedsterMapKeyForScope(scope, input.source.cardProfile, input.source.identity);
  const matchKeyHash = speedsterMapMatchKeyHash(key);
  const hashEvidence = input.hashEvidence ?? hashSpeedsterMapStorageEvidence;
  const [frontEvidenceHash, backEvidenceHash] = await Promise.all([
    hashEvidence(input.source.front.inspectionStorageKey),
    hashEvidence(input.source.back.inspectionStorageKey),
  ]);
  const frontMap = trainingInputSide(input.front, input.source.front, {
    storageKey: input.source.front.inspectionStorageKey,
    sha256: frontEvidenceHash,
  });
  const backMap = trainingInputSide(input.back, input.source.back, {
    storageKey: input.source.back.inspectionStorageKey,
    sha256: backEvidenceHash,
  });
  const transaction: SpeedsterMapTransactionRunner = input.transaction ?? ((operation) => (
    prisma.$transaction((tx) => operation(tx), { isolationLevel: "Serializable" })
  ));
  const created = await transaction(async (tx) => {
    const capturedState = await assertCapturedTrainSourceIsUninitialized(tx, input.source);
    const exactOverrideRevisionId = await capturedExactOverrideRevisionId(tx, input.source, scope);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`speedster-map:${matchKeyHash}`}, 0))`;
    let map = await tx.aiGraderV2CardTypeMap.findUnique({
      where: { matchKeyHash },
      include: { currentRevision: { select: { id: true, version: true } } },
    });
    if (!map) {
      map = await tx.aiGraderV2CardTypeMap.create({
        data: { matchKeyHash, cardProfile: input.source.cardProfile },
        include: { currentRevision: { select: { id: true, version: true } } },
      });
    }
    if (map.cardProfile !== input.source.cardProfile) {
      throw new SpeedsterMapIntegrityError("Map category does not match its stored category.");
    }
    const version = (map.currentRevision?.version ?? 0) + 1;
    const payload: SpeedsterMapRevisionHashPayload = {
      mapId: map.id,
      version,
      matchKeyHash,
      matchKey: key,
      displayIdentity: input.source.identity,
      normalizedIdentity: key,
      sourceSessionId: input.source.id,
      authorAdminId: input.authorAdminId,
      frontMap,
      backMap,
      mapSchemaVersion: SPEEDSTER_MAP_SCHEMA_VERSION,
      filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
      supersedesRevisionId: map.currentRevision?.id ?? null,
    };
    const revision = await tx.aiGraderV2CardTypeMapRevision.create({
      data: {
        mapId: payload.mapId,
        version: payload.version,
        matchKeyHash: payload.matchKeyHash,
        matchKey: payload.matchKey as Prisma.InputJsonValue,
        displayIdentity: payload.displayIdentity as Prisma.InputJsonValue,
        normalizedIdentity: payload.normalizedIdentity as Prisma.InputJsonValue,
        sourceSessionId: payload.sourceSessionId,
        authorAdminId: payload.authorAdminId,
        frontMap: payload.frontMap as unknown as Prisma.InputJsonValue,
        backMap: payload.backMap as unknown as Prisma.InputJsonValue,
        mapSchemaVersion: payload.mapSchemaVersion,
        filterPolicyVersion: payload.filterPolicyVersion,
        revisionHash: speedsterMapRevisionHash(payload),
        supersedesRevisionId: payload.supersedesRevisionId,
      },
      select: mapRevisionSelect,
    });
    await tx.aiGraderV2CardTypeMap.update({
      where: { id: map.id },
      data: { currentRevisionId: revision.id },
    });
    await clearCapturedFamilyBindingIfStale(
      tx,
      input.source,
      capturedState?.mapRevisionId,
      exactOverrideRevisionId,
    );
    if (input.source.workflowState === "CAPTURED" && !exactOverrideRevisionId) {
      const frontRegistration = speedsterIdentityMapRegistration(frontMap, input.source.front, revision.id);
      const backRegistration = speedsterIdentityMapRegistration(backMap, input.source.back, revision.id);
      const bound = await tx.aiGraderV2Session.updateMany({
        where: {
          id: input.source.id,
          createdByUserId: input.source.createdByUserId,
          workflowState: "CAPTURED",
        },
        data: {
          mapRevisionId: revision.id,
          mapFilterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
          mapRegistration: {
            front: frontRegistration,
            back: backRegistration,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      if (bound.count !== 1) {
        throw new SpeedsterMapIntegrityError("New-card TRAIN revision could not bind atomically to its captured source.");
      }
    }
    return revision;
  });
  return { mapId: created.mapId, revision: validateSpeedsterLoadedMapRevision(created) };
}

export async function restoreSpeedsterCardTypeMapRevision(input: Readonly<{
  source: SpeedsterMapSourceSession;
  targetRevisionId: string;
  authorAdminId: string;
  scope?: SpeedsterMapScope;
  transaction?: SpeedsterMapTransactionRunner;
  registerCapturedRestore?: SpeedsterCapturedRestoreRegistration;
  findActiveMap?: SpeedsterMapLookupDependencies["findActiveMap"];
  findTargetRevision?: SpeedsterMapLookupDependencies["findPinnedRevision"];
}>): Promise<SpeedsterMapSaveResult> {
  const scope = input.scope ?? "EXACT";
  const key = speedsterMapKeyForScope(scope, input.source.cardProfile, input.source.identity);
  const matchKeyHash = speedsterMapMatchKeyHash(key);
  const revisionId = randomUUID();
  const target = await (input.findTargetRevision ?? defaultLookupDependencies.findPinnedRevision)(input.targetRevisionId);
  if (!target || target.matchKeyHash !== matchKeyHash) {
    throw new SpeedsterMapIntegrityError("Restore target is not a revision of this scoped card-type map.");
  }
  const validated = validateSpeedsterLoadedMapRevision(target, { matchKeyHash });
  const exactOverrideWasActive = scope === "FAMILY" && input.source.workflowState === "CAPTURED"
    ? Boolean((await (input.findActiveMap ?? defaultLookupDependencies.findActiveMap)(
        speedsterMapMatchKeyHash(speedsterCardTypeMapKey(input.source.cardProfile, input.source.identity)),
      ))?.currentRevisionId)
    : false;
  const registration = input.source.workflowState === "CAPTURED" && !exactOverrideWasActive
    ? await (input.registerCapturedRestore ?? registerCapturedRestore)(input.source, {
        revisionId,
        mapId: validated.mapId,
        frontMap: validated.frontMap,
        backMap: validated.backMap,
      })
    : null;
  const transaction: SpeedsterMapTransactionRunner = input.transaction ?? ((operation) => (
    prisma.$transaction((tx) => operation(tx), { isolationLevel: "Serializable" })
  ));
  const created = await transaction(async (tx) => {
    const capturedState = await assertCapturedTrainSourceIsUninitialized(tx, input.source);
    const exactOverrideRevisionId = await capturedExactOverrideRevisionId(tx, input.source, scope);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`speedster-map:${matchKeyHash}`}, 0))`;
    const map = await tx.aiGraderV2CardTypeMap.findUnique({
      where: { matchKeyHash },
      include: { currentRevision: { select: { id: true, version: true } } },
    });
    if (!map?.currentRevision) throw new SpeedsterMapIntegrityError("Scoped card-type map has no revision to restore.");
    if (validated.mapId !== map.id) {
      throw new SpeedsterMapIntegrityError("Restore target is not a revision of this scoped card-type map.");
    }
    const payload: SpeedsterMapRevisionHashPayload = {
      mapId: map.id,
      version: map.currentRevision.version + 1,
      matchKeyHash,
      matchKey: validated.matchKey,
      displayIdentity: validated.displayIdentity,
      normalizedIdentity: validated.normalizedIdentity,
      sourceSessionId: validated.sourceSessionId,
      authorAdminId: input.authorAdminId,
      frontMap: validated.frontMap,
      backMap: validated.backMap,
      mapSchemaVersion: validated.mapSchemaVersion,
      filterPolicyVersion: validated.filterPolicyVersion,
      supersedesRevisionId: map.currentRevision.id,
    };
    const revision = await tx.aiGraderV2CardTypeMapRevision.create({
      data: {
        id: revisionId,
        mapId: payload.mapId,
        version: payload.version,
        matchKeyHash: payload.matchKeyHash,
        matchKey: payload.matchKey as Prisma.InputJsonValue,
        displayIdentity: payload.displayIdentity as Prisma.InputJsonValue,
        normalizedIdentity: payload.normalizedIdentity as Prisma.InputJsonValue,
        sourceSessionId: payload.sourceSessionId,
        authorAdminId: payload.authorAdminId,
        frontMap: payload.frontMap as unknown as Prisma.InputJsonValue,
        backMap: payload.backMap as unknown as Prisma.InputJsonValue,
        mapSchemaVersion: payload.mapSchemaVersion,
        filterPolicyVersion: payload.filterPolicyVersion,
        revisionHash: speedsterMapRevisionHash(payload),
        supersedesRevisionId: payload.supersedesRevisionId,
      },
      select: mapRevisionSelect,
    });
    await tx.aiGraderV2CardTypeMap.update({ where: { id: map.id }, data: { currentRevisionId: revision.id } });
    await clearCapturedFamilyBindingIfStale(
      tx,
      input.source,
      capturedState?.mapRevisionId,
      exactOverrideRevisionId,
    );
    if (registration && !exactOverrideRevisionId) {
      const bound = await tx.aiGraderV2Session.updateMany({
        where: {
          id: input.source.id,
          createdByUserId: input.source.createdByUserId,
          workflowState: "CAPTURED",
        },
        data: {
          mapRevisionId: revision.id,
          mapFilterPolicyVersion: validated.filterPolicyVersion,
          mapRegistration: registration as unknown as Prisma.InputJsonValue,
        },
      });
      if (bound.count !== 1) {
        throw new SpeedsterMapIntegrityError("Restored TRAIN revision could not bind atomically to its captured source.");
      }
    }
    return revision;
  });
  return { mapId: created.mapId, revision: validateSpeedsterLoadedMapRevision(created) };
}

export async function promoteSpeedsterExactMapRevisionToFamily(input: Readonly<{
  source: SpeedsterMapSourceSession;
  targetRevisionId: string;
  authorAdminId: string;
  transaction?: SpeedsterMapTransactionRunner;
  registerCapturedPromotion?: SpeedsterCapturedRestoreRegistration;
  findActiveMap?: SpeedsterMapLookupDependencies["findActiveMap"];
  findTargetRevision?: SpeedsterMapLookupDependencies["findPinnedRevision"];
}>): Promise<SpeedsterMapSaveResult> {
  const target = await (input.findTargetRevision ?? defaultLookupDependencies.findPinnedRevision)(input.targetRevisionId);
  if (!target) throw new SpeedsterMapIntegrityError("Exact map revision to promote was not found.");
  const validated = validateSpeedsterLoadedMapRevision(target, { mapRevisionId: input.targetRevisionId });
  if (speedsterMapScopeForKey(validated.matchKey) !== "EXACT") {
    throw new SpeedsterMapIntegrityError("Only an exact map revision can be promoted to family scope.");
  }
  assertSpeedsterMapRevisionAppliesToIdentity(validated, {
    cardProfile: input.source.cardProfile,
    identity: input.source.identity,
  });
  const familyKey = speedsterFamilyCardTypeMapKey(input.source.cardProfile, input.source.identity);
  const matchKeyHash = speedsterMapMatchKeyHash(familyKey);
  const revisionId = randomUUID();
  const exactOverrideWasActive = input.source.workflowState === "CAPTURED"
    ? Boolean((await (input.findActiveMap ?? defaultLookupDependencies.findActiveMap)(
        speedsterMapMatchKeyHash(speedsterCardTypeMapKey(input.source.cardProfile, input.source.identity)),
      ))?.currentRevisionId)
    : false;
  const registration = input.source.workflowState === "CAPTURED" && !exactOverrideWasActive
    ? await (input.registerCapturedPromotion ?? registerCapturedRestore)(input.source, {
        revisionId,
        mapId: validated.mapId,
        frontMap: validated.frontMap,
        backMap: validated.backMap,
      })
    : null;
  const transaction: SpeedsterMapTransactionRunner = input.transaction ?? ((operation) => (
    prisma.$transaction((tx) => operation(tx), { isolationLevel: "Serializable" })
  ));
  const created = await transaction(async (tx) => {
    const capturedState = await assertCapturedTrainSourceIsUninitialized(tx, input.source);
    const exactOverrideRevisionId = await capturedExactOverrideRevisionId(tx, input.source, "FAMILY");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`speedster-map:${matchKeyHash}`}, 0))`;
    let map = await tx.aiGraderV2CardTypeMap.findUnique({
      where: { matchKeyHash },
      include: { currentRevision: { select: { id: true, version: true } } },
    });
    if (!map) {
      map = await tx.aiGraderV2CardTypeMap.create({
        data: { matchKeyHash, cardProfile: input.source.cardProfile },
        include: { currentRevision: { select: { id: true, version: true } } },
      });
    }
    if (map.cardProfile !== input.source.cardProfile) {
      throw new SpeedsterMapIntegrityError("Family map category does not match its stored category.");
    }
    const payload: SpeedsterMapRevisionHashPayload = {
      mapId: map.id,
      version: (map.currentRevision?.version ?? 0) + 1,
      matchKeyHash,
      matchKey: familyKey,
      displayIdentity: validated.displayIdentity,
      normalizedIdentity: familyKey,
      sourceSessionId: validated.sourceSessionId,
      authorAdminId: input.authorAdminId,
      frontMap: validated.frontMap,
      backMap: validated.backMap,
      mapSchemaVersion: validated.mapSchemaVersion,
      filterPolicyVersion: validated.filterPolicyVersion,
      supersedesRevisionId: map.currentRevision?.id ?? null,
    };
    const revision = await tx.aiGraderV2CardTypeMapRevision.create({
      data: {
        id: revisionId,
        mapId: payload.mapId,
        version: payload.version,
        matchKeyHash: payload.matchKeyHash,
        matchKey: payload.matchKey as Prisma.InputJsonValue,
        displayIdentity: payload.displayIdentity as Prisma.InputJsonValue,
        normalizedIdentity: payload.normalizedIdentity as Prisma.InputJsonValue,
        sourceSessionId: payload.sourceSessionId,
        authorAdminId: payload.authorAdminId,
        frontMap: payload.frontMap as unknown as Prisma.InputJsonValue,
        backMap: payload.backMap as unknown as Prisma.InputJsonValue,
        mapSchemaVersion: payload.mapSchemaVersion,
        filterPolicyVersion: payload.filterPolicyVersion,
        revisionHash: speedsterMapRevisionHash(payload),
        supersedesRevisionId: payload.supersedesRevisionId,
      },
      select: mapRevisionSelect,
    });
    await tx.aiGraderV2CardTypeMap.update({ where: { id: map.id }, data: { currentRevisionId: revision.id } });
    await clearCapturedFamilyBindingIfStale(
      tx,
      input.source,
      capturedState?.mapRevisionId,
      exactOverrideRevisionId,
    );
    if (registration && !exactOverrideRevisionId) {
      const bound = await tx.aiGraderV2Session.updateMany({
        where: {
          id: input.source.id,
          createdByUserId: input.source.createdByUserId,
          workflowState: "CAPTURED",
        },
        data: {
          mapRevisionId: revision.id,
          mapFilterPolicyVersion: validated.filterPolicyVersion,
          mapRegistration: registration as unknown as Prisma.InputJsonValue,
        },
      });
      if (bound.count !== 1) {
        throw new SpeedsterMapIntegrityError("Promoted family revision could not bind atomically to its captured source.");
      }
    }
    return revision;
  });
  return { mapId: created.mapId, revision: validateSpeedsterLoadedMapRevision(created) };
}

export async function listSpeedsterMapRevisionSummaries(mapId: string, currentRevisionId: string) {
  const revisions = await prisma.aiGraderV2CardTypeMapRevision.findMany({
    where: { mapId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      revisionHash: true,
      createdAt: true,
      sourceSessionId: true,
      authorAdminId: true,
    },
  });
  return revisions.map((revision): SpeedsterMapRevisionSummary => ({
    revisionId: revision.id,
    version: revision.version,
    revisionHash: revision.revisionHash,
    createdAt: revision.createdAt.toISOString(),
    sourceSessionId: revision.sourceSessionId,
    authorAdminId: revision.authorAdminId,
    current: revision.id === currentRevisionId,
  }));
}

export async function speedsterMapSourceClientState(source: SpeedsterMapSourceSession) {
  const [frontRectifiedUrl, backRectifiedUrl] = await Promise.all([
    presignReadUrl(source.front.rectifiedStorageKey),
    presignReadUrl(source.back.rectifiedStorageKey),
  ]);
  return {
    sessionId: source.id,
    cardProfile: source.cardProfile,
    identity: source.identity,
    cornerShape: source.cornerShape,
    front: { ...source.front, rectifiedUrl: frontRectifiedUrl },
    back: { ...source.back, rectifiedUrl: backRectifiedUrl },
  };
}
