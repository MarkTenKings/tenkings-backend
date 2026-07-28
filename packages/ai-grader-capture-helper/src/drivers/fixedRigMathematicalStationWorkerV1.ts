import path from "node:path";
import { availableParallelism } from "node:os";
import { deserialize, serialize } from "node:v8";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import {
  buildFixedRigMathematicalCalibrationStationPackageV1,
  type BuildFixedRigMathematicalCalibrationStationPackageV1Input,
  type BuildFixedRigMathematicalCalibrationStationPackageV1Result,
} from "./fixedRigMathematicalStationAdapterV1";
import {
  FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
} from "./fixedRigMathematicalCalibrationOrchestratorV1";
import {
  AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE,
  AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE,
  AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_FILE,
  AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE,
} from "./aiGraderMathematicalReportPackageV1";

const MATHEMATICAL_STATION_WORKER_PROTOCOL_VERSION =
  "ten-kings-fixed-rig-mathematical-station-worker-v1" as const;
const MATHEMATICAL_STATION_WORKER_MODE =
  "fixed_rig_mathematical_station_package" as const;
const MATHEMATICAL_STATION_WORKER_OPERATION =
  "build_fixed_rig_mathematical_station_package" as const;
const DEFAULT_MATHEMATICAL_STATION_WORKER_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MATHEMATICAL_STATION_WORKER_MAX_ADMITTED = 25;
const DEFAULT_MATHEMATICAL_STATION_WORKER_CONCURRENCY = Math.max(
  1,
  Math.min(2, availableParallelism() - 1),
);
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,219}$/;

interface MathematicalStationWorkerIdentityV1 {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
}

interface MathematicalStationWorkerDataV1 {
  mode: typeof MATHEMATICAL_STATION_WORKER_MODE;
  payload: Uint8Array;
}

interface MathematicalStationWorkerSuccessV1 {
  protocolVersion: typeof MATHEMATICAL_STATION_WORKER_PROTOCOL_VERSION;
  operation: typeof MATHEMATICAL_STATION_WORKER_OPERATION;
  ok: true;
  identity: MathematicalStationWorkerIdentityV1;
  payload: Uint8Array;
}

interface MathematicalStationWorkerFailureV1 {
  protocolVersion: typeof MATHEMATICAL_STATION_WORKER_PROTOCOL_VERSION;
  operation: typeof MATHEMATICAL_STATION_WORKER_OPERATION;
  ok: false;
  identity?: MathematicalStationWorkerIdentityV1;
  error: {
    code: "processing_failed";
    message: string;
  };
}

type MathematicalStationWorkerResponseV1 =
  | MathematicalStationWorkerSuccessV1
  | MathematicalStationWorkerFailureV1;

export interface FixedRigMathematicalStationWorkerOptionsV1 {
  /** Test-only compiled worker entry injection. */
  workerPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Test-only observation of the actual Worker lifecycle. */
  onWorkerLifecycle?: (state: "started" | "exited") => void;
}

export interface FixedRigMathematicalStationWorkerPoolOptionsV1 {
  /** Test-only compiled worker entry injection. */
  workerPath?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  maxAdmitted?: number;
  /** Test-only observation of the actual Worker lifecycle. */
  onWorkerLifecycle?: (state: "started" | "exited") => void;
}

export interface FixedRigMathematicalStationWorkerPoolStatusV1 {
  limit: number;
  active: number;
  queued: number;
  admitted: number;
  admittedLimit: number;
}

export class FixedRigMathematicalStationWorkerErrorV1 extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "timeout"
      | "crash"
      | "malformed_response"
      | "identity_mismatch"
      | "processing_failed"
      | "queue_full"
      | "shutdown"
      | "duplicate",
    message: string,
  ) {
    super(message);
    this.name = "FixedRigMathematicalStationWorkerErrorV1";
  }
}

interface FixedRigMathematicalStationWorkerPoolJobV1 {
  identityKey: string;
  input: BuildFixedRigMathematicalCalibrationStationPackageV1Input;
  resolve: (
    result: BuildFixedRigMathematicalCalibrationStationPackageV1Result,
  ) => void;
  reject: (error: unknown) => void;
}

function exactIdentity(
  input: Pick<
    BuildFixedRigMathematicalCalibrationStationPackageV1Input,
    "queueItemId" | "gradingSessionId" | "reportId"
  >,
): MathematicalStationWorkerIdentityV1 {
  const identity = {
    queueItemId: input.queueItemId,
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
  };
  if (
    !SAFE_ID_RE.test(identity.queueItemId) ||
    !SAFE_ID_RE.test(identity.gradingSessionId) ||
    !SAFE_ID_RE.test(identity.reportId)
  ) {
    throw new FixedRigMathematicalStationWorkerErrorV1(
      "invalid_request",
      "Mathematical processing worker requires exact safe queue, session, and report identities.",
    );
  }
  return identity;
}

function identitiesMatch(
  left: MathematicalStationWorkerIdentityV1 | undefined,
  right: MathematicalStationWorkerIdentityV1,
): boolean {
  return Boolean(
    left &&
      left.queueItemId === right.queueItemId &&
      left.gradingSessionId === right.gradingSessionId &&
      left.reportId === right.reportId,
  );
}

function validIdentity(
  value: unknown,
): value is MathematicalStationWorkerIdentityV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Partial<MathematicalStationWorkerIdentityV1>;
  return (
    typeof identity.queueItemId === "string" &&
    SAFE_ID_RE.test(identity.queueItemId) &&
    typeof identity.gradingSessionId === "string" &&
    SAFE_ID_RE.test(identity.gradingSessionId) &&
    typeof identity.reportId === "string" &&
    SAFE_ID_RE.test(identity.reportId)
  );
}

function exactResponseShape(
  value: unknown,
): value is MathematicalStationWorkerResponseV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (
    response.protocolVersion !== MATHEMATICAL_STATION_WORKER_PROTOCOL_VERSION ||
    response.operation !== MATHEMATICAL_STATION_WORKER_OPERATION ||
    (response.ok !== true && response.ok !== false)
  ) {
    return false;
  }
  if (response.ok) {
    return (
      validIdentity(response.identity) &&
      response.payload instanceof Uint8Array
    );
  }
  const error =
    response.error && typeof response.error === "object"
      ? response.error as Record<string, unknown>
      : undefined;
  return (
    Boolean(error) &&
    error?.code === "processing_failed" &&
    typeof error.message === "string"
  );
}

function safeWorkerFailure(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (
    !message ||
    message.length > 500 ||
    /(?:token|secret|bearer|authorization|api[-_ ]?key|password|cookie)\s*[:=]/i.test(
      message,
    ) ||
    /(?:[A-Za-z]:\\|\/(?:home|root|Users|var|tmp)\/)/.test(message)
  ) {
    return "Mathematical processing worker failed before returning a validated result.";
  }
  return message.replace(/[\r\n\t]+/g, " ").trim();
}

function validMathematicalStationResult(
  value: unknown,
): value is BuildFixedRigMathematicalCalibrationStationPackageV1Result {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.version ===
      FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION &&
    (
      result.status === "completed" ||
      result.status === "finding_review_required" ||
      result.status === "operator_resolution_required" ||
      result.status === "insufficient_evidence"
    ) &&
    result.gradingContract === "mathematical_calibration_v1" &&
    result.v0FallbackUsed === false
  );
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`));
}

function validateResultIdentityMembers(
  value: unknown,
  identity: MathematicalStationWorkerIdentityV1,
): boolean {
  if (!value || typeof value !== "object") return true;
  const seen = new Set<object>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    for (const [key, member] of Object.entries(record)) {
      if (
        key === "queueItemId" &&
        (typeof member !== "string" || member !== identity.queueItemId)
      ) {
        return false;
      }
      if (
        key === "gradingSessionId" &&
        (typeof member !== "string" || member !== identity.gradingSessionId)
      ) {
        return false;
      }
      if (
        key === "sessionId" &&
        (typeof member !== "string" || member !== identity.gradingSessionId)
      ) {
        return false;
      }
      if (
        key === "reportId" &&
        (typeof member !== "string" || member !== identity.reportId)
      ) {
        return false;
      }
      if (member && typeof member === "object") {
        pending.push(member);
      }
    }
  }
  return true;
}

function validateResultOutputPaths(
  result: BuildFixedRigMathematicalCalibrationStationPackageV1Result,
  outputDir: string,
): boolean {
  const exactOutputDir = path.resolve(outputDir);
  if (result.status !== "completed") {
    return result.reportPackage === null && result.stationInput === null;
  }
  if (
    !path.isAbsolute(result.stationInput.mathematicalReportPackagePath) ||
    !path.isAbsolute(result.reportPackage.outputDir) ||
    path.resolve(result.stationInput.mathematicalReportPackagePath) !==
      exactOutputDir ||
    path.resolve(result.reportPackage.outputDir) !== exactOutputDir
  ) {
    return false;
  }
  const expectedPackagePaths: Array<[string, string]> = [
    [
      result.reportPackage.bundlePath,
      path.join(exactOutputDir, AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE),
    ],
    [
      result.reportPackage.envelopePath,
      path.join(exactOutputDir, AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE),
    ],
    [
      result.reportPackage.assetManifestPath,
      path.join(
        exactOutputDir,
        AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE,
      ),
    ],
    [
      result.reportPackage.checksumsPath,
      path.join(exactOutputDir, AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_FILE),
    ],
  ];
  if (expectedPackagePaths.some(([observed, expected]) =>
    path.resolve(observed) !== expected)) {
    return false;
  }
  const pending: unknown[] = [result.reportPackage];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (ArrayBuffer.isView(current) || current instanceof ArrayBuffer) continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, member] of Object.entries(
      current as Record<string, unknown>,
    )) {
      if (typeof member === "string") {
        if (key === "relativePath" || key.endsWith("File")) {
          if (
            path.isAbsolute(member) ||
            !pathIsWithin(exactOutputDir, path.resolve(exactOutputDir, member))
          ) {
            return false;
          }
        } else if (
          key === "path" ||
          key === "outputDir" ||
          key.endsWith("Path") ||
          key.endsWith("Directory") ||
          key.endsWith("Dir")
        ) {
          if (
            !path.isAbsolute(member) ||
            !pathIsWithin(exactOutputDir, path.resolve(member))
          ) {
            return false;
          }
        }
      } else if (member && typeof member === "object") {
        pending.push(member);
      }
    }
  }
  return true;
}

function validateMathematicalStationResultContainment(
  result: BuildFixedRigMathematicalCalibrationStationPackageV1Result,
  identity: MathematicalStationWorkerIdentityV1,
  outputDir: string,
): "identity_mismatch" | "path_mismatch" | null {
  if (!validateResultIdentityMembers(result, identity)) {
    return "identity_mismatch";
  }
  if (!validateResultOutputPaths(result, outputDir)) {
    return "path_mismatch";
  }
  return null;
}

export function buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
  input: BuildFixedRigMathematicalCalibrationStationPackageV1Input,
  options: FixedRigMathematicalStationWorkerOptionsV1 = {},
): Promise<BuildFixedRigMathematicalCalibrationStationPackageV1Result> {
  if (options.signal?.aborted) {
    return Promise.reject(
      new FixedRigMathematicalStationWorkerErrorV1(
        "shutdown",
        "Mathematical processing worker was cancelled before start.",
      ),
    );
  }
  const identity = exactIdentity(input);
  if (!path.isAbsolute(input.outputDir)) {
    return Promise.reject(
      new FixedRigMathematicalStationWorkerErrorV1(
        "invalid_request",
        "Mathematical processing worker requires one absolute report output directory.",
      ),
    );
  }
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_MATHEMATICAL_STATION_WORKER_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > DEFAULT_MATHEMATICAL_STATION_WORKER_TIMEOUT_MS
  ) {
    return Promise.reject(
      new FixedRigMathematicalStationWorkerErrorV1(
        "invalid_request",
        "Mathematical processing worker timeout must be from 100 through 600000 milliseconds.",
      ),
    );
  }

  let payload: Buffer;
  try {
    payload = serialize(input);
  } catch {
    return Promise.reject(
      new FixedRigMathematicalStationWorkerErrorV1(
        "invalid_request",
        "Mathematical processing input could not be serialized for isolated execution.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let exited = false;
    let worker: Worker;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    let terminationRequested = false;
    let outcome:
      | {
          error: FixedRigMathematicalStationWorkerErrorV1;
          result?: never;
        }
      | {
          error?: never;
          result: BuildFixedRigMathematicalCalibrationStationPackageV1Result;
        }
      | undefined;
    const settleAfterExit = () => {
      if (!exited) return;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (outcome?.error) reject(outcome.error);
      else if (outcome?.result) resolve(outcome.result);
      else {
        reject(
          new FixedRigMathematicalStationWorkerErrorV1(
            "crash",
            "Mathematical processing worker ended without one validated result.",
          ),
        );
      }
    };
    const requestTermination = () => {
      if (terminationRequested || exited) return;
      terminationRequested = true;
      void worker.terminate().catch(() => undefined);
    };
    const recordOutcome = (
      error?: FixedRigMathematicalStationWorkerErrorV1,
      result?: BuildFixedRigMathematicalCalibrationStationPackageV1Result,
      terminate = false,
    ) => {
      if (outcome) {
        if (terminate && error && outcome.result) outcome = { error };
        if (terminate) requestTermination();
        settleAfterExit();
        return;
      }
      if (error) outcome = { error };
      else if (result) outcome = { result };
      else outcome = {
        error: new FixedRigMathematicalStationWorkerErrorV1(
          "crash",
          "Mathematical processing worker ended without one validated result.",
        ),
      };
      if (terminate) requestTermination();
      settleAfterExit();
    };
    onAbort = () =>
      recordOutcome(
        new FixedRigMathematicalStationWorkerErrorV1(
          "shutdown",
          "Mathematical processing worker was cancelled during helper shutdown.",
        ),
        undefined,
        true,
      );
    try {
      worker = new Worker(options.workerPath ?? __filename, {
        workerData: {
          mode: MATHEMATICAL_STATION_WORKER_MODE,
          payload,
        } satisfies MathematicalStationWorkerDataV1,
        name: "tenkings-fixed-rig-mathematical-station",
        stdout: false,
        stderr: false,
      });
      try {
        options.onWorkerLifecycle?.("started");
      } catch {
        // Test-only observation cannot own worker execution.
      }
    } catch {
      reject(
        new FixedRigMathematicalStationWorkerErrorV1(
          "crash",
          "Mathematical processing worker could not start.",
        ),
      );
      return;
    }
    timer = setTimeout(
      () =>
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            "timeout",
            "Mathematical processing worker exceeded its bounded runtime.",
          ),
          undefined,
          true,
        ),
      timeoutMs,
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    worker.once("message", (message: unknown) => {
      if (!exactResponseShape(message)) {
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            "malformed_response",
            "Mathematical processing worker returned a malformed response.",
          ),
          undefined,
          true,
        );
        return;
      }
      if (!identitiesMatch(message.identity, identity)) {
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            "identity_mismatch",
            "Mathematical processing worker returned a cross-card response.",
          ),
          undefined,
          true,
        );
        return;
      }
      if (!message.ok) {
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            "processing_failed",
            safeWorkerFailure(message.error.message),
          ),
        );
        return;
      }
      let result: BuildFixedRigMathematicalCalibrationStationPackageV1Result;
      try {
        result = deserialize(
          Buffer.from(message.payload),
        ) as BuildFixedRigMathematicalCalibrationStationPackageV1Result;
      } catch {
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            "malformed_response",
            "Mathematical processing worker result could not be decoded.",
          ),
          undefined,
          true,
        );
        return;
      }
      if (!validMathematicalStationResult(result)) {
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            "malformed_response",
            "Mathematical processing worker result violated the strict V1 contract.",
          ),
          undefined,
          true,
        );
        return;
      }
      const containmentIssue = validateMathematicalStationResultContainment(
        result,
        identity,
        input.outputDir,
      );
      if (containmentIssue) {
        recordOutcome(
          new FixedRigMathematicalStationWorkerErrorV1(
            containmentIssue === "identity_mismatch"
              ? "identity_mismatch"
              : "malformed_response",
            containmentIssue === "identity_mismatch"
              ? "Mathematical processing worker result contained a cross-card identity."
              : "Mathematical processing worker result contained an invalid output path.",
          ),
          undefined,
          true,
        );
        return;
      }
      recordOutcome(undefined, result);
    });
    worker.once("error", () => {
      recordOutcome(
        new FixedRigMathematicalStationWorkerErrorV1(
          "crash",
          "Mathematical processing worker crashed.",
        ),
      );
    });
    worker.once("exit", (code) => {
      try {
        options.onWorkerLifecycle?.("exited");
      } catch {
        // Test-only observation cannot own worker settlement.
      }
      exited = true;
      if (!outcome) {
        outcome = {
          error: new FixedRigMathematicalStationWorkerErrorV1(
            "crash",
            code === 0
              ? "Mathematical processing worker exited without one validated result."
              : "Mathematical processing worker exited unexpectedly.",
          ),
        };
      } else if (
        code !== 0 &&
        outcome.result &&
        !terminationRequested
      ) {
        outcome = {
          error: new FixedRigMathematicalStationWorkerErrorV1(
            "crash",
            "Mathematical processing worker exited unexpectedly.",
          ),
        };
      }
      settleAfterExit();
    });
  });
}

/**
 * Parent-owned admission pool for CPU-heavy deterministic builds.
 *
 * The rapid-card scheduler may admit 25 exact-card jobs, while this pool keeps
 * only a small, explicit number of worker threads active. Inputs are snapshotted
 * at admission so caller mutation cannot retarget a queued job.
 */
export class FixedRigMathematicalStationWorkerPoolV1 {
  readonly maxConcurrency: number;
  readonly maxAdmitted: number;
  private readonly workerOptions: FixedRigMathematicalStationWorkerOptionsV1;
  private readonly pending: FixedRigMathematicalStationWorkerPoolJobV1[] = [];
  private readonly admittedIdentities = new Set<string>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeJobs = new Map<string, Promise<void>>();
  private active = 0;
  private stopped = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    options: FixedRigMathematicalStationWorkerPoolOptionsV1 = {},
  ) {
    const maxConcurrency =
      options.maxConcurrency ??
      DEFAULT_MATHEMATICAL_STATION_WORKER_CONCURRENCY;
    const maxAdmitted =
      options.maxAdmitted ??
      DEFAULT_MATHEMATICAL_STATION_WORKER_MAX_ADMITTED;
    if (
      !Number.isInteger(maxConcurrency) ||
      maxConcurrency < 1 ||
      maxConcurrency > DEFAULT_MATHEMATICAL_STATION_WORKER_MAX_ADMITTED
    ) {
      throw new FixedRigMathematicalStationWorkerErrorV1(
        "invalid_request",
        "Mathematical worker-pool concurrency must be from 1 through 25.",
      );
    }
    if (
      !Number.isInteger(maxAdmitted) ||
      maxAdmitted < maxConcurrency ||
      maxAdmitted > DEFAULT_MATHEMATICAL_STATION_WORKER_MAX_ADMITTED
    ) {
      throw new FixedRigMathematicalStationWorkerErrorV1(
        "invalid_request",
        "Mathematical worker-pool admission must cover concurrency and be no greater than 25.",
      );
    }
    this.maxConcurrency = maxConcurrency;
    this.maxAdmitted = maxAdmitted;
    this.workerOptions = {
      ...(options.workerPath ? { workerPath: options.workerPath } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.onWorkerLifecycle
        ? { onWorkerLifecycle: options.onWorkerLifecycle }
        : {}),
    };
  }

  status(): FixedRigMathematicalStationWorkerPoolStatusV1 {
    return {
      limit: this.maxConcurrency,
      active: this.active,
      queued: this.pending.length,
      admitted: this.active + this.pending.length,
      admittedLimit: this.maxAdmitted,
    };
  }

  run(
    input: BuildFixedRigMathematicalCalibrationStationPackageV1Input,
  ): Promise<BuildFixedRigMathematicalCalibrationStationPackageV1Result> {
    if (this.stopped) {
      return Promise.reject(
        new FixedRigMathematicalStationWorkerErrorV1(
          "shutdown",
          "Mathematical worker pool is shut down.",
        ),
      );
    }
    let snapshot: BuildFixedRigMathematicalCalibrationStationPackageV1Input;
    let identityKey: string;
    try {
      const identity = exactIdentity(input);
      identityKey = [
        identity.queueItemId,
        identity.gradingSessionId,
        identity.reportId,
      ].join("\u0000");
      if (!path.isAbsolute(input.outputDir)) {
        throw new Error("output directory must be absolute");
      }
      snapshot = deserialize(
        serialize(input),
      ) as BuildFixedRigMathematicalCalibrationStationPackageV1Input;
    } catch (error) {
      return Promise.reject(
        error instanceof FixedRigMathematicalStationWorkerErrorV1
          ? error
          : new FixedRigMathematicalStationWorkerErrorV1(
              "invalid_request",
              "Mathematical processing input could not be snapshotted for bounded execution.",
            ),
      );
    }
    if (this.admittedIdentities.has(identityKey)) {
      return Promise.reject(
        new FixedRigMathematicalStationWorkerErrorV1(
          "duplicate",
          "The exact queue, session, and report job is already admitted.",
        ),
      );
    }
    if (this.active + this.pending.length >= this.maxAdmitted) {
      return Promise.reject(
        new FixedRigMathematicalStationWorkerErrorV1(
          "queue_full",
          "Mathematical worker pool has reached its 25-card admission bound.",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      this.admittedIdentities.add(identityKey);
      this.pending.push({ identityKey, input: snapshot, resolve, reject });
      this.pump();
    });
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopped = true;
    const error = new FixedRigMathematicalStationWorkerErrorV1(
      "shutdown",
      "Mathematical worker pool shut down before this queued job started.",
    );
    for (const job of this.pending.splice(0)) {
      this.admittedIdentities.delete(job.identityKey);
      job.reject(error);
    }
    for (const controller of this.activeControllers.values()) {
      controller.abort();
    }
    this.shutdownPromise = Promise.allSettled(
      [...this.activeJobs.values()],
    ).then(() => undefined);
    return this.shutdownPromise;
  }

  private pump(): void {
    while (
      !this.stopped &&
      this.active < this.maxConcurrency &&
      this.pending.length > 0
    ) {
      const job = this.pending.shift()!;
      const controller = new AbortController();
      this.active += 1;
      this.activeControllers.set(job.identityKey, controller);
      const finishActiveJob = () => {
        this.active -= 1;
        this.activeControllers.delete(job.identityKey);
        this.activeJobs.delete(job.identityKey);
        this.admittedIdentities.delete(job.identityKey);
        this.pump();
      };
      const activeJob = buildFixedRigMathematicalCalibrationStationPackageInWorkerV1(
        job.input,
        { ...this.workerOptions, signal: controller.signal },
      ).then((result) => {
        finishActiveJob();
        job.resolve(result);
      }, (error) => {
        finishActiveJob();
        job.reject(error);
      });
      this.activeJobs.set(job.identityKey, activeJob);
    }
  }
}

async function runMathematicalStationWorkerV1(): Promise<void> {
  if (!parentPort) {
    throw new Error("Mathematical processing worker requires a parent message port.");
  }
  const port: NonNullable<typeof parentPort> = parentPort;
  const data = workerData as Partial<MathematicalStationWorkerDataV1> | undefined;
  let identity: MathematicalStationWorkerIdentityV1 | undefined;
  try {
    if (
      !data ||
      data.mode !== MATHEMATICAL_STATION_WORKER_MODE ||
      !(data.payload instanceof Uint8Array)
    ) {
      throw new Error("Mathematical processing worker data was invalid.");
    }
    const input = deserialize(
      Buffer.from(data.payload),
    ) as BuildFixedRigMathematicalCalibrationStationPackageV1Input;
    identity = exactIdentity(input);
    if (!path.isAbsolute(input.outputDir)) {
      throw new Error(
        "Mathematical processing worker requires one absolute report output directory.",
      );
    }
    const result =
      await buildFixedRigMathematicalCalibrationStationPackageV1(input);
    const responsePayload = serialize(result);
    const response: MathematicalStationWorkerSuccessV1 = {
      protocolVersion: MATHEMATICAL_STATION_WORKER_PROTOCOL_VERSION,
      operation: MATHEMATICAL_STATION_WORKER_OPERATION,
      ok: true,
      identity,
      payload: responsePayload,
    };
    port.postMessage(response, [responsePayload.buffer as ArrayBuffer]);
  } catch (error) {
    const response: MathematicalStationWorkerFailureV1 = {
      protocolVersion: MATHEMATICAL_STATION_WORKER_PROTOCOL_VERSION,
      operation: MATHEMATICAL_STATION_WORKER_OPERATION,
      ok: false,
      ...(identity ? { identity } : {}),
      error: {
        code: "processing_failed",
        message: safeWorkerFailure(error),
      },
    };
    port.postMessage(response);
  } finally {
    port.close();
  }
}

if (
  !isMainThread &&
  (workerData as Partial<MathematicalStationWorkerDataV1> | undefined)?.mode ===
    MATHEMATICAL_STATION_WORKER_MODE
) {
  void runMathematicalStationWorkerV1();
}
