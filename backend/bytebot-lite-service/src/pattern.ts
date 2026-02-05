import sharp from "sharp";

export type ImageSignature = {
  hash: string;
  avg: { r: number; g: number; b: number };
  width: number;
  height: number;
};

type CompareResult = {
  score: number;
  distance: number;
  colorDistance: number;
};

const HASH_SIZE = 8;
const HASH_BITS = HASH_SIZE * HASH_SIZE;

export async function computeImageSignature(url: string): Promise<ImageSignature | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const image = sharp(buffer).rotate();
    const { data, info } = await image
      .resize(HASH_SIZE, HASH_SIZE, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = [];
    let avgR = 0;
    let avgG = 0;
    let avgB = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      avgR += r;
      avgG += g;
      avgB += b;
      pixels.push((r + g + b) / 3);
    }

    const count = pixels.length || 1;
    avgR /= count;
    avgG /= count;
    avgB /= count;
    const mean = pixels.reduce((sum, value) => sum + value, 0) / count;
    const bits = pixels.map((value) => (value >= mean ? "1" : "0")).join("");

    return {
      hash: bits,
      avg: { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) },
      width: info.width ?? HASH_SIZE,
      height: info.height ?? HASH_SIZE,
    };
  } catch {
    return null;
  }
}

export function compareImageSignatures(
  a: ImageSignature,
  b: ImageSignature
): CompareResult {
  let distance = 0;
  const length = Math.min(a.hash.length, b.hash.length, HASH_BITS);
  for (let i = 0; i < length; i += 1) {
    if (a.hash[i] !== b.hash[i]) {
      distance += 1;
    }
  }

  const dr = a.avg.r - b.avg.r;
  const dg = a.avg.g - b.avg.g;
  const db = a.avg.b - b.avg.b;
  const colorDistance = Math.sqrt(dr * dr + dg * dg + db * db);
  const score = Math.max(0, 1 - distance / HASH_BITS);

  return { score, distance, colorDistance };
}
