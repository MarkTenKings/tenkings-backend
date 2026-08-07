import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  TenKingsV2NfcHostedError,
  completeTenKingsV2NfcCardJob,
  getTenKingsV2NfcCard,
  issueTenKingsV2NfcCardJob,
  searchTenKingsV2NfcCards,
  tenKingsV2NfcReadiness,
} from "../../../../../lib/server/tenKingsV2NfcHosted";

const cardId = z.string().trim().min(1).max(160);
const issueSchema = z.object({ cardId }).strict();
const completeSchema = z.object({
  job: z.record(z.string(), z.string()),
  result: z.record(z.string(), z.string()),
}).strict();

const actionFrom = (req: NextApiRequest) => {
  const value = req.query.action;
  return Array.isArray(value) && value.length === 1 ? value[0] : null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    const admin = await requireAdminSession(req);
    const action = actionFrom(req);
    if (req.method === "GET" && action === "status") {
      return res.status(200).json({ readiness: tenKingsV2NfcReadiness() });
    }
    if (req.method === "GET" && action === "cards") {
      const query = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
      if (typeof query !== "string") return res.status(400).json({ message: "Enter a card, certificate, token, player, or card number." });
      return res.status(200).json({ cards: await searchTenKingsV2NfcCards(query) });
    }
    if (req.method === "GET" && action === "card") {
      const value = Array.isArray(req.query.cardId) ? req.query.cardId[0] : req.query.cardId;
      const parsed = cardId.safeParse(value);
      if (!parsed.success) return res.status(400).json({ message: "Invalid permanent card identity." });
      const card = await getTenKingsV2NfcCard(parsed.data);
      return card ? res.status(200).json({ card }) : res.status(404).json({ message: "Permanent card not found." });
    }
    if (req.method === "POST" && action === "issue") {
      const parsed = issueSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid NFC V2 job request." });
      return res.status(200).json(await issueTenKingsV2NfcCardJob(parsed.data.cardId));
    }
    if (req.method === "POST" && action === "complete") {
      const parsed = completeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid NFC V2 completion evidence." });
      const completion = await completeTenKingsV2NfcCardJob({
        job: parsed.data.job as never,
        result: parsed.data.result as never,
        adminId: admin.user.id,
      });
      console.info("[TenKingsV2Nfc] terminal_result", {
        outcome: completion.outcome,
        cardId: completion.card.id,
        workstationKeyId: completion.card.nfcVerifiedByWorkstationId,
      });
      return res.status(200).json({
        outcome: completion.outcome,
        nfcVerifiedAt: completion.card.nfcVerifiedAt?.toISOString() ?? null,
      });
    }
    res.setHeader("Allow", action === "status" || action === "cards" || action === "card" ? "GET" : "POST");
    return res.status(405).json({ message: "Method not allowed." });
  } catch (error) {
    if (error instanceof TenKingsV2NfcHostedError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
