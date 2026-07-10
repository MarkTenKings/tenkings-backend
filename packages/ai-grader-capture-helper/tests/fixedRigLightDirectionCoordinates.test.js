const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const {
  buildLightDirectionCalibrationArtifacts,
  mapApproximateLeimacChannelDirection,
} = require("../dist/drivers/fixedRigLightDirectionCalibration");

function assertClose(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

async function writeTestImage(filePath, channel, width = 40, height = 56) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.min(245, 35 + channel * 12 + Math.floor(x / 3) + Math.floor(y / 5));
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(filePath);
}

async function makeInputs(root, coordinateFrame) {
  const width = 40;
  const height = 56;
  const channelImages = [];
  for (let channel = 1; channel <= 4; channel += 1) {
    const outputFilePath = path.join(root, `channel-${channel}.png`);
    await writeTestImage(outputFilePath, channel, width, height);
    channelImages.push({
      channel,
      displayImage: {
        outputFilePath,
        imageWidth: width,
        imageHeight: height,
        displayTransform: "none",
        ...(coordinateFrame ? { analysisCoordinateFrame: coordinateFrame } : {}),
      },
    });
  }
  const darkPath = path.join(root, "dark.png");
  await writeTestImage(darkPath, 0, width, height);
  return {
    width,
    height,
    channelImages,
    trueView: {
      ...channelImages[0].displayImage,
      ...(coordinateFrame ? { analysisCoordinateFrame: coordinateFrame } : {}),
    },
    darkControl: {
      outputFilePath: darkPath,
      imageWidth: width,
      imageHeight: height,
      displayTransform: "none",
    },
  };
}

test("approximate Leimac vectors rotate coherently for positive and negative deskew while zero rotation is legacy-identical", () => {
  const rawChannel1 = mapApproximateLeimacChannelDirection(1);
  const rawChannel2 = mapApproximateLeimacChannelDirection(2, 0);
  assert.deepEqual(rawChannel1, {
    angleDegrees: 0,
    vector: { x: 0.876216, y: 0, z: 0.481919 },
  });
  assert.deepEqual(rawChannel2, {
    angleDegrees: 45,
    vector: { x: 0.619578, y: 0.619578, z: 0.481919 },
  });

  const positive = mapApproximateLeimacChannelDirection(1, 30);
  const negative = mapApproximateLeimacChannelDirection(1, -30);
  assert.equal(positive.angleDegrees, 30);
  assert.equal(negative.angleDegrees, 330);
  assertClose(positive.vector.x, negative.vector.x);
  assertClose(positive.vector.y, -negative.vector.y);
  assertClose(positive.vector.z, rawChannel1.vector.z);
  assertClose(negative.vector.z, rawChannel1.vector.z);
  assertClose(
    Math.hypot(positive.vector.x, positive.vector.y, positive.vector.z),
    Math.hypot(rawChannel1.vector.x, rawChannel1.vector.y, rawChannel1.vector.z),
  );
});

test("normalized-card directional model applies authoritative deskew and records excluded raw dark-control provenance", async () => {
  const root = path.join(os.tmpdir(), "fixed-rig-light-direction-normalized-coordinates");
  fs.rmSync(root, { recursive: true, force: true });
  const inputs = await makeInputs(path.join(root, "images"), "normalized_card_portrait_pixels");
  const result = await buildLightDirectionCalibrationArtifacts({
    side: "front",
    outputDir: path.join(root, "output"),
    trueView: inputs.trueView,
    darkControl: inputs.darkControl,
    channelImages: inputs.channelImages,
    lightVectorCoordinateTransform: {
      sourceCoordinateFrame: "basler_sensor_pixels",
      targetCoordinateFrame: "normalized_card_portrait_pixels",
      clockwiseRotationDegrees: 24,
      source: "authoritative_card_normalization",
    },
  });

  assert.equal(result.status, "computed_diagnostic");
  assert.equal(result.profile.lightVectorCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(result.profile.lightVectorCoordinateTransform.status, "applied_authoritative_card_deskew");
  assert.equal(result.profile.lightVectorCoordinateTransform.clockwiseRotationDegrees, 24);
  assert.deepEqual(
    result.profile.channelMetadata[0].lightVector,
    mapApproximateLeimacChannelDirection(1, 24).vector,
  );
  assert.deepEqual(
    result.profile.channelMetadata[0].sourceLightVector,
    mapApproximateLeimacChannelDirection(1, 0).vector,
  );
  assert.equal(result.normalization.coordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(result.normalization.darkSubtraction, false);
  assert.equal(result.normalization.darkControlRegistration.status, "not_applied_coordinate_mismatch");
  assert.equal(result.normalization.darkControlRegistration.geometricallyRegistered, false);
  assert.equal(result.normalProxy.analysisCoordinateFrame, "normalized_card_portrait_pixels");
  assert.equal(result.reliefProxy.analysisCoordinateFrame, "normalized_card_portrait_pixels");
  assert.match(result.warnings.join(" "), /rotated 24 degrees clockwise/);
  assert.match(result.warnings.join(" "), /not geometrically registered/);
});

test("normalized-card directional model suppresses normal and relief output when authoritative deskew is missing", async () => {
  const root = path.join(os.tmpdir(), "fixed-rig-light-direction-missing-deskew");
  fs.rmSync(root, { recursive: true, force: true });
  const inputs = await makeInputs(path.join(root, "images"), "normalized_card_portrait_pixels");
  const result = await buildLightDirectionCalibrationArtifacts({
    side: "back",
    outputDir: path.join(root, "output"),
    trueView: inputs.trueView,
    channelImages: inputs.channelImages,
  });

  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.profile.physicalDirectionMappingStatus, "rejected");
  assert.equal(
    result.profile.lightVectorCoordinateTransform.status,
    "rejected_missing_authoritative_card_deskew",
  );
  assert.equal(result.normalProxy, undefined);
  assert.equal(result.reliefProxy, undefined);
  assert.equal(result.normalizedChannels.length, 4);
  assert.match(result.warnings.join(" "), /output was suppressed/);
});

test("legacy sensor-coordinate artifact path keeps unrotated vectors and dark subtraction behavior", async () => {
  const root = path.join(os.tmpdir(), "fixed-rig-light-direction-legacy-coordinates");
  fs.rmSync(root, { recursive: true, force: true });
  const inputs = await makeInputs(path.join(root, "images"));
  const result = await buildLightDirectionCalibrationArtifacts({
    side: "front",
    outputDir: path.join(root, "output"),
    trueView: inputs.trueView,
    darkControl: inputs.darkControl,
    channelImages: inputs.channelImages,
  });

  assert.equal(result.status, "computed_diagnostic");
  assert.equal(result.profile.lightVectorCoordinateFrame, "basler_sensor_pixels");
  assert.equal(
    result.profile.lightVectorCoordinateTransform.status,
    "not_applied_legacy_sensor_coordinates",
  );
  assert.deepEqual(result.profile.channelMetadata[0].lightVector, {
    x: 0.876216,
    y: 0,
    z: 0.481919,
  });
  assert.equal(result.normalization.coordinateFrame, "ai_grader_card_portrait_display");
  assert.equal(result.normalization.darkSubtraction, true);
  assert.equal(result.normalization.darkControlRegistration.status, "registered_same_coordinate_frame");
});
