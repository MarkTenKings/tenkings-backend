import { z } from 'zod';
import { canonical, inventoryHash, CardInventoryErrorV2 } from './cardInventoryV2';

export { canonical, inventoryHash };
export const WORKFLOW_SOURCE_V2 = 'ten-kings-card-platform-v2' as const;
export const WORKFLOW_MAX_UNITS_V2 = 2000;
export const WORKFLOW_MAX_EVENT_BYTES_V2 = 2 * 1024 * 1024;
export const WORKFLOW_MAX_PAGE_BYTES_V2 = 10 * 1024 * 1024;
const id = z.string().min(1).max(200).refine(v => v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v), 'Use an exact nonblank identity');
const evidence = z.string().min(1).max(2000).refine(v => v.trim() === v, 'Supply an exact evidence reference');
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const quantity = z.number().int().min(0).max(1_000_000);
const positive = z.number().int().min(1).max(WORKFLOW_MAX_UNITS_V2);
export const WorkflowTimeV2 = z.string().refine(v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v, 'Use an exact UTC timestamp');
const ids = z.array(id).min(1).max(WORKFLOW_MAX_UNITS_V2).refine(v => new Set(v).size === v.length, 'Duplicate unit identity');
const eventIds = z.array(id).max(10000).refine(v => new Set(v).size === v.length, 'Duplicate evidence identity');
export const WorkflowScopeInputV2 = z.object({ machine_id: id, product_id: id, door_id: id.nullable() }).strict();
export type WorkflowScopeV2 = z.infer<typeof WorkflowScopeInputV2>;
const custody = z.object({ custody_id: id, location_id: z.string().uuid().nullable() }).strict();
const costRow = z.object({ unit_id: id, cost_cents: cents }).strict();
export const WorkflowAssignmentInputV2 = z.discriminatedUnion('method', [
  z.object({ method: z.literal('unassigned'), basis: z.literal('unknown'), unknown_reason: evidence }).strict(),
  z.object({ method: z.literal('documented_unit'), basis: z.literal('documented_unit'), costs: z.array(costRow.extend({ evidence_ref: evidence }).strict()).min(1).max(WORKFLOW_MAX_UNITS_V2) }).strict(),
  z.object({ method: z.literal('equal_card'), basis: z.literal('allocated_acquisition'), evidence_ref: evidence }).strict(),
  z.object({ method: z.literal('explicit_per_card'), basis: z.literal('allocated_acquisition'), evidence_ref: evidence, costs: z.array(costRow).min(1).max(WORKFLOW_MAX_UNITS_V2) }).strict(),
]);
const allocation = z.object({
  method_version: z.enum(['unassigned_v1', 'documented_unit_v1', 'equal_card_v1', 'explicit_per_card_v1']),
  residual_rule: z.literal('ascending_unit_id_utf16_v1').nullable(), residual_cent_unit_ids: eventIds,
  units: z.array(z.object({ unit_id: id, cost_cents: cents.nullable(), basis: z.enum(['unknown', 'documented_unit', 'allocated_acquisition']), evidence_ref: evidence, unknown_reason: evidence.nullable() }).strict()).min(1).max(WORKFLOW_MAX_UNITS_V2),
}).strict();
const stockCorrection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('processing'), stage: z.enum(['unprocessed', 'processing', 'processed', 'packed']), product_id: id.nullable() }).strict(),
  z.object({ kind: z.literal('packing'), packs: z.array(z.object({ unit_id: id, pack_id: id }).strict()).max(WORKFLOW_MAX_UNITS_V2) }).strict(),
  z.object({ kind: z.literal('custody'), to: custody }).strict(),
]);
const payloads = {
  purchase_received: z.object({ lot_id: id, acquisition_cycle_id: id, quantity: positive, total_cost_cents: cents.nullable(), unknown_reason: evidence.nullable(), purchase_evidence_ref: evidence, unit_ids: ids, custody }).strict(),
  purchase_cancelled: z.object({ lot_id: id, purchase_event_id: id, reason: evidence }).strict(),
  opening_stock_recorded: z.object({ lot_id: id, acquisition_cycle_id: id, quantity: positive, total_cost_cents: cents.nullable(), unknown_reason: evidence.nullable(), purchase_evidence_ref: evidence, unit_ids: ids, custody, stage: z.enum(['unprocessed', 'processing', 'processed', 'packed']), product_id: id.nullable(), packs: z.array(z.object({ unit_id: id, pack_id: id }).strict()).max(WORKFLOW_MAX_UNITS_V2), machine_scope: WorkflowScopeInputV2.nullable(), loading_batch_id: id.nullable() }).strict(),
  purchase_cost_documented: z.object({ lot_id: id, total_cost_cents: cents.nullable(), unknown_reason: evidence.nullable(), purchase_evidence_ref: evidence, supersedes_event_id: id }).strict(),
  cost_assigned: z.object({ lot_id: id, assignment: WorkflowAssignmentInputV2, supersedes_event_id: id.nullable() }).strict(),
  stock_corrected: z.object({ unit_ids: ids, expected_states: z.array(z.object({ unit_id: id, state_event_id: id }).strict()).min(1).max(WORKFLOW_MAX_UNITS_V2), reason: evidence, correction: stockCorrection }).strict(),
  processed: z.object({ unit_ids: ids, stage: z.enum(['processing', 'processed']), product_id: id, permanent_card_links: z.array(z.object({ unit_id: id, card_id: id }).strict()).max(WORKFLOW_MAX_UNITS_V2) }).strict(),
  packed: z.object({ packs: z.array(z.object({ unit_id: id, pack_id: id }).strict()).min(1).max(WORKFLOW_MAX_UNITS_V2) }).strict(),
  custody_moved: z.object({ unit_ids: ids, from_custody_id: id, to: custody, movement: z.enum(['dispatch', 'receipt', 'transfer']) }).strict(),
  reserved: z.object({ unit_ids: ids, destination: custody.nullable() }).strict(),
  price_set: z.object({ unit_ids: ids, intended_sale_price_cents: cents.nullable() }).strict(),
  batch_loaded: z.object({ batch_id: id, scope: WorkflowScopeInputV2, unit_ids: ids, from_custody_id: id, to: custody }).strict(),
  sale_observed: z.object({ scope: WorkflowScopeInputV2, from_at: WorkflowTimeV2, until_at: WorkflowTimeV2, quantity, actual_revenue_cents: cents.nullable() }).strict(),
  stock_counted: z.object({ scope: WorkflowScopeInputV2, quantity, remaining_unit_ids: eventIds.nullable() }).strict(),
  batch_removed: z.object({ batch_id: id, scope: WorkflowScopeInputV2, quantity: positive, unit_ids: ids.nullable(), to: custody }).strict(),
  physical_return_observed: z.object({ batch_id: id, scope: WorkflowScopeInputV2, original_sales_observation_id: id, quantity: positive, unit_ids: ids.nullable(), to: custody }).strict(),
  refund_observed: z.object({ original_sales_observation_id: id, amount_cents: cents, refund_reference: id }).strict(),
  batch_reconciled: z.object({ batch_id: id, opening_count_event_id: id.nullable(), closing_count_event_id: id.nullable(), sales_event_ids: eventIds, movement_event_ids: eventIds, scope_complete: z.boolean(), sales_attributed: z.boolean(), scope_evidence_ref: evidence.nullable(), attribution_evidence_ref: evidence.nullable(), supersedes_event_id: id.nullable() }).strict(),
};
const base = { effective_at: WorkflowTimeV2, evidence_ref: evidence };
const commandMeta = { request_id: id, ...base };
const eventMeta = { schema_version: z.literal(2), source_event_id: id, source_sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), ...base, recorded_at: WorkflowTimeV2, recorded_by: id, currency: z.literal('USD') };
const variant = <K extends keyof typeof payloads>(key: K) => z.object({ ...commandMeta, event_kind: z.literal(key), data: payloads[key] }).strict();
export const WorkflowCommandInputV2 = z.discriminatedUnion('event_kind', [
  variant('purchase_received'), variant('purchase_cancelled'), variant('opening_stock_recorded'), variant('purchase_cost_documented'), variant('cost_assigned'), variant('stock_corrected'), variant('processed'), variant('packed'), variant('custody_moved'), variant('reserved'), variant('price_set'), variant('batch_loaded'), variant('sale_observed'), variant('stock_counted'), variant('batch_removed'), variant('physical_return_observed'), variant('refund_observed'), variant('batch_reconciled'),
]);
const eventVariant = <K extends keyof typeof payloads>(key: K) => z.object({ ...eventMeta, event_kind: z.literal(key), data: payloads[key] }).strict();
export const WorkflowEventInputV2 = z.discriminatedUnion('event_kind', [
  eventVariant('purchase_received'), eventVariant('purchase_cancelled'), eventVariant('opening_stock_recorded'), eventVariant('purchase_cost_documented'), z.object({ ...eventMeta, event_kind: z.literal('cost_assigned'), data: payloads.cost_assigned.extend({ allocation }).strict() }).strict(), eventVariant('stock_corrected'), eventVariant('processed'), eventVariant('packed'), eventVariant('custody_moved'), eventVariant('reserved'), eventVariant('price_set'), eventVariant('batch_loaded'), eventVariant('sale_observed'), eventVariant('stock_counted'), eventVariant('batch_removed'), eventVariant('physical_return_observed'), eventVariant('refund_observed'), eventVariant('batch_reconciled'),
]);
export type WorkflowCommandV2 = z.infer<typeof WorkflowCommandInputV2>;
export type WorkflowEventV2 = z.infer<typeof WorkflowEventInputV2>;
export type WorkflowAllocationV2 = z.infer<typeof allocation>;
export const WorkflowPageInputV2 = z.object({ schema_version: z.literal(2), source_system: z.literal(WORKFLOW_SOURCE_V2), snapshot_id: z.string().regex(/^v2-inventory-workflow:(0|[1-9][0-9]*)$/), after_sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), through_sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), events: z.array(WorkflowEventInputV2).max(1000) }).strict().superRefine((v, ctx) => {
  if (v.through_sequence !== v.after_sequence + v.events.length || v.events.some((e, i) => e.source_sequence !== v.after_sequence + i + 1) || BigInt(v.snapshot_id.slice('v2-inventory-workflow:'.length)) < BigInt(v.through_sequence)) ctx.addIssue({ code: 'custom', message: 'Workflow page must be contiguous under its snapshot' });
});
export type WorkflowPageV2 = z.infer<typeof WorkflowPageInputV2>;
export type WorkflowExportV2 = { page: WorkflowPageV2; snapshot_through_sequence: number };
export function workflowEventIdV2(requestId: string) { return 'workflow:' + inventoryHash({ request_id: requestId }); }
export function parseWorkflowCommandV2(value: unknown): WorkflowCommandV2 {
  const result = WorkflowCommandInputV2.safeParse(value);
  if (!result.success) throw new CardInventoryErrorV2('INVALID_INPUT', result.error.issues[0].message);
  if (Buffer.byteLength(canonical(result.data), 'utf8') > WORKFLOW_MAX_EVENT_BYTES_V2 / 2) throw new CardInventoryErrorV2('INVALID_INPUT', 'Workflow command exceeds the evidence limit');
  return result.data;
}
