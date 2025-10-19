import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

const requestSchema = z.object({
  recipientName: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  shippingFeeMinor: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

const trimTrailingSlash = (input: string) => input.replace(/\/$/, "");

const packServiceBase = trimTrailingSlash(
  process.env.PACK_SERVICE_URL ?? process.env.NEXT_PUBLIC_PACK_SERVICE_URL ?? "http://localhost:8183"
);

const operatorKey = process.env.OPERATOR_API_KEY ?? process.env.NEXT_PUBLIC_OPERATOR_KEY;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);
    const itemId = Array.isArray(req.query.itemId) ? req.query.itemId[0] : req.query.itemId;
    if (!itemId) {
      return res.status(400).json({ message: "itemId is required" });
    }

    const payload = requestSchema.parse(req.body ?? {});

    const response = await fetch(`${packServiceBase}/items/${itemId}/request-shipping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.authorization ?? `Bearer ${session.tokenHash}`,
        ...(operatorKey ? { "X-Operator-Key": operatorKey } : {}),
      },
      body: JSON.stringify({ ...payload, userId: session.user.id }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || response.statusText);
    }

    const data = await response.json();
    res.status(201).json(data);
  } catch (error) {
    const result = toUserErrorResponse(error);
    res.status(result.status).json({ message: result.message });
  }
}
