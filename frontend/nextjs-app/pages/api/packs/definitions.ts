import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";

interface PackDefinitionResponse {
  definitions: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    inventoryCount: number;
    category: string | null;
    tier: string | null;
    metadata: Record<string, unknown> | null;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PackDefinitionResponse | { message: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const definitions = await prisma.packDefinition.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        inventoryCount: true,
        category: true,
        tier: true,
      },
    });

    const payload = definitions.map((definition) => ({
      ...definition,
      metadata:
        definition.category || definition.tier
          ? {
              category: definition.category,
              tier: definition.tier,
            }
          : null,
    }));

    return res.status(200).json({ definitions: payload });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load pack definitions";
    return res.status(500).json({ message });
  }
}
