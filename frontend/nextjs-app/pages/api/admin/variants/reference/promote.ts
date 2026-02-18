import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";
import { uploadBuffer, normalizeStorageUrl, readStorageBuffer, managedStorageKeyFromUrl } from "../../../../../lib/server/storage";
import { buildSiteUrl } from "../../../../../lib/server/urls";

type ResponseBody =
  | {
      promoted: number;
      skipped: number;
      ids: string[];
      message: string;
    }
  | { message: string };

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
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((value: unknown) => String(value || "").trim()).filter(Boolean)
      : [];
    if (!ids.length) {
      return res.status(400).json({ message: "ids[] is required" });
    }

    const refs = await prisma.cardVariantReferenceImage.findMany({
      where: { id: { in: ids } },
      orderBy: [{ updatedAt: "desc" }],
    });

    let promoted = 0;
    let skipped = 0;
    const promotedIds: string[] = [];

    for (const ref of refs) {
      try {
        const currentKey = (ref as any).storageKey ? String((ref as any).storageKey).trim() : "";
        if (currentKey) {
          await prisma.cardVariantReferenceImage.update({
            where: { id: ref.id },
            data: {
              qaStatus: "keep",
              ownedStatus: "owned",
            } as any,
          });
          promoted += 1;
          promotedIds.push(ref.id);
          continue;
        }

        let sourceBuffer: Buffer | null = null;
        const managedRawKey = managedStorageKeyFromUrl(ref.rawImageUrl);
        if (managedRawKey) {
          sourceBuffer = await readStorageBuffer(managedRawKey).catch(() => null);
        }

        if (!sourceBuffer) {
          const sourceUrl = ref.cropUrls?.[0] || ref.rawImageUrl;
          const response = await fetch(asAbsolute(sourceUrl));
          if (!response.ok) {
            skipped += 1;
            continue;
          }
          sourceBuffer = Buffer.from(await response.arrayBuffer());
        }

        const storageKey = `variants/${ref.setId}/${ref.parallelId}/owned/${(ref as any).refType || "front"}-${Date.now()}-${crypto
          .randomUUID()
          .slice(0, 8)}.png`;
        const uploadedUrl = await uploadBuffer(storageKey, sourceBuffer, "image/png");
        const normalized = normalizeStorageUrl(uploadedUrl) ?? uploadedUrl;
        const absolute = asAbsolute(normalized);

        await prisma.cardVariantReferenceImage.update({
          where: { id: ref.id },
          data: {
            storageKey,
            rawImageUrl: absolute,
            cropUrls: [absolute],
            qaStatus: "keep",
            ownedStatus: "owned",
            promotedAt: new Date(),
            qualityScore: null,
            cropEmbeddings: Prisma.JsonNull,
          } as any,
        });
        promoted += 1;
        promotedIds.push(ref.id);
      } catch {
        skipped += 1;
      }
    }

    return res.status(200).json({
      promoted,
      skipped,
      ids: promotedIds,
      message: "Promotion complete",
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
});
