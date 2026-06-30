#!/usr/bin/env node
import path from "node:path";
import {
  CaptureHelperCommandError,
  CaptureHelperConfigError,
  ArduinoLedControllerHealthError,
  GrblStageHealthError,
  buildCaptureHelperReadinessReportAsync,
  createCaptureHelperService,
  parseCaptureHelperManifestMode,
  runArduinoLedControllerHealthCheck,
  runGrblStageHealthCheck,
  type CaptureHelperConfigInput,
  type CaptureHelperEnv,
} from "./index";
import { analyzeDinoLiteExperimentalGradingWorkflow } from "./experimentalGrading";
import {
  DinoLiteBridgeClient,
  DinoLiteBridgeClientError,
  assertDinoLiteCaptureOutputDirAllowed,
  assertDinoLiteSdkRuntimeDirAllowed,
} from "./drivers";
import { startCaptureHelperHttpServer } from "./transport";

export interface CaptureHelperCliIO {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: CaptureHelperEnv;
}

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

type ParsedCommand =
  | { command: "health"; config: CaptureHelperConfigInput }
  | { command: "capabilities"; config: CaptureHelperConfigInput }
  | { command: "readiness"; config: CaptureHelperConfigInput }
  | { command: "led-health"; config: CaptureHelperConfigInput }
  | { command: "stage-health"; config: CaptureHelperConfigInput }
  | { command: "dinolite-bridge-health"; config: CaptureHelperConfigInput }
  | {
      command: "leimac-idmu-readiness" | "leimac-idmu-status";
      config: CaptureHelperConfigInput;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
    }
  | {
      command: "leimac-idmu-read-frame";
      config: CaptureHelperConfigInput;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      leimacFrame: string | undefined;
    }
  | {
      command: "leimac-idmu-trigger-profile" | "leimac-idmu-safe-off";
      config: CaptureHelperConfigInput;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      profile: string | undefined;
      duty: number | undefined;
      triggerActivation: string | undefined;
      apply: boolean;
      confirmation: string | undefined;
    }
  | { command: "leimac-idmu-trigger-sync-plan"; config: CaptureHelperConfigInput; mode: string | undefined }
  | { command: "basler-readiness" | "basler-list-cameras"; config: CaptureHelperConfigInput; pylonRoot: string | undefined; pylonTimeoutMs: number | undefined }
  | {
      command: "basler-line2-exposure-active";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      lineInverter: boolean | undefined;
      apply: boolean;
      confirmation: string | undefined;
    }
  | {
      command: "basler-line2-user-output-pulse";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      lineInverter: boolean | undefined;
      pulseMs: number | undefined;
      idleUserOutputValue: boolean | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
    }
  | {
      command: "basler-capture-still";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      label: string | undefined;
      savedFormat: string | undefined;
      lensModel: string | undefined;
      exposureUs: number | undefined;
    }
  | {
      command: "basler-leimac-sync-smoke";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      profile: string | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      unusedBaslerWiresInsulated: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightNotContinuous: boolean;
    }
  | {
      command: "basler-leimac-polarity-smoke";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      polarityCandidate: string | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
      operatorReportedIdleOn: boolean;
      captureConfirmed: boolean;
    }
  | {
      command: "basler-leimac-image-stat-sync-smoke";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      polarityCandidate: string | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
    }
  | {
      command: "basler-leimac-macro-package";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      profile: string | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
    }
  | {
      command: "ai-grader-full-rig-local-smoke";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      deviceIndex: number | undefined;
      outputDir: string | undefined;
      label: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      plan: string | undefined;
      includeFlcSweep: boolean;
      includeEdr: boolean;
      includeEdof: boolean;
      cornerProfile: string | undefined;
      captureGuides: boolean;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
    }
  | {
      command: "basler-fixed-rig-operator-preview";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacUnit: number | undefined;
      exposureUs: number | undefined;
      gain: number | undefined;
      previewRefreshMs: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      operatorMode: boolean;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
      focusLockedByOperator: boolean;
      resetDefaultLightingProfile: boolean;
    }
  | {
      command: "basler-fixed-rig-focus-assist";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      gain: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
      resetDefaultLightingProfile: boolean;
    }
  | {
      command: "fixed-rig-fixture-calibration" | "fixed-rig-repeatability-test";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      gain: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
      resetDefaultLightingProfile: boolean;
      fixtureLabel: string | undefined;
      fixtureId: string | undefined;
      referenceType: string | undefined;
      referenceWidthMm: number | undefined;
      referenceHeightMm: number | undefined;
      horizontalSpanMm: number | undefined;
      horizontalStartPx: { x: number; y: number } | undefined;
      horizontalEndPx: { x: number; y: number } | undefined;
      verticalSpanMm: number | undefined;
      verticalStartPx: { x: number; y: number } | undefined;
      verticalEndPx: { x: number; y: number } | undefined;
      cardBoundaryRect: { x: number; y: number; width: number; height: number } | undefined;
      operatorNotes: string | undefined;
      operatorAccepted: boolean;
      repeatabilityPhase: "no-touch" | "remove-replace";
      captureCount: number | undefined;
      operatorReplaceConfirmed: boolean;
      operatorReplaceDelayMs: number | undefined;
    }
  | {
      command: "ai-grader-fixed-rig-v1-local" | "ai-grader-fixed-rig-v1-evidence-package";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      gain: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
      operatorFlipConfirmed: boolean;
      operatorFlipDelayMs: number | undefined;
      resetDefaultLightingProfile: boolean;
      evidenceSide: "front" | "back" | "both";
      fixtureLabel: string | undefined;
      fixtureId: string | undefined;
      referenceType: string | undefined;
      referenceWidthMm: number | undefined;
      referenceHeightMm: number | undefined;
      horizontalSpanMm: number | undefined;
      horizontalStartPx: { x: number; y: number } | undefined;
      horizontalEndPx: { x: number; y: number } | undefined;
      verticalSpanMm: number | undefined;
      verticalStartPx: { x: number; y: number } | undefined;
      verticalEndPx: { x: number; y: number } | undefined;
      cardBoundaryRect: { x: number; y: number; width: number; height: number } | undefined;
    }
  | {
      command: "ai-grader-fixed-rig-v1-card-report";
      config: CaptureHelperConfigInput;
      outputDir: string | undefined;
      frontDir: string | undefined;
      backDir: string | undefined;
    }
  | {
      command: "ai-grader-station-operator-workflow";
      config: CaptureHelperConfigInput;
      outputDir: string | undefined;
      frontDir: string | undefined;
      backDir: string | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      gain: number | undefined;
      apply: boolean;
      mockRun: boolean;
      operatorAcceptedWarnings: boolean;
      calibrationProfileId: string | undefined;
      mmPerPixelX: number | undefined;
      mmPerPixelY: number | undefined;
      frontClippedFraction: number | undefined;
      backClippedFraction: number | undefined;
      framingOverlayPass: boolean;
      repeatabilityPass: boolean;
    }
  | { command: "fixed-rig-lighting-profile-plan"; config: CaptureHelperConfigInput }
  | {
      command: "leimac-channel-characterization";
      config: CaptureHelperConfigInput;
      pylonRoot: string | undefined;
      pylonTimeoutMs: number | undefined;
      baslerBridgeScript: string | undefined;
      cameraIndex: number | undefined;
      outputDir: string | undefined;
      leimacHost: string | undefined;
      leimacPort: number | undefined;
      leimacTimeoutMs: number | undefined;
      leimacUnit: number | undefined;
      duty: number | undefined;
      exposureUs: number | undefined;
      gain: number | undefined;
      apply: boolean;
      confirmation: string | undefined;
      markPresent: boolean;
      wiringConfirmed: boolean;
      leimacStatusGreen: boolean;
      operatorConfirmedLightIdleOff: boolean;
    }
  | { command: "dinolite-enumerate"; config: CaptureHelperConfigInput }
  | { command: "dinolite-status"; config: CaptureHelperConfigInput; deviceIndex: number | undefined }
  | { command: "dinolite-capture-still"; config: CaptureHelperConfigInput; deviceIndex: number | undefined; outputDir: string | undefined }
  | {
      command: "dinolite-capture-package" | "dinolite-capture-demo-package";
      config: CaptureHelperConfigInput;
      deviceIndex: number | undefined;
      outputDir: string | undefined;
      label: string | undefined;
      includeLightingSweep: boolean;
      includeEdr: boolean;
      includeEdof: boolean;
    }
  | {
      command: "dinolite-operator-workflow" | "dinolite-experimental-grading-run";
      config: CaptureHelperConfigInput;
      deviceIndex: number | undefined;
      outputDir: string | undefined;
      label: string | undefined;
      plan: string | undefined;
      includeFlcSweep: boolean;
      includeEdr: boolean;
      includeEdof: boolean;
      cornerProfile: string | undefined;
      captureGuides: boolean;
    }
  | { command: "manifest"; config: CaptureHelperConfigInput; mode: string | undefined }
  | { command: "serve"; config: CaptureHelperConfigInput; host: string | undefined; port: string | undefined }
  | { command: "help"; config: CaptureHelperConfigInput };

function readOption(argv: string[], index: number, name: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CaptureHelperCommandError(`${name} requires a value.`);
  }
  return value;
}

function readBooleanOption(argv: string[], index: number, name: string) {
  const value = readOption(argv, index, name).trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  throw new CaptureHelperCommandError(`${name} must be true or false.`);
}

function readPixelPointOption(argv: string[], index: number, name: string): { x: number; y: number } {
  const value = readOption(argv, index, name).trim();
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(value);
  if (!match) {
    throw new CaptureHelperCommandError(`${name} must be formatted as x,y pixel coordinates.`);
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new CaptureHelperCommandError(`${name} must use non-negative finite pixel coordinates.`);
  }
  return { x, y };
}

function readRectOption(argv: string[], index: number, name: string): { x: number; y: number; width: number; height: number } {
  const value = readOption(argv, index, name).trim();
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) {
    throw new CaptureHelperCommandError(`${name} must be formatted as x,y,width,height in raw sensor pixels.`);
  }
  const x = Number(match[1]);
  const y = Number(match[2]);
  const width = Number(match[3]);
  const height = Number(match[4]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new CaptureHelperCommandError(`${name} must use non-negative x/y and positive width/height.`);
  }
  return { x, y, width, height };
}

function parseCliArgs(argv: string[]): ParsedCommand {
  const [command = "help", ...rest] = argv;
  const config: CaptureHelperConfigInput = { simulator: {} };
  let mode: string | undefined;
  let host: string | undefined;
  let port: string | undefined;
  let deviceIndex: number | undefined;
  let outputDir: string | undefined;
  let frontDir: string | undefined;
  let backDir: string | undefined;
  let mockRun = false;
  let operatorAcceptedWarnings = false;
  let calibrationProfileId: string | undefined;
  let mmPerPixelX: number | undefined;
  let mmPerPixelY: number | undefined;
  let frontClippedFraction: number | undefined;
  let backClippedFraction: number | undefined;
  let framingOverlayPass = false;
  let repeatabilityPass = false;
  let sdkRuntimeDir: string | undefined;
  let label: string | undefined;
  let pylonRoot: string | undefined;
  let pylonTimeoutMs: number | undefined;
  let baslerBridgeScript: string | undefined;
  let leimacHost: string | undefined;
  let leimacPort: string | undefined;
  let leimacTimeoutMs: number | undefined;
  let leimacUnit: number | undefined;
  let leimacFrame: string | undefined;
  let cameraIndex: number | undefined;
  let savedFormat: string | undefined;
  let lensModel: string | undefined;
  let plan: string | undefined;
  let profile: string | undefined;
  let duty: number | undefined;
  let exposureUs: number | undefined;
  let gain: number | undefined;
  let previewRefreshMs: number | undefined;
  let lineInverter: boolean | undefined;
  let pulseMs: number | undefined;
  let idleUserOutputValue: boolean | undefined;
  let triggerActivation: string | undefined;
  let polarityCandidate: string | undefined;
  let apply = false;
  let confirmation: string | undefined;
  let markPresent = false;
  let unusedBaslerWiresInsulated = false;
  let wiringConfirmed = false;
  let leimacStatusGreen = false;
  let operatorConfirmedLightNotContinuous = false;
  let operatorConfirmedLightIdleOff = false;
  let operatorReportedIdleOn = false;
  let operatorFlipConfirmed = false;
  let operatorFlipDelayMs: number | undefined;
  let evidenceSide: "front" | "back" | "both" = "both";
  let fixtureLabel: string | undefined;
  let fixtureId: string | undefined;
  let referenceType: string | undefined;
  let referenceWidthMm: number | undefined;
  let referenceHeightMm: number | undefined;
  let horizontalSpanMm: number | undefined;
  let horizontalStartPx: { x: number; y: number } | undefined;
  let horizontalEndPx: { x: number; y: number } | undefined;
  let verticalSpanMm: number | undefined;
  let verticalStartPx: { x: number; y: number } | undefined;
  let verticalEndPx: { x: number; y: number } | undefined;
  let cardBoundaryRect: { x: number; y: number; width: number; height: number } | undefined;
  let operatorNotes: string | undefined;
  let operatorAccepted = false;
  let repeatabilityPhase: "no-touch" | "remove-replace" = "no-touch";
  let captureCount: number | undefined;
  let operatorReplaceConfirmed = false;
  let operatorReplaceDelayMs: number | undefined;
  let captureConfirmed = false;
  let operatorMode = false;
  let focusLockedByOperator = false;
  let resetDefaultLightingProfile = false;
  let includeLightingSweep = false;
  let includeFlcSweep = false;
  let includeEdr = false;
  let includeEdof = false;
  let cornerProfile: string | undefined;
  let captureGuides = true;

  if (command === "--help" || command === "-h") {
    return { command: "help", config };
  }

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    switch (arg) {
      case "--mode":
        mode = readOption(rest, index, "--mode");
        index += 1;
        break;
      case "--session-id":
        config.simulator = { ...config.simulator, captureSessionId: readOption(rest, index, "--session-id") };
        index += 1;
        break;
      case "--tenant-id":
        config.simulator = { ...config.simulator, tenantId: readOption(rest, index, "--tenant-id") };
        index += 1;
        break;
      case "--seed":
        config.simulator = { ...config.simulator, seed: readOption(rest, index, "--seed") };
        index += 1;
        break;
      case "--helper-instance-id":
        config.simulator = { ...config.simulator, helperInstanceId: readOption(rest, index, "--helper-instance-id") };
        index += 1;
        break;
      case "--rig-id":
        config.simulator = { ...config.simulator, rigId: readOption(rest, index, "--rig-id") };
        index += 1;
        break;
      case "--location-id":
        config.simulator = { ...config.simulator, locationId: readOption(rest, index, "--location-id") };
        index += 1;
        break;
      case "--operator-id":
        config.simulator = { ...config.simulator, operatorId: readOption(rest, index, "--operator-id") };
        index += 1;
        break;
      case "--rig-mode":
        config.rigMode = readOption(rest, index, "--rig-mode");
        index += 1;
        break;
      case "--driver-set":
        config.driverSet = readOption(rest, index, "--driver-set");
        index += 1;
        break;
      case "--led-controller":
        config.ledController = { ...config.ledController, kind: readOption(rest, index, "--led-controller") };
        index += 1;
        break;
      case "--stage":
        config.stage = { ...config.stage, kind: readOption(rest, index, "--stage") };
        index += 1;
        break;
      case "--bridge-path":
      case "--bridge-exe":
        config.dinoliteBridge = {
          ...config.dinoliteBridge,
          executablePath: readOption(rest, index, arg),
        };
        index += 1;
        break;
      case "--bridge-adapter":
      case "--adapter":
        config.dinoliteBridge = {
          ...config.dinoliteBridge,
          adapter: readOption(rest, index, arg) as "fake" | "dnvideox",
        };
        index += 1;
        break;
      case "--bridge-timeout-ms":
        config.dinoliteBridge = {
          ...config.dinoliteBridge,
          timeoutMs: Number(readOption(rest, index, "--bridge-timeout-ms")),
        };
        index += 1;
        break;
      case "--sdk-runtime-dir":
        sdkRuntimeDir = readOption(rest, index, "--sdk-runtime-dir");
        config.dinoliteBridge = {
          ...config.dinoliteBridge,
          sdkRuntimeDir,
        };
        index += 1;
        break;
      case "--device-index":
        deviceIndex = Number(readOption(rest, index, "--device-index"));
        if (!Number.isInteger(deviceIndex) || deviceIndex < 0) {
          throw new CaptureHelperCommandError("--device-index must be a non-negative integer.");
        }
        index += 1;
        break;
      case "--output-dir":
        outputDir = readOption(rest, index, "--output-dir");
        index += 1;
        break;
      case "--front-dir":
        frontDir = readOption(rest, index, "--front-dir");
        index += 1;
        break;
      case "--back-dir":
        backDir = readOption(rest, index, "--back-dir");
        index += 1;
        break;
      case "--mock-run":
        mockRun = true;
        break;
      case "--operator-accepted-warnings":
        operatorAcceptedWarnings = true;
        break;
      case "--calibration-profile-id":
        calibrationProfileId = readOption(rest, index, "--calibration-profile-id");
        index += 1;
        break;
      case "--mm-per-pixel-x":
        mmPerPixelX = Number(readOption(rest, index, "--mm-per-pixel-x"));
        if (!Number.isFinite(mmPerPixelX) || mmPerPixelX <= 0) {
          throw new CaptureHelperCommandError("--mm-per-pixel-x must be a positive number.");
        }
        index += 1;
        break;
      case "--mm-per-pixel-y":
        mmPerPixelY = Number(readOption(rest, index, "--mm-per-pixel-y"));
        if (!Number.isFinite(mmPerPixelY) || mmPerPixelY <= 0) {
          throw new CaptureHelperCommandError("--mm-per-pixel-y must be a positive number.");
        }
        index += 1;
        break;
      case "--front-clipped-fraction":
        frontClippedFraction = Number(readOption(rest, index, "--front-clipped-fraction"));
        if (!Number.isFinite(frontClippedFraction) || frontClippedFraction < 0 || frontClippedFraction > 1) {
          throw new CaptureHelperCommandError("--front-clipped-fraction must be from 0 to 1.");
        }
        index += 1;
        break;
      case "--back-clipped-fraction":
        backClippedFraction = Number(readOption(rest, index, "--back-clipped-fraction"));
        if (!Number.isFinite(backClippedFraction) || backClippedFraction < 0 || backClippedFraction > 1) {
          throw new CaptureHelperCommandError("--back-clipped-fraction must be from 0 to 1.");
        }
        index += 1;
        break;
      case "--framing-overlay-pass":
        framingOverlayPass = true;
        break;
      case "--repeatability-pass":
        repeatabilityPass = true;
        break;
      case "--label":
        label = readOption(rest, index, "--label");
        index += 1;
        break;
      case "--pylon-root":
        pylonRoot = readOption(rest, index, "--pylon-root");
        index += 1;
        break;
      case "--bridge-script":
      case "--basler-bridge-script":
        baslerBridgeScript = readOption(rest, index, arg);
        index += 1;
        break;
      case "--pylon-timeout-ms":
        pylonTimeoutMs = Number(readOption(rest, index, "--pylon-timeout-ms"));
        if (!Number.isInteger(pylonTimeoutMs) || pylonTimeoutMs <= 0) {
          throw new CaptureHelperCommandError("--pylon-timeout-ms must be a positive integer.");
        }
        index += 1;
        break;
      case "--timeout-ms":
        leimacTimeoutMs = Number(readOption(rest, index, "--timeout-ms"));
        if (!Number.isInteger(leimacTimeoutMs) || leimacTimeoutMs <= 0) {
          throw new CaptureHelperCommandError("--timeout-ms must be a positive integer.");
        }
        index += 1;
        break;
      case "--unit":
        leimacUnit = Number(readOption(rest, index, "--unit"));
        if (!Number.isInteger(leimacUnit) || leimacUnit < 1 || leimacUnit > 5) {
          throw new CaptureHelperCommandError("--unit must be an integer from 1 to 5.");
        }
        index += 1;
        break;
      case "--frame":
        leimacFrame = readOption(rest, index, "--frame");
        index += 1;
        break;
      case "--profile":
        profile = readOption(rest, index, "--profile");
        index += 1;
        break;
      case "--duty":
      case "--basler-duty":
        duty = Number(readOption(rest, index, "--duty"));
        if (!Number.isFinite(duty) || duty < 0) {
          throw new CaptureHelperCommandError("--duty must be a non-negative number.");
        }
        index += 1;
        break;
      case "--exposure-us":
      case "--basler-exposure-us":
        exposureUs = Number(readOption(rest, index, arg));
        if (!Number.isInteger(exposureUs) || exposureUs <= 0) {
          throw new CaptureHelperCommandError("--exposure-us must be a positive integer.");
        }
        index += 1;
        break;
      case "--gain":
      case "--basler-gain":
        gain = Number(readOption(rest, index, arg));
        if (!Number.isFinite(gain) || gain < 0) {
          throw new CaptureHelperCommandError("--gain must be a non-negative number.");
        }
        index += 1;
        break;
      case "--preview-refresh-ms":
        previewRefreshMs = Number(readOption(rest, index, "--preview-refresh-ms"));
        if (!Number.isInteger(previewRefreshMs) || previewRefreshMs < 250 || previewRefreshMs > 5000) {
          throw new CaptureHelperCommandError("--preview-refresh-ms must be an integer from 250 to 5000.");
        }
        index += 1;
        break;
      case "--line-inverter":
        lineInverter = readBooleanOption(rest, index, "--line-inverter");
        index += 1;
        break;
      case "--pulse-ms":
        pulseMs = Number(readOption(rest, index, "--pulse-ms"));
        if (!Number.isInteger(pulseMs) || pulseMs <= 0) {
          throw new CaptureHelperCommandError("--pulse-ms must be a positive integer.");
        }
        index += 1;
        break;
      case "--idle-user-output-value":
        idleUserOutputValue = readBooleanOption(rest, index, "--idle-user-output-value");
        index += 1;
        break;
      case "--trigger-activation":
        triggerActivation = readOption(rest, index, "--trigger-activation");
        index += 1;
        break;
      case "--polarity-candidate":
      case "--candidate":
        polarityCandidate = readOption(rest, index, arg);
        index += 1;
        break;
      case "--apply":
        apply = true;
        break;
      case "--confirm":
        confirmation = readOption(rest, index, "--confirm");
        index += 1;
        break;
      case "--mark-present":
        markPresent = true;
        break;
      case "--unused-basler-wires-insulated":
        unusedBaslerWiresInsulated = true;
        break;
      case "--wiring-confirmed":
        wiringConfirmed = true;
        break;
      case "--leimac-status-green":
        leimacStatusGreen = true;
        break;
      case "--operator-confirmed-light-not-continuous":
        operatorConfirmedLightNotContinuous = true;
        break;
      case "--operator-confirmed-light-idle-off":
        operatorConfirmedLightIdleOff = true;
        break;
      case "--operator-flip-confirmed":
        operatorFlipConfirmed = true;
        break;
      case "--operator-flip-delay-ms":
        operatorFlipDelayMs = Number(readOption(rest, index, "--operator-flip-delay-ms"));
        if (!Number.isInteger(operatorFlipDelayMs) || operatorFlipDelayMs < 0 || operatorFlipDelayMs > 300000) {
          throw new CaptureHelperCommandError("--operator-flip-delay-ms must be an integer from 0 to 300000.");
        }
        index += 1;
        break;
      case "--evidence-side": {
        const value = readOption(rest, index, "--evidence-side");
        if (value !== "front" && value !== "back" && value !== "both") {
          throw new CaptureHelperCommandError("--evidence-side must be front, back, or both.");
        }
        evidenceSide = value;
        index += 1;
        break;
      }
      case "--fixture-label":
        fixtureLabel = readOption(rest, index, "--fixture-label");
        index += 1;
        break;
      case "--fixture-id":
        fixtureId = readOption(rest, index, "--fixture-id");
        index += 1;
        break;
      case "--reference-type": {
        const value = readOption(rest, index, "--reference-type");
        const allowed = ["card_dimensions", "fixed_metric_rulers", "metric_ruler", "cutting_mat", "measurement_board", "certified_target", "unknown"];
        if (!allowed.includes(value)) {
          throw new CaptureHelperCommandError("--reference-type must be card_dimensions, fixed_metric_rulers, metric_ruler, cutting_mat, measurement_board, certified_target, or unknown.");
        }
        referenceType = value;
        index += 1;
        break;
      }
      case "--reference-width-mm":
        referenceWidthMm = Number(readOption(rest, index, "--reference-width-mm"));
        if (!Number.isFinite(referenceWidthMm) || referenceWidthMm <= 0 || referenceWidthMm > 500) {
          throw new CaptureHelperCommandError("--reference-width-mm must be from 0 to 500.");
        }
        index += 1;
        break;
      case "--reference-height-mm":
        referenceHeightMm = Number(readOption(rest, index, "--reference-height-mm"));
        if (!Number.isFinite(referenceHeightMm) || referenceHeightMm <= 0 || referenceHeightMm > 500) {
          throw new CaptureHelperCommandError("--reference-height-mm must be from 0 to 500.");
        }
        index += 1;
        break;
      case "--horizontal-span-mm":
        horizontalSpanMm = Number(readOption(rest, index, "--horizontal-span-mm"));
        if (!Number.isFinite(horizontalSpanMm) || horizontalSpanMm <= 0 || horizontalSpanMm > 1000) {
          throw new CaptureHelperCommandError("--horizontal-span-mm must be from 0 to 1000.");
        }
        index += 1;
        break;
      case "--horizontal-start-px":
        horizontalStartPx = readPixelPointOption(rest, index, "--horizontal-start-px");
        index += 1;
        break;
      case "--horizontal-end-px":
        horizontalEndPx = readPixelPointOption(rest, index, "--horizontal-end-px");
        index += 1;
        break;
      case "--vertical-span-mm":
        verticalSpanMm = Number(readOption(rest, index, "--vertical-span-mm"));
        if (!Number.isFinite(verticalSpanMm) || verticalSpanMm <= 0 || verticalSpanMm > 1000) {
          throw new CaptureHelperCommandError("--vertical-span-mm must be from 0 to 1000.");
        }
        index += 1;
        break;
      case "--vertical-start-px":
        verticalStartPx = readPixelPointOption(rest, index, "--vertical-start-px");
        index += 1;
        break;
      case "--vertical-end-px":
        verticalEndPx = readPixelPointOption(rest, index, "--vertical-end-px");
        index += 1;
        break;
      case "--card-boundary-rect":
        cardBoundaryRect = readRectOption(rest, index, "--card-boundary-rect");
        index += 1;
        break;
      case "--operator-notes":
        operatorNotes = readOption(rest, index, "--operator-notes");
        index += 1;
        break;
      case "--operator-accepted":
        operatorAccepted = true;
        break;
      case "--repeatability-phase": {
        const value = readOption(rest, index, "--repeatability-phase");
        if (value !== "no-touch" && value !== "remove-replace") {
          throw new CaptureHelperCommandError("--repeatability-phase must be no-touch or remove-replace.");
        }
        repeatabilityPhase = value;
        index += 1;
        break;
      }
      case "--capture-count":
        captureCount = Number(readOption(rest, index, "--capture-count"));
        if (!Number.isInteger(captureCount) || captureCount < 1 || captureCount > 20) {
          throw new CaptureHelperCommandError("--capture-count must be an integer from 1 to 20.");
        }
        index += 1;
        break;
      case "--operator-replace-confirmed":
        operatorReplaceConfirmed = true;
        break;
      case "--operator-replace-delay-ms":
        operatorReplaceDelayMs = Number(readOption(rest, index, "--operator-replace-delay-ms"));
        if (!Number.isInteger(operatorReplaceDelayMs) || operatorReplaceDelayMs < 0 || operatorReplaceDelayMs > 300000) {
          throw new CaptureHelperCommandError("--operator-replace-delay-ms must be an integer from 0 to 300000.");
        }
        index += 1;
        break;
      case "--operator-reported-idle-on":
        operatorReportedIdleOn = true;
        break;
      case "--capture-confirmed":
        captureConfirmed = true;
        break;
      case "--operator-mode":
        operatorMode = true;
        break;
      case "--focus-locked-by-operator":
        focusLockedByOperator = true;
        break;
      case "--reset-default-lighting-profile":
        resetDefaultLightingProfile = true;
        break;
      case "--camera-index":
        cameraIndex = Number(readOption(rest, index, "--camera-index"));
        if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
          throw new CaptureHelperCommandError("--camera-index must be a non-negative integer.");
        }
        index += 1;
        break;
      case "--format":
        savedFormat = readOption(rest, index, "--format");
        index += 1;
        break;
      case "--lens-model":
        lensModel = readOption(rest, index, "--lens-model");
        index += 1;
        break;
      case "--plan":
      case "--dinolite-plan":
        plan = readOption(rest, index, arg);
        index += 1;
        break;
      case "--include-dark-control":
        break;
      case "--corner-profile":
        cornerProfile = readOption(rest, index, "--corner-profile");
        index += 1;
        break;
      case "--capture-guides":
        captureGuides = readBooleanOption(rest, index, "--capture-guides");
        index += 1;
        break;
      case "--include-lighting-sweep":
        includeLightingSweep = true;
        break;
      case "--include-flc-sweep":
        includeFlcSweep = true;
        break;
      case "--include-edr":
        includeEdr = true;
        break;
      case "--include-edof":
        includeEdof = true;
        break;
      case "--led-port":
        config.ledController = {
          ...config.ledController,
          arduino: {
            ...config.ledController?.arduino,
            port: readOption(rest, index, "--led-port"),
          },
        };
        index += 1;
        break;
      case "--stage-port":
        config.stage = {
          ...config.stage,
          grbl: {
            ...config.stage?.grbl,
            port: readOption(rest, index, "--stage-port"),
          },
        };
        index += 1;
        break;
      case "--baud":
        if (command === "stage-health") {
          config.stage = {
            ...config.stage,
            kind: "grbl",
            grbl: {
              ...config.stage?.grbl,
              baudRate: readOption(rest, index, "--baud"),
            },
          };
        } else {
          config.ledController = {
            ...config.ledController,
            arduino: {
              ...config.ledController?.arduino,
              baudRate: readOption(rest, index, "--baud"),
            },
          };
        }
        index += 1;
        break;
      case "--stage-baud":
        config.stage = {
          ...config.stage,
          grbl: {
            ...config.stage?.grbl,
            baudRate: readOption(rest, index, "--stage-baud"),
          },
        };
        index += 1;
        break;
      case "--command-timeout-ms":
        if (command === "stage-health") {
          config.stage = {
            ...config.stage,
            kind: "grbl",
            grbl: {
              ...config.stage?.grbl,
              commandTimeoutMs: readOption(rest, index, "--command-timeout-ms"),
            },
          };
        } else {
          config.ledController = {
            ...config.ledController,
            arduino: {
              ...config.ledController?.arduino,
              commandTimeoutMs: readOption(rest, index, "--command-timeout-ms"),
            },
          };
        }
        index += 1;
        break;
      case "--stage-command-timeout-ms":
        config.stage = {
          ...config.stage,
          grbl: {
            ...config.stage?.grbl,
            commandTimeoutMs: readOption(rest, index, "--stage-command-timeout-ms"),
          },
        };
        index += 1;
        break;
      case "--open-timeout-ms":
        if (command === "stage-health") {
          config.stage = {
            ...config.stage,
            kind: "grbl",
            grbl: {
              ...config.stage?.grbl,
              openTimeoutMs: readOption(rest, index, "--open-timeout-ms"),
            },
          };
        } else {
          config.ledController = {
            ...config.ledController,
            arduino: {
              ...config.ledController?.arduino,
              openTimeoutMs: readOption(rest, index, "--open-timeout-ms"),
            },
          };
        }
        index += 1;
        break;
      case "--stage-open-timeout-ms":
        config.stage = {
          ...config.stage,
          grbl: {
            ...config.stage?.grbl,
            openTimeoutMs: readOption(rest, index, "--stage-open-timeout-ms"),
          },
        };
        index += 1;
        break;
      case "--close-timeout-ms":
        if (command === "stage-health") {
          config.stage = {
            ...config.stage,
            kind: "grbl",
            grbl: {
              ...config.stage?.grbl,
              closeTimeoutMs: readOption(rest, index, "--close-timeout-ms"),
            },
          };
        } else {
          config.ledController = {
            ...config.ledController,
            arduino: {
              ...config.ledController?.arduino,
              closeTimeoutMs: readOption(rest, index, "--close-timeout-ms"),
            },
          };
        }
        index += 1;
        break;
      case "--stage-close-timeout-ms":
        config.stage = {
          ...config.stage,
          grbl: {
            ...config.stage?.grbl,
            closeTimeoutMs: readOption(rest, index, "--stage-close-timeout-ms"),
          },
        };
        index += 1;
        break;
      case "--macro-calibration-path":
        config.calibrationPaths = { ...config.calibrationPaths, macroCamera: readOption(rest, index, "--macro-calibration-path") };
        index += 1;
        break;
      case "--led-calibration-path":
        config.calibrationPaths = { ...config.calibrationPaths, ledController: readOption(rest, index, "--led-calibration-path") };
        index += 1;
        break;
      case "--microscope-calibration-path":
        config.calibrationPaths = { ...config.calibrationPaths, microscope: readOption(rest, index, "--microscope-calibration-path") };
        index += 1;
        break;
      case "--stage-calibration-path":
        config.calibrationPaths = { ...config.calibrationPaths, stage: readOption(rest, index, "--stage-calibration-path") };
        index += 1;
        break;
      case "--arm-calibration-path":
        config.calibrationPaths = { ...config.calibrationPaths, armInterlock: readOption(rest, index, "--arm-calibration-path") };
        index += 1;
        break;
      case "--arm-interlock-required":
        config.safety = { ...config.safety, armInterlockRequired: readBooleanOption(rest, index, "--arm-interlock-required") };
        index += 1;
        break;
      case "--require-calibration-artifacts":
        config.safety = { ...config.safety, requireCalibrationArtifacts: readBooleanOption(rest, index, "--require-calibration-artifacts") };
        index += 1;
        break;
      case "--host":
        host = readOption(rest, index, "--host");
        index += 1;
        break;
      case "--leimac-host":
        leimacHost = readOption(rest, index, "--leimac-host");
        index += 1;
        break;
      case "--leimac-port":
        leimacPort = readOption(rest, index, "--leimac-port");
        index += 1;
        break;
      case "--port":
        if (command === "led-health") {
          config.ledController = {
            ...config.ledController,
            kind: "arduino",
            arduino: {
              ...config.ledController?.arduino,
              port: readOption(rest, index, "--port"),
            },
          };
        } else if (command === "stage-health") {
          config.stage = {
            ...config.stage,
            kind: "grbl",
            grbl: {
              ...config.stage?.grbl,
              port: readOption(rest, index, "--port"),
            },
          };
        } else {
          port = readOption(rest, index, "--port");
        }
        index += 1;
        break;
      case "--help":
      case "-h":
        return { command: "help", config };
      default:
        throw new CaptureHelperCommandError(`Unknown option: ${arg}`);
    }
  }

  if (
    command === "health" ||
    command === "capabilities" ||
    command === "readiness" ||
    command === "led-health" ||
    command === "stage-health" ||
    command === "dinolite-bridge-health" ||
    command === "leimac-idmu-readiness" ||
    command === "leimac-idmu-status" ||
    command === "leimac-idmu-read-frame" ||
    command === "leimac-idmu-trigger-profile" ||
    command === "leimac-idmu-safe-off" ||
    command === "leimac-idmu-trigger-sync-plan" ||
    command === "basler-readiness" ||
    command === "basler-list-cameras" ||
    command === "basler-line2-exposure-active" ||
    command === "basler-line2-user-output-pulse" ||
    command === "basler-capture-still" ||
    command === "basler-leimac-sync-smoke" ||
    command === "basler-leimac-polarity-smoke" ||
    command === "basler-leimac-image-stat-sync-smoke" ||
    command === "basler-leimac-macro-package" ||
    command === "ai-grader-full-rig-local-smoke" ||
    command === "basler-fixed-rig-operator-preview" ||
    command === "basler-fixed-rig-focus-assist" ||
    command === "fixed-rig-fixture-calibration" ||
    command === "fixed-rig-repeatability-test" ||
    command === "ai-grader-fixed-rig-v1-local" ||
    command === "ai-grader-fixed-rig-v1-evidence-package" ||
    command === "ai-grader-fixed-rig-v1-card-report" ||
    command === "ai-grader-station-operator-workflow" ||
    command === "fixed-rig-lighting-profile-plan" ||
    command === "leimac-channel-characterization" ||
    command === "dinolite-enumerate" ||
    command === "dinolite-status" ||
    command === "dinolite-capture-still" ||
    command === "dinolite-capture-package" ||
    command === "dinolite-capture-demo-package" ||
    command === "dinolite-operator-workflow" ||
    command === "dinolite-experimental-grading-run" ||
    command === "manifest" ||
    command === "serve" ||
    command === "help"
  ) {
    if (command === "manifest") return { command, config, mode };
    if (command === "serve") return { command, config, host, port };
    if (command === "leimac-idmu-trigger-sync-plan") return { command, config, mode };
    if (
      command === "leimac-idmu-readiness" ||
      command === "leimac-idmu-status" ||
      command === "leimac-idmu-read-frame" ||
      command === "leimac-idmu-trigger-profile" ||
      command === "leimac-idmu-safe-off"
    ) {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--port must be a positive integer.");
      }
      if (command === "leimac-idmu-read-frame") {
        return { command, config, leimacHost: leimacHostValue, leimacPort: parsedLeimacPort, leimacTimeoutMs, leimacUnit, leimacFrame };
      }
      if (command === "leimac-idmu-trigger-profile" || command === "leimac-idmu-safe-off") {
        return {
          command,
          config,
          leimacHost: leimacHostValue,
          leimacPort: parsedLeimacPort,
          leimacTimeoutMs,
          leimacUnit,
          profile,
          duty,
          triggerActivation,
          apply,
          confirmation,
        };
      }
      return { command, config, leimacHost: leimacHostValue, leimacPort: parsedLeimacPort, leimacTimeoutMs, leimacUnit };
    }
    if (command === "basler-readiness" || command === "basler-list-cameras") return { command, config, pylonRoot, pylonTimeoutMs };
    if (command === "basler-line2-exposure-active") {
      return { command, config, pylonRoot, pylonTimeoutMs, baslerBridgeScript, cameraIndex, lineInverter, apply, confirmation };
    }
    if (command === "basler-line2-user-output-pulse") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        lineInverter,
        pulseMs,
        idleUserOutputValue,
        apply,
        confirmation,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
      };
    }
    if (command === "basler-capture-still") {
      return { command, config, pylonRoot, pylonTimeoutMs, cameraIndex, outputDir, label, savedFormat, lensModel, exposureUs };
    }
    if (command === "basler-leimac-sync-smoke") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        outputDir,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        profile,
        duty,
        exposureUs,
        apply,
        confirmation,
        markPresent,
        unusedBaslerWiresInsulated,
        leimacStatusGreen,
        operatorConfirmedLightNotContinuous,
      };
    }
    if (command === "basler-leimac-polarity-smoke") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        outputDir,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        polarityCandidate,
        duty,
        exposureUs,
        apply,
        confirmation,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
        operatorConfirmedLightIdleOff,
        operatorReportedIdleOn,
        captureConfirmed,
      };
    }
    if (command === "basler-leimac-image-stat-sync-smoke") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        outputDir,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        polarityCandidate,
        duty,
        exposureUs,
        apply,
        confirmation,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
        operatorConfirmedLightIdleOff,
      };
    }
    if (command === "basler-leimac-macro-package") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        outputDir,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        profile,
        duty,
        exposureUs,
        apply,
        confirmation,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
        operatorConfirmedLightIdleOff,
      };
    }
    if (command === "ai-grader-full-rig-local-smoke") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        deviceIndex,
        outputDir,
        label,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        duty,
        exposureUs,
        plan,
        includeFlcSweep,
        includeEdr,
        includeEdof,
        cornerProfile,
        captureGuides,
        apply,
        confirmation,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
        operatorConfirmedLightIdleOff,
      };
    }
    if (command === "basler-fixed-rig-operator-preview") {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        outputDir,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacUnit,
        exposureUs,
        gain,
        previewRefreshMs,
        apply,
        confirmation,
        operatorMode,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
        operatorConfirmedLightIdleOff,
        focusLockedByOperator,
        resetDefaultLightingProfile,
      };
    }
    if (
      command === "basler-fixed-rig-focus-assist" ||
      command === "fixed-rig-fixture-calibration" ||
      command === "fixed-rig-repeatability-test" ||
      command === "ai-grader-fixed-rig-v1-local" ||
      command === "ai-grader-fixed-rig-v1-evidence-package" ||
      command === "leimac-channel-characterization"
    ) {
      const leimacHostValue = leimacHost ?? host;
      const leimacPortValue = leimacPort ?? port;
      const parsedLeimacPort = leimacPortValue === undefined ? undefined : Number(leimacPortValue);
      if (parsedLeimacPort !== undefined && (!Number.isInteger(parsedLeimacPort) || parsedLeimacPort <= 0)) {
        throw new CaptureHelperCommandError("--leimac-port must be a positive integer.");
      }
      if (command === "basler-fixed-rig-focus-assist") {
        return {
          command,
          config,
          pylonRoot,
          pylonTimeoutMs,
          baslerBridgeScript,
          cameraIndex,
          outputDir,
          leimacHost: leimacHostValue,
          leimacPort: parsedLeimacPort,
          leimacTimeoutMs,
          leimacUnit,
          duty,
          exposureUs,
          gain,
          apply,
          confirmation,
          markPresent,
          wiringConfirmed,
          leimacStatusGreen,
          operatorConfirmedLightIdleOff,
          resetDefaultLightingProfile,
        };
      }
      if (command === "fixed-rig-fixture-calibration" || command === "fixed-rig-repeatability-test") {
        return {
          command,
          config,
          pylonRoot,
          pylonTimeoutMs,
          baslerBridgeScript,
          cameraIndex,
          outputDir,
          leimacHost: leimacHostValue,
          leimacPort: parsedLeimacPort,
          leimacTimeoutMs,
          leimacUnit,
          duty,
          exposureUs,
          gain,
          apply,
          confirmation,
          markPresent,
          wiringConfirmed,
          leimacStatusGreen,
          operatorConfirmedLightIdleOff,
          resetDefaultLightingProfile,
          fixtureLabel,
          fixtureId,
          referenceType,
          referenceWidthMm,
          referenceHeightMm,
          horizontalSpanMm,
          horizontalStartPx,
          horizontalEndPx,
          verticalSpanMm,
          verticalStartPx,
          verticalEndPx,
          cardBoundaryRect,
          operatorNotes,
          operatorAccepted,
          repeatabilityPhase,
          captureCount,
          operatorReplaceConfirmed,
          operatorReplaceDelayMs,
        };
      }
      if (command === "leimac-channel-characterization") {
        return {
          command,
          config,
          pylonRoot,
          pylonTimeoutMs,
          baslerBridgeScript,
          cameraIndex,
          outputDir,
          leimacHost: leimacHostValue,
          leimacPort: parsedLeimacPort,
          leimacTimeoutMs,
          leimacUnit,
          duty,
          exposureUs,
          gain,
          apply,
          confirmation,
          markPresent,
          wiringConfirmed,
          leimacStatusGreen,
          operatorConfirmedLightIdleOff,
        };
      }
      return {
        command,
        config,
        pylonRoot,
        pylonTimeoutMs,
        baslerBridgeScript,
        cameraIndex,
        outputDir,
        leimacHost: leimacHostValue,
        leimacPort: parsedLeimacPort,
        leimacTimeoutMs,
        leimacUnit,
        duty,
        exposureUs,
        gain,
        apply,
        confirmation,
        markPresent,
        wiringConfirmed,
        leimacStatusGreen,
        operatorConfirmedLightIdleOff,
        operatorFlipConfirmed,
        operatorFlipDelayMs,
        resetDefaultLightingProfile,
        evidenceSide,
        fixtureLabel,
        fixtureId,
        referenceType,
        referenceWidthMm,
        referenceHeightMm,
        horizontalSpanMm,
        horizontalStartPx,
        horizontalEndPx,
        verticalSpanMm,
        verticalStartPx,
        verticalEndPx,
        cardBoundaryRect,
      };
    }
    if (command === "fixed-rig-lighting-profile-plan") return { command, config };
    if (command === "ai-grader-fixed-rig-v1-card-report") return { command, config, outputDir, frontDir, backDir };
    if (command === "ai-grader-station-operator-workflow") {
      return {
        command,
        config,
        outputDir,
        frontDir,
        backDir,
        duty,
        exposureUs,
        gain,
        apply,
        mockRun,
        operatorAcceptedWarnings,
        calibrationProfileId,
        mmPerPixelX,
        mmPerPixelY,
        frontClippedFraction,
        backClippedFraction,
        framingOverlayPass,
        repeatabilityPass,
      };
    }
    if (command === "dinolite-status") return { command, config, deviceIndex };
    if (command === "dinolite-capture-still") return { command, config, deviceIndex, outputDir };
    if (command === "dinolite-capture-package" || command === "dinolite-capture-demo-package") {
      return { command, config, deviceIndex, outputDir, label, includeLightingSweep, includeEdr, includeEdof };
    }
    if (command === "dinolite-operator-workflow" || command === "dinolite-experimental-grading-run") {
      return { command, config, deviceIndex, outputDir, label, plan, includeFlcSweep, includeEdr, includeEdof, cornerProfile, captureGuides };
    }
    return { command, config };
  }
  throw new CaptureHelperCommandError(`Unknown command: ${command}`);
}

function helpPayload() {
  return {
    service: "ai-grader-capture-helper",
    commands: [
      "health",
      "readiness",
      "led-health --port <serial-port> --baud 115200",
      "stage-health --port <serial-port> --baud 115200",
      "leimac-idmu-readiness --host <ip-address> --port 1000 --timeout-ms 1500",
      "leimac-idmu-status --host <ip-address> --port 1000 --timeout-ms 1500",
      "leimac-idmu-read-frame --host <ip-address> --port 1000 --frame R0801 --timeout-ms 2000",
      "leimac-idmu-trigger-sync-plan --mode basler-exposure-active-to-trg-in1",
      "leimac-idmu-trigger-profile --host 169.254.191.156 --port 1000 --profile basler-line2-trg-in1-low-duty --duty 5 --trigger-activation LevelLow",
      "leimac-idmu-trigger-profile --host 169.254.191.156 --port 1000 --profile basler-line2-trg-in1-low-duty --duty 5 --trigger-activation LevelHigh --apply --confirm \"APPLY LEIMAC LOW DUTY TRIGGER PROFILE\"",
      "leimac-idmu-safe-off --host 169.254.191.156 --port 1000 --apply --confirm \"APPLY LEIMAC SAFE OFF\"",
      "dinolite-bridge-health --bridge-path <exe> --bridge-adapter fake",
      "dinolite-enumerate --bridge-exe <exe> --adapter dnvideox",
      "dinolite-status --bridge-exe <exe> --adapter dnvideox --device-index 0",
      "dinolite-capture-still --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-smoke",
      "dinolite-capture-package --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-packages --label card-demo-001 --sdk-runtime-dir C:\\TenKings\\sdk\\dino-lite\\dnvideox-sdk --include-lighting-sweep --include-edr --include-edof",
      "dinolite-capture-demo-package --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-demo --label card-demo-001 --sdk-runtime-dir C:\\TenKings\\sdk\\dino-lite\\dnvideox-sdk",
      "dinolite-operator-workflow --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-operator --plan card-interim --sdk-runtime-dir C:\\TenKings\\sdk\\dino-lite\\dnvideox-sdk",
      "dinolite-experimental-grading-run --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-grading-runs --label <label> --sdk-runtime-dir C:\\TenKings\\sdk\\dino-lite\\dnvideox-sdk --corner-profile sharp_90 --capture-guides true",
      "basler-readiness --pylon-root C:\\Program Files\\Basler\\pylon",
      "basler-list-cameras --pylon-root C:\\Program Files\\Basler\\pylon",
      "basler-line2-exposure-active --bridge-script packages\\ai-grader-capture-helper\\scripts\\basler-pylon-bridge.ps1 --line-inverter false",
      "basler-line2-exposure-active --line-inverter false --apply --confirm \"APPLY BASLER LINE2 EXPOSURE ACTIVE\"",
      "basler-line2-user-output-pulse --leimac-host 169.254.191.156 --pulse-ms 500 --line-inverter true --apply --confirm \"RUN BASLER LINE2 USER OUTPUT PULSE\" --mark-present --wiring-confirmed --leimac-status-green",
      "basler-capture-still --output-dir C:\\TenKings\\capture-data\\basler-smoke --label <label> --format png",
      "basler-leimac-sync-smoke --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\basler-leimac-sync --duty 5 --exposure-us 5000 --apply --confirm \"RUN SUPERVISED BASLER LEIMAC SYNC SMOKE\" --mark-present --unused-basler-wires-insulated --leimac-status-green --operator-confirmed-light-not-continuous",
      "basler-leimac-polarity-smoke --leimac-host 169.254.191.156 --leimac-port 1000 --duty 1 --exposure-us 5000",
      "basler-leimac-polarity-smoke --leimac-host 169.254.191.156 --leimac-port 1000 --candidate line2-no-inverter-level-high --duty 1 --apply --confirm \"RUN SUPERVISED BASLER LEIMAC POLARITY SMOKE\" --mark-present --wiring-confirmed --leimac-status-green",
      "basler-leimac-polarity-smoke --leimac-host 169.254.191.156 --leimac-port 1000 --candidate line2-no-inverter-level-high --output-dir C:\\TenKings\\capture-data\\basler-leimac-sync --duty 1 --exposure-us 5000 --apply --confirm \"RUN SUPERVISED BASLER LEIMAC POLARITY SMOKE\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off --capture-confirmed",
      "basler-leimac-image-stat-sync-smoke --leimac-host 169.254.191.156 --leimac-port 1000 --candidate line2-inverter-level-low --output-dir C:\\TenKings\\capture-data\\basler-leimac-sync --duty 3 --exposure-us 50000 --apply --confirm \"RUN SUPERVISED BASLER LEIMAC IMAGE STAT SYNC SMOKE\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "basler-leimac-macro-package --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\full-rig-smoke --profile line2-inverter-level-low --duty 5 --exposure-us 50000 --include-dark-control --apply --confirm \"RUN BASLER LEIMAC MACRO PACKAGE\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "ai-grader-full-rig-local-smoke --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\full-rig-smoke --basler-duty 5 --basler-exposure-us 50000 --dinolite-plan experimental-card-grading --bridge-exe <exe> --adapter dnvideox --device-index 0 --apply --confirm \"RUN AI GRADER FULL RIG LOCAL SMOKE\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "fixed-rig-lighting-profile-plan",
      "basler-fixed-rig-operator-preview --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-calibration --exposure-us 45000 --gain 0 --preview-refresh-ms 500 --operator-mode --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off --apply --confirm \"RUN BASLER FIXED RIG OPERATOR PREVIEW\"",
      "basler-fixed-rig-focus-assist --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-v1 --duty 5 --exposure-us 50000 --apply --confirm \"RUN BASLER FIXED RIG FOCUS ASSIST\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "fixed-rig-fixture-calibration --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-calibration --exposure-us 45000 --reference-type fixed_metric_rulers --horizontal-span-mm 50 --horizontal-start-px 100,100 --horizontal-end-px 1100,100 --vertical-span-mm 50 --vertical-start-px 100,100 --vertical-end-px 100,1100 --fixture-label fixed-v1-l-stop --operator-accepted --apply --confirm \"RUN FIXED RIG ROUGH FIXTURE CALIBRATION\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "fixed-rig-repeatability-test --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-calibration --repeatability-phase no-touch --capture-count 5 --exposure-us 45000 --apply --confirm \"RUN FIXED RIG REPEATABILITY TEST\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "ai-grader-fixed-rig-v1-local --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-v1 --duty 5 --exposure-us 50000 --apply --confirm \"RUN AI GRADER FIXED RIG V1 LOCAL\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off --operator-flip-confirmed --operator-flip-delay-ms 30000",
      "ai-grader-fixed-rig-v1-evidence-package --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-v1 --evidence-side front --exposure-us 45000 --apply --confirm \"RUN FIXED RIG V1 UNCALIBRATED EVIDENCE PACKAGE\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "ai-grader-fixed-rig-v1-evidence-package --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-v1 --evidence-side back --exposure-us 45000 --apply --confirm \"RUN FIXED RIG V1 UNCALIBRATED EVIDENCE PACKAGE\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off --operator-flip-confirmed",
      "ai-grader-fixed-rig-v1-card-report --output-dir C:\\TenKings\\capture-data\\fixed-rig-v1 --front-dir <front-evidence-package-dir> --back-dir <back-evidence-package-dir>",
      "ai-grader-station-operator-workflow --output-dir C:\\TenKings\\capture-data\\ai-grader-station --mock-run --duty 1.2 --exposure-us 45000 --front-clipped-fraction 0.107932 --back-clipped-fraction 0.337672 --calibration-profile-id fixed-ruler-pr39 --framing-overlay-pass --repeatability-pass --front-dir <front-evidence-package-dir> --back-dir <back-evidence-package-dir>",
      "leimac-channel-characterization --leimac-host 169.254.191.156 --leimac-port 1000 --output-dir C:\\TenKings\\capture-data\\fixed-rig-calibration --duty 1 --exposure-us 45000 --apply --confirm \"RUN LEIMAC CHANNEL CHARACTERIZATION\" --mark-present --wiring-confirmed --leimac-status-green --operator-confirmed-light-idle-off",
      "capabilities",
      "manifest --mode QUICK|STANDARD|AUTH_ONLY",
      "serve --host 127.0.0.1 --port 47650",
    ],
    options: [
      "--session-id",
      "--tenant-id",
      "--rig-id",
      "--location-id",
      "--operator-id",
      "--seed",
      "--helper-instance-id",
      "--driver-set mock|real",
      "--rig-mode simulator|readiness",
      "--led-controller arduino",
      "--stage grbl",
      "--bridge-path",
      "--bridge-exe",
      "--bridge-adapter fake|dnvideox",
      "--adapter fake|dnvideox",
      "--bridge-timeout-ms",
      "--sdk-runtime-dir",
      "--device-index",
      "--output-dir",
      "--label",
      "--pylon-root",
      "--bridge-script",
      "--basler-bridge-script",
      "--pylon-timeout-ms",
      "--timeout-ms",
      "--unit",
      "--frame",
      "--profile",
      "--duty",
      "--exposure-us",
      "--line-inverter true|false",
      "--pulse-ms 250..500",
      "--idle-user-output-value true|false",
      "--trigger-activation LevelLow|LevelHigh",
      "--polarity-candidate",
      "--candidate",
      "--apply",
      "--confirm",
      "--mark-present",
      "--unused-basler-wires-insulated",
      "--wiring-confirmed",
      "--leimac-status-green",
      "--operator-confirmed-light-not-continuous",
      "--operator-confirmed-light-idle-off",
      "--operator-reported-idle-on",
      "--capture-confirmed",
      "--operator-flip-confirmed",
      "--operator-flip-delay-ms 0..300000",
      "--evidence-side front|back|both",
      "--fixture-label",
      "--fixture-id",
      "--reference-type card_dimensions|fixed_metric_rulers|metric_ruler|cutting_mat|measurement_board|certified_target|unknown",
      "--reference-width-mm",
      "--reference-height-mm",
      "--horizontal-span-mm",
      "--horizontal-start-px x,y",
      "--horizontal-end-px x,y",
      "--vertical-span-mm",
      "--vertical-start-px x,y",
      "--vertical-end-px x,y",
      "--card-boundary-rect x,y,width,height",
      "--operator-notes",
      "--operator-accepted",
      "--repeatability-phase no-touch|remove-replace",
      "--capture-count 1..20",
      "--operator-replace-confirmed",
      "--operator-replace-delay-ms 0..300000",
      "--camera-index",
      "--format png|tiff|jpg",
      "--lens-model",
      "--plan",
      "--include-lighting-sweep",
      "--include-flc-sweep",
      "--include-edr",
      "--include-edof",
      "--corner-profile sharp_90",
      "--capture-guides true|false",
      "--led-port",
      "--stage-port",
      "--baud",
      "--stage-baud",
      "--command-timeout-ms",
      "--stage-command-timeout-ms",
      "--open-timeout-ms",
      "--stage-open-timeout-ms",
      "--close-timeout-ms",
      "--stage-close-timeout-ms",
      "--macro-calibration-path",
      "--led-calibration-path",
      "--microscope-calibration-path",
      "--stage-calibration-path",
      "--arm-calibration-path",
      "--arm-interlock-required true|false",
      "--require-calibration-artifacts true|false",
      "--host",
      "--leimac-host",
      "--leimac-port",
      "--port",
    ],
    mode: "simulator-only",
    driverSet: "mock runnable; real limited to explicit Arduino LED readiness, GRBL stage readiness, manual Leimac IDMU readiness/profile commands, manual Basler pylon commands, and manual Dino-Lite bridge commands",
    dinoliteBridge: "manual fake bridge health plus manual DNVideoX enumerate/status/still capture only; default readiness does not spawn",
    leimacIdmu:
      "manual Ethernet read-only readiness/status/read-frame plus PR #36 guarded low-duty trigger profile and safe-off only; hardware writes require explicit --host, --apply, and confirmation text; no arbitrary write-frame CLI",
    baslerPylon:
      "manual pylon readiness/list/still capture plus guarded transient Line2 ExposureActive configuration with Line2 status readback only; default health/readiness/transport does not load pylon, enumerate cameras, open the Basler camera, or save User Sets",
    dinoliteSdkRuntimeDir:
      "optional for manual capture packages; use --sdk-runtime-dir or TENKINGS_DINOLITE_SDK_RUNTIME_DIR and keep vendor runtime files outside git",
    transport: "disabled until serve is explicitly run",
  };
}

function writeJson(stdout: (text: string) => void, value: unknown) {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function guideForDinoLiteTarget(name: string, type: string, cornerProfile = "sharp_90") {
  if (type === "interim_macro_overview") {
    return "Guide: fit as much of the card as possible, avoid background, keep card edges visible. Interim overview only; not calibrated macro capture.";
  }
  if (type === "corner") {
    return `Guide: place the ${name.toLowerCase()} tip at the center guide, include both edges, fill the frame mostly with card, avoid background. Corner profile: ${cornerProfile}.`;
  }
  if (type === "edge") {
    const direction = name.toLowerCase().includes("top") || name.toLowerCase().includes("bottom") ? "horizontal" : "vertical";
    return `Guide: align the edge on the ${direction} guide line, fill the frame with the card edge, include minimal background.`;
  }
  return "Guide: fill the central patch with card surface only, avoid border/background, and focus on the print surface.";
}

function describeDinoLiteOperatorPlan(plan: string, cornerProfile = "sharp_90", captureGuides = true) {
  const withGuide = (target: { name: string; type: string; instruction: string }) => ({
    ...target,
    guide: captureGuides ? guideForDinoLiteTarget(target.name, target.type, cornerProfile) : undefined,
  });
  if (plan === "operator-smoke-single") {
    return [
      withGuide({
        name: "Center surface",
        type: "surface",
        instruction: "Place the target detail under the microscope, adjust focus manually, then click Capture.",
      }),
    ];
  }
  if (plan === "card-interim") {
    return [
      {
        name: "Full-card overview",
        type: "interim_macro_overview",
        instruction:
          "Raise/zoom out/refocus the Dino-Lite so as much of the full card as possible is visible. This is an interim overview until the dedicated macro camera is integrated.",
      },
      { name: "Top-left corner", type: "corner", instruction: "Move the card so the top-left corner is centered under the microscope." },
      { name: "Top-right corner", type: "corner", instruction: "Move the card so the top-right corner is centered under the microscope." },
      { name: "Bottom-right corner", type: "corner", instruction: "Move the card so the bottom-right corner is centered under the microscope." },
      { name: "Bottom-left corner", type: "corner", instruction: "Move the card so the bottom-left corner is centered under the microscope." },
      { name: "Center surface", type: "surface", instruction: "Move the card so the center surface is centered under the microscope." },
    ].map(withGuide);
  }
  if (plan === "experimental-card-grading") {
    return [
      {
        name: "Full-card overview",
        type: "interim_macro_overview",
        instruction:
          "Raise/zoom out/refocus the Dino-Lite so as much of the full card as possible is visible. This is an interim overview until the dedicated macro camera is integrated.",
      },
      { name: "Top-left corner", type: "corner", instruction: "Move the card so the top-left corner is centered under the microscope." },
      { name: "Top-right corner", type: "corner", instruction: "Move the card so the top-right corner is centered under the microscope." },
      { name: "Bottom-right corner", type: "corner", instruction: "Move the card so the bottom-right corner is centered under the microscope." },
      { name: "Bottom-left corner", type: "corner", instruction: "Move the card so the bottom-left corner is centered under the microscope." },
      { name: "Top edge", type: "edge", instruction: "Move the card so the top edge midpoint is centered under the microscope." },
      { name: "Right edge", type: "edge", instruction: "Move the card so the right edge midpoint is centered under the microscope." },
      { name: "Bottom edge", type: "edge", instruction: "Move the card so the bottom edge midpoint is centered under the microscope." },
      { name: "Left edge", type: "edge", instruction: "Move the card so the left edge midpoint is centered under the microscope." },
      { name: "Center surface", type: "surface", instruction: "Move the card so the center surface is centered under the microscope." },
      { name: "Upper surface", type: "surface", instruction: "Move the card so the upper surface is centered under the microscope." },
      { name: "Lower surface", type: "surface", instruction: "Move the card so the lower surface is centered under the microscope." },
    ].map(withGuide);
  }
  if (plan === "surface-basic") {
    return [
      { name: "Center surface", type: "surface", instruction: "Move the card so the center surface is centered under the microscope." },
      { name: "Upper surface", type: "surface", instruction: "Move the card so the upper surface is centered under the microscope." },
      { name: "Lower surface", type: "surface", instruction: "Move the card so the lower surface is centered under the microscope." },
    ].map(withGuide);
  }
  if (plan === "card-basic") {
    return [
      { name: "Top-left corner", type: "corner", instruction: "Move the card so the top-left corner is centered under the microscope." },
      { name: "Top-right corner", type: "corner", instruction: "Move the card so the top-right corner is centered under the microscope." },
      { name: "Bottom-right corner", type: "corner", instruction: "Move the card so the bottom-right corner is centered under the microscope." },
      { name: "Bottom-left corner", type: "corner", instruction: "Move the card so the bottom-left corner is centered under the microscope." },
      { name: "Center surface", type: "surface", instruction: "Move the card so the center surface is centered under the microscope." },
    ].map(withGuide);
  }
  return [
    { name: "Top-left corner", type: "corner", instruction: "Move the card so the top-left corner is centered under the microscope." },
    { name: "Top-right corner", type: "corner", instruction: "Move the card so the top-right corner is centered under the microscope." },
    { name: "Bottom-right corner", type: "corner", instruction: "Move the card so the bottom-right corner is centered under the microscope." },
    { name: "Bottom-left corner", type: "corner", instruction: "Move the card so the bottom-left corner is centered under the microscope." },
  ].map(withGuide);
}

export async function runCaptureHelperCli(argv: string[], io: CaptureHelperCliIO = {}): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    const parsed = parseCliArgs(argv);
    if (parsed.command === "help") {
      writeJson(stdout, helpPayload());
      return 0;
    }

    if (parsed.command === "readiness") {
      writeJson(stdout, await buildCaptureHelperReadinessReportAsync(parsed.config, io.env ?? process.env));
      return 0;
    }

    if (parsed.command === "led-health") {
      const result = await runArduinoLedControllerHealthCheck({
        config: parsed.config.ledController?.arduino ?? {},
        env: io.env ?? process.env,
      });
      writeJson(stdout, result);
      return result.ok ? 0 : 1;
    }

    if (parsed.command === "stage-health") {
      const result = await runGrblStageHealthCheck({
        config: parsed.config.stage?.grbl ?? {},
        env: io.env ?? process.env,
      });
      writeJson(stdout, result);
      return result.ok ? 0 : 1;
    }

    if (parsed.command === "leimac-idmu-trigger-sync-plan") {
      const { buildLeimacIdmuTriggerSyncPlan } = await import("./drivers/leimacIdmuClient");
      const plan = buildLeimacIdmuTriggerSyncPlan(parsed.mode);
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "leimac-idmu-trigger-sync-plan",
        plan,
      });
      return 0;
    }

    if (parsed.command === "leimac-idmu-trigger-profile" || parsed.command === "leimac-idmu-safe-off") {
      const {
        LeimacIdmuClient,
        LEIMAC_IDMU_SAFE_OFF_CONFIRMATION,
        buildLeimacIdmuSafeOffFrames,
        buildLeimacIdmuTriggerProfilePlan,
      } = await import("./drivers/leimacIdmuClient");

      if (parsed.command === "leimac-idmu-safe-off") {
        if (!parsed.apply) {
          const frames = buildLeimacIdmuSafeOffFrames(parsed.leimacUnit);
          writeJson(stdout, {
            ok: true,
            service: "ai-grader-capture-helper",
            command: "leimac-idmu-safe-off",
            dryRun: true,
            frames,
            safety: {
              writesApplied: false,
              lightsCommanded: false,
              outputSettingsChanged: false,
              triggerSettingsChanged: false,
              persistentSaved: false,
              arbitraryWritesAllowed: false,
            },
          });
          return 0;
        }
        if (parsed.confirmation !== LEIMAC_IDMU_SAFE_OFF_CONFIRMATION) {
          throw new CaptureHelperCommandError(`leimac-idmu-safe-off --apply requires --confirm "${LEIMAC_IDMU_SAFE_OFF_CONFIRMATION}".`);
        }
        if (!parsed.leimacHost) {
          throw new CaptureHelperCommandError("leimac-idmu-safe-off --apply requires explicit --host <ip>.");
        }
        const client = new LeimacIdmuClient({
          host: parsed.leimacHost,
          port: parsed.leimacPort,
          timeoutMs: parsed.leimacTimeoutMs,
          unit: parsed.leimacUnit,
        });
        const result = await client.safeOff(true);
        writeJson(stdout, {
          ok: result.ok,
          service: "ai-grader-capture-helper",
          command: "leimac-idmu-safe-off",
          result,
        });
        return result.ok ? 0 : 1;
      }

      if (!parsed.apply) {
        const plan = buildLeimacIdmuTriggerProfilePlan({
          profile: parsed.profile,
          dutyPercent: parsed.duty,
          unit: parsed.leimacUnit,
          triggerActivation: parsed.triggerActivation,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "leimac-idmu-trigger-profile",
          dryRun: true,
          controller: {
            host: parsed.leimacHost ?? null,
            port: parsed.leimacPort ?? 1000,
            unit: parsed.leimacUnit ?? 1,
          },
          plan,
        });
        return 0;
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("leimac-idmu-trigger-profile --apply requires explicit --host <ip>.");
      }
      const client = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      const result = await client.applyTriggerProfile({
        profile: parsed.profile,
        dutyPercent: parsed.duty,
        triggerActivation: parsed.triggerActivation,
        apply: true,
        confirmation: parsed.confirmation,
      });
      writeJson(stdout, {
        ok: result.ok,
        service: "ai-grader-capture-helper",
        command: "leimac-idmu-trigger-profile",
        result,
      });
      return result.ok ? 0 : 1;
    }

    if (
      parsed.command === "leimac-idmu-readiness" ||
      parsed.command === "leimac-idmu-status" ||
      parsed.command === "leimac-idmu-read-frame"
    ) {
      const { LeimacIdmuClient } = await import("./drivers/leimacIdmuClient");
      const client = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });

      if (parsed.command === "leimac-idmu-readiness") {
        const readiness = await client.readiness();
        writeJson(stdout, {
          ok: readiness.ok,
          service: "ai-grader-capture-helper",
          command: "leimac-idmu-readiness",
          readiness,
        });
        return readiness.ok ? 0 : 1;
      }

      if (parsed.command === "leimac-idmu-read-frame") {
        const result = await client.readFrame(parsed.leimacFrame ?? "");
        writeJson(stdout, {
          ok: result.ok,
          service: "ai-grader-capture-helper",
          command: "leimac-idmu-read-frame",
          diagnostic: {
            readOnly: true,
            noImplicitTerminator: true,
            automaticRetries: false,
          },
          result,
        });
        return result.ok ? 0 : 1;
      }

      const status = await client.status();
      writeJson(stdout, {
        ok: status.ok,
        service: "ai-grader-capture-helper",
        command: "leimac-idmu-status",
        status,
      });
      return status.ok ? 0 : 1;
    }

    if (parsed.command === "basler-line2-user-output-pulse") {
      const env = io.env ?? process.env;
      const {
        BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const {
        LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        LeimacIdmuClient,
        buildLeimacIdmuTriggerProfilePlan,
      } = await import("./drivers/leimacIdmuClient");

      const leimacProfilePlan = buildLeimacIdmuTriggerProfilePlan({
        dutyPercent: 3,
        unit: parsed.leimacUnit,
        triggerActivation: "LevelLow",
      });
      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });

      if (!parsed.apply) {
        const pulse = await baslerClient.pulseLine2UserOutput({
          cameraIndex: parsed.cameraIndex,
          lineInverter: parsed.lineInverter ?? true,
          pulseMs: parsed.pulseMs,
          idleUserOutputValue: parsed.idleUserOutputValue ?? false,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-line2-user-output-pulse",
          dryRun: true,
          pulse,
          leimacProfilePlan,
          safety: {
            markPresentRequired: true,
            wiringConfirmedRequired: true,
            leimacStatusGreenRequired: true,
            safeOffBefore: true,
            safeOffAfter: true,
            persistentSaved: false,
          },
        });
        return 0;
      }

      if (parsed.confirmation !== BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-line2-user-output-pulse --apply requires --confirm "${BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("basler-line2-user-output-pulse --apply requires explicit --leimac-host <ip> for safe-off/profile cleanup.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-line2-user-output-pulse --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("basler-line2-user-output-pulse --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("basler-line2-user-output-pulse --apply requires --leimac-status-green.");
      }

      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
      try {
        const safeOffStart = await leimacClient.safeOff(true);
        if (!safeOffStart.ok) {
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-line2-user-output-pulse",
            safeOffStart,
            error: "Leimac safe-off failed before manual pulse.",
          });
          return 1;
        }
        const leimacProfile = await leimacClient.applyTriggerProfile({
          profile: "basler-line2-trg-in1-low-duty",
          dutyPercent: 3,
          triggerActivation: "LevelLow",
          apply: true,
          confirmation: LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        });
        const settingReadbacks = await leimacClient.readTriggerProfileSettings();
        if (!leimacProfile.ok) {
          safeOffEnd = await leimacClient.safeOff(true);
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-line2-user-output-pulse",
            safeOffStart,
            leimacProfile,
            settingReadbacks,
            safeOffEnd,
            error: "Leimac low-duty trigger profile failed before manual pulse.",
          });
          return 1;
        }
        const pulse = await baslerClient.pulseLine2UserOutput({
          apply: true,
          confirmation: BASLER_LINE2_USER_OUTPUT_PULSE_CONFIRMATION,
          cameraIndex: parsed.cameraIndex,
          lineInverter: parsed.lineInverter ?? true,
          pulseMs: parsed.pulseMs,
          idleUserOutputValue: parsed.idleUserOutputValue ?? false,
        });
        safeOffEnd = await leimacClient.safeOff(true);
        writeJson(stdout, {
          ok: safeOffEnd.ok,
          service: "ai-grader-capture-helper",
          command: "basler-line2-user-output-pulse",
          safeOffStart,
          leimacProfile,
          settingReadbacks,
          pulse,
          safeOffEnd,
          operatorPrompt: "Ask Mark whether the ring visibly turned on during the manual pulse and returned off after safe-off.",
        });
        return safeOffEnd.ok ? 0 : 1;
      } catch (error) {
        if (!safeOffEnd && parsed.leimacHost) {
          safeOffEnd = await leimacClient.safeOff(true);
        }
        const message = error instanceof Error ? error.message : "Unknown Basler Line2 UserOutput pulse error.";
        writeJson(stderr, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-line2-user-output-pulse",
          error: message,
          safeOffEnd,
        });
        return 1;
      }
    }

    if (parsed.command === "basler-leimac-polarity-smoke") {
      const env = io.env ?? process.env;
      const {
        BASLER_LEIMAC_POLARITY_SMOKE_CONFIRMATION,
        assertBaslerLeimacSyncSmokeOutputDirAllowed,
        buildBaslerLeimacPolaritySmokeManifest,
        buildBaslerLeimacPolaritySmokePlan,
      } = await import("./drivers/baslerLeimacSync");
      const {
        BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const {
        LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        LeimacIdmuClient,
        buildLeimacIdmuTriggerProfilePlan,
      } = await import("./drivers/leimacIdmuClient");

      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: parsed.duty,
        exposureUs: parsed.exposureUs,
        candidateId: parsed.polarityCandidate,
        dryRun: !parsed.apply,
      });
      const candidate = plan.selectedCandidate ?? plan.candidates[0];
      const profilePlan = buildLeimacIdmuTriggerProfilePlan({
        dutyPercent: plan.dutyPercent,
        unit: parsed.leimacUnit,
        triggerActivation: candidate.leimacTriggerActivation,
      });

      if (!parsed.apply) {
        if (parsed.captureConfirmed) {
          assertBaslerLeimacSyncSmokeOutputDirAllowed(parsed.outputDir ?? "");
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          dryRun: true,
          plan,
          selectedCandidate: candidate,
          manifest: buildBaslerLeimacPolaritySmokeManifest({
            status: "planned",
            candidate,
            leimacHost: parsed.leimacHost ?? "0.0.0.0",
            leimacPort: parsed.leimacPort ?? 1000,
            leimacProfilePlan: profilePlan,
            requestedExposureUs: parsed.exposureUs,
            supervised: false,
            safeOffBefore: false,
            safeOffAfter: false,
          }),
        });
        return 0;
      }

      if (parsed.confirmation !== BASLER_LEIMAC_POLARITY_SMOKE_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-leimac-polarity-smoke --apply requires --confirm "${BASLER_LEIMAC_POLARITY_SMOKE_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("basler-leimac-polarity-smoke --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-leimac-polarity-smoke --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("basler-leimac-polarity-smoke --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("basler-leimac-polarity-smoke --apply requires --leimac-status-green.");
      }
      if (parsed.captureConfirmed && !parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError(
          "basler-leimac-polarity-smoke --capture-confirmed requires --operator-confirmed-light-idle-off."
        );
      }
      const outputDir = parsed.captureConfirmed
        ? assertBaslerLeimacSyncSmokeOutputDirAllowed(parsed.outputDir ?? "")
        : undefined;

      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });

      if (parsed.operatorReportedIdleOn) {
        const safeOffEnd = await leimacClient.safeOff(true);
        writeJson(stdout, {
          ok: safeOffEnd.ok,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          selectedCandidate: candidate,
          candidateResult: "idle_on_failed",
          safeOffEnd,
          manifest: buildBaslerLeimacPolaritySmokeManifest({
            status: "aborted",
            candidate,
            candidateResult: "idle_on_failed",
            leimacHost: parsed.leimacHost,
            leimacPort: parsed.leimacPort ?? 1000,
            leimacProfilePlan: profilePlan,
            requestedExposureUs: parsed.exposureUs,
            supervised: true,
            safeOffBefore: true,
            safeOffAfter: safeOffEnd.ok,
          }),
          operatorPrompt: "Confirm the Leimac ring light is off before testing another polarity candidate.",
        });
        return safeOffEnd.ok ? 0 : 1;
      }

      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });

      const unitInfo = await leimacClient.readCommand("unitInfo");
      if (!unitInfo.ok) {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          error: "Leimac unit-info preflight failed.",
          unitInfo,
        });
        return 1;
      }

      const cameraList = await baslerClient.listCameras();
      const cameraIndex = parsed.cameraIndex ?? 0;
      const camera = cameraList.cameras.find((entry) => entry.index === cameraIndex) ?? cameraList.cameras[cameraIndex];
      if (cameraList.status !== "reachable" || !camera) {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          error: "Basler camera preflight failed.",
          cameraList,
        });
        return 1;
      }
      if (camera.modelName !== "a2A2448-23gmBAS") {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          error: "Unexpected Basler camera model for the PR #36 capture node.",
          expectedModelName: "a2A2448-23gmBAS",
          camera,
        });
        return 1;
      }

      if (parsed.captureConfirmed) {
        let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
        const line2Status = await baslerClient.readLine2Status(cameraIndex);
        try {
          const capture = await baslerClient.captureStill({
            outputDir: outputDir ?? "",
            label: `leimac-polarity-${candidate.id}`,
            cameraIndex,
            savedFormat: "png",
            lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
          });
          safeOffEnd = await leimacClient.safeOff(true);
          const manifest = buildBaslerLeimacPolaritySmokeManifest({
            status: "captured",
            candidate,
            candidateResult: "accepted",
            leimacHost: parsed.leimacHost,
            leimacPort: parsed.leimacPort ?? 1000,
            leimacProfilePlan: profilePlan,
            unitInfo,
            baslerLine2Status: line2Status,
            requestedExposureUs: parsed.exposureUs,
            capture,
            supervised: true,
            safeOffBefore: true,
            safeOffAfter: safeOffEnd.ok,
          });
          writeJson(stdout, {
            ok: safeOffEnd.ok,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-polarity-smoke",
            selectedCandidate: candidate,
            unitInfo,
            camera,
            line2Status,
            capture,
            safeOffEnd,
            manifest,
            operatorPrompt: "Confirm final Leimac ring-light state is off after safe-off.",
          });
          return safeOffEnd.ok ? 0 : 1;
        } catch (error) {
          safeOffEnd = await leimacClient.safeOff(true);
          const message = error instanceof Error ? error.message : "Unknown Basler/Leimac polarity capture error.";
          writeJson(stderr, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-polarity-smoke",
            error: message,
            selectedCandidate: candidate,
            unitInfo,
            camera,
            line2Status,
            safeOffEnd,
            manifest: buildBaslerLeimacPolaritySmokeManifest({
              status: "aborted",
              candidate,
              candidateResult: "capture_failed",
              leimacHost: parsed.leimacHost,
              leimacPort: parsed.leimacPort ?? 1000,
              leimacProfilePlan: profilePlan,
              unitInfo,
              baslerLine2Status: line2Status,
              requestedExposureUs: parsed.exposureUs,
              supervised: true,
              safeOffBefore: true,
              safeOffAfter: safeOffEnd.ok,
            }),
          });
          return 1;
        }
      }

      const safeOffStart = await leimacClient.safeOff(true);
      if (!safeOffStart.ok) {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          selectedCandidate: candidate,
          unitInfo,
          camera,
          safeOffStart,
          error: "Safe-off before polarity candidate failed; candidate was not applied.",
        });
        return 1;
      }

      let leimacProfile: Awaited<ReturnType<typeof leimacClient.applyTriggerProfile>> | undefined;
      let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
      try {
        const line2 = await baslerClient.configureLine2ExposureActive({
          apply: true,
          confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
          cameraIndex,
          lineInverter: candidate.baslerLineInverter,
        });
        const line2Status = await baslerClient.readLine2Status(cameraIndex);
        leimacProfile = await leimacClient.applyTriggerProfile({
          profile: "basler-line2-trg-in1-low-duty",
          dutyPercent: plan.dutyPercent,
          triggerActivation: candidate.leimacTriggerActivation,
          apply: true,
          confirmation: LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        });
        if (!leimacProfile.ok) {
          safeOffEnd = await leimacClient.safeOff(true);
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-polarity-smoke",
            selectedCandidate: candidate,
            unitInfo,
            camera,
            safeOffStart,
            line2,
            line2Status,
            leimacProfile,
            safeOffEnd,
            error: "Leimac trigger profile failed; safe-off was run.",
          });
          return 1;
        }
        const manifest = buildBaslerLeimacPolaritySmokeManifest({
          status: "candidate_applied",
          candidate,
          candidateResult: "idle_off_pending_capture",
          leimacHost: parsed.leimacHost,
          leimacPort: parsed.leimacPort ?? 1000,
          leimacProfile,
          unitInfo,
          baslerLine2: line2,
          baslerLine2Status: line2Status,
          requestedExposureUs: parsed.exposureUs,
          supervised: true,
          safeOffBefore: safeOffStart.ok,
          safeOffAfter: false,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          selectedCandidate: candidate,
          unitInfo,
          camera,
          safeOffStart,
          line2,
          line2Status,
          leimacProfile,
          manifest,
          operatorPrompt:
            "Ask Mark whether the ring light is off at idle. If it is continuously on, run this command with --operator-reported-idle-on for the same candidate before proceeding.",
        });
        return 0;
      } catch (error) {
        safeOffEnd = await leimacClient.safeOff(true);
        const message = error instanceof Error ? error.message : "Unknown Basler/Leimac polarity candidate error.";
        writeJson(stderr, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-polarity-smoke",
          error: message,
          selectedCandidate: candidate,
          unitInfo,
          camera,
          safeOffStart,
          leimacProfile,
          safeOffEnd,
        });
        return 1;
      }
    }

    if (parsed.command === "basler-leimac-macro-package") {
      const env = io.env ?? process.env;
      const {
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
        acceptedBaslerLeimacPolarityCandidate,
        assertFullRigOutputDirAllowed,
        buildBaslerLeimacMacroPackageManifest,
        createLocalSmokePackageDir,
        writeMacroPackageArtifacts,
      } = await import("./drivers/baslerLeimacFullRig");
      const {
        analyzeBaslerLeimacImageStats,
        buildBaslerLeimacPolaritySmokePlan,
      } = await import("./drivers/baslerLeimacSync");
      const {
        BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const {
        LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        LeimacIdmuClient,
        buildLeimacIdmuTriggerProfilePlan,
      } = await import("./drivers/leimacIdmuClient");

      const exposureUs = parsed.exposureUs ?? 50000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("basler-leimac-macro-package --exposure-us must be from 1 to 100000.");
      }
      if (parsed.profile && parsed.profile !== ACCEPTED_BASLER_LEIMAC_PROFILE_ID) {
        throw new CaptureHelperCommandError(`basler-leimac-macro-package --profile must be ${ACCEPTED_BASLER_LEIMAC_PROFILE_ID}.`);
      }
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: parsed.duty ?? 5,
        exposureUs,
        candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        dryRun: !parsed.apply,
      });
      const candidate = acceptedBaslerLeimacPolarityCandidate();
      const profilePlan = buildLeimacIdmuTriggerProfilePlan({
        dutyPercent: plan.dutyPercent,
        unit: parsed.leimacUnit,
        triggerActivation: candidate.leimacTriggerActivation,
      });

      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertFullRigOutputDirAllowed(parsed.outputDir);
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-macro-package",
          dryRun: true,
          plan,
          manifest: buildBaslerLeimacMacroPackageManifest({
            status: "planned",
            packageId: "planned-basler-leimac-macro-package",
            packageDir: parsed.outputDir ?? "",
            candidate,
            leimacHost: parsed.leimacHost ?? "0.0.0.0",
            leimacPort: parsed.leimacPort ?? 1000,
            leimacProfilePlan: profilePlan,
            requestedExposureUs: exposureUs,
            dutyPercent: plan.dutyPercent,
            supervised: false,
            safeOffBefore: false,
            safeOffAfter: false,
          }),
        });
        return 0;
      }

      if (parsed.confirmation !== BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-leimac-macro-package --apply requires --confirm "${BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("basler-leimac-macro-package --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-leimac-macro-package --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("basler-leimac-macro-package --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("basler-leimac-macro-package --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("basler-leimac-macro-package --apply requires --operator-confirmed-light-idle-off.");
      }

      const { packageId, packageDir } = await createLocalSmokePackageDir(parsed.outputDir ?? "", "basler-leimac-macro-package");
      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });

      let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
      try {
        const safeOffStart = await leimacClient.safeOff(true);
        if (!safeOffStart.ok) {
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-macro-package",
            packageDir,
            safeOffStart,
            error: "Leimac safe-off failed before dark control capture.",
          });
          return 1;
        }

        const cameraList = await baslerClient.listCameras();
        const cameraIndex = parsed.cameraIndex ?? 0;
        const camera = cameraList.cameras.find((entry) => entry.index === cameraIndex) ?? cameraList.cameras[cameraIndex];
        if (cameraList.status !== "reachable" || !camera) {
          safeOffEnd = await leimacClient.safeOff(true);
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-macro-package",
            packageDir,
            safeOffStart,
            safeOffEnd,
            cameraList,
            error: "Basler camera preflight failed.",
          });
          return 1;
        }

        const darkCapture = await baslerClient.captureStill({
          outputDir: packageDir,
          label: "basler-leimac-macro-dark-control",
          cameraIndex,
          savedFormat: "png",
          exposureUs,
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
        });
        const darkStats = await analyzeBaslerLeimacImageStats(darkCapture.outputFilePath);
        const line2 = await baslerClient.configureLine2ExposureActive({
          apply: true,
          confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
          cameraIndex,
          lineInverter: candidate.baslerLineInverter,
        });
        const leimacProfile = await leimacClient.applyTriggerProfile({
          profile: "basler-line2-trg-in1-low-duty",
          dutyPercent: plan.dutyPercent,
          triggerActivation: candidate.leimacTriggerActivation,
          apply: true,
          confirmation: LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        });
        const settingReadbacks = await leimacClient.readTriggerProfileSettings();
        if (!leimacProfile.ok) {
          safeOffEnd = await leimacClient.safeOff(true);
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-macro-package",
            packageDir,
            safeOffStart,
            darkControl: { capture: darkCapture, stats: darkStats },
            line2,
            leimacProfile,
            settingReadbacks,
            safeOffEnd,
            error: "Leimac trigger profile failed before synced macro capture.",
          });
          return 1;
        }
        const line2Status = await baslerClient.readLine2Status(cameraIndex);
        const syncedCapture = await baslerClient.captureStill({
          outputDir: packageDir,
          label: "basler-leimac-macro-synced",
          cameraIndex,
          savedFormat: "png",
          exposureUs,
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
        });
        const syncedStats = await analyzeBaslerLeimacImageStats(syncedCapture.outputFilePath);
        safeOffEnd = await leimacClient.safeOff(true);
        const manifest = buildBaslerLeimacMacroPackageManifest({
          status: "captured",
          packageId,
          packageDir,
          candidate,
          leimacHost: parsed.leimacHost,
          leimacPort: parsed.leimacPort ?? 1000,
          leimacProfile,
          unitInfo: leimacProfile.unitInfo,
          settingReadbacks,
          baslerLine2: line2,
          baslerLine2Status: line2Status,
          requestedExposureUs: exposureUs,
          dutyPercent: plan.dutyPercent,
          darkControl: { capture: darkCapture, stats: darkStats },
          synced: { capture: syncedCapture, stats: syncedStats },
          supervised: true,
          safeOffBefore: safeOffStart.ok,
          safeOffAfter: safeOffEnd.ok,
          finalLightOffConfirmedByMark: false,
        });
        const writtenManifest = await writeMacroPackageArtifacts(manifest);
        writeJson(stdout, {
          ok: safeOffEnd.ok,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-macro-package",
          packageDir,
          selectedCandidate: candidate,
          camera,
          safeOffStart,
          darkControl: { capture: darkCapture, stats: darkStats },
          line2,
          line2Status,
          leimacProfile,
          settingReadbacks,
          synced: { capture: syncedCapture, stats: syncedStats },
          safeOffEnd,
          manifestPath: writtenManifest.manifestPath,
          previewReportPath: writtenManifest.previewReportPath,
          manifest: writtenManifest,
          operatorPrompt: "Confirm final Leimac ring-light state is off after safe-off.",
        });
        return safeOffEnd.ok ? 0 : 1;
      } catch (error) {
        if (!safeOffEnd && parsed.leimacHost) {
          safeOffEnd = await leimacClient.safeOff(true);
        }
        const message = error instanceof Error ? error.message : "Unknown Basler/Leimac macro package error.";
        writeJson(stderr, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-macro-package",
          packageDir,
          error: message,
          safeOffEnd,
        });
        return 1;
      }
    }

    if (parsed.command === "ai-grader-full-rig-local-smoke") {
      const env = io.env ?? process.env;
      const {
        AI_GRADER_FULL_RIG_LOCAL_SMOKE_CONFIRMATION,
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        acceptedBaslerLeimacPolarityCandidate,
        assertFullRigOutputDirAllowed,
        buildBaslerLeimacMacroPackageManifest,
        buildFullRigLocalSmokeManifest,
        createLocalSmokePackageDir,
        writeFullRigArtifacts,
      } = await import("./drivers/baslerLeimacFullRig");
      const { buildBaslerLeimacPolaritySmokePlan } = await import("./drivers/baslerLeimacSync");
      const { buildLeimacIdmuTriggerProfilePlan } = await import("./drivers/leimacIdmuClient");

      const exposureUs = parsed.exposureUs ?? 50000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --basler-exposure-us must be from 1 to 100000.");
      }
      const dinolitePlan = parsed.plan ?? "experimental-card-grading";
      if (dinolitePlan !== "experimental-card-grading") {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke currently supports --dinolite-plan experimental-card-grading only.");
      }
      const cornerProfile = parsed.cornerProfile ?? "sharp_90";
      if (cornerProfile !== "sharp_90") {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke currently supports --corner-profile sharp_90 only.");
      }
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: parsed.duty ?? 5,
        exposureUs,
        candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        dryRun: !parsed.apply,
      });
      const candidate = acceptedBaslerLeimacPolarityCandidate();
      const profilePlan = buildLeimacIdmuTriggerProfilePlan({
        dutyPercent: plan.dutyPercent,
        unit: parsed.leimacUnit,
        triggerActivation: candidate.leimacTriggerActivation,
      });

      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertFullRigOutputDirAllowed(parsed.outputDir);
        }
        const macroManifest = buildBaslerLeimacMacroPackageManifest({
          status: "planned",
          packageId: "planned-basler-leimac-macro-package",
          packageDir: parsed.outputDir ?? "",
          candidate,
          leimacHost: parsed.leimacHost ?? "0.0.0.0",
          leimacPort: parsed.leimacPort ?? 1000,
          leimacProfilePlan: profilePlan,
          requestedExposureUs: exposureUs,
          dutyPercent: plan.dutyPercent,
          supervised: false,
          safeOffBefore: false,
          safeOffAfter: false,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "ai-grader-full-rig-local-smoke",
          dryRun: true,
          plan: {
            baslerMacro: plan,
            dinoliteDetail: {
              plan: dinolitePlan,
              includeFlcSweep: parsed.includeFlcSweep,
              includeEdr: parsed.includeEdr,
              includeEdof: parsed.includeEdof,
              captureGuides: parsed.captureGuides,
            },
          },
          manifest: buildFullRigLocalSmokeManifest({
            packageId: "planned-ai-grader-full-rig-local-smoke",
            packageDir: parsed.outputDir ?? "",
            status: "planned",
            baslerMacro: macroManifest,
          }),
        });
        return 0;
      }

      if (parsed.confirmation !== AI_GRADER_FULL_RIG_LOCAL_SMOKE_CONFIRMATION) {
        throw new CaptureHelperCommandError(`ai-grader-full-rig-local-smoke --apply requires --confirm "${AI_GRADER_FULL_RIG_LOCAL_SMOKE_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --operator-confirmed-light-idle-off.");
      }
      const executablePath =
        parsed.config.dinoliteBridge?.executablePath ?? env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_PATH;
      const adapter =
        parsed.config.dinoliteBridge?.adapter ??
        ((env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_ADAPTER as "fake" | "dnvideox" | undefined) ?? undefined);
      if (!executablePath || executablePath.trim().length === 0) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --bridge-exe <path> for Dino-Lite detail capture.");
      }
      if (adapter !== "dnvideox") {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --adapter dnvideox.");
      }
      if (parsed.deviceIndex === undefined) {
        throw new CaptureHelperCommandError("ai-grader-full-rig-local-smoke --apply requires --device-index <index>.");
      }

      const { packageId, packageDir } = await createLocalSmokePackageDir(parsed.outputDir ?? "", "ai-grader-full-rig-local-smoke");
      const baslerMacroOutputDir = path.join(packageDir, "basler-macro");
      const dinoliteOutputDir = path.join(packageDir, "dinolite-detail");
      let macroStdout = "";
      let macroStderr = "";
      const macroCode = await runCaptureHelperCli([
        "basler-leimac-macro-package",
        "--leimac-host",
        parsed.leimacHost,
        "--leimac-port",
        String(parsed.leimacPort ?? 1000),
        "--output-dir",
        baslerMacroOutputDir,
        "--profile",
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        "--duty",
        String(plan.dutyPercent),
        "--exposure-us",
        String(exposureUs),
        "--include-dark-control",
        "--apply",
        "--confirm",
        "RUN BASLER LEIMAC MACRO PACKAGE",
        "--mark-present",
        "--wiring-confirmed",
        "--leimac-status-green",
        "--operator-confirmed-light-idle-off",
        ...(parsed.pylonRoot ? ["--pylon-root", parsed.pylonRoot] : []),
        ...(parsed.pylonTimeoutMs ? ["--pylon-timeout-ms", String(parsed.pylonTimeoutMs)] : []),
        ...(parsed.baslerBridgeScript ? ["--bridge-script", parsed.baslerBridgeScript] : []),
        ...(parsed.cameraIndex !== undefined ? ["--camera-index", String(parsed.cameraIndex)] : []),
        ...(parsed.leimacTimeoutMs ? ["--timeout-ms", String(parsed.leimacTimeoutMs)] : []),
        ...(parsed.leimacUnit ? ["--unit", String(parsed.leimacUnit)] : []),
      ], {
        env,
        stdout: (chunk) => {
          macroStdout += chunk;
        },
        stderr: (chunk) => {
          macroStderr += chunk;
        },
      });
      const macroResult = macroStdout ? JSON.parse(macroStdout) : undefined;
      const macroError = macroStderr ? JSON.parse(macroStderr) : undefined;
      if (macroCode !== 0 || !macroResult?.manifest) {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "ai-grader-full-rig-local-smoke",
          packageDir,
          macroResult,
          macroError,
          error: "Basler/Leimac macro stage failed; Dino-Lite detail stage was not started.",
        });
        return 1;
      }

      const sdkRuntimeDir =
        parsed.config.dinoliteBridge?.sdkRuntimeDir ?? env.TENKINGS_DINOLITE_SDK_RUNTIME_DIR;
      if (sdkRuntimeDir) {
        assertDinoLiteSdkRuntimeDirAllowed(sdkRuntimeDir);
      }
      const client = new DinoLiteBridgeClient({
        executablePath,
        adapter,
        timeoutMs: parsed.config.dinoliteBridge?.timeoutMs,
        manualHardwareAccess: true,
        sdkRuntimeDir,
      });
      const label = parsed.label?.trim() || packageId;
      stderr("Operator window shown\n");
      stderr("Plan: experimental-card-grading\n");
      stderr(`Corner profile: ${cornerProfile}\n`);
      stderr(`Capture guides: ${parsed.captureGuides ? "enabled" : "disabled"}\n`);
      stderr("Waiting for Capture/Skip/Abort in the local Dino-Lite operator window.\n");
      const workflow = await client.operatorWorkflow({
        deviceIndex: parsed.deviceIndex,
        outputDir: assertDinoLiteCaptureOutputDirAllowed(dinoliteOutputDir),
        label,
        plan: dinolitePlan,
        includeFlcSweep: parsed.includeFlcSweep,
        includeEdr: parsed.includeEdr,
        includeEdof: parsed.includeEdof,
        cornerProfile,
        captureGuides: parsed.captureGuides,
      });
      await client.close();
      const analysis = workflow.status === "aborted"
        ? undefined
        : await analyzeDinoLiteExperimentalGradingWorkflow(workflow, {
            cornerProfile,
            captureGuides: parsed.captureGuides,
          });
      const fullRigManifest = buildFullRigLocalSmokeManifest({
        packageId,
        packageDir,
        status: workflow.status === "aborted" ? "aborted" : "completed",
        baslerMacro: macroResult.manifest,
        dinoliteWorkflow: workflow,
        dinoliteAnalysis: analysis,
        finalLightOffConfirmedByMark: false,
      });
      const writtenManifest = await writeFullRigArtifacts(fullRigManifest);
      writeJson(stdout, {
        ok: workflow.status !== "aborted",
        service: "ai-grader-capture-helper",
        command: "ai-grader-full-rig-local-smoke",
        packageDir,
        baslerMacro: macroResult,
        dinoliteDetail: {
          workflow,
          analysis,
        },
        manifestPath: writtenManifest.manifestPath,
        previewReportPath: writtenManifest.previewReportPath,
        manifest: writtenManifest,
        operatorPrompt: "Confirm final Leimac ring-light state is off after safe-off.",
      });
      return workflow.status === "aborted" ? 1 : 0;
    }

    if (parsed.command === "fixed-rig-lighting-profile-plan") {
      const { buildFixedRigLightingProfilePlan } = await import("./drivers/baslerFixedRigV1");
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "fixed-rig-lighting-profile-plan",
        plan: buildFixedRigLightingProfilePlan(),
      });
      return 0;
    }

    if (parsed.command === "basler-fixed-rig-operator-preview") {
      const {
        BASLER_FIXED_RIG_OPERATOR_PREVIEW_CONFIRMATION,
        FIXED_RIG_SELECTED_EXPOSURE_US,
        analyzeFixedRigMacroQuality,
        assertFixedRigOutputDirAllowed,
        buildFixedRigActiveLightingProfile,
        buildFixedRigOperatorPreviewManifest,
        createFixedRigPackageDir,
        writeFixedRigActiveLightingProfile,
        writeFixedRigOperatorPreviewArtifacts,
      } = await import("./drivers/baslerFixedRigV1");

      const exposureUs = parsed.exposureUs ?? FIXED_RIG_SELECTED_EXPOSURE_US;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("basler-fixed-rig-operator-preview --exposure-us must be from 1 to 100000.");
      }
      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertFixedRigOutputDirAllowed(parsed.outputDir);
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-fixed-rig-operator-preview",
          dryRun: true,
        manifest: buildFixedRigOperatorPreviewManifest({
          packageId: "planned-basler-fixed-rig-operator-preview",
          packageDir: parsed.outputDir ?? "",
          status: "planned",
          focusLockedByOperator: parsed.focusLockedByOperator,
          acceptedLightingProfile: buildFixedRigActiveLightingProfile({
            profileSource: "default",
            resetToDefault: parsed.resetDefaultLightingProfile,
          }),
        }),
        });
        return 0;
      }
      if (parsed.confirmation !== BASLER_FIXED_RIG_OPERATOR_PREVIEW_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-fixed-rig-operator-preview --apply requires --confirm "${BASLER_FIXED_RIG_OPERATOR_PREVIEW_CONFIRMATION}".`);
      }
      if (!parsed.operatorMode) {
        throw new CaptureHelperCommandError("basler-fixed-rig-operator-preview --apply requires --operator-mode.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-fixed-rig-operator-preview --apply requires --mark-present.");
      }
      if (parsed.leimacHost) {
        if (!parsed.wiringConfirmed) {
          throw new CaptureHelperCommandError("basler-fixed-rig-operator-preview Leimac preview lighting requires --wiring-confirmed.");
        }
        if (!parsed.leimacStatusGreen) {
          throw new CaptureHelperCommandError("basler-fixed-rig-operator-preview Leimac preview lighting requires --leimac-status-green.");
        }
        if (!parsed.operatorConfirmedLightIdleOff) {
          throw new CaptureHelperCommandError("basler-fixed-rig-operator-preview Leimac preview lighting requires --operator-confirmed-light-idle-off.");
        }
      }

      const env = io.env ?? process.env;
      const { BaslerPylonClient } = await import("./drivers/baslerPylonClient");
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "basler-fixed-rig-operator-preview");
      const client = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs ?? 1800000,
        env,
      });
      const livePreview = await client.showOperatorPreviewWindow({
        outputDir: packageDir,
        cameraIndex: parsed.cameraIndex,
        exposureUs,
        refreshIntervalMs: parsed.previewRefreshMs,
        leimacHost: parsed.leimacHost,
        leimacPort: parsed.leimacPort,
        leimacUnit: parsed.leimacUnit,
        previewDutyPercent: 1.2,
      });
      if (livePreview.operatorDecision !== "accepted") {
        const manifest = buildFixedRigOperatorPreviewManifest({
          packageId,
          packageDir,
          status: livePreview.operatorDecision === "aborted" ? "aborted" : "closed",
          livePreview,
          focusLockedByOperator: parsed.focusLockedByOperator,
        });
        const writtenManifest = await writeFixedRigOperatorPreviewArtifacts(manifest);
        writeJson(stdout, {
          ok: livePreview.operatorDecision === "closed",
          service: "ai-grader-capture-helper",
          command: "basler-fixed-rig-operator-preview",
          packageDir,
          livePreview,
          manifestPath: writtenManifest.manifestPath,
          previewReportPath: writtenManifest.previewReportPath,
          manifest: writtenManifest,
          operatorPrompt: "Operator preview window was not accepted; do not proceed to focus/framing smoke until Mark accepts focus/alignment usability.",
        });
        return livePreview.operatorDecision === "aborted" ? 1 : 0;
      }
      const previewCapture = await client.captureStill({
        outputDir: packageDir,
        label: "operator-preview",
        cameraIndex: parsed.cameraIndex,
        savedFormat: "png",
        lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
        exposureUs,
      });
      const quality = await analyzeFixedRigMacroQuality(previewCapture.outputFilePath);
      const acceptedLightingProfile = buildFixedRigActiveLightingProfile({
        selectedDutyPercent: livePreview.previewLighting.requestedDutyPercent ?? livePreview.previewLighting.currentDutyPercent,
        selectedChannels: livePreview.previewLighting.selectedChannels,
        profileSource: "operator_preview",
        resetToDefault: parsed.resetDefaultLightingProfile,
      });
      const activeLightingProfilePath = await writeFixedRigActiveLightingProfile(parsed.outputDir ?? packageDir, acceptedLightingProfile);
      const manifest = buildFixedRigOperatorPreviewManifest({
        packageId,
        packageDir,
        status: "accepted",
        livePreview,
        previewCapture,
        quality,
        focusLockedByOperator: parsed.focusLockedByOperator,
        acceptedLightingProfile,
      });
      const writtenManifest = await writeFixedRigOperatorPreviewArtifacts(manifest);
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "basler-fixed-rig-operator-preview",
        packageDir,
        livePreview,
        previewCapture,
        quality,
        manifestPath: writtenManifest.manifestPath,
        previewReportPath: writtenManifest.previewReportPath,
        activeLightingProfilePath,
        acceptedLightingProfile,
        overlayPreview: writtenManifest.overlayPreview,
        manifest: writtenManifest,
        operatorPrompt: "Proceed only if Mark confirms the visible pylon live-stream preview window was usable for manual focus and card alignment.",
      });
      return 0;
    }

    if (parsed.command === "ai-grader-fixed-rig-v1-card-report") {
      const {
        assertFixedRigOutputDirAllowed,
        createUnifiedFixedRigDiagnosticCardReport,
      } = await import("./drivers/baslerFixedRigV1");
      if (!parsed.outputDir) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-card-report requires --output-dir <outside-repo-output-dir>.");
      }
      if (!parsed.frontDir) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-card-report requires --front-dir <front-evidence-package-dir>.");
      }
      if (!parsed.backDir) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-card-report requires --back-dir <back-evidence-package-dir>.");
      }
      assertFixedRigOutputDirAllowed(parsed.outputDir);
      const report = await createUnifiedFixedRigDiagnosticCardReport({
        outputDir: parsed.outputDir,
        frontPackageDir: parsed.frontDir,
        backPackageDir: parsed.backDir,
      });
      writeJson(stdout, {
        ok: report.status === "computed_diagnostic",
        service: "ai-grader-capture-helper",
        command: "ai-grader-fixed-rig-v1-card-report",
        report,
        safety: {
          hardwareAccessed: false,
          baslerContacted: false,
          leimacContacted: false,
          persistentBaslerSaved: false,
          persistentLeimacSaved: false,
          capturedImagesCommitted: false,
          finalGradeComputed: false,
          certifiedClaim: false,
        },
      });
      return report.status === "computed_diagnostic" ? 0 : 1;
    }

    if (parsed.command === "ai-grader-station-operator-workflow") {
      const {
        buildAiGraderStationWorkflowManifest,
        writeAiGraderStationWorkflowArtifacts,
      } = await import("./drivers/aiGraderStationWorkflow");
      if (parsed.apply) {
        throw new CaptureHelperCommandError(
          "ai-grader-station-operator-workflow hardware execution is intentionally pending for PR #41; run the supervised fixed-rig commands only when Mark is present."
        );
      }
      const common = {
        mockRun: parsed.mockRun,
        acceptedDutyPercent: parsed.duty,
        exposureUs: parsed.exposureUs,
        gain: parsed.gain,
        frontClippedFraction: parsed.frontClippedFraction,
        backClippedFraction: parsed.backClippedFraction,
        operatorAcceptedWarnings: parsed.operatorAcceptedWarnings,
        calibrationProfileId: parsed.calibrationProfileId,
        mmPerPixelX: parsed.mmPerPixelX,
        mmPerPixelY: parsed.mmPerPixelY,
        framingOverlayPass: parsed.framingOverlayPass,
        repeatabilityPass: parsed.repeatabilityPass,
        frontPackageDir: parsed.frontDir,
        backPackageDir: parsed.backDir,
      };
      if (!parsed.outputDir) {
        const manifest = buildAiGraderStationWorkflowManifest({
          mockRun: common.mockRun,
          acceptedLightingProfile: undefined,
          exposureUs: common.exposureUs,
          gain: common.gain,
          frontMetrics: common.frontClippedFraction === undefined ? undefined : { clippedFraction: common.frontClippedFraction },
          backMetrics: common.backClippedFraction === undefined ? undefined : { clippedFraction: common.backClippedFraction },
          operatorAcceptedWarnings: common.operatorAcceptedWarnings,
          calibrationProfileId: common.calibrationProfileId,
          mmPerPixelX: common.mmPerPixelX,
          mmPerPixelY: common.mmPerPixelY,
          framingOverlayPass: common.framingOverlayPass,
          repeatabilityPass: common.repeatabilityPass,
          frontPackageDir: common.frontPackageDir,
          backPackageDir: common.backPackageDir,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "ai-grader-station-operator-workflow",
          dryRun: true,
          manifest,
        });
        return 0;
      }
      const manifest = await writeAiGraderStationWorkflowArtifacts({
        outputDir: parsed.outputDir,
        ...common,
      });
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "ai-grader-station-operator-workflow",
        manifestPath: manifest.manifestPath,
        reportPath: manifest.reportPath,
        contractPath: manifest.contractPath,
        activeLightingProfilePath: manifest.packageDir
          ? path.join(manifest.packageDir, "fixed-rig-active-lighting-profile.json")
          : undefined,
        manifest,
        hardwareSmokeStatus: "pending_mark_present",
        safety: manifest.safety,
      });
      return 0;
    }

    if (parsed.command === "basler-fixed-rig-focus-assist") {
      const {
        BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION,
        analyzeFixedRigMacroQuality,
        assertFixedRigOutputDirAllowed,
        buildFixedRigFocusAssistManifest,
        buildFixedRigActiveLightingProfile,
        createFixedRigPackageDir,
        resolveFixedRigActiveLightingProfile,
        writeFixedRigFocusAssistArtifacts,
      } = await import("./drivers/baslerFixedRigV1");
      const {
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
      } = await import("./drivers/baslerLeimacFullRig");
      const { buildBaslerLeimacPolaritySmokePlan } = await import("./drivers/baslerLeimacSync");

      const exposureUs = parsed.exposureUs ?? 50000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("basler-fixed-rig-focus-assist --exposure-us must be from 1 to 100000.");
      }
      const activeLightingProfile = parsed.outputDir
        ? await resolveFixedRigActiveLightingProfile({
            outputDir: parsed.outputDir,
            cliDuty: parsed.duty,
            resetToDefault: parsed.resetDefaultLightingProfile,
          })
        : buildFixedRigActiveLightingProfile({ selectedDutyPercent: parsed.duty, profileSource: parsed.duty == null ? "default" : "cli_override" });
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: activeLightingProfile.selectedDutyPercent,
        exposureUs,
        candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        dryRun: !parsed.apply,
      });

      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertFixedRigOutputDirAllowed(parsed.outputDir);
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-fixed-rig-focus-assist",
          dryRun: true,
          plan,
          manifest: buildFixedRigFocusAssistManifest({
            packageId: "planned-basler-fixed-rig-focus-assist",
            packageDir: parsed.outputDir ?? "",
            status: "planned",
            safeOffBefore: false,
            safeOffAfter: false,
            activeLightingProfile,
          }),
        });
        return 0;
      }

      if (parsed.confirmation !== BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-fixed-rig-focus-assist --apply requires --confirm "${BASLER_FIXED_RIG_FOCUS_ASSIST_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("basler-fixed-rig-focus-assist --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-fixed-rig-focus-assist --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("basler-fixed-rig-focus-assist --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("basler-fixed-rig-focus-assist --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("basler-fixed-rig-focus-assist --apply requires --operator-confirmed-light-idle-off.");
      }

      const env = io.env ?? process.env;
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "basler-fixed-rig-focus-assist");
      const macroOutputDir = path.join(packageDir, "basler-macro");
      let macroStdout = "";
      let macroStderr = "";
      const macroCode = await runCaptureHelperCli([
        "basler-leimac-macro-package",
        "--leimac-host",
        parsed.leimacHost,
        "--leimac-port",
        String(parsed.leimacPort ?? 1000),
        "--output-dir",
        macroOutputDir,
        "--profile",
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        "--duty",
        String(plan.dutyPercent),
        "--exposure-us",
        String(exposureUs),
        "--include-dark-control",
        "--apply",
        "--confirm",
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
        "--mark-present",
        "--wiring-confirmed",
        "--leimac-status-green",
        "--operator-confirmed-light-idle-off",
        ...(parsed.pylonRoot ? ["--pylon-root", parsed.pylonRoot] : []),
        ...(parsed.pylonTimeoutMs ? ["--pylon-timeout-ms", String(parsed.pylonTimeoutMs)] : []),
        ...(parsed.baslerBridgeScript ? ["--bridge-script", parsed.baslerBridgeScript] : []),
        ...(parsed.cameraIndex !== undefined ? ["--camera-index", String(parsed.cameraIndex)] : []),
        ...(parsed.leimacTimeoutMs ? ["--timeout-ms", String(parsed.leimacTimeoutMs)] : []),
        ...(parsed.leimacUnit ? ["--unit", String(parsed.leimacUnit)] : []),
      ], {
        env,
        stdout: (chunk) => {
          macroStdout += chunk;
        },
        stderr: (chunk) => {
          macroStderr += chunk;
        },
      });
      const macroResult = macroStdout ? JSON.parse(macroStdout) : undefined;
      const macroError = macroStderr ? JSON.parse(macroStderr) : undefined;
      if (macroCode !== 0 || !macroResult?.manifest?.synced?.capture?.outputFilePath) {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-fixed-rig-focus-assist",
          packageDir,
          macroResult,
          macroError,
          error: "Basler/Leimac macro package failed; focus assist metrics were not computed.",
        });
        return 1;
      }
      const quality = await analyzeFixedRigMacroQuality(macroResult.manifest.synced.capture.outputFilePath);
      const manifest = buildFixedRigFocusAssistManifest({
        packageId,
        packageDir,
        status: "captured",
        macroPackage: macroResult.manifest,
        quality,
        safeOffBefore: macroResult.manifest.safety.safeOffBefore,
        safeOffAfter: macroResult.manifest.safety.safeOffAfter,
        finalLightOffConfirmedByMark: false,
        activeLightingProfile,
      });
      const writtenManifest = await writeFixedRigFocusAssistArtifacts(manifest);
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "basler-fixed-rig-focus-assist",
        packageDir,
        macroPackage: macroResult,
        quality,
        manifestPath: writtenManifest.manifestPath,
        previewReportPath: writtenManifest.previewReportPath,
        manifest: writtenManifest,
        operatorPrompt: "Review sharpness/framing, adjust manual focus/height if needed, and confirm final Leimac ring-light state is off after safe-off.",
      });
      return 0;
    }

    if (parsed.command === "fixed-rig-fixture-calibration") {
      const {
        FIXED_RIG_FIXTURE_CALIBRATION_CONFIRMATION,
        applyFixedRigCardBoundaryOverride,
        analyzeFixedRigMacroQuality,
        assertFixedRigOutputDirAllowed,
        buildFixedRigActiveLightingProfile,
        buildFixedRigFixtureCalibrationProfile,
        createFixedRigPackageDir,
        resolveFixedRigActiveLightingProfile,
        writeFixedRigFixtureCalibrationArtifacts,
      } = await import("./drivers/baslerFixedRigV1");
      const {
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
      } = await import("./drivers/baslerLeimacFullRig");
      const { buildBaslerLeimacPolaritySmokePlan } = await import("./drivers/baslerLeimacSync");

      const exposureUs = parsed.exposureUs ?? 45000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("fixed-rig-fixture-calibration --exposure-us must be from 1 to 100000.");
      }
      const isRulerReference = parsed.referenceType === "fixed_metric_rulers";
      if (
        isRulerReference &&
        (parsed.horizontalSpanMm === undefined ||
          !parsed.horizontalStartPx ||
          !parsed.horizontalEndPx ||
          parsed.verticalSpanMm === undefined ||
          !parsed.verticalStartPx ||
          !parsed.verticalEndPx)
      ) {
        throw new CaptureHelperCommandError(
          "fixed-rig-fixture-calibration --reference-type fixed_metric_rulers requires --horizontal-span-mm, --horizontal-start-px, --horizontal-end-px, --vertical-span-mm, --vertical-start-px, and --vertical-end-px."
        );
      }
      const activeLightingProfile = parsed.outputDir
        ? await resolveFixedRigActiveLightingProfile({
            outputDir: parsed.outputDir,
            cliDuty: parsed.duty,
            resetToDefault: parsed.resetDefaultLightingProfile,
          })
        : buildFixedRigActiveLightingProfile({ selectedDutyPercent: parsed.duty, profileSource: parsed.duty == null ? "default" : "cli_override" });
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: activeLightingProfile.selectedDutyPercent,
        exposureUs,
        candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        dryRun: !parsed.apply,
      });
      const plannedFixtureProfile = buildFixedRigFixtureCalibrationProfile({
        profileId: "planned-fixed-rig-fixture-calibration-profile",
        fixtureId: parsed.fixtureId,
        fixtureLabel: parsed.fixtureLabel,
        referenceType: parsed.referenceType as any,
        referencePhysicalWidthMm: parsed.referenceWidthMm,
        referencePhysicalHeightMm: parsed.referenceHeightMm,
        horizontalSpanMm: parsed.horizontalSpanMm,
        horizontalStartPx: parsed.horizontalStartPx,
        horizontalEndPx: parsed.horizontalEndPx,
        verticalSpanMm: parsed.verticalSpanMm,
        verticalStartPx: parsed.verticalStartPx,
        verticalEndPx: parsed.verticalEndPx,
        activeLightingProfile,
        exposureUs,
        gain: parsed.gain ?? 0,
        operatorAccepted: parsed.operatorAccepted,
        operatorNotes: parsed.operatorNotes,
      });
      if (!parsed.apply) {
        if (parsed.outputDir) assertFixedRigOutputDirAllowed(parsed.outputDir);
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "fixed-rig-fixture-calibration",
          dryRun: true,
          plan,
          activeLightingProfile,
          fixtureCalibrationProfile: plannedFixtureProfile,
        });
        return 0;
      }
      if (parsed.confirmation !== FIXED_RIG_FIXTURE_CALIBRATION_CONFIRMATION) {
        throw new CaptureHelperCommandError(`fixed-rig-fixture-calibration --apply requires --confirm "${FIXED_RIG_FIXTURE_CALIBRATION_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) throw new CaptureHelperCommandError("fixed-rig-fixture-calibration --apply requires explicit --leimac-host <ip>.");
      if (!parsed.markPresent) throw new CaptureHelperCommandError("fixed-rig-fixture-calibration --apply requires --mark-present.");
      if (!parsed.wiringConfirmed) throw new CaptureHelperCommandError("fixed-rig-fixture-calibration --apply requires --wiring-confirmed.");
      if (!parsed.leimacStatusGreen) throw new CaptureHelperCommandError("fixed-rig-fixture-calibration --apply requires --leimac-status-green.");
      if (!parsed.operatorConfirmedLightIdleOff) throw new CaptureHelperCommandError("fixed-rig-fixture-calibration --apply requires --operator-confirmed-light-idle-off.");

      const env = io.env ?? process.env;
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "fixed-rig-fixture-calibration");
      const macroOutputDir = path.join(packageDir, "basler-macro");
      let macroStdout = "";
      let macroStderr = "";
      const macroCode = await runCaptureHelperCli([
        "basler-leimac-macro-package",
        "--leimac-host",
        parsed.leimacHost,
        "--leimac-port",
        String(parsed.leimacPort ?? 1000),
        "--output-dir",
        macroOutputDir,
        "--profile",
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        "--duty",
        String(plan.dutyPercent),
        "--exposure-us",
        String(exposureUs),
        "--include-dark-control",
        "--apply",
        "--confirm",
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
        "--mark-present",
        "--wiring-confirmed",
        "--leimac-status-green",
        "--operator-confirmed-light-idle-off",
        ...(parsed.pylonRoot ? ["--pylon-root", parsed.pylonRoot] : []),
        ...(parsed.pylonTimeoutMs ? ["--pylon-timeout-ms", String(parsed.pylonTimeoutMs)] : []),
        ...(parsed.baslerBridgeScript ? ["--bridge-script", parsed.baslerBridgeScript] : []),
        ...(parsed.cameraIndex !== undefined ? ["--camera-index", String(parsed.cameraIndex)] : []),
        ...(parsed.leimacTimeoutMs ? ["--timeout-ms", String(parsed.leimacTimeoutMs)] : []),
        ...(parsed.leimacUnit ? ["--unit", String(parsed.leimacUnit)] : []),
      ], {
        env,
        stdout: (chunk) => {
          macroStdout += chunk;
        },
        stderr: (chunk) => {
          macroStderr += chunk;
        },
      });
      const macroResult = macroStdout ? JSON.parse(macroStdout) : undefined;
      const macroError = macroStderr ? JSON.parse(macroStderr) : undefined;
      if (macroCode !== 0 || !macroResult?.manifest?.synced?.capture?.outputFilePath) {
        writeJson(stdout, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "fixed-rig-fixture-calibration",
          packageDir,
          macroResult,
          macroError,
          error: "Basler/Leimac macro package failed; rough fixture calibration was not computed.",
        });
        return 1;
      }
      const analyzedQuality = await analyzeFixedRigMacroQuality(macroResult.manifest.synced.capture.outputFilePath);
      const quality = parsed.cardBoundaryRect ? applyFixedRigCardBoundaryOverride(analyzedQuality, parsed.cardBoundaryRect) : analyzedQuality;
      const fixtureCalibrationProfile = buildFixedRigFixtureCalibrationProfile({
        profileId: `${packageId}-rough-fixture-profile`,
        fixtureId: parsed.fixtureId,
        fixtureLabel: parsed.fixtureLabel,
        referenceType: parsed.referenceType as any,
        referencePhysicalWidthMm: parsed.referenceWidthMm,
        referencePhysicalHeightMm: parsed.referenceHeightMm,
        horizontalSpanMm: parsed.horizontalSpanMm,
        horizontalStartPx: parsed.horizontalStartPx,
        horizontalEndPx: parsed.horizontalEndPx,
        verticalSpanMm: parsed.verticalSpanMm,
        verticalStartPx: parsed.verticalStartPx,
        verticalEndPx: parsed.verticalEndPx,
        calibrationImagePath: macroResult.manifest.synced.capture.outputFilePath,
        rawImageWidth: quality.width,
        rawImageHeight: quality.height,
        cardBoundary: quality.cardBoundary,
        activeLightingProfile,
        exposureUs,
        gain: parsed.gain ?? 0,
        operatorAccepted: parsed.operatorAccepted,
        operatorNotes: parsed.operatorNotes,
      });
      const writtenManifest = await writeFixedRigFixtureCalibrationArtifacts({
        packageId,
        packageDir,
        status: "captured",
        activeLightingProfile,
        macroPackage: macroResult.manifest,
        quality,
        fixtureCalibrationProfile,
        safeOffBefore: macroResult.manifest.safety.safeOffBefore,
        safeOffAfter: macroResult.manifest.safety.safeOffAfter,
      });
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "fixed-rig-fixture-calibration",
        packageDir,
        manifestPath: writtenManifest.manifestPath,
        analysisPath: writtenManifest.analysisPath,
        previewReportPath: writtenManifest.previewReportPath,
        fixtureCalibrationProfile,
        quality,
        operatorPrompt: "Review rough fixture calibration report and confirm final Leimac ring-light state is off.",
      });
      return 0;
    }

    if (parsed.command === "fixed-rig-repeatability-test") {
      const {
        FIXED_RIG_REPEATABILITY_TEST_CONFIRMATION,
        analyzeFixedRigMacroQuality,
        assertFixedRigOutputDirAllowed,
        buildFixedRigActiveLightingProfile,
        buildFixedRigFixtureCalibrationProfile,
        buildFixedRigRepeatabilityRun,
        buildFixedRigRepeatabilitySummary,
        applyFixedRigCardBoundaryOverride,
        createFixedRigPackageDir,
        resolveFixedRigActiveLightingProfile,
        writeFixedRigRepeatabilityArtifacts,
      } = await import("./drivers/baslerFixedRigV1");
      const {
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
      } = await import("./drivers/baslerLeimacFullRig");
      const { buildBaslerLeimacPolaritySmokePlan } = await import("./drivers/baslerLeimacSync");
      const exposureUs = parsed.exposureUs ?? 45000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("fixed-rig-repeatability-test --exposure-us must be from 1 to 100000.");
      }
      const activeLightingProfile = parsed.outputDir
        ? await resolveFixedRigActiveLightingProfile({
            outputDir: parsed.outputDir,
            cliDuty: parsed.duty,
            resetToDefault: parsed.resetDefaultLightingProfile,
          })
        : buildFixedRigActiveLightingProfile({ selectedDutyPercent: parsed.duty, profileSource: parsed.duty == null ? "default" : "cli_override" });
      const phase = parsed.repeatabilityPhase === "remove-replace" ? "remove_replace" : "no_touch";
      const requestedCaptureCount = parsed.captureCount ?? 5;
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: activeLightingProfile.selectedDutyPercent,
        exposureUs,
        candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        dryRun: !parsed.apply,
      });
      const fixtureCalibrationProfile = buildFixedRigFixtureCalibrationProfile({
        profileId: "planned-repeatability-rough-fixture-profile",
        fixtureId: parsed.fixtureId,
        fixtureLabel: parsed.fixtureLabel,
        referenceType: parsed.referenceType as any,
        referencePhysicalWidthMm: parsed.referenceWidthMm,
        referencePhysicalHeightMm: parsed.referenceHeightMm,
        horizontalSpanMm: parsed.horizontalSpanMm,
        horizontalStartPx: parsed.horizontalStartPx,
        horizontalEndPx: parsed.horizontalEndPx,
        verticalSpanMm: parsed.verticalSpanMm,
        verticalStartPx: parsed.verticalStartPx,
        verticalEndPx: parsed.verticalEndPx,
        activeLightingProfile,
        exposureUs,
        gain: parsed.gain ?? 0,
        operatorAccepted: parsed.operatorAccepted,
        operatorNotes: parsed.operatorNotes,
        status: "rough_reference_unvalidated",
      });
      if (!parsed.apply) {
        if (parsed.outputDir) assertFixedRigOutputDirAllowed(parsed.outputDir);
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "fixed-rig-repeatability-test",
          dryRun: true,
          plan,
          requestedCaptureCount,
          phase,
          activeLightingProfile,
          fixtureCalibrationProfile,
        });
        return 0;
      }
      if (parsed.confirmation !== FIXED_RIG_REPEATABILITY_TEST_CONFIRMATION) {
        throw new CaptureHelperCommandError(`fixed-rig-repeatability-test --apply requires --confirm "${FIXED_RIG_REPEATABILITY_TEST_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) throw new CaptureHelperCommandError("fixed-rig-repeatability-test --apply requires explicit --leimac-host <ip>.");
      if (!parsed.markPresent) throw new CaptureHelperCommandError("fixed-rig-repeatability-test --apply requires --mark-present.");
      if (!parsed.wiringConfirmed) throw new CaptureHelperCommandError("fixed-rig-repeatability-test --apply requires --wiring-confirmed.");
      if (!parsed.leimacStatusGreen) throw new CaptureHelperCommandError("fixed-rig-repeatability-test --apply requires --leimac-status-green.");
      if (!parsed.operatorConfirmedLightIdleOff) throw new CaptureHelperCommandError("fixed-rig-repeatability-test --apply requires --operator-confirmed-light-idle-off.");
      if (phase === "remove_replace" && !parsed.operatorReplaceConfirmed) {
        throw new CaptureHelperCommandError("fixed-rig-repeatability-test remove-replace phase requires --operator-replace-confirmed.");
      }

      const env = io.env ?? process.env;
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "fixed-rig-repeatability-test");
      const runs = [];
      let firstQuality;
      for (let index = 1; index <= requestedCaptureCount; index += 1) {
        if (phase === "remove_replace" && index > 1 && (parsed.operatorReplaceDelayMs ?? 0) > 0) {
          stderr(`Instruction: remove and re-seat the card for repeatability capture ${index}; waiting ${parsed.operatorReplaceDelayMs} ms.\n`);
          await sleep(parsed.operatorReplaceDelayMs ?? 0);
        }
        const macroOutputDir = path.join(packageDir, `capture-${String(index).padStart(2, "0")}`);
        let macroStdout = "";
        let macroStderr = "";
        const macroCode = await runCaptureHelperCli([
          "basler-leimac-macro-package",
          "--leimac-host",
          parsed.leimacHost,
          "--leimac-port",
          String(parsed.leimacPort ?? 1000),
          "--output-dir",
          macroOutputDir,
          "--profile",
          ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
          "--duty",
          String(plan.dutyPercent),
          "--exposure-us",
          String(exposureUs),
          "--include-dark-control",
          "--apply",
          "--confirm",
          BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
          "--mark-present",
          "--wiring-confirmed",
          "--leimac-status-green",
          "--operator-confirmed-light-idle-off",
          ...(parsed.pylonRoot ? ["--pylon-root", parsed.pylonRoot] : []),
          ...(parsed.pylonTimeoutMs ? ["--pylon-timeout-ms", String(parsed.pylonTimeoutMs)] : []),
          ...(parsed.baslerBridgeScript ? ["--bridge-script", parsed.baslerBridgeScript] : []),
          ...(parsed.cameraIndex !== undefined ? ["--camera-index", String(parsed.cameraIndex)] : []),
          ...(parsed.leimacTimeoutMs ? ["--timeout-ms", String(parsed.leimacTimeoutMs)] : []),
          ...(parsed.leimacUnit ? ["--unit", String(parsed.leimacUnit)] : []),
        ], {
          env,
          stdout: (chunk) => {
            macroStdout += chunk;
          },
          stderr: (chunk) => {
            macroStderr += chunk;
          },
        });
        const macroResult = macroStdout ? JSON.parse(macroStdout) : undefined;
        if (macroCode !== 0 || !macroResult?.manifest?.synced?.capture?.outputFilePath) {
          const macroError = macroStderr ? JSON.parse(macroStderr) : undefined;
          writeJson(stderr, { ok: false, command: "fixed-rig-repeatability-test", packageDir, captureIndex: index, macroResult, macroError });
          return 1;
        }
        const analyzedQuality = await analyzeFixedRigMacroQuality(macroResult.manifest.synced.capture.outputFilePath);
        const quality = parsed.cardBoundaryRect ? applyFixedRigCardBoundaryOverride(analyzedQuality, parsed.cardBoundaryRect) : analyzedQuality;
        firstQuality = firstQuality ?? quality;
        const runFixtureProfile = buildFixedRigFixtureCalibrationProfile({
          profileId: `${packageId}-repeatability-run-${index}-fixture-profile`,
          fixtureId: parsed.fixtureId,
          fixtureLabel: parsed.fixtureLabel,
          referenceType: parsed.referenceType as any,
          referencePhysicalWidthMm: parsed.referenceWidthMm,
          referencePhysicalHeightMm: parsed.referenceHeightMm,
          horizontalSpanMm: parsed.horizontalSpanMm,
          horizontalStartPx: parsed.horizontalStartPx,
          horizontalEndPx: parsed.horizontalEndPx,
          verticalSpanMm: parsed.verticalSpanMm,
          verticalStartPx: parsed.verticalStartPx,
          verticalEndPx: parsed.verticalEndPx,
          rawImageWidth: quality.width,
          rawImageHeight: quality.height,
          cardBoundary: quality.cardBoundary,
          activeLightingProfile,
          exposureUs,
          gain: parsed.gain ?? 0,
          operatorAccepted: parsed.operatorAccepted,
          operatorNotes: parsed.operatorNotes,
          status: "repeatability_checked",
        });
        runs.push(buildFixedRigRepeatabilityRun({ index, phase, capture: macroResult.manifest.synced.capture, quality, fixtureCalibrationProfile: runFixtureProfile }));
      }
      const completedFixtureProfile = buildFixedRigFixtureCalibrationProfile({
        profileId: `${packageId}-repeatability-fixture-profile`,
        fixtureId: parsed.fixtureId,
        fixtureLabel: parsed.fixtureLabel,
        referenceType: parsed.referenceType as any,
        referencePhysicalWidthMm: parsed.referenceWidthMm,
        referencePhysicalHeightMm: parsed.referenceHeightMm,
        horizontalSpanMm: parsed.horizontalSpanMm,
        horizontalStartPx: parsed.horizontalStartPx,
        horizontalEndPx: parsed.horizontalEndPx,
        verticalSpanMm: parsed.verticalSpanMm,
        verticalStartPx: parsed.verticalStartPx,
        verticalEndPx: parsed.verticalEndPx,
        rawImageWidth: firstQuality?.width,
        rawImageHeight: firstQuality?.height,
        cardBoundary: firstQuality?.cardBoundary,
        activeLightingProfile,
        exposureUs,
        gain: parsed.gain ?? 0,
        operatorAccepted: parsed.operatorAccepted,
        operatorNotes: parsed.operatorNotes,
        status: "repeatability_checked",
      });
      const summary = buildFixedRigRepeatabilitySummary(runs, phase);
      const writtenManifest = await writeFixedRigRepeatabilityArtifacts({
        packageId,
        packageDir,
        status: "completed",
        phase,
        requestedCaptureCount,
        activeLightingProfile,
        fixtureCalibrationProfile: completedFixtureProfile,
        runs,
        summary,
        safety: {
          localOnly: true,
          diagnosticOnly: true,
          safeOffBeforeEachCapture: true,
          safeOffAfterEachCapture: true,
          persistentBaslerSaved: false,
          persistentLeimacSaved: false,
          finalLightOffConfirmedByMark: false,
        },
        warning: "Diagnostic fixed-fixture repeatability only. This does not make the rig calibrated and does not produce a final/certified grade.",
      });
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "fixed-rig-repeatability-test",
        packageDir,
        manifestPath: writtenManifest.manifestPath,
        analysisPath: writtenManifest.analysisPath,
        previewReportPath: writtenManifest.previewReportPath,
        summary,
        operatorPrompt: "Review repeatability report and confirm final Leimac ring-light state is off.",
      });
      return 0;
    }

    if (parsed.command === "ai-grader-fixed-rig-v1-local") {
      const {
        AI_GRADER_FIXED_RIG_V1_CONFIRMATION,
        analyzeFixedRigMacroQuality,
        assertFixedRigOutputDirAllowed,
        buildFixedRigActiveLightingProfile,
        buildFixedRigSideCapture,
        buildFixedRigV1LocalManifest,
        createFixedRigPackageDir,
        resolveFixedRigActiveLightingProfile,
        writeFixedRigV1Artifacts,
      } = await import("./drivers/baslerFixedRigV1");
      const {
        ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
      } = await import("./drivers/baslerLeimacFullRig");
      const { buildBaslerLeimacPolaritySmokePlan } = await import("./drivers/baslerLeimacSync");

      const exposureUs = parsed.exposureUs ?? 50000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --exposure-us must be from 1 to 100000.");
      }
      const activeLightingProfile = parsed.outputDir
        ? await resolveFixedRigActiveLightingProfile({
            outputDir: parsed.outputDir,
            cliDuty: parsed.duty,
            resetToDefault: parsed.resetDefaultLightingProfile,
          })
        : buildFixedRigActiveLightingProfile({ selectedDutyPercent: parsed.duty, profileSource: parsed.duty == null ? "default" : "cli_override" });
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: activeLightingProfile.selectedDutyPercent,
        exposureUs,
        candidateId: ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
        dryRun: !parsed.apply,
      });

      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertFixedRigOutputDirAllowed(parsed.outputDir);
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "ai-grader-fixed-rig-v1-local",
          dryRun: true,
          plan,
          manifest: buildFixedRigV1LocalManifest({
            packageId: "planned-ai-grader-fixed-rig-v1-local",
            packageDir: parsed.outputDir ?? "",
            status: "planned",
            activeLightingProfile,
          }),
        });
        return 0;
      }

      if (parsed.confirmation !== AI_GRADER_FIXED_RIG_V1_CONFIRMATION) {
        throw new CaptureHelperCommandError(`ai-grader-fixed-rig-v1-local --apply requires --confirm "${AI_GRADER_FIXED_RIG_V1_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --apply requires --operator-confirmed-light-idle-off.");
      }
      if (!parsed.operatorFlipConfirmed) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-local --apply requires --operator-flip-confirmed before back-side capture.");
      }

      const env = io.env ?? process.env;
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "ai-grader-fixed-rig-v1-local");
      const leimacHost = parsed.leimacHost;
      const runSide = async (side: "front" | "back") => {
        stderr(side === "front"
          ? "Instruction: Place card face-up in the fixed tray/position before front capture.\n"
          : "Instruction: Flip card to the back side in the same fixed tray/position before back capture.\n");
        let macroStdout = "";
        let macroStderr = "";
        const macroCode = await runCaptureHelperCli([
          "basler-leimac-macro-package",
          "--leimac-host",
          leimacHost,
          "--leimac-port",
          String(parsed.leimacPort ?? 1000),
          "--output-dir",
          path.join(packageDir, `${side}-basler-macro`),
          "--profile",
          ACCEPTED_BASLER_LEIMAC_PROFILE_ID,
          "--duty",
          String(plan.dutyPercent),
          "--exposure-us",
          String(exposureUs),
          "--include-dark-control",
          "--apply",
          "--confirm",
          BASLER_LEIMAC_MACRO_PACKAGE_CONFIRMATION,
          "--mark-present",
          "--wiring-confirmed",
          "--leimac-status-green",
          "--operator-confirmed-light-idle-off",
          ...(parsed.pylonRoot ? ["--pylon-root", parsed.pylonRoot] : []),
          ...(parsed.pylonTimeoutMs ? ["--pylon-timeout-ms", String(parsed.pylonTimeoutMs)] : []),
          ...(parsed.baslerBridgeScript ? ["--bridge-script", parsed.baslerBridgeScript] : []),
          ...(parsed.cameraIndex !== undefined ? ["--camera-index", String(parsed.cameraIndex)] : []),
          ...(parsed.leimacTimeoutMs ? ["--timeout-ms", String(parsed.leimacTimeoutMs)] : []),
          ...(parsed.leimacUnit ? ["--unit", String(parsed.leimacUnit)] : []),
        ], {
          env,
          stdout: (chunk) => {
            macroStdout += chunk;
          },
          stderr: (chunk) => {
            macroStderr += chunk;
          },
        });
        const macroResult = macroStdout ? JSON.parse(macroStdout) : undefined;
        const macroError = macroStderr ? JSON.parse(macroStderr) : undefined;
        if (macroCode !== 0 || !macroResult?.manifest?.synced?.capture?.outputFilePath) {
          throw new CaptureHelperCommandError(
            `Fixed-rig ${side} Basler/Leimac macro stage failed: ${macroError?.error ?? macroResult?.error ?? "unknown"}`
          );
        }
        const quality = await analyzeFixedRigMacroQuality(macroResult.manifest.synced.capture.outputFilePath);
        return {
          macroResult,
          sideCapture: buildFixedRigSideCapture({
            side,
            macroPackage: macroResult.manifest,
            quality,
            activeLightingProfile,
          }),
        };
      };

      try {
        const front = await runSide("front");
        const flipDelayMs = parsed.operatorFlipDelayMs ?? 0;
        if (flipDelayMs > 0) {
          stderr(`Instruction: Front capture complete. Flip card to the back side now; waiting ${flipDelayMs} ms before back capture.\n`);
          await sleep(flipDelayMs);
        }
        const back = await runSide("back");
        const manifest = buildFixedRigV1LocalManifest({
          packageId,
          packageDir,
          status: "completed",
          front: front.sideCapture,
          back: back.sideCapture,
          activeLightingProfile,
          finalLightOffConfirmedByMark: false,
        });
        const writtenManifest = await writeFixedRigV1Artifacts(manifest);
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "ai-grader-fixed-rig-v1-local",
          packageDir,
          front: front.macroResult,
          back: back.macroResult,
          operatorFlipDelayMs: flipDelayMs,
          manifestPath: writtenManifest.manifestPath,
          analysisPath: writtenManifest.analysisPath,
          previewReportPath: writtenManifest.previewReportPath,
          manifest: writtenManifest,
          operatorPrompt: "Review front/back macro evidence and confirm final Leimac ring-light state is off after safe-off.",
        });
        return 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown fixed-rig V1 workflow error.";
        writeJson(stderr, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "ai-grader-fixed-rig-v1-local",
          packageDir,
          error: message,
        });
        return 1;
      }
    }

    if (parsed.command === "ai-grader-fixed-rig-v1-evidence-package") {
      const {
        AI_GRADER_FIXED_RIG_V1_EVIDENCE_PACKAGE_CONFIRMATION,
        analyzeFixedRigMacroQuality,
        analyzeFixedRigQuadrants,
        assertFixedRigOutputDirAllowed,
        buildFixedRigActiveLightingProfile,
        buildFixedRigDiagnosticGradingResult,
        buildFixedRigFixtureCalibrationProfile,
        buildFixedRigRoiDefinitions,
        applyFixedRigCardBoundaryOverride,
        addFixedRigDisplayRects,
        buildFixedRigSurfaceAnalysis,
        buildLeimacCharacterizationFrames,
        createFixedRigDisplayImage,
        createFixedRigOverlayPreview,
        createFixedRigPackageDir,
        createFixedRigRoiCrops,
        resolveFixedRigActiveLightingProfile,
        transformQualityForDisplay,
      } = await import("./drivers/baslerFixedRigV1");
      const {
        BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const { LeimacIdmuClient } = await import("./drivers/leimacIdmuClient");

      const exposureUs = parsed.exposureUs ?? 45000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --exposure-us must be from 1 to 100000.");
      }
      const isRulerReference = parsed.referenceType === "fixed_metric_rulers";
      if (
        isRulerReference &&
        (parsed.horizontalSpanMm === undefined ||
          parsed.horizontalStartPx === undefined ||
          parsed.horizontalEndPx === undefined ||
          parsed.verticalSpanMm === undefined ||
          parsed.verticalStartPx === undefined ||
          parsed.verticalEndPx === undefined)
      ) {
        throw new CaptureHelperCommandError(
          "ai-grader-fixed-rig-v1-evidence-package --reference-type fixed_metric_rulers requires --horizontal-span-mm, --horizontal-start-px, --horizontal-end-px, --vertical-span-mm, --vertical-start-px, and --vertical-end-px."
        );
      }
      const activeLightingProfile = parsed.outputDir
        ? await resolveFixedRigActiveLightingProfile({
            outputDir: parsed.outputDir,
            cliDuty: parsed.duty,
            resetToDefault: parsed.resetDefaultLightingProfile,
          })
        : buildFixedRigActiveLightingProfile({ selectedDutyPercent: parsed.duty, profileSource: parsed.duty == null ? "default" : "cli_override" });
      if (!parsed.apply) {
        if (parsed.outputDir) assertFixedRigOutputDirAllowed(parsed.outputDir);
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "ai-grader-fixed-rig-v1-evidence-package",
          dryRun: true,
          activeLightingProfile,
          plan: {
            sides: parsed.evidenceSide === "both" ? ["front", "back"] : [parsed.evidenceSide],
            capturesPerSide: [
              "dark-control",
              "all-on",
              "accepted-lighting-profile",
              "channel-1",
              "channel-2",
              "channel-3",
              "channel-4",
              "channel-5",
              "channel-6",
              "channel-7",
              "channel-8",
            ],
            evidenceClass: "macro_fixed_rig_v1_uncalibrated",
            isCalibrated: false,
            referenceType: parsed.referenceType ?? "card_dimensions",
            rulerSpans:
              parsed.referenceType === "fixed_metric_rulers"
                ? {
                    horizontalSpanMm: parsed.horizontalSpanMm,
                    horizontalStartPx: parsed.horizontalStartPx,
                    horizontalEndPx: parsed.horizontalEndPx,
                    verticalSpanMm: parsed.verticalSpanMm,
                    verticalStartPx: parsed.verticalStartPx,
                    verticalEndPx: parsed.verticalEndPx,
                  }
                : undefined,
            cardBoundaryRect: parsed.cardBoundaryRect,
          },
        });
        return 0;
      }
      if (parsed.confirmation !== AI_GRADER_FIXED_RIG_V1_EVIDENCE_PACKAGE_CONFIRMATION) {
        throw new CaptureHelperCommandError(
          `ai-grader-fixed-rig-v1-evidence-package --apply requires --confirm "${AI_GRADER_FIXED_RIG_V1_EVIDENCE_PACKAGE_CONFIRMATION}".`
        );
      }
      if (!parsed.leimacHost) throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --apply requires explicit --leimac-host <ip>.");
      if (!parsed.markPresent) throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --apply requires --mark-present.");
      if (!parsed.wiringConfirmed) throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --apply requires --wiring-confirmed.");
      if (!parsed.leimacStatusGreen) throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --apply requires --leimac-status-green.");
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --apply requires --operator-confirmed-light-idle-off.");
      }
      if ((parsed.evidenceSide === "back" || parsed.evidenceSide === "both") && !parsed.operatorFlipConfirmed) {
        throw new CaptureHelperCommandError("ai-grader-fixed-rig-v1-evidence-package --apply requires --operator-flip-confirmed before back-side capture.");
      }

      const env = io.env ?? process.env;
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "ai-grader-fixed-rig-v1-evidence-package");
      const { mkdir, writeFile } = await import("node:fs/promises");
      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });
      const runSide = async (side: "front" | "back") => {
        stderr(side === "front" ? "Instruction: Place card front side up for evidence package.\n" : "Instruction: Confirm card back side is up for evidence package.\n");
        const sideDir = path.join(packageDir, side);
        await mkdir(sideDir, { recursive: true });
        const safeOffBeforeDark = await leimacClient.safeOff(true);
        const darkControl = await baslerClient.captureStill({
          outputDir: sideDir,
          label: `${side}-dark-control`,
          cameraIndex: parsed.cameraIndex,
          savedFormat: "png",
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
          exposureUs,
        });
        const analyzedDarkStats = await analyzeFixedRigMacroQuality(darkControl.outputFilePath);
        const darkStats = parsed.cardBoundaryRect ? applyFixedRigCardBoundaryOverride(analyzedDarkStats, parsed.cardBoundaryRect) : analyzedDarkStats;
        const captureProfile = async (label: string, channel: number | "all" | readonly number[]) => {
          const safeOffBefore = await leimacClient.safeOff(true);
          const frames = buildLeimacCharacterizationFrames({
            channel,
            dutyPercent: activeLightingProfile.selectedDutyPercent,
            unit: parsed.leimacUnit,
          });
          const writes = await leimacClient.applyAllowlistedFrames(frames);
          if (!writes.every((write) => write.ok)) {
            const safeOffAfterFailure = await leimacClient.safeOff(true);
            throw new CaptureHelperCommandError(writes.find((write) => !write.ok)?.error ?? `Leimac ${label} writes failed.`);
          }
          const capture = await baslerClient.captureStill({
            outputDir: sideDir,
            label,
            cameraIndex: parsed.cameraIndex,
            savedFormat: "png",
            lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
            exposureUs,
          });
          const analyzedStats = await analyzeFixedRigMacroQuality(capture.outputFilePath);
          const stats = parsed.cardBoundaryRect ? applyFixedRigCardBoundaryOverride(analyzedStats, parsed.cardBoundaryRect) : analyzedStats;
          const quadrantBrightness = await analyzeFixedRigQuadrants(capture.outputFilePath);
          const safeOffAfter = await leimacClient.safeOff(true);
          return { label, channel, frames, writes, capture, stats, quadrantBrightness, safeOffBefore, safeOffAfter };
        };
        const allOn = await captureProfile(`${side}-all-on`, "all");
        const acceptedProfile = await captureProfile(`${side}-accepted-lighting-profile`, activeLightingProfile.selectedChannels);
        const channels = [];
        for (let channel = 1; channel <= 8; channel += 1) {
          const channelCapture = await captureProfile(`${side}-channel-${channel}`, channel);
          channels.push({ ...channelCapture, channel });
        }
        const channelDisplayImages: Array<{ channel: number; displayImage: Awaited<ReturnType<typeof createFixedRigDisplayImage>> }> = [];
        for (const channelCapture of channels) {
          channelDisplayImages.push({
            channel: channelCapture.channel,
            displayImage: await createFixedRigDisplayImage({
              sourceImagePath: channelCapture.capture.outputFilePath,
              outputDir: sideDir,
              filePrefix: `${side}-channel-${channelCapture.channel}`,
              rawSourceSha256: channelCapture.capture.sha256,
            }),
          });
        }
        const rois = addFixedRigDisplayRects(buildFixedRigRoiDefinitions(allOn.stats.cardBoundary), allOn.stats.width, allOn.stats.height);
        const displayImage = await createFixedRigDisplayImage({
          sourceImagePath: allOn.capture.outputFilePath,
          outputDir: sideDir,
          filePrefix: `${side}-all-on`,
          rawSourceSha256: allOn.capture.sha256,
        });
        const overlayPreview = await createFixedRigOverlayPreview({
          sourceImagePath: displayImage.outputFilePath,
          outputDir: sideDir,
          filePrefix: `${side}-all-on`,
          quality: transformQualityForDisplay(allOn.stats, displayImage.displayTransform),
          roiDefinitions: rois.map((roi) => (roi.displayRect ? { ...roi, rect: roi.displayRect } : roi)),
          title: `${side} evidence overlay`,
          displayTransform: displayImage.displayTransform,
        });
        const roiCrops = await createFixedRigRoiCrops({
          sourceDisplayImagePath: displayImage.outputFilePath,
          rawSourceImagePath: allOn.capture.outputFilePath,
          outputDir: path.join(sideDir, "roi-crops"),
          rois,
          displayTransform: displayImage.displayTransform,
          rawSourceSha256: allOn.capture.sha256,
          filePrefix: side,
        });
        const surfaceAnalysis = buildFixedRigSurfaceAnalysis({
          side,
          channels: channels.map((channelCapture) => ({
            channel: channelCapture.channel,
            stats: channelCapture.stats,
            displayImage: channelDisplayImages.find((entry) => entry.channel === channelCapture.channel)?.displayImage,
          })),
          roiDefinitions: rois,
          warnings: allOn.stats.warnings,
        });
        const fixtureCalibrationProfile = buildFixedRigFixtureCalibrationProfile({
          profileId: `${packageId}-${side}-rough-fixture-profile`,
          fixtureLabel: parsed.fixtureLabel ?? "operator-built-fixed-position-v1-fixture",
          fixtureId: parsed.fixtureId,
          referenceType: (parsed.referenceType as any) ?? "card_dimensions",
          referencePhysicalWidthMm: parsed.referenceWidthMm,
          referencePhysicalHeightMm: parsed.referenceHeightMm,
          horizontalSpanMm: parsed.horizontalSpanMm,
          horizontalStartPx: parsed.horizontalStartPx,
          horizontalEndPx: parsed.horizontalEndPx,
          verticalSpanMm: parsed.verticalSpanMm,
          verticalStartPx: parsed.verticalStartPx,
          verticalEndPx: parsed.verticalEndPx,
          calibrationImagePath: allOn.capture.outputFilePath,
          rawImageWidth: allOn.stats.width,
          rawImageHeight: allOn.stats.height,
          cardBoundary: allOn.stats.cardBoundary,
          activeLightingProfile,
          exposureUs,
          gain: parsed.gain ?? 0,
          operatorAccepted: true,
          operatorNotes:
            parsed.referenceType === "fixed_metric_rulers"
              ? "Generated from fixed-rig V1 evidence package using operator-supplied fixed-ruler spans; still uncalibrated and diagnostic only."
              : "Generated from fixed-rig V1 evidence package; rough reference uses standard card dimensions.",
        });
        const diagnosticGrading = buildFixedRigDiagnosticGradingResult({
          side,
          quality: allOn.stats,
          roiDefinitions: rois,
          fixtureCalibrationProfile,
          surfaceAnalysis,
        });
        return {
          side,
          safeOffBeforeDark,
          darkControl: { capture: darkControl, stats: darkStats },
          allOn,
          acceptedProfile,
          channels,
          channelDisplayImages,
          roiDefinitions: rois,
          displayImage,
          overlayPreview,
          roiCrops,
          fixtureCalibrationProfile,
          surfaceAnalysis,
          diagnosticGrading,
        };
      };
      let safeOffEnd;
      try {
        const unitInfo = await leimacClient.readCommand("unitInfo");
        if (!unitInfo.ok) throw new CaptureHelperCommandError("Leimac unit information read failed before evidence package.");
        await baslerClient.configureLine2ExposureActive({
          apply: true,
          confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
          cameraIndex: parsed.cameraIndex,
          lineInverter: true,
        });
        const safeOffStart = await leimacClient.safeOff(true);
        const front = parsed.evidenceSide === "front" || parsed.evidenceSide === "both" ? await runSide("front") : null;
        const flipDelayMs = parsed.operatorFlipDelayMs ?? 0;
        if (parsed.evidenceSide === "both" && flipDelayMs > 0) {
          stderr(`Instruction: Front evidence package complete. Flip card to back side now; waiting ${flipDelayMs} ms.\n`);
          await sleep(flipDelayMs);
        }
        const back = parsed.evidenceSide === "back" || parsed.evidenceSide === "both" ? await runSide("back") : null;
        safeOffEnd = await leimacClient.safeOff(true);
        const manifest = {
          packageId,
          packageDir,
          status: "completed",
          evidenceClass: "macro_fixed_rig_v1_uncalibrated",
          isCalibrated: false,
          rawCoordinateFrame: "basler_sensor_pixels",
          displayCoordinateFrame: "ai_grader_card_portrait_display",
          evidenceSide: parsed.evidenceSide,
          activeLightingProfile,
          exposureUs,
          gain: parsed.gain ?? 0,
          unitInfo,
          safeOffStart,
          safeOffEnd,
          ...(front ? { front } : {}),
          ...(back ? { back } : {}),
          suggestedDinoLiteTargets: { status: "not_computed", reason: "surface anomaly detector not implemented yet" },
          note: "Uncalibrated fixed-rig V1 evidence package only; no final grade, certificate, or certified grading claim.",
        };
        const manifestPath = path.join(packageDir, "manifest.json");
        const analysisPath = path.join(packageDir, "analysis.json");
        const previewReportPath = path.join(packageDir, "preview-report.html");
        await writeFile(manifestPath, `${JSON.stringify({ ...manifest, manifestPath, analysisPath, previewReportPath }, null, 2)}\n`, "utf-8");
        await writeFile(
          analysisPath,
          `${JSON.stringify(
            {
              status: "computed_diagnostic",
              evidenceClass: manifest.evidenceClass,
              activeLightingProfile,
              ...(front
                ? {
                    front: {
                      allOn: front.allOn.stats,
                      acceptedProfile: front.acceptedProfile.stats,
                      fixtureCalibrationProfile: front.fixtureCalibrationProfile,
                      surfaceAnalysis: front.surfaceAnalysis,
                      diagnosticGrading: front.diagnosticGrading,
                    },
                  }
                : {}),
              ...(back
                ? {
                    back: {
                      allOn: back.allOn.stats,
                      acceptedProfile: back.acceptedProfile.stats,
                      fixtureCalibrationProfile: back.fixtureCalibrationProfile,
                      surfaceAnalysis: back.surfaceAnalysis,
                      diagnosticGrading: back.diagnosticGrading,
                    },
                  }
                : {}),
              finalGradeComputed: false,
              certifiedClaim: false,
            },
            null,
            2
          )}\n`,
          "utf-8"
        );
        await writeFile(
          previewReportPath,
          `<!doctype html><html><head><meta charset="utf-8"><title>Fixed-Rig V1 Evidence Package - Provisional Diagnostic</title><style>body{font-family:Arial,sans-serif;margin:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}img{max-width:100%;border:1px solid #aaa;background:#111}.warn{border-left:4px solid #a33;padding:8px 12px;background:#fff}.banner{border:2px solid #a33;background:#fff4f4;padding:12px 16px;font-weight:bold}table{border-collapse:collapse;width:100%;margin:8px 0 16px}td,th{border:1px solid #bbb;padding:6px 8px;text-align:left}</style></head><body><h1>Fixed-Rig V1 Evidence Package</h1><p class="banner">Provisional Diagnostic Only - Not Certified - No Final Grade</p><p class="warn">Uncalibrated diagnostic macro evidence package only. No final grade, certificate, or certified grading claim. Raw Basler evidence remains in sensor coordinates; display/ROI assets are derived portrait outputs.</p><p>Duty ${activeLightingProfile.selectedDutyPercent}% PWM ${activeLightingProfile.actualLeimacPwmStep}; channels ${activeLightingProfile.selectedChannels.join(", ")}; source ${activeLightingProfile.profileSource}; side ${parsed.evidenceSide}.</p>${front ? `<h2>Front Portrait Evidence</h2><img src="${front.displayImage.outputFilePath}" alt="front portrait all-on"><img src="${front.overlayPreview.outputFilePath}" alt="front portrait overlay"><p>Accepted profile raw capture: ${front.acceptedProfile.capture.outputFilePath}</p><p>Rough profile: ${front.fixtureCalibrationProfile.status}; pixel/mm ${front.fixtureCalibrationProfile.mmPerPixelX ?? "not_computed"} x ${front.fixtureCalibrationProfile.mmPerPixelY ?? "not_computed"}; diagnostic grading ${front.diagnosticGrading.status}; surface ${front.surfaceAnalysis.status}; candidates ${front.surfaceAnalysis.candidates.length}.</p><table><tr><th>Centering</th><td>${front.diagnosticGrading.centering.status} score ${front.diagnosticGrading.centering.score ?? "not_computed"}</td></tr><tr><th>Corners</th><td>TL ${front.diagnosticGrading.corners.topLeft.status}, TR ${front.diagnosticGrading.corners.topRight.status}, BR ${front.diagnosticGrading.corners.bottomRight.status}, BL ${front.diagnosticGrading.corners.bottomLeft.status}</td></tr><tr><th>Edges</th><td>T ${front.diagnosticGrading.edges.top.status}, R ${front.diagnosticGrading.edges.right.status}, B ${front.diagnosticGrading.edges.bottom.status}, L ${front.diagnosticGrading.edges.left.status}</td></tr><tr><th>Surface candidates</th><td>${front.surfaceAnalysis.candidates.map((candidate) => `${candidate.candidateId} ${candidate.severityBand} ${candidate.anomalyProxyScore}`).join(", ") || "none"}</td></tr></table><h3>Front 8-channel portrait displays</h3><div class="grid">${front.channelDisplayImages.map((entry) => `<figure><img src="${entry.displayImage.outputFilePath}" alt="front channel ${entry.channel} portrait"><figcaption>front channel ${entry.channel}</figcaption></figure>`).join("")}</div>` : ""}${back ? `<h2>Back Portrait Evidence</h2><img src="${back.displayImage.outputFilePath}" alt="back portrait all-on"><img src="${back.overlayPreview.outputFilePath}" alt="back portrait overlay"><p>Accepted profile raw capture: ${back.acceptedProfile.capture.outputFilePath}</p><p>Rough profile: ${back.fixtureCalibrationProfile.status}; pixel/mm ${back.fixtureCalibrationProfile.mmPerPixelX ?? "not_computed"} x ${back.fixtureCalibrationProfile.mmPerPixelY ?? "not_computed"}; diagnostic grading ${back.diagnosticGrading.status}; surface ${back.surfaceAnalysis.status}; candidates ${back.surfaceAnalysis.candidates.length}.</p><table><tr><th>Centering</th><td>${back.diagnosticGrading.centering.status} score ${back.diagnosticGrading.centering.score ?? "not_computed"}</td></tr><tr><th>Corners</th><td>TL ${back.diagnosticGrading.corners.topLeft.status}, TR ${back.diagnosticGrading.corners.topRight.status}, BR ${back.diagnosticGrading.corners.bottomRight.status}, BL ${back.diagnosticGrading.corners.bottomLeft.status}</td></tr><tr><th>Edges</th><td>T ${back.diagnosticGrading.edges.top.status}, R ${back.diagnosticGrading.edges.right.status}, B ${back.diagnosticGrading.edges.bottom.status}, L ${back.diagnosticGrading.edges.left.status}</td></tr><tr><th>Surface candidates</th><td>${back.surfaceAnalysis.candidates.map((candidate) => `${candidate.candidateId} ${candidate.severityBand} ${candidate.anomalyProxyScore}`).join(", ") || "none"}</td></tr></table><h3>Back 8-channel portrait displays</h3><div class="grid">${back.channelDisplayImages.map((entry) => `<figure><img src="${entry.displayImage.outputFilePath}" alt="back channel ${entry.channel} portrait"><figcaption>back channel ${entry.channel}</figcaption></figure>`).join("")}</div>` : ""}<h2>ROI Crops</h2><div class="grid">${[...(front?.roiCrops ?? []), ...(back?.roiCrops ?? [])].map((crop) => `<figure><img src="${crop.outputFilePath}" alt="${crop.roiId}"><figcaption>${crop.roiId}</figcaption></figure>`).join("")}</div><h2>Diagnostic JSON</h2><pre>${JSON.stringify({ front: front?.diagnosticGrading, back: back?.diagnosticGrading }, null, 2).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`,
          "utf-8"
        );
        writeJson(stdout, {
          ok: safeOffStart.ok && safeOffEnd.ok,
          service: "ai-grader-capture-helper",
          command: "ai-grader-fixed-rig-v1-evidence-package",
          packageDir,
          manifestPath,
          analysisPath,
          previewReportPath,
          manifest: { ...manifest, manifestPath, analysisPath, previewReportPath },
          operatorPrompt: "Review portrait evidence package and confirm final Leimac ring-light state is off after safe-off.",
        });
        return safeOffStart.ok && safeOffEnd.ok ? 0 : 1;
      } catch (error) {
        safeOffEnd = await leimacClient.safeOff(true);
        const message = error instanceof Error ? error.message : "Unknown fixed-rig evidence package error.";
        writeJson(stderr, { ok: false, service: "ai-grader-capture-helper", command: "ai-grader-fixed-rig-v1-evidence-package", packageDir, safeOffEnd, error: message });
        return 1;
      }
    }

    if (parsed.command === "leimac-channel-characterization") {
      const {
        LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION,
        analyzeFixedRigMacroQuality,
        analyzeFixedRigQuadrants,
        assertFixedRigOutputDirAllowed,
        buildLeimacChannelCharacterizationManifest,
        buildLeimacCharacterizationFrames,
        createFixedRigPackageDir,
        writeLeimacChannelCharacterizationArtifacts,
      } = await import("./drivers/baslerFixedRigV1");
      const {
        BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const { LeimacIdmuClient } = await import("./drivers/leimacIdmuClient");

      const duty = parsed.duty ?? 1;
      const exposureUs = parsed.exposureUs ?? 45000;
      if (!Number.isFinite(duty) || duty < 0 || duty > 5) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --duty must be from 0 to 5.");
      }
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --exposure-us must be from 1 to 100000.");
      }

      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertFixedRigOutputDirAllowed(parsed.outputDir);
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "leimac-channel-characterization",
          dryRun: true,
          manifest: buildLeimacChannelCharacterizationManifest({
            packageId: "planned-leimac-channel-characterization",
            packageDir: parsed.outputDir ?? "",
            status: "planned",
            dutyPercent: duty,
            exposureUs,
            gain: parsed.gain ?? 0,
          }),
        });
        return 0;
      }
      if (parsed.confirmation !== LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION) {
        throw new CaptureHelperCommandError(`leimac-channel-characterization --apply requires --confirm "${LEIMAC_CHANNEL_CHARACTERIZATION_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("leimac-channel-characterization --apply requires --operator-confirmed-light-idle-off.");
      }

      const env = io.env ?? process.env;
      const { packageId, packageDir } = await createFixedRigPackageDir(parsed.outputDir ?? "", "leimac-channel-characterization");
      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });
      let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
      try {
        const unitInfo = await leimacClient.readCommand("unitInfo");
        if (!unitInfo.ok) {
          throw new CaptureHelperCommandError("Leimac unit information read failed before channel characterization.");
        }
        await baslerClient.configureLine2ExposureActive({
          apply: true,
          confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
          cameraIndex: parsed.cameraIndex,
          lineInverter: true,
        });

        const safeOffStart = await leimacClient.safeOff(true);
        const darkCapture = await baslerClient.captureStill({
          outputDir: packageDir,
          label: "leimac-channel-dark-control",
          cameraIndex: parsed.cameraIndex,
          savedFormat: "png",
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
          exposureUs,
        });
        const darkStats = await analyzeFixedRigMacroQuality(darkCapture.outputFilePath);

        const runProfileCapture = async (label: string, channel: number | "all") => {
          const safeOffBefore = await leimacClient.safeOff(true);
          const frames = buildLeimacCharacterizationFrames({ channel, dutyPercent: duty, unit: parsed.leimacUnit });
          const writes = await leimacClient.applyAllowlistedFrames(frames);
          if (!writes.every((write) => write.ok)) {
            const safeOffAfterFailure = await leimacClient.safeOff(true);
            return {
              frames,
              writes,
              safeOffBefore,
              safeOffAfter: safeOffAfterFailure,
              error: writes.find((write) => !write.ok)?.error ?? "Leimac channel characterization write failed.",
            };
          }
          const capture = await baslerClient.captureStill({
            outputDir: packageDir,
            label,
            cameraIndex: parsed.cameraIndex,
            savedFormat: "png",
            lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
            exposureUs,
          });
          const stats = await analyzeFixedRigMacroQuality(capture.outputFilePath);
          const quadrantBrightness = await analyzeFixedRigQuadrants(capture.outputFilePath);
          const safeOffAfter = await leimacClient.safeOff(true);
          return { frames, writes, safeOffBefore, safeOffAfter, capture, stats, quadrantBrightness };
        };

        const allOnResult = await runProfileCapture("leimac-channel-all-on", "all");
        const channels = [];
        for (let channel = 1; channel <= 8; channel += 1) {
          const result = await runProfileCapture(`leimac-channel-${channel}`, channel);
          channels.push({
            channel,
            label: `channel ${channel}`,
            status: result.capture ? "captured" as const : "failed" as const,
            frames: result.frames,
            safeOffBefore: result.safeOffBefore,
            safeOffAfter: result.safeOffAfter,
            writes: result.writes,
            ...(result.capture ? { capture: result.capture } : {}),
            ...(result.stats ? { stats: result.stats } : {}),
            ...(result.quadrantBrightness ? { quadrantBrightness: result.quadrantBrightness } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
          if (result.error) break;
        }
        safeOffEnd = await leimacClient.safeOff(true);
        const manifest = buildLeimacChannelCharacterizationManifest({
          packageId,
          packageDir,
          status: channels.every((channel) => channel.status === "captured") ? "completed" : "aborted",
          dutyPercent: duty,
          exposureUs,
          gain: parsed.gain ?? 0,
          unitInfo,
          darkControl: { capture: darkCapture, stats: darkStats },
          allOn: {
            frames: allOnResult.frames,
            ...(allOnResult.capture ? { capture: allOnResult.capture } : {}),
            ...(allOnResult.stats ? { stats: allOnResult.stats } : {}),
            ...(allOnResult.quadrantBrightness ? { quadrantBrightness: allOnResult.quadrantBrightness } : {}),
          },
          channels,
          finalLightOffConfirmedByMark: false,
        });
        const writtenManifest = await writeLeimacChannelCharacterizationArtifacts(manifest);
        writeJson(stdout, {
          ok: manifest.status === "completed" && safeOffEnd.ok && safeOffStart.ok,
          service: "ai-grader-capture-helper",
          command: "leimac-channel-characterization",
          packageDir,
          safeOffStart,
          safeOffEnd,
          manifestPath: writtenManifest.manifestPath,
          analysisPath: writtenManifest.analysisPath,
          previewReportPath: writtenManifest.previewReportPath,
          manifest: writtenManifest,
          operatorPrompt: "Review channel report/contact sheet and confirm final Leimac ring-light state is off after safe-off.",
        });
        return manifest.status === "completed" && safeOffEnd.ok && safeOffStart.ok ? 0 : 1;
      } catch (error) {
        safeOffEnd = await leimacClient.safeOff(true);
        const message = error instanceof Error ? error.message : "Unknown Leimac channel characterization error.";
        writeJson(stderr, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "leimac-channel-characterization",
          packageDir,
          safeOffEnd,
          error: message,
        });
        return 1;
      }
    }

    if (parsed.command === "basler-leimac-image-stat-sync-smoke") {
      const env = io.env ?? process.env;
      const {
        BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION,
        assertBaslerLeimacSyncSmokeOutputDirAllowed,
        analyzeBaslerLeimacImageStats,
        buildBaslerLeimacImageStatSyncSmokeManifest,
        buildBaslerLeimacPolaritySmokePlan,
      } = await import("./drivers/baslerLeimacSync");
      const {
        BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const {
        LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        LeimacIdmuClient,
        buildLeimacIdmuTriggerProfilePlan,
      } = await import("./drivers/leimacIdmuClient");

      const exposureUs = parsed.exposureUs ?? 50000;
      if (!Number.isInteger(exposureUs) || exposureUs <= 0 || exposureUs > 100000) {
        throw new CaptureHelperCommandError("basler-leimac-image-stat-sync-smoke --exposure-us must be from 1 to 100000.");
      }
      const plan = buildBaslerLeimacPolaritySmokePlan({
        dutyPercent: parsed.duty ?? 3,
        exposureUs,
        candidateId: parsed.polarityCandidate ?? "line2-inverter-level-low",
        dryRun: !parsed.apply,
      });
      const candidate = plan.selectedCandidate ?? plan.candidates[1];
      const profilePlan = buildLeimacIdmuTriggerProfilePlan({
        dutyPercent: plan.dutyPercent,
        unit: parsed.leimacUnit,
        triggerActivation: candidate.leimacTriggerActivation,
      });

      if (!parsed.apply) {
        if (parsed.outputDir) {
          assertBaslerLeimacSyncSmokeOutputDirAllowed(parsed.outputDir);
        }
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-image-stat-sync-smoke",
          dryRun: true,
          plan,
          manifest: buildBaslerLeimacImageStatSyncSmokeManifest({
            status: "planned",
            candidate,
            leimacHost: parsed.leimacHost ?? "0.0.0.0",
            leimacPort: parsed.leimacPort ?? 1000,
            leimacProfilePlan: profilePlan,
            requestedExposureUs: exposureUs,
            dutyPercent: plan.dutyPercent,
            supervised: false,
            safeOffBefore: false,
            safeOffAfter: false,
          }),
        });
        return 0;
      }

      const outputDir = assertBaslerLeimacSyncSmokeOutputDirAllowed(parsed.outputDir ?? "");
      if (parsed.confirmation !== BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-leimac-image-stat-sync-smoke --apply requires --confirm "${BASLER_LEIMAC_IMAGE_STAT_SYNC_SMOKE_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("basler-leimac-image-stat-sync-smoke --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-leimac-image-stat-sync-smoke --apply requires --mark-present.");
      }
      if (!parsed.wiringConfirmed) {
        throw new CaptureHelperCommandError("basler-leimac-image-stat-sync-smoke --apply requires --wiring-confirmed.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("basler-leimac-image-stat-sync-smoke --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightIdleOff) {
        throw new CaptureHelperCommandError("basler-leimac-image-stat-sync-smoke --apply requires --operator-confirmed-light-idle-off after the manual pulse proves idle-off behavior.");
      }

      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });

      let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
      try {
        const safeOffStart = await leimacClient.safeOff(true);
        if (!safeOffStart.ok) {
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-image-stat-sync-smoke",
            safeOffStart,
            error: "Leimac safe-off failed before dark control capture.",
          });
          return 1;
        }

        const cameraList = await baslerClient.listCameras();
        const cameraIndex = parsed.cameraIndex ?? 0;
        const camera = cameraList.cameras.find((entry) => entry.index === cameraIndex) ?? cameraList.cameras[cameraIndex];
        if (cameraList.status !== "reachable" || !camera) {
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-image-stat-sync-smoke",
            safeOffStart,
            cameraList,
            error: "Basler camera preflight failed.",
          });
          return 1;
        }

        const darkCapture = await baslerClient.captureStill({
          outputDir,
          label: `leimac-dark-control-${candidate.id}`,
          cameraIndex,
          savedFormat: "png",
          exposureUs,
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
        });
        const darkStats = await analyzeBaslerLeimacImageStats(darkCapture.outputFilePath);

        const line2 = await baslerClient.configureLine2ExposureActive({
          apply: true,
          confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
          cameraIndex,
          lineInverter: candidate.baslerLineInverter,
        });
        const leimacProfile = await leimacClient.applyTriggerProfile({
          profile: "basler-line2-trg-in1-low-duty",
          dutyPercent: plan.dutyPercent,
          triggerActivation: candidate.leimacTriggerActivation,
          apply: true,
          confirmation: LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        });
        const settingReadbacks = await leimacClient.readTriggerProfileSettings();
        if (!leimacProfile.ok) {
          safeOffEnd = await leimacClient.safeOff(true);
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-image-stat-sync-smoke",
            safeOffStart,
            darkControl: { capture: darkCapture, stats: darkStats },
            line2,
            leimacProfile,
            settingReadbacks,
            safeOffEnd,
            error: "Leimac trigger profile failed before synced capture.",
          });
          return 1;
        }

        const line2Status = await baslerClient.readLine2Status(cameraIndex);
        const syncedCapture = await baslerClient.captureStill({
          outputDir,
          label: `leimac-image-stat-sync-${candidate.id}`,
          cameraIndex,
          savedFormat: "png",
          exposureUs,
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
        });
        const syncedStats = await analyzeBaslerLeimacImageStats(syncedCapture.outputFilePath);
        safeOffEnd = await leimacClient.safeOff(true);
        const manifest = buildBaslerLeimacImageStatSyncSmokeManifest({
          status: "captured",
          candidate,
          leimacHost: parsed.leimacHost,
          leimacPort: parsed.leimacPort ?? 1000,
          leimacProfile,
          unitInfo: leimacProfile.unitInfo,
          settingReadbacks,
          baslerLine2: line2,
          baslerLine2Status: line2Status,
          requestedExposureUs: exposureUs,
          dutyPercent: plan.dutyPercent,
          darkControl: { capture: darkCapture, stats: darkStats },
          synced: { capture: syncedCapture, stats: syncedStats },
          supervised: true,
          safeOffBefore: safeOffStart.ok,
          safeOffAfter: safeOffEnd.ok,
          finalLightOffConfirmedByMark: false,
        });
        writeJson(stdout, {
          ok: safeOffEnd.ok,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-image-stat-sync-smoke",
          selectedCandidate: candidate,
          camera,
          safeOffStart,
          darkControl: { capture: darkCapture, stats: darkStats },
          line2,
          line2Status,
          leimacProfile,
          settingReadbacks,
          synced: { capture: syncedCapture, stats: syncedStats },
          safeOffEnd,
          manifest,
          operatorPrompt: "Confirm final Leimac ring-light state is off after safe-off.",
        });
        return safeOffEnd.ok ? 0 : 1;
      } catch (error) {
        if (!safeOffEnd && parsed.leimacHost) {
          safeOffEnd = await leimacClient.safeOff(true);
        }
        const message = error instanceof Error ? error.message : "Unknown Basler/Leimac image-stat sync smoke error.";
        writeJson(stderr, {
          ok: false,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-image-stat-sync-smoke",
          error: message,
          safeOffEnd,
        });
        return 1;
      }
    }

    if (parsed.command === "basler-leimac-sync-smoke") {
      const env = io.env ?? process.env;
      const {
        BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION,
        assertBaslerLeimacSyncSmokeOutputDirAllowed,
        buildBaslerLeimacSyncSmokeManifest,
      } = await import("./drivers/baslerLeimacSync");
      const {
        BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
        BaslerPylonClient,
      } = await import("./drivers/baslerPylonClient");
      const {
        LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        LeimacIdmuClient,
      } = await import("./drivers/leimacIdmuClient");

      const outputDir = assertBaslerLeimacSyncSmokeOutputDirAllowed(parsed.outputDir ?? "");
      if (!parsed.apply) {
        throw new CaptureHelperCommandError("basler-leimac-sync-smoke requires --apply.");
      }
      if (parsed.confirmation !== BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION) {
        throw new CaptureHelperCommandError(`basler-leimac-sync-smoke --apply requires --confirm "${BASLER_LEIMAC_SYNC_SMOKE_CONFIRMATION}".`);
      }
      if (!parsed.leimacHost) {
        throw new CaptureHelperCommandError("basler-leimac-sync-smoke --apply requires explicit --leimac-host <ip>.");
      }
      if (!parsed.markPresent) {
        throw new CaptureHelperCommandError("basler-leimac-sync-smoke --apply requires --mark-present.");
      }
      if (!parsed.unusedBaslerWiresInsulated) {
        throw new CaptureHelperCommandError("basler-leimac-sync-smoke --apply requires --unused-basler-wires-insulated.");
      }
      if (!parsed.leimacStatusGreen) {
        throw new CaptureHelperCommandError("basler-leimac-sync-smoke --apply requires --leimac-status-green.");
      }
      if (!parsed.operatorConfirmedLightNotContinuous) {
        throw new CaptureHelperCommandError(
          "basler-leimac-sync-smoke --apply requires --operator-confirmed-light-not-continuous after supervised profile configuration."
        );
      }

      const leimacClient = new LeimacIdmuClient({
        host: parsed.leimacHost,
        port: parsed.leimacPort,
        timeoutMs: parsed.leimacTimeoutMs,
        unit: parsed.leimacUnit,
      });
      const baslerClient = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath: parsed.baslerBridgeScript,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });

      let leimacProfile: Awaited<ReturnType<typeof leimacClient.applyTriggerProfile>> | undefined;
      let safeOffEnd: Awaited<ReturnType<typeof leimacClient.safeOff>> | undefined;
      try {
        leimacProfile = await leimacClient.applyTriggerProfile({
          profile: parsed.profile,
          dutyPercent: parsed.duty,
          apply: true,
          confirmation: LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
        });
        if (!leimacProfile.ok) {
          safeOffEnd = await leimacClient.safeOff(true);
          writeJson(stdout, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-sync-smoke",
            leimacProfile,
            safeOffEnd,
            error: "Leimac trigger profile failed before Basler configuration or capture.",
          });
          return 1;
        }

        const line2 = await baslerClient.configureLine2ExposureActive({
          apply: true,
          confirmation: BASLER_LINE2_EXPOSURE_ACTIVE_CONFIRMATION,
          cameraIndex: parsed.cameraIndex,
        });
        const capture = await baslerClient.captureStill({
          outputDir,
          label: "leimac-sync-smoke",
          cameraIndex: parsed.cameraIndex,
          savedFormat: "png",
          lensModel: env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL,
        });
        safeOffEnd = await leimacClient.safeOff(true);
        const manifest = buildBaslerLeimacSyncSmokeManifest({
          status: "captured",
          leimacHost: parsed.leimacHost,
          leimacPort: parsed.leimacPort ?? 1000,
          leimacProfile,
          baslerLine2: line2,
          requestedExposureUs: parsed.exposureUs,
          capture,
          supervised: true,
        });
        writeJson(stdout, {
          ok: safeOffEnd.ok,
          service: "ai-grader-capture-helper",
          command: "basler-leimac-sync-smoke",
          line2,
          leimacProfile,
          capture,
          safeOffEnd,
          manifest,
        });
        return safeOffEnd.ok ? 0 : 1;
      } catch (error) {
        if (leimacProfile?.applied && !safeOffEnd) {
          safeOffEnd = await leimacClient.safeOff(true);
        }
        if (safeOffEnd) {
          const message = error instanceof Error ? error.message : "Unknown Basler/Leimac sync smoke error.";
          writeJson(stderr, {
            ok: false,
            service: "ai-grader-capture-helper",
            command: "basler-leimac-sync-smoke",
            error: message,
            leimacProfile,
            safeOffEnd,
          });
          return 1;
        }
        throw error;
      }
    }

    if (
      parsed.command === "basler-readiness" ||
      parsed.command === "basler-list-cameras" ||
      parsed.command === "basler-line2-exposure-active" ||
      parsed.command === "basler-capture-still"
    ) {
      const env = io.env ?? process.env;
      const {
        BaslerPylonClient,
        normalizeBaslerSavedImageFormat,
      } = await import("./drivers/baslerPylonClient");
      const bridgeScriptPath = parsed.command === "basler-line2-exposure-active" ? parsed.baslerBridgeScript : undefined;
      const client = new BaslerPylonClient({
        pylonRoot: parsed.pylonRoot ?? env.TENKINGS_BASLER_PYLON_ROOT ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT,
        bridgeScriptPath,
        timeoutMs: parsed.pylonTimeoutMs,
        env,
      });

      if (parsed.command === "basler-readiness") {
        const readiness = await client.readiness();
        writeJson(stdout, {
          ok: readiness.status === "reachable",
          service: "ai-grader-capture-helper",
          command: "basler-readiness",
          readiness,
        });
        return readiness.status === "reachable" ? 0 : 1;
      }

      if (parsed.command === "basler-list-cameras") {
        const cameraList = await client.listCameras();
        writeJson(stdout, {
          ok: cameraList.status === "reachable",
          service: "ai-grader-capture-helper",
          command: "basler-list-cameras",
          cameraList,
        });
        return cameraList.status === "reachable" ? 0 : 1;
      }

      if (parsed.command === "basler-line2-exposure-active") {
        const line2 = await client.configureLine2ExposureActive({
          apply: parsed.apply,
          confirmation: parsed.confirmation,
          cameraIndex: parsed.cameraIndex,
          lineInverter: parsed.lineInverter,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-line2-exposure-active",
          line2,
        });
        return 0;
      }

      if (parsed.command === "basler-capture-still") {
        const lensModel =
          parsed.lensModel ?? env.TENKINGS_BASLER_LENS_MODEL ?? env.AI_GRADER_CAPTURE_HELPER_BASLER_LENS_MODEL;
        const capture = await client.captureStill({
          outputDir: parsed.outputDir ?? "",
          label: parsed.label ?? "",
          cameraIndex: parsed.cameraIndex,
          savedFormat: normalizeBaslerSavedImageFormat(parsed.savedFormat),
          lensModel,
          exposureUs: parsed.exposureUs,
        });
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "basler-capture-still",
          capture,
        });
        return 0;
      }
    }

    if (parsed.command === "dinolite-bridge-health") {
      const client = new DinoLiteBridgeClient({
        executablePath:
          parsed.config.dinoliteBridge?.executablePath ??
          (io.env ?? process.env).AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_PATH,
        adapter:
          parsed.config.dinoliteBridge?.adapter ??
          (((io.env ?? process.env).AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_ADAPTER as "fake" | undefined) ?? "fake"),
        timeoutMs: parsed.config.dinoliteBridge?.timeoutMs,
      });
      const [health, sdkInfo, devices, capabilities] = await Promise.all([
        client.health(),
        client.sdkInfo(),
        client.listDevices(),
        client.capabilities(),
      ]);
      await client.close();
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "dinolite-bridge-health",
        health,
        sdkInfo,
        devices,
        capabilities,
      });
      return 0;
    }

    if (parsed.command === "dinolite-enumerate") {
      const env = io.env ?? process.env;
      const executablePath =
        parsed.config.dinoliteBridge?.executablePath ?? env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_PATH;
      const adapter =
        parsed.config.dinoliteBridge?.adapter ??
        ((env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_ADAPTER as "fake" | "dnvideox" | undefined) ?? undefined);

      if (!executablePath || executablePath.trim().length === 0) {
        throw new CaptureHelperCommandError("dinolite-enumerate requires --bridge-exe <path>.");
      }
      if (adapter !== "fake" && adapter !== "dnvideox") {
        throw new CaptureHelperCommandError("dinolite-enumerate requires --adapter fake|dnvideox.");
      }

      const client = new DinoLiteBridgeClient({
        executablePath,
        adapter,
        timeoutMs: parsed.config.dinoliteBridge?.timeoutMs,
        manualEnumeration: true,
      });
      const enumeration = await client.enumerateDevices();
      await client.close();
      writeJson(stdout, {
        ok: !enumeration.error,
        service: "ai-grader-capture-helper",
        command: "dinolite-enumerate",
        enumeration,
      });
      return enumeration.error ? 1 : 0;
    }

    if (
      parsed.command === "dinolite-status" ||
      parsed.command === "dinolite-capture-still" ||
      parsed.command === "dinolite-capture-package" ||
      parsed.command === "dinolite-capture-demo-package" ||
      parsed.command === "dinolite-operator-workflow" ||
      parsed.command === "dinolite-experimental-grading-run"
    ) {
      const env = io.env ?? process.env;
      const executablePath =
        parsed.config.dinoliteBridge?.executablePath ?? env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_PATH;
      const adapter =
        parsed.config.dinoliteBridge?.adapter ??
        ((env.AI_GRADER_CAPTURE_HELPER_DINOLITE_BRIDGE_ADAPTER as "fake" | "dnvideox" | undefined) ?? undefined);

      if (!executablePath || executablePath.trim().length === 0) {
        throw new CaptureHelperCommandError(`${parsed.command} requires --bridge-exe <path>.`);
      }
      if (adapter !== "dnvideox") {
        throw new CaptureHelperCommandError(`${parsed.command} requires --adapter dnvideox.`);
      }
      if (parsed.deviceIndex === undefined) {
        throw new CaptureHelperCommandError(`${parsed.command} requires --device-index <index>.`);
      }

      const client = new DinoLiteBridgeClient({
        executablePath,
        adapter,
        timeoutMs: parsed.config.dinoliteBridge?.timeoutMs,
        manualHardwareAccess: true,
        sdkRuntimeDir:
          parsed.config.dinoliteBridge?.sdkRuntimeDir ??
          env.TENKINGS_DINOLITE_SDK_RUNTIME_DIR,
      });

      if (parsed.command === "dinolite-status") {
        const status = await client.status(parsed.deviceIndex);
        await client.close();
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: "dinolite-status",
          status,
        });
        return 0;
      }

      if (parsed.command === "dinolite-capture-package" || parsed.command === "dinolite-capture-demo-package") {
        if (!parsed.label || parsed.label.trim().length === 0) {
          throw new CaptureHelperCommandError(`${parsed.command} requires --label <label>.`);
        }
        const outputDir = assertDinoLiteCaptureOutputDirAllowed(parsed.outputDir ?? "");
        const sdkRuntimeDir =
          parsed.config.dinoliteBridge?.sdkRuntimeDir ?? env.TENKINGS_DINOLITE_SDK_RUNTIME_DIR;
        if (sdkRuntimeDir) {
          assertDinoLiteSdkRuntimeDirAllowed(sdkRuntimeDir);
        }
        const capturePackage = await client.capturePackage({
          deviceIndex: parsed.deviceIndex,
          outputDir,
          label: parsed.label,
          includeLightingSweep: parsed.includeLightingSweep,
          includeEdr: parsed.includeEdr,
          includeEdof: parsed.includeEdof,
        });
        await client.close();
        writeJson(stdout, {
          ok: true,
          service: "ai-grader-capture-helper",
          command: parsed.command,
          capturePackage,
        });
        return 0;
      }

      if (parsed.command === "dinolite-operator-workflow" || parsed.command === "dinolite-experimental-grading-run") {
        if (parsed.command === "dinolite-experimental-grading-run" && (!parsed.label || parsed.label.trim().length === 0)) {
          throw new CaptureHelperCommandError("dinolite-experimental-grading-run requires --label <label>.");
        }
        const outputDir = assertDinoLiteCaptureOutputDirAllowed(parsed.outputDir ?? "");
        const sdkRuntimeDir =
          parsed.config.dinoliteBridge?.sdkRuntimeDir ?? env.TENKINGS_DINOLITE_SDK_RUNTIME_DIR;
        if (sdkRuntimeDir) {
          assertDinoLiteSdkRuntimeDirAllowed(sdkRuntimeDir);
        }
        const workflowPlan = parsed.command === "dinolite-experimental-grading-run"
          ? "experimental-card-grading"
          : parsed.plan ?? "corners-basic";
        const cornerProfile = parsed.cornerProfile ?? "sharp_90";
        if (cornerProfile !== "sharp_90") {
          throw new CaptureHelperCommandError("--corner-profile currently supports sharp_90 only.");
        }
        const targets = describeDinoLiteOperatorPlan(workflowPlan, cornerProfile, parsed.captureGuides);
        stderr("Operator window shown\n");
        stderr(`Plan: ${workflowPlan}\n`);
        stderr(`Corner profile: ${cornerProfile}\n`);
        stderr(`Capture guides: ${parsed.captureGuides ? "enabled" : "disabled"}\n`);
        targets.forEach((target, index) => {
          stderr(`Target ${index + 1}/${targets.length}: ${target.name}\n`);
          stderr(`Instruction: ${target.instruction}\n`);
          if (target.guide) stderr(`${target.guide}\n`);
        });
        stderr("Waiting for Capture/Skip/Abort in the local operator window.\n");
        const workflow = await client.operatorWorkflow({
          deviceIndex: parsed.deviceIndex,
          outputDir,
          label: parsed.label,
          plan: workflowPlan,
          includeFlcSweep: parsed.includeFlcSweep,
          includeEdr: parsed.includeEdr,
          includeEdof: parsed.includeEdof,
          cornerProfile,
          captureGuides: parsed.captureGuides,
        });
        await client.close();
        if (parsed.command === "dinolite-experimental-grading-run") {
          const analysis = await analyzeDinoLiteExperimentalGradingWorkflow(workflow, {
            cornerProfile,
            captureGuides: parsed.captureGuides,
          });
          writeJson(stdout, {
            ok: workflow.status !== "aborted",
            service: "ai-grader-capture-helper",
            command: "dinolite-experimental-grading-run",
            workflow,
            analysis,
          });
          return workflow.status === "aborted" ? 1 : 0;
        }
        writeJson(stdout, {
          ok: workflow.status !== "aborted",
          service: "ai-grader-capture-helper",
          command: "dinolite-operator-workflow",
          workflow,
        });
        return workflow.status === "aborted" ? 1 : 0;
      }

      const outputDir = assertDinoLiteCaptureOutputDirAllowed(parsed.outputDir ?? "");
      const capture = await client.captureStillJpg(parsed.deviceIndex, outputDir);
      await client.close();
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        command: "dinolite-capture-still",
        capture,
      });
      return 0;
    }

    const service = createCaptureHelperService(parsed.config, io.env ?? process.env);
    if (parsed.command === "health") {
      writeJson(stdout, service.health());
      return 0;
    }
    if (parsed.command === "capabilities") {
      writeJson(stdout, service.capabilities());
      return 0;
    }
    if (parsed.command === "serve") {
      const started = await startCaptureHelperHttpServer(
        {
          host: parsed.host,
          port: parsed.port,
          service: parsed.config,
        },
        io.env ?? process.env
      );
      writeJson(stdout, {
        ok: true,
        service: "ai-grader-capture-helper",
        transport: {
          enabled: true,
          localOnly: true,
          host: started.host,
          port: started.port,
          url: started.url,
        },
      });
      return 0;
    }

    if (parsed.command === "manifest") {
      writeJson(stdout, service.manifest(parseCaptureHelperManifestMode(parsed.mode)));
      return 0;
    }

    throw new CaptureHelperCommandError(`Unsupported command: ${parsed.command}`);
  } catch (error) {
    const isExpected =
      error instanceof CaptureHelperCommandError ||
      error instanceof CaptureHelperConfigError ||
      error instanceof ArduinoLedControllerHealthError ||
      error instanceof GrblStageHealthError ||
      error instanceof DinoLiteBridgeClientError ||
      (error instanceof Error && error.name === "LeimacIdmuClientError") ||
      (error instanceof Error && error.name === "BaslerPylonClientError") ||
      (error instanceof Error && error.name === "BaslerLeimacSyncError");
    const message = error instanceof Error ? error.message : "Unexpected capture helper CLI error.";
    writeJson(stderr, {
      ok: false,
      service: "ai-grader-capture-helper",
      error: isExpected ? message : "Unexpected capture helper CLI error.",
      ...(isExpected ? {} : { detail: message }),
    });
    return 1;
  }
}

if (require.main === module) {
  runCaptureHelperCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
