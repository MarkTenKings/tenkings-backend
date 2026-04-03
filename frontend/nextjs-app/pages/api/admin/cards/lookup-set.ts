import type { NextApiRequest, NextApiResponse } from "next";
import { normalizeCardNumber } from "@tenkings/shared";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import {
  buildLookupSetYearPrefix,
  type LookupSetResult,
  lookupSetByCardIdentity,
} from "../../../../lib/server/setLookup";

type LookupSetResponse =
  | LookupSetResult
  | { message: string };

const lookupSetSchema = z.object({
  year: z.string().trim().min(1),
  manufacturer: z.string().trim().min(1),
  sport: z.string().trim().min(1),
  playerName: z.string().trim().min(1),
  cardNumber: z.string().trim().min(1),
});

async function handler(req: NextApiRequest, res: NextApiResponse<LookupSetResponse>) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const payload = lookupSetSchema.parse(req.body ?? {});

    const normalizedCardNumber = normalizeCardNumber(payload.cardNumber);
    if (!normalizedCardNumber) {
      return res.status(400).json({ message: "Card number is required." });
    }

    const yearPrefix = buildLookupSetYearPrefix(payload.year, payload.sport);
    if (!yearPrefix) {
      return res.status(400).json({ message: "Year must be a valid four-digit year." });
    }
    const result = await lookupSetByCardIdentity(payload);
    return res.status(200).json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
