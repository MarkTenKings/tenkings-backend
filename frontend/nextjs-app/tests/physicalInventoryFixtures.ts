import {
  canonical, inventoryHash, cardInventorySourceEventIdV2,
  type CardInventoryContentV2, type CardInventoryRowV2, type CardInventoryCommandV2,
} from "@tenkings/database";
import {
  buildPhysicalInventoryCommand, emptyPhysicalInventoryDraft,
  type PhysicalInventoryCard, type PhysicalInventoryDraft,
} from "../lib/physicalInventory";

// Isolated in-memory fixtures. They are never persisted or sent to any service.
export const fixtureAdminId = "isolated-admin";
export const fixtureWarehouse = { custody_id: "warehouse:isolated-a", location_id: "11111111-1111-4111-8111-111111111111", evidence_ref: "fixture:warehouse-binding" };
export const fixtureMachine = { custody_id: "machine:isolated-a", location_id: "22222222-2222-4222-8222-222222222222", evidence_ref: "fixture:machine-binding" };
export const fixtureEmptyCard = (): PhysicalInventoryCard => ({
  version: 1,
  card: { id: "isolated-card", publicToken: "tk2c_isolated", speedsterSessionId: "isolated-session", category: "POKEMON",
    playerName: null, cardName: "Isolated fixture card", year: "2026", manufacturer: null, productSet: "Fixture set", parallel: null,
    insert: null, cardNumber: null, currentOwnerType: "HOUSE", currentOwnerId: null, lifecycleState: "GRADED", locationId: null, saleMode: "PACK" },
  locations: [{ id: fixtureWarehouse.location_id, name: "Isolated warehouse location", slug: "isolated-warehouse" }, { id: fixtureMachine.location_id, name: "Isolated machine location", slug: "isolated-machine" }],
  history: [], position: null, bindings: [], sales: [], actions: { receive: true, pack: false, move: false, sale: false, return: false, refund: false, reason: null },
});
export const fixtureReceiptDraft = (): PhysicalInventoryDraft => ({
  ...emptyPhysicalInventoryDraft(), effectiveAt: "2026-01-01T00:00:00.000Z", evidenceRef: "fixture:receipt",
  receiptKind: "receipt", productId: "isolated-loose-product", productEvidenceRef: "fixture:loose-definition",
  ownershipEvidenceRef: "fixture:ownership", custodyKind: "warehouse", custodyExternalId: "isolated-a",
  locationId: fixtureWarehouse.location_id, custodyEvidenceRef: fixtureWarehouse.evidence_ref,
  acquisitionId: "isolated-invoice", lotId: "isolated-lot", cycleId: "isolated-cycle", costKind: "documented_unit",
  costUsd: "12.01", costEvidenceRef: "fixture:invoice-row",
});
export const fixtureReceiptCommand = () => buildPhysicalInventoryCommand({ requestId: "isolated-request", action: "receive", draft: fixtureReceiptDraft(), card: fixtureEmptyCard() });
export function fixtureEvent(command: CardInventoryCommandV2, sequence = 1) {
  const eventId = cardInventorySourceEventIdV2(command.request_id);
  return { ...command.event, source_event_id: eventId, source_sequence: sequence,
    recorded_at: "2026-01-02T00:00:00.000Z", recorded_by: fixtureAdminId,
    stock_id: ["receipt", "opening", "pack"].includes(command.event.event_kind) ? eventId : command.event.stock_id };
}
export function fixtureHeldCard(machine = false): PhysicalInventoryCard {
  const result = fixtureEmptyCard();
  const command = fixtureReceiptCommand();
  if (machine) { command.custody_bindings = [fixtureMachine]; command.event.to_custody_id = fixtureMachine.custody_id; }
  const event = fixtureEvent(command);
  result.card.lifecycleState = machine ? "AT_LOCATION" : "IN_INVENTORY";
  result.card.locationId = machine ? fixtureMachine.location_id : fixtureWarehouse.location_id;
  result.history = [{ request_id: command.request_id, event, product_identity_ref: command.product_identity_ref,
    custody_bindings: command.custody_bindings, ownership_evidence_ref: command.ownership_evidence_ref, fulfilment: null }];
  result.bindings = command.custody_bindings;
  result.position = { origin: event, quantity: 1, custody_id: command.custody_bindings[0].custody_id,
    binding: command.custody_bindings[0], product_identity_ref: command.product_identity_ref };
  result.actions = { receive: false, pack: true, move: true, sale: machine, return: false, refund: false, reason: null };
  return result;
}
export function fixtureRow(command = fixtureReceiptCommand(), sequence = 1, initial = fixtureEmptyCard().card, after = fixtureHeldCard().card): CardInventoryRowV2 {
  const projection = (card: typeof initial): CardInventoryContentV2["card_before"] => ({
    currentOwnerType: card.currentOwnerType as "HOUSE" | "EXTERNAL", currentOwnerId: null, lifecycleState: card.lifecycleState, locationId: card.locationId, saleMode: card.saleMode as "PACK" | "DIRECT",
  });
  const content: CardInventoryContentV2 = { command, event: fixtureEvent(command, sequence), card_before: projection(initial), card_after: projection(after) };
  return { id: content.event.source_event_id, sequence: BigInt(sequence), cardId: command.card_id, recordedAt: new Date(content.event.recorded_at),
    content: canonical(content), contentHash: inventoryHash(content), requestHash: inventoryHash({ command, actor: fixtureAdminId }) };
}

export const fixtureSaleCommand = (held = fixtureHeldCard(true)) => buildPhysicalInventoryCommand({ card: held, action: "sale", requestId: "isolated-sale", draft: {
  ...emptyPhysicalInventoryDraft(), effectiveAt: "2026-01-01T01:00:00.000Z", evidenceRef: "fixture:sale",
  paymentSucceeded: true, dispatched: true, paymentReference: "isolated-payment", dispatchReference: "isolated-dispatch",
  fulfilmentEvidenceRef: "fixture:dispatch", saleAmountKind: "known", saleUsd: "25.01",
} });
export function fixtureHistoryEntry(command: CardInventoryCommandV2, sequence: number): PhysicalInventoryCard["history"][number] {
  return { request_id: command.request_id, event: fixtureEvent(command, sequence), product_identity_ref: command.product_identity_ref,
    custody_bindings: command.custody_bindings, ownership_evidence_ref: command.ownership_evidence_ref, fulfilment: command.fulfilment };
}
export function fixtureSoldCard(): PhysicalInventoryCard {
  const sold = fixtureHeldCard(true);
  const command = fixtureSaleCommand(sold);
  const sale = fixtureHistoryEntry(command, 2);
  sold.history.push(sale);
  sold.card = { ...sold.card, currentOwnerType: "EXTERNAL", lifecycleState: "EXTERNAL", locationId: null, saleMode: "DIRECT" };
  sold.position = null;
  sold.sales = [{ source_event_id: sale.event.source_event_id, reversed: false, returned_quantity: 0, remaining_return_quantity: 1,
    refunded_cents: 0, remaining_refund_cents: 2501, return_available: true, refund_available: true, return_reason: null, refund_reason: null }];
  sold.actions = { receive: true, pack: false, move: false, sale: false, return: true, refund: true, reason: null };
  return sold;
}
export const fixtureReturnDraft = (): PhysicalInventoryDraft => ({
  ...emptyPhysicalInventoryDraft(), originalSaleId: fixtureSoldCard().sales[0].source_event_id,
  correctionReason: "Fixture physical return", physicallyReturned: true, ownershipEvidenceRef: "fixture:returned-title",
  custodyKind: "warehouse", custodyExternalId: "isolated-a", locationId: fixtureWarehouse.location_id, custodyEvidenceRef: fixtureWarehouse.evidence_ref,
  effectiveAt: "2026-01-01T02:00:00.000Z", evidenceRef: "fixture:return-receipt",
});
export const fixtureRefundDraft = (): PhysicalInventoryDraft => ({
  ...emptyPhysicalInventoryDraft(), originalSaleId: fixtureSoldCard().sales[0].source_event_id,
  correctionReason: "Fixture completed refund", refundReference: "isolated-refund", refundUsd: "10.01", refundCompleted: true,
  effectiveAt: "2026-01-01T02:00:00.000Z", evidenceRef: "fixture:completed-refund",
});
