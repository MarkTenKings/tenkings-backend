import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../../lib/server/cors";
import { placeGoldenTicketInPack, type GoldenTicketPlacementSummary } from "../../../../../../lib/server/goldenTicket";

const requestSchema = z
  .object({
    packInstanceId: z.string().min(1).optional(),
    packCode: z.string().min(3).optional(),
  })
  .refine((value) => value.packInstanceId || value.packCode, {
    message: "Provide either a pack instance id or a pack QR code.",
  });

type ResponseBody = GoldenTicketPlacementSummary | { message: string };

async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;

    if (!id) {
      return res.status(400).json({ message: "Golden Ticket id is required" });
    }

    const { packInstanceId, packCode } = requestSchema.parse(req.body ?? {});
    const result = await placeGoldenTicketInPack({
      ticketId: id,
      packInstanceId,
      packCode,
      userId: admin.user.id,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
