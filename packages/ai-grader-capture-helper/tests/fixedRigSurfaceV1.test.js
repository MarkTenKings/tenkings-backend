const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} = require("../../shared/dist");

const {
  buildFixedRigPhotometricEvidenceV1,
} = require("../dist/drivers/fixedRigPhotometricEvidenceV1");
const {
  buildFixedRigSurfaceV1,
} = require("../dist/drivers/fixedRigSurfaceV1");

const SHA = "a".repeat(64);
const ALGORITHM_VERSION = "surface-algorithm-v1.0.0";

function plane(width, height, valueOrFactory = 0) {
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    data[index] = typeof valueOrFactory === "function"
      ? valueOrFactory(x, y, index)
      : valueOrFactory;
  }
  return { width, height, data };
}

function mask(width, height, predicate) {
  return plane(width, height, (x, y, index) => predicate(x, y, index) ? 1 : 0);
}

function unionMasks(width, height, masks) {
  return plane(width, height, (_x, _y, index) =>
    masks.some((entry) => Number(entry.data[index]) > 0) ? 1 : 0,
  );
}

function baseCalibration(width, height, options = {}) {
  return {
    calibrationProfileId: "surface-calibration-v1",
    calibrationVersion: "calibration-v1.0.0",
    calibrationSha256: SHA,
    coordinateFrame: "normalized_card_portrait_pixels",
    width,
    height,
    sensorMaximumValue: 255,
    isFinalized: true,
    isCalibrated: true,
    flatFieldChannels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      relativeResponse: options.flatFields?.[index] ?? plane(width, height, 1),
      sourceEvidenceId: `flat-field-${index + 1}`,
      sourceSha256: SHA,
    })),
    illuminationPatternChannels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      expectedDirectionalResidual: options.patterns?.[index] ?? plane(width, height, 0),
      sourceEvidenceId: `illumination-pattern-${index + 1}`,
      sourceSha256: SHA,
    })),
    sourceEvidenceIds: ["flat-field-set", "illumination-pattern-set"],
  };
}

function buildPhotometric({ width, height, responses, calibration, flatFields, patterns }) {
  const profile = calibration ?? baseCalibration(width, height, { flatFields, patterns });
  return buildFixedRigPhotometricEvidenceV1({
    calibration: profile,
    darkControl: plane(width, height, 0),
    gradeRelevantMask: plane(width, height, 1),
    gradeRelevantMaskSourceEvidenceId: "expected-outer-card-mask",
    gradeRelevantMaskSourceSha256: SHA,
    channels: Array.from({ length: 8 }, (_, index) => ({
      channel: index + 1,
      image: plane(width, height, (x, y, pixel) => {
        const normalized = responses(index + 1, x, y, pixel);
        return normalized * profile.sensorMaximumValue;
      }),
      channelConfidence: 1,
      sourceEvidenceId: `channel-${index + 1}`,
      sourceSha256: SHA,
    })),
  });
}

function measurementCalibration(width, height) {
  const profile = {
    schemaVersion: "ai-grader-mathematical-calibration-profile-v1",
    profileId: "surface-calibration-v1",
    calibrationVersion: "calibration-v1.0.0",
    rigId: "surface-test-rig-v1",
    isCalibrated: true,
    status: "finalized",
    coordinateFrame: "normalized_card_portrait_pixels",
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    artifactId: "surface-calibration-artifact-v1",
    artifactSha256: SHA,
    finalizedAt: "2026-07-18T12:00:00.000Z",
    normalizedWidthPx: width,
    normalizedHeightPx: height,
    mmPerPixelX: 0.1,
    mmPerPixelY: 0.1,
    scaleRelativeU95: 0.001,
    scaleSampleCount: 10,
    lensCalibrationViewCount: 10,
    lensResidualPx: 0.1,
    normalizationRegistrationResidualPx: 0.2,
    normalizationRegistrationSampleCount: 10,
    repeatedPlacementCount: 10,
    repeatedPlacementU95Mm: 0.01,
    segmentationBoundaryU95Px: 0.2,
    segmentationBoundarySampleCount: 10,
    measurementRepeatability: {
      linearMm: { sampleCount: 10, u95: 0.01 },
      areaMm2: { sampleCount: 10, u95: 0.02 },
      reliefIndex: { sampleCount: 10, u95: 0.01 },
      roughnessIndex: { sampleCount: 10, u95: 0.01 },
      colorDeltaE: { sampleCount: 10, u95: 0.1 },
    },
    channels: Array.from({ length: 8 }, (_, index) => ({
      channelIndex: index + 1,
      direction: { x: Math.cos(index * Math.PI / 4), y: Math.sin(index * Math.PI / 4) },
      directionConfidence: 1,
      directionMeasurementSampleCount: 3,
      directionAngularU95Degrees: 0,
      directionSourceRadiusMm: 100,
      directionPointU95Mm: 0.1,
      flatFieldArtifactId: `flat-${index + 1}`,
      flatFieldArtifactSha256: SHA,
      flatFieldFrameCount: 3,
      darkControlFrameCount: 3,
      maxFlatFieldDeviationFraction: 0,
      illuminationPatternArtifactId: "pattern-v1",
      illuminationPatternArtifactSha256: SHA,
      illuminationPatternFrameCount: 3,
      responseScale: 1,
    })),
  };
  return {
    profile,
    calibrationProfileId: "surface-calibration-v1",
    calibrationVersion: "calibration-v1.0.0",
    calibrationSha256: SHA,
    pixelsPerMmX: 10,
    pixelsPerMmY: 10,
  };
}

function sourceEvidence(side, id) {
  return [{
    assetId: `segmentation-${id}`,
    sha256: SHA,
    side,
    role: "segmentation_mask",
    regionId: `source-region-${id}`,
  }];
}

function seed({ side, id, category, candidateMask, channelSupport }) {
  return {
    seedId: `seed-${id}`,
    category,
    detectorId: `${category}-detector-v1`,
    detectorVersion: "detector-v1.0.0",
    evidenceKind: category === "stain" || category === "print_defect"
      ? "color_delta"
      : category === "foreign_material"
        ? "polarized_residue"
        : "directional_residual",
    candidateMask,
    ...(channelSupport ? { channelSupport } : {}),
    sourceEvidence: sourceEvidence(side, id),
  };
}

function scratchResponses(candidateMask, glareMask) {
  const residual = [0.2, 0.15, 0.1, 0.05, -0.05, -0.1, -0.15, -0.2];
  return (channel, _x, _y, pixel) => {
    if (glareMask && Number(glareMask.data[pixel]) > 0) {
      if (channel <= 5) return 0.99;
      return channel === 6 ? 0.55 : channel === 7 ? 0.35 : 0.15;
    }
    return 0.35 + (Number(candidateMask.data[pixel]) > 0 ? residual[channel - 1] : 0);
  };
}

function buildSurface(side, photometricEvidence, candidateSeeds, extra = {}) {
  return buildFixedRigSurfaceV1({
    side,
    photometricEvidence,
    calibration: measurementCalibration(photometricEvidence.width, photometricEvidence.height),
    algorithmVersion: ALGORITHM_VERSION,
    candidateSeeds,
    ...extra,
  });
}

test("per-channel flat-field correction removes certified spatial response and common-mode glare is quality evidence only", () => {
  const width = 16;
  const height = 8;
  const glare = mask(width, height, (x, y) => x >= 7 && x <= 8 && y >= 3 && y <= 4);
  const flatFields = Array.from({ length: 8 }, () =>
    plane(width, height, (x) => x < width / 2 ? 0.75 : 1.2),
  );
  const calibration = baseCalibration(width, height, { flatFields });
  const photometric = buildPhotometric({
    width,
    height,
    calibration,
    responses: (_channel, x, _y, pixel) => {
      const flat = x < width / 2 ? 0.75 : 1.2;
      if (Number(glare.data[pixel]) > 0) return 0.8 * flat;
      return 0.4 * flat;
    },
  });

  const cleanLeft = 0;
  const cleanRight = width - 1;
  assert.ok(Math.abs(photometric.channels[0].correctedResponse[cleanLeft] - 0.4) < 0.00001);
  assert.ok(Math.abs(photometric.channels[0].correctedResponse[cleanRight] - 0.4) < 0.00001);
  const glarePixel = 3 * width + 7;
  assert.equal(photometric.commonModeSpecularMask[glarePixel], 1);
  assert.equal(photometric.invalidIlluminationMask[glarePixel], 1);
  assert.equal(photometric.coverage.commonModeSpecularPixelFraction, 4 / (width * height));
  assert.equal(photometric.status, "computed");
});

const HISTORICAL_LEDGER_PATH = join(
  __dirname,
  "fixtures",
  "historical-surface-5-50-derived-ledger-v1.json",
);
const HISTORICAL_LEDGER_SHA256 =
  "01514c3409a8ef4aa4b6257f15f5498dbc8c33f8939f78510bcc7f3fb154086c";

function historicalDerivedLedger() {
  const bytes = readFileSync(HISTORICAL_LEDGER_PATH);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), HISTORICAL_LEDGER_SHA256);
  const text = bytes.toString("utf8");
  assert.doesNotMatch(text, /[A-Za-z]:\\|(?:file|https?):\/\//i);
  return JSON.parse(text);
}

function historicalPatternFixture(ledger, side) {
  const width = 24;
  const height = 40;
  const entries = ledger.candidates.filter((candidate) => candidate.side === side);
  const projected = entries.map((candidate) => ({
    candidate,
    cellX: 2 + (candidate.rect[0] - 349) / 112,
    cellY: 2 + (candidate.rect[1] - 870) / 117,
    dominantChannel: candidate.sourceChannels[0],
    // The exact V0 severity is retained as a deterministic calibrated-pattern
    // response scale; it is not treated as a physical-defect measurement.
    amplitude: candidate.severity / 300,
  }));
  assert.ok(projected.every(({ cellX, cellY }) =>
    Number.isInteger(cellX) && Number.isInteger(cellY)));
  const candidateMasks = projected.map(({ cellX, cellY }) =>
    mask(width, height, (x, y) =>
      x >= cellX * 4 && x < cellX * 4 + 4 && y >= cellY * 4 && y < cellY * 4 + 4,
    ),
  );
  const dominantByPixel = new Uint8Array(width * height);
  const amplitudeByPixel = new Float32Array(width * height);
  projected.forEach(({ dominantChannel, amplitude }, index) => {
    candidateMasks[index].data.forEach((value, pixel) => {
      if (!value) return;
      dominantByPixel[pixel] = dominantChannel;
      amplitudeByPixel[pixel] = amplitude;
    });
  });
  const patterns = Array.from({ length: 8 }, (_, channelIndex) =>
    plane(width, height, (_x, _y, pixel) =>
      dominantByPixel[pixel] === channelIndex + 1 ? amplitudeByPixel[pixel] : 0,
    ),
  );
  const photometric = buildPhotometric({
    width,
    height,
    patterns,
    responses: (channel, _x, _y, pixel) =>
      0.35 + (dominantByPixel[pixel] === channel ? amplitudeByPixel[pixel] : 0),
  });
  const seeds = candidateMasks.map((candidateMask, index) =>
    seed({ side, id: entries[index].id, category: "scratch", candidateMask }),
  );
  return { photometric, seeds, entries };
}

test("checksum-bound exact historical derived ledger replays Surface V0 5.50 to V1 illumination suppression", () => {
  const ledger = historicalDerivedLedger();
  assert.equal(ledger.schemaVersion, "ten-kings-redacted-surface-replay-ledger-v1");
  assert.deepEqual(ledger.sourceDigests, {
    reportManifestSha256: "35f0b5553a8e897fe6d3055dec9683a78380770e5b4b9ec0bdceab9b8381b97a",
    reportAnalysisSha256: "98b9ccb4848c4963d687b76fc30a33ebd03e87ed0193108713682b9f729cf3bf",
    frontPackageManifestSha256: "cd5eb8f82b0a574283b192108d06b6fd0d9267f9310349e8a6256c40ba04ca62",
    backPackageManifestSha256: "cfe85b314e83879492948ae8930b821014f9d1d7ca201529bb119263da8c4242",
  });
  assert.equal(ledger.candidates.length, 16);
  assert.ok(ledger.candidates.every((candidate) =>
    candidate.rect[2] * candidate.rect[3] === ledger.roi.pixelCount &&
    candidate.severity >= ledger.v0Policy.highSeverityThreshold &&
    candidate.v0Deduction === ledger.v0Policy.highSeverityDeduction &&
    Math.abs(candidate.glareOverlapPixels / ledger.roi.pixelCount - candidate.glareOverlapFraction) < 0.000001 &&
    Math.abs(candidate.underexposureOverlapPixels / ledger.roi.pixelCount - candidate.underexposureOverlapFraction) < 0.000001));
  const nominalPenalty = ledger.candidates.reduce((sum, candidate) => sum + candidate.v0Deduction, 0);
  assert.equal(Math.round(nominalPenalty * 100) / 100, 22.4);
  const historicalV0Surface = ledger.v0Policy.startingScore - Math.min(
    ledger.v0Policy.surfacePenaltyCap,
    nominalPenalty,
  );
  assert.equal(historicalV0Surface, ledger.v0Policy.storedScore);
  assert.equal(historicalV0Surface, 5.5);
  assert.deepEqual(ledger.sidePercentiles.front, { p50: 15.6379, p95: 230.2368, p99: 346.9159 });
  assert.deepEqual(ledger.sidePercentiles.back, { p50: 19.8582, p95: 75.6757, p99: 218.5366 });
  assert.equal(ledger.classification.independentlyProvenPhysicalDefects, 0);
  assert.equal(ledger.classification.candidatePixelsWithFourOrMoreChannelsAboveCardP90, 0);

  const front = historicalPatternFixture(ledger, "front");
  const back = historicalPatternFixture(ledger, "back");
  const frontResult = buildSurface("front", front.photometric, front.seeds);
  const backResult = buildSurface("back", back.photometric, back.seeds);

  for (const result of [frontResult, backResult]) {
    assert.equal(result.status, "computed");
    assert.equal(result.calibrationSha256, SHA);
    assert.equal(result.sourceEvidence.length, 8);
    assert.deepEqual(
      result.sourceEvidence.map((entry) => entry.channelIndex),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.ok(result.sourceEvidence.every((entry) =>
      entry.side === result.side &&
      entry.role === "directional_channel" &&
      entry.sha256 === SHA,
    ));
    assert.equal(result.score, 10);
    assert.equal(result.findings.length, 0);
    assert.ok(result.suppressedCandidates.length >= 1);
    assert.equal(new Set(
      result.suppressedCandidates.flatMap((candidate) => candidate.sourceSeedIds),
    ).size, 8);
    assert.deepEqual(
      [...new Set(result.suppressedCandidates.flatMap((candidate) => candidate.sourceSeedIds))].sort(),
      // Surface seeds use their versioned `seed-` namespace while retaining
      // the exact historical ledger identity as the remainder of the id.
      (result.side === "front" ? front.entries : back.entries).map((entry) => `seed-${entry.id}`).sort(),
    );
    assert.ok(result.suppressedCandidates.every((candidate) =>
      candidate.reason === "calibrated_illumination_pattern" && candidate.cardDefectDeduction === 0,
    ));
    assert.equal(result.heatmap.usedAsIndependentGradingEvidence, false);
  }
});

test("a calibrated synthetic scratch produces exact measurements, U95, and a deduction", () => {
  const width = 48;
  const height = 32;
  const scratch = mask(width, height, (x, y) => y === 15 && x >= 8 && x < 32);
  const photometric = buildPhotometric({
    width,
    height,
    responses: scratchResponses(scratch),
  });
  const result = buildSurface("front", photometric, [
    seed({ side: "front", id: "real-scratch", category: "scratch", candidateMask: scratch }),
  ]);

  assert.equal(result.status, "computed");
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.category, "scratch");
  assert.ok(finding.corroboratingChannels.length >= 2);
  assert.equal(finding.pixelMeasurements.areaPx2, 24);
  assert.equal(finding.pixelMeasurements.lengthPx, 24);
  assert.equal(finding.pixelMeasurements.widthPx, 1);
  assert.ok(finding.measurements.some((measurement) => measurement.kind === "length_mm"));
  assert.ok(finding.measurements.some((measurement) => measurement.kind === "width_mm"));
  assert.ok(finding.measurements.some((measurement) => measurement.kind === "area_mm2"));
  const basis = finding.measurements.find((measurement) =>
    measurement.measurementId === finding.deductionBasisMeasurementId,
  );
  assert.equal(basis.kind, "length_mm");
  assert.equal(basis.measuredMeasurement, 2.4);
  assert.deepEqual(basis.uncertaintyComponentsU95, {
    pixelMmScale: 0.0024,
    lensDistortion: 0.01,
    normalizationRegistration: 0.02,
    repeatedPlacement: 0.01,
    segmentationBoundary: 0.02,
    measurementRepeatability: 0.01,
    lightingChannelConfidence: 0,
  });
  assert.equal(basis.u95, 0.033253);
  assert.equal(basis.effectiveMeasurement, 2.366747);
  assert.equal(finding.measurements.find((measurement) => measurement.kind === "width_mm").measuredMeasurement, 0.1);
  assert.equal(finding.measurements.find((measurement) => measurement.kind === "area_mm2").measuredMeasurement, 0.24);
  assert.equal(finding.deduction, 0.47);
  assert.equal(result.score, 9.53);
});

test("a scratch crossing partially clipped glare is recovered from three valid alternate channels", () => {
  const width = 48;
  const height = 32;
  const scratch = mask(width, height, (x, y) => y === 15 && x >= 8 && x < 32);
  const glare = mask(width, height, (x, y) => y === 15 && x >= 18 && x < 22);
  const photometric = buildPhotometric({
    width,
    height,
    responses: scratchResponses(scratch, glare),
  });
  const result = buildSurface("front", photometric, [
    seed({ side: "front", id: "scratch-crossing-glare", category: "scratch", candidateMask: scratch }),
  ]);

  assert.equal(result.status, "computed");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].alternateChannelRecoveryUsed, true);
  assert.equal(result.findings[0].validEvidenceCoverage, 1);
  assert.ok(result.findings[0].glareOrIlluminationOverlapFraction > 0);
  assert.ok(result.findings[0].deduction > 0);
});

test("fully obscured evidence is explicit insufficient evidence and never a false 10", () => {
  const width = 24;
  const height = 24;
  const photometric = buildPhotometric({
    width,
    height,
    responses: () => 0.99,
  });
  const result = buildSurface("back", photometric, []);

  assert.equal(photometric.status, "insufficient_evidence");
  assert.equal(photometric.coverage.validPixelFraction, 0);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.score, null);
  assert.ok(result.evidenceQualityLimitations.some((limitation) =>
    limitation.code === "surface_fully_obscured" && limitation.requiresRecapture,
  ));
});

test("a localized fully obscured region with high global coverage is never a false 10", () => {
  const width = 48;
  const height = 32;
  const photometric = buildPhotometric({
    width,
    height,
    responses: (_channel, x, y) =>
      x >= 20 && x < 24 && y >= 12 && y < 16 ? 0.99 : 0.4,
  });
  const result = buildSurface("front", photometric, []);

  assert.ok(photometric.coverage.validPixelFraction > 0.98);
  assert.equal(photometric.ungradableRegions.length, 1);
  assert.equal(photometric.ungradableRegions[0].pixelCount, 16);
  assert.equal(photometric.status, "insufficient_evidence");
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.score, null);
});

test("overlapping scratch/scuff evidence merges to one physical finding and one deduction", () => {
  const width = 48;
  const height = 32;
  const scratch = mask(width, height, (x, y) => y === 12 && x >= 8 && x < 32);
  const scuff = mask(width, height, (x, y) => y === 12 && x >= 14 && x < 38);
  const combined = unionMasks(width, height, [scratch, scuff]);
  const photometric = buildPhotometric({
    width,
    height,
    responses: scratchResponses(combined),
  });
  const result = buildSurface("front", photometric, [
    seed({ side: "front", id: "overlap-scratch", category: "scratch", candidateMask: scratch }),
    seed({ side: "front", id: "overlap-scuff", category: "scuff", candidateMask: scuff }),
  ]);

  assert.equal(result.connectedComponentCount, 2);
  assert.equal(result.uniquePhysicalFindingCount, 1);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].secondaryEvidenceCategories, ["scuff"]);
  assert.equal(result.totalDeduction, result.findings[0].deduction);
  assert.equal(result.noDoubleDeduction, true);
});

test("merged seeds rebind repeated immutable evidence to one final physical region before deduplication", () => {
  const width = 48;
  const height = 32;
  const scratch = mask(width, height, (x, y) => y === 12 && x >= 8 && x < 32);
  const scuff = mask(width, height, (x, y) => y === 12 && x >= 14 && x < 38);
  const combined = unionMasks(width, height, [scratch, scuff]);
  const repeatedAuthority = {
    assetId: "shared-directional-authority",
    sha256: SHA,
    side: "front",
    role: "directional_channel",
    regionId: "seed-local-region-a",
    channelIndex: 1,
  };
  const first = seed({ side: "front", id: "shared-evidence-a", category: "scratch", candidateMask: scratch });
  const second = seed({ side: "front", id: "shared-evidence-b", category: "scuff", candidateMask: scuff });
  first.sourceEvidence = [repeatedAuthority];
  second.sourceEvidence = [{ ...repeatedAuthority, regionId: "seed-local-region-b" }];
  const result = buildSurface("front", buildPhotometric({
    width,
    height,
    responses: scratchResponses(combined),
  }), [first, second]);

  assert.equal(result.status, "computed");
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  const evidence = finding.measurements[0].evidence;
  assert.ok(evidence.every((entry) => entry.regionId === finding.regionId));
  assert.equal(evidence.filter((entry) => entry.assetId === repeatedAuthority.assetId).length, 1);
  assert.equal(new Set(evidence.map((entry) =>
    `${entry.assetId}:${entry.sha256}:${entry.channelIndex ?? 0}:${entry.regionId}`
  )).size, evidence.length);
});

test("spatially distinct detector candidates remain separate even when caller seed names imply one defect", () => {
  const width = 48;
  const height = 32;
  const first = mask(width, height, (x, y) => y === 7 && x >= 4 && x < 20);
  const second = mask(width, height, (x, y) => y === 24 && x >= 28 && x < 44);
  const combined = unionMasks(width, height, [first, second]);
  const photometric = buildPhotometric({
    width,
    height,
    responses: scratchResponses(combined),
  });
  const result = buildSurface("front", photometric, [
    seed({ side: "front", id: "claimed-same-defect-a", category: "scratch", candidateMask: first }),
    seed({ side: "front", id: "claimed-same-defect-b", category: "scuff", candidateMask: second }),
  ]);

  assert.equal(result.status, "computed");
  assert.equal(result.connectedComponentCount, 2);
  assert.equal(result.uniquePhysicalFindingCount, 2);
  assert.equal(result.findings.length, 2);
  assert.equal(result.totalDeduction, result.findings.reduce((sum, finding) => sum + finding.deduction, 0));
});

test("surface V1 emits category-appropriate physical measurements for every supported class", () => {
  const width = 48;
  const height = 32;
  const categories = ["scratch", "scuff", "dent", "crease", "stain", "print_defect", "foreign_material"];
  const expectedKind = {
    scratch: "length_mm",
    scuff: "area_mm2",
    dent: "deformation_area_mm2",
    crease: "length_mm",
    stain: "area_mm2",
    print_defect: "area_mm2",
    foreign_material: "area_mm2",
  };
  for (const [categoryIndex, category] of categories.entries()) {
    const y = 4 + categoryIndex * 3;
    const candidate = mask(width, height, (x, pixelY) => pixelY === y && x >= 8 && x < 24);
    const photometric = buildPhotometric({
      width,
      height,
      responses: scratchResponses(candidate),
    });
    const reliefIndex = plane(width, height, (_x, _y, pixel) =>
      Number(candidate.data[pixel]) > 0 ? 0.2 : 0,
    );
    const result = buildSurface("front", photometric, [
      seed({ side: "front", id: `category-${category}`, category, candidateMask: candidate }),
    ], { reliefIndex });
    assert.equal(result.status, "computed", category);
    assert.equal(result.findings.length, 1, category);
    const finding = result.findings[0];
    const basis = finding.measurements.find((measurement) =>
      measurement.measurementId === finding.deductionBasisMeasurementId,
    );
    const length = finding.measurements.find((measurement) => measurement.kind === "length_mm");
    const widthMeasurement = finding.measurements.find((measurement) => measurement.kind === "width_mm");
    const area = finding.measurements.find((measurement) =>
      measurement.kind === "area_mm2" || measurement.kind === "deformation_area_mm2",
    );
    assert.equal(basis.kind, expectedKind[category], category);
    assert.equal(length.measuredMeasurement, 1.6, category);
    assert.equal(widthMeasurement.measuredMeasurement, 0.1, category);
    assert.equal(area.measuredMeasurement, 0.16, category);
    assert.ok(finding.measurements.some((measurement) => measurement.kind === "length_mm"), category);
    assert.ok(finding.measurements.some((measurement) => measurement.kind === "width_mm"), category);
    assert.ok(
      finding.measurements.some((measurement) =>
        measurement.kind === "area_mm2" || measurement.kind === "deformation_area_mm2",
      ),
      category,
    );
  }
});
