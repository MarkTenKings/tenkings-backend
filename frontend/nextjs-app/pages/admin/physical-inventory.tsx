import Head from "next/head";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import AppShell from "../../components/AppShell";
import InventoryWorkflowWorkspace from "../../components/admin/InventoryWorkflowWorkspace";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  buildPhysicalInventoryCommand, emptyPhysicalInventoryDraft, PhysicalInventoryInputError,
  physicalInventoryApiMessage, physicalInventoryCardSchema, physicalInventoryMoney,
  physicalInventoryPendingSchema, physicalInventoryReceiptMatches, physicalInventoryReceiptSchema,
  physicalInventoryRequestEventId, physicalInventoryHistoryMatches,
  type PhysicalInventoryAction, type PhysicalInventoryCard, type PhysicalInventoryDraft,
  type PhysicalInventoryEvent, type PhysicalInventoryPending, type PhysicalInventoryReceipt,
} from "../../lib/physicalInventory";

const inputClass = "mt-2 w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2.5 text-sm text-white focus:border-amber-300 focus:outline-none disabled:opacity-50";
const buttonClass = "rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold transition hover:border-amber-300 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-40";
const panelClass = "rounded-2xl border border-white/15 bg-white/[0.025] p-5 sm:p-6";
const actionLabels: Record<PhysicalInventoryAction, string> = { receive: "Receive / opening", pack: "Pack one card", move: "Transfer / restock", sale: "Completed sale", return: "Physical return", refund: "Money refund" };
const actionDescriptions: Record<PhysicalInventoryAction, string> = {
  receive: "Record the exact card entering house inventory with acquisition and ownership evidence.",
  pack: "Record this loose card inside one identified physical pack. Its acquisition components stay attached.",
  move: "Record an already completed move between an exact warehouse or machine and an existing Location.",
  sale: "Record this exact card leaving machine custody after successful payment and completed physical dispatch.",
  return: "Record the exact original sold card or one-card pack physically returning to house custody. Its original acquisition cost and cycle stay attached.",
  refund: "Record an already completed money refund against its original sale. Physical return is captured separately; this record changes no stock or acquisition cost.",
};

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-white/85">{label}{children}{help && <span className="mt-1.5 block text-xs font-normal leading-5 text-white/55">{help}</span>}</label>;
}
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs uppercase tracking-wider text-white/50">{label}</dt><dd className="mt-1 break-words text-sm text-white/90">{children}</dd></div>;
}
function CostEvidence({ event }: { event: PhysicalInventoryEvent }) {
  return <div className="space-y-3">{event.components.map((component, index) => <div key={`${component.acquisition_cycle_id}:${index}`} className="rounded-lg border border-white/10 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><strong>{physicalInventoryMoney(component.cost_cents)}</strong><span className="text-xs text-white/60">{component.basis.replaceAll("_", " ")}</span></div>
    {component.unknown_reason && <p className="mt-1 text-sm text-amber-200">{component.unknown_reason}</p>}
    <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><Fact label="Acquisition / invoice">{component.acquisition_event_id}</Fact><Fact label="Lot / cycle">{component.lot_id} / {component.acquisition_cycle_id}</Fact><Fact label="Cost evidence">{component.evidence_ref}</Fact><Fact label="Permanent component">{component.unit_id ?? "Unset: no unit ID recorded"}</Fact></dl>
  </div>)}</div>;
}

export function PhysicalInventoryWorkspace({ token, adminId }: { token: string; adminId: string }) {
  const [cardId, setCardId] = useState("");
  const [card, setCard] = useState<PhysicalInventoryCard | null>(null);
  const [action, setAction] = useState<PhysicalInventoryAction | null>(null);
  const [draft, setDraft] = useState(emptyPhysicalInventoryDraft);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PhysicalInventoryPending | null>(null);
  const [rejected, setRejected] = useState(false);
  const [receipt, setReceipt] = useState<PhysicalInventoryReceipt | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const active = useRef(true);
  const pendingRef = useRef<PhysicalInventoryPending | null>(null);
  const submitLock = useRef(false);
  const uncertainAttempt = useRef(false);
  const readAttempt = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const storageKey = `ten-kings:physical-inventory:pending:${adminId}`;

  useEffect(() => {
    active.current = true;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const recovered = physicalInventoryPendingSchema.parse(JSON.parse(saved));
        if (recovered.adminId !== adminId) throw new Error("Unmatched admin");
        pendingRef.current = recovered;
        uncertainAttempt.current = true;
        setPending(recovered);
        setCardId(recovered.command.card_id);
        setMessage("A submitted request is awaiting confirmation. Load this card’s history or retry the exact saved evidence.");
      }
      setStorageReady(true);
    } catch {
      setStorageError("The saved retry record could not be read or verified. It has been preserved; no new request can be sent from this page.");
    }
    return () => {
      active.current = false;
      readAttempt.current += 1;
      readController.current?.abort();
      writeController.current?.abort();
    };
  }, [adminId, storageKey]);

  useEffect(() => {
    if (!pending) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [pending]);

  const savePending = (value: PhysicalInventoryPending | null) => {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    pendingRef.current = value;
    setPending(value);
  };
  const acceptReceipt = (value: PhysicalInventoryReceipt) => {
    setReceipt(value);
    try { savePending(null); }
    catch { setStorageError("The accepted receipt is shown, but the saved retry record could not be cleared. Reloading may replay the same accepted event."); }
    setRejected(false);
    setAction(null);
    setDraft(emptyPhysicalInventoryDraft());
  };

  async function loadCard(id = cardId) {
    if (submitLock.current) return;
    const exactId = id.trim();
    if (!exactId || exactId.length > 200) { setMessage("Enter the exact permanent card ID (maximum 200 characters)."); return; }
    if (pendingRef.current && pendingRef.current.command.card_id !== exactId) { setMessage("Resolve the saved request for its exact card before starting another card."); return; }
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const attempt = ++readAttempt.current;
    const timer = window.setTimeout(() => controller.abort(), 25000);
    setLoading(true);
    setCard(null);
    setMessage("");
    try {
      const response = await fetch(`/api/v2/admin/inventory/card?card_id=${encodeURIComponent(exactId)}`, {
        headers: buildAdminHeaders(token), cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new PhysicalInventoryInputError(physicalInventoryApiMessage(response.status));
      const result = physicalInventoryCardSchema.safeParse(await response.json());
      if (!result.success || result.data.card.id !== exactId) throw new PhysicalInventoryInputError("The card response could not be verified. No actions are available until its evidence loads correctly.");
      if (!active.current || attempt !== readAttempt.current) return;
      const waiting = pendingRef.current;
      if (waiting) {
        const entry = result.data.history.find((item) => item.request_id === waiting.command.request_id);
        if (entry) {
          const expectedId = await physicalInventoryRequestEventId(waiting.command.request_id);
          if (!physicalInventoryHistoryMatches(entry, waiting, expectedId)) throw new PhysicalInventoryInputError("The saved request conflicts with its accepted history. Preserve the retry record for review.");
          if (!active.current || attempt !== readAttempt.current) return;
          acceptReceipt({ outcome: "REPLAY", event: entry.event });
        }
      }
      setCard(result.data);
      setCardId(exactId);
    } catch (error) {
      if (active.current && attempt === readAttempt.current) setMessage(controller.signal.aborted
        ? "Card loading stopped. Load again to obtain current recorded evidence."
        : error instanceof PhysicalInventoryInputError ? error.message : "The card evidence could not be loaded or verified.");
    } finally {
      window.clearTimeout(timer);
      if (active.current && attempt === readAttempt.current) setLoading(false);
    }
  }

  async function sendPending(value: PhysicalInventoryPending) {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setRejected(false);
    setMessage("");
    readController.current?.abort();
    const controller = new AbortController();
    writeController.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 25000);
    let accepted = false;
    let definiteRejection = false;
    try {
      const expectedId = await physicalInventoryRequestEventId(value.command.request_id);
      const response = await fetch("/api/v2/admin/inventory/events", {
        method: "POST", headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(value.command), cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        if (active.current && !uncertainAttempt.current && [400, 401, 403, 405, 409].includes(response.status)) { definiteRejection = true; setRejected(true); }
        else uncertainAttempt.current = true;
        throw new PhysicalInventoryInputError(physicalInventoryApiMessage(response.status));
      }
      const result = physicalInventoryReceiptSchema.safeParse(await response.json());
      if (!result.success || !physicalInventoryReceiptMatches(result.data.event, value, expectedId)) {
        uncertainAttempt.current = true;
        throw new PhysicalInventoryInputError("The response did not prove acceptance of this exact request. Its original evidence and retry identity are retained.");
      }
      if (!active.current) return;
      acceptReceipt(result.data);
      accepted = true;
    } catch (error) {
      if (!definiteRejection) uncertainAttempt.current = true;
      if (active.current) setMessage(controller.signal.aborted
        ? "The request stopped before its result was confirmed. It may have been recorded. Load history or retry the exact saved request."
        : error instanceof PhysicalInventoryInputError ? error.message : "Acceptance is uncertain. The original request is retained for retry.");
    } finally {
      window.clearTimeout(timer);
      submitLock.current = false;
      if (active.current) {
        setSubmitting(false);
        if (accepted) void loadCard(value.command.card_id);
      }
    }
  }

  function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!card || !action || pendingRef.current || submitLock.current || loading || !storageReady || storageError) return;
    try {
      const command = buildPhysicalInventoryCommand({ card, action, draft, requestId: crypto.randomUUID() });
      const value: PhysicalInventoryPending = { version: 1, adminId, action, command };
      savePending(value); // Durable retry identity is established before the POST.
      uncertainAttempt.current = false;
      void sendPending(value);
    } catch (error) {
      setMessage(error instanceof PhysicalInventoryInputError ? error.message : "The browser could not preserve this request’s retry identity. No request was sent.");
    }
  }

  function editRejectedDraft() {
    if (!rejected || submitLock.current || uncertainAttempt.current) return;
    try { savePending(null); setRejected(false); void loadCard(); }
    catch { setMessage("The rejected request could not be cleared from browser storage."); }
  }
  function chooseAction(next: PhysicalInventoryAction) {
    if (pendingRef.current || submitting || loading) return;
    setAction(next); setDraft(emptyPhysicalInventoryDraft()); setMessage(""); setReceipt(null);
  }
  const update = <K extends keyof PhysicalInventoryDraft>(key: K, value: PhysicalInventoryDraft[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  const field = (key: Exclude<keyof PhysicalInventoryDraft, "paymentSucceeded" | "dispatched" | "physicallyReturned" | "refundCompleted">, label: string, help?: string, maxLength = 2000) =>
    <Field label={label} help={help}><input className={inputClass} value={draft[key]} maxLength={maxLength} autoComplete="off" onChange={(event) => update(key, event.target.value as PhysicalInventoryDraft[typeof key])} /></Field>;
  const select = (key: "receiptKind" | "custodyKind" | "costKind" | "movementKind" | "saleAmountKind", label: string, choices: [string, string][]) =>
    <Field label={label}><select className={inputClass} value={draft[key]} onChange={(event) => update(key, event.target.value as PhysicalInventoryDraft[typeof key])}><option value="">Choose…</option>{choices.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>;
  const productFields = <div className="grid gap-4 sm:grid-cols-2">{field("productId", action === "pack" ? "Packed product ID" : "Loose-card product ID", "Use the exact source product definition. Price or card name alone is not its identity.", 200)}{field("productEvidenceRef", "Product definition evidence", "Reuse the same evidence reference whenever this product ID is used.")}</div>;
  const destinationFields = <div className="space-y-4">
    {!!card?.bindings.length && <Field label="Reuse a recorded custody binding"><select className={inputClass} value="" onChange={(event) => {
      const binding = card.bindings.find((entry) => entry.custody_id === event.target.value);
      if (!binding) return;
      const delimiter = binding.custody_id.indexOf(":");
      setDraft((previous) => ({ ...previous, custodyKind: binding.custody_id.slice(0, delimiter) as "warehouse" | "machine", custodyExternalId: binding.custody_id.slice(delimiter + 1), locationId: binding.location_id, custodyEvidenceRef: binding.evidence_ref }));
    }}><option value="">Select an accepted binding, or enter a new one below…</option>{card.bindings.map((binding) => <option value={binding.custody_id} key={binding.custody_id}>{binding.custody_id} · {binding.location_id}</option>)}</select></Field>}
    <div className="grid gap-4 sm:grid-cols-2">{select("custodyKind", "Destination custody", [["warehouse", "Warehouse"], ["machine", "Machine"]])}{field("custodyExternalId", "External warehouse / machine ID", "The exact external ID, without the machine: or warehouse: prefix. Multiple machines may share a Location.", 200)}<Field label="Existing Location" help={draft.locationId ? `Selected UUID: ${draft.locationId}` : "Choose the existing platform Location supported by your custody evidence."}><select className={inputClass} value={draft.locationId} onChange={(event) => update("locationId", event.target.value)}><option value="">Choose a Location…</option>{card?.locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.slug} · {location.id}</option>)}</select></Field>{field("custodyEvidenceRef", "Custody-to-Location evidence", "This binding is immutable. Reuse its accepted evidence when moving back to this custody ID.")}</div>
  </div>;
  const adjustmentAction = action === "return" || action === "refund" ? action : null;
  const selectedSale = card?.history.find((entry) => entry.event.source_event_id === draft.originalSaleId && entry.event.event_kind === "sale");
  const selectedBalance = card?.sales.find((entry) => entry.source_event_id === draft.originalSaleId);
  const originalSaleFields = adjustmentAction && card && <section className="space-y-4">
    <Field label="Original completed sale" help="Choose the exact sale identified by the return or refund evidence. Nothing is selected automatically."><select className={inputClass} value={draft.originalSaleId} onChange={(event) => update("originalSaleId", event.target.value)}><option value="">Choose the original sale…</option>{[...card.sales].reverse().map((balance) => {
      const original = card.history.find((entry) => entry.event.source_event_id === balance.source_event_id);
      return <option key={balance.source_event_id} value={balance.source_event_id} disabled={!balance[`${adjustmentAction}_available`]}>{original?.event.external_sale_id} · #{original?.event.source_sequence} · {original?.event.effective_at}{!balance[`${adjustmentAction}_available`] ? " · unavailable" : ""}</option>;
    })}</select></Field>
    {selectedSale && selectedBalance && <div className="space-y-4 rounded-xl border border-white/10 p-4"><dl className="grid gap-4 sm:grid-cols-2"><Fact label="Original sale source ID">{selectedSale.event.source_event_id}</Fact><Fact label="Original payment / dispatch">{selectedSale.fulfilment?.payment_reference ?? "Unset: payment reference unavailable"} / {selectedSale.event.external_sale_id}</Fact><Fact label="Original sale evidence">{selectedSale.event.evidence_ref}</Fact><Fact label="Original fulfilment evidence">{selectedSale.fulfilment?.evidence_ref ?? "Unset: fulfilment evidence unavailable"}</Fact><Fact label="Original gross / money remaining">{physicalInventoryMoney(selectedSale.event.sale_gross_cents)} / {physicalInventoryMoney(selectedBalance.remaining_refund_cents)}</Fact><Fact label="Original units remaining to return">{selectedBalance.remaining_return_quantity}</Fact></dl>{adjustmentAction === "return" && <><p className="break-words text-sm text-white/65">Return exactly {selectedSale.event.unit_or_pack_id} · stock {selectedSale.event.stock_id}. The original product and acquisition components below will be restored unchanged.</p><CostEvidence event={selectedSale.event} /></>}</div>}
  </section>;

  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 text-white sm:px-7">
    <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Ten Kings · Physical inventory</p><h1 className="mt-2 text-3xl font-semibold">Follow one card.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">Load its permanent identity, inspect recorded custody and acquisition cost, then capture the next completed physical event or money refund.</p></div><Link className={buttonClass} href="/admin/ai-grader-v2/completed">Completed cards →</Link></header>
    <p className="rounded-lg border-l-2 border-amber-300 bg-amber-300/5 px-4 py-3 text-sm text-amber-100/90">Physical source evidence is provisional for financial reporting. Ledger reconciliation and the Financial Story remain separate.</p>
    <form className={`${panelClass} flex flex-wrap items-end gap-4`} onSubmit={(event) => { event.preventDefault(); void loadCard(); }}>
      <div className="min-w-0 flex-1"><Field label="Exact permanent card ID" help="Copy the permanent card ID from its completed-card workspace. No card name, certificate, or approximate match is used."><input className={inputClass} name="cardId" maxLength={200} value={cardId} disabled={submitting || !!pending} onChange={(event) => {
        readController.current?.abort(); readAttempt.current += 1; setLoading(false); setCardId(event.target.value); setCard(null); setAction(null); setReceipt(null);
      }} autoComplete="off" /></Field></div>
      <button className={buttonClass} type="submit" disabled={loading || submitting}>{loading ? "Loading…" : "Load recorded history"}</button>
      {loading && <button className={buttonClass} type="button" onClick={() => readController.current?.abort()}>Cancel load</button>}
    </form>
    {!!storageError && <p role="alert" className="rounded-lg border border-red-300/40 p-4 text-sm text-red-200">{storageError}</p>}
    {!!message && <p role="status" aria-live="polite" className="rounded-lg border border-amber-300/30 p-4 text-sm text-amber-100">{message}</p>}
    {receipt && <section className="rounded-2xl border border-emerald-300/30 bg-emerald-300/5 p-5" aria-label="Accepted inventory receipt"><h2 className="font-semibold text-emerald-200">{receipt.outcome === "RECORDED" ? "Recorded by the source" : "Previously recorded — exact retry confirmed"}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-3"><Fact label="Event type">{receipt.event.event_kind}</Fact><Fact label="Source sequence">{receipt.event.source_sequence}</Fact><Fact label="Recorded by">{receipt.event.recorded_by}</Fact><Fact label="Recorded at (UTC)">{receipt.event.recorded_at}</Fact><Fact label="Event ID">{receipt.event.source_event_id}</Fact><Fact label="Event evidence">{receipt.event.evidence_ref}</Fact><Fact label="Effective at (UTC)">{receipt.event.effective_at}</Fact>{receipt.event.reverses_source_event_id && <Fact label="Original source event">{receipt.event.reverses_source_event_id}</Fact>}{receipt.event.event_kind === "refund" && <Fact label="Recorded money refund">{physicalInventoryMoney(receipt.event.sale_gross_cents)} · {receipt.event.external_sale_id}</Fact>}</dl></section>}
    {pending && <section className={`${panelClass} space-y-4 border-amber-300/30`} aria-label="Pending inventory request"><h2 className="font-semibold text-amber-200">{submitting ? "Waiting for the recorded receipt…" : rejected ? "Request rejected — evidence retained" : "Request awaiting confirmation"}</h2><p className="text-sm leading-6 text-white/65">{actionLabels[pending.action]} · {pending.command.card_id}<br />Request identity: <span className="break-all font-mono">{pending.command.request_id}</span></p><p className="text-sm text-white/65">An interrupted request may already be recorded. Retry sends the same evidence and identity; loading history checks whether it was accepted.</p><div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={submitting || loading} onClick={() => void sendPending(pending)}>Retry exact request</button>{submitting && <button className={buttonClass} onClick={() => writeController.current?.abort()}>Stop waiting</button>}{rejected && <button className={buttonClass} disabled={submitting || loading} onClick={editRejectedDraft}>Return to rejected draft</button>}</div><details><summary className="cursor-pointer text-sm text-white/65">Submitted audit details</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-3 text-xs">{JSON.stringify(pending.command, null, 2)}</pre></details></section>}
    {card && <>
      <div className="grid gap-6 lg:grid-cols-2"><section className={panelClass}><p className="text-xs uppercase tracking-wider text-amber-200">Permanent card</p><h2 className="mt-2 text-xl font-semibold">{card.card.cardName ?? card.card.playerName ?? "Unset: identity name missing"}</h2><p className="mt-2 text-sm text-white/60">{card.card.year} · {card.card.productSet}{card.card.cardNumber ? ` · ${card.card.cardNumber}` : ""}</p><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Fact label="Card ID">{card.card.id}</Fact><Fact label="Category / parallel">{card.card.category} / {card.card.parallel ?? "Unset: no parallel recorded"}</Fact><Fact label="Recorded owner / lifecycle">{card.card.currentOwnerType} / {card.card.lifecycleState}</Fact><Fact label="Current Location UUID">{card.card.locationId ?? "Unset: no current Location recorded"}</Fact></dl><div className="mt-5 flex flex-wrap gap-4 text-sm text-amber-200"><Link href={`/admin/ai-grader-v2/completed/${encodeURIComponent(card.card.speedsterSessionId)}`}>Completed-card workspace →</Link><Link href={`/c/${encodeURIComponent(card.card.publicToken)}`}>Permanent card page →</Link></div></section>
      <section className={panelClass}><h2 className="text-lg font-semibold">Current recorded stock</h2>{card.position ? <><dl className="my-4 grid gap-4 sm:grid-cols-2"><Fact label="Held quantity">{card.position.quantity} {card.position.origin.event_kind === "pack" ? "one-card pack" : "loose card"}</Fact><Fact label="Custody">{card.position.custody_id}</Fact><Fact label="Unit / physical pack ID">{card.position.origin.unit_or_pack_id}</Fact><Fact label="Product">{card.position.origin.external_product_id}</Fact><Fact label="Product evidence">{card.position.product_identity_ref}</Fact><Fact label="Custody evidence">{card.position.binding.evidence_ref}</Fact></dl><CostEvidence event={card.position.origin} /></> : <p className="mt-4 text-sm leading-6 text-white/60">{card.history.length ? "No stock remains in recorded house custody. Inspect the original sale and accepted history before recording a return or a new acquisition." : "Unset: no physical inventory events have been recorded for this card. Its existing lifecycle alone does not establish acquisition cost or stock."}</p>}</section></div>
      {card.actions.reason && <p className="rounded-lg border border-amber-300/30 p-4 text-sm text-amber-100">{card.actions.reason}</p>}
      {!!card.sales.length && <section className={panelClass} aria-label="Original sale balances"><h2 className="text-lg font-semibold">Original sale balances</h2><p className="mt-2 text-sm leading-6 text-white/60">Returning a card restores its original stock and cost. Refunding money changes only the sale amount. Record each completed event separately; reversed adjustments are excluded from these balances.</p><ul className="mt-4 space-y-4">{[...card.sales].reverse().map((balance) => {
        const original = card.history.find((entry) => entry.event.source_event_id === balance.source_event_id);
        return <li key={balance.source_event_id} className="rounded-xl border border-white/10 p-4"><h3 className="break-words text-sm font-semibold">Sale #{original?.event.source_sequence} · {original?.event.external_sale_id}{balance.reversed ? " · reversed" : ""}</h3><p className="mt-1 break-all text-xs text-white/50">{balance.source_event_id}</p><dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Fact label="Card returned / remaining">{balance.returned_quantity} / {balance.remaining_return_quantity}</Fact><Fact label="Original gross">{physicalInventoryMoney(original?.event.sale_gross_cents ?? null)}</Fact><Fact label="Money refunded">{physicalInventoryMoney(balance.refunded_cents)}</Fact><Fact label="Money remaining">{physicalInventoryMoney(balance.remaining_refund_cents)}</Fact></dl>{balance.return_reason && <p className="mt-3 text-xs leading-5 text-white/55">Physical return: {balance.return_reason}</p>}{balance.refund_reason && <p className="mt-2 text-xs leading-5 text-white/55">Money refund: {balance.refund_reason}</p>}</li>;
      })}</ul></section>}
      <section className={panelClass} aria-label="Capture physical evidence"><h2 className="text-lg font-semibold">Record the next completed event</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(Object.keys(actionLabels) as PhysicalInventoryAction[]).map((value) => <button type="button" key={value} className={`${buttonClass} ${action === value ? "border-amber-300 bg-amber-300/10 text-amber-100" : ""}`} aria-pressed={action === value} disabled={!card.actions[value] || !!pending || submitting || loading} onClick={() => chooseAction(value)}>{actionLabels[value]}</button>)}</div><p className="mt-3 text-xs leading-5 text-white/55">Packing requires recorded loose stock. Selling requires machine custody. Return and refund availability follows each original sale’s remaining evidence and the card’s current state.</p>
      {action && !pending && <form className="mt-6 space-y-6" onSubmit={record} noValidate>
        <p className="text-sm leading-6 text-white/65">{actionDescriptions[action]}</p>
        <fieldset disabled={submitting || loading} className="space-y-6">
          {action === "receive" && <>
            {card.card.currentOwnerType === "EXTERNAL" && <p className="rounded-lg border border-amber-300/30 p-4 text-sm leading-6 text-amber-100">This card left house ownership. Use this form only for a newly documented acquisition and a new cost cycle. Use Physical return for the original sold card and Money refund for completed refunds; those actions preserve the original acquisition cost.</p>}
            {select("receiptKind", "Acquisition record type", [["receipt", "Receipt — new evidenced acquisition"], ["opening", "Opening — sourced stock at a coverage start"]])}
            {productFields}
            {field("ownershipEvidenceRef", "House ownership evidence", "Evidence that Ten Kings owns this exact card in this acquisition cycle.")}
            <section className="space-y-4"><h3 className="font-semibold">Acquisition and cost</h3><div className="grid gap-4 sm:grid-cols-3">{field("acquisitionId", "Invoice / acquisition ID", undefined, 200)}{field("lotId", "Acquisition lot ID", undefined, 200)}{field("cycleId", "Acquisition cycle ID", "Use the sourced cycle for this new acquisition. A customer return preserves its original cycle through the source return operation, not a new receipt.", 200)}</div>
              {select("costKind", "Acquisition cost basis", [["documented_unit", "Documented cost for this card"], ["allocated_acquisition", "Documented acquisition allocation to this card"], ["unknown", "Unknown — retain a reason"]])}
              {draft.costKind && draft.costKind !== "unknown" && field("costUsd", "Acquisition cost (USD)", "Exact dollars and cents for this card. A documented zero is allowed. No currency conversion or rounding.")}
              {draft.costKind === "unknown" && field("unknownReason", "Why acquisition cost is unknown")}
              {field("costEvidenceRef", "Acquisition cost evidence", "Document and line reference, including any allocation calculation or the evidence gap. Market value, tier price, and expected margin are not acquisition cost.")}
            </section><section className="space-y-4"><h3 className="font-semibold">Received into custody</h3>{destinationFields}</section>
          </>}
          {action === "pack" && <>{field("packId", "Exact physical pack ID", "The evidenced identity of this one-card physical pack. This action does not print, program, or create a sales-engine pack.", 200)}{productFields}</>}
          {action === "move" && <>{select("movementKind", "Movement type", [["transfer", "Transfer between custody positions"], ["restock", "Restock into a machine"]])}<section className="space-y-4"><h3 className="font-semibold">Completed destination</h3>{destinationFields}</section></>}
          {adjustmentAction && originalSaleFields}
          {action === "return" && <>
            <p className="rounded-lg border border-amber-300/20 p-4 text-sm leading-6 text-amber-100">This records one physically returned original card/pack and its house ownership. Any completed money refund needs its own Money refund record. A replacement card, changed pack contents or a new acquisition cannot be substituted here.</p>
            {field("correctionReason", "Physical return reason", "Explain the evidenced return against this original sale.")}
            {field("ownershipEvidenceRef", "Returned house ownership evidence", "Evidence that Ten Kings has regained title to this exact original card/pack.")}
            <section className="space-y-4"><h3 className="font-semibold">Physically returned into custody</h3>{destinationFields}</section>
            <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1.5" type="checkbox" checked={draft.physicallyReturned} onChange={(event) => update("physicallyReturned", event.target.checked)} />I verified that the exact original card/pack was physically received at the stated destination.</label>
          </>}
          {action === "refund" && <>
            <p className="rounded-lg border border-amber-300/20 p-4 text-sm leading-6 text-amber-100">This captures a completed money refund in source history. It does not send money. Card custody, ownership and original acquisition cost stay unchanged; a physical return requires its own Physical return record.</p>
            <div className="grid gap-4 sm:grid-cols-2">{field("refundReference", "Completed refund identity", "The exact completed refund transaction or refund record. A pending refund or payment intent is not completion evidence.", 200)}{field("refundUsd", "Completed refund amount (USD)", selectedBalance ? `Enter the actual positive amount from the refund record. Remaining documented gross: ${physicalInventoryMoney(selectedBalance.remaining_refund_cents)}.` : "Enter the actual positive amount from the refund record. Choose its original sale to see the remaining documented gross.")}</div>
            {field("correctionReason", "Refund reason", "Explain why this money refund was made against the original sale.")}
            <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1.5" type="checkbox" checked={draft.refundCompleted} onChange={(event) => update("refundCompleted", event.target.checked)} />I verified that the referenced money refund completed for the entered amount.</label>
          </>}
          {action === "sale" && <>
            <div className="rounded-lg border border-amber-300/20 p-4 text-sm leading-6 text-amber-100">This records an evidenced physical sale. It does not charge a payment or issue a hardware dispatch.</div>
            <div className="grid gap-4 sm:grid-cols-2">{field("paymentReference", "Successful payment reference", "An exact reference from the completed payment record.", 200)}{field("dispatchReference", "Completed dispatch identity", "The exact sale/fulfilment record identifying this card’s physical dispatch.", 200)}</div>
            {field("fulfilmentEvidenceRef", "Payment and dispatch evidence", "Evidence proving successful payment and completed physical delivery of this exact card/pack.")}
            {select("saleAmountKind", "Sale gross evidence", [["known", "Exact gross amount is documented"], ["unknown", "Amount is unknown — preserve the gap"]])}
            {draft.saleAmountKind === "known" && field("saleUsd", "Recorded sale gross (USD)", "Actual gross from the completed sale, not a price suggestion. Maximum $21,474,836.47.")}
            {draft.saleAmountKind === "unknown" && <p className="text-sm text-amber-200">Sale gross will remain unknown. Include the amount evidence gap in the physical event reference; no amount is inferred from the product.</p>}
            <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1.5" type="checkbox" checked={draft.paymentSucceeded} onChange={(event) => update("paymentSucceeded", event.target.checked)} />I verified that the referenced payment succeeded.</label>
            <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1.5" type="checkbox" checked={draft.dispatched} onChange={(event) => update("dispatched", event.target.checked)} />I verified that this exact card/pack was physically dispatched to the buyer.</label>
          </>}
          {["pack", "move", "sale"].includes(action) && card.position && <section className="space-y-3 rounded-xl bg-white/[0.025] p-4"><h3 className="text-sm font-semibold">Acquisition components carried unchanged</h3><p className="break-all text-xs text-white/55">From {card.position.custody_id} · stock {card.position.origin.stock_id}</p><CostEvidence event={card.position.origin} /></section>}
          <section className="grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-2">{field("effectiveAt", action === "refund" ? "Completed refund time (UTC)" : "Physical event time (UTC)", "Use the evidenced time, in YYYY-MM-DDTHH:mm:ss.sssZ format. Recording time and admin identity come from the server.", 24)}{field("evidenceRef", action === "refund" ? "Completed refund evidence" : "Physical event evidence", action === "refund" ? "The transaction or document proving this refund completed for the exact original sale and stated amount." : "The document, row, invoice, count sheet, packing record, return receipt, or completed dispatch that proves this event.")}</section>
          <div className="flex flex-wrap gap-3"><button type="submit" className={`${buttonClass} border-amber-300/60 bg-amber-300/10 text-amber-100`} disabled={!storageReady || !!storageError}>Record {actionLabels[action].toLowerCase()}</button><button type="button" className={buttonClass} onClick={() => { setAction(null); setDraft(emptyPhysicalInventoryDraft()); }}>Cancel draft</button></div>
        </fieldset>
      </form>}
      </section>
      <section className={panelClass} aria-label="Accepted physical inventory history">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">Accepted history</h2><span className="text-xs text-white/55">{card.history.length} source event{card.history.length === 1 ? "" : "s"} · sequence order</span></div>
        {!card.history.length ? <p className="mt-4 text-sm text-white/55">No source events recorded.</p> : <ol className="mt-5 divide-y divide-white/10">{[...card.history].reverse().map((entry) => <li className="py-4 first:pt-0" key={entry.event.source_event_id}><details>
          <summary className="cursor-pointer"><span className="mr-3 text-xs text-amber-200">#{entry.event.source_sequence}</span><strong className="capitalize">{entry.event.event_kind}</strong><time className="mt-1 block text-xs text-white/60 sm:ml-3 sm:inline">{entry.event.effective_at}</time><span className="mt-2 block break-words text-sm text-white/65">{entry.event.quantity === 0 ? <>{physicalInventoryMoney(entry.event.sale_gross_cents)} · money adjustment only</> : <>{entry.event.from_custody_id ?? "Outside recorded custody"} → {entry.event.to_custody_id ?? "Outside recorded custody"}</>}</span></summary>
          <div className="mt-4 space-y-4"><dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Event evidence">{entry.event.evidence_ref}</Fact><Fact label="Source event ID">{entry.event.source_event_id}</Fact>
            <Fact label="Recorded by / at (UTC)">{entry.event.recorded_by} · {entry.event.recorded_at}</Fact><Fact label="Product identity">{entry.event.external_product_id} · {entry.product_identity_ref}</Fact>
            {entry.ownership_evidence_ref && <Fact label="Ownership evidence">{entry.ownership_evidence_ref}</Fact>}
            {entry.fulfilment && <><Fact label="Payment / completed dispatch">{entry.fulfilment.payment_reference} / {entry.fulfilment.dispatch_reference}</Fact><Fact label="Fulfilment evidence">{entry.fulfilment.evidence_ref}</Fact><Fact label="Recorded sale gross">{physicalInventoryMoney(entry.event.sale_gross_cents)}</Fact></>}
            {entry.event.reverses_source_event_id && <Fact label="Original source event">{entry.event.reverses_source_event_id}</Fact>}
            {entry.event.quantity === 0 && <Fact label="Money adjustment / transaction">{physicalInventoryMoney(entry.event.sale_gross_cents)} · {entry.event.external_sale_id}</Fact>}
            {entry.event.correction_reason && <Fact label="Correction reason">{entry.event.correction_reason}</Fact>}
          </dl><CostEvidence event={entry.event} /><details><summary className="cursor-pointer text-xs text-white/55">Full accepted audit details</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-3 text-xs">{JSON.stringify(entry, null, 2)}</pre></details></div>
        </details></li>)}</ol>}
      </section>
    </>}
  </main>;
}

export default function PhysicalInventoryPage() {
  const { session, loading, ensureSession } = useSession();
  const [inventoryMode, setInventoryMode] = useState<"workflow" | "exact">("workflow");
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  return <AppShell background="black" hideFooter><Head><title>Physical inventory | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>{loading ? <p className="p-8 text-white/65">Loading admin session…</p> : !session ? <div className="p-8"><button className={buttonClass} onClick={() => void ensureSession()}>Sign in to physical inventory</button></div> : !isAdmin ? <p className="p-8 text-white/65">Human admin access is required.</p> : <div className="mx-auto max-w-7xl space-y-5 px-4 py-8"><nav className="flex flex-wrap gap-3"><Link href="/admin" className={buttonClass}>Admin home</Link><button className={buttonClass} onClick={() => setInventoryMode("workflow")}>Purchased lots / batches</button><button className={buttonClass} onClick={() => setInventoryMode("exact")}>Exact permanent-card evidence</button></nav>{inventoryMode === "workflow" ? <InventoryWorkflowWorkspace key={session.user.id} token={session.token} adminId={session.user.id} /> : <PhysicalInventoryWorkspace key={session.user.id} token={session.token} adminId={session.user.id} />}</div>}</AppShell>;
}
