import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_STATION_STEPS,
  aiGraderApproveAndPublishEligible,
  aiGraderAuthoritativeLiveLightingDraft,
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
  sanitizeAiGraderRapidCaptureQueue,
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

test("removed browser safety, confirmation, and fallback actions are absent while Rapid Capture remains", () => {
  for (const action of [
    "safe-off", "confirm-light-idle-off", "confirm-fixture-rulers", "accept-profile", "confirm-flip",
  ]) assert.equal(parseAiGraderStationAction(action), null);
  for (const action of ["configure-rapid-capture", "queue-current-card", "activate-queue-item"]) {
    assert.equal(parseAiGraderStationAction(action), action);
  }
  const status = buildAiGraderLocalStationStatus();
  const serialized = JSON.stringify(status);
  for (const removed of ["frontWorkflowAuthority", "lightingProfileAccepted", "coldDebugMode", "fallbackUsed"]) {
    assert.equal(serialized.includes(removed), false, `${removed} must be absent`);
  }
  assert.equal(status.rapidCapture.enabled, false);
  assert.equal(status.rapidCaptureQueue.reportWorkerSerialized, true);
  assert.equal(status.liveLighting.safety.maxDutyPercent, 99.9);
  assert.equal(status.liveLighting.safety.watchdogOwnedByBridge, true);
});

test("Rapid Capture queue sanitization preserves bounded report state and strips local paths", () => {
  const queue = sanitizeAiGraderRapidCaptureQueue({
    enabled: true,
    activeQueueItemId: "session-1-rapid-card",
    items: [{
      queueItemId: "session-1-rapid-card",
      sessionId: "session-1",
      reportId: "report-1",
      state: "report_ready_needs_confirm",
      queuedAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:01.000Z",
      history: [],
      manifestPath: "C:\\TenKings\\private\\station-session.json",
      autoConfirmed: true,
    }],
  });
  assert.equal(queue.enabled, true);
  assert.equal(queue.reportWorkerSerialized, true);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].reportId, "report-1");
  assert.equal("manifestPath" in queue.items[0], false);
  assert.equal(queue.items[0].autoConfirmed, false);
});

test("browser lighting display follows only the authoritative acknowledged bridge state", () => {
  const status = buildAiGraderLocalStationStatus({ action: "start-session" });
  status.liveLighting.profile = {
    ...status.liveLighting.profile,
    enabled: true,
    acceptedForCapture: true,
    source: "accepted_station_profile",
  };
  assert.equal(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting).enabled, false);

  status.liveLighting.status = "on";
  status.liveLighting.applied = {
    enabled: true,
    dutyPercent: status.liveLighting.profile.dutyPercent,
    actualLeimacPwmStep: status.liveLighting.profile.actualLeimacPwmStep,
    channels: [...status.liveLighting.profile.channels],
    verificationState: "verified",
    expectedWriteCount: 5,
    acknowledgedWriteCount: 4,
    verificationComplete: false,
    lastResponseKinds: ["mock", "mock", "mock", "mock"],
    verifiedAt: "2026-07-17T12:00:00.000Z",
  };
  status.liveLighting.physicalState = {
    state: "unverified",
    reason: "dynamic test incomplete acknowledgement",
    changedAt: "2026-07-17T12:00:00.000Z",
    expectedWriteCount: 5,
    acknowledgedWriteCount: 4,
    complete: false,
    verifiedAt: "2026-07-17T12:00:00.000Z",
  };
  assert.equal(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting).enabled, false);

  status.liveLighting.applied.acknowledgedWriteCount = 5;
  status.liveLighting.applied.verificationComplete = true;
  status.liveLighting.applied.lastResponseKinds = ["mock", "mock", "mock", "mock", "mock"];
  status.liveLighting.physicalState.state = "positioning_light_verified";
  status.liveLighting.physicalState.reason = "dynamic test complete acknowledgement";
  status.liveLighting.physicalState.acknowledgedWriteCount = 5;
  status.liveLighting.physicalState.complete = true;
  assert.deepEqual(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting), {
    enabled: true,
    dutyPercent: status.liveLighting.profile.dutyPercent,
    channels: status.liveLighting.profile.channels,
  });
});

test("a prepared Rapid item is eligible for the one Approve & Publish authority only with normal identity and sign-in", () => {
  assert.equal(aiGraderApproveAndPublishEligible({
    reportReady: true,
    finalReady: true,
    productionSignedIn: true,
    identityReady: true,
    publishStatus: "idle",
  }), true);
  assert.equal(aiGraderApproveAndPublishEligible({
    reportReady: true,
    finalReady: false,
    productionSignedIn: true,
    identityReady: true,
    publishStatus: "idle",
  }), false);
  assert.equal(aiGraderApproveAndPublishEligible({
    reportReady: true,
    finalReady: true,
    productionSignedIn: false,
    identityReady: true,
    publishStatus: "idle",
  }), false);
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
