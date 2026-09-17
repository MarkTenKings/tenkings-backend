import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
const { JSDOM } = require("jsdom");
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const source = readFileSync(new URL("../../../docs/plans/catalog-pilot-20260916/pokemon-complete-import.unreviewed.json", import.meta.url), "utf8");
const request = JSON.parse(source).requestDraft;
const router = { isReady: true, query: {}, pathname: "/admin/set-ops-review", replace: async () => true };
const restored: Array<() => void> = [];
function stub(id: string, exports: unknown) {
  const path = require.resolve(id), original = require.cache[path];
  require.cache[path] = { id: path, filename: path, loaded: true, exports } as NodeModule;
  restored.push(() => { if (original) require.cache[path] = original; else delete require.cache[path]; });
}
stub("next/router", { useRouter: () => router });
stub("next/head", { __esModule: true, default: () => null });
stub("next/link", { __esModule: true, default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> });
stub("../components/AppShell", { __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> });
stub("../components/admin/SetCatalogEvidenceReview", { __esModule: true, default: () => null });
stub("../constants/admin", { hasAdminAccess: () => true, hasAdminPhoneAccess: () => false });
stub("../hooks/useSession", { useSession: () => ({ session: { token: "offline-reviewer", user: { id: "offline-reviewer", phone: null } }, loading: false }) });
const Review = require("../pages/admin/set-ops-review").default as typeof import("../pages/admin/set-ops-review").default;
for (const restore of restored.reverse()) restore();

async function mount(post: (init: RequestInit) => Promise<Response>, canReview = true) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://collect.tenkings.co/admin/set-ops-review", pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const calls: RequestInit[] = [];
  const job = { id: "offline-job", ...request, status: "QUEUED", createdAt: "2026-09-17T00:00:00.000Z" };
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === "/api/admin/set-ops/access") return Response.json({ permissions: { reviewer: canReview, approver: false } });
    if (String(url).startsWith("/api/admin/set-ops/ingestion")) {
      if (init?.method === "POST") { calls.push(init); return post(init); }
      return Response.json({ jobs: calls.length ? [job] : [] });
    }
    if (String(url).startsWith("/api/admin/set-ops/sets?")) return Response.json({ sets: [] });
    if (String(url).startsWith("/api/admin/variants/reference/status?")) return Response.json({ total: 0, pending: 0, processed: 0 });
    throw new Error(`Unexpected request: ${url}`);
  };
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const host = dom.window.document.getElementById("root") as HTMLElement, root = createRoot(host);
  await act(async () => root.render(<Review />));
  const file = () => host.querySelector<HTMLInputElement>('input[aria-label="Prepared checklist JSON"]')!;
  const button = () => [...host.querySelectorAll("button")].find(node => /Queue prepared checklist|Submission attempted/.test(node.textContent ?? ""))!;
  const upload = async (content = source, input = file(), name = "pokemon-complete-import.unreviewed.json") => {
    Object.defineProperty(input, "files", { configurable: true, value: [{ size: new TextEncoder().encode(content).byteLength, name, type: "application/json", text: async () => content }] });
    await act(async () => Simulate.change(input));
  };
  const click = async (twice = false) => { await act(async () => {
    const target = button(); target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    if (twice) target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  }); };
  return { host, dom, file, button, upload, click, calls, job,
    close: async () => {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}

test("file preview is read-only; explicit rapid clicks submit the preserved envelope once with normal authentication", async () => {
  let finish: (response: Response) => void = () => {};
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const ui = await mount(async () => pending);
  try {
    assert.equal(ui.calls.length, 0);
    await ui.upload();
    assert.equal(ui.calls.length, 0);
    const preview = ui.host.querySelector('[aria-label="Prepared checklist preview"]')!.textContent!;
    assert.match(preview, /Black & White—Legendary Treasures/);
    assert.match(preview, /138/);
    assert.match(preview, /Pokémon/);
    assert.match(preview, /does not verify the original PDF/);
    await ui.click(true);
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.calls[0].body, JSON.stringify(request));
    assert.deepEqual(JSON.parse(String(ui.calls[0].body)), request);
    assert.equal((ui.calls[0].headers as Record<string, string>).Authorization, "Bearer offline-reviewer");
    assert.equal(ui.button().disabled, true);
    await act(async () => finish(Response.json({ job: ui.job })));
    assert.match(ui.host.textContent!, /Queued prepared checklist as job offline-job/);
    await ui.upload();
    assert.equal(ui.button().disabled, true, "reloading the same envelope cannot replay it in this workspace");
    await ui.click();
    assert.equal(ui.calls.length, 1);
  } finally { await ui.close(); }
});

test("an ambiguous submission is not retried, and malformed replacement clears the usable preview", async () => {
  const ui = await mount(async () => { throw new Error("Offline transport failure"); });
  try {
    await ui.upload(); await ui.click(true);
    assert.equal(ui.calls.length, 1);
    assert.match(ui.host.textContent!, /Check the ingestion queue/);
    await ui.upload(); await ui.click();
    assert.equal(ui.calls.length, 1);
    await ui.upload(JSON.stringify({ ...JSON.parse(source), publication: {} }));
    assert.equal(ui.host.querySelector('[aria-label="Prepared checklist preview"]'), null);
    assert.match(ui.host.textContent!, /Unsupported prepared checklist/);
    assert.equal(ui.calls.length, 1);
  } finally { await ui.close(); }
});

test("existing reviewer permission still gates file selection and submission", async () => {
  const ui = await mount(async () => { throw new Error("Must not submit"); }, false);
  try {
    assert.equal(ui.file().disabled, true);
    await ui.upload();
    assert.equal(ui.calls.length, 0);
    assert.equal(ui.host.querySelector('[aria-label="Prepared checklist preview"]'), null);
  } finally { await ui.close(); }
});

test("generic upload rejects a prepared wrapper and ordinary JSON rows retain their existing path", async () => {
  const ui = await mount(async () => Response.json({ job: ui.job }));
  try {
    const generic = ui.host.querySelector<HTMLInputElement>('input[accept*=".csv,.json,.pdf"]')!;
    await ui.upload(source, generic);
    assert.match(ui.host.textContent!, /Use Prepared checklist import/);
    assert.equal(ui.calls.length, 0);
    await ui.upload(JSON.stringify([{ setId: "Example set", cardNumber: "1", playerName: "Example" }]), generic, "ordinary.json");
    assert.match(ui.host.textContent!, /Loaded 1 rows from ordinary.json/);
    await act(async () => Simulate.submit(ui.host.querySelector("form")!));
    assert.equal(ui.calls.length, 1);
    const body = JSON.parse(String(ui.calls[0].body));
    assert.equal(body.sourceProvider, "FILE_UPLOAD");
    assert.equal(body.sourceFetchMeta.fileName, "ordinary.json");
    assert.equal(body.rawPayload[0].playerName, "Example");
    await ui.upload(source, generic);
    await act(async () => Simulate.submit(ui.host.querySelector("form")!));
    assert.equal(ui.calls.length, 1, "a rejected wrapper cannot queue stale rows from the preceding generic file");
  } finally { await ui.close(); }
});
