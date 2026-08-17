import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
type SpeedsterDualMapSaveResult = import("../components/ai-grader-v2/SpeedsterTrainWorkspace").SpeedsterDualMapSaveResult;
const {
  cardMapDraftEditableSide,
  createCardMapDraft,
  parseCardMapDraft,
  serializeCardMapDraft,
} = require("../lib/ai-grader-v2/card-map-draft") as typeof import("../lib/ai-grader-v2/card-map-draft");

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
  front: {
    rectifiedUrl: "https://images.example.test/front.webp",
    centeringQuad: frontCentering,
    sourceEvidence: {
      originalStorageKey: "cards/source/front-original.webp",
      rectifiedStorageKey: "cards/source/front-rectified.webp",
      inspectionStorageKey: "cards/source/front-inspection.webp",
      inspectionSha256: "1".repeat(64),
    },
  },
  back: {
    rectifiedUrl: "https://images.example.test/back.webp",
    centeringQuad: backCentering,
    sourceEvidence: {
      originalStorageKey: "cards/source/back-original.webp",
      rectifiedStorageKey: "cards/source/back-rectified.webp",
      inspectionStorageKey: "cards/source/back-inspection.webp",
      inspectionSha256: "2".repeat(64),
    },
  },
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

function dualSaveResult(): SpeedsterDualMapSaveResult {
  const receipt = (scope: "FAMILY" | "EXACT", number: number) => ({
    scope,
    applicability: scope === "FAMILY" ? "all matching cards" : "this exact source card",
    mapId: `${scope.toLowerCase()}-map-12345678901234567890`,
    revisionId: `${scope.toLowerCase()}-revision-1234567890`,
    version: number,
    revisionHash: (scope === "FAMILY" ? "b" : "c").repeat(64),
    matchKeyHash: (scope === "FAMILY" ? "d" : "e").repeat(64),
    sourceSessionId: source.sessionId,
  });
  return { family: receipt("FAMILY", 3), exact: receipt("EXACT", 5) };
}

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
  savedMaps: SpeedsterDualMapSaveResult[];
  cleanup: () => Promise<void>;
};

async function mount(
  initialMap: SpeedsterTrainMapState,
  saveResponse: { body: unknown; status: number } = { body: { maps: dualSaveResult() }, status: 201 },
  sourceInput: SpeedsterTrainSource = source,
): Promise<Harness> {
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
    if (url === "/api/admin/ai-grader-v2/maps/save") return jsonResponse(saveResponse.body, saveResponse.status);
    throw new Error(`Unexpected card map editor request: ${url}`);
  };
  const savedMaps: SpeedsterDualMapSaveResult[] = [];
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SpeedsterTrainWorkspace
        token="admin-token"
        source={sourceInput}
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

test("missing-map creation state is neutral while boundary and composed Front/Back previews stay explicit", async () => {
  const harness = await mount(missingMap);
  try {
    assert.match(harness.container.textContent ?? "", /CARD MAP · FAMILY \+ EXACT/);
    assert.match(harness.container.textContent ?? "", /FIRST FAMILY \+ EXACT CREATION/);
    assert.match(harness.container.textContent ?? "", /Saving creates both complete maps atomically/);
    assert.doesNotMatch(harness.container.textContent ?? "", /NO FAMILY MAP/);
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
    assert.equal(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")?.disabled, true);
  } finally {
    await harness.cleanup();
  }
});

test("legacy Pokémon layout choice is enabled before first save, then irreversibly locked with success evidence", async () => {
  const legacyPokemonSource: SpeedsterTrainSource = {
    ...source,
    cardProfile: "POKEMON",
    identity: {
      cardName: "Squirtle",
      year: "2023 POKEMON",
      productSet: "MEW EN",
      parallel: "REVERSE HOLO",
      cardNumber: "007/165",
    },
  };
  const harness = await mount(loadedMap(), { body: { maps: dualSaveResult() }, status: 201 }, legacyPokemonSource);
  try {
    const selector = harness.container.querySelector<HTMLSelectElement>('[aria-label="Family map layout type"]');
    assert.ok(selector);
    assert.equal(selector.disabled, false);
    assert.equal(selector.value, "");
    const familyYear = harness.container.querySelector<HTMLInputElement>('[aria-label="Canonical Family map year"]');
    assert.ok(familyYear);
    assert.equal(familyYear.value, "2023 POKEMON");
    assert.match(harness.container.textContent ?? "", /immutable exact source year remains 2023 POKEMON/i);
    await act(async () => {
      Simulate.change(selector, { target: { value: "TRAINER" } } as unknown as Parameters<typeof Simulate.change>[1]);
      Simulate.change(familyYear, { target: { value: "2023" } } as unknown as Parameters<typeof Simulate.change>[1]);
    });
    assert.equal(selector.value, "TRAINER");
    assert.equal(familyYear.value, "2023");
    const save = buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS");
    assert.ok(save);
    assert.equal(save.disabled, false);
    await act(async () => fire(save, "click"));
    await waitFor(() => harness.savedMaps.length === 1, "Legacy Pokémon dual save did not settle");
    assert.equal(selector.disabled, true);
    assert.equal(selector.value, "TRAINER");
    assert.match(harness.container.textContent ?? "", /FAMILY \+ EXACT MAPS SAVED ATOMICALLY/);
    assert.match(harness.container.textContent ?? "", /committed by this successful atomic save/);
    const body = JSON.parse(String(harness.requests[0].init?.body));
    assert.equal(body.familyLayoutType, "TRAINER");
    assert.equal(body.familyYear, "2023");
  } finally {
    await harness.cleanup();
  }
});

test("locked Pokémon layout renders immutable authority provenance", async () => {
  const authoritativeSource: SpeedsterTrainSource = {
    ...source,
    cardProfile: "POKEMON",
    identity: {
      cardName: "Squirtle",
      year: "2023",
      productSet: "MEW EN",
      parallel: "REVERSE HOLO",
      cardNumber: "007/165",
    },
    familyLayoutType: "POKEMON",
    familyLayoutAuthority: {
      source: "LEGACY_SOURCE_AUTHORITY",
      selectedByAdminId: "admin-layout-owner-1",
      createdAt: "2026-08-13T20:00:00.000Z",
    },
  };
  const harness = await mount(loadedMap(), undefined, authoritativeSource);
  try {
    const selector = harness.container.querySelector<HTMLSelectElement>('[aria-label="Family map layout type"]');
    assert.equal(selector?.disabled, true);
    assert.equal(selector?.value, "POKEMON");
    assert.match(harness.container.textContent ?? "", /LEGACY_SOURCE_AUTHORITY · selected by admin-layout-owner-1 · 2026-08-13T20:00:00.000Z/);
  } finally {
    await harness.cleanup();
  }
});

test("hash-invalid prior map stays out of the editing baseline while draft recovery remains available", async () => {
  const harness = await mount({
    status: "INTEGRITY_ERROR",
    scope: "FAMILY",
    name: "2021 Sports Panini Obsidian Orange",
    revision: null,
    revisions: [],
    editable: null,
    integrity: {
      code: "CARD_MAP_INTEGRITY_FAILURE",
      message: "Map revision hash verification failed.",
    },
  });
  try {
    const copy = harness.container.textContent ?? "";
    assert.match(copy, /PRIOR MAP INTEGRITY ERROR · SAFE REPAIR MODE/);
    assert.match(copy, /was not loaded/i);
    assert.match(copy, /will not be rewritten/i);
    assert.ok(buttonByText(harness.container, "Import Card Map Draft"));
    assert.doesNotMatch(copy, /EDITING BASELINE/);
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
    assert.equal(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")?.disabled, true);
    assert.match(harness.container.textContent ?? "", /Front boundary 4\/4 invalid/);
    await act(async () => fire(buttonByText(harness.container, "Undo last Front edit")!, "click"));
    assert.equal(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")?.disabled, false);

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
    assert.equal(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")?.disabled, true);
    assert.match(harness.container.textContent ?? "", /anchors 4\/4 ·/);
    await act(async () => fire(buttonByText(harness.container, "Undo last Front edit")!, "click"));
    assert.equal(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")?.disabled, false);

    await act(async () => fire(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")!, "click"));
    await waitFor(() => harness.savedMaps.length === 1, "Card map save did not settle");
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].url, "/api/admin/ai-grader-v2/maps/save");
    const body = JSON.parse(String(harness.requests[0].init?.body)) as Record<string, any>;
    assert.deepEqual(Object.keys(body).sort(), ["back", "front", "sessionId"]);
    assert.equal("scope" in body, false);
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
    assert.match(harness.container.textContent ?? "", /FAMILY \+ EXACT MAPS SAVED ATOMICALLY/);
    assert.match(harness.container.textContent ?? "", /Family r3/);
    assert.match(harness.container.textContent ?? "", /Exact r5/);
  } finally {
    await harness.cleanup();
  }
});

test("one save creates both complete maps and family guidance remains nonblocking", async () => {
  const base = loadedMap();
  const map: SpeedsterTrainMapState = {
    ...base,
    scope: "FAMILY",
    name: "2021 Panini Obsidian Orange",
    editable: base.editable ? {
      ...base.editable,
      front: {
        ...base.editable.front,
        zones: base.editable.front.zones.map((zone) => ({ ...zone, semanticType: "PRINT_ARTWORK" as const })),
      },
    } : null,
  };
  const harness = await mount(map);
  try {
    const copy = harness.container.textContent ?? "";
    assert.match(copy, /CARD MAP · FAMILY \+ EXACT/);
    assert.match(copy, /Family Card Map/);
    assert.match(copy, /Exact Source Map/);
    assert.match(copy, /2021 Sports Panini Obsidian Orange/);
    assert.match(copy, /CHECK FAMILY LANDMARKS/);
    assert.match(copy, /one anchor per quadrant/);
    assert.match(copy, /Location caution/);
    assert.match(copy, /Player\/card name, HP, and card number are also unsafe/);
    assert.match(copy, /Shared frame\/layout landmarks remain safe, including at the top or bottom/);
    assert.match(copy, /V2 PADDED FILTERING · OWNER-AUTHORIZED/);
    assert.match(copy, /50-card replay remains inconclusive—not passed/);
    assert.match(copy, /Prior eligible v1 Exact and Sports revisions remain unchanged and restorable; legacy Pokémon FAMILY revisions remain historical-only and non-restorable/);
    assert.doesNotMatch(copy, /Saving this v2 policy is blocked/);
    const save = buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS");
    assert.ok(save);
    assert.equal(save.disabled, false, "Family guidance must remain nonblocking");
    await act(async () => fire(save, "click"));
    await waitFor(() => harness.savedMaps.length === 1, "Dual map save did not settle");
    const body = JSON.parse(String(harness.requests[0].init?.body));
    assert.equal("scope" in body, false);
    assert.equal(harness.savedMaps[0].family.scope, "FAMILY");
    assert.equal(harness.savedMaps[0].exact.scope, "EXACT");
  } finally {
    await harness.cleanup();
  }
});

test("loaded exact map is only an editing baseline and has no creation-time promotion choice", async () => {
  const harness = await mount({ ...loadedMap(), scope: "EXACT", name: "Nick Bosa #12" });
  try {
    assert.match(harness.container.textContent ?? "", /EXACT r2 EDITING BASELINE/);
    assert.equal(buttonByText(harness.container, "Promote exact map to family"), undefined);
    assert.match(harness.container.textContent ?? "", /One save creates new Family and Exact revisions/);
  } finally {
    await harness.cleanup();
  }
});

test("unsafe loaded exact baseline shows nonblocking family guidance before dual save", async () => {
  const base = loadedMap();
  const unsafe: SpeedsterTrainMapState = {
    ...base,
    scope: "EXACT",
    name: "Nick Bosa #12",
    editable: base.editable ? {
      ...base.editable,
      front: {
        ...base.editable.front,
        anchors: base.editable.front.anchors.map((anchor, index) => index === 0
          ? { ...anchor, point: { x: 0.5, y: 0.35 } }
          : anchor),
      },
    } : null,
  };
  const harness = await mount(unsafe);
  try {
    assert.match(harness.container.textContent ?? "", /CHECK FAMILY LANDMARKS/);
    assert.match(harness.container.textContent ?? "", /Location caution/);
    assert.equal(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")?.disabled, false);
  } finally {
    await harness.cleanup();
  }
});

test("shared top and bottom frame anchors do not trigger a card-specific location warning", async () => {
  const map = { ...loadedMap(), scope: "FAMILY" as const, name: "2021 Panini Obsidian Orange" };
  const harness = await mount(map);
  try {
    assert.doesNotMatch(harness.container.textContent ?? "", /CHECK FAMILY LANDMARKS/);
    assert.match(harness.container.textContent ?? "", /shared frame or layout landmark in each quadrant/i);
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
    assert.match(harness.container.textContent ?? "", /Content type describes layout only/);
    assert.match(harness.container.textContent ?? "", /Partial overlap and every Smart Mark remain/);
    assert.ok(buttonByText(harness.container, "New Zone"));

    const input = harness.container.querySelector<HTMLInputElement>('input[maxlength="80"]');
    assert.ok(input);
    await act(async () => {
      Simulate.change(
        input,
        { target: { value: "Updated printed text" } } as unknown as Parameters<typeof Simulate.change>[1],
      );
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

    const filterAuthority = Array.from(harness.container.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Filter authority"))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    assert.ok(filterAuthority);
    await act(async () => {
      Simulate.change(
        filterAuthority,
        { target: { checked: false } } as unknown as Parameters<typeof Simulate.change>[1],
      );
    });
    await act(async () => fire(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")!, "click"));
    await waitFor(() => harness.requests.length === 1, "Filter-authority save did not settle");
    const body = JSON.parse(String(harness.requests[0].init?.body));
    const overridden = body.front.zones.find((zone: { id: string }) => zone.id === "front-zone-1");
    assert.equal(overridden.filterAuthority, false);
    assert.equal(overridden.filterAuthoritySource, "HUMAN_OVERRIDE");
  } finally {
    await harness.cleanup();
  }
});

test("save failure preserves every editor point and exposes bounded Retry plus Export Draft", async () => {
  const harness = await mount(loadedMap(), {
    status: 409,
    body: {
      message: "Persisted map content did not verify.",
      code: "CARD_MAP_INTEGRITY_FAILURE",
      diagnostics: { stage: "PERSISTED_HASH_VERIFICATION", scope: "FAMILY", field: "frontMap" },
    },
  });
  try {
    const frontBefore = harness.container
      .querySelector<SVGSVGElement>('[aria-label="FRONT composed card map preview"]')
      ?.querySelectorAll("polygon").length;
    const backBefore = harness.container
      .querySelector<SVGSVGElement>('[aria-label="BACK composed card map preview"]')
      ?.querySelectorAll("polygon").length;
    await act(async () => fire(buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS")!, "click"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry")), "Retry was not shown after save failure");
    assert.match(harness.container.textContent ?? "", /SAVE FAILED — YOUR FULL DRAFT IS STILL HERE/);
    assert.match(harness.container.textContent ?? "", /CARD_MAP_INTEGRITY_FAILURE/);
    assert.match(harness.container.textContent ?? "", /PERSISTED_HASH_VERIFICATION/);
    assert.ok(buttonByText(harness.container, "Export Draft"));
    assert.equal(
      harness.container.querySelector<SVGSVGElement>('[aria-label="FRONT composed card map preview"]')?.querySelectorAll("polygon").length,
      frontBefore,
    );
    assert.equal(
      harness.container.querySelector<SVGSVGElement>('[aria-label="BACK composed card map preview"]')?.querySelectorAll("polygon").length,
      backBefore,
    );
  } finally {
    await harness.cleanup();
  }
});

test("recovered Squirtle legacy draft imports every ordered point and round-trips canonically", () => {
  const fixturePath = new URL(
    "../../../docs/handoffs/artifacts/2026-08-11-squirtle-card-map-draft.recovered.json",
    import.meta.url,
  );
  const recoveredText = readFileSync(fixturePath, "utf8");
  assert.equal(
    createHash("sha256").update(recoveredText).digest("hex"),
    "2b26e12bad7ac5d7098fdce22c2624ba808466639236e82b2c654d6960c954b7",
    "The reviewed recovery artifact must remain byte-identical to the captured browser draft",
  );
  const raw = JSON.parse(recoveredText);
  const squirtleSource = {
    sessionId: raw.source.sourceSessionPathId,
    cardProfile: "POKEMON" as const,
    identity: {
      cardName: "SQUIRTLE",
      year: "2023",
      productSet: "MEW EN",
      parallel: "REVERSE HOLO",
      cardNumber: "007/165",
    },
    front: {
      rectifiedStorageKey: raw.source.sourceEvidence.frontImageKey.replace(/^tenkings-cards\//, ""),
      sourceEvidence: {
        originalStorageKey: "ai-grader-v2/sessions/squirtle/source/front-original.webp",
        rectifiedStorageKey: raw.source.sourceEvidence.frontImageKey.replace(/^tenkings-cards\//, ""),
        inspectionStorageKey: "ai-grader-v2/sessions/squirtle/source/front-inspection.webp",
        inspectionSha256: "a".repeat(64),
      },
    },
    back: {
      rectifiedStorageKey: raw.source.sourceEvidence.backImageKey.replace(/^tenkings-cards\//, ""),
      sourceEvidence: {
        originalStorageKey: "ai-grader-v2/sessions/squirtle/source/back-original.webp",
        rectifiedStorageKey: raw.source.sourceEvidence.backImageKey.replace(/^tenkings-cards\//, ""),
        inspectionStorageKey: "ai-grader-v2/sessions/squirtle/source/back-inspection.webp",
        inspectionSha256: "b".repeat(64),
      },
    },
  };
  const imported = parseCardMapDraft(recoveredText, squirtleSource);
  assert.equal(imported.sides.front.zones.length, 10);
  assert.equal(imported.sides.back.zones.length, 2);
  assert.deepEqual(imported.source.scopes, ["FAMILY", "EXACT"]);
  assert.deepEqual(imported.source.identity, squirtleSource.identity);
  assert.equal(imported.source.provenance.front.rectifiedStorageKey.startsWith("ai-grader-v2/"), true);
  assert.equal(imported.source.provenance.front.originalStorageKey, squirtleSource.front.sourceEvidence.originalStorageKey);
  assert.equal(imported.source.provenance.front.inspectionStorageKey, squirtleSource.front.sourceEvidence.inspectionStorageKey);
  assert.equal(imported.source.provenance.front.evidenceSha256, "a".repeat(64));
  assert.equal(imported.source.provenance.back.evidenceSha256, "b".repeat(64));
  assert.deepEqual(imported.sides.front.anchors.map((anchor) => anchor.id), [
    "front-anchor-1", "front-anchor-2", "front-anchor-3", "front-anchor-4",
  ]);
  assert.deepEqual(imported.sides.back.zones.map((zone) => zone.id), ["back-zone-1", "back-zone-2"]);
  assert.deepEqual(imported.sides.front.designBoundary, {
    kind: "QUAD",
    points: raw.sides.front.printedBoundary,
  });
  assert.deepEqual(imported.sides.front.anchors.map((anchor) => anchor.point), raw.sides.front.registrationAnchors.map(({ x, y }: any) => ({ x, y })));
  assert.deepEqual(imported.sides.front.zones[3].polygon, raw.sides.front.zones[3].points);
  assert.deepEqual(imported.sides.back.zones[1].polygon, raw.sides.back.zones[1].points);
  assert.equal(imported.sides.front.zones.every((zone) => zone.filterAuthority), true);
  const reimported = parseCardMapDraft(serializeCardMapDraft(imported), squirtleSource);
  assert.deepEqual(reimported, imported);
  const selectedSource = {
    ...squirtleSource,
    identity: { ...squirtleSource.identity, layoutType: "POKEMON" as const },
  };
  const rebound = parseCardMapDraft(recoveredText, selectedSource);
  assert.equal("cardName" in rebound.source.identity ? rebound.source.identity.layoutType : null, "POKEMON");
  assert.equal("keyVersion" in rebound.source.familyKey ? rebound.source.familyKey.keyVersion : null, "v2");
  const conflicting = JSON.parse(serializeCardMapDraft(rebound));
  conflicting.source.identity.layoutType = "TRAINER";
  assert.throws(
    () => parseCardMapDraft(JSON.stringify(conflicting), selectedSource),
    /conflicting Pokémon layout authority/,
  );
  assert.deepEqual(cardMapDraftEditableSide(imported.sides.front).zones[0], {
    id: "front-zone-1",
    label: "Card Name",
    semanticType: "PRINT_TEXT",
    contentType: "HEADER",
    filterAuthority: true,
    filterAuthoritySource: "TYPE_DEFAULT",
    filterPaddingMm: 0.6,
    proposalSource: "HUMAN",
    proposalConfidence: null,
    polygon: raw.sides.front.zones[0].points,
  });
});

test("recovered Squirtle file imports into the mounted editor without saving or redrawing", async () => {
  const fixturePath = new URL(
    "../../../docs/handoffs/artifacts/2026-08-11-squirtle-card-map-draft.recovered.json",
    import.meta.url,
  );
  const recoveredText = readFileSync(fixturePath, "utf8");
  const raw = JSON.parse(recoveredText);
  const squirtleSource: SpeedsterTrainSource = {
    sessionId: raw.source.sourceSessionPathId,
    cardProfile: "POKEMON",
    identity: {
      cardName: "SQUIRTLE",
      year: "2023",
      productSet: "MEW EN",
      parallel: "REVERSE HOLO",
      cardNumber: "007/165",
    },
    front: {
      rectifiedUrl: "https://images.example.test/squirtle-front.webp",
      rectifiedStorageKey: raw.source.sourceEvidence.frontImageKey.replace(/^tenkings-cards\//, ""),
      centeringQuad: frontCentering,
      sourceEvidence: {
        originalStorageKey: "ai-grader-v2/sessions/squirtle/source/front-original.webp",
        rectifiedStorageKey: raw.source.sourceEvidence.frontImageKey.replace(/^tenkings-cards\//, ""),
        inspectionStorageKey: "ai-grader-v2/sessions/squirtle/source/front-inspection.webp",
        inspectionSha256: "a".repeat(64),
      },
    },
    back: {
      rectifiedUrl: "https://images.example.test/squirtle-back.webp",
      rectifiedStorageKey: raw.source.sourceEvidence.backImageKey.replace(/^tenkings-cards\//, ""),
      centeringQuad: backCentering,
      sourceEvidence: {
        originalStorageKey: "ai-grader-v2/sessions/squirtle/source/back-original.webp",
        rectifiedStorageKey: raw.source.sourceEvidence.backImageKey.replace(/^tenkings-cards\//, ""),
        inspectionStorageKey: "ai-grader-v2/sessions/squirtle/source/back-inspection.webp",
        inspectionSha256: "b".repeat(64),
      },
    },
  };
  const harness = await mount(missingMap, undefined, squirtleSource);
  try {
    const input = harness.container.querySelector<HTMLInputElement>('[aria-label="Choose Card Map draft file"]');
    assert.ok(input);
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ size: Buffer.byteLength(recoveredText), text: async () => recoveredText }],
    });
    await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
    await waitFor(
      () => (harness.container.textContent ?? "").includes("Draft imported without saving: Front 10 zones · Back 2 zones."),
      "Recovered Squirtle draft did not hydrate the editor",
    );
    assert.equal(harness.requests.length, 0, "Import must never save automatically");
    assert.match(harness.container.textContent ?? "", /Front · READY · 10 zones/);
    assert.match(harness.container.textContent ?? "", /Back · READY · 2 zones/);
    assert.match(harness.container.textContent ?? "", /CURRENT DRAFT RECOVERABLE/);
    const frontPreview = harness.container.querySelector<SVGSVGElement>('[aria-label="FRONT composed card map preview"]');
    assert.equal(frontPreview?.querySelectorAll("polygon").length, 11, "Front boundary plus all ten zones must render");
  } finally {
    await harness.cleanup();
  }
});

test("draft validation rejects another source before replacing editor state", () => {
  const upgrade = (zone: ReturnType<typeof sideFixture>["zones"][number]) => ({
    ...zone,
    contentType: "OTHER" as const,
    filterAuthority: true,
    filterAuthoritySource: "TYPE_DEFAULT" as const,
    filterPaddingMm: 0.6 as const,
    proposalSource: "HUMAN" as const,
    proposalConfidence: null,
  });
  const draft = createCardMapDraft({
    source,
    front: { ...sideFixture("front"), zones: sideFixture("front").zones.map(upgrade) },
    back: { ...sideFixture("back"), zones: sideFixture("back").zones.map(upgrade) },
  });
  assert.throws(
    () => parseCardMapDraft(serializeCardMapDraft(draft), { ...source, sessionId: "different-source-session-12345" }),
    /different source card session/,
  );
});
