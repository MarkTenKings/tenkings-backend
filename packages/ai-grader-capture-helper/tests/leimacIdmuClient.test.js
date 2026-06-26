const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEIMAC_IDMU_SAFE_OFF_CONFIRMATION,
  LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
  LeimacIdmuClient,
  buildLeimacIdmuSafeOffFrames,
  buildLeimacIdmuTriggerProfilePlan,
  buildLeimacIdmuTriggerSyncPlan,
  composeLeimacIdmuChannelWriteFrame,
  composeLeimacIdmuCommand,
  composeLeimacIdmuReadCommand,
  composeLeimacIdmuUnsafeWriteCommandForTest,
  normalizeLeimacIdmuDiagnosticReadFrame,
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
  assert.equal(unitInfo.ascii, "R830000");
  assert.equal(unitInfo.frame, "R830000");
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

test("Leimac diagnostic read-frame validation rejects unsafe frames", () => {
  assert.throws(() => normalizeLeimacIdmuDiagnosticReadFrame("W01010001"), /rejects W\/write frames/);
  assert.throws(() => normalizeLeimacIdmuDiagnosticReadFrame("X0801"), /must start with R/);
  assert.throws(() => normalizeLeimacIdmuDiagnosticReadFrame("R08-01"), /uppercase ASCII alphanumeric/);
  assert.throws(() => normalizeLeimacIdmuDiagnosticReadFrame(`R${"0".repeat(32)}`), /32 ASCII characters or fewer/);
  assert.throws(() => normalizeLeimacIdmuDiagnosticReadFrame("R1101"), /not in the read allowlist/);
  assert.equal(normalizeLeimacIdmuDiagnosticReadFrame(" R0801 "), "R0801");
});

test("Leimac successful read responses preserve raw data and parse confident fields only", async () => {
  const fake = fakeTransport((request) => {
    if (request.ascii === "R0801") return "R08010000\r\n";
    if (request.ascii === "R1601") return "R160101.23.45.67\r\n";
    if (request.ascii === "R47") return "R470000\r\n";
    if (request.ascii === "R8001") return "R8001010027020028\r\n";
    if (request.ascii === "R830000") return "R8300020000000800000008\r\n";
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
  assert.deepEqual(fake.calls.map((call) => call.ascii), ["R0801", "R1601", "R47", "R8001", "R830000"]);
  assert.deepEqual(fake.calls.map((call) => call.frame), ["R0801", "R1601", "R47", "R8001", "R830000"]);
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

test("Leimac diagnostic read-frame reports the exact no-terminator request frame", async () => {
  const fake = fakeTransport((request) => {
    assert.equal(request.ascii, "R0801");
    assert.equal(request.frame, "R0801");
    return "R08010000\r\n";
  });
  const client = new LeimacIdmuClient({
    host: "169.254.191.156",
    port: 1000,
    timeoutMs: 1500,
    transport: fake.transport,
  });

  const result = await client.readFrame("R0801");

  assert.equal(result.ok, true);
  assert.equal(result.requestAscii, "R0801");
  assert.equal(result.requestFrame, "R0801");
  assert.equal(result.command.diagnosticFrame, true);
  assert.equal(result.parsed.statusCode, "0000");
  assert.deepEqual(fake.calls.map((call) => call.frame), ["R0801"]);
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

test("CLI Leimac diagnostic read-frame rejects unsafe frames before hardware", async () => {
  for (const frame of ["W01010001", "X0801", "R08-01", `R${"0".repeat(32)}`]) {
    const cli = await runCli(["leimac-idmu-read-frame", "--host", "169.254.191.156", "--frame", frame]);
    assert.equal(cli.code, 1);
    assert.match(cli.stderr.error, /Leimac IDMU/);
  }
});

test("Leimac trigger sync plan is dry-run only and reports safety flags", async () => {
  const plan = buildLeimacIdmuTriggerSyncPlan("basler-exposure-active-to-trg-in1");
  assert.equal(plan.basler.lineSelector, "Line 2");
  assert.equal(plan.basler.lineMode, "Output");
  assert.equal(plan.basler.lineInverter, false);
  assert.equal(plan.basler.lineSource, "Exposure Active");
  assert.equal(plan.leimac.triggerInput, "TRG IN1");
  assert.equal(plan.leimac.triggerControlMode, "Level Low");
  assert.equal(plan.safety.dryRun, true);
  assert.equal(plan.safety.writesApplied, false);
  assert.equal(plan.safety.lightsCommanded, false);
  assert.equal(plan.safety.baslerSettingsChanged, false);
  assert.equal(plan.safety.leimacSettingsChanged, false);

  const cli = await runCli(["leimac-idmu-trigger-sync-plan", "--mode", "basler-exposure-active-to-trg-in1"]);
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout.plan.safety.dryRun, true);
  assert.equal(cli.stdout.plan.safety.writesApplied, false);
  assert.equal(cli.stdout.plan.safety.lightsCommanded, false);
  assert.equal(cli.stdout.plan.safety.baslerSettingsChanged, false);
  assert.equal(cli.stdout.plan.safety.leimacSettingsChanged, false);
  assert.match(JSON.stringify(cli.stdout), /CEBR119 or CEBR120/);
  assert.doesNotMatch(JSON.stringify(cli.stdout).toLowerCase(), /certificate|certified|final ai grade|calibrated/);
});

test("Leimac safe-off and trigger-profile frames use command-before-unit channel data", () => {
  const safeOff = buildLeimacIdmuSafeOffFrames(1);
  assert.deepEqual(safeOff.map((frame) => frame.requestFrame), [
    "W8601010000020000030000040000050000060000070000080000",
    "W8501010000020000030000040000050000060000070000080000",
    "W1101010000020000030000040000050000060000070000080000",
  ]);

  const plan = buildLeimacIdmuTriggerProfilePlan({ dutyPercent: 5, unit: 1 });
  assert.equal(plan.dutyPercent, 5);
  assert.equal(plan.dutySteps, 50);
  assert.equal(plan.outputTimeWritten, false);
  assert.equal(plan.persistentSaved, false);
  assert.equal(plan.safety.arbitraryWritesAllowed, false);
  assert.equal(plan.safety.maxDutyPercent, 5);
  assert.deepEqual(plan.frames.map((frame) => frame.requestFrame), [
    "W8601010000020000030000040000050000060000070000080000",
    "W8501010000020000030000040000050000060000070000080000",
    "W1101010000020000030000040000050000060000070000080000",
    "W0901010002020002030002040002050002060002070002080002",
    "W6501010000020000030000040000050000060000070000080000",
    "W8401010000020000030000040000050000060000070000080000",
    "W1301010000020000030000040000050000060000070000080000",
    "W1101010050020050030050040050050050060050070050080050",
    "W8501010000020000030000040000050000060000070000080000",
    "W8601010001020001030001040001050001060001070001080001",
  ]);
  assert.equal(plan.frames.some((frame) => frame.commandNumber === "01"), false);
  assert.doesNotMatch(
    plan.frames.map((frame) => `${frame.name} ${frame.description}`).join(" ").toLowerCase(),
    /user set|userset|system reset|factory default/
  );
});

test("Leimac trigger profile rejects high duty and arbitrary writes", async () => {
  assert.throws(() => buildLeimacIdmuTriggerProfilePlan({ dutyPercent: 6 }), /capped at 5%/);
  assert.throws(
    () => composeLeimacIdmuChannelWriteFrame({ name: "factoryDefault", unit: 1, value: "0000", meaning: "unsafe" }),
    /allowlist/
  );

  const cli = await runCli(["leimac-idmu-trigger-profile", "--duty", "6"]);
  assert.equal(cli.code, 1);
  assert.match(cli.stderr.error, /capped at 5%/);
});

test("Leimac trigger profile apply requires confirmation and sends only allowlisted frames", async () => {
  const missingConfirmation = new LeimacIdmuClient({
    host: "169.254.191.156",
    transport: fakeTransport("ACK\r\n").transport,
  });
  await assert.rejects(
    () => missingConfirmation.applyTriggerProfile({ apply: true, dutyPercent: 5 }),
    /requires --confirm/
  );

  const fake = fakeTransport((request) => {
    if (request.ascii === "R830000") return "R83000100000008\r\n";
    if (request.ascii.startsWith("W")) return "ACK\r\n";
    return "WR00NAK\r\n";
  });
  const client = new LeimacIdmuClient({
    host: "169.254.191.156",
    port: 1000,
    timeoutMs: 1500,
    transport: fake.transport,
  });

  const result = await client.applyTriggerProfile({
    apply: true,
    dutyPercent: 5,
    confirmation: LEIMAC_IDMU_TRIGGER_PROFILE_CONFIRMATION,
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(result.unitInfo.parsed.unitInformation.totalUnits, 1);
  assert.equal(result.safeOffBeforeProfile.length, 3);
  assert.equal(result.writes.length, 7);
  assert.deepEqual(fake.calls.map((call) => call.ascii), [
    "R830000",
    "W8601010000020000030000040000050000060000070000080000",
    "W8501010000020000030000040000050000060000070000080000",
    "W1101010000020000030000040000050000060000070000080000",
    "W0901010002020002030002040002050002060002070002080002",
    "W6501010000020000030000040000050000060000070000080000",
    "W8401010000020000030000040000050000060000070000080000",
    "W1301010000020000030000040000050000060000070000080000",
    "W1101010050020050030050040050050050060050070050080050",
    "W8501010000020000030000040000050000060000070000080000",
    "W8601010001020001030001040001050001060001070001080001",
  ]);
  assert.equal(fake.calls.every((call) => call.frame === call.ascii), true);
});

test("Leimac safe-off CLI dry-run and apply confirmation are guarded", async () => {
  const dryRun = await runCli(["leimac-idmu-safe-off"]);
  assert.equal(dryRun.code, 0);
  assert.equal(dryRun.stdout.dryRun, true);
  assert.deepEqual(dryRun.stdout.frames.map((frame) => frame.requestFrame), [
    "W8601010000020000030000040000050000060000070000080000",
    "W8501010000020000030000040000050000060000070000080000",
    "W1101010000020000030000040000050000060000070000080000",
  ]);

  const missingConfirm = await runCli(["leimac-idmu-safe-off", "--host", "169.254.191.156", "--apply"]);
  assert.equal(missingConfirm.code, 1);
  assert.match(missingConfirm.stderr.error, new RegExp(LEIMAC_IDMU_SAFE_OFF_CONFIRMATION));
});
