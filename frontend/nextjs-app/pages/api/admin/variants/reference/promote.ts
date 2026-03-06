import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";
import {
  uploadBuffer,
  normalizeStorageUrl,
  readStorageBuffer,
  managedStorageKeyFromUrl,
  getPublicPrefix,
  normalizeStorageKeyCandidate,
} from "../../../../../lib/server/storage";
import { buildSiteUrl } from "../../../../../lib/server/urls";

type ResponseBody =
  | {
      promoted: number;
      alreadyOwned: number;
      skipped: number;
      ids: string[];
      message: string;
    }
  | { message: string };

function asAbsolute(url: string) {
  return /^https?:\/\//i.test(url) ? url : buildSiteUrl(url);
}

function keyFromPublicPath(pathname: string) {
  const normalizedPath = normalizeStorageKeyCandidate(pathname);
  if (!normalizedPath) return null;
  const publicPrefix = getPublicPrefix()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (publicPrefix && normalizedPath.startsWith(`${publicPrefix}/`)) {
    return normalizedPath.slice(publicPrefix.length + 1);
  }
  return null;
}

function toManagedKey(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    const managedFromUrl = managedStorageKeyFromUrl(input);
    if (managedFromUrl) return managedFromUrl;
    try {
      const parsed = new URL(input);
      return keyFromPublicPath(parsed.pathname);
    } catch {
      return null;
    }
  }
  const fromPublicPath = keyFromPublicPath(input);
  if (fromPublicPath) return fromPublicPath;
  return input.replace(/^\/+/, "");
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
    let alreadyOwned = 0;
    let skipped = 0;
    const promotedIds: string[] = [];

    for (const ref of refs) {
      try {
        const currentKey = toManagedKey((ref as any).storageKey ? String((ref as any).storageKey).trim() : "");
        const currentBuffer = currentKey ? await readStorageBuffer(currentKey).catch(() => null) : null;
        if (currentBuffer) {
          await prisma.cardVariantReferenceImage.update({
            where: { id: ref.id },
            data: {
              qaStatus: "keep",
              ownedStatus: "owned",
              storageKey: currentKey,
            } as any,
          });
          alreadyOwned += 1;
          promotedIds.push(ref.id);
          continue;
        }

        let sourceBuffer: Buffer | null = null;
        const sourceCandidates = [
          ...(Array.isArray(ref.cropUrls) ? ref.cropUrls : []),
          String(ref.rawImageUrl || "").trim(),
        ]
          .map((entry) => String(entry || "").trim())
          .filter(Boolean);

        for (const sourceCandidate of sourceCandidates) {
          if (sourceBuffer) break;

          const managedKey = toManagedKey(sourceCandidate);
          if (managedKey) {
            sourceBuffer = await readStorageBuffer(managedKey).catch(() => null);
            if (sourceBuffer) break;
          }

          const response = await fetch(asAbsolute(sourceCandidate)).catch(() => null);
          if (!response?.ok) continue;
          sourceBuffer = Buffer.from(await response.arrayBuffer());
        }

        if (!sourceBuffer) {
          skipped += 1;
          continue;
        }

        const storageKey = `variants/${ref.setId}/${String((ref as any).programId || "base").trim()}/${ref.parallelId}/owned/${
          (ref as any).refType || "front"
        }-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
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
      alreadyOwned,
      skipped,
      ids: promotedIds,
      message: "Promotion complete",
    });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
});
