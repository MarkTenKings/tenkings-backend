import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, QrCodeType } from "@tenkings/database";
import type { Prisma } from "@tenkings/database";
import { z } from "zod";
import { normalizeQrInput } from "../../../lib/qrInput";

const requestSchema = z.object({
  code: z.string().min(4, "card code is required"),
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
    buybackOffer: estimatedValue !== null ? Math.round(estimatedValue * Number(process.env.KIOSK_BUYBACK_RATE ?? 0.75)) : null,
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { code } = requestSchema.parse(req.body ?? {});
    const normalized = normalizeQrInput(code);

    const qr = await prisma.qrCode.findUnique({
      where: { code: normalized },
      include: {
        item: {
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
        },
      },
    });

    if (!qr || qr.type !== QrCodeType.CARD) {
      return res.status(404).json({ message: "Card not found" });
    }

    if (!qr.item) {
      return res.status(404).json({ message: "Card has not been assigned yet" });
    }

    const reveal = formatRevealPayload(qr.item as ItemWithPack);

    return res.status(200).json({ reveal });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    console.error("kiosk manual reveal error", error);
    return res.status(500).json({ message: "Failed to reveal card" });
  }
}
