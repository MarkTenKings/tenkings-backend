import type { SpeedsterCardProfile, SpeedsterCardSide, SpeedsterPoint, SpeedsterQuad } from "./contracts";
import type {
  SpeedsterMapRegistration,
  SpeedsterMapRegistrationFailure,
  SpeedsterMapScope,
} from "./card-type-map-contracts";
import {
  parseSpeedsterMapRegistrationFailurePayload,
  type SpeedsterMapRegistrationRequestFailure,
} from "./image-service";
import { sanitizeSpeedsterUnitQuad } from "./geometry";
import { parseSpeedsterInspectionFrame, type SpeedsterInspectionFrame } from "./inspection-frame";
import type { SpeedsterCenteringBorders } from "./scoring";
import {
  parseSpeedsterColorGeometryProposal,
  type SpeedsterColorGeometryProposal,
  type SpeedsterMatColor,
} from "./color-geometry";

export const SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION = "speedster-capture-registration-draft-v1" as const;
export const SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2 = "speedster-capture-registration-draft-v2" as const;
export const SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_CURRENT_VERSION = SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2;
export const SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_MAX_BYTES = 512 * 1024;
export const SPEEDSTER_CAPTURE_REGISTRATION_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type SpeedsterCaptureDraftSurface = "AI_GRADER" | "CARD_MAPS";
export type SpeedsterCaptureDraftMapBindingStatus = "LOADED" | "NO_MAP" | "LOOKUP_FAILED" | "INTEGRITY_ERROR";
export type SpeedsterCaptureDurableStage =
  | "MAP_REGISTRATION_INTERRUPTED"
  | "MAP_REGISTRATION_RESCUE"
  | "FRONT_CENTERING"
  | "BACK_CENTERING";

export type SpeedsterCaptureDraftCorrectedAnchor = Readonly<{
  anchorId: string;
  point: SpeedsterPoint;
}>;

type SpeedsterCaptureDraftSideBase = Readonly<{
  originalStorageKey: string;
  corners: SpeedsterQuad;
  automaticGeometry: boolean;
  geometryDiagnostic: Readonly<{
    sessionId: string;
    attemptId: number;
    side: SpeedsterCardSide;
    durationMs: number;
    corners: "present" | "null" | "unavailable";
  }>;
  rectifiedStorageKey: string;
  inspectionStorageKey: string;
  inspectionFrame: SpeedsterInspectionFrame;
  transform: readonly number[];
  viewStorageKeys: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
  proposedCentering: SpeedsterQuad;
  detectedBorders: readonly ("top" | "right" | "bottom" | "left")[];
  centering?: Readonly<{
    side: SpeedsterCardSide;
    innerQuad: SpeedsterQuad;
    borders: SpeedsterCenteringBorders;
  }>;
  mapRegistration?: SpeedsterMapRegistration;
}>;

export type SpeedsterCaptureDraftSideV1 = SpeedsterCaptureDraftSideBase;

export type SpeedsterCaptureDraftSideV2 = SpeedsterCaptureDraftSideBase & Readonly<{
  matColor: SpeedsterMatColor;
  physicalColorGeometry: SpeedsterColorGeometryProposal;
  physicalColorGeometryReceipt: string;
  printedColorGeometry: SpeedsterColorGeometryProposal;
  printedColorGeometryReceipt: string;
}>;

export type SpeedsterCaptureDraftSide = SpeedsterCaptureDraftSideV1 | SpeedsterCaptureDraftSideV2;

export type SpeedsterCaptureDraftInterruption = Readonly<{
  message: string;
  failure: SpeedsterMapRegistrationRequestFailure;
}>;

type SpeedsterCaptureRegistrationDraftFields<
  TVersion extends typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION | typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2,
  TSide extends SpeedsterCaptureDraftSide,
> = Readonly<{
  version: TVersion;
  createdAtMs: number;
  updatedAtMs: number;
  surface: SpeedsterCaptureDraftSurface;
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  mapBindingStatus: SpeedsterCaptureDraftMapBindingStatus;
  activeMapRevisionId: string | null;
  activeMapScope: SpeedsterMapScope | null;
  activeMapName: string | null;
  cornerShape: "SQUARE" | "ROUNDED_3_18_MM";
  stage: SpeedsterCaptureDurableStage;
  front: TSide;
  back: TSide;
  interruptions: Partial<Record<SpeedsterCardSide, SpeedsterCaptureDraftInterruption>>;
  failures: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistrationFailure>>;
  failureRequestIds: Partial<Record<SpeedsterCardSide, string>>;
  provisional: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistration>>;
  registrationRecordedAtMs: Partial<Record<SpeedsterCardSide, number>>;
  attemptIds: Partial<Record<SpeedsterCardSide, string>>;
  operationId: string;
  attemptNumbers: Partial<Record<SpeedsterCardSide, number>>;
  decisionIds: Readonly<{
    continue: string;
    abandonObsoleteMap: string;
    retry: Partial<Record<SpeedsterCardSide, string>>;
  }>;
  correctedAnchors: Partial<Record<SpeedsterCardSide, readonly SpeedsterCaptureDraftCorrectedAnchor[]>>;
  registrationFailureSides: Partial<Record<SpeedsterCardSide, true>>;
  mapRegistrationFailed: boolean;
  mapAuthorityAbandoned: boolean;
  captureSavePendingRetry: boolean;
  notice: string | null;
}>;

export type SpeedsterCaptureRegistrationDraftV1 = SpeedsterCaptureRegistrationDraftFields<
  typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION,
  SpeedsterCaptureDraftSideV1
>;

export type SpeedsterCaptureRegistrationDraftV2 = SpeedsterCaptureRegistrationDraftFields<
  typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2,
  SpeedsterCaptureDraftSideV2
>;

export type SpeedsterCaptureRegistrationDraft =
  | SpeedsterCaptureRegistrationDraftV1
  | SpeedsterCaptureRegistrationDraftV2;

type DraftBinding = Readonly<{
  surface: SpeedsterCaptureDraftSurface;
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  mapBindingStatus: SpeedsterCaptureDraftMapBindingStatus;
  activeMapRevisionId: string | null;
  activeMapScope: SpeedsterMapScope | null;
}>;

const SIDES = ["FRONT", "BACK"] as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((entry, index) => sameJsonValue(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]));
}

function text(value: unknown, maximum: number, minimum = 1): string | null {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum ? value : null;
}

function storageKey(value: unknown): string | null {
  const candidate = text(value, 500);
  return candidate && !/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
    && !candidate.includes("?") && !candidate.includes("#") && !/[\u0000-\u001f\u007f]/.test(candidate)
    ? candidate
    : null;
}

function finite(value: unknown, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function point(value: unknown): SpeedsterPoint | null {
  if (!isRecord(value) || !hasExactKeys(value, ["x", "y"])
    || !finite(value.x, 0, 1) || !finite(value.y, 0, 1)) return null;
  return { x: value.x, y: value.y };
}

function quad(value: unknown): SpeedsterQuad | null {
  return sanitizeSpeedsterUnitQuad(value) ?? null;
}

function stringMap(value: unknown): Partial<Record<SpeedsterCardSide, string>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, string>> = {};
  for (const side of SIDES) {
    if (value[side] === undefined) continue;
    const candidate = text(value[side], 100);
    if (!candidate) return null;
    parsed[side] = candidate;
  }
  return parsed;
}

function numberMap(value: unknown): Partial<Record<SpeedsterCardSide, number>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, number>> = {};
  for (const side of SIDES) {
    const candidate = value[side];
    if (candidate === undefined) continue;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 1 || (candidate as number) > 50) return null;
    parsed[side] = candidate as number;
  }
  return parsed;
}

function timestampMap(value: unknown, updatedAtMs: number): Partial<Record<SpeedsterCardSide, number>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, number>> = {};
  for (const side of SIDES) {
    const candidate = value[side];
    if (candidate === undefined) continue;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0 || (candidate as number) > updatedAtMs) return null;
    parsed[side] = candidate as number;
  }
  return parsed;
}

function trueMap(value: unknown): Partial<Record<SpeedsterCardSide, true>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, true>> = {};
  for (const side of SIDES) {
    if (value[side] === undefined) continue;
    if (value[side] !== true) return null;
    parsed[side] = true;
  }
  return parsed;
}

function registration(value: unknown, side: SpeedsterCardSide, revisionId: string): SpeedsterMapRegistration | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    "anchors", "currentInspectionSha256", "currentPhysicalQuadSha256", "homography",
    "mapRevisionId", "projectedDesignBoundary", "projectedZones", "side", "version",
  ], ["acceptance", "candidateProvenance", "serverReceipt"])) return null;
  if ((value.version !== "opencv-human-anchor-registration-v1" && value.version !== "opencv-redundant-ransac-registration-v2")
    || value.side !== side || value.mapRevisionId !== revisionId
    || typeof value.currentInspectionSha256 !== "string" || !SHA256.test(value.currentInspectionSha256)
    || typeof value.currentPhysicalQuadSha256 !== "string" || !SHA256.test(value.currentPhysicalQuadSha256)
    || !Array.isArray(value.homography) || value.homography.length !== 9
    || !value.homography.every((entry) => finite(entry, -1e12, 1e12))
    || !Array.isArray(value.anchors) || value.anchors.length !== 4
    || !Array.isArray(value.projectedZones) || value.projectedZones.length < 1 || value.projectedZones.length > 100
    || !isRecord(value.projectedDesignBoundary)
    || typeof value.serverReceipt !== "string" || value.serverReceipt.length < 20 || value.serverReceipt.length > 8192) return null;
  const anchorIds = new Set<string>();
  for (const candidate of value.anchors) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["anchorId", "expectedPoint", "locatedPoint", "score"])
      || !text(candidate.anchorId, 80) || !point(candidate.expectedPoint) || !point(candidate.locatedPoint)
      || !finite(candidate.score, 0, 1) || anchorIds.has(candidate.anchorId as string)) return null;
    anchorIds.add(candidate.anchorId as string);
  }
  const boundary = value.projectedDesignBoundary;
  if (boundary.kind === "FULL_BLEED") {
    if (!hasExactKeys(boundary, ["kind"])) return null;
  } else if (!hasExactKeys(boundary, ["kind", "points"])
    || boundary.kind !== "QUAD" || !Array.isArray(boundary.points)
    || boundary.points.length !== 4 || boundary.points.some((entry) => !point(entry))) return null;
  for (const zone of value.projectedZones) {
    if (!isRecord(zone) || !hasExactKeys(zone, ["id", "label", "polygon", "semanticType"], [
      "contentType", "filterAuthority", "filterAuthoritySource", "filterPaddingMm",
      "proposalConfidence", "proposalSource",
    ]) || !text(zone.id, 100) || !text(zone.label, 160)
      || !text(zone.semanticType, 80) || !Array.isArray(zone.polygon)
      || zone.polygon.length < 3 || zone.polygon.length > 100
      || zone.polygon.some((entry) => !point(entry))) return null;
    const v2Fields = [
      "contentType", "filterAuthority", "filterAuthoritySource", "filterPaddingMm",
      "proposalConfidence", "proposalSource",
    ] as const;
    const hasAnyV2Field = v2Fields.some((field) => field in zone);
    if (hasAnyV2Field && (
      !v2Fields.every((field) => field in zone)
      || !["HEADER", "ARTWORK", "SPECIES_STRIP", "ATTACK", "STATS_BAR", "ARTIST_AND_CARD_ID", "FLAVOR_TEXT", "COPYRIGHT", "OTHER"].includes(String(zone.contentType))
      || typeof zone.filterAuthority !== "boolean"
      || (zone.filterAuthoritySource !== "TYPE_DEFAULT" && zone.filterAuthoritySource !== "HUMAN_OVERRIDE")
      || zone.filterPaddingMm !== 0.6
      || !["HUMAN", "POKEMON_STANDARD_TEMPLATE", "VISUAL_SNAP", "COPIED_COMPATIBLE_MAP"].includes(String(zone.proposalSource))
      || (zone.proposalConfidence !== null && !finite(zone.proposalConfidence, 0, 1))
    )) return null;
  }
  if (value.candidateProvenance !== undefined) {
    const provenance = value.candidateProvenance;
    if (!isRecord(provenance) || !hasExactKeys(provenance, ["candidateId", "source"], ["lessonId"])
      || !text(provenance.candidateId, 100)
      || !["ORIGINAL_REFERENCE", "REGISTRATION_LESSON", "HUMAN_CORRECTION"].includes(String(provenance.source))
      || (provenance.lessonId !== undefined && !text(provenance.lessonId, 100))) return null;
  }
  if (value.acceptance !== undefined) {
    const acceptance = value.acceptance;
    if (!isRecord(acceptance) || !hasExactKeys(acceptance, [
      "featureCount", "inlierCount", "inlierFraction", "maxReprojectionErrorPx",
      "medianReprojectionErrorPx", "mode", "perAnchorFeatureCounts", "perAnchorInlierCounts",
      "policyVersion", "usableFeatureCount",
    ]) || acceptance.policyVersion !== "speedster-map-registration-acceptance-v2"
      || (acceptance.mode !== "AUTOMATIC_RANSAC" && acceptance.mode !== "HUMAN_CONFIRMED")) return null;
    for (const field of ["featureCount", "usableFeatureCount", "inlierCount"] as const) {
      if (!Number.isSafeInteger(acceptance[field]) || (acceptance[field] as number) < 0 || (acceptance[field] as number) > 10_000) return null;
    }
    if (!finite(acceptance.inlierFraction, 0, 1)
      || !finite(acceptance.medianReprojectionErrorPx, 0, 10_000)
      || !finite(acceptance.maxReprojectionErrorPx, 0, 10_000)) return null;
    for (const field of ["perAnchorFeatureCounts", "perAnchorInlierCounts"] as const) {
      if (!Array.isArray(acceptance[field]) || acceptance[field].length !== 4
        || !acceptance[field].every((entry) => Number.isSafeInteger(entry) && entry >= 0 && entry <= 10_000)) return null;
    }
  }
  return value as unknown as SpeedsterMapRegistration;
}

function failureMap(value: unknown, revisionId: string): Partial<Record<SpeedsterCardSide, SpeedsterMapRegistrationFailure>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistrationFailure>> = {};
  for (const side of SIDES) {
    if (value[side] === undefined) continue;
    const candidate = parseSpeedsterMapRegistrationFailurePayload(value[side], side);
    if (!candidate || candidate.binding.mapRevisionId !== revisionId) return null;
    parsed[side] = candidate;
  }
  return parsed;
}

function registrationMap(value: unknown, revisionId: string): Partial<Record<SpeedsterCardSide, SpeedsterMapRegistration>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistration>> = {};
  for (const side of SIDES) {
    if (value[side] === undefined) continue;
    const candidate = registration(value[side], side, revisionId);
    if (!candidate) return null;
    parsed[side] = candidate;
  }
  return parsed;
}

function interruptionMap(value: unknown): Partial<Record<SpeedsterCardSide, SpeedsterCaptureDraftInterruption>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, SpeedsterCaptureDraftInterruption>> = {};
  for (const side of SIDES) {
    const candidate = value[side];
    if (candidate === undefined) continue;
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["failure", "message"])
      || !text(candidate.message, 500) || !isRecord(candidate.failure)
      || !hasExactKeys(candidate.failure, ["code", "httpStatus", "requestId", "retryable", "source", "version"])
      || candidate.failure.version !== "speedster-map-registration-error-v1"
      || !["PROVIDER_GATEWAY", "PROVIDER", "PROVIDER_NETWORK", "TEN_KINGS_API", "CLIENT_NETWORK", "CLIENT_PROTOCOL"].includes(String(candidate.failure.source))
      || !text(candidate.failure.code, 80)
      || (candidate.failure.httpStatus !== null && (!Number.isSafeInteger(candidate.failure.httpStatus)
        || (candidate.failure.httpStatus as number) < 100 || (candidate.failure.httpStatus as number) > 599))
      || typeof candidate.failure.retryable !== "boolean"
      || (candidate.failure.requestId !== null && (typeof candidate.failure.requestId !== "string"
        || !REQUEST_ID.test(candidate.failure.requestId)))) return null;
    parsed[side] = candidate as unknown as SpeedsterCaptureDraftInterruption;
  }
  return parsed;
}

function correctedAnchorMap(
  value: unknown,
  failures: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistrationFailure>>,
): Partial<Record<SpeedsterCardSide, readonly SpeedsterCaptureDraftCorrectedAnchor[]>> | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !SIDES.includes(key as SpeedsterCardSide))) return null;
  const parsed: Partial<Record<SpeedsterCardSide, readonly SpeedsterCaptureDraftCorrectedAnchor[]>> = {};
  for (const side of SIDES) {
    const candidate = value[side];
    if (candidate === undefined) continue;
    const expectedIds = failures[side]?.bestCandidate.anchors.map(({ anchorId }) => anchorId);
    if (!expectedIds || !Array.isArray(candidate) || candidate.length !== expectedIds.length) return null;
    const anchors = candidate.map((anchor) => {
      if (!isRecord(anchor) || !hasExactKeys(anchor, ["anchorId", "point"]) || !text(anchor.anchorId, 80)) return null;
      const located = point(anchor.point);
      return located ? { anchorId: anchor.anchorId as string, point: located } : null;
    });
    if (anchors.some((anchor) => !anchor)
      || anchors.map((anchor) => anchor!.anchorId).join("\0") !== expectedIds.join("\0")) return null;
    parsed[side] = anchors as readonly SpeedsterCaptureDraftCorrectedAnchor[];
  }
  return parsed;
}

function sideState(
  value: unknown,
  side: SpeedsterCardSide,
  sessionId: string,
  revisionId: string,
  version: typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION | typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2,
): SpeedsterCaptureDraftSide | null {
  const colorKeys = [
    "matColor", "physicalColorGeometry", "physicalColorGeometryReceipt",
    "printedColorGeometry", "printedColorGeometryReceipt",
  ] as const;
  const requiredKeys = [
    "automaticGeometry", "corners", "detectedBorders", "geometryDiagnostic", "inspectionFrame",
    "inspectionStorageKey", "originalStorageKey", "proposedCentering", "rectifiedStorageKey",
    "transform", "viewStorageKeys",
    ...(version === SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2 ? colorKeys : []),
  ];
  if (!isRecord(value) || !hasExactKeys(value, requiredKeys, ["centering", "mapRegistration"])) return null;
  const corners = quad(value.corners);
  const proposedCentering = quad(value.proposedCentering);
  const inspectionFrame = parseSpeedsterInspectionFrame(value.inspectionFrame);
  if (!corners || !proposedCentering || !inspectionFrame || typeof value.automaticGeometry !== "boolean"
    || !storageKey(value.originalStorageKey) || !storageKey(value.rectifiedStorageKey)
    || !storageKey(value.inspectionStorageKey) || !Array.isArray(value.transform)
    || value.transform.length < 6 || value.transform.length > 16
    || !value.transform.every((entry) => finite(entry, -1e12, 1e12))
    || !Array.isArray(value.detectedBorders) || value.detectedBorders.some((entry) => !["top", "right", "bottom", "left"].includes(String(entry)))
    || !isRecord(value.viewStorageKeys) || !hasExactKeys(value.viewStorageKeys, ["DIRECTIONAL", "MICRO_DEFECT", "NORMALIZED"])
    || !Object.values(value.viewStorageKeys).every((entry) => Boolean(storageKey(entry)))
    || !isRecord(value.geometryDiagnostic) || !hasExactKeys(value.geometryDiagnostic, ["attemptId", "corners", "durationMs", "sessionId", "side"])
    || value.geometryDiagnostic.sessionId !== sessionId || value.geometryDiagnostic.side !== side
    || !Number.isSafeInteger(value.geometryDiagnostic.attemptId) || (value.geometryDiagnostic.attemptId as number) < 1
    || !finite(value.geometryDiagnostic.durationMs, 0, 60 * 60 * 1000)
    || !["present", "null", "unavailable"].includes(String(value.geometryDiagnostic.corners))) return null;
  const mapRegistration = value.mapRegistration === undefined ? undefined : registration(value.mapRegistration, side, revisionId);
  if (value.mapRegistration !== undefined && !mapRegistration) return null;
  let colorFields: Pick<SpeedsterCaptureDraftSideV2,
    "matColor" | "physicalColorGeometry" | "physicalColorGeometryReceipt"
    | "printedColorGeometry" | "printedColorGeometryReceipt"> | undefined;
  if (version === SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2) {
    const matColor = value.matColor === "BLACK" || value.matColor === "WHITE" || value.matColor === "MAGENTA"
      ? value.matColor
      : null;
    const physicalReceipt = text(value.physicalColorGeometryReceipt, 8192, 20);
    const printedReceipt = text(value.printedColorGeometryReceipt, 8192, 20);
    if (!matColor || !physicalReceipt || !printedReceipt) return null;
    try {
      colorFields = {
        matColor,
        physicalColorGeometry: parseSpeedsterColorGeometryProposal(value.physicalColorGeometry, {
          mode: "PHYSICAL_OUTER",
          matColor,
        }),
        physicalColorGeometryReceipt: physicalReceipt,
        printedColorGeometry: parseSpeedsterColorGeometryProposal(value.printedColorGeometry, {
          mode: "PRINTED_FRAME",
          matColor,
        }),
        printedColorGeometryReceipt: printedReceipt,
      };
    } catch {
      return null;
    }
  }
  let centering: SpeedsterCaptureDraftSide["centering"];
  if (value.centering !== undefined) {
    if (!isRecord(value.centering) || !hasExactKeys(value.centering, ["borders", "innerQuad", "side"])
      || value.centering.side !== side || !isRecord(value.centering.borders)) return null;
    const innerQuad = quad(value.centering.innerQuad);
    if (!innerQuad || !hasExactKeys(value.centering.borders, ["bottomMm", "leftMm", "rightMm", "topMm"])
      || !Object.values(value.centering.borders).every((entry) => finite(entry, 0, 100))) return null;
    centering = { side, innerQuad, borders: value.centering.borders as SpeedsterCenteringBorders };
  }
  return {
    originalStorageKey: value.originalStorageKey as string,
    corners,
    automaticGeometry: value.automaticGeometry,
    geometryDiagnostic: value.geometryDiagnostic as SpeedsterCaptureDraftSide["geometryDiagnostic"],
    rectifiedStorageKey: value.rectifiedStorageKey as string,
    inspectionStorageKey: value.inspectionStorageKey as string,
    inspectionFrame,
    transform: value.transform as number[],
    viewStorageKeys: value.viewStorageKeys as SpeedsterCaptureDraftSide["viewStorageKeys"],
    proposedCentering,
    detectedBorders: value.detectedBorders as SpeedsterCaptureDraftSide["detectedBorders"],
    ...(colorFields ?? {}),
    ...(centering ? { centering } : {}),
    ...(mapRegistration ? { mapRegistration } : {}),
  };
}

export function speedsterCaptureRegistrationDraftStorageKey(sessionId: string) {
  return `tenkings:speedster:capture-registration-draft:v1:${sessionId}`;
}

export function parseSpeedsterCaptureRegistrationDraft(serialized: string, binding: DraftBinding): SpeedsterCaptureRegistrationDraft | null {
  if (new TextEncoder().encode(serialized).byteLength > SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_MAX_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return null; }
  if (!isRecord(value) || !hasExactKeys(value, [
    "activeMapName", "activeMapRevisionId", "activeMapScope", "attemptIds", "attemptNumbers",
    "back", "cardProfile", "correctedAnchors", "cornerShape", "decisionIds", "failureRequestIds",
    "captureSavePendingRetry", "failures", "front", "interruptions", "mapAuthorityAbandoned", "mapBindingStatus", "mapRegistrationFailed", "notice", "operationId",
    "createdAtMs", "provisional", "registrationFailureSides", "registrationRecordedAtMs", "sessionId", "stage", "surface",
    "updatedAtMs", "version",
  ])) return null;
  if ((value.version !== SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION
      && value.version !== SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2)
    || value.surface !== binding.surface || value.sessionId !== binding.sessionId
    || value.cardProfile !== binding.cardProfile || value.mapBindingStatus !== binding.mapBindingStatus
    || value.activeMapRevisionId !== binding.activeMapRevisionId || value.activeMapScope !== binding.activeMapScope
    || !["LOADED", "NO_MAP", "LOOKUP_FAILED", "INTEGRITY_ERROR"].includes(String(value.mapBindingStatus))
    || (value.mapBindingStatus === "LOADED"
      ? (typeof value.activeMapRevisionId !== "string" || !text(value.activeMapRevisionId, 200)
        || (value.activeMapScope !== "EXACT" && value.activeMapScope !== "FAMILY"))
      : value.activeMapRevisionId !== null || value.activeMapScope !== null)
    || (value.activeMapName !== null && !text(value.activeMapName, 240))
    || !Number.isSafeInteger(value.createdAtMs) || (value.createdAtMs as number) < 0
    || !Number.isSafeInteger(value.updatedAtMs) || (value.updatedAtMs as number) < (value.createdAtMs as number)
    || (value.createdAtMs as number) > Date.now() + SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_FUTURE_SKEW_MS
    || (value.updatedAtMs as number) > Date.now() + SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_FUTURE_SKEW_MS
    || !["MAP_REGISTRATION_INTERRUPTED", "MAP_REGISTRATION_RESCUE", "FRONT_CENTERING", "BACK_CENTERING"].includes(String(value.stage))
    || (value.cornerShape !== "SQUARE" && value.cornerShape !== "ROUNDED_3_18_MM")
    || typeof value.mapRegistrationFailed !== "boolean" || typeof value.mapAuthorityAbandoned !== "boolean"
    || typeof value.captureSavePendingRetry !== "boolean"
    || (value.notice !== null && !text(value.notice, 1000))
    || typeof value.operationId !== "string" || !UUID.test(value.operationId)) return null;
  const revisionId = typeof value.activeMapRevisionId === "string" ? value.activeMapRevisionId : "";
  const version = value.version as typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION
    | typeof SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2;
  const front = sideState(value.front, "FRONT", binding.sessionId, revisionId, version);
  const back = sideState(value.back, "BACK", binding.sessionId, revisionId, version);
  const interruptions = interruptionMap(value.interruptions);
  const failures = failureMap(value.failures, revisionId);
  const failureRequestIds = stringMap(value.failureRequestIds);
  const provisional = registrationMap(value.provisional, revisionId);
  const registrationRecordedAtMs = timestampMap(value.registrationRecordedAtMs, value.updatedAtMs as number);
  const attemptIds = stringMap(value.attemptIds);
  const attemptNumbers = numberMap(value.attemptNumbers);
  const registrationFailureSides = trueMap(value.registrationFailureSides);
  if (!front || !back || !interruptions || !failures || !failureRequestIds || !provisional || !registrationRecordedAtMs
    || !attemptIds || !attemptNumbers || !registrationFailureSides || !isRecord(value.decisionIds)
    || !hasExactKeys(value.decisionIds, ["abandonObsoleteMap", "continue", "retry"])
    || typeof value.decisionIds.continue !== "string" || !UUID.test(value.decisionIds.continue)
    || typeof value.decisionIds.abandonObsoleteMap !== "string" || !UUID.test(value.decisionIds.abandonObsoleteMap)) return null;
  const retry = stringMap(value.decisionIds.retry);
  if (!retry || Object.values(retry).some((id) => !UUID.test(id))) return null;
  const correctedAnchors = correctedAnchorMap(value.correctedAnchors, failures);
  if (!correctedAnchors) return null;
  const unresolved = Boolean(interruptions.FRONT || interruptions.BACK || failures.FRONT || failures.BACK);
  const registeredSides = SIDES.filter((side) => provisional[side]
    || (side === "FRONT" ? front.mapRegistration : back.mapRegistration));
  const interruptionSides = SIDES.filter((side) => interruptions[side]);
  const failureSides = SIDES.filter((side) => failures[side]);
  const attemptIdSides = SIDES.filter((side) => attemptIds[side]);
  const retryDecisionSides = SIDES.filter((side) => retry[side]);
  const recordedFailureSides = SIDES.filter((side) => registrationFailureSides[side]);
  const centeringStage = value.stage === "FRONT_CENTERING" || value.stage === "BACK_CENTERING";
  const loadedCenteringRegistrationIsCoherent = registeredSides.length === 2
    ? recordedFailureSides.length === 0 && value.mapRegistrationFailed === false && value.mapAuthorityAbandoned === false
    : registeredSides.length === 0 && (
      (recordedFailureSides.length > 0 && value.mapRegistrationFailed === true && value.mapAuthorityAbandoned === false)
      || (recordedFailureSides.length === 0 && value.mapRegistrationFailed === false && value.mapAuthorityAbandoned === true)
    );
  if ((value.stage === "MAP_REGISTRATION_INTERRUPTED" && !(interruptions.FRONT || interruptions.BACK))
    || (value.stage === "MAP_REGISTRATION_RESCUE" && !(failures.FRONT || failures.BACK))
    || (value.stage === "MAP_REGISTRATION_INTERRUPTED"
      && (interruptionSides.join("\0") !== retryDecisionSides.join("\0")))
    || (value.stage === "MAP_REGISTRATION_RESCUE"
      && (Boolean(interruptions.FRONT || interruptions.BACK)
        || failureSides.join("\0") !== attemptIdSides.join("\0")
        || attemptIdSides.some((side) => !UUID.test(attemptIds[side]!))))
    || (value.stage !== "MAP_REGISTRATION_RESCUE" && attemptIdSides.length > 0)
    || (value.stage !== "MAP_REGISTRATION_INTERRUPTED" && retryDecisionSides.length > 0)
    || SIDES.some((side) => (interruptions[side] || failures[side])
      && (provisional[side] || (side === "FRONT" ? front.mapRegistration : back.mapRegistration)))
    || SIDES.some((side) => interruptions[side] && failures[side])
    || ((value.stage === "FRONT_CENTERING" || value.stage === "BACK_CENTERING") && unresolved)
    || (value.stage === "FRONT_CENTERING" && Boolean(front.centering || back.centering))
    || (value.stage === "BACK_CENTERING" && (!front.centering
    || (value.captureSavePendingRetry ? !back.centering : Boolean(back.centering))))
    || (value.stage !== "BACK_CENTERING" && value.captureSavePendingRetry)
    || (value.mapBindingStatus !== "LOADED" && (unresolved || registeredSides.length > 0
      || value.stage === "MAP_REGISTRATION_INTERRUPTED" || value.stage === "MAP_REGISTRATION_RESCUE"))
    || (value.mapAuthorityAbandoned && (registeredSides.length > 0 || unresolved
      || recordedFailureSides.length > 0 || value.mapRegistrationFailed))
    || (centeringStage && value.mapBindingStatus === "LOADED" && !loadedCenteringRegistrationIsCoherent)
    || (centeringStage && value.mapBindingStatus !== "LOADED"
      && (recordedFailureSides.length > 0 || value.mapRegistrationFailed))
    || (provisional.FRONT && front.mapRegistration && !sameJsonValue(provisional.FRONT, front.mapRegistration))
    || (provisional.BACK && back.mapRegistration && !sameJsonValue(provisional.BACK, back.mapRegistration))
    || registeredSides.some((side) => registrationRecordedAtMs[side] === undefined)
    || SIDES.some((side) => registrationRecordedAtMs[side] !== undefined && !registeredSides.includes(side))) return null;
  return {
    version,
    createdAtMs: value.createdAtMs as number,
    updatedAtMs: value.updatedAtMs as number,
    surface: binding.surface,
    sessionId: binding.sessionId,
    cardProfile: binding.cardProfile,
    mapBindingStatus: binding.mapBindingStatus,
    activeMapRevisionId: binding.activeMapRevisionId,
    activeMapScope: binding.activeMapScope,
    activeMapName: value.activeMapName as string | null,
    cornerShape: value.cornerShape,
    stage: value.stage as SpeedsterCaptureDurableStage,
    front,
    back,
    interruptions,
    failures,
    failureRequestIds,
    provisional,
    registrationRecordedAtMs,
    attemptIds,
    operationId: value.operationId,
    attemptNumbers,
    decisionIds: {
      continue: value.decisionIds.continue,
      abandonObsoleteMap: value.decisionIds.abandonObsoleteMap,
      retry,
    },
    correctedAnchors,
    registrationFailureSides,
    mapRegistrationFailed: value.mapRegistrationFailed,
    mapAuthorityAbandoned: value.mapAuthorityAbandoned,
    captureSavePendingRetry: value.captureSavePendingRetry,
    notice: value.notice as string | null,
  } as SpeedsterCaptureRegistrationDraft;
}

export function readSpeedsterCaptureRegistrationDraft(storage: Storage, binding: DraftBinding) {
  const serialized = storage.getItem(speedsterCaptureRegistrationDraftStorageKey(binding.sessionId));
  return serialized ? parseSpeedsterCaptureRegistrationDraft(serialized, binding) : null;
}

export function readSpeedsterCaptureRegistrationDraftForCommittedSession(
  storage: Storage,
  binding: Pick<DraftBinding, "surface" | "sessionId" | "cardProfile">,
) {
  const serialized = storage.getItem(speedsterCaptureRegistrationDraftStorageKey(binding.sessionId));
  if (!serialized) return null;
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return null; }
  if (!isRecord(value)
    || !["LOADED", "NO_MAP", "LOOKUP_FAILED", "INTEGRITY_ERROR"].includes(String(value.mapBindingStatus))) return null;
  const activeMapRevisionId = typeof value.activeMapRevisionId === "string"
    ? value.activeMapRevisionId
    : value.activeMapRevisionId === null ? null : undefined;
  const activeMapScope = value.activeMapScope === "EXACT" || value.activeMapScope === "FAMILY"
    ? value.activeMapScope
    : value.activeMapScope === null ? null : undefined;
  if (activeMapRevisionId === undefined || activeMapScope === undefined) return null;
  return parseSpeedsterCaptureRegistrationDraft(serialized, {
    ...binding,
    mapBindingStatus: value.mapBindingStatus as SpeedsterCaptureDraftMapBindingStatus,
    activeMapRevisionId,
    activeMapScope,
  });
}

type PersistedCommittedCapture = Readonly<{
  workflowState?: unknown;
  capture?: unknown;
  mapRevisionId?: unknown;
  mapRegistration?: unknown;
}>;

function committedCaptureSide(side: SpeedsterCaptureDraftSide) {
  if (!side.centering) return null;
  return {
    originalStorageKey: side.originalStorageKey,
    rectifiedStorageKey: side.rectifiedStorageKey,
    inspectionStorageKey: side.inspectionStorageKey,
    inspectionFrame: side.inspectionFrame,
    viewStorageKeys: side.viewStorageKeys,
    sourceCorners: side.corners,
    transform: side.transform,
    centeringQuad: side.centering.innerQuad,
    centeringBorders: side.centering.borders,
  };
}

function unsignedRegistration(registration: SpeedsterMapRegistration) {
  const { serverReceipt: _serverReceipt, ...unsigned } = registration;
  return unsigned;
}

export function speedsterCaptureDraftMatchesCommittedSession(
  draft: SpeedsterCaptureRegistrationDraft,
  session: PersistedCommittedCapture,
) {
  if (session.workflowState !== "CAPTURED" || draft.stage !== "BACK_CENTERING"
    || !draft.captureSavePendingRetry) return false;
  const front = committedCaptureSide(draft.front);
  const back = committedCaptureSide(draft.back);
  if (!front || !back || !sameJsonValue(session.capture, {
    cornerShape: draft.cornerShape,
    front,
    back,
  })) return false;

  const frontRegistration = draft.front.mapRegistration;
  const backRegistration = draft.back.mapRegistration;
  if (frontRegistration || backRegistration) {
    return Boolean(frontRegistration && backRegistration
      && draft.activeMapRevisionId
      && session.mapRevisionId === draft.activeMapRevisionId
      && sameJsonValue(session.mapRegistration, {
        front: unsignedRegistration(frontRegistration),
        back: unsignedRegistration(backRegistration),
      }));
  }
  return !draft.provisional.FRONT && !draft.provisional.BACK
    && (session.mapRevisionId === null || session.mapRevisionId === undefined)
    && (session.mapRegistration === null || session.mapRegistration === undefined);
}

export function writeSpeedsterCaptureRegistrationDraft(storage: Storage, draft: SpeedsterCaptureRegistrationDraft) {
  const serialized = JSON.stringify(draft);
  if (new TextEncoder().encode(serialized).byteLength > SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_MAX_BYTES) {
    throw new Error("The preserved capture draft exceeds the 512 KB safety limit.");
  }
  storage.setItem(speedsterCaptureRegistrationDraftStorageKey(draft.sessionId), serialized);
}

export function removeSpeedsterCaptureRegistrationDraft(storage: Storage, sessionId: string) {
  storage.removeItem(speedsterCaptureRegistrationDraftStorageKey(sessionId));
}

export function speedsterCaptureDraftExpiredRegistrationSides(
  draft: SpeedsterCaptureRegistrationDraft,
  nowMs = Date.now(),
): readonly SpeedsterCardSide[] {
  return SIDES.filter((side) => {
    const registration = draft.provisional[side]
      ?? (side === "FRONT" ? draft.front.mapRegistration : draft.back.mapRegistration);
    if (!registration) return false;
    const recordedAtMs = draft.registrationRecordedAtMs[side];
    return recordedAtMs === undefined
      || recordedAtMs > nowMs + SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_FUTURE_SKEW_MS
      || nowMs - recordedAtMs > SPEEDSTER_CAPTURE_REGISTRATION_RECEIPT_MAX_AGE_MS;
  });
}
