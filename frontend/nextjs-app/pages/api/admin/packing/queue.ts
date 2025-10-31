import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, PackFulfillmentStatus } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const querySchema = z.object({
  locationId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

type QueueEntry = {
  id: string;
  createdAt: string;
  packDefinition: {
    id: string;
    name: string;
    price: number;
    tier: string;
  };
  item: {
    id: string;
    name: string;
    imageUrl: string | null;
    cardQrCodeId: string | null;
  } | null;
};

type ResponseBody = { packs: QueueEntry[] } | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const { locationId, limit } = querySchema.parse(req.query);

    const location = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    const packs = await prisma.packInstance.findMany({
      where: {
        locationId,
        fulfillmentStatus: PackFulfillmentStatus.READY_FOR_PACKING,
      },
      orderBy: { createdAt: "asc" },
      take: limit ?? 100,
      select: {
        id: true,
        createdAt: true,
        packDefinition: {
          select: {
            id: true,
            name: true,
            price: true,
            tier: true,
          },
        },
        slots: {
          take: 1,
          select: {
            item: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                cardQrCodeId: true,
              },
            },
          },
        },
      },
    });

    const payload: QueueEntry[] = packs.map((pack) => ({
      id: pack.id,
      createdAt: pack.createdAt.toISOString(),
      packDefinition: {
        id: pack.packDefinition.id,
        name: pack.packDefinition.name,
        price: pack.packDefinition.price,
        tier: pack.packDefinition.tier,
      },
      item: pack.slots[0]?.item
        ? {
            id: pack.slots[0].item.id,
            name: pack.slots[0].item.name,
            imageUrl: pack.slots[0].item.imageUrl,
            cardQrCodeId: pack.slots[0].item.cardQrCodeId,
          }
        : null,
    }));

    return res.status(200).json({ packs: payload });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
