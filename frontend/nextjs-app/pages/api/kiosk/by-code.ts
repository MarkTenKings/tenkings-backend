import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { kioskSessionInclude, serializeKioskSession } from "../../../lib/server/kioskSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { code } = req.query;
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ message: "code query parameter is required" });
  }

  const session = await prisma.kioskSession.findFirst({
    where: {
      code,
      status: {
        notIn: ["CANCELLED"],
      },
    },
    include: kioskSessionInclude,
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  return res.status(200).json({ session: serializeKioskSession(session) });
}
