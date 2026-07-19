import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  createFixedRigProcessingWorkerRequest,
  FIXED_RIG_PROCESSING_WORKER_OPERATION,
  FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
  validateFixedRigProcessingWorkerAuthority,
  validateFixedRigProcessingWorkerAuthorityInput,
  validateFixedRigProcessingWorkerRequest,
  type FixedRigProcessingWorkerIdentity,
  type FixedRigProcessingWorkerRequest,
  type FixedRigProcessingWorkerResponse,
  type FixedRigProcessingWorkerSuccessResponse,
} from "./fixedRigProcessingWorkerProtocol";
import {
  processFixedRigWarmSideBatch,
  type FixedRigFullResolutionGeometryAuthorityInput,
  type FixedRigWarmEvidencePackageResult,
  type FixedRigWarmSideCaptureBatch,
} from "./baslerFixedRigV1";

const DEFAULT_MAX_PENDING = 20;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_MESSAGE_BYTES = 256 * 1024;
const SAFE_CONTEXT_ID_RE = /^[A-Za-z0-9._:-]{1,180}$/;

export type FixedRigProcessingWorkerErrorCode =
  | "queue_full"
  | "closed"
  | "timeout"
  | "crash"
  | "malformed_response"
  | "identity_mismatch"
  | "worker_failed"
  | "cancelled"
  | "shutdown";

export class FixedRigProcessingWorkerError extends Error {
  constructor(
    readonly code: FixedRigProcessingWorkerErrorCode,
    message: string,
    readonly workerFailureKind?: Extract<FixedRigProcessingWorkerResponse, { ok: false }>["error"]["code"],
  ) {
    super(message);
    this.name = "FixedRigProcessingWorkerError";
  }
}

export interface FixedRigProcessingWorkerStatus {
  active: boolean;
  pending: number;
  maxPending: number;
  maxConcurrency: 1;
  closed: boolean;
  activeIdentity?: FixedRigProcessingWorkerIdentity;
}

export interface FixedRigProcessingWorkerControllerOptions {
  /** Trusted bridge config outputDir; never taken from a request/browser. */
  allowedOutputRoot: string;
  maxPending?: number;
  timeoutMs?: number;
  /** Test-only compiled worker entry injection. */
  workerPath?: string;
}

interface PendingJob {
  request: FixedRigProcessingWorkerRequest;
  processResponse?: (response: FixedRigProcessingWorkerSuccessResponse) => Promise<unknown>;
  resolve: (response: any) => void;
  reject: (error: any) => void;
}

interface RevalidateCommand {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: "revalidate_captured_source_identity";
  identity: FixedRigProcessingWorkerIdentity;
}

interface RevalidateAck extends RevalidateCommand {
  ok: true;
}

interface ActiveJob extends PendingJob {
  worker: Worker;
  phase: "authority" | "revalidation";
  response?: FixedRigProcessingWorkerSuccessResponse;
  revalidated: boolean;
  terminalError?: FixedRigProcessingWorkerError;
  responseProcessing: boolean;
  timer: NodeJS.Timeout;
  finished: boolean;
  drained: Promise<void>;
  resolveDrained: () => void;
}

function sameIdentity(left: FixedRigProcessingWorkerIdentity, right: FixedRigProcessingWorkerIdentity): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.requestId === right.requestId &&
    left.sessionId === right.sessionId &&
    left.packageId === right.packageId &&
    left.side === right.side &&
    left.sourceSetSha256 === right.sourceSetSha256
  );
}

function safeReason(reason: string | undefined, fallback: string): string {
  const value = reason?.replace(/[\r\n\t]/g, " ").trim().slice(0, 180);
  if (!value || /[\\/]|[A-Za-z]:|(?:token|secret|bearer|password)\s*[:=]/i.test(value)) return fallback;
  return value;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function hasExactIdentity(value: unknown): value is FixedRigProcessingWorkerIdentity {
  return hasExactKeys(value, ["protocolVersion", "requestId", "sessionId", "packageId", "side", "sourceSetSha256"]);
}

export class FixedRigProcessingWorkerController {
  readonly allowedOutputRoot: string;
  readonly maxPending: number;
  readonly timeoutMs: number;
  readonly workerPath: string;
  private readonly pendingJobs: PendingJob[] = [];
  private activeJob?: ActiveJob;
  private closed = false;
  private shutdownPromise?: Promise<void>;

  constructor(options: FixedRigProcessingWorkerControllerOptions) {
    if (!path.isAbsolute(options.allowedOutputRoot)) {
      throw new FixedRigProcessingWorkerError("closed", "Processing worker allowedOutputRoot must be absolute.");
    }
    const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(maxPending) || maxPending < 0 || maxPending > 20) {
      throw new FixedRigProcessingWorkerError("closed", "Processing worker permits from zero through twenty pending side jobs.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
      throw new FixedRigProcessingWorkerError("closed", "Processing worker timeout must be from 100 to 300000 ms.");
    }
    this.allowedOutputRoot = path.resolve(options.allowedOutputRoot);
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
    this.workerPath = options.workerPath ?? path.resolve(__dirname, "..", "workers", "fixedRigGeometryProcessingWorker.js");
  }

  status(): FixedRigProcessingWorkerStatus {
    return {
      active: Boolean(this.activeJob),
      pending: this.pendingJobs.length,
      maxPending: this.maxPending,
      maxConcurrency: 1,
      closed: this.closed,
      ...(this.activeJob ? { activeIdentity: { ...this.activeJob.request.identity } } : {}),
    };
  }

  async resolveGeometryAuthority(input: {
    requestId: string;
    sessionId: string;
    captureBatch: FixedRigWarmSideCaptureBatch;
  }): Promise<FixedRigProcessingWorkerSuccessResponse> {
    return this.submit(await createFixedRigProcessingWorkerRequest({
      allowedOutputRoot: this.allowedOutputRoot,
      requestId: input.requestId,
      sessionId: input.sessionId,
      captureBatch: input.captureBatch,
    }));
  }

  submit(request: FixedRigProcessingWorkerRequest): Promise<FixedRigProcessingWorkerSuccessResponse>;
  submit<T>(
    request: FixedRigProcessingWorkerRequest,
    processResponse: (response: FixedRigProcessingWorkerSuccessResponse) => Promise<T>,
  ): Promise<T>;
  submit<T = FixedRigProcessingWorkerSuccessResponse>(
    request: FixedRigProcessingWorkerRequest,
    processResponse?: (response: FixedRigProcessingWorkerSuccessResponse) => Promise<T>,
  ): Promise<T> {
    try {
      validateFixedRigProcessingWorkerRequest(request);
    } catch {
      return Promise.reject(new FixedRigProcessingWorkerError("identity_mismatch", "Processing worker request identity is invalid."));
    }
    if (this.closed) {
      return Promise.reject(new FixedRigProcessingWorkerError("closed", "Processing worker is closed."));
    }
    if (this.activeJob && this.pendingJobs.length >= this.maxPending) {
      return Promise.reject(new FixedRigProcessingWorkerError("queue_full", "Processing worker queue is full."));
    }
    return new Promise<T>((resolve, reject) => {
      this.pendingJobs.push({ request, processResponse, resolve, reject });
      this.pump();
    });
  }

  async cancelSession(sessionId: string, reason?: string): Promise<void> {
    const message = safeReason(reason, "session processing cancelled");
    for (let index = this.pendingJobs.length - 1; index >= 0; index -= 1) {
      const job = this.pendingJobs[index]!;
      if (job.request.identity.sessionId === sessionId) {
        this.pendingJobs.splice(index, 1);
        job.reject(new FixedRigProcessingWorkerError("cancelled", message));
      }
    }
    const active = this.activeJob;
    if (active?.request.identity.sessionId === sessionId) {
      this.terminateActive(active, new FixedRigProcessingWorkerError("cancelled", message));
      await active.drained;
    }
  }

  shutdown(reason?: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closed = true;
    const message = safeReason(reason, "processing worker shutdown");
    this.shutdownPromise = (async () => {
      while (this.pendingJobs.length) {
        this.pendingJobs.shift()!.reject(new FixedRigProcessingWorkerError("shutdown", message));
      }
      const active = this.activeJob;
      if (active) {
        this.terminateActive(active, new FixedRigProcessingWorkerError("shutdown", message));
        await active.drained;
      }
    })();
    return this.shutdownPromise;
  }

  private pump(): void {
    if (this.closed || this.activeJob || !this.pendingJobs.length) return;
    const job = this.pendingJobs.shift()!;
    let resolveDrained!: () => void;
    const drained = new Promise<void>((resolve) => { resolveDrained = resolve; });
    let worker: Worker;
    try {
      worker = new Worker(this.workerPath, {
        workerData: { allowedOutputRoot: this.allowedOutputRoot },
        name: "tenkings-fixed-rig-geometry",
        stdout: false,
        stderr: false,
      });
    } catch {
      job.reject(new FixedRigProcessingWorkerError("crash", "Captured-evidence geometry worker could not start."));
      queueMicrotask(() => this.pump());
      return;
    }
    const active: ActiveJob = {
      ...job,
      worker,
      phase: "authority",
      revalidated: false,
      responseProcessing: false,
      timer: setTimeout(() => undefined, 0),
      finished: false,
      drained,
      resolveDrained,
    };
    clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      this.terminateActive(active, new FixedRigProcessingWorkerError("timeout", "Captured-evidence geometry worker timed out; processing stopped."));
    }, this.timeoutMs);
    this.activeJob = active;
    worker.on("message", (message: unknown) => this.onMessage(active, message));
    worker.once("error", () => {
      this.terminateActive(active, new FixedRigProcessingWorkerError("crash", "Captured-evidence geometry worker crashed."));
    });
    worker.once("exit", (code) => this.onExit(active, code));
    try {
      worker.postMessage(job.request);
    } catch {
      this.terminateActive(active, new FixedRigProcessingWorkerError("crash", "Captured-evidence geometry worker request could not start."));
    }
  }

  private onMessage(active: ActiveJob, message: unknown): void {
    if (active !== this.activeJob || active.finished || active.terminalError) return;
    let serialized: string;
    try {
      serialized = JSON.stringify(message);
    } catch {
      this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Geometry worker returned malformed data."));
      return;
    }
    if (!message || typeof message !== "object" || Buffer.byteLength(serialized, "utf8") > MAX_MESSAGE_BYTES) {
      this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Geometry worker response exceeded its bounded protocol."));
      return;
    }
    if (active.phase === "authority") {
      const response = message as FixedRigProcessingWorkerResponse;
      const successShape = response.ok === true && hasExactKeys(response, ["protocolVersion", "operation", "ok", "identity", "authority"]);
      const failureShape = response.ok === false && hasExactKeys(response, ["protocolVersion", "operation", "ok", "identity", "error"]);
      if (!successShape && !failureShape) {
        this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Geometry worker response shape was malformed."));
        return;
      }
      if (
        response.protocolVersion !== FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION ||
        response.operation !== FIXED_RIG_PROCESSING_WORKER_OPERATION ||
        !hasExactIdentity(response.identity) || !sameIdentity(response.identity, active.request.identity)
      ) {
        this.terminateActive(active, new FixedRigProcessingWorkerError("identity_mismatch", "Geometry worker response identity did not match its request."));
        return;
      }
      if (!response.ok) {
        if (
          !hasExactKeys(response.error, ["code", "message"]) ||
          ![
            "invalid_request", "containment_failed", "source_identity_failed", "source_integrity_failed",
            "authority_identity_failed", "processing_failed",
          ].includes(String(response.error.code)) ||
          typeof response.error.message !== "string" || response.error.message.length > 500
        ) {
          this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Geometry worker failure response was malformed."));
          return;
        }
        this.terminateActive(active, new FixedRigProcessingWorkerError(
          "worker_failed",
          "Captured-evidence geometry worker failed safely; processing stopped.",
          response.error.code,
        ));
        return;
      }
      try {
        validateFixedRigProcessingWorkerAuthority(active.request, response.authority);
      } catch {
        this.terminateActive(active, new FixedRigProcessingWorkerError("identity_mismatch", "Geometry worker authority did not match immutable source identity."));
        return;
      }
      active.response = response;
      active.phase = "revalidation";
      const command: RevalidateCommand = {
        protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
        operation: "revalidate_captured_source_identity",
        identity: { ...active.request.identity },
      };
      try {
        active.worker.postMessage(command);
      } catch {
        this.terminateActive(active, new FixedRigProcessingWorkerError("crash", "Captured-evidence source revalidation could not start."));
      }
      return;
    }
    const ack = message as RevalidateAck;
    if (!hasExactKeys(ack, ["protocolVersion", "operation", "ok", "identity"])) {
      this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Geometry worker revalidation response shape was malformed."));
      return;
    }
    if (
      ack.protocolVersion !== FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION ||
      ack.operation !== "revalidate_captured_source_identity" || ack.ok !== true ||
      !hasExactIdentity(ack.identity) || !sameIdentity(ack.identity, active.request.identity)
    ) {
      this.terminateActive(active, new FixedRigProcessingWorkerError("identity_mismatch", "Geometry worker revalidation identity did not match its request."));
      return;
    }
    active.revalidated = true;
  }

  private onExit(active: ActiveJob, code: number): void {
    if (active !== this.activeJob || active.finished) return;
    if (active.terminalError) {
      this.finishActive(active, active.terminalError);
    } else if (code !== 0 || !active.response || !active.revalidated) {
      this.finishActive(active, new FixedRigProcessingWorkerError("crash", "Geometry worker exited without one validated result."));
    } else if (active.processResponse) {
      active.responseProcessing = true;
      void active.processResponse(active.response).then(
        (result) => {
          active.responseProcessing = false;
          this.finishActive(active, active.terminalError, result);
        },
        (error) => {
          active.responseProcessing = false;
          this.finishActive(active, active.terminalError ?? error);
        },
      );
    } else {
      this.finishActive(active, undefined, active.response);
    }
  }

  private terminateActive(active: ActiveJob, error: FixedRigProcessingWorkerError): void {
    if (active.finished || active.terminalError) return;
    active.terminalError = error;
    if (active.responseProcessing) return;
    void active.worker.terminate().catch(() => this.finishActive(active, error));
  }

  private finishActive(active: ActiveJob, error?: unknown, response?: unknown): void {
    if (active.finished) return;
    active.finished = true;
    clearTimeout(active.timer);
    if (active === this.activeJob) this.activeJob = undefined;
    if (error) active.reject(error);
    else if (response !== undefined) active.resolve(response);
    else active.reject(new FixedRigProcessingWorkerError("crash", "Geometry worker ended without a terminal result."));
    active.resolveDrained();
    this.pump();
  }
}

export type FixedRigWarmProcessingWorkerIdentity =
  FixedRigProcessingWorkerIdentity & { mode: "captured_evidence_worker" };

export interface FixedRigWarmProcessingResult extends FixedRigWarmEvidencePackageResult {
  processingWorker: FixedRigWarmProcessingWorkerIdentity;
}

export interface FixedRigWarmForensicProcessingRunner {
  processSide(captureBatch: FixedRigWarmSideCaptureBatch, context: { requestId: string; sessionId: string }): Promise<FixedRigWarmProcessingResult>;
  cancelSession(sessionId: string, reason?: string): Promise<void>;
  shutdownProcessingWorker(reason?: string): Promise<void>;
  processingWorkerStatus(): FixedRigProcessingWorkerStatus;
}

export function createFixedRigWarmForensicProcessingRunner(
  options: FixedRigProcessingWorkerControllerOptions,
): FixedRigWarmForensicProcessingRunner {
  const controller = new FixedRigProcessingWorkerController(options);
  return {
    async processSide(captureBatch, context) {
      if (!SAFE_CONTEXT_ID_RE.test(context.requestId) || !SAFE_CONTEXT_ID_RE.test(context.sessionId)) {
        throw new FixedRigProcessingWorkerError("identity_mismatch", "Processing request or session identity is invalid.");
      }
      let captureSnapshot: FixedRigWarmSideCaptureBatch;
      try {
        captureSnapshot = structuredClone(captureBatch);
      } catch {
        throw new FixedRigProcessingWorkerError("identity_mismatch", "Captured side metadata could not be snapshotted safely.");
      }
      const contextSnapshot = { requestId: context.requestId, sessionId: context.sessionId };
      const request = await createFixedRigProcessingWorkerRequest({
        allowedOutputRoot: options.allowedOutputRoot,
        requestId: contextSnapshot.requestId,
        sessionId: contextSnapshot.sessionId,
        captureBatch: captureSnapshot,
      });
      return controller.submit(request, async (response) => {
        let resolverUsed = false;
        const result = await processFixedRigWarmSideBatch(captureSnapshot, {
          trustedWorkerGeometryAuthorityResolver: async (authorityInput: FixedRigFullResolutionGeometryAuthorityInput) => {
            if (resolverUsed) {
              throw new FixedRigProcessingWorkerError("identity_mismatch", "Main processing requested a different or duplicate geometry authority.");
            }
            await validateFixedRigProcessingWorkerAuthorityInput(request, authorityInput, options.allowedOutputRoot);
            resolverUsed = true;
            return response.authority;
          },
        });
        if (!resolverUsed) {
          throw new FixedRigProcessingWorkerError("identity_mismatch", "Main processing did not consume its exact worker authority once.");
        }
        return {
          ...result,
          processingWorker: { ...response.identity, mode: "captured_evidence_worker" as const },
        };
      });
    },
    cancelSession: (sessionId, reason) => controller.cancelSession(sessionId, reason),
    shutdownProcessingWorker: (reason) => controller.shutdown(reason),
    processingWorkerStatus: () => controller.status(),
  };
}
