const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const shared = require("@tenkings/shared");
const {
  validateMathematicalCalibrationForOperationalUseV1,
  verifyProductOwnerOperationalAcceptanceV1,
} = require("../dist/drivers/productOwnerOperationalAcceptanceV1.js");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function rejectedProfile() {
  return {
    schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
    profileId: "owner-authorized-profile-v1",
    calibrationVersion: "owner-authorized-calibration-v1",
    rigId: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.rigId,
    isCalibrated: false,
    status: "rejected",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: shared.MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: shared.MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "owner-authorized-artifact-v1",
    artifactSha256:
      shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.physicalArtifactSha256,
    finalizedAt: "2026-07-22T12:00:00.000Z",
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    mmPerPixelX: 63.5 / 1200,
    mmPerPixelY: 88.9 / 1680,
    scaleRelativeU95: 0.001,
    scaleSampleCount: 20,
    lensCalibrationViewCount: 20,
    lensResidualPx: 100,
    normalizationRegistrationResidualPx: 0.1,
    normalizationRegistrationSampleCount: 20,
    repeatedPlacementCount: 20,
    repeatedPlacementU95Mm: 0.005,
    segmentationBoundaryU95Px: 0.1,
    segmentationBoundarySampleCount: 20,
    measurementRepeatability: {
      linearMm: { sampleCount: 20, u95: 0.001 },
      areaMm2: { sampleCount: 20, u95: 0.001 },
      reliefIndex: { sampleCount: 20, u95: 0.001 },
      roughnessIndex: { sampleCount: 20, u95: 0.001 },
      colorDeltaE: { sampleCount: 20, u95: 0.001 },
    },
    channels: Array.from({ length: 8 }, (_, offset) => {
      const angle = offset * Math.PI / 4;
      return {
        channelIndex: offset + 1,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 0.999,
        directionMeasurementSampleCount: 3,
        directionAngularU95Degrees: 0.1,
        directionSourceRadiusMm: 100,
        directionPointU95Mm: 0.1,
        flatFieldArtifactId: `flat-field-${offset + 1}`,
        flatFieldArtifactSha256: String(offset + 1).repeat(64).slice(0, 64),
        flatFieldFrameCount: 3,
        darkControlFrameCount: 3,
        maxFlatFieldDeviationFraction: 0,
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: "9".repeat(64),
        illuminationPatternFrameCount: 3,
        responseScale: 1,
      };
    }),
  };
}

function authorityFor(profile = rejectedProfile()) {
  const mathematical = shared.validateMathematicalCalibrationProfileV1({
    ...profile,
    isCalibrated: true,
    status: "finalized",
  });
  assert.equal(mathematical.valid, false);
  assert.ok(mathematical.issues.length > 0);
  assert.ok(mathematical.issues.length <= 36);
  const fillerCount = 36 - mathematical.issues.length;
  const exceptionLedger = [
    ...Array.from({ length: fillerCount }, (_, index) => ({
      path: `certifiedAnalysis.exception${index + 1}`,
      message: `Immutable certified-analysis exception ${index + 1}.`,
    })),
    ...mathematical.issues,
  ];
  const withoutHash = {
    schemaVersion: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION,
    authorityId: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_AUTHORITY_ID,
    authorityStatus: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
    hashPolicy: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY,
    owner: {
      name: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_NAME,
      organization: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_ORGANIZATION,
      role: "product_owner",
    },
    decisionAt: "2026-07-22T12:05:00.000Z",
    reason: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON,
    subject: {
      ...shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT,
      mathematicalAcceptanceStatus: "rejected",
      mathematicalIsCalibrated: false,
      profileId: profile.profileId,
      calibrationVersion: profile.calibrationVersion,
      finalizedAt: profile.finalizedAt,
      artifactId: profile.artifactId,
    },
    exceptionLedger,
    exceptionLedgerSha256: sha256(Buffer.from(
      shared.canonicalProductOwnerOperationalAcceptanceIssueLedgerV1(exceptionLedger),
      "utf8",
    )),
    implementation: {
      contractVersion: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION,
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
  const unhashed = { ...withoutHash, subject: { ...withoutHash.subject } };
  delete unhashed.subject.exceptionCount;
  const candidate = { ...unhashed, authoritySha256: "0".repeat(64) };
  candidate.authoritySha256 = sha256(Buffer.from(
    shared.canonicalProductOwnerOperationalAcceptancePayloadV1(candidate),
    "utf8",
  ));
  return candidate;
}

test("exact product-owner authority permits operational use while mathematical acceptance remains rejected", () => {
  const profile = rejectedProfile();
  const authority = authorityFor(profile);
  const verified = verifyProductOwnerOperationalAcceptanceV1(authority, {
    implementationGitSha: "1".repeat(40),
    finalizerSha256: "2".repeat(64),
    authorityProducerSha256: "3".repeat(64),
  });
  const result = validateMathematicalCalibrationForOperationalUseV1({
    ...profile,
    operationalAcceptance: verified,
  });
  assert.equal(result.valid, true);
  assert.equal(result.isCalibrated, false);
  assert.equal(result.isOperationallyAccepted, true);
  assert.equal(result.operationalStatus, "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS");
  assert.equal(result.profile.status, "rejected");
  assert.equal(result.profile.operationalAcceptance.exceptionLedger.length, 36);
});

test("authority rejects tampering, missing issues, changed evidence identities, and wrong owner", () => {
  const authority = authorityFor();
  assert.throws(
    () => verifyProductOwnerOperationalAcceptanceV1({ ...authority, reason: `${authority.reason} altered` }),
  );
  assert.throws(
    () => verifyProductOwnerOperationalAcceptanceV1({
      ...authority,
      exceptionLedger: authority.exceptionLedger.slice(1),
    }),
  );
  for (const field of [
    "sessionId",
    "sessionStateSha256",
    "sourceCaptureManifestSha256",
    "sourceCapturePackageSha256",
    "analysisSha256",
    "analysisFileSha256",
    "thresholdSetHash",
  ]) {
    assert.throws(() => verifyProductOwnerOperationalAcceptanceV1({
      ...authority,
      subject: { ...authority.subject, [field]: field === "sessionId" ? "another-session" : "f".repeat(64) },
    }), field);
  }
  assert.throws(() => verifyProductOwnerOperationalAcceptanceV1({
    ...authority,
    owner: { ...authority.owner, name: "Browser" },
  }));
});

test("authority cannot be replayed into another profile or hide an altered measurement", () => {
  const profile = rejectedProfile();
  const authority = authorityFor(profile);
  for (const changed of [
    { ...profile, profileId: "another-profile" },
    { ...profile, lensResidualPx: 101 },
  ]) {
    const result = validateMathematicalCalibrationForOperationalUseV1({
      ...changed,
      operationalAcceptance: authority,
    });
    assert.equal(result.valid, false);
    assert.equal(result.isOperationallyAccepted, false);
  }
  const invented = validateMathematicalCalibrationForOperationalUseV1({
    ...profile,
    operationalAcceptance: true,
  });
  assert.equal(invented.valid, false);
});
