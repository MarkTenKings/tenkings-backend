const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCaptureHelperTransportConfig,
  startCaptureHelperHttpServer,
} = require("../dist/transport");
const {
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
} = require("../../shared/dist");
const packageJson = require("../package.json");

const BASE_CONFIG = {
  service: {
    simulator: {
      tenantId: "tenant-transport",
      captureSessionId: "session-transport",
      rigId: "rig-transport",
      locationId: "location-transport",
      operatorId: "operator-transport",
      helperInstanceId: "helper-transport",
      seed: "transport-seed",
      calibrationSnapshotIds: [
        "cal-transport-macro",
        "cal-transport-led",
        "cal-transport-microscope",
        "cal-transport-stage",
        "cal-transport-arm",
      ],
      standardSurfaceSuspectRegionIds: [
        "macro-suspect:session-transport:FRONT:SURFACE:1:threshold-transport",
        "macro-suspect:session-transport:FRONT:SURFACE:2:threshold-transport",
      ],
    },
  },
};

function assertValid(result) {
  assert.equal(result.valid, true, JSON.stringify(result.issues, null, 2));
}

async function withServer(testFn) {
  const started = await startCaptureHelperHttpServer({ ...BASE_CONFIG, port: 0, host: "127.0.0.1" }, {});
  try {
    await testFn(started);
  } finally {
    await new Promise((resolve, reject) => {
      started.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function requestJson(started, method, path, body) {
  return new Promise((resolve, reject) => {
    const rawBody = body == null ? "" : JSON.stringify(body);
    const req = http.request(
      {
        host: started.host,
        port: started.port,
        path,
        method,
        headers: {
          Accept: "application/json",
          ...(rawBody ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rawBody) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      }
    );
    req.on("error", reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

test("transport config defaults to disabled-until-start loopback settings", () => {
  const config = buildCaptureHelperTransportConfig({}, {});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 47650);
  assert.equal(config.localOnly, true);
});

test("server health returns simulator offline status", async () => {
  await withServer(async (started) => {
    const response = await requestJson(started, "GET", "/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.status, "simulator_offline");
    assert.equal(response.body.mode, "simulator");
    assert.equal(response.body.driverSet, "mock");
    assert.equal(response.body.transport.localOnly, true);
    assert.equal(response.body.transport.host, "127.0.0.1");
    assert.equal(response.body.transport.port, started.port);
  });
});

test("capabilities endpoint returns valid mock driver manifests", async () => {
  await withServer(async (started) => {
    const response = await requestJson(started, "GET", "/capabilities");
    assert.equal(response.status, 200);
    assert.equal(response.body.deviceCapabilityManifests.length, 5);
    assert.equal(response.body.driverSet, "mock");
    assert.equal(response.body.validation.valid, true);
    for (const manifest of response.body.deviceCapabilityManifests) {
      assertValid(validateDeviceCapabilityManifest(manifest));
    }
  });
});

test("manifest endpoint returns valid QUICK STANDARD and AUTH_ONLY manifests", async () => {
  await withServer(async (started) => {
    const quick = await requestJson(started, "POST", "/manifest", { mode: "QUICK" });
    assert.equal(quick.status, 200);
    assert.equal(quick.body.captureMode, "QUICK");
    assertValid(validateCaptureManifestForMode(quick.body.captureManifest, "QUICK"));

    const standard = await requestJson(started, "POST", "/manifest", { mode: "STANDARD" });
    assert.equal(standard.status, 200);
    assert.equal(standard.body.captureMode, "STANDARD");
    assert.equal(standard.body.microSpotPackages.length, 10);
    assert.equal(standard.body.evidenceArtifacts.length, 100);
    assertValid(validateCaptureManifestForMode(standard.body.captureManifest, "STANDARD", { side: "FRONT" }));

    const authOnly = await requestJson(started, "POST", "/manifest", { mode: "AUTH_ONLY" });
    assert.equal(authOnly.status, 200);
    assert.equal(authOnly.body.captureMode, "AUTH_ONLY");
    assertValid(validateCaptureManifestForMode(authOnly.body.captureManifest, "AUTH_ONLY", { side: "FRONT" }));
  });
});

test("invalid manifest mode returns 400", async () => {
  await withServer(async (started) => {
    const response = await requestJson(started, "POST", "/manifest", { mode: "FORENSIC" });
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error.code, "BAD_REQUEST");
    assert.match(response.body.error.message, /Manifest mode must be QUICK, STANDARD, or AUTH_ONLY/);
  });
});

test("unsupported methods return JSON 405 responses", async () => {
  await withServer(async (started) => {
    const response = await requestJson(started, "GET", "/manifest");
    assert.equal(response.status, 405);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.error.code, "METHOD_NOT_ALLOWED");
  });
});

test("non-loopback host config rejects", () => {
  assert.throws(
    () => buildCaptureHelperTransportConfig({ host: "0.0.0.0" }, {}),
    /only supports loopback hosts/
  );
});

test("real driverSet rejects before server start", async () => {
  await assert.rejects(
    () => startCaptureHelperHttpServer({ ...BASE_CONFIG, port: 0, service: { driverSet: "real" } }, {}),
    /supports only mock drivers/
  );
});

test("transport package path imports no hardware modules", () => {
  const forbidden = ["serialport", "node-hid", "usb", "basler", "dino", "grbl", "opencv"];
  const dependencyNames = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  });
  for (const dependency of dependencyNames) {
    assert.equal(
      forbidden.some((name) => dependency.toLowerCase().includes(name)),
      false,
      `unexpected hardware dependency ${dependency}`
    );
  }

  for (const moduleId of Object.keys(require.cache)) {
    assert.equal(
      forbidden.some((name) => moduleId.toLowerCase().includes(name)),
      false,
      `unexpected hardware module import ${moduleId}`
    );
  }
});
