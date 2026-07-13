import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import {
  NATIVE_CAMERA_FORENSIC_ROLES,
  NATIVE_CAMERA_PROTOCOL_VERSION,
  NativeCameraNdjsonParser,
  NativeCameraProtocolValidationError,
  encodeNativeCameraProtocolMessage,
  parseNativeCameraGeometry,
  parseNativeCameraPreviewPayload,
  parseNativeCameraRigAttestation,
  type NativeCameraCommand,
  type NativeCameraCommandName,
  type NativeCameraEpochs,
  type NativeCameraEvent,
  type NativeCameraForensicRole,
  type NativeCameraPreviewFramePayload,
  type NativeCameraProtocolMessage,
  type NativeCameraResult,
  type NativeCameraRigAttestation,
  type NativeCameraSide,
  type NativeCameraWorkerState,
} from "./nativeCameraProtocol";
import {
  assertStableLightingAuthorization,
  createRejectingNativeCameraLightingCoordinator,
  type NativeCameraLightingContext,
  type NativeCameraLightingCoordinator,
  type NativeCameraOneGrabAuthorization,
  type NativeCameraSafeOffReason,
} from "./nativeCameraLightingCoordinator";
import {
  DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG,
  redactNativeCameraDiagnosticText,
  toPublicNativeCameraHealth,
  type NativeCameraFeatureConfig,
  type NativeCameraInternalHealth,
  type NativeCameraPublicHealth,
} from "./nativeCameraHealth";

export interface NativeCameraWorkerProcess {
  stdin: Pick<Writable, "write" | "end" | "on">;
  stdout: Pick<Readable, "on">;
  stderr: Pick<Readable, "on">;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
  readonly pid?: number;
}

export type NativeCameraWorkerSpawner = () => NativeCameraWorkerProcess;

export interface NativeCameraWorkerClientOptions {
  feature?: NativeCameraFeatureConfig;
  sessionId: string;
  sessionEpoch: number;
  configurationId: string;
  /** Canonical SHA-256 of the protected host-owned rig configuration. */
  configurationSha256: string;
  spawnWorker: NativeCameraWorkerSpawner;
  lighting?: NativeCameraLightingCoordinator;
  defaultTimeoutMs?: number;
  maxFrameAgeMs?: number;
  nowUnixMs?: () => number;
  requestIdFactory?: (sequence: number) => string;
  onRedactedDiagnostic?: (message: string) => void;
}

interface PendingRequest {
  command: NativeCameraCommand;
  resolve: (result: NativeCameraResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveLightingRole {
  context: NativeCameraLightingContext;
  authorization: NativeCameraOneGrabAuthorization;
}

interface ActiveCapture {
  requestId: string;
  rolesRequested: Set<NativeCameraForensicRole>;
  authorizations: Map<NativeCameraForensicRole, ActiveLightingRole>;
  rolesCompleted: Set<NativeCameraForensicRole>;
  completedFrameIds: Set<string>;
  completedBlockIds: Set<string>;
  safeOffConfirmed: boolean;
}

const NATIVE_CAMERA_MAX_IN_FLIGHT_COMMANDS = 32;

export class NativeCameraWorkerClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeCameraWorkerClientError";
  }
}

function clientError(code: string, message: string): NativeCameraWorkerClientError {
  return new NativeCameraWorkerClientError(code, message);
}

function assertInteger(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw clientError("INVALID_CLIENT_CONFIGURATION", `${name} must be an integer between ${min} and ${max}.`);
  }
}

function validateSafeId(value: string, name: string, maxLength: number): void {
  if (!value || value.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw clientError("INVALID_CLIENT_CONFIGURATION", `${name} has an invalid format.`);
  }
}

function resultState(result: NativeCameraResult): NativeCameraWorkerState {
  const value = result.payload?.state;
  const states: NativeCameraWorkerState[] = [
    "uninitialized", "idle_safe", "previewing", "draining", "capture_ready",
    "capturing", "resuming", "faulted", "shutdown",
  ];
  if (typeof value !== "string" || !states.includes(value as NativeCameraWorkerState)) {
    throw clientError("INVALID_WORKER_RESULT", "Worker result omitted a valid state.");
  }
  return value as NativeCameraWorkerState;
}

function sameEpochs(left: NativeCameraEpochs, right: NativeCameraEpochs): boolean {
  return (
    left.workerEpoch === right.workerEpoch &&
    left.sessionEpoch === right.sessionEpoch &&
    left.previewEpoch === right.previewEpoch &&
    left.sideEpoch === right.sideEpoch
  );
}

function resultEpochs(value: NativeCameraResult | NativeCameraEvent): NativeCameraEpochs {
  return {
    workerEpoch: value.workerEpoch,
    sessionEpoch: value.sessionEpoch,
    previewEpoch: value.previewEpoch,
    sideEpoch: value.sideEpoch,
  };
}

export function createNodeNativeCameraWorkerSpawner(input: {
  executable: string;
  args?: readonly string[];
  cwd?: string;
}): NativeCameraWorkerSpawner {
  if (!input.executable.trim()) throw clientError("INVALID_CLIENT_CONFIGURATION", "Worker executable is required.");
  return () =>
    spawn(input.executable, [...(input.args ?? [])], {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    }) as ChildProcessWithoutNullStreams;
}

export class NativeCameraWorkerClient {
  private readonly feature: NativeCameraFeatureConfig;
  private readonly lighting: NativeCameraLightingCoordinator;
  private readonly parser = new NativeCameraNdjsonParser();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly completedRequestIds = new Set<string>();
  private readonly completedRequestOrder: string[] = [];
  private readonly defaultTimeoutMs: number;
  private readonly maxFrameAgeMs: number;
  private readonly nowUnixMs: () => number;
  private readonly requestIdFactory: (sequence: number) => string;
  private child: NativeCameraWorkerProcess | null = null;
  private lifecycle: NativeCameraInternalHealth["lifecycle"] = "stopped";
  private state: NativeCameraWorkerState = "uninitialized";
  private side: NativeCameraSide = "none";
  private epochs: NativeCameraEpochs;
  private outboundSequence = 0;
  private inboundSequence = 0;
  private previewTransition: { kind: "starting_preview"; requestId: string } | null = null;
  private latestPreview: NativeCameraPreviewFramePayload | null = null;
  private lastPreviewFrameId: string | null = null;
  private clientDroppedPreviewFrames = 0;
  private workerDroppedPreviewFrames = 0;
  private previewRequestId: string | null = null;
  private stderrPending = Buffer.alloc(0);
  private terminalStarted = false;
  private expectedExit = false;
  private terminalPromise: Promise<void> = Promise.resolve();
  private lastError: { code: string; message: string } | null = null;
  private activeCapture: ActiveCapture | null = null;
  private activeSafeOffRequestId: string | null = null;
  private safeIdleSafeOffConfirmed = false;
  private shutdownSafeOffConfirmed = false;
  private rigAttestation: NativeCameraRigAttestation | null = null;
  private lightingEventChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: NativeCameraWorkerClientOptions) {
    this.feature = options.feature ?? { ...DEFAULT_NATIVE_CAMERA_FEATURE_CONFIG };
    this.lighting = options.lighting ?? createRejectingNativeCameraLightingCoordinator();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
    this.maxFrameAgeMs = options.maxFrameAgeMs ?? 500;
    this.nowUnixMs = options.nowUnixMs ?? Date.now;
    this.requestIdFactory = options.requestIdFactory ?? ((sequence) => `native-${sequence}`);
    validateSafeId(options.sessionId, "sessionId", 128);
    validateSafeId(options.configurationId, "configurationId", 128);
    if (!/^[a-f0-9]{64}$/.test(options.configurationSha256)) {
      throw clientError("INVALID_CLIENT_CONFIGURATION", "configurationSha256 must be a lowercase SHA-256 digest.");
    }
    assertInteger(options.sessionEpoch, "sessionEpoch", 1);
    assertInteger(this.defaultTimeoutMs, "defaultTimeoutMs", 1, 120_000);
    assertInteger(this.maxFrameAgeMs, "maxFrameAgeMs", 1, 60_000);
    if (this.feature.automaticFallbackAllowed !== false) {
      throw clientError("FALLBACK_FORBIDDEN", "Native camera automatic fallback must remain disabled.");
    }
    this.epochs = { workerEpoch: 0, sessionEpoch: options.sessionEpoch, previewEpoch: 0, sideEpoch: 0 };
  }

  public async start(): Promise<void> {
    if (!this.feature.enabled || this.feature.selection === "disabled") {
      throw clientError("NATIVE_CAMERA_DISABLED", "Native camera mode is disabled by default and was not explicitly selected.");
    }
    if (this.feature.selection === "pylon" && !this.feature.allowHardwareBackend) {
      throw clientError("HARDWARE_BACKEND_NOT_AUTHORIZED", "Pylon backend was not separately authorized.");
    }
    if (this.child || this.lifecycle !== "stopped") throw clientError("WORKER_ALREADY_STARTED", "Only one native worker is allowed.");
    this.lifecycle = "starting";
    this.epochs.workerEpoch += 1;
    try {
      this.child = this.options.spawnWorker();
      this.attachProcess(this.child);
      const payload: Record<string, unknown> = {
        configurationId: this.options.configurationId,
        configurationSha256: this.options.configurationSha256,
      };
      const result = await this.request("initialize", payload, this.defaultTimeoutMs);
      if (resultState(result) !== "idle_safe") throw clientError("INVALID_INITIAL_STATE", "Worker did not initialize into idle_safe.");
      const attestation = parseNativeCameraRigAttestation(result.payload?.rigConfiguration);
      if (
        attestation.configurationId !== this.options.configurationId ||
        attestation.configurationSha256 !== this.options.configurationSha256
      ) {
        throw clientError("RIG_ATTESTATION_MISMATCH", "Worker did not attest the expected protected rig configuration.");
      }
      this.rigAttestation = attestation;
      this.state = "idle_safe";
      this.lifecycle = "running";
    } catch (error) {
      await this.terminalFault("WORKER_START_FAILED", error, "capture_failure");
      throw error;
    }
  }

  public async health(timeoutMs = this.defaultTimeoutMs): Promise<NativeCameraResult> {
    this.assertRunning();
    return this.request("health", {}, timeoutMs);
  }

  public async capabilities(timeoutMs = this.defaultTimeoutMs): Promise<NativeCameraResult> {
    this.assertRunning();
    return this.request("capabilities", {}, timeoutMs);
  }

  public async startPreview(input: { previewEpoch: number; timeoutMs?: number }): Promise<void> {
    this.assertState("idle_safe");
    if (input.previewEpoch <= this.epochs.previewEpoch) {
      throw this.activeFailure("INVALID_EPOCH", "Preview epoch must advance.", "invalid_epoch");
    }
    this.epochs.previewEpoch = input.previewEpoch;
    this.latestPreview = null;
    this.lastPreviewFrameId = null;
    const requestId = this.nextRequestId();
    this.previewRequestId = requestId;
    this.previewTransition = { kind: "starting_preview", requestId };
    try {
      const result = await this.requestWithId(
        requestId,
        "start_preview",
        {},
        input.timeoutMs ?? this.defaultTimeoutMs,
      );
      if (resultState(result) !== "previewing") throw await this.failTransition("start_preview", resultState(result));
      this.state = "previewing";
    } finally {
      this.previewTransition = null;
    }
  }

  public async stopAndDrain(timeoutMs = this.defaultTimeoutMs): Promise<void> {
    this.assertState("previewing");
    this.state = "draining";
    const result = await this.request("stop_drain", {}, timeoutMs);
    if (resultState(result) !== "capture_ready") throw await this.failTransition("stop_drain", resultState(result));
    this.state = "capture_ready";
    this.latestPreview = null;
    this.previewRequestId = null;
  }

  public async setSide(input: { side: "front" | "back"; sideEpoch: number; timeoutMs?: number }): Promise<void> {
    if (this.state !== "idle_safe" && this.state !== "capture_ready") {
      throw this.activeFailure("INVALID_TRANSITION", `set_side is invalid from ${this.state}.`, "invalid_order");
    }
    if (input.sideEpoch <= this.epochs.sideEpoch) {
      throw this.activeFailure("INVALID_EPOCH", "Side epoch must advance.", "invalid_epoch");
    }
    this.side = input.side;
    this.epochs.sideEpoch = input.sideEpoch;
    this.latestPreview = null;
    this.lastPreviewFrameId = null;
    const result = await this.request("set_side", { side: input.side }, input.timeoutMs ?? this.defaultTimeoutMs);
    const next = resultState(result);
    if (next !== "idle_safe" && next !== "capture_ready") throw await this.failTransition("set_side", next);
    this.state = next;
  }

  public async executeForensicSidePlan(input: {
    captureId: string;
    forensicProfile: "full_forensic" | "production_fast";
    timeoutMs?: number;
  }): Promise<NativeCameraResult> {
    this.assertState("capture_ready");
    if (this.side === "none") {
      throw this.activeFailure("SIDE_REQUIRED", "A front or back side epoch is required before capture.", "invalid_epoch");
    }
    validateSafeId(input.captureId, "captureId", 128);
    const requestId = this.nextRequestId();
    this.activeCapture = {
      requestId,
      rolesRequested: new Set(),
      authorizations: new Map(),
      rolesCompleted: new Set(),
      completedFrameIds: new Set(),
      completedBlockIds: new Set(),
      safeOffConfirmed: false,
    };
    this.state = "capturing";
    try {
      const result = await this.requestWithId(
        requestId,
        "execute_forensic_plan",
        {
          captureId: input.captureId,
          forensicProfile: input.forensicProfile,
          roles: [...NATIVE_CAMERA_FORENSIC_ROLES],
          normalizedWidth: 1200,
          normalizedHeight: 1680,
        },
        input.timeoutMs ?? 120_000,
      );
      this.assertForensicResultCoherence(result, input.captureId, input.forensicProfile);
      if (!this.activeCapture || this.activeCapture.rolesCompleted.size !== NATIVE_CAMERA_FORENSIC_ROLES.length) {
        throw clientError("INCOMPLETE_LIGHTING_COORDINATION", "Worker completed capture before all role completions were acknowledged.");
      }
      if (!this.activeCapture.safeOffConfirmed) {
        throw clientError("SAFE_OFF_FAILED", "Worker completed capture before external safe-off was confirmed.");
      }
      if (resultState(result) !== "idle_safe") throw clientError("INVALID_TRANSITION", "Capture did not return to idle_safe.");
      this.state = "idle_safe";
      return result;
    } catch (error) {
      await this.terminalFault("CAPTURE_FAILED", error, "capture_failure");
      throw error;
    } finally {
      this.activeCapture = null;
    }
  }

  public async resumePreview(input: { previewEpoch: number; timeoutMs?: number }): Promise<void> {
    this.assertState("idle_safe");
    if (input.previewEpoch <= this.epochs.previewEpoch) {
      throw this.activeFailure("INVALID_EPOCH", "Resume preview epoch must advance.", "invalid_epoch");
    }
    this.epochs.previewEpoch = input.previewEpoch;
    this.state = "resuming";
    const requestId = this.nextRequestId();
    this.previewRequestId = requestId;
    const result = await this.requestWithId(
      requestId,
      "resume_preview",
      {},
      input.timeoutMs ?? this.defaultTimeoutMs,
    );
    if (resultState(result) !== "previewing") throw await this.failTransition("resume_preview", resultState(result));
    this.state = "previewing";
  }

  public async safeIdle(timeoutMs = this.defaultTimeoutMs): Promise<void> {
    this.assertRunning();
    // idle_safe is already fenced: initialization has never enabled lighting,
    // and every later transition into this state requires safe-off completion.
    // The worker intentionally treats a repeated safe_idle as an idempotent no-op.
    this.safeIdleSafeOffConfirmed = this.state === "idle_safe";
    const result = await this.request("safe_idle", {}, timeoutMs);
    if (!this.safeIdleSafeOffConfirmed) {
      throw this.activeFailure("SAFE_OFF_FAILED", "safe_idle completed without external safe-off confirmation.", "safe_idle");
    }
    if (resultState(result) !== "idle_safe") throw await this.failTransition("safe_idle", resultState(result));
    this.state = "idle_safe";
    this.latestPreview = null;
    this.previewRequestId = null;
  }

  public async shutdown(timeoutMs = this.defaultTimeoutMs): Promise<void> {
    if (!this.child || this.lifecycle === "shutdown") return;
    try {
      this.shutdownSafeOffConfirmed = false;
      const result = await this.request("shutdown", {}, timeoutMs);
      if (!this.shutdownSafeOffConfirmed) throw clientError("SAFE_OFF_FAILED", "Shutdown completed without external safe-off confirmation.");
      if (resultState(result) !== "shutdown") throw clientError("INVALID_TRANSITION", "Worker rejected shutdown.");
      this.expectedExit = true;
      this.state = "shutdown";
      this.lifecycle = "shutdown";
      this.child.stdin.end();
    } catch (error) {
      await this.terminalFault("SHUTDOWN_FAILED", error, "client_shutdown");
      throw error;
    }
  }

  public consumeLatestPreview(): NativeCameraPreviewFramePayload | null {
    const frame = this.latestPreview;
    this.latestPreview = null;
    return frame;
  }

  public publicHealth(): NativeCameraPublicHealth {
    return toPublicNativeCameraHealth(this.internalHealth());
  }

  public internalHealth(): NativeCameraInternalHealth {
    return {
      enabled: this.feature.enabled,
      selection: this.feature.selection,
      lifecycle: this.lifecycle,
      state: this.state,
      healthy: this.lifecycle === "running" && !this.terminalStarted,
      cameraOpen: this.lifecycle === "running" && this.state !== "uninitialized" && this.state !== "shutdown",
      epochs: { ...this.epochs },
      side: this.side,
      previewQueueDepth: this.latestPreview ? 1 : 0,
      clientDroppedPreviewFrames: this.clientDroppedPreviewFrames,
      workerDroppedPreviewFrames: this.workerDroppedPreviewFrames,
      lastError: this.lastError,
    };
  }

  public async waitForTerminalSafety(): Promise<void> {
    await this.terminalPromise;
  }

  private attachProcess(child: NativeCameraWorkerProcess): void {
    child.stdout.on("data", (chunk: Buffer | string) => {
      try {
        for (const message of this.parser.push(chunk)) this.handleMessage(message);
      } catch (error) {
        void this.terminalFault("MALFORMED_PROTOCOL", error, "malformed_protocol");
      }
    });
    child.stdout.on("end", () => {
      try {
        this.parser.end();
      } catch (error) {
        void this.terminalFault("TRUNCATED_PROTOCOL", error, "malformed_protocol");
        return;
      }
      if (!this.expectedExit && this.lifecycle !== "shutdown") {
        void this.terminalFault(
          "WORKER_STDOUT_EOF",
          clientError("WORKER_STDOUT_EOF", "Native worker protocol output closed unexpectedly."),
          "worker_exit",
        );
      }
    });
    child.stdout.on("error", (error: Error) => {
      void this.terminalFault("WORKER_STDOUT_ERROR", error, "worker_exit");
    });
    child.stdin.on("error", (error: Error) => {
      if (this.expectedExit) return;
      void this.terminalFault("WORKER_STDIN_ERROR", error, "worker_exit");
    });
    child.stderr.on("data", (chunk: Buffer | string) => this.handleStderrChunk(chunk));
    child.stderr.on("end", () => this.flushStderr());
    child.on("error", (error) => {
      void this.terminalFault("WORKER_PROCESS_ERROR", error, "worker_exit");
    });
    child.on("exit", (code, signal) => {
      if (this.expectedExit) return;
      void this.terminalFault(
        "WORKER_EXIT",
        clientError("WORKER_EXIT", `Native worker exited unexpectedly (${code ?? "none"}/${signal ?? "none"}).`),
        "worker_exit",
      );
    });
  }

  private handleMessage(message: NativeCameraProtocolMessage): void {
    if (message.kind === "command") {
      throw clientError("UNEXPECTED_WORKER_COMMAND", "Worker cannot issue command envelopes to the client.");
    }
    if (message.sequence !== this.inboundSequence + 1) {
      void this.terminalFault("OUT_OF_ORDER_MESSAGE", clientError("OUT_OF_ORDER_MESSAGE", "Worker sequence was not exactly contiguous."), "invalid_order");
      return;
    }
    this.inboundSequence = message.sequence;
    if (message.sessionId !== this.options.sessionId) {
      void this.terminalFault("WRONG_SESSION", clientError("WRONG_SESSION", "Worker returned a wrong session ID."), "invalid_epoch");
      return;
    }
    if (message.kind === "result") this.handleResult(message);
    else this.handleEvent(message);
  }

  private handleResult(result: NativeCameraResult): void {
    if (this.completedRequestIds.has(result.requestId)) {
      void this.terminalFault("DUPLICATE_RESULT", clientError("DUPLICATE_RESULT", "Worker returned a duplicate result."), "invalid_order");
      return;
    }
    const pending = this.pending.get(result.requestId);
    if (!pending) {
      void this.terminalFault("UNKNOWN_RESULT", clientError("UNKNOWN_RESULT", "Worker returned an unknown request ID."), "invalid_order");
      return;
    }
    const expected = pending.command;
    if (
      result.command !== expected.command ||
      result.side !== expected.side ||
      !sameEpochs(resultEpochs(result), expected) ||
      result.timeoutMs !== expected.timeoutMs ||
      result.deadlineUnixMs !== expected.deadlineUnixMs
    ) {
      void this.terminalFault("RESULT_CORRELATION", clientError("RESULT_CORRELATION", "Worker result did not match its command envelope."), "invalid_epoch");
      return;
    }
    if (result.deadlineUnixMs < this.nowUnixMs()) {
      void this.terminalFault(
        "EXPIRED_RESULT",
        clientError("EXPIRED_RESULT", "Worker returned a result after its command deadline."),
        "worker_timeout",
      );
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(result.requestId);
    this.rememberCompleted(result.requestId);
    if (!result.ok) {
      const error = clientError(result.error?.code ?? "WORKER_FAILURE", result.error?.message ?? "Native worker failed.");
      pending.reject(error);
      void this.terminalFault("WORKER_FAILURE", error, expected.command === "execute_forensic_plan" ? "capture_failure" : "invalid_order");
      return;
    }
    pending.resolve(result);
  }

  private handleEvent(event: NativeCameraEvent): void {
    if (event.event === "terminal_fault") {
      const reservedWorkerFault = event.requestId === "terminal-fault";
      const correlated =
        this.pending.has(event.requestId) ||
        this.completedRequestIds.has(event.requestId) ||
        this.activeCapture?.requestId === event.requestId;
      if (!reservedWorkerFault && !correlated) {
        void this.terminalFault("UNRELATED_TERMINAL_EVENT", clientError("UNRELATED_TERMINAL_EVENT", "Terminal event did not correlate to this attempt."), "invalid_order");
        return;
      }
      const code = typeof event.payload.code === "string" ? event.payload.code : "WORKER_TERMINAL_FAULT";
      const message = typeof event.payload.message === "string" ? event.payload.message : "Native worker terminal fault.";
      void this.terminalFault(code, clientError(code, message), "capture_failure");
      return;
    }
    if (!sameEpochs(resultEpochs(event), this.epochs) || event.side !== this.side) {
      void this.terminalFault("WRONG_EVENT_EPOCH", clientError("WRONG_EVENT_EPOCH", "Worker event used stale or wrong epochs."), "invalid_epoch");
      return;
    }
    if (event.deadlineUnixMs < this.nowUnixMs()) {
      void this.terminalFault("EXPIRED_EVENT", clientError("EXPIRED_EVENT", "Worker emitted an expired event."), "worker_timeout");
      return;
    }
    if (event.event === "preview_frame") {
      this.handlePreview(event);
    } else {
      this.enqueueLightingEvent(event);
    }
  }

  private enqueueLightingEvent(event: NativeCameraEvent): void {
    this.lightingEventChain = this.lightingEventChain
      .then(async () => {
        if (this.terminalStarted) return;
        if (event.event === "lighting_profile_requested") {
          await this.handleLightingProfileRequested(event);
        } else if (event.event === "lighting_grab_completed") {
          await this.handleLightingGrabCompleted(event);
        } else {
          await this.handleSafeOffRequested(event);
        }
      })
      .catch(async (error: unknown) => {
        await this.terminalFault("LIGHTING_COORDINATION_FAILED", error, "capture_failure");
      });
  }

  private handlePreview(event: NativeCameraEvent): void {
    const startingThisPreview =
      this.previewTransition?.kind === "starting_preview" && this.previewTransition.requestId === event.requestId;
    if (!startingThisPreview && this.state !== "previewing" && this.state !== "resuming" && this.state !== "draining") {
      void this.terminalFault("PREVIEW_OUT_OF_ORDER", clientError("PREVIEW_OUT_OF_ORDER", "Preview arrived outside preview state."), "invalid_order");
      return;
    }
    if (!this.previewRequestId || event.requestId !== this.previewRequestId) {
      void this.terminalFault("PREVIEW_CORRELATION", clientError("PREVIEW_CORRELATION", "Preview event did not correlate to the active preview request."), "invalid_order");
      return;
    }
    const preview = parseNativeCameraPreviewPayload(event.payload);
    if (!sameEpochs(preview.frame, this.epochs) || preview.frame.side !== this.side) {
      void this.terminalFault("WRONG_FRAME_EPOCH", clientError("WRONG_FRAME_EPOCH", "Preview frame used stale or wrong epochs."), "invalid_epoch");
      return;
    }
    const actualSha = createHash("sha256").update(Buffer.from(preview.jpeg.base64, "base64")).digest("hex");
    if (actualSha !== preview.jpeg.sha256) {
      void this.terminalFault("JPEG_HASH_MISMATCH", clientError("JPEG_HASH_MISMATCH", "Preview JPEG hash is incoherent."), "malformed_protocol");
      return;
    }
    if (!this.geometryMatchesAttestedRig(preview.geometry)) {
      void this.terminalFault(
        "PREVIEW_RIG_MISMATCH",
        clientError("PREVIEW_RIG_MISMATCH", "Preview geometry did not match the initialized calibration and orientation."),
        "invalid_epoch",
      );
      return;
    }
    const repeated = this.lastPreviewFrameId === preview.frame.frameId;
    if (repeated && !preview.geometry.frozen) {
      void this.terminalFault("UNREPORTED_FROZEN_FRAME", clientError("UNREPORTED_FROZEN_FRAME", "Repeated frame identity was not marked frozen."), "invalid_order");
      return;
    }
    if (preview.geometry.status === "ready" && preview.geometry.frameAgeMs > this.maxFrameAgeMs) {
      void this.terminalFault("STALE_READY", clientError("STALE_READY", "Stale geometry was incorrectly reported Ready."), "invalid_order");
      return;
    }
    if (this.state === "draining") {
      // stop_drain can cross one frame already queued on worker stdout. Keep
      // every protocol, identity, hash, epoch, frozen, and freshness check
      // above, but never make that in-flight frame observable after draining
      // has begun.
      this.latestPreview = null;
      this.lastPreviewFrameId = preview.frame.frameId;
      this.workerDroppedPreviewFrames = Math.max(this.workerDroppedPreviewFrames, preview.telemetry.droppedFrames);
      return;
    }
    if (this.latestPreview) this.clientDroppedPreviewFrames += 1;
    this.latestPreview = preview;
    this.lastPreviewFrameId = preview.frame.frameId;
    this.workerDroppedPreviewFrames = Math.max(this.workerDroppedPreviewFrames, preview.telemetry.droppedFrames);
  }

  private async handleLightingProfileRequested(event: NativeCameraEvent): Promise<void> {
    try {
      const capture = this.activeCapture;
      const captureRequestId = String(event.payload.captureRequestId);
      const role = event.payload.role as NativeCameraForensicRole;
      const ordinal = Number(event.payload.ordinal);
      if (
        typeof event.payload.captureRequestId !== "string" ||
        typeof event.payload.role !== "string" ||
        !Number.isSafeInteger(event.payload.ordinal) ||
        event.requestId !== captureRequestId ||
        !capture ||
        capture.requestId !== captureRequestId ||
        this.state !== "capturing"
      ) {
        throw clientError("LIGHTING_OUT_OF_ORDER", "Lighting request did not match the active capture.");
      }
      if (
        NATIVE_CAMERA_FORENSIC_ROLES[ordinal] !== role ||
        capture.rolesRequested.size !== ordinal ||
        capture.rolesCompleted.size !== ordinal ||
        capture.rolesRequested.has(role)
      ) {
        throw clientError("LIGHTING_OUT_OF_ORDER", "Lighting roles were requested out of canonical order or more than once.");
      }
      const context: NativeCameraLightingContext = {
        sessionId: this.options.sessionId,
        captureRequestId,
        side: this.side as "front" | "back",
        sideEpoch: this.epochs.sideEpoch,
        role,
      };
      capture.rolesRequested.add(role);
      const receipt = await this.awaitInjectedOperation(
        event.deadlineUnixMs,
        "LIGHTING_COORDINATION_TIMEOUT",
        () => this.lighting.requestEvidenceRoleProfile({ ...context, requestedAtUnixMs: this.nowUnixMs() }),
      );
      this.assertLightingCaptureActive(capture, event);
      if (!receipt || receipt.accepted !== true) throw clientError("LIGHTING_PROFILE_REJECTED", "Lighting profile request was not accepted.");
      const stable = await this.awaitInjectedOperation(
        event.deadlineUnixMs,
        "LIGHTING_COORDINATION_TIMEOUT",
        () => this.lighting.waitForStableLight(context, receipt),
      );
      this.assertLightingCaptureActive(capture, event);
      const authorization = await this.awaitInjectedOperation(
        event.deadlineUnixMs,
        "LIGHTING_COORDINATION_TIMEOUT",
        () => this.lighting.authorizeOneGrab(context, stable),
      );
      this.assertLightingCaptureActive(capture, event);
      assertStableLightingAuthorization(stable, authorization, this.nowUnixMs());
      capture.authorizations.set(role, { context, authorization });
      const authorizationTimeoutMs = Math.floor(authorization.expiresAtUnixMs - this.nowUnixMs());
      if (authorizationTimeoutMs < 1) throw clientError("LIGHTING_AUTHORIZATION_EXPIRED", "Lighting authorization expired before acknowledgement.");
      await this.request(
        "lighting_ack",
        {
          captureRequestId,
          role,
          stableAcknowledgementId: stable.acknowledgementId,
          authorizationId: authorization.authorizationId,
          stableAtUnixMs: stable.stableAtUnixMs,
          expiresAtUnixMs: authorization.expiresAtUnixMs,
        },
        Math.min(this.defaultTimeoutMs, authorizationTimeoutMs),
      );
    } catch (error) {
      await this.terminalFault("LIGHTING_COORDINATION_FAILED", error, "capture_failure");
    }
  }

  private async handleLightingGrabCompleted(event: NativeCameraEvent): Promise<void> {
    try {
      const capture = this.activeCapture;
      const captureRequestId = String(event.payload.captureRequestId);
      const role = event.payload.role as NativeCameraForensicRole;
      const authorizationId = String(event.payload.authorizationId);
      const active = capture?.authorizations.get(role);
      const completedFrame = event.payload.frame as Record<string, unknown>;
      if (
        typeof event.payload.captureRequestId !== "string" ||
        typeof event.payload.role !== "string" ||
        typeof event.payload.authorizationId !== "string" ||
        typeof event.payload.frame !== "object" ||
        event.payload.frame === null ||
        event.requestId !== captureRequestId ||
        !capture ||
        capture.requestId !== captureRequestId ||
        !active ||
        active.authorization.authorizationId !== authorizationId ||
        capture.rolesCompleted.has(role)
      ) {
        throw clientError("GRAB_AUTHORIZATION_MISMATCH", "Grab completion did not match its one-grab authorization.");
      }
      const frameId = String(completedFrame.frameId);
      const blockId = completedFrame.blockId;
      if (
        completedFrame.workerEpoch !== event.workerEpoch ||
        completedFrame.sessionEpoch !== event.sessionEpoch ||
        completedFrame.previewEpoch !== event.previewEpoch ||
        completedFrame.sideEpoch !== event.sideEpoch ||
        completedFrame.side !== event.side ||
        blockId === null ||
        typeof blockId !== "string" ||
        capture.completedFrameIds.has(frameId) ||
        capture.completedBlockIds.has(blockId)
      ) {
        throw clientError("GRAB_FRAME_MISMATCH", "Grab completion frame identity, BlockID, side, or epochs were stale or reused.");
      }
      // Reserve before the injected side effect so concurrent duplicate events
      // cannot complete the same authorized role or frame twice.
      capture.rolesCompleted.add(role);
      capture.completedFrameIds.add(frameId);
      capture.completedBlockIds.add(blockId);
      await this.awaitInjectedOperation(
        event.deadlineUnixMs,
        "LIGHTING_COORDINATION_TIMEOUT",
        () => this.lighting.completeEvidenceRole({
          ...active.context,
          authorizationId,
          frameId,
          completedAtUnixMs: this.nowUnixMs(),
        }),
      );
      this.assertLightingCaptureActive(capture, event);
      await this.request(
        "lighting_completion",
        { captureRequestId, role, authorizationId, completedAtUnixMs: this.nowUnixMs() },
        this.defaultTimeoutMs,
      );
    } catch (error) {
      await this.terminalFault("LIGHTING_COMPLETION_FAILED", error, "capture_failure");
    }
  }

  private async handleSafeOffRequested(event: NativeCameraEvent): Promise<void> {
    const payload = event.payload;
    const safeOffRequestId = String(payload.safeOffRequestId);
    const workerReason = String(payload.reason);
    try {
      if (
        typeof payload.safeOffRequestId !== "string" ||
        typeof payload.reason !== "string" ||
        event.requestId !== safeOffRequestId ||
        this.activeSafeOffRequestId !== null
      ) {
        throw clientError("SAFE_OFF_OUT_OF_ORDER", "Worker safe-off request was malformed, duplicated, or out of order.");
      }

      let reason: NativeCameraSafeOffReason;
      if (workerReason === "forensic_plan_complete" && this.activeCapture && this.state === "capturing") {
        reason = "capture_complete";
      } else if (workerReason === "safe_idle_requested") {
        reason = "safe_idle";
      } else if (workerReason === "worker_shutdown") {
        reason = "client_shutdown";
      } else {
        throw clientError("SAFE_OFF_OUT_OF_ORDER", "Worker requested safe-off for an unexpected lifecycle reason.");
      }

      this.activeSafeOffRequestId = safeOffRequestId;
      const safe = await this.awaitInjectedOperation(
        event.deadlineUnixMs,
        "SAFE_OFF_TIMEOUT",
        () => this.lighting.safeOff(reason),
      );
      if (this.terminalStarted) throw clientError("SAFE_OFF_FAILED", "The native attempt faulted while safe-off was pending.");
      if (!safe || safe.safe !== true || !Number.isSafeInteger(safe.completedAtUnixMs) || safe.completedAtUnixMs < 0) {
        throw clientError("SAFE_OFF_FAILED", "Injected lighting coordination did not confirm safe-off.");
      }
      if (reason === "capture_complete" && this.activeCapture) this.activeCapture.safeOffConfirmed = true;
      else if (reason === "safe_idle") this.safeIdleSafeOffConfirmed = true;
      else this.shutdownSafeOffConfirmed = true;
      await this.request(
        "safe_off_completion",
        { safeOffRequestId, safe: true, completedAtUnixMs: safe.completedAtUnixMs },
        this.defaultTimeoutMs,
      );
    } catch (error) {
      await this.terminalFault("SAFE_OFF_FAILED", error, "capture_failure");
    } finally {
      if (this.activeSafeOffRequestId === safeOffRequestId) this.activeSafeOffRequestId = null;
    }
  }

  private request(command: NativeCameraCommandName, payload: Record<string, unknown>, timeoutMs: number): Promise<NativeCameraResult> {
    return this.requestWithId(this.nextRequestId(), command, payload, timeoutMs);
  }

  private async awaitInjectedOperation<T>(
    deadlineUnixMs: number,
    timeoutCode: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const remainingMs = Math.min(this.defaultTimeoutMs, deadlineUnixMs - this.nowUnixMs());
    if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) {
      throw clientError(timeoutCode, "Injected native-camera coordination exceeded its bounded deadline.");
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(clientError(timeoutCode, "Injected native-camera coordination exceeded its bounded deadline.")),
            remainingMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private assertLightingCaptureActive(capture: ActiveCapture, event: NativeCameraEvent): void {
    if (
      this.terminalStarted ||
      this.state !== "capturing" ||
      this.activeCapture !== capture ||
      event.deadlineUnixMs < this.nowUnixMs()
    ) {
      throw clientError("LIGHTING_COORDINATION_STALE", "Lighting coordination outlived its active capture or deadline.");
    }
  }

  private requestWithId(
    requestId: string,
    command: NativeCameraCommandName,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<NativeCameraResult> {
    if (!this.child || this.terminalStarted) return Promise.reject(clientError("WORKER_NOT_AVAILABLE", "Native worker is unavailable."));
    assertInteger(timeoutMs, "timeoutMs", 1, 120_000);
    if (this.pending.has(requestId) || this.completedRequestIds.has(requestId)) {
      return Promise.reject(clientError("DUPLICATE_REQUEST_ID", "Request ID was already used."));
    }
    if (this.pending.size >= NATIVE_CAMERA_MAX_IN_FLIGHT_COMMANDS) {
      const error = clientError("CLIENT_COMMAND_LIMIT", "Native camera command concurrency limit was exceeded.");
      void this.terminalFault("CLIENT_COMMAND_LIMIT", error, "invalid_order");
      return Promise.reject(error);
    }
    const commandMessage: NativeCameraCommand = {
      protocolVersion: NATIVE_CAMERA_PROTOCOL_VERSION,
      kind: "command",
      command,
      requestId,
      sessionId: this.options.sessionId,
      ...this.epochs,
      side: this.side,
      timeoutMs,
      deadlineUnixMs: this.nowUnixMs() + timeoutMs,
      sequence: ++this.outboundSequence,
      payload,
    };
    let bytes: Buffer;
    try {
      bytes = encodeNativeCameraProtocolMessage(commandMessage);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<NativeCameraResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        const error = clientError("WORKER_TIMEOUT", `${command} timed out.`);
        reject(error);
        void this.terminalFault("WORKER_TIMEOUT", error, "worker_timeout");
      }, timeoutMs);
      this.pending.set(requestId, { command: commandMessage, resolve, reject, timer });
      try {
        const accepted = this.child?.stdin.write(bytes);
        if (accepted !== true) {
          throw clientError("WORKER_STDIN_BACKPRESSURE", "Native worker command channel rejected bounded backpressure.");
        }
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : clientError("WORKER_WRITE_FAILED", "Worker stdin write failed."));
        const terminalCode =
          error instanceof NativeCameraWorkerClientError && error.code === "WORKER_STDIN_BACKPRESSURE"
            ? error.code
            : "WORKER_WRITE_FAILED";
        void this.terminalFault(terminalCode, error, "worker_exit");
      }
    });
  }

  private nextRequestId(): string {
    const requestId = this.requestIdFactory(this.outboundSequence + 1);
    validateSafeId(requestId, "requestId", 64);
    return requestId;
  }

  private handleStderrChunk(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.stderrPending = Buffer.concat([this.stderrPending, bytes]);
    for (;;) {
      const newline = this.stderrPending.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.stderrPending.subarray(0, newline).toString("utf8");
      this.stderrPending = this.stderrPending.subarray(newline + 1);
      this.options.onRedactedDiagnostic?.(redactNativeCameraDiagnosticText(line));
    }
    if (this.stderrPending.length > 4096) {
      this.stderrPending = Buffer.alloc(0);
      this.options.onRedactedDiagnostic?.("[redacted-oversize-native-camera-diagnostic]");
    }
  }

  private flushStderr(): void {
    if (this.stderrPending.length === 0) return;
    const line = this.stderrPending.toString("utf8");
    this.stderrPending = Buffer.alloc(0);
    this.options.onRedactedDiagnostic?.(redactNativeCameraDiagnosticText(line));
  }

  private rememberCompleted(requestId: string): void {
    this.completedRequestIds.add(requestId);
    this.completedRequestOrder.push(requestId);
    while (this.completedRequestOrder.length > 256) {
      const removed = this.completedRequestOrder.shift();
      if (removed) this.completedRequestIds.delete(removed);
    }
  }

  private assertRunning(): void {
    if (this.lifecycle !== "running" || !this.child || this.terminalStarted) {
      throw clientError("WORKER_NOT_RUNNING", "Native worker is not running.");
    }
  }

  private assertState(expected: NativeCameraWorkerState): void {
    this.assertRunning();
    if (this.state !== expected) {
      throw this.activeFailure("INVALID_TRANSITION", `Expected ${expected}, received ${this.state}.`, "invalid_order");
    }
  }

  private activeFailure(code: string, message: string, reason: NativeCameraSafeOffReason): NativeCameraWorkerClientError {
    const error = clientError(code, message);
    if (this.child && this.lifecycle !== "shutdown" && !this.terminalStarted) {
      void this.terminalFault(code, error, reason);
    }
    return error;
  }

  private assertForensicResultCoherence(
    result: NativeCameraResult,
    captureId: string,
    forensicProfile: "full_forensic" | "production_fast",
  ): void {
    if (result.payload?.captureId !== captureId || result.payload?.forensicProfile !== forensicProfile) {
      throw clientError("CAPTURE_RESULT_CORRELATION", "Forensic output did not match its capture ID and profile.");
    }
    const resultRig = parseNativeCameraRigAttestation(result.payload.rigConfiguration);
    if (!this.rigAttestation || JSON.stringify(resultRig) !== JSON.stringify(this.rigAttestation)) {
      throw clientError("FORENSIC_RIG_MISMATCH", "Forensic output did not match the initialized rig attestation.");
    }
    const artifacts = result.payload.artifacts;
    if (!Array.isArray(artifacts)) throw clientError("INCOMPLETE_FORENSIC_OUTPUT", "Forensic artifacts are absent.");
    const frameIds = new Set<string>();
    const blockIds = new Set<string>();
    for (const value of artifacts) {
      const artifact = value as Record<string, unknown>;
      const frame = artifact.frame as Record<string, unknown>;
      if (
        !frame ||
        frame.workerEpoch !== this.epochs.workerEpoch ||
        frame.sessionEpoch !== this.epochs.sessionEpoch ||
        frame.previewEpoch !== this.epochs.previewEpoch ||
        frame.sideEpoch !== this.epochs.sideEpoch ||
        frame.side !== this.side
      ) {
        throw clientError("FORENSIC_FRAME_EPOCH", "Forensic artifact used stale or wrong frame epochs.");
      }
      const frameId = String(frame.frameId);
      if (frameIds.has(frameId)) throw clientError("DUPLICATE_FORENSIC_FRAME", "Forensic roles reused a frame identity.");
      frameIds.add(frameId);
      if (frame.blockId === null || frame.blockId === undefined) {
        throw clientError("MISSING_FORENSIC_BLOCK", "Every forensic role requires an exact Pylon BlockID.");
      }
      const blockId = String(frame.blockId);
      if (blockIds.has(blockId)) throw clientError("DUPLICATE_FORENSIC_BLOCK", "Forensic roles reused a Pylon BlockID.");
      blockIds.add(blockId);
    }
    const allOn = artifacts.find((value) => (value as Record<string, unknown>).role === "all_on") as
      | Record<string, unknown>
      | undefined;
    if (!allOn) throw clientError("INCOMPLETE_FORENSIC_OUTPUT", "Forensic output omitted all_on.");
    const authoritative = parseNativeCameraGeometry(result.payload.authoritativeAllOnGeometry);
    const allOnFrame = allOn.frame as Record<string, unknown>;
    if (
      authoritative.status !== "ready" ||
      authoritative.reasonCodes.length !== 1 ||
      authoritative.reasonCodes[0] !== "none" ||
      !authoritative.currentFrameAuthority.normalizationSafe ||
      !authoritative.currentFrameAuthority.captureReady ||
      authoritative.currentFrameAuthority.rejectionCodes.length !== 0 ||
      authoritative.stale ||
      authoritative.frozen ||
      authoritative.frame.blockId === null ||
      allOnFrame.blockId === null ||
      authoritative.frame.frameId !== allOnFrame.frameId ||
      authoritative.frame.blockId !== allOnFrame.blockId ||
      !this.geometryMatchesAttestedRig(authoritative)
    ) {
      throw clientError("UNSAFE_AUTHORITATIVE_GEOMETRY", "Forensic output did not contain safe exact-frame all_on authority.");
    }
  }

  private geometryMatchesAttestedRig(geometry: NativeCameraPreviewFramePayload["geometry"]): boolean {
    const attestation = this.rigAttestation;
    return Boolean(
      attestation &&
        geometry.calibration.id === attestation.calibrationId &&
        geometry.calibration.sha256 === attestation.calibrationSha256 &&
        JSON.stringify(geometry.sensorOrientation) === JSON.stringify(attestation.sensorOrientation),
    );
  }

  private async failTransition(command: string, actual: string): Promise<NativeCameraWorkerClientError> {
    const error = clientError("INVALID_TRANSITION", `${command} returned invalid state ${actual}.`);
    await this.terminalFault("INVALID_TRANSITION", error, "invalid_order");
    return error;
  }

  private async terminalFault(code: string, cause: unknown, reason: NativeCameraSafeOffReason): Promise<void> {
    if (this.terminalStarted) return this.terminalPromise;
    this.terminalStarted = true;
    const message = cause instanceof Error ? cause.message : "Native camera attempt failed.";
    this.lastError = { code, message };
    this.lifecycle = "faulted";
    this.state = "faulted";
    this.previewTransition = null;
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(clientError(code, message));
      this.pending.delete(requestId);
    }
    try {
      this.child?.kill("SIGKILL");
    } catch {
      // Safe-off remains mandatory even if the process is already gone.
    }
    this.terminalPromise = (async () => {
      try {
        const safe = await this.awaitInjectedOperation(
          this.nowUnixMs() + this.defaultTimeoutMs,
          "SAFE_OFF_TIMEOUT",
          () => this.lighting.safeOff(reason),
        );
        if (!safe || safe.safe !== true || !Number.isSafeInteger(safe.completedAtUnixMs) || safe.completedAtUnixMs < 0) {
          throw clientError("SAFE_OFF_FAILED", "Injected lighting coordination did not confirm terminal safe-off.");
        }
      } catch {
        this.lastError = { code: "SAFE_OFF_FAILED", message: "Injected safe-off coordination failed." };
      }
    })();
    await this.terminalPromise;
  }
}
