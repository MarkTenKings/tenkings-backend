import { z } from 'zod';
import type { InventoryComponent } from './cardInventoryV2';

export const CARD_ACQUISITION_MAX_UNITS_V2 = 10_000;
export const CARD_ACQUISITION_RESIDUAL_RULE_V2 = 'ascending_unit_id_utf16_v1' as const;

// Identity is supplied by the caller and is never trimmed, normalized or minted.
const id = z.string().min(1).max(200).refine(
  value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
  'Use an exact nonblank identity without surrounding whitespace or control characters',
);
const evidence = z.string().min(1).max(2000).refine(
  value => value.trim() === value && value.length > 0,
  'An explicit evidence reference or unknown reason is required',
);
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const unitCost = z.object({ unit_id: id, cost_cents: cents }).strict();
const documentedUnitCost = unitCost.extend({ evidence_ref: evidence }).strict();

export const CardAcquisitionCostAssignmentInputV2 = z.object({
  schema_version: z.literal(1),
  lot: z.object({
    lot_id: id,
    acquisition_cycle_id: id,
    acquisition_event_id: id,
    quantity: z.number().int().min(1).max(CARD_ACQUISITION_MAX_UNITS_V2),
    total_cost_cents: cents,
    currency: z.literal('USD'),
    evidence_ref: evidence,
    purchase_ledger_line_id: id.nullable(),
  }).strict(),
  units: z.array(z.object({
    unit_id: id,
    intended_sale_price_cents: cents.nullable().optional(),
  }).strict()).max(CARD_ACQUISITION_MAX_UNITS_V2),
  assignment: z.discriminatedUnion('method', [
    z.object({ method: z.literal('unassigned'), basis: z.literal('unknown'), unknown_reason: evidence }).strict(),
    z.object({
      method: z.literal('documented_unit'), basis: z.literal('documented_unit'),
      costs: z.array(documentedUnitCost).min(1).max(CARD_ACQUISITION_MAX_UNITS_V2),
    }).strict(),
    z.object({
      method: z.literal('equal_card'), basis: z.literal('allocated_acquisition'), evidence_ref: evidence,
    }).strict(),
    z.object({
      method: z.literal('explicit_per_card'), basis: z.literal('allocated_acquisition'), evidence_ref: evidence,
      costs: z.array(unitCost).min(1).max(CARD_ACQUISITION_MAX_UNITS_V2),
    }).strict(),
  ]),
}).strict().superRefine((input, ctx) => {
  const fail = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  const unitIds = new Set(input.units.map(unit => unit.unit_id));
  if (unitIds.size !== input.units.length) fail('Unit identities must be unique', ['units']);
  if (input.units.length > input.lot.quantity) fail('Unit roster exceeds the documented purchase quantity', ['units']);
  if (input.assignment.method === 'unassigned') return;

  if (input.units.length !== input.lot.quantity) {
    fail('Known-cost assignment requires the complete purchase unit roster', ['units']);
  }
  if (input.assignment.method === 'equal_card') return;

  const costs = input.assignment.costs;
  const costIds = new Set(costs.map(cost => cost.unit_id));
  if (costIds.size !== costs.length || costs.length !== unitIds.size || costs.some(cost => !unitIds.has(cost.unit_id))) {
    fail('Supply exactly one cost for each roster unit, without duplicate or unrelated identities', ['assignment', 'costs']);
  }
  const assigned = costs.reduce((sum, cost) => sum + BigInt(cost.cost_cents), 0n);
  if (assigned !== BigInt(input.lot.total_cost_cents)) {
    fail('Assigned acquisition cents must equal the documented purchase total', ['assignment', 'costs']);
  }
});

export type CardAcquisitionCostAssignmentV2 = z.infer<typeof CardAcquisitionCostAssignmentInputV2>;
export type CardAcquisitionCostMethodV2 = CardAcquisitionCostAssignmentV2['assignment']['method'];

export interface CardAcquisitionCostPreviewV2 {
  schema_version: 1;
  preview_only: true;
  lot: CardAcquisitionCostAssignmentV2['lot'];
  assignment: {
    method: CardAcquisitionCostMethodV2;
    basis: 'unknown' | 'documented_unit' | 'allocated_acquisition';
    method_version: 'unassigned_v1' | 'documented_unit_v1' | 'equal_card_v1' | 'explicit_per_card_v1';
    evidence_ref: string | null;
    unknown_reason: string | null;
    residual_rule: typeof CARD_ACQUISITION_RESIDUAL_RULE_V2 | null;
    residual_cent_unit_ids: string[];
  };
  units: Array<{
    unit_id: string;
    intended_sale_price_cents: number | null;
    component: InventoryComponent;
  }>;
  totals: {
    purchase_quantity: number;
    represented_quantity: number;
    unrepresented_quantity: number;
    assigned_quantity: number;
    unassigned_quantity: number;
    purchase_cost_cents: number;
    assigned_cost_cents: number;
    unassigned_cost_cents: number;
  };
}

export class CardAcquisitionCostErrorV2 extends Error {
  readonly code = 'INVALID_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'CardAcquisitionCostErrorV2';
  }
}

/** Pure preview: this neither verifies a paid purchase nor reserves an allocation. */
export function previewCardAcquisitionCostV2(value: unknown): CardAcquisitionCostPreviewV2 {
  const parsed = CardAcquisitionCostAssignmentInputV2.safeParse(value);
  if (!parsed.success) {
    throw new CardAcquisitionCostErrorV2('Invalid acquisition-cost preview: ' + parsed.error.issues[0].message);
  }
  const { lot, assignment } = parsed.data;
  // Relational comparison is deterministic UTF-16 code-unit order, not localeCompare.
  const units = [...parsed.data.units].sort((a, b) => a.unit_id < b.unit_id ? -1 : a.unit_id > b.unit_id ? 1 : 0);
  const assigned = new Map<string, { cost_cents: number; evidence_ref: string }>();
  const residualUnitIds: string[] = [];
  if (assignment.method === 'equal_card') {
    const quantity = BigInt(lot.quantity);
    const base = BigInt(lot.total_cost_cents) / quantity;
    const residual = Number(BigInt(lot.total_cost_cents) % quantity);
    units.forEach((unit, index) => {
      if (index < residual) residualUnitIds.push(unit.unit_id);
      assigned.set(unit.unit_id, {
        cost_cents: Number(base + (index < residual ? 1n : 0n)),
        evidence_ref: assignment.evidence_ref,
      });
    });
  } else if (assignment.method === 'documented_unit') {
    for (const cost of assignment.costs) assigned.set(cost.unit_id, { cost_cents: cost.cost_cents, evidence_ref: cost.evidence_ref });
  } else if (assignment.method === 'explicit_per_card') {
    for (const cost of assignment.costs) {
      assigned.set(cost.unit_id, { cost_cents: cost.cost_cents, evidence_ref: assignment.evidence_ref });
    }
  }
  const unknownReason = assignment.method === 'unassigned' ? assignment.unknown_reason : null;
  const assignedCents = Number([...assigned.values()].reduce((sum, cost) => sum + BigInt(cost.cost_cents), 0n));
  return {
    schema_version: 1,
    preview_only: true,
    lot,
    assignment: {
      method: assignment.method,
      basis: assignment.basis,
      method_version: `${assignment.method}_v1`,
      evidence_ref: 'evidence_ref' in assignment ? assignment.evidence_ref : assignment.method === 'unassigned' ? lot.evidence_ref : null,
      unknown_reason: unknownReason,
      residual_rule: assignment.method === 'equal_card' ? CARD_ACQUISITION_RESIDUAL_RULE_V2 : null,
      residual_cent_unit_ids: residualUnitIds,
    },
    units: units.map(unit => {
      const cost = assigned.get(unit.unit_id);
      if (assignment.method !== 'unassigned' && !cost) {
        throw new CardAcquisitionCostErrorV2('The complete unit allocation was not produced');
      }
      return {
        unit_id: unit.unit_id,
        intended_sale_price_cents: unit.intended_sale_price_cents ?? null,
        component: {
          unit_id: unit.unit_id,
          lot_id: lot.lot_id,
          acquisition_cycle_id: lot.acquisition_cycle_id,
          acquisition_event_id: lot.acquisition_event_id,
          quantity: 1,
          cost_cents: cost?.cost_cents ?? null,
          basis: assignment.basis,
          purchase_ledger_line_id: lot.purchase_ledger_line_id,
          evidence_ref: cost?.evidence_ref ?? lot.evidence_ref,
          unknown_reason: unknownReason,
        },
      };
    }),
    totals: {
      purchase_quantity: lot.quantity,
      represented_quantity: units.length,
      unrepresented_quantity: lot.quantity - units.length,
      assigned_quantity: assigned.size,
      unassigned_quantity: lot.quantity - assigned.size,
      purchase_cost_cents: lot.total_cost_cents,
      assigned_cost_cents: assignedCents,
      unassigned_cost_cents: lot.total_cost_cents - assignedCents,
    },
  };
}
