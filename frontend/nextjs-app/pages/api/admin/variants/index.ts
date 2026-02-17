import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getStorageMode, presignReadUrl } from "../../../../lib/server/storage";

type VariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
  keywords: string[];
  oddsInfo: string | null;
  referenceCount: number;
  previewImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type ResponseBody =
  | { variants: VariantRow[] }
  | { variant: VariantRow }
  | { ok: true }
  | { message: string };

function toRow(
  variant: any,
  extras?: {
    referenceCount?: number;
    previewImageUrl?: string | null;
  }
): VariantRow {
  return {
    id: variant.id,
    setId: variant.setId,
    cardNumber: variant.cardNumber,
    parallelId: variant.parallelId,
    parallelFamily: variant.parallelFamily ?? null,
    keywords: Array.isArray(variant.keywords) ? variant.keywords : [],
    oddsInfo: variant.oddsInfo ?? null,
    referenceCount: Math.max(0, Number(extras?.referenceCount ?? 0) || 0),
    previewImageUrl: extras?.previewImageUrl ?? null,
    createdAt: variant.createdAt?.toISOString?.() ?? String(variant.createdAt),
    updatedAt: variant.updatedAt?.toISOString?.() ?? String(variant.updatedAt),
  };
}

function storageKeyFromUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    return pathname || null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const take = Math.min(2000, Math.max(1, Number(req.query.limit ?? 1000) || 1000));
      const where = q
        ? {
            OR: [
              { setId: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { cardNumber: { contains: q, mode: Prisma.QueryMode.insensitive } },
              { parallelId: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {};

      const variants = await prisma.cardVariant.findMany({
        where,
        orderBy: [{ setId: "asc" }, { cardNumber: "asc" }, { parallelId: "asc" }],
        take,
      });
      const keys = variants.map((variant) => ({ setId: variant.setId, parallelId: variant.parallelId }));
      const referenceCounts = keys.length
        ? await prisma.cardVariantReferenceImage.groupBy({
            by: ["setId", "parallelId"],
            where: { OR: keys },
            _count: { _all: true },
          })
        : [];
      let latestRefs: any[] = [];
      if (keys.length) {
        try {
          latestRefs = await prisma.cardVariantReferenceImage.findMany({
            where: { OR: keys },
            orderBy: [{ updatedAt: "desc" }],
            distinct: ["setId", "parallelId"],
            select: ({
              setId: true,
              parallelId: true,
              storageKey: true,
              cropUrls: true,
              rawImageUrl: true,
            } as any),
          });
        } catch {
          // Backward-compatible fallback when storageKey column/schema is not live.
          latestRefs = await prisma.cardVariantReferenceImage.findMany({
            where: { OR: keys },
            orderBy: [{ updatedAt: "desc" }],
            distinct: ["setId", "parallelId"],
            select: ({
              setId: true,
              parallelId: true,
              cropUrls: true,
              rawImageUrl: true,
            } as any),
          });
        }
      }

      const countByKey = new Map<string, number>();
      for (const row of referenceCounts) {
        countByKey.set(`${row.setId}::${row.parallelId}`, row._count._all);
      }
      const previewByKey = new Map<string, string>();
      const mode = getStorageMode();
      for (const row of latestRefs) {
        const cropUrls = Array.isArray((row as any).cropUrls) ? ((row as any).cropUrls as string[]) : [];
        const rawImageUrl = String((row as any).rawImageUrl || "");
        const storageKey = String((row as any).storageKey || "").trim();
        let preview = cropUrls[0] || rawImageUrl;
        const keyForPreview = storageKey || storageKeyFromUrl(preview);
        if (mode === "s3" && keyForPreview) {
          try {
            preview = await presignReadUrl(keyForPreview, 60 * 30);
          } catch {
            // Keep persisted URL fallback.
          }
        }
        if (!preview) continue;
        previewByKey.set(`${row.setId}::${row.parallelId}`, preview);
      }

      return res.status(200).json({
        variants: variants.map((variant) => {
          const key = `${variant.setId}::${variant.parallelId}`;
          return toRow(variant, {
            referenceCount: countByKey.get(key) ?? 0,
            previewImageUrl: previewByKey.get(key) ?? null,
          });
        }),
      });
    }

    if (req.method === "POST") {
      const { setId, cardNumber, parallelId, parallelFamily, keywords, oddsInfo } = req.body ?? {};
      if (!setId || !cardNumber || !parallelId) {
        return res.status(400).json({ message: "Missing required fields." });
      }
      const variant = await prisma.cardVariant.create({
        data: {
          setId: String(setId).trim(),
          cardNumber: String(cardNumber).trim(),
          parallelId: String(parallelId).trim(),
          parallelFamily: parallelFamily ? String(parallelFamily).trim() : null,
          keywords: Array.isArray(keywords)
            ? keywords.map((entry: unknown) => String(entry).trim()).filter(Boolean)
            : [],
          oddsInfo: oddsInfo ? String(oddsInfo).trim() : null,
        },
      });
      return res.status(200).json({ variant: toRow(variant) });
    }

    if (req.method === "PUT") {
      const { id, setId, cardNumber, parallelId, parallelFamily, keywords, oddsInfo } = req.body ?? {};
      if (!id) {
        return res.status(400).json({ message: "Missing variant id." });
      }
      const variant = await prisma.cardVariant.update({
        where: { id: String(id) },
        data: {
          ...(setId ? { setId: String(setId).trim() } : {}),
          ...(cardNumber ? { cardNumber: String(cardNumber).trim() } : {}),
          ...(parallelId ? { parallelId: String(parallelId).trim() } : {}),
          ...(parallelFamily !== undefined
            ? { parallelFamily: parallelFamily ? String(parallelFamily).trim() : null }
            : {}),
          ...(keywords !== undefined
            ? {
                keywords: Array.isArray(keywords)
                  ? keywords.map((entry: unknown) => String(entry).trim()).filter(Boolean)
                  : [],
              }
            : {}),
          ...(oddsInfo !== undefined ? { oddsInfo: oddsInfo ? String(oddsInfo).trim() : null } : {}),
        },
      });
      return res.status(200).json({ variant: toRow(variant) });
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) {
        return res.status(400).json({ message: "Missing variant id." });
      }
      await prisma.cardVariant.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
