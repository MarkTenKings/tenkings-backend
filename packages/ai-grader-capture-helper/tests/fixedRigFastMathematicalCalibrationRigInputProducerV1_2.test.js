const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  produceFastCalibrationRigMaterializationInputV1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationRigInputProducerV1_2");
const {
  materializeFastCalibrationRigAuthorityV1_2,
  FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationRigMaterializerV1_2");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  prepareFastCalibrationRigMaterializationFixtureV1_2,
} = require("./helpers/fastCalibrationRigMaterializationFixtureV1_2");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function temporary(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), `tenkings-${label}-`));
}

async function fixtureAndInput(label, options = { protectedTargetGeometry: true }, produce = true) {
  const root = await temporary(label);
  const fixture = await prepareFastCalibrationRigMaterializationFixtureV1_2(root, options);
  const live = JSON.parse(await fs.readFile(path.join(fixture.sourceRoot, fixture.liveRef.fileName), "utf8"));
  const producerInput = {
    captureManifestPath: path.join(fixture.sourceRoot, fixture.captureManifestRef.fileName),
    captureManifestSha256: fixture.captureManifestRef.sha256,
    liveContext: {
      camera: {
        serialNumber: live.camera.serialNumber, modelName: live.camera.modelName,
        exposureUs: live.camera.exposureUs, gain: live.camera.gain, pixelFormat: live.camera.pixelFormat,
        widthPx: live.camera.widthPx, heightPx: live.camera.heightPx,
      },
      controller: { ...live.controller },
    },
    observedAt: "2026-07-21T15:00:00.000Z",
  };
  const produced = produce ? await produceFastCalibrationRigMaterializationInputV1_2(producerInput) : undefined;
  return { root, fixture, live, produced, producerInput };
}

async function rewriteCaptureAuthority(fixture, mutate) {
  const manifestPath = path.join(fixture.sourceRoot, fixture.captureManifestRef.fileName);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const packagePath = path.join(fixture.sourceRoot, manifest.sourceCapturePackage.path);
  const capturePackage = JSON.parse(await fs.readFile(packagePath, "utf8"));
  await mutate(capturePackage);
  const packageBytes = canonicalBytes(capturePackage);
  await fs.writeFile(packagePath, packageBytes);
  manifest.sourceCapturePackage.sha256 = digest(packageBytes);
  const manifestBytes = canonicalBytes(manifest);
  await fs.writeFile(manifestPath, manifestBytes);
  return { manifestPath, manifestSha256: digest(manifestBytes) };
}

test("protected producer creates a canonical-target-frame package that materializes and reloads", async (t) => {
  const { root, fixture, produced } = await fixtureAndInput("rig-input-e2e");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = JSON.parse(await fs.readFile(produced.inputManifestPath, "utf8"));
  assert.equal(manifest.directionFrameEvidence.fileName.includes("directions-"), true);
  assert.equal("stageTransformEvidence" in manifest, false);
  assert.deepEqual(manifest.referencedEvidence.map((entry) => entry.role), ["lens_authority", "component_wiring"]);
  assert.equal(JSON.stringify(manifest).includes("matrix"), false);
  assert.equal(JSON.stringify(manifest).includes("operatorId"), false);
  const result = await materializeFastCalibrationRigAuthorityV1_2({
    inputManifestPath: produced.inputManifestPath,
    inputManifestSha256: produced.inputManifestSha256,
    acceptanceRoot: fixture.acceptanceRoot,
    confirmation: FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2,
    analyzePhysicalEvidence: fixture.analyzePhysicalEvidence,
  });
  const directionMember = JSON.parse((result.rigSource.members.find((entry) => entry.fileName === "physical-light-directions-authority-v1.json")).bytes);
  assert.equal(directionMember.coordinateFrame, "canonical_normalized_target_v1");
  assert.equal(directionMember.authorityMethod, "evidence_derived_normalized_illumination_direction_v1");
  assert.equal("stageToUndistortedSensorMatrix" in directionMember, false);
  assert.equal(new Set(result.runtimeContext.controller.channelWiring.map((entry) => entry.componentId)).size, 8);
  assert.equal(new Set(result.runtimeContext.controller.channelWiring.map((entry) => entry.physicalDirectionId)).size, 8);
});

test("real operator wiring accepts only sealed session authority and invokes the protected probe before production", async (t) => {
  const root = await temporary("rig-input-operator");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const captureManifestPath = path.join(root, "capture-manifest.json");
  await fs.writeFile(captureManifestPath, canonicalBytes({ schemaVersion: "test-sealed-manifest" }));
  let sealed = true;
  let probeCalls = 0;
  let producerCalls = 0;
  let orphanReleaseCalls = 0;
  const sessionId = "operator-materialization-session";
  const status = () => ({
    schemaVersion: "ten-kings-mathematical-calibration-capture-session-v1", sessionId, packageId: "package-1",
    operatorId: "mark-supervised", sealed, captureCount: 102, measurementCount: 78, failedOperationCount: 0,
    sessionStateSha256: "a".repeat(64), nextCaptureSlot: null, retryAllowed: false, hardStop: null,
    poseProgress: [], acceptedCaptureHistory: [], failedAttempts: [], sessionDir: root, captureManifestPath,
  });
  const expected = {
    inputManifestPath: path.join(root, "rig-input.json"), inputManifestSha256: "b".repeat(64),
    liveProbeSha256: "c".repeat(64), componentAuthoritySha256: "d".repeat(64),
    directionFrameAuthoritySha256: "e".repeat(64), lensAuthoritySha256: "f".repeat(64), wiringAuthoritySha256: "1".repeat(64),
  };
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true, mode: "mock", host: "127.0.0.1", port: 47653,
    stationToken: "StationTokenStationTokenStationToken1234", outputDir: path.join(root, "station"),
  });
  const service = new AiGraderLocalStationBridgeService(config, undefined, undefined, {
    mathematicalCalibrationCaptureProducer: { status: async (requested) => { assert.equal(requested, sessionId); return status(); } },
    stopOrphanedPreviewStreamsUntilReleased: async () => { orphanReleaseCalls += 1; return 0; },
    probeFastCalibrationRigMaterializationContextV1_2: async () => {
      probeCalls += 1;
      return {
        camera: { serialNumber: "camera-1", modelName: "basler-1", exposureUs: 1, gain: 0, pixelFormat: "Mono8", widthPx: 1000, heightPx: 1400 },
        controller: { identity: "controller-1", unit: 1, responseKinds: ["ack"] },
      };
    },
    produceFastCalibrationRigMaterializationInputV1_2: async (input) => {
      producerCalls += 1;
      assert.equal(input.captureManifestPath, captureManifestPath);
      assert.equal(input.captureManifestSha256, digest(await fs.readFile(captureManifestPath)));
      assert.deepEqual(Object.keys(input).sort(), ["captureManifestPath", "captureManifestSha256", "liveContext", "observedAt"].sort());
      return expected;
    },
  });
  assert.deepEqual(await service.prepareMathematicalCalibrationRigMaterializationInput(sessionId), expected);
  assert.equal(probeCalls, 1); assert.equal(producerCalls, 1); assert.ok(orphanReleaseCalls >= 1);
  const releaseCallsAfterSuccess = orphanReleaseCalls;
  sealed = false;
  await assert.rejects(() => service.prepareMathematicalCalibrationRigMaterializationInput(sessionId), /sealed, healthy/i);
  assert.equal(probeCalls, 1); assert.equal(producerCalls, 1); assert.equal(orphanReleaseCalls, releaseCallsAfterSuccess);
});

test("protected producer rejects missing, tampered, mismatched, duplicate, fabricated, and legacy authority", async (t) => {
  await t.test("missing immutable input", async (st) => {
    const { root, fixture, live } = await fixtureAndInput("rig-input-missing");
    st.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.rm(path.join(fixture.sourceRoot, "evidence/measurements/direction-1-1.json"), { force: true });
    await assert.rejects(() => produceFastCalibrationRigMaterializationInputV1_2({
      captureManifestPath: path.join(fixture.sourceRoot, fixture.captureManifestRef.fileName), captureManifestSha256: fixture.captureManifestRef.sha256,
      liveContext: { camera: live.camera, controller: live.controller }, observedAt: "2026-07-21T15:00:00.000Z",
    }), /missing|ENOENT|immutable/i);
  });

  await t.test("tampered immutable bytes", async (st) => {
    const { root, fixture, live } = await fixtureAndInput("rig-input-tampered");
    st.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.appendFile(path.join(fixture.sourceRoot, "evidence/measurements/direction-1-1.json"), "tampered");
    await assert.rejects(() => produceFastCalibrationRigMaterializationInputV1_2({
      captureManifestPath: path.join(fixture.sourceRoot, fixture.captureManifestRef.fileName), captureManifestSha256: fixture.captureManifestRef.sha256,
      liveContext: { camera: live.camera, controller: live.controller }, observedAt: "2026-07-21T15:00:00.000Z",
    }), /immutable ledger/i);
  });

  await t.test("mismatched protected probe", async (st) => {
    const { root, fixture, live } = await fixtureAndInput("rig-input-mismatch");
    st.after(() => fs.rm(root, { recursive: true, force: true }));
    await assert.rejects(() => produceFastCalibrationRigMaterializationInputV1_2({
      captureManifestPath: path.join(fixture.sourceRoot, fixture.captureManifestRef.fileName), captureManifestSha256: fixture.captureManifestRef.sha256,
      liveContext: { camera: live.camera, controller: { ...live.controller, unit: 2 } }, observedAt: "2026-07-21T15:00:00.000Z",
    }), /does not match/i);
  });

  await t.test("duplicate relabelled evidence", async (st) => {
    const { root, fixture, live } = await fixtureAndInput("rig-input-duplicate");
    st.after(() => fs.rm(root, { recursive: true, force: true }));
    const rewritten = await rewriteCaptureAuthority(fixture, async (capturePackage) => {
      capturePackage.artifacts[1].path = capturePackage.artifacts[0].path;
      capturePackage.artifacts[1].sha256 = capturePackage.artifacts[0].sha256;
      capturePackage.artifacts[1].byteSize = capturePackage.artifacts[0].byteSize;
    });
    await assert.rejects(() => produceFastCalibrationRigMaterializationInputV1_2({
      captureManifestPath: rewritten.manifestPath, captureManifestSha256: rewritten.manifestSha256,
      liveContext: { camera: live.camera, controller: live.controller }, observedAt: "2026-07-21T15:00:00.000Z",
    }), /duplicate|relabelled/i);
  });

  await t.test("manually fabricated direction authority", async (st) => {
    const { root, fixture, live } = await fixtureAndInput("rig-input-fabricated");
    st.after(() => fs.rm(root, { recursive: true, force: true }));
    const rewritten = await rewriteCaptureAuthority(fixture, async (capturePackage) => {
      const artifact = capturePackage.artifacts.find((entry) => entry.evidenceId === "direction-1-1");
      const artifactPath = path.join(fixture.sourceRoot, artifact.path);
      const measurement = JSON.parse(await fs.readFile(artifactPath, "utf8"));
      measurement.measurementMethod = "fixed_ring_segment_geometry_with_ruler_v1";
      const bytes = canonicalBytes(measurement);
      await fs.writeFile(artifactPath, bytes);
      artifact.sha256 = digest(bytes); artifact.byteSize = bytes.length;
    });
    await assert.rejects(() => produceFastCalibrationRigMaterializationInputV1_2({
      captureManifestPath: rewritten.manifestPath, captureManifestSha256: rewritten.manifestSha256,
      liveContext: { camera: live.camera, controller: live.controller }, observedAt: "2026-07-21T15:00:00.000Z",
    }), /fabricated|mismatched|normalized illumination|sourceEvidenceId/i);
  });

  await t.test("legacy physical-coordinate authority", async (st) => {
    const { root, fixture, live } = await fixtureAndInput("rig-input-legacy", { protectedTargetGeometry: false }, false);
    st.after(() => fs.rm(root, { recursive: true, force: true }));
    await assert.rejects(() => produceFastCalibrationRigMaterializationInputV1_2({
      captureManifestPath: path.join(fixture.sourceRoot, fixture.captureManifestRef.fileName), captureManifestSha256: fixture.captureManifestRef.sha256,
      liveContext: { camera: live.camera, controller: live.controller }, observedAt: "2026-07-21T15:00:00.000Z",
    }), /fabricated|mismatched|normalized illumination|sourceEvidenceId/i);
  });
});
