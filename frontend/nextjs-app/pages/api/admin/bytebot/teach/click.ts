import { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const BASE_URL = process.env.BYTEBOT_TEACH_URL ?? "";
const SECRET = process.env.BYTEBOT_TEACH_SECRET ?? "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);
    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }
    if (!BASE_URL) {
      return res.status(500).json({ message: "BYTEBOT_TEACH_URL not configured" });
    }
    const response = await fetch(`${BASE_URL}/teach/click`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bytebot-secret": SECRET,
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(payload);
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
