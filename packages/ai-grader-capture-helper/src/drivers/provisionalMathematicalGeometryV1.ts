import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  BaslerCaptureStillResult,
  BaslerFixedRigSideBatchResult,
  BaslerFixedRigSideBatchRoleCapture,
} from "./baslerPylonClient";
import type { FixedRigWarmSideCaptureBatch } from "./baslerFixedRigV1";

const execFileAsync = promisify(execFile);
const SHA256_RE = /^[a-f0-9]{64}$/;
const ARTIFACT_SCHEMA = "ten-kings-provisional-mathematical-geometry-v1";
const PROCESSING_SCHEMA = "ten-kings-provisional-geometry-processing-v1" as const;

export interface ProvisionalMathematicalGeometryConfigV1 {
  artifactPath: string;
  artifactSha256: string;
}

interface ProvisionalArtifactV1 {
  schemaVersion: string;
  status: string;
  isCalibrated: boolean;
  image?: { widthPx?: number; heightPx?: number };
  leaveOnePoseOut?: { maxHoldoutRmsPx?: number };
  operatorAcceptance?: {
    acceptedMaximumHoldoutResidualPx?: number;
    certifiedV1MaximumHoldoutResidualPx?: number;
  };
  planarComparison?: { allIndependentViewsImproved?: boolean };
  source?: {
    rigId?: string;
    camera?: { modelName?: string; serialNumber?: string; exposureUs?: number; gain?: number };
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roles(batch: BaslerFixedRigSideBatchResult): BaslerFixedRigSideBatchRoleCapture[] {
  return [
    batch.captures.darkControl,
    batch.captures.allOn,
    batch.captures.acceptedProfile,
    ...batch.captures.channels,
  ];
}

function replaceRoles(
  batch: BaslerFixedRigSideBatchResult,
  replacements: Map<BaslerFixedRigSideBatchRoleCapture["role"], BaslerFixedRigSideBatchRoleCapture>,
): BaslerFixedRigSideBatchResult {
  const replacement = (role: BaslerFixedRigSideBatchRoleCapture) => replacements.get(role.role) ?? role;
  return {
    ...batch,
    captures: {
      darkControl: replacement(batch.captures.darkControl),
      allOn: replacement(batch.captures.allOn),
      acceptedProfile: replacement(batch.captures.acceptedProfile),
      channels: batch.captures.channels.map(replacement),
    },
    note: `${batch.note} Provisional geometry-only correction was applied to derived processing inputs; original sensor files remain preserved.`,
  };
}

async function correctedRole(input: {
  role: BaslerFixedRigSideBatchRoleCapture;
  artifactPath: string;
  artifactSha256: string;
  outputDir: string;
  applyScriptPath: string;
}): Promise<{ role: BaslerFixedRigSideBatchRoleCapture; sourceSha256: string; derivativeSha256: string }> {
  const sourcePath = await realpath(input.role.capture.outputFilePath);
  const outputPath = path.join(input.outputDir, `${path.parse(sourcePath).name}.png`);
  const { stdout } = await execFileAsync(
    "python",
    [
      input.applyScriptPath,
      input.artifactPath,
      sourcePath,
      outputPath,
      "--artifact-sha256",
      input.artifactSha256,
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout) as {
    isCalibrated?: boolean;
    sourceSha256?: string;
    outputSha256?: string;
    widthPx?: number;
    heightPx?: number;
  };
  if (
    result.isCalibrated !== false || result.sourceSha256 !== input.role.capture.sha256 ||
    !SHA256_RE.test(result.outputSha256 ?? "") || !Number.isInteger(result.widthPx) ||
    !Number.isInteger(result.heightPx)
  ) {
    throw new Error("Provisional geometry derivative identity was invalid; processing stopped.");
  }
  const outputStats = await stat(outputPath);
  const capture: BaslerCaptureStillResult = {
    ...input.role.capture,
    outputFilePath: outputPath,
    sha256: result.outputSha256!,
    byteSize: outputStats.size,
    mimeType: "image/png",
    imageWidth: result.widthPx!,
    imageHeight: result.heightPx!,
    savedImageFormat: "PNG",
    note: "Derived from the preserved sensor capture using the explicitly uncalibrated provisional geometry-only model.",
  };
  return {
    role: { ...input.role, capture },
    sourceSha256: result.sourceSha256!,
    derivativeSha256: result.outputSha256!,
  };
}

export async function applyProvisionalMathematicalGeometryV1(
  captureBatch: FixedRigWarmSideCaptureBatch,
  config: ProvisionalMathematicalGeometryConfigV1,
): Promise<FixedRigWarmSideCaptureBatch> {
  if (!path.isAbsolute(config.artifactPath) || !SHA256_RE.test(config.artifactSha256)) {
    throw new Error("Provisional geometry configuration requires an absolute artifact path and lowercase SHA-256.");
  }
  if (captureBatch.provisionalGeometryCorrection) {
    throw new Error("Provisional geometry correction cannot be applied more than once.");
  }
  const artifactPath = await realpath(config.artifactPath);
  const artifactBytes = await readFile(artifactPath);
  if (sha256(artifactBytes) !== config.artifactSha256) {
    throw new Error("Provisional geometry artifact SHA-256 mismatch; processing stopped.");
  }
  const artifact = JSON.parse(artifactBytes.toString("utf8")) as ProvisionalArtifactV1;
  const acceptedMaximum = artifact.operatorAcceptance?.acceptedMaximumHoldoutResidualPx;
  const observedMaximum = artifact.leaveOnePoseOut?.maxHoldoutRmsPx;
  if (
    artifact.schemaVersion !== ARTIFACT_SCHEMA || artifact.isCalibrated !== false ||
    artifact.status !== "provisional_geometry_only_operator_accepted_for_controlled_evaluation" ||
    artifact.planarComparison?.allIndependentViewsImproved !== true ||
    !finite(acceptedMaximum) || acceptedMaximum <= 0 || acceptedMaximum > 3 ||
    !finite(observedMaximum) || observedMaximum > acceptedMaximum ||
    artifact.operatorAcceptance?.certifiedV1MaximumHoldoutResidualPx !== 0.5
  ) {
    throw new Error("Provisional geometry artifact did not satisfy the controlled-evaluation contract.");
  }
  const originalRoles = roles(captureBatch.batch);
  const expectedWidth = artifact.image?.widthPx;
  const expectedHeight = artifact.image?.heightPx;
  const expectedCamera = artifact.source?.camera;
  for (const role of originalRoles) {
    const camera = role.capture.camera as unknown as { modelName?: string; serialNumber?: string };
    if (
      role.capture.imageWidth !== expectedWidth || role.capture.imageHeight !== expectedHeight ||
      camera.modelName !== expectedCamera?.modelName || camera.serialNumber !== expectedCamera?.serialNumber ||
      role.capture.exposureTime !== expectedCamera?.exposureUs || role.capture.gain !== expectedCamera?.gain
    ) {
      throw new Error("Live capture identity does not match the provisional geometry artifact; processing stopped.");
    }
  }
  const outputDir = path.join(captureBatch.sideDir, "provisional-geometry");
  const applyScriptPath = path.resolve(
    __dirname,
    "../../../..",
    "scripts/ai-grader/apply-provisional-mathematical-geometry-v1.py",
  );
  const corrected = [] as Awaited<ReturnType<typeof correctedRole>>[];
  for (let index = 0; index < originalRoles.length; index += 3) {
    corrected.push(...await Promise.all(originalRoles.slice(index, index + 3).map((role) => correctedRole({
      role,
      artifactPath,
      artifactSha256: config.artifactSha256,
      outputDir,
      applyScriptPath,
    }))));
  }
  const replacements = new Map(corrected.map((entry) => [entry.role.role, entry.role]));
  return {
    ...captureBatch,
    batch: replaceRoles(captureBatch.batch, replacements),
    provisionalGeometryCorrection: {
      schemaVersion: PROCESSING_SCHEMA,
      status: "operator_accepted_geometry_only_controlled_evaluation",
      isCalibrated: false,
      artifactSha256: config.artifactSha256,
      acceptedMaximumHoldoutResidualPx: acceptedMaximum,
      observedMaximumHoldoutResidualPx: observedMaximum,
      originalBatch: captureBatch.batch,
      derivatives: corrected.map((entry) => ({
        role: entry.role.role,
        sourceSha256: entry.sourceSha256,
        derivativeSha256: entry.derivativeSha256,
      })),
      limitations: [
        "Geometry-only controlled evaluation; not accepted Mathematical V1 or V1.1 calibration.",
        "No validated photometric, color, segmentation, metrology, or repeatability correction is claimed.",
        "isCalibrated remains false and current Production normalization remains the rollback path.",
      ],
    },
  };
}
