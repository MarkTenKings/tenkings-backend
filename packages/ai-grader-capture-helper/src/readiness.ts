import { existsSync } from "node:fs";
import {
  runCaptureHelperDiscoveryStubs,
  type CaptureHelperDiscoveryResult,
} from "./discovery";
import {
  buildArduinoLedControllerConfig,
  buildGrblStageConfig,
  isArduinoLedControllerRequested,
  isGrblStageRequested,
  runArduinoLedControllerHealthCheck,
  runGrblStageHealthCheck,
  type ArduinoLedHealthResult,
  type ArduinoLedSerialTransport,
  type GrblStageHealthResult,
  type GrblStageSerialTransport,
  getDinoLiteBridgeConfiguredStatus,
} from "./drivers";
import type {
  CaptureHelperCalibrationPaths,
  CaptureHelperConfigInput,
  CaptureHelperDeviceRole,
  CaptureHelperDriverSet,
  CaptureHelperEnv,
  CaptureHelperExpectedDeviceConfig,
  CaptureHelperSafetyFlags,
  CaptureHelperSerialHints,
} from "./index";

export type CaptureHelperReadinessStatus = "PASS" | "WARN" | "FAIL";

export interface CaptureHelperReadinessCheck {
  name: string;
  status: CaptureHelperReadinessStatus;
  message: string;
  details?: unknown;
}

export interface CaptureHelperReadinessIdentity {
  tenantId?: string;
  rigId?: string;
  locationId?: string;
  operatorId?: string;
  helperInstanceId?: string;
}

export interface CaptureHelperReadinessConfigValidation {
  status: CaptureHelperReadinessStatus;
  checks: CaptureHelperReadinessCheck[];
}

export interface CaptureHelperReadinessReport {
  ok: true;
  service: "ai-grader-capture-helper";
  mode: "readiness";
  overallStatus: CaptureHelperReadinessStatus;
  driverSet: string;
  rigMode: string;
  hardwareAccess: "not_probed";
  identity: CaptureHelperReadinessIdentity;
  configValidation: CaptureHelperReadinessConfigValidation;
  expectedDevices: CaptureHelperExpectedDeviceConfig[];
  unsupportedRealDriverNotices: string[];
  calibrationChecks: CaptureHelperReadinessCheck[];
  safetyGateStatus: CaptureHelperReadinessCheck[];
  ledControllerChecks: CaptureHelperReadinessCheck[];
  arduinoLedHealth?: ArduinoLedHealthResult;
  stageChecks: CaptureHelperReadinessCheck[];
  grblStageHealth?: GrblStageHealthResult;
  dinoliteBridgeChecks: CaptureHelperReadinessCheck[];
  discovery: CaptureHelperDiscoveryResult[];
  notes: string[];
}

interface BuildReadinessOptions {
  pathExists?: (path: string) => boolean;
  arduinoLedSerialTransport?: ArduinoLedSerialTransport;
  grblStageSerialTransport?: GrblStageSerialTransport;
}

const DEVICE_ROLES: CaptureHelperDeviceRole[] = [
  "macroCamera",
  "ledController",
  "microscope",
  "stage",
  "armInterlock",
];

function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return value?.trim();
}

function nonEmpty(value: string | undefined) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function boolFromEnv(value: string | undefined): boolean | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}

function serialHintsFromEnv(env: CaptureHelperEnv): CaptureHelperSerialHints {
  return {
    macroCamera: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_MACRO_CAMERA_SERIAL_HINT),
    ledController: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_LED_CONTROLLER_SERIAL_HINT),
    microscope: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_MICROSCOPE_SERIAL_HINT),
    stage: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_STAGE_SERIAL_HINT),
    armInterlock: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_ARM_INTERLOCK_SERIAL_HINT),
  };
}

function calibrationPathsFromEnv(env: CaptureHelperEnv): CaptureHelperCalibrationPaths {
  return {
    macroCamera: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_MACRO_CALIBRATION_PATH),
    ledController: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_LED_CALIBRATION_PATH),
    microscope: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_MICROSCOPE_CALIBRATION_PATH),
    stage: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_STAGE_CALIBRATION_PATH),
    armInterlock: nonEmpty(env.AI_GRADER_CAPTURE_HELPER_ARM_CALIBRATION_PATH),
  };
}

function safetyFromEnv(env: CaptureHelperEnv): Partial<CaptureHelperSafetyFlags> {
  return {
    armInterlockRequired: boolFromEnv(env.AI_GRADER_CAPTURE_HELPER_ARM_INTERLOCK_REQUIRED),
    requireCalibrationArtifacts: boolFromEnv(env.AI_GRADER_CAPTURE_HELPER_REQUIRE_CALIBRATION_ARTIFACTS),
  };
}

function buildIdentity(input: CaptureHelperConfigInput, env: CaptureHelperEnv): CaptureHelperReadinessIdentity {
  return {
    tenantId: firstNonEmpty(input.simulator?.tenantId, env.AI_GRADER_CAPTURE_HELPER_TENANT_ID),
    rigId: firstNonEmpty(input.simulator?.rigId, env.AI_GRADER_CAPTURE_HELPER_RIG_ID),
    locationId: firstNonEmpty(input.simulator?.locationId, env.AI_GRADER_CAPTURE_HELPER_LOCATION_ID),
    operatorId: firstNonEmpty(input.simulator?.operatorId, env.AI_GRADER_CAPTURE_HELPER_OPERATOR_ID),
    helperInstanceId: firstNonEmpty(input.simulator?.helperInstanceId, env.AI_GRADER_CAPTURE_HELPER_INSTANCE_ID),
  };
}

function normalizeSafety(input: CaptureHelperConfigInput, env: CaptureHelperEnv): CaptureHelperSafetyFlags {
  const fromEnv = safetyFromEnv(env);
  return {
    armInterlockRequired: input.safety?.armInterlockRequired ?? fromEnv.armInterlockRequired ?? true,
    requireCalibrationArtifacts: input.safety?.requireCalibrationArtifacts ?? fromEnv.requireCalibrationArtifacts ?? false,
  };
}

function defaultExpectedDevices(
  serialHints: CaptureHelperSerialHints,
  calibrationPaths: CaptureHelperCalibrationPaths
): CaptureHelperExpectedDeviceConfig[] {
  return DEVICE_ROLES.map((role) => ({
    role,
    required: true,
    ...(serialHints[role] ? { serialHint: serialHints[role] } : {}),
    ...(calibrationPaths[role] ? { calibrationPath: calibrationPaths[role] } : {}),
  }));
}

function statusFromChecks(checks: CaptureHelperReadinessCheck[]): CaptureHelperReadinessStatus {
  if (checks.some((check) => check.status === "FAIL")) return "FAIL";
  if (checks.some((check) => check.status === "WARN")) return "WARN";
  return "PASS";
}

function requiredIdCheck(name: keyof CaptureHelperReadinessIdentity, value: string | undefined): CaptureHelperReadinessCheck {
  return {
    name: `identity.${name}`,
    status: value ? "PASS" : "FAIL",
    message: value ? `${name} is configured.` : `${name} is required for hardware readiness validation.`,
  };
}

function configChecks(input: {
  identity: CaptureHelperReadinessIdentity;
  driverSet: string;
  rigMode: string;
  expectedDevices: CaptureHelperExpectedDeviceConfig[];
  arduinoRequested: boolean;
  arduinoPort?: string;
  grblStageRequested: boolean;
  grblStagePort?: string;
}): CaptureHelperReadinessCheck[] {
  const arduinoMissingPort = input.arduinoRequested && !input.arduinoPort;
  const grblStageMissingPort = input.grblStageRequested && !input.grblStagePort;
  const supportedRealAdapterWithPort =
    input.driverSet === "real" &&
    ((input.arduinoRequested && Boolean(input.arduinoPort)) ||
      (input.grblStageRequested && Boolean(input.grblStagePort)));
  const realDriverSetAllowed = supportedRealAdapterWithPort && !arduinoMissingPort && !grblStageMissingPort;
  const checks: CaptureHelperReadinessCheck[] = [
    requiredIdCheck("helperInstanceId", input.identity.helperInstanceId),
    requiredIdCheck("rigId", input.identity.rigId),
    requiredIdCheck("tenantId", input.identity.tenantId),
    requiredIdCheck("locationId", input.identity.locationId),
    requiredIdCheck("operatorId", input.identity.operatorId),
  ];

  checks.push({
    name: "driverSet",
    status: input.driverSet === "mock" || realDriverSetAllowed ? "PASS" : "FAIL",
    message:
      input.driverSet === "mock"
        ? "Mock driver set is allowed."
        : realDriverSetAllowed
          ? "Real driver set is limited to explicit Arduino LED and GRBL stage readiness for this slice."
          : input.driverSet === "real" && arduinoMissingPort
            ? "Arduino LED controller readiness requires an explicit serial port."
            : input.driverSet === "real" && grblStageMissingPort
              ? "GRBL stage readiness requires an explicit serial port."
              : input.driverSet === "real"
                ? "Real driver set is not implemented except explicit Arduino LED controller or GRBL stage readiness."
                : "driverSet must be mock or real.",
  });

  checks.push({
    name: "rigMode",
    status: input.rigMode === "simulator" || input.rigMode === "readiness" ? "PASS" : "FAIL",
    message:
      input.rigMode === "simulator" || input.rigMode === "readiness"
        ? "rigMode is valid."
        : "rigMode must be simulator or readiness.",
  });

  checks.push({
    name: "expectedDevices",
    status: input.expectedDevices.length > 0 ? "PASS" : "FAIL",
    message: input.expectedDevices.length > 0 ? "Expected device list is configured." : "At least one expected device is required.",
  });

  return checks;
}

function calibrationChecks(
  expectedDevices: CaptureHelperExpectedDeviceConfig[],
  safety: CaptureHelperSafetyFlags,
  pathExists: (path: string) => boolean
): CaptureHelperReadinessCheck[] {
  return expectedDevices
    .filter((device) => typeof device.calibrationPath === "string" && device.calibrationPath.trim().length > 0)
    .map((device) => {
      const calibrationPath = device.calibrationPath as string;
      const exists = pathExists(calibrationPath);
      return {
        name: `calibration.${device.role}`,
        status: exists ? "PASS" : safety.requireCalibrationArtifacts ? "FAIL" : "WARN",
        message: exists
          ? `Calibration artifact path exists for ${device.role}.`
          : `Calibration artifact path is configured but missing for ${device.role}.`,
        details: { path: calibrationPath },
      };
    });
}

function safetyGateChecks(input: {
  driverSet: string;
  expectedDevices: CaptureHelperExpectedDeviceConfig[];
  safety: CaptureHelperSafetyFlags;
  arduinoRequested: boolean;
  arduinoPort?: string;
  grblStageRequested: boolean;
  grblStagePort?: string;
}): CaptureHelperReadinessCheck[] {
  const armExpected = input.expectedDevices.some((device) => device.role === "armInterlock" && device.required);
  const arduinoMissingPort = input.arduinoRequested && !input.arduinoPort;
  const grblStageMissingPort = input.grblStageRequested && !input.grblStagePort;
  const supportedRealAdapterWithPort =
    input.driverSet === "real" &&
    ((input.arduinoRequested && Boolean(input.arduinoPort)) ||
      (input.grblStageRequested && Boolean(input.grblStagePort)));
  const realDriverSetAllowed = supportedRealAdapterWithPort && !arduinoMissingPort && !grblStageMissingPort;
  return [
    {
      name: "safety.noHardwareProbe",
      status: "PASS",
      message: realDriverSetAllowed
        ? "Only explicitly requested readiness checks with supplied serial ports may open serial."
        : "Readiness mode does not open cameras, serial ports, controllers, or SDKs.",
    },
    {
      name: "safety.armInterlock",
      status: input.safety.armInterlockRequired && !armExpected ? "FAIL" : "PASS",
      message:
        input.safety.armInterlockRequired && !armExpected
          ? "Arm interlock is required but not listed as an expected device."
          : "Arm interlock safety requirement is represented in readiness config; physical state is not probed.",
    },
    {
      name: "safety.realDriverFailClosed",
      status: input.driverSet === "real" && !realDriverSetAllowed ? "FAIL" : "PASS",
      message:
        input.driverSet === "real" && !realDriverSetAllowed
          ? "Real driver mode is fail-closed unless explicit supported readiness is configured with required ports."
          : realDriverSetAllowed
            ? "Real hardware access is restricted to configured Arduino LED readiness and/or GRBL status query readiness."
          : "Mock driver mode is simulator-only and does not access hardware.",
    },
  ];
}

function ledControllerChecks(input: {
  driverSet: string;
  arduinoRequested: boolean;
  arduinoPort?: string;
  baudRate: number;
}): CaptureHelperReadinessCheck[] {
  if (input.driverSet !== "real" || !input.arduinoRequested) {
    return [
      {
        name: "ledController.arduinoHealth",
        status: "PASS",
        message: "Arduino LED controller real health check is not requested; no serial port is opened.",
      },
    ];
  }

  if (!input.arduinoPort) {
    return [
      {
        name: "ledController.arduinoHealth",
        status: "FAIL",
        message: "Arduino LED controller readiness requires an explicit serial port.",
      },
    ];
  }

  return [
    {
      name: "ledController.arduinoHealth",
      status: "WARN",
      message: "Arduino LED controller health is configured; async readiness or led-health must run PING and LED ALL OFF.",
      details: {
        port: input.arduinoPort,
        baudRate: input.baudRate,
      },
    },
  ];
}

function stageChecks(input: {
  driverSet: string;
  grblStageRequested: boolean;
  grblStagePort?: string;
  baudRate: number;
}): CaptureHelperReadinessCheck[] {
  if (input.driverSet !== "real" || !input.grblStageRequested) {
    return [
      {
        name: "stage.grblHealth",
        status: "PASS",
        message: "GRBL stage real health check is not requested; no serial port is opened.",
      },
    ];
  }

  if (!input.grblStagePort) {
    return [
      {
        name: "stage.grblHealth",
        status: "FAIL",
        message: "GRBL stage readiness requires an explicit serial port.",
      },
    ];
  }

  return [
    {
      name: "stage.grblHealth",
      status: "WARN",
      message: "GRBL stage health is configured; async readiness or stage-health must run only the safe status query.",
      details: {
        port: input.grblStagePort,
        baudRate: input.baudRate,
        command: "?",
      },
    },
  ];
}

function dinoliteBridgeChecks(input: CaptureHelperConfigInput, env: CaptureHelperEnv): CaptureHelperReadinessCheck[] {
  const status = getDinoLiteBridgeConfiguredStatus({
    executablePath: input.dinoliteBridge?.executablePath ?? env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_PATH,
    adapter: input.dinoliteBridge?.adapter ?? bridgeAdapterFromEnv(env),
    timeoutMs: input.dinoliteBridge?.timeoutMs,
    args: input.dinoliteBridge?.args,
  });
  return [
    {
      name: "microscope.dinoliteBridge",
      status: "PASS",
      message: status.reason,
      details: {
        configured: status.configured,
        executablePath: status.executablePath,
        adapter: status.adapter,
        canSpawn: status.canSpawn,
      },
    },
  ];
}

function bridgeAdapterFromEnv(env: CaptureHelperEnv): "fake" | "dnvideox" | undefined {
  const value = env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_ADAPTER?.trim().toLowerCase();
  if (value === "fake" || value === "dnvideox") return value;
  return undefined;
}

function checkFromArduinoHealth(result: ArduinoLedHealthResult): CaptureHelperReadinessCheck {
  return {
    name: "ledController.arduinoHealth",
    status: result.status,
    message: result.ok
      ? "Arduino LED controller responded to PING and accepted LED ALL OFF."
      : result.error ?? result.safeShutdownError ?? "Arduino LED controller health check failed.",
    details: {
      port: result.port,
      baudRate: result.baudRate,
      opened: result.opened,
      closed: result.closed,
      allOffAttempted: result.allOffAttempted,
      allOffSucceeded: result.allOffSucceeded,
      commands: result.commands,
      safeShutdownError: result.safeShutdownError,
    },
  };
}

function checkFromGrblStageHealth(result: GrblStageHealthResult): CaptureHelperReadinessCheck {
  return {
    name: "stage.grblHealth",
    status: result.status,
    message: result.ok
      ? "GRBL stage returned a well-formed status response to the safe status query."
      : result.error ?? result.closeError ?? "GRBL stage health check failed.",
    details: {
      port: result.port,
      baudRate: result.baudRate,
      opened: result.opened,
      closed: result.closed,
      statusResponse: result.statusResponse,
      queries: result.queries,
      closeError: result.closeError,
    },
  };
}

function replaceReadinessChecks(
  report: CaptureHelperReadinessReport,
  input: {
    ledControllerChecks?: CaptureHelperReadinessCheck[];
    stageChecks?: CaptureHelperReadinessCheck[];
    arduinoLedHealth?: ArduinoLedHealthResult;
    grblStageHealth?: GrblStageHealthResult;
  }
): CaptureHelperReadinessReport {
  const ledChecks = input.ledControllerChecks ?? report.ledControllerChecks;
  const stageReadinessChecks = input.stageChecks ?? report.stageChecks;
  const dinoliteChecks = report.dinoliteBridgeChecks;
  const allChecks = [
    ...report.configValidation.checks,
    ...report.calibrationChecks,
    ...report.safetyGateStatus,
    ...ledChecks,
    ...stageReadinessChecks,
    ...dinoliteChecks,
  ];
  return {
    ...report,
    overallStatus: statusFromChecks(allChecks),
    ledControllerChecks: ledChecks,
    stageChecks: stageReadinessChecks,
    ...(input.arduinoLedHealth ? { arduinoLedHealth: input.arduinoLedHealth } : {}),
    ...(input.grblStageHealth ? { grblStageHealth: input.grblStageHealth } : {}),
  };
}

export function buildCaptureHelperReadinessReport(
  input: CaptureHelperConfigInput = {},
  env: CaptureHelperEnv = process.env,
  options: BuildReadinessOptions = {}
): CaptureHelperReadinessReport {
  const identity = buildIdentity(input, env);
  const serialHints = {
    ...serialHintsFromEnv(env),
    ...input.serialHints,
  };
  const calibrationPaths = {
    ...calibrationPathsFromEnv(env),
    ...input.calibrationPaths,
  };
  const expectedDevices = input.expectedDevices ?? defaultExpectedDevices(serialHints, calibrationPaths);
  const safety = normalizeSafety(input, env);
  const driverSet = firstNonEmpty(input.driverSet, env.AI_GRADER_CAPTURE_HELPER_DRIVER_SET)?.toLowerCase() ?? "mock";
  const rigMode = firstNonEmpty(input.rigMode, env.AI_GRADER_CAPTURE_HELPER_RIG_MODE)?.toLowerCase() ?? "simulator";
  const knownDriverSet: CaptureHelperDriverSet | undefined =
    driverSet === "mock" || driverSet === "real" ? driverSet : undefined;
  const arduinoRequested = isArduinoLedControllerRequested(input.ledController?.kind, env);
  const arduinoConfig = buildArduinoLedControllerConfig(input.ledController?.arduino, env);
  const grblStageRequested = isGrblStageRequested(input.stage?.kind, env);
  const grblStageConfig = buildGrblStageConfig(input.stage?.grbl, env);

  const configValidationChecks = configChecks({
    identity,
    driverSet,
    rigMode,
    expectedDevices,
    arduinoRequested,
    arduinoPort: arduinoConfig.port,
    grblStageRequested,
    grblStagePort: grblStageConfig.port,
  });
  const calibration = calibrationChecks(expectedDevices, safety, options.pathExists ?? existsSync);
  const safetyGateStatus = safetyGateChecks({
    driverSet,
    expectedDevices,
    safety,
    arduinoRequested,
    arduinoPort: arduinoConfig.port,
    grblStageRequested,
    grblStagePort: grblStageConfig.port,
  });
  const ledChecks = ledControllerChecks({
    driverSet,
    arduinoRequested,
    arduinoPort: arduinoConfig.port,
    baudRate: arduinoConfig.baudRate,
  });
  const stageReadinessChecks = stageChecks({
    driverSet,
    grblStageRequested,
    grblStagePort: grblStageConfig.port,
    baudRate: grblStageConfig.baudRate,
  });
  const dinoliteChecks = dinoliteBridgeChecks(input, env);
  const discovery = knownDriverSet ? runCaptureHelperDiscoveryStubs(knownDriverSet) : [];
  const unsupportedRealDriverNotices =
    driverSet === "real"
      ? [
          "Real driverSet is limited to explicit Arduino LED readiness and GRBL stage status readiness in this slice.",
          "Macro camera, microscope, and arm interlock real drivers are not implemented or probed.",
          grblStageRequested
            ? "GRBL stage readiness sends only ? when a port is explicitly supplied; no homing, unlock, reset, or motion commands are sent."
            : arduinoRequested
              ? "Arduino LED readiness uses PING and LED ALL OFF only when a port is explicitly supplied."
              : "No serial ports, cameras, stages, interlocks, or SDKs are probed.",
        ]
      : [];
  const allChecks = [
    ...configValidationChecks,
    ...calibration,
    ...safetyGateStatus,
    ...ledChecks,
    ...stageReadinessChecks,
    ...dinoliteChecks,
  ];
  const overallStatus = statusFromChecks(allChecks);

  return {
    ok: true,
    service: "ai-grader-capture-helper",
    mode: "readiness",
    overallStatus,
    driverSet,
    rigMode,
    hardwareAccess: "not_probed",
    identity,
    configValidation: {
      status: statusFromChecks(configValidationChecks),
      checks: configValidationChecks,
    },
    expectedDevices,
    unsupportedRealDriverNotices,
    calibrationChecks: calibration,
    safetyGateStatus,
    ledControllerChecks: ledChecks,
    stageChecks: stageReadinessChecks,
    dinoliteBridgeChecks: dinoliteChecks,
    discovery,
    notes: [
      "Readiness reports validate configuration only.",
      "Device discovery is a stub and does not open hardware or OS device APIs.",
      "Opt-in real hardware readiness paths are limited to Arduino LED controller PING plus LED ALL OFF and GRBL stage ? status query.",
      "Dino-Lite bridge readiness reports configuration only and does not spawn the bridge process.",
    ],
  };
}

export async function buildCaptureHelperReadinessReportAsync(
  input: CaptureHelperConfigInput = {},
  env: CaptureHelperEnv = process.env,
  options: BuildReadinessOptions = {}
): Promise<CaptureHelperReadinessReport> {
  const report = buildCaptureHelperReadinessReport(input, env, options);
  const driverSet = firstNonEmpty(input.driverSet, env.AI_GRADER_CAPTURE_HELPER_DRIVER_SET)?.toLowerCase() ?? "mock";
  const arduinoRequested = isArduinoLedControllerRequested(input.ledController?.kind, env);
  const arduinoConfig = buildArduinoLedControllerConfig(input.ledController?.arduino, env);
  const grblStageRequested = isGrblStageRequested(input.stage?.kind, env);
  const grblStageConfig = buildGrblStageConfig(input.stage?.grbl, env);
  let nextReport = report;

  if (driverSet === "real" && arduinoRequested && arduinoConfig.port) {
    const arduinoLedHealth = await runArduinoLedControllerHealthCheck({
      config: arduinoConfig,
      env,
      transport: options.arduinoLedSerialTransport,
    });

    nextReport = replaceReadinessChecks(nextReport, {
      ledControllerChecks: [checkFromArduinoHealth(arduinoLedHealth)],
      arduinoLedHealth,
    });
  }

  if (driverSet === "real" && grblStageRequested && grblStageConfig.port) {
    const grblStageHealth = await runGrblStageHealthCheck({
      config: grblStageConfig,
      env,
      transport: options.grblStageSerialTransport,
    });

    nextReport = replaceReadinessChecks(nextReport, {
      stageChecks: [checkFromGrblStageHealth(grblStageHealth)],
      grblStageHealth,
    });
  }

  return nextReport;
}
