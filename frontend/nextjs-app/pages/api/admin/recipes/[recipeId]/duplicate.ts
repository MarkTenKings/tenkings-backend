import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  duplicatePackRecipeSchema,
  getLocationRecipeByKey,
  getPackRecipeById,
  serializeLocationRecipe,
} from "../../../../../lib/server/packRecipes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const recipeId = typeof req.query.recipeId === "string" ? req.query.recipeId : null;
  if (!recipeId) {
    return res.status(400).json({ message: "recipeId is required" });
  }

  try {
    const admin = await requireAdminSession(req);
    const parsed = duplicatePackRecipeSchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid duplicate payload",
        issues: parsed.error.flatten(),
      });
    }

    const source = await getPackRecipeById(recipeId);
    if (!source) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    const targetLocationId = parsed.data.locationId ?? source.locationId;
    const targetTier = parsed.data.tier ?? source.tier;
    const targetName = parsed.data.name?.trim() || `${source.name} (Copy)`;

    const targetLocation = await prisma.location.findUnique({
      where: { id: targetLocationId },
      select: { id: true },
    });

    if (!targetLocation) {
      return res.status(404).json({ message: "Target location not found" });
    }

    const existing = await getLocationRecipeByKey(targetLocationId, source.category, targetTier);
    if (existing) {
      return res.status(409).json({
        message: `A recipe for ${source.category} ${targetTier} already exists at the target location.`,
      });
    }

    const duplicate = await prisma.packRecipe.create({
      data: {
        locationId: targetLocationId,
        category: source.category,
        tier: targetTier,
        name: targetName,
        slabCardsPerPack: source.slabCardsPerPack,
        bonusCardsPerPack: source.bonusCardsPerPack,
        bonusCardMaxValue: source.bonusCardMaxValue,
        isActive: source.isActive,
        notes: source.notes,
        createdById: admin.user.id,
        items: {
          create: source.items.map((item) => ({
            name: item.name,
            description: item.description,
            itemType: item.itemType,
            quantity: item.quantity,
            costPerUnit: item.costPerUnit,
            isSeasonal: item.isSeasonal,
            seasonStart: item.seasonStart,
            seasonEnd: item.seasonEnd,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
          })),
        },
      },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return res.status(201).json({ recipe: serializeLocationRecipe(duplicate) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "A conflicting recipe already exists for the chosen location and tier." });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
