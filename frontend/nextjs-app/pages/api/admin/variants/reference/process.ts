import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";
import {
  uploadBuffer,
  managedStorageKeyFromUrl,
  normalizeStorageUrl,
  readStorageBuffer,
} from "../../../../../lib/server/storage";
import { buildSiteUrl } from "../../../../../lib/server/urls";
import { photoroomQueue } from "../../../../../lib/server/queues";
import { normalizeProgramId } from "../../../../../lib/server/taxonomyV2Utils";

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

function toManagedKey(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    return managedStorageKeyFromUrl(input);
  }
  return input;
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

    const setId = String(req.body?.setId || "").trim();
    const programId = String(req.body?.programId || "").trim();
    const parallelId = String(req.body?.parallelId || "").trim();
    const cardNumber = String(req.body?.cardNumber || "").trim();
    const scopedMode = Boolean(setId && parallelId);
    if (!ids.length && !scopedMode) {
      return res.status(400).json({ message: "Provide ids[] or scope (setId + parallelId)." });
    }

    let refs: any[] = [];
    const normalizedProgramId = normalizeProgramId(programId || "base");
    const normalizedCardNumber = cardNumber || "ALL";
    const scopeWhere = {
      setId,
      programId: normalizedProgramId,
      parallelId,
      OR: [{ cardNumber: normalizedCardNumber }, { cardNumber: "ALL" }, { cardNumber: null }],
    };
    const where = ids.length
      ? { id: { in: ids } }
      : scopeWhere;
    try {
      refs = await prisma.cardVariantReferenceImage.findMany({
        where: where as any,
        select: ({
          id: true,
          setId: true,
          programId: true,
          parallelId: true,
          refType: true,
          storageKey: true,
          rawImageUrl: true,
          cropUrls: true,
        } as any),
        orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }],
        take: ids.length ? undefined : 500,
      });
    } catch {
      // Backward-compatible fallback when storageKey column/schema is not live.
      refs = await prisma.cardVariantReferenceImage.findMany({
        where: (ids.length ? { id: { in: ids } } : { setId, parallelId }) as any,
        select: ({
          id: true,
          setId: true,
          parallelId: true,
          refType: true,
          rawImageUrl: true,
          cropUrls: true,
        } as any),
        orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }],
        take: ids.length ? undefined : 500,
      });
    }

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
            const sourceCandidate = String(ref.cropUrls?.[0] || ref.rawImageUrl || "").trim();
            if (!sourceCandidate) {
              skipped += 1;
              continue;
            }
            const sourceKey = toManagedKey(sourceCandidate);
            if (sourceKey) {
              sourceBuffer = await readStorageBuffer(sourceKey).catch(() => null);
            }
            if (!sourceBuffer) {
              const response = await fetch(asAbsolute(sourceCandidate));
              if (!response.ok) {
                skipped += 1;
                continue;
              }
              sourceBuffer = Buffer.from(await response.arrayBuffer());
            }
          }
          const processedBuffer = await runPhotoroom(sourceBuffer, apiKey);
          const refProgramId = normalizeProgramId(String((ref as any).programId || normalizedProgramId || "base").trim());
          const storageKey = `variants/${ref.setId}/${refProgramId}/${ref.parallelId}/processed/${
            ref.refType || "front"
          }-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
          const uploaded = await uploadBuffer(storageKey, processedBuffer, "image/png");
          const normalizedUploaded = normalizeStorageUrl(uploaded) ?? uploaded;
          const cropUrl = asAbsolute(normalizedUploaded);
          const existingCropUrls = Array.isArray((ref as any).cropUrls)
            ? ((ref as any).cropUrls as string[]).filter(Boolean)
            : [];
          const nextCropUrls = [
            cropUrl,
            ...existingCropUrls.filter((entry) => entry !== cropUrl && entry !== storageKey),
          ].slice(0, 6);
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
