import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEEDSTER_TRACE_PIXEL_COUNT,
  decodeSpeedsterTraceRleV1,
  encodeSpeedsterTraceRleV1,
  parseSpeedsterTraceRleV1,
  speedsterTraceRleV1HashPreimage,
  speedsterTraceRleV1Spans,
} from "../lib/ai-grader-v2/trace-codec";

const CENTER_PIXEL_VECTOR = {
  format: "TK_SPEEDSTER_TRACE_RLE_V1",
  width: 1270,
  height: 1778,
  origin: "TOP_LEFT",
  order: "ROW_MAJOR_Y_X",
  runs: [1_129_665, 1, 1_128_394],
  sha256: "928e33389ba8eb03acf1325532e93cfb615cf1527099bd53dbecd7e769cc6ed0",
} as const;

test("TK_SPEEDSTER_TRACE_RLE_V1 matches the cross-language center-pixel golden vector", () => {
  assert.equal(SPEEDSTER_TRACE_PIXEL_COUNT, 2_258_060);
  assert.equal(speedsterTraceRleV1HashPreimage(CENTER_PIXEL_VECTOR), [
    "TK_SPEEDSTER_TRACE_RLE_V1",
    "1270",
    "1778",
    "TOP_LEFT",
    "ROW_MAJOR_Y_X",
    "0",
    "1129665,1,1128394",
    "",
  ].join("\n"));

  const parsed = parseSpeedsterTraceRleV1({
    sha256: CENTER_PIXEL_VECTOR.sha256,
    runs: [...CENTER_PIXEL_VECTOR.runs],
    order: CENTER_PIXEL_VECTOR.order,
    origin: CENTER_PIXEL_VECTOR.origin,
    height: CENTER_PIXEL_VECTOR.height,
    width: CENTER_PIXEL_VECTOR.width,
    format: CENTER_PIXEL_VECTOR.format,
  });
  assert.deepEqual(parsed, CENTER_PIXEL_VECTOR);
  const decoded = decodeSpeedsterTraceRleV1(parsed);
  assert.equal(decoded.reduce((sum, pixel) => sum + pixel, 0), 1);
  assert.equal(decoded[1_129_665], 1);
  assert.deepEqual(Array.from(speedsterTraceRleV1Spans(parsed)), [{ x: 635, y: 889, width: 1 }]);
  assert.deepEqual(encodeSpeedsterTraceRleV1(decoded), CENTER_PIXEL_VECTOR);
});

test("codec round-trips coherent and maximally fragmented binary traces canonically", () => {
  const coherent = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  coherent.fill(1, 100_000, 125_000);
  const coherentEncoded = encodeSpeedsterTraceRleV1(coherent);
  assert.deepEqual(coherentEncoded.runs, [100_000, 25_000, SPEEDSTER_TRACE_PIXEL_COUNT - 125_000]);
  assert.deepEqual(decodeSpeedsterTraceRleV1(coherentEncoded), coherent);

  const fragmented = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  fragmented.forEach((_, index) => { fragmented[index] = index % 2; });
  const fragmentedEncoded = encodeSpeedsterTraceRleV1(fragmented);
  assert.equal(fragmentedEncoded.runs.length, SPEEDSTER_TRACE_PIXEL_COUNT);
  assert.equal(fragmentedEncoded.runs[0], 1);
  assert.equal(fragmentedEncoded.runs.at(-1), 1);
  assert.deepEqual(decodeSpeedsterTraceRleV1(fragmentedEncoded), fragmented);
});

test("saved traces reject empty, non-binary, non-maximal, wrong-sum, and hash-mismatched inputs", () => {
  assert.throws(
    () => encodeSpeedsterTraceRleV1(new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT)),
    /non-empty/i,
  );
  const nonBinary = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  nonBinary[0] = 2;
  assert.throws(() => encodeSpeedsterTraceRleV1(nonBinary), /binary/i);
  assert.throws(() => parseSpeedsterTraceRleV1({ ...CENTER_PIXEL_VECTOR, runs: [1_129_665, 0, 1, 1_128_394] }), /positive/i);
  assert.throws(() => parseSpeedsterTraceRleV1({ ...CENTER_PIXEL_VECTOR, runs: [1_129_665, 1] }), /2,258,060/);
  assert.throws(() => parseSpeedsterTraceRleV1({ ...CENTER_PIXEL_VECTOR, sha256: "0".repeat(64) }), /SHA-256/i);
  assert.throws(() => parseSpeedsterTraceRleV1({ ...CENTER_PIXEL_VECTOR, extra: true }), /field|key/i);
});
