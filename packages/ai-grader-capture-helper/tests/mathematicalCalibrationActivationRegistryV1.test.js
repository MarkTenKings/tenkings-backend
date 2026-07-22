const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  canonicalAiGraderCalibrationJsonV1,
  canonicalAiGraderCalibrationHostedAuthorityStatementV1,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
} = require("@tenkings/shared");
const {
  createMathematicalCalibrationOperatingContextRuntimeV1,
} = require("../dist/drivers/mathematicalCalibrationOperatingContextRuntimeV1");

const NOW = new Date("2026-07-21T19:00:00.000Z");
const RIG_ID = "ten-kings-fixed-rig-v1";
const KEY_ID = "d".repeat(64);

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const {
  privateKey: HOSTED_AUTHORITY_PRIVATE_KEY,
  publicKey: HOSTED_AUTHORITY_PUBLIC_KEY,
} = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const HOSTED_AUTHORITY_KEY_ID = sha(HOSTED_AUTHORITY_PUBLIC_KEY.export({
  format: "der",
  type: "spki",
}));
const HOSTED_AUTHORITY_PUBLIC_KEYS = new Map([[HOSTED_AUTHORITY_KEY_ID, {
  keyId: HOSTED_AUTHORITY_KEY_ID,
  rigId: RIG_ID,
  publicKey: HOSTED_AUTHORITY_PUBLIC_KEY,
}]]);

function signHostedAuthority(unsigned, privateKey = HOSTED_AUTHORITY_PRIVATE_KEY) {
  return {
    ...unsigned,
    hostedAuthoritySignature: crypto.sign(
      "sha256",
      Buffer.from(canonicalAiGraderCalibrationHostedAuthorityStatementV1(unsigned), "utf8"),
      { key: privateKey, dsaEncoding: "ieee-p1363" },
    ).toString("base64url"),
  };
}

function memberLedger(ownerAccepted = false) {
  return [
    ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
    ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
    ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
    ...(ownerAccepted
      ? [[
          "product_owner_operational_acceptance",
          undefined,
          "product-owner-operational-acceptance-v1.json",
        ]]
      : []),
    ...Array.from({ length: 8 }, (_, index) => ["flat_field", index + 1, `flat-field-channel-${index + 1}-v1.json`]),
    ["illumination_pattern", undefined, "illumination-pattern-v1.json"],
  ].map(([role, channelIndex, fileName], index) => ({
    role,
    ...(channelIndex ? { channelIndex } : {}),
    fileName,
    sha256: sha(`member:${index}`),
  }));
}

function operatingContext(authority, artifactSha256) {
  return {
    schemaVersion: "ten-kings-ai-grader-operating-context-v1",
    rig: {
      tenantId: "tenant-1",
      rigId: RIG_ID,
      rigVersion: "fixed-rig-v1",
      locationId: "calibration-bench",
      locationIdentity: "Ten Kings calibration bench",
    },
    camera: { serial: "basler-1", model: "Basler-test" },
    optics: { lensIdentity: "lens-1", mountIdentity: "mount-1" },
    controller: {
      controllerIdentity: "leimac-1",
      channelWiringMapIdentity: "wiring-map-v1",
      channelMap: Array.from({ length: 8 }, (_, index) => ({
        channelIndex: index + 1,
        controllerOutput: `output-${index + 1}`,
        lightingRole: `direction-${index + 1}`,
      })),
    },
    lighting: {
      configurationIdentity: "lighting-v1",
      selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
      dutyPercent: 20,
    },
    capture: { exposureUs: 10000, gain: 0, pixelFormat: "Mono8", widthPx: 1200, heightPx: 1680 },
    calibration: {
      targetSha256: sha("target"),
      rigCharacterizationSha256: artifactSha256,
      bundleSchemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
      bundleManifestSha256: authority.bundleManifestSha256,
      sourceCaptureManifestSha256: authority.sourceCaptureManifestSha256,
      memberLedgerSha256: authority.memberLedgerSha256,
      members: authority.members,
    },
    software: {
      captureProfileVersion: "fixed-rig-capture-v1",
      calibrationAlgorithmVersion: "fixed-rig-physical-calibration-v1.0.0",
      analysisAlgorithmVersion: "opencv-physical-calibration-analysis-v1",
      thresholdSetId: "mathematical-grading-v1",
      thresholdSetHash: sha("threshold"),
      helperInstanceId: "helper-1",
      helperVersion: "helper-v1",
    },
  };
}

function pendingAuthority(context, authority, artifactSha256, suffix) {
  const requestedAt = NOW.toISOString();
  const pendingExpiresAt = new Date(NOW.getTime() + 600000).toISOString();
  return signHostedAuthority({
    schemaVersion: "ten-kings-ai-grader-calibration-pending-authority-v1",
    authorityPhase: "PENDING",
    activationId: `activation-${suffix}`,
    activationHash: sha(`activation:${suffix}`),
    activationRevision: sha(`revision:${suffix}`),
    snapshotId: `snapshot-${suffix}`,
    rigId: RIG_ID,
    bundleManifestSha256: authority.bundleManifestSha256,
    memberLedgerSha256: authority.memberLedgerSha256,
    runtimeContextHash: sha(canonicalAiGraderRuntimeContextV1(context)),
    rigCharacterizationSha256: artifactSha256,
    operatingContextHash: sha(canonicalAiGraderOperatingContextV1(context)),
    operatingContextV1: context,
    requestedAt,
    pendingExpiresAt,
    hostedAuthorityKeyId: HOSTED_AUTHORITY_KEY_ID,
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: requestedAt,
    hostedAuthorityExpiresAt: pendingExpiresAt,
  });
}

test("local registry uses content-addressed bytes, atomic exact pointers, and no fallback after a failed selection", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-calibration-activation-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const artifactSha256 = sha("rig-characterization");
  const members = memberLedger();
  const authority = {
    schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
    bundleManifestSha256: sha("bundle-manifest"),
    sourceCaptureManifestSha256: sha("capture-manifest"),
    memberLedgerSha256: sha(canonicalAiGraderCalibrationJsonV1(members)),
    members,
  };
  const context = operatingContext(authority, artifactSha256);
  const protectedInventory = {
    schemaVersion: "ten-kings-mathematical-calibration-rig-inventory-v1",
    rig: structuredClone(context.rig),
    camera: structuredClone(context.camera),
    optics: structuredClone(context.optics),
    controller: {
      ...structuredClone(context.controller),
      controllerTransportIdentity: "leimac-idmu-tcp:10.0.0.7:502:unit:1",
    },
    lighting: { configurationIdentity: context.lighting.configurationIdentity },
    capture: {
      pixelFormat: context.capture.pixelFormat,
      widthPx: context.capture.widthPx,
      heightPx: context.capture.heightPx,
    },
    software: {
      helperInstanceId: context.software.helperInstanceId,
      helperVersion: context.software.helperVersion,
    },
  };
  const protectedInventoryBytes = Buffer.from(JSON.stringify(protectedInventory));
  let observedRuntime = {
    schemaVersion: "ten-kings-mathematical-calibration-runtime-observation-v1",
    source: "opened-basler-pylon-and-leimac-acknowledgement-v1",
    camera: structuredClone(context.camera),
    capture: structuredClone(context.capture),
    controller: {
      controllerTransportIdentity: protectedInventory.controller.controllerTransportIdentity,
      selectedChannels: [...context.lighting.selectedChannels],
      dutyPercent: context.lighting.dutyPercent,
      expectedWriteCount: 4,
      acknowledgedWriteCount: 4,
      allWritesAcknowledged: true,
    },
    software: structuredClone(protectedInventory.software),
  };
  const trustedLiveOperatingContext = createMathematicalCalibrationOperatingContextRuntimeV1({
    protectedInventoryBytes,
    protectedInventorySha256: sha(protectedInventoryBytes),
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    observeRuntime: async () => observedRuntime,
  });

  const bundleModulePath = require.resolve("../dist/drivers/fixedRigMathematicalCalibrationBundleV1");
  const bundleModule = require(bundleModulePath);
  const originalLoader = bundleModule.loadFixedRigMathematicalCalibrationBundleV1;
  bundleModule.loadFixedRigMathematicalCalibrationBundleV1 = (input) => {
    assert.equal(input.expectedRigId, RIG_ID);
    assert.equal(input.bundleSha256, authority.bundleManifestSha256);
    return {
      bundlePath: input.bundlePath,
      bundleSha256: input.bundleSha256,
      bundle: {},
      profile: {
        rigId: RIG_ID,
        profileId: "profile-v1",
        calibrationVersion: "calibration-v1",
        finalizedAt: NOW.toISOString(),
        artifactSha256,
      },
      physicalArtifact: {},
      acceptance: {},
      authority,
      files: {},
    };
  };
  t.after(() => { bundleModule.loadFixedRigMathematicalCalibrationBundleV1 = originalLoader; });
  delete require.cache[require.resolve("../dist/drivers/mathematicalCalibrationActivationRegistryV1")];
  const {
    createMathematicalCalibrationActivationRegistryV1,
  } = require("../dist/drivers/mathematicalCalibrationActivationRegistryV1");

  const finalizedBundleStagingRoot = path.join(root, "trusted-finalizer-staging");
  const stagingDir = path.join(finalizedBundleStagingRoot, authority.bundleManifestSha256);
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(
    path.join(stagingDir, "mathematical-calibration-bundle-v1.json"),
    "immutable finalized bundle fixture",
  );
  for (const member of authority.members) {
    await fs.writeFile(path.join(stagingDir, member.fileName), `immutable member ${member.fileName}`);
  }
  await fs.writeFile(
    path.join(stagingDir, "mathematical-calibration-finalizer-handoff-v1.json"),
    JSON.stringify({
      schemaVersion: "ten-kings-mathematical-calibration-finalizer-handoff-v1",
      authority: "trusted-local-mathematical-calibration-finalizer-v1",
      rigId: RIG_ID,
      profileId: "profile-v1",
      calibrationVersion: "calibration-v1",
      finalizedAt: NOW.toISOString(),
      bundleFileName: "mathematical-calibration-bundle-v1.json",
      bundleManifestSha256: authority.bundleManifestSha256,
      sourceAnalysisSha256: sha("source-analysis"),
    }),
  );

  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  let localNow = new Date(NOW);
  const registry = createMathematicalCalibrationActivationRegistryV1({
    rootDir: root,
    finalizedBundleStagingRoot,
    expectedRigId: RIG_ID,
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    workstationKeyId: KEY_ID,
    workstationPrivateKey: privateKey,
    hostedAuthorityPublicKeys: HOSTED_AUTHORITY_PUBLIC_KEYS,
    liveOperatingContext: trustedLiveOperatingContext,
    isIdle: async () => true,
    now: () => new Date(localNow),
  });

  await assert.rejects(
    registry.ingestFinalizedBundle({
      bundleManifestSha256: authority.bundleManifestSha256,
      sourceBundlePath: "browser-declared-path-is-prohibited",
    }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_IMPORT_INVALID",
  );
  const ingested = await registry.ingestFinalizedBundle({
    bundleManifestSha256: authority.bundleManifestSha256,
  });
  const bundlePath = path.join(
    root,
    "bundles",
    "sha256",
    authority.bundleManifestSha256,
    "mathematical-calibration-bundle-v1.json",
  );
  assert.equal(ingested.bundlePath, bundlePath);
  assert.equal(await fs.readFile(bundlePath, "utf8"), "immutable finalized bundle fixture");

  const pending = pendingAuthority(context, authority, artifactSha256, "v1");
  const unsignedPending = structuredClone(pending);
  delete unsignedPending.hostedAuthoritySignature;
  await assert.rejects(
    registry.prepareActivation(unsignedPending),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  await assert.rejects(
    registry.prepareActivation({
      ...pending,
      activationHash: sha("browser-tampered-pending"),
    }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  const {
    privateKey: unknownPrivateKey,
    publicKey: unknownPublicKey,
  } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const unknownKeyId = sha(unknownPublicKey.export({ format: "der", type: "spki" }));
  await assert.rejects(
    registry.prepareActivation(signHostedAuthority({
      ...pending,
      hostedAuthorityKeyId: unknownKeyId,
      hostedAuthoritySignature: undefined,
    }, unknownPrivateKey)),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  const expiredRequestedAt = new Date(NOW.getTime() - 120000).toISOString();
  const expiredAt = new Date(NOW.getTime() - 60000).toISOString();
  await assert.rejects(
    registry.prepareActivation(signHostedAuthority({
      ...pending,
      activationId: "activation-expired",
      activationHash: sha("activation:expired"),
      activationRevision: sha("revision:expired"),
      snapshotId: "snapshot-expired",
      requestedAt: expiredRequestedAt,
      pendingExpiresAt: expiredAt,
      hostedAuthorityIssuedAt: expiredRequestedAt,
      hostedAuthorityExpiresAt: expiredAt,
      hostedAuthoritySignature: undefined,
    })),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_EXPIRED",
  );
  await assert.rejects(
    registry.prepareActivation(signHostedAuthority({
      ...pending,
      activationId: "activation-cross-rig",
      activationHash: sha("activation:cross-rig"),
      activationRevision: sha("revision:cross-rig"),
      snapshotId: "snapshot-cross-rig",
      rigId: "different-rig",
      hostedAuthoritySignature: undefined,
    })),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  const receipt = await registry.prepareActivation(pending);
  await assert.rejects(
    registry.prepareActivation(pending),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REPLAYED",
  );
  assert.equal((await registry.readPointer()).state, "PENDING");
  assert.equal(receipt.observedOperatingContextHash, pending.operatingContextHash);

  const receiptPath = path.join(root, "receipts", `${pending.activationId}.json`);
  const receiptSha256 = sha(await fs.readFile(receiptPath));
  const hosted = signHostedAuthority({
    schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
    authorityPhase: "ACTIVE",
    activationId: pending.activationId,
    activationHash: pending.activationHash,
    activationRevision: sha("hosted-active-revision"),
    snapshotId: pending.snapshotId,
    rigId: pending.rigId,
    bundleManifestSha256: pending.bundleManifestSha256,
    memberLedgerSha256: pending.memberLedgerSha256,
    runtimeContextHash: pending.runtimeContextHash,
    rigCharacterizationSha256: pending.rigCharacterizationSha256,
    operatingContextHash: pending.operatingContextHash,
    workstationReceiptSha256: receiptSha256,
    activatedAt: NOW.toISOString(),
    hostedAuthorityKeyId: HOSTED_AUTHORITY_KEY_ID,
    hostedAuthoritySignatureAlgorithm: "ecdsa-p256-sha256-ieee-p1363",
    hostedAuthorityIssuedAt: NOW.toISOString(),
    hostedAuthorityExpiresAt: new Date(NOW.getTime() + 120000).toISOString(),
  });
  await assert.rejects(
    registry.confirmHostedActivation(pending),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  await assert.rejects(
    registry.confirmHostedActivation({
      ...hosted,
      activationRevision: sha("browser-forged-active-revision"),
    }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  await assert.rejects(
    registry.confirmHostedActivation(signHostedAuthority({
      ...hosted,
      activationId: "different-activation",
      activationHash: sha("different-activation"),
      hostedAuthoritySignature: undefined,
    })),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_MISMATCH",
  );
  assert.equal((await registry.readPointer()).state, "PENDING");
  await registry.confirmHostedActivation(hosted);
  const active = await registry.assertStartAuthority(hosted);
  assert.equal(active.bundlePath, bundlePath);
  await assert.rejects(
    registry.assertStartAuthority({
      ...hosted,
      workstationReceiptSha256: sha("browser-forged-receipt"),
    }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  const unsignedActive = structuredClone(hosted);
  delete unsignedActive.hostedAuthoritySignature;
  await assert.rejects(
    registry.assertStartAuthority(unsignedActive),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_REJECTED",
  );
  assert.equal((await registry.readPointer()).state, "ACTIVE");

  localNow = new Date(NOW.getTime() + 180000);
  await assert.rejects(
    registry.assertStartAuthority(hosted),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_HOSTED_AUTHORITY_EXPIRED",
  );
  const boundSession = await registry.assertBoundSessionAuthority(hosted);
  assert.equal(boundSession.authority.activationId, hosted.activationId);
  localNow = new Date(NOW);

  observedRuntime = {
    ...observedRuntime,
    capture: { ...observedRuntime.capture, gain: 1 },
  };
  await assert.rejects(
    registry.assertStartAuthority(hosted),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_RUNTIME_CONTEXT_UNTRUSTED",
  );

  const next = pendingAuthority(context, authority, artifactSha256, "v2");
  await assert.rejects(
    registry.prepareActivation(next),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_RUNTIME_CONTEXT_UNTRUSTED",
  );
  const pointerAfterFailure = await registry.readPointer();
  assert.equal(pointerAfterFailure.state, "PENDING");
  assert.equal(pointerAfterFailure.activationId, next.activationId);
  await assert.rejects(
    registry.assertStartAuthority(hosted),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_AUTHORITY_MISMATCH",
  );
});

test("local registry ingests the owner authority only through the exact 13-member finalizer handoff", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-owner-calibration-ingest-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const members = memberLedger(true);
  const authority = {
    schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
    bundleManifestSha256: sha("owner-bundle-manifest"),
    sourceCaptureManifestSha256: sha("owner-capture-manifest"),
    memberLedgerSha256: sha(canonicalAiGraderCalibrationJsonV1(members)),
    members,
  };
  const ownerAuthority = {
    authorityStatus: "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS",
    authoritySha256: sha("owner-authority"),
  };
  const ownerFileSha256 = members[3].sha256;
  const bundleModulePath = require.resolve("../dist/drivers/fixedRigMathematicalCalibrationBundleV1");
  const bundleModule = require(bundleModulePath);
  const originalLoader = bundleModule.loadFixedRigMathematicalCalibrationBundleV1;
  bundleModule.loadFixedRigMathematicalCalibrationBundleV1 = (input) => ({
    bundlePath: input.bundlePath,
    bundleSha256: input.bundleSha256,
    bundle: {},
    profile: {
      rigId: RIG_ID,
      profileId: "owner-profile-v1",
      calibrationVersion: "owner-calibration-v1",
      finalizedAt: NOW.toISOString(),
      artifactSha256: sha("owner-rig-characterization"),
    },
    physicalArtifact: {},
    acceptance: {},
    operationalAcceptance: ownerAuthority,
    authority,
    files: { operationalAcceptance: { sha256: ownerFileSha256 } },
  });
  t.after(() => { bundleModule.loadFixedRigMathematicalCalibrationBundleV1 = originalLoader; });
  delete require.cache[require.resolve("../dist/drivers/mathematicalCalibrationActivationRegistryV1")];
  const {
    createMathematicalCalibrationActivationRegistryV1,
  } = require("../dist/drivers/mathematicalCalibrationActivationRegistryV1");

  const finalizedBundleStagingRoot = path.join(root, "trusted-finalizer-staging");
  const stagingDir = path.join(finalizedBundleStagingRoot, authority.bundleManifestSha256);
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, "mathematical-calibration-bundle-v1.json"), "owner bundle");
  for (const member of members) {
    await fs.writeFile(path.join(stagingDir, member.fileName), `owner member ${member.fileName}`);
  }
  const handoff = {
    schemaVersion: "ten-kings-mathematical-calibration-finalizer-handoff-v1",
    authority: "trusted-local-mathematical-calibration-finalizer-v1",
    rigId: RIG_ID,
    profileId: "owner-profile-v1",
    calibrationVersion: "owner-calibration-v1",
    finalizedAt: NOW.toISOString(),
    bundleFileName: "mathematical-calibration-bundle-v1.json",
    bundleManifestSha256: authority.bundleManifestSha256,
    sourceAnalysisSha256: sha("owner-source-analysis"),
    operationalAcceptanceStatus: "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS",
    operationalAcceptanceAuthoritySha256: ownerAuthority.authoritySha256,
    operationalAcceptanceAuthorityFileSha256: ownerFileSha256,
  };
  await fs.writeFile(
    path.join(stagingDir, "mathematical-calibration-finalizer-handoff-v1.json"),
    JSON.stringify(handoff),
  );
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const registry = createMathematicalCalibrationActivationRegistryV1({
    rootDir: root,
    finalizedBundleStagingRoot,
    expectedRigId: RIG_ID,
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    workstationKeyId: KEY_ID,
    workstationPrivateKey: privateKey,
    hostedAuthorityPublicKeys: HOSTED_AUTHORITY_PUBLIC_KEYS,
    liveOperatingContext: async (value) => value,
    isIdle: async () => true,
    now: () => NOW,
  });
  const ingested = await registry.ingestFinalizedBundle({
    bundleManifestSha256: authority.bundleManifestSha256,
  });
  assert.equal(ingested.authority.members.length, 13);
  assert.equal(
    await fs.readFile(path.join(path.dirname(ingested.bundlePath),
      "product-owner-operational-acceptance-v1.json"), "utf8"),
    "owner member product-owner-operational-acceptance-v1.json",
  );

  const invalidRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-owner-handoff-invalid-"));
  t.after(async () => fs.rm(invalidRoot, { recursive: true, force: true }));
  const invalidStage = path.join(invalidRoot, authority.bundleManifestSha256);
  await fs.mkdir(invalidStage, { recursive: true });
  await fs.writeFile(
    path.join(invalidStage, "mathematical-calibration-finalizer-handoff-v1.json"),
    JSON.stringify({ ...handoff, operationalAcceptanceStatus: undefined }),
  );
  const invalidRegistry = createMathematicalCalibrationActivationRegistryV1({
    rootDir: path.join(root, "invalid-registry"),
    finalizedBundleStagingRoot: invalidRoot,
    expectedRigId: RIG_ID,
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    workstationKeyId: KEY_ID,
    workstationPrivateKey: privateKey,
    hostedAuthorityPublicKeys: HOSTED_AUTHORITY_PUBLIC_KEYS,
    liveOperatingContext: async (value) => value,
    isIdle: async () => true,
    now: () => NOW,
  });
  await assert.rejects(
    invalidRegistry.ingestFinalizedBundle({ bundleManifestSha256: authority.bundleManifestSha256 }),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_FINALIZER_HANDOFF_INVALID",
  );
});
