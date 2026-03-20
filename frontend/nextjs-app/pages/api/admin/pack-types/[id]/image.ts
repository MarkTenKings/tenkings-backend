import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";
import Busboy from "busboy";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { uploadBuffer } from "../../../../../lib/server/storage";
import { serializePackType } from "../../../../../lib/server/packTypes";
import { withAdminCors } from "../../../../../lib/server/cors";
import { PACK_TYPE_IMAGE_MAX_BYTES } from "../../../../../lib/adminPackTypes";

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "6mb",
  },
};

type ResponseBody =
  | {
      imageUrl: string;
      packType: ReturnType<typeof serializePackType>;
    }
  | { message: string };

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function sanitizeFileName(input: string) {
  const normalized = input.trim().toLowerCase();
  const base = normalized.replace(/[^a-z0-9_.-]+/g, "-");
  const collapsed = base.replace(/-+/g, "-");
  return collapsed.replace(/^-|-$/g, "") || "pack-type";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return "";
}

async function parseImageUpload(req: NextApiRequest) {
  const bb = Busboy({
    headers: req.headers,
    limits: {
      files: 1,
      fileSize: PACK_TYPE_IMAGE_MAX_BYTES,
    },
  });

  let filename = "";
  let mimeType = "";
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    bb.on("file", (fieldName, file, info) => {
      if (fieldName !== "image") {
        file.resume();
        return;
      }

      filename = info.filename || "pack-type";
      mimeType = info.mimeType || "";

      file.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      file.on("limit", () => reject(new Error("Pack image must be 5MB or smaller.")));
      file.on("error", (error) => reject(error));
    });
    bb.on("error", (error) => reject(error));
    bb.on("finish", () => resolve());
    req.pipe(bb);
  });

  if (!chunks.length) {
    throw new Error("Pack image file is required.");
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("Pack image must be a JPG, PNG, or WebP file.");
  }

  return {
    filename,
    mimeType,
    buffer: Buffer.concat(chunks),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!id) {
      return res.status(400).json({ message: "Pack type id is required" });
    }

    const existing = await prisma.packDefinition.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ message: "Pack type not found" });
    }

    const upload = await parseImageUpload(req);
    const sanitizedBase = sanitizeFileName(upload.filename);
    const extension = path.extname(sanitizedBase) || extensionForMimeType(upload.mimeType);
    const fileName = extension ? `${path.basename(sanitizedBase, extension)}${extension}` : sanitizedBase;
    const storageKey = `pack-types/${id}/${Date.now()}-${fileName}`;
    const imageUrl = await uploadBuffer(storageKey, upload.buffer, upload.mimeType, {
      cacheControl: "public, max-age=31536000, immutable",
    });

    const packType = await prisma.packDefinition.update({
      where: { id },
      data: { imageUrl },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        tier: true,
        imageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      imageUrl,
      packType: serializePackType(packType),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
