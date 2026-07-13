import { createHash } from "node:crypto";
import {
  NativeCameraNdjsonParser,
  parseNativeCameraPreviewPayload,
  type NativeCameraPreviewFramePayload,
  type NativeCameraProtocolMessage,
} from "./nativeCameraProtocol";
import { NativeCameraWorkerClient, type NativeCameraWorkerClientOptions } from "./nativeCameraWorkerClient";

export interface NativeCameraProtocolReplayResult {
  messageCount: number;
  previewFrameCount: number;
  queueDrops: number;
  latestPreview: NativeCameraPreviewFramePayload | null;
  deterministicDigest: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

/**
 * Deterministically replays redacted protocol chunks without starting a child
 * process. It uses the same strict parser and a latest-frame queue of one.
 */
export function runNativeCameraProtocolReplay(
  chunks: readonly (Buffer | string)[],
  options: { requireFinalNewline?: boolean } = {},
): NativeCameraProtocolReplayResult {
  const parser = new NativeCameraNdjsonParser();
  const messages: NativeCameraProtocolMessage[] = [];
  let latestPreview: NativeCameraPreviewFramePayload | null = null;
  let previewFrameCount = 0;
  let queueDrops = 0;
  for (const chunk of chunks) {
    for (const message of parser.push(chunk)) {
      messages.push(message);
      if (message.kind === "event" && message.event === "preview_frame") {
        const preview = parseNativeCameraPreviewPayload(message.payload);
        previewFrameCount += 1;
        if (latestPreview) queueDrops += 1;
        latestPreview = preview;
      }
    }
  }
  if (options.requireFinalNewline !== false) parser.end();
  const digest = createHash("sha256").update(JSON.stringify(canonical(messages))).digest("hex");
  return {
    messageCount: messages.length,
    previewFrameCount,
    queueDrops,
    latestPreview,
    deterministicDigest: digest,
  };
}

export function assertNativeCameraReplayDeterministic(chunks: readonly (Buffer | string)[]): NativeCameraProtocolReplayResult {
  const first = runNativeCameraProtocolReplay(chunks);
  const second = runNativeCameraProtocolReplay(chunks);
  if (first.deterministicDigest !== second.deterministicDigest) {
    throw new Error("Native camera protocol replay was not deterministic.");
  }
  return first;
}

/** Test/replay-only factories; neither can select or instantiate Pylon. */
export function createNativeCameraReplayClient(
  options: Omit<NativeCameraWorkerClientOptions, "feature">,
): NativeCameraWorkerClient {
  return new NativeCameraWorkerClient({
    ...options,
    feature: {
      enabled: true,
      selection: "replay",
      allowHardwareBackend: false,
      automaticFallbackAllowed: false,
    },
  });
}

export function createNativeCameraFakeClient(
  options: Omit<NativeCameraWorkerClientOptions, "feature">,
): NativeCameraWorkerClient {
  return new NativeCameraWorkerClient({
    ...options,
    feature: {
      enabled: true,
      selection: "fake",
      allowHardwareBackend: false,
      automaticFallbackAllowed: false,
    },
  });
}
