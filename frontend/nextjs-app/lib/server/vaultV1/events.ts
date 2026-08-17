import { createHash } from "node:crypto";
import { type Prisma, normalizeVaultEventPayload, vaultPayloadDigest } from "@tenkings/database";
import {
  calculateTaxCents,
  VaultConfigPayloadSchema,
  VaultDoorIdSchema,
  VaultPaymentStateSchema,
  type VaultMachineEvent,
} from "@tenkings/vault-contracts";
import { z } from "zod";
import { VaultApiError } from "./http";

type Transaction = Prisma.TransactionClient;
type ProjectionEvent = VaultMachineEvent & { payload: Record<string, unknown> };

const uuid = z.string().uuid();
const boundedId = z.string().min(1).max(256);
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const doorIds = z.array(VaultDoorIdSchema).min(1).max(150).refine((values) => new Set(values).size === values.length);
const empty = z.object({}).strict();
const saleItemSnapshot = z.object({
  lineId: uuid,
  doorId: VaultDoorIdSchema,
  productId: boundedId,
  productName: z.string().min(1).max(160),
  photoUrl: z.string().url().max(2048),
  description: z.string().max(2000),
  category: z.enum(["SPORTS", "POKEMON"]),
  priceCents: nonnegativeInteger,
  taxClass: z.string().min(1).max(80),
  controllerChannel: z.number().int().min(1).max(150),
  mappingVersion: z.string().min(1).max(128),
}).strict();
const projectedCommand = z.object({ commandId: boundedId, doorId: VaultDoorIdSchema, attempt: z.union([z.literal(1), z.literal(2)]) }).strict();

const EVENT_PAYLOAD_SCHEMAS = {
  STAFF_GRANT_IMPORTED: z.object({ grantId: uuid, userId: boundedId, role: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]), verifierVersion: positiveInteger, revoked: z.boolean() }).strict(),
  STAFF_AUTHENTICATED: z.object({ sessionId: z.literal("[REDACTED]"), role: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]), grantId: uuid }).strict(),
  SERVICE_SESSION_LOCKED: z.object({ sessionId: z.literal("[REDACTED]"), reason: z.string().min(1).max(160) }).strict(),
  SERVICE_SAFE_EXIT: z.object({ sessionId: z.literal("[REDACTED]"), physicalCloseConfirmed: z.literal(true) }).strict(),
  STAFF_AUTH_FAILED: z.object({ userId: boundedId, reason: z.string().min(1).max(160) }).strict(),
  CONFIG_STAGED: z.object({ version: positiveInteger, digest: z.string().regex(/^[a-f0-9]{64}$/), keyId: boundedId }).strict(),
  CONFIG_ACTIVATED: z.object({ version: positiveInteger }).strict(),
  SALE_RECOVERY_EVALUATED: z.object({ saleId: uuid }).strict(),
  CLOUD_FRESHNESS_PROVEN: z.object({ observedAt: z.string().datetime() }).strict(),
  PUBLIC_ACTIVITY_RECORDED: z.object({ observedAt: z.string().datetime() }).strict(),
  PUBLIC_IDLE_CART_RESET: z.object({ observedAt: z.string().datetime() }).strict(),
  CART_DOOR_SELECTED: z.object({ doorId: VaultDoorIdSchema, productId: boundedId }).strict(),
  CART_DOOR_REMOVED: z.object({ doorId: VaultDoorIdSchema, productId: boundedId }).strict(),
  CART_SECURE_PICK_PERSISTED: z.object({ doorId: VaultDoorIdSchema, productId: boundedId, candidateCount: positiveInteger }).strict(),
  CHECKOUT_RESERVATION_CONFLICT: z.object({ conflictedDoorIds: z.array(VaultDoorIdSchema).max(150), preservedDoorIds: z.array(VaultDoorIdSchema).max(150) }).strict(),
  SALE_RESERVED: z.object({
    saleId: uuid,
    supportReference: z.string().regex(/^[A-Z0-9]{6,12}$/),
    configVersion: positiveInteger,
    configDigest: z.string().regex(/^[a-f0-9]{64}$/),
    timezone: z.string().min(1).max(80),
    city: z.string().min(1).max(100),
    state: z.string().min(2).max(64),
    taxRateBasisPoints: z.number().int().min(0).max(10_000),
    taxCalculationVersion: z.string().min(1).max(128),
    subtotalCents: nonnegativeInteger,
    taxCents: nonnegativeInteger,
    totalCents: nonnegativeInteger,
    currency: z.literal("USD"),
    items: z.array(saleItemSnapshot).min(1).max(150).refine((items) => new Set(items.map((item) => item.doorId)).size === items.length && new Set(items.map((item) => item.lineId)).size === items.length),
  }).strict(),
  PAYMENT_INTENT_RECORDED: z.object({ saleId: uuid, totalCents: nonnegativeInteger }).strict(),
  PAYMENT_START_EFFECT_UNKNOWN: z.object({ saleId: uuid, errorClass: z.string().min(1).max(160) }).strict(),
  PAYMENT_CALLBACK_CONFLICT_QUARANTINED: z.object({ callbackId: boundedId }).strict(),
  PAYMENT_CALLBACK_APPLIED: z.object({ callbackId: boundedId, sequence: nonnegativeInteger, state: VaultPaymentStateSchema, disposition: z.literal("APPLIED") }).strict(),
  PAYMENT_CALLBACK_QUARANTINED: z.object({ callbackId: boundedId, sequence: nonnegativeInteger, state: VaultPaymentStateSchema, disposition: z.enum(["SESSION_CONFLICT", "OUT_OF_ORDER", "SEQUENCE_CONFLICT"]) }).strict(),
  PAID_DOOR_GROUP_RETRY_COMMITTED: z.object({ saleId: uuid, commands: z.array(projectedCommand.extend({ attempt: z.literal(2) })).min(1).max(150) }).strict(),
  PUBLIC_PRESENTATION_DONE: z.object({ saleId: uuid }).strict(),
  CONTROLLER_DISPATCH_BOUNDARY_ENTERED: z.object({ commandId: boundedId, doorId: VaultDoorIdSchema, attempt: z.union([z.literal(1), z.literal(2)]), authority: z.enum(["PAID_SALE", "RESTOCK", "CERTIFICATION"]) }).strict(),
  CONTROLLER_COMMAND_TERMINAL: z.object({ commandId: boundedId, expectedDoorId: VaultDoorIdSchema, observedDoorId: VaultDoorIdSchema.nullable(), outcome: z.enum(["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"]), controllerSequence: positiveInteger, evidenceCode: z.string().max(160).nullable() }).strict(),
  CRITICAL_WRONG_DOOR_OBSERVED: z.object({ commandId: boundedId, expectedDoorId: VaultDoorIdSchema, observedDoorId: VaultDoorIdSchema, outcome: z.enum(["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"]), controllerSequence: positiveInteger, evidenceCode: z.string().max(160).nullable() }).strict(),
  CONTROLLER_EFFECT_REMAINS_UNKNOWN: z.object({ commandId: boundedId, errorClass: z.string().min(1).max(160) }).strict(),
  FULFILLMENT_COMMITTED: z.object({ saleId: uuid, commands: z.array(projectedCommand.extend({ attempt: z.literal(1) })).min(1).max(150) }).strict(),
  PAYMENT_DECLINED_RESERVATION_RELEASED: z.object({ saleId: uuid }).strict(),
  PAYMENT_CANCELLED_RESERVATION_RELEASED: z.object({ saleId: uuid }).strict(),
  PAYMENT_RECOVERY_INTENT_DIGEST_CONFLICT: z.object({ saleId: uuid }).strict(),
  PAYMENT_RECOVERY_EFFECT_UNRESOLVED: z.object({ saleId: uuid }).strict(),
  PAYMENT_RECOVERY_RECONCILIATION_REQUIRED: z.object({ saleId: uuid }).strict(),
  RESTOCK_SESSION_STARTED: z.object({ restockSessionId: uuid, expectedDoorIds: doorIds, plannedItems: z.array(z.object({ doorId: VaultDoorIdSchema, plannedProductId: boundedId.nullable() }).strict()).min(1).max(150), configVersion: positiveInteger }).strict(),
  RESTOCK_DOOR_REVIEWED: z.object({ restockSessionId: uuid, doorId: VaultDoorIdSchema, outcome: z.enum(["FILLED", "LEFT_EMPTY", "EXCEPTION"]), notes: z.string().max(1000) }).strict(),
  RESTOCK_SESSION_FINALIZED: z.object({ restockSessionId: uuid, physicalCloseConfirmed: z.literal(true), filled: nonnegativeInteger, leftEmpty: nonnegativeInteger, exceptions: nonnegativeInteger }).strict(),
  RESTOCK_DOOR_COMMAND_COMMITTED: z.object({ restockSessionId: uuid, commandId: boundedId, doorId: VaultDoorIdSchema }).strict(),
  CERTIFICATION_SESSION_STARTED: z.object({
    certificationSessionId: uuid,
    configVersion: positiveInteger,
    configDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCommit: z.string().min(1).max(128),
    appVersion: z.string().min(1).max(64),
    localSchemaVersion: nonnegativeInteger,
    contractVersion: z.literal(1),
    adapterMode: z.enum(["MOCK", "OFFICIAL_TEST", "LIVE"]),
    controllerIdentity: z.record(z.string(), z.unknown()),
    paymentIdentity: z.record(z.string(), z.unknown()),
    retentionPolicy: z.literal("SERVICE_LIFE_PLUS_3_YEARS"),
  }).strict(),
  CERTIFICATION_COMMAND_COMMITTED: z.object({ certificationSessionId: uuid, commandId: boundedId, scheduledDoorId: VaultDoorIdSchema, sequence: positiveInteger }).strict(),
  CERTIFICATION_EVIDENCE_RECORDED: z.object({ evidenceId: uuid, certificationSessionId: uuid, doorId: VaultDoorIdSchema.nullable(), evidenceClass: z.enum(["AUTOMATED", "OFFICIAL_SDK", "BENCH", "FULL_MACHINE", "FIELD"]), outcome: z.enum(["PASS", "FAIL"]), expectedDoorIds: z.array(VaultDoorIdSchema).max(150), observedDoorIds: z.array(VaultDoorIdSchema).max(150), notes: z.string().max(4000), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), unexpectedDoor: z.literal(false) }).strict(),
  CERTIFICATION_CRITICAL_STOP: z.object({ evidenceId: uuid, certificationSessionId: uuid, doorId: VaultDoorIdSchema.nullable(), evidenceClass: z.enum(["AUTOMATED", "OFFICIAL_SDK", "BENCH", "FULL_MACHINE", "FIELD"]), outcome: z.literal("CRITICAL"), expectedDoorIds: z.array(VaultDoorIdSchema).max(150), observedDoorIds: z.array(VaultDoorIdSchema).max(150), notes: z.string().max(4000), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), unexpectedDoor: z.boolean() }).strict(),
  CERTIFICATION_SUBMITTED: z.object({ certificationSessionId: uuid, physicalCloseConfirmed: z.literal(true), passCount: nonnegativeInteger, failCount: nonnegativeInteger }).strict(),
} as const;

export type SupportedVaultEventType = keyof typeof EVENT_PAYLOAD_SCHEMAS;

export function normalizeTypedVaultEvent(event: VaultMachineEvent): ProjectionEvent {
  const schema = EVENT_PAYLOAD_SCHEMAS[event.type as SupportedVaultEventType];
  if (!schema) throw new VaultApiError(422, "EVENT_TYPE_UNSUPPORTED", `Unsupported Vault event type: ${event.type}`);
  let bounded: Record<string, unknown>;
  try {
    bounded = normalizeVaultEventPayload(event.payload) as Record<string, unknown>;
  } catch (error) {
    throw new VaultApiError(422, "EVENT_PAYLOAD_BOUNDS", error instanceof Error ? error.message : "Event payload is outside allowed bounds");
  }
  const parsed = schema.safeParse(bounded);
  if (!parsed.success) {
    throw new VaultApiError(422, "EVENT_PAYLOAD_INVALID", `Invalid payload for ${event.type}`, parsed.error.issues);
  }
  return { ...event, payload: parsed.data };
}

export function vaultEventDigest(event: VaultMachineEvent): string {
  return vaultPayloadDigest(event);
}

function supportCaseReference(machineId: string, type: string, sourceId: string): string {
  return createHash("sha256").update(`${machineId}\u001f${type}\u001f${sourceId}`).digest("hex").slice(0, 12).toUpperCase();
}

async function requireProjectedSale(tx: Transaction, machineId: string, saleId: string) {
  const sale = await tx.vaultSale.findFirst({ where: { id: saleId, machineId } });
  if (!sale) throw new VaultApiError(422, "SALE_PROJECTION_MISSING", "A sale lifecycle event arrived before SALE_RESERVED");
  return sale;
}

async function openSafeSupportCase(tx: Transaction, input: {
  machineId: string;
  saleId?: string | null;
  sourceId: string;
  type: "PAYMENT_UNKNOWN" | "PAYMENT_RECONCILIATION" | "DOOR_COMMAND" | "CERTIFICATION";
  affectedDoorIds?: string[];
  summary: string;
}) {
  const shortReference = supportCaseReference(input.machineId, input.type, input.sourceId);
  await tx.vaultSupportCase.upsert({
    where: { machineId_shortReference: { machineId: input.machineId, shortReference } },
    create: {
      machineId: input.machineId,
      saleId: input.saleId ?? null,
      shortReference,
      type: input.type,
      affectedDoorIds: (input.affectedDoorIds ?? []) as Prisma.InputJsonValue,
      customerSafeSummary: input.summary,
      internalSummary: null,
      reconciliationSnapshot: undefined,
    },
    update: {},
  });
}

function taxByLine(prices: number[], taxCents: number): number[] {
  const subtotal = prices.reduce((sum, price) => sum + price, 0);
  let assigned = 0;
  return prices.map((price, index) => {
    const tax = index === prices.length - 1 ? taxCents - assigned : Math.floor((taxCents * price) / subtotal);
    assigned += tax;
    return tax;
  });
}

async function projectSaleReserved(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.SALE_RESERVED.parse(event.payload);
  if (payload.subtotalCents + payload.taxCents !== payload.totalCents) {
    throw new VaultApiError(422, "SALE_TOTAL_INVALID", "Sale subtotal and tax do not equal total");
  }
  const config = await tx.vaultConfigVersion.findUnique({
    where: { machineId_version: { machineId: event.machineId, version: payload.configVersion } },
  });
  if (!config || config.digest !== payload.configDigest) throw new VaultApiError(422, "SALE_CONFIG_MISSING", "Sale references an unknown config version/digest tuple");
  const configPayload = VaultConfigPayloadSchema.parse(config.canonicalPayload);
  const products = new Map(configPayload.products.map((product) => [product.id, product]));
  if (payload.timezone !== configPayload.timezone || payload.city !== configPayload.city || payload.state !== configPayload.state || payload.taxRateBasisPoints !== configPayload.taxRateBasisPoints || payload.taxCalculationVersion !== configPayload.taxCalculationVersion) {
    throw new VaultApiError(422, "SALE_CONFIG_SNAPSHOT_MISMATCH", "Sale jurisdiction snapshot does not match its signed config");
  }
  const payloadDoorIds = payload.items.map((item) => item.doorId);
  const doors = await tx.vaultDoor.findMany({ where: { machineId: event.machineId, doorId: { in: payloadDoorIds } } });
  if (doors.length !== payload.items.length) throw new VaultApiError(422, "SALE_DOOR_MISSING", "Sale references a door outside the machine map");
  const lines = payload.items.map((item) => {
    const product = products.get(item.productId);
    const door = doors.find((candidate) => candidate.doorId === item.doorId);
    const mapping = configPayload.doorMapping.find((entry) => entry.doorId === item.doorId);
    if (!product || !door || !mapping || configPayload.assignments[item.doorId] !== item.productId) throw new VaultApiError(422, "SALE_PRODUCT_SNAPSHOT_MISSING", `No signed product snapshot exists for ${item.doorId}`);
    if (product.name !== item.productName || product.photoUrl !== item.photoUrl || product.description !== item.description || product.category !== item.category || product.priceCents !== item.priceCents || product.taxClass !== item.taxClass || mapping.controllerChannel !== item.controllerChannel || item.mappingVersion !== String(config.version)) {
      throw new VaultApiError(422, "SALE_ITEM_SNAPSHOT_MISMATCH", `Sale item ${item.doorId} does not match its signed config snapshot`);
    }
    return { door, product, item };
  });
  if (lines.reduce((sum, line) => sum + line.product.priceCents, 0) !== payload.subtotalCents) {
    throw new VaultApiError(422, "SALE_SUBTOTAL_MISMATCH", "Sale subtotal does not match signed product snapshots");
  }
  if (calculateTaxCents(payload.subtotalCents, configPayload.taxRateBasisPoints) !== payload.taxCents) {
    throw new VaultApiError(422, "SALE_TAX_MISMATCH", "Sale tax does not match the signed transaction tax rule");
  }
  const taxes = taxByLine(lines.map((line) => line.product.priceCents), payload.taxCents);
  await tx.vaultSale.create({
    data: {
      id: payload.saleId,
      machineId: event.machineId,
      localTransactionId: payload.saleId,
      supportReference: payload.supportReference,
      mode: event.mode,
      state: "RESERVED",
      paymentState: "NOT_REQUESTED",
      configVersionId: config.id,
      configVersionNumber: config.version,
      configDigest: config.digest,
      machineTimezone: payload.timezone,
      taxCity: payload.city,
      taxState: payload.state,
      taxRateBasisPoints: payload.taxRateBasisPoints,
      taxCalculationVersion: payload.taxCalculationVersion,
      subtotalCents: payload.subtotalCents,
      taxCents: payload.taxCents,
      totalCents: payload.totalCents,
      currency: payload.currency,
      itemCount: lines.length,
      createdAt: new Date(event.occurredAt),
      items: {
        create: lines.map(({ door, product, item }, index) => ({
          lineId: item.lineId,
          doorRecordId: door.id,
          doorId: door.doorId,
          productIdSnapshot: product.id,
          productNameSnapshot: product.name,
          photoUrlSnapshot: product.photoUrl,
          descriptionSnapshot: product.description,
          categorySnapshot: product.category,
          priceCentsSnapshot: product.priceCents,
          taxClassSnapshot: product.taxClass,
          controllerChannelSnapshot: item.controllerChannel,
          mappingVersionSnapshot: item.mappingVersion,
          taxRateBasisPoints: configPayload.taxRateBasisPoints,
          taxCentsSnapshot: taxes[index] ?? 0,
          allocationState: "RESERVED",
          fulfillmentState: "NOT_COMMITTED",
        })),
      },
    },
  });
  await tx.vaultDoor.updateMany({
    where: { machineId: event.machineId, doorId: { in: payloadDoorIds } },
    data: { state: "RESERVED", owningSaleId: payload.saleId, owningRestockId: null, lastEventId: event.eventId },
  });
}

async function projectPaymentCallback(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.PAYMENT_CALLBACK_APPLIED.parse(event.payload);
  const saleId = String(event.correlationId ?? "");
  await requireProjectedSale(tx, event.machineId, saleId);
  const occurredAt = new Date(event.occurredAt);
  const data: Prisma.VaultSaleUpdateManyMutationInput = { paymentState: payload.state, providerCallbackSequence: payload.sequence };
  if (payload.state === "AUTHORIZED") Object.assign(data, { state: "PAYMENT_AUTHORIZED", authorizationObservedAt: occurredAt });
  if (payload.state === "SETTLED") Object.assign(data, { state: "SETTLED", settlementState: "SETTLED", settlementObservedAt: occurredAt });
  if (payload.state === "UNKNOWN") Object.assign(data, { state: "PAYMENT_UNKNOWN" });
  if (payload.state === "RECONCILIATION_REQUIRED") Object.assign(data, { state: "RECONCILIATION_REQUIRED", settlementState: "RECONCILIATION_REQUIRED", reconciliationRequiredAt: occurredAt });
  await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId }, data });
}

async function projectFulfillment(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.FULFILLMENT_COMMITTED.parse(event.payload);
  await requireProjectedSale(tx, event.machineId, payload.saleId);
  const itemCount = await tx.vaultSaleItem.count({ where: { saleId: payload.saleId } });
  if (payload.commands.length !== itemCount || new Set(payload.commands.map((command) => command.doorId)).size !== itemCount) throw new VaultApiError(422, "COMMAND_CARDINALITY_INVALID", "Fulfillment commands must equal the exact paid-door set");
  for (const command of payload.commands) {
    const doorId = command.doorId;
    const updated = await tx.vaultSaleItem.updateMany({
      where: { saleId: payload.saleId, doorId },
      data: { allocationState: "COMMITTED_SOLD", fulfillmentState: "COMMANDS_PENDING", initialCommandId: command.commandId, initialCommandState: "COMMAND_INTENT_RECORDED" },
    });
    if (updated.count !== 1) throw new VaultApiError(422, "FULFILLMENT_ITEM_MISSING", `Fulfillment item ${doorId} was not reserved`);
  }
  await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, doorId: { in: payload.commands.map((command) => command.doorId) }, owningSaleId: payload.saleId }, data: { state: "COMMITTED_SOLD", lastEventId: event.eventId } });
  await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "OPEN_COMMAND_PENDING", paymentState: "AUTHORIZED", fulfillmentState: "COMMANDS_PENDING" } });
}

async function projectCommandTerminal(tx: Transaction, event: ProjectionEvent) {
  const schema = event.type === "CRITICAL_WRONG_DOOR_OBSERVED" ? EVENT_PAYLOAD_SCHEMAS.CRITICAL_WRONG_DOOR_OBSERVED : EVENT_PAYLOAD_SCHEMAS.CONTROLLER_COMMAND_TERMINAL;
  const payload = schema.parse(event.payload);
  const saleId = event.correlationId;
  if (saleId) {
    await requireProjectedSale(tx, event.machineId, saleId);
    const initial = await tx.vaultSaleItem.updateMany({ where: { saleId, initialCommandId: payload.commandId }, data: { initialCommandState: payload.outcome } });
    const retry = initial.count === 0
      ? await tx.vaultSaleItem.updateMany({ where: { saleId, retryCommandId: payload.commandId }, data: { retryCommandState: payload.outcome } })
      : { count: 0 };
    if (initial.count + retry.count !== 1) throw new VaultApiError(422, "COMMAND_PROJECTION_MISSING", "Controller terminal evidence references an unknown sale command");
    if (event.type === "CRITICAL_WRONG_DOOR_OBSERVED") {
      await tx.vaultSaleItem.updateMany({ where: { saleId, OR: [{ initialCommandId: payload.commandId }, { retryCommandId: payload.commandId }] }, data: { fulfillmentState: "SUPPORT_REQUIRED", supportReason: "DOOR_COMMAND_MISMATCH" } });
      await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId }, data: { state: "SUPPORT_REQUIRED", fulfillmentState: "SUPPORT_REQUIRED" } });
    } else {
      const pending = await tx.vaultSaleItem.count({
        where: {
          saleId,
          OR: [
            { retryCommandId: { not: null }, retryCommandState: "COMMAND_INTENT_RECORDED" },
            { retryCommandId: null, initialCommandState: "COMMAND_INTENT_RECORDED" },
          ],
        },
      });
      if (pending === 0) {
        await tx.vaultSaleItem.updateMany({ where: { saleId, fulfillmentState: "COMMANDS_PENDING" }, data: { fulfillmentState: "COMMANDS_TERMINAL" } });
        await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId }, data: { state: "OPEN_COMMAND_TERMINAL", fulfillmentState: "COMMANDS_TERMINAL" } });
      }
    }
  } else {
    // Restock controller dispatches intentionally have no sale correlation ID;
    // their globally unique command ID is the cloud projection key.
    await tx.vaultRestockItem.updateMany({
      where: { commandId: payload.commandId, restockSession: { machineId: event.machineId } },
      data: { commandState: payload.outcome },
    });
  }
  if (event.type === "CRITICAL_WRONG_DOOR_OBSERVED") {
    await openSafeSupportCase(tx, { machineId: event.machineId, saleId, sourceId: event.eventId, type: "DOOR_COMMAND", affectedDoorIds: [payload.expectedDoorId, ...(payload.observedDoorId ? [payload.observedDoorId] : [])], summary: "A door-command mismatch requires staff review." });
  }
}

async function projectRestockStarted(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_SESSION_STARTED.parse(event.payload);
  const config = await tx.vaultConfigVersion.findUnique({ where: { machineId_version: { machineId: event.machineId, version: payload.configVersion } } });
  if (!config) throw new VaultApiError(422, "RESTOCK_CONFIG_MISSING", "Restock references an unknown config");
  if (payload.plannedItems.length !== payload.expectedDoorIds.length || new Set(payload.plannedItems.map((item) => item.doorId)).size !== payload.expectedDoorIds.length || payload.expectedDoorIds.some((doorId) => !payload.plannedItems.some((item) => item.doorId === doorId))) {
    throw new VaultApiError(422, "RESTOCK_PLAN_MISMATCH", "Restock planned items must equal the exact expected-door set");
  }
  const doors = await tx.vaultDoor.findMany({ where: { machineId: event.machineId, doorId: { in: payload.expectedDoorIds } } });
  if (doors.length !== payload.expectedDoorIds.length) throw new VaultApiError(422, "RESTOCK_DOOR_MISSING", "Restock references a door outside the machine map");
  await tx.vaultRestockSession.create({
    data: {
      id: payload.restockSessionId,
      machineId: event.machineId,
      localSessionId: payload.restockSessionId,
      configVersionId: config.id,
      expectedDoorCount: payload.expectedDoorIds.length,
      startedAt: new Date(event.occurredAt),
      items: { create: doors.map((door) => ({ doorRecordId: door.id, doorId: door.doorId, plannedProductId: payload.plannedItems.find((item) => item.doorId === door.doorId)!.plannedProductId })) },
    },
  });
  await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, doorId: { in: payload.expectedDoorIds } }, data: { state: "SERVICE_HOLD", owningRestockId: payload.restockSessionId, owningSaleId: null, lastEventId: event.eventId } });
}

async function projectRestockReviewed(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_DOOR_REVIEWED.parse(event.payload);
  const session = await tx.vaultRestockSession.findFirst({ where: { id: payload.restockSessionId, machineId: event.machineId } });
  if (!session) throw new VaultApiError(422, "RESTOCK_PROJECTION_MISSING", "Restock review arrived before session start");
  const item = await tx.vaultRestockItem.findUnique({ where: { restockSessionId_doorId: { restockSessionId: payload.restockSessionId, doorId: payload.doorId } } });
  if (!item) throw new VaultApiError(422, "RESTOCK_ITEM_MISSING", "Restock review references an unexpected door");
  await tx.vaultRestockItem.update({ where: { id: item.id }, data: { state: payload.outcome, evidence: { notes: payload.notes }, reviewedAt: new Date(event.occurredAt) } });
  const doorData = payload.outcome === "FILLED"
    ? { state: "AVAILABLE" as const, activeProductId: item.plannedProductId, owningRestockId: null }
    : payload.outcome === "LEFT_EMPTY"
      ? { state: "EMPTY" as const, activeProductId: null, owningRestockId: null }
      : { state: "EXCEPTION" as const, activeProductId: null, owningRestockId: null };
  await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, doorId: payload.doorId, owningRestockId: payload.restockSessionId }, data: { ...doorData, lastEventId: event.eventId } });
}

async function projectCertificationStarted(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_SESSION_STARTED.parse(event.payload);
  const config = await tx.vaultConfigVersion.findUnique({ where: { machineId_version: { machineId: event.machineId, version: payload.configVersion } } });
  if (!config || config.digest !== payload.configDigest) throw new VaultApiError(422, "CERTIFICATION_CONFIG_MISSING", "Certification references an unknown config version/digest tuple");
  const paymentIdentity = payload.paymentIdentity;
  await tx.vaultCertificationSession.create({
    data: {
      id: payload.certificationSessionId,
      machineId: event.machineId,
      localSessionId: payload.certificationSessionId,
      status: "ACTIVE",
      configVersionId: config.id,
      appBuild: payload.appVersion,
      sourceCommit: payload.sourceCommit,
      localSchemaVersion: payload.localSchemaVersion,
      contractVersion: payload.contractVersion,
      nayaxAdapterVersion: typeof paymentIdentity.adapterVersion === "string" ? paymentIdentity.adapterVersion : null,
      nayaxSdkVersion: typeof paymentIdentity.sdkVersion === "string" ? paymentIdentity.sdkVersion : null,
      nayaxFlowConfig: paymentIdentity as Prisma.InputJsonValue,
      controllerIdentity: payload.controllerIdentity as Prisma.InputJsonValue,
      startedAt: new Date(event.occurredAt),
      evidenceSummary: { source: "MACHINE_EVENT_V1" },
    },
  });
}

async function projectCertificationEvidence(tx: Transaction, event: ProjectionEvent) {
  const schema = event.type === "CERTIFICATION_CRITICAL_STOP" ? EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_CRITICAL_STOP : EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_EVIDENCE_RECORDED;
  const payload = schema.parse(event.payload);
  const session = await tx.vaultCertificationSession.findFirst({ where: { id: payload.certificationSessionId, machineId: event.machineId } });
  if (!session) throw new VaultApiError(422, "CERTIFICATION_PROJECTION_MISSING", "Certification evidence arrived before session start");
  await tx.vaultCertificationEvidence.create({
    data: {
      certificationId: session.id,
      evidenceId: payload.evidenceId,
      doorId: payload.doorId,
      evidenceClass: payload.evidenceClass,
      outcome: payload.outcome,
      expectedDoorIds: payload.expectedDoorIds as Prisma.InputJsonValue,
      observedDoorIds: payload.observedDoorIds as Prisma.InputJsonValue,
      notes: payload.notes,
      artifactDigest: payload.artifactDigest,
      metadata: { machineEventId: event.eventId, artifactStoragePending: true, unexpectedDoor: payload.unexpectedDoor },
      observedAt: new Date(event.occurredAt),
    },
  });
  if (event.type === "CERTIFICATION_CRITICAL_STOP") {
    await tx.vaultCertificationSession.update({ where: { id: session.id }, data: { status: "CRITICAL_STOP" } });
    await openSafeSupportCase(tx, { machineId: event.machineId, sourceId: event.eventId, type: "CERTIFICATION", affectedDoorIds: payload.doorId ? [payload.doorId] : [], summary: "Certification stopped after critical machine evidence." });
  }
}

export async function projectVaultMachineEvent(tx: Transaction, event: ProjectionEvent): Promise<void> {
  switch (event.type as SupportedVaultEventType) {
    case "SALE_RESERVED": return projectSaleReserved(tx, event);
    case "PAYMENT_INTENT_RECORDED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PAYMENT_INTENT_RECORDED.parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId);
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "PAYMENT_REQUESTED", paymentState: "REQUESTED" } });
      return;
    }
    case "PAYMENT_START_EFFECT_UNKNOWN": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PAYMENT_START_EFFECT_UNKNOWN.parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId);
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "PAYMENT_UNKNOWN", paymentState: "UNKNOWN" } });
      await openSafeSupportCase(tx, { machineId: event.machineId, saleId: payload.saleId, sourceId: payload.saleId, type: "PAYMENT_UNKNOWN", summary: "Payment status is unknown and requires reconciliation." });
      return;
    }
    case "PAYMENT_CALLBACK_APPLIED": return projectPaymentCallback(tx, event);
    case "FULFILLMENT_COMMITTED": return projectFulfillment(tx, event);
    case "PAYMENT_DECLINED_RESERVATION_RELEASED":
    case "PAYMENT_CANCELLED_RESERVATION_RELEASED": {
      const schema = event.type === "PAYMENT_DECLINED_RESERVATION_RELEASED" ? EVENT_PAYLOAD_SCHEMAS.PAYMENT_DECLINED_RESERVATION_RELEASED : EVENT_PAYLOAD_SCHEMAS.PAYMENT_CANCELLED_RESERVATION_RELEASED;
      const payload = schema.parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId);
      const declined = event.type === "PAYMENT_DECLINED_RESERVATION_RELEASED";
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: declined ? "PAYMENT_DECLINED" : "PAYMENT_CANCELLED", paymentState: declined ? "DECLINED" : "CANCELLED", cancelledAt: declined ? undefined : new Date(event.occurredAt) } });
      await tx.vaultSaleItem.updateMany({ where: { saleId: payload.saleId }, data: { allocationState: "AVAILABLE" } });
      await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, owningSaleId: payload.saleId }, data: { state: "AVAILABLE", owningSaleId: null, lastEventId: event.eventId } });
      return;
    }
    case "PAID_DOOR_GROUP_RETRY_COMMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PAID_DOOR_GROUP_RETRY_COMMITTED.parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId);
      const itemCount = await tx.vaultSaleItem.count({ where: { saleId: payload.saleId } });
      if (payload.commands.length !== itemCount || new Set(payload.commands.map((command) => command.doorId)).size !== itemCount) throw new VaultApiError(422, "RETRY_DOOR_SET_MISMATCH", "Retry must contain every projected paid door exactly once");
      for (const command of payload.commands) {
        const updated = await tx.vaultSaleItem.updateMany({ where: { saleId: payload.saleId, doorId: command.doorId }, data: { retryUsedAt: new Date(event.occurredAt), retryCommandId: command.commandId, retryCommandState: "COMMAND_INTENT_RECORDED" } });
        if (updated.count !== 1) throw new VaultApiError(422, "RETRY_DOOR_SET_MISMATCH", "Retry contains a door outside the original paid group");
      }
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "OPEN_COMMAND_PENDING", groupRetryConsumedAt: new Date(event.occurredAt) } });
      return;
    }
    case "CONTROLLER_COMMAND_TERMINAL":
    case "CRITICAL_WRONG_DOOR_OBSERVED": return projectCommandTerminal(tx, event);
    case "CONTROLLER_EFFECT_REMAINS_UNKNOWN": {
      const payload = EVENT_PAYLOAD_SCHEMAS.CONTROLLER_EFFECT_REMAINS_UNKNOWN.parse(event.payload);
      const saleId = event.correlationId;
      if (saleId) {
        await requireProjectedSale(tx, event.machineId, saleId);
        const initial = await tx.vaultSaleItem.updateMany({ where: { saleId, initialCommandId: payload.commandId }, data: { initialCommandState: "SENT_UNKNOWN" } });
        if (initial.count === 0) await tx.vaultSaleItem.updateMany({ where: { saleId, retryCommandId: payload.commandId }, data: { retryCommandState: "SENT_UNKNOWN" } });
      }
      return;
    }
    case "PUBLIC_PRESENTATION_DONE": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PUBLIC_PRESENTATION_DONE.parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId);
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { customerDoneAt: new Date(event.occurredAt), fulfillmentState: "CUSTOMER_DONE" } });
      return;
    }
    case "PAYMENT_RECOVERY_INTENT_DIGEST_CONFLICT":
    case "PAYMENT_RECOVERY_EFFECT_UNRESOLVED":
    case "PAYMENT_RECOVERY_RECONCILIATION_REQUIRED": {
      const payload = z.object({ saleId: uuid }).strict().parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId);
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "RECONCILIATION_REQUIRED", paymentState: "RECONCILIATION_REQUIRED", reconciliationRequiredAt: new Date(event.occurredAt) } });
      await openSafeSupportCase(tx, { machineId: event.machineId, saleId: payload.saleId, sourceId: payload.saleId, type: "PAYMENT_RECONCILIATION", summary: "Payment reconciliation requires staff review." });
      return;
    }
    case "RESTOCK_SESSION_STARTED": return projectRestockStarted(tx, event);
    case "RESTOCK_DOOR_REVIEWED": return projectRestockReviewed(tx, event);
    case "RESTOCK_DOOR_COMMAND_COMMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_DOOR_COMMAND_COMMITTED.parse(event.payload);
      const updated = await tx.vaultRestockItem.updateMany({ where: { restockSessionId: payload.restockSessionId, doorId: payload.doorId, restockSession: { machineId: event.machineId } }, data: { commandId: payload.commandId, commandState: "COMMAND_INTENT_RECORDED" } });
      if (updated.count !== 1) throw new VaultApiError(422, "RESTOCK_ITEM_MISSING", "Restock command references an unexpected door");
      return;
    }
    case "RESTOCK_SESSION_FINALIZED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_SESSION_FINALIZED.parse(event.payload);
      const updated = await tx.vaultRestockSession.updateMany({ where: { id: payload.restockSessionId, machineId: event.machineId, state: "ACTIVE" }, data: { state: "FINALIZED", filledCount: payload.filled, leftEmptyCount: payload.leftEmpty, exceptionCount: payload.exceptions, physicalCloseConfirmedAt: new Date(event.occurredAt), finalizedAt: new Date(event.occurredAt) } });
      if (updated.count !== 1) throw new VaultApiError(422, "RESTOCK_PROJECTION_MISSING", "Restock finalization arrived before an active session");
      return;
    }
    case "CERTIFICATION_SESSION_STARTED": return projectCertificationStarted(tx, event);
    case "CERTIFICATION_COMMAND_COMMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_COMMAND_COMMITTED.parse(event.payload);
      const session = await tx.vaultCertificationSession.findFirst({ where: { id: payload.certificationSessionId, machineId: event.machineId } });
      if (!session) throw new VaultApiError(422, "CERTIFICATION_PROJECTION_MISSING", "Certification command arrived before session start");
      return;
    }
    case "CERTIFICATION_EVIDENCE_RECORDED":
    case "CERTIFICATION_CRITICAL_STOP": return projectCertificationEvidence(tx, event);
    case "CERTIFICATION_SUBMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_SUBMITTED.parse(event.payload);
      const updated = await tx.vaultCertificationSession.updateMany({ where: { id: payload.certificationSessionId, machineId: event.machineId, status: "ACTIVE" }, data: { status: "REVIEW_REQUIRED", completedAt: new Date(event.occurredAt) } });
      if (updated.count !== 1) throw new VaultApiError(422, "CERTIFICATION_STATE_INVALID", "Only an active certification can enter cloud review");
      return;
    }
    default:
      // The event is still fully typed above. These types are immutable audit facts
      // that intentionally have no mutable cloud projection.
      return;
  }
}

export const __vaultEventSchemasForTests = EVENT_PAYLOAD_SCHEMAS;
