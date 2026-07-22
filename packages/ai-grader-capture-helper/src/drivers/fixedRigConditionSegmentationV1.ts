import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  grade10BufferV1,
  mathematicalDesignReferenceV1Schema,
  mathematicalEvidenceReferenceV1Schema,
  type MathematicalDesignReferenceV1,
  type MathematicalMeasurementV1,
} from "@tenkings/shared";
import type {
  FixedRigConditionMeasurementCalibrationV1,
  FixedRigCornerObservationInputV1,
  FixedRigEdgeObservationInputV1,
} from "./fixedRigCornerEdgeV1";
import {
  FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION,
  type FixedRigPhotometricEvidenceV1,
  type FixedRigScalarPlaneV1,
} from "./fixedRigPhotometricEvidenceV1";
import type {
  FixedRigSurfaceCandidateSeedV1,
  FixedRigSurfaceCategoryV1,
  FixedRigSurfaceChannelSupportV1,
} from "./fixedRigSurfaceV1";
import { deriveFixedRigMeasurementUncertaintyV1 } from "./fixedRigMeasurementUncertaintyV1";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";

export const FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION =
  "fixed_rig_condition_segmentation_v1.2.0" as const;

type EvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];

export interface FixedRigConditionSegmentationCardIdentityV1 {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
}

export interface FixedRigConditionDesignRegistrationV1 {
  designReferenceId: string;
  designReferenceSha256: string;
  transformType: "affine" | "homography";
  transformMatrix: number[];
  registrationResidualPx: number;
  inlierCount: number;
  inlierFraction: number;
  confidence: number;
}

/**
 * Every plane is registered to the finalized normalized-card coordinate frame.
 * Response planes are quantitative calibrated detector responses, not rendered
 * heatmaps or human-authored masks. Optional properties make absence a runtime
 * insufficient-evidence result instead of a silent detector fallback.
 */
export interface FixedRigConditionSourcePlanesV1 {
  normalizedLuminance?: FixedRigScalarPlaneV1;
  expectedOuterCardMask?: FixedRigScalarPlaneV1;
  materialPresenceConfidence?: FixedRigScalarPlaneV1;
  segmentationConfidence?: FixedRigScalarPlaneV1;
  boundaryConfidence?: FixedRigScalarPlaneV1;
  exposedFiberResponse?: FixedRigScalarPlaneV1;
  boundaryDeviationMm?: FixedRigScalarPlaneV1;
  deformationResponse?: FixedRigScalarPlaneV1;
  delaminationResponse?: FixedRigScalarPlaneV1;
  edgeRoughnessIndex?: FixedRigScalarPlaneV1;
  frayingResponse?: FixedRigScalarPlaneV1;
  scratchLineResponse?: FixedRigScalarPlaneV1;
  scuffTextureResponse?: FixedRigScalarPlaneV1;
  creaseLineResponse?: FixedRigScalarPlaneV1;
  chipDepthMm?: FixedRigScalarPlaneV1;
  reliefIndex?: FixedRigScalarPlaneV1;
  depthMm?: FixedRigScalarPlaneV1;
  registeredColorDeltaE?: FixedRigScalarPlaneV1;
  registeredPrintDeltaE?: FixedRigScalarPlaneV1;
  registeredResidueDeltaE?: FixedRigScalarPlaneV1;
}

export interface BuildFixedRigConditionSegmentationV1Input {
  side: "front" | "back";
  cardIdentity: FixedRigConditionSegmentationCardIdentityV1;
  designReference?: MathematicalDesignReferenceV1;
  designRegistration?: FixedRigConditionDesignRegistrationV1;
  photometricEvidence: FixedRigPhotometricEvidenceV1;
  measurementCalibration: FixedRigConditionMeasurementCalibrationV1;
  algorithmVersion: string;
  sourceEvidence: EvidenceReferenceV1[];
  planes: FixedRigConditionSourcePlanesV1;
  unavailableModalities?: Array<
    "metric_depth" | "polarized_residue" | "design_relative_color"
  >;
}

export type FixedRigConditionSegmentationV1Result =
  | {
      version: typeof FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION;
      status: "computed";
      side: "front" | "back";
      coordinateFrame: "normalized_card_portrait_pixels";
      width: number;
      height: number;
      thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
      thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
      calibrationProfileId: string;
      calibrationVersion: string;
      calibrationSha256: string;
      designReferenceId?: string;
      designReferenceSha256?: string;
      conditionValidEvidenceMask: FixedRigScalarPlaneV1;
      boundaryValidEvidenceMask: FixedRigScalarPlaneV1;
      cornerObservations: FixedRigCornerObservationInputV1[];
      edgeObservations: FixedRigEdgeObservationInputV1[];
      surfaceCandidateSeeds: FixedRigSurfaceCandidateSeedV1[];
      surfaceDepthMm?: FixedRigScalarPlaneV1;
      surfaceReliefIndex: FixedRigScalarPlaneV1;
      validEvidenceCoverage: number;
      excludedExpectedPixelFraction: number;
      evidenceQualityLimitations: Array<{
        code:
          | "invalid_condition_evidence_excluded"
          | "design_dependent_condition_evidence_unavailable";
        affectedPixelFraction: number;
        requiresRecapture: boolean;
        message: string;
      }>;
      invalidPixelsBecameDefects: false;
      invalidPixelsProvedClean: false;
    }
  | {
      version: typeof FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION;
      status: "insufficient_evidence";
      side: "front" | "back";
      reasons: string[];
      requiresRecapture: true;
      cornerObservations: [];
      edgeObservations: [];
      surfaceCandidateSeeds: [];
      cardDefectDeduction: 0;
      invalidPixelsBecameDefects: false;
      invalidPixelsProvedClean: false;
    };

const CONDITION_POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.conditionSegmentation;
const SURFACE_POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence;
const REQUIRED_PLANE_NAMES = [
  "normalizedLuminance",
  "expectedOuterCardMask",
  "materialPresenceConfidence",
  "segmentationConfidence",
  "boundaryConfidence",
  "exposedFiberResponse",
  "boundaryDeviationMm",
  "deformationResponse",
  "delaminationResponse",
  "edgeRoughnessIndex",
  "frayingResponse",
  "scratchLineResponse",
  "scuffTextureResponse",
  "creaseLineResponse",
  "chipDepthMm",
  "reliefIndex",
  "depthMm",
  "registeredColorDeltaE",
  "registeredPrintDeltaE",
  "registeredResidueDeltaE",
] as const satisfies readonly (keyof FixedRigConditionSourcePlanesV1)[];

const FRACTION_PLANE_NAMES = new Set<keyof FixedRigConditionSourcePlanesV1>([
  "normalizedLuminance",
  "materialPresenceConfidence",
  "segmentationConfidence",
  "boundaryConfidence",
  "exposedFiberResponse",
  "deformationResponse",
  "delaminationResponse",
  "edgeRoughnessIndex",
  "frayingResponse",
  "scratchLineResponse",
  "scuffTextureResponse",
  "creaseLineResponse",
  "reliefIndex",
]);

function plane(width: number, height: number, data: ArrayLike<number>): FixedRigScalarPlaneV1 {
  return { width, height, data };
}

function fraction(count: number, total: number): number {
  const scale = 10 ** CONDITION_POLICY.calculationDecimals;
  return total > 0 ? Math.round((count / total) * scale) / scale : 0;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function insufficient(
  side: "front" | "back",
  reasons: string[],
): Extract<FixedRigConditionSegmentationV1Result, { status: "insufficient_evidence" }> {
  return {
    version: FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION,
    status: "insufficient_evidence",
    side,
    reasons: [...new Set(reasons)],
    requiresRecapture: true,
    cornerObservations: [],
    edgeObservations: [],
    surfaceCandidateSeeds: [],
    cardDefectDeduction: 0,
    invalidPixelsBecameDefects: false,
    invalidPixelsProvedClean: false,
  };
}

function validatePlane(
  name: keyof FixedRigConditionSourcePlanesV1,
  candidate: FixedRigScalarPlaneV1 | undefined,
  width: number,
  height: number,
): string[] {
  if (!candidate) return [`Required calibrated source plane ${name} is absent.`];
  if (
    candidate.width !== width ||
    candidate.height !== height ||
    candidate.data.length !== width * height
  ) {
    return [`Source plane ${name} must exactly match the calibrated ${width}x${height} coordinate frame.`];
  }
  const reasons: string[] = [];
  for (let index = 0; index < candidate.data.length; index += 1) {
    const value = Number(candidate.data[index]);
    if (!Number.isFinite(value) || value < 0 || (FRACTION_PLANE_NAMES.has(name) && value > 1)) {
      reasons.push(`Source plane ${name} contains a value outside its calibrated nonnegative domain.`);
      break;
    }
    if (name === "expectedOuterCardMask" && value !== 0 && value !== 1) {
      reasons.push("expectedOuterCardMask must be an exact binary cut-boundary raster.");
      break;
    }
  }
  return reasons;
}

function exactIdentityMatches(
  card: FixedRigConditionSegmentationCardIdentityV1,
  reference: MathematicalDesignReferenceV1,
): boolean {
  return reference.tenantId === card.tenantId &&
    reference.setId === card.setId &&
    reference.programId === card.programId &&
    reference.cardNumber === card.cardNumber &&
    reference.variantId === card.variantId &&
    reference.parallelId === card.parallelId;
}

function validateInput(input: BuildFixedRigConditionSegmentationV1Input): string[] {
  const reasons: string[] = [];
  const photometric = input.photometricEvidence;
  if (
    photometric.version !== FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION ||
    photometric.coordinateFrame !== CONDITION_POLICY.coordinateFrame
  ) {
    reasons.push("Condition Segmentation V1 requires Photometric Evidence V1 in normalized-card coordinates.");
  }
  if (photometric.status !== "computed") {
    reasons.push("Photometric evidence is insufficient; condition segmentation has no alternate capture fallback.");
  }
  const calibration = input.measurementCalibration;
  const profileValidation = validateMathematicalCalibrationForOperationalUseV1(calibration.profile);
  const profile = profileValidation.profile;
  if (
    calibration.calibrationProfileId !== photometric.calibration.profileId ||
    calibration.calibrationVersion !== photometric.calibration.version ||
    calibration.calibrationSha256.toLowerCase() !== photometric.calibration.sha256.toLowerCase()
  ) {
    reasons.push("Measurement and photometric calibration identities do not match exactly.");
  }
  if (
    !profileValidation.valid ||
    (!profileValidation.isCalibrated && !profileValidation.isOperationallyAccepted) ||
    !profile ||
    profile.profileId !== calibration.calibrationProfileId ||
    profile.calibrationVersion !== calibration.calibrationVersion ||
    profile.artifactSha256 !== calibration.calibrationSha256 ||
    profile.normalizedWidthPx !== photometric.width ||
    profile.normalizedHeightPx !== photometric.height ||
    Math.abs(calibration.pixelsPerMmX - 1 / profile.mmPerPixelX) > 1e-9 ||
    Math.abs(calibration.pixelsPerMmY - 1 / profile.mmPerPixelY) > 1e-9
  ) {
    reasons.push("Condition frame, scale, and identity must derive exactly from one finalized calibration profile.");
  }
  if (!isSha256(calibration.calibrationSha256)) reasons.push("Calibration SHA-256 is invalid.");
  if (
    !Number.isFinite(calibration.pixelsPerMmX) || calibration.pixelsPerMmX <= 0 ||
    !Number.isFinite(calibration.pixelsPerMmY) || calibration.pixelsPerMmY <= 0
  ) {
    reasons.push("Condition segmentation requires positive finalized pixel/mm scales.");
  }
  if (!isIdentifier(input.algorithmVersion)) reasons.push("Algorithm version is not a valid immutable identifier.");
  if (!input.sourceEvidence.length) reasons.push("Condition segmentation requires immutable normalized-source evidence.");
  for (const reference of input.sourceEvidence) {
    const parsed = mathematicalEvidenceReferenceV1Schema.safeParse(reference);
    if (!parsed.success || reference.side !== input.side) {
      reasons.push("Condition source evidence must be schema-valid and match the graded side.");
      break;
    }
  }
  for (const name of REQUIRED_PLANE_NAMES) {
    reasons.push(...validatePlane(name, input.planes[name], photometric.width, photometric.height));
  }
  const hasReference = Boolean(input.designReference);
  const hasRegistration = Boolean(input.designRegistration);
  if (hasReference !== hasRegistration) {
    reasons.push("Design reference and exact registration must be supplied together when design-dependent condition evidence is used.");
  } else if (hasReference) {
    const parsedReference = mathematicalDesignReferenceV1Schema.safeParse(input.designReference);
    if (!parsedReference.success) {
      reasons.push("The optional approved design reference is malformed.");
      return reasons;
    }
    const reference = parsedReference.data;
    if (!exactIdentityMatches(input.cardIdentity, reference) || reference.side !== input.side) {
      reasons.push("The approved design reference does not exactly match card/set/variant identity and side.");
    }
    if (reference.widthPx !== photometric.width || reference.heightPx !== photometric.height) {
      reasons.push("The approved design reference does not match the calibrated normalized coordinate frame.");
    }
    if (!input.sourceEvidence.some(
      (entry) => entry.role === "design_reference" &&
        entry.sha256.toLowerCase() === reference.artifactSha256.toLowerCase(),
    )) {
      reasons.push("The design-reference artifact hash is not bound into immutable design-reference evidence.");
    }
    const registration = input.designRegistration!;
    const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
    if (registration.designReferenceId !== reference.designReferenceId ||
        registration.designReferenceSha256.toLowerCase() !== reference.artifactSha256.toLowerCase()) {
      reasons.push("Exact design-reference registration identity/hash evidence is absent.");
    } else {
      const expectedMatrixLength = registration.transformType === "affine" ? 6 : 9;
      if (registration.transformMatrix.length !== expectedMatrixLength ||
          registration.transformMatrix.some((value) => !Number.isFinite(value))) {
        reasons.push("Design registration transform is malformed.");
      }
      if (!policy.allowedTransforms.includes(registration.transformType)) {
        reasons.push("Design registration transform is not permitted by the threshold manifest.");
      }
      if (!Number.isFinite(registration.registrationResidualPx) ||
          registration.registrationResidualPx > policy.maximumRegistrationResidualPx ||
          registration.inlierCount < policy.minimumInlierCount ||
          registration.inlierFraction < policy.minimumInlierFraction ||
          registration.confidence < policy.minimumRegistrationConfidence) {
        reasons.push("Design registration fails the manifest residual, inlier, or confidence gate.");
      }
    }
  }
  return reasons;
}

function crop(
  source: FixedRigScalarPlaneV1,
  x: number,
  y: number,
  width: number,
  height: number,
): FixedRigScalarPlaneV1 {
  const output = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      output[row * width + column] = Number(source.data[(y + row) * source.width + x + column]);
    }
  }
  return plane(width, height, output);
}

function evidenceForRegion(evidence: readonly EvidenceReferenceV1[], regionId: string): EvidenceReferenceV1[] {
  return evidence.map((entry) => ({ ...entry, regionId }));
}

function maskFrom(
  width: number,
  height: number,
  predicate: (index: number) => boolean,
): FixedRigScalarPlaneV1 {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) data[index] = predicate(index) ? 1 : 0;
  return plane(width, height, data);
}

function union(width: number, height: number, masks: readonly FixedRigScalarPlaneV1[]): FixedRigScalarPlaneV1 {
  return maskFrom(width, height, (index) => masks.some((mask) => Number(mask.data[index]) > 0));
}

interface ComponentV1 {
  pixels: number[];
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],             [1, 0],
  [-1, 1],  [0, 1],   [1, 1],
] as const;

function components(mask: FixedRigScalarPlaneV1): ComponentV1[] {
  const visited = new Uint8Array(mask.width * mask.height);
  const output: ComponentV1[] = [];
  for (let seed = 0; seed < visited.length; seed += 1) {
    if (visited[seed] || Number(mask.data[seed]) <= 0) continue;
    visited[seed] = 1;
    const queue = [seed];
    const pixels: number[] = [];
    while (queue.length) {
      const current = queue.pop() as number;
      pixels.push(current);
      const x = current % mask.width;
      const y = Math.floor(current / mask.width);
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= mask.width || nextY < 0 || nextY >= mask.height) continue;
        const next = nextY * mask.width + nextX;
        if (visited[next] || Number(mask.data[next]) <= 0) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    output.push({ pixels: pixels.sort((left, right) => left - right) });
  }
  return output;
}

function principalPhysicalExtents(
  pixels: readonly number[],
  width: number,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): { lengthMm: number; widthMm: number } {
  if (!pixels.length) return { lengthMm: 0, widthMm: 0 };
  const points = pixels.map((index) => ({
    x: (index % width) / pixelsPerMmX,
    y: Math.floor(index / width) / pixelsPerMmY,
  }));
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const x = point.x - centerX;
    const y = point.y - centerY;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  const theta = Math.atan2(2 * xy, xx - yy) / 2;
  const majorX = Math.cos(theta);
  const majorY = Math.sin(theta);
  const minorX = -majorY;
  const minorY = majorX;
  const major = points.map((point) => point.x * majorX + point.y * majorY);
  const minor = points.map((point) => point.x * minorX + point.y * minorY);
  const lengthMm = Math.max(...major) - Math.min(...major) +
    Math.hypot(majorX / pixelsPerMmX, majorY / pixelsPerMmY);
  const widthMm = Math.max(...minor) - Math.min(...minor) +
    Math.hypot(minorX / pixelsPerMmX, minorY / pixelsPerMmY);
  return lengthMm >= widthMm ? { lengthMm, widthMm } : { lengthMm: widthMm, widthMm: lengthMm };
}

function filterComponents(
  source: FixedRigScalarPlaneV1,
  keep: (component: ComponentV1) => boolean,
): FixedRigScalarPlaneV1 {
  const data = new Uint8Array(source.width * source.height);
  for (const component of components(source)) {
    if (component.pixels.length < SURFACE_POLICY.minConnectedComponentPixels || !keep(component)) continue;
    for (const pixelIndex of component.pixels) data[pixelIndex] = 1;
  }
  return plane(source.width, source.height, data);
}

function minimumUsableChannels(
  valid: FixedRigScalarPlaneV1,
  photometric: FixedRigPhotometricEvidenceV1,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const globalIndex = (y + row) * valid.width + x + column;
      if (Number(valid.data[globalIndex]) <= 0) continue;
      minimum = Math.min(minimum, Number(photometric.usableDirectionalObservationCount[globalIndex]));
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function meanConfidence(
  segmentation: FixedRigScalarPlaneV1,
  boundary: FixedRigScalarPlaneV1,
  valid: FixedRigScalarPlaneV1,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let sum = 0;
  let count = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = (y + row) * valid.width + x + column;
      if (Number(valid.data[index]) <= 0) continue;
      sum += Math.min(Number(segmentation.data[index]), Number(boundary.data[index]));
      count += 1;
    }
  }
  const scale = 10 ** CONDITION_POLICY.calculationDecimals;
  return count ? Math.round((sum / count) * scale) / scale : 0;
}

function buildChannelSupport(
  candidateMask: FixedRigScalarPlaneV1,
  photometric: FixedRigPhotometricEvidenceV1,
  requireResidual: boolean,
): FixedRigSurfaceChannelSupportV1[] {
  return photometric.channels.map((channel) => ({
    channel: channel.channel,
    supportMask: maskFrom(candidateMask.width, candidateMask.height, (index) =>
      Number(candidateMask.data[index]) > 0 &&
      Boolean(channel.validDirectionalObservationMask[index]) &&
      (!requireResidual ||
        Math.abs(Number(channel.directionalResidual[index])) >= SURFACE_POLICY.directionalResidualThreshold),
    ),
  }));
}

function buildSurfaceSeed(input: {
  side: "front" | "back";
  category: FixedRigSurfaceCategoryV1;
  evidenceKind: FixedRigSurfaceCandidateSeedV1["evidenceKind"];
  candidateMask: FixedRigScalarPlaneV1;
  sourceEvidence: EvidenceReferenceV1[];
  photometric: FixedRigPhotometricEvidenceV1;
  requireResidual: boolean;
}): FixedRigSurfaceCandidateSeedV1 {
  const regionId = `surface-${input.side}-${input.category}-source`;
  return {
    seedId: `${input.side}-${input.category}-segmentation-v1`,
    category: input.category,
    detectorId: CONDITION_POLICY.detectorId,
    detectorVersion: CONDITION_POLICY.detectorVersion,
    evidenceKind: input.evidenceKind,
    candidateMask: input.candidateMask,
    channelSupport: buildChannelSupport(
      input.candidateMask,
      input.photometric,
      input.requireResidual,
    ),
    sourceEvidence: evidenceForRegion(input.sourceEvidence, regionId),
  };
}

interface BuiltFeaturePlanesV1 {
  conditionValid: FixedRigScalarPlaneV1;
  boundaryValid: FixedRigScalarPlaneV1;
  whitening: FixedRigScalarPlaneV1;
  missing: FixedRigScalarPlaneV1;
  shapeDeviation: FixedRigScalarPlaneV1;
  shapeDeviationPx: FixedRigScalarPlaneV1;
  deformation: FixedRigScalarPlaneV1;
  delamination: FixedRigScalarPlaneV1;
  roughness: FixedRigScalarPlaneV1;
  fraying: FixedRigScalarPlaneV1;
  relief: FixedRigScalarPlaneV1;
  edgeDamage: FixedRigScalarPlaneV1;
  edgeChip: FixedRigScalarPlaneV1;
  surfaceMasks: Record<FixedRigSurfaceCategoryV1, FixedRigScalarPlaneV1>;
}

function buildFeaturePlanes(input: BuildFixedRigConditionSegmentationV1Input): BuiltFeaturePlanesV1 {
  const photometric = input.photometricEvidence;
  const width = photometric.width;
  const height = photometric.height;
  const planes = input.planes as Required<FixedRigConditionSourcePlanesV1>;
  const thresholds = CONDITION_POLICY.evidenceThresholds;
  const conditionValid = maskFrom(width, height, (index) =>
    !photometric.invalidIlluminationMask[index] &&
    Number(planes.segmentationConfidence.data[index]) >= thresholds.minimumSegmentationConfidence,
  );
  const boundaryValid = maskFrom(width, height, (index) =>
    Number(conditionValid.data[index]) > 0 &&
    Number(planes.boundaryConfidence.data[index]) >= thresholds.minimumBoundaryConfidence,
  );
  const whitening = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.exposedFiberResponse.data[index]) >= thresholds.minimumExposedFiberResponse,
  );
  const boundaryMaterialLossToleranceMm = Math.max(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.corner_chip.grade10Tolerance,
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.edge_chip.grade10Tolerance,
  );
  const missing = maskFrom(width, height, (index) => {
    if (
      Number(boundaryValid.data[index]) <= 0 ||
      Number(planes.expectedOuterCardMask.data[index]) !== 1 ||
      Number(planes.materialPresenceConfidence.data[index]) >= thresholds.minimumMaterialPresenceConfidence
    ) return false;
    const measuredDepthMm = Number(planes.chipDepthMm.data[index]);
    const depthU95 = deriveFixedRigMeasurementUncertaintyV1({
      calibration: input.measurementCalibration.profile,
      kind: "depth_mm",
      measuredMeasurement: measuredDepthMm,
    }).u95;
    return measuredDepthMm > grade10BufferV1(depthU95, boundaryMaterialLossToleranceMm);
  });
  const shapeDeviation = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.boundaryDeviationMm.data[index]) >= thresholds.minimumBoundaryShapeDeviationMm,
  );
  const geometricPixelsPerMm = Math.sqrt(
    input.measurementCalibration.pixelsPerMmX * input.measurementCalibration.pixelsPerMmY,
  );
  const shapeDeviationPx = plane(width, height, Float32Array.from(
    planes.boundaryDeviationMm.data,
    (value) => Number(value) * geometricPixelsPerMm,
  ));
  const deformation = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.deformationResponse.data[index]) >= thresholds.minimumDeformationResponse,
  );
  const delamination = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.delaminationResponse.data[index]) >= thresholds.minimumDelaminationResponse,
  );
  const roughness = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.edgeRoughnessIndex.data[index]) >= thresholds.minimumEdgeRoughnessIndex,
  );
  const fraying = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.frayingResponse.data[index]) >= thresholds.minimumFrayingResponse,
  );
  const relief = maskFrom(width, height, (index) =>
    Number(boundaryValid.data[index]) > 0 &&
    Number(planes.reliefIndex.data[index]) >= thresholds.minimumDirectionalReliefIndex,
  );
  const edgeChip = maskFrom(width, height, (index) =>
    Number(missing.data[index]) > 0 &&
    Number(planes.chipDepthMm.data[index]) >= thresholds.minimumEdgeChipDepthMm,
  );
  const edgeDamage = union(width, height, [
    whitening, missing, deformation, delamination, roughness, fraying, relief,
  ]);

  const directionalAnomaly = maskFrom(width, height, (index) =>
    photometric.channels.some((channel) =>
      Math.abs(Number(channel.directionalResidual[index])) >= SURFACE_POLICY.directionalResidualThreshold,
    ),
  );
  const scratchRaw = maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.scratchLineResponse.data[index]) >= thresholds.minimumScratchLineResponse &&
    Number(directionalAnomaly.data[index]) === 1,
  );
  const scratch = filterComponents(scratchRaw, (component) => {
    const geometry = principalPhysicalExtents(
      component.pixels, width,
      input.measurementCalibration.pixelsPerMmX,
      input.measurementCalibration.pixelsPerMmY,
    );
    return geometry.lengthMm / Math.max(geometry.widthMm, Number.EPSILON) >=
        SURFACE_POLICY.minimumScratchAspectRatio &&
      geometry.widthMm <= SURFACE_POLICY.maximumScratchWidthMm;
  });
  const scuffRaw = maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.scuffTextureResponse.data[index]) >= thresholds.minimumScuffTextureResponse &&
    Number(directionalAnomaly.data[index]) === 1,
  );
  const pixelAreaMm2 = 1 /
    (input.measurementCalibration.pixelsPerMmX * input.measurementCalibration.pixelsPerMmY);
  const scuff = filterComponents(
    scuffRaw,
    (component) => component.pixels.length * pixelAreaMm2 >= SURFACE_POLICY.minimumScuffAreaMm2,
  );
  const dentRaw = maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.deformationResponse.data[index]) >= thresholds.minimumDeformationResponse &&
    Number(planes.reliefIndex.data[index]) >= SURFACE_POLICY.minimumDentReliefIndex,
  );
  const dent = filterComponents(dentRaw, () => true);
  const creaseRaw = maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.creaseLineResponse.data[index]) >= thresholds.minimumCreaseLineResponse &&
    Number(planes.reliefIndex.data[index]) >= thresholds.minimumDirectionalReliefIndex &&
    Number(directionalAnomaly.data[index]) === 1,
  );
  const crease = filterComponents(creaseRaw, (component) =>
    principalPhysicalExtents(
      component.pixels, width,
      input.measurementCalibration.pixelsPerMmX,
      input.measurementCalibration.pixelsPerMmY,
    ).lengthMm >= SURFACE_POLICY.minimumCreaseLengthMm,
  );
  const stain = filterComponents(maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.registeredColorDeltaE.data[index]) >= SURFACE_POLICY.minimumStainDeltaE,
  ), () => true);
  const printDefect = filterComponents(maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.registeredPrintDeltaE.data[index]) >= SURFACE_POLICY.minimumPrintDefectDeltaE,
  ), () => true);
  const foreignMaterial = filterComponents(maskFrom(width, height, (index) =>
    Number(planes.expectedOuterCardMask.data[index]) === 1 &&
    Number(planes.registeredResidueDeltaE.data[index]) >= SURFACE_POLICY.minimumResidueDeltaE,
  ), () => true);
  return {
    conditionValid,
    boundaryValid,
    whitening,
    missing,
    shapeDeviation,
    shapeDeviationPx,
    deformation,
    delamination,
    roughness,
    fraying,
    relief,
    edgeDamage,
    edgeChip,
    surfaceMasks: { scratch, scuff, dent, crease, stain, print_defect: printDefect, foreign_material: foreignMaterial },
  };
}

function cornerObservation(input: {
  buildInput: BuildFixedRigConditionSegmentationV1Input;
  features: BuiltFeaturePlanesV1;
  location: FixedRigCornerObservationInputV1["location"];
  box: { x: number; y: number; width: number; height: number };
}): FixedRigCornerObservationInputV1 {
  const { buildInput, features, location, box } = input;
  const source = buildInput.planes as Required<FixedRigConditionSourcePlanesV1>;
  const regionId = `${buildInput.side}-corner-${location}`;
  return {
    side: buildInput.side,
    location,
    regionId,
    detectorId: CONDITION_POLICY.detectorId,
    detectorVersion: CONDITION_POLICY.detectorVersion,
    algorithmVersion: buildInput.algorithmVersion,
    calibration: buildInput.measurementCalibration,
    validEvidenceMask: crop(features.boundaryValid, box.x, box.y, box.width, box.height),
    usableDirectionalChannelCount: minimumUsableChannels(
      features.boundaryValid,
      buildInput.photometricEvidence,
      box.x, box.y, box.width, box.height,
    ),
    confidence: meanConfidence(
      source.segmentationConfidence,
      source.boundaryConfidence,
      features.boundaryValid,
      box.x, box.y, box.width, box.height,
    ),
    evidence: evidenceForRegion(buildInput.sourceEvidence, regionId),
    whiteningMask: crop(features.whitening, box.x, box.y, box.width, box.height),
    missingMaterialMask: crop(features.missing, box.x, box.y, box.width, box.height),
    shapeDeviationMask: crop(features.shapeDeviation, box.x, box.y, box.width, box.height),
    shapeDeviationPx: crop(features.shapeDeviationPx, box.x, box.y, box.width, box.height),
    deformationMask: crop(features.deformation, box.x, box.y, box.width, box.height),
    delaminationMask: crop(features.delamination, box.x, box.y, box.width, box.height),
    directionalReliefIndex: crop(source.reliefIndex, box.x, box.y, box.width, box.height),
    directionalReliefMask: crop(features.relief, box.x, box.y, box.width, box.height),
  };
}

function edgeObservation(input: {
  buildInput: BuildFixedRigConditionSegmentationV1Input;
  features: BuiltFeaturePlanesV1;
  location: FixedRigEdgeObservationInputV1["location"];
  box: { x: number; y: number; width: number; height: number };
}): FixedRigEdgeObservationInputV1 {
  const { buildInput, features, location, box } = input;
  const source = buildInput.planes as Required<FixedRigConditionSourcePlanesV1>;
  const regionId = `${buildInput.side}-edge-${location}`;
  return {
    side: buildInput.side,
    location,
    regionId,
    detectorId: CONDITION_POLICY.detectorId,
    detectorVersion: CONDITION_POLICY.detectorVersion,
    algorithmVersion: buildInput.algorithmVersion,
    calibration: buildInput.measurementCalibration,
    validEvidenceMask: crop(features.boundaryValid, box.x, box.y, box.width, box.height),
    usableDirectionalChannelCount: minimumUsableChannels(
      features.boundaryValid,
      buildInput.photometricEvidence,
      box.x, box.y, box.width, box.height,
    ),
    confidence: meanConfidence(
      source.segmentationConfidence,
      source.boundaryConfidence,
      features.boundaryValid,
      box.x, box.y, box.width, box.height,
    ),
    evidence: evidenceForRegion(buildInput.sourceEvidence, regionId),
    damageMask: crop(features.edgeDamage, box.x, box.y, box.width, box.height),
    chipMask: crop(features.edgeChip, box.x, box.y, box.width, box.height),
    chipDepthMm: crop(source.chipDepthMm, box.x, box.y, box.width, box.height),
    whiteningMask: crop(features.whitening, box.x, box.y, box.width, box.height),
    roughnessMask: crop(features.roughness, box.x, box.y, box.width, box.height),
    roughnessIndex: crop(source.edgeRoughnessIndex, box.x, box.y, box.width, box.height),
    frayingMask: crop(features.fraying, box.x, box.y, box.width, box.height),
    delaminationMask: crop(features.delamination, box.x, box.y, box.width, box.height),
    deformationMask: crop(features.deformation, box.x, box.y, box.width, box.height),
    directionalReliefIndex: crop(source.reliefIndex, box.x, box.y, box.width, box.height),
    directionalReliefMask: crop(features.relief, box.x, box.y, box.width, box.height),
  };
}

function assessConditionEvidenceCoverage(
  expectedOuterCardMask: FixedRigScalarPlaneV1,
  conditionValidEvidenceMask: FixedRigScalarPlaneV1,
): {
  expectedPixelCount: number;
  invalidExpectedPixelCount: number;
  validEvidenceCoverage: number;
  excludedExpectedPixelFraction: number;
  contiguousUngradableRegionPixelCounts: number[];
} {
  const invalidExpectedMask = maskFrom(
    expectedOuterCardMask.width,
    expectedOuterCardMask.height,
    (index) =>
      Number(expectedOuterCardMask.data[index]) === 1 &&
      Number(conditionValidEvidenceMask.data[index]) !== 1,
  );
  let expectedPixelCount = 0;
  let invalidExpectedPixelCount = 0;
  for (let index = 0; index < expectedOuterCardMask.data.length; index += 1) {
    if (Number(expectedOuterCardMask.data[index]) !== 1) continue;
    expectedPixelCount += 1;
    if (Number(invalidExpectedMask.data[index]) === 1) invalidExpectedPixelCount += 1;
  }
  const excludedExpectedPixelFraction = fraction(
    invalidExpectedPixelCount,
    expectedPixelCount,
  );
  const coveragePolicy = CONDITION_POLICY.excludedEvidenceCoveragePolicy;
  return {
    expectedPixelCount,
    invalidExpectedPixelCount,
    validEvidenceCoverage: fraction(
      expectedPixelCount - invalidExpectedPixelCount,
      expectedPixelCount,
    ),
    excludedExpectedPixelFraction,
    contiguousUngradableRegionPixelCounts: components(invalidExpectedMask)
      .map((component) => component.pixels.length)
      .filter((pixelCount) =>
        pixelCount >= coveragePolicy.minimumContiguousUngradableRegionPixels),
  };
}

export function buildFixedRigConditionSegmentationV1(
  input: BuildFixedRigConditionSegmentationV1Input,
): FixedRigConditionSegmentationV1Result {
  const reasons = validateInput(input);
  const width = input.photometricEvidence.width;
  const height = input.photometricEvidence.height;
  const regionPolicy = CONDITION_POLICY.regionGeometry;
  const cornerWidth = Math.ceil(
    regionPolicy.cornerRoiSizeMm * input.measurementCalibration.pixelsPerMmX,
  );
  const cornerHeight = Math.ceil(
    regionPolicy.cornerRoiSizeMm * input.measurementCalibration.pixelsPerMmY,
  );
  const edgeDepthX = Math.ceil(
    regionPolicy.edgeRoiDepthMm * input.measurementCalibration.pixelsPerMmX,
  );
  const edgeDepthY = Math.ceil(
    regionPolicy.edgeRoiDepthMm * input.measurementCalibration.pixelsPerMmY,
  );
  const edgeEndX = Math.ceil(
    regionPolicy.edgeEndExclusionMm * input.measurementCalibration.pixelsPerMmX,
  );
  const edgeEndY = Math.ceil(
    regionPolicy.edgeEndExclusionMm * input.measurementCalibration.pixelsPerMmY,
  );
  if (
    ![cornerWidth, cornerHeight, edgeDepthX, edgeDepthY, edgeEndX, edgeEndY]
      .every((value) => Number.isInteger(value) && value > 0) ||
    cornerWidth > width || cornerHeight > height ||
    edgeDepthX > width || edgeDepthY > height ||
    width - 2 * edgeEndX <= 0 || height - 2 * edgeEndY <= 0
  ) {
    reasons.push("The calibrated normalized frame is too small for the manifest-defined independent corner/edge ROIs.");
  }
  if (reasons.length) return insufficient(input.side, reasons);

  const features = buildFeaturePlanes(input);
  const conditionCoverage = assessConditionEvidenceCoverage(
    input.planes.expectedOuterCardMask!,
    features.conditionValid,
  );
  const coveragePolicy = CONDITION_POLICY.excludedEvidenceCoveragePolicy;
  const coverageReasons: string[] = [];
  if (
    conditionCoverage.validEvidenceCoverage <
      coveragePolicy.minimumFullCardValidPixelCoverage
  ) {
    coverageReasons.push(
      'Full-card condition valid-evidence coverage ' +
      conditionCoverage.validEvidenceCoverage +
      ' is below the manifest minimum ' +
      coveragePolicy.minimumFullCardValidPixelCoverage +
      '.',
    );
  }
  if (conditionCoverage.contiguousUngradableRegionPixelCounts.length > 0) {
    coverageReasons.push(
      'Condition evidence contains ' +
      conditionCoverage.contiguousUngradableRegionPixelCounts.length +
      ' contiguous expected-card region(s) at or above the manifest ' +
      coveragePolicy.minimumContiguousUngradableRegionPixels +
      '-pixel ungradable threshold.',
    );
  }
  if (coverageReasons.length) return insufficient(input.side, coverageReasons);
  const cornerBoxes: Array<{
    location: FixedRigCornerObservationInputV1["location"];
    box: { x: number; y: number; width: number; height: number };
  }> = [
    { location: "top_left", box: { x: 0, y: 0, width: cornerWidth, height: cornerHeight } },
    { location: "top_right", box: { x: width - cornerWidth, y: 0, width: cornerWidth, height: cornerHeight } },
    { location: "bottom_right", box: { x: width - cornerWidth, y: height - cornerHeight, width: cornerWidth, height: cornerHeight } },
    { location: "bottom_left", box: { x: 0, y: height - cornerHeight, width: cornerWidth, height: cornerHeight } },
  ];
  const edgeBoxes: Array<{
    location: FixedRigEdgeObservationInputV1["location"];
    box: { x: number; y: number; width: number; height: number };
  }> = [
    {
      location: "top",
      box: { x: edgeEndX, y: 0, width: width - 2 * edgeEndX, height: edgeDepthY },
    },
    {
      location: "right",
      box: { x: width - edgeDepthX, y: edgeEndY, width: edgeDepthX, height: height - 2 * edgeEndY },
    },
    {
      location: "bottom",
      box: { x: edgeEndX, y: height - edgeDepthY, width: width - 2 * edgeEndX, height: edgeDepthY },
    },
    {
      location: "left",
      box: { x: 0, y: edgeEndY, width: edgeDepthX, height: height - 2 * edgeEndY },
    },
  ];
  const cornerObservations = cornerBoxes.map(({ location, box }) =>
    cornerObservation({ buildInput: input, features, location, box }),
  );
  const edgeObservations = edgeBoxes.map(({ location, box }) =>
    edgeObservation({ buildInput: input, features, location, box }),
  );
  const surfaceSeedPolicy: Array<{
    category: FixedRigSurfaceCategoryV1;
    evidenceKind: FixedRigSurfaceCandidateSeedV1["evidenceKind"];
    requireResidual: boolean;
  }> = [
    { category: "scratch", evidenceKind: "directional_residual", requireResidual: true },
    { category: "scuff", evidenceKind: "directional_residual", requireResidual: true },
    { category: "dent", evidenceKind: "relief", requireResidual: false },
    { category: "crease", evidenceKind: "relief", requireResidual: true },
    { category: "stain", evidenceKind: "registered_print_reference", requireResidual: false },
    { category: "print_defect", evidenceKind: "registered_print_reference", requireResidual: false },
    { category: "foreign_material", evidenceKind: "polarized_residue", requireResidual: false },
  ];
  const surfaceCandidateSeeds = surfaceSeedPolicy.map((policy) => buildSurfaceSeed({
    side: input.side,
    category: policy.category,
    evidenceKind: policy.evidenceKind,
    candidateMask: features.surfaceMasks[policy.category],
    sourceEvidence: input.sourceEvidence,
    photometric: input.photometricEvidence,
    requireResidual: policy.requireResidual,
  }));
  const source = input.planes as Required<FixedRigConditionSourcePlanesV1>;
  const evidenceQualityLimitations: Extract<
    FixedRigConditionSegmentationV1Result,
    { status: "computed" }
  >["evidenceQualityLimitations"] = conditionCoverage.invalidExpectedPixelCount
    ? [{
        code: "invalid_condition_evidence_excluded",
        affectedPixelFraction: conditionCoverage.excludedExpectedPixelFraction,
        requiresRecapture: false,
        message:
          "Invalid condition pixels were excluded with zero damage deduction; remaining valid evidence passed the manifest full-card and localized-region recapture gates.",
      }]
    : [];
  if (!input.designReference) {
    evidenceQualityLimitations.push({
      code: "design_dependent_condition_evidence_unavailable",
      affectedPixelFraction: 1,
      requiresRecapture: false,
      message:
        "No approved exact design reference was supplied; registered stain/print/residue comparison is unavailable and contributes neither a defect nor proof of clean condition.",
    });
  }
  return {
    version: FIXED_RIG_CONDITION_SEGMENTATION_V1_VERSION,
    status: "computed",
    side: input.side,
    coordinateFrame: "normalized_card_portrait_pixels",
    width,
    height,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: input.measurementCalibration.calibrationProfileId,
    calibrationVersion: input.measurementCalibration.calibrationVersion,
    calibrationSha256: input.measurementCalibration.calibrationSha256.toLowerCase(),
    ...(input.designReference ? {
      designReferenceId: input.designReference.designReferenceId,
      designReferenceSha256: input.designReference.artifactSha256.toLowerCase(),
    } : {}),
    conditionValidEvidenceMask: features.conditionValid,
    boundaryValidEvidenceMask: features.boundaryValid,
    cornerObservations,
    edgeObservations,
    surfaceCandidateSeeds,
    ...(input.unavailableModalities?.includes("metric_depth")
      ? {}
      : { surfaceDepthMm: source.depthMm }),
    surfaceReliefIndex: source.reliefIndex,
    validEvidenceCoverage: conditionCoverage.validEvidenceCoverage,
    excludedExpectedPixelFraction:
      conditionCoverage.excludedExpectedPixelFraction,
    evidenceQualityLimitations,
    invalidPixelsBecameDefects: false,
    invalidPixelsProvedClean: false,
  };
}
