import {
  MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  aggregateCornerScoreV1,
  aggregateEdgeScoreV1,
  buildMathematicalMeasurementV1,
  calculateApplicableSevereDefectCapV1,
  calculateFindingDeductionV1,
  mathematicalFindingV1Schema,
  type MathematicalFindingCategoryV1,
  type MathematicalFindingV1,
  type OperationallyUsableMathematicalCalibrationProfileV1 as MathematicalCalibrationProfileV1,
  type MathematicalMeasurementKindV1,
  type MathematicalMeasurementUnitV1,
  type MathematicalMeasurementV1,
  type PenaltyAggregationV1,
} from "@tenkings/shared";
import type { FixedRigScalarPlaneV1 } from "./fixedRigPhotometricEvidenceV1";
import { deriveFixedRigMeasurementUncertaintyV1 } from "./fixedRigMeasurementUncertaintyV1";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";

export const FIXED_RIG_CORNER_EDGE_V1_VERSION = "fixed_rig_corner_edge_v1" as const;

type EvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];

export interface FixedRigConditionMeasurementCalibrationV1 {
  profile: MathematicalCalibrationProfileV1;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
}

interface FixedRigObservationBaseV1 {
  side: "front" | "back";
  regionId: string;
  detectorId: string;
  detectorVersion: string;
  algorithmVersion: string;
  calibration: FixedRigConditionMeasurementCalibrationV1;
  validEvidenceMask: FixedRigScalarPlaneV1;
  usableDirectionalChannelCount: number;
  confidence: number;
  evidence: EvidenceReferenceV1[];
}

export interface FixedRigCornerObservationInputV1 extends FixedRigObservationBaseV1 {
  location: "top_left" | "top_right" | "bottom_right" | "bottom_left";
  whiteningMask: FixedRigScalarPlaneV1;
  missingMaterialMask: FixedRigScalarPlaneV1;
  shapeDeviationMask: FixedRigScalarPlaneV1;
  shapeDeviationPx: FixedRigScalarPlaneV1;
  deformationMask: FixedRigScalarPlaneV1;
  delaminationMask: FixedRigScalarPlaneV1;
  directionalReliefIndex: FixedRigScalarPlaneV1;
  directionalReliefMask: FixedRigScalarPlaneV1;
}

export interface FixedRigEdgeObservationInputV1 extends FixedRigObservationBaseV1 {
  location: "top" | "right" | "bottom" | "left";
  damageMask: FixedRigScalarPlaneV1;
  chipMask: FixedRigScalarPlaneV1;
  chipDepthMm: FixedRigScalarPlaneV1;
  whiteningMask: FixedRigScalarPlaneV1;
  roughnessMask: FixedRigScalarPlaneV1;
  roughnessIndex: FixedRigScalarPlaneV1;
  frayingMask: FixedRigScalarPlaneV1;
  delaminationMask: FixedRigScalarPlaneV1;
  deformationMask: FixedRigScalarPlaneV1;
  directionalReliefIndex: FixedRigScalarPlaneV1;
  directionalReliefMask: FixedRigScalarPlaneV1;
}

export interface FixedRigPhysicalFindingV1 {
  finding: MathematicalFindingV1;
  componentId: string;
  boundingBoxPx: { x: number; y: number; width: number; height: number };
  normalizedGeometry: {
    coordinateFrame: "normalized_observation_roi";
    boundingBox: { x: number; y: number; width: number; height: number };
    centroid: { x: number; y: number };
  };
  pixelIndices: number[];
  featurePixelCounts: Record<string, number>;
  measurements: MathematicalMeasurementV1[];
  deduction: number;
  secondaryCategoryEvidence: MathematicalFindingCategoryV1[];
  severeDefectCap?: number;
}

export interface FixedRigConditionObservationComputedV1 {
  version: typeof FIXED_RIG_CORNER_EDGE_V1_VERSION;
  status: "computed";
  element: "corners" | "edges";
  side: "front" | "back";
  location: string;
  regionId: string;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  penalty: number;
  findings: FixedRigPhysicalFindingV1[];
  validEvidenceCoverage: number;
  usableDirectionalChannelCount: number;
  noDoubleDeduction: true;
  cornerContourDeviation?: {
    measurement: MathematicalMeasurementV1;
    thresholdDecision: "within_grade_10_buffer" | "deducted";
    thresholdDeduction: number;
    appliedContourDeduction: number;
    contourFindingIds: string[];
    damageFindingIds: {
      whitening: string[];
      chippingOrMaterialLoss: string[];
      deformation: string[];
      delamination: string[];
      otherVisibleDamage: string[];
    };
  };
}

export interface FixedRigConditionObservationInsufficientV1 {
  version: typeof FIXED_RIG_CORNER_EDGE_V1_VERSION;
  status: "insufficient_evidence";
  element: "corners" | "edges";
  side: "front" | "back";
  location: string;
  regionId: string;
  penalty: null;
  findings: [];
  reasons: string[];
  requiresRecapture: true;
  cardDefectDeduction: 0;
}

export type FixedRigConditionObservationResultV1 =
  | FixedRigConditionObservationComputedV1
  | FixedRigConditionObservationInsufficientV1;

interface ComponentV1 {
  id: string;
  indices: number[];
  box: { x: number; y: number; width: number; height: number };
}

interface FeatureComponentV1 extends ComponentV1 {
  featureIndex: number;
}

interface MeasurementCandidateV1 {
  category: MathematicalFindingCategoryV1;
  measurement: MathematicalMeasurementV1;
  calculation: ReturnType<typeof calculateFindingDeductionV1>;
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function calibrationIssue(calibration: FixedRigConditionMeasurementCalibrationV1): string | null {
  const validation = validateMathematicalCalibrationForOperationalUseV1(calibration.profile);
  const profile = validation.profile;
  if (!validation.valid || (!validation.isCalibrated && !validation.isOperationallyAccepted) || !profile) {
    return "Condition measurements require a finalized calibration profile satisfying every V1 acceptance gate.";
  }
  if (
    calibration.calibrationProfileId !== profile.profileId ||
    calibration.calibrationVersion !== profile.calibrationVersion ||
    calibration.calibrationSha256 !== profile.artifactSha256 ||
    Math.abs(calibration.pixelsPerMmX - 1 / profile.mmPerPixelX) > 1e-9 ||
    Math.abs(calibration.pixelsPerMmY - 1 / profile.mmPerPixelY) > 1e-9
  ) {
    return "Condition scale and calibration identity must be derived exactly from the finalized profile.";
  }
  return null;
}

function dimensions(planes: readonly FixedRigScalarPlaneV1[]): { width: number; height: number } | null {
  if (!planes.length) return null;
  const { width, height } = planes[0]!;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const count = width * height;
  return planes.every((plane) => plane.width === width && plane.height === height && plane.data.length === count)
    ? { width, height }
    : null;
}

function binaryMask(plane: FixedRigScalarPlaneV1): Uint8Array | null {
  const output = new Uint8Array(plane.data.length);
  for (let index = 0; index < plane.data.length; index += 1) {
    const value = Number(plane.data[index]);
    if (value !== 0 && value !== 1) return null;
    output[index] = value;
  }
  return output;
}

function connectedComponents(mask: Uint8Array, width: number, height: number): ComponentV1[] {
  const visited = new Uint8Array(mask.length);
  const components: ComponentV1[] = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || visited[seed]) continue;
    const queue = [seed];
    visited[seed] = 1;
    const indices: number[] = [];
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]!;
      indices.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      const neighbors: number[] = [];
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const neighborX = x + deltaX;
          const neighborY = y + deltaY;
          if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
          neighbors.push(neighborY * width + neighborX);
        }
      }
      for (const neighbor of neighbors) {
        if (mask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    components.push({
      id: `component-${components.length + 1}`,
      indices,
      box: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
    });
  }
  return components;
}

class ComponentDisjointSetV1 {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(value: number): number {
    const parent = this.parent[value]!;
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent[value] = root;
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}

function componentIou(left: ComponentV1, right: ComponentV1): number {
  const leftIndices = new Set(left.indices);
  const intersection = right.indices.reduce(
    (count, index) => count + (leftIndices.has(index) ? 1 : 0),
    0,
  );
  return intersection / (left.indices.length + right.indices.length - intersection);
}

function componentCentroidMm(
  component: ComponentV1,
  width: number,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): { x: number; y: number } {
  return component.indices.reduce(
    (centroid, index) => ({
      x: centroid.x + (index % width) / pixelsPerMmX / component.indices.length,
      y: centroid.y + Math.floor(index / width) / pixelsPerMmY / component.indices.length,
    }),
    { x: 0, y: 0 },
  );
}

function edgeSpanOverlapFraction(
  left: ComponentV1,
  right: ComponentV1,
  width: number,
  location: "top" | "right" | "bottom" | "left",
): number {
  const coordinates = (component: ComponentV1) => component.indices.map((index) =>
    location === "top" || location === "bottom" ? index % width : Math.floor(index / width)
  );
  const leftCoordinates = coordinates(left);
  const rightCoordinates = coordinates(right);
  const leftMinimum = Math.min(...leftCoordinates);
  const leftMaximum = Math.max(...leftCoordinates);
  const rightMinimum = Math.min(...rightCoordinates);
  const rightMaximum = Math.max(...rightCoordinates);
  const overlap = Math.max(0, Math.min(leftMaximum, rightMaximum) - Math.max(leftMinimum, rightMinimum) + 1);
  return overlap / Math.min(leftMaximum - leftMinimum + 1, rightMaximum - rightMinimum + 1);
}

function mergeFeatureComponents(input: {
  element: "corners" | "edges";
  masks: readonly Uint8Array[];
  valid: Uint8Array;
  width: number;
  height: number;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  edgeLocation?: "top" | "right" | "bottom" | "left";
}): ComponentV1[] {
  const components: FeatureComponentV1[] = input.masks.flatMap((mask, featureIndex) => {
    const validMask = Uint8Array.from(mask, (value, index) => value && input.valid[index] ? 1 : 0);
    return connectedComponents(validMask, input.width, input.height).map((component) => ({
      ...component,
      featureIndex,
    }));
  });
  const sets = new ComponentDisjointSetV1(components.length);
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex += 1) {
      const left = components[leftIndex]!;
      const right = components[rightIndex]!;
      if (left.featureIndex === right.featureIndex) continue;
      const iou = componentIou(left, right);
      const shouldMerge = input.element === "corners"
        ? iou >= MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.overlapMergeIouThreshold ||
          (() => {
            const leftCentroid = componentCentroidMm(
              left, input.width, input.pixelsPerMmX, input.pixelsPerMmY,
            );
            const rightCentroid = componentCentroidMm(
              right, input.width, input.pixelsPerMmX, input.pixelsPerMmY,
            );
            return Math.hypot(
              leftCentroid.x - rightCentroid.x,
              leftCentroid.y - rightCentroid.y,
            ) <= MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.overlapMergeCentroidDistanceMm;
          })()
        : iou >= MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.overlapMergeIouThreshold ||
          edgeSpanOverlapFraction(left, right, input.width, input.edgeLocation!) >=
            MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.overlapMergeSpanFraction;
      if (shouldMerge) sets.union(leftIndex, rightIndex);
    }
  }
  const groups = new Map<number, FeatureComponentV1[]>();
  components.forEach((component, index) => {
    const root = sets.find(index);
    groups.set(root, [...(groups.get(root) ?? []), component]);
  });
  return [...groups.values()]
    .map((members) => {
      const indices = [...new Set(members.flatMap((member) => member.indices))]
        .sort((left, right) => left - right);
      const xs = indices.map((index) => index % input.width);
      const ys = indices.map((index) => Math.floor(index / input.width));
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return {
        id: "",
        indices,
        box: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
      };
    })
    .sort((left, right) => left.indices[0]! - right.indices[0]!)
    .map((component, index) => ({ ...component, id: `component-${index + 1}` }));
}

function featureCount(component: ComponentV1, mask: Uint8Array): number {
  return component.indices.reduce((count, index) => count + (mask[index] ? 1 : 0), 0);
}

function maximumFeatureValue(
  component: ComponentV1,
  mask: Uint8Array,
  plane: FixedRigScalarPlaneV1,
): number {
  let maximum = 0;
  for (const index of component.indices) {
    if (!mask[index]) continue;
    const value = Number(plane.data[index]);
    if (!Number.isFinite(value) || value < 0) throw new RangeError("Feature measurement planes must be finite and nonnegative.");
    maximum = Math.max(maximum, value);
  }
  return maximum;
}

function maximumComponentDimensionMm(
  component: ComponentV1,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): number {
  return Math.max(component.box.width / pixelsPerMmX, component.box.height / pixelsPerMmY);
}

function projectedCoordinates(
  component: ComponentV1,
  mask: Uint8Array,
  width: number,
  location: "top" | "right" | "bottom" | "left",
): number[] {
  const horizontal = location === "top" || location === "bottom";
  return [...new Set(component.indices
    .filter((index) => mask[index])
    .map((index) => horizontal ? index % width : Math.floor(index / width)))]
    .sort((left, right) => left - right);
}

function longestContinuousRun(coordinates: readonly number[]): number {
  if (!coordinates.length) return 0;
  let longest = 1;
  let current = 1;
  for (let index = 1; index < coordinates.length; index += 1) {
    current = coordinates[index] === coordinates[index - 1]! + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function observationCoverage(valid: Uint8Array): number {
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "finding";
}

function buildMeasurementCandidate(input: {
  observation: FixedRigObservationBaseV1;
  component: ComponentV1;
  category: MathematicalFindingCategoryV1;
  measuredMeasurement: number;
  kind: MathematicalMeasurementKindV1;
  unit: MathematicalMeasurementUnitV1;
}): MeasurementCandidateV1 {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[input.category];
  const measurementId = safeId(
    `${input.observation.side}-${input.observation.regionId}-${input.component.id}-${input.category}-measurement`,
  );
  const measurement = buildMathematicalMeasurementV1({
    measurementId,
    kind: input.kind,
    unit: input.unit,
    measuredMeasurement: round(input.measuredMeasurement),
    uncertaintyComponentsU95: deriveFixedRigMeasurementUncertaintyV1({
      calibration: input.observation.calibration.profile,
      kind: input.kind,
      measuredMeasurement: round(input.measuredMeasurement),
    }).componentsU95,
    explicitGrade10Tolerance: policy.grade10Tolerance,
    calibrationProfileId: input.observation.calibration.calibrationProfileId,
    calibrationVersion: input.observation.calibration.calibrationVersion,
    algorithmVersion: input.observation.algorithmVersion,
    evidence: input.observation.evidence.map((entry) => ({ ...entry })),
    validEvidenceCoverage: observationCoverage(binaryMask(input.observation.validEvidenceMask)!),
    usableDirectionalChannelCount: input.observation.usableDirectionalChannelCount,
  });
  return {
    category: input.category,
    measurement,
    calculation: calculateFindingDeductionV1({
      category: input.category,
      measuredMeasurement: measurement.measuredMeasurement,
      u95: measurement.u95,
    }),
  };
}

function buildFinding(input: {
  observation: FixedRigObservationBaseV1;
  element: "corners" | "edges";
  location: string;
  component: ComponentV1;
  featurePixelCounts: Record<string, number>;
  candidates: MeasurementCandidateV1[];
  additionalMeasurements?: MathematicalMeasurementV1[];
}): FixedRigPhysicalFindingV1 | null {
  if (!input.candidates.length) return null;
  const ordered = [...input.candidates].sort((left, right) =>
    right.calculation.deduction - left.calculation.deduction ||
    right.calculation.deductionBasisMeasurement - left.calculation.deductionBasisMeasurement ||
    left.category.localeCompare(right.category),
  );
  const primary = ordered[0]!;
  // A detector response wholly inside the certified Grade-10 buffer is not a
  // physical finding. It remains represented by calibration uncertainty, but
  // must not create a zero-deduction defect or trigger human finding review.
  if (primary.calculation.deductionBasisMeasurement === 0) return null;
  const physicalDefectId = safeId(
    `${input.observation.side}-${input.location}-${input.component.id}-physical-defect`,
  );
  const findingId = safeId(`${physicalDefectId}-${primary.category}`);
  const secondaryCategories = [...new Set(
    ordered.slice(1).map((candidate) => candidate.category),
  )];
  const allMeasurements = [
    ...ordered.map((candidate) => candidate.measurement),
    ...(input.additionalMeasurements ?? []),
  ];
  const cap = calculateApplicableSevereDefectCapV1(primary.category, allMeasurements);
  const finding = mathematicalFindingV1Schema.parse({
    schemaVersion: MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
    findingId,
    physicalDefectId,
    category: primary.category,
    primaryElement: input.element,
    side: input.observation.side,
    location: input.location,
    regionId: input.observation.regionId,
    detectorId: input.observation.detectorId,
    detectorVersion: input.observation.detectorVersion,
    algorithmVersion: input.observation.algorithmVersion,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: input.observation.calibration.calibrationProfileId,
    calibrationVersion: input.observation.calibration.calibrationVersion,
    measurements: allMeasurements,
    deductionBasisMeasurementId: primary.measurement.measurementId,
    normalizedSeverity: primary.calculation.normalizedSeverity,
    deduction: primary.calculation.deduction,
    ...(cap !== undefined ? { severeDefectCap: cap } : {}),
    confidence: round(input.observation.confidence),
    evidenceQuality: "sufficient",
    secondaryEvidenceCategories: secondaryCategories,
    explanation:
      `${primary.category} measured ${primary.measurement.measuredMeasurement} ${primary.measurement.unit}; ` +
      `U95 ${primary.measurement.u95}, effective ${primary.measurement.effectiveMeasurement}, ` +
      `reference ${primary.calculation.referenceMeasurement}, exact deduction ${primary.calculation.deduction}.`,
  });
  return {
    finding,
    componentId: input.component.id,
    boundingBoxPx: { ...input.component.box },
    normalizedGeometry: {
      coordinateFrame: "normalized_observation_roi",
      boundingBox: {
        x: round(input.component.box.x / input.observation.validEvidenceMask.width),
        y: round(input.component.box.y / input.observation.validEvidenceMask.height),
        width: round(input.component.box.width / input.observation.validEvidenceMask.width),
        height: round(input.component.box.height / input.observation.validEvidenceMask.height),
      },
      centroid: input.component.indices.reduce(
        (centroid, index) => ({
          x: round(centroid.x + (index % input.observation.validEvidenceMask.width) /
            input.observation.validEvidenceMask.width / input.component.indices.length),
          y: round(centroid.y + Math.floor(index / input.observation.validEvidenceMask.width) /
            input.observation.validEvidenceMask.height / input.component.indices.length),
        }),
        { x: 0, y: 0 },
      ),
    },
    pixelIndices: [...input.component.indices],
    featurePixelCounts: { ...input.featurePixelCounts },
    measurements: allMeasurements,
    deduction: primary.calculation.deduction,
    secondaryCategoryEvidence: secondaryCategories,
    ...(cap !== undefined ? { severeDefectCap: cap } : {}),
  };
}

function buildAuxiliaryMeasurement(input: {
  observation: FixedRigObservationBaseV1;
  component: ComponentV1;
  suffix: string;
  measuredMeasurement: number;
  kind: MathematicalMeasurementKindV1;
  unit: MathematicalMeasurementUnitV1;
  explicitGrade10Tolerance: number;
}): MathematicalMeasurementV1 {
  return buildMathematicalMeasurementV1({
    measurementId: safeId(
      `${input.observation.side}-${input.observation.regionId}-${input.component.id}-${input.suffix}`,
    ),
    kind: input.kind,
    unit: input.unit,
    measuredMeasurement: round(input.measuredMeasurement),
    uncertaintyComponentsU95: deriveFixedRigMeasurementUncertaintyV1({
      calibration: input.observation.calibration.profile,
      kind: input.kind,
      measuredMeasurement: round(input.measuredMeasurement),
    }).componentsU95,
    explicitGrade10Tolerance: input.explicitGrade10Tolerance,
    calibrationProfileId: input.observation.calibration.calibrationProfileId,
    calibrationVersion: input.observation.calibration.calibrationVersion,
    algorithmVersion: input.observation.algorithmVersion,
    evidence: input.observation.evidence.map((entry) => ({ ...entry })),
    validEvidenceCoverage: observationCoverage(binaryMask(input.observation.validEvidenceMask)!),
    usableDirectionalChannelCount: input.observation.usableDirectionalChannelCount,
  });
}

function insufficientObservation(input: {
  element: "corners" | "edges";
  side: "front" | "back";
  location: string;
  regionId: string;
  reasons: string[];
}): FixedRigConditionObservationInsufficientV1 {
  return {
    version: FIXED_RIG_CORNER_EDGE_V1_VERSION,
    status: "insufficient_evidence",
    element: input.element,
    side: input.side,
    location: input.location,
    regionId: input.regionId,
    penalty: null,
    findings: [],
    reasons: input.reasons,
    requiresRecapture: true,
    cardDefectDeduction: 0,
  };
}

function invalidCandidateOverlap(valid: Uint8Array, masks: readonly Uint8Array[]): boolean {
  for (let index = 0; index < valid.length; index += 1) {
    if (!valid[index] && masks.some((mask) => mask[index])) return true;
  }
  return false;
}

export function measureFixedRigCornerObservationV1(
  input: FixedRigCornerObservationInputV1,
): FixedRigConditionObservationResultV1 {
  const planes = [
    input.validEvidenceMask,
    input.whiteningMask,
    input.missingMaterialMask,
    input.shapeDeviationMask,
    input.shapeDeviationPx,
    input.deformationMask,
    input.delaminationMask,
    input.directionalReliefIndex,
    input.directionalReliefMask,
  ];
  const size = dimensions(planes);
  const binaryPlanes = [
    input.validEvidenceMask,
    input.whiteningMask,
    input.missingMaterialMask,
    input.shapeDeviationMask,
    input.deformationMask,
    input.delaminationMask,
    input.directionalReliefMask,
  ].map(binaryMask);
  if (!size || binaryPlanes.some((mask) => mask === null)) {
    return insufficientObservation({
      element: "corners", side: input.side, location: input.location, regionId: input.regionId,
      reasons: ["Corner feature planes must share dimensions and binary masks must contain only 0 or 1."],
    });
  }
  const [valid, whitening, missing, shape, deformation, delamination, relief] =
    binaryPlanes as Uint8Array[];
  const coverage = observationCoverage(valid!);
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners;
  const reasons: string[] = [];
  if (coverage < policy.minValidPixelCoverage) {
    reasons.push(`Valid corner evidence coverage ${coverage} is below ${policy.minValidPixelCoverage}.`);
  }
  if (input.usableDirectionalChannelCount < policy.minUsableDirectionalChannels) {
    reasons.push(
      `Usable directional channels ${input.usableDirectionalChannelCount} are below ${policy.minUsableDirectionalChannels}.`,
    );
  }
  if (!input.evidence.length) reasons.push("Corner observation has no immutable evidence references.");
  const cornerCalibrationIssue = calibrationIssue(input.calibration);
  if (cornerCalibrationIssue) reasons.push(cornerCalibrationIssue);
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    reasons.push("Corner observation confidence must be a fraction from 0 through 1.");
  }
  const featureMasks = [whitening!, missing!, shape!, deformation!, delamination!, relief!];
  if (invalidCandidateOverlap(valid!, featureMasks)) {
    reasons.push("A detected corner candidate overlaps invalid capture pixels and cannot be graded as condition.");
  }
  if (reasons.length) {
    return insufficientObservation({
      element: "corners", side: input.side, location: input.location, regionId: input.regionId, reasons,
    });
  }
  const components = mergeFeatureComponents({
    element: "corners",
    masks: featureMasks,
    valid: valid!,
    width: size.width,
    height: size.height,
    pixelsPerMmX: input.calibration.pixelsPerMmX,
    pixelsPerMmY: input.calibration.pixelsPerMmY,
  });
  const pixelAreaMm2 = 1 / (input.calibration.pixelsPerMmX * input.calibration.pixelsPerMmY);
  const geometricMmPerPixel = 1 / Math.sqrt(
    input.calibration.pixelsPerMmX * input.calibration.pixelsPerMmY,
  );
  let maximumContourDeviationPx = 0;
  for (let index = 0; index < input.shapeDeviationPx.data.length; index += 1) {
    const value = Number(input.shapeDeviationPx.data[index]);
    if (!Number.isFinite(value) || value < 0) {
      return insufficientObservation({
        element: "corners", side: input.side, location: input.location, regionId: input.regionId,
        reasons: ["Corner contour-deviation plane must contain finite nonnegative analyzer measurements."],
      });
    }
    if (valid![index]) maximumContourDeviationPx = Math.max(maximumContourDeviationPx, value);
  }
  const contourMeasuredMm = round(maximumContourDeviationPx * geometricMmPerPixel);
  const contourPolicy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST
    .findings.corner_shape_deviation;
  const contourMeasurement = buildMathematicalMeasurementV1({
    measurementId: safeId(
      `${input.side}-${input.regionId}-intended-contour-deviation`,
    ),
    kind: "shape_deviation_mm",
    unit: "mm",
    measuredMeasurement: contourMeasuredMm,
    uncertaintyComponentsU95: deriveFixedRigMeasurementUncertaintyV1({
      calibration: input.calibration.profile,
      kind: "shape_deviation_mm",
      measuredMeasurement: contourMeasuredMm,
    }).componentsU95,
    explicitGrade10Tolerance: contourPolicy.grade10Tolerance,
    calibrationProfileId: input.calibration.calibrationProfileId,
    calibrationVersion: input.calibration.calibrationVersion,
    algorithmVersion: input.algorithmVersion,
    evidence: input.evidence.map((entry) => ({ ...entry })),
    validEvidenceCoverage: coverage,
    usableDirectionalChannelCount: input.usableDirectionalChannelCount,
  });
  const contourCalculation = calculateFindingDeductionV1({
    category: "corner_shape_deviation",
    measuredMeasurement: contourMeasurement.measuredMeasurement,
    u95: contourMeasurement.u95,
  });
  const findings: FixedRigPhysicalFindingV1[] = [];
  for (const component of components) {
    const counts = {
      whitening: featureCount(component, whitening!),
      missingMaterial: featureCount(component, missing!),
      shapeDeviation: featureCount(component, shape!),
      deformation: featureCount(component, deformation!),
      delamination: featureCount(component, delamination!),
      directionalRelief: featureCount(component, relief!),
    };
    const candidates: MeasurementCandidateV1[] = [];
    if (counts.whitening) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "corner_whitening",
      measuredMeasurement: counts.whitening * pixelAreaMm2,
      kind: "area_mm2", unit: "mm2",
    }));
    if (counts.missingMaterial) {
      candidates.push(buildMeasurementCandidate({
        observation: input, component, category: "corner_material_loss",
        measuredMeasurement: counts.missingMaterial * pixelAreaMm2,
        kind: "area_mm2", unit: "mm2",
      }));
      candidates.push(buildMeasurementCandidate({
        observation: input, component, category: "corner_chip",
        measuredMeasurement: maximumComponentDimensionMm(
          component, input.calibration.pixelsPerMmX, input.calibration.pixelsPerMmY,
        ),
        kind: "length_mm", unit: "mm",
      }));
    }
    if (counts.shapeDeviation) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "corner_shape_deviation",
      measuredMeasurement: maximumFeatureValue(component, shape!, input.shapeDeviationPx) * geometricMmPerPixel,
      kind: "shape_deviation_mm", unit: "mm",
    }));
    if (counts.deformation) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "corner_deformation",
      measuredMeasurement: counts.deformation * pixelAreaMm2,
      kind: "deformation_area_mm2", unit: "mm2",
    }));
    if (counts.delamination) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "corner_delamination",
      measuredMeasurement: maximumComponentDimensionMm(
        component, input.calibration.pixelsPerMmX, input.calibration.pixelsPerMmY,
      ),
      kind: "length_mm", unit: "mm",
    }));
    if (counts.directionalRelief) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "corner_directional_relief",
      measuredMeasurement: maximumFeatureValue(component, relief!, input.directionalReliefIndex),
      kind: "relief_index", unit: "relief_index",
    }));
    const finding = buildFinding({
      observation: input, element: "corners", location: input.location,
      component, featurePixelCounts: counts, candidates,
    });
    if (finding) findings.push(finding);
  }
  const penalty = round(findings.reduce((sum, finding) => sum + finding.deduction, 0), 2);
  if (!findings.length && coverage < 1) {
    return insufficientObservation({
      element: "corners", side: input.side, location: input.location, regionId: input.regionId,
      reasons: ["A clean Grade-10 corner observation requires complete valid-pixel coverage."],
    });
  }
  const categoriesFor = (finding: FixedRigPhysicalFindingV1) => new Set([
    finding.finding.category,
    ...finding.secondaryCategoryEvidence,
  ]);
  const findingIdsFor = (categories: readonly MathematicalFindingCategoryV1[]) =>
    findings.filter((finding) => categories.some((category) => categoriesFor(finding).has(category)))
      .map((finding) => finding.finding.findingId)
      .sort();
  return {
    version: FIXED_RIG_CORNER_EDGE_V1_VERSION,
    status: "computed",
    element: "corners",
    side: input.side,
    location: input.location,
    regionId: input.regionId,
    calibrationProfileId: input.calibration.calibrationProfileId,
    calibrationVersion: input.calibration.calibrationVersion,
    calibrationSha256: input.calibration.calibrationSha256,
    penalty,
    findings,
    validEvidenceCoverage: coverage,
    usableDirectionalChannelCount: input.usableDirectionalChannelCount,
    noDoubleDeduction: true,
    cornerContourDeviation: {
      measurement: contourMeasurement,
      thresholdDecision: contourCalculation.deductionBasisMeasurement === 0
        ? "within_grade_10_buffer"
        : "deducted",
      thresholdDeduction: contourCalculation.deduction,
      appliedContourDeduction: round(findings
        .filter((finding) => finding.finding.category === "corner_shape_deviation")
        .reduce((sum, finding) => sum + finding.deduction, 0), 2),
      contourFindingIds: findingIdsFor(["corner_shape_deviation"]),
      damageFindingIds: {
        whitening: findingIdsFor(["corner_whitening"]),
        chippingOrMaterialLoss: findingIdsFor(["corner_chip", "corner_material_loss"]),
        deformation: findingIdsFor(["corner_deformation"]),
        delamination: findingIdsFor(["corner_delamination"]),
        otherVisibleDamage: findingIdsFor(["corner_directional_relief"]),
      },
    },
  };
}

export function measureFixedRigEdgeObservationV1(
  input: FixedRigEdgeObservationInputV1,
): FixedRigConditionObservationResultV1 {
  const planes = [
    input.validEvidenceMask, input.damageMask, input.chipMask, input.chipDepthMm,
    input.whiteningMask, input.roughnessMask, input.roughnessIndex,
    input.frayingMask, input.delaminationMask, input.deformationMask,
    input.directionalReliefIndex, input.directionalReliefMask,
  ];
  const size = dimensions(planes);
  const binaryPlanes = [
    input.validEvidenceMask, input.damageMask, input.chipMask, input.whiteningMask,
    input.roughnessMask, input.frayingMask, input.delaminationMask,
    input.deformationMask, input.directionalReliefMask,
  ].map(binaryMask);
  if (!size || binaryPlanes.some((mask) => mask === null)) {
    return insufficientObservation({
      element: "edges", side: input.side, location: input.location, regionId: input.regionId,
      reasons: ["Edge feature planes must share dimensions and binary masks must contain only 0 or 1."],
    });
  }
  const [valid, damage, chip, whitening, roughness, fraying, delamination, deformation, relief] =
    binaryPlanes as Uint8Array[];
  const coverage = observationCoverage(valid!);
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges;
  const reasons: string[] = [];
  if (coverage < policy.minValidPixelCoverage) {
    reasons.push(`Valid edge evidence coverage ${coverage} is below ${policy.minValidPixelCoverage}.`);
  }
  if (input.usableDirectionalChannelCount < policy.minUsableDirectionalChannels) {
    reasons.push(
      `Usable directional channels ${input.usableDirectionalChannelCount} are below ${policy.minUsableDirectionalChannels}.`,
    );
  }
  if (!input.evidence.length) reasons.push("Edge observation has no immutable evidence references.");
  const edgeCalibrationIssue = calibrationIssue(input.calibration);
  if (edgeCalibrationIssue) reasons.push(edgeCalibrationIssue);
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    reasons.push("Edge observation confidence must be a fraction from 0 through 1.");
  }
  const featureMasks = [damage!, chip!, whitening!, roughness!, fraying!, delamination!, deformation!, relief!];
  if (invalidCandidateOverlap(valid!, featureMasks)) {
    reasons.push("A detected edge candidate overlaps invalid capture pixels and cannot be graded as condition.");
  }
  if (reasons.length) {
    return insufficientObservation({
      element: "edges", side: input.side, location: input.location, regionId: input.regionId, reasons,
    });
  }
  const components = mergeFeatureComponents({
    element: "edges",
    masks: featureMasks,
    valid: valid!,
    width: size.width,
    height: size.height,
    pixelsPerMmX: input.calibration.pixelsPerMmX,
    pixelsPerMmY: input.calibration.pixelsPerMmY,
    edgeLocation: input.location,
  });
  const pixelAreaMm2 = 1 / (input.calibration.pixelsPerMmX * input.calibration.pixelsPerMmY);
  const pixelsPerMmAlongEdge = input.location === "top" || input.location === "bottom"
    ? input.calibration.pixelsPerMmX
    : input.calibration.pixelsPerMmY;
  const findings: FixedRigPhysicalFindingV1[] = [];
  for (const component of components) {
    const counts = {
      damage: featureCount(component, damage!),
      chip: featureCount(component, chip!),
      whitening: featureCount(component, whitening!),
      roughness: featureCount(component, roughness!),
      fraying: featureCount(component, fraying!),
      delamination: featureCount(component, delamination!),
      deformation: featureCount(component, deformation!),
      directionalRelief: featureCount(component, relief!),
    };
    const candidates: MeasurementCandidateV1[] = [];
    const additionalMeasurements: MathematicalMeasurementV1[] = [];
    if (counts.damage) {
      const coordinates = projectedCoordinates(component, damage!, size.width, input.location);
      const damagedLengthMm = coordinates.length / pixelsPerMmAlongEdge;
      const longestLengthMm = longestContinuousRun(coordinates) / pixelsPerMmAlongEdge;
      candidates.push(buildMeasurementCandidate({
        observation: input, component, category: "edge_damage",
        measuredMeasurement: damagedLengthMm,
        kind: "length_mm", unit: "mm",
      }));
      additionalMeasurements.push(buildAuxiliaryMeasurement({
        observation: input, component, suffix: "longest-continuous-defect",
        measuredMeasurement: longestLengthMm, kind: "length_mm", unit: "mm",
        explicitGrade10Tolerance: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.edge_damage.grade10Tolerance,
      }));
    }
    if (counts.chip) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "edge_chip",
      measuredMeasurement: maximumFeatureValue(component, chip!, input.chipDepthMm),
      kind: "depth_mm", unit: "mm",
    }));
    if (counts.whitening) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "edge_whitening",
      measuredMeasurement: counts.whitening * pixelAreaMm2,
      kind: "area_mm2", unit: "mm2",
    }));
    if (counts.roughness) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "edge_roughness",
      measuredMeasurement: maximumFeatureValue(component, roughness!, input.roughnessIndex),
      kind: "roughness_index", unit: "roughness_index",
    }));
    if (counts.fraying) {
      const coordinates = projectedCoordinates(component, fraying!, size.width, input.location);
      candidates.push(buildMeasurementCandidate({
        observation: input, component, category: "edge_fraying",
        measuredMeasurement: coordinates.length / pixelsPerMmAlongEdge,
        kind: "length_mm", unit: "mm",
      }));
    }
    if (counts.delamination) {
      const coordinates = projectedCoordinates(component, delamination!, size.width, input.location);
      candidates.push(buildMeasurementCandidate({
        observation: input, component, category: "edge_delamination",
        measuredMeasurement: coordinates.length / pixelsPerMmAlongEdge,
        kind: "length_mm", unit: "mm",
      }));
    }
    if (counts.deformation) candidates.push(buildMeasurementCandidate({
      observation: input, component, category: "edge_deformation",
      measuredMeasurement: counts.deformation * pixelAreaMm2,
      kind: "deformation_area_mm2", unit: "mm2",
    }));
    if (counts.directionalRelief) additionalMeasurements.push(buildAuxiliaryMeasurement({
      observation: input, component, suffix: "directional-relief-response",
      measuredMeasurement: maximumFeatureValue(component, relief!, input.directionalReliefIndex),
      kind: "relief_index", unit: "relief_index",
      explicitGrade10Tolerance: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.edge_deformation.grade10Tolerance,
    }));
    const finding = buildFinding({
      observation: input, element: "edges", location: input.location,
      component, featurePixelCounts: counts, candidates, additionalMeasurements,
    });
    if (finding) findings.push(finding);
  }
  const penalty = round(findings.reduce((sum, finding) => sum + finding.deduction, 0), 2);
  if (!findings.length && coverage < 1) {
    return insufficientObservation({
      element: "edges", side: input.side, location: input.location, regionId: input.regionId,
      reasons: ["A clean Grade-10 edge observation requires complete valid-pixel coverage."],
    });
  }
  return {
    version: FIXED_RIG_CORNER_EDGE_V1_VERSION,
    status: "computed",
    element: "edges",
    side: input.side,
    location: input.location,
    regionId: input.regionId,
    calibrationProfileId: input.calibration.calibrationProfileId,
    calibrationVersion: input.calibration.calibrationVersion,
    calibrationSha256: input.calibration.calibrationSha256,
    penalty,
    findings,
    validEvidenceCoverage: coverage,
    usableDirectionalChannelCount: input.usableDirectionalChannelCount,
    noDoubleDeduction: true,
  };
}

export interface FixedRigCrossSideDefectLinkV1 {
  canonicalPhysicalDefectId: string;
  findingIds: string[];
  reason: string;
}

export type FixedRigConditionElementResultV1 =
  | {
      version: typeof FIXED_RIG_CORNER_EDGE_V1_VERSION;
      status: "computed";
      element: "corners" | "edges";
      score: number;
      startingScore: 10;
      aggregatePenalty: number;
      aggregation: PenaltyAggregationV1;
      observations: FixedRigConditionObservationComputedV1[];
      locationSubscores: Array<{
        side: "front" | "back";
        location: string;
        rawPenalty: number;
        deduplicatedPenalty: number;
        score: number;
      }>;
      crossSideDeduplication: Array<{
        canonicalPhysicalDefectId: string;
        retainedFindingId: string;
        linkedFindingIds: string[];
        retainedDeduction: number;
        removedDuplicateDeduction: number;
        reason: string;
      }>;
      severeDefectCaps: number[];
      thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
      thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
      noDoubleDeduction: true;
    }
  | {
      version: typeof FIXED_RIG_CORNER_EDGE_V1_VERSION;
      status: "insufficient_evidence";
      element: "corners" | "edges";
      score: null;
      observations: FixedRigConditionObservationResultV1[];
      reasons: string[];
      cardDefectDeduction: 0;
    };

function frontBackLocationsMatch(
  element: "corners" | "edges",
  frontLocation: string,
  backLocation: string,
): boolean {
  const cornerMirror: Record<string, string> = {
    top_left: "top_right",
    top_right: "top_left",
    bottom_left: "bottom_right",
    bottom_right: "bottom_left",
  };
  const edgeMirror: Record<string, string> = {
    top: "top",
    right: "left",
    bottom: "bottom",
    left: "right",
  };
  return (element === "corners" ? cornerMirror : edgeMirror)[frontLocation] === backLocation;
}

function frontFrameGeometry(
  finding: FixedRigPhysicalFindingV1,
  side: "front" | "back",
): FixedRigPhysicalFindingV1["normalizedGeometry"] {
  if (side === "front") return finding.normalizedGeometry;
  const { boundingBox, centroid } = finding.normalizedGeometry;
  return {
    coordinateFrame: "normalized_observation_roi",
    boundingBox: {
      x: round(1 - boundingBox.x - boundingBox.width),
      y: boundingBox.y,
      width: boundingBox.width,
      height: boundingBox.height,
    },
    centroid: { x: round(1 - centroid.x), y: centroid.y },
  };
}

function boundingBoxIou(
  left: FixedRigPhysicalFindingV1["normalizedGeometry"]["boundingBox"],
  right: FixedRigPhysicalFindingV1["normalizedGeometry"]["boundingBox"],
): number {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = overlapWidth * overlapHeight;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function primaryMeasurement(finding: FixedRigPhysicalFindingV1): MathematicalMeasurementV1 | undefined {
  return finding.measurements.find((measurement) =>
    measurement.measurementId.toLowerCase() ===
      finding.finding.deductionBasisMeasurementId.toLowerCase()
  );
}

function deterministicFrontBackMatches(
  element: "corners" | "edges",
  observations: FixedRigConditionObservationComputedV1[],
): Array<{
  front: FixedRigPhysicalFindingV1;
  back: FixedRigPhysicalFindingV1;
  iou: number;
  centroidDistance: number;
  measurementDifference: number;
}> {
  const policy = element === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.frontBackPhysicalMatch
    : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.frontBackPhysicalMatch;
  const findings = observations.flatMap((observation) => observation.findings.map((finding) => ({
    side: observation.side,
    location: observation.location,
    finding,
  })));
  const candidates = findings.filter((entry) => entry.side === "front").flatMap((front) =>
    findings.filter((entry) => entry.side === "back").flatMap((back) => {
      if (!frontBackLocationsMatch(element, front.location, back.location) ||
          front.finding.finding.category !== back.finding.finding.category) return [];
      const frontMeasurement = primaryMeasurement(front.finding);
      const backMeasurement = primaryMeasurement(back.finding);
      if (!frontMeasurement || !backMeasurement ||
          frontMeasurement.kind !== backMeasurement.kind ||
          frontMeasurement.unit !== backMeasurement.unit) return [];
      const frontGeometry = frontFrameGeometry(front.finding, "front");
      const backGeometry = frontFrameGeometry(back.finding, "back");
      const iou = boundingBoxIou(frontGeometry.boundingBox, backGeometry.boundingBox);
      const centroidDistance = Math.hypot(
        frontGeometry.centroid.x - backGeometry.centroid.x,
        frontGeometry.centroid.y - backGeometry.centroid.y,
      );
      if (iou < policy.minimumBoundingBoxIou &&
          centroidDistance > policy.maximumNormalizedCentroidDistance) return [];
      const measurementDifference = Math.abs(
        frontMeasurement.effectiveMeasurement - backMeasurement.effectiveMeasurement,
      );
      const maximumEffectiveMeasurement = Math.max(
        frontMeasurement.effectiveMeasurement,
        backMeasurement.effectiveMeasurement,
      );
      const allowedDifference = Math.max(
        maximumEffectiveMeasurement * policy.maximumRelativeEffectiveMeasurementDifference,
        (frontMeasurement.u95 + backMeasurement.u95) * policy.u95IntervalMultiplier,
      );
      if (measurementDifference > allowedDifference) return [];
      return [{
        front: front.finding,
        back: back.finding,
        iou,
        centroidDistance,
        measurementDifference,
      }];
    }),
  ).sort((left, right) =>
    right.iou - left.iou ||
    left.centroidDistance - right.centroidDistance ||
    left.measurementDifference - right.measurementDifference ||
    left.front.finding.findingId.localeCompare(right.front.finding.findingId) ||
    left.back.finding.findingId.localeCompare(right.back.finding.findingId)
  );
  const used = new Set<string>();
  return candidates.filter((candidate) => {
    const frontId = candidate.front.finding.findingId.toLowerCase();
    const backId = candidate.back.finding.findingId.toLowerCase();
    if (used.has(frontId) || used.has(backId)) return false;
    used.add(frontId);
    used.add(backId);
    return true;
  });
}

function aggregateConditionElement(input: {
  element: "corners" | "edges";
  observations: FixedRigConditionObservationResultV1[];
  crossSideLinks: FixedRigCrossSideDefectLinkV1[];
}): FixedRigConditionElementResultV1 {
  const expectedLocations = input.element === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.locationsPerSide
    : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.locationsPerSide;
  const expectedKeys = new Set(
    (["front", "back"] as const).flatMap((side) => expectedLocations.map((location) => `${side}:${location}`)),
  );
  const observedKeys = input.observations.map((observation) => `${observation.side}:${observation.location}`);
  const reasons: string[] = [];
  if (input.observations.length !== expectedKeys.size || new Set(observedKeys).size !== observedKeys.length ||
      observedKeys.some((key) => !expectedKeys.has(key))) {
    reasons.push(`Exactly one ${input.element} observation is required for each front/back physical location.`);
  }
  for (const observation of input.observations) {
    if (observation.element !== input.element) reasons.push(`Observation ${observation.regionId} has the wrong element.`);
    if (observation.status === "insufficient_evidence") {
      reasons.push(...observation.reasons.map((reason) => `${observation.side} ${observation.location}: ${reason}`));
    }
  }
  if (reasons.length) {
    return {
      version: FIXED_RIG_CORNER_EDGE_V1_VERSION,
      status: "insufficient_evidence",
      element: input.element,
      score: null,
      observations: input.observations,
      reasons,
      cardDefectDeduction: 0,
    };
  }
  const observations = input.observations as FixedRigConditionObservationComputedV1[];
  const findingOwners = new Map<string, { observationIndex: number; finding: FixedRigPhysicalFindingV1 }>();
  observations.forEach((observation, observationIndex) => observation.findings.forEach((finding) => {
    findingOwners.set(finding.finding.findingId, { observationIndex, finding });
  }));
  const effectiveDeductions = new Map<string, number>();
  findingOwners.forEach(({ finding }, findingId) => effectiveDeductions.set(findingId, finding.deduction));
  const crossSideDeduplication: Extract<FixedRigConditionElementResultV1, { status: "computed" }>[
    "crossSideDeduplication"
  ] = [];
  // Caller assertions remain accepted for historical call compatibility, but
  // never authorize suppression. Only the deterministic geometry/category/
  // measurement matcher below can remove a duplicate deduction.
  void input.crossSideLinks;
  const deterministicMatches = deterministicFrontBackMatches(input.element, observations);
  for (const [matchIndex, match] of deterministicMatches.entries()) {
    const members = [match.front, match.back];
    const retained = [...members].sort((left, right) =>
      right.deduction - left.deduction ||
      left.finding.findingId.localeCompare(right.finding.findingId)
    )[0]!;
    const duplicate = members.find((member) => member !== retained)!;
    effectiveDeductions.set(duplicate.finding.findingId, 0);
    const linkedFindingIds = members.map((member) => member.finding.findingId);
    const canonicalPhysicalDefectId = safeId(
      `${input.element}-front-back-physical-match-${matchIndex + 1}`,
    );
    crossSideDeduplication.push({
      canonicalPhysicalDefectId,
      retainedFindingId: retained.finding.findingId,
      linkedFindingIds,
      retainedDeduction: retained.deduction,
      removedDuplicateDeduction: round(duplicate.deduction, 2),
      reason:
        `Deterministic calibrated front/back physical match: category ${retained.finding.category}; ` +
        `normalized ROI box IoU ${round(match.iou)}, centroid distance ${round(match.centroidDistance)}, ` +
        `effective-measurement difference ${round(match.measurementDifference)}.`,
    });
  }
  const orderedObservations = [...observations].sort((left, right) => {
    const sideOrder = left.side === right.side ? 0 : left.side === "front" ? -1 : 1;
    if (sideOrder) return sideOrder;
    return expectedLocations.indexOf(left.location as never) - expectedLocations.indexOf(right.location as never);
  });
  const locationSubscores = orderedObservations.map((observation) => {
    const deduplicatedPenalty = round(observation.findings.reduce(
      (sum, finding) => sum + (effectiveDeductions.get(finding.finding.findingId) ?? 0), 0,
    ), 2);
    return {
      side: observation.side,
      location: observation.location,
      rawPenalty: observation.penalty,
      deduplicatedPenalty,
      score: round(Math.max(1, Math.min(10, 10 - deduplicatedPenalty)), 2),
    };
  });
  const penalties = locationSubscores.map((location) => location.deduplicatedPenalty);
  const aggregation = input.element === "corners"
    ? aggregateCornerScoreV1(penalties)
    : aggregateEdgeScoreV1(penalties);
  const severeDefectCaps = [...new Set(observations.flatMap((observation) =>
    observation.findings.flatMap((finding) => finding.severeDefectCap === undefined ? [] : [finding.severeDefectCap]),
  ))].sort((left, right) => left - right);
  return {
    version: FIXED_RIG_CORNER_EDGE_V1_VERSION,
    status: "computed",
    element: input.element,
    score: aggregation.score,
    startingScore: 10,
    aggregatePenalty: aggregation.aggregatePenalty,
    aggregation,
    observations,
    locationSubscores,
    crossSideDeduplication,
    severeDefectCaps,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    noDoubleDeduction: true,
  };
}

export function aggregateFixedRigCornersV1(
  observations: FixedRigConditionObservationResultV1[],
  crossSideLinks: FixedRigCrossSideDefectLinkV1[] = [],
): FixedRigConditionElementResultV1 {
  return aggregateConditionElement({ element: "corners", observations, crossSideLinks });
}

export function aggregateFixedRigEdgesV1(
  observations: FixedRigConditionObservationResultV1[],
  crossSideLinks: FixedRigCrossSideDefectLinkV1[] = [],
): FixedRigConditionElementResultV1 {
  return aggregateConditionElement({ element: "edges", observations, crossSideLinks });
}
