const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BaslerLeimacMathematicalCalibrationSessionV1_2,
} = require("../dist/drivers/baslerLeimacMathematicalCalibrationSessionV1_2");

const openedContext = {
  camera: {
    serialNumber: "camera-serial-1",
    modelName: "camera-model-1",
    exposureUs: 6200,
    gain: 0,
    pixelFormat: "Mono8",
    widthPx: 1000,
    heightPx: 1400,
  },
  controller: { identity: "controller-1", unit: 1, responseKinds: ["ack"] },
};

function fakeSpawner(configure) {
  const children = [];
  const spawnProcess = (_executable, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.closed = false;
    child.killCount = 0;
    child.emitClose = (code = 0, signal = null) => {
      if (child.closed) return;
      child.closed = true;
      child.stdout.end();
      child.stderr.end();
      child.emit("close", code, signal);
    };
    child.kill = (signal = "SIGTERM") => {
      child.killed = true;
      child.killCount += 1;
      setImmediate(() => child.emitClose(null, signal));
      return true;
    };
    children.push(child);
    configure(child, args);
    return child;
  };
  return { children, spawnProcess };
}

function writeEnvelope(child, value) {
  child.stdout.write(`${JSON.stringify(value)}\n`);
}

function onRequests(child, callback) {
  let buffered = "";
  child.stdin.on("data", (chunk) => {
    buffered += String(chunk);
    while (buffered.includes("\n")) {
      const index = buffered.indexOf("\n");
      const line = buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      if (line) callback(JSON.parse(line));
    }
  });
}

function sessionConfig(spawnProcess, overrides = {}) {
  return {
    outputDir: path.join(os.tmpdir(), "tk-v12-persistent-owner-tests"),
    cameraIndex: 0,
    bridgeScriptPath: "C:\\fixture\\basler-pylon-bridge.ps1",
    powershellPath: "C:\\fixture\\powershell.exe",
    timeoutMs: 40,
    terminationTimeoutMs: 40,
    spawnProcess,
    exposureUs: 6200,
    gain: 0,
    leimacHost: "127.0.0.1",
    leimacPort: 1000,
    leimacUnit: 1,
    dutyPercent: 1,
    ...overrides,
  };
}

function emitOpened(child) {
  setImmediate(() => writeEnvelope(child, { ok: true, event: "opened", result: openedContext }));
}

test("close acknowledgement does not resolve until the child exits and releases ownership", async () => {
  const fake = fakeSpawner((child) => {
    emitOpened(child);
    onRequests(child, (request) => {
      if (request.command === "close") {
        writeEnvelope(child, {
          ok: true,
          event: "closed",
          requestId: request.requestId,
          result: { responseKinds: ["ack"] },
        });
      }
    });
  });
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess, {
    terminationTimeoutMs: 250,
  }));
  await session.open();
  let settled = false;
  const closing = session.close().then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false);
  assert.equal(fake.children[0].closed, false);
  fake.children[0].emitClose(0);
  await closing;
  assert.equal(settled, true);
  assert.equal(fake.children[0].killCount, 0);
});

test("open timeout terminates the child before rejecting and leaves no owner", async () => {
  const fake = fakeSpawner(() => {});
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess));
  await assert.rejects(session.open(), /opened timed out/);
  assert.equal(fake.children[0].closed, true);
  assert.ok(fake.children[0].killCount >= 1);
});

test("request timeout clears pending protocol state and terminates the persistent owner", async () => {
  const fake = fakeSpawner((child) => {
    emitOpened(child);
    onRequests(child, () => {});
  });
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess));
  await session.open();
  await assert.rejects(session.capture({
    operationId: "timeout-operation",
    role: "flat_field",
    channelIndex: 1,
    sampleIndex: 1,
    dutyPercent: 1,
  }), /capture timed out/);
  assert.equal(fake.children[0].closed, true);
  assert.ok(fake.children[0].killCount >= 1);
  await session.close();
});

test("live-context probe timeout terminates its one-shot child before rejecting", async () => {
  const fake = fakeSpawner(() => {});
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess));
  await assert.rejects(session.probeContext(), /live-context probe timed out/);
  assert.equal(fake.children[0].closed, true);
  assert.ok(fake.children[0].killCount >= 1);
});

test("live-context probe returns only exact observed safe-off acknowledgements", async () => {
  const accepted = fakeSpawner((child) => setImmediate(() => {
    child.stdout.write(JSON.stringify({ ok: true, result: openedContext }));
    child.emitClose(0);
  }));
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(accepted.spawnProcess));
  assert.deepEqual(await session.probeContext(), openedContext);

  const rejected = fakeSpawner((child) => setImmediate(() => {
    child.stdout.write(JSON.stringify({ ok: true, result: {
      ...openedContext,
      controller: { ...openedContext.controller, responseKinds: ["nak"] },
    } }));
    child.emitClose(0);
  }));
  const invalid = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(rejected.spawnProcess));
  await assert.rejects(() => invalid.probeContext(), /safe-off responses.*acknowledgements/i);
});

test("non-JSON protocol output fails closed and terminates the owner", async () => {
  const fake = fakeSpawner((child) => {
    emitOpened(child);
    onRequests(child, (request) => {
      if (request.command === "capture") child.stdout.write("not-json\n");
    });
  });
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess));
  await session.open();
  await assert.rejects(session.capture({
    operationId: "invalid-output-operation",
    role: "illumination_pattern",
    channelIndex: 1,
    sampleIndex: 1,
    dutyPercent: 1,
  }), /non-JSON output/);
  assert.equal(fake.children[0].closed, true);
  assert.ok(fake.children[0].killCount >= 1);
});

test("unexpected child exit rejects the exact request with no orphan owner", async () => {
  const fake = fakeSpawner((child) => {
    emitOpened(child);
    onRequests(child, (request) => {
      if (request.command === "capture") setImmediate(() => child.emitClose(7));
    });
  });
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess));
  await session.open();
  await assert.rejects(session.capture({
    operationId: "unexpected-exit-operation",
    role: "dark_control",
    channelIndex: 1,
    sampleIndex: 1,
    dutyPercent: 0,
  }), /exited 7 before completing its request/);
  assert.equal(fake.children[0].closed, true);
  await session.close();
});

test("close rejects a non-acknowledged safe-off and still terminates the owner", async () => {
  const fake = fakeSpawner((child) => {
    emitOpened(child);
    onRequests(child, (request) => {
      if (request.command === "close") {
        writeEnvelope(child, {
          ok: true,
          event: "closed",
          requestId: request.requestId,
          result: { responseKinds: ["nak"] },
        });
      }
    });
  });
  const session = new BaslerLeimacMathematicalCalibrationSessionV1_2(sessionConfig(fake.spawnProcess));
  await session.open();
  await assert.rejects(session.close(), /close safe-off responses/);
  assert.equal(fake.children[0].closed, true);
  assert.ok(fake.children[0].killCount >= 1);
});
