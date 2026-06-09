#!/usr/bin/env node
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
import { DinoLiteBridgeClient } from "./drivers";
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
        config.dinoliteBridge = {
          ...config.dinoliteBridge,
          executablePath: readOption(rest, index, "--bridge-path"),
        };
        index += 1;
        break;
      case "--bridge-adapter":
        config.dinoliteBridge = {
          ...config.dinoliteBridge,
          adapter: readOption(rest, index, "--bridge-adapter") as "fake" | "dnvideox",
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
    command === "manifest" ||
    command === "serve" ||
    command === "help"
  ) {
    if (command === "manifest") return { command, config, mode };
    if (command === "serve") return { command, config, host, port };
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
      "dinolite-bridge-health --bridge-path <exe> --bridge-adapter fake",
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
      "--bridge-adapter fake",
      "--bridge-timeout-ms",
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
      "--port",
    ],
    mode: "simulator-only",
    driverSet: "mock runnable; real limited to explicit Arduino LED and GRBL stage readiness",
    dinoliteBridge: "manual fake bridge health only; default readiness does not spawn",
    transport: "disabled until serve is explicitly run",
  };
}

function writeJson(stdout: (text: string) => void, value: unknown) {
  stdout(`${JSON.stringify(value, null, 2)}\n`);
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

    writeJson(stdout, service.manifest(parseCaptureHelperManifestMode(parsed.mode)));
    return 0;
  } catch (error) {
    const isExpected =
      error instanceof CaptureHelperCommandError ||
      error instanceof CaptureHelperConfigError ||
      error instanceof ArduinoLedControllerHealthError ||
      error instanceof GrblStageHealthError;
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
