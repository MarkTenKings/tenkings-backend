const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderPreviewJpegFrameAssembler,
  AiGraderLocalStationBridgeService,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildAiGraderLocalStationBridgeConfig,
  retainAiGraderRapidCaptureQueueItems,
} = require("../dist/drivers/aiGraderLocalStationBridge");

const sourceRoot = path.resolve(__dirname, "../src");
const bridgeSource = fs.readFileSync(path.join(sourceRoot, "drivers/aiGraderLocalStationBridge.ts"), "utf8");
const clientSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/nextjs-app/lib/aiGraderStationBridgeClient.ts"), "utf8");
const operationsSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/nextjs-app/lib/aiGraderStationOperations.ts"), "utf8");
const pageSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/nextjs-app/pages/ai-grader/station.tsx"), "utf8");

function bindLiveFrontPreview(service) {
  const manifest = service.manifest;
  manifest.previewStatus.status = "live";
  manifest.previewStatus.cameraOwnership = "preview_stream";
  manifest.previewStatus.sessionId = manifest.sessionId;
  manifest.previewStatus.activeSide = "front";
  return service.status();
}

function writeReadyRapidReportFixture(reportDir, { frontPackageDir, backPackageDir }) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "manifest.json"), JSON.stringify({
    packageId: "rapid-ready-report-fixture",
    frontPackageDir,
    backPackageDir,
    acceptedLightingProfile: {
      selectedDutyPercent: 1.3,
      actualLeimacPwmStep: 13,
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
    },
  }, null, 2));
  const element = (category, score) => ({
    category,
    status: "provisional_diagnostic",
    score,
    confidence: 0.8,
    confidenceBand: "high",
    primaryMetrics: {},
    warnings: [],
    evidenceRefs: [`analysis.provisionalGradeStory.elementScores.${category}`],
    explanation: `${category} evidence supports this fixture score.`,
  });
  fs.writeFileSync(path.join(reportDir, "analysis.json"), JSON.stringify({
    provisionalGradeStory: {
      status: "provisional_diagnostic_grade",
      provisionalOverallGrade: 8.5,
      confidence: { band: "high", score: 0.85, warnings: [] },
      gates: {
        requiredGatesPassed: true,
        results: [{
          gate: "fixture_evidence",
          status: "pass",
          summary: "The dynamic Rapid fixture has complete source-grade evidence.",
          evidenceRefs: ["analysis.provisionalGradeStory"],
        }],
        blockers: [],
        acceptedWarnings: [],
      },
      elementScores: {
        centering: element("centering", 9.1),
        corners: element("corners", 8.7),
        edges: element("edges", 8.6),
        surface: element("surface", 7.9),
      },
      story: { summary: "Dynamic Rapid finalization fixture.", claims: [] },
      whyNot10: [],
      gradeImpactCandidates: [],
    },
    visionLab: {},
  }, null, 2));
  fs.writeFileSync(
    path.join(reportDir, "provisional-diagnostic-report.html"),
    "<html><body>Rapid Capture dynamic report fixture</body></html>",
  );
}

test("station bridge remains loopback-only, origin-bounded, token-paired, and versioned", () => {
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    allowedOrigins: ["https://collect.tenkings.co"],
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: path.join(os.tmpdir(), "tenkings-station-contract"),
  });
  assert.equal(config.host, "127.0.0.1");
  assert.deepEqual(config.allowedOrigins, ["https://collect.tenkings.co"]);
  assert.equal(AI_GRADER_LOCAL_STATION_BRIDGE_VERSION, "ai-grader-local-station-bridge-v0.9");
  assert.throws(() => buildAiGraderLocalStationBridgeConfig({ ...config, host: "0.0.0.0" }), /loopback/i);
});

test("removed browser shutdown, confirmation, cold, and manual capture systems are absent while Rapid Capture remains", () => {
  for (const removed of [
    "/lighting/safe-off", "/lighting/accept", "/lighting/retry-back-positioning", "/preview/stop",
    "confirm-fixture-rulers", "confirm-light-idle-off", "confirm-flip",
    "manualGeometryRect", "manual_capture", "hardwareSafetyBlocked", "end-session",
  ]) {
    assert.equal(clientSource.includes(removed), false, `client still contains ${removed}`);
    assert.equal(pageSource.includes(removed), false, `page still contains ${removed}`);
  }
  assert.equal(bridgeSource.includes('case "safe-off"'), false);
  assert.equal(bridgeSource.includes('case "confirm-fixture-rulers"'), false);
  assert.equal(bridgeSource.includes('case "confirm-flip"'), false);
  assert.equal(bridgeSource.includes('"end-session"'), false);
  for (const removed of ["AiGraderCaptureAttempt", "createAiGraderCaptureOperationGate", "runAiGraderAtomicCapture"]) {
    assert.equal(operationsSource.includes(removed), false, `browser capture intent system still contains ${removed}`);
  }
  for (const retained of ["configure-rapid-capture", "queue-current-card", "activate-queue-item"]) {
    assert.equal(bridgeSource.includes(retained), true, `bridge missing ${retained}`);
    assert.equal(pageSource.includes(retained), true, `page missing ${retained}`);
  }
  assert.equal(clientSource.includes("buildAiGraderRapidCaptureConfigurationRequest"), true);
  assert.equal(clientSource.includes("buildAiGraderRapidQueueActivationRequest"), true);
  assert.equal(pageSource.includes("Auto Capture"), false);
});

test("Rapid Capture retains every unreviewed item and only trims terminal history", () => {
  const pending = Array.from({ length: 26 }, (_, index) => ({ queueItemId: `pending-${index}`, state: "finalizing" }));
  const terminal = Array.from({ length: 8 }, (_, index) => ({ queueItemId: `published-${index}`, state: "published" }));
  const retained = retainAiGraderRapidCaptureQueueItems([...pending, ...terminal]);
  assert.deepEqual(retained.map((item) => item.queueItemId), pending.map((item) => item.queueItemId));
  const mixed = retainAiGraderRapidCaptureQueueItems([
    ...Array.from({ length: 20 }, (_, index) => ({ queueItemId: `review-${index}`, state: "report_ready_needs_confirm" })),
    ...terminal,
  ]);
  assert.equal(mixed.filter((item) => item.state === "report_ready_needs_confirm").length, 20);
  assert.equal(mixed.filter((item) => item.state === "published").length, 5);
});

test("Start New Card applies the configured positioning light and returns Capture Front lighting-ready", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-start-lighting-"));
  try {
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234",
      outputDir,
      duty: 1.3,
    });
    const service = new AiGraderLocalStationBridgeService(config);
    const started = await service.action("start-session", { captureProfile: "full_forensic" });
    assert.equal(started.liveLighting.status, "on");
    assert.equal(started.liveLighting.physicalState.state, "positioning_light_verified");
    assert.equal(started.liveLighting.applied.verificationComplete, true);
    assert.equal(started.liveLighting.applied.expectedWriteCount, started.liveLighting.applied.acknowledgedWriteCount);
    assert.equal(started.liveLighting.profile.acceptedForCapture, true);
    assert.equal(started.acceptedProfile.source, "bridge_operator");
    const ready = bindLiveFrontPreview(service);
    assert.equal(ready.frontCaptureReadiness.ready, true);
    assert.equal(ready.frontCaptureReadiness.code, "ready");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("failed configured lighting is explicit and a later Start New Card retry succeeds", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-start-lighting-retry-"));
  let writeCall = 0;
  try {
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234",
      outputDir,
      duty: 1.3,
    });
    const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
      writeLightingFrames: async (frames) => {
        writeCall += 1;
        const acknowledged = writeCall === 1 ? frames.slice(0, -1) : frames;
        return acknowledged.map(() => ({ responseKind: "mock", ok: true }));
      },
    });
    await assert.rejects(
      service.action("start-session", { captureProfile: "full_forensic" }),
      /Retry Start New Card/,
    );
    const failed = service.status();
    assert.equal(failed.frontCaptureReadiness.ready, false);
    assert.notEqual(failed.liveLighting.physicalState.state, "positioning_light_verified");
    const retried = await service.action("start-session", { captureProfile: "full_forensic" });
    assert.equal(retried.liveLighting.physicalState.state, "positioning_light_verified");
    assert.equal(retried.liveLighting.applied.expectedWriteCount, retried.liveLighting.applied.acknowledgedWriteCount);
    assert.equal(bindLiveFrontPreview(service).frontCaptureReadiness.ready, true);
    assert.ok(writeCall >= 4, "retry must run bounded failure cleanup, replacement cleanup, and a fresh lighting apply");
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("Rapid Capture detaches the exact card and completes its report in the serialized background queue", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-rapid-queue-"));
  try {
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 47652,
      allowedOrigins: ["https://collect.tenkings.co"],
      stationToken: "StationTokenStationTokenStationToken1234",
      outputDir,
    });
    const service = new AiGraderLocalStationBridgeService(config);
    await service.action("configure-rapid-capture", { rapidCaptureEnabled: true });
    await service.action("start-session", { captureProfile: "full_forensic" });
    const detached = service.manifest;
    const detachedSessionId = detached.sessionId;
    const detachedReportId = detached.reportId;
    detached.outputs.frontPackageDir = path.join(detached.outputs.sessionDir, "front");
    detached.outputs.backPackageDir = path.join(detached.outputs.sessionDir, "back");
    fs.mkdirSync(detached.outputs.frontPackageDir, { recursive: true });
    fs.mkdirSync(detached.outputs.backPackageDir, { recursive: true });
    detached.warmRunnerStatus.phases.push(
      { id: "process_front_artifacts", label: "Front processing", status: "completed", side: "front", backend: "warm_full_forensic_runner", executionPath: "warm_full_forensic_runner" },
      { id: "process_back_artifacts", label: "Back processing", status: "completed", side: "back", backend: "warm_full_forensic_runner", executionPath: "warm_full_forensic_runner" },
    );
    writeReadyRapidReportFixture(path.join(detached.outputs.sessionDir, "mock-unified-report"), {
      frontPackageDir: detached.outputs.frontPackageDir,
      backPackageDir: detached.outputs.backPackageDir,
    });

    const continued = await service.action("queue-current-card");
    assert.notEqual(continued.sessionId, detachedSessionId);
    assert.equal(continued.currentStep, "capture_front");
    assert.equal(continued.rapidCaptureQueue.items[0].sessionId, detachedSessionId);
    assert.equal(continued.rapidCaptureQueue.items[0].reportId, detachedReportId);
    assert.equal(continued.rapidCaptureQueue.items[0].state, "finalizing");
    assert.equal(continued.rapidCaptureQueue.reportWorkerSerialized, true);
    assert.equal(continued.liveLighting.physicalState.state, "positioning_light_verified");
    assert.equal(continued.liveLighting.applied.expectedWriteCount, continued.liveLighting.applied.acknowledgedWriteCount);
    assert.equal(bindLiveFrontPreview(service).frontCaptureReadiness.ready, true);

    let completed;
    for (let index = 0; index < 100; index += 1) {
      const current = service.status().rapidCaptureQueue.items[0];
      if (current?.state === "report_ready_needs_confirm") {
        completed = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(completed, "serialized background report did not become ready");
    assert.equal(completed.autoConfirmed, false);
    assert.equal(completed.autoPublished, false);
    assert.equal("manifestPath" in completed, false);
    const activated = await service.action("activate-queue-item", { queueItemId: completed.queueItemId });
    assert.equal(activated.sessionId, detachedSessionId);
    assert.equal(activated.reportId, detachedReportId);
    assert.equal(activated.currentStep, "label_data_ready");
    assert.equal(activated.productionRelease.finalGradeComputed, true);
    assert.equal(activated.productionRelease.labelDataGenerated, true);
    assert.equal(activated.productionRelease.qrPayloadGenerated, true);
    assert.equal(activated.productionRelease.label.status, "label_data_ready");
    assert.equal(activated.productionRelease.operatorFinalization.operatorId, "rapid-background-preparation");
    assert.equal(activated.safety.finalGradeComputed, true);
    assert.equal(activated.safety.labelGenerated, true);
    assert.equal(activated.productionRelease.label.labelVersion, "ten-kings-ai-grader-label-v0");
    assert.ok(fs.existsSync(activated.outputs.productionReleasePath));
    assert.ok(fs.existsSync(activated.outputs.labelDataPath));
    const approveAndPublishLocallyReady = Boolean(
      activated.reportBundle
      && activated.productionRelease.finalGradeComputed
      && activated.productionRelease.labelDataGenerated
      && activated.productionRelease.label.status === "label_data_ready"
      && activated.outputs.productionReleasePath
      && activated.outputs.labelDataPath,
    );
    assert.equal(approveAndPublishLocallyReady, true);

    const followingCard = await service.action("start-session", { captureProfile: "full_forensic" });
    assert.notEqual(followingCard.sessionId, detachedSessionId);
    assert.equal(followingCard.currentStep, "capture_front");
    assert.equal(followingCard.liveLighting.physicalState.state, "positioning_light_verified");
    assert.equal(bindLiveFrontPreview(service).frontCaptureReadiness.ready, true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("a failed Rapid preparation is isolated to its exact item while the next capture session remains usable", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-rapid-failure-isolation-"));
  try {
    const config = buildAiGraderLocalStationBridgeConfig({
      enabled: true,
      mode: "mock",
      host: "127.0.0.1",
      port: 47652,
      stationToken: "StationTokenStationTokenStationToken1234",
      outputDir,
    });
    const service = new AiGraderLocalStationBridgeService(config);
    await service.action("configure-rapid-capture", { rapidCaptureEnabled: true });
    await service.action("start-session", { captureProfile: "full_forensic" });
    const failedSessionId = service.manifest.sessionId;
    service.manifest.outputs.frontPackageDir = path.join(service.manifest.outputs.sessionDir, "front");
    service.manifest.outputs.backPackageDir = path.join(service.manifest.outputs.sessionDir, "back");
    fs.mkdirSync(service.manifest.outputs.frontPackageDir, { recursive: true });
    fs.mkdirSync(service.manifest.outputs.backPackageDir, { recursive: true });
    const continued = await service.action("queue-current-card");
    assert.notEqual(continued.sessionId, failedSessionId);
    let failed;
    for (let index = 0; index < 100; index += 1) {
      const current = service.status().rapidCaptureQueue.items.find((item) => item.sessionId === failedSessionId);
      if (current?.state === "failed") {
        failed = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(failed, "the incomplete exact Rapid item did not fail closed");
    assert.equal(failed.sessionId, failedSessionId);
    const next = bindLiveFrontPreview(service);
    assert.notEqual(next.sessionId, failedSessionId);
    assert.equal(next.currentStep, "capture_front");
    assert.equal(next.frontCaptureReadiness.ready, true);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("retained bridge invariants remain explicit in production source", () => {
  for (const retained of [
    "captureLock", "serialized lifecycle", "watchdog", "safeOffLiveLighting",
    "expectedSessionId", "expectedReportId", "expectedSideEpoch", "expectedFrameId",
    "stopOrphanedPreviewStreamsUntilReleased", "allowedOrigins",
  ]) assert.equal(bridgeSource.includes(retained), true, `missing retained invariant ${retained}`);
});

test("fixed five-percent ceiling is removed while bounded Leimac conversion remains", () => {
  assert.equal(bridgeSource.includes("maxDutyPercent: 5"), false);
  assert.equal(bridgeSource.includes("LEIMAC_IDMU_MAX_DUTY_PERCENT"), true);
});

test("preview multipart assembler accepts a bounded JPEG frame and rejects unbounded input", () => {
  const assembler = new AiGraderPreviewJpegFrameAssembler();
  const frame = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const payload = Buffer.concat([
    Buffer.from("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 7\r\n\r\n"), frame, Buffer.from("\r\n"),
  ]);
  const frames = assembler.push(payload);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], frame);
  assembler.push(Buffer.alloc(2_000_000));
  assert.ok(assembler.bufferedByteLength < 2_000_000);
});
