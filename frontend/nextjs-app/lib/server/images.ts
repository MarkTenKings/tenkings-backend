import sharp from "sharp";

const DEFAULT_THUMB_WIDTH = 600;

export async function createThumbnailPng(
  input: Buffer,
  maxWidth: number = DEFAULT_THUMB_WIDTH
): Promise<Buffer> {
  return sharp(input)
    .resize({ width: maxWidth, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, quality: 80 })
    .toBuffer();
}
