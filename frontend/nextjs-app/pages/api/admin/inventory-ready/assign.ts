import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { syncInventoryArtifactsLocation } from "../../../../lib/server/qrCodes";

const assignSchema = z.object({
  cardIds: z.array(z.string().min(1)).min(1),
  locationId: z.string().uuid(),
  label: z.string().trim().min(1).optional().nullable(),
});

type ResponseBody =
  | {
      batchId: string;
      updatedCount: number;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { cardIds, locationId, label } = assignSchema.parse(req.body ?? {});

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    const cards = await prisma.cardAsset.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, reviewStage: true },
    });

    if (cards.length !== cardIds.length) {
      return res.status(404).json({ message: "One or more cards not found" });
    }

    const invalidStage = cards.find((card) => card.reviewStage !== "INVENTORY_READY_FOR_SALE");
    if (invalidStage) {
      return res.status(409).json({ message: "One or more cards are not in Inventory Ready stage" });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.inventoryBatch.create({
        data: {
          locationId,
          label: label ?? null,
          createdById: admin.user.id,
        },
        select: { id: true },
      });

      const updated = await tx.cardAsset.updateMany({
        where: { id: { in: cardIds } },
        data: {
          inventoryBatchId: batch.id,
          inventoryAssignedAt: now,
        },
      });

      const items = await tx.item.findMany({
        where: { number: { in: cardIds } },
        select: {
          id: true,
          number: true,
          cardQrCodeId: true,
        },
      });

      const itemIds = items.map((item) => item.id);
      const cardQrCodeIds = items.flatMap((item) => (item.cardQrCodeId ? [item.cardQrCodeId] : []));

      const labels =
        itemIds.length > 0 || cardQrCodeIds.length > 0
          ? await tx.packLabel.findMany({
              where: {
                OR: [
                  ...(itemIds.length > 0 ? [{ itemId: { in: itemIds } }] : []),
                  ...(cardQrCodeIds.length > 0 ? [{ cardQrCodeId: { in: cardQrCodeIds } }] : []),
                ],
              },
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                itemId: true,
                cardQrCodeId: true,
                packQrCodeId: true,
              },
            })
          : [];

      const labelsByItemId = new Map<string, (typeof labels)[number]>();
      const labelsByCardQrCodeId = new Map<string, (typeof labels)[number]>();

      for (const labelRecord of labels) {
        if (labelRecord.itemId && !labelsByItemId.has(labelRecord.itemId)) {
          labelsByItemId.set(labelRecord.itemId, labelRecord);
        }
        if (!labelsByCardQrCodeId.has(labelRecord.cardQrCodeId)) {
          labelsByCardQrCodeId.set(labelRecord.cardQrCodeId, labelRecord);
        }
      }

      for (const item of items) {
        const labelRecord =
          labelsByItemId.get(item.id) ??
          (item.cardQrCodeId ? labelsByCardQrCodeId.get(item.cardQrCodeId) : undefined);

        await syncInventoryArtifactsLocation(tx, {
          itemId: item.id,
          packLabelId: labelRecord?.id ?? null,
          cardQrCodeId: labelRecord?.cardQrCodeId ?? item.cardQrCodeId ?? null,
          packQrCodeId: labelRecord?.packQrCodeId ?? null,
          locationId,
        });
      }

      return { batchId: batch.id, updatedCount: updated.count };
    });

    return res.status(200).json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
