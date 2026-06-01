import { existsSync } from "node:fs";
import {
  runCaptureHelperDiscoveryStubs,
  type CaptureHelperDiscoveryResult,
} from "./discovery";
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
  discovery: CaptureHelperDiscoveryResult[];
  notes: string[];
}

interface BuildReadinessOptions {
  pathExists?: (path: string) => boolean;
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
}): CaptureHelperReadinessCheck[] {
  const checks: CaptureHelperReadinessCheck[] = [
    requiredIdCheck("helperInstanceId", input.identity.helperInstanceId),
    requiredIdCheck("rigId", input.identity.rigId),
    requiredIdCheck("tenantId", input.identity.tenantId),
    requiredIdCheck("locationId", input.identity.locationId),
    requiredIdCheck("operatorId", input.identity.operatorId),
  ];

  checks.push({
    name: "driverSet",
    status: input.driverSet === "mock" ? "PASS" : input.driverSet === "real" ? "FAIL" : "FAIL",
    message:
      input.driverSet === "mock"
        ? "Mock driver set is allowed."
        : input.driverSet === "real"
          ? "Real driver set is not implemented; readiness report only, no hardware access."
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
}): CaptureHelperReadinessCheck[] {
  const armExpected = input.expectedDevices.some((device) => device.role === "armInterlock" && device.required);
  return [
    {
      name: "safety.noHardwareProbe",
      status: "PASS",
      message: "Readiness mode does not open cameras, serial ports, controllers, or SDKs.",
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
      status: input.driverSet === "real" ? "FAIL" : "PASS",
      message:
        input.driverSet === "real"
          ? "Real driver mode is fail-closed until explicit hardware integration is implemented."
          : "Mock driver mode is simulator-only and does not access hardware.",
    },
  ];
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

  const configValidationChecks = configChecks({
    identity,
    driverSet,
    rigMode,
    expectedDevices,
  });
  const calibration = calibrationChecks(expectedDevices, safety, options.pathExists ?? existsSync);
  const safetyGateStatus = safetyGateChecks({ driverSet, expectedDevices, safety });
  const discovery = knownDriverSet ? runCaptureHelperDiscoveryStubs(knownDriverSet) : [];
  const unsupportedRealDriverNotices =
    driverSet === "real"
      ? [
          "Real driverSet is recognized for readiness reporting only.",
          "No real hardware drivers are implemented or imported in this package.",
          "No serial ports, cameras, stages, interlocks, or SDKs are probed.",
        ]
      : [];
  const allChecks = [...configValidationChecks, ...calibration, ...safetyGateStatus];
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
    discovery,
    notes: [
      "Readiness reports validate configuration only.",
      "Device discovery is a stub and does not open hardware or OS device APIs.",
      "Real driver integration remains not implemented and fail-closed.",
    ],
  };
}
