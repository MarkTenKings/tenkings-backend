const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  canonicalAiGraderCalibrationJsonV1,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
} = require("@tenkings/shared");

const NOW = new Date("2026-07-21T19:00:00.000Z");
const RIG_ID = "ten-kings-fixed-rig-v1";
const KEY_ID = "d".repeat(64);

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function memberLedger() {
  return [
    ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
    ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
    ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
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
  return {
    schemaVersion: "ten-kings-ai-grader-calibration-pending-authority-v1",
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
    requestedAt: NOW.toISOString(),
    pendingExpiresAt: new Date(NOW.getTime() + 600000).toISOString(),
  };
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
  let liveContext = context;

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
      profile: { rigId: RIG_ID, artifactSha256 },
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

  const bundlePath = path.join(
    root,
    "bundles",
    "sha256",
    authority.bundleManifestSha256,
    "mathematical-calibration-bundle-v1.json",
  );
  await fs.mkdir(path.dirname(bundlePath), { recursive: true });
  await fs.writeFile(bundlePath, "immutable content-addressed fixture");

  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const registry = createMathematicalCalibrationActivationRegistryV1({
    rootDir: root,
    expectedRigId: RIG_ID,
    helperInstanceId: "helper-1",
    helperVersion: "helper-v1",
    workstationKeyId: KEY_ID,
    workstationPrivateKey: privateKey,
    liveOperatingContext: async () => liveContext,
    isIdle: async () => true,
    now: () => new Date(NOW),
  });

  const pending = pendingAuthority(context, authority, artifactSha256, "v1");
  const receipt = await registry.prepareActivation(pending);
  assert.equal((await registry.readPointer()).state, "PENDING");
  assert.equal(receipt.observedOperatingContextHash, pending.operatingContextHash);

  const receiptPath = path.join(root, "receipts", `${pending.activationId}.json`);
  const receiptSha256 = sha(await fs.readFile(receiptPath));
  const hosted = {
    schemaVersion: "ten-kings-ai-grader-calibration-activation-authority-v1",
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
  };
  await registry.confirmHostedActivation(hosted);
  const active = await registry.assertStartAuthority(hosted);
  assert.equal(active.bundlePath, bundlePath);
  assert.equal((await registry.readPointer()).state, "ACTIVE");

  liveContext = {
    ...context,
    capture: { ...context.capture, gain: 1 },
  };
  await assert.rejects(
    registry.assertStartAuthority(hosted),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH",
  );

  const next = pendingAuthority(context, authority, artifactSha256, "v2");
  await assert.rejects(
    registry.prepareActivation(next),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_CONTEXT_MISMATCH",
  );
  const pointerAfterFailure = await registry.readPointer();
  assert.equal(pointerAfterFailure.state, "PENDING");
  assert.equal(pointerAfterFailure.activationId, next.activationId);
  await assert.rejects(
    registry.assertStartAuthority(hosted),
    (error) => error.code === "AI_GRADER_LOCAL_CALIBRATION_AUTHORITY_MISMATCH",
  );
});
