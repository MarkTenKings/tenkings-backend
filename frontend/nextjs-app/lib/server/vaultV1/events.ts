import { createHash } from "node:crypto";
import { type Prisma, normalizeVaultEventPayload, vaultPayloadDigest } from "@tenkings/database";
import {
  calculateTaxCents,
  configDoorIds,
  machineProfileDigest,
  VAULT_MAX_PROFILE_DOORS,
  vaultPaymentTransitionAllowed,
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
const doorIds = z.array(VaultDoorIdSchema).min(1).max(VAULT_MAX_PROFILE_DOORS).refine((values) => new Set(values).size === values.length);
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
  controllerChannel: z.number().int().min(1).max(VAULT_MAX_PROFILE_DOORS),
  mappingVersion: z.string().min(1).max(128),
  controllerEndpointId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/).optional(),
  doorLabel: z.string().min(1).max(32).optional(),
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const projectedCommand = z.object({ commandId: boundedId, doorId: VaultDoorIdSchema, attempt: z.union([z.literal(1), z.literal(2)]) }).strict();
const providerReferences = { providerSessionReference: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(), providerTransactionReference: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional() };
const certificationLinkage = { commandId: boundedId, cycleType: z.enum(["DIAGNOSTIC", "PURCHASE", "RESTOCK"]), saleId: uuid.nullable(), restockSessionId: uuid.nullable(), observedAt: z.string().datetime() };

const EVENT_PAYLOAD_SCHEMAS = {
  STAFF_GRANT_IMPORTED: z.object({ grantId: uuid, userId: boundedId, role: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]), verifierVersion: z.union([positiveInteger, z.literal("[REDACTED]")]), revoked: z.boolean() }).strict(),
  STAFF_AUTHENTICATED: z.object({ sessionId: z.literal("[REDACTED]"), role: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]), grantId: uuid }).strict(),
  SERVICE_SESSION_LOCKED: z.object({ sessionId: z.literal("[REDACTED]"), reason: z.string().min(1).max(160) }).strict(),
  SERVICE_SAFE_EXIT: z.object({ sessionId: z.literal("[REDACTED]"), physicalCloseConfirmed: z.literal(true) }).strict(),
  STAFF_AUTH_FAILED: z.object({ userId: boundedId, reason: z.string().min(1).max(160) }).strict(),
  CONFIG_STAGED: z.object({ version: positiveInteger, digest: z.string().regex(/^[a-f0-9]{64}$/), keyId: boundedId }).strict(),
  CONFIG_ACTIVATED: z.object({ version: positiveInteger }).strict(),
  PROFILE_RECONFIGURATION_ACTIVATED: z.object({ previousConfigVersion: positiveInteger.nullable(), previousConfigDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), configVersion: positiveInteger, configDigest: z.string().regex(/^[a-f0-9]{64}$/), profileDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), compartmentsEmpty: z.literal(true), servicedDoorsClosed: z.literal(true) }).strict(),
  SALE_RECOVERY_EVALUATED: z.object({ saleId: uuid }).strict(),
  CLOUD_FRESHNESS_PROVEN: z.object({ observedAt: z.string().datetime() }).strict(),
  PUBLIC_ACTIVITY_RECORDED: z.object({ observedAt: z.string().datetime() }).strict(),
  PUBLIC_IDLE_CART_RESET: z.object({ observedAt: z.string().datetime() }).strict(),
  CART_DOOR_SELECTED: z.object({ doorId: VaultDoorIdSchema, productId: boundedId }).strict(),
  CART_DOOR_REMOVED: z.object({ doorId: VaultDoorIdSchema, productId: boundedId }).strict(),
  CART_SECURE_PICK_PERSISTED: z.object({ doorId: VaultDoorIdSchema, productId: boundedId, candidateCount: positiveInteger }).strict(),
  CHECKOUT_RESERVATION_CONFLICT: z.object({ conflictedDoorIds: z.array(VaultDoorIdSchema).max(VAULT_MAX_PROFILE_DOORS), preservedDoorIds: z.array(VaultDoorIdSchema).max(VAULT_MAX_PROFILE_DOORS) }).strict(),
  SALE_RESERVED: z.object({
    saleId: uuid,
    certificationSessionId: uuid.optional(),
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
    items: z.array(saleItemSnapshot).min(1).max(VAULT_MAX_PROFILE_DOORS).refine((items) => new Set(items.map((item) => item.doorId)).size === items.length && new Set(items.map((item) => item.lineId)).size === items.length),
  }).strict(),
  PAYMENT_INTENT_RECORDED: z.object({ saleId: uuid, totalCents: nonnegativeInteger }).strict(),
  PAYMENT_START_EFFECT_UNKNOWN: z.object({ saleId: uuid, errorClass: z.string().min(1).max(160) }).strict(),
  PAYMENT_CALLBACK_CONFLICT_QUARANTINED: z.object({ callbackId: boundedId }).strict(),
  PAYMENT_CALLBACK_APPLIED: z.object({ callbackId: boundedId, sequence: nonnegativeInteger, state: VaultPaymentStateSchema, disposition: z.literal("APPLIED"), ...providerReferences }).strict(),
  PAYMENT_CALLBACK_QUARANTINED: z.object({ callbackId: boundedId, sequence: nonnegativeInteger, state: VaultPaymentStateSchema, disposition: z.enum(["SESSION_CONFLICT", "TRANSACTION_CONFLICT", "STATE_CONFLICT", "OUT_OF_ORDER", "SEQUENCE_CONFLICT"]), ...providerReferences }).strict(),
  PAYMENT_CANCEL_INTENT_RECORDED: z.object({ saleId: uuid }).strict(),
  VEND_RESULT_INTENT_RECORDED: z.object({ saleId: uuid, policy: z.literal("SIMULATOR_ONLY"), items: z.array(z.object({ lineId: uuid, commandId: boundedId, outcome: z.enum(["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"]) }).strict()).min(1).max(VAULT_MAX_PROFILE_DOORS) }).strict(),
  CONTROLLER_AUTHORITY_INVALID: z.object({ commandId: boundedId }).strict(),
  PAID_DOOR_GROUP_RETRY_COMMITTED: z.object({ saleId: uuid, commands: z.array(projectedCommand.extend({ attempt: z.literal(2) })).min(1).max(VAULT_MAX_PROFILE_DOORS) }).strict(),
  PUBLIC_PRESENTATION_DONE: z.object({ saleId: uuid }).strict(),
  CONTROLLER_DISPATCH_BOUNDARY_ENTERED: z.object({ commandId: boundedId, doorId: VaultDoorIdSchema, attempt: z.union([z.literal(1), z.literal(2)]), authority: z.enum(["PAID_SALE", "RESTOCK", "CERTIFICATION"]) }).strict(),
  CONTROLLER_COMMAND_TERMINAL: z.object({ commandId: boundedId, expectedDoorId: VaultDoorIdSchema, observedDoorId: VaultDoorIdSchema.nullable(), outcome: z.enum(["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"]), controllerSequence: positiveInteger, evidenceCode: z.string().max(160).nullable() }).strict(),
  CRITICAL_WRONG_DOOR_OBSERVED: z.object({ commandId: boundedId, expectedDoorId: VaultDoorIdSchema, observedDoorId: VaultDoorIdSchema, outcome: z.enum(["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"]), controllerSequence: positiveInteger, evidenceCode: z.string().max(160).nullable() }).strict(),
  CONTROLLER_EFFECT_REMAINS_UNKNOWN: z.object({ commandId: boundedId, errorClass: z.string().min(1).max(160) }).strict(),
  FULFILLMENT_COMMITTED: z.object({ saleId: uuid, commands: z.array(projectedCommand.extend({ attempt: z.literal(1) })).min(1).max(VAULT_MAX_PROFILE_DOORS) }).strict(),
  PAYMENT_DECLINED_RESERVATION_RELEASED: z.object({ saleId: uuid }).strict(),
  PAYMENT_CANCELLED_RESERVATION_RELEASED: z.object({ saleId: uuid }).strict(),
  PAYMENT_RECOVERY_INTENT_DIGEST_CONFLICT: z.object({ saleId: uuid }).strict(),
  PAYMENT_RECOVERY_EFFECT_UNRESOLVED: z.object({ saleId: uuid }).strict(),
  PAYMENT_RECOVERY_RECONCILIATION_REQUIRED: z.object({ saleId: uuid }).strict(),
  RESTOCK_SESSION_STARTED: z.object({ restockSessionId: uuid, certificationSessionId: uuid.optional(), expectedDoorIds: doorIds, plannedItems: z.array(z.object({ doorId: VaultDoorIdSchema, plannedProductId: boundedId.nullable() }).strict()).min(1).max(VAULT_MAX_PROFILE_DOORS), configVersion: positiveInteger, actorRole: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]).optional(), actorGrantVersion: positiveInteger.optional(), profileDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  RESTOCK_SESSION_RESUMED: z.object({ restockSessionId: uuid, previousActorUserId: boundedId, actorRole: z.enum(["RESTOCKER", "TECHNICIAN", "ADMIN"]) }).strict(),
  RESTOCK_DOOR_REVIEWED: z.object({ restockSessionId: uuid, doorId: VaultDoorIdSchema, outcome: z.enum(["FILLED", "LEFT_EMPTY", "EXCEPTION"]), notes: z.string().max(1000), productFitConfirmed: z.literal(true).optional() }).strict(),
  RESTOCK_SESSION_FINALIZED: z.object({ restockSessionId: uuid, physicalCloseConfirmed: z.literal(true), filled: nonnegativeInteger, leftEmpty: nonnegativeInteger, exceptions: nonnegativeInteger }).strict(),
  RESTOCK_DOOR_COMMAND_COMMITTED: z.object({ restockSessionId: uuid, commandId: boundedId, doorId: VaultDoorIdSchema }).strict(),
  CERTIFICATION_SESSION_STARTED: z.object({
    certificationSessionId: uuid,
    configVersion: positiveInteger,
    configDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    appVersion: z.string().min(1).max(64),
    localSchemaVersion: nonnegativeInteger,
    contractVersion: z.literal(1),
    adapterMode: z.enum(["MOCK", "OFFICIAL_TEST", "LIVE"]),
    controllerIdentity: z.record(z.string(), z.unknown()),
    paymentIdentity: z.record(z.string(), z.unknown()),
    retentionPolicy: z.literal("SERVICE_LIFE_PLUS_3_YEARS"),
    profileDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
  CERTIFICATION_COMMAND_COMMITTED: z.object({ certificationSessionId: uuid, commandId: boundedId, scheduledDoorId: VaultDoorIdSchema, sequence: positiveInteger }).strict(),
  CERTIFICATION_CYCLE_STARTED: z.object({ certificationSessionId: uuid, cycleType: z.enum(["DIAGNOSTIC", "PURCHASE", "RESTOCK"]), saleId: uuid.optional(), restockSessionId: uuid.optional() }).strict(),
  CERTIFICATION_SESSION_RESUMED: z.object({ certificationSessionId: uuid, previousActorUserId: boundedId }).strict(),
  CERTIFICATION_EVIDENCE_RECORDED: z.object({ evidenceId: uuid, certificationSessionId: uuid, doorId: VaultDoorIdSchema.nullable(), evidenceClass: z.enum(["AUTOMATED", "OFFICIAL_SDK", "BENCH", "FULL_MACHINE", "FIELD"]), outcome: z.enum(["PASS", "FAIL"]), expectedDoorIds: z.array(VaultDoorIdSchema).max(VAULT_MAX_PROFILE_DOORS), observedDoorIds: z.array(VaultDoorIdSchema).max(VAULT_MAX_PROFILE_DOORS), notes: z.string().max(4000), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), unexpectedDoor: z.literal(false), ...certificationLinkage }).strict(),
  CERTIFICATION_CRITICAL_STOP: z.object({ evidenceId: uuid, certificationSessionId: uuid, doorId: VaultDoorIdSchema.nullable(), evidenceClass: z.enum(["AUTOMATED", "OFFICIAL_SDK", "BENCH", "FULL_MACHINE", "FIELD"]), outcome: z.literal("CRITICAL"), expectedDoorIds: z.array(VaultDoorIdSchema).max(VAULT_MAX_PROFILE_DOORS), observedDoorIds: z.array(VaultDoorIdSchema).max(VAULT_MAX_PROFILE_DOORS), notes: z.string().max(4000), artifactDigest: z.string().regex(/^[a-f0-9]{64}$/), unexpectedDoor: z.boolean(), ...certificationLinkage }).strict(),
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

async function requireProjectedSale(tx: Transaction, machineId: string, saleId: string, mode: VaultMachineEvent["mode"]) {
  const sale = await tx.vaultSale.findFirst({ where: { id: saleId, machineId } });
  if (!sale) throw new VaultApiError(422, "SALE_PROJECTION_MISSING", "A sale lifecycle event arrived before SALE_RESERVED");
  if (sale.mode !== mode) throw new VaultApiError(422, "SALE_MODE_MISMATCH", "Event mode differs from its immutable sale");
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
  if (!config || !config.publishedAt || config.digest !== payload.configDigest) throw new VaultApiError(422, "SALE_CONFIG_MISSING", "Sale references an unpublished or unknown config version/digest tuple");
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
    if (!product?.active || !door || !mapping || configPayload.assignments[item.doorId] !== item.productId) throw new VaultApiError(422, "SALE_PRODUCT_SNAPSHOT_MISSING", `No active signed product snapshot exists for ${item.doorId}`);
    if (product.name !== item.productName || product.photoUrl !== item.photoUrl || product.description !== item.description || product.category !== item.category || product.priceCents !== item.priceCents || product.taxClass !== item.taxClass || mapping.controllerChannel !== item.controllerChannel || item.mappingVersion !== String(config.version)) {
      throw new VaultApiError(422, "SALE_ITEM_SNAPSHOT_MISMATCH", `Sale item ${item.doorId} does not match its signed config snapshot`);
    }
    const profileDoor = configPayload.schemaVersion === 2 ? configPayload.machineProfile.doors.find((candidate) => candidate.doorId === item.doorId) : null;
    if (configPayload.schemaVersion === 2 && (item.controllerEndpointId !== ("controllerEndpointId" in mapping ? mapping.controllerEndpointId : undefined) || item.doorLabel !== profileDoor?.label || item.profileDigest !== machineProfileDigest(configPayload.machineProfile))) throw new VaultApiError(422, "SALE_PROFILE_SNAPSHOT_MISMATCH", "Sale label, profile and controller endpoint must match the exact signed profile");
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
      certificationSessionId: payload.certificationSessionId ?? null,
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
          controllerEndpointIdSnapshot: item.controllerEndpointId ?? "legacy",
          doorLabelSnapshot: item.doorLabel ?? item.doorId,
          mappingVersionSnapshot: item.mappingVersion,
          taxRateBasisPoints: configPayload.taxRateBasisPoints,
          taxCentsSnapshot: taxes[index] ?? 0,
          allocationState: "RESERVED",
          fulfillmentState: "NOT_COMMITTED",
        })),
      },
    },
  });
  if (event.mode === "PRODUCTION") await tx.vaultDoor.updateMany({
    where: { machineId: event.machineId, doorId: { in: payloadDoorIds } },
    data: { state: "RESERVED", owningSaleId: payload.saleId, owningRestockId: null, lastEventId: event.eventId },
  });
}

async function projectPaymentCallback(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.PAYMENT_CALLBACK_APPLIED.parse(event.payload);
  const saleId = String(event.correlationId ?? "");
  const sale = await requireProjectedSale(tx, event.machineId, saleId, event.mode);
  if (sale.providerCallbackSequence !== null && payload.sequence <= sale.providerCallbackSequence) throw new VaultApiError(422, "PROVIDER_SEQUENCE_NOT_MONOTONIC", "Applied payment callback must advance the immutable event projection");
  const committed = sale.fulfillmentState !== "NOT_COMMITTED";
  if (payload.state === "SETTLED" && !sale.authorizationObservedAt) throw new VaultApiError(422, "SETTLEMENT_WITHOUT_AUTHORIZATION", "Settlement cannot precede authorization");
  if (sale.paymentState === "NOT_REQUESTED" || !vaultPaymentTransitionAllowed(sale.paymentState, payload.state, committed)) throw new VaultApiError(422, "PAYMENT_STATE_TRANSITION_INVALID", "Applied callback cannot regress or bypass payment authority");
  if (sale.mode !== event.mode) throw new VaultApiError(422, "SALE_MODE_MISMATCH", "Payment event mode differs from its immutable sale");
  if (payload.providerSessionReference && sale.providerSessionId && sale.providerSessionId !== payload.providerSessionReference || payload.providerTransactionReference && sale.providerTransactionId && sale.providerTransactionId !== payload.providerTransactionReference) throw new VaultApiError(422, "PROVIDER_REFERENCE_CONFLICT", "Provider reference changed for the sale");
  const occurredAt = new Date(event.occurredAt);
  const data: Prisma.VaultSaleUpdateManyMutationInput = { paymentState: payload.state, providerCallbackSequence: payload.sequence, ...(payload.providerSessionReference ? { providerSessionId: payload.providerSessionReference } : {}), ...(payload.providerTransactionReference ? { providerTransactionId: payload.providerTransactionReference } : {}) };
  if (payload.state === "AUTHORIZED" && !sale.authorizationObservedAt) Object.assign(data, { state: "PAYMENT_AUTHORIZED", authorizationObservedAt: occurredAt });
  if (payload.state === "SETTLED") {
    if (!sale.authorizationObservedAt) throw new VaultApiError(422, "SETTLEMENT_WITHOUT_AUTHORIZATION", "Settlement cannot precede authorization");
    Object.assign(data, { settlementState: "SETTLED", settlementObservedAt: sale.settlementObservedAt ?? occurredAt });
    if (!sale.customerDoneAt && sale.fulfillmentState !== "SUPPORT_REQUIRED" && sale.fulfillmentState !== "COMMANDS_PENDING") data.state = "SETTLED";
  }
  if (payload.state === "SETTLEMENT_PENDING") Object.assign(data, { settlementState: "PENDING", vendResultObservedAt: sale.vendResultObservedAt ?? occurredAt });
  if (payload.state === "UNKNOWN") Object.assign(data, committed ? { paymentState: "RECONCILIATION_REQUIRED", settlementState: "RECONCILIATION_REQUIRED", reconciliationRequiredAt: sale.reconciliationRequiredAt ?? occurredAt } : { state: "PAYMENT_UNKNOWN" });
  if (payload.state === "RECONCILIATION_REQUIRED") Object.assign(data, { state: "RECONCILIATION_REQUIRED", settlementState: "RECONCILIATION_REQUIRED", reconciliationRequiredAt: occurredAt });
  await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId }, data });
  if (payload.state === "UNKNOWN" || payload.state === "RECONCILIATION_REQUIRED") await openSafeSupportCase(tx, { machineId: event.machineId, saleId, sourceId: saleId, type: payload.state === "UNKNOWN" ? "PAYMENT_UNKNOWN" : "PAYMENT_RECONCILIATION", summary: "Payment requires staff reconciliation; do not charge again." });
}

async function projectFulfillment(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.FULFILLMENT_COMMITTED.parse(event.payload);
  const sale = await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
  if (sale.mode !== event.mode || !sale.authorizationObservedAt || sale.paymentState !== "AUTHORIZED" || sale.fulfillmentState !== "NOT_COMMITTED") throw new VaultApiError(422, "FULFILLMENT_NOT_AUTHORIZED", "Fulfillment requires the exact authorized, uncommitted sale and mode");
  const itemCount = await tx.vaultSaleItem.count({ where: { saleId: payload.saleId } });
  if (payload.commands.length !== itemCount || new Set(payload.commands.map((command) => command.doorId)).size !== itemCount) throw new VaultApiError(422, "COMMAND_CARDINALITY_INVALID", "Fulfillment commands must equal the exact paid-door set");
  for (const command of payload.commands) {
    const doorId = command.doorId;
    const updated = await tx.vaultSaleItem.updateMany({
      where: { saleId: payload.saleId, doorId, initialCommandId: null },
      data: { allocationState: "COMMITTED_SOLD", fulfillmentState: "COMMANDS_PENDING", initialCommandId: command.commandId, initialCommandState: "COMMAND_INTENT_RECORDED" },
    });
    if (updated.count !== 1) throw new VaultApiError(422, "FULFILLMENT_ITEM_MISSING", `Fulfillment item ${doorId} was not reserved`);
  }
  if (event.mode === "PRODUCTION") await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, doorId: { in: payload.commands.map((command) => command.doorId) }, owningSaleId: payload.saleId }, data: { state: "COMMITTED_SOLD", lastEventId: event.eventId } });
  await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "OPEN_COMMAND_PENDING", paymentState: "AUTHORIZED", fulfillmentState: "COMMANDS_PENDING" } });
}

async function projectCommandTerminal(tx: Transaction, event: ProjectionEvent) {
  const schema = event.type === "CRITICAL_WRONG_DOOR_OBSERVED" ? EVENT_PAYLOAD_SCHEMAS.CRITICAL_WRONG_DOOR_OBSERVED : EVENT_PAYLOAD_SCHEMAS.CONTROLLER_COMMAND_TERMINAL;
  const payload = schema.parse(event.payload);
  const saleId = event.correlationId;
  if (saleId) {
    await requireProjectedSale(tx, event.machineId, saleId, event.mode);
    const initial = await tx.vaultSaleItem.updateMany({ where: { saleId, doorId: payload.expectedDoorId, initialCommandId: payload.commandId, initialCommandTerminalAt: null }, data: { initialCommandState: payload.outcome, initialCommandTerminalAt: new Date(event.occurredAt) } });
    const retry = initial.count === 0
      ? await tx.vaultSaleItem.updateMany({ where: { saleId, doorId: payload.expectedDoorId, retryCommandId: payload.commandId, retryCommandTerminalAt: null }, data: { retryCommandState: payload.outcome, retryCommandTerminalAt: new Date(event.occurredAt) } })
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
            { retryCommandId: { not: null }, retryCommandTerminalAt: null },
            { retryCommandId: null, initialCommandTerminalAt: null },
          ],
        },
      });
      if (pending === 0) {
        await tx.vaultSaleItem.updateMany({ where: { saleId, fulfillmentState: "COMMANDS_PENDING" }, data: { fulfillmentState: "COMMANDS_TERMINAL" } });
        await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId, fulfillmentState: { not: "SUPPORT_REQUIRED" } }, data: { fulfillmentState: "COMMANDS_TERMINAL" } });
        await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId, fulfillmentState: "COMMANDS_TERMINAL", customerDoneAt: null, paymentState: { not: "SETTLED" } }, data: { state: "OPEN_COMMAND_TERMINAL" } });
      }
    }
  } else {
    // Restock controller dispatches intentionally have no sale correlation ID;
    // their globally unique command ID is the cloud projection key.
    await tx.vaultRestockItem.updateMany({
      where: { commandId: payload.commandId, doorId: payload.expectedDoorId, commandTerminalAt: null, restockSession: { machineId: event.machineId, mode: event.mode, state: "ACTIVE" } },
      data: { commandState: payload.outcome, commandTerminalAt: new Date(event.occurredAt) },
    });
  }
  if (event.type === "CRITICAL_WRONG_DOOR_OBSERVED") {
    await openSafeSupportCase(tx, { machineId: event.machineId, saleId, sourceId: event.eventId, type: "DOOR_COMMAND", affectedDoorIds: [payload.expectedDoorId, ...(payload.observedDoorId ? [payload.observedDoorId] : [])], summary: "A door-command mismatch requires staff review." });
  }
}

async function projectRestockStarted(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_SESSION_STARTED.parse(event.payload);
  const config = await tx.vaultConfigVersion.findUnique({ where: { machineId_version: { machineId: event.machineId, version: payload.configVersion } } });
  if (!config?.publishedAt) throw new VaultApiError(422, "RESTOCK_CONFIG_MISSING", "Restock references an unpublished or unknown config");
  const configPayload = VaultConfigPayloadSchema.parse(config.canonicalPayload);
  if (configPayload.schemaVersion === 2 && payload.profileDigest !== machineProfileDigest(configPayload.machineProfile)) throw new VaultApiError(422, "RESTOCK_PROFILE_MISMATCH", "Restock profile digest differs from pinned config");
  if (payload.plannedItems.some((item) => configPayload.assignments[item.doorId] !== item.plannedProductId)) throw new VaultApiError(422, "RESTOCK_PLAN_SNAPSHOT_MISMATCH", "Restock plan differs from its pinned configuration");
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
      certificationSessionId: payload.certificationSessionId ?? null,
      mode: event.mode,
      configVersionId: config.id,
      expectedDoorCount: payload.expectedDoorIds.length,
      startedAt: new Date(event.occurredAt),
      ...(event.actor && payload.actorRole && payload.actorGrantVersion ? { actorUserId: event.actor, actorRole: payload.actorRole, actorGrantVersion: payload.actorGrantVersion } : {}),
      items: { create: doors.map((door) => ({ doorRecordId: door.id, doorId: door.doorId, plannedProductId: payload.plannedItems.find((item) => item.doorId === door.doorId)!.plannedProductId,
        doorLabelSnapshot: configPayload.schemaVersion === 2 ? configPayload.machineProfile.doors.find((item) => item.doorId === door.doorId)!.label : door.doorId,
        mappingSnapshot: configPayload.doorMapping.find((item) => item.doorId === door.doorId) as Prisma.InputJsonValue,
      })) },
    },
  });
  if (event.mode === "PRODUCTION") await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, doorId: { in: payload.expectedDoorIds } }, data: { state: "SERVICE_HOLD", owningRestockId: payload.restockSessionId, owningSaleId: null, lastEventId: event.eventId } });
}

async function projectRestockReviewed(tx: Transaction, event: ProjectionEvent) {
  const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_DOOR_REVIEWED.parse(event.payload);
  const session = await tx.vaultRestockSession.findFirst({ where: { id: payload.restockSessionId, machineId: event.machineId } });
  if (!session) throw new VaultApiError(422, "RESTOCK_PROJECTION_MISSING", "Restock review arrived before session start");
  if (session.mode !== event.mode || session.state !== "ACTIVE") throw new VaultApiError(422, "RESTOCK_STATE_INVALID", "Review requires the exact active restock and mode");
  const item = await tx.vaultRestockItem.findUnique({ where: { restockSessionId_doorId: { restockSessionId: payload.restockSessionId, doorId: payload.doorId } } });
  if (!item) throw new VaultApiError(422, "RESTOCK_ITEM_MISSING", "Restock review references an unexpected door");
  if (item.state !== "UNREVIEWED" || !item.commandTerminalAt || !["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"].includes(item.commandState)) throw new VaultApiError(422, "RESTOCK_OBSERVATION_NOT_AVAILABLE", "Restock observation requires one unreviewed terminal command");
  const config = await tx.vaultConfigVersion.findUnique({ where: { id: session.configVersionId }, select: { schemaVersion: true } });
  if (config?.schemaVersion === 2 && payload.outcome === "FILLED" && payload.productFitConfirmed !== true) throw new VaultApiError(422, "PRODUCT_FIT_CONFIRMATION_REQUIRED", "Filling a profile compartment requires the operator's product fit confirmation");
  if (payload.outcome === "FILLED" && !item.plannedProductId) throw new VaultApiError(422, "RESTOCK_PRODUCT_MISSING", "An unassigned door cannot become filled inventory");
  await tx.vaultRestockItem.update({ where: { id: item.id }, data: { state: payload.outcome, evidence: { notes: payload.notes, ...(payload.productFitConfirmed ? { productFitConfirmed: true } : {}) }, reviewedAt: new Date(event.occurredAt) } });
  const doorData = payload.outcome === "FILLED"
    ? { state: "AVAILABLE" as const, activeProductId: item.plannedProductId, owningRestockId: null }
    : payload.outcome === "LEFT_EMPTY"
      ? { state: "EMPTY" as const, activeProductId: null, owningRestockId: null }
      : { state: "EXCEPTION" as const, activeProductId: null, owningRestockId: null };
  if (event.mode === "PRODUCTION") await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, doorId: payload.doorId, OR: [{ owningRestockId: payload.restockSessionId }, { owningRestockId: null, owningSaleId: null }] }, data: { ...doorData, lastEventId: event.eventId } });
}

async function projectCertificationStarted(tx: Transaction, event: ProjectionEvent) {
  if (event.mode !== "CERTIFICATION") throw new VaultApiError(422, "CERTIFICATION_MODE_REQUIRED", "Certification requires immutable test mode");
  const payload = EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_SESSION_STARTED.parse(event.payload);
  const config = await tx.vaultConfigVersion.findUnique({ where: { machineId_version: { machineId: event.machineId, version: payload.configVersion } } });
  if (!config?.publishedAt || config.digest !== payload.configDigest) throw new VaultApiError(422, "CERTIFICATION_CONFIG_MISSING", "Certification references an unpublished or unknown config version/digest tuple");
  const configPayload = VaultConfigPayloadSchema.parse(config.canonicalPayload);
  if (configPayload.schemaVersion === 2 && payload.profileDigest !== machineProfileDigest(configPayload.machineProfile)) throw new VaultApiError(422, "CERTIFICATION_PROFILE_MISMATCH", "Certification profile digest differs from pinned config");
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
      startedByUserId: event.actor ?? null,
      evidenceSummary: { source: "MACHINE_EVENT_V1" },
    },
  });
}

async function projectCertificationEvidence(tx: Transaction, event: ProjectionEvent) {
  const schema = event.type === "CERTIFICATION_CRITICAL_STOP" ? EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_CRITICAL_STOP : EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_EVIDENCE_RECORDED;
  const payload = schema.parse(event.payload);
  const session = await tx.vaultCertificationSession.findFirst({ where: { id: payload.certificationSessionId, machineId: event.machineId } });
  if (!session) throw new VaultApiError(422, "CERTIFICATION_PROJECTION_MISSING", "Certification evidence arrived before session start");
  if (session.status !== "ACTIVE" || event.mode !== "CERTIFICATION") throw new VaultApiError(422, "CERTIFICATION_STATE_INVALID", "Evidence requires an active certification session in test mode");
  if (payload.evidenceClass !== "AUTOMATED" && ((session.controllerIdentity as Record<string, unknown> | null)?.mode === "MOCK" || (session.nayaxFlowConfig as Record<string, unknown> | null)?.mode === "MOCK")) throw new VaultApiError(422, "CERTIFICATION_EVIDENCE_CLASS_INVALID", "Simulator commands cannot produce physical or official provider evidence");
  const config = await tx.vaultConfigVersion.findUnique({ where: { id: session.configVersionId } });
  const profileDoorIds = configDoorIds(VaultConfigPayloadSchema.parse(config?.canonicalPayload));
  if (!payload.doorId || !profileDoorIds.includes(payload.doorId) || payload.expectedDoorIds.length !== 1 || payload.expectedDoorIds[0] !== payload.doorId) throw new VaultApiError(422, "CERTIFICATION_PROFILE_MEMBERSHIP_INVALID", "Certification evidence must identify exactly its commanded profile door");
  if (payload.outcome === "PASS" && (payload.observedDoorIds.length !== 1 || payload.observedDoorIds[0] !== payload.doorId)) throw new VaultApiError(422, "CERTIFICATION_PASS_OBSERVATION_INVALID", "A passing observation must identify exactly the expected door");
  if (payload.cycleType === "DIAGNOSTIC") {
    const command = await tx.vaultMachineEvent.findFirst({ where: { machineId: event.machineId, mode: "CERTIFICATION", type: "CERTIFICATION_COMMAND_COMMITTED", payload: { path: ["commandId"], equals: payload.commandId } } });
    const receipt = await tx.vaultMachineEvent.findFirst({ where: { machineId: event.machineId, mode: "CERTIFICATION", type: { in: ["CONTROLLER_COMMAND_TERMINAL", "CRITICAL_WRONG_DOOR_OBSERVED", "CONTROLLER_EFFECT_REMAINS_UNKNOWN"] }, payload: { path: ["commandId"], equals: payload.commandId } } });
    const committed = command ? EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_COMMAND_COMMITTED.parse(command.payload) : null;
    if (!committed || committed.certificationSessionId !== session.id || committed.scheduledDoorId !== payload.doorId || !receipt || payload.saleId || payload.restockSessionId) throw new VaultApiError(422, "CERTIFICATION_DIAGNOSTIC_LINK_INVALID", "Diagnostic evidence must bind a terminal command in this certification session");
  }
  if (payload.cycleType === "PURCHASE") {
    const sale = payload.saleId ? await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode) : null;
    const item = sale ? await tx.vaultSaleItem.findFirst({ where: { saleId: sale.id, doorId: payload.doorId ?? "", initialCommandId: payload.commandId } }) : null;
    if (!sale || sale.mode !== "CERTIFICATION" || sale.certificationSessionId !== session.id || !sale.authorizationObservedAt || !item || !item.initialCommandTerminalAt || !["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"].includes(item.initialCommandState)) throw new VaultApiError(422, "CERTIFICATION_PURCHASE_LINK_INVALID", "Purchase evidence must bind a terminal authorized certification sale command in this session");
  }
  if (payload.cycleType === "RESTOCK") {
    const item = payload.restockSessionId ? await tx.vaultRestockItem.findFirst({ where: { restockSessionId: payload.restockSessionId, doorId: payload.doorId ?? "", commandId: payload.commandId, restockSession: { machineId: event.machineId, mode: "CERTIFICATION", certificationSessionId: session.id } } }) : null;
    if (!item || !item.commandTerminalAt || !["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"].includes(item.commandState)) throw new VaultApiError(422, "CERTIFICATION_RESTOCK_LINK_INVALID", "Restock evidence must bind a terminal restock command");
  }
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
      metadata: { machineEventId: event.eventId, artifactStoragePending: true, unexpectedDoor: payload.unexpectedDoor, commandId: payload.commandId, cycleType: payload.cycleType, saleId: payload.saleId, restockSessionId: payload.restockSessionId, actor: event.actor ?? null },
      observedAt: new Date(payload.observedAt),
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
      const sale = await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      if (sale.paymentState !== "NOT_REQUESTED" || sale.state !== "RESERVED" || sale.totalCents !== payload.totalCents) throw new VaultApiError(422, "PAYMENT_INTENT_INVALID", "Payment intent must match the exact reserved sale total and state");
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "PAYMENT_REQUESTED", paymentState: "REQUESTED" } });
      return;
    }
    case "PAYMENT_START_EFFECT_UNKNOWN": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PAYMENT_START_EFFECT_UNKNOWN.parse(event.payload);
      const sale = await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      // Older clients could append this transport error after a provider callback.
      // Keep the immutable audit fact without regressing stronger payment evidence.
      if (sale.paymentState !== "REQUESTED") return;
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "PAYMENT_UNKNOWN", paymentState: "UNKNOWN" } });
      await openSafeSupportCase(tx, { machineId: event.machineId, saleId: payload.saleId, sourceId: payload.saleId, type: "PAYMENT_UNKNOWN", summary: "Payment status is unknown and requires reconciliation." });
      return;
    }
    case "PAYMENT_CALLBACK_APPLIED": return projectPaymentCallback(tx, event);
    case "VEND_RESULT_INTENT_RECORDED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.VEND_RESULT_INTENT_RECORDED.parse(event.payload);
      const sale = await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      const items = await tx.vaultSaleItem.findMany({ where: { saleId: sale.id } });
      if (!sale.authorizationObservedAt || !["AUTHORIZED", "RECONCILIATION_REQUIRED"].includes(sale.paymentState) || payload.items.length !== items.length || new Set(payload.items.map((item) => item.lineId)).size !== items.length || payload.items.some((item) => !items.some((stored) => stored.lineId === item.lineId && stored.initialCommandId === item.commandId && stored.initialCommandTerminalAt && stored.initialCommandState === item.outcome))) throw new VaultApiError(422, "VEND_RESULT_EVIDENCE_INVALID", "Vend result must bind every original paid line's terminal command evidence");
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { paymentState: "VEND_RESULT_PENDING" } });
      return;
    }
    case "FULFILLMENT_COMMITTED": return projectFulfillment(tx, event);
    case "PAYMENT_DECLINED_RESERVATION_RELEASED":
    case "PAYMENT_CANCELLED_RESERVATION_RELEASED": {
      const schema = event.type === "PAYMENT_DECLINED_RESERVATION_RELEASED" ? EVENT_PAYLOAD_SCHEMAS.PAYMENT_DECLINED_RESERVATION_RELEASED : EVENT_PAYLOAD_SCHEMAS.PAYMENT_CANCELLED_RESERVATION_RELEASED;
      const payload = schema.parse(event.payload);
      const sale = await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      if (sale.authorizationObservedAt) throw new VaultApiError(422, "AUTHORIZED_SALE_RELEASE_DENIED", "Authorized sale inventory cannot be released by a decline or cancellation");
      const declined = event.type === "PAYMENT_DECLINED_RESERVATION_RELEASED";
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: declined ? "PAYMENT_DECLINED" : "PAYMENT_CANCELLED", paymentState: declined ? "DECLINED" : "CANCELLED", cancelledAt: declined ? undefined : new Date(event.occurredAt) } });
      await tx.vaultSaleItem.updateMany({ where: { saleId: payload.saleId }, data: { allocationState: "AVAILABLE" } });
      if (event.mode === "PRODUCTION") await tx.vaultDoor.updateMany({ where: { machineId: event.machineId, owningSaleId: payload.saleId }, data: { state: "AVAILABLE", owningSaleId: null, lastEventId: event.eventId } });
      return;
    }
    case "PAID_DOOR_GROUP_RETRY_COMMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PAID_DOOR_GROUP_RETRY_COMMITTED.parse(event.payload);
      const sale = await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      if (!sale.authorizationObservedAt || sale.groupRetryConsumedAt) throw new VaultApiError(422, "RETRY_NOT_AVAILABLE", "Retry requires an authorized sale with unconsumed group entitlement");
      if (await tx.vaultSaleItem.count({ where: { saleId: payload.saleId, OR: [{ initialCommandId: null }, { initialCommandTerminalAt: null }] } })) throw new VaultApiError(422, "RETRY_COMMANDS_NOT_TERMINAL", "Retry requires every initial command to be terminal");
      const itemCount = await tx.vaultSaleItem.count({ where: { saleId: payload.saleId } });
      if (payload.commands.length !== itemCount || new Set(payload.commands.map((command) => command.doorId)).size !== itemCount) throw new VaultApiError(422, "RETRY_DOOR_SET_MISMATCH", "Retry must contain every projected paid door exactly once");
      for (const command of payload.commands) {
        const updated = await tx.vaultSaleItem.updateMany({ where: { saleId: payload.saleId, doorId: command.doorId, retryCommandId: null }, data: { retryUsedAt: new Date(event.occurredAt), retryCommandId: command.commandId, retryCommandState: "COMMAND_INTENT_RECORDED" } });
        if (updated.count !== 1) throw new VaultApiError(422, "RETRY_DOOR_SET_MISMATCH", "Retry contains a door outside the original paid group");
      }
      await tx.vaultSaleItem.updateMany({ where: { saleId: payload.saleId, fulfillmentState: { not: "SUPPORT_REQUIRED" } }, data: { fulfillmentState: "COMMANDS_PENDING" } });
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "OPEN_COMMAND_PENDING", fulfillmentState: "COMMANDS_PENDING", groupRetryConsumedAt: new Date(event.occurredAt) } });
      return;
    }
    case "CONTROLLER_COMMAND_TERMINAL":
    case "CRITICAL_WRONG_DOOR_OBSERVED": return projectCommandTerminal(tx, event);
    case "CONTROLLER_EFFECT_REMAINS_UNKNOWN": {
      const payload = EVENT_PAYLOAD_SCHEMAS.CONTROLLER_EFFECT_REMAINS_UNKNOWN.parse(event.payload);
      const saleId = event.correlationId;
      if (saleId) {
        await requireProjectedSale(tx, event.machineId, saleId, event.mode);
        const initial = await tx.vaultSaleItem.updateMany({ where: { saleId, initialCommandId: payload.commandId, initialCommandTerminalAt: null }, data: { initialCommandState: "SENT_UNKNOWN", initialCommandTerminalAt: new Date(event.occurredAt) } });
        const retry = initial.count === 0 ? await tx.vaultSaleItem.updateMany({ where: { saleId, retryCommandId: payload.commandId, retryCommandTerminalAt: null }, data: { retryCommandState: "SENT_UNKNOWN", retryCommandTerminalAt: new Date(event.occurredAt) } }) : { count: 0 };
        if (initial.count + retry.count !== 1) throw new VaultApiError(422, "COMMAND_PROJECTION_MISSING", "Terminal unknown result must reference an unfinished command");
        const pending = await tx.vaultSaleItem.count({ where: { saleId, OR: [{ retryCommandId: null, initialCommandTerminalAt: null }, { retryCommandId: { not: null }, retryCommandTerminalAt: null }] } });
        if (pending === 0) {
          await tx.vaultSaleItem.updateMany({ where: { saleId, fulfillmentState: "COMMANDS_PENDING" }, data: { fulfillmentState: "COMMANDS_TERMINAL" } });
          await tx.vaultSale.updateMany({ where: { id: saleId, machineId: event.machineId, fulfillmentState: "COMMANDS_PENDING" }, data: { fulfillmentState: "COMMANDS_TERMINAL" } });
        }
      } else await tx.vaultRestockItem.updateMany({ where: { commandId: payload.commandId, commandTerminalAt: null, restockSession: { machineId: event.machineId, mode: event.mode, state: "ACTIVE" } }, data: { commandState: "SENT_UNKNOWN", commandTerminalAt: new Date(event.occurredAt) } });
      return;
    }
    case "PUBLIC_PRESENTATION_DONE": {
      const payload = EVENT_PAYLOAD_SCHEMAS.PUBLIC_PRESENTATION_DONE.parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { customerDoneAt: new Date(event.occurredAt), fulfillmentState: "CUSTOMER_DONE" } });
      return;
    }
    case "PAYMENT_RECOVERY_INTENT_DIGEST_CONFLICT":
    case "PAYMENT_RECOVERY_EFFECT_UNRESOLVED":
    case "PAYMENT_RECOVERY_RECONCILIATION_REQUIRED": {
      const payload = z.object({ saleId: uuid }).strict().parse(event.payload);
      await requireProjectedSale(tx, event.machineId, payload.saleId, event.mode);
      await tx.vaultSale.updateMany({ where: { id: payload.saleId, machineId: event.machineId }, data: { state: "RECONCILIATION_REQUIRED", paymentState: "RECONCILIATION_REQUIRED", reconciliationRequiredAt: new Date(event.occurredAt) } });
      await openSafeSupportCase(tx, { machineId: event.machineId, saleId: payload.saleId, sourceId: payload.saleId, type: "PAYMENT_RECONCILIATION", summary: "Payment reconciliation requires staff review." });
      return;
    }
    case "RESTOCK_SESSION_STARTED": return projectRestockStarted(tx, event);
    case "RESTOCK_DOOR_REVIEWED": return projectRestockReviewed(tx, event);
    case "RESTOCK_DOOR_COMMAND_COMMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_DOOR_COMMAND_COMMITTED.parse(event.payload);
      const updated = await tx.vaultRestockItem.updateMany({ where: { restockSessionId: payload.restockSessionId, doorId: payload.doorId, state: "UNREVIEWED", commandId: null, restockSession: { machineId: event.machineId, mode: event.mode, state: "ACTIVE" } }, data: { commandId: payload.commandId, commandState: "COMMAND_INTENT_RECORDED" } });
      if (updated.count !== 1) throw new VaultApiError(422, "RESTOCK_ITEM_MISSING", "Restock command references an unexpected door");
      return;
    }
    case "RESTOCK_SESSION_FINALIZED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.RESTOCK_SESSION_FINALIZED.parse(event.payload);
      const session = await tx.vaultRestockSession.findFirst({ where: { id: payload.restockSessionId, machineId: event.machineId, mode: event.mode, state: "ACTIVE" }, include: { items: true } });
      if (!session || session.items.length !== session.expectedDoorCount || session.items.some((item) => item.state === "UNREVIEWED" || !item.commandTerminalAt)) throw new VaultApiError(422, "RESTOCK_NOT_COMPLETE", "Finalization requires every pinned restock door reviewed after its terminal command");
      const counts = { FILLED: payload.filled, LEFT_EMPTY: payload.leftEmpty, EXCEPTION: payload.exceptions };
      if (Object.entries(counts).some(([state, count]) => session.items.filter((item) => item.state === state).length !== count)) throw new VaultApiError(422, "RESTOCK_COUNT_MISMATCH", "Finalization counts must equal persisted observations");
      const updated = await tx.vaultRestockSession.updateMany({ where: { id: payload.restockSessionId, machineId: event.machineId, mode: event.mode, state: "ACTIVE" }, data: { state: "FINALIZED", filledCount: payload.filled, leftEmptyCount: payload.leftEmpty, exceptionCount: payload.exceptions, physicalCloseConfirmedAt: new Date(event.occurredAt), finalizedAt: new Date(event.occurredAt) } });
      if (updated.count !== 1) throw new VaultApiError(422, "RESTOCK_PROJECTION_MISSING", "Restock finalization arrived before an active session");
      return;
    }
    case "CERTIFICATION_SESSION_STARTED": return projectCertificationStarted(tx, event);
    case "CERTIFICATION_COMMAND_COMMITTED": {
      const payload = EVENT_PAYLOAD_SCHEMAS.CERTIFICATION_COMMAND_COMMITTED.parse(event.payload);
      const session = await tx.vaultCertificationSession.findFirst({ where: { id: payload.certificationSessionId, machineId: event.machineId } });
      if (!session || session.status !== "ACTIVE" || event.mode !== "CERTIFICATION") throw new VaultApiError(422, "CERTIFICATION_PROJECTION_MISSING", "Certification command requires an active test session");
      const config = await tx.vaultConfigVersion.findUnique({ where: { id: session.configVersionId } });
      if (!configDoorIds(VaultConfigPayloadSchema.parse(config?.canonicalPayload)).includes(payload.scheduledDoorId)) throw new VaultApiError(422, "CERTIFICATION_PROFILE_MEMBERSHIP_INVALID", "Certification command must be a member of the pinned profile");
      return;
    }
    case "CERTIFICATION_EVIDENCE_RECORDED":
    case "CERTIFICATION_CRITICAL_STOP": return projectCertificationEvidence(tx, event);
    case "CERTIFICATION_SUBMITTED": {
      if (event.mode !== "CERTIFICATION") throw new VaultApiError(422, "CERTIFICATION_MODE_REQUIRED", "Certification submission requires immutable test mode");
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
