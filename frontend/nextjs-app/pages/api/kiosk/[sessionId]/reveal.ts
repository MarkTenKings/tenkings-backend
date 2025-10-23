import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { hasKioskControl } from "../../../../lib/server/kioskAuth";
import { kioskSessionInclude, serializeKioskSession } from "../../../../lib/server/kioskSession";

const BUYBACK_RATE = Number(process.env.KIOSK_BUYBACK_RATE ?? 0.75);

const revealSchema = z.object({
  itemId: z.string().uuid("itemId must be a valid UUID"),
  qrLinkUrl: z.string().url().optional(),
  buybackLinkUrl: z.string().url().optional(),
});

type ItemWithPack = Prisma.ItemGetPayload<{
  include: {
    packSlots: {
      include: {
        packInstance: {
          include: {
            packDefinition: true;
          };
        };
      };
    };
  };
}>;

const formatRevealPayload = (item: ItemWithPack) => {
  const slot = item.packSlots[0] ?? null;
  const packInstance = slot?.packInstance ?? null;
  const definition = packInstance?.packDefinition ?? null;
  const estimatedValue = item.estimatedValue ?? null;

  return {
    itemId: item.id,
    name: item.name,
    set: item.set,
    number: item.number,
    estimatedValue,
    imageUrl: item.imageUrl,
    thumbnailUrl: item.thumbnailUrl,
    buybackOffer: estimatedValue !== null ? Math.round(estimatedValue * BUYBACK_RATE) : null,
    pack: definition
      ? {
          id: definition.id,
          name: definition.name,
          price: definition.price,
          tier: definition.tier,
          category: definition.category,
        }
      : null,
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sessionId } = req.query;
  if (typeof sessionId !== "string") {
    return res.status(400).json({ message: "sessionId is required" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await prisma.kioskSession.findUnique({
    where: { id: sessionId },
    include: kioskSessionInclude,
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (!hasKioskControl(req, session.controlTokenHash)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = revealSchema.parse(req.body ?? {});

    const item = await prisma.item.findUnique({
      where: { id: payload.itemId },
      include: {
        packSlots: {
          include: {
            packInstance: {
              include: {
                packDefinition: true,
              },
            },
          },
        },
      },
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    const revealPayload = formatRevealPayload(item as ItemWithPack);

    const updated = await prisma.kioskSession.update({
      where: { id: sessionId },
      data: {
        status: "REVEAL",
        revealItemId: item.id,
        revealPayload,
        qrLinkUrl: payload.qrLinkUrl ?? session.qrLinkUrl,
        buybackLinkUrl: payload.buybackLinkUrl ?? session.buybackLinkUrl,
      },
      include: kioskSessionInclude,
    });

    return res.status(200).json({ session: serializeKioskSession(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("kiosk reveal error", error);
    return res.status(500).json({ message: "Failed to register reveal" });
  }
}
