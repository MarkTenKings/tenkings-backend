import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { getNormalizedClassification } from "@tenkings/shared";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const DEFAULT_LIMIT = 200;

const querySchema = z.object({
  minValue: z.string().optional(),
  maxValue: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(["value_desc", "value_asc", "updated_desc", "updated_asc"]).optional(),
  includeAssigned: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const parseMoneyToMinor = (input: string | undefined): number | null => {
  if (!input) {
    return null;
  }
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100);
};

const normalizeFilter = (value: string | undefined) => value?.trim().toLowerCase() ?? "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const parsed = querySchema.parse(req.query ?? {});
    const limit = Math.min(Number(parsed.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 500);
    const offset = Math.max(Number(parsed.offset ?? 0) || 0, 0);
    const minMinor = parseMoneyToMinor(parsed.minValue);
    const maxMinor = parseMoneyToMinor(parsed.maxValue);
    const categoryFilter = normalizeFilter(parsed.category);
    const subcategoryFilter = normalizeFilter(parsed.subcategory);
    const searchFilter = normalizeFilter(parsed.search);
    const includeAssigned = parsed.includeAssigned === "1";
    const sort = parsed.sort ?? "updated_desc";

    const valuationFilter =
      minMinor !== null || maxMinor !== null
        ? {
            valuationMinor: {
              ...(minMinor !== null ? { gte: minMinor } : {}),
              ...(maxMinor !== null ? { lte: maxMinor } : {}),
            },
          }
        : {};

    const searchFilterClause =
      searchFilter.length > 0
        ? {
            OR: [
              { customTitle: { contains: searchFilter, mode: Prisma.QueryMode.insensitive } },
              { resolvedPlayerName: { contains: searchFilter, mode: Prisma.QueryMode.insensitive } },
              { resolvedTeamName: { contains: searchFilter, mode: Prisma.QueryMode.insensitive } },
              { fileName: { contains: searchFilter, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {};

    const orderBy =
      sort === "value_desc"
        ? { valuationMinor: "desc" as const }
        : sort === "value_asc"
        ? { valuationMinor: "asc" as const }
        : sort === "updated_asc"
        ? { updatedAt: "asc" as const }
        : { updatedAt: "desc" as const };

    const cards = await prisma.cardAsset.findMany({
      where: {
        reviewStage: "INVENTORY_READY_FOR_SALE",
        ...(includeAssigned ? {} : { inventoryBatchId: null }),
        ...valuationFilter,
        ...searchFilterClause,
      },
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        fileName: true,
        imageUrl: true,
        thumbnailUrl: true,
        customTitle: true,
        resolvedPlayerName: true,
        resolvedTeamName: true,
        valuationMinor: true,
        valuationCurrency: true,
        classificationJson: true,
        updatedAt: true,
        inventoryBatchId: true,
      },
    });

    const mapped = cards
      .map((card) => {
        const normalized = getNormalizedClassification(card.classificationJson);
        const categoryType = normalized?.categoryType ?? "unknown";
        const sportSubcategory = normalized?.sport?.sport ?? normalized?.sport?.subcategory ?? null;
        const tcgSubcategory = normalized?.tcg?.game ?? normalized?.tcg?.subcategory ?? null;
        const comicsSubcategory = normalized?.comics?.title ?? normalized?.comics?.storyArc ?? null;
        const subcategory =
          categoryType === "sport"
            ? sportSubcategory
            : categoryType === "tcg"
            ? tcgSubcategory
            : categoryType === "comics"
            ? comicsSubcategory
            : null;

        return {
          id: card.id,
          title:
            card.customTitle ||
            normalized?.displayName ||
            card.resolvedPlayerName ||
            card.fileName,
          imageUrl: card.imageUrl,
          thumbnailUrl: card.thumbnailUrl ?? null,
          valuationMinor: card.valuationMinor,
          valuationCurrency: card.valuationCurrency ?? "USD",
          category: categoryType,
          subcategory,
          updatedAt: card.updatedAt.toISOString(),
          inventoryBatchId: card.inventoryBatchId ?? null,
        };
      })
      .filter((card) => {
        if (categoryFilter && card.category.toLowerCase() !== categoryFilter) {
          return false;
        }
        if (subcategoryFilter) {
          const matchTarget = (card.subcategory ?? "").toLowerCase();
          if (!matchTarget.includes(subcategoryFilter)) {
            return false;
          }
        }
        return true;
      });

    return res.status(200).json({ cards: mapped });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
