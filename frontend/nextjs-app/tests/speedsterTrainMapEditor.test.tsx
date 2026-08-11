import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The existing mounted UI tests use jsdom without a workspace declaration package.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";

const cssExtensions = require.extensions as unknown as Record<string, (module: NodeModule) => void>;
cssExtensions[".css"] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, property) => property === "__esModule" ? false : String(property),
  });
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { SpeedsterTrainWorkspace } = require(
  "../components/ai-grader-v2/SpeedsterTrainWorkspace",
) as typeof import("../components/ai-grader-v2/SpeedsterTrainWorkspace");
type SpeedsterTrainMapState = import("../components/ai-grader-v2/SpeedsterTrainWorkspace").SpeedsterTrainMapState;
type SpeedsterTrainSource = import("../components/ai-grader-v2/SpeedsterTrainWorkspace").SpeedsterTrainSource;

const frontCentering = [
  { x: 0.08, y: 0.09 },
  { x: 0.92, y: 0.09 },
  { x: 0.92, y: 0.91 },
  { x: 0.08, y: 0.91 },
] as const;
const backCentering = [
  { x: 0.07, y: 0.08 },
  { x: 0.93, y: 0.08 },
  { x: 0.93, y: 0.92 },
  { x: 0.07, y: 0.92 },
] as const;
const validQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;
const identity = {
  playerName: "Nick Bosa",
  year: "2021",
  manufacturer: "Panini",
  productSet: "Obsidian",
  parallel: "Orange",
  insert: null,
  cardNumber: "12",
} as const;
const source: SpeedsterTrainSource = {
  sessionId: "speedster-card-map-editor-session-12345",
  cardProfile: "SPORTS",
  identity,
  front: { rectifiedUrl: "https://images.example.test/front.webp", centeringQuad: frontCentering },
  back: { rectifiedUrl: "https://images.example.test/back.webp", centeringQuad: backCentering },
};

function sideFixture(side: "front" | "back") {
  return {
    designBoundary: { kind: "QUAD" as const, points: validQuad },
    anchors: [1, 2, 3, 4].map((number) => ({
      id: `${side}-stable-anchor-${number}`,
      label: `Anchor ${number}`,
      point: validQuad[number - 1],
    })),
    zones: [{
      id: `${side}-zone-1`,
      label: "Printed text",
      semanticType: "PRINT_TEXT" as const,
      polygon: [
        { x: 0.2, y: 0.6 },
        { x: 0.8, y: 0.6 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ],
    }],
  };
}

function loadedMap(): SpeedsterTrainMapState {
  return {
    status: "LOADED",
    revision: {
      mapId: "card-map-12345678901234567890",
      revisionId: "card-map-revision-1234567890",
      version: 2,
      revisionHash: "a".repeat(64),
      displayIdentity: identity,
      mapSchemaVersion: "speedster-card-type-map-v1",
      filterPolicyVersion: "speedster-map-filter-containment-v1",
      createdAt: "2026-08-11T12:00:00.000Z",
    },
    revisions: [],
    editable: { front: sideFixture("front"), back: sideFixture("back") },
  };
}

const missingMap: SpeedsterTrainMapState = {
  status: "MISSING",
  revision: null,
  revisions: [],
  editable: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Harness = {
  container: HTMLElement;
  root: Root;
  requests: Array<{ url: string; init?: RequestInit }>;
  savedMaps: SpeedsterTrainMapState[];
  cleanup: () => Promise<void>;
};

async function mount(initialMap: SpeedsterTrainMapState): Promise<Harness> {
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
    HTMLInputElement: globalThis.HTMLInputElement,
    SVGElement: globalThis.SVGElement,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
    FocusEvent: globalThis.FocusEvent,
    fetch: globalThis.fetch,
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLImageElement: { configurable: true, value: dom.window.HTMLImageElement },
    HTMLCanvasElement: { configurable: true, value: dom.window.HTMLCanvasElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
    SVGElement: { configurable: true, value: dom.window.SVGElement },
    Event: { configurable: true, value: dom.window.Event },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    FocusEvent: { configurable: true, value: dom.window.FocusEvent },
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

  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    requests.push({ url, init });
    if (url === "/api/admin/ai-grader-v2/maps/save") return jsonResponse({ map: loadedMap() }, 201);
    throw new Error(`Unexpected card map editor request: ${url}`);
  };
  const savedMaps: SpeedsterTrainMapState[] = [];
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SpeedsterTrainWorkspace
        token="admin-token"
        source={source}
        initialMap={initialMap}
        onSaved={(map) => savedMaps.push(map)}
      />,
    );
  });
  return {
    container,
    root,
    requests,
    savedMaps,
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

function fire(element: Element, type: string, init: MouseEventInit & { pointerId?: number } = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  element.dispatchEvent(event);
}

function setOverlayBounds(overlay: SVGSVGElement) {
  Object.defineProperty(overlay, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 1000, bottom: 1400, width: 1000, height: 1400 }),
  });
}

async function drag(
  overlay: SVGSVGElement,
  handle: SVGGElement,
  clientX: number,
  clientY: number,
  pointerId = 7,
) {
  setOverlayBounds(overlay);
  await act(async () => {
    fire(handle, "pointerdown", { pointerId, clientX, clientY });
    fire(overlay, "pointermove", { pointerId, clientX, clientY });
    fire(overlay, "pointerup", { pointerId, clientX, clientY });
  });
}

async function waitFor(condition: () => boolean, message: string, timeoutMs = 1000) {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
}

test("CARD MAP terminology, inherited centering boundary, and composed Front/Back previews are explicit", async () => {
  const harness = await mount(missingMap);
  try {
    assert.match(harness.container.textContent ?? "", /CARD MAP · EXACT CARD TYPE/);
    assert.ok(buttonByText(harness.container, "Printed Boundary"));
    assert.ok(buttonByText(harness.container, "Registration Anchors"));
    assert.ok(buttonByText(harness.container, "Printed-Content Zones"));
    assert.match(harness.container.textContent ?? "", /saved Card Map boundary/);
    assert.match(harness.container.textContent ?? "", /proposed printed-border centering correction for a new map/);
    assert.match(harness.container.textContent ?? "", /not a defect box/);
    assert.ok(harness.container.querySelector('[aria-label="FRONT composed card map preview"]'));
    assert.ok(harness.container.querySelector('[aria-label="BACK composed card map preview"]'));
    const frontPreview = harness.container.querySelector<SVGSVGElement>('[aria-label="FRONT composed card map preview"]');
    const backPreview = harness.container.querySelector<SVGSVGElement>('[aria-label="BACK composed card map preview"]');
    assert.equal(frontPreview?.querySelector("polygon")?.getAttribute("points"), "80,126 920,126 920,1274 80,1274");
    assert.equal(backPreview?.querySelector("polygon")?.getAttribute("points"), "70,112 930,112 930,1288 70,1288");
    assert.equal(buttonByText(harness.container, "Save + activate card map")?.disabled, true);
  } finally {
    await harness.cleanup();
  }
});

test("one boundary handle and stable registration anchors drag independently, undo, validate, and save the exact payload", async () => {
  const harness = await mount(loadedMap());
  try {
    const overlay = harness.container.querySelector<SVGSVGElement>('[aria-label="Editable FRONT card map geometry"]');
    const boundary = harness.container.querySelector<SVGGElement>('[aria-label="Front Printed Boundary TL"]');
    assert.ok(overlay && boundary);

    await drag(overlay, boundary, 900, 1260);
    assert.equal(buttonByText(harness.container, "Save + activate new revision")?.disabled, true);
    assert.match(harness.container.textContent ?? "", /Front boundary 4\/4 invalid/);
    await act(async () => fire(buttonByText(harness.container, "Undo last Front edit")!, "click"));
    assert.equal(buttonByText(harness.container, "Save + activate new revision")?.disabled, false);

    const restoredBoundary = harness.container.querySelector<SVGGElement>('[aria-label="Front Printed Boundary TL"]');
    assert.ok(restoredBoundary);
    await drag(overlay, restoredBoundary, 150, 280, 8);
    assert.match(overlay.querySelector("polygon")?.getAttribute("points") ?? "", /^150,280 /);
    await act(async () => fire(buttonByText(harness.container, "Undo last Front edit")!, "click"));
    assert.match(overlay.querySelector("polygon")?.getAttribute("points") ?? "", /^100,140 /);

    await act(async () => fire(buttonByText(harness.container, "Registration Anchors")!, "click"));
    assert.match(harness.container.textContent ?? "", /distinctive, high-contrast internal printed landmarks/);
    const anchorOne = harness.container.querySelector<SVGGElement>('[aria-label="Front Registration Anchor A1"]');
    assert.ok(anchorOne);
    await drag(overlay, anchorOne, 250, 350, 9);
    const anchorTwo = harness.container.querySelector<SVGGElement>('[aria-label="Front Registration Anchor A2"]');
    assert.ok(anchorTwo);
    await drag(overlay, anchorTwo, 250, 350, 10);
    assert.equal(buttonByText(harness.container, "Save + activate new revision")?.disabled, true);
    assert.match(harness.container.textContent ?? "", /anchors 4\/4 ·/);
    await act(async () => fire(buttonByText(harness.container, "Undo last Front edit")!, "click"));
    assert.equal(buttonByText(harness.container, "Save + activate new revision")?.disabled, false);

    await act(async () => fire(buttonByText(harness.container, "Save + activate new revision")!, "click"));
    await waitFor(() => harness.savedMaps.length === 1, "Card map save did not settle");
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, "/api/admin/ai-grader-v2/maps/save");
    const body = JSON.parse(String(harness.requests[0].init?.body)) as Record<string, any>;
    assert.deepEqual(Object.keys(body).sort(), ["back", "front", "sessionId"]);
    assert.deepEqual(Object.keys(body.front).sort(), ["anchors", "designBoundary", "zones"]);
    assert.equal(body.sessionId, source.sessionId);
    assert.deepEqual(body.front.anchors.map((anchor: { id: string }) => anchor.id), [
      "front-stable-anchor-1",
      "front-stable-anchor-2",
      "front-stable-anchor-3",
      "front-stable-anchor-4",
    ]);
    assert.deepEqual(body.front.anchors[0].point, { x: 0.25, y: 0.25 });
    assert.equal("selectedZoneId" in body.front, false);
    assert.equal("zoneDraft" in body.front, false);
  } finally {
    await harness.cleanup();
  }
});

test("selected zones edit and drag individually, remove without clearing siblings, and restore through local undo", async () => {
  const baseMap = loadedMap();
  const extra = {
    id: "front-zone-2",
    label: "Printed logo",
    semanticType: "PRINT_LOGO" as const,
    polygon: [
      { x: 0.65, y: 0.15 },
      { x: 0.85, y: 0.15 },
      { x: 0.85, y: 0.35 },
      { x: 0.65, y: 0.35 },
    ],
  };
  const map: SpeedsterTrainMapState = {
    ...baseMap,
    editable: baseMap.editable ? {
      ...baseMap.editable,
      front: { ...baseMap.editable.front, zones: [...baseMap.editable.front.zones, extra] },
    } : null,
  };
  const harness = await mount(map);
  try {
    await act(async () => fire(buttonByText(harness.container, "Printed-Content Zones")!, "click"));
    assert.match(harness.container.textContent ?? "", /Fully contained Detector or Memory findings/);
    assert.match(harness.container.textContent ?? "", /Partial overlap remains in review/);
    assert.match(harness.container.textContent ?? "", /Smart Marks always remain/);
    assert.ok(buttonByText(harness.container, "New Zone"));

    const input = harness.container.querySelector<HTMLInputElement>('input[maxlength="80"]');
    assert.ok(input);
    await act(async () => {
      Simulate.change(input, { target: { value: "Updated printed text" } } as unknown as Event);
    });
    assert.ok(buttonByText(harness.container, "Updated printed text"));

    const overlay = harness.container.querySelector<SVGSVGElement>('[aria-label="Editable FRONT card map geometry"]');
    const vertex = harness.container.querySelector<SVGGElement>('[aria-label="Front Printed-Content Zone Updated printed text vertex 1"]');
    assert.ok(overlay && vertex);
    await drag(overlay, vertex, 250, 700, 11);
    const selected = overlay.querySelector<SVGPolygonElement>(".selectedZone");
    assert.match(selected?.getAttribute("points") ?? "", /^250,700 /);

    const secondZoneBefore = buttonByText(harness.container, "Printed logo");
    assert.ok(secondZoneBefore);
    await act(async () => fire(buttonByText(harness.container, "Remove selected zone")!, "click"));
    assert.equal(buttonByText(harness.container, "Updated printed text"), undefined);
    assert.ok(buttonByText(harness.container, "Printed logo"));
    await act(async () => fire(buttonByText(harness.container, "Undo last Front edit")!, "click"));
    assert.ok(buttonByText(harness.container, "Updated printed text"));
    assert.ok(buttonByText(harness.container, "Printed logo"));

    const restoredVertex = harness.container.querySelector<SVGGElement>('[aria-label="Front Printed-Content Zone Updated printed text vertex 1"]');
    assert.equal(restoredVertex?.querySelector("circle")?.getAttribute("cx"), "250");
  } finally {
    await harness.cleanup();
  }
});
