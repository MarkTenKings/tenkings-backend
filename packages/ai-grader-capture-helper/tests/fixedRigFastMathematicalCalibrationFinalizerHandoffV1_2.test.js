const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  stageFastCalibrationFinalizerHandoffV1_2,
  verifyFastCalibrationFinalizerHandoffV1_2,
} = require("../dist/drivers/fixedRigFastMathematicalCalibrationFinalizerHandoffV1_2");

const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function fixture(stagingRoot) {
  const bundleBytes = Buffer.from("exact canonical mathematical calibration bundle");
  const members = Array.from({ length: 12 }, (_, index) => {
    const bytes = Buffer.from(`exact immutable calibration member ${index + 1}`);
    return { fileName: `member-${String(index + 1).padStart(2, "0")}.json`, sha256: digest(bytes), bytes };
  });
  return {
    stagingRoot,
    bundleBytes,
    bundleManifestSha256: digest(bundleBytes),
    members,
    rigId: "fixed-rig-test-v1",
    profileId: "profile-v1.2-test",
    calibrationVersion: "calibration-v1.2-test",
    finalizedAt: "2026-07-21T12:10:00.000Z",
    sourceAnalysisSha256: digest(Buffer.from("exact source analysis")),
  };
}

test("finalizer handoff atomically stages the exact manifest, twelve members, and Agent 4 contract idempotently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-finalizer-handoff-v12-"));
  try {
    const input = fixture(path.join(root, "protected-staging"));
    const first = await stageFastCalibrationFinalizerHandoffV1_2(input);
    const second = await stageFastCalibrationFinalizerHandoffV1_2(input);
    const verified = await verifyFastCalibrationFinalizerHandoffV1_2(input);
    assert.deepEqual(second, first);
    assert.deepEqual(verified, first);
    assert.equal(first.fileCount, 14);
    const directory = path.join(input.stagingRoot, input.bundleManifestSha256);
    const entries = (await fs.readdir(directory)).sort();
    assert.deepEqual(entries, [
      "mathematical-calibration-bundle-v1.json",
      "mathematical-calibration-finalizer-handoff-v1.json",
      ...input.members.map((member) => member.fileName),
    ].sort());
    const handoff = JSON.parse(await fs.readFile(
      path.join(directory, "mathematical-calibration-finalizer-handoff-v1.json"),
      "utf8",
    ));
    assert.deepEqual(handoff, {
      schemaVersion: "ten-kings-mathematical-calibration-finalizer-handoff-v1",
      authority: "trusted-local-mathematical-calibration-finalizer-v1",
      rigId: input.rigId,
      profileId: input.profileId,
      calibrationVersion: input.calibrationVersion,
      finalizedAt: input.finalizedAt,
      bundleFileName: "mathematical-calibration-bundle-v1.json",
      bundleManifestSha256: input.bundleManifestSha256,
      sourceAnalysisSha256: input.sourceAnalysisSha256,
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("existing finalizer staging with conflicting immutable bytes fails closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tk-finalizer-handoff-conflict-v12-"));
  try {
    const input = fixture(path.join(root, "protected-staging"));
    await stageFastCalibrationFinalizerHandoffV1_2(input);
    await fs.writeFile(
      path.join(input.stagingRoot, input.bundleManifestSha256, input.members[0].fileName),
      "conflicting staged bytes",
    );
    await assert.rejects(
      stageFastCalibrationFinalizerHandoffV1_2(input),
      /conflicts with its exact ledger bytes/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("finalizer staging rejects incomplete member authority and non-absolute roots", async () => {
  const input = fixture(path.join(os.tmpdir(), "tk-finalizer-handoff-validation-v12"));
  await assert.rejects(
    stageFastCalibrationFinalizerHandoffV1_2({ ...input, members: input.members.slice(0, 11) }),
    /exactly twelve unique members/,
  );
  await assert.rejects(
    stageFastCalibrationFinalizerHandoffV1_2({ ...input, stagingRoot: "relative-root" }),
    /protected absolute path/,
  );
});
