import type { NextApiRequest, NextApiResponse } from "next";
import { parseInventoryQueryState } from "../../../../../lib/adminInventory";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { listInventoryCards } from "../../../../../lib/server/adminInventory";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const query = parseInventoryQueryState(req.query);
    const includeSelection = req.query.includeSelection === "1";
    const payload = await listInventoryCards({ query, includeSelection });
    return res.status(200).json(payload);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
