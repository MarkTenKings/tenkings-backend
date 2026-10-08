import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { sparkReceiptFeed, sparkReceiptCursor, sparkReceiptBinding } from "../../../../../lib/server/vaultV1/sparkInbox";
import { requireSparkStage, configuredSparkBindings, sparkStage, sparkUuid, SparkWebhookError } from "../../../../../lib/server/vaultV1/sparkWebhook";
import { requireVaultMachine, sendVaultError, VaultApiError, vaultRequestId } from "../../../../../lib/server/vaultV1/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "METHOD_NOT_ALLOWED" }); }
  try {
    const { machineId, after = "0" } = req.query;
    if (!sparkUuid(machineId) || !sparkReceiptCursor(after)) throw new SparkWebhookError(400, "SPARK_FEED_QUERY_INVALID");
    await requireVaultMachine(req, machineId.toLowerCase());
    const stage = sparkStage(req.query.stage);
    const { paymentBindingDigest } = sparkReceiptBinding(stage, req.query.paymentBindingDigest);
    requireSparkStage(process.env, stage);
    if (!configuredSparkBindings(process.env, stage).some(binding => binding.machineId === machineId.toLowerCase())) throw new SparkWebhookError(403, "SPARK_MACHINE_UNBOUND");
    return res.status(200).json({ requestId, ...await sparkReceiptFeed(prisma, machineId.toLowerCase(), after, stage, paymentBindingDigest) });
  } catch (error) { sendVaultError(res, requestId, error instanceof SparkWebhookError ? new VaultApiError(error.status, error.code, "Spark receipt feed unavailable") : error); }
}
