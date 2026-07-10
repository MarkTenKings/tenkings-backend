import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isAiGraderRasterBytes } from "../lib/aiGraderRasterValidation";

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

test("Dell publish flow decodes report assets before direct storage PUT", () => {
  const stationPath = [
    path.join(process.cwd(), "pages", "ai-grader", "station.tsx"),
    path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const source = fs.readFileSync(stationPath, "utf8");
  assert.match(source, /artifact\.artifactClass === "report_asset"/);
  assert.match(source, /await assertAiGraderBrowserRaster\(bytes, artifact\.contentType\)/);
});
