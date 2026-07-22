const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const publicDrivers = require("../dist/drivers");
const {
  buildFastCalibrationFinalizerAlgorithmManifestV1_2,
  FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256,
} = require("../dist/drivers/fixedRigFastCalibrationFinalizerAlgorithmV1_2");
const {
  FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2,
  FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2,
  loadMaterializedFastCalibrationRigAuthorityV1_2,
  materializeFastCalibrationRigAuthorityV1_2,
  readVerifiedPhysicalAnalysisOutputV1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationRigMaterializerV1_2");
const {
  runMaterializeMathematicalCalibrationV1_2RigAuthorityCli,
} = require("../dist/materializeMathematicalCalibrationV1_2RigAuthorityCli");
const {
  buildMathematicalCalibrationV1_2ProductionAuthorityConfig,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationProductionAuthorityV1_2");
const {
  MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS,
} = require("../dist/drivers/mathematicalCalibrationV1_2Contract");
const {
  canonicalBytes,
  digest,
  prepareFastCalibrationRigMaterializationFixtureV1_2,
  materializeFastCalibrationRigFixtureV1_2,
} = require("./helpers/fastCalibrationRigMaterializationFixtureV1_2");

async function temporary(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
}

async function rewriteInput(prepared) {
  const bytes = canonicalBytes(prepared.inputManifest);
  await fs.writeFile(prepared.materializerInput.inputManifestPath, bytes);
  prepared.materializerInput.inputManifestSha256 = digest(bytes);
}

async function rewriteBoundJson(prepared, referenceName, mutate) {
  const reference = prepared.inputManifest[referenceName];
  const filePath = path.join(prepared.sourceRoot, ...reference.fileName.split("/"));
  const value = JSON.parse(await fs.readFile(filePath, "utf8"));
  mutate(value);
  const bytes = canonicalBytes(value);
  await fs.writeFile(filePath, bytes);
  reference.sha256 = digest(bytes);
  await rewriteInput(prepared);
}

async function writePhysicalAnalyzerEnvelope(root, mutate = () => {}) {
  const outputDir = path.join(root, "analysis-output");
  await fs.mkdir(outputDir, { recursive: true });
  const flatBytes = canonicalBytes({ artifact: "flat-1" });
  const illuminationBytes = canonicalBytes({ artifact: "illumination" });
  await fs.writeFile(path.join(outputDir, "flat-1.json"), flatBytes);
  await fs.writeFile(path.join(outputDir, "illumination-pattern-v1.json"), illuminationBytes);
  const captureManifestSha256 = digest(Buffer.from("capture-manifest"));
  const payload = {
    schemaVersion: "ten-kings-mathematical-calibration-analysis-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    sourceManifestSha256: captureManifestSha256,
    sourceCapturePackage: {},
    captureEvidenceAudit: {},
    builderInput: { trustedPayload: true },
    flatFieldArtifacts: [{
      channelIndex: 1,
      artifactFileName: "flat-1.json",
      artifactFileSha256: digest(flatBytes),
      contentSha256: digest(Buffer.from("flat-content")),
      maximumResidualDeviationFraction: 0.01,
    }],
    illuminationPatternArtifact: {
      artifactFileName: "illumination-pattern-v1.json",
      artifactFileSha256: digest(illuminationBytes),
      contentSha256: digest(Buffer.from("illumination-content")),
    },
  };
  const payloadJson = canonicalBytes(payload).subarray(0, -1).toString("utf8");
  const envelope = {
    ...structuredClone(payload),
    hashPolicy: "sha256-exact-utf8-analysisPayloadJson",
    analysisPayloadJson: payloadJson,
    analysisSha256: digest(Buffer.from(payloadJson, "utf8")),
  };
  mutate(envelope);
  await fs.writeFile(path.join(outputDir, "mathematical-calibration-analysis-v1.json"), canonicalBytes(envelope));
  return { outputDir, captureManifestSha256 };
}

test("materializes deterministic write-once authority and reopens through the real Production loader", async () => {
  const root = await temporary("rig-materializer-success");
  try {
    const fixture = await materializeFastCalibrationRigFixtureV1_2(root);
    const repeated = await materializeFastCalibrationRigAuthorityV1_2(fixture.materializerInput);
    assert.deepEqual({
      directoryName: repeated.directoryName,
      runtime: repeated.runtimeContextSha256,
      bundle: repeated.rigSourceBundleSha256,
      evidence: repeated.sourceEvidenceManifestSha256,
      analysis: repeated.physicalAnalysisSha256,
      handoff: repeated.handoffSha256,
    }, {
      directoryName: fixture.result.directoryName,
      runtime: fixture.result.runtimeContextSha256,
      bundle: fixture.result.rigSourceBundleSha256,
      evidence: fixture.result.sourceEvidenceManifestSha256,
      analysis: fixture.result.physicalAnalysisSha256,
      handoff: fixture.result.handoffSha256,
    });
    const names = (await fs.readdir(fixture.directory)).sort();
    assert.equal(names.length, 11);
    assert.ok(names.includes("source-evidence"));
    assert.ok(names.includes("target-metrology-authority-v1.json"));
    assert.ok(names.includes("repeatability-authority-v1.json"));
    const handoffText = await fs.readFile(path.join(fixture.directory, FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2), "utf8");
    assert.doesNotMatch(handoffText, /token|C:\\|\/tmp\//i);
    const handoff = JSON.parse(handoffText);
    assert.equal(handoff.authority, "trusted-local-supervised-rig-characterization-materializer-v1");
    assert.equal(handoff.rigSourceBundleSha256, fixture.result.rigSourceBundleSha256);
    assert.equal(handoff.members.length, 5);

    const boundary = {
      async inspectLiveRuntimeContext(value) { return structuredClone(value); },
      async captureCheckerboard() { throw new Error("hardware must remain unopened"); },
      async confirmBlankReverseFlip() { return { confirmed: true }; },
      createPersistentBatch() { throw new Error("hardware must remain unopened"); },
    };
    const production = buildMathematicalCalibrationV1_2ProductionAuthorityConfig({
      env: fixture.env, outputRoot: path.join(root, "sessions"),
      hardware: { outputDir: root, leimacHost: "127.0.0.1" }, lowLevelBoundary: boundary,
    });
    assert.ok(production);
    const runtime = await production.loadRuntimeContext();
    const source = await production.loadRigCharacterizationSource();
    assert.equal(runtime.algorithmHashes.finalizer, FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256);
    assert.equal(source.members.length, 5);
    assert.equal(digest(source.bundleBytes), fixture.result.rigSourceBundleSha256);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("materializes product-owner-confirmed protected target geometry without device authority", async () => {
  const root = await temporary("rig-materializer-protected-target-geometry");
  try {
    const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root, { protectedTargetGeometry: true });
    const result = await materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput);
    const directory = path.join(prepared.acceptanceRoot, result.directoryName);
    const evidence = JSON.parse(await fs.readFile(path.join(directory, "rig-characterization-source-evidence-v1.json"), "utf8"));
    assert.equal(evidence.files.some((entry) => entry.sourceRole === "instrument_calibration"), false);
    assert.equal(evidence.files.some((entry) => entry.sourceRole === "print_verified_calibration_target"), true);

    const wrongRoot = await temporary("rig-materializer-protected-target-mismatch");
    try {
      const wrong = await prepareFastCalibrationRigMaterializationFixtureV1_2(wrongRoot, {
        protectedTargetGeometry: true,
        protectedTargetMismatch: true,
      });
      await assert.rejects(
        () => materializeFastCalibrationRigAuthorityV1_2(wrong.materializerInput),
        /does not match the source capture target identity/i,
      );
    } finally { await fs.rm(wrongRoot, { recursive: true, force: true }); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("rejects missing, extra, tampered, wrong-hash, relabelled, and duplicate source evidence", async (t) => {
  const cases = [
    ["missing", async (prepared) => fs.rm(path.join(prepared.sourceRoot, prepared.inputManifest.liveProbe.fileName))],
    ["tampered", async (prepared) => fs.writeFile(path.join(prepared.sourceRoot, prepared.inputManifest.liveProbe.fileName), Buffer.from("tampered"))],
    ["wrong hash", async (prepared) => { prepared.materializerInput.inputManifestSha256 = "0".repeat(64); }],
    ["extra", async (prepared) => {
      const bytes = Buffer.from("unused-extra-evidence");
      const fileName = "references/unused-extra.bin";
      await fs.writeFile(path.join(prepared.sourceRoot, fileName), bytes);
      prepared.inputManifest.referencedEvidence.push({ role: "instrument_calibration", fileName, sha256: digest(bytes) });
      await rewriteInput(prepared);
    }],
    ["relabelled", async (prepared) => {
      prepared.inputManifest.referencedEvidence.find((entry) => entry.role === "instrument_calibration").role = "metrology_source";
      await rewriteInput(prepared);
    }],
    ["duplicate", async (prepared) => {
      const original = prepared.inputManifest.referencedEvidence[0];
      prepared.inputManifest.referencedEvidence.push({ ...original, fileName: "references/duplicate-label.bin" });
      await rewriteInput(prepared);
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const root = await temporary(`rig-materializer-${name.replace(/ /g, "-")}`);
      try {
        const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
        await mutate(prepared);
        await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput));
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
  }
});

test("rejects unverified source-capture, instrument, metrology, and physical-authority references", async (t) => {
  const cases = [
    ["source capture", async (prepared) => {
      const capturePath = path.join(prepared.sourceRoot, prepared.captureManifestRef.fileName);
      const capture = JSON.parse(await fs.readFile(capturePath, "utf8"));
      capture.sourceCapturePackage.sha256 = "1".repeat(64);
      const bytes = canonicalBytes(capture); await fs.writeFile(capturePath, bytes);
      prepared.inputManifest.captureManifest.sha256 = digest(bytes); await rewriteInput(prepared);
    }],
    ["instrument", async (prepared) => {
      prepared.inputManifest.referencedEvidence = prepared.inputManifest.referencedEvidence.filter((entry) => entry.role !== "instrument_calibration");
      await rewriteInput(prepared);
    }],
    ["metrology", async (prepared) => {
      prepared.inputManifest.referencedEvidence = prepared.inputManifest.referencedEvidence.filter((entry) => entry.role !== "metrology_source");
      await rewriteInput(prepared);
    }],
    ["lens authority", async (prepared) => {
      prepared.inputManifest.referencedEvidence = prepared.inputManifest.referencedEvidence.filter((entry) => entry.role !== "lens_authority");
      await rewriteInput(prepared);
    }],
    ["stage measurement", async (prepared) => {
      prepared.inputManifest.referencedEvidence = prepared.inputManifest.referencedEvidence.filter((entry) => entry.role !== "stage_transform_measurement");
      await rewriteInput(prepared);
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const root = await temporary(`rig-materializer-unverified-${name.replace(/ /g, "-")}`);
      try {
        const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
        await mutate(prepared);
        await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput));
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
  }
});

test("rejects old-profile conversion and synthetic-fixture analysis on the real analyzer path", async (t) => {
  await t.test("old profile", async () => {
    const root = await temporary("rig-materializer-old-profile");
    try {
      const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
      const capturePath = path.join(prepared.sourceRoot, prepared.captureManifestRef.fileName);
      const oldProfile = { schemaVersion: "ten-kings-mathematical-calibration-profile-v1.1", isCalibrated: true };
      const bytes = canonicalBytes(oldProfile); await fs.writeFile(capturePath, bytes);
      prepared.inputManifest.captureManifest.sha256 = digest(bytes); await rewriteInput(prepared);
      await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput), /raw capture manifest|old profile/i);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  await t.test("synthetic fixture cannot use Production analyzer", async () => {
    const root = await temporary("rig-materializer-synthetic");
    try {
      const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
      const productionInput = { ...prepared.materializerInput };
      delete productionInput.analyzePhysicalEvidence;
      await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(productionInput), /analyzer failed closed|not valid|capture-evidence/i);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

test("default analyzer boundary consumes only the exact hash-bound payload", async (t) => {
  const root = await temporary("rig-materializer-analyzer-envelope");
  try {
    const baseline = await writePhysicalAnalyzerEnvelope(root);
    const verified = await readVerifiedPhysicalAnalysisOutputV1_2(baseline);
    assert.deepEqual(verified.builderInput, { trustedPayload: true });
    const cases = [
      ["mutated top-level builder", (value) => { value.builderInput = { trustedPayload: false }; }],
      ["mutated top-level derived reference", (value) => { value.flatFieldArtifacts[0].artifactFileSha256 = "0".repeat(64); }],
      ["extra envelope field", (value) => { value.untrustedAcceptance = true; }],
      ["missing envelope field", (value) => { delete value.builderInput; }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, async () => {
        const caseRoot = path.join(root, name.replace(/ /g, "-"));
        const input = await writePhysicalAnalyzerEnvelope(caseRoot, mutate);
        await assert.rejects(
          () => readVerifiedPhysicalAnalysisOutputV1_2(input),
          /differs from its hash-bound payload|missing or extra fields/i,
        );
      });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("Production materializer CLI rejects unverified analyzer executable selection", async () => {
  const stdout = [];
  const stderr = [];
  const code = await runMaterializeMathematicalCalibrationV1_2RigAuthorityCli(
    ["--python-executable", "unverified-wrapper"],
    { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
  );
  assert.equal(code, 1);
  assert.equal(stdout.length, 0);
  assert.match(stderr.join(""), /Unknown materializer option: --python-executable/);
});

test("finalizer identity changes on transitive bytes and old finalizer authority fails closed", async () => {
  const baseline = buildFastCalibrationFinalizerAlgorithmManifestV1_2({
    executableArtifacts: [
      { logicalPath: "dist/finalizer.js", bytes: Buffer.from("finalizer-v1") },
      { logicalPath: "dist/transitive-loader.js", bytes: Buffer.from("loader-v1") },
    ], runtimeDependencyVersions: { node: "v20.0.0" },
  });
  const drifted = buildFastCalibrationFinalizerAlgorithmManifestV1_2({
    executableArtifacts: [
      { logicalPath: "dist/finalizer.js", bytes: Buffer.from("finalizer-v1") },
      { logicalPath: "dist/transitive-loader.js", bytes: Buffer.from("loader-v2") },
    ], runtimeDependencyVersions: { node: "v20.0.0" },
  });
  assert.notEqual(drifted.manifestSha256, baseline.manifestSha256);
  const root = await temporary("rig-materializer-wrong-finalizer");
  try {
    const fixture = await materializeFastCalibrationRigFixtureV1_2(root);
    const runtimePath = path.join(fixture.directory, FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2);
    const runtime = JSON.parse(await fs.readFile(runtimePath, "utf8"));
    runtime.algorithmHashes.finalizer = baseline.manifestSha256;
    await fs.writeFile(runtimePath, canonicalBytes(runtime));
    await assert.rejects(
      () => loadMaterializedFastCalibrationRigAuthorityV1_2({ directory: fixture.directory }),
      /finalizer implementation|algorithm identity/i,
    );
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("atomic destination rejects partial and conflicting immutable restaging", async (t) => {
  for (const mode of ["partial", "conflicting"]) {
    await t.test(mode, async () => {
      const root = await temporary(`rig-materializer-atomic-${mode}`);
      try {
        const fixture = await materializeFastCalibrationRigFixtureV1_2(root);
        if (mode === "partial") {
          await fs.rm(path.join(fixture.directory, "repeatability-authority-v1.json"));
        } else {
          await fs.writeFile(path.join(fixture.directory, FAST_CALIBRATION_RIG_MATERIALIZATION_HANDOFF_FILE_V1_2), Buffer.from("conflict"));
        }
        await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(fixture.materializerInput));
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
  }
});

test("live rig, camera, controller, wiring, target, and runtime mismatches fail closed", async (t) => {
  const cases = [
    ["rig", (value) => { value.rigId = "wrong-rig"; }],
    ["camera", (value) => { value.camera.serialNumber = "wrong-camera"; }],
    ["controller", (value) => { value.controller.identity = "wrong-controller"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const root = await temporary(`rig-materializer-mismatch-${name}`);
      try {
        const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
        await rewriteBoundJson(prepared, "liveProbe", mutate);
        await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput));
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
  }
  await t.test("wiring", async () => {
    const root = await temporary("rig-materializer-mismatch-wiring");
    try {
      const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
      await rewriteBoundJson(prepared, "componentEvidence", (value) => { value.channelWiring[1].controllerOutput = value.channelWiring[0].controllerOutput; });
      await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput), /outputs must be unique/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  await t.test("target", async () => {
    const root = await temporary("rig-materializer-mismatch-target");
    try {
      const prepared = await prepareFastCalibrationRigMaterializationFixtureV1_2(root);
      await rewriteBoundJson(prepared, "componentEvidence", (value) => { value.targetSha256 = crypto.createHash("sha256").update("wrong-target").digest("hex"); });
      await assert.rejects(() => materializeFastCalibrationRigAuthorityV1_2(prepared.materializerInput), /target\/rig\/operator\/camera identity/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

test("materialization has no browser, activation, Legacy, provisional, or fallback authority", () => {
  assert.equal(publicDrivers.materializeFastCalibrationRigAuthorityV1_2, undefined);
  assert.equal(publicDrivers.buildFastCalibrationAnalysisV1_2, undefined);
  assert.equal(publicDrivers.finalizeFastMathematicalCalibrationBundleV1_2, undefined);
  const paths = Object.values(MATHEMATICAL_CALIBRATION_V1_2_ENDPOINTS);
  assert.equal(paths.some((entry) => /materialize|activate|legacy|fallback|provisional/i.test(entry)), false);
});
