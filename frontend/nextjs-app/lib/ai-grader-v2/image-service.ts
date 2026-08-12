import { buildAdminHeaders } from "../adminHeaders";
import { toCardMapOperatorMessage } from "./card-map-copy";
import type {
  SpeedsterCardSide,
  SpeedsterQuad,
} from "./contracts";
import type { SpeedsterInspectionFrame } from "./inspection-frame";
import type { SpeedsterTraceBitmapWireV1 } from "./trace-bitmap-wire";
import type { SpeedsterCanonicalPixel } from "./trace-editor";
import type { SpeedsterMapRegistration } from "./card-type-map-contracts";

type ImageAction = "geometry" | "prepare" | "trace-proposal" | "map-registration";
export type SpeedsterGeometryResponse = {
  width: number;
  height: number;
  corners: SpeedsterQuad | null;
};

export type SpeedsterPrepareResponse = {
  width: number;
  height: number;
  transform: readonly number[];
  borders: SpeedsterQuad;
  detectedBorders: readonly ("top" | "right" | "bottom" | "left")[];
  inspectionFrame: SpeedsterInspectionFrame;
};

type PreparedArtifact = "RECTIFIED" | "INSPECTION" | "NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL";
type ArtifactPlan = { storageKey: string; uploadUrl: string; readUrl: string };
export type SpeedsterPreparedOutputPlan = Readonly<Record<PreparedArtifact, ArtifactPlan>>;

export const SPEEDSTER_IMAGE_REQUEST_TIMEOUT_MS = 65_000;

export type SpeedsterImageRequestOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export async function runSpeedsterImageRequest<T>(
  action: string,
  options: SpeedsterImageRequestOptions = {},
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? SPEEDSTER_IMAGE_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const abortFromCaller = () => {
    controller.abort(options.signal?.reason);
    rejectDeadline?.(new Error(`Speedster ${action} was interrupted. Your photos and current geometry are preserved; retry this step.`));
  };
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectDeadline?.(new Error(`Speedster ${action} request deadline expired.`));
  }, timeoutMs);
  try {
    if (options.signal?.aborted) abortFromCaller();
    return await Promise.race([request(controller.signal), deadline]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Speedster ${action} timed out. Your photos and current geometry are preserved; retry this step.`);
    }
    if (controller.signal.aborted) {
      throw new Error(`Speedster ${action} was interrupted. Your photos and current geometry are preserved; retry this step.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fetchSpeedsterImageResponse(
  input: RequestInfo | URL,
  init: RequestInit,
  action: string,
  options: SpeedsterImageRequestOptions = {},
) {
  return runSpeedsterImageRequest(action, options, (signal) => fetch(input, { ...init, signal }));
}

async function fetchSpeedsterImageJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  action: string,
  options: SpeedsterImageRequestOptions = {},
): Promise<{ response: Response; payload: T }> {
  return runSpeedsterImageRequest(action, options, async (signal) => {
    const response = await fetch(input, { ...init, signal });
    let payload: T;
    try {
      payload = await response.json() as T;
    } catch (error) {
      if (signal.aborted) throw error;
      payload = {} as T;
    }
    return { response, payload };
  });
}

async function fetchSpeedsterImageJsonWithoutDeadline<T>(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ response: Response; payload: T }> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T;
  return { response, payload };
}

async function postImageAction<T>(
  token: string,
  action: ImageAction,
  body: Record<string, unknown>,
  options?: SpeedsterImageRequestOptions,
): Promise<T> {
  const input = `/api/admin/ai-grader-v2/image/${action}`;
  const init = {
    method: "POST",
    headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  };
  const { response, payload } = options
    ? await fetchSpeedsterImageJson<T & { message?: string; detail?: string; requestId?: string }>(input, init, action, options)
    : await fetchSpeedsterImageJsonWithoutDeadline<T & { message?: string; detail?: string; requestId?: string }>(input, init);
  if (!response.ok) {
    const operatorMessage = toCardMapOperatorMessage(payload.message ?? payload.detail ?? `Speedster ${action} failed.`);
    const requestId = typeof payload.requestId === "string" && /^[A-Za-z0-9-]{8,80}$/.test(payload.requestId)
      ? payload.requestId
      : null;
    throw new Error(requestId && !operatorMessage.includes(requestId)
      ? `${operatorMessage} (request ${requestId})`
      : operatorMessage);
  }
  return payload;
}

export const speedsterImageService = {
  proposeGeometry(token: string, imageUrl: string, options: SpeedsterImageRequestOptions = {}) {
    return postImageAction<SpeedsterGeometryResponse>(token, "geometry", { imageUrl }, options);
  },
  prepare(
    token: string,
    imageUrl: string,
    corners: SpeedsterQuad,
    outputPlan: SpeedsterPreparedOutputPlan,
    options?: SpeedsterImageRequestOptions,
  ) {
    return postImageAction<SpeedsterPrepareResponse>(token, "prepare", {
      imageUrl,
      corners,
      outputUploads: {
        rectified: outputPlan.RECTIFIED.uploadUrl,
        inspection: outputPlan.INSPECTION.uploadUrl,
        normalized: outputPlan.NORMALIZED.uploadUrl,
        microDefect: outputPlan.MICRO_DEFECT.uploadUrl,
        directional: outputPlan.DIRECTIONAL.uploadUrl,
      },
    }, options);
  },
  traceProposal(
    token: string,
    input: {
      sessionId: string;
      side: SpeedsterCardSide;
      findingId: string | null;
      stroke: {
        canonicalPoints: readonly SpeedsterCanonicalPixel[];
        strokeWidthPixels: number;
        strokeWidthMm: number;
        cropTransformVersion: "speedster-canonical-crop-affine-v1";
      };
      currentTraceWire: SpeedsterTraceBitmapWireV1 | null;
    },
    options?: SpeedsterImageRequestOptions,
  ) {
    return postImageAction<{ traceWire: SpeedsterTraceBitmapWireV1 }>(token, "trace-proposal", input, options);
  },
  registerMap(
    token: string,
    input: {
      sessionId: string;
      side: SpeedsterCardSide;
      currentPhysicalQuad: SpeedsterQuad;
    },
    options: SpeedsterImageRequestOptions = {},
  ) {
    return postImageAction<SpeedsterMapRegistration>(
      token,
      "map-registration",
      input,
      options,
    );
  },
};

export async function uploadSpeedsterOriginal(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  file: File;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ storageKey: string; readUrl: string }> {
  const { response: planResponse, payload: plan } = await fetchSpeedsterImageJson<{
    storageKey?: string;
    uploadUrl?: string;
    readUrl?: string;
    message?: string;
  }>("/api/admin/ai-grader-v2/upload-plan", {
    method: "POST",
    headers: buildAdminHeaders(input.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId: input.sessionId,
      side: input.side,
      kind: "ORIGINAL",
      contentType: input.file.type,
    }),
  }, `${input.side.toLowerCase()} upload planning`, input);
  if (!planResponse.ok || !plan.storageKey || !plan.uploadUrl || !plan.readUrl) {
    throw new Error(toCardMapOperatorMessage(plan.message ?? "Speedster upload could not be prepared."));
  }

  const uploadResponse = await fetchSpeedsterImageResponse(plan.uploadUrl, {
    method: "PUT",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": input.file.type },
    body: input.file,
  }, `${input.side.toLowerCase()} original upload`, input);
  if (!uploadResponse.ok) throw new Error(`Speedster upload failed (HTTP ${uploadResponse.status}).`);
  return { storageKey: plan.storageKey, readUrl: plan.readUrl };
}

export async function planSpeedsterPreparedOutputs(input: {
  token: string;
  sessionId: string;
  side: SpeedsterCardSide;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SpeedsterPreparedOutputPlan> {
  const { response, payload } = await fetchSpeedsterImageJson<{
    outputs?: SpeedsterPreparedOutputPlan;
    message?: string;
  }>("/api/admin/ai-grader-v2/upload-plan", {
    method: "POST",
    headers: buildAdminHeaders(input.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ sessionId: input.sessionId, side: input.side, kind: "PREPARED" }),
  }, `${input.side.toLowerCase()} output planning`, input);
  if (!response.ok || !payload.outputs) {
    throw new Error(toCardMapOperatorMessage(payload.message ?? "Speedster output storage could not be prepared."));
  }
  return payload.outputs;
}
