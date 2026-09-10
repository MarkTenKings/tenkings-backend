import sharp from "sharp";
import { createSpacesUploader } from "../storage/spaces";
import { fetchReferenceBytes, fetchReferenceJson, REFERENCE_IMAGE_MAX_BYTES, REFERENCE_REQUEST_TIMEOUT_MS } from "./request";

const openImage = (buffer: Buffer) => sharp(buffer, { limitInputPixels: 32_000_000 }).timeout({ seconds: 10 });

export type CropEmbedding = {
  cropUrl: string;
  vector: number[];
};

export type ReferenceEmbeddingResult = {
  cropUrls: string[];
  embeddings: CropEmbedding[];
};

type CropSpec = {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

function buildCrops(width: number, height: number): CropSpec[] {
  const stripH = Math.max(40, Math.round(height * 0.12));
  const stripW = Math.max(40, Math.round(width * 0.12));
  const centerW = Math.max(80, Math.round(width * 0.4));
  const centerH = Math.max(80, Math.round(height * 0.4));

  const crops: CropSpec[] = [
    { label: "top", left: 0, top: 0, width, height: stripH },
    { label: "bottom", left: 0, top: Math.max(0, height - stripH), width, height: stripH },
    { label: "left", left: 0, top: 0, width: stripW, height },
    { label: "right", left: Math.max(0, width - stripW), top: 0, width: stripW, height },
    {
      label: "center",
      left: Math.max(0, Math.round(width * 0.3)),
      top: Math.max(0, Math.round(height * 0.3)),
      width: centerW,
      height: centerH,
    },
    {
      label: "stamp",
      left: Math.max(0, Math.round(width * 0.6)),
      top: Math.max(0, Math.round(height * 0.6)),
      width: Math.max(60, Math.round(width * 0.3)),
      height: Math.max(60, Math.round(height * 0.3)),
    },
  ];

  return crops.filter((crop) => crop.width > 0 && crop.height > 0);
}

async function detectCardBounds(buffer: Buffer) {
  const resized = openImage(buffer).rotate().resize(256, 256, { fit: "inside" });
  const { data, info } = await resized.greyscale().raw().toBuffer({ resolveWithObject: true });

  const threshold = 230;
  let minX = info.width;
  let minY = info.height;
  let maxX = 0;
  let maxY = 0;
  let found = false;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = y * info.width + x;
      const value = data[idx] ?? 255;
      if (value < threshold) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    resizedWidth: info.width,
    resizedHeight: info.height,
  };
}

async function normalizeCard(buffer: Buffer, signal?: AbortSignal) {
  const cornerService = process.env.VARIANT_CORNER_URL;
  if (cornerService) {
    try {
      const payload = await fetchReferenceJson(cornerService, {
        method: "POST",
        signal,
        maxBytes: REFERENCE_IMAGE_MAX_BYTES,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: "inline", imageBase64: buffer.toString("base64") }),
      }) as { normalizedBase64?: string; normalizedUrl?: string };
      if (typeof payload?.normalizedBase64 === "string") {
        return openImage(Buffer.from(payload.normalizedBase64, "base64")).rotate().resize(800, 1100, { fit: "fill" });
      }
      if (typeof payload?.normalizedUrl === "string") {
        const normalized = await fetchReferenceBytes(payload.normalizedUrl, { signal });
        return openImage(normalized).rotate().resize(800, 1100, { fit: "fill" });
      }
    } catch {
      // fallback to heuristic bounds
    }
  }
  signal?.throwIfAborted();
  const bounds = await detectCardBounds(buffer);
  if (!bounds) {
    return openImage(buffer).rotate().resize(800, 1100, { fit: "inside" });
  }

  const base = openImage(buffer).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    return openImage(buffer).rotate().resize(800, 1100, { fit: "inside" });
  }

  const scaleX = width / bounds.resizedWidth;
  const scaleY = height / bounds.resizedHeight;
  const left = Math.max(0, Math.round(bounds.minX * scaleX));
  const top = Math.max(0, Math.round(bounds.minY * scaleY));
  const cropWidth = Math.min(width - left, Math.round((bounds.maxX - bounds.minX) * scaleX));
  const cropHeight = Math.min(height - top, Math.round((bounds.maxY - bounds.minY) * scaleY));

  return base.extract({ left, top, width: cropWidth, height: cropHeight }).resize(800, 1100, {
    fit: "fill",
  });
}

export function hasUsableEmbeddings(value: unknown): value is CropEmbedding[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every((entry) =>
    entry && typeof entry.cropUrl === "string" && entry.cropUrl.length > 0 && entry.cropUrl.length <= 4096 &&
    Array.isArray(entry.vector) && entry.vector.length > 0 && entry.vector.length <= 8192 &&
    entry.vector.every((v: unknown) => typeof v === "number" && Number.isFinite(v)) &&
    entry.vector.some((v: number) => v !== 0)
  );
}

export async function computeReferenceEmbeddings(params: {
  imageUrl: string;
  referenceId: string;
  loadImage?: () => Promise<Buffer>;
  signal?: AbortSignal;
}): Promise<ReferenceEmbeddingResult> {
  const empty = { cropUrls: [], embeddings: [] };
  const embeddingService = process.env.VARIANT_EMBEDDING_URL?.trim();
  if (!embeddingService) return empty;
  const { imageUrl, referenceId, signal } = params;
  try {
    const payload = await fetchReferenceJson(embeddingService, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, mode: "reference", referenceId }),
    }) as { embeddings?: unknown; cropUrls?: unknown };
    // Empty/invalid provider output is deferred before downloading an original or uploading crops.
    if (!hasUsableEmbeddings(payload?.embeddings)) return empty;
    const cropUrls = Array.isArray(payload.cropUrls) && payload.cropUrls.length <= 16 &&
      payload.cropUrls.every((url: unknown) => typeof url === "string" && url.length > 0 && url.length <= 4096)
      ? payload.cropUrls as string[] : [];
    if (cropUrls.length) return { cropUrls, embeddings: payload.embeddings };
    const buffer = await (params.loadImage?.() ?? fetchReferenceBytes(imageUrl, { signal }));
    const local = await computeReferenceEmbeddingsLocal(buffer, referenceId, signal);
    return { cropUrls: local.cropUrls, embeddings: payload.embeddings };
  } catch {
    return empty;
  }
}

async function computeReferenceEmbeddingsLocal(buffer: Buffer, referenceId: string, signal?: AbortSignal): Promise<ReferenceEmbeddingResult> {
  try {
    signal?.throwIfAborted();
    const normalized = await normalizeCard(buffer, signal);
    const image = openImage(await normalized.toBuffer());
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height) {
      return { cropUrls: [], embeddings: [] };
    }

    let upload;
    try {
      upload = createSpacesUploader();
    } catch {
      upload = null;
    }

    if (!upload) {
      return { cropUrls: [], embeddings: [] };
    }

    const crops = buildCrops(width, height);
    const cropUrls: string[] = [];

    for (const crop of crops) {
      signal?.throwIfAborted();
      const cropBuffer = await image.clone()
        .extract({
          left: crop.left,
          top: crop.top,
          width: crop.width,
          height: crop.height,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      const key = `reference/${referenceId}/${crop.label}.jpg`;
      const uploaded = await upload(cropBuffer, key, "image/jpeg", signal ?? AbortSignal.timeout(REFERENCE_REQUEST_TIMEOUT_MS));
      cropUrls.push(uploaded.url);
    }

    return { cropUrls, embeddings: [] };
  } catch {
    return { cropUrls: [], embeddings: [] };
  }
}
