import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";
import { uploadBuffer, normalizeStorageUrl, readStorageBuffer } from "../../../../../lib/server/storage";
import { buildSiteUrl } from "../../../../../lib/server/urls";
import { photoroomQueue } from "../../../../../lib/server/queues";

const PHOTOROOM_ENDPOINT = "https://image-api.photoroom.com/v2/edit";

type ResponseBody =
  | {
      processed: number;
      skipped: number;
      updatedIds: string[];
      message: string;
    }
  | { message: string };

async function runPhotoroom(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const form = new FormData();
  const blob = new Blob([buffer], { type: "image/png" });
  form.append("imageFile", blob, "variant-ref.png");
  form.append("removeBackground", "true");
  form.append("padding", "0.04");
  form.append("scaling", "fit");
  form.append("outputSize", "croppedSubject");
  form.append("export.format", "png");
  form.append("background.color", "transparent");

  const response = await fetch(PHOTOROOM_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "image/png, application/json",
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`PhotoRoom failed (${response.status}): ${text}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function asAbsolute(url: string) {
  return /^https?:\/\//i.test(url) ? url : buildSiteUrl(url);
}

export default withAdminCors(async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const apiKey = String(process.env.PHOTOROOM_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(200).json({ processed: 0, skipped: 0, updatedIds: [], message: "PhotoRoom not configured" });
    }

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    if (!ids.length) {
      return res.status(400).json({ message: "ids[] is required" });
    }

    const refs = await prisma.cardVariantReferenceImage.findMany({
      where: { id: { in: ids } },
      select: ({
        id: true,
        setId: true,
        parallelId: true,
        refType: true,
        storageKey: true,
        rawImageUrl: true,
        cropUrls: true,
      } as any),
    });

    let processed = 0;
    let skipped = 0;
    const updatedIds: string[] = [];

    await photoroomQueue.run(async () => {
      for (const ref of refs) {
        try {
          let sourceBuffer: Buffer | null = null;
          if (ref.storageKey) {
            sourceBuffer = await readStorageBuffer(ref.storageKey).catch(() => null);
          }
          if (!sourceBuffer) {
            const sourceUrl = ref.cropUrls?.[0] || ref.rawImageUrl;
            if (!sourceUrl) {
              skipped += 1;
              continue;
            }
            const response = await fetch(asAbsolute(sourceUrl));
            if (!response.ok) {
              skipped += 1;
              continue;
            }
            sourceBuffer = Buffer.from(await response.arrayBuffer());
          }
          const processedBuffer = await runPhotoroom(sourceBuffer, apiKey);
          const storageKey = `variants/${ref.setId}/${ref.parallelId}/processed/${ref.refType || "front"}-${Date.now()}-${crypto
            .randomUUID()
            .slice(0, 8)}.png`;
          const uploaded = await uploadBuffer(storageKey, processedBuffer, "image/png");
          const normalized = normalizeStorageUrl(uploaded) ?? uploaded;
          const absolute = asAbsolute(normalized);
          const nextCropUrls = [absolute, ...(Array.isArray(ref.cropUrls) ? ref.cropUrls.filter(Boolean) : [])].slice(0, 6);
          await prisma.cardVariantReferenceImage.update({
            where: { id: ref.id },
            data: {
              cropUrls: nextCropUrls,
              qualityScore: null,
              cropEmbeddings: Prisma.JsonNull,
            },
          });
          processed += 1;
          updatedIds.push(ref.id);
        } catch {
          skipped += 1;
        }
      }
    });

    return res.status(200).json({ processed, skipped, updatedIds, message: "Processed selected references" });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
});
