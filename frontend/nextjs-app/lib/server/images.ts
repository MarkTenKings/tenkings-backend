import sharp from "sharp";

const DEFAULT_THUMB_WIDTH = 600;
const DEFAULT_PHOTOROOM_MAX_DIMENSION = 2048;

export async function createThumbnailPng(
  input: Buffer,
  maxWidth: number = DEFAULT_THUMB_WIDTH
): Promise<Buffer> {
  return sharp(input)
    .resize({ width: maxWidth, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, quality: 80 })
    .toBuffer();
}

export async function prepareImageForPhotoroom(
  input: Buffer,
  maxDimension: number = DEFAULT_PHOTOROOM_MAX_DIMENSION
): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
