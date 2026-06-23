const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LeimacIdmuClient,
  composeLeimacIdmuCommand,
  composeLeimacIdmuReadCommand,
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

test("Leimac command composer formats read commands only", () => {
  const firmware = composeLeimacIdmuReadCommand("firmware", { unit: 1 });
  const temperature = composeLeimacIdmuReadCommand("temperature", { unit: 2 });

  assert.equal(firmware.ascii, "R0116");
  assert.equal(firmware.frame, "R0116\r\n");
  assert.equal(firmware.metadata.header, "R");
  assert.equal(firmware.metadata.commandNumber, "16");
  assert.equal(firmware.metadata.readOnly, true);
  assert.equal(temperature.ascii, "R0280");
  assert.equal(temperature.metadata.unit, 2);
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
    if (request.ascii === "R0108") return "RR08OK\r\n";
    if (request.ascii === "R0116") return "RR16 firmware 1.2.3\r\n";
    if (request.ascii === "R0147") return "RR47 LevelLow\r\n";
    if (request.ascii === "R0180") return "RR80 42.5 C\r\n";
    if (request.ascii === "R0183") return "RR83 IDMU-P8B-12\r\n";
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
  assert.deepEqual(fake.calls.map((call) => call.ascii), ["R0108", "R0116", "R0147", "R0180", "R0183"]);
  assert.equal(readiness.commandsAttempted[1].parsed.firmwareVersion, "1.2.3");
  assert.equal(readiness.commandsAttempted[2].parsed.operationMode, "LevelLow");
  assert.equal(readiness.commandsAttempted[3].parsed.temperatureC, 42.5);
  assert.equal(readiness.commandsAttempted[4].parsed.unitModel, "IDMU-P8B-12");
  assert.doesNotMatch(JSON.stringify(readiness).toLowerCase(), /certificate|certified|final ai grade|calibrated/);
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
  assert.equal(readiness.commandsAttempted.length, 5);
  assert.equal(readiness.commandsAttempted.every((result) => result.ok === false), true);
  assert.match(readiness.commandsAttempted[0].error, /connection refused/);
});

test("CLI Leimac hardware path requires explicit host", async () => {
  const cli = await runCli(["leimac-idmu-readiness"]);

  assert.equal(cli.code, 1);
  assert.match(cli.stderr.error, /requires explicit --host/);
});

