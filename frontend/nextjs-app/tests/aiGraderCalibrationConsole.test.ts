import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AiGraderCalibrationConsole from "../components/ai-grader/AiGraderCalibrationConsole";
import {
  aiGraderCalibrationActionEnabled,
  aiGraderCalibrationPreviewFresh,
  buildMockAiGraderCalibrationConsole,
  unavailableAiGraderCalibrationConsole,
} from "../lib/aiGraderCalibrationConsole";
import { openAiGraderStationPreviewStream } from "../lib/aiGraderStationBridgeClient";
import {
  createAiGraderPreviewEpochState,
  transitionAiGraderPreviewEpoch,
} from "../lib/aiGraderPreviewLifecycle";

test("retry stays on pose 4 and preserves accepted successful poses", () => {
  const model = buildMockAiGraderCalibrationConsole("incomplete");
  assert.equal(model.currentPoseNumber, 4);
  assert.deepEqual(model.acceptedPoses.filter((pose) => !pose.superseded).map((pose) => pose.poseNumber), [1, 2, 3]);
  assert.equal(model.failedAttempts.at(-1)?.poseNumber, 4);
  assert.match(model.failedAttempts.at(-1)?.message ?? "", /pose 4 remains current/i);
  assert.equal(aiGraderCalibrationActionEnabled({
    model,
    action: "retry_current_pose",
    previewFresh: true,
  }), true);
});

test("browser cannot skip server-authorized steps or replace immutable evidence implicitly", () => {
  const model = buildMockAiGraderCalibrationConsole("incomplete");
  for (const action of ["confirm_blank_reverse_flip", "begin_or_resume_automatic_sweep", "analyze", "finalize"] as const) {
    assert.equal(aiGraderCalibrationActionEnabled({ model, action, previewFresh: true }), false, action);
  }
  assert.equal(aiGraderCalibrationActionEnabled({
    model,
    action: "replace_selected_pose",
    previewFresh: true,
    selectedPoseNumber: 2,
    replacementWarningConfirmed: false,
  }), false);
  assert.equal(aiGraderCalibrationActionEnabled({
    model,
    action: "replace_selected_pose",
    previewFresh: true,
    selectedPoseNumber: 2,
    replacementWarningConfirmed: true,
  }), true);
});

test("server-projected session identity resumes after a mocked page reload", () => {
  const beforeReload = buildMockAiGraderCalibrationConsole("incomplete");
  const afterReload = buildMockAiGraderCalibrationConsole("incomplete");
  assert.equal(afterReload.sessionId, beforeReload.sessionId);
  assert.equal(afterReload.sessionRevision, beforeReload.sessionRevision);
  assert.equal(afterReload.eventHeadSha256, beforeReload.eventHeadSha256);
  assert.deepEqual(afterReload.acceptedPoses, beforeReload.acceptedPoses);
  assert.equal(afterReload.currentPoseNumber, 4);
});

test("a stale displayed preview frame cannot authorize capture or retry", () => {
  const now = Date.parse("2026-07-21T14:05:30.000Z");
  const binding = { sessionId: "calibration-session", side: "front" as const, sideEpoch: "calibration-epoch" };
  const frame = { ...binding, frameId: "frame-18" };
  let state = createAiGraderPreviewEpochState(binding);
  state = transitionAiGraderPreviewEpoch(state, { type: "opened", binding }).state;
  state = transitionAiGraderPreviewEpoch(state, {
    type: "frame",
    frame,
    objectUrl: "blob:frame-18",
    receivedAtMs: now,
    capturedAt: new Date(now - 100).toISOString(),
  }).state;
  state = transitionAiGraderPreviewEpoch(state, {
    type: "image_loaded",
    frame,
    loadedAtMs: now,
    width: 2448,
    height: 2048,
  }).state;
  const model = buildMockAiGraderCalibrationConsole("incomplete");
  assert.equal(aiGraderCalibrationPreviewFresh(state, now), true);
  assert.equal(aiGraderCalibrationActionEnabled({
    model,
    action: "capture_current_pose",
    previewFresh: aiGraderCalibrationPreviewFresh(state, now + 2_001),
  }), false);
});

test("failed and incomplete bundles omit Activate while exact PASS renders it", () => {
  const render = (scenario: "incomplete" | "failed" | "pass") => renderToStaticMarkup(createElement(
    AiGraderCalibrationConsole,
    {
      model: buildMockAiGraderCalibrationConsole(scenario),
      previewUrl: null,
      previewFresh: true,
      previewStatusLabel: "Mocked preview",
      previewDetail: "No hardware",
      onAction() {},
    },
  ));
  const activateButton = /<button[^>]*>Activate<\/button>/;
  assert.doesNotMatch(render("incomplete"), activateButton);
  assert.doesNotMatch(render("failed"), activateButton);
  assert.match(render("pass"), activateButton);
});

test("contract loss is a clear fail-closed state with only safe exit available", () => {
  const model = unavailableAiGraderCalibrationConsole("Reviewed contract was not exported.");
  assert.match(model.hardFailure ?? "", /not exported/i);
  for (const [action, authority] of Object.entries(model.actions)) {
    assert.equal(authority.available, action === "exit", action);
    assert.equal(authority.authorityPresent, action === "exit", action);
  }
  const html = renderToStaticMarkup(createElement(AiGraderCalibrationConsole, {
    model,
    previewUrl: null,
    previewFresh: false,
    previewStatusLabel: "Basler preview unavailable",
    previewDetail: "No exact epoch",
    onAction() {},
  }));
  assert.match(html, /Calibration hard failure/);
  assert.match(html, /No older calibration was selected automatically/);
});

test("proven multipart reader parses split live frames and keeps session identity out of the URL", async () => {
  const boundary = "tenkings-test-boundary";
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const header = new TextEncoder().encode([
    `--${boundary}`,
    "Content-Type: image/jpeg",
    `Content-Length: ${jpeg.byteLength}`,
    "X-AI-Grader-Frame-Index: 18",
    "X-AI-Grader-Captured-At: 2026-07-21T14:05:30.000Z",
    "X-AI-Grader-Session-Id: calibration-session-18",
    "X-AI-Grader-Preview-Side: front",
    "X-AI-Grader-Preview-Epoch: calibration-epoch-18",
    "X-AI-Grader-Frame-Id: frame-18",
    "",
    "",
  ].join("\r\n"));
  const trailer = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const payload = new Uint8Array(header.byteLength + jpeg.byteLength + trailer.byteLength);
  payload.set(header);
  payload.set(jpeg, header.byteLength);
  payload.set(trailer, header.byteLength + jpeg.byteLength);
  const chunks = [payload.slice(0, 13), payload.slice(13, 47), payload.slice(47, payload.length - 2), payload.slice(-2)];
  let requestedUrl = "";
  let requestHeaders = new Headers();
  const frames: Array<{ frameId?: string; bytes: number[] }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestHeaders = new Headers(init?.headers);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": `multipart/x-mixed-replace; boundary=${boundary}` } });
  }) as typeof fetch;
  await openAiGraderStationPreviewStream(
    {
      baseUrl: "http://127.0.0.1:3021",
      stationToken: "local-pairing-token",
      mathematicalCalibrationSessionId: "calibration-session-18",
    },
    {
      onFrame(frame) {
        frames.push({ frameId: frame.frameId, bytes: [] });
        void frame.blob.arrayBuffer().then((bytes) => { frames[frames.length - 1].bytes = Array.from(new Uint8Array(bytes)); });
      },
    },
    fetchImpl,
  );
  await Promise.resolve();
  assert.equal(requestedUrl, "http://127.0.0.1:3021/preview/stream");
  assert.equal(requestedUrl.includes("calibration-session-18"), false);
  assert.equal(requestedUrl.includes("local-pairing-token"), false);
  assert.equal(requestHeaders.get("x-ai-grader-mathematical-calibration-session-id"), "calibration-session-18");
  assert.equal(frames[0]?.frameId, "frame-18");
  assert.deepEqual(frames[0]?.bytes, Array.from(jpeg));
});

test("preview reader rejects unsafe browser-supplied session identities before fetch", async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    return new Response();
  }) as typeof fetch;
  await assert.rejects(
    openAiGraderStationPreviewStream({
      baseUrl: "http://127.0.0.1:3021",
      stationToken: "local-pairing-token",
      mathematicalCalibrationSessionId: "secret-token-value",
    }, {}, fetchImpl),
    /session identity is invalid/i,
  );
  assert.equal(called, false);
});
