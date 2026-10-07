// Financial inventory wire contract v1; kept byte-semantically aligned with
// tk-financial-story/ledger-core/inventory/contract.ts (2026-09-07).
import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const evidence = z.string().trim().min(1).max(2000);
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantity = z.number().int().min(1).max(1_000_000);
export const inventoryTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s, 'expected a real UTC timestamp with milliseconds');
const custody = z.string().regex(/^(machine|warehouse):[^\s]+$/).max(240);

export const InventoryComponentInput = z.object({
  unit_id: id.nullable(), lot_id: id, acquisition_cycle_id: id, acquisition_event_id: id,
  quantity, cost_cents: cents.nullable(),
  basis: z.enum(['documented_unit', 'documented_pack_contents', 'allocated_acquisition', 'unknown']),
  purchase_ledger_line_id: id.nullable(), evidence_ref: evidence, unknown_reason: evidence.nullable(),
}).strict().refine((c) => c.cost_cents === null ? c.basis === 'unknown' && c.unknown_reason !== null : c.basis !== 'unknown' && c.unknown_reason === null, 'unknown cost needs its reason; known cost needs a documented basis')
  .refine((c) => c.unit_id === null || c.quantity === 1, 'an identified card/component is one unit');
export type InventoryComponent = z.infer<typeof InventoryComponentInput>;

export const InventorySourceEventInput = z.object({
  source_event_id: id, source_sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  event_kind: z.enum(['opening', 'receipt', 'restock', 'transfer', 'pack', 'unpack', 'sale', 'return', 'refund', 'reversal']),
  effective_at: inventoryTime, recorded_at: inventoryTime, recorded_by: id, correction_reason: evidence.nullable(), external_product_id: id,
  // stock_id is the source_event_id of the opening/receipt/pack that created this stock.
  stock_id: id.nullable(), unit_or_pack_id: id.nullable(), lot_id: id.nullable(), acquisition_cycle_id: id.nullable(),
  quantity: z.number().int().min(0).max(1_000_000), from_custody_id: custody.nullable(), to_custody_id: custody.nullable(),
  external_sale_id: id.nullable(), reverses_source_event_id: id.nullable(), currency: z.literal('USD'),
  evidence_ref: evidence, sale_gross_cents: cents.nullable(),
  components: z.array(InventoryComponentInput).max(1000),
  inputs: z.array(z.object({ stock_id: id, quantity }).strict()).max(1000),
}).strict().superRefine((e, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (['return','refund','reversal'].includes(e.event_kind) && !e.correction_reason) fail('return/refund/reversal needs an explicit reason');
  if (e.recorded_at < e.effective_at) fail('recorded time precedes the effective event');
  if (e.event_kind === 'refund' || (e.event_kind === 'reversal' && e.quantity === 0)) {
    if (e.quantity !== 0 || e.stock_id !== null || e.components.length || e.from_custody_id || e.to_custody_id || e.inputs.length || e.unit_or_pack_id || e.lot_id || e.acquisition_cycle_id) fail('a refund moves money only');
    if (!e.reverses_source_event_id || e.sale_gross_cents === null || !e.external_sale_id) fail('refund needs its original sale, refund identity and amount');
    return;
  }
  if (e.quantity < 1 || !e.stock_id || !e.components.length) fail('a physical event requires stock, positive quantity and explicit components');
  if (!e.unit_or_pack_id && (!e.lot_id || !e.acquisition_cycle_id)) fail('stock needs an identified unit/pack or a lot and acquisition cycle');
  if (e.unit_or_pack_id && e.quantity !== 1) fail('an identified unit or pack has quantity one');
  if (e.event_kind === 'sale' && (!e.external_sale_id || e.from_custody_id?.startsWith('machine:') !== true || e.to_custody_id !== null)) fail('sale needs a completed fulfilment identity and a machine stock withdrawal');
  if (['opening', 'receipt', 'pack'].includes(e.event_kind) && e.stock_id !== e.source_event_id) fail('new stock identity must equal its opening/receipt/pack event identity');
  if (['opening', 'receipt'].includes(e.event_kind) && (e.from_custody_id !== null || !e.to_custody_id)) fail('opening/receipt enters a stated custody location');
  if (['restock', 'transfer'].includes(e.event_kind) && (!e.from_custody_id || !e.to_custody_id || e.from_custody_id === e.to_custody_id)) fail('movement needs distinct from/to custody');
  if (['pack', 'unpack'].includes(e.event_kind) && (!e.unit_or_pack_id || e.from_custody_id !== e.to_custody_id || !e.to_custody_id)) fail('packing/unpacking requires one identified pack at one custody location');
  if (e.event_kind === 'pack' ? !e.inputs.length : e.inputs.length > 0) fail('only packing supplies its consumed stock inputs');
  if (['return', 'reversal'].includes(e.event_kind) !== (e.reverses_source_event_id !== null)) fail('return/reversal must cite its original event; other physical events cannot');
  if (e.event_kind === 'return' && (e.from_custody_id !== null || e.to_custody_id === null)) fail('physical return restores stock to a stated custody location');
  if (!['sale', 'reversal'].includes(e.event_kind) && (e.sale_gross_cents !== null || e.external_sale_id !== null)) fail('only sale/refund (or its reversal) carries a selling amount/identity');
});
export type InventorySourceEvent = z.infer<typeof InventorySourceEventInput>;

export const InventoryPageInput = z.object({
  schema_version: z.literal(1), source_system: id, snapshot_id: id,
  after_sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  through_sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  events: z.array(InventorySourceEventInput).max(1000),
}).strict().superRefine((p, ctx) => {
  if (p.through_sequence !== p.after_sequence + p.events.length || p.events.some((e, i) => e.source_sequence !== p.after_sequence + i + 1)) ctx.addIssue({ code: 'custom', message: 'page sequences must be contiguous from after_sequence through through_sequence' });
  if (new Set(p.events.map((e) => e.source_event_id)).size !== p.events.length) ctx.addIssue({ code: 'custom', message: 'duplicate event identity within page' });
});
export type InventoryPage = z.infer<typeof InventoryPageInput>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export const inventoryHash = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');
export const inventoryId = (source: string, id: string): string => 'inv:' + inventoryHash([source, id]);
export function safeSum(values: number[]): number {
  const result = values.reduce((n, value) => n + BigInt(value), 0n);
  const n = Number(result);
  if (!Number.isSafeInteger(n)) throw new Error('inventory amount or quantity exceeds safe integer range');
  return n;
}
export function scaledComponents(components: InventoryComponent[], denominator: number, quantity: number): InventoryComponent[] {
  return components.map((c) => {
    const scale = (n: number) => {
      const numerator = BigInt(n) * BigInt(quantity), divisor = BigInt(denominator);
      if (divisor <= 0n || numerator % divisor !== 0n) throw new Error('fractional units/cents cannot be guessed');
      return Number(numerator / divisor);
    };
    const q = scale(c.quantity);
    const amount = c.cost_cents === null ? null : scale(c.cost_cents);
    if (!Number.isSafeInteger(q) || (amount !== null && !Number.isSafeInteger(amount))) throw new Error('identify the individual units or supply a documented homogeneous lot; fractional units/cents cannot be guessed');
    return { ...c, quantity: q, cost_cents: amount };
  });
}

export const CARD_INVENTORY_SOURCE_V2 = 'ten-kings-card-platform-v2';
export const CARD_INVENTORY_MAX_BYTES = 10 * 1024 * 1024;

// The transport never accepts a caller's recording actor, recording clock, or
// sequence. request_id is a retry key, not a source-event identity.
export const CardInventoryCommandV2Input = z.object({
  request_id: id,
  card_id: id,
  product_identity_ref: evidence,
  custody_bindings: z.array(z.object({
    custody_id: custody, location_id: z.string().uuid(), evidence_ref: evidence,
  }).strict()).max(2),
  ownership_evidence_ref: evidence.nullable(),
  fulfilment: z.object({
    payment_status: z.literal('SUCCEEDED'), payment_reference: id,
    physical_status: z.literal('DISPATCHED'), dispatch_reference: id,
    evidence_ref: evidence,
  }).strict().nullable(),
  event: z.object(InventorySourceEventInput.shape).omit({
    source_event_id: true, source_sequence: true, recorded_at: true, recorded_by: true,
  }).strict(),
}).strict();
export type CardInventoryCommandV2 = z.infer<typeof CardInventoryCommandV2Input>;
export const cardInventorySourceEventIdV2 = (requestId: string) => 'v2inv_' + inventoryHash(requestId);

export class CardInventoryErrorV2 extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'CONFLICT' | 'INTEGRITY' | 'UNAVAILABLE', message: string) {
    super(message);
    this.name = 'CardInventoryErrorV2';
  }
}

export function parseCardInventoryCommandV2(value: unknown): CardInventoryCommandV2 {
  const parsed = CardInventoryCommandV2Input.safeParse(value);
  if (!parsed.success) throw new CardInventoryErrorV2('INVALID_INPUT', 'Invalid physical inventory evidence');
  const c = parsed.data;
  if (Buffer.byteLength(JSON.stringify(c), 'utf8') > 64 * 1024) throw new CardInventoryErrorV2('INVALID_INPUT', 'Inventory evidence exceeds 64 KiB');
  const e = c.event;
  const moneyOnly = e.event_kind === 'refund' || (e.event_kind === 'reversal' && e.quantity === 0);
  if (!moneyOnly && (e.quantity !== 1 || e.components.length !== 1 || e.components[0].unit_id !== c.card_id || e.components[0].quantity !== 1)) {
    throw new CardInventoryErrorV2('INVALID_INPUT', 'V2 stock contains exactly one identified permanent card');
  }
  if (e.event_kind === 'pack' && (e.inputs.length !== 1 || e.inputs[0].quantity !== 1 || e.unit_or_pack_id === c.card_id)) {
    throw new CardInventoryErrorV2('INVALID_INPUT', 'Packing requires one loose card and one distinct evidenced pack identity');
  }
  if (['opening', 'receipt'].includes(e.event_kind) && e.unit_or_pack_id !== c.card_id) {
    throw new CardInventoryErrorV2('INVALID_INPUT', 'Receive the permanent loose card before documenting its physical pack');
  }
  if (['opening', 'receipt', 'pack'].includes(e.event_kind) && e.stock_id !== null) {
    throw new CardInventoryErrorV2('INVALID_INPUT', 'New stock identity is assigned by the source');
  }
  const endpoints = [...new Set([e.from_custody_id, e.to_custody_id].filter((v): v is string => v !== null))].sort();
  const supplied = c.custody_bindings.map(b => b.custody_id).sort();
  if (canonical(endpoints) !== canonical(supplied)) throw new CardInventoryErrorV2('INVALID_INPUT', 'Every custody endpoint requires exactly one explicit existing-location binding');
  if (e.event_kind === 'sale' ? !c.fulfilment || c.fulfilment.dispatch_reference !== e.external_sale_id : c.fulfilment !== null) {
    throw new CardInventoryErrorV2('INVALID_INPUT', 'A sale requires its exact successful-payment and completed-dispatch evidence');
  }
  if (e.sale_gross_cents !== null && e.sale_gross_cents > 2_147_483_647) throw new CardInventoryErrorV2('INVALID_INPUT', 'Sale amount exceeds the existing ownership ledger cents range');
  return c;
}
