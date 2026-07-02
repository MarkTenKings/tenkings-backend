const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderLocalStationBridgeService,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");
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

test("mock station bridge runs staged workflow without claiming hardware", async () => {
  const service = new AiGraderLocalStationBridgeService(mockConfig());

  let status = service.status();
  assert.equal(status.bridgeVersion, AI_GRADER_LOCAL_STATION_BRIDGE_VERSION);
  assert.equal(status.hardwareActionsEnabled, false);
  assert.equal(status.safety.hardwareAccessed, false);

  status = await service.action("start-session");
  assert.equal(status.currentStep, "verify_fixture_rulers");
  assert.ok(status.outputs.sessionDir);

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
  await assert.rejects(() => service.action("capture-back"), /flip/);

  status = await service.action("confirm-flip", { confirmations: { flipComplete: true } });
  assert.equal(status.confirmations.flipComplete, true);
  status = await service.action("capture-back");
  assert.equal(status.sessionManifest.backCaptured, true);
  status = await service.action("run-diagnostics");
  assert.equal(status.latestReport.exists, true);
  const resolvedReport = await service.reportBundle(status.latestReport.reportId);
  assert.equal(resolvedReport.reportId, status.latestReport.reportId);
  assert.equal(resolvedReport.bundle.finalGradeComputed, false);
  const history = await service.reportHistory();
  assert.equal(history.items.some((item) => item.reportId === status.latestReport.reportId), true);
  assert.equal(history.stats.allTime >= 1, true);
  status = await service.action("export-report-bundle");
  assert.ok(status.outputs.reportBundlePath);
  assert.equal(status.safety.finalGradeComputed, false);
  assert.equal(status.safety.certifiedClaim, false);
  status = await service.action("calculate-final-grade", {
    operatorId: "mark",
    warningsAccepted: true,
    overrideReason: "Bridge test warning acceptance.",
  });
  assert.ok(status.outputs.productionReleasePath);
  assert.ok(status.outputs.labelDataPath);
  assert.equal(status.safety.certifiedClaim, false);
  assert.equal(status.safety.certificateGenerated, false);
  const release = JSON.parse(fs.readFileSync(status.outputs.productionReleasePath, "utf8"));
  assert.equal(release.databaseIntegration.productionDbWritesPerformed, false);
  assert.equal(release.storageIntegration.uploadPerformed, false);
});

test("real station bridge uses allow-listed station command plan with fake runner", async () => {
  const calls = [];
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
      if (step.id === "capture_front") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "front-package" } };
      if (step.id === "capture_back") return { stepId: step.id, ok: true, exitCode: 0, payload: { packageDir: "back-package" } };
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
  const service = new AiGraderLocalStationBridgeService(realConfig(), runner);
  await service.action("start-session");
  await assert.rejects(() => service.action("capture-front"), /idle\/off/);
  await service.action("confirm-light-idle-off", { confirmations: { lightIdleOff: true } });
  await service.action("confirm-fixture-rulers", { confirmations: { fixtureRulersVisible: true } });
  await service.action("launch-preview");
  await service.action("capture-front");
  await service.action("confirm-flip", { confirmations: { flipComplete: true } });
  await service.action("capture-back");
  const status = await service.action("run-diagnostics");

  assert.deepEqual(calls.map((step) => step.id), ["operator_preview", "capture_front", "capture_back", "unified_report"]);
  assert.equal(calls.every((step) => step.command === "node"), true);
  assert.equal(status.hardwareActionsEnabled, true);
  assert.equal(status.safety.hardwareAccessed, true);
  assert.equal(status.outputs.unifiedReportPath, "unified-report/provisional-diagnostic-report.html");
  assert.equal(status.timingSummary.entries.length, 4);
  assert.equal(status.timingSummary.totalCommandMs >= 0, true);
});

test("fresh bridge status exposes latest generated report from local history", () => {
  const dir = outputDir(`history-latest-${Date.now()}`);
  const sessionDir = path.join(dir, "ai-grader-browser-station-session-2026-07-02T035658313Z");
  const reportDir = path.join(dir, "ai-grader-fixed-rig-v1-unified-diagnostic-report-2026-07-02T041413536Z");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  fs.writeFileSync(reportHtmlPath, "<html><body>generated report</body></html>");
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
  assert.equal(payload.commands.some((command) => command.startsWith("ai-grader-station-bridge")), true);
  assert.equal(payload.commands.some((command) => command.startsWith("ai-grader-production-release")), true);
  assert.equal(payload.options.includes("--station-token"), true);
  assert.equal(payload.options.includes("--enable-local-station"), true);
});
