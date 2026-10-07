import {
  CardInventoryErrorV2, InventoryState, canonical, matchesFinancialInventoryTokenV2,
  readCardInventoryCardHistoryV2, safeSum, type Prisma,
} from "@tenkings/database";
import { physicalInventoryCardSchema, type PhysicalInventoryCard } from "../physicalInventory";

export const PHYSICAL_INVENTORY_READ_MAX_BYTES = 2 * 1024 * 1024;
type ReadClient = Pick<Prisma.TransactionClient, "collectibleCardV2" | "location" | "$queryRaw">;

export async function readPhysicalInventoryCard(db: ReadClient, cardId: string): Promise<PhysicalInventoryCard | null> {
  const card = await db.collectibleCardV2.findUnique({ where: { id: cardId }, select: {
    id: true, publicToken: true, speedsterSessionId: true, category: true, playerName: true, cardName: true,
    year: true, manufacturer: true, productSet: true, parallel: true, insert: true, cardNumber: true,
    currentOwnerType: true, currentOwnerId: true, lifecycleState: true, locationId: true, saleMode: true,
  } });
  if (!card) return null;
  const history = await readCardInventoryCardHistoryV2(db, card.id);
  const state = new InventoryState();
  const fail = (): never => { throw new CardInventoryErrorV2("INTEGRITY", "Physical inventory read failed integrity verification"); };
  try { for (const entry of history) state.apply(entry.event); } catch { return fail(); }
  const last = history.at(-1);
  if (last && canonical(last.card_after) !== canonical({
    currentOwnerType: card.currentOwnerType, currentOwnerId: card.currentOwnerId,
    lifecycleState: card.lifecycleState, locationId: card.locationId, saleMode: card.saleMode,
  })) return fail();
  const positions = [...state.positions.values()].filter((entry) => entry.quantity > 0);
  if (positions.length > 1 || positions.some((entry) => entry.quantity !== 1)) return fail();
  const bindings = new Map<string, PhysicalInventoryCard["bindings"][number]>();
  const products = new Map<string, string>();
  for (const entry of history) {
    const previousProduct = products.get(entry.event.external_product_id);
    if (previousProduct && previousProduct !== entry.command.product_identity_ref) return fail();
    products.set(entry.event.external_product_id, entry.command.product_identity_ref);
    for (const binding of entry.command.custody_bindings) {
      if (bindings.has(binding.custody_id) && canonical(bindings.get(binding.custody_id)) !== canonical(binding)) return fail();
      bindings.set(binding.custody_id, binding);
    }
  }
  const held = positions[0];
  let position: PhysicalInventoryCard["position"] = null;
  if (held) {
    const binding = bindings.get(held.custody);
    const product = products.get(held.origin.external_product_id);
    if (!binding || !product || card.currentOwnerType !== "HOUSE" || binding.location_id !== card.locationId ||
      held.origin.components.length !== 1 || held.origin.components[0].unit_id !== card.id || held.origin.components[0].quantity !== 1) return fail();
    position = { origin: held.origin, custody_id: held.custody, quantity: 1, binding, product_identity_ref: product };
  }
  const eligible = card.currentOwnerId === null && ["HOUSE", "EXTERNAL"].includes(card.currentOwnerType) &&
    ["GRADED", "IN_INVENTORY", "ASSIGNED_TO_PACK", "AT_LOCATION", "EXTERNAL"].includes(card.lifecycleState) &&
    (Boolean(last) || (card.currentOwnerType === "HOUSE" && ["GRADED", "IN_INVENTORY"].includes(card.lifecycleState)));
  const houseStock = eligible && card.currentOwnerType === "HOUSE" && position !== null;
  const saleEvents = [...state.events.values()].filter(({ event }) => event.event_kind === "sale");
  const latestSaleId = saleEvents.filter(({ event }) => !state.reversed.has(event.source_event_id)).at(-1)?.event.source_event_id;
  const adjustments = new Map<string, { returned: number[]; refunded: number[] }>();
  for (const { event } of state.events.values()) {
    if (!event.reverses_source_event_id || state.reversed.has(event.source_event_id) || !["return", "refund"].includes(event.event_kind)) continue;
    const totals = adjustments.get(event.reverses_source_event_id) ?? { returned: [], refunded: [] };
    if (event.event_kind === "return") totals.returned.push(event.quantity);
    else totals.refunded.push(event.sale_gross_cents!);
    adjustments.set(event.reverses_source_event_id, totals);
  }
  const sales: PhysicalInventoryCard["sales"] = saleEvents.map(({ event }) => {
    const totals = adjustments.get(event.source_event_id);
    const returned = safeSum(totals?.returned ?? []);
    const refunded = safeSum(totals?.refunded ?? []);
    const remainingQuantity = event.quantity - returned;
    const remainingRefund = event.sale_gross_cents === null ? null : event.sale_gross_cents - refunded;
    const reversed = state.reversed.has(event.source_event_id);
    // The latest outstanding sale identifies this card's current external custody.
    // An older acquisition's sale must not restore an obsolete cost cycle after resale.
    const returnReason = !eligible ? "This card is outside the physical inventory workflow."
      : reversed ? "The original sale was reversed."
      : remainingQuantity !== 1 ? "The original sold card has already been physically returned."
      : event.source_event_id !== latestSaleId ? "A later unreversed sale identifies this card’s current outbound stock."
      : card.currentOwnerType !== "EXTERNAL" || position ? "The card must be externally owned with no stock in recorded house custody."
      : null;
    const refundReason = !eligible ? "This card is outside the physical inventory workflow."
      : reversed ? "The original sale was reversed."
      : remainingRefund === null ? "The original sale gross is unknown; an evidenced source correction is required before recording a money refund."
      : remainingRefund === 0 ? "No documented sale gross remains to refund."
      : null;
    return { source_event_id: event.source_event_id, reversed, returned_quantity: returned, remaining_return_quantity: remainingQuantity,
      refunded_cents: refunded, remaining_refund_cents: remainingRefund,
      return_available: returnReason === null, refund_available: refundReason === null, return_reason: returnReason, refund_reason: refundReason };
  });
  const locations = await db.location.findMany({ select: { id: true, name: true, slug: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 });
  if (locations.length > 1000) throw new CardInventoryErrorV2("UNAVAILABLE", "Existing Location list exceeds the bounded operator response");
  const result = physicalInventoryCardSchema.parse({
    version: 1, card, locations,
    history: history.map(({ command, event }) => ({
      request_id: command.request_id, event, product_identity_ref: command.product_identity_ref,
      custody_bindings: command.custody_bindings, ownership_evidence_ref: command.ownership_evidence_ref, fulfilment: command.fulfilment,
    })),
    position, bindings: [...bindings.values()], sales,
    actions: {
      receive: eligible && !position,
      pack: houseStock && ["receipt", "opening"].includes(position!.origin.event_kind) && position!.origin.unit_or_pack_id === card.id,
      move: houseStock,
      sale: houseStock && position!.custody_id.startsWith("machine:"),
      return: sales.some((sale) => sale.return_available),
      refund: sales.some((sale) => sale.refund_available),
      reason: eligible ? null : "This card is outside the physical inventory workflow. Account-owned, void, listed-direct, shipping, or previously assigned cards without source history cannot be captured here.",
    },
  });
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > PHYSICAL_INVENTORY_READ_MAX_BYTES) {
    throw new CardInventoryErrorV2("UNAVAILABLE", "Physical inventory history exceeds the bounded operator response");
  }
  return result;
}

type Request = {
  method?: string; headers: { authorization?: string; "x-operator-key"?: string | string[] };
  query: Record<string, string | string[] | undefined>;
};
type Response = { setHeader(name: string, value: string): unknown; status(code: number): Response; json(body: unknown): unknown };
export function createPhysicalInventoryCardHandler(deps: {
  readTokenHash(): string | undefined;
  requireAdmin(req: Request): Promise<{ authority?: string }>;
  readCard(cardId: string): Promise<PhysicalInventoryCard | null>;
}) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (req.headers["x-operator-key"] !== undefined) return res.status(403).json({ code: "HUMAN_ADMIN_REQUIRED" });
    if (matchesFinancialInventoryTokenV2(req.headers.authorization, deps.readTokenHash())) return res.status(403).json({ code: "READ_ONLY_CAPABILITY" });
    try {
      const admin = await deps.requireAdmin(req);
      if (admin.authority === "operator-key") return res.status(403).json({ code: "HUMAN_ADMIN_REQUIRED" });
    } catch (error) {
      const status = error && typeof error === "object" && "statusCode" in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(status).json({ code: status === 503 ? "AUTH_UNAVAILABLE" : "UNAUTHORIZED" });
    }
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ code: "METHOD_NOT_ALLOWED" }); }
    if (Object.keys(req.query).some((key) => key !== "card_id") || typeof req.query.card_id !== "string" ||
      !req.query.card_id.trim() || req.query.card_id.length > 200 || req.query.card_id !== req.query.card_id.trim()) {
      return res.status(400).json({ code: "INVALID_CARD_ID" });
    }
    try {
      const card = await deps.readCard(req.query.card_id);
      if (!card) return res.status(404).json({ code: "CARD_NOT_FOUND" });
      return res.status(200).json(card);
    } catch {
      return res.status(503).json({ code: "INVENTORY_UNAVAILABLE", message: "Inventory evidence is unavailable or failed integrity verification." });
    }
  };
}
