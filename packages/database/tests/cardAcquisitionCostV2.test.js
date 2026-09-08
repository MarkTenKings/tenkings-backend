const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CardAcquisitionCostAssignmentInputV2, CardAcquisitionCostErrorV2,
  CARD_ACQUISITION_MAX_UNITS_V2, CARD_ACQUISITION_RESIDUAL_RULE_V2,
  previewCardAcquisitionCostV2,
} = require('../dist/database/src/cardAcquisitionCostV2');
const { InventoryComponentInput } = require('../dist/database/src/cardInventoryV2');

// These are in-memory test inputs only; no purchase, identity or storage is created.
const clone = value => structuredClone(value);
const input = (quantity = 3, total = 100) => ({
  schema_version: 1,
  lot: {
    lot_id: 'test-lot', acquisition_cycle_id: 'test-cycle', acquisition_event_id: 'test-purchase',
    quantity, total_cost_cents: total, currency: 'USD', evidence_ref: 'test-invoice', purchase_ledger_line_id: null,
  },
  units: Array.from({ length: quantity }, (_, i) => ({ unit_id: 'test-card-' + String(i + 1).padStart(4, '0') })).reverse(),
  assignment: { method: 'equal_card', basis: 'allocated_acquisition', evidence_ref: 'test-equal-card-selection' },
});
const costsByUnit = result => Object.fromEntries(result.units.map(unit => [unit.unit_id, unit.component.cost_cents]));
const sumCosts = result => result.units.reduce((sum, unit) => sum + BigInt(unit.component.cost_cents), 0n);
const rejected = value => {
  assert.equal(CardAcquisitionCostAssignmentInputV2.safeParse(value).success, false);
  assert.throws(() => previewCardAcquisitionCostV2(value), error => error instanceof CardAcquisitionCostErrorV2 && error.code === 'INVALID_INPUT');
};
const unassigned = value => {
  value.assignment = { method: 'unassigned', basis: 'unknown', unknown_reason: 'Bulk total documented; no per-card allocation selected' };
  return value;
};

test('an individually purchased card retains its exact documented cost and evidence', () => {
  const value = input(1, 1275);
  value.units[0].intended_sale_price_cents = 5000;
  value.lot.purchase_ledger_line_id = 'test-purchase-line';
  value.assignment = { method: 'documented_unit', basis: 'documented_unit', costs: [
    { unit_id: value.units[0].unit_id, cost_cents: 1275, evidence_ref: 'test-individual-invoice-line' },
  ] };
  const result = previewCardAcquisitionCostV2(value);
  assert.equal(result.preview_only, true);
  assert.equal(result.assignment.method_version, 'documented_unit_v1');
  assert.equal(result.assignment.residual_rule, null);
  assert.deepEqual(result.units[0].component, {
    unit_id: 'test-card-0001', lot_id: 'test-lot', acquisition_cycle_id: 'test-cycle', acquisition_event_id: 'test-purchase',
    quantity: 1, cost_cents: 1275, basis: 'documented_unit', purchase_ledger_line_id: 'test-purchase-line',
    evidence_ref: 'test-individual-invoice-line', unknown_reason: null,
  });
  assert.equal(result.units[0].intended_sale_price_cents, 5000);
  assert.equal(result.totals.unassigned_cost_cents, 0);
});

test('separately documented per-card amounts are preserved without equalizing an invoice', () => {
  const value = input(3, 400);
  value.assignment = { method: 'documented_unit', basis: 'documented_unit', costs: [
    { unit_id: 'test-card-0003', cost_cents: 0, evidence_ref: 'test-document-zero' },
    { unit_id: 'test-card-0002', cost_cents: 275, evidence_ref: 'test-document-b' },
    { unit_id: 'test-card-0001', cost_cents: 125, evidence_ref: 'test-document-a' },
  ] };
  const result = previewCardAcquisitionCostV2(value);
  assert.deepEqual(costsByUnit(result), { 'test-card-0001': 125, 'test-card-0002': 275, 'test-card-0003': 0 });
  assert.ok(result.units.every(unit => unit.component.basis === 'documented_unit'));
  assert.equal(sumCosts(result), 400n);
});

test('unassigned bulk stock keeps the total known and partial or absent unit costs unknown', () => {
  const value = unassigned(input(2000, 100003));
  value.units = [{ unit_id: 'test-known-identity', intended_sale_price_cents: 5000 }];
  const result = previewCardAcquisitionCostV2(value);
  assert.equal(result.units[0].component.cost_cents, null);
  assert.equal(result.units[0].component.basis, 'unknown');
  assert.equal(result.units[0].component.unknown_reason, value.assignment.unknown_reason);
  assert.equal(result.units[0].component.evidence_ref, 'test-invoice');
  assert.deepEqual(result.totals, {
    purchase_quantity: 2000, represented_quantity: 1, unrepresented_quantity: 1999,
    assigned_quantity: 0, unassigned_quantity: 2000, purchase_cost_cents: 100003,
    assigned_cost_cents: 0, unassigned_cost_cents: 100003,
  });
  value.units = [];
  const withoutIdentities = previewCardAcquisitionCostV2(value);
  assert.deepEqual(withoutIdentities.units, []);
  assert.equal(withoutIdentities.totals.unrepresented_quantity, 2000);
  assert.equal(withoutIdentities.totals.unassigned_cost_cents, 100003);
});

test('zero total stays unassigned until an explicit policy or documented unit amount is supplied', () => {
  const value = unassigned(input(1, 0));
  assert.equal(previewCardAcquisitionCostV2(value).units[0].component.cost_cents, null);
  value.assignment = { method: 'documented_unit', basis: 'documented_unit', costs: [
    { unit_id: value.units[0].unit_id, cost_cents: 0, evidence_ref: 'test-documented-gift' },
  ] };
  const documented = previewCardAcquisitionCostV2(value).units[0].component;
  assert.equal(documented.cost_cents, 0);
  assert.equal(documented.basis, 'documented_unit');
  assert.equal(documented.unknown_reason, null);
  const allocated = previewCardAcquisitionCostV2(input(3, 0));
  assert.ok(allocated.units.every(unit => unit.component.cost_cents === 0 && unit.component.basis === 'allocated_acquisition'));
});

test('explicit equal-card allocation preserves residual cents on stable identities', () => {
  const value = input(3, 100);
  const first = previewCardAcquisitionCostV2(value);
  value.units.reverse();
  assert.deepEqual(previewCardAcquisitionCostV2(value), first);
  assert.deepEqual(costsByUnit(first), { 'test-card-0001': 34, 'test-card-0002': 33, 'test-card-0003': 33 });
  assert.equal(first.assignment.method_version, 'equal_card_v1');
  assert.equal(first.assignment.residual_rule, CARD_ACQUISITION_RESIDUAL_RULE_V2);
  assert.deepEqual(first.assignment.residual_cent_unit_ids, ['test-card-0001']);
  assert.ok(first.units.every(unit => unit.component.basis === 'allocated_acquisition' && unit.component.evidence_ref === 'test-equal-card-selection'));
});

test('residual ordering is exact UTF-16 identity order rather than numeric or locale order', () => {
  const value = input(6, 2);
  value.units = ['a', 'Z', 'test-2', 'test-10', 'é', '𝄞'].map(unit_id => ({ unit_id }));
  const result = previewCardAcquisitionCostV2(value);
  assert.deepEqual(result.units.map(unit => unit.unit_id), ['Z', 'a', 'test-10', 'test-2', 'é', '𝄞']);
  assert.deepEqual(result.assignment.residual_cent_unit_ids, ['Z', 'a']);
  assert.equal(sumCosts(result), 2n);
});

test('500 and 2000-card bulk totals including maximum safe cents conserve exactly', () => {
  for (const [quantity, total] of [[500, 100003], [2000, Number.MAX_SAFE_INTEGER]]) {
    const result = previewCardAcquisitionCostV2(input(quantity, total));
    const amounts = result.units.map(unit => unit.component.cost_cents);
    assert.equal(sumCosts(result), BigInt(total));
    assert.equal(result.totals.assigned_cost_cents, total);
    assert.equal(result.totals.unassigned_cost_cents, 0);
    assert.equal(result.totals.assigned_quantity, quantity);
    assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1);
    assert.ok(amounts.every(Number.isSafeInteger));
    assert.equal(result.assignment.residual_cent_unit_ids.length, Number(BigInt(total) % BigInt(quantity)));
  }
});

test('integer conservation holds when the lot is worth less than its unit count', () => {
  for (let quantity = 1; quantity <= 40; quantity++) {
    for (const total of [0, 1, quantity - 1, quantity, quantity + 1, Number.MAX_SAFE_INTEGER]) {
      const result = previewCardAcquisitionCostV2(input(quantity, total));
      assert.equal(sumCosts(result), BigInt(total));
      assert.equal(result.totals.purchase_cost_cents, result.totals.assigned_cost_cents + result.totals.unassigned_cost_cents);
      assert.ok(result.units.every(unit => InventoryComponentInput.safeParse(unit.component).success));
    }
  }
});

test('explicit per-card allocation preserves chosen unequal amounts and labels them allocated', () => {
  const value = input(3, 401);
  value.assignment = { method: 'explicit_per_card', basis: 'allocated_acquisition', evidence_ref: 'test-reviewed-allocation-v3', costs: [
    { unit_id: 'test-card-0002', cost_cents: 275 },
    { unit_id: 'test-card-0003', cost_cents: 1 },
    { unit_id: 'test-card-0001', cost_cents: 125 },
  ] };
  const result = previewCardAcquisitionCostV2(value);
  assert.deepEqual(costsByUnit(result), { 'test-card-0001': 125, 'test-card-0002': 275, 'test-card-0003': 1 });
  assert.equal(result.assignment.method_version, 'explicit_per_card_v1');
  assert.deepEqual(result.assignment.residual_cent_unit_ids, []);
  assert.equal(result.assignment.residual_rule, null);
  for (const unit of result.units) {
    assert.equal(unit.component.basis, 'allocated_acquisition');
    assert.equal(unit.component.evidence_ref, 'test-reviewed-allocation-v3');
    assert.deepEqual(InventoryComponentInput.parse(unit.component), unit.component);
  }
});

test('the method and its correct basis must both be explicitly supplied', () => {
  for (const mutate of [
    value => { delete value.assignment; },
    value => { delete value.assignment.method; },
    value => { delete value.assignment.basis; },
    value => { value.assignment.basis = 'documented_unit'; },
    value => { value.assignment.method = 'fifo'; },
    value => { value.assignment = { method: 'unassigned', basis: 'unknown' }; },
    value => { value.assignment.unknown_reason = 'unexpected'; },
  ]) {
    const value = input(); mutate(value); rejected(value);
  }
});

test('known costs require the entire roster and never silently allocate only processed cards', () => {
  for (const method of ['equal_card', 'documented_unit', 'explicit_per_card']) {
    const value = input(3, 100);
    value.units = [{ unit_id: 'test-card-0001' }];
    if (method !== 'equal_card') value.assignment = {
      method, basis: method === 'documented_unit' ? 'documented_unit' : 'allocated_acquisition',
      ...(method === 'explicit_per_card' ? { evidence_ref: 'test-allocation' } : {}),
      costs: [{ unit_id: 'test-card-0001', cost_cents: 100, ...(method === 'documented_unit' ? { evidence_ref: 'test-unit-invoice' } : {}) }],
    };
    rejected(value);
  }
  const empty = input(); empty.units = []; rejected(empty);
});

test('duplicate and excess unit identities fail for unknown and allocated purchases', () => {
  for (const convert of [value => value, unassigned]) {
    const duplicate = convert(input()); duplicate.units[1].unit_id = duplicate.units[0].unit_id; rejected(duplicate);
    const excess = convert(input()); excess.units.push({ unit_id: 'test-extra-unit' }); rejected(excess);
  }
});

test('explicit cost lists reject duplicate, unrelated, missing and excess assignments', () => {
  const base = input(2, 100);
  base.assignment = { method: 'explicit_per_card', basis: 'allocated_acquisition', evidence_ref: 'test-allocation', costs: [
    { unit_id: 'test-card-0001', cost_cents: 50 }, { unit_id: 'test-card-0002', cost_cents: 50 },
  ] };
  for (const mutate of [
    value => { value.assignment.costs[1].unit_id = 'test-card-0001'; },
    value => { value.assignment.costs[1].unit_id = 'test-other-card'; },
    value => { value.assignment.costs.pop(); },
    value => { value.assignment.costs.push({ unit_id: 'test-other-card', cost_cents: 0 }); },
  ]) {
    const value = clone(base); mutate(value); rejected(value);
  }
});

test('overassignment, leftover cents and summed overflow cannot become a known allocation', () => {
  for (const [total, amounts] of [[100, [51, 50]], [100, [49, 50]], [Number.MAX_SAFE_INTEGER, [Number.MAX_SAFE_INTEGER, 1]]]) {
    for (const method of ['explicit_per_card', 'documented_unit']) {
      const value = input(2, total);
      value.assignment = {
        method, basis: method === 'documented_unit' ? 'documented_unit' : 'allocated_acquisition',
        ...(method === 'explicit_per_card' ? { evidence_ref: 'test-allocation' } : {}),
        costs: amounts.map((cost_cents, i) => ({ unit_id: value.units[i].unit_id, cost_cents,
          ...(method === 'documented_unit' ? { evidence_ref: 'test-individual-line' } : {}) })),
      };
      rejected(value);
    }
  }
});

test('unsafe, fractional, negative and coerced money is rejected in every monetary field', () => {
  for (const amount of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '100', null]) {
    const lot = input(); lot.lot.total_cost_cents = amount; rejected(lot);
    const price = input(); price.units[0].intended_sale_price_cents = amount;
    if (amount !== null) rejected(price);
    const card = input(1, 100);
    card.assignment = { method: 'documented_unit', basis: 'documented_unit', costs: [
      { unit_id: card.units[0].unit_id, cost_cents: amount, evidence_ref: 'test-document' },
    ] };
    rejected(card);
  }
});

test('quantity, exact identity, evidence and supported currency are required and bounded', () => {
  for (const quantity of [0, -1, 0.5, '3', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, CARD_ACQUISITION_MAX_UNITS_V2 + 1]) {
    const value = input(); value.lot.quantity = quantity; rejected(value);
  }
  for (const badId of ['', ' ', ' unit', 'unit ', 'unit\nname', 'x'.repeat(201)]) {
    const value = input(); value.units[0].unit_id = badId; rejected(value);
  }
  for (const mutate of [
    value => { delete value.schema_version; },
    value => { delete value.lot.evidence_ref; },
    value => { value.lot.evidence_ref = ' '; },
    value => { value.lot.evidence_ref = 'x'.repeat(2001); },
    value => { delete value.assignment.evidence_ref; },
    value => { value.assignment.evidence_ref = ''; },
    value => { delete value.lot.acquisition_cycle_id; },
    value => { delete value.lot.acquisition_event_id; },
    value => { delete value.lot.purchase_ledger_line_id; },
    value => { value.lot.currency = 'TKD'; },
  ]) {
    const value = input(); mutate(value); rejected(value);
  }
  const documented = input(1, 100);
  documented.assignment = { method: 'documented_unit', basis: 'documented_unit', costs: [
    { unit_id: documented.units[0].unit_id, cost_cents: 100 },
  ] };
  rejected(documented);
});

test('intended selling price is separate and cannot supply cost or introduce valuation inputs', () => {
  const value = input();
  const original = previewCardAcquisitionCostV2(value);
  value.units[0].intended_sale_price_cents = Number.MAX_SAFE_INTEGER;
  value.units[1].intended_sale_price_cents = 0;
  value.units[2].intended_sale_price_cents = null;
  const withPrices = previewCardAcquisitionCostV2(value);
  assert.deepEqual(costsByUnit(withPrices), costsByUnit(original));
  assert.deepEqual(withPrices.totals, original.totals);
  assert.equal(withPrices.units.find(unit => unit.unit_id === value.units[0].unit_id).intended_sale_price_cents, Number.MAX_SAFE_INTEGER);
  assert.equal(withPrices.units.find(unit => unit.unit_id === value.units[1].unit_id).intended_sale_price_cents, 0);
  assert.ok(previewCardAcquisitionCostV2(unassigned(value)).units.every(unit => unit.component.cost_cents === null));
  for (const mutate of [
    candidate => { candidate.lot.market_value_cents = 100; },
    candidate => { candidate.units[0].cost_cents = 33; },
    candidate => { candidate.expected_margin = 0.4; },
    candidate => { candidate.assignment.recipe_cost = 99; },
  ]) {
    const candidate = input(); mutate(candidate); rejected(candidate);
  }
});

test('preview is deterministic, does not mutate supplied evidence and returns detached values', () => {
  const value = input();
  const expectedInput = clone(value);
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(value);
  const first = previewCardAcquisitionCostV2(value);
  assert.deepEqual(previewCardAcquisitionCostV2(value), first);
  assert.deepEqual(value, expectedInput);
  first.lot.evidence_ref = 'different-result-reference';
  first.units[0].unit_id = 'different-result-unit';
  assert.deepEqual(value, expectedInput);
  assert.deepEqual(previewCardAcquisitionCostV2(value).lot, expectedInput.lot);
});
