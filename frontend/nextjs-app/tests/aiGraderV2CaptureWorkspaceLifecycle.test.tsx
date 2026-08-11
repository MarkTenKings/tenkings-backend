import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The existing lifecycle harness uses jsdom without a workspace declaration package.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const cssExtensions = require.extensions as unknown as Record<string, (module: NodeModule) => void>;
cssExtensions[".css"] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, property) => property === "__esModule" ? false : String(property),
  });
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const QRCode = require("qrcode") as { toCanvas: (...args: unknown[]) => Promise<void> };
const originalQrToCanvas = QRCode.toCanvas;
QRCode.toCanvas = async () => {};

const { CaptureWorkspace } = require(
  "../components/ai-grader-v2/CaptureWorkspace",
) as typeof import("../components/ai-grader-v2/CaptureWorkspace");
const { SpeedsterTrainWorkspace } = require(
  "../components/ai-grader-v2/SpeedsterTrainWorkspace",
) as typeof import("../components/ai-grader-v2/SpeedsterTrainWorkspace");
const { speedsterImageService } = require(
  "../lib/ai-grader-v2/image-service",
) as typeof import("../lib/ai-grader-v2/image-service");

type GeometryResponse = Awaited<ReturnType<typeof speedsterImageService.proposeGeometry>>;

const validQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(text));
}

type Harness = {
  container: HTMLElement;
  root: Root;
  getPollCount: () => number;
  cleanup: () => Promise<void>;
};

async function mountWorkspace(input: {
  proposeGeometry: typeof speedsterImageService.proposeGeometry;
  refreshedUrls?: boolean;
}): Promise<Harness> {
  QRCode.toCanvas = async () => {};
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "https://collect.tenkings.co/admin/ai-grader-v2",
    pretendToBeVisual: true,
  });
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    HTMLImageElement: globalThis.HTMLImageElement,
    HTMLCanvasElement: globalThis.HTMLCanvasElement,
    SVGElement: globalThis.SVGElement,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
    fetch: globalThis.fetch,
  };

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLImageElement: { configurable: true, value: dom.window.HTMLImageElement },
    HTMLCanvasElement: { configurable: true, value: dom.window.HTMLCanvasElement },
    SVGElement: { configurable: true, value: dom.window.SVGElement },
    Event: { configurable: true, value: dom.window.Event },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      drawImage() {},
      getImageData: () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16) }),
    }),
  });
  Object.defineProperties(dom.window.SVGElement.prototype, {
    setPointerCapture: { configurable: true, value() {} },
    releasePointerCapture: { configurable: true, value() {} },
    hasPointerCapture: { configurable: true, value: () => true },
  });

  let pollCount = 0;
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    if (url === "/api/admin/ai-grader-v2/iphone-capture" && init?.method === "POST") {
      return jsonResponse({ pairingUrl: "https://pair.example.test/speedster" });
    }
    if (url.startsWith("/api/admin/ai-grader-v2/iphone-capture?")) {
      pollCount += 1;
      const suffix = input.refreshedUrls && pollCount > 1 ? "refreshed" : "original";
      return jsonResponse({
        readyVersion: 1,
        front: { storageKey: "front.jpg", readUrl: `https://images.example.test/front-${suffix}.jpg` },
        back: { storageKey: "back.jpg", readUrl: `https://images.example.test/back-${suffix}.jpg` },
      });
    }
    throw new Error(`Unexpected fetch in lifecycle test: ${url}`);
  };

  const originalProposeGeometry = speedsterImageService.proposeGeometry;
  speedsterImageService.proposeGeometry = input.proposeGeometry;
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CaptureWorkspace
        token="admin-token"
        sessionId="speedster-session-lifecycle-test"
        cardProfile="POKEMON"
        onReady={() => {}}
      />,
    );
  });
  await waitFor(
    () => Boolean(buttonByText(container, "Set geometry")),
    "The capture pair did not become ready",
  );

  return {
    container,
    root,
    getPollCount: () => pollCount,
    cleanup: async () => {
      await act(async () => root.unmount());
      speedsterImageService.proposeGeometry = originalProposeGeometry;
      QRCode.toCanvas = originalQrToCanvas;
      dom.window.close();
      for (const [key, value] of Object.entries(previousGlobals)) {
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
      delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function fire(element: Element, type: string, init: MouseEventInit & { pointerId?: number } = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  element.dispatchEvent(event);
}

function giveImageRenderedArea(image: HTMLImageElement) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const bounds = { left: 0, top: 0, right: width, bottom: height, width, height };
  const frame = image.parentElement;
  assert.ok(frame);
  Object.defineProperties(image, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    getBoundingClientRect: { configurable: true, value: () => bounds },
  });
  Object.defineProperty(frame, "getBoundingClientRect", {
    configurable: true,
    value: () => bounds,
  });
}

test("normal mounted grading flow reaches draggable Set Geometry after a simulated five-second response", async () => {
  const pending: Array<(value: GeometryResponse) => void> = [];
  let now = 10_000;
  const originalDateNow = Date.now;
  const originalConsoleInfo = console.info;
  const diagnostics: string[] = [];
  Date.now = () => now;
  console.info = (line) => diagnostics.push(String(line));
  const harness = await mountWorkspace({
    proposeGeometry: async () => new Promise<GeometryResponse>((resolve) => pending.push(resolve)),
  });

  try {
    const setGeometry = buttonByText(harness.container, "Set geometry");
    assert.ok(setGeometry);
    await act(async () => fire(setGeometry, "click"));
    assert.match(setGeometry.textContent ?? "", /Preparing/);
    await waitFor(() => pending.length === 1, "Front geometry request did not start");

    now += 5_000;
    await act(async () => pending[0]({ width: 1200, height: 1600, corners: validQuad }));
    await waitFor(() => pending.length === 2, "Back geometry request did not start");
    now += 125;
    await act(async () => pending[1]({ width: 1200, height: 1600, corners: validQuad }));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Normal geometry did not reach the mounted Set Geometry screen",
    );

    const overlay = harness.container.querySelector<SVGSVGElement>('[aria-label="Adjustable card corner geometry"]');
    const topLeft = harness.container.querySelector<SVGGElement>('[aria-label="Top left"]');
    const continueButton = buttonByText(harness.container, "Continue");
    assert.ok(overlay && topLeft && continueButton);
    assert.equal(continueButton.disabled, false);
    Object.defineProperty(overlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }),
    });
    await act(async () => {
      fire(topLeft, "pointerdown", { pointerId: 7, clientX: 100, clientY: 100 });
      fire(overlay, "pointermove", { pointerId: 7, clientX: 200, clientY: 300 });
    });
    const movedTopLeft = harness.container.querySelector<SVGGElement>('[aria-label="Top left"]');
    assert.equal(movedTopLeft?.querySelector("circle")?.getAttribute("cx"), "200");

    const image = harness.container.querySelector<HTMLImageElement>('img[alt="front trading card"]');
    assert.ok(image);
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 2 },
      naturalHeight: { configurable: true, value: 2 },
    });
    giveImageRenderedArea(image);
    await act(async () => image.dispatchEvent(new window.Event("load", { bubbles: true })));
    await waitFor(() => diagnostics.length === 1, "Loaded-image diagnostic was not emitted after paint");
    assert.match(diagnostics[0], /"durationMs":5000/);
    assert.match(diagnostics[0], /"corners":"present"/);
    assert.match(diagnostics[0], /"imageLoadOutcome":"loaded"/);
  } finally {
    await harness.cleanup();
    Date.now = originalDateNow;
    console.info = originalConsoleInfo;
  }
});

test("loaded image with no rendered area stays non-blocking and visibly diagnosed", async () => {
  const originalConsoleInfo = console.info;
  const diagnostics: string[] = [];
  console.info = (line) => diagnostics.push(String(line));
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
  });
  try {
    const setGeometry = buttonByText(harness.container, "Set geometry");
    assert.ok(setGeometry);
    await act(async () => fire(setGeometry, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('img[alt="front trading card"]')),
      "Geometry image was not mounted",
    );
    const image = harness.container.querySelector<HTMLImageElement>('img[alt="front trading card"]');
    assert.ok(image);
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 2 },
      naturalHeight: { configurable: true, value: 2 },
    });
    await act(async () => image.dispatchEvent(new window.Event("load", { bubbles: true })));
    await waitFor(
      () => /no visible rendered area/.test(harness.container.querySelector('[role="alert"]')?.textContent ?? ""),
      "Zero-area image failure was not surfaced",
    );

    assert.ok(harness.container.querySelector('[aria-label="front card geometry"]'));
    for (const button of harness.container.querySelectorAll("button")) {
      assert.equal(button.disabled, false);
    }
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /"imageLoadOutcome":"render-error"/);
  } finally {
    await harness.cleanup();
    console.info = originalConsoleInfo;
  }
});

test("null corners mount manual draggable geometry instead of trapping the card at Photos", async () => {
  let call = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => {
      call += 1;
      return { width: 1200, height: 1600, corners: call === 1 ? null : validQuad };
    },
  });
  try {
    const setGeometry = buttonByText(harness.container, "Set geometry");
    assert.ok(setGeometry);
    await act(async () => fire(setGeometry, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Null geometry did not advance to manual Set Geometry",
    );
    assert.match(harness.container.textContent ?? "", /1\/2 physical cards found/);
    assert.match(harness.container.textContent ?? "", /Set the four physical corners/);
    assert.equal(harness.container.querySelectorAll("[aria-label='Top left'], [aria-label='Top right'], [aria-label='Bottom right'], [aria-label='Bottom left']").length, 4);
    assert.equal(buttonByText(harness.container, "Continue")?.disabled, false);
  } finally {
    await harness.cleanup();
  }
});

test("image load failure stays visible while geometry and every control remain active", async () => {
  const originalConsoleInfo = console.info;
  const diagnostics: string[] = [];
  console.info = (line) => diagnostics.push(String(line));
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
  });
  try {
    const setGeometry = buttonByText(harness.container, "Set geometry");
    assert.ok(setGeometry);
    await act(async () => fire(setGeometry, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('img[alt="front trading card"]')),
      "Geometry image was not mounted",
    );
    const image = harness.container.querySelector<HTMLImageElement>('img[alt="front trading card"]');
    assert.ok(image);
    await act(async () => image.dispatchEvent(new window.Event("error", { bubbles: true })));

    const alert = harness.container.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? "", /failed to load/);
    assert.match(alert?.textContent ?? "", /Manual corner controls remain available/);
    assert.ok(harness.container.querySelector('[aria-label="front card geometry"]'));
    for (const button of harness.container.querySelectorAll("button")) {
      assert.equal(button.disabled, false);
    }
    assert.ok(harness.container.querySelector('[aria-label="Adjustable card corner geometry"]'));
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /"imageLoadOutcome":"load-error"/);
  } finally {
    await harness.cleanup();
    console.info = originalConsoleInfo;
  }
});

test("same-version iPhone polling cannot erase a visible geometry error", async () => {
  const originalConsoleInfo = console.info;
  console.info = () => {};
  const harness = await mountWorkspace({
    refreshedUrls: true,
    proposeGeometry: async () => {
      throw new Error("Geometry service unavailable");
    },
  });
  try {
    const setGeometry = buttonByText(harness.container, "Set geometry");
    assert.ok(setGeometry);
    await act(async () => fire(setGeometry, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[role="alert"]')),
      "Geometry error did not become visible",
    );
    await waitFor(() => harness.getPollCount() >= 2, "Polling did not restart after the failed attempt");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /Geometry service unavailable/);
    assert.match(
      harness.container.querySelector<HTMLImageElement>('img[alt="front card preview"]')?.src ?? "",
      /front-original\.jpg$/,
    );
  } finally {
    await harness.cleanup();
    console.info = originalConsoleInfo;
  }
});

test("CARD MAP boundary tool resets and requires exactly four human points before save", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
  });
  const identity = {
    playerName: "Nick Bosa",
    year: "2021",
    manufacturer: "Panini",
    productSet: "Obsidian",
    parallel: "Orange",
    insert: null,
    cardNumber: "12",
  } as const;
  const anchors = [1, 2, 3, 4].map((number) => ({
    id: `anchor-${number}`,
    label: `Anchor ${number}`,
    point: validQuad[number - 1],
  }));
  const zones = [{
    id: "zone-1",
    label: "Printed text",
    semanticType: "PRINT_TEXT" as const,
    polygon: validQuad,
  }];
  const editableSide = { designBoundary: { kind: "QUAD" as const, points: validQuad }, anchors, zones };
  try {
    await act(async () => {
      harness.root.render(
        <SpeedsterTrainWorkspace
          token="admin-token"
          source={{
            sessionId: "speedster-session-lifecycle-test",
            cardProfile: "SPORTS",
            identity,
            front: { rectifiedUrl: "https://images.example.test/front.webp", centeringQuad: validQuad },
            back: { rectifiedUrl: "https://images.example.test/back.webp", centeringQuad: validQuad },
          }}
          initialMap={{
            status: "LOADED",
            revision: {
              mapId: "map-1",
              revisionId: "revision-1",
              version: 1,
              revisionHash: "a".repeat(64),
              displayIdentity: identity,
              mapSchemaVersion: "speedster-card-type-map-v1",
              filterPolicyVersion: "speedster-map-filter-containment-v1",
              createdAt: "2026-08-10T20:00:00.000Z",
            },
            revisions: [],
            editable: { front: editableSide, back: editableSide },
          }}
          onSaved={() => {}}
        />,
      );
    });
    const save = buttonByText(harness.container, "Save + activate new revision");
    const reset = buttonByText(harness.container, "Reset Front boundary");
    const stage = harness.container.querySelector<HTMLImageElement>('img[alt="Front card map reference"]')?.parentElement;
    assert.ok(save && reset && stage);
    assert.equal(save.disabled, false);
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
    });
    await act(async () => fire(reset, "click"));
    assert.equal(save.disabled, true);
    for (const [clientX, clientY] of [[10, 10], [90, 10], [90, 90], [10, 90]]) {
      await act(async () => fire(stage, "pointerdown", { clientX, clientY }));
    }
    assert.match(harness.container.textContent ?? "", /Front boundary 4\/4/);
    assert.equal(save.disabled, false);
  } finally {
    await harness.cleanup();
  }
});
