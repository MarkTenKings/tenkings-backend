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

function jpegTestFile(name: string): File {
  const blob = new Blob([`speedster-test-image:${name}`], { type: "image/jpeg" });
  return Object.assign(blob, { name, lastModified: 0 }) as File;
}

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
const {
  parseSpeedsterCaptureRegistrationDraft,
  speedsterCaptureDraftMatchesCommittedSession,
} = require(
  "../lib/ai-grader-v2/capture-registration-draft",
) as typeof import("../lib/ai-grader-v2/capture-registration-draft");

type GeometryResponse = Awaited<ReturnType<typeof speedsterImageService.proposeGeometry>>;

const validQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

const colorProposal = (
  mode: "PHYSICAL_OUTER" | "PRINTED_FRAME",
  proposal: GeometryResponse["colorGeometry"]["proposal"] = validQuad,
) => ({
  version: "speedster-color-geometry-proposal-v1" as const,
  engineVersion: "speedster-color-geometry-v1" as const,
  authority: "PROPOSER_ONLY" as const,
  policyProvenance: "OWNER_APPROVED_OFFLINE_ESTIMATE_V1_NOT_LIVE_CALIBRATED" as const,
  mode,
  outcome: proposal ? "ACCEPTED" as const : "INSUFFICIENT_EVIDENCE" as const,
  matColor: "BLACK" as const,
  proposal,
  contrastFloorDeltaE: mode === "PHYSICAL_OUTER" ? 18 : 12,
  minimumSideSupport: mode === "PHYSICAL_OUTER" ? 0.7 : 0.55,
  sideEvidence: Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [side, {
    medianContrastDeltaE: proposal ? 40 : 0,
    medianLightnessContrast: proposal ? 40 : 0,
    supportFraction: proposal ? 1 : 0,
    sampleCount: 33,
    candidateCount: proposal ? 1 : 0,
    ambiguous: false,
  }])) as GeometryResponse["colorGeometry"]["sideEvidence"],
  ambiguity: { candidateCount: proposal ? 1 : 0, runnerUpScoreRatio: null, ambiguous: false },
  advisory: proposal ? null : { code: "SWITCH_MAT", recommendedMat: "WHITE" as const, message: "Switch mats." },
});

const geometryResponse = (corners: GeometryResponse["corners"] = validQuad): GeometryResponse => ({
  width: 1200,
  height: 1600,
  corners,
  colorGeometry: colorProposal("PHYSICAL_OUTER", corners),
  colorGeometryReceipt: "test-physical-receipt",
});

const advisoryGeometryResponse = (
  matColor: "BLACK" | "WHITE",
  recommendedMat: "WHITE" | "MAGENTA",
): GeometryResponse => {
  const fallback = geometryResponse(null);
  return {
    ...fallback,
    colorGeometry: {
      ...fallback.colorGeometry,
      matColor,
      advisory: { code: "SWITCH_MAT", recommendedMat, message: `Switch to ${recommendedMat}.` },
    },
  };
};

const diagnosticGeometryResponse = (): GeometryResponse => {
  const fallback = geometryResponse(null);
  return {
    ...fallback,
    colorGeometry: {
      ...fallback.colorGeometry,
      diagnosticCandidate: {
        version: "speedster-color-geometry-diagnostic-candidate-v1",
        authority: "HUMAN_DRAFT_ONLY",
        quad: validQuad,
        rank: 1,
        contourScore: 987.5,
        frameCoverage: 0.41,
        rejectedGates: [{
          code: "FRAME_COVERAGE_BELOW_FLOOR",
          side: null,
          metric: "frameCoverage",
          observed: 0.41,
          threshold: 0.5,
          comparison: "GTE",
        }],
      },
    },
  };
};

const colorScore = (rate: number) => ({
  version: "speedster-color-geometry-score-v1" as const,
  totalResults: 4,
  acceptedResults: 4,
  acceptedUnchanged: Math.round(rate * 4),
  correctedAccepted: 4 - Math.round(rate * 4),
  manualFallbacks: 0,
  proposalAgreementRate: rate,
  firstDraftYieldRate: rate,
  proposalCoverageRate: 1,
  outcomes: { ACCEPTED: 4, INSUFFICIENT_EVIDENCE: 0, NOT_APPLICABLE: 0, ABSTAIN: 0 },
  breakdown: [],
  recentCards: [],
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function preparedResponse(matColor: "BLACK" | "WHITE" | "MAGENTA" = "BLACK") {
  return jsonResponse({
    width: 1270,
    height: 1778,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    borders: validQuad,
    detectedBorders: ["top", "right", "bottom", "left"],
    inspectionFrame: { width: 1270, height: 1778, cardBounds: { x: 0, y: 0, width: 1270, height: 1778 } },
    colorGeometry: { ...colorProposal("PRINTED_FRAME"), matColor },
    colorGeometryReceipt: `test-printed-${matColor.toLowerCase()}-receipt`,
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
  getIphoneActivationCount: () => number;
  getOriginalUploadPlanCount: (side: "FRONT" | "BACK") => number;
  getPreparedUploadPlanCount: (side: "FRONT" | "BACK") => number;
  getPrepareCount: (side: "FRONT" | "BACK") => number;
  getColorRecoveryRequests: () => readonly Readonly<{
    side: "FRONT" | "BACK";
    mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
    matColor: "BLACK" | "WHITE" | "MAGENTA";
    corners: unknown;
  }>[];
  getRegistrationCount: () => number;
  getRegistrationCountForSide: (side: "FRONT" | "BACK") => number;
  getRegistrationResultsForSide: (side: "FRONT" | "BACK") => readonly Record<string, unknown>[];
  getRescueAttemptIds: () => readonly string[];
  getRegistrationOrchestrations: () => readonly Readonly<{
    side: "FRONT" | "BACK";
    rescue: boolean;
    orchestration: import("../lib/ai-grader-v2/image-service").SpeedsterMapRegistrationOrchestration;
  }>[];
  getPreparedImageRefreshCount: (side: "FRONT" | "BACK") => number;
  getCaptureDraftSerialized: () => string | null;
  draftCleanupFailures: string[];
  events: SpeedsterCaptureInstrumentationEvent[];
  bundles: import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureBundle[];
  rerenderSession: (sessionId: string) => Promise<void>;
  rerenderActiveMap: (activeMap: { revisionId: string; revisionHash?: string; scope: "EXACT" | "FAMILY"; name: string }) => Promise<void>;
  rerenderAuthority: (sessionId: string, token: string) => Promise<void>;
  cleanup: () => Promise<void>;
};

async function mountWorkspace(input: {
  proposeGeometry: typeof speedsterImageService.proposeGeometry;
  draftSurface?: "AI_GRADER" | "CARD_MAPS";
  refreshedUrls?: boolean;
  activeMap?: { revisionId: string; revisionHash?: string; scope: "EXACT" | "FAMILY"; name: string };
  mapBindingStatus?: "LOADED" | "NO_MAP" | "LOOKUP_FAILED" | "INTEGRITY_ERROR" | "HUMAN_REVIEW_WITHOUT_MAP";
  registrationFails?: boolean;
  registrationFailsOnSide?: "FRONT" | "BACK";
  registrationNeedsRescueOnSide?: "FRONT" | "BACK";
  registrationNeedsRescueOnBoth?: boolean;
  registrationMalformed422OnSide?: "FRONT" | "BACK";
  registrationGlobalGateFailure?: boolean;
  rescueFailures?: number;
  preparedImageRefreshFails?: boolean;
  preparedImageRefreshFailures?: number;
  preparedImageRequestBarrier?: (side: "FRONT" | "BACK") => Promise<void>;
  preparedImageFetch?: (input: Readonly<{
    side: "FRONT" | "BACK";
    storageKey: string;
    requestNumber: number;
  }>) => Response | undefined | Promise<Response | undefined>;
  originalImageFetch?: (input: Readonly<{
    side: "FRONT" | "BACK";
    storageKey: string;
    signal: AbortSignal | null | undefined;
  }>) => Promise<Response>;
  captureDraftSerialized?: string;
  localStorageGetFails?: boolean;
  localStorageSetFails?: boolean;
  localStorageRemoveFails?: boolean;
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
  autoConfirmMats?: boolean;
  iphonePollFetch?: (pollCount: number, url: string) => Response | undefined | Promise<Response | undefined>;
  iphoneStorageGeneration?: "VERSIONED" | "LEGACY";
  scoreFetch?: (request: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  geometryImagesStartVisible?: boolean;
  prepareFetch?: (input: Readonly<{
    side: "FRONT" | "BACK";
    matColor: "BLACK" | "WHITE" | "MAGENTA";
    signal: AbortSignal | null | undefined;
  }>) => Promise<Response>;
  colorRecoveryFailure?: Readonly<{
    side: "FRONT" | "BACK";
    mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
  }>;
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
  if (input.captureDraftSerialized) {
    dom.window.localStorage.setItem(
      "tenkings:speedster:capture-registration-draft:v1:speedster-session-lifecycle-test",
      input.captureDraftSerialized,
    );
  }
  const storage = dom.window.localStorage;
  const storageGetItem = storage.getItem.bind(storage);
  const storageSetItem = storage.setItem.bind(storage);
  const storageRemoveItem = storage.removeItem.bind(storage);
  const storagePrototype = Object.getPrototypeOf(storage) as Storage;
  if (input.localStorageGetFails) {
    Object.defineProperty(storagePrototype, "getItem", { configurable: true, value: () => { throw new Error("localStorage get failed"); } });
  }
  if (input.localStorageSetFails) {
    Object.defineProperty(storagePrototype, "setItem", { configurable: true, value: () => { throw new Error("localStorage set failed"); } });
  }
  if (input.localStorageRemoveFails) {
    Object.defineProperty(storagePrototype, "removeItem", { configurable: true, value: () => { throw new Error("localStorage remove failed"); } });
  }

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
  if (input.geometryImagesStartVisible !== false) {
    Object.defineProperty(dom.window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(Date.now());
        return 1;
      },
    });
  }
  let pollCount = 0;
  let iphoneActivationCount = 0;
  const originalUploadPlanCount = { FRONT: 0, BACK: 0 };
  const preparedUploadPlanCount = { FRONT: 0, BACK: 0 };
  const prepareCount = { FRONT: 0, BACK: 0 };
  const colorRecoveryRequests: Array<Readonly<{
    side: "FRONT" | "BACK";
    mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
    matColor: "BLACK" | "WHITE" | "MAGENTA";
    corners: unknown;
  }>> = [];
  let registrationCount = 0;
  const registrationCountBySide = { FRONT: 0, BACK: 0 };
  const registrationResultsBySide: Record<"FRONT" | "BACK", Record<string, unknown>[]> = { FRONT: [], BACK: [] };
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
    if (url === "/api/admin/ai-grader-v2/color-geometry-score") {
      return input.scoreFetch?.(request, init) ?? jsonResponse({});
    }
    if (url === "/api/admin/ai-grader-v2/iphone-capture" && init?.method === "POST") {
      iphoneActivationCount += 1;
      return jsonResponse({ pairingUrl: "https://pair.example.test/speedster" });
    }
    if (url.startsWith("/api/admin/ai-grader-v2/iphone-capture?")) {
      pollCount += 1;
      const customResponse = await input.iphonePollFetch?.(pollCount, url);
      if (customResponse) return customResponse;
      const suffix = input.refreshedUrls && pollCount > 1 ? "refreshed" : "original";
      return jsonResponse({
        readyVersion: 1,
        storageGeneration: input.iphoneStorageGeneration ?? "VERSIONED",
        front: {
          storageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/front.jpg",
          readUrl: `https://images.example.test/front-${suffix}.jpg`,
        },
        back: {
          storageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/back.jpg",
          readUrl: `https://images.example.test/back-${suffix}.jpg`,
        },
      });
    }
    if (url === "/api/admin/ai-grader-v2/upload-plan") {
      const body = JSON.parse(String(init?.body)) as {
        side: "FRONT" | "BACK";
        kind: "ORIGINAL" | "ORIGINAL_VERIFY" | "PREPARED";
        targetedRecapture?: boolean;
        sourceImageStorageKey?: string;
        storageKey?: string;
        checksumSha256?: string;
        byteSize?: number;
      };
      if (body.kind === "ORIGINAL") {
        originalUploadPlanCount[body.side] += 1;
        const storageKey = body.targetedRecapture
          ? `ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/recapture-00000000-0000-4000-8000-000000000007/${body.side.toLowerCase()}.jpg`
          : `ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/${body.side.toLowerCase()}.jpg`;
        return jsonResponse({
          storageKey,
          uploadUrl: `https://upload.example.test/${encodeURIComponent(storageKey)}`,
          uploadMethod: "PUT",
          uploadHeaders: {
            "Content-Type": "image/jpeg",
            "x-amz-acl": "private",
            "x-amz-checksum-sha256": Buffer.from(body.checksumSha256 ?? "", "hex").toString("base64"),
          },
          checksumSha256: body.checksumSha256,
          byteSize: body.byteSize,
        });
      }
      if (body.kind === "ORIGINAL_VERIFY") {
        return jsonResponse({
          storageKey: body.storageKey,
          readUrl: `https://read.example.test/${encodeURIComponent(body.storageKey ?? "")}`,
        });
      }
      preparedUploadPlanCount[body.side] += 1;
      const generation = /\/original\/(iphone-v[1-9][0-9]*|recapture-[a-f0-9-]+)\//i
        .exec(body.sourceImageStorageKey ?? "")?.[1]?.toLowerCase();
      const preparedPrefix = `ai-grader-v2/admin-1/speedster-session-lifecycle-test/prepared/${body.side.toLowerCase()}${generation ? `/${generation}` : ""}`;
      const outputs = Object.fromEntries(["RECTIFIED", "INSPECTION", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"].map((kind) => [
        kind,
        {
          storageKey: `${preparedPrefix}/${kind.toLowerCase()}.webp`,
          readUrl: `https://read.example.test/${encodeURIComponent(`${preparedPrefix}/${kind.toLowerCase()}.webp`)}`,
        },
      ]));
      return jsonResponse({ outputs });
    }
    if (url.startsWith("https://upload.example.test/") && init?.method === "PUT") {
      return new Response(null, { status: 200 });
    }
    if (url.includes("/api/admin/ai-grader-v2/sessions/") && url.includes("/original-image?side=")) {
      const parsedUrl = new URL(url, "https://collect.tenkings.co");
      const side = parsedUrl.searchParams.get("side") === "FRONT" ? "FRONT" : "BACK";
      const storageKey = parsedUrl.searchParams.get("storageKey") ?? "";
      if (input.originalImageFetch) {
        return input.originalImageFetch({ side, storageKey, signal: init?.signal });
      }
      return jsonResponse({
        side,
        storageKey,
        imageUrl: `https://read.example.test/${encodeURIComponent(storageKey)}?refreshed=1`,
      });
    }
    if (url.includes("/api/admin/ai-grader-v2/sessions/") && url.includes("/prepared-image?side=")) {
      const parsedUrl = new URL(url, "https://collect.tenkings.co");
      const side = parsedUrl.searchParams.get("side") === "FRONT" ? "FRONT" : "BACK";
      const storageKey = parsedUrl.searchParams.get("storageKey") ?? "";
      preparedImageRefreshCount[side] += 1;
      const customResponse = await input.preparedImageFetch?.({
        side,
        storageKey,
        requestNumber: preparedImageRefreshCount[side],
      });
      if (customResponse) return customResponse;
      await input.preparedImageRequestBarrier?.(side);
      if (input.preparedImageRefreshFails || remainingPreparedImageRefreshFailures > 0) {
        remainingPreparedImageRefreshFailures = Math.max(0, remainingPreparedImageRefreshFailures - 1);
        return jsonResponse({ message: `The ${side.toLowerCase()} prepared card image is not ready.` }, 409);
      }
      return jsonResponse({
        side,
        imageUrl: `https://read.example.test/${side.toLowerCase()}-rectified-refresh-${preparedImageRefreshCount[side]}`,
      });
    }
    if (url === "/api/admin/ai-grader-v2/image/color-geometry") {
      const body = JSON.parse(String(init?.body)) as {
        side: "FRONT" | "BACK";
        mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
        matColor: "BLACK" | "WHITE" | "MAGENTA";
        corners: unknown;
      };
      colorRecoveryRequests.push(body);
      if (input.colorRecoveryFailure?.side === body.side
        && input.colorRecoveryFailure.mode === body.mode) {
        return jsonResponse({ message: `Targeted ${body.side} ${body.mode} recovery failed.` }, 503);
      }
      return jsonResponse({
        width: body.mode === "PHYSICAL_OUTER" ? 1200 : 1270,
        height: body.mode === "PHYSICAL_OUTER" ? 1600 : 1778,
        colorGeometry: { ...colorProposal(body.mode), matColor: body.matColor },
        colorGeometryReceipt: `recovered-${body.side.toLowerCase()}-${body.mode.toLowerCase()}-${colorRecoveryRequests.length}`,
      });
    }
    if (url === "/api/admin/ai-grader-v2/image/prepare") {
      const body = JSON.parse(String(init?.body)) as {
        side: "FRONT" | "BACK";
        matColor: "BLACK" | "WHITE" | "MAGENTA";
      };
      prepareCount[body.side] += 1;
      return input.prepareFetch?.({
        side: body.side,
        matColor: body.matColor,
        signal: init?.signal,
      }) ?? preparedResponse(body.matColor);
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
      if (!body.rescue && (input.registrationNeedsRescueOnBoth || input.registrationNeedsRescueOnSide === body.side)) {
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
      const registrationResult = {
        version: body.rescue ? "opencv-redundant-ransac-registration-v2" : "opencv-human-anchor-registration-v1",
        side: body.side,
        mapRevisionId: input.activeMap?.revisionId,
        currentPhysicalQuadSha256: "a".repeat(64),
        currentInspectionSha256: "b".repeat(64),
        homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        anchors: validQuad.map((point, index) => ({
          anchorId: `a${index + 1}`, expectedPoint: point, locatedPoint: point, score: 1,
        })),
        projectedDesignBoundary: { kind: "QUAD", points: validQuad },
        projectedZones: [{ id: "name", label: "Card name", semanticType: "PRINT_TEXT", polygon: validQuad }],
        serverReceipt: `server-signed-${body.side.toLowerCase()}-${"d".repeat(64)}`,
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
      };
      registrationResultsBySide[body.side].push(registrationResult);
      return jsonResponse(registrationResult);
    }
    if (url.endsWith("/map-authority")) {
      return jsonResponse({ authority: { status: "HUMAN_REVIEW_WITHOUT_MAP" } });
    }
    throw new Error(`Unexpected fetch in lifecycle test: ${url}`);
  };

  const originalProposeGeometry = speedsterImageService.proposeGeometry;
  speedsterImageService.proposeGeometry = async (...args) => {
    const response = await input.proposeGeometry(...args);
    const requestedMat = args[1].matColor;
    return response.colorGeometry.matColor === requestedMat ? response : {
      ...response,
      colorGeometry: { ...response.colorGeometry, matColor: requestedMat },
    };
  };
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const geometryImageObserver = input.geometryImagesStartVisible === false
    ? null
    : new dom.window.MutationObserver(() => {
      for (const image of container.querySelectorAll<HTMLImageElement>('img[alt="front trading card"], img[alt="back trading card"]')) {
        if (image.dataset.lifecycleLoaded === "true") continue;
        image.dataset.lifecycleLoaded = "true";
        Object.defineProperties(image, {
          complete: { configurable: true, value: true },
          naturalWidth: { configurable: true, value: 1200 },
          naturalHeight: { configurable: true, value: 1600 },
        });
        giveImageRenderedArea(image);
        image.dispatchEvent(new dom.window.Event("load", { bubbles: true }));
      }
    });
  geometryImageObserver?.observe(container, { childList: true, subtree: true });
  const root = createRoot(container);
  const events: SpeedsterCaptureInstrumentationEvent[] = [];
  const bundles: import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureBundle[] = [];
  const draftCleanupFailures: string[] = [];
  let activeMap = input.activeMap;
  const renderSession = (sessionId: string, renderToken = "admin-token") => (
    <CaptureWorkspace
      token={renderToken}
      sessionId={sessionId}
      cardProfile="POKEMON"
      draftSurface={input.draftSurface}
      activeMapRevisionId={activeMap?.revisionId}
      activeMapRevisionHash={activeMap?.revisionHash ?? (activeMap ? "a".repeat(64) : undefined)}
      activeMapScope={activeMap?.scope}
      activeMapName={activeMap?.name}
      mapBindingStatus={input.mapBindingStatus}
      mapLookupFailed={input.mapLookupFailed}
      imageRequestTimeoutMs={input.imageRequestTimeoutMs}
      decisionAuditConfirmationTimeoutMs={input.decisionAuditConfirmationTimeoutMs}
      onReady={async (bundle, clearPreservedBrowserDraft) => {
        bundles.push(bundle);
        const result = await (input.onSave?.(bundle) ?? { saved: true });
        if (result.saved) clearPreservedBrowserDraft();
        return result;
      }}
      onDraftCleanupFailure={(failure) => draftCleanupFailures.push(failure)}
      onInstrumentationEvent={input.omitInstrumentationReporter ? undefined as never : (event) => {
        events.push(event);
        if (["MAP_REGISTRATION_OPERATOR_DECISION", "MAP_AUTHORITY_OPERATOR_DECISION"].includes(event.eventType)
          && input.decisionInstrumentationThrows) {
          throw new Error("decision instrumentation threw synchronously");
        }
        if (["MAP_REGISTRATION_OPERATOR_DECISION", "MAP_AUTHORITY_OPERATOR_DECISION"].includes(event.eventType)
          && input.decisionInstrumentationResult) {
          return input.decisionInstrumentationResult;
        }
        return input.instrumentationFails ? false : true;
      }}
    />
  );
  await act(async () => {
    root.render(renderSession("speedster-session-lifecycle-test"));
  });
  const awaitPhotoReadiness = async () => {
    if (input.captureDraftSerialized || input.localStorageGetFails) {
      await waitFor(
        () => Boolean(container.querySelector('[aria-label="Preserved capture draft"]')
          || container.querySelector('[aria-label="Preserved capture draft Card Map mismatch"]')
          || buttonByText(container, "Discard invalid preserved draft")),
        "The preserved capture draft failure did not become explicit",
      );
      return;
    }
    if (input.autoConfirmMats === false && input.iphonePollFetch) {
      await waitFor(
        () => /legacy|non-versioned/i.test(container.textContent ?? ""),
        "The rejected legacy capture pair did not become visible",
      );
      return;
    }
    await waitFor(
      () => Boolean(buttonByText(container, "Set geometry")),
      "The current capture pair did not become ready",
    );
  };
  await awaitPhotoReadiness();

  return {
    container,
    root,
    getPollCount: () => pollCount,
    getIphoneActivationCount: () => iphoneActivationCount,
    getOriginalUploadPlanCount: (side) => originalUploadPlanCount[side],
    getPreparedUploadPlanCount: (side) => preparedUploadPlanCount[side],
    getPrepareCount: (side) => prepareCount[side],
    getColorRecoveryRequests: () => colorRecoveryRequests,
    getRegistrationCount: () => registrationCount,
    getRegistrationCountForSide: (side) => registrationCountBySide[side],
    getRegistrationResultsForSide: (side) => registrationResultsBySide[side],
    getRescueAttemptIds: () => rescueAttemptIds,
    getRegistrationOrchestrations: () => registrationOrchestrations,
    getPreparedImageRefreshCount: (side) => preparedImageRefreshCount[side],
    getCaptureDraftSerialized: () => storageGetItem(
      "tenkings:speedster:capture-registration-draft:v1:speedster-session-lifecycle-test",
    ),
    draftCleanupFailures,
    events,
    bundles,
    rerenderSession: async (nextSessionId) => {
      await act(async () => root.render(renderSession(nextSessionId)));
      await awaitPhotoReadiness();
    },
    rerenderAuthority: async (nextSessionId, nextToken) => {
      await act(async () => root.render(renderSession(nextSessionId, nextToken)));
    },
    rerenderActiveMap: async (nextActiveMap) => {
      activeMap = nextActiveMap;
      await act(async () => root.render(renderSession("speedster-session-lifecycle-test")));
      await waitFor(
        () => Boolean(buttonByText(container, "Discard invalid preserved draft")
          || container.querySelector('[aria-label="Preserved capture draft Card Map mismatch"]')
          || container.querySelector('[aria-label="Preserved capture draft"]')),
        "The changed map binding did not resolve the preserved draft explicitly",
      );
    },
    cleanup: async () => {
      geometryImageObserver?.disconnect();
      await act(async () => root.unmount());
      Object.defineProperties(storagePrototype, {
        getItem: { configurable: true, value: storageGetItem },
        setItem: { configurable: true, value: storageSetItem },
        removeItem: { configurable: true, value: storageRemoveItem },
      });
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
      return geometryResponse();
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
      resolveOld?.(geometryResponse(null));
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
      speedsterImageService.proposeGeometry("admin-token", {
        sessionId: "speedster-session-lifecycle-test",
        side: "FRONT",
        imageUrl: "https://images.example.test/front.jpg",
        sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/front.jpg",
        matColor: "BLACK",
      }),
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

async function placeManualGeometryIfNeeded(container: HTMLElement) {
  await waitFor(() => {
    const button = buttonByText(container, "Continue");
    const manualReady = /MANUAL FOUR-CORNER MODE/.test(container.textContent ?? "")
      && !/Waiting for the exact source image to be visibly rendered/.test(container.textContent ?? "");
    return Boolean(button && !button.disabled) || manualReady;
  }, "Geometry did not become visibly confirmable or enter visible manual four-corner mode");
  const continueButton = buttonByText(container, "Continue");
  if (continueButton && !continueButton.disabled) return;
  const overlay = container.querySelector<SVGSVGElement>('svg[aria-label="Adjustable card corner geometry"]');
  assert.ok(overlay, "Manual geometry overlay did not render");
  Object.defineProperty(overlay, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }),
  });
  for (const [clientX, clientY] of [[100, 100], [900, 100], [900, 900], [100, 900]]) {
    await act(async () => fire(overlay, "pointerdown", { button: 0, clientX, clientY }));
  }
  await waitFor(() => buttonByText(container, "Continue")?.disabled === false, "Four manual points did not create a confirmable human quad");
}

async function prepareBothSidesAndReachFrontCentering(harness: Harness) {
  await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
  await waitFor(
    () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
    "Front geometry did not open",
  );
  await placeManualGeometryIfNeeded(harness.container);
  await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
  await waitFor(
    () => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')),
    "Back geometry did not open",
  );
  await placeManualGeometryIfNeeded(harness.container);
  await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
  await waitFor(
    () => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')),
    "Front centering did not open",
  );
}

test("legacy iPhone pair cannot enter a new grade even when an old server offers a choice", async () => {
  const harness = await mountWorkspace({
    autoConfirmMats: false,
    iphonePollFetch: (pollCount, url) => {
      void pollCount;
      void url;
      return jsonResponse({
        message: "A complete legacy iPhone pair exists for ready version 4. Explicit operator confirmation is required before it can be selected.",
        readyVersion: 4,
        legacyPairAvailable: true,
        storageGeneration: "LEGACY",
      }, 409);
    },
    proposeGeometry: async () => geometryResponse(),
  });
  try {
    assert.equal(harness.container.querySelector('img[alt="front card preview"]'), null);
    assert.equal(harness.container.querySelector('img[alt="back card preview"]'), null);
    assert.equal(buttonByText(harness.container, "Use legacy pair for ready version 4"), undefined);
    assert.match(harness.container.textContent ?? "", /legacy iPhone pair exists.*Existing photos and operator work are preserved/is);
  } finally {
    await harness.cleanup();
  }
});

test("unsolicited HTTP 200 legacy pair is rejected as non-versioned", async () => {
  const harness = await mountWorkspace({
    autoConfirmMats: false,
    iphonePollFetch: () => jsonResponse({
      readyVersion: 9,
      storageGeneration: "LEGACY",
      front: {
        storageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/front.jpg",
        readUrl: "https://images.example.test/unsolicited-front.jpg",
      },
      back: {
        storageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/back.jpg",
        readUrl: "https://images.example.test/unsolicited-back.jpg",
      },
    }),
    proposeGeometry: async () => geometryResponse(),
  });
  try {
    assert.equal(harness.container.querySelector('img[alt="front card preview"]'), null);
    assert.equal(harness.container.querySelector('img[alt="back card preview"]'), null);
    assert.equal(buttonByText(harness.container, "Use legacy pair for ready version 9"), undefined);
    assert.match(harness.container.textContent ?? "", /non-versioned iPhone capture pair was rejected/i);
  } finally {
    await harness.cleanup();
  }
});

test("mat labels are optional diagnostics and never block geometry", async () => {
  const harness = await mountWorkspace({
    autoConfirmMats: false,
    proposeGeometry: async () => geometryResponse(),
  });
  try {
    assert.match(harness.container.textContent ?? "", /FRONT MAT · OPTIONAL DIAGNOSTIC LABEL · NEVER A CORNER GATE/);
    assert.match(harness.container.textContent ?? "", /BACK MAT · OPTIONAL DIAGNOSTIC LABEL · NEVER A CORNER GATE/);
    assert.ok(buttonByText(harness.container, "Set geometry"));
    assert.equal(buttonByText(harness.container, "Confirm both mats to continue"), undefined);
  } finally {
    await harness.cleanup();
  }
});

test("normal mounted grading flow reaches draggable Set Geometry after a simulated five-second response", async () => {
  const pending: Array<(value: GeometryResponse) => void> = [];
  let now = 10_000;
  const originalDateNow = Date.now;
  const originalConsoleInfo = console.info;
  const diagnostics: string[] = [];
  Date.now = () => now;
  console.info = (line) => diagnostics.push(String(line));
  const harness = await mountWorkspace({
    geometryImagesStartVisible: false,
    proposeGeometry: async () => new Promise<GeometryResponse>((resolve) => pending.push(resolve)),
  });

  try {
    const setGeometry = buttonByText(harness.container, "Set geometry");
    assert.ok(setGeometry);
    await act(async () => fire(setGeometry, "click"));
    assert.match(setGeometry.textContent ?? "", /Preparing/);
    await waitFor(() => pending.length === 1, "Front geometry request did not start");

    now += 5_000;
    await act(async () => pending[0](geometryResponse()));
    await waitFor(() => pending.length === 2, "Back geometry request did not start");
    now += 125;
    await act(async () => pending[1](geometryResponse()));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Normal geometry did not reach the mounted Set Geometry screen",
    );

    const overlay = harness.container.querySelector<SVGSVGElement>('[aria-label="Adjustable card corner geometry"]');
    const topLeft = harness.container.querySelector<SVGGElement>('[aria-label="Top left"]');
    const blockedButton = buttonByText(harness.container, "Source image unavailable");
    assert.ok(overlay && topLeft && blockedButton);
    assert.equal(blockedButton.disabled, true, "Geometry confirmation must wait for a visibly rendered exact source");
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
    assert.equal(buttonByText(harness.container, "Continue")?.disabled, false);
    assert.match(diagnostics[0], /"durationMs":5000/);
    assert.match(diagnostics[0], /"corners":"present"/);
    assert.match(diagnostics[0], /"imageLoadOutcome":"loaded"/);
  } finally {
    await harness.cleanup();
    Date.now = originalDateNow;
    console.info = originalConsoleInfo;
  }
});

test("API-compatible accepted physical Color geometry seeds the first editable physical quad before human confirmation", async () => {
  const physicalColorQuad = [
    { x: 0.15, y: 0.2 },
    { x: 0.85, y: 0.2 },
    { x: 0.85, y: 0.8 },
    { x: 0.15, y: 0.8 },
  ] as const;
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(physicalColorQuad),
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Accepted physical Color proposal did not reach editable Front geometry",
    );
    const topLeft = harness.container.querySelector<SVGGElement>('[aria-label="Top left"]');
    assert.equal(topLeft?.querySelector("circle")?.getAttribute("cx"), "150");
    assert.equal(topLeft?.querySelector("circle")?.getAttribute("cy"), "200");
    assert.match(harness.container.textContent ?? "", /PHYSICAL OUTLINE FOUND · REVIEW AND CONFIRM.*percentage diagnostics never hide this outline/is);
    await waitFor(
      () => buttonByText(harness.container, "Continue")?.disabled === false,
      "Visible accepted Color geometry did not reach human confirmation",
    );
  } finally {
    await harness.cleanup();
  }
});

test("loaded image with no rendered area blocks confirmation and offers exact-source recovery", async () => {
  const originalConsoleInfo = console.info;
  const diagnostics: string[] = [];
  console.info = (line) => diagnostics.push(String(line));
  const harness = await mountWorkspace({
    geometryImagesStartVisible: false,
    proposeGeometry: async () => geometryResponse(),
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
    assert.equal(buttonByText(harness.container, "Source image unavailable")?.disabled, true);
    assert.equal(buttonByText(harness.container, "Refresh exact source image")?.disabled, false);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /"imageLoadOutcome":"render-error"/);
  } finally {
    await harness.cleanup();
    console.info = originalConsoleInfo;
  }
});

test("null corners mount empty four-click manual geometry without inventing a rectangle", async () => {
  let call = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => {
      call += 1;
      return geometryResponse(call === 1 ? null : validQuad);
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
    assert.match(harness.container.textContent ?? "", /Click the physical corners in order/);
    assert.match(harness.container.textContent ?? "", /MANUAL FOUR-CORNER MODE/);
    assert.equal(harness.container.querySelectorAll("[aria-label='Top left'], [aria-label='Top right'], [aria-label='Bottom right'], [aria-label='Bottom left']").length, 0);
    await waitFor(
      () => buttonByText(harness.container, "Place 4 corners")?.disabled === true,
      "Visible manual mode did not expose its blocked four-corner action",
    );
    await placeManualGeometryIfNeeded(harness.container);
    assert.equal(harness.container.querySelectorAll("[aria-label='Top left'], [aria-label='Top right'], [aria-label='Bottom right'], [aria-label='Bottom left']").length, 4);
    assert.match(harness.container.textContent ?? "", /HUMAN-AUTHORED DRAFT/);
  } finally {
    await harness.cleanup();
  }
});

test("rejected Color evidence renders as a labelled diagnostic draft with failed gates", async () => {
  let call = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => {
      call += 1;
      return call === 1 ? diagnosticGeometryResponse() : geometryResponse();
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Diagnostic geometry did not render",
    );
    await placeManualGeometryIfNeeded(harness.container);
    assert.match(harness.container.textContent ?? "", /REJECTED DIAGNOSTIC · HUMAN REVIEW ONLY/);
    assert.match(harness.container.textContent ?? "", /frameCoverage: 0.4100; requires ≥ 0.5000/);
    assert.equal(harness.container.querySelectorAll("[aria-label='Top left'], [aria-label='Top right'], [aria-label='Bottom right'], [aria-label='Bottom left']").length, 4);
  } finally {
    await harness.cleanup();
  }
});

test("non-accepted Color evidence carrying top-level corners never gains automatic authority", async () => {
  const inconsistent = geometryResponse();
  const harness = await mountWorkspace({
    proposeGeometry: async () => ({
      ...inconsistent,
      colorGeometry: {
        ...inconsistent.colorGeometry,
        outcome: "ABSTAIN",
        proposal: null,
      },
    }),
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(
      () => /corners contradict the Color outcome authority/i.test(harness.container.textContent ?? ""),
      "Contradictory Color geometry did not fail visibly",
    );
    assert.equal(harness.container.querySelector('[aria-label="front card geometry"]'), null);
    assert.equal(harness.getPrepareCount("FRONT") + harness.getPrepareCount("BACK"), 0);
  } finally {
    await harness.cleanup();
  }
});

test("a stalled exact-source refresh releases geometry controls with visible retry and unchanged handles", async () => {
  const suppliedSignals: AbortSignal[] = [];
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    imageRequestTimeoutMs: 10,
    originalImageFetch: async ({ signal }) => {
      if (signal) suppliedSignals.push(signal);
      return new Promise(() => {});
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(
      () => /exact source refresh timed out.*geometry are preserved/i.test(harness.container.textContent ?? ""),
      "Stalled exact-source refresh did not release to explicit recovery",
    );
    assert.equal(suppliedSignals[0]?.aborted, true);
    assert.equal(buttonByText(harness.container, "Continue")?.disabled, false);
    assert.equal(harness.container.querySelectorAll("[aria-label='Top left'], [aria-label='Top right'], [aria-label='Bottom right'], [aria-label='Bottom left']").length, 4);
    assert.equal(harness.getPrepareCount("FRONT"), 0);
  } finally {
    await harness.cleanup();
  }
});

test("Front targeted mat recapture preserves the complete Back side through the final bundle", async () => {
  const geometryInputs: Array<Parameters<typeof speedsterImageService.proposeGeometry>[1]> = [];
  let frontGeometryCalls = 0;
  let backGeometryCalls = 0;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:https://collect.tenkings.co/front-white-recapture",
  });
  const harness = await mountWorkspace({
    activeMap: { revisionId: "map-must-not-register", scope: "FAMILY", name: "No premature map" },
    proposeGeometry: async (_token, input) => {
      geometryInputs.push(input);
      if (input.side === "FRONT") {
        frontGeometryCalls += 1;
        if (frontGeometryCalls === 1) return advisoryGeometryResponse("BLACK", "WHITE");
      } else {
        backGeometryCalls += 1;
      }
      const accepted = geometryResponse();
      return {
        ...accepted,
        colorGeometry: { ...accepted.colorGeometry, matColor: input.matColor },
        colorGeometryReceipt: `${input.side.toLowerCase()}-${input.matColor.toLowerCase()}-attempt-${input.side === "FRONT" ? frontGeometryCalls : backGeometryCalls}`,
      };
    },
  });
  try {
    await prepareBothSidesAndReachFrontCentering(harness);
    await waitFor(
      () => Boolean(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE")),
      "Front change-mat action did not render",
    );
    const retainedBackRegistration = structuredClone(harness.getRegistrationResultsForSide("BACK")[0]);
    const iphoneActivationBeforeRecapture = harness.getIphoneActivationCount();
    const iphonePollsBeforeRecapture = harness.getPollCount();
    const backRefreshesBeforeRecapture = harness.getPreparedImageRefreshCount("BACK");
    await act(async () => fire(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE")!, "click"));

    assert.equal(harness.container.querySelector('img[alt="front card preview"]'), null);
    assert.ok(harness.container.querySelector('img[alt="back card preview"]'), "The successful Back original must remain visible");
    assert.equal(
      harness.container.querySelector<HTMLInputElement>('input[name="front-mat-color"][value="WHITE"]')?.checked,
      true,
    );
    assert.equal(
      harness.container.querySelector<HTMLInputElement>('input[name="back-mat-color"][value="WHITE"]')?.checked,
      true,
      "The non-advised mat selection must remain unchanged",
    );
    assert.equal(buttonByText(harness.container, "Add replacement Front photo to continue")?.disabled, true);
    assert.equal(harness.getRegistrationCountForSide("FRONT"), 1);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1);
    assert.equal(harness.bundles.length, 0);
    assert.match(harness.container.textContent ?? "", /completed sibling side is retained/i);
    assert.match(harness.container.textContent ?? "", /Targeted mat recapture uses only the unlocked local file slot/i);
    assert.equal(harness.container.querySelector('[aria-label="Pair iPhone QR code"]'), null);

    const [frontInput, backInput] = Array.from(harness.container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    assert.ok(frontInput && backInput);
    assert.equal(frontInput.disabled, false);
    assert.equal(backInput.disabled, true, "The retained Back original cannot be replaced during a Front-only rerun");
    Object.defineProperty(frontInput, "files", {
      configurable: true,
      value: [jpegTestFile("front-white.jpg")],
    });
    await act(async () => frontInput.dispatchEvent(new window.Event("change", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(harness.container, "Set Front geometry")), "Fresh Front did not restore readiness");

    await act(async () => fire(buttonByText(harness.container, "Set Front geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Replacement Front did not rerun physical geometry",
    );
    assert.deepEqual(
      geometryInputs.map(({ sessionId, side, sourceImageStorageKey, matColor }) => ({
        sessionId, side, sourceImageStorageKey, matColor,
      })),
      [
        { sessionId: "speedster-session-lifecycle-test", side: "FRONT", sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/front.jpg", matColor: "BLACK" },
        { sessionId: "speedster-session-lifecycle-test", side: "BACK", sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/back.jpg", matColor: "WHITE" },
        { sessionId: "speedster-session-lifecycle-test", side: "FRONT", sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/recapture-00000000-0000-4000-8000-000000000007/front.jpg", matColor: "WHITE" },
      ],
      "The rerun must bind only the replacement Front and preserve the successful Back",
    );

    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Only Front centering did not reopen");
    assert.equal(harness.container.querySelector('[aria-label="back card geometry"]'), null, "The retained Back geometry must not reopen");
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") >= 1, "Front prepared image did not refresh");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Back prepared image did not refresh");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => harness.bundles.length === 1, "Recaptured pair was not assembled");

    assert.equal(harness.bundles[0].front.originalStorageKey, "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/recapture-00000000-0000-4000-8000-000000000007/front.jpg");
    assert.equal(harness.bundles[0].back.originalStorageKey, "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/back.jpg");
    assert.equal(harness.bundles[0].front.colorGeometryEvidence![0].matColor, "WHITE");
    assert.equal(
      harness.bundles[0].front.colorGeometryEvidence![0].serverReceipt,
      "front-white-attempt-2",
      "The final capture must use the newly returned signed color receipt, never the pre-recapture receipt",
    );
    assert.equal(
      harness.bundles[0].back.colorGeometryEvidence![0].serverReceipt,
      "back-white-attempt-1",
      "The successful sibling receipt must remain byte-for-byte unchanged",
    );
    assert.equal(
      harness.bundles[0].back.colorGeometryEvidence![1].serverReceipt,
      "test-printed-white-receipt",
      "The retained Back printed receipt must remain byte-for-byte unchanged",
    );
    assert.deepEqual(harness.bundles[0].back.mapRegistration, retainedBackRegistration);
    assert.deepEqual({
      originalUploadPlans: {
        FRONT: harness.getOriginalUploadPlanCount("FRONT"),
        BACK: harness.getOriginalUploadPlanCount("BACK"),
      },
      preparedUploadPlans: {
        FRONT: harness.getPreparedUploadPlanCount("FRONT"),
        BACK: harness.getPreparedUploadPlanCount("BACK"),
      },
      prepares: {
        FRONT: harness.getPrepareCount("FRONT"),
        BACK: harness.getPrepareCount("BACK"),
      },
      registrations: {
        FRONT: harness.getRegistrationCountForSide("FRONT"),
        BACK: harness.getRegistrationCountForSide("BACK"),
      },
    }, {
      originalUploadPlans: { FRONT: 1, BACK: 0 },
      preparedUploadPlans: { FRONT: 2, BACK: 1 },
      prepares: { FRONT: 2, BACK: 1 },
      registrations: { FRONT: 2, BACK: 1 },
    });
    assert.equal(harness.getIphoneActivationCount(), iphoneActivationBeforeRecapture);
    assert.equal(harness.getPollCount(), iphonePollsBeforeRecapture);
    assert.equal(harness.getPreparedImageRefreshCount("BACK"), backRefreshesBeforeRecapture + 1,
      "Back receives only its first ordinary centering refresh; no sibling refresh occurs during Front rerun");
  } finally {
    await harness.cleanup();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
  }
});

test("Front targeted recapture exposes repeated registration interruption and manual retry preserves Back", async () => {
  let frontGeometryCalls = 0;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:https://collect.tenkings.co/front-targeted-registration-retry",
  });
  const harness = await mountWorkspace({
    activeMap: { revisionId: "map-targeted-retry", scope: "FAMILY", name: "Targeted retry map" },
    proposeGeometry: async (_token, input) => {
      if (input.side === "FRONT") {
        frontGeometryCalls += 1;
        if (frontGeometryCalls === 1) return advisoryGeometryResponse("BLACK", "WHITE");
      }
      const accepted = geometryResponse();
      return {
        ...accepted,
        colorGeometry: { ...accepted.colorGeometry, matColor: input.matColor },
        colorGeometryReceipt: `${input.side.toLowerCase()}-${input.matColor.toLowerCase()}-${frontGeometryCalls}`,
      };
    },
    onRegistrationRequest: (side, sideAttempt) => {
      if (side === "FRONT" && (sideAttempt === 2 || sideAttempt === 3)) {
        throw new TypeError("fetch failed");
      }
    },
  });
  try {
    await prepareBothSidesAndReachFrontCentering(harness);
    await waitFor(
      () => Boolean(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE")),
      "Front targeted recapture action did not render",
    );
    const retainedBackRegistration = structuredClone(harness.getRegistrationResultsForSide("BACK")[0]);
    await act(async () => fire(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE")!, "click"));

    const [frontInput, backInput] = Array.from(harness.container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    assert.ok(frontInput && backInput);
    assert.equal(frontInput.disabled, false);
    assert.equal(backInput.disabled, true);
    Object.defineProperty(frontInput, "files", {
      configurable: true,
      value: [jpegTestFile("front-white-retry.jpg")],
    });
    await act(async () => frontInput.dispatchEvent(new window.Event("change", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(harness.container, "Set Front geometry")), "Replacement Front did not become ready");
    await act(async () => fire(buttonByText(harness.container, "Set Front geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Replacement Front geometry did not open",
    );
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));

    await waitFor(
      () => Boolean(buttonByText(harness.container, "FRONT: Retry failed side")),
      "Repeated target registration interruption did not require an explicit choice",
    );
    assert.match(harness.container.textContent ?? "", /registration is interrupted only on replacement FRONT/i);
    assert.match(harness.container.textContent ?? "", /Back registration remains retained and is not rerun/i);
    assert.equal(harness.getRegistrationCountForSide("FRONT"), 3, "Target gets one initial and one visible automatic retry after its original registration");
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1, "The retained sibling must not be registered again");
    assert.deepEqual(harness.getRegistrationResultsForSide("BACK"), [retainedBackRegistration]);
    assert.equal(harness.bundles.length, 0);
    await waitFor(() => {
      const value = harness.getCaptureDraftSerialized();
      return Boolean(value && JSON.parse(value).recaptureSide === "FRONT");
    }, "Targeted interruption draft was not durably written");
    const interruptedDraft = JSON.parse(harness.getCaptureDraftSerialized()!);
    assert.equal(interruptedDraft.registrationRecordedAtMs.FRONT, undefined,
      "The replaced Front's old successful timestamp must be cleared before its retry succeeds");
    assert.equal(typeof interruptedDraft.registrationRecordedAtMs.BACK, "number",
      "The retained Back registration timestamp must remain exact");
    const geometryEventCountBeforeRetry = harness.events.filter(({ eventType }) => eventType === "GEOMETRY_CONFIRMED").length;

    await act(async () => fire(buttonByText(harness.container, "FRONT: Retry failed side")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')),
      "Successful manual target retry did not resume only Front centering",
    );
    assert.equal(harness.getRegistrationCountForSide("FRONT"), 4);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1);
    await waitFor(() => {
      const value = harness.getCaptureDraftSerialized();
      return Boolean(value && typeof JSON.parse(value).registrationRecordedAtMs.FRONT === "number");
    }, "Successful replacement Front registration timestamp was not durably restamped");
    const geometryAfterRetry = harness.events.filter(({ eventType }) => eventType === "GEOMETRY_CONFIRMED");
    assert.equal(geometryAfterRetry.length, geometryEventCountBeforeRetry + 1);
    assert.deepEqual(geometryAfterRetry.at(-1)?.details, {
      side: "FRONT",
      mapAppliedScope: "FAMILY",
      mapName: "Targeted retry map",
      mapRevisionId: "map-targeted-retry",
    }, "Only the freshly registered Front may be instrumented; retained Back must never be relabeled failed");
    assert.deepEqual(
      harness.getRegistrationOrchestrations().filter(({ side }) => side === "FRONT").map(({ orchestration }) => ({
        attemptNumber: orchestration.attemptNumber,
        trigger: orchestration.trigger,
        successfulSiblingPreservedAtAttemptStart: orchestration.successfulSiblingPreservedAtAttemptStart,
      })),
      [
        { attemptNumber: 1, trigger: "INITIAL", successfulSiblingPreservedAtAttemptStart: false },
        { attemptNumber: 1, trigger: "INITIAL", successfulSiblingPreservedAtAttemptStart: true },
        { attemptNumber: 2, trigger: "AUTOMATIC_RETRY", successfulSiblingPreservedAtAttemptStart: true },
        { attemptNumber: 3, trigger: "MANUAL_RETRY", successfulSiblingPreservedAtAttemptStart: true },
      ],
    );

    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not remain available");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => harness.bundles.length === 1, "Targeted retry flow did not assemble its final bundle");
    assert.deepEqual(harness.bundles[0].back.mapRegistration, retainedBackRegistration);
    assert.equal(harness.bundles[0].front.originalStorageKey, "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/recapture-00000000-0000-4000-8000-000000000007/front.jpg");
  } finally {
    await harness.cleanup();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
  }
});

test("late prepared-image success or failure for an old key cannot replace or poison the recaptured key", async () => {
  for (const staleOutcome of ["SUCCESS", "FAILURE"] as const) {
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => `blob:https://collect.tenkings.co/front-refresh-race-${staleOutcome.toLowerCase()}`,
    });
    const pending: Array<{
      storageKey: string;
      resolve: (response: Response) => void;
    }> = [];
    let frontGeometryCalls = 0;
    const harness = await mountWorkspace({
      activeMap: { revisionId: `map-refresh-race-${staleOutcome.toLowerCase()}`, scope: "FAMILY", name: "Refresh race map" },
      proposeGeometry: async (_token, input) => {
        if (input.side === "FRONT") {
          frontGeometryCalls += 1;
          if (frontGeometryCalls === 1) return advisoryGeometryResponse("BLACK", "WHITE");
        }
        return geometryResponse();
      },
      preparedImageFetch: async ({ side, storageKey }) => {
        if (side === "BACK") return jsonResponse({ side, imageUrl: "https://read.example.test/back-race.webp" });
        return new Promise<Response>((resolve) => pending.push({ storageKey, resolve }));
      },
    });
    try {
      await prepareBothSidesAndReachFrontCentering(harness);
      await waitFor(() => pending.length === 1, "Old Front prepared-key refresh did not start");
      const oldKey = pending[0].storageKey;
      await act(async () => fire(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE")!, "click"));
      const frontInput = harness.container.querySelector<HTMLInputElement>('input[type="file"]:not([disabled])');
      assert.ok(frontInput);
      Object.defineProperty(frontInput, "files", {
        configurable: true,
        value: [jpegTestFile("front-refresh-race.jpg")],
      });
      await act(async () => frontInput.dispatchEvent(new window.Event("change", { bubbles: true })));
      await act(async () => fire(buttonByText(harness.container, "Set Front geometry")!, "click"));
      await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Replacement Front geometry did not open");
      await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
      await waitFor(() => pending.length === 2, "Replacement Front prepared-key refresh did not start");
      const newKey = pending[1].storageKey;
      assert.notEqual(newKey, oldKey);
      assert.match(newKey, /\/recapture-00000000-0000-4000-8000-000000000007\/rectified\.webp$/);

      await act(async () => pending[1].resolve(jsonResponse({
        side: "FRONT",
        imageUrl: "https://read.example.test/front-current-key.webp",
      })));
      await waitFor(() => harness.container.querySelector<HTMLImageElement>('img[alt="front rectified trading card"]')?.src
        === "https://read.example.test/front-current-key.webp", "Current Front key did not install");

      await act(async () => pending[0].resolve(staleOutcome === "SUCCESS"
        ? jsonResponse({ side: "FRONT", imageUrl: "https://read.example.test/front-stale-key.webp" })
        : jsonResponse({ message: "Old prepared key failed after recapture." }, 503)));
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(
        harness.container.querySelector<HTMLImageElement>('img[alt="front rectified trading card"]')?.src,
        "https://read.example.test/front-current-key.webp",
      );
      assert.doesNotMatch(harness.container.textContent ?? "", /Old prepared key failed|anchor corrections are preserved/i);
    } finally {
      await harness.cleanup();
      if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      else Reflect.deleteProperty(URL, "createObjectURL");
    }
  }
});

test("targeted recapture remains available with no map and a loaded-map failure requires explicit human review", async () => {
  const noMap = await mountWorkspace({
    proposeGeometry: async (_token, input) => input.side === "FRONT"
      ? advisoryGeometryResponse("BLACK", "WHITE")
      : geometryResponse(),
  });
  try {
    await prepareBothSidesAndReachFrontCentering(noMap);
    await waitFor(() => Boolean(buttonByText(noMap.container, "Change Front mat / recapture Front — WHITE")),
      "No-map target recapture should remain explicitly available");
    await act(async () => fire(buttonByText(noMap.container, "Change Front mat / recapture Front — WHITE")!, "click"));
    assert.ok(buttonByText(noMap.container, "Add replacement Front photo to continue"));
    assert.match(noMap.container.textContent ?? "", /completed sibling side is retained/i);
  } finally {
    await noMap.cleanup();
  }

  const abandoned = await mountWorkspace({
    activeMap: { revisionId: "map-explicitly-abandoned", scope: "FAMILY", name: "Abandoned map" },
    registrationFailsOnSide: "BACK",
    proposeGeometry: async (_token, input) => input.side === "FRONT"
      ? advisoryGeometryResponse("BLACK", "WHITE")
      : geometryResponse(),
  });
  try {
    await act(async () => fire(buttonByText(abandoned.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(abandoned.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await placeManualGeometryIfNeeded(abandoned.container);
    await act(async () => fire(buttonByText(abandoned.container, "Continue")!, "click"));
    await waitFor(() => Boolean(abandoned.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(abandoned.container, "Continue")!, "click"));
    await waitFor(
      () => Boolean(abandoned.container.querySelector('[aria-label="Card Map registration interruption"]')),
      "Loaded-map registration blocker did not render",
    );
    assert.ok(buttonByText(abandoned.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW"));
    assert.equal(abandoned.container.querySelector('[aria-label="front centering geometry"]'), null);
    assert.equal(buttonByText(abandoned.container, "Change Front mat / recapture Front — WHITE"), undefined);
    assert.match(abandoned.container.textContent ?? "", /explicitly continue through human review/i);
    assert.equal(abandoned.getOriginalUploadPlanCount("FRONT"), 0);
    assert.equal(abandoned.getOriginalUploadPlanCount("BACK"), 0);
  } finally {
    await abandoned.cleanup();
  }
});

test("Front and Back crashes after replacement PUT preserve the last complete draft without overwriting evidence", async () => {
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:https://collect.tenkings.co/crash-after-put",
  });
  try {
    for (const target of ["FRONT", "BACK"] as const) {
      let targetGeometryCalls = 0;
      let replacementGeometryStarted = false;
      const map = { revisionId: `map-put-crash-${target.toLowerCase()}`, scope: "FAMILY" as const, name: `${target} PUT crash map` };
      const seed = await mountWorkspace({
        activeMap: map,
        proposeGeometry: async (_token, input) => {
          if (input.side !== target) return geometryResponse();
          targetGeometryCalls += 1;
          if (targetGeometryCalls === 1) return advisoryGeometryResponse(
            target === "FRONT" ? "BLACK" : "WHITE",
            target === "FRONT" ? "WHITE" : "MAGENTA",
          );
          replacementGeometryStarted = true;
          return new Promise<GeometryResponse>(() => {});
        },
      });
      let preservedBeforeRecapture: string;
      try {
        await prepareBothSidesAndReachFrontCentering(seed);
        if (target === "BACK") {
          await loadPreparedImage(seed.container, "front rectified trading card");
          await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
          await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
        }
        await waitFor(() => {
          const serialized = seed.getCaptureDraftSerialized();
          return Boolean(serialized && JSON.parse(serialized).stage === `${target}_CENTERING`);
        }, `Last complete ${target} draft was not written`);
        preservedBeforeRecapture = seed.getCaptureDraftSerialized()!;
        const change = buttonByText(seed.container, target === "FRONT"
          ? "Change Front mat / recapture Front — WHITE"
          : "Change Back mat / recapture Back — MAGENTA");
        assert.ok(change);
        await act(async () => fire(change, "click"));
        const unlocked = seed.container.querySelector<HTMLInputElement>('input[type="file"]:not([disabled])');
        assert.ok(unlocked);
        Object.defineProperty(unlocked, "files", {
          configurable: true,
          value: [jpegTestFile(`${target.toLowerCase()}-put-crash.jpg`)],
        });
        await act(async () => unlocked.dispatchEvent(new window.Event("change", { bubbles: true })));
        await act(async () => fire(buttonByText(seed.container, `Set ${target === "FRONT" ? "Front" : "Back"} geometry`)!, "click"));
        await waitFor(() => replacementGeometryStarted, `${target} replacement geometry did not start after its successful upload PUT`);
        assert.equal(seed.getOriginalUploadPlanCount(target), 1);
        assert.equal(seed.getCaptureDraftSerialized(), preservedBeforeRecapture,
          "A crash after PUT must leave the last complete draft byte-for-byte intact; the versioned replacement object is not silently adopted");
      } finally {
        await seed.cleanup();
      }

      const resumed = await mountWorkspace({
        activeMap: map,
        captureDraftSerialized: preservedBeforeRecapture!,
        proposeGeometry: async () => geometryResponse(),
      });
      try {
        assert.ok(resumed.container.querySelector('[aria-label="Preserved capture draft"]'));
        assert.doesNotMatch(resumed.getCaptureDraftSerialized()!, /recapture-00000000-0000-4000-8000-000000000007/);
        await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
        await waitFor(() => Boolean(resumed.container.querySelector(`[aria-label="${target.toLowerCase()} centering geometry"]`)),
          `${target} last complete draft did not resume after a crash boundary`);
        assert.equal(resumed.getOriginalUploadPlanCount("FRONT") + resumed.getOriginalUploadPlanCount("BACK"), 0);
        assert.equal(resumed.getPrepareCount("FRONT") + resumed.getPrepareCount("BACK"), 0);
      } finally {
        await resumed.cleanup();
      }
    }
  } finally {
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
  }
});

test("Front and Back replacement registration interruptions reload with exact target and retained sibling authority", async () => {
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:https://collect.tenkings.co/crash-after-registration",
  });
  try {
    for (const target of ["FRONT", "BACK"] as const) {
      let targetGeometryCalls = 0;
      const map = { revisionId: `map-registration-crash-${target.toLowerCase()}`, scope: "FAMILY" as const, name: `${target} registration crash map` };
      const seed = await mountWorkspace({
        activeMap: map,
        proposeGeometry: async (_token, input) => {
          if (input.side === target) {
            targetGeometryCalls += 1;
            if (targetGeometryCalls === 1) return advisoryGeometryResponse(
              target === "FRONT" ? "BLACK" : "WHITE",
              target === "FRONT" ? "WHITE" : "MAGENTA",
            );
          }
          return geometryResponse();
        },
        onRegistrationRequest: (side, sideAttempt) => {
          if (side === target && (sideAttempt === 2 || sideAttempt === 3)) throw new TypeError("fetch failed");
        },
      });
      let interruptedSerialized: string;
      try {
        await prepareBothSidesAndReachFrontCentering(seed);
        if (target === "BACK") {
          await loadPreparedImage(seed.container, "front rectified trading card");
          await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
          await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
        }
        const change = buttonByText(seed.container, target === "FRONT"
          ? "Change Front mat / recapture Front — WHITE"
          : "Change Back mat / recapture Back — MAGENTA");
        assert.ok(change);
        await act(async () => fire(change, "click"));
        const unlocked = seed.container.querySelector<HTMLInputElement>('input[type="file"]:not([disabled])');
        assert.ok(unlocked);
        Object.defineProperty(unlocked, "files", {
          configurable: true,
          value: [jpegTestFile(`${target.toLowerCase()}-registration-crash.jpg`)],
        });
        await act(async () => unlocked.dispatchEvent(new window.Event("change", { bubbles: true })));
        await act(async () => fire(buttonByText(seed.container, `Set ${target === "FRONT" ? "Front" : "Back"} geometry`)!, "click"));
        await waitFor(() => Boolean(seed.container.querySelector(`[aria-label="${target.toLowerCase()} card geometry"]`)), "Replacement geometry did not open");
        await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
        await waitFor(() => Boolean(buttonByText(seed.container, `${target}: Retry failed side`)), "Target interruption did not become explicit");
        await waitFor(() => {
          const serialized = seed.getCaptureDraftSerialized();
          return Boolean(serialized && JSON.parse(serialized).recaptureSide === target);
        }, "Exact targeted recovery draft was not written");
        interruptedSerialized = seed.getCaptureDraftSerialized()!;
        const interrupted = JSON.parse(interruptedSerialized);
        assert.match(interrupted[target.toLowerCase()].originalStorageKey, new RegExp(`/recapture-00000000-0000-4000-8000-000000000007/${target.toLowerCase()}\\.jpg$`));
        assert.equal(interrupted.registrationRecordedAtMs[target], undefined);
        const sibling = target === "FRONT" ? "BACK" : "FRONT";
        assert.equal(typeof interrupted.registrationRecordedAtMs[sibling], "number");
      } finally {
        await seed.cleanup();
      }

      const resumed = await mountWorkspace({
        activeMap: map,
        captureDraftSerialized: interruptedSerialized!,
        proposeGeometry: async () => geometryResponse(),
      });
      try {
        await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
        await waitFor(() => Boolean(buttonByText(resumed.container, `${target}: Retry failed side`)),
          `${target} targeted interruption did not survive reload`);
        assert.equal(resumed.getRegistrationCount(), 0, "Reload must not silently retry either side");
        assert.equal(resumed.getOriginalUploadPlanCount("FRONT") + resumed.getOriginalUploadPlanCount("BACK"), 0);
        await act(async () => fire(buttonByText(resumed.container, `${target}: Retry failed side`)!, "click"));
        await waitFor(() => Boolean(resumed.container.querySelector(`[aria-label="${target.toLowerCase()} centering geometry"]`)),
          `${target} explicit retry did not return to exact target centering`);
        assert.equal(resumed.getRegistrationCountForSide(target), 1);
        assert.equal(resumed.getRegistrationCountForSide(target === "FRONT" ? "BACK" : "FRONT"), 0);
        assert.deepEqual(
          resumed.events.filter(({ eventType }) => eventType === "GEOMETRY_CONFIRMED").map(({ details }) => details?.side),
          [target],
          "Only freshly touched registration sides may be instrumented after reload",
        );
      } finally {
        await resumed.cleanup();
      }
    }
  } finally {
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else Reflect.deleteProperty(URL, "createObjectURL");
  }
});

test("in-flight prepare exposes no mat-reset action and a stale response cannot cross a session reset", async () => {
  let resolvePrepare: ((response: Response) => void) | undefined;
  let prepareSignal: AbortSignal | null | undefined;
  const harness = await mountWorkspace({
    activeMap: { revisionId: "map-must-not-register", scope: "FAMILY", name: "No stale prepare" },
    proposeGeometry: async (_token, input) => input.side === "FRONT"
      ? advisoryGeometryResponse("BLACK", "WHITE")
      : geometryResponse(),
    prepareFetch: async (input) => {
      prepareSignal = input.signal;
      return new Promise<Response>((resolve) => { resolvePrepare = resolve; });
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')),
      "Front geometry did not render",
    );
    assert.equal(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE"), undefined,
      "Mat recapture is offered only after both sides are prepared and registered");
    assert.match(harness.container.textContent ?? "", /One-side mat recapture unlocks after both sides are prepared and registered/i);
    await placeManualGeometryIfNeeded(harness.container);
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(resolvePrepare), "Front prepare request did not start");
    assert.equal(buttonByText(harness.container, "Change Front mat / recapture Front — WHITE"), undefined,
      "Mat reset must not race an active prepare request");

    await harness.rerenderSession("speedster-session-after-prepare-reset");
    assert.equal(prepareSignal?.aborted, true, "Session reset must abort the exact prepare transport");
    await act(async () => {
      resolvePrepare?.(preparedResponse("BLACK"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    assert.ok(buttonByText(harness.container, "Set geometry"), "Replacement draft must remain at fresh Photos");
    assert.equal(harness.container.querySelector('[aria-label="back card geometry"]'), null);
    assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null);
    assert.equal(harness.getRegistrationCount(), 0);
    assert.equal(harness.bundles.length, 0, "Late prepare authority must not enter the replacement capture");
  } finally {
    await harness.cleanup();
  }
});

test("Back targeted mat recapture preserves the complete Front side through the final bundle", async () => {
  const geometryInputs: Array<Parameters<typeof speedsterImageService.proposeGeometry>[1]> = [];
  let frontGeometryCalls = 0;
  let backGeometryCalls = 0;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:https://collect.tenkings.co/back-magenta-recapture",
  });
  const harness = await mountWorkspace({
    activeMap: { revisionId: "map-must-not-register", scope: "FAMILY", name: "No premature map" },
    proposeGeometry: async (_token, input) => {
      geometryInputs.push(input);
      if (input.side === "BACK") {
        backGeometryCalls += 1;
        if (backGeometryCalls === 1) return advisoryGeometryResponse("WHITE", "MAGENTA");
      } else {
        frontGeometryCalls += 1;
      }
      const accepted = geometryResponse();
      return {
        ...accepted,
        colorGeometry: { ...accepted.colorGeometry, matColor: input.matColor },
        colorGeometryReceipt: `${input.side.toLowerCase()}-${input.matColor.toLowerCase()}-attempt-${input.side === "FRONT" ? frontGeometryCalls : backGeometryCalls}`,
      };
    },
  });
  try {
    await prepareBothSidesAndReachFrontCentering(harness);
    await waitFor(() => harness.getPreparedImageRefreshCount("FRONT") >= 1, "Front prepared image did not refresh");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(
      () => Boolean(buttonByText(harness.container, "Change Back mat / recapture Back — MAGENTA")),
      "Back change-mat action did not render",
    );
    await waitFor(() => harness.getPreparedImageRefreshCount("BACK") >= 1, "Back prepared image did not refresh");
    await loadPreparedImage(harness.container, "back rectified trading card");
    const retainedFrontRegistration = structuredClone(harness.getRegistrationResultsForSide("FRONT")[0]);
    const iphoneActivationBeforeRecapture = harness.getIphoneActivationCount();
    const iphonePollsBeforeRecapture = harness.getPollCount();
    const frontRefreshesBeforeRecapture = harness.getPreparedImageRefreshCount("FRONT");
    await act(async () => fire(buttonByText(harness.container, "Change Back mat / recapture Back — MAGENTA")!, "click"));

    assert.ok(harness.container.querySelector('img[alt="front card preview"]'), "The completed Front original must remain visible");
    assert.equal(harness.container.querySelector('img[alt="back card preview"]'), null);
    assert.equal(
      harness.container.querySelector<HTMLInputElement>('input[name="front-mat-color"][value="BLACK"]')?.checked,
      true,
      "The non-advised mat selection must remain unchanged",
    );
    assert.equal(
      harness.container.querySelector<HTMLInputElement>('input[name="back-mat-color"][value="MAGENTA"]')?.checked,
      true,
    );
    const [frontInput, backInput] = Array.from(harness.container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    assert.ok(frontInput && backInput);
    assert.equal(frontInput.disabled, true, "The retained Front original cannot be replaced during a Back-only rerun");
    assert.equal(backInput.disabled, false);
    assert.equal(buttonByText(harness.container, "Add replacement Back photo to continue")?.disabled, true);
    assert.match(harness.container.textContent ?? "", /completed sibling side is retained/i);
    assert.match(harness.container.textContent ?? "", /Targeted mat recapture uses only the unlocked local file slot/i);
    assert.equal(harness.container.querySelector('[aria-label="Pair iPhone QR code"]'), null);
    assert.equal(harness.getRegistrationCountForSide("FRONT"), 1);
    assert.equal(harness.getRegistrationCountForSide("BACK"), 1);
    assert.equal(harness.bundles.length, 0);

    Object.defineProperty(backInput, "files", {
      configurable: true,
      value: [jpegTestFile("back-magenta.jpg")],
    });
    await act(async () => backInput.dispatchEvent(new window.Event("change", { bubbles: true })));
    await waitFor(() => Boolean(buttonByText(harness.container, "Set Back geometry")), "Fresh Back did not restore readiness");
    await act(async () => fire(buttonByText(harness.container, "Set Back geometry")!, "click"));
    await waitFor(
      () => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')),
      "Replacement Back did not rerun physical geometry",
    );
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Only Back centering did not reopen");
    assert.equal(harness.container.querySelector('[aria-label="front card geometry"]'), null, "The retained Front geometry must not reopen");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => harness.bundles.length === 1, "Back-recaptured pair was not assembled");

    assert.deepEqual(
      geometryInputs.map(({ side, sourceImageStorageKey, matColor }) => ({ side, sourceImageStorageKey, matColor })),
      [
        { side: "FRONT", sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/front.jpg", matColor: "BLACK" },
        { side: "BACK", sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/back.jpg", matColor: "WHITE" },
        { side: "BACK", sourceImageStorageKey: "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/recapture-00000000-0000-4000-8000-000000000007/back.jpg", matColor: "MAGENTA" },
      ],
    );
    assert.equal(harness.bundles[0].front.originalStorageKey, "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/iphone-v1/front.jpg");
    assert.equal(harness.bundles[0].back.originalStorageKey, "ai-grader-v2/admin-1/speedster-session-lifecycle-test/original/recapture-00000000-0000-4000-8000-000000000007/back.jpg");
    assert.equal(harness.bundles[0].front.colorGeometryEvidence![0].serverReceipt, "front-black-attempt-1");
    assert.equal(harness.bundles[0].front.colorGeometryEvidence![1].serverReceipt, "test-printed-black-receipt");
    assert.equal(harness.bundles[0].back.colorGeometryEvidence![0].serverReceipt, "back-magenta-attempt-2");
    assert.equal(harness.bundles[0].back.colorGeometryEvidence![1].serverReceipt, "test-printed-magenta-receipt");
    assert.deepEqual(harness.bundles[0].front.mapRegistration, retainedFrontRegistration);
    assert.deepEqual(harness.bundles[0].front.centeringQuad, validQuad,
      "The confirmed Front centering must remain byte-for-byte unchanged");
    assert.deepEqual({
      originalUploadPlans: {
        FRONT: harness.getOriginalUploadPlanCount("FRONT"),
        BACK: harness.getOriginalUploadPlanCount("BACK"),
      },
      preparedUploadPlans: {
        FRONT: harness.getPreparedUploadPlanCount("FRONT"),
        BACK: harness.getPreparedUploadPlanCount("BACK"),
      },
      prepares: {
        FRONT: harness.getPrepareCount("FRONT"),
        BACK: harness.getPrepareCount("BACK"),
      },
      registrations: {
        FRONT: harness.getRegistrationCountForSide("FRONT"),
        BACK: harness.getRegistrationCountForSide("BACK"),
      },
    }, {
      originalUploadPlans: { FRONT: 0, BACK: 1 },
      preparedUploadPlans: { FRONT: 1, BACK: 2 },
      prepares: { FRONT: 1, BACK: 2 },
      registrations: { FRONT: 1, BACK: 2 },
    });
    assert.equal(harness.getPreparedImageRefreshCount("FRONT"), frontRefreshesBeforeRecapture,
      "Targeted Back rerun must not call the retained Front prepared-image API");
    assert.equal(harness.getIphoneActivationCount(), iphoneActivationBeforeRecapture);
    assert.equal(harness.getPollCount(), iphonePollsBeforeRecapture);
  } finally {
    await harness.cleanup();
    if (createObjectUrlDescriptor) {
      Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
  }
});

test("image load failure stays visible, blocks confirmation, and offers exact-source recovery", async () => {
  const originalConsoleInfo = console.info;
  const diagnostics: string[] = [];
  console.info = (line) => diagnostics.push(String(line));
  const harness = await mountWorkspace({
    geometryImagesStartVisible: false,
    proposeGeometry: async () => geometryResponse(),
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
    assert.match(alert?.textContent ?? "", /confirmation remains blocked until the exact source is visible/);
    assert.ok(harness.container.querySelector('[aria-label="front card geometry"]'));
    assert.ok(harness.container.querySelector('[aria-label="Adjustable card corner geometry"]'));
    assert.equal(buttonByText(harness.container, "Source image unavailable")?.disabled, true);
    assert.equal(buttonByText(harness.container, "Refresh exact source image")?.disabled, false);
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
      return geometryResponse();
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
      return geometryResponse();
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
    proposeGeometry: async () => geometryResponse(),
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

test("Front success plus Back failure preserves truth and offers only explicit human-review continuation", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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
    assert.ok(buttonByText(harness.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW"));
    assert.match(harness.container.textContent ?? "", /explicitly continue through human review/i);
    assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null, "Registration failure must not silently advance");
    assert.equal(harness.getRegistrationCount(), 2);
    assert.equal(harness.events.filter((candidate) => candidate.eventType === "GEOMETRY_CONFIRMED").length, 0);
    assert.equal(harness.bundles.length, 0);
    assert.equal(
      harness.events.filter((candidate) => candidate.eventType === "MAP_REGISTRATION_OPERATOR_DECISION").length,
      0,
    );
  } finally {
    await harness.cleanup();
  }
});

test("explicit human-review continuation preserves the map failure, removes map geometry, and resumes after reload", async () => {
  const activeMap = { revisionId: "exact-revision-human-review", scope: "EXACT" as const, name: "Snorlax #TG10" };
  const first = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    registrationFailsOnSide: "BACK",
  });
  let serialized: string;
  try {
    await reachInterruptedRegistration(first);
    await act(async () => fire(buttonByText(first.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="front centering geometry"]')),
      "Durably recorded human review did not advance to Front centering");
    assert.match(first.container.textContent ?? "", /Card Map failure retained · no map or projected zones applied/i);
    assert.equal(first.events.filter(({ eventType }) => eventType === "MAP_AUTHORITY_OPERATOR_DECISION").length, 1);
    serialized = first.getCaptureDraftSerialized()!;
    const stored = JSON.parse(serialized);
    assert.equal(stored.mapBindingStatus, "LOADED", "the mounted page retains its original server binding until reload");
    assert.equal(stored.mapAuthorityAbandoned, true);
    assert.deepEqual(stored.registrationFailureSides, { BACK: true });
    assert.deepEqual(stored.provisional, {});
    assert.equal(stored.front.mapRegistration, undefined);
    assert.equal(stored.back.mapRegistration, undefined);
  } finally {
    await first.cleanup();
  }

  const resumed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    mapBindingStatus: "HUMAN_REVIEW_WITHOUT_MAP",
    captureDraftSerialized: serialized,
  });
  try {
    assert.ok(buttonByText(resumed.container, "Resume preserved draft"));
    const rebound = JSON.parse(resumed.getCaptureDraftSerialized()!);
    assert.equal(rebound.mapBindingStatus, "HUMAN_REVIEW_WITHOUT_MAP");
    assert.equal(rebound.activeMapRevisionId, null);
    assert.equal(rebound.activeMapScope, null);
    assert.equal(rebound.mapAuthorityAbandoned, true);
    assert.deepEqual(rebound.registrationFailureSides, { BACK: true });
    await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="front centering geometry"]')),
      "Human-review draft did not resume its preserved centering work");
    assert.equal(resumed.getRegistrationCount(), 0);
  } finally {
    await resumed.cleanup();
  }
});

test("two unresolved sides disclose complete evidence, retries, and separate human review", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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
    assert.match(text, /explicitly continue through human review/i);
    assert.ok(buttonByText(harness.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW"));
    assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null);
    assert.equal(harness.events.some((event) => event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION"), false);
  } finally {
    await harness.cleanup();
  }
});

test("infrastructure retry preserves the other side's valid 422 diagnostics", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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

test("reload offers explicit Resume, refreshes URLs, preserves Front success, and clears only after successful save", async () => {
  const first = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-resume", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationHttpFailure: {
      side: "BACK",
      status: 402,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      retryable: false,
      message: "CARD MAP provider rejected the request (HTTP 402). No map was applied.",
    },
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(first.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(first.container, "Continue")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(first.container, "Continue")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="Card Map registration interruption"]')), "Interruption did not render");
    await waitFor(() => Boolean(first.getCaptureDraftSerialized()), "Interrupted registration draft was not preserved");
    serialized = first.getCaptureDraftSerialized()!;
    assert.doesNotMatch(serialized, /https:\/\/|admin-token|readUrl|data:image/);
  } finally {
    await first.cleanup();
  }

  const resumed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-resume", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    captureDraftSerialized: serialized,
  });
  try {
    assert.equal(resumed.getPollCount(), 0, "Reload must not begin a new photo flow before explicit choice");
    assert.equal(resumed.getRegistrationCount(), 0, "Reload must not silently re-register either side");
    assert.ok(buttonByText(resumed.container, "Resume preserved draft"));
    assert.ok(buttonByText(resumed.container, "Discard preserved draft"));

    await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="Card Map registration interruption"]')), "Resumed interruption did not render");
    assert.ok(resumed.getPreparedImageRefreshCount("FRONT") >= 1);
    assert.ok(resumed.getPreparedImageRefreshCount("BACK") >= 1);
    assert.equal(resumed.getRegistrationCount(), 0, "Resume must preserve both recorded attempts without retrying");
    assert.match(resumed.container.textContent ?? "", /provider rejected the request \(HTTP 402\)/);

    await act(async () => fire(buttonByText(resumed.container, "Retry failed side")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="front centering geometry"]')), "Back-only retry did not advance to retained-map centering");
    assert.equal(resumed.getRegistrationCountForSide("FRONT"), 0, "Successful Front registration must never be rerun");
    assert.equal(resumed.getRegistrationCountForSide("BACK"), 1, "Only the explicitly selected failed side may retry");
    assert.match(resumed.container.textContent ?? "", /FAMILY · 2023 MEW EN Reverse Holo applied to Front \+ Back/);

    await loadPreparedImage(resumed.container, "front rectified trading card");
    await act(async () => fire(buttonByText(resumed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open after resume");
    await loadPreparedImage(resumed.container, "back rectified trading card");
    await act(async () => fire(buttonByText(resumed.container, "Continue")!, "click"));
    assert.equal(resumed.bundles.length, 1);
    assert.equal(resumed.getCaptureDraftSerialized(), null, "Successful capture persistence must clear the obsolete browser draft");
  } finally {
    await resumed.cleanup();
  }
});

test("legacy v1 draft recovery preserves all prior work and upgrades only after four receipts succeed", async () => {
  const activeMap = { revisionId: "family-revision-legacy-color", scope: "FAMILY" as const, name: "2023 MEW EN Reverse Holo" };
  const seed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    registrationHttpFailure: {
      side: "BACK",
      status: 402,
      count: 1,
      source: "PROVIDER",
      code: "PROVIDER_HTTP_402",
      retryable: false,
      message: "CARD MAP provider rejected the request (HTTP 402). No map was applied.",
    },
  });
  let legacySerialized: string;
  let preservedRegistration: string;
  try {
    await act(async () => fire(buttonByText(seed.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.getCaptureDraftSerialized()), "Seed capture draft was not preserved");
    const legacy = JSON.parse(seed.getCaptureDraftSerialized()!) as Record<string, any>;
    legacy.version = "speedster-capture-registration-draft-v1";
    for (const side of [legacy.front, legacy.back]) {
      delete side.matColor;
      delete side.physicalColorGeometry;
      delete side.physicalColorGeometryReceipt;
      delete side.printedColorGeometry;
      delete side.printedColorGeometryReceipt;
    }
    preservedRegistration = JSON.stringify(legacy.front.mapRegistration);
    legacySerialized = JSON.stringify(legacy);
  } finally {
    await seed.cleanup();
  }

  const failedRecovery = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    captureDraftSerialized: legacySerialized,
    colorRecoveryFailure: { side: "FRONT", mode: "PRINTED_FRAME" },
  });
  try {
    await act(async () => fire(buttonByText(failedRecovery.container, "Recover Color evidence and reconfirm all four preserved quads")!, "click"));
    await waitFor(() => /original v1 draft.*remain unchanged/i.test(failedRecovery.container.textContent ?? ""), "Partial legacy recovery failure was not explicit");
    assert.equal(failedRecovery.getCaptureDraftSerialized(), legacySerialized, "partial recovery must not upgrade or rewrite the v1 draft");
    assert.equal(buttonByText(failedRecovery.container, "Resume preserved draft"), undefined);
  } finally {
    await failedRecovery.cleanup();
  }

  const recovered = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    captureDraftSerialized: legacySerialized,
  });
  try {
    assert.equal(buttonByText(recovered.container, "Resume preserved draft"), undefined, "v1 cannot silently resume without Color receipts");
    const recoverButton = buttonByText(recovered.container, "Recover Color evidence and reconfirm all four preserved quads") as HTMLButtonElement | undefined;
    assert.equal(recoverButton?.disabled, false, "diagnostic mat labels must not block evidence recovery");
    await act(async () => recoverButton.click());
    await waitFor(() => Boolean(buttonByText(recovered.container, "Resume preserved draft")), "Atomic v2 upgrade did not expose Resume");
    assert.deepEqual(recovered.getColorRecoveryRequests().map(({ side, mode, matColor }) => ({ side, mode, matColor })), [
      { side: "FRONT", mode: "PHYSICAL_OUTER", matColor: "BLACK" },
      { side: "FRONT", mode: "PRINTED_FRAME", matColor: "BLACK" },
      { side: "BACK", mode: "PHYSICAL_OUTER", matColor: "WHITE" },
      { side: "BACK", mode: "PRINTED_FRAME", matColor: "WHITE" },
    ]);
    assert.equal(recovered.getPrepareCount("FRONT") + recovered.getPrepareCount("BACK"), 0, "legacy Color recovery must not rewrite prepared artifacts");
    assert.equal(recovered.getRegistrationCount(), 0, "legacy Color recovery must not alter registration authority");
    const upgraded = JSON.parse(recovered.getCaptureDraftSerialized()!) as Record<string, any>;
    assert.equal(upgraded.version, "speedster-capture-registration-draft-v2");
    assert.equal(JSON.stringify(upgraded.front.mapRegistration), preservedRegistration);
    assert.deepEqual(upgraded.front.corners, JSON.parse(legacySerialized).front.corners);
    assert.deepEqual(upgraded.back.proposedCentering, JSON.parse(legacySerialized).back.proposedCentering);

    await act(async () => fire(buttonByText(recovered.container, "Resume preserved draft")!, "click"));
    await waitFor(() => Boolean(recovered.container.querySelector('[aria-label="Card Map registration interruption"]')), "Recovered draft did not resume its exact prior stage");
    assert.match(recovered.container.textContent ?? "", /provider rejected the request \(HTTP 402\)/);
  } finally {
    await recovered.cleanup();
  }
});

test("mounted expiry invalidates only the old side and preserves the fresh sibling receipt", async () => {
  const activeMap = { revisionId: "family-revision-mixed-age", scope: "FAMILY" as const, name: "2023 MEW EN Reverse Holo" };
  const seed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(seed.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front centering geometry"]')), "Front centering did not open");
    await waitFor(() => Boolean(seed.getCaptureDraftSerialized()), "Successful map registration draft was not stored");
    const stored = JSON.parse(seed.getCaptureDraftSerialized()!);
    const now = Date.now();
    stored.updatedAtMs = now;
    stored.registrationRecordedAtMs.FRONT = now - (24 * 60 * 60 * 1000) - 1;
    stored.registrationRecordedAtMs.BACK = now;
    serialized = JSON.stringify(stored);
  } finally {
    await seed.cleanup();
  }

  const resumed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    captureDraftSerialized: serialized,
  });
  try {
    await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="Card Map registration interruption"]')), "Expired-side interruption did not render");
    assert.match(resumed.container.textContent ?? "", /front registration receipt is older than 24 hours/i);
    assert.equal(resumed.getRegistrationCount(), 0);
    await act(async () => fire(buttonByText(resumed.container, "Retry failed side")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="front centering geometry"]')), "Front-only receipt retry did not restore the map");
    assert.equal(resumed.getRegistrationCountForSide("FRONT"), 1);
    assert.equal(resumed.getRegistrationCountForSide("BACK"), 0, "Fresh Back receipt must not be rerun");
  } finally {
    await resumed.cleanup();
  }
});

test("a matched loaded-map draft with abandoned authority cannot resume mapless", async () => {
  const activeMap = { revisionId: "family-revision-abandoned", scope: "FAMILY" as const, name: "2023 MEW EN Reverse Holo" };
  const seed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
  });
  let abandonedSerialized: string;
  try {
    await act(async () => fire(buttonByText(seed.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front centering geometry"]')), "Front centering did not open");
    await waitFor(() => Boolean(seed.getCaptureDraftSerialized()), "Loaded-map draft was not preserved");
    const abandoned = JSON.parse(seed.getCaptureDraftSerialized()!) as Record<string, any>;
    delete abandoned.front.mapRegistration;
    delete abandoned.back.mapRegistration;
    abandoned.provisional = {};
    abandoned.registrationRecordedAtMs = {};
    abandoned.registrationFailureSides = {};
    abandoned.mapRegistrationFailed = false;
    abandoned.mapAuthorityAbandoned = true;
    abandonedSerialized = JSON.stringify(abandoned);
  } finally {
    await seed.cleanup();
  }

  const resumed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    captureDraftSerialized: abandonedSerialized,
  });
  try {
    assert.ok(buttonByText(resumed.container, "Discard invalid preserved draft"));
    assert.equal(buttonByText(resumed.container, "Resume preserved draft"), undefined);
    assert.equal(resumed.container.querySelector('[aria-label="front centering geometry"]'), null);
    assert.equal(resumed.getPollCount(), 0);
    assert.equal(resumed.getRegistrationCount(), 0);
    assert.equal(resumed.getCaptureDraftSerialized(), abandonedSerialized, "Rejected legacy bytes must remain unchanged until explicit discard");
  } finally {
    await resumed.cleanup();
  }
});

test("Card Maps new-source centering persists and resumes with an explicit NO_MAP binding", async () => {
  const first = await mountWorkspace({
    draftSurface: "CARD_MAPS",
    proposeGeometry: async () => geometryResponse(),
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(first.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(first.container, "Continue")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(first.container, "Continue")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="front centering geometry"]')), "No-map Front centering did not open");
    await waitFor(() => Boolean(first.getCaptureDraftSerialized()), "No-map Card Maps draft was not preserved");
    serialized = first.getCaptureDraftSerialized()!;
    const stored = JSON.parse(serialized);
    assert.equal(stored.surface, "CARD_MAPS");
    assert.equal(stored.mapBindingStatus, "NO_MAP");
    assert.equal(stored.activeMapRevisionId, null);
    assert.equal(stored.activeMapScope, null);
  } finally {
    await first.cleanup();
  }

  const resumed = await mountWorkspace({
    draftSurface: "CARD_MAPS",
    proposeGeometry: async () => geometryResponse(),
    captureDraftSerialized: serialized,
  });
  try {
    assert.equal(resumed.getPollCount(), 0);
    assert.ok(buttonByText(resumed.container, "Resume preserved draft"));
    assert.match(resumed.container.textContent ?? "", /No applicable Card Map · manual geometry/);
    assert.doesNotMatch(resumed.container.textContent ?? "", /for null/);
    await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="front centering geometry"]')), "NO_MAP Card Maps draft did not resume to centering");
    assert.equal(resumed.getRegistrationCount(), 0);
  } finally {
    await resumed.cleanup();
  }
});

test("explicit Discard removes only the current preserved draft and starts no work before selection", async () => {
  const seedSource = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-discard", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    registrationFailsOnSide: "BACK",
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(seedSource.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(seedSource.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(seedSource.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seedSource.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(seedSource.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seedSource.getCaptureDraftSerialized()), "Draft seed was not written");
    serialized = seedSource.getCaptureDraftSerialized()!;
  } finally {
    await seedSource.cleanup();
  }

  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-discard", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    captureDraftSerialized: serialized,
  });
  try {
    assert.equal(harness.getPollCount(), 0);
    assert.equal(harness.getRegistrationCount(), 0);
    await act(async () => fire(buttonByText(harness.container, "Discard preserved draft")!, "click"));
    assert.equal(harness.getCaptureDraftSerialized(), null);
    assert.equal(harness.container.querySelector('[aria-label="Preserved capture draft"]'), null);
    await waitFor(() => Boolean(buttonByText(harness.container, "Set geometry")), "Fresh photo flow did not become available after explicit discard");
  } finally {
    await harness.cleanup();
  }
});

test("invalid preserved draft blocks fresh work and cannot be overwritten before explicit Discard", async () => {
  const invalidSerialized = JSON.stringify({ version: "tampered-draft", adminToken: "must-remain-auditable" });
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-invalid", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    captureDraftSerialized: invalidSerialized,
  });
  try {
    assert.equal(harness.getPollCount(), 0, "Invalid draft resolution must precede any fresh photo flow");
    assert.equal(buttonByText(harness.container, "Set geometry"), undefined);
    assert.equal(harness.getCaptureDraftSerialized(), invalidSerialized, "Invalid evidence must not be overwritten silently");
    assert.match(harness.container.textContent ?? "", /failed strict session validation/i);

    await act(async () => fire(buttonByText(harness.container, "Discard invalid preserved draft")!, "click"));
    assert.equal(harness.getCaptureDraftSerialized(), null);
    await waitFor(() => Boolean(buttonByText(harness.container, "Set geometry")), "Fresh flow did not start after explicit invalid-draft discard");
  } finally {
    await harness.cleanup();
  }
});

test("localStorage get, set, and post-save remove failures stay explicit without losing in-memory work", async () => {
  const getFailure = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    localStorageGetFails: true,
  });
  try {
    assert.match(getFailure.container.textContent ?? "", /preserved capture draft could not be read/i);
    assert.ok(buttonByText(getFailure.container, "Discard invalid preserved draft"));
    assert.equal(buttonByText(getFailure.container, "Set geometry"), undefined);
  } finally {
    await getFailure.cleanup();
  }

  const setFailure = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    localStorageSetFails: true,
  });
  try {
    await act(async () => fire(buttonByText(setFailure.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(setFailure.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(setFailure.container, "Continue")!, "click"));
    await waitFor(() => Boolean(setFailure.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(setFailure.container, "Continue")!, "click"));
    await waitFor(() => /localStorage set failed|could not be preserved/i.test(setFailure.container.textContent ?? ""),
      "Draft set failure was not visible");
    assert.ok(setFailure.container.querySelector('[aria-label="front centering geometry"]'), "Set failure must retain active centering work");
  } finally {
    await setFailure.cleanup();
  }

  const removeFailure = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    localStorageRemoveFails: true,
  });
  try {
    await act(async () => fire(buttonByText(removeFailure.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(removeFailure.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(removeFailure.container, "Continue")!, "click"));
    await waitFor(() => Boolean(removeFailure.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(removeFailure.container, "Continue")!, "click"));
    await waitFor(() => Boolean(removeFailure.container.querySelector('[aria-label="front centering geometry"]')), "Front centering did not open");
    await loadPreparedImage(removeFailure.container, "front rectified trading card");
    await act(async () => fire(buttonByText(removeFailure.container, "Continue")!, "click"));
    await waitFor(() => Boolean(removeFailure.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await loadPreparedImage(removeFailure.container, "back rectified trading card");
    await act(async () => fire(buttonByText(removeFailure.container, "Continue")!, "click"));
    await waitFor(() => removeFailure.bundles.length === 1, "Capture save did not settle");
    assert.equal(removeFailure.draftCleanupFailures.length, 1);
    assert.match(removeFailure.draftCleanupFailures[0], /saved successfully.*obsolete browser draft could not be cleared/i);
    assert.ok(removeFailure.getCaptureDraftSerialized(), "Failed removal must leave the obsolete draft recoverable for explicit retry");
  } finally {
    await removeFailure.cleanup();
  }
});

test("raw preserved draft remains visible and blocks fresh capture while map binding is unavailable", async () => {
  const opaqueSerialized = JSON.stringify({
    version: "speedster-capture-registration-draft-v1",
    sessionId: "speedster-session-lifecycle-test",
    activeMapRevisionId: "temporarily-unavailable-revision",
  });
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    captureDraftSerialized: opaqueSerialized,
  });
  try {
    assert.equal(harness.getPollCount(), 0);
    assert.equal(buttonByText(harness.container, "Set geometry"), undefined);
    assert.equal(buttonByText(harness.container, "Resume preserved draft"), undefined);
    assert.ok(buttonByText(harness.container, "Discard invalid preserved draft"));
    assert.match(harness.container.textContent ?? "", /failed strict session validation/i);
    assert.equal(harness.getCaptureDraftSerialized(), opaqueSerialized, "Unknown-binding draft must not be parsed, changed, or deleted");
  } finally {
    await harness.cleanup();
  }
});

test("late Resume URL refresh cannot install a draft after its immutable map binding changes", async () => {
  const seed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-race-old", scope: "FAMILY", name: "Old map" },
    registrationFailsOnSide: "BACK",
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(seed.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.getCaptureDraftSerialized()), "Race-test draft was not written");
    serialized = seed.getCaptureDraftSerialized()!;
  } finally {
    await seed.cleanup();
  }

  let started = 0;
  const releases: Array<() => void> = [];
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-race-old", scope: "FAMILY", name: "Old map" },
    captureDraftSerialized: serialized,
    preparedImageRequestBarrier: async () => {
      started += 1;
      if (started <= 2) await new Promise<void>((resolve) => releases.push(resolve));
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Resume preserved draft")!, "click"));
    await waitFor(() => started === 2, "Resume did not begin both bounded prepared-image refreshes");
    await harness.rerenderActiveMap({ revisionId: "family-revision-race-new", scope: "FAMILY", name: "New map" });
    await act(async () => {
      releases.forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.ok(harness.container.querySelector('[aria-label="Preserved capture draft Card Map mismatch"]'));
    assert.ok(buttonByText(harness.container, "Discard preserved draft"));
    assert.equal(buttonByText(harness.container, "Resume geometry without old Card Map"), undefined);
    assert.match(harness.container.textContent ?? "", /cannot continue under obsolete map authority/i);
    assert.equal(harness.container.querySelector('[aria-label="Card Map registration interruption"]'), null);
    assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null);
    assert.equal(harness.getPollCount(), 0, "Map mismatch must block all background photo polling until explicit choice");
    assert.equal(harness.getRegistrationCount(), 0);
    assert.equal(harness.getCaptureDraftSerialized(), serialized, "Binding-raced draft must remain byte-identical for explicit resolution");

    assert.equal(harness.getRegistrationCount(), 0, "Neither obsolete nor current Card Map may register while recovery is blocked");
  } finally {
    releases.forEach((release) => release());
    await harness.cleanup();
  }
});

test("obsolete map-bound recovery stays blocked across every current map binding status", async () => {
  const seed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-status-old", scope: "FAMILY", name: "Old map" },
    registrationFailsOnSide: "BACK",
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(seed.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(seed.container, "Continue")!, "click"));
    await waitFor(() => Boolean(seed.getCaptureDraftSerialized()), "Status-drift seed was not written");
    serialized = seed.getCaptureDraftSerialized()!;
  } finally {
    await seed.cleanup();
  }

  const cases = [
    {
      name: "loaded-new-revision-success",
      activeMap: { revisionId: "family-revision-status-new", scope: "FAMILY" as const, name: "New map" },
      mapBindingStatus: "LOADED" as const,
    },
    { name: "no-map-unavailable", activeMap: undefined, mapBindingStatus: "NO_MAP" as const, omitInstrumentationReporter: true },
    { name: "lookup-failed-throw", activeMap: undefined, mapBindingStatus: "LOOKUP_FAILED" as const, decisionInstrumentationThrows: true },
    { name: "integrity-error-false", activeMap: undefined, mapBindingStatus: "INTEGRITY_ERROR" as const, instrumentationFails: true },
    {
      name: "no-map-timeout",
      activeMap: undefined,
      mapBindingStatus: "NO_MAP" as const,
      decisionInstrumentationResult: new Promise<boolean>(() => {}),
      decisionAuditConfirmationTimeoutMs: 10,
    },
  ];
  for (const candidate of cases) {
    const harness = await mountWorkspace({
      proposeGeometry: async () => geometryResponse(),
      activeMap: candidate.activeMap,
      mapBindingStatus: candidate.mapBindingStatus,
      mapLookupFailed: candidate.mapBindingStatus === "LOOKUP_FAILED",
      captureDraftSerialized: serialized,
      omitInstrumentationReporter: candidate.omitInstrumentationReporter,
      decisionInstrumentationThrows: candidate.decisionInstrumentationThrows,
      instrumentationFails: candidate.instrumentationFails,
      decisionInstrumentationResult: candidate.decisionInstrumentationResult,
      decisionAuditConfirmationTimeoutMs: candidate.decisionAuditConfirmationTimeoutMs,
    });
    try {
      assert.ok(harness.container.querySelector('[aria-label="Preserved capture draft Card Map mismatch"]'), `${candidate.name}: blocker missing`);
      assert.ok(buttonByText(harness.container, "Discard preserved draft"), `${candidate.name}: discard action missing`);
      assert.equal(buttonByText(harness.container, "Resume geometry without old Card Map"), undefined);
      assert.match(harness.container.textContent ?? "", /cannot continue under obsolete map authority/i);
      assert.equal(harness.getPollCount(), 0, `${candidate.name}: photo polling started before choice`);
      assert.equal(harness.getRegistrationCount(), 0, `${candidate.name}: registration started before choice`);
      assert.equal(harness.getCaptureDraftSerialized(), serialized, `${candidate.name}: raw draft changed before choice`);
      assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null);
      assert.equal(harness.events.some((event) => event.eventType === "MAP_AUTHORITY_OPERATOR_DECISION"), false);
    } finally {
      await harness.cleanup();
    }
  }
});

test("actual HTTP 402 with claimed retryable 503 evidence fails visibly as CLIENT_PROTOCOL", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
  await waitFor(
    () => Boolean(harness.container.querySelector('[aria-label="Card Map registration interruption"]')),
    "Registration blocker did not render",
  );
  assert.ok(buttonByText(harness.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW"));
}

function auditReconciliationNotices(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-audit-reconciliation-notice]"));
}

test("Retry preserves a synchronous decision-audit throw as a visible reconciliation notice", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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

function assertHumanReviewDecisionRequired(harness: Harness) {
  assert.ok(buttonByText(harness.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW"));
  assert.equal(harness.container.querySelector('[aria-label="front centering geometry"]'), null);
  assert.match(harness.container.textContent ?? "", /explicitly continue through human review/i);
  assert.equal(
    harness.events.some((event) => event.eventType === "MAP_REGISTRATION_OPERATOR_DECISION"),
    false,
  );
}

test("never-settling decision reporter is not invoked before the explicit human-review decision", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "exact-revision-audit-timeout", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: new Promise<boolean>(() => undefined),
    decisionAuditConfirmationTimeoutMs: 50,
  });
  try {
    await reachInterruptedRegistration(harness);
    assertHumanReviewDecisionRequired(harness);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    assert.doesNotMatch(harness.container.textContent ?? "", /audit write was not confirmed/i);
  } finally {
    await harness.cleanup();
  }
});

test("the pending human-review choice does not start a decision-audit timeout", async () => {
  const decisionResult = new Promise<boolean>(() => undefined);
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "exact-revision-late-audit-reject", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: decisionResult,
    decisionAuditConfirmationTimeoutMs: 20,
  });
  try {
    await reachInterruptedRegistration(harness);
    assertHumanReviewDecisionRequired(harness);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    assert.doesNotMatch(harness.container.textContent ?? "", /audit write was not confirmed/i);
  } finally {
    await harness.cleanup();
  }
});

test("the pending human-review choice does not emit a rejected decision audit", async () => {
  const decisionResult = Promise.resolve(false);
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "exact-revision-audit-reject", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: decisionResult,
    decisionAuditConfirmationTimeoutMs: 100,
  });
  try {
    await reachInterruptedRegistration(harness);
    assertHumanReviewDecisionRequired(harness);
    assert.doesNotMatch(harness.container.textContent ?? "", /Operator-decision audit write failed/);
  } finally {
    await harness.cleanup();
  }
});

test("instrumentation failure cannot make the explicit human-review decision automatically", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "exact-revision-decision-audit", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    instrumentationFails: true,
  });
  try {
    await reachInterruptedRegistration(harness);
    assertHumanReviewDecisionRequired(harness);
  } finally {
    await harness.cleanup();
  }
});

test("a missing decision reporter cannot make the explicit human-review decision automatically", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "exact-revision-no-reporter", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    omitInstrumentationReporter: true,
  });
  try {
    await reachInterruptedRegistration(harness);
    assertHumanReviewDecisionRequired(harness);
  } finally {
    await harness.cleanup();
  }
});

test("a pending human-review choice cannot leak a decision-audit warning into a replacement session", async () => {
  let resolveDecision: ((saved: boolean) => void) | undefined;
  const decisionResult = new Promise<boolean>((resolve) => { resolveDecision = resolve; });
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "exact-revision-late-audit", scope: "EXACT", name: "Squirtle #007" },
    registrationFailsOnSide: "BACK",
    decisionInstrumentationResult: decisionResult,
    decisionAuditConfirmationTimeoutMs: 100,
  });
  try {
    await reachInterruptedRegistration(harness);
    assertHumanReviewDecisionRequired(harness);
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
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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

test("first of two rescues serializes, parses, and reloads the remaining explicit recovery choice", async () => {
  const activeMap = { revisionId: "family-revision-two-rescues", scope: "FAMILY" as const, name: "2023 MEW EN Reverse Holo" };
  const first = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    registrationNeedsRescueOnBoth: true,
  });
  let serialized: string;
  try {
    await act(async () => fire(buttonByText(first.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(first.container, "Continue")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(first.container, "Continue")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="FRONT Card Map anchor rescue"]')), "Front rescue did not open first");
    const rescueImage = await loadPreparedImage(first.container, "front current card");
    const failedHandle = first.container.querySelector('[aria-label="Move anchor 1, out_of_card"]') as HTMLButtonElement | null;
    assert.ok(failedHandle && rescueImage.parentElement);
    Object.defineProperty(rescueImage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 }),
    });
    await act(async () => {
      fire(failedHandle, "pointerdown", { pointerId: 45, clientX: 0, clientY: 60 });
      fire(rescueImage.parentElement!, "pointermove", { pointerId: 45, clientX: 400, clientY: 300 });
      fire(rescueImage.parentElement!, "pointerup", { pointerId: 45, clientX: 400, clientY: 300 });
    });
    await act(async () => fire(buttonByText(first.container, "Confirm corrected anchors")!, "click"));
    await waitFor(() => Boolean(first.container.querySelector('[aria-label="BACK Card Map anchor rescue"]')), "Back rescue did not remain after Front success");
    await waitFor(() => Boolean(first.getCaptureDraftSerialized()), "Remaining Back rescue was not serialized");
    serialized = first.getCaptureDraftSerialized()!;
    const parsed = parseSpeedsterCaptureRegistrationDraft(serialized, {
      surface: "AI_GRADER",
      sessionId: "speedster-session-lifecycle-test",
      cardProfile: "POKEMON",
      mapBindingStatus: "LOADED",
      activeMapRevisionId: activeMap.revisionId,
      activeMapScope: activeMap.scope,
    });
    assert.ok(parsed);
    assert.deepEqual(Object.keys(parsed.failures), ["BACK"]);
    assert.deepEqual(Object.keys(parsed.attemptIds), ["BACK"]);
    assert.ok(parsed.provisional.FRONT);
  } finally {
    await first.cleanup();
  }

  const resumed = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    captureDraftSerialized: serialized,
  });
  try {
    await act(async () => fire(buttonByText(resumed.container, "Resume preserved draft")!, "click"));
    await waitFor(() => Boolean(resumed.container.querySelector('[aria-label="BACK Card Map anchor rescue"]')), "Remaining Back rescue did not reload");
    assert.equal(resumed.getRegistrationCount(), 0, "Reload must not silently repeat the successful Front rescue");
    await loadPreparedImage(resumed.container, "back current card");
    assert.ok(buttonByText(resumed.container, "CONTINUE WITHOUT CARD MAP · HUMAN REVIEW"));
    assert.equal(resumed.container.querySelector('[aria-label="front centering geometry"]'), null);
    assert.match(resumed.container.textContent ?? "", /Unresolved human-correction sides/i);
    const parsed = parseSpeedsterCaptureRegistrationDraft(resumed.getCaptureDraftSerialized()!, {
      surface: "AI_GRADER",
      sessionId: "speedster-session-lifecycle-test",
      cardProfile: "POKEMON",
      mapBindingStatus: "LOADED",
      activeMapRevisionId: activeMap.revisionId,
      activeMapScope: activeMap.scope,
    });
    assert.ok(parsed);
    assert.deepEqual(Object.keys(parsed.failures), ["BACK"]);
    assert.ok(parsed.provisional.FRONT);
    assert.deepEqual(parsed.registrationFailureSides, {});
    assert.equal(parsed.mapRegistrationFailed, false);
  } finally {
    await resumed.cleanup();
  }
});

test("global registration failure explains four-anchor confirmation and accepts unchanged credible proposals", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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

test("one non-cooperative registration timeout stops for explicit recovery without automatic retry", async () => {
  const harness = await mountWorkspace({
    imageRequestTimeoutMs: 10,
    proposeGeometry: async () => geometryResponse(),
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
    assertHumanReviewDecisionRequired(harness);
    assert.equal(harness.events.some((event) => event.eventType === "GEOMETRY_CONFIRMED"), false);
  } finally {
    await harness.cleanup();
  }
});

test("failed final capture save exposes Retry and resubmits one byte-identical bundle", async () => {
  const submitted: string[] = [];
  let draftAtFirstSaveStart: string | null = null;
  let resolveFirstSave: ((result: { saved: false; message: string }) => void) | null = null;
  const firstSave = new Promise<{ saved: false; message: string }>((resolve) => { resolveFirstSave = resolve; });
  let saveCalls = 0;
  const activeMap = { revisionId: "family-revision-final-save-retry", scope: "FAMILY" as const, name: "2023 MEW EN Reverse Holo" };
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap,
    onSave: async (bundle) => {
      saveCalls += 1;
      submitted.push(JSON.stringify(bundle));
      if (saveCalls === 1) draftAtFirstSaveStart = window.localStorage.getItem(
        "tenkings:speedster:capture-registration-draft:v1:speedster-session-lifecycle-test",
      );
      return saveCalls === 1 ? firstSave : { saved: true };
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
    await waitFor(() => saveCalls === 1, "The first final save did not begin");
    assert.ok(draftAtFirstSaveStart, "The final browser draft must exist before onReady begins");
    const preSaveDraft = parseSpeedsterCaptureRegistrationDraft(draftAtFirstSaveStart, {
      surface: "AI_GRADER",
      sessionId: "speedster-session-lifecycle-test",
      cardProfile: "POKEMON",
      mapBindingStatus: "LOADED",
      activeMapRevisionId: activeMap.revisionId,
      activeMapScope: activeMap.scope,
    });
    assert.ok(preSaveDraft);
    const compactSide = (side: import("../components/ai-grader-v2/CaptureWorkspace").SpeedsterCaptureBundle["front"]) => ({
      originalStorageKey: side.originalStorageKey,
      rectifiedStorageKey: side.rectifiedStorageKey,
      inspectionStorageKey: side.inspectionStorageKey,
      inspectionFrame: side.inspectionFrame,
      viewStorageKeys: side.viewStorageKeys,
      sourceCorners: side.sourceCorners,
      transform: side.transform,
      centeringQuad: side.centeringQuad,
      centeringBorders: side.centeringBorders,
    });
    const submittedBundle = harness.bundles[0];
    assert.equal(speedsterCaptureDraftMatchesCommittedSession(preSaveDraft, {
      workflowState: "CAPTURED",
      capture: {
        cornerShape: submittedBundle.cornerShape,
        front: compactSide(submittedBundle.front),
        back: compactSide(submittedBundle.back),
      },
      mapRevisionId: activeMap.revisionId,
      mapRegistration: {
        front: Object.fromEntries(Object.entries(submittedBundle.front.mapRegistration!).filter(([key]) => key !== "serverReceipt")),
        back: Object.fromEntries(Object.entries(submittedBundle.back.mapRegistration!).filter(([key]) => key !== "serverReceipt")),
      },
    }), true, "The unsettled pre-request draft must exactly reconcile with the would-be committed server capture");
    assert.equal(preSaveDraft.captureSavePendingRetry, true);
    assert.ok(preSaveDraft.front.centering && preSaveDraft.back.centering);
    await act(async () => resolveFirstSave?.({ saved: false, message: "Transient capture save failure" }));
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
    await waitFor(() => Boolean(harness.getCaptureDraftSerialized()), "Failed active-map save did not retain a durable draft");
    const retainedDraft = parseSpeedsterCaptureRegistrationDraft(harness.getCaptureDraftSerialized()!, {
      surface: "AI_GRADER",
      sessionId: "speedster-session-lifecycle-test",
      cardProfile: "POKEMON",
      mapBindingStatus: "LOADED",
      activeMapRevisionId: activeMap.revisionId,
      activeMapScope: activeMap.scope,
    });
    assert.ok(retainedDraft, "Failed final save must leave a strictly parseable active-map draft");
    assert.equal(retainedDraft.stage, "BACK_CENTERING");
    assert.ok(retainedDraft.front.mapRegistration && retainedDraft.back.mapRegistration);

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

test("expired Color receipt recovery reruns only the exact side and mode while every sibling byte stays retained", async () => {
  let saveCalls = 0;
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
    activeMap: { revisionId: "family-revision-color-expiry", scope: "FAMILY", name: "2023 MEW EN Reverse Holo" },
    onSave: async () => {
      saveCalls += 1;
      return saveCalls === 1 ? {
        saved: false,
        message: "FRONT PRINTED_FRAME color geometry receipt expired. Every completed sibling and nonexpired mode remains preserved. Explicitly rerun and reconfirm only FRONT PRINTED_FRAME.",
        colorGeometryReceiptExpired: { side: "FRONT", mode: "PRINTED_FRAME" },
      } : { saved: true };
    },
  });
  try {
    await act(async () => fire(buttonByText(harness.container, "Set geometry")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front card geometry"]')), "Front geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back card geometry"]')), "Back geometry did not open");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="front centering geometry"]')), "Front centering did not open");
    await loadPreparedImage(harness.container, "front rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Back centering did not open");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await act(async () => fire(buttonByText(harness.container, "Continue")!, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="Expired Color Geometry receipt recovery"]')), "Exact receipt recovery did not render");
    assert.equal(saveCalls, 1);
    assert.match(harness.container.textContent ?? "", /FRONT · PRINTED FRAME/);
    const before = structuredClone(harness.bundles[0]);
    const exactButton = buttonByText(harness.container, "Rerun and reconfirm only FRONT PRINTED_FRAME");
    assert.ok(exactButton);
    await act(async () => fire(exactButton, "click"));
    await waitFor(() => Boolean(harness.container.querySelector('[aria-label="back centering geometry"]')), "Exact recovery did not return to Back centering");
    await loadPreparedImage(harness.container, "back rectified trading card");
    await waitFor(() => Boolean(buttonByText(harness.container, "Retry save")), "Exact recovery did not return to retryable save");
    assert.deepEqual(harness.getColorRecoveryRequests().map(({ side, mode }) => ({ side, mode })), [
      { side: "FRONT", mode: "PRINTED_FRAME" },
    ]);
    await act(async () => fire(buttonByText(harness.container, "Retry save")!, "click"));
    await waitFor(() => saveCalls === 2, "Recovered capture did not retry save");
    const after = harness.bundles[1];
    assert.deepEqual(after.front.sourceCorners, before.front.sourceCorners);
    assert.deepEqual(after.front.centeringQuad, before.front.centeringQuad);
    assert.deepEqual(after.back, before.back, "completed Back side and both of its receipts must remain byte-identical");
    assert.deepEqual(after.front.colorGeometryEvidence?.[0], before.front.colorGeometryEvidence?.[0], "nonexpired Front physical receipt must remain byte-identical");
    assert.notEqual(after.front.colorGeometryEvidence?.[1].serverReceipt, before.front.colorGeometryEvidence?.[1].serverReceipt);
    assert.deepEqual(after.front.colorGeometryEvidence?.[1].confirmedQuad, before.front.colorGeometryEvidence?.[1].confirmedQuad);
  } finally {
    await harness.cleanup();
  }
});

test("failed effective lookup records NONE while ordinary geometry stays available", async () => {
  const harness = await mountWorkspace({
    proposeGeometry: async () => geometryResponse(),
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
    proposeGeometry: async () => geometryResponse(),
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
