import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import type { CardInventoryCommandV2 } from "@tenkings/database";
import { fixtureAdminId, fixtureEmptyCard, fixtureHeldCard, fixtureReceiptCommand, fixtureEvent, fixtureSoldCard,
  fixtureReturnDraft, fixtureRefundDraft, fixtureHistoryEntry, fixtureWarehouse } from "./physicalInventoryFixtures";
import { buildPhysicalInventoryCommand, type PhysicalInventoryCard, type PhysicalInventoryPending } from "../lib/physicalInventory";

const { JSDOM } = require("jsdom") as { JSDOM: new (...args: any[]) => any };
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { PhysicalInventoryWorkspace } = require("../pages/admin/physical-inventory") as typeof import("../pages/admin/physical-inventory");
const storageKey = `ten-kings:physical-inventory:pending:${fixtureAdminId}`;
const token = "isolated-human-session";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  assert.ok(predicate(), "Expected UI did not settle");
}

async function mount(fetchImpl: typeof fetch, saved?: PhysicalInventoryPending) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://isolated.invalid/admin/physical-inventory", pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  set("self", dom.window); set("window", dom.window); set("document", dom.window.document); set("navigator", dom.window.navigator);
  set("sessionStorage", dom.window.sessionStorage); set("fetch", fetchImpl); set("IS_REACT_ACT_ENVIRONMENT", true);
  if (saved) dom.window.sessionStorage.setItem(storageKey, JSON.stringify(saved));
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => root.render(<PhysicalInventoryWorkspace token={token} adminId={fixtureAdminId} />));
  return {
    dom, container,
    async input(label: string, value: string) {
      const wrapper = Array.from(container.querySelectorAll("label")).find((node) => node.firstChild?.textContent === label);
      assert.ok(wrapper, `Missing field ${label}`);
      const control = wrapper.querySelector("input,select")!;
      await act(async () => Simulate.change(control, { target: { value } } as unknown as Parameters<typeof Simulate.change>[1]));
    },
    async check(label: string) {
      const wrapper = Array.from(container.querySelectorAll("label")).find((node) => node.textContent === label);
      assert.ok(wrapper, `Missing checkbox ${label}`);
      const control = wrapper.querySelector('input[type="checkbox"]')!;
      await act(async () => Simulate.change(control, { target: { checked: true } } as unknown as Parameters<typeof Simulate.change>[1]));
    },
    button(text: string) { const element = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === text); assert.ok(element, `Missing button ${text}`); return element; },
    async click(text: string) { const button = this.button(text); assert.equal(button.disabled, false, `${text} is disabled`); await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); },
    async close() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    },
  };
}

function receivedCard(command: CardInventoryCommandV2): PhysicalInventoryCard {
  const card = fixtureHeldCard(); const event = fixtureEvent(command);
  card.history[0] = { request_id: command.request_id, event, product_identity_ref: command.product_identity_ref,
    custody_bindings: command.custody_bindings, ownership_evidence_ref: command.ownership_evidence_ref, fulfilment: null };
  card.position!.origin = event;
  return card;
}

async function completeReceiptFields(ui: Awaited<ReturnType<typeof mount>>) {
  await ui.click("Receive / opening");
  for (const [label, value] of [
    ["Acquisition record type", "receipt"], ["Loose-card product ID", "isolated-loose-product"], ["Product definition evidence", "fixture:loose-definition"],
    ["House ownership evidence", "fixture:ownership"], ["Invoice / acquisition ID", "isolated-invoice"], ["Acquisition lot ID", "isolated-lot"],
    ["Acquisition cycle ID", "isolated-cycle"], ["Acquisition cost basis", "documented_unit"], ["Acquisition cost (USD)", "12.01"],
    ["Acquisition cost evidence", "fixture:invoice-row"], ["Destination custody", "warehouse"], ["External warehouse / machine ID", "isolated-a"],
    ["Existing Location", "11111111-1111-4111-8111-111111111111"], ["Custody-to-Location evidence", "fixture:warehouse-binding"],
    ["Physical event time (UTC)", "2026-01-01T00:00:00.000Z"], ["Physical event evidence", "fixture:receipt"],
  ]) await ui.input(label, value);
}

test("guided receipt prevents double sends, preserves uncertain retry identity and accepts only its verified receipt", async () => {
  const posts: string[] = [];
  let recorded: CardInventoryCommandV2 | null = null;
  const ui = await mount(async (url, init) => {
    assert.equal(init?.cache, "no-store");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    if (String(url).includes("/card?")) return json(recorded ? receivedCard(recorded) : fixtureEmptyCard());
    posts.push(String(init?.body));
    if (posts.length === 1) throw new TypeError("isolated network failure");
    if (posts.length === 2) return json({ code: "UNAUTHORIZED" }, 401);
    recorded = JSON.parse(posts[2]) as CardInventoryCommandV2;
    return json({ outcome: "RECORDED", event: fixtureEvent(recorded) });
  });
  try {
    assert.doesNotMatch(ui.container.textContent!, /\$12/);
    await ui.input("Exact permanent card ID", "isolated-card");
    await ui.click("Load recorded history");
    assert.match(ui.container.textContent!, /Unset: no physical inventory events/);
    assert.equal(ui.button("Completed sale").disabled, true);
    await completeReceiptFields(ui);
    const form = ui.button("Record receive / opening").closest("form")!;
    await act(async () => { form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })); form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    await until(() => posts.length === 1 && !!ui.container.textContent?.includes("Acceptance is uncertain"));
    assert.equal(posts.length, 1);
    assert.match(ui.container.textContent!, /Acceptance is uncertain/);
    const saved = JSON.parse(sessionStorage.getItem(storageKey)!);
    assert.equal(saved.command.event.components[0].cost_cents, 1201);
    assert.equal(saved.command.recorded_by, undefined);
    assert.equal(ui.container.querySelector('[aria-label="Accepted inventory receipt"]'), null);
    await ui.click("Retry exact request");
    await until(() => posts.length === 2 && !!ui.container.textContent?.includes("Sign in with a human admin"));
    assert.equal(posts[0], posts[1]);
    assert.doesNotMatch(ui.container.textContent!, /Return to rejected draft/);
    await ui.click("Retry exact request");
    await until(() => posts.length === 3 && !!ui.container.textContent?.includes("Recorded by the source") && !!ui.container.textContent?.includes("$12.01"));
    assert.equal(posts[0], posts[2]);
    assert.equal(sessionStorage.getItem(storageKey), null);
    assert.match(ui.container.textContent!, /Recorded by the source/);
    assert.match(ui.container.textContent!, /\$12\.01/);
    assert.equal(ui.container.querySelector('[aria-label="Pending inventory request"]'), null);
  } finally { await ui.close(); }
});

test("restored uncertain request is resolved by exact accepted history without resubmitting", async () => {
  const command = fixtureReceiptCommand();
  const saved: PhysicalInventoryPending = { version: 1, adminId: fixtureAdminId, action: "receive", command };
  let calls = 0;
  const ui = await mount(async (url, init) => { calls++; assert.notEqual(init?.method, "POST"); assert.match(String(url), /card_id=isolated-card/); return json(receivedCard(command)); }, saved);
  try {
    assert.match(ui.container.textContent!, /Request awaiting confirmation/);
    assert.equal((ui.container.querySelector('input[name="cardId"]') as HTMLInputElement).disabled, true);
    await ui.click("Load recorded history");
    await until(() => !!ui.container.textContent?.includes("Previously recorded"));
    assert.equal(calls, 1);
    assert.match(ui.container.textContent!, /Previously recorded — exact retry confirmed/);
    assert.equal(sessionStorage.getItem(storageKey), null);
  } finally { await ui.close(); }
});

test("changing exact card cancels the prior read and ignores its late response", async () => {
  const reads: { signal: AbortSignal; resolve(response: Response): void }[] = [];
  const ui = await mount(async (_url, init) => new Promise<Response>((resolve) => reads.push({ signal: init!.signal as AbortSignal, resolve })));
  try {
    await ui.input("Exact permanent card ID", "isolated-a");
    await ui.click("Load recorded history");
    await ui.input("Exact permanent card ID", "isolated-b");
    assert.equal(reads[0].signal.aborted, true);
    await ui.click("Load recorded history");
    const b = fixtureEmptyCard(); b.card.id = "isolated-b"; b.card.cardName = "Accepted fixture B";
    await act(async () => reads[1].resolve(json(b)));
    const a = fixtureEmptyCard(); a.card.id = "isolated-a"; a.card.cardName = "Stale fixture A";
    await act(async () => reads[0].resolve(json(a)));
    assert.match(ui.container.textContent!, /Accepted fixture B/);
    assert.doesNotMatch(ui.container.textContent!, /Stale fixture A/);
  } finally { await ui.close(); }
});

test("a malformed success payload never shows stock or write actions and hides raw response details", async () => {
  const ui = await mount(async () => new Response("RAW_SECRET_INVALID_JSON", { status: 200 }));
  try {
    await ui.input("Exact permanent card ID", "isolated-card");
    await ui.click("Load recorded history");
    assert.match(ui.container.textContent!, /could not be loaded or verified/);
    assert.doesNotMatch(ui.container.textContent!, /RAW_SECRET/);
    assert.equal(ui.container.querySelector('[aria-label="Capture physical evidence"]'), null);
  } finally { await ui.close(); }
});


test("a previously sold card explicitly distinguishes a new acquisition from a return or refund", async () => {
  const sold = fixtureSoldCard();
  const ui = await mount(async () => json(sold));
  try {
    await ui.input("Exact permanent card ID", sold.card.id); await ui.click("Load recorded history"); await ui.click("Receive / opening");
    assert.match(ui.container.textContent!, /newly documented acquisition and a new cost cycle/);
    assert.match(ui.container.textContent!, /Use Physical return for the original sold card and Money refund for completed refunds/);
    assert.match(ui.container.textContent!, /preserve the original acquisition cost/);
  } finally { await ui.close(); }
});

function adjustedCard(command: CardInventoryCommandV2): PhysicalInventoryCard {
  const card = fixtureSoldCard();
  card.history.push(fixtureHistoryEntry(command, 3));
  if (command.event.event_kind === "return") {
    card.card = { ...card.card, currentOwnerType: "HOUSE", lifecycleState: "IN_INVENTORY", locationId: fixtureWarehouse.location_id };
    card.position = { origin: card.history[0].event, quantity: 1, custody_id: fixtureWarehouse.custody_id,
      binding: fixtureWarehouse, product_identity_ref: command.product_identity_ref };
    card.bindings.push(fixtureWarehouse);
    Object.assign(card.sales[0], { returned_quantity: 1, remaining_return_quantity: 0, return_available: false, return_reason: "The original sold card has already been physically returned." });
    card.actions = { ...card.actions, receive: false, pack: true, move: true, return: false };
  } else {
    Object.assign(card.sales[0], { refunded_cents: command.event.sale_gross_cents!, remaining_refund_cents: 2501 - command.event.sale_gross_cents! });
  }
  return card;
}

test("guided physical return selects its sale explicitly and restores original cost only after verified receipt", async () => {
  const sold = fixtureSoldCard();
  let accepted: CardInventoryCommandV2 | null = null;
  let posts = 0;
  const ui = await mount(async (url, init) => {
    if (String(url).includes("/card?")) return json(accepted ? adjustedCard(accepted) : sold);
    posts++; accepted = JSON.parse(String(init?.body)) as CardInventoryCommandV2;
    return json({ outcome: "RECORDED", event: fixtureEvent(accepted, 3) });
  });
  try {
    await ui.input("Exact permanent card ID", sold.card.id); await ui.click("Load recorded history"); await ui.click("Physical return");
    assert.equal((ui.container.querySelector('select') as HTMLSelectElement).value, "");
    for (const [label, value] of [
      ["Original completed sale", sold.sales[0].source_event_id], ["Physical return reason", "Fixture buyer returned original card"],
      ["Returned house ownership evidence", "fixture:returned-title"], ["Destination custody", "warehouse"],
      ["External warehouse / machine ID", "isolated-a"], ["Existing Location", fixtureWarehouse.location_id],
      ["Custody-to-Location evidence", fixtureWarehouse.evidence_ref], ["Physical event time (UTC)", "2026-01-01T02:00:00.000Z"],
      ["Physical event evidence", "fixture:return-receipt"],
    ]) await ui.input(label, value);
    assert.equal(Array.from(ui.container.querySelectorAll("label")).some((node) => node.firstChild?.textContent === "Acquisition cost (USD)"), false);
    assert.match(ui.container.textContent!, /\$12\.01/);
    await ui.click("Record physical return");
    assert.equal(posts, 0); assert.match(ui.container.textContent!, /Verify that the exact original/);
    await ui.check("I verified that the exact original card/pack was physically received at the stated destination.");
    await ui.click("Record physical return");
    await until(() => !!ui.container.textContent?.includes("Recorded by the source") && ui.button("Physical return").disabled);
    assert.equal(posts, 1); assert.equal(sessionStorage.getItem(storageKey), null);
    assert.deepEqual(accepted!.event.components, sold.history.at(-1)!.event.components);
    assert.equal(accepted!.event.sale_gross_cents, null);
    assert.match(ui.container.textContent!, /HOUSE \/ IN_INVENTORY/);
    assert.equal(ui.button("Money refund").disabled, false);
  } finally { await ui.close(); }
});

test("guided money refund blocks excess amount and retains exact evidence after an unverified response", async () => {
  const sold = fixtureSoldCard();
  const posts: string[] = [];
  let accepted: CardInventoryCommandV2 | null = null;
  const ui = await mount(async (url, init) => {
    if (String(url).includes("/card?")) return json(accepted ? adjustedCard(accepted) : sold);
    posts.push(String(init?.body)); const command = JSON.parse(posts.at(-1)!) as CardInventoryCommandV2;
    if (posts.length === 1) return json({ outcome: "RECORDED", event: { ...fixtureEvent(command, 3), sale_gross_cents: 1000 } });
    accepted = command;
    return json({ outcome: "REPLAY", event: fixtureEvent(command, 3) });
  });
  try {
    await ui.input("Exact permanent card ID", sold.card.id); await ui.click("Load recorded history"); await ui.click("Money refund");
    assert.equal((ui.container.querySelector('select') as HTMLSelectElement).value, "");
    for (const [label, value] of [["Original completed sale", sold.sales[0].source_event_id], ["Completed refund identity", "isolated-refund"],
      ["Completed refund amount (USD)", "25.02"], ["Refund reason", "Fixture completed refund"],
      ["Completed refund time (UTC)", "2026-01-01T02:00:00.000Z"], ["Completed refund evidence", "fixture:completed-refund"]]) await ui.input(label, value);
    assert.equal(Array.from(ui.container.querySelectorAll("label")).some((node) => node.firstChild?.textContent === "Destination custody"), false);
    await ui.check("I verified that the referenced money refund completed for the entered amount.");
    await ui.click("Record money refund"); assert.equal(posts.length, 0);
    assert.match(ui.container.textContent!, /remaining documented gross/);
    await ui.input("Completed refund amount (USD)", "10.01");
    await ui.click("Record money refund");
    await until(() => !!ui.container.textContent?.includes("response did not prove acceptance"));
    assert.equal(ui.container.querySelector('[aria-label="Accepted inventory receipt"]'), null);
    const saved = JSON.parse(sessionStorage.getItem(storageKey)!) as PhysicalInventoryPending;
    assert.equal(saved.action, "refund"); assert.equal(saved.command.event.quantity, 0);
    assert.deepEqual(saved.command.event.components, []); assert.deepEqual(saved.command.custody_bindings, []);
    await ui.click("Retry exact request");
    await until(() => !!ui.container.textContent?.includes("Previously recorded") && !!ui.container.textContent?.includes("$15.00"));
    assert.equal(posts.length, 2); assert.equal(posts[0], posts[1]);
    assert.equal(sessionStorage.getItem(storageKey), null);
    assert.match(ui.container.textContent!, /EXTERNAL \/ EXTERNAL/);
    assert.equal(ui.button("Physical return").disabled, false);
  } finally { await ui.close(); }
});

test("saved return and refund requests recover through accepted history without issuing a new command", async () => {
  for (const action of ["return", "refund"] as const) {
    const command = buildPhysicalInventoryCommand({ requestId: `isolated-reload-${action}`, card: fixtureSoldCard(), action,
      draft: action === "return" ? fixtureReturnDraft() : fixtureRefundDraft() });
    const saved: PhysicalInventoryPending = { version: 1, adminId: fixtureAdminId, action, command };
    let reads = 0;
    const ui = await mount(async (_url, init) => { assert.notEqual(init?.method, "POST"); reads++; return json(adjustedCard(command)); }, saved);
    try {
      await ui.click("Load recorded history");
      await until(() => !!ui.container.textContent?.includes("Previously recorded"));
      assert.equal(reads, 1); assert.equal(sessionStorage.getItem(storageKey), null);
      assert.equal(ui.container.querySelector('[aria-label="Pending inventory request"]'), null);
    } finally { await ui.close(); }
  }
});
