import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_GRADER_STATION_STEPS,
  aiGraderAtomicBackQueueReleaseMatches,
  aiGraderApproveAndPublishEligible,
  aiGraderAuthoritativeLiveLightingDraft,
  aiGraderRapidQueueIdentityMatches,
  aiGraderRapidItemPublishable,
  aiGraderReviewActivationAvailable,
  aiGraderStartNewCardAvailable,
  assertAiGraderRapidItemPublishable,
  buildAiGraderLocalStationStatus,
  completeAiGraderExactPublicationHandoff,
  parseAiGraderStationAction,
  sanitizeAiGraderRapidCaptureQueue,
  sanitizeAiGraderPreviewCardGeometry,
  selectNextSerializedAiGraderOcrItem,
} from "../lib/aiGraderLocalStation";
import {
  buildAiGraderQueuedOcrFailureRequest,
  buildAiGraderRapidPublicationEvidence,
  buildAiGraderRapidQueueActivationRequest,
  fetchAiGraderStationBridgeHealth,
} from "../lib/aiGraderStationBridgeClient";
import {
  aiGraderCaptureAssertionFromFrame,
  runAiGraderCapture,
} from "../lib/aiGraderStationOperations";

test("operator station contract exposes the single retained grading workflow", () => {
  const labels = AI_GRADER_STATION_STEPS.map((step) => step.label);
  assert.deepEqual(labels, ["Start New Card", "Capture Front", "Capture Back", "Approve & Publish"]);
  assert.equal(labels.some((label) => /fixture|accept capture|safe off/i.test(label)), false);
});

test("removed browser safety, Single finalization, and separate queue mutation actions are absent", () => {
  for (const action of [
    "safe-off", "confirm-light-idle-off", "confirm-fixture-rulers", "accept-profile", "confirm-flip",
    "configure-rapid-capture", "queue-current-card", "run-diagnostics", "export-report-bundle",
    "calculate-final-grade", "finalize-report", "generate-label-data",
  ]) assert.equal(parseAiGraderStationAction(action), null);
  for (const action of ["activate-queue-item", "begin-queued-ocr", "complete-queued-ocr", "fail-queued-ocr"]) {
    assert.equal(parseAiGraderStationAction(action), action);
  }
  const status = buildAiGraderLocalStationStatus();
  const serialized = JSON.stringify(status);
  for (const removed of ["frontWorkflowAuthority", "lightingProfileAccepted", "coldDebugMode", "fallbackUsed"]) {
    assert.equal(serialized.includes(removed), false, `${removed} must be absent`);
  }
  assert.equal(status.captureProfile, "production_fast");
  assert.deepEqual(status.captureProfileGuard.availableCaptureProfiles, ["production_fast"]);
  assert.equal(status.captureProfileGuard.stationSettingRequired, false);
  assert.equal(status.captureProfileGuard.selectionSource, "bridge_required");
  assert.equal(status.captureProfileGuard.oneRoadProductionFastRequired, true);
  assert.equal(serialized.includes("productionFastOptIn"), false);
  assert.equal(status.rapidCapture.enabled, true);
  assert.equal(status.rapidCaptureQueue.enabled, true);
  assert.equal(status.rapidCaptureQueue.reportWorkerSerialized, true);
  assert.equal(status.liveLighting.safety.maxDutyPercent, 99.9);
  assert.equal(status.liveLighting.safety.watchdogOwnedByBridge, true);
});

test("Rapid Capture queue sanitization preserves bounded report state and strips local paths", () => {
  const queue = sanitizeAiGraderRapidCaptureQueue({
    enabled: true,
    activeQueueItemId: "session-1-rapid-card",
    activeReview: {
      queueItemId: "session-1-rapid-card",
      gradingSessionId: "session-1",
      reportId: "report-1",
      manifest: {
        latestReport: { reportId: "report-1", exists: true },
        reportBundle: {
          reportId: "report-1",
          gradingSessionId: "session-1",
          nested: { normalizedPath: "C:\\TenKings\\private\\normalized.png", safeMeasurement: 8.6 },
        },
        productionRelease: {
          reportId: "report-1",
          gradingSessionId: "session-1",
          nested: { serviceToken: "must-not-survive", safeStatus: "ready" },
        },
      },
    },
    items: [{
      queueItemId: "session-1-rapid-card",
      sessionId: "session-1",
      reportId: "report-1",
      state: "report_ready_needs_confirm",
      queuedAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:01.000Z",
      history: [],
      ocr: {
        state: "succeeded",
        updatedAt: "2026-07-17T12:00:02.000Z",
        attemptCount: 1,
        eligibleAt: "2026-07-17T12:00:00.000Z",
        startedAt: "2026-07-17T12:00:01.000Z",
        completedAt: "2026-07-17T12:00:02.000Z",
        images: ["front", "back"].map((side) => ({
          side,
          artifactRole: "normalized_card",
          fileName: `${side}-normalized-card.png`,
          mimeType: "image/png",
          checksumSha256: side === "front" ? "a".repeat(64) : "b".repeat(64),
          byteSize: 1024,
          widthPx: 1200,
          heightPx: 1680,
        })),
        result: {
          queueItemId: "session-1-rapid-card",
          gradingSessionId: "session-1",
          reportId: "report-1",
          status: "prefill_ready",
        },
      },
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
  assert.equal(queue.items[0].ocr.state, "succeeded");
  assert.equal(queue.items[0].ocr.attemptCount, 1);
  assert.equal(queue.items[0].ocr.result?.reportId, "report-1");
  assert.equal(queue.activeReview?.queueItemId, "session-1-rapid-card");
  assert.equal(queue.activeReview?.gradingSessionId, "session-1");
  assert.equal(queue.activeReview?.reportId, "report-1");
  assert.doesNotMatch(JSON.stringify(queue.activeReview), /normalizedPath|C:\\\\TenKings|serviceToken|must-not-survive/);
  assert.equal((queue.activeReview?.manifest.reportBundle as any)?.nested?.safeMeasurement, 8.6);
});

test("malformed or cross-identity completed OCR becomes one explicit terminal item failure", () => {
  const queue = sanitizeAiGraderRapidCaptureQueue({
    activeQueueItemId: "queue-corrupt",
    activeReview: {
      queueItemId: "queue-corrupt",
      gradingSessionId: "session-corrupt",
      reportId: "report-corrupt",
      manifest: {
        latestReport: { reportId: "report-corrupt", exists: true },
        reportBundle: { reportId: "report-corrupt", gradingSessionId: "session-corrupt" },
        productionRelease: { reportId: "report-corrupt", gradingSessionId: "session-corrupt" },
      },
    },
    items: [{
      queueItemId: "queue-corrupt",
      sessionId: "session-corrupt",
      reportId: "report-corrupt",
      state: "report_ready_needs_confirm",
      queuedAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:02.000Z",
      history: [],
      ocr: {
        state: "succeeded",
        updatedAt: "2026-07-17T12:00:02.000Z",
        attemptCount: 1,
        completedAt: "2026-07-17T12:00:02.000Z",
        result: {
          queueItemId: "queue-other",
          gradingSessionId: "session-corrupt",
          reportId: "report-corrupt",
          status: "prefill_ready",
        },
      },
    }],
  });
  assert.equal(queue.items[0].state, "failed");
  assert.equal(queue.items[0].ocr.state, "failed");
  assert.equal(queue.items[0].ocr.failure?.code, "AI_GRADER_OCR_PERSISTED_STATE_INVALID");
  assert.match(queue.items[0].error ?? "", /will not retry automatically/);
  assert.equal(queue.activeReview, undefined);
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
    itemState: "report_ready_needs_confirm",
    reportReady: true,
    finalReady: true,
    productionSignedIn: true,
    identityReady: true,
    publishStatus: "idle",
  }), true);
  assert.equal(aiGraderApproveAndPublishEligible({
    itemState: "report_ready_needs_confirm",
    reportReady: true,
    finalReady: false,
    productionSignedIn: true,
    identityReady: true,
    publishStatus: "idle",
  }), false);
  assert.equal(aiGraderApproveAndPublishEligible({
    itemState: "report_ready_needs_confirm",
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

test("Start New Card depends only on authoritative capture and lighting ownership", () => {
  const authoritative = {
    bridgeConnected: true,
    captureBusy: false,
    lightingRequestPending: false,
    captureLockHeld: false,
    warmRunnerStatus: "processing" as const,
    currentStep: "start_new_card" as const,
  };
  assert.equal(aiGraderStartNewCardAvailable(authoritative), true);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, captureLockHeld: true }), false);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, currentStep: "capture_back" }), false);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, currentStep: "session_complete" }), false);
  assert.equal(aiGraderStartNewCardAvailable({ ...authoritative, lightingRequestPending: true }), false);
});

test("queued OCR selects one eligible item only when no exact item is already in flight", () => {
  const eligible = {
    queueItemId: "queue-eligible",
    sessionId: "session-eligible",
    reportId: "report-eligible",
    state: "finalizing" as const,
    queuedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    history: [],
    humanConfirmationRequired: true as const,
    autoConfirmed: false as const,
    autoPublished: false as const,
    ocr: {
      state: "eligible" as const,
      updatedAt: "2026-07-18T12:00:00.000Z",
      attemptCount: 0 as const,
    },
  };
  const inFlight = {
    ...eligible,
    queueItemId: "queue-in-flight",
    sessionId: "session-in-flight",
    reportId: "report-in-flight",
    ocr: {
      ...eligible.ocr,
      state: "in_flight" as const,
      attemptCount: 1 as const,
    },
  };
  assert.equal(selectNextSerializedAiGraderOcrItem([eligible])?.queueItemId, eligible.queueItemId);
  assert.equal(selectNextSerializedAiGraderOcrItem([eligible, inFlight]), undefined);
  const oldest = {
    ...eligible,
    queueItemId: "queue-oldest",
    sessionId: "session-oldest",
    reportId: "report-oldest",
    queuedAt: "2026-07-18T11:59:58.000Z",
  };
  const tiedFirst = {
    ...eligible,
    queueItemId: "queue-a",
    sessionId: "session-a",
    reportId: "report-a",
  };
  const tiedSecond = {
    ...eligible,
    queueItemId: "queue-b",
    sessionId: "session-b",
    reportId: "report-b",
  };
  assert.equal(
    selectNextSerializedAiGraderOcrItem([eligible, oldest])?.queueItemId,
    oldest.queueItemId,
    "the serialized conveyor claims the oldest eligible card even when the helper prepends newer items",
  );
  assert.equal(
    selectNextSerializedAiGraderOcrItem([tiedSecond, tiedFirst])?.queueItemId,
    tiedFirst.queueItemId,
    "equal queued timestamps use the queue identity as a deterministic tie-breaker",
  );
});

test("Back cannot report clean capture release until the exact queue identity exists", () => {
  const status = buildAiGraderLocalStationStatus();
  const exact = { gradingSessionId: "session-atomic", reportId: "report-atomic" };
  assert.equal(aiGraderAtomicBackQueueReleaseMatches({ status, ...exact }), false);
  status.rapidCaptureQueue.items = [{
    queueItemId: "queue-atomic",
    sessionId: exact.gradingSessionId,
    reportId: exact.reportId,
    state: "finalizing",
    queuedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    history: [],
    humanConfirmationRequired: true,
    autoConfirmed: false,
    autoPublished: false,
    ocr: {
      state: "waiting_for_normalized",
      updatedAt: "2026-07-18T12:00:00.000Z",
      attemptCount: 0,
    },
  }];
  assert.equal(aiGraderAtomicBackQueueReleaseMatches({ status, ...exact }), true);
  assert.equal(aiGraderAtomicBackQueueReleaseMatches({
    status,
    gradingSessionId: "session-other",
    reportId: exact.reportId,
  }), false);
});

test("published local items are read-only before hosted mutation while another ready item remains publishable", () => {
  let hostedCalls = 0;
  const enterHostedPublish = (state: "published" | "report_ready_needs_confirm") => {
    assertAiGraderRapidItemPublishable(state);
    hostedCalls += 1;
  };

  assert.equal(aiGraderRapidItemPublishable("published"), false);
  assert.throws(() => enterHostedPublish("published"), /unpublished exact item ready for review/i);
  assert.equal(hostedCalls, 0);
  assert.equal(aiGraderRapidItemPublishable("report_ready_needs_confirm"), true);
  assert.equal(aiGraderRapidItemPublishable("confirmed_needs_publish"), true);
  enterHostedPublish("report_ready_needs_confirm");
  assert.equal(hostedCalls, 1);
});

test("queue review activation requires the exact queue, grading-session, and report identity", () => {
  assert.deepEqual(buildAiGraderRapidQueueActivationRequest({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  }), {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  });
  assert.throws(() => buildAiGraderRapidQueueActivationRequest({
    queueItemId: "queue-1",
    gradingSessionId: "",
    reportId: "report-1",
  }), /gradingSessionId is invalid/);
});

test("one synchronous publication claim freezes review selection but never owns capture", () => {
  const cardOne = {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  };
  assert.equal(aiGraderReviewActivationAvailable(null), true);
  assert.equal(aiGraderReviewActivationAvailable(cardOne), false);
  assert.equal(aiGraderRapidQueueIdentityMatches(cardOne, { ...cardOne }), true);
  for (const drift of [
    { ...cardOne, queueItemId: "queue-2" },
    { ...cardOne, gradingSessionId: "session-2" },
    { ...cardOne, reportId: "report-2" },
  ]) {
    assert.equal(aiGraderRapidQueueIdentityMatches(cardOne, drift), false);
  }

  assert.equal(aiGraderStartNewCardAvailable({
    bridgeConnected: true,
    captureBusy: false,
    lightingRequestPending: false,
    captureLockHeld: false,
    warmRunnerStatus: "processing",
    currentStep: "start_new_card",
  }), true, "a hosted publication claim is not part of camera ownership");
});

test("validated hosted publication acknowledges only the exact local item once before route verification failure", async () => {
  const selected = {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
  };
  const other = {
    queueItemId: "queue-2",
    gradingSessionId: "session-2",
    reportId: "report-2",
  };
  const acknowledged: typeof selected[] = [];
  const events: string[] = [];

  await assert.rejects(
    completeAiGraderExactPublicationHandoff({
      identity: selected,
      async acknowledgeExactLocalItem(identity) {
        events.push(`ack:${identity.queueItemId}`);
        acknowledged.push({ ...identity });
      },
      async verifyPublishedRoute(reportId) {
        events.push(`verify:${reportId}`);
        throw new Error("public route propagation delayed");
      },
    }),
    /public route propagation delayed/,
  );

  assert.deepEqual(events, ["ack:queue-1", "verify:report-1"]);
  assert.deepEqual(acknowledged, [selected]);
  assert.equal(acknowledged.some((identity) => aiGraderRapidQueueIdentityMatches(identity, other)), false);
});

test("selected publication evidence repeats only the exact activated identity after hosted success", () => {
  assert.deepEqual(buildAiGraderRapidPublicationEvidence({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    publishedAt: "2026-07-18T12:00:00.000Z",
  }), {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    publication: {
      queueItemId: "queue-1",
      gradingSessionId: "session-1",
      reportId: "report-1",
      publicationStatus: "published",
      publishedAt: "2026-07-18T12:00:00.000Z",
    },
  });
});

test("queued OCR terminal failure uses the helper's canonical exact failure body", () => {
  const body = buildAiGraderQueuedOcrFailureRequest({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    failure: { code: "AI_GRADER_OCR_INTERNAL_FAILED", message: "Hosted OCR failed once." },
  });
  assert.deepEqual(body, {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    failure: { code: "AI_GRADER_OCR_INTERNAL_FAILED", message: "Hosted OCR failed once." },
  });
  assert.equal("ocrFailure" in body, false);
  assert.throws(() => buildAiGraderQueuedOcrFailureRequest({
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: "report-1",
    failure: { code: "AI_GRADER_OCR_PREFILL_FAILED", message: "Unsupported code." },
  }), /terminal failure evidence is invalid/);
});

test("production station rejects a version-compatible mock or contract bridge", async () => {
  await assert.rejects(
    fetchAiGraderStationBridgeHealth(
      { baseUrl: "http://127.0.0.1:47652" },
      (async () => new Response(JSON.stringify({
        ok: true,
        bridgeVersion: "ai-grader-local-station-bridge-v0.10",
        reportProducerContractVersion: "ai-grader-report-producer-v0.2",
        mode: "mock",
        hardwareActionsEnabled: false,
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    ),
    /requires the real paired Dell helper/,
  );
});

test("station source has no Single route, separate queue mutation, OCR retry, duplicate next control, or hosted mock station API", () => {
  const source = readFileSync(new URL("../pages/ai-grader/station.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /stationCaptureMode|configure-rapid-capture|queue-current-card|retryOcrPrefill|Retry OCR|Start Next Grade|callStationContract/);
  const startBlock = source.slice(source.indexOf("const startNewCard"), source.indexOf("const runStationCapture"));
  const backBlock = source.slice(source.indexOf("const captureBackAndContinue"), source.indexOf("const activateRapidQueueItem"));
  const prepublicationCardBlock = source.slice(source.indexOf("const createCardFromConfirmedIdentity"), source.indexOf("const searchCardItems"));
  const activationBlock = source.slice(source.indexOf("const activateRapidQueueItem"), source.indexOf("const productionReleaseBody"));
  const hostedPublishBlock = source.slice(source.indexOf("const publishToTenKingsSystem"), source.indexOf("const approveAndPublish"));
  const publicationBlock = source.slice(source.indexOf("const approveAndPublish"), source.indexOf("const loadFinishReportBundle"));
  const finishNavigationBlock = source.slice(
    source.indexOf('<div className="finish-top-actions">'),
    source.indexOf('</div>', source.indexOf('<div className="finish-top-actions">')),
  );
  assert.doesNotMatch(startBlock, /resetReviewUiState|setIdentityDraft|setSelectedCard/);
  assert.doesNotMatch(backBlock, /resetReviewUiState|setIdentityDraft|setSelectedCard/);
  assert.doesNotMatch(startBlock, /publicationReviewClaim/);
  assert.ok(
    activationBlock.indexOf("publicationReviewClaimRef.current") < activationBlock.indexOf("await runAction"),
    "review selection checks the synchronous publication claim before bridge activation",
  );
  assert.ok(
    activationBlock.indexOf("aiGraderRapidItemPublishable(item.state)") < activationBlock.indexOf("await runAction"),
    "published items stop before local review activation",
  );
  assert.ok(
    prepublicationCardBlock.indexOf("assertAiGraderRapidItemPublishable") < prepublicationCardBlock.indexOf("productionAuthHeaders"),
    "published items stop before card creation authentication or mutation",
  );
  assert.ok(
    hostedPublishBlock.indexOf("assertAiGraderRapidItemPublishable") < hostedPublishBlock.indexOf("publish-init"),
    "published items stop before hosted upload initialization",
  );
  assert.ok(
    publicationBlock.indexOf("assertAiGraderRapidItemPublishable") < publicationBlock.indexOf("publicationReviewClaimRef.current = publicationIdentity") &&
      publicationBlock.indexOf("publicationReviewClaimRef.current = publicationIdentity") < publicationBlock.indexOf("await createCardFromConfirmedIdentity"),
    "Approve & Publish claims the exact selected triple before its first hosted wait",
  );
  assert.doesNotMatch(source, /RAPID_REVIEWABLE_STATES[^;]+published/);
  assert.match(source, /disabled=\{!canApproveAndPublish \|\| Boolean\(publicationReviewClaim\)/);
  assert.match(finishNavigationBlock, /onClick=\{\(\) => setWorkArea\("grade"\)\}/);
  assert.doesNotMatch(
    finishNavigationBlock.slice(0, finishNavigationBlock.indexOf("Back to Grading")),
    /disabled=/,
    "hosted Finish work must not disable navigation back to capture",
  );
  assert.doesNotMatch(prepublicationCardBlock, /run-comps|launchConfirmedCardComps|downstreamComps|shouldStart/);
  assert.match(source, /OCR failure persistence failed for queue/);
  assert.doesNotMatch(source, /action: "fail-queued-ocr",[\s\S]{0,500}\.catch\(\(\) => null\)/);
  assert.equal(existsSync(new URL("../pages/api/ai-grader/station/[...action].ts", import.meta.url)), false);
});

test("prepublication card linkage cannot create a hosted report, valuation, or Finish job", () => {
  const source = readFileSync(new URL("../lib/server/aiGraderProductionApi.ts", import.meta.url), "utf8");
  const createBlock = source.slice(
    source.indexOf("export async function createAiGraderCardFromReportRuntime"),
    source.indexOf("export async function finalizeAiGraderSlabbedPhotoUploadRuntime"),
  );
  assert.doesNotMatch(createBlock, /aiGraderReport|aiGraderValuation|linkConfirmedAiGraderCardTx|run-comps|Finish/);
  const labelRuntime = readFileSync(new URL("../lib/server/aiGraderLabelSheetRuntime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(labelRuntime, /linkConfirmedAiGraderCardTx|workflowStatus:\s*"queued"/);
});
