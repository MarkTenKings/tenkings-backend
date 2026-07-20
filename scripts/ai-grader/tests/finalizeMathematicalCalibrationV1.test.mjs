import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  finalizeMathematicalCalibrationV1,
  verifyMathematicalCalibrationAnalysisV1,
} from "../finalize-mathematical-calibration-v1.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function exactJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function flatFieldBytes(channelIndex) {
  return exactJsonBytes({
    schemaVersion: "ten-kings-flat-field-artifact-v1",
    channelIndex,
  });
}

function illuminationPatternBytes() {
  return exactJsonBytes({
    schemaVersion: "ten-kings-illumination-pattern-artifact-v1",
  });
}

function analysis() {
  const payload = {
    schemaVersion: "ten-kings-mathematical-calibration-analysis-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    sourceManifestSha256: "a".repeat(64),
    sourceCapturePackage: {
      schemaVersion: "ten-kings-mathematical-calibration-capture-package-v1",
      packageId: "calibration-capture-package-v1",
      manifestSha256: "b".repeat(64),
      rigId: "ten-kings-fixed-rig-v1",
      captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1",
      purpose: "mathematical_calibration_v1",
      thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
      thresholdSetHash: "d".repeat(64),
      captureEvidenceAcceptance: {
        poseDiversity: { policy: "fixture-v1" },
        repeatedPlacementAuthority: "fixture-v1",
      },
      stationAuthority: {
        noProductionMutation: true,
      },
      subject: {
        designation: "calibration_target",
        productionCard: false,
        targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
        targetSha256: "c".repeat(64),
      },
    },
    builderInput: { profileId: "test-profile" },
    flatFieldArtifacts: Array.from({ length: 8 }, (_, index) => {
      const channelIndex = index + 1;
      const bytes = flatFieldBytes(channelIndex);
      return {
        channelIndex,
        artifactFileName: `flat-field-channel-${channelIndex}-v1.json`,
        artifactFileSha256: digest(bytes),
        contentSha256: String(channelIndex).repeat(64).slice(0, 64),
        maximumResidualDeviationFraction: 0.01,
      };
    }),
    illuminationPatternArtifact: {
      artifactFileName: "illumination-pattern-v1.json",
      artifactFileSha256: digest(illuminationPatternBytes()),
      contentSha256: "9".repeat(64),
    },
  };
  const analysisPayloadJson = JSON.stringify(canonical(payload));
  return {
    ...payload,
    hashPolicy: "sha256-exact-utf8-analysisPayloadJson",
    analysisPayloadJson,
    analysisSha256: crypto
      .createHash("sha256")
      .update(Buffer.from(analysisPayloadJson, "utf8"))
      .digest("hex"),
  };
}

async function writeAnalysisFixture(temporaryRoot) {
  const value = analysis();
  for (let channelIndex = 1; channelIndex <= 8; channelIndex += 1) {
    await writeFile(
      path.join(temporaryRoot, `flat-field-channel-${channelIndex}-v1.json`),
      flatFieldBytes(channelIndex),
    );
  }
  await writeFile(
    path.join(temporaryRoot, "illumination-pattern-v1.json"),
    illuminationPatternBytes(),
  );
  const analysisPath = path.join(temporaryRoot, "analysis.json");
  await writeFile(analysisPath, JSON.stringify(value), "utf8");
  return { analysisPath, value };
}

test("analysis verification rejects a changed measurement payload", () => {
  const valid = analysis();
  assert.equal(
    verifyMathematicalCalibrationAnalysisV1(valid).builderInput.profileId,
    "test-profile",
  );
  assert.throws(
    () => verifyMathematicalCalibrationAnalysisV1({
      ...valid,
      algorithmVersion: "untrusted-analysis-v1",
    }),
    /algorithmVersion must be opencv_physical_calibration_analysis_v1/,
  );
  assert.throws(
    () => verifyMathematicalCalibrationAnalysisV1({
      ...valid,
      builderInput: { profileId: "tampered-profile" },
    }),
    /certified payload does not match readable fields/,
  );
  assert.throws(
    () => verifyMathematicalCalibrationAnalysisV1({
      ...valid,
      sourceCapturePackage: {
        ...valid.sourceCapturePackage,
        packageId: "tampered-package",
      },
    }),
    /certified payload does not match readable fields/,
  );
});

test("finalization writes a profile only when the acceptance authority finalizes", async () => {
  const temporaryRoot = await mkdtemp(path.join(process.cwd(), "tmp", "calibration-finalizer-test-"));
  try {
    const { analysisPath, value: sourceAnalysis } = await writeAnalysisFixture(temporaryRoot);
    const finalizedOutput = path.join(temporaryRoot, "finalized");
    const finalized = await finalizeMathematicalCalibrationV1({
      analysisPath,
      outputDir: finalizedOutput,
      buildFixedRigPhysicalCalibrationV1: () => ({
        status: "finalized",
        isCalibrated: true,
        profile: {
          profileId: "test-profile",
          calibrationVersion: "test-v1",
          rigId: "ten-kings-fixed-rig-v1",
          finalizedAt: "2026-07-18T12:00:00.000Z",
          thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
          thresholdSetHash: "d".repeat(64),
        },
        artifact: {
          artifactId: "artifact-v1",
          artifactSha256: "b".repeat(64),
          algorithmVersion: "fixed-rig-physical-calibration-v1",
        },
        issues: [],
      }),
    });
    assert.equal(finalized.acceptance.isCalibrated, true);
    const profile = JSON.parse(await readFile(
      path.join(finalizedOutput, "mathematical-calibration-profile-v1.json"),
      "utf8",
    ));
    assert.equal(profile.profileId, "test-profile");
    assert.ok(finalized.bundle);
    const bundleBytes = await readFile(
      path.join(finalizedOutput, "mathematical-calibration-bundle-v1.json"),
    );
    assert.equal(digest(bundleBytes), finalized.bundle.sha256);
    const bundle = JSON.parse(bundleBytes.toString("utf8"));
    assert.equal(bundle.schemaVersion, "ten-kings-mathematical-calibration-bundle-v1");
    assert.equal(bundle.sourceAnalysisSha256, sourceAnalysis.analysisSha256);
    assert.equal(bundle.sourceCapturePackage.packageId, "calibration-capture-package-v1");
    assert.deepEqual(bundle.sourceCapturePackage, sourceAnalysis.sourceCapturePackage);
    assert.equal(bundle.artifacts.length, 12);
    assert.deepEqual(
      bundle.artifacts
        .filter((entry) => entry.role === "flat_field")
        .map((entry) => entry.channelIndex),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    for (const entry of bundle.artifacts) {
      assert.equal(
        digest(await readFile(path.join(finalizedOutput, entry.fileName))),
        entry.sha256,
        entry.fileName,
      );
    }

    const rejectedOutput = path.join(temporaryRoot, "rejected");
    const rejected = await finalizeMathematicalCalibrationV1({
      analysisPath,
      outputDir: rejectedOutput,
      buildFixedRigPhysicalCalibrationV1: () => ({
        status: "rejected",
        isCalibrated: false,
        profile: null,
        artifact: {
          artifactId: "artifact-v1",
          artifactSha256: "c".repeat(64),
        },
        issues: [{ path: "lensResidualPx", message: "outside acceptance" }],
      }),
    });
    assert.equal(rejected.acceptance.isCalibrated, false);
    assert.equal(rejected.bundle, null);
    await assert.rejects(
      readFile(path.join(
        rejectedOutput,
        "mathematical-calibration-profile-v1.json",
      )),
      /ENOENT/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("finalization rejects a changed certified photometric artifact before writing a bundle", async () => {
  const temporaryRoot = await mkdtemp(path.join(process.cwd(), "tmp", "calibration-finalizer-tamper-"));
  try {
    const { analysisPath } = await writeAnalysisFixture(temporaryRoot);
    await writeFile(
      path.join(temporaryRoot, "flat-field-channel-4-v1.json"),
      exactJsonBytes({ tampered: true }),
    );
    const outputDir = path.join(temporaryRoot, "finalized");
    await assert.rejects(
      finalizeMathematicalCalibrationV1({
        analysisPath,
        outputDir,
        buildFixedRigPhysicalCalibrationV1: () => ({
          status: "finalized",
          isCalibrated: true,
          profile: {
            profileId: "test-profile",
            calibrationVersion: "test-v1",
            rigId: "ten-kings-fixed-rig-v1",
            finalizedAt: "2026-07-18T12:00:00.000Z",
          thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
            thresholdSetHash: "d".repeat(64),
          },
          artifact: {
            artifactId: "artifact-v1",
            artifactSha256: "b".repeat(64),
            algorithmVersion: "fixed-rig-physical-calibration-v1",
          },
          issues: [],
        }),
      }),
      /Flat-field channel 4 exact file SHA-256 mismatch/,
    );
    await assert.rejects(
      readFile(path.join(outputDir, "mathematical-calibration-bundle-v1.json")),
      /ENOENT/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
