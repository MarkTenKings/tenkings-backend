const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const scriptPath = path.resolve(
  __dirname,
  "../../../scripts/ai-grader/detect-mathematical-calibration-preview-checkerboard.py",
);

test("checked-in calibration detector compiles as Python", async () => {
  const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tk-calibration-detector-pycache-"));
  try {
    const compiled = spawnSync("python", [
      "-c",
      "import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)",
      scriptPath,
      path.join(cacheRoot, "detector.pyc"),
    ], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
  } finally {
    await fs.rm(cacheRoot, { recursive: true, force: true });
  }
});

test("checked-in calibration detector returns independent boundary evidence for a representative board", async (t) => {
  const dependencies = spawnSync("python", ["-c", "import cv2, numpy"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (dependencies.status !== 0) {
    t.skip("checked-in OpenCV/NumPy detector dependencies are not installed");
    return;
  }

  const width = 1000;
  const height = 1400;
  const cell = 50;
  const columns = 12;
  const rows = 17;
  const boardWidth = columns * cell;
  const boardHeight = rows * cell;
  const startX = Math.floor((width - boardWidth) / 2);
  const startY = Math.floor((height - boardHeight) / 2);
  const border = 24;
  const pixels = Buffer.alloc(width * height, 245);
  const fill = (left, top, right, bottom, value) => {
    for (let y = top; y < bottom; y += 1) {
      pixels.fill(value, y * width + left, y * width + right);
    }
  };
  fill(startX - border, startY - border, startX + boardWidth + border, startY + boardHeight + border, 0);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      fill(
        startX + column * cell,
        startY + row * cell,
        startX + (column + 1) * cell,
        startY + (row + 1) * cell,
        (row + column) % 2 === 0 ? 0 : 255,
      );
    }
  }
  const encoded = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const detected = spawnSync("python", [scriptPath], {
    input: encoded,
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(detected.status, 0, detected.stderr.toString("utf8"));
  const result = JSON.parse(detected.stdout.toString("utf8"));
  assert.equal(result.imageWidth, width);
  assert.equal(result.imageHeight, height);
  assert.equal(result.internalCorners.length, 176);
  assert.equal(result.outerCorners.length, 4);
  assert.ok(result.segmentationBoundary.length >= 8);
  assert.match(result.detectorMethod, /^opencv_find_chessboard_corners_/);
});
