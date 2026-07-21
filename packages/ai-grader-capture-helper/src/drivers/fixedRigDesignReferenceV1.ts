import { createHash } from "node:crypto";
import {
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  mathematicalCenteringRegistrationV1Schema,
  mathematicalDesignReferenceV1Schema,
  validateMathematicalDesignReferencePixelContourV1,
  type MathematicalDesignReferenceV1,
} from "@tenkings/shared";
import type {
  FixedRigCenteringRegistrationV1,
  FixedRigExactCardIdentityV1,
} from "./fixedRigCenteringV1";

export const FIXED_RIG_DESIGN_REFERENCE_PROJECTION_V1_VERSION =
  "fixed_rig_design_reference_projection_v1" as const;
export const FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION =
  "fixed_rig_design_reference_registration_v1.1.0" as const;
export const FIXED_RIG_DESIGN_REFERENCE_CORRESPONDENCE_LEDGER_V1_SCHEMA_VERSION =
  "fixed-rig-design-reference-correspondence-ledger-v1" as const;
export const AI_GRADER_INTENDED_DESIGN_BOUNDARY_V1_SCHEMA_VERSION =
  "ai-grader-intended-design-boundary-v1" as const;

export interface FixedRigApprovedDesignReferencePixelsV1 extends FixedRigExactCardIdentityV1 {
  referenceId: string;
  profile: "registered_design_template_v1";
  status: "approved";
  side: "front" | "back";
  version: number;
  artifactSha256: string;
  artifactWidthPx: number;
  artifactHeightPx: number;
  intendedDesignBoundary: {
    schemaVersion: typeof AI_GRADER_INTENDED_DESIGN_BOUNDARY_V1_SCHEMA_VERSION;
    coordinateFrame: "design_reference_pixels";
    contour: unknown;
  };
  approvedByUserId: string;
  approvedAt: string | Date;
}

export interface FixedRigImmutableRasterEvidenceV1 {
  assetId: string;
  sha256: string;
  bytes: Uint8Array;
}

export interface FixedRigNormalizedSourceEvidenceV1 extends FixedRigImmutableRasterEvidenceV1 {
  side: "front" | "back";
  coordinateFrame: "normalized_card_portrait_pixels";
  widthPx: number;
  heightPx: number;
}

export interface FixedRigDesignReferenceCorrespondenceV1 {
  correspondenceId: string;
  designReferencePointPx: { x: number; y: number };
  normalizedSourcePointPx: { x: number; y: number };
}

export interface ProjectApprovedFixedRigDesignReferenceV1Input {
  approvedReference: FixedRigApprovedDesignReferencePixelsV1;
  artifactEvidence: FixedRigImmutableRasterEvidenceV1;
  normalizedSourceEvidence: FixedRigNormalizedSourceEvidenceV1;
  transformType: "affine" | "homography";
  correspondences: FixedRigDesignReferenceCorrespondenceV1[];
}

export interface FixedRigDesignReferenceCorrespondenceLedgerV1 {
  schemaVersion: typeof FIXED_RIG_DESIGN_REFERENCE_CORRESPONDENCE_LEDGER_V1_SCHEMA_VERSION;
  registrationAlgorithmVersion: typeof FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION;
  designReferenceId: string;
  designReferenceVersion: number;
  designReferenceSha256: string;
  designReferenceWidthPx: number;
  designReferenceHeightPx: number;
  artifactEvidenceId: string;
  normalizedSourceEvidenceId: string;
  normalizedSourceEvidenceSha256: string;
  normalizedSourceSide: "front" | "back";
  normalizedSourceWidthPx: number;
  normalizedSourceHeightPx: number;
  coordinateFrame: "design_reference_pixels_to_normalized_card_portrait_pixels";
  transformType: "affine" | "homography";
  correspondences: FixedRigDesignReferenceCorrespondenceV1[];
}

export interface FixedRigDesignReferenceRegistrationBindingV1 {
  profile: "registered_design_template_v1";
  designReferenceId: string;
  designReferenceVersion: number;
  designReferenceSha256: string;
  artifactEvidenceId: string;
  normalizedSourceEvidenceId: string;
  normalizedSourceEvidenceSha256: string;
  registrationAlgorithmVersion: typeof FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION;
  correspondenceCount: number;
  inlierCorrespondenceIds: string[];
  correspondenceLedgerSha256: string;
  registrationSha256: string;
  correspondenceLedger: FixedRigDesignReferenceCorrespondenceLedgerV1;
}

export interface ProjectedApprovedFixedRigDesignReferenceV1 {
  version: typeof FIXED_RIG_DESIGN_REFERENCE_PROJECTION_V1_VERSION;
  designReference: MathematicalDesignReferenceV1;
  registration: FixedRigCenteringRegistrationV1;
  binding: FixedRigDesignReferenceRegistrationBindingV1;
  centeringProfileInput: {
    profile: "registered_design_template_v1";
    exactIdentity: FixedRigExactCardIdentityV1;
    designReference: MathematicalDesignReferenceV1;
    registration: FixedRigCenteringRegistrationV1;
    registrationBinding: FixedRigDesignReferenceRegistrationBindingV1;
  };
}

export type FixedRigDesignReferenceRegistrationVerificationV1 =
  | { valid: true }
  | { valid: false; reason: string };

interface ComputedRegistrationV1 {
  registration: FixedRigCenteringRegistrationV1;
  inlierCorrespondenceIds: string[];
}

export class FixedRigDesignReferenceProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedRigDesignReferenceProjectionError";
  }
}

function fail(message: string): never {
  throw new FixedRigDesignReferenceProjectionError(message);
}

function round(value: number, decimals = 9): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function canonicalApprovalTimestamp(value: string | Date): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) return fail("Approved design reference has no valid approval timestamp.");
  return date.toISOString();
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x, y: point.y };
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function solveLeastSquares(rows: readonly number[][], values: readonly number[], unknownCount: number): number[] | null {
  if (rows.length !== values.length || rows.length < unknownCount) return null;
  const normal = Array.from({ length: unknownCount }, () => Array<number>(unknownCount).fill(0));
  const right = Array<number>(unknownCount).fill(0);
  rows.forEach((row, rowIndex) => {
    for (let column = 0; column < unknownCount; column += 1) {
      right[column] += row[column]! * values[rowIndex]!;
      for (let other = 0; other < unknownCount; other += 1) {
        normal[column]![other] += row[column]! * row[other]!;
      }
    }
  });
  const augmented = normal.map((row, index) => [...row, right[index]!]);
  for (let column = 0; column < unknownCount; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < unknownCount; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    const scale = Math.max(1, ...augmented[pivot]!.slice(0, unknownCount).map(Math.abs));
    if (Math.abs(augmented[pivot]![column]!) <= Number.EPSILON * unknownCount * scale) return null;
    if (pivot !== column) [augmented[pivot], augmented[column]] = [augmented[column]!, augmented[pivot]!];
    const divisor = augmented[column]![column]!;
    for (let entry = column; entry <= unknownCount; entry += 1) {
      augmented[column]![entry] /= divisor;
    }
    for (let row = 0; row < unknownCount; row += 1) {
      if (row === column) continue;
      const multiplier = augmented[row]![column]!;
      for (let entry = column; entry <= unknownCount; entry += 1) {
        augmented[row]![entry] -= multiplier * augmented[column]![entry]!;
      }
    }
  }
  const solution = augmented.map((row) => row[unknownCount]!);
  return solution.every(Number.isFinite) ? solution : null;
}

function hasTwoDimensionalSpread(points: readonly { x: number; y: number }[]): boolean {
  if (points.length < 3) return false;
  const origin = points[0]!;
  let baseline = points[1]!;
  let maximumDistance = 0;
  for (const point of points.slice(1)) {
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      baseline = point;
    }
  }
  if (maximumDistance <= Number.EPSILON) return false;
  return points.some((point) => {
    const doubleArea = Math.abs(
      (baseline.x - origin.x) * (point.y - origin.y) -
      (baseline.y - origin.y) * (point.x - origin.x),
    );
    return doubleArea > Number.EPSILON * Math.max(1, maximumDistance ** 2) * points.length;
  });
}

function fitTransform(
  ledger: FixedRigDesignReferenceCorrespondenceLedgerV1,
  activeIndexes: readonly number[],
): number[] | null {
  const normalizedReferencePoints = activeIndexes.map((index) => ({
    x: ledger.correspondences[index]!.designReferencePointPx.x / ledger.designReferenceWidthPx,
    y: ledger.correspondences[index]!.designReferencePointPx.y / ledger.designReferenceHeightPx,
  }));
  const normalizedSourcePoints = activeIndexes.map((index) => ({
    x: ledger.correspondences[index]!.normalizedSourcePointPx.x / ledger.normalizedSourceWidthPx,
    y: ledger.correspondences[index]!.normalizedSourcePointPx.y / ledger.normalizedSourceHeightPx,
  }));
  if (!hasTwoDimensionalSpread(normalizedReferencePoints) ||
      !hasTwoDimensionalSpread(normalizedSourcePoints)) return null;
  const rows: number[][] = [];
  const values: number[] = [];
  activeIndexes.forEach((index) => {
    const correspondence = ledger.correspondences[index]!;
    const referenceX = correspondence.designReferencePointPx.x / ledger.designReferenceWidthPx;
    const referenceY = correspondence.designReferencePointPx.y / ledger.designReferenceHeightPx;
    const sourceX = correspondence.normalizedSourcePointPx.x / ledger.normalizedSourceWidthPx;
    const sourceY = correspondence.normalizedSourcePointPx.y / ledger.normalizedSourceHeightPx;
    if (ledger.transformType === "affine") {
      rows.push([referenceX, referenceY, 1, 0, 0, 0]);
      values.push(sourceX);
      rows.push([0, 0, 0, referenceX, referenceY, 1]);
      values.push(sourceY);
    } else {
      rows.push([
        referenceX, referenceY, 1, 0, 0, 0,
        -sourceX * referenceX, -sourceX * referenceY,
      ]);
      values.push(sourceX);
      rows.push([
        0, 0, 0, referenceX, referenceY, 1,
        -sourceY * referenceX, -sourceY * referenceY,
      ]);
      values.push(sourceY);
    }
  });
  const normalized = solveLeastSquares(rows, values, ledger.transformType === "affine" ? 6 : 8);
  if (!normalized) return null;
  const referenceWidth = ledger.designReferenceWidthPx;
  const referenceHeight = ledger.designReferenceHeightPx;
  const sourceWidth = ledger.normalizedSourceWidthPx;
  const sourceHeight = ledger.normalizedSourceHeightPx;
  if (ledger.transformType === "affine") {
    return [
      sourceWidth * normalized[0]! / referenceWidth,
      sourceWidth * normalized[1]! / referenceHeight,
      sourceWidth * normalized[2]!,
      sourceHeight * normalized[3]! / referenceWidth,
      sourceHeight * normalized[4]! / referenceHeight,
      sourceHeight * normalized[5]!,
    ];
  }
  return [
    sourceWidth * normalized[0]! / referenceWidth,
    sourceWidth * normalized[1]! / referenceHeight,
    sourceWidth * normalized[2]!,
    sourceHeight * normalized[3]! / referenceWidth,
    sourceHeight * normalized[4]! / referenceHeight,
    sourceHeight * normalized[5]!,
    normalized[6]! / referenceWidth,
    normalized[7]! / referenceHeight,
    1,
  ];
}

function applyTransform(
  point: { x: number; y: number },
  transformType: "affine" | "homography",
  matrix: readonly number[],
): { x: number; y: number } | null {
  if (transformType === "affine") {
    const x = matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!;
    const y = matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  const denominator = matrix[6]! * point.x + matrix[7]! * point.y + matrix[8]!;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) return null;
  const x = (matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!) / denominator;
  const y = (matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function registrationResiduals(
  ledger: FixedRigDesignReferenceCorrespondenceLedgerV1,
  matrix: readonly number[],
): number[] | null {
  const residuals: number[] = [];
  for (const correspondence of ledger.correspondences) {
    const projected = applyTransform(
      correspondence.designReferencePointPx,
      ledger.transformType,
      matrix,
    );
    if (!projected) return null;
    residuals.push(Math.hypot(
      projected.x - correspondence.normalizedSourcePointPx.x,
      projected.y - correspondence.normalizedSourcePointPx.y,
    ));
  }
  return residuals;
}

function sameIndexes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function computeRegistration(
  ledger: FixedRigDesignReferenceCorrespondenceLedgerV1,
): ComputedRegistrationV1 {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
  const minimumAcceptedCount = Math.max(
    policy.minimumInlierCount,
    Math.ceil(policy.minimumInlierFraction * ledger.correspondences.length),
  );
  let activeIndexes = ledger.correspondences.map((_, index) => index);
  const seen = new Set<string>();
  for (let iteration = 0; iteration <= ledger.correspondences.length; iteration += 1) {
    const signature = activeIndexes.join(",");
    if (seen.has(signature)) break;
    seen.add(signature);
    const candidateMatrix = fitTransform(ledger, activeIndexes);
    if (!candidateMatrix) return fail("Correspondence geometry is degenerate for the requested transform.");
    const residuals = registrationResiduals(ledger, candidateMatrix);
    if (!residuals) return fail("Correspondence transform produced a non-finite projected point.");
    const thresholdInliers = residuals.flatMap((residual, index) =>
      residual <= policy.maximumRegistrationResidualPx ? [index] : []);
    const nextIndexes = thresholdInliers.length >= minimumAcceptedCount
      ? thresholdInliers
      : residuals
        .map((residual, index) => ({ residual, index }))
        .sort((left, right) => left.residual - right.residual || left.index - right.index)
        .slice(0, minimumAcceptedCount)
        .map((entry) => entry.index)
        .sort((left, right) => left - right);
    if (sameIndexes(activeIndexes, nextIndexes)) break;
    activeIndexes = nextIndexes;
  }
  for (let iteration = 0; iteration <= ledger.correspondences.length; iteration += 1) {
    const candidateMatrix = fitTransform(ledger, activeIndexes);
    if (!candidateMatrix) return fail("Accepted correspondence inliers are geometrically degenerate.");
    const residuals = registrationResiduals(ledger, candidateMatrix);
    if (!residuals) return fail("Accepted correspondence transform produced a non-finite projected point.");
    const thresholdInliers = residuals.flatMap((residual, index) =>
      residual <= policy.maximumRegistrationResidualPx ? [index] : []);
    if (sameIndexes(activeIndexes, thresholdInliers)) break;
    activeIndexes = thresholdInliers;
    if (activeIndexes.length < minimumAcceptedCount) {
      return fail("Computed registration has insufficient residual-qualified correspondence inliers.");
    }
  }
  const matrix = fitTransform(ledger, activeIndexes);
  if (!matrix) return fail("Final correspondence inliers are geometrically degenerate.");
  const residuals = registrationResiduals(ledger, matrix);
  if (!residuals) return fail("Final correspondence transform produced a non-finite projected point.");
  const finalInliers = residuals.flatMap((residual, index) =>
    residual <= policy.maximumRegistrationResidualPx ? [index] : []);
  if (!sameIndexes(activeIndexes, finalInliers)) {
    return fail("Final correspondence fit did not converge to a stable residual-qualified inlier set.");
  }
  const registrationResidualPx = Math.sqrt(
    finalInliers.reduce((sum, index) => sum + residuals[index]! ** 2, 0) / finalInliers.length,
  );
  const inlierFraction = finalInliers.length / ledger.correspondences.length;
  const confidencePolicy = policy.registrationConfidence;
  const residualConfidence = registrationResidualPx <= confidencePolicy.fullConfidenceResidualPx
    ? 1
    : Math.max(
        0,
        confidencePolicy.confidenceAtMaximumResidual +
          (1 - confidencePolicy.confidenceAtMaximumResidual) *
          (policy.maximumRegistrationResidualPx - registrationResidualPx) /
          (policy.maximumRegistrationResidualPx - confidencePolicy.fullConfidenceResidualPx),
      );
  const inlierConfidence = inlierFraction >= 1
    ? 1
    : Math.max(
        0,
        confidencePolicy.confidenceAtMinimumInlierFraction +
          (1 - confidencePolicy.confidenceAtMinimumInlierFraction) *
          (inlierFraction - policy.minimumInlierFraction) /
          (1 - policy.minimumInlierFraction),
      );
  const confidence = Math.min(inlierConfidence, residualConfidence);
  if (
    finalInliers.length < policy.minimumInlierCount ||
    inlierFraction < policy.minimumInlierFraction ||
    registrationResidualPx > policy.maximumRegistrationResidualPx ||
    confidence < policy.minimumRegistrationConfidence
  ) {
    return fail("Computed registration fails the manifest residual, inlier, or confidence acceptance gate.");
  }
  const registration = mathematicalCenteringRegistrationV1Schema.parse({
    profile: "registered_design_template_v1",
    designReferenceId: ledger.designReferenceId,
    designReferenceSha256: ledger.designReferenceSha256,
    transformType: ledger.transformType,
    transformMatrix: matrix.map((value) => round(value, 12)),
    registrationResidualPx: round(registrationResidualPx, 6),
    inlierCount: finalInliers.length,
    inlierFraction: round(inlierFraction, 6),
    confidence: round(confidence, 6),
  });
  return {
    registration,
    inlierCorrespondenceIds: finalInliers.map(
      (index) => ledger.correspondences[index]!.correspondenceId,
    ),
  };
}

function registrationSha256(input: {
  ledgerSha256: string;
  registration: FixedRigCenteringRegistrationV1;
  inlierCorrespondenceIds: readonly string[];
}): string {
  return canonicalSha256({
    registrationAlgorithmVersion: FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION,
    correspondenceLedgerSha256: input.ledgerSha256,
    profile: input.registration.profile,
    designReferenceId: input.registration.designReferenceId,
    designReferenceSha256: input.registration.designReferenceSha256,
    transformType: input.registration.transformType,
    transformMatrix: input.registration.transformMatrix,
    registrationResidualPx: input.registration.registrationResidualPx,
    inlierCount: input.registration.inlierCount,
    inlierFraction: input.registration.inlierFraction,
    confidence: input.registration.confidence,
    inlierCorrespondenceIds: input.inlierCorrespondenceIds,
  });
}

function validateAndCopyCorrespondences(
  input: ProjectApprovedFixedRigDesignReferenceV1Input,
): FixedRigDesignReferenceCorrespondenceV1[] {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
  if (input.correspondences.length < policy.minimumInlierCount) {
    return fail("Correspondence ledger has fewer than the manifest minimum correspondence count.");
  }
  const ids = new Set<string>();
  const referenceCoordinates = new Set<string>();
  const sourceCoordinates = new Set<string>();
  const copied = input.correspondences.map((entry) => {
    if (!validIdentifier(entry.correspondenceId) || ids.has(entry.correspondenceId)) {
      return fail("Correspondence ids must be valid and unique.");
    }
    ids.add(entry.correspondenceId);
    const reference = entry.designReferencePointPx;
    const source = entry.normalizedSourcePointPx;
    if (
      !Number.isFinite(reference.x) || !Number.isFinite(reference.y) ||
      reference.x < 0 || reference.x > input.approvedReference.artifactWidthPx ||
      reference.y < 0 || reference.y > input.approvedReference.artifactHeightPx
    ) return fail("A design-reference correspondence point lies outside the approved artifact.");
    if (
      !Number.isFinite(source.x) || !Number.isFinite(source.y) ||
      source.x < 0 || source.x > input.normalizedSourceEvidence.widthPx ||
      source.y < 0 || source.y > input.normalizedSourceEvidence.heightPx
    ) return fail("A normalized-source correspondence point lies outside the immutable source artifact.");
    const referenceKey = reference.x + "," + reference.y;
    const sourceKey = source.x + "," + source.y;
    if (referenceCoordinates.has(referenceKey) || sourceCoordinates.has(sourceKey)) {
      return fail("Correspondence points must be unique in both coordinate frames.");
    }
    referenceCoordinates.add(referenceKey);
    sourceCoordinates.add(sourceKey);
    return {
      correspondenceId: entry.correspondenceId,
      designReferencePointPx: exactPoint(reference),
      normalizedSourcePointPx: exactPoint(source),
    };
  });
  return copied.sort((left, right) => left.correspondenceId.localeCompare(right.correspondenceId));
}

function exactIdentity(reference: FixedRigApprovedDesignReferencePixelsV1): FixedRigExactCardIdentityV1 {
  return {
    tenantId: reference.tenantId,
    setId: reference.setId,
    programId: reference.programId,
    cardNumber: reference.cardNumber,
    variantId: reference.variantId,
    parallelId: reference.parallelId,
  };
}

function projectDesignReference(
  input: ProjectApprovedFixedRigDesignReferenceV1Input,
  contour: readonly (readonly [number, number])[],
): MathematicalDesignReferenceV1 {
  const reference = input.approvedReference;
  const parsed = mathematicalDesignReferenceV1Schema.safeParse({
    schemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    designReferenceId: reference.referenceId,
    profile: reference.profile,
    tenantId: reference.tenantId,
    setId: reference.setId,
    programId: reference.programId,
    cardNumber: reference.cardNumber,
    variantId: reference.variantId,
    parallelId: reference.parallelId,
    side: reference.side,
    artifactId: input.artifactEvidence.assetId,
    artifactSha256: reference.artifactSha256,
    version: reference.version,
    widthPx: reference.artifactWidthPx,
    heightPx: reference.artifactHeightPx,
    intendedPrintBoundary: contour.map(([x, y]) => ({
      x: x / reference.artifactWidthPx,
      y: y / reference.artifactHeightPx,
    })),
    approvedBy: reference.approvedByUserId,
    approvedAt: canonicalApprovalTimestamp(reference.approvedAt),
  });
  if (!parsed.success) {
    return fail("Approved database reference cannot be represented by the strict Mathematical Design Reference V1 schema.");
  }
  return parsed.data;
}

/**
 * Verifies exact approved/source bytes, creates a canonical correspondence
 * ledger, and computes every registration metric from those correspondences.
 * No caller may supply a transform, residual, inlier count, or confidence.
 */
export function projectApprovedFixedRigDesignReferenceV1(
  input: ProjectApprovedFixedRigDesignReferenceV1Input,
): ProjectedApprovedFixedRigDesignReferenceV1 {
  const reference = input.approvedReference;
  if (reference.status !== "approved" || reference.profile !== "registered_design_template_v1") {
    return fail("Only an approved registered_design_template_v1 reference may be projected.");
  }
  if (!Number.isSafeInteger(reference.version) || reference.version < 1) {
    return fail("Approved design-reference version must be a positive integer.");
  }
  if (
    !Number.isSafeInteger(reference.artifactWidthPx) || reference.artifactWidthPx < 1 ||
    !Number.isSafeInteger(reference.artifactHeightPx) || reference.artifactHeightPx < 1
  ) return fail("Approved design-reference artifact dimensions are invalid.");
  if (!isSha256(reference.artifactSha256)) {
    return fail("Approved design-reference artifact SHA-256 is invalid.");
  }
  if (!reference.approvedByUserId) return fail("Approved design reference has no approving user identity.");
  if (
    reference.intendedDesignBoundary?.schemaVersion !==
      AI_GRADER_INTENDED_DESIGN_BOUNDARY_V1_SCHEMA_VERSION ||
    reference.intendedDesignBoundary?.coordinateFrame !== "design_reference_pixels"
  ) {
    return fail("Approved intended-design boundary is not in the versioned design_reference_pixels frame.");
  }
  const contour = validateMathematicalDesignReferencePixelContourV1(
    reference.intendedDesignBoundary.contour,
    reference.artifactWidthPx,
    reference.artifactHeightPx,
  );
  if (!contour.valid) return fail(`Approved intended-design contour is invalid: ${contour.issues.join("; ")}.`);
  if (
    !validIdentifier(input.artifactEvidence.assetId) ||
    !(input.artifactEvidence.bytes instanceof Uint8Array) ||
    !input.artifactEvidence.bytes.byteLength ||
    !isSha256(input.artifactEvidence.sha256) ||
    sha256Bytes(input.artifactEvidence.bytes) !== input.artifactEvidence.sha256 ||
    input.artifactEvidence.sha256 !== reference.artifactSha256
  ) return fail("Approved design-reference artifact bytes do not exactly match the approved SHA-256.");
  const source = input.normalizedSourceEvidence;
  if (
    !validIdentifier(source.assetId) ||
    source.coordinateFrame !== "normalized_card_portrait_pixels" ||
    source.side !== reference.side ||
    !Number.isSafeInteger(source.widthPx) || source.widthPx < 1 ||
    !Number.isSafeInteger(source.heightPx) || source.heightPx < 1 ||
    !(source.bytes instanceof Uint8Array) || !source.bytes.byteLength ||
    !isSha256(source.sha256) ||
    sha256Bytes(source.bytes) !== source.sha256
  ) return fail("Normalized source evidence bytes, hash, side, dimensions, or coordinate frame are invalid.");
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
  if (!policy.allowedTransforms.includes(input.transformType)) {
    return fail("Requested registration transform is not allowed by the threshold manifest.");
  }
  const correspondences = validateAndCopyCorrespondences(input);
  const ledger: FixedRigDesignReferenceCorrespondenceLedgerV1 = {
    schemaVersion: FIXED_RIG_DESIGN_REFERENCE_CORRESPONDENCE_LEDGER_V1_SCHEMA_VERSION,
    registrationAlgorithmVersion: FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION,
    designReferenceId: reference.referenceId,
    designReferenceVersion: reference.version,
    designReferenceSha256: reference.artifactSha256,
    designReferenceWidthPx: reference.artifactWidthPx,
    designReferenceHeightPx: reference.artifactHeightPx,
    artifactEvidenceId: input.artifactEvidence.assetId,
    normalizedSourceEvidenceId: source.assetId,
    normalizedSourceEvidenceSha256: source.sha256,
    normalizedSourceSide: source.side,
    normalizedSourceWidthPx: source.widthPx,
    normalizedSourceHeightPx: source.heightPx,
    coordinateFrame: "design_reference_pixels_to_normalized_card_portrait_pixels",
    transformType: input.transformType,
    correspondences,
  };
  const computed = computeRegistration(ledger);
  const correspondenceLedgerSha256 = canonicalSha256(ledger);
  const computedRegistrationSha256 = registrationSha256({
    ledgerSha256: correspondenceLedgerSha256,
    registration: computed.registration,
    inlierCorrespondenceIds: computed.inlierCorrespondenceIds,
  });
  const designReference = projectDesignReference(input, contour.contour);
  const binding: FixedRigDesignReferenceRegistrationBindingV1 = {
    profile: "registered_design_template_v1",
    designReferenceId: reference.referenceId,
    designReferenceVersion: reference.version,
    designReferenceSha256: reference.artifactSha256,
    artifactEvidenceId: input.artifactEvidence.assetId,
    normalizedSourceEvidenceId: source.assetId,
    normalizedSourceEvidenceSha256: source.sha256,
    registrationAlgorithmVersion: FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION,
    correspondenceCount: ledger.correspondences.length,
    inlierCorrespondenceIds: [...computed.inlierCorrespondenceIds],
    correspondenceLedgerSha256,
    registrationSha256: computedRegistrationSha256,
    correspondenceLedger: {
      ...ledger,
      correspondences: ledger.correspondences.map((entry) => ({
        correspondenceId: entry.correspondenceId,
        designReferencePointPx: { ...entry.designReferencePointPx },
        normalizedSourcePointPx: { ...entry.normalizedSourcePointPx },
      })),
    },
  };
  const centeringProfileInput = {
    profile: "registered_design_template_v1" as const,
    exactIdentity: exactIdentity(reference),
    designReference,
    registration: computed.registration,
    registrationBinding: binding,
  };
  return {
    version: FIXED_RIG_DESIGN_REFERENCE_PROJECTION_V1_VERSION,
    designReference,
    registration: computed.registration,
    binding,
    centeringProfileInput,
  };
}

/**
 * Recomputes the ledger hash, transform, residuals, inliers, confidence and
 * registration hash before the centering seam accepts registered evidence.
 */
export function verifyFixedRigDesignReferenceRegistrationBindingV1(input: {
  designReference: MathematicalDesignReferenceV1;
  registration: FixedRigCenteringRegistrationV1;
  binding: FixedRigDesignReferenceRegistrationBindingV1;
}): FixedRigDesignReferenceRegistrationVerificationV1 {
  try {
    const { designReference, registration, binding } = input;
    const ledger = binding.correspondenceLedger;
    if (
      binding.profile !== "registered_design_template_v1" ||
      binding.registrationAlgorithmVersion !== FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION ||
      ledger.schemaVersion !== FIXED_RIG_DESIGN_REFERENCE_CORRESPONDENCE_LEDGER_V1_SCHEMA_VERSION ||
      ledger.registrationAlgorithmVersion !== FIXED_RIG_DESIGN_REFERENCE_REGISTRATION_V1_VERSION ||
      binding.designReferenceId !== designReference.designReferenceId ||
      binding.designReferenceVersion !== designReference.version ||
      binding.designReferenceSha256 !== designReference.artifactSha256 ||
      ledger.designReferenceId !== designReference.designReferenceId ||
      ledger.designReferenceVersion !== designReference.version ||
      ledger.designReferenceSha256 !== designReference.artifactSha256 ||
      ledger.designReferenceWidthPx !== designReference.widthPx ||
      ledger.designReferenceHeightPx !== designReference.heightPx ||
      binding.artifactEvidenceId !== designReference.artifactId ||
      ledger.artifactEvidenceId !== binding.artifactEvidenceId ||
      ledger.normalizedSourceEvidenceId !== binding.normalizedSourceEvidenceId ||
      ledger.normalizedSourceEvidenceSha256 !== binding.normalizedSourceEvidenceSha256 ||
      binding.correspondenceCount !== ledger.correspondences.length
    ) return { valid: false, reason: "Registration binding metadata does not match the approved design/source evidence." };
    if (
      !isSha256(binding.normalizedSourceEvidenceSha256) ||
      !isSha256(binding.correspondenceLedgerSha256) ||
      !isSha256(binding.registrationSha256) ||
      canonicalSha256(ledger) !== binding.correspondenceLedgerSha256
    ) return { valid: false, reason: "Registration correspondence ledger hash is invalid." };
    const computed = computeRegistration(ledger);
    if (
      registration.profile !== computed.registration.profile ||
      registration.designReferenceId !== computed.registration.designReferenceId ||
      registration.designReferenceSha256 !== computed.registration.designReferenceSha256 ||
      registration.transformType !== computed.registration.transformType ||
      !sameNumbers(registration.transformMatrix, computed.registration.transformMatrix) ||
      registration.registrationResidualPx !== computed.registration.registrationResidualPx ||
      registration.inlierCount !== computed.registration.inlierCount ||
      registration.inlierFraction !== computed.registration.inlierFraction ||
      registration.confidence !== computed.registration.confidence ||
      !sameStrings(binding.inlierCorrespondenceIds, computed.inlierCorrespondenceIds)
    ) return { valid: false, reason: "Registration transform or quality metrics do not reproduce from the bound correspondence ledger." };
    const expectedRegistrationSha256 = registrationSha256({
      ledgerSha256: binding.correspondenceLedgerSha256,
      registration: computed.registration,
      inlierCorrespondenceIds: computed.inlierCorrespondenceIds,
    });
    if (expectedRegistrationSha256 !== binding.registrationSha256) {
      return { valid: false, reason: "Registration result hash is invalid." };
    }
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "Registration binding verification failed.",
    };
  }
}
