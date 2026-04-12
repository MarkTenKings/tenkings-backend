import type { NextApiRequest, NextApiResponse } from "next";
import {
  assertStopForStocker,
  getWalkingGuidance,
  methodNotAllowed,
  requireStockerSession,
  sendError,
  serializeLocation,
  StockerApiError,
} from "../../../../../lib/server/stocker";

function finiteQueryNumber(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const stocker = await requireStockerSession(req);
    const stopId = String(req.query.stopId ?? "");
    const lat = finiteQueryNumber(req.query.lat);
    const lng = finiteQueryNumber(req.query.lng);
    if (lat == null || lng == null) throw new StockerApiError(400, "VALIDATION_ERROR", "lat and lng are required");

    const stop = await assertStopForStocker(stocker.stockerId, stopId);
    const guidance = await getWalkingGuidance({ lat, lng }, serializeLocation(stop.location));
    return res.status(200).json({ success: true, data: guidance });
  } catch (error) {
    return sendError(res, error);
  }
}
