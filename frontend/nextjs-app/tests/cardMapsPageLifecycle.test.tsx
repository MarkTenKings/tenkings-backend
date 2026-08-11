import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
// @ts-expect-error The repository lifecycle harness uses jsdom without a workspace declaration package.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const require = createRequire(import.meta.url);
(globalThis as typeof globalThis & { React: typeof React }).React = React;
process.env.NEXT_PUBLIC_ADMIN_USER_IDS = "card-maps-admin";

const extensions = require.extensions as unknown as Record<string, (module: NodeModule) => void>;
extensions[".css"] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, property) => property === "__esModule" ? false : String(property),
  });
};

type SessionState = {
  session: { token: string; user: { id: string; phone: string | null } } | null;
  loading: boolean;
  ensureSession: () => Promise<void>;
};

let sessionState: SessionState = {
  session: { token: "admin-token", user: { id: "card-maps-admin", phone: null } },
  loading: false,
  async ensureSession() {},
};
let routerQuery: Record<string, string | string[] | undefined> = {};
const routerPushes: string[] = [];

function stubModule(specifier: string, exports: unknown) {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
}

stubModule("../hooks/useSession", { useSession: () => sessionState });
stubModule("next/router", {
  useRouter: () => ({
    query: routerQuery,
    async push(url: string) { routerPushes.push(url); return true; },
  }),
});
stubModule("../components/AppShell", {
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
});
stubModule("next/head", {
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
});
stubModule("next/link", {
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
});
stubModule("../components/human-grade/SharedLabelEditor", {
  __esModule: true,
  default: (props: {
    value: Record<string, string>;
    fieldErrors: Record<string, string>;
    onChange: (field: string, value: string) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    primaryActionLabel: string;
  }) => (
    <form aria-label="identity editor" onSubmit={props.onSubmit}>
      {(["playerName", "year", "manufacturer", "productSet"] as const).map((field) => (
        <label key={field}>
          {field}
          <input
            aria-label={field}
            value={props.value[field]}
            onInput={(event) => props.onChange(field, (event.target as HTMLInputElement).value)}
            onChange={() => undefined}
          />
        </label>
      ))}
      {Object.entries(props.fieldErrors).map(([field, error]) => <span key={field}>{error}</span>)}
      <button type="submit">{props.primaryActionLabel}</button>
    </form>
  ),
});

const quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

const captureBundle = {
  sessionId: "new-card-map-session",
  cardProfile: "SPORTS",
  cornerShape: "ROUNDED_3_18_MM",
  front: {
    originalStorageKey: "front-original",
    rectifiedStorageKey: "front-rectified",
    inspectionStorageKey: "front-inspection",
    inspectionFrame: { width: 1200, height: 1600 },
    viewStorageKeys: { NORMALIZED: "front-normalized", MICRO_DEFECT: "front-micro", DIRECTIONAL: "front-directional" },
    sourceCorners: quad,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    centeringQuad: quad,
    centeringBorders: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    rectifiedUrl: "https://images.example.test/front.png",
    mapRegistration: { mapRevisionId: "revision-7", sourcePhysicalQuadSha256: "front-hash" },
  },
  back: {
    originalStorageKey: "back-original",
    rectifiedStorageKey: "back-rectified",
    inspectionStorageKey: "back-inspection",
    inspectionFrame: { width: 1200, height: 1600 },
    viewStorageKeys: { NORMALIZED: "back-normalized", MICRO_DEFECT: "back-micro", DIRECTIONAL: "back-directional" },
    sourceCorners: quad,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    centeringQuad: quad,
    centeringBorders: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    rectifiedUrl: "https://images.example.test/back.png",
    mapRegistration: { mapRevisionId: "revision-7", sourcePhysicalQuadSha256: "back-hash" },
  },
};

stubModule("../components/ai-grader-v2/CaptureWorkspace", {
  CaptureWorkspace: ({ onReady }: { onReady: (bundle: typeof captureBundle) => void }) => (
    <button type="button" onClick={() => onReady(captureBundle)}>COMPLETE FRONT + BACK</button>
  ),
});
stubModule("../components/ai-grader-v2/SpeedsterTrainWorkspace", {
  SpeedsterTrainWorkspace: ({ source }: { source: { sessionId: string } }) => (
    <div data-testid="card-map-workspace">CARD MAP WORKSPACE · {source.sessionId}</div>
  ),
});

const { default: CardMapsPage } = require("../pages/card-maps") as typeof import("../pages/card-maps");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitFor(condition: () => boolean, message: string, timeoutMs = 1500) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}

type MountedPage = {
  container: HTMLElement;
  root: Root;
  cleanup: () => Promise<void>;
};

async function mountPage(input: {
  query?: Record<string, string | string[] | undefined>;
  userId?: string;
  fetchImpl: typeof fetch;
}): Promise<MountedPage> {
  routerQuery = input.query ?? {};
  routerPushes.length = 0;
  sessionState = {
    session: { token: "admin-token", user: { id: input.userId ?? "card-maps-admin", phone: null } },
    loading: false,
    async ensureSession() {},
  };
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "https://collect.tenkings.co/card-maps",
    pretendToBeVisual: true,
  });
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
    fetch: globalThis.fetch,
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    Event: { configurable: true, value: dom.window.Event },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    fetch: { configurable: true, value: input.fetchImpl },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() {},
  });
  Object.defineProperties(dom.window.HTMLInputElement.prototype, {
    attachEvent: { configurable: true, value() {} },
    detachEvent: { configurable: true, value() {} },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => { root.render(<CardMapsPage />); });
  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, value] of Object.entries(previousGlobals)) {
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
      delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(text));
}

async function changeInput(container: HTMLElement, label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  assert.ok(input);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("blank new-card identity shows exact field errors without making a request", async () => {
  const requests: string[] = [];
  const page = await mountPage({
    fetchImpl: async (request) => { requests.push(String(request)); throw new Error("unexpected fetch"); },
  });
  try {
    const heroCta = buttonByText(page.container, "CREATE CARD MAP");
    assert.ok(heroCta);
    await act(async () => heroCta.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.equal(document.activeElement?.getAttribute("aria-label"), "playerName");

    const submit = buttonByText(page.container, "CONTINUE TO FRONT + BACK");
    assert.ok(submit);
    await act(async () => submit.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => page.container.textContent?.includes("Player name is required.") ?? false, "Identity errors were not rendered");
    assert.equal(requests.length, 0);
    assert.match(page.container.textContent ?? "", /Year is required\./);
    assert.match(page.container.textContent ?? "", /Manufacturer is required\./);
    assert.match(page.container.textContent ?? "", /Product \/ set is required\./);
  } finally {
    await page.cleanup();
  }
});

test("valid new-card identity creates one session, loads its exact map, saves capture, and opens the workspace", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const loadedMap = {
    status: "LOADED",
    revision: { revisionId: "revision-7", version: 7, revisionHash: "abcdef1234567890" },
    revisions: [],
    editable: null,
  };
  const page = await mountPage({
    fetchImpl: async (request, init) => {
      const url = String(request);
      requests.push({ url, init });
      if (url === "/api/admin/ai-grader-v2/sessions") {
        return jsonResponse({ session: { id: "new-card-map-session", cardProfile: "SPORTS" } }, 201);
      }
      if (url === "/api/admin/ai-grader-v2/maps/current?sessionId=new-card-map-session") {
        return jsonResponse({ map: loadedMap });
      }
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session") return jsonResponse({});
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  try {
    await changeInput(page.container, "playerName", "Ken Griffey Jr.");
    await changeInput(page.container, "year", "1997");
    await changeInput(page.container, "manufacturer", "Upper Deck");
    await changeInput(page.container, "productSet", "SPx");
    const submit = buttonByText(page.container, "CONTINUE TO FRONT + BACK");
    assert.ok(submit);
    await act(async () => submit.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(page.container, "COMPLETE FRONT + BACK")), "Capture workspace did not open");
    assert.equal(requests.length, 2);
    assert.match(page.container.textContent ?? "", /EDIT CARD MAP/);

    const completeCapture = buttonByText(page.container, "COMPLETE FRONT + BACK");
    assert.ok(completeCapture);
    await act(async () => completeCapture.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(page.container.querySelector('[data-testid="card-map-workspace"]')), "CARD MAP workspace did not open");
    assert.equal(requests.length, 3);
    const patch = requests[2];
    assert.equal(patch.url, "/api/admin/ai-grader-v2/sessions/new-card-map-session");
    assert.equal(patch.init?.method, "PATCH");
    const body = JSON.parse(String(patch.init?.body));
    assert.equal(body.workflowState, "CAPTURED");
    assert.equal(body.mapBinding.revisionId, "revision-7");
    assert.equal(body.mapBinding.registration.front.mapRevisionId, "revision-7");
    assert.equal(body.mapBinding.registration.back.mapRevisionId, "revision-7");
    assert.equal(body.capture.front.originalStorageKey, "front-original");
    assert.equal(body.capture.back.originalStorageKey, "back-original");
  } finally {
    await page.cleanup();
  }
});

test("completed mode makes one exact source request and opens the shared workspace directly", async () => {
  const urls: string[] = [];
  const exactSessionId = "completed/session 42";
  const page = await mountPage({
    query: { sessionId: exactSessionId },
    fetchImpl: async (request) => {
      urls.push(String(request));
      return jsonResponse({
        source: {
          sessionId: exactSessionId,
          cardProfile: "SPORTS",
          identity: { playerName: "Card", year: "2024", manufacturer: "Topps", productSet: "Set" },
          front: { rectifiedUrl: "front", centeringQuad: quad },
          back: { rectifiedUrl: "back", centeringQuad: quad },
        },
        map: { status: "MISSING", revision: null, revisions: [], editable: null },
      });
    },
  });
  try {
    await waitFor(() => Boolean(page.container.querySelector('[data-testid="card-map-workspace"]')), "Completed CARD MAP workspace did not open");
    assert.deepEqual(urls, [
      `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(exactSessionId)}`,
    ]);
    assert.match(page.container.textContent ?? "", /CREATE CARD MAP/);
  } finally {
    await page.cleanup();
  }
});

test("malformed completed source stays local and links to the exact identity editor", async () => {
  const exactSessionId = "malformed/session 7";
  const urls: string[] = [];
  const page = await mountPage({
    query: { sessionId: exactSessionId },
    fetchImpl: async (request) => {
      urls.push(String(request));
      return jsonResponse({ message: "CARD MAP source identity is malformed." }, 409);
    },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("CARD MAP source identity is malformed.") ?? false, "Malformed source error did not render");
    assert.equal(urls.length, 1);
    const correction = Array.from(page.container.querySelectorAll("a")).find((link) => link.textContent === "FIX CARD IDENTITY");
    assert.equal(correction?.getAttribute("href"), `/admin/ai-grader-v2/completed/${encodeURIComponent(exactSessionId)}`);
    assert.equal(page.container.querySelector('[data-testid="card-map-workspace"]'), null);
  } finally {
    await page.cleanup();
  }
});

test("non-admin access renders no CARD MAP workflow and makes no request", async () => {
  const urls: string[] = [];
  const page = await mountPage({
    query: { sessionId: "completed-session" },
    userId: "ordinary-user",
    fetchImpl: async (request) => { urls.push(String(request)); return jsonResponse({}); },
  });
  try {
    assert.match(page.container.textContent ?? "", /Admin access required\./);
    assert.equal(urls.length, 0);
    assert.equal(page.container.querySelector('[data-testid="card-map-workspace"]'), null);
  } finally {
    await page.cleanup();
  }
});
