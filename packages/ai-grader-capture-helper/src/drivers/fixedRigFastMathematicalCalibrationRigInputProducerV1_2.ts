import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} from "@tenkings/shared";
import type { BaslerMathematicalCalibrationLiveContextV1_2 } from "./baslerLeimacMathematicalCalibrationSessionV1_2";
import {
  FAST_CALIBRATION_RIG_MATERIALIZATION_INPUT_SCHEMA_V1_2,
  type FastCalibrationCanonicalDirectionFrameEvidenceV1_2,
  type FastCalibrationEvidenceDerivedComponentAuthorityV1_2,
  type FastCalibrationEvidenceDerivedLensAuthorityV1_2,
  type FastCalibrationEvidenceDerivedWiringAuthorityV1_2,
  type FastCalibrationProtectedLiveProbeEvidenceV1_2,
  type FastCalibrationRigMaterializationInputManifestV1_2,
} from "./fixedRigFastMathematicalCalibrationRigMaterializerV1_2";

const CAPTURE_MANIFEST_SCHEMA = "ten-kings-mathematical-calibration-capture-manifest-v1";
const CAPTURE_PACKAGE_SCHEMA = "ten-kings-mathematical-calibration-capture-package-v1";
const CAPTURE_PROFILE = "ten-kings-fixed-rig-mathematical-calibration-v1";
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

type JsonObject = Record<string, unknown>;
type Artifact = JsonObject & {
  evidenceId: string;
  path: string;
  sha256: string;
  role: string;
  artifactClass: string;
  channelIndex: number | null;
  bytes: Buffer;
};

export interface ProduceFastCalibrationRigMaterializationInputV1_2Input {
  captureManifestPath: string;
  captureManifestSha256: string;
  liveContext: BaslerMathematicalCalibrationLiveContextV1_2;
  observedAt: string;
}

export interface ProducedFastCalibrationRigMaterializationInputV1_2 {
  inputManifestPath: string;
  inputManifestSha256: string;
  liveProbeSha256: string;
  componentAuthoritySha256: string;
  directionFrameAuthoritySha256: string;
  lensAuthoritySha256: string;
  wiringAuthoritySha256: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function hash(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function operationalId(prefix: string, value: unknown): string {
  return `tk-${prefix}-${hash(canonicalBytes(value))}`;
}

function exactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new Error(`${label} must be one exact safe identifier.`);
  return value;
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be one exact lowercase SHA-256.`);
  return value;
}

function parseCanonical(bytes: Buffer, label: string): JsonObject {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label} is not valid JSON.`); }
  if (!bytes.equals(canonicalBytes(value))) throw new Error(`${label} must use exact canonical JSON bytes.`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be one object.`);
  return value as JsonObject;
}

function contained(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Rig input producer encountered an unsafe evidence path.");
  }
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, ...relative.split("/"));
  if (!resolved.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error("Rig input producer evidence escaped its protected session root.");
  return resolved;
}

async function exactArtifact(root: string, candidate: unknown): Promise<Artifact> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Capture package contains a malformed artifact entry.");
  const artifact = candidate as Omit<Artifact, "bytes">;
  exactId(artifact.evidenceId, "capture evidenceId"); exactId(artifact.role, "capture role"); exactSha(artifact.sha256, "capture sha256");
  if (typeof artifact.path !== "string") throw new Error("Capture artifact path is missing.");
  const bytes = await readFile(contained(root, artifact.path));
  if (hash(bytes) !== artifact.sha256 || artifact.byteSize !== bytes.length) throw new Error(`Capture artifact ${artifact.evidenceId} differs from its immutable ledger.`);
  return { ...(artifact as object), bytes } as Artifact;
}

function reference(artifact: Artifact): { evidenceId: string; sha256: string } {
  return { evidenceId: artifact.evidenceId, sha256: artifact.sha256 };
}

async function writeExact(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try { await writeFile(filePath, bytes, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!(await readFile(filePath)).equals(bytes)) throw new Error("Existing rig materialization input evidence conflicts with exact derived bytes.");
  }
}

export async function produceFastCalibrationRigMaterializationInputV1_2(
  input: ProduceFastCalibrationRigMaterializationInputV1_2Input,
): Promise<ProducedFastCalibrationRigMaterializationInputV1_2> {
  if (!path.isAbsolute(input.captureManifestPath)) throw new Error("Capture manifest path must be protected and absolute.");
  exactSha(input.captureManifestSha256, "capture manifest sha256");
  if (new Date(input.observedAt).toISOString() !== input.observedAt) throw new Error("Live probe observation time must be exact UTC.");
  const root = path.dirname(input.captureManifestPath);
  const captureManifestBytes = await readFile(input.captureManifestPath);
  if (hash(captureManifestBytes) !== input.captureManifestSha256) throw new Error("Capture manifest differs from its exact SHA-256.");
  const captureManifest = parseCanonical(captureManifestBytes, "capture manifest");
  if (captureManifest.schemaVersion !== CAPTURE_MANIFEST_SCHEMA || captureManifest.captureProfileVersion !== CAPTURE_PROFILE) {
    throw new Error("Rig input producer accepts only exact sealed V1.0.1 capture authority.");
  }
  const packageReference = captureManifest.sourceCapturePackage as JsonObject;
  if (!packageReference || typeof packageReference.path !== "string") throw new Error("Capture manifest lacks its exact source package binding.");
  const packageBytes = await readFile(contained(root, packageReference.path));
  if (hash(packageBytes) !== exactSha(packageReference.sha256, "capture package sha256")) throw new Error("Capture package differs from its manifest binding.");
  const capturePackage = parseCanonical(packageBytes, "capture package");
  if (capturePackage.schemaVersion !== CAPTURE_PACKAGE_SCHEMA || capturePackage.captureProfileVersion !== CAPTURE_PROFILE ||
      capturePackage.purpose !== "mathematical_calibration_v1" ||
      capturePackage.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      capturePackage.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH) {
    throw new Error("Rig input producer rejects non-V1.0.1, converted, or wrong-threshold capture packages.");
  }
  const uncertaintyAuthority = capturePackage.evidenceDerivedAuthority as JsonObject;
  if (!uncertaintyAuthority || Object.keys(uncertaintyAuthority).sort().join(",") !==
      ["thresholdSetId", "thresholdSetHash", "uncertaintyCoverageFactor"].sort().join(",") ||
      uncertaintyAuthority.thresholdSetId !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID ||
      uncertaintyAuthority.thresholdSetHash !== MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH ||
      uncertaintyAuthority.uncertaintyCoverageFactor !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor) {
    throw new Error("Rig input producer requires the exact centralized evidence-derived uncertainty authority.");
  }
  const station = capturePackage.stationAuthority as JsonObject;
  const settings = station?.protectedSettings as JsonObject;
  const subject = capturePackage.subject as JsonObject;
  if (!station || station.noProductionMutation !== true || !settings || !subject || subject.designation !== "calibration_target" || subject.productionCard !== false) {
    throw new Error("Capture package lacks protected non-production station and target authority.");
  }
  const stationId = exactId(settings.stationId, "stationId");
  const rigId = exactId(settings.rigId, "rigId");
  const targetVersion = exactId(subject.targetVersion, "targetVersion");
  const targetSha256 = exactSha(subject.targetSha256, "targetSha256");
  const finalizedAt = String(station.finalizedAt ?? "");
  if (new Date(finalizedAt).toISOString() !== finalizedAt) throw new Error("Capture package finalizedAt is invalid.");
  const live = input.liveContext;
  [live.camera.serialNumber, live.camera.modelName, live.camera.pixelFormat, live.controller.identity]
    .forEach((entry, index) => exactId(entry, `live context identity ${index}`));
  if (settings.exposureUs !== live.camera.exposureUs || settings.gain !== live.camera.gain || settings.leimacUnit !== live.controller.unit ||
      !Number.isInteger(live.camera.widthPx) || !Number.isInteger(live.camera.heightPx) ||
      !Array.isArray(live.controller.responseKinds) || live.controller.responseKinds.length === 0 ||
      live.controller.responseKinds.some((kind) => kind !== "ack")) {
    throw new Error("Protected live context does not match the sealed capture settings.");
  }
  if (!Array.isArray(capturePackage.artifacts) || capturePackage.artifacts.length !== 283) throw new Error("Rig input producer requires the exact 283-artifact sealed ledger.");
  const artifacts = await Promise.all(capturePackage.artifacts.map((candidate) => exactArtifact(root, candidate)));
  if (new Set(artifacts.map((artifact) => artifact.evidenceId)).size !== artifacts.length || new Set(artifacts.map((artifact) => artifact.sha256)).size !== artifacts.length) {
    throw new Error("Rig input producer rejects duplicate or relabelled capture evidence.");
  }
  const classCounts = new Map<string, number>();
  artifacts.forEach((artifact) => classCounts.set(artifact.artifactClass, (classCounts.get(artifact.artifactClass) ?? 0) + 1));
  if (classCounts.get("raw_capture") !== 102 || classCounts.get("normalized_derivative") !== 102 ||
      classCounts.get("measurement") !== 78 || classCounts.get("target") !== 1 ||
      artifacts.find((artifact) => artifact.artifactClass === "target" && artifact.sha256 === targetSha256 && artifact.role === "print_verified_calibration_target") === undefined) {
    throw new Error("Rig input producer requires exact 102 raw, 102 normalized, 78 measurement, and one protected-target artifacts.");
  }
  const analyzerPath = path.resolve(__dirname, "../../../../scripts/ai-grader/analyze-mathematical-calibration-v1.py");
  const physicalAnalyzerSha256 = hash(await readFile(analyzerPath));
  const exactRole = (role: string) => artifacts.filter((artifact) => artifact.role === role);
  const lensGeometry = artifacts.filter((artifact) => artifact.role === "lens_geometry" || artifact.role === "lens_geometry_normalized");
  const normalization = artifacts.filter((artifact) => artifact.role === "normalization_registration" || artifact.role === "normalization_registration_normalized");
  if (lensGeometry.length !== 20 || normalization.length !== 20) throw new Error("Rig input producer lacks exact ten-pose lens and normalization evidence.");
  const lensAuthority: FastCalibrationEvidenceDerivedLensAuthorityV1_2 = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-evidence-derived-lens-authority-v1",
    authorityMethod: "exact_capture_and_analyzer_binding_v1", rigId,
    cameraSerialNumber: live.camera.serialNumber, cameraModelName: live.camera.modelName,
    targetVersion, targetSha256, sourceCaptureManifestSha256: input.captureManifestSha256, physicalAnalyzerSha256,
    lensGeometryEvidence: lensGeometry.map(reference), normalizationRegistrationEvidence: normalization.map(reference),
  };
  const wiringChannels: FastCalibrationEvidenceDerivedWiringAuthorityV1_2["channels"] = [];
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    const roles = new Set([`flat_field_channel_${channelIndex}_raw`, `illumination_pattern_channel_${channelIndex}_raw`]);
    const responses = artifacts.filter((artifact) => roles.has(artifact.role));
    if (responses.length !== 6) throw new Error(`Channel ${channelIndex} lacks exact three-per-role response evidence.`);
    for (const response of responses) {
      const leimac = response.leimac as JsonObject;
      const safeOff = response.safeOff as JsonObject;
      if (response.artifactClass !== "raw_capture" || response.channelIndex !== channelIndex || !leimac ||
          leimac.unit !== live.controller.unit || leimac.complete !== true || !Array.isArray(leimac.enabledChannels) ||
          leimac.enabledChannels.length !== 1 || leimac.enabledChannels[0] !== channelIndex ||
          leimac.expectedWriteCount !== leimac.acknowledgedWriteCount || !Array.isArray(leimac.responseKinds) ||
          (leimac.responseKinds as unknown[]).some((kind) => kind !== "ack") || !safeOff ||
          safeOff.beforeCaptureConfirmed !== true || safeOff.afterCaptureConfirmed !== true) {
        throw new Error(`Channel ${channelIndex} response evidence lacks exact output, acknowledgement, or safe-off authority.`);
      }
    }
    wiringChannels.push({
      channelIndex, controllerOutput: `leimac-unit-${live.controller.unit}-output-${channelIndex}`,
      responseEvidence: responses.map((artifact) => ({ evidenceId: artifact.evidenceId, role: artifact.role, sha256: artifact.sha256 })),
    });
  }
  const wiringAuthority: FastCalibrationEvidenceDerivedWiringAuthorityV1_2 = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-evidence-derived-wiring-authority-v1",
    authorityMethod: "observed_leimac_acknowledged_response_v1", rigId,
    controllerIdentity: live.controller.identity, controllerUnit: live.controller.unit, channels: wiringChannels,
  };
  const directionChannels: FastCalibrationCanonicalDirectionFrameEvidenceV1_2["channels"] = [];
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    const measurements = exactRole(`direction_geometry_channel_${channelIndex}`);
    if (measurements.length !== 3) throw new Error(`Channel ${channelIndex} lacks exact three-per-channel direction measurements.`);
    const directionMeasurementEvidence = measurements.map((artifact, sampleIndex) => {
      const measurement = parseCanonical(artifact.bytes, "direction measurement");
      const instrument = measurement.instrument as JsonObject;
      const sourceEvidenceId = exactId(measurement.sourceEvidenceId, "direction sourceEvidenceId");
      const sourceSha256 = exactSha(measurement.sourceSha256, "direction sourceSha256");
      const source = artifacts.find((candidate) => candidate.evidenceId === sourceEvidenceId);
      if (measurement.schemaVersion !== "ten-kings-calibration-direction-measurement-v1" ||
          measurement.measurementMethod !== "illumination_centroid_checkerboard_repeatability_v1" ||
          measurement.measurementAlgorithmVersion !== "opencv_illumination_centroid_checkerboard_v1" ||
          measurement.channelIndex !== channelIndex || measurement.sampleIndex !== sampleIndex + 1 ||
          !instrument || instrument.kind !== "fixed_rig_geometry" || instrument.calibrationSha256 !== physicalAnalyzerSha256 ||
          !source || source.sha256 !== sourceSha256 || source.role !== `illumination_pattern_channel_${channelIndex}` ||
          measurement.sourceCaptureOperationId !== source.operationId) {
        throw new Error(`Channel ${channelIndex} direction measurement is fabricated, mismatched, or not bound to normalized illumination evidence.`);
      }
      return { evidenceId: artifact.evidenceId, sha256: artifact.sha256, sourceEvidenceId, sourceSha256 };
    });
    directionChannels.push({
      channelIndex,
      physicalDirectionId: operationalId("physical-direction", {
        rigId, coordinateFrame: "canonical_normalized_target_v1", channelIndex, directionMeasurementEvidence,
      }),
      directionMeasurementEvidence,
    });
  }
  const directionAuthority: FastCalibrationCanonicalDirectionFrameEvidenceV1_2 = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-canonical-target-direction-authority-v1",
    derivedAt: finalizedAt, authorityMethod: "evidence_derived_normalized_illumination_direction_v1",
    coordinateFrame: "canonical_normalized_target_v1", rigId, physicalAnalyzerSha256, channels: directionChannels,
  };
  const channelWiring = wiringChannels.map((channel, index) => ({
    channelIndex: channel.channelIndex, controllerOutput: channel.controllerOutput,
    componentId: operationalId("component", {
      rigId, controllerIdentity: live.controller.identity, controllerUnit: live.controller.unit,
      controllerOutput: channel.controllerOutput, channelIndex: channel.channelIndex,
      responseEvidenceSha256: channel.responseEvidence.map((entry) => entry.sha256),
    }),
    physicalDirectionId: directionChannels[index]!.physicalDirectionId,
  }));
  const lensBytes = canonicalBytes(lensAuthority);
  const wiringBytes = canonicalBytes(wiringAuthority);
  const componentAuthority: FastCalibrationEvidenceDerivedComponentAuthorityV1_2 = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-evidence-derived-component-authority-v1",
    derivedAt: finalizedAt, authorityMethod: "content_addressed_observed_rig_response_v1", rigId,
    controllerIdentity: live.controller.identity, controllerUnit: live.controller.unit,
    componentConfigurationId: operationalId("component-configuration", wiringAuthority),
    lensAuthorityId: operationalId("lens-authority", lensAuthority),
    lensAuthorityEvidenceSha256: hash(lensBytes), wiringEvidenceSha256: hash(wiringBytes), channelWiring,
    targetVersion, targetSha256,
  };
  const lightingConfigurationId = operationalId("lighting-configuration", {
    rigId, controllerIdentity: live.controller.identity, controllerUnit: live.controller.unit,
    dutyPercent: settings.dutyPercent, wiringAuthoritySha256: hash(wiringBytes),
  });
  const liveProbe: FastCalibrationProtectedLiveProbeEvidenceV1_2 = {
    schemaVersion: "ten-kings-mathematical-calibration-v1.2-protected-live-probe-evidence-v1",
    observedAt: input.observedAt, probeAuthority: "protected-basler-leimac-live-probe-v1", stationId, rigId,
    camera: { ...live.camera, transport: "GigE" },
    controller: { identity: live.controller.identity, unit: live.controller.unit, responseKinds: [...live.controller.responseKinds] },
    dutyPercent: Number(settings.dutyPercent), locationLabel: operationalId("rig-location", { stationId, rigId }),
    lightingConfigurationId,
  };
  const files = [
    ["live", canonicalBytes(liveProbe)], ["components", canonicalBytes(componentAuthority)],
    ["directions", canonicalBytes(directionAuthority)], ["lens", lensBytes], ["wiring", wiringBytes],
  ] as const;
  const refs = Object.fromEntries(files.map(([name, bytes]) => [name, {
    fileName: `rig-materialization-input-evidence/${name}-${hash(bytes)}.json`, sha256: hash(bytes),
  }])) as Record<(typeof files)[number][0], { fileName: string; sha256: string }>;
  const manifest: FastCalibrationRigMaterializationInputManifestV1_2 = {
    schemaVersion: FAST_CALIBRATION_RIG_MATERIALIZATION_INPUT_SCHEMA_V1_2,
    captureManifest: { fileName: path.basename(input.captureManifestPath), sha256: input.captureManifestSha256 },
    liveProbe: refs.live, componentEvidence: refs.components, directionFrameEvidence: refs.directions,
    referencedEvidence: [
      { role: "lens_authority", ...refs.lens }, { role: "component_wiring", ...refs.wiring },
    ],
  };
  for (const [name, bytes] of files) await writeExact(contained(root, refs[name].fileName), bytes);
  const manifestBytes = canonicalBytes(manifest);
  const manifestSha256 = hash(manifestBytes);
  const manifestPath = contained(root, `rig-materialization-input-${manifestSha256}.json`);
  await writeExact(manifestPath, manifestBytes);
  return {
    inputManifestPath: manifestPath, inputManifestSha256: manifestSha256,
    liveProbeSha256: refs.live.sha256, componentAuthoritySha256: refs.components.sha256,
    directionFrameAuthoritySha256: refs.directions.sha256, lensAuthoritySha256: refs.lens.sha256,
    wiringAuthoritySha256: refs.wiring.sha256,
  };
}
