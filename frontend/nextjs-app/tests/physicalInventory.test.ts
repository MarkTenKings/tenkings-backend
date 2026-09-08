import assert from "node:assert/strict";
import test from "node:test";
import { cardInventorySourceEventIdV2, parseCardInventoryCommandV2, InventorySourceEventInput } from "@tenkings/database";
import {
  buildPhysicalInventoryCommand, emptyPhysicalInventoryDraft, physicalInventoryMoney, physicalInventoryUsdToCents,
  physicalInventoryCardSchema, physicalInventoryReceiptMatches, physicalInventoryRequestEventId, physicalInventoryHistoryMatches,
} from "../lib/physicalInventory";
import { fixtureAdminId, fixtureEmptyCard, fixtureHeldCard, fixtureReceiptDraft, fixtureReceiptCommand, fixtureEvent, fixtureMachine,
  fixtureSoldCard, fixtureReturnDraft, fixtureRefundDraft, fixtureHistoryEntry } from "./physicalInventoryFixtures";

const draft = () => ({ ...emptyPhysicalInventoryDraft(), effectiveAt: "2026-01-02T00:00:00.000Z", evidenceRef: "fixture:physical-event" });

test("money parses exact cents including safe maximum; rejects coercion, rounding and overflow", () => {
  assert.equal(physicalInventoryUsdToCents("12.01"), 1201);
  assert.equal(physicalInventoryUsdToCents("0"), 0);
  assert.equal(physicalInventoryUsdToCents("1.2"), 120);
  assert.equal(physicalInventoryUsdToCents("90071992547409.91"), Number.MAX_SAFE_INTEGER);
  assert.equal(physicalInventoryMoney(Number.MAX_SAFE_INTEGER), "$90,071,992,547,409.91");
  assert.equal(physicalInventoryMoney(null), "Unknown");
  for (const value of ["", "-1", "+1", "1e2", "1,200", "$12", "1.001", "1.", ".5", "01", "NaN", "Infinity", "90071992547409.92"]) {
    assert.throws(() => physicalInventoryUsdToCents(value), Error, value);
  }
  assert.throws(() => physicalInventoryUsdToCents("21474836.48", "Sale gross", 2_147_483_647));
});

test("acquisition builds a valid exact-card command with server audit fields absent", () => {
  const command = fixtureReceiptCommand();
  assert.deepEqual(parseCardInventoryCommandV2(command), command);
  assert.deepEqual(InventorySourceEventInput.parse(fixtureEvent(command)), fixtureEvent(command));
  assert.equal(command.event.stock_id, null);
  assert.equal(command.event.components[0].cost_cents, 1201);
  assert.equal(command.event.components[0].purchase_ledger_line_id, null);
  for (const property of ["source_sequence", "source_event_id", "recorded_by", "recorded_at"]) assert.equal(property in command.event, false);
});

test("unknown and evidenced zero acquisition costs stay distinct", () => {
  const unknown = fixtureReceiptDraft();
  unknown.costKind = "unknown"; unknown.costUsd = "999999"; unknown.unknownReason = "Fixture invoice omits the card amount";
  const command = buildPhysicalInventoryCommand({ requestId: "unknown-request", action: "receive", draft: unknown, card: fixtureEmptyCard() });
  assert.equal(command.event.components[0].cost_cents, null);
  assert.equal(command.event.components[0].unknown_reason, unknown.unknownReason);
  unknown.unknownReason = "";
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "unknown-request", action: "receive", draft: unknown, card: fixtureEmptyCard() }), /Unknown-cost reason/);
  const zero = fixtureReceiptDraft(); zero.costUsd = "0.00";
  assert.equal(buildPhysicalInventoryCommand({ requestId: "zero-request", action: "receive", draft: zero, card: fixtureEmptyCard() }).event.components[0].cost_cents, 0);
  zero.costEvidenceRef = "";
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "zero-request", action: "receive", draft: zero, card: fixtureEmptyCard() }), /cost evidence/);
});

test("receipts require real calendar UTC time, ownership, acquisition and Location evidence", () => {
  for (const patch of [{ effectiveAt: "2026-02-30T00:00:00.000Z" }, { effectiveAt: "2026-01-01T01:00:00+01:00" },
    { ownershipEvidenceRef: "" }, { acquisitionId: "" }, { cycleId: "" }, { locationId: "machine-1" },
    { custodyExternalId: "two words" }, { custodyEvidenceRef: "" }, { receiptKind: "" }, { costKind: "" }]) {
    assert.throws(() => buildPhysicalInventoryCommand({ requestId: "invalid-request", action: "receive", draft: { ...fixtureReceiptDraft(), ...patch } as ReturnType<typeof draft>, card: fixtureEmptyCard() }));
  }
});

test("packing preserves acquired components and consumes the exact loose stock", () => {
  const held = fixtureHeldCard();
  const command = buildPhysicalInventoryCommand({ requestId: "pack-request", card: held, action: "pack", draft: {
    ...draft(), packId: "isolated-pack", productId: "isolated-pack-product", productEvidenceRef: "fixture:pack-definition", costUsd: "999.00",
  } });
  assert.deepEqual(command.event.components, held.position!.origin.components);
  assert.notEqual(command.event.components, held.position!.origin.components);
  assert.deepEqual(command.event.inputs, [{ stock_id: held.position!.origin.stock_id, quantity: 1 }]);
  assert.equal(command.event.unit_or_pack_id, "isolated-pack");
  assert.equal(command.event.stock_id, null);
  assert.equal(command.event.from_custody_id, command.event.to_custody_id);
  assert.deepEqual(parseCardInventoryCommandV2(command), command);
  const bad = { ...draft(), packId: held.card.id, productId: "pack", productEvidenceRef: "fixture:pack" };
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "bad-pack", card: held, action: "pack", draft: bad }), /distinct/);
});

test("movement carries exact identity/cost and refuses custody remapping or same-location stock movement", () => {
  const held = fixtureHeldCard();
  const movement = { ...draft(), movementKind: "restock" as const, custodyKind: "machine" as const, custodyExternalId: "isolated-a",
    locationId: fixtureMachine.location_id, custodyEvidenceRef: fixtureMachine.evidence_ref, productId: "ignored-edit", costUsd: "9000" };
  const command = buildPhysicalInventoryCommand({ requestId: "move-request", card: held, action: "move", draft: movement });
  assert.equal(command.event.stock_id, held.position!.origin.stock_id);
  assert.equal(command.event.external_product_id, held.position!.origin.external_product_id);
  assert.deepEqual(command.event.components, held.position!.origin.components);
  assert.equal(command.custody_bindings.length, 2);
  assert.deepEqual(parseCardInventoryCommandV2(command), command);
  held.bindings.push(fixtureMachine);
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "bad-binding", card: held, action: "move", draft: { ...movement, custodyEvidenceRef: "new evidence" } }), /accepted Location evidence/);
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "bad-destination", card: fixtureHeldCard(true), action: "move", draft: movement }), /different/);
});

test("sale needs explicit successful payment and exact completed dispatch and preserves cost", () => {
  const sale = { ...draft(), paymentSucceeded: true, dispatched: true, paymentReference: "isolated-payment", dispatchReference: "isolated-dispatch",
    fulfilmentEvidenceRef: "fixture:fulfilled-sale", saleAmountKind: "known" as const, saleUsd: "25.01" };
  const held = fixtureHeldCard(true);
  const command = buildPhysicalInventoryCommand({ requestId: "sale-request", card: held, action: "sale", draft: sale });
  assert.equal(command.event.external_sale_id, "isolated-dispatch");
  assert.equal(command.fulfilment!.dispatch_reference, command.event.external_sale_id);
  assert.equal(command.event.sale_gross_cents, 2501);
  assert.deepEqual(command.event.components, held.position!.origin.components);
  assert.deepEqual(parseCardInventoryCommandV2(command), command);
  for (const patch of [{ paymentSucceeded: false }, { dispatched: false }, { paymentReference: "" }, { dispatchReference: "" }, { fulfilmentEvidenceRef: "" }]) {
    assert.throws(() => buildPhysicalInventoryCommand({ requestId: "invalid-sale", card: held, action: "sale", draft: { ...sale, ...patch } }));
  }
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "warehouse-sale", card: fixtureHeldCard(), action: "sale", draft: sale }), /unavailable/);
  const unknown = buildPhysicalInventoryCommand({ requestId: "unknown-sale", card: held, action: "sale", draft: { ...sale, saleAmountKind: "unknown", saleUsd: "invalid" } });
  assert.equal(unknown.event.sale_gross_cents, null);
});

test("browser response validation rejects absent components and malformed cost semantics", () => {
  assert.deepEqual(physicalInventoryCardSchema.parse(fixtureHeldCard()), fixtureHeldCard());
  const bad = fixtureHeldCard(); bad.position!.origin.components[0].cost_cents = null;
  assert.equal(physicalInventoryCardSchema.safeParse(bad).success, false);
  const badVersion = { ...fixtureEmptyCard(), version: 2 };
  assert.equal(physicalInventoryCardSchema.safeParse(badVersion).success, false);
});

test("receipt accepts only the exact request, evidence and authenticated actor", async () => {
  const command = fixtureReceiptCommand();
  const pending = { version: 1 as const, adminId: fixtureAdminId, action: "receive" as const, command };
  const expectedId = await physicalInventoryRequestEventId(command.request_id);
  assert.equal(expectedId, cardInventorySourceEventIdV2(command.request_id));
  const event = fixtureEvent(command);
  assert.equal(physicalInventoryReceiptMatches(event, pending, expectedId), true);
  assert.equal(physicalInventoryReceiptMatches({ ...event, recorded_by: "different-admin" }, pending, expectedId), false);
  assert.equal(physicalInventoryReceiptMatches({ ...event, source_event_id: "different-event" }, pending, expectedId), false);
  assert.equal(physicalInventoryReceiptMatches({ ...event, evidence_ref: "changed" }, pending, expectedId), false);
});

test("physical return restores the exact original sale components without new cost or money", () => {
  const sold = fixtureSoldCard();
  const sale = sold.history.at(-1)!.event;
  const d = { ...fixtureReturnDraft(), costUsd: "99999.99", productId: "ignored-replacement", cycleId: "ignored-new-cycle" };
  const command = buildPhysicalInventoryCommand({ requestId: "isolated-return", action: "return", card: sold, draft: d });
  assert.deepEqual(parseCardInventoryCommandV2(command), command);
  assert.deepEqual(InventorySourceEventInput.parse(fixtureEvent(command, 3)), fixtureEvent(command, 3));
  assert.equal(command.event.reverses_source_event_id, sale.source_event_id);
  assert.equal(command.event.stock_id, sale.stock_id);
  assert.equal(command.event.external_product_id, sale.external_product_id);
  assert.equal(command.event.acquisition_cycle_id, sale.acquisition_cycle_id);
  assert.deepEqual(command.event.components, sale.components);
  assert.notEqual(command.event.components, sale.components);
  assert.equal(command.event.from_custody_id, null);
  assert.equal(command.event.quantity, 1);
  assert.equal(command.event.sale_gross_cents, null);
  assert.equal(command.event.external_sale_id, null);
  assert.equal(command.fulfilment, null);
  assert.equal(command.custody_bindings.length, 1);
  for (const patch of [{ originalSaleId: "" }, { originalSaleId: "wrong-sale" }, { correctionReason: "" },
    { physicallyReturned: false }, { ownershipEvidenceRef: "" }, { locationId: "" }, { evidenceRef: "" }]) {
    assert.throws(() => buildPhysicalInventoryCommand({ requestId: "bad-return", action: "return", card: sold, draft: { ...d, ...patch } }));
  }
  sold.sales[0].return_available = false;
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "exhausted-return", action: "return", card: sold, draft: d }), /eligible original sale/);
});

test("completed money refund is exact cents within remaining gross and has no physical payload", () => {
  const sold = fixtureSoldCard();
  const d = { ...fixtureRefundDraft(), ...{ costUsd: "999.99", custodyKind: "machine" as const, custodyExternalId: "ignored", ownershipEvidenceRef: "ignored" } };
  const command = buildPhysicalInventoryCommand({ requestId: "isolated-refund", action: "refund", card: sold, draft: d });
  assert.deepEqual(parseCardInventoryCommandV2(command), command);
  assert.equal(command.event.sale_gross_cents, 1001);
  assert.equal(command.event.reverses_source_event_id, sold.history.at(-1)!.event.source_event_id);
  assert.equal(command.event.external_sale_id, d.refundReference);
  assert.equal(command.event.quantity, 0);
  for (const key of ["stock_id", "unit_or_pack_id", "lot_id", "acquisition_cycle_id", "from_custody_id", "to_custody_id"] as const) assert.equal(command.event[key], null);
  assert.deepEqual(command.event.components, []); assert.deepEqual(command.event.inputs, []); assert.deepEqual(command.custody_bindings, []);
  assert.equal(command.ownership_evidence_ref, null); assert.equal(command.fulfilment, null);
  for (const patch of [{ refundUsd: "0.00" }, { refundUsd: "25.02" }, { refundUsd: "10.001" }, { refundUsd: "1e1" },
    { refundReference: "" }, { refundCompleted: false }, { originalSaleId: "" }, { correctionReason: "" }, { evidenceRef: "" }]) {
    assert.throws(() => buildPhysicalInventoryCommand({ requestId: "bad-refund", action: "refund", card: sold, draft: { ...d, ...patch } }));
  }
  assert.equal(buildPhysicalInventoryCommand({ requestId: "full-refund", action: "refund", card: sold, draft: { ...d, refundUsd: "25.01" } }).event.sale_gross_cents, 2501);
  sold.sales[0].remaining_refund_cents = 1500;
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "over-remaining", action: "refund", card: sold, draft: { ...d, refundUsd: "15.01" } }), /remaining documented gross/);
  sold.sales[0].remaining_refund_cents = null;
  assert.throws(() => buildPhysicalInventoryCommand({ requestId: "unknown-original", action: "refund", card: sold, draft: d }), /remaining documented gross/);
});

test("return and refund receipts require exact original-sale and amount evidence", async () => {
  for (const action of ["return", "refund"] as const) {
    const command = buildPhysicalInventoryCommand({ requestId: `isolated-${action}`, action, card: fixtureSoldCard(), draft: action === "return" ? fixtureReturnDraft() : fixtureRefundDraft() });
    const pending = { version: 1 as const, adminId: fixtureAdminId, action, command };
    const event = fixtureEvent(command, 3);
    const expectedId = await physicalInventoryRequestEventId(command.request_id);
    assert.equal(physicalInventoryReceiptMatches(event, pending, expectedId), true);
    assert.equal(physicalInventoryReceiptMatches({ ...event, reverses_source_event_id: "different-sale" }, pending, expectedId), false);
    assert.equal(physicalInventoryReceiptMatches({ ...event, sale_gross_cents: 1 }, pending, expectedId), false);
    const history = fixtureHistoryEntry(command, 3);
    assert.equal(physicalInventoryHistoryMatches(history, pending, expectedId), true);
    assert.equal(physicalInventoryHistoryMatches({ ...history, ownership_evidence_ref: "altered-title-evidence" }, pending, expectedId), false);
    assert.equal(physicalInventoryHistoryMatches({ ...history, product_identity_ref: "altered-product-definition" }, pending, expectedId), false);
  }
});
