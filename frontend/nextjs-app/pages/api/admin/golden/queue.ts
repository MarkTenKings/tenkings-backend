import type { NextApiRequest, NextApiResponse } from "next";
import type { AdminGoldenQueueResponse } from "../../../../lib/goldenQueue";
import { getAdminGoldenQueueSessionById, listAdminGoldenQueueSessions } from "../../../../lib/server/goldenQueue";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type ResponseBody = AdminGoldenQueueResponse | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { sessionId } = req.query;
  if (Array.isArray(sessionId)) {
    return res.status(400).json({ message: "sessionId must be a single value" });
  }

  try {
    await requireAdminSession(req);

    if (typeof sessionId === "string") {
      const session = await getAdminGoldenQueueSessionById(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Golden Ticket session not found" });
      }

      return res.status(200).json({
        polledAt: new Date().toISOString(),
        sessions: [session],
      });
    }

    const sessions = await listAdminGoldenQueueSessions();
    return res.status(200).json({
      polledAt: new Date().toISOString(),
      sessions,
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
