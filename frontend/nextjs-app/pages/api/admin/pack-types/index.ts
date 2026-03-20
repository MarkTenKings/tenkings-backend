import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { listPackTypes, packTypeUpsertSchema, resolvePackTypePrice, serializePackType, findPackTypeConflict } from "../../../../lib/server/packTypes";
import { withAdminCors } from "../../../../lib/server/cors";
import { formatCategoryLabel, formatPackTierLabel } from "../../../../lib/adminInventory";

type ResponseBody =
  | {
      packTypes: Awaited<ReturnType<typeof listPackTypes>>;
    }
  | {
      packType: Awaited<ReturnType<typeof listPackTypes>>[number];
    }
  | { message: string };

async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const packTypes = await listPackTypes();
      return res.status(200).json({ packTypes });
    }

    if (req.method === "POST") {
      const payload = packTypeUpsertSchema.parse(req.body ?? {});
      const conflict = await findPackTypeConflict(payload.category, payload.tier);
      if (conflict) {
        return res.status(409).json({
          message: `A pack type for ${formatCategoryLabel(payload.category)} ${formatPackTierLabel(payload.tier)} already exists. Edit the existing one instead.`,
        });
      }

      const packType = await prisma.packDefinition.create({
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

      return res.status(201).json({ packType: serializePackType(packType) });
    }

    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
