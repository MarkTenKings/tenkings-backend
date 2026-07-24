const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyFixedRigCommonModeInteriorAdmissionV1,
} = require("../dist/drivers/fixedRigPhotometricAdmissionV1");
const {
  buildFixedRigExposureBracketFusionV1,
} = require("../dist/drivers/fixedRigExposureBracketFusionV1");
const {
  buildFixedRigPhotometricEvidenceV1,
} = require("../dist/drivers/fixedRigPhotometricEvidenceV1");
const {
  assertFixedRigReusedAuthoritativeTransformV1,
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
  assert.equal(result.ungradableRegions.length, 0);
  assert.equal(result.admissionExcludedCommonModeMask.reduce((a, b) => a + b, 0), 17);
  assert.equal(result.invalidIlluminationMask.reduce((a, b) => a + b, 0), 24);
  assert.equal(result.channels.some((channel) =>
    channel.validDirectionalObservationMask.some(Boolean)), false);
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
      sourceSha256: SHA,
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
