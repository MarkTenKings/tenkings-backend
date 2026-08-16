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

const {
  CaptureWorkspace,
  SpeedsterAppliedMapBadge,
  isAutomaticSpeedsterMapRegistrationRetryEligible,
  isCurrentSpeedsterRegistrationDecisionAudit,
  settleSpeedsterRegistrationDecisionAuditConfirmation,
} = require(
  "../components/ai-grader-v2/CaptureWorkspace",
) as typeof import("../components/ai-grader-v2/CaptureWorkspace");
type SpeedsterCaptureInstrumentationEvent = import(
  "../components/ai-grader-v2/CaptureWorkspace"
).SpeedsterCaptureInstrumentationEvent;
const { SpeedsterTrainWorkspace } = require(
  "../components/ai-grader-v2/SpeedsterTrainWorkspace",
) as typeof import("../components/ai-grader-v2/SpeedsterTrainWorkspace");
const {
  speedsterImageService,
  runSpeedsterImageRequest,
  SpeedsterMapRegistrationRequestError,
  parseSpeedsterMapRegistrationRequestFailure,
  parseSpeedsterMapRegistrationFailurePayload,
} = require(
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
  getRegistrationCountForSide: (side: "FRONT" | "BACK") => number;
  getRescueAttemptIds: () => readonly string[];
  getRegistrationOrchestrations: () => readonly Readonly<{
    side: "FRONT" | "BACK";
    rescue: boolean;
    orchestration: import("../lib/ai-grader-v2/image-service").SpeedsterMapRegistrationOrchestration;
  }>[];
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
  registrationMalformed422OnSide?: "FRONT" | "BACK";
  registrationGlobalGateFailure?: boolean;
  rescueFailures?: number;
  preparedImageRefreshFails?: boolean;
  preparedImageRefreshFailures?: number;
  registrationNeverSettlesOnSide?: "FRONT" | "BACK";
  registrationHttpFailure?: Readonly<{
    side: "FRONT" | "BACK";
    status: number;
    count: number;
    source: "PROVIDER_GATEWAY" | "PROVIDER" | "PROVIDER_NETWORK" | "TEN_KINGS_API";
    code: string;
    retryable: boolean;
    message: string;
    envelopeStatus?: number;
    envelopeSource?: "PROVIDER_GATEWAY" | "PROVIDER" | "PROVIDER_NETWORK" | "TEN_KINGS_API";
    envelopeCode?: string;
    envelopeRetryable?: boolean;
  }>;
  registrationNetworkFailure?: Readonly<{ side: "FRONT" | "BACK"; count: number }>;
  registrationAuditFailsOnSide?: "FRONT" | "BACK";
  registrationAuditFailsOnSideAttempt?: Readonly<{
    side: "FRONT" | "BACK";
    sideAttempt: number;
    requestId: string;
  }>;
  instrumentationFails?: boolean;
  decisionInstrumentationThrows?: boolean;
  decisionInstrumentationResult?: Promise<boolean>;
  omitInstrumentationReporter?: boolean;
  onRegistrationRequest?: (side: "FRONT" | "BACK", sideAttempt: number) => void | Promise<void>;
  mapLookupFailed?: boolean;
  imageRequestTimeoutMs?: number;
  decisionAuditConfirmationTimeoutMs?: number;
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
  const registrationCountBySide = { FRONT: 0, BACK: 0 };
  const preparedImageRefreshCount = { FRONT: 0, BACK: 0 };
  const rescueAttemptIds: string[] = [];
  const registrationOrchestrations: Array<Readonly<{
    side: "FRONT" | "BACK";
    rescue: boolean;
    orchestration: import("../lib/ai-grader-v2/image-service").SpeedsterMapRegistrationOrchestration;
  }>> = [];
  let remainingRescueFailures = input.rescueFailures ?? 0;
  let remainingPreparedImageRefreshFailures = input.preparedImageRefreshFailures ?? 0;
  let remainingRegistrationHttpFailures = input.registrationHttpFailure?.count ?? 0;
  let remainingRegistrationNetworkFailures = input.registrationNetworkFailure?.count ?? 0;
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
        orchestration: import("../lib/ai-grader-v2/image-service").SpeedsterMapRegistrationOrchestration;
      };
      registrationCountBySide[body.side] += 1;
      registrationOrchestrations.push({
        side: body.side,
        rescue: body.rescue === true,
        orchestration: body.orchestration,
      });
      const sideAttempt = registrationCountBySide[body.side];
      const targetedAuditFailure = input.registrationAuditFailsOnSideAttempt;
      const registrationAuditWarning = input.registrationAuditFailsOnSide === body.side
        ? { status: "WRITE_FAILED", requestId: `audit-request-${body.side.toLowerCase()}` }
        : targetedAuditFailure?.side === body.side && targetedAuditFailure.sideAttempt === sideAttempt
          ? { status: "WRITE_FAILED", requestId: targetedAuditFailure.requestId }
          : undefined;
      if (body.rescue && body.rescueAttemptId) rescueAttemptIds.push(body.rescueAttemptId);
      await input.onRegistrationRequest?.(body.side, registrationCountBySide[body.side]);
      if (input.registrationNeverSettlesOnSide === body.side) {
        return new Promise<Response>(() => {});
      }
      if (input.registrationFails || input.registrationFailsOnSide === body.side) {
        return jsonResponse({
          message: "Registration unsafe",
          requestId: "registration-request-409",
          registrationError: {
            version: "speedster-map-registration-error-v1",
            source: "PROVIDER",
            code: "PROVIDER_HTTP_409",
            httpStatus: 409,
            retryable: false,
            requestId: "registration-request-409",
          },
          ...(registrationAuditWarning ? { registrationAuditWarning } : {}),
        }, 409);
      }
      if (!body.rescue && input.registrationNetworkFailure?.side === body.side && remainingRegistrationNetworkFailures > 0) {
        remainingRegistrationNetworkFailures -= 1;
        throw new TypeError("fetch failed");
      }
      if (!body.rescue && input.registrationHttpFailure?.side === body.side && remainingRegistrationHttpFailures > 0) {
        remainingRegistrationHttpFailures -= 1;
        const failure = input.registrationHttpFailure;
        return jsonResponse({
          message: failure.message,
          requestId: `registration-request-${failure.status}`,
          registrationError: {
            version: "speedster-map-registration-error-v1",
            source: failure.envelopeSource ?? failure.source,
            code: failure.envelopeCode ?? failure.code,
            httpStatus: failure.envelopeStatus ?? failure.status,
            retryable: failure.envelopeRetryable ?? failure.retryable,
            requestId: `registration-request-${failure.status}`,
          },
          ...(registrationAuditWarning ? { registrationAuditWarning } : {}),
        }, failure.status);
      }
      if (!body.rescue && input.registrationMalformed422OnSide === body.side) {
        return jsonResponse({
          message: "CARD MAP registration needs human anchor correction.",
          requestId: "registration-request-malformed-422",
          registrationFailure: {},
        }, 422);
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
          ...(registrationAuditWarning ? { registrationAuditWarning } : {}),
        }, 422);
      }
      if (body.rescue && remainingRescueFailures > 0) {
        remainingRescueFailures -= 1;
        return jsonResponse({
          message: "Registration lesson hash verification failed; no rescue was applied.",
          requestId: "registration-rescue-failure-500",
          registrationError: {
            version: "speedster-map-registration-error-v1",
            source: "TEN_KINGS_API",
            code: "TEN_KINGS_REGISTRATION_VALIDATION_FAILED",
            httpStatus: 500,
            retryable: false,
            requestId: "registration-rescue-failure-500",
          },
        }, 500);
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
        ...(registrationAuditWarning ? { registrationAuditWarning } : {}),
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
      decisionAuditConfirmationTimeoutMs={input.decisionAuditConfirmationTimeoutMs}
      onReady={(bundle) => {
        bundles.push(bundle);
        return input.onSave?.(bundle) ?? { saved: true };
      }}
      onInstrumentationEvent={input.omitInstrumentationReporter ? undefined as never : (event) => {
        events.push(event);
        if (event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION" && input.decisionInstrumentationThrows) {
          throw new Error("decision instrumentation threw synchronously");
        }
        if (event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION" && input.decisionInstrumentationResult) {
          return input.decisionInstrumentationResult;
        }
        return input.instrumentationFails ? false : true;
      }}
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
    getRegistrationCountForSide: (side) => registrationCountBySide[side],
    getRescueAttemptIds: () => rescueAttemptIds,
    getRegistrationOrchestrations: () => registrationOrchestrations,
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

test("automatic registration retry allowlist excludes every ambiguous HTTP and local failure", () => {
  const eligible = [
    { source: "PROVIDER_GATEWAY", code: "PROVIDER_GATEWAY_HTTP_502", httpStatus: 502 },
    { source: "PROVIDER_GATEWAY", code: "PROVIDER_GATEWAY_HTTP_503", httpStatus: 503 },
    { source: "PROVIDER_NETWORK", code: "NETWORK_NO_HTTP_RESPONSE", httpStatus: 502 },
    { source: "CLIENT_NETWORK", code: "NETWORK_NO_HTTP_RESPONSE", httpStatus: null },
  ] as const;
  for (const failure of eligible) {
    assert.equal(isAutomaticSpeedsterMapRegistrationRetryEligible(new SpeedsterMapRegistrationRequestError("retry", {
      version: "speedster-map-registration-error-v1",
      ...failure,
      retryable: true,
      requestId: null,
    })), true);
  }
  for (const status of [402, 408, 429, 500, 504]) {
    assert.equal(isAutomaticSpeedsterMapRegistrationRetryEligible(new SpeedsterMapRegistrationRequestError("stop", {
      version: "speedster-map-registration-error-v1",
      source: "PROVIDER",
      code: `PROVIDER_HTTP_${status}`,
      httpStatus: status,
      retryable: true,
      requestId: null,
    })), false);
  }
  assert.equal(isAutomaticSpeedsterMapRegistrationRetryEligible(new Error("local timeout")), false);
  assert.equal(isAutomaticSpeedsterMapRegistrationRetryEligible(new SpeedsterMapRegistrationRequestError("bad receipt", {
    version: "speedster-map-registration-error-v1",
    source: "TEN_KINGS_API",
    code: "TEN_KINGS_REGISTRATION_VALIDATION_FAILED",
    httpStatus: 500,
    retryable: true,
    requestId: null,
  })), false);
});

test("typed registration errors require exact actual-status and retry coherence", () => {
  const requestId = "registration-request-402";
  const factual402 = {
    version: "speedster-map-registration-error-v1",
    source: "PROVIDER",
    code: "PROVIDER_HTTP_402",
    httpStatus: 402,
    retryable: false,
    requestId,
  };
  assert.deepEqual(parseSpeedsterMapRegistrationRequestFailure(factual402, 402, true, requestId), factual402);
  assert.equal(parseSpeedsterMapRegistrationRequestFailure({
    ...factual402,
    source: "PROVIDER_GATEWAY",
    code: "PROVIDER_GATEWAY_HTTP_503",
    httpStatus: 503,
    retryable: true,
  }, 402, true, requestId), null, "actual HTTP 402 cannot claim retryable 503 evidence");
  assert.equal(parseSpeedsterMapRegistrationRequestFailure({
    ...factual402,
    source: "PROVIDER_GATEWAY",
    code: "PROVIDER_GATEWAY_HTTP_503",
    httpStatus: 503,
    retryable: false,
  }, 503, true, requestId), null, "automatic gateway classification must carry the exact retry truth");
  assert.ok(parseSpeedsterMapRegistrationRequestFailure({
    ...factual402,
    source: "PROVIDER_GATEWAY",
    code: "PROVIDER_GATEWAY_HTTP_503",
    httpStatus: 503,
    retryable: false,
  }, 503, false, requestId), "human rescue 503 remains visible but non-retryable");
});

test("malformed HTTP 422 diagnostics are rejected before rescue state construction", () => {
  assert.equal(parseSpeedsterMapRegistrationFailurePayload({}, "BACK"), null);
  assert.equal(parseSpeedsterMapRegistrationFailurePayload({
    algorithmVersion: "opencv-redundant-ransac-registration-v2",
    policyVersion: "speedster-map-registration-acceptance-v2",
    accepted: false,
    failureCode: "LOW_ANCHOR_CONFIDENCE",
    message: "Malformed nested evidence",
    candidateCount: 1,
    candidateIds: ["original-reference"],
    binding: { side: "BACK" },
    bestCandidate: { anchors: [{}] },
  }, "BACK"), null);
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

test("Front success plus Back failure preserves truth until explicit Continue without Card Map", async () => {
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
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')), "Explicit registration interruption did not render");
    assert.ok(buttonByText(harness.container, "Retry failed side"));
    assert.ok(buttonByText(harness.container, "Continue without Card Map"));
    assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null, "Registration failure must not silently advance");
    assert.equal(harness.getRegistrationCount(), 2);
    assert.equal(harness.events.filter((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED").length, 0);
    await act(async () => {
      const continueButton = buttonByText(harness.container, "Continue without Card Map")!;
      fire(continueButton, "click");
      fire(continueButton, "click");
    });
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Explicit manual choice did not continue");
    const geometryEvents = harness.events.filter((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED");
    assert.deepEqual(geometryEvents[0]?.details, {
      side: "FRONT",
      mapAppliedScope: "NONE",
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
      { side: "FRONT", mapAppliedScope: "NONE" },
      { side: "BACK", mapAppliedScope: "NONE", mapFailureCode: "REGISTRATION_FAILED" },
    ]);
    const decisions = harness.events.filter((candidate) => candidate.eventType === "MAP_REGISTRATION_OPERATOR_DECISION");
    assert.equal(decisions.length, 1, "Synchronous guard must record one explicit operator choice");
    assert.deepEqual(decisions[0]?.details?.registrationFailedSides, ["BACK"]);
  } finally {
    await harness.cleanup();
  }
});

test("two unresolved sides disclose complete evidence, expose side-specific retries, and audit full abandonment", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-two-failures", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationFails: true,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')), "Two-side interruption did not render");
    const text = harness.container.textContent ?? "";
    assert.match(text, /FRONT \+ BACK registration is unresolved/);
    assert.match(text, /FRONTPROVIDER_HTTP_409HTTP 409Request registration-request-409/);
    assert.match(text, /BACKPROVIDER_HTTP_409HTTP 409Request registration-request-409/);
    assert.ok(buttonByText(harness.container, "FRONT: Retry failed side"));
    assert.ok(buttonByText(harness.container, "BACK: Retry failed side"));
    assert.match(text, /abandons all unresolved sides: FRONT \+ BACK/);

    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Explicit two-side abandonment did not proceed");
    assert.match(harness.container.textContent ?? "", /FRONT \+ BACK unresolved Card Map work was explicitly abandoned/);
    const decision = harness.events.find((event) => event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION");
    assert.deepEqual(decision?.details?.registrationFailedSides, ["FRONT", "BACK"]);
    assert.deepEqual(decision?.details?.registrationFailures, [
      { side: "FRONT", source: "PROVIDER", code: "PROVIDER_HTTP_409", httpStatus: 409, requestId: "registration-request-409" },
      { side: "BACK", source: "PROVIDER", code: "PROVIDER_HTTP_409", httpStatus: 409, requestId: "registration-request-409" },
    ]);
    assert.deepEqual(
      harness.events.filter((event) => event.eventType === "GEOMETRY_CONFIRMED").map((event) => event.details?.mapFailureCode),
      ["REGISTRATION_FAILED", "REGISTRATION_FAILED"],
    );
  } finally {
    await harness.cleanup();
  }
});

test("infrastructure retry preserves the other side's valid 422 diagnostics", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-mixed-failures", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationHttpFailure: {
      side: "FRONT",
      status: 409,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_409",
      retryable: false,
      message: "Front registration state was rejected.",
    },
    registrationNeedsRescueOnSide: "BACK",
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')), "Mixed failure summary did not render");
    assert.match(harness.container.textContent ?? "", /FRONTPROVIDER_HTTP_409HTTP 409Request registration-request-409/);
    assert.match(harness.container.textContent ?? "", /BACKLOW_ANCHOR_CONFIDENCEHTTP 422Request registration-request-1/);
    assert.ok(buttonByText(harness.container, "FRONT: Retry failed side"));
    assert.equal(buttonByText(harness.container, "BACK: Retry failed side"), undefined, "422 diagnostics require correction, not blind retry");

    await act(async () => fire(buttonByText(harness.container, "FRONT: Retry failed side")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="BACK Card Map anchor rescue"]')), "Retained Back diagnostics did not transition to rescue");
    assert.match(harness.container.textContent ?? "", /BACKLOW_ANCHOR_CONFIDENCEHTTP 422Request registration-request-1/);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1, "Back diagnostics must not be discarded or rerun");
  } finally {
    await harness.cleanup();
  }
});

test("HTTP 402 stays factual, retains request evidence, and never automatically retries", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-402", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationHttpFailure: {
      side: "BACK",
      status: 402,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      retryable: false,
      message: "CARD MAP provider rejected the request (HTTP 402) (request registration-request-402). No map was applied.",
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => {
      const continueButton = buttonByText(harness.container, "Continue")!;
      fire(continueButton, "click");
      fire(continueButton, "click");
    });
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')), "402 interruption did not render");
    assert.match(harness.container.textContent ?? "", /provider rejected the request \(HTTP 402\)/);
    assert.match(harness.container.textContent ?? "", /Request registration-request-402/);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1, "402 must never auto-retry");
    assert.equal(harness.getRegistrationCount(), 2, "Synchronous guard must block duplicate Back confirmation");
  } finally {
    await harness.cleanup();
  }
});

test("actual HTTP 402 with claimed retryable 503 evidence fails visibly as CLIENT_PROTOCOL", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-contradiction", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationHttpFailure: {
      side: "BACK",
      status: 402,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      retryable: false,
      message: "misleading upstream envelope",
      envelopeStatus: 503,
      envelopeSource: "PROVIDER_GATEWAY",
      envelopeCode: "PROVIDER_GATEWAY_HTTP_503",
      envelopeRetryable: true,
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')), "Protocol contradiction was not visible");
    assert.match(harness.container.textContent ?? "", /contradictory or malformed error evidence \(HTTP 402\)/i);
    assert.match(harness.container.textContent ?? "", /CLIENT_PROTOCOL|CONTRADICTORY_OR_MALFORMED_ERROR_ENVELOPE/);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1, "contradictory retry evidence must never trigger automatic retry");
  } finally {
    await harness.cleanup();
  }
});

test("malformed HTTP 422 diagnostics stop visibly without rendering rescue", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-malformed-422", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationMalformed422OnSide: "BACK",
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')), "Malformed 422 did not stop visibly");
    assert.match(harness.container.textContent ?? "", /malformed human-correction diagnostics/i);
    assert.match(harness.container.textContent ?? "", /MALFORMED_REGISTRATION_FAILURE_DIAGNOSTICS/);
    assert.equal(harness.container.querySelector('[aria-label="BACK Card Map anchor rescue"]'), null);
  } finally {
    await harness.cleanup();
  }
});

test("one provider-gateway 503 visibly retries only the failed side and retains the successful sibling", async () => {
  let releaseRetry: (() => void) | undefined;
  const retryHeld = new Promise<void>((resolve) => { releaseRetry = resolve; });
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-503", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationHttpFailure: {
      side: "BACK",
      status: 503,
      count: 1,
      source: "PROVIDER_GATEWAY",
      code: "PROVIDER_GATEWAY_HTTP_503",
      retryable: true,
      message: "CARD MAP registration gateway returned HTTP 503 (request registration-request-503).",
    },
    onRegistrationRequest: async (side, sideAttempt) => {
      if (side === "BACK" && sideAttempt === 2) await retryHeld;
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => harness.getRegistrationCountForSide("BACK") === 2, "Back automatic retry did not start");
    assert.match(harness.container.textContent ?? "", /Visible automatic retry 1\/1 for back/i);
    assert.equal(harness.getRegistrationCountForSide("FRONT"), 1, "Successful Front must never be rerun");
    await act(async () => releaseRetry?.());
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Successful bounded retry did not apply both sides");
    assert.equal(harness.getRegistrationCount(), 3);
    const attempts = harness.getRegistrationOrchestrations();
    assert.equal(attempts.length, 3);
    assert.equal(attempts[0].orchestration.operationId, attempts[1].orchestration.operationId);
    assert.equal(attempts[1].orchestration.operationId, attempts[2].orchestration.operationId);
    assert.deepEqual(attempts.map((attempt) => ({
      side: attempt.side,
      attemptNumber: attempt.orchestration.attemptNumber,
      trigger: attempt.orchestration.trigger,
      successfulSiblingPreservedAtAttemptStart: attempt.orchestration.successfulSiblingPreservedAtAttemptStart,
    })), [
      { side: "FRONT", attemptNumber: 1, trigger: "INITIAL", successfulSiblingPreservedAtAttemptStart: false },
      { side: "BACK", attemptNumber: 1, trigger: "INITIAL", successfulSiblingPreservedAtAttemptStart: false },
      { side: "BACK", attemptNumber: 2, trigger: "AUTOMATIC_RETRY", successfulSiblingPreservedAtAttemptStart: true },
    ]);
    assert.deepEqual(
      harness.events.filter((event) => event.eventType === "GEOMETRY_CONFIRMED").map((event) => event.details?.mapAppliedScope),
      ["FAMILY", "FAMILY"],
    );
  } finally {
    await harness.cleanup();
  }
});

test("attempt-audit write failure is visible without converting a successful registration into failure", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "family-revision-audit-warning", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationAuditFailsOnSide: "BACK",
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Successful registration was incorrectly blocked by audit failure");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /attempt audit write failed/i);
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /audit-request-back/);
    assert.match(harness.container.textContent ?? "", /applied to Front \+ Back/);
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") >= 1, "Front prepared image did not refresh");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Back prepared image did not refresh");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    assert.equal(harness.bundles.length, 1);
    assert.doesNotMatch(JSON.stringify(harness.bundles[0]), /registrationAuditWarning/);
  } finally {
    await harness.cleanup();
  }
});

test("operator Retry failed side makes one manual request and applies only after both sides validate", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-manual-retry", scope: "EXACT", name: "Squirtle #007" },
    registrationHttpFailure: {
      side: "BACK",
      status: 409,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_409",
      retryable: false,
      message: "CARD MAP provider rejected the registration state (request registration-request-409).",
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry failed side")), "Manual retry choice did not render");
    await act(async () => {
      const retryButton = buttonByText(harness.container, "Retry failed side")!;
      fire(retryButton, "click");
      fire(retryButton, "click");
    });
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Manual failed-side retry did not complete");
    assert.equal(harness.getRegistrationCountForSide("FRONT"), 1);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 2, "Synchronous guard must permit exactly one manual retry");
    const decisions = harness.events.filter((event) => event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.details?.registrationDecision, "RETRY_FAILED_SIDE");
    assert.deepEqual(decisions[0]?.details?.registrationFailedSides, ["BACK"]);
    assert.equal(decisions[0]?.eventId, decisions[0]?.details?.registrationDecisionId);
    const attempts = harness.getRegistrationOrchestrations();
    assert.equal(attempts[0].orchestration.operationId, attempts[2].orchestration.operationId);
    assert.deepEqual(attempts[2], {
      side: "BACK",
      rescue: false,
      orchestration: {
        operationId: attempts[0].orchestration.operationId,
        attemptNumber: 2,
        trigger: "MANUAL_RETRY",
        successfulSiblingPreservedAtAttemptStart: true,
      },
    });
  } finally {
    await harness.cleanup();
  }
});

async function reachInterruptedRegistration(harness: Harness) {
  await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
  await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
  await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
  await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
  await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
  await waitFor(() => Boolean(buttonByText(harness.container, "Continue without Card Map")), "Explicit continue choice did not render");
}

function auditReconciliationNotices(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-audit-reconciliation-notice]"));
}

test("Retry preserves a synchronous decision-audit throw as a visible reconciliation notice", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-retry-audit-throw", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationThrows: true,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => fire(buttonByText(harness.container, "Retry failed side")!, "click"));
    await waitFor(() => harness.getRegistrationCountForSide("BACK") === 2, "Manual retry did not proceed");
    await waitFor(
      () => auditReconciliationNotices(harness.container).some((notice) => /Operator-decision audit write failed/.test(notice.textContent ?? "")),
      "Synchronous decision-audit failure was cleared by Retry",
    );
    assert.equal(
      harness.events.filter((event) => event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION").length,
      1,
    );
  } finally {
    await harness.cleanup();
  }
});

test("Retry preserves a missing decision reporter as a visible reconciliation notice", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-retry-no-reporter", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    omitInstrumentationReporter: true,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => fire(buttonByText(harness.container, "Retry failed side")!, "click"));
    await waitFor(() => harness.getRegistrationCountForSide("BACK") === 2, "Manual retry did not proceed");
    await waitFor(
      () => auditReconciliationNotices(harness.container).some((notice) => /audit reporter is unavailable/i.test(notice.textContent ?? "")),
      "Missing decision reporter warning was cleared by Retry",
    );
  } finally {
    await harness.cleanup();
  }
});

test("newer attempt-audit evidence coexists with the later decision-audit timeout", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-coexisting-audit", scope: "EXACT", name: "Squirtle #007" },
    registrationHttpFailure: {
      side: "BACK",
      status: 409,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_409",
      retryable: false,
      message: "CARD MAP provider rejected the registration state (request registration-request-409).",
    },
    registrationAuditFailsOnSideAttempt: {
      side: "BACK",
      sideAttempt: 2,
      requestId: "audit-request-back-manual-retry",
    },
    decisionInstrumentationResult: new Promise<boolean>(() => undefined),
    decisionAuditConfirmationTimeoutMs: 50,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => fire(buttonByText(harness.container, "Retry failed side")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Manual retry did not proceed");
    await waitFor(
      () => auditReconciliationNotices(harness.container).some((notice) => /audit-request-back-manual-retry/.test(notice.textContent ?? "")),
      "Newer attempt-audit warning did not render",
    );
    await waitFor(
      () => auditReconciliationNotices(harness.container).some((notice) => /audit write was not confirmed within 50 ms/i.test(notice.textContent ?? "")),
      "Later decision-audit timeout did not render",
    );
    const notices = auditReconciliationNotices(harness.container);
    assert.equal(notices.length, 2);
    assert.ok(notices.some((notice) => /audit-request-back-manual-retry/.test(notice.textContent ?? "")));
    assert.ok(notices.some((notice) => /not confirmed within 50 ms/i.test(notice.textContent ?? "")));
  } finally {
    await harness.cleanup();
  }
});

test("repeated receipt of the same attempt-audit warning does not create duplicate notice spam", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-deduped-audit", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    registrationAuditFailsOnSide: "BACK",
  });
  try {
    await reachInterruptedRegistration(harness);
    await waitFor(() => auditReconciliationNotices(harness.container).length === 1, "Initial audit warning did not render");
    for (const expectedBackAttempts of [2, 3]) {
      await act(async () => fire(buttonByText(harness.container, "Retry failed side")!, "click"));
      await waitFor(
        () => harness.getRegistrationCountForSide("BACK") === expectedBackAttempts
          && buttonByText(harness.container, "Retry failed side")?.disabled === false,
        `Manual retry ${expectedBackAttempts - 1} did not finish`,
      );
    }
    const notices = auditReconciliationNotices(harness.container);
    assert.equal(notices.length, 1);
    assert.match(notices[0]?.textContent ?? "", /audit-request-back/);
  } finally {
    await harness.cleanup();
  }
});

test("decision-audit confirmation classifies timely results and rejects stale session or operation", async () => {
  assert.equal(await settleSpeedsterRegistrationDecisionAuditConfirmation(true, 50), "CONFIRMED");
  assert.equal(await settleSpeedsterRegistrationDecisionAuditConfirmation(undefined, 50), "CONFIRMED");
  assert.equal(await settleSpeedsterRegistrationDecisionAuditConfirmation(false, 50), "WRITE_FAILED");
  assert.equal(
    await settleSpeedsterRegistrationDecisionAuditConfirmation(Promise.reject(new Error("audit rejected")), 50),
    "WRITE_FAILED",
  );
  assert.equal(isCurrentSpeedsterRegistrationDecisionAudit({
    currentSessionId: "session-a",
    currentOperationId: "operation-a",
    originatingSessionId: "session-a",
    originatingOperationId: "operation-a",
  }), true);
  assert.equal(isCurrentSpeedsterRegistrationDecisionAudit({
    currentSessionId: "session-b",
    currentOperationId: "operation-a",
    originatingSessionId: "session-a",
    originatingOperationId: "operation-a",
  }), false);
  assert.equal(isCurrentSpeedsterRegistrationDecisionAudit({
    currentSessionId: "session-a",
    currentOperationId: "operation-b",
    originatingSessionId: "session-a",
    originatingOperationId: "operation-a",
  }), false);
});

test("never-settling decision reporter times out visibly without delaying Continue", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-audit-timeout", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: new Promise<boolean>(() => undefined),
    decisionAuditConfirmationTimeoutMs: 50,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    assert.ok(
      harness.container.querySelector('[aria-label="front centering geometry"]'),
      "the operator choice must proceed without awaiting audit confirmation",
    );
    await waitFor(
      () => /audit write was not confirmed within 50 ms/i.test(harness.container.querySelector('[role="alert"]')?.textContent ?? ""),
      "Never-settling decision audit did not produce a bounded visible warning",
    );
  } finally {
    await harness.cleanup();
  }
});

test("late decision rejection is handled and cannot replace the timeout warning", async () => {
  let rejectDecision: ((reason?: unknown) => void) | undefined;
  const decisionResult = new Promise<boolean>((_resolve, reject) => { rejectDecision = reject; });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-late-audit-reject", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: decisionResult,
    decisionAuditConfirmationTimeoutMs: 20,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    await waitFor(
      () => /audit write was not confirmed within 20 ms/i.test(harness.container.querySelector('[role="alert"]')?.textContent ?? ""),
      "Decision audit timeout warning did not render",
    );
    const timeoutWarning = harness.container.querySelector('[role="alert"]')?.textContent;
    await act(async () => {
      rejectDecision?.(new Error("late audit rejection"));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    assert.equal(harness.container.querySelector('[role="alert"]')?.textContent, timeoutWarning);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await harness.cleanup();
  }
});

test("timely rejected decision reporter is visible without delaying Continue", async () => {
  let rejectDecision: ((reason?: unknown) => void) | undefined;
  const decisionResult = new Promise<boolean>((_resolve, reject) => { rejectDecision = reject; });
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-audit-reject", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: decisionResult,
    decisionAuditConfirmationTimeoutMs: 100,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => {
      fire(buttonByText(harness.container, "Continue without Card Map")!, "click");
      rejectDecision?.(new Error("audit rejected"));
      await Promise.resolve();
    });
    assert.ok(harness.container.querySelector('[aria-label="front centering geometry"]'));
    await waitFor(
      () => /Operator-decision audit write failed/.test(harness.container.querySelector('[role="alert"]')?.textContent ?? ""),
      "Timely rejected decision audit was not visible",
    );
    assert.doesNotMatch(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /not confirmed/i);
  } finally {
    await harness.cleanup();
  }
});

test("operator-decision audit failure remains visible while Continue without Card Map proceeds", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-decision-audit", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    instrumentationFails: true,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Continue without Card Map")), "Explicit continue choice did not render");
    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Audit failure incorrectly blocked the operator choice");
    await waitFor(() => /Operator-decision audit write failed/.test(harness.container.querySelector('[role="alert"]')?.textContent ?? ""), "Audit-write failure was not visible");
    assert.match(harness.container.textContent ?? "", /was not applied by operator choice/);
    const decision = harness.events.find((event) => event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION");
    assert.equal(decision?.eventId, decision?.details?.registrationDecisionId);
    assert.equal(decision?.details?.registrationOperationId, harness.getRegistrationOrchestrations()[0].orchestration.operationId);
  } finally {
    await harness.cleanup();
  }
});

test("missing decision reporter is visible and never blocks the selected action", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-no-reporter", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    omitInstrumentationReporter: true,
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(buttonByText(harness.container, "Continue without Card Map")), "Explicit continue choice did not render");
    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Missing reporter incorrectly blocked the choice");
    assert.match(harness.container.querySelector('[role="alert"]')?.textContent ?? "", /audit reporter is unavailable/i);
  } finally {
    await harness.cleanup();
  }
});

test("decision-audit deadline and late failure cannot warn a replacement session", async () => {
  let resolveDecision: ((saved: boolean) => void) | undefined;
  const decisionResult = new Promise<boolean>((resolve) => { resolveDecision = resolve; });
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({ width: 1200, height: 1600, corners: validQuad }),
    activeMap: { revisionId: "exact-revision-late-audit", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: decisionResult,
    decisionAuditConfirmationTimeoutMs: 100,
  });
  try {
    await reachInterruptedRegistration(harness);
    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    await harness.rerenderSession("speedster-session-replacement-audit");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 110));
      resolveDecision?.(false);
      await Promise.resolve();
    });
    assert.doesNotMatch(harness.container.textContent ?? "", /Operator-decision audit write failed|audit write was not confirmed/);
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
    const attempts = harness.getRegistrationOrchestrations();
    assert.equal(new Set(attempts.map((attempt) => attempt.orchestration.operationId)).size, 1);
    assert.deepEqual(attempts.filter((attempt) => attempt.rescue).map((attempt) => ({
      attemptNumber: attempt.orchestration.attemptNumber,
      trigger: attempt.orchestration.trigger,
      successfulSiblingPreservedAtAttemptStart: attempt.orchestration.successfulSiblingPreservedAtAttemptStart,
    })), [
      { attemptNumber: 2, trigger: "HUMAN_RESCUE", successfulSiblingPreservedAtAttemptStart: true },
      { attemptNumber: 3, trigger: "HUMAN_RESCUE", successfulSiblingPreservedAtAttemptStart: true },
    ]);

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

test("one non-cooperative registration timeout stops for explicit choice without automatic retry", async () => {
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
      () => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')),
      "Registration timeout did not stop for explicit operator choice",
    );
    assert.equal(harness.getRegistrationCount(), 2);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1, "Local timeout must never automatically retry");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Prepared-image refresh must remain active during interruption");
    await act(async () => fire(buttonByText(harness.container, "Continue without Card Map")!, "click"));
    assert.deepEqual(
      harness.events.filter((event) => event.eventType === "GEOMETRY_CONFIRMED").map((event) => event.details),
      [
        { side: "FRONT", mapAppliedScope: "NONE" },
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
