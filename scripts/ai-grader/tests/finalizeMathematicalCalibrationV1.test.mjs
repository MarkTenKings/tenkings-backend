import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildMathematicalCalibrationAcceptanceV1,
  finalizeMathematicalCalibrationV1,
  verifyMathematicalCalibrationAnalysisV1,
} from "../finalize-mathematical-calibration-v1.mjs";
import {
  assertOperationalAcceptanceAnalysisSourceAuthorityV1,
} from "../create-product-owner-operational-acceptance-v1.mjs";

const require = createRequire(import.meta.url);
const shared = require("../../../packages/shared/dist/index.js");
const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION,
  PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
} = shared;

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
      evidenceDerivedAuthority: {
        thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
        thresholdSetHash: "d".repeat(64),
        uncertaintyCoverageFactor: 1.96,
      },
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

function contentAddressedArtifact(value) {
  const withoutHash = {
    ...value,
    hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
  };
  return {
    ...withoutHash,
    artifactSha256: digest(Buffer.from(JSON.stringify(canonical(withoutHash)), "utf8")),
  };
}

async function writeCanonicalLoaderAnalysisFixture(temporaryRoot) {
  const flatFields = Array.from({ length: 8 }, (_, offset) => contentAddressedArtifact({
    schemaVersion: "ten-kings-flat-field-artifact-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    channelIndex: offset + 1,
  }));
  const illuminationPattern = contentAddressedArtifact({
    schemaVersion: "ten-kings-illumination-pattern-artifact-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    coordinateFrame: "normalized_card_portrait_pixels",
    channels: Array.from({ length: 8 }, (_, offset) => ({ channelIndex: offset + 1 })),
  });
  const flatFieldDescriptors = [];
  for (const flatField of flatFields) {
    const bytes = exactJsonBytes(flatField);
    const fileName = `flat-field-channel-${flatField.channelIndex}-v1.json`;
    await writeFile(path.join(temporaryRoot, fileName), bytes);
    flatFieldDescriptors.push({
      channelIndex: flatField.channelIndex,
      artifactFileName: fileName,
      artifactFileSha256: digest(bytes),
      contentSha256: flatField.artifactSha256,
      maximumResidualDeviationFraction: 0,
    });
  }
  const patternBytes = exactJsonBytes(illuminationPattern);
  await writeFile(path.join(temporaryRoot, "illumination-pattern-v1.json"), patternBytes);
  const finalizedAt = "2026-07-22T12:00:00.000Z";
  const sourceCapturePackage = {
    schemaVersion: "ten-kings-mathematical-calibration-capture-package-v1",
    packageId: "canonical-loader-source-package-v1",
    manifestSha256: "b".repeat(64),
    rigId: "ten-kings-fixed-rig-v1",
    captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1",
    purpose: "mathematical_calibration_v1",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    captureEvidenceAcceptance: structuredClone(
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.captureEvidence,
    ),
    evidenceDerivedAuthority: {
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      uncertaintyCoverageFactor: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor,
    },
    stationAuthority: {
      stationId: "canonical-loader-station-v1",
      sessionId: "canonical-loader-session-v1",
      operatorId: "canonical-loader-operator-v1",
      createdAt: "2026-07-22T11:00:00.000Z",
      finalizedAt,
      noProductionMutation: true,
      protectedSettings: {
        stationId: "canonical-loader-station-v1",
        rigId: "ten-kings-fixed-rig-v1",
        captureProfileVersion: "ten-kings-fixed-rig-mathematical-calibration-v1",
        cameraIndex: 0,
        exposureUs: 6200,
        gain: 0,
        dutyPercent: 20,
        leimacUnit: 1,
        selectedChannels: [1, 2, 3, 4, 5, 6, 7, 8],
        normalizedWidthPx: 1200,
        normalizedHeightPx: 1680,
        checkerboard: { internalColumns: 11, internalRows: 16, cellMm: 5 },
      },
    },
    subject: {
      designation: "calibration_target",
      productionCard: false,
      targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
      targetSha256: "c".repeat(64),
    },
  };
  const payload = {
    schemaVersion: "ten-kings-mathematical-calibration-analysis-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    sourceManifestSha256: "a".repeat(64),
    sourceCapturePackage,
    builderInput: { profileId: "canonical-loader-profile-v1" },
    flatFieldArtifacts: flatFieldDescriptors,
    illuminationPatternArtifact: {
      artifactFileName: "illumination-pattern-v1.json",
      artifactFileSha256: digest(patternBytes),
      contentSha256: illuminationPattern.artifactSha256,
    },
  };
  const analysisPayloadJson = JSON.stringify(canonical(payload));
  const value = {
    ...payload,
    hashPolicy: "sha256-exact-utf8-analysisPayloadJson",
    analysisPayloadJson,
    analysisSha256: digest(Buffer.from(analysisPayloadJson, "utf8")),
  };
  const analysisPath = path.join(temporaryRoot, "canonical-loader-analysis.json");
  await writeFile(analysisPath, JSON.stringify(value), "utf8");
  return {
    analysisPath,
    value,
    finalizedAt,
    flatFieldFileSha256: flatFieldDescriptors.map((entry) => entry.artifactFileSha256),
    illuminationPatternFileSha256: digest(patternBytes),
  };
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
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "calibration-finalizer-test-"));
  try {
    const { analysisPath, value: sourceAnalysis } = await writeAnalysisFixture(temporaryRoot);
    const finalizedOutput = path.join(temporaryRoot, "finalized");
    const registryStagingRoot = path.join(temporaryRoot, "trusted-registry-staging");
    const finalized = await finalizeMathematicalCalibrationV1({
      analysisPath,
      outputDir: finalizedOutput,
      registryStagingRoot,
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
          methods: { coverageFactor: 1.96 },
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
    assert.ok(finalized.bundle.registryHandoff);
    const stagedDirectory = path.join(registryStagingRoot, finalized.bundle.sha256);
    const handoff = JSON.parse(await readFile(
      path.join(stagedDirectory, "mathematical-calibration-finalizer-handoff-v1.json"),
      "utf8",
    ));
    assert.deepEqual(handoff, {
      schemaVersion: "ten-kings-mathematical-calibration-finalizer-handoff-v1",
      authority: "trusted-local-mathematical-calibration-finalizer-v1",
      rigId: bundle.rigId,
      profileId: bundle.profileId,
      calibrationVersion: bundle.calibrationVersion,
      finalizedAt: bundle.finalizedAt,
      bundleFileName: "mathematical-calibration-bundle-v1.json",
      bundleManifestSha256: finalized.bundle.sha256,
      sourceAnalysisSha256: bundle.sourceAnalysisSha256,
    });
    assert.equal(
      digest(await readFile(path.join(stagedDirectory, "mathematical-calibration-bundle-v1.json"))),
      finalized.bundle.sha256,
    );
    for (const entry of bundle.artifacts) {
      assert.equal(
        digest(await readFile(path.join(stagedDirectory, entry.fileName))),
        entry.sha256,
        `staged ${entry.fileName}`,
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
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "calibration-finalizer-tamper-"));
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

test("owner-authorized rejection preserves mathematical failure and emits a 13-member transparent bundle", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "calibration-owner-authority-"));
  try {
    const fixture = await writeAnalysisFixture(temporaryRoot);
    const { analysisPath } = fixture;
    const sourceAnalysis = fixture.value;
    assert.notEqual(
      sourceAnalysis.sourceManifestSha256,
      sourceAnalysis.sourceCapturePackage.manifestSha256,
    );
    const outputDir = path.join(temporaryRoot, "owner-authorized");
    const registryStagingRoot = path.join(temporaryRoot, "owner-staging");
    const authorityPath = path.join(temporaryRoot, "owner-authority.json");
    await writeFile(authorityPath, JSON.stringify({ protected: true }), "utf8");
    const issues = Array.from({ length: 36 }, (_, index) => ({
      path: `analysis.exceptions.${index + 1}`,
      message: `Recorded exception ${index + 1}.`,
    }));
    const operationalProfileCandidate = {
      profileId: "test-profile",
      calibrationVersion: "test-v1",
      rigId: "ten-kings-fixed-rig-v1",
      finalizedAt: "2026-07-18T12:00:00.000Z",
      thresholdSetId: "ten-kings-mathematical-grading-v1.0.1",
      thresholdSetHash: "d".repeat(64),
      artifactId: "artifact-v1",
      artifactSha256: "c".repeat(64),
      isCalibrated: false,
      status: "rejected",
    };
    const result = {
      status: "rejected",
      isCalibrated: false,
      profile: null,
      operationalProfileCandidate,
      artifact: {
        artifactId: operationalProfileCandidate.artifactId,
        artifactSha256: operationalProfileCandidate.artifactSha256,
        rigId: operationalProfileCandidate.rigId,
        algorithmVersion: "fixed-rig-physical-calibration-v1",
        methods: { coverageFactor: 1.96 },
      },
      issues,
    };
    const acceptance = buildMathematicalCalibrationAcceptanceV1(
      verifyMathematicalCalibrationAnalysisV1(sourceAnalysis),
      result,
    );
    const authority = {
      authorityStatus: "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS",
      authorityId: "owner-authority-v1",
      authoritySha256: "4".repeat(64),
      exceptionLedgerSha256: "5".repeat(64),
      exceptionLedger: issues,
      subject: {
        sessionId: sourceAnalysis.sourceCapturePackage.stationAuthority.sessionId,
        sourceCaptureManifestSha256: sourceAnalysis.sourceManifestSha256,
        sourceCapturePackageSha256: sourceAnalysis.sourceCapturePackage.manifestSha256,
        analysisSha256: sourceAnalysis.analysisSha256,
        analysisFileSha256: digest(await readFile(analysisPath)),
        thresholdSetHash: sourceAnalysis.sourceCapturePackage.thresholdSetHash,
        physicalArtifactSha256: result.artifact.artifactSha256,
        mathematicalAcceptanceFileSha256: digest(exactJsonBytes(acceptance)),
        mathematicalAcceptanceStatus: "rejected",
        mathematicalIsCalibrated: false,
        rigId: operationalProfileCandidate.rigId,
        profileId: operationalProfileCandidate.profileId,
        calibrationVersion: operationalProfileCandidate.calibrationVersion,
        finalizedAt: operationalProfileCandidate.finalizedAt,
        artifactId: operationalProfileCandidate.artifactId,
      },
    };
    const finalizeWithAuthority = (candidateAuthority, candidateOutputDir, candidateStagingRoot) =>
      finalizeMathematicalCalibrationV1({
        analysisPath,
        outputDir: candidateOutputDir,
        registryStagingRoot: candidateStagingRoot,
        productOwnerOperationalAcceptancePath: authorityPath,
        buildFixedRigPhysicalCalibrationV1: () => result,
        verifyProductOwnerOperationalAcceptanceV1: () => candidateAuthority,
        validateMathematicalCalibrationForOperationalUseV1: (profile) => ({
          valid: true,
          isCalibrated: false,
          isOperationallyAccepted: true,
          profile,
          issues,
        }),
        implementationIdentity: {
          implementationGitSha: "1".repeat(40),
          finalizerSha256: "2".repeat(64),
          authorityProducerSha256: "3".repeat(64),
        },
      });
    const finalized = await finalizeWithAuthority(authority, outputDir, registryStagingRoot);
    assert.equal(finalized.acceptance.status, "rejected");
    assert.equal(finalized.acceptance.isCalibrated, false);
    assert.deepEqual(finalized.acceptance.issues, issues);
    assert.equal(finalized.operationalAcceptance.authorityStatus,
      "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS");
    assert.equal(finalized.bundle.manifest.artifacts.length, 13);
    assert.equal(finalized.bundle.manifest.operationalAcceptance.exceptionCount, 36);
    assert.equal(
      finalized.bundle.manifest.artifacts[3].role,
      "product_owner_operational_acceptance",
    );
    const emittedProfile = JSON.parse(await readFile(
      path.join(outputDir, "mathematical-calibration-profile-v1.json"),
      "utf8",
    ));
    assert.equal(emittedProfile.isCalibrated, false);
    assert.equal(emittedProfile.status, "rejected");
    assert.deepEqual(emittedProfile.operationalAcceptance.exceptionLedger, issues);
    const handoff = JSON.parse(await readFile(
      path.join(
        registryStagingRoot,
        finalized.bundle.sha256,
        "mathematical-calibration-finalizer-handoff-v1.json",
      ),
      "utf8",
    ));
    assert.equal(handoff.operationalAcceptanceStatus,
      "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS");
    assert.equal(handoff.operationalAcceptanceAuthoritySha256, authority.authoritySha256);
    assert.equal(
      handoff.operationalAcceptanceAuthorityFileSha256,
      finalized.bundle.manifest.operationalAcceptance.authorityFileSha256,
    );
    await assert.rejects(
      finalizeWithAuthority({
        ...authority,
        subject: {
          ...authority.subject,
          sourceCaptureManifestSha256: "7".repeat(64),
        },
      }, path.join(temporaryRoot, "wrong-capture-manifest"), path.join(temporaryRoot, "wrong-capture-staging")),
      /sourceCaptureManifestSha256/,
    );
    await assert.rejects(
      finalizeWithAuthority({
        ...authority,
        subject: {
          ...authority.subject,
          sourceCapturePackageSha256: "8".repeat(64),
        },
      }, path.join(temporaryRoot, "wrong-source-package"), path.join(temporaryRoot, "wrong-package-staging")),
      /sourceCapturePackageSha256/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("owner-authorized finalizer output canonically loads with distinct capture manifest and package identities", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "calibration-owner-loader-"));
  try {
    const fixture = await writeCanonicalLoaderAnalysisFixture(temporaryRoot);
    assert.notEqual(
      fixture.value.sourceManifestSha256,
      fixture.value.sourceCapturePackage.manifestSha256,
    );
    const profile = {
      schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
      profileId: "canonical-loader-profile-v1",
      calibrationVersion: "canonical-loader-calibration-v1",
      rigId: fixture.value.sourceCapturePackage.rigId,
      finalizedAt: fixture.finalizedAt,
      thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
      thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
      artifactId: "canonical-loader-physical-artifact-v1",
      isCalibrated: false,
      status: "rejected",
    };
    const physicalArtifact = contentAddressedArtifact({
      schemaVersion: "ai-grader-physical-calibration-artifact-v1",
      algorithmVersion: "fixed_rig_physical_calibration_v1",
      thresholdSetId: profile.thresholdSetId,
      thresholdSetHash: profile.thresholdSetHash,
      rigId: profile.rigId,
      profileId: profile.profileId,
      calibrationVersion: profile.calibrationVersion,
      finalizedAt: profile.finalizedAt,
      artifactId: profile.artifactId,
      methods: {
        coverageFactor: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor,
      },
      inputs: {
        channels: fixture.flatFieldFileSha256.map((flatFieldArtifactSha256, offset) => ({
          channelIndex: offset + 1,
          flatFieldArtifactSha256,
          illuminationPatternArtifactSha256: fixture.illuminationPatternFileSha256,
        })),
      },
    });
    profile.artifactSha256 = physicalArtifact.artifactSha256;
    const issues = Array.from({ length: 36 }, (_, index) => ({
      path: `analysis.exceptions.${index + 1}`,
      message: `Recorded exception ${index + 1}.`,
    }));
    const result = {
      status: "rejected",
      isCalibrated: false,
      profile: null,
      operationalProfileCandidate: profile,
      artifact: physicalArtifact,
      issues,
    };
    const verifiedAnalysis = verifyMathematicalCalibrationAnalysisV1(fixture.value);
    const acceptance = buildMathematicalCalibrationAcceptanceV1(verifiedAnalysis, result);
    const analysisFileSha256 = digest(await readFile(fixture.analysisPath));
    const exceptionLedgerSha256 = digest(Buffer.from(
      shared.canonicalProductOwnerOperationalAcceptanceIssueLedgerV1(issues),
      "utf8",
    ));
    const authorityWithoutHash = {
      schemaVersion: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION,
      authorityId: "canonical-loader-owner-authority-v1",
      authorityStatus: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
      hashPolicy: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY,
      owner: { name: "Mark", organization: "Ten Kings", role: "product_owner" },
      decisionAt: "2026-07-22T12:05:00.000Z",
      reason: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON,
      subject: {
        sessionId: fixture.value.sourceCapturePackage.stationAuthority.sessionId,
        sessionStateSha256: "6".repeat(64),
        sourceCaptureManifestSha256: fixture.value.sourceManifestSha256,
        sourceCapturePackageSha256: fixture.value.sourceCapturePackage.manifestSha256,
        analysisSha256: fixture.value.analysisSha256,
        analysisFileSha256,
        thresholdSetHash: profile.thresholdSetHash,
        physicalArtifactSha256: physicalArtifact.artifactSha256,
        mathematicalAcceptanceFileSha256: digest(exactJsonBytes(acceptance)),
        mathematicalAcceptanceStatus: "rejected",
        mathematicalIsCalibrated: false,
        rigId: profile.rigId,
        profileId: profile.profileId,
        calibrationVersion: profile.calibrationVersion,
        finalizedAt: profile.finalizedAt,
        artifactId: profile.artifactId,
      },
      exceptionLedger: issues,
      exceptionLedgerSha256,
      implementation: {
        contractVersion: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION,
        implementationGitSha: "1".repeat(40),
        finalizerSha256: "2".repeat(64),
        authorityProducerSha256: "3".repeat(64),
        nodeRuntimeVersion: process.version,
      },
      lifecycle: {
        sequence: 1,
        priorAuthoritySha256: null,
        revokedByAuthoritySha256: null,
        supersededByAuthoritySha256: null,
      },
    };
    const authority = { ...authorityWithoutHash, authoritySha256: "0".repeat(64) };
    authority.authoritySha256 = digest(Buffer.from(
      shared.canonicalProductOwnerOperationalAcceptancePayloadV1(authority),
      "utf8",
    ));
    const authorityPath = path.join(temporaryRoot, "product-owner-operational-acceptance-v1.json");
    await writeFile(authorityPath, exactJsonBytes(authority));
    const outputDir = path.join(temporaryRoot, "finalized-owner-bundle");
    const finalized = await finalizeMathematicalCalibrationV1({
      analysisPath: fixture.analysisPath,
      outputDir,
      productOwnerOperationalAcceptancePath: authorityPath,
      buildFixedRigPhysicalCalibrationV1: () => result,
      verifyProductOwnerOperationalAcceptanceV1: (candidate) => candidate,
      validateMathematicalCalibrationForOperationalUseV1: (candidate) => ({
        valid: true,
        isCalibrated: false,
        isOperationallyAccepted: true,
        profile: candidate,
        issues,
      }),
      implementationIdentity: {
        implementationGitSha: "1".repeat(40),
        finalizerSha256: "2".repeat(64),
        authorityProducerSha256: "3".repeat(64),
      },
    });
    assert.equal(finalized.bundle.manifest.artifacts.length, 13);

    const ownerDriver = require(
      "../../../packages/ai-grader-capture-helper/dist/drivers/productOwnerOperationalAcceptanceV1.js",
    );
    const loaderDriver = require(
      "../../../packages/ai-grader-capture-helper/dist/drivers/fixedRigMathematicalCalibrationBundleV1.js",
    );
    const originalVerify = ownerDriver.verifyProductOwnerOperationalAcceptanceV1;
    const originalValidate = ownerDriver.validateMathematicalCalibrationForOperationalUseV1;
    try {
      // The Production authority schema is intentionally incident-bound to immutable
      // real hashes. This isolated seam substitutes only that incident validator; the
      // real finalizer output and canonical loader perform every bundle/member/binding check.
      ownerDriver.verifyProductOwnerOperationalAcceptanceV1 = (candidate) => candidate;
      ownerDriver.validateMathematicalCalibrationForOperationalUseV1 = (candidate) => ({
        valid: true,
        isCalibrated: false,
        isOperationallyAccepted: true,
        profile: candidate,
        issues,
      });
      const loaded = loaderDriver.loadFixedRigMathematicalCalibrationBundleV1({
        bundlePath: finalized.bundle.path,
        bundleSha256: finalized.bundle.sha256,
        expectedRigId: profile.rigId,
      });
      assert.equal(loaded.authority.members.length, 13);
      assert.equal(loaded.profile.status, "rejected");
      assert.equal(loaded.profile.isCalibrated, false);
      assert.equal(loaded.operationalAcceptance.exceptionLedger.length, 36);
      assert.equal(
        loaded.operationalAcceptance.subject.sourceCaptureManifestSha256,
        fixture.value.sourceManifestSha256,
      );
      assert.equal(
        loaded.operationalAcceptance.subject.sourceCapturePackageSha256,
        fixture.value.sourceCapturePackage.manifestSha256,
      );
    } finally {
      ownerDriver.verifyProductOwnerOperationalAcceptanceV1 = originalVerify;
      ownerDriver.validateMathematicalCalibrationForOperationalUseV1 = originalValidate;
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("owner-authority producer independently binds distinct capture-manifest and source-package identities", () => {
  const incident = PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT;
  const sourceAnalysis = {
    analysisSha256: incident.analysisSha256,
    sourceManifestSha256: incident.sourceCaptureManifestSha256,
    sourceCapturePackage: {
      manifestSha256: incident.sourceCapturePackageSha256,
      stationAuthority: { sessionId: incident.sessionId },
      thresholdSetHash: incident.thresholdSetHash,
    },
  };
  assert.notEqual(sourceAnalysis.sourceManifestSha256, sourceAnalysis.sourceCapturePackage.manifestSha256);
  assert.doesNotThrow(() => assertOperationalAcceptanceAnalysisSourceAuthorityV1(sourceAnalysis));
  assert.throws(
    () => assertOperationalAcceptanceAnalysisSourceAuthorityV1({
      ...sourceAnalysis,
      sourceManifestSha256: "7".repeat(64),
    }),
    /does not reproduce the exact source authority/,
  );
  assert.throws(
    () => assertOperationalAcceptanceAnalysisSourceAuthorityV1({
      ...sourceAnalysis,
      sourceCapturePackage: {
        ...sourceAnalysis.sourceCapturePackage,
        manifestSha256: "8".repeat(64),
      },
    }),
    /does not reproduce the exact source authority/,
  );
});
