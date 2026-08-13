import { createHash, randomUUID } from "node:crypto";
import { Prisma as PrismaRuntime } from "@prisma/client";
import {
  prisma,
  type Prisma,
} from "@tenkings/database";
import {
  SPEEDSTER_MAP_FILTER_POLICY_VERSION,
  SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
  SPEEDSTER_MAP_SCHEMA_VERSION,
  SPEEDSTER_MAP_SCHEMA_VERSION_V2,
  SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION,
  SPEEDSTER_MAP_REGISTRATION_VERSION,
  SPEEDSTER_MAP_REGISTRATION_VERSION_V2,
  canonicalSpeedsterMapKeyJson,
  isSpeedsterNondegenerateAnchorSet,
  isSpeedsterMapZoneV2,
  isSpeedsterSimplePolygon,
  isSpeedsterStrictConvexPolygon,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
  speedsterMapScopeForKey,
  type SpeedsterCardTypeMapSide,
  type SpeedsterMapAnchor,
  type SpeedsterMapDesignBoundary,
  type SpeedsterMapMatchKey,
  type SpeedsterMapFilterPolicyVersion,
  type SpeedsterMapReferenceEvidence,
  type SpeedsterMapRegistration,
  type SpeedsterMapScope,
  type SpeedsterMapSchemaVersion,
  type SpeedsterMapZone,
  type SpeedsterMapZoneContentType,
  type SpeedsterMapZoneProposalSource,
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
// Prisma's JSON transport can round the final IEEE-754 digit before PostgreSQL
// stores JSONB (for example, 0.11073133680555555 -> 0.1107313368055556).
// Twelve decimal places are far below one source-image pixel in the normalized
// unit grid and provide one deterministic server-owned persistence format.
const SPEEDSTER_MAP_PERSISTED_DECIMAL_PLACES = 12;

export class SpeedsterMapIntegrityError extends Error {
  readonly code: "CARD_MAP_INTEGRITY_FAILURE";
  readonly diagnostics?: Readonly<{
    stage: "VALIDATION" | "SOURCE" | "EVIDENCE" | "TRANSACTION" | "PERSISTED_HASH_VERIFICATION";
    scope?: SpeedsterMapScope;
    field?: string;
  }>;

  constructor(
    message: string,
    diagnostics?: SpeedsterMapIntegrityError["diagnostics"],
  ) {
    super(message);
    this.name = "SpeedsterMapIntegrityError";
    this.code = "CARD_MAP_INTEGRITY_FAILURE";
    this.diagnostics = diagnostics;
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
  mapSchemaVersion: SpeedsterMapSchemaVersion;
  filterPolicyVersion: SpeedsterMapFilterPolicyVersion;
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

const CONTENT_TYPES = new Set<SpeedsterMapZoneContentType>([
  "HEADER",
  "ARTWORK",
  "SPECIES_STRIP",
  "ATTACK",
  "STATS_BAR",
  "ARTIST_AND_CARD_ID",
  "FLAVOR_TEXT",
  "COPYRIGHT",
  "OTHER",
]);

const PROPOSAL_SOURCES = new Set<SpeedsterMapZoneProposalSource>([
  "HUMAN",
  "POKEMON_STANDARD_TEMPLATE",
  "VISUAL_SNAP",
  "COPIED_COMPATIBLE_MAP",
]);

function mapZone(
  value: unknown,
  label: string,
  schemaVersion: SpeedsterMapSchemaVersion = SPEEDSTER_MAP_SCHEMA_VERSION,
): SpeedsterMapZone {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError(`${label} is malformed.`);
  exactObjectKeys(value, schemaVersion === SPEEDSTER_MAP_SCHEMA_VERSION_V2
    ? [
        "id",
        "label",
        "semanticType",
        "polygon",
        "contentType",
        "filterAuthority",
        "filterAuthoritySource",
        "filterPaddingMm",
        "proposalSource",
        "proposalConfidence",
      ]
    : ["id", "label", "semanticType", "polygon"], label);
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
  const base = {
    id,
    label: zoneLabel,
    semanticType: value.semanticType as SpeedsterMapZone["semanticType"],
    polygon,
  };
  if (schemaVersion === SPEEDSTER_MAP_SCHEMA_VERSION) return base;
  if (typeof value.contentType !== "string" || !CONTENT_TYPES.has(value.contentType as SpeedsterMapZoneContentType)) {
    throw new SpeedsterMapIntegrityError(`${label}.contentType is invalid.`);
  }
  if (typeof value.filterAuthority !== "boolean") {
    throw new SpeedsterMapIntegrityError(`${label}.filterAuthority is invalid.`);
  }
  if (value.filterAuthoritySource !== "TYPE_DEFAULT" && value.filterAuthoritySource !== "HUMAN_OVERRIDE") {
    throw new SpeedsterMapIntegrityError(`${label}.filterAuthoritySource is invalid.`);
  }
  if (value.filterPaddingMm !== 0.6) {
    throw new SpeedsterMapIntegrityError(`${label}.filterPaddingMm is invalid for this immutable policy.`);
  }
  if (typeof value.proposalSource !== "string" || !PROPOSAL_SOURCES.has(value.proposalSource as SpeedsterMapZoneProposalSource)) {
    throw new SpeedsterMapIntegrityError(`${label}.proposalSource is invalid.`);
  }
  if (value.proposalConfidence !== null && (
    typeof value.proposalConfidence !== "number"
    || !Number.isFinite(value.proposalConfidence)
    || value.proposalConfidence < 0
    || value.proposalConfidence > 1
  )) throw new SpeedsterMapIntegrityError(`${label}.proposalConfidence is invalid.`);
  return {
    ...base,
    contentType: value.contentType as SpeedsterMapZoneContentType,
    filterAuthority: value.filterAuthority,
    filterAuthoritySource: value.filterAuthoritySource,
    filterPaddingMm: 0.6,
    proposalSource: value.proposalSource as SpeedsterMapZoneProposalSource,
    proposalConfidence: value.proposalConfidence as number | null,
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

export function parseSpeedsterMapSide(
  value: unknown,
  expectedSide: SpeedsterCardSide,
  schemaVersion: SpeedsterMapSchemaVersion = SPEEDSTER_MAP_SCHEMA_VERSION,
): SpeedsterCardTypeMapSide {
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
  const zones = value.zones.map((candidate, index) => (
    mapZone(candidate, `${expectedSide}.zones[${index}]`, schemaVersion)
  ));
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
  expected: Readonly<{
    side: SpeedsterCardSide;
    mapRevisionId: string;
    zones?: readonly SpeedsterMapZone[];
    anchors?: readonly SpeedsterMapAnchor[];
    designBoundary?: SpeedsterMapDesignBoundary;
  }>,
): SpeedsterMapRegistration {
  if (!isRecord(value)) throw new SpeedsterMapIntegrityError("Current-copy map registration is malformed.");
  const version = value.version;
  const v2 = version === SPEEDSTER_MAP_REGISTRATION_VERSION_V2;
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
    ...(v2 ? ["candidateProvenance", "acceptance"] : []),
    ...(v2 && "automaticFailure" in value ? ["automaticFailure"] : []),
  ], "Current-copy map registration");
  if (
    (version !== SPEEDSTER_MAP_REGISTRATION_VERSION && !v2) ||
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
  if (expected.anchors && (
    expected.anchors.length !== anchors.length
    || expected.anchors.some((anchor, index) => (
      anchor.id !== anchors[index].anchorId
      || Math.abs(anchor.point.x - anchors[index].expectedPoint.x) > 1e-12
      || Math.abs(anchor.point.y - anchors[index].expectedPoint.y) > 1e-12
    ))
  )) throw new SpeedsterMapIntegrityError("Current-copy map registration anchors do not match the immutable revision.");
  if (!Array.isArray(value.projectedZones) || value.projectedZones.length < 1 || value.projectedZones.length > 100) {
    throw new SpeedsterMapIntegrityError("Current-copy map registration zones are invalid.");
  }
  const projectedZones = value.projectedZones.map((zone, index) => (
    mapZone(zone, `Projected zone[${index}]`)
  ));
  if (expected.zones && (
    expected.zones.length !== projectedZones.length
    || expected.zones.some((zone, index) => (
      zone.id !== projectedZones[index].id || zone.semanticType !== projectedZones[index].semanticType
    ))
  )) throw new SpeedsterMapIntegrityError("Current-copy map registration zones do not match the immutable revision.");
  const projectedDesignBoundary = designBoundary(value.projectedDesignBoundary, "Projected design boundary");
  if (expected.anchors || expected.zones || expected.designBoundary) {
    const project = (source: SpeedsterPoint) => {
      const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = homography;
      const divisor = h6 * source.x + h7 * source.y + h8;
      if (!Number.isFinite(divisor) || Math.abs(divisor) <= 1e-12) {
        throw new SpeedsterMapIntegrityError("Current-copy map registration projection is singular.");
      }
      const projected = {
        x: (h0 * source.x + h1 * source.y + h2) / divisor,
        y: (h3 * source.x + h4 * source.y + h5) / divisor,
      };
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)
        || projected.x < 0 || projected.x > 1 || projected.y < 0 || projected.y > 1) {
        throw new SpeedsterMapIntegrityError("Current-copy map registration projects outside the physical card.");
      }
      return projected;
    };
    const samePoint = (left: SpeedsterPoint, right: SpeedsterPoint) => (
      Math.abs(left.x - right.x) <= 1e-6 && Math.abs(left.y - right.y) <= 1e-6
    );
    if (expected.anchors?.some((anchor, index) => !samePoint(project(anchor.point), anchors[index].locatedPoint))) {
      throw new SpeedsterMapIntegrityError("Current-copy map registration anchor projection is incoherent.");
    }
    if (expected.zones?.some((zone, zoneIndex) => (
      zone.polygon.length !== projectedZones[zoneIndex].polygon.length
      || zone.polygon.some((source, pointIndex) => (
        !samePoint(project(source), projectedZones[zoneIndex].polygon[pointIndex])
      ))
    ))) throw new SpeedsterMapIntegrityError("Current-copy map registration zone projection is incoherent.");
    if (expected.designBoundary?.kind === "FULL_BLEED") {
      if (projectedDesignBoundary.kind !== "FULL_BLEED") {
        throw new SpeedsterMapIntegrityError("Current-copy map registration boundary is incoherent.");
      }
    } else if (expected.designBoundary?.kind === "QUAD" && (
      projectedDesignBoundary.kind !== "QUAD"
      || expected.designBoundary.points.some((source, pointIndex) => (
        !samePoint(project(source), projectedDesignBoundary.kind === "QUAD"
          ? projectedDesignBoundary.points[pointIndex]
          : source)
      ))
    )) throw new SpeedsterMapIntegrityError("Current-copy map registration boundary projection is incoherent.");
  }
  let candidateProvenance: SpeedsterMapRegistration["candidateProvenance"];
  let acceptance: SpeedsterMapRegistration["acceptance"];
  if (v2) {
    if (!isRecord(value.candidateProvenance)) throw new SpeedsterMapIntegrityError("Registration candidate provenance is invalid.");
    exactObjectKeys(value.candidateProvenance, [
      "candidateId", "source", ...("lessonId" in value.candidateProvenance ? ["lessonId"] : []),
    ], "Registration candidate provenance");
    if (!["ORIGINAL_REFERENCE", "REGISTRATION_LESSON", "HUMAN_CORRECTION"].includes(String(value.candidateProvenance.source))) {
      throw new SpeedsterMapIntegrityError("Registration candidate provenance source is invalid.");
    }
    candidateProvenance = {
      candidateId: nonEmptyText(value.candidateProvenance.candidateId, "Registration candidate ID", 80),
      source: value.candidateProvenance.source as NonNullable<SpeedsterMapRegistration["candidateProvenance"]>["source"],
      ...("lessonId" in value.candidateProvenance
        ? { lessonId: nonEmptyText(value.candidateProvenance.lessonId, "Registration lesson ID", 80) }
        : {}),
    };
    if (!isRecord(value.acceptance)) throw new SpeedsterMapIntegrityError("Registration acceptance evidence is invalid.");
    exactObjectKeys(value.acceptance, [
      "policyVersion", "mode", "featureCount", "usableFeatureCount", "inlierCount", "inlierFraction",
      "perAnchorFeatureCounts", "perAnchorInlierCounts", "medianReprojectionErrorPx", "maxReprojectionErrorPx",
    ], "Registration acceptance evidence");
    const integer = (entry: unknown, label: string) => {
      const parsed = parseFiniteNumber(entry, label);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100) throw new SpeedsterMapIntegrityError(`${label} is invalid.`);
      return parsed;
    };
    const counts = (entry: unknown, label: string) => {
      if (!Array.isArray(entry) || entry.length !== 4) throw new SpeedsterMapIntegrityError(`${label} is invalid.`);
      return entry.map((count, index) => integer(count, `${label}[${index}]`)) as [number, number, number, number];
    };
    const inlierFraction = parseFiniteNumber(value.acceptance.inlierFraction, "Registration inlier fraction");
    const medianError = parseFiniteNumber(value.acceptance.medianReprojectionErrorPx, "Registration median reprojection error");
    const maxError = parseFiniteNumber(value.acceptance.maxReprojectionErrorPx, "Registration max reprojection error");
    if (
      value.acceptance.policyVersion !== SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION
      || (value.acceptance.mode !== "AUTOMATIC_RANSAC" && value.acceptance.mode !== "HUMAN_CONFIRMED")
      || inlierFraction < 0 || inlierFraction > 1 || medianError < 0 || maxError < medianError
    ) throw new SpeedsterMapIntegrityError("Registration acceptance policy identity is invalid.");
    const parsedAcceptance = {
      policyVersion: SPEEDSTER_MAP_REGISTRATION_POLICY_VERSION,
      mode: value.acceptance.mode,
      featureCount: integer(value.acceptance.featureCount, "Registration feature count"),
      usableFeatureCount: integer(value.acceptance.usableFeatureCount, "Registration usable feature count"),
      inlierCount: integer(value.acceptance.inlierCount, "Registration inlier count"),
      inlierFraction,
      perAnchorFeatureCounts: counts(value.acceptance.perAnchorFeatureCounts, "Registration per-anchor feature counts"),
      perAnchorInlierCounts: counts(value.acceptance.perAnchorInlierCounts, "Registration per-anchor inlier counts"),
      medianReprojectionErrorPx: medianError,
      maxReprojectionErrorPx: maxError,
    } as const;
    const featureSum = parsedAcceptance.perAnchorFeatureCounts.reduce((sum, count) => sum + count, 0);
    const inlierSum = parsedAcceptance.perAnchorInlierCounts.reduce((sum, count) => sum + count, 0);
    const automatic = parsedAcceptance.mode === "AUTOMATIC_RANSAC";
    if (
      parsedAcceptance.usableFeatureCount > parsedAcceptance.featureCount
      || parsedAcceptance.inlierCount > parsedAcceptance.usableFeatureCount
      || parsedAcceptance.usableFeatureCount === 0
      || Math.abs(
        parsedAcceptance.inlierFraction
          - parsedAcceptance.inlierCount / parsedAcceptance.usableFeatureCount,
      ) > 1e-12
      || featureSum !== parsedAcceptance.usableFeatureCount
      || inlierSum !== parsedAcceptance.inlierCount
      || parsedAcceptance.medianReprojectionErrorPx > 2
      || parsedAcceptance.maxReprojectionErrorPx > 5
      || (automatic && (
        parsedAcceptance.featureCount <= 4
        || parsedAcceptance.inlierCount < 10
        || parsedAcceptance.inlierFraction < 0.65
        || parsedAcceptance.perAnchorFeatureCounts.some((count) => count < 3)
        || parsedAcceptance.perAnchorInlierCounts.some((count) => count < 2)
        || candidateProvenance.source === "HUMAN_CORRECTION"
      ))
      || (!automatic && (
        parsedAcceptance.featureCount !== 4
        || parsedAcceptance.usableFeatureCount !== 4
        || parsedAcceptance.inlierCount !== 4
        || parsedAcceptance.inlierFraction !== 1
        || parsedAcceptance.perAnchorFeatureCounts.some((count) => count !== 1)
        || parsedAcceptance.perAnchorInlierCounts.some((count) => count !== 1)
        || candidateProvenance.source !== "HUMAN_CORRECTION"
      ))
      || (candidateProvenance.source === "ORIGINAL_REFERENCE" && (
        candidateProvenance.candidateId !== "original-reference" || candidateProvenance.lessonId !== undefined
      ))
      || (candidateProvenance.source === "REGISTRATION_LESSON" && (
        candidateProvenance.lessonId !== candidateProvenance.candidateId
      ))
    ) throw new SpeedsterMapIntegrityError("Registration acceptance evidence does not satisfy the versioned policy.");
    acceptance = parsedAcceptance;
  }
  return {
    version: version as SpeedsterMapRegistration["version"],
    side: expected.side,
    mapRevisionId: expected.mapRevisionId,
    currentPhysicalQuadSha256,
    currentInspectionSha256,
    homography: homography as unknown as SpeedsterMapRegistration["homography"],
    anchors,
    projectedDesignBoundary,
    projectedZones: projectedZones.map((zone, index) => {
      const immutable = expected.zones?.[index];
      return immutable && isSpeedsterMapZoneV2(immutable) ? {
        ...zone,
        label: immutable.label,
        contentType: immutable.contentType,
        filterAuthority: immutable.filterAuthority,
        filterAuthoritySource: immutable.filterAuthoritySource,
        filterPaddingMm: immutable.filterPaddingMm,
        proposalSource: immutable.proposalSource,
        proposalConfidence: immutable.proposalConfidence,
      } : zone;
    }),
    ...(candidateProvenance ? { candidateProvenance } : {}),
    ...(acceptance ? { acceptance } : {}),
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

function persistenceNormalizedJsonValue(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SpeedsterMapIntegrityError("Map hash payload contains a non-finite number.");
    if (Object.is(value, -0)) return 0;
    if (Number.isSafeInteger(value)) return value;
    const normalized = Number(value.toFixed(SPEEDSTER_MAP_PERSISTED_DECIMAL_PLACES));
    return Object.is(normalized, -0) ? 0 : normalized;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(persistenceNormalizedJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, persistenceNormalizedJsonValue(value[key])]),
    );
  }
  throw new SpeedsterMapIntegrityError("Map hash payload contains a non-JSON value.");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizedJsonValue(value));
}

function firstJsonDifference(
  expected: unknown,
  actual: unknown,
  path = "$",
): Readonly<{ path: string; expected: unknown; actual: unknown }> | null {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstJsonDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const difference = firstJsonDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, expected, actual };
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

export function normalizedSpeedsterMapRevisionPayload(
  payload: SpeedsterMapRevisionHashPayload,
): SpeedsterMapRevisionHashPayload {
  return persistenceNormalizedJsonValue(payload) as SpeedsterMapRevisionHashPayload;
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
  const mapSchemaVersion = record.mapSchemaVersion as SpeedsterMapSchemaVersion;
  const filterPolicyVersion = record.filterPolicyVersion as SpeedsterMapFilterPolicyVersion;
  const supportedLegacy = mapSchemaVersion === SPEEDSTER_MAP_SCHEMA_VERSION
    && filterPolicyVersion === SPEEDSTER_MAP_FILTER_POLICY_VERSION;
  const supportedV2 = mapSchemaVersion === SPEEDSTER_MAP_SCHEMA_VERSION_V2
    && filterPolicyVersion === SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2;
  if (!supportedLegacy && !supportedV2) {
    throw new SpeedsterMapIntegrityError("Map revision schema/filter-policy version pair is unsupported.");
  }
  const payload: SpeedsterMapRevisionHashPayload = {
    mapId: record.mapId,
    version: record.version,
    matchKeyHash: record.matchKeyHash,
    matchKey: rawKey,
    displayIdentity,
    normalizedIdentity,
    sourceSessionId: record.sourceSessionId,
    authorAdminId: record.authorAdminId,
    frontMap: parseSpeedsterMapSide(record.frontMap, "FRONT", mapSchemaVersion),
    backMap: parseSpeedsterMapSide(record.backMap, "BACK", mapSchemaVersion),
    mapSchemaVersion,
    filterPolicyVersion,
    supersedesRevisionId: record.supersedesRevisionId,
  };
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
  schemaVersion: SpeedsterMapSchemaVersion = SPEEDSTER_MAP_SCHEMA_VERSION,
): SpeedsterCardTypeMapSide {
  const raw: SpeedsterCardTypeMapSide = {
    side: source.side,
    referenceInspection: reference,
    sourcePhysicalQuadSha256: speedsterPhysicalQuadHash(source.sourceCorners),
    designBoundary: value.designBoundary,
    anchors: value.anchors.map((anchor) => ({ ...anchor, referencePatch: reference })),
    zones: value.zones,
  };
  return parseSpeedsterMapSide(raw, source.side, schemaVersion);
}

function registrationZone(zone: SpeedsterMapZone) {
  return {
    id: zone.id,
    label: zone.label,
    semanticType: zone.semanticType,
    polygon: zone.polygon,
  };
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
    projectedZones: sideMap.zones.map(registrationZone),
  }, {
    side: source.side,
    mapRevisionId,
    zones: sideMap.zones,
    anchors: sideMap.anchors,
    designBoundary: sideMap.designBoundary,
  });
}

export type SpeedsterMapSaveResult = Readonly<{
  mapId: string;
  revision: SpeedsterLoadedMapRevision;
}>;

export type SpeedsterMapDualSaveResult = Readonly<{
  family: SpeedsterMapSaveResult;
  exact: SpeedsterMapSaveResult;
}>;

export const SPEEDSTER_MAP_FILTER_V2_VERIFICATION_STATUS = "defect filter verification: PENDING" as const;
export const SPEEDSTER_MAP_FILTER_V2_ACTIVATION_AUTHORITY = "OWNER_WAIVER_2026_08_12" as const;

/**
 * V2 remains unverified by the inconclusive 50-card replay. The owner explicitly
 * waived that activation gate on 2026-08-12 and accepted sole-grader review plus
 * the removed-findings audit as the production safety net. Keeping this as an
 * explicit authority (instead of pretending the replay passed) preserves the
 * distinction between authorization and calibration evidence.
 */
export function requireSpeedsterMapFilterV2ActivationAuthority(): void {
  if (SPEEDSTER_MAP_FILTER_V2_ACTIVATION_AUTHORITY !== "OWNER_WAIVER_2026_08_12") {
    throw new SpeedsterMapIntegrityError(
      "The v2 Card Map filter activation authority is unavailable.",
      { stage: "VALIDATION" },
    );
  }
}

type SpeedsterMapFilterV2ActivationGate = () => void;

function requestedMapContract(front: SpeedsterMapTrainingSideInput, back: SpeedsterMapTrainingSideInput) {
  const zones = [...front.zones, ...back.zones];
  const v2Zones = zones.filter(isSpeedsterMapZoneV2).length;
  if (v2Zones !== 0 && v2Zones !== zones.length) {
    throw new SpeedsterMapIntegrityError("A Card Map cannot mix legacy and v2 zone-policy fields.");
  }
  return zones.length > 0 && v2Zones === zones.length
    ? {
        mapSchemaVersion: SPEEDSTER_MAP_SCHEMA_VERSION_V2,
        filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION_V2,
      } as const
    : {
        mapSchemaVersion: SPEEDSTER_MAP_SCHEMA_VERSION,
        filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION,
      } as const;
}

type SpeedsterMapWriteTransaction = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "$queryRaw" | "aiGraderV2CardTypeMap" | "aiGraderV2CardTypeMapRevision" | "aiGraderV2Session"
>;

export type SpeedsterMapTransactionRunner = <Result>(
  operation: (tx: SpeedsterMapWriteTransaction) => Promise<Result>,
) => Promise<Result>;

async function createOrLoadLockedMap(
  tx: SpeedsterMapWriteTransaction,
  input: Readonly<{
    cardProfile: SpeedsterCardProfile;
    matchKeyHash: string;
  }>,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`speedster-map:${input.matchKeyHash}`}, 0))`;
  let map = await tx.aiGraderV2CardTypeMap.findUnique({
    where: { matchKeyHash: input.matchKeyHash },
    include: { currentRevision: { select: { id: true, version: true } } },
  });
  if (!map) {
    map = await tx.aiGraderV2CardTypeMap.create({
      data: { matchKeyHash: input.matchKeyHash, cardProfile: input.cardProfile },
      include: { currentRevision: { select: { id: true, version: true } } },
    });
  }
  if (map.cardProfile !== input.cardProfile) {
    throw new SpeedsterMapIntegrityError("Map category does not match its stored category.", {
      stage: "TRANSACTION",
    });
  }
  return map;
}

async function createVerifiedRevision(
  tx: SpeedsterMapWriteTransaction,
  payload: SpeedsterMapRevisionHashPayload,
  scope: SpeedsterMapScope,
  revisionId?: string,
) {
  // Persist the exact same normalized JSON values that own the hash. This
  // removes Prisma/PostgreSQL representation differences (including -0) from
  // revision authority without changing the legacy hash algorithm.
  const persistedPayload = normalizedSpeedsterMapRevisionPayload(payload);
  const revisionHash = speedsterMapRevisionHash(persistedPayload);
  const created = await tx.aiGraderV2CardTypeMapRevision.create({
    data: {
      ...(revisionId ? { id: revisionId } : {}),
      mapId: persistedPayload.mapId,
      version: persistedPayload.version,
      matchKeyHash: persistedPayload.matchKeyHash,
      matchKey: persistedPayload.matchKey as Prisma.InputJsonValue,
      displayIdentity: persistedPayload.displayIdentity as Prisma.InputJsonValue,
      normalizedIdentity: persistedPayload.normalizedIdentity as Prisma.InputJsonValue,
      sourceSessionId: persistedPayload.sourceSessionId,
      authorAdminId: persistedPayload.authorAdminId,
      frontMap: persistedPayload.frontMap as unknown as Prisma.InputJsonValue,
      backMap: persistedPayload.backMap as unknown as Prisma.InputJsonValue,
      mapSchemaVersion: persistedPayload.mapSchemaVersion,
      filterPolicyVersion: persistedPayload.filterPolicyVersion,
      revisionHash,
      supersedesRevisionId: persistedPayload.supersedesRevisionId,
    },
    select: { id: true },
  });
  const persisted = await tx.aiGraderV2CardTypeMapRevision.findUnique({
    where: { id: created.id },
    select: mapRevisionSelect,
  });
  if (!persisted) {
    throw new SpeedsterMapIntegrityError("Card Map revision could not be read back for integrity verification.", {
      stage: "PERSISTED_HASH_VERIFICATION",
      scope,
    });
  }
  let loaded: SpeedsterLoadedMapRevision;
  try {
    loaded = validateSpeedsterLoadedMapRevision(persisted, {
      matchKeyHash: payload.matchKeyHash,
      mapRevisionId: created.id,
    });
  } catch (error) {
    if (error instanceof SpeedsterMapIntegrityError) {
      const persistedHashPayload = {
        mapId: persisted.mapId,
        version: persisted.version,
        matchKeyHash: persisted.matchKeyHash,
        matchKey: persisted.matchKey,
        displayIdentity: persisted.displayIdentity,
        normalizedIdentity: persisted.normalizedIdentity,
        sourceSessionId: persisted.sourceSessionId,
        authorAdminId: persisted.authorAdminId,
        frontMap: persisted.frontMap,
        backMap: persisted.backMap,
        mapSchemaVersion: persisted.mapSchemaVersion,
        filterPolicyVersion: persisted.filterPolicyVersion,
        supersedesRevisionId: persisted.supersedesRevisionId,
      } as unknown as SpeedsterMapRevisionHashPayload;
      const firstDifference = firstJsonDifference(persistedPayload, persistedHashPayload);
      throw new SpeedsterMapIntegrityError("Persisted Card Map content failed deterministic hash verification.", {
        stage: "PERSISTED_HASH_VERIFICATION",
        scope,
        field: firstDifference?.path ?? "revisionHash",
      });
    }
    throw error;
  }
  if (loaded.revisionHash !== revisionHash) {
    throw new SpeedsterMapIntegrityError("Persisted Card Map revision hash changed during verification.", {
      stage: "PERSISTED_HASH_VERIFICATION",
      scope,
      field: "revisionHash",
    });
  }
  return loaded;
}

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
      zones: sideMap.zones.map(registrationZone),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SpeedsterMapIntegrityError(`Restored ${source.side} TRAIN map could not register to the current copy.`);
  }
  return parseSpeedsterMapRegistration(payload, {
    side: source.side,
    mapRevisionId: revisionId,
    zones: sideMap.zones,
    anchors: sideMap.anchors,
    designBoundary: sideMap.designBoundary,
  });
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
  v2ActivationGate?: SpeedsterMapFilterV2ActivationGate;
}>): Promise<SpeedsterMapSaveResult> {
  const scope = input.scope ?? "EXACT";
  const key = speedsterMapKeyForScope(scope, input.source.cardProfile, input.source.identity);
  const matchKeyHash = speedsterMapMatchKeyHash(key);
  const hashEvidence = input.hashEvidence ?? hashSpeedsterMapStorageEvidence;
  const contract = requestedMapContract(input.front, input.back);
  if (contract.mapSchemaVersion === SPEEDSTER_MAP_SCHEMA_VERSION_V2) {
    (input.v2ActivationGate ?? requireSpeedsterMapFilterV2ActivationAuthority)();
  }
  let frontEvidenceHash: string;
  let backEvidenceHash: string;
  try {
    [frontEvidenceHash, backEvidenceHash] = await Promise.all([
      hashEvidence(input.source.front.inspectionStorageKey),
      hashEvidence(input.source.back.inspectionStorageKey),
    ]);
  } catch {
    throw new SpeedsterMapIntegrityError("Card Map source evidence could not be verified.", {
      stage: "EVIDENCE",
    });
  }
  const frontMap = trainingInputSide(input.front, input.source.front, {
    storageKey: input.source.front.inspectionStorageKey,
    sha256: frontEvidenceHash,
  }, contract.mapSchemaVersion);
  const backMap = trainingInputSide(input.back, input.source.back, {
    storageKey: input.source.back.inspectionStorageKey,
    sha256: backEvidenceHash,
  }, contract.mapSchemaVersion);
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
      ...contract,
      supersedesRevisionId: map.currentRevision?.id ?? null,
    };
    const revision = await createVerifiedRevision(tx, payload, scope);
    await tx.aiGraderV2CardTypeMap.update({
      where: { id: map.id },
      data: { currentRevisionId: revision.revisionId },
    });
    await clearCapturedFamilyBindingIfStale(
      tx,
      input.source,
      capturedState?.mapRevisionId,
      exactOverrideRevisionId,
    );
    if (input.source.workflowState === "CAPTURED" && !exactOverrideRevisionId) {
      const frontRegistration = speedsterIdentityMapRegistration(frontMap, input.source.front, revision.revisionId);
      const backRegistration = speedsterIdentityMapRegistration(backMap, input.source.back, revision.revisionId);
      const bound = await tx.aiGraderV2Session.updateMany({
        where: {
          id: input.source.id,
          createdByUserId: input.source.createdByUserId,
          workflowState: "CAPTURED",
        },
        data: {
          mapRevisionId: revision.revisionId,
          mapFilterPolicyVersion: contract.filterPolicyVersion,
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
  return { mapId: created.mapId, revision: created };
}

/**
 * The only new-authoring write path. One human-authored geometry body creates
 * complete FAMILY and legacy EXACT revisions. Both persisted revisions are
 * read back and hash-verified before either current pointer is advanced.
 */
export async function saveSpeedsterFamilyAndExactMapRevisions(input: Readonly<{
  source: SpeedsterMapSourceSession;
  authorAdminId: string;
  front: SpeedsterMapTrainingSideInput;
  back: SpeedsterMapTrainingSideInput;
  hashEvidence?: typeof hashSpeedsterMapStorageEvidence;
  transaction?: SpeedsterMapTransactionRunner;
  v2ActivationGate?: SpeedsterMapFilterV2ActivationGate;
}>): Promise<SpeedsterMapDualSaveResult> {
  const exactKey = speedsterCardTypeMapKey(input.source.cardProfile, input.source.identity);
  const familyKey = speedsterFamilyCardTypeMapKey(input.source.cardProfile, input.source.identity);
  const exactMatchKeyHash = speedsterMapMatchKeyHash(exactKey);
  const familyMatchKeyHash = speedsterMapMatchKeyHash(familyKey);
  const hashEvidence = input.hashEvidence ?? hashSpeedsterMapStorageEvidence;
  const contract = requestedMapContract(input.front, input.back);
  if (contract.mapSchemaVersion === SPEEDSTER_MAP_SCHEMA_VERSION_V2) {
    (input.v2ActivationGate ?? requireSpeedsterMapFilterV2ActivationAuthority)();
  }
  let frontEvidenceHash: string;
  let backEvidenceHash: string;
  try {
    [frontEvidenceHash, backEvidenceHash] = await Promise.all([
      hashEvidence(input.source.front.inspectionStorageKey),
      hashEvidence(input.source.back.inspectionStorageKey),
    ]);
  } catch {
    throw new SpeedsterMapIntegrityError("Card Map source evidence could not be verified.", {
      stage: "EVIDENCE",
    });
  }
  const frontMap = trainingInputSide(input.front, input.source.front, {
    storageKey: input.source.front.inspectionStorageKey,
    sha256: frontEvidenceHash,
  }, contract.mapSchemaVersion);
  const backMap = trainingInputSide(input.back, input.source.back, {
    storageKey: input.source.back.inspectionStorageKey,
    sha256: backEvidenceHash,
  }, contract.mapSchemaVersion);
  const transaction: SpeedsterMapTransactionRunner = input.transaction ?? ((operation) => (
    prisma.$transaction((tx) => operation(tx), { isolationLevel: "Serializable" })
  ));

  return transaction(async (tx) => {
    await assertCapturedTrainSourceIsUninitialized(tx, input.source);
    const familyMap = await createOrLoadLockedMap(tx, {
      cardProfile: input.source.cardProfile,
      matchKeyHash: familyMatchKeyHash,
    });
    const exactMap = await createOrLoadLockedMap(tx, {
      cardProfile: input.source.cardProfile,
      matchKeyHash: exactMatchKeyHash,
    });
    const common = {
      displayIdentity: input.source.identity,
      sourceSessionId: input.source.id,
      authorAdminId: input.authorAdminId,
      frontMap,
      backMap,
      ...contract,
    } as const;
    const familyPayload: SpeedsterMapRevisionHashPayload = {
      mapId: familyMap.id,
      version: (familyMap.currentRevision?.version ?? 0) + 1,
      matchKeyHash: familyMatchKeyHash,
      matchKey: familyKey,
      normalizedIdentity: familyKey,
      supersedesRevisionId: familyMap.currentRevision?.id ?? null,
      ...common,
    };
    const exactPayload: SpeedsterMapRevisionHashPayload = {
      mapId: exactMap.id,
      version: (exactMap.currentRevision?.version ?? 0) + 1,
      matchKeyHash: exactMatchKeyHash,
      matchKey: exactKey,
      normalizedIdentity: exactKey,
      supersedesRevisionId: exactMap.currentRevision?.id ?? null,
      ...common,
    };

    // Persist and independently verify both immutable bodies before publishing
    // either revision through its current pointer.
    const familyRevision = await createVerifiedRevision(tx, familyPayload, "FAMILY");
    const exactRevision = await createVerifiedRevision(tx, exactPayload, "EXACT");
    await tx.aiGraderV2CardTypeMap.update({
      where: { id: familyMap.id },
      data: { currentRevisionId: familyRevision.revisionId },
    });
    await tx.aiGraderV2CardTypeMap.update({
      where: { id: exactMap.id },
      data: { currentRevisionId: exactRevision.revisionId },
    });

    // The source card is itself an exact match. When it is still safe to bind,
    // exact therefore wins over the simultaneously authored family revision.
    if (input.source.workflowState === "CAPTURED") {
      const frontRegistration = speedsterIdentityMapRegistration(frontMap, input.source.front, exactRevision.revisionId);
      const backRegistration = speedsterIdentityMapRegistration(backMap, input.source.back, exactRevision.revisionId);
      const bound = await tx.aiGraderV2Session.updateMany({
        where: {
          id: input.source.id,
          createdByUserId: input.source.createdByUserId,
          workflowState: "CAPTURED",
        },
        data: {
          mapRevisionId: exactRevision.revisionId,
          mapFilterPolicyVersion: contract.filterPolicyVersion,
          mapRegistration: {
            front: frontRegistration,
            back: backRegistration,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      if (bound.count !== 1) {
        throw new SpeedsterMapIntegrityError("New Card Map revisions could not bind atomically to their captured source.", {
          stage: "TRANSACTION",
          scope: "EXACT",
        });
      }
    }
    return {
      family: { mapId: familyMap.id, revision: familyRevision },
      exact: { mapId: exactMap.id, revision: exactRevision },
    };
  });
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
    const revision = await createVerifiedRevision(tx, payload, scope, revisionId);
    if (revision.revisionId !== revisionId) {
      throw new SpeedsterMapIntegrityError("Restored Card Map revision identity changed during persistence.", {
        stage: "PERSISTED_HASH_VERIFICATION",
        scope,
        field: "revisionId",
      });
    }
    await tx.aiGraderV2CardTypeMap.update({ where: { id: map.id }, data: { currentRevisionId: revision.revisionId } });
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
          mapRevisionId: revision.revisionId,
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
  return { mapId: created.mapId, revision: created };
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
    const revision = await createVerifiedRevision(tx, payload, "FAMILY", revisionId);
    await tx.aiGraderV2CardTypeMap.update({ where: { id: map.id }, data: { currentRevisionId: revision.revisionId } });
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
          mapRevisionId: revision.revisionId,
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
  return { mapId: created.mapId, revision: created };
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

export async function speedsterMapSourceClientState(
  source: SpeedsterMapSourceSession,
  hashEvidence: typeof hashSpeedsterMapStorageEvidence = hashSpeedsterMapStorageEvidence,
) {
  const [frontRectifiedUrl, backRectifiedUrl, frontInspectionSha256, backInspectionSha256] = await Promise.all([
    presignReadUrl(source.front.rectifiedStorageKey),
    presignReadUrl(source.back.rectifiedStorageKey),
    hashEvidence(source.front.inspectionStorageKey),
    hashEvidence(source.back.inspectionStorageKey),
  ]);
  const side = (
    value: SpeedsterMapSourceSide,
    rectifiedUrl: string,
    inspectionSha256: string,
  ) => ({
    ...value,
    rectifiedUrl,
    sourceEvidence: {
      originalStorageKey: value.originalStorageKey,
      rectifiedStorageKey: value.rectifiedStorageKey,
      inspectionStorageKey: value.inspectionStorageKey,
      inspectionSha256,
    },
  });
  return {
    sessionId: source.id,
    cardProfile: source.cardProfile,
    identity: source.identity,
    cornerShape: source.cornerShape,
    front: side(source.front, frontRectifiedUrl, frontInspectionSha256),
    back: side(source.back, backRectifiedUrl, backInspectionSha256),
  };
}
