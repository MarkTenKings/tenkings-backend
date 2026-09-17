import { Prisma } from '@prisma/client';
import { CardInventoryErrorV2 } from './cardInventoryV2';
import { canonical, inventoryHash, parseWorkflowCommandV2, WorkflowEventInputV2, WorkflowPageInputV2, workflowEventIdV2, WORKFLOW_SOURCE_V2, WORKFLOW_MAX_PAGE_BYTES_V2, WORKFLOW_MAX_EVENT_BYTES_V2, type WorkflowCommandV2, type WorkflowEventV2, type WorkflowExportV2 } from './inventoryWorkflowV2';
import { replayWorkflowEventsV2, overlapsWorkflowScopeV2, workflowPurchaseCancellationBlockV2 } from './inventoryWorkflowV2State';
export type WorkflowReadClientV2 = Pick<Prisma.TransactionClient, '$queryRaw'>;
export type WorkflowRowV2 = { sequence: bigint; id: string; recordedAt: Date; content: string; contentHash: string; requestHash: string };
export type WorkflowContentV2 = { command: WorkflowCommandV2; event: WorkflowEventV2 };
const integrity = (): never => { throw new CardInventoryErrorV2('INTEGRITY', 'Workflow evidence failed integrity verification'); };
export function verifyWorkflowRowV2(row: WorkflowRowV2): WorkflowContentV2 {
  try {
    const data = JSON.parse(row.content) as WorkflowContentV2;
    if (canonical(Object.keys(data).sort()) !== canonical(['command', 'event']) || canonical(data) !== row.content || inventoryHash(data) !== row.contentHash || Buffer.byteLength(row.content) > WORKFLOW_MAX_EVENT_BYTES_V2) return integrity();
    const command = parseWorkflowCommandV2(data.command), event = WorkflowEventInputV2.parse(data.event);
    const { schema_version: _schema, source_event_id: _id, source_sequence: _sequence, recorded_at: _recorded, recorded_by: _actor, currency: _currency, ...shape } = event;
    const expectedData = event.event_kind === 'cost_assigned' ? { lot_id: event.data.lot_id, assignment: event.data.assignment, supersedes_event_id: event.data.supersedes_event_id } : event.data;
    if (canonical(command) !== canonical({ request_id: command.request_id, ...shape, data: expectedData }) || canonical(event) !== canonical(data.event) || event.source_event_id !== row.id || row.id !== workflowEventIdV2(command.request_id) || BigInt(event.source_sequence) !== BigInt(row.sequence) || event.recorded_at !== row.recordedAt.toISOString() || event.effective_at > event.recorded_at || event.recorded_at > new Date().toISOString() || inventoryHash({ command, actor: event.recorded_by }) !== row.requestHash) return integrity();
    return { command, event };
  } catch { return integrity(); }
}
export async function readWorkflowHistoryV2(db: WorkflowReadClientV2): Promise<WorkflowEventV2[]> {
  const [size] = await db.$queryRaw<{ count: bigint; maximum: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count, COALESCE(MAX("sequence"), 0)::bigint AS maximum FROM "InventoryWorkflowEventV2"`);
  if (size.count !== size.maximum || size.maximum > BigInt(Number.MAX_SAFE_INTEGER)) return integrity();
  const events: WorkflowEventV2[] = []; let after = 0;
  while (BigInt(after) < size.maximum) {
    const page = await exportInventoryWorkflowPageV2(db, { after_sequence: after, limit: 250, snapshot_through_sequence: Number(size.maximum) });
    events.push(...page.page.events); after = page.page.through_sequence;
  }
  return events;
}
export async function readWorkflowWorkspaceV2(db: WorkflowReadClientV2, input: { lot_id?: string; batch_id?: string; lot_offset?: number; batch_offset?: number; event_offset?: number } = {}) {
  const events = await readWorkflowHistoryV2(db), state = replayWorkflowEventsV2(events);
  const allLots = [...state.lots.values()].reverse(), allBatches = [...state.batches.values()].reverse();
  const lotOffset = input.lot_id ? Math.max(0, Math.floor(allLots.findIndex(l => l.data.lot_id === input.lot_id) / 100) * 100) : input.lot_offset ?? 0, batchOffset = input.batch_id ? Math.max(0, Math.floor(allBatches.findIndex(b => b.data.batch_id === input.batch_id) / 100) * 100) : input.batch_offset ?? 0, eventOffset = input.event_offset ?? 0;
  const selectedBatch = input.batch_id ? state.batches.get(input.batch_id) : null;
  const lotId = input.lot_id ?? (selectedBatch ? null : allLots[lotOffset]?.data.lot_id ?? null);
  if (input.lot_id && !state.lots.has(input.lot_id) || input.batch_id && !selectedBatch) throw new CardInventoryErrorV2('INVALID_INPUT', 'Selected purchase or batch does not exist');
  const units = [...state.units.values()].filter(u => selectedBatch ? selectedBatch.data.unit_ids.includes(u.unit_id) : u.lot_id === lotId);
  const selectedUnits = new Set(lotId ? state.lots.get(lotId)?.data.unit_ids ?? [] : units.map(u => u.unit_id)), selectedLots = new Set(lotId ? [lotId] : units.map(u => u.lot_id));
  const relatedBatches = selectedBatch ? [selectedBatch] : allBatches.filter(b => b.data.unit_ids.some(id => selectedUnits.has(id)));
  const relatedBatchIds = new Set(relatedBatches.map(b => b.data.batch_id));
  const relatedEvents = new Set(events.filter(e =>
    'lot_id' in e.data && selectedLots.has(e.data.lot_id) ||
    'unit_ids' in e.data && e.data.unit_ids?.some(id => selectedUnits.has(id)) ||
    e.event_kind === 'packed' && e.data.packs.some(p => selectedUnits.has(p.unit_id)) ||
    'batch_id' in e.data && relatedBatchIds.has(e.data.batch_id) ||
    relatedBatches.some(b => 'scope' in e.data && overlapsWorkflowScopeV2(e.data.scope, b.data.scope))
  ).map(e => e.source_event_id));
  // Monetary refunds carry the original observation identity, without stock or unit IDs.
  const relevant = events.filter(e => relatedEvents.has(e.source_event_id) || e.event_kind === 'refund_observed' && relatedEvents.has(e.data.original_sales_observation_id));
  const lots = allLots.slice(lotOffset, lotOffset + 100).map(receipt => {
    const authority = state.costAuthorities.get(receipt.data.lot_id)!;
    const cancelled = state.cancellations.get(receipt.data.lot_id);
    return { lot_id: receipt.data.lot_id, acquisition_cycle_id: receipt.data.acquisition_cycle_id, quantity: receipt.data.quantity, total_cost_cents: authority.data.total_cost_cents, unknown_reason: authority.data.unknown_reason, purchase_evidence_ref: authority.data.purchase_evidence_ref, receipt_event_id: receipt.source_event_id, cost_authority_event_id: authority.source_event_id, assignment_event_id: state.assignments.get(receipt.data.lot_id)?.source_event_id ?? null, origin_kind: receipt.event_kind, cancelled_event_id: cancelled?.source_event_id ?? null, cancellation_reason: cancelled?.data.reason ?? null, cancellation_block_reason: workflowPurchaseCancellationBlockV2(state, receipt.data.lot_id) };
  });
  const result = { version: 2 as const, lots, lots_total: allLots.length, lot_offset: lotOffset, selected_lot_id: lotId,
    batches: allBatches.slice(batchOffset, batchOffset + 100).map(e => ({ batch_id: e.data.batch_id, scope: e.data.scope, quantity: e.data.unit_ids.length, load_event_id: e.source_event_id, at: e.effective_at })), batches_total: allBatches.length, batch_offset: batchOffset,
    selected_batch: selectedBatch ?? null, reconciliation: selectedBatch ? state.reconciliations.get(selectedBatch.data.batch_id) ?? null : null,
    units, events: [...relevant].reverse().slice(eventOffset, eventOffset + 100), events_total: relevant.length, event_offset: eventOffset,
    notice: 'Unit IDs identify the receipt roster. Loaded membership is historical; aggregate sales do not identify sold or remaining units. Missing counts and costs remain unknown.' };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > WORKFLOW_MAX_PAGE_BYTES_V2) return integrity();
  return result;
}
export type WorkflowWorkspaceV2 = Awaited<ReturnType<typeof readWorkflowWorkspaceV2>>;
export async function exportInventoryWorkflowPageV2(db: WorkflowReadClientV2, input: { after_sequence: number; limit: number; snapshot_through_sequence?: number }): Promise<WorkflowExportV2> {
  const { after_sequence: after, limit, snapshot_through_sequence: bound } = input;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || (bound !== undefined && (!Number.isSafeInteger(bound) || bound < after))) throw new CardInventoryErrorV2('INVALID_INPUT', 'Invalid workflow cursor');
  const [watermark] = await db.$queryRaw<{ maximum: bigint }[]>(Prisma.sql`SELECT COALESCE(MAX("sequence"), 0)::bigint AS maximum FROM "InventoryWorkflowEventV2"`);
  const maximum = Number(watermark.maximum), snapshot = bound ?? maximum;
  if (!Number.isSafeInteger(maximum)) return integrity();
  if (snapshot > maximum || after > snapshot) throw new CardInventoryErrorV2('INVALID_INPUT', 'Workflow cursor exceeds the committed journal');
  const [coverage] = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "InventoryWorkflowEventV2" WHERE "sequence" <= ${BigInt(snapshot)}`);
  if (coverage.count !== BigInt(snapshot)) return integrity();
  // The cumulative content budget bounds each query without a per-event round trip.
  const rows = await db.$queryRaw<WorkflowRowV2[]>(Prisma.sql`
    WITH candidates AS (
      SELECT * FROM "InventoryWorkflowEventV2" WHERE "sequence" > ${BigInt(after)} AND "sequence" <= ${BigInt(snapshot)} ORDER BY "sequence" LIMIT ${limit}
    ), bounded AS (
      SELECT *, SUM(octet_length("content") + 1) OVER (ORDER BY "sequence") AS bytes FROM candidates
    ) SELECT "sequence", "id", "recordedAt", "content", "contentHash", "requestHash" FROM bounded
      WHERE bytes <= ${WORKFLOW_MAX_PAGE_BYTES_V2 - 1024} ORDER BY "sequence"
  `);
  const selected = rows.map((row, i) => { if (BigInt(row.sequence) !== BigInt(after + i + 1)) return integrity(); return verifyWorkflowRowV2(row).event; });
  if (!selected.length && after < snapshot) return integrity();
  return { page: WorkflowPageInputV2.parse({ schema_version: 2, source_system: WORKFLOW_SOURCE_V2, snapshot_id: 'v2-inventory-workflow:' + snapshot, after_sequence: after, through_sequence: after + selected.length, events: selected }), snapshot_through_sequence: snapshot };
}
