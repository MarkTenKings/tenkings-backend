import type { prisma } from "@tenkings/database";
import { SparkWebhookError, sparkStage, type SparkStage, type SparkReceipt } from "./sparkWebhook";

/** Independent insert-only callback inbox; never writes a sale, outbox event or door. */
export async function persistSparkReceipt(db: typeof prisma, receipt: SparkReceipt): Promise<"INSERTED" | "DUPLICATE"> {
  const { observation, vaultMachineId, payloadDigest } = receipt;
  const stage = sparkStage(receipt.stage);
  if (observation.receiptId !== `spark-${stage.toLowerCase()}:${payloadDigest}`
    || stage === "PRODUCTION" && (observation.stage !== stage || !/^[a-f0-9]{64}$/.test(observation.paymentBindingDigest ?? ""))
    || stage === "SANDBOX" && (observation.stage != null && observation.stage !== stage || observation.paymentBindingDigest != null))
    throw new SparkWebhookError(409, "SPARK_RECEIPT_STAGE_CONFLICT");
  return db.$transaction(async tx => {
    // Acquire before allocating the sequence. For a given machine, a later
    // visible cursor can never overtake an earlier uncommitted receipt.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${vaultMachineId}, 0))`;
    const existing = await tx.vaultSparkObservation.findUnique({ where: { id: observation.receiptId } });
    if (existing) {
      if (existing.payloadDigest !== payloadDigest || existing.machineId !== vaultMachineId || (existing.stage ?? "SANDBOX") !== stage || (existing.paymentBindingDigest ?? null) !== (observation.paymentBindingDigest ?? null)) throw new SparkWebhookError(409, "SPARK_RECEIPT_CONFLICT");
      return "DUPLICATE";
    }
    const { receiptId, machineId: nayaxMachineId, ...fields } = observation;
    await tx.vaultSparkObservation.create({ data: { id: receiptId, machineId: vaultMachineId, nayaxMachineId, payloadDigest, ...fields, stage } });
    return "INSERTED";
  });
}

const observationSelection = { stage: true, paymentBindingDigest: true, id: true, kind: true, sparkTransactionId: true, nayaxTransactionId: true, nayaxMachineId: true,
  terminalId: true, hwSerial: true, siteId: true, amountCents: true, currency: true, currencySource: true,
  verdict: true, errorCode: true, machineAuTime: true, methodClassification: true, methodEvidence: true, methodProfileDigest: true } as const;
const legacyMethodEvidence = { cardUidPresent: false, cardBrandClass: "ABSENT", authCodePresent: false, rrnPresent: false };
function normalizedObservation<T extends { id: string; nayaxMachineId: string; methodEvidence?: unknown; methodClassification?: string; stage?: string; paymentBindingDigest?: string | null }>(record: T) {
  const { id, nayaxMachineId, stage, paymentBindingDigest, ...fields } = record;
  const evidence = record.methodEvidence;
  return { ...(stage === "PRODUCTION" ? { stage: "PRODUCTION" as const, paymentBindingDigest } : {}), ...fields, receiptId: id, machineId: nayaxMachineId, methodClassification: record.methodClassification ?? "AMBIGUOUS",
    methodEvidence: evidence && typeof evidence === "object" && Object.keys(evidence).length ? evidence : legacyMethodEvidence };
}

/** A production journal consumes only its immutable binding, including after rotation. */
export function sparkReceiptBinding(stage: SparkStage, value: unknown): { paymentBindingDigest?: string } {
  sparkStage(stage);
  if (stage === "PRODUCTION") {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new SparkWebhookError(400, "SPARK_RECEIPT_BINDING_REQUIRED");
    return { paymentBindingDigest: value };
  }
  if (value !== undefined) throw new SparkWebhookError(400, "SPARK_RECEIPT_BINDING_STAGE_INVALID");
  return {};
}

/** Exact authenticated machine only. Local adapter must bind its durable session before interpreting evidence. */
export async function sparkObservationHints(db: typeof prisma, machineId: string, sparkTransactionId: string, stage: SparkStage = "SANDBOX", paymentBindingDigest?: string) {
  const binding = sparkReceiptBinding(stage, paymentBindingDigest);
  const records = await db.vaultSparkObservation.findMany({
    where: { machineId, sparkTransactionId, stage, ...binding }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: 101,
    select: observationSelection,
  });
  // Never drop old contradictory receipts from an apparently complete response.
  if (records.length > 100) throw new SparkWebhookError(409, "SPARK_OBSERVATION_LIMIT_REVIEW_REQUIRED");
  return { instruction: "RECONCILE_ONLY" as const, sparkTransactionId, observations: records.map(normalizedObservation) };
}

export function sparkReceiptCursor(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

/** Includes all sessions, even completed, locally cancelled or absent after restore. */
export async function sparkReceiptFeed(db: typeof prisma, machineId: string, after: string, stage: SparkStage = "SANDBOX", paymentBindingDigest?: string) {
  const binding = sparkReceiptBinding(stage, paymentBindingDigest);
  if (!sparkReceiptCursor(after)) throw new SparkWebhookError(400, "SPARK_RECEIPT_CURSOR_INVALID");
  const records = await db.vaultSparkObservation.findMany({ where: { machineId, stage, ...binding, receiptSequence: { gt: BigInt(after) } },
    orderBy: { receiptSequence: "asc" }, take: 101, select: { ...observationSelection, receiptSequence: true } });
  const page = records.slice(0, 100);
  return { instruction: "RECONCILE_ONLY" as const, nextCursor: page.at(-1)?.receiptSequence.toString() ?? after, hasMore: records.length > 100,
    observations: page.map(({ receiptSequence: _sequence, ...record }) => normalizedObservation(record)) };
}
