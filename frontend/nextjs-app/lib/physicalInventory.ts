import { z } from "zod";
import type { CardInventoryCommandV2 } from "@tenkings/database";

const text = z.string().min(1).max(2000);
const id = z.string().min(1).max(200);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const custody = z.string().regex(/^(machine|warehouse):[^\s]+$/).max(240);
const bindingSchema = z.object({ custody_id: custody, location_id: z.string().uuid(), evidence_ref: text }).strict();
const componentSchema = z.object({
  unit_id: id.nullable(), lot_id: id, acquisition_cycle_id: id, acquisition_event_id: id,
  quantity: z.number().int().positive(), cost_cents: cents.nullable(),
  basis: z.enum(["documented_unit", "documented_pack_contents", "allocated_acquisition", "unknown"]),
  purchase_ledger_line_id: id.nullable(), evidence_ref: text, unknown_reason: text.nullable(),
}).strict().refine((value) => value.cost_cents === null
  ? value.basis === "unknown" && value.unknown_reason !== null
  : value.basis !== "unknown" && value.unknown_reason === null);

// Browser DTO validation has no runtime database or node:crypto dependency.
// The source read service independently verifies each canonical journal record.
export const physicalInventoryEventSchema = z.object({
  source_event_id: id, source_sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  event_kind: z.enum(["opening", "receipt", "restock", "transfer", "pack", "unpack", "sale", "return", "refund", "reversal"]),
  effective_at: timestamp, recorded_at: timestamp, recorded_by: id, correction_reason: text.nullable(),
  external_product_id: id, stock_id: id.nullable(), unit_or_pack_id: id.nullable(),
  lot_id: id.nullable(), acquisition_cycle_id: id.nullable(), quantity: z.number().int().nonnegative(),
  from_custody_id: custody.nullable(), to_custody_id: custody.nullable(), external_sale_id: id.nullable(),
  reverses_source_event_id: id.nullable(), currency: z.literal("USD"), evidence_ref: text,
  sale_gross_cents: cents.nullable(), components: z.array(componentSchema).max(1000),
  inputs: z.array(z.object({ stock_id: id, quantity: z.number().int().positive() }).strict()).max(1000),
}).strict();
const fulfilmentSchema = z.object({
  payment_status: z.literal("SUCCEEDED"), payment_reference: id, physical_status: z.literal("DISPATCHED"),
  dispatch_reference: id, evidence_ref: text,
}).strict();
export const physicalInventoryCardSchema = z.object({
  version: z.literal(1),
  card: z.object({
    id, publicToken: id, speedsterSessionId: id, category: id, playerName: text.nullable(), cardName: text.nullable(),
    year: text, manufacturer: text.nullable(), productSet: text, parallel: text.nullable(), insert: text.nullable(),
    cardNumber: text.nullable(), currentOwnerType: id, currentOwnerId: id.nullable(), lifecycleState: id,
    locationId: z.string().uuid().nullable(), saleMode: id,
  }).strict(),
  locations: z.array(z.object({ id: z.string().uuid(), name: text, slug: text }).strict()).max(1000),
  history: z.array(z.object({
    request_id: id, event: physicalInventoryEventSchema, product_identity_ref: text,
    custody_bindings: z.array(bindingSchema).max(2), ownership_evidence_ref: text.nullable(), fulfilment: fulfilmentSchema.nullable(),
  }).strict()).max(10000),
  position: z.object({
    origin: physicalInventoryEventSchema, custody_id: custody, quantity: z.literal(1),
    product_identity_ref: text, binding: bindingSchema,
  }).strict().nullable(),
  bindings: z.array(bindingSchema).max(20000),
  sales: z.array(z.object({
    source_event_id: id, reversed: z.boolean(), returned_quantity: z.number().int().min(0).max(1),
    remaining_return_quantity: z.number().int().min(0).max(1), refunded_cents: cents, remaining_refund_cents: cents.nullable(),
    return_available: z.boolean(), refund_available: z.boolean(), return_reason: text.nullable(), refund_reason: text.nullable(),
  }).strict()).max(10000),
  actions: z.object({ receive: z.boolean(), pack: z.boolean(), move: z.boolean(), sale: z.boolean(), return: z.boolean(), refund: z.boolean(), reason: text.nullable() }).strict(),
}).strict();
export type PhysicalInventoryCard = z.infer<typeof physicalInventoryCardSchema>;
export type PhysicalInventoryEvent = z.infer<typeof physicalInventoryEventSchema>;
export type PhysicalInventoryBinding = z.infer<typeof bindingSchema>;
export type PhysicalInventoryAction = "receive" | "pack" | "move" | "sale" | "return" | "refund";

export type PhysicalInventoryDraft = {
  effectiveAt: string; evidenceRef: string; receiptKind: "" | "opening" | "receipt";
  productId: string; productEvidenceRef: string; ownershipEvidenceRef: string;
  custodyKind: "" | "warehouse" | "machine"; custodyExternalId: string; locationId: string; custodyEvidenceRef: string;
  acquisitionId: string; lotId: string; cycleId: string; costKind: "" | "documented_unit" | "allocated_acquisition" | "unknown";
  costUsd: string; costEvidenceRef: string; unknownReason: string;
  packId: string; movementKind: "" | "transfer" | "restock";
  saleAmountKind: "" | "known" | "unknown"; saleUsd: string;
  paymentReference: string; dispatchReference: string; fulfilmentEvidenceRef: string;
  paymentSucceeded: boolean; dispatched: boolean;
  originalSaleId: string; correctionReason: string; refundReference: string; refundUsd: string;
  physicallyReturned: boolean; refundCompleted: boolean;
};
export const emptyPhysicalInventoryDraft = (): PhysicalInventoryDraft => ({
  effectiveAt: "", evidenceRef: "", receiptKind: "", productId: "", productEvidenceRef: "", ownershipEvidenceRef: "",
  custodyKind: "", custodyExternalId: "", locationId: "", custodyEvidenceRef: "", acquisitionId: "", lotId: "", cycleId: "",
  costKind: "", costUsd: "", costEvidenceRef: "", unknownReason: "", packId: "", movementKind: "", saleAmountKind: "",
  saleUsd: "", paymentReference: "", dispatchReference: "", fulfilmentEvidenceRef: "", paymentSucceeded: false, dispatched: false,
  originalSaleId: "", correctionReason: "", refundReference: "", refundUsd: "", physicallyReturned: false, refundCompleted: false,
});

export class PhysicalInventoryInputError extends Error {}
const required = (value: string, label: string, maximum = 2000): string => {
  const result = value.trim();
  if (!result || result.length > maximum) throw new PhysicalInventoryInputError(`${label} is required (maximum ${maximum} characters).`);
  return result;
};
export function physicalInventoryUsdToCents(value: string, label = "USD amount", maximum = Number.MAX_SAFE_INTEGER): number {
  const normalized = value.trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(normalized)) {
    throw new PhysicalInventoryInputError(`${label} must be a nonnegative USD amount with at most two decimal places.`);
  }
  const [dollars, fraction = ""] = normalized.split(".");
  const result = BigInt(dollars) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(maximum)) throw new PhysicalInventoryInputError(`${label} exceeds the supported cents range.`);
  return Number(result);
}
export function physicalInventoryMoney(value: number | null): string {
  if (value === null) return "Unknown";
  if (!Number.isSafeInteger(value) || value < 0) return "Unavailable: invalid recorded amount";
  const amount = BigInt(value);
  return `$${(amount / 100n).toLocaleString("en-US")}.${String(amount % 100n).padStart(2, "0")}`;
}
function effectiveTime(value: string): string {
  const parsed = timestamp.safeParse(value.trim());
  if (!parsed.success) throw new PhysicalInventoryInputError("Enter the evidenced UTC time in YYYY-MM-DDTHH:mm:ss.sssZ format.");
  return parsed.data;
}
function destination(draft: PhysicalInventoryDraft, card: PhysicalInventoryCard): PhysicalInventoryBinding {
  if (!draft.custodyKind) throw new PhysicalInventoryInputError("Choose machine or warehouse custody.");
  const binding = bindingSchema.safeParse({
    custody_id: `${draft.custodyKind}:${required(draft.custodyExternalId, "External custody ID", 200)}`,
    location_id: draft.locationId.trim(), evidence_ref: required(draft.custodyEvidenceRef, "Custody-to-Location evidence"),
  });
  if (!binding.success) throw new PhysicalInventoryInputError("Custody needs an exact external ID without spaces, an existing Location UUID, and its evidence reference.");
  if (!card.locations.some((location) => location.id === binding.data.location_id)) throw new PhysicalInventoryInputError("Choose an existing Location from the loaded list.");
  const known = card.bindings.find((entry) => entry.custody_id === binding.data.custody_id);
  if (known && (known.location_id !== binding.data.location_id || known.evidence_ref !== binding.data.evidence_ref)) {
    throw new PhysicalInventoryInputError("This custody ID already has accepted Location evidence. Reuse that exact binding.");
  }
  return binding.data;
}

export function buildPhysicalInventoryCommand(input: {
  requestId: string; action: PhysicalInventoryAction; draft: PhysicalInventoryDraft; card: PhysicalInventoryCard;
}): CardInventoryCommandV2 {
  const { action, draft: d, card } = input;
  if (!card.actions[action]) throw new PhysicalInventoryInputError("This action is unavailable for the recorded card state. Reload its evidence.");
  const position = card.position;
  const origin = position?.origin;
  const event: CardInventoryCommandV2["event"] = {
    event_kind: "receipt", effective_at: effectiveTime(d.effectiveAt), correction_reason: null,
    external_product_id: "", stock_id: null, unit_or_pack_id: card.card.id, lot_id: null, acquisition_cycle_id: null,
    quantity: 1, from_custody_id: null, to_custody_id: null, external_sale_id: null, reverses_source_event_id: null,
    currency: "USD", evidence_ref: required(d.evidenceRef, action === "refund" ? "Completed refund evidence" : "Physical event evidence"), sale_gross_cents: null, components: [], inputs: [],
  };
  let bindings: PhysicalInventoryBinding[] = [];
  let productEvidence: string;
  let ownershipEvidence: string | null = null;
  let fulfilment: CardInventoryCommandV2["fulfilment"] = null;
  if (action === "receive") {
    if (!d.receiptKind || !d.costKind) throw new PhysicalInventoryInputError("Choose receipt/opening and the acquisition cost basis.");
    const binding = destination(d, card);
    event.event_kind = d.receiptKind;
    event.external_product_id = required(d.productId, "Product ID", 200);
    event.to_custody_id = binding.custody_id;
    event.lot_id = required(d.lotId, "Acquisition lot ID", 200);
    event.acquisition_cycle_id = required(d.cycleId, "Acquisition cycle ID", 200);
    event.components = [{
      unit_id: card.card.id, lot_id: event.lot_id, acquisition_cycle_id: event.acquisition_cycle_id,
      acquisition_event_id: required(d.acquisitionId, "Acquisition/invoice identity", 200), quantity: 1,
      cost_cents: d.costKind === "unknown" ? null : physicalInventoryUsdToCents(d.costUsd, "Acquisition cost"),
      basis: d.costKind, purchase_ledger_line_id: null, evidence_ref: required(d.costEvidenceRef, "Acquisition cost evidence"),
      unknown_reason: d.costKind === "unknown" ? required(d.unknownReason, "Unknown-cost reason") : null,
    }];
    productEvidence = required(d.productEvidenceRef, "Product definition evidence");
    ownershipEvidence = required(d.ownershipEvidenceRef, "House ownership evidence");
    bindings = [binding];
  } else if (action === "return" || action === "refund") {
    const saleId = required(d.originalSaleId, "Original completed sale", 200);
    const balance = card.sales.find((entry) => entry.source_event_id === saleId);
    const original = card.history.find((entry) => entry.event.source_event_id === saleId && entry.event.event_kind === "sale");
    if (!balance || !original || balance.reversed || !balance[`${action}_available`]) {
      throw new PhysicalInventoryInputError("Choose an eligible original sale from the loaded history. Reload if its remaining balance changed.");
    }
    event.event_kind = action;
    event.external_product_id = original.event.external_product_id;
    event.reverses_source_event_id = saleId;
    event.correction_reason = required(d.correctionReason, action === "return" ? "Physical return reason" : "Refund reason");
    productEvidence = original.product_identity_ref;
    if (action === "return") {
      if (!d.physicallyReturned) throw new PhysicalInventoryInputError("Verify that the exact original card/pack was physically returned before recording it.");
      if (balance.remaining_return_quantity !== 1 || card.position || card.card.currentOwnerType !== "EXTERNAL") {
        throw new PhysicalInventoryInputError("This sale has no eligible physical card remaining to return.");
      }
      const binding = destination(d, card);
      Object.assign(event, {
        stock_id: original.event.stock_id, unit_or_pack_id: original.event.unit_or_pack_id,
        lot_id: original.event.lot_id, acquisition_cycle_id: original.event.acquisition_cycle_id,
        components: structuredClone(original.event.components), to_custody_id: binding.custody_id,
      });
      ownershipEvidence = required(d.ownershipEvidenceRef, "Returned house ownership evidence");
      bindings = [binding];
    } else {
      if (!d.refundCompleted) throw new PhysicalInventoryInputError("Verify that the referenced money refund completed before recording it.");
      const amount = physicalInventoryUsdToCents(d.refundUsd, "Completed refund amount", 2_147_483_647);
      if (amount === 0 || balance.remaining_refund_cents === null || amount > balance.remaining_refund_cents) {
        throw new PhysicalInventoryInputError("The completed refund must be positive and no greater than the original sale’s remaining documented gross.");
      }
      Object.assign(event, { quantity: 0, unit_or_pack_id: null, sale_gross_cents: amount,
        external_sale_id: required(d.refundReference, "Completed refund identity", 200) });
    }
  } else {
    if (!position || !origin) throw new PhysicalInventoryInputError("There is no recorded stock to move, pack, or sell.");
    Object.assign(event, {
      external_product_id: origin.external_product_id, stock_id: origin.stock_id, unit_or_pack_id: origin.unit_or_pack_id,
      lot_id: origin.lot_id, acquisition_cycle_id: origin.acquisition_cycle_id, components: structuredClone(origin.components),
      from_custody_id: position.custody_id,
    });
    bindings = [{ ...position.binding }];
    productEvidence = position.product_identity_ref;
    if (action === "pack") {
      event.event_kind = "pack";
      event.stock_id = null;
      event.unit_or_pack_id = required(d.packId, "Physical pack ID", 200);
      if (event.unit_or_pack_id === card.card.id) throw new PhysicalInventoryInputError("The physical pack needs its own evidenced ID, distinct from the permanent card ID.");
      event.external_product_id = required(d.productId, "Packed product ID", 200);
      productEvidence = required(d.productEvidenceRef, "Packed product definition evidence");
      event.to_custody_id = position.custody_id;
      event.inputs = [{ stock_id: origin.stock_id!, quantity: 1 }];
    } else if (action === "move") {
      if (!d.movementKind) throw new PhysicalInventoryInputError("Choose transfer or restock.");
      const binding = destination(d, card);
      if (binding.custody_id === position.custody_id) throw new PhysicalInventoryInputError("Choose a destination different from the current custody.");
      if (d.movementKind === "restock" && !binding.custody_id.startsWith("machine:")) throw new PhysicalInventoryInputError("A restock destination must identify the actual machine.");
      event.event_kind = d.movementKind;
      event.to_custody_id = binding.custody_id;
      bindings.push(binding);
    } else {
      if (!d.paymentSucceeded || !d.dispatched) throw new PhysicalInventoryInputError("Record a sale only after verifying successful payment and completed physical dispatch.");
      if (!d.saleAmountKind) throw new PhysicalInventoryInputError("Choose whether the sale gross is evidenced or unknown.");
      event.event_kind = "sale";
      event.sale_gross_cents = d.saleAmountKind === "known" ? physicalInventoryUsdToCents(d.saleUsd, "Sale gross", 2_147_483_647) : null;
      event.external_sale_id = required(d.dispatchReference, "Completed dispatch identity", 200);
      fulfilment = {
        payment_status: "SUCCEEDED", payment_reference: required(d.paymentReference, "Successful payment reference", 200),
        physical_status: "DISPATCHED", dispatch_reference: event.external_sale_id,
        evidence_ref: required(d.fulfilmentEvidenceRef, "Payment and dispatch evidence"),
      };
    }
  }
  const command = { request_id: required(input.requestId, "Request identity", 200), card_id: card.card.id,
    product_identity_ref: productEvidence, custody_bindings: bindings, ownership_evidence_ref: ownershipEvidence, fulfilment, event };
  if (new TextEncoder().encode(JSON.stringify(command)).length > 60 * 1024) throw new PhysicalInventoryInputError("Evidence is too large; use concise references to the source documents.");
  return command;
}

export function physicalInventoryApiMessage(status: number): string {
  if (status === 401 || status === 403) return "Sign in with a human admin account to access physical inventory.";
  if (status === 404) return "No permanent card matches that exact ID.";
  if (status === 400) return "The source rejected the evidence fields. Check the required identities, time, and evidence references.";
  if (status === 409) return "This request conflicts with accepted card, product, or custody evidence. Reload history before correcting the draft.";
  return "The inventory service could not confirm this request. The submitted evidence and retry identity are retained.";
}

export type PhysicalInventoryReceipt = { outcome: "RECORDED" | "REPLAY"; event: PhysicalInventoryEvent };
export const physicalInventoryReceiptSchema = z.object({
  outcome: z.enum(["RECORDED", "REPLAY"]), event: physicalInventoryEventSchema,
}).strict();

export const physicalInventoryPendingSchema = z.object({
  version: z.literal(1), adminId: id, action: z.enum(["receive", "pack", "move", "sale", "return", "refund"]),
  command: z.object({
    request_id: id, card_id: id, product_identity_ref: text, custody_bindings: z.array(bindingSchema).max(2),
    ownership_evidence_ref: text.nullable(), fulfilment: fulfilmentSchema.nullable(),
    event: physicalInventoryEventSchema.omit({ source_event_id: true, source_sequence: true, recorded_at: true, recorded_by: true }),
  }).strict(),
}).strict();
export type PhysicalInventoryPending = z.infer<typeof physicalInventoryPendingSchema>;

export async function physicalInventoryRequestEventId(requestId: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(requestId)));
  return "v2inv_" + Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, part]) => JSON.stringify(key) + ":" + canonical(part)).join(",") + "}";
  return JSON.stringify(value);
};
export function physicalInventoryReceiptMatches(event: PhysicalInventoryEvent, pending: PhysicalInventoryPending, expectedId: string): boolean {
  const { source_event_id, source_sequence, recorded_at, recorded_by, ...evidence } = event;
  return source_event_id === expectedId && Number.isSafeInteger(source_sequence) && Boolean(recorded_at) && recorded_by === pending.adminId &&
    canonical(evidence) === canonical({ ...pending.command.event,
      stock_id: ["opening", "receipt", "pack"].includes(pending.command.event.event_kind) ? expectedId : pending.command.event.stock_id });
}

export function physicalInventoryHistoryMatches(entry: PhysicalInventoryCard["history"][number], pending: PhysicalInventoryPending, expectedId: string): boolean {
  return entry.request_id === pending.command.request_id && physicalInventoryReceiptMatches(entry.event, pending, expectedId) &&
    entry.product_identity_ref === pending.command.product_identity_ref && entry.ownership_evidence_ref === pending.command.ownership_evidence_ref &&
    canonical(entry.custody_bindings) === canonical(pending.command.custody_bindings) && canonical(entry.fulfilment) === canonical(pending.command.fulfilment);
}
