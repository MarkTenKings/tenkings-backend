import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { kioskSessionInclude, serializeKioskSession } from "../../../../lib/server/kioskSession";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const ACTIVE_STATUSES = ["COUNTDOWN", "LIVE", "REVEAL"] as const;

type ResponseBody =
  | {
      sessions: ReturnType<typeof serializeKioskSession>[];
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const includeCompleted = req.query.includeCompleted === "true";

    const sessions = await prisma.kioskSession.findMany({
      where: includeCompleted
        ? {}
        : {
            status: {
              in: ACTIVE_STATUSES,
            },
          },
      orderBy: { updatedAt: "desc" },
      take: includeCompleted ? 100 : 50,
      include: kioskSessionInclude,
    });

    return res.status(200).json({ sessions: sessions.map((session) => serializeKioskSession(session)) });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
