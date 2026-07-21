import crypto from "node:crypto";
import sharp from "sharp";
import type { FixedRigLensDistortionModelV1 } from "./fixedRigPhysicalCalibrationV1";
import type { MathematicalCalibrationPreviewCheckerboard } from "./mathematicalCalibrationPreviewCheckerboard";

export const FAST_CALIBRATION_INTERNAL_COLUMNS_V1_2 = 11 as const;
export const FAST_CALIBRATION_INTERNAL_ROWS_V1_2 = 16 as const;
export const FAST_CALIBRATION_NORMALIZED_GRID_SIZE_V1_2 = 8 as const;

export type FastCalibrationPointV1_2 = { x: number; y: number };
export type FastCalibrationHomographyV1_2 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface FastCalibrationGeometrySolutionV1_2 {
  normalizedToUndistortedHomography: FastCalibrationHomographyV1_2;
  normalizationResidualPx: number[];
  segmentationBoundaryResidualPx: number[];
  rawOuterCorners: readonly [FastCalibrationPointV1_2, FastCalibrationPointV1_2, FastCalibrationPointV1_2, FastCalibrationPointV1_2];
}

export interface FastCalibrationAlgorithmManifestV1_2 {
  schemaVersion: "ten-kings-fast-calibration-algorithm-manifest-v1.2";
  geometry: {
    implementationSha256: string;
    detectorScriptSha256: string;
    detectorDependencyManifestSha256: string;
    dependencySha256: string;
    manifestSha256: string;
  };
  photometric: {
    implementationSha256: string;
    dependencySha256: string;
    manifestSha256: string;
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function digest(value: Uint8Array | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Fast calibration math produced a non-finite value.");
  return Number(value.toFixed(9));
}

function lensCoefficients(model: FixedRigLensDistortionModelV1): number[] {
  if (model.model !== "opencv_brown_conrady_v1" || model.cameraMatrix.length !== 9 ||
      model.distortionCoefficients.length < 4 || model.distortionCoefficients.length > 14) {
    throw new Error("Fast calibration requires one exact Brown-Conrady lens authority.");
  }
  const values = [...model.distortionCoefficients, ...Array(14).fill(0)].slice(0, 14);
  if (values.slice(12).some((value) => value !== 0)) {
    throw new Error("Fast calibration V1.2 rejects unsupported Brown-Conrady sensor-tilt coefficients.");
  }
  return values;
}

function normalizedFromPixel(point: FastCalibrationPointV1_2, model: FixedRigLensDistortionModelV1): FastCalibrationPointV1_2 {
  const [fx, skew, cx, , fy, cy] = model.cameraMatrix;
  if (![fx, skew, cx, fy, cy].every(Number.isFinite) || fx === 0 || fy === 0) {
    throw new Error("Brown-Conrady camera matrix is singular or non-finite.");
  }
  const y = (point.y - cy!) / fy!;
  return { x: (point.x - cx! - skew! * y) / fx!, y };
}

function pixelFromNormalized(point: FastCalibrationPointV1_2, model: FixedRigLensDistortionModelV1): FastCalibrationPointV1_2 {
  const [fx, skew, cx, , fy, cy] = model.cameraMatrix;
  return { x: fx! * point.x + skew! * point.y + cx!, y: fy! * point.y + cy! };
}

function distortNormalized(point: FastCalibrationPointV1_2, model: FixedRigLensDistortionModelV1): FastCalibrationPointV1_2 {
  const [k1, k2, p1, p2, k3, k4, k5, k6, s1, s2, s3, s4] = lensCoefficients(model);
  const x2 = point.x * point.x;
  const y2 = point.y * point.y;
  const xy = point.x * point.y;
  const r2 = x2 + y2;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const denominator = 1 + k4! * r2 + k5! * r4 + k6! * r6;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) throw new Error("Brown-Conrady rational denominator is singular.");
  const radial = (1 + k1! * r2 + k2! * r4 + k3! * r6) / denominator;
  return {
    x: point.x * radial + 2 * p1! * xy + p2! * (r2 + 2 * x2) + s1! * r2 + s2! * r4,
    y: point.y * radial + p1! * (r2 + 2 * y2) + 2 * p2! * xy + s3! * r2 + s4! * r4,
  };
}

export function distortFastCalibrationPixelV1_2(
  undistortedPixel: FastCalibrationPointV1_2,
  model: FixedRigLensDistortionModelV1,
): FastCalibrationPointV1_2 {
  return pixelFromNormalized(distortNormalized(normalizedFromPixel(undistortedPixel, model), model), model);
}

export function undistortFastCalibrationPixelV1_2(
  observedPixel: FastCalibrationPointV1_2,
  model: FixedRigLensDistortionModelV1,
): FastCalibrationPointV1_2 {
  const observed = normalizedFromPixel(observedPixel, model);
  let estimate = { ...observed };
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const projected = distortNormalized(estimate, model);
    estimate = { x: estimate.x + observed.x - projected.x, y: estimate.y + observed.y - projected.y };
  }
  const verification = distortNormalized(estimate, model);
  if (Math.hypot(verification.x - observed.x, verification.y - observed.y) > 1e-8) {
    throw new Error("Brown-Conrady inverse did not converge for exact calibration evidence.");
  }
  return pixelFromNormalized(estimate, model);
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![pivot]!) > Math.abs(augmented[best]![pivot]!)) best = row;
    }
    if (Math.abs(augmented[best]![pivot]!) < 1e-12) throw new Error("Calibration homography fit is singular.");
    [augmented[pivot], augmented[best]] = [augmented[best]!, augmented[pivot]!];
    const scale = augmented[pivot]![pivot]!;
    for (let column = pivot; column <= size; column += 1) augmented[pivot]![column] /= scale;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]![pivot]!;
      for (let column = pivot; column <= size; column += 1) {
        augmented[row]![column] -= factor * augmented[pivot]![column]!;
      }
    }
  }
  return augmented.map((row) => row[size]!);
}

export function fitFastCalibrationHomographyV1_2(
  pairs: ReadonlyArray<{ source: FastCalibrationPointV1_2; destination: FastCalibrationPointV1_2 }>,
): FastCalibrationHomographyV1_2 {
  if (pairs.length < 4) throw new Error("Calibration homography requires at least four correspondences.");
  const normal = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
  const right = Array<number>(8).fill(0);
  const add = (row: number[], value: number) => {
    for (let i = 0; i < 8; i += 1) {
      right[i] += row[i]! * value;
      for (let j = 0; j < 8; j += 1) normal[i]![j] += row[i]! * row[j]!;
    }
  };
  for (const pair of pairs) {
    const { x, y } = pair.source;
    const { x: u, y: v } = pair.destination;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const values = solveLinearSystem(normal, right);
  return [...values, 1].map(rounded) as unknown as FastCalibrationHomographyV1_2;
}

export function projectFastCalibrationHomographyV1_2(
  homography: FastCalibrationHomographyV1_2,
  point: FastCalibrationPointV1_2,
): FastCalibrationPointV1_2 {
  const denominator = homography[6] * point.x + homography[7] * point.y + homography[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) throw new Error("Calibration homography projects through infinity.");
  return {
    x: (homography[0] * point.x + homography[1] * point.y + homography[2]) / denominator,
    y: (homography[3] * point.x + homography[4] * point.y + homography[5]) / denominator,
  };
}

function distanceToSegment(point: FastCalibrationPointV1_2, start: FastCalibrationPointV1_2, end: FastCalibrationPointV1_2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function deriveFastCalibrationGeometryV1_2(
  result: MathematicalCalibrationPreviewCheckerboard,
  lensModel: FixedRigLensDistortionModelV1,
): FastCalibrationGeometrySolutionV1_2 {
  const columns = FAST_CALIBRATION_INTERNAL_COLUMNS_V1_2;
  const rows = FAST_CALIBRATION_INTERNAL_ROWS_V1_2;
  if (result.internalCorners.length !== columns * rows || result.segmentationBoundary.length < 8) {
    throw new Error("Fast calibration requires the exact checkerboard lattice and an independently segmented outer boundary.");
  }
  if (lensModel.sourceWidthPx !== result.imageWidth || lensModel.sourceHeightPx !== result.imageHeight) {
    throw new Error("Brown-Conrady lens authority dimensions differ from the exact still.");
  }
  const correspondences = result.internalCorners.map((point, index) => ({
    source: { x: index % columns, y: Math.floor(index / columns) },
    destination: undistortFastCalibrationPixelV1_2(point, lensModel),
  }));
  const training = correspondences.filter((pair) => (pair.source.x + 2 * pair.source.y) % 5 !== 0);
  const holdout = correspondences.filter((pair) => (pair.source.x + 2 * pair.source.y) % 5 === 0);
  if (training.length < 100 || holdout.length < 20) throw new Error("Deterministic homography holdout partition is incomplete.");
  const homography = fitFastCalibrationHomographyV1_2(training);
  const normalizationResidualPx = holdout.map((pair) => rounded(Math.hypot(
    projectFastCalibrationHomographyV1_2(homography, pair.source).x - pair.destination.x,
    projectFastCalibrationHomographyV1_2(homography, pair.source).y - pair.destination.y,
  )));
  const canonicalOuter = [
    { x: -0.5, y: -0.5 }, { x: columns - 0.5, y: -0.5 },
    { x: columns - 0.5, y: rows - 0.5 }, { x: -0.5, y: rows - 0.5 },
  ] as const;
  const undistortedOuter = canonicalOuter.map((point) => projectFastCalibrationHomographyV1_2(homography, point));
  const rawOuterCorners = undistortedOuter.map((point) => {
    const raw = distortFastCalibrationPixelV1_2(point, lensModel);
    return { x: rounded(raw.x), y: rounded(raw.y) };
  }) as unknown as FastCalibrationGeometrySolutionV1_2["rawOuterCorners"];
  const segmentationBoundaryResidualPx = result.segmentationBoundary.map((point) => {
    const undistorted = undistortFastCalibrationPixelV1_2(point, lensModel);
    return rounded(Math.min(...undistortedOuter.map((start, index) =>
      distanceToSegment(undistorted, start, undistortedOuter[(index + 1) % 4]!))));
  });
  return { normalizedToUndistortedHomography: homography, normalizationResidualPx,
    segmentationBoundaryResidualPx, rawOuterCorners };
}

function bilinear(data: Buffer, width: number, height: number, point: FastCalibrationPointV1_2): number {
  if (point.x < 0 || point.y < 0 || point.x > width - 1 || point.y > height - 1) {
    throw new Error("Normalized target ROI projects outside the exact sensor frame.");
  }
  const x0 = Math.floor(point.x);
  const y0 = Math.floor(point.y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = point.x - x0;
  const dy = point.y - y0;
  const sample = (x: number, y: number) => data[y * width + x]!;
  return sample(x0, y0) * (1 - dx) * (1 - dy) + sample(x1, y0) * dx * (1 - dy) +
    sample(x0, y1) * (1 - dx) * dy + sample(x1, y1) * dx * dy;
}

export async function decodeFastCalibrationNormalizedGridV1_2(
  bytes: Buffer,
  expected: { widthPx: number; heightPx: number },
  lensModel: FixedRigLensDistortionModelV1,
  homography: FastCalibrationHomographyV1_2,
): Promise<number[]> {
  const decoded = await sharp(bytes, { failOn: "error", unlimited: false }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (width !== expected.widthPx || height !== expected.heightPx || ![1, 3, 4].includes(channels) ||
      decoded.data.length !== width * height * channels) {
    throw new Error("Photometric evidence must decode as exact unnormalized single-channel 8-bit sensor samples.");
  }
  let sensorData = decoded.data;
  if (channels !== 1) {
    sensorData = Buffer.alloc(width * height);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * channels;
      const red = decoded.data[offset]!;
      const green = decoded.data[offset + 1]!;
      const blue = decoded.data[offset + 2]!;
      if (red !== green || red !== blue || (channels === 4 && decoded.data[offset + 3] !== 255)) {
        throw new Error("Encoded Mono8 evidence contains color conversion or non-opaque samples.");
      }
      sensorData[index] = red;
    }
  }
  const gridSize = FAST_CALIBRATION_NORMALIZED_GRID_SIZE_V1_2;
  const samplesPerCell = 8;
  const values: number[] = [];
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      let sum = 0;
      let count = 0;
      for (let sampleY = 0; sampleY < samplesPerCell; sampleY += 1) {
        for (let sampleX = 0; sampleX < samplesPerCell; sampleX += 1) {
          const u = (gridX + (sampleX + 0.5) / samplesPerCell) / gridSize;
          const v = (gridY + (sampleY + 0.5) / samplesPerCell) / gridSize;
          const canonical = { x: -0.5 + u * FAST_CALIBRATION_INTERNAL_COLUMNS_V1_2,
            y: -0.5 + v * FAST_CALIBRATION_INTERNAL_ROWS_V1_2 };
          const undistorted = projectFastCalibrationHomographyV1_2(homography, canonical);
          const raw = distortFastCalibrationPixelV1_2(undistorted, lensModel);
          sum += bilinear(sensorData, width, height, raw);
          count += 1;
        }
      }
      values.push(rounded(sum / count));
    }
  }
  return values;
}

export function transformFastCalibrationPhysicalDirectionV1_2(
  vector: FastCalibrationPointV1_2,
  matrix: readonly [number, number, number, number],
): FastCalibrationPointV1_2 {
  if (matrix.some((value) => !Number.isFinite(value))) throw new Error("Physical-to-normalized direction matrix is non-finite.");
  const transformed = { x: matrix[0] * vector.x + matrix[1] * vector.y,
    y: matrix[2] * vector.x + matrix[3] * vector.y };
  const magnitude = Math.hypot(transformed.x, transformed.y);
  if (!Number.isFinite(magnitude) || magnitude <= 0) throw new Error("Physical light direction transform is degenerate.");
  return { x: transformed.x / magnitude, y: transformed.y / magnitude };
}

export function composeFastCalibrationPhysicalToNormalizedDirectionV1_2(
  homography: FastCalibrationHomographyV1_2,
  stageToUndistortedSensor: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  if (stageToUndistortedSensor.some((value) => !Number.isFinite(value))) {
    throw new Error("Stage-to-undistorted-sensor direction authority is non-finite.");
  }
  const x = (FAST_CALIBRATION_INTERNAL_COLUMNS_V1_2 - 1) / 2;
  const y = (FAST_CALIBRATION_INTERNAL_ROWS_V1_2 - 1) / 2;
  const denominator = homography[6] * x + homography[7] * y + homography[8];
  const numeratorX = homography[0] * x + homography[1] * y + homography[2];
  const numeratorY = homography[3] * x + homography[4] * y + homography[5];
  const squared = denominator * denominator;
  const j00 = (homography[0] * denominator - numeratorX * homography[6]) / squared;
  const j01 = (homography[1] * denominator - numeratorX * homography[7]) / squared;
  const j10 = (homography[3] * denominator - numeratorY * homography[6]) / squared;
  const j11 = (homography[4] * denominator - numeratorY * homography[7]) / squared;
  const determinant = j00 * j11 - j01 * j10;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error("Normalized-target homography direction Jacobian is singular.");
  }
  const inverse = [j11 / determinant, -j01 / determinant, -j10 / determinant, j00 / determinant] as const;
  const composed = [
    (inverse[0] * stageToUndistortedSensor[0] + inverse[1] * stageToUndistortedSensor[2]) /
      FAST_CALIBRATION_INTERNAL_COLUMNS_V1_2,
    (inverse[0] * stageToUndistortedSensor[1] + inverse[1] * stageToUndistortedSensor[3]) /
      FAST_CALIBRATION_INTERNAL_COLUMNS_V1_2,
    (inverse[2] * stageToUndistortedSensor[0] + inverse[3] * stageToUndistortedSensor[2]) /
      FAST_CALIBRATION_INTERNAL_ROWS_V1_2,
    (inverse[2] * stageToUndistortedSensor[1] + inverse[3] * stageToUndistortedSensor[3]) /
      FAST_CALIBRATION_INTERNAL_ROWS_V1_2,
  ] as const;
  const composedDeterminant = composed[0] * composed[3] - composed[1] * composed[2];
  if (!Number.isFinite(composedDeterminant) || Math.abs(composedDeterminant) < 1e-12) {
    throw new Error("Physical direction cannot be transformed into normalized target coordinates.");
  }
  return composed.map(rounded) as unknown as readonly [number, number, number, number];
}

export function buildFastCalibrationAlgorithmManifestV1_2(input: {
  detectorScriptBytes: Buffer;
  detectorDependencyManifestBytes: Buffer;
  implementationModuleBytes: ReadonlyArray<{ fileName: string; bytes: Buffer }>;
  sharpVersions?: Record<string, string | undefined>;
}): FastCalibrationAlgorithmManifestV1_2 {
  if (input.implementationModuleBytes.length === 0) {
    throw new Error("Fast calibration algorithm identity requires the complete shipped executable module set.");
  }
  const implementationModules = input.implementationModuleBytes.map((artifact) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(artifact.fileName) ||
        !Buffer.isBuffer(artifact.bytes) || artifact.bytes.length === 0) {
      throw new Error("Fast calibration executable module identity is invalid.");
    }
    return { fileName: artifact.fileName, sha256: digest(artifact.bytes) };
  }).sort((left, right) => left.fileName.localeCompare(right.fileName));
  if (new Set(implementationModules.map((artifact) => artifact.fileName)).size !== implementationModules.length) {
    throw new Error("Fast calibration executable module identity contains duplicate file names.");
  }
  const implementationSha256 = digest(JSON.stringify(canonical({
    schemaVersion: "ten-kings-fast-calibration-executable-module-set-v1.2",
    modules: implementationModules,
  })));
  const dependency = canonical({ node: process.versions.node, sharp: input.sharpVersions ?? sharp.versions });
  const geometry = {
    implementationSha256,
    detectorScriptSha256: digest(input.detectorScriptBytes),
    detectorDependencyManifestSha256: digest(input.detectorDependencyManifestBytes),
    dependencySha256: digest(JSON.stringify(canonical({ runtime: dependency,
      detectorDependencyManifestSha256: digest(input.detectorDependencyManifestBytes) }))),
  };
  const photometric = {
    implementationSha256,
    dependencySha256: digest(JSON.stringify(dependency)),
  };
  return {
    schemaVersion: "ten-kings-fast-calibration-algorithm-manifest-v1.2",
    geometry: { ...geometry, manifestSha256: digest(JSON.stringify(canonical(geometry))) },
    photometric: { ...photometric, manifestSha256: digest(JSON.stringify(canonical(photometric))) },
  };
}
