import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  applyAiGraderConfirmedPublishAuthority,
  buildAiGraderConfirmCardReferencePlan,
  buildAiGraderPublishAuthorityRecord,
  buildAiGraderProductionStoragePlan,
  normalizeAiGraderPublicCaptureTiming,
  normalizeAiGraderPublicOcrPrefill,
} from "@tenkings/database";
import aiGraderLocalStationHandler from "../pages/api/ai-grader/station/[...action]";
import { config as aiGraderProductionRouteConfig } from "../pages/api/admin/ai-grader/production/[...action]";
import {
  AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION,
  AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
  AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
  aiGraderCardPlacementLabel,
  buildSampleAiGraderReportHistory,
  buildAiGraderLocalStationStatus,
  parseAiGraderStationAction,
  parseAiGraderRapidCaptureWorkflowState,
  sanitizeAiGraderCaptureTiming,
  sanitizeAiGraderPreviewCardGeometryBySide,
  sanitizeAiGraderLocalStationStatusForDisplay,
} from "../lib/aiGraderLocalStation";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE, getAiGraderReportBundle, hasNoCertifiedClaim, hasNoFinalCertifiedClaims } from "../lib/aiGraderReportBundle";
import { buildSampleAiGraderProductionRelease } from "../lib/aiGraderProductionRelease";
import { resolveAiGraderAuthoritativeProductionPackage } from "../lib/aiGraderReleaseAuthority";
import {
  AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS,
  buildAiGraderCompsReadiness,
  buildAiGraderLabelPreviewUrl,
  buildAiGraderPublishReadiness,
} from "../lib/aiGraderOperatorWorkflow";
import { formatAiGraderPublishStageError } from "../lib/aiGraderPublishErrors";
import {
  AI_GRADER_EBAY_COMPS_ENABLED_ENV,
  AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
  AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV,
  assertAiGraderConfirmCardReady,
  assertAiGraderStorageArtifactIntegrity,
  addAiGraderCardToInventoryRuntime,
  buildAiGraderFinishCardsQueueResult,
  buildAiGraderProductionHistoryResult,
  createAiGraderProductionApiHandler,
  createAiGraderCardFromReportRuntime,
  createAiGraderPublicReportApiHandler,
  persistAiGraderCompsRuntime,
  persistProductionReleaseRuntime,
  persistAiGraderSelectedCompsRuntime,
  sanitizeAiGraderUploadHeadersForResponse,
  validateAiGraderInventoryReadiness,
} from "../lib/server/aiGraderProductionApi";
import { completePublishedAiGraderCardTx } from "../lib/server/aiGraderLabelSheetRuntime";
import {
  AI_GRADER_OPERATOR_USER_IDS_ENV,
  AI_GRADER_SERVICE_ACCOUNT_ID_ENV,
  AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV,
  AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV,
} from "../lib/server/aiGraderProductionAuth";
import {
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  acceptAiGraderLiveLightingProfile,
  applyAiGraderLiveLighting,
  buildAiGraderCaptureProfileRequest,
  buildAiGraderDetectedGeometryCaptureRequest,
  buildAiGraderManualGeometryCaptureRequest,
  buildAiGraderRapidCaptureConfigurationRequest,
  buildAiGraderRapidQueueActivationRequest,
  callAiGraderStationBridge,
  fetchAiGraderLiveLightingStatus,
  fetchAiGraderStationBridgeHealth,
  fetchAiGraderStationPreviewStatus,
  fetchAiGraderStationReportAsset,
  fetchAiGraderStationReportBundle,
  heartbeatAiGraderLiveLighting,
  normalizeAiGraderStationBridgeUrl,
  openAiGraderStationPreviewStream,
  pairAiGraderStationBridge,
  safeOffAiGraderLiveLighting,
  stopAiGraderStationPreview,
} from "../lib/aiGraderStationBridgeClient";
import { reportImageAssets } from "../lib/aiGraderReportImages";
import { canConfirmAiGraderCardManually } from "../lib/aiGraderForwardConfirm";
import {
  AiGraderOcrPrefillStageError,
  runAiGraderOcrPrefillFromLocalReport,
} from "../lib/aiGraderOcrPrefillClient";

type MockResponse = NextApiResponse & {
  statusCodeValue: number | null;
  headers: Record<string, string | number | readonly string[]>;
  jsonBody: unknown;
};

function mockRequest(method: string, action?: string[]): NextApiRequest {
  return {
    method,
    query: action ? { action } : {},
    body: {},
    headers: {},
  } as NextApiRequest;
}

function mockResponse(): MockResponse {
  return {
    statusCodeValue: null,
    headers: {},
    jsonBody: undefined,
    setHeader(this: MockResponse, name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
      return this;
    },
    status(this: MockResponse, statusCode: number) {
      this.statusCodeValue = statusCode;
      return this;
    },
    json(this: MockResponse, body: unknown) {
      this.jsonBody = body;
      return this;
    },
  } as unknown as MockResponse;
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Base64FromHex(value: string) {
  return Buffer.from(value, "hex").toString("base64");
}

const currentV02StructurePath = [
  path.join(process.cwd(), "tests", "fixtures", "ai-grader-current-v02-confirm-structure.json"),
  path.join(process.cwd(), "frontend", "nextjs-app", "tests", "fixtures", "ai-grader-current-v02-confirm-structure.json"),
].find((candidate) => fs.existsSync(candidate));
if (!currentV02StructurePath) throw new Error("Current AI Grader v0.2 structural fixture is missing.");
const CURRENT_V02_CONFIRM_STRUCTURE = JSON.parse(fs.readFileSync(currentV02StructurePath, "utf8"));

function sampleStorageReadyReportBundle(overrides: Partial<typeof SAMPLE_AI_GRADER_REPORT_BUNDLE> = {}) {
  const imageBytes = Buffer.from("front-image");
  return {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "sample-final-v0",
    finalGradeComputed: true,
    provisionalGrade: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade,
      gradeImpactCandidates: [],
    },
    visionLab: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE.visionLab,
      candidateCount: 0,
      defectFindings: [],
      findingValidation: {
        status: "valid" as const,
        sourceCandidateCount: 0,
        publishedFindingCount: 0,
        issues: [],
      },
    },
    assets: [
      {
        id: "front/front-all-on-portrait-display.png",
        kind: "image",
        fileName: "front-all-on-portrait-display.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(imageBytes),
        sha256: sha256Hex(imageBytes),
        byteSize: imageBytes.length,
        widthPx: 1,
        heightPx: 1,
      },
    ],
    ...overrides,
  };
}

function sampleConfirmReadyPackage() {
  const frontBytes = Buffer.from("confirm-front-normalized");
  const backBytes = Buffer.from("confirm-back-normalized");
  const baseBundle = sampleStorageReadyReportBundle({
    schemaVersion: CURRENT_V02_CONFIRM_STRUCTURE.schemaVersion,
    reportProducer: CURRENT_V02_CONFIRM_STRUCTURE.reportProducer,
    assets: [
      {
        id: "front/normalized/front-normalized-card.png",
        kind: "image",
        fileName: "front-normalized-card.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(frontBytes),
        sha256: sha256Hex(frontBytes),
        byteSize: frontBytes.length,
        widthPx: 1200,
        heightPx: 1680,
        side: "front",
        evidenceRole: "normalized_card",
      },
      {
        id: "back/normalized/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(backBytes),
        sha256: sha256Hex(backBytes),
        byteSize: backBytes.length,
        widthPx: 1200,
        heightPx: 1680,
        side: "back",
        evidenceRole: "normalized_card",
      },
    ],
  } as any);
  assert.equal(CURRENT_V02_CONFIRM_STRUCTURE.sourceAssetCount, 77);
  assert.deepEqual(
    baseBundle.assets.map((asset: any) => ({
      side: asset.side,
      mimeType: asset.contentType,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
    })),
    CURRENT_V02_CONFIRM_STRUCTURE.normalizedCards,
  );
  const productionRelease = buildSampleAiGraderProductionRelease(baseBundle);
  return {
    reportBundle: {
      ...baseBundle,
      productionRelease,
    },
    productionRelease,
  };
}

function presignForTest(input: { storageKey: string; contentType: string; checksumSha256: string }) {
  return {
    storageKey: input.storageKey,
    uploadUrl: `https://uploads.tenkings.test/${encodeURIComponent(input.storageKey)}`,
    uploadMethod: "PUT" as const,
    uploadHeaders: {
      "Content-Type": input.contentType,
      "x-amz-checksum-sha256": sha256Base64FromHex(input.checksumSha256),
    },
    publicUrl: `https://cdn.tenkings.test/${input.storageKey}`,
  };
}

function uploadManifestFromPlan(artifacts: Array<{
  artifactId: string;
  storageKey: string;
  publicUrl?: string;
  checksumSha256: string;
  byteSize: number;
  contentType: string;
  sourceImageWidthPx?: number;
  sourceImageHeightPx?: number;
}>) {
  return {
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      storageKey: artifact.storageKey,
      publicUrl: artifact.publicUrl,
      checksumSha256: artifact.checksumSha256,
      byteSize: artifact.byteSize,
      contentType: artifact.contentType,
      ...(artifact.sourceImageWidthPx && artifact.sourceImageHeightPx
        ? {
            sourceImageWidthPx: artifact.sourceImageWidthPx,
            sourceImageHeightPx: artifact.sourceImageHeightPx,
          }
        : {}),
      uploadedAt: "2026-07-06T23:00:00.000Z",
    })),
  };
}

function inventoryReadinessDb(overrides: {
  report?: Record<string, unknown> | null;
  label?: Record<string, unknown> | null;
  slabbedAssets?: Array<Record<string, unknown>>;
  valuation?: Record<string, unknown> | null;
} = {}) {
  const report =
    overrides.report === null
      ? null
      : {
          id: "report-row-1",
          tenantId: "tenant-1",
          sessionId: "session-row-1",
          reportId: "sample-final-v0",
          publicationStatus: "published",
          cardAssetId: "card-asset-1",
          itemId: "item-1",
          ...(overrides.report ?? {}),
        };
  const label =
    overrides.label === null
      ? null
      : {
          id: "label-1",
          physicalPrintStatus: "printed",
          ...(overrides.label ?? {}),
        };
  const slabbedAssets =
    overrides.slabbedAssets ?? [
      {
        id: "front-photo",
        side: "front",
        storageKey: "ai-grader/reports/sample-final-v0/slabbed/front.png",
        publicUrl: "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/slabbed/front.png",
        byteSize: 12,
      },
      {
        id: "back-photo",
        side: "back",
        storageKey: "ai-grader/reports/sample-final-v0/slabbed/back.png",
        publicUrl: "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/slabbed/back.png",
        byteSize: 12,
      },
    ];
  const valuation =
    overrides.valuation === null
      ? null
      : {
          id: "valuation-1",
          status: "completed",
          valuationMinor: 10000,
          ...(overrides.valuation ?? {}),
        };
  return {
    aiGraderReport: {
      async findUnique() {
        return report;
      },
    },
    aiGraderLabel: {
      async findFirst() {
        return label;
      },
    },
    aiGraderEvidenceAsset: {
      async findMany() {
        return slabbedAssets;
      },
    },
    aiGraderValuation: {
      async findFirst() {
        return valuation;
      },
    },
  };
}

test("local station contract exposes workflow status with no login, DB, or hardware actions", () => {
  const status = buildAiGraderLocalStationStatus({ action: "status", now: "test" });
  const backPositioningStatus = buildAiGraderLocalStationStatus({ action: "capture-front", now: "test" });

  assert.equal(status.bridgeVersion, AI_GRADER_LOCAL_STATION_BRIDGE_VERSION);
  assert.equal(backPositioningStatus.currentStep, "prompt_flip_card");
  assert.equal(backPositioningStatus.nextAction, "capture-back");
  assert.equal(status.loginRequired, false);
  assert.equal(status.hardwareActionsEnabled, false);
  assert.equal(status.safety.databaseWrites, false);
  assert.equal(status.safety.hardwareAccessed, false);
  assert.equal(status.safety.finalGradeComputed, false);
  assert.equal(status.safety.certifiedClaim, false);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.path === "/api/ai-grader/station/capture-front"), true);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.action === "configure-rapid-capture"), true);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.action === "queue-current-card"), true);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.action === "activate-queue-item"), true);
  assert.equal(status.bridgeContract.endpoints.every((endpoint) => endpoint.hardwareAccess === false), true);
  assert.equal(status.previewStatus.browserEmbedded, true);
  assert.equal(status.previewStatus.localOnly, true);
  assert.equal(status.previewStatus.safety.productionServiceTokenUsed, false);
  assert.equal(status.previewStatus.safety.publicRouteExposed, false);
  assert.equal(status.previewStatus.cardGeometry?.front?.placementState, "not_detected");
  assert.equal(status.previewStatus.cardGeometry?.back?.placementState, "not_detected");
  assert.equal(status.liveLighting.localOnly, true);
  assert.equal(status.liveLighting.tokenRequired, true);
  assert.equal(status.liveLighting.safety.publicRouteExposed, false);
  assert.equal(status.liveLighting.safety.productionServiceTokenUsed, false);
  assert.equal(status.liveLighting.safety.maxDutyPercent, 5);
  assert.equal(status.bridgeContract.endpoints.some((endpoint) => endpoint.path === "/lighting/apply"), true);
  assert.equal(status.warmRunnerStatus.mode, "full_forensic");
  assert.equal(status.executionPath, "warm_full_forensic_runner");
  assert.equal(status.explicitColdDebugModeUsed, false);
  assert.equal(status.warmRunnerStatus.executionPath, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.backend, "warm_full_forensic_runner");
  assert.equal(status.warmRunnerStatus.explicitColdDebugModeUsed, false);
  assert.equal(status.warmRunnerStatus.coldDebugMode.active, false);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdPreviewDuringFullForensicRun, true);
  assert.equal(status.warmRunnerStatus.previewPolicy.holdActive, false);
  assert.equal(status.timingSummary?.executionPath, "warm_full_forensic_runner");
  assert.equal(status.timingSummary?.explicitColdDebugModeUsed, false);
  assert.equal(status.warmRunnerStatus.evidencePlan.defaultFullForensic, true);
  assert.equal(status.captureProfile, "full_forensic");
  assert.equal(status.captureProfileGuard.stationSettingRequired, true);
  assert.equal(status.captureProfileGuard.selectionSource, "bridge_default");
  assert.equal(status.captureProfileGuard.productionFastOptIn, false);
  assert.deepEqual(status.captureProfileGuard.availableCaptureProfiles, ["full_forensic", "production_fast"]);
  assert.equal(status.captureProfileGuard.previousStableProfile, "full_forensic");
  assert.equal(status.captureProfileGuard.fiveSecondTargetProven, false);
  assert.equal(status.captureTiming.schemaVersion, AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION);
  assert.equal(status.captureTiming.captureProfile, "full_forensic");
  assert.equal(status.captureTiming.targetSideMs, 5000);
  assert.equal(status.captureTiming.hardwareMeasurement, false);
  assert.deepEqual(status.captureTiming.events, []);
  assert.deepEqual(status.captureTiming.phases, []);
  assert.equal(status.captureTiming.summary.frontProcessingOverlappedFlip, false);
  assert.equal(status.captureTiming.target.fiveSecondsPerSideProven, false);
  assert.equal(status.captureTiming.target.hardwareMeasurementRequired, true);
  assert.equal(status.rapidCapture.enabled, false);
  assert.equal(status.rapidCapture.humanConfirmationRequired, true);
  assert.equal(status.rapidCapture.autoConfirm, false);
  assert.equal(status.rapidCapture.autoPublish, false);
  assert.deepEqual(status.rapidCapture.workflowHistory, []);
  assert.equal(status.rapidCaptureQueue.enabled, false);
  assert.equal(status.rapidCaptureQueue.persisted, true);
  assert.equal(status.rapidCaptureQueue.reportWorkerSerialized, true);
  assert.deepEqual(status.rapidCaptureQueue.items, []);
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.front.map((role) => role.role), [
    "dark_control",
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ]);
  assert.deepEqual(status.warmRunnerStatus.evidencePlan.rolesBySide.back.map((role) => role.role), [
    "dark_control",
    "all_on",
    "accepted_profile",
    "channel_1",
    "channel_2",
    "channel_3",
    "channel_4",
    "channel_5",
    "channel_6",
    "channel_7",
    "channel_8",
  ]);
  assert.equal(status.warmRunnerStatus.coldDebugMode.configured, false);
  assert.equal(status.warmRunnerStatus.safety.explicitColdDebugModeOnly, true);
  assert.equal(status.warmRunnerStatus.safety.captureLock, true);
  assert.equal(status.warmRunnerStatus.safety.watchdogSafeOff, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnFailure, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnCancellation, true);
  assert.equal(status.warmRunnerStatus.safety.safeOffOnSessionEnd, true);
  assert.equal(status.warmRunnerStatus.safety.publicRouteExposed, false);
  assert.equal(status.warmRunnerStatus.safety.productionServiceTokenUsed, false);
  assert.equal(status.latestReport.publicViewerRoute, "/ai-grader/reports/[reportId]");
  assert.equal(status.latestReport.publicViewerRoute.includes("station"), false);
});

test("preview geometry exposes exact operator states and strips local/private metadata", () => {
  assert.deepEqual(
    (["not_detected", "adjust_card", "ready"] as const).map(aiGraderCardPlacementLabel),
    ["Not Detected", "Adjust Card", "Ready"]
  );

  const corners = {
    topLeft: { x: 120, y: 80 },
    topRight: { x: 1080, y: 100 },
    bottomRight: { x: 1060, y: 1580 },
    bottomLeft: { x: 140, y: 1560 },
  };
  const safe = sanitizeAiGraderPreviewCardGeometryBySide({
    activeSide: "front",
    front: {
      version: "ten-kings-card-geometry-v1",
      side: "front",
      placementState: "ready",
      geometrySource: "detected",
      captureMode: "automatic_detection",
      confidenceBasis: "automatic_detection",
      detectionUsed: true,
      manualOverrideUsed: false,
      corners,
      detectedCorners: corners,
      boundingBox: { x: 120, y: 80, width: 960, height: 1500 },
      rotationDegrees: 1.2,
      skewDegrees: 1.2,
      confidence: 0.94,
      sourceFrameId: "C:\\TenKings\\capture-data\\front.png",
      timestamp: "2026-07-09T12:00:00.000Z",
      image: { width: 1200, height: 1680, coordinateFrame: "source_image_pixels" },
      localPath: "C:\\TenKings\\capture-data\\front.png",
      bridgeUrl: "http://127.0.0.1:4317",
      stationToken: "station-secret",
      presignedUrl: "https://storage.example/object?X-Amz-Signature=secret",
      dataImage: "data:image/png;base64,private",
    },
    back: {
      side: "back",
      placementState: "adjust_card",
      adjustmentReason: "manual_capture_selected",
      geometrySource: "manual_override",
      captureMode: "manual_capture",
      confidenceBasis: "operator_confirmation",
      detectionUsed: false,
      manualOverrideUsed: true,
      corners,
      detectedCorners: null,
      boundingBox: { x: 120, y: 80, width: 960, height: 1500 },
      rotationDegrees: 8,
      skewDegrees: 8,
      confidence: 0.7,
    },
  });

  assert.equal(safe?.front?.placementState, "ready");
  assert.equal(safe?.back?.placementState, "adjust_card");
  assert.equal(safe?.back?.adjustmentReason, "manual_capture_selected");
  assert.equal(safe?.back?.geometrySource, "manual_override");
  assert.equal(safe?.back?.manualOverrideUsed, true);
  assert.equal(safe?.front?.sourceFrameId, undefined);
  assert.deepEqual(safe?.front?.corners, corners);
  const displayedMetadata = JSON.stringify(safe);
  assert.doesNotMatch(displayedMetadata, /C:\\TenKings|127\.0\.0\.1|stationToken|data:image|X-Amz|presignedUrl|localPath/i);
});

test("production_fast is explicit and rapid capture status stays display-safe", () => {
  const workflowStates = [
    "front_captured",
    "front_processing",
    "back_positioning",
    "back_captured",
    "finalizing",
    "report_ready_needs_confirm",
    "confirmed_needs_publish",
    "published",
    "failed",
  ] as const;
  for (const state of workflowStates) assert.equal(parseAiGraderRapidCaptureWorkflowState(state), state);
  assert.equal(parseAiGraderRapidCaptureWorkflowState("auto_published"), null);

  const fast = buildAiGraderLocalStationStatus({
    action: "configure-rapid-capture",
    captureProfile: "production_fast",
    rapidCaptureEnabled: true,
  });
  assert.equal(fast.captureProfile, "production_fast");
  assert.equal(fast.captureProfileGuard.selectionSource, "operator_setting");
  assert.equal(fast.captureProfileGuard.productionFastOptIn, true);
  assert.equal(fast.captureProfileGuard.stationSettingRequired, true);
  assert.equal(fast.captureProfileGuard.fullForensicEvidencePreserved, true);
  assert.equal(fast.captureProfileGuard.fiveSecondTargetProven, false);
  assert.equal(fast.warmRunnerStatus.evidencePlan.rolesBySide.front.length, 11);
  assert.equal(fast.warmRunnerStatus.evidencePlan.rolesBySide.back.length, 11);
  assert.equal(fast.rapidCapture.enabled, true);
  assert.equal(fast.rapidCaptureQueue.enabled, true);

  const timestamp = "2026-07-09T12:00:00.000Z";
  const unsafeStatus = {
    ...fast,
    fallbackUsed: true,
    fallbackReason: "legacy automatic fallback",
    geometryCaptureDecisions: {
      front: {
        mode: "manual_capture",
        placementState: "not_detected",
        timestamp,
        explicitOperatorAction: true,
        detectionUsed: false,
        manualOverrideUsed: true,
        manualBoundaryRect: { x: 120, y: 80, width: 960, height: 1500 },
        sourceFrameId: "preview-front-44",
        localPath: "C:\\TenKings\\private\\front.tiff",
      },
      back: {
        mode: "detected_geometry",
        placementState: "ready",
        timestamp,
        explicitOperatorAction: false,
        detectionUsed: true,
        manualOverrideUsed: false,
        sourceFrameId: "preview-back-52",
      },
    },
    rapidCapture: {
      enabled: true,
      queueItemId: "rapid-queue-1",
      workflowState: "front_processing",
      workflowHistory: [
        { state: "front_captured", at: timestamp, detail: "Front evidence safely persisted.", manifestPath: "C:\\TenKings\\private\\manifest.json" },
        { state: "front_processing", at: timestamp, detail: "Processing overlaps operator flip.", stationToken: "private-token" },
      ],
      safelyQueuedAt: timestamp,
      humanConfirmationRequired: false,
      autoConfirm: true,
      autoPublish: true,
      manifestPath: "C:\\TenKings\\private\\manifest.json",
      stationToken: "private-token",
    },
    rapidCaptureQueue: {
      enabled: true,
      activeQueueItemId: "rapid-queue-1",
      persisted: true,
      reportWorkerSerialized: true,
      manifestPath: "C:\\TenKings\\private\\rapid-capture-queue.json",
      stationToken: "private-token",
      items: [
        {
          queueItemId: "rapid-queue-1",
          sessionId: "session-1",
          reportId: "report-1",
          state: "report_ready_needs_confirm",
          queuedAt: timestamp,
          updatedAt: timestamp,
          history: [{ state: "finalizing", at: timestamp, detail: "Serialized report worker active." }],
          humanConfirmationRequired: false,
          autoConfirmed: true,
          autoPublished: true,
          manifestPath: "C:\\TenKings\\private\\manifest.json",
          stationToken: "private-token",
          error: "C:\\TenKings\\private\\runner.log",
        },
      ],
    },
  } as unknown as typeof fast;
  const safeStatus = sanitizeAiGraderLocalStationStatusForDisplay(unsafeStatus);
  assert.equal(safeStatus.rapidCapture.workflowState, "front_processing");
  assert.deepEqual(safeStatus.rapidCapture.workflowHistory.map((event) => event.state), ["front_captured", "front_processing"]);
  assert.equal(safeStatus.rapidCapture.humanConfirmationRequired, true);
  assert.equal(safeStatus.rapidCapture.autoConfirm, false);
  assert.equal(safeStatus.rapidCapture.autoPublish, false);
  assert.equal(safeStatus.rapidCaptureQueue.items[0]?.state, "report_ready_needs_confirm");
  assert.equal(safeStatus.rapidCaptureQueue.items[0]?.humanConfirmationRequired, true);
  assert.equal(safeStatus.rapidCaptureQueue.items[0]?.autoConfirmed, false);
  assert.equal(safeStatus.rapidCaptureQueue.items[0]?.autoPublished, false);
  assert.equal(safeStatus.rapidCaptureQueue.items[0]?.error, undefined);
  assert.equal(safeStatus.geometryCaptureDecisions.front?.mode, "manual_capture");
  assert.equal(safeStatus.geometryCaptureDecisions.front?.manualOverrideUsed, true);
  assert.deepEqual(safeStatus.geometryCaptureDecisions.front?.manualBoundaryRect, { x: 120, y: 80, width: 960, height: 1500 });
  assert.equal(safeStatus.geometryCaptureDecisions.back?.mode, "detected_geometry");
  assert.equal(Object.prototype.hasOwnProperty.call(safeStatus, "fallbackUsed"), false);
  const displayedRapidStatus = JSON.stringify({ rapidCapture: safeStatus.rapidCapture, rapidCaptureQueue: safeStatus.rapidCaptureQueue });
  assert.doesNotMatch(displayedRapidStatus, /C:\\TenKings|manifestPath|stationToken|private-token/i);

  const unguardedFast = sanitizeAiGraderLocalStationStatusForDisplay({
    ...fast,
    captureProfileGuard: { ...fast.captureProfileGuard, selectionSource: "bridge_default" },
  });
  assert.equal(unguardedFast.captureProfile, "full_forensic");
  assert.equal(unguardedFast.captureProfileGuard.productionFastOptIn, false);
});

test("capture timing accepts only path-free V1 metadata and fails closed on five-second proof", () => {
  const timestamp = "2026-07-10T12:00:00.000Z";
  const rawTiming = {
    schemaVersion: AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION,
    captureProfile: "production_fast",
    targetSideMs: 1,
    hardwareMeasurement: true,
    events: [
      { id: "session_started", at: timestamp, localPath: "C:\\TenKings\\private\\session.json" },
      { id: "capture_trigger", at: timestamp, side: "front", triggerMode: "auto", stationToken: "private-token" },
      { id: "preview_ready", at: timestamp, side: "sideways", triggerMode: "machine", bridgeUrl: "http://127.0.0.1:47652" },
      { id: "unknown_event", at: timestamp },
      { id: "report_ready", at: "not-a-timestamp" },
    ],
    phases: [
      {
        id: "frame_capture",
        side: "front",
        durationMs: 1899.96,
        startedAt: timestamp,
        finishedAt: "2026-07-10T12:00:01.900Z",
        manifestPath: "C:\\TenKings\\private\\manifest.json",
      },
      { id: "file_writes", side: "back", durationMs: 2100, presignedUrl: "https://storage.example/object?X-Amz-Signature=secret" },
      { id: "crop_deskew", durationMs: -1 },
      { id: "unknown_phase", durationMs: 10 },
      { id: "report_generation", durationMs: Number.POSITIVE_INFINITY },
    ],
    summary: {
      previewReadyMs: 240.04,
      frontEdgeDetectionReadyMs: 410,
      backEdgeDetectionReadyMs: 390,
      totalFrontMs: 4800,
      totalBackMs: 4900,
      frontProcessingDuringFlipMs: 1300,
      frontProcessingOverlappedFlip: true,
      reportGenerationMs: -2,
      backProcessingMs: Number.NaN,
      totalCardMs: 5100,
      reportReadyTotalMs: 12000,
      localPath: "C:\\TenKings\\private\\timing.json",
      stationToken: "private-token",
    },
    target: {
      frontWithinTarget: true,
      backWithinTarget: true,
      fiveSecondsPerSideProven: true,
      hardwareMeasurementRequired: true,
      note: "See http://127.0.0.1:47652/private/timing and stationToken=private-token.",
      manifestPath: "C:\\TenKings\\private\\manifest.json",
    },
    bridgeUrl: "http://127.0.0.1:47652",
    stationToken: "private-token",
  };

  const safe = sanitizeAiGraderCaptureTiming(rawTiming);
  assert.equal(safe.schemaVersion, AI_GRADER_CAPTURE_TIMING_SCHEMA_VERSION);
  assert.equal(safe.captureProfile, "production_fast");
  assert.equal(safe.targetSideMs, 5000);
  assert.equal(safe.hardwareMeasurement, true);
  assert.deepEqual(safe.events.map((event) => event.id), ["session_started", "capture_trigger", "preview_ready"]);
  assert.equal(safe.events[1]?.side, "front");
  assert.equal(safe.events[1]?.triggerMode, "auto");
  assert.equal(safe.events[2]?.side, undefined);
  assert.equal(safe.events[2]?.triggerMode, undefined);
  assert.deepEqual(safe.phases.map((phase) => phase.id), ["frame_capture", "file_writes"]);
  assert.equal(safe.phases[0]?.durationMs, 1900);
  assert.equal(safe.summary.previewReadyMs, 240);
  assert.equal(safe.summary.totalFrontMs, 4800);
  assert.equal(safe.summary.totalBackMs, 4900);
  assert.equal(safe.summary.reportGenerationMs, undefined);
  assert.equal(safe.summary.backProcessingMs, undefined);
  assert.equal(safe.summary.totalCardMs, 5100);
  assert.equal(safe.summary.reportReadyTotalMs, 12000);
  assert.equal(safe.summary.frontProcessingOverlappedFlip, true);
  assert.equal(safe.target.frontWithinTarget, true);
  assert.equal(safe.target.backWithinTarget, true);
  assert.equal(safe.target.fiveSecondsPerSideProven, true);
  assert.equal(safe.target.hardwareMeasurementRequired, false);
  assert.match(safe.target.note, /recorded hardware run/i);
  const displayedTiming = JSON.stringify(safe);
  assert.doesNotMatch(displayedTiming, /C:\\TenKings|manifestPath|stationToken|private-token|127\.0\.0\.1|bridgeUrl|presignedUrl|X-Amz/i);

  assert.equal(
    sanitizeAiGraderCaptureTiming({ ...rawTiming, hardwareMeasurement: false }).target.fiveSecondsPerSideProven,
    false
  );
  assert.equal(
    sanitizeAiGraderCaptureTiming({ ...rawTiming, target: { ...rawTiming.target, frontWithinTarget: false } }).target.fiveSecondsPerSideProven,
    false
  );
  assert.equal(
    sanitizeAiGraderCaptureTiming({ ...rawTiming, target: { ...rawTiming.target, fiveSecondsPerSideProven: false } }).target.fiveSecondsPerSideProven,
    false
  );
  const invalidSchema = sanitizeAiGraderCaptureTiming({ ...rawTiming, schemaVersion: "future-v2" });
  assert.equal(invalidSchema.captureProfile, "full_forensic");
  assert.equal(invalidSchema.hardwareMeasurement, false);
  assert.equal(invalidSchema.target.fiveSecondsPerSideProven, false);

  const fastStatus = buildAiGraderLocalStationStatus({ captureProfile: "production_fast" });
  const sanitizedStatus = sanitizeAiGraderLocalStationStatusForDisplay({
    ...fastStatus,
    captureTiming: rawTiming as unknown as typeof fastStatus.captureTiming,
  });
  assert.equal(sanitizedStatus.captureTiming.captureProfile, "production_fast");
  assert.equal(sanitizedStatus.captureTiming.target.fiveSecondsPerSideProven, true);
  assert.equal(sanitizedStatus.captureProfileGuard.fiveSecondTargetProven, true);
  const coldDebugStatus = sanitizeAiGraderLocalStationStatusForDisplay({
    ...fastStatus,
    executionPath: "cold_command_fallback",
    explicitColdDebugModeUsed: true,
    captureTiming: rawTiming as unknown as typeof fastStatus.captureTiming,
  });
  assert.equal(coldDebugStatus.captureProfileGuard.fiveSecondTargetProven, false);
});

test("local station action parser accepts known actions and rejects unknown actions", () => {
  assert.equal(parseAiGraderStationAction(["capture-front"]), "capture-front");
  assert.equal(parseAiGraderStationAction(["export-report-bundle"]), "export-report-bundle");
  assert.equal(parseAiGraderStationAction(["calculate-final-grade"]), "calculate-final-grade");
  assert.equal(parseAiGraderStationAction(["finalize-report"]), "finalize-report");
  assert.equal(parseAiGraderStationAction(["generate-label-data"]), "generate-label-data");
  assert.equal(parseAiGraderStationAction(["confirm-fixture-rulers"]), "confirm-fixture-rulers");
  assert.equal(parseAiGraderStationAction(["cancel-session"]), "cancel-session");
  assert.equal(parseAiGraderStationAction(["configure-rapid-capture"]), "configure-rapid-capture");
  assert.equal(parseAiGraderStationAction(["queue-current-card"]), "queue-current-card");
  assert.equal(parseAiGraderStationAction(["activate-queue-item"]), "activate-queue-item");
  assert.equal(parseAiGraderStationAction(undefined), "status");
  assert.equal(parseAiGraderStationAction(["delete-all"]), null);
});

test("local station API returns status without admin session or DB service", async () => {
  const res = mockResponse();
  await aiGraderLocalStationHandler(mockRequest("GET", ["status"]), res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; operation: string; result: ReturnType<typeof buildAiGraderLocalStationStatus> };
  assert.equal(body.ok, true);
  assert.equal(body.operation, "status");
  assert.equal(body.result.localOnly, true);
  assert.equal(body.result.safety.databaseWrites, false);
  assert.equal(body.result.safety.hardwareAccessed, false);
});

test("local station API models capture-front transition and method gating", async () => {
  const postRes = mockResponse();
  await aiGraderLocalStationHandler(mockRequest("POST", ["capture-front"]), postRes);
  assert.equal(postRes.statusCodeValue, 200);
  const body = postRes.jsonBody as { result: ReturnType<typeof buildAiGraderLocalStationStatus> };
  assert.equal(body.result.currentStep, "prompt_flip_card");
  assert.equal(body.result.sessionManifest.frontCaptured, true);
  assert.equal(body.result.sessionManifest.backCaptured, false);

  const getRes = mockResponse();
  await aiGraderLocalStationHandler(mockRequest("GET", ["capture-front"]), getRes);
  assert.equal(getRes.statusCodeValue, 405);
  assert.equal(getRes.headers.Allow, "POST");
});

test("sample public report bundle keeps provisional-only safety flags", () => {
  assert.equal(SAMPLE_AI_GRADER_REPORT_BUNDLE.reportStatus, "provisional_diagnostic_ready");
  assert.equal(SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade?.overall, 8.5);
  assert.equal(SAMPLE_AI_GRADER_REPORT_BUNDLE.visionLab.available, true);
  assert.equal(hasNoFinalCertifiedClaims(SAMPLE_AI_GRADER_REPORT_BUNDLE), true);
  assert.match(SAMPLE_AI_GRADER_REPORT_BUNDLE.limitations.join(" "), /No QR Certificate Yet/);
});

test("unknown generated report ids do not reuse fixture report data", () => {
  const bundle = getAiGraderReportBundle("ai-grader-prod-smoke-missing-storage");

  assert.equal(bundle.reportId, "ai-grader-prod-smoke-missing-storage");
  assert.equal(bundle.reportStatus, "missing_report_data");
  assert.equal(bundle.visionLab.available, false);
  assert.equal(bundle.provisionalGrade, undefined);
  assert.equal(bundle.reportHtmlPath, undefined);
  assert.equal(bundle.evidenceReferences.frontPackageDir, undefined);
  assert.equal(bundle.evidenceReferences.backPackageDir, undefined);
  assert.match(bundle.limitations.join(" "), /No fixture\/sample data/);
  assert.equal(hasNoCertifiedClaim(bundle), true);
});

test("missing report route params do not render sample AI Grader report data", () => {
  const bundle = getAiGraderReportBundle(undefined);

  assert.equal(bundle.reportId, "missing-report-data");
  assert.equal(bundle.reportStatus, "missing_report_data");
  assert.equal(bundle.provisionalGrade, undefined);
  assert.equal(bundle.visionLab.available, false);
  assert.match(bundle.limitations.join(" "), /No fixture\/sample data/);
});

test("sample final report bundle exposes final V0 data without certified claim", () => {
  const bundle = getAiGraderReportBundle("sample-final-v0");

  assert.equal(bundle.reportStatus, "final_ai_grader_report_v0");
  assert.equal(bundle.finalGradeComputed, true);
  assert.equal(bundle.labelGenerated, true);
  assert.equal(bundle.qrGenerated, true);
  assert.equal(bundle.productionRelease?.label.status, "label_data_ready");
  assert.equal(bundle.productionRelease?.publication.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(hasNoCertifiedClaim(bundle), true);
});

test("production release fixture reserves label and QR URL but does not perform DB or storage writes", () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);

  assert.equal(release.finalGradeComputed, true);
  assert.equal(release.certifiedClaim, false);
  assert.equal(release.certificateGenerated, false);
  assert.equal(release.label.qrPayloadUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(release.publication.dbWritesPerformed, false);
  assert.equal(release.publication.uploadPerformed, false);
  assert.equal(release.databaseIntegration.existingModels.includes("AiGraderReport"), true);
  assert.equal(release.databaseIntegration.migrationsAdded, true);
  assert.equal(release.slabbedPhotoContract.status, "reserved_not_uploaded");
  assert.equal(release.ebayCompsContract.status, "not_run");
  assert.equal(release.cardInventoryLinkage.status, "contract_ready_not_persisted");
});

for (const operatorAction of ["Confirm Card", "Publish"] as const) {
  test(`${operatorAction} treats a fetched bridge bundle without a release as authoritative and explicitly finalizes`, async () => {
    const baseRelease = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
    const staleRelease = {
      ...baseRelease,
      generatedAt: "2026-07-11T10:00:00.000Z",
      operatorFinalization: {
        ...baseRelease.operatorFinalization,
        operatorId: "stale-browser-release",
      },
    };
    const verifiedRelease = {
      ...baseRelease,
      generatedAt: "2026-07-11T11:00:00.000Z",
      operatorFinalization: {
        ...baseRelease.operatorFinalization,
        operatorId: "explicitly-finalized-release",
      },
    };
    const cachedBundle = {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      productionRelease: staleRelease,
    };
    const recoveredBundle = {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      productionRelease: undefined,
    };
    const finalizedBundle = {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      productionRelease: verifiedRelease,
    };
    const initialStatus = {
      latestReport: { reportId: SAMPLE_AI_GRADER_REPORT_BUNDLE.reportId },
      reportBundle: cachedBundle,
      productionRelease: staleRelease,
    };
    const finalizedStatus = {
      latestReport: { reportId: SAMPLE_AI_GRADER_REPORT_BUNDLE.reportId },
      reportBundle: finalizedBundle,
      productionRelease: verifiedRelease,
    };
    const events: string[] = [];
    let fetchCount = 0;

    const resolved = await resolveAiGraderAuthoritativeProductionPackage({
      initialStatus,
      async fetchBridgeBundle(reportId) {
        assert.equal(reportId, SAMPLE_AI_GRADER_REPORT_BUNDLE.reportId);
        fetchCount += 1;
        events.push(`fetch-${fetchCount}`);
        return fetchCount === 1 ? recoveredBundle : finalizedBundle;
      },
      async explicitlyFinalize() {
        events.push("explicit-finalize");
        return finalizedStatus;
      },
    });

    assert.deepEqual(events, ["fetch-1", "explicit-finalize", "fetch-2"]);
    assert.equal(resolved.bridgeBundleFetched, true);
    assert.equal(resolved.sourceBundle, finalizedBundle);
    assert.equal(resolved.productionRelease, verifiedRelease);
    const submittedPayload = JSON.stringify({
      action: operatorAction,
      reportBundle: resolved.sourceBundle,
      productionRelease: resolved.productionRelease,
    });
    assert.match(submittedPayload, /explicitly-finalized-release/);
    assert.doesNotMatch(submittedPayload, /stale-browser-release/);
  });
}

test("cached production release is eligible only when no bridge fetch callback is available", async () => {
  const baseRelease = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const cachedRelease = {
    ...baseRelease,
    operatorFinalization: {
      ...baseRelease.operatorFinalization,
      operatorId: "offline-cached-release",
    },
  };
  let explicitFinalizeCalls = 0;

  const resolved = await resolveAiGraderAuthoritativeProductionPackage({
    initialStatus: {
      latestReport: { reportId: SAMPLE_AI_GRADER_REPORT_BUNDLE.reportId },
      reportBundle: {
        ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
        productionRelease: undefined,
      },
      productionRelease: cachedRelease,
    },
    async explicitlyFinalize() {
      explicitFinalizeCalls += 1;
      throw new Error("A finalized cached release must not be recalculated without a bridge fetch.");
    },
  });

  assert.equal(resolved.bridgeBundleFetched, false);
  assert.equal(resolved.productionRelease, cachedRelease);
  assert.equal(explicitFinalizeCalls, 0);
});

test("normal AI Grader operator workflow hides internal pipeline buttons", () => {
  assert.deepEqual([...AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS], [
    "Review Report",
    "Publish to Ten Kings",
    "View Public Report",
    "Print Label",
    "Run eBay Comps",
    "Card History Reports",
  ]);
  assert.equal(AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS.includes("Calculate Final Grade" as any), false);
  assert.equal(AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS.includes("Finalize / Publish" as any), false);
  assert.equal(AI_GRADER_NORMAL_OPERATOR_ACTION_LABELS.includes("Publish to Ten Kings System" as any), false);
});

test("AI Grader publish readiness holds public links until hosted publish succeeds", () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: release.reportId,
    reportStatus: "final_ai_grader_report_v0" as const,
    finalStatus: "final_grade_computed" as const,
    finalGradeComputed: true,
    labelGenerated: true,
    qrGenerated: true,
    productionRelease: release,
  };
  const readiness = buildAiGraderPublishReadiness({ bundle: finalBundle, productionRelease: release });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.publicReportUrl, undefined);
  assert.equal(readiness.qrPayloadUrl, undefined);
  assert.equal(readiness.labelPreviewUrl, undefined);
  assert.equal(readiness.certId, release.label.certId);

  const publishedReadiness = buildAiGraderPublishReadiness({ bundle: finalBundle, productionRelease: release, published: true });
  assert.equal(publishedReadiness.ready, true);
  assert.equal(publishedReadiness.status, "published");
  assert.equal(publishedReadiness.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(publishedReadiness.qrPayloadUrl, publishedReadiness.publicReportUrl);
  assert.equal(publishedReadiness.labelPreviewUrl, "https://collect.tenkings.co/ai-grader/labels/sample-final-v0");
  assert.equal(publishedReadiness.certId, release.label.certId);
});

test("insufficient evidence AI Grader reports cannot be published", () => {
  const blockedBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportStatus: "insufficient_evidence" as const,
    finalStatus: "insufficient_evidence" as const,
    finalGradeComputed: false,
    provisionalGrade: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade,
      overall: undefined,
      gates: {
        requiredGatesPassed: false,
        results: [
          {
            gate: "clipping",
            status: "fail",
            summary: "Maximum clipped fraction is 0.99; soft target is 0.02.",
            evidenceRefs: ["analysis.back.allOn.clippedPixelFraction"],
          },
        ],
        blockers: ["clipping: Maximum clipped fraction is 0.99; soft target is 0.02."],
        acceptedWarnings: [],
      },
    },
  };
  const readiness = buildAiGraderPublishReadiness({ bundle: blockedBundle });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, "not_ready_insufficient_evidence");
  assert.match(readiness.message, /insufficient evidence/i);
  assert.equal(readiness.failedGates[0]?.id, "clipping");
  assert.match(readiness.failedGates[0]?.reason ?? "", /0\.99/);
});

test("AI Grader comps readiness requires final grade and card identity", () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    finalGradeComputed: true,
    productionRelease: release,
  };

  assert.equal(buildAiGraderCompsReadiness({ bundle: SAMPLE_AI_GRADER_REPORT_BUNDLE }).status, "not_ready_missing_grade");
  assert.equal(
    buildAiGraderCompsReadiness({
      bundle: { ...finalBundle, cardIdentity: { ...finalBundle.cardIdentity, title: undefined, set: undefined, cardNumber: undefined } },
      productionRelease: release,
    }).status,
    "not_ready_missing_identity"
  );
  assert.equal(buildAiGraderCompsReadiness({ bundle: finalBundle, productionRelease: release }).status, "ready");
  assert.equal(buildAiGraderLabelPreviewUrl("report-1"), "https://collect.tenkings.co/ai-grader/labels/report-1");
});

test("production publication API is disabled by default and does not require DB access", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {},
    async requireAdminSession() {
      adminCalled = true;
      throw new Error("admin should not be loaded while disabled");
    },
    publicUrlFor: (storageKey) => `/uploads/cards/${storageKey}`,
    async presignUpload() {
      throw new Error("upload should not run while disabled");
    },
    async persist() {
      throw new Error("persist should not run while disabled");
    },
  });

  const statusRes = mockResponse();
  await handler(mockRequest("GET", ["status"]), statusRes);
  assert.equal(statusRes.statusCodeValue, 200);
  assert.equal((statusRes.jsonBody as { enabled: boolean }).enabled, false);

  const publishRes = mockResponse();
  await handler(mockRequest("POST", ["publish-init"]), publishRes);
  assert.equal(publishRes.statusCodeValue, 503);
  assert.equal(adminCalled, false);
});

test("production publication API route keeps Vercel request bodies platform-safe", () => {
  assert.equal(aiGraderProductionRouteConfig.api.bodyParser.sizeLimit, "1mb");
  assert.equal(aiGraderProductionRouteConfig.maxDuration, 60);
});

test("production AI Grader route binds direct uploads to the storage-provider SHA-256 checksum", () => {
  const routePath =
    [
      path.join(process.cwd(), "pages", "api", "admin", "ai-grader", "production", "[...action].ts"),
      path.join(process.cwd(), "frontend", "nextjs-app", "pages", "api", "admin", "ai-grader", "production", "[...action].ts"),
    ].find((candidate) => fs.existsSync(candidate));
  assert.ok(routePath);
  const routeSource = fs.readFileSync(routePath, "utf8");
  assert.equal(routeSource.includes("presignUploadUrl(storageKey, contentType, {"), true);
  assert.equal(routeSource.includes("checksumSha256,"), true);
  assert.equal(routeSource.includes("x-amz-meta-sha256"), false);
  assert.equal(routeSource.includes("x-amz-checksum-sha256"), true);
  assert.equal(routeSource.includes("verifyStorageObjectIntegrity({"), true);
  assert.equal(routeSource.includes("head.metadata"), false);
  assert.equal(routeSource.includes('"Content-Type": contentType'), true);
  assert.equal(routeSource.includes('"x-amz-acl"'), true);

  const storagePath =
    [
      path.join(process.cwd(), "lib", "server", "storage.ts"),
      path.join(process.cwd(), "frontend", "nextjs-app", "lib", "server", "storage.ts"),
    ].find((candidate) => fs.existsSync(candidate));
  assert.ok(storagePath);
  const storageSource = fs.readFileSync(storagePath, "utf8");
  assert.equal(storageSource.includes("ChecksumSHA256: options.checksumSha256"), true);
  assert.equal(storageSource.includes("unhoistableHeaders"), true);
  assert.equal(storageSource.includes("Metadata: options.metadata"), false);
  assert.equal(storageSource.includes('ChecksumMode: "ENABLED"'), true);
  assert.equal(storageSource.includes("sha256Base64ToHex(response.ChecksumSHA256)"), true);
});

test("server upload plans allow only the exact native checksum and safe signed headers", () => {
  const checksumSha256 = sha256Hex("server-upload-plan");
  const checksumBase64 = sha256Base64FromHex(checksumSha256);
  const sanitized = sanitizeAiGraderUploadHeadersForResponse({
    "Content-Type": "image/png",
    "x-amz-acl": "public-read",
    "x-amz-meta-sha256": "forbidden",
    "x-amz-checksum-sha256": checksumBase64,
    "x-unsafe-extra": "forbidden",
  }, checksumSha256);
  assert.deepEqual(sanitized, {
    "Content-Type": "image/png",
    "x-amz-acl": "public-read",
    "x-amz-checksum-sha256": checksumBase64,
  });
  const invalidPlans = [
    { "Content-Type": "image/png" },
    { "Content-Type": "image/png", "x-amz-checksum-sha256": sha256Base64FromHex("0".repeat(64)) },
    {
      "Content-Type": "image/png",
      "x-amz-checksum-sha256": checksumBase64,
      "X-Amz-Checksum-Sha256": checksumBase64,
    },
  ];
  for (const headers of invalidPlans) {
    assert.throws(
      () => sanitizeAiGraderUploadHeadersForResponse(headers as Record<string, string>, checksumSha256),
      (error: any) =>
        error.code === "AI_GRADER_UPLOAD_CHECKSUM_HEADER_INVALID" &&
        error.message === "AI Grader direct upload checksum header is missing or invalid." &&
        !/https?:|token|credential|storage key/i.test(error.message),
    );
  }
});

test("Publish init rejects missing, cross-tenant, and mismatched durable linkage before storage planning", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const cases: Array<{
    name: string;
    mutateBody?: (body: any) => void;
    authorityOverride?: Record<string, unknown>;
  }> = [
    { name: "missing CardAsset", mutateBody: (body) => { delete body.cardAssetId; } },
    { name: "missing Item", mutateBody: (body) => { delete body.itemId; } },
    { name: "mismatched report", mutateBody: (body) => { body.reportId = "other-report"; } },
    { name: "mismatched grading session", mutateBody: (body) => { body.gradingSessionId = "other-session"; } },
    { name: "mismatched request certificate", mutateBody: (body) => { body.certId = "TKAI-TAMPERED-CERT"; } },
    { name: "cross tenant", authorityOverride: { tenantId: "other-tenant" } },
    { name: "durable report mismatch", authorityOverride: { reportId: "other-report" } },
    { name: "durable session mismatch", authorityOverride: { gradingSessionId: "other-session" } },
    { name: "durable CardAsset mismatch", authorityOverride: { cardAssetId: "other-card" } },
    { name: "durable Item mismatch", authorityOverride: { itemId: "other-item" } },
  ];
  for (const scenario of cases) {
    const calls = { authority: 0, plan: 0, presign: 0, verify: 0, persist: 0 };
    const handler = createAiGraderProductionApiHandler({
      env: {
        [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
        AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
      },
      async requireAdminSession() {
        return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
      },
      publicUrlFor(storageKey) {
        calls.plan += 1;
        return "https://cdn.tenkings.test/" + storageKey;
      },
      async resolvePublishAuthority(input) {
        calls.authority += 1;
        return { ...durablePublishAuthority(input), ...(scenario.authorityOverride ?? {}) } as any;
      },
      async presignUpload(input) {
        calls.presign += 1;
        return presignForTest(input);
      },
      async verifyUploadedArtifact() {
        calls.verify += 1;
        throw new Error("linkage rejection must precede storage verification");
      },
      async persist() {
        calls.persist += 1;
        throw new Error("linkage rejection must precede persistence");
      },
    });
    const body = publishRequestBody(reportBundle, productionRelease);
    scenario.mutateBody?.(body);
    const req = mockRequest("POST", ["publish-init"]);
    req.body = body;
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCodeValue, 400, scenario.name);
    assert.equal(calls.plan, 0, scenario.name);
    assert.equal(calls.presign, 0, scenario.name);
    assert.equal(calls.verify, 0, scenario.name);
    assert.equal(calls.persist, 0, scenario.name);
  }
});

test("Publish init rejects incomplete or contradictory label and QR readiness before presign", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const cases = [
    { name: "label flag missing", release: { ...productionRelease, labelDataGenerated: false } },
    { name: "QR flag missing", release: { ...productionRelease, qrPayloadGenerated: false } },
    {
      name: "contradictory label status",
      release: {
        ...productionRelease,
        label: { ...productionRelease.label, status: "blocked_insufficient_evidence" },
      },
    },
  ];
  for (const scenario of cases) {
    let authorityCalls = 0;
    let presignCalls = 0;
    let persistCalls = 0;
    const handler = createAiGraderProductionApiHandler({
      env: {
        [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
        AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
      },
      async requireAdminSession() {
        return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
      },
      publicUrlFor: (storageKey) => "https://cdn.tenkings.test/" + storageKey,
      async resolvePublishAuthority(input) {
        authorityCalls += 1;
        return durablePublishAuthority(input);
      },
      async presignUpload(input) {
        presignCalls += 1;
        return presignForTest(input);
      },
      async persist() {
        persistCalls += 1;
        throw new Error("invalid readiness must not persist");
      },
    });
    const req = mockRequest("POST", ["publish-init"]);
    req.body = publishRequestBody(reportBundle, scenario.release);
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCodeValue, 400, scenario.name);
    assert.equal((res.jsonBody as any).code, "AI_GRADER_PUBLISH_LABEL_NOT_READY", scenario.name);
    assert.equal(authorityCalls, 0, scenario.name);
    assert.equal(presignCalls, 0, scenario.name);
    assert.equal(persistCalls, 0, scenario.name);
  }
});

test("Publish init rejects every immutable Confirm-authority mutation before planning or side effects", async () => {
  const source = sampleConfirmReadyPackage();
  const authority = durablePublishAuthority({
    tenantId: "tenant-1",
    reportId: source.reportBundle.reportId,
    gradingSessionId: source.reportBundle.gradingSessionId,
    cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
    itemId: TEST_PUBLISH_ITEM_ID,
  }, source);
  const mutations: Array<{ name: string; mutate: (body: any) => void }> = [
    {
      name: "certificate identity",
      mutate: (body) => { body.productionRelease.label.certId = "TKAI-TAMPERED-CERT"; },
    },
    {
      name: "corners element score",
      mutate: (body) => { body.productionRelease.finalGrade.elements.corners.score = 7.5; },
    },
    {
      name: "edges element score",
      mutate: (body) => { body.productionRelease.finalGrade.elements.edges.score = 7.5; },
    },
    {
      name: "surface element score",
      mutate: (body) => { body.productionRelease.finalGrade.elements.surface.score = 7.5; },
    },
    {
      name: "grade confidence",
      mutate: (body) => { body.productionRelease.finalGrade.confidence.score = 0.42; },
    },
    {
      name: "grade impact reasons",
      mutate: (body) => {
        body.productionRelease.finalGrade.gradeImpactReasons = [{
          id: "tampered-impact",
          title: "Changed impact",
          severity: "minor",
          confidence: "medium",
          explanation: "Changed after Confirm Card.",
          evidenceRefs: ["visionLab"],
        }];
      },
    },
    {
      name: "why not 10",
      mutate: (body) => {
        body.productionRelease.finalGrade.whyNot10 = [{
          id: "tampered-why-not-10",
          title: "Changed explanation",
          explanation: "Changed after Confirm Card.",
          evidenceRefs: ["visionLab"],
        }];
      },
    },
    {
      name: "gate status",
      mutate: (body) => {
        const gate = body.productionRelease.gates[0];
        gate.status = "accepted_warning";
        body.productionRelease.operatorFinalization.warningsAccepted = true;
        body.productionRelease.operatorFinalization.acceptedWarningGateIds = Array.from(new Set([
          ...body.productionRelease.operatorFinalization.acceptedWarningGateIds,
          gate.id,
        ]));
      },
    },
    {
      name: "gate reason",
      mutate: (body) => { body.productionRelease.gates[0].reason = "Changed after Confirm Card."; },
    },
    {
      name: "gate evidence references",
      mutate: (body) => { body.productionRelease.gates[0].evidenceRefs = ["visionLab", "assets"]; },
    },
    {
      name: "warnings",
      mutate: (body) => { body.reportBundle.warnings = [...(body.reportBundle.warnings ?? []), "Changed warning"]; },
    },
    {
      name: "operator finalization",
      mutate: (body) => { body.productionRelease.operatorFinalization.overrideReason = "Changed after Confirm Card."; },
    },
    {
      name: "label version",
      mutate: (body) => { body.productionRelease.label.labelVersion = "ten-kings-ai-grader-label-tampered"; },
    },
    {
      name: "missing report claim flag",
      mutate: (body) => { delete body.reportBundle.certifiedClaim; },
    },
    {
      name: "missing release claim flag",
      mutate: (body) => { delete body.productionRelease.certifiedClaim; },
    },
    {
      name: "missing release certificate flag",
      mutate: (body) => { delete body.productionRelease.certificateGenerated; },
    },
    {
      name: "missing label claim flag",
      mutate: (body) => { delete body.productionRelease.label.certifiedClaim; },
    },
    {
      name: "label element scores",
      mutate: (body) => { body.productionRelease.label.elementScores.corners = 7.5; },
    },
    {
      name: "finding validation",
      mutate: (body) => { body.reportBundle.visionLab.findingValidation.reviewNote = "Changed after Confirm Card."; },
    },
    {
      name: "defect findings",
      mutate: (body) => {
        const trueViewAssetId = body.reportBundle.assets[0].id;
        const finding = {
          schemaVersion: "ai-grader-defect-finding-v1",
          findingId: "dfv1_1234567890abcdef12345678",
          side: "front",
          category: "surface_anomaly",
          detector: { id: "surface-v1", version: "1.0.0", captureProfileVersion: "fixed-rig-v1" },
          severity: { score: 25, band: "low" },
          confidence: 0.75,
          review: { status: "unreviewed" },
          geometry: {
            coordinateFrame: "normalized_card",
            units: "fraction",
            shape: { type: "box", x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
          },
          evidence: { trueViewAssetId, channelAssetIds: [], roiAssetIds: [] },
          explanation: "Changed after Confirm Card.",
        };
        body.reportBundle.visionLab.defectFindings = [finding];
        body.reportBundle.visionLab.candidateCount = 1;
        body.reportBundle.visionLab.findingValidation = {
          status: "valid",
          sourceCandidateCount: 1,
          publishedFindingCount: 1,
          issues: [],
        };
        body.reportBundle.defectFindings = [finding];
      },
    },
    {
      name: "normalized evidence hash",
      mutate: (body) => {
        body.reportBundle.assets[0].checksumSha256 = "f".repeat(64);
        body.reportBundle.assets[0].sha256 = "f".repeat(64);
      },
    },
    {
      name: "normalized evidence dimensions",
      mutate: (body) => { body.reportBundle.assets[0].widthPx = 1199; },
    },
    {
      name: "normalized evidence side",
      mutate: (body) => { body.reportBundle.assets[0].side = "back"; },
    },
    {
      name: "normalized evidence role",
      mutate: (body) => { body.reportBundle.assets[0].evidenceRole = "surface_heatmap"; },
    },
    {
      name: "report producer contract",
      mutate: (body) => { body.reportBundle.reportProducer.contractVersion = "ai-grader-report-producer-v0.3"; },
    },
    {
      name: "report producer capabilities",
      mutate: (body) => { body.reportBundle.reportProducer.capabilities = [...body.reportBundle.reportProducer.capabilities, "tampered-v1"]; },
    },
    {
      name: "evidence references",
      mutate: (body) => { body.reportBundle.evidenceReferences = { changedAfterConfirm: true }; },
    },
  ];

  for (const scenario of mutations) {
    const calls = { plan: 0, presign: 0, verify: 0, persist: 0 };
    const handler = createAiGraderProductionApiHandler({
      env: {
        [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
        AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
      },
      async requireAdminSession() {
        return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
      },
      publicUrlFor(storageKey) {
        calls.plan += 1;
        return "https://cdn.tenkings.test/" + storageKey;
      },
      async resolvePublishAuthority() {
        return authority;
      },
      async presignUpload() {
        calls.presign += 1;
        throw new Error("authority mismatch must fail before presign");
      },
      async verifyUploadedArtifact() {
        calls.verify += 1;
        throw new Error("authority mismatch must fail before storage verification");
      },
      async persist() {
        calls.persist += 1;
        throw new Error("authority mismatch must fail before persistence");
      },
    });
    const body = structuredClone(publishRequestBody(source.reportBundle, source.productionRelease));
    scenario.mutate(body);
    const req = mockRequest("POST", ["publish-init"]);
    req.body = body;
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCodeValue, 409, scenario.name);
    assert.equal((res.jsonBody as any).code, "AI_GRADER_PUBLISH_PACKAGE_AUTHORITY_MISMATCH", scenario.name);
    assert.deepEqual(calls, { plan: 0, presign: 0, verify: 0, persist: 0 }, scenario.name);
  }
});

test("Publish init rejects a corrupt stored Confirm-authority digest before planning", async () => {
  const source = sampleConfirmReadyPackage();
  const authority = durablePublishAuthority({
    tenantId: "tenant-1",
    reportId: source.reportBundle.reportId,
    gradingSessionId: source.reportBundle.gradingSessionId,
    cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
    itemId: TEST_PUBLISH_ITEM_ID,
  }, source);
  authority.publishAuthority = { ...authority.publishAuthority, digestSha256: "0".repeat(64) };
  let planCalls = 0;
  let presignCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor(storageKey) {
      planCalls += 1;
      return "https://cdn.tenkings.test/" + storageKey;
    },
    async resolvePublishAuthority() {
      return authority;
    },
    async presignUpload() {
      presignCalls += 1;
      throw new Error("corrupt authority must fail before presign");
    },
    async persist() {
      throw new Error("corrupt authority must fail before persistence");
    },
  });
  const req = mockRequest("POST", ["publish-init"]);
  req.body = publishRequestBody(source.reportBundle, source.productionRelease);
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCodeValue, 409);
  assert.equal((res.jsonBody as any).code, "AI_GRADER_PUBLISH_PACKAGE_AUTHORITY_MISMATCH");
  assert.equal(planCalls, 0);
  assert.equal(presignCalls, 0);
});

test("Publish init accepts current normalized grading without centering but rejects a missing required element", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const { centering: _uncomputedCentering, ...normalizedElements } = productionRelease.finalGrade.elements;
  const normalizedRelease = {
    ...productionRelease,
    finalGrade: {
      ...productionRelease.finalGrade,
      elements: normalizedElements,
    },
  };
  let successfulPresigns = 0;
  const successHandler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => "https://cdn.tenkings.test/" + storageKey,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, normalizedRelease),
    async presignUpload(input) {
      successfulPresigns += 1;
      return presignForTest(input);
    },
    async persist() {
      throw new Error("publish-init should not persist");
    },
  });
  const successReq = mockRequest("POST", ["publish-init"]);
  successReq.body = publishRequestBody(reportBundle, normalizedRelease);
  const successRes = mockResponse();
  await successHandler(successReq, successRes);
  assert.equal(successRes.statusCodeValue, 200);
  assert.equal(successfulPresigns > 0, true);

  const { corners: _missingCorners, ...incompleteElements } = normalizedElements;
  let authorityCalls = 0;
  let failedPresigns = 0;
  const failureHandler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => "https://cdn.tenkings.test/" + storageKey,
    async resolvePublishAuthority(input) {
      authorityCalls += 1;
      return durablePublishAuthority(input);
    },
    async presignUpload(input) {
      failedPresigns += 1;
      return presignForTest(input);
    },
    async persist() {
      throw new Error("invalid grade must not persist");
    },
  });
  const failureReq = mockRequest("POST", ["publish-init"]);
  failureReq.body = publishRequestBody(reportBundle, {
    ...normalizedRelease,
    finalGrade: {
      ...normalizedRelease.finalGrade,
      elements: incompleteElements,
    },
  });
  const failureRes = mockResponse();
  await failureHandler(failureReq, failureRes);
  assert.equal(failureRes.statusCodeValue, 400);
  assert.equal((failureRes.jsonBody as any).code, "AI_GRADER_PUBLISH_FINAL_GRADE_REQUIRED");
  assert.equal(authorityCalls, 0);
  assert.equal(failedPresigns, 0);
});

test("production publication API rejects insufficient evidence reports before upload", async () => {
  const release = buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE);
  const blockedRelease = {
    ...release,
    reportStatus: "insufficient_evidence",
    finalStatus: "insufficient_evidence",
    finalGradeComputed: false,
    labelDataGenerated: false,
    qrPayloadGenerated: false,
    label: {
      ...release.label,
      status: "blocked_insufficient_evidence",
    },
  };
  let uploadCalled = false;
  let persistCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      uploadCalled = true;
      throw new Error("blocked report should not upload");
    },
    async persist() {
      persistCalled = true;
      throw new Error("blocked report should not persist");
    },
  });

  const blockedBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: blockedRelease.reportId,
    reportStatus: "insufficient_evidence",
    finalStatus: "insufficient_evidence",
    finalGradeComputed: false,
    productionRelease: blockedRelease,
  };
  const req = mockRequest("POST", ["publish-init"]);
  req.body = publishRequestBody(blockedBundle, blockedRelease);
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.equal(uploadCalled, false);
  assert.equal(persistCalled, false);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    code: "AI_GRADER_PUBLISH_FINAL_GRADE_REQUIRED",
    message: "Publish requires a complete valid final grade from the authoritative release.",
  });
});

test("legacy production publish action is rejected instead of accepting image bodies through Vercel", async () => {
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      throw new Error("legacy publish should reject before auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("legacy publish should not persist");
    },
  });

  const req = mockRequest("POST", ["publish"]);
  req.body = {
    publicationStatus: "published",
    reportBundle: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      assets: [{ bodyBase64: Buffer.from("front-image").toString("base64") }],
    },
    productionRelease: buildSampleAiGraderProductionRelease(SAMPLE_AI_GRADER_REPORT_BUNDLE),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 410);
  const body = res.jsonBody as { ok: boolean; code?: string; message?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "AI_GRADER_LEGACY_PUBLISH_REJECTED");
  assert.match(body.message ?? "", /publish-init/);
});

test("production publish init creates direct storage upload plan without embedded bodies", async () => {
  const calls: string[] = [];
  const currentPackage = sampleConfirmReadyPackage();
  const reportBundle = {
    ...currentPackage.reportBundle,
    publicAssets: undefined,
  } as any;
  const productionRelease = currentPackage.productionRelease;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      calls.push("admin");
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      assert.equal(Object.prototype.hasOwnProperty.call(input as Record<string, unknown>, "metadata"), false);
      calls.push(`presign:${input.storageKey}`);
      const presigned = presignForTest(input);
      return { ...presigned, uploadHeaders: {
        ...presigned.uploadHeaders,
        "x-amz-meta-sha256": "unsafe-future-regression",
      } };
    },
    async persist() {
      throw new Error("publish-init should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportId: reportBundle.reportId,
    certId: productionRelease.label.certId,
    gradingSessionId: reportBundle.gradingSessionId,
    reportBundle,
    productionRelease,
    assetManifest: { assets: reportBundle.assets },
    checksums: {
      checksums: reportBundle.assets?.map((asset: any) => ({
        id: asset.id,
        checksumSha256: asset.checksumSha256,
        byteSize: asset.byteSize,
      })),
    },
    cardAssetId: "card-asset-1",
    itemId: "item-1",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as {
    ok: boolean;
    result: {
      publishSessionId: string;
      storageKeyPrefix: string;
      uploadPlan: {
        artifacts: Array<{
          kind: string;
          artifactClass: string;
          body?: string;
          bodyBase64?: string;
          sourceAssetId?: string;
          uploadUrl: string;
          uploadHeaders: Record<string, string>;
          contentType: string;
          checksumSha256: string;
          byteSize: number;
          sourceImageWidthPx?: number;
          sourceImageHeightPx?: number;
        }>;
      };
      finalizeManifestShape: { uploadManifest: { artifacts: unknown[] } };
    };
  };
  assert.equal(body.ok, true);
  assert.match(body.result.publishSessionId, /^aigpub_/);
  assert.equal(body.result.storageKeyPrefix, "ai-grader/reports/sample-final-v0/");
  assert.equal(body.result.uploadPlan.artifacts.some((artifact) => artifact.artifactClass === "report_asset" && artifact.sourceAssetId), true);
  const reportAsset = body.result.uploadPlan.artifacts.find((artifact) => artifact.artifactClass === "report_asset");
  assert.equal(body.result.uploadPlan.artifacts.filter((artifact) => artifact.artifactClass === "report_asset").length, 2);
  assert.equal(reportAsset?.sourceImageWidthPx, 1200);
  assert.equal(reportAsset?.sourceImageHeightPx, 1680);
  for (const artifact of body.result.uploadPlan.artifacts) {
    assert.equal(artifact.uploadHeaders["Content-Type"], artifact.contentType);
    assert.equal(Object.prototype.hasOwnProperty.call(artifact.uploadHeaders, "x-amz-meta-sha256"), false);
    assert.equal(
      artifact.uploadHeaders["x-amz-checksum-sha256"],
      sha256Base64FromHex(artifact.checksumSha256),
    );
    assert.match(artifact.checksumSha256, /^[a-f0-9]{64}$/);
    assert.equal(Number.isInteger(artifact.byteSize) && artifact.byteSize > 0, true);
  }
  assert.equal(JSON.stringify(body).includes("bodyBase64"), false);
  assert.equal(JSON.stringify(body).includes("data:image"), false);
  assert.equal(JSON.stringify(body).includes("C:\\TenKings"), false);
  assert.ok(calls.some((call) => call.startsWith("presign:ai-grader/reports/sample-final-v0/report-bundle.json")));
  assert.ok(body.result.finalizeManifestShape.uploadManifest.artifacts.length >= 8);
});

test("production publish init fails closed when a report asset has no planned pixel dimensions", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  delete (reportBundle.assets?.[0] as { widthPx?: number }).widthPx;
  delete (reportBundle.assets?.[0] as { heightPx?: number }).heightPx;
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async persist() {
      throw new Error("dimensionless report assets must not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = publishRequestBody(reportBundle, productionRelease);
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.equal((res.jsonBody as { code?: string }).code, "AI_GRADER_REPORT_IMAGE_DIMENSIONS_REQUIRED");
  assert.match((res.jsonBody as { message?: string }).message ?? "", /source pixel dimensions/);
});

test("legacy v0.1 publish init remains fail-closed without the post-PR82 finding stamp", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  delete (reportBundle.visionLab as { defectFindings?: unknown }).defectFindings;
  delete (reportBundle.visionLab as { findingValidation?: unknown }).findingValidation;
  (reportBundle.visionLab as { candidateCount?: number }).candidateCount = 1;
  delete (reportBundle.assets?.[0] as { widthPx?: number }).widthPx;
  delete (reportBundle.assets?.[0] as { heightPx?: number }).heightPx;
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload() {
      throw new Error("unsafe legacy findings must fail before presign");
    },
    async persist() {
      throw new Error("publish init must not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = publishRequestBody(reportBundle, productionRelease);
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.match((res.jsonBody as { message?: string }).message ?? "", /gate|finding|extraction/i);
});

test("production publish init rejects bodyBase64, data URLs, local paths, bridge URLs, and token markers", async () => {
  const reportBundle = sampleStorageReadyReportBundle({
    assets: [
      {
        id: "front/front-all-on-portrait-display.png",
        kind: "image",
        fileName: "front-all-on-portrait-display.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(Buffer.from("front-image")),
        byteSize: Buffer.byteLength("front-image"),
        bodyBase64: Buffer.from("front-image").toString("base64"),
      } as any,
    ],
  });
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      throw new Error("unsafe payload should reject before auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("unsafe payload should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease: buildSampleAiGraderProductionRelease(reportBundle),
    stationToken: "must-not-send",
    bridgeUrl: "http://127.0.0.1:47652",
    preview: "data:image/png;base64,abc",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.match((res.jsonBody as { message?: string }).message ?? "", /Unsafe AI Grader publish payload/);
});

test("production publish init rejects private endpoints, signed URLs, and local paths embedded in prose", async () => {
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      throw new Error("embedded unsafe payload should reject before auth");
    },
    publicUrlFor: (storageKey) => "https://cdn.tenkings.test/" + storageKey,
    async persist() {
      throw new Error("embedded unsafe payload should not persist");
    },
  });
  const unsafeNotes = [
    "Bridge failed at http://127.0.0.1:3020/status?token=must-not-survive.",
    "Upload https://storage.example.test/object?X-Amz-Signature=must-not-survive failed.",
    "Runner failed while reading C:\\TenKings\\capture-data\\private\\manifest.json.",
    "Runner failed while reading /var/tmp/ai-grader/private.json.",
    "Dell bridge 127.0.0.1:3020 did not answer.",
    "Leimac 10.0.0.4:5000 did not answer.",
    "Station grader.local:47652 did not answer.",
  ];
  for (const operatorNotes of unsafeNotes) {
    const reportBundle = sampleStorageReadyReportBundle();
    const res = mockResponse();
    const req = mockRequest("POST", ["publish-init"]);
    req.body = {
      publicationStatus: "published",
      reportBundle,
      productionRelease: buildSampleAiGraderProductionRelease(reportBundle),
      operatorNotes,
    };
    await handler(req, res);
    assert.equal(res.statusCodeValue, 400, operatorNotes);
    assert.match((res.jsonBody as { message?: string }).message ?? "", /Unsafe AI Grader publish payload/);
  }
});

test("production publish finalize verifies upload manifest and persists DB records", async () => {
  let adminCalled = false;
  let persistedActorAudit: unknown = null;
  let persistedReportBundle: any = null;
  const reportBundle = sampleStorageReadyReportBundle();
  (reportBundle as any).captureTiming = {
    schemaVersion: "ten-kings-ai-grader-capture-timing-v1",
    captureProfile: "production_fast",
    targetSideMs: 5000,
    hardwareMeasurement: true,
    events: [],
    phases: [],
    summary: { totalFrontMs: 100, totalBackMs: 200, totalCardMs: 500, frontProcessingOverlappedFlip: true },
    target: {
      frontWithinTarget: true,
      backWithinTarget: true,
      fiveSecondsPerSideProven: true,
      hardwareMeasurementRequired: false,
      note: "caller-forged proof",
    },
  };
  (reportBundle as any).ocrPrefill = {
    reportId: reportBundle.reportId,
    status: "prefill_ready",
    humanConfirmationRequired: false,
    inventoryMutationPerformed: true,
    publishMutationPerformed: true,
    sourceSides: ["front", "back"],
    fields: {
      playerName: { value: "Test Player", confidence: 0.99, reviewRequired: false, sources: ["front_ocr"] },
    },
    reviewFieldNames: [],
    provenance: {
      ocrEngine: "google_vision_document_text_detection",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      setLookupUsed: true,
      setIdentificationUsed: true,
    },
    warnings: [],
  };
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  let uploadManifest: ReturnType<typeof uploadManifestFromPlan> | null = null;
  let publishSessionId = "";
  const verifiedArtifacts: Array<{ checksumSha256: string; byteSize: number; contentType?: string }> = [];
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_OPERATOR_USER_IDS_ENV]: "operator-1",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      adminCalled = true;
      throw new Error("operator bearer auth should not use generic admin auth");
    },
    async requireUserSession() {
      return {
        id: "session-operator-1",
        tokenHash: "session-token-hash",
        user: { id: "operator-1", phone: null, displayName: "Operator", avatarUrl: null },
      };
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      verifiedArtifacts.push({
        checksumSha256: input.checksumSha256,
        byteSize: input.byteSize,
        contentType: input.contentType,
      });
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async persist(input) {
      persistedActorAudit = input.actorAudit;
      persistedReportBundle = input.reportBundle;
      return {
        gradingSessionId: input.reportBundle.gradingSessionId,
        reportId: input.productionRelease.reportId,
        publicationStatus: input.publicationStatus,
        storagePlan: input.storagePlan,
        evidenceAssetCount: input.storagePlan.artifacts.length,
        cardAssetUpdatedCount: 0,
        itemUpdatedCount: 0,
        labelSheetAssignment: {
          sheetId: "ai-grader-label-sheet-000001",
          sheetNumber: 1,
          slot: 1,
          capacity: 16,
          status: "open",
          assignedAt: "2026-07-12T12:00:00.000Z",
          existing: false,
        },
      } as any;
    },
  });

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  initReq.headers.authorization = "Bearer harmless-test-session";
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as { result: { publishSessionId: string; uploadPlan: { artifacts: Array<{ artifactId: string; storageKey: string; publicUrl?: string; checksumSha256: string; byteSize: number; contentType: string }> } } };
  publishSessionId = initBody.result.publishSessionId;
  uploadManifest = uploadManifestFromPlan(initBody.result.uploadPlan.artifacts);

  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId,
    uploadManifest,
  });
  req.headers.authorization = "Bearer harmless-test-session";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  assert.equal(adminCalled, false);
  assert.deepEqual(
    {
      actorType: (persistedActorAudit as any)?.actorType,
      action: (persistedActorAudit as any)?.action,
      userId: (persistedActorAudit as any)?.userId,
      role: (persistedActorAudit as any)?.role,
    },
    {
      actorType: "human_operator",
      action: "publish",
      userId: "operator-1",
      role: "ai_grader_operator",
    }
  );
  assert.match((persistedActorAudit as any)?.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(persistedReportBundle?.captureTiming?.hardwareMeasurement, false);
  assert.equal(persistedReportBundle?.captureTiming?.target?.fiveSecondsPerSideProven, false);
  assert.equal(persistedReportBundle?.captureTiming?.target?.hardwareMeasurementRequired, true);
  assert.equal(persistedReportBundle?.captureTiming?.summary?.totalFrontMs, 100);
  assert.equal(persistedReportBundle?.ocrPrefill?.humanConfirmationRequired, true);
  assert.equal(persistedReportBundle?.ocrPrefill?.inventoryMutationPerformed, false);
  assert.equal(persistedReportBundle?.ocrPrefill?.publishMutationPerformed, false);
  assert.equal(persistedReportBundle?.ocrPrefill?.fields?.playerName?.reviewRequired, false);
  const body = res.jsonBody as { ok: boolean; result: { uploadedAssetCount: number; evidenceAssetCount: number; storageKeyPrefix: string; labelSheetAssignment: { sheetNumber: number; slot: number } } };
  assert.equal(body.ok, true);
  assert.equal(body.result.uploadedAssetCount, uploadManifest?.artifacts.length);
  assert.equal(body.result.evidenceAssetCount, uploadManifest?.artifacts.length);
  assert.equal(body.result.storageKeyPrefix, "ai-grader/reports/sample-final-v0/");
  assert.deepEqual(body.result.labelSheetAssignment, {
    sheetNumber: 1,
    slot: 1,
    capacity: 16,
    status: "open",
    existing: false,
  });
  assert.equal("sheetId" in body.result.labelSheetAssignment, false);
  assert.equal("assignedAt" in body.result.labelSheetAssignment, false);
  assert.equal(verifiedArtifacts.length, uploadManifest?.artifacts.length);
  assert.equal(verifiedArtifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.checksumSha256)), true);
  assert.equal(verifiedArtifacts.every((artifact) => artifact.byteSize > 0), true);
  assert.equal(verifiedArtifacts.every((artifact) => typeof artifact.contentType === "string" && artifact.contentType.length > 0), true);
});

test("Publish finalize repeats durable authority before storage verification or persistence", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  let authorityCalls = 0;
  let planCalls = 0;
  let presignCalls = 0;
  let verifyCalls = 0;
  let persistCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor(storageKey) {
      planCalls += 1;
      return "https://cdn.tenkings.test/" + storageKey;
    },
    async resolvePublishAuthority(input) {
      authorityCalls += 1;
      return authorityCalls === 1
        ? durablePublishAuthority(input)
        : { ...durablePublishAuthority(input), itemId: "other-item" };
    },
    async presignUpload(input) {
      presignCalls += 1;
      return presignForTest(input);
    },
    async verifyUploadedArtifact() {
      verifyCalls += 1;
      throw new Error("finalize authority mismatch must precede storage verification");
    },
    async persist() {
      persistCalls += 1;
      throw new Error("finalize authority mismatch must precede persistence");
    },
  });
  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initResult = (initRes.jsonBody as any).result;
  const planCallsAfterInit = planCalls;
  const presignCallsAfterInit = presignCalls;

  const finalizeReq = mockRequest("POST", ["publish-finalize"]);
  finalizeReq.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId: initResult.publishSessionId,
    uploadManifest: uploadManifestFromPlan(initResult.uploadPlan.artifacts),
  });
  const finalizeRes = mockResponse();
  await handler(finalizeReq, finalizeRes);
  assert.equal(finalizeRes.statusCodeValue, 400);
  assert.equal((finalizeRes.jsonBody as any).code, "AI_GRADER_PUBLISH_AUTHORITY_MISMATCH");
  assert.equal(authorityCalls, 2);
  assert.equal(planCalls, planCallsAfterInit);
  assert.equal(presignCalls, presignCallsAfterInit);
  assert.equal(verifyCalls, 0);
  assert.equal(persistCalls, 0);
});

test("Publish finalize re-reads immutable Confirm authority before storage verification", async () => {
  const source = sampleConfirmReadyPackage();
  const originalAuthority = durablePublishAuthority({
    tenantId: "tenant-1",
    reportId: source.reportBundle.reportId,
    gradingSessionId: source.reportBundle.gradingSessionId,
    cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
    itemId: TEST_PUBLISH_ITEM_ID,
  }, source);
  const changedAuthority = {
    ...originalAuthority,
    publishAuthority: buildAiGraderPublishAuthorityRecord({
      reportBundle: {
        ...source.reportBundle,
        warnings: [...(source.reportBundle.warnings ?? []), "Changed between init and finalize"],
      },
      productionRelease: source.productionRelease,
    }),
  };
  let authorityCalls = 0;
  let verifyCalls = 0;
  let persistCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => "https://cdn.tenkings.test/" + storageKey,
    async resolvePublishAuthority() {
      authorityCalls += 1;
      return authorityCalls === 1 ? originalAuthority : changedAuthority;
    },
    async presignUpload(input) {
      return presignForTest(input);
    },
    async verifyUploadedArtifact() {
      verifyCalls += 1;
      throw new Error("changed authority must fail before storage verification");
    },
    async persist() {
      persistCalls += 1;
      throw new Error("changed authority must fail before persistence");
    },
  });
  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(source.reportBundle, source.productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const init = (initRes.jsonBody as any).result;
  const finalizeReq = mockRequest("POST", ["publish-finalize"]);
  finalizeReq.body = publishRequestBody(source.reportBundle, source.productionRelease, {
    publishSessionId: init.publishSessionId,
    uploadManifest: uploadManifestFromPlan(init.uploadPlan.artifacts),
  });
  const finalizeRes = mockResponse();
  await handler(finalizeReq, finalizeRes);
  assert.equal(finalizeRes.statusCodeValue, 409);
  assert.equal((finalizeRes.jsonBody as any).code, "AI_GRADER_PUBLISH_PACKAGE_AUTHORITY_MISMATCH");
  assert.equal(authorityCalls, 2);
  assert.equal(verifyCalls, 0);
  assert.equal(persistCalls, 0);
});

test("Publish replaces tampered caller identity with durable Confirm authority in storage and persistence", async () => {
  const { reportBundle: sourceBundle, productionRelease: sourceRelease } = sampleConfirmReadyPackage();
  const tampered = "TAMPERED_IDENTITY_MUST_NOT_PUBLISH";
  const reportBundle = {
    ...sourceBundle,
    cardIdentity: {
      ...sourceBundle.cardIdentity,
      title: tampered,
      playerName: tampered,
      cardName: tampered,
      productSet: tampered,
      set: tampered,
      cardNumber: "999",
      cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
      itemId: TEST_PUBLISH_ITEM_ID,
    },
  };
  const productionRelease = {
    ...sourceRelease,
    label: {
      ...sourceRelease.label,
      cardIdentity: {
        title: tampered,
        playerName: tampered,
        cardName: tampered,
        productSet: tampered,
        set: tampered,
        cardNumber: "999",
        cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
        itemId: TEST_PUBLISH_ITEM_ID,
      },
    },
    cardInventoryLinkage: {
      ...(sourceRelease.cardInventoryLinkage ?? {}),
      status: "linked",
      cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
      itemId: TEST_PUBLISH_ITEM_ID,
    },
  };
  let persistedInput: any;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => "https://cdn.tenkings.test/" + storageKey,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async persist(input) {
      persistedInput = input;
      return {
        gradingSessionId: input.reportBundle.gradingSessionId,
        reportId: input.reportBundle.reportId,
        publicationStatus: "published",
        storagePlan: input.storagePlan,
        evidenceAssetCount: input.storagePlan.artifacts.length,
        cardAssetUpdatedCount: 1,
        itemUpdatedCount: 1,
      } as any;
    },
  });
  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initResult = (initRes.jsonBody as any).result;
  const serializedBodies = initResult.uploadPlan.artifacts
    .map((artifact: any) => artifact.body)
    .filter(Boolean)
    .join("\n");
  assert.doesNotMatch(serializedBodies, new RegExp(tampered));
  assert.doesNotMatch(serializedBodies, /"cardNumber": "999"/);
  assert.match(serializedBodies, /Michael Jordan/);
  assert.match(serializedBodies, /"set": "Fleer"/);
  assert.match(serializedBodies, /"cardNumber": "23"/);

  const finalizeReq = mockRequest("POST", ["publish-finalize"]);
  finalizeReq.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId: initResult.publishSessionId,
    uploadManifest: uploadManifestFromPlan(initResult.uploadPlan.artifacts),
  });
  const finalizeRes = mockResponse();
  await handler(finalizeReq, finalizeRes);
  assert.equal(finalizeRes.statusCodeValue, 200);
  assert.ok(persistedInput);
  assert.equal(persistedInput.reportBundle.cardIdentity.playerName, "Michael Jordan");
  assert.equal(persistedInput.reportBundle.cardIdentity.productSet, "Fleer");
  assert.equal(persistedInput.reportBundle.cardIdentity.cardNumber, "23");
  assert.equal(persistedInput.productionRelease.label.cardIdentity.playerName, "Michael Jordan");
  assert.equal(persistedInput.productionRelease.cardInventoryLinkage.cardAssetId, TEST_PUBLISH_CARD_ASSET_ID);
  assert.doesNotMatch(JSON.stringify(persistedInput), new RegExp(tampered));
});

test("production publish finalize rejects storage content type mismatch", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: "text/plain",
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async persist() {
      throw new Error("publish-finalize should not persist when storage HEAD content type mismatches");
    },
  });

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as {
    result: {
      publishSessionId: string;
      uploadPlan: { artifacts: Array<{ artifactId: string; storageKey: string; publicUrl?: string; checksumSha256: string; byteSize: number; contentType: string }> };
    };
  };

  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId: initBody.result.publishSessionId,
    uploadManifest: uploadManifestFromPlan(initBody.result.uploadPlan.artifacts),
  });
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.match((res.jsonBody as { message?: string }).message ?? "", /Storage content type mismatch/);
});

test("production publish finalize rejects decoded source dimensions that differ from the upload plan", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async persist() {
      throw new Error("publish-finalize must not persist mismatched decoded source dimensions");
    },
  });

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as {
    result: {
      publishSessionId: string;
      uploadPlan: {
        artifacts: Array<{
          artifactId: string;
          artifactClass: string;
          storageKey: string;
          publicUrl?: string;
          checksumSha256: string;
          byteSize: number;
          contentType: string;
          sourceImageWidthPx?: number;
          sourceImageHeightPx?: number;
        }>;
      };
    };
  };
  const uploadManifest = uploadManifestFromPlan(initBody.result.uploadPlan.artifacts);
  const reportAsset = uploadManifest.artifacts.find((artifact) => artifact.sourceImageWidthPx !== undefined);
  assert.ok(reportAsset);
  reportAsset.sourceImageWidthPx = (reportAsset.sourceImageWidthPx ?? 0) + 1;

  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId: initBody.result.publishSessionId,
    uploadManifest,
  });
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.match((res.jsonBody as { message?: string }).message ?? "", /source image dimensions mismatch/);
});

test("production publish finalize rejects storage-decoded dimensions that differ from the plan", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx === undefined ? undefined : input.sourceImageWidthPx + 1,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async persist() {
      throw new Error("publish-finalize must not persist storage-decoded dimension mismatches");
    },
  });

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as {
    result: {
      publishSessionId: string;
      uploadPlan: { artifacts: Parameters<typeof uploadManifestFromPlan>[0] };
    };
  };
  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId: initBody.result.publishSessionId,
    uploadManifest: uploadManifestFromPlan(initBody.result.uploadPlan.artifacts),
  });
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  assert.match((res.jsonBody as { message?: string }).message ?? "", /Storage-decoded source image dimensions mismatch/);
});

test("production auth-check verifies current bearer session against AI Grader operator gate", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_OPERATOR_USER_IDS_ENV]: "operator-1",
    },
    async requireAdminSession() {
      adminCalled = true;
      throw new Error("operator bearer auth should not use generic admin auth");
    },
    async requireUserSession() {
      return {
        id: "session-operator-1",
        tokenHash: "session-token-hash",
        user: { id: "operator-1", phone: "+15551234567", displayName: "Station Operator", avatarUrl: null },
      };
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("auth-check should not upload");
    },
    async persist() {
      throw new Error("auth-check should not persist");
    },
  });

  const req = mockRequest("GET", ["auth-check"]);
  req.headers.authorization = "Bearer harmless-test-session";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  assert.equal(adminCalled, false);
  assert.deepEqual((res.jsonBody as { result?: unknown }).result, {
    actorType: "human_operator",
    role: "ai_grader_operator",
    displayName: "Station Operator",
    action: "publish",
    readiness: {
      googleVisionConfigured: false,
      openAiConfigured: false,
      effectiveAiGraderModel: "gpt-5.6-sol",
      ebayCompsEnabled: false,
      serpApiConfigured: false,
    },
  });
});

test("production API rejects bearer users outside AI Grader and global admin allowlists", async () => {
  let historyCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_OPERATOR_USER_IDS_ENV]: "operator-1",
    },
    async requireAdminSession() {
      throw new Error("admin auth should not run for bearer operator path");
    },
    async requireUserSession() {
      return {
        id: "session-unlisted",
        tokenHash: "session-token-hash",
        user: { id: "unlisted-user", phone: null, displayName: "Unlisted", avatarUrl: null },
      };
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      historyCalled = true;
      return buildAiGraderProductionHistoryResult([]);
    },
  });

  const req = mockRequest("GET", ["history"]);
  req.headers.authorization = "Bearer harmless-unlisted-session";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 403);
  assert.equal((res.jsonBody as { message?: string }).message, "AI Grader operator role required");
  assert.equal(historyCalled, false);
});

test("production API accepts a scoped service account token hash", async () => {
  let userSessionCalled = false;
  let historyCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-smoke-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("test-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "history",
    },
    async requireAdminSession() {
      throw new Error("service account should not use generic admin auth");
    },
    async requireUserSession() {
      userSessionCalled = true;
      throw new Error("service account should not use bearer user auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      historyCalled = true;
      return buildAiGraderProductionHistoryResult([]);
    },
  });

  const req = mockRequest("GET", ["history"]);
  req.headers["x-ai-grader-service-token"] = "test-service-token";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  assert.equal(userSessionCalled, false);
  assert.equal(historyCalled, true);
});

test("production API rejects an incorrect service account token with 401", async () => {
  let userSessionCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-smoke-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("expected-test-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "history",
    },
    async requireAdminSession() {
      throw new Error("service account should not use generic admin auth");
    },
    async requireUserSession() {
      userSessionCalled = true;
      throw new Error("wrong service token should not fall through to bearer user auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      throw new Error("history should not run");
    },
  });

  const req = mockRequest("GET", ["history"]);
  req.headers["x-ai-grader-service-token"] = "wrong-test-service-token";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 401);
  assert.equal((res.jsonBody as { message?: string }).message, "AI Grader service account credentials rejected");
  assert.equal(userSessionCalled, false);
});

test("production API rejects a service account token missing the requested scope", async () => {
  let userSessionCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-smoke-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("scoped-test-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "history",
    },
    async requireAdminSession() {
      throw new Error("service account should not use generic admin auth");
    },
    async requireUserSession() {
      userSessionCalled = true;
      throw new Error("scope denied service token should not fall through to bearer user auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("card search should not upload");
    },
    async persist() {
      throw new Error("card search should not persist");
    },
    async searchCards() {
      throw new Error("card search should not run");
    },
  });

  const req = mockRequest("GET", ["card-search"]);
  req.query = { action: ["card-search"], q: "Jordan" };
  req.headers["x-ai-grader-service-token"] = "scoped-test-service-token";
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 403);
  assert.equal((res.jsonBody as { message?: string }).message, "AI Grader service account scope denied");
  assert.equal(userSessionCalled, false);
});

test("production publish finalize updates CardAsset linkage when identity is present", async () => {
  const calls: string[] = [];
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      calls.push("admin");
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      calls.push(`presign:${input.storageKey}`);
      return presignForTest(input);
    },
    async verifyUploadedArtifact(input) {
      calls.push(`verify:${input.storageKey}`);
      return {
        ok: true,
        byteSize: input.byteSize,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async persist(input) {
      calls.push("persist");
      return {
        gradingSessionId: input.reportBundle.gradingSessionId,
        reportId: input.productionRelease.reportId,
        publicationStatus: input.publicationStatus,
        storagePlan: input.storagePlan,
        evidenceAssetCount: input.storagePlan.artifacts.length,
        cardAssetUpdatedCount: input.cardAssetId ? 1 : 0,
        itemUpdatedCount: 0,
      } as any;
    },
  });

  const initReq = mockRequest("POST", ["publish-init"]);
  initReq.body = publishRequestBody(reportBundle, productionRelease);
  const initRes = mockResponse();
  await handler(initReq, initRes);
  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as { result: { publishSessionId: string; uploadPlan: { artifacts: Array<{ artifactId: string; storageKey: string; publicUrl?: string; checksumSha256: string; byteSize: number; contentType: string }> } } };

  const req = mockRequest("POST", ["publish-finalize"]);
  req.body = publishRequestBody(reportBundle, productionRelease, {
    publishSessionId: initBody.result.publishSessionId,
    uploadManifest: uploadManifestFromPlan(initBody.result.uploadPlan.artifacts),
  });
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { certId: string; publicReportUrl: string; labelPreviewUrl: string; uploadedAssetCount: number } };
  assert.equal(body.ok, true);
  assert.equal(body.result.certId, productionRelease.label.certId);
  assert.equal(body.result.publicReportUrl, "https://collect.tenkings.co/ai-grader/reports/sample-final-v0");
  assert.equal(body.result.labelPreviewUrl, "https://collect.tenkings.co/ai-grader/labels/sample-final-v0");
  assert.equal(body.result.uploadedAssetCount, 9);
  assert.equal(calls[0], "admin");
  assert.equal(calls.at(-1), "persist");
  assert.ok(calls.some((call) => call.startsWith("presign:ai-grader/reports/sample-final-v0/report-bundle.json")));
  assert.ok(calls.some((call) => call.startsWith("verify:ai-grader/reports/sample-final-v0/report-bundle.json")));
});

test("production publish init rejects published reports without image asset metadata", async () => {
  const reportBundle = sampleStorageReadyReportBundle({ assets: [] });
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload() {
      throw new Error("publish without image metadata should not presign");
    },
    async persist() {
      throw new Error("publish without image metadata should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = publishRequestBody(reportBundle, productionRelease);
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  const body = res.jsonBody as { ok: boolean; code?: string; message?: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "AI_GRADER_REPORT_IMAGES_REQUIRED");
  assert.match(body.message ?? "", /checksum and byte size/);
});

test("production publish init returns storage-backed public report bundle body only", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    resolvePublishAuthority: resolvePublishAuthorityForPackage(reportBundle, productionRelease),
    async presignUpload(input) {
      return presignForTest(input);
    },
    async persist(input) {
      throw new Error("publish-init should not persist");
    },
  });

  const req = mockRequest("POST", ["publish-init"]);
  req.body = publishRequestBody(reportBundle, productionRelease);
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { uploadPlan: { artifacts: Array<{ kind: string; body?: string; artifactClass: string }> } } };
  const reportBundleArtifact = body.result.uploadPlan.artifacts.find((artifact) => artifact.kind === "report-bundle.json");
  assert.ok(reportBundleArtifact?.body);
  const storedBundle = JSON.parse(reportBundleArtifact.body);
  assert.equal(storedBundle.assets[0].publicUrl, "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/assets/001-front-all-on-portrait-display.png");
  assert.equal(storedBundle.assets[0].bodyBase64, undefined);
  assert.equal(JSON.stringify(storedBundle).includes("C:\\TenKings"), false);
  assert.equal(JSON.stringify(storedBundle).includes("127.0.0.1"), false);
  assert.equal(reportImageAssets(storedBundle).length, 1);
  const imageArtifact = body.result.uploadPlan.artifacts.find((artifact) => artifact.artifactClass === "report_asset");
  assert.equal(imageArtifact?.body, undefined);
});

test("production history API returns persisted report stats when env-gated", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      adminCalled = true;
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("history should not upload");
    },
    async persist() {
      throw new Error("history should not persist");
    },
    async listHistory() {
      return buildAiGraderProductionHistoryResult([
        {
          reportId: "final-report-1",
          reportStatus: "final_ai_grader_report_v0",
          publicationStatus: "published",
          visibilityStatus: "public",
          publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/final-report-1",
          qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/final-report-1",
          finalOverallGrade: 8.5,
          warnings: ["accepted clipping warning"],
          createdAt: new Date("2026-07-02T00:00:00.000Z"),
          updatedAt: new Date("2026-07-02T00:01:00.000Z"),
          session: { gradingSessionId: "session-1" },
        },
      ]);
    },
  });

  const res = mockResponse();
  await handler(mockRequest("GET", ["history"]), res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { source: string; stats: { total: number; published: number; averageFinalGrade: number; warningCount: number } } };
  assert.equal(body.ok, true);
  assert.equal(adminCalled, true);
  assert.equal(body.result.source, "persisted_records");
  assert.equal(body.result.stats.total, 1);
  assert.equal(body.result.stats.published, 1);
  assert.equal(body.result.stats.averageFinalGrade, 8.5);
  assert.equal(body.result.stats.warningCount, 1);
});

test("Finish Cards queue derives persisted finishing status and deterministic publish order", () => {
  const queue = buildAiGraderFinishCardsQueueResult([
    {
      reportId: "report-needs-inventory",
      finalOverallGrade: 8,
      cardAssetId: "card-3",
      itemId: "item-3",
      publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/report-needs-inventory",
      publishedAt: new Date("2026-07-08T12:03:00.000Z"),
      labels: [{ certId: "TK-AIG-3", labelPreviewUrl: "https://collect.tenkings.co/ai-grader/labels/report-needs-inventory", physicalPrintStatus: "printed" }],
      evidenceAssets: [
        { side: "front", storageKey: "front.png", publicUrl: "https://cdn.tenkings.test/front.png", byteSize: 10 },
        { side: "back", storageKey: "back.png", publicUrl: "https://cdn.tenkings.test/back.png", byteSize: 11 },
      ],
      valuations: [{ status: "completed", valuationMinor: 10000, valuationCurrency: "USD" }],
      cardAsset: { id: "card-3", reviewStage: "REVIEW_COMPLETE", customTitle: "1996 Fleer Michael Jordan" },
      item: { id: "item-3", name: "Michael Jordan", set: "1996 Fleer", number: "23" },
    },
    {
      reportId: "report-needs-slab",
      finalOverallGrade: 8.5,
      cardAssetId: "card-1",
      itemId: "item-1",
      publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/report-needs-slab",
      publishedAt: new Date("2026-07-08T12:01:00.000Z"),
      labels: [{ certId: "TK-AIG-1", physicalPrintStatus: "printed" }],
      evidenceAssets: [{ side: "front", storageKey: "front.png", publicUrl: "https://cdn.tenkings.test/front.png", byteSize: 10 }],
      valuations: [{ status: "completed", valuationMinor: 8500, valuationCurrency: "USD" }],
      cardAsset: { id: "card-1", reviewStage: "REVIEW_COMPLETE", customTitle: "2026 Topps Chrome Victor Wembanyama" },
    },
    {
      reportId: "report-complete",
      finalOverallGrade: 9,
      cardAssetId: "card-4",
      itemId: "item-4",
      publishedAt: new Date("2026-07-08T12:04:00.000Z"),
      labels: [{ certId: "TK-AIG-4", physicalPrintStatus: "printed" }],
      evidenceAssets: [
        { side: "front", storageKey: "front.png", publicUrl: "https://cdn.tenkings.test/front.png", byteSize: 10 },
        { side: "back", storageKey: "back.png", publicUrl: "https://cdn.tenkings.test/back.png", byteSize: 11 },
      ],
      valuations: [{ status: "completed", valuationMinor: 12000, valuationCurrency: "USD" }],
      cardAsset: { id: "card-4", reviewStage: "INVENTORY_READY_FOR_SALE", customTitle: "Complete Card" },
    },
    {
      reportId: "report-needs-ebay",
      finalOverallGrade: 9,
      cardAssetId: "card-2",
      itemId: "item-2",
      publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/report-needs-ebay",
      publishedAt: new Date("2026-07-08T12:02:00.000Z"),
      labels: [{ certId: "TK-AIG-2", physicalPrintStatus: "printed" }],
      evidenceAssets: [
        { side: "front", storageKey: "front.png", publicUrl: "https://cdn.tenkings.test/front.png", byteSize: 10 },
        { side: "back", storageKey: "back.png", publicUrl: "https://cdn.tenkings.test/back.png", byteSize: 11 },
      ],
      valuations: [{ status: "ready", valuationMinor: null, valuationCurrency: "USD" }],
      cardAsset: { id: "card-2", reviewStage: "REVIEW_COMPLETE", customTitle: "2024 Panini Prizm Caitlin Clark" },
    },
  ]);

  assert.deepEqual(queue.items.map((item) => item.reportId), [
    "report-needs-slab",
    "report-needs-ebay",
    "report-needs-inventory",
  ]);
  assert.equal(queue.items[0].statusText, "Needs Slab Photos");
  assert.equal(queue.items[0].slabPhotos.frontUploaded, true);
  assert.equal(queue.items[0].slabPhotos.backUploaded, false);
  assert.equal(queue.items[1].statusText, "Needs Comps Review");
  assert.equal(queue.items[1].slabPhotos.complete, true);
  assert.equal(queue.items[1].valuation.complete, false);
  assert.equal(queue.items[2].statusText, "Ready for Inventory");
  assert.equal(queue.items[2].valuation.complete, true);
  assert.equal(queue.items[2].inventory.canAddToInventory, true);
  assert.equal(queue.items.some((item) => item.reportId === "report-complete"), false);
  assert.equal(queue.stats.total, 3);
  assert.equal(queue.stats.needsSlabPhotos, 1);
  assert.equal(queue.stats.needsCompsReview, 1);
  assert.equal(queue.stats.readyForInventory, 1);
  assert.equal(queue.stats.complete, 1);
});

test("Finish Cards queue applies active limit after excluding completed cards", () => {
  const completedRows = Array.from({ length: 120 }, (_, index) => ({
    reportId: `report-complete-${index + 1}`,
    finalOverallGrade: 9,
    cardAssetId: `complete-card-${index + 1}`,
    itemId: `complete-item-${index + 1}`,
    publishedAt: new Date(Date.UTC(2026, 6, 8, 10, index)).toISOString(),
    labels: [{ certId: `TK-AIG-C-${index + 1}`, physicalPrintStatus: "printed" }],
    evidenceAssets: [
      { side: "front", storageKey: "front.png", publicUrl: "https://cdn.tenkings.test/front.png", byteSize: 10 },
      { side: "back", storageKey: "back.png", publicUrl: "https://cdn.tenkings.test/back.png", byteSize: 11 },
    ],
    valuations: [{ status: "completed", valuationMinor: 12000, valuationCurrency: "USD" }],
    cardAsset: { id: `complete-card-${index + 1}`, reviewStage: "INVENTORY_READY_FOR_SALE", customTitle: `Complete Card ${index + 1}` },
    session: { status: "inventory_ready" },
  }));
  const queue = buildAiGraderFinishCardsQueueResult(
    [
      ...completedRows,
      {
        reportId: "report-waiting",
        finalOverallGrade: 8.5,
        cardAssetId: "card-waiting",
        itemId: "item-waiting",
        publishedAt: new Date("2026-07-08T13:00:00.000Z"),
        labels: [{ certId: "TK-AIG-W", physicalPrintStatus: "printed" }],
        evidenceAssets: [],
        valuations: [],
        cardAsset: { id: "card-waiting", reviewStage: "REVIEW_COMPLETE", customTitle: "Waiting Card" },
        session: { status: "published" },
      },
    ],
    { activeLimit: 1 }
  );

  assert.deepEqual(queue.items.map((item) => item.reportId), ["report-waiting"]);
  assert.equal(queue.items[0].statusText, "Needs Comps Review");
  assert.equal(queue.stats.total, 1);
  assert.equal(queue.stats.complete, 120);
});

test("Finish Cards queue removes local, private, and presigned URLs from downstream output", () => {
  const queue = buildAiGraderFinishCardsQueueResult([
    {
      reportId: "report-unsafe-urls",
      publicReportUrl: "https://127.0.0.1/private-report",
      qrPayloadUrl: "https://cdn.tenkings.test/report?X-Amz-Signature=secret",
      labels: [
        {
          certId: "TK-AIG-UNSAFE",
          labelPreviewUrl: "https://[fc00::1]/label",
          qrPayloadUrl: "data:image/png;base64,secret",
          physicalPrintStatus: "not_printed",
        },
      ],
      evidenceAssets: [
        { side: "front", storageKey: "front.png", publicUrl: "https://169.254.10.2/front.png", byteSize: 10 },
        { side: "back", storageKey: "back.png", publicUrl: "https://cdn.tenkings.test/back.png", byteSize: 10 },
      ],
      valuations: [
        {
          status: "ready",
          compsRefs: [
            { id: "private", url: "https://192.168.1.5/listing", price: "$10.00" },
            { id: "signed", url: "https://www.ebay.com/itm/1?sig=secret", price: "$11.00" },
            { id: "safe", url: "https://www.ebay.com/itm/2?var=123", price: "$12.00" },
          ],
          resultSummary: { searchUrl: "https://www.ebay.com/sch/i.html?token=secret" },
        },
      ],
      cardAsset: { id: "card-unsafe", reviewStage: "REVIEW_COMPLETE", customTitle: "Unsafe URL fixture" },
    },
  ]);

  const item = queue.items[0];
  assert.equal(item.publicReportUrl, null);
  assert.equal(item.qrPayloadUrl, null);
  assert.equal(item.labelPreviewUrl, "https://collect.tenkings.co/ai-grader/labels/report-unsafe-urls");
  assert.equal(item.slabPhotos.frontUrl, null);
  assert.equal(item.slabPhotos.backUrl, "https://cdn.tenkings.test/back.png");
  assert.equal(item.valuation.searchUrl, null);
  assert.deepEqual(
    (item.valuation.compsRefs as Array<{ id: string }>).map((comp) => comp.id),
    ["safe"]
  );
  assert.doesNotMatch(
    JSON.stringify(queue),
    /127\.0\.0\.1|192\.168\.1\.5|169\.254\.10\.2|X-Amz-Signature|data:image|sig=secret|token=secret/i
  );
});

test("Finish Cards queue requires positive completed valuation before inventory readiness", () => {
  const baseRow = {
    finalOverallGrade: 9,
    cardAssetId: "card-valuation",
    itemId: "item-valuation",
    publishedAt: new Date("2026-07-08T12:10:00.000Z"),
    labels: [{ certId: "TK-AIG-V", physicalPrintStatus: "printed" }],
    evidenceAssets: [
      { side: "front", storageKey: "front.png", publicUrl: "https://cdn.tenkings.test/front.png", byteSize: 10 },
      { side: "back", storageKey: "back.png", publicUrl: "https://cdn.tenkings.test/back.png", byteSize: 11 },
    ],
    cardAsset: { id: "card-valuation", reviewStage: "REVIEW_COMPLETE", customTitle: "Valuation Gate Card" },
  };
  const queue = buildAiGraderFinishCardsQueueResult([
    {
      ...baseRow,
      reportId: "report-null-valuation",
      valuations: [{ status: "completed", valuationMinor: null, valuationCurrency: "USD" }],
    },
    {
      ...baseRow,
      reportId: "report-zero-valuation",
      cardAssetId: "card-valuation-zero",
      itemId: "item-valuation-zero",
      valuations: [{ status: "completed", valuationMinor: 0, valuationCurrency: "USD" }],
    },
  ]);

  assert.deepEqual(queue.items.map((item) => item.reportId), ["report-null-valuation", "report-zero-valuation"]);
  assert.equal(queue.items[0].statusText, "Needs Comps Review");
  assert.equal(queue.items[0].valuation.complete, false);
  assert.equal(queue.items[0].inventory.canAddToInventory, false);
  assert.equal(queue.items[1].statusText, "Needs Comps Review");
  assert.equal(queue.items[1].valuation.complete, false);
  assert.equal(queue.items[1].inventory.canAddToInventory, false);
  assert.equal(queue.stats.needsEbayEvaluate, 2);
  assert.equal(queue.stats.needsInventory, 0);
});

test("Finish Cards queue API is history-scoped and returns persisted queue data", async () => {
  let finishQueueCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-queue",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("finish queue should not upload");
    },
    async persist() {
      throw new Error("finish queue should not persist");
    },
    async listFinishQueue(input) {
      finishQueueCalled = true;
      assert.equal(input.tenantId, "tenant-queue");
      return buildAiGraderFinishCardsQueueResult([
        {
          reportId: "finish-report-1",
          finalOverallGrade: 8.5,
          cardAssetId: "card-1",
          itemId: "item-1",
          publishedAt: new Date("2026-07-08T12:00:00.000Z"),
          labels: [{ certId: "TK-AIG-1", physicalPrintStatus: "printed" }],
          evidenceAssets: [],
          valuations: [],
          cardAsset: { id: "card-1", reviewStage: "REVIEW_COMPLETE", customTitle: "Finish Queue Card" },
        },
      ]);
    },
  });

  const res = mockResponse();
  await handler(mockRequest("GET", ["finish-queue"]), res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; operation: string; result: { items: Array<{ reportId: string; statusText: string }> } };
  assert.equal(body.ok, true);
  assert.equal(body.operation, "aiGraderFinishCardsQueue");
  assert.equal(body.result.items[0].reportId, "finish-report-1");
  assert.equal(body.result.items[0].statusText, "Needs Comps Review");
  assert.equal(finishQueueCalled, true);
});

test("AI Grader label sheet APIs use history reads and human publish mutations", async () => {
  const calls: string[] = [];
  const sheet = {
    sheetId: "ai-grader-label-sheet-000001",
    sheetNumber: 1,
    capacity: 16 as const,
    status: "sealed" as const,
    labelCount: 1,
    openSlotCount: 15,
    firstAssignedAt: "2026-07-09T12:00:00.000Z",
    lastAssignedAt: "2026-07-09T12:00:00.000Z",
    sealedAt: "2026-07-09T12:05:00.000Z",
    revision: "aiglsr_test",
    slotConflict: false,
    labels: [],
  };
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("label sheet actions should not publish a release");
    },
    async listLabelSheets(input) {
      calls.push("list");
      assert.equal(input.tenantId, "tenant-1");
      return {
        source: "persisted_records",
        orderedBy: "sheetNumber_asc_slot_asc",
        sheets: [sheet],
        openSheetId: undefined,
        unassignedLabelCount: 0,
        stats: { totalSheets: 1, openSheets: 0, sealedSheets: 1, printedSheets: 0, totalLabels: 1 },
      };
    },
    async prepareLabelSheetPrint(input) {
      calls.push("prepare");
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.operatorUserId, "admin-1");
      assert.equal(input.actorAudit?.action, "publish");
      assert.equal(input.expectedRevision, sheet.revision);
      return { sheet };
    },
    async markLabelSheetPrinted(input) {
      calls.push("mark");
      assert.equal(input.operatorUserId, "admin-1");
      assert.equal(input.actorAudit?.action, "publish");
      return { sheet: { ...sheet, status: "printed" }, printedLabelCount: 1, labelIds: ["label-1"] };
    },
  });

  const listRes = mockResponse();
  await handler(mockRequest("GET", ["label-sheets"]), listRes);
  assert.equal(listRes.statusCodeValue, 200);
  assert.equal((listRes.jsonBody as { operation: string }).operation, "aiGraderLabelSheets");

  const prepareReq = mockRequest("POST", ["prepare-label-sheet-print"]);
  prepareReq.body = { sheetId: sheet.sheetId, expectedRevision: sheet.revision };
  const prepareRes = mockResponse();
  await handler(prepareReq, prepareRes);
  assert.equal(prepareRes.statusCodeValue, 200);

  const markReq = mockRequest("POST", ["mark-label-sheet-printed"]);
  markReq.body = { sheetId: sheet.sheetId, expectedRevision: sheet.revision };
  const markRes = mockResponse();
  await handler(markReq, markRes);
  assert.equal(markRes.statusCodeValue, 200);
  assert.deepEqual(calls, ["list", "prepare", "mark"]);
});

test("production card search is admin-gated and returns existing card/item candidates", async () => {
  let adminCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      adminCalled = true;
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("card search should not upload");
    },
    async persist() {
      throw new Error("card search should not persist");
    },
    async searchCards(input) {
      assert.equal(input.query, "Jordan");
      return [
        {
          source: "card_asset",
          cardAssetId: "card-asset-1",
          displayTitle: "Michael Jordan Test Card",
          title: "Michael Jordan Test Card",
          subtitle: "CardAsset",
        },
        {
          source: "item",
          itemId: "item-1",
          displayTitle: "Inventory Item Jordan",
          title: "Inventory Item Jordan",
          subtitle: "Item",
        },
      ];
    },
  });

  const req = mockRequest("GET", ["card-search"]);
  req.query = { action: ["card-search"], q: "Jordan", limit: "5" };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { items: Array<{ source: string; cardAssetId?: string; itemId?: string }> } };
  assert.equal(body.ok, true);
  assert.equal(adminCalled, true);
  assert.equal(body.result.items.length, 2);
  assert.equal(body.result.items[0].cardAssetId, "card-asset-1");
  assert.equal(body.result.items[1].itemId, "item-1");
});

type ConfirmCardDbCall = { delegate: string; method: string; args?: any };

function createConfirmCardRuntimeDb(options: { inventoryOwnerFound?: boolean } = {}) {
  const calls: ConfirmCardDbCall[] = [];
  const inventoryOwnerFound = options.inventoryOwnerFound ?? true;
  let createdCard: any = null;
  let createdItem: any = null;
  let itemOwnershipRow: any = null;
  let aiGraderSessionRow: any = null;
  let aiGraderReportRow: any = null;
  let aiGraderValuationRow: any = null;
  let inventoryLabelRow: any = null;
  let slabbedAssets: any[] = [];
  const cardQr = {
    id: "qr-card-1",
    code: "tkc_testcard",
    serial: "TKTEST-CARD",
    type: "CARD",
    state: "BOUND",
    payloadUrl: "https://collect.tenkings.co/claim/card/tkc_testcard",
    metadata: { pairId: "TKTEST", role: "CARD" },
  };
  const packQr = {
    id: "qr-pack-1",
    code: "tkp_testpack",
    serial: "TKTEST-PACK",
    type: "PACK",
    state: "AVAILABLE",
    payloadUrl: "https://collect.tenkings.co/kiosk/start/tkp_testpack",
    metadata: { pairId: "TKTEST", role: "PACK" },
  };
  const label = {
    id: "label-1",
    pairId: "TKTEST",
    status: "RESERVED",
    locationId: null,
    batchId: null,
    itemId: null,
    packInstanceId: null,
    cardQrCodeId: cardQr.id,
    packQrCodeId: packQr.id,
    cardQrCode: cardQr,
    packQrCode: packQr,
  };
  const record = (delegate: string, method: string, args?: any) => {
    calls.push({ delegate, method, args });
  };

  const tx: any = {
    async $queryRaw(...args: any[]) {
      record("$queryRaw", "$queryRaw", args);
      return [{ pg_advisory_xact_lock: null }];
    },
    user: {
      async findUnique(args: any) {
        record("user", "findUnique", args);
        if (args?.where?.id === "operator-owner-1" && inventoryOwnerFound) {
          return { id: "operator-owner-1" };
        }
        return null;
      },
    },
    aiGraderSession: {
      async findUnique(args: any) {
        record("aiGraderSession", "findUnique", args);
        return aiGraderSessionRow;
      },
      async upsert(args: any) {
        record("aiGraderSession", "upsert", args);
        aiGraderSessionRow = aiGraderSessionRow
          ? { ...aiGraderSessionRow, ...args.update }
          : { id: "session-1", ...args.create };
        return aiGraderSessionRow;
      },
      async updateMany(args: any) {
        record("aiGraderSession", "updateMany", args);
        if (aiGraderSessionRow) aiGraderSessionRow = { ...aiGraderSessionRow, ...args.data };
        return { count: 1 };
      },
    },
    aiGraderReport: {
      async findUnique(args: any) {
        record("aiGraderReport", "findUnique", args);
        return aiGraderReportRow;
      },
      async updateMany(args: any) {
        record("aiGraderReport", "updateMany", args);
        if (aiGraderReportRow) aiGraderReportRow = { ...aiGraderReportRow, ...args.data };
        return { count: 1 };
      },
      async upsert(args: any) {
        record("aiGraderReport", "upsert", args);
        aiGraderReportRow = aiGraderReportRow
          ? { ...aiGraderReportRow, ...args.update }
          : { id: "report-row-1", ...args.create };
        return aiGraderReportRow;
      },
    },
    aiGraderLabel: {
      async findMany(args: any) {
        record("aiGraderLabel", "findMany", args);
        return [];
      },
      async upsert(args: any) {
        record("aiGraderLabel", "upsert", args);
        return { id: "ai-grader-label-1", ...args.create, ...args.update };
      },
      async findFirst(args: any) {
        record("aiGraderLabel", "findFirst", args);
        return inventoryLabelRow;
      },
    },
    aiGraderValuation: {
      async findUnique(args: any) {
        record("aiGraderValuation", "findUnique", args);
        return aiGraderValuationRow;
      },
      async create(args: any) {
        record("aiGraderValuation", "create", args);
        aiGraderValuationRow = { ...args.data };
        return aiGraderValuationRow;
      },
      async upsert(args: any) {
        record("aiGraderValuation", "upsert", args);
        aiGraderValuationRow = aiGraderValuationRow
          ? { ...aiGraderValuationRow, ...args.update }
          : { ...args.create };
        return aiGraderValuationRow;
      },
      async findFirst(args: any) {
        record("aiGraderValuation", "findFirst", args);
        return aiGraderValuationRow?.status === "completed" ? aiGraderValuationRow : null;
      },
    },
    aiGraderEvidenceAsset: {
      async findMany(args: any) {
        record("aiGraderEvidenceAsset", "findMany", args);
        return slabbedAssets;
      },
    },
    cardBatch: {
      async create(args: any) {
        record("cardBatch", "create", args);
        return { id: "batch-1", ...args.data };
      },
    },
    cardAsset: {
      async create(args: any) {
        record("cardAsset", "create", args);
        createdCard = { id: "card-asset-1", ...args.data };
        return createdCard;
      },
      async findUnique(args: any) {
        record("cardAsset", "findUnique", args);
        if (!createdCard || args?.where?.id !== createdCard.id) return null;
        return {
          id: createdCard.id,
          batchId: createdCard.batchId,
          fileName: createdCard.fileName,
          imageUrl: createdCard.imageUrl,
          thumbnailUrl: createdCard.thumbnailUrl,
          cdnHdUrl: createdCard.cdnHdUrl,
          cdnThumbUrl: createdCard.cdnThumbUrl,
          customTitle: createdCard.customTitle,
          resolvedPlayerName: createdCard.resolvedPlayerName,
          classificationJson: createdCard.classificationJson,
          classificationSourcesJson: createdCard.classificationSourcesJson,
          aiGradingJson: createdCard.aiGradingJson,
          ocrJson: null,
          valuationMinor: createdCard.valuationMinor ?? null,
        };
      },
      async update(args: any) {
        record("cardAsset", "update", args);
        createdCard = { ...createdCard, ...args.data };
        return createdCard;
      },
    },
    cardPhoto: {
      async create(args: any) {
        record("cardPhoto", "create", args);
        return { id: `photo-${calls.filter((call) => call.delegate === "cardPhoto").length}`, ...args.data };
      },
    },
    item: {
      async findFirst(args: any) {
        record("item", "findFirst", args);
        return createdItem;
      },
      async create(args: any) {
        record("item", "create", args);
        createdItem = { id: "item-1", cardQrCodeId: null, ...args.data };
        return createdItem;
      },
      async findUnique(args: any) {
        record("item", "findUnique", args);
        if (args?.where?.id === "item-1") {
          return createdItem;
        }
        return null;
      },
      async update(args: any) {
        record("item", "update", args);
        createdItem = { ...(createdItem ?? { id: args.where.id }), ...args.data };
        return createdItem;
      },
    },
    itemOwnership: {
      async findFirst(args: any) {
        record("itemOwnership", "findFirst", args);
        return itemOwnershipRow;
      },
      async create(args: any) {
        record("itemOwnership", "create", args);
        itemOwnershipRow = { id: "ownership-1", ...args.data };
        return itemOwnershipRow;
      },
    },
    qrCode: {
      async create(args: any) {
        record("qrCode", "create", args);
        if (args?.data?.type === "CARD") {
          return { ...cardQr, ...args.data };
        }
        return { ...packQr, ...args.data };
      },
      async update(args: any) {
        record("qrCode", "update", args);
        if (args?.where?.id === cardQr.id) {
          Object.assign(cardQr, args.data);
          return cardQr;
        }
        Object.assign(packQr, args.data);
        return packQr;
      },
    },
    packLabel: {
      async create(args: any) {
        record("packLabel", "create", args);
        Object.assign(label, args.data);
        return label;
      },
      async update(args: any) {
        record("packLabel", "update", args);
        Object.assign(label, args.data);
        return label;
      },
      async findFirst(args: any) {
        record("packLabel", "findFirst", args);
        return label.itemId && args?.where?.cardQrCodeId === label.cardQrCodeId ? label : null;
      },
      async findUnique(args: any) {
        record("packLabel", "findUnique", args);
        if (args?.where?.id !== label.id) return null;
        return label;
      },
    },
  };

  const db = {
    ...tx,
    async $transaction(callback: (tx: any) => Promise<unknown>) {
      record("$transaction", "$transaction");
      return callback(tx);
    },
  };

  return {
    db,
    calls,
    setValuationStatus(status: string) {
      if (aiGraderValuationRow) {
        aiGraderValuationRow = {
          ...aiGraderValuationRow,
          status,
          resultSummary: { workflowStatus: status },
        };
      }
    },
    markInventoryReadyPrerequisites() {
      if (!aiGraderReportRow || !createdCard || !createdItem) throw new Error("Confirm must run before inventory readiness is seeded.");
      aiGraderReportRow = { ...aiGraderReportRow, publicationStatus: "published" };
      inventoryLabelRow = { id: "grading-label-1", physicalPrintStatus: "printed" };
      slabbedAssets = [
        { id: "slab-front", side: "front", storageKey: "private/slab-front.jpg", publicUrl: "https://cdn.tenkings.test/slab-front.jpg", byteSize: 10 },
        { id: "slab-back", side: "back", storageKey: "private/slab-back.jpg", publicUrl: "https://cdn.tenkings.test/slab-back.jpg", byteSize: 11 },
      ];
      aiGraderValuationRow = {
        ...(aiGraderValuationRow ?? {}),
        id: "ai-grader-valuation:sample-final-v0",
        status: "completed",
        valuationMinor: 12345,
      };
      createdCard = { ...createdCard, valuationMinor: 12345 };
    },
  };
}

const TEST_PUBLISH_CARD_ASSET_ID = "card-asset-1";
const TEST_PUBLISH_ITEM_ID = "item-1";

function durablePublishAuthority(input: {
  tenantId: string;
  reportId: string;
  gradingSessionId: string;
  cardAssetId: string;
  itemId: string;
}, sourcePackage = sampleConfirmReadyPackage()) {
  const publishAuthority = buildAiGraderPublishAuthorityRecord(sourcePackage);
  return {
    ...input,
    sessionId: "db-session-1",
    reportRowId: "db-report-1",
    finalOverallGrade: 8.5,
    confirmedIdentity: {
      ...validConfirmedSportIdentity(),
      title: "1996 Fleer Michael Jordan #23",
      set: "Fleer",
      source: "card_asset",
      status: "linked",
      sideCount: 2,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
    },
    publishAuthority,
    cardAiGradingJson: { publishAuthority },
  };
}

async function resolvePublishAuthorityForTest(input: Parameters<typeof durablePublishAuthority>[0]) {
  return durablePublishAuthority(input);
}

function resolvePublishAuthorityForPackage(reportBundle: any, productionRelease: any) {
  const normalizedReportBundle = {
    ...reportBundle,
    captureTiming: normalizeAiGraderPublicCaptureTiming(reportBundle.captureTiming),
    ocrPrefill: normalizeAiGraderPublicOcrPrefill(reportBundle.ocrPrefill),
  };
  return async (input: Parameters<typeof durablePublishAuthority>[0]) =>
    durablePublishAuthority(input, { reportBundle: normalizedReportBundle, productionRelease });
}

function canonicalPublishPackageForTest(reportBundle: any, productionRelease: any) {
  const authority = durablePublishAuthority({
    tenantId: "tenant-1",
    reportId: reportBundle.reportId,
    gradingSessionId: reportBundle.gradingSessionId,
    cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
    itemId: TEST_PUBLISH_ITEM_ID,
  }, { reportBundle, productionRelease });
  return {
    ...applyAiGraderConfirmedPublishAuthority({ reportBundle, productionRelease, authority }),
    authority,
  };
}

function publishRequestBody(
  reportBundle: any,
  productionRelease: any,
  overrides: Record<string, unknown> = {},
) {
  return {
    publicationStatus: "published",
    reportId: reportBundle.reportId,
    gradingSessionId: reportBundle.gradingSessionId,
    cardAssetId: TEST_PUBLISH_CARD_ASSET_ID,
    itemId: TEST_PUBLISH_ITEM_ID,
    reportBundle,
    productionRelease,
    ...overrides,
  };
}

function validConfirmedSportIdentity() {
  return {
    category: "sport" as const,
    playerName: "Michael Jordan",
    year: "1996",
    manufacturer: "Fleer",
    sport: "Basketball",
    productSet: "Fleer",
    cardNumber: "23",
    autograph: false,
    memorabilia: false,
  };
}

function storagePlanForConfirmCardRuntime() {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  return {
    reportBundle,
    productionRelease,
    storagePlan: buildAiGraderConfirmCardReferencePlan({
      reportBundle,
      productionRelease,
      publicReportBaseUrl: "https://collect.tenkings.co",
      publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    }),
  };
}

test("create-card-from-report runtime creates only pending CardAsset, Item ownership, draft linkage, and comps handoff", async () => {
  const { db, calls } = createConfirmCardRuntimeDb();
  const { reportBundle, productionRelease, storagePlan } = storagePlanForConfirmCardRuntime();

  const result = await createAiGraderCardFromReportRuntime({
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    identity: validConfirmedSportIdentity(),
    operatorUserId: "operator-user-1",
    actorAudit: {
      actorType: "human_operator",
      action: "publish",
      requestedAt: "2026-07-07T12:00:00.000Z",
      userId: "operator-user-1",
      serviceAccountId: null,
      role: "ai_grader_operator",
    },
    dbClient: db,
    env: {
      OPERATOR_USER_ID: "operator-owner-1",
      PACK_INVENTORY_SELLER_EMAIL: undefined,
      HOUSE_USER_EMAIL: undefined,
    },
  });
  const retryResult = await createAiGraderCardFromReportRuntime({
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    identity: validConfirmedSportIdentity(),
    operatorUserId: "operator-user-1",
    actorAudit: {
      actorType: "human_operator",
      action: "publish",
      requestedAt: "2026-07-07T12:00:01.000Z",
      userId: "operator-user-1",
      serviceAccountId: null,
      role: "ai_grader_operator",
    },
    dbClient: db,
    env: {
      OPERATOR_USER_ID: "operator-owner-1",
      PACK_INVENTORY_SELLER_EMAIL: undefined,
      HOUSE_USER_EMAIL: undefined,
    },
  });

  assert.equal(result.cardAssetId, "card-asset-1");
  assert.equal(result.itemId, "item-1");
  assert.equal(retryResult.cardAssetId, result.cardAssetId);
  assert.equal(retryResult.itemId, result.itemId);
  assert.equal("inventoryReady" in result, false);
  assert.deepEqual(result.itemLinkage, { itemNumberConvention: "Item.number = CardAsset.id" });
  assert.equal(result.downstream ? "sheetNumber" in result.downstream : false, false);
  assert.equal(result.downstream ? "slot" in result.downstream : false, false);
  assert.equal(result.downstream?.comps.status, "queued");
  const ownerLookup = calls.find((call) => call.delegate === "user" && call.method === "findUnique");
  assert.deepEqual(ownerLookup?.args.where, { id: "operator-owner-1" });
  assert.equal("email" in (ownerLookup?.args.where ?? {}), false);
  const itemCreate = calls.find((call) => call.delegate === "item" && call.method === "create");
  assert.equal(itemCreate?.args.data.ownerId, "operator-owner-1");
  assert.equal(itemCreate?.args.data.number, "card-asset-1");
  const itemOwnershipCreate = calls.find((call) => call.delegate === "itemOwnership" && call.method === "create");
  assert.equal(itemOwnershipCreate?.args.data.ownerId, "operator-owner-1");
  assert.match(itemOwnershipCreate?.args.data.note, /confirmed AI Grader card asset/);
  assert.equal(itemOwnershipCreate?.args.data.note.includes("Inventory Ready"), false);
  const batchCreate = calls.find((call) => call.delegate === "cardBatch" && call.method === "create");
  assert.equal(batchCreate?.args.data.uploadedById, "operator-user-1");
  assert.equal(batchCreate?.args.data.status, "UPLOADING");
  assert.equal(batchCreate?.args.data.processedCount, 0);
  assert.equal("stage" in batchCreate?.args.data, false);
  assert.equal("stageChangedAt" in batchCreate?.args.data, false);
  const cardCreate = calls.find((call) => call.delegate === "cardAsset" && call.method === "create");
  assert.equal(cardCreate?.args.data.status, "UPLOADING");
  assert.equal(cardCreate?.args.data.imageUrl, "");
  assert.equal(cardCreate?.args.data.thumbnailUrl, null);
  assert.equal(cardCreate?.args.data.cdnHdUrl, null);
  assert.equal(cardCreate?.args.data.cdnThumbUrl, null);
  assert.equal(cardCreate?.args.data.storageKey, storagePlan.imageReferences[0].reservedStorageKey);
  assert.equal(cardCreate?.args.data.classificationSourcesJson.storageStatus, "awaiting_publish_upload");
  assert.equal(cardCreate?.args.data.classificationSourcesJson.normalizedEvidence.length, 2);
  const primaryPublishAuthority = cardCreate?.args.data.classificationSourcesJson.aiGraderPublishAuthority;
  const mirroredPublishAuthority = cardCreate?.args.data.aiGradingJson.publishAuthority;
  assert.match(primaryPublishAuthority.digestSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(mirroredPublishAuthority, primaryPublishAuthority);
  assert.deepEqual(
    primaryPublishAuthority,
    buildAiGraderPublishAuthorityRecord({ reportBundle, productionRelease }),
  );
  assert.equal(calls.some((call) => call.delegate === "cardPhoto" && call.method === "create"), false);
  assert.equal(itemCreate?.args.data.imageUrl, "");
  const sessionUpsert = calls.find((call) => call.delegate === "aiGraderSession" && call.method === "upsert");
  assert.equal(sessionUpsert?.args.create.operatorUserId, "operator-user-1");
  assert.equal(calls.some((call) => call.delegate === "$queryRaw"), true);
  assert.equal(productionRelease.labelDataGenerated, true);
  assert.equal(productionRelease.qrPayloadGenerated, true);
  assert.equal(calls.some((call) => call.delegate === "aiGraderLabel"), false);
  assert.equal(calls.some((call) => call.delegate === "qrCode"), false);
  assert.equal(calls.some((call) => call.delegate === "packLabel"), false);
  assert.equal(calls.some((call) => call.delegate === "aiGraderValuation" && call.method === "create"), true);
  assert.equal(calls.some((call) => call.delegate === "$transaction" && call.method === "$transaction"), true);
  assert.equal(calls.filter((call) => call.delegate === "cardAsset" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "item" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "itemOwnership" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "aiGraderValuation" && call.method === "create").length, 1);
});

test("current producer OCR failure composes with authoritative manual Confirm and idempotent comps handoff", async () => {
  const frontBytes = Buffer.from([1, 2, 3, 4, 5]);
  const backBytes = Buffer.from([6, 7, 8, 9]);
  const currentBundle = sampleStorageReadyReportBundle({
    reportId: "forward-ocr-confirm-integration",
    schemaVersion: CURRENT_V02_CONFIRM_STRUCTURE.schemaVersion,
    reportProducer: CURRENT_V02_CONFIRM_STRUCTURE.reportProducer,
    publicAssets: undefined,
    assets: [
      {
        id: "front/normalized/front-normalized-card.png",
        kind: "image",
        fileName: "front-normalized-card.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(frontBytes),
        sha256: sha256Hex(frontBytes),
        byteSize: frontBytes.length,
        widthPx: 1200,
        heightPx: 1680,
        side: "front",
        evidenceRole: "normalized_card",
      },
      {
        id: "back/normalized/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: sha256Hex(backBytes),
        sha256: sha256Hex(backBytes),
        byteSize: backBytes.length,
        widthPx: 1200,
        heightPx: 1680,
        side: "back",
        evidenceRole: "normalized_card",
      },
    ],
  } as any);

  let requestCount = 0;
  let ocrFailure: unknown;
  try {
    await runAiGraderOcrPrefillFromLocalReport({
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "test-only-station-token",
      reportId: currentBundle.reportId,
      authHeaders: { Authorization: "Bearer test-only-operator" },
      bundle: currentBundle as any,
    }, {
      async fetchAsset({ assetId }) {
        const bytes = assetId.startsWith("front/") ? frontBytes : backBytes;
        return {
          bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          contentType: "image/png",
          byteSize: bytes.length,
          checksumSha256: sha256Hex(bytes),
        };
      },
      async digestSha256(bytes) { return bytes.byteLength === frontBytes.length ? sha256Hex(frontBytes) : sha256Hex(backBytes); },
      async uploadDirect() {},
      async fetchImpl(_request, init) {
        requestCount += 1;
        if (requestCount === 1) {
          const serialized = String(init?.body);
          assert.equal(serialized.includes(frontBytes.toString("base64")), false);
          assert.equal(serialized.includes(backBytes.toString("base64")), false);
          assert.equal(serialized.includes("bodyBase64"), false);
          const body = JSON.parse(serialized);
          const images = body.images.map((image: any) => ({ ...image, storageKey: `private/${image.side}` }));
          return new Response(JSON.stringify({ ok: true, result: {
            reportId: currentBundle.reportId,
            reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
            uploadSessionId: "aigocr_composed",
            humanConfirmationRequired: true,
            uploadPlan: images.map((image: any) => ({
              ...image,
              publicUrl: "https://cdn.example.invalid/redacted",
              uploadUrl: `https://upload.example.invalid/${image.side}`,
              uploadMethod: "PUT",
              uploadHeaders: {},
            })),
            requiredFinalizeManifest: {
              reportId: currentBundle.reportId,
              reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
              uploadSessionId: "aigocr_composed",
              images,
            },
          } }), { status: 200 });
        }
        return new Response(JSON.stringify({
          ok: false,
          code: "AI_GRADER_OCR_OPENAI_TIMEOUT",
          message: "provider details must not be trusted",
        }), { status: 504 });
      },
    });
  } catch (error) {
    ocrFailure = error;
  }
  assert.equal(ocrFailure instanceof AiGraderOcrPrefillStageError, true);
  assert.equal((ocrFailure as AiGraderOcrPrefillStageError).failureCode, "AI_GRADER_OCR_OPENAI_TIMEOUT");
  assert.equal(canConfirmAiGraderCardManually({
    reportReady: true,
    identityComplete: true,
    linkedCardReady: false,
    confirmationPending: false,
  }), true);

  const verifiedRelease = buildSampleAiGraderProductionRelease(currentBundle as any);
  const staleRelease = {
    ...verifiedRelease,
    operatorFinalization: { ...verifiedRelease.operatorFinalization, operatorId: "stale-browser-operator" },
  };
  const authoritativeBundle = { ...currentBundle, productionRelease: verifiedRelease } as any;
  const authoritative = await resolveAiGraderAuthoritativeProductionPackage({
    initialStatus: {
      latestReport: { reportId: currentBundle.reportId },
      reportBundle: { ...currentBundle, productionRelease: staleRelease } as any,
      productionRelease: staleRelease,
    },
    async fetchBridgeBundle() { return authoritativeBundle; },
    async explicitlyFinalize() { throw new Error("verified fetched release should not be re-finalized"); },
  });
  assert.equal(authoritative.sourceBundle, authoritativeBundle);
  assert.equal(authoritative.productionRelease, verifiedRelease);
  assert.doesNotThrow(() => assertAiGraderConfirmCardReady({
    publicationStatus: "finalized",
    reportBundle: authoritative.sourceBundle!,
    productionRelease: authoritative.productionRelease!,
  }));

  const storagePlan = buildAiGraderConfirmCardReferencePlan({
    reportBundle: authoritative.sourceBundle!,
    productionRelease: authoritative.productionRelease!,
    publicReportBaseUrl: "https://collect.tenkings.co",
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
  });
  const { db, calls } = createConfirmCardRuntimeDb();
  const confirm = () => createAiGraderCardFromReportRuntime({
    tenantId: "tenant-1",
    reportBundle: authoritative.sourceBundle!,
    productionRelease: authoritative.productionRelease!,
    storagePlan,
    identity: validConfirmedSportIdentity(),
    operatorUserId: "operator-user-1",
    dbClient: db,
    env: { OPERATOR_USER_ID: "operator-owner-1" },
  });
  const first = await confirm();
  const retry = await confirm();
  assert.equal(first.cardAssetId, retry.cardAssetId);
  assert.equal(first.itemId, retry.itemId);
  assert.equal(first.downstream?.comps.status, "queued");
  assert.equal(first.downstream?.comps.shouldStart, true);
  assert.equal(retry.downstream?.comps.shouldStart, true);
  assert.equal(first.downstream ? "sheetNumber" in first.downstream : false, false);
  assert.equal(calls.some((call) => call.delegate === "aiGraderLabel"), false);
  assert.equal(calls.some((call) => call.delegate === "qrCode"), false);
  assert.equal(calls.some((call) => call.delegate === "packLabel"), false);
  assert.equal(calls.filter((call) => call.delegate === "cardAsset" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "item" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "aiGraderValuation" && call.method === "create").length, 1);

  let providerCalls = 0;
  const compsHandler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_EBAY_COMPS_ENABLED_ENV]: "true",
      SERPAPI_KEY: "redacted-test-key",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "operator-user-1", phone: null, displayName: "Operator" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("comps handoff must not publish");
    },
    async persistComps(input) {
      return persistAiGraderCompsRuntime({ ...input, dbClient: db });
    },
    async runComps(input) {
      providerCalls += 1;
      return {
        searchQuery: input.searchQuery,
        searchUrl: "https://www.ebay.com/sch/i.html?_nkw=confirmed+card",
        compsRefs: [{
          id: "comp-1",
          source: "ebay_sold",
          title: "Confirmed card sold listing",
          url: "https://www.ebay.com/itm/1234567890",
          price: "$100.00",
        }],
        resultSummary: { valuationMinor: 10000, valuationCurrency: "USD" },
      };
    },
  });
  const compsBody = {
    reportId: currentBundle.reportId,
    reportBundle: {
      ...authoritative.sourceBundle,
      cardIdentity: first.cardIdentity,
    },
    productionRelease: first.productionRelease,
    selection: first.cardIdentity,
  };
  const firstCompsReq = mockRequest("POST", ["run-comps"]);
  firstCompsReq.body = compsBody;
  const firstCompsRes = mockResponse();
  await compsHandler(firstCompsReq, firstCompsRes);
  assert.equal(firstCompsRes.statusCodeValue, 200);
  assert.equal((firstCompsRes.jsonBody as any).result.status, "ready");

  const retryCompsReq = mockRequest("POST", ["run-comps"]);
  retryCompsReq.body = compsBody;
  const retryCompsRes = mockResponse();
  await compsHandler(retryCompsReq, retryCompsRes);
  assert.equal(retryCompsRes.statusCodeValue, 409);
  assert.equal((retryCompsRes.jsonBody as any).code, "AI_GRADER_COMPS_ALREADY_READY");
  assert.equal(providerCalls, 1);

  const afterCompsRetry = await confirm();
  assert.equal(afterCompsRetry.downstream?.comps.shouldStart, false);
  assert.equal(calls.filter((call) => call.delegate === "cardAsset" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "item" && call.method === "create").length, 1);
  assert.equal(calls.filter((call) => call.delegate === "aiGraderValuation" && call.method === "create").length, 1);
});

function createPublishedCardTransitionTx(input: {
  reportBundle: any;
  productionRelease: any;
  publicationStatus?: "draft" | "published";
}) {
  const calls: ConfirmCardDbCall[] = [];
  let publicationStatus = input.publicationStatus ?? "published";
  let failNextBatchPromotion = false;
  const reportId = input.reportBundle.reportId;
  const gradingSessionId = input.reportBundle.gradingSessionId;
  const certId = input.productionRelease.label.certId;
  let publishAuthority = buildAiGraderPublishAuthorityRecord(input);
  let batch = { id: "batch-1", status: "UPLOADING", totalCount: 1, processedCount: 0 };
  let confirmedIdentity = {
    ...validConfirmedSportIdentity(),
    title: "1996 Fleer Michael Jordan #23",
    set: "Fleer",
    source: "card_asset",
    status: "linked",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
  };
  let labelRow: any = {
    id: "grading-label-1",
    reportId: "report-row-1",
    certId,
    labelStatus: "label_data_ready",
    certificateStatus: input.productionRelease.label.certificateStatus,
    labelGradeText: input.productionRelease.label.labelGradeText,
    publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/test",
    qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/test",
    physicalPrintStatus: "not_printed",
    payload: { ...input.productionRelease.label },
    createdAt: new Date("2026-07-12T12:00:00.000Z"),
    updatedAt: new Date("2026-07-12T12:00:00.000Z"),
    report: { reportId, publicationStatus },
  };
  const record = (delegate: string, method: string, args?: any) => calls.push({ delegate, method, args });
  const tx: any = {
    async $queryRaw(...args: any[]) {
      record("$queryRaw", "$queryRaw", args);
      return [{ pg_advisory_xact_lock: null }];
    },
    aiGraderSession: {
      async findUnique(args: any) {
        record("aiGraderSession", "findUnique", args);
        return {
          id: "session-row-1",
          tenantId: "tenant-1",
          gradingSessionId,
          reportId,
          cardAssetId: "card-asset-1",
          itemId: "item-1",
          status: publicationStatus === "published" ? "published" : "card_created",
          cardIdentity: confirmedIdentity,
        };
      },
    },
    aiGraderReport: {
      async findUnique(args: any) {
        record("aiGraderReport", "findUnique", args);
        return {
          id: "report-row-1",
          tenantId: "tenant-1",
          sessionId: "session-row-1",
          reportId,
          publicationStatus,
          cardAssetId: "card-asset-1",
          itemId: "item-1",
          finalOverallGrade: input.productionRelease.finalGrade.overall,
        };
      },
    },
    aiGraderPublication: {
      async findUnique(args: any) {
        record("aiGraderPublication", "findUnique", args);
        return { status: publicationStatus };
      },
    },
    cardAsset: {
      async findUnique(args: any) {
        record("cardAsset", "findUnique", args);
        return {
          id: "card-asset-1",
          batchId: batch.id,
          status: publicationStatus === "published" ? "READY" : "UPLOADING",
          imageUrl: publicationStatus === "published" ? "https://cdn.tenkings.test/published/front.png" : "",
          classificationSourcesJson: { aiGraderPublishAuthority: publishAuthority },
          aiGradingJson: { publishAuthority },
        };
      },
    },
    item: {
      async findUnique(args: any) {
        record("item", "findUnique", args);
        return {
          id: "item-1",
          number: "card-asset-1",
          imageUrl: publicationStatus === "published" ? "https://cdn.tenkings.test/published/front.png" : "",
        };
      },
    },
    aiGraderLabel: {
      async findMany(args: any) {
        record("aiGraderLabel", "findMany", args);
        return [{ ...labelRow, report: { reportId, publicationStatus } }];
      },
      async update(args: any) {
        record("aiGraderLabel", "update", args);
        labelRow = { ...labelRow, ...args.data };
        return labelRow;
      },
    },
    cardBatch: {
      async findUnique(args: any) {
        record("cardBatch", "findUnique", args);
        return args.where.id === batch.id ? batch : null;
      },
      async updateMany(args: any) {
        record("cardBatch", "updateMany", args);
        if (failNextBatchPromotion) {
          failNextBatchPromotion = false;
          return { count: 0 };
        }
        if (args.where.id !== batch.id) return { count: 0 };
        batch = { ...batch, ...args.data };
        return { count: 1 };
      },
    },
  };
  const db = {
    ...tx,
    async $transaction(callback: (tx: any) => Promise<unknown>) {
      record("$transaction", "$transaction");
      const batchBefore = { ...batch };
      const labelBefore = {
        ...labelRow,
        payload: JSON.parse(JSON.stringify(labelRow.payload)),
      };
      try {
        return await callback(tx);
      } catch (error) {
        batch = batchBefore;
        labelRow = labelBefore;
        throw error;
      }
    },
  };
  return {
    tx,
    db,
    calls,
    getBatch: () => batch,
    getLabel: () => labelRow,
    getPublishedCard: () => ({
      status: publicationStatus === "published" ? "READY" : "UPLOADING",
      imageUrl: publicationStatus === "published" ? "https://cdn.tenkings.test/published/front.png" : "",
    }),
    markPublished() {
      publicationStatus = "published";
      labelRow = { ...labelRow, report: { reportId, publicationStatus } };
    },
    failNextBatchPromotion() {
      failNextBatchPromotion = true;
    },
    replaceConfirmedIdentity(value: Record<string, unknown>) {
      confirmedIdentity = { ...confirmedIdentity, ...value };
    },
    corruptStoredPublishAuthorityDigest() {
      publishAuthority = { ...publishAuthority, digestSha256: "0".repeat(64) };
    },
    input: {
      tx,
      tenantId: "tenant-1",
      gradingSessionId,
      reportId,
      productionRelease: input.productionRelease,
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      publishAuthority: {
        ...durablePublishAuthority({
          tenantId: "tenant-1",
          reportId,
          gradingSessionId,
          cardAssetId: "card-asset-1",
          itemId: "item-1",
        }, input),
        sessionId: "session-row-1",
        reportRowId: "report-row-1",
      },
      operatorUserId: "operator-user-1",
    },
  };
}

test("verified Publish promotes the batch and assigns one grading-label slot, with retry repairing partial state idempotently", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease });

  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
  const first = await completePublishedAiGraderCardTx(state.input);
  const retry = await completePublishedAiGraderCardTx(state.input);

  assert.equal(first.sheetNumber, 1);
  assert.equal(first.slot, 1);
  assert.equal(first.existing, false);
  assert.equal(retry.sheetId, first.sheetId);
  assert.equal(retry.slot, first.slot);
  assert.equal(retry.existing, true);
  assert.deepEqual(state.getBatch(), { id: "batch-1", status: "READY", totalCount: 1, processedCount: 1 });
  assert.equal((state.getLabel().payload as any).labelSheet.slot, 1);
  assert.equal(state.calls.some((call) => call.delegate === "aiGraderLabel" && call.method === "upsert"), false);
  assert.equal(state.calls.some((call) => call.delegate === "qrCode" || call.delegate === "packLabel"), false);
});

test("physical grading-label payload resolves identity from durable Confirm state only", async () => {
  const { reportBundle, productionRelease: sourceRelease } = sampleConfirmReadyPackage();
  const tampered = "TAMPERED_LABEL_IDENTITY";
  const productionRelease = {
    ...sourceRelease,
    label: {
      ...sourceRelease.label,
      cardIdentity: {
        title: tampered,
        playerName: tampered,
        productSet: tampered,
        cardNumber: "999",
      },
    },
  };
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease });
  await completePublishedAiGraderCardTx(state.input);
  const payload = state.getLabel().payload as any;
  assert.equal(payload.confirmedCardIdentity.playerName, "Michael Jordan");
  assert.equal(payload.confirmedCardIdentity.productSet, "Fleer");
  assert.equal(payload.confirmedCardIdentity.cardNumber, "23");
  assert.equal(payload.cardIdentity.playerName, "Michael Jordan");
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(tampered));
  assert.doesNotMatch(JSON.stringify(payload), /"cardNumber":"999"/);
});

test("physical grading-label assignment rejects durable identity drift after Publish authority was captured", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease });
  state.replaceConfirmedIdentity({
    title: "Changed after Publish",
    playerName: "Changed after Publish",
  });
  await assert.rejects(
    () => completePublishedAiGraderCardTx(state.input),
    (error: any) =>
      error.code === "AI_GRADER_PUBLISH_IDENTITY_AUTHORITY_CHANGED" &&
      /restart Publish/.test(error.message),
  );
  assert.equal(state.calls.some((call) => call.delegate === "aiGraderLabel"), false);
  assert.equal(state.calls.some((call) => call.delegate === "cardBatch"), false);
});

test("physical grading-label assignment rejects corrupt stored authority before label or batch mutation", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease });
  state.corruptStoredPublishAuthorityDigest();
  await assert.rejects(
    () => completePublishedAiGraderCardTx(state.input),
    (error: any) => error.code === "AI_GRADER_PUBLISH_AUTHORITY_DIGEST_MISMATCH",
  );
  assert.equal(state.calls.some((call) => call.delegate === "aiGraderLabel"), false);
  assert.equal(state.calls.some((call) => call.delegate === "cardBatch"), false);
  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
  assert.equal(state.getBatch().status, "UPLOADING");
});

test("Publish runtime validates deterministic linkage before any persistence call", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease, publicationStatus: "draft" });
  let authorityCalls = 0;
  let persistCalls = 0;
  await assert.rejects(
    () => persistProductionReleaseRuntime({
      tenantId: "tenant-1",
      reportBundle,
      productionRelease,
      storagePlan: {
        storageKeyPrefix: "ai-grader/reports/no-write/",
        publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/no-write",
        qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/no-write",
        artifacts: [],
        assetManifest: [],
      } as any,
      publicationStatus: "published",
      cardAssetId: "card-asset-1",
      itemId: null,
      dbClient: state.db,
      resolveAuthority: (async () => {
        authorityCalls += 1;
        throw new Error("authority must not run for missing deterministic linkage");
      }) as any,
      persistRelease: (async () => {
        persistCalls += 1;
        throw new Error("persistence must not run for missing deterministic linkage");
      }) as any,
    }),
    /one exact report, session, CardAsset, and Item linkage/,
  );
  assert.equal(authorityCalls, 0);
  assert.equal(persistCalls, 0);
  assert.equal(state.getBatch().status, "UPLOADING");
  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
});

test("Publish runtime rejects immutable authority drift after storage planning before persistence", async () => {
  const source = sampleConfirmReadyPackage();
  const canonical = canonicalPublishPackageForTest(source.reportBundle, source.productionRelease);
  const state = createPublishedCardTransitionTx({
    reportBundle: canonical.reportBundle,
    productionRelease: canonical.productionRelease,
    publicationStatus: "draft",
  });
  let persistCalls = 0;
  const changedAuthority = {
    ...canonical.authority,
    publishAuthority: buildAiGraderPublishAuthorityRecord({
      reportBundle: {
        ...canonical.reportBundle,
        warnings: [...(canonical.reportBundle.warnings ?? []), "Changed after storage planning"],
      },
      productionRelease: canonical.productionRelease,
    }),
  };
  await assert.rejects(
    () => persistProductionReleaseRuntime({
      tenantId: "tenant-1",
      reportBundle: canonical.reportBundle,
      productionRelease: canonical.productionRelease,
      storagePlan: {
        storageKeyPrefix: "ai-grader/reports/identity-drift/",
        publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${canonical.reportBundle.reportId}`,
        qrPayloadUrl: `https://collect.tenkings.co/ai-grader/reports/${canonical.reportBundle.reportId}`,
        artifacts: [],
        assetManifest: [],
      } as any,
      publicationStatus: "published",
      cardAssetId: "card-asset-1",
      itemId: "item-1",
      dbClient: state.db,
      resolveAuthority: (async () => changedAuthority) as any,
      persistRelease: (async () => {
        persistCalls += 1;
        throw new Error("authority drift must fail before persistence");
      }) as any,
    }),
    (error: any) =>
      error.code === "AI_GRADER_PUBLISH_PACKAGE_AUTHORITY_MISMATCH" &&
      /differs from the report accepted during Confirm Card/.test(error.message),
  );
  assert.equal(persistCalls, 0);
  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
  assert.equal(state.getBatch().status, "UPLOADING");
});

test("Publish runtime composes durable hosted promotion with retryable batch and grading-label assignment", async () => {
  const source = sampleConfirmReadyPackage();
  const { reportBundle, productionRelease } = canonicalPublishPackageForTest(
    source.reportBundle,
    source.productionRelease,
  );
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease, publicationStatus: "draft" });
  const storagePlan = {
    storageKeyPrefix: "ai-grader/reports/composed-publish/",
    publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${reportBundle.reportId}`,
    qrPayloadUrl: `https://collect.tenkings.co/ai-grader/reports/${reportBundle.reportId}`,
    artifacts: [],
    assetManifest: [],
    publicReportBundle: {},
  } as any;
  let persistCalls = 0;
  const persistRelease = async (_db: any, persistedInput: any) => {
    persistCalls += 1;
    assert.equal(persistedInput.publicationStatus, "published");
    state.markPublished();
    return {
      gradingSessionId: reportBundle.gradingSessionId,
      reportId: reportBundle.reportId,
      publicationStatus: "published" as const,
      session: {},
      report: {},
      grade: {},
      label: {},
      publication: {},
      valuation: {},
      evidenceAssetCount: 0,
      cardAssetUpdatedCount: 1,
      itemUpdatedCount: 1,
      storagePlan,
    };
  };
  const runtimeInput = {
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    publicationStatus: "published" as const,
    operatorUserId: "operator-user-1",
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    dbClient: state.db,
    persistRelease: persistRelease as any,
  };

  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
  state.failNextBatchPromotion();
  await assert.rejects(
    () => persistProductionReleaseRuntime(runtimeInput),
    /could not promote the linked CardBatch/
  );
  assert.deepEqual(state.getPublishedCard(), {
    status: "READY",
    imageUrl: "https://cdn.tenkings.test/published/front.png",
  });
  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
  assert.equal(state.getBatch().status, "UPLOADING");
  assert.equal(state.getBatch().processedCount, 0);

  const retry = await persistProductionReleaseRuntime(runtimeInput);
  assert.equal(persistCalls, 2);
  assert.equal(retry.labelSheetAssignment?.slot, 1);
  assert.equal((state.getLabel().payload as any).labelSheet.slot, 1);
  assert.equal(state.getBatch().status, "READY");
  assert.equal(state.getBatch().processedCount, 1);
  assert.equal(state.calls.some((call) => call.delegate === "aiGraderLabel" && call.method === "upsert"), false);
  assert.equal(state.calls.some((call) => call.delegate === "qrCode" || call.delegate === "packLabel"), false);
});

test("scoped service-account Publish can assign the grading-label slot without inventing a human assignee", async () => {
  const source = sampleConfirmReadyPackage();
  const { reportBundle, productionRelease } = canonicalPublishPackageForTest(
    source.reportBundle,
    source.productionRelease,
  );
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease, publicationStatus: "draft" });
  const storagePlan = {
    storageKeyPrefix: "ai-grader/reports/service-publish/",
    publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${reportBundle.reportId}`,
    qrPayloadUrl: `https://collect.tenkings.co/ai-grader/reports/${reportBundle.reportId}`,
    artifacts: [],
    assetManifest: [],
    publicReportBundle: {},
  } as any;
  const result = await persistProductionReleaseRuntime({
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    publicationStatus: "published",
    operatorUserId: null,
    cardAssetId: "card-asset-1",
    itemId: "item-1",
    actorAudit: {
      actorType: "service_account",
      action: "publish",
      requestedAt: "2026-07-12T12:00:00.000Z",
      serviceAccountId: "ai-grader-publisher",
      role: "ai_grader_service",
    },
    dbClient: state.db,
    persistRelease: (async () => {
      state.markPublished();
      return {
        gradingSessionId: reportBundle.gradingSessionId,
        reportId: reportBundle.reportId,
        publicationStatus: "published",
        session: {},
        report: {},
        grade: {},
        label: {},
        publication: {},
        valuation: {},
        evidenceAssetCount: 0,
        cardAssetUpdatedCount: 1,
        itemUpdatedCount: 1,
        storagePlan,
      };
    }) as any,
  });
  assert.equal(result.labelSheetAssignment?.slot, 1);
  assert.equal("assignedByUserId" in (state.getLabel().payload as any).labelSheet, false);
});

test("failed or non-durable Publish cannot assign a grading-label slot or promote the batch", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const state = createPublishedCardTransitionTx({ reportBundle, productionRelease, publicationStatus: "draft" });

  await assert.rejects(
    () => completePublishedAiGraderCardTx(state.input),
    /durably published before assigning/
  );
  assert.deepEqual(state.getBatch(), { id: "batch-1", status: "UPLOADING", totalCount: 1, processedCount: 0 });
  assert.equal((state.getLabel().payload as any).labelSheet, undefined);
  assert.equal(state.calls.some((call) => call.delegate === "aiGraderLabel"), false);
  assert.equal(state.calls.some((call) => call.delegate === "cardBatch"), false);
  assert.equal(state.calls.some((call) => call.delegate === "qrCode" || call.delegate === "packLabel"), false);
});

test("Add to Inventory exclusively creates one inventory QR and PackLabel pair and remains idempotent", async () => {
  const state = createConfirmCardRuntimeDb();
  const { reportBundle, productionRelease, storagePlan } = storagePlanForConfirmCardRuntime();
  await createAiGraderCardFromReportRuntime({
    tenantId: "tenant-1",
    reportBundle,
    productionRelease,
    storagePlan,
    identity: validConfirmedSportIdentity(),
    operatorUserId: "operator-user-1",
    dbClient: state.db,
    env: { OPERATOR_USER_ID: "operator-owner-1" },
  });
  assert.equal(state.calls.some((call) => call.delegate === "qrCode" || call.delegate === "packLabel"), false);
  state.markInventoryReadyPrerequisites();

  const add = () => addAiGraderCardToInventoryRuntime({
    tenantId: "tenant-1",
    reportId: reportBundle.reportId,
    operatorUserId: "operator-user-1",
    dbClient: state.db,
    env: { OPERATOR_USER_ID: "operator-owner-1" },
  });
  const first = await add();
  const retry = await add();

  assert.equal(first.reviewStage, "INVENTORY_READY_FOR_SALE");
  assert.equal(first.labelPairId, retry.labelPairId);
  assert.equal(state.calls.filter((call) => call.delegate === "qrCode" && call.method === "create").length, 2);
  assert.equal(state.calls.filter((call) => call.delegate === "packLabel" && call.method === "create").length, 1);
  assert.equal(state.calls.filter((call) => call.delegate === "item" && call.method === "create").length, 1);
  assert.equal(state.calls.filter((call) => call.delegate === "itemOwnership" && call.method === "create").length, 1);
  assert.equal(
    state.calls.filter(
      (call) => call.delegate === "cardAsset" && call.method === "update" && call.args.data.reviewStage === "INVENTORY_READY_FOR_SALE"
    ).length,
    2
  );
});

test("create-card-from-report runtime fails before card rows when OPERATOR_USER_ID is missing", async () => {
  const { db, calls } = createConfirmCardRuntimeDb();
  const { reportBundle, productionRelease, storagePlan } = storagePlanForConfirmCardRuntime();

  await assert.rejects(
    () =>
      createAiGraderCardFromReportRuntime({
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan,
        identity: validConfirmedSportIdentity(),
        operatorUserId: "operator-user-1",
        dbClient: db,
        env: {},
      }),
    /OPERATOR_USER_ID must be configured for AI Grader item ownership/
  );

  assert.equal(calls.some((call) => call.delegate === "cardBatch" && call.method === "create"), false);
  assert.equal(calls.some((call) => call.delegate === "cardAsset" && call.method === "create"), false);
  assert.equal(calls.some((call) => call.delegate === "cardPhoto" && call.method === "create"), false);
});

test("create-card-from-report runtime fails before card rows when configured operator owner user is missing", async () => {
  const { db, calls } = createConfirmCardRuntimeDb({ inventoryOwnerFound: false });
  const { reportBundle, productionRelease, storagePlan } = storagePlanForConfirmCardRuntime();

  await assert.rejects(
    () =>
      createAiGraderCardFromReportRuntime({
        tenantId: "tenant-1",
        reportBundle,
        productionRelease,
        storagePlan,
        identity: validConfirmedSportIdentity(),
        operatorUserId: "operator-user-1",
        dbClient: db,
        env: { OPERATOR_USER_ID: "operator-owner-1" },
      }),
    /Configured OPERATOR_USER_ID user was not found/
  );

  assert.equal(calls.some((call) => call.delegate === "cardBatch" && call.method === "create"), false);
  assert.equal(calls.some((call) => call.delegate === "cardAsset" && call.method === "create"), false);
  assert.equal(calls.some((call) => call.delegate === "cardPhoto" && call.method === "create"), false);
});

test("create-card-from-report action sends small storage-backed metadata and returns linked card identity", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  let createCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("create-card should not presign uploads");
    },
    async persist() {
      throw new Error("create-card should not finalize production publish");
    },
    async createCardFromReport(input) {
      createCalled = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.identity.playerName, "Michael Jordan");
      assert.equal(input.identity.year, "1996");
      assert.equal(input.operatorUserId, "admin-1");
      assert.equal(input.storagePlan.planVersion, "ai-grader-confirm-card-reference-plan-v1");
      assert.equal(input.storagePlan.imageReferences.length, 2);
      assert.equal(input.storagePlan.imageReferences.some((artifact) => "body" in artifact), false);
      assert.deepEqual(input.storagePlan.imageReferences.map((asset) => asset.sourceAssetSide), ["front", "back"]);
      assert.equal("publicReportUrl" in input.storagePlan, false);
      assert.equal("qrPayloadUrl" in input.storagePlan, false);
      assert.equal(input.storagePlan.storageKeyPrefix, "ai-grader/reports/sample-final-v0/");
      return {
        reportId: "sample-final-v0",
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        batchId: "batch-1",
        title: "1996 Fleer Michael Jordan #23",
        set: "Fleer",
        publicImageUrl: "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/assets/001-front-all-on-portrait-display.png",
        cardIdentity: {
          source: "card_asset",
          cardAssetId: "card-asset-1",
          itemId: "item-1",
          title: "1996 Fleer Michael Jordan #23",
          set: "Fleer",
          cardNumber: "23",
          displayTitle: "1996 Fleer Michael Jordan #23",
        },
        productionRelease: {
          ...productionRelease,
          cardInventoryLinkage: {
            status: "linked",
            cardAssetId: "card-asset-1",
            itemId: "item-1",
            note: "linked",
          },
        },
        itemLinkage: {
          itemNumberConvention: "Item.number = CardAsset.id",
        },
      };
    },
  });

  const req = mockRequest("POST", ["create-card-from-report"]);
  req.body = {
    publicationStatus: "finalized",
    reportBundle,
    productionRelease,
    identity: {
      category: "sport",
      playerName: "Michael Jordan",
      year: "1996",
      manufacturer: "Fleer",
      sport: "Basketball",
      productSet: "Fleer",
      cardNumber: "23",
      autograph: false,
      memorabilia: false,
    },
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { cardAssetId: string; itemId: string; productionRelease: { cardInventoryLinkage: { status: string } } } };
  assert.equal(body.ok, true);
  assert.equal(body.result.cardAssetId, "card-asset-1");
  assert.equal(body.result.itemId, "item-1");
  assert.equal(body.result.productionRelease.cardInventoryLinkage.status, "linked");
  assert.equal(createCalled, true);
});

test("create-card-from-report requires finalized unpublished semantics and never accepts published impersonation", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  let createCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("published Confirm must fail before persistence");
    },
    async createCardFromReport() {
      createCalled = true;
      throw new Error("published Confirm must fail before runtime");
    },
  });
  const req = mockRequest("POST", ["create-card-from-report"]);
  req.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease,
    identity: validConfirmedSportIdentity(),
  };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCodeValue, 400);
  assert.equal((res.jsonBody as any).code, "AI_GRADER_CONFIRM_FINALIZED_STATUS_REQUIRED");
  assert.match(String((res.jsonBody as any).message), /finalized, unpublished/i);
  assert.equal(createCalled, false);
});

test("Confirm reference plan uses canonical assets and never builds publication sidecars", () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const plan = buildAiGraderConfirmCardReferencePlan({
    reportBundle: { ...reportBundle, publicAssets: [] } as any,
    productionRelease,
    publicUrlFor: (key) => `https://cdn.tenkings.test/${key}`,
  });
  assert.deepEqual(plan.imageReferences.map((asset) => asset.sourceAssetSide), ["front", "back"]);
  assert.equal(plan.imageReferences.every((asset) => asset.sourceEvidenceRole === "normalized_card"), true);
  assert.equal(plan.imageReferences.some((asset) => "body" in asset || "bodyEncoding" in asset), false);
  assert.equal(plan.imageReferences.some((asset) => "storageKey" in asset || "publicUrl" in asset), false);
  assert.equal(plan.imageReferences.every((asset) => typeof asset.reservedStorageKey === "string"), true);
  assert.equal("artifacts" in plan, false);
  assert.equal("publicReportUrl" in plan, false);
  assert.equal("qrPayloadUrl" in plan, false);
});

test("Confirm rejects missing or invalid current-producer finding validation before runtime work", async () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  let createCalls = 0;
  const handler = createAiGraderProductionApiHandler({
    env: { [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true" },
    async requireAdminSession() { return { user: { id: "admin-1" } } as any; },
    publicUrlFor: (key) => `https://cdn.tenkings.test/${key}`,
    async persist() { throw new Error("Confirm finding failure must not persist"); },
    async createCardFromReport() { createCalls += 1; throw new Error("Confirm finding failure must not create"); },
  });
  const invalidValidations = [
    undefined,
    { status: "valid", sourceCandidateCount: 1, publishedFindingCount: 0, issues: [] },
  ];
  for (const findingValidation of invalidValidations) {
    const req = mockRequest("POST", ["create-card-from-report"]);
    req.body = {
      publicationStatus: "finalized",
      reportBundle: {
        ...reportBundle,
        visionLab: { ...reportBundle.visionLab, findingValidation },
      },
      productionRelease,
      identity: validConfirmedSportIdentity(),
    };
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCodeValue, 400);
    assert.match(String((res.jsonBody as any).message), /finding extraction/i);
  }
  assert.equal(createCalls, 0);
  assert.throws(
    () => buildAiGraderConfirmCardReferencePlan({
      reportBundle: {
        ...reportBundle,
        provisionalGrade: {
          ...reportBundle.provisionalGrade,
          gradeImpactCandidates: [{ id: "candidate", findingIds: ["missing-finding"] }],
        },
      } as any,
      productionRelease,
    }),
    /invalid defect finding reference/i,
  );
});

test("Confirm Card reports the exact source grade gate and does not invent a missing final grade", () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const blockedRelease = {
    ...productionRelease,
    reportStatus: "insufficient_evidence",
    finalStatus: "insufficient_evidence",
    finalGradeComputed: false,
    finalGrade: {
      ...productionRelease.finalGrade,
      status: "insufficient_evidence",
      overall: undefined,
      finalGradeComputed: false,
    },
  };
  const blockedBundle = {
    ...reportBundle,
    productionRelease: blockedRelease,
    provisionalGrade: {
      ...reportBundle.provisionalGrade,
      gates: {
        requiredGatesPassed: false,
        results: [
          {
            gate: "focus_sharpness",
            status: "fail",
            summary: "Minimum sharpness is 14.4081; soft target is 60.",
            evidenceRefs: ["analysis.front.allOn.sharpnessScore", "analysis.back.allOn.sharpnessScore"],
          },
          {
            gate: "element_score_coverage",
            status: "fail",
            summary: "Corner, edge, and surface diagnostics are incomplete.",
            evidenceRefs: ["analysis.provisionalGradeStory.elementScores"],
          },
        ],
        blockers: [
          "focus_sharpness: Minimum sharpness is 14.4081; soft target is 60.",
          "element_score_coverage: Corner, edge, and surface diagnostics are incomplete.",
        ],
      },
    },
  };
  assert.throws(
    () => assertAiGraderConfirmCardReady({
      publicationStatus: "finalized",
      reportBundle: blockedBundle as any,
      productionRelease: blockedRelease as any,
    }),
    (error: any) =>
      error.code === "AI_GRADER_CONFIRM_FINAL_GRADE_REQUIRED" &&
      /focus_sharpness/.test(error.message) &&
      /14\.4081/.test(error.message) &&
      !/label data|QR payload/i.test(error.message),
  );
});

test("Confirm Card rejects any submitted release divergence from the fetched bundle", () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const tampered = {
    ...productionRelease,
    gates: productionRelease.gates.map((gate: any, index: number) =>
      index === 0 ? { ...gate, reason: "caller changed authoritative gate evidence" } : gate),
  };
  assert.throws(
    () => assertAiGraderConfirmCardReady({
      publicationStatus: "finalized",
      reportBundle,
      productionRelease: tampered,
    }),
    (error: any) => error.code === "AI_GRADER_CONFIRM_RELEASE_IDENTITY_MISMATCH",
  );
});

test("Confirm Card rejects out-of-range or incomplete final grades", () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const invalidReleases = [
    { ...productionRelease, finalGrade: { ...productionRelease.finalGrade, overall: 11 } },
    {
      ...productionRelease,
      finalGrade: {
        ...productionRelease.finalGrade,
        finalGradeComputed: false,
      },
    },
  ];
  for (const release of invalidReleases) {
    assert.throws(
      () => assertAiGraderConfirmCardReady({
        publicationStatus: "finalized",
        reportBundle: { ...reportBundle, productionRelease: release } as any,
        productionRelease: release as any,
      }),
      (error: any) => error.code === "AI_GRADER_CONFIRM_FINAL_GRADE_REQUIRED",
    );
  }
});

test("Confirm Card rejects production gates without bounded evidence references", () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const invalidRelease = {
    ...productionRelease,
    gates: productionRelease.gates.map((gate: any, index: number) =>
      index === 0 ? { ...gate, evidenceRefs: [] } : gate),
  };
  assert.throws(
    () => assertAiGraderConfirmCardReady({
      publicationStatus: "finalized",
      reportBundle: { ...reportBundle, productionRelease: invalidRelease } as any,
      productionRelease: invalidRelease as any,
    }),
    (error: any) => error.code === "AI_GRADER_CONFIRM_RELEASE_GATES_INVALID",
  );
});

test("Confirm Card rejects invalid normalized evidence and producer provenance without weakening findings", () => {
  const { reportBundle, productionRelease } = sampleConfirmReadyPackage();
  const cases = [
    {
      expectedCode: "AI_GRADER_CONFIRM_CURRENT_PRODUCER_REQUIRED",
      reportBundle: { ...reportBundle, reportProducer: { contractVersion: "ai-grader-report-producer-v0.1", capabilities: [] } },
    },
    {
      expectedCode: "AI_GRADER_CONFIRM_CURRENT_PRODUCER_REQUIRED",
      reportBundle: {
        ...reportBundle,
        reportProducer: {
          contractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
          capabilities: ["finding-validation-v1", "raster-dimensions-v1"],
        },
      },
    },
    {
      expectedCode: "AI_GRADER_CONFIRM_NORMALIZED_EVIDENCE_REQUIRED",
      reportBundle: { ...reportBundle, assets: reportBundle.assets.filter((asset: any) => asset.side === "front") },
    },
    {
      expectedCode: "AI_GRADER_CONFIRM_NORMALIZED_EVIDENCE_REQUIRED",
      reportBundle: {
        ...reportBundle,
        assets: reportBundle.assets.map((asset: any) => asset.side === "back" ? { ...asset, contentType: "image/tiff" } : asset),
      },
    },
    {
      expectedCode: "AI_GRADER_CONFIRM_NORMALIZED_EVIDENCE_REQUIRED",
      reportBundle: {
        ...reportBundle,
        assets: reportBundle.assets.map((asset: any) => asset.side === "back" ? { ...asset, widthPx: 1199 } : asset),
      },
    },
    {
      expectedCode: "AI_GRADER_CONFIRM_NORMALIZED_EVIDENCE_REQUIRED",
      reportBundle: {
        ...reportBundle,
        assets: reportBundle.assets.map((asset: any) => asset.side === "back" ? { ...asset, checksumSha256: "tampered" } : asset),
      },
    },
  ];
  for (const entry of cases) {
    assert.throws(
      () => assertAiGraderConfirmCardReady({
        publicationStatus: "finalized",
        reportBundle: entry.reportBundle as any,
        productionRelease,
      }),
      (error: any) => error.code === entry.expectedCode,
    );
  }
});

test("create-card-from-report action rejects incomplete confirmed identity", async () => {
  const reportBundle = sampleStorageReadyReportBundle();
  const productionRelease = buildSampleAiGraderProductionRelease(reportBundle);
  let createCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("create-card should not presign uploads");
    },
    async persist() {
      throw new Error("create-card should not finalize production publish");
    },
    async createCardFromReport() {
      createCalled = true;
      throw new Error("incomplete identity should be rejected before runtime");
    },
  });

  const req = mockRequest("POST", ["create-card-from-report"]);
  req.body = {
    publicationStatus: "published",
    reportBundle,
    productionRelease,
    identity: {
      category: "sport",
      playerName: "Michael Jordan",
      year: "1996",
      manufacturer: "Fleer",
      autograph: false,
      memorabilia: false,
    },
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  const body = res.jsonBody as { ok: boolean; code?: string; message: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "AI_GRADER_INCOMPLETE_CARD_IDENTITY");
  assert.match(body.message, /sport|required|productSet|cardNumber/);
  assert.equal(createCalled, false);
});

test("legacy slabbed photo body upload is rejected by the production API", async () => {
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("slab upload should not use release artifact upload");
    },
    async persist() {
      throw new Error("slab upload should not persist production release");
    },
  });

  const req = mockRequest("POST", ["upload-slab-photo"]);
  req.body = {
    reportId: "sample-final-v0",
    side: "front",
    fileName: "front.png",
    dataUrl: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 400);
  const body = res.jsonBody as { ok: boolean; message: string };
  assert.equal(body.ok, false);
  assert.match(body.message, /Unsafe AI Grader publish payload field rejected/);
});

test("slabbed photo direct upload init/finalize persists through the env-gated production API", async () => {
  let finalized = false;
  const imageChecksum = sha256Hex("hello");
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload(input) {
      assert.equal(Object.prototype.hasOwnProperty.call(input as Record<string, unknown>, "metadata"), false);
      assert.match(input.storageKey, /^ai-grader\/reports\/sample-final-v0\/slabbed\/front-/);
      assert.equal(input.contentType, "image/png");
      assert.equal(input.checksumSha256, imageChecksum);
      const presigned = presignForTest(input);
      return { ...presigned, uploadHeaders: {
        ...presigned.uploadHeaders,
        "x-amz-meta-sha256": "unsafe-future-regression",
      } };
    },
    async verifyUploadedArtifact(input) {
      assert.equal(input.byteSize, 5);
      assert.equal(input.checksumSha256, imageChecksum);
      assert.equal(input.sourceImageWidthPx, 640);
      assert.equal(input.sourceImageHeightPx, 900);
      return {
        ok: true,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        contentType: input.contentType,
        widthPx: input.sourceImageWidthPx,
        heightPx: input.sourceImageHeightPx,
      };
    },
    async persist() {
      throw new Error("slab upload should not persist production release");
    },
    async finalizeSlabbedPhotoUpload(input) {
      finalized = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.side, "front");
      assert.equal(input.mimeType, "image/png");
      assert.equal(input.byteSize, 5);
      assert.equal(input.checksumSha256, imageChecksum);
      assert.equal(input.widthPx, 640);
      assert.equal(input.heightPx, 900);
      assert.match(input.storageKey, /^ai-grader\/reports\/sample-final-v0\/slabbed\/front-/);
      assert.equal(input.operatorUserId, "admin-1");
      assert.deepEqual(
        {
          actorType: input.actorAudit?.actorType,
          action: input.actorAudit?.action,
          userId: input.actorAudit?.userId,
          role: input.actorAudit?.role,
        },
        {
          actorType: "human_operator",
          action: "upload-slab-photo",
          userId: "admin-1",
          role: "ai_grader_admin",
        }
      );
      return {
        reportId: input.reportId,
        side: input.side,
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256,
        widthPx: input.widthPx,
        heightPx: input.heightPx,
        persisted: true,
      };
    },
  });

  const initReq = mockRequest("POST", ["slabbed-photo-init"]);
  initReq.body = {
    reportId: "sample-final-v0",
    side: "front",
    fileName: "front.png",
    mimeType: "image/png",
    byteSize: 5,
    checksumSha256: imageChecksum,
    widthPx: 640,
    heightPx: 900,
  };
  const initRes = mockResponse();
  await handler(initReq, initRes);

  assert.equal(initRes.statusCodeValue, 200);
  const initBody = initRes.jsonBody as {
    ok: boolean;
    result: { uploadHeaders: Record<string, string>; requiredFinalizeManifest: Record<string, unknown> };
  };
  assert.equal(initBody.ok, true);
  assert.equal(initBody.result.uploadHeaders["Content-Type"], "image/png");
  assert.equal(Object.prototype.hasOwnProperty.call(initBody.result.uploadHeaders, "x-amz-meta-sha256"), false);
  assert.equal(initBody.result.uploadHeaders["x-amz-checksum-sha256"], sha256Base64FromHex(imageChecksum));
  assert.equal(initBody.result.requiredFinalizeManifest.widthPx, 640);
  assert.equal(initBody.result.requiredFinalizeManifest.heightPx, 900);

  const finalizeReq = mockRequest("POST", ["slabbed-photo-finalize"]);
  finalizeReq.body = initBody.result.requiredFinalizeManifest;
  const res = mockResponse();
  await handler(finalizeReq, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { persisted: boolean; publicUrl: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.persisted, true);
  assert.match(body.result.publicUrl, /slabbed\/front-/);
  assert.equal(finalized, true);
});

test("slabbed photo finalize rejects missing or mismatched storage-decoded dimensions before persistence", async () => {
  const imageChecksum = sha256Hex("hello");
  for (const decoded of [
    { widthPx: 641, heightPx: 900 },
    { widthPx: undefined, heightPx: undefined },
  ]) {
    let finalized = false;
    const handler = createAiGraderProductionApiHandler({
      env: {
        [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
        AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
      },
      async requireAdminSession() {
        return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
      },
      publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
      async presignUpload(input) {
        return presignForTest(input);
      },
      async verifyUploadedArtifact(input) {
        return {
          ok: true,
          byteSize: input.byteSize,
          checksumSha256: input.checksumSha256,
          contentType: input.contentType,
          widthPx: decoded.widthPx,
          heightPx: decoded.heightPx,
        };
      },
      async persist() {
        throw new Error("slab upload should not persist production release");
      },
      async finalizeSlabbedPhotoUpload(input) {
        finalized = true;
        return {
          reportId: input.reportId,
          side: input.side,
          storageKey: input.storageKey,
          publicUrl: input.publicUrl,
          byteSize: input.byteSize,
          checksumSha256: input.checksumSha256,
          widthPx: input.widthPx,
          heightPx: input.heightPx,
          persisted: true,
        };
      },
    });
    const initReq = mockRequest("POST", ["slabbed-photo-init"]);
    initReq.body = {
      reportId: "sample-final-v0",
      side: "front",
      fileName: "front.png",
      mimeType: "image/png",
      byteSize: 5,
      checksumSha256: imageChecksum,
      widthPx: 640,
      heightPx: 900,
    };
    const initRes = mockResponse();
    await handler(initReq, initRes);
    assert.equal(initRes.statusCodeValue, 200);

    const finalizeReq = mockRequest("POST", ["slabbed-photo-finalize"]);
    finalizeReq.body = (initRes.jsonBody as any).result.requiredFinalizeManifest;
    const finalizeRes = mockResponse();
    await handler(finalizeReq, finalizeRes);
    assert.equal(finalizeRes.statusCodeValue, 400);
    assert.match(String((finalizeRes.jsonBody as any).message), /dimensions mismatch/);
    assert.equal(finalized, false);
  }
});

test("eBay comps action reports ready without live execution when env is disabled", async () => {
  let liveCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("comps should not upload release artifacts");
    },
    async persist() {
      throw new Error("comps should not persist production release");
    },
    async runComps() {
      liveCalled = true;
      throw new Error("live comps should not run while disabled");
    },
  });
  const req = mockRequest("POST", ["run-comps"]);
  req.body = {
    reportBundle: {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
    },
    productionRelease: buildSampleAiGraderProductionRelease({
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
    }),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { status: string; liveExecutionEnabled: boolean; searchQuery?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.status, "ready");
  assert.equal(body.result.liveExecutionEnabled, false);
  assert.equal(body.result.searchQuery, undefined);
  assert.equal(liveCalled, false);
});

test("eBay comps reports an honest retryable state when enabled without SerpApi configuration", async () => {
  let liveCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_EBAY_COMPS_ENABLED_ENV]: "true",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("comps should not publish a release");
    },
    async runComps() {
      liveCalled = true;
      throw new Error("runner must not start without SerpApi readiness");
    },
  });
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "sample-final-v0",
    cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
  };
  const req = mockRequest("POST", ["run-comps"]);
  req.body = {
    reportBundle: finalBundle,
    productionRelease: buildSampleAiGraderProductionRelease(finalBundle),
  };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCodeValue, 200);
  const result = (res.jsonBody as any).result;
  assert.equal(result.status, "failed");
  assert.equal(result.retryable, true);
  assert.equal(result.persisted, false);
  assert.equal(result.compsRefs.length, 0);
  assert.equal(result.errorCode, "AI_GRADER_SERPAPI_NOT_CONFIGURED");
  assert.equal(liveCalled, false);
});

test("eBay comps action returns candidates and selected comps persist separately", async () => {
  let selectedPersisted = false;
  const persistedCompsStatuses: string[] = [];
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_EBAY_COMPS_ENABLED_ENV]: "true",
      SERPAPI_KEY: "redacted-test-key",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("comps should not upload release artifacts");
    },
    async persist() {
      throw new Error("comps should not persist production release");
    },
    async runComps(input) {
      assert.equal(input.searchQuery, "Persisted Michael Jordan Confirmed Identity");
      return {
        searchQuery: input.searchQuery,
        searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan",
        compsRefs: [
          {
            id: "comp-1",
            source: "ebay_sold",
            title: "Michael Jordan sold listing",
            url: "https://www.ebay.com/itm/1234567890",
            price: "$100.00",
          },
        ],
        resultSummary: { valuationMinor: 10000, valuationCurrency: "USD" },
      };
    },
    async persistComps(input) {
      persistedCompsStatuses.push(input.status);
      assert.equal(input.reportId, "sample-final-v0");
      return {
        status: input.status,
        valuation: { searchQuery: "Persisted Michael Jordan Confirmed Identity" },
      };
    },
    async persistSelectedComps(input) {
      selectedPersisted = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.requestedByUserId, "admin-1");
      assert.equal(input.selectedComps.length, 1);
      assert.deepEqual(
        {
          actorType: input.actorAudit?.actorType,
          action: input.actorAudit?.action,
          userId: input.actorAudit?.userId,
          role: input.actorAudit?.role,
        },
        {
          actorType: "human_operator",
          action: "run-comps",
          userId: "admin-1",
          role: "ai_grader_admin",
        }
      );
      return {
        reportId: input.reportId,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        evidenceItemCount: 1,
        valuationMinor: 10000,
        valuationCurrency: "USD",
        valuationStatus: "completed",
      };
    },
  });
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "sample-final-v0",
    cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
  };
  const req = mockRequest("POST", ["run-comps"]);
  req.body = {
    reportBundle: finalBundle,
    productionRelease: buildSampleAiGraderProductionRelease(finalBundle),
    searchQuery: "Tampered Browser Query",
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { status: string; persisted: boolean; compsRefs: unknown[] } };
  assert.equal(body.ok, true);
  assert.equal(body.result.status, "ready");
  assert.equal(body.result.persisted, true);
  assert.equal(body.result.compsRefs.length, 1);
  assert.deepEqual(persistedCompsStatuses, ["running", "ready"]);

  const saveReq = mockRequest("POST", ["save-comps-selection"]);
  saveReq.body = {
    reportId: "sample-final-v0",
    selectedComps: body.result.compsRefs,
    searchQuery: "Michael Jordan",
    searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan",
  };
  const saveRes = mockResponse();
  await handler(saveReq, saveRes);

  assert.equal(saveRes.statusCodeValue, 200);
  const saveBody = saveRes.jsonBody as { ok: boolean; result: { evidenceItemCount: number; valuationMinor: number } };
  assert.equal(saveBody.ok, true);
  assert.equal(saveBody.result.evidenceItemCount, 1);
  assert.equal(saveBody.result.valuationMinor, 10000);
  assert.equal(selectedPersisted, true);
});

test("comps persistence rejects completed reviews and overlapping live attempts", async () => {
  for (const fixture of [
    {
      current: { status: "completed", resultSummary: {}, updatedAt: new Date() },
      code: "AI_GRADER_COMPS_ALREADY_COMPLETED",
    },
    {
      current: { status: "running", resultSummary: { attemptId: "existing-attempt" }, updatedAt: new Date() },
      code: "AI_GRADER_COMPS_ALREADY_RUNNING",
    },
    {
      current: {
        status: "ready",
        resultSummary: { lifecycleStatus: "ready", attemptId: "completed-attempt" },
        updatedAt: new Date(),
      },
      code: "AI_GRADER_COMPS_ALREADY_READY",
    },
  ]) {
    const tx = {
      async $queryRaw() {
        return [];
      },
      aiGraderValuation: {
        async findUnique() {
          return fixture.current;
        },
      },
    };
    const dbClient = {
      async $transaction<T>(run: (client: typeof tx) => Promise<T>) {
        return run(tx);
      },
    };
    await assert.rejects(
      () =>
        persistAiGraderCompsRuntime({
          tenantId: "tenant-1",
          reportId: "sample-final-v0",
          status: "running",
          attemptId: "new-attempt",
          dbClient,
        }),
      (error: any) => error?.code === fixture.code
    );
  }
});

test("selected comps are matched to persisted candidates and average persisted prices", async () => {
  const evidenceWrites: Array<Record<string, any>> = [];
  const cardUpdates: Array<Record<string, any>> = [];
  const itemUpdates: Array<Record<string, any>> = [];
  const valuationUpserts: Array<Record<string, any>> = [];
  const report = {
    id: "report-row-1",
    tenantId: "tenant-1",
    sessionId: "session-1",
    reportId: "sample-final-v0",
    publicationStatus: "published",
    cardAssetId: "card-1",
    itemId: "item-1",
  };
  const valuation = {
    status: "ready",
    searchQuery: "Michael Jordan sold",
    valuationCurrency: "USD",
    compsRefs: [
      { id: "comp-1", url: "https://www.ebay.com/itm/1", title: "One", price: "$100.00" },
      { id: "comp-2", url: "https://www.ebay.com/itm/2", title: "Two", price: "$300.00" },
    ],
    resultSummary: { searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Michael+Jordan" },
  };
  const tx = {
    async $queryRaw() {
      return [];
    },
    aiGraderReport: {
      async findUnique() {
        return report;
      },
    },
    aiGraderValuation: {
      async findUnique() {
        return valuation;
      },
      async upsert(input: Record<string, any>) {
        valuationUpserts.push(input);
        return { id: "valuation-1", ...input.update };
      },
    },
    cardEvidenceItem: {
      async findFirst() {
        return null;
      },
      async create(input: Record<string, any>) {
        evidenceWrites.push(input);
        return { id: `evidence-${evidenceWrites.length}` };
      },
    },
    cardAsset: {
      async update(input: Record<string, any>) {
        cardUpdates.push(input);
        return { id: "card-1" };
      },
    },
    item: {
      async findUnique() {
        return { id: "item-1", detailsJson: {} };
      },
      async update(input: Record<string, any>) {
        itemUpdates.push(input);
        return { id: "item-1" };
      },
    },
  };
  const dbClient = {
    async $transaction<T>(run: (client: typeof tx) => Promise<T>) {
      return run(tx);
    },
  };

  const result = await persistAiGraderSelectedCompsRuntime({
    tenantId: "tenant-1",
    reportId: "sample-final-v0",
    selectedComps: [
      { id: "comp-1", url: "https://www.ebay.com/itm/1", price: "$1.00" },
      { id: "comp-2", url: "https://www.ebay.com/itm/2", price: "$2.00" },
    ],
    requestedByUserId: "admin-1",
    dbClient,
  });

  assert.equal(result.valuationMinor, 20000);
  assert.deepEqual(evidenceWrites.map((write) => write.data.price), ["$100.00", "$300.00"]);
  assert.equal(cardUpdates[0].data.valuationMinor, 20000);
  assert.equal(itemUpdates[0].data.estimatedValue, 20000);
  assert.equal(valuationUpserts[0].update.valuationMinor, 20000);

  await assert.rejects(
    () =>
      persistAiGraderSelectedCompsRuntime({
        tenantId: "tenant-1",
        reportId: "sample-final-v0",
        selectedComps: [{ id: "fake", url: "https://www.ebay.com/itm/not-persisted", price: "$9999.00" }],
        requestedByUserId: "admin-1",
        dbClient,
      }),
    (error: any) => error?.code === "AI_GRADER_SELECTED_COMP_NOT_PERSISTED"
  );
});

test("service accounts cannot approve selected comps or valuation", async () => {
  let persisted = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_SERVICE_ACCOUNT_ID_ENV]: "ai-grader-comps-service",
      [AI_GRADER_SERVICE_ACCOUNT_TOKEN_SHA256_ENV]: sha256Hex("comps-service-token"),
      [AI_GRADER_SERVICE_ACCOUNT_SCOPES_ENV]: "run-comps",
    },
    async requireAdminSession() {
      throw new Error("service account should not use admin auth");
    },
    async requireUserSession() {
      throw new Error("service account should not use bearer auth");
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("selected comps should not publish a release");
    },
    async persistSelectedComps() {
      persisted = true;
      throw new Error("service account selection must not persist");
    },
  });
  const req = mockRequest("POST", ["save-comps-selection"]);
  req.headers["x-ai-grader-service-token"] = "comps-service-token";
  req.body = {
    reportId: "sample-final-v0",
    selectedComps: [{ id: "comp-1", url: "https://www.ebay.com/itm/1", price: "$100.00" }],
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 403);
  assert.match((res.jsonBody as { message: string }).message, /human operator session/i);
  assert.equal(persisted, false);
});

test("eBay comps failures persist a sanitized retryable error for Finish Cards", async () => {
  const persisted: Array<{ status: string; resultSummary?: unknown; errorCode?: string | null }> = [];
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      [AI_GRADER_EBAY_COMPS_ENABLED_ENV]: "true",
      SERPAPI_KEY: "redacted-test-key",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return { user: { id: "admin-1", phone: null, displayName: "Admin" } } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async persist() {
      throw new Error("comps should not publish a release");
    },
    async persistComps(input) {
      persisted.push({ status: input.status, resultSummary: input.resultSummary, errorCode: input.errorCode });
      return {
        status: input.status,
        valuation: { searchQuery: "Persisted Michael Jordan Confirmed Identity" },
      };
    },
    async runComps() {
      const error = new Error("SerpApi timeout at /var/task/private/worker.js api_key=do-not-leak") as Error & {
        statusCode?: number;
      };
      error.statusCode = 503;
      throw error;
    },
  });
  const finalBundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "sample-final-v0",
    cardIdentity: { ...SAMPLE_AI_GRADER_REPORT_BUNDLE.cardIdentity, title: "Michael Jordan Test Card" },
  };
  const req = mockRequest("POST", ["run-comps"]);
  req.body = {
    reportBundle: finalBundle,
    productionRelease: buildSampleAiGraderProductionRelease(finalBundle),
  };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { result: { status: string; persisted: boolean; retryable: boolean; message: string } };
  assert.equal(body.result.status, "failed");
  assert.equal(body.result.persisted, true);
  assert.equal(body.result.retryable, true);
  assert.match(body.result.message, /SerpApi timeout/);
  assert.doesNotMatch(body.result.message, /do-not-leak/);
  assert.doesNotMatch(body.result.message, /\/var\/task|worker\.js/);
  assert.deepEqual(persisted.map((entry) => entry.status), ["running", "failed"]);
  assert.equal(persisted[1].errorCode, "AI_GRADER_EBAY_COMPS_RETRYABLE");
});

test("legacy per-label print action is retired so sheet print state cannot be bypassed", async () => {
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("mark-label-printed should not upload");
    },
    async persist() {
      throw new Error("mark-label-printed should not publish-finalize");
    },
  });
  const req = mockRequest("POST", ["mark-label-printed"]);
  req.body = { reportId: "sample-final-v0" };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 410);
  const body = res.jsonBody as { ok: boolean; code: string; message: string };
  assert.equal(body.ok, false);
  assert.equal(body.code, "AI_GRADER_PER_LABEL_PRINT_RETIRED");
  assert.match(body.message, /label sheets page/i);
});

test("add-to-inventory action is publish-scoped and returns inventory-ready linkage", async () => {
  let addCalled = false;
  const handler = createAiGraderProductionApiHandler({
    env: {
      [AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV]: "true",
      AI_GRADER_PRODUCTION_TENANT_ID: "tenant-1",
    },
    async requireAdminSession() {
      return {
        user: { id: "admin-1", phone: null, displayName: "Admin" },
      } as any;
    },
    publicUrlFor: (storageKey) => `https://cdn.tenkings.test/${storageKey}`,
    async presignUpload() {
      throw new Error("add-to-inventory should not upload");
    },
    async persist() {
      throw new Error("add-to-inventory should not publish-finalize");
    },
    async addToInventory(input) {
      addCalled = true;
      assert.equal(input.tenantId, "tenant-1");
      assert.equal(input.reportId, "sample-final-v0");
      assert.equal(input.operatorUserId, "admin-1");
      assert.equal(input.actorAudit?.action, "publish");
      return {
        reportId: input.reportId,
        cardAssetId: "card-asset-1",
        itemId: "item-1",
        reviewStage: "INVENTORY_READY_FOR_SALE",
        labelPairId: "TKPAIR",
      };
    },
  });
  const req = mockRequest("POST", ["add-to-inventory"]);
  req.body = { reportId: "sample-final-v0" };
  const res = mockResponse();
  await handler(req, res);

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as { ok: boolean; result: { reviewStage: string; itemId: string } };
  assert.equal(body.ok, true);
  assert.equal(body.result.reviewStage, "INVENTORY_READY_FOR_SALE");
  assert.equal(body.result.itemId, "item-1");
  assert.equal(addCalled, true);
});

test("add-to-inventory rejects missing printed label in persisted readiness", async () => {
  await assert.rejects(
    () =>
      validateAiGraderInventoryReadiness(
        inventoryReadinessDb({
          label: { id: "label-1", physicalPrintStatus: "not_printed" },
        }),
        "sample-final-v0"
      ),
    (error: any) => error?.code === "AI_GRADER_LABEL_PRINT_REQUIRED" && /label must be marked printed/i.test(error.message)
  );
});

test("add-to-inventory rejects missing slabbed front/back persisted photos", async () => {
  await assert.rejects(
    () =>
      validateAiGraderInventoryReadiness(
        inventoryReadinessDb({
          slabbedAssets: [
            {
              id: "front-photo",
              side: "front",
              storageKey: "ai-grader/reports/sample-final-v0/slabbed/front.png",
              publicUrl: "https://cdn.tenkings.test/ai-grader/reports/sample-final-v0/slabbed/front.png",
              byteSize: 12,
            },
          ],
        }),
        "sample-final-v0"
      ),
    (error: any) => error?.code === "AI_GRADER_SLABBED_PHOTOS_REQUIRED" && /slabbed front and back photos/i.test(error.message)
  );
});

test("add-to-inventory rejects missing completed valuation", async () => {
  await assert.rejects(
    () =>
      validateAiGraderInventoryReadiness(
        inventoryReadinessDb({
          valuation: { id: "valuation-1", status: "completed", valuationMinor: 0 },
        }),
        "sample-final-v0"
      ),
    (error: any) => error?.code === "AI_GRADER_COMPLETED_VALUATION_REQUIRED" && /completed valuation/i.test(error.message)
  );
});

test("public report API is read-only and disabled unless explicitly configured", async () => {
  let postReadCalled = false;
  const postHandler = createAiGraderPublicReportApiHandler({
    env: { [AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV]: "true" },
    async readPublishedBundle() {
      postReadCalled = true;
      throw new Error("POST should not read public report data");
    },
  });
  const postRes = mockResponse();
  const postReq = mockRequest("POST");
  postReq.query = { reportId: "sample-final-v0" };
  await postHandler(postReq, postRes);
  assert.equal(postRes.statusCodeValue, 405);
  assert.equal(postRes.headers.Allow, "GET");
  assert.equal(postReadCalled, false);

  const disabled = createAiGraderPublicReportApiHandler({
    env: {},
    async readPublishedBundle() {
      throw new Error("read should not run while disabled");
    },
  });
  const disabledRes = mockResponse();
  const disabledReq = mockRequest("GET");
  disabledReq.query = { reportId: "sample-final-v0" };
  await disabled(disabledReq, disabledRes);
  assert.equal(disabledRes.statusCodeValue, 503);

  const enabled = createAiGraderPublicReportApiHandler({
    env: { [AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV]: "true" },
    async readPublishedBundle(reportId) {
      assert.equal(reportId, "sample-final-v0");
      return getAiGraderReportBundle("sample-final-v0");
    },
  });
  const enabledRes = mockResponse();
  const enabledReq = mockRequest("GET");
  enabledReq.query = { reportId: "sample-final-v0" };
  await enabled(enabledReq, enabledRes);
  assert.equal(enabledRes.statusCodeValue, 200);
  const body = enabledRes.jsonBody as { ok: boolean; readOnly: boolean; noHardwareControls: boolean; bundle: { reportId: string } };
  assert.equal(body.ok, true);
  assert.equal(body.readOnly, true);
  assert.equal(body.noHardwareControls, true);
  assert.equal(body.bundle.reportId, "sample-final-v0");

  const missing = createAiGraderPublicReportApiHandler({
    env: { [AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV]: "true" },
    async readPublishedBundle() {
      return null;
    },
  });
  const missingRes = mockResponse();
  const missingReq = mockRequest("GET");
  missingReq.query = { reportId: "missing-storage-report" };
  await missing(missingReq, missingRes);
  assert.equal(missingRes.statusCodeValue, 404);
});

test("local station sample history aggregates report stats without certified claims", () => {
  const history = buildSampleAiGraderReportHistory();
  assert.equal(history.source, "fixture");
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].viewerPath, "/ai-grader/reports/sample-pr45");
  assert.equal(history.stats.allTime, 1);
  assert.equal(history.stats.provisionalGradeCounts["8"], 1);
  assert.equal(history.stats.finalizedCount, 0);
  assert.equal(history.stats.draftCount, 1);
  assert.equal(history.stats.warningsCount, 1);
  assert.equal(hasNoFinalCertifiedClaims(SAMPLE_AI_GRADER_REPORT_BUNDLE), true);
});

test("AI Grader report image resolver keeps public URLs storage-backed and local bodies operator-only", () => {
  const bodyBase64 = Buffer.from("front-image").toString("base64");
  const bundle = {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    assets: [
      {
        id: "front/front-all-on-portrait-display.png",
        kind: "image",
        fileName: "front-all-on-portrait-display.png",
        contentType: "image/png",
        publicUrl: "C:\\TenKings\\capture-data\\front.png",
        bodyEncoding: "base64",
        bodyBase64,
      },
      {
        id: "back/back-all-on-portrait-display.png",
        kind: "image",
        fileName: "back-all-on-portrait-display.png",
        contentType: "image/png",
        publicUrl: "https://cdn.tenkings.test/back.png",
      },
    ],
  };

  const publicImages = reportImageAssets(bundle);
  assert.equal(publicImages.length, 1);
  assert.equal(publicImages[0].renderUrl, "https://cdn.tenkings.test/back.png");
  assert.equal(publicImages[0].renderSource, "public_url");

  const localImages = reportImageAssets(bundle, { allowEmbeddedBodies: true });
  assert.equal(localImages.length, 2);
  assert.equal(localImages.some((image) => image.renderUrl === `data:image/png;base64,${bodyBase64}`), true);
  assert.equal(localImages.some((image) => image.renderUrl.includes("C:\\TenKings")), false);
});

test("AI Grader publish stage errors distinguish storage CORS reachability from HTTP responses", () => {
  const corsMessage = formatAiGraderPublishStageError({
    stage: "direct-storage-upload",
    error: new TypeError("Failed to fetch"),
    artifact: {
      index: 2,
      total: 9,
      kind: "front/front-all-on-portrait-display.png",
    },
  });
  assert.match(corsMessage, /Direct storage upload could not reach storage; likely storage CORS\/preflight/);
  assert.match(corsMessage, /artifact 3\/9/);
  assert.match(corsMessage, /front-all-on-portrait-display\.png/);
  assert.doesNotMatch(corsMessage, /front\/front-all/);
  assert.doesNotMatch(corsMessage, /ai-grader\/reports|storageKey/);

  const httpMessage = formatAiGraderPublishStageError({
    stage: "direct-storage-upload",
    error: new Error("HTTP 403"),
    artifact: {
      index: 0,
      total: 9,
      kind: "report-bundle.json",
    },
  });
  assert.match(httpMessage, /Direct storage upload failed for artifact 1\/9 report-bundle\.json/);
  assert.match(httpMessage, /HTTP 403/);
  assert.doesNotMatch(httpMessage, /CORS\/preflight/);

  assert.match(formatAiGraderPublishStageError({ stage: "publish-init", error: new TypeError("Failed to fetch") }), /publish-init failed/);
  assert.match(formatAiGraderPublishStageError({ stage: "local-asset-read", error: new TypeError("Failed to fetch") }), /Local asset read failed/);
  assert.match(formatAiGraderPublishStageError({ stage: "publish-finalize", error: new TypeError("Failed to fetch") }), /publish-finalize failed/);
  assert.match(formatAiGraderPublishStageError({ stage: "public-report-verification", error: new TypeError("Failed to fetch") }), /public report verification failed/);
});

test("AI Grader station source opens reports inline without popup dependency", () => {
  const stationPath =
    [path.join(process.cwd(), "pages", "ai-grader", "station.tsx"), path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx")]
      .find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const stationSource = fs.readFileSync(stationPath, "utf8");
  assert.equal(stationSource.includes("window.open("), false);
  assert.equal(stationSource.includes("Allow pop-ups"), false);
  assert.equal(stationSource.includes("fetchAiGraderStationReportBundle"), true);
  assert.equal(stationSource.includes("fetchAiGraderStationReportAsset"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/auth-check"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/create-card-from-report"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/publish-init"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/publish-finalize"), true);
  assert.equal(stationSource.includes("...(Array.isArray(bundle.publicAssets)"), true);
  assert.equal(
    stationSource.includes("publicAssets: (sanitized.publicAssets ?? []).map"),
    true,
  );
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/slabbed-photo-init"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/slabbed-photo-finalize"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/mark-label-printed"), false);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/save-comps-selection"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/add-to-inventory"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/upload-slab-photo"), false);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/publish\""), false);
  assert.equal(stationSource.includes("selectedIds: []"), true);
  assert.equal(stationSource.includes('<option value="unknown">Unknown</option>'), false);
  const createCardFunctionSource = stationSource.slice(
    stationSource.indexOf("const createCardFromConfirmedIdentity"),
    stationSource.indexOf("const searchCardItems")
  );
  const publishFunctionSource = stationSource.slice(
    stationSource.indexOf("const publishToTenKingsSystem"),
    stationSource.indexOf("const uploadSlabbedPhoto")
  );
  const slabbedUploadSource = stationSource.slice(
    stationSource.indexOf("const uploadSlabbedPhoto"),
    stationSource.indexOf("const runEbayComps")
  );
  assert.equal(createCardFunctionSource.includes("resolveAiGraderAuthoritativeProductionPackage"), true);
  assert.equal(createCardFunctionSource.includes("explicitlyFinalize: prepareLocalProductionRelease"), true);
  assert.equal(createCardFunctionSource.includes('publicationStatus: "finalized"'), true);
  assert.equal(createCardFunctionSource.includes('publicationStatus: "published"'), false);
  assert.equal(publishFunctionSource.includes("resolveAiGraderAuthoritativeProductionPackage"), true);
  assert.equal(publishFunctionSource.includes("explicitlyFinalize: prepareLocalProductionRelease"), true);
  assert.equal(publishFunctionSource.includes('publicationStatus: "published"'), true);
  assert.doesNotMatch(stationSource, /sourceBundle\?\.productionRelease\s*\?\?\s*latestStatus\.productionRelease/);
  assert.equal(publishFunctionSource.includes("includeAssetBodies"), false);
  assert.equal(publishFunctionSource.includes("formatAiGraderPublishStageError"), true);
  assert.equal(publishFunctionSource.includes("uploadAiGraderArtifactDirectly"), true);
  assert.equal(publishFunctionSource.includes('mode: "cors"'), false);
  assert.equal(slabbedUploadSource.includes("formatAiGraderPublishStageError"), true);
  assert.equal(slabbedUploadSource.includes("uploadAiGraderArtifactDirectly"), true);
  assert.equal(slabbedUploadSource.includes('mode: "cors"'), false);
  assert.equal(stationSource.includes("readAsDataURL"), false);
  assert.equal(stationSource.includes("dataUrl"), false);
  assert.equal(stationSource.includes("Confirm + Create Card"), true);
  assert.equal(stationSource.includes("Production Sign-In"), true);
  assert.equal(stationSource.includes("Production sign-in verified as"), true);
  assert.equal(stationSource.includes("productionAuthState.status === \"completed\""), true);
  assert.equal(stationSource.includes("const productionSignedIn = Boolean(session?.token);"), false);
  assert.equal(stationSource.includes("statusCode !== 401"), true);
  assert.equal(stationSource.includes("ensureSession({"), true);
  assert.equal(stationSource.includes("force: true"), true);
  assert.equal(stationSource.includes("Your saved sign-in expired"), true);
  assert.equal(stationSource.includes("You are signed in, but not authorized for AI Grader"), true);
  assert.equal(stationSource.includes("AI Grader operator role required. Sign in with an AI Grader operator/admin account."), false);
  assert.equal(stationSource.includes("Sign In + Create Card"), true);
  assert.equal(stationSource.includes("Production sign-in is required before the CardAsset/Item can be created."), true);
  assert.equal(stationSource.includes("guide-card"), false);
  assert.equal(stationSource.includes("crosshair horizontal"), false);
  assert.equal(stationSource.includes("REPORT_OVERLAY_CARD_HEIGHT_RATIO = 0.97"), true);
  assert.equal(stationSource.includes("REPORT_OVERLAY_CARD_ASPECT_RATIO = 2.5 / 3.5"), true);
  assert.equal(stationSource.includes("report-framing-overlay"), true);
  assert.equal(stationSource.includes("card-geometry-overlay"), true);
  assert.equal(stationSource.includes("card-geometry-badge"), true);
  assert.equal(stationSource.includes("aiGraderCardPlacementLabel"), true);
  assert.equal(stationSource.includes("sanitizeAiGraderPreviewCardGeometryBySide"), true);
  assert.equal(stationSource.includes("window.setInterval(() => void refreshGeometry(), PREVIEW_GEOMETRY_STATUS_POLL_MS)"), true);
  assert.equal(stationSource.includes("reportOverlayTemplateRect"), true);
  assert.equal(stationSource.includes("containedImageFrame(cameraFrameSize, reportOverlayFrameSize)"), true);
  assert.equal(stationSource.includes("#ffd400"), true);
  assert.equal(stationSource.includes("#00e5ff"), true);
  assert.equal(stationSource.includes("Mark Label Printed"), false);
  assert.equal(stationSource.includes("Save Selected Comps"), true);
  assert.equal(stationSource.includes("Add To Inventory"), true);
  assert.equal(stationSource.includes("Finish Cards"), true);
  assert.equal(stationSource.includes("Finish This Card"), false);
  assert.equal(stationSource.includes('href="/ai-grader/finish"'), true);
  assert.equal(stationSource.includes('href="/ai-grader/labels/sheets"'), true);
  assert.equal(stationSource.includes("Publish + Queue Label"), true);
  assert.equal(stationSource.includes("launchConfirmedCardComps"), true);
  assert.equal(stationSource.includes("Sheet ${confirmedDownstream.labelSheet.sheetNumber} / Slot"), true);
  assert.equal(stationSource.includes("Start Next Grade"), true);
  assert.equal(stationSource.includes("requestError instanceof AiGraderOcrPrefillStageError"), true);
  assert.equal(stationSource.includes("failureCode: typedFailure.failureCode"), true);
  assert.equal(stationSource.includes("failureCategory: typedFailure.failureCategory"), true);
  assert.equal(stationSource.includes("failureLabel: typedFailure.failureLabel"), true);
  assert.equal(stationSource.includes("ocrPrefillState.failureLabel"), true);
  assert.equal(stationSource.includes("/api/admin/ai-grader/production/finish-queue"), true);
  assert.equal(stationSource.includes("gradePipelineSteps"), true);
  assert.equal(stationSource.includes("finishPipelineSteps"), true);
  assert.equal(stationSource.includes("Upload Slab Photos"), true);
  assert.equal(stationSource.includes("Mark Slabbed"), false);
  assert.equal(stationSource.includes("backPositioningActive"), true);
  assert.equal(stationSource.includes('busy === "back"'), false);
  assert.equal(stationSource.includes('busy === "capture-back"'), true);
  assert.equal(stationSource.includes("Starting Back Preview"), true);
  assert.equal(stationSource.includes("Capture Back"), true);
  assert.equal(stationSource.includes("selectedFinishItem.slabPhotos.frontUploaded"), true);
  assert.equal(stationSource.includes("setSlabUploads({"), true);
  assert.equal(stationSource.includes("Local Operator Report"), true);
  assert.equal(stationSource.includes("Grade Story"), true);
  assert.equal(stationSource.includes("Element Diagnostics"), true);
  assert.equal(stationSource.includes("Vision Lab"), true);
  assert.equal(stationSource.includes("Warnings and Gates"), true);
  assert.equal(stationSource.includes("localReportStory?.gates?.results"), true);
  assert.equal(stationSource.includes("Publish Readiness"), true);
  assert.equal(stationSource.includes("Calculate Final Grade\""), false);
  assert.equal(stationSource.includes("Finalize / Publish"), false);
  assert.equal(stationSource.includes("Publish to Ten Kings System"), false);
});

test("standalone Finish Cards page uses production auth and no Dell bridge or hardware surface", () => {
  const finishPath =
    [path.join(process.cwd(), "pages", "ai-grader", "finish.tsx"), path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "finish.tsx")]
      .find((candidate) => fs.existsSync(candidate));
  assert.ok(finishPath);
  const source = fs.readFileSync(finishPath, "utf8");

  assert.equal(source.includes("/api/admin/ai-grader/production/auth-check"), true);
  assert.equal(source.includes("/api/admin/ai-grader/production/finish-queue?includeCompleted=true"), true);
  assert.equal(source.includes("/api/admin/ai-grader/production/run-comps"), true);
  assert.equal(source.includes("/api/admin/ai-grader/production/save-comps-selection"), true);
  assert.equal(source.includes("/api/admin/ai-grader/production/slabbed-photo-init"), true);
  assert.equal(source.includes("/api/admin/ai-grader/production/slabbed-photo-finalize"), true);
  assert.equal(source.includes("/api/admin/ai-grader/production/add-to-inventory"), true);
  assert.equal(source.includes("uploadAiGraderArtifactDirectly"), true);
  assert.equal(source.includes('mode: "cors"'), false);
  assert.equal(source.includes("valuationMinor:"), false);
  assert.equal(source.includes("aiGraderStationBridgeClient"), false);
  assert.equal(source.includes("/api/ai-grader/station"), false);
  assert.equal(source.includes("stationToken"), false);
  assert.equal(source.includes("127.0.0.1"), false);
  assert.equal(source.includes("localhost"), false);
  assert.equal(source.includes("data:image"), false);
  assert.equal(source.includes("readAsDataURL"), false);
  assert.equal(source.includes("Basler"), false);
  assert.equal(source.includes("lighting"), false);
  assert.equal(source.includes("camera"), false);
});

test("shared session provider exposes a force sign-in path for stale cached sessions", () => {
  const sessionPath =
    [path.join(process.cwd(), "hooks", "useSession.tsx"), path.join(process.cwd(), "frontend", "nextjs-app", "hooks", "useSession.tsx")]
      .find((candidate) => fs.existsSync(candidate));
  assert.ok(sessionPath);
  const sessionSource = fs.readFileSync(sessionPath, "utf8");
  assert.equal(sessionSource.includes("ensureSession: (options?: { force?: boolean"), true);
  assert.equal(sessionSource.includes("const openAuthModal"), true);
  assert.equal(sessionSource.includes("if (options.force)"), true);
  assert.equal(sessionSource.includes("clearSession();"), true);
  assert.equal(sessionSource.includes("open: true"), true);
});

test("AI Grader public report source renders provisional evidence gates", () => {
  const reportPath =
    [
      path.join(process.cwd(), "pages", "ai-grader", "reports", "[reportId].tsx"),
      path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "reports", "[reportId].tsx"),
    ].find((candidate) => fs.existsSync(candidate));
  assert.ok(reportPath);
  const reportSource = fs.readFileSync(reportPath, "utf8");
  assert.equal(reportSource.includes("Evidence Gates"), true);
  assert.equal(reportSource.includes("provisionalGateRows"), true);
  assert.equal(reportSource.includes("Failed gates explain why"), true);
  assert.equal(reportSource.includes("selectedLabMode"), true);
  assert.equal(reportSource.includes("setSelectedLabMode(mode)"), true);
  assert.equal(reportSource.includes("selectedLabSide"), true);
  assert.equal(reportSource.includes("setSelectedLabSide(\"front\")"), true);
  assert.equal(reportSource.includes("setSelectedLabSide(\"back\")"), true);
  assert.equal(reportSource.includes('className="mode-list" role="group"'), true);
  assert.equal(reportSource.includes("aria-pressed={mode === selectedLabMode}"), true);
  assert.equal(reportSource.includes('aria-pressed={selectedLabSide === "front"}'), true);
  assert.equal(reportSource.includes("exactFindingImage?.renderUrl || selectedFinding"), true);
  assert.equal(reportSource.includes("labImageForMode(images, mode, selectedLabSide, impactCandidate)"), true);
  assert.equal(reportSource.includes("vision-lab hero-lab"), true);
  assert.equal(reportSource.includes("Open public report"), true);
  assert.equal(reportSource.includes("Open storage-backed image"), true);
  const gradeIndex = reportSource.indexOf("Provisional Diagnostic Grade");
  const labIndex = reportSource.indexOf("Interactive forensic inspection shell");
  const galleryIndex = reportSource.indexOf("Published Evidence Images");
  assert.ok(gradeIndex >= 0);
  assert.ok(labIndex > gradeIndex);
  assert.ok(galleryIndex > labIndex);
  assert.equal(reportSource.includes("data:image"), false);
  assert.equal(reportSource.includes("stationToken"), false);
  assert.equal(reportSource.includes("presigned"), false);
});

test("AI Grader bridge releases preview hold for back-side positioning before capture", () => {
  const bridgePath =
    [
      path.join(process.cwd(), "packages", "ai-grader-capture-helper", "src", "drivers", "aiGraderLocalStationBridge.ts"),
      path.join(process.cwd(), "..", "packages", "ai-grader-capture-helper", "src", "drivers", "aiGraderLocalStationBridge.ts"),
      path.join(process.cwd(), "..", "..", "packages", "ai-grader-capture-helper", "src", "drivers", "aiGraderLocalStationBridge.ts"),
    ].find((candidate) => fs.existsSync(candidate));
  assert.ok(bridgePath);
  const bridgeSource = fs.readFileSync(bridgePath, "utf8");
  assert.equal(bridgeSource.includes('this.manifest.currentStep = "prompt_flip_card";'), true);
  assert.equal(bridgeSource.includes('this.releaseFullForensicPreviewHold("front capture complete; operator can position back with live preview")'), true);
  assert.equal(bridgeSource.includes('this.activateFullForensicPreviewHold(`${side} warm full forensic capture starting`)'), true);
  assert.equal(bridgeSource.includes("this.acquireCaptureLock(owner);"), true);
});

test("browser station bridge client accepts only loopback bridge URLs", () => {
  assert.equal(normalizeAiGraderStationBridgeUrl(""), DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  assert.equal(normalizeAiGraderStationBridgeUrl("http://localhost:47652/path?x=1"), "http://localhost:47652");
  assert.throws(() => normalizeAiGraderStationBridgeUrl("https://collect.tenkings.co/api/ai-grader/station"), /loopback|localhost|127/);
  assert.throws(() => normalizeAiGraderStationBridgeUrl("http://192.168.1.20:47652"), /localhost|127/);
});

test("browser station bridge client checks local bridge health without station or production service tokens", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/health");
    assert.equal(init?.method, "GET");
    assert.equal((init?.headers as Record<string, string> | undefined)?.["x-ai-grader-service-token"], undefined);
    assert.equal((init?.headers as Record<string, string> | undefined)?.["x-ai-grader-station-token"], undefined);
    return new Response(JSON.stringify({
      ok: true,
      bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
      reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
      mode: "real",
      localOnly: true,
      tokenRequired: true,
      pairingAvailable: true,
      hardwareActionsEnabled: true,
      allowedOrigins: ["https://collect.tenkings.co"],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const health = await fetchAiGraderStationBridgeHealth({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL }, fetchImpl);
  assert.equal(health.ok, true);
  assert.equal(health.localOnly, true);
  assert.equal(health.pairingAvailable, true);
  assert.equal(health.allowedOrigins.includes("https://collect.tenkings.co"), true);
});

test("browser station bridge health fails explicitly when the running helper contract is stale", async () => {
  const staleFetch: typeof fetch = async () => new Response(JSON.stringify({
    ok: true,
    bridgeVersion: "ai-grader-local-station-bridge-v0.8",
    reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
    mode: "real",
    localOnly: true,
    tokenRequired: true,
    hardwareActionsEnabled: true,
    allowedOrigins: ["https://collect.tenkings.co"],
  }), { status: 200, headers: { "content-type": "application/json" } });

  await assert.rejects(
    () => fetchAiGraderStationBridgeHealth({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL }, staleFetch),
    new RegExp(`update/restart required.*Atomic Front Capture.*${AI_GRADER_LOCAL_STATION_BRIDGE_VERSION}.*v0\\.8.*Stop before hardware.*documented Dell helper maintenance update.*Startup shortcut`, "i"),
  );
});

test("shared finalize integrity contract is strict for publish, OCR, and slab-photo flows", () => {
  const checksum = "a".repeat(64);
  const base = { ok: true, byteSize: 123, contentType: "image/png", checksumSha256: checksum };
  const failures = [
    { patch: { checksumSha256: null }, pattern: /native SHA-256 checksum/i, code: "AI_GRADER_STORAGE_CHECKSUM_UNAVAILABLE" },
    { patch: { checksumSha256: "b".repeat(64) }, pattern: /checksum mismatch/i },
    { patch: { byteSize: undefined }, pattern: /byte size mismatch/i },
    { patch: { byteSize: 124 }, pattern: /byte size mismatch/i },
    { patch: { contentType: undefined }, pattern: /content type mismatch/i },
    { patch: { contentType: "image/jpeg" }, pattern: /content type mismatch/i },
  ];
  for (const label of ["publish artifact", "normalized front OCR image", "slabbed front photo"]) {
    for (const failure of failures) {
      assert.throws(() => assertAiGraderStorageArtifactIntegrity({
        verified: { ...base, ...failure.patch },
        expectedByteSize: 123,
        expectedContentType: "image/png",
        expectedChecksumSha256: checksum,
        label,
      }), (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, failure.pattern);
        if (failure.code) assert.equal((error as Error & { code?: string }).code, failure.code);
        return true;
      });
    }
  }
});

test("browser station bridge health gives re-export guidance for a stale report producer", async () => {
  const staleFetch: typeof fetch = async () => new Response(JSON.stringify({
    ok: true,
    bridgeVersion: AI_GRADER_LOCAL_STATION_BRIDGE_VERSION,
    reportProducerContractVersion: "ai-grader-report-producer-v0.1",
    mode: "real",
    localOnly: true,
    tokenRequired: true,
    hardwareActionsEnabled: true,
    allowedOrigins: ["https://collect.tenkings.co"],
  }), { status: 200, headers: { "content-type": "application/json" } });

  await assert.rejects(
    () => fetchAiGraderStationBridgeHealth({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL }, staleFetch),
    /report producer update\/restart required.*re-export.*No hardware recapture/i,
  );
});

test("browser station bridge pairing exchanges a local pairing code for browser-local station token only", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/pair");
    assert.equal(init?.method, "POST");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    assert.equal(headers["x-ai-grader-station-token"], undefined);
    assert.deepEqual(JSON.parse(String(init?.body)), { pairingCode: "pairing-code-123456" });
    return new Response(JSON.stringify({
      ok: true,
      result: {
        bridgeUrl: "http://127.0.0.1:47652",
        stationToken: "browser-local-station-token",
        localOnly: true,
        tokenStorage: "browser_localStorage_only",
        hardwareActionsEnabled: true,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const paired = await pairAiGraderStationBridge(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, pairingCode: "pairing-code-123456" },
    fetchImpl
  );

  assert.equal(paired.bridgeUrl, DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  assert.equal(paired.stationToken, "browser-local-station-token");
  assert.equal(paired.tokenStorage, "browser_localStorage_only");
});

test("Dell station launcher opens pairing URL in a stable Chrome profile", () => {
  const launcherPath =
    [
      path.join(process.cwd(), "..", "..", "scripts", "ai-grader", "open-local-station.ps1"),
      path.join(process.cwd(), "scripts", "ai-grader", "open-local-station.ps1"),
    ].find((candidate) => fs.existsSync(candidate));
  assert.ok(launcherPath);
  const launcherSource = fs.readFileSync(launcherPath, "utf8");
  assert.equal(launcherSource.includes('ChromeUserDataDir = "C:\\TenKings\\chrome-ai-grader-profile"'), true);
  assert.equal(launcherSource.includes("Get-AiGraderChromePath"), true);
  assert.equal(launcherSource.includes("$env:ProgramFiles"), true);
  assert.equal(launcherSource.includes("${env:ProgramFiles(x86)}"), true);
  assert.equal(launcherSource.includes("Google\\Chrome\\Application\\chrome.exe"), true);
  assert.equal(launcherSource.includes('Get-Command "chrome.exe"'), true);
  assert.equal(launcherSource.includes('"--user-data-dir=$UserDataDir"'), true);
  assert.equal(launcherSource.includes('"--new-window"'), true);
  assert.equal(launcherSource.includes("Start-Process -FilePath $chromePath"), true);
  assert.equal(launcherSource.includes("Start-Process (Get-AiGraderBridgePairingUrl -Config $config)"), false);
  assert.equal(launcherSource.includes("pairingCodeRedacted = $true"), true);
});

test("station UI makes detected geometry the live guide while keeping Ready and manual capture explicit", () => {
  const stationPath = [
    path.join(process.cwd(), "pages", "ai-grader", "station.tsx"),
    path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const source = fs.readFileSync(stationPath, "utf8");
  assert.match(source, /geometrySource === "detected"/);
  assert.match(source, /detectionUsed === true/);
  assert.match(source, /cardPlacementState === "ready"/);
  const readyGateSource = source.slice(
    source.indexOf("const detectedGeometryReady"),
    source.indexOf("const manualOverlayAvailable"),
  );
  assert.doesNotMatch(readyGateSource, /center|withinCenter|withinSkew|maxSkew/i);
  assert.match(source, /!detectedGeometryReady/);
  assert.match(source, /aiGraderCaptureAssertionFromFrame/);
  assert.match(source, /createAiGraderCaptureAttempt/);
  assert.match(source, /runAiGraderStationCaptureOrchestration/);
  assert.match(source, /report-framing-overlay\$\{detectedGeometryDominant \? " geometry-dominant"/);
  assert.match(source, /card-geometry-corner-bracket/);
  assert.match(source, /card-geometry-edge-midpoint/);
  assert.match(source, /card-geometry-center-axis/);
  assert.match(source, /Edges found\. \$\{cardAdjustmentGuidance\}/);
  assert.match(source, /detected card size is outside the grading-safe camera range/);
  assert.match(source, /base-plate color with the strongest contrast/);
  assert.match(source, /Edges locked\. Off-center placement and ordinary rotation will be corrected/);
  assert.match(source, /printed top roughly toward the top/);
  assert.match(source, /Confirm Manual Capture/);
  assert.match(source, /Automatic geometry will not be claimed/);
  assert.match(source, /manualCaptureConfirmation\.side/);
  assert.match(source, /no browser rectangle is sent/);
  assert.doesNotMatch(source, /yellow card rectangle[^.]*will be sent/i);
  const previewIneligibleSource = source.slice(
    source.indexOf("if (!previewEligible)"),
    source.indexOf("const expectedBinding = previewEpochStateRef.current.binding"),
  );
  assert.ok(
    previewIneligibleSource.indexOf("previewAttemptGenerationRef.current += 1")
      < previewIneligibleSource.indexOf("intentionalCaptureRef.current = null"),
  );
  const previewEofSource = source.slice(
    source.indexOf("const classifyAtomicReaderEnd = async"),
    source.indexOf("const bridgeIntent = authoritativeAfterEnd", source.indexOf("const classifyAtomicReaderEnd = async")),
  );
  assert.ok(
    previewEofSource.indexOf("const localIntent = intentionalCaptureRef.current")
      < previewEofSource.indexOf("await fetchAiGraderStationPreviewStatus"),
  );
  const atomicCaptureSource = source.slice(
    source.indexOf("const runStationAtomicCapture = async"),
    source.indexOf("const changeAutoCaptureEnabled = async"),
  );
  assert.equal(atomicCaptureSource.match(/runAiGraderStationCaptureOrchestration/g)?.length, 1);
  assert.doesNotMatch(atomicCaptureSource, /await fetchAiGraderStationPreviewStatus/);
  assert.doesNotMatch(atomicCaptureSource, /runAction\("confirm-(?:flip|light-idle-off|fixture-rulers)"/);
  assert.doesNotMatch(atomicCaptureSource, /runAction\("accept-profile"/);
  assert.doesNotMatch(atomicCaptureSource, /stopAiGraderStationPreview|safeOffAiGraderLiveLighting|\/preview\/stop|\/lighting\/safe-off/);
  assert.match(atomicCaptureSource, /catch \(captureError\)[\s\S]*ambiguityReconcileSchedulerRef\.current\?\.\(intentionalCaptureRef\.current\)/);
  assert.ok(
    atomicCaptureSource.indexOf("intentionalCaptureRef.current = preparedIntent")
      < atomicCaptureSource.indexOf("setBusy("),
  );
  const atomicFrontSource = source.slice(
    source.indexOf("const startGrading = async"),
    source.indexOf("const confirmFlipAndContinue = async"),
  );
  assert.equal(atomicFrontSource.match(/runStationAtomicCapture/g)?.length, 1);
  assert.doesNotMatch(atomicFrontSource, /confirm-light-idle-off|confirm-fixture-rulers|accept-profile|preview\/stop|lighting\/safe-off/);
  const previewBusySource = source.slice(
    source.indexOf("const previewBrowserCaptureActionActive"),
    source.indexOf("useEffect(() => {", source.indexOf("const previewBrowserCaptureActionActive")),
  );
  assert.doesNotMatch(previewBusySource, /start-grading|capture-back|capture-front/);
  const pageExitSource = source.slice(
    source.indexOf("const handlePageExit = () =>"),
    source.indexOf('window.addEventListener("pagehide"'),
  );
  assert.ok(
    pageExitSource.indexOf("aiGraderSubmittedCaptureIntentMatches")
      < pageExitSource.indexOf("safeOffAiGraderLiveLighting"),
  );
  const ambiguousIntentSource = source.slice(
    source.indexOf("const scheduleAmbiguousIntentReconciliation"),
    source.indexOf("const runPreviewReader = async"),
  );
  assert.match(ambiguousIntentSource, /AI_GRADER_LOCAL_CAPTURE_INTENT_MAX_AGE_MS/);
  assert.match(ambiguousIntentSource, /fetchAiGraderStationPreviewStatus/);
  assert.match(ambiguousIntentSource, /safeOffAfterPreviewLoss/);
  assert.match(ambiguousIntentSource, /setPreviewRestartGeneration/);
  assert.match(ambiguousIntentSource, /reconcileDecision\.kind === "poll_active"[\s\S]*scheduleCheck\(reconcileDecision\.delayMs, reconcileDecision\.nextActiveChecksRemaining\)/);
  assert.match(ambiguousIntentSource, /scheduleCheck\(initialDelayMs, AI_GRADER_ACTIVE_CAPTURE_RECONCILE_MAX_CHECKS\)/);
  assert.match(ambiguousIntentSource, /callAiGraderStationBridge\(\{[\s\S]*action: "status"/);
  assert.equal(source.includes('else void confirmFlipAndContinueRef.current?.("auto");'), true);
  assert.equal(source.includes('confirmFlipAndContinueRef.current?.("auto", "manual_capture")'), false);
  assert.equal(source.includes('else await confirmFlipAndContinue("operator", "manual_capture");'), true);
  const previewReconcileSource = source.slice(
    source.indexOf("const reconcileBridgePreviewStatus"),
    source.indexOf("const connectBridgeWithCredentials"),
  );
  assert.equal(previewReconcileSource.match(/setPreviewRestartGeneration/g)?.length, 1);
  assert.ok(
    previewReconcileSource.indexOf('applyPreviewEpochEvent({ type: "bind", binding })')
      < previewReconcileSource.indexOf("setPreviewRestartGeneration"),
  );
  const previewLossSafeOffSource = source.slice(
    source.indexOf("const safeOffAfterPreviewLoss"),
    source.indexOf("const reconcileBridgePreviewStatus"),
  );
  assert.ok(
    previewLossSafeOffSource.indexOf("projectAiGraderPreviewLossSafeOffPending")
      < previewLossSafeOffSource.indexOf("await safeOffAiGraderLiveLighting"),
  );
  assert.match(previewLossSafeOffSource, /catch \(safeOffError\)[\s\S]*await reconcileLightingMutationFailure\(safeOffError, 'Preview-loss safe-off', \{[\s\S]*requireSafeOff: true,[\s\S]*throw safeOffError/);
  const retryRestartSource = source.slice(
    source.indexOf("const restartBackPreviewForRetry"),
    source.indexOf("const retryBackPositioningLight"),
  );
  assert.ok(
    retryRestartSource.indexOf("intentionalCaptureRef.current = null")
      < retryRestartSource.indexOf("previewAttemptGenerationRef.current += 1"),
  );
  const retryActionSource = source.slice(
    source.indexOf("const retryBackPositioningLight"),
    source.indexOf("const ensureLiveLightingSession"),
  );
  assert.ok(
    retryActionSource.indexOf("const next = await runAiGraderBackPositioningRetryRecovery")
      < retryActionSource.indexOf('clearPreviewDisplay("starting")'),
  );
  assert.match(retryActionSource, /if \(backPositioningRetryReady\) return;/);
  assert.ok(
    retryActionSource.indexOf("if (!aiGraderPreviewBindingMatches(previewEpochStateRef.current.binding, retryBinding))")
      < retryActionSource.indexOf('clearPreviewDisplay("starting")'),
  );
  assert.ok(
    retryActionSource.indexOf('clearPreviewDisplay("starting")')
      < retryActionSource.indexOf("fetchAiGraderLiveLightingStatus"),
  );
  assert.match(retryActionSource, /positioningLightReady: false/);
  assert.match(source, /const canStartGrading = frontStartReadiness\.ready/);
  assert.match(source, /const detectedGeometryFresh =/);
  assert.match(source, /activeGeometryAgeMs <= PREVIEW_GEOMETRY_MAX_AGE_MS/);
  assert.match(source, /This capture session is terminal; select Start New Card to retry\./);
  const autoCaptureArmingSource = source.slice(
    source.indexOf("const changeAutoCaptureEnabled"),
    source.indexOf("const startGrading = async"),
  );
  assert.doesNotMatch(autoCaptureArmingSource, /confirm-fixture-rulers|fixtureRulersVisible/);
  const fixtureConfirmationSource = source.slice(
    source.indexOf("const confirmFrontFixtureAndRulers = async"),
    source.indexOf("const changeStationCaptureMode = async"),
  );
  assert.ok(
    fixtureConfirmationSource.indexOf("const latest = await runAction('status')")
      < fixtureConfirmationSource.indexOf("aiGraderFrontWorkflowAssertionFromStatus(latest)"),
  );
  assert.match(fixtureConfirmationSource, /runAction\('confirm-fixture-rulers', request\)/);
  assert.match(fixtureConfirmationSource, /await runAction\('status'\)/);
  assert.doesNotMatch(fixtureConfirmationSource, /confirmations:|fixtureRulersVisible/);
  assert.match(source, /Confirm Fixture & Rulers/);
  assert.match(source, /Auto Capture still requires the separate exact-session Confirm Fixture &amp; Rulers action and authoritative Front readiness/);
  assert.match(source, /<p className='status-note'>\{frontStartReadiness\.message\}<\/p>/);
  assert.match(source, /Hardware safety interlock: \{hardwareSafetyMessage\} Use the explicit Safe Off recovery before continuing/);
  const physicalSafetySource = source.slice(
    source.indexOf('const physicalSafetyBlocked'),
    source.indexOf('const liveLightingAvailable'),
  );
  assert.match(physicalSafetySource, /physical_state_unknown/);
  assert.match(physicalSafetySource, /const hardwareSafetyBlocked = physicalSafetyBlocked \|\| liveLightingRequestPending/);
  const recoveryGateSource = physicalSafetySource.slice(
    physicalSafetySource.indexOf('const safeOffRecoveryAllowed'),
  );
  assert.doesNotMatch(recoveryGateSource, /hardwareSafetyBlocked|physicalSafetyBlocked/);
  assert.match(source, /onClick=\{startNewCard\} disabled=\{busy !== null \|\| hardwareSafetyBlocked\}/);
  assert.match(source, /className="safe" onClick=\{safeOff\} disabled=\{!safeOffRecoveryAllowed\}/);
  const stationSafeOffSource = source.slice(
    source.indexOf('const safeOff = async () =>'),
    source.indexOf('const openReport = async'),
  );
  assert.match(stationSafeOffSource, /runAction\('safe-off'\)/);
  assert.doesNotMatch(stationSafeOffSource, /confirmations:|lightIdleOff|acceptedProfile|dutyPercent|channels/);
  const runActionSource = source.slice(
    source.indexOf('const runAction = async'),
    source.indexOf('const restartBackPreviewForRetry'),
  );
  assert.match(
    runActionSource,
    /setLiveLighting\(next\.liveLighting\);\s+if \(lightingPhysicalStateAcknowledged\(next\.liveLighting\)\) \{\s+setSafetyError\(null\);\s+\}/,
  );
  assert.doesNotMatch(
    runActionSource,
    /if \(!lightingPhysicalStateAcknowledged\(next\.liveLighting\)\)[\s\S]*setSafetyError\(null\)/,
  );
  assert.match(source, /disabled=\{busy !== null \|\| !canStartGrading/);
  assert.ok(
    atomicCaptureSource.indexOf("captureStatus = await runAction('status')")
      < atomicCaptureSource.indexOf("const refreshedReadiness = deriveAiGraderFrontStartReadiness"),
  );
  assert.ok(
    atomicCaptureSource.indexOf("if (!refreshedReadiness.ready)")
      < atomicCaptureSource.indexOf("runAiGraderStationCaptureOrchestration"),
  );
  assert.doesNotMatch(source, /Full Forensic is the fallback/);
  assert.doesNotMatch(source, /Cold Fallback/);
});

test("station geometry status polling targets 200 ms without overlapping loopback requests", () => {
  const stationPath = [
    path.join(process.cwd(), "pages", "ai-grader", "station.tsx"),
    path.join(process.cwd(), "frontend", "nextjs-app", "pages", "ai-grader", "station.tsx"),
  ].find((candidate) => fs.existsSync(candidate));
  assert.ok(stationPath);
  const source = fs.readFileSync(stationPath, "utf8");
  assert.match(source, /const PREVIEW_GEOMETRY_STATUS_POLL_MS = 200;/);
  assert.match(source, /if \(requestPending\) return;/);
  assert.match(source, /requestPending = true;/);
  assert.match(source, /requestPending = false;/);
  assert.match(source, /setInterval\(\(\) => void refreshGeometry\(\), PREVIEW_GEOMETRY_STATUS_POLL_MS\)/);
  const geometryPollSource = source.slice(
    source.indexOf("const refreshGeometry"),
    source.indexOf("const currentStep"),
  );
  assert.match(geometryPollSource, /reconcileBridgePreviewStatus\(latest\);\s+return;/);
  assert.doesNotMatch(geometryPollSource, /if \(binding && aiGraderPreviewBindingMatches/);
  assert.match(source, /A successful bridge poll is authoritative/);
  assert.match(source, /return sanitized;/);
  assert.doesNotMatch(source, /front: sanitized\.front \?\? current\?\.front/);
});

test("browser station client sends explicit profile, geometry, and rapid queue action bodies", async () => {
  assert.deepEqual(buildAiGraderCaptureProfileRequest("production_fast"), { captureProfile: "production_fast" });
  assert.deepEqual(
    buildAiGraderDetectedGeometryCaptureRequest({ captureTriggerAt: "2026-07-10T12:00:00.000Z", captureTriggerMode: "auto" }),
    { captureTriggerAt: "2026-07-10T12:00:00.000Z", captureTriggerMode: "auto", geometryCaptureMode: "detected_geometry" }
  );
  const manualRect = {
    x: 120,
    y: 80,
    width: 960,
    height: 1500,
    imageWidth: 1200,
    imageHeight: 1680,
    coordinateFrame: "portrait_preview_pixels" as const,
  };
  assert.deepEqual(
    buildAiGraderManualGeometryCaptureRequest({ captureTriggerAt: "2026-07-10T12:00:00.000Z", manualGeometryRect: manualRect }),
    {
      captureTriggerAt: "2026-07-10T12:00:00.000Z",
      captureTriggerMode: "operator",
      geometryCaptureMode: "manual_capture",
      manualGeometryRect: manualRect,
    }
  );
  assert.throws(
    () => buildAiGraderManualGeometryCaptureRequest({
      captureTriggerAt: "2026-07-10T12:00:00.000Z",
      manualGeometryRect: { ...manualRect, x: 900, width: 400 },
    }),
    /inside the portrait preview frame/i
  );
  assert.deepEqual(buildAiGraderRapidCaptureConfigurationRequest(true), { rapidCaptureEnabled: true });
  assert.deepEqual(buildAiGraderRapidQueueActivationRequest(" queue-1 "), { queueItemId: "queue-1" });
  assert.throws(() => buildAiGraderRapidQueueActivationRequest("   "), /queue item ID is required/i);

  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const result = buildAiGraderLocalStationStatus({ captureProfile: "production_fast", rapidCaptureEnabled: true });
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    assert.equal(init?.method, "POST");
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await callAiGraderStationBridge({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    action: "start-session",
    body: buildAiGraderCaptureProfileRequest("production_fast"),
  }, fetchImpl);
  await callAiGraderStationBridge({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    action: "configure-rapid-capture",
    body: buildAiGraderRapidCaptureConfigurationRequest(true),
  }, fetchImpl);
  await callAiGraderStationBridge({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    action: "queue-current-card",
  }, fetchImpl);
  await callAiGraderStationBridge({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    action: "activate-queue-item",
    body: buildAiGraderRapidQueueActivationRequest("queue-1"),
  }, fetchImpl);

  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:47652/actions/start-session", body: { captureProfile: "production_fast" } },
    { url: "http://127.0.0.1:47652/actions/configure-rapid-capture", body: { rapidCaptureEnabled: true } },
    { url: "http://127.0.0.1:47652/actions/queue-current-card", body: {} },
    { url: "http://127.0.0.1:47652/actions/activate-queue-item", body: { queueItemId: "queue-1" } },
  ]);
});

test("browser station bridge client fetches local report bundle bodies with station token only", async () => {
  const imageBody = Buffer.from("front-image").toString("base64");
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/reports/report-123/bundle?includeAssetBodies=1");
    assert.equal(init?.method, "GET");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    return new Response(JSON.stringify({
      ok: true,
      result: {
        reportId: "report-123",
        source: "history_generated_with_asset_bodies",
        bundle: {
          ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
          reportId: "report-123",
          assets: [
            {
              id: "front/front-all-on-portrait-display.png",
              kind: "image",
              fileName: "front-all-on-portrait-display.png",
              contentType: "image/png",
              bodyEncoding: "base64",
              bodyBase64: imageBody,
            },
          ],
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const bundle = await fetchAiGraderStationReportBundle({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reportId: "report-123",
    includeAssetBodies: true,
  }, fetchImpl);

  const image = bundle.assets?.find((asset) => asset.fileName === "front-all-on-portrait-display.png");
  assert.equal(image?.bodyEncoding, "base64");
  assert.equal(Buffer.from(image?.bodyBase64 ?? "", "base64").toString("utf8"), "front-image");
});

test("browser station bridge client fetches one local asset for direct storage upload", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://127.0.0.1:47652/reports/report-123/asset?assetId=front%2Ffront-all-on-portrait-display.png");
    assert.equal(init?.method, "GET");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    return new Response(Buffer.from("front-image"), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "x-ai-grader-sha256": sha256Hex(Buffer.from("front-image")),
      },
    });
  };

  const asset = await fetchAiGraderStationReportAsset({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reportId: "report-123",
    assetId: "front/front-all-on-portrait-display.png",
  }, fetchImpl);

  assert.equal(Buffer.from(asset.bytes).toString("utf8"), "front-image");
  assert.equal(asset.contentType, "image/png");
  assert.equal(asset.byteSize, Buffer.byteLength("front-image"));
  assert.equal(asset.checksumSha256, sha256Hex(Buffer.from("front-image")));
});

test("browser station bridge preview status and stream use local station token only", async () => {
  const frameBytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  const lightingResult = {
    status: "on",
    mode: "browser_live_tuning",
    localOnly: true,
    tokenRequired: true,
    controlsEnabled: true,
    previewRequired: true,
    profile: {
      enabled: true,
      dutyPercent: 1.4,
      actualLeimacPwmStep: 14,
      channels: [1, 3, 5],
      source: "browser_live_tuning",
      acceptedForCapture: true,
      candidateProfileIdentity: `candidate-${"c".repeat(32)}`,
    },
    applied: {
      enabled: true,
      dutyPercent: 1.4,
      actualLeimacPwmStep: 14,
      channels: [1, 3, 5],
      lastApplyLatencyMs: 24,
    },
    watchdog: { enabled: true, timeoutMs: 15000 },
    connection: { state: "mock", persistentLeimacSession: false },
    safety: {
      publicRouteExposed: false,
      requiresStationToken: true,
      bindsLoopbackOnly: true,
      productionServiceTokenUsed: false,
      lowDutyCapEnforced: true,
      maxDutyPercent: 5,
      safeOffOnAllOff: true,
      safeOffOnDisconnect: true,
      safeOffOnTimeout: true,
      safeOffOnCaptureStart: true,
      safeOffOnCaptureFailure: true,
      safeOffOnSessionEnd: true,
      persistentLeimacSaved: false,
      arbitraryWritesAllowed: false,
    },
    safetyEvents: [],
    note: "test",
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-ai-grader-station-token"], "browser-local-station-token");
    assert.equal(headers["x-ai-grader-service-token"], undefined);
    if (String(input).endsWith("/preview/status")) {
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "live",
          implementationType: "mjpeg_fetch_stream",
          browserEmbedded: true,
          localOnly: true,
          tokenRequired: true,
          streamPath: "/preview/stream",
          statusPath: "/preview/status",
          portraitOrientation: true,
          cameraOwnership: "preview_stream",
          frameSource: "basler_pylon_continuous_grab",
          frameCount: 3,
          safety: {
            publicRouteExposed: false,
            requiresStationToken: true,
            bindsLoopbackOnly: true,
            productionServiceTokenUsed: false,
            lightingCommanded: false,
            persistentBaslerSaved: false,
            persistentLeimacSaved: false,
          },
          note: "test",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(input).endsWith("/preview/stop")) {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: "stopped",
          implementationType: "mjpeg_fetch_stream",
          browserEmbedded: true,
          localOnly: true,
          tokenRequired: true,
          streamPath: "/preview/stream",
          statusPath: "/preview/status",
          portraitOrientation: true,
          cameraOwnership: "released",
          frameSource: "basler_pylon_continuous_grab",
          frameCount: 3,
          lastStopReason: "operator starting front full forensic capture",
          safety: {
            publicRouteExposed: false,
            requiresStationToken: true,
            bindsLoopbackOnly: true,
            productionServiceTokenUsed: false,
            lightingCommanded: false,
            persistentBaslerSaved: false,
            persistentLeimacSaved: false,
          },
          note: "test",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(input).includes("/lighting/")) {
      if (String(input).endsWith("/lighting/status")) {
        assert.equal(init?.method, "GET");
      } else {
        assert.equal(init?.method, "POST");
      }
      if (String(input).endsWith("/lighting/accept")) {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          idempotencyKey: "front-workflow-accept-profile-0001",
          expectedSessionId: "session-123",
          expectedReportId: "report-123",
          expectedSide: "front",
          expectedSideEpoch: "front-epoch-1",
          expectedCandidateProfileIdentity: `candidate-${"c".repeat(32)}`,
        });
        const station = buildAiGraderLocalStationStatus({ action: "accept-profile" });
        return new Response(JSON.stringify({
          ok: true,
          result: {
            ...station,
            liveLighting: {
              ...station.liveLighting,
              ...lightingResult,
              profile: { ...station.liveLighting.profile, ...lightingResult.profile },
              applied: { ...station.liveLighting.applied, ...lightingResult.applied },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        result: String(input).endsWith("/lighting/safe-off")
          ? {
              ...lightingResult,
              status: "safe_off",
              profile: { ...lightingResult.profile, enabled: false },
              applied: { ...lightingResult.applied, enabled: false, dutyPercent: 0, actualLeimacPwmStep: 0, channels: [] },
            }
          : lightingResult,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(String(input), "http://127.0.0.1:47652/preview/stream");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`--tenkings-ai-grader-preview\r\nContent-Type: image/svg+xml\r\nContent-Length: ${frameBytes.length}\r\nX-AI-Grader-Frame-Index: 7\r\nX-AI-Grader-Captured-At: 2026-07-05T00:00:00.000Z\r\n\r\n`));
        controller.enqueue(frameBytes);
        controller.enqueue(new TextEncoder().encode("\r\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "multipart/x-mixed-replace; boundary=tenkings-ai-grader-preview" },
    });
  };

  const previewStatus = await fetchAiGraderStationPreviewStatus({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
  }, fetchImpl);
  assert.equal(previewStatus.localOnly, true);
  assert.equal(previewStatus.frameCount, 3);

  const stoppedPreview = await stopAiGraderStationPreview({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reason: "operator starting front full forensic capture",
  }, fetchImpl);
  assert.equal(stoppedPreview.cameraOwnership, "released");

  const lightingStatus = await fetchAiGraderLiveLightingStatus({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
  }, fetchImpl);
  assert.equal(lightingStatus.localOnly, true);
  assert.equal(lightingStatus.tokenRequired, true);
  assert.equal(lightingStatus.safety.productionServiceTokenUsed, false);
  assert.equal(lightingStatus.safety.maxDutyPercent, 5);

  const appliedLighting = await applyAiGraderLiveLighting({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    enabled: true,
    dutyPercent: 1.4,
    channels: [1, 3, 5],
    reason: "test live tuning apply",
  }, fetchImpl);
  assert.deepEqual(appliedLighting.applied.channels, [1, 3, 5]);
  assert.equal(appliedLighting.applied.actualLeimacPwmStep, 14);

  const heartbeatLighting = await heartbeatAiGraderLiveLighting({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reason: "test heartbeat",
  }, fetchImpl);
  assert.equal(heartbeatLighting.mode, "browser_live_tuning");

  const acceptedLighting = await acceptAiGraderLiveLightingProfile({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    assertion: {
      idempotencyKey: "front-workflow-accept-profile-0001",
      expectedSessionId: "session-123",
      expectedReportId: "report-123",
      expectedSide: "front",
      expectedSideEpoch: "front-epoch-1",
      expectedCandidateProfileIdentity: `candidate-${"c".repeat(32)}`,
    },
  }, fetchImpl);
  assert.equal(acceptedLighting.liveLighting.profile.acceptedForCapture, true);

  const safeOffLighting = await safeOffAiGraderLiveLighting({
    baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
    stationToken: "browser-local-station-token",
    reason: "test all off",
  }, fetchImpl);
  assert.equal(safeOffLighting.applied.enabled, false);
  assert.equal(safeOffLighting.status, "safe_off");

  const frames: Array<{ frameIndex?: number; contentType: string; byteLength: number }> = [];
  await openAiGraderStationPreviewStream(
    { baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, stationToken: "browser-local-station-token" },
    {
      onFrame(frame) {
        frames.push({ frameIndex: frame.frameIndex, contentType: frame.contentType, byteLength: frame.byteLength });
      },
    },
    fetchImpl
  );
  assert.deepEqual(frames, [{ frameIndex: 7, contentType: "image/svg+xml", byteLength: frameBytes.length }]);
});

test("public AI Grader report surfaces do not expose preview endpoints or hardware controls", () => {
  const publicBundleText = JSON.stringify(getAiGraderReportBundle("sample-final-v0"));
  assert.equal(publicBundleText.includes("/preview/stream"), false);
  assert.equal(publicBundleText.includes("x-ai-grader-station-token"), false);
  assert.equal(publicBundleText.includes("/lighting/"), false);
  assert.equal(publicBundleText.includes("lighting-apply"), false);
  assert.equal(publicBundleText.includes("hardware controls"), false);
});

test("browser station bridge client reports missing bridge and missing pairing code cleanly", async () => {
  const unavailableFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, message: "bridge not running" }), { status: 503 });

  await assert.rejects(
    () => fetchAiGraderStationBridgeHealth({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL }, unavailableFetch),
    /bridge not running/
  );
  await assert.rejects(
    () => pairAiGraderStationBridge({ baseUrl: DEFAULT_AI_GRADER_STATION_BRIDGE_URL, pairingCode: " " }, unavailableFetch),
    /pairing code is required/
  );
});
