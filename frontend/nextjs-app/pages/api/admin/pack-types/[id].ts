import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { findPackTypeConflict, packTypeUpsertSchema, resolvePackTypePrice, serializePackType } from "../../../../lib/server/packTypes";
import { withAdminCors } from "../../../../lib/server/cors";
import { formatCategoryLabel, formatPackTierLabel } from "../../../../lib/adminInventory";

type ResponseBody =
  | {
      packType: ReturnType<typeof serializePackType>;
    }
  | { message: string };

async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!id) {
      return res.status(400).json({ message: "Pack type id is required" });
    }

    const payload = packTypeUpsertSchema.parse(req.body ?? {});
    const existing = await prisma.packDefinition.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Pack type not found" });
    }

    const conflict = await findPackTypeConflict(payload.category, payload.tier, id);
    if (conflict) {
      return res.status(409).json({
        message: `A pack type for ${formatCategoryLabel(payload.category)} ${formatPackTierLabel(payload.tier)} already exists. Edit the existing one instead.`,
      });
    }

    const packType = await prisma.packDefinition.update({
      where: { id },
      data: {
        name: payload.name,
        description: payload.description ?? null,
        category: payload.category,
        tier: payload.tier,
        price: resolvePackTypePrice(payload.tier),
        isActive: payload.isActive,
      },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        tier: true,
        imageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({ packType: serializePackType(packType) });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
