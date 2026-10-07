import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { buildStripeObservation, stripeBindings, stripeBodyDigest, stripeEventIdentity, stripeTestRetriever, StripeWebhookError, verifyStripeEvent } from "../../../../../lib/server/vaultV1/stripeWebhook";
import { persistStripeObservation } from "../../../../../lib/server/vaultV1/stripeInbox";

export const config = { api: { bodyParser: false } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "METHOD_NOT_ALLOWED" }); return; }
  try {
    if (process.env.VAULT_STRIPE_WEBHOOK_ENABLED !== "true") throw new StripeWebhookError(503, "STRIPE_WEBHOOK_DISABLED");
    if (String(req.headers["content-type"] ?? "").split(";")[0]?.trim() !== "application/json") throw new StripeWebhookError(415, "STRIPE_CONTENT_TYPE_INVALID");
    const chunks: Buffer[] = []; let count = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      count += bytes.length;
      if (count > 262144) throw new StripeWebhookError(413, "STRIPE_BODY_TOO_LARGE");
      chunks.push(bytes);
    }
    const body = Buffer.concat(chunks);
    const event = verifyStripeEvent(body, req.headers["stripe-signature"], process.env.VAULT_STRIPE_TEST_WEBHOOK_SECRET ?? "");
    const payloadDigest = stripeBodyDigest(body);
    const existing = await prisma.vaultStripeObservation.findUnique({ where: { id: stripeEventIdentity(event.id) }, select: { payloadDigest: true } });
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) throw new StripeWebhookError(409, "STRIPE_EVENT_ID_CONFLICT");
      res.status(200).json({ received: true, duplicate: true }); return;
    }
    const observation = await buildStripeObservation(event, stripeBindings(process.env.VAULT_STRIPE_TEST_BINDINGS_JSON), stripeTestRetriever(process.env.VAULT_STRIPE_TEST_SECRET_KEY ?? ""));
    if (!observation) { res.status(200).json({ received: true, ignored: true }); return; }
    await persistStripeObservation(prisma, observation, payloadDigest);
    res.status(200).json({ received: true });
  } catch (error) {
    // Never return provider payload, raw body, credentials, or database diagnostics.
    res.status(error instanceof StripeWebhookError ? error.status : 503).json({ error: error instanceof StripeWebhookError ? error.code : "STRIPE_INBOX_UNAVAILABLE" });
  }
}
