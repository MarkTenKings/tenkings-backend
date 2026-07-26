import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  MATHEMATICAL_OBSERVABLE_EVIDENCE_ADMISSION_V1_VERSION,
  buildMathematicalMeasurementV1,
  calculateApplicableSevereDefectCapV1,
  calculateFindingDeductionV1,
  roundMathematicalScoreV1,
  type FindingDeductionCalculationV1,
  type OperationallyUsableMathematicalCalibrationProfileV1 as MathematicalCalibrationProfileV1,
  type MathematicalFindingCategoryV1,
  type MathematicalMeasurementKindV1,
  type MathematicalMeasurementUnitV1,
  type MathematicalMeasurementV1,
} from "@tenkings/shared";
import {
  FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION,
  resolveFixedRigSurfaceEvidenceThresholdsV1,
  type FixedRigPhotometricEvidenceV1,
  type FixedRigScalarPlaneV1,
  type FixedRigSurfaceEvidenceThresholdsV1,
} from "./fixedRigPhotometricEvidenceV1";
import { deriveFixedRigMeasurementUncertaintyV1 } from "./fixedRigMeasurementUncertaintyV1";
import { measureFixedRigPrincipalExtentsV1 } from "./fixedRigPrincipalExtentsV1";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";

type MathematicalEvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];

export const FIXED_RIG_SURFACE_V1_VERSION = "fixed_rig_surface_v1" as const;

export type FixedRigSurfaceCategoryV1 = Extract<
  MathematicalFindingCategoryV1,
  "scratch" | "scuff" | "dent" | "crease" | "stain" | "print_defect" | "foreign_material"
>;

export type FixedRigSurfaceEvidenceKindV1 =
  | "directional_residual"
  | "relief"
  | "color_delta"
  | "registered_print_reference"
  | "polarized_residue";

export interface FixedRigSurfaceChannelSupportV1 {
  channel: number;
  supportMask: FixedRigScalarPlaneV1;
}

/**
 * A deterministic source detector supplies a category mask. Surface V1 owns
 * connected components, evidence-quality exclusion, corroboration, merging,
 * physical measurement, U95, and deduction. A rendered heatmap is forbidden
 * as a source kind and cannot enter this contract.
 */
export interface FixedRigSurfaceCandidateSeedV1 {
  seedId: string;
  category: FixedRigSurfaceCategoryV1;
  detectorId: string;
  detectorVersion: string;
  evidenceKind: FixedRigSurfaceEvidenceKindV1;
  candidateMask: FixedRigScalarPlaneV1;
  channelSupport?: FixedRigSurfaceChannelSupportV1[];
  sourceEvidence: MathematicalEvidenceReferenceV1[];
}

export interface FixedRigSurfaceMeasurementCalibrationV1 {
  profile: MathematicalCalibrationProfileV1;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
}

export interface FixedRigSurfaceFindingV1 {
  findingId: string;
  physicalDefectId: string;
  side: "front" | "back";
  category: FixedRigSurfaceCategoryV1;
  secondaryEvidenceCategories: FixedRigSurfaceCategoryV1[];
  detectorIds: string[];
  detectorVersions: string[];
  sourceSeedIds: string[];
  regionId: string;
  overlay: {
    coordinateFrame: "normalized_card_portrait_pixels";
    boundingBoxPx: { x: number; y: number; width: number; height: number };
    normalizedBoundingBox: { x: number; y: number; width: number; height: number };
    validPixelIndices: number[];
    invalidPixelIndices: number[];
  };
  pixelMeasurements: {
    detectedPixelCount: number;
    validPixelCount: number;
    lengthPx: number;
    widthPx: number;
    areaPx2: number;
  };
  measurements: MathematicalMeasurementV1[];
  deductionBasisMeasurementId: string;
  deductionCalculation: FindingDeductionCalculationV1;
  deduction: number;
  evidenceQuality: "sufficient" | "limited";
  validEvidenceCoverage: number;
  glareOrIlluminationOverlapFraction: number;
  calibratedPatternOverlapFraction: number;
  corroboratingChannels: number[];
  alternateChannelRecoveryUsed: boolean;
  severeDefectCap?: number;
  explanation: string;
}

export interface FixedRigSuppressedSurfaceCandidateV1 {
  candidateId: string;
  sourceSeedIds: string[];
  categories: FixedRigSurfaceCategoryV1[];
  reason:
    | "calibrated_illumination_pattern"
    | "static_appearance_explained"
    | "glare_explained"
    | "insufficient_valid_coverage"
    | "insufficient_multi_channel_evidence";
  detectedPixelCount: number;
  validPixelCount: number;
  validEvidenceCoverage: number;
  glareOrIlluminationOverlapFraction: number;
  calibratedPatternOverlapFraction: number;
  staticAppearanceOverlapFraction: number;
  corroboratingChannels: number[];
  requiresRecapture: boolean;
  cardDefectDeduction: 0;
  message: string;
}

export interface FixedRigSurfaceV1Result {
  version: typeof FIXED_RIG_SURFACE_V1_VERSION;
  photometricEvidenceVersion: typeof FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION;
  status: "computed" | "insufficient_evidence";
  side: "front" | "back";
  score: number | null;
  startingScore: 10;
  totalDeduction: number;
  formula: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula;
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  sourceEvidence: Array<{
    assetId: string;
    sha256: string;
    side: "front" | "back";
    role: "directional_channel";
    regionId: string;
    channelIndex: number;
  }>;
  findings: FixedRigSurfaceFindingV1[];
  suppressedCandidates: FixedRigSuppressedSurfaceCandidateV1[];
  evidenceQualityLimitations: Array<{
    code: "surface_region_ungradable" | "surface_fully_obscured" | "surface_global_coverage_insufficient";
    regionId: string;
    requiresRecapture: boolean;
    message: string;
  }>;
  heatmap: {
    role: "visualization_only";
    source: "valid_directional_residuals";
    usedAsIndependentGradingEvidence: false;
    response: Float32Array;
  };
  connectedComponentCount: number;
  uniquePhysicalFindingCount: number;
  applicableSevereDefectCaps: number[];
  noDoubleDeduction: true;
}

export interface BuildFixedRigSurfaceV1Input {
  side: "front" | "back";
  photometricEvidence: FixedRigPhotometricEvidenceV1;
  calibration: FixedRigSurfaceMeasurementCalibrationV1;
  algorithmVersion: string;
  candidateSeeds: FixedRigSurfaceCandidateSeedV1[];
  /** Optional registered calibrated depth in millimeters. */
  depthMm?: FixedRigScalarPlaneV1;
  /** Optional calibrated directional relief index. */
  reliefIndex?: FixedRigScalarPlaneV1;
}

interface SeedComponent {
  componentId: number;
  seed: FixedRigSurfaceCandidateSeedV1;
  pixels: number[];
}

interface CandidateGroup {
  componentIds: number[];
  components: SeedComponent[];
  pixels: number[];
}

interface PhysicalGeometry {
  boundingBoxPx: { x: number; y: number; width: number; height: number };
  lengthPx: number;
  widthPx: number;
  lengthMm: number;
  widthMm: number;
  areaPx2: number;
  areaMm2: number;
  depthMm: number;
  reliefIndex: number;
}

interface CandidateEvidenceStats {
  detectedPixelCount: number;
  validPixels: number[];
  invalidPixels: number[];
  validEvidenceCoverage: number;
  glareOrIlluminationOverlapFraction: number;
  calibratedPatternOverlapFraction: number;
  staticAppearanceOverlapFraction: number;
  corroboratingChannels: number[];
  channelSupportFractions: Array<{ channel: number; fraction: number }>;
  alternateChannelRecoveryUsed: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function fraction(count: number, total: number): number {
  return total > 0 ? round(count / total) : 0;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function assertIdentifier(label: string, value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a stable identifier.`);
  }
}

function assertPlane(
  label: string,
  plane: FixedRigScalarPlaneV1,
  width: number,
  height: number,
): void {
  if (
    plane.width !== width ||
    plane.height !== height ||
    plane.data.length !== width * height
  ) {
    throw new Error(`${label} must exactly match the ${width}x${height} normalized-card frame.`);
  }
}

function validateInput(
  input: BuildFixedRigSurfaceV1Input,
  thresholds: FixedRigSurfaceEvidenceThresholdsV1,
): void {
  const evidence = input.photometricEvidence;
  if (
    evidence.coordinateFrame !== "normalized_card_portrait_pixels" ||
    evidence.version !== FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION
  ) {
    throw new Error("Surface V1 requires Photometric Evidence V1 in normalized-card coordinates.");
  }
  if (
    input.calibration.calibrationProfileId !== evidence.calibration.profileId ||
    input.calibration.calibrationVersion !== evidence.calibration.version ||
    input.calibration.calibrationSha256.toLowerCase() !== evidence.calibration.sha256.toLowerCase()
  ) {
    throw new Error("Surface measurement calibration must exactly match photometric calibration identity.");
  }
  const profileValidation = validateMathematicalCalibrationForOperationalUseV1(input.calibration.profile);
  const profile = profileValidation.profile;
  if (
    !profileValidation.valid ||
    (!profileValidation.isCalibrated && !profileValidation.isOperationallyAccepted) ||
    !profile ||
    profile.profileId !== input.calibration.calibrationProfileId ||
    profile.calibrationVersion !== input.calibration.calibrationVersion ||
    profile.artifactSha256 !== input.calibration.calibrationSha256 ||
    profile.normalizedWidthPx !== evidence.width ||
    profile.normalizedHeightPx !== evidence.height ||
    Math.abs(input.calibration.pixelsPerMmX - 1 / profile.mmPerPixelX) > 1e-9 ||
    Math.abs(input.calibration.pixelsPerMmY - 1 / profile.mmPerPixelY) > 1e-9
  ) {
    throw new Error("Surface frame, scale, and identity must be derived exactly from one finalized calibration profile.");
  }
  if (!isSha256(input.calibration.calibrationSha256)) {
    throw new Error("Surface measurement calibration SHA-256 is invalid.");
  }
  if (
    !Number.isFinite(input.calibration.pixelsPerMmX) ||
    !Number.isFinite(input.calibration.pixelsPerMmY) ||
    input.calibration.pixelsPerMmX <= 0 ||
    input.calibration.pixelsPerMmY <= 0
  ) {
    throw new Error("Surface V1 requires positive calibrated X/Y pixel-per-mm scales.");
  }
  assertIdentifier("algorithmVersion", input.algorithmVersion);
  assertIdentifier("calibrationProfileId", input.calibration.calibrationProfileId);
  assertIdentifier("calibrationVersion", input.calibration.calibrationVersion);
  if (input.depthMm) assertPlane("depthMm", input.depthMm, evidence.width, evidence.height);
  if (input.reliefIndex) assertPlane("reliefIndex", input.reliefIndex, evidence.width, evidence.height);
  if (evidence.staticAppearanceAmbiguityMask.length !== evidence.width * evidence.height) {
    throw new Error("Static-appearance ambiguity mask must exactly match the normalized-card frame.");
  }
  const seedIds = new Set<string>();
  for (const seed of input.candidateSeeds) {
    assertIdentifier("seedId", seed.seedId);
    assertIdentifier("detectorId", seed.detectorId);
    assertIdentifier("detectorVersion", seed.detectorVersion);
    if (seedIds.has(seed.seedId.toLowerCase())) throw new Error(`Duplicate surface seed ${seed.seedId}.`);
    seedIds.add(seed.seedId.toLowerCase());
    assertPlane(`Seed ${seed.seedId} mask`, seed.candidateMask, evidence.width, evidence.height);
    if (!seed.sourceEvidence.length) throw new Error(`Seed ${seed.seedId} requires immutable source evidence.`);
    for (const support of seed.channelSupport ?? []) {
      if (!evidence.channels.some((channel) => channel.channel === support.channel)) {
        throw new Error(`Seed ${seed.seedId} references unavailable channel ${support.channel}.`);
      }
      assertPlane(
        `Seed ${seed.seedId} channel ${support.channel} support`,
        support.supportMask,
        evidence.width,
        evidence.height,
      );
    }
  }
  if (thresholds.minCorroboratingChannels > evidence.channelCount) {
    throw new Error("Surface corroboration policy exceeds available photometric channel count.");
  }
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],             [1, 0],
  [-1, 1],  [0, 1],   [1, 1],
] as const;

function extractConnectedComponents(
  seed: FixedRigSurfaceCandidateSeedV1,
  width: number,
  height: number,
  minimumPixels: number,
  firstComponentId: number,
): SeedComponent[] {
  const visited = new Uint8Array(width * height);
  const components: SeedComponent[] = [];
  let nextId = firstComponentId;
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || Number(seed.candidateMask.data[start]) <= 0) continue;
    const queue = [start];
    const pixels: number[] = [];
    visited[start] = 1;
    while (queue.length) {
      const current = queue.pop() as number;
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (visited[next] || Number(seed.candidateMask.data[next]) <= 0) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (pixels.length >= minimumPixels) {
      components.push({ componentId: nextId, seed, pixels: pixels.sort((left, right) => left - right) });
      nextId += 1;
    }
  }
  return components;
}

class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(value: number): number {
    const parent = this.parent[value] as number;
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

function componentPixelIou(left: SeedComponent, right: SeedComponent): number {
  const leftPixels = new Set(left.pixels);
  const intersection = right.pixels.reduce(
    (count, pixel) => count + (leftPixels.has(pixel) ? 1 : 0),
    0,
  );
  return intersection / (left.pixels.length + right.pixels.length - intersection);
}

function componentCentroidDistanceMm(
  left: SeedComponent,
  right: SeedComponent,
  frameWidth: number,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): number {
  const centroid = (component: SeedComponent) => component.pixels.reduce(
    (sum, pixel) => ({
      x: sum.x + (pixel % frameWidth) / component.pixels.length,
      y: sum.y + Math.floor(pixel / frameWidth) / component.pixels.length,
    }),
    { x: 0, y: 0 },
  );
  const leftCentroid = centroid(left);
  const rightCentroid = centroid(right);
  return Math.hypot(
    (leftCentroid.x - rightCentroid.x) / pixelsPerMmX,
    (leftCentroid.y - rightCentroid.y) / pixelsPerMmY,
  );
}

function mergeOverlappingComponents(
  components: SeedComponent[],
  input: BuildFixedRigSurfaceV1Input,
): CandidateGroup[] {
  const sets = new DisjointSet(components.length);
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence;
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex += 1) {
      const left = components[leftIndex]!;
      const right = components[rightIndex]!;
      const iou = componentPixelIou(left, right);
      const centroidDistanceMm = componentCentroidDistanceMm(
        left,
        right,
        input.photometricEvidence.width,
        input.calibration.pixelsPerMmX,
        input.calibration.pixelsPerMmY,
      );
      if (
        iou >= policy.candidateOverlapMergeIouThreshold ||
        centroidDistanceMm <= policy.candidateOverlapMergeCentroidDistanceMm
      ) {
        sets.union(leftIndex, rightIndex);
      }
    }
  }
  const byRoot = new Map<number, SeedComponent[]>();
  components.forEach((component, index) => {
    const root = sets.find(index);
    const members = byRoot.get(root) ?? [];
    members.push(component);
    byRoot.set(root, members);
  });
  return [...byRoot.values()]
    .map((members) => ({
      componentIds: members.map((component) => component.componentId).sort((left, right) => left - right),
      components: members,
      pixels: [...new Set(members.flatMap((component) => component.pixels))].sort((left, right) => left - right),
    }))
    .sort((left, right) => (left.pixels[0] ?? 0) - (right.pixels[0] ?? 0));
}

function buildCandidateEvidenceStats(
  group: CandidateGroup,
  evidence: FixedRigPhotometricEvidenceV1,
  thresholds: FixedRigSurfaceEvidenceThresholdsV1,
): CandidateEvidenceStats {
  const validPixels = group.pixels.filter((pixel) => !evidence.invalidIlluminationMask[pixel]);
  const invalidPixels = group.pixels.filter((pixel) => Boolean(evidence.invalidIlluminationMask[pixel]));
  const glarePixels = group.pixels.filter(
    (pixel) => evidence.specularOrIlluminationMask[pixel] || evidence.clippingMask[pixel],
  ).length;
  const calibratedPatternPixels = group.pixels.filter(
    (pixel) => evidence.calibratedIlluminationPatternMask[pixel],
  ).length;
  const staticAppearancePixels = group.pixels.filter(
    (pixel) => evidence.staticAppearanceAmbiguityMask[pixel],
  ).length;
  const corroboratingChannels: number[] = [];
  const channelSupportFractions: Array<{ channel: number; fraction: number }> = [];
  for (const channel of evidence.channels) {
    let supportingPixels = 0;
    for (const pixel of validPixels) {
      if (!channel.validDirectionalObservationMask[pixel]) continue;
      const explicitSupports = group.components
        .flatMap((component) => component.seed.channelSupport ?? [])
        .filter((support) => support.channel === channel.channel);
      const supported = explicitSupports.length
        ? explicitSupports.some((support) => Number(support.supportMask.data[pixel]) > 0)
        : Math.abs(channel.directionalResidual[pixel] ?? 0) >= thresholds.directionalResidualThreshold;
      if (supported) supportingPixels += 1;
    }
    const supportFraction = fraction(supportingPixels, validPixels.length);
    channelSupportFractions.push({ channel: channel.channel, fraction: supportFraction });
    if (
      validPixels.length > 0 &&
      supportFraction >= thresholds.corroboratingPixelFraction
    ) {
      corroboratingChannels.push(channel.channel);
    }
  }
  const validEvidenceCoverage = fraction(validPixels.length, group.pixels.length);
  const glareOrIlluminationOverlapFraction = fraction(glarePixels, group.pixels.length);
  const alternateChannelRecoveryUsed =
    glarePixels > 0 &&
    validEvidenceCoverage >= thresholds.alternateChannelRecoveryMinCoverage &&
    corroboratingChannels.length >= thresholds.minCorroboratingChannels;
  return {
    detectedPixelCount: group.pixels.length,
    validPixels,
    invalidPixels,
    validEvidenceCoverage,
    glareOrIlluminationOverlapFraction,
    calibratedPatternOverlapFraction: fraction(calibratedPatternPixels, group.pixels.length),
    staticAppearanceOverlapFraction: fraction(staticAppearancePixels, group.pixels.length),
    corroboratingChannels,
    channelSupportFractions,
    alternateChannelRecoveryUsed,
  };
}

function principalExtents(
  pixels: readonly number[],
  width: number,
  unitX: number,
  unitY: number,
): { length: number; width: number } {
  const measured = measureFixedRigPrincipalExtentsV1(
    pixels,
    width,
    unitX,
    unitY,
  );
  return { length: round(measured.length), width: round(measured.width) };
}

function measureGeometry(
  validPixels: readonly number[],
  input: BuildFixedRigSurfaceV1Input,
): PhysicalGeometry {
  const { width, height } = input.photometricEvidence;
  if (!validPixels.length) {
    return {
      boundingBoxPx: { x: 0, y: 0, width: 0, height: 0 },
      lengthPx: 0,
      widthPx: 0,
      lengthMm: 0,
      widthMm: 0,
      areaPx2: 0,
      areaMm2: 0,
      depthMm: 0,
      reliefIndex: 0,
    };
  }
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const pixel of validPixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
    minimumY = Math.min(minimumY, y);
    maximumY = Math.max(maximumY, y);
  }
  const pixelExtents = principalExtents(validPixels, width, 1, 1);
  const physicalExtents = principalExtents(
    validPixels,
    width,
    1 / input.calibration.pixelsPerMmX,
    1 / input.calibration.pixelsPerMmY,
  );
  const finitePlaneMaximum = (plane: FixedRigScalarPlaneV1 | undefined) => {
    if (!plane) return 0;
    let maximum = 0;
    for (const pixel of validPixels) {
      const value = Math.abs(Number(plane.data[pixel]));
      if (Number.isFinite(value)) maximum = Math.max(maximum, value);
    }
    return round(maximum);
  };
  return {
    boundingBoxPx: {
      x: clamp(minimumX, 0, width - 1),
      y: clamp(minimumY, 0, height - 1),
      width: clamp(maximumX - minimumX + 1, 1, width),
      height: clamp(maximumY - minimumY + 1, 1, height),
    },
    lengthPx: pixelExtents.length,
    widthPx: pixelExtents.width,
    lengthMm: physicalExtents.length,
    widthMm: physicalExtents.width,
    areaPx2: validPixels.length,
    areaMm2: round(
      validPixels.length /
        (input.calibration.pixelsPerMmX * input.calibration.pixelsPerMmY),
    ),
    depthMm: finitePlaneMaximum(input.depthMm),
    reliefIndex: finitePlaneMaximum(input.reliefIndex),
  };
}

function deduplicateEvidence(
  evidence: MathematicalEvidenceReferenceV1[],
): MathematicalEvidenceReferenceV1[] {
  const unique = new Map<string, MathematicalEvidenceReferenceV1>();
  for (const entry of evidence) {
    const key = `${entry.assetId.toLowerCase()}:${entry.regionId.toLowerCase()}:${entry.channelIndex ?? 0}`;
    const existing = unique.get(key);
    if (existing && (
      existing.sha256.toLowerCase() !== entry.sha256.toLowerCase() ||
      existing.side !== entry.side ||
      existing.role !== entry.role
    )) {
      throw new Error(`Conflicting immutable evidence authority for ${entry.assetId} in ${entry.regionId}.`);
    }
    if (!existing) unique.set(key, entry);
  }
  return [...unique.values()];
}

function evidenceForGroup(
  group: CandidateGroup,
  stats: CandidateEvidenceStats,
  input: BuildFixedRigSurfaceV1Input,
  regionId: string,
): MathematicalEvidenceReferenceV1[] {
  // Seed-local region IDs describe detector candidates, not the fused physical
  // finding. Rebind every immutable source reference to the final region before
  // deduplication so repeated channel authority cannot multiply ledger evidence.
  const source = group.components.flatMap((component) =>
    component.seed.sourceEvidence.map((entry) => ({ ...entry, regionId }))
  );
  const channels = input.photometricEvidence.channels
    .filter((channel) => stats.corroboratingChannels.includes(channel.channel))
    .map((channel): MathematicalEvidenceReferenceV1 => ({
      assetId: channel.sourceEvidenceId,
      sha256: channel.sourceSha256,
      side: input.side,
      role: "directional_channel",
      regionId,
      channelIndex: channel.channel,
    }));
  return deduplicateEvidence([...source, ...channels]);
}

function measurementPolicy(category: FixedRigSurfaceCategoryV1) {
  return MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[category];
}

function primaryMeasurementValue(
  category: FixedRigSurfaceCategoryV1,
  geometry: PhysicalGeometry,
): { kind: MathematicalMeasurementKindV1; unit: MathematicalMeasurementUnitV1; value: number } {
  const policy = measurementPolicy(category);
  const valueByKind: Partial<Record<MathematicalMeasurementKindV1, number>> = {
    length_mm: geometry.lengthMm,
    width_mm: geometry.widthMm,
    area_mm2: geometry.areaMm2,
    deformation_area_mm2: geometry.areaMm2,
    depth_mm: geometry.depthMm,
    relief_index: geometry.reliefIndex,
  };
  const value = valueByKind[policy.primaryMeasurementKind];
  if (value === undefined) {
    throw new Error(`Surface category ${category} has unsupported primary measurement ${policy.primaryMeasurementKind}.`);
  }
  return { kind: policy.primaryMeasurementKind, unit: policy.unit, value };
}

function makeMeasurement(input: {
  measurementId: string;
  kind: MathematicalMeasurementKindV1;
  unit: MathematicalMeasurementUnitV1;
  value: number;
  explicitGrade10Tolerance: number;
  buildInput: BuildFixedRigSurfaceV1Input;
  evidence: MathematicalEvidenceReferenceV1[];
  stats: CandidateEvidenceStats;
}): MathematicalMeasurementV1 {
  const measuredMeasurement = round(input.value);
  const derived = deriveFixedRigMeasurementUncertaintyV1({
    calibration: input.buildInput.calibration.profile,
    kind: input.kind,
    measuredMeasurement,
  }).componentsU95;
  const surfacePolicy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence;
  const observedDirectionalChannelCount = input.stats.corroboratingChannels.length;
  const observableSingleChannel =
    observedDirectionalChannelCount >= 1 &&
    observedDirectionalChannelCount < surfacePolicy.minCorroboratingChannels &&
    input.stats.validEvidenceCoverage > 0 &&
    Math.max(...input.stats.channelSupportFractions.map((entry) => entry.fraction), 0) > 0;
  const uncertaintyInflationU95 = observableSingleChannel
    ? round(Math.max(
        derived.measurementRepeatability,
        measuredMeasurement *
          (1 - observedDirectionalChannelCount /
            surfacePolicy.minValidDirectionalObservations),
      ))
    : 0;
  const uncertaintyComponentsU95 = observableSingleChannel
    ? {
        ...derived,
        lightingChannelConfidence: round(Math.hypot(
          derived.lightingChannelConfidence,
          uncertaintyInflationU95,
        )),
      }
    : derived;
  return buildMathematicalMeasurementV1({
    measurementId: input.measurementId,
    kind: input.kind,
    unit: input.unit,
    measuredMeasurement,
    uncertaintyComponentsU95,
    explicitGrade10Tolerance: input.explicitGrade10Tolerance,
    calibrationProfileId: input.buildInput.calibration.calibrationProfileId,
    calibrationVersion: input.buildInput.calibration.calibrationVersion,
    algorithmVersion: input.buildInput.algorithmVersion,
    evidence: input.evidence,
    validEvidenceCoverage: input.stats.validEvidenceCoverage,
    usableDirectionalChannelCount: observedDirectionalChannelCount,
    ...(observableSingleChannel ? {
      observableEvidenceAdmission: {
        schemaVersion: MATHEMATICAL_OBSERVABLE_EVIDENCE_ADMISSION_V1_VERSION,
        reason: "single_directional_channel_surface_observation" as const,
        observedDirectionalChannelCount,
        candidateCorroboratingChannelRequirement:
          surfacePolicy.minCorroboratingChannels,
        nominalMeasurementDirectionalChannelCount:
          surfacePolicy.minValidDirectionalObservations,
        requiredCalibratedChannelCount:
          MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount,
        strongestChannelSupportFraction: Math.max(
          ...input.stats.channelSupportFractions.map((entry) => entry.fraction),
          0,
        ),
        minimumChannelSupportFraction:
          surfacePolicy.corroboratingPixelFraction,
        uncertaintyInflationU95,
        confidenceFormula:
          "min(validEvidenceCoverage, observedDirectionalChannelCount / requiredCalibratedChannelCount)" as const,
      },
    } : {}),
  });
}

function buildMeasurements(
  category: FixedRigSurfaceCategoryV1,
  geometry: PhysicalGeometry,
  groupIndex: number,
  input: BuildFixedRigSurfaceV1Input,
  evidence: MathematicalEvidenceReferenceV1[],
  stats: CandidateEvidenceStats,
): { measurements: MathematicalMeasurementV1[]; deductionBasis: MathematicalMeasurementV1 } {
  const policy = measurementPolicy(category);
  const primary = primaryMeasurementValue(category, geometry);
  const prefix = `surface-${input.side}-${groupIndex + 1}-${category}`;
  const measurements: MathematicalMeasurementV1[] = [];
  const add = (
    suffix: string,
    kind: MathematicalMeasurementKindV1,
    unit: MathematicalMeasurementUnitV1,
    value: number,
    tolerance: number,
  ) => {
    if (measurements.some((measurement) => measurement.kind === kind)) return;
    measurements.push(makeMeasurement({
      measurementId: `${prefix}-${suffix}`,
      kind,
      unit,
      value,
      explicitGrade10Tolerance: tolerance,
      buildInput: input,
      evidence,
      stats,
    }));
  };
  add("length", "length_mm", "mm", geometry.lengthMm, primary.kind === "length_mm" ? policy.grade10Tolerance : 0);
  add("width", "width_mm", "mm", geometry.widthMm, primary.kind === "width_mm" ? policy.grade10Tolerance : 0);
  add(
    "area",
    primary.kind === "deformation_area_mm2" ? "deformation_area_mm2" : "area_mm2",
    "mm2",
    geometry.areaMm2,
    primary.kind === "area_mm2" || primary.kind === "deformation_area_mm2" ? policy.grade10Tolerance : 0,
  );
  if (input.depthMm) add("depth", "depth_mm", "mm", geometry.depthMm, primary.kind === "depth_mm" ? policy.grade10Tolerance : 0);
  if (input.reliefIndex) {
    add(
      "relief",
      "relief_index",
      "relief_index",
      geometry.reliefIndex,
      primary.kind === "relief_index" ? policy.grade10Tolerance : 0,
    );
  }
  let deductionBasis = measurements.find((measurement) => measurement.kind === primary.kind);
  if (!deductionBasis) {
    deductionBasis = makeMeasurement({
      measurementId: `${prefix}-primary`,
      kind: primary.kind,
      unit: primary.unit,
      value: primary.value,
      explicitGrade10Tolerance: policy.grade10Tolerance,
      buildInput: input,
      evidence,
      stats,
    });
    measurements.push(deductionBasis);
  }
  return { measurements, deductionBasis };
}

function buildHeatmap(evidence: FixedRigPhotometricEvidenceV1): Float32Array {
  const response = new Float32Array(evidence.width * evidence.height);
  for (let pixel = 0; pixel < response.length; pixel += 1) {
    if (evidence.invalidIlluminationMask[pixel]) continue;
    let maximum = 0;
    for (const channel of evidence.channels) {
      if (!channel.validDirectionalObservationMask[pixel]) continue;
      maximum = Math.max(maximum, Math.abs(channel.directionalResidual[pixel] ?? 0));
    }
    response[pixel] = maximum;
  }
  return response;
}

function suppressionForCandidate(
  stats: CandidateEvidenceStats,
  thresholds: FixedRigSurfaceEvidenceThresholdsV1,
): Pick<FixedRigSuppressedSurfaceCandidateV1, "reason" | "requiresRecapture" | "message"> | undefined {
  if (stats.calibratedPatternOverlapFraction >= thresholds.glareSuppressionOverlapFraction) {
    const alternateEvidenceResolvesRegion =
      stats.validEvidenceCoverage >= thresholds.minValidPixelCoverage;
    return {
      reason: "calibrated_illumination_pattern",
      requiresRecapture: false,
      message: alternateEvidenceResolvesRegion
        ? "The candidate is substantially explained by the calibrated channel-selective illumination signature; valid alternate observations resolve the region and it receives no physical-damage deduction."
        : "The candidate is substantially explained by calibrated illumination and is excluded without blocking observable measurements elsewhere; no physical-damage deduction is made.",
    };
  }
  if (stats.staticAppearanceOverlapFraction >= thresholds.glareSuppressionOverlapFraction) {
    return {
      reason: "static_appearance_explained",
      requiresRecapture: false,
      message:
        "The candidate follows a static printed-appearance boundary in the registered common-mode card image. It remains internal ambiguity context, receives no physical-damage deduction, and does not block observable measurements elsewhere.",
    };
  }
  if (
    stats.glareOrIlluminationOverlapFraction >= thresholds.glareSuppressionOverlapFraction &&
    !stats.alternateChannelRecoveryUsed
  ) {
    return {
      reason: "glare_explained",
      requiresRecapture: false,
      message: "Glare/specular evidence explains the candidate, so it is excluded without blocking observable measurements elsewhere.",
    };
  }
  if (stats.validPixels.length === 0) {
    return {
      reason: "insufficient_valid_coverage",
      requiresRecapture: false,
      message: "This local candidate contains no observable pixels and is excluded; it does not block measurements elsewhere.",
    };
  }
  if (
    stats.corroboratingChannels.length < thresholds.minCorroboratingChannels &&
    stats.corroboratingChannels.length < 1
  ) {
    const strongest = [...stats.channelSupportFractions].sort((left, right) =>
      right.fraction - left.fraction || left.channel - right.channel)[0];
    return {
      reason: "insufficient_multi_channel_evidence",
      requiresRecapture: false,
      message:
        "The local candidate has no observable directional-channel support and is excluded without blocking the card. " +
        `${stats.corroboratingChannels.length}/${thresholds.minCorroboratingChannels} channels passed; ` +
        `strongest channel support ${strongest?.fraction ?? 0} ` +
        `(required ${thresholds.corroboratingPixelFraction}); valid coverage ` +
        `${stats.validEvidenceCoverage}.`,
    };
  }
  return undefined;
}

/**
 * Scores physical surface condition from validated source evidence. Evidence
 * quality changes private confidence/U95 but can withhold a score only when
 * the complete surface is genuinely unobservable. Every physical component
 * is merged to one primary category before summation.
 */
export function buildFixedRigSurfaceV1(
  input: BuildFixedRigSurfaceV1Input,
): FixedRigSurfaceV1Result {
  const thresholds = resolveFixedRigSurfaceEvidenceThresholdsV1();
  validateInput(input, thresholds);
  const { photometricEvidence: photometric } = input;
  const allComponents: SeedComponent[] = [];
  let nextComponentId = 1;
  for (const seed of input.candidateSeeds) {
    const components = extractConnectedComponents(
      seed,
      photometric.width,
      photometric.height,
      thresholds.minConnectedComponentPixels,
      nextComponentId,
    );
    allComponents.push(...components);
    nextComponentId += components.length;
  }
  const groups = mergeOverlappingComponents(allComponents, input);
  const findings: FixedRigSurfaceFindingV1[] = [];
  const suppressedCandidates: FixedRigSuppressedSurfaceCandidateV1[] = [];
  const evidenceQualityLimitations: FixedRigSurfaceV1Result["evidenceQualityLimitations"] = [];

  groups.forEach((group, groupIndex) => {
    const stats = buildCandidateEvidenceStats(group, photometric, thresholds);
    const categories = [...new Set(group.components.map((component) => component.seed.category))]
      .sort((left, right) => left.localeCompare(right));
    const sourceSeedIds = [...new Set(group.components.map((component) => component.seed.seedId))]
      .sort((left, right) => left.localeCompare(right));
    const candidateId = `surface-${input.side}-candidate-${groupIndex + 1}`;
    const suppression = suppressionForCandidate(stats, thresholds);
    if (suppression) {
      suppressedCandidates.push({
        candidateId,
        sourceSeedIds,
        categories,
        reason: suppression.reason,
        detectedPixelCount: stats.detectedPixelCount,
        validPixelCount: stats.validPixels.length,
        validEvidenceCoverage: stats.validEvidenceCoverage,
        glareOrIlluminationOverlapFraction: stats.glareOrIlluminationOverlapFraction,
        calibratedPatternOverlapFraction: stats.calibratedPatternOverlapFraction,
        staticAppearanceOverlapFraction: stats.staticAppearanceOverlapFraction,
        corroboratingChannels: stats.corroboratingChannels,
        requiresRecapture: suppression.requiresRecapture,
        cardDefectDeduction: 0,
        message: suppression.message,
      });
      return;
    }

    const geometry = measureGeometry(stats.validPixels, input);
    const regionId = `surface-${input.side}-region-${groupIndex + 1}`;
    const evidence = evidenceForGroup(group, stats, input, regionId);
    const categoryResults = categories.map((category) => {
      const built = buildMeasurements(category, geometry, groupIndex, input, evidence, stats);
      const calculation = calculateFindingDeductionV1({
        category,
        measuredMeasurement: built.deductionBasis.measuredMeasurement,
        u95: built.deductionBasis.u95,
      });
      return { category, ...built, calculation };
    });
    categoryResults.sort((left, right) =>
      right.calculation.deduction - left.calculation.deduction ||
      left.category.localeCompare(right.category),
    );
    const primary = categoryResults[0];
    if (!primary) return;
    const findingId = `surface-${input.side}-finding-${findings.length + 1}`;
    const physicalDefectId = `surface-${input.side}-physical-${findings.length + 1}`;
    const box = geometry.boundingBoxPx;
    const cap = calculateApplicableSevereDefectCapV1(primary.category, primary.measurements);
    const observableSingleChannel = primary.measurements.some(
      (measurement) => Boolean(measurement.observableEvidenceAdmission),
    );
    findings.push({
      findingId,
      physicalDefectId,
      side: input.side,
      category: primary.category,
      secondaryEvidenceCategories: categories.filter((category) => category !== primary.category),
      detectorIds: [...new Set(group.components.map((component) => component.seed.detectorId))]
        .sort((left, right) => left.localeCompare(right)),
      detectorVersions: [...new Set(group.components.map((component) => component.seed.detectorVersion))]
        .sort((left, right) => left.localeCompare(right)),
      sourceSeedIds,
      regionId,
      overlay: {
        coordinateFrame: "normalized_card_portrait_pixels",
        boundingBoxPx: box,
        normalizedBoundingBox: {
          x: round(box.x / photometric.width),
          y: round(box.y / photometric.height),
          width: round(box.width / photometric.width),
          height: round(box.height / photometric.height),
        },
        validPixelIndices: stats.validPixels,
        invalidPixelIndices: stats.invalidPixels,
      },
      pixelMeasurements: {
        detectedPixelCount: stats.detectedPixelCount,
        validPixelCount: stats.validPixels.length,
        lengthPx: geometry.lengthPx,
        widthPx: geometry.widthPx,
        areaPx2: geometry.areaPx2,
      },
      measurements: primary.measurements,
      deductionBasisMeasurementId: primary.deductionBasis.measurementId,
      deductionCalculation: primary.calculation,
      deduction: primary.calculation.deduction,
      evidenceQuality: observableSingleChannel ? "limited" : "sufficient",
      validEvidenceCoverage: stats.validEvidenceCoverage,
      glareOrIlluminationOverlapFraction: stats.glareOrIlluminationOverlapFraction,
      calibratedPatternOverlapFraction: stats.calibratedPatternOverlapFraction,
      corroboratingChannels: stats.corroboratingChannels,
      alternateChannelRecoveryUsed: stats.alternateChannelRecoveryUsed,
      ...(cap === undefined ? {} : { severeDefectCap: cap }),
      explanation:
        `${primary.category} measured ${primary.deductionBasis.measuredMeasurement} ${primary.deductionBasis.unit}; ` +
        `effective measurement ${primary.deductionBasis.effectiveMeasurement}; ` +
        `exact deduction ${primary.calculation.deduction.toFixed(2)}.` +
        (observableSingleChannel
          ? " One observable directional channel supported this visible measurement."
          : ""),
    });
  });

  for (const region of photometric.ungradableRegions) {
    evidenceQualityLimitations.push({
      code: "surface_region_ungradable",
      regionId: region.regionId,
      requiresRecapture: false,
      message:
        "This local region contains no observable directional pixels and remains excluded; observable measurements elsewhere still produce the surface grade.",
    });
  }
  const fullyObscured = photometric.coverage.validPixelCount <= 0;
  if (fullyObscured) {
    evidenceQualityLimitations.push({
      code: "surface_fully_obscured",
      regionId: `surface-${input.side}-full-card`,
      requiresRecapture: true,
      message: "The calibrated card mask contains zero observable directional pixels; no physical surface measurement can be issued.",
    });
  } else if (photometric.coverage.validPixelFraction < thresholds.minValidPixelCoverage) {
    evidenceQualityLimitations.push({
      code: "surface_global_coverage_insufficient",
      regionId: `surface-${input.side}-full-card`,
      requiresRecapture: false,
      message: "Full-surface valid-pixel coverage is limited; observable measurements remain scored and the limitation is private quality context.",
    });
  }
  const status =
    !fullyObscured
      ? "computed"
      : "insufficient_evidence";
  const totalDeduction = round(findings.reduce((sum, finding) => sum + finding.deduction, 0), 2);
  const applicableSevereDefectCaps = findings
    .flatMap((finding) => finding.severeDefectCap === undefined ? [] : [finding.severeDefectCap])
    .sort((left, right) => left - right);

  return {
    version: FIXED_RIG_SURFACE_V1_VERSION,
    photometricEvidenceVersion: FIXED_RIG_PHOTOMETRIC_EVIDENCE_V1_VERSION,
    status,
    side: input.side,
    score: status === "computed" ? roundMathematicalScoreV1(10 - totalDeduction) : null,
    startingScore: 10,
    totalDeduction,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: input.calibration.calibrationProfileId,
    calibrationVersion: input.calibration.calibrationVersion,
    calibrationSha256: input.calibration.calibrationSha256,
    sourceEvidence: photometric.channels.map((channel) => ({
      assetId: channel.sourceEvidenceId,
      sha256: channel.sourceSha256,
      side: input.side,
      role: "directional_channel",
      regionId: `${input.side}-full-surface`,
      channelIndex: channel.channel,
    })),
    findings,
    suppressedCandidates,
    evidenceQualityLimitations,
    heatmap: {
      role: "visualization_only",
      source: "valid_directional_residuals",
      usedAsIndependentGradingEvidence: false,
      response: buildHeatmap(photometric),
    },
    connectedComponentCount: allComponents.length,
    uniquePhysicalFindingCount: findings.length,
    applicableSevereDefectCaps,
    noDoubleDeduction: true,
  };
}
