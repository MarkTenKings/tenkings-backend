const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderLocalStationBridgeService,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildAiGraderLocalStationBridgeConfig,
  startAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const { buildAiGraderStationRealCommandPlan } = require("../dist/drivers/aiGraderStationWorkflow");
const { runCaptureHelperCli } = require("../dist/cli");

function outputDir(label) {
  return path.join(os.tmpdir(), `tenkings-ai-grader-station-bridge-${label}`);
}

function mockConfig(overrides = {}) {
  return buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    stationToken: "local-dev-token",
    outputDir: outputDir("mock"),
    ...overrides,
  });
}

function realConfig(overrides = {}) {
  return buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "real",
    stationToken: "1234567890abcdef",
    outputDir: outputDir("real"),
    apply: true,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    leimacHost: "169.254.191.156",
    leimacPort: 1000,
    ...overrides,
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fullEvidenceRoleIds() {
  return [
    "dark_control",
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ];
}

function makeFakeWarmRunner(options = {}) {
  const calls = [];
  return {
    calls,
    runner: {
      async captureSide(input) {
        calls.push({ type: "capture", side: input.side, input });
        if (options.onCaptureStarted) options.onCaptureStarted(input);
        if (options.captureDelay) await options.captureDelay(input);
        if (options.captureError) throw options.captureError;
        return {
          executionPath: "warm_full_forensic_runner",
          fallbackUsed: false,
          packageId: `${input.side}-package`,
          packageDir: `${input.side}-package`,
          sideDir: `${input.side}-package/${input.side}`,
          side: input.side,
          activeLightingProfile: input.activeLightingProfile,
          batch: {
            executionPath: "warm_full_forensic_runner",
            fallbackUsed: false,
            side: input.side,
            outputDir: `${input.side}-package/${input.side}`,
            cameraIndex: input.cameraIndex ?? 0,
            persistentBaslerSession: true,
            persistentLeimacSession: true,
            selectedChannels: input.activeLightingProfile.selectedChannels,
            dutyTenthsPercent: Math.round(input.activeLightingProfile.selectedDutyPercent * 10),
            captures: {},
          },
          exposureUs: input.exposureUs,
          gain: input.gain,
        };
      },
      async processSide(batch) {
        calls.push({ type: "process", side: batch.side, batch });
        if (options.processDelay) await options.processDelay(batch);
        if (options.processError) throw options.processError;
        return {
          executionPath: "warm_full_forensic_runner",
          fallbackUsed: false,
          packageId: batch.packageId,
          packageDir: batch.packageDir,
          manifestPath: path.join(batch.packageDir, "manifest.json"),
          analysisPath: path.join(batch.packageDir, "analysis.json"),
          previewReportPath: path.join(batch.packageDir, "preview-report.html"),
          manifest: {
            executionPath: "warm_full_forensic_runner",
            fallbackUsed: false,
            evidenceSide: batch.side,
          },
        };
      },
    },
  };
}

test("station bridge config is explicit, local-only, and real mode is gated", () => {
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ mode: "mock", outputDir: outputDir("disabled") }, {}),
    /enable-local-station/
  );
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, host: "0.0.0.0", outputDir: outputDir("bad-host") }, {}),
    /loopback/
  );
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, mode: "real", stationToken: "short", outputDir: outputDir("short-token") }, {}),
    /token/
  );
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, mode: "real", stationToken: "1234567890abcdef", outputDir: outputDir("no-apply") }, {}),
    /--apply/
  );

  const config = realConfig();
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 47652);
  assert.equal(config.localOnly, true);
  assert.equal(config.mode, "real");
});

test("station bridge config accepts separate pairing code and keeps it distinct from station token", () => {
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "real",
    outputDir: outputDir("pairing-config"),
    apply: true,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    leimacHost: "169.254.191.156",
  }, {
    AI_GRADER_STATION_BRIDGE_TOKEN: "1234567890abcdef",
    AI_GRADER_STATION_PAIRING_CODE: "pairing-code-123456",
    AI_GRADER_STATION_PAIRING_EXPIRES_AT: "2099-01-01T00:00:00.000Z",
  });

  assert.equal(config.stationToken, "1234567890abcdef");
  assert.equal(config.stationPairingCode, "pairing-code-123456");
  assert.notEqual(config.stationPairingCode, config.stationToken);
  assert.equal(config.stationPairingExpiresAt, "2099-01-01T00:00:00.000Z");
  assert.throws(
    () => buildAiGraderLocalStationBridgeConfig({ enabled: true, mode: "mock", stationPairingCode: "short", outputDir: outputDir("short-pairing") }, {}),
    /pairing code/
  );
});

test("station bridge HTTP health and pairing support production web auto-connect without production service token", async () => {
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: "local-station-token-123",
    stationPairingCode: "pairing-code-123456",
    stationPairingExpiresAt: "2099-01-01T00:00:00.000Z",
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`http-pairing-${Date.now()}`),
  });
  try {
    const health = await fetch(`${started.url}/health`, {
      headers: {
        Origin: "https://collect.tenkings.co",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "https://collect.tenkings.co");
    assert.equal(health.headers.get("access-control-allow-private-network"), "true");
    const healthBody = await health.json();
    assert.equal(healthBody.pairingAvailable, true);
    assert.equal(healthBody.tokenRequired, true);
    assert.equal(healthBody.stationToken, undefined);

    const rejected = await fetch(`${started.url}/pair`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: "wrong-pairing-code" }),
    });
    assert.equal(rejected.status, 403);

    const paired = await fetch(`${started.url}/pair`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: "pairing-code-123456" }),
    });
    assert.equal(paired.status, 200);
    const pairedBody = await paired.json();
    assert.equal(pairedBody.result.stationToken, "local-station-token-123");
    assert.equal(pairedBody.result.tokenStorage, "browser_localStorage_only");

    const secondPair = await fetch(`${started.url}/pair`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: "pairing-code-123456" }),
    });
    assert.equal(secondPair.status, 403);

    const status = await fetch(`${started.url}/status`, {
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-123" },
    });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.result.localOnly, true);
    assert.equal(statusBody.result.safety.databaseWrites, false);
  } finally {
    await closeServer(started.server);
  }
});

test("station bridge preview status and stream are token-gated and local-only", async () => {
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: "local-station-token-456",
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`http-preview-${Date.now()}`),
  });
  try {
    const unauthorizedStatus = await fetch(`${started.url}/preview/status`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorizedStatus.status, 401);
    await unauthorizedStatus.text();

    const status = await fetch(`${started.url}/preview/status`, {
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456" },
    });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.result.localOnly, true);
    assert.equal(statusBody.result.browserEmbedded, true);
    assert.equal(statusBody.result.tokenRequired, true);
    assert.equal(statusBody.result.safety.publicRouteExposed, false);
    assert.equal(statusBody.result.safety.productionServiceTokenUsed, false);

    const unauthorizedStream = await fetch(`${started.url}/preview/stream`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorizedStream.status, 401);
    await unauthorizedStream.text();

    const unauthorizedStop = await fetch(`${started.url}/preview/stop`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ reason: "test unauthorized stop" }),
    });
    assert.equal(unauthorizedStop.status, 401);
    await unauthorizedStop.text();

    const streamChunk = await new Promise((resolve, reject) => {
      let settled = false;
      const req = http.request(`${started.url}/preview/stream`, {
        headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456" },
      }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers["content-type"] ?? "", /multipart\/x-mixed-replace/);
        res.once("data", (chunk) => {
          settled = true;
          res.destroy();
          req.destroy();
          resolve(Buffer.from(chunk));
        });
      });
      req.on("error", (error) => {
        if (!settled) reject(error);
      });
      req.setTimeout(5000, () => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new Error("Preview stream did not return a frame."));
      });
      req.end();
    });
    assert.match(streamChunk.toString("utf8"), /tenkings-ai-grader-preview/);
    await new Promise((resolve) => setTimeout(resolve, 25));

    let activeReq;
    const activeStreamClosed = new Promise((resolve, reject) => {
      let sawFrame = false;
      activeReq = http.request(`${started.url}/preview/stream`, {
        headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456" },
      }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => {
          sawFrame = true;
        });
        res.once("close", () => {
          if (!sawFrame) reject(new Error("Preview stop closed stream before any frame was observed."));
          else resolve();
        });
      });
      activeReq.on("error", (error) => {
        if (!sawFrame) reject(error);
      });
      activeReq.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stop = await fetch(`${started.url}/preview/stop`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": "local-station-token-456", "content-type": "application/json" },
      body: JSON.stringify({ reason: "operator starting front full forensic capture" }),
    });
    assert.equal(stop.status, 200);
    const stopBody = await stop.json();
    assert.equal(stopBody.operation, "preview-stop");
    assert.equal(stopBody.result.cameraOwnership, "released");
    await activeStreamClosed;
    activeReq.destroy();
  } finally {
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("station bridge live lighting endpoints are token-gated and validate duty and channels", async () => {
  const token = "local-station-token-lighting";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`http-lighting-${Date.now()}`),
  });
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  try {
    const unauthorizedStatus = await fetch(`${started.url}/lighting/status`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorizedStatus.status, 401);
    await unauthorizedStatus.text();

    const unauthorizedApply = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers: { Origin: "https://collect.tenkings.co", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, dutyPercent: 1.2, channels: [1] }),
    });
    assert.equal(unauthorizedApply.status, 401);
    await unauthorizedApply.text();

    const status = await fetch(`${started.url}/lighting/status`, { headers });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.result.localOnly, true);
    assert.equal(statusBody.result.tokenRequired, true);
    assert.equal(statusBody.result.safety.publicRouteExposed, false);
    assert.equal(statusBody.result.safety.productionServiceTokenUsed, false);
    assert.equal(statusBody.result.safety.maxDutyPercent, 5);

    const applyBeforeSession = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 1.2, channels: [1, 2] }),
    });
    assert.equal(applyBeforeSession.status, 400);

    const startSession = await fetch(`${started.url}/actions/start-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(startSession.status, 200);

    const highDuty = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 5.1, channels: [1, 2] }),
    });
    assert.equal(highDuty.status, 400);
    assert.match(await highDuty.text(), /0 to 5 percent/);

    const badChannels = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 1.2, channels: [1, 1] }),
    });
    assert.equal(badChannels.status, 400);
    assert.match(await badChannels.text(), /channels/);

    const applied = await fetch(`${started.url}/lighting/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true, dutyPercent: 1.4, channels: [1, 3, 5] }),
    });
    assert.equal(applied.status, 200);
    const appliedBody = await applied.json();
    assert.equal(appliedBody.operation, "lighting-apply");
    assert.equal(appliedBody.result.status, "on");
    assert.equal(appliedBody.result.applied.actualLeimacPwmStep, 14);
    assert.deepEqual(appliedBody.result.applied.channels, [1, 3, 5]);

    const heartbeat = await fetch(`${started.url}/lighting/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "test heartbeat" }),
    });
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = await heartbeat.json();
    assert.ok(heartbeatBody.result.watchdog.expiresAt);

    const accepted = await fetch(`${started.url}/lighting/accept`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dutyPercent: 1.4, channels: [1, 3, 5], exposureUs: 47000, gain: 0 }),
    });
    assert.equal(accepted.status, 200);
    const stationStatus = await fetch(`${started.url}/status`, { headers });
    const stationStatusBody = await stationStatus.json();
    assert.equal(stationStatusBody.result.acceptedProfile.source, "browser_live_tuning");
    assert.deepEqual(stationStatusBody.result.acceptedProfile.channels, [1, 3, 5]);
    assert.equal(stationStatusBody.result.acceptedProfile.dutyPercent, 1.4);

    const safeOff = await fetch(`${started.url}/lighting/safe-off`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "test all off" }),
    });
    assert.equal(safeOff.status, 200);
    const safeOffBody = await safeOff.json();
    assert.equal(safeOffBody.result.applied.enabled, false);
    assert.equal(safeOffBody.result.status, "safe_off");
  } finally {
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("real station command plan still uses full forensic front/back evidence packages", () => {
  const plan = buildAiGraderStationRealCommandPlan({
    outputDir: outputDir("forensic-plan"),
    leimacHost: "169.254.191.156",
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    operatorConfirmedLightIdleOff: true,
    operatorConfirmedFixtureRulersVisible: true,
    operatorFlipConfirmed: true,
  });
  const front = plan.find((step) => step.id === "capture_front");
  const back = plan.find((step) => step.id === "capture_back");
  assert.ok(front);
  assert.ok(back);
  assert.equal(front.args[0], "ai-grader-fixed-rig-v1-evidence-package");
  assert.equal(back.args[0], "ai-grader-fixed-rig-v1-evidence-package");
  assert.deepEqual(front.args.slice(front.args.indexOf("--evidence-side") + 1, front.args.indexOf("--evidence-side") + 2), ["front"]);
  assert.deepEqual(back.args.slice(back.args.indexOf("--evidence-side") + 1, back.args.indexOf("--evidence-side") + 2), ["back"]);
  assert.equal(front.label.includes("evidence package"), true);
  assert.equal(back.label.includes("evidence package"), true);
  assert.equal(plan.find((step) => step.id === "unified_report")?.required, true);
  assert.equal(JSON.stringify(plan).includes("fast"), false);
});

test("mock station bridge runs staged workflow without claiming hardware", async () => {
  const bundleRoot = outputDir(`canonical-report-bundles-${Date.now()}`);
  const service = new AiGraderLocalStationBridgeService(mockConfig({ reportBundleOutputDir: bundleRoot }));

  let status = service.status();
  assert.equal(status.bridgeVersion, AI_GRADER_LOCAL_STATION_BRIDGE_VERSION);
  assert.equal(status.hardwareActionsEnabled, false);
  assert.equal(status.safety.hardwareAccessed, false);
  assert.equal(status.warmRunnerStatus.mode, "full_forensic");
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.backend, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.fallback.active, false);
  assert.equal(status.warmRunnerStatus.fallback.available, true);
  assert.equal(status.warmRunnerStatus.safety.captureLock, true);
  assert.equal(status.warmRunnerStatus.safety.watchdogSafeOff, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnFailure, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnCancellation, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnSessionEnd, true);
  assert.equal(status.warmRunnerStatus.safety.publicRouteExposed, false);
  assert.equal(status.warmRunnerStatus.safety.productionServiceTokenUsed, false);
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.front.map((role) => role.role), fullEvidenceRoleIds());
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.back.map((role) => role.role), fullEvidenceRoleIds());

  status = await service.action("start-session");
  assert.equal(status.currentStep, "verify_fixture_rulers");
  assert.ok(status.outputs.sessionDir);
  assert.equal(status.warmRunnerStatus.phases.some((phase) => phase.id === "warm_session_setup"), true);

  await assert.rejects(() => service.action("launch-preview"), /fixture\/rulers/);

  status = await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  assert.equal(status.confirmations.lightIdleOff, true);
  status = await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  assert.equal(status.confirmations.fixtureRulersVisible, true);
  status = await service.action("launch-preview");
  assert.equal(status.outputs.previewPackageDir?.includes("mock-operator_preview"), true);

  status = await service.action("accept-profile", {
    acceptedProfile: { dutyPercent: 1.4, exposureUs: 45000, gain: 0, channels: [1, 2, 3, 4, 5, 6, 7, 8] },
  });
  assert.equal(status.acceptedProfile.dutyPercent, 1.4);
  assert.equal(status.acceptedProfile.actualLeimacPwmStep, 14);

  status = await service.action("capture-front");
  assert.equal(status.sessionManifest.frontCaptured, true);
  assert.equal(status.warmRunnerStatus.captureLock.held, false);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, true);
  assert.ok(status.warmRunnerStatus.previewPolicy.lastHoldStartedAt);
  assert.equal(status.warmRunnerStatus.previewPolicy.lastResumeReadyAt, undefined);
  assert.equal(status.warmRunnerStatus.evidencePlan.rolesBySide.front.every((role) => role.status === "completed"), true);
  assert.equal(status.warmRunnerStatus.evidencePlan.rolesBySide.back.every((role) => role.status === "pending"), true);
  assert.equal(status.warmRunnerStatus.queues.capture.some((phase) => phase.id === "capture_front" && phase.status === "completed"), true);
  assert.equal(status.warmRunnerStatus.queues.processing.some((phase) => phase.id === "process_front_artifacts" && phase.status === "completed"), true);
  await assert.rejects(() => service.action("capture-back"), /flip/);

  status = await service.action("confirm-flip", { confirmations: { flipComplete: true } });
  assert.equal(status.confirmations.flipComplete, true);
  status = await service.action("capture-back");
  assert.equal(status.sessionManifest.backCaptured, true);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, true);
  assert.equal(status.warmRunnerStatus.evidencePlan.rolesBySide.back.every((role) => role.status === "completed"), true);
  assert.equal(status.warmRunnerStatus.queues.processing.some((phase) => phase.id === "process_back_artifacts" && phase.status === "completed"), true);
  status = await service.action("run-diagnostics");
  assert.equal(status.latestReport.exists, true);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, true);
  assert.equal(status.warmRunnerStatus.queues.report.some((phase) => phase.id === "report_queue" && phase.status === "completed"), true);
  assert.equal(status.timingSummary.detailedEntries.some((entry) => entry.category === "warm_runner"), true);
  assert.equal(status.timingSummary.executionPath, "warm_full_forensic_runner");
  assert.equal(status.timingSummary.fallbackUsed, false);
  assert.match(status.timingSummary.targetInterCaptureNote, /full forensic evidence preserved/i);
  const warmSessionManifest = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.equal(warmSessionManifest.executionPath, "warm_full_forensic_runner");
  assert.equal(warmSessionManifest.fallbackUsed, false);
  const resolvedReport = await service.reportBundle(status.latestReport.reportId);
  assert.equal(resolvedReport.reportId, status.latestReport.reportId);
  assert.equal(resolvedReport.bundle.finalGradeComputed, false);
  const history = await service.reportHistory();
  assert.equal(history.items.some((item) => item.reportId === status.latestReport.reportId), true);
  assert.equal(history.stats.allTime >= 1, true);
  status = await service.action("export-report-bundle");
  assert.ok(status.outputs.reportBundlePath);
  const reportId = status.latestReport.reportId;
  const publishPackageDir = path.join(bundleRoot, reportId);
  assert.equal(status.outputs.publishPackageDir, publishPackageDir);
  assert.equal(status.outputs.reportBundlePath, path.join(publishPackageDir, "report-bundle.json"));
  assert.equal(status.outputs.assetManifestPath, path.join(publishPackageDir, "asset-manifest.json"));
  assert.equal(status.outputs.checksumsPath, path.join(publishPackageDir, "checksums.json"));
  assert.equal(fs.existsSync(status.outputs.reportBundlePath), true);
  assert.equal(fs.existsSync(path.join(bundleRoot, "report-bundle.json")), false);
  assert.equal(status.safety.finalGradeComputed, false);
  assert.equal(status.safety.certifiedClaim, false);
  status = await service.action("calculate-final-grade", {
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Bridge test warning acceptance.",
  });
  assert.ok(status.outputs.productionReleasePath);
  assert.ok(status.outputs.labelDataPath);
  assert.equal(path.dirname(status.outputs.productionReleasePath), publishPackageDir);
  assert.equal(status.outputs.labelDataPath, path.join(publishPackageDir, "label-data.json"));
  assert.equal(fs.existsSync(path.join(publishPackageDir, "production-release.json")), true);
  assert.equal(fs.existsSync(path.join(publishPackageDir, "label-data.json")), true);
  const canonicalResolved = await service.reportBundle(reportId);
  assert.equal(canonicalResolved.source, "canonical_publish_package");
  assert.equal(canonicalResolved.bundle.reportId, reportId);
  assert.equal(canonicalResolved.bundle.productionRelease?.reportId, reportId);
  assert.ok(canonicalResolved.bundle.productionRelease?.label?.status);
  assert.equal(status.safety.certifiedClaim, false);
  assert.equal(status.safety.certificateGenerated, false);
  const release = JSON.parse(fs.readFileSync(status.outputs.productionReleasePath, "utf8"));
  assert.equal(release.databaseIntegration.productionDbWritesPerformed, false);
  assert.equal(release.storageIntegration.uploadPerformed, false);
});

test("browser live lighting safe-offs on capture start and records safety event", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig({
    outputDir: outputDir(`lighting-capture-safeoff-${Date.now()}`),
  }));

  await service.action("start-session");
  await service.applyLiveLighting({ enabled: true, dutyPercent: 1.2, channels: [1, 2, 3] });
  assert.equal(service.status().liveLighting.applied.enabled, true);
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const status = await service.action("capture-front");

  assert.equal(status.liveLighting.applied.enabled, false);
  assert.equal(status.liveLighting.safetyEvents.some((event) => event.type === "capture_start_safe_off" && event.ok), true);
  const sessionManifest = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.equal(sessionManifest.liveLighting.applied.enabled, false);
  assert.equal(sessionManifest.liveLighting.safetyEvents.some((event) => event.type === "capture_start_safe_off"), true);
});

test("accepted browser live lighting profile is passed to warm capture", async () => {
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      if (step.id === "unified_report") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: { report: { packageDir: "unified-report", reportPath: "unified-report/provisional-diagnostic-report.html" } },
        };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(realConfig({
    outputDir: outputDir(`lighting-accepted-${Date.now()}`),
  }), runner, warm.runner);

  await service.action("start-session");
  await service.acceptLiveLightingForCapture({ dutyPercent: 1.7, channels: [2, 4, 6, 8], exposureUs: 46000, gain: 0 });
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  const status = await service.action("capture-front");

  assert.equal(status.acceptedProfile.source, "browser_live_tuning");
  assert.equal(status.acceptedProfile.dutyPercent, 1.7);
  assert.deepEqual(status.acceptedProfile.channels, [2, 4, 6, 8]);
  assert.equal(warm.calls[0].type, "capture");
  assert.equal(warm.calls[0].input.activeLightingProfile.profileSource, "browser_live_tuning");
  assert.equal(warm.calls[0].input.activeLightingProfile.selectedDutyPercent, 1.7);
  assert.deepEqual(warm.calls[0].input.activeLightingProfile.selectedChannels, [2, 4, 6, 8]);
});

test("real station bridge uses warm full forensic runner by default with fake runner", async () => {
  const calls = [];
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      calls.push(step);
      if (step.id === "operator_preview") {
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: {
            packageDir: "preview-package",
            acceptedLightingProfile: {
              selectedDutyPercent: 1.3,
              selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
            },
          },
        };
      }
      if (step.id === "unified_report") {
        assert.equal(step.args.includes("front-package"), true);
        assert.equal(step.args.includes("back-package"), true);
        return {
          stepId: step.id,
          ok: true,
          exitCode: 0,
          payload: { report: { packageDir: "unified-report", reportPath: "unified-report/provisional-diagnostic-report.html" } },
        };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(realConfig(), runner, warm.runner);
  await service.action("start-session");
  await assert.rejects(() => service.action("capture-front"), /idle\/off/);
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await service.action("launch-preview");
  await service.action("capture-front");
  await service.action("confirm-flip", { confirmations: { flipComplete: true } });
  await service.action("capture-back");
  const status = await service.action("run-diagnostics");

  assert.deepEqual(calls.map((step) => step.id), ["operator_preview", "unified_report"]);
  assert.deepEqual(warm.calls.map((call) => `${call.type}:${call.side}`), ["capture:front", "process:front", "capture:back", "process:back"]);
  assert.equal(calls.every((step) => step.command === "node"), true);
  assert.equal(status.hardwareActionsEnabled, true);
  assert.equal(status.safety.hardwareAccessed, true);
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.fallbackUsed, false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.fallbackUsed, false);
  assert.equal(status.outputs.unifiedReportPath, "unified-report/provisional-diagnostic-report.html");
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "operator_preview"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "capture_front"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "capture_back"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.stepId === "unified_report"), true);
  assert.equal(status.timingSummary.entries.some((entry) => entry.category === "warm_runner"), true);
  assert.equal(status.timingSummary.executionPath, "warm_full_forensic_runner");
  assert.equal(status.timingSummary.fallbackUsed, false);
  assert.equal(status.timingSummary.totalCommandMs >= 0, true);
});

test("cold command fallback requires explicit warm runner disable flag", async () => {
  const calls = [];
  const warm = makeFakeWarmRunner();
  const runner = {
    async run(step) {
      calls.push(step);
      if (step.id === "capture_front") {
        return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "front-package" } };
      }
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const service = new AiGraderLocalStationBridgeService(realConfig({
    outputDir: outputDir(`fallback-${Date.now()}`),
    warmRunnerDisabled: true,
  }), runner, warm.runner);

  let status = service.status();
  assert.equal(status.executionPath, "cold_command_fallback");
  assert.equal(status.fallbackUsed, true);
  assert.match(status.fallbackReason, /debug flag/i);
  assert.equal(status.warmRunnerStatus.fallback.active, true);

  await service.action("start-session");
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  status = await service.action("capture-front");

  assert.deepEqual(calls.map((step) => step.id), ["capture_front"]);
  assert.deepEqual(warm.calls, []);
  assert.equal(status.executionPath, "cold_command_fallback");
  assert.equal(status.fallbackUsed, true);
  assert.equal(status.warmRunnerStatus.executionPath, "cold_command_fallback");
  assert.equal(status.warmRunnerStatus.fallbackUsed, true);
  assert.match(status.warmRunnerStatus.fallbackReason, /debug flag/i);
  assert.equal(status.timingSummary.executionPath, "cold_command_fallback");
  assert.equal(status.timingSummary.fallbackUsed, true);
  assert.match(status.timingSummary.targetInterCaptureNote, /does not count/i);
  const fallbackSessionManifest = JSON.parse(fs.readFileSync(status.outputs.manifestPath, "utf8"));
  assert.equal(fallbackSessionManifest.executionPath, "cold_command_fallback");
  assert.equal(fallbackSessionManifest.fallbackUsed, true);
  assert.match(fallbackSessionManifest.fallbackReason, /debug flag/i);
});

test("warm runner capture lock blocks preview stream until capture releases", async () => {
  let releaseCapture;
  let captureStarted;
  const captureStartedPromise = new Promise((resolve) => {
    captureStarted = resolve;
  });
  const releaseCapturePromise = new Promise((resolve) => {
    releaseCapture = resolve;
  });
  const runner = {
    async run(step) {
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const warm = makeFakeWarmRunner({
    onCaptureStarted() {
      captureStarted();
    },
    async captureDelay() {
      await releaseCapturePromise;
    },
  });
  const token = "local-station-token-lock";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    ...realConfig({
      stationToken: token,
      port: 0,
      outputDir: outputDir(`lock-${Date.now()}`),
      allowedOrigins: ["https://collect.tenkings.co"],
    }),
  }, {}, runner, warm.runner);
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const postAction = async (action, body = {}) => {
    const response = await fetch(`${started.url}/actions/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? `action ${action} failed`);
    return payload.result;
  };

  try {
    await postAction("start-session");
    await postAction("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await postAction("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
    const capturePromise = postAction("capture-front");
    await captureStartedPromise;

    const blockedPreview = await fetch(`${started.url}/preview/stream`, { headers });
    assert.equal(blockedPreview.status, 409);
    const blockedPayload = await blockedPreview.json();
    assert.equal(blockedPayload.code, "AI_GRADER_CAPTURE_LOCK_HELD");
    assert.equal(blockedPayload.result.status, "paused_for_capture");

    releaseCapture();
    const captureStatus = await capturePromise;
    assert.equal(captureStatus.warmRunnerStatus.captureLock.held, false);
    assert.equal(captureStatus.warmRunnerStatus.previewPolicy.holdActive, true);
    assert.ok(captureStatus.warmRunnerStatus.previewPolicy.lastHoldStartedAt);
  } finally {
    releaseCapture();
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("full forensic session holds preview stopped through flip and back capture", async () => {
  const token = "local-station-token-full-forensic-hold";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: outputDir(`full-forensic-hold-${Date.now()}`),
  });
  const headers = {
    Origin: "https://collect.tenkings.co",
    "x-ai-grader-station-token": token,
    "content-type": "application/json",
  };
  const postAction = async (action, body = {}) => {
    const response = await fetch(`${started.url}/actions/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message ?? `action ${action} failed`);
    return payload.result;
  };
  const readOnePreviewFrame = async () => {
    const chunk = await new Promise((resolve, reject) => {
      let settled = false;
      const req = http.request(`${started.url}/preview/stream`, { headers }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", (data) => {
          settled = true;
          res.destroy();
          req.destroy();
          resolve(Buffer.from(data));
        });
      });
      req.on("error", (error) => {
        if (!settled) reject(error);
      });
      req.setTimeout(5000, () => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new Error("Preview stream did not return a frame."));
      });
      req.end();
    });
    assert.match(chunk.toString("utf8"), /tenkings-ai-grader-preview/);
  };
  let activeReq;

  try {
    await postAction("start-session");
    await postAction("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
    await postAction("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

    const activeStreamClosed = new Promise((resolve, reject) => {
      let sawFrame = false;
      activeReq = http.request(`${started.url}/preview/stream`, { headers }, (res) => {
        assert.equal(res.statusCode, 200);
        res.once("data", () => {
          sawFrame = true;
        });
        res.once("close", () => {
          if (!sawFrame) reject(new Error("Preview closed before a frame was observed."));
          else resolve();
        });
      });
      activeReq.on("error", (error) => {
        if (!sawFrame) reject(error);
      });
      activeReq.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const frontStatus = await postAction("capture-front");
    assert.equal(frontStatus.currentStep, "prompt_flip_card");
    assert.equal(frontStatus.warmRunnerStatus.previewPolicy.holdActive, true);
    assert.equal(frontStatus.previewStatus.status, "paused_for_capture");
    assert.notEqual(frontStatus.previewStatus.cameraOwnership, "preview_stream");
    await activeStreamClosed;
    activeReq.destroy();

    const blockedDuringFlip = await fetch(`${started.url}/preview/stream`, { headers });
    assert.equal(blockedDuringFlip.status, 409);
    const blockedDuringFlipBody = await blockedDuringFlip.json();
    assert.equal(blockedDuringFlipBody.code, "AI_GRADER_PREVIEW_PAUSED_FOR_GRADING_SESSION");
    assert.equal(blockedDuringFlipBody.result.cameraOwnership, "released");

    await postAction("confirm-flip", { confirmations: { flipComplete: true } });
    const blockedBeforeBack = await fetch(`${started.url}/preview/stream`, { headers });
    assert.equal(blockedBeforeBack.status, 409);
    await blockedBeforeBack.text();

    const backStatus = await postAction("capture-back");
    assert.equal(backStatus.sessionManifest.backCaptured, true);
    assert.equal(backStatus.executionPath, "warm_full_forensic_runner");
    assert.equal(backStatus.fallbackUsed, false);
    assert.equal(backStatus.warmRunnerStatus.previewPolicy.holdActive, true);
    assert.notEqual(backStatus.previewStatus.cameraOwnership, "preview_stream");

    const reportStatus = await postAction("run-diagnostics");
    assert.equal(reportStatus.latestReport.exists, true);
    assert.equal(reportStatus.warmRunnerStatus.previewPolicy.holdActive, true);

    const ended = await postAction("end-session");
    assert.equal(ended.currentStep, "safe_off_end_session");
    assert.equal(ended.warmRunnerStatus.previewPolicy.holdActive, false);
    assert.ok(ended.warmRunnerStatus.previewPolicy.lastHoldReleasedAt);
    await readOnePreviewFrame();
  } finally {
    if (typeof activeReq?.destroy === "function") activeReq.destroy();
    if (typeof started.server.closeAllConnections === "function") {
      started.server.closeAllConnections();
    }
    await closeServer(started.server);
  }
});

test("warm runner runs safe-off cleanup on failure, cancellation, and session end", async () => {
  const failureCalls = [];
  const failureRunner = {
    async run(step) {
      failureCalls.push(step.id);
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  };
  const failureWarm = makeFakeWarmRunner({ captureError: new Error("front boom") });
  const failureService = new AiGraderLocalStationBridgeService(realConfig({ outputDir: outputDir(`failure-${Date.now()}`) }), failureRunner, failureWarm.runner);
  await failureService.action("start-session");
  await failureService.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await failureService.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });

  await assert.rejects(() => failureService.action("capture-front"), /front boom/);
  const failureStatus = failureService.status();
  assert.deepEqual(failureCalls, ["safe_off"]);
  assert.deepEqual(failureWarm.calls.map((call) => `${call.type}:${call.side}`), ["capture:front"]);
  assert.equal(failureStatus.warmRunnerStatus.status, "failed");
  assert.equal(failureStatus.warmRunnerStatus.captureLock.held, false);
  assert.equal(failureStatus.warmRunnerStatus.previewPolicy.holdActive, false);
  assert.notEqual(failureStatus.previewStatus.cameraOwnership, "preview_stream");
  assert.equal(failureStatus.warmRunnerStatus.phases.some((phase) => phase.id === "warm_safe_cleanup" && phase.status === "completed"), true);
  assert.equal(failureStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(failureStatus.fallbackUsed, false);

  const cancelCalls = [];
  const cancelService = new AiGraderLocalStationBridgeService(realConfig({ outputDir: outputDir(`cancel-${Date.now()}`) }), {
    async run(step) {
      cancelCalls.push(step.id);
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  });
  await cancelService.action("start-session");
  const cancelStatus = await cancelService.action("cancel-session");
  assert.deepEqual(cancelCalls, ["safe_off"]);
  assert.equal(cancelStatus.warmRunnerStatus.status, "cancelled");
  assert.equal(cancelStatus.warmRunnerStatus.phases.some((phase) => phase.id === "station_cancelled" && phase.status === "cancelled"), true);

  const endCalls = [];
  const endService = new AiGraderLocalStationBridgeService(realConfig({ outputDir: outputDir(`end-${Date.now()}`) }), {
    async run(step) {
      endCalls.push(step.id);
      return { stepId: step.id, ok: true, exitCode: 0, payload: { ok: true } };
    },
  });
  await endService.action("start-session");
  const endStatus = await endService.action("end-session");
  assert.deepEqual(endCalls, ["safe_off"]);
  assert.equal(endStatus.warmRunnerStatus.status, "complete");
  assert.equal(endStatus.warmRunnerStatus.phases.some((phase) => phase.id === "warm_safe_cleanup" && phase.status === "completed"), true);
});

test("fresh bridge status exposes latest generated report from local history", async () => {
  const dir = outputDir(`history-latest-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-02T035658313Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-02T041413536Z");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "front"), { recursive: true });
  const frontImagePath = path.join(reportDir, "front", "front-all-on-portrait-display.png");
  fs.writeFileSync(frontImagePath, Buffer.from("front-image"));
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, `<html><body>generated report<img src="${frontImagePath}" alt="front"></body></html>`);
  fs.writeFileSync(path.join(sessionDir, "station-session.json"), JSON.stringify({
    reportId: "ai-grader-browser-station-session-2026-07-02T035658313Z-report",
    sessionId: "ai-grader-browser-station-session-2026-07-02T035658313Z-session",
    createdAt: "2026-07-02T03:56:58.313Z",
    updatedAt: "2026-07-02T04:14:13.536Z",
    outputs: { unifiedReportPath: reportHtmlPath, unifiedReportDir: reportDir },
  }));

  const service = new AiGraderLocalStationBridgeService(mockConfig({ outputDir: dir }));
  const status = service.status();
  assert.equal(status.latestReport.exists, true);
  assert.equal(status.latestReport.reportId, "ai-grader-browser-station-session-2026-07-02T035658313Z-report");
  assert.equal(status.latestReport.localHtmlPath, reportHtmlPath);
  assert.equal(status.latestReport.localViewerPath, "/ai-grader/reports/ai-grader-browser-station-session-2026-07-02T035658313Z-report");

  const resolved = await service.reportBundle(status.latestReport.reportId, { includeAssetBodies: true });
  const imageAsset = resolved.bundle.assets.find((asset) => asset.kind === "image" && asset.fileName === "front-all-on-portrait-display.png");
  assert.equal(resolved.source, "history_generated_with_asset_bodies");
  assert.equal(imageAsset?.bodyEncoding, "base64");
  assert.equal(Buffer.from(imageAsset?.bodyBase64 ?? "", "base64").toString("utf8"), "front-image");
});

test("station bridge ignores stale shared bundle paths for requested history report", async () => {
  const dir = outputDir(`history-stale-bundle-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-06T223658063Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-06T223840015Z");
  const sharedBundleDir = path.join(dir, "ai-grader-report-bundles");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(sharedBundleDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "front"), { recursive: true });
  const frontImagePath = path.join(reportDir, "front", "front-all-on-portrait-display.png");
  fs.writeFileSync(frontImagePath, Buffer.from("front-image"));
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, `<html><body>generated report<img src="${frontImagePath}" alt="front"></body></html>`);
  const staleBundlePath = path.join(sharedBundleDir, "report-bundle.json");
  fs.writeFileSync(staleBundlePath, JSON.stringify({
    schemaVersion: "ten-kings-ai-grader-report-bundle-v0",
    generatedAt: "2026-07-07T00:03:18.271Z",
    gradingSessionId: "stale-session",
    reportId: "ai-grader-browser-station-session-2026-07-07T000318271Z-report",
    reportStatus: "final_ai_grader_report_v0",
    cardIdentity: { title: "Stale report" },
    evidenceReferences: {},
    provisionalGrade: {},
    assets: [],
    warnings: [],
  }));
  fs.writeFileSync(path.join(sessionDir, "station-session.json"), JSON.stringify({
    reportId: "ai-grader-browser-station-session-2026-07-06T223658063Z-report",
    sessionId: "ai-grader-browser-station-session-2026-07-06T223658063Z-session",
    createdAt: "2026-07-06T22:36:58.063Z",
    updatedAt: "2026-07-06T22:38:55.517Z",
    outputs: {
      unifiedReportPath: reportHtmlPath,
      unifiedReportDir: reportDir,
      reportBundlePath: staleBundlePath,
    },
  }));

  const service = new AiGraderLocalStationBridgeService(mockConfig({ outputDir: dir }));
  const resolved = await service.reportBundle("ai-grader-browser-station-session-2026-07-06T223658063Z-report");
  assert.equal(resolved.source, "history_generated_from_report_dir");
  assert.equal(resolved.bundle.reportId, "ai-grader-browser-station-session-2026-07-06T223658063Z-report");
  assert.equal(resolved.bundle.assets.some((asset) => asset.fileName === "front-all-on-portrait-display.png"), true);
});

test("station bridge serves one local report asset for direct storage upload", async () => {
  const dir = outputDir(`report-asset-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-02T035658313Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-02T041413536Z");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "front"), { recursive: true });
  const frontImagePath = path.join(reportDir, "front", "front-all-on-portrait-display.png");
  fs.writeFileSync(frontImagePath, Buffer.from("front-image"));
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, `<html><body>generated report<img src="${frontImagePath}" alt="front"></body></html>`);
  fs.writeFileSync(path.join(sessionDir, "station-session.json"), JSON.stringify({
    reportId: "ai-grader-browser-station-session-2026-07-02T035658313Z-report",
    sessionId: "ai-grader-browser-station-session-2026-07-02T035658313Z-session",
    createdAt: "2026-07-02T03:56:58.313Z",
    updatedAt: "2026-07-02T04:14:13.536Z",
    outputs: { unifiedReportPath: reportHtmlPath, unifiedReportDir: reportDir },
  }));

  const token = "local-station-token-report-asset";
  const started = await startAiGraderLocalStationBridgeHttpServer({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 0,
    stationToken: token,
    allowedOrigins: ["https://collect.tenkings.co"],
    outputDir: dir,
  });
  try {
    const reportId = "ai-grader-browser-station-session-2026-07-02T035658313Z-report";
    const assetId = "report/front/front-all-on-portrait-display.png";
    const unauthorized = await fetch(`${started.url}/reports/${encodeURIComponent(reportId)}/asset?assetId=${encodeURIComponent(assetId)}`, {
      headers: { Origin: "https://collect.tenkings.co" },
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();

    const response = await fetch(`${started.url}/reports/${encodeURIComponent(reportId)}/asset?assetId=${encodeURIComponent(assetId)}`, {
      headers: { Origin: "https://collect.tenkings.co", "x-ai-grader-station-token": token },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("x-ai-grader-asset-id"), assetId);
    assert.equal(response.headers.get("x-ai-grader-sha256"), "635c727b41c225c9496e646413781d7c3aa11874287dd7a9d584911839f42999");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), "front-image");
  } finally {
    await closeServer(started.server);
  }
});

test("station bridge CLI help exposes local bridge command and flags", async () => {
  let stdout = "";
  const code = await runCaptureHelperCli(["help"], {
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.commands.some((command) => command.includes("ai-grader-station-bridge")), true);
  assert.equal(payload.commands.some((command) => command.startsWith("ai-grader-production-release")), true);
  assert.equal(payload.options.includes("--station-token"), true);
  assert.equal(payload.options.includes("--station-pairing-code"), true);
  assert.equal(payload.options.includes("--enable-local-station"), true);
});

test("Windows bridge scripts keep station token out of scheduled task and launcher command lines", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const startScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "start-local-station-bridge.ps1"), "utf8");
  const installScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "install-local-station-bridge.ps1"), "utf8");
  const openScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "open-local-station.ps1"), "utf8");
  const statusScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "status-local-station-bridge.ps1"), "utf8");
  const stopScript = fs.readFileSync(path.join(repoRoot, "scripts", "ai-grader", "stop-local-station-bridge.ps1"), "utf8");

  assert.equal(startScript.includes("--station-token"), false);
  assert.equal(installScript.includes("--station-token"), false);
  assert.equal(openScript.includes("--station-token"), false);
  assert.equal(installScript.includes("AI_GRADER_SERVICE_ACCOUNT_TOKEN"), false);
  assert.equal(openScript.includes("AI_GRADER_SERVICE_ACCOUNT_TOKEN"), false);
  assert.equal(statusScript.includes("tokenFingerprint"), true);
  assert.equal(statusScript.includes("ConvertTo-Json"), true);
  assert.equal(stopScript.includes("ai-grader-station-bridge"), true);
  assert.equal(stopScript.includes("--host 127.0.0.1"), true);
  assert.equal(stopScript.includes("--port 47652"), true);
});
