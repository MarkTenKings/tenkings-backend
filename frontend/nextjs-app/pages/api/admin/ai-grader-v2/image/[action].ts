import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const ACTIONS = new Set(["geometry", "prepare", "detect", "measure"]);

export function speedsterServiceHeaders() {
  const apiKey = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
    if (!action || !ACTIONS.has(action)) {
      return res.status(404).json({ message: "Unknown Speedster image action" });
    }

    const serviceUrl = process.env.AI_GRADER_SPEEDSTER_SERVICE_URL?.replace(/\/$/, "");
    if (!serviceUrl) throw new Error("AI_GRADER_SPEEDSTER_SERVICE_URL is not configured");

    const response = await fetch(`${serviceUrl}/${action}`, {
      method: "POST",
      headers: speedsterServiceHeaders(),
      body: JSON.stringify(req.body ?? {}),
    });
    const payload = await response.json();
    return res.status(response.status).json(payload);
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}
