import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const trimTrailingSlash = (input: string) => input.replace(/\/$/, "");
const packServiceBase = trimTrailingSlash(
  process.env.PACK_SERVICE_URL ?? process.env.NEXT_PUBLIC_PACK_SERVICE_URL ?? "http://localhost:8183"
);
const operatorKey = process.env.OPERATOR_API_KEY ?? process.env.NEXT_PUBLIC_OPERATOR_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const requestId = Array.isArray(req.query.requestId) ? req.query.requestId[0] : req.query.requestId;
    if (!requestId) {
      return res.status(400).json({ message: "requestId is required" });
    }

    const response = await fetch(`${packServiceBase}/shipping/requests/${requestId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.authorization ?? "",
        ...(operatorKey ? { "X-Operator-Key": operatorKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
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
