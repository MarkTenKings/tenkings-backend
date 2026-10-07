// Deterministic physical inventory replay. No SQL, persistence, clock, or vendor calls.
import { canonical, safeSum, scaledComponents, type InventoryComponent, type InventorySourceEvent } from './cardInventoryV2';

export interface Stock { origin: InventorySourceEvent; custody: string; quantity: number; at: string }
export interface Effect { stock_id: string; custody: string; quantity: number }
export interface Movement { event: InventorySourceEvent; effects: Effect[]; sale_quantity: number; cost_sign: number; revenue_cents: number | null; revenue_sign: number; original_sale_id: string | null }
const posKey = (stock: string, custody: string) => JSON.stringify([stock, custody]);
const signature = (cs: InventoryComponent[]) => canonical([...cs].sort((a, b) => canonical(a).localeCompare(canonical(b))));

export class InventoryState {
  readonly origins = new Map<string, InventorySourceEvent>();
  readonly events = new Map<string, Movement>();
  readonly positions = new Map<string, Stock>();
  readonly reversed = new Set<string>();
  private lastEffective = new Map<string, string>();
  private issued = new Set<string>();

  apply(e: InventorySourceEvent): Movement {
    if (this.events.has(e.source_event_id)) throw new Error('duplicate physical event identity');
    const parent = e.reverses_source_event_id ? this.events.get(e.reverses_source_event_id) : null;
    if (e.reverses_source_event_id && (!parent || this.reversed.has(e.reverses_source_event_id))) throw new Error('original event is missing or already reversed');
    if (parent && (e.effective_at < parent.event.effective_at || e.external_product_id !== parent.event.external_product_id)) throw new Error('original event product/date mismatch');
    const movement: Movement = { event: e, effects: [], sale_quantity: 0, cost_sign: 0, revenue_cents: null, revenue_sign: 0, original_sale_id: null };
    const effects = movement.effects;
    const change = (stock_id: string, custody: string | null, quantity: number) => { if (custody === null) throw new Error('physical custody is required'); effects.push({ stock_id, custody, quantity }); };
    const root = e.stock_id ? this.origins.get(e.stock_id) : null;
    if (!['opening', 'receipt', 'pack', 'refund'].includes(e.event_kind) && !(e.event_kind === 'reversal' && e.quantity === 0)) {
      if (!root || root.external_product_id !== e.external_product_id || root.unit_or_pack_id !== e.unit_or_pack_id || root.lot_id !== e.lot_id || root.acquisition_cycle_id !== e.acquisition_cycle_id) throw new Error('stock identity/product/acquisition cycle does not match its origin');
      if (signature(e.components) !== signature(scaledComponents(root.components, root.quantity, e.quantity))) throw new Error('movement would change the acquired unit cost or pack contents');
    }
    if (['opening', 'receipt', 'pack'].includes(e.event_kind)) {
      if (this.origins.has(e.stock_id!)) throw new Error('stock origin already exists');
      // Anonymous lots must consist of identical integer-cent units, not an inferred ordering.
      if (!e.unit_or_pack_id) {
        if (e.components.some((c) => c.unit_id !== null)) throw new Error('identified cards cannot be anonymous homogeneous lot units');
        scaledComponents(e.components, e.quantity, 1);
      }
      const tokens = e.components.filter((c) => c.unit_id !== null).map((c) => canonical([c.unit_id, c.acquisition_cycle_id]));
      if (new Set(tokens).size !== tokens.length) throw new Error('one card component appears twice in the same stock');
      if (e.event_kind !== 'pack') {
        if (tokens.some((t) => this.issued.has(t))) throw new Error('an acquisition unit was already received; use a physical return or a new acquisition cycle');
        for (const t of tokens) this.issued.add(t);
      } else {
        const inputs: InventoryComponent[] = [];
        if (new Set(e.inputs.map((i) => i.stock_id)).size !== e.inputs.length) throw new Error('packing repeats a stock input');
        for (const i of e.inputs) {
          const origin = this.origins.get(i.stock_id);
          if (!origin) throw new Error('packing input has no stock origin');
          inputs.push(...scaledComponents(origin.components, origin.quantity, i.quantity));
          change(i.stock_id, e.from_custody_id, -i.quantity);
        }
        if (signature(inputs) !== signature(e.components)) throw new Error('packed contents/costs do not equal the actual input stock');
      }
      this.origins.set(e.stock_id!, e);
      change(e.stock_id!, e.to_custody_id, e.quantity);
    } else if (e.event_kind === 'restock' || e.event_kind === 'transfer') {
      change(e.stock_id!, e.from_custody_id, -e.quantity); change(e.stock_id!, e.to_custody_id, e.quantity);
    } else if (e.event_kind === 'sale') {
      change(e.stock_id!, e.from_custody_id, -e.quantity);
      movement.sale_quantity = e.quantity; movement.cost_sign = 1; movement.revenue_sign = 1; movement.revenue_cents = e.sale_gross_cents; movement.original_sale_id = e.source_event_id;
    } else if (e.event_kind === 'unpack') {
      if (root!.event_kind !== 'pack') throw new Error('unpack requires the original captured packing inputs');
      change(e.stock_id!, e.from_custody_id, -1);
      for (const i of root!.inputs) change(i.stock_id, e.to_custody_id, i.quantity);
    } else if (e.event_kind === 'return' || e.event_kind === 'refund') {
      if (!parent || parent.event.event_kind !== 'sale') throw new Error('return/refund must cite a completed sale');
      const prior = [...this.events.values()].filter((m) => m.event.reverses_source_event_id === parent.event.source_event_id && m.event.event_kind === e.event_kind && !this.reversed.has(m.event.source_event_id));
      movement.original_sale_id = parent.event.source_event_id;
      if (e.event_kind === 'return') {
        if (e.stock_id !== parent.event.stock_id || safeSum([...prior.map((m) => m.event.quantity), e.quantity]) > parent.event.quantity) throw new Error('return exceeds the original sold stock');
        change(e.stock_id!, e.to_custody_id, e.quantity);
        movement.sale_quantity = -e.quantity; movement.cost_sign = -1;
      } else {
        if (parent.event.sale_gross_cents === null || safeSum([...prior.map((m) => m.event.sale_gross_cents!), e.sale_gross_cents!]) > parent.event.sale_gross_cents) throw new Error('refund exceeds or lacks the original sale amount');
        movement.revenue_sign = -1; movement.revenue_cents = e.sale_gross_cents;
      }
    } else if (e.event_kind === 'reversal') {
      if (!parent || parent.event.event_kind === 'reversal') throw new Error('physical reversal needs an original physical event');
      if ([...this.events.values()].some((m) => m.event.reverses_source_event_id === parent.event.source_event_id && !this.reversed.has(m.event.source_event_id))) throw new Error('reverse dependent returns/corrections before their original event');
      if (e.stock_id !== parent.event.stock_id || e.quantity !== parent.event.quantity || e.from_custody_id !== parent.event.to_custody_id || e.to_custody_id !== parent.event.from_custody_id || e.sale_gross_cents !== parent.event.sale_gross_cents || e.external_sale_id !== parent.event.external_sale_id) throw new Error('reversal must exactly reverse the cited event');
      effects.push(...parent.effects.map((p) => ({ ...p, quantity: -p.quantity })));
      movement.sale_quantity = -parent.sale_quantity; movement.cost_sign = -parent.cost_sign; movement.revenue_sign = -parent.revenue_sign; movement.revenue_cents = parent.revenue_cents; movement.original_sale_id = parent.original_sale_id;
      this.reversed.add(parent.event.source_event_id);
      if (['receipt','opening'].includes(parent.event.event_kind)) for (const c of parent.event.components) if (c.unit_id) this.issued.delete(canonical([c.unit_id, c.acquisition_cycle_id]));
    }
    const combined = new Map<string, Effect>();
    for (const effect of effects) {
      const key = posKey(effect.stock_id, effect.custody), previous = combined.get(key);
      combined.set(key, { ...effect, quantity: safeSum([previous?.quantity ?? 0, effect.quantity]) });
    }
    for (const [key, effect] of combined) {
      if (e.effective_at < (this.lastEffective.get(key) ?? '')) throw new Error('event predates an accepted movement of the same stock/custody; append a dated correction');
      const next = safeSum([this.positions.get(key)?.quantity ?? 0, effect.quantity]);
      if (next < 0) throw new Error('insufficient physical stock; no negative stock or duplicate consumption');
      this.positions.set(key, { origin: this.origins.get(effect.stock_id)!, custody: effect.custody, quantity: next, at: e.effective_at });
      this.lastEffective.set(key, e.effective_at);
    }
    // A permanent physical card cannot simultaneously occupy two positions/packed units.
    const packs = new Set<string>();
    for (const p of this.positions.values()) if (p.quantity && p.origin.unit_or_pack_id) {
      if (p.quantity !== 1 || packs.has(p.origin.unit_or_pack_id)) throw new Error('one physical unit/pack occupies more than one stock position');
      packs.add(p.origin.unit_or_pack_id);
    }
    const occupied = new Set<string>();
    for (const p of this.positions.values()) if (p.quantity) for (const c of p.origin.components) if (c.unit_id) {
      if (occupied.has(c.unit_id)) throw new Error('one physical card occupies more than one stock position');
      occupied.add(c.unit_id);
    }
    this.events.set(e.source_event_id, movement);
    return movement;
  }
}
