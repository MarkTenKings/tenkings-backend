import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getStorageMode, managedStorageKeyFromUrl, presignReadUrl } from "../../../../../lib/server/storage";

type ReferenceRow = {
  id: string;
  setId: string;
  parallelId: string;
  refType: string;
  pairKey: string | null;
  sourceListingId: string | null;
  playerSeed: string | null;
  storageKey: string | null;
  qaStatus: string;
  ownedStatus: string;
  promotedAt: string | null;
  sourceUrl: string | null;
  rawImageUrl: string;
  cropUrls: string[];
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
};

type ResponseBody =
  | { references: ReferenceRow[] }
  | { reference: ReferenceRow }
  | { ok: true }
  | { message: string };

function toRow(reference: any): ReferenceRow {
  return {
    id: reference.id,
    setId: reference.setId,
    parallelId: reference.parallelId,
    refType: String(reference.refType || "front"),
    pairKey: reference.pairKey ?? null,
    sourceListingId: reference.sourceListingId ?? null,
    playerSeed: reference.playerSeed ?? null,
    storageKey: reference.storageKey ?? null,
    qaStatus: String(reference.qaStatus || "pending"),
    ownedStatus: String(reference.ownedStatus || "external"),
    promotedAt: reference.promotedAt ? reference.promotedAt.toISOString?.() ?? String(reference.promotedAt) : null,
    sourceUrl: reference.sourceUrl ?? null,
    rawImageUrl: reference.rawImageUrl,
    cropUrls: Array.isArray(reference.cropUrls) ? reference.cropUrls : [],
    qualityScore: typeof reference.qualityScore === "number" ? reference.qualityScore : null,
    createdAt: reference.createdAt?.toISOString?.() ?? String(reference.createdAt),
    updatedAt: reference.updatedAt?.toISOString?.() ?? String(reference.updatedAt),
  };
}

function parseListingId(url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value) return null;
  const pathMatch = value.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = value.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

function keyFromStoredImage(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    return managedStorageKeyFromUrl(input);
  }
  return input;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const setId = typeof req.query.setId === "string" ? req.query.setId.trim() : "";
      const parallelId = typeof req.query.parallelId === "string" ? req.query.parallelId.trim() : "";
      const refType = typeof req.query.refType === "string" ? req.query.refType.trim().toLowerCase() : "";
      const take = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));

      const where: Record<string, any> = {};
      if (setId) where.setId = setId;
      if (parallelId) where.parallelId = parallelId;
      if (refType === "front" || refType === "back") where.refType = refType;

      let references: any[] = [];
      try {
        references = await prisma.cardVariantReferenceImage.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          take,
          select: ({
            id: true,
            setId: true,
            parallelId: true,
            refType: true,
            pairKey: true,
            sourceListingId: true,
            playerSeed: true,
            storageKey: true,
            qaStatus: true,
            ownedStatus: true,
            promotedAt: true,
            sourceUrl: true,
            rawImageUrl: true,
            cropUrls: true,
            qualityScore: true,
            createdAt: true,
            updatedAt: true,
          } as any),
        });
      } catch {
        // Backward-compatible fallback when storage/QA columns are not live yet.
        references = await prisma.cardVariantReferenceImage.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          take,
          select: ({
            id: true,
            setId: true,
            parallelId: true,
            refType: true,
            pairKey: true,
            sourceListingId: true,
            playerSeed: true,
            sourceUrl: true,
            rawImageUrl: true,
            cropUrls: true,
            qualityScore: true,
            createdAt: true,
            updatedAt: true,
          } as any),
        });
      }
      const mode = getStorageMode();
      const rows = await Promise.all(
        references.map(async (reference) => {
          const row = toRow(reference);
          if (mode === "s3") {
            const rawKey = row.storageKey || keyFromStoredImage(row.rawImageUrl);
            if (rawKey) {
              try {
                row.rawImageUrl = await presignReadUrl(rawKey, 60 * 30);
              } catch {
                // Keep persisted URL as fallback.
              }
            }
            if (Array.isArray(row.cropUrls) && row.cropUrls.length) {
              const signedCropUrls: string[] = [];
              for (const cropUrl of row.cropUrls) {
                const cropKey = keyFromStoredImage(cropUrl);
                if (!cropKey) {
                  signedCropUrls.push(cropUrl);
                  continue;
                }
                try {
                  signedCropUrls.push(await presignReadUrl(cropKey, 60 * 30));
                } catch {
                  signedCropUrls.push(cropUrl);
                }
              }
              row.cropUrls = signedCropUrls;
            }
          }
          return row;
        })
      );
      return res.status(200).json({ references: rows });
    }

    if (req.method === "POST") {
      const {
        setId,
        parallelId,
        refType,
        pairKey,
        sourceListingId,
        playerSeed,
        storageKey,
        rawImageUrl,
        sourceUrl,
        cropUrls,
        qualityScore,
      } = req.body ?? {};
      if (!setId || !parallelId || !rawImageUrl) {
        return res.status(400).json({ message: "Missing required fields." });
      }

      const normalizedRefType = String(refType || "front").trim().toLowerCase() === "back" ? "back" : "front";
      const normalizedSourceUrl = sourceUrl ? String(sourceUrl).trim() : null;
      const derivedListingId = sourceListingId
        ? String(sourceListingId).trim()
        : parseListingId(normalizedSourceUrl);
      const normalizedPairKey = pairKey
        ? String(pairKey).trim()
        : derivedListingId
        ? `${String(setId).trim()}::${String(parallelId).trim()}::${derivedListingId}`
        : null;

      let reference: any;
      try {
        reference = await prisma.cardVariantReferenceImage.create({
          data: ({
            setId: String(setId).trim(),
            parallelId: String(parallelId).trim(),
            refType: normalizedRefType,
            pairKey: normalizedPairKey,
            sourceListingId: derivedListingId,
            playerSeed: playerSeed ? String(playerSeed).trim() : null,
            storageKey: storageKey ? String(storageKey).trim() : null,
            qaStatus: "pending",
            ownedStatus: storageKey ? "owned" : "external",
            promotedAt: storageKey ? new Date() : null,
            rawImageUrl: String(rawImageUrl).trim(),
            sourceUrl: normalizedSourceUrl,
            cropUrls: Array.isArray(cropUrls)
              ? cropUrls.map((entry: unknown) => String(entry).trim()).filter(Boolean)
              : [],
            qualityScore: typeof qualityScore === "number" ? qualityScore : null,
          } as any),
        });
      } catch {
        // Backward-compatible fallback when storageKey column/schema is not live.
        reference = await prisma.cardVariantReferenceImage.create({
          data: ({
            setId: String(setId).trim(),
            parallelId: String(parallelId).trim(),
            refType: normalizedRefType,
            pairKey: normalizedPairKey,
            sourceListingId: derivedListingId,
            playerSeed: playerSeed ? String(playerSeed).trim() : null,
            rawImageUrl: String(rawImageUrl).trim(),
            sourceUrl: normalizedSourceUrl,
            cropUrls: Array.isArray(cropUrls)
              ? cropUrls.map((entry: unknown) => String(entry).trim()).filter(Boolean)
              : [],
            qualityScore: typeof qualityScore === "number" ? qualityScore : null,
          } as any),
        });
      }
      return res.status(200).json({ reference: toRow(reference) });
    }

    if (req.method === "PUT") {
      const qaStatusRaw = req.body?.qaStatus;
      const qaStatus =
        qaStatusRaw === "keep" || qaStatusRaw === "reject" || qaStatusRaw === "pending"
          ? qaStatusRaw
          : null;
      if (!qaStatus) {
        return res.status(400).json({ message: "qaStatus must be keep, reject, or pending." });
      }

      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((value: unknown) => String(value || "").trim()).filter(Boolean)
        : [];
      const targetIds = id ? [id] : ids;
      if (!targetIds.length) {
        return res.status(400).json({ message: "id or ids[] is required." });
      }
      try {
        await prisma.cardVariantReferenceImage.updateMany({
          where: { id: { in: targetIds } },
          data: { qaStatus } as any,
        });
      } catch {
        return res.status(400).json({ message: "QA status columns not available yet. Run latest database migrations." });
      }
      const references = await prisma.cardVariantReferenceImage.findMany({
        where: { id: { in: targetIds } },
      });
      return res.status(200).json({ references: references.map(toRow) } as any);
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) {
        return res.status(400).json({ message: "Missing reference id." });
      }
      await prisma.cardVariantReferenceImage.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
