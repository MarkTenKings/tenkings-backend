import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectMathematicalCalibrationPreviewCheckerboard,
  type MathematicalCalibrationPreviewCheckerboard,
} from "./mathematicalCalibrationPreviewCheckerboard";
import type {
  FastCalibrationPoseV1_2,
  FastCalibrationRuntimeContextV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";
import type { FastCalibrationSourceArtifactV1_2 } from "./fixedRigFastMathematicalCalibrationBundleV1_2";
import type { FixedRigLensDistortionModelV1 } from "./fixedRigPhysicalCalibrationV1";
import {
  FAST_CALIBRATION_NORMALIZED_GRID_SIZE_V1_2,
  buildFastCalibrationAlgorithmManifestV1_2,
  composeFastCalibrationPhysicalToNormalizedDirectionV1_2,
  decodeFastCalibrationNormalizedGridV1_2,
  deriveFastCalibrationGeometryV1_2,
  type FastCalibrationAlgorithmManifestV1_2,
  type FastCalibrationHomographyV1_2,
} from "./fixedRigFastCalibrationMathV1_2";

export const FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2 =
  "brown-conrady-heldout-homography-independent-boundary-v1.2" as const;
export const FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2 =
  "raw-mono8-undistort-normalized-target-roi-8x8-v1.2" as const;

const digestBytes = (value: Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const detectorScriptPath = path.resolve(__dirname, "../../../../scripts/ai-grader/detect-mathematical-calibration-preview-checkerboard.py");
const detectorDependencyManifestPath = path.resolve(__dirname, "../../../../scripts/ai-grader/requirements-mathematical-calibration-v1.txt");
const implementationModulePaths = [
  require.resolve("./fixedRigFastCalibrationMathV1_2"),
  __filename,
  require.resolve("./fixedRigFastCalibrationEvidenceAnalyzerV1_2"),
  require.resolve("./fixedRigFastMathematicalCalibrationV1_2"),
  require.resolve("./fixedRigFastMathematicalCalibrationBundleV1_2"),
];
const uniqueImplementationModulePaths = [...new Set(implementationModulePaths)].sort();
export const FIXED_RIG_FAST_CALIBRATION_ALGORITHM_MANIFEST_V1_2: FastCalibrationAlgorithmManifestV1_2 =
  buildFastCalibrationAlgorithmManifestV1_2({
    detectorScriptBytes: readFileSync(detectorScriptPath),
    detectorDependencyManifestBytes: readFileSync(detectorDependencyManifestPath),
    implementationModuleBytes: uniqueImplementationModulePaths.map((modulePath) => ({
      fileName: path.basename(modulePath),
      bytes: readFileSync(modulePath),
    })),
  });

export const FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256 =
  FIXED_RIG_FAST_CALIBRATION_ALGORITHM_MANIFEST_V1_2.geometry.manifestSha256;
export const FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256 =
  FIXED_RIG_FAST_CALIBRATION_ALGORITHM_MANIFEST_V1_2.photometric.manifestSha256;
export const FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_GRID_SIZE_V1_2 = FAST_CALIBRATION_NORMALIZED_GRID_SIZE_V1_2;

export interface FastCalibrationEvidenceGeometryAuthorityV1_2 {
  lensModel: FixedRigLensDistortionModelV1;
  stageToUndistortedSensorMatrix: readonly [number, number, number, number];
}

export interface FastCalibrationDerivedPoseEvidenceV1_2 {
  sourceFrameSha256: string;
  pose: FastCalibrationPoseV1_2;
  normalizationResidualPx: number[];
  segmentationBoundaryResidualPx: number[];
  normalizedToUndistortedHomography: FastCalibrationHomographyV1_2;
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
  physicalToNormalizedDirectionMatrix: readonly [number, number, number, number];
  poses: FastCalibrationDerivedPoseEvidenceV1_2[];
  channels: FastCalibrationDecodedChannelEvidenceV1_2[];
}

export interface FastCalibrationEvidenceAnalysisInputV1_2 {
  runtimeContext: FastCalibrationRuntimeContextV1_2;
  geometryAuthority: FastCalibrationEvidenceGeometryAuthorityV1_2;
  activeSourceArtifactLedger: FastCalibrationSourceArtifactV1_2[];
  readFrame(entry: FastCalibrationSourceArtifactV1_2): Promise<Buffer>;
}

export interface FastCalibrationEvidenceAnalyzerV1_2 {
  readonly geometryAlgorithmSha256: string;
  readonly photometricAlgorithmSha256: string;
  derivePose(
    bytes: Buffer,
    context: FastCalibrationRuntimeContextV1_2,
    authority: FastCalibrationEvidenceGeometryAuthorityV1_2,
  ): Promise<FastCalibrationDerivedPoseEvidenceV1_2>;
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

function poseFromDetection(
  result: MathematicalCalibrationPreviewCheckerboard,
  sourceFrameSha256: string,
  context: FastCalibrationRuntimeContextV1_2,
  authority: FastCalibrationEvidenceGeometryAuthorityV1_2,
): FastCalibrationDerivedPoseEvidenceV1_2 {
  if (result.imageWidth !== context.camera.widthPx || result.imageHeight !== context.camera.heightPx) {
    throw new Error("Capture-time checkerboard dimensions differ from the protected camera resolution.");
  }
  const geometry = deriveFastCalibrationGeometryV1_2(result, authority.lensModel);
  const corners = geometry.rawOuterCorners as FastCalibrationPoseV1_2["outerCorners"];
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
  const reprojectionResidual = Math.sqrt(
    geometry.normalizationResidualPx.reduce((sum, value) => sum + value * value, 0) /
    geometry.normalizationResidualPx.length,
  );
  const rotationDegrees = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI;
  return {
    sourceFrameSha256,
    pose: {
      sourceFrameSha256,
      centerXFraction: rounded(centerXFraction),
      centerYFraction: rounded(centerYFraction),
      coverageFraction: rounded(polygonArea(corners) / (result.imageWidth * result.imageHeight)),
      rotationDegrees: rounded(rotationDegrees),
      safetyMarginFraction: rounded(safetyMarginFraction),
      authorityReprojectionResidualPx: rounded(reprojectionResidual),
      outerCorners: corners,
    },
    normalizationResidualPx: geometry.normalizationResidualPx,
    segmentationBoundaryResidualPx: geometry.segmentationBoundaryResidualPx,
    normalizedToUndistortedHomography: geometry.normalizedToUndistortedHomography,
  };
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

  async derivePose(
    bytes: Buffer,
    context: FastCalibrationRuntimeContextV1_2,
    authority: FastCalibrationEvidenceGeometryAuthorityV1_2,
  ): Promise<FastCalibrationDerivedPoseEvidenceV1_2> {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("Checkerboard checkpoint bytes are empty.");
    const sourceFrameSha256 = digestBytes(bytes);
    return poseFromDetection(await this.detectCheckerboard(bytes), sourceFrameSha256, context, authority);
  }

  async analyze(input: FastCalibrationEvidenceAnalysisInputV1_2): Promise<FastCalibrationEvidenceAnalysisResultV1_2> {
    const ledger = input.activeSourceArtifactLedger.filter((entry) => entry.active);
    const poses: FastCalibrationDerivedPoseEvidenceV1_2[] = [];
    for (let slot = 1; slot <= 4; slot += 1) {
      const source = activeExact(ledger, "checkerboard_placement", null, slot);
      const bytes = await input.readFrame(source);
      if (digestBytes(bytes) !== source.sha256) throw new Error("Checkerboard checkpoint bytes do not match the active source ledger.");
      poses.push(await this.derivePose(bytes, input.runtimeContext, input.geometryAuthority));
    }
    const photometricTransform = poses[3]?.normalizedToUndistortedHomography;
    if (!photometricTransform) throw new Error("Photometric normalization requires the exact fourth accepted pose transform.");
    const physicalToNormalizedDirectionMatrix = composeFastCalibrationPhysicalToNormalizedDirectionV1_2(
      photometricTransform,
      input.geometryAuthority.stageToUndistortedSensorMatrix,
    );
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
          destination.push(await decodeFastCalibrationNormalizedGridV1_2(
            bytes,
            { widthPx: input.runtimeContext.camera.widthPx, heightPx: input.runtimeContext.camera.heightPx },
            input.geometryAuthority.lensModel,
            photometricTransform,
          ));
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
      physicalToNormalizedDirectionMatrix,
      channels,
    };
  }
}
