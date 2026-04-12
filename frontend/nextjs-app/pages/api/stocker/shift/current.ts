import type { NextApiRequest, NextApiResponse } from "next";
import { loadCurrentShift, methodNotAllowed, parseDateOnly, requireStockerSession, sendError } from "../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const stocker = await requireStockerSession(req);
    const shift = await loadCurrentShift(stocker.stockerId, parseDateOnly(req.query.date));
    return res.status(200).json({ success: true, data: { shift } });
  } catch (error) {
    return sendError(res, error);
  }
}
