const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCaptureHelperReadinessReportAsync,
  runArduinoLedControllerHealthCheck,
} = require("../dist");
const { runCaptureHelperCli } = require("../dist/cli");

const BASE_CONFIG = {
  simulator: {
    tenantId: "tenant-arduino",
    captureSessionId: "session-arduino",
    rigId: "rig-arduino",
    locationId: "location-arduino",
    operatorId: "operator-arduino",
    helperInstanceId: "helper-arduino",
    seed: "arduino-seed",
  },
};

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
          async writeLine(line) {
            state.writes.push(line);
            if (options.writeErrorOnce && state.writes.length === 1) {
              throw new Error(options.writeErrorOnce);
            }
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

test("fake serial PING PONG health succeeds", async () => {
  const fake = createFakeSerialTransport(["PONG", "OK"]);
  const result = await runArduinoLedControllerHealthCheck({
    config: {
      port: "FAKE-PORT",
      baudRate: 115200,
      commandTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "PASS");
  assert.equal(result.opened, true);
  assert.equal(result.closed, true);
  assert.deepEqual(fake.state.writes, ["PING", "LED ALL OFF"]);
  assert.equal(result.commands[0].command, "PING");
  assert.equal(result.commands[0].response, "PONG");
  assert.equal(result.commands[0].status, "PASS");
});

test("fake serial LED ALL OFF success is reported", async () => {
  const fake = createFakeSerialTransport(["PONG", "OK"]);
  const result = await runArduinoLedControllerHealthCheck({
    config: {
      port: "FAKE-PORT",
      commandTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  const allOff = result.commands.find((command) => command.command === "LED ALL OFF");
  assert.equal(result.allOffAttempted, true);
  assert.equal(result.allOffSucceeded, true);
  assert.equal(allOff.response, "OK");
  assert.equal(allOff.status, "PASS");
});

test("timeout failure reports clear error and closes safely", async () => {
  const fake = createFakeSerialTransport(["TIMEOUT", "OK"]);
  const result = await runArduinoLedControllerHealthCheck({
    config: {
      port: "FAKE-PORT",
      commandTimeoutMs: 5,
      closeTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "FAIL");
  assert.match(result.error, /Timed out waiting for PONG after PING/);
  assert.equal(result.allOffAttempted, true);
  assert.equal(result.allOffSucceeded, true);
  assert.equal(fake.state.closed, true);
  assert.deepEqual(fake.state.writes, ["PING", "LED ALL OFF"]);
});

test("unexpected response failure reports expected and actual values", async () => {
  const fake = createFakeSerialTransport(["NOPE", "OK"]);
  const result = await runArduinoLedControllerHealthCheck({
    config: {
      port: "FAKE-PORT",
      commandTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /expected PONG, received NOPE/);
  assert.deepEqual(fake.state.writes, ["PING", "LED ALL OFF"]);
  assert.equal(result.allOffSucceeded, true);
});

test("close path attempts LED ALL OFF after an opened connection fails", async () => {
  const fake = createFakeSerialTransport(["OK"], { writeErrorOnce: "write failed" });
  const result = await runArduinoLedControllerHealthCheck({
    config: {
      port: "FAKE-PORT",
      commandTimeoutMs: 10,
    },
    transport: fake.transport,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /write failed/);
  assert.equal(result.allOffAttempted, true);
  assert.equal(result.allOffSucceeded, true);
  assert.equal(fake.state.closed, true);
  assert.deepEqual(fake.state.writes, ["PING", "LED ALL OFF"]);
});

test("default readiness path does not open serial", async () => {
  const fake = createFakeSerialTransport(["PONG", "OK"]);
  const report = await buildCaptureHelperReadinessReportAsync(BASE_CONFIG, {}, {
    arduinoLedSerialTransport: fake.transport,
  });

  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.ledControllerChecks[0].status, "PASS");
  assert.equal(fake.state.openCalls.length, 0);
});

test("explicit Arduino readiness opens fake serial and reports health", async () => {
  const fake = createFakeSerialTransport(["PONG", "OK"]);
  const report = await buildCaptureHelperReadinessReportAsync(
    {
      ...BASE_CONFIG,
      driverSet: "real",
      rigMode: "readiness",
      ledController: {
        kind: "arduino",
        arduino: {
          port: "FAKE-PORT",
          commandTimeoutMs: 10,
        },
      },
    },
    {},
    { arduinoLedSerialTransport: fake.transport }
  );

  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.ledControllerChecks[0].status, "PASS");
  assert.equal(report.arduinoLedHealth.status, "PASS");
  assert.equal(fake.state.openCalls.length, 1);
  assert.deepEqual(fake.state.writes, ["PING", "LED ALL OFF"]);
});

test("real-driver readiness without explicit port fails closed", async () => {
  const fake = createFakeSerialTransport(["PONG", "OK"]);
  const report = await buildCaptureHelperReadinessReportAsync(
    {
      ...BASE_CONFIG,
      driverSet: "real",
      rigMode: "readiness",
      ledController: { kind: "arduino" },
    },
    {},
    { arduinoLedSerialTransport: fake.transport }
  );

  assert.equal(report.overallStatus, "FAIL");
  assert.equal(report.ledControllerChecks[0].status, "FAIL");
  assert.match(report.ledControllerChecks[0].message, /explicit serial port/);
  assert.equal(fake.state.openCalls.length, 0);
});

test("manual led-health command requires an explicit port", async () => {
  const result = await runCli(["led-health"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout.status, "FAIL");
  assert.match(result.stdout.error, /serial port is required/);
  assert.equal(result.stderr, null);
});

test("default imports do not load serialport hardware module", () => {
  const serialImports = Object.keys(require.cache).filter((moduleId) =>
    moduleId.includes("node_modules/serialport") || moduleId.includes("node_modules/@serialport")
  );
  assert.deepEqual(serialImports, []);
});
