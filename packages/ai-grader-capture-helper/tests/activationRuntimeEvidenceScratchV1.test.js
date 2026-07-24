const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  ACTIVATION_RUNTIME_EVIDENCE_FILE_NAME_V1,
  ACTIVATION_RUNTIME_FAILED_SCRATCH_DIRECTORY_V1,
  ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1,
  ACTIVATION_RUNTIME_PYLON_OUTPUT_DIR_MAX_LENGTH_V1,
  prepareActivationRuntimeEvidenceScratchV1,
} = require("../dist/drivers/activationRuntimeEvidenceScratchV1");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function longEvidenceDirectory(root) {
  return path.join(
    root,
    `registry-${"a".repeat(72)}`,
    `activation-evidence-${"b".repeat(72)}`,
    `.observation-${"c".repeat(72)}`,
  );
}

test("Pylon receives a bounded short scratch path and Node promotes exact bytes into a >260-character immutable evidence path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-activation-scratch-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const helperOutputRoot = path.join(root, "helper-output");
  const evidenceDirectory = longEvidenceDirectory(root);
  const targetEvidencePath = path.join(
    evidenceDirectory,
    ACTIVATION_RUNTIME_EVIDENCE_FILE_NAME_V1,
  );
  assert.ok(targetEvidencePath.length > 260, "regression fixture must cross the failed Pylon path boundary");

  const plan = await prepareActivationRuntimeEvidenceScratchV1({
    helperOutputRoot,
    evidenceDirectory,
    attemptToken: "1".repeat(32),
  });
  const imageBytes = Buffer.from("exact activation runtime PNG bytes");
  let captureCalls = 0;
  let pylonOutputDirectory;
  const result = await plan.capture(async ({ outputDir, label }) => {
    captureCalls += 1;
    pylonOutputDirectory = outputDir;
    assert.equal(label, ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1);
    assert.ok(
      outputDir.length <= ACTIVATION_RUNTIME_PYLON_OUTPUT_DIR_MAX_LENGTH_V1,
      "the concrete Pylon boundary receives only the bounded scratch directory",
    );
    assert.equal(path.relative(helperOutputRoot, outputDir).startsWith(".."), false);
    const bridgeSource = await fs.readFile(
      path.resolve(__dirname, "../scripts/basler-pylon-bridge.ps1"),
      "utf8",
    );
    assert.match(bridgeSource, /\$stamp = \$timestampUtc\.ToString\("yyyyMMddTHHmmssfffZ"\)/);
    assert.match(
      bridgeSource,
      /Join-Path \$OutputDir "basler-\$safeLabel-\$stamp\.\$extension"/,
    );
    const deterministicStamp = "20260723T234234067Z";
    const deterministicPylonFileName = `basler-${label}-${deterministicStamp}.png`;
    const outputFilePath = path.join(outputDir, deterministicPylonFileName);
    assert.equal(deterministicPylonFileName.length, 49);
    assert.ok(outputFilePath.length < 260, "the complete deterministic Pylon path stays below MAX_PATH");
    assert.ok(
      outputFilePath.length <= ACTIVATION_RUNTIME_PYLON_OUTPUT_DIR_MAX_LENGTH_V1 + 1 + 49,
      "the full deterministic Pylon path remains bounded at 230 characters",
    );
    await fs.writeFile(outputFilePath, imageBytes, { flag: "wx" });
    return {
      outputFilePath,
      sha256: sha256(imageBytes),
      byteSize: imageBytes.byteLength,
    };
  });

  assert.equal(captureCalls, 1);
  assert.equal(result.outputFilePath, targetEvidencePath);
  assert.deepEqual(await fs.readFile(targetEvidencePath), imageBytes);
  assert.equal((await fs.stat(targetEvidencePath)).size, imageBytes.byteLength);
  assert.equal(await fs.stat(pylonOutputDirectory).then(() => true, () => false), false);
  await plan.retainFailure();
  assert.deepEqual(
    await fs.readFile(targetEvidencePath),
    imageBytes,
    "a later validation or final-safe-off failure leaves promoted bytes for registry quarantine",
  );
  const callsBeforeRejectedRetry = captureCalls;
  await assert.rejects(
    plan.capture(async () => {
      captureCalls += 1;
      throw new Error("must not run");
    }),
    /single-use; automatic retry is prohibited/,
  );
  assert.equal(captureCalls, callsBeforeRejectedRetry);
});

test("an existing immutable evidence target rejects before the Pylon boundary", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-activation-collision-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const helperOutputRoot = path.join(root, "helper-output");
  const evidenceDirectory = path.join(root, "registry-staging");
  await fs.mkdir(evidenceDirectory, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDirectory, ACTIVATION_RUNTIME_EVIDENCE_FILE_NAME_V1),
    "pre-existing immutable bytes",
    { flag: "wx" },
  );
  let captureCalls = 0;
  await assert.rejects(
    (async () => {
      const plan = await prepareActivationRuntimeEvidenceScratchV1({
        helperOutputRoot,
        evidenceDirectory,
        attemptToken: "2".repeat(32),
      });
      return plan.capture(async () => {
        captureCalls += 1;
        throw new Error("must not run");
      });
    })(),
    /create-new target already exists/,
  );
  assert.equal(captureCalls, 0);
});

test("a child failure retains every scratch byte under staging and cannot retry", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ten-kings-activation-failure-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const helperOutputRoot = path.join(root, "helper-output");
  const evidenceDirectory = longEvidenceDirectory(root);
  const plan = await prepareActivationRuntimeEvidenceScratchV1({
    helperOutputRoot,
    evidenceDirectory,
    attemptToken: "3".repeat(32),
  });
  const partialName = "activation-runtime-evidence.partial-20260723T234234067Z.png";
  const partialBytes = Buffer.from("partial but immutable Pylon evidence");
  let captureCalls = 0;
  await assert.rejects(
    plan.capture(async ({ outputDir }) => {
      captureCalls += 1;
      await fs.writeFile(path.join(outputDir, partialName), partialBytes, { flag: "wx" });
      throw new Error("Pylon failed after writing partial evidence");
    }),
    /Pylon failed after writing partial evidence/,
  );

  const retainedPath = path.join(
    evidenceDirectory,
    ACTIVATION_RUNTIME_FAILED_SCRATCH_DIRECTORY_V1,
    partialName,
  );
  assert.equal(captureCalls, 1);
  assert.deepEqual(await fs.readFile(retainedPath), partialBytes);
  assert.equal(sha256(await fs.readFile(retainedPath)), sha256(partialBytes));
  const callsBeforeRejectedRetry = captureCalls;
  await assert.rejects(
    plan.capture(async () => {
      captureCalls += 1;
      throw new Error("must not run");
    }),
    /single-use; automatic retry is prohibited/,
  );
  assert.equal(captureCalls, callsBeforeRejectedRetry);
});
