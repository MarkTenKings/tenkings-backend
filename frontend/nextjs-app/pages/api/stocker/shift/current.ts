import type { NextApiRequest, NextApiResponse } from "next";
import {
  loadCurrentShifts,
  methodNotAllowed,
  parseDateOnly,
  requireStockerSession,
  selectCurrentShift,
  sendError,
} from "../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const stocker = await requireStockerSession(req);
    if (!stocker.hasStockerProfile) {
      return res.status(200).json({ success: true, data: { shift: null, shifts: [] } });
    }
    const shifts = await loadCurrentShifts(stocker.stockerId, parseDateOnly(req.query.date));
    const shiftId = typeof req.query.shiftId === "string" ? req.query.shiftId : null;
    const shift = selectCurrentShift(shifts, shiftId);
    return res.status(200).json({ success: true, data: { shift, shifts } });
  } catch (error) {
    return sendError(res, error);
  }
}
