import assert from "node:assert/strict";
import test from "node:test";

import {
  SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH,
  SPEEDSTER_TRACE_BITMAP_DATA_BASE64_LENGTH,
  SPEEDSTER_TRACE_BITMAP_WIRE_V1_FORMAT,
  decodeSpeedsterTraceBitmapWireV1,
  encodeSpeedsterTraceBitmapWireV1,
  parseSpeedsterTraceBitmapWireV1,
} from "../lib/ai-grader-v2/trace-bitmap-wire";
import {
  SPEEDSTER_TRACE_PIXEL_COUNT,
  encodeSpeedsterTraceRleV1,
} from "../lib/ai-grader-v2/trace-codec";

test("TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1 is exact fixed-size MSB-first transport", () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[0] = 1;
  pixels[7] = 1;
  pixels[8] = 1;
  pixels[SPEEDSTER_TRACE_PIXEL_COUNT - 1] = 1;
  const rle = encodeSpeedsterTraceRleV1(pixels);
  const wire = encodeSpeedsterTraceBitmapWireV1(pixels, rle.sha256);

  assert.equal(wire.format, SPEEDSTER_TRACE_BITMAP_WIRE_V1_FORMAT);
  assert.equal(wire.byteLength, SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH);
  assert.equal(SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH, 282_258);
  assert.equal(wire.dataBase64.length, SPEEDSTER_TRACE_BITMAP_DATA_BASE64_LENGTH);
  assert.equal(SPEEDSTER_TRACE_BITMAP_DATA_BASE64_LENGTH, 376_344);
  assert.deepEqual(Object.keys(wire), [
    "format", "width", "height", "origin", "order", "bitOrder", "byteLength", "dataBase64", "rleSha256",
  ]);
  assert.equal(atob(wire.dataBase64).charCodeAt(0), 0b1000_0001);
  assert.equal(atob(wire.dataBase64).charCodeAt(1), 0b1000_0000);
  assert.equal(atob(wire.dataBase64).charCodeAt(SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH - 1), 0b0001_0000);
  assert.deepEqual(decodeSpeedsterTraceBitmapWireV1(wire), pixels);
});

test("bitmap wire rejects extra keys, noncanonical base64, nonzero low padding bits, and an RLE hash mismatch", () => {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  pixels[1_129_665] = 1;
  const rle = encodeSpeedsterTraceRleV1(pixels);
  const wire = encodeSpeedsterTraceBitmapWireV1(pixels, rle.sha256);

  assert.throws(() => parseSpeedsterTraceBitmapWireV1({ ...wire, extra: true }), /exact|field|key/i);
  assert.throws(() => parseSpeedsterTraceBitmapWireV1({ ...wire, dataBase64: `${wire.dataBase64.slice(0, -1)}=` }), /base64|length/i);

  const badPaddingBytes = Uint8Array.from(atob(wire.dataBase64), (character) => character.charCodeAt(0));
  badPaddingBytes[badPaddingBytes.length - 1] |= 0b0000_0001;
  let binary = "";
  for (let offset = 0; offset < badPaddingBytes.length; offset += 24_576) {
    binary += String.fromCharCode(...badPaddingBytes.subarray(offset, offset + 24_576));
  }
  const badPadding = btoa(binary);
  assert.throws(() => parseSpeedsterTraceBitmapWireV1({ ...wire, dataBase64: badPadding }), /padding/i);
  assert.throws(() => parseSpeedsterTraceBitmapWireV1({ ...wire, rleSha256: "0".repeat(64) }), /RLE|SHA-256/i);
});
