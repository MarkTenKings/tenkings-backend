import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { authenticateSparkCallback, buildSparkReceipt, readSparkBody, configuredSparkBindings, SparkWebhookError, type SparkStage, type SparkCallbackKind } from "../../../../../lib/server/vaultV1/sparkWebhook";
import { persistSparkReceipt } from "../../../../../lib/server/vaultV1/sparkInbox";

export const config = { api: { bodyParser: false } };
const kinds: Record<string, SparkCallbackKind> = { TransactionCallback: "TRANSACTION", DeclineCallback: "DECLINE", TimeoutCallback: "TIMEOUT" };
export async function receiveSparkCallback(req: NextApiRequest, res: NextApiResponse, stage: SparkStage) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
  try {
    const kind = typeof req.query.callback === "string" && Object.hasOwn(kinds, req.query.callback) ? kinds[req.query.callback] : undefined;
    if (!kind) throw new SparkWebhookError(404, "SPARK_CALLBACK_UNKNOWN");
    authenticateSparkCallback(req.headers, process.env, stage);
    if (String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() !== "application/json") throw new SparkWebhookError(415, "SPARK_CONTENT_TYPE_INVALID");
    const receipt = buildSparkReceipt(await readSparkBody(req), kind, configuredSparkBindings(process.env, stage), stage);
    await persistSparkReceipt(prisma, receipt);
    // Nayax expects HTTP 200. A failed durable insert must never be acknowledged.
    res.status(200).end();
  } catch (error) {
    res.status(error instanceof SparkWebhookError ? error.status : 503).json({ error: error instanceof SparkWebhookError ? error.code : "SPARK_INBOX_UNAVAILABLE" });
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) { return receiveSparkCallback(req, res, "SANDBOX"); }
