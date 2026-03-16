import type { NextApiRequest, NextApiResponse } from "next";
import { parseInventoryQueryState } from "../../../../../lib/adminInventory";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getAssignedLocationDetail } from "../../../../../lib/server/adminInventory";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
    if (!locationId) {
      return res.status(400).json({ message: "locationId is required" });
    }

    const payload = await getAssignedLocationDetail({
      locationId,
      query: parseInventoryQueryState(req.query),
      includeSelection: req.query.includeSelection === "1",
    });

    if (!payload) {
      return res.status(404).json({ message: "Location not found" });
    }

    return res.status(200).json(payload);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
