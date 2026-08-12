import {
  isSpeedsterNondegenerateAnchorSet,
  isSpeedsterSimplePolygon,
  isSpeedsterStrictConvexPolygon,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
  type SpeedsterCardTypeMapKey,
  type SpeedsterFamilyCardTypeMapKey,
  type SpeedsterMapDesignBoundary,
  type SpeedsterMapZone,
  type SpeedsterMapZoneSemanticType,
} from "./card-type-map-contracts";
import type { SpeedsterCardProfile, SpeedsterPoint, SpeedsterQuad } from "./contracts";
import {
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterSessionIdentity,
} from "./identity";

export const CARD_MAP_DRAFT_FORMAT = "ten-kings-card-map-draft" as const;
export const CARD_MAP_DRAFT_VERSION = 1 as const;

const SHA256 = /^[a-f0-9]{64}$/;
const ZONE_TYPES = new Set<SpeedsterMapZoneSemanticType>([
  "PRINT_TEXT",
  "PRINT_LOGO",
  "PRINT_ARTWORK",
  "PRINT_BORDER",
  "PRINT_FOIL",
  "OTHER_PRINT_CONTEXT",
]);

type DraftAnchor = Readonly<{ id: string; label: string; point: SpeedsterPoint }>;
export type CardMapDraftSide = Readonly<{
  designBoundary: SpeedsterMapDesignBoundary;
  anchors: readonly DraftAnchor[];
  zones: readonly Readonly<SpeedsterMapZone & { filterAuthority: true }>[];
}>;

type DraftEvidenceSide = Readonly<{
  originalStorageKey: string | null;
  rectifiedStorageKey: string;
  inspectionStorageKey: string | null;
  evidenceSha256: string | null;
}>;

export type CardMapDraftV1 = Readonly<{
  format: typeof CARD_MAP_DRAFT_FORMAT;
  version: typeof CARD_MAP_DRAFT_VERSION;
  source: Readonly<{
    sessionId: string;
    cardProfile: SpeedsterCardProfile;
    identity: SpeedsterSessionIdentity;
    scopes: readonly ["FAMILY", "EXACT"];
    familyKey: SpeedsterFamilyCardTypeMapKey;
    exactKey: SpeedsterCardTypeMapKey;
    provenance: Readonly<{
      sourceSessionId: string;
      front: DraftEvidenceSide;
      back: DraftEvidenceSide;
    }>;
  }>;
  coordinateSpace: Readonly<{
    kind: "NORMALIZED_UNIT_GRID";
    width: 1;
    height: 1;
    sourceViewBox: Readonly<{ width: 1000; height: 1400 }>;
    polygonOrder: "PERIMETER_PRESERVED";
  }>;
  sides: Readonly<{ front: CardMapDraftSide; back: CardMapDraftSide }>;
}>;

export type CardMapDraftSource = Readonly<{
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  identity: SpeedsterSessionIdentity;
  front: Readonly<{
    originalStorageKey?: string | null;
    rectifiedStorageKey?: string;
    inspectionStorageKey?: string | null;
    evidenceSha256?: string | null;
    sourceEvidence?: Readonly<{
      originalStorageKey: string;
      rectifiedStorageKey: string;
      inspectionStorageKey: string;
      inspectionSha256: string;
    }>;
  }>;
  back: Readonly<{
    originalStorageKey?: string | null;
    rectifiedStorageKey?: string;
    inspectionStorageKey?: string | null;
    evidenceSha256?: string | null;
    sourceEvidence?: Readonly<{
      originalStorageKey: string;
      rectifiedStorageKey: string;
      inspectionStorageKey: string;
      inspectionSha256: string;
    }>;
  }>;
}>;

export class CardMapDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardMapDraftValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, label: string, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new CardMapDraftValidationError(`${label} is missing or invalid.`);
  }
  return value.trim();
}

function nullableText(value: unknown, label: string, maximum = 500) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, label, maximum);
}

function stableStorageKey(value: unknown, label: string, required: boolean) {
  const key = nullableText(value, label);
  if (!key && required) throw new CardMapDraftValidationError(`${label} is required.`);
  if (key && /^(?:https?:|data:|blob:)/i.test(key)) {
    throw new CardMapDraftValidationError(`${label} must be a stable storage key, not a URL.`);
  }
  // The recovered Production DOM exposed the configured bucket-name prefix,
  // while the server source response uses the object key relative to that same
  // bucket. This one known prefix is representation-only; no other path rewrite
  // or fuzzy key matching is permitted.
  return key?.startsWith("tenkings-cards/ai-grader-v2/") ? key.slice("tenkings-cards/".length) : key;
}

function sha256(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !SHA256.test(value.toLowerCase())) {
    throw new CardMapDraftValidationError(`${label} must be a lowercase SHA-256 when present.`);
  }
  return value.toLowerCase();
}

function point(value: unknown, label: string): SpeedsterPoint {
  if (!isRecord(value)
    || typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0 || value.x > 1
    || typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) {
    throw new CardMapDraftValidationError(`${label} must contain finite normalized x/y coordinates.`);
  }
  return { x: value.x, y: value.y };
}

function points(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new CardMapDraftValidationError(`${label} must contain ${minimum}-${maximum} ordered points.`);
  }
  return value.map((candidate, index) => point(candidate, `${label}[${index}]`));
}

function boundary(value: unknown, label: string): SpeedsterMapDesignBoundary {
  if (Array.isArray(value)) {
    const parsed = points(value, label, 4, 4) as unknown as SpeedsterQuad;
    if (!isSpeedsterStrictConvexPolygon(parsed)) {
      throw new CardMapDraftValidationError(`${label} must be a non-collapsed convex perimeter quad.`);
    }
    return { kind: "QUAD", points: parsed };
  }
  if (!isRecord(value) || (value.kind !== "QUAD" && value.kind !== "FULL_BLEED")) {
    throw new CardMapDraftValidationError(`${label} is invalid.`);
  }
  if (value.kind === "FULL_BLEED") return { kind: "FULL_BLEED" };
  const parsed = points(value.points, `${label}.points`, 4, 4) as unknown as SpeedsterQuad;
  if (!isSpeedsterStrictConvexPolygon(parsed)) {
    throw new CardMapDraftValidationError(`${label} must be a non-collapsed convex perimeter quad.`);
  }
  return { kind: "QUAD", points: parsed };
}

function draftSide(value: unknown, side: "front" | "back"): CardMapDraftSide {
  if (!isRecord(value)) throw new CardMapDraftValidationError(`${side} geometry is missing.`);
  const designBoundary = boundary(value.designBoundary ?? value.printedBoundary, `${side} printed boundary`);
  const rawAnchors = value.anchors ?? value.registrationAnchors;
  if (!Array.isArray(rawAnchors) || rawAnchors.length !== 4) {
    throw new CardMapDraftValidationError(`${side} must contain exactly four registration anchors.`);
  }
  const anchors = rawAnchors.map((candidate, index): DraftAnchor => {
    if (!isRecord(candidate)) throw new CardMapDraftValidationError(`${side} anchor ${index + 1} is invalid.`);
    const anchorPoint = "point" in candidate ? point(candidate.point, `${side} anchor ${index + 1}`) : point(candidate, `${side} anchor ${index + 1}`);
    return {
      id: nullableText(candidate.id, `${side} anchor ${index + 1} id`, 80) ?? `${side}-anchor-${index + 1}`,
      label: nullableText(candidate.label, `${side} anchor ${index + 1} label`, 80) ?? `Anchor ${index + 1}`,
      point: anchorPoint,
    };
  });
  if (!isSpeedsterNondegenerateAnchorSet(anchors.map((anchor) => anchor.point))) {
    throw new CardMapDraftValidationError(`${side} registration anchors are collapsed or singular.`);
  }
  if (!Array.isArray(value.zones) || value.zones.length < 1 || value.zones.length > 100) {
    throw new CardMapDraftValidationError(`${side} must contain 1-100 ordered zones.`);
  }
  const zones = value.zones.map((candidate, index) => {
    if (!isRecord(candidate)) throw new CardMapDraftValidationError(`${side} zone ${index + 1} is invalid.`);
    const semanticType = candidate.semanticType;
    if (typeof semanticType !== "string" || !ZONE_TYPES.has(semanticType as SpeedsterMapZoneSemanticType)) {
      throw new CardMapDraftValidationError(`${side} zone ${index + 1} has an unsupported semantic type.`);
    }
    if (candidate.filterAuthority !== undefined && candidate.filterAuthority !== true) {
      throw new CardMapDraftValidationError(
        `${side} zone ${index + 1} disables filter authority, which this Card Map version does not support.`,
      );
    }
    const polygon = points(candidate.polygon ?? candidate.points, `${side} zone ${index + 1} polygon`, 3, 64);
    if (!isSpeedsterSimplePolygon(polygon)) {
      throw new CardMapDraftValidationError(`${side} zone ${index + 1} polygon is collapsed or self-intersecting.`);
    }
    return {
      id: nullableText(candidate.id, `${side} zone ${index + 1} id`, 80) ?? `${side}-zone-${index + 1}`,
      label: text(candidate.label ?? candidate.name, `${side} zone ${index + 1} label`, 80),
      semanticType: semanticType as SpeedsterMapZoneSemanticType,
      filterAuthority: true as const,
      polygon,
    };
  });
  return { designBoundary, anchors, zones };
}

function sourceIdentity(value: Record<string, unknown>) {
  if (isRecord(value.identity) && (value.cardProfile === "SPORTS" || value.cardProfile === "POKEMON")) {
    return {
      cardProfile: value.cardProfile,
      identity: canonicalizeSpeedsterSessionIdentity(value.cardProfile, value.identity),
    } as const;
  }
  if (value.category !== "SPORTS" && value.category !== "POKEMON") {
    throw new CardMapDraftValidationError("Draft source category is invalid.");
  }
  const cardProfile = value.category;
  const identity = cardProfile === "SPORTS"
    ? {
        playerName: value.playerName,
        year: value.year,
        manufacturer: value.manufacturer,
        productSet: value.productSet,
        insert: value.insert ?? null,
        parallel: value.parallel ?? null,
        cardNumber: value.cardNumber ?? null,
      }
    : {
        cardName: value.cardName,
        year: value.year,
        productSet: value.productSet,
        parallel: value.parallel ?? null,
        cardNumber: value.cardNumber ?? null,
      };
  try {
    return { cardProfile, identity: canonicalizeSpeedsterSessionIdentity(cardProfile, identity) } as const;
  } catch {
    throw new CardMapDraftValidationError("Draft source identity is malformed.");
  }
}

function evidenceSide(value: unknown, label: string, legacyKey: unknown): DraftEvidenceSide {
  const evidence = isRecord(value) ? value : {};
  return {
    originalStorageKey: stableStorageKey(evidence.originalStorageKey, `${label} original storage key`, false),
    rectifiedStorageKey: stableStorageKey(
      evidence.rectifiedStorageKey ?? legacyKey,
      `${label} rectified storage key`,
      true,
    )!,
    inspectionStorageKey: stableStorageKey(evidence.inspectionStorageKey, `${label} inspection storage key`, false),
    evidenceSha256: sha256(evidence.evidenceSha256 ?? evidence.sha256, `${label} evidence SHA-256`),
  };
}

function canonicalSource(value: Record<string, unknown>) {
  const parsedIdentity = sourceIdentity(value);
  const provenance = isRecord(value.provenance) ? value.provenance : {};
  const legacyEvidence = isRecord(value.sourceEvidence) ? value.sourceEvidence : {};
  const sessionId = text(
    value.sessionId ?? value.sourceSessionPathId ?? provenance.sourceSessionId,
    "Draft source session ID",
    80,
  );
  return {
    sessionId,
    cardProfile: parsedIdentity.cardProfile,
    identity: parsedIdentity.identity,
    front: evidenceSide(provenance.front, "Front", legacyEvidence.frontImageKey),
    back: evidenceSide(provenance.back, "Back", legacyEvidence.backImageKey),
  };
}

function compareJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compatibleSource(imported: ReturnType<typeof canonicalSource>, expected: CardMapDraftSource): CardMapDraftSource {
  if (imported.sessionId !== expected.sessionId) {
    throw new CardMapDraftValidationError("This draft belongs to a different source card session.");
  }
  if (imported.cardProfile !== expected.cardProfile) {
    throw new CardMapDraftValidationError("This draft belongs to a different card category.");
  }
  const expectedIdentity = canonicalizeSpeedsterSessionIdentity(expected.cardProfile, expected.identity);
  if (!compareJson(imported.identity, expectedIdentity)) {
    throw new CardMapDraftValidationError("This draft belongs to a different exact source identity.");
  }
  const merged = {} as Record<"front" | "back", DraftEvidenceSide>;
  for (const side of ["front", "back"] as const) {
    const expectedEvidence = draftEvidence(expected, side);
    if (imported[side].rectifiedStorageKey !== expectedEvidence.rectifiedStorageKey) {
      throw new CardMapDraftValidationError(`This draft belongs to different ${side} source imagery.`);
    }
    for (const field of ["originalStorageKey", "inspectionStorageKey", "evidenceSha256"] as const) {
      if (imported[side][field] && expectedEvidence[field] && imported[side][field] !== expectedEvidence[field]) {
        throw new CardMapDraftValidationError(`This draft contains mismatched ${side} source provenance.`);
      }
    }
    // Older recovery exports may only contain the rectified object key. Rebind
    // absent provenance to the server-owned source response, but never replace a
    // conflicting value silently.
    merged[side] = {
      originalStorageKey: expectedEvidence.originalStorageKey ?? imported[side].originalStorageKey,
      rectifiedStorageKey: expectedEvidence.rectifiedStorageKey,
      inspectionStorageKey: expectedEvidence.inspectionStorageKey ?? imported[side].inspectionStorageKey,
      evidenceSha256: expectedEvidence.evidenceSha256 ?? imported[side].evidenceSha256,
    };
  }
  return {
    sessionId: expected.sessionId,
    cardProfile: expected.cardProfile,
    identity: expectedIdentity,
    front: merged.front,
    back: merged.back,
  };
}

function cloneDraftSide(side: CardMapDraftSide): CardMapDraftSide {
  return {
    designBoundary: side.designBoundary.kind === "FULL_BLEED"
      ? { kind: "FULL_BLEED" }
      : { kind: "QUAD", points: side.designBoundary.points.map((point) => ({ ...point })) as unknown as SpeedsterQuad },
    anchors: side.anchors.map((anchor) => ({ ...anchor, point: { ...anchor.point } })),
    zones: side.zones.map((zone) => ({
      id: zone.id,
      label: zone.label,
      semanticType: zone.semanticType,
      filterAuthority: true,
      polygon: zone.polygon.map((point) => ({ ...point })),
    })),
  };
}

function draftEvidence(source: CardMapDraftSource, side: "front" | "back"): DraftEvidenceSide {
  const value = source[side];
  const evidence = value.sourceEvidence;
  const rectifiedStorageKey = stableStorageKey(
    evidence?.rectifiedStorageKey ?? value.rectifiedStorageKey,
    `${side} rectified storage key`,
    true,
  );
  return {
    originalStorageKey: stableStorageKey(
      evidence?.originalStorageKey ?? value.originalStorageKey,
      `${side} original storage key`,
      false,
    ),
    rectifiedStorageKey: rectifiedStorageKey!,
    inspectionStorageKey: stableStorageKey(
      evidence?.inspectionStorageKey ?? value.inspectionStorageKey,
      `${side} inspection storage key`,
      false,
    ),
    evidenceSha256: sha256(
      evidence?.inspectionSha256 ?? value.evidenceSha256,
      `${side} evidence SHA-256`,
    ),
  };
}

export function createCardMapDraft(input: Readonly<{
  source: CardMapDraftSource;
  front: CardMapDraftSide;
  back: CardMapDraftSide;
}>): CardMapDraftV1 {
  const identity = canonicalizeSpeedsterSessionIdentity(input.source.cardProfile, input.source.identity);
  return {
    format: CARD_MAP_DRAFT_FORMAT,
    version: CARD_MAP_DRAFT_VERSION,
    source: {
      sessionId: input.source.sessionId,
      cardProfile: input.source.cardProfile,
      identity,
      scopes: ["FAMILY", "EXACT"],
      familyKey: speedsterFamilyCardTypeMapKey(input.source.cardProfile, identity),
      exactKey: speedsterCardTypeMapKey(input.source.cardProfile, identity),
      provenance: {
        sourceSessionId: input.source.sessionId,
        front: draftEvidence(input.source, "front"),
        back: draftEvidence(input.source, "back"),
      },
    },
    coordinateSpace: {
      kind: "NORMALIZED_UNIT_GRID",
      width: 1,
      height: 1,
      sourceViewBox: { width: 1000, height: 1400 },
      polygonOrder: "PERIMETER_PRESERVED",
    },
    sides: { front: cloneDraftSide(input.front), back: cloneDraftSide(input.back) },
  };
}

export function parseCardMapDraft(textValue: string, expectedSource: CardMapDraftSource): CardMapDraftV1 {
  let value: unknown;
  try {
    value = JSON.parse(textValue);
  } catch {
    throw new CardMapDraftValidationError("Card Map draft is not valid JSON.");
  }
  if (!isRecord(value) || value.format !== CARD_MAP_DRAFT_FORMAT || value.version !== CARD_MAP_DRAFT_VERSION) {
    throw new CardMapDraftValidationError("Card Map draft format or version is unsupported.");
  }
  if (!isRecord(value.source) || !isRecord(value.sides)) {
    throw new CardMapDraftValidationError("Card Map draft source or geometry is missing.");
  }
  const source = canonicalSource(value.source);
  const trustedSource = compatibleSource(source, expectedSource);
  return createCardMapDraft({
    source: trustedSource,
    front: draftSide(value.sides.front, "front"),
    back: draftSide(value.sides.back, "back"),
  });
}

export function serializeCardMapDraft(draft: CardMapDraftV1) {
  return `${JSON.stringify(draft, null, 2)}\n`;
}

export function cardMapDraftEditableSide(side: CardMapDraftSide) {
  return {
    designBoundary: side.designBoundary,
    anchors: side.anchors,
    zones: side.zones.map(({ filterAuthority: _filterAuthority, ...zone }) => zone),
  };
}

export function cardMapDraftFileName(draft: CardMapDraftV1) {
  const name = "playerName" in draft.source.identity
    ? draft.source.identity.playerName
    : draft.source.identity.cardName;
  const cardNumber = draft.source.identity.cardNumber ? `-${draft.source.identity.cardNumber}` : "";
  const slug = `${name}${cardNumber}`.normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `ten-kings-card-map-draft-${slug || draft.source.sessionId}.json`;
}
