import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type BaslerPylonAction = "readiness" | "list-cameras" | "capture-still";
export type BaslerSavedImageFormat = "png" | "tiff" | "jpg";

export interface BaslerPylonClientConfig {
  pylonRoot?: string;
  bridgeScriptPath?: string;
  powershellPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BaslerPylonInstallInfo {
  installed: boolean;
  root?: string;
  version?: string | null;
  assemblyPath?: string | null;
  runtimePath?: string | null;
  status: "installed" | "missing";
}

export interface BaslerCameraInfo {
  index: number;
  friendlyName?: string | null;
  modelName?: string | null;
  vendorName?: string | null;
  serialNumber?: string | null;
  deviceType?: string | null;
  transport?: string | null;
  deviceIpAddress?: string | null;
  deviceMacAddress?: string | null;
  subnetMask?: string | null;
  defaultGateway?: string | null;
  networkInterfaceIpAddress?: string | null;
  userDefinedName?: string | null;
  fullName?: string | null;
}

export interface BaslerNetworkAdapterInfo {
  interfaceAlias?: string | null;
  description?: string | null;
  status?: string | null;
  linkSpeed?: string | null;
  macAddress?: string | null;
  ipAddress?: string | null;
}

export interface BaslerPylonReadinessResult {
  pylon: BaslerPylonInstallInfo;
  transport: "GigE";
  cameraCount: number;
  cameras: BaslerCameraInfo[];
  networkAdapters: BaslerNetworkAdapterInfo[];
  status: "reachable" | "not_reachable" | "pylon_missing" | "error";
  hardwareAccess: "explicit_pylon_gige_enumeration";
  note: string;
}

export interface BaslerPylonCameraListResult extends BaslerPylonReadinessResult {
  command: "basler-list-cameras";
}

export interface BaslerCalibrationMetadata {
  isCalibrated: false;
  calibrationProfileId: null;
  lensModel?: string | null;
  cameraRole: "macro_overview";
  evidenceClass: "macro_raw_smoke";
  coordinateFrame: "basler_sensor_pixels";
}

export interface BaslerCaptureStillResult {
  outputFilePath: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png" | "image/tiff" | "image/jpeg";
  timestamp: string;
  camera: BaslerCameraInfo;
  imageWidth: number;
  imageHeight: number;
  sourcePixelFormat: string;
  savedImageFormat: "PNG" | "TIFF" | "JPG";
  exposureTime?: number | null;
  gain?: number | null;
  transport: "GigE";
  pylon: BaslerPylonInstallInfo;
  calibration: BaslerCalibrationMetadata;
  note: string;
}

export interface BaslerPylonBridgeErrorPayload {
  code: string;
  message: string;
}

export interface BaslerPylonBridgeEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: BaslerPylonBridgeErrorPayload;
}

export interface BaslerPylonBridgeRunOptions {
  timeoutMs: number;
}

export type BaslerPylonBridgeRunner = (
  command: string,
  args: string[],
  options: BaslerPylonBridgeRunOptions
) => Promise<BaslerPylonBridgeEnvelope>;

export interface BaslerCaptureStillOptions {
  outputDir: string;
  label: string;
  cameraIndex?: number;
  savedFormat?: BaslerSavedImageFormat;
  lensModel?: string;
}

export class BaslerPylonClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BaslerPylonClientError";
    this.code = code;
  }
}

export function normalizeBaslerSavedImageFormat(value: string | undefined): BaslerSavedImageFormat {
  const normalized = (value ?? "png").trim().toLowerCase();
  if (normalized === "png" || normalized === "tiff" || normalized === "jpg") return normalized;
  if (normalized === "jpeg") return "jpg";
  throw new BaslerPylonClientError("BASLER_IMAGE_FORMAT_UNSUPPORTED", "--format must be png, tiff, or jpg.");
}

export function assertBaslerCaptureOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  if (!outputDir || outputDir.trim().length === 0) {
    throw new BaslerPylonClientError("BASLER_OUTPUT_DIR_REQUIRED", "Basler still capture requires --output-dir <path>.");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedOutputDir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new BaslerPylonClientError(
      "BASLER_OUTPUT_DIR_INSIDE_REPO",
      "Basler still capture output directory must be outside the git repo."
    );
  }
  return resolvedOutputDir;
}

export function defaultBaslerPylonBridgeScriptPath(): string {
  return path.resolve(__dirname, "..", "..", "scripts", "basler-pylon-bridge.ps1");
}

export function defaultBaslerPylonRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    nonEmpty(env.TENKINGS_BASLER_PYLON_ROOT) ??
    nonEmpty(env.AI_GRADER_CAPTURE_HELPER_BASLER_PYLON_ROOT) ??
    (existsSync("C:\\Program Files\\Basler\\pylon") ? "C:\\Program Files\\Basler\\pylon" : undefined)
  );
}

export class BaslerPylonClient {
  private readonly config: Required<Pick<BaslerPylonClientConfig, "powershellPath" | "timeoutMs">> &
    Omit<BaslerPylonClientConfig, "powershellPath" | "timeoutMs">;
  private readonly runBridgeProcess: BaslerPylonBridgeRunner;

  constructor(config: BaslerPylonClientConfig = {}, runBridgeProcess: BaslerPylonBridgeRunner = defaultBridgeRunner) {
    this.config = {
      ...config,
      powershellPath: config.powershellPath ?? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      timeoutMs: config.timeoutMs ?? 30000,
    };
    this.runBridgeProcess = runBridgeProcess;
  }

  async readiness(): Promise<BaslerPylonReadinessResult> {
    return this.runBridge<BaslerPylonReadinessResult>("readiness");
  }

  async listCameras(): Promise<BaslerPylonCameraListResult> {
    return this.runBridge<BaslerPylonCameraListResult>("list-cameras");
  }

  async captureStill(options: BaslerCaptureStillOptions): Promise<BaslerCaptureStillResult> {
    const outputDir = assertBaslerCaptureOutputDirAllowed(options.outputDir);
    const label = options.label?.trim();
    if (!label) {
      throw new BaslerPylonClientError("BASLER_LABEL_REQUIRED", "Basler still capture requires --label <label>.");
    }
    const cameraIndex = options.cameraIndex ?? 0;
    if (!Number.isInteger(cameraIndex) || cameraIndex < 0) {
      throw new BaslerPylonClientError("BASLER_CAMERA_INDEX_INVALID", "--camera-index must be a non-negative integer.");
    }

    return this.runBridge<BaslerCaptureStillResult>("capture-still", [
      "-OutputDir",
      outputDir,
      "-Label",
      label,
      "-CameraIndex",
      String(cameraIndex),
      "-Format",
      normalizeBaslerSavedImageFormat(options.savedFormat),
      ...(options.lensModel ? ["-LensModel", options.lensModel] : []),
    ]);
  }

  private async runBridge<T>(action: BaslerPylonAction, extraArgs: string[] = []): Promise<T> {
    const scriptPath = this.config.bridgeScriptPath ?? defaultBaslerPylonBridgeScriptPath();
    if (!existsSync(scriptPath)) {
      throw new BaslerPylonClientError("BASLER_BRIDGE_SCRIPT_MISSING", `Basler pylon bridge script is missing: ${scriptPath}`);
    }

    const pylonRoot = this.config.pylonRoot ?? defaultBaslerPylonRoot(this.config.env ?? process.env);
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Action",
      action,
      ...(pylonRoot ? ["-PylonRoot", pylonRoot] : []),
      ...extraArgs,
    ];
    const envelope = await this.runBridgeProcess(this.config.powershellPath, args, {
      timeoutMs: this.config.timeoutMs,
    });

    if (!envelope.ok) {
      throw new BaslerPylonClientError(
        envelope.error?.code ?? "BASLER_BRIDGE_ERROR",
        envelope.error?.message ?? "Basler pylon bridge returned an error."
      );
    }
    return envelope.result as T;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultBridgeRunner(
  command: string,
  args: string[],
  options: BaslerPylonBridgeRunOptions
): Promise<BaslerPylonBridgeEnvelope> {
  return new Promise<BaslerPylonBridgeEnvelope>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "pipe",
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new BaslerPylonClientError("BASLER_BRIDGE_TIMEOUT", "Basler pylon bridge command timed out."));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new BaslerPylonClientError("BASLER_BRIDGE_PROCESS_ERROR", error.message));
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
      if (!stdout) {
        reject(
          new BaslerPylonClientError(
            "BASLER_BRIDGE_NO_OUTPUT",
            `Basler pylon bridge emitted no JSON: code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? ` stderr=${stderr}` : ""}`
          )
        );
        return;
      }
      try {
        const envelope = JSON.parse(stdout) as BaslerPylonBridgeEnvelope;
        if (code !== 0 && envelope.ok) {
          reject(
            new BaslerPylonClientError(
              "BASLER_BRIDGE_EXITED",
              `Basler pylon bridge exited non-zero: code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? ` stderr=${stderr}` : ""}`
            )
          );
          return;
        }
        resolve(envelope);
      } catch {
        reject(new BaslerPylonClientError("BASLER_BRIDGE_BAD_JSON", "Basler pylon bridge emitted invalid JSON."));
      }
    });
  });
}
