import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { stripeObservationHints } from "../../../../../lib/server/vaultV1/stripeInbox";
import { StripeWebhookError } from "../../../../../lib/server/vaultV1/stripeWebhook";
import { requireVaultMachine, sendVaultError, VaultApiError, vaultRequestId } from "../../../../../lib/server/vaultV1/http";

/** Hints only. The machine must retrieve Stripe again and verify its persisted request. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); res.status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
  try {
    const { machineId, saleId } = req.query;
    if (typeof machineId !== "string" || typeof saleId !== "string" || !/^[0-9a-f-]{36}$/.test(machineId) || !/^[0-9a-f-]{36}$/.test(saleId)) throw new VaultApiError(400, "STRIPE_HINT_QUERY_INVALID", "Machine and sale identifiers are required");
    await requireVaultMachine(req, machineId);
    res.status(200).json({ requestId, ...await stripeObservationHints(prisma, machineId, saleId) });
  } catch (error) { sendVaultError(res, requestId, error instanceof StripeWebhookError ? new VaultApiError(error.status, error.code, "Stripe reconciliation observations unavailable") : error); }
}
