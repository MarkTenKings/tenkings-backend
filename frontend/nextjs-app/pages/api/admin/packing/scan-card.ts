import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, QrCodeType } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { bindCardQrCode } from "../../../../lib/server/qrCodes";
import { placeGoldenTicketInPack } from "../../../../lib/server/goldenTicket";

const requestSchema = z.object({
  code: z.string().min(3),
  itemId: z.string().min(1),
  packInstanceId: z.string().min(1).optional(),
});

type ResponseBody =
  | {
      mode: "card";
      item: {
        id: string;
        name: string | null;
        imageUrl: string | null;
      };
      qrCode: ReturnType<typeof toSerializableSummary>;
    }
  | {
      mode: "golden_ticket";
      goldenTicket: {
        id: string;
        ticketNumber: number;
        code: string;
        status: string;
        placedAt: string | null;
        prizeName: string;
      };
      pack: {
        id: string;
        fulfillmentStatus: string;
        definitionName: string;
        definitionPrice: number | null;
        locationId: string | null;
        goldenTicketCount: number;
      };
    }
  | { message: string };

const toSerializableSummary = (summary: Awaited<ReturnType<typeof bindCardQrCode>>["qrCode"]) => ({
  id: summary.id,
  code: summary.code,
  serial: summary.serial,
  type: summary.type,
  state: summary.state,
  payloadUrl: summary.payloadUrl,
  pairId: summary.pairId ?? null,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { code, itemId, packInstanceId } = requestSchema.parse(req.body ?? {});

    const scannedQr = await prisma.qrCode.findUnique({
      where: { code },
      select: {
        type: true,
        goldenTicket: {
          select: {
            id: true,
          },
        },
      },
    });

    if (scannedQr?.type === QrCodeType.GOLDEN_TICKET) {
      if (!scannedQr.goldenTicket?.id) {
        return res.status(404).json({ message: "Golden Ticket not found" });
      }
      if (!packInstanceId) {
        return res.status(400).json({ message: "Pack instance id is required for Golden Ticket placement" });
      }

      const result = await placeGoldenTicketInPack({
        ticketId: scannedQr.goldenTicket.id,
        packInstanceId,
        userId: admin.user.id,
      });

      return res.status(200).json({
        mode: "golden_ticket",
        goldenTicket: result.goldenTicket,
        pack: result.pack,
      });
    }

    const result = await bindCardQrCode({ code, itemId, userId: admin.user.id });

    return res.status(200).json({
      mode: "card",
      item: {
        id: result.item.id,
        name: result.item.name,
        imageUrl: result.item.imageUrl,
      },
      qrCode: toSerializableSummary(result.qrCode),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
