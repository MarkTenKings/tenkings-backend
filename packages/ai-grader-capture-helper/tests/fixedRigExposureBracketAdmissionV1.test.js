const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyFixedRigCommonModeInteriorAdmissionV1,
} = require("../dist/drivers/fixedRigPhotometricAdmissionV1");
const {
  buildFixedRigExposureBracketFusionV1,
} = require("../dist/drivers/fixedRigExposureBracketFusionV1");
const {
  isExactSealedCommonModeAdmissionV1,
  suppressExactSealedAdmissionPublicLimitationV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationOrchestratorV1");
const {
  buildFixedRigPhotometricEvidenceV1,
} = require("../dist/drivers/fixedRigPhotometricEvidenceV1");
const {
  assertFixedRigExactLeimacWritesV1,
  assertFixedRigPhotometricBracketCaptureProvenanceV1,
  assertFixedRigReusedAuthoritativeTransformV1,
  rehashFixedRigPhotometricBracketRawCapturesV1,
} = require("../dist/drivers/fixedRigMathematicalStationAdapterV1");

const SHA = "a".repeat(64);

function componentPixels(width, x, y, count) {
  const pixels = [];
  for (let offset = 0; offset < count; offset += 1) {
    pixels.push((y + Math.floor(offset / 6)) * width + x + (offset % 6));
  }
  return pixels;
}

function evidence(options = {}) {
  const width = 600;
  const height = 500;
  const regions = options.regions ?? [
    componentPixels(width, 250, 220, 17),
    componentPixels(width, 350, 300, 5),
    componentPixels(width, 400, 350, 1),
    componentPixels(width, 450, 400, 1),
  ];
  const invalidIndexes = regions.flat();
  const pixelCount = width * height;
  const invalid = new Uint8Array(pixelCount);
  const commonMode = new Uint8Array(pixelCount);
  for (const index of invalidIndexes) {
    invalid[index] = 1;
    commonMode[index] = 1;
  }
  const channels = Array.from({ length: 8 }, (_, index) => ({
    channel: index + 1,
    sourceEvidenceId: `channel-${index + 1}`,
    sourceSha256: SHA,
    flatFieldSourceEvidenceId: `flat-${index + 1}`,
    flatFieldSourceSha256: SHA,
    correctedResponse: new Float32Array(pixelCount),
    directionalResidual: new Float32Array(pixelCount),
    validDirectionalObservationMask: new Uint8Array(pixelCount),
    saturationMask: new Uint8Array(pixelCount),
    underexposureMask: new Uint8Array(pixelCount),
    lowConfidenceMask: new Uint8Array(pixelCount),
  }));
  if (options.underexposureIndex !== undefined) {
    channels[0].underexposureMask[options.underexposureIndex] = 1;
  }
  const clipping = new Uint8Array(pixelCount);
  if (options.clippingIndex !== undefined) clipping[options.clippingIndex] = 1;
  const gradeRelevantMask = new Uint8Array(pixelCount).fill(1);
  const validPixelFraction =
    options.validPixelFraction ?? (pixelCount - invalidIndexes.length) / pixelCount;
  return {
    version: "fixed_rig_photometric_evidence_v1",
    status: "insufficient_evidence",
    coordinateFrame: "normalized_card_portrait_pixels",
    width,
    height,
    channelCount: 8,
    calibration: {
      profileId: "calibration",
      version: "v1",
      sha256: SHA,
      sourceEvidenceIds: [],
      finalizedAndCalibrated: true,
    },
    thresholdSetVersion: "v1",
    thresholdSetId: "v1",
    thresholdSetHash: SHA,
    flatFieldCorrectionApplied: true,
    channels,
    commonModeResponse: new Float32Array(pixelCount),
    calibratedPatternScale: new Float32Array(pixelCount),
    calibratedPatternSimilarity: new Float32Array(pixelCount),
    usableDirectionalObservationCount: new Uint8Array(pixelCount).fill(8),
    clippingMask: clipping,
    commonModeSpecularMask: commonMode,
    calibratedIlluminationPatternMask: new Uint8Array(pixelCount),
    specularOrIlluminationMask: commonMode,
    lowConfidenceMask: new Uint8Array(pixelCount),
    insufficientDirectionalObservationsMask: invalid,
    invalidIlluminationMask: invalid,
    gradeRelevantMask,
    gradeRelevantMaskSourceEvidenceId: "expected-card-mask",
    gradeRelevantMaskSourceSha256: SHA,
    ungradableRegions: regions
      .filter((region) => region.length >= 12)
      .map((region, index) => ({
        regionId: `ungradable-${index + 1}`,
        x: Math.min(...region.map((value) => value % width)),
        y: Math.min(...region.map((value) => Math.floor(value / width))),
        width: 6,
        height: Math.ceil(region.length / 6),
        pixelCount: region.length,
        affectedGradeRelevantPixelFraction: region.length / pixelCount,
        requiresRecapture: true,
      })),
    coverage: {
      framePixelCount: pixelCount,
      gradeRelevantPixelCount: pixelCount,
      validPixelCount: pixelCount - invalidIndexes.length,
      totalPixelCount: pixelCount,
      validPixelFraction,
      clippedPixelFraction: options.clippingIndex === undefined ? 0 : 1 / pixelCount,
      commonModeSpecularPixelFraction: invalidIndexes.length / pixelCount,
      calibratedPatternPixelFraction: 0,
      invalidPixelFraction: invalidIndexes.length / pixelCount,
    },
    evidenceLimitations: [{
      code: "localized_ungradable_region",
      affectedPixelFraction: 17 / pixelCount,
      requiresRecapture: true,
      message: "internal",
    }],
  };
}

function admitted(value, masks = {}) {
  return applyFixedRigCommonModeInteriorAdmissionV1({
    evidence: value,
    pixelsPerMmX: 1,
    pixelsPerMmY: 1,
    ...masks,
  });
}

test("authorized 17+5+1+1 common-mode topology is admitted without making pixels grade-valid", () => {
  const result = admitted(evidence());
  assert.equal(result.status, "computed");
  assert.equal(result.admissionAdjustment.region.pixelCount, 17);
  assert.equal(result.admissionAdjustment.totalInvalidPixelCount, 24);
  assert.deepEqual(result.admissionAdjustment.allInvalidComponentPixelCounts, [17, 5, 1, 1]);
  assert.equal(result.ungradableRegions.length, 0);
  assert.equal(result.admissionExcludedCommonModeMask.reduce((a, b) => a + b, 0), 17);
  assert.equal(result.invalidIlluminationMask.reduce((a, b) => a + b, 0), 24);
  assert.equal(result.channels.some((channel) =>
    channel.validDirectionalObservationMask.some(Boolean)), false);
  assert.equal(isExactSealedCommonModeAdmissionV1(result), true);
  assert.equal(isExactSealedCommonModeAdmissionV1({
    ...result,
    admissionAdjustment: {
      ...result.admissionAdjustment,
      allInvalidComponentPixelCounts: [17, 6, 1],
    },
  }), false);
  for (const classification of [
    "invalid_condition_evidence_excluded",
    "common_mode_specular_glare",
    "insufficient_directional_observations",
  ]) {
    assert.equal(
      suppressExactSealedAdmissionPublicLimitationV1(result, classification),
      true,
    );
  }
  assert.equal(suppressExactSealedAdmissionPublicLimitationV1(result, "clipping"), false);
  assert.equal(suppressExactSealedAdmissionPublicLimitationV1(result, "low_confidence"), false);
});

test("admission remains fail-closed at every literal boundary", () => {
  const width = 600;
  const base = componentPixels(width, 250, 220, 17);
  const cases = [
    evidence({ regions: [componentPixels(width, 250, 220, 18)] }),
    evidence({ regions: [base, componentPixels(width, 350, 300, 12)] }),
    evidence({ regions: [base, componentPixels(width, 350, 300, 6), [400 * width + 400], [450 * width + 450]] }),
    evidence({ regions: [componentPixels(width, 0, 220, 17)] }),
    evidence({ underexposureIndex: base[0] }),
    evidence({ clippingIndex: base[0] }),
    evidence({ validPixelFraction: 0.99989 }),
  ];
  for (const value of cases) {
    assert.equal(admitted(value).status, "insufficient_evidence");
    assert.equal(admitted(value).admissionAdjustment, undefined);
  }
});

function plane(width, height, value) {
  return { width, height, data: new Float32Array(width * height).fill(value) };
}

test("tau1 bracket selects the highest eligible nonclipped source and blank evidence stays ineligible", () => {
  const width = 2;
  const height = 2;
  const references = [15000, 30000, 37500].flatMap((exposureUs) =>
    [1, 2, 3].map((ordinal) => ({
      exposureUs,
      plane: plane(width, height, 0),
      sourceEvidenceId: `reference-${exposureUs}-${ordinal}`,
      sourceSha256: SHA,
    })));
  const channels = Array.from({ length: 8 }, (_, index) => ({
    channel: index + 1,
    channelConfidence: 1,
    observations: [15000, 30000, 37500].map((exposureUs) => ({
      exposureUs,
      plane: plane(
        width,
        height,
        index === 7 ? 0 : exposureUs === 37500 ? 255 : exposureUs === 30000 ? 30 : 15,
      ),
      sourceEvidenceId: `channel-${index + 1}-${exposureUs}`,
      sourceSha256: crypto.createHash("sha256")
        .update(`channel-${index + 1}-${exposureUs}`)
        .digest("hex"),
    })),
  }));
  const result = buildFixedRigExposureBracketFusionV1({
    width,
    height,
    sensorMaximumValue: 255,
    gradeRelevantMask: plane(width, height, 1),
    references,
    channels,
    flatFieldChannels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      relativeResponse: plane(width, height, 1),
      sourceEvidenceId: `flat-${index + 1}`,
      sourceSha256: SHA,
    })),
  });
  assert.deepEqual(
    Array.from(result.channels[0].fusedObservation.selectedExposureUs),
    [30000, 30000, 30000, 30000],
  );
  assert.equal(result.channels[0].sourceEvidenceId, "channel-1-37500");
  assert.equal(
    result.channels[0].sourceSha256,
    crypto.createHash("sha256").update("channel-1-37500").digest("hex"),
  );
  assert.deepEqual(
    result.channels[0].fusedObservation.sourceEvidenceIds,
    ["channel-1-15000", "channel-1-30000", "channel-1-37500"],
  );
  assert.deepEqual(
    result.channels[0].fusedObservation.sourceSha256s,
    [15000, 30000, 37500].map((exposureUs) =>
      crypto.createHash("sha256").update(`channel-1-${exposureUs}`).digest("hex")),
  );
  assert.ok(Math.abs(result.channels[0].fusedObservation.correctedResponse[0] - 45 / 255) < 1e-6);
  assert.deepEqual(Array.from(result.channels[7].fusedObservation.eligibleMask), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(result.adaptiveRawGuardFailureMask), [0, 0, 0, 0]);
  assert.equal(result.selectedFusedClippingMask.some(Boolean), false);

  const blank = buildFixedRigExposureBracketFusionV1({
    width,
    height,
    sensorMaximumValue: 255,
    gradeRelevantMask: plane(width, height, 1),
    references,
    channels: channels.map((channel) => ({
      ...channel,
      observations: channel.observations.map((observation) => ({
        ...observation,
        plane: plane(width, height, 0),
      })),
    })),
    flatFieldChannels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      relativeResponse: plane(width, height, 1),
      sourceEvidenceId: `flat-${index + 1}`,
      sourceSha256: SHA,
    })),
  });
  assert.deepEqual(Array.from(blank.adaptiveRawGuardFailureMask), [1, 1, 1, 1]);
  assert.throws(
    () => buildFixedRigExposureBracketFusionV1({
      width,
      height,
      sensorMaximumValue: 255,
      gradeRelevantMask: plane(width, height, 1),
      references,
      channels: channels.slice(0, 7),
      flatFieldChannels: Array.from({ length: 8 }, (_, index) => ({
        channel: index + 1,
        relativeResponse: plane(width, height, 1),
        sourceEvidenceId: `flat-${index + 1}`,
        sourceSha256: SHA,
      })),
    }),
    /channels 1 through 8/,
  );

  const nonDirectional = buildFixedRigPhotometricEvidenceV1({
    channels: result.channels.map((channel) => ({ ...channel, channelConfidence: 0 })),
    calibration: {
      calibrationProfileId: "calibration",
      calibrationVersion: "v1",
      calibrationSha256: SHA,
      coordinateFrame: "normalized_card_portrait_pixels",
      width,
      height,
      sensorMaximumValue: 255,
      isFinalized: true,
      isCalibrated: true,
      flatFieldChannels: Array.from({ length: 8 }, (_, index) => ({
        channel: index + 1,
        relativeResponse: plane(width, height, 1),
        sourceEvidenceId: `flat-${index + 1}`,
        sourceSha256: SHA,
      })),
      sourceEvidenceIds: [],
    },
    darkControl: plane(width, height, 0),
    gradeRelevantMask: plane(width, height, 1),
    gradeRelevantMaskSourceEvidenceId: "expected-card-mask",
    gradeRelevantMaskSourceSha256: SHA,
  });
  assert.equal(nonDirectional.status, "insufficient_evidence");
  assert.deepEqual(Array.from(nonDirectional.lowConfidenceMask), [1, 1, 1, 1]);
});

function transformFor(sourceSha256, matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]) {
  const payload = {
    schemaVersion: "ten-kings-raw-to-normalized-card-transform-v1",
    sourceSha256,
    sourceCoordinateFrame: "auto_oriented_raw_image_pixels",
    sourceWidthPx: 2448,
    sourceHeightPx: 2048,
    autoOrientApplied: true,
    deskewClockwiseDegrees: 90,
    rotatedWidthPx: 2048,
    rotatedHeightPx: 2448,
    crop: { leftPx: 100, topPx: 100, widthPx: 1200, heightPx: 1680 },
    outputCoordinateFrame: "normalized_card_portrait_pixels",
    outputWidthPx: 1200,
    outputHeightPx: 1680,
    matrix,
  };
  return {
    ...payload,
    transformSha256: crypto.createHash("sha256")
      .update(JSON.stringify(payload), "utf8")
      .digest("hex"),
  };
}

test("bracket registration must reuse the one transform and remain bound to its raw TIFF", () => {
  const authority = transformFor("a".repeat(64));
  const roleSha256 = "b".repeat(64);
  const roleTransform = transformFor(roleSha256);
  const valid = {
    artifact: {
      sourceSha256: roleSha256,
      rawToNormalizedTransform: roleTransform,
    },
    rawCapture: { sha256: roleSha256 },
    authority,
    label: "bracket role",
  };
  assert.doesNotThrow(() => assertFixedRigReusedAuthoritativeTransformV1(valid));
  assert.throws(
    () => assertFixedRigReusedAuthoritativeTransformV1({
      ...valid,
      artifact: {
        ...valid.artifact,
        rawToNormalizedTransform: transformFor(roleSha256, [1, 0, 1, 0, 1, 0, 0, 0, 1]),
      },
    }),
    /did not reuse/,
  );
  assert.throws(
    () => assertFixedRigReusedAuthoritativeTransformV1({
      ...valid,
      rawCapture: { sha256: "c".repeat(64) },
    }),
    /hash-bound/,
  );
});

test("station adapter accepts literal real unit-one Leimac frames and command ACKs only", () => {
  const w11 = "W1101010024020000030000040000050000060000070000080000";
  const w86 = "W8601010001020000030000040000050000060000070000080000";
  const write = (requestFrame, commandNumber) => ({
    ok: true,
    responseKind: "ack",
    attempt: 1,
    automaticRetryCount: 0,
    expectedAck: `W${commandNumber}ACK0`,
    rawResponse: `W${commandNumber}ACK0`,
    normalizedResponse: `W${commandNumber}ACK0`,
    exactAck: true,
    frame: {
      commandNumber,
      targetDesignation: "01",
      requestAscii: requestFrame,
      requestFrame,
    },
  });
  assert.doesNotThrow(() => assertFixedRigExactLeimacWritesV1(
    [write(w11, "11"), write(w86, "86")],
    [w11, w86],
    "literal bridge writes",
  ));
  assert.throws(
    () => assertFixedRigExactLeimacWritesV1(
      [{ ...write(w11, "11"), rawResponse: "ACK", normalizedResponse: "ACK" }],
      [w11],
      "generic ACK",
    ),
    /exact unit-one request frames/,
  );
  assert.throws(
    () => assertFixedRigExactLeimacWritesV1(
      [write("W1100240000000000000000000000000000", "11")],
      [w11],
      "abbreviated frame",
    ),
    /exact unit-one request frames/,
  );
});

function provenanceCells() {
  let ordinal = 0;
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const role = (exposureUs, roleName) => {
    ordinal += 1;
    const started = ordinal * 10;
    return {
      role: roleName,
      monotonicStartedTicks: started,
      monotonicFinishedTicks: started + 5,
      capture: {
        exposureTime: exposureUs,
        outputFilePath: `C:/sealed/raw-${ordinal}.tiff`,
        sha256: hash(`raw-${ordinal}`),
        timestamp: `capture-${ordinal}`,
        camera: { serialNumber: "camera-serial-1" },
      },
      normalized: {
        analysisArtifact: {
          localOutputPath: `C:/sealed/normalized-${ordinal}.png`,
          sha256: hash(`normalized-${ordinal}`),
        },
      },
    };
  };
  return [15000, 30000, 37500].map((exposureUs) => ({
    exposureUs,
    cameraReadback: { cameraSerialNumber: "camera-serial-1" },
    references: [1, 2, 3].map((referenceOrdinal) => ({
      ...role(exposureUs, `bracket_${exposureUs}_reference_${referenceOrdinal}`),
      referenceOrdinal,
    })),
    channels: Array.from({ length: 8 }, (_, index) => ({
      ...role(exposureUs, `bracket_${exposureUs}_channel_${index + 1}`),
      channel: index + 1,
    })),
  }));
}

test("bracket provenance requires 33 unique ordered same-camera capture sources", () => {
  const valid = provenanceCells();
  assert.doesNotThrow(() =>
    assertFixedRigPhotometricBracketCaptureProvenanceV1(valid, "front"));

  const duplicate = structuredClone(valid);
  duplicate[0].references[1].capture.outputFilePath =
    duplicate[0].references[0].capture.outputFilePath;
  assert.throws(
    () => assertFixedRigPhotometricBracketCaptureProvenanceV1(duplicate, "front"),
    /aliases another bracket capture source/,
  );

  const mismatchedCamera = structuredClone(valid);
  mismatchedCamera[1].channels[2].capture.camera.serialNumber = "camera-serial-2";
  assert.throws(
    () => assertFixedRigPhotometricBracketCaptureProvenanceV1(mismatchedCamera, "front"),
    /camera serial differs/,
  );

  const reordered = structuredClone(valid);
  reordered[0].references[1].monotonicStartedTicks =
    reordered[0].references[0].monotonicFinishedTicks;
  assert.throws(
    () => assertFixedRigPhotometricBracketCaptureProvenanceV1(reordered, "front"),
    /strictly monotonic/,
  );

  const nonpositive = structuredClone(valid);
  nonpositive[0].references[0].monotonicStartedTicks = 0;
  assert.throws(
    () => assertFixedRigPhotometricBracketCaptureProvenanceV1(nonpositive, "front"),
    /strictly monotonic/,
  );
});

test("station adapter rehashes every one of the 33 raw role TIFFs", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-bracket-raw-rehash-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cells = provenanceCells();
  const roles = cells.flatMap((cell) => [...cell.references, ...cell.channels]);
  roles.forEach((role, index) => {
    const bytes = Buffer.from(`immutable raw TIFF role ${index + 1}`, "utf8");
    const filePath = path.join(root, `role-${index + 1}.tiff`);
    fs.writeFileSync(filePath, bytes);
    role.capture.outputFilePath = filePath;
    role.capture.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  });
  const verified = await rehashFixedRigPhotometricBracketRawCapturesV1({
    cells,
    packageDir: root,
    side: "front",
  });
  assert.equal(verified.length, 33);
  assert.equal(new Set(verified.map((file) => file.filePath)).size, 33);

  fs.appendFileSync(roles[17].capture.outputFilePath, "tampered");
  await assert.rejects(
    rehashFixedRigPhotometricBracketRawCapturesV1({
      cells,
      packageDir: root,
      side: "front",
    }),
    /file SHA-256 mismatch/,
  );
});

test("sealed ambient-blocked replay summary satisfies the literal admission predicate", (t) => {
  const reportPath = path.resolve(
    "C:/Users/Mark/Documents/Codex/2026-07-24/you-are-agent-a-empirical-replay/outputs/agent-a-ambient-blocked-tau1-replay-20260724.json",
  );
  if (!fs.existsSync(reportPath)) {
    t.skip("sealed offline replay is not mounted");
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.provenance.manifestSha256,
    "bcb0b555996d62c02f9c413490e50626afb8a18483eb0258c5e2f757afca1b9d");
  assert.equal(report.admission.coverage, 0.9999880768328888);
  assert.equal(report.admission.selectedFusedClippingFraction, 0);
  assert.equal(report.admission.invalidPixels, 24);
  assert.equal(report.admission.qualifyingRegionCount, 1);
  assert.equal(report.admission.largestQualifyingRegionPixels, 17);
  assert.deepEqual(report.admission.causePixels, {
    adaptiveGuardFewerThan3: 0,
    normalizedFloorFewerThan3: 0,
    commonMode: 24,
    calibratedPattern: 0,
  });
});

function loadFloat32(filePath, expectedLength) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.byteLength, expectedLength * 4, `${filePath} has the expected Float32 size`);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const data = new Float32Array(copy);
  assert.equal(data.every(Number.isFinite), true, `${filePath} contains only finite values`);
  return data;
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("production fusion and admission reproduce the sealed ambient-blocked TIFF replay", {
  skip: process.env.TENKINGS_RUN_SEALED_AMBIENT_BLOCKED_REPLAY !== "1"
    ? "set TENKINGS_RUN_SEALED_AMBIENT_BLOCKED_REPLAY=1 for the mounted immutable replay"
    : false,
}, () => {
  const width = 1200;
  const height = 1680;
  const pixelCount = width * height;
  const authPath = path.resolve(
    "C:/Users/Mark/AppData/Local/Temp/codex-agent-a-ambient-blocked-20260724/authentication-and-normalization.json",
  );
  const reportPath = path.resolve(
    "C:/Users/Mark/Documents/Codex/2026-07-24/you-are-agent-a-empirical-replay/outputs/agent-a-ambient-blocked-tau1-replay-20260724.json",
  );
  const maskPath = path.resolve(
    "C:/Users/Mark/Documents/Codex/2026-07-24/you-are-agent-a-empirical-replay/work/exposure-screening-expected-card-mask-1200x1680.raw",
  );
  const calibrationRoot = path.resolve(
    "C:/Users/Mark/Documents/Codex/2026-07-24/you-are-agent-b-photometric-contract/work/hdr-lower-normalized-f32",
  );
  for (const required of [authPath, reportPath, maskPath, calibrationRoot]) {
    assert.equal(fs.existsSync(required), true, `sealed replay input is mounted: ${required}`);
  }
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  const oracle = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(auth.manifestSha256,
    "bcb0b555996d62c02f9c413490e50626afb8a18483eb0258c5e2f757afca1b9d");
  assert.equal(fileSha256(maskPath),
    "11ffe663141d33aaf30488fec41956532cd4d01d483f1b5c3805c483a790297a");
  const records = auth.normalized;
  const recordFor = (exposureUs, role, discriminator) => {
    const record = records.find((entry) =>
      entry.exposureUs === exposureUs &&
      entry.role === role &&
      discriminator(entry));
    assert.ok(record, `sealed ${role} ${exposureUs} record exists`);
    assert.equal(fileSha256(record.normalizedPath), record.normalizedSha256);
    return record;
  };
  const expectedMask = {
    width,
    height,
    data: loadFloat32(maskPath, pixelCount),
  };
  const references = [15000, 30000, 37500].flatMap((exposureUs) =>
    [1, 2, 3].map((referenceOrdinal) => {
      const record = recordFor(
        exposureUs,
        "fresh_ambient_blocked_leimac_off_reference",
        (entry) => entry.referenceOrdinal === referenceOrdinal,
      );
      return {
        exposureUs,
        plane: { width, height, data: loadFloat32(record.normalizedPath, pixelCount) },
        sourceEvidenceId: `sealed-reference-${exposureUs}-${referenceOrdinal}`,
        sourceSha256: record.normalizedSha256,
      };
    }));
  const channels = Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    return {
      channel,
      channelConfidence: 1,
      observations: [15000, 30000, 37500].map((exposureUs) => {
        const record = recordFor(
          exposureUs,
          "isolated_channel",
          (entry) => entry.channel === channel,
        );
        return {
          exposureUs,
          plane: { width, height, data: loadFloat32(record.normalizedPath, pixelCount) },
          sourceEvidenceId: `sealed-channel-${channel}-${exposureUs}`,
          sourceSha256: record.normalizedSha256,
        };
      }),
    };
  });
  const flatFieldChannels = Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    const filePath = path.join(calibrationRoot, `flat-ch${channel}.f32`);
    return {
      channel,
      relativeResponse: { width, height, data: loadFloat32(filePath, pixelCount) },
      sourceEvidenceId: `sealed-flat-${channel}`,
      sourceSha256: fileSha256(filePath),
    };
  });
  const illuminationPatternChannels = Array.from({ length: 8 }, (_, index) => {
    const channel = index + 1;
    const filePath = path.join(calibrationRoot, `pattern-ch${channel}.f32`);
    return {
      channel,
      expectedDirectionalResidual: {
        width,
        height,
        data: loadFloat32(filePath, pixelCount),
      },
      sourceEvidenceId: `sealed-pattern-${channel}`,
      sourceSha256: fileSha256(filePath),
    };
  });
  const fusion = buildFixedRigExposureBracketFusionV1({
    width,
    height,
    sensorMaximumValue: 255,
    gradeRelevantMask: expectedMask,
    references,
    channels,
    flatFieldChannels,
  });
  const computed = buildFixedRigPhotometricEvidenceV1({
    channels: fusion.channels,
    calibration: {
      calibrationProfileId: "sealed-production-calibration",
      calibrationVersion: "sealed",
      calibrationSha256: SHA,
      coordinateFrame: "normalized_card_portrait_pixels",
      width,
      height,
      sensorMaximumValue: 255,
      isFinalized: true,
      isCalibrated: true,
      flatFieldChannels,
      illuminationPatternChannels,
      sourceEvidenceIds: [],
    },
    darkControl: { width, height, data: new Float32Array(pixelCount) },
    gradeRelevantMask: expectedMask,
    gradeRelevantMaskSourceEvidenceId: "sealed-expected-card-mask",
    gradeRelevantMaskSourceSha256: fileSha256(maskPath),
  });
  assert.equal(computed.status, "insufficient_evidence");
  assert.equal(computed.coverage.validPixelFraction, 0.999988);
  assert.equal(computed.coverage.invalidPixelFraction, 0.000012);
  assert.equal(computed.invalidIlluminationMask.reduce((sum, value) => sum + value, 0), 24);
  assert.deepEqual(computed.ungradableRegions.map((region) => region.pixelCount), [17]);
  const admittedResult = applyFixedRigCommonModeInteriorAdmissionV1({
    evidence: computed,
    pixelsPerMmX: width / 63.5,
    pixelsPerMmY: height / 88.9,
    adaptiveRawGuardFailureMask: fusion.adaptiveRawGuardFailureMask,
    normalizedFloorFailureMask: fusion.normalizedFloorFailureMask,
    selectedFusedClippingMask: fusion.selectedFusedClippingMask,
  });
  assert.equal(admittedResult.status, "computed");
  assert.equal(admittedResult.admissionAdjustment.region.pixelCount,
    oracle.admission.largestQualifyingRegionPixels);
  assert.equal(admittedResult.admissionAdjustment.totalInvalidPixelCount,
    oracle.admission.invalidPixels);
  assert.equal(admittedResult.admissionAdjustment.selectedFusedClippingPixelCount, 0);
  assert.equal(admittedResult.invalidIlluminationMask.reduce((sum, value) => sum + value, 0), 24);
});
