import {
  buildCaptureHelperSimulatorConfig,
  createCaptureHelperSimulator,
  type CaptureHelperSimulatorConfig,
  type CaptureHelperSimulatorConfigInput,
  type StandardCaptureSimulation,
} from "@tenkings/ai-grader-simulator";
import type {
  AiGraderValidationIssue,
  AiGraderValidationResult,
  CaptureManifest,
  DeviceCapabilityManifest,
  GradingMode,
  MicroSpotCapturePackage,
  EvidenceArtifactRef,
} from "@tenkings/shared";
import {
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
  validateMicroSpotCapturePackage,
} from "@tenkings/shared";

export const CAPTURE_HELPER_SERVICE_NAME = "ai-grader-capture-helper";
export const CAPTURE_HELPER_VERSION = "0.1.0";
export const SUPPORTED_CAPTURE_HELPER_BACKENDS = ["simulator"] as const;
export const CAPTURE_HELPER_HARDWARE_ACCESS = "disabled" as const;
export const CAPTURE_HELPER_NETWORK_LISTENER = "disabled" as const;
export const CAPTURE_HELPER_MANIFEST_MODES = ["QUICK", "STANDARD", "AUTH_ONLY"] as const;

export type CaptureHelperBackend = (typeof SUPPORTED_CAPTURE_HELPER_BACKENDS)[number];
export type CaptureHelperManifestMode = (typeof CAPTURE_HELPER_MANIFEST_MODES)[number];
export type CaptureHelperEnv = Record<string, string | undefined>;

export interface CaptureHelperConfigInput {
  mode?: string;
  simulator?: CaptureHelperSimulatorConfigInput;
}

export interface CaptureHelperConfig {
  service: typeof CAPTURE_HELPER_SERVICE_NAME;
  version: typeof CAPTURE_HELPER_VERSION;
  mode: CaptureHelperBackend;
  hardwareAccess: typeof CAPTURE_HELPER_HARDWARE_ACCESS;
  networkListener: typeof CAPTURE_HELPER_NETWORK_LISTENER;
  simulator: CaptureHelperSimulatorConfig;
}

export interface CaptureHelperHealth {
  ok: true;
  service: typeof CAPTURE_HELPER_SERVICE_NAME;
  version: typeof CAPTURE_HELPER_VERSION;
  mode: CaptureHelperBackend;
  status: "simulator_offline";
  hardwareAccess: typeof CAPTURE_HELPER_HARDWARE_ACCESS;
  networkListener: typeof CAPTURE_HELPER_NETWORK_LISTENER;
  deviceAccess: "none";
  message: string;
  helperInstanceId: string;
  captureSessionId: string;
}

export interface CaptureHelperValidationSummary {
  valid: boolean;
  issues: AiGraderValidationIssue[];
}

export interface CaptureHelperCapabilityResult {
  service: typeof CAPTURE_HELPER_SERVICE_NAME;
  mode: CaptureHelperBackend;
  simulator: true;
  hardwareAccess: typeof CAPTURE_HELPER_HARDWARE_ACCESS;
  validation: CaptureHelperValidationSummary;
  deviceCapabilityManifests: DeviceCapabilityManifest[];
}

export interface CaptureHelperManifestResult {
  service: typeof CAPTURE_HELPER_SERVICE_NAME;
  mode: CaptureHelperBackend;
  simulator: true;
  captureMode: CaptureHelperManifestMode;
  hardwareAccess: typeof CAPTURE_HELPER_HARDWARE_ACCESS;
  validation: CaptureHelperValidationSummary;
  captureManifest: CaptureManifest;
  microSpotPackages?: MicroSpotCapturePackage[];
  evidenceArtifacts?: EvidenceArtifactRef[];
}

export interface CaptureHelperService {
  readonly config: CaptureHelperConfig;
  health(): CaptureHelperHealth;
  capabilities(): CaptureHelperCapabilityResult;
  manifest(mode: CaptureHelperManifestMode): CaptureHelperManifestResult;
}

export class CaptureHelperConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureHelperConfigError";
  }
}

export class CaptureHelperCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureHelperCommandError";
  }
}

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return value?.trim();
}

function csv(value: string | undefined) {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function simulatorConfigFromEnv(env: CaptureHelperEnv): CaptureHelperSimulatorConfigInput {
  return {
    tenantId: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_TENANT_ID),
    captureSessionId: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_SESSION_ID),
    rigId: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_RIG_ID),
    locationId: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_LOCATION_ID),
    operatorId: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_OPERATOR_ID),
    helperInstanceId: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_INSTANCE_ID),
    helperVersion: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_VERSION),
    seed: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_SEED),
    createdAt: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_CREATED_AT),
    storagePrefix: firstNonEmpty(env.AI_GRADER_CAPTURE_HELPER_STORAGE_PREFIX),
    calibrationSnapshotIds: csv(env.AI_GRADER_CAPTURE_HELPER_CALIBRATION_IDS),
    standardSurfaceSuspectRegionIds: csv(env.AI_GRADER_CAPTURE_HELPER_SURFACE_SUSPECT_IDS),
  };
}

function mergeSimulatorConfig(
  fromEnv: CaptureHelperSimulatorConfigInput,
  explicit: CaptureHelperSimulatorConfigInput | undefined
): CaptureHelperSimulatorConfigInput {
  return {
    ...fromEnv,
    ...explicit,
    calibrationSnapshotIds: explicit?.calibrationSnapshotIds ?? fromEnv.calibrationSnapshotIds,
    standardSurfaceSuspectRegionIds: explicit?.standardSurfaceSuspectRegionIds ?? fromEnv.standardSurfaceSuspectRegionIds,
  };
}

function normalizeBackendMode(mode: string | undefined): CaptureHelperBackend {
  const normalized = (mode ?? "simulator").trim().toLowerCase();
  if (normalized !== "simulator") {
    throw new CaptureHelperConfigError("AI Grader capture helper supports only simulator mode in this skeleton.");
  }
  return "simulator";
}

export function loadCaptureHelperConfig(
  input: CaptureHelperConfigInput = {},
  env: CaptureHelperEnv = process.env
): CaptureHelperConfig {
  const mode = normalizeBackendMode(input.mode ?? env.AI_GRADER_CAPTURE_HELPER_MODE);
  const simulator = buildCaptureHelperSimulatorConfig(
    mergeSimulatorConfig(simulatorConfigFromEnv(env), input.simulator)
  );

  return {
    service: CAPTURE_HELPER_SERVICE_NAME,
    version: CAPTURE_HELPER_VERSION,
    mode,
    hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
    networkListener: CAPTURE_HELPER_NETWORK_LISTENER,
    simulator,
  };
}

function combineValidation(results: AiGraderValidationResult[]): CaptureHelperValidationSummary {
  const issues = results.flatMap((result) => result.issues);
  return {
    valid: results.every((result) => result.valid),
    issues,
  };
}

function validateCapabilities(manifests: DeviceCapabilityManifest[]): CaptureHelperValidationSummary {
  return combineValidation(manifests.map((manifest) => validateDeviceCapabilityManifest(manifest)));
}

function validateStandardSimulation(simulation: StandardCaptureSimulation): CaptureHelperValidationSummary {
  return combineValidation([
    validateCaptureManifestForMode(simulation.captureManifest, "STANDARD", { side: "FRONT" }),
    ...simulation.microSpotPackages.map((microPackage) => validateMicroSpotCapturePackage(microPackage)),
  ]);
}

export function isCaptureHelperManifestMode(value: unknown): value is CaptureHelperManifestMode {
  return value === "QUICK" || value === "STANDARD" || value === "AUTH_ONLY";
}

export function parseCaptureHelperManifestMode(value: unknown): CaptureHelperManifestMode {
  if (typeof value !== "string") {
    throw new CaptureHelperCommandError("Manifest mode is required.");
  }
  const normalized = value.trim().toUpperCase();
  if (!isCaptureHelperManifestMode(normalized)) {
    throw new CaptureHelperCommandError("Manifest mode must be QUICK, STANDARD, or AUTH_ONLY.");
  }
  return normalized;
}

export function createCaptureHelperService(
  input: CaptureHelperConfigInput = {},
  env: CaptureHelperEnv = process.env
): CaptureHelperService {
  const config = loadCaptureHelperConfig(input, env);
  const simulator = createCaptureHelperSimulator(config.simulator);

  return {
    config,
    health() {
      return {
        ok: true,
        service: CAPTURE_HELPER_SERVICE_NAME,
        version: CAPTURE_HELPER_VERSION,
        mode: config.mode,
        status: "simulator_offline",
        hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
        networkListener: CAPTURE_HELPER_NETWORK_LISTENER,
        deviceAccess: "none",
        message: "Simulator-only capture helper skeleton is healthy; no real hardware or network listener is active.",
        helperInstanceId: config.simulator.helperInstanceId,
        captureSessionId: config.simulator.captureSessionId,
      };
    },
    capabilities() {
      const deviceCapabilityManifests = simulator.generateDeviceCapabilityManifests();
      return {
        service: CAPTURE_HELPER_SERVICE_NAME,
        mode: config.mode,
        simulator: true,
        hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
        validation: validateCapabilities(deviceCapabilityManifests),
        deviceCapabilityManifests,
      };
    },
    manifest(mode) {
      if (mode === "STANDARD") {
        const simulation = simulator.generateStandardCaptureSimulation();
        return {
          service: CAPTURE_HELPER_SERVICE_NAME,
          mode: config.mode,
          simulator: true,
          captureMode: mode,
          hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
          validation: validateStandardSimulation(simulation),
          captureManifest: simulation.captureManifest,
          microSpotPackages: simulation.microSpotPackages,
          evidenceArtifacts: simulation.evidenceArtifacts,
        };
      }

      const captureManifest =
        mode === "AUTH_ONLY"
          ? simulator.generateAuthOnlyCaptureManifest()
          : simulator.generateQuickCaptureManifest();
      return {
        service: CAPTURE_HELPER_SERVICE_NAME,
        mode: config.mode,
        simulator: true,
        captureMode: mode,
        hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
        validation: validateCaptureManifestForMode(captureManifest, mode as GradingMode, { side: "FRONT" }),
        captureManifest,
      };
    },
  };
}
