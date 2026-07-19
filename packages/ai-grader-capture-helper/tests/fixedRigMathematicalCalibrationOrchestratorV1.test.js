const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const {
  buildFixedRigPhysicalCalibrationV1,
} = require("../dist/drivers/fixedRigPhysicalCalibrationV1");
const {
  decodeFixedRigCalibratedDetectorPlaneV1,
} = require("../dist/drivers/fixedRigCalibratedDetectorPlaneV1");
const {
  buildFixedRigMathematicalCalibrationReportPackageV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationOrchestratorV1");
const {
  hashFixedRigIntendedOuterBoundaryV1,
} = require("../dist/drivers/fixedRigConditionPlaneProducerV1");
const {
  CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
} = require("../dist/drivers/cardGeometry");
const {
  AiGraderLocalStationBridgeService,
  buildAiGraderLocalStationBridgeConfig,
} = require("../dist/drivers/aiGraderLocalStationBridge");
const {
  FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
} = require("../dist/drivers/fixedRigMathematicalStationAdapterV1");
const {
  FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
} = require("../dist/drivers/fixedRigStandardCardFormatV1");

const WIDTH = 64;
const HEIGHT = 96;
const SENSOR_MAXIMUM = 255;
const EVIDENCE_SHA = "a".repeat(64);
const GENERATED_AT = "2026-07-18T20:00:00.000Z";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function canonicalHash(value) {
  return sha256(Buffer.from(JSON.stringify(canonical(value)), "utf8"));
}

function exactJsonArtifact(withoutHash) {
  const artifact = {
    ...withoutHash,
    artifactSha256: canonicalHash(withoutHash),
  };
  const bytes = Buffer.from(JSON.stringify(artifact, null, 2) + "\n", "utf8");
  return { artifact, bytes, fileSha256: sha256(bytes) };
}

function evidence(role, suffix) {
  return { evidenceId: `calibration-${suffix}`, sha256: EVIDENCE_SHA, role };
}

function flatEvidence(channel) {
  return Array.from({ length: 3 }, (_, frame) =>
    evidence("flat_field", `flat-${channel}-${frame + 1}`));
}

function darkEvidence(channel) {
  return Array.from({ length: 3 }, (_, frame) =>
    evidence("dark_control", `dark-${channel}-${frame + 1}`));
}

function patternEvidence(channel) {
  return Array.from({ length: 3 }, (_, frame) =>
    evidence("illumination_pattern", `pattern-${channel}-${frame + 1}`));
}

function buildCalibrationArtifacts() {
  const flats = Array.from({ length: 8 }, (_, offset) => {
    const channel = offset + 1;
    return exactJsonArtifact({
      schemaVersion: "ten-kings-flat-field-artifact-v1",
      algorithmVersion: "opencv_physical_calibration_analysis_v1",
      hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
      channelIndex: channel,
      sourceEvidence: flatEvidence(channel),
      darkControlEvidence: darkEvidence(channel),
      sourceWidthPx: WIDTH,
      sourceHeightPx: HEIGHT,
      gainGrid: { width: 2, height: 2, values: [1, 1, 1, 1] },
      correctedResidualSamples: [1, 1, 1, 1],
      responseScale: 1,
      correctedMaximumDeviationFraction: 0,
    });
  });
  const pattern = exactJsonArtifact({
    schemaVersion: "ten-kings-illumination-pattern-artifact-v1",
    algorithmVersion: "opencv_physical_calibration_analysis_v1",
    hashPolicy: "sha256-canonical-json-with-artifactSha256-omitted",
    coordinateFrame: "normalized_card_portrait_pixels",
    grid: { width: 2, height: 2 },
    channels: Array.from({ length: 8 }, (_, offset) => ({
      channelIndex: offset + 1,
      sourceEvidence: patternEvidence(offset + 1),
      expectedDirectionalResidual: [0, 0, 0, 0],
    })),
  });
  const scaleSamples = [
    ...Array.from({ length: 10 }, (_, index) => ({
      ...evidence("scale_x", `scale-x-${index}`),
      axis: "x", physicalSpanMm: 16, physicalSpanU95Mm: 0.01, pixelSpan: WIDTH,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      ...evidence("scale_y", `scale-y-${index}`),
      axis: "y", physicalSpanMm: 24, physicalSpanU95Mm: 0.01, pixelSpan: HEIGHT,
    })),
  ];
  const result = buildFixedRigPhysicalCalibrationV1({
    profileId: "orchestrator-calibration-v1",
    calibrationVersion: "calibration-v1.0.0",
    rigId: "ten-kings-fixed-rig-v1",
    artifactId: "orchestrator-physical-artifact-v1",
    finalizedAt: GENERATED_AT,
    normalizedWidthPx: WIDTH,
    normalizedHeightPx: HEIGHT,
    scaleSamples,
    targetPrintScaleSamples: [
      {
        ...evidence("print_scale", "print-scale-x"),
        axis: "x", nominalSpanMm: 100, measuredSpanMm: 100, measurementU95Mm: 0.01,
      },
      {
        ...evidence("print_scale", "print-scale-y"),
        axis: "y", nominalSpanMm: 200, measuredSpanMm: 200, measurementU95Mm: 0.01,
      },
    ],
    targetCutDimensionSamples: [
      {
        ...evidence("target_cut", "target-cut-x"), axis: "x",
        nominalDimensionMm: 63.5, measuredDimensionMm: 63.5, measurementU95Mm: 0.01,
      },
      {
        ...evidence("target_cut", "target-cut-y"), axis: "y",
        nominalDimensionMm: 88.9, measuredDimensionMm: 88.9, measurementU95Mm: 0.01,
      },
    ],
    lensResidualSamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("lens_view", `lens-${index}`), residualPx: 0.1,
    })),
    normalizationResidualSamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("normalization", `normalization-${index}`), residualPx: 0.1,
    })),
    repeatedPlacementSamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("placement", `placement-${index}`),
      displacementXMm: index % 2 ? 0.002 : -0.002,
      displacementYMm: index % 2 ? -0.002 : 0.002,
    })),
    segmentationBoundarySamples: Array.from({ length: 10 }, (_, index) => ({
      ...evidence("boundary", `boundary-${index}`),
      // This fixture rasterizes a physical boundary at one-pixel resolution. Record that
      // actual localization limit so one-pixel quantization is covered by U95 rather than
      // misclassified as card damage. The production acceptance maximum remains 1.5 px.
      outerContourFitResidualPx: Math.SQRT2,
    })),
    measurementRepeatabilitySamples: [
      ["linear_mm", 2, 0.001],
      ["area_mm2", 1, 0.001],
      ["relief_index", 0.4, 0.001],
      ["roughness_index", 0.2, 0.001],
      ["color_delta_e", 1.5, 0.001],
    ].flatMap(([measurementClass, baseline, step]) =>
      Array.from({ length: 10 }, (_, index) => ({
        ...evidence("measurement_repeatability", `${measurementClass}-${index}`),
        measurementClass,
        referenceFeatureId: `fixture-${measurementClass}`,
        measuredValue: baseline + (index - 4.5) * step,
      }))),
    lensModel: {
      model: "opencv_brown_conrady_v1",
      sourceWidthPx: WIDTH,
      sourceHeightPx: HEIGHT,
      cameraMatrix: [100, 0, WIDTH / 2, 0, 100, HEIGHT / 2, 0, 0, 1],
      distortionCoefficients: [0.001, -0.001, 0, 0, 0],
      calibrationRmsPx: 0.1,
      perViewResidualPx: Array(10).fill(0.1),
    },
    normalizationModel: {
      model: "undistort_outer_cut_homography_with_fixed_holdout_repeatability_v1",
      sampleResidualPx: Array(10).fill(0.1),
    },
    channels: Array.from({ length: 8 }, (_, offset) => {
      const channel = offset + 1;
      const angle = offset * Math.PI / 4;
      return {
        channelIndex: channel,
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        directionConfidence: 1,
        directionMeasurementSamples: Array.from({ length: 3 }, (_, sample) => ({
          ...evidence("direction_measurement", `direction-${channel}-${sample}`),
          measurementMethod: "fixed_ring_segment_geometry_with_ruler_v1",
          sourcePointMm: { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
          cardCenterPointMm: { x: 0, y: 0 },
          pointU95Mm: 0.1,
        })),
        directionValidationAngularErrorsDegrees: [0.1, 0.1, 0.1],
        relativeResponse: [1, 1, 1, 1],
        responseScale: 1,
        flatFieldArtifactId: `flat-field-${channel}`,
        flatFieldArtifactSha256: flats[offset].fileSha256,
        flatFieldFrames: flatEvidence(channel),
        darkControlFrames: darkEvidence(channel),
        illuminationPatternArtifactId: "illumination-pattern-v1",
        illuminationPatternArtifactSha256: pattern.fileSha256,
        illuminationPatternFrames: patternEvidence(channel),
        illuminationPatternGridWidth: 2,
        illuminationPatternGridHeight: 2,
        expectedDirectionalResidual: [0, 0, 0, 0],
      };
    }),
    targetEvidence: [evidence("target", "target")],
    operatorId: "calibration-operator",
    targetVersion: "ten-kings-mathematical-calibration-target-v1.0.0",
    targetSha256: EVIDENCE_SHA,
  });
  assert.equal(result.status, "finalized", JSON.stringify(result.issues));
  const physicalBytes = Buffer.from(JSON.stringify(result.artifact, null, 2) + "\n", "utf8");
  return {
    profile: result.profile,
    physicalBytes,
    flats: flats.map((entry) => entry.bytes),
    patternBytes: pattern.bytes,
  };
}

function lineSamples(axis, coordinate) {
  return Array.from({ length: 24 }, (_, index) => axis === "x"
    ? { x: coordinate, y: 8 + index * 3 }
    : { x: 7 + index * 2, y: coordinate });
}

function measurementCalibration(profile) {
  return {
    profile,
    calibrationProfileId: profile.profileId,
    calibrationVersion: profile.calibrationVersion,
    calibrationSha256: profile.artifactSha256,
    pixelsPerMmX: 1 / profile.mmPerPixelX,
    pixelsPerMmY: 1 / profile.mmPerPixelY,
  };
}

function confidence() {
  return { score: 0.99, band: "high", validEvidenceCoverage: 1, warnings: [] };
}

function writeExact(root, fileName, bytes) {
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, bytes);
  return { filePath, sha256: sha256(bytes) };
}

function reportEvidence(exact, assetId, fileName) {
  return {
    ...exact,
    assetId,
    fileName,
    contentType: "image/png",
  };
}

async function rgbPng() {
  const bytes = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const printedMargin =
        x < 4 || x >= WIDTH - 4 || y < 4 || y >= HEIGHT - 4;
      const value = printedMargin ? 100 : 160;
      const index = (y * WIDTH + x) * 3;
      bytes[index] = value;
      bytes[index + 1] = value;
      bytes[index + 2] = value;
    }
  }
  return sharp(bytes, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function directionalPng(channel, options = {}) {
  // A calibrated narrow scratch response: strong enough at the V1 scratch
  // scale, but intentionally below the larger-radius crease support gate.
  const residuals = [22, 21, 14, 10, -10, -14, -21, -22];
  const bytes = Buffer.alloc(WIDTH * HEIGHT, 90);
  if (options.scratch) {
    for (let x = 23; x <= 40; x += 1) {
      bytes[48 * WIDTH + x] = 90 + residuals[channel - 1];
    }
  }
  if (options.partialClipping && channel <= 2) {
    for (let y = 44; y < 46; y += 1) {
      for (let x = 30; x < 32; x += 1) bytes[y * WIDTH + x] = 255;
    }
  }
  if (options.fullyObscured) {
    for (let y = 44; y < 48; y += 1) {
      for (let x = 30; x < 34; x += 1) bytes[y * WIDTH + x] = 255;
    }
  }
  return sharp(bytes, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function darkPng() {
  return sharp(Buffer.alloc(WIDTH * HEIGHT), {
    raw: { width: WIDTH, height: HEIGHT, channels: 1 },
  }).png({ compressionLevel: 9 }).toBuffer();
}

function pointInsideContour(x, y, contour) {
  let inside = false;
  for (
    let current = 0, previous = contour.length - 1;
    current < contour.length;
    previous = current, current += 1
  ) {
    const a = contour[current];
    const b = contour[previous];
    if (
      (a.y > y) !== (b.y > y) &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

function orchestratorIntendedOuterBoundary() {
  const radiusX = WIDTH * 3.18 / 63.5;
  const radiusY = HEIGHT * 3.18 / 88.9;
  const contour = [{ x: radiusX, y: 0 }, { x: WIDTH - radiusX, y: 0 }];
  const arcs = [
    { cx: WIDTH - radiusX, cy: radiusY, start: -Math.PI / 2, end: 0 },
    { cx: WIDTH - radiusX, cy: HEIGHT - radiusY, start: 0, end: Math.PI / 2 },
    { cx: radiusX, cy: HEIGHT - radiusY, start: Math.PI / 2, end: Math.PI },
    { cx: radiusX, cy: radiusY, start: Math.PI, end: Math.PI * 1.5 },
  ];
  arcs.forEach((arc, arcIndex) => {
    const finalSegment = arcIndex === arcs.length - 1 ? 15 : 16;
    for (let index = 1; index <= finalSegment; index += 1) {
      const angle = arc.start + (arc.end - arc.start) * index / 16;
      contour.push({
        x: Number((arc.cx + radiusX * Math.cos(angle)).toFixed(9)),
        y: Number((arc.cy + radiusY * Math.sin(angle)).toFixed(9)),
      });
    }
  });
  const withoutHash = {
    profileId: "standard_sports_card_63_50x88_90_r3_18_v1",
    profileVersion: "1.0.0",
    coordinateFrame: "normalized_card_portrait_pixels",
    contour,
  };
  return {
    ...withoutHash,
    artifactSha256: hashFixedRigIntendedOuterBoundaryV1(withoutHash),
  };
}

async function rawAllOnPng(intendedContour) {
  const rawWidth = WIDTH + 16;
  const rawHeight = HEIGHT + 16;
  const bytes = Buffer.alloc(rawWidth * rawHeight * 3, 12);
  for (let rawY = 0; rawY < rawHeight; rawY += 1) {
    for (let rawX = 0; rawX < rawWidth; rawX += 1) {
      const normalizedX = rawX - 8 + 0.5;
      const normalizedY = rawY - 8 + 0.5;
      if (!pointInsideContour(normalizedX, normalizedY, intendedContour)) continue;
      const offset = (rawY * rawWidth + rawX) * 3;
      bytes[offset] = 100;
      bytes[offset + 1] = 100;
      bytes[offset + 2] = 100;
    }
  }
  return sharp(bytes, {
    raw: { width: rawWidth, height: rawHeight, channels: 3 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function rawToNormalizedTransform(rawSha256) {
  const payload = {
    schemaVersion: CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
    sourceSha256: rawSha256,
    sourceCoordinateFrame: "auto_oriented_raw_image_pixels",
    sourceWidthPx: WIDTH + 16,
    sourceHeightPx: HEIGHT + 16,
    autoOrientApplied: true,
    deskewClockwiseDegrees: 0,
    rotatedWidthPx: WIDTH + 16,
    rotatedHeightPx: HEIGHT + 16,
    crop: { leftPx: 8, topPx: 8, widthPx: WIDTH, heightPx: HEIGHT },
    outputCoordinateFrame: "normalized_card_portrait_pixels",
    outputWidthPx: WIDTH,
    outputHeightPx: HEIGHT,
    matrix: [1, 0, -8, 0, 1, -8, 0, 0, 1],
  };
  return {
    ...payload,
    transformSha256: sha256(Buffer.from(JSON.stringify(payload), "utf8")),
  };
}

async function buildSide(root, side, profile, options = {}) {
  const normalizedBytes = await rgbPng();
  const allOnBytes = await rgbPng();
  const intendedOuterBoundary = orchestratorIntendedOuterBoundary();
  const rawAllOnBytes = await rawAllOnPng(intendedOuterBoundary.contour);
  const designBytes = await rgbPng();
  const normalized = reportEvidence(
    writeExact(root, `${side}-normalized.png`, normalizedBytes),
    `${side}-normalized-card`,
    `${side}-normalized.png`,
  );
  const allOn = reportEvidence(
    writeExact(root, `${side}-all-on.png`, allOnBytes),
    `${side}-all-on`,
    `${side}-all-on.png`,
  );
  const rawAllOnFileName = side + '-raw-all-on.png';
  const rawAllOn = reportEvidence(
    writeExact(root, rawAllOnFileName, rawAllOnBytes),
    side + '-raw-all-on',
    rawAllOnFileName,
  );
  const design = reportEvidence(
    writeExact(root, `${side}-design.png`, designBytes),
    `${side}-design-artifact-v1`,
    `${side}-design.png`,
  );
  const dark = reportEvidence(
    writeExact(root, `${side}-dark.png`, await darkPng()),
    `${side}-registered-dark-control`,
    `${side}-dark.png`,
  );
  const directionalChannels = [];
  for (let channel = 1; channel <= 8; channel += 1) {
    directionalChannels.push({
      ...reportEvidence(
        writeExact(
          root,
          `${side}-directional-${channel}.png`,
          await directionalPng(channel, {
            scratch: Boolean(options.scratch),
            partialClipping: Boolean(options.partialClipping),
            fullyObscured: Boolean(options.fullyObscured),
          }),
        ),
        `${side}-directional-${channel}`,
        `${side}-directional-${channel}.png`,
      ),
      channel,
      channelConfidence: 0.99,
    });
  }
  const designReference = {
    schemaVersion: "ai-grader-design-reference-v1",
    designReferenceId: `${side}-design-reference-v1`,
    profile: "registered_design_template_v1",
    tenantId: "tenant-1",
    setId: "set-1",
    programId: "program-1",
    cardNumber: "42",
    variantId: "base",
    parallelId: null,
    side,
    artifactId: design.assetId,
    artifactSha256: design.sha256,
    version: 1,
    widthPx: WIDTH,
    heightPx: HEIGHT,
    intendedPrintBoundary: [
      { x: 0.0625, y: 0.041667 }, { x: 0.9375, y: 0.041667 },
      { x: 0.9375, y: 0.958333 }, { x: 0.0625, y: 0.958333 },
    ],
    approvedBy: "admin-1",
    approvedAt: GENERATED_AT,
  };
  return {
    rawAllOn,
    rawToNormalizedTransform: rawToNormalizedTransform(rawAllOn.sha256),
    normalizedAllOn: allOn,
    normalizedCard: normalized,
    directionalChannels,
    darkControl: dark,
    intendedOuterBoundary,
    designReference,
    designReferenceArtifact: design,
    designRegistration: {
      designReferenceId: designReference.designReferenceId,
      designReferenceSha256: designReference.artifactSha256,
      transformType: "affine",
      transformMatrix: [1, 0, 0, 0, 1, 0],
      registrationResidualPx: 0.1,
      inlierCount: 40,
      inlierFraction: 0.95,
      confidence: 0.98,
    },
    centering: {
      profileInput: {
        profile: "printed_border_v1",
      },
    },
    measurementCalibration: measurementCalibration(profile),
    algorithmVersion: "mathematical-condition-v1.0.0",
  };
}

async function buildFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-orchestrator-"));
  const calibration = buildCalibrationArtifacts();
  const physical = writeExact(root, "physical-calibration.json", calibration.physicalBytes);
  const flatFields = calibration.flats.map((bytes, offset) =>
    writeExact(root, `flat-field-${offset + 1}.json`, bytes));
  const pattern = writeExact(root, "illumination-pattern.json", calibration.patternBytes);
  const calibrationAuthorityMembers = [
    {
      role: "calibration_profile",
      fileName: "mathematical-calibration-profile-v1.json",
      sha256: sha256(Buffer.from(JSON.stringify(calibration.profile), "utf8")),
    },
    {
      role: "physical_calibration_artifact",
      fileName: "mathematical-calibration-artifact-v1.json",
      sha256: physical.sha256,
    },
    {
      role: "calibration_acceptance",
      fileName: "mathematical-calibration-acceptance-v1.json",
      sha256: EVIDENCE_SHA,
    },
    ...flatFields.map((entry, index) => ({
      role: "flat_field",
      channelIndex: index + 1,
      fileName: "flat-field-channel-" + (index + 1) + "-v1.json",
      sha256: entry.sha256,
    })),
    {
      role: "illumination_pattern",
      fileName: "illumination-pattern-v1.json",
      sha256: pattern.sha256,
    },
  ];
  const reportId = options.reportId ?? "mathematical-orchestrator-clean";
  const gradingSessionId = options.gradingSessionId ?? "mathematical-session-clean";
  const sides = {
    front: await buildSide(root, "front", calibration.profile, {
      scratch: Boolean(options.scratchFront),
      partialClipping: Boolean(options.partialClippingFront),
      fullyObscured: Boolean(options.fullyObscuredFront),
    }),
    back: await buildSide(root, "back", calibration.profile),
  };
  const input = {
    gradingContract: "mathematical_calibration_v1",
    gradingSessionId,
    generatedAt: GENERATED_AT,
    reportId,
    outputDir: path.join(root, options.outputName ?? "report-package"),
    captureProfileVersion: "ten-kings-fixed-rig-calibrated-v1",
    cardIdentity: {
      title: "Non-production mathematical calibration test card",
      sideCount: 2,
      tenantId: "tenant-1",
      setId: "set-1",
      programId: "program-1",
      set: "Calibration Set",
      cardNumber: "42",
      variantId: "base",
      parallelId: null,
    },
    calibration: {
      finalizedProfile: calibration.profile,
      bundleAuthority: {
        schemaVersion: "ten-kings-mathematical-calibration-bundle-v1",
        bundleManifestSha256: EVIDENCE_SHA,
        sourceCaptureManifestSha256: EVIDENCE_SHA,
        memberLedgerSha256: canonicalHash(calibrationAuthorityMembers),
        members: calibrationAuthorityMembers,
      },
      physicalArtifact: physical,
      flatFieldArtifacts: flatFields,
      illuminationPatternArtifact: pattern,
      sensorMaximumValue: SENSOR_MAXIMUM,
    },
    sides,
    findingReviews: [],
    report: {
      publication: {
        certId: options.scratchFront ? "TK-MATH-SCRATCH" : "TK-MATH-CLEAN",
        publicReportUrl: `/ai-grader/reports/${reportId}`,
        qrPayloadUrl: `/ai-grader/reports/${reportId}`,
      },
    },
  };
  return { root, input };
}

test("full orchestrator emits a clean checksum-bound V0.3 package from captured images", async (t) => {
  const fixture = await buildFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.equal("calibratedDetectorPlanes" in fixture.input.sides.front, false);
  const result = await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(
    result.status,
    "completed",
    result.reasons?.join("; ") ?? JSON.stringify(result.reviewRequest?.findings),
  );
  assert.equal(result.v0FallbackUsed, false);
  assert.deepEqual(result.summary.scores, {
    centering: 10,
    corners: 10,
    edges: 10,
    surface: 10,
    overall: 10,
    label: 10,
  });
  assert.equal(result.reportArtifact.bundle.schemaVersion, "ai-grader-report-bundle-v0.3");
  assert.equal(result.reportArtifact.bundle.productionRelease.finalGrade.status, "final_mathematical_grade_v1");
  assert.equal(result.reportArtifact.bundle.deductionLedger.entries.length, 0);
  assert.equal(fs.existsSync(result.reportPackage.envelopePath), true);
  const expectedMaskPayload = result.reportArtifact.assetPayloads.find(
    (entry) => entry.id.endsWith("/expectedOuterCardMask.tkplane"),
  );
  assert.ok(expectedMaskPayload);
  const expectedMask = decodeFixedRigCalibratedDetectorPlaneV1(expectedMaskPayload.bytes);
  assert.equal(expectedMask.header.derivation, "normalized_physical_segmentation");
  assert.deepEqual([...new Set(Array.from(expectedMask.plane.data))].sort(), [0, 1]);
  const scratchPlanePayload = result.reportArtifact.assetPayloads.find(
    (entry) => entry.id === "front/mathematical-v1/detector-planes/scratchLineResponse.tkplane",
  );
  const scratchPlane = decodeFixedRigCalibratedDetectorPlaneV1(scratchPlanePayload.bytes);
  assert.equal(scratchPlane.header.derivation, "fused_calibrated_detector");
  assert.ok(scratchPlane.header.sourceEvidence.some((entry) => entry.role === "all_on"));
  assert.equal(scratchPlane.header.heatmapUsedAsInput, false);
});

test("partial channel clipping recovers from alternate channels without recapture or a condition deduction", async (t) => {
  const fixture = await buildFixture({
    partialClippingFront: true,
    reportId: "mathematical-orchestrator-alternate-channel-recovery",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result =
    await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(result.status, "completed", result.reasons?.join("; "));
  assert.deepEqual(result.summary.scores, {
    centering: 10,
    corners: 10,
    edges: 10,
    surface: 10,
    overall: 10,
    label: 10,
  });
  const clipping = result.reportArtifact.bundle.evidenceQualityLimitations.find(
    (limitation) =>
      limitation.side === "front" && limitation.classification === "clipping",
  );
  assert.ok(clipping);
  assert.equal(clipping.recoveredFromAlternateChannels, true);
  assert.equal(clipping.recaptureRequired, false);
  assert.equal(clipping.deduction, 0);
});

test("a localized region obscured in every channel propagates fail-closed recapture and no report", async (t) => {
  const fixture = await buildFixture({
    fullyObscuredFront: true,
    reportId: "mathematical-orchestrator-localized-ungradable",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result =
    await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.failedStage, "photometric_evidence");
  assert.equal(result.requiresRecapture, true);
  assert.equal(result.reportPackage, null);
  assert.equal(result.stationInput, null);
  assert.equal(result.v0FallbackUsed, false);
  assert.match(result.reasons.join(" "), /insufficient valid directional coverage/i);
});

test("orchestrator preserves a controlled scratch as an exact measurement-derived deduction", async (t) => {
  const fixture = await buildFixture({
    scratchFront: true,
    reportId: "mathematical-orchestrator-scratch",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const draft = await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(
    draft.status,
    "finding_review_required",
    draft.reasons?.join("; ") ?? JSON.stringify(draft.reviewRequest?.findings),
  );
  assert.equal(draft.reportPackage, null);
  assert.equal(draft.stationInput, null);
  assert.match(draft.reviewRequest.artifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(draft.reviewRequest.findings.length, 1);
  assert.equal(draft.reviewRequest.findings[0].category, "scratch");
  assert.equal(draft.reviewAssets.length, 4);
  assert.deepEqual(
    draft.reviewAssets.map((asset) => asset.evidenceRole).sort(),
    ["confidence_mask", "illumination_mask", "roi_crop", "segmentation_mask"],
  );
  draft.reviewAssets.forEach((asset) => {
    assert.equal(asset.sha256, sha256(asset.bytes));
    assert.equal(asset.byteSize, asset.bytes.byteLength);
    assert.equal(asset.contentType, "image/png");
  });
  const reviewFinding = draft.reviewRequest.findings[0];
  assert.equal(reviewFinding.trueView.evidenceRole, "normalized_card");
  assert.equal(reviewFinding.directionalChannels.length, 8);
  assert.equal(reviewFinding.directionalChannels.every((asset) =>
    asset.evidenceRole === "directional_channel"), true);
  assert.deepEqual(
    Object.values(reviewFinding.reviewEvidence).map((asset) => asset.evidenceRole).sort(),
    ["confidence_mask", "illumination_mask", "roi_crop", "segmentation_mask"],
  );

  const stale = structuredClone(fixture.input);
  stale.outputDir = path.join(fixture.root, "stale-review-package");
  stale.findingReviews = draft.reviewRequest.findings.map((finding) => ({
    findingId: finding.findingId,
    reviewRequestSha256: "d".repeat(64),
    confidence: 0.98,
    status: "confirmed",
    reviewedAt: GENERATED_AT,
  }));
  const staleResult = await buildFixedRigMathematicalCalibrationReportPackageV1(stale);
  assert.equal(staleResult.status, "finding_review_required");
  assert.equal(staleResult.reportPackage, null);
  assert.match(staleResult.reviewIssues.join(" "), /exact finding-review request SHA-256/i);

  const operatorConfidence = structuredClone(fixture.input);
  operatorConfidence.outputDir = path.join(fixture.root, "operator-confidence-package");
  operatorConfidence.findingReviews = draft.reviewRequest.findings.map((finding) => ({
    findingId: finding.findingId,
    reviewRequestSha256: draft.reviewRequest.artifactSha256,
    confidence: 0.01,
    status: "confirmed",
    reviewedAt: GENERATED_AT,
  }));
  const operatorConfidenceResult = await buildFixedRigMathematicalCalibrationReportPackageV1(
    operatorConfidence,
  );
  assert.equal(operatorConfidenceResult.status, "finding_review_required");
  assert.match(operatorConfidenceResult.reviewIssues.join(" "), /must not author confidence/i);

  fixture.input.findingReviews = draft.reviewRequest.findings.map((finding) => ({
    findingId: finding.findingId,
    reviewRequestSha256: draft.reviewRequest.artifactSha256,
    status: "confirmed",
    reviewedAt: GENERATED_AT,
  }));
  const result = await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(result.status, "completed", result.reasons?.join("; "));
  assert.ok(result.grade.elements.surface.score < 10);
  assert.equal(result.grade.findings.length, 1);
  assert.equal(result.grade.findings[0].category, "scratch");
  assert.ok(result.grade.findings[0].deduction > 0);
  assert.ok(result.grade.findings[0].measurements.length > 0);
  assert.equal(result.reportArtifact.bundle.deductionLedger.entries.length, 1);
  assert.equal(result.reportArtifact.bundle.defectFindings.length, 1);
  assert.ok(result.reportArtifact.bundle.defectFindings[0].evidence.additionalEvidenceAssetIds.some(
    (assetId) => assetId.endsWith("/scratchLineResponse.tkplane"),
  ));
  assert.equal(
    result.reportArtifact.bundle.defectFindings[0].review.status,
    "confirmed",
  );
  assert.equal(
    result.reportArtifact.bundle.defectFindings[0].confidence,
    Math.min(...result.grade.findings[0].measurements.map((measurement) => Math.min(
      measurement.validEvidenceCoverage,
      measurement.usableDirectionalChannelCount / 8,
    ))),
  );
});

test("missing and hash-tampered immutable captures fail closed with no package or station input", async (t) => {
  const fixture = await buildFixture({ reportId: "mathematical-orchestrator-fail-closed" });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const tampered = structuredClone(fixture.input);
  tampered.sides.front.normalizedCard.sha256 = "b".repeat(64);
  tampered.outputDir = path.join(fixture.root, "tampered-package");
  const tamperedResult = await buildFixedRigMathematicalCalibrationReportPackageV1(tampered);
  assert.equal(tamperedResult.status, "insufficient_evidence");
  assert.equal(tamperedResult.failedStage, "capture_evidence_ingestion");
  assert.equal(tamperedResult.reportPackage, null);
  assert.equal(tamperedResult.stationInput, null);
  assert.equal(tamperedResult.v0FallbackUsed, false);

  const missing = structuredClone(fixture.input);
  missing.sides.front.normalizedAllOn.filePath = path.join(fixture.root, "missing-all-on.png");
  missing.outputDir = path.join(fixture.root, "missing-package");
  const missingResult = await buildFixedRigMathematicalCalibrationReportPackageV1(missing);
  assert.equal(missingResult.status, "insufficient_evidence");
  assert.equal(missingResult.failedStage, "capture_evidence_ingestion");
  assert.equal(missingResult.reportPackage, null);

  const legacy = structuredClone(fixture.input);
  legacy.gradingContract = "legacy_v0";
  const legacyResult = await buildFixedRigMathematicalCalibrationReportPackageV1(legacy);
  assert.equal(legacyResult.status, "insufficient_evidence");
  assert.equal(legacyResult.failedStage, "input_contract");
  assert.equal(legacyResult.v0FallbackUsed, false);

  const callerPlanes = structuredClone(fixture.input);
  callerPlanes.sides.front.calibratedDetectorPlanes = {};
  const callerPlanesResult =
    await buildFixedRigMathematicalCalibrationReportPackageV1(callerPlanes);
  assert.equal(callerPlanesResult.status, "insufficient_evidence");
  assert.equal(callerPlanesResult.failedStage, "input_contract");
  assert.match(callerPlanesResult.reasons.join(" "), /caller-supplied detector/i);
});

test("station accepts the package only inside an explicitly opted-in mathematical session", async (t) => {
  const stationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tenkings-math-station-orchestrator-"));
  t.after(() => fs.rmSync(stationRoot, { recursive: true, force: true }));
  const calibration = buildCalibrationArtifacts();
  const bundlePath = path.join(stationRoot, "fixture-mathematical-calibration-bundle-v1.json");
  const config = buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47652,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: stationRoot,
    mathematicalCalibrationRigId: calibration.profile.rigId,
    mathematicalCalibrationBundlePath: bundlePath,
    mathematicalCalibrationBundleSha256: EVIDENCE_SHA,
  });
  const service = new AiGraderLocalStationBridgeService(
    config,
    undefined,
    undefined,
    {
      loadMathematicalCalibrationBundle: (input) => ({
        bundlePath: input.bundlePath,
        bundleSha256: input.bundleSha256,
        bundle: {},
        profile: calibration.profile,
        physicalArtifact: {},
        acceptance: {},
        authority: {},
        files: {},
      }),
    },
  );
  t.after(() => service.shutdown("orchestrator station test complete"));
  const reportId = "mathematical-orchestrator-station";
  const started = await service.action("start-session", {
    reportId,
    captureProfile: "full_forensic",
    gradingContract: "mathematical_calibration_v1",
    mathematicalGradingAuthority: {
      schemaVersion: FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION,
      cardIdentity: {
        title: "Non-production mathematical calibration test card",
        sideCount: 2,
        tenantId: "tenant-1",
        setId: "set-1",
        programId: "program-1",
        cardNumber: "42",
        variantId: "base",
        parallelId: null,
      },
      cardFormatId: FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
      sides: {
        front: { centering: { profile: "printed_border_v1" } },
        back: { centering: { profile: "printed_border_v1" } },
      },
    },
  });
  const fixture = await buildFixture({
    reportId,
    gradingSessionId: started.sessionId,
    outputName: "station-package",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fixture.input.outputDir = path.join(stationRoot, "station-package");
  const result = await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(result.status, "completed", result.reasons?.join("; "));
  const exported = await service.action("export-report-bundle", result.stationInput);
  assert.equal(exported.gradingContract, "mathematical_calibration_v1");
  assert.equal(exported.reportBundle.reportId, reportId);

  const legacyRoot = path.join(stationRoot, "legacy");
  fs.mkdirSync(legacyRoot, { recursive: true });
  const legacyService = new AiGraderLocalStationBridgeService(buildAiGraderLocalStationBridgeConfig({
    enabled: true,
    mode: "mock",
    host: "127.0.0.1",
    port: 47653,
    stationToken: "StationTokenStationTokenStationToken1234",
    outputDir: legacyRoot,
  }));
  t.after(() => legacyService.shutdown("legacy boundary test complete"));
  await legacyService.action("start-session", {
    reportId: "legacy-session",
    captureProfile: "full_forensic",
  });
  await assert.rejects(
    () => legacyService.action("export-report-bundle", result.stationInput),
    /explicit mathematical_calibration_v1 session|contract explicitly selected at Start New Card/i,
  );
});
