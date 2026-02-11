import sharp from "sharp";
import { createSpacesUploader } from "../storage/spaces";

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
  const resized = sharp(buffer).rotate().resize(256, 256, { fit: "inside" });
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

async function normalizeCard(buffer: Buffer) {
  const cornerService = process.env.VARIANT_CORNER_URL;
  if (cornerService) {
    try {
      const response = await fetch(cornerService, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: "inline", imageBase64: buffer.toString("base64") }),
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.normalizedBase64) {
          const normalizedBuffer = Buffer.from(String(payload.normalizedBase64), "base64");
          return sharp(normalizedBuffer).rotate().resize(800, 1100, { fit: "fill" });
        }
        if (payload?.normalizedUrl) {
          const normalized = await fetch(payload.normalizedUrl);
          if (normalized.ok) {
            const normalizedBuffer = Buffer.from(await normalized.arrayBuffer());
            return sharp(normalizedBuffer).rotate().resize(800, 1100, { fit: "fill" });
          }
        }
      }
    } catch {
      // fallback to heuristic bounds
    }
  }
  const bounds = await detectCardBounds(buffer);
  if (!bounds) {
    return sharp(buffer).rotate().resize(800, 1100, { fit: "inside" });
  }

  const base = sharp(buffer).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    return sharp(buffer).rotate().resize(800, 1100, { fit: "inside" });
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

export async function computeReferenceEmbeddings(params: {
  imageUrl: string;
  referenceId: string;
}): Promise<ReferenceEmbeddingResult> {
  const { imageUrl, referenceId } = params;
  let buffer: Buffer | null = null;
  const loadBuffer = async () => {
    if (buffer) return buffer;
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return null;
    }
    buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  };
  try {
    const embeddingService = process.env.VARIANT_EMBEDDING_URL;
    if (embeddingService) {
      const response = await fetch(embeddingService, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, mode: "reference", referenceId }),
      });
      if (response.ok) {
        const payload = await response.json();
        const serviceEmbeddings = Array.isArray(payload?.embeddings) ? payload.embeddings : [];
        const serviceCropUrls = Array.isArray(payload?.cropUrls) ? payload.cropUrls : [];
        if (serviceEmbeddings.length > 0 && serviceCropUrls.length === 0) {
          // We got embeddings but no crops; fall back to local crop generation for previews.
          const localBuffer = await loadBuffer();
          if (localBuffer) {
            const local = await computeReferenceEmbeddingsLocal(localBuffer, referenceId);
            return {
              cropUrls: local.cropUrls,
              embeddings: serviceEmbeddings,
            };
          }
          return {
            cropUrls: [],
            embeddings: serviceEmbeddings,
          };
        }
        if (serviceCropUrls.length > 0) {
          return {
            cropUrls: serviceCropUrls,
            embeddings: serviceEmbeddings,
          };
        }
      }
    }

    const localBuffer = await loadBuffer();
    if (!localBuffer) {
      return { cropUrls: [], embeddings: [] };
    }
    return await computeReferenceEmbeddingsLocal(localBuffer, referenceId);
  } catch {
    return { cropUrls: [], embeddings: [] };
  }
}

async function computeReferenceEmbeddingsLocal(buffer: Buffer, referenceId: string): Promise<ReferenceEmbeddingResult> {
  try {
    const image = await normalizeCard(buffer);
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
      const cropBuffer = await image
        .extract({
          left: crop.left,
          top: crop.top,
          width: crop.width,
          height: crop.height,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      const key = `reference/${referenceId}/${crop.label}.jpg`;
      const uploaded = await upload(cropBuffer, key, "image/jpeg");
      cropUrls.push(uploaded.url);
    }

    return { cropUrls, embeddings: [] };
  } catch {
    return { cropUrls: [], embeddings: [] };
  }
}
