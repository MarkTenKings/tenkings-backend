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
  aiGraderCaptureAssertionFromFrame,
  createAiGraderCaptureAttempt,
  runAiGraderStationCaptureOrchestration,
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
      front?: GeometryCaptureAudit;
      back?: GeometryCaptureAudit;
    };
  };
};

type GeometryCaptureAudit = {
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

test("Station atomic Front then Back Capture reaches the actual built v0.9 loopback bridge in one mutation per side", async () => {
  const bridge = builtBridgeModule();
  assert.equal(bridge.AI_GRADER_LOCAL_STATION_BRIDGE_VERSION, "ai-grader-local-station-bridge-v0.9");

  const tempBase = process.platform === "win32" ? "C:\\tmp" : os.tmpdir();
  await mkdir(tempBase, { recursive: true });
  const tempRoot = await mkdtemp(path.join(tempBase, "tenkings-station-v09-integration-"));
  const token = "station-v09-integration-token";
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

  const streamRuns: Array<{
    abort: AbortController;
    promise: ReturnType<typeof openAiGraderStationPreviewStream>;
    eofCount: number;
    error?: Error;
  }> = [];
  try {
    const health = await fetchAiGraderStationBridgeHealth({ baseUrl: started.url });
    assert.equal(health.bridgeVersion, "ai-grader-local-station-bridge-v0.9");

    const initial = await callAiGraderStationBridge({
      baseUrl: started.url,
      stationToken: token,
      action: "start-session",
      body: { captureProfile: "full_forensic" },
    });
    const positionedFront = await callAiGraderStationBridge({
      baseUrl: started.url,
      stationToken: token,
      action: "accept-profile",
      body: {
        acceptedProfile: {
          dutyPercent: 3,
          exposureUs: 8000,
          gain: 0,
          channels: [1, 2, 3, 4, 5, 6, 7, 8],
          source: "bridge_operator",
        },
      },
    });
    assert.equal(initial.sessionManifest.gradingSessionId, positionedFront.sessionManifest.gradingSessionId);
    assert.equal(positionedFront.currentStep, "capture_front");
    assert.equal(positionedFront.previewStatus.activeSide, "front");

    const openBoundSide = async (side: "front" | "back", sideEpoch: string) => {
      const frames = new Map<string, AiGraderStationPreviewFrame>();
      const run = {
        abort: new AbortController(),
        promise: undefined as unknown as ReturnType<typeof openAiGraderStationPreviewStream>,
        eofCount: 0,
        error: undefined as Error | undefined,
      };
      run.promise = openAiGraderStationPreviewStream(
        { baseUrl: started.url, stationToken: token },
        {
          signal: run.abort.signal,
          onFrame(frame) {
            if (frame.side === side && frame.frameId) frames.set(frame.frameId, frame);
          },
          onEof() {
            run.eofCount += 1;
          },
          onError(error) {
            run.error = error;
          },
        },
      );
      streamRuns.push(run);
      return waitFor(async () => {
        const preview = await fetchAiGraderStationPreviewStatus({ baseUrl: started.url, stationToken: token });
        const geometry = preview.cardGeometry?.[side];
        const frame = geometry?.sourceFrameId ? frames.get(geometry.sourceFrameId) : undefined;
        return preview.status === "live"
          && (side === "front" || preview.positioningLightReady === true)
          && preview.sessionId === positionedFront.sessionManifest.gradingSessionId
          && preview.activeSide === side
          && preview.sideEpoch === sideEpoch
          && preview.latestFrameId === geometry?.sourceFrameId
          && geometry?.sessionId === preview.sessionId
          && geometry.sideEpoch === sideEpoch
          && geometry.placementState === "ready"
          && frame?.sessionId === preview.sessionId
          && frame.side === side
          && frame.sideEpoch === sideEpoch
          ? { frame, preview, run }
          : undefined;
      }, `The built bridge did not publish an exact live ${side} frame/geometry/light binding.`);
    };

    const captureMutationPaths: string[] = [];
    const captureRequestBodies: Record<string, unknown>[] = [];
    const rawCapturePayloads: RawCapturePayload[] = [];
    const captureSide = async (input: {
      side: "front" | "back";
      frame: AiGraderStationPreviewFrame;
      reportId: string;
    }) => {
      assert.ok(input.frame.sessionId);
      assert.ok(input.frame.sideEpoch);
      assert.ok(input.frame.frameId);
      const assertion = aiGraderCaptureAssertionFromFrame({
        frame: {
          sessionId: input.frame.sessionId,
          side: input.side,
          sideEpoch: input.frame.sideEpoch,
          frameId: input.frame.frameId,
        },
        reportId: input.reportId,
        geometryCaptureMode: "manual_capture",
        captureTriggerMode: "operator",
      });
      const captureTriggerAt = new Date().toISOString();
      const attempt = createAiGraderCaptureAttempt(assertion, captureTriggerAt);
      assert.match(attempt.idempotencyKey, new RegExp(`^capture-${input.side}-v0\\.9-[a-f0-9]{16}$`));
      let intentCount = 0;
      const result = await runAiGraderStationCaptureOrchestration({
        baseUrl: started.url,
        stationToken: token,
        assertion,
        attempt,
        onIntent(intent) {
          intentCount += 1;
          assert.deepEqual(intent.binding, {
            sessionId: input.frame.sessionId,
            side: input.side,
            sideEpoch: input.frame.sideEpoch,
          });
          assert.equal(intent.frameId, input.frame.frameId);
        },
      }, async (request, init) => {
        const requestUrl = new URL(String(request));
        captureMutationPaths.push(requestUrl.pathname);
        captureRequestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        const response = await fetch(request, init);
        rawCapturePayloads.push(await response.clone().json() as RawCapturePayload);
        return response;
      });
      assert.equal(intentCount, 1);
      return { result, captureTriggerAt };
    };

    const frontSideEpoch = positionedFront.previewStatus.sideEpoch;
    assert.ok(frontSideEpoch);
    const frontBound = await openBoundSide("front", frontSideEpoch);
    const frontCapture = await captureSide({
      side: "front",
      frame: frontBound.frame,
      reportId: positionedFront.sessionManifest.reportId,
    });
    assert.deepEqual(captureMutationPaths, ["/actions/capture-front"]);
    assert.equal(frontCapture.result.currentStep, "prompt_flip_card");
    assert.equal(frontCapture.result.sessionManifest.frontCaptured, true);
    assert.equal(frontCapture.result.sessionManifest.backCaptured, false);
    assert.equal(frontCapture.result.previewStatus.activeSide, "back");
    assert.notEqual(frontCapture.result.previewStatus.sideEpoch, positionedFront.previewStatus.sideEpoch);
    const frontStreamResult = await frontBound.run.promise;
    assert.equal(frontStreamResult.kind, "eof");
    assert.equal(frontBound.run.eofCount, 1);
    assert.equal(frontBound.run.error, undefined);

    const backSideEpoch = frontCapture.result.previewStatus.sideEpoch;
    assert.ok(backSideEpoch);
    const backBound = await openBoundSide("back", backSideEpoch);
    const backCapture = await captureSide({
      side: "back",
      frame: backBound.frame,
      reportId: frontCapture.result.sessionManifest.reportId,
    });
    assert.deepEqual(captureMutationPaths, ["/actions/capture-front", "/actions/capture-back"]);
    assert.equal(backCapture.result.sessionManifest.backCaptured, true);
    assert.equal(backCapture.result.currentStep, "run_provisional_diagnostics");
    const backStreamResult = await backBound.run.promise;
    assert.equal(backStreamResult.kind, "eof");
    assert.equal(backBound.run.eofCount, 1);
    assert.equal(backBound.run.error, undefined);

    const expectedRequestKeys = [
      "captureTriggerAt",
      "captureTriggerMode",
      "expectedFrameId",
      "expectedReportId",
      "expectedSessionId",
      "expectedSide",
      "expectedSideEpoch",
      "geometryCaptureMode",
      "idempotencyKey",
    ];
    assert.equal(captureRequestBodies.length, 2);
    captureRequestBodies.forEach((body) => {
      assert.deepEqual(Object.keys(body).sort(), expectedRequestKeys);
      assert.equal("manualGeometryRect" in body, false);
      assert.equal("confirmations" in body, false);
      assert.equal("acceptedProfile" in body, false);
    });
    assert.equal(rawCapturePayloads.length, 2);
    assert.equal(
      rawCapturePayloads[0]?.result?.commandResults?.filter((result) => result.stepId === "capture_front").length,
      1,
    );
    assert.equal(
      rawCapturePayloads[1]?.result?.commandResults?.filter((result) => result.stepId === "capture_back").length,
      1,
    );
    const assertManualAudit = (
      audit: GeometryCaptureAudit | undefined,
      frame: AiGraderStationPreviewFrame,
      captureTriggerAt: string,
    ) => {
      assert.equal(audit?.mode, "manual_capture");
      assert.equal(audit?.placementState, "ready");
      assert.equal(audit?.timestamp, captureTriggerAt);
      assert.equal(audit?.explicitOperatorAction, true);
      assert.equal(audit?.detectionUsed, false);
      assert.equal(audit?.manualOverrideUsed, true);
      assert.equal(audit?.sourceFrameId, frame.frameId);
      assert.equal(audit?.manualGeometrySource?.imageWidth, 900);
      assert.equal(audit?.manualGeometrySource?.imageHeight, 1260);
      assert.equal(audit?.manualGeometrySource?.coordinateFrame, "portrait_preview_pixels");
      assert.equal(audit?.manualBoundaryRect?.coordinateFrame, "basler_sensor_pixels");
    };
    assertManualAudit(rawCapturePayloads[0]?.result?.geometryCaptureDecisions?.front, frontBound.frame, frontCapture.captureTriggerAt);
    assertManualAudit(rawCapturePayloads[1]?.result?.geometryCaptureDecisions?.back, backBound.frame, backCapture.captureTriggerAt);
    assert.equal(realHardwareBoundaries, 0);
    assert.ok(lightingWriteBatches >= 3, "The inert ACK fake should observe front safe-off, accepted-profile back restore, and back safe-off writes.");
  } finally {
    for (const run of streamRuns) run.abort.abort();
    for (const run of streamRuns) {
      await Promise.race([
        run.promise.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    if (typeof started.server.closeAllConnections === "function") started.server.closeAllConnections();
    await closeServer(started.server);
    assert.equal(path.dirname(tempRoot), path.resolve(tempBase));
    assert.match(path.basename(tempRoot), /^tenkings-station-v09-integration-/);
    await rm(tempRoot, { recursive: true, force: true });
  }
});
