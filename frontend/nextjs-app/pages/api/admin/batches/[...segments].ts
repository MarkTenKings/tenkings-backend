import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { buildPackingSlips } from "../../../../lib/server/packRecipes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = Array.isArray(req.query.segments) ? req.query.segments : [];

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (segments.length !== 2 || segments[1] !== "packing-slips") {
    return res.status(404).json({ message: "Not found" });
  }

  try {
    await requireAdminSession(req);

    const payload = await buildPackingSlips(segments[0]);
    if (!payload) {
      return res.status(404).json({ message: "Batch not found" });
    }

    return res.status(200).json(payload);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
