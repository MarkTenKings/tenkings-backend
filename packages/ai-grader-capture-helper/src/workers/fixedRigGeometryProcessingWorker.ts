import { parentPort, workerData } from "node:worker_threads";
import {
  executeFixedRigProcessingWorkerRequest,
  fixedRigProcessingWorkerSafeError,
  FIXED_RIG_PROCESSING_WORKER_OPERATION,
  FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
  revalidateFixedRigProcessingWorkerSources,
  validateFixedRigProcessingWorkerRequest,
  FixedRigProcessingWorkerProtocolError,
  type FixedRigProcessingWorkerFailureResponse,
  type FixedRigProcessingWorkerRequest,
} from "../drivers/fixedRigProcessingWorkerProtocol";

interface WorkerThreadData {
  allowedOutputRoot?: unknown;
}

interface RevalidateCommand {
  protocolVersion: typeof FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION;
  operation: "revalidate_captured_source_identity";
  identity: FixedRigProcessingWorkerRequest["identity"];
}

if (!parentPort) throw new Error("Geometry processing worker requires a parent message port.");
const port: NonNullable<typeof parentPort> = parentPort;
const allowedOutputRoot = (workerData as WorkerThreadData | undefined)?.allowedOutputRoot;
if (typeof allowedOutputRoot !== "string" || !allowedOutputRoot) {
  throw new Error("Geometry processing worker requires its trusted output root in workerData.");
}

let request: FixedRigProcessingWorkerRequest | undefined;
let authoritySent = false;

function sameIdentity(
  left: FixedRigProcessingWorkerRequest["identity"],
  right: FixedRigProcessingWorkerRequest["identity"],
): boolean {
  return (
    left.protocolVersion === right.protocolVersion && left.requestId === right.requestId &&
    left.sessionId === right.sessionId && left.packageId === right.packageId &&
    left.side === right.side && left.sourceSetSha256 === right.sourceSetSha256
  );
}

function fail(error: unknown): void {
  const response: FixedRigProcessingWorkerFailureResponse = {
    protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
    operation: FIXED_RIG_PROCESSING_WORKER_OPERATION,
    ok: false,
    ...(request ? { identity: { ...request.identity } } : {}),
    error: {
      code: error instanceof FixedRigProcessingWorkerProtocolError
        ? error.code
        : request ? "processing_failed" : "invalid_request",
      message: fixedRigProcessingWorkerSafeError(error),
    },
  };
  port.postMessage(response);
  port.close();
}

port.on("message", async (value: unknown) => {
  try {
    if (!request) {
      validateFixedRigProcessingWorkerRequest(value);
      request = value as FixedRigProcessingWorkerRequest;
      const response = await executeFixedRigProcessingWorkerRequest(request, allowedOutputRoot);
      authoritySent = true;
      port.postMessage(response);
      return;
    }
    const command = value as Partial<RevalidateCommand>;
    if (
      !value || typeof value !== "object" ||
      Object.keys(value).sort().join(",") !== ["identity", "operation", "protocolVersion"].sort().join(",") ||
      !authoritySent || command.protocolVersion !== FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION ||
      command.operation !== "revalidate_captured_source_identity" || !command.identity ||
      !sameIdentity(command.identity, request.identity)
    ) {
      throw new Error("Geometry processing worker revalidation command identity is invalid.");
    }
    await revalidateFixedRigProcessingWorkerSources(request, allowedOutputRoot);
    port.postMessage({
      protocolVersion: FIXED_RIG_PROCESSING_WORKER_PROTOCOL_VERSION,
      operation: "revalidate_captured_source_identity",
      ok: true,
      identity: { ...request.identity },
    });
    port.close();
  } catch (error) {
    fail(error);
  }
});
