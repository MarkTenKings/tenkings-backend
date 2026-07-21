import crypto from "node:crypto";
import sharp from "sharp";
import {
  detectMathematicalCalibrationPreviewCheckerboard,
  type MathematicalCalibrationPreviewCheckerboard,
} from "./mathematicalCalibrationPreviewCheckerboard";
import type {
  FastCalibrationPoseV1_2,
  FastCalibrationRuntimeContextV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";
import type { FastCalibrationSourceArtifactV1_2 } from "./fixedRigFastMathematicalCalibrationBundleV1_2";

export const FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2 =
  "opencv-11x16-capture-still-local-neighborhood-residual-v1.2" as const;
export const FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2 =
  "sharp-linear-8x8-dark-flat-illumination-grid-v1.2" as const;

const digestText = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const digestBytes = (value: Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");

export const FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256 =
  digestText(FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2);
export const FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256 =
  digestText(FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2);
export const FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2 = 8 as const;

export interface FastCalibrationDerivedPoseEvidenceV1_2 {
  sourceFrameSha256: string;
  pose: FastCalibrationPoseV1_2;
  normalizationResidualPx: number[];
  segmentationBoundaryResidualPx: number[];
}

export interface FastCalibrationDecodedChannelEvidenceV1_2 {
  channelIndex: number;
  darkControlGrids: number[][];
  flatFieldGrids: number[][];
  illuminationPatternGrids: number[][];
}

export interface FastCalibrationEvidenceAnalysisResultV1_2 {
  geometryAlgorithmSha256: string;
  photometricAlgorithmSha256: string;
  gridWidth: typeof FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2;
  gridHeight: typeof FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2;
  poses: FastCalibrationDerivedPoseEvidenceV1_2[];
  channels: FastCalibrationDecodedChannelEvidenceV1_2[];
}

export interface FastCalibrationEvidenceAnalysisInputV1_2 {
  runtimeContext: FastCalibrationRuntimeContextV1_2;
  activeSourceArtifactLedger: FastCalibrationSourceArtifactV1_2[];
  readFrame(entry: FastCalibrationSourceArtifactV1_2): Promise<Buffer>;
}

export interface FastCalibrationEvidenceAnalyzerV1_2 {
  readonly geometryAlgorithmSha256: string;
  readonly photometricAlgorithmSha256: string;
  derivePose(bytes: Buffer, context: FastCalibrationRuntimeContextV1_2): Promise<FastCalibrationDerivedPoseEvidenceV1_2>;
  analyze(input: FastCalibrationEvidenceAnalysisInputV1_2): Promise<FastCalibrationEvidenceAnalysisResultV1_2>;
}

export interface FixedRigFastCalibrationEvidenceAnalyzerV1_2Config {
  detectCheckerboard?: (bytes: Buffer) => Promise<MathematicalCalibrationPreviewCheckerboard>;
}

function rounded(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Fast calibration evidence analyzer produced a non-finite value.");
  return Number(value.toFixed(9));
}

function polygonArea(points: readonly { x: number; y: number }[]): number {
  return Math.abs(points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return total + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function localCheckerboardResiduals(result: MathematicalCalibrationPreviewCheckerboard): number[] {
  const rows = 16;
  const columns = 11;
  if (result.internalCorners.length !== rows * columns) {
    throw new Error("Fast calibration checkerboard must contain the exact 11x16 internal-corner grid.");
  }
  const values: number[] = [];
  for (let row = 1; row < rows - 1; row += 1) {
    for (let column = 1; column < columns - 1; column += 1) {
      const current = result.internalCorners[row * columns + column]!;
      const left = result.internalCorners[row * columns + column - 1]!;
      const right = result.internalCorners[row * columns + column + 1]!;
      const above = result.internalCorners[(row - 1) * columns + column]!;
      const below = result.internalCorners[(row + 1) * columns + column]!;
      const predictedX = (left.x + right.x + above.x + below.x) / 4;
      const predictedY = (left.y + right.y + above.y + below.y) / 4;
      values.push(rounded(Math.hypot(current.x - predictedX, current.y - predictedY)));
    }
  }
  if (values.length < 10) throw new Error("Fast calibration checkerboard residual evidence is incomplete.");
  return values;
}

function poseFromDetection(
  result: MathematicalCalibrationPreviewCheckerboard,
  sourceFrameSha256: string,
  context: FastCalibrationRuntimeContextV1_2,
): FastCalibrationDerivedPoseEvidenceV1_2 {
  if (result.imageWidth !== context.camera.widthPx || result.imageHeight !== context.camera.heightPx) {
    throw new Error("Capture-time checkerboard dimensions differ from the protected camera resolution.");
  }
  const corners = result.outerCorners.map((point) => ({ x: rounded(point.x), y: rounded(point.y) })) as unknown as FastCalibrationPoseV1_2["outerCorners"];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const centerXFraction = corners.reduce((sum, point) => sum + point.x, 0) / corners.length / result.imageWidth;
  const centerYFraction = corners.reduce((sum, point) => sum + point.y, 0) / corners.length / result.imageHeight;
  const safetyMarginFraction = Math.min(
    Math.min(...xs) / result.imageWidth,
    (result.imageWidth - Math.max(...xs)) / result.imageWidth,
    Math.min(...ys) / result.imageHeight,
    (result.imageHeight - Math.max(...ys)) / result.imageHeight,
  );
  const residuals = localCheckerboardResiduals(result);
  const reprojectionResidual = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length,
  );
  return {
    sourceFrameSha256,
    pose: {
      sourceFrameSha256,
      centerXFraction: rounded(centerXFraction),
      centerYFraction: rounded(centerYFraction),
      coverageFraction: rounded(polygonArea(corners) / (result.imageWidth * result.imageHeight)),
      rotationDegrees: rounded(result.rotationDegrees),
      safetyMarginFraction: rounded(safetyMarginFraction),
      authorityReprojectionResidualPx: rounded(reprojectionResidual),
      outerCorners: corners,
    },
    normalizationResidualPx: residuals,
    segmentationBoundaryResidualPx: [...residuals],
  };
}

async function decodeGrid(
  bytes: Buffer,
  context: FastCalibrationRuntimeContextV1_2,
): Promise<number[]> {
  const decoded = await sharp(bytes, { failOn: "error" })
    .greyscale()
    .raw({ depth: "float" })
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (width !== context.camera.widthPx || height !== context.camera.heightPx || channels !== 1) {
    throw new Error("Photometric checkpoint dimensions differ from the protected monochrome camera resolution.");
  }
  if (decoded.data.byteLength !== width * height * 4) {
    throw new Error("Photometric checkpoint did not decode to one exact float sample per pixel.");
  }
  const gridSize = FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2;
  const sums = Array<number>(gridSize * gridSize).fill(0);
  const counts = Array<number>(gridSize * gridSize).fill(0);
  for (let y = 0; y < height; y += 1) {
    const gridY = Math.min(gridSize - 1, Math.floor(y * gridSize / height));
    for (let x = 0; x < width; x += 1) {
      const gridX = Math.min(gridSize - 1, Math.floor(x * gridSize / width));
      const value = decoded.data.readFloatLE((y * width + x) * 4);
      if (!Number.isFinite(value) || value < 0) throw new Error("Photometric checkpoint contains invalid decoded intensity.");
      const index = gridY * gridSize + gridX;
      sums[index] += value;
      counts[index] += 1;
    }
  }
  return sums.map((sum, index) => rounded(sum / counts[index]!));
}

function activeExact(
  ledger: FastCalibrationSourceArtifactV1_2[],
  role: FastCalibrationSourceArtifactV1_2["role"],
  channelIndex: number | null,
  sampleIndex: number,
): FastCalibrationSourceArtifactV1_2 {
  const matching = ledger.filter((entry) => entry.active && entry.role === role &&
    entry.channelIndex === channelIndex && entry.sampleIndex === sampleIndex);
  if (matching.length !== 1) throw new Error(`Exact active ${role} evidence is missing or duplicated.`);
  return matching[0]!;
}

export class FixedRigFastCalibrationEvidenceAnalyzerV1_2 implements FastCalibrationEvidenceAnalyzerV1_2 {
  readonly geometryAlgorithmSha256 = FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256;
  readonly photometricAlgorithmSha256 = FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256;
  private readonly detectCheckerboard: (bytes: Buffer) => Promise<MathematicalCalibrationPreviewCheckerboard>;

  constructor(config: FixedRigFastCalibrationEvidenceAnalyzerV1_2Config = {}) {
    this.detectCheckerboard = config.detectCheckerboard ?? detectMathematicalCalibrationPreviewCheckerboard;
  }

  async derivePose(bytes: Buffer, context: FastCalibrationRuntimeContextV1_2): Promise<FastCalibrationDerivedPoseEvidenceV1_2> {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("Checkerboard checkpoint bytes are empty.");
    const sourceFrameSha256 = digestBytes(bytes);
    return poseFromDetection(await this.detectCheckerboard(bytes), sourceFrameSha256, context);
  }

  async analyze(input: FastCalibrationEvidenceAnalysisInputV1_2): Promise<FastCalibrationEvidenceAnalysisResultV1_2> {
    const ledger = input.activeSourceArtifactLedger.filter((entry) => entry.active);
    const poses: FastCalibrationDerivedPoseEvidenceV1_2[] = [];
    for (let slot = 1; slot <= 4; slot += 1) {
      const source = activeExact(ledger, "checkerboard_placement", null, slot);
      const bytes = await input.readFrame(source);
      if (digestBytes(bytes) !== source.sha256) throw new Error("Checkerboard checkpoint bytes do not match the active source ledger.");
      poses.push(await this.derivePose(bytes, input.runtimeContext));
    }
    const channels: FastCalibrationDecodedChannelEvidenceV1_2[] = [];
    for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
      const decoded: FastCalibrationDecodedChannelEvidenceV1_2 = {
        channelIndex,
        darkControlGrids: [],
        flatFieldGrids: [],
        illuminationPatternGrids: [],
      };
      for (const [role, destination] of [
        ["dark_control", decoded.darkControlGrids],
        ["flat_field", decoded.flatFieldGrids],
        ["illumination_pattern", decoded.illuminationPatternGrids],
      ] as const) {
        for (let sampleIndex = 1; sampleIndex <= 3; sampleIndex += 1) {
          const source = activeExact(ledger, role, channelIndex, sampleIndex);
          const bytes = await input.readFrame(source);
          if (digestBytes(bytes) !== source.sha256) throw new Error("Photometric checkpoint bytes do not match the active source ledger.");
          destination.push(await decodeGrid(bytes, input.runtimeContext));
        }
      }
      channels.push(decoded);
    }
    return {
      geometryAlgorithmSha256: this.geometryAlgorithmSha256,
      photometricAlgorithmSha256: this.photometricAlgorithmSha256,
      gridWidth: FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2,
      gridHeight: FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2,
      poses,
      channels,
    };
  }
}
