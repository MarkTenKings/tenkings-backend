import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  createLocationRecipe,
  createPackRecipeSchema,
  getLocationRecipeByKey,
  listLocationRecipes,
} from "../../../../../lib/server/packRecipes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;

  if (!locationId) {
    return res.status(400).json({ message: "locationId is required" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    if (req.method === "GET") {
      const recipes = await listLocationRecipes(locationId);
      return res.status(200).json({ recipes });
    }

    const parsed = createPackRecipeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message ?? "Invalid recipe payload",
        issues: parsed.error.flatten(),
      });
    }

    const existing = await getLocationRecipeByKey(locationId, parsed.data.category, parsed.data.tier);
    if (existing) {
      return res.status(409).json({
        message: `A recipe for ${parsed.data.category} ${parsed.data.tier} already exists at this location.`,
      });
    }

    const recipe = await createLocationRecipe(locationId, admin.user.id, parsed.data);
    return res.status(201).json({ recipe });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "A recipe for this location, category, and tier already exists." });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
