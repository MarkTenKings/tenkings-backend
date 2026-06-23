const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LeimacIdmuClient,
  composeLeimacIdmuCommand,
  composeLeimacIdmuReadCommand,
  composeLeimacIdmuUnsafeWriteCommandForTest,
  normalizeLeimacIdmuHost,
  normalizeLeimacIdmuPort,
} = require("../dist/drivers/leimacIdmuClient");
const { runCaptureHelperCli } = require("../dist/cli");

function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    transport: {
      async send(request) {
        calls.push(request);
        if (handler instanceof Error) throw handler;
        if (typeof handler === "function") return handler(request);
        return handler;
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

test("Leimac command composer formats manual command-before-target read frames", () => {
  const status = composeLeimacIdmuReadCommand("status", { unit: 1 });
  const systemStatus = composeLeimacIdmuReadCommand("status", { unit: 0 });
  const firmware = composeLeimacIdmuReadCommand("firmware", { unit: 1 });
  const operationMode = composeLeimacIdmuReadCommand("operationMode", { unit: 1 });
  const temperature = composeLeimacIdmuReadCommand("temperature", { unit: 1 });
  const unitInfo = composeLeimacIdmuReadCommand("unitInfo", { unit: 1 });

  assert.equal(status.ascii, "R0801");
  assert.equal(status.frame, "R0801");
  assert.equal(status.terminator, "");
  assert.equal(status.metadata.commandNumber, "08");
  assert.equal(status.metadata.targetDesignation, "01");
  assert.equal(systemStatus.ascii, "R0800");
  assert.equal(systemStatus.frame, "R0800");
  assert.equal(systemStatus.metadata.targetKind, "system");
  assert.equal(firmware.ascii, "R1601");
  assert.equal(firmware.frame, "R1601");
  assert.equal(firmware.metadata.header, "R");
  assert.equal(firmware.metadata.commandNumber, "16");
  assert.equal(firmware.metadata.readOnly, true);
  assert.equal(operationMode.ascii, "R47");
  assert.equal(operationMode.frame, "R47");
  assert.equal(operationMode.metadata.targetKind, "none");
  assert.equal(temperature.ascii, "R8001");
  assert.equal(temperature.frame, "R8001");
  assert.equal(temperature.metadata.unit, 1);
  assert.equal(unitInfo.ascii, "R83");
  assert.equal(unitInfo.frame, "R83");
  assert.equal(unitInfo.metadata.targetKind, "none");
});

test("Leimac manual write example can be composed only through explicit test helper", () => {
  const manualExample = composeLeimacIdmuUnsafeWriteCommandForTest({
    commandNumber: "01",
    targetDesignation: "01",
    data: "0001",
  });

  assert.equal(manualExample.ascii, "W01010001");
  assert.equal(manualExample.frame, "W01010001");
  assert.equal(manualExample.terminator, "");
  assert.equal(manualExample.metadata.testOnly, true);
});

test("Leimac write commands are rejected by default", () => {
  assert.throws(
    () => composeLeimacIdmuCommand({ header: "W", name: "status", unit: 1 }),
    /write commands are prohibited/
  );
  assert.throws(
    () => new LeimacIdmuClient({ host: "169.254.191.156", writesAllowed: true }),
    /writesAllowed=true is not supported/
  );
});

test("Leimac unknown commands and invalid hardware endpoints are rejected", () => {
  assert.throws(
    () => composeLeimacIdmuCommand({ header: "R", name: "lightingOutputValue", unit: 1 }),
    /not in the read allowlist/
  );
  assert.throws(() => normalizeLeimacIdmuHost("C:\\TenKings\\controller"), /not a path or URL/);
  assert.throws(() => normalizeLeimacIdmuHost("not an ip"), /explicit IPv4 or IPv6/);
  assert.throws(() => normalizeLeimacIdmuPort(50001), /reserved for Leimac Discovery/);
});

test("Leimac successful read responses preserve raw data and parse confident fields only", async () => {
  const fake = fakeTransport((request) => {
    if (request.ascii === "R0801") return "R08010000\r\n";
    if (request.ascii === "R1601") return "R160101.23.45.67\r\n";
    if (request.ascii === "R47") return "R470000\r\n";
    if (request.ascii === "R8001") return "R8001010027020028\r\n";
    if (request.ascii === "R83") return "R8300020000000800000008\r\n";
    return "WR00NAK\r\n";
  });
  const client = new LeimacIdmuClient({
    host: "169.254.191.156",
    port: 1000,
    timeoutMs: 1500,
    transport: fake.transport,
  });

  const readiness = await client.readiness();

  assert.equal(readiness.ok, true);
  assert.equal(readiness.status, "PASS");
  assert.equal(readiness.controller.family, "Leimac IDMU-P");
  assert.equal(readiness.safety.writesAllowed, false);
  assert.equal(readiness.safety.lightsCommanded, false);
  assert.equal(readiness.commandsAttempted.length, 5);
  assert.deepEqual(fake.calls.map((call) => call.ascii), ["R0801", "R1601", "R47", "R8001", "R83"]);
  assert.deepEqual(fake.calls.map((call) => call.frame), ["R0801", "R1601", "R47", "R8001", "R83"]);
  assert.equal(readiness.commandsAttempted[0].requestFrame, "R0801");
  assert.equal(readiness.commandsAttempted[0].parsed.statusCode, "0000");
  assert.equal(readiness.commandsAttempted[1].parsed.firmwareVersion, "01.23.45.67");
  assert.equal(readiness.commandsAttempted[2].parsed.operationMode, "Normal mode");
  assert.equal(readiness.commandsAttempted[3].parsed.temperatureC, 27);
  assert.deepEqual(readiness.commandsAttempted[3].parsed.temperaturePoints, [
    { point: 1, temperatureC: 27 },
    { point: 2, temperatureC: 28 },
  ]);
  assert.equal(readiness.commandsAttempted[4].parsed.unitInformation.totalUnits, 2);
  assert.deepEqual(readiness.commandsAttempted[4].parsed.unitInformation.units, [
    { index: 1, dimmingMethodCode: "0000", lightingOutputChannels: 8 },
    { index: 2, dimmingMethodCode: "0000", lightingOutputChannels: 8 },
  ]);
  assert.doesNotMatch(JSON.stringify(readiness).toLowerCase(), /certificate|certified|final ai grade|calibrated/);
});

test("Leimac unknown responses fail closed", async () => {
  const fake = fakeTransport("HELLO\r\n");
  const client = new LeimacIdmuClient({
    host: "169.254.191.156",
    transport: fake.transport,
  });

  const result = await client.status();

  assert.equal(result.ok, false);
  assert.equal(result.parsed.responseKind, "data");
  assert.equal(result.parsed.parseConfidence, "unknown");
  assert.match(result.error, /not confidently parsed/);
  assert.deepEqual(fake.calls.map((call) => call.ascii), ["R0801"]);
});

test("Leimac NAK responses are fail-closed with manual meanings", async () => {
  const fake = fakeTransport("NAK1\r\n");
  const client = new LeimacIdmuClient({
    host: "169.254.191.156",
    transport: fake.transport,
  });

  const result = await client.status();

  assert.equal(result.ok, false);
  assert.equal(result.parsed.responseKind, "nak");
  assert.equal(result.parsed.nakCode, "NAK1");
  assert.match(result.error, /Target designation problem/);

  const other = fakeTransport("WR00NAK\r\n");
  const otherClient = new LeimacIdmuClient({ host: "169.254.191.156", transport: other.transport });
  const otherResult = await otherClient.status();
  assert.equal(otherResult.ok, false);
  assert.equal(otherResult.parsed.nakCode, "WR00NAK");
  assert.match(otherResult.error, /incorrect header/);
});

test("Leimac transport failures return fail-closed readiness", async () => {
  const fake = fakeTransport(new Error("connection refused"));
  const client = new LeimacIdmuClient({
    host: "169.254.191.156",
    timeoutMs: 10,
    transport: fake.transport,
  });

  const readiness = await client.readiness();

  assert.equal(readiness.ok, false);
  assert.equal(readiness.status, "FAIL");
  assert.equal(readiness.commandsAttempted.length, 1);
  assert.equal(readiness.commandsAttempted.every((result) => result.ok === false), true);
  assert.match(readiness.commandsAttempted[0].error, /connection refused/);
});

test("CLI Leimac hardware path requires explicit host", async () => {
  const cli = await runCli(["leimac-idmu-readiness"]);

  assert.equal(cli.code, 1);
  assert.match(cli.stderr.error, /requires explicit --host/);
});
