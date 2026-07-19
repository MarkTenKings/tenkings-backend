const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} = require("@tenkings/shared");
const {
  AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION,
  AI_GRADER_PHYSICAL_CALIBRATION_ARTIFACT_HASH_POLICY,
  AI_GRADER_PHYSICAL_CALIBRATION_ARTIFACT_V1_SCHEMA_VERSION,
  createAiGraderMathematicalCalibrationSnapshotService,
} = require("../dist/database/src/aiGraderMathematicalCalibrationSnapshotService");

const NOW = new Date("2026-07-18T20:00:00.000Z");
const BUNDLE_SCHEMA = "ten-kings-mathematical-calibration-bundle-v1";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function hashCanonical(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function artifactSet(suffix = "v1") {
  const directory = `ai-grader/calibration/${suffix}`;
  const flatBytes = Array.from({ length: 8 }, (_, offset) =>
    Buffer.from(JSON.stringify({ schemaVersion: "flat-test-v1", channelIndex: offset + 1, suffix })));
  const illuminationBytes = Buffer.from(JSON.stringify({
    schemaVersion: "illumination-test-v1",
    channels: Array.from({ length: 8 }, (_, index) => index + 1),
    suffix,
  }));
  const illuminationSha256 = hashBytes(illuminationBytes);
  const artifactWithoutHash = {
    schemaVersion: AI_GRADER_PHYSICAL_CALIBRATION_ARTIFACT_V1_SCHEMA_VERSION,
    algorithmVersion: "fixed-rig-physical-calibration-v1.0.0",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: `physical-calibration-${suffix}`,
    hashPolicy: AI_GRADER_PHYSICAL_CALIBRATION_ARTIFACT_HASH_POLICY,
    profileId: `mathematical-calibration-${suffix}`,
    calibrationVersion: `calibration-${suffix}.0.0`,
    rigId: "ten-kings-fixed-rig-v1",
    finalizedAt: "2026-07-18T18:00:00.000Z",
    operatorId: "physical-operator-1",
    target: { version: "target-v1", sha256: "c".repeat(64) },
    evidence: [],
    inputs: {},
    computed: {},
    methods: {},
  };
  const artifactSha256 = hashCanonical(artifactWithoutHash);
  const physicalArtifact = { ...artifactWithoutHash, artifactSha256 };
  const profile = {
    schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
    profileId: artifactWithoutHash.profileId,
    calibrationVersion: artifactWithoutHash.calibrationVersion,
    rigId: artifactWithoutHash.rigId,
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: artifactWithoutHash.thresholdSetId,
    thresholdSetHash: artifactWithoutHash.thresholdSetHash,
    artifactId: artifactWithoutHash.artifactId,
    artifactSha256,
    finalizedAt: artifactWithoutHash.finalizedAt,
    normalizedWidthPx: 1200,
    normalizedHeightPx: 1680,
    mmPerPixelX: 63.5 / 1200,
    mmPerPixelY: 88.9 / 1680,
    scaleRelativeU95: 0.001,
    scaleSampleCount: 20,
    lensCalibrationViewCount: 20,
    lensResidualPx: 0.1,
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
        flatFieldArtifactSha256: hashBytes(flatBytes[offset]),
        flatFieldFrameCount: 3,
        darkControlFrameCount: 3,
        maxFlatFieldDeviationFraction: 0,
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: illuminationSha256,
        illuminationPatternFrameCount: 3,
        responseScale: 1,
      };
    }),
  };
  const profileBytes = Buffer.from(JSON.stringify(profile));
  const artifactBytes = Buffer.from(JSON.stringify(physicalArtifact));
  const acceptanceBytes = Buffer.from(JSON.stringify({ schemaVersion: "acceptance-test-v1", suffix }));
  const members = [
    { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json", sha256: hashBytes(profileBytes) },
    { role: "physical_calibration_artifact", fileName: "mathematical-calibration-artifact-v1.json", sha256: hashBytes(artifactBytes) },
    { role: "calibration_acceptance", fileName: "mathematical-calibration-acceptance-v1.json", sha256: hashBytes(acceptanceBytes) },
    ...flatBytes.map((bytes, offset) => ({
      role: "flat_field",
      channelIndex: offset + 1,
      fileName: `flat-field-channel-${offset + 1}-v1.json`,
      sha256: hashBytes(bytes),
    })),
    { role: "illumination_pattern", fileName: "illumination-pattern-v1.json", sha256: illuminationSha256 },
  ];
  const bundleBytes = Buffer.from(JSON.stringify({ schemaVersion: BUNDLE_SCHEMA, suffix, members }));
  const authority = {
    schemaVersion: BUNDLE_SCHEMA,
    bundleManifestSha256: hashBytes(bundleBytes),
    sourceCaptureManifestSha256: hashCanonical({ source: suffix }),
    memberLedgerSha256: hashCanonical(members),
    members,
  };
  const bundleKey = `${directory}/mathematical-calibration-bundle-v1.json`;
  const memberBytes = [profileBytes, artifactBytes, acceptanceBytes, ...flatBytes, illuminationBytes];
  const memberStorageKeys = members.map((member) => ({
    ...member,
    storageKey: `${directory}/${member.fileName}`,
  }));
  const storage = new Map([[bundleKey, bundleBytes]]);
  memberStorageKeys.forEach((member, index) => storage.set(member.storageKey, memberBytes[index]));
  const files = memberStorageKeys.map((member) => ({ path: member.storageKey, sha256: member.sha256 }));
  return {
    suffix,
    profile,
    physicalArtifact,
    authority,
    bundleKey,
    memberStorageKeys,
    storage,
    loaded: {
      profile,
      physicalArtifact,
      authority,
      files: {
        profile: files[0],
        physicalArtifact: files[1],
        acceptance: files[2],
        flatFields: files.slice(3, 11),
        illuminationPattern: files[11],
      },
    },
  };
}

function row(set, overrides = {}) {
  return {
    id: `snapshot-${set.suffix}`,
    rigId: set.profile.rigId,
    calibrationType: "MATHEMATICAL_GRADING_V1",
    componentSerials: { camera: "basler-1", light: "leimac-1" },
    artifactKeys: {
      schemaVersion: AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION,
      bundleStorageKey: set.bundleKey,
      members: set.memberStorageKeys,
    },
    artifactChecksums: {
      schemaVersion: AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION,
      calibrationBundleAuthority: set.authority,
      physicalArtifactCanonicalSha256: set.profile.artifactSha256,
    },
    residuals: {},
    operatorId: "importer-1",
    mathematicalProfileId: set.profile.profileId,
    mathematicalCalibrationVersion: set.profile.calibrationVersion,
    mathematicalProfileFinalizedAt: new Date(set.profile.finalizedAt),
    mathematicalArtifactId: set.profile.artifactId,
    mathematicalArtifactSha256: set.profile.artifactSha256,
    mathematicalThresholdSetId: set.profile.thresholdSetId,
    mathematicalThresholdSetHash: set.profile.thresholdSetHash,
    mathematicalBundleSchemaVersion: set.authority.schemaVersion,
    mathematicalBundleManifestSha256: set.authority.bundleManifestSha256,
    mathematicalSourceCaptureManifestSha256: set.authority.sourceCaptureManifestSha256,
    mathematicalMemberLedgerSha256: set.authority.memberLedgerSha256,
    trustStatus: "DRAFT",
    trustedAt: null,
    trustedByOperatorId: null,
    revokedAt: null,
    revokedByOperatorId: null,
    revocationReason: null,
    validityStartsAt: new Date("2026-07-18T19:00:00.000Z"),
    validityEndsAt: null,
    supersededById: null,
    supersededByOperatorId: null,
    supersessionReason: null,
    createdAt: new Date("2026-07-18T19:00:00.000Z"),
    ...overrides,
  };
}

function serviceOptions(sets, onLoad = () => {}) {
  const byBundleKey = new Map(sets.map((set) => [set.bundleKey, set]));
  return {
    now: () => NOW,
    async readArtifactBytes(key) {
      for (const set of sets) {
        if (set.storage.has(key)) return set.storage.get(key);
      }
      throw new Error("missing");
    },
    async loadFinalizedBundle(input) {
      onLoad(input);
      const set = byBundleKey.get(input.bundleStorageKey);
      if (!set || input.bundleSha256 !== set.authority.bundleManifestSha256 ||
          input.expectedRigId !== set.profile.rigId) throw new Error("bundle identity mismatch");
      const bundleBytes = await input.readArtifactBytes(set.bundleKey);
      if (hashBytes(bundleBytes) !== set.authority.bundleManifestSha256) throw new Error("bundle changed");
      for (const member of set.memberStorageKeys) {
        const bytes = await input.readArtifactBytes(member.storageKey);
        if (hashBytes(bytes) !== member.sha256) throw new Error("member changed");
      }
      return set.loaded;
    },
  };
}

function mockDb(overrides = {}) {
  const delegate = {
    async create({ data }) { return row(artifactSet(), data); },
    async findFirst() { return null; },
    async findMany() { return []; },
    async updateMany() { return { count: 0 }; },
    ...overrides,
  };
  return {
    calibrationSnapshot: delegate,
    async $transaction(operation) { return operation({ calibrationSnapshot: delegate }); },
  };
}

test("imports DRAFT only after the exact manifest and all twelve member bytes verify", async () => {
  const set = artifactSet();
  let createData;
  let loads = 0;
  const service = createAiGraderMathematicalCalibrationSnapshotService(mockDb({
    async create({ data }) {
      createData = data;
      return row(set, data);
    },
  }), serviceOptions([set], () => { loads += 1; }));
  const created = await service.importDraft({
    rigId: set.profile.rigId,
    bundleStorageKey: set.bundleKey,
    expectedBundleManifestSha256: set.authority.bundleManifestSha256,
    componentSerials: { light: "leimac-1", camera: "basler-1" },
    importedByOperatorId: "importer-1",
    validityStartsAt: "2026-07-18T19:00:00.000Z",
  });
  assert.equal(created.trustStatus, "DRAFT");
  assert.equal(loads, 1);
  assert.equal(createData.artifactKeys.members.length, 12);
  assert.deepEqual(createData.artifactChecksums.calibrationBundleAuthority, set.authority);
  assert.equal(createData.mathematicalBundleManifestSha256, set.authority.bundleManifestSha256);
  assert.equal(createData.mathematicalSourceCaptureManifestSha256, set.authority.sourceCaptureManifestSha256);
  assert.equal(createData.mathematicalMemberLedgerSha256, set.authority.memberLedgerSha256);
  assert.deepEqual(Object.keys(createData.componentSerials), ["camera", "light"]);
});

test("wrong bundle manifest identity fails before snapshot insertion", async () => {
  const set = artifactSet();
  let creates = 0;
  const service = createAiGraderMathematicalCalibrationSnapshotService(mockDb({
    async create() { creates += 1; return row(set); },
  }), serviceOptions([set]));
  await assert.rejects(service.importDraft({
    rigId: set.profile.rigId,
    bundleStorageKey: set.bundleKey,
    expectedBundleManifestSha256: "f".repeat(64),
    componentSerials: { camera: "basler-1" },
    importedByOperatorId: "importer-1",
  }), (error) => error.code === "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH");
  assert.equal(creates, 0);
});

test("trust rereads and reverifies the complete bundle before and after its conditional transition", async () => {
  const set = artifactSet();
  const updates = [];
  let status = "DRAFT";
  let loads = 0;
  const service = createAiGraderMathematicalCalibrationSnapshotService(mockDb({
    async findFirst({ where }) {
      if (where.id !== "snapshot-v1") return null;
      return row(set, {
        trustStatus: status,
        trustedAt: status === "TRUSTED" ? NOW : null,
        trustedByOperatorId: status === "TRUSTED" ? "reviewer-1" : null,
      });
    },
    async updateMany(args) {
      updates.push(args);
      status = "TRUSTED";
      return { count: 1 };
    },
  }), serviceOptions([set], () => { loads += 1; }));
  const trusted = await service.trust({
    snapshotId: "snapshot-v1",
    expectedArtifactSha256: set.profile.artifactSha256,
    expectedBundleManifestSha256: set.authority.bundleManifestSha256,
    trustedByOperatorId: "reviewer-1",
  });
  assert.equal(trusted.trustStatus, "TRUSTED");
  assert.equal(loads, 2);
  assert.equal(updates[0].where.mathematicalBundleManifestSha256, set.authority.bundleManifestSha256);
});

test("trust refuses one changed flat-field member before any lifecycle mutation", async () => {
  const set = artifactSet();
  let updates = 0;
  set.storage.set(set.memberStorageKeys[6].storageKey, Buffer.from('{"changed":true}'));
  const service = createAiGraderMathematicalCalibrationSnapshotService(mockDb({
    async findFirst() { return row(set); },
    async updateMany() { updates += 1; return { count: 1 }; },
  }), serviceOptions([set]));
  await assert.rejects(service.trust({
    snapshotId: "snapshot-v1",
    expectedArtifactSha256: set.profile.artifactSha256,
    expectedBundleManifestSha256: set.authority.bundleManifestSha256,
    trustedByOperatorId: "reviewer-1",
  }), (error) => error.code === "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH");
  assert.equal(updates, 0);
});

test("revocation and supersession condition on both physical artifact and complete bundle hashes", async () => {
  const first = artifactSet("v1");
  const second = artifactSet("v2");
  const revokeUpdates = [];
  let revoked = false;
  const revokeService = createAiGraderMathematicalCalibrationSnapshotService(mockDb({
    async updateMany(args) { revokeUpdates.push(args); revoked = true; return { count: 1 }; },
    async findFirst() {
      return row(first, {
        trustStatus: revoked ? "REVOKED" : "TRUSTED",
        trustedAt: new Date("2026-07-18T19:30:00.000Z"),
        trustedByOperatorId: "reviewer-1",
        revokedAt: revoked ? NOW : null,
        revokedByOperatorId: revoked ? "reviewer-2" : null,
        revocationReason: revoked ? "controlled calibration invalidation" : null,
      });
    },
  }), serviceOptions([first]));
  await revokeService.revoke({
    snapshotId: "snapshot-v1",
    expectedArtifactSha256: first.profile.artifactSha256,
    expectedBundleManifestSha256: first.authority.bundleManifestSha256,
    revokedByOperatorId: "reviewer-2",
    reason: "controlled calibration invalidation",
  });
  assert.equal(revokeUpdates[0].where.mathematicalBundleManifestSha256, first.authority.bundleManifestSha256);

  const updates = [];
  let replacementTrusted = false;
  const supersedeService = createAiGraderMathematicalCalibrationSnapshotService(mockDb({
    async findFirst({ where }) {
      if (where.id === "snapshot-v1") return row(first, {
        trustStatus: "TRUSTED",
        trustedAt: new Date("2026-07-18T19:30:00.000Z"),
        trustedByOperatorId: "reviewer-1",
      });
      if (where.id === "snapshot-v2") return row(second, {
        trustStatus: replacementTrusted ? "TRUSTED" : "DRAFT",
        trustedAt: replacementTrusted ? NOW : null,
        trustedByOperatorId: replacementTrusted ? "reviewer-2" : null,
      });
      return null;
    },
    async updateMany(args) {
      updates.push(args);
      if (args.where.id === "snapshot-v2") replacementTrusted = true;
      return { count: 1 };
    },
  }), serviceOptions([first, second]));
  await supersedeService.supersede({
    priorSnapshotId: "snapshot-v1",
    expectedPriorArtifactSha256: first.profile.artifactSha256,
    expectedPriorBundleManifestSha256: first.authority.bundleManifestSha256,
    replacementSnapshotId: "snapshot-v2",
    expectedReplacementArtifactSha256: second.profile.artifactSha256,
    expectedReplacementBundleManifestSha256: second.authority.bundleManifestSha256,
    supersededByOperatorId: "reviewer-2",
    reason: "new certified physical calibration",
  });
  assert.equal(updates[0].where.mathematicalBundleManifestSha256, second.authority.bundleManifestSha256);
  assert.equal(updates[1].where.mathematicalBundleManifestSha256, first.authority.bundleManifestSha256);
});

test("schema, migration, and disposable validator retain immutable full-bundle lifecycle evidence", () => {
  const packageRoot = join(__dirname, "..");
  const schema = readFileSync(join(packageRoot, "prisma", "schema.prisma"), "utf8");
  const migration = readFileSync(join(
    packageRoot,
    "prisma",
    "migrations",
    "20260718150000_ai_grader_design_reference_v1",
    "migration.sql",
  ), "utf8");
  const validator = readFileSync(
    join(packageRoot, "scripts", "validateAiGraderMathematicalCalibrationSnapshot.sql"),
    "utf8",
  );
  for (const expected of [
    "mathematicalBundleSchemaVersion",
    "mathematicalBundleManifestSha256",
    "mathematicalSourceCaptureManifestSha256",
    "mathematicalMemberLedgerSha256",
    "CalibrationSnapshot_guard_mathematical_update",
    "CalibrationSnapshot_reject_mathematical_delete",
  ]) {
    assert.equal(schema.includes(expected) || migration.includes(expected), true, expected);
    assert.equal(migration.includes(expected), true, expected);
    assert.equal(validator.includes(expected) || expected.includes("guard") || expected.includes("reject"), true, expected);
  }
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/i);
});
