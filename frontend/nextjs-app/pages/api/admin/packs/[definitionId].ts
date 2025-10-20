import type { NextApiRequest, NextApiResponse } from "next";
import { ItemStatus, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const definitionId = Array.isArray(req.query.definitionId) ? req.query.definitionId[0] : req.query.definitionId;
    if (!definitionId) {
      return res.status(400).json({ message: "definitionId is required" });
    }

    const packs = await prisma.packInstance.findMany({
      where: { packDefinitionId: definitionId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        slots: {
          include: {
            item: {
              include: {
                ingestionTask: true,
              },
            },
          },
        },
      },
    });

    const payload = packs.map((pack) => ({
      id: pack.id,
      status: pack.status,
      ownerId: pack.ownerId,
      createdAt: pack.createdAt.toISOString(),
      openedAt: pack.openedAt ? pack.openedAt.toISOString() : null,
      slots: pack.slots.map((slot) => ({
        id: slot.id,
        itemId: slot.itemId,
        itemName: slot.item?.name ?? null,
        itemSet: slot.item?.set ?? "",
        estimatedValue: slot.item?.estimatedValue ?? null,
        status: slot.item?.status ?? ItemStatus.STORED,
        imageUrl:
          slot.item?.thumbnailUrl ??
          slot.item?.imageUrl ??
          ((slot.item?.ingestionTask?.rawPayload as { imageUrl?: string } | undefined)?.imageUrl ?? null),
      })),
    }));

    return res.status(200).json({ packs: payload });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
