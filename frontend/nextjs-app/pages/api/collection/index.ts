import type { NextApiRequest, NextApiResponse } from "next";
import { ItemStatus, prisma } from "@tenkings/database";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);

    const items = await prisma.item.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        shippingRequest: true,
        packSlots: {
          include: {
            packInstance: {
              select: {
                id: true,
                packDefinitionId: true,
                packDefinition: { select: { name: true, price: true, tier: true, category: true } },
              },
            },
          },
        },
      },
    });

    const payload = items.map((item) => {
      const slot = item.packSlots[0];
      return {
        id: item.id,
        name: item.name,
        set: item.set,
        number: item.number,
        language: item.language,
        foil: item.foil,
        estimatedValue: item.estimatedValue,
        status: item.status,
        vaultLocation: item.vaultLocation,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        pack: slot
          ? {
              packId: slot.packInstanceId,
              definitionId: slot.packInstance.packDefinitionId,
              definitionName: slot.packInstance.packDefinition?.name ?? null,
              tier: slot.packInstance.packDefinition?.tier ?? null,
              category: slot.packInstance.packDefinition?.category ?? null,
            }
          : null,
        shippingRequest: item.shippingRequest
          ? {
              id: item.shippingRequest.id,
              status: item.shippingRequest.status,
              processingFeeMinor: item.shippingRequest.processingFeeMinor,
              shippingFeeMinor: item.shippingRequest.shippingFeeMinor,
              totalFeeMinor: item.shippingRequest.totalFeeMinor,
              notes: item.shippingRequest.notes,
              trackingNumber: item.shippingRequest.trackingNumber,
              carrier: item.shippingRequest.carrier,
              fulfilledAt: item.shippingRequest.fulfilledAt
                ? item.shippingRequest.fulfilledAt.toISOString()
                : null,
              createdAt: item.shippingRequest.createdAt.toISOString(),
              updatedAt: item.shippingRequest.updatedAt.toISOString(),
            }
          : null,
      };
    });

    res.status(200).json({ items: payload });
  } catch (error) {
    const result = toUserErrorResponse(error);
    res.status(result.status).json({ message: result.message });
  }
}
