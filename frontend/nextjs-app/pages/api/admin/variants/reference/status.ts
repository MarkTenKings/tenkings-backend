import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type ResponseBody =
  | { total: number; pending: number; processed: number }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const total = await prisma.cardVariantReferenceImage.count();
    const pending = await prisma.cardVariantReferenceImage.count({
      where: {
        OR: [{ qualityScore:null }, { cropEmbeddings: { equals: null } }],
      },
    });
    const processed = Math.max(0, total - pending);

    return res.status(200).json({ total, pending, processed });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
