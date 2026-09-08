import {
  SPEEDSTER_TRACE_HEIGHT,
  SPEEDSTER_TRACE_PIXEL_COUNT,
  SPEEDSTER_TRACE_WIDTH,
  encodeSpeedsterTraceRleV1,
} from "./trace-codec";

export const SPEEDSTER_TRACE_BITMAP_WIRE_V1_FORMAT = "TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1" as const;
export const SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH = 282_258 as const;
export const SPEEDSTER_TRACE_BITMAP_DATA_BASE64_LENGTH = 376_344 as const;

const WIRE_FIELDS = [
  "format",
  "width",
  "height",
  "origin",
  "order",
  "bitOrder",
  "byteLength",
  "dataBase64",
  "rleSha256",
] as const;

export type SpeedsterTraceBitmapWireV1 = Readonly<{
  format: typeof SPEEDSTER_TRACE_BITMAP_WIRE_V1_FORMAT;
  width: typeof SPEEDSTER_TRACE_WIDTH;
  height: typeof SPEEDSTER_TRACE_HEIGHT;
  origin: "TOP_LEFT";
  order: "ROW_MAJOR_Y_X";
  bitOrder: "MSB_FIRST";
  byteLength: typeof SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH;
  dataBase64: string;
  rleSha256: string;
}>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 24_576;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Speedster trace bitmap dataBase64 is malformed.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function exactWireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Speedster trace bitmap wire must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const fields = Object.keys(candidate);
  if (
    fields.length !== WIRE_FIELDS.length ||
    fields.some((field) => !(WIRE_FIELDS as readonly string[]).includes(field))
  ) {
    throw new Error("Speedster trace bitmap wire must contain exactly the frozen fields.");
  }
  return candidate;
}

export function parseSpeedsterTraceBitmapWireV1(value: unknown): SpeedsterTraceBitmapWireV1 {
  const candidate = exactWireObject(value);
  if (
    candidate.format !== SPEEDSTER_TRACE_BITMAP_WIRE_V1_FORMAT ||
    candidate.width !== SPEEDSTER_TRACE_WIDTH ||
    candidate.height !== SPEEDSTER_TRACE_HEIGHT ||
    candidate.origin !== "TOP_LEFT" ||
    candidate.order !== "ROW_MAJOR_Y_X" ||
    candidate.bitOrder !== "MSB_FIRST" ||
    candidate.byteLength !== SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH
  ) {
    throw new Error("Speedster trace bitmap metadata does not match TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1.");
  }
  if (
    typeof candidate.dataBase64 !== "string" ||
    candidate.dataBase64.length !== SPEEDSTER_TRACE_BITMAP_DATA_BASE64_LENGTH ||
    !/^[A-Za-z0-9+/]+$/.test(candidate.dataBase64)
  ) {
    throw new Error("Speedster trace bitmap dataBase64 must have the exact canonical length and alphabet.");
  }
  if (typeof candidate.rleSha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.rleSha256)) {
    throw new Error("Speedster trace bitmap RLE SHA-256 is malformed.");
  }
  const bytes = base64ToBytes(candidate.dataBase64);
  if (bytes.length !== SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH) {
    throw new Error("Speedster trace bitmap must decode to exactly 282,258 bytes.");
  }
  if ((bytes[bytes.length - 1] & 0x0f) !== 0) {
    throw new Error("Speedster trace bitmap final-byte padding bits must be zero.");
  }
  const parsed = candidate as SpeedsterTraceBitmapWireV1;
  const pixels = unpackSpeedsterTraceBitmapBytes(bytes);
  const rle = encodeSpeedsterTraceRleV1(pixels);
  if (rle.sha256 !== parsed.rleSha256) {
    throw new Error("Speedster trace bitmap RLE SHA-256 does not match the decoded pixels.");
  }
  return parsed;
}

function unpackSpeedsterTraceBitmapBytes(bytes: Uint8Array): Uint8Array {
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  for (let index = 0; index < SPEEDSTER_TRACE_PIXEL_COUNT; index += 1) {
    pixels[index] = (bytes[index >>> 3] >>> (7 - (index & 7))) & 1;
  }
  return pixels;
}

export function encodeSpeedsterTraceBitmapWireV1(
  pixels: Uint8Array,
  rleSha256: string,
): SpeedsterTraceBitmapWireV1 {
  if (pixels.length !== SPEEDSTER_TRACE_PIXEL_COUNT) {
    throw new Error("Speedster trace bitmap requires exactly 2,258,060 canonical pixels.");
  }
  const rle = encodeSpeedsterTraceRleV1(pixels);
  if (rle.sha256 !== rleSha256) {
    throw new Error("Speedster trace bitmap RLE SHA-256 does not match the supplied pixels.");
  }
  const bytes = new Uint8Array(SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH);
  for (let index = 0; index < pixels.length; index += 1) {
    const pixel = pixels[index];
    if (pixel !== 0 && pixel !== 1) {
      throw new Error("Speedster trace bitmap pixels must be binary zero or one values.");
    }
    if (pixel === 1) bytes[index >>> 3] |= 1 << (7 - (index & 7));
  }
  return {
    format: SPEEDSTER_TRACE_BITMAP_WIRE_V1_FORMAT,
    width: SPEEDSTER_TRACE_WIDTH,
    height: SPEEDSTER_TRACE_HEIGHT,
    origin: "TOP_LEFT",
    order: "ROW_MAJOR_Y_X",
    bitOrder: "MSB_FIRST",
    byteLength: SPEEDSTER_TRACE_BITMAP_BYTE_LENGTH,
    dataBase64: bytesToBase64(bytes),
    rleSha256,
  };
}

export function decodeSpeedsterTraceBitmapWireV1(value: unknown): Uint8Array {
  const wire = parseSpeedsterTraceBitmapWireV1(value);
  return unpackSpeedsterTraceBitmapBytes(base64ToBytes(wire.dataBase64));
}
