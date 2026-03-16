import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { InventoryBatchStage, Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  getPackRecipeById,
  normalizeRecipeItemInputs,
  serializeLocationRecipe,
  updatePackRecipeSchema,
} from "../../../../../lib/server/packRecipes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const recipeId = typeof req.query.recipeId === "string" ? req.query.recipeId : null;

  if (!recipeId) {
    return res.status(400).json({ message: "recipeId is required" });
  }

  if (req.method !== "PUT" && req.method !== "DELETE") {
    res.setHeader("Allow", "PUT, DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const recipe = await getPackRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    if (req.method === "DELETE") {
      const activeBatches = await prisma.inventoryBatch.count({
        where: {
          locationId: recipe.locationId,
          category: recipe.category,
          tier: recipe.tier,
          stage: { not: InventoryBatchStage.LOADED },
        },
      });

      if (activeBatches > 0) {
        return res.status(409).json({
          message: "Cannot delete recipe with active batches. Deactivate it instead.",
        });
      }

      await prisma.packRecipe.delete({ where: { id: recipeId } });
      return res.status(200).json({ success: true });
    }

    const parsed = updatePackRecipeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid recipe payload",
        issues: parsed.error.flatten(),
      });
    }

    const normalizedItems = parsed.data.items ? normalizeRecipeItemInputs(parsed.data.items) : undefined;

    if (normalizedItems) {
      const existingItemIds = new Set(recipe.items.map((item) => item.id));
      const invalidItem = normalizedItems.find((item) => item.id && !existingItemIds.has(item.id));
      if (invalidItem?.id) {
        return res.status(400).json({ message: "One or more recipe items do not belong to this recipe." });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.packRecipe.update({
        where: { id: recipeId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.slabCardsPerPack !== undefined
            ? { slabCardsPerPack: parsed.data.slabCardsPerPack }
            : {}),
          ...(parsed.data.bonusCardsPerPack !== undefined
            ? { bonusCardsPerPack: parsed.data.bonusCardsPerPack }
            : {}),
          ...(parsed.data.bonusCardMaxValue !== undefined
            ? { bonusCardMaxValue: parsed.data.bonusCardMaxValue }
            : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes?.trim() || null } : {}),
        },
      });

      if (normalizedItems) {
        const incomingIds = new Set(
          normalizedItems
            .map((item) => item.id)
            .filter((value): value is string => Boolean(value))
        );

        const deleteIds = recipe.items
          .filter((item) => !incomingIds.has(item.id))
          .map((item) => item.id);

        if (deleteIds.length > 0) {
          await tx.packRecipeItem.deleteMany({
            where: { id: { in: deleteIds } },
          });
        }

        for (const item of normalizedItems) {
          if (item.id) {
            await tx.packRecipeItem.update({
              where: { id: item.id },
              data: {
                name: item.name.trim(),
                description: item.description,
                itemType: item.itemType,
                quantity: item.quantity,
                costPerUnit: item.costPerUnit,
                isSeasonal: item.isSeasonal,
                seasonStart: item.seasonStart,
                seasonEnd: item.seasonEnd,
                isActive: item.isActive,
                sortOrder: item.sortOrder,
              },
            });
          } else {
            await tx.packRecipeItem.create({
              data: {
                recipeId,
                name: item.name.trim(),
                description: item.description,
                itemType: item.itemType,
                quantity: item.quantity,
                costPerUnit: item.costPerUnit,
                isSeasonal: item.isSeasonal,
                seasonStart: item.seasonStart,
                seasonEnd: item.seasonEnd,
                isActive: item.isActive,
                sortOrder: item.sortOrder,
              },
            });
          }
        }
      }

      return tx.packRecipe.findUnique({
        where: { id: recipeId },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });
    });

    if (!updated) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    return res.status(200).json({ recipe: serializeLocationRecipe(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "A conflicting recipe already exists for that location/category/tier." });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
