import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export class StripeWebhookError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export type StripeBinding = { machineId: string; readerId: string; locationId: string };
export type StripeObservation = StripeBinding & {
  eventId: string; eventType: string; paymentIntentId: string; saleId: string;
  requestDigest: string; totalCents: number; currency: "usd"; status: string;
  eventCreated: number; verifiedAt: string; instruction: "RECONCILE_ONLY";
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (value: unknown, prefix: string): value is string => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{1,200}$`).test(value);
const object = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
export function stripeBindings(raw: string | undefined): StripeBinding[] {
  let values: unknown;
  try { values = JSON.parse(raw ?? "[]"); } catch { throw new StripeWebhookError(503, "STRIPE_BINDINGS_INVALID"); }
  if (!Array.isArray(values) || values.length > 1000) throw new StripeWebhookError(503, "STRIPE_BINDINGS_INVALID");
  const machines = new Set(), readers = new Set();
  return values.map(value => {
    const b = object(value);
    if (!uuid.test(b.machineId) || !id(b.readerId, "tmr") || !id(b.locationId, "tml") || machines.has(b.machineId) || readers.has(b.readerId)) throw new StripeWebhookError(503, "STRIPE_BINDINGS_INVALID");
    machines.add(b.machineId); readers.add(b.readerId);
    return { machineId: b.machineId, readerId: b.readerId, locationId: b.locationId };
  });
}
/** Exact raw-body HMAC, rotating v1 signatures, and five-minute replay window. */
export function verifyStripeEvent(body: Buffer, signature: unknown, secret: string, now = Date.now()): Record<string, any> {
  if (!secret.startsWith("whsec_") || secret.length < 16) throw new StripeWebhookError(503, "STRIPE_WEBHOOK_UNCONFIGURED");
  if (body.length > 262144) throw new StripeWebhookError(413, "STRIPE_BODY_TOO_LARGE");
  if (typeof signature !== "string" || signature.length > 4096) throw new StripeWebhookError(400, "STRIPE_SIGNATURE_INVALID");
  const parts = signature.split(",").map(p => p.trim().split("="));
  const times = parts.filter(([k]) => k === "t");
  const timestamp = times[0]?.[1] ?? "";
  if (times.length !== 1 || !/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new StripeWebhookError(400, "STRIPE_SIGNATURE_EXPIRED");
  const expected = createHmac("sha256", secret).update(timestamp + ".").update(body).digest();
  if (!parts.some(([k,v]) => k === "v1" && /^[a-f0-9]{64}$/.test(v ?? "") && timingSafeEqual(expected, Buffer.from(v!, "hex")))) throw new StripeWebhookError(400, "STRIPE_SIGNATURE_INVALID");
  let event;
  try { event = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); } catch { throw new StripeWebhookError(400, "STRIPE_BODY_INVALID"); }
  if (!id(event.id, "evt") || event.object !== "event" || !Number.isSafeInteger(event.created) || event.created < 0 || event.created > 8640000000000 || typeof event.type !== "string") throw new StripeWebhookError(400, "STRIPE_EVENT_INVALID");
  if (event.livemode !== false || event.account != null || event.context != null) throw new StripeWebhookError(400, "STRIPE_TEST_ACCOUNT_REQUIRED");
  return event;
}
export function stripeEventIdentity(eventId: string): string { return "stripe-test:" + eventId; }
export function stripeBodyDigest(body: Buffer): string { return createHash("sha256").update(body).digest("hex"); }

const events = new Set(["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "payment_intent.processing", "terminal.reader.action_succeeded", "terminal.reader.action_failed"]);
export async function buildStripeObservation(event: Record<string, any>, bindings: StripeBinding[], retrieve: (path: string) => Promise<unknown>, now = Date.now()): Promise<StripeObservation | null> {
  if (!events.has(event.type)) return null;
  const source = object(object(event.data).object);
  const readerEvent = event.type.startsWith("terminal.reader.");
  if (readerEvent && object(source.action).type !== "process_payment_intent") return null;
  const intentId = readerEvent ? object(object(source.action).process_payment_intent).payment_intent : source.id;
  // Reader events for other actions and unrelated online payments are intentionally ignored.
  if (readerEvent && !bindings.some(b => b.readerId === source.id)) return null;
  if (!readerEvent && !object(source.metadata).vault_machine_id) return null;
  if (!id(intentId, "pi")) throw new StripeWebhookError(422, "STRIPE_INTENT_INVALID");
  const intent = object(await retrieve(`/payment_intents/${intentId}`));
  const meta = object(intent.metadata);
  const binding = bindings.find(b => b.machineId === meta.vault_machine_id);
  if (!binding) throw new StripeWebhookError(422, "STRIPE_MACHINE_UNBOUND");
  if (intent.id !== intentId || intent.object !== "payment_intent" || intent.livemode !== false || intent.currency !== "usd"
      || intent.capture_method !== "automatic" || !Array.isArray(intent.payment_method_types) || !intent.payment_method_types.includes("card_present")
      || meta.vault_reader_id !== binding.readerId || meta.vault_location_id !== binding.locationId
      || !uuid.test(meta.vault_sale_id) || !/^[a-f0-9]{64}$/.test(meta.vault_request_digest)
      || !Number.isSafeInteger(intent.amount) || intent.amount < 50 || intent.amount > 99999999 || meta.vault_total_cents !== String(intent.amount)
      || (readerEvent && source.id !== binding.readerId)
      || !["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"].includes(intent.status)) throw new StripeWebhookError(422, "STRIPE_BINDING_MISMATCH");
  const reader = object(await retrieve(`/terminal/readers/${binding.readerId}`));
  if (reader.id !== binding.readerId || reader.object !== "terminal.reader" || reader.livemode !== false || reader.location !== binding.locationId) throw new StripeWebhookError(422, "STRIPE_READER_MISMATCH");
  return { ...binding, eventId: event.id, eventType: event.type, eventCreated: event.created,
    paymentIntentId: intentId, saleId: meta.vault_sale_id, requestDigest: meta.vault_request_digest,
    totalCents: intent.amount, currency: "usd", status: intent.status, verifiedAt: new Date(now).toISOString(), instruction: "RECONCILE_ONLY" };
}
export function stripeTestRetriever(secret: string, transport: typeof fetch = fetch) {
  if (!/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(secret)) throw new StripeWebhookError(503, "STRIPE_TEST_KEY_REQUIRED");
  return async (path: string): Promise<unknown> => {
    if (!/^\/(payment_intents\/pi_|terminal\/readers\/tmr_)[A-Za-z0-9]{1,200}$/.test(path)) throw new StripeWebhookError(422, "STRIPE_PATH_INVALID");
    try {
      const response = await transport(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": "2024-06-20" }, signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw new Error("provider unavailable");
      if (!response.body) throw new Error("empty provider response");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          length += next.value.length;
          if (length > 262144) { await reader.cancel(); throw new Error("provider response too large"); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { throw new StripeWebhookError(503, "STRIPE_RETRIEVAL_UNAVAILABLE"); }
  };
}
