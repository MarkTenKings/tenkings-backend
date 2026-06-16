const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DinoLiteBridgeClient,
  DinoLiteBridgeClientError,
  assertDinoLiteCaptureOutputDirAllowed,
  assertDinoLiteSdkRuntimeDirAllowed,
  buildCaptureHelperReadinessReport,
  getDinoLiteBridgeConfiguredStatus,
} = require("../dist");
const { runCaptureHelperCli } = require("../dist/cli");

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
  if (command === "dinolite.status") {
    return {
      adapter: "fake",
      simulated: true,
      comActiveXInstantiated: false,
      ocxVersion: "simulated",
      device: {
        index: 0,
        name: "Fake Dino-Lite Edge AF7915MZTL",
        description: "Simulated AF7915MZTL-like Dino-Lite microscope",
        deviceId: "FAKE-AF7915MZTL-0001",
      },
      connectedDuringCommand: true,
      previewDuringCommand: false,
      config: { bitfield: 124, decoded: { edof: true, amr: true, led: true, flc: true, axi: true } },
      amr: 42.5,
      videoFormat: { width: 1280, height: 1024 },
      exposure: { exposureValue: 12, gain: 3, autoExposure: 1 },
      ledState: 1,
      optionalErrors: [],
      cleanup: { previewStopped: false, disconnected: true, hostDisposed: true },
      forbiddenOperationsInvoked: false,
    };
  }
  if (command === "dinolite.captureStillJpg") {
    return {
      adapter: "fake",
      simulated: true,
      comActiveXInstantiated: false,
      device: {
        index: 0,
        name: "Fake Dino-Lite Edge AF7915MZTL",
      },
      outputFilePath: "C:\\TenKings\\capture-data\\dinolite-smoke\\fake-dinolite-still-20260609T000000Z.jpg",
      sha256: "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68",
      byteSize: 16,
      mimeType: "image/jpeg",
      timestamp: "2026-06-09T00:00:00.0000000Z",
      connectedDuringCommand: true,
      previewDuringCommand: true,
      config: { bitfield: 124 },
      amr: 42.5,
      cleanup: { previewStopped: true, disconnected: true, hostDisposed: true },
      forbiddenOperationsInvoked: false,
    };
  }
  if (command === "dinolite.capturePackage") {
    return {
      adapter: "fake",
      simulated: true,
      comActiveXInstantiated: false,
      packageId: "dinolite-card-demo-001-20260609T000000000Z",
      label: "card-demo-001",
      packageDir: "C:\\TenKings\\capture-data\\dinolite-demo\\dinolite-card-demo-001-20260609T000000000Z",
      manifestPath: "C:\\TenKings\\capture-data\\dinolite-demo\\dinolite-card-demo-001-20260609T000000000Z\\manifest.json",
      previewReportPath: "C:\\TenKings\\capture-data\\dinolite-demo\\dinolite-card-demo-001-20260609T000000000Z\\preview-report.html",
      timestamp: "2026-06-09T00:00:00.0000000Z",
      device: {
        index: 0,
        name: "Fake Dino-Lite Edge AF7915MZTL",
      },
      ocxVersion: "simulated",
      connectedDuringCommand: true,
      previewDuringCommand: true,
      config: { bitfield: 124 },
      amr: 42.5,
      runtimeDependencies: {
        adapter: "fake",
        simulated: true,
        runtimeDirConfigured: false,
        runtimeDirUsable: false,
        edofHelperAvailable: true,
        requiredFiles: [
          { fileName: "enfuse.exe", present: true },
          { fileName: "SMIUtility.dll", present: true },
          { fileName: "d3dx9_31.dll", present: true },
        ],
        currentDirectory: "simulated",
        baseDirectory: "simulated",
        pathMutation: "none",
      },
      captures: [
        {
          path: "C:\\TenKings\\capture-data\\dinolite-demo\\normal-still.jpg",
          filename: "normal-still.jpg",
          sha256: "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68",
          byteSize: 16,
          mimeType: "image/jpeg",
          timestamp: "2026-06-09T00:00:00.0000000Z",
          captureKind: "normal",
          lightingRecipe: "normal-still",
          status: "success",
        },
        {
          path: "C:\\TenKings\\capture-data\\dinolite-demo\\edr.jpg",
          filename: "edr.jpg",
          sha256: null,
          byteSize: 0,
          mimeType: "image/jpeg",
          timestamp: "2026-06-09T00:00:00.0000000Z",
          captureKind: "edr",
          lightingRecipe: "edr",
          status: "unavailable",
          error: { code: "FAKE_UNAVAILABLE", message: "Simulated unsupported Dino-Lite feature." },
        },
      ],
      cleanup: { previewStopped: true, disconnected: true, hostDisposed: true },
      limitations: ["Dino-Lite capture package preview -- not a certified grade."],
      forbiddenOperationsInvoked: false,
    };
  }
  if (command === "dinolite.operatorWorkflow") {
    return {
      adapter: "fake",
      simulated: true,
      comActiveXInstantiated: false,
      sessionId: "dinolite-operator-card-interim-smoke-20260609T000000000Z",
      label: "card-interim-smoke",
      plan: "card-interim",
      sessionDir: "C:\\TenKings\\capture-data\\dinolite-operator\\dinolite-operator-card-interim-smoke-20260609T000000000Z",
      manifestPath: "C:\\TenKings\\capture-data\\dinolite-operator\\dinolite-operator-card-interim-smoke-20260609T000000000Z\\manifest.json",
      previewReportPath: "C:\\TenKings\\capture-data\\dinolite-operator\\dinolite-operator-card-interim-smoke-20260609T000000000Z\\preview-report.html",
      timestamp: "2026-06-09T00:00:00.0000000Z",
      status: "completed",
      device: {
        index: 0,
        name: "Fake Dino-Lite Edge AF7915MZTL",
      },
      ocxVersion: "simulated",
      connectedDuringCommand: true,
      previewDuringCommand: true,
      config: { bitfield: 124 },
      amr: 42.5,
      options: { includeFlcSweep: false, includeEdr: false, includeEdof: false },
      targets: [
        {
          target: {
            id: "full-card-overview",
            name: "Full-card overview",
            type: "interim_macro_overview",
            reportLabel: "interim_full_card_overview",
            instruction:
              "Raise/zoom out/refocus the Dino-Lite so as much of the full card as possible is visible. This is an interim overview until the dedicated macro camera is integrated.",
            captureGuide:
              "Guide: fit as much of the card as possible inside the preview, keep all card edges visible, avoid excess background. This overview is interim and not calibrated macro capture.",
            captureGuidesEnabled: true,
            guideVisualKind: "full-card",
            guideVisualOrientation: "center",
            guideVisualLegend: "Fit full card inside this frame. Raise/zoom out/refocus; interim, not calibrated macro capture.",
            guideTemplateKind: "full_card_frame",
            guideTemplateAspectRatio: "2.5:3.5",
            guideTemplateScaleNote: "Physical scale is uncalibrated until AMR/calibration workflow is finalized.",
            cornerProfile: null,
          },
          targetIndex: 1,
          action: "capture",
          attempt: 1,
          status: "success",
          artifacts: [
            {
              path: "C:\\TenKings\\capture-data\\dinolite-operator\\01-full-card-overview-normal.jpg",
              filename: "01-full-card-overview-normal.jpg",
              sha256: "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68",
              byteSize: 16,
              mimeType: "image/jpeg",
              timestamp: "2026-06-09T00:00:00.0000000Z",
              captureKind: "normal",
              lightingRecipe: "full-card-overview-normal",
              status: "success",
            },
          ],
        },
        {
          target: {
            id: "top-left-corner",
            name: "Top-left corner",
            type: "corner",
            reportLabel: "top_left_corner",
            instruction: "Move the card so the top-left corner is centered under the microscope.",
            captureGuide:
              "Guide: place the corner tip at the center guide, include both edges, fill the frame mostly with card, avoid background. Corner profile: sharp_90.",
            captureGuidesEnabled: true,
            guideVisualKind: "corner",
            guideVisualOrientation: "top-left",
            guideVisualLegend: "Place corner tip on crosshair; align both card edges with yellow guides. Profile: sharp_90.",
            guideTemplateKind: "sharp_90_corner_template",
            guideTemplateAspectRatio: null,
            guideTemplateScaleNote: "Physical scale is uncalibrated until AMR/calibration workflow is finalized.",
            cornerProfile: "sharp_90",
          },
          targetIndex: 2,
          action: "capture",
          attempt: 1,
          status: "success",
          artifacts: [],
        },
      ],
      cleanup: { previewStopped: true, disconnected: true, hostDisposed: true },
      limitations: [
        "Dino-Lite operator workflow preview -- not a certified grade.",
        "Interim full-card overview is not production macro evidence.",
        "Interim full-card overview is not calibrated macro capture.",
        "Session output is not certified grading evidence.",
      ],
      forbiddenOperationsInvoked: false,
    };
  }
  if (command === "dinolite.runtimeDiagnostics") {
    return {
      adapter: "fake",
      simulated: true,
      runtimeDirConfigured: false,
      runtimeDirUsable: false,
      edofHelperAvailable: true,
      requiredFiles: [
        { fileName: "enfuse.exe", present: true },
        { fileName: "SMIUtility.dll", present: true },
        { fileName: "d3dx9_31.dll", present: true },
      ],
      currentDirectory: "simulated",
      baseDirectory: "simulated",
      pathMutation: "none",
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

test("client maps fake manual status and still capture responses", async () => {
  const spawned = [];
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 100, manualHardwareAccess: true },
    (command, args) => {
      spawned.push({ command, args });
      return new FakeBridgeProcess();
    }
  );

  const status = await client.status(0);
  const capture = await client.captureStillJpg(0, "C:\\TenKings\\capture-data\\dinolite-smoke");
  await client.close();

  assert.deepEqual(spawned[0].args, ["--adapter", "fake", "--manual-hardware"]);
  assert.equal(status.connectedDuringCommand, true);
  assert.equal(status.previewDuringCommand, false);
  assert.equal(status.forbiddenOperationsInvoked, false);
  assert.equal(capture.mimeType, "image/jpeg");
  assert.equal(capture.byteSize, 16);
  assert.equal(capture.sha256, "575b00ae2fefbbacf7b92d1fd8b839ecfb2979661cc2202b9b08052fb1e48a68");
  assert.equal(capture.previewDuringCommand, true);
  assert.equal(capture.forbiddenOperationsInvoked, false);
});

test("client maps fake capture package response shape", async () => {
  const spawned = [];
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 100, manualHardwareAccess: true },
    (command, args) => {
      spawned.push({ command, args });
      return new FakeBridgeProcess();
    }
  );

  const capturePackage = await client.capturePackage({
    deviceIndex: 0,
    outputDir: "C:\\TenKings\\capture-data\\dinolite-demo",
    label: "card-demo-001",
    includeLightingSweep: true,
    includeEdr: true,
    includeEdof: true,
  });
  await client.close();

  assert.deepEqual(spawned[0].args, ["--adapter", "fake", "--manual-hardware"]);
  assert.equal(capturePackage.packageId, "dinolite-card-demo-001-20260609T000000000Z");
  assert.match(capturePackage.previewReportPath, /preview-report\.html$/);
  assert.equal(capturePackage.captures[0].captureKind, "normal");
  assert.equal(capturePackage.captures[0].status, "success");
  assert.equal(capturePackage.captures[1].captureKind, "edr");
  assert.equal(capturePackage.captures[1].status, "unavailable");
  assert.equal(capturePackage.runtimeDependencies.edofHelperAvailable, true);
  assert.equal(capturePackage.forbiddenOperationsInvoked, false);
});

test("client maps fake operator workflow response shape", async () => {
  const spawned = [];
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 100, manualHardwareAccess: true },
    (command, args, options) => {
      spawned.push({ command, args, options });
      return new FakeBridgeProcess();
    }
  );

  const workflow = await client.operatorWorkflow({
    deviceIndex: 0,
    outputDir: "C:\\TenKings\\capture-data\\dinolite-operator",
    label: "card-interim-smoke",
    plan: "card-interim",
    cornerProfile: "sharp_90",
    captureGuides: true,
  });
  await client.close();

  assert.deepEqual(spawned[0].args, ["--adapter", "fake", "--manual-hardware"]);
  assert.equal(spawned[0].options.windowsHide, false);
  assert.equal(workflow.plan, "card-interim");
  assert.equal(workflow.targets[0].target.id, "full-card-overview");
  assert.equal(workflow.targets[0].target.type, "interim_macro_overview");
  assert.equal(workflow.targets[0].target.reportLabel, "interim_full_card_overview");
  assert.match(workflow.targets[0].target.captureGuide, /fit as much of the card as possible/);
  assert.equal(workflow.targets[0].target.guideVisualKind, "full-card");
  assert.equal(workflow.targets[0].target.guideVisualOrientation, "center");
  assert.match(workflow.targets[0].target.guideVisualLegend, /Fit full card inside this frame/);
  assert.equal(workflow.targets[0].target.guideTemplateKind, "full_card_frame");
  assert.equal(workflow.targets[0].target.guideTemplateAspectRatio, "2.5:3.5");
  assert.match(workflow.targets[0].target.guideTemplateScaleNote, /Physical scale is uncalibrated/);
  assert.equal(workflow.targets[1].target.cornerProfile, "sharp_90");
  assert.equal(workflow.targets[1].target.guideVisualKind, "corner");
  assert.equal(workflow.targets[1].target.guideVisualOrientation, "top-left");
  assert.equal(workflow.targets[1].target.guideTemplateKind, "sharp_90_corner_template");
  assert.equal(workflow.targets[0].artifacts[0].mimeType, "image/jpeg");
  assert.match(workflow.limitations.join(" "), /not production macro evidence/);
  assert.match(workflow.limitations.join(" "), /not calibrated macro capture/);
  assert.match(workflow.limitations.join(" "), /not certified grading evidence/);
  assert.equal(workflow.forbiddenOperationsInvoked, false);
});

test("client passes sdk runtime dir only for explicit manual hardware spawn", async () => {
  const spawned = [];
  const client = new DinoLiteBridgeClient(
    {
      executablePath: "bridge.exe",
      adapter: "dnvideox",
      timeoutMs: 100,
      manualHardwareAccess: true,
      sdkRuntimeDir: "C:\\TenKings\\sdk\\dino-lite\\dnvideox-sdk",
    },
    (command, args) => {
      spawned.push({ command, args });
      return new FakeBridgeProcess();
    }
  );

  const diagnostics = await client.runtimeDiagnostics();
  await client.close();

  assert.deepEqual(spawned[0].args, [
    "--adapter",
    "dnvideox",
    "--manual-hardware",
    "--sdk-runtime-dir",
    "C:\\TenKings\\sdk\\dino-lite\\dnvideox-sdk",
  ]);
  assert.equal(diagnostics.edofHelperAvailable, true);
});

test("real adapter manual hardware commands do not allow health path", async () => {
  const client = new DinoLiteBridgeClient(
    { executablePath: "bridge.exe", adapter: "dnvideox", timeoutMs: 100, manualHardwareAccess: true },
    () => new FakeBridgeProcess()
  );

  await assert.rejects(() => client.health(), (error) => {
    assert.equal(error instanceof DinoLiteBridgeClientError, true);
    assert.equal(error.code, "REAL_BRIDGE_COMMAND_DISABLED");
    return true;
  });

  const status = await client.status(0);
  const capturePackage = await client.capturePackage({
    deviceIndex: 0,
    outputDir: "C:\\TenKings\\capture-data\\dinolite-demo",
    label: "card-demo-001",
  });
  await client.close();
  assert.equal(status.connectedDuringCommand, true);
  assert.equal(capturePackage.previewDuringCommand, true);
});

test("real adapter manual hardware commands allow operator workflow but not health", async () => {
  let bridgeProcess;
  const client = new DinoLiteBridgeClient(
    { executablePath: "bridge.exe", adapter: "dnvideox", timeoutMs: 100, manualHardwareAccess: true },
    () => {
      bridgeProcess = new FakeBridgeProcess();
      return bridgeProcess;
    }
  );

  await assert.rejects(() => client.health(), (error) => {
    assert.equal(error instanceof DinoLiteBridgeClientError, true);
    assert.equal(error.code, "REAL_BRIDGE_COMMAND_DISABLED");
    return true;
  });

  const workflow = await client.operatorWorkflow({
    deviceIndex: 0,
    outputDir: "C:\\TenKings\\capture-data\\dinolite-operator",
    plan: "card-interim",
    cornerProfile: "sharp_90",
    captureGuides: true,
  });
  await client.close();

  assert.equal(workflow.targets[0].target.id, "full-card-overview");
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("dinolite.operatorWorkflow")), true);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("\"cornerProfile\":\"sharp_90\"")), true);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("SetLensPos")), false);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("AutoFocus")), false);
  assert.equal(bridgeProcess.stdin.writes.some((chunk) => chunk.includes("SetExposureValue")), false);
});

test("client times out when bridge does not respond", async () => {
  let bridgeProcess;
  const client = new DinoLiteBridgeClient(
    { executablePath: "fake-bridge.exe", adapter: "fake", timeoutMs: 5 },
    () => {
      bridgeProcess = new FakeBridgeProcess({ ignoreWrites: true });
      return bridgeProcess;
    }
  );

  await assert.rejects(() => client.health(), (error) => {
    assert.equal(error instanceof DinoLiteBridgeClientError, true);
    assert.equal(error.code, "BRIDGE_TIMEOUT");
    return true;
  });
  assert.equal(bridgeProcess.killed, true);
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
    /manual hardware/
  );
});

test("capture output directory guard rejects missing and repo paths", () => {
  assert.throws(() => assertDinoLiteCaptureOutputDirAllowed(""), /requires --output-dir/);
  assert.throws(
    () => assertDinoLiteCaptureOutputDirAllowed(process.cwd(), process.cwd()),
    /outside the git repo/
  );
  assert.equal(
    assertDinoLiteCaptureOutputDirAllowed(path.join(os.tmpdir(), "dinolite-smoke"), process.cwd()),
    path.resolve(os.tmpdir(), "dinolite-smoke")
  );
});

test("sdk runtime directory guard rejects missing and repo paths", () => {
  assert.throws(() => assertDinoLiteSdkRuntimeDirAllowed(""), /requires --sdk-runtime-dir/);
  assert.throws(
    () => assertDinoLiteSdkRuntimeDirAllowed(process.cwd(), process.cwd()),
    /outside the git repo/
  );
  assert.equal(
    assertDinoLiteSdkRuntimeDirAllowed(path.join(os.tmpdir(), "dnvideox-runtime"), process.cwd()),
    path.resolve(os.tmpdir(), "dnvideox-runtime")
  );
});

test("cli capture command rejects missing explicit output dir before spawning", async () => {
  let stdout = "";
  let stderr = "";
  const code = await runCaptureHelperCli(
    ["dinolite-capture-still", "--bridge-exe", "bridge.exe", "--adapter", "dnvideox", "--device-index", "0"],
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /requires --output-dir/);
});

test("cli capture command rejects output inside repo before spawning", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-capture-still",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      process.cwd(),
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /outside the git repo/);
});

test("cli capture package rejects missing label before spawning", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-capture-package",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      path.join(os.tmpdir(), "dinolite-demo"),
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /requires --label/);
});

test("cli capture package rejects output inside repo before spawning", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-capture-demo-package",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      process.cwd(),
      "--label",
      "card-demo-001",
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /outside the git repo/);
});

test("cli capture package rejects sdk runtime dir inside repo before spawning", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-capture-demo-package",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      path.join(os.tmpdir(), "dinolite-demo"),
      "--label",
      "card-demo-001",
      "--sdk-runtime-dir",
      process.cwd(),
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /SDK runtime directory must be outside the git repo/);
});

test("cli operator workflow rejects output inside repo before spawning", async () => {
  let stderr = "";
  const code = await runCaptureHelperCli(
    [
      "dinolite-operator-workflow",
      "--bridge-exe",
      "bridge.exe",
      "--adapter",
      "dnvideox",
      "--device-index",
      "0",
      "--output-dir",
      process.cwd(),
      "--plan",
      "card-interim",
    ],
    {
      stderr: (text) => {
        stderr += text;
      },
      env: {},
    }
  );

  assert.equal(code, 1);
  assert.match(stderr, /outside the git repo/);
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

