import path from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  createFixedRigProcessingWorkerRequest,
  executeFixedRigProcessingWorkerRequest,
  fixedRigProcessingWorkerSafeError,
  FIXED_RIG_PROCESSING_WORKER_OPERATION,
  FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
  revalidateFixedRigProcessingWorkerSources,
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
const WARM_SIDE_WORKER_MODE = "fixed_rig_warm_side_processing";
const WARM_SIDE_WORKER_OPERATION = "process_fixed_rig_warm_side";

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
  /** Test-only full side-processing worker entry injection. */
  warmSideWorkerPath?: string;
}

interface FixedRigWarmProcessingAdmissionIdentity {
  readonly requestId: string;
  readonly sessionId: string;
  readonly packageId: string;
  readonly side: FixedRigWarmSideCaptureBatch["side"];
}

export interface FixedRigWarmProcessingAdmission extends FixedRigWarmProcessingAdmissionIdentity {
  readonly status: "accepted";
  readonly acceptedAt: string;
  readonly validationBoundary: "structural_snapshot_only";
  readonly sourceIntegrity: "pending_worker_validation";
}

interface PendingJobBase {
  kind: "geometry" | "warm_side";
  admissionIdentity: FixedRigWarmProcessingAdmissionIdentity;
  acceptedAt: string;
  request?: FixedRigProcessingWorkerRequest;
  resolve: (response: any) => void;
  reject: (error: any) => void;
}

interface GeometryPendingJob extends PendingJobBase {
  kind: "geometry";
  request: FixedRigProcessingWorkerRequest;
}

interface WarmSidePendingJob extends PendingJobBase {
  kind: "warm_side";
  captureBatch: FixedRigWarmSideCaptureBatch;
}

type PendingJob = GeometryPendingJob | WarmSidePendingJob;

interface RevalidateCommand {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: "revalidate_captured_source_identity";
  identity: FixedRigProcessingWorkerIdentity;
}

interface RevalidateAck extends RevalidateCommand {
  ok: true;
}

type ActiveJob = PendingJob & {
  worker: Worker;
  phase: "authority" | "revalidation" | "warm_processing";
  response?: FixedRigProcessingWorkerSuccessResponse;
  warmResult?: FixedRigWarmProcessingResult;
  revalidated: boolean;
  terminalError?: FixedRigProcessingWorkerError;
  timer: NodeJS.Timeout;
  finished: boolean;
  drained: Promise<void>;
  resolveDrained: () => void;
};

interface FixedRigWarmSideWorkerData {
  mode: typeof WARM_SIDE_WORKER_MODE;
  allowedOutputRoot: string;
  admissionIdentity: FixedRigWarmProcessingAdmissionIdentity;
  captureBatch: FixedRigWarmSideCaptureBatch;
}

interface FixedRigWarmSideWorkerSuccessResponse {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: typeof WARM_SIDE_WORKER_OPERATION;
  ok: true;
  identity: FixedRigProcessingWorkerIdentity;
  result: FixedRigWarmProcessingResult;
}

interface FixedRigWarmSideWorkerFailureResponse {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: typeof WARM_SIDE_WORKER_OPERATION;
  ok: false;
  error: {
    code: "processing_failed";
    message: string;
  };
}

type FixedRigWarmSideWorkerResponse =
  | FixedRigWarmSideWorkerSuccessResponse
  | FixedRigWarmSideWorkerFailureResponse;

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

function sameAdmissionIdentity(
  identity: FixedRigProcessingWorkerIdentity,
  admission: FixedRigWarmProcessingAdmissionIdentity,
): boolean {
  return (
    identity.requestId === admission.requestId &&
    identity.sessionId === admission.sessionId &&
    identity.packageId === admission.packageId &&
    identity.side === admission.side
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

function hasSafeWarmProcessingIdentity(value: unknown): value is FixedRigProcessingWorkerIdentity {
  return (
    hasExactIdentity(value) && value.protocolVersion === FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION &&
    SAFE_CONTEXT_ID_RE.test(value.requestId) && SAFE_CONTEXT_ID_RE.test(value.sessionId) &&
    SAFE_CONTEXT_ID_RE.test(value.packageId) && (value.side === "front" || value.side === "back") &&
    /^[a-f0-9]{64}$/.test(value.sourceSetSha256)
  );
}

function hasSafeWarmProcessingResultIdentity(value: unknown): value is FixedRigWarmProcessingWorkerIdentity {
  if (!hasExactKeys(value, ["protocolVersion", "requestId", "sessionId", "packageId", "side", "sourceSetSha256", "mode"])) {
    return false;
  }
  const { mode, ...identity } = value;
  return mode === "captured_evidence_worker" && hasSafeWarmProcessingIdentity(identity);
}

function isPathContained(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export class FixedRigProcessingWorkerController {
  readonly allowedOutputRoot: string;
  readonly maxPending: number;
  readonly timeoutMs: number;
  readonly workerPath: string;
  readonly warmSideWorkerPath: string;
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
    this.warmSideWorkerPath = options.warmSideWorkerPath ?? __filename;
  }

  status(): FixedRigProcessingWorkerStatus {
    return {
      active: Boolean(this.activeJob),
      pending: this.pendingJobs.length,
      maxPending: this.maxPending,
      maxConcurrency: 1,
      closed: this.closed,
      ...(this.activeJob?.request ? { activeIdentity: { ...this.activeJob.request.identity } } : {}),
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

  submit(request: FixedRigProcessingWorkerRequest): Promise<FixedRigProcessingWorkerSuccessResponse> {
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
    return new Promise<FixedRigProcessingWorkerSuccessResponse>((resolve, reject) => {
      this.pendingJobs.push({
        kind: "geometry",
        admissionIdentity: {
          requestId: request.identity.requestId,
          sessionId: request.identity.sessionId,
          packageId: request.identity.packageId,
          side: request.identity.side,
        },
        acceptedAt: new Date().toISOString(),
        request,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  admitWarmSide(input: {
    captureBatch: FixedRigWarmSideCaptureBatch;
    requestId: string;
    sessionId: string;
  }): { admission: FixedRigWarmProcessingAdmission; result: Promise<FixedRigWarmProcessingResult> } {
    if (!SAFE_CONTEXT_ID_RE.test(input.requestId) || !SAFE_CONTEXT_ID_RE.test(input.sessionId)) {
      throw new FixedRigProcessingWorkerError("identity_mismatch", "Processing request or session identity is invalid.");
    }
    if (
      !input.captureBatch || input.captureBatch.executionPath !== "warm_full_forensic_runner" ||
      !SAFE_CONTEXT_ID_RE.test(input.captureBatch.packageId) ||
      (input.captureBatch.side !== "front" && input.captureBatch.side !== "back") ||
      !path.isAbsolute(input.captureBatch.packageDir) || !path.isAbsolute(input.captureBatch.sideDir) ||
      !isPathContained(this.allowedOutputRoot, input.captureBatch.packageDir) ||
      path.resolve(input.captureBatch.sideDir) !== path.resolve(input.captureBatch.packageDir, input.captureBatch.side) ||
      input.captureBatch.batch?.side !== input.captureBatch.side ||
      path.resolve(input.captureBatch.batch?.outputDir ?? "") !== path.resolve(input.captureBatch.sideDir)
    ) {
      throw new FixedRigProcessingWorkerError("identity_mismatch", "Captured side structural metadata is invalid.");
    }
    let captureSnapshot: FixedRigWarmSideCaptureBatch;
    try {
      captureSnapshot = structuredClone(input.captureBatch);
    } catch {
      throw new FixedRigProcessingWorkerError("identity_mismatch", "Captured side metadata could not be snapshotted safely.");
    }
    if (this.closed) {
      throw new FixedRigProcessingWorkerError("closed", "Processing worker is closed.");
    }
    if (this.activeJob && this.pendingJobs.length >= this.maxPending) {
      throw new FixedRigProcessingWorkerError("queue_full", "Processing worker queue is full.");
    }
    const admissionIdentity: FixedRigWarmProcessingAdmissionIdentity = {
      requestId: input.requestId,
      sessionId: input.sessionId,
      packageId: captureSnapshot.packageId,
      side: captureSnapshot.side,
    };
    const acceptedAt = new Date().toISOString();
    let resolveResult!: (result: FixedRigWarmProcessingResult) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<FixedRigWarmProcessingResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.pendingJobs.push({
      kind: "warm_side",
      admissionIdentity,
      acceptedAt,
      captureBatch: captureSnapshot,
      resolve: resolveResult,
      reject: rejectResult,
    });
    this.pump();
    return {
      admission: Object.freeze({
        ...admissionIdentity,
        status: "accepted",
        acceptedAt,
        validationBoundary: "structural_snapshot_only",
        sourceIntegrity: "pending_worker_validation",
      }),
      result,
    };
  }

  async cancelSession(sessionId: string, reason?: string): Promise<void> {
    const message = safeReason(reason, "session processing cancelled");
    for (let index = this.pendingJobs.length - 1; index >= 0; index -= 1) {
      const job = this.pendingJobs[index]!;
      if (job.admissionIdentity.sessionId === sessionId) {
        this.pendingJobs.splice(index, 1);
        job.reject(new FixedRigProcessingWorkerError("cancelled", message));
      }
    }
    const active = this.activeJob;
    if (active?.admissionIdentity.sessionId === sessionId) {
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
      worker = new Worker(job.kind === "warm_side" ? this.warmSideWorkerPath : this.workerPath, {
        workerData: job.kind === "warm_side"
          ? {
              mode: WARM_SIDE_WORKER_MODE,
              allowedOutputRoot: this.allowedOutputRoot,
              admissionIdentity: { ...job.admissionIdentity },
              captureBatch: job.captureBatch,
            } satisfies FixedRigWarmSideWorkerData
          : { allowedOutputRoot: this.allowedOutputRoot },
        name: job.kind === "warm_side" ? "tenkings-fixed-rig-warm-side" : "tenkings-fixed-rig-geometry",
        stdout: false,
        stderr: false,
      });
    } catch {
      job.reject(new FixedRigProcessingWorkerError("crash", "Captured-evidence processing worker could not start."));
      queueMicrotask(() => this.pump());
      return;
    }
    const active: ActiveJob = {
      ...job,
      worker,
      phase: job.kind === "warm_side" ? "warm_processing" : "authority",
      revalidated: false,
      timer: setTimeout(() => undefined, 0),
      finished: false,
      drained,
      resolveDrained,
    };
    clearTimeout(active.timer);
    active.timer = setTimeout(() => {
      this.terminateActive(active, new FixedRigProcessingWorkerError("timeout", "Captured-evidence processing worker timed out; processing stopped."));
    }, this.timeoutMs);
    this.activeJob = active;
    worker.on("message", (message: unknown) => this.onMessage(active, message));
    worker.once("error", () => {
      this.terminateActive(active, new FixedRigProcessingWorkerError("crash", "Captured-evidence processing worker crashed."));
    });
    worker.once("exit", (code) => this.onExit(active, code));
    if (job.kind === "geometry") {
      try {
        worker.postMessage(job.request);
      } catch {
        this.terminateActive(active, new FixedRigProcessingWorkerError("crash", "Captured-evidence geometry worker request could not start."));
      }
    }
  }

  private onMessage(active: ActiveJob, message: unknown): void {
    if (active !== this.activeJob || active.finished || active.terminalError) return;
    if (active.kind === "warm_side") {
      this.onWarmSideMessage(active, message);
      return;
    }
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

  private onWarmSideMessage(active: ActiveJob & WarmSidePendingJob, message: unknown): void {
    if (!message || typeof message !== "object") {
      this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Side-processing worker response shape was malformed."));
      return;
    }
    const response = message as FixedRigWarmSideWorkerResponse;
    const successShape = response.ok === true && hasExactKeys(response, ["protocolVersion", "operation", "ok", "identity", "result"]);
    const failureShape = response.ok === false && hasExactKeys(response, ["protocolVersion", "operation", "ok", "error"]);
    if (
      active.warmResult || (!successShape && !failureShape) ||
      response.protocolVersion !== FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION ||
      response.operation !== WARM_SIDE_WORKER_OPERATION
    ) {
      this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Side-processing worker response shape was malformed."));
      return;
    }
    if (!response.ok) {
      if (
        !hasExactKeys(response.error, ["code", "message"]) || response.error.code !== "processing_failed" ||
        typeof response.error.message !== "string" || response.error.message.length > 500
      ) {
        this.terminateActive(active, new FixedRigProcessingWorkerError("malformed_response", "Side-processing worker failure response was malformed."));
        return;
      }
      this.terminateActive(active, new FixedRigProcessingWorkerError(
        "worker_failed",
        "Captured-evidence side processing failed safely; processing stopped.",
        "processing_failed",
      ));
      return;
    }
    if (
      !hasSafeWarmProcessingIdentity(response.identity) || !sameAdmissionIdentity(response.identity, active.admissionIdentity) ||
      !response.result || response.result.executionPath !== "warm_full_forensic_runner" ||
      response.result.packageId !== active.admissionIdentity.packageId ||
      !hasSafeWarmProcessingResultIdentity(response.result.processingWorker) ||
      !sameIdentity(response.result.processingWorker, response.identity) ||
      response.result.processingWorker.mode !== "captured_evidence_worker"
    ) {
      this.terminateActive(active, new FixedRigProcessingWorkerError("identity_mismatch", "Side-processing worker result identity did not match its admitted snapshot."));
      return;
    }
    active.warmResult = response.result;
  }

  private onExit(active: ActiveJob, code: number): void {
    if (active !== this.activeJob || active.finished) return;
    if (active.terminalError) {
      this.finishActive(active, active.terminalError);
    } else if (active.kind === "warm_side") {
      if (code !== 0 || !active.warmResult) {
        this.finishActive(active, new FixedRigProcessingWorkerError("crash", "Side-processing worker exited without one validated result."));
      } else {
        this.finishActive(active, undefined, active.warmResult);
      }
    } else if (code !== 0 || !active.response || !active.revalidated) {
      this.finishActive(active, new FixedRigProcessingWorkerError("crash", "Geometry worker exited without one validated result."));
    } else {
      this.finishActive(active, undefined, active.response);
    }
  }

  private terminateActive(active: ActiveJob, error: FixedRigProcessingWorkerError): void {
    if (active.finished || active.terminalError) return;
    active.terminalError = error;
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

export interface FixedRigWarmProcessingSubmission extends Promise<FixedRigWarmProcessingResult> {
  admission: Promise<FixedRigWarmProcessingAdmission>;
}

export interface FixedRigWarmForensicProcessingRunner {
  processSide(
    captureBatch: FixedRigWarmSideCaptureBatch,
    context: { requestId: string; sessionId: string },
  ): FixedRigWarmProcessingSubmission;
  cancelSession(sessionId: string, reason?: string): Promise<void>;
  shutdownProcessingWorker(reason?: string): Promise<void>;
  processingWorkerStatus(): FixedRigProcessingWorkerStatus;
}

export function createFixedRigWarmForensicProcessingRunner(
  options: FixedRigProcessingWorkerControllerOptions,
): FixedRigWarmForensicProcessingRunner {
  const controller = new FixedRigProcessingWorkerController(options);
  return {
    processSide(captureBatch, context) {
      const admitted = controller.admitWarmSide({
        captureBatch,
        requestId: context.requestId,
        sessionId: context.sessionId,
      });
      return Object.assign(admitted.result, { admission: Promise.resolve(admitted.admission) });
    },
    cancelSession: (sessionId, reason) => controller.cancelSession(sessionId, reason),
    shutdownProcessingWorker: (reason) => controller.shutdown(reason),
    processingWorkerStatus: () => controller.status(),
  };
}

async function runFixedRigWarmSideWorker(): Promise<void> {
  if (!parentPort) throw new Error("Warm side-processing worker requires a parent message port.");
  const port: NonNullable<typeof parentPort> = parentPort;
  const data = workerData as Partial<FixedRigWarmSideWorkerData> | undefined;
  let request: FixedRigProcessingWorkerRequest | undefined;
  try {
    if (
      !data || data.mode !== WARM_SIDE_WORKER_MODE || typeof data.allowedOutputRoot !== "string" ||
      !path.isAbsolute(data.allowedOutputRoot) || !data.admissionIdentity || !data.captureBatch
    ) {
      throw new Error("Warm side-processing worker data was invalid.");
    }
    const admissionIdentity = data.admissionIdentity;
    if (
      !SAFE_CONTEXT_ID_RE.test(admissionIdentity.requestId) || !SAFE_CONTEXT_ID_RE.test(admissionIdentity.sessionId) ||
      admissionIdentity.packageId !== data.captureBatch.packageId || admissionIdentity.side !== data.captureBatch.side
    ) {
      throw new Error("Warm side-processing admission identity was invalid.");
    }
    request = await createFixedRigProcessingWorkerRequest({
      allowedOutputRoot: data.allowedOutputRoot,
      requestId: admissionIdentity.requestId,
      sessionId: admissionIdentity.sessionId,
      captureBatch: data.captureBatch,
    });
    if (!sameAdmissionIdentity(request.identity, admissionIdentity)) {
      throw new Error("Warm side-processing request identity did not match admission.");
    }
    const response = await executeFixedRigProcessingWorkerRequest(request, data.allowedOutputRoot);
    await revalidateFixedRigProcessingWorkerSources(request, data.allowedOutputRoot);
    let resolverUsed = false;
    const result = await processFixedRigWarmSideBatch(data.captureBatch, {
      trustedWorkerGeometryAuthorityResolver: async (authorityInput: FixedRigFullResolutionGeometryAuthorityInput) => {
        if (resolverUsed) {
          throw new Error("Warm side processing requested duplicate geometry authority.");
        }
        await validateFixedRigProcessingWorkerAuthorityInput(request!, authorityInput, data.allowedOutputRoot!);
        resolverUsed = true;
        return response.authority;
      },
    });
    if (!resolverUsed || result.packageId !== request.identity.packageId) {
      throw new Error("Warm side processing did not consume its exact geometry authority once.");
    }
    const processingResult: FixedRigWarmProcessingResult = {
      ...result,
      processingWorker: { ...response.identity, mode: "captured_evidence_worker" },
    };
    const success: FixedRigWarmSideWorkerSuccessResponse = {
      protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
      operation: WARM_SIDE_WORKER_OPERATION,
      ok: true,
      identity: { ...response.identity },
      result: processingResult,
    };
    port.postMessage(success);
  } catch (error) {
    const failure: FixedRigWarmSideWorkerFailureResponse = {
      protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
      operation: WARM_SIDE_WORKER_OPERATION,
      ok: false,
      error: {
        code: "processing_failed",
        message: fixedRigProcessingWorkerSafeError(error),
      },
    };
    port.postMessage(failure);
  } finally {
    port.close();
  }
}

if (!isMainThread && (workerData as Partial<FixedRigWarmSideWorkerData> | undefined)?.mode === WARM_SIDE_WORKER_MODE) {
  void runFixedRigWarmSideWorker();
}
