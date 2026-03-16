import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getInventoryFilterOptions } from "../../../../lib/server/adminInventory";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    const payload = await getInventoryFilterOptions({ locationId, batchId });
    return res.status(200).json(payload);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
