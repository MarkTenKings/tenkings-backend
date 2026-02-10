import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type VariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
};

type ResponseBody =
  | { variants: VariantRow[] }
  | { variant: VariantRow }
  | { ok: true }
  | { message: string };

function toRow(variant: any): VariantRow {
  return {
    id: variant.id,
    setId: variant.setId,
    cardNumber: variant.cardNumber,
    parallelId: variant.parallelId,
    parallelFamily: variant.parallelFamily ?? null,
    keywords: Array.isArray(variant.keywords) ? variant.keywords : [],
    createdAt: variant.createdAt?.toISOString?.() ?? String(variant.createdAt),
    updatedAt: variant.updatedAt?.toISOString?.() ?? String(variant.updatedAt),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const take = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
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
      return res.status(200).json({ variants: variants.map(toRow) });
    }

    if (req.method === "POST") {
      const { setId, cardNumber, parallelId, parallelFamily, keywords } = req.body ?? {};
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
        },
      });
      return res.status(200).json({ variant: toRow(variant) });
    }

    if (req.method === "PUT") {
      const { id, setId, cardNumber, parallelId, parallelFamily, keywords } = req.body ?? {};
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
