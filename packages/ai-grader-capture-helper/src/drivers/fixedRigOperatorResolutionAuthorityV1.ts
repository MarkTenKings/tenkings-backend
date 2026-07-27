import { createHash } from "node:crypto";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  mathematicalScoreV1Schema,
  type MathematicalGradingElementV1,
} from "@tenkings/shared";
import {
  FIXED_RIG_STANDARD_TRADING_CARD_HEIGHT_MM,
  FIXED_RIG_STANDARD_TRADING_CARD_WIDTH_MM,
} from "./fixedRigStandardCardFormatV1";

export const FIXED_RIG_OPERATOR_RESOLUTION_AUTHORITY_V1_VERSION =
  "operator_resolution_authority_v1" as const;
export const FIXED_RIG_OPERATOR_RESOLUTION_REQUEST_V1_VERSION =
  "operator_resolution_request_v1" as const;
export const FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION =
  "operator_resolution_submission_v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const PUBLIC_FORBIDDEN = /(?:provisional|insufficient|human|manual|exception|admission)/i;
const CONTROL_CHARACTER = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;
const MM_ORDER = ["left", "right", "top", "bottom"] as const;

type Side = "front" | "back";
type JsonRecord = Record<string, unknown>;

export interface FixedRigOperatorResolutionNativeRoleV1 {
  captureRole: string;
  sha256: string;
}

export interface FixedRigOperatorResolutionSideBindingV1 {
  rawAllOnAssetId: string;
  rawAllOnSha256: string;
  normalizedAllOnAssetId: string;
  normalizedAllOnSha256: string;
  rawToNormalizedTransformSha256: string;
  authenticatedOuterCutArtifactSha256: string;
  warmManifestSha256: string;
  nativeRoles: FixedRigOperatorResolutionNativeRoleV1[];
  nativeRoleLedgerSha256: string;
}

export interface FixedRigOperatorResolutionBindingV1 {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  cardIdentitySha256: string;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationArtifactSha256: string;
  calibrationBundleManifestSha256: string;
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  sides: Record<Side, FixedRigOperatorResolutionSideBindingV1>;
}

export interface FixedRigOperatorResolutionOriginalElementV1 {
  status: "computed" | "insufficient_evidence";
  score: number | null;
  explanation: string | null;
  failureReasons: string[];
  resultSha256: string;
}

export interface FixedRigOperatorResolutionRequestV1 {
  schemaVersion: typeof FIXED_RIG_OPERATOR_RESOLUTION_REQUEST_V1_VERSION;
  generatedAt: string;
  binding: FixedRigOperatorResolutionBindingV1;
  originalElements: Record<MathematicalGradingElementV1, FixedRigOperatorResolutionOriginalElementV1>;
  hashPolicy: "sha256-canonical-json-with-requestSha256-omitted";
  requestSha256: string;
}

export interface FixedRigOperatorCenteringResolutionSubmissionV1 {
  element: "centering";
  publicExplanation: string;
  internalReason: string;
  measurements: {
    unit: "mm";
    order: typeof MM_ORDER;
    front: [number, number, number, number];
    back: [number, number, number, number];
    segments?: FixedRigOperatorCenteringMeasurementSegmentsV1;
  };
}

export interface FixedRigOperatorCenteringMeasurementSegmentV1 {
  margin: (typeof MM_ORDER)[number];
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface FixedRigOperatorCenteringMeasurementSegmentsV1 {
  coordinateFrame: "normalized_card_portrait_pixels";
  widthPx: 1200;
  heightPx: 1680;
  order: typeof MM_ORDER;
  front: [
    FixedRigOperatorCenteringMeasurementSegmentV1,
    FixedRigOperatorCenteringMeasurementSegmentV1,
    FixedRigOperatorCenteringMeasurementSegmentV1,
    FixedRigOperatorCenteringMeasurementSegmentV1,
  ];
  back: [
    FixedRigOperatorCenteringMeasurementSegmentV1,
    FixedRigOperatorCenteringMeasurementSegmentV1,
    FixedRigOperatorCenteringMeasurementSegmentV1,
    FixedRigOperatorCenteringMeasurementSegmentV1,
  ];
}

export interface FixedRigOperatorScoredResolutionSubmissionV1 {
  element: "corners" | "edges" | "surface";
  score: number;
  publicExplanation: string;
  internalReason: string;
}

export type FixedRigOperatorElementResolutionSubmissionV1 =
  | FixedRigOperatorCenteringResolutionSubmissionV1
  | FixedRigOperatorScoredResolutionSubmissionV1;

export interface FixedRigOperatorResolutionSubmissionV1 {
  schemaVersion: typeof FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION;
  requestSha256: string;
  operatorConfirmed: true;
  resolutions: FixedRigOperatorElementResolutionSubmissionV1[];
}

export type FixedRigOperatorElementResolutionAuthorityV1 =
  FixedRigOperatorElementResolutionSubmissionV1 & {
    original: FixedRigOperatorResolutionOriginalElementV1;
  };

export interface FixedRigOperatorResolutionAuthorityV1 {
  schemaVersion: typeof FIXED_RIG_OPERATOR_RESOLUTION_AUTHORITY_V1_VERSION;
  revision: number;
  supersedesAuthoritySha256: string | null;
  requestSha256: string;
  operatorId: string;
  authenticatedAt: string;
  binding: FixedRigOperatorResolutionBindingV1;
  resolutions: FixedRigOperatorElementResolutionAuthorityV1[];
  hashPolicy: "sha256-canonical-json-with-authoritySha256-omitted";
  authoritySha256: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function canonical(value: unknown): string {
  if (value === undefined) throw new Error("Canonical resolution values cannot contain undefined.");
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Canonical resolution values cannot contain non-finite numbers.");
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function hashFixedRigOperatorResolutionValueV1(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256.`);
  }
  return value;
}

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new Error(`${label} must be a bounded exact identifier.`);
  }
  return value;
}

function exactTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 ||
      value.length > maximum || CONTROL_CHARACTER.test(value)) {
    throw new Error(`${label} must be nonblank, trimmed, printable text of at most ${maximum} characters.`);
  }
  return value;
}

export function validateFixedRigOperatorPublicExplanationV1(value: unknown): string {
  const text = boundedText(value, "publicExplanation", 1000);
  if (PUBLIC_FORBIDDEN.test(text)) {
    throw new Error("publicExplanation contains a prohibited workflow or disclosure term.");
  }
  return text;
}

function exactScore(value: unknown, label: string): number {
  if (typeof value !== "number" || !mathematicalScoreV1Schema.safeParse(value).success) {
    throw new Error(`${label} must be a finite numeric score from 1.00 through 10.00 with at most two decimals.`);
  }
  return value;
}

function exactMillimeters(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative millimeter measurement.`);
  }
  return value;
}

function exactCoordinate(
  value: unknown,
  maximum: number,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < 0 || value > maximum) {
    throw new Error(`${label} must be a finite normalized-card pixel coordinate.`);
  }
  return value;
}

function centeringMeasurementSegments(
  value: unknown,
  measured: Record<Side, [number, number, number, number]>,
  cardDimensionsMm: { width: number; height: number },
): FixedRigOperatorCenteringMeasurementSegmentsV1 {
  if (!isRecord(value)) throw new Error("Centering measurement segments must be an exact object.");
  exactKeys(
    value,
    ["coordinateFrame", "widthPx", "heightPx", "order", "front", "back"],
    "Centering measurement segments",
  );
  if (value.coordinateFrame !== "normalized_card_portrait_pixels" ||
      value.widthPx !== 1200 || value.heightPx !== 1680 ||
      !Array.isArray(value.order) || value.order.length !== MM_ORDER.length ||
      value.order.some((entry, index) => entry !== MM_ORDER[index])) {
    throw new Error(
      "Centering measurement segments require the exact canonical 1200x1680 normalized-card frame and margin order.",
    );
  }
  const result = {} as Pick<
    FixedRigOperatorCenteringMeasurementSegmentsV1,
    "front" | "back"
  >;
  for (const side of ["front", "back"] as const) {
    const raw = value[side];
    if (!Array.isArray(raw) || raw.length !== MM_ORDER.length) {
      throw new Error(`${side} centering requires exactly four measurement segments.`);
    }
    result[side] = raw.map((candidate, index) => {
      const margin = MM_ORDER[index];
      if (!isRecord(candidate)) {
        throw new Error(`${side} ${margin} measurement segment must be exact.`);
      }
      exactKeys(candidate, ["margin", "start", "end"], `${side} ${margin} measurement segment`);
      if (candidate.margin !== margin ||
          !isRecord(candidate.start) || !isRecord(candidate.end)) {
        throw new Error(`${side} ${margin} measurement segment has an invalid margin or point.`);
      }
      exactKeys(candidate.start, ["x", "y"], `${side} ${margin} segment start`);
      exactKeys(candidate.end, ["x", "y"], `${side} ${margin} segment end`);
      const start = {
        x: exactCoordinate(candidate.start.x, 1200, `${side} ${margin} start x`),
        y: exactCoordinate(candidate.start.y, 1680, `${side} ${margin} start y`),
      };
      const end = {
        x: exactCoordinate(candidate.end.x, 1200, `${side} ${margin} end x`),
        y: exactCoordinate(candidate.end.y, 1680, `${side} ${margin} end y`),
      };
      const horizontal = margin === "left" || margin === "right";
      if ((horizontal && start.y !== end.y) || (!horizontal && start.x !== end.x)) {
        throw new Error(`${side} ${margin} measurement segment must be perpendicular to its margin.`);
      }
      const pixels = Math.abs(horizontal ? end.x - start.x : end.y - start.y);
      const segmentMm = pixels *
        (horizontal ? cardDimensionsMm.width / 1200 : cardDimensionsMm.height / 1680);
      if (pixels <= 0 || Math.abs(segmentMm - measured[side][index]) > 0.011) {
        throw new Error(
          `${side} ${margin} measurement segment does not reproduce its submitted millimeter value.`,
        );
      }
      return { margin, start, end };
    }) as FixedRigOperatorCenteringMeasurementSegmentsV1[typeof side];
  }
  return {
    coordinateFrame: "normalized_card_portrait_pixels",
    widthPx: 1200,
    heightPx: 1680,
    order: MM_ORDER,
    front: result.front,
    back: result.back,
  };
}

function measurements(
  value: unknown,
  cardWidthMm: number,
  cardHeightMm: number,
): FixedRigOperatorCenteringResolutionSubmissionV1["measurements"] {
  if (!isRecord(value)) throw new Error("Centering measurements must be an exact object.");
  exactKeys(
    value,
    value.segments === undefined
      ? ["unit", "order", "front", "back"]
      : ["unit", "order", "front", "back", "segments"],
    "Centering measurements",
  );
  if (value.unit !== "mm" || !Array.isArray(value.order) ||
      value.order.length !== MM_ORDER.length ||
      value.order.some((entry, index) => entry !== MM_ORDER[index])) {
    throw new Error("Centering measurements require millimeters in exact left/right/top/bottom order.");
  }
  const result = {} as Record<Side, [number, number, number, number]>;
  for (const side of ["front", "back"] as const) {
    const raw = value[side];
    if (!Array.isArray(raw) || raw.length !== 4) {
      throw new Error(`${side} centering requires exactly four millimeter measurements.`);
    }
    const parsed = raw.map((entry, index) =>
      exactMillimeters(entry, `${side} ${MM_ORDER[index]} measurement`)) as
      [number, number, number, number];
    if (parsed[0] + parsed[1] >= cardWidthMm || parsed[2] + parsed[3] >= cardHeightMm) {
      throw new Error(`${side} centering measurements are physically impossible for the bound card format.`);
    }
    result[side] = parsed;
  }
  return {
    unit: "mm",
    order: MM_ORDER,
    front: result.front,
    back: result.back,
    ...(value.segments === undefined
      ? {}
      : {
          segments: centeringMeasurementSegments(
            value.segments,
            result,
            { width: cardWidthMm, height: cardHeightMm },
          ),
        }),
  };
}

export function parseFixedRigOperatorResolutionSubmissionV1(
  value: unknown,
  cardDimensionsMm: { width: number; height: number },
): FixedRigOperatorResolutionSubmissionV1 {
  if (!isRecord(value)) throw new Error("Operator resolution submission must be an exact object.");
  exactKeys(
    value,
    ["schemaVersion", "requestSha256", "operatorConfirmed", "resolutions"],
    "Operator resolution submission",
  );
  if (value.schemaVersion !== FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION ||
      value.operatorConfirmed !== true || !Array.isArray(value.resolutions) ||
      value.resolutions.length > 4) {
    throw new Error("Operator resolution submission has an invalid version, confirmation, or element count.");
  }
  const seen = new Set<MathematicalGradingElementV1>();
  const resolutions = value.resolutions.map((candidate, index): FixedRigOperatorElementResolutionSubmissionV1 => {
    if (!isRecord(candidate)) throw new Error(`Resolution ${index + 1} must be an exact object.`);
    const element = candidate.element;
    if (element !== "centering" && element !== "corners" &&
        element !== "edges" && element !== "surface") {
      throw new Error(`Resolution ${index + 1} has an invalid element.`);
    }
    if (seen.has(element)) throw new Error(`Duplicate resolution for ${element}.`);
    seen.add(element);
    if (element === "centering") {
      exactKeys(
        candidate,
        ["element", "publicExplanation", "internalReason", "measurements"],
        "Centering resolution",
      );
      return {
        element,
        publicExplanation: validateFixedRigOperatorPublicExplanationV1(candidate.publicExplanation),
        internalReason: boundedText(candidate.internalReason, "internalReason", 2000),
        measurements: measurements(
          candidate.measurements,
          cardDimensionsMm.width,
          cardDimensionsMm.height,
        ),
      };
    }
    exactKeys(
      candidate,
      ["element", "score", "publicExplanation", "internalReason"],
      `${element} resolution`,
    );
    return {
      element,
      score: exactScore(candidate.score, `${element} score`),
      publicExplanation: validateFixedRigOperatorPublicExplanationV1(candidate.publicExplanation),
      internalReason: boundedText(candidate.internalReason, "internalReason", 2000),
    };
  });
  return {
    schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
    requestSha256: exactSha(value.requestSha256, "requestSha256"),
    operatorConfirmed: true,
    resolutions,
  };
}

function validateOriginal(
  value: unknown,
  label: string,
): FixedRigOperatorResolutionOriginalElementV1 {
  if (!isRecord(value)) throw new Error(`${label} original result must be an exact object.`);
  exactKeys(
    value,
    ["status", "score", "explanation", "failureReasons", "resultSha256"],
    `${label} original result`,
  );
  if (value.status !== "computed" && value.status !== "insufficient_evidence") {
    throw new Error(`${label} has an invalid original status.`);
  }
  if (value.status === "computed") {
    if (value.score === null) {
      throw new Error(`${label} computed original score must be numeric.`);
    }
    exactScore(value.score, `${label} original score`);
  } else if (value.score !== null) {
    throw new Error(`${label} insufficient original score must be null.`);
  }
  if (value.explanation !== null) boundedText(value.explanation, `${label} original explanation`, 4000);
  if (!Array.isArray(value.failureReasons) ||
      value.failureReasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
    throw new Error(`${label} original failures are malformed.`);
  }
  exactSha(value.resultSha256, `${label} original resultSha256`);
  return {
    status: value.status,
    score: value.score as number | null,
    explanation: value.explanation as string | null,
    failureReasons: [...value.failureReasons] as string[],
    resultSha256: value.resultSha256 as string,
  };
}

function validateBinding(
  value: unknown,
): FixedRigOperatorResolutionBindingV1 {
  if (!isRecord(value)) throw new Error("Operator resolution binding must be an exact object.");
  exactKeys(value, [
    "queueItemId",
    "gradingSessionId",
    "reportId",
    "cardIdentitySha256",
    "calibrationProfileId",
    "calibrationVersion",
    "calibrationArtifactSha256",
    "calibrationBundleManifestSha256",
    "thresholdSetId",
    "thresholdSetHash",
    "sides",
  ], "Operator resolution binding");
  const queueItemId = exactId(value.queueItemId, "binding queueItemId");
  const gradingSessionId = exactId(value.gradingSessionId, "binding gradingSessionId");
  const reportId = exactId(value.reportId, "binding reportId");
  const cardIdentitySha256 = exactSha(value.cardIdentitySha256, "binding cardIdentitySha256");
  const calibrationProfileId = exactId(value.calibrationProfileId, "binding calibrationProfileId");
  const calibrationVersion = exactId(value.calibrationVersion, "binding calibrationVersion");
  const calibrationArtifactSha256 =
    exactSha(value.calibrationArtifactSha256, "binding calibrationArtifactSha256");
  const calibrationBundleManifestSha256 =
    exactSha(value.calibrationBundleManifestSha256, "binding calibrationBundleManifestSha256");
  if (value.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      value.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH) {
    throw new Error("Operator resolution binding has a mismatched grading threshold identity.");
  }
  if (!isRecord(value.sides)) throw new Error("Operator resolution binding requires exact side bindings.");
  exactKeys(value.sides, ["front", "back"], "Operator resolution side bindings");
  const sides = {} as Record<Side, FixedRigOperatorResolutionSideBindingV1>;
  for (const side of ["front", "back"] as const) {
    const candidate = value.sides[side];
    if (!isRecord(candidate)) throw new Error(`${side} resolution side binding must be exact.`);
    exactKeys(candidate, [
      "rawAllOnAssetId",
      "rawAllOnSha256",
      "normalizedAllOnAssetId",
      "normalizedAllOnSha256",
      "rawToNormalizedTransformSha256",
      "authenticatedOuterCutArtifactSha256",
      "warmManifestSha256",
      "nativeRoles",
      "nativeRoleLedgerSha256",
    ], `${side} resolution side binding`);
    if (!Array.isArray(candidate.nativeRoles) || candidate.nativeRoles.length !== 35) {
      throw new Error(`${side} resolution binding requires exactly 35 native capture roles.`);
    }
    const nativeRoles = candidate.nativeRoles.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${side} native role ${index + 1} must be exact.`);
      exactKeys(entry, ["captureRole", "sha256"], `${side} native role ${index + 1}`);
      return {
        captureRole: exactId(entry.captureRole, `${side} native captureRole ${index + 1}`),
        sha256: exactSha(entry.sha256, `${side} native role SHA-256 ${index + 1}`),
      };
    });
    if (new Set(nativeRoles.map((entry) => entry.captureRole)).size !== nativeRoles.length ||
        new Set(nativeRoles.map((entry) => entry.sha256)).size !== nativeRoles.length) {
      throw new Error(`${side} resolution binding contains aliased native roles or hashes.`);
    }
    const nativeRoleLedgerSha256 =
      exactSha(candidate.nativeRoleLedgerSha256, `${side} nativeRoleLedgerSha256`);
    if (hashFixedRigOperatorResolutionValueV1(nativeRoles) !== nativeRoleLedgerSha256) {
      throw new Error(`${side} native role ledger hash does not reproduce.`);
    }
    sides[side] = {
      rawAllOnAssetId: exactId(candidate.rawAllOnAssetId, `${side} rawAllOnAssetId`),
      rawAllOnSha256: exactSha(candidate.rawAllOnSha256, `${side} rawAllOnSha256`),
      normalizedAllOnAssetId:
        exactId(candidate.normalizedAllOnAssetId, `${side} normalizedAllOnAssetId`),
      normalizedAllOnSha256:
        exactSha(candidate.normalizedAllOnSha256, `${side} normalizedAllOnSha256`),
      rawToNormalizedTransformSha256: exactSha(
        candidate.rawToNormalizedTransformSha256,
        `${side} rawToNormalizedTransformSha256`,
      ),
      authenticatedOuterCutArtifactSha256: exactSha(
        candidate.authenticatedOuterCutArtifactSha256,
        `${side} authenticatedOuterCutArtifactSha256`,
      ),
      warmManifestSha256:
        exactSha(candidate.warmManifestSha256, `${side} warmManifestSha256`),
      nativeRoles,
      nativeRoleLedgerSha256,
    };
  }
  return {
    queueItemId,
    gradingSessionId,
    reportId,
    cardIdentitySha256,
    calibrationProfileId,
    calibrationVersion,
    calibrationArtifactSha256,
    calibrationBundleManifestSha256,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    sides,
  };
}

export function verifyFixedRigOperatorResolutionRequestV1(
  request: FixedRigOperatorResolutionRequestV1,
): boolean {
  try {
    if (!isRecord(request)) return false;
    exactKeys(request, [
      "schemaVersion",
      "generatedAt",
      "binding",
      "originalElements",
      "hashPolicy",
      "requestSha256",
    ], "Operator resolution request");
    if (request.schemaVersion !== FIXED_RIG_OPERATOR_RESOLUTION_REQUEST_V1_VERSION ||
        request.hashPolicy !== "sha256-canonical-json-with-requestSha256-omitted") return false;
    exactTimestamp(request.generatedAt, "resolution request generatedAt");
    validateBinding(request.binding);
    if (!isRecord(request.originalElements)) return false;
    exactKeys(
      request.originalElements,
      ["centering", "corners", "edges", "surface"],
      "Operator resolution original elements",
    );
    for (const element of ["centering", "corners", "edges", "surface"] as const) {
      validateOriginal(request.originalElements[element], element);
    }
    exactSha(request.requestSha256, "requestSha256");
    const { requestSha256, ...payload } = request;
    return hashFixedRigOperatorResolutionValueV1(payload) === requestSha256;
  } catch {
    return false;
  }
}

export function buildFixedRigOperatorResolutionRequestV1(input: {
  generatedAt: string;
  binding: FixedRigOperatorResolutionBindingV1;
  originalElements: Record<MathematicalGradingElementV1, FixedRigOperatorResolutionOriginalElementV1>;
}): FixedRigOperatorResolutionRequestV1 {
  exactTimestamp(input.generatedAt, "resolution request generatedAt");
  const binding = validateBinding(input.binding);
  const originalElements = Object.fromEntries(
    (["centering", "corners", "edges", "surface"] as const).map((element) => [
      element,
      validateOriginal(input.originalElements[element], element),
    ]),
  ) as Record<MathematicalGradingElementV1, FixedRigOperatorResolutionOriginalElementV1>;
  const payload = {
    schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_REQUEST_V1_VERSION,
    generatedAt: input.generatedAt,
    binding,
    originalElements,
    hashPolicy: "sha256-canonical-json-with-requestSha256-omitted" as const,
  };
  const request = { ...payload, requestSha256: hashFixedRigOperatorResolutionValueV1(payload) };
  if (!verifyFixedRigOperatorResolutionRequestV1(request)) {
    throw new Error("Constructed operator resolution request failed canonical verification.");
  }
  return request;
}

export function buildFixedRigOperatorResolutionAuthorityV1(input: {
  request: FixedRigOperatorResolutionRequestV1;
  submission: FixedRigOperatorResolutionSubmissionV1;
  operatorId: string;
  authenticatedAt: string;
  priorAuthority?: FixedRigOperatorResolutionAuthorityV1;
}): FixedRigOperatorResolutionAuthorityV1 {
  if (!verifyFixedRigOperatorResolutionRequestV1(input.request)) {
    throw new Error("Operator resolution request is invalid or noncanonical.");
  }
  if (input.submission.requestSha256 !== input.request.requestSha256) {
    throw new Error("Operator resolution does not bind the exact pending request.");
  }
  exactId(input.operatorId, "operatorId");
  exactTimestamp(input.authenticatedAt, "authenticatedAt");
  const prior = input.priorAuthority;
  if (prior && !verifyFixedRigOperatorResolutionAuthorityV1(prior)) {
    throw new Error("Prior operator resolution authority is invalid.");
  }
  if (prior && (prior.requestSha256 !== input.request.requestSha256 ||
      hashFixedRigOperatorResolutionValueV1(prior.binding) !==
        hashFixedRigOperatorResolutionValueV1(input.request.binding))) {
    throw new Error("Prior operator resolution authority is bound to a different request.");
  }
  const resolutions = input.submission.resolutions.map((resolution) => ({
    ...structuredClone(resolution),
    original: structuredClone(input.request.originalElements[resolution.element]),
  }));
  const payload = {
    schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_AUTHORITY_V1_VERSION,
    revision: (prior?.revision ?? 0) + 1,
    supersedesAuthoritySha256: prior?.authoritySha256 ?? null,
    requestSha256: input.request.requestSha256,
    operatorId: input.operatorId,
    authenticatedAt: input.authenticatedAt,
    binding: structuredClone(input.request.binding),
    resolutions,
    hashPolicy: "sha256-canonical-json-with-authoritySha256-omitted" as const,
  };
  return { ...payload, authoritySha256: hashFixedRigOperatorResolutionValueV1(payload) };
}

export function verifyFixedRigOperatorResolutionAuthorityV1(
  authority: FixedRigOperatorResolutionAuthorityV1,
): boolean {
  try {
    if (!isRecord(authority)) return false;
    exactKeys(authority, [
      "schemaVersion",
      "revision",
      "supersedesAuthoritySha256",
      "requestSha256",
      "operatorId",
      "authenticatedAt",
      "binding",
      "resolutions",
      "hashPolicy",
      "authoritySha256",
    ], "Operator resolution authority");
    if (authority.schemaVersion !== FIXED_RIG_OPERATOR_RESOLUTION_AUTHORITY_V1_VERSION ||
        !Number.isInteger(authority.revision) || authority.revision < 1 ||
        authority.hashPolicy !== "sha256-canonical-json-with-authoritySha256-omitted" ||
        !SHA256.test(authority.authoritySha256) ||
        (authority.supersedesAuthoritySha256 !== null &&
          !SHA256.test(authority.supersedesAuthoritySha256))) return false;
    exactSha(authority.requestSha256, "authority requestSha256");
    exactId(authority.operatorId, "authority operatorId");
    exactTimestamp(authority.authenticatedAt, "authority authenticatedAt");
    validateBinding(authority.binding);
    if (!Array.isArray(authority.resolutions) || authority.resolutions.length > 4) return false;
    const submissionCandidates = authority.resolutions.map((resolution) => {
      if (!isRecord(resolution)) throw new Error("Authority resolution must be exact.");
      const { original, ...candidate } = resolution;
      validateOriginal(original, String(candidate.element ?? "unknown"));
      return candidate;
    });
    parseFixedRigOperatorResolutionSubmissionV1({
      schemaVersion: FIXED_RIG_OPERATOR_RESOLUTION_SUBMISSION_V1_VERSION,
      requestSha256: authority.requestSha256,
      operatorConfirmed: true,
      resolutions: submissionCandidates,
    }, {
      width: FIXED_RIG_STANDARD_TRADING_CARD_WIDTH_MM,
      height: FIXED_RIG_STANDARD_TRADING_CARD_HEIGHT_MM,
    });
    const { authoritySha256, ...payload } = authority;
    return hashFixedRigOperatorResolutionValueV1(payload) === authoritySha256;
  } catch {
    return false;
  }
}

export function verifyFixedRigOperatorResolutionAuthorityAgainstRequestV1(
  authority: FixedRigOperatorResolutionAuthorityV1,
  request: FixedRigOperatorResolutionRequestV1,
): boolean {
  if (
    !verifyFixedRigOperatorResolutionRequestV1(request) ||
    !verifyFixedRigOperatorResolutionAuthorityV1(authority) ||
    authority.requestSha256 !== request.requestSha256 ||
    hashFixedRigOperatorResolutionValueV1(authority.binding) !==
      hashFixedRigOperatorResolutionValueV1(request.binding)
  ) {
    return false;
  }
  return authority.resolutions.every((resolution) =>
    hashFixedRigOperatorResolutionValueV1(resolution.original) ===
      hashFixedRigOperatorResolutionValueV1(
        request.originalElements[resolution.element],
      ));
}

export function latestFixedRigOperatorElementResolutionV1(
  authorities: readonly FixedRigOperatorResolutionAuthorityV1[],
  element: MathematicalGradingElementV1,
): FixedRigOperatorElementResolutionAuthorityV1 | undefined {
  let priorSha: string | null = null;
  let latest: FixedRigOperatorElementResolutionAuthorityV1 | undefined;
  for (let index = 0; index < authorities.length; index += 1) {
    const authority = authorities[index]!;
    if (!verifyFixedRigOperatorResolutionAuthorityV1(authority) ||
        authority.revision !== index + 1 ||
        authority.supersedesAuthoritySha256 !== priorSha) {
      throw new Error("Operator resolution authority chain is stale, conflicting, or malformed.");
    }
    priorSha = authority.authoritySha256;
    latest = authority.resolutions.find((resolution) => resolution.element === element) ?? latest;
  }
  return latest;
}
