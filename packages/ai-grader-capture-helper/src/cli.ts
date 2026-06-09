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
import { DinoLiteBridgeClient, DinoLiteBridgeClientError, assertDinoLiteCaptureOutputDirAllowed } from "./drivers";
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
  let label: string | undefined;
  let includeLightingSweep = false;
  let includeEdr = false;
  let includeEdof = false;

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
      case "--include-lighting-sweep":
        includeLightingSweep = true;
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
    command === "dinolite-enumerate" ||
    command === "dinolite-status" ||
    command === "dinolite-capture-still" ||
    command === "dinolite-capture-package" ||
    command === "dinolite-capture-demo-package" ||
    command === "manifest" ||
    command === "serve" ||
    command === "help"
  ) {
    if (command === "manifest") return { command, config, mode };
    if (command === "serve") return { command, config, host, port };
    if (command === "dinolite-status") return { command, config, deviceIndex };
    if (command === "dinolite-capture-still") return { command, config, deviceIndex, outputDir };
    if (command === "dinolite-capture-package" || command === "dinolite-capture-demo-package") {
      return { command, config, deviceIndex, outputDir, label, includeLightingSweep, includeEdr, includeEdof };
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
      "dinolite-bridge-health --bridge-path <exe> --bridge-adapter fake",
      "dinolite-enumerate --bridge-exe <exe> --adapter dnvideox",
      "dinolite-status --bridge-exe <exe> --adapter dnvideox --device-index 0",
      "dinolite-capture-still --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-smoke",
      "dinolite-capture-package --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-packages --label card-demo-001 --include-lighting-sweep --include-edr --include-edof",
      "dinolite-capture-demo-package --bridge-exe <exe> --adapter dnvideox --device-index 0 --output-dir C:\\TenKings\\capture-data\\dinolite-demo --label card-demo-001",
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
      "--device-index",
      "--output-dir",
      "--label",
      "--include-lighting-sweep",
      "--include-edr",
      "--include-edof",
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
    driverSet: "mock runnable; real limited to explicit Arduino LED readiness, GRBL stage readiness, and manual Dino-Lite bridge commands",
    dinoliteBridge: "manual fake bridge health plus manual DNVideoX enumerate/status/still capture only; default readiness does not spawn",
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
      parsed.command === "dinolite-capture-demo-package"
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
      error instanceof DinoLiteBridgeClientError;
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
