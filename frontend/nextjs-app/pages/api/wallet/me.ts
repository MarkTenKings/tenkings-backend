import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireUserSession } from "../../../lib/server/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);

    const wallet = await prisma.wallet.findUnique({
      where: { userId: session.user.id },
    });

    if (!wallet) {
      return res.status(200).json({ wallet: null });
    }

    return res.status(200).json({
      wallet: {
        id: wallet.id,
        balance: wallet.balance,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load wallet";
    return res.status(401).json({ message });
  }
}
