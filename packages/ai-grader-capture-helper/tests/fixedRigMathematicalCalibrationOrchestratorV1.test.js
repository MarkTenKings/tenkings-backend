const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
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
  buildFixedRigCornerMeasurementOverlaySvgV1,
  buildFixedRigMathematicalCalibrationReportPackageV1,
} = require("../dist/drivers/fixedRigMathematicalCalibrationOrchestratorV1");
const {
  buildFixedRigOperatorResolutionAuthorityV1,
} = require("../dist/drivers/fixedRigOperatorResolutionAuthorityV1");
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
  deriveAiGraderHumanGeometryRegionsV1,
} = require("@tenkings/shared");
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

async function countExactRgb(bytes, [red, green, blue]) {
  const decoded = await sharp(bytes).removeAlpha().raw().toBuffer();
  let count = 0;
  for (let index = 0; index < decoded.length; index += 3) {
    if (
      decoded[index] === red &&
      decoded[index + 1] === green &&
      decoded[index + 2] === blue
    ) count += 1;
  }
  return count;
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

async function bracketPng(value, marker) {
  const bytes = Buffer.alloc(WIDTH * HEIGHT, value);
  // The immutable-role marker sits outside the rounded expected-card mask. It
  // makes every sealed source byte/hash-distinct without changing grade evidence.
  bytes[0] = marker;
  return sharp(bytes, {
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

function confirmedHumanGeometry(side) {
  const radiusX = WIDTH * 3.18 / 63.5;
  const radiusY = HEIGHT * 3.18 / 88.9;
  const corner = (vertex, horizontalTangent, verticalTangent) => ({
    vertex,
    horizontalTangent,
    verticalTangent,
    toolType: "rounded_3_18_mm",
    adjustment: {
      source: "candidate",
      snapApplied: true,
      snapDistancePx: 0,
      gradientStrength: 1,
    },
    reviewed: true,
  });
  const physicalCorners = {
    top_left: corner(
      { x: 0, y: 0 },
      { x: radiusX, y: 0 },
      { x: 0, y: radiusY },
    ),
    top_right: corner(
      { x: WIDTH, y: 0 },
      { x: WIDTH - radiusX, y: 0 },
      { x: WIDTH, y: radiusY },
    ),
    bottom_right: corner(
      { x: WIDTH, y: HEIGHT },
      { x: WIDTH - radiusX, y: HEIGHT },
      { x: WIDTH, y: HEIGHT - radiusY },
    ),
    bottom_left: corner(
      { x: 0, y: HEIGHT },
      { x: radiusX, y: HEIGHT },
      { x: 0, y: HEIGHT - radiusY },
    ),
  };
  const line = (edge, inset) => {
    if (edge === "top") return { start: { x: 0, y: inset }, end: { x: WIDTH, y: inset } };
    if (edge === "right") return { start: { x: WIDTH - inset, y: 0 }, end: { x: WIDTH - inset, y: HEIGHT } };
    if (edge === "bottom") return { start: { x: 0, y: HEIGHT - inset }, end: { x: WIDTH, y: HEIGHT - inset } };
    return { start: { x: inset, y: 0 }, end: { x: inset, y: HEIGHT } };
  };
  const printedBorders = Object.fromEntries(
    ["top", "right", "bottom", "left"].map((edge) => {
      const candidates = [3, 4, 5].map((inset, index) => ({
        id: `${side}-${edge}-fixture-${index + 1}`,
        line: line(edge, inset),
        rank: index + 1,
      }));
      return [edge, {
        candidates,
        selectedCandidateId: candidates[1].id,
        finalLine: candidates[1].line,
        adjustment: {
          source: "candidate",
          snapApplied: false,
          snapDistancePx: 0,
          gradientStrength: 0,
        },
        reviewed: true,
      }];
    }),
  );
  return {
    printedBorders,
    physicalCorners,
    derivedRegions: deriveAiGraderHumanGeometryRegionsV1(physicalCorners),
    edgeRegionsReviewed: true,
    surfaceRegionReviewed: true,
    confirmed: true,
  };
}

async function rawAllOnPng(intendedContour, marker, options = {}) {
  const rawWidth = WIDTH + 16;
  const rawHeight = HEIGHT + 16;
  const bytes = Buffer.alloc(rawWidth * rawHeight * 3, 12);
  for (let rawY = 0; rawY < rawHeight; rawY += 1) {
    for (let rawX = 0; rawX < rawWidth; rawX += 1) {
      const normalizedX = rawX - 8 + 0.5;
      const normalizedY = rawY - 8 + 0.5;
      if (!pointInsideContour(normalizedX, normalizedY, intendedContour)) continue;
      if (options.zeroOuterCut) continue;
      if (options.partialOuterCut && rawX >= 65 && rawY >= 12) continue;
      const offset = (rawY * rawWidth + rawX) * 3;
      bytes[offset] = 100;
      bytes[offset + 1] = 100;
      bytes[offset + 2] = 100;
    }
  }
  bytes[0] = marker;
  bytes[1] = marker;
  bytes[2] = marker;
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

function observedOuterContour(rawAllOnSha256, normalizedContour, transform) {
  const rawPoints = normalizedContour.map((point) => ({
    x: Number((point.x + 8).toFixed(6)),
    y: Number((point.y + 8).toFixed(6)),
  }));
  const contourSha256 = sha256(Buffer.from(JSON.stringify({
    sourceAssetSha256: rawAllOnSha256,
    coordinateFrame: "source_image_pixels",
    points: rawPoints,
  }), "utf8"));
  const raw = {
    schemaVersion: "ten-kings-card-geometry-observed-dense-contour-v1",
    coordinateFrame: "source_image_pixels",
    sourceAssetSha256: rawAllOnSha256,
    points: rawPoints,
    pointCount: rawPoints.length,
    contourSha256,
    strongSupportFraction: 1,
    evidenceQuality: "strong",
    measurementsPx: {
      width: WIDTH,
      height: HEIGHT,
      perimeter: 2 * (WIDTH + HEIGHT),
      enclosedArea: WIDTH * HEIGHT,
      angleDegrees: 0,
      circularArcs: [],
    },
  };
  const normalizedPoints = rawPoints.map((point) => ({
    x: Number((point.x - 8).toFixed(6)),
    y: Number((point.y - 8).toFixed(6)),
  }));
  const normalized = {
    schemaVersion: "ten-kings-normalized-dense-contour-v1",
    coordinateFrame: "normalized_card_portrait_pixels",
    sourceContourSha256: contourSha256,
    rawToNormalizedTransformSha256: transform.transformSha256,
    points: normalizedPoints,
    pointCount: normalizedPoints.length,
    contourSha256: sha256(Buffer.from(JSON.stringify({
      sourceContourSha256: contourSha256,
      rawToNormalizedTransformSha256: transform.transformSha256,
      coordinateFrame: "normalized_card_portrait_pixels",
      points: normalizedPoints,
    }), "utf8")),
  };
  return { raw, normalized };
}

async function buildSide(root, side, profile, options = {}) {
  const normalizedBytes = await rgbPng();
  const allOnBytes = await rgbPng();
  const intendedOuterBoundary = orchestratorIntendedOuterBoundary();
  const rawAllOnBytes = await rawAllOnPng(
    intendedOuterBoundary.contour,
    side === "front" ? 1 : 2,
    {
      partialOuterCut: Boolean(options.partialOuterCut),
      zeroOuterCut: Boolean(options.zeroOuterCut),
    },
  );
  const designBytes = await rgbPng();
  const normalized = reportEvidence(
    writeExact(root, `${side}-normalized.png`, normalizedBytes),
    `${side}-normalized-card`,
    `${side}-normalized.png`,
  );
  const allOn = reportEvidence(
    options.aliasNormalizedInputs
      ? { filePath: normalized.filePath, sha256: normalized.sha256 }
      : writeExact(root, `${side}-all-on.png`, allOnBytes),
    `${side}-all-on`,
    `${side}-all-on.png`,
  );
  const rawAllOnFileName = side + '-raw-all-on.png';
  const rawAllOn = reportEvidence(
    writeExact(root, rawAllOnFileName, rawAllOnBytes),
    side + '-raw-all-on',
    rawAllOnFileName,
  );
  const transform = rawToNormalizedTransform(rawAllOn.sha256);
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
    rawToNormalizedTransform: transform,
    observedOuterContour: observedOuterContour(
      rawAllOn.sha256,
      intendedOuterBoundary.contour,
      transform,
    ),
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
    humanGeometry: confirmedHumanGeometry(side),
  };
}

async function bracketDirectionalPng(value, marker, channel, exposureUs, options = {}) {
  const bytes = Buffer.alloc(WIDTH * HEIGHT, value);
  bytes[0] = marker;
  if (options.scratch) {
    const residuals = [22, 21, 14, 10, -10, -14, -21, -22];
    const scaledResidual = Math.round(residuals[channel - 1] * exposureUs / 37500);
    for (let x = 24; x <= 39; x += 1) {
      bytes[48 * WIDTH + x] = value + scaledResidual;
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
  return sharp(bytes, {
    raw: { width: WIDTH, height: HEIGHT, channels: 1 },
  }).png({ compressionLevel: 9 }).toBuffer();
}

async function replaceWithSealedExposureBracket(root, sideName, side, options = {}) {
  const exposures = [15000, 30000, 37500];
  let marker = sideName === "front" ? 10 : 110;
  const references = [];
  const nativeCaptureRoles = [{
    captureRole: "all_on",
    sha256: side.rawAllOn.sha256,
  }];
  const acceptedRaw = writeExact(
    root,
    `${sideName}-raw-accepted-profile.png`,
    await bracketPng(0, sideName === "front" ? 240 : 241),
  );
  nativeCaptureRoles.push({
    captureRole: "accepted_profile",
    sha256: acceptedRaw.sha256,
  });
  const channels = Array.from({ length: 8 }, (_, index) => ({
    channel: index + 1,
    channelConfidence: 0.99,
    observations: [],
  }));
  for (const exposureUs of exposures) {
    for (let referenceOrdinal = 1; referenceOrdinal <= 3; referenceOrdinal += 1) {
      const fileName =
        `${sideName}-bracket-${exposureUs}-reference-${referenceOrdinal}.png`;
      const reference = {
        ...reportEvidence(
          writeExact(root, fileName, await bracketPng(0, marker++)),
          `${sideName}-bracket-${exposureUs}-reference-${referenceOrdinal}`,
          fileName,
        ),
        exposureUs,
      };
      references.push(reference);
      nativeCaptureRoles.push({
        captureRole: `bracket_${exposureUs}_reference_${referenceOrdinal}`,
        sha256: reference.sha256,
      });
    }
    const value = exposureUs === 15000 ? 36 : exposureUs === 30000 ? 72 : 90;
    for (let channel = 1; channel <= 8; channel += 1) {
      const fileName = `${sideName}-bracket-${exposureUs}-channel-${channel}.png`;
      const observation = {
        ...reportEvidence(
          writeExact(
            root,
            fileName,
            await bracketDirectionalPng(
              value,
              marker++,
              channel,
              exposureUs,
              options,
            ),
          ),
          `${sideName}-bracket-${exposureUs}-channel-${channel}`,
          fileName,
        ),
        exposureUs,
      };
      channels[channel - 1].observations.push(observation);
      nativeCaptureRoles.push({
        captureRole: `bracket_${exposureUs}_channel_${channel}`,
        sha256: observation.sha256,
      });
    }
  }
  assert.equal(nativeCaptureRoles.length, 35);
  assert.equal(new Set(nativeCaptureRoles.map((role) => role.sha256)).size, 35);
  const result = {
    ...side,
    warmManifestSha256: canonicalHash({ side: sideName, nativeCaptureRoles }),
    nativeCaptureRoles,
    photometricExposureBracket: {
      version: "fixed_rig_exposure_bracket_capture_v1",
      isolatedDutyTenthsPercent: 24,
      settleMs: 0,
      gain: 0,
      pixelFormat: "Mono8",
      references,
      channels,
    },
  };
  delete result.directionalChannels;
  delete result.darkControl;
  return result;
}

async function resolveOperatorCheckpoint(input, resolutions = [], inspectPending = undefined) {
  const pending = await buildFixedRigMathematicalCalibrationReportPackageV1(input);
  if (pending.status !== "operator_resolution_required") return pending;
  if (pending.request.originalElements.surface.status === "computed") {
    assert.equal(
      Number.isFinite(pending.request.originalElements.surface.score),
      true,
      "a computed original surface result must bind its actual numeric subgrade",
    );
  } else {
    assert.equal(pending.request.originalElements.surface.score, null);
  }
  await inspectPending?.(pending);
  const deterministicReplay =
    await buildFixedRigMathematicalCalibrationReportPackageV1(input);
  assert.equal(deterministicReplay.status, "operator_resolution_required");
  assert.deepEqual(deterministicReplay.request, pending.request);
  const authority = buildFixedRigOperatorResolutionAuthorityV1({
    request: pending.request,
    submission: {
      schemaVersion: "operator_resolution_submission_v1",
      requestSha256: pending.request.requestSha256,
      operatorConfirmed: true,
      resolutions,
    },
    operatorId: "owner-1",
    authenticatedAt: GENERATED_AT,
  });
  input.operatorResolutionAuthorities = [authority];
  return buildFixedRigMathematicalCalibrationReportPackageV1(input);
}

function operatorCenteringSegments(front, back) {
  const build = (values) => [
    { margin: "left", start: { x: 8, y: 460 }, end: { x: 8 + values[0] * 1200 / 63.5, y: 460 } },
    { margin: "right", start: { x: 1192, y: 760 }, end: { x: 1192 - values[1] * 1200 / 63.5, y: 760 } },
    { margin: "top", start: { x: 340, y: 8 }, end: { x: 340, y: 8 + values[2] * 1680 / 88.9 } },
    { margin: "bottom", start: { x: 880, y: 1672 }, end: { x: 880, y: 1672 - values[3] * 1680 / 88.9 } },
  ];
  return {
    coordinateFrame: "normalized_card_portrait_pixels",
    widthPx: 1200,
    heightPx: 1680,
    order: ["left", "right", "top", "bottom"],
    front: build(front),
    back: build(back),
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
  const queueItemId = options.queueItemId ?? `${gradingSessionId}-queue-item`;
  const directSides = {
    front: await buildSide(root, "front", calibration.profile, {
      scratch: Boolean(options.scratchFront),
      partialClipping: Boolean(options.partialClippingFront),
      fullyObscured: Boolean(options.fullyObscuredFront),
      aliasNormalizedInputs: Boolean(options.aliasNormalizedInputs),
    }),
    back: await buildSide(root, "back", calibration.profile, {
      partialOuterCut: Boolean(options.partialOuterCutBack),
      zeroOuterCut: Boolean(options.zeroOuterCutBack),
      aliasNormalizedInputs: Boolean(options.aliasNormalizedInputs),
    }),
  };
  const sides = {
    front: await replaceWithSealedExposureBracket(
      root,
      "front",
      directSides.front,
      {
        scratch: Boolean(options.scratchFront),
        partialClipping: Boolean(options.partialClippingFront),
        fullyObscured: Boolean(options.fullyObscuredFront),
      },
    ),
    back: await replaceWithSealedExposureBracket(root, "back", directSides.back),
  };
  const input = {
    gradingContract: "mathematical_calibration_v1",
    queueItemId,
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
  const result = await resolveOperatorCheckpoint(
    fixture.input,
    [],
    async (pending) => {
      assert.equal(pending.workspaceAssets.length, 20);
      for (const asset of pending.workspaceAssets) {
        assert.equal(
          await countExactRgb(asset.bytes, [0x20, 0xe8, 0xff]),
          0,
          `${asset.assetId} must not render the detected cyan contour`,
        );
      }
      const cornerAssets = pending.workspaceAssets.filter(
        (asset) => asset.element === "corners",
      );
      assert.equal(cornerAssets.length, 8);
      const fittedMarkup = buildFixedRigCornerMeasurementOverlaySvgV1({
        center: { x: 90, y: 90 },
        point: { x: 140, y: 90 },
        radiusX: 50,
        radiusY: 50,
        radiusMm: 3.18,
      });
      const fittedOverlay = await sharp(Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${fittedMarkup}</svg>`,
      )).png().toBuffer();
      assert.ok(
        await countExactRgb(fittedOverlay, [0xff, 0x9f, 0x43]) > 0,
        "the fitted-radius renderer retains its orange arc, radius line, and center",
      );
      for (const side of ["front", "back"]) {
        assert.deepEqual(
          pending.workspace.galleries.edges
            .filter((asset) => asset.side === side)
            .map((asset) => asset.location),
          ["top", "right", "bottom", "left"],
        );
      }
    },
  );
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
  const customerFacingRelease = JSON.stringify({
    finalGrade: result.reportArtifact.bundle.productionRelease.finalGrade,
    label: result.reportArtifact.bundle.productionRelease.label,
  });
  assert.doesNotMatch(
    customerFacingRelease,
    /provisional|insufficient evidence|human review|exception/i,
  );
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

test("job-local exact reads and decoded RGB rendering preserve exact outputs", async (t) => {
  const ordinary = await buildFixture({
    reportId: "mathematical-orchestrator-ordinary-reads",
    outputName: "ordinary-reads-report-package",
  });
  const aliased = await buildFixture({
    aliasNormalizedInputs: true,
    reportId: "mathematical-orchestrator-job-cache",
    outputName: "job-cache-report-package",
  });
  t.after(() => {
    fs.rmSync(ordinary.root, { recursive: true, force: true });
    fs.rmSync(aliased.root, { recursive: true, force: true });
  });

  const runWithExactReadCount = async (input) => {
    const originalReadFile = fsPromises.readFile;
    let exactReadCount = 0;
    fsPromises.readFile = async (...args) => {
      exactReadCount += 1;
      return originalReadFile(...args);
    };
    try {
      return {
        result:
          await buildFixedRigMathematicalCalibrationReportPackageV1(input),
        exactReadCount,
      };
    } finally {
      fsPromises.readFile = originalReadFile;
    }
  };

  const ordinaryRun = await runWithExactReadCount(ordinary.input);
  const first = await runWithExactReadCount(aliased.input);
  const second = await runWithExactReadCount({
    ...aliased.input,
    outputDir: path.join(aliased.root, "second-job-cache-report-package"),
  });
  assert.equal(ordinaryRun.result.status, "operator_resolution_required");
  assert.equal(first.result.status, "operator_resolution_required");
  assert.equal(second.result.status, "operator_resolution_required");
  assert.equal(
    first.exactReadCount,
    ordinaryRun.exactReadCount - 2,
    "the two normalized-card/all-on aliases must each reuse one verified job-local read",
  );
  assert.equal(
    second.exactReadCount,
    first.exactReadCount,
    "a later job must perform its own exact reads before local reuse",
  );
  assert.deepEqual(second.result.request, first.result.request);
  assert.doesNotMatch(
    JSON.stringify(first.result.analysisCheckpoint),
    /normalizedRgbImage|rawBytes|encodedBytes/,
    "the job-local decoded representation must not enter checkpoint state",
  );
  assert.deepEqual(
    second.result.workspaceAssets.map((asset) => ({
      assetId: asset.assetId,
      sha256: asset.sha256,
      bytes: asset.bytes,
    })),
    first.result.workspaceAssets.map((asset) => ({
      assetId: asset.assetId,
      sha256: asset.sha256,
      bytes: asset.bytes,
    })),
    "a fresh job must produce byte-identical presentation assets",
  );

  const side = first.result.analysisCheckpoint.sides.front;
  const observationRoi = side.condition.observationRois.edges.top;
  const crop = {
    left: observationRoi.x,
    top: observationRoi.y,
    width: observationRoi.width,
    height: observationRoi.height,
  };
  const decoded = await sharp(side.normalizedBytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const renderOverlay = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="420">' +
      '<line x1="40" y1="210" x2="960" y2="210" stroke="#ff9f43" stroke-width="4"/>' +
      "</svg>",
  );
  const encodedRender = () => sharp(side.normalizedBytes, { failOn: "error" })
    .extract(crop)
    .resize(1000, 420, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .composite([{ input: renderOverlay, blend: "over" }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const decodedRender = () => sharp(decoded.data, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
    },
    failOn: "error",
  })
    .extract(crop)
    .resize(1000, 420, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .composite([{ input: renderOverlay, blend: "over" }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  assert.equal((await decodedRender()).equals(await encodedRender()), true);

  const timingWidth = 1200;
  const timingHeight = 1680;
  const timingRaw = Buffer.alloc(timingWidth * timingHeight * 3);
  let timingSeed = 0x1badf00d;
  for (let index = 0; index < timingRaw.length; index += 1) {
    timingSeed = (Math.imul(timingSeed, 1664525) + 1013904223) >>> 0;
    timingRaw[index] = timingSeed >>> 24;
  }
  const timingEncoded = await sharp(timingRaw, {
    raw: { width: timingWidth, height: timingHeight, channels: 3 },
  }).png({ compressionLevel: 6, adaptiveFiltering: false }).toBuffer();
  const timingCrop = { left: 180, top: 240, width: 840, height: 1080 };
  const encodedTimingRender = () => sharp(timingEncoded, { failOn: "error" })
    .extract(timingCrop)
    .resize(1000, 420, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const decodedTimingRender = () => sharp(timingRaw, {
    raw: { width: timingWidth, height: timingHeight, channels: 3 },
    failOn: "error",
  })
    .extract(timingCrop)
    .resize(1000, 420, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  assert.equal(
    (await decodedTimingRender()).equals(await encodedTimingRender()),
    true,
    "the Production-shaped decoded representation preserves output bytes",
  );
  const iterations = 4;
  const encodedStart = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    await encodedTimingRender();
  }
  const encodedMs = Number(process.hrtime.bigint() - encodedStart) / 1e6;
  const decodedStart = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) {
    await decodedTimingRender();
  }
  const decodedMs = Number(process.hrtime.bigint() - decodedStart) / 1e6;

  const exactPath = aliased.input.sides.front.normalizedCard.filePath;
  const expectedSha256 = aliased.input.sides.front.normalizedCard.sha256;
  const readIterations = 40;
  const repeatedReadStart = process.hrtime.bigint();
  for (let index = 0; index < readIterations; index += 1) {
    assert.equal(sha256(await fsPromises.readFile(exactPath)), expectedSha256);
  }
  const repeatedReadMs =
    Number(process.hrtime.bigint() - repeatedReadStart) / 1e6;
  const cachedReadStart = process.hrtime.bigint();
  const verifiedBytes = await fsPromises.readFile(exactPath);
  assert.equal(sha256(verifiedBytes), expectedSha256);
  const cacheKey = `${path.resolve(exactPath)}\0${expectedSha256}`;
  const exactCache = new Map([[cacheKey, verifiedBytes]]);
  for (let index = 1; index < readIterations; index += 1) {
    assert.equal(exactCache.get(cacheKey), verifiedBytes);
  }
  const cachedReadMs = Number(process.hrtime.bigint() - cachedReadStart) / 1e6;
  t.diagnostic(JSON.stringify({
    scope: "focused_fixture_only_not_production",
    timingFixture: `${timingWidth}x${timingHeight}-deterministic-noisy-rgb`,
    repeatedEncodedDecodeAndRenderMs: Number(encodedMs.toFixed(3)),
    decodedRepresentationRenderMs: Number(decodedMs.toFixed(3)),
    renderIterations: iterations,
    renderSavedMs: Number((encodedMs - decodedMs).toFixed(3)),
    repeatedExactReadAndHashMs: Number(repeatedReadMs.toFixed(3)),
    cachedExactReadAndHashMs: Number(cachedReadMs.toFixed(3)),
    exactReadIterations: readIterations,
    avoidedReadsAndHashes: readIterations - 1,
    ordinaryJobExactReads: ordinaryRun.exactReadCount,
    aliasedJobExactReads: first.exactReadCount,
  }));
});

test("a localized low-contrast outer-cut area preserves computed elements and the canonical image workspace", async (t) => {
  const fixture = await buildFixture({
    partialOuterCutBack: true,
    reportId: "mathematical-orchestrator-partial-outer-cut",
    outputName: "partial-outer-cut-report-package",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const resolutions = [
    {
      element: "centering",
      publicExplanation: "Printed borders are evenly balanced on both sides.",
      internalReason: "Owner supplied authenticated physical border measurements.",
      measurements: {
        unit: "mm",
        order: ["left", "right", "top", "bottom"],
        front: [2.39, 2.12, 2.35, 2.12],
        back: [2.7, 3.05, 3.45, 2.8],
        segments: operatorCenteringSegments(
          [2.39, 2.12, 2.35, 2.12],
          [2.7, 3.05, 3.45, 2.8],
        ),
      },
    },
    {
      element: "corners",
      score: 9.4,
      publicExplanation: "Corners show slight wear at the upper left.",
      internalReason: "Owner resolved the exact corner element.",
    },
    {
      element: "edges",
      score: 9.15,
      publicExplanation: "Edges show light wear along the lower border.",
      internalReason: "Owner resolved the exact edge element.",
    },
    {
      element: "surface",
      score: 8.75,
      publicExplanation: "Surface shows a visible scuff near the center.",
      internalReason: "Owner resolved the exact surface element.",
    },
  ];
  const result = await resolveOperatorCheckpoint(
    fixture.input,
    resolutions,
    (pending) => {
      assert.deepEqual(pending.unresolvedElements, []);
      assert.equal(
        Object.values(pending.request.originalElements)
          .every((element) => element.status === "computed"),
        true,
      );
      assert.equal(pending.workspace.galleries.centering.length, 2);
      assert.equal(pending.workspace.galleries.corners.length, 8);
      assert.equal(pending.workspace.galleries.edges.length, 8);
      assert.equal(pending.workspace.galleries.surface.length, 2);
      assert.equal(
        pending.workspaceAssets.length,
        Object.values(pending.workspace.galleries).flat().length,
      );
      const { analysisCheckpoint: _checkpoint, ...publicPending } = pending;
      assert.doesNotMatch(
        JSON.stringify(publicPending),
        /requiresRecapture\"\s*:\s*true/,
      );
    },
  );
  assert.equal(
    result.status,
    "completed",
    result.reasons?.join("; ") ?? JSON.stringify(result),
  );
  assert.equal(result.grade.elements.centering.resolved, true);
  assert.equal(result.grade.elements.centering.score, 7.46);
  assert.equal(result.summary.scores.centering, 7.46);
  assert.equal(result.reportArtifact.bundle.centeringEvidence.front.score, 8.74);
  assert.equal(result.reportArtifact.bundle.centeringEvidence.back.score, 7.23);
  assert.equal(result.reportArtifact.bundle.centeringEvidence.fusedScore, 7.46);
  assert.equal(
    result.reportArtifact.bundle.productionRelease.finalGrade.elements.centering.score,
    7.46,
  );
  assert.equal(
    result.reportArtifact.bundle.centeringEvidence.front.horizontal.u95Mm,
    0,
  );
  assert.equal(
    result.reportArtifact.bundle.centeringEvidence.front.vertical.u95Mm,
    0,
  );
  assert.equal(
    result.reportArtifact.bundle.centeringEvidence.back.horizontal.u95Mm,
    0,
  );
  assert.equal(
    result.reportArtifact.bundle.centeringEvidence.back.vertical.u95Mm,
    0,
  );
  assert.equal(result.grade.elements.corners.score, 9.4);
  assert.equal(result.grade.elements.edges.score, 9.15);
  assert.equal(result.grade.elements.surface.score, 8.75);
  assert.deepEqual(
    fixture.input.operatorResolutionAuthorities[0].resolutions[0]
      .measurements.segments.front[0],
    resolutions[0].measurements.segments.front[0],
  );
  const publicBundle = JSON.stringify(result.reportArtifact.bundle);
  assert.ok(result.reportArtifact.bundle.centeringEvidence.front.outerCutContourAssetId);
  assert.ok(result.reportArtifact.bundle.centeringEvidence.back.outerCutContourAssetId);
  assert.ok(result.reportArtifact.bundle.centeringEvidence.back.outerCutGeometryEvidence);
  assert.equal(
    result.reportArtifact.bundle.publicAssets.some(
      (asset) =>
        asset.side === "back" &&
        asset.evidenceRole === "outer_cut_contour",
    ),
    true,
  );
  assert.equal(
    result.reportArtifact.assetPayloads.some(
      (asset) => asset.id === "back/mathematical-v1/outer-cut-contour.png",
    ),
    true,
  );
  assert.doesNotMatch(
    publicBundle,
    /back measured outer physical cut contour|provisional|insufficient|human|manual|exception|admission/i,
  );
});

test("zero secondary outer-cut samples cannot veto the sealed canonical pixel contour", async (t) => {
  const fixture = await buildFixture({
    zeroOuterCutBack: true,
    reportId: "mathematical-orchestrator-zero-outer-cut",
    outputName: "zero-outer-cut-report-package",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result =
    await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(result.status, "operator_resolution_required");
  assert.equal(result.failedStage, "operator_resolution");
  assert.deepEqual(result.unresolvedElements, []);
  assert.equal(
    Object.values(result.request.originalElements)
      .every((element) => element.status === "computed"),
    true,
  );
  assert.equal(result.v0FallbackUsed, false);
  assert.equal(
    result.request.originalElements.corners.failureReasons.some(
      (reason) => /outer-cut|perimeter cross-section/i.test(reason),
    ),
    false,
  );
});

test("orchestrator rejects a self-rehashed authority whose embedded original differs from the exact request", async (t) => {
  const fixture = await buildFixture({
    reportId: "mathematical-orchestrator-original-tamper",
    outputName: "operator-original-tamper-report-package",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const pending =
    await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(pending.status, "operator_resolution_required");
  const authority = buildFixedRigOperatorResolutionAuthorityV1({
    request: pending.request,
    submission: {
      schemaVersion: "operator_resolution_submission_v1",
      requestSha256: pending.request.requestSha256,
      operatorConfirmed: true,
      resolutions: [{
        element: "surface",
        score: 9.25,
        publicExplanation: "The surface shows light handling wear.",
        internalReason: "Canonical original-snapshot tamper regression.",
      }],
    },
    operatorId: "owner-1",
    authenticatedAt: GENERATED_AT,
  });
  authority.resolutions[0].original.score = 1;
  const { authoritySha256: _discarded, ...authorityPayload } = authority;
  authority.authoritySha256 = canonicalHash(authorityPayload);
  fixture.input.operatorResolutionAuthorities = [authority];

  const rejected =
    await buildFixedRigMathematicalCalibrationReportPackageV1(fixture.input);
  assert.equal(rejected.status, "insufficient_evidence");
  assert.equal(rejected.failedStage, "operator_resolution");
  assert.match(rejected.reasons.join("; "), /stale|conflicting|immutable evidence/i);
  assert.equal(rejected.reportPackage, null);
});

test("sealed 33-source bracket completes strict report/package asset registration", async (t) => {
  const fixture = await buildFixture({
    reportId: "mathematical-orchestrator-sealed-exposure-bracket",
    outputName: "sealed-exposure-bracket-report-package",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = await resolveOperatorCheckpoint(fixture.input);
  assert.equal(
    result.status,
    "completed",
    result.reasons?.join("; ") ?? JSON.stringify(result.reviewRequest?.findings),
  );
  assert.equal(result.v0FallbackUsed, false);
  assert.equal(fs.existsSync(result.reportPackage.envelopePath), true);
  assert.equal(result.reportArtifact.assetPayloads.length, 197);
  const replay =
    await buildFixedRigMathematicalCalibrationReportPackageV1({
      ...fixture.input,
      outputDir: path.join(fixture.root, "sealed-exposure-bracket-replay"),
    });
  assert.equal(replay.status, "completed");
  assert.deepEqual(replay.grade, result.grade);
  assert.deepEqual(replay.summary, result.summary);
  assert.equal(
    replay.orchestrationTraceSha256,
    result.orchestrationTraceSha256,
  );
  assert.deepEqual(replay.reportArtifact.bundle, result.reportArtifact.bundle);
  const exactPayloads = (value) => value.reportArtifact.assetPayloads
    .map((asset) => ({
      id: asset.id,
      sha256: asset.sha256,
      bytes: asset.bytes,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(exactPayloads(replay), exactPayloads(result));
  const serialized = JSON.stringify(result.reportArtifact.bundle);
  assert.doesNotMatch(serialized, /exposure-bracket-v1-channel-/);
  for (const sideName of ["front", "back"]) {
    for (const planeName of [
      "registeredColorDeltaE",
      "registeredPrintDeltaE",
      "registeredResidueDeltaE",
    ]) {
      const payload = result.reportArtifact.assetPayloads.find(
        (entry) =>
          entry.id ===
          `${sideName}/mathematical-v1/detector-planes/${planeName}.tkplane`,
      );
      assert.ok(payload);
      const decoded = decodeFixedRigCalibratedDetectorPlaneV1(payload.bytes);
      assert.equal(Math.max(...Array.from(decoded.plane.data)), 0);
    }
    for (let channel = 1; channel <= 8; channel += 1) {
      const realPresentationAsset =
        `${sideName}-bracket-37500-channel-${channel}`;
      assert.match(serialized, new RegExp(realPresentationAsset));
      assert.ok(result.reportArtifact.bundle.publicAssets.some(
        (asset) => asset.id === realPresentationAsset,
      ));
    }
  }
  const publicProjection = JSON.stringify({
    productionRelease: result.reportArtifact.bundle.productionRelease,
    label: result.reportArtifact.bundle.productionRelease.label,
    evidenceQualityLimitations:
      result.reportArtifact.bundle.evidenceQualityLimitations,
  });
  assert.doesNotMatch(
    publicProjection,
    /provisional|insufficient|human review|exception|unavailable_source_modality|luminance-only/i,
  );
  const publicArtifactTexts = [
    JSON.stringify(result.stationInput),
    JSON.stringify(result.reportArtifact.bundle),
  ];
  const pendingDirectories = [result.reportPackage.outputDir];
  while (pendingDirectories.length) {
    const directory = pendingDirectories.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (/\.(?:html|json)$/i.test(entry.name)) {
        publicArtifactTexts.push(fs.readFileSync(entryPath, "utf8"));
      }
    }
  }
  assert.doesNotMatch(
    publicArtifactTexts.join("\n"),
    /unavailable_source_modality|authenticated capture source does not provide design-relative color evidence|luminance-only/i,
  );
});

test("exposure fusion selects nonclipped observations without recapture or a condition deduction", async (t) => {
  const fixture = await buildFixture({
    partialClippingFront: true,
    reportId: "mathematical-orchestrator-alternate-channel-recovery",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = await resolveOperatorCheckpoint(fixture.input);
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
  assert.equal(clipping, undefined);
});

test("localized directional obscuration still yields measured subgrades with private evidence quality", async (t) => {
  const fixture = await buildFixture({
    fullyObscuredFront: true,
    reportId: "mathematical-orchestrator-localized-ungradable",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = await resolveOperatorCheckpoint(
    fixture.input,
    [
      {
        element: "centering",
        publicExplanation: "Printed borders are evenly balanced on both sides.",
        internalReason: "Owner supplied authenticated physical border measurements.",
        measurements: {
          unit: "mm",
          order: ["left", "right", "top", "bottom"],
          front: [2.1, 2.2, 2.4, 2.3],
          back: [2.3, 2.2, 2.1, 2.4],
        },
      },
      {
        element: "corners",
        score: 9.4,
        publicExplanation: "Corners show slight wear at the upper left.",
        internalReason: "Owner resolved the exact corner element.",
      },
      {
        element: "edges",
        score: 9.15,
        publicExplanation: "Edges show light wear along the lower border.",
        internalReason: "Owner resolved the exact edge element.",
      },
      {
        element: "surface",
        score: 8.75,
        publicExplanation: "Surface shows a visible scuff near the center.",
        internalReason: "Owner resolved the exact surface element.",
      },
    ],
    (pending) => {
      assert.deepEqual(pending.unresolvedElements, []);
      assert.equal(
        Object.values(pending.request.originalElements)
          .every((element) => element.status === "computed"),
        true,
      );
      assert.ok(pending.workspace.galleries.surface.length >= 2);
      const { analysisCheckpoint: _checkpoint, ...publicPending } = pending;
      assert.doesNotMatch(
        JSON.stringify(publicPending),
        /requiresRecapture\"\s*:\s*true/,
      );
    },
  );
  assert.equal(
    result.status,
    "completed",
    result.reasons?.join("; ") ?? JSON.stringify(result),
  );
  assert.equal(result.grade.elements.centering.resolved, true);
  assert.equal(result.grade.elements.corners.score, 9.4);
  assert.equal(result.grade.elements.edges.score, 9.15);
  assert.equal(result.grade.elements.surface.score, 8.75);
  assert.ok(result.reportArtifact.bundle.centeringEvidence.front.outerCutGeometryEvidence);
  const publicExplanations = JSON.stringify({
    elements: Object.fromEntries(
      Object.entries(result.reportArtifact.bundle.productionRelease.finalGrade.elements)
        .map(([element, value]) => [element, value.explanation]),
    ),
    whyNot10: result.reportArtifact.bundle.productionRelease.finalGrade.whyNot10,
  });
  assert.doesNotMatch(
    publicExplanations,
    /provisional|insufficient|human|manual|exception|admission/i,
  );
});

test("orchestrator preserves a controlled scratch as an exact measurement-derived deduction", async (t) => {
  const fixture = await buildFixture({
    scratchFront: true,
    reportId: "mathematical-orchestrator-scratch",
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const draft = await resolveOperatorCheckpoint(fixture.input, [], (pending) => {
    assert.ok(
      pending.request.originalElements.surface.score < 10,
      "the original surface subgrade must reflect the measured scratch deduction",
    );
    assert.match(
      pending.request.originalElements.surface.resultSha256,
      /^[a-f0-9]{64}$/,
    );
  });
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
  const result = await resolveOperatorCheckpoint(fixture.input);
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
  t.after(() => fs.promises.rm(fixture.root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  }));

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

  const malformedTransform = structuredClone(fixture.input);
  malformedTransform.sides.back.rawToNormalizedTransform.transformSha256 =
    "c".repeat(64);
  malformedTransform.outputDir =
    path.join(fixture.root, "malformed-transform-package");
  const malformedTransformResult =
    await buildFixedRigMathematicalCalibrationReportPackageV1(malformedTransform);
  assert.equal(malformedTransformResult.status, "insufficient_evidence");
  assert.equal(malformedTransformResult.failedStage, "capture_evidence_ingestion");
  assert.equal(malformedTransformResult.requiresRecapture, false);
  assert.equal(malformedTransformResult.requiresImplementationCorrection, true);
  assert.equal(malformedTransformResult.reportPackage, null);
  assert.equal(malformedTransformResult.stationInput, null);
  assert.equal(malformedTransformResult.v0FallbackUsed, false);

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
    captureProfile: "production_fast",
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
  fixture.input.outputDir = path.join(stationRoot, "report-bundles", reportId, "mathematical-v1");
  const result = await resolveOperatorCheckpoint(fixture.input);
  assert.equal(result.status, "completed", result.reasons?.join("; "));
  const resolved = await service.reportBundle(reportId);
  assert.equal(resolved.gradingContract, "mathematical_calibration_v1");
  assert.equal(resolved.reportId, reportId);
  assert.equal(resolved.gradingSessionId, started.sessionId);
  assert.deepEqual(resolved.bundle, result.reportArtifact.bundle);
});
