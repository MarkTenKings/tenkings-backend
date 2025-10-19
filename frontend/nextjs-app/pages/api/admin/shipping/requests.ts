import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const trimTrailingSlash = (input: string) => input.replace(/\/$/, "");
const packServiceBase = trimTrailingSlash(
  process.env.PACK_SERVICE_URL ?? process.env.NEXT_PUBLIC_PACK_SERVICE_URL ?? "http://localhost:8183"
);
const operatorKey = process.env.OPERATOR_API_KEY ?? process.env.NEXT_PUBLIC_OPERATOR_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const params = new URLSearchParams();
    if (req.query.status) {
      const status = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
      if (status) params.set("status", status);
    }
    if (req.query.userId) {
      const userId = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
      if (userId) params.set("userId", userId);
    }

    const response = await fetch(`${packServiceBase}/shipping/requests${params.toString() ? `?${params.toString()}` : ""}`, {
      headers: {
        Authorization: req.headers.authorization ?? "",
        ...(operatorKey ? { "X-Operator-Key": operatorKey } : {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    const payload = await response.json();
    res.status(200).json(payload);
  } catch (error) {
    const result = toErrorResponse(error);
    res.status(result.status).json({ message: result.message });
  }
}
