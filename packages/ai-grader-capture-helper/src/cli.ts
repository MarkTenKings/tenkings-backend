#!/usr/bin/env node
import {
  CaptureHelperCommandError,
  CaptureHelperConfigError,
  createCaptureHelperService,
  parseCaptureHelperManifestMode,
  type CaptureHelperConfigInput,
  type CaptureHelperEnv,
} from "./index";

export interface CaptureHelperCliIO {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: CaptureHelperEnv;
}

type ParsedCommand =
  | { command: "health"; config: CaptureHelperConfigInput }
  | { command: "capabilities"; config: CaptureHelperConfigInput }
  | { command: "manifest"; config: CaptureHelperConfigInput; mode: string | undefined }
  | { command: "help"; config: CaptureHelperConfigInput };

function readOption(argv: string[], index: number, name: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CaptureHelperCommandError(`${name} requires a value.`);
  }
  return value;
}

function parseCliArgs(argv: string[]): ParsedCommand {
  const [command = "help", ...rest] = argv;
  const config: CaptureHelperConfigInput = { simulator: {} };
  let mode: string | undefined;

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
      case "--driver-set":
        config.driverSet = readOption(rest, index, "--driver-set");
        index += 1;
        break;
      case "--help":
      case "-h":
        return { command: "help", config };
      default:
        throw new CaptureHelperCommandError(`Unknown option: ${arg}`);
    }
  }

  if (command === "health" || command === "capabilities" || command === "manifest" || command === "help") {
    return command === "manifest" ? { command, config, mode } : { command, config };
  }
  throw new CaptureHelperCommandError(`Unknown command: ${command}`);
}

function helpPayload() {
  return {
    service: "ai-grader-capture-helper",
    commands: ["health", "capabilities", "manifest --mode QUICK|STANDARD|AUTH_ONLY"],
    options: ["--session-id", "--tenant-id", "--seed", "--helper-instance-id", "--driver-set mock"],
    mode: "simulator-only",
    driverSet: "mock-only",
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

    const service = createCaptureHelperService(parsed.config, io.env ?? process.env);
    if (parsed.command === "health") {
      writeJson(stdout, service.health());
      return 0;
    }
    if (parsed.command === "capabilities") {
      writeJson(stdout, service.capabilities());
      return 0;
    }

    writeJson(stdout, service.manifest(parseCaptureHelperManifestMode(parsed.mode)));
    return 0;
  } catch (error) {
    const isExpected = error instanceof CaptureHelperCommandError || error instanceof CaptureHelperConfigError;
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
