import sharp from "sharp";

type QualityResult = {
  score: number;
  blur: number;
  width: number;
  height: number;
};

const MIN_DIMENSION = 320;

export async function computeQualityScore(buffer: Buffer): Promise<QualityResult | null> {
  try {
    const image = sharp(buffer, { limitInputPixels: 32_000_000 }).timeout({ seconds: 10 }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    const stats = await image
      .resize(256, 256, { fit: "inside" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = stats.data;
    let mean = 0;
    for (let i = 0; i < data.length; i += 1) {
      mean += data[i] ?? 0;
    }
    mean /= data.length || 1;

    let variance = 0;
    for (let i = 0; i < data.length; i += 1) {
      const diff = (data[i] ?? 0) - mean;
      variance += diff * diff;
    }
    variance /= data.length || 1;

    const blurScore = Math.min(1, variance / 2000);
    const sizeScore = Math.min(1, Math.min(width, height) / MIN_DIMENSION);
    const score = Math.round((0.7 * blurScore + 0.3 * sizeScore) * 100) / 100;

    return { score, blur: Math.round(variance), width, height };
  } catch {
    return null;
  }
}
