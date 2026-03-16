import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { InventoryBatchStage } from "@prisma/client";
import { z } from "zod";
import { isOnlineLocation } from "../../../../../lib/adminInventory";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const transitionSchema = z.object({
  batchId: z.string().uuid(),
  newStage: z.enum([InventoryBatchStage.SHIPPED, InventoryBatchStage.LOADED]),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
    if (!locationId) {
      return res.status(400).json({ message: "locationId is required" });
    }

    const { batchId, newStage } = transitionSchema.parse(req.body ?? {});

    const batch = await prisma.inventoryBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        stage: true,
        locationId: true,
        stageChangedAt: true,
        shippedAt: true,
        loadedAt: true,
        location: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!batch || batch.locationId !== locationId) {
      return res.status(404).json({ message: "Batch not found for location" });
    }

    const onlineLocation = isOnlineLocation(batch.location);
    const transitionAllowed =
      (batch.stage === InventoryBatchStage.ASSIGNED &&
        !onlineLocation &&
        newStage === InventoryBatchStage.SHIPPED) ||
      (batch.stage === InventoryBatchStage.ASSIGNED &&
        onlineLocation &&
        newStage === InventoryBatchStage.LOADED) ||
      (batch.stage === InventoryBatchStage.SHIPPED && newStage === InventoryBatchStage.LOADED);

    if (!transitionAllowed) {
      return res.status(409).json({
        message: "Requested stage transition is not allowed for this batch",
      });
    }

    const now = new Date();
    const updated = await prisma.inventoryBatch.update({
      where: { id: batch.id },
      data: {
        stage: newStage,
        stageChangedAt: now,
        ...(newStage === InventoryBatchStage.SHIPPED ? { shippedAt: now } : {}),
        ...(newStage === InventoryBatchStage.LOADED ? { loadedAt: now } : {}),
      },
      select: {
        id: true,
        stage: true,
        stageChangedAt: true,
        shippedAt: true,
        loadedAt: true,
      },
    });

    return res.status(200).json({ batch: updated });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
