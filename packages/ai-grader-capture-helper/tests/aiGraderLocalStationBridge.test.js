const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiGraderPreviewJpegFrameAssembler,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");

const sourceRoot = path.resolve(__dirname, "../src");
const bridgeSource = fs.readFileSync(path.join(sourceRoot, "drivers/aiGraderLocalStationBridge.ts"), "utf8");
const clientSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/nextjs-app/lib/aiGraderStationBridgeClient.ts"), "utf8");
const operationsSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/nextjs-app/lib/aiGraderStationOperations.ts"), "utf8");
const pageSource = fs.readFileSync(path.resolve(__dirname, "../../../frontend/nextjs-app/pages/ai-grader/station.tsx"), "utf8");

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

test("removed browser shutdown, confirmation, rapid queue, cold, and manual capture systems are absent", () => {
  for (const removed of [
    "/lighting/safe-off", "/lighting/accept", "/lighting/retry-back-positioning", "/preview/stop",
    "confirm-fixture-rulers", "confirm-light-idle-off", "confirm-flip",
    "configure-rapid-capture", "queue-current-card", "activate-queue-item",
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
