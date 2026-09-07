import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
// @ts-expect-error The repository lifecycle harness uses jsdom without a workspace declaration package.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION,
  parseSpeedsterCaptureRegistrationDraft,
  speedsterCaptureDraftMatchesCommittedSession,
  speedsterCaptureRegistrationDraftStorageKey,
  type SpeedsterCaptureRegistrationDraft,
} from "../lib/ai-grader-v2/capture-registration-draft";

const require = createRequire(import.meta.url);
(globalThis as typeof globalThis & { React: typeof React }).React = React;
process.env.NEXT_PUBLIC_ADMIN_USER_IDS = "card-maps-admin,card-maps-admin-2";

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
    isReady: true,
    query: routerQuery,
    async push(url: string) { routerPushes.push(url); return true; },
    async replace() { return true; },
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
      {Object.entries(props.fieldErrors ?? {}).map(([field, error]) => <span key={field}>{error}</span>)}
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

const colorGeometryEvidence = (side: "FRONT" | "BACK") => ([
  {
    side,
    sourceImageStorageKey: `${side.toLowerCase()}-original`,
    mode: "PHYSICAL_OUTER",
    matColor: side === "FRONT" ? "BLACK" : "WHITE",
    result: { marker: `${side.toLowerCase()}-physical-result` },
    serverReceipt: `${side.toLowerCase()}-physical-receipt`,
    confirmedQuad: quad,
  },
  {
    side,
    sourceImageStorageKey: `${side.toLowerCase()}-original`,
    mode: "PRINTED_FRAME",
    matColor: side === "FRONT" ? "BLACK" : "WHITE",
    result: { marker: `${side.toLowerCase()}-printed-result` },
    serverReceipt: `${side.toLowerCase()}-printed-receipt`,
    confirmedQuad: quad,
  },
] as const);

const captureBundle = {
  sessionId: "new-card-map-session",
  cardProfile: "SPORTS",
  cornerShape: "ROUNDED_3_18_MM",
  front: {
    originalStorageKey: "front-original",
    rectifiedStorageKey: "front-rectified",
    inspectionStorageKey: "front-inspection",
    inspectionFrame: { width: 1200, height: 1600, cardBounds: { x: 0, y: 0, width: 1200, height: 1600 } },
    viewStorageKeys: { NORMALIZED: "front-normalized", MICRO_DEFECT: "front-micro", DIRECTIONAL: "front-directional" },
    sourceCorners: quad,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    centeringQuad: quad,
    centeringBorders: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    rectifiedUrl: "https://images.example.test/front.png",
    mapRegistration: { mapRevisionId: "revision-7", sourcePhysicalQuadSha256: "front-hash" },
    colorGeometryEvidence: colorGeometryEvidence("FRONT"),
  },
  back: {
    originalStorageKey: "back-original",
    rectifiedStorageKey: "back-rectified",
    inspectionStorageKey: "back-inspection",
    inspectionFrame: { width: 1200, height: 1600, cardBounds: { x: 0, y: 0, width: 1200, height: 1600 } },
    viewStorageKeys: { NORMALIZED: "back-normalized", MICRO_DEFECT: "back-micro", DIRECTIONAL: "back-directional" },
    sourceCorners: quad,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    centeringQuad: quad,
    centeringBorders: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
    rectifiedUrl: "https://images.example.test/back.png",
    mapRegistration: { mapRevisionId: "revision-7", sourcePhysicalQuadSha256: "back-hash" },
    colorGeometryEvidence: colorGeometryEvidence("BACK"),
  },
};

stubModule("../components/ai-grader-v2/CaptureWorkspace", {
  CaptureWorkspace: ({ onReady }: {
    onReady: (bundle: typeof captureBundle) => Promise<{
      saved: boolean;
      message?: string;
      colorGeometryReceiptExpired?: { side: "FRONT" | "BACK"; mode: "PHYSICAL_OUTER" | "PRINTED_FRAME" };
    }> | {
      saved: boolean;
      message?: string;
      colorGeometryReceiptExpired?: { side: "FRONT" | "BACK"; mode: "PHYSICAL_OUTER" | "PRINTED_FRAME" };
    };
  }) => {
    const [failed, setFailed] = React.useState(false);
    const [recovery, setRecovery] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    return (
      <>
        <button type="button" disabled={saving} onClick={() => {
          if (saving) return;
          setSaving(true);
          void Promise.resolve(onReady(captureBundle))
            .then((result) => {
              setFailed(!result.saved);
              setRecovery(result.colorGeometryReceiptExpired
                ? `${result.colorGeometryReceiptExpired.side} ${result.colorGeometryReceiptExpired.mode}`
                : null);
            })
            .finally(() => setSaving(false));
        }}>{saving ? "SAVING CAPTURE" : failed ? "RETRY CAPTURE SAVE" : "COMPLETE FRONT + BACK"}</button>
        {recovery ? <span>EXACT COLOR RECOVERY · {recovery}</span> : null}
      </>
    );
  },
  SpeedsterAppliedMapBadge: () => <div>APPLIED MAP BADGE</div>,
});
stubModule("../components/ai-grader-v2/ReviewWorkspace", {
  ReviewWorkspace: () => <div data-testid="reconciled-review-workspace">RECONCILED REVIEW WORKSPACE</div>,
});
stubModule("../components/ai-grader-v2/SpeedsterTrainWorkspace", {
  SpeedsterTrainWorkspace: ({ source, initialMap }: {
    source: { sessionId: string };
    initialMap: { status: string };
  }) => (
    <div data-testid="card-map-workspace">CARD MAP WORKSPACE · {source.sessionId} · {initialMap.status}</div>
  ),
});

const { default: CardMapsPage } = require("../pages/card-maps") as typeof import("../pages/card-maps");
const { default: AiGraderV2AdminPage } = require("../pages/admin/ai-grader-v2") as typeof import("../pages/admin/ai-grader-v2");

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
  updateSession: (input: Readonly<{ token: string; userId: string }> | null) => Promise<void>;
  cleanup: () => Promise<void>;
};

async function mountPage(input: {
  query?: Record<string, string | string[] | undefined>;
  userId?: string;
  token?: string;
  mappedCards?: readonly unknown[];
  mappedIncidents?: readonly unknown[];
  mappedCardsFetchImpl?: typeof fetch;
  initialLocalStorage?: Readonly<Record<string, string>>;
  renderPage?: () => React.ReactElement;
  fetchImpl: typeof fetch;
}): Promise<MountedPage> {
  routerQuery = input.query ?? {};
  routerPushes.length = 0;
  sessionState = {
    session: { token: input.token ?? "admin-token", user: { id: input.userId ?? "card-maps-admin", phone: null } },
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
    fetch: {
      configurable: true,
      value: (request: RequestInfo | URL, init?: RequestInit) => String(request) === "/api/admin/ai-grader-v2/maps/list"
        ? input.mappedCardsFetchImpl?.(request, init)
          ?? Promise.resolve(jsonResponse({ cards: input.mappedCards ?? [], incidents: input.mappedIncidents ?? [] }))
        : input.fetchImpl(request, init),
    },
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
  for (const [key, value] of Object.entries(input.initialLocalStorage ?? {})) {
    dom.window.localStorage.setItem(key, value);
  }
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  const renderPage = () => input.renderPage?.() ?? <CardMapsPage />;
  await act(async () => { root.render(renderPage()); });
  return {
    container,
    root,
    updateSession: async (nextSession) => {
      sessionState = {
        session: nextSession
          ? { token: nextSession.token, user: { id: nextSession.userId, phone: null } }
          : null,
        loading: false,
        async ensureSession() {},
      };
      await act(async () => { root.render(renderPage()); });
    },
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

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolver) => { resolve = resolver; });
  return { promise, resolve } as const;
}

function mappedPokemonCard(sourceSessionId: string, cardName: string) {
  return {
    sourceSessionId,
    cardProfile: "POKEMON",
    workflowState: "CAPTURED",
    identity: {
      cardName,
      year: "2023",
      productSet: "MEW EN",
      parallel: "REVERSE HOLO",
      cardNumber: cardName === "SQUIRTLE" ? "007/165" : "001/165",
    },
    lastMappedAt: "2026-08-12T19:40:31.391Z",
    revisions: [],
  } as const;
}

function committedNoMapDraft(
  sessionId: string,
  surface: SpeedsterCaptureRegistrationDraft["surface"] = "CARD_MAPS",
): SpeedsterCaptureRegistrationDraft {
  const side = (cardSide: "FRONT" | "BACK") => ({
    originalStorageKey: `${cardSide.toLowerCase()}-original`,
    corners: quad,
    automaticGeometry: true,
    geometryDiagnostic: { sessionId, attemptId: 1, side: cardSide, durationMs: 10, corners: "present" as const },
    rectifiedStorageKey: `${cardSide.toLowerCase()}-rectified`,
    inspectionStorageKey: `${cardSide.toLowerCase()}-inspection`,
    inspectionFrame: { width: 1200, height: 1600, cardBounds: { x: 0, y: 0, width: 1200, height: 1600 } },
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    viewStorageKeys: {
      NORMALIZED: `${cardSide.toLowerCase()}-normalized`,
      MICRO_DEFECT: `${cardSide.toLowerCase()}-micro`,
      DIRECTIONAL: `${cardSide.toLowerCase()}-directional`,
    },
    proposedCentering: quad,
    detectedBorders: ["top", "right", "bottom", "left"] as const,
    centering: {
      side: cardSide,
      innerQuad: quad,
      borders: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
    },
  });
  return {
    version: SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION,
    createdAtMs: Date.now() - 100,
    updatedAtMs: Date.now(),
    surface,
    sessionId,
    cardProfile: "SPORTS",
    mapBindingStatus: "NO_MAP",
    activeMapRevisionId: null,
    activeMapScope: null,
    activeMapName: null,
    cornerShape: "ROUNDED_3_18_MM",
    stage: "BACK_CENTERING",
    front: side("FRONT"),
    back: side("BACK"),
    interruptions: {},
    failures: {},
    failureRequestIds: {},
    provisional: {},
    registrationRecordedAtMs: {},
    attemptIds: {},
    operationId: "00000000-0000-4000-8000-000000000101",
    attemptNumbers: {},
    decisionIds: {
      continue: "00000000-0000-4000-8000-000000000102",
      abandonObsoleteMap: "00000000-0000-4000-8000-000000000103",
      retry: {},
    },
    correctedAnchors: {},
    registrationFailureSides: {},
    mapRegistrationFailed: false,
    mapAuthorityAbandoned: false,
    captureSavePendingRetry: true,
    notice: null,
  };
}

function persistedCaptureForDraft(draft: SpeedsterCaptureRegistrationDraft) {
  const side = (value: SpeedsterCaptureRegistrationDraft["front"]) => ({
    originalStorageKey: value.originalStorageKey,
    rectifiedStorageKey: value.rectifiedStorageKey,
    inspectionStorageKey: value.inspectionStorageKey,
    inspectionFrame: value.inspectionFrame,
    viewStorageKeys: value.viewStorageKeys,
    sourceCorners: value.corners,
    transform: value.transform,
    centeringQuad: value.centering!.innerQuad,
    centeringBorders: value.centering!.borders,
  });
  return { cornerShape: draft.cornerShape, front: side(draft.front), back: side(draft.back) };
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

test("Card Maps owns a searchable list containing only saved mapped source cards", async () => {
  const sourceSessionId = "mapped-source-session-0001";
  const page = await mountPage({
    mappedCards: [{
      sourceSessionId,
      cardProfile: "POKEMON",
      workflowState: "CAPTURED",
      identity: {
        cardName: "SQUIRTLE",
        year: "2023",
        productSet: "MEW EN",
        parallel: "REVERSE HOLO",
        cardNumber: "007/165",
      },
      lastMappedAt: "2026-08-12T19:40:31.391Z",
      revisions: [
        {
          scope: "EXACT",
          keyGeneration: "EXACT_FROZEN",
          layoutType: null,
          runtimeEligible: true,
          mapId: "exact-map",
          revisionId: "exact-r3",
          version: 3,
          revisionHash: "a".repeat(64),
          mapSchemaVersion: "speedster-card-type-map-v2",
          filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
          createdAt: "2026-08-12T19:40:31.391Z",
        },
        {
          scope: "FAMILY",
          keyGeneration: "FAMILY_LEGACY",
          layoutType: null,
          runtimeEligible: false,
          mapId: "legacy-family-map",
          revisionId: "legacy-family-r99",
          version: 99,
          revisionHash: "c".repeat(64),
          mapSchemaVersion: "speedster-card-type-map-v2",
          filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
          createdAt: "2026-08-12T19:40:31.392Z",
        },
        {
          scope: "FAMILY",
          keyGeneration: "FAMILY_V2",
          layoutType: "POKEMON",
          runtimeEligible: true,
          mapId: "family-map",
          revisionId: "family-r7",
          version: 7,
          revisionHash: "b".repeat(64),
          mapSchemaVersion: "speedster-card-type-map-v2",
          filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
          createdAt: "2026-08-12T19:40:31.343Z",
        },
      ],
    }],
    fetchImpl: async (request) => { throw new Error(`Unexpected fetch: ${String(request)}`); },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("SQUIRTLE") ?? false, "Mapped source card list did not load");
    assert.match(page.container.textContent ?? "", /EXISTING CARD MAPS/);
    assert.match(page.container.textContent ?? "", /1 of 1 mapped source card/);
    assert.match(page.container.textContent ?? "", /2023 · Pokémon · POKEMON · MEW EN · REVERSE HOLO · #007\/165/);
    assert.match(page.container.textContent ?? "", /EXACT r3/);
    assert.match(page.container.textContent ?? "", /FAMILY r7 · POKEMON/);
    assert.match(page.container.textContent ?? "", /FAMILY LEGACY r99 · HISTORICAL ONLY · NOT RUNTIME ELIGIBLE/);
    const edit = Array.from(page.container.querySelectorAll("a")).find((link) => link.textContent === "EDIT CARD MAP");
    assert.equal(edit?.getAttribute("href"), `/card-maps?sessionId=${encodeURIComponent(sourceSessionId)}`);

    await changeInput(page.container, "Search existing Card Maps", "Mewtwo");
    assert.match(page.container.textContent ?? "", /NO MATCHING CARD MAPS/);
    assert.doesNotMatch(page.container.textContent ?? "", /SQUIRTLE/);

    await changeInput(page.container, "Search existing Card Maps", "reverse holo");
    assert.match(page.container.textContent ?? "", /SQUIRTLE/);
  } finally {
    await page.cleanup();
  }
});

test("mapped library keeps valid cards visible while invalid rows are visibly quarantined", async () => {
  const page = await mountPage({
    mappedCards: [mappedPokemonCard("valid-map-source", "SQUIRTLE")],
    mappedIncidents: [{
      mapId: "invalid-map-1",
      currentRevisionId: "invalid-revision-1",
      code: "CARD_MAP_INTEGRITY_FAILURE",
      message: "Card Map revision hash verification failed.",
    }],
    fetchImpl: async (request) => { throw new Error(`Unexpected fetch: ${String(request)}`); },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("SQUIRTLE") ?? false, "Valid map row did not remain visible");
    assert.match(page.container.textContent ?? "", /1 CARD MAP ROW QUARANTINED/);
    assert.match(page.container.textContent ?? "", /invalid-map-1/);
    assert.match(page.container.textContent ?? "", /invalid-revision-1/);
    assert.match(page.container.textContent ?? "", /hash verification failed/);
  } finally {
    await page.cleanup();
  }
});

test("mapped legacy sources expose and search authoritative TRAINER and ENERGY family layouts", async () => {
  const mappedLayoutCard = (sourceSessionId: string, cardName: string, layoutType: "TRAINER" | "ENERGY") => ({
    ...mappedPokemonCard(sourceSessionId, cardName),
    revisions: [{
      scope: "FAMILY" as const,
      keyGeneration: "FAMILY_V2" as const,
      layoutType,
      runtimeEligible: true,
      mapId: `${layoutType.toLowerCase()}-family-map`,
      revisionId: `${layoutType.toLowerCase()}-family-r1`,
      version: 1,
      revisionHash: (layoutType === "TRAINER" ? "d" : "e").repeat(64),
      mapSchemaVersion: "speedster-card-type-map-v2",
      filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
      createdAt: "2026-08-13T20:00:00.000Z",
    }],
  });
  const page = await mountPage({
    mappedCards: [
      mappedLayoutCard("trainer-layout-source", "BILL'S TRANSFER", "TRAINER"),
      mappedLayoutCard("energy-layout-source", "BASIC FIRE ENERGY", "ENERGY"),
    ],
    fetchImpl: async (request) => { throw new Error(`Unexpected fetch: ${String(request)}`); },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("BILL'S TRANSFER") ?? false, "Layout cards did not load");
    assert.match(page.container.textContent ?? "", /Pokémon · TRAINER/);
    assert.match(page.container.textContent ?? "", /Pokémon · ENERGY/);
    await changeInput(page.container, "Search existing Card Maps", "trainer");
    assert.match(page.container.textContent ?? "", /BILL'S TRANSFER/);
    assert.doesNotMatch(page.container.textContent ?? "", /BASIC FIRE ENERGY/);
    await changeInput(page.container, "Search existing Card Maps", "energy");
    assert.doesNotMatch(page.container.textContent ?? "", /BILL'S TRANSFER/);
    assert.match(page.container.textContent ?? "", /BASIC FIRE ENERGY/);
  } finally {
    await page.cleanup();
  }
});

test("Sports FAMILY_CURRENT is never labeled or searched as legacy Pokémon history", async () => {
  const sportsCard = {
    sourceSessionId: "sports-current-family-source",
    cardProfile: "SPORTS",
    workflowState: "CAPTURED",
    identity: {
      playerName: "Ken Griffey Jr.",
      year: "1997",
      manufacturer: "Upper Deck",
      productSet: "SPx",
      insert: "Base",
      parallel: "Gold",
      cardNumber: "1",
    },
    lastMappedAt: "2026-08-15T20:00:00.000Z",
    revisions: [{
      scope: "FAMILY",
      keyGeneration: "FAMILY_CURRENT",
      layoutType: null,
      runtimeEligible: true,
      mapId: "sports-family-map",
      revisionId: "sports-family-r4",
      version: 4,
      revisionHash: "f".repeat(64),
      mapSchemaVersion: "speedster-card-type-map-v2",
      filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
      createdAt: "2026-08-15T20:00:00.000Z",
    }],
  } as const;
  const legacyPokemonCard = {
    ...mappedPokemonCard("pokemon-legacy-family-source", "CHARMANDER"),
    revisions: [{
      scope: "FAMILY",
      keyGeneration: "FAMILY_LEGACY",
      layoutType: null,
      runtimeEligible: false,
      mapId: "pokemon-legacy-family-map",
      revisionId: "pokemon-legacy-family-r9",
      version: 9,
      revisionHash: "9".repeat(64),
      mapSchemaVersion: "speedster-card-type-map-v2",
      filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
      createdAt: "2026-08-15T20:00:00.000Z",
    }],
  } as const;
  const page = await mountPage({
    mappedCards: [sportsCard, legacyPokemonCard],
    fetchImpl: async (request) => { throw new Error(`Unexpected fetch: ${String(request)}`); },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("Ken Griffey Jr.") ?? false, "Sports card did not load");
    assert.match(page.container.textContent ?? "", /FAMILY r4/);
    assert.match(page.container.textContent ?? "", /FAMILY LEGACY r9 · HISTORICAL ONLY · NOT RUNTIME ELIGIBLE/);

    await changeInput(page.container, "Search existing Card Maps", "legacy");
    assert.match(page.container.textContent ?? "", /CHARMANDER/);
    assert.doesNotMatch(page.container.textContent ?? "", /Ken Griffey Jr\./);

    await changeInput(page.container, "Search existing Card Maps", "family_current");
    assert.match(page.container.textContent ?? "", /Ken Griffey Jr\./);
    assert.doesNotMatch(page.container.textContent ?? "", /CHARMANDER/);
    assert.doesNotMatch(page.container.textContent ?? "", /FAMILY LEGACY/);
  } finally {
    await page.cleanup();
  }
});

test("switching admins immediately clears the prior creator's mapped rows while the new list is pending", async () => {
  const adminB = deferredResponse();
  let calls = 0;
  const page = await mountPage({
    userId: "card-maps-admin",
    token: "admin-a-token",
    mappedCardsFetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ cards: [mappedPokemonCard("admin-a-source-session", "SQUIRTLE")], incidents: [] })
        : adminB.promise;
    },
    fetchImpl: async (request) => { throw new Error(`Unexpected fetch: ${String(request)}`); },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("SQUIRTLE") ?? false, "Admin A list did not load");
    await page.updateSession({ token: "admin-b-token", userId: "card-maps-admin-2" });
    assert.doesNotMatch(page.container.textContent ?? "", /SQUIRTLE/);
    assert.match(page.container.textContent ?? "", /Loading saved Card Maps/);

    adminB.resolve(jsonResponse({ cards: [mappedPokemonCard("admin-b-source-session", "BULBASAUR")], incidents: [] }));
    await waitFor(() => page.container.textContent?.includes("BULBASAUR") ?? false, "Admin B list did not load");
    assert.doesNotMatch(page.container.textContent ?? "", /SQUIRTLE/);
  } finally {
    await page.cleanup();
  }
});

test("a late prior-admin mapped-list response cannot overwrite the current admin", async () => {
  const adminA = deferredResponse();
  const adminB = deferredResponse();
  let calls = 0;
  const page = await mountPage({
    userId: "card-maps-admin",
    token: "admin-a-token",
    mappedCardsFetchImpl: async () => {
      calls += 1;
      return calls === 1 ? adminA.promise : adminB.promise;
    },
    fetchImpl: async (request) => { throw new Error(`Unexpected fetch: ${String(request)}`); },
  });
  try {
    await waitFor(() => calls === 1, "Admin A request did not start");
    await page.updateSession({ token: "admin-b-token", userId: "card-maps-admin-2" });
    await waitFor(() => calls === 2, "Admin B request did not start");

    adminB.resolve(jsonResponse({ cards: [mappedPokemonCard("admin-b-source-session", "BULBASAUR")], incidents: [] }));
    await waitFor(() => page.container.textContent?.includes("BULBASAUR") ?? false, "Admin B list did not load");

    adminA.resolve(jsonResponse({ cards: [mappedPokemonCard("admin-a-source-session", "SQUIRTLE")], incidents: [] }));
    await act(async () => { await adminA.promise; await Promise.resolve(); });
    assert.match(page.container.textContent ?? "", /BULBASAUR/);
    assert.doesNotMatch(page.container.textContent ?? "", /SQUIRTLE/);
  } finally {
    await page.cleanup();
  }
});

test("blank new-card identity shows exact field errors without making a request", async () => {
  const requests: string[] = [];
  const page = await mountPage({
    fetchImpl: async (request) => { requests.push(String(request)); throw new Error("unexpected fetch"); },
  });
  try {
    assert.match(page.container.textContent ?? "", /Family Card Map — all cards matching this Year, Set, and Parallel/);
    assert.match(page.container.textContent ?? "", /Exact Source Map — this exact card only/);
    assert.equal(page.container.querySelector('input[name="card-map-scope"]'), null);
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

test("historical layoutless Pokémon DRAFT recovery mounts only for durable NO_MAP and blocks failed authority", async () => {
  const cases = [
    {
      name: "missing",
      response: jsonResponse({
        authority: { status: "NO_MAP", message: "No eligible map exists." },
        map: { status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null },
      }),
      message: /Preserved Card Maps capture and durable authority loaded/,
      mounts: true,
    },
    {
      name: "integrity",
      response: jsonResponse({ authority: { status: "INTEGRITY_ERROR", message: "Hash mismatch" }, message: "Hash mismatch" }, 409),
      message: /Hash mismatch/,
      mounts: false,
    },
    {
      name: "lookup-failed",
      response: jsonResponse({ authority: { status: "LOOKUP_FAILED", message: "Map service unavailable" }, message: "Map service unavailable" }, 503),
      message: /Map service unavailable/,
      mounts: false,
    },
  ] as const;
  for (const candidate of cases) {
    const sessionId = `legacy-layoutless-draft-${candidate.name}`;
    const page = await mountPage({
      query: { captureDraftId: sessionId },
      fetchImpl: async (request) => {
        const url = String(request);
        if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}`) {
          return jsonResponse({ session: {
            id: sessionId,
            cardProfile: "POKEMON",
            workflowState: "DRAFT",
            identity: {
              cardName: "Squirtle",
              year: "2023",
              productSet: "MEW EN",
              parallel: "REVERSE HOLO",
              cardNumber: "007/165",
            },
          } });
        }
        if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}/map-authority`) {
          return candidate.response.clone();
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });
    try {
      await waitFor(() => candidate.mounts
        ? Boolean(buttonByText(page.container, "COMPLETE FRONT + BACK"))
        : Boolean(buttonByText(page.container, "RETRY CARD MAP AUTHORITY")),
      `${candidate.name} historical DRAFT did not resolve to the expected authority UI`);
      assert.match(page.container.textContent ?? "", candidate.message);
      assert.equal(Boolean(buttonByText(page.container, "COMPLETE FRONT + BACK")), candidate.mounts);
    } finally {
      await page.cleanup();
    }
  }
});

test("Card Maps explicitly reconciles an exactly committed capture after a lost save response", async () => {
  const sessionId = "card-maps-committed-ack-loss";
  const browserDraft = committedNoMapDraft(sessionId);
  const storageKey = speedsterCaptureRegistrationDraftStorageKey(sessionId);
  const rawBrowserDraft = JSON.stringify(browserDraft);
  const requests: string[] = [];
  const missingMap = { status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null };
  const parsedBrowserDraft = parseSpeedsterCaptureRegistrationDraft(JSON.stringify(browserDraft), {
    surface: "CARD_MAPS",
    sessionId,
    cardProfile: "SPORTS",
    mapBindingStatus: "NO_MAP",
    activeMapRevisionId: null,
    activeMapScope: null,
  });
  assert.ok(parsedBrowserDraft, "Card Maps committed fixture must satisfy the strict browser-draft contract");
  assert.equal(speedsterCaptureDraftMatchesCommittedSession(parsedBrowserDraft, {
    workflowState: "CAPTURED",
    capture: persistedCaptureForDraft(browserDraft),
    mapRevisionId: null,
    mapRegistration: null,
  }), true, "Card Maps committed fixture must exactly match server persistence");
  const page = await mountPage({
    query: { captureDraftId: sessionId },
    initialLocalStorage: { [storageKey]: rawBrowserDraft },
    fetchImpl: async (request) => {
      const url = String(request);
      requests.push(url);
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}`) {
        return jsonResponse({ session: {
          id: sessionId,
          cardProfile: "SPORTS",
          workflowState: "CAPTURED",
          identity: { playerName: "Ken Griffey Jr.", year: "1997", manufacturer: "Upper Deck", productSet: "SPx" },
          capture: persistedCaptureForDraft(browserDraft),
          mapRevisionId: null,
          mapRegistration: null,
        } });
      }
      if (url === `/api/admin/ai-grader-v2/maps/current?sessionId=${sessionId}&scope=EFFECTIVE`) {
        return jsonResponse({ map: missingMap });
      }
      if (url === `/api/admin/ai-grader-v2/maps/source?sessionId=${sessionId}&scope=EXACT`) {
        return jsonResponse({
          map: missingMap,
          source: {
            sessionId,
            cardProfile: "SPORTS",
            identity: { playerName: "Ken Griffey Jr.", year: "1997", manufacturer: "Upper Deck", productSet: "SPx" },
            front: { rectifiedUrl: "front", centeringQuad: quad },
            back: { rectifiedUrl: "back", centeringQuad: quad },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  try {
    await waitFor(() => requests.includes(`/api/admin/ai-grader-v2/maps/current?sessionId=${sessionId}&scope=EFFECTIVE`),
      "Committed capture reconciliation did not finish its read-only map lookup");
    assert.match(page.container.textContent ?? "", /CAPTURE SAVE COMMITTED · EXPLICIT RECONCILIATION/);
    assert.match(page.container.textContent ?? "", /server Front \+ Back source exactly matches/i);
    assert.ok(window.localStorage.getItem(storageKey), "Committed match must not clear browser evidence before choice");
    assert.equal(requests.filter((url) => url.includes(`/sessions/${sessionId}`)).length, 1, "Reconciliation must not retry PATCH");

    await act(async () => buttonByText(page.container, "KEEP BROWSER DRAFT FOR NOW")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.ok(window.localStorage.getItem(storageKey), "Keep choice must retain the browser draft");

    await act(async () => buttonByText(page.container, "CONTINUE TO MAP AUTHORING")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(page.container.querySelector('[data-testid="card-map-workspace"]')), "Committed source did not continue to authoring");
    assert.equal(window.localStorage.getItem(storageKey), null, "Explicit continuation must clear only the verified obsolete browser draft");
    assert.equal(requests.some((url) => url.includes(`/sessions/${sessionId}`) && url !== `/api/admin/ai-grader-v2/sessions/${sessionId}`), false);
  } finally {
    await page.cleanup();
  }
});

test("Card Maps preserves a committed browser draft when server capture evidence conflicts", async () => {
  const sessionId = "card-maps-committed-conflict";
  const browserDraft = committedNoMapDraft(sessionId);
  const storageKey = speedsterCaptureRegistrationDraftStorageKey(sessionId);
  const rawBrowserDraft = JSON.stringify(browserDraft);
  const conflictingCapture = persistedCaptureForDraft(browserDraft);
  conflictingCapture.front.originalStorageKey = "different-server-front";
  const page = await mountPage({
    query: { captureDraftId: sessionId },
    initialLocalStorage: { [storageKey]: rawBrowserDraft },
    fetchImpl: async (request) => {
      const url = String(request);
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}`) {
        return jsonResponse({ session: {
          id: sessionId,
          cardProfile: "SPORTS",
          workflowState: "CAPTURED",
          identity: { playerName: "Ken Griffey Jr.", year: "1997", manufacturer: "Upper Deck", productSet: "SPx" },
          capture: conflictingCapture,
          mapRevisionId: null,
          mapRegistration: null,
        } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  try {
    await waitFor(() => /does not match the preserved Card Maps browser draft/i.test(page.container.textContent ?? ""),
      "Committed capture conflict did not fail visibly");
    assert.equal(buttonByText(page.container, "CONTINUE TO MAP AUTHORING"), undefined);
    assert.equal(window.localStorage.getItem(storageKey), rawBrowserDraft, "Conflict must preserve browser evidence byte-for-byte");
    assert.equal(page.container.querySelector('[aria-label="identity editor"]'), null, "Recovery conflict must hide fresh identity authoring");
    assert.equal(buttonByText(page.container, "CREATE CARD MAP"), undefined, "Recovery conflict must hide the hero create CTA");
    assert.equal(buttonByText(page.container, "COMPLETE FRONT + BACK"), undefined, "Recovery conflict must not mount fresh capture");
    assert.equal(page.container.querySelector('[data-testid="card-map-workspace"]'), null);
    assert.doesNotMatch(page.container.textContent ?? "", /NEW CARD MAP/);
  } finally {
    await page.cleanup();
  }
});

test("AI Grader explicitly reconciles an exactly committed capture using signed review authority", async () => {
  const sessionId = "ai-grader-committed-ack-loss";
  const browserDraft = committedNoMapDraft(sessionId, "AI_GRADER");
  const storageKey = speedsterCaptureRegistrationDraftStorageKey(sessionId);
  const rawBrowserDraft = JSON.stringify(browserDraft);
  const requests: Array<{ url: string; method: string }> = [];
  const draftPresenceAtSignedImageLoads: boolean[] = [];
  const reviewUrls = Object.fromEntries((["FRONT", "BACK"] as const).map((side) => [side, {
    master: `${side.toLowerCase()}-master-url`,
    views: {
      ORIGINAL: `${side.toLowerCase()}-original-url`,
      NORMALIZED: `${side.toLowerCase()}-normalized-url`,
      MICRO_DEFECT: `${side.toLowerCase()}-micro-url`,
      DIRECTIONAL: `${side.toLowerCase()}-directional-url`,
    },
  }]));
  const parsedBrowserDraft = parseSpeedsterCaptureRegistrationDraft(JSON.stringify(browserDraft), {
    surface: "AI_GRADER",
    sessionId,
    cardProfile: "SPORTS",
    mapBindingStatus: "NO_MAP",
    activeMapRevisionId: null,
    activeMapScope: null,
  });
  assert.ok(parsedBrowserDraft, "AI Grader committed fixture must satisfy the strict browser-draft contract");
  assert.equal(speedsterCaptureDraftMatchesCommittedSession(parsedBrowserDraft, {
    workflowState: "CAPTURED",
    capture: persistedCaptureForDraft(browserDraft),
    mapRevisionId: null,
    mapRegistration: null,
  }), true, "AI Grader committed fixture must exactly match server persistence");
  const page = await mountPage({
    query: { captureDraftId: sessionId },
    initialLocalStorage: { [storageKey]: rawBrowserDraft },
    renderPage: () => <AiGraderV2AdminPage />,
    fetchImpl: async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}` && method === "GET") {
        return jsonResponse({ session: {
          id: sessionId,
          cardProfile: "SPORTS",
          workflowState: "CAPTURED",
          capture: persistedCaptureForDraft(browserDraft),
          mapRevisionId: null,
          mapRegistration: null,
        } });
      }
      if (url === `/api/admin/ai-grader-v2/maps/current?sessionId=${sessionId}&scope=EFFECTIVE`) {
        return jsonResponse({ map: { status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null } });
      }
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}/review-images`) {
        draftPresenceAtSignedImageLoads.push(Boolean(window.localStorage.getItem(storageKey)));
        return jsonResponse({ urls: reviewUrls });
      }
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}/review-action`) {
        return jsonResponse({ reviewedDefects: [], detectorAttempts: [] });
      }
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}/instrumentation`) return jsonResponse({});
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    },
  });
  try {
    await waitFor(() => Boolean(buttonByText(page.container, "CONTINUE TO REVIEW")), "AI Grader reconciliation did not render");
    assert.ok(window.localStorage.getItem(storageKey), "AI Grader must not clear a matching draft before explicit choice");
    assert.equal(requests.some(({ method }) => method === "PATCH"), false, "Reload reconciliation must not retry capture PATCH");

    await act(async () => buttonByText(page.container, "KEEP BROWSER DRAFT FOR NOW")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.ok(window.localStorage.getItem(storageKey));

    await act(async () => buttonByText(page.container, "CONTINUE TO REVIEW")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(page.container.querySelector('[data-testid="reconciled-review-workspace"]')),
      "AI Grader did not continue the committed capture into review");
    assert.equal(draftPresenceAtSignedImageLoads[0], true, "Signed review authority must load before browser-draft cleanup");
    assert.equal(window.localStorage.getItem(storageKey), null);
    assert.equal(requests.some(({ method }) => method === "PATCH"), false);
  } finally {
    await page.cleanup();
  }
});

test("AI Grader preserves committed browser evidence when exact capture reconciliation conflicts", async () => {
  const sessionId = "ai-grader-committed-conflict";
  const browserDraft = committedNoMapDraft(sessionId, "AI_GRADER");
  const storageKey = speedsterCaptureRegistrationDraftStorageKey(sessionId);
  const rawBrowserDraft = JSON.stringify(browserDraft);
  const conflictingCapture = persistedCaptureForDraft(browserDraft);
  conflictingCapture.back.inspectionStorageKey = "different-server-back";
  const page = await mountPage({
    query: { captureDraftId: sessionId },
    initialLocalStorage: { [storageKey]: rawBrowserDraft },
    renderPage: () => <AiGraderV2AdminPage />,
    fetchImpl: async (request, init) => {
      const url = String(request);
      if (url === `/api/admin/ai-grader-v2/sessions/${sessionId}` && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ session: {
          id: sessionId,
          cardProfile: "SPORTS",
          workflowState: "CAPTURED",
          capture: conflictingCapture,
          mapRevisionId: null,
          mapRegistration: null,
        } });
      }
      throw new Error(`Unexpected fetch: ${String(init?.method ?? "GET")} ${url}`);
    },
  });
  try {
    await waitFor(() => /does not match the preserved browser draft/i.test(page.container.textContent ?? ""),
      "AI Grader committed conflict did not fail visibly");
    assert.equal(buttonByText(page.container, "CONTINUE TO REVIEW"), undefined);
    assert.equal(window.localStorage.getItem(storageKey), rawBrowserDraft, "AI Grader conflict must preserve the exact browser draft");
    assert.equal(page.container.querySelector('[aria-label="identity editor"]'), null, "AI recovery conflict must hide fresh identity authoring");
    assert.equal(buttonByText(page.container, "COMPLETE FRONT + BACK"), undefined, "AI recovery conflict must not mount fresh capture");
  } finally {
    await page.cleanup();
  }
});

test("new authoring shows both dynamic identities and uses one effective baseline lookup", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const loadedMap = {
    status: "LOADED",
    scope: "FAMILY",
    name: "1997 Upper Deck SPx",
    revision: {
      revisionId: "revision-7",
      version: 7,
      revisionHash: "abcdef1234567890",
      filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
    },
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
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session/map-authority") {
        return jsonResponse({ authority: { status: "LOADED" }, map: loadedMap });
      }
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session") return jsonResponse({});
      if (url === "/api/admin/ai-grader-v2/maps/source?sessionId=new-card-map-session&scope=EXACT") {
        return jsonResponse({
          source: {
            sessionId: "new-card-map-session",
            cardProfile: "SPORTS",
            identity: { playerName: "Ken Griffey Jr.", year: "1997", manufacturer: "Upper Deck", productSet: "SPx" },
            front: { rectifiedUrl: "front", centeringQuad: quad },
            back: { rectifiedUrl: "back", centeringQuad: quad },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  try {
    await changeInput(page.container, "playerName", "Ken Griffey Jr.");
    await changeInput(page.container, "year", "1997");
    await changeInput(page.container, "manufacturer", "Upper Deck");
    await changeInput(page.container, "productSet", "SPx");
    assert.match(page.container.textContent ?? "", /Family Card Map — all 1997 Sports Upper Deck SPx cards/);
    assert.match(page.container.textContent ?? "", /Exact Source Map — this exact card only — Ken Griffey Jr\./);
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
    assert.equal(requests.length, 4);
    const patch = requests[2];
    assert.equal(patch.url, "/api/admin/ai-grader-v2/sessions/new-card-map-session");
    assert.equal(patch.init?.method, "PATCH");
    const body = JSON.parse(String(patch.init?.body));
    assert.equal(body.workflowState, "CAPTURED");
    assert.equal(body.mapBinding.revisionId, "revision-7");
    assert.equal(body.mapBinding.filterPolicyVersion, "speedster-map-filter-authority-padding-v2");
    assert.equal(body.mapBinding.registration.front.mapRevisionId, "revision-7");
    assert.equal(body.mapBinding.registration.back.mapRevisionId, "revision-7");
    assert.equal(body.capture.front.originalStorageKey, "front-original");
    assert.equal(body.capture.back.originalStorageKey, "back-original");
    assert.deepEqual(body.capture.front.colorGeometryEvidence, captureBundle.front.colorGeometryEvidence);
    assert.deepEqual(body.capture.back.colorGeometryEvidence, captureBundle.back.colorGeometryEvidence);
    assert.deepEqual(
      [
        ...body.capture.front.colorGeometryEvidence,
        ...body.capture.back.colorGeometryEvidence,
      ].map((entry) => `${entry.side}:${entry.mode}:${entry.serverReceipt}`),
      [
        "FRONT:PHYSICAL_OUTER:front-physical-receipt",
        "FRONT:PRINTED_FRAME:front-printed-receipt",
        "BACK:PHYSICAL_OUTER:back-physical-receipt",
        "BACK:PRINTED_FRAME:back-printed-receipt",
      ],
      "Card Maps must carry all four exact signed Color Geometry records across the save wire",
    );
  } finally {
    await page.cleanup();
  }
});

test("Card Maps forwards exact Color Geometry receipt expiry to visible mode-specific recovery", async () => {
  let patchCalls = 0;
  const page = await mountPage({
    fetchImpl: async (request, init) => {
      const url = String(request);
      if (url === "/api/admin/ai-grader-v2/sessions") {
        return jsonResponse({ session: { id: "new-card-map-session", cardProfile: "SPORTS" } }, 201);
      }
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session/map-authority") {
        return jsonResponse({ authority: { status: "LOADED" }, map: {
          status: "LOADED",
          scope: "FAMILY",
          name: "1997 Upper Deck SPx",
          revision: {
            revisionId: "revision-7",
            version: 7,
            revisionHash: "abcdef1234567890",
            filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
          },
          revisions: [],
          editable: null,
        } });
      }
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session" && init?.method === "PATCH") {
        patchCalls += 1;
        return jsonResponse({
          message: "Back printed Color Geometry receipt expired.",
          colorGeometryReceiptExpired: { side: "BACK", mode: "PRINTED_FRAME" },
        }, 409);
      }
      throw new Error(`Unexpected fetch: ${String(init?.method ?? "GET")} ${url}`);
    },
  });
  try {
    await changeInput(page.container, "playerName", "Ken Griffey Jr.");
    await changeInput(page.container, "year", "1997");
    await changeInput(page.container, "manufacturer", "Upper Deck");
    await changeInput(page.container, "productSet", "SPx");
    await act(async () => buttonByText(page.container, "CONTINUE TO FRONT + BACK")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(page.container, "COMPLETE FRONT + BACK")), "Capture workspace did not open");

    await act(async () => buttonByText(page.container, "COMPLETE FRONT + BACK")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => /EXACT COLOR RECOVERY · BACK PRINTED_FRAME/.test(page.container.textContent ?? ""),
      "Card Maps did not forward exact side/mode receipt recovery");
    assert.equal(patchCalls, 1);
    assert.ok(buttonByText(page.container, "RETRY CAPTURE SAVE"));
    assert.equal(page.container.querySelector('[data-testid="card-map-workspace"]'), null);
  } finally {
    await page.cleanup();
  }
});

test("new Card Map capture save failure retains the exact bundle and retries once", async () => {
  const patchBodies: string[] = [];
  let patchCalls = 0;
  const page = await mountPage({
    fetchImpl: async (request, init) => {
      const url = String(request);
      if (url === "/api/admin/ai-grader-v2/sessions") {
        return jsonResponse({ session: { id: "new-card-map-session", cardProfile: "SPORTS" } }, 201);
      }
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session/map-authority") {
        return jsonResponse({ authority: { status: "LOADED" }, map: {
          status: "LOADED",
          scope: "FAMILY",
          name: "1997 Upper Deck SPx",
          revision: {
            revisionId: "revision-7",
            version: 7,
            revisionHash: "abcdef1234567890",
            filterPolicyVersion: "speedster-map-filter-authority-padding-v2",
          },
          revisions: [],
          editable: null,
        } });
      }
      if (url === "/api/admin/ai-grader-v2/sessions/new-card-map-session") {
        patchCalls += 1;
        patchBodies.push(String(init?.body));
        return patchCalls === 1
          ? jsonResponse({ message: "Transient CARD MAP capture failure" }, 503)
          : jsonResponse({});
      }
      if (url === "/api/admin/ai-grader-v2/maps/source?sessionId=new-card-map-session&scope=EXACT") {
        return jsonResponse({
          source: {
            sessionId: "new-card-map-session",
            cardProfile: "SPORTS",
            identity: { playerName: "Ken Griffey Jr.", year: "1997", manufacturer: "Upper Deck", productSet: "SPx" },
            front: { rectifiedUrl: "front", centeringQuad: quad },
            back: { rectifiedUrl: "back", centeringQuad: quad },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  try {
    await changeInput(page.container, "playerName", "Ken Griffey Jr.");
    await changeInput(page.container, "year", "1997");
    await changeInput(page.container, "manufacturer", "Upper Deck");
    await changeInput(page.container, "productSet", "SPx");
    await act(async () => buttonByText(page.container, "CONTINUE TO FRONT + BACK")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(page.container, "COMPLETE FRONT + BACK")), "Capture workspace did not open");

    await act(async () => buttonByText(page.container, "COMPLETE FRONT + BACK")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(page.container, "RETRY CAPTURE SAVE")), "Failed Card Map capture did not expose Retry");
    assert.match(page.container.textContent ?? "", /Transient CARD MAP capture failure/);

    const retry = buttonByText(page.container, "RETRY CAPTURE SAVE");
    assert.ok(retry);
    await act(async () => {
      retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => Boolean(page.container.querySelector('[data-testid="card-map-workspace"]')), "Retry did not open Card Map authoring");
    assert.equal(patchCalls, 2, "Retry must dispatch only one new capture PATCH");
    assert.equal(patchBodies[1], patchBodies[0], "Retry must submit the byte-identical Front/Back capture payload");
  } finally {
    await page.cleanup();
  }
});

test("UI exposes no family-versus-exact creation choice", async () => {
  const requests: string[] = [];
  const page = await mountPage({
    fetchImpl: async (request) => {
      const url = String(request);
      requests.push(url);
      if (url === "/api/admin/ai-grader-v2/sessions") {
        return jsonResponse({ session: { id: "exact-map-session", cardProfile: "SPORTS" } }, 201);
      }
      if (url === "/api/admin/ai-grader-v2/sessions/exact-map-session/map-authority") {
        return jsonResponse({
          authority: { status: "NO_MAP" },
          map: { status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });
  try {
    assert.equal(page.container.querySelector('input[name="card-map-scope"]'), null);
    await changeInput(page.container, "playerName", "Ken Griffey Jr.");
    await changeInput(page.container, "year", "1997");
    await changeInput(page.container, "manufacturer", "Upper Deck");
    await changeInput(page.container, "productSet", "SPx");
    assert.match(page.container.textContent ?? "", /Exact Source Map — this exact card only — Ken Griffey Jr\./);
    const submit = buttonByText(page.container, "CONTINUE TO FRONT + BACK");
    assert.ok(submit);
    await act(async () => submit.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(page.container, "COMPLETE FRONT + BACK")), "Dual-map capture workspace did not open");
    assert.equal(requests[1], "/api/admin/ai-grader-v2/sessions/exact-map-session/map-authority");
  } finally {
    await page.cleanup();
  }
});

test("completed mode prefers exact baseline then falls through to family only when exact is missing", async () => {
  const urls: string[] = [];
  const exactSessionId = "completed/session 42";
  const page = await mountPage({
    query: { sessionId: exactSessionId },
    fetchImpl: async (request) => {
      const url = String(request);
      urls.push(url);
      return jsonResponse({
        source: {
          sessionId: exactSessionId,
          cardProfile: "SPORTS",
          identity: { playerName: "Card", year: "2024", manufacturer: "Topps", productSet: "Set" },
          front: { rectifiedUrl: "front", centeringQuad: quad },
          back: { rectifiedUrl: "back", centeringQuad: quad },
        },
        map: url.endsWith("scope=FAMILY")
          ? {
              status: "INTEGRITY_ERROR",
              scope: "FAMILY",
              name: "2024 Topps Set",
              revision: null,
              revisions: [],
              editable: null,
              integrity: {
                code: "CARD_MAP_INTEGRITY_FAILURE",
                message: "Map revision hash verification failed.",
              },
            }
          : { status: "MISSING", scope: "EXACT", name: "Card #42", revision: null, revisions: [], editable: null },
      });
    },
  });
  try {
    await waitFor(() => Boolean(page.container.querySelector('[data-testid="card-map-workspace"]')), "Completed CARD MAP workspace did not open");
    assert.deepEqual(urls, [
      `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(exactSessionId)}&scope=EXACT`,
      `/api/admin/ai-grader-v2/maps/source?sessionId=${encodeURIComponent(exactSessionId)}&scope=FAMILY`,
    ]);
    assert.match(page.container.textContent ?? "", /RECOVER CARD MAP/);
    assert.match(page.container.textContent ?? "", /CARD MAP WORKSPACE · completed\/session 42 · INTEGRITY_ERROR/);
    assert.match(page.container.textContent ?? "", /invalid prior revision is excluded/i);
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
      return jsonResponse({ message: "TRAIN source identity is malformed." }, 409);
    },
  });
  try {
    await waitFor(() => page.container.textContent?.includes("CARD MAP source identity is malformed.") ?? false, "Malformed source error did not render");
    assert.doesNotMatch(page.container.textContent ?? "", /\bTRAIN\b/);
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
