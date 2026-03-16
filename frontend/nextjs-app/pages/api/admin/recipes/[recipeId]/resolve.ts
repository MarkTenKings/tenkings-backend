import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getPackRecipeById, serializeResolvedPackRecipe } from "../../../../../lib/server/packRecipes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const recipeId = typeof req.query.recipeId === "string" ? req.query.recipeId : null;
  if (!recipeId) {
    return res.status(400).json({ message: "recipeId is required" });
  }

  try {
    await requireAdminSession(req);
    const recipe = await getPackRecipeById(recipeId);
    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    return res.status(200).json({ recipe: serializeResolvedPackRecipe(recipe) });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
