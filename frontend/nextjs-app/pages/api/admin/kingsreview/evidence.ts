import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const admin = await requireAdminSession(req);

    if (req.method === "GET") {
      const cardAssetId = typeof req.query.cardAssetId === "string" ? req.query.cardAssetId : null;
      if (!cardAssetId) {
        return res.status(400).json({ message: "cardAssetId is required" });
      }

      const items = await prisma.cardEvidenceItem.findMany({
        where: { cardAssetId },
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({ items });
    }

    if (req.method === "POST") {
      const body = req.body ?? {};
      const cardAssetId = typeof body.cardAssetId === "string" ? body.cardAssetId : null;
      if (!cardAssetId) {
        return res.status(400).json({ message: "cardAssetId is required" });
      }

      const item = await prisma.cardEvidenceItem.create({
        data: {
          cardAssetId,
          kind: body.kind ?? "SOLD_COMP",
          source: body.source ?? "unknown",
          title: body.title ?? null,
          url: body.url,
          screenshotUrl: body.screenshotUrl ?? null,
          price: body.price ?? null,
          soldDate: body.soldDate ?? null,
          note: body.note ?? null,
          createdById: admin.user.id,
        },
      });

      return res.status(200).json({ item });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
