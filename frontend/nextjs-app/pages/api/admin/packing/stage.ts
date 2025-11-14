import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import {
  prisma,
  BatchStage,
  PackFulfillmentStatus,
  type Prisma,
} from "@tenkings/database";
import { setBatchStage } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const requestSchema = z.object({
  stage: z.nativeEnum(BatchStage),
  packIds: z.array(z.string().uuid()).optional(),
  batchId: z.string().uuid().optional(),
});

const stageToFulfillment: Partial<Record<BatchStage, PackFulfillmentStatus>> = {
  [BatchStage.INVENTORY_READY]: PackFulfillmentStatus.READY_FOR_PACKING,
  [BatchStage.PACKING]: PackFulfillmentStatus.READY_FOR_PACKING,
  [BatchStage.PACKED]: PackFulfillmentStatus.PACKED,
  [BatchStage.SHIPPING_READY]: PackFulfillmentStatus.PACKED,
  [BatchStage.SHIPPING_SHIPPED]: PackFulfillmentStatus.PACKED,
  [BatchStage.SHIPPING_RECEIVED]: PackFulfillmentStatus.PACKED,
  [BatchStage.LOADED]: PackFulfillmentStatus.LOADED,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { stage, packIds: requestPackIds = [], batchId } = requestSchema.parse(req.body ?? {});

    if (!batchId && requestPackIds.length === 0) {
      return res.status(400).json({ message: "Select at least one pack or batch." });
    }

    const result = await prisma.$transaction(async (tx) => {
      let targetPackIds = requestPackIds;

      if (batchId) {
        const batchPackIds = await tx.packInstance.findMany({
          where: { sourceBatchId: batchId },
          select: { id: true },
        });
        const ids = batchPackIds.map((pack) => pack.id);
        if (targetPackIds.length === 0) {
          targetPackIds = ids;
        } else {
          const valid = new Set(ids);
          targetPackIds = targetPackIds.filter((id) => valid.has(id));
        }
      }

      if (targetPackIds.length === 0) {
        throw new Error("No packs found for the requested stage change");
      }

      const packs = await tx.packInstance.findMany({
        where: { id: { in: targetPackIds } },
        select: {
          id: true,
          locationId: true,
          sourceBatchId: true,
        },
      });

      if (packs.length === 0) {
        throw new Error("No packs found for the requested stage change");
      }

      const stageFulfillment = stageToFulfillment[stage];
      const now = new Date();

      if (stageFulfillment) {
        if (stageFulfillment === PackFulfillmentStatus.LOADED) {
          const missingLocation = packs.some((pack) => !pack.locationId);
          if (missingLocation) {
            throw new Error("Assign a location before marking packs as loaded.");
          }
        }

        const updateData: Prisma.PackInstanceUpdateManyMutationInput = {
          fulfillmentStatus: stageFulfillment,
        };

        if (stageFulfillment === PackFulfillmentStatus.LOADED) {
          updateData.loadedAt = now;
          updateData.loadedById = admin.user.id;
        } else {
          updateData.loadedById = null;
        }

        if (stageFulfillment === PackFulfillmentStatus.PACKED) {
          updateData.packedAt = now;
          updateData.packedById = admin.user.id;
        } else if (stageFulfillment === PackFulfillmentStatus.READY_FOR_PACKING) {
          updateData.packedAt = null;
          updateData.packedById = null;
          updateData.loadedAt = null;
          updateData.loadedById = null;
        }

        await tx.packInstance.updateMany({
          where: { id: { in: packs.map((pack) => pack.id) } },
          data: updateData,
        });
      }

      const batchIds = Array.from(
        new Set(
          packs
            .map((pack) => pack.sourceBatchId)
            .filter((value): value is string => typeof value === "string")
        )
      );

      await Promise.all(
        batchIds.map((id) =>
          setBatchStage(tx, {
            batchId: id,
            stage,
            actorId: admin.user.id,
            note: "Manual stage update",
            force: true,
          })
        )
      );

      return { updatedCount: packs.length, batches: batchIds };
    });

    return res.status(200).json({
      message: `Moved ${result.updatedCount} pack${result.updatedCount === 1 ? "" : "s"} to ${stage}.`,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
