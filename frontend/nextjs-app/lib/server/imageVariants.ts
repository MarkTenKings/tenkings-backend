import sharp from "sharp";
import { getStorageMode, publicUrlFor, uploadBuffer } from "./storage";

const VARIANT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const THUMB_WIDTH = 400;

export interface ImageVariantResult {
  hdUrl: string;
  thumbUrl: string;
  hdSize: number;
  thumbSize: number;
}

function normalizeStoragePath(storagePath: string) {
  const normalized = String(storagePath || "").trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("storagePath is required");
  }
  return normalized;
}

export async function generateAndUploadVariants(
  originalBuffer: Buffer,
  storagePath: string
): Promise<ImageVariantResult> {
  if (getStorageMode() !== "s3") {
    throw new Error("CDN image variants are only supported in s3 storage mode");
  }

  const normalizedPath = normalizeStoragePath(storagePath);
  const pipeline = sharp(originalBuffer, { failOn: "none" }).rotate();

  const [hdBuffer, thumbBuffer] = await Promise.all([
    pipeline.clone().webp({ quality: 85 }).toBuffer(),
    pipeline
      .clone()
      .resize({
        width: THUMB_WIDTH,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer(),
  ]);

  const hdKey = `${normalizedPath}/hd.webp`;
  const thumbKey = `${normalizedPath}/thumb.webp`;

  await Promise.all([
    uploadBuffer(hdKey, hdBuffer, "image/webp", { cacheControl: VARIANT_CACHE_CONTROL }),
    uploadBuffer(thumbKey, thumbBuffer, "image/webp", { cacheControl: VARIANT_CACHE_CONTROL }),
  ]);

  return {
    hdUrl: publicUrlFor(hdKey),
    thumbUrl: publicUrlFor(thumbKey),
    hdSize: hdBuffer.length,
    thumbSize: thumbBuffer.length,
  };
}
