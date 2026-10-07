import assert from "node:assert/strict";
import test from "node:test";
import { InventoryState, type CardInventoryCommandV2, type CardInventoryRowV2 } from "@tenkings/database";
import { buildPhysicalInventoryCommand, emptyPhysicalInventoryDraft, type PhysicalInventoryCard } from "../lib/physicalInventory";
import { readPhysicalInventoryCard } from "../lib/server/physicalInventoryRead";
import {
  fixtureEmptyCard, fixtureHeldCard, fixtureMachine, fixtureWarehouse, fixtureReceiptCommand, fixtureReceiptDraft,
  fixtureSaleCommand, fixtureReturnDraft, fixtureRefundDraft, fixtureRow, fixtureEvent,
} from "./physicalInventoryFixtures";

// A disposable journal of canonical, hashed rows. Reads use the real source verifier
// and InventoryState; every expected projection is explicitly supplied by each test.
async function scenario(options: { gross?: number | null; packed?: boolean; unknownCost?: boolean } = {}) {
  let current = fixtureEmptyCard();
  const rows: CardInventoryRowV2[] = [];
  const append = async (command: CardInventoryCommandV2, after: PhysicalInventoryCard["card"]) => {
    rows.push(fixtureRow(command, rows.length + 1, current.card, after));
    const db = {
      collectibleCardV2: { async findUnique() { return after; } },
      location: { async findMany() { return fixtureEmptyCard().locations; } },
      async $queryRaw(sql: { sql: string }) { return sql.sql.includes("COUNT(*)")
        ? [{ count: BigInt(rows.length), bytes: BigInt(rows.reduce((sum, row) => sum + Buffer.byteLength(row.content), 0)) }] : rows; },
    } as unknown as Parameters<typeof readPhysicalInventoryCard>[0];
    current = (await readPhysicalInventoryCard(db, after.id))!;
    return current;
  };
  const receipt = fixtureReceiptCommand();
  receipt.event.to_custody_id = fixtureMachine.custody_id; receipt.custody_bindings = [fixtureMachine];
  if (options.unknownCost) Object.assign(receipt.event.components[0], { cost_cents: null, basis: "unknown", unknown_reason: "Fixture invoice amount unavailable" });
  await append(receipt, fixtureHeldCard(true).card);
  if (options.packed) await append(buildPhysicalInventoryCommand({ requestId: "isolated-pack", action: "pack", card: current, draft: {
    ...emptyPhysicalInventoryDraft(), effectiveAt: "2026-01-01T00:30:00.000Z", evidenceRef: "fixture:packing", packId: "isolated-pack",
    productId: "isolated-pack-product", productEvidenceRef: "fixture:pack-definition",
  } }), { ...current.card, saleMode: "PACK" });
  const sale = fixtureSaleCommand(current);
  if ("gross" in options) sale.event.sale_gross_cents = options.gross!;
  await append(sale, { ...current.card, currentOwnerType: "EXTERNAL", lifecycleState: "EXTERNAL", locationId: null, saleMode: options.packed ? "PACK" : "DIRECT" });
  return { get current() { return current; }, append, rows, sale };
}

function reversal(command: CardInventoryCommandV2, sequence: number, requestId: string): CardInventoryCommandV2 {
  const original = fixtureEvent(command, sequence);
  return { ...command, request_id: requestId, fulfilment: null, ownership_evidence_ref: "fixture:correction-title",
    event: { ...command.event, event_kind: "reversal", stock_id: original.stock_id,
      effective_at: "2026-01-01T03:00:00.000Z", evidence_ref: "fixture:correction", correction_reason: "Fixture evidenced correction",
      from_custody_id: original.to_custody_id, to_custody_id: original.from_custody_id, reverses_source_event_id: original.source_event_id } };
}

test("verified return replay restores unknown-cost packed stock, exhausts one unit and preserves refund capacity", async () => {
  const s = await scenario({ packed: true, unknownCost: true });
  const original = s.current.history.at(-1)!.event;
  assert.equal(s.current.sales[0].remaining_return_quantity, 1);
  const command = buildPhysicalInventoryCommand({ requestId: "isolated-return", action: "return", card: s.current,
    draft: { ...fixtureReturnDraft(), originalSaleId: original.source_event_id } });
  assert.deepEqual(command.event.components, original.components);
  const returned = await s.append(command, { ...s.current.card, currentOwnerType: "HOUSE", lifecycleState: "ASSIGNED_TO_PACK", locationId: fixtureWarehouse.location_id });
  assert.equal(returned.position!.origin.event_kind, "pack");
  assert.equal(returned.position!.origin.stock_id, original.stock_id);
  assert.equal(returned.position!.origin.unit_or_pack_id, "isolated-pack");
  assert.equal(returned.position!.origin.components[0].cost_cents, null);
  assert.equal(returned.position!.origin.components[0].unknown_reason, "Fixture invoice amount unavailable");
  assert.deepEqual([returned.sales[0].returned_quantity, returned.sales[0].remaining_return_quantity], [1, 0]);
  assert.equal(returned.actions.return, false); assert.equal(returned.actions.refund, true);
  assert.equal(returned.sales[0].remaining_refund_cents, 2501);
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "duplicate-return", action: "return", card: returned, draft: fixtureReturnDraft() }), /unavailable/);
  const originalPosition = structuredClone(returned.position);
  const refund = buildPhysicalInventoryCommand({ requestId: "isolated-returned-refund", action: "refund", card: returned,
    draft: { ...fixtureRefundDraft(), originalSaleId: original.source_event_id } });
  const refunded = await s.append(refund, { ...returned.card });
  assert.deepEqual(refunded.position, originalPosition);
  assert.deepEqual(refunded.card, returned.card);
  assert.equal(refunded.sales[0].remaining_refund_cents, 1500);
});

test("refund and refund reversal change only replayed money balance, including final one-cent exhaustion", async () => {
  const s = await scenario();
  const external = { ...s.current.card };
  const refund = buildPhysicalInventoryCommand({ requestId: "isolated-refund", action: "refund", card: s.current, draft: fixtureRefundDraft() });
  await s.append(refund, external);
  assert.deepEqual(s.current.card, external); assert.equal(s.current.position, null);
  assert.deepEqual([s.current.sales[0].refunded_cents, s.current.sales[0].remaining_refund_cents], [1001, 1500]);
  assert.equal(s.current.sales[0].remaining_return_quantity, 1);
  await s.append(reversal(refund, 3, "isolated-refund-reversal"), external);
  assert.deepEqual([s.current.sales[0].refunded_cents, s.current.sales[0].remaining_refund_cents], [0, 2501]);
  const almost = buildPhysicalInventoryCommand({ requestId: "isolated-refund-most", action: "refund", card: s.current,
    draft: { ...fixtureRefundDraft(), refundUsd: "25.00", refundReference: "isolated-refund-most", effectiveAt: "2026-01-01T03:00:00.000Z" } });
  await s.append(almost, external);
  assert.equal(s.current.sales[0].remaining_refund_cents, 1);
  const final = buildPhysicalInventoryCommand({ requestId: "isolated-refund-final", action: "refund", card: s.current,
    draft: { ...fixtureRefundDraft(), refundUsd: "0.01", refundReference: "isolated-refund-final", effectiveAt: "2026-01-01T03:00:00.000Z" } });
  await s.append(final, external);
  assert.deepEqual(s.current.card, external);
  assert.equal(s.current.sales[0].remaining_refund_cents, 0); assert.equal(s.current.actions.refund, false);
  assert.equal(s.current.actions.return, true);
});

test("return reversal restores return eligibility; reversed original sale disables both adjustments", async () => {
  const s = await scenario();
  const external = { ...s.current.card };
  const command = buildPhysicalInventoryCommand({ requestId: "isolated-return", action: "return", card: s.current, draft: fixtureReturnDraft() });
  await s.append(command, { ...external, currentOwnerType: "HOUSE", lifecycleState: "IN_INVENTORY", locationId: fixtureWarehouse.location_id });
  await s.append(reversal(command, 3, "isolated-return-reversal"), external);
  assert.equal(s.current.actions.return, true); assert.equal(s.current.sales[0].returned_quantity, 0);
  await s.append(reversal(s.sale, 2, "isolated-sale-reversal"), { ...external, currentOwnerType: "HOUSE", lifecycleState: "AT_LOCATION", locationId: fixtureMachine.location_id });
  assert.equal(s.current.sales[0].reversed, true);
  assert.equal(s.current.actions.return, false); assert.equal(s.current.actions.refund, false);
  assert.match(s.current.sales[0].return_reason!, /sale was reversed/);
});

test("unknown and zero original sale gross never become refundable defaults", async () => {
  for (const gross of [null, 0]) {
    const s = await scenario({ gross });
    assert.equal(s.current.sales[0].remaining_refund_cents, gross);
    assert.equal(s.current.actions.refund, false); assert.equal(s.current.actions.return, true);
    assert.match(s.current.sales[0].refund_reason!, gross === null ? /unknown/ : /No documented/);
  }
});

test("reacquisition and resale cannot return an older acquisition cycle while each sale retains its money balance", async () => {
  const s = await scenario();
  const oldSale = s.current.sales[0].source_event_id;
  const acquisition = buildPhysicalInventoryCommand({ requestId: "isolated-reacquisition", action: "receive", card: s.current, draft: {
    ...fixtureReceiptDraft(), effectiveAt: "2026-01-01T02:00:00.000Z", acquisitionId: "isolated-new-invoice", cycleId: "isolated-new-cycle", lotId: "isolated-new-lot", costUsd: "18.99",
    custodyKind: "machine", custodyExternalId: "isolated-a", custodyEvidenceRef: fixtureMachine.evidence_ref, locationId: fixtureMachine.location_id,
  } });
  await s.append(acquisition, { ...s.current.card, currentOwnerType: "HOUSE", lifecycleState: "AT_LOCATION", locationId: fixtureMachine.location_id });
  assert.equal(s.current.actions.return, false); assert.equal(s.current.actions.refund, true);
  const newSale = fixtureSaleCommand(s.current); newSale.request_id = "isolated-sale-again"; newSale.event.effective_at = "2026-01-01T03:00:00.000Z";
  newSale.event.external_sale_id = "isolated-new-dispatch"; newSale.fulfilment!.dispatch_reference = "isolated-new-dispatch";
  await s.append(newSale, { ...s.current.card, currentOwnerType: "EXTERNAL", lifecycleState: "EXTERNAL", locationId: null });
  assert.equal(s.current.sales[0].source_event_id, oldSale); assert.equal(s.current.sales[0].remaining_return_quantity, 1);
  assert.equal(s.current.sales[0].return_available, false); assert.equal(s.current.sales[0].refund_available, true);
  assert.equal(s.current.sales[1].return_available, true);
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "wrong-cycle", action: "return", card: s.current, draft: fixtureReturnDraft() }), /eligible original sale/);
  const currentReturn = buildPhysicalInventoryCommand({ requestId: "isolated-current-return", action: "return", card: s.current,
    draft: { ...fixtureReturnDraft(), originalSaleId: s.current.sales[1].source_event_id, effectiveAt: "2026-01-01T03:00:00.000Z" } });
  assert.equal(currentReturn.event.components[0].cost_cents, 1899);
  assert.equal(currentReturn.event.components[0].acquisition_cycle_id, "isolated-new-cycle");
});

test("source replay rejects over-refunds even when a stale browser previously showed enough gross", async () => {
  const s = await scenario();
  const stale = structuredClone(s.current);
  const accepted = buildPhysicalInventoryCommand({ requestId: "isolated-first-refund", action: "refund", card: stale, draft: { ...fixtureRefundDraft(), refundUsd: "20.00" } });
  await s.append(accepted, { ...s.current.card });
  const staleCommand = buildPhysicalInventoryCommand({ requestId: "isolated-stale-refund", action: "refund", card: stale, draft: fixtureRefundDraft() });
  const state = new InventoryState();
  for (const entry of s.current.history) state.apply(entry.event);
  assert.throws(() => state.apply(fixtureEvent(staleCommand, 4)), /exceeds/);
  assert.equal(s.current.sales[0].remaining_refund_cents, 501);
});
