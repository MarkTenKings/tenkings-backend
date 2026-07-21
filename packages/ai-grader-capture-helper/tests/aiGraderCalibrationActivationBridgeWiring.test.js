const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAiGraderLocalStationBridgeHttpServer,
} = require("../dist/drivers/aiGraderLocalStationBridge");

function realInput() {
  return {
    enabled: true,
    mode: "real",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: "C:\\TenKings\\capture-data\\ai-grader-station",
    apply: true,
    markPresent: true,
    wiringConfirmed: true,
    leimacStatusGreen: true,
    leimacHost: "10.0.0.7",
  };
}

test("real helper rejects editable live-context JSON as activation authority before opening hardware", () => {
  assert.throws(
    () => createAiGraderLocalStationBridgeHttpServer(
      realInput(),
      {
        AI_GRADER_CALIBRATION_LIVE_OPERATING_CONTEXT_PATH:
          "C:\\TenKings\\capture-data\\editable-operating-context.json",
      },
    ),
    /editable JSON is not live device authority/,
  );
});

test("partial real activation wiring fails closed instead of falling back to loose bundle configuration", () => {
  assert.throws(
    () => createAiGraderLocalStationBridgeHttpServer(
      realInput(),
      {
        AI_GRADER_CALIBRATION_WORKSTATION_KEY_ID: "d".repeat(64),
      },
    ),
    /requires the workstation key, key ID, SHA-pinned rig inventory, and trusted finalizer staging root/,
  );
});
