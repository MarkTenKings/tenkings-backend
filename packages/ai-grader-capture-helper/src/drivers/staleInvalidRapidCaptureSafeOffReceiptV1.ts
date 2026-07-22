import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722,
  buildExternalSafeOffReceiptBytesV1,
  verifyExternalSafeOffReceiptOperationV1,
} from "./staleInvalidRapidCaptureQueueArchivalV1";

const CAPTURE_SCHEMA = "ten-kings-ai-grader-stale-review-safe-off-child-execution-v1" as const;
const SHA256 = /^[a-f0-9]{64}$/;
const FIXED_HOST = "169.254.191.156";
const FIXED_PORT = 1000;
const FIXED_TIMEOUT_MS = 1500;
const FIXED_UNIT = 1;
const MAX_CHILD_DURATION_MS = 15_000;

export const STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1 =
  "CAPTURE TEN KINGS STALE REVIEW SAFE OFF RECEIPT" as const;

export const STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1 = {
  stdout: "safe-off-child.stdout.json",
  stderr: "safe-off-child.stderr.txt",
  execution: "safe-off-child-execution.json",
  receipt: "external-safe-off-receipt.json",
  receiptSha256: "external-safe-off-receipt.sha256",
} as const;

type JsonRecord = Record<string, any>;

export interface StaleReviewSafeOffChildInvocationV1 {
  executablePath: string;
  argv: string[];
  cwd: string;
}

export interface StaleReviewSafeOffChildResultV1 {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
  signal: string | null;
  spawnError: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface StaleReviewSafeOffChildBoundaryV1 {
  run(invocation: StaleReviewSafeOffChildInvocationV1): Promise<StaleReviewSafeOffChildResultV1>;
}

export interface StaleReviewSafeOffReceiptCaptureOptionsV1 {
  outputDir: string;
  captureHelperCliPath: string;
  controllerHost: string;
  controllerPort: number;
  confirmation: string;
  executablePath?: string;
  childBoundary?: StaleReviewSafeOffChildBoundaryV1;
  failpoint?: "after_raw_evidence" | "before_receipt_canonicalization" | "before_receipt_write" | "after_receipt_write";
}

export interface StaleReviewSafeOffReceiptRegenerationOptionsV1 {
  outputDir: string;
  failpoint?: "before_receipt_canonicalization" | "before_receipt_write" | "after_receipt_write";
}

export interface StaleReviewSafeOffReceiptResultV1 {
  incidentId: string;
  mode: "capture" | "regenerate";
  childSpawnCount: 0 | 1;
  outputDir: string;
  rawStdoutPath: string;
  rawStdoutSha256: string;
  rawStderrPath: string;
  rawStderrSha256: string;
  executionEvidencePath: string;
  executionEvidenceSha256: string;
  receiptPath: string;
  receiptSha256: string;
  receiptSha256Path: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  acknowledgements: ["W86ACK0", "W85ACK0", "W11ACK0"];
  zeroedChannels: [1, 2, 3, 4, 5, 6, 7, 8];
  lightsCommanded: false;
  persistentSaved: false;
}

interface RelativeFileIdentityV1 {
  fileName: string;
  sha256: string;
  byteSize: number;
}

interface ChildExecutionEvidenceV1 {
  schemaVersion: typeof CAPTURE_SCHEMA;
  incidentId: string;
  authorization: {
    owner: "Mark / Ten Kings";
    source: string;
  };
  controller: {
    identity: string;
    host: typeof FIXED_HOST;
    port: typeof FIXED_PORT;
    timeoutMs: typeof FIXED_TIMEOUT_MS;
    unit: typeof FIXED_UNIT;
  };
  child: {
    executablePath: string;
    captureHelperCli: {
      path: string;
      sha256: string;
      byteSize: number;
    };
    argv: string[];
  };
  timing: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
  termination: {
    exitCode: number | null;
    signal: string | null;
    spawnError: string | null;
  };
  stdout: RelativeFileIdentityV1;
  stderr: RelativeFileIdentityV1;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is JsonRecord {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sameJson(left: unknown, right: unknown): boolean {
  return sha256(canonicalBytes(left)) === sha256(canonicalBytes(right));
}

function exactTimestampMs(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be exact canonical UTC milliseconds.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be one real canonical timestamp.`);
  }
  return parsed;
}

function safeAbsolute(value: string, label: string): string {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) throw new Error(`${label} must be one safe absolute path.`);
  return resolved;
}

function ensureDirectory(value: string): string {
  const resolved = safeAbsolute(value, "Receipt capture output directory");
  mkdirSync(resolved, { recursive: true });
  const link = lstatSync(resolved);
  if (!link.isDirectory() || link.isSymbolicLink()) throw new Error("Receipt capture output must be one real directory without a reparse/symbolic link.");
  return resolved;
}

function regularFile(value: string, label: string): { path: string; sha256: string; byteSize: number } {
  const resolved = safeAbsolute(value, label);
  const link = lstatSync(resolved);
  if (!link.isFile() || link.isSymbolicLink()) throw new Error(`${label} must be one regular file without a reparse/symbolic link.`);
  const bytes = readFileSync(resolved);
  return { path: resolved, sha256: sha256(bytes), byteSize: bytes.length };
}

function relativeIdentity(fileName: string, bytes: Buffer): RelativeFileIdentityV1 {
  return { fileName, sha256: sha256(bytes), byteSize: bytes.length };
}

function writeExclusiveSynced(filePath: string, bytes: Buffer): void {
  const handle = openSync(filePath, "wx");
  try {
    writeFileSync(handle, bytes);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function atomicCreateNew(filePath: string, bytes: Buffer): void {
  const stagePath = `${filePath}.stage-${process.pid}-${crypto.randomUUID()}`;
  try {
    writeExclusiveSynced(stagePath, bytes);
    linkSync(stagePath, filePath);
  } finally {
    rmSync(stagePath, { force: true });
  }
}

function exactPaths(outputDir: string) {
  const names = STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1;
  return {
    stdout: path.join(outputDir, names.stdout),
    stderr: path.join(outputDir, names.stderr),
    execution: path.join(outputDir, names.execution),
    receipt: path.join(outputDir, names.receipt),
    receiptSha256: path.join(outputDir, names.receiptSha256),
  };
}

function safeOffArgv(captureHelperCliPath: string): string[] {
  return [
    captureHelperCliPath,
    "leimac-idmu-safe-off",
    "--host", FIXED_HOST,
    "--port", String(FIXED_PORT),
    "--timeout-ms", String(FIXED_TIMEOUT_MS),
    "--unit", String(FIXED_UNIT),
    "--apply",
    "--confirm", "APPLY LEIMAC SAFE OFF",
  ];
}

function defaultChildBoundary(): StaleReviewSafeOffChildBoundaryV1 {
  return {
    run(invocation) {
      return new Promise((resolve) => {
        const startedAtMs = Date.now();
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let spawnError: string | null = null;
        const child = spawn(invocation.executablePath, invocation.argv, {
          cwd: invocation.cwd,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.on("data", (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
        child.once("error", (error) => { spawnError = error.message; });
        child.once("close", (exitCode, signal) => {
          const finishedAtMs = Date.now();
          resolve({
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
            exitCode,
            signal,
            spawnError,
            startedAt: new Date(startedAtMs).toISOString(),
            finishedAt: new Date(finishedAtMs).toISOString(),
            durationMs: finishedAtMs - startedAtMs,
          });
        });
      });
    },
  };
}

function parseCanonicalExecution(bytes: Buffer): ChildExecutionEvidenceV1 {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Preserved safe-off child execution evidence is not valid JSON.");
  }
  if (!bytes.equals(canonicalBytes(value)) || !exactKeys(value, [
    "schemaVersion", "incidentId", "authorization", "controller", "child", "timing", "termination", "stdout", "stderr",
  ])) throw new Error("Preserved safe-off child execution evidence is not exact canonical JSON.");
  return value as ChildExecutionEvidenceV1;
}

function validateRawEvidence(outputDir: string): {
  execution: ChildExecutionEvidenceV1;
  executionBytes: Buffer;
  stdoutBytes: Buffer;
  stderrBytes: Buffer;
} {
  const paths = exactPaths(outputDir);
  const executionBytes = readFileSync(paths.execution);
  const execution = parseCanonicalExecution(executionBytes);
  const incident = STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722;
  if (
    execution.schemaVersion !== CAPTURE_SCHEMA || execution.incidentId !== incident.incidentId ||
    !exactKeys(execution.authorization, ["owner", "source"]) || execution.authorization.owner !== incident.owner ||
    execution.authorization.source !== incident.authorizationSource || !exactKeys(execution.controller, ["identity", "host", "port", "timeoutMs", "unit"]) ||
    execution.controller.identity !== incident.safeOffController.identity || execution.controller.host !== FIXED_HOST ||
    execution.controller.port !== FIXED_PORT || execution.controller.timeoutMs !== FIXED_TIMEOUT_MS || execution.controller.unit !== FIXED_UNIT ||
    !exactKeys(execution.child, ["executablePath", "captureHelperCli", "argv"]) ||
    !exactKeys(execution.child.captureHelperCli, ["path", "sha256", "byteSize"]) ||
    !SHA256.test(execution.child.captureHelperCli.sha256) || !Number.isSafeInteger(execution.child.captureHelperCli.byteSize) ||
    execution.child.captureHelperCli.byteSize < 1 || !Array.isArray(execution.child.argv) ||
    JSON.stringify(execution.child.argv) !== JSON.stringify(safeOffArgv(execution.child.captureHelperCli.path)) ||
    !exactKeys(execution.timing, ["startedAt", "finishedAt", "durationMs"]) ||
    !exactKeys(execution.termination, ["exitCode", "signal", "spawnError"]) ||
    !exactKeys(execution.stdout, ["fileName", "sha256", "byteSize"]) ||
    !exactKeys(execution.stderr, ["fileName", "sha256", "byteSize"])
  ) throw new Error("Preserved safe-off child execution evidence is not bound to the fixed incident command.");
  const startedMs = exactTimestampMs(execution.timing.startedAt, "Child start");
  const finishedMs = exactTimestampMs(execution.timing.finishedAt, "Child finish");
  if (
    finishedMs < startedMs || finishedMs - startedMs !== execution.timing.durationMs ||
    !Number.isSafeInteger(execution.timing.durationMs) || execution.timing.durationMs > MAX_CHILD_DURATION_MS
  ) throw new Error("Preserved safe-off child execution timing is invalid or unbounded.");
  if (
    execution.stdout.fileName !== STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stdout ||
    execution.stderr.fileName !== STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stderr ||
    !SHA256.test(execution.stdout.sha256) || !Number.isSafeInteger(execution.stdout.byteSize) || execution.stdout.byteSize < 1 ||
    !SHA256.test(execution.stderr.sha256) || !Number.isSafeInteger(execution.stderr.byteSize) || execution.stderr.byteSize < 0
  ) throw new Error("Preserved safe-off child stream identities are invalid.");
  const stdoutBytes = readFileSync(paths.stdout);
  const stderrBytes = readFileSync(paths.stderr);
  if (
    !sameJson(relativeIdentity(STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stdout, stdoutBytes), execution.stdout) ||
    !sameJson(relativeIdentity(STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stderr, stderrBytes), execution.stderr)
  ) throw new Error("Preserved safe-off child raw stdout/stderr no longer match their exact identities.");
  if (
    execution.termination.exitCode !== 0 || execution.termination.signal !== null || execution.termination.spawnError !== null ||
    stderrBytes.length !== 0
  ) throw new Error("Preserved safe-off child operation did not complete cleanly with empty stderr and exit code zero.");
  return { execution, executionBytes, stdoutBytes, stderrBytes };
}

function receiptFromRawEvidence(
  outputDir: string,
  failpoint?: StaleReviewSafeOffReceiptRegenerationOptionsV1["failpoint"],
): Omit<StaleReviewSafeOffReceiptResultV1, "mode" | "childSpawnCount"> {
  const paths = exactPaths(outputDir);
  const raw = validateRawEvidence(outputDir);
  if (failpoint === "before_receipt_canonicalization") throw new Error("Injected failure before receipt canonicalization.");
  const text = raw.stdoutBytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw.stdoutBytes)) throw new Error("Preserved safe-off child stdout is not exact UTF-8.");
  let operation: unknown;
  try {
    operation = JSON.parse(text);
  } catch {
    throw new Error("Preserved safe-off child stdout is not one JSON operation.");
  }
  const receiptBytes = buildExternalSafeOffReceiptBytesV1(operation);
  const verified = verifyExternalSafeOffReceiptOperationV1(receiptBytes);
  const childStartedMs = exactTimestampMs(raw.execution.timing.startedAt, "Child start");
  const childFinishedMs = exactTimestampMs(raw.execution.timing.finishedAt, "Child finish");
  const operationStartedMs = exactTimestampMs(verified.startedAt, "Safe-off operation start");
  const operationFinishedMs = exactTimestampMs(verified.finishedAt, "Safe-off operation finish");
  if (operationStartedMs < childStartedMs || operationFinishedMs > childFinishedMs) {
    throw new Error("Safe-off operation timing is not contained by the preserved child execution.");
  }
  if (failpoint === "before_receipt_write") throw new Error("Injected failure before receipt write.");
  if (existsSync(paths.receipt)) {
    if (!readFileSync(paths.receipt).equals(receiptBytes)) throw new Error("Existing external safe-off receipt differs; create-new recovery refuses replacement.");
  } else {
    atomicCreateNew(paths.receipt, receiptBytes);
  }
  if (failpoint === "after_receipt_write") throw new Error("Injected failure after receipt write.");
  const receiptSha256 = sha256(receiptBytes);
  const receiptShaBytes = Buffer.from(`${receiptSha256}\n`, "utf8");
  if (existsSync(paths.receiptSha256)) {
    if (!readFileSync(paths.receiptSha256).equals(receiptShaBytes)) throw new Error("Existing external safe-off receipt SHA differs; create-new recovery refuses replacement.");
  } else {
    atomicCreateNew(paths.receiptSha256, receiptShaBytes);
  }
  return {
    incidentId: STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.incidentId,
    outputDir,
    rawStdoutPath: paths.stdout,
    rawStdoutSha256: raw.execution.stdout.sha256,
    rawStderrPath: paths.stderr,
    rawStderrSha256: raw.execution.stderr.sha256,
    executionEvidencePath: paths.execution,
    executionEvidenceSha256: sha256(raw.executionBytes),
    receiptPath: paths.receipt,
    receiptSha256,
    receiptSha256Path: paths.receiptSha256,
    startedAt: verified.startedAt,
    finishedAt: verified.finishedAt,
    durationMs: verified.durationMs,
    acknowledgements: verified.ackResponses,
    zeroedChannels: verified.zeroedChannels,
    lightsCommanded: false,
    persistentSaved: false,
  };
}

export async function captureStaleReviewSafeOffReceiptV1(
  options: StaleReviewSafeOffReceiptCaptureOptionsV1,
): Promise<StaleReviewSafeOffReceiptResultV1> {
  if (
    options.controllerHost !== FIXED_HOST || options.controllerPort !== FIXED_PORT ||
    options.confirmation !== STALE_REVIEW_SAFE_OFF_CAPTURE_CONFIRMATION_V1
  ) throw new Error("Capture is authorized only for the fixed incident endpoint and exact receipt-capture confirmation.");
  const outputDir = ensureDirectory(options.outputDir);
  const paths = exactPaths(outputDir);
  if (Object.values(paths).some((filePath) => existsSync(filePath))) {
    throw new Error("Receipt capture create-new preflight refuses any existing raw, execution, receipt, or SHA output.");
  }
  const captureHelperCli = regularFile(options.captureHelperCliPath, "Capture-helper CLI");
  const executablePath = safeAbsolute(options.executablePath ?? process.execPath, "Node executable");
  const invocation: StaleReviewSafeOffChildInvocationV1 = {
    executablePath,
    argv: safeOffArgv(captureHelperCli.path),
    cwd: path.dirname(captureHelperCli.path),
  };
  const childResult = await (options.childBoundary ?? defaultChildBoundary()).run(invocation);
  writeExclusiveSynced(paths.stdout, childResult.stdout);
  writeExclusiveSynced(paths.stderr, childResult.stderr);
  const execution: ChildExecutionEvidenceV1 = {
    schemaVersion: CAPTURE_SCHEMA,
    incidentId: STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.incidentId,
    authorization: {
      owner: STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.owner,
      source: STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.authorizationSource,
    },
    controller: {
      identity: STALE_INVALID_RAPID_CAPTURE_QUEUE_INCIDENT_20260722.safeOffController.identity,
      host: FIXED_HOST,
      port: FIXED_PORT,
      timeoutMs: FIXED_TIMEOUT_MS,
      unit: FIXED_UNIT,
    },
    child: {
      executablePath,
      captureHelperCli,
      argv: invocation.argv,
    },
    timing: {
      startedAt: childResult.startedAt,
      finishedAt: childResult.finishedAt,
      durationMs: childResult.durationMs,
    },
    termination: {
      exitCode: childResult.exitCode,
      signal: childResult.signal,
      spawnError: childResult.spawnError,
    },
    stdout: relativeIdentity(STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stdout, childResult.stdout),
    stderr: relativeIdentity(STALE_REVIEW_SAFE_OFF_CAPTURE_FILES_V1.stderr, childResult.stderr),
  };
  writeExclusiveSynced(paths.execution, canonicalBytes(execution));
  if (options.failpoint === "after_raw_evidence") throw new Error("Injected failure after raw evidence persistence.");
  const result = receiptFromRawEvidence(outputDir, options.failpoint);
  return { ...result, mode: "capture", childSpawnCount: 1 };
}

export function regenerateStaleReviewSafeOffReceiptV1(
  options: StaleReviewSafeOffReceiptRegenerationOptionsV1,
): StaleReviewSafeOffReceiptResultV1 {
  const outputDir = safeAbsolute(options.outputDir, "Receipt regeneration output directory");
  const link = lstatSync(outputDir);
  if (!link.isDirectory() || link.isSymbolicLink()) throw new Error("Receipt regeneration output must be one real directory without a reparse/symbolic link.");
  const result = receiptFromRawEvidence(outputDir, options.failpoint);
  return { ...result, mode: "regenerate", childSpawnCount: 0 };
}
