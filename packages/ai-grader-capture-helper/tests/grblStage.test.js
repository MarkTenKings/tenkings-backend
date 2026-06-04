const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCaptureHelperReadinessReportAsync,
  parseGrblStatusResponse,
  runGrblStageHealthCheck,
} = require("../dist");
const { runCaptureHelperCli } = require("../dist/cli");

const BASE_CONFIG = {
  simulator: {
    tenantId: "tenant-grbl",
    captureSessionId: "session-grbl",
    rigId: "rig-grbl",
    locationId: "location-grbl",
    operatorId: "operator-grbl",
    helperInstanceId: "helper-grbl",
    seed: "grbl-seed",
  },
};

const FORBIDDEN_MOTION_COMMANDS = ["$H", "$X", "\u0018", "G0", "G1", "$J", "J=", "M3", "M4", "M5", "M7", "M8", "M9"];

function createFakeSerialTransport(responses, options = {}) {
  const state = {
    openCalls: [],
    writes: [],
    closed: false,
  };

  return {
    state,
    transport: {
      async open(openOptions) {
        state.openCalls.push(openOptions);
        if (options.openError) throw new Error(options.openError);
        return {
          async writeRaw(data) {
            state.writes.push(data);
            if (options.writeErrorOnce && state.writes.length === 1) {
              throw new Error(options.writeErrorOnce);
            }
          },
          async writeLine(line) {
            state.writes.push(line);
          },
          async readLine() {
            const response = responses.shift();
            if (response === "TIMEOUT") {
              return await new Promise(() => {});
            }
            if (response instanceof Error) throw response;
            return response;
          },
          async close() {
            state.closed = true;
            if (options.closeError) throw new Error(options.closeError);
          },
        };
      },
    },
  };
}

function assertNoMotionCommands(writes) {
  for (const write of writes) {
    assert.equal(write, "?", "GRBL readiness may only emit the status query.");
    for (const forbidden of FORBIDDEN_MOTION_COMMANDS) {
      assert.equal(write.includes(forbidden), false, `unexpected GRBL motion/enabling command: ${forbidden}`);
    }
  }
}

async function runCli(argv) {
  let stdout = "";
  let stderr = "";
  const code = await runCaptureHelperCli(argv, {
    env: {},
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  return {
    code,
    stdout: stdout ? JSON.parse(stdout) : null,
    stderr: stderr ? JSON.parse(stderr) : null,
  };
}

test("fake GRBL status success parses basic status response", async () => {
  const fake = createFakeSerialTransport(["<Idle|MPos:0.000,0.000,0.000|FS:0,0>"]);
  const result = await runGrblStageHealthCheck({
    config: {
      port: "FAKE-GRBL",
      baudRate: 115200,
      commandTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "PASS");
  assert.equal(result.opened, true);
  assert.equal(result.closed, true);
  assert.equal(result.statusResponse.machineState, "Idle");
  assert.equal(result.statusResponse.fields.MPos, "0.000,0.000,0.000");
  assert.equal(result.statusResponse.fields.FS, "0,0");
  assert.deepEqual(fake.state.writes, ["?"]);
  assertNoMotionCommands(fake.state.writes);
});

test("GRBL status parser accepts state-only status", () => {
  const parsed = parseGrblStatusResponse("<Alarm>");

  assert.equal(parsed.machineState, "Alarm");
  assert.deepEqual(parsed.fields, {});
  assert.deepEqual(parsed.fieldOrder, []);
});

test("fake GRBL timeout failure reports clear error", async () => {
  const fake = createFakeSerialTransport(["TIMEOUT"]);
  const result = await runGrblStageHealthCheck({
    config: {
      port: "FAKE-GRBL",
      commandTimeoutMs: 5,
      closeTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "FAIL");
  assert.match(result.error, /Timed out waiting for GRBL stage status response/);
  assert.equal(result.closed, true);
  assert.deepEqual(fake.state.writes, ["?"]);
  assertNoMotionCommands(fake.state.writes);
});

test("fake malformed GRBL response failure reports unexpected status", async () => {
  const fake = createFakeSerialTransport(["ok"]);
  const result = await runGrblStageHealthCheck({
    config: {
      port: "FAKE-GRBL",
      commandTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Unexpected GRBL stage status response: ok/);
  assert.equal(result.closed, true);
  assert.deepEqual(fake.state.writes, ["?"]);
  assertNoMotionCommands(fake.state.writes);
});

test("default readiness path does not open GRBL serial", async () => {
  const fake = createFakeSerialTransport(["<Idle|MPos:0.000,0.000,0.000>"]);
  const report = await buildCaptureHelperReadinessReportAsync(BASE_CONFIG, {}, {
    grblStageSerialTransport: fake.transport,
  });

  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.stageChecks[0].status, "PASS");
  assert.equal(fake.state.openCalls.length, 0);
});

test("explicit GRBL readiness opens fake serial and reports health", async () => {
  const fake = createFakeSerialTransport(["<Idle|MPos:0.000,0.000,0.000|FS:0,0>"]);
  const report = await buildCaptureHelperReadinessReportAsync(
    {
      ...BASE_CONFIG,
      driverSet: "real",
      rigMode: "readiness",
      stage: {
        kind: "grbl",
        grbl: {
          port: "FAKE-GRBL",
          commandTimeoutMs: 10,
        },
      },
    },
    {},
    { grblStageSerialTransport: fake.transport }
  );

  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.stageChecks[0].status, "PASS");
  assert.equal(report.grblStageHealth.status, "PASS");
  assert.equal(fake.state.openCalls.length, 1);
  assert.deepEqual(fake.state.writes, ["?"]);
  assertNoMotionCommands(fake.state.writes);
});

test("real GRBL readiness without explicit port fails closed", async () => {
  const fake = createFakeSerialTransport(["<Idle|MPos:0.000,0.000,0.000>"]);
  const report = await buildCaptureHelperReadinessReportAsync(
    {
      ...BASE_CONFIG,
      driverSet: "real",
      rigMode: "readiness",
      stage: { kind: "grbl" },
    },
    {},
    { grblStageSerialTransport: fake.transport }
  );

  assert.equal(report.overallStatus, "FAIL");
  assert.equal(report.stageChecks[0].status, "FAIL");
  assert.match(report.stageChecks[0].message, /explicit serial port/);
  assert.equal(fake.state.openCalls.length, 0);
});

test("manual stage-health command requires an explicit port", async () => {
  const result = await runCli(["stage-health"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout.status, "FAIL");
  assert.match(result.stdout.error, /serial port is required/);
  assert.equal(result.stderr, null);
});
