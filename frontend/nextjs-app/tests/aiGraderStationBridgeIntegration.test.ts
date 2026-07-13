import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  callAiGraderStationBridge,
  fetchAiGraderStationBridgeHealth,
  fetchAiGraderStationPreviewStatus,
  openAiGraderStationPreviewStream,
  type AiGraderStationPreviewFrame,
} from "../lib/aiGraderStationBridgeClient";
import {
  aiGraderBackCaptureAssertionFromFrame,
  createAiGraderBackCaptureAttempt,
  runAiGraderStationBackCaptureOrchestration,
} from "../lib/aiGraderStationOperations";

type StartedBridge = {
  server: Server;
  url: string;
};

type BuiltBridgeModule = {
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION: string;
  startAiGraderLocalStationBridgeHttpServer: (
    config: Record<string, unknown>,
    env: NodeJS.ProcessEnv,
    runner: { run(step: unknown): Promise<unknown> },
    warmRunner: { captureSide(input: unknown): Promise<unknown>; processSide(batch: unknown): Promise<unknown> },
    dependencies: Record<string, unknown>,
  ) => Promise<StartedBridge>;
};

type RawCapturePayload = {
  result?: {
    commandResults?: Array<{ stepId?: string }>;
    geometryCaptureDecisions?: {
      back?: {
        mode?: string;
        placementState?: string;
        timestamp?: string;
        explicitOperatorAction?: boolean;
        detectionUsed?: boolean;
        manualOverrideUsed?: boolean;
        sourceFrameId?: string;
        manualBoundaryRect?: { coordinateFrame?: string };
        manualGeometrySource?: { imageWidth?: number; imageHeight?: number; coordinateFrame?: string };
      };
    };
  };
};

const MANUAL_GEOMETRY_RECT = {
  x: 100,
  y: 100,
  width: 1000,
  height: 1400,
  imageWidth: 1200,
  imageHeight: 1680,
  coordinateFrame: "portrait_preview_pixels" as const,
};

function builtBridgeModule(): BuiltBridgeModule {
  const candidates = [
    path.resolve(process.cwd(), "packages/ai-grader-capture-helper/dist/drivers/aiGraderLocalStationBridge.js"),
    path.resolve(process.cwd(), "../../packages/ai-grader-capture-helper/dist/drivers/aiGraderLocalStationBridge.js"),
  ];
  const builtPath = candidates.find((candidate) => existsSync(candidate));
  assert.ok(
    builtPath,
    "Build @tenkings/ai-grader-capture-helper before the Station-to-bridge integration test.",
  );
  const runtimeRequire = createRequire(path.join(process.cwd(), "package.json"));
  return runtimeRequire(builtPath) as BuiltBridgeModule;
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  message: string,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

test("Station atomic Back Capture reaches the actual built v0.8 loopback bridge in one mutation", async () => {
  const bridge = builtBridgeModule();
  assert.equal(bridge.AI_GRADER_LOCAL_STATION_BRIDGE_VERSION, "ai-grader-local-station-bridge-v0.8");

  const tempBase = process.platform === "win32" ? "C:\\tmp" : os.tmpdir();
  await mkdir(tempBase, { recursive: true });
  const tempRoot = await mkdtemp(path.join(tempBase, "tenkings-station-v08-integration-"));
  const token = "station-v08-integration-token";
  let realHardwareBoundaries = 0;
  let lightingWriteBatches = 0;
  const started = await bridge.startAiGraderLocalStationBridgeHttpServer(
    {
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 0,
      stationToken: token,
      allowedOrigins: [],
      outputDir: path.join(tempRoot, "capture-output"),
    },
    process.env,
    {
      async run() {
        throw new Error("The mock integration bridge must not invoke a station CLI or hardware runner.");
      },
    },
    {
      async captureSide() {
        throw new Error("The mock integration bridge must not invoke a physical warm capture runner.");
      },
      async processSide() {
        throw new Error("The mock integration bridge must not invoke a physical warm processing runner.");
      },
    },
    {
      async writeLightingFrames(frames: readonly unknown[]) {
        lightingWriteBatches += 1;
        return frames.map(() => ({ responseKind: "mock", ok: true }));
      },
      async stopOrphanedPreviewStreamsUntilReleased() {
        return 0;
      },
      stopPreviewProcessTree() {
        throw new Error("The mock integration bridge must not own a physical preview process.");
      },
      startPreviewProcess() {
        throw new Error("The mock integration bridge must not start a physical preview process.");
      },
      onRealHardwareBoundary() {
        realHardwareBoundaries += 1;
        throw new Error("The integration test crossed a forbidden real-hardware boundary.");
      },
    },
  );

  const streamAbort = new AbortController();
  let streamPromise: ReturnType<typeof openAiGraderStationPreviewStream> | undefined;
  try {
    const health = await fetchAiGraderStationBridgeHealth({ baseUrl: started.url });
    assert.equal(health.bridgeVersion, "ai-grader-local-station-bridge-v0.8");

    await callAiGraderStationBridge({
      baseUrl: started.url,
      stationToken: token,
      action: "start-session",
      body: { captureProfile: "full_forensic" },
    });
    await callAiGraderStationBridge({
      baseUrl: started.url,
      stationToken: token,
      action: "confirm-light-idle-off",
      body: { confirmations: { lightIdleOff: true } },
    });
    await callAiGraderStationBridge({
      baseUrl: started.url,
      stationToken: token,
      action: "confirm-fixture-rulers",
      body: { confirmations: { fixtureRulersVisible: true } },
    });
    const front = await callAiGraderStationBridge({
      baseUrl: started.url,
      stationToken: token,
      action: "capture-front",
      body: {
        captureTriggerMode: "operator",
        geometryCaptureMode: "manual_capture",
        manualGeometryRect: MANUAL_GEOMETRY_RECT,
      },
    });
    assert.equal(front.currentStep, "prompt_flip_card");
    assert.equal(front.sessionManifest.frontCaptured, true);
    assert.equal(front.sessionManifest.backCaptured, false);
    assert.equal(front.previewStatus.activeSide, "back");
    assert.ok(front.previewStatus.sideEpoch);

    let streamEofCount = 0;
    let streamError: Error | undefined;
    let resolveReadyFrame!: (frame: AiGraderStationPreviewFrame) => void;
    const readyFramePromise = new Promise<AiGraderStationPreviewFrame>((resolve) => {
      resolveReadyFrame = resolve;
    });
    streamPromise = openAiGraderStationPreviewStream(
      { baseUrl: started.url, stationToken: token },
      {
        signal: streamAbort.signal,
        onFrame(frame) {
          if (frame.side === "back" && (frame.frameIndex ?? 0) >= 3) resolveReadyFrame(frame);
        },
        onEof() {
          streamEofCount += 1;
        },
        onError(error) {
          streamError = error;
        },
      },
    );

    const readyFrame = await Promise.race([
      readyFramePromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Back preview did not reach a fresh Ready frame.")), 3000)),
    ]);
    assert.equal(readyFrame.sessionId, front.sessionManifest.gradingSessionId);
    assert.equal(readyFrame.sideEpoch, front.previewStatus.sideEpoch);
    assert.ok(readyFrame.frameId);

    const boundPreview = await waitFor(async () => {
      const preview = await fetchAiGraderStationPreviewStatus({ baseUrl: started.url, stationToken: token });
      const geometry = preview.cardGeometry?.back;
      return preview.status === "live"
        && preview.positioningLightReady === true
        && preview.sessionId === readyFrame.sessionId
        && preview.activeSide === "back"
        && preview.sideEpoch === readyFrame.sideEpoch
        && preview.latestFrameId === readyFrame.frameId
        && geometry !== undefined
        && geometry.sessionId === readyFrame.sessionId
        && geometry.sideEpoch === readyFrame.sideEpoch
        && geometry.sourceFrameId === readyFrame.frameId
        && geometry.placementState === "ready"
        ? preview
        : undefined;
    }, "The built bridge did not publish an exact live back frame/geometry/light binding.");
    assert.equal(boundPreview.cardGeometry?.back?.side, "back");

    const assertion = aiGraderBackCaptureAssertionFromFrame({
      frame: {
        sessionId: readyFrame.sessionId!,
        side: "back",
        sideEpoch: readyFrame.sideEpoch!,
        frameId: readyFrame.frameId!,
      },
      reportId: front.sessionManifest.reportId,
      geometryCaptureMode: "manual_capture",
      captureTriggerMode: "operator",
    });
    const captureTriggerAt = new Date().toISOString();
    const attempt = createAiGraderBackCaptureAttempt(assertion, captureTriggerAt);
    const captureMutationPaths: string[] = [];
    let captureRequestBody: Record<string, unknown> | undefined;
    let rawCapturePayload: RawCapturePayload | undefined;
    let stationIntentCount = 0;
    const captureResult = await runAiGraderStationBackCaptureOrchestration({
      baseUrl: started.url,
      stationToken: token,
      assertion,
      attempt,
      onIntent(intent) {
        stationIntentCount += 1;
        assert.equal(intent.binding.sessionId, readyFrame.sessionId);
        assert.equal(intent.binding.sideEpoch, readyFrame.sideEpoch);
        assert.equal(intent.frameId, readyFrame.frameId);
      },
    }, async (input, init) => {
      const requestUrl = new URL(String(input));
      captureMutationPaths.push(requestUrl.pathname);
      captureRequestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const response = await fetch(input, init);
      rawCapturePayload = await response.clone().json() as RawCapturePayload;
      return response;
    });

    assert.equal(stationIntentCount, 1);
    assert.deepEqual(captureMutationPaths, ["/actions/capture-back"]);
    assert.equal("manualGeometryRect" in (captureRequestBody ?? {}), false);
    assert.equal("confirmations" in (captureRequestBody ?? {}), false);
    assert.equal(captureResult.sessionManifest.backCaptured, true);
    assert.equal(captureResult.currentStep, "run_provisional_diagnostics");
    assert.equal(
      rawCapturePayload?.result?.commandResults?.filter((result) => result.stepId === "capture_back").length,
      1,
    );
    const manualAudit = rawCapturePayload?.result?.geometryCaptureDecisions?.back;
    assert.equal(manualAudit?.mode, "manual_capture");
    assert.equal(manualAudit?.placementState, "ready");
    assert.equal(manualAudit?.timestamp, captureTriggerAt);
    assert.equal(manualAudit?.explicitOperatorAction, true);
    assert.equal(manualAudit?.detectionUsed, false);
    assert.equal(manualAudit?.manualOverrideUsed, true);
    assert.equal(manualAudit?.sourceFrameId, readyFrame.frameId);
    assert.equal(manualAudit?.manualGeometrySource?.imageWidth, 900);
    assert.equal(manualAudit?.manualGeometrySource?.imageHeight, 1260);
    assert.equal(manualAudit?.manualGeometrySource?.coordinateFrame, "portrait_preview_pixels");
    assert.equal(manualAudit?.manualBoundaryRect?.coordinateFrame, "basler_sensor_pixels");
    const streamResult = await streamPromise;
    assert.equal(streamResult.kind, "eof");
    assert.equal(streamEofCount, 1);
    assert.equal(streamError, undefined);
    assert.equal(realHardwareBoundaries, 0);
    assert.ok(lightingWriteBatches >= 4, "The inert ACK fake should observe safe-off, restore, and capture-handoff writes.");
  } finally {
    streamAbort.abort();
    if (streamPromise) {
      await Promise.race([
        streamPromise.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    if (typeof started.server.closeAllConnections === "function") started.server.closeAllConnections();
    await closeServer(started.server);
    assert.equal(path.dirname(tempRoot), path.resolve(tempBase));
    assert.match(path.basename(tempRoot), /^tenkings-station-v08-integration-/);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
