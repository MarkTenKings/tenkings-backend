import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { sparkObservationHints, sparkReceiptBinding } from "../../../../../lib/server/vaultV1/sparkInbox";
import { requireSparkStage, configuredSparkBindings, sparkStage, sparkUuid, SparkWebhookError } from "../../../../../lib/server/vaultV1/sparkWebhook";
import { requireVaultMachine, sendVaultError, VaultApiError, vaultRequestId } from "../../../../../lib/server/vaultV1/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = vaultRequestId(req);
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); res.status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
  try {
    const { machineId, sparkTransactionId } = req.query;
    if (!sparkUuid(machineId) || !sparkUuid(sparkTransactionId)) throw new SparkWebhookError(400, "SPARK_HINT_QUERY_INVALID");
    await requireVaultMachine(req, machineId.toLowerCase());
    const stage = sparkStage(req.query.stage);
    const { paymentBindingDigest } = sparkReceiptBinding(stage, req.query.paymentBindingDigest);
    requireSparkStage(process.env, stage);
    if (!configuredSparkBindings(process.env, stage).some(binding => binding.machineId === machineId.toLowerCase())) throw new SparkWebhookError(403, "SPARK_MACHINE_UNBOUND");
    res.status(200).json({ requestId, ...await sparkObservationHints(prisma, machineId.toLowerCase(), sparkTransactionId.toLowerCase(), stage, paymentBindingDigest) });
  } catch (error) { sendVaultError(res, requestId, error instanceof SparkWebhookError ? new VaultApiError(error.status, error.code, "Spark reconciliation observations unavailable") : error); }
}
