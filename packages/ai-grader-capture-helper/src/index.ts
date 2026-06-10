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
import {
  createMockDriverSet,
  type GrblStageConfigInput,
  mockDriverCapabilities,
  type ArduinoLedControllerConfigInput,
  type CaptureHelperDriverSet,
  type CaptureHelperDriverSetDrivers,
  type DinoLiteBridgeClientConfig,
} from "./drivers";
export * from "./drivers";
export * from "./discovery";
export * from "./experimentalGrading";
export * from "./readiness";

export const CAPTURE_HELPER_SERVICE_NAME = "ai-grader-capture-helper";
export const CAPTURE_HELPER_VERSION = "0.1.0";
export const SUPPORTED_CAPTURE_HELPER_BACKENDS = ["simulator"] as const;
export const SUPPORTED_CAPTURE_HELPER_DRIVER_SETS = ["mock", "real"] as const;
export const CAPTURE_HELPER_RIG_MODES = ["simulator", "readiness"] as const;
export const CAPTURE_HELPER_DEVICE_ROLES = [
  "macroCamera",
  "ledController",
  "microscope",
  "stage",
  "armInterlock",
] as const;
export const CAPTURE_HELPER_HARDWARE_ACCESS = "disabled" as const;
export const CAPTURE_HELPER_NETWORK_LISTENER = "disabled" as const;
export const CAPTURE_HELPER_MANIFEST_MODES = ["QUICK", "STANDARD", "AUTH_ONLY"] as const;

export type CaptureHelperBackend = (typeof SUPPORTED_CAPTURE_HELPER_BACKENDS)[number];
export type CaptureHelperRigMode = (typeof CAPTURE_HELPER_RIG_MODES)[number];
export type CaptureHelperDeviceRole = (typeof CAPTURE_HELPER_DEVICE_ROLES)[number];
export type CaptureHelperManifestMode = (typeof CAPTURE_HELPER_MANIFEST_MODES)[number];
export type CaptureHelperEnv = Record<string, string | undefined>;

export type CaptureHelperCalibrationPaths = Partial<Record<CaptureHelperDeviceRole, string>>;
export type CaptureHelperSerialHints = Partial<Record<CaptureHelperDeviceRole, string>>;

export interface CaptureHelperExpectedDeviceConfig {
  role: CaptureHelperDeviceRole;
  required: boolean;
  serialHint?: string;
  calibrationPath?: string;
}

export interface CaptureHelperSafetyFlags {
  armInterlockRequired: boolean;
  requireCalibrationArtifacts: boolean;
}

export interface CaptureHelperConfigInput {
  mode?: string;
  rigMode?: string;
  driverSet?: string;
  ledController?: {
    kind?: string;
    arduino?: ArduinoLedControllerConfigInput;
  };
  stage?: {
    kind?: string;
    grbl?: GrblStageConfigInput;
  };
  dinoliteBridge?: DinoLiteBridgeClientConfig;
  simulator?: CaptureHelperSimulatorConfigInput;
  expectedDevices?: CaptureHelperExpectedDeviceConfig[];
  serialHints?: CaptureHelperSerialHints;
  calibrationPaths?: CaptureHelperCalibrationPaths;
  safety?: Partial<CaptureHelperSafetyFlags>;
}

export interface CaptureHelperConfig {
  service: typeof CAPTURE_HELPER_SERVICE_NAME;
  version: typeof CAPTURE_HELPER_VERSION;
  mode: CaptureHelperBackend;
  rigMode: CaptureHelperRigMode;
  driverSet: CaptureHelperDriverSet;
  hardwareAccess: typeof CAPTURE_HELPER_HARDWARE_ACCESS;
  networkListener: typeof CAPTURE_HELPER_NETWORK_LISTENER;
  simulator: CaptureHelperSimulatorConfig;
  expectedDevices: CaptureHelperExpectedDeviceConfig[];
  serialHints: CaptureHelperSerialHints;
  calibrationPaths: CaptureHelperCalibrationPaths;
  safety: CaptureHelperSafetyFlags;
}

export interface CaptureHelperHealth {
  ok: true;
  service: typeof CAPTURE_HELPER_SERVICE_NAME;
  version: typeof CAPTURE_HELPER_VERSION;
  mode: CaptureHelperBackend;
  driverSet: CaptureHelperDriverSet;
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
  driverSet: CaptureHelperDriverSet;
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
  readonly drivers: CaptureHelperDriverSetDrivers;
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

function boolFromEnv(value: string | undefined): boolean | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new CaptureHelperConfigError(`Invalid boolean config value: ${value}`);
}

function nonEmptyConfigValue(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
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

function serialHintsFromEnv(env: CaptureHelperEnv): CaptureHelperSerialHints {
  return {
    macroCamera: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_MACRO_CAMERA_SERIAL_HINT),
    ledController: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_LED_CONTROLLER_SERIAL_HINT),
    microscope: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_MICROSCOPE_SERIAL_HINT),
    stage: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_STAGE_SERIAL_HINT),
    armInterlock: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_ARM_INTERLOCK_SERIAL_HINT),
  };
}

function calibrationPathsFromEnv(env: CaptureHelperEnv): CaptureHelperCalibrationPaths {
  return {
    macroCamera: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_MACRO_CALIBRATION_PATH),
    ledController: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_LED_CALIBRATION_PATH),
    microscope: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_MICROSCOPE_CALIBRATION_PATH),
    stage: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_STAGE_CALIBRATION_PATH),
    armInterlock: nonEmptyConfigValue(env.AI_GRADER_CAPTURE_HELPER_ARM_CALIBRATION_PATH),
  };
}

function safetyFromEnv(env: CaptureHelperEnv): Partial<CaptureHelperSafetyFlags> {
  return {
    armInterlockRequired: boolFromEnv(env.AI_GRADER_CAPTURE_HELPER_ARM_INTERLOCK_REQUIRED),
    requireCalibrationArtifacts: boolFromEnv(env.AI_GRADER_CAPTURE_HELPER_REQUIRE_CALIBRATION_ARTIFACTS),
  };
}

export function defaultCaptureHelperExpectedDevices(
  serialHints: CaptureHelperSerialHints = {},
  calibrationPaths: CaptureHelperCalibrationPaths = {}
): CaptureHelperExpectedDeviceConfig[] {
  return CAPTURE_HELPER_DEVICE_ROLES.map((role) => ({
    role,
    required: true,
    ...(serialHints[role] ? { serialHint: serialHints[role] } : {}),
    ...(calibrationPaths[role] ? { calibrationPath: calibrationPaths[role] } : {}),
  }));
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

function normalizeRigMode(rigMode: string | undefined): CaptureHelperRigMode {
  const normalized = (rigMode ?? "simulator").trim().toLowerCase();
  if (normalized !== "simulator" && normalized !== "readiness") {
    throw new CaptureHelperConfigError("AI Grader capture helper rigMode must be simulator or readiness.");
  }
  return normalized;
}

function normalizeDriverSet(driverSet: string | undefined): CaptureHelperDriverSet {
  const normalized = (driverSet ?? "mock").trim().toLowerCase();
  if (normalized === "real") {
    throw new CaptureHelperConfigError("AI Grader capture helper real drivers are not implemented; use readiness for validation only.");
  }
  if (normalized !== "mock") {
    throw new CaptureHelperConfigError("AI Grader capture helper driverSet must be mock or real.");
  }
  return "mock";
}

function normalizeSafetyFlags(
  fromEnv: Partial<CaptureHelperSafetyFlags>,
  explicit: Partial<CaptureHelperSafetyFlags> | undefined
): CaptureHelperSafetyFlags {
  return {
    armInterlockRequired: explicit?.armInterlockRequired ?? fromEnv.armInterlockRequired ?? true,
    requireCalibrationArtifacts: explicit?.requireCalibrationArtifacts ?? fromEnv.requireCalibrationArtifacts ?? false,
  };
}

export function loadCaptureHelperConfig(
  input: CaptureHelperConfigInput = {},
  env: CaptureHelperEnv = process.env
): CaptureHelperConfig {
  const mode = normalizeBackendMode(input.mode ?? env.AI_GRADER_CAPTURE_HELPER_MODE);
  const rigMode = normalizeRigMode(input.rigMode ?? env.AI_GRADER_CAPTURE_HELPER_RIG_MODE);
  const driverSet = normalizeDriverSet(input.driverSet ?? env.AI_GRADER_CAPTURE_HELPER_DRIVER_SET);
  const serialHints = {
    ...serialHintsFromEnv(env),
    ...input.serialHints,
  };
  const calibrationPaths = {
    ...calibrationPathsFromEnv(env),
    ...input.calibrationPaths,
  };
  const expectedDevices =
    input.expectedDevices ?? defaultCaptureHelperExpectedDevices(serialHints, calibrationPaths);
  const safety = normalizeSafetyFlags(safetyFromEnv(env), input.safety);
  const simulator = buildCaptureHelperSimulatorConfig(
    mergeSimulatorConfig(simulatorConfigFromEnv(env), input.simulator)
  );

  return {
    service: CAPTURE_HELPER_SERVICE_NAME,
    version: CAPTURE_HELPER_VERSION,
    mode,
    rigMode,
    driverSet,
    hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
    networkListener: CAPTURE_HELPER_NETWORK_LISTENER,
    simulator,
    expectedDevices,
    serialHints,
    calibrationPaths,
    safety,
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
  const drivers = createMockDriverSet(config.simulator);

  return {
    config,
    drivers,
    health() {
      return {
        ok: true,
        service: CAPTURE_HELPER_SERVICE_NAME,
        version: CAPTURE_HELPER_VERSION,
        mode: config.mode,
        driverSet: config.driverSet,
        status: "simulator_offline",
        hardwareAccess: CAPTURE_HELPER_HARDWARE_ACCESS,
        networkListener: CAPTURE_HELPER_NETWORK_LISTENER,
        deviceAccess: "none",
        message: "Simulator-only capture helper core is healthy; no real hardware is active and local transport only runs when explicitly started.",
        helperInstanceId: config.simulator.helperInstanceId,
        captureSessionId: config.simulator.captureSessionId,
      };
    },
    capabilities() {
      const deviceCapabilityManifests = mockDriverCapabilities(drivers);
      return {
        service: CAPTURE_HELPER_SERVICE_NAME,
        mode: config.mode,
        driverSet: config.driverSet,
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
