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
    /requires the workstation key, key ID, SHA-pinned rig inventory, trusted finalizer staging root, and pinned hosted authority public keys/,
  );
});


test("real helper requires pinned hosted authority verification keys before reading local key or inventory files", () => {
  assert.throws(
    () => createAiGraderLocalStationBridgeHttpServer(
      realInput(),
      {
        AI_GRADER_CALIBRATION_WORKSTATION_PRIVATE_KEY_PATH: "C:\\trusted\\workstation-key.pem",
        AI_GRADER_CALIBRATION_WORKSTATION_KEY_ID: "d".repeat(64),
        AI_GRADER_CALIBRATION_RIG_INVENTORY_PATH: "C:\\trusted\\rig-inventory.json",
        AI_GRADER_CALIBRATION_RIG_INVENTORY_SHA256: "e".repeat(64),
        AI_GRADER_CALIBRATION_FINALIZER_STAGING_ROOT: "C:\\trusted\\finalizer-staging",
      },
    ),
    /pinned hosted authority public keys/,
  );
});
