import type { WorkflowCommandV2, WorkflowEventV2, WorkflowWorkspaceV2 } from '@tenkings/database';
export type WorkflowView = WorkflowWorkspaceV2 & { locations: Array<{ id: string; name: string; slug: string }> };
export type WorkflowAction = WorkflowCommandV2['event_kind'];
export type WorkflowDraft = { action: WorkflowAction | ''; at: string; evidence: string; lot: string; cycle: string; quantity: string; total: string; unknown: string; purchaseEvidence: string; custody: string; location: string; fromCustody: string; machine: string; product: string; door: string; batch: string; method: string; costs: string; assignmentEvidence: string; stage: string; packPrefix: string; links: string; movement: string; price: string; salesFrom: string; salesUntil: string; revenue: string; originalSale: string; refundRef: string; opening: string; closing: string; salesIds: string; movementIds: string; scopeComplete: boolean; salesAttributed: boolean; scopeEvidence: string; attributionEvidence: string; identified: boolean; generateRoster: boolean; cancelReservation: boolean; cancellationReason: string; confirmCancellation: boolean; correctionKind: string; correctionReason: string; unpack: boolean };
export const emptyWorkflowDraft = (): WorkflowDraft => ({ action: '', at: '', evidence: '', lot: '', cycle: '', quantity: '', total: '', unknown: '', purchaseEvidence: '', custody: '', location: '', fromCustody: '', machine: '', product: '', door: '', batch: '', method: '', costs: '', assignmentEvidence: '', stage: '', packPrefix: '', links: '', movement: '', price: '', salesFrom: '', salesUntil: '', revenue: '', originalSale: '', refundRef: '', opening: '', closing: '', salesIds: '', movementIds: '', scopeComplete: false, salesAttributed: false, scopeEvidence: '', attributionEvidence: '', identified: false, generateRoster: false, cancelReservation: false, cancellationReason: '', confirmCancellation: false, correctionKind: '', correctionReason: '', unpack: false });
export const workflowActionLabels: Record<WorkflowAction, string> = { purchase_received: 'Receive purchased lot', purchase_cancelled: 'Cancel unused receipt entry', opening_stock_recorded: 'Record historical opening stock', purchase_cost_documented: 'Document / correct purchase cost', cost_assigned: 'Assign acquisition cost', processed: 'Process cards', stock_corrected: 'Correct held stock', packed: 'Pack one card per pack', reserved: 'Reserve destination', price_set: 'Set asking price', custody_moved: 'Dispatch / receive custody', batch_loaded: 'Load machine batch', sale_observed: 'Record sales observation', stock_counted: 'Record physical count', batch_removed: 'Remove batch stock', physical_return_observed: 'Record physical return', refund_observed: 'Record money refund', batch_reconciled: 'Reconcile batch evidence' };
const required = (v: string, label: string) => { if (!v || v.trim() !== v) throw new Error(`${label} is required without surrounding whitespace.`); return v; };
export function workflowCents(v: string, label: string): number | null {
  if (!v) return null;
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(v)) throw new Error(`${label} must be a nonnegative USD amount with no more than two decimal places.`);
  const [whole, fraction = ''] = v.split('.'), n = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(n)) throw new Error(`${label} exceeds supported cents.`); return n;
}
export function workflowMoney(cents: number | null | undefined): string { if (cents === null || cents === undefined) return 'Unset'; const value = BigInt(cents); return '$' + (value / 100n).toString() + '.' + (value % 100n).toString().padStart(2, '0'); }
const count = (v: string) => { if (!/^(0|[1-9][0-9]*)$/.test(v) || !Number.isSafeInteger(Number(v))) throw new Error('Enter the actual whole-number quantity.'); return Number(v); };
const time = (v: string) => { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString() !== v) throw new Error('Enter a valid event time in UTC, including milliseconds and Z.'); return v; };
const lines = (v: string) => v.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export function buildWorkflowCommand(d: WorkflowDraft, requestId: string, selectedIds: string[], view: WorkflowView): WorkflowCommandV2 {
  if (!d.action) throw new Error('Choose the action you actually performed.');
  const common = { request_id: requestId, event_kind: d.action, effective_at: time(d.at), evidence_ref: required(d.evidence, 'Event evidence') };
  const lot = view.lots.find(l => l.lot_id === d.lot);
  if (lot?.cancelled_event_id && ['purchase_cancelled', 'purchase_cost_documented', 'cost_assigned'].includes(d.action)) throw new Error('This receipt is cancelled. Its evidence and identities remain permanent.');
  const ids = () => { if (!selectedIds.length) throw new Error('Select the recorded units involved.'); return selectedIds; };
  const scope = () => ({ machine_id: required(d.machine, 'Exact machine ID'), product_id: required(d.product, 'Exact product ID'), door_id: d.door || null });
  const custody = () => ({ custody_id: required(d.custody, 'Custody identity'), location_id: d.location || null });
  let data: unknown;
  switch (d.action) {
    case 'purchase_received':
    case 'opening_stock_recorded': {
      const quantity = count(d.quantity); if (quantity < 1 || quantity > 2000) throw new Error('Receive between 1 and 2,000 actual cards in one lot.');
      if (!d.generateRoster) throw new Error('Confirm creation of one bookkeeping roster identity per received card.');
      const total = workflowCents(d.total, 'Purchase total');
      data = { lot_id: required(d.lot, 'Lot ID'), acquisition_cycle_id: required(d.cycle, 'Acquisition cycle ID'), quantity, total_cost_cents: total, unknown_reason: total === null ? required(d.unknown, 'Missing-cost reason') : null, purchase_evidence_ref: required(d.purchaseEvidence, 'Purchase evidence'), unit_ids: Array.from({ length: quantity }, (_, i) => `intake:${requestId}:${String(i + 1).padStart(4, '0')}`), custody: custody() };
      if (d.action === 'opening_stock_recorded') {
        const unit_ids = (data as { unit_ids: string[] }).unit_ids;
        data = { ...(data as object), stage: required(d.stage, 'Observed opening processing state'), product_id: d.stage === 'unprocessed' ? null : required(d.product, 'Opening product identity'), packs: d.stage === 'packed' ? unit_ids.map((unit_id, i) => ({ unit_id, pack_id: `${required(d.packPrefix, 'Opening pack roster identity')}:${String(i + 1).padStart(4, '0')}` })) : [], machine_scope: d.custody.startsWith('machine:') ? scope() : null, loading_batch_id: d.custody.startsWith('machine:') ? required(d.batch, 'Opening stock batch identity') : null };
      }
      break;
    }
    case 'purchase_cancelled': {
      if (!lot) throw new Error('Choose the original unused purchase receipt.');
      if (lot.origin_kind !== 'purchase_received') throw new Error('Only an unused purchase receipt can be cancelled; historical opening stock cannot.');
      if (lot.cancellation_block_reason) throw new Error(lot.cancellation_block_reason);
      if (!d.confirmCancellation) throw new Error('Confirm that this is an erroneous unused receipt entry.');
      data = { lot_id: lot.lot_id, purchase_event_id: lot.receipt_event_id, reason: required(d.cancellationReason, 'Cancellation reason') }; break;
    }
    case 'purchase_cost_documented': {
      if (!lot) throw new Error('Choose the recorded purchase to supplement or correct.'); const total = workflowCents(d.total, 'Purchase total');
      data = { lot_id: lot.lot_id, total_cost_cents: total, unknown_reason: total === null ? required(d.unknown, 'Missing-cost reason') : null, purchase_evidence_ref: required(d.purchaseEvidence, 'New purchase evidence'), supersedes_event_id: lot.cost_authority_event_id }; break;
    }
    case 'cost_assigned': {
      if (!lot) throw new Error('Choose the received lot.');
      let assignment: unknown;
      if (d.method === 'unassigned') assignment = { method: d.method, basis: 'unknown', unknown_reason: required(d.unknown, 'Unassigned-cost reason') };
      else if (d.method === 'equal_card') assignment = { method: d.method, basis: 'allocated_acquisition', evidence_ref: required(d.assignmentEvidence, 'Allocation choice evidence') };
      else if (d.method === 'documented_unit' || d.method === 'explicit_per_card') {
        const costs = lines(d.costs).map(line => { const parts = line.split('\t'); if (parts.length !== (d.method === 'documented_unit' ? 3 : 2)) throw new Error('Use one tab-separated unit ID, USD amount and (for documented unit cost) evidence reference per line.'); const cost = workflowCents(parts[1], 'Unit cost'); if (cost === null) throw new Error('Each unit amount is required.'); return { unit_id: required(parts[0], 'Unit ID'), cost_cents: cost, ...(d.method === 'documented_unit' ? { evidence_ref: required(parts[2], 'Unit cost evidence') } : {}) }; });
        assignment = { method: d.method, basis: d.method === 'documented_unit' ? 'documented_unit' : 'allocated_acquisition', costs, ...(d.method === 'explicit_per_card' ? { evidence_ref: required(d.assignmentEvidence, 'Allocation evidence') } : {}) };
      } else throw new Error('Explicitly choose the cost method; none is selected automatically.');
      data = { lot_id: lot.lot_id, assignment, supersedes_event_id: lot.assignment_event_id }; break;
    }
    case 'stock_corrected': {
      const unit_ids = ids(), units = unit_ids.map(id => view.units.find(u => u.unit_id === id));
      if (units.some(u => !u || !u.state_event_id)) throw new Error('Reload the recorded stock before correcting its current state.');
      if (units.some(u => u!.batch_id !== null || u!.possession !== 'recorded' || u!.custody.custody_id.startsWith('machine:'))) throw new Error('Loaded membership does not identify remaining units. Record an actual identified removal or return first; never invent one for a correction.');
      const expected_states = units.map(u => ({ unit_id: u!.unit_id, state_event_id: u!.state_event_id }));
      let correction: unknown;
      if (d.correctionKind === 'processing') correction = { kind: 'processing', stage: required(d.stage, 'Correct processing stage'), product_id: d.stage === 'unprocessed' ? null : required(d.product, 'Correct product ID') };
      else if (d.correctionKind === 'packing') correction = { kind: 'packing', packs: d.unpack ? [] : unit_ids.map((unit_id, i) => ({ unit_id, pack_id: `${required(d.packPrefix, 'Correct pack roster identity')}:${String(i + 1).padStart(4, '0')}` })) };
      else if (d.correctionKind === 'custody') correction = { kind: 'custody', to: custody() };
      else throw new Error('Choose the physical fact being corrected.');
      data = { unit_ids, expected_states, reason: required(d.correctionReason, 'Correction reason'), correction }; break;
    }
    case 'processed': data = { unit_ids: ids(), stage: required(d.stage, 'Processing stage'), product_id: required(d.product, 'Product ID'), permanent_card_links: lines(d.links).map(line => { const parts = line.split('\t'); if (parts.length !== 2) throw new Error('Use tab-separated receipt unit ID and real permanent card ID for each optional link.'); return { unit_id: parts[0], card_id: parts[1] }; }) }; break;
    case 'packed': data = { packs: ids().map((unit_id, i) => ({ unit_id, pack_id: `${required(d.packPrefix, 'Pack batch identity')}:${String(i + 1).padStart(4, '0')}` })) }; break;
    case 'reserved': data = { unit_ids: ids(), destination: d.cancelReservation ? null : custody() }; break;
    case 'price_set': data = { unit_ids: ids(), intended_sale_price_cents: workflowCents(d.price, 'Asking price') }; break;
    case 'custody_moved': data = { unit_ids: ids(), from_custody_id: required(d.fromCustody, 'Recorded origin custody'), to: custody(), movement: required(d.movement, 'Movement type') }; break;
    case 'batch_loaded': data = { batch_id: required(d.batch, 'New loading-batch ID'), scope: scope(), unit_ids: ids(), from_custody_id: required(d.fromCustody, 'Origin custody'), to: { custody_id: 'machine:' + d.machine, location_id: required(d.location, 'Existing machine Location') } }; break;
    case 'sale_observed': data = { scope: scope(), from_at: time(d.salesFrom), until_at: time(d.salesUntil), quantity: count(d.quantity), actual_revenue_cents: workflowCents(d.revenue, 'Actual sales revenue') }; break;
    case 'stock_counted': data = { scope: scope(), quantity: count(d.quantity), remaining_unit_ids: d.identified ? selectedIds : null }; break;
    case 'batch_removed': data = { batch_id: required(d.batch, 'Loading-batch ID'), scope: scope(), quantity: count(d.quantity), unit_ids: d.identified ? ids() : null, to: custody() }; break;
    case 'physical_return_observed': data = { batch_id: required(d.batch, 'Original loading batch'), scope: scope(), original_sales_observation_id: required(d.originalSale, 'Original sales observation'), quantity: count(d.quantity), unit_ids: d.identified ? ids() : null, to: custody() }; break;
    case 'refund_observed': { const amount = workflowCents(d.revenue, 'Completed refund'); if (amount === null) throw new Error('Enter the completed refund amount.'); data = { original_sales_observation_id: required(d.originalSale, 'Original sales observation'), amount_cents: amount, refund_reference: required(d.refundRef, 'Refund reference') }; break; }
    case 'batch_reconciled': data = { batch_id: required(d.batch, 'Loading batch'), opening_count_event_id: d.opening || null, closing_count_event_id: d.closing || null, sales_event_ids: lines(d.salesIds), movement_event_ids: lines(d.movementIds), scope_complete: d.scopeComplete, sales_attributed: d.salesAttributed, scope_evidence_ref: d.scopeComplete ? required(d.scopeEvidence, 'Completeness evidence') : null, attribution_evidence_ref: d.salesAttributed ? required(d.attributionEvidence, 'Attribution evidence') : null, supersedes_event_id: view.reconciliation?.source_event_id ?? null }; break;
  }
  return { ...common, data } as WorkflowCommandV2;
}
function canonical(v: unknown): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}'; }
export async function workflowReceiptMatches(command: WorkflowCommandV2, event: WorkflowEventV2, actor: string): Promise<boolean> {
  if (!event || event.schema_version !== 2 || event.event_kind !== command.event_kind || event.recorded_by !== actor || event.effective_at !== command.effective_at || event.evidence_ref !== command.evidence_ref || event.currency !== 'USD' || !Number.isSafeInteger(event.source_sequence) || event.source_sequence < 1) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ request_id: command.request_id })));
  const id = 'workflow:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const data = event.event_kind === 'cost_assigned' ? { lot_id: event.data.lot_id, assignment: event.data.assignment, supersedes_event_id: event.data.supersedes_event_id } : event.data;
  return id === event.source_event_id && canonical(command.data) === canonical(data);
}
