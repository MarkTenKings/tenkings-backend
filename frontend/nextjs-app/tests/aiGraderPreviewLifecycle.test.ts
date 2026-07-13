import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS,
  advanceAiGraderPreviewEpoch,
  aiGraderPreviewDetectedCaptureReady,
  aiGraderPreviewGeometryMatchesEpoch,
  aiGraderPreviewManualCaptureReady,
  beginAiGraderPreviewReader,
  createAiGraderPreviewEpochState,
  createAiGraderPreviewReconnectState,
  finishAiGraderPreviewReader,
  isAiGraderPreviewReconnectEligible,
  noteAiGraderPreviewFrameForReconnect,
  releaseAiGraderPreviewReconnectTimer,
  type AiGraderPreviewEpochBinding,
} from "../lib/aiGraderPreviewLifecycle";
import {
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  openAiGraderStationPreviewStream,
  retryAiGraderBackPositioningLight,
} from "../lib/aiGraderStationBridgeClient";

const frontEpoch: AiGraderPreviewEpochBinding = {
  sessionId: "session-1",
  side: "front",
  sideEpoch: "front-1",
};
const backEpoch: AiGraderPreviewEpochBinding = {
  sessionId: "session-1",
  side: "back",
  sideEpoch: "back-2",
};

test("front-to-back preview epoch clears Ready and rejects late front work", () => {
  const frontFrame = { ...frontEpoch, frameId: "preview-front-12" };
  let state = createAiGraderPreviewEpochState(frontEpoch);
  state = advanceAiGraderPreviewEpoch(state, { type: "frame", frame: frontFrame });
  state = advanceAiGraderPreviewEpoch(state, { type: "image_loaded", frame: frontFrame });
  state = advanceAiGraderPreviewEpoch(state, { type: "geometry", binding: frontEpoch, sourceFrameId: frontFrame.frameId });
  assert.equal(aiGraderPreviewManualCaptureReady(state), true);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state), true);

  state = advanceAiGraderPreviewEpoch(state, { type: "bind", binding: backEpoch });
  assert.equal(state.phase, "starting");
  assert.deepEqual(state.acceptedFrameIds, []);
  assert.equal(state.latestFrame, undefined);
  assert.equal(aiGraderPreviewManualCaptureReady(state), false);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state), false);

  const unchanged = advanceAiGraderPreviewEpoch(state, { type: "frame", frame: frontFrame });
  assert.deepEqual(unchanged, state);
  const backFrame = { ...backEpoch, frameId: "preview-back-1" };
  state = advanceAiGraderPreviewEpoch(state, { type: "frame", frame: backFrame });
  assert.equal(state.phase, "live");
  assert.equal(aiGraderPreviewManualCaptureReady(state), false);
  state = advanceAiGraderPreviewEpoch(state, { type: "image_loaded", frame: backFrame });
  assert.equal(aiGraderPreviewManualCaptureReady(state), true);
  state = advanceAiGraderPreviewEpoch(state, { type: "geometry", binding: backEpoch, sourceFrameId: backFrame.frameId });
  assert.equal(aiGraderPreviewDetectedCaptureReady(state), true);
  const newerBackFrame = { ...backEpoch, frameId: "preview-back-2" };
  state = advanceAiGraderPreviewEpoch(state, { type: "frame", frame: newerBackFrame });
  assert.equal(aiGraderPreviewManualCaptureReady(state), false);
  assert.equal(aiGraderPreviewDetectedCaptureReady(state), false);
  assert.deepEqual(advanceAiGraderPreviewEpoch(state, { type: "image_loaded", frame: backFrame }), state);
  assert.deepEqual(advanceAiGraderPreviewEpoch(state, { type: "geometry", binding: backEpoch, sourceFrameId: backFrame.frameId }), state);
  state = advanceAiGraderPreviewEpoch(state, { type: "non_live", status: "stopped" });
  state = advanceAiGraderPreviewEpoch(state, { type: "geometry", binding: backEpoch, sourceFrameId: backFrame.frameId });
  assert.equal(state.phase, "stopped");
  assert.equal(aiGraderPreviewDetectedCaptureReady(state), false);
});

test("geometry capture eligibility binds session, side, epoch, and an accepted frame", () => {
  const frame = { ...backEpoch, frameId: "preview-back-4" };
  const geometry = {
    side: "back" as const,
    placementState: "ready" as const,
    geometrySource: "detected" as const,
    captureMode: "automatic_detection" as const,
    confidenceBasis: "automatic_detection" as const,
    detectionUsed: true,
    manualOverrideUsed: false,
    corners: null,
    detectedCorners: null,
    boundingBox: null,
    rotationDegrees: 0,
    skewDegrees: 0,
    confidence: 0.99,
    sessionId: backEpoch.sessionId,
    sideEpoch: backEpoch.sideEpoch,
    sourceFrameId: frame.frameId,
  };
  assert.equal(aiGraderPreviewGeometryMatchesEpoch({ geometry, binding: backEpoch, acceptedFrameIds: [frame.frameId] }), true);
  assert.equal(aiGraderPreviewGeometryMatchesEpoch({ geometry: { ...geometry, sideEpoch: "old" }, binding: backEpoch, acceptedFrameIds: [frame.frameId] }), false);
  assert.equal(aiGraderPreviewGeometryMatchesEpoch({ geometry, binding: backEpoch, acceptedFrameIds: [] }), false);
});

test("preview reconnect is sequential, finite, bounded, and resets only after a frame", () => {
  let state = createAiGraderPreviewReconnectState();
  let decision = beginAiGraderPreviewReader(state, true);
  assert.equal(decision.startReader, true);
  state = decision.state;
  assert.equal(beginAiGraderPreviewReader(state, true).startReader, false);

  const delays: number[] = [];
  for (let attempt = 0; attempt < AI_GRADER_PREVIEW_MAX_CONSECUTIVE_RECONNECTS; attempt += 1) {
    decision = finishAiGraderPreviewReader({ state, eligible: true, reason: "eof" });
    assert.equal(decision.state.readerActive, false);
    assert.equal(decision.state.retryScheduled, true);
    assert.ok(decision.reconnectDelayMs);
    delays.push(decision.reconnectDelayMs);
    assert.equal(beginAiGraderPreviewReader(decision.state, true).startReader, false);
    state = releaseAiGraderPreviewReconnectTimer(decision.state);
    decision = beginAiGraderPreviewReader(state, true);
    assert.equal(decision.startReader, true);
    state = decision.state;
  }
  decision = finishAiGraderPreviewReader({ state, eligible: true, reason: "error" });
  assert.equal(decision.state.exhausted, true);
  assert.equal(decision.reconnectDelayMs, undefined);
  assert.deepEqual(delays, [250, 500, 1000, 2000, 2000]);

  state = noteAiGraderPreviewFrameForReconnect({ ...decision.state, readerActive: true });
  decision = finishAiGraderPreviewReader({ state, eligible: true, reason: "eof" });
  assert.equal(decision.reconnectDelayMs, 250);
});

test("preview reconnect is prohibited for capture, hold, queue review, terminal, abort, and authoritative state", () => {
  const base = {
    connected: true,
    hasStationToken: true,
    mounted: true,
    aborted: false,
    captureActionActive: false,
    captureLockHeld: false,
    runnerCapturing: false,
    previewHoldActive: false,
    queueReviewActive: false,
    terminalOrSafeOff: false,
  };
  assert.equal(isAiGraderPreviewReconnectEligible(base), true);
  for (const key of ["aborted", "captureActionActive", "captureLockHeld", "runnerCapturing", "previewHoldActive", "queueReviewActive", "terminalOrSafeOff"] as const) {
    assert.equal(isAiGraderPreviewReconnectEligible({ ...base, [key]: true }), false, key);
  }
  const active = beginAiGraderPreviewReader(createAiGraderPreviewReconnectState(), true).state;
  assert.equal(finishAiGraderPreviewReader({ state: active, eligible: true, reason: "abort" }).reconnectDelayMs, undefined);
  assert.equal(finishAiGraderPreviewReader({ state: active, eligible: true, reason: "authoritative_state" }).reconnectDelayMs, undefined);
  assert.equal(finishAiGraderPreviewReader({ state: active, eligible: false, reason: "authoritative_state" }).reconnectDelayMs, undefined);
});

test("preview stream distinguishes frame, clean EOF, abort, actual error, and authoritative state", async () => {
  const bytes = new TextEncoder().encode("jpeg-frame");
  const complete = new TextEncoder().encode(
    `--preview-boundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\nX-AI-Grader-Frame-Index: 1\r\nX-AI-Grader-Session-Id: session-1\r\nX-AI-Grader-Preview-Side: back\r\nX-AI-Grader-Preview-Epoch: back-2\r\nX-AI-Grader-Frame-Id: preview-back-1\r\n\r\njpeg-frame\r\n` +
    `--preview-boundary\r\nContent-Type: image/jpeg\r\nContent-Length: 99\r\n\r\nincomplete`
  );
  const events: string[] = [];
  const frames: string[] = [];
  const eofResult = await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    {
      onOpen: () => events.push("open"),
      onFrame: (frame) => {
        events.push("frame");
        frames.push(`${frame.sessionId}:${frame.side}:${frame.sideEpoch}:${frame.frameId}:${frame.byteLength}`);
      },
      onEof: () => events.push("eof"),
      onAbort: () => events.push("abort"),
      onError: () => events.push("error"),
    },
    async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(complete); controller.close(); } }), {
      status: 200,
      headers: { "content-type": "multipart/x-mixed-replace; boundary=preview-boundary" },
    })
  );
  assert.equal(eofResult.kind, "eof");
  assert.deepEqual(events, ["open", "frame", "eof"]);
  assert.deepEqual(frames, [`session-1:back:back-2:preview-back-1:${bytes.length}`]);

  const abortController = new AbortController();
  abortController.abort();
  const abortEvents: string[] = [];
  const abortResult = await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    { signal: abortController.signal, onAbort: () => abortEvents.push("abort"), onError: () => abortEvents.push("error") },
    async () => { throw new DOMException("aborted", "AbortError"); }
  );
  assert.equal(abortResult.kind, "abort");
  assert.deepEqual(abortEvents, ["abort"]);

  const errorEvents: string[] = [];
  await assert.rejects(
    openAiGraderStationPreviewStream(
      { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
      { onAbort: () => errorEvents.push("abort"), onError: () => errorEvents.push("error") },
      async () => { throw new Error("reader failed"); }
    ),
    /reader failed/
  );
  assert.deepEqual(errorEvents, ["error"]);

  const stateEvents: string[] = [];
  const stateResult = await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    { onState: (state) => stateEvents.push(`${state.statusCode}:${state.previewStatus?.status}`), onError: () => stateEvents.push("error") },
    async () => new Response(JSON.stringify({ ok: false, code: "AI_GRADER_CAPTURE_LOCK_HELD", message: "Capture owns camera.", result: { status: "paused_for_capture", cameraOwnership: "capture_action" } }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })
  );
  assert.equal(stateResult.kind, "authoritative_state");
  assert.deepEqual(stateEvents, ["409:paused_for_capture"]);

  const malformedEvents: string[] = [];
  await assert.rejects(
    openAiGraderStationPreviewStream(
      { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
      { onState: () => malformedEvents.push("state"), onError: () => malformedEvents.push("error") },
      async () => new Response(JSON.stringify({ ok: false, code: "UNKNOWN_CONFLICT", message: "conflict" }), { status: 409 }),
    ),
    /conflict/,
  );
  assert.deepEqual(malformedEvents, ["error"]);
});

test("back-positioning retry sends an empty token-gated loopback body", async () => {
  const result = await retryAiGraderBackPositioningLight(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "station-token" },
    async (input, init) => {
      assert.equal(String(input), `${DEFAULT_AI_GRADER_STATION_BRIDGE_URL}/lighting/retry-back-positioning`);
      assert.equal((init?.headers as Record<string, string>)["x-ai-grader-station-token"], "station-token");
      assert.deepEqual(JSON.parse(String(init?.body)), {});
      return new Response(JSON.stringify({ ok: true, result: { status: "waiting_for_frame", captureReady: false, sideEpoch: "back-2", attemptCount: 2, firstFrameGraceMs: 6000, positioningLightReady: false, appliedEnabled: true } }), { status: 200 });
    }
  );
  assert.equal(result.status, "waiting_for_frame");
  assert.equal(result.appliedEnabled, true);
});

test("station integrates epoch UI, retry states, and preview release before safe-off without changing manual audit", () => {
  const stationPath = [
    path.join(process.cwd(), "pages", "ai-grader", "station.tsx"),
    path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const source = fs.readFileSync(stationPath, "utf8");
  assert.match(source, /Starting Back Preview/);
  assert.match(source, /previous front image and Ready state were cleared/i);
  assert.match(source, /Retry Positioning Light/);
  assert.match(source, /Positioning light restore failed safely/);
  assert.match(source, /previewStatus\.positioningLightReady === true/);
  assert.match(source, /aiGraderPreviewDetectedCaptureReady\(previewEpochState\)/);
  assert.match(source, /aiGraderPreviewManualCaptureReady\(previewEpochState\)/);

  const reconcileStart = source.indexOf("const reconcileBridgePreviewStatus");
  const reconcileEnd = source.indexOf("const connectBridgeWithCredentials", reconcileStart);
  const reconcileSource = source.slice(reconcileStart, reconcileEnd);
  assert.match(reconcileSource, /nextStatus\.status !== "live" && nextStatus\.status !== "starting"/);
  assert.match(reconcileSource, /previewAttemptGenerationRef\.current \+= 1;\s+previewControllerRef\.current\?\.abort\(\);/);

  const releaseStart = source.indexOf("const waitForPreviewReleaseBeforeCapture");
  const releaseEnd = source.indexOf("const retryBackPositioningLight", releaseStart);
  const releaseSource = source.slice(releaseStart, releaseEnd);
  assert.ok(releaseSource.indexOf("previewControllerRef.current?.abort()") < releaseSource.indexOf("stopAiGraderStationPreview"));
  assert.ok(releaseSource.indexOf("stopAiGraderStationPreview") < releaseSource.indexOf("safeOffAiGraderLiveLighting"));
  assert.match(source, /buildAiGraderManualGeometryCaptureRequest/);
  assert.match(source, /confirmManualOverlayCapture/);
  assert.match(source, /startGrading\("operator", manualGeometryRect\)/);
  assert.match(source, /confirmFlipAndContinue\("operator", manualGeometryRect\)/);
  assert.equal(source.match(/confirmFlipAndContinueRef\.current\?\.\("auto"\)/g)?.length, 1);
});
