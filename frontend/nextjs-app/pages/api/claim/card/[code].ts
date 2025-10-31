import type { NextApiRequest, NextApiResponse } from "next";
import {
  prisma,
  ItemStatus,
  QrCodeType,
  KioskClaimStatus,
  type Prisma,
} from "@tenkings/database";
import { z } from "zod";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

const isJsonObject = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractPairId = (metadata: Prisma.JsonValue | null) => {
  const payload = isJsonObject(metadata) ? metadata : null;
  const value = payload && typeof payload.pairId === "string" ? payload.pairId : null;
  return value;
};

const mergeMetadata = (current: Prisma.JsonValue | null, updates: Record<string, unknown>): Prisma.InputJsonValue => {
  const base = isJsonObject(current) ? { ...current } : {};
  return { ...base, ...updates } as Prisma.InputJsonValue;
};

const claimSchema = z.object({});

async function loadCard(code: string) {
  const qr = await prisma.qrCode.findUnique({
    where: { code },
    include: {
      item: {
        include: {
          packSlots: {
            include: {
              packInstance: {
                include: {
                  packDefinition: true,
                  location: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!qr || qr.type !== QrCodeType.CARD) {
    return null;
  }

  const item = qr.item;
  if (!item) {
    return { qr };
  }

  const slot = item.packSlots[0];
  let session = null;
  if (slot?.packInstanceId) {
    session = await prisma.kioskSession.findFirst({
      where: { packInstanceId: slot.packInstanceId },
      orderBy: { createdAt: "desc" },
      include: { claimedBy: { select: { id: true, displayName: true, phone: true } } },
    });
  }

  return { qr, item, slot, session };
}

const toResponse = (payload: Awaited<ReturnType<typeof loadCard>>) => {
  if (!payload) {
    return null;
  }

  const { qr, item, slot, session } = payload;
  const claimStatus = session?.claimStatus ?? null;

  return {
    code: {
      id: qr.id,
      code: qr.code,
      serial: qr.serial,
      pairId: extractPairId(qr.metadata),
      state: qr.state,
    },
    item: item
      ? {
          id: item.id,
          name: item.name,
          set: item.set,
          number: item.number,
          imageUrl: item.imageUrl,
          thumbnailUrl: item.thumbnailUrl,
          status: item.status,
          ownerId: item.ownerId,
          estimatedValue: item.estimatedValue,
        }
      : null,
    pack: slot?.packInstance
      ? {
          id: slot.packInstance.id,
          definitionName: slot.packInstance.packDefinition?.name ?? null,
          definitionTier: slot.packInstance.packDefinition?.tier ?? null,
          locationId: slot.packInstance.locationId,
          locationName: slot.packInstance.location?.name ?? null,
        }
      : null,
    session: session
      ? {
          id: session.id,
          status: session.status,
          claimStatus: session.claimStatus,
          claimedBy: session.claimedBy
            ? {
                id: session.claimedBy.id,
                displayName: session.claimedBy.displayName,
                phone: session.claimedBy.phone,
              }
            : null,
        }
      : null,
    claimStatus,
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ message: "code is required" });
  }

  if (req.method === "GET") {
    try {
      const record = await loadCard(code.trim());
      const payload = toResponse(record);
      if (!payload) {
        return res.status(404).json({ message: "Card not found" });
      }
      return res.status(200).json({ card: payload });
    } catch (error) {
      const result = toUserErrorResponse(error);
      return res.status(result.status).json({ message: result.message });
    }
  }

  if (req.method === "POST") {
    try {
      await claimSchema.parseAsync(req.body ?? {});
      const session = await requireUserSession(req);

      const result = await prisma.$transaction(async (tx) => {
        const qr = await tx.qrCode.findUnique({
          where: { code: code.trim() },
          include: {
            item: {
              include: {
                packSlots: {
                  include: {
                    packInstance: {
                      include: {
                        packDefinition: true,
                        location: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!qr || qr.type !== QrCodeType.CARD) {
          throw new Error("Card QR code not found");
        }

        const item = qr.item;
        if (!item) {
          throw new Error("Card has not been bound to inventory yet");
        }

        const slot = item.packSlots[0];
        if (!slot) {
          throw new Error("Card is missing pack assignment");
        }

        const latestSession = await tx.kioskSession.findFirst({
          where: { packInstanceId: slot.packInstanceId },
          orderBy: { createdAt: "desc" },
        });

        if (
          latestSession &&
          latestSession.claimStatus === KioskClaimStatus.CLAIMED &&
          latestSession.claimedById &&
          latestSession.claimedById !== session.user.id
        ) {
          throw new Error("This card was already claimed by another collector");
        }

        const currentOwnerId = item.ownerId;
        const alreadyOwned = currentOwnerId === session.user.id;

        if (!alreadyOwned) {
          await tx.item.update({
            where: { id: item.id },
            data: {
              ownerId: session.user.id,
              status: ItemStatus.IN_TRANSFER,
            },
          });
        }

        const existingOwnership = await tx.itemOwnership.findFirst({
          where: { itemId: item.id, ownerId: session.user.id },
        });

        if (!existingOwnership) {
          await tx.itemOwnership.create({
            data: {
              itemId: item.id,
              ownerId: session.user.id,
              note: "Claimed via QR code",
            },
          });
        }

        await tx.packInstance.update({
          where: { id: slot.packInstanceId },
          data: {
            ownerId: session.user.id,
          },
        });

        if (latestSession) {
          await tx.kioskSession.update({
            where: { id: latestSession.id },
            data: {
              claimedById: session.user.id,
              claimStatus: KioskClaimStatus.CLAIMED,
            },
          });
        }

        const updatedQr = await tx.qrCode.update({
          where: { id: qr.id },
          data: {
            metadata: mergeMetadata(qr.metadata, { claimedById: session.user.id }),
          },
        });

        const hydratedItem = await tx.item.findUnique({
          where: { id: item.id },
          include: {
            packSlots: {
              include: {
                packInstance: {
                  include: {
                    packDefinition: true,
                    location: true,
                  },
                },
              },
            },
          },
        });

        const refreshedSession = latestSession
          ? await tx.kioskSession.findUnique({
              where: { id: latestSession.id },
              include: { claimedBy: { select: { id: true, displayName: true, phone: true } } },
            })
          : null;

        return { qr: updatedQr, item: hydratedItem!, session: refreshedSession };
      });

      const refreshed = await loadCard(result.qr.code);
      const payload = toResponse(refreshed);

      return res.status(200).json({ card: payload });
    } catch (error) {
      const result = toUserErrorResponse(error);
      return res.status(result.status).json({ message: result.message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ message: "Method not allowed" });
}
