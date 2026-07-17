import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_STATION_STEPS,
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
  sanitizeAiGraderPreviewCardGeometry,
} from "../lib/aiGraderLocalStation";
import {
  aiGraderCaptureAssertionFromFrame,
  runAiGraderCapture,
} from "../lib/aiGraderStationOperations";

test("operator station contract exposes the single retained grading workflow", () => {
  const labels = AI_GRADER_STATION_STEPS.map((step) => step.label);
  assert.deepEqual(labels, ["Start New Card", "Capture Front", "Capture Back", "Approve & Publish"]);
  assert.equal(labels.some((label) => /fixture|accept capture|safe off/i.test(label)), false);
});

test("removed browser safety, confirmation, queue, and fallback actions are absent", () => {
  for (const action of [
    "safe-off", "confirm-light-idle-off", "confirm-fixture-rulers", "accept-profile", "confirm-flip",
    "configure-rapid-capture", "queue-current-card", "activate-queue-item",
  ]) assert.equal(parseAiGraderStationAction(action), null);
  const status = buildAiGraderLocalStationStatus();
  const serialized = JSON.stringify(status);
  for (const removed of ["rapidCapture", "frontWorkflowAuthority", "lightingProfileAccepted", "coldDebugMode", "fallbackUsed"]) {
    assert.equal(serialized.includes(removed), false, `${removed} must be absent`);
  }
  assert.equal(status.liveLighting.safety.maxDutyPercent, 99.9);
  assert.equal(status.liveLighting.safety.watchdogOwnedByBridge, true);
});

test("manual geometry fallback cannot enter the display contract", () => {
  const geometry = sanitizeAiGraderPreviewCardGeometry({
    side: "front", placementState: "ready", geometrySource: "manual_override", captureMode: "manual_capture",
    confidenceBasis: "operator_confirmation", detectionUsed: false, confidence: 1,
  }, "front");
  assert.equal(geometry?.geometrySource, "none");
  assert.equal(geometry?.captureMode, "none");
});

test("capture request binds exact session, report, side, epoch, and frame without a browser intent gate", async () => {
  const assertion = aiGraderCaptureAssertionFromFrame({
    frame: { sessionId: "session-1", side: "front", sideEpoch: "front-epoch-1", frameId: "frame-9" },
    reportId: "report-1",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
  });
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  await runAiGraderCapture({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "paired-station-token",
    assertion,
    requestId: "capture-front-1234567890",
    captureTriggerAt: "2026-07-17T12:00:00.000Z",
  }, (async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true, result: buildAiGraderLocalStationStatus() }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  assert.equal(capturedUrl, "http://127.0.0.1:47652/actions/capture-front");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    idempotencyKey: "capture-front-1234567890",
    expectedSessionId: "session-1",
    expectedReportId: "report-1",
    expectedSide: "front",
    expectedSideEpoch: "front-epoch-1",
    expectedFrameId: "frame-9",
    geometryCaptureMode: "detected_geometry",
    captureTriggerMode: "operator",
    captureTriggerAt: "2026-07-17T12:00:00.000Z",
  });
});
