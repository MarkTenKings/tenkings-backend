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

const { CaptureWorkspace, SpeedsterAppliedMapBadge } = require(
  "../components/ai-grader-v2/CaptureWorkspace",
) as typeof import("../components/ai-grader-v2/CaptureWorkspace");
type SpeedsterCaptureInstrumentationEvent = import(
  "../components/ai-grader-v2/CaptureWorkspace"
).SpeedsterCaptureInstrumentationEvent;
const { SpeedsterTrainWorkspace } = require(
  "../components/ai-grader-v2/SpeedsterTrainWorkspace",
) as typeof import("../components/ai-grader-v2/SpeedsterTrainWorkspace");
const { speedsterImageService, runSpeedsterImageRequest } = require(
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
  getRegistrationCount: () => number;
  getRescueAttemptIds: () => readonly string[];
  getPreparedImageRefreshCount: (side: "FRONT" | "BACK") => number;
  events: SpeedsterCaptureInstrumentationEvent[];
  bundles: import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureBundle[];
  rerenderSession: (sessionId: string) => Promise<void>;
  cleanup: () => Promise<void>;
};

async function mountWorkspace(input: {
  proposeGeometry: typeof speedsterImageService.proposeGeometry;
  refreshedUrls?: boolean;
  activeMap?: { revisionId: string; scope: "EXACT" | "FAMILY"; name: string };
  registrationFails?: boolean;
  registrationFailsOnSide?: "FRONT" | "BACK";
  registrationNeedsRescueOnSide?: "FRONT" | "BACK";
  registrationGlobalGateFailure?: boolean;
  rescueFailures?: number;
  preparedImageRefreshFails?: boolean;
  preparedImageRefreshFailures?: number;
  registrationNeverSettlesOnSide?: "FRONT" | "BACK";
  onRegistrationRequest?: (side: "FRONT" | "BACK") => void | Promise<void>;
  mapLookupFailed?: boolean;
  imageRequestTimeoutMs?: number;
  onSave?: (
    bundle: import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureBundle,
  ) => import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureSaveResult | Promise<import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureSaveResult>;
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
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value() {} },
    releasePointerCapture: { configurable: true, value() {} },
    hasPointerCapture: { configurable: true, value: () => true },
  });

  let pollCount = 0;
  let registrationCount = 0;
  const preparedImageRefreshCount = { FRONT: 0, BACK: 0 };
  const rescueAttemptIds: string[] = [];
  let remainingRescueFailures = input.rescueFailures ?? 0;
  let remainingPreparedImageRefreshFailures = input.preparedImageRefreshFailures ?? 0;
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
    if (url === "/api/admin/ai-grader-v2/upload-plan") {
      const outputs = Object.fromEntries(["RECTIFIED", "INSPECTION", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"].map((kind) => [
        kind,
        { storageKey: `${kind}.webp`, uploadUrl: `https://upload.example.test/${kind}`, readUrl: `https://read.example.test/${kind}` },
      ]));
      return jsonResponse({ outputs });
    }
    if (url.includes("/api/admin/ai-grader-v2/sessions/") && url.includes("/prepared-image?side=")) {
      const side = url.endsWith("side=FRONT") ? "FRONT" : "BACK";
      preparedImageRefreshCount[side] += 1;
      if (input.preparedImageRefreshFails || remainingPreparedImageRefreshFailures > 0) {
        remainingPreparedImageRefreshFailures = Math.max(0, remainingPreparedImageRefreshFailures - 1);
        return jsonResponse({ message: `The ${side.toLowerCase()} prepared card image is not ready.` }, 409);
      }
      return jsonResponse({
        side,
        imageUrl: `https://read.example.test/${side.toLowerCase()}-rectified-refresh-${preparedImageRefreshCount[side]}`,
      });
    }
    if (url === "/api/admin/ai-grader-v2/image/prepare") {
      return jsonResponse({
        width: 1270,
        height: 1778,
        transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        borders: validQuad,
        detectedBorders: ["top", "right", "bottom", "left"],
        inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
      });
    }
    if (url === "/api/admin/ai-grader-v2/image/map-registration") {
      registrationCount += 1;
      const body = JSON.parse(String(init?.body)) as {
        side: "FRONT" | "BACK";
        rescue?: boolean;
        rescueAttemptId?: string;
      };
      if (body.rescue && body.rescueAttemptId) rescueAttemptIds.push(body.rescueAttemptId);
      await input.onRegistrationRequest?.(body.side);
      if (input.registrationNeverSettlesOnSide === body.side) {
        return new Promise<Response>(() => {});
      }
      if (input.registrationFails || input.registrationFailsOnSide === body.side) {
        return jsonResponse({ message: "Registration unsafe" }, 409);
      }
      if (!body.rescue && input.registrationNeedsRescueOnSide === body.side) {
        return jsonResponse({
          message: "CARD MAP registration needs human anchor correction.",
          requestId: "registration-request-1",
          registrationFailure: {
            algorithmVersion: "opencv-redundant-ransac-registration-v2",
            policyVersion: "speedster-map-registration-acceptance-v2",
            accepted: false,
            failureCode: input.registrationGlobalGateFailure ? "LOW_RANSAC_INLIER_FRACTION" : "LOW_ANCHOR_CONFIDENCE",
            message: input.registrationGlobalGateFailure ? "Registration inlier fraction is below policy." : "One anchor is low confidence.",
            candidateCount: 1,
            candidateIds: ["original-reference"],
            binding: {
              side: body.side,
              mapRevisionId: input.activeMap?.revisionId ?? "map-revision-test",
              currentInspectionSha256: "b".repeat(64),
              currentPhysicalQuadSha256: "a".repeat(64),
              candidates: [{ candidateId: "original-reference", referenceInspectionSha256: "c".repeat(64) }],
            },
            bestCandidate: {
              candidateId: "original-reference",
              provenance: "ORIGINAL_REFERENCE",
              accepted: false,
              failureCode: input.registrationGlobalGateFailure ? "LOW_RANSAC_INLIER_FRACTION" : "LOW_ANCHOR_CONFIDENCE",
              message: input.registrationGlobalGateFailure ? "Registration inlier fraction is below policy." : "One anchor is low confidence.",
              anchors: validQuad.map((point, index) => ({
                anchorId: `a${index + 1}`,
                expectedPoint: point,
                trackedPoint: !input.registrationGlobalGateFailure && index === 0 ? { x: -0.13, y: 0.06 } : point,
                locatedPoint: !input.registrationGlobalGateFailure && index === 0 ? { x: -0.13, y: 0.06 } : point,
                score: !input.registrationGlobalGateFailure && index === 0 ? 0 : 0.9,
                status: !input.registrationGlobalGateFailure && index === 0 ? "OUT_OF_CARD" : "TRACKED",
              })),
              featureCount: 40,
              usableFeatureCount: 30,
              inlierCount: 20,
              inlierFraction: 2 / 3,
              perAnchorFeatureCounts: [4, 8, 9, 9],
              perAnchorInlierCounts: [1, 6, 7, 6],
              medianReprojectionErrorPx: 0.8,
              maxReprojectionErrorPx: 2.1,
            },
          },
        }, 422);
      }
      if (body.rescue && remainingRescueFailures > 0) {
        remainingRescueFailures -= 1;
        return jsonResponse({ message: "Registration lesson hash verification failed; no rescue was applied." }, 500);
      }
      return jsonResponse({
        version: body.rescue ? "opencv-redundant-ransac-registration-v2" : "opencv-human-anchor-registration-v1",
        side: body.side,
        mapRevisionId: input.activeMap?.revisionId,
        currentPhysicalQuadSha256: "a".repeat(64),
        currentInspectionSha256: "b".repeat(64),
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        anchors: body.rescue ? validQuad.map((point, index) => ({
          anchorId: `a${index + 1}`, expectedPoint: point, locatedPoint: point, score: 1,
        })) : [],
        projectedDesignBoundary: { kind: "QUAD", points: validQuad },
        projectedZones: [],
        ...(body.rescue ? {
          candidateProvenance: { candidateId: "lesson-1", source: "HUMAN_CORRECTION", lessonId: "lesson-1" },
          acceptance: {
            policyVersion: "speedster-map-registration-acceptance-v2", mode: "HUMAN_CONFIRMED",
            featureCount: 4, usableFeatureCount: 4, inlierCount: 4, inlierFraction: 1,
            perAnchorFeatureCounts: [1, 1, 1, 1], perAnchorInlierCounts: [1, 1, 1, 1],
            medianReprojectionErrorPx: 0, maxReprojectionErrorPx: 0,
          },
        } : {}),
      });
    }
    throw new Error(`Unexpected fetch in lifecycle test: ${url}`);
  };

  const originalProposeGeometry = speedsterImageService.proposeGeometry;
  speedsterImageService.proposeGeometry = input.proposeGeometry;
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  const events: SpeedsterCaptureInstrumentationEvent[] = [];
  const bundles: import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureBundle[] = [];
  const renderSession = (sessionId: string) => (
    <CaptureWorkspace
      token="admin-token"
      sessionId={sessionId}
      cardProfile="POKEMON"
      activeMapRevisionId={input.activeMap?.revisionId}
      activeMapScope={input.activeMap?.scope}
      activeMapName={input.activeMap?.name}
      mapLookupFailed={input.mapLookupFailed}
      imageRequestTimeoutMs={input.imageRequestTimeoutMs}
      onReady={(bundle) => {
        bundles.push(bundle);
        return input.onSave?.(bundle) ?? { saved: true };
      }}
      onInstrumentationEvent={(event) => events.push(event)}
    />
  );
  await act(async () => {
    root.render(renderSession("speedster-session-lifecycle-test"));
  });
  await waitFor(
    () => Boolean(buttonByText(container, "Set geometry")),
    "The capture pair did not become ready",
  );

  return {
    container,
    root,
    getPollCount: () => pollCount,
    getRegistrationCount: () => registrationCount,
    getRescueAttemptIds: () => rescueAttemptIds,
    getPreparedImageRefreshCount: (side) => preparedImageRefreshCount[side],
    events,
    bundles,
    rerenderSession: async (nextSessionId) => {
      await act(async () => root.render(renderSession(nextSessionId)));
      await waitFor(
        () => Boolean(buttonByText(container, "Set geometry")),
        "The replacement session capture pair did not become ready",
      );
    },
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

test("bounded image requests reject a non-cooperative late success with recoverable copy", async () => {
  let aborted = false;
  await assert.rejects(
    runSpeedsterImageRequest("geometry", { timeoutMs: 10 }, (signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
      setTimeout(() => resolve("late success"), 25);
    })),
    /geometry timed out.*photos and current geometry are preserved.*retry/i,
  );
  assert.equal(aborted, true);
});

test("late geometry completion from an old session cannot alter the replacement session", async () => {
  let resolveOld: ((value: GeometryResponse) => void) | undefined;
  let calls = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => {
      calls += 1;
      if (calls === 1) return new Promise<GeometryResponse>((resolve) => { resolveOld = resolve; });
      return { width: 1200, height: 1600, corners: validQuad };
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(resolveOld), "Old-session Front geometry did not begin");
    await harness.rerenderSession("speedster-session-replacement-test");
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Replacement session did not reach editable geometry",
    );
    await act(async () => {
      resolveOld?.({ width: 1200, height: 1600, corners: null });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.ok(harness.container.querySelector('[aria-label="front card geometry"]'));
    assert.equal(harness.container.querySelector('[role="alert"]'), null);
    assert.doesNotMatch(harness.container.textContent ?? "", /newer Set geometry attempt replaced/i);
  } finally {
    await harness.cleanup();
  }
});

test("image-service failures retain the safe server request ID for support", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    message: "Speedster geometry service did not respond in time. Your photos and current geometry are preserved; retry this step.",
    requestId: "12345678-1234-1234-1234-123456789abc",
  }, 504);
  try {
    await assert.rejects(
      speedsterImageService.proposeGeometry("admin-token", "https://images.example.test/front.jpg"),
      /request 12345678-1234-1234-1234-123456789abc/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

async function loadPreparedImage(container: HTMLElement, alt: string) {
  const image = container.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
  assert.ok(image, `${alt} did not render`);
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1270 },
    naturalHeight: { configurable: true, value: 1778 },
  });
  giveImageRenderedArea(image);
  await act(async () => fire(image, "load"));
  return image;
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

test("geometry timeout preserves both iPhone originals and Retry completes the same attempt", async () => {
  let call = 0;
  const harness = await mountWorkspace({
    imageRequestTimeoutMs: 10,
    proposeGeometry: async (_token, _imageUrl, options) => {
      call += 1;
      if (call === 1) {
        return new Promise<GeometryResponse>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(
            "Speedster geometry timed out. Your photos and current geometry are preserved; retry this step.",
          )), options?.timeoutMs ?? 10);
          options?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }
      return { width: 1200, height: 1600, corners: validQuad };
    },
  });
  try {
    const originalFront = harness.container.querySelector<HTMLImageElement>('img[alt="front card preview"]')?.src;
    const originalBack = harness.container.querySelector<HTMLImageElement>('img[alt="back card preview"]')?.src;
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(
      () => Boolean(buttonByText(harness.container, "Retry set geometry")),
      "Timed-out geometry did not offer Retry",
    );
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /timed out/i);
    assert.match(harness.container.textContent ?? "", /2\/2 photos ready/);
    assert.equal(harness.container.querySelector<HTMLImageElement>('img[alt="front card preview"]')?.src, originalFront);
    assert.equal(harness.container.querySelector<HTMLImageElement>('img[alt="back card preview"]')?.src, originalBack);

    await act(async () => fire(buttonByText(harness.container, "Retry set geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Retry did not advance to editable Front geometry",
    );
    assert.equal(call, 3, "Retry must obtain fresh Front and Back geometry");
    assert.equal(harness.container.querySelector('[role="alert"]'), null);
  } finally {
    await harness.cleanup();
  }
});

test("Back geometry failure is identified without discarding either original", async () => {
  let call = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => {
      call += 1;
      if (call === 2) throw new Error("Speedster geometry timed out. Your photos and current geometry are preserved; retry this step.");
      return { width: 1200, height: 1600, corners: validQuad };
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry set geometry")), "Back failure did not offer Retry");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /^Back geometry failed:/);
    assert.match(harness.container.textContent ?? "", /2\/2 photos ready/);
    assert.ok(harness.container.querySelector('img[alt="front card preview"]'));
    assert.ok(harness.container.querySelector('img[alt="back card preview"]'));
  } finally {
    await harness.cleanup();
  }
});

test("resolved FAMILY map applies only after both sides succeed and remains visible post-capture", async () => {
  let now = 10_000;
  const originalDateNow = Date.now;
  Date.now = () => now;
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-7", scope: "FAMILY", name: "2022 Lost Origin Holo" },
    onRegistrationRequest: async (side) => {
      if (side === "BACK") {
        await Promise.resolve();
        now += 75;
      }
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    assert.equal(harness.getRegistrationCount(), 0, "Registration must wait for both prepared sides");
    assert.doesNotMatch(harness.container.textContent ?? "", /applied to Front/);
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => (harness.container.textContent ?? "").includes("FAMILY · 2022 Lost Origin Holo applied to Front + Back"), "Applied family badge did not render");
    assert.equal(harness.getRegistrationCount(), 2);
    const geometryEvents = harness.events.filter((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED");
    assert.equal(geometryEvents.length, 2);
    assert.deepEqual(geometryEvents[0]?.details, {
      side: "FRONT",
      mapAppliedScope: "FAMILY",
      mapName: "2022 Lost Origin Holo",
      mapRevisionId: "family-revision-7",
    });
    assert.deepEqual(geometryEvents[1]?.details, {
      side: "BACK",
      mapAppliedScope: "FAMILY",
      mapName: "2022 Lost Origin Holo",
      mapRevisionId: "family-revision-7",
    });
    assert.equal(geometryEvents[0]?.endedAtMs, 10_000, "Front keeps its stored preparation end");
    assert.equal(geometryEvents[1]?.startedAtMs, 10_000);
    assert.equal(geometryEvents[1]?.endedAtMs, 10_075, "Back timing includes concurrent registration latency");

    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Front centering did not open");
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") >= 1, "Front image did not refresh proactively");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Back image did not refresh proactively");
    await loadPreparedImage(harness.container, "back rectified trading card");
    const finalContinue = buttonByText(harness.container, "Continue");
    assert.ok(finalContinue);
    await act(async () => {
      fire(finalContinue, "click");
      fire(finalContinue, "click");
    });
    assert.equal(harness.bundles.length, 1);
    const centeringEvents = harness.events.filter((candidate) => candidate.eventType === "CENTERING_CONFIRMED");
    assert.deepEqual(centeringEvents.map((event) => event.details), [
      {
        side: "FRONT",
        mapAppliedScope: "FAMILY",
        mapName: "2022 Lost Origin Holo",
        mapRevisionId: "family-revision-7",
      },
      {
        side: "BACK",
        mapAppliedScope: "FAMILY",
        mapName: "2022 Lost Origin Holo",
        mapRevisionId: "family-revision-7",
      },
    ]);
    await act(async () => harness.root.render(
      <SpeedsterAppliedMapBadge
        capture={harness.bundles[0]}
        selectedRevisionId="family-revision-7"
        scope="FAMILY"
        name="2022 Lost Origin Holo"
      />,
    ));
    assert.match(harness.container.textContent ?? "", /FAMILY · 2022 Lost Origin Holo/);

    const partial = {
      ...harness.bundles[0],
      back: { ...harness.bundles[0].back, mapRegistration: undefined },
    };
    await act(async () => harness.root.render(
      <SpeedsterAppliedMapBadge
        capture={partial}
        selectedRevisionId="family-revision-7"
        scope="FAMILY"
        name="2022 Lost Origin Holo"
      />,
    ));
    assert.match(harness.container.textContent ?? "", /NO CARD MAP · MANUAL/);
  } finally {
    await harness.cleanup();
    Date.now = originalDateNow;
  }
});

test("Front registration success plus Back failure rolls both sides back to manual with no binding", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-9", scope: "EXACT", name: "Snorlax #TG10" },
    registrationFailsOnSide: "BACK",
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    assert.equal(harness.getRegistrationCount(), 0);
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => (harness.container.textContent ?? "").includes("No map will be applied; continuing with normal human review"), "Safe manual fallback did not render");
    assert.equal(harness.container.querySelector('[role="alert"]'), null);
    assert.equal(harness.getRegistrationCount(), 2);
    const geometryEvents = harness.events.filter((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED");
    assert.deepEqual(geometryEvents[0]?.details, {
      side: "FRONT",
      mapAppliedScope: "NONE",
      mapFailureCode: "REGISTRATION_FAILED",
    });
    assert.deepEqual(geometryEvents[1]?.details, {
      side: "BACK",
      mapAppliedScope: "NONE",
      mapFailureCode: "REGISTRATION_FAILED",
    });

    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Manual Front centering did not open");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Manual Back centering did not open");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    assert.equal(harness.bundles.length, 1);
    assert.equal(harness.bundles[0].front.mapRegistration, undefined);
    assert.equal(harness.bundles[0].back.mapRegistration, undefined);
    const centeringEvents = harness.events.filter((candidate) => candidate.eventType === "CENTERING_CONFIRMED");
    assert.deepEqual(centeringEvents.map((event) => event.details), [
      { side: "FRONT", mapAppliedScope: "NONE", mapFailureCode: "REGISTRATION_FAILED" },
      { side: "BACK", mapAppliedScope: "NONE", mapFailureCode: "REGISTRATION_FAILED" },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("Front and Back centering fail closed while unloaded and a failed proactive refresh is manually retryable", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    preparedImageRefreshFailures: 1,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry image")), "Failed proactive refresh did not expose Retry image");
    assert.ok(buttonByText(harness.container, "Image required")?.disabled, "Front Continue must remain disabled after refresh failure");
    assert.equal(harness.container.querySelector('[aria-label="Adjustable printed-border geometry"]'), null, "Blind border editing must not render");

    await act(async () => fire(buttonByText(harness.container, "Retry image")!, "click"));
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") === 2, "Manual Front image retry did not request one fresh URL");
    const frontImage = await loadPreparedImage(harness.container, "front rectified trading card");
    assert.equal(buttonByText(harness.container, "Continue")?.disabled, false);

    const frontOverlay = harness.container.querySelector<SVGSVGElement>('[aria-label="Adjustable printed-border geometry"]');
    const frontTopLeft = harness.container.querySelector<SVGGElement>('[aria-label="Top left"]');
    assert.ok(frontOverlay && frontTopLeft);
    Object.defineProperty(frontOverlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 635, bottom: 889, width: 635, height: 889 }),
    });
    await act(async () => {
      fire(frontTopLeft, "pointerdown", { pointerId: 31, clientX: 63.5, clientY: 88.9 });
      fire(frontOverlay, "pointermove", { pointerId: 31, clientX: 127, clientY: 266.7 });
      fire(frontOverlay, "pointerup", { pointerId: 31, clientX: 127, clientY: 266.7 });
    });

    await act(async () => fire(frontImage, "error"));
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") === 3, "Front image error did not trigger one automatic retry");
    const automaticallyRetriedImage = harness.container.querySelector<HTMLImageElement>('img[alt="front rectified trading card"]');
    assert.ok(automaticallyRetriedImage);
    await act(async () => fire(automaticallyRetriedImage, "error"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry image")), "Second image error did not expose manual Retry image");
    assert.equal(harness.getPreparedImageRefreshCount("FRONT"), 3, "One failure chain must make at most one automatic retry");
    await act(async () => fire(buttonByText(harness.container, "Retry image")!, "click"));
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") === 4, "Manual retry after the bounded automatic retry did not refresh");
    await loadPreparedImage(harness.container, "front rectified trading card");
    assert.equal(
      harness.container.querySelector<SVGGElement>('[aria-label="Top left"]')?.querySelector("circle")?.getAttribute("cx"),
      "127",
      "A repeated image failure and manual retry must preserve the corrected Front geometry",
    );
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));

    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    assert.ok(buttonByText(harness.container, "Image required")?.disabled, "Back Continue must remain disabled until its own image loads");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") === 1, "Back image did not refresh independently");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    assert.equal(harness.bundles.length, 1);
  } finally {
    await harness.cleanup();
  }
});

test("Back registration rescue keeps Front provisional, preserves failed-save handles, and applies only after atomic retry", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-rescue", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationNeedsRescueOnSide: "BACK",
    rescueFailures: 1,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="BACK Card Map anchor rescue"]')), "Back rescue did not open");
    const blockedConfirm = buttonByText(harness.container, "Image required");
    assert.ok(blockedConfirm?.disabled, "Rescue confirmation must fail closed until the image visibly loads");
    assert.equal(harness.container.querySelectorAll('[aria-label^="Move anchor"]').length, 0, "Blind anchor editing must not render");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Back rescue image did not refresh proactively");
    await loadPreparedImage(harness.container, "back current card");
    assert.match(harness.container.textContent ?? "", /neither side is applied yet/i);
    assert.match(harness.container.textContent ?? "", /LOW ANCHOR CONFIDENCE/i);
    assert.match(harness.container.textContent ?? "", /One anchor is low confidence/i);
    const failedHandle = harness.container.querySelector('[aria-label="Move anchor 1, out_of_card"]') as HTMLButtonElement | null;
    assert.ok(failedHandle, "Failed anchor must be draggable and visibly identified");
    const rescueImage = harness.container.querySelector('img[alt="back current card"]') as HTMLImageElement | null;
    assert.ok(rescueImage?.parentElement);
    Object.defineProperty(rescueImage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }),
    });
    await act(async () => fire(failedHandle, "pointerdown", { pointerId: 7, clientX: 0, clientY: 60 }));
    await act(async () => {
      fire(rescueImage.parentElement!, "pointermove", { pointerId: 7, clientX: 400, clientY: 300 });
      fire(rescueImage.parentElement!, "pointerup", { pointerId: 7, clientX: 400, clientY: 300 });
    });
    assert.equal(failedHandle.style.left, "40%", "Dragged anchor x is retained in the rescue overlay");
    assert.equal(failedHandle.style.top, "30%", "Dragged anchor y is retained in the rescue overlay");

    const refreshCountBeforeError = harness.getPreparedImageRefreshCount("BACK");
    await act(async () => fire(rescueImage, "error"));
    await waitFor(
      () => harness.getPreparedImageRefreshCount("BACK") === refreshCountBeforeError + 1,
      "A failed rescue image did not trigger exactly one fresh read URL",
    );
    assert.ok(buttonByText(harness.container, "Image required")?.disabled, "Rescue must remain blocked during the image retry");
    await loadPreparedImage(harness.container, "back current card");
    const restoredHandle = harness.container.querySelector('[aria-label="Move anchor 1, out_of_card"]') as HTMLButtonElement | null;
    assert.equal(restoredHandle?.style.left, "40%", "A fresh image URL must preserve the corrected anchor x");
    assert.equal(restoredHandle?.style.top, "30%", "A fresh image URL must preserve the corrected anchor y");

    await act(async () => fire(buttonByText(harness.container, "Confirm corrected anchors")!, "click"));
    await waitFor(() => (harness.container.textContent ?? "").includes("hash verification failed"), "Atomic persistence failure was not visible");
    assert.ok(harness.container.querySelector('[aria-label="BACK Card Map anchor rescue"]'), "Failed persistence must retain rescue UI");
    assert.equal((harness.container.querySelector('[aria-label="Move anchor 1, out_of_card"]') as HTMLButtonElement).style.left, "40%", "Failed persistence must preserve corrected anchor positions");
    assert.equal(harness.events.filter((event) => event.eventType === "GEOMETRY_CONFIRMED").length, 0, "Provisional Front must not be applied or recorded");

    await act(async () => fire(buttonByText(harness.container, "Confirm corrected anchors")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Validated rescue did not continue to centering");
    assert.match(harness.container.textContent ?? "", /human-corrected, server-validated/i);
    assert.deepEqual(
      harness.events.filter((event) => event.eventType === "GEOMETRY_CONFIRMED").map((event) => event.details?.mapAppliedScope),
      ["FAMILY", "FAMILY"],
    );
    assert.equal(harness.getRegistrationCount(), 4, "Two automatic calls plus one failed and one successful rescue are expected");
    assert.equal(harness.getRescueAttemptIds().length, 2);
    assert.equal(
      harness.getRescueAttemptIds()[0],
      harness.getRescueAttemptIds()[1],
      "A lost-response retry must reuse the exact rescue attempt identity",
    );

    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    assert.equal(harness.bundles.length, 1);
    assert.equal(harness.bundles[0].front.mapRegistration?.mapRevisionId, "family-revision-rescue");
    assert.equal(harness.bundles[0].back.mapRegistration?.mapRevisionId, "family-revision-rescue");
  } finally {
    await harness.cleanup();
  }
});

test("global registration failure explains four-anchor confirmation and accepts unchanged credible proposals", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-global-gate", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationNeedsRescueOnSide: "BACK",
    registrationGlobalGateFailure: true,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="BACK Card Map anchor rescue"]')), "Back rescue did not open");
    await loadPreparedImage(harness.container, "back current card");
    assert.match(harness.container.textContent ?? "", /LOW RANSAC INLIER FRACTION/i);
    assert.match(harness.container.textContent ?? "", /All four proposals look individually credible/i);
    assert.equal(harness.container.querySelectorAll('[aria-label*="tracked"]').length, 4);
    await act(async () => fire(buttonByText(harness.container, "Confirm corrected anchors")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Unchanged human confirmation did not continue");
  } finally {
    await harness.cleanup();
  }
});

test("one non-cooperative registration timeout applies neither side and continues manual review", async () => {
  const harness = await mountWorkspace({
    imageRequestTimeoutMs: 10,
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-timeout", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationNeverSettlesOnSide: "BACK",
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(
      () => (harness.container.textContent ?? "").includes("No map will be applied; continuing with normal human review"),
      "Registration timeout did not safely continue in manual review",
    );
    assert.equal(harness.getRegistrationCount(), 2);
    assert.deepEqual(
      harness.events.filter((event) => event.eventType === "GEOMETRY_CONFIRMED").map((event) => event.details),
      [
        { side: "FRONT", mapAppliedScope: "NONE", mapFailureCode: "REGISTRATION_FAILED" },
        { side: "BACK", mapAppliedScope: "NONE", mapFailureCode: "REGISTRATION_FAILED" },
      ],
    );
  } finally {
    await harness.cleanup();
  }
});

test("failed final capture save exposes Retry and resubmits one byte-identical bundle", async () => {
  const submitted: string[] = [];
  let saveCalls = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    onSave: async (bundle) => {
      saveCalls += 1;
      submitted.push(JSON.stringify(bundle));
      await Promise.resolve();
      return saveCalls === 1
        ? { saved: false, message: "Transient capture save failure" }
        : { saved: true };
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Front centering did not open");
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") >= 1, "Front image did not refresh proactively");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Back image did not refresh proactively");
    await loadPreparedImage(harness.container, "back rectified trading card");
    const backOverlay = harness.container.querySelector<SVGSVGElement>('[aria-label="Adjustable printed-border geometry"]');
    const backTopLeft = harness.container.querySelector<SVGGElement>('[aria-label="Top left"]');
    assert.ok(backOverlay && backTopLeft);
    Object.defineProperty(backOverlay, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 635, bottom: 889, width: 635, height: 889 }),
    });
    await act(async () => {
      fire(backTopLeft, "pointerdown", { pointerId: 13, clientX: 63.5, clientY: 88.9 });
      fire(backOverlay, "pointermove", { pointerId: 13, clientX: 127, clientY: 266.7 });
      fire(backOverlay, "pointerup", { pointerId: 13, clientX: 127, clientY: 266.7 });
    });
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(
      () => /Transient capture save failure/.test(harness.container.querySelector('[role="alert"]')?.textContent ?? ""),
      "Failed save did not return to preserved Back centering",
    );
    await loadPreparedImage(harness.container, "back rectified trading card");
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry save")), "Failed save did not expose Retry save");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /Transient capture save failure/);
    assert.equal(
      harness.container.querySelector<SVGGElement>('[aria-label="Top left"]')?.querySelector("circle")?.getAttribute("cx"),
      "127",
      "Retry must remount the human-adjusted Back centering point",
    );

    const retry = buttonByText(harness.container, "Retry save");
    assert.ok(retry);
    await act(async () => {
      fire(retry, "click");
      fire(retry, "click");
    });
    await waitFor(() => saveCalls === 2, "Retry did not make exactly one new save attempt");
    assert.equal(submitted.length, 2);
    assert.equal(submitted[1], submitted[0], "Retry must preserve every Front/Back capture byte");
    assert.deepEqual(
      (JSON.parse(submitted[0]) as { back: { centeringQuad: readonly { x: number; y: number }[] } }).back.centeringQuad[0],
      { x: 0.2, y: 0.3 },
      "The byte-identity assertion must cover a materially human-adjusted Back point",
    );
    assert.equal(harness.bundles.length, 2);
    assert.equal(buttonByText(harness.container, "Retry save"), undefined);
  } finally {
    await harness.cleanup();
  }
});

test("failed effective lookup records NONE while ordinary geometry stays available", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    mapLookupFailed: true,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => harness.events.some((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED"), "Manual geometry event did not record");
    assert.equal(harness.getRegistrationCount(), 0);
    assert.deepEqual(harness.events.find((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED")?.details, {
      side: "FRONT",
      mapAppliedScope: "NONE",
      mapFailureCode: "LOOKUP_FAILED",
    });
  } finally {
    await harness.cleanup();
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
    const save = buttonByText(harness.container, "SAVE FAMILY + EXACT MAPS");
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
