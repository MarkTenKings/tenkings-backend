const { EventEmitter } = require("node:events");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DinoLiteBridgeClient,
  DinoLiteBridgeClientError,
  buildCaptureHelperReadinessReport,
  getDinoLiteBridgeConfiguredStatus,
} = require("../dist");

class FakeStream extends EventEmitter {}

class FakeStdin {
  constructor(handler) {
    this.handler = handler;
    this.writes = [];
    this.ended = false;
  }

  write(chunk) {
    this.writes.push(chunk);
    this.handler(chunk);
    return true;
  }

  end() {
    this.ended = true;
  }
}

class FakeBridgeProcess extends EventEmitter {
  constructor(options = {}) {
    super();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.killed = false;
    this.options = options;
    this.stdin = new FakeStdin((chunk) => this.handleWrite(chunk));
  }

  kill() {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }

  handleWrite(chunk) {
    if (this.options.ignoreWrites) return;
    const lines = String(chunk).split("\n").filter(Boolean);
    for (const line of lines) {
      const request = JSON.parse(line);
      if (request.command === "exit") {
        this.writeResponse({ id: request.id, ok: true, result: { status: "BYE" } });
        this.emit("exit", 0, null);
        return;
      }
      if (this.options.exitBeforeResponse) {
        this.emit("exit", 2, null);
        return;
      }
      const result = fakeResult(request.command);
      if (result) {
        this.writeResponse({ id: request.id, ok: true, result });
      } else {
        this.writeResponse({
          id: request.id,
          ok: false,
          error: { code: "INVALID_COMMAND", message: `Unsupported command: ${request.command}` },
        });
      }
    }
  }

  writeResponse(response) {
    this.stdout.emit("data", `${JSON.stringify(response)}\n`);
  }
}

function fakeResult(command) {
  if (command === "health") {
    return {
      status: "OK",
      adapter: "fake",
      hardwareAccess: "disabled",
      comActiveXInstantiated: false,
      message: "fake ok",
    };
  }
  if (command === "sdkInfo") {
    return {
      adapter: "fake",
      sdk: "DNVideoX",
      mode: "simulated",
      registeredActiveXPath: "C:\\Windows\\SysWOW64\\DNVideoX.ocx",
      targetFramework: ".NET Framework 4.8",
      platform: "x86",
      threadingModel: "STA",
      comActiveXInstantiated: false,
    };
  }
  if (command === "listDevices") {
    return {
      adapter: "fake",
      devices: [
        {
          id: "fake-dinolite-af7915mztl-001",
          model: "Dino-Lite Edge AF7915MZTL",
          serial: "FAKE-AF7915MZTL-0001",
          displayName: "Fake Dino-Lite Edge AF7915MZTL",
          simulated: true,
        },
      ],
    };
  }
  if (command === "capabilities") {
    return {
      adapter: "fake",
      simulated: true,
      stillCapture: true,
      amr: true,
      flc: true,
      edr: true,
      edof: true,
      controlsImplemented: false,
      captureImplemented: false,
    };
  }
  if (command === "dinolite.enumerateDevices") {
    return {
      adapter: "fake",
      comActiveXInstantiated: false,
      connected: false,
      preview: false,
      deviceCount: 1,
      devices: [
        {
          index: 0,
          name: "Fake Dino-Lite Edge AF7915MZTL",
          description: "Simulated AF7915MZTL-like Dino-Lite microscope",
          deviceId: "FAKE-AF7915MZTL-0001",
          simulated: true,
        },
      ],
      sdk: {
        control: "DNVideoX",
        version: "simulated",
        progId: "VIDEOCAPX.VideoCapXCtrl.1",
      },
      forbiddenOperationsInvoked: false,
    };
  }
  return undefined;
}

test("client maps fake bridge health listDevices and capabilities", async () => {
  const spawned = [];
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 100 },
    (command, args) => {
      spawned.push({ command, args });
      return new FakeBridgeProcess();
    }
  );

  const health = await client.health();
  const sdkInfo = await client.sdkInfo();
  const devices = await client.listDevices();
  const capabilities = await client.capabilities();
  await client.close();

  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, "fake-bridge.exe");
  assert.deepEqual(spawned[0].args, ["--adapter", "fake"]);
  assert.equal(health.status, "OK");
  assert.equal(sdkInfo.sdk, "DNVideoX");
  assert.equal(devices.devices[0].model, "Dino-Lite Edge AF7915MZTL");
  assert.equal(capabilities.stillCapture, true);
  assert.equal(capabilities.edr, true);
  assert.equal(capabilities.edof, true);
});

test("client maps fake manual enumeration response shape", async () => {
  const spawned = [];
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 100, manualEnumeration: true },
    (command, args) => {
      spawned.push({ command, args });
      return new FakeBridgeProcess();
    }
  );

  const enumeration = await client.enumerateDevices();
  await client.close();

  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, ["--adapter", "fake", "--manual-enumerate"]);
  assert.equal(enumeration.adapter, "fake");
  assert.equal(enumeration.comActiveXInstantiated, false);
  assert.equal(enumeration.connected, false);
  assert.equal(enumeration.preview, false);
  assert.equal(enumeration.deviceCount, 1);
  assert.equal(enumeration.devices[0].name, "Fake Dino-Lite Edge AF7915MZTL");
  assert.equal(enumeration.forbiddenOperationsInvoked, false);
});

test("real adapter is restricted to explicit manual enumeration", async () => {
  const spawned = [];
  let bridgeProcess;
  const client = new DinoLiteBridgeClient(
    { executablePath: "bridge.exe", adapter: "dnvideox", timeoutMs: 100, manualEnumeration: true },
    (command, args) => {
      spawned.push({ command, args });
      bridgeProcess = new FakeBridgeProcess();
      return bridgeProcess;
    }
  );

  await assert.rejects(() => client.health(), (error) => {
    assert.equal(error instanceof DinoLiteBridgeClientError, true);
    assert.equal(error.code, "REAL_BRIDGE_COMMAND_DISABLED");
    return true;
  });

  const enumeration = await client.enumerateDevices();
  await client.close();

  assert.deepEqual(spawned[0].args, ["--adapter", "dnvideox", "--manual-enumerate"]);
  assert.equal(enumeration.deviceCount, 1);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("dinolite.enumerateDevices")), true);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("Connected")), false);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("Preview")), false);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("GrabFrame")), false);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("SetLEDState")), false);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("AutoFocus")), false);
});

test("client times out when bridge does not respond", async () => {
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 5 },
    () => new FakeBridgeProcess({ ignoreWrites: true })
  );

  await assert.rejects(() => client.health(), (error) => {
    assert.equal(error instanceof DinoLiteBridgeClientError, true);
    assert.equal(error.code, "BRIDGE_TIMEOUT");
    return true;
  });
});

test("client maps process exit before response", async () => {
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 100 },
    () => new FakeBridgeProcess({ exitBeforeResponse: true })
  );

  await assert.rejects(() => client.health(), (error) => {
    assert.equal(error instanceof DinoLiteBridgeClientError, true);
    assert.equal(error.code, "BRIDGE_PROCESS_EXITED");
    return true;
  });
});

test("client rejects missing path and real adapter spawn", () => {
  assert.throws(
    () => new DinoLiteBridgeClient({ adapter: "fake" }),
    /Dino-Lite bridge executable path is required/
  );
  assert.throws(
    () => new DinoLiteBridgeClient({ executablePath: "bridge.exe", adapter: "dnvideox" }),
    /manual enumeration/
  );
});

test("readiness default reports bridge unconfigured without spawning", () => {
  let spawned = false;
  const status = getDinoLiteBridgeConfiguredStatus({});
  const report = buildCaptureHelperReadinessReport(
    {
      simulator: {
        tenantId: "tenant-dinolite",
        captureSessionId: "session-dinolite",
        rigId: "rig-dinolite",
        locationId: "location-dinolite",
        operatorId: "operator-dinolite",
        helperInstanceId: "helper-dinolite",
      },
    },
    {},
    { pathExists: () => false }
  );

  assert.equal(status.configured, false);
  assert.equal(report.overallStatus, "PASS");
  assert.equal(report.dinoliteBridgeChecks[0].status, "PASS");
  assert.equal(report.dinoliteBridgeChecks[0].details.configured, false);
  assert.equal(spawned, false);
});

