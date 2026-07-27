import crypto from "node:crypto";
import path from "node:path";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import {
  detectCardGeometryFromBuffer,
  type CardGeometryMetadata,
  type DetectCardGeometryBufferInput,
} from "./cardGeometry";

export const PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION =
  "ten-kings-preview-geometry-worker-v1" as const;

const PREVIEW_GEOMETRY_WORKER_MODE = "preview_geometry_analysis";
const PREVIEW_GEOMETRY_WORKER_TIMEOUT_MS = 5_000;

interface PreviewGeometryWorkerRequest {
  protocolVersion: typeof PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION;
  mode: typeof PREVIEW_GEOMETRY_WORKER_MODE;
  requestId: string;
  input: Omit<
    DetectCardGeometryBufferInput,
    "imageBuffer" | "onDetectionAttempt"
  > & {
    imageBytes: Uint8Array;
  };
}

type PreviewGeometryWorkerResponse =
  | {
      protocolVersion: typeof PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION;
      requestId: string;
      ok: true;
      geometry: CardGeometryMetadata;
    }
  | {
      protocolVersion: typeof PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION;
      requestId: string;
      ok: false;
      error: "analysis_failed";
    };

export interface PreviewGeometryWorkerOptions {
  /** Test-only compiled worker entry injection. */
  workerPath?: string;
  timeoutMs?: number;
}

function safeWorkerTimeout(value: number | undefined): number {
  const timeoutMs = value ?? PREVIEW_GEOMETRY_WORKER_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000
  ) {
    throw new Error(
      "Preview geometry worker timeout must be from 100 to 30000 ms.",
    );
  }
  return timeoutMs;
}

function isBoundGeometryResponse(
  value: unknown,
  requestId: string,
  input: DetectCardGeometryBufferInput,
): value is Extract<PreviewGeometryWorkerResponse, { ok: true }> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) return false;
  const response = value as Partial<PreviewGeometryWorkerResponse>;
  if (
    response.protocolVersion !== PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION ||
    response.requestId !== requestId ||
    response.ok !== true ||
    !("geometry" in response) ||
    !response.geometry ||
    typeof response.geometry !== "object"
  ) return false;
  const geometry = response.geometry as CardGeometryMetadata;
  const geometryTimestampMs = Date.parse(geometry.timestamp);
  const inputTimestampMs =
    typeof input.timestamp === "string"
      ? Date.parse(input.timestamp)
      : Number.NaN;
  return (
    geometry.side === input.side &&
    geometry.detectionPolicy === input.detectionPolicy &&
    geometry.sourceFrameId === input.sourceFrameId &&
    Number.isFinite(geometryTimestampMs) &&
    Number.isFinite(inputTimestampMs) &&
    geometryTimestampMs === inputTimestampMs
  );
}

/**
 * Runs the unchanged authoritative detector outside the bridge event loop.
 * The worker owns no camera, files, lights, queue, or capture authority.
 */
export function runPreviewGeometryWorkerAnalysis(
  input: DetectCardGeometryBufferInput,
  options: PreviewGeometryWorkerOptions = {},
): Promise<CardGeometryMetadata> {
  if (input.onDetectionAttempt) {
    return Promise.reject(
      new Error(
        "Preview geometry worker does not transport diagnostic callbacks.",
      ),
    );
  }
  if (!Buffer.isBuffer(input.imageBuffer) || input.imageBuffer.length < 1) {
    return Promise.reject(
      new Error("Preview geometry worker requires an encoded frame."),
    );
  }
  const requestId = crypto.randomUUID();
  const imageBytes = Uint8Array.from(input.imageBuffer);
  const { imageBuffer: _imageBuffer, onDetectionAttempt: _callback, ...rest } =
    input;
  const request: PreviewGeometryWorkerRequest = {
    protocolVersion: PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION,
    mode: PREVIEW_GEOMETRY_WORKER_MODE,
    requestId,
    input: {
      ...rest,
      imageBytes,
    },
  };
  const workerPath =
    options.workerPath ??
    path.resolve(__dirname, "previewGeometryWorker.js");
  const timeoutMs = safeWorkerTimeout(options.timeoutMs);
  return new Promise<CardGeometryMetadata>((resolve, reject) => {
    let worker: Worker;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (
      error?: Error,
      geometry?: CardGeometryMetadata,
    ) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else if (geometry) resolve(geometry);
      else reject(new Error("Preview geometry worker returned no result."));
    };
    try {
      worker = new Worker(workerPath, {
        workerData: request,
        transferList: [imageBytes.buffer],
      });
    } catch {
      reject(new Error("Preview geometry worker could not start."));
      return;
    }
    timer = setTimeout(
      () => finish(new Error("Preview geometry worker timed out.")),
      timeoutMs,
    );
    timer.unref?.();
    worker.once("message", (message: unknown) => {
      if (isBoundGeometryResponse(message, requestId, input)) {
        finish(undefined, message.geometry);
        return;
      }
      finish(new Error("Preview geometry worker response was invalid."));
    });
    worker.once("error", () => {
      finish(new Error("Preview geometry worker failed."));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        finish(
          new Error(
            code === 0
              ? "Preview geometry worker exited without a result."
              : "Preview geometry worker exited unexpectedly.",
          ),
        );
      }
    });
  });
}

async function runWorker(): Promise<void> {
  const request = workerData as PreviewGeometryWorkerRequest;
  if (
    !parentPort ||
    !request ||
    request.protocolVersion !== PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION ||
    request.mode !== PREVIEW_GEOMETRY_WORKER_MODE ||
    typeof request.requestId !== "string" ||
    !(request.input?.imageBytes instanceof Uint8Array)
  ) {
    throw new Error("Preview geometry worker request is invalid.");
  }
  try {
    const geometry = await detectCardGeometryFromBuffer({
      ...request.input,
      imageBuffer: Buffer.from(request.input.imageBytes),
    });
    const response: PreviewGeometryWorkerResponse = {
      protocolVersion: PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      geometry,
    };
    parentPort.postMessage(response);
  } catch {
    const response: PreviewGeometryWorkerResponse = {
      protocolVersion: PREVIEW_GEOMETRY_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: false,
      error: "analysis_failed",
    };
    parentPort.postMessage(response);
  }
}

if (
  !isMainThread &&
  (workerData as Partial<PreviewGeometryWorkerRequest> | undefined)?.mode ===
    PREVIEW_GEOMETRY_WORKER_MODE
) {
  void runWorker();
}
