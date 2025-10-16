import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type DefinitionSummary = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  inventoryCount: number;
  category: string;
  tier: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DefinitionSummary[] | { message: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const definitions = await prisma.packDefinition.findMany({
      orderBy: { name: "asc" },
    });

    return res.status(200).json(
      definitions.map((definition) => ({
        id: definition.id,
        name: definition.name,
        description: definition.description ?? null,
        price: definition.price,
        inventoryCount: definition.inventoryCount,
        category: definition.category,
        tier: definition.tier,
      }))
    );
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
