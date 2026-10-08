import type { prisma } from "@tenkings/database";
import { StripeWebhookError, stripeEventIdentity, type StripeObservation } from "./stripeWebhook";

/** Insert-only receipt; a replay can never overwrite the original verified observation. */
export async function persistStripeObservation(db: typeof prisma, observation: StripeObservation, payloadDigest: string): Promise<"INSERTED" | "DUPLICATE"> {
  const identity = stripeEventIdentity(observation.eventId);
  const original = await db.vaultStripeObservation.findUnique({ where: { id: identity } });
  if (original) {
    if (original.payloadDigest !== payloadDigest) throw new StripeWebhookError(409, "STRIPE_EVENT_ID_CONFLICT");
    return "DUPLICATE";
  }
  try {
    await db.vaultStripeObservation.create({ data: {
      id: identity, stripeEventId: observation.eventId, payloadDigest,
      machineId: observation.machineId, saleId: observation.saleId, readerId: observation.readerId,
      locationId: observation.locationId, paymentIntentId: observation.paymentIntentId,
      requestDigest: observation.requestDigest, totalCents: observation.totalCents, currency: observation.currency,
      observedStatus: observation.status, eventType: observation.eventType,
      eventCreatedAt: new Date(observation.eventCreated * 1000), verifiedAt: new Date(observation.verifiedAt),
    } });
    return "INSERTED";
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") throw error;
    const raced = await db.vaultStripeObservation.findUnique({ where: { id: identity } });
    if (!raced || raced.payloadDigest !== payloadDigest) throw new StripeWebhookError(409, "STRIPE_EVENT_ID_CONFLICT");
    return "DUPLICATE";
  }
}

/** Caller must authenticate the exact machine before entering this read boundary. */
export async function stripeObservationHints(db: typeof prisma, machineId: string, saleId: string) {
  const sale = await db.vaultSale.findFirst({ where: { id: saleId, machineId } });
  if (!sale) throw new StripeWebhookError(409, "STRIPE_SALE_PROJECTION_PENDING");
  if (sale.mode !== "CERTIFICATION") throw new StripeWebhookError(409, "STRIPE_TEST_SALE_REQUIRED");
  const observations = await db.vaultStripeObservation.findMany({
    where: { machineId, saleId, totalCents: sale.totalCents, currency: sale.currency.toLowerCase() },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 100,
    select: { stripeEventId: true, paymentIntentId: true, requestDigest: true, readerId: true, locationId: true, receivedAt: true },
  });
  return { instruction: "RECONCILE_ONLY" as const, saleId, observations };
}
