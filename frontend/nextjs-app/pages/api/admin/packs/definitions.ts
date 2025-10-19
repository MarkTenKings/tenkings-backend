import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const definitions = await prisma.packDefinition.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        packs: {
          select: { status: true },
        },
      },
    });

    const payload = definitions.map((definition) => {
      const totalPacks = definition.packs.length;
      const openedPacks = definition.packs.filter((pack) => pack.status === "OPENED").length;
      const unopenedPacks = totalPacks - openedPacks;
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        price: definition.price,
        category: definition.category,
        tier: definition.tier,
        inventoryCount: definition.inventoryCount,
        createdAt: definition.createdAt.toISOString(),
        updatedAt: definition.updatedAt.toISOString(),
        totalPacks,
        openedPacks,
        unopenedPacks,
      };
    });

    return res.status(200).json({ definitions: payload });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
