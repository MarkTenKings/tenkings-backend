import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const identifierSchema = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Provide a pack code or serial");
  }
  return value.trim();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<{ resetVersion: number } | { message: string }>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const identifier = identifierSchema(req.body?.identifier);

    const qr = await prisma.qrCode.findFirst({
      where: {
        OR: [
          { code: identifier },
          identifier.toUpperCase().startsWith("TK") ? { serial: identifier } : undefined,
        ].filter(Boolean) as [{ code: string } | { serial: string }],
      },
    });

    if (!qr) {
      return res.status(404).json({ message: "Pack label not found" });
    }

    const updated = await prisma.qrCode.update({
      where: { id: qr.id },
      data: { resetVersion: { increment: 1 } },
    });

    return res.status(200).json({ resetVersion: updated.resetVersion });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
