const assert = require("node:assert/strict");
const test = require("node:test");
const sharp = require("sharp");

const {
  buildFastCalibrationAlgorithmManifestV1_2,
  composeFastCalibrationPhysicalToNormalizedDirectionV1_2,
  decodeFastCalibrationNormalizedGridV1_2,
  deriveFastCalibrationGeometryV1_2,
  distortFastCalibrationPixelV1_2,
  projectFastCalibrationHomographyV1_2,
  transformFastCalibrationPhysicalDirectionV1_2,
} = require("../dist/drivers/fixedRigFastCalibrationMathV1_2");

function lens(width = 128, height = 128, distortionCoefficients = [0, 0, 0, 0, 0]) {
  return {
    model: "opencv_brown_conrady_v1",
    sourceWidthPx: width,
    sourceHeightPx: height,
    cameraMatrix: [100, 0, width / 2, 0, 100, height / 2, 0, 0, 1],
    distortionCoefficients,
    calibrationRmsPx: 0.1,
    perViewResidualPx: Array(10).fill(0.1),
  };
}

function boundaryPoints(homography, lensModel, perturb = () => ({ x: 0, y: 0 })) {
  const corners = [
    { x: -0.5, y: -0.5 }, { x: 10.5, y: -0.5 }, { x: 10.5, y: 15.5 }, { x: -0.5, y: 15.5 },
  ];
  const values = [];
  for (let edge = 0; edge < 4; edge += 1) {
    for (let sample = 0; sample < 16; sample += 1) {
      const t = sample / 16;
      const start = corners[edge];
      const end = corners[(edge + 1) % 4];
      const canonical = { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) };
      const raw = distortFastCalibrationPixelV1_2(projectFastCalibrationHomographyV1_2(homography, canonical), lensModel);
      const delta = perturb(values.length);
      values.push({ x: raw.x + delta.x, y: raw.y + delta.y });
    }
  }
  return values;
}

function detection(homography, lensModel, mutateInternal = () => ({ x: 0, y: 0 }), mutateBoundary) {
  const internalCorners = [];
  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < 11; column += 1) {
      const index = row * 11 + column;
      const raw = distortFastCalibrationPixelV1_2(
        projectFastCalibrationHomographyV1_2(homography, { x: column, y: row }),
        lensModel,
      );
      const delta = mutateInternal(index);
      internalCorners.push({ x: raw.x + delta.x, y: raw.y + delta.y });
    }
  }
  const outerCorners = [
    { x: -0.5, y: -0.5 }, { x: 10.5, y: -0.5 }, { x: 10.5, y: 15.5 }, { x: -0.5, y: 15.5 },
  ].map((point) => distortFastCalibrationPixelV1_2(projectFastCalibrationHomographyV1_2(homography, point), lensModel));
  return {
    imageWidth: lensModel.sourceWidthPx,
    imageHeight: lensModel.sourceHeightPx,
    internalCorners,
    outerCorners,
    segmentationBoundary: boundaryPoints(homography, lensModel, mutateBoundary),
    rotationDegrees: 0,
  };
}

test("known Brown-Conrady and perspective homography fixtures reconstruct expected held-out and boundary residuals", () => {
  const lensModel = lens(128, 128, [-0.08, 0.01, 0.0007, -0.0004, 0]);
  const homography = [5.2, 0.25, 30, -0.15, 4.1, 24, 0.0012, -0.0008, 1];
  const result = deriveFastCalibrationGeometryV1_2(detection(homography, lensModel), lensModel);
  assert.ok(Math.max(...result.normalizationResidualPx) < 0.00001);
  assert.ok(Math.max(...result.segmentationBoundaryResidualPx) < 0.00001);
  assert.equal(result.normalizationResidualPx.length, 36);
  assert.equal(result.segmentationBoundaryResidualPx.length, 64);
});

test("internal-lattice distortion and independently segmented boundary error affect separate metrics", () => {
  const lensModel = lens();
  const homography = [5.2, 0.15, 31, -0.1, 4.2, 23, 0.0008, -0.0005, 1];
  const baseline = deriveFastCalibrationGeometryV1_2(detection(homography, lensModel), lensModel);
  const latticeError = deriveFastCalibrationGeometryV1_2(
    detection(homography, lensModel, (index) => index === 0 ? { x: 1.5, y: -0.5 } : { x: 0, y: 0 }),
    lensModel,
  );
  const boundaryError = deriveFastCalibrationGeometryV1_2(
    detection(homography, lensModel, undefined, (index) => index === 0 ? { x: -2, y: -2 } : { x: 0, y: 0 }),
    lensModel,
  );
  assert.ok(Math.max(...latticeError.normalizationResidualPx) > 1);
  assert.deepEqual(latticeError.segmentationBoundaryResidualPx, baseline.segmentationBoundaryResidualPx);
  assert.deepEqual(boundaryError.normalizationResidualPx, baseline.normalizationResidualPx);
  assert.ok(Math.max(...boundaryError.segmentationBoundaryResidualPx) > 1);
});

async function encodedSensor(width, height, inside, outside) {
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = x >= 32 && x <= 96 && y >= 16 && y <= 112 ? inside(x, y) : outside(x, y);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test("bright and changing pixels outside the verified normalized target ROI cannot alter flat or pattern grids", async () => {
  const lensModel = lens();
  const homography = [64 / 11, 0, 32 + 32 / 11, 0, 6, 19, 0, 0, 1];
  const inside = (x, y) => Math.round(80 + 0.4 * (x - 32) + 0.2 * (y - 16));
  const darkOutside = await encodedSensor(128, 128, inside, () => 0);
  const brightOutside = await encodedSensor(128, 128, inside, (x, y) => (x * 17 + y * 31) % 256);
  const first = await decodeFastCalibrationNormalizedGridV1_2(darkOutside, { widthPx: 128, heightPx: 128 }, lensModel, homography);
  const second = await decodeFastCalibrationNormalizedGridV1_2(brightOutside, { widthPx: 128, heightPx: 128 }, lensModel, homography);
  assert.deepEqual(first, second);
});

test("rotation, mirroring, and perspective compose physical directions into normalized target coordinates", () => {
  const rotation = [0, -4, 100, 4, 0, 20, 0, 0, 1];
  const rotatedMatrix = composeFastCalibrationPhysicalToNormalizedDirectionV1_2(rotation, [1, 0, 0, 1]);
  const rotated = transformFastCalibrationPhysicalDirectionV1_2({ x: 1, y: 0 }, rotatedMatrix);
  assert.ok(Math.abs(rotated.x) < 1e-9);
  assert.ok(rotated.y < -0.999999);

  const mirror = [-4, 0, 100, 0, 4, 20, 0, 0, 1];
  const mirrored = transformFastCalibrationPhysicalDirectionV1_2(
    { x: 1, y: 0 }, composeFastCalibrationPhysicalToNormalizedDirectionV1_2(mirror, [1, 0, 0, 1]),
  );
  assert.ok(mirrored.x < -0.999999);
  assert.ok(Math.abs(mirrored.y) < 1e-9);

  const perspective = [4, 0.2, 30, -0.1, 4.5, 20, 0.003, -0.002, 1];
  const transformed = transformFastCalibrationPhysicalDirectionV1_2(
    { x: 0.7, y: -0.2 }, composeFastCalibrationPhysicalToNormalizedDirectionV1_2(perspective, [2, 0.1, -0.2, 1.5]),
  );
  assert.ok(Number.isFinite(transformed.x) && Number.isFinite(transformed.y));
  assert.ok(Math.abs(Math.hypot(transformed.x, transformed.y) - 1) < 1e-9);
});

test("algorithm manifest hashes executable and dependency artifacts and rejects implementation drift", () => {
  const detector = Buffer.from("reviewed-detector-source");
  const dependencies = Buffer.from("opencv-python-headless==4.10.0.84\nnumpy==1.26.4\n");
  const baseline = buildFastCalibrationAlgorithmManifestV1_2({ detectorScriptBytes: detector,
    detectorDependencyManifestBytes: dependencies, sharpVersions: { sharp: "1", vips: "2" } });
  const geometryDrift = buildFastCalibrationAlgorithmManifestV1_2({
    detectorScriptBytes: detector,
    detectorDependencyManifestBytes: dependencies,
    sharpVersions: { sharp: "1", vips: "2" },
    geometryImplementationSource: "mutated executable geometry",
  });
  const dependencyDrift = buildFastCalibrationAlgorithmManifestV1_2({
    detectorScriptBytes: detector,
    detectorDependencyManifestBytes: dependencies,
    sharpVersions: { sharp: "different", vips: "2" },
  });
  const detectorDependencyDrift = buildFastCalibrationAlgorithmManifestV1_2({ detectorScriptBytes: detector,
    detectorDependencyManifestBytes: Buffer.from("opencv-python-headless==different\n"),
    sharpVersions: { sharp: "1", vips: "2" } });
  assert.notEqual(geometryDrift.geometry.manifestSha256, baseline.geometry.manifestSha256);
  assert.equal(geometryDrift.photometric.manifestSha256, baseline.photometric.manifestSha256);
  assert.notEqual(dependencyDrift.geometry.manifestSha256, baseline.geometry.manifestSha256);
  assert.notEqual(dependencyDrift.photometric.manifestSha256, baseline.photometric.manifestSha256);
  assert.notEqual(detectorDependencyDrift.geometry.manifestSha256, baseline.geometry.manifestSha256);
  assert.equal(detectorDependencyDrift.photometric.manifestSha256, baseline.photometric.manifestSha256);
});
