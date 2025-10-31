import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { bindCardQrCode } from "../../../../lib/server/qrCodes";

const requestSchema = z.object({
  code: z.string().min(3),
  itemId: z.string().min(1),
});

type ResponseBody =
  | {
      item: {
        id: string;
        name: string | null;
        imageUrl: string | null;
      };
      qrCode: ReturnType<typeof toSerializableSummary>;
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
    const { code, itemId } = requestSchema.parse(req.body ?? {});

    const result = await bindCardQrCode({ code, itemId, userId: admin.user.id });

    return res.status(200).json({
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
