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

function parseCliArgs(argv: string[]): ParsedCommand {
  const [command = "help", ...rest] = argv;
  const config: CaptureHelperConfigInput = { simulator: {} };
  let mode: string | undefined;
  let host: string | undefined;
  let port: string | undefined;
  let deviceIndex: number | undefined;
  let outputDir: string | undefined;
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
  let captureConfirmed = false;
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
      case "--operator-reported-idle-on":
        operatorReportedIdleOn = true;
        break;
      case "--capture-confirmed":
        captureConfirmed = true;
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
