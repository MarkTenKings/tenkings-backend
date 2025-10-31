import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { createQrCodePairs } from "../../../../lib/server/qrCodes";

const requestSchema = z.object({
  count: z.number().int().min(1).max(200).optional().default(1),
  locationId: z.string().min(1).optional(),
});

type ResponseBody =
  | { pairs: Awaited<ReturnType<typeof createQrCodePairs>> }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { count, locationId } = requestSchema.parse(req.body ?? {});

    if (locationId) {
      const exists = await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
      if (!exists) {
        return res.status(404).json({ message: "Location not found" });
      }
    }

    const pairs = await createQrCodePairs({ count, createdById: admin.user.id, locationId });
    return res.status(200).json({ pairs });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
