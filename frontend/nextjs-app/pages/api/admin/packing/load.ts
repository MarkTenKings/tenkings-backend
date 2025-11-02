import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import {
  prisma,
  PackFulfillmentStatus,
  QrCodeType,
  syncBatchStageFromPackStatuses,
} from "@tenkings/database";
import type { Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const requestSchema = z.object({
  code: z.string().min(4),
  locationId: z.string().uuid().optional(),
});

const serializePack = (pack: {
  id: string;
  fulfillmentStatus: PackFulfillmentStatus;
  loadedAt: Date | null;
  packDefinition: { id: string; name: string; price: number | null } | null;
}) => ({
  id: pack.id,
  fulfillmentStatus: pack.fulfillmentStatus,
  loadedAt: pack.loadedAt ? pack.loadedAt.toISOString() : null,
  definition: pack.packDefinition
    ? {
        id: pack.packDefinition.id,
        name: pack.packDefinition.name,
        price: pack.packDefinition.price,
      }
    : null,
});

const serializeQr = (qr: { id: string; code: string; serial: string | null }) => ({
  id: qr.id,
  code: qr.code,
  serial: qr.serial,
});

const mergeMetadata = (current: unknown, updates: Prisma.JsonObject): Prisma.JsonObject => {
  const base: Prisma.JsonObject =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Prisma.JsonObject)
      : {};

  const next: Prisma.JsonObject = { ...base };
  for (const [key, value] of Object.entries(updates)) {
    next[key] = value as Prisma.JsonValue;
  }
  return next;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { code, locationId } = requestSchema.parse(req.body ?? {});

    const result = await prisma.$transaction(async (tx) => {
      const qr = await tx.qrCode.findUnique({
        where: { code },
        include: {
          packInstance: {
            include: {
              packDefinition: true,
              sourceBatch: { select: { id: true } },
            },
          },
        },
      });

      if (!qr || qr.type !== QrCodeType.PACK) {
        throw new Error("Pack QR code not found");
      }

      if (!qr.packInstance) {
        throw new Error("Pack QR code is not bound to an inventory pack yet");
      }

      const pack = qr.packInstance;
      const batchId = pack.sourceBatch?.id ?? null;

      if (
        pack.fulfillmentStatus !== PackFulfillmentStatus.PACKED &&
        pack.fulfillmentStatus !== PackFulfillmentStatus.LOADED
      ) {
        throw new Error("Pack is not ready for loading");
      }

      const resolvedLocationId = locationId ?? pack.locationId ?? null;

      if (!resolvedLocationId) {
        throw new Error("Select a location before marking the pack as loaded");
      }

      if (pack.locationId && pack.locationId !== resolvedLocationId) {
        throw new Error("Pack is assigned to a different location");
      }

      const now = new Date();

      const updatedPack = await tx.packInstance.update({
        where: { id: pack.id },
        data: {
          fulfillmentStatus: PackFulfillmentStatus.LOADED,
          locationId: resolvedLocationId,
          loadedAt: pack.loadedAt ?? now,
          loadedById: admin.user.id,
        },
        select: {
          id: true,
          fulfillmentStatus: true,
          loadedAt: true,
          packDefinition: {
            select: {
              id: true,
              name: true,
              price: true,
            },
          },
        },
      });

      const metadataUpdates: Prisma.JsonObject = {
        loadedById: admin.user.id,
        loadedAt: now.toISOString(),
        locationId: resolvedLocationId ?? null,
      };

      await tx.qrCode.update({
        where: { id: qr.id },
        data: {
          metadata: mergeMetadata(qr.metadata, metadataUpdates),
        },
      });

      if (batchId) {
        await syncBatchStageFromPackStatuses({
          tx,
          batchId,
          actorId: admin.user.id,
        });
      }

      return {
        pack: updatedPack,
        qr: { id: qr.id, code: qr.code, serial: qr.serial },
      };
    });

    return res.status(200).json({
      pack: serializePack(result.pack),
      qrCode: serializeQr(result.qr),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
