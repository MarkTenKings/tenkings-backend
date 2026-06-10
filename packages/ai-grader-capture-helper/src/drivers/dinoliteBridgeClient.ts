import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export type DinoLiteBridgeCommand =
  | "health"
  | "sdkInfo"
  | "listDevices"
  | "capabilities"
  | "dinolite.enumerateDevices"
  | "dinolite.status"
  | "dinolite.captureStillJpg"
  | "dinolite.getLightingStatus"
  | "dinolite.setLightingRecipe"
  | "dinolite.runtimeDiagnostics"
  | "dinolite.capturePackage"
  | "dinolite.captureDemoPackage"
  | "dinolite.operatorWorkflow"
  | "exit";

export interface DinoLiteBridgeClientConfig {
  executablePath?: string;
  adapter?: "fake" | "dnvideox";
  timeoutMs?: number;
  args?: string[];
  manualEnumeration?: boolean;
  manualHardwareAccess?: boolean;
  sdkRuntimeDir?: string;
}

export interface DinoLiteBridgeRequest {
  id: string;
  command: DinoLiteBridgeCommand;
  deviceIndex?: number;
  outputDir?: string;
  sdkRuntimeDir?: string;
  label?: string;
  plan?: string;
  includeLightingSweep?: boolean;
  includeFlcSweep?: boolean;
  includeEdr?: boolean;
  includeEdof?: boolean;
  cornerProfile?: string;
  captureGuides?: boolean;
}

export interface DinoLiteBridgeErrorPayload {
  code: string;
  message: string;
}

export interface DinoLiteBridgeResponse<T = unknown> {
  id?: string;
  ok: boolean;
  result?: T;
  error?: DinoLiteBridgeErrorPayload;
}

export interface DinoLiteBridgeHealth {
  status: string;
  adapter: string;
  hardwareAccess: string;
  comActiveXInstantiated: boolean;
  message: string;
}

export interface DinoLiteBridgeSdkInfo {
  adapter: string;
  sdk: string;
  mode?: string;
  registeredActiveXPath: string;
  targetFramework: string;
  platform: string;
  threadingModel: string;
  comActiveXInstantiated: boolean;
  status?: string;
  message?: string;
}

export interface DinoLiteBridgeDevice {
  id: string;
  model: string;
  serial: string;
  displayName: string;
  simulated: boolean;
}

export interface DinoLiteBridgeDeviceList {
  adapter: string;
  devices: DinoLiteBridgeDevice[];
}

export interface DinoLiteBridgeEnumeratedDevice {
  index: number;
  name: string;
  description?: string | null;
  deviceId?: string | null;
  simulated?: boolean;
}

export interface DinoLiteBridgeEnumerationResult {
  adapter: "fake" | "dnvideox";
  comActiveXInstantiated: boolean;
  connected: false;
  preview: false;
  deviceCount: number;
  devices: DinoLiteBridgeEnumeratedDevice[];
  optionalErrors?: Array<{
    index: number;
    field: string;
    code: string;
    message: string;
  }>;
  sdk: {
    control: string;
    version?: string | null;
    progId?: string;
    clsid?: string;
    registeredActiveXPath?: string;
  };
  host?: string;
  status?: string;
  error?: {
    code: string;
    message: string;
  };
  forbiddenOperationsInvoked: false;
}

export interface DinoLiteBridgeStatusResult {
  adapter: "fake" | "dnvideox";
  simulated?: boolean;
  comActiveXInstantiated: boolean;
  ocxVersion?: string | null;
  device: {
    index: number;
    name: string;
    description?: string | null;
    deviceId?: string | null;
  };
  connectedDuringCommand: boolean;
  previewDuringCommand: boolean;
  config?: unknown;
  amr?: number | null;
  videoCaps?: unknown;
  videoFormat?: unknown;
  lensLimits?: unknown;
  lensFineLimits?: unknown;
  exposure?: unknown;
  ledState?: number | null;
  optionalErrors?: unknown[];
  cleanup?: unknown;
  forbiddenOperationsInvoked: false;
}

export interface DinoLiteBridgeCaptureStillJpgResult {
  adapter: "fake" | "dnvideox";
  simulated?: boolean;
  comActiveXInstantiated: boolean;
  device: {
    index: number;
    name: string;
    description?: string | null;
    deviceId?: string | null;
  };
  outputFilePath: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/jpeg";
  timestamp: string;
  connectedDuringCommand: boolean;
  previewDuringCommand: boolean;
  config?: unknown;
  amr?: number | null;
  optionalErrors?: unknown[];
  cleanup?: unknown;
  forbiddenOperationsInvoked: false;
}

export interface DinoLiteBridgeCapturePackageResult {
  adapter: "fake" | "dnvideox";
  simulated?: boolean;
  comActiveXInstantiated: boolean;
  packageId: string;
  label: string;
  packageDir: string;
  manifestPath: string;
  previewReportPath: string;
  timestamp: string;
  device: {
    index: number;
    name: string;
    description?: string | null;
    deviceId?: string | null;
  };
  ocxVersion?: string | null;
  connectedDuringCommand: boolean;
  previewDuringCommand: boolean;
  config?: unknown;
  amr?: number | null;
  runtimeDependencies?: unknown;
  captures: Array<{
    path: string;
    filename: string;
    sha256?: string | null;
    byteSize: number;
    mimeType: "image/jpeg";
    timestamp: string;
    captureKind: string;
    lightingRecipe: string;
    status: string;
    error?: unknown;
  }>;
  cleanup?: unknown;
  optionalErrors?: unknown[];
  limitations?: string[];
  forbiddenOperationsInvoked: false;
}

export interface DinoLiteBridgeOperatorWorkflowResult {
  adapter: "fake" | "dnvideox";
  simulated?: boolean;
  comActiveXInstantiated: boolean;
  sessionId: string;
  label: string;
  plan: string;
  sessionDir: string;
  manifestPath: string;
  previewReportPath: string;
  timestamp: string;
  status: "completed" | "aborted" | string;
  device: {
    index: number;
    name: string;
    description?: string | null;
    deviceId?: string | null;
  };
  ocxVersion?: string | null;
  connectedDuringCommand: boolean;
  previewDuringCommand: boolean;
  config?: unknown;
  amr?: number | null;
  runtimeDependencies?: unknown;
  options?: unknown;
  targets: Array<{
    target: {
      id: string;
      name: string;
      type: string;
      reportLabel: string;
      instruction: string;
      captureGuide?: string;
      captureGuidesEnabled?: boolean;
      guideVisualKind?: "full-card" | "corner" | "edge" | "surface" | "center" | string;
      guideVisualOrientation?: string;
      guideVisualLegend?: string;
      guideTemplateKind?: "full_card_frame" | "sharp_90_corner_template" | "edge_strip_template" | "surface_patch_template" | string;
      guideTemplateAspectRatio?: string | null;
      guideTemplateScaleNote?: string;
      cornerProfile?: string | null;
    };
    targetIndex: number;
    action: string;
    attempt: number;
    status: string;
    artifacts: Array<{
      path: string;
      filename: string;
      sha256?: string | null;
      byteSize: number;
      mimeType: "image/jpeg";
      timestamp: string;
      captureKind: string;
      lightingRecipe: string;
      status: string;
      error?: unknown;
      diagnostics?: unknown;
    }>;
  }>;
  cleanup?: unknown;
  optionalErrors?: unknown[];
  limitations?: string[];
  forbiddenOperationsInvoked: false;
}

export interface DinoLiteBridgeRuntimeDiagnostics {
  adapter: "fake" | "dnvideox";
  simulated?: boolean;
  configuredRuntimeDir?: string | null;
  runtimeDirConfigured: boolean;
  runtimeDirExists?: boolean;
  runtimeDirInsideRepo?: boolean;
  runtimeDirUsable: boolean;
  edofHelperAvailable: boolean;
  requiredFiles: unknown[];
  optionalFiles?: unknown[];
  currentDirectory: string;
  baseDirectory: string;
  pathMutation: string;
}

export interface DinoLiteBridgeCapabilities {
  adapter: string;
  simulated?: boolean;
  stillCapture: boolean;
  amr: boolean;
  flc: boolean;
  edr: boolean;
  edof: boolean;
  controlsImplemented: boolean;
  captureImplemented: boolean;
}

export interface DinoLiteBridgeConfiguredStatus {
  configured: boolean;
  executablePath?: string;
  adapter: "fake" | "dnvideox";
  canSpawn: boolean;
  reason: string;
}

export interface DinoLiteBridgeChildProcess {
  stdin: {
    write(chunk: string): boolean;
    end(): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  };
  stderr: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  };
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface DinoLiteBridgeSpawnOptions {
  windowsHide?: boolean;
}

export type DinoLiteBridgeSpawn = (
  command: string,
  args: string[],
  options?: DinoLiteBridgeSpawnOptions
) => DinoLiteBridgeChildProcess;

export class DinoLiteBridgeClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DinoLiteBridgeClientError";
    this.code = code;
  }
}

export function getDinoLiteBridgeConfiguredStatus(
  config: DinoLiteBridgeClientConfig = {}
): DinoLiteBridgeConfiguredStatus {
  const adapter = config.adapter ?? "fake";
  if (!config.executablePath || config.executablePath.trim().length === 0) {
    return {
      configured: false,
      adapter,
      canSpawn: false,
      reason: "Dino-Lite bridge executable path is not configured; no process will be spawned.",
    };
  }

  return {
    configured: true,
    executablePath: config.executablePath,
    adapter,
    canSpawn: adapter === "fake",
    reason:
      adapter === "fake"
        ? "Dino-Lite fake bridge is configured for manual health checks."
        : "DNVideoX real bridge adapter is manual-only and not enabled by capture-helper health commands.",
  };
}

export class DinoLiteBridgeClient {
  private readonly config: Required<
    Pick<DinoLiteBridgeClientConfig, "adapter" | "timeoutMs" | "manualEnumeration" | "manualHardwareAccess">
  > &
    Omit<DinoLiteBridgeClientConfig, "adapter" | "timeoutMs" | "manualEnumeration" | "manualHardwareAccess">;
  private readonly spawnProcess: DinoLiteBridgeSpawn;
  private child: DinoLiteBridgeChildProcess | undefined;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private pending = new Map<
    string,
    {
      resolve: (value: DinoLiteBridgeResponse) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(config: DinoLiteBridgeClientConfig, spawnProcess: DinoLiteBridgeSpawn = defaultSpawn) {
    if (!config.executablePath || config.executablePath.trim().length === 0) {
      throw new DinoLiteBridgeClientError("BRIDGE_NOT_CONFIGURED", "Dino-Lite bridge executable path is required.");
    }
    if ((config.adapter ?? "fake") !== "fake" && config.manualEnumeration !== true && config.manualHardwareAccess !== true) {
      throw new DinoLiteBridgeClientError(
        "REAL_BRIDGE_DISABLED",
        "Capture-helper may only spawn the DNVideoX bridge for explicit manual hardware commands."
      );
    }
    this.config = {
      ...config,
      adapter: config.adapter ?? "fake",
      timeoutMs: config.timeoutMs ?? 1000,
      manualEnumeration: config.manualEnumeration ?? false,
      manualHardwareAccess: config.manualHardwareAccess ?? false,
    };
    this.spawnProcess = spawnProcess;
  }

  async health(): Promise<DinoLiteBridgeHealth> {
    return this.sendResult<DinoLiteBridgeHealth>("health");
  }

  async sdkInfo(): Promise<DinoLiteBridgeSdkInfo> {
    return this.sendResult<DinoLiteBridgeSdkInfo>("sdkInfo");
  }

  async listDevices(): Promise<DinoLiteBridgeDeviceList> {
    return this.sendResult<DinoLiteBridgeDeviceList>("listDevices");
  }

  async capabilities(): Promise<DinoLiteBridgeCapabilities> {
    return this.sendResult<DinoLiteBridgeCapabilities>("capabilities");
  }

  async enumerateDevices(): Promise<DinoLiteBridgeEnumerationResult> {
    return this.sendResult<DinoLiteBridgeEnumerationResult>("dinolite.enumerateDevices");
  }

  async status(deviceIndex: number): Promise<DinoLiteBridgeStatusResult> {
    return this.sendResult<DinoLiteBridgeStatusResult>("dinolite.status", { deviceIndex });
  }

  async captureStillJpg(deviceIndex: number, outputDir: string): Promise<DinoLiteBridgeCaptureStillJpgResult> {
    return this.sendResult<DinoLiteBridgeCaptureStillJpgResult>("dinolite.captureStillJpg", { deviceIndex, outputDir });
  }

  async capturePackage(options: {
    deviceIndex: number;
    outputDir: string;
    label: string;
    includeLightingSweep?: boolean;
    includeEdr?: boolean;
    includeEdof?: boolean;
  }): Promise<DinoLiteBridgeCapturePackageResult> {
    return this.sendResult<DinoLiteBridgeCapturePackageResult>("dinolite.capturePackage", options);
  }

  async operatorWorkflow(options: {
    deviceIndex: number;
    outputDir: string;
    label?: string;
    plan: string;
    includeFlcSweep?: boolean;
    includeEdr?: boolean;
    includeEdof?: boolean;
    cornerProfile?: string;
    captureGuides?: boolean;
  }): Promise<DinoLiteBridgeOperatorWorkflowResult> {
    return this.sendResult<DinoLiteBridgeOperatorWorkflowResult>("dinolite.operatorWorkflow", options);
  }

  async runtimeDiagnostics(): Promise<DinoLiteBridgeRuntimeDiagnostics> {
    return this.sendResult<DinoLiteBridgeRuntimeDiagnostics>("dinolite.runtimeDiagnostics");
  }

  async close(): Promise<void> {
    if (!this.child) return;
    try {
      await this.send("exit");
    } catch {
      this.child.kill();
    } finally {
      this.child?.stdin.end();
      this.child = undefined;
    }
  }

  private async sendResult<T>(command: DinoLiteBridgeCommand, payload: Partial<DinoLiteBridgeRequest> = {}): Promise<T> {
    const response = await this.send(command, payload);
    if (!response.ok) {
      throw new DinoLiteBridgeClientError(
        response.error?.code ?? "BRIDGE_ERROR",
        response.error?.message ?? "Dino-Lite bridge returned an error."
      );
    }
    return response.result as T;
  }

  private send(
    command: DinoLiteBridgeCommand,
    payload: Partial<DinoLiteBridgeRequest> = {}
  ): Promise<DinoLiteBridgeResponse> {
    const allowedRealCommands = new Set<DinoLiteBridgeCommand>([
      "dinolite.enumerateDevices",
      "dinolite.status",
      "dinolite.captureStillJpg",
      "dinolite.getLightingStatus",
      "dinolite.setLightingRecipe",
      "dinolite.runtimeDiagnostics",
      "dinolite.capturePackage",
      "dinolite.captureDemoPackage",
      "dinolite.operatorWorkflow",
      "exit",
    ]);
    if (this.config.adapter === "dnvideox" && (this.config.manualEnumeration || this.config.manualHardwareAccess) && !allowedRealCommands.has(command)) {
      return Promise.reject(
        new DinoLiteBridgeClientError(
          "REAL_BRIDGE_COMMAND_DISABLED",
          "DNVideoX bridge spawn is restricted to explicit manual Dino-Lite hardware commands."
        )
      );
    }
    const child = this.ensureStarted();
    const id = String(this.nextId++);
    const request: DinoLiteBridgeRequest = { id, command, ...payload };

    return new Promise<DinoLiteBridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        child.kill();
        reject(new DinoLiteBridgeClientError("BRIDGE_TIMEOUT", `Dino-Lite bridge command timed out: ${command}`));
      }, this.config.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  private ensureStarted(): DinoLiteBridgeChildProcess {
    if (this.child) return this.child;
    const args = [
      "--adapter",
      this.config.adapter,
      ...(this.config.manualEnumeration ? ["--manual-enumerate"] : []),
      ...(this.config.manualHardwareAccess ? ["--manual-hardware"] : []),
      ...(this.config.sdkRuntimeDir ? ["--sdk-runtime-dir", this.config.sdkRuntimeDir] : []),
      ...(this.config.args ?? []),
    ];
    const child = this.spawnProcess(this.config.executablePath as string, args, {
      windowsHide: this.config.manualHardwareAccess ? false : true,
    });
    this.child = child;

    child.stdout.on("data", (chunk) => {
      this.handleStdout(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer += String(chunk);
    });
    child.on("error", (error) => {
      this.rejectAll(new DinoLiteBridgeClientError("BRIDGE_PROCESS_ERROR", error.message));
    });
    child.on("exit", (code, signal) => {
      const suffix = this.stderrBuffer.trim() ? ` stderr: ${this.stderrBuffer.trim()}` : "";
      this.rejectAll(
        new DinoLiteBridgeClientError(
          "BRIDGE_PROCESS_EXITED",
          `Dino-Lite bridge process exited before completing pending commands: code=${code ?? "null"} signal=${signal ?? "null"}.${suffix}`
        )
      );
      this.child = undefined;
    });

    return child;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let response: DinoLiteBridgeResponse;
    try {
      response = JSON.parse(line) as DinoLiteBridgeResponse;
    } catch {
      this.rejectAll(new DinoLiteBridgeClientError("BRIDGE_BAD_JSON", "Dino-Lite bridge emitted invalid JSON."));
      return;
    }

    if (!response.id) {
      this.rejectAll(new DinoLiteBridgeClientError("BRIDGE_BAD_RESPONSE", "Dino-Lite bridge response omitted id."));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function assertDinoLiteCaptureOutputDirAllowed(outputDir: string, repoRoot = process.cwd()): string {
  if (!outputDir || outputDir.trim().length === 0) {
    throw new DinoLiteBridgeClientError("CAPTURE_OUTPUT_DIR_REQUIRED", "Dino-Lite capture requires --output-dir <path>.");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedOutputDir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new DinoLiteBridgeClientError(
      "CAPTURE_OUTPUT_DIR_INSIDE_REPO",
      "Dino-Lite capture output directory must be outside the git repo."
    );
  }
  return resolvedOutputDir;
}

export function assertDinoLiteSdkRuntimeDirAllowed(sdkRuntimeDir: string, repoRoot = process.cwd()): string {
  if (!sdkRuntimeDir || sdkRuntimeDir.trim().length === 0) {
    throw new DinoLiteBridgeClientError(
      "SDK_RUNTIME_DIR_REQUIRED",
      "Dino-Lite SDK runtime directory requires --sdk-runtime-dir <path>."
    );
  }
  const resolvedRuntimeDir = path.resolve(sdkRuntimeDir);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const relative = path.relative(resolvedRepoRoot, resolvedRuntimeDir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new DinoLiteBridgeClientError(
      "SDK_RUNTIME_DIR_INSIDE_REPO",
      "Dino-Lite SDK runtime directory must be outside the git repo."
    );
  }
  return resolvedRuntimeDir;
}

function defaultSpawn(command: string, args: string[], options: DinoLiteBridgeSpawnOptions = {}): DinoLiteBridgeChildProcess {
  return spawn(command, args, {
    stdio: "pipe",
    windowsHide: options.windowsHide ?? true,
  }) as ChildProcessWithoutNullStreams;
}

