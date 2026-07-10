import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  assertAiGraderBrowserRaster,
  isAiGraderRasterBytes,
  readAiGraderRasterDimensions,
} from "../lib/aiGraderRasterValidation";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
function arrayBuffer(value: Buffer) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

test("direct report upload raster preflight accepts exact PNG and JPEG bytes", async () => {
  const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).jpeg().toBuffer();
  const jfif = Buffer.from([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const jpegWithJfif = Buffer.concat([jpeg.subarray(0, 2), jfif, jpeg.subarray(2)]);
  assert.equal(isAiGraderRasterBytes(arrayBuffer(PNG), "image/png"), true);
  assert.equal(isAiGraderRasterBytes(arrayBuffer(PNG), "image/jpeg"), false);
  assert.equal(isAiGraderRasterBytes(arrayBuffer(jpeg), "image/jpeg"), true);
  assert.equal(isAiGraderRasterBytes(arrayBuffer(jpegWithJfif), "image/jpeg"), true);
});

test("direct report upload raster preflight rejects MIME spoofing and trailing payloads", async () => {
  const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).jpeg().toBuffer();
  const jfxx = Buffer.from([
    0xff, 0xe0, 0x00, 0x0a,
    0x4a, 0x46, 0x58, 0x58, 0x00,
    0x13, 0x50, 0x52,
  ]);
  const adobeApp14 = Buffer.from([
    0xff, 0xee, 0x00, 0x0e,
    0x41, 0x64, 0x6f, 0x62, 0x65,
    0x50, 0x52, 0x49, 0x56, 0x41, 0x54, 0x45,
  ]);
  assert.equal(isAiGraderRasterBytes(arrayBuffer(Buffer.from("<svg><script>bad</script></svg>")), "image/png"), false);
  assert.equal(isAiGraderRasterBytes(arrayBuffer(Buffer.concat([PNG, Buffer.from("secret")])) , "image/png"), false);
  assert.equal(
    isAiGraderRasterBytes(arrayBuffer(Buffer.concat([jpeg, Buffer.from("private-payload"), Buffer.from([0xff, 0xd9])])), "image/jpeg"),
    false,
  );
  assert.equal(
    isAiGraderRasterBytes(arrayBuffer(Buffer.concat([jpeg.subarray(0, 2), jfxx, jpeg.subarray(2)])), "image/jpeg"),
    false,
  );
  assert.equal(
    isAiGraderRasterBytes(arrayBuffer(Buffer.concat([jpeg.subarray(0, 2), adobeApp14, jpeg.subarray(2)])), "image/jpeg"),
    false,
  );
  assert.equal(isAiGraderRasterBytes(arrayBuffer(PNG), "image/svg+xml"), false);
});

test("trusted bounded header parsing reads PNG, JPEG, and WebP dimensions", async () => {
  const jpeg = await sharp({ create: { width: 23, height: 31, channels: 3, background: "white" } }).jpeg().toBuffer();
  const webp = await sharp({ create: { width: 37, height: 41, channels: 3, background: "white" } }).webp().toBuffer();
  const largePixels = Buffer.allocUnsafe(1200 * 1600 * 3);
  let state = 0x13579bdf;
  for (let index = 0; index < largePixels.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    largePixels[index] = state >>> 24;
  }
  const largeWebp = await sharp(largePixels, {
    raw: { width: 1200, height: 1600, channels: 3 },
  }).webp({ lossless: true }).toBuffer();
  assert.deepEqual(readAiGraderRasterDimensions(PNG, "image/png"), { widthPx: 1, heightPx: 1 });
  assert.deepEqual(readAiGraderRasterDimensions(jpeg.subarray(0, 256 * 1024), "image/jpeg"), {
    widthPx: 23,
    heightPx: 31,
  });
  assert.deepEqual(readAiGraderRasterDimensions(webp.subarray(0, 256 * 1024), "image/webp"), {
    widthPx: 37,
    heightPx: 41,
  });
  assert.ok(largeWebp.byteLength > 256 * 1024);
  assert.deepEqual(readAiGraderRasterDimensions(largeWebp.subarray(0, 256 * 1024), "image/webp"), {
    widthPx: 1200,
    heightPx: 1600,
  });
  assert.equal(readAiGraderRasterDimensions(Buffer.from("not-an-image"), "image/png"), null);
});

test("browser raster preflight returns decoded dimensions and rejects a planned-dimension mismatch", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let closeCount = 0;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    writable: true,
    value: async () => ({
      width: 1,
      height: 1,
      close() {
        closeCount += 1;
      },
    }),
  });

  try {
    assert.deepEqual(
      await assertAiGraderBrowserRaster(arrayBuffer(PNG), "image/png", { widthPx: 1, heightPx: 1 }),
      { widthPx: 1, heightPx: 1 },
    );
    assert.deepEqual(
      await assertAiGraderBrowserRaster(arrayBuffer(PNG), "image/png"),
      { widthPx: 1, heightPx: 1 },
    );
    await assert.rejects(
      assertAiGraderBrowserRaster(arrayBuffer(PNG), "image/png", { widthPx: 2, heightPx: 1 }),
      /dimensions do not match the upload plan \(1x1 decoded; 2x1 planned\)/,
    );
    await assert.rejects(
      assertAiGraderBrowserRaster(arrayBuffer(PNG), "image/png", { widthPx: 0, heightPx: 1 }),
      /plan is missing valid pixel dimensions/,
    );
    assert.equal(closeCount, 3);
  } finally {
    if (originalCreateImageBitmap) {
      Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        writable: true,
        value: originalCreateImageBitmap,
      });
    } else {
      delete (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
    }
  }
});

test("Dell publish flow decodes report assets before direct storage PUT", () => {
  const stationPath = [
    path.join(process.cwd(), "pages", "ai-grader", "station.tsx"),
    path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const source = fs.readFileSync(stationPath, "utf8");
  assert.match(source, /artifact\.artifactClass === "report_asset"/);
  assert.match(source, /await assertAiGraderBrowserRaster\(/);
  assert.match(source, /artifact\.contentType,[\s\S]*plannedDimensions/);
  assert.match(source, /sourceImageWidthPx: decodedDimensions\.widthPx/);
  assert.match(source, /\.\.\.verifiedSourceImageDimensions/);
  const productionApiPath = path.join(
    process.cwd(),
    "pages",
    "api",
    "admin",
    "ai-grader",
    "production",
    "[...action].ts",
  );
  const productionApiSource = fs.readFileSync(productionApiPath, "utf8");
  assert.match(productionApiSource, /await readStoragePrefix\(storageKey\)/);
  assert.match(productionApiSource, /readAiGraderRasterDimensions/);
});
