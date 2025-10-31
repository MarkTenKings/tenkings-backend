import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { bindPackQrCode } from "../../../../lib/server/qrCodes";

const requestSchema = z.object({
  code: z.string().min(3),
  packInstanceId: z.string().min(1),
  locationId: z.string().min(1),
});

type ResponseBody =
  | {
      pack: {
        id: string;
        fulfillmentStatus: string;
        packedAt: string | null;
        definitionName: string;
        definitionPrice: number | null;
      };
      location: {
        id: string;
        name: string;
      };
      qrCode: ReturnType<typeof toSerializableSummary>;
    }
  | { message: string };

const toSerializableSummary = (summary: Awaited<ReturnType<typeof bindPackQrCode>>["qrCode"]) => ({
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
    const { code, packInstanceId, locationId } = requestSchema.parse(req.body ?? {});

    const result = await bindPackQrCode({ code, packInstanceId, userId: admin.user.id, locationId });

    return res.status(200).json({
      pack: {
        id: result.pack.id,
        fulfillmentStatus: result.pack.fulfillmentStatus,
        packedAt: result.pack.packedAt ? result.pack.packedAt.toISOString() : null,
        definitionName: result.pack.packDefinition.name,
        definitionPrice: result.pack.packDefinition.price,
      },
      location: result.location,
      qrCode: toSerializableSummary(result.qrCode),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
