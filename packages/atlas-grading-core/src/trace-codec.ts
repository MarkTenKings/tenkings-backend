export const SPEEDSTER_TRACE_RLE_V1_FORMAT = "TK_SPEEDSTER_TRACE_RLE_V1" as const;
export const SPEEDSTER_TRACE_WIDTH = 1270 as const;
export const SPEEDSTER_TRACE_HEIGHT = 1778 as const;
export const SPEEDSTER_TRACE_PIXEL_COUNT = SPEEDSTER_TRACE_WIDTH * SPEEDSTER_TRACE_HEIGHT;
const SPEEDSTER_TRACE_FIELDS = [
  "format", "width", "height", "origin", "order", "runs", "sha256",
] as const;

export type SpeedsterTraceRleV1 = Readonly<{
  format: typeof SPEEDSTER_TRACE_RLE_V1_FORMAT;
  width: typeof SPEEDSTER_TRACE_WIDTH;
  height: typeof SPEEDSTER_TRACE_HEIGHT;
  origin: "TOP_LEFT";
  order: "ROW_MAJOR_Y_X";
  runs: readonly number[];
  sha256: string;
}>;

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, amount: number) =>
  (value >>> amount) | (value << (32 - amount));

function sha256Hex(value: string): string {
  const source = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const bitLength = source.length * 8;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15];
      const word2 = words[index - 2];
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

function traceRuns(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Speedster trace runs must be a non-empty integer array.");
  }
  const runs = value.map((run, index) => {
    if (!Number.isSafeInteger(run) || Number(run) < 0) {
      throw new Error("Speedster trace runs must contain only non-negative safe integers.");
    }
    if (index > 0 && Number(run) === 0) {
      throw new Error("Every Speedster trace run after runs[0] must be positive.");
    }
    return Number(run);
  });
  if (runs.reduce((total, run) => total + run, 0) !== SPEEDSTER_TRACE_PIXEL_COUNT) {
    throw new Error("Speedster trace runs must sum to exactly 2,258,060 pixels.");
  }
  if (!runs.some((run, index) => index % 2 === 1 && run > 0)) {
    throw new Error("A saved Speedster trace must be non-empty.");
  }
  return runs;
}

export function speedsterTraceRleV1HashPreimage(
  value: Pick<SpeedsterTraceRleV1, "format" | "width" | "height" | "origin" | "order" | "runs">,
): string {
  return `${value.format}\n${value.width}\n${value.height}\n${value.origin}\n${value.order}\n0\n${value.runs.join(",")}\n`;
}

export function parseSpeedsterTraceRleV1(value: unknown): SpeedsterTraceRleV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved Speedster trace must be a TK_SPEEDSTER_TRACE_RLE_V1 object.");
  }
  const candidate = value as Record<string, unknown>;
  const candidateFields = Object.keys(candidate);
  if (
    candidateFields.length !== SPEEDSTER_TRACE_FIELDS.length ||
    candidateFields.some((field) => !(SPEEDSTER_TRACE_FIELDS as readonly string[]).includes(field))
  ) {
    throw new Error("Saved Speedster trace must contain exactly the frozen TK_SPEEDSTER_TRACE_RLE_V1 fields.");
  }
  if (
    candidate.format !== SPEEDSTER_TRACE_RLE_V1_FORMAT ||
    candidate.width !== SPEEDSTER_TRACE_WIDTH ||
    candidate.height !== SPEEDSTER_TRACE_HEIGHT ||
    candidate.origin !== "TOP_LEFT" ||
    candidate.order !== "ROW_MAJOR_Y_X"
  ) {
    throw new Error("Saved Speedster trace metadata does not match TK_SPEEDSTER_TRACE_RLE_V1.");
  }
  const runs = traceRuns(candidate.runs);
  if (typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sha256)) {
    throw new Error("Saved Speedster trace SHA-256 is malformed.");
  }
  const parsed: SpeedsterTraceRleV1 = {
    format: SPEEDSTER_TRACE_RLE_V1_FORMAT,
    width: SPEEDSTER_TRACE_WIDTH,
    height: SPEEDSTER_TRACE_HEIGHT,
    origin: "TOP_LEFT",
    order: "ROW_MAJOR_Y_X",
    runs,
    sha256: candidate.sha256,
  };
  if (sha256Hex(speedsterTraceRleV1HashPreimage(parsed)) !== parsed.sha256) {
    throw new Error("Saved Speedster trace SHA-256 does not match its canonical preimage.");
  }
  return parsed;
}

export function encodeSpeedsterTraceRleV1(trace: Uint8Array): SpeedsterTraceRleV1 {
  if (trace.length !== SPEEDSTER_TRACE_PIXEL_COUNT) {
    throw new Error("Speedster trace must contain exactly 2,258,060 canonical pixels.");
  }
  const runs: number[] = [];
  let expectedPixel: 0 | 1 = 0;
  let runLength = 0;
  let hasSetPixel = false;
  for (const pixel of trace) {
    if (pixel !== 0 && pixel !== 1) {
      throw new Error("Speedster trace pixels must be binary zero or one values.");
    }
    if (pixel === 1) hasSetPixel = true;
    if (pixel === expectedPixel) {
      runLength += 1;
      continue;
    }
    runs.push(runLength);
    expectedPixel = expectedPixel === 0 ? 1 : 0;
    runLength = 1;
  }
  runs.push(runLength);
  if (!hasSetPixel) throw new Error("A saved Speedster trace must be non-empty.");
  const withoutHash = {
    format: SPEEDSTER_TRACE_RLE_V1_FORMAT,
    width: SPEEDSTER_TRACE_WIDTH,
    height: SPEEDSTER_TRACE_HEIGHT,
    origin: "TOP_LEFT" as const,
    order: "ROW_MAJOR_Y_X" as const,
    runs,
  };
  return { ...withoutHash, sha256: sha256Hex(speedsterTraceRleV1HashPreimage(withoutHash)) };
}

export function decodeSpeedsterTraceRleV1(value: unknown): Uint8Array {
  const trace = parseSpeedsterTraceRleV1(value);
  const pixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  let offset = 0;
  trace.runs.forEach((run, index) => {
    if (index % 2 === 1) pixels.fill(1, offset, offset + run);
    offset += run;
  });
  return pixels;
}

export function* speedsterTraceRleV1Spans(
  trace: SpeedsterTraceRleV1,
): Generator<Readonly<{ x: number; y: number; width: number }>> {
  let offset = 0;
  for (let index = 0; index < trace.runs.length; index += 1) {
    const run = trace.runs[index];
    if (index % 2 === 1) {
      let cursor = offset;
      const end = offset + run;
      while (cursor < end) {
        const y = Math.floor(cursor / trace.width);
        const rowEnd = Math.min(end, (y + 1) * trace.width);
        yield { x: cursor % trace.width, y, width: rowEnd - cursor };
        cursor = rowEnd;
      }
    }
    offset += run;
  }
}
