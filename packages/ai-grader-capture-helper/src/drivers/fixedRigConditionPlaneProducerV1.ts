import { createHash } from "node:crypto";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  mathematicalEvidenceReferenceV1Schema,
  type MathematicalMeasurementV1,
} from "@tenkings/shared";
import type { FixedRigPointV1 } from "./fixedRigCenteringV1";
import type { FixedRigConditionDesignRegistrationV1 } from "./fixedRigConditionSegmentationV1";
import type { FixedRigConditionMeasurementCalibrationV1 } from "./fixedRigCornerEdgeV1";
import type {
  FixedRigPhotometricEvidenceV1,
  FixedRigScalarPlaneV1,
} from "./fixedRigPhotometricEvidenceV1";
import {
  type FixedRigIntendedOuterBoundaryAuthorityV1,
} from "./fixedRigOuterCutDetectorV1";
import {
  verifyFixedRigRawBoundObservedOuterCutArtifactV1,
  type FixedRigRawBoundObservedOuterCutArtifactV1,
} from './fixedRigRawSensorOuterCutDetectorV1';

export const FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION =
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionPlaneProducer.producerVersion;

type Side = "front" | "back";
type EvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];

export interface FixedRigRgbPlaneV1 {
  width: number;
  height: number;
  /** Interleaved, registered sRGB input samples normalized to 0..1. */
  data: ArrayLike<number>;
}

export interface FixedRigOuterBoundaryArtifactV1
  extends FixedRigIntendedOuterBoundaryAuthorityV1 {}

export interface BuildFixedRigConditionPlanesV1Input {
  side: Side;
  normalizedAllOnRgb: FixedRigRgbPlaneV1;
  normalizedAcceptedProfileRgb: FixedRigRgbPlaneV1;
  approvedDesignReferenceRgb?: FixedRigRgbPlaneV1;
  designRegistration?: FixedRigConditionDesignRegistrationV1;
  /** Exact card-format/profile authority; never fitted from the damaged observation. */
  intendedOuterBoundary?: FixedRigOuterBoundaryArtifactV1;
  /** Measured only from exact raw all-on sensor pixels, then transformed into this frame. */
  rawBoundObservedOuterCut?: FixedRigRawBoundObservedOuterCutArtifactV1;
  photometricEvidence: FixedRigPhotometricEvidenceV1;
  measurementCalibration: FixedRigConditionMeasurementCalibrationV1;
  sourceEvidence: EvidenceReferenceV1[];
}

export interface FixedRigOuterCutGeometryEvidenceV1 {
  coordinateFrame: "normalized_card_portrait_pixels";
  observedContourSha256: string;
  intendedContourSha256: string;
  intendedBoundaryProfileId: string;
  intendedBoundaryProfileVersion: string;
  observedContourPointCount: number;
  intendedContourPointCount: number;
  observedContourDetectorId: string;
  observedContourDetectorVersion: string;
  rawAllOnAssetId: string;
  rawAllOnAssetSha256: string;
  rawAllOnScalarPlaneSha256: string;
  rawToNormalizedTransformSha256: string;
  normalizedAllOnAssetId: string;
  normalizedAllOnAssetSha256: string;
  boundaryConfidence: number;
  boundaryU95Mm: number;
  observedArtifact: FixedRigRawBoundObservedOuterCutArtifactV1;
}

export type FixedRigConditionPlaneProducerV1Result =
  | {
      version: typeof FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION;
      status: "computed";
      side: Side;
      planes: {
        normalizedLuminance: FixedRigScalarPlaneV1;
        expectedOuterCardMask: FixedRigScalarPlaneV1;
        materialPresenceConfidence: FixedRigScalarPlaneV1;
        segmentationConfidence: FixedRigScalarPlaneV1;
        boundaryConfidence: FixedRigScalarPlaneV1;
        exposedFiberResponse: FixedRigScalarPlaneV1;
        /** Negative is missing/indented material; positive is material beyond the intended cut boundary. */
        signedBoundaryDeviationMm: FixedRigScalarPlaneV1;
        boundaryDeviationMm: FixedRigScalarPlaneV1;
        deformationResponse: FixedRigScalarPlaneV1;
        delaminationResponse: FixedRigScalarPlaneV1;
        edgeRoughnessIndex: FixedRigScalarPlaneV1;
        frayingResponse: FixedRigScalarPlaneV1;
        scratchLineResponse: FixedRigScalarPlaneV1;
        scuffTextureResponse: FixedRigScalarPlaneV1;
        creaseLineResponse: FixedRigScalarPlaneV1;
        chipDepthMm: FixedRigScalarPlaneV1;
        reliefIndex: FixedRigScalarPlaneV1;
        depthMm: FixedRigScalarPlaneV1;
        registeredColorDeltaE: FixedRigScalarPlaneV1;
        registeredPrintDeltaE: FixedRigScalarPlaneV1;
        registeredResidueDeltaE: FixedRigScalarPlaneV1;
      };
      outerCutGeometryEvidence: FixedRigOuterCutGeometryEvidenceV1;
      designDependentEvidence: "computed" | "unavailable_no_approved_reference";
      unavailableModalities: Array<
        "metric_depth" | "polarized_residue" | "design_relative_color"
      >;
      sourceEvidence: EvidenceReferenceV1[];
      heatmapUsedAsInput: false;
      manualPlaneUsedAsInput: false;
      formulas: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionPlaneProducer.formulas;
    }
  | {
      version: typeof FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION;
      status: "insufficient_evidence";
      side: Side;
      reasons: string[];
      requiresRecapture: boolean;
      requiresApprovedDesignReference: boolean;
      requiresCalibration: boolean;
      cardDefectDeduction: 0;
      heatmapUsedAsInput: false;
      manualPlaneUsedAsInput: false;
    };

const POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionPlaneProducer;
const SURFACE_POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function plane(width: number, height: number, data: ArrayLike<number>): FixedRigScalarPlaneV1 {
  return { width, height, data };
}

function zeroPlane(width: number, height: number): FixedRigScalarPlaneV1 {
  return plane(width, height, new Float32Array(width * height));
}

function insufficient(
  side: Side,
  reasons: string[],
  flags: {
    requiresRecapture?: boolean;
    requiresApprovedDesignReference?: boolean;
    requiresCalibration?: boolean;
  } = {},
): FixedRigConditionPlaneProducerV1Result {
  return {
    version: FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION,
    status: "insufficient_evidence",
    side,
    reasons,
    requiresRecapture: flags.requiresRecapture ?? false,
    requiresApprovedDesignReference: flags.requiresApprovedDesignReference ?? false,
    requiresCalibration: flags.requiresCalibration ?? false,
    cardDefectDeduction: 0,
    heatmapUsedAsInput: false,
    manualPlaneUsedAsInput: false,
  };
}

function validateRgb(name: string, value: FixedRigRgbPlaneV1, width: number, height: number): string[] {
  const reasons: string[] = [];
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) ||
      value.width !== width || value.height !== height || value.data.length !== width * height * 3) {
    reasons.push(`${name} must contain exactly three normalized channels for every calibrated frame pixel.`);
    return reasons;
  }
  for (let index = 0; index < value.data.length; index += 1) {
    const sample = Number(value.data[index]);
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      reasons.push(`${name} contains a sample outside 0..1.`);
      break;
    }
  }
  return reasons;
}

function validateInput(input: BuildFixedRigConditionPlanesV1Input): string[] {
  const { width, height } = input.photometricEvidence;
  const reasons = [
    ...validateRgb("normalized all-on RGB", input.normalizedAllOnRgb, width, height),
    ...validateRgb("normalized accepted-profile RGB", input.normalizedAcceptedProfileRgb, width, height),
  ];
  if (input.approvedDesignReferenceRgb) {
    reasons.push(...validateRgb(
      "approved design-reference RGB",
      input.approvedDesignReferenceRgb,
      width,
      height,
    ));
  }
  if (Boolean(input.approvedDesignReferenceRgb) !== Boolean(input.designRegistration)) {
    reasons.push("Approved design RGB and its exact registration must be supplied together.");
  }
  // Photometric evidence has no side field by design; exact source references
  // below are the sole side identity authority.
  if (input.photometricEvidence.status !== "computed") {
    reasons.push("Condition-plane production requires computed calibrated photometric evidence.");
  }
  const intended = input.intendedOuterBoundary;
  if (!intended) {
    reasons.push("An exact hash-bound intended outer-boundary profile is required; the intended cut shape may not be fitted from the observed card.");
  } else {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(intended.profileId) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(intended.profileVersion)) {
      reasons.push("The intended outer-boundary profile identity/version is malformed.");
    }
    if (intended.coordinateFrame !== "normalized_card_portrait_pixels") {
      reasons.push("The intended outer-boundary profile uses the wrong coordinate frame.");
    }
    if (intended.contour.length < 4 ||
        intended.contour.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      reasons.push("The intended outer-boundary profile requires a finite contour with at least four points.");
    } else if (intended.artifactSha256 !== hashFixedRigIntendedOuterBoundaryV1(intended)) {
      reasons.push("The intended outer-boundary profile does not match its exact canonical artifact SHA-256.");
    }
  }
  const frameWidth = input.photometricEvidence.width;
  const frameHeight = input.photometricEvidence.height;
  const namedContours: Array<[string, readonly FixedRigPointV1[]]> = [
    ["intended outer-boundary", intended?.contour ?? []],
  ];
  for (const [name, contour] of namedContours) {
    if (contour.some((point) => point.x < 0 || point.x > frameWidth || point.y < 0 || point.y > frameHeight)) {
      reasons.push(`The ${name} contour must remain inside the calibrated normalized frame.`);
    }
    if (contour.length >= 4 && polygonArea(contour) <= 0) {
      reasons.push(`The ${name} contour must enclose non-zero area.`);
    }
  }
  if (!Number.isFinite(input.measurementCalibration.pixelsPerMmX) ||
      !Number.isFinite(input.measurementCalibration.pixelsPerMmY) ||
      input.measurementCalibration.pixelsPerMmX <= 0 || input.measurementCalibration.pixelsPerMmY <= 0) {
    reasons.push("Positive finalized X/Y pixel-per-mm scales are required.");
  }
  if (!input.sourceEvidence.length || input.sourceEvidence.length > 64) {
    reasons.push("Condition-plane production requires one through 64 immutable source references.");
  }
  for (const reference of input.sourceEvidence) {
    const parsed = mathematicalEvidenceReferenceV1Schema.safeParse(reference);
    if (!parsed.success || reference.side !== input.side ||
        !["all_on", "normalized_card", "design_reference", "directional_channel"].includes(reference.role)) {
      reasons.push("Condition-plane source evidence must be exact, side-bound core/design/channel evidence.");
      break;
    }
  }
  const roles = new Set(input.sourceEvidence.map((reference) => reference.role));
  for (const role of ["all_on", "normalized_card", "directional_channel"] as const) {
    if (!roles.has(role)) reasons.push(`Condition-plane production is missing required ${role} evidence.`);
  }
  if (input.sourceEvidence.filter((reference) => reference.role === "all_on").length !== 1) {
    reasons.push("Condition-plane production requires exactly one normalized all-on source authority for outer-cut detection.");
  }
  if (input.approvedDesignReferenceRgb && !roles.has("design_reference")) {
    reasons.push("Approved design RGB is not hash-bound as exact design-reference evidence.");
  }
  const observed = input.rawBoundObservedOuterCut;
  const allOn = input.sourceEvidence.filter((reference) => reference.role === 'all_on')[0];
  if (!observed) {
    reasons.push('A hash-verified raw-sensor outer-cut artifact is required.');
  } else if (!verifyFixedRigRawBoundObservedOuterCutArtifactV1(observed)) {
    reasons.push('The raw-sensor outer-cut artifact SHA-256 does not reproduce.');
  } else {
    if (!allOn || observed.normalizedAllOnAssetId !== allOn.assetId ||
        observed.normalizedAllOnAssetSha256 !== allOn.sha256.toLowerCase()) {
      reasons.push('The raw-sensor outer-cut artifact does not bind the exact normalized all-on evidence.');
    }
    if (!intended || observed.intendedBoundaryArtifactSha256 !== intended.artifactSha256 ||
        observed.intendedBoundaryProfileId !== intended.profileId ||
        observed.intendedBoundaryProfileVersion !== intended.profileVersion) {
      reasons.push('The raw-sensor outer-cut artifact does not bind the exact intended cut authority.');
    }
    if (observed.calibrationProfileId !== input.measurementCalibration.calibrationProfileId ||
        observed.calibrationVersion !== input.measurementCalibration.calibrationVersion ||
        observed.calibrationSha256 !== input.measurementCalibration.calibrationSha256 ||
        Math.abs(observed.pixelsPerMmX - input.measurementCalibration.pixelsPerMmX) > 1e-9 ||
        Math.abs(observed.pixelsPerMmY - input.measurementCalibration.pixelsPerMmY) > 1e-9) {
      reasons.push('The raw-sensor outer-cut artifact does not bind the finalized measurement calibration.');
    }
    if (observed.normalizedWidthPx !== width || observed.normalizedHeightPx !== height ||
        observed.normalizedContour.length !== observed.crossSectionCount ||
        observed.normalizedContour.some((point) => point.x < 0 || point.x > width ||
          point.y < 0 || point.y > height)) {
      reasons.push('The transformed raw outer-cut contour is incomplete or outside the normalized frame.');
    }
  }
  return reasons;
}

function pointInPolygon(x: number, y: number, contour: readonly FixedRigPointV1[]): boolean {
  let inside = false;
  for (let current = 0, previous = contour.length - 1; current < contour.length; previous = current, current += 1) {
    const a = contour[current]!;
    const b = contour[previous]!;
    if (((a.y > y) !== (b.y > y)) &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function observedMaterialMask(width: number, height: number, contour: readonly FixedRigPointV1[]): Float32Array {
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[y * width + x] = pointInPolygon(x + 0.5, y + 0.5, contour) ? 1 : 0;
    }
  }
  return output;
}

function polygonArea(contour: readonly FixedRigPointV1[]): number {
  let twiceArea = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!;
    const next = contour[(index + 1) % contour.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

function canonicalContour(contour: readonly FixedRigPointV1[]): ReadonlyArray<readonly [number, number]> {
  const points = contour.map((point) => [point.x, point.y] as const);
  if (points.length > 1 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1]) {
    points.pop();
  }
  const rotations = (ordered: ReadonlyArray<readonly [number, number]>) => ordered.map((_, offset) =>
    [...ordered.slice(offset), ...ordered.slice(0, offset)]);
  const candidates = [...rotations(points), ...rotations([...points].reverse())];
  return candidates.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0] ?? [];
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function hashFixedRigIntendedOuterBoundaryV1(
  boundary: Omit<FixedRigOuterBoundaryArtifactV1, "artifactSha256"> | FixedRigOuterBoundaryArtifactV1,
): string {
  return sha256Canonical({
    schemaVersion: "fixed-rig-intended-outer-boundary-v1",
    profileId: boundary.profileId,
    profileVersion: boundary.profileVersion,
    coordinateFrame: boundary.coordinateFrame,
    contour: canonicalContour(boundary.contour),
  });
}

/**
 * Produces the exact binary grade-relevant outer-card mask used both by the
 * photometric gate and by the complete condition-plane producer. Keeping this
 * seam here prevents a caller-authored mask from becoming grading authority.
 * The contour supplied here must be the exact hash-verified intended boundary
 * profile, not the measured card contour. The complete frame is not authority.
 */
export function buildFixedRigExpectedOuterCardMaskV1(input: {
  width: number;
  height: number;
  outerCutContour: readonly FixedRigPointV1[];
}): FixedRigScalarPlaneV1 {
  if (!Number.isSafeInteger(input.width) || input.width <= 0 ||
      !Number.isSafeInteger(input.height) || input.height <= 0 ||
      input.outerCutContour.length < 4 ||
      input.outerCutContour.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("Expected outer-card mask requires a finite measured contour and positive frame dimensions.");
  }
  return plane(
    input.width,
    input.height,
    observedMaterialMask(input.width, input.height, input.outerCutContour),
  );
}

function edt1d(source: Float64Array, length: number, axisScale: number): Float64Array {
  const output = new Float64Array(length);
  const locations = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  let k = 0;
  locations[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;
  for (let q = 1; q < length; q += 1) {
    const scaleSquared = axisScale ** 2;
    let intersection = ((source[q]! + q * q * scaleSquared) -
      (source[locations[k]!]! + locations[k]! * locations[k]! * scaleSquared)) /
      (2 * scaleSquared * (q - locations[k]!));
    while (intersection <= boundaries[k]) {
      k -= 1;
      intersection = ((source[q]! + q * q * scaleSquared) -
        (source[locations[k]!]! + locations[k]! * locations[k]! * scaleSquared)) /
        (2 * scaleSquared * (q - locations[k]!));
    }
    k += 1;
    locations[k] = q;
    boundaries[k] = intersection;
    boundaries[k + 1] = Number.POSITIVE_INFINITY;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (boundaries[k + 1]! < q) k += 1;
    const delta = q - locations[k]!;
    output[q] = delta * delta * axisScale ** 2 + source[locations[k]!]!;
  }
  return output;
}

function euclideanDistanceToMaterial(
  width: number,
  height: number,
  material: Float32Array,
  mmPerPixelX: number,
  mmPerPixelY: number,
): Float32Array {
  const infinity = 1e20;
  const rowPass = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const source = new Float64Array(width);
    for (let x = 0; x < width; x += 1) source[x] = material[y * width + x] > 0 ? 0 : infinity;
    const row = edt1d(source, width, mmPerPixelX);
    for (let x = 0; x < width; x += 1) rowPass[y * width + x] = row[x]!;
  }
  const output = new Float32Array(width * height);
  for (let x = 0; x < width; x += 1) {
    const source = new Float64Array(height);
    for (let y = 0; y < height; y += 1) source[y] = rowPass[y * width + x]!;
    const column = edt1d(source, height, mmPerPixelY);
    for (let y = 0; y < height; y += 1) output[y * width + x] = Math.sqrt(column[y]!);
  }
  return output;
}

function euclideanDistanceToExterior(
  width: number,
  height: number,
  material: ArrayLike<number>,
  mmPerPixelX: number,
  mmPerPixelY: number,
): Float32Array {
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const exterior = new Float32Array(paddedWidth * paddedHeight).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      exterior[(y + 1) * paddedWidth + x + 1] = Number(material[y * width + x]) > 0 ? 0 : 1;
    }
  }
  const paddedDistance = euclideanDistanceToMaterial(
    paddedWidth,
    paddedHeight,
    exterior,
    mmPerPixelX,
    mmPerPixelY,
  );
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[y * width + x] = paddedDistance[(y + 1) * paddedWidth + x + 1]!;
    }
  }
  return output;
}

function binaryBoundaryMask(width: number, height: number, mask: ArrayLike<number>): Uint8Array {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (Number(mask[index]) <= 0) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
          Number(mask[index - 1]) <= 0 || Number(mask[index + 1]) <= 0 ||
          Number(mask[index - width]) <= 0 || Number(mask[index + width]) <= 0) {
        output[index] = 1;
      }
    }
  }
  return output;
}

function maskedLocalRms(
  width: number,
  height: number,
  values: ArrayLike<number>,
  support: ArrayLike<number>,
  radiusX: number,
  radiusY: number,
): Float32Array {
  const supportedValues = Float32Array.from(values, (value, index) =>
    Number(support[index]) > 0 ? Number(value) : 0);
  const supportedSquares = Float32Array.from(supportedValues, (value) => value * value);
  const countsIntegral = integralPlane(width, height, support);
  const valuesIntegral = integralPlane(width, height, supportedValues);
  const squaresIntegral = integralPlane(width, height, supportedSquares);
  const rectangleSum = (
    integral: Float64Array,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => integral[bottom * (width + 1) + right]! -
    integral[top * (width + 1) + right]! -
    integral[bottom * (width + 1) + left]! +
    integral[top * (width + 1) + left]!;
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radiusY);
    const bottom = Math.min(height, y + radiusY + 1);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (Number(support[index]) <= 0) continue;
      const left = Math.max(0, x - radiusX);
      const right = Math.min(width, x + radiusX + 1);
      const count = rectangleSum(countsIntegral, left, top, right, bottom);
      if (count < 2) continue;
      const mean = rectangleSum(valuesIntegral, left, top, right, bottom) / count;
      const meanSquare = rectangleSum(squaresIntegral, left, top, right, bottom) / count;
      output[index] = Math.sqrt(Math.max(0, meanSquare - mean * mean));
    }
  }
  return output;
}

function integralPlane(width: number, height: number, values: ArrayLike<number>): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += Number(values[y * width + x]);
      integral[(y + 1) * (width + 1) + x + 1] =
        integral[y * (width + 1) + x + 1]! + rowSum;
    }
  }
  return integral;
}

function boxStatistic(
  width: number,
  height: number,
  values: ArrayLike<number>,
  radiusX: number,
  radiusY: number,
): Float32Array {
  const integral = integralPlane(width, height, values);
  const output = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radiusY);
    const bottom = Math.min(height, y + radiusY + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radiusX);
      const right = Math.min(width, x + radiusX + 1);
      const sum = integral[bottom * (width + 1) + right]! -
        integral[top * (width + 1) + right]! -
        integral[bottom * (width + 1) + left]! +
        integral[top * (width + 1) + left]!;
      output[y * width + x] = sum / ((right - left) * (bottom - top));
    }
  }
  return output;
}

function localRms(
  width: number,
  height: number,
  values: ArrayLike<number>,
  radiusX: number,
  radiusY: number,
): Float32Array {
  const mean = boxStatistic(width, height, values, radiusX, radiusY);
  const squares = Float32Array.from(values, (value) => Number(value) ** 2);
  const meanSquares = boxStatistic(width, height, squares, radiusX, radiusY);
  return Float32Array.from(mean, (value, index) =>
    Math.sqrt(Math.max(0, Number(meanSquares[index]) - value ** 2)));
}

function matrix3x3(registration: FixedRigConditionDesignRegistrationV1): number[] {
  if (registration.transformType === "affine") {
    const [a, b, c, d, e, f] = registration.transformMatrix;
    return [a!, b!, c!, d!, e!, f!, 0, 0, 1];
  }
  return [...registration.transformMatrix];
}

function inverse3x3(matrix: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a! * (e! * i! - f! * h!) -
    b! * (d! * i! - f! * g!) + c! * (d! * h! - e! * g!);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return [
    (e! * i! - f! * h!) / determinant,
    (c! * h! - b! * i!) / determinant,
    (b! * f! - c! * e!) / determinant,
    (f! * g! - d! * i!) / determinant,
    (a! * i! - c! * g!) / determinant,
    (c! * d! - a! * f!) / determinant,
    (d! * h! - e! * g!) / determinant,
    (b! * g! - a! * h!) / determinant,
    (a! * e! - b! * d!) / determinant,
  ];
}

function registeredDesign(input: {
  design: FixedRigRgbPlaneV1;
  registration: FixedRigConditionDesignRegistrationV1;
  width: number;
  height: number;
}): { rgb: Float32Array; valid: Uint8Array } | null {
  const inverse = inverse3x3(matrix3x3(input.registration));
  if (!inverse) return null;
  const output = new Float32Array(input.width * input.height * 3);
  const valid = new Uint8Array(input.width * input.height);
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const divisor = inverse[6]! * x + inverse[7]! * y + inverse[8]!;
      if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) continue;
      const sourceX = (inverse[0]! * x + inverse[1]! * y + inverse[2]!) / divisor;
      const sourceY = (inverse[3]! * x + inverse[4]! * y + inverse[5]!) / divisor;
      if (sourceX < 0 || sourceY < 0 ||
          sourceX > input.design.width - 1 || sourceY > input.design.height - 1) continue;
      const left = Math.floor(sourceX);
      const right = Math.min(input.design.width - 1, left + 1);
      const top = Math.floor(sourceY);
      const bottom = Math.min(input.design.height - 1, top + 1);
      const xMix = sourceX - left;
      const yMix = sourceY - top;
      const targetIndex = y * input.width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const topValue = Number(input.design.data[(top * input.design.width + left) * 3 + channel]) * (1 - xMix) +
          Number(input.design.data[(top * input.design.width + right) * 3 + channel]) * xMix;
        const bottomValue = Number(input.design.data[(bottom * input.design.width + left) * 3 + channel]) * (1 - xMix) +
          Number(input.design.data[(bottom * input.design.width + right) * 3 + channel]) * xMix;
        output[targetIndex * 3 + channel] = topValue * (1 - yMix) + bottomValue * yMix;
      }
      valid[targetIndex] = 1;
    }
  }
  return { rgb: output, valid };
}

function trimmedStats(values: number[], trimFraction: number): { mean: number; standardDeviation: number } {
  values.sort((left, right) => left - right);
  const trim = Math.floor(values.length * trimFraction);
  const retained = values.slice(trim, Math.max(trim + 1, values.length - trim));
  const mean = retained.reduce((sum, value) => sum + value, 0) / retained.length;
  const variance = retained.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, retained.length - 1);
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function robustNormalizeRgb(input: {
  observed: FixedRigRgbPlaneV1;
  reference: ArrayLike<number>;
  valid: Uint8Array;
}): Float32Array | null {
  const validCount = input.valid.reduce((sum, value) => sum + value, 0);
  if (validCount < POLICY.color.minimumValidSamples) return null;
  const gains = new Float64Array(3);
  const offsets = new Float64Array(3);
  for (let channel = 0; channel < 3; channel += 1) {
    const observedValues: number[] = [];
    const referenceValues: number[] = [];
    for (let index = 0; index < input.valid.length; index += 1) {
      if (!input.valid[index]) continue;
      observedValues.push(Number(input.observed.data[index * 3 + channel]));
      referenceValues.push(Number(input.reference[index * 3 + channel]));
    }
    const observedStats = trimmedStats(observedValues, POLICY.color.trimFraction);
    const referenceStats = trimmedStats(referenceValues, POLICY.color.trimFraction);
    const rawGain = observedStats.standardDeviation > 1e-9
      ? referenceStats.standardDeviation / observedStats.standardDeviation
      : 1;
    gains[channel] = clamp(rawGain, POLICY.color.gainClamp[0], POLICY.color.gainClamp[1]);
    offsets[channel] = clamp(
      referenceStats.mean - gains[channel]! * observedStats.mean,
      POLICY.color.offsetClamp[0],
      POLICY.color.offsetClamp[1],
    );
  }
  return Float32Array.from(input.observed.data, (value, index) => {
    const channel = index % 3;
    return clamp(Number(value) * gains[channel]! + offsets[channel]!);
  });
}

function linearSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function labFromSrgb(r: number, g: number, b: number): [number, number, number] {
  const red = linearSrgb(r);
  const green = linearSrgb(g);
  const blue = linearSrgb(b);
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = (0.2126729 * red + 0.7151522 * green + 0.072175 * blue);
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883;
  const transform = (value: number) => value > 216 / 24389
    ? Math.cbrt(value)
    : (24389 / 27 * value + 16) / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

interface RegisteredColorDifferencesV1 {
  deltaE: Float32Array;
  lightnessDelta: Float32Array;
  chromaDelta: Float32Array;
  valid: Uint8Array;
}

function registeredColorDifferences(input: {
  observed: FixedRigRgbPlaneV1;
  reference: ArrayLike<number>;
  valid: Uint8Array;
}): RegisteredColorDifferencesV1 | null {
  const normalized = robustNormalizeRgb(input);
  if (!normalized) return null;
  const deltaE = new Float32Array(input.valid.length);
  const lightnessDelta = new Float32Array(input.valid.length);
  const chromaDelta = new Float32Array(input.valid.length);
  for (let index = 0; index < input.valid.length; index += 1) {
    if (!input.valid[index]) continue;
    const observed = labFromSrgb(
      normalized[index * 3]!,
      normalized[index * 3 + 1]!,
      normalized[index * 3 + 2]!,
    );
    const reference = labFromSrgb(
      Number(input.reference[index * 3]),
      Number(input.reference[index * 3 + 1]),
      Number(input.reference[index * 3 + 2]),
    );
    const dl = observed[0] - reference[0];
    const da = observed[1] - reference[1];
    const db = observed[2] - reference[2];
    deltaE[index] = Math.hypot(dl, da, db);
    lightnessDelta[index] = dl;
    chromaDelta[index] = Math.hypot(da, db);
  }
  return { deltaE, lightnessDelta, chromaDelta, valid: input.valid };
}

function photometricRelief(
  evidence: FixedRigPhotometricEvidenceV1,
): { range: Float32Array; relief: Float32Array; valid: Uint8Array } {
  const range = new Float32Array(evidence.width * evidence.height);
  const relief = new Float32Array(range.length);
  const valid = new Uint8Array(range.length);
  for (let index = 0; index < range.length; index += 1) {
    if (evidence.invalidIlluminationMask[index]) continue;
    const samples = evidence.channels
      .filter((channel) => channel.validDirectionalObservationMask[index])
      .map((channel) => Number(channel.directionalResidual[index]));
    if (samples.length < SURFACE_POLICY.minValidDirectionalObservations) continue;
    const directionalRange = Math.max(...samples) - Math.min(...samples);
    range[index] = directionalRange;
    relief[index] = clamp(directionalRange / POLICY.directional.reliefFullScale);
    valid[index] = 1;
  }
  return { range, relief, valid };
}

function sample(
  values: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return Number(values[y * width + x]);
}

const ORIENTATIONS = [
  { tangent: [1, 0], normal: [0, 1] },
  { tangent: [0, 1], normal: [1, 0] },
  { tangent: [1, 1], normal: [1, -1] },
  { tangent: [1, -1], normal: [1, 1] },
] as const;

function orientedLineResponse(input: {
  width: number;
  height: number;
  directionalRange: Float32Array;
  valid: Uint8Array;
  normalRadiusX: number;
  normalRadiusY: number;
  tangentRadiusX: number;
  tangentRadiusY: number;
}): Float32Array {
  const output = new Float32Array(input.width * input.height);
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const index = y * input.width + x;
      if (!input.valid[index] || input.directionalRange[index]! < SURFACE_POLICY.directionalResidualThreshold) continue;
      const center = input.directionalRange[index]!;
      let best = 0;
      for (const orientation of ORIENTATIONS) {
        const normalRadius = orientation.normal[0] === 0
          ? input.normalRadiusY
          : orientation.normal[1] === 0
            ? input.normalRadiusX
            : Math.max(input.normalRadiusX, input.normalRadiusY);
        const tangentRadius = orientation.tangent[0] === 0
          ? input.tangentRadiusY
          : orientation.tangent[1] === 0
            ? input.tangentRadiusX
            : Math.max(input.tangentRadiusX, input.tangentRadiusY);
        let normalSum = 0;
        let normalCount = 0;
        for (let distance = 1; distance <= normalRadius; distance += 1) {
          for (const direction of [-1, 1]) {
            normalSum += sample(
              input.directionalRange,
              input.width,
              input.height,
              x + orientation.normal[0] * distance * direction,
              y + orientation.normal[1] * distance * direction,
            );
            normalCount += 1;
          }
        }
        let support = 0;
        let supportCount = 0;
        for (let distance = -tangentRadius; distance <= tangentRadius; distance += 1) {
          const neighbor = sample(
            input.directionalRange,
            input.width,
            input.height,
            x + orientation.tangent[0] * distance,
            y + orientation.tangent[1] * distance,
          );
          support += center > 0 ? Math.min(1, neighbor / center) : 0;
          supportCount += 1;
        }
        const normalMean = normalCount ? normalSum / normalCount : 0;
        const contrast = clamp(Math.abs(center - normalMean) / POLICY.directional.reliefFullScale);
        best = Math.max(best, contrast * (supportCount ? support / supportCount : 0));
      }
      output[index] = best;
    }
  }
  return output;
}

function maximum(values: ArrayLike<number>): number {
  let result = 0;
  for (let index = 0; index < values.length; index += 1) {
    result = Math.max(result, Number(values[index]));
  }
  return result;
}

function lumaPlane(rgb: FixedRigRgbPlaneV1): Float32Array {
  const output = new Float32Array(rgb.width * rgb.height);
  for (let index = 0; index < output.length; index += 1) {
    output[index] =
      0.2126 * Number(rgb.data[index * 3]) +
      0.7152 * Number(rgb.data[index * 3 + 1]) +
      0.0722 * Number(rgb.data[index * 3 + 2]);
  }
  return output;
}

export function buildFixedRigConditionPlanesV1(
  input: BuildFixedRigConditionPlanesV1Input,
): FixedRigConditionPlaneProducerV1Result {
  const reasons = validateInput(input);
  if (reasons.length) {
    return insufficient(input.side, reasons, {
      requiresRecapture: true,
      requiresApprovedDesignReference: reasons.some((reason) => /design/i.test(reason)),
      requiresCalibration: reasons.some((reason) => /calibrat|scale|photometric/i.test(reason)),
    });
  }
  const width = input.photometricEvidence.width;
  const height = input.photometricEvidence.height;
  const pixelCount = width * height;
  const pixelsPerMmX = input.measurementCalibration.pixelsPerMmX;
  const pixelsPerMmY = input.measurementCalibration.pixelsPerMmY;
  const mmPerPixelX = 1 / pixelsPerMmX;
  const mmPerPixelY = 1 / pixelsPerMmY;
  const acceptedLuma = lumaPlane(input.normalizedAcceptedProfileRgb);
  const intendedBoundary = input.intendedOuterBoundary!;
  const observedArtifact = input.rawBoundObservedOuterCut!;
  const expectedMask = buildFixedRigExpectedOuterCardMaskV1({
    width,
    height,
    outerCutContour: intendedBoundary.contour,
  }).data as Float32Array;
  const material = observedMaterialMask(width, height, observedArtifact.normalizedContour);
  if (maximum(material) === 0) {
    return insufficient(input.side, [
      "The measured outer-cut contour contains no normalized-card pixels.",
    ], { requiresRecapture: true });
  }
  const distanceToObservedMaterial = euclideanDistanceToMaterial(
    width,
    height,
    material,
    mmPerPixelX,
    mmPerPixelY,
  );
  const distanceToIntendedMaterial = euclideanDistanceToMaterial(
    width,
    height,
    expectedMask,
    mmPerPixelX,
    mmPerPixelY,
  );
  const distanceToIntendedExterior = euclideanDistanceToExterior(
    width,
    height,
    expectedMask,
    mmPerPixelX,
    mmPerPixelY,
  );
  const boundaryDeviation = new Float32Array(pixelCount);
  const signedBoundaryDeviation = new Float32Array(pixelCount);
  const chipDepth = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const expected = Number(expectedMask[index]) > 0;
    const observed = Number(material[index]) > 0;
    if (expected && !observed) {
      const depth = Number(distanceToObservedMaterial[index]);
      boundaryDeviation[index] = depth;
      signedBoundaryDeviation[index] = -depth;
      chipDepth[index] = depth;
    } else if (!expected && observed) {
      const protrusion = Number(distanceToIntendedMaterial[index]);
      boundaryDeviation[index] = protrusion;
      signedBoundaryDeviation[index] = protrusion;
    }
  }
  const segmentationConfidence = new Float32Array(pixelCount);
  const boundaryConfidence = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const photometricConfidence = input.photometricEvidence.invalidIlluminationMask[index]
      ? 0
      : Math.min(
          1,
          Number(input.photometricEvidence.usableDirectionalObservationCount[index]) /
            SURFACE_POLICY.minValidDirectionalObservations,
        );
    const confidence = Math.min(observedArtifact.confidence, photometricConfidence);
    segmentationConfidence[index] = confidence;
    boundaryConfidence[index] = confidence;
  }

  const relief = photometricRelief(input.photometricEvidence);
  const scratch = orientedLineResponse({
    width,
    height,
    directionalRange: relief.range,
    valid: relief.valid,
    normalRadiusX: Math.max(1, Math.ceil(POLICY.directional.scratchNormalRadiusMm * pixelsPerMmX)),
    normalRadiusY: Math.max(1, Math.ceil(POLICY.directional.scratchNormalRadiusMm * pixelsPerMmY)),
    tangentRadiusX: Math.max(1, Math.ceil(POLICY.directional.scratchTangentRadiusMm * pixelsPerMmX)),
    tangentRadiusY: Math.max(1, Math.ceil(POLICY.directional.scratchTangentRadiusMm * pixelsPerMmY)),
  });
  const crease = orientedLineResponse({
    width,
    height,
    directionalRange: relief.range,
    valid: relief.valid,
    normalRadiusX: Math.max(1, Math.ceil(POLICY.directional.creaseNormalRadiusMm * pixelsPerMmX)),
    normalRadiusY: Math.max(1, Math.ceil(POLICY.directional.creaseNormalRadiusMm * pixelsPerMmY)),
    tangentRadiusX: Math.max(1, Math.ceil(POLICY.directional.creaseTangentRadiusMm * pixelsPerMmX)),
    tangentRadiusY: Math.max(1, Math.ceil(POLICY.directional.creaseTangentRadiusMm * pixelsPerMmY)),
  });
  const deformationMean = boxStatistic(
    width,
    height,
    relief.range,
    Math.max(1, Math.ceil(POLICY.directional.deformationWindowRadiusMm * pixelsPerMmX)),
    Math.max(1, Math.ceil(POLICY.directional.deformationWindowRadiusMm * pixelsPerMmY)),
  );
  const deformation = Float32Array.from(deformationMean, (value, index) =>
    relief.valid[index] ? clamp(value / POLICY.directional.reliefFullScale) : 0);
  const scuffRadiusX = Math.max(1, Math.ceil(POLICY.directional.scuffWindowRadiusMm * pixelsPerMmX));
  const scuffRadiusY = Math.max(1, Math.ceil(POLICY.directional.scuffWindowRadiusMm * pixelsPerMmY));
  const localReliefMean = boxStatistic(width, height, relief.range, scuffRadiusX, scuffRadiusY);
  const highPassRelief = Float32Array.from(relief.range, (value, index) =>
    relief.valid[index] ? value - Number(localReliefMean[index]) : 0);
  const scuffRms = localRms(width, height, highPassRelief, scuffRadiusX, scuffRadiusY);
  const scuff = Float32Array.from(scuffRms, (value, index) =>
    relief.valid[index] ? clamp(value / POLICY.directional.reliefFullScale) : 0);
  const delamination = new Float32Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distanceToEnvelopeMm = Math.min(
        (x + 0.5) * mmPerPixelX,
        (width - x - 0.5) * mmPerPixelX,
        (y + 0.5) * mmPerPixelY,
        (height - y - 0.5) * mmPerPixelY,
      );
      const index = y * width + x;
      if (distanceToEnvelopeMm <= POLICY.directional.delaminationEdgeBandMm) {
        delamination[index] = deformation[index]!;
      }
    }
  }

  const roughnessRadiusX = Math.max(1, Math.ceil(POLICY.boundary.roughnessWindowMm * pixelsPerMmX));
  const roughnessRadiusY = Math.max(1, Math.ceil(POLICY.boundary.roughnessWindowMm * pixelsPerMmY));
  const observedBoundary = binaryBoundaryMask(width, height, material);
  const observedBoundaryOffset = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (!observedBoundary[index]) continue;
    observedBoundaryOffset[index] = Number(expectedMask[index]) > 0
      ? -Number(distanceToIntendedExterior[index])
      : Number(distanceToIntendedMaterial[index]);
  }
  const boundaryRms = maskedLocalRms(
    width,
    height,
    observedBoundaryOffset,
    observedBoundary,
    roughnessRadiusX,
    roughnessRadiusY,
  );
  const edgeRoughness = Float32Array.from(boundaryRms, (value, index) =>
    observedBoundary[index]
      ? clamp(value / POLICY.boundary.boundaryRoughnessFullScaleMm)
      : 0);
  // Fraying is a physical high-frequency cut-boundary response. It is never
  // derived from printed luminance gradients, so artwork cannot become fiber.
  const fraying = Float32Array.from(edgeRoughness, (value, index) =>
    observedBoundary[index] ? value : 0);

  let designDependentEvidence: "computed" | "unavailable_no_approved_reference" =
    "unavailable_no_approved_reference";
  let registeredColorDeltaE = new Float32Array(pixelCount);
  let registeredPrintDeltaE = new Float32Array(pixelCount);
  const registeredResidueDeltaE = new Float32Array(pixelCount);
  let exposedFiberResponse = new Float32Array(pixelCount);
  if (input.approvedDesignReferenceRgb && input.designRegistration) {
    const registered = registeredDesign({
      design: input.approvedDesignReferenceRgb,
      registration: input.designRegistration,
      width,
      height,
    });
    if (!registered) {
      return insufficient(input.side, ["Approved design registration transform is singular."], {
        requiresApprovedDesignReference: true,
      });
    }
    for (let index = 0; index < registered.valid.length; index += 1) {
      registered.valid[index] = registered.valid[index] && relief.valid[index] ? 1 : 0;
    }
    const differences = registeredColorDifferences({
      observed: input.normalizedAcceptedProfileRgb,
      reference: registered.rgb,
      valid: registered.valid,
    });
    if (!differences) {
      return insufficient(input.side, [
        "Approved design registration has fewer valid color samples than the centralized producer minimum.",
      ], { requiresRecapture: true, requiresApprovedDesignReference: true });
    }
    const stainRadiusX = Math.max(1, Math.ceil(POLICY.color.stainLowPassRadiusMm * pixelsPerMmX));
    const stainRadiusY = Math.max(1, Math.ceil(POLICY.color.stainLowPassRadiusMm * pixelsPerMmY));
    registeredColorDeltaE = boxStatistic(
      width,
      height,
      differences.deltaE,
      stainRadiusX,
      stainRadiusY,
    );
    const printRadiusX = Math.max(1, Math.ceil(POLICY.color.printHighPassRadiusMm * pixelsPerMmX));
    const printRadiusY = Math.max(1, Math.ceil(POLICY.color.printHighPassRadiusMm * pixelsPerMmY));
    const printLocalMean = boxStatistic(
      width,
      height,
      differences.deltaE,
      printRadiusX,
      printRadiusY,
    );
    registeredPrintDeltaE = Float32Array.from(differences.deltaE, (value, index) =>
      differences.valid[index] ? Math.abs(value - Number(printLocalMean[index])) : 0);
    exposedFiberResponse = Float32Array.from(differences.lightnessDelta, (value, index) =>
      differences.valid[index]
        ? clamp(value / POLICY.color.fiberLightnessDeltaFullScale)
        : 0);
    if (POLICY.unsupportedModalityGates.polarizedResidueSourceRequiredForPositiveResidue &&
        maximum(differences.chromaDelta) >= SURFACE_POLICY.minimumResidueDeltaE) {
      return insufficient(input.side, [
        "A positive residue/chroma candidate requires calibrated polarized residue evidence; V1 will not classify it from RGB alone.",
      ], { requiresRecapture: true, requiresCalibration: true });
    }
    designDependentEvidence = "computed";
  } else {
    const valid = Uint8Array.from(relief.valid);
    const differences = registeredColorDifferences({
      observed: input.normalizedAcceptedProfileRgb,
      reference: input.normalizedAllOnRgb.data,
      valid,
    });
    if (!differences) {
      return insufficient(input.side, [
        "Core all-on/accepted-profile evidence has too few valid samples to exclude an unexplained color candidate.",
      ], { requiresRecapture: true });
    }
    const lowPass = boxStatistic(
      width,
      height,
      differences.deltaE,
      Math.max(1, Math.ceil(POLICY.color.stainLowPassRadiusMm * pixelsPerMmX)),
      Math.max(1, Math.ceil(POLICY.color.stainLowPassRadiusMm * pixelsPerMmY)),
    );
    if (maximum(lowPass) >= SURFACE_POLICY.minimumStainDeltaE) {
      return insufficient(input.side, [
        "A significant unexplained color candidate exists without an approved design reference; it is not treated as clean or as damage.",
      ], { requiresRecapture: true, requiresApprovedDesignReference: true });
    }
  }

  return {
    version: FIXED_RIG_CONDITION_PLANE_PRODUCER_V1_VERSION,
    status: "computed",
    side: input.side,
    planes: {
      normalizedLuminance: plane(width, height, acceptedLuma),
      expectedOuterCardMask: plane(width, height, expectedMask),
      materialPresenceConfidence: plane(width, height, material),
      segmentationConfidence: plane(width, height, segmentationConfidence),
      boundaryConfidence: plane(width, height, boundaryConfidence),
      exposedFiberResponse: plane(width, height, exposedFiberResponse),
      signedBoundaryDeviationMm: plane(width, height, signedBoundaryDeviation),
      boundaryDeviationMm: plane(width, height, boundaryDeviation),
      deformationResponse: plane(width, height, deformation),
      delaminationResponse: plane(width, height, delamination),
      edgeRoughnessIndex: plane(width, height, edgeRoughness),
      frayingResponse: plane(width, height, fraying),
      scratchLineResponse: plane(width, height, scratch),
      scuffTextureResponse: plane(width, height, scuff),
      creaseLineResponse: plane(width, height, crease),
      chipDepthMm: plane(width, height, chipDepth),
      reliefIndex: plane(width, height, relief.relief),
      depthMm: zeroPlane(width, height),
      registeredColorDeltaE: plane(width, height, registeredColorDeltaE),
      registeredPrintDeltaE: plane(width, height, registeredPrintDeltaE),
      registeredResidueDeltaE: plane(width, height, registeredResidueDeltaE),
    },
    outerCutGeometryEvidence: {
      coordinateFrame: "normalized_card_portrait_pixels",
      observedContourSha256: observedArtifact.artifactSha256,
      intendedContourSha256: intendedBoundary.artifactSha256,
      intendedBoundaryProfileId: intendedBoundary.profileId,
      intendedBoundaryProfileVersion: intendedBoundary.profileVersion,
      observedContourPointCount: observedArtifact.normalizedContour.length,
      intendedContourPointCount: canonicalContour(intendedBoundary.contour).length,
      observedContourDetectorId: observedArtifact.detectorId,
      observedContourDetectorVersion: observedArtifact.detectorVersion,
      rawAllOnAssetId: observedArtifact.rawAllOnAssetId,
      rawAllOnAssetSha256: observedArtifact.rawAllOnAssetSha256,
      rawAllOnScalarPlaneSha256: observedArtifact.rawAllOnScalarPlaneSha256,
      rawToNormalizedTransformSha256: observedArtifact.rawToNormalizedTransformSha256,
      normalizedAllOnAssetId: observedArtifact.normalizedAllOnAssetId,
      normalizedAllOnAssetSha256: observedArtifact.normalizedAllOnAssetSha256,
      boundaryConfidence: observedArtifact.confidence,
      boundaryU95Mm: observedArtifact.u95Mm,
      observedArtifact,
    },
    designDependentEvidence,
    unavailableModalities: [
      "metric_depth",
      "polarized_residue",
      ...(designDependentEvidence === "unavailable_no_approved_reference"
        ? ["design_relative_color" as const]
        : []),
    ],
    sourceEvidence: input.sourceEvidence.map((reference) => ({ ...reference })),
    heatmapUsedAsInput: false,
    manualPlaneUsedAsInput: false,
    formulas: POLICY.formulas,
  };
}
