import sharp from "sharp";

const DEFAULT_THUMB_WIDTH = 600;
const DEFAULT_PHOTOROOM_MAX_DIMENSION = 2048;
const OPENAI_VISION_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const SHARP_FORMAT_TO_MIME_TYPE: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export function normalizeImageMimeType(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const [mimeType] = trimmed.split(";", 1);
  return mimeType || null;
}

export function isSupportedOpenAiVisionImageMimeType(value: string | null | undefined): boolean {
  const normalized = normalizeImageMimeType(value);
  return normalized ? OPENAI_VISION_SUPPORTED_IMAGE_MIME_TYPES.has(normalized) : false;
}

export async function normalizeImageForOpenAiVision(input: Buffer): Promise<{
  buffer: Buffer;
  contentType: string;
  normalized: boolean;
  sourceFormat: string | null;
}> {
  const metadata = await sharp(input, { failOn: "none" }).metadata();
  const sourceFormat = typeof metadata.format === "string" ? metadata.format.toLowerCase() : null;
  const supportedMimeType =
    sourceFormat && Object.prototype.hasOwnProperty.call(SHARP_FORMAT_TO_MIME_TYPE, sourceFormat)
      ? SHARP_FORMAT_TO_MIME_TYPE[sourceFormat]
      : null;

  if (supportedMimeType && OPENAI_VISION_SUPPORTED_IMAGE_MIME_TYPES.has(supportedMimeType)) {
    return {
      buffer: input,
      contentType: supportedMimeType,
      normalized: false,
      sourceFormat,
    };
  }

  const buffer = await sharp(input, { failOn: "none" }).rotate().jpeg({ quality: 92 }).toBuffer();
  return {
    buffer,
    contentType: "image/jpeg",
    normalized: true,
    sourceFormat,
  };
}

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
