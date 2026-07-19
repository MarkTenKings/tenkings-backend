import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession, type SessionPayload } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  AI_GRADER_STATION_STEPS,
  aiGraderApproveAndPublishEligible,
  aiGraderAuthoritativeLiveLightingDraft,
  aiGraderCardPlacementLabel,
  buildAiGraderLocalStationStatus,
  buildSampleAiGraderReportHistory,
  sanitizeAiGraderPreviewCardGeometryBySide,
  type AiGraderLocalStationStatus,
  type AiGraderLiveLightingStatus,
  type AiGraderCaptureProfile,
  type AiGraderGradingContract,
  type AiGraderMathematicalFindingReviewRequestV1,
  type AiGraderMathematicalReviewAssetMetadataV1,
  type AiGraderCaptureTriggerMode,
  type AiGraderPreviewCardGeometryBySide,
  type AiGraderPreviewGeometryPoint,
  type AiGraderPreviewGeometrySide,
  type AiGraderWarmRunnerPhase,
  type AiGraderLocalReportHistory,
  type AiGraderLocalReportHistoryItem,
  type AiGraderStationAction,
} from "../../lib/aiGraderLocalStation";
import { resolveAiGraderAuthoritativeProductionPackage } from "../../lib/aiGraderReleaseAuthority";
import {
  AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY,
  AI_GRADER_STATION_TOKEN_STORAGE_KEY,
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  applyAiGraderLiveLighting,
  aiGraderMathematicalReviewAssetKey,
  buildAiGraderCaptureProfileRequest,
  buildAiGraderMathematicalAuthorityBindingRequest,
  buildAiGraderMathematicalFindingReviewSubmission,
  buildAiGraderMathematicalGradingAuthorityV1,
  buildAiGraderRapidCaptureConfigurationRequest,
  buildAiGraderRapidQueueActivationRequest,
  callAiGraderStationBridge,
  collectAiGraderMathematicalReviewAssets,
  fetchAiGraderMathematicalReviewAsset,
  fetchAiGraderLiveLightingStatus,
  fetchAiGraderStationBridgeHealth,
  fetchAiGraderStationPreviewStatus,
  fetchAiGraderStationReportAsset,
  fetchAiGraderStationReportBundle,
  fetchAiGraderStationReportHistory,
  heartbeatAiGraderLiveLighting,
  openAiGraderStationPreviewStream,
  pairAiGraderStationBridge,
  stageAiGraderMathematicalDesignReference,
  type AiGraderMathematicalCardIdentityDraftV1,
  type AiGraderMathematicalCenteringProfileV1,
  type AiGraderPreparedRegisteredDesignReferenceV1,
} from "../../lib/aiGraderStationBridgeClient";
import {
  fetchExactAiGraderDesignReferenceArtifact,
  resolveActiveAiGraderDesignReference,
  type AiGraderExactDesignReferenceIdentity,
} from "../../lib/aiGraderDesignReferenceClient";
import {
  aiGraderPreviewBackCaptureReady,
  aiGraderPreviewBindingChanged,
  aiGraderPreviewBindingMatches,
  aiGraderPreviewDetectedCaptureReady,
  aiGraderPreviewDisplayedSnapshot,
  aiGraderPreviewStatusBinding,
  createAiGraderPreviewEpochState,
  sanitizeAiGraderPreviewFrameBinding,
  transitionAiGraderPreviewEpoch,
  type AiGraderPreviewEpochEvent,
  type AiGraderPreviewEpochBinding,
  type AiGraderPreviewEpochState,
} from "../../lib/aiGraderPreviewLifecycle";
import {
  aiGraderCaptureAssertionFromFrame,
  runAiGraderCapture,
} from "../../lib/aiGraderStationOperations";
import {
  AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION,
  isAiGraderReportBundleV03,
  type AiGraderLegacyReportBundle,
  type AiGraderStationReportBundle,
} from "../../lib/aiGraderReportBundle";
import type { AiGraderProductionRelease, AiGraderStationProductionRelease } from "../../lib/aiGraderProductionRelease";
import {
  aiGraderMathematicalReleaseEnvelopeIssue,
  parseAiGraderMathematicalReportV1,
} from "../../lib/aiGraderMathematicalReportV1";
import {
  AiGraderOcrPrefillStageError,
  aiGraderOcrPrefillReportMetadata,
  mergeAiGraderOcrPrefillIntoIdentityDraft,
  runAiGraderOcrPrefillFromLocalReport,
  type AiGraderOcrPrefillResult,
  type AiGraderOcrPrefillState,
} from "../../lib/aiGraderOcrPrefillClient";
import { findReportImage, reportImageAssets } from "../../lib/aiGraderReportImages";
import {
  aiGraderOperatorStepCopy,
  buildAiGraderCompsReadiness,
  buildAiGraderPublishReadiness,
} from "../../lib/aiGraderOperatorWorkflow";
import { formatAiGraderPublishStageError } from "../../lib/aiGraderPublishErrors";
import { productionAssetManifest } from "../../lib/aiGraderProductionAssetManifest";
import { assertAiGraderBrowserRaster } from "../../lib/aiGraderRasterValidation";
import { uploadAiGraderArtifactDirectly } from "../../lib/aiGraderDirectUpload";

type HistorySort = "most_recent" | "oldest" | "grade" | "category";
type HistoryView = "list" | "tiles";
type StationWorkArea = "grade" | "finish";
type StationCaptureMode = "single" | "rapid";
type ProductionPublishState = {
  status: "idle" | "pending" | "published" | "disabled" | "error";
  message: string;
  reportId?: string;
  certId?: string;
  publicReportUrl?: string;
  labelPreviewUrl?: string;
  qrPayloadUrl?: string;
  uploadedAssetCount?: number;
  evidenceAssetCount?: number;
};

type CardSelectionState = {
  source: "card_asset" | "item" | "manual_draft";
  cardAssetId?: string;
  itemId?: string;
  title?: string;
  set?: string;
  cardNumber?: string;
  category?: string;
  displayTitle?: string;
  subtitle?: string;
};

type IdentityDraftState = {
  category: "sport" | "tcg" | "comics";
  playerName: string;
  cardName: string;
  teamName: string;
  year: string;
  manufacturer: string;
  sport: string;
  game: string;
  productSet: string;
  cardNumber: string;
  insert: string;
  parallel: string;
  numbered: string;
  autograph: boolean;
  memorabilia: boolean;
};

type SlabUploadState = {
  front?: { status: string; publicUrl?: string; message?: string };
  back?: { status: string; publicUrl?: string; message?: string };
};

type CompsCandidate = {
  id?: string;
  title?: string;
  url?: string;
  price?: string;
  soldDate?: string;
  listingImageUrl?: string;
  screenshotUrl?: string;
};

type CompsState = {
  status: "idle" | "ready" | "running" | "completed" | "saved" | "not_ready_missing_grade" | "not_ready_missing_identity" | "failed";
  message: string;
  searchQuery?: string;
  searchUrl?: string;
  count?: number;
  compsRefs?: CompsCandidate[];
  selectedIds?: string[];
  valuationMinor?: number | null;
  saved?: boolean;
};

type StepState = {
  status: "idle" | "pending" | "completed" | "failed";
  message: string;
};
type ConfirmedDownstreamState = {
  reportId?: string;
  labelSheet?: {
    sheetNumber: number;
    slot: number;
    capacity: number;
  };
  comps: {
    status: "idle" | "queued" | "running" | "ready" | "completed" | "failed";
    message: string;
  };
};
type ProductionAuthActor = {
  actorType: string;
  role: string;
  displayName: string;
};
type ProductionAuthActorState = ProductionAuthActor | null;
type BridgeConnectionState = "checking" | "connected" | "not_running" | "pairing_required" | "error";
type LocalReportState = {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  reportId?: string;
  bundle?: AiGraderStationReportBundle;
};

type MathematicalAuthorityDraftState = {
  title: string;
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string;
  parallelId: string;
  profiles: Record<"front" | "back", AiGraderMathematicalCenteringProfileV1>;
};

type MathematicalReviewAssetView = {
  side: "front" | "back";
  metadata: AiGraderMathematicalReviewAssetMetadataV1;
  objectUrl: string;
};

type MathematicalReviewAssetState = {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  requestSha256?: string;
  assets: Record<string, MathematicalReviewAssetView>;
};

type FinishQueueStatus = "needs_slab_photos" | "needs_ebay_evaluate" | "needs_inventory" | "complete";
type FinishQueueItem = {
  reportId: string;
  certId?: string | null;
  cardTitle: string;
  grade?: number | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  publicReportUrl?: string | null;
  labelPreviewUrl?: string | null;
  qrPayloadUrl?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  queueStatus: FinishQueueStatus;
  statusText: string;
  needs: string[];
  label: {
    printed: boolean;
    physicalPrintStatus?: string | null;
  };
  slabPhotos: {
    frontUploaded: boolean;
    backUploaded: boolean;
    complete: boolean;
    frontUrl?: string | null;
    backUrl?: string | null;
  };
  valuation: {
    complete: boolean;
    status?: string | null;
    valuationMinor?: number | null;
    valuationCurrency?: string | null;
  };
  inventory: {
    complete: boolean;
    reviewStage?: string | null;
    canAddToInventory: boolean;
  };
};
type FinishQueueResult = {
  source: "persisted_records";
  orderedBy: string;
  items: FinishQueueItem[];
  stats: {
    total: number;
    needsSlabPhotos: number;
    needsEbayEvaluate: number;
    needsInventory: number;
    complete: number;
  };
};

type PublishUploadPlanArtifact = {
  artifactId: string;
  artifactClass: string;
  kind: string;
  storageKey: string;
  contentType: string;
  checksumSha256: string;
  byteSize: number;
  publicUrl?: string;
  sourceAssetId?: string;
  sourceImageWidthPx?: number;
  sourceImageHeightPx?: number;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  body?: string;
  bodyEncoding?: "utf8";
};

type PublishUploadedArtifact = {
  artifactId: string;
  storageKey: string;
  publicUrl?: string;
  checksumSha256: string;
  byteSize: number;
  contentType: string;
  sourceImageWidthPx?: number;
  sourceImageHeightPx?: number;
  uploadedAt: string;
};

async function callStationContract(action: AiGraderStationAction): Promise<AiGraderLocalStationStatus> {
  const method = action === "status" || action === "latest-report" || action === "session-manifest" ? "GET" : "POST";
  const response = await fetch(`/api/ai-grader/station/${action}`, { method });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? "AI Grader station action failed.");
  }
  return payload.result;
}

function formatMs(ms?: number) {
  if (typeof ms !== "number") return "pending";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function scoreText(score?: number) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Pending";
  return score.toFixed(score % 1 === 0 ? 0 : 2);
}

function formatStationValue(value?: string) {
  if (!value) return "Pending";
  return value
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mergePreviewCardGeometry(
  _current: AiGraderPreviewCardGeometryBySide | undefined,
  incoming: unknown
): AiGraderPreviewCardGeometryBySide | undefined {
  const sanitized = sanitizeAiGraderPreviewCardGeometryBySide(incoming);
  // A successful bridge poll is authoritative. In particular, if the bridge
  // clears the active side after a detector error, never retain an older Ready
  // outline in the browser and accidentally keep capture enabled.
  return sanitized;
}

function roleLabel(role: string) {
  if (role === "dark_control") return "Dark";
  if (role === "all_on") return "All";
  if (role === "accepted_profile") return "Profile";
  return role.replace("channel_", "Ch ");
}

function queueSummary(phases: AiGraderWarmRunnerPhase[]) {
  if (!phases.length) return "Pending";
  const active = phases.filter((phase) => phase.status === "active").length;
  const completed = phases.filter((phase) => phase.status === "completed").length;
  const failed = phases.filter((phase) => phase.status === "failed").length;
  if (failed) return `${failed} failed`;
  if (active) return `${active} active`;
  return `${completed}/${phases.length} complete`;
}

function sortHistory(items: AiGraderLocalReportHistoryItem[], sort: HistorySort) {
  const sorted = [...items];
  if (sort === "oldest") {
    return sorted.sort((a, b) => String(a.generatedAt ?? "").localeCompare(String(b.generatedAt ?? "")));
  }
  if (sort === "grade") {
    return sorted.sort((a, b) => (b.provisionalOverallGrade ?? -1) - (a.provisionalOverallGrade ?? -1));
  }
  if (sort === "category") {
    return sorted.sort((a, b) => String(a.category ?? "Unknown").localeCompare(String(b.category ?? "Unknown")));
  }
  return sorted.sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
}

function unsafePublishString(value: string) {
  return (
    /^data:image/i.test(value) ||
    /^[a-z]:\\/i.test(value) ||
    value.includes("\\TenKings\\") ||
    /https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)/i.test(value) ||
    /stationToken|x-ai-grader-station-token|service-token|DATABASE_URL/i.test(value)
  );
}

function sanitizePublishJson<T>(value: T): T {
  const visit = (current: unknown, key = ""): unknown => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "bodybase64" ||
      lowerKey === "bodyencoding" ||
      lowerKey === "dataurl" ||
      lowerKey === "localpath" ||
      lowerKey.endsWith("localpath") ||
      lowerKey.includes("stationtoken") ||
      lowerKey.includes("bridgetoken")
    ) {
      return undefined;
    }
    if (typeof current === "string") {
      return unsafePublishString(current) ? undefined : current;
    }
    if (Array.isArray(current)) {
      return current.map((entry) => visit(entry)).filter((entry) => entry !== undefined);
    }
    if (current && typeof current === "object") {
      const next: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(current)) {
        const cleaned = visit(entryValue, entryKey);
        if (cleaned !== undefined) next[entryKey] = cleaned;
      }
      return next;
    }
    return current;
  };
  return visit(value) as T;
}

function sanitizeReportBundleForProduction(bundle: AiGraderStationReportBundle): AiGraderStationReportBundle {
  if (isAiGraderReportBundleV03(bundle)) {
    const strictBundle = parseAiGraderMathematicalReportV1(bundle);
    if (!strictBundle) {
      throw new Error("Mathematical Grading V1 report validation failed before publish; V0 fallback is prohibited.");
    }
    return strictBundle;
  }
  const sanitized = sanitizePublishJson(bundle) as AiGraderLegacyReportBundle;
  return {
    ...sanitized,
    assets: productionAssetManifest(bundle),
    ...(Array.isArray(bundle.publicAssets)
      ? { publicAssets: (sanitized.publicAssets ?? []).map((asset) => sanitizePublishJson(asset)) }
      : {}),
  } as AiGraderLegacyReportBundle;
}

function sanitizeProductionReleaseForProduction(release: AiGraderStationProductionRelease | undefined, bundle: AiGraderStationReportBundle, selectedCard: CardSelectionState | null) {
  if (!release) return release;
  const linked = Boolean(selectedCard?.cardAssetId || selectedCard?.itemId || bundle.cardIdentity.cardAssetId || bundle.cardIdentity.itemId);
  return sanitizePublishJson({
    ...release,
    cardInventoryLinkage: {
      ...(release.cardInventoryLinkage ?? {}),
      status: linked ? "linked" : "needs_card_linkage",
      cardAssetId: selectedCard?.cardAssetId ?? bundle.cardIdentity.cardAssetId,
      itemId: selectedCard?.itemId ?? bundle.cardIdentity.itemId,
      note: linked
        ? "AI Grader report is linked to an existing Ten Kings card or item identity."
        : "Published AI Grader report is unlinked and needs card linkage before inventory automation.",
    },
  }) as AiGraderStationProductionRelease;
}

function sanitizeProductionReleaseForConfirm(release: AiGraderStationProductionRelease | undefined) {
  return release ? sanitizePublishJson(release) : release;
}

function productionPackageGradingSessionId(
  bundle: AiGraderStationReportBundle,
  release: AiGraderStationProductionRelease,
) {
  if (release.reportId !== bundle.reportId) {
    throw new Error("The recovered report bundle and production release do not share the same report identity.");
  }
  if (isAiGraderReportBundleV03(bundle)) {
    const issue = aiGraderMathematicalReleaseEnvelopeIssue(bundle, release);
    if (issue) throw new Error(`${issue} V0 fallback is prohibited.`);
    return release.gradingSessionId;
  }
  if (!bundle.gradingSessionId || release.gradingSessionId !== bundle.gradingSessionId) {
    throw new Error("The recovered legacy report bundle and production release do not share the same grading session.");
  }
  return release.gradingSessionId;
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).buffer;
}

type PreviewFrameSize = { width: number; height: number };

const REPORT_OVERLAY_DEFAULT_FRAME_SIZE: PreviewFrameSize = { width: 1200, height: 1680 };
const REPORT_OVERLAY_CARD_HEIGHT_RATIO = 0.97;
const REPORT_OVERLAY_CARD_ASPECT_RATIO = 2.5 / 3.5;
const PREVIEW_GEOMETRY_STATUS_POLL_MS = 200;
const PREVIEW_GEOMETRY_MAX_AGE_MS = 2000;
const REPORT_OVERLAY_ROI_RATIOS = [
  { id: "top-left-corner", type: "corner", x: 0, y: 0, width: 0.18, height: 0.18 },
  { id: "top-right-corner", type: "corner", x: 0.82, y: 0, width: 0.18, height: 0.18 },
  { id: "bottom-right-corner", type: "corner", x: 0.82, y: 0.82, width: 0.18, height: 0.18 },
  { id: "bottom-left-corner", type: "corner", x: 0, y: 0.82, width: 0.18, height: 0.18 },
  { id: "top-edge", type: "edge", x: 0.18, y: 0, width: 0.64, height: 0.12 },
  { id: "right-edge", type: "edge", x: 0.88, y: 0.18, width: 0.12, height: 0.64 },
  { id: "bottom-edge", type: "edge", x: 0.18, y: 0.88, width: 0.64, height: 0.12 },
  { id: "left-edge", type: "edge", x: 0, y: 0.18, width: 0.12, height: 0.64 },
  { id: "center-surface", type: "surface", x: 0.35, y: 0.35, width: 0.3, height: 0.3 },
  { id: "upper-surface", type: "surface", x: 0.3, y: 0.18, width: 0.4, height: 0.22 },
  { id: "lower-surface", type: "surface", x: 0.3, y: 0.6, width: 0.4, height: 0.22 },
] as const;

function reportOverlayTemplateRect(width: number, height: number) {
  const guideHeight = Math.round(height * REPORT_OVERLAY_CARD_HEIGHT_RATIO);
  const guideWidth = Math.round(guideHeight * REPORT_OVERLAY_CARD_ASPECT_RATIO);
  return {
    x: Math.round((width - guideWidth) / 2),
    y: Math.round((height - guideHeight) / 2),
    width: guideWidth,
    height: guideHeight,
  };
}

function reportOverlayRoiRects(template: ReturnType<typeof reportOverlayTemplateRect>) {
  return REPORT_OVERLAY_ROI_RATIOS.map((roi) => ({
    ...roi,
    x: Math.round(template.x + template.width * roi.x),
    y: Math.round(template.y + template.height * roi.y),
    width: Math.round(template.width * roi.width),
    height: Math.round(template.height * roi.height),
  }));
}

function containedImageFrame(container: PreviewFrameSize, image: PreviewFrameSize) {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const containerAspect = container.width / container.height;
  const imageAspect = image.width / image.height;
  const width = imageAspect >= containerAspect ? container.width : container.height * imageAspect;
  const height = imageAspect >= containerAspect ? container.width / imageAspect : container.height;
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}

const defaultIdentityDraft: IdentityDraftState = {
  category: "sport",
  playerName: "",
  cardName: "",
  teamName: "",
  year: "",
  manufacturer: "",
  sport: "",
  game: "",
  productSet: "",
  cardNumber: "",
  insert: "",
  parallel: "",
  numbered: "",
  autograph: false,
  memorabilia: false,
};

const defaultMathematicalAuthorityDraft: MathematicalAuthorityDraftState = {
  title: "",
  tenantId: "",
  setId: "",
  programId: "",
  cardNumber: "",
  variantId: "",
  parallelId: "",
  profiles: {
    front: "printed_border_v1",
    back: "printed_border_v1",
  },
};

const OCR_PREFILL_FIELD_LABELS = {
  category: "Category",
  playerName: "Player",
  cardName: "Card",
  year: "Year",
  manufacturer: "Maker",
  sport: "Sport",
  game: "Game",
  productSet: "Set",
  cardNumber: "Card #",
  parallel: "Parallel",
  insert: "Insert",
  numbered: "Numbered",
  autograph: "Auto",
  memorabilia: "Mem",
} as const;

const RAPID_REVIEWABLE_STATES = new Set<string>([
  "finding_review_required",
  "insufficient_evidence",
  "report_ready_needs_confirm",
  "confirmed_needs_publish",
  "published",
]);
const RAPID_PROCESSING_STATES = new Set<string>(["front_captured", "front_processing", "back_positioning", "back_captured", "finalizing"]);

function pointToward(
  from: AiGraderPreviewGeometryPoint,
  toward: AiGraderPreviewGeometryPoint,
  distance: number
): AiGraderPreviewGeometryPoint {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return { ...from };
  const scale = Math.min(0.45, distance / length);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function midpoint(
  first: AiGraderPreviewGeometryPoint,
  second: AiGraderPreviewGeometryPoint
): AiGraderPreviewGeometryPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function centeredAxisLine(
  center: AiGraderPreviewGeometryPoint,
  from: AiGraderPreviewGeometryPoint,
  toward: AiGraderPreviewGeometryPoint,
  halfLength: number
) {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  const unitX = dx / length;
  const unitY = dy / length;
  return {
    x1: center.x - unitX * halfLength,
    y1: center.y - unitY * halfLength,
    x2: center.x + unitX * halfLength,
    y2: center.y + unitY * halfLength,
  };
}

const emptyFinishQueue: FinishQueueResult = {
  source: "persisted_records",
  orderedBy: "publishedAt_asc_createdAt_asc",
  items: [],
  stats: {
    total: 0,
    needsSlabPhotos: 0,
    needsEbayEvaluate: 0,
    needsInventory: 0,
    complete: 0,
  },
};

function identityDraftMissingFields(draft: IdentityDraftState) {
  const missing: string[] = [];
  if (!draft.year.trim()) missing.push("year");
  if (!draft.manufacturer.trim()) missing.push("manufacturer");
  if (!draft.productSet.trim()) missing.push("product set");
  if (!draft.cardNumber.trim()) missing.push("card number");
  if (draft.category === "sport") {
    if (!draft.playerName.trim()) missing.push("player/name");
    if (!draft.sport.trim()) missing.push("sport");
  } else if (draft.category === "tcg") {
    if (!draft.cardName.trim()) missing.push("card name");
    if (!draft.game.trim()) missing.push("game");
  } else if (!draft.cardName.trim()) {
    missing.push("card name");
  }
  return missing;
}

function lightingPhysicalStateAcknowledged(lighting: AiGraderLiveLightingStatus) {
  const expected = lighting.applied.expectedWriteCount;
  const responseKinds = lighting.applied.lastResponseKinds ?? [];
  const appliedVerifiedAt = lighting.applied.verifiedAt;
  const physicalVerifiedAt = lighting.physicalState.verifiedAt;
  const canonicalTimestamp = (value: string | undefined) => Boolean(
    value && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  );
  return Number.isInteger(expected) && expected > 0 &&
    lighting.applied.acknowledgedWriteCount === expected &&
    lighting.physicalState.expectedWriteCount === expected &&
    lighting.physicalState.acknowledgedWriteCount === expected &&
    responseKinds.length === expected &&
    responseKinds.every((kind) => kind === 'ack' || kind === 'mock') &&
    canonicalTimestamp(appliedVerifiedAt) && canonicalTimestamp(physicalVerifiedAt) &&
    appliedVerifiedAt === physicalVerifiedAt &&
    lighting.applied.verificationState === 'verified' &&
    lighting.applied.verificationComplete === true &&
    lighting.physicalState.complete === true &&
    lighting.physicalState.lastError === undefined && lighting.lastError === undefined &&
    (lighting.connection.state === 'idle' || lighting.connection.state === 'mock') &&
    (lighting.physicalState.state === 'safe_off_verified' ||
      lighting.physicalState.state === 'positioning_light_verified');
}

function lightingSafeOffCompletelyAcknowledged(lighting: AiGraderLiveLightingStatus) {
  return lightingPhysicalStateAcknowledged(lighting) && lighting.status === 'safe_off' &&
    lighting.applied.enabled === false && lighting.physicalState.state === 'safe_off_verified';
}

function lightingPositioningCompletelyAcknowledged(lighting: AiGraderLiveLightingStatus) {
  return lightingPhysicalStateAcknowledged(lighting) && lighting.status === 'on' &&
    lighting.profile.enabled === true && lighting.applied.enabled === true &&
    lighting.applied.dutyPercent === lighting.profile.dutyPercent &&
    lighting.applied.actualLeimacPwmStep === lighting.profile.actualLeimacPwmStep &&
    lighting.applied.channels.join(',') === lighting.profile.channels.join(',') &&
    lighting.physicalState.state === 'positioning_light_verified';
}

export default function AiGraderStationPage() {
  const { session, loading: sessionLoading, ensureSession, logout } = useSession();
  const [status, setStatus] = useState<AiGraderLocalStationStatus>(() => buildAiGraderLocalStationStatus({ action: "status" }));
  const [workArea, setWorkArea] = useState<StationWorkArea>("grade");
  const [busy, setBusy] = useState<string | null>(null);
  const previewBrowserCaptureActionActive = busy === "start-grading" || busy === "capture-back";
  const [error, setError] = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  const [stationToken, setStationToken] = useState("");
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeConnectionState, setBridgeConnectionState] = useState<BridgeConnectionState>("checking");
  const [previewStatus, setPreviewStatus] = useState(status.previewStatus);
  const [previewFreshnessNow, setPreviewFreshnessNow] = useState(() => Date.now());
  const previewLastLiveFrameAtRef = useRef(0);
  const previewControllerRef = useRef<AbortController | null>(null);
  const previewReaderPromiseRef = useRef<Promise<unknown> | null>(null);
  const previewAttemptGenerationRef = useRef(0);
  const initialPreviewBinding = aiGraderPreviewStatusBinding(status.previewStatus);
  const [previewEpochState, setPreviewEpochState] = useState<AiGraderPreviewEpochState>(() =>
    createAiGraderPreviewEpochState(initialPreviewBinding)
  );
  const previewEpochStateRef = useRef(previewEpochState);
  const cameraFrameRef = useRef<HTMLDivElement | null>(null);
  const [cameraFrameSize, setCameraFrameSize] = useState<PreviewFrameSize>({ width: 0, height: 0 });
  const [previewImageSize, setPreviewImageSize] = useState<PreviewFrameSize | null>(null);
  const [liveLighting, setLiveLighting] = useState(status.liveLighting);
  const liveLightingAuthorityAcknowledged = lightingPhysicalStateAcknowledged(liveLighting);
  const [liveLightingRequestPending, setLiveLightingRequestPending] = useState(false);
  const liveLightingRequestPendingRef = useRef(false);
  const liveLightingApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [manualPairingCode, setManualPairingCode] = useState("");
  const [advancedConnectOpen, setAdvancedConnectOpen] = useState(false);
  const [contractPreviewEnabled, setContractPreviewEnabled] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView>("list");
  const [historySort, setHistorySort] = useState<HistorySort>("most_recent");
  const [history, setHistory] = useState<AiGraderLocalReportHistory>(() => buildSampleAiGraderReportHistory());
  const [productionPublish, setProductionPublish] = useState<ProductionPublishState>({
    status: "idle",
    message: "Ten Kings DB/storage publish has not been run.",
  });
  const [cardSearchQuery, setCardSearchQuery] = useState("");
  const [cardSearchResults, setCardSearchResults] = useState<CardSelectionState[]>([]);
  const [cardSearchMessage, setCardSearchMessage] = useState("Confirm the card identity to create a Ten Kings CardAsset/Item before publish.");
  const [selectedCard, setSelectedCard] = useState<CardSelectionState | null>(null);
  const [identityDraft, setIdentityDraft] = useState<IdentityDraftState>(defaultIdentityDraft);
  const identityEditedFieldsRef = useRef<Set<keyof IdentityDraftState>>(new Set());
  const ocrAttemptedReportIdsRef = useRef<Set<string>>(new Set());
  const ocrPrefillGenerationRef = useRef(0);
  const [ocrPrefillRetryNonce, setOcrPrefillRetryNonce] = useState(0);
  const [ocrPrefillState, setOcrPrefillState] = useState<AiGraderOcrPrefillState>({
    status: "idle",
    message: "OCR prefill starts after normalized front and back images are ready.",
  });
  const [stationCaptureProfile, setStationCaptureProfile] = useState<AiGraderCaptureProfile>(status.captureProfile);
  const [stationCaptureMode, setStationCaptureMode] = useState<StationCaptureMode>(status.rapidCapture.enabled ? "rapid" : "single");
  const [selectedGradingContract, setSelectedGradingContract] = useState<AiGraderGradingContract>("legacy_v0");
  const [mathematicalAuthorityDraft, setMathematicalAuthorityDraft] =
    useState<MathematicalAuthorityDraftState>(defaultMathematicalAuthorityDraft);
  const [mathematicalAuthorityStatus, setMathematicalAuthorityStatus] = useState<StepState>({
    status: "idle",
    message: "Enter the exact card identity and select one honest centering profile per side before capture.",
  });
  const [mathematicalReviewDispositions, setMathematicalReviewDispositions] =
    useState<Record<string, "confirmed" | "adjusted" | undefined>>({});
  const [mathematicalReviewAssets, setMathematicalReviewAssets] =
    useState<MathematicalReviewAssetState>({
      status: "idle",
      message: "No exact Mathematical V1 finding review is pending.",
      assets: {},
    });
  const mathematicalReviewObjectUrlsRef = useRef<string[]>([]);
  const [identityStatus, setIdentityStatus] = useState<StepState>({
    status: "idle",
    message: "Card identity has not been confirmed.",
  });
  const [confirmedDownstream, setConfirmedDownstream] = useState<ConfirmedDownstreamState>({
    comps: {
      status: "idle",
      message: "Comps will queue after Approve & Publish.",
    },
  });
  const [productionAuthState, setProductionAuthState] = useState<StepState>({
    status: "idle",
    message: "Sign in is required before production card creation, publish, label, comps, and inventory steps.",
  });
  const [productionAuthActor, setProductionAuthActor] = useState<ProductionAuthActorState>(null);
  const [slabUploads, setSlabUploads] = useState<SlabUploadState>({});
  const [compsState, setCompsState] = useState<CompsState>({
    status: "idle",
    message: "Comps have not been run.",
  });
  const [inventoryState, setInventoryState] = useState<StepState>({
    status: "idle",
    message: "Card has not been added to inventory.",
  });
  const [localReport, setLocalReport] = useState<LocalReportState>({
    open: false,
    status: "idle",
    message: "No local report is open.",
  });
  const [finishQueue, setFinishQueue] = useState<FinishQueueResult>(emptyFinishQueue);
  const [finishQueueState, setFinishQueueState] = useState<StepState>({
    status: "idle",
    message: "Finish Cards queue has not been loaded.",
  });
  const [selectedFinishReportId, setSelectedFinishReportId] = useState<string | null>(null);
  const [finishReportCache, setFinishReportCache] = useState<Record<string, AiGraderStationReportBundle>>({});
  const [profileDraft, setProfileDraft] = useState({
    dutyPercent: status.acceptedProfile.dutyPercent,
    exposureUs: status.acceptedProfile.exposureUs,
    gain: status.acceptedProfile.gain,
  });
  const [liveLightingDraft, setLiveLightingDraft] = useState({
    ...aiGraderAuthoritativeLiveLightingDraft(status.liveLighting),
  });
  const mathematicalExecution = status.mathematicalV1?.execution;
  const mathematicalReviewRequest: AiGraderMathematicalFindingReviewRequestV1 | undefined =
    mathematicalExecution?.status === "finding_review_required"
      ? mathematicalExecution.reviewRequest
      : undefined;
  const mathematicalReviewIssues =
    mathematicalExecution?.status === "finding_review_required"
      ? mathematicalExecution.reviewIssues
      : [];
  const mathematicalAuthorityBound = Boolean(status.mathematicalV1?.gradingAuthority);
  const mathematicalReleaseReady =
    status.gradingContract !== "mathematical_calibration_v1" ||
    mathematicalExecution?.status === "completed";

  const revokeMathematicalReviewObjectUrls = () => {
    for (const objectUrl of mathematicalReviewObjectUrlsRef.current) {
      window.URL.revokeObjectURL(objectUrl);
    }
    mathematicalReviewObjectUrlsRef.current = [];
  };

  const applyPreviewEpochEvent = (event: AiGraderPreviewEpochEvent) => {
    const transition = transitionAiGraderPreviewEpoch(previewEpochStateRef.current, event);
    for (const objectUrl of transition.revokeObjectUrls) {
      window.URL.revokeObjectURL(objectUrl);
    }
    previewEpochStateRef.current = transition.state;
    setPreviewEpochState(transition.state);
    const displayed = aiGraderPreviewDisplayedSnapshot(transition.state);
    setPreviewImageSize(
      displayed?.imageWidth && displayed.imageHeight
        ? { width: displayed.imageWidth, height: displayed.imageHeight }
        : null
    );
    return transition;
  };

  const clearPreviewDisplay = (statusOverride?: AiGraderLocalStationStatus["previewStatus"]["status"]) => {
    applyPreviewEpochEvent({ type: "clear", ...(statusOverride ? { status: statusOverride } : {}) });
    previewLastLiveFrameAtRef.current = 0;
  };

  useEffect(() => {
    reconcileBridgePreviewStatus(status.previewStatus);
    setLiveLighting(status.liveLighting);
    setLiveLightingDraft(aiGraderAuthoritativeLiveLightingDraft(status.liveLighting));
  }, [status.previewStatus, status.liveLighting]);

  useEffect(() => {
    const request = mathematicalReviewRequest;
    setMathematicalReviewDispositions({});
    revokeMathematicalReviewObjectUrls();
    if (!request) {
      setMathematicalReviewAssets({
        status: "idle",
        message: mathematicalExecution?.status === "insufficient_evidence"
          ? "Mathematical V1 stopped with explicit insufficient evidence; no review assets can authorize release."
          : "No exact Mathematical V1 finding review is pending.",
        assets: {},
      });
      return;
    }
    if (!bridgeConnected || !stationToken.trim()) {
      setMathematicalReviewAssets({
        status: "error",
        requestSha256: request.artifactSha256,
        message: "Connect the paired Dell bridge to verify the exact pending finding-review evidence.",
        assets: {},
      });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const objectUrls: string[] = [];
    setMathematicalReviewAssets({
      status: "loading",
      requestSha256: request.artifactSha256,
      message: "Loading and SHA-256 verifying True View, eight directional channels, ROI, segmentation, confidence, and illumination evidence.",
      assets: {},
    });
    void (async () => {
      try {
        const requirements = collectAiGraderMathematicalReviewAssets(request);
        const assets: Record<string, MathematicalReviewAssetView> = {};
        for (const requirement of requirements) {
          const fetched = await fetchAiGraderMathematicalReviewAsset({
            baseUrl: bridgeUrl,
            stationToken,
            reportId: request.reportId,
            requirement,
            signal: controller.signal,
          });
          if (cancelled) return;
          const objectUrl = window.URL.createObjectURL(fetched.blob);
          objectUrls.push(objectUrl);
          assets[aiGraderMathematicalReviewAssetKey(requirement)] = {
            side: fetched.side,
            metadata: fetched.metadata,
            objectUrl,
          };
        }
        if (cancelled) return;
        mathematicalReviewObjectUrlsRef.current = [...objectUrls];
        setMathematicalReviewAssets({
          status: "ready",
          requestSha256: request.artifactSha256,
          message: "Every pending review asset matched its exact identity, role, dimensions, byte count, and SHA-256.",
          assets,
        });
      } catch (requestError) {
        for (const objectUrl of objectUrls) window.URL.revokeObjectURL(objectUrl);
        if (cancelled || controller.signal.aborted) return;
        setMathematicalReviewAssets({
          status: "error",
          requestSha256: request.artifactSha256,
          message: requestError instanceof Error
            ? requestError.message
            : "Exact Mathematical V1 review evidence verification failed.",
          assets: {},
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      const urls = mathematicalReviewObjectUrlsRef.current.length
        ? mathematicalReviewObjectUrlsRef.current
        : objectUrls;
      for (const objectUrl of urls) window.URL.revokeObjectURL(objectUrl);
      mathematicalReviewObjectUrlsRef.current = [];
    };
  }, [
    bridgeConnected,
    bridgeUrl,
    mathematicalReviewRequest?.artifactSha256,
    stationToken,
  ]);

  useEffect(() => () => revokeMathematicalReviewObjectUrls(), []);

  useEffect(() => {
    const frame = cameraFrameRef.current;
    if (!frame || typeof window === "undefined") return;
    const updateFrameSize = () => {
      const rect = frame.getBoundingClientRect();
      setCameraFrameSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    updateFrameSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFrameSize);
      return () => window.removeEventListener("resize", updateFrameSize);
    }
    const observer = new ResizeObserver(updateFrameSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const setupBridge = async () => {
      const savedBridgeUrl = window.localStorage.getItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY) || DEFAULT_AI_GRADER_STATION_BRIDGE_URL;
      const savedToken = window.localStorage.getItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY) || "";
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const pairingCode = hashParams.get("aiGraderBridgePair") ?? "";
      if (cancelled) return;
      setBridgeUrl(savedBridgeUrl);
      if (savedToken) setStationToken(savedToken);
      try {
        await fetchAiGraderStationBridgeHealth({ baseUrl: savedBridgeUrl });
      } catch (requestError) {
        if (!cancelled) {
          const message = requestError instanceof Error ? requestError.message : "AI Grader local bridge health check failed.";
          if (/update\/restart required/i.test(message)) {
            setBridgeConnectionState("error");
            setError(message);
          } else {
            setBridgeConnectionState("not_running");
          }
        }
        return;
      }
      if (pairingCode) {
        try {
          const paired = await pairAiGraderStationBridge({ baseUrl: savedBridgeUrl, pairingCode });
          if (cancelled) return;
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
          await connectBridgeWithCredentials(paired.bridgeUrl || savedBridgeUrl, paired.stationToken);
          return;
        } catch (requestError) {
          if (!cancelled) {
            setBridgeConnectionState("pairing_required");
            setError(requestError instanceof Error ? requestError.message : "AI Grader station pairing failed.");
          }
          return;
        }
      }
      if (savedToken) {
        try {
          await connectBridgeWithCredentials(savedBridgeUrl, savedToken);
          return;
        } catch {
          window.localStorage.removeItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY);
          if (!cancelled) {
            setStationToken("");
            setBridgeConnected(false);
            setBridgeConnectionState("pairing_required");
          }
          return;
        }
      }
      if (!cancelled) setBridgeConnectionState("pairing_required");
    };
    void setupBridge();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (liveLightingApplyTimerRef.current) {
        clearTimeout(liveLightingApplyTimerRef.current);
        liveLightingApplyTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      const cleared = transitionAiGraderPreviewEpoch(previewEpochStateRef.current, { type: "clear", status: "stopped" });
      for (const objectUrl of cleared.revokeObjectUrls) window.URL.revokeObjectURL(objectUrl);
      previewEpochStateRef.current = cleared.state;
    };
  }, []);

  useEffect(() => {
    if (
      !bridgeConnected ||
      !stationToken.trim() ||
      liveLightingRequestPending ||
      !lightingPositioningCompletelyAcknowledged(liveLighting)
    ) return;
    const timer = setInterval(() => {
      if (Date.now() - previewLastLiveFrameAtRef.current > PREVIEW_GEOMETRY_MAX_AGE_MS) return;
      void heartbeatAiGraderLiveLighting({ baseUrl: bridgeUrl, stationToken }).then(async (next) => {
        if (!lightingPhysicalStateAcknowledged(next)) {
          throw new Error('Lighting heartbeat returned incomplete controller acknowledgement truth.');
        }
        const refreshed = await callAiGraderStationBridge({
          baseUrl: bridgeUrl,
          stationToken,
          action: 'status',
        });
        setStatus(refreshed);
        reconcileBridgePreviewStatus(refreshed.previewStatus);
        setLiveLighting(refreshed.liveLighting);
        if (!lightingPhysicalStateAcknowledged(refreshed.liveLighting)) {
          throw new Error('Lighting heartbeat status refresh returned incomplete controller acknowledgement truth.');
        }
      }).catch((heartbeatError) => {
        setError(heartbeatError instanceof Error ? heartbeatError.message : 'Lighting heartbeat failed.');
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [
    bridgeConnected,
    bridgeUrl,
    liveLightingRequestPending,
    liveLighting.applied.enabled,
    liveLighting.applied.expectedWriteCount,
    liveLighting.applied.acknowledgedWriteCount,
    liveLighting.applied.lastResponseKinds,
    liveLighting.applied.verificationState,
    liveLighting.applied.verificationComplete,
    liveLighting.applied.verifiedAt,
    liveLighting.physicalState.state,
    liveLighting.physicalState.expectedWriteCount,
    liveLighting.physicalState.acknowledgedWriteCount,
    liveLighting.physicalState.complete,
    liveLighting.physicalState.verifiedAt,
    liveLighting.physicalState.lastError,
    liveLighting.lastError,
    liveLighting.connection.state,
    stationToken,
  ]);

  useEffect(() => {
    if (previewStatus.status !== "live") return;
    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      setPreviewFreshnessNow(nowMs);
      applyPreviewEpochEvent({ type: "tick", nowMs });
    }, 250);
    return () => window.clearInterval(timer);
  }, [previewStatus.status]);

  useEffect(() => {
    const positioningStepActive = !status.sessionManifest.backCaptured &&
      (status.currentStep === "prompt_flip_card" || !status.sessionManifest.frontCaptured);
    const previewEligible = bridgeConnected &&
      Boolean(stationToken.trim()) &&
      positioningStepActive &&
      !previewBrowserCaptureActionActive &&
      !status.warmRunnerStatus.captureLock.held &&
      status.warmRunnerStatus.status !== "capturing" &&
      status.warmRunnerStatus.previewPolicy.holdActive !== true;
    if (!previewEligible) {
      previewAttemptGenerationRef.current += 1;
      previewControllerRef.current?.abort();
      previewControllerRef.current = null;
      clearPreviewDisplay("paused_for_capture");
      return;
    }

    const expectedBinding = previewEpochStateRef.current.binding;
    if (!expectedBinding) {
      setPreviewStatus((current) => ({
        ...current,
        status: "error",
        cameraOwnership: "released",
        lastError: "Preview session/side epoch is unavailable.",
      }));
      return;
    }

    let cancelled = false;
    const generation = ++previewAttemptGenerationRef.current;
    const isCurrent = () => !cancelled && previewAttemptGenerationRef.current === generation;
    const controller = new AbortController();
    previewControllerRef.current = controller;

    const readPreview = async () => {
      try {
        const authoritative = await fetchAiGraderStationPreviewStatus({ baseUrl: bridgeUrl, stationToken });
        if (!isCurrent()) return;
        if (!aiGraderPreviewBindingMatches(aiGraderPreviewStatusBinding(authoritative), expectedBinding)) {
          reconcileBridgePreviewStatus(authoritative);
          return;
        }
        clearPreviewDisplay();
        applyPreviewEpochEvent({ type: "opened", binding: expectedBinding });
        const readerPromise = openAiGraderStationPreviewStream(
          { baseUrl: bridgeUrl, stationToken },
          {
            signal: controller.signal,
            onOpen() {
              if (isCurrent()) {
                setPreviewStatus((current) => ({ ...current, status: "starting", implementationType: "mjpeg_fetch_stream" }));
              }
            },
            onFrame(frame) {
              if (!isCurrent()) return;
              const frameBinding = sanitizeAiGraderPreviewFrameBinding(frame);
              if (!frameBinding || !aiGraderPreviewBindingMatches(frameBinding, expectedBinding)) return;
              const objectUrl = window.URL.createObjectURL(frame.blob);
              const receivedAtMs = Date.now();
              const transition = applyPreviewEpochEvent({
                type: "frame",
                frame: frameBinding,
                objectUrl,
                receivedAtMs,
                capturedAt: frame.capturedAt,
              });
              if (!transition.accepted) return;
              const previewImage = new window.Image();
              previewImage.onload = () => {
                if (!isCurrent()) return;
                applyPreviewEpochEvent({
                  type: "image_loaded",
                  frame: frameBinding,
                  loadedAtMs: Date.now(),
                  width: previewImage.naturalWidth,
                  height: previewImage.naturalHeight,
                });
              };
              previewImage.src = objectUrl;
              previewLastLiveFrameAtRef.current = receivedAtMs;
              setPreviewFreshnessNow(receivedAtMs);
              setPreviewStatus((current) => ({
                ...current,
                status: "live",
                sessionId: frameBinding.sessionId,
                activeSide: frameBinding.side,
                sideEpoch: frameBinding.sideEpoch,
                latestFrameId: frameBinding.frameId,
                frameCount: frame.frameIndex ?? current.frameCount + 1,
                firstFrameAt: current.firstFrameAt ?? frame.capturedAt ?? new Date().toISOString(),
                lastFrameAt: frame.capturedAt ?? new Date().toISOString(),
                cameraOwnership: "preview_stream",
              }));
            },
            onEof() {
              if (!isCurrent()) return;
              clearPreviewDisplay("stopped");
              setPreviewStatus((current) => ({
                ...current,
                status: "stopped",
                cameraOwnership: "released",
                lastStopReason: "Preview stream ended. Start New Card or Capture will establish the next explicit state.",
              }));
            },
            onAbort() {
              if (isCurrent()) clearPreviewDisplay("stopped");
            },
            onState(event) {
              if (isCurrent() && event.previewStatus) reconcileBridgePreviewStatus(event.previewStatus);
            },
            onError(streamError) {
              if (!isCurrent()) return;
              clearPreviewDisplay("error");
              setPreviewStatus((current) => ({
                ...current,
                status: "error",
                cameraOwnership: "released",
                lastError: streamError.message,
              }));
            },
          },
        );
        previewReaderPromiseRef.current = readerPromise;
        try {
          await readerPromise;
        } finally {
          if (previewReaderPromiseRef.current === readerPromise) previewReaderPromiseRef.current = null;
        }
      } catch (requestError) {
        if (!isCurrent() || controller.signal.aborted) return;
        clearPreviewDisplay("error");
        setPreviewStatus((current) => ({
          ...current,
          status: "error",
          cameraOwnership: "released",
          lastError: requestError instanceof Error ? requestError.message : "AI Grader preview stream is unavailable.",
        }));
      } finally {
        if (previewControllerRef.current === controller) previewControllerRef.current = null;
      }
    };

    void readPreview();
    return () => {
      cancelled = true;
      previewAttemptGenerationRef.current += 1;
      controller.abort();
      if (previewControllerRef.current === controller) previewControllerRef.current = null;
    };
  }, [
    bridgeConnected,
    bridgeUrl,
    previewBrowserCaptureActionActive,
    stationToken,
    status.currentStep,
    status.sessionManifest.backCaptured,
    status.sessionManifest.frontCaptured,
    status.warmRunnerStatus.captureLock.held,
    status.warmRunnerStatus.previewPolicy.holdActive,
    status.warmRunnerStatus.status,
  ]);
  useEffect(() => {
    if (!bridgeConnected || !stationToken.trim() || previewStatus.status !== "live") return;
    let cancelled = false;
    let requestPending = false;
    const refreshGeometry = async () => {
      if (requestPending) return;
      requestPending = true;
      const requestBinding = previewEpochStateRef.current.binding;
      const requestGeneration = previewAttemptGenerationRef.current;
      try {
        const latest = await fetchAiGraderStationPreviewStatus({ baseUrl: bridgeUrl, stationToken });
        if (
          cancelled ||
          requestGeneration !== previewAttemptGenerationRef.current ||
          !aiGraderPreviewBindingMatches(requestBinding, previewEpochStateRef.current.binding)
        ) return;
        const binding = requestBinding;
        if (
          latest.status !== "live" ||
          !binding ||
          !aiGraderPreviewBindingMatches(aiGraderPreviewStatusBinding(latest), binding)
        ) {
          reconcileBridgePreviewStatus(latest);
          return;
        }
        const geometryBySide = mergePreviewCardGeometry(undefined, latest.cardGeometry);
        const activeGeometry = geometryBySide?.[binding.side];
        const geometryObservedAtMs = Date.now();
        applyPreviewEpochEvent({
          type: "geometry",
          binding,
          geometry: activeGeometry,
          observedAtMs: geometryObservedAtMs,
        });
        setPreviewStatus((currentStatus) => ({
          ...latest,
          status: previewEpochStateRef.current.phase === "live" ? "live" : "starting",
          frameCount: Math.max(currentStatus.frameCount, latest.frameCount),
          firstFrameAt: currentStatus.firstFrameAt ?? latest.firstFrameAt,
          lastFrameAt: latest.lastFrameAt ?? currentStatus.lastFrameAt,
          cardGeometry: geometryBySide,
        }));
      } catch {
        // Geometry status is advisory to the preview stream; exact detected geometry is still mandatory for capture.
      } finally {
        requestPending = false;
      }
    };
    void refreshGeometry();
    const timer = window.setInterval(() => void refreshGeometry(), PREVIEW_GEOMETRY_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    bridgeConnected,
    bridgeUrl,
    liveLighting.applied.enabled,
    liveLighting.applied.verificationState,
    liveLighting.applied.verificationComplete,
    liveLighting.physicalState.state,
    liveLighting.physicalState.complete,
    liveLighting.physicalState.verifiedAt,
    previewStatus.status,
    stationToken,
  ]);

  const currentStep = useMemo(
    () => AI_GRADER_STATION_STEPS.find((step) => step.id === status.currentStep) ?? AI_GRADER_STATION_STEPS[0],
    [status.currentStep]
  );
  const operatorStepCopy = aiGraderOperatorStepCopy(status.currentStep);
  const displayedStep = operatorStepCopy ? { ...currentStep, ...operatorStepCopy } : currentStep;

  const sortedHistory = useMemo(() => sortHistory(history.items, historySort), [history.items, historySort]);
  const selectedCardIdentity = useMemo(() => {
    if (!selectedCard) return null;
    return {
      cardAssetId: selectedCard.cardAssetId,
      itemId: selectedCard.itemId,
      title: selectedCard.title ?? selectedCard.displayTitle,
      set: selectedCard.set,
      cardNumber: selectedCard.cardNumber,
      source: selectedCard.source,
    };
  }, [selectedCard]);
  const reportReady = status.latestReport.exists && Boolean(status.latestReport.reportId);
  const finalReady =
    mathematicalReleaseReady &&
    (status.safety.finalGradeComputed || Boolean(status.productionRelease?.finalGradeComputed));
  const labelReady = status.safety.labelGenerated || Boolean(status.outputs?.labelDataPath) || status.productionRelease?.label.status === "label_data_ready";
  const linkedCardReady = Boolean((selectedCard?.cardAssetId || selectedCard?.itemId) && selectedCard.source !== "manual_draft");
  const slabbedPhotosReady = slabUploads.front?.status === "uploaded" && slabUploads.back?.status === "uploaded";
  const compsSaved = compsState.saved === true || compsState.status === "saved";
  const inventoryComplete = inventoryState.status === "completed";
  const publishReadiness = buildAiGraderPublishReadiness({
    bundle: status.reportBundle,
    productionRelease: status.productionRelease,
    published: productionPublish.status === "published",
  });
  const productionPublished = productionPublish.status === "published";
  const reportIdForLinks = productionPublish.reportId ?? publishReadiness.reportId ?? status.latestReport.reportId;
  const labelPreviewUrl = productionPublished ? productionPublish.labelPreviewUrl : undefined;
  const publicReportUrl = productionPublished ? productionPublish.publicReportUrl : undefined;
  const qrPayloadUrl = productionPublished ? productionPublish.qrPayloadUrl : undefined;
  const certId = productionPublish.certId ?? publishReadiness.certId;
  const identityDraftMissing = identityDraftMissingFields(identityDraft);
  const identityDraftComplete = identityDraftMissing.length === 0;
  const productionSignedIn = Boolean(session?.token && productionAuthState.status === "completed" && productionAuthActor);
  const productionOperatorLabel =
    productionAuthActor?.displayName || session?.user.displayName || session?.user.phone || "Ten Kings operator";
  const createCardBlockers = [
    !reportReady ? "generated report" : "",
    ...identityDraftMissing,
  ].filter(Boolean);
  const canApproveAndPublish = aiGraderApproveAndPublishEligible({
    reportReady,
    finalReady,
    productionSignedIn,
    identityReady: linkedCardReady || identityDraftComplete,
    publishStatus: productionPublish.status,
  }) && mathematicalReleaseReady;
  const selectedFinishItem = finishQueue.items.find((item) => item.reportId === selectedFinishReportId) ?? finishQueue.items[0] ?? null;
  const selectedFinishReportIdForActions = selectedFinishItem?.reportId ?? null;
  const selectedFinishSlabReady = Boolean(selectedFinishItem?.slabPhotos.complete) || slabbedPhotosReady;
  const selectedFinishCompsSaved = Boolean(selectedFinishItem?.valuation.complete) || compsSaved;
  const selectedFinishInventoryComplete = Boolean(selectedFinishItem?.inventory.complete) || inventoryComplete;
  const canSaveSelectedComps =
    (productionPublished || Boolean(selectedFinishItem)) &&
    Array.isArray(compsState.compsRefs) &&
    (compsState.selectedIds?.length ?? 0) > 0 &&
    compsState.status === "completed";
  const canAddSelectedFinishToInventory =
    Boolean(selectedFinishItem) &&
    selectedFinishSlabReady &&
    selectedFinishCompsSaved &&
    !selectedFinishInventoryComplete &&
    Boolean(selectedFinishItem?.inventory.canAddToInventory || selectedFinishItem?.label.printed);
  const gradePipelineSteps = [
    {
      id: "grade",
      label: "Grade",
      done: finalReady,
      action: finalReady ? "Final grade exists." : "Run capture and final grading.",
    },
    {
      id: "publish",
      label: "Approve & Publish",
      done: productionPublished,
      action: productionPublished ? "Public report, durable linkage and label assignment are complete." : "One human authority publishes the exact card.",
    },
  ];
  const finishPipelineSteps = [
    {
      id: "slab",
      label: "Upload Slab Photos",
      done: selectedFinishSlabReady,
      action: selectedFinishSlabReady ? "Slabbed front/back photos are attached." : "Upload slabbed front and back photos.",
    },
    {
      id: "comps",
      label: "eBay Evaluate",
      done: selectedFinishCompsSaved,
      action: selectedFinishCompsSaved ? "Selected comps and valuation are saved." : "Run eBay comps, select matches, and save value.",
    },
    {
      id: "inventory",
      label: "Add To Inventory",
      done: selectedFinishInventoryComplete,
      action: selectedFinishInventoryComplete ? "Inventory-ready transition complete." : "Move the card into the inventory flow.",
    },
  ];
  const activePipelineStep = gradePipelineSteps.find((step) => !step.done) ?? gradePipelineSteps[gradePipelineSteps.length - 1];
  const publicationStatusLabel =
    productionPublish.status === "idle" ? formatStationValue(publishReadiness.status) : formatStationValue(productionPublish.status);
  const ocrPrefillReportId = status.reportBundle?.reportId;
  const ocrPrefillIndicators = ocrPrefillState.result
    ? Object.entries(ocrPrefillState.result.fields).flatMap(([fieldName, field]) => {
        if (field.value === null || field.value === false || field.value === "") return [];
        return [
          {
            fieldName,
            label: OCR_PREFILL_FIELD_LABELS[fieldName as keyof typeof OCR_PREFILL_FIELD_LABELS],
            confidencePercent: Math.round(Math.max(0, Math.min(1, field.confidence)) * 100),
            reviewRequired: field.reviewRequired,
            value: String(field.value),
          },
        ];
      })
    : [];

  useEffect(() => {
    if (workArea !== "finish" || !selectedFinishItem) return;
    setSlabUploads({
      front: selectedFinishItem.slabPhotos.frontUploaded
        ? {
            status: "uploaded",
            publicUrl: selectedFinishItem.slabPhotos.frontUrl ?? undefined,
            message: "Persisted front slab photo is attached.",
          }
        : undefined,
      back: selectedFinishItem.slabPhotos.backUploaded
        ? {
            status: "uploaded",
            publicUrl: selectedFinishItem.slabPhotos.backUrl ?? undefined,
            message: "Persisted back slab photo is attached.",
          }
        : undefined,
    });
    setCompsState({
      status: selectedFinishItem.valuation.complete ? "saved" : "idle",
      saved: selectedFinishItem.valuation.complete,
      valuationMinor: selectedFinishItem.valuation.valuationMinor,
      message: selectedFinishItem.valuation.complete ? "Persisted eBay valuation is complete." : "Comps have not been saved for this card.",
    });
    setInventoryState({
      status: selectedFinishItem.inventory.complete ? "completed" : "idle",
      message: selectedFinishItem.inventory.complete
        ? "Inventory-ready transition is complete."
        : selectedFinishItem.inventory.canAddToInventory
          ? "Ready to add to inventory."
          : "Finish slab photos and eBay valuation before inventory.",
    });
  }, [selectedFinishItem, workArea]);

  const localReportImages = useMemo(
    () => (localReport.bundle ? reportImageAssets(localReport.bundle, { allowEmbeddedBodies: true }) : []),
    [localReport.bundle]
  );
  const localFrontTrueView =
    findReportImage(localReportImages, ["front", "all-on", "portrait"]) ??
    findReportImage(localReportImages, ["front", "accepted"]) ??
    findReportImage(localReportImages, ["front"]);
  const localBackTrueView =
    findReportImage(localReportImages, ["back", "all-on", "portrait"]) ??
    findReportImage(localReportImages, ["back", "accepted"]) ??
    findReportImage(localReportImages, ["back"]);
  const localReportGallery = [
    localFrontTrueView,
    localBackTrueView,
    ...localReportImages.filter((asset) => asset.renderUrl !== localFrontTrueView?.renderUrl && asset.renderUrl !== localBackTrueView?.renderUrl),
  ].filter((asset): asset is NonNullable<typeof localReportImages[number]> => Boolean(asset));
  const localReportCounts = {
    front: localReportImages.filter((asset) => `${asset.id ?? ""} ${asset.fileName ?? ""}`.toLowerCase().includes("front")).length,
    back: localReportImages.filter((asset) => `${asset.id ?? ""} ${asset.fileName ?? ""}`.toLowerCase().includes("back")).length,
    roi: localReportImages.filter((asset) => `${asset.id ?? ""} ${asset.fileName ?? ""}`.toLowerCase().includes("roi")).length,
    channel: localReportImages.filter((asset) => `${asset.id ?? ""} ${asset.fileName ?? ""}`.toLowerCase().includes("channel")).length,
    vision: localReportImages.filter((asset) => {
      const haystack = `${asset.id ?? ""} ${asset.fileName ?? ""}`.toLowerCase();
      return haystack.includes("surface") || haystack.includes("heatmap") || haystack.includes("confidence") || haystack.includes("normal");
    }).length,
  };
  const localMathematicalBundle = parseAiGraderMathematicalReportV1(localReport.bundle);
  const localExternalRelease = status.productionRelease?.reportId === localReport.bundle?.reportId
    ? status.productionRelease
    : undefined;
  const localReportRelease = localMathematicalBundle
    ? localExternalRelease
    : (localReport.bundle?.productionRelease as AiGraderStationProductionRelease | undefined);
  const localReportReadiness = buildAiGraderPublishReadiness({
    bundle: localReport.bundle,
    productionRelease: localReportRelease,
  });
  const localMathematicalFinalGrade = localMathematicalBundle?.productionRelease.finalGrade;
  const localLegacyFinalGrade = localMathematicalBundle
    ? undefined
    : localReportRelease?.finalGrade as AiGraderProductionRelease["finalGrade"] | undefined;
  const localReportFinalGrade = localMathematicalFinalGrade ?? localLegacyFinalGrade;
  const localReportStory = localMathematicalBundle
    ? undefined
    : (localReport.bundle as AiGraderLegacyReportBundle | undefined)?.provisionalGrade;
  const localReportGateRows = localReportRelease?.gates.length
    ? localReportRelease.gates.map((gate) => ({
        key: gate.id,
        status: gate.status,
        label: gate.label ?? gate.id,
        reason: gate.reason,
        evidenceRefs: gate.evidenceRefs,
      }))
    : (localReportStory?.gates?.results ?? []).map((gate, index) => ({
        key: gate.gate ?? `gate-${index}`,
        status: gate.status ?? "unknown",
        label: gate.gate ?? `Gate ${index + 1}`,
        reason: gate.summary ?? "No gate summary recorded.",
        evidenceRefs: gate.evidenceRefs ?? [],
      }));
  const showFlipScrim = status.currentStep === "prompt_flip_card";
  const reportOverlayFrameSize = previewImageSize ?? REPORT_OVERLAY_DEFAULT_FRAME_SIZE;
  const reportOverlayTemplate = reportOverlayTemplateRect(reportOverlayFrameSize.width, reportOverlayFrameSize.height);
  const reportOverlayRois = reportOverlayRoiRects(reportOverlayTemplate);
  const reportOverlayContainedFrame = containedImageFrame(cameraFrameSize, reportOverlayFrameSize);
  const reportOverlayStageStyle = reportOverlayContainedFrame
    ? {
        left: `${reportOverlayContainedFrame.left}px`,
        top: `${reportOverlayContainedFrame.top}px`,
        width: `${reportOverlayContainedFrame.width}px`,
        height: `${reportOverlayContainedFrame.height}px`,
      }
    : undefined;
  const displayedPreviewSnapshot = aiGraderPreviewDisplayedSnapshot(previewEpochState);
  const previewFrameUrl = displayedPreviewSnapshot?.objectUrl ?? null;
  const previewFrameBinding = displayedPreviewSnapshot?.frame;
  const previewGeometrySide = previewEpochState.binding?.side ??
    (status.currentStep === "prompt_flip_card" || status.currentStep === "capture_back" ? "back" : "front");
  const activePreviewCardGeometry =
    displayedPreviewSnapshot?.frame.side === previewGeometrySide
      ? displayedPreviewSnapshot.geometry
      : undefined;
  const cardPlacementState = activePreviewCardGeometry?.placementState ?? "not_detected";
  const cardPlacementLabel = aiGraderCardPlacementLabel(cardPlacementState);
  const activeGeometryTimestampMs = Date.parse(activePreviewCardGeometry?.timestamp ?? "");
  const activeGeometryAgeMs = previewFreshnessNow - activeGeometryTimestampMs;
  const previewFrameFresh =
    previewStatus.status === "live" &&
    Boolean(displayedPreviewSnapshot) &&
    previewFreshnessNow - (displayedPreviewSnapshot?.receivedAtMs ?? 0) >= 0 &&
    previewFreshnessNow - (displayedPreviewSnapshot?.receivedAtMs ?? 0) <= PREVIEW_GEOMETRY_MAX_AGE_MS;
  const detectedGeometryFresh =
    Number.isFinite(activeGeometryTimestampMs) &&
    activeGeometryAgeMs >= -250 &&
    activeGeometryAgeMs <= PREVIEW_GEOMETRY_MAX_AGE_MS;
  const backPositioningPhysicallyVerified =
    previewStatus.positioningLightReady === true &&
    lightingPositioningCompletelyAcknowledged(liveLighting);
  const detectedPreviewCaptureReady = previewGeometrySide === "back"
    ? aiGraderPreviewBackCaptureReady({
        state: previewEpochState,
        mode: "detected_geometry",
        positioningVerifiedAt: liveLighting.physicalState.verifiedAt,
        nowMs: previewFreshnessNow,
      })
    : aiGraderPreviewDetectedCaptureReady(previewEpochState, previewFreshnessNow);
  const detectedGeometryReady =
    cardPlacementState === "ready" &&
    activePreviewCardGeometry?.geometrySource === "detected" &&
    activePreviewCardGeometry.detectionUsed === true &&
    previewFrameFresh &&
    detectedGeometryFresh &&
    detectedPreviewCaptureReady &&
    (previewGeometrySide !== "back" || backPositioningPhysicallyVerified);
  const cardGeometryCorners = activePreviewCardGeometry?.corners ?? activePreviewCardGeometry?.detectedCorners ?? null;
  const cardGeometryFrameSize = activePreviewCardGeometry?.image ?? reportOverlayFrameSize;
  const cardGeometryPolygonPoints = cardGeometryCorners
    ? [
        cardGeometryCorners.topLeft,
        cardGeometryCorners.topRight,
        cardGeometryCorners.bottomRight,
        cardGeometryCorners.bottomLeft,
      ]
    : [];
  const detectedGeometryVisible =
    cardGeometryPolygonPoints.length === 4 &&
    activePreviewCardGeometry?.geometrySource === "detected" &&
    activePreviewCardGeometry.detectionUsed === true;
  const detectedGeometryDominant = detectedGeometryVisible;
  const cardGeometryCueLength = Math.max(14, Math.min(cardGeometryFrameSize.width, cardGeometryFrameSize.height) * 0.026);
  const cardGeometryCornerBrackets = cardGeometryPolygonPoints.map((corner, index, points) => ({
    corner,
    towardPrevious: pointToward(corner, points[(index + points.length - 1) % points.length], cardGeometryCueLength),
    towardNext: pointToward(corner, points[(index + 1) % points.length], cardGeometryCueLength),
  }));
  const cardGeometryEdgeMidpoints = cardGeometryPolygonPoints.map((point, index, points) =>
    midpoint(point, points[(index + 1) % points.length])
  );
  const cardGeometryCenter = cardGeometryPolygonPoints.length === 4
    ? {
        x: cardGeometryPolygonPoints.reduce((sum, point) => sum + point.x, 0) / 4,
        y: cardGeometryPolygonPoints.reduce((sum, point) => sum + point.y, 0) / 4,
      }
    : null;
  const cardGeometryCenterAxes = cardGeometryCenter && cardGeometryEdgeMidpoints.length === 4
    ? [
        centeredAxisLine(cardGeometryCenter, cardGeometryEdgeMidpoints[3], cardGeometryEdgeMidpoints[1], cardGeometryCueLength * 0.72),
        centeredAxisLine(cardGeometryCenter, cardGeometryEdgeMidpoints[0], cardGeometryEdgeMidpoints[2], cardGeometryCueLength * 0.72),
      ].filter((axis): axis is NonNullable<typeof axis> => Boolean(axis))
    : [];
  const canStartGrading =
    bridgeConnected &&
    busy === null &&
    status.currentStep === "capture_front" &&
    status.frontCaptureReadiness.ready &&
    previewGeometrySide === "front" &&
    detectedGeometryReady &&
    lightingPositioningCompletelyAcknowledged(liveLighting);
  const cardAdjustmentGuidance =
    activePreviewCardGeometry?.adjustmentReason === "outside_frame"
      ? "Move the card until all four corners have clear space from the frame edge."
      : activePreviewCardGeometry?.adjustmentReason === "unsafe_scale"
        ? "Use the fixed plate position; the detected card size is outside the grading-safe camera range."
        : activePreviewCardGeometry?.adjustmentReason === "rotate_top_up"
          ? "Rotate the printed top toward the top of the preview."
          : activePreviewCardGeometry?.adjustmentReason === "wrong_aspect"
            ? "Flatten the card and make sure the outline follows the physical outer edges."
            : activePreviewCardGeometry?.adjustmentReason === "low_confidence"
              ? "Hold steady and use the base-plate color with the strongest contrast around the card border."
              : "Keep all four corners inside the frame, keep the printed top roughly toward the top, and hold steady.";
  const cardPlacementGuidance = detectedGeometryReady
    ? `Edges locked. Off-center placement and ordinary rotation will be corrected. ${previewGeometrySide === "back" ? "Capture Back" : "Start Grading"} is enabled.`
    : cardPlacementState === "adjust_card" && detectedGeometryVisible
      ? `Edges found. ${cardAdjustmentGuidance}`
      : "Place the card on the solid base plate with all four edges visible and the printed top roughly toward the top.";
  const frontStartGuidance = status.captureFailure
    ? "Capture stopped. Select Start New Card to retry."
    : !status.frontCaptureReadiness.ready &&
        (status.frontCaptureReadiness.code === "mathematical_authority_required" ||
          status.frontCaptureReadiness.code === "design_reference_staging_required")
      ? status.frontCaptureReadiness.message
    : status.sessionManifest.frontCaptured
      ? "Front captured. Follow the back-card prompt in the camera view."
      : !canStartGrading
          ? "Wait for a fresh detected front frame and exact controller acknowledgement."
          : previewGeometrySide !== "front"
            ? "Finish the current back capture before starting another front."
            : cardPlacementGuidance;
  const captureTimingSummary = status.captureTiming.summary;
  const captureTimingPhaseTotal = (phaseId: (typeof status.captureTiming.phases)[number]["id"]) => {
    const matching = status.captureTiming.phases.filter((phase) => phase.id === phaseId);
    return matching.length ? matching.reduce((sum, phase) => sum + phase.durationMs, 0) : undefined;
  };

  const canUseBridge = bridgeConnected || contractPreviewEnabled;
  const rapidQueueItems = status.rapidCaptureQueue.items.slice(0, 6);
  const rapidQueueHasProcessing = status.rapidCaptureQueue.items.some((item) => RAPID_PROCESSING_STATES.has(item.state));
  const stationSettingsLocked =
    status.sessionManifest.frontCaptured ||
    status.sessionManifest.backCaptured ||
    Boolean(status.rapidCaptureQueue.activeQueueItemId) ||
    Boolean(status.gradingContract &&
      status.currentStep !== "start_new_card" &&
      status.currentStep !== "session_complete");
  const mathematicalCalibrationReady = status.mathematicalCalibration?.ready === true;
  const mathematicalCalibrationBlocked =
    selectedGradingContract === "mathematical_calibration_v1" &&
    !mathematicalCalibrationReady;
  const mathematicalAuthorityDraftComplete = [
    mathematicalAuthorityDraft.title,
    mathematicalAuthorityDraft.tenantId,
    mathematicalAuthorityDraft.setId,
    mathematicalAuthorityDraft.programId,
    mathematicalAuthorityDraft.cardNumber,
  ].every((value) => value.trim().length > 0);
  const mathematicalStartBlocked =
    mathematicalCalibrationBlocked ||
    (selectedGradingContract === "mathematical_calibration_v1" &&
      !mathematicalAuthorityDraftComplete);
  const mathematicalAuthorityActionRequired =
    status.gradingContract === "mathematical_calibration_v1" &&
    status.currentStep === "capture_front" &&
    !status.sessionManifest.frontCaptured &&
    (
      status.frontCaptureReadiness.code === "mathematical_authority_required" ||
      status.frontCaptureReadiness.code === "design_reference_staging_required"
    );
  const mathematicalReviewAllDispositioned = Boolean(
    mathematicalReviewRequest &&
    mathematicalReviewRequest.findings.every((finding) =>
      mathematicalReviewDispositions[finding.findingId] === "confirmed" ||
      mathematicalReviewDispositions[finding.findingId] === "adjusted"),
  );
  const mathematicalReviewAssetView = (
    side: "front" | "back",
    metadata: AiGraderMathematicalReviewAssetMetadataV1,
  ) => mathematicalReviewAssets.assets[
    aiGraderMathematicalReviewAssetKey({ side, metadata })
  ];
  const warmRunner = status.warmRunnerStatus;
  const warmRunnerCapturing = warmRunner.status === "capturing" || warmRunner.captureLock.held || busy === "start-grading" || busy === "capture-back";
  const liveLightingAvailable =
    bridgeConnected &&
    !liveLightingRequestPending &&
    liveLighting.controlsEnabled &&
    previewStatus.status === "live" &&
    !warmRunner.captureLock.held &&
    warmRunner.status !== "capturing";
  const liveLightingCommandable =
    bridgeConnected &&
    !liveLightingRequestPending &&
    liveLighting.controlsEnabled &&
    !warmRunner.captureLock.held &&
    warmRunner.status !== "capturing";
  const liveLightingSafeOffVerified = lightingSafeOffCompletelyAcknowledged(liveLighting);
  const liveLightingPositioningVerified =
    lightingPositioningCompletelyAcknowledged(liveLighting);
  const liveLightingAppliedLabel = liveLightingPositioningVerified
    ? `${liveLighting.applied.dutyPercent}% / PWM ${String(liveLighting.applied.actualLeimacPwmStep).padStart(4, "0")} / Ch ${liveLighting.applied.channels.join(", ")}`
    : liveLightingSafeOffVerified
      ? "off (verified)"
      : "physical state unknown";
  const liveLightingSafeOffLabel = liveLightingSafeOffVerified
    ? "Off (verified)"
    : liveLightingPositioningVerified
      ? "Armed (verified)"
      : liveLighting.physicalState.state === "safe_off_pending"
        ? "Verification pending"
        : "Physical state unknown";
  const warmEvidenceCounts = {
    front: warmRunner.evidencePlan.rolesBySide.front.filter((role) => role.status === "completed").length,
    back: warmRunner.evidencePlan.rolesBySide.back.filter((role) => role.status === "completed").length,
    total: warmRunner.evidencePlan.rolesBySide.front.length,
  };
  const latestWarmPhases = [...warmRunner.phases].slice(-4).reverse();

  useEffect(() => {
    if (!bridgeConnected || !stationToken.trim() || stationCaptureMode !== "rapid" || !rapidQueueHasProcessing) return;
    let cancelled = false;
    let pending = false;
    const refreshRapidQueue = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await callAiGraderStationBridge({ baseUrl: bridgeUrl, stationToken, action: "status" });
        if (!cancelled) setStatus(next);
      } catch {
        // Queue polling is advisory. The explicit capture controls remain authoritative.
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void refreshRapidQueue(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bridgeConnected, bridgeUrl, rapidQueueHasProcessing, stationCaptureMode, stationToken]);

  const verifyProductionSession = async (token: string): Promise<ProductionAuthActor> => {
    const response = await fetch("/api/admin/ai-grader/production/auth-check", {
      method: "GET",
      headers: buildAdminHeaders(token),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `AI Grader production sign-in check failed with HTTP ${response.status}.`;
      throw Object.assign(new Error(message), { statusCode: response.status });
    }
    const result = payload.result ?? {};
    return {
      actorType: typeof result.actorType === "string" ? result.actorType : "human_operator",
      role: typeof result.role === "string" ? result.role : "ai_grader_operator",
      displayName:
        typeof result.displayName === "string" && result.displayName.trim()
          ? result.displayName.trim()
          : "Ten Kings operator",
    };
  };

  const authStatusCode = (error: unknown) =>
    typeof (error as { statusCode?: unknown })?.statusCode === "number" ? (error as { statusCode: number }).statusCode : null;

  const authFailureMessage = (error: unknown, actionLabel: string) => {
    const rawMessage =
      error instanceof Error && error.message !== "Authentication cancelled"
        ? error.message
        : `Sign in is required to ${actionLabel}.`;
    if (rawMessage === "AI Grader operator role required") {
      return "You are signed in, but not authorized for AI Grader. Use an AI Grader operator/admin account.";
    }
    return rawMessage;
  };

  const setProductionAuthFailure = (error: unknown, actionLabel: string): never => {
    const message = authFailureMessage(error, actionLabel);
    setProductionAuthActor(null);
    setProductionAuthState({
      status: "failed",
      message,
    });
    throw new Error(message);
  };

  const requireProductionSession = async (actionLabel: string): Promise<SessionPayload> => {
    setProductionAuthState({
      status: "pending",
      message: `Verifying Ten Kings production access to ${actionLabel}.`,
    });
    try {
      const activeSession = await ensureSession();
      let actor: ProductionAuthActor;
      try {
        actor = await verifyProductionSession(activeSession.token);
      } catch (authError) {
        const statusCode = authStatusCode(authError);
        if (statusCode !== 401) {
          setProductionAuthFailure(authError, actionLabel);
        }
        setProductionAuthActor(null);
        setProductionAuthState({
          status: "pending",
          message: "Your saved Ten Kings sign-in expired. Sign in again to continue.",
        });
        const freshSession = await ensureSession({
          force: true,
          message: "Your saved sign-in expired. Enter your mobile number to continue.",
        });
        actor = await verifyProductionSession(freshSession.token);
        setProductionAuthActor(actor);
        setProductionAuthState({
          status: "completed",
          message: `Production sign-in verified as ${actor.displayName} (${actor.role}).`,
        });
        return freshSession;
      }
      setProductionAuthActor(actor);
      setProductionAuthState({
        status: "completed",
        message: `Production sign-in verified as ${actor.displayName} (${actor.role}).`,
      });
      return activeSession;
    } catch (requestError) {
      if (authStatusCode(requestError) === 401) {
        logout();
      }
      return setProductionAuthFailure(requestError, actionLabel);
    }
  };

  const productionAuthHeaders = async (extra: Record<string, string> = {}, actionLabel = "continue the AI Grader production workflow") => {
    const activeSession = await requireProductionSession(actionLabel);
    return buildAdminHeaders(activeSession.token, extra);
  };

  useEffect(() => {
    if (!ocrPrefillReportId || !reportReady || linkedCardReady) return;
    if (!bridgeConnected || !stationToken.trim()) {
      setOcrPrefillState({
        status: "waiting",
        reportId: ocrPrefillReportId,
        message: "Connect the local station to load normalized images for OCR.",
      });
      return;
    }
    if (sessionLoading) return;
    if (!session?.token) {
      setOcrPrefillState({
        status: "waiting",
        reportId: ocrPrefillReportId,
        message: "Sign in to prefill the Approve & Publish identity from OCR.",
      });
      return;
    }
    if (ocrAttemptedReportIdsRef.current.has(ocrPrefillReportId)) return;
    ocrAttemptedReportIdsRef.current.add(ocrPrefillReportId);
    const generation = ocrPrefillGenerationRef.current;
    let cancelled = false;
    setOcrPrefillState({
      status: "running",
      reportId: ocrPrefillReportId,
      message: "Reading normalized front and back images.",
    });
    void runAiGraderOcrPrefillFromLocalReport({
      baseUrl: bridgeUrl,
      stationToken,
      reportId: ocrPrefillReportId,
      authHeaders: buildAdminHeaders(session.token),
    })
      .then((result) => {
        if (cancelled || generation !== ocrPrefillGenerationRef.current) return;
        setIdentityDraft((current) =>
          mergeAiGraderOcrPrefillIntoIdentityDraft({
            current,
            result,
            operatorEditedFields: identityEditedFieldsRef.current,
          }).draft
        );
        setStatus((current) =>
          current.reportBundle?.reportId === result.reportId
            ? {
                ...current,
                reportBundle: {
                  ...current.reportBundle,
                  ocrPrefill: aiGraderOcrPrefillReportMetadata(result),
                },
              }
            : current
        );
        setOcrPrefillState({
          status: "ready",
          reportId: ocrPrefillReportId,
          result,
          message: `OCR ready. Review ${result.reviewFieldNames.length} field${result.reviewFieldNames.length === 1 ? "" : "s"} before Approve & Publish.`,
        });
      })
      .catch((requestError) => {
        if (cancelled || generation !== ocrPrefillGenerationRef.current) return;
        const typedFailure = requestError instanceof AiGraderOcrPrefillStageError
          ? requestError
          : null;
        setOcrPrefillState({
          status: "failed",
          reportId: ocrPrefillReportId,
          message: requestError instanceof Error ? requestError.message : "OCR prefill did not complete.",
          ...(typedFailure?.failureCode ? { failureCode: typedFailure.failureCode } : {}),
          ...(typedFailure?.failureCategory ? { failureCategory: typedFailure.failureCategory } : {}),
          ...(typedFailure?.failureLabel ? { failureLabel: typedFailure.failureLabel } : {}),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    bridgeConnected,
    bridgeUrl,
    linkedCardReady,
    ocrPrefillReportId,
    ocrPrefillRetryNonce,
    reportReady,
    session?.token,
    sessionLoading,
    stationToken,
  ]);

  const retryOcrPrefill = () => {
    if (!ocrPrefillReportId) return;
    ocrAttemptedReportIdsRef.current.delete(ocrPrefillReportId);
    setOcrPrefillRetryNonce((current) => current + 1);
  };

  const signInForProduction = async () => {
    setError(null);
    try {
      await requireProductionSession("continue the AI Grader production workflow");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ten Kings sign-in failed.");
    }
  };

  const refreshHistory = async () => {
    if (!bridgeConnected) {
      setHistory(buildSampleAiGraderReportHistory());
      return;
    }
    const nextHistory = await fetchAiGraderStationReportHistory({ baseUrl: bridgeUrl, stationToken });
    setHistory(nextHistory);
  };

  const refreshFinishQueue = async (preferredReportId?: string | null) => {
    setFinishQueueState({ status: "pending", message: "Loading Finish Cards queue." });
    try {
      const response = await fetch("/api/admin/ai-grader/production/finish-queue", {
        method: "GET",
        headers: await productionAuthHeaders({}, "load the Finish Cards queue"),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Finish Cards queue failed to load.");
      }
      const result = (payload.result ?? emptyFinishQueue) as FinishQueueResult;
      setFinishQueue(result);
      const nextSelected =
        (preferredReportId && result.items.find((item) => item.reportId === preferredReportId)?.reportId) ||
        (selectedFinishReportId && result.items.find((item) => item.reportId === selectedFinishReportId)?.reportId) ||
        result.items[0]?.reportId ||
        null;
      setSelectedFinishReportId(nextSelected);
      setFinishQueueState({
        status: "completed",
        message: result.items.length ? `${result.items.length} card(s) in Finish Cards queue.` : "No cards are waiting in Finish Cards.",
      });
      return result;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Finish Cards queue failed to load.";
      setFinishQueueState({ status: "failed", message });
      throw requestError;
    }
  };

  const openFinishCards = async (preferredReportId?: string | null) => {
    setError(null);
    setWorkArea("finish");
    try {
      await refreshFinishQueue(preferredReportId ?? selectedFinishReportId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Finish Cards queue failed to load.");
    }
  };

  const connectBridge = async () => {
    setBusy("connect");
    setError(null);
    try {
      await connectBridgeWithCredentials(bridgeUrl, stationToken);
    } catch (requestError) {
      setBridgeConnected(false);
      setBridgeConnectionState("error");
      setError(requestError instanceof Error ? requestError.message : "AI Grader station bridge connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const pairBridge = async (pairingCode = manualPairingCode) => {
    setBusy("pair");
    setError(null);
    try {
      const paired = await pairAiGraderStationBridge({ baseUrl: bridgeUrl, pairingCode });
      await connectBridgeWithCredentials(paired.bridgeUrl || bridgeUrl, paired.stationToken);
      setManualPairingCode("");
    } catch (requestError) {
      setBridgeConnected(false);
      setBridgeConnectionState("pairing_required");
      setError(requestError instanceof Error ? requestError.message : "AI Grader station bridge pairing failed.");
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (action: AiGraderStationAction, body?: Record<string, unknown>) => {
    const next = bridgeConnected
      ? await callAiGraderStationBridge({ baseUrl: bridgeUrl, stationToken, action, body })
      : contractPreviewEnabled
        ? await callStationContract(action)
        : (() => {
            throw new Error("Connect the Dell local station bridge before running station actions.");
          })();
    setStatus(next);
    reconcileBridgePreviewStatus(next.previewStatus);
    setLiveLighting(next.liveLighting);
    setLiveLightingDraft(aiGraderAuthoritativeLiveLightingDraft(next.liveLighting));
    setProfileDraft({
      dutyPercent: next.acceptedProfile.dutyPercent,
      exposureUs: next.acceptedProfile.exposureUs,
      gain: next.acceptedProfile.gain,
    });
    return next;
  };

  const assertLocalFreshPreviewCaptureEligibility = (
    side: AiGraderPreviewGeometrySide,
  ) => {
    const epochState = previewEpochStateRef.current;
    const binding = epochState.binding;
    const displayed = aiGraderPreviewDisplayedSnapshot(epochState);
    const nowMs = Date.now();
    const localCaptureReady = side === "back"
      ? aiGraderPreviewBackCaptureReady({
          state: epochState,
          mode: "detected_geometry",
          positioningVerifiedAt: liveLighting.physicalState.verifiedAt,
          nowMs,
        })
      : aiGraderPreviewDetectedCaptureReady(epochState, nowMs);
    if (
      !binding ||
      binding.side !== side ||
      epochState.phase !== "live" ||
      !displayed ||
      !localCaptureReady
    ) {
      throw new Error(`AI Grader ${side} capture requires the current fresh displayed ${side} frame and matching Ready geometry.`);
    }
    return displayed;
  };

  const ensureLiveLightingSession = async () => {
    if (status.currentStep === "start_new_card" || status.currentStep === "session_complete") {
      if (selectedGradingContract === "mathematical_calibration_v1") {
        throw new Error("Start New Card must bind exact Mathematical V1 identity and centering authority before live lighting.");
      }
      return runAction("start-session", buildAiGraderCaptureProfileRequest("full_forensic", selectedGradingContract));
    }
    return status;
  };

  const applyLiveLightingDraft = async (
    draft = liveLightingDraft,
    reason = "browser live lighting apply"
  ) => {
    if (!bridgeConnected || !stationToken.trim()) throw new Error("Connect the Dell local station bridge before live lighting tuning.");
    if (liveLightingRequestPendingRef.current) {
      throw new Error('A live lighting controller request is already pending.');
    }
    liveLightingRequestPendingRef.current = true;
    setLiveLightingRequestPending(true);
    try {
      await ensureLiveLightingSession();
      const next = await applyAiGraderLiveLighting({
        baseUrl: bridgeUrl,
        stationToken,
        enabled: draft.enabled,
        dutyPercent: Number(draft.dutyPercent),
        channels: draft.channels,
        reason,
      });
      if (!lightingPositioningCompletelyAcknowledged(next)) {
        throw new Error('The lighting controller did not completely acknowledge the requested physical state.');
      }
      const refreshed = await runAction('status');
      if (!lightingPositioningCompletelyAcknowledged(refreshed.liveLighting)) {
        throw new Error('Bridge status did not confirm the requested physical lighting state.');
      }
      return refreshed.liveLighting;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Live lighting apply failed.";
      await runAction("status").catch(() => undefined);
      setError(message);
      throw requestError;
    } finally {
      liveLightingRequestPendingRef.current = false;
      setLiveLightingRequestPending(false);
    }
  };

  const scheduleLiveLightingApply = (draft = liveLightingDraft, reason = "browser live lighting adjustment") => {
    if (liveLightingApplyTimerRef.current) clearTimeout(liveLightingApplyTimerRef.current);
    liveLightingApplyTimerRef.current = setTimeout(() => {
      liveLightingApplyTimerRef.current = null;
      void applyLiveLightingDraft(draft, reason).catch(() => {});
    }, 120);
  };

  const updateLiveLightingDraft = (nextDraft: typeof liveLightingDraft, reason: string) => {
    setLiveLightingDraft(nextDraft);
    if (liveLightingCommandable) scheduleLiveLightingApply(nextDraft, reason);
  };

  const setLiveLightingEnabled = (enabled: boolean) => {
    updateLiveLightingDraft({ ...liveLightingDraft, enabled }, `browser live lighting ${enabled ? "enabled" : "disabled"}`);
  };

  const setAllLiveLightingChannels = (channels: number[]) => {
    updateLiveLightingDraft(
      { ...liveLightingDraft, enabled: channels.length > 0, channels },
      "browser live lighting channels changed",
    );
  };

  const toggleLiveLightingChannel = (channel: number) => {
    const selected = new Set(liveLightingDraft.channels);
    if (selected.has(channel)) selected.delete(channel);
    else selected.add(channel);
    setAllLiveLightingChannels(Array.from(selected).sort((a, b) => a - b));
  };

  const setLiveLightingDuty = (dutyPercent: number) => {
    updateLiveLightingDraft({ ...liveLightingDraft, dutyPercent }, "browser live lighting duty changed");
  };

  const prepareMathematicalAuthority = async (): Promise<{
    authority: ReturnType<typeof buildAiGraderMathematicalGradingAuthorityV1>;
    registeredDesignReferences: Partial<Record<"front" | "back", AiGraderPreparedRegisteredDesignReferenceV1>>;
  }> => {
    const identity: AiGraderMathematicalCardIdentityDraftV1 = {
      title: mathematicalAuthorityDraft.title,
      tenantId: mathematicalAuthorityDraft.tenantId,
      setId: mathematicalAuthorityDraft.setId,
      programId: mathematicalAuthorityDraft.programId,
      cardNumber: mathematicalAuthorityDraft.cardNumber,
      variantId: mathematicalAuthorityDraft.variantId.trim() || null,
      parallelId: mathematicalAuthorityDraft.parallelId.trim() || null,
    };
    buildAiGraderMathematicalGradingAuthorityV1({
      identity,
      profiles: { front: "printed_border_v1", back: "printed_border_v1" },
    });
    const registeredSides = (["front", "back"] as const).filter(
      (side) => mathematicalAuthorityDraft.profiles[side] === "registered_design_template_v1",
    );
    const registeredDesignReferences: Partial<
      Record<"front" | "back", AiGraderPreparedRegisteredDesignReferenceV1>
    > = {};
    const authHeaders = registeredSides.length
      ? await productionAuthHeaders({}, "resolve exact approved Mathematical V1 design references")
      : {};
    for (const side of registeredSides) {
      const referenceIdentity: AiGraderExactDesignReferenceIdentity = {
        tenantId: identity.tenantId.trim(),
        setId: identity.setId.trim(),
        programId: identity.programId.trim(),
        cardNumber: identity.cardNumber.trim(),
        variantId: identity.variantId,
        parallelId: identity.parallelId,
        side,
        profile: "registered_design_template_v1",
      };
      const operatorAuthority = await resolveActiveAiGraderDesignReference({
        identity: referenceIdentity,
        headers: authHeaders,
      });
      const artifact = await fetchExactAiGraderDesignReferenceArtifact({
        identity: referenceIdentity,
        authority: operatorAuthority,
        headers: authHeaders,
      });
      registeredDesignReferences[side] = { operatorAuthority, artifact };
    }
    return {
      authority: buildAiGraderMathematicalGradingAuthorityV1({
        identity,
        profiles: mathematicalAuthorityDraft.profiles,
        registeredDesignReferences,
      }),
      registeredDesignReferences,
    };
  };

  const stagePreparedMathematicalDesignReferences = async (
    prepared: Awaited<ReturnType<typeof prepareMathematicalAuthority>>,
    currentStatus: AiGraderLocalStationStatus,
  ) => {
    for (const side of ["front", "back"] as const) {
      const preparedReference = prepared.registeredDesignReferences[side];
      if (!preparedReference) continue;
      const existing = currentStatus.mathematicalV1?.stagedDesignReferences[side];
      if (existing) {
        if (
          existing.sha256 !== preparedReference.artifact.sha256 ||
          existing.referenceId !== preparedReference.artifact.referenceId
        ) {
          throw new Error("The active " + side + " staged design reference differs from the exact approved authority.");
        }
        continue;
      }
      await stageAiGraderMathematicalDesignReference({
        baseUrl: bridgeUrl,
        stationToken,
        sessionId: currentStatus.sessionManifest.gradingSessionId,
        side,
        authority: prepared.authority,
        artifact: preparedReference.artifact,
      });
    }
    return runAction("status");
  };

  const bindMathematicalAuthorityForActiveSession = async () => {
    if (status.gradingContract !== "mathematical_calibration_v1" ||
        status.currentStep !== "capture_front" ||
        status.sessionManifest.frontCaptured ||
        status.sessionManifest.backCaptured) {
      setError("Exact Mathematical V1 authority can bind only to the fresh pre-capture session.");
      return;
    }
    setBusy("mathematical-authority");
    setError(null);
    setMathematicalAuthorityStatus({
      status: "pending",
      message: "Resolving exact identity/reference authority and verifying approved bytes.",
    });
    try {
      const prepared = await prepareMathematicalAuthority();
      let boundStatus = status;
      if (!status.mathematicalV1) {
        boundStatus = await runAction(
          "bind-mathematical-grading-authority",
          buildAiGraderMathematicalAuthorityBindingRequest(prepared.authority),
        );
      } else if (
        JSON.stringify(status.mathematicalV1.gradingAuthority) !== JSON.stringify(prepared.authority)
      ) {
        throw new Error("The active Mathematical V1 authority is immutable and does not match this draft.");
      }
      const stagedStatus = await stagePreparedMathematicalDesignReferences(prepared, boundStatus);
      if (!stagedStatus.frontCaptureReadiness.ready &&
          stagedStatus.frontCaptureReadiness.code === "design_reference_staging_required") {
        throw new Error(stagedStatus.frontCaptureReadiness.message);
      }
      setMathematicalAuthorityDraft(defaultMathematicalAuthorityDraft);
      setMathematicalAuthorityStatus({
        status: "completed",
        message: "Exact Mathematical V1 identity and per-side centering authority are bound; registered bytes are staged and hash verified.",
      });
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : "Exact Mathematical V1 authority could not be bound.";
      setMathematicalAuthorityStatus({ status: "failed", message });
      await runAction("status").catch(() => undefined);
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const resetPerCardUiState = () => {
    ocrPrefillGenerationRef.current += 1;
    identityEditedFieldsRef.current.clear();
    setSelectedCard(null);
    setIdentityDraft(defaultIdentityDraft);
    setOcrPrefillState({
      status: "idle",
      message: "OCR prefill starts after normalized front and back images are ready.",
    });
    setIdentityStatus({ status: "idle", message: "Card identity has not been confirmed." });
    setConfirmedDownstream({
      comps: {
        status: "idle",
        message: "Comps will queue after Approve & Publish.",
      },
    });
    setProductionPublish({ status: "idle", message: "Ten Kings DB/storage publish has not been run." });
    setSlabUploads({});
    setCompsState({ status: "idle", message: "Comps have not been run." });
    setInventoryState({ status: "idle", message: "Card has not been added to inventory." });
  };

  const changeStationCaptureMode = async (nextMode: StationCaptureMode) => {
    if (nextMode === stationCaptureMode) return;
    if (stationSettingsLocked) {
      setError("Queue or finish the active card before changing Rapid Capture mode.");
      return;
    }
    setBusy("capture-settings");
    setError(null);
    try {
      const next = await runAction(
        "configure-rapid-capture",
        buildAiGraderRapidCaptureConfigurationRequest(nextMode === "rapid"),
      );
      setStationCaptureMode(next.rapidCapture.enabled ? "rapid" : "single");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Rapid Capture mode could not be updated.");
    } finally {
      setBusy(null);
    }
  };

  const startNewCard = async () => {
    if (liveLightingRequestPendingRef.current) return;
    setBusy("start");
    setError(null);
    try {
      const prepared = selectedGradingContract === "mathematical_calibration_v1"
        ? await prepareMathematicalAuthority()
        : undefined;
      resetPerCardUiState();
      await runAction(
        "configure-rapid-capture",
        buildAiGraderRapidCaptureConfigurationRequest(stationCaptureMode === "rapid"),
      );
      const started = await runAction(
        "start-session",
        buildAiGraderCaptureProfileRequest(
          "full_forensic",
          selectedGradingContract,
          prepared?.authority,
        ),
      );
      if (prepared) {
        await stagePreparedMathematicalDesignReferences(prepared, started);
        setMathematicalAuthorityDraft(defaultMathematicalAuthorityDraft);
        setMathematicalAuthorityStatus({
          status: "completed",
          message: "Exact Mathematical V1 identity and per-side centering authority are bound before capture.",
        });
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not start an AI Grader card session.";
      if (selectedGradingContract === "mathematical_calibration_v1") {
        setMathematicalAuthorityStatus({ status: "failed", message });
      }
      await runAction("status").catch(() => undefined);
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const runStationCapture = async (side: AiGraderPreviewGeometrySide) => {
    if (liveLightingRequestPendingRef.current) {
      throw new Error("Wait for the pending lighting controller request before capture.");
    }
    if (!canUseBridge) throw new Error("Connect the Dell local station bridge before capture.");
    const captureStatus = await runAction("status");
    if (side === "front" && !captureStatus.frontCaptureReadiness.ready) {
      throw new Error(captureStatus.frontCaptureReadiness.message);
    }
    const displayed = assertLocalFreshPreviewCaptureEligibility(side);
    const assertion = aiGraderCaptureAssertionFromFrame({
      frame: displayed.frame,
      reportId: captureStatus.sessionManifest.reportId,
      geometryCaptureMode: "detected_geometry",
      captureTriggerMode: "operator",
    });
    setBusy(side === "front" ? "start-grading" : "capture-back");
    setError(null);
    try {
      const captured = await runAiGraderCapture({
        baseUrl: bridgeUrl,
        stationToken,
        assertion,
        requestId: `capture-${side}-${crypto.randomUUID()}`,
      });
      setStatus(captured);
      reconcileBridgePreviewStatus(captured.previewStatus);
      setLiveLighting(captured.liveLighting);
      setProfileDraft({
        dutyPercent: captured.acceptedProfile.dutyPercent,
        exposureUs: captured.acceptedProfile.exposureUs,
        gain: captured.acceptedProfile.gain,
      });
      return captured;
    } finally {
      setBusy(null);
    }
  };

  const reconcileBridgePreviewStatus = (nextStatus: AiGraderLocalStationStatus["previewStatus"]) => {
    const binding = aiGraderPreviewStatusBinding(nextStatus);
    if (aiGraderPreviewBindingChanged(previewEpochStateRef.current.binding, binding)) {
      previewAttemptGenerationRef.current += 1;
      previewControllerRef.current?.abort();
      previewControllerRef.current = null;
      clearPreviewDisplay();
      applyPreviewEpochEvent({ type: "bind", binding });
    }
    setPreviewStatus(nextStatus);
  };

  const connectBridgeWithCredentials = async (targetBridgeUrl: string, targetStationToken: string) => {
    await fetchAiGraderStationBridgeHealth({ baseUrl: targetBridgeUrl });
    const next = await callAiGraderStationBridge({
      baseUrl: targetBridgeUrl,
      stationToken: targetStationToken,
      action: "status",
    });
    window.localStorage.setItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY, targetBridgeUrl);
    window.localStorage.setItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY, targetStationToken);
    setBridgeUrl(targetBridgeUrl);
    setStationToken(targetStationToken);
    setStatus(next);
    reconcileBridgePreviewStatus(next.previewStatus);
    setLiveLighting(next.liveLighting);
    setLiveLightingDraft(aiGraderAuthoritativeLiveLightingDraft(next.liveLighting));
    setBridgeConnected(true);
    setBridgeConnectionState("connected");
    setProfileDraft({
      dutyPercent: next.acceptedProfile.dutyPercent,
      exposureUs: next.acceptedProfile.exposureUs,
      gain: next.acceptedProfile.gain,
    });
    setStationCaptureMode(next.rapidCapture.enabled ? "rapid" : "single");
    setSelectedGradingContract(next.gradingContract ?? "legacy_v0");
    setHistory(await fetchAiGraderStationReportHistory({
      baseUrl: targetBridgeUrl,
      stationToken: targetStationToken,
    }));
    return next;
  };


  const startGrading = async () => {
    try {
      await runStationCapture("front");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Capture Front failed.");
    }
  };

  const captureBackAndContinue = async () => {
    try {
      const captured = await runStationCapture("back");
      if (stationCaptureMode === "rapid" && captured.rapidCapture.enabled) {
        await runAction("queue-current-card");
        resetPerCardUiState();
        setMathematicalAuthorityDraft(defaultMathematicalAuthorityDraft);
        setMathematicalAuthorityStatus({
          status: "idle",
          message: "Rapid continuation requires a new exact card identity and per-side centering authority before Capture Front.",
        });
        return;
      }
      const diagnostics = await runAction("run-diagnostics");
      if (diagnostics.gradingContract === "mathematical_calibration_v1") {
        const execution = diagnostics.mathematicalV1?.execution;
        if (execution?.status === "finding_review_required" ||
            execution?.status === "insufficient_evidence") return;
        if (execution?.status !== "completed") {
          throw new Error("Mathematical V1 did not reach a durable completed state; export and release remain blocked.");
        }
      }
      const exported = await runAction("export-report-bundle");
      await prepareLocalProductionRelease(exported);
      await refreshHistory();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Capture Back or report generation failed.";
      await runAction("status").catch(() => undefined);
      setError(message);
    }
  };

  const activateRapidQueueItem = async (queueItemId: string) => {
    setBusy(`rapid-review:${queueItemId}`);
    setError(null);
    try {
      const next = await runAction("activate-queue-item", buildAiGraderRapidQueueActivationRequest(queueItemId));
      resetPerCardUiState();
      setStationCaptureProfile(next.captureProfile);
      setStationCaptureMode(next.rapidCapture.enabled ? "rapid" : "single");
      setSelectedGradingContract(next.gradingContract ?? selectedGradingContract);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Rapid Capture report could not be opened.");
    } finally {
      setBusy(null);
    }
  };

  const submitMathematicalFindingReviews = async () => {
    const request = mathematicalReviewRequest;
    if (!request) {
      setError("No exact Mathematical V1 finding-review request is pending.");
      return;
    }
    if (
      mathematicalReviewAssets.status !== "ready" ||
      mathematicalReviewAssets.requestSha256 !== request.artifactSha256
    ) {
      setError("Every exact review asset must pass byte, role, dimension, and SHA-256 verification before submission.");
      return;
    }
    setBusy("mathematical-review");
    setError(null);
    try {
      const reviewed = await runAction(
        "submit-mathematical-finding-reviews",
        buildAiGraderMathematicalFindingReviewSubmission({
          request,
          dispositions: mathematicalReviewDispositions,
          operatorId: "local-browser-operator",
          warningsAccepted: true,
          overrideReason: "Operator reviewed exact hash-bound Mathematical V1 evidence and explicitly dispositioned every measured finding.",
        }),
      );
      const execution = reviewed.mathematicalV1?.execution;
      if (execution?.status === "finding_review_required" ||
          execution?.status === "insufficient_evidence") return;
      if (execution?.status !== "completed") {
        throw new Error("The reviewed Mathematical V1 rerun did not reach a durable completed state.");
      }
      if (reviewed.rapidCaptureQueue.activeQueueItemId) {
        await refreshHistory();
        return;
      }
      const exported = await runAction("export-report-bundle");
      await prepareLocalProductionRelease(exported);
      await refreshHistory();
    } catch (requestError) {
      const message = requestError instanceof Error
        ? requestError.message
        : "Mathematical V1 finding reviews could not be submitted.";
      await runAction("status").catch(() => undefined);
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const productionReleaseBody = (releaseStatus: AiGraderLocalStationStatus = status) => ({
    operatorId: "local-browser-operator",
    warningsAccepted: true,
    overrideReason: isAiGraderReportBundleV03(releaseStatus.reportBundle)
      ? "Operator reviewed Mathematical Grading V1 formulas, deductions, and explicit evidence-quality warning gates in the browser station."
      : "Operator accepted Production Release V0 warning gates from the browser station.",
  });

  const prepareLocalProductionRelease = async (
    releaseStatus: AiGraderLocalStationStatus = status,
  ) => {
    if (releaseStatus.gradingContract === "mathematical_calibration_v1" &&
        releaseStatus.mathematicalV1?.execution?.status !== "completed") {
      throw new Error("Mathematical V1 export and release require a durable completed execution; no V0 fallback is permitted.");
    }
    let next = await runAction("calculate-final-grade", productionReleaseBody(releaseStatus));
    if (next.productionRelease?.finalGradeComputed === true) {
      next = await runAction("finalize-report", productionReleaseBody(next));
      next = await runAction("generate-label-data", productionReleaseBody(next));
    }
    await refreshHistory();
    return next;
  };

  const buildReportBundleForProduction = (
    baseBundle: AiGraderStationReportBundle | undefined = status.reportBundle,
    cardSelection: CardSelectionState | null = selectedCard,
  ) => {
    if (!baseBundle) return null;
    if (isAiGraderReportBundleV03(baseBundle)) {
      const strictBundle = parseAiGraderMathematicalReportV1(baseBundle);
      if (!strictBundle) {
        throw new Error("Mathematical Grading V1 report validation failed; publishing through a V0 shape is prohibited.");
      }
      return strictBundle;
    }
    const bundleWithOcrPrefill =
      ocrPrefillState.result?.reportId === baseBundle.reportId
        ? {
            ...baseBundle,
            ocrPrefill: aiGraderOcrPrefillReportMetadata(ocrPrefillState.result),
          }
        : baseBundle;
    const cardIdentity = cardSelection
      ? {
          cardAssetId: cardSelection.cardAssetId,
          itemId: cardSelection.itemId,
          title: cardSelection.title ?? cardSelection.displayTitle,
          set: cardSelection.set,
          cardNumber: cardSelection.cardNumber,
          source: cardSelection.source,
        }
      : null;
    if (!cardIdentity) return bundleWithOcrPrefill;
    return {
      ...bundleWithOcrPrefill,
      cardIdentity: {
        ...bundleWithOcrPrefill.cardIdentity,
        ...cardIdentity,
        sideCount: 2 as const,
        futureSlabbedPhotoRefsReserved: true as const,
        futureEbayCompsRefsReserved: true as const,
      },
    };
  };

  const updateIdentityDraft = <K extends keyof IdentityDraftState>(key: K, value: IdentityDraftState[K]) => {
    identityEditedFieldsRef.current.add(key);
    setIdentityDraft((current) => ({ ...current, [key]: value }));
  };

  const identityDraftPayload = () => ({
    category: identityDraft.category,
    playerName: identityDraft.playerName.trim() || null,
    cardName: identityDraft.cardName.trim() || null,
    teamName: identityDraft.teamName.trim() || null,
    year: identityDraft.year.trim() || null,
    manufacturer: identityDraft.manufacturer.trim() || null,
    sport: identityDraft.sport.trim() || null,
    game: identityDraft.game.trim() || null,
    productSet: identityDraft.productSet.trim() || null,
    productLine: identityDraft.productSet.trim() || null,
    insert: identityDraft.insert.trim() || null,
    insertSet: identityDraft.insert.trim() || null,
    parallel: identityDraft.parallel.trim() || null,
    cardNumber: identityDraft.cardNumber.trim() || null,
    numbered: identityDraft.numbered.trim() || null,
    autograph: identityDraft.autograph,
    memorabilia: identityDraft.memorabilia,
  });

  const identityDraftTitle = () =>
    [
      identityDraft.year.trim(),
      identityDraft.manufacturer.trim(),
      identityDraft.productSet.trim(),
      identityDraft.category === "sport" ? identityDraft.playerName.trim() : identityDraft.cardName.trim(),
      identityDraft.cardNumber.trim() ? `#${identityDraft.cardNumber.trim()}` : "",
      identityDraft.parallel.trim(),
    ]
      .filter(Boolean)
      .join(" ") || "AI Grader Card";

  const launchConfirmedCardComps = (input: {
    reportId: string;
    reportBundle: Record<string, unknown>;
    productionRelease: Record<string, unknown>;
    selection: CardSelectionState;
    headers: Record<string, string>;
  }) => {
    setConfirmedDownstream((current) => ({
      ...current,
      reportId: input.reportId,
      comps: {
        status: "running",
        message: "eBay sold comps are running in the background.",
      },
    }));
    void fetch("/api/admin/ai-grader/production/run-comps", {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({
        reportId: input.reportId,
        reportBundle: input.reportBundle,
        productionRelease: input.productionRelease,
        selection: input.selection,
        limit: 10,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok !== true) {
          throw new Error(payload.message ?? "eBay sold comps failed to start.");
        }
        const result = payload.result ?? {};
        const nextStatus: ConfirmedDownstreamState["comps"]["status"] =
          result.status === "ready" ? "ready" : result.status === "failed" ? "failed" : "queued";
        setConfirmedDownstream((current) =>
          current.reportId === input.reportId
            ? {
                ...current,
                comps: {
                  status: nextStatus,
                  message:
                    result.message ??
                    (nextStatus === "ready"
                      ? "eBay sold comps are ready for review on Finish Cards."
                      : nextStatus === "failed"
                        ? "eBay sold comps failed. Retry from Finish Cards."
                        : "eBay sold comps are queued."),
                },
              }
            : current
        );
      })
      .catch((requestError) => {
        setConfirmedDownstream((current) =>
          current.reportId === input.reportId
            ? {
                ...current,
                comps: {
                  status: "failed",
                  message: requestError instanceof Error ? requestError.message : "eBay sold comps failed to start.",
                },
              }
            : current
        );
      });
  };

  const createCardFromConfirmedIdentity = async (options: { manageBusy?: boolean } = {}) => {
    setError(null);
    let authHeaders: Record<string, string>;
    try {
      authHeaders = await productionAuthHeaders({ "content-type": "application/json" }, "create the Ten Kings card/item");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Ten Kings sign-in is required before card creation.";
      setIdentityStatus({ status: "failed", message });
      setError(message);
      throw requestError;
    }
    if (options.manageBusy !== false) setBusy("create-card-from-report");
    setIdentityStatus({ status: "pending", message: "Creating Ten Kings CardAsset and Item from confirmed AI Grader identity." });
    try {
      const resolvedPackage = await resolveAiGraderAuthoritativeProductionPackage({
        initialStatus: status,
        fetchBridgeBundle: bridgeConnected && stationToken.trim()
          ? (reportId) => fetchAiGraderStationReportBundle({ baseUrl: bridgeUrl, stationToken, reportId })
          : undefined,
        explicitlyFinalize: prepareLocalProductionRelease,
      });
      const { reportId, sourceBundle, productionRelease } = resolvedPackage;
      if (!sourceBundle || !productionRelease) {
        throw new Error("A finalized production release and report bundle are required before card creation.");
      }
      productionPackageGradingSessionId(sourceBundle, productionRelease);
      const draftIdentity = identityDraftPayload();
      const draftTitle = identityDraftTitle();
      const productionSourceBundle = buildReportBundleForProduction(sourceBundle) ?? sourceBundle;
      const reportBundleWithIdentity: AiGraderStationReportBundle = isAiGraderReportBundleV03(productionSourceBundle)
        ? productionSourceBundle
        : {
            ...productionSourceBundle,
            cardIdentity: {
              ...productionSourceBundle.cardIdentity,
              title: draftTitle,
              set: identityDraft.productSet.trim() || undefined,
              cardNumber: identityDraft.cardNumber.trim() || undefined,
              source: "confirmed_identity",
              sideCount: 2,
              futureSlabbedPhotoRefsReserved: true,
              futureEbayCompsRefsReserved: true,
            },
          };
      const localAssetManifest = productionAssetManifest(reportBundleWithIdentity);
      if (localAssetManifest.length < 1) {
        throw new Error("Card creation requires storage-ready image asset metadata with SHA-256 checksums and byte sizes.");
      }
      const sanitizedBundle = sanitizeReportBundleForProduction(reportBundleWithIdentity);
      const sanitizedRelease = sanitizeProductionReleaseForConfirm(productionRelease);
      const gradingSessionId = productionPackageGradingSessionId(sanitizedBundle, sanitizedRelease!);
      const response = await fetch("/api/admin/ai-grader/production/create-card-from-report", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          publicationStatus: "finalized",
          reportId: sanitizedRelease?.reportId ?? sanitizedBundle.reportId,
          certId: sanitizedRelease?.label?.certId,
          gradingSessionId,
          reportBundle: sanitizedBundle,
          productionRelease: sanitizedRelease,
          assetManifest: { assets: localAssetManifest },
          checksums: {
            checksums: localAssetManifest.map((asset) => ({
              id: asset.id,
              checksumSha256: asset.checksumSha256,
              byteSize: asset.byteSize,
            })),
          },
          identity: draftIdentity,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Card creation from AI Grader report failed.");
      }
      const result = payload.result ?? {};
      const nextCard = result.cardIdentity as CardSelectionState;
      setSelectedCard(nextCard);
      setCardSearchMessage("Confirmed identity created and linked a Ten Kings CardAsset/Item.");
      setIdentityStatus({
        status: "completed",
        message: `Created CardAsset ${result.cardAssetId} and Item ${result.itemId}.`,
      });
      const downstream = result.downstream ?? {};
      const downstreamComps = downstream.comps ?? {};
      const downstreamCompsStatus: ConfirmedDownstreamState["comps"]["status"] =
        downstreamComps.status === "running" ||
        downstreamComps.status === "ready" ||
        downstreamComps.status === "completed" ||
        downstreamComps.status === "failed"
          ? downstreamComps.status
          : "queued";
      setConfirmedDownstream({
        reportId: result.reportId,
        comps: {
          status: downstreamCompsStatus,
          message:
            downstreamCompsStatus === "completed"
              ? "Selected eBay sold comps and valuation are already complete."
              : downstreamCompsStatus === "ready"
                ? "eBay sold comps are ready for review on Finish Cards."
                : downstreamCompsStatus === "running"
                  ? "eBay sold comps are already running in the background."
                  : downstreamCompsStatus === "failed"
                    ? "eBay sold comps failed previously. Retry from Finish Cards."
                    : "eBay sold comps are queued.",
        },
      });
      setStatus((current) => ({
        ...current,
        productionRelease: result.productionRelease ?? current.productionRelease,
        reportBundle: current.reportBundle
          ? isAiGraderReportBundleV03(current.reportBundle)
            ? current.reportBundle
            : {
              ...current.reportBundle,
              cardIdentity: {
                ...current.reportBundle.cardIdentity,
                ...nextCard,
                source: "card_asset",
                sideCount: 2,
                futureSlabbedPhotoRefsReserved: true,
                futureEbayCompsRefsReserved: true,
              },
            }
          : current.reportBundle,
      }));
      const linkedRelease = (result.productionRelease ?? sanitizedRelease) as Record<string, unknown>;
      const linkedFinalGrade =
        linkedRelease.finalGrade && typeof linkedRelease.finalGrade === "object"
          ? (linkedRelease.finalGrade as Record<string, unknown>)
          : {};
      if (downstreamComps.shouldStart === true) {
        launchConfirmedCardComps({
          reportId: result.reportId,
          reportBundle: {
            reportId: result.reportId,
            gradingSessionId,
            cardIdentity: {
              ...draftIdentity,
              title: result.title ?? draftTitle,
              set: result.set ?? identityDraft.productSet.trim(),
              cardNumber: identityDraft.cardNumber.trim(),
              cardAssetId: result.cardAssetId,
              itemId: result.itemId,
            },
          },
          productionRelease: {
            reportId: result.reportId,
            gradingSessionId: linkedRelease.gradingSessionId,
            finalGradeComputed: linkedRelease.finalGradeComputed === true,
            finalGrade: {
              overall: linkedFinalGrade.overall,
            },
            ...(linkedRelease.label && typeof linkedRelease.label === "object" ? { label: linkedRelease.label } : {}),
          },
          selection: nextCard,
          headers: authHeaders,
        });
      }
      return nextCard;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Card creation failed.";
      setIdentityStatus({
        status: "failed",
        message,
      });
      setError(message);
      throw requestError;
    } finally {
      if (options.manageBusy !== false) setBusy(null);
    }
  };

  const searchCardItems = async () => {
    setBusy("card-search");
    setError(null);
    setCardSearchMessage("Searching Ten Kings card/item records.");
    try {
      const query = cardSearchQuery.trim();
      if (!query) throw new Error("Enter a card, player, set, item, or card asset search first.");
      const response = await fetch(`/api/admin/ai-grader/production/card-search?q=${encodeURIComponent(query)}&limit=8`, {
        headers: await productionAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        setCardSearchResults([]);
        setCardSearchMessage(payload.message ?? "Card/item search is not available. Use manual draft identity.");
        return;
      }
      const items = Array.isArray(payload.result?.items) ? payload.result.items : [];
      setCardSearchResults(items);
      setCardSearchMessage(items.length ? `${items.length} result(s) found.` : "No records found. Use manual draft identity.");
    } catch (requestError) {
      setCardSearchResults([]);
      setCardSearchMessage(requestError instanceof Error ? requestError.message : "Card/item search failed.");
    } finally {
      setBusy(null);
    }
  };

  const verifyPublishedReportRoute = async (reportId: string) => {
    let lastMessage = "Published report verification failed.";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
      let response: Response;
      try {
        response = await fetch(`/api/ai-grader/reports/${encodeURIComponent(reportId)}`, {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
      } catch (error) {
        throw new Error(formatAiGraderPublishStageError({ stage: "public-report-verification", error }));
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true || !payload.bundle) {
        lastMessage = payload.message ?? `Public report verification returned HTTP ${response.status}.`;
        continue;
      }
      if (payload.bundle.reportId !== reportId) {
        lastMessage = `Public report verification returned ${payload.bundle.reportId ?? "unknown report"} instead of ${reportId}.`;
        continue;
      }
      const publicImages = reportImageAssets(payload.bundle).filter((asset) => asset.renderSource === "public_url");
      if (publicImages.length < 1) {
        lastMessage = "Published report has no storage-backed image assets.";
        continue;
      }
      const serialized = JSON.stringify(payload.bundle);
      if (/C:\\\\TenKings|127\.0\.0\.1|localhost|data:image|stationToken|x-ai-grader/i.test(serialized)) {
        lastMessage = "Published report contains local paths, bridge URLs, embedded image bodies, or token markers.";
        continue;
      }
      return { imageCount: publicImages.length };
    }
    throw new Error(formatAiGraderPublishStageError({ stage: "public-report-verification", error: new Error(lastMessage) }));
  };

  const publishToTenKingsSystem = async (
    cardSelection: CardSelectionState | null = selectedCard,
    options: { manageBusy?: boolean } = {},
  ) => {
    if (options.manageBusy !== false) setBusy("ten-kings-publish");
    setError(null);
    setProductionPublish((current) => ({ ...current, status: "pending", message: "Preparing canonical local publish package." }));
    try {
      const resolvedPackage = await resolveAiGraderAuthoritativeProductionPackage({
        initialStatus: status,
        fetchBridgeBundle: bridgeConnected && stationToken.trim()
          ? async (reportId) => {
              setProductionPublish((current) => ({ ...current, status: "pending", message: "Reading local package manifest from the paired Dell bridge." }));
              try {
                return await fetchAiGraderStationReportBundle({ baseUrl: bridgeUrl, stationToken, reportId });
              } catch (error) {
                throw new Error(formatAiGraderPublishStageError({ stage: "local-package-read", error }));
              }
            }
          : undefined,
        explicitlyFinalize: prepareLocalProductionRelease,
      });
      const { latestStatus, reportId, sourceBundle, productionRelease } = resolvedPackage;
      const reportBundleWithIdentity = buildReportBundleForProduction(sourceBundle, cardSelection);
      const readiness = buildAiGraderPublishReadiness({
        bundle: reportBundleWithIdentity,
        productionRelease,
      });
      if (!reportBundleWithIdentity || !productionRelease) {
        throw new Error("A finalized production release and report bundle are required before Ten Kings publish.");
      }
      productionPackageGradingSessionId(reportBundleWithIdentity, productionRelease);
      if (!readiness.ready) {
        throw new Error(readiness.message);
      }
      const localAssetManifest = productionAssetManifest(reportBundleWithIdentity);
      if (localAssetManifest.length < 1) {
        throw new Error("Publish package is missing storage-ready image asset metadata with SHA-256 checksums and byte sizes.");
      }
      const sanitizedBundle = sanitizeReportBundleForProduction(reportBundleWithIdentity);
      const sanitizedRelease = sanitizeProductionReleaseForProduction(productionRelease, sanitizedBundle, cardSelection);
      const gradingSessionId = productionPackageGradingSessionId(sanitizedBundle, sanitizedRelease!);
      setProductionPublish((current) => ({ ...current, status: "pending", message: "Initializing publish and requesting direct storage upload URLs." }));
      let initResponse: Response;
      try {
        initResponse = await fetch("/api/admin/ai-grader/production/publish-init", {
          method: "POST",
          headers: await productionAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            publicationStatus: "published",
            reportId: sanitizedRelease?.reportId ?? sanitizedBundle.reportId,
            certId: sanitizedRelease?.label?.certId,
            gradingSessionId,
            reportBundle: sanitizedBundle,
            productionRelease: sanitizedRelease,
            assetManifest: { assets: localAssetManifest },
            checksums: {
              checksums: localAssetManifest.map((asset) => ({
                id: asset.id,
                checksumSha256: asset.checksumSha256,
                byteSize: asset.byteSize,
              })),
            },
            cardAssetId: cardSelection?.cardAssetId ?? sanitizedBundle.cardIdentity.cardAssetId,
            itemId: cardSelection?.itemId ?? sanitizedBundle.cardIdentity.itemId,
          }),
        });
      } catch (error) {
        throw new Error(formatAiGraderPublishStageError({ stage: "publish-init", error }));
      }
      const initText = await initResponse.text();
      let initPayload: any = {};
      try {
        initPayload = initText ? JSON.parse(initText) : {};
      } catch {
        initPayload = {};
      }
      if (!initResponse.ok || initPayload.ok !== true) {
        const message = initPayload.message ?? (initText.slice(0, 240) || `HTTP ${initResponse.status}`);
        setProductionPublish({
          status: initPayload.code === "AI_GRADER_PRODUCTION_PUBLISH_DISABLED" ? "disabled" : "error",
          message: formatAiGraderPublishStageError({ stage: "publish-init", error: new Error(message) }),
        });
        return;
      }
      const uploadArtifacts = (initPayload.result?.uploadPlan?.artifacts ?? []) as PublishUploadPlanArtifact[];
      if (!uploadArtifacts.length || !initPayload.result?.publishSessionId) {
        throw new Error("Publish init did not return upload artifacts and publishSessionId.");
      }
      const uploadedArtifacts: PublishUploadedArtifact[] = [];
      for (let index = 0; index < uploadArtifacts.length; index += 1) {
        const artifact = uploadArtifacts[index];
        setProductionPublish((current) => ({
          ...current,
          status: "pending",
          message: `Uploading artifact ${index + 1}/${uploadArtifacts.length}: ${artifact.kind}.`,
        }));
        let bytes: ArrayBuffer;
        let contentType = artifact.contentType || "application/octet-stream";
        let verifiedSourceImageDimensions:
          | { sourceImageWidthPx: number; sourceImageHeightPx: number }
          | undefined;
        if (typeof artifact.body === "string") {
          bytes = utf8Bytes(artifact.body);
        } else if (artifact.sourceAssetId) {
          if (!bridgeConnected || !stationToken.trim()) {
            throw new Error(`Local bridge connection is required to upload ${artifact.kind}.`);
          }
          let localAsset: Awaited<ReturnType<typeof fetchAiGraderStationReportAsset>>;
          try {
            localAsset = await fetchAiGraderStationReportAsset({
              baseUrl: bridgeUrl,
              stationToken,
              reportId: reportBundleWithIdentity.reportId,
              assetId: artifact.sourceAssetId,
            });
          } catch (error) {
            throw new Error(
              formatAiGraderPublishStageError({
                stage: "local-asset-read",
                error,
                artifact: { index, total: uploadArtifacts.length, kind: artifact.kind },
              })
            );
          }
          bytes = localAsset.bytes;
          contentType = localAsset.contentType || contentType;
        } else {
          throw new Error(`Publish artifact ${artifact.kind} has no upload body or local asset source.`);
        }
        const checksumSha256 = await sha256Hex(bytes);
        if (checksumSha256.toLowerCase() !== artifact.checksumSha256.toLowerCase()) {
          throw new Error(`Checksum mismatch before upload for ${artifact.kind}.`);
        }
        if (bytes.byteLength !== artifact.byteSize) {
          throw new Error(`Byte size mismatch before upload for ${artifact.kind}.`);
        }
        if (artifact.artifactClass === "report_asset") {
          if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== artifact.contentType.toLowerCase()) {
            throw new Error(`Content type mismatch before upload for ${artifact.kind}.`);
          }
          const hasPlannedDimensions =
            artifact.sourceImageWidthPx !== undefined || artifact.sourceImageHeightPx !== undefined;
          if (
            hasPlannedDimensions &&
            (!Number.isSafeInteger(artifact.sourceImageWidthPx) ||
              (artifact.sourceImageWidthPx ?? 0) < 1 ||
              !Number.isSafeInteger(artifact.sourceImageHeightPx) ||
              (artifact.sourceImageHeightPx ?? 0) < 1)
          ) {
            throw new Error(`Upload plan has incomplete source image dimensions for ${artifact.kind}.`);
          }
          const plannedDimensions = hasPlannedDimensions
            ? {
                widthPx: artifact.sourceImageWidthPx as number,
                heightPx: artifact.sourceImageHeightPx as number,
              }
            : undefined;
          const decodedDimensions = await assertAiGraderBrowserRaster(
            bytes,
            artifact.contentType,
            plannedDimensions,
          );
          if (plannedDimensions) {
            verifiedSourceImageDimensions = {
              sourceImageWidthPx: decodedDimensions.widthPx,
              sourceImageHeightPx: decodedDimensions.heightPx,
            };
          }
          contentType = artifact.contentType;
        }
        try {
          await uploadAiGraderArtifactDirectly({
            purpose: "publish",
            uploadUrl: artifact.uploadUrl,
            uploadMethod: artifact.uploadMethod,
            uploadHeaders: artifact.uploadHeaders,
            contentType,
            checksumSha256,
            body: bytes,
          });
        } catch (error) {
          throw new Error(
            formatAiGraderPublishStageError({
              stage: "direct-storage-upload",
              error,
              artifact: { index, total: uploadArtifacts.length, kind: artifact.kind },
            })
          );
        }
        uploadedArtifacts.push({
          artifactId: artifact.artifactId,
          storageKey: artifact.storageKey,
          publicUrl: artifact.publicUrl,
          checksumSha256,
          byteSize: bytes.byteLength,
          contentType,
          ...verifiedSourceImageDimensions,
          uploadedAt: new Date().toISOString(),
        });
      }
      setProductionPublish((current) => ({ ...current, status: "pending", message: "Finalizing production DB records." }));
      let finalizeResponse: Response;
      try {
        finalizeResponse = await fetch("/api/admin/ai-grader/production/publish-finalize", {
          method: "POST",
          headers: await productionAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            publicationStatus: "published",
            reportId: initPayload.result.reportId,
            gradingSessionId,
            publishSessionId: initPayload.result.publishSessionId,
            reportBundle: sanitizedBundle,
            productionRelease: sanitizedRelease,
            uploadManifest: { artifacts: uploadedArtifacts },
            cardAssetId: cardSelection?.cardAssetId ?? sanitizedBundle.cardIdentity.cardAssetId,
            itemId: cardSelection?.itemId ?? sanitizedBundle.cardIdentity.itemId,
          }),
        });
      } catch (error) {
        throw new Error(formatAiGraderPublishStageError({ stage: "publish-finalize", error }));
      }
      const finalizeText = await finalizeResponse.text();
      let finalizePayload: any = {};
      try {
        finalizePayload = finalizeText ? JSON.parse(finalizeText) : {};
      } catch {
        finalizePayload = {};
      }
      if (!finalizeResponse.ok || finalizePayload.ok !== true) {
        const message = finalizePayload.message ?? (finalizeText.slice(0, 240) || `HTTP ${finalizeResponse.status}`);
        setProductionPublish({
          status: finalizePayload.code === "AI_GRADER_PRODUCTION_PUBLISH_DISABLED" ? "disabled" : "error",
          message: formatAiGraderPublishStageError({ stage: "publish-finalize", error: new Error(message) }),
        });
        return;
      }
      const publishedReportId = finalizePayload.result.reportId;
      const publishedLabelSheet = finalizePayload.result.labelSheetAssignment;
      if (
        !publishedReportId ||
        !finalizePayload.result.publicReportUrl ||
        !finalizePayload.result.labelPreviewUrl ||
        typeof publishedLabelSheet?.sheetNumber !== "number" ||
        typeof publishedLabelSheet?.slot !== "number"
      ) {
        throw new Error("Publish finalize response did not include the report, Label Sheets link, and grading-label assignment.");
      }
      setProductionPublish((current) => ({ ...current, status: "pending", message: "Verifying public report route and storage-backed images." }));
      const publicVerification = await verifyPublishedReportRoute(publishedReportId);
      setProductionPublish({
        status: "published",
        message: `Published and verified. Public report, printable label, QR payload, and ${publicVerification.imageCount} storage-backed image(s) are ready.`,
        reportId: publishedReportId,
        certId: finalizePayload.result.certId ?? productionRelease.label?.certId,
        publicReportUrl: finalizePayload.result.publicReportUrl,
        labelPreviewUrl: finalizePayload.result.labelPreviewUrl,
        qrPayloadUrl: finalizePayload.result.qrPayloadUrl,
        uploadedAssetCount: finalizePayload.result.uploadedAssetCount,
        evidenceAssetCount: finalizePayload.result.evidenceAssetCount,
      });
      setConfirmedDownstream((current) => ({
        ...current,
        reportId: publishedReportId,
        labelSheet: {
          sheetNumber: publishedLabelSheet.sheetNumber,
          slot: publishedLabelSheet.slot,
          capacity: typeof publishedLabelSheet.capacity === "number" ? publishedLabelSheet.capacity : 16,
        },
      }));
      const activeRapidQueueItem = status.rapidCaptureQueue.items.find(
        (item) => item.queueItemId === status.rapidCaptureQueue.activeQueueItemId && item.reportId === publishedReportId,
      );
      if (activeRapidQueueItem && bridgeConnected && stationToken.trim()) {
        await runAction("publish-report", productionReleaseBody());
      }
      await refreshHistory();
      await refreshFinishQueue(publishedReportId).catch(() => undefined);
    } catch (requestError) {
      setProductionPublish({
        status: "error",
        message: requestError instanceof Error ? requestError.message : "Ten Kings publish failed.",
      });
      throw requestError;
    } finally {
      if (options.manageBusy !== false) setBusy(null);
    }
  };

  const approveAndPublish = async () => {
    setBusy("approve-and-publish");
    setError(null);
    try {
      if (!mathematicalReleaseReady) {
        throw new Error("Mathematical V1 must complete exact finding review and deterministic rerun before Approve & Publish.");
      }
      const cardSelection = linkedCardReady
        ? selectedCard
        : await createCardFromConfirmedIdentity({ manageBusy: false });
      if (!cardSelection?.cardAssetId || !cardSelection.itemId) {
        throw new Error("Approve & Publish requires one exact CardAsset and Item linkage.");
      }
      await publishToTenKingsSystem(cardSelection, { manageBusy: false });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Approve & Publish failed.";
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const loadFinishReportBundle = async (reportId: string) => {
    if (finishReportCache[reportId]) return finishReportCache[reportId];
    const response = await fetch(`/api/ai-grader/reports/${encodeURIComponent(reportId)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true || !payload.bundle) {
      throw new Error(payload.message ?? "Published report bundle could not be loaded for finishing.");
    }
    const rawBundle = payload.bundle as unknown;
    const schemaVersion = rawBundle && typeof rawBundle === "object"
      ? (rawBundle as { schemaVersion?: unknown }).schemaVersion
      : undefined;
    const bundle = schemaVersion === "ai-grader-report-bundle-v0.3"
      ? parseAiGraderMathematicalReportV1(rawBundle)
      : schemaVersion === AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION || schemaVersion === AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION
        ? rawBundle as AiGraderLegacyReportBundle
        : null;
    if (!bundle) throw new Error("Stored AI Grader report failed its declared schema contract; V0 fallback is prohibited.");
    setFinishReportCache((current) => ({ ...current, [reportId]: bundle }));
    return bundle;
  };

  const uploadSlabbedPhoto = async (side: "front" | "back", file: File | null, targetReportId?: string | null) => {
    if (!file) return;
    setBusy(`slab-${side}`);
    setError(null);
    setSlabUploads((current) => ({
      ...current,
      [side]: { status: "uploading", message: `Preparing direct storage upload for slabbed ${side} photo.` },
    }));
    try {
      const reportId = targetReportId ?? status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
      if (!reportId) throw new Error("A report ID is required before uploading slabbed photos.");
      const bytes = await file.arrayBuffer();
      const checksumSha256 = await sha256Hex(bytes);
      const slabMimeType = file.type || "image/jpeg";
      const slabDimensions = await assertAiGraderBrowserRaster(bytes, slabMimeType);
      let initResponse: Response;
      try {
        initResponse = await fetch("/api/admin/ai-grader/production/slabbed-photo-init", {
          method: "POST",
          headers: await productionAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({
            reportId,
            side,
            fileName: file.name,
            mimeType: slabMimeType,
            byteSize: bytes.byteLength,
            checksumSha256,
            widthPx: slabDimensions.widthPx,
            heightPx: slabDimensions.heightPx,
          }),
        });
      } catch (error) {
        throw new Error(formatAiGraderPublishStageError({ stage: "slabbed-photo-init", error, side }));
      }
      const initPayload = await initResponse.json().catch(() => ({}));
      if (!initResponse.ok || initPayload.ok !== true) {
        throw new Error(
          formatAiGraderPublishStageError({
            stage: "slabbed-photo-init",
            error: new Error(initPayload.message ?? `HTTP ${initResponse.status}`),
            side,
          })
        );
      }
      const plan = initPayload.result;
      setSlabUploads((current) => ({
        ...current,
        [side]: { status: "uploading", message: `Uploading slabbed ${side} photo directly to storage.` },
      }));
      try {
        await uploadAiGraderArtifactDirectly({
          purpose: "slab-photo",
          uploadUrl: plan.uploadUrl,
          uploadMethod: plan.uploadMethod,
          uploadHeaders: plan.uploadHeaders,
          contentType: slabMimeType,
          checksumSha256,
          body: bytes,
        });
      } catch (error) {
        throw new Error(formatAiGraderPublishStageError({ stage: "slabbed-photo-upload", error, side }));
      }
      let finalizeResponse: Response;
      try {
        finalizeResponse = await fetch("/api/admin/ai-grader/production/slabbed-photo-finalize", {
          method: "POST",
          headers: await productionAuthHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(plan.requiredFinalizeManifest),
        });
      } catch (error) {
        throw new Error(formatAiGraderPublishStageError({ stage: "slabbed-photo-finalize", error, side }));
      }
      const finalizePayload = await finalizeResponse.json().catch(() => ({}));
      if (!finalizeResponse.ok || finalizePayload.ok !== true) {
        throw new Error(
          formatAiGraderPublishStageError({
            stage: "slabbed-photo-finalize",
            error: new Error(finalizePayload.message ?? `HTTP ${finalizeResponse.status}`),
            side,
          })
        );
      }
      setSlabUploads((current) => ({
        ...current,
        [side]: {
          status: "uploaded",
          publicUrl: finalizePayload.result.publicUrl,
          message: `Slabbed ${side} photo uploaded and attached.`,
        },
      }));
      await refreshFinishQueue(reportId).catch(() => undefined);
    } catch (requestError) {
      setSlabUploads((current) => ({
        ...current,
        [side]: {
          status: "failed",
          message: requestError instanceof Error ? requestError.message : `Slabbed ${side} photo upload failed.`,
        },
      }));
    } finally {
      setBusy(null);
    }
  };

  const runEbayComps = async (targetItem?: FinishQueueItem | null) => {
    setBusy("run-comps");
    setError(null);
    setCompsState({ status: "running", message: "Preparing operator-triggered eBay comps." });
    try {
      const reportBundle = targetItem ? await loadFinishReportBundle(targetItem.reportId) : buildReportBundleForProduction();
      if (!reportBundle) {
        throw new Error("A finalized production release and selected report bundle are required before comps.");
      }
      const productionRelease = targetItem ? reportBundle.productionRelease : status.productionRelease;
      if (!productionRelease) {
        throw new Error("A finalized production release and selected report bundle are required before comps.");
      }
      const targetSelection = targetItem
        ? {
            source: "card_asset" as const,
            cardAssetId: targetItem.cardAssetId ?? undefined,
            itemId: targetItem.itemId ?? undefined,
            title: targetItem.cardTitle,
            displayTitle: targetItem.cardTitle,
          }
        : selectedCard;
      const readiness = buildAiGraderCompsReadiness({
        bundle: reportBundle,
        productionRelease,
        selectedCard: targetSelection,
      });
      if (!readiness.ready) {
        setCompsState({ status: readiness.status, message: readiness.message });
        return;
      }
      const response = await fetch("/api/admin/ai-grader/production/run-comps", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          reportId: targetItem?.reportId ?? reportBundle.reportId,
          reportBundle,
          productionRelease,
          selection: targetItem
            ? {
                cardAssetId: targetItem.cardAssetId,
                itemId: targetItem.itemId,
                title: targetItem.cardTitle,
              }
            : selectedCardIdentity,
          limit: 10,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "eBay comps action failed.");
      }
      const result = payload.result ?? {};
      const compsRefs = Array.isArray(result.compsRefs)
        ? result.compsRefs.map((entry: CompsCandidate, index: number) => ({
            ...entry,
            id: entry.id ?? `comp-${index + 1}`,
          }))
        : [];
      setCompsState({
        status: result.status ?? "failed",
        message: result.message ?? (result.status === "completed" ? "Comps completed." : "Comps status updated."),
        searchQuery: result.searchQuery,
        searchUrl: result.searchUrl,
        count: compsRefs.length,
        compsRefs,
        selectedIds: [],
        saved: false,
      });
    } catch (requestError) {
      setCompsState({
        status: "failed",
        message: requestError instanceof Error ? requestError.message : "eBay comps action failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const toggleSelectedComp = (compId: string) => {
    setCompsState((current) => {
      const selected = new Set(current.selectedIds ?? []);
      if (selected.has(compId)) selected.delete(compId);
      else selected.add(compId);
      return { ...current, selectedIds: Array.from(selected), saved: false };
    });
  };

  const saveSelectedComps = async (targetReportId?: string | null) => {
    setBusy("save-comps");
    setError(null);
    try {
      const reportId = targetReportId ?? productionPublish.reportId ?? status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
      if (!reportId) throw new Error("A published report ID is required before saving comps.");
      const selectedIds = new Set(compsState.selectedIds ?? []);
      const selectedComps = (compsState.compsRefs ?? []).filter((comp) => comp.id && selectedIds.has(comp.id));
      if (!selectedComps.length) throw new Error("Select at least one sold comp before saving valuation.");
      const response = await fetch("/api/admin/ai-grader/production/save-comps-selection", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          reportId,
          selectedComps,
          searchQuery: compsState.searchQuery,
          searchUrl: compsState.searchUrl,
          valuationCurrency: "USD",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Saving selected comps failed.");
      }
      setCompsState((current) => ({
        ...current,
        status: "saved",
        saved: true,
        valuationMinor: payload.result?.valuationMinor ?? null,
        message: `Saved ${payload.result?.evidenceItemCount ?? selectedComps.length} selected comp(s) and valuation.`,
      }));
      await refreshFinishQueue(reportId).catch(() => undefined);
    } catch (requestError) {
      setCompsState((current) => ({
        ...current,
        status: "failed",
        saved: false,
        message: requestError instanceof Error ? requestError.message : "Saving selected comps failed.",
      }));
    } finally {
      setBusy(null);
    }
  };

  const addToInventory = async (targetReportId?: string | null) => {
    setBusy("add-to-inventory");
    setError(null);
    setInventoryState({ status: "pending", message: "Moving card to inventory-ready flow." });
    try {
      const reportId = targetReportId ?? productionPublish.reportId ?? status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
      if (!reportId) throw new Error("A published report ID is required before adding to inventory.");
      const response = await fetch("/api/admin/ai-grader/production/add-to-inventory", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ reportId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Add To Inventory failed.");
      }
      setInventoryState({
        status: "completed",
        message: `Inventory-ready transition complete for Item ${payload.result?.itemId ?? selectedCard?.itemId ?? "linked item"}.`,
      });
      await refreshFinishQueue(reportId).catch(() => undefined);
    } catch (requestError) {
      setInventoryState({
        status: "failed",
        message: requestError instanceof Error ? requestError.message : "Add To Inventory failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const openReport = async () => {
    const reportId = status.latestReport.reportId;
    if (!reportReady || !reportId) {
      setError("No generated report is ready yet.");
      return;
    }
    if (!bridgeConnected || !stationToken.trim()) {
      setError("Connect the Dell local station bridge before opening the local report.");
      return;
    }
    setBusy("open-report");
    setError(null);
    setLocalReport({
      open: true,
      status: "loading",
      message: "Loading local report images from the paired Dell bridge.",
      reportId,
    });
    window.localStorage.setItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY, bridgeUrl);
    window.localStorage.setItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY, stationToken);
    try {
      const bundle = await fetchAiGraderStationReportBundle({
        baseUrl: bridgeUrl,
        stationToken,
        reportId,
        includeAssetBodies: true,
      });
      const imageCount = reportImageAssets(bundle, { allowEmbeddedBodies: true }).length;
      setLocalReport({
        open: true,
        status: "ready",
        message: imageCount ? `${imageCount} local report image(s) loaded through the paired bridge.` : "Local report loaded, but no renderable image assets were returned.",
        reportId,
        bundle,
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not open the local AI Grader report.";
      setLocalReport({
        open: true,
        status: "error",
        message,
        reportId,
      });
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const openHistoryReport = async (reportId: string) => {
    if (!reportId) return;
    if (!bridgeConnected || !stationToken.trim()) {
      setError("Connect the Dell local station bridge before opening local report history.");
      return;
    }
    setBusy("open-report");
    setError(null);
    setLocalReport({
      open: true,
      status: "loading",
      message: "Loading local history report images from the paired Dell bridge.",
      reportId,
    });
    try {
      const bundle = await fetchAiGraderStationReportBundle({
        baseUrl: bridgeUrl,
        stationToken,
        reportId,
        includeAssetBodies: true,
      });
      const imageCount = reportImageAssets(bundle, { allowEmbeddedBodies: true }).length;
      setLocalReport({
        open: true,
        status: "ready",
        message: imageCount ? `${imageCount} local report image(s) loaded through the paired bridge.` : "Local report loaded, but no renderable image assets were returned.",
        reportId,
        bundle,
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not open the local AI Grader report.";
      setLocalReport({
        open: true,
        status: "error",
        message,
        reportId,
      });
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setError(null);
    try {
      await refreshHistory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load local AI Grader report history.");
    }
  };

  const copyLink = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setProductionPublish((current) => ({ ...current, message: `${label} copied.` }));
    } catch {
      setProductionPublish((current) => ({ ...current, message: `${label}: ${value}` }));
    }
  };

  const bridgeStatusLabel =
    bridgeConnectionState === "connected"
      ? "Bridge Connected"
      : bridgeConnectionState === "checking"
        ? "Checking Bridge"
        : bridgeConnectionState === "not_running"
          ? "Bridge Not Running"
          : bridgeConnectionState === "pairing_required"
            ? "Pairing Required"
            : "Bridge Error";
  const bridgeStatusDetail =
    bridgeConnectionState === "connected"
      ? "This Dell browser is paired with the local station bridge."
      : bridgeConnectionState === "not_running"
        ? "Use the Ten Kings AI Grader Station desktop shortcut to start the local Dell bridge and reopen this page."
        : bridgeConnectionState === "pairing_required"
          ? "Use the Ten Kings AI Grader Station desktop shortcut to pair this browser, or enter a local pairing code."
          : bridgeConnectionState === "checking"
            ? "Checking the local Dell bridge at 127.0.0.1."
            : "The local Dell bridge could not be reached with the saved browser pairing.";
  const previewStatusLabel =
    warmRunnerCapturing
      ? "Full Forensic Capture"
      : previewStatus.status === "live"
      ? "Preview Live"
      : busy === "start-grading" || busy === "capture-back"
        ? "Capturing"
        : previewStatus.status === "starting"
          ? "Preview Starting"
          : previewStatus.status === "paused_for_capture"
            ? "Preview Paused"
            : previewStatus.status === "error"
              ? "Preview Unavailable"
              : reportReady
                ? "Report Ready"
                : "Preview Standby";
  const previewStatusDetail =
    warmRunnerCapturing
      ? `${formatStationValue(warmRunner.activeSide)} side; ${formatStationValue(warmRunner.status)}.`
      : previewStatus.status === "live"
      ? `${previewStatus.implementationType}; ${previewStatus.frameCount || 0} frame(s) displayed${previewStatus.fps ? `, ${previewStatus.fps} FPS` : ""}.`
      : previewStatus.status === "paused_for_capture"
        ? warmRunner.previewPolicy.holdActive
          ? "Live preview is paused while full forensic capture and report generation use the Basler evidence session."
          : "The preview stream released the Basler camera for capture."
        : previewStatus.status === "error"
          ? previewStatus.lastError ?? "The local preview stream is not available."
          : "The local Dell bridge will stream Basler preview frames here when connected.";

  if (workArea === "finish") {
    const finishFrontReady = Boolean(selectedFinishItem?.slabPhotos.frontUploaded || slabUploads.front?.status === "uploaded");
    const finishBackReady = Boolean(selectedFinishItem?.slabPhotos.backUploaded || slabUploads.back?.status === "uploaded");
    const finishSlabReady = finishFrontReady && finishBackReady;
    const finishCompsReady = Boolean(selectedFinishItem?.valuation.complete || compsSaved);
    const finishInventoryReady = Boolean(selectedFinishItem?.inventory.complete || inventoryComplete);

    return (
      <>
        <Head>
          <title>Ten Kings AI Grader Finish Cards</title>
          <meta name="robots" content="noindex" />
        </Head>
        <main className="finish-station">
          <header className="finish-topbar">
            <div>
              <p className="eyebrow">Ten Kings AI Grader</p>
              <h1>Finish Cards</h1>
              <p>{finishQueueState.message}</p>
            </div>
            <div className="finish-top-actions">
              <button type="button" onClick={() => setWorkArea("grade")} disabled={busy !== null}>
                Back to Grading
              </button>
              <button type="button" onClick={() => void refreshFinishQueue(selectedFinishReportId)} disabled={busy !== null || finishQueueState.status === "pending"}>
                {finishQueueState.status === "pending" ? "Refreshing" : "Refresh Queue"}
              </button>
            </div>
          </header>

          {error ? <div className="finish-error">{error}</div> : null}

          <section className={productionSignedIn ? "finish-auth signed-in" : "finish-auth"}>
            <div>
              <p className="eyebrow">Production Sign-In</p>
              <h2>{productionSignedIn ? "Signed In" : "Sign In Required"}</h2>
              <p>{productionSignedIn ? `Production actions will run as ${productionOperatorLabel}.` : productionAuthState.message}</p>
            </div>
            <button type="button" onClick={signInForProduction} disabled={sessionLoading || busy !== null || productionAuthState.status === "pending"}>
              {productionAuthState.status === "pending" ? "Opening Sign-In" : productionSignedIn ? "Refresh Sign-In" : "Sign In"}
            </button>
          </section>

          <div className="finish-layout">
            <section className="finish-queue">
              <div className="finish-stats">
                <article><span>Total</span><strong>{finishQueue.stats.total}</strong></article>
                <article><span>Slab</span><strong>{finishQueue.stats.needsSlabPhotos}</strong></article>
                <article><span>eBay</span><strong>{finishQueue.stats.needsEbayEvaluate}</strong></article>
                <article><span>Inventory</span><strong>{finishQueue.stats.needsInventory}</strong></article>
              </div>
              <div className="finish-list">
                {finishQueue.items.length ? (
                  finishQueue.items.map((item, index) => (
                    <button
                      type="button"
                      key={item.reportId}
                      className={item.reportId === selectedFinishItem?.reportId ? "selected" : ""}
                      onClick={() => setSelectedFinishReportId(item.reportId)}
                    >
                      <span>#{index + 1}</span>
                      <strong>{item.cardTitle}</strong>
                      <em>{item.grade ? `Grade ${scoreText(item.grade)}` : "Grade pending"}</em>
                      <small>{item.statusText}</small>
                    </button>
                  ))
                ) : (
                  <div className="finish-empty">No published cards are waiting for finishing.</div>
                )}
              </div>
            </section>

            <section className="finish-panel">
              {selectedFinishItem ? (
                <>
                  <div className="finish-panel-head">
                    <div>
                      <p className="eyebrow">Selected Card</p>
                      <h2>{selectedFinishItem.cardTitle}</h2>
                      <p>
                        {selectedFinishItem.certId ?? selectedFinishItem.reportId}
                        {selectedFinishItem.publishedAt ? ` / published ${new Date(selectedFinishItem.publishedAt).toLocaleString()}` : ""}
                      </p>
                    </div>
                    <strong>{selectedFinishItem.statusText}</strong>
                  </div>

                  <ol className="finish-steps">
                    {finishPipelineSteps.map((step) => (
                      <li key={step.id} className={step.done ? "done" : "active"}>
                        <span>{step.done ? "Done" : "Now"}</span>
                        <strong>{step.label}</strong>
                        <p>{step.action}</p>
                      </li>
                    ))}
                  </ol>

                  <div className="finish-links">
                    {selectedFinishItem.publicReportUrl ? <a href={selectedFinishItem.publicReportUrl} target="_blank" rel="noreferrer">Public Report</a> : null}
                    {selectedFinishItem.labelPreviewUrl ? <a href={selectedFinishItem.labelPreviewUrl}>Label Sheets</a> : null}
                    {selectedFinishItem.cardAssetId ? <span>CardAsset {selectedFinishItem.cardAssetId}</span> : null}
                    {selectedFinishItem.itemId ? <span>Item {selectedFinishItem.itemId}</span> : null}
                  </div>

                  <section className="finish-card-section">
                    <p className="eyebrow">Upload Slab Photos</p>
                    <div className="finish-upload-grid">
                      <label>
                        Front slab photo
                        <input
                          type="file"
                          accept="image/*"
                          disabled={busy !== null}
                          onChange={(event) => uploadSlabbedPhoto("front", event.target.files?.[0] ?? null, selectedFinishReportIdForActions)}
                        />
                      </label>
                      <label>
                        Back slab photo
                        <input
                          type="file"
                          accept="image/*"
                          disabled={busy !== null}
                          onChange={(event) => uploadSlabbedPhoto("back", event.target.files?.[0] ?? null, selectedFinishReportIdForActions)}
                        />
                      </label>
                    </div>
                    <p>Front: {finishFrontReady ? "attached" : slabUploads.front?.message ?? "needed"} / Back: {finishBackReady ? "attached" : slabUploads.back?.message ?? "needed"}</p>
                    {!selectedFinishItem.label.printed ? <p className="finish-warning">Inventory still requires the printed label to be marked from Grade Card.</p> : null}
                  </section>

                  <section className="finish-card-section">
                    <p className="eyebrow">eBay Evaluate</p>
                    <div className="finish-actions">
                      <button type="button" onClick={() => void runEbayComps(selectedFinishItem)} disabled={!finishSlabReady || busy !== null || finishCompsReady}>
                        {busy === "run-comps" ? "Running" : finishCompsReady ? "Valuation Saved" : "Run eBay Comps"}
                      </button>
                      <button type="button" onClick={() => void saveSelectedComps(selectedFinishReportIdForActions)} disabled={!canSaveSelectedComps || busy !== null || finishCompsReady}>
                        {busy === "save-comps" ? "Saving" : "Save Selected Comps"}
                      </button>
                    </div>
                    <p>{compsState.message}</p>
                    {Array.isArray(compsState.compsRefs) && compsState.compsRefs.length ? (
                      <div className="finish-comps">
                        {compsState.compsRefs.map((comp, index) => {
                          const compId = comp.id ?? `comp-${index + 1}`;
                          return (
                            <label key={compId}>
                              <input
                                type="checkbox"
                                checked={(compsState.selectedIds ?? []).includes(compId)}
                                onChange={() => toggleSelectedComp(compId)}
                                disabled={busy !== null || finishCompsReady}
                              />
                              <span>{comp.title ?? "Sold comp"}</span>
                              <strong>{comp.price ?? "price n/a"}</strong>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>

                  <section className="finish-card-section">
                    <p className="eyebrow">Add To Inventory</p>
                    <button type="button" className="finish-primary" onClick={() => void addToInventory(selectedFinishReportIdForActions)} disabled={!canAddSelectedFinishToInventory || busy !== null || finishInventoryReady}>
                      {busy === "add-to-inventory" ? "Adding" : finishInventoryReady ? "In Inventory" : "Add To Inventory"}
                    </button>
                    <p>{inventoryState.message}</p>
                  </section>
                </>
              ) : (
                <div className="finish-empty">Select a card from the Finish Cards queue.</div>
              )}
            </section>
          </div>
        </main>
        <style jsx>{`
          .finish-station {
            min-height: 100vh;
            background: #10110f;
            color: #f7efe1;
            padding: 24px;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .finish-topbar,
          .finish-auth,
          .finish-layout,
          .finish-error {
            max-width: 1280px;
            margin: 0 auto 16px;
          }
          .finish-topbar,
          .finish-auth {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.045);
            padding: 18px;
          }
          .finish-topbar h1,
          .finish-auth h2,
          .finish-panel h2,
          p {
            margin: 0;
            letter-spacing: 0;
          }
          .finish-topbar p,
          .finish-auth p,
          .finish-card-section p,
          .finish-panel-head p {
            margin-top: 8px;
            color: #c8beac;
            line-height: 1.45;
          }
          .eyebrow {
            margin: 0 0 6px;
            color: #c9a85f;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }
          .finish-top-actions,
          .finish-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }
          button,
          a {
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            min-height: 42px;
            padding: 10px 13px;
            color: #f7efe1;
            background: rgba(255, 255, 255, 0.06);
            font-size: 12px;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            text-decoration: none;
            cursor: pointer;
          }
          button:disabled,
          input:disabled {
            cursor: not-allowed;
            opacity: 0.55;
          }
          .finish-auth.signed-in {
            border-color: rgba(91, 255, 157, 0.28);
            background: rgba(91, 255, 157, 0.07);
          }
          .finish-error,
          .finish-warning {
            border: 1px solid rgba(255, 82, 82, 0.34);
            background: rgba(95, 12, 18, 0.34);
            color: #ffd6d6;
            border-radius: 8px;
            padding: 12px;
          }
          .finish-layout {
            display: grid;
            grid-template-columns: 360px minmax(0, 1fr);
            gap: 16px;
          }
          .finish-queue,
          .finish-panel,
          .finish-card-section {
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.045);
            padding: 16px;
          }
          .finish-stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 12px;
          }
          .finish-stats article {
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px;
          }
          .finish-stats span,
          .finish-list span,
          .finish-steps span {
            color: #a99f8f;
            font-size: 10px;
            font-weight: 900;
            text-transform: uppercase;
          }
          .finish-stats strong {
            display: block;
            margin-top: 4px;
            font-size: 24px;
          }
          .finish-list {
            display: grid;
            gap: 8px;
          }
          .finish-list button {
            display: grid;
            grid-template-columns: 34px minmax(0, 1fr);
            gap: 3px 8px;
            min-height: 84px;
            text-align: left;
            letter-spacing: 0;
            text-transform: none;
          }
          .finish-list button.selected {
            border-color: rgba(91, 255, 157, 0.5);
            background: rgba(91, 255, 157, 0.12);
          }
          .finish-list strong,
          .finish-list em,
          .finish-list small {
            min-width: 0;
            overflow-wrap: anywhere;
            grid-column: 2;
          }
          .finish-list em,
          .finish-list small {
            color: #c8beac;
            font-style: normal;
          }
          .finish-panel-head {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 14px;
          }
          .finish-panel-head > strong {
            align-self: start;
            border: 1px solid rgba(228, 191, 105, 0.5);
            border-radius: 999px;
            padding: 8px 10px;
            color: #f7e4b4;
            white-space: nowrap;
          }
          .finish-steps {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin: 0 0 14px;
            padding: 0;
            list-style: none;
          }
          .finish-steps li {
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px;
          }
          .finish-steps li.done {
            border-color: rgba(91, 255, 157, 0.28);
            background: rgba(91, 255, 157, 0.08);
          }
          .finish-steps p {
            margin-top: 7px;
            color: #c8beac;
            font-size: 12px;
            line-height: 1.4;
          }
          .finish-links,
          .finish-upload-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 14px;
          }
          .finish-links span {
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px;
            color: #c8beac;
            overflow-wrap: anywhere;
          }
          .finish-card-section {
            margin-top: 12px;
          }
          label {
            display: block;
            color: #ded6c8;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          input {
            width: 100%;
            box-sizing: border-box;
            margin-top: 7px;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(0, 0, 0, 0.3);
            color: #f8f0e0;
            border-radius: 8px;
            padding: 10px;
          }
          .finish-primary {
            width: 100%;
            border-color: rgba(91, 255, 157, 0.64);
            background: rgba(91, 255, 157, 0.14);
          }
          .finish-comps {
            display: grid;
            gap: 8px;
            margin-top: 12px;
          }
          .finish-comps label {
            display: grid;
            grid-template-columns: 24px minmax(0, 1fr) auto;
            align-items: center;
            gap: 8px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px;
            letter-spacing: 0;
            text-transform: none;
          }
          .finish-comps input {
            width: 16px;
            margin: 0;
          }
          .finish-empty {
            border: 1px dashed rgba(255, 255, 255, 0.16);
            border-radius: 8px;
            padding: 18px;
            color: #c8beac;
          }
          @media (max-width: 920px) {
            .finish-layout,
            .finish-steps,
            .finish-links,
            .finish-upload-grid {
              grid-template-columns: 1fr;
            }
            .finish-topbar,
            .finish-auth,
            .finish-panel-head {
              flex-direction: column;
            }
          }
        `}</style>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Station</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="station">
        <section className="viewer" aria-label="AI Grader camera cockpit">
          <div className="camera-frame" ref={cameraFrameRef}>
            {previewFrameUrl ? (
              <img
                key={previewFrameBinding?.frameId ?? previewFrameUrl}
                className="preview-image"
                src={previewFrameUrl}
                alt="Live AI Grader Basler preview"
              />
            ) : (
              <div className="preview-placeholder">
                <span>{previewStatusLabel}</span>
              </div>
            )}
            <div className="report-overlay-stage" style={reportOverlayStageStyle} aria-hidden="true">
              <svg
                className={`report-framing-overlay${detectedGeometryDominant ? " geometry-dominant" : ""}`}
                viewBox={`0 0 ${reportOverlayFrameSize.width} ${reportOverlayFrameSize.height}`}
                focusable="false"
              >
                <rect
                  className="report-overlay-frame-border"
                  x="0"
                  y="0"
                  width={reportOverlayFrameSize.width}
                  height={reportOverlayFrameSize.height}
                />
                <rect
                  className="report-overlay-card-template"
                  x={reportOverlayTemplate.x}
                  y={reportOverlayTemplate.y}
                  width={reportOverlayTemplate.width}
                  height={reportOverlayTemplate.height}
                />
                <line
                  className="report-overlay-centerline"
                  x1={Math.round(reportOverlayFrameSize.width / 2)}
                  y1="0"
                  x2={Math.round(reportOverlayFrameSize.width / 2)}
                  y2={reportOverlayFrameSize.height}
                />
                <line
                  className="report-overlay-centerline"
                  x1="0"
                  y1={Math.round(reportOverlayFrameSize.height / 2)}
                  x2={reportOverlayFrameSize.width}
                  y2={Math.round(reportOverlayFrameSize.height / 2)}
                />
                {reportOverlayRois.map((roi) => (
                  <rect
                    key={roi.id}
                    className={`report-overlay-roi ${roi.type}`}
                    x={roi.x}
                    y={roi.y}
                    width={Math.max(1, roi.width)}
                    height={Math.max(1, roi.height)}
                  />
                ))}
              </svg>
              {cardGeometryPolygonPoints.length === 4 ? (
                <svg
                  className={`card-geometry-overlay ${cardPlacementState}`}
                  viewBox={`0 0 ${cardGeometryFrameSize.width} ${cardGeometryFrameSize.height}`}
                  focusable="false"
                >
                  <polygon points={cardGeometryPolygonPoints.map((corner) => `${corner.x},${corner.y}`).join(" ")} />
                  {cardGeometryCornerBrackets.map((bracket, index) => (
                    <polyline
                      className="card-geometry-corner-bracket"
                      key={`corner-${index}`}
                      points={`${bracket.towardPrevious.x},${bracket.towardPrevious.y} ${bracket.corner.x},${bracket.corner.y} ${bracket.towardNext.x},${bracket.towardNext.y}`}
                    />
                  ))}
                  {cardGeometryEdgeMidpoints.map((edgeMidpoint, index) => (
                    <circle
                      className="card-geometry-edge-midpoint"
                      key={`edge-${index}`}
                      cx={edgeMidpoint.x}
                      cy={edgeMidpoint.y}
                      r={Math.max(3, cardGeometryFrameSize.width * 0.0032)}
                    />
                  ))}
                  {cardGeometryCenterAxes.map((axis, index) => (
                    <line
                      className="card-geometry-center-axis"
                      key={`axis-${index}`}
                      x1={axis.x1}
                      y1={axis.y1}
                      x2={axis.x2}
                      y2={axis.y2}
                    />
                  ))}
                  {cardGeometryCenter ? (
                    <circle
                      className="card-geometry-center-point"
                      cx={cardGeometryCenter.x}
                      cy={cardGeometryCenter.y}
                      r={Math.max(2.5, cardGeometryFrameSize.width * 0.0025)}
                    />
                  ) : null}
                </svg>
              ) : null}
            </div>
            <div className={`card-geometry-badge ${cardPlacementState}`} role="status" aria-live="polite">
              {cardPlacementLabel}
            </div>
            <div className="camera-status">
              <span>{bridgeStatusLabel}</span>
              <strong>{previewStatusLabel}</strong>
              <p>{previewStatusDetail}</p>
            </div>
          </div>

          {!bridgeConnected ? (
            <div className="connect-scrim">
              <div>
                <p className="eyebrow">Ten Kings AI Grader</p>
                <h1>{bridgeStatusLabel}</h1>
                <p>{bridgeStatusDetail}</p>
                <label>
                  Local pairing code
                  <input value={manualPairingCode} onChange={(event) => setManualPairingCode(event.target.value)} type="password" />
                </label>
                <button type="button" onClick={() => void pairBridge()} disabled={busy !== null || !manualPairingCode.trim()}>
                  {busy === "pair" ? "Pairing" : "Pair Browser"}
                </button>
                <button type="button" onClick={connectBridge} disabled={busy !== null || !stationToken.trim()}>
                  {busy === "connect" ? "Connecting" : "Connect Saved Token"}
                </button>
                <button type="button" className="link-button" onClick={() => setAdvancedConnectOpen((current) => !current)}>
                  {advancedConnectOpen ? "Hide Advanced" : "Advanced"}
                </button>
                {advancedConnectOpen ? (
                  <div className="advanced-connect">
                    <label>
                      Bridge URL
                      <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} />
                    </label>
                    <label>
                      Saved station token
                      <input value={stationToken} onChange={(event) => setStationToken(event.target.value)} type="password" />
                    </label>
                  </div>
                ) : null}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={contractPreviewEnabled}
                    onChange={(event) => setContractPreviewEnabled(event.target.checked)}
                  />
                  Contract preview only
                </label>
              </div>
            </div>
          ) : null}

          {showFlipScrim ? (
            <div className="flip-scrim">
              <div>
                <p className="eyebrow">Position Back</p>
                <h2>{previewEpochState.phase === "live" ? "Back Preview Live" : "Starting Back Preview"}</h2>
                <p>
                  {previewEpochState.phase === "live"
                    ? "Flip the card and use the fresh back edge outline as the placement guide."
                    : "The previous front image and Ready state were cleared. Waiting for the first fresh back frame."}
                </p>
                <p id="back-geometry-guidance" className={`geometry-action-status ${cardPlacementState}`}>
                  {cardPlacementGuidance}
                </p>
                <button
                  type="button"
                  onClick={() => void captureBackAndContinue()}
                  aria-describedby="back-geometry-guidance"
                  disabled={busy !== null || Boolean(status.captureFailure) || previewGeometrySide !== "back" || !detectedGeometryReady}
                >
                  {busy === "capture-back" ? "Capturing Back" : "Capture Back"}
                </button>
              </div>
            </div>
          ) : null}

          {mathematicalExecution?.status === "processing" ? (
            <section className="mathematical-review-shell" aria-live="polite">
              <p className="eyebrow">Mathematical V1</p>
              <h2>Deterministic Processing</h2>
              <p>Attempt {mathematicalExecution.attempt} is processing exact calibrated evidence. V0 fallback is disabled.</p>
            </section>
          ) : null}

          {mathematicalExecution?.status === "insufficient_evidence" ? (
            <section className="mathematical-review-shell insufficient" role="alert">
              <p className="eyebrow">Evidence-Quality Limitation</p>
              <h2>Mathematical V1 Stopped Fail-Closed</h2>
              <p>
                Failed stage: <strong>{formatStationValue(mathematicalExecution.failedStage)}</strong>.
                No V0 score, manual grade, alternate camera, or historical fallback was used.
              </p>
              <ul>
                {mathematicalExecution.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <div className="mathematical-insufficient-flags">
                <span>Recapture: {mathematicalExecution.requiresRecapture ? "required" : "no"}</span>
                <span>Approved reference: {mathematicalExecution.requiresApprovedDesignReference ? "required" : "no"}</span>
                <span>Calibration: {mathematicalExecution.requiresCalibration ? "required" : "no"}</span>
                <span>Implementation correction: {mathematicalExecution.requiresImplementationCorrection ? "required" : "no"}</span>
              </div>
              <p>Export, release, Label V1 generation, and Approve & Publish remain blocked.</p>
            </section>
          ) : null}

          {mathematicalReviewRequest ? (
            <section className="mathematical-review-shell" aria-label="Exact Mathematical V1 finding review">
              <div className="mathematical-review-head">
                <div>
                  <p className="eyebrow">Exact Finding Review</p>
                  <h2>{mathematicalReviewRequest.findings.length} Measured Finding(s)</h2>
                  <p>{mathematicalReviewAssets.message}</p>
                </div>
                <div>
                  <span>Request SHA-256</span>
                  <code>{mathematicalReviewRequest.artifactSha256}</code>
                </div>
              </div>
              {mathematicalReviewIssues.length ? (
                <ul className="warning-list">
                  {mathematicalReviewIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              ) : null}
              <div className="mathematical-finding-list">
                {mathematicalReviewRequest.findings.map((finding) => {
                  const trueView = mathematicalReviewAssetView(finding.side, finding.trueView);
                  const directional = finding.directionalChannels.map((metadata) =>
                    mathematicalReviewAssetView(finding.side, metadata));
                  const evidenceViews = ([
                    ["ROI", finding.reviewEvidence.roi],
                    ["Segmentation", finding.reviewEvidence.segmentationMask],
                    ["Confidence", finding.reviewEvidence.confidenceMask],
                    ["Illumination", finding.reviewEvidence.illuminationMask],
                  ] as const).map(([label, metadata]) => ({
                    label,
                    metadata,
                    view: mathematicalReviewAssetView(finding.side, metadata),
                  }));
                  return (
                    <article className="mathematical-finding-review" key={finding.findingId}>
                      <header>
                        <div>
                          <span>{formatStationValue(finding.side)} / {formatStationValue(finding.element)} / {formatStationValue(finding.location)}</span>
                          <h3>{formatStationValue(finding.category)}</h3>
                        </div>
                        <strong>-{finding.measuredDeduction.toFixed(2)}</strong>
                      </header>
                      <p>{finding.explanation}</p>
                      <div className="mathematical-review-true-view">
                        {trueView ? (
                          <>
                            <img src={trueView.objectUrl} alt={finding.side + " exact normalized True View"} />
                            <span
                              className="mathematical-finding-box"
                              style={{
                                left: String(finding.geometry.x * 100) + "%",
                                top: String(finding.geometry.y * 100) + "%",
                                width: String(finding.geometry.width * 100) + "%",
                                height: String(finding.geometry.height * 100) + "%",
                              }}
                              aria-label="Exact normalized finding region"
                            />
                          </>
                        ) : <span>True View verification pending</span>}
                      </div>
                      <div className="mathematical-directional-grid">
                        {directional.map((view, index) => (
                          <figure key={finding.directionalChannels[index].assetId}>
                            {view ? <img src={view.objectUrl} alt={"Directional channel " + String(index + 1)} /> : null}
                            <figcaption>Direction {index + 1}</figcaption>
                          </figure>
                        ))}
                      </div>
                      <div className="mathematical-mask-grid">
                        {evidenceViews.map(({ label, metadata, view }) => (
                          <figure key={metadata.assetId}>
                            {view ? <img src={view.objectUrl} alt={label + " evidence"} /> : null}
                            <figcaption>{label}</figcaption>
                          </figure>
                        ))}
                      </div>
                      <div className="mathematical-measurements">
                        {finding.measurements.map((measurement) => (
                          <dl key={measurement.measurementId}>
                            <dt>{formatStationValue(measurement.kind)}</dt>
                            <dd>
                              measured {String(measurement.measuredMeasurement)} {measurement.unit};
                              {" "}U95 {String(measurement.u95)};
                              {" "}effective {String(measurement.effectiveMeasurement)};
                              {" "}Grade-10 tolerance {String(measurement.explicitGrade10Tolerance)};
                              {" "}buffer {String(measurement.grade10Buffer)}
                            </dd>
                            <dt>Evidence quality</dt>
                            <dd>
                              {String(measurement.validEvidenceCoverage * 100)}% valid /
                              {" "}{measurement.usableDirectionalChannelCount} directional channels
                            </dd>
                          </dl>
                        ))}
                      </div>
                      <label className="mathematical-disposition">
                        Operator disposition
                        <select
                          value={mathematicalReviewDispositions[finding.findingId] ?? ""}
                          onChange={(event) => setMathematicalReviewDispositions((current) => ({
                            ...current,
                            [finding.findingId]: event.target.value === "confirmed" ||
                              event.target.value === "adjusted"
                              ? event.target.value
                              : undefined,
                          }))}
                          disabled={busy !== null || mathematicalReviewAssets.status !== "ready"}
                        >
                          <option value="">Select one</option>
                          <option value="confirmed">Confirmed as measured</option>
                          <option value="adjusted">Adjusted disposition; deterministic rerun required</option>
                        </select>
                      </label>
                    </article>
                  );
                })}
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => void submitMathematicalFindingReviews()}
                disabled={
                  busy !== null ||
                  mathematicalReviewAssets.status !== "ready" ||
                  !mathematicalReviewAllDispositioned
                }
              >
                {busy === "mathematical-review" ? "Submitting and Rerunning" : "Submit Exact Reviews and Rerun"}
              </button>
              <p>
                Submission contains only one confirmed/adjusted disposition per finding, the exact request SHA-256,
                and the review timestamp. The browser cannot author measurement confidence, transforms, deductions, or publication.
              </p>
            </section>
          ) : null}


          {localReport.open ? (
            <section className="local-report" aria-label="Local AI Grader report viewer">
              <div className="local-report-head">
                <div>
                  <p className="eyebrow">Local Operator Report</p>
                  <h2>{localReport.bundle?.cardIdentity.title ?? localReport.reportId ?? "AI Grader report"}</h2>
                  <p>{localReport.message}</p>
                </div>
                <button
                  type="button"
                  className="close-report"
                  onClick={() => setLocalReport({ open: false, status: "idle", message: "No local report is open." })}
                  aria-label="Close local report viewer"
                >
                  X
                </button>
              </div>
              {localReport.status === "loading" ? (
                <div className="report-loading">Loading paired-bridge report assets</div>
              ) : localReport.status === "error" ? (
                <div className="report-error">{localReport.message}</div>
              ) : localReport.bundle ? (
                <>
                  <div className="report-hero">
                    {localFrontTrueView ? (
                      <figure>
                        <img src={localFrontTrueView.renderUrl} alt="Front true view evidence" />
                        <figcaption>{localFrontTrueView.fileName ?? localFrontTrueView.id ?? "Front evidence"}</figcaption>
                      </figure>
                    ) : null}
                    {localBackTrueView ? (
                      <figure>
                        <img src={localBackTrueView.renderUrl} alt="Back true view evidence" />
                        <figcaption>{localBackTrueView.fileName ?? localBackTrueView.id ?? "Back evidence"}</figcaption>
                      </figure>
                    ) : null}
                    <div className="report-facts">
                      <span>Report ID</span>
                      <strong>{localReport.bundle.reportId}</strong>
                      <span>Status</span>
                      <strong>{formatStationValue(localMathematicalFinalGrade?.status ?? (localReport.bundle as AiGraderLegacyReportBundle).reportStatus)}</strong>
                      <span>Grade</span>
                      <strong>{scoreText(localReportFinalGrade?.overall ?? localReportStory?.overall)}</strong>
                      <span>Images</span>
                      <strong>{localReportImages.length}</strong>
                      <span>Front / Back</span>
                      <strong>{localReportCounts.front} / {localReportCounts.back}</strong>
                      <span>ROI / Channels / Vision</span>
                      <strong>{localReportCounts.roi} / {localReportCounts.channel} / {localReportCounts.vision}</strong>
                    </div>
                  </div>
                  <div className="report-section-grid">
                    <section>
                      <p className="eyebrow">Grade Story</p>
                      <h3>{localMathematicalBundle ? "Mathematical Grading V1 Final" : localLegacyFinalGrade?.finalGradeComputed ? "Final AI-Grader Grade V0" : "Diagnostic Report"}</h3>
                      <p>{localMathematicalFinalGrade?.formula ?? localReportStory?.gradeStory?.summary ?? "This report did not compute a final grade. Review the evidence gates and warnings below."}</p>
                      <dl>
                        <dt>Confidence</dt>
                        <dd>{localReportFinalGrade?.confidence.band ?? localReportStory?.confidence?.band ?? "pending"}</dd>
                        <dt>Strongest positive</dt>
                        <dd>{localReportStory?.gradeStory?.strongestPositiveFinding ?? "Not computed"}</dd>
                        <dt>Strongest warning</dt>
                        <dd>{localReportStory?.gradeStory?.strongestWarning ?? localReport.bundle.warnings?.[0] ?? "No warning recorded"}</dd>
                      </dl>
                    </section>
                    <section>
                      <p className="eyebrow">Publish Readiness</p>
                      <h3>{formatStationValue(localReportReadiness.status)}</h3>
                      <p>{localReportReadiness.message}</p>
                      <dl>
                        <dt>Cert / Report ID</dt>
                        <dd>{localReportReadiness.certId ?? "pending"}</dd>
                        <dt>QR Payload</dt>
                        <dd>{localReportReadiness.qrPayloadUrl ?? "pending"}</dd>
                      </dl>
                    </section>
                  </div>
                  <section className="report-section">
                    <p className="eyebrow">Element Diagnostics</p>
                    <div className="element-mini-grid">
                      {(["centering", "corners", "edges", "surface"] as const).map((element) => {
                        const finalElement = localReportFinalGrade?.elements[element];
                        const provisionalElement = localReportStory?.elementScores?.[element];
                        return (
                          <article key={element}>
                            <span>{element}</span>
                            <strong>{scoreText(finalElement?.score ?? provisionalElement?.score)}</strong>
                            <p>{localMathematicalFinalGrade?.elements[element].formula ?? localLegacyFinalGrade?.elements[element]?.explanation ?? provisionalElement?.explanation ?? "Insufficient evidence."}</p>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                  <div className="report-section-grid">
                    <section>
                      <p className="eyebrow">Why Not 10</p>
                      {(localReportFinalGrade?.whyNot10.length ? localReportFinalGrade.whyNot10 : localReportStory?.whyNot10 ?? []).length ? (
                        (localReportFinalGrade?.whyNot10.length ? localReportFinalGrade.whyNot10 : localReportStory?.whyNot10 ?? []).map((reason) => (
                          <article key={reason.id} className="compact-finding">
                            <strong>{"title" in reason ? reason.title : `${formatStationValue(reason.element)} deduction`}</strong>
                            <p>{reason.explanation}</p>
                          </article>
                        ))
                      ) : (
                        <p>No grade-impact story was computed.</p>
                      )}
                    </section>
                    <section>
                      <p className="eyebrow">{localMathematicalBundle ? "Mathematical Evidence" : "Vision Lab"}</p>
                      {localMathematicalBundle ? (
                        <dl>
                          <dt>Threshold set</dt>
                          <dd>{localMathematicalBundle.gradingStandard.thresholdSetId}</dd>
                          <dt>Calibration</dt>
                          <dd>{localMathematicalBundle.calibrationProfile.profileId} / {localMathematicalBundle.calibrationProfile.calibrationVersion}</dd>
                          <dt>Measured deductions</dt>
                          <dd>{localMathematicalBundle.deductionLedger.entries.length}</dd>
                          <dt>Overall formula</dt>
                          <dd>{localMathematicalBundle.productionRelease.finalGrade.formula}</dd>
                        </dl>
                      ) : (
                        <dl>
                          <dt>Available</dt>
                          <dd>{(localReport.bundle as AiGraderLegacyReportBundle).visionLab?.available ? "Yes" : "No"}</dd>
                          <dt>Surface candidates</dt>
                          <dd>{(localReport.bundle as AiGraderLegacyReportBundle).visionLab?.candidateCount ?? 0}</dd>
                          <dt>Heatmaps</dt>
                          <dd>{(localReport.bundle as AiGraderLegacyReportBundle).visionLab?.heatmapRefs?.join(", ") || "none"}</dd>
                          <dt>Light sweep</dt>
                          <dd>{(localReport.bundle as AiGraderLegacyReportBundle).visionLab?.channelImageRefs?.join(", ") || "none"}</dd>
                        </dl>
                      )}
                    </section>
                  </div>
                  {localReportGallery.length ? (
                    <section className="report-section">
                      <p className="eyebrow">Evidence Images</p>
                      <div className="report-grid">
                        {localReportGallery.map((asset) => (
                          <figure key={asset.renderUrl}>
                            <img src={asset.renderUrl} alt={asset.fileName ?? asset.id ?? "AI Grader evidence image"} loading="lazy" />
                            <figcaption>{asset.fileName ?? asset.id ?? "evidence image"}</figcaption>
                          </figure>
                        ))}
                      </div>
                    </section>
                  ) : (
                    <div className="report-error">No renderable local report images were returned by the paired bridge.</div>
                  )}
                  {localReportGateRows.length ? (
                    <section className="report-section">
                      <p className="eyebrow">Warnings and Gates</p>
                      <div className="gate-grid">
                        {localReportGateRows.map((gate) => (
                          <article key={gate.key} className={gate.status}>
                            <span>{formatStationValue(gate.status)}</span>
                            <strong>{gate.label}</strong>
                            <p>{gate.reason}</p>
                            {gate.evidenceRefs.length ? <small>{gate.evidenceRefs.join(", ")}</small> : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {localReport.bundle.warnings?.length ? (
                    <section className="report-section">
                      <p className="eyebrow">Diagnostics</p>
                      <ul className="warning-list">
                        {localReport.bundle.warnings.slice(0, 12).map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
        </section>

        <aside className="sidebar">
          <div className="brand">
            <div>
              <span>Ten Kings</span>
              <strong>AI Grader Station</strong>
            </div>
            <Link href="/ai-grader/finish">Finish Cards</Link>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <section className="next-card">
            <p className="eyebrow">Current Step</p>
            <h2>{activePipelineStep.label}</h2>
            <p>{activePipelineStep.action}</p>
            <ol className="pipeline-steps">
              {gradePipelineSteps.map((step) => (
                <li key={step.id} className={step.done ? "done" : step.id === activePipelineStep.id ? "active" : ""}>
                  <span>{step.done ? "Done" : step.id === activePipelineStep.id ? "Now" : "Next"}</span>
                  <strong>{step.label}</strong>
                </li>
              ))}
            </ol>
            <button type="button" className="primary" onClick={startNewCard} disabled={busy !== null || mathematicalStartBlocked}>
              {busy === "start" ? "Starting" : "Start New Card"}
            </button>
            <button
              type="button"
              className="start-grading"
              onClick={() => void startGrading()}
              aria-describedby="front-geometry-guidance"
              disabled={busy !== null || !canStartGrading || previewGeometrySide !== "front" || !detectedGeometryReady}
            >
              {busy === "start-grading" ? "Capturing Front" : "Capture Front"}
            </button>
            <p id="front-geometry-guidance" className={`geometry-action-status ${detectedGeometryReady ? "ready" : cardPlacementState}`}>
              {frontStartGuidance}
            </p>
          </section>

          <section className="capture-settings">
            <div className="capture-settings-head">
              <div>
                <p className="eyebrow">Capture Pipeline</p>
                <h3>{stationCaptureMode === "rapid" ? "Rapid Capture" : "Single Card"}</h3>
              </div>
              <strong>Full Forensic / Detected Geometry</strong>
            </div>
            <label>
              Grading contract
              <select
                value={selectedGradingContract}
                onChange={(event) => setSelectedGradingContract(event.target.value as AiGraderGradingContract)}
                disabled={!bridgeConnected || busy !== null || stationSettingsLocked}
              >
                <option value="legacy_v0">Legacy V0</option>
                <option value="mathematical_calibration_v1" disabled={!mathematicalCalibrationReady}>Mathematical Calibration V1</option>
              </select>
            </label>
            <div className={`grading-contract-readiness ${mathematicalCalibrationReady ? "ready" : "blocked"}`} role="status">
              <strong>{mathematicalCalibrationReady ? "Mathematical V1 ready" : "Mathematical V1 unavailable"}</strong>
              <p>
                {mathematicalCalibrationReady
                  ? `${status.mathematicalCalibration?.profileId ?? "Finalized profile"} / ${status.mathematicalCalibration?.calibrationVersion ?? "version recorded"} on ${status.mathematicalCalibration?.rigId ?? "the fixed rig"}.`
                  : status.mathematicalCalibration?.reason ?? "The bridge has not verified a finalized physical calibration profile."}
              </p>
              {status.mathematicalCalibration?.artifactSha256 ? <code>{status.mathematicalCalibration.artifactSha256}</code> : null}
              <p>{selectedGradingContract === "mathematical_calibration_v1" ? "Start New Card will require strict V0.3 Mathematical V1 output; V0 fallback is prohibited." : "Start New Card will use the explicitly selected Legacy V0 contract."}</p>
            </div>
            {selectedGradingContract === "mathematical_calibration_v1" ||
            status.gradingContract === "mathematical_calibration_v1" ? (
              <section className="mathematical-authority">
                <div className="capture-settings-head">
                  <div>
                    <p className="eyebrow">Pre-Capture Authority</p>
                    <h3>{mathematicalAuthorityBound ? "Exact V1 Authority Bound" : "Exact Card Identity Required"}</h3>
                  </div>
                  <strong>{mathematicalAuthorityBound ? "Immutable for this session" : "Before Capture Front"}</strong>
                </div>
                {status.mathematicalV1?.gradingAuthority ? (
                  <div className="mathematical-bound-summary">
                    <strong>{status.mathematicalV1.gradingAuthority.cardIdentity.title}</strong>
                    <span>
                      {status.mathematicalV1.gradingAuthority.cardIdentity.tenantId} /
                      {" "}{status.mathematicalV1.gradingAuthority.cardIdentity.setId} /
                      {" "}{status.mathematicalV1.gradingAuthority.cardIdentity.programId} /
                      {" "}{status.mathematicalV1.gradingAuthority.cardIdentity.cardNumber}
                    </span>
                    <small>
                      Front {formatStationValue(status.mathematicalV1.gradingAuthority.sides.front.centering.profile)} ·
                      {" "}Back {formatStationValue(status.mathematicalV1.gradingAuthority.sides.back.centering.profile)}
                    </small>
                  </div>
                ) : null}
                <div className="mathematical-identity-grid">
                  {([
                    ["title", "Card title"],
                    ["tenantId", "Tenant ID"],
                    ["setId", "Set ID"],
                    ["programId", "Program ID"],
                    ["cardNumber", "Card number"],
                    ["variantId", "Variant ID (optional)"],
                    ["parallelId", "Parallel ID (optional)"],
                  ] as const).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="text"
                        value={mathematicalAuthorityDraft[field]}
                        onChange={(event) => setMathematicalAuthorityDraft((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))}
                        disabled={mathematicalAuthorityBound || busy !== null}
                        required={!label.includes("optional")}
                      />
                    </label>
                  ))}
                </div>
                <div className="mathematical-profile-grid">
                  {(["front", "back"] as const).map((side) => (
                    <label key={side}>
                      {formatStationValue(side)} centering profile
                      <select
                        value={mathematicalAuthorityDraft.profiles[side]}
                        onChange={(event) => setMathematicalAuthorityDraft((current) => ({
                          ...current,
                          profiles: {
                            ...current.profiles,
                            [side]: event.target.value as AiGraderMathematicalCenteringProfileV1,
                          },
                        }))}
                        disabled={mathematicalAuthorityBound || busy !== null}
                      >
                        <option value="printed_border_v1">Printed border V1</option>
                        <option value="registered_design_template_v1">Approved registered template V1</option>
                      </select>
                    </label>
                  ))}
                </div>
                <p>
                  Registered-template sides resolve the active approved artifact for this exact identity,
                  download and SHA-256 verify its bytes, then stage those bytes to the paired session.
                  The browser never supplies a registration transform, confidence, local path, or publication URL.
                </p>
                <p className={`status-note ${mathematicalAuthorityStatus.status}`}>
                  {mathematicalAuthorityStatus.message}
                </p>
                {mathematicalAuthorityActionRequired ? (
                  <button
                    type="button"
                    onClick={() => void bindMathematicalAuthorityForActiveSession()}
                    disabled={busy !== null || !mathematicalAuthorityDraftComplete}
                  >
                    {busy === "mathematical-authority" ? "Binding Exact Authority" : "Bind / Stage Exact V1 Authority"}
                  </button>
                ) : null}
              </section>
            ) : null}
            <label>
              Throughput flow
              <select
                value={stationCaptureMode}
                onChange={(event) => void changeStationCaptureMode(event.target.value as StationCaptureMode)}
                disabled={!bridgeConnected || busy !== null || stationSettingsLocked}
              >
                <option value="single">Single card</option>
                <option value="rapid">Rapid Capture queue</option>
              </select>
            </label>
            <p>Capture Front and Capture Back remain explicit operator actions. Rapid Capture queues the completed card for one serialized background report worker; it does not add automatic or alternate capture.</p>
          </section>

          {stationCaptureMode === "rapid" || rapidQueueItems.length ? (
            <section className="rapid-queue">
              <div className="rapid-queue-head">
                <div>
                  <p className="eyebrow">Rapid Capture Queue</p>
                  <h3>{rapidQueueItems.length ? `${rapidQueueItems.length} recent card(s)` : "Queue Empty"}</h3>
                </div>
                <strong>{rapidQueueHasProcessing ? "Processing" : "Ready"}</strong>
              </div>
              <div className="rapid-queue-list">
                {rapidQueueItems.length ? rapidQueueItems.map((item) => {
                  const reviewable = RAPID_REVIEWABLE_STATES.has(item.state);
                  const active = item.queueItemId === status.rapidCaptureQueue.activeQueueItemId;
                  return (
                    <article key={item.queueItemId} className={active ? "active" : ""}>
                      <div>
                        <strong>{formatStationValue(
                          item.state === "report_ready_needs_confirm"
                            ? "ready for Approve & Publish"
                            : item.state === "finding_review_required"
                              ? "exact finding review required"
                              : item.state,
                        )}</strong>
                        <small>{item.reportId}</small>
                        {item.mathematicalV1?.reasons?.length ? (
                          <span>{item.mathematicalV1.reasons.join(" ")}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void activateRapidQueueItem(item.queueItemId)}
                        disabled={!reviewable || active || busy !== null || status.sessionManifest.frontCaptured || status.sessionManifest.backCaptured}
                      >
                        {active
                          ? "Active"
                          : item.state === "finding_review_required"
                            ? "Open Exact Finding Review"
                            : item.state === "insufficient_evidence"
                              ? "Open Insufficient Evidence"
                              : reviewable
                                ? "Open for Approve & Publish"
                                : "Processing"}
                      </button>
                    </article>
                  );
                }) : <p>Capture Back queues each completed card here while the next card can begin.</p>}
              </div>
            </section>
          ) : null}
          <section className={productionSignedIn ? "production-auth signed-in" : "production-auth"}>
            <div>
              <p className="eyebrow">Production Sign-In</p>
              <h3>{productionSignedIn ? "Signed In" : "Sign In Required"}</h3>
              <p>
                {productionSignedIn
                  ? `Production actions will run as ${productionOperatorLabel}.`
                  : productionAuthState.message}
              </p>
            </div>
            <button type="button" onClick={signInForProduction} disabled={sessionLoading || busy !== null || productionAuthState.status === "pending"}>
              {productionAuthState.status === "pending" ? "Opening Sign-In" : productionSignedIn ? "Refresh Sign-In" : "Sign In"}
            </button>
          </section>

          <section className="live-lighting">
            <div className="lighting-head">
              <div>
                <p className="eyebrow">Live Lighting</p>
                <h3>Leimac Ring</h3>
              </div>
              <button
                type="button"
                className={liveLightingPositioningVerified ? "toggle active" : "toggle"}
                onClick={() => setLiveLightingEnabled(!liveLightingPositioningVerified)}
                disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held || liveLightingRequestPending}
              >
                {liveLightingPositioningVerified ? "Live" : "Off"}
              </button>
            </div>
            <div className="lighting-status-grid">
              <div>
                <span>Applied</span>
                <strong>{liveLightingAppliedLabel}</strong>
              </div>
              <div>
                <span>Capture Profile</span>
                <strong>{status.acceptedProfile.source === "browser_live_tuning" ? "Live Accepted" : "Default"}</strong>
              </div>
              <div>
                <span>Latency</span>
                <strong>{formatMs(liveLighting.applied.lastApplyLatencyMs)}</strong>
              </div>
            </div>
            <div className="ring-control" aria-label="Leimac channels">
              {Array.from({ length: 8 }, (_, index) => index + 1).map((channel) => (
                <button
                  type="button"
                  key={channel}
                  className={liveLightingDraft.channels.includes(channel) ? `segment segment-${channel} active` : `segment segment-${channel}`}
                  onClick={() => toggleLiveLightingChannel(channel)}
                  disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held || liveLightingRequestPending}
                  aria-label={`Toggle Leimac channel ${channel}`}
                  title={`Channel ${channel}`}
                >
                  {channel}
                </button>
              ))}
            </div>
            <div className="mini-actions">
              <button type="button" onClick={() => setAllLiveLightingChannels([1, 2, 3, 4, 5, 6, 7, 8])} disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held || liveLightingRequestPending}>
                All On
              </button>
              <button type="button" onClick={() => setAllLiveLightingChannels([])} disabled={!bridgeConnected || busy !== null || liveLightingRequestPending}>
                All Off
              </button>
            </div>
            <label>
              Brightness %
              <input
                type="range"
                min="0"
              max="99.9"
                step="0.1"
                value={liveLightingDraft.dutyPercent}
                onChange={(event) => setLiveLightingDuty(Number(event.target.value))}
                disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held || liveLightingRequestPending}
              />
            </label>
            <div className="lighting-inputs">
              <label>
                Duty %
                <input
                  type="number"
                  min="0"
                  max="99.9"
                  step="0.1"
                  value={liveLightingDraft.dutyPercent}
                  onChange={(event) => setLiveLightingDuty(Number(event.target.value))}
                  disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held || liveLightingRequestPending}
                />
              </label>
              <label>
                Exposure us (bridge-held)
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1000"
                  value={profileDraft.exposureUs}
                  readOnly
                  disabled
                />
              </label>
            </div>
            <p className='status-note'>Every lighting change is bounded and accepted only after exact controller acknowledgement.</p>
            {liveLighting.lastError ? <p className="status-note">{liveLighting.lastError}</p> : null}
          </section>

          <section className="card-linkage">
            <p className="eyebrow">Card Identity</p>
            <h3>{selectedCard?.displayTitle ?? "Review before Approve & Publish"}</h3>
            <p className={identityStatus.status === "failed" ? "step-message failed" : "step-message"}>
              {identityStatus.status === "idle" ? selectedCard?.subtitle ?? cardSearchMessage : identityStatus.message}
            </p>
            {reportReady || ocrPrefillState.status !== "idle" ? (
              <div className={`ocr-prefill-status ${ocrPrefillState.status}`} role="status" aria-live="polite">
                <div className="ocr-prefill-heading">
                  <strong>OCR Prefill</strong>
                  <span>{ocrPrefillState.status === "running" ? "Working" : formatStationValue(ocrPrefillState.status)}</span>
                </div>
                <p>{ocrPrefillState.message}</p>
                {ocrPrefillState.status === "failed" && ocrPrefillState.failureLabel ? (
                  <small>{ocrPrefillState.failureLabel}</small>
                ) : null}
                {ocrPrefillState.status === "ready" ? (
                  <>
                    <div className="ocr-prefill-indicators" aria-label="OCR field confidence">
                      {ocrPrefillIndicators.map((indicator) => (
                        <span
                          key={indicator.fieldName}
                          className={indicator.reviewRequired ? "review" : ""}
                          title={`${indicator.label}: ${indicator.value}${indicator.reviewRequired ? " — review required" : ""}`}
                        >
                          {indicator.label} {indicator.confidencePercent}%
                        </span>
                      ))}
                      {ocrPrefillState.result?.reviewFieldNames.length ? (
                        <span className="review">Review {ocrPrefillState.result.reviewFieldNames.length}</span>
                      ) : null}
                    </div>
                    <small>The single Approve & Publish action remains the human authority.</small>
                  </>
                ) : null}
                {ocrPrefillState.status === "failed" ? (
                  <button type="button" onClick={retryOcrPrefill} disabled={!session?.token || busy !== null}>
                    Retry OCR
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="identity-grid">
              <label>
                Category
                <select value={identityDraft.category} onChange={(event) => updateIdentityDraft("category", event.target.value as IdentityDraftState["category"])}>
                  <option value="sport">Sport</option>
                  <option value="tcg">TCG</option>
                  <option value="comics">Comics</option>
                </select>
              </label>
              <label>
                {identityDraft.category === "sport" ? "Player / Name" : "Card Name"}
                <input
                  value={identityDraft.category === "sport" ? identityDraft.playerName : identityDraft.cardName}
                  onChange={(event) =>
                    identityDraft.category === "sport"
                      ? updateIdentityDraft("playerName", event.target.value)
                      : updateIdentityDraft("cardName", event.target.value)
                  }
                  placeholder={status.reportBundle?.cardIdentity.title ?? "Card identity"}
                />
              </label>
              <label>
                Year
                <input value={identityDraft.year} onChange={(event) => updateIdentityDraft("year", event.target.value)} placeholder="2020" />
              </label>
              <label>
                Manufacturer
                <input value={identityDraft.manufacturer} onChange={(event) => updateIdentityDraft("manufacturer", event.target.value)} placeholder="Panini, Topps" />
              </label>
              <label>
                {identityDraft.category === "tcg" ? "Game" : "Sport / Game"}
                <input
                  value={identityDraft.category === "tcg" ? identityDraft.game : identityDraft.sport}
                  onChange={(event) =>
                    identityDraft.category === "tcg"
                      ? updateIdentityDraft("game", event.target.value)
                      : updateIdentityDraft("sport", event.target.value)
                  }
                  placeholder={identityDraft.category === "tcg" ? "Pokemon" : "Basketball"}
                />
              </label>
              <label>
                Product Set
                <input value={identityDraft.productSet} onChange={(event) => updateIdentityDraft("productSet", event.target.value)} placeholder="Prizm, Select" />
              </label>
              <label>
                Card #
                <input value={identityDraft.cardNumber} onChange={(event) => updateIdentityDraft("cardNumber", event.target.value)} />
              </label>
              <label>
                Insert
                <input value={identityDraft.insert} onChange={(event) => updateIdentityDraft("insert", event.target.value)} />
              </label>
              <label>
                Parallel
                <input value={identityDraft.parallel} onChange={(event) => updateIdentityDraft("parallel", event.target.value)} />
              </label>
              <label>
                Numbered
                <input value={identityDraft.numbered} onChange={(event) => updateIdentityDraft("numbered", event.target.value)} placeholder="12/99" />
              </label>
            </div>
            <div className="check-row">
              <label><input type="checkbox" checked={identityDraft.autograph} onChange={(event) => updateIdentityDraft("autograph", event.target.checked)} /> Auto</label>
              <label><input type="checkbox" checked={identityDraft.memorabilia} onChange={(event) => updateIdentityDraft("memorabilia", event.target.checked)} /> Mem</label>
            </div>
            {!linkedCardReady && createCardBlockers.length ? <p className="status-note">Required before Approve & Publish: {createCardBlockers.join(", ")}.</p> : null}
            {!productionSignedIn && !linkedCardReady ? <p className="status-note">Production sign-in is required before Approve & Publish.</p> : null}
            {linkedCardReady ? <p className="status-note">CardAsset {selectedCard?.cardAssetId} / Item {selectedCard?.itemId}</p> : null}
            {confirmedDownstream.reportId ? (
              <div className="confirmed-downstream">
                <div>
                  <span>Label queue</span>
                  <strong>
                    {confirmedDownstream.labelSheet
                      ? `Sheet ${confirmedDownstream.labelSheet.sheetNumber} / Slot ${confirmedDownstream.labelSheet.slot}`
                      : "Assignment pending"}
                  </strong>
                </div>
                <div>
                  <span>eBay comps</span>
                  <strong>{formatStationValue(confirmedDownstream.comps.status)}</strong>
                  <small>{confirmedDownstream.comps.message}</small>
                </div>
              </div>
            ) : null}
            <label>
              Existing Card Search
              <input
                value={cardSearchQuery}
                onChange={(event) => setCardSearchQuery(event.target.value)}
                placeholder="Player, set, card number, item id"
              />
            </label>
            <div className="mini-actions">
              <button type="button" onClick={searchCardItems} disabled={busy !== null}>
                {busy === "card-search" ? "Searching" : "Search"}
              </button>
            </div>
            {cardSearchResults.length ? (
              <div className="card-results">
                {cardSearchResults.map((result) => (
                  <button
                    type="button"
                    key={`${result.source}:${result.cardAssetId ?? result.itemId ?? result.displayTitle}`}
                    onClick={() => {
                      setSelectedCard(result);
                      setCardSearchMessage("Existing Ten Kings card/item selected.");
                      setIdentityStatus({
                        status: "completed",
                        message: "Existing Ten Kings CardAsset/Item selected for this AI Grader report.",
                      });
                    }}
                  >
                    <strong>{result.displayTitle}</strong>
                    <span>{result.subtitle ?? result.source}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="status">
            <div>
              <span>Preview</span>
              <strong>{previewStatusLabel}</strong>
            </div>
            <div>
              <span>Report</span>
              <strong>{reportReady ? "Ready" : "Pending"}</strong>
            </div>
            <div>
              <span>{isAiGraderReportBundleV03(status.reportBundle) ? "Mathematical V1" : "Final V0"}</span>
              <strong>{finalReady ? "Computed" : "Pending"}</strong>
            </div>
            <div>
              <span>Bridge</span>
              <strong>{status.mode}</strong>
            </div>
            <p className="status-note">
              {previewStatus.frameCount ? `${previewStatus.frameCount} frame(s)` : "No frames yet"}
              {previewStatus.fps ? ` / ${previewStatus.fps} FPS` : ""} / camera {previewStatus.cameraOwnership}
            </p>
          </section>

          <section className="warm-runner">
            <div className="warm-head">
              <div>
                <p className="eyebrow">Warm Runner</p>
                <h3>Full Forensic Capture</h3>
              </div>
              <strong>{formatStationValue(warmRunner.status)}</strong>
            </div>
            <div className="warm-grid">
              <div>
                <span>Execution Path</span>
                <strong>Warm Runner</strong>
              </div>
              <div>
                <span>Front Geometry</span>
                <strong>{status.geometryCaptureDecisions.front?.mode === "detected_geometry" ? "Detected" : "Pending"}</strong>
              </div>
              <div>
                <span>Back Geometry</span>
                <strong>{status.geometryCaptureDecisions.back?.mode === "detected_geometry" ? "Detected" : "Pending"}</strong>
              </div>
              <div>
                <span>Capture Lock</span>
                <strong>{warmRunner.captureLock.held ? "Held" : "Idle"}</strong>
              </div>
              <div>
                <span>Capture Queue</span>
                <strong>{queueSummary(warmRunner.queues.capture)}</strong>
              </div>
              <div>
                <span>Processing</span>
                <strong>{queueSummary(warmRunner.queues.processing)}</strong>
              </div>
              <div>
                <span>Report Queue</span>
                <strong>{queueSummary(warmRunner.queues.report)}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>{formatMs(warmRunner.timing.targetTotalMinMs)}-{formatMs(warmRunner.timing.targetTotalMaxMs)}</strong>
              </div>
            </div>
            {status.captureFailure ? (
              <p className="status-note failed">
                {status.captureFailure.side} warm {status.captureFailure.stage === "warm_processing" ? "processing" : "capture"} failed: {status.captureFailure.message} The bridge ran fatal cleanup; select Start New Card for a clean card session.
              </p>
            ) : null}
            <div className="evidence-side">
              <div>
                <span>Front Evidence</span>
                <strong>{warmEvidenceCounts.front}/{warmEvidenceCounts.total}</strong>
              </div>
              <div className="role-strip">
                {warmRunner.evidencePlan.rolesBySide.front.map((role) => (
                  <span key={role.role} className={`role ${role.status}`}>{roleLabel(role.role)}</span>
                ))}
              </div>
            </div>
            <div className="evidence-side">
              <div>
                <span>Back Evidence</span>
                <strong>{warmEvidenceCounts.back}/{warmEvidenceCounts.total}</strong>
              </div>
              <div className="role-strip">
                {warmRunner.evidencePlan.rolesBySide.back.map((role) => (
                  <span key={role.role} className={`role ${role.status}`}>{roleLabel(role.role)}</span>
                ))}
              </div>
            </div>
            <div className="phase-list">
              {latestWarmPhases.length ? (
                latestWarmPhases.map((phase) => (
                  <div key={phase.id}>
                    <span>{formatStationValue(phase.status)}</span>
                    <strong>{phase.label}</strong>
                    <em>{formatMs(phase.durationMs)}</em>
                  </div>
                ))
              ) : (
                <div>
                  <span>Pending</span>
                  <strong>Warm session setup</strong>
                  <em>{formatMs(status.timingSummary?.phaseBreakdown?.warmSessionSetupMs)}</em>
                </div>
              )}
            </div>
          </section>

          <section className="operator-workflow">
            <p className="eyebrow">Operator Workflow</p>
            <h3>{productionPublish.status === "published" ? "Published Outputs Ready" : "Approve & Publish"}</h3>
            <p>{publishReadiness.message}</p>
            <div className="action-row">
              <button type="button" onClick={() => void openReport()} disabled={!reportReady || busy !== null}>
                {busy === "open-report" ? "Opening Report" : "Review Report"}
              </button>
              <button type="button" className="primary" onClick={() => void approveAndPublish()} disabled={!canApproveAndPublish || busy !== null}>
                {busy === "approve-and-publish" ? "Approving & Publishing" : "Approve & Publish"}
              </button>
              {productionPublish.status === "published" && publicReportUrl ? (
                <a href={publicReportUrl} target="_blank" rel="noreferrer">View Public Report</a>
              ) : null}
              {productionPublished ? <Link href="/ai-grader/labels/sheets">Open Label Sheets</Link> : null}
              {productionPublished ? (
                <>
                  <button type="button" className="primary" onClick={startNewCard} disabled={busy !== null || mathematicalStartBlocked}>
                    {busy === "start" ? "Starting" : "Start Next Grade"}
                  </button>
                  <Link href="/ai-grader/finish">Finish Cards</Link>
                </>
              ) : null}
              <button type="button" onClick={openHistory}>
                Card History Reports
              </button>
            </div>
            {!canApproveAndPublish && productionPublish.status !== "published" ? (
              <div className="readiness-warning">
                <strong>Publish not ready</strong>
                <p>{publishReadiness.message}</p>
                {publishReadiness.failedGates.length ? (
                  <ul>
                    {publishReadiness.failedGates.map((gate) => (
                      <li key={gate.id}>{gate.label}: {gate.reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="production-status">
            <p className="eyebrow">Public Report / Label</p>
            <div>
              <span>Publication</span>
              <strong>{publicationStatusLabel}</strong>
            </div>
            <div>
              <span>Report ID</span>
              <strong>{reportIdForLinks ?? "pending"}</strong>
            </div>
            <div>
              <span>Cert / Report ID</span>
              <strong>{certId ?? "pending"}</strong>
            </div>
            <div>
              <span>Storage upload</span>
              <strong>{productionPublish.uploadedAssetCount ? `${productionPublish.uploadedAssetCount} assets` : productionPublish.status === "error" ? "Failed" : "Pending"}</strong>
            </div>
            <p>{productionPublish.message}</p>
            {publicReportUrl ? (
              <p className="link-line">
                <span>Public report</span>
                <a href={publicReportUrl} target="_blank" rel="noreferrer">{publicReportUrl}</a>
                <button type="button" onClick={() => void copyLink(publicReportUrl, "Public report URL")}>Copy</button>
              </p>
            ) : null}
            {labelPreviewUrl ? (
              <p className="link-line">
                <span>Label sheets</span>
                <a href={labelPreviewUrl}>{labelPreviewUrl}</a>
                <button type="button" onClick={() => void copyLink(labelPreviewUrl, "Label sheets URL")}>Copy</button>
              </p>
            ) : null}
            {qrPayloadUrl ? (
              <p className="link-line">
                <span>QR payload</span>
                <a href={qrPayloadUrl} target="_blank" rel="noreferrer">{qrPayloadUrl}</a>
                <button type="button" onClick={() => void copyLink(qrPayloadUrl, "QR payload URL")}>Copy</button>
              </p>
            ) : null}
            <p>Label: {labelReady ? "label data ready" : "pending"}</p>
            <p>Print action: managed by label sheet.</p>
            <p>Card linkage: {linkedCardReady ? selectedCard?.cardAssetId ?? selectedCard?.itemId : "not linked"}</p>
            <p>Finish queue: {productionPublished ? "available for slab photos and eBay evaluate" : "available after publish"}</p>
          </section>

          <section className="paths">
            <p>Station URL: http://127.0.0.1:3020/ai-grader/station</p>
            <p>Bridge: {bridgeUrl}</p>
            <p>Report path: {status.latestReport.localHtmlPath ?? "pending"}</p>
            <p>Bundle: {status.outputs?.reportBundlePath ?? "pending"}</p>
            <p>Production release: {status.outputs?.productionReleasePath ?? "pending"}</p>
            <p>Label data: {status.outputs?.labelDataPath ?? (labelReady ? "ready" : "pending")}</p>
          </section>

          <section className="timing">
            <p className="eyebrow">Timing</p>
            <dl>
              <dt>Capture profile</dt>
              <dd>{formatStationValue(status.captureTiming.captureProfile)}</dd>
              <dt>Front total</dt>
              <dd>{formatMs(captureTimingSummary.totalFrontMs)}</dd>
              <dt>Back total</dt>
              <dd>{formatMs(captureTimingSummary.totalBackMs)}</dd>
              <dt>Preview ready</dt>
              <dd>{formatMs(captureTimingSummary.previewReadyMs)}</dd>
              <dt>Front edge ready</dt>
              <dd>{formatMs(captureTimingSummary.frontEdgeDetectionReadyMs)}</dd>
              <dt>Back edge ready</dt>
              <dd>{formatMs(captureTimingSummary.backEdgeDetectionReadyMs)}</dd>
              <dt>Front positioning</dt>
              <dd>{formatMs(captureTimingSummary.frontPositioningMs)}</dd>
              <dt>Back positioning</dt>
              <dd>{formatMs(captureTimingSummary.backPositioningMs)}</dd>
              <dt>Total card</dt>
              <dd>{formatMs(captureTimingSummary.totalCardMs)}</dd>
              <dt>Report-ready total</dt>
              <dd>{formatMs(captureTimingSummary.reportReadyTotalMs)}</dd>
              <dt>Front during flip</dt>
              <dd>
                {formatMs(captureTimingSummary.frontProcessingDuringFlipMs)}
                {captureTimingSummary.frontProcessingOverlappedFlip ? " overlap" : ""}
              </dd>
              <dt>Lighting/profile</dt>
              <dd>{formatMs(captureTimingPhaseTotal("lighting_profile"))}</dd>
              <dt>Frame capture</dt>
              <dd>{formatMs(captureTimingPhaseTotal("frame_capture"))}</dd>
              <dt>File writes</dt>
              <dd>{formatMs(captureTimingPhaseTotal("file_writes"))}</dd>
              <dt>File hashes</dt>
              <dd>{formatMs(captureTimingPhaseTotal("file_hashes"))}</dd>
              <dt>Crop / deskew</dt>
              <dd>{formatMs(captureTimingPhaseTotal("crop_deskew"))}</dd>
              <dt>Forensic runner</dt>
              <dd>{formatMs(captureTimingPhaseTotal("grading_forensic_runner"))}</dd>
              <dt>Side processing</dt>
              <dd>{formatMs(captureTimingPhaseTotal("side_processing"))}</dd>
              <dt>Report phase</dt>
              <dd>{formatMs(captureTimingPhaseTotal("report_generation"))}</dd>
              <dt>Capture commands</dt>
              <dd>{formatMs(status.timingSummary?.captureCommandMs)}</dd>
              <dt>Report generation</dt>
              <dd>{formatMs(status.timingSummary?.reportGenerationMs)}</dd>
              <dt>Safe off</dt>
              <dd>{formatMs(status.timingSummary?.safeOffMs)}</dd>
              <dt>Front package</dt>
              <dd>{formatMs(status.timingSummary?.phaseBreakdown?.frontPackageMs)}</dd>
              <dt>Back package</dt>
              <dd>{formatMs(status.timingSummary?.phaseBreakdown?.backPackageMs)}</dd>
              <dt>Warm setup</dt>
              <dd>{formatMs(status.timingSummary?.phaseBreakdown?.warmSessionSetupMs)}</dd>
              <dt>Front processing</dt>
              <dd>{formatMs(status.timingSummary?.phaseBreakdown?.frontProcessingQueuedMs)}</dd>
              <dt>Back processing</dt>
              <dd>{formatMs(status.timingSummary?.phaseBreakdown?.backProcessingQueuedMs)}</dd>
              <dt>Report queue</dt>
              <dd>{formatMs(status.timingSummary?.phaseBreakdown?.reportQueueMs)}</dd>
              <dt>Detailed fields</dt>
              <dd>{status.timingSummary?.detailedEntries?.length ?? 0}</dd>
            </dl>
            <p className={status.captureTiming.target.fiveSecondsPerSideProven ? "timing-target proven" : "timing-target"}>
              5 s/side: {status.captureTiming.target.fiveSecondsPerSideProven ? "hardware proven" : "not proven"}. {status.captureTiming.target.note}
            </p>
          </section>
        </aside>

        <section className={historyOpen ? "history open" : "history"} aria-label="AI Grader report history">
          <button type="button" className="close-history" onClick={() => setHistoryOpen(false)} aria-label="Close report history">
            X
          </button>
          <div className="history-head">
            <div>
              <p className="eyebrow">Card History Reports</p>
              <h2>Local AI Grader sessions</h2>
            </div>
            <div className="history-controls">
              <select value={historySort} onChange={(event) => setHistorySort(event.target.value as HistorySort)}>
                <option value="most_recent">Most recent</option>
                <option value="oldest">Oldest</option>
                <option value="grade">Grade</option>
                <option value="category">Category</option>
              </select>
              <button type="button" onClick={() => setHistoryView(historyView === "list" ? "tiles" : "list")}>
                {historyView === "list" ? "Tile View" : "List View"}
              </button>
            </div>
          </div>

          <div className="history-stats">
            <article><span>All Time</span><strong>{history.stats.allTime}</strong></article>
            <article><span>Month</span><strong>{history.stats.monthly}</strong></article>
            <article><span>Week</span><strong>{history.stats.weekly}</strong></article>
            <article><span>Today</span><strong>{history.stats.daily}</strong></article>
            <article><span>Avg Final</span><strong>{history.stats.averageFinalGrade ?? history.stats.averageProvisionalGrade ?? "n/a"}</strong></article>
            <article><span>Finalized</span><strong>{history.stats.finalizedCount ?? 0}</strong></article>
          </div>

          <div className={historyView === "tiles" ? "history-list tiles" : "history-list"}>
            {sortedHistory.map((item) => (
              <article key={item.reportId}>
                <div>
                  <span>{item.generatedAt ? new Date(item.generatedAt).toLocaleString() : "Unknown date"}</span>
                  <strong>{item.title ?? item.reportId}</strong>
                  <p>{item.localHtmlPath ?? item.reportBundlePath ?? "Local report path pending."}</p>
                </div>
                <div className="history-grade">
                  <span>{item.finalOverallGrade ? "Final grade" : "Provisional"}</span>
                  <strong>{item.finalOverallGrade ?? item.provisionalOverallGrade ?? "Pending"}</strong>
                </div>
                <button type="button" onClick={() => void openHistoryReport(item.reportId)} disabled={busy !== null}>
                  Open
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      <style jsx>{`
        .station {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          background: #0b0c0b;
          color: #f6f1e7;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow: hidden;
        }
        .viewer {
          position: relative;
          min-height: 100vh;
          background:
            linear-gradient(180deg, rgba(8, 12, 9, 0.35), rgba(8, 8, 7, 0.88)),
            radial-gradient(circle at center, rgba(76, 91, 70, 0.32), transparent 58%),
            #121311;
          padding: 28px;
        }
        .local-report {
          position: absolute;
          inset: 28px;
          z-index: 9;
          display: flex;
          flex-direction: column;
          gap: 16px;
          border: 1px solid rgba(225, 205, 155, 0.28);
          border-radius: 8px;
          background: rgba(12, 14, 13, 0.96);
          box-shadow: 0 22px 80px rgba(0, 0, 0, 0.42);
          padding: 18px;
          overflow: auto;
        }
        .local-report-head {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          position: sticky;
          top: 0;
          z-index: 2;
          background: rgba(12, 14, 13, 0.96);
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(225, 205, 155, 0.18);
        }
        .local-report-head h2 {
          margin: 0 0 6px;
          font-size: 22px;
        }
        .local-report-head p {
          color: #d5c8a7;
        }
        .close-report {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          padding: 0;
        }
        .report-loading,
        .report-error {
          border: 1px solid rgba(225, 205, 155, 0.2);
          border-radius: 8px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.06);
          color: #f4e9c8;
        }
        .report-error {
          border-color: rgba(224, 109, 91, 0.38);
          color: #ffcdc4;
        }
        .report-hero {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) minmax(220px, 0.8fr);
          gap: 14px;
          align-items: stretch;
        }
        .report-hero figure,
        .report-grid figure {
          margin: 0;
          border: 1px solid rgba(225, 205, 155, 0.18);
          border-radius: 8px;
          background: #171916;
          overflow: hidden;
        }
        .report-hero img,
        .report-grid img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #060706;
        }
        .report-hero img {
          max-height: 340px;
        }
        .report-hero figcaption,
        .report-grid figcaption {
          padding: 8px 10px;
          color: #d5c8a7;
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .report-facts {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
          align-content: start;
          border: 1px solid rgba(225, 205, 155, 0.18);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.05);
          padding: 14px;
        }
        .report-facts span {
          color: #a89976;
          font-size: 11px;
          text-transform: uppercase;
          font-weight: 800;
        }
        .report-facts strong {
          color: #f7f0dc;
          overflow-wrap: anywhere;
        }
        .report-section,
        .report-section-grid section {
          border: 1px solid rgba(225, 205, 155, 0.18);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.05);
          padding: 14px;
        }
        .report-section h3,
        .report-section-grid h3 {
          margin: 0 0 8px;
          font-size: 18px;
        }
        .report-section p,
        .report-section-grid p,
        .report-section dd,
        .report-section-grid dd,
        .warning-list {
          color: #d5c8a7;
          line-height: 1.5;
        }
        .report-section-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .report-section dl,
        .report-section-grid dl {
          display: grid;
          grid-template-columns: 130px minmax(0, 1fr);
          gap: 7px 10px;
          margin: 12px 0 0;
          font-size: 12px;
        }
        .report-section dt,
        .report-section-grid dt {
          color: #a89976;
          font-weight: 900;
          text-transform: uppercase;
        }
        .report-section dd,
        .report-section-grid dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
        .element-mini-grid,
        .gate-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 10px;
        }
        .element-mini-grid article,
        .gate-grid article,
        .compact-finding {
          border: 1px solid rgba(225, 205, 155, 0.14);
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.16);
          padding: 12px;
        }
        .element-mini-grid span,
        .gate-grid span {
          color: #a89976;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
        }
        .element-mini-grid strong {
          display: block;
          margin: 6px 0;
          color: #f7f0dc;
          font-size: 28px;
        }
        .gate-grid article.pass {
          border-color: rgba(91, 255, 157, 0.3);
        }
        .gate-grid article.fail {
          border-color: rgba(224, 109, 91, 0.42);
        }
        .gate-grid article.accepted_warning {
          border-color: rgba(240, 191, 96, 0.42);
        }
        .warning-list {
          margin: 0;
          padding-left: 18px;
        }
        .report-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }
        .report-grid img {
          aspect-ratio: 1 / 1;
        }
        .camera-frame {
          position: relative;
          height: calc(100vh - 56px);
          min-height: 640px;
          border: 1px solid rgba(225, 205, 155, 0.24);
          background:
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(0deg, rgba(255,255,255,0.035) 1px, transparent 1px),
            #171916;
          background-size: 64px 64px;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.46);
        }
        .preview-image,
        .preview-placeholder {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .preview-image {
          object-fit: contain;
          background: #050605;
        }
        .preview-placeholder {
          display: grid;
          place-items: center;
          color: rgba(247, 239, 225, 0.76);
          background:
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(0deg, rgba(255,255,255,0.035) 1px, transparent 1px),
            #171916;
          background-size: 64px 64px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .report-overlay-stage {
          position: absolute;
          z-index: 2;
          inset: 0;
          pointer-events: none;
        }
        .report-framing-overlay {
          display: block;
          width: 100%;
          height: 100%;
          opacity: 0.78;
          mix-blend-mode: screen;
          filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.72));
          transition: opacity 120ms ease, filter 120ms ease;
        }
        .report-framing-overlay.geometry-dominant {
          opacity: 0.16;
          filter: none;
        }
        .report-framing-overlay.geometry-dominant .report-overlay-centerline,
        .report-framing-overlay.geometry-dominant .report-overlay-roi {
          opacity: 0;
        }
        .report-framing-overlay.geometry-dominant .report-overlay-card-template {
          stroke-width: 3;
          stroke-dasharray: 14 18;
        }
        .card-geometry-overlay {
          position: absolute;
          inset: 0;
          display: block;
          width: 100%;
          height: 100%;
          overflow: visible;
          filter: drop-shadow(0 0 5px rgba(0, 0, 0, 0.85));
        }
        .card-geometry-overlay polygon {
          fill: rgba(255, 183, 0, 0.05);
          stroke: #ffb700;
          stroke-width: 4;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
        }
        .card-geometry-overlay .card-geometry-corner-bracket,
        .card-geometry-overlay .card-geometry-center-axis {
          fill: none;
          stroke: #ffb700;
          stroke-linecap: round;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
        }
        .card-geometry-overlay .card-geometry-corner-bracket {
          stroke-width: 9;
        }
        .card-geometry-overlay .card-geometry-center-axis {
          stroke-width: 3;
        }
        .card-geometry-overlay .card-geometry-edge-midpoint,
        .card-geometry-overlay .card-geometry-center-point {
          fill: #ffb700;
          stroke: #111;
          stroke-width: 2;
          vector-effect: non-scaling-stroke;
        }
        .card-geometry-overlay.ready polygon {
          fill: rgba(34, 197, 94, 0.08);
          stroke: #22c55e;
        }
        .card-geometry-overlay.ready .card-geometry-corner-bracket,
        .card-geometry-overlay.ready .card-geometry-center-axis {
          stroke: #22c55e;
        }
        .card-geometry-overlay.ready .card-geometry-edge-midpoint,
        .card-geometry-overlay.ready .card-geometry-center-point {
          fill: #22c55e;
        }
        .card-geometry-badge {
          position: absolute;
          z-index: 4;
          top: 22px;
          left: 50%;
          transform: translateX(-50%);
          min-width: 118px;
          padding: 9px 15px;
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 999px;
          color: #f7efe1;
          background: rgba(68, 73, 69, 0.92);
          box-shadow: 0 5px 20px rgba(0, 0, 0, 0.34);
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-align: center;
          text-transform: uppercase;
          pointer-events: none;
        }
        .card-geometry-badge.adjust_card {
          color: #17120a;
          background: rgba(255, 183, 0, 0.96);
        }
        .card-geometry-badge.ready {
          color: #fff;
          background: rgba(22, 130, 65, 0.96);
          border-color: rgba(119, 255, 166, 0.72);
        }
        .report-overlay-frame-border,
        .report-overlay-card-template,
        .report-overlay-roi {
          fill: none;
        }
        .report-overlay-frame-border {
          stroke: rgba(255, 255, 255, 0.82);
          stroke-width: 2;
        }
        .report-overlay-card-template {
          stroke: #ffd400;
          stroke-width: 6;
        }
        .report-overlay-centerline {
          stroke: #00e5ff;
          stroke-width: 3;
          stroke-dasharray: 18 16;
        }
        .report-overlay-roi {
          stroke-width: 3;
        }
        .report-overlay-roi.corner {
          stroke: #ff7a00;
        }
        .report-overlay-roi.edge {
          stroke: #ff4fd8;
        }
        .report-overlay-roi.surface {
          stroke: #8cff00;
        }
        .camera-status {
          position: absolute;
          z-index: 3;
          left: 26px;
          bottom: 24px;
          max-width: 520px;
          color: #d8d2c4;
        }
        .camera-status span,
        .eyebrow {
          color: #c9a85f;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .camera-status strong {
          display: block;
          margin-top: 8px;
          font-size: 34px;
          letter-spacing: 0;
        }
        .camera-status p {
          margin: 8px 0 0;
          color: #bbb4a8;
          line-height: 1.5;
        }
        .connect-scrim,
        .flip-scrim {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 24px;
          backdrop-filter: blur(8px);
          background: rgba(5, 6, 5, 0.58);
          z-index: 5;
        }
        .connect-scrim > div,
        .flip-scrim > div {
          width: min(520px, 92vw);
          border: 1px solid rgba(238, 211, 146, 0.32);
          background: rgba(14, 15, 13, 0.92);
          border-radius: 8px;
          padding: 24px;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.35);
        }
        .flip-scrim {
          place-items: end start;
          background: linear-gradient(0deg, rgba(5, 6, 5, 0.72), transparent 55%);
          backdrop-filter: none;
          pointer-events: none;
        }
        .flip-scrim > div {
          width: min(430px, 92vw);
          pointer-events: auto;
        }
        h1,
        h2,
        p {
          margin: 0;
          letter-spacing: 0;
        }
        h1 {
          font-size: 38px;
          line-height: 1.05;
        }
        h2 {
          font-size: 24px;
        }
        .connect-scrim p,
        .flip-scrim p {
          margin-top: 10px;
          color: #cfc7b8;
          line-height: 1.5;
        }
        label {
          display: block;
          margin-top: 14px;
          color: #ded6c8;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        input,
        select {
          width: 100%;
          box-sizing: border-box;
          margin-top: 7px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(0, 0, 0, 0.3);
          color: #f8f0e0;
          border-radius: 8px;
          padding: 11px 12px;
          font: inherit;
          letter-spacing: 0;
          text-transform: none;
        }
        button {
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          min-height: 44px;
          padding: 11px 14px;
          color: #f7efe1;
          background: rgba(255, 255, 255, 0.06);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .connect-scrim button,
        .flip-scrim button,
        .start-grading {
          width: 100%;
          margin-top: 16px;
          border-color: #5bff9d;
          background: #5bff9d;
          color: #06100a;
          box-shadow: 0 0 36px rgba(91, 255, 157, 0.22);
        }
        .connect-scrim .link-button {
          border-color: rgba(255, 255, 255, 0.18);
          background: transparent;
          color: #d7cebf;
          box-shadow: none;
        }
        .advanced-connect {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
        }
        .checkbox {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .checkbox input {
          width: auto;
          margin: 0;
        }
        .sidebar {
          height: 100vh;
          overflow-y: auto;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(16, 16, 14, 0.98);
          padding: 22px;
        }
        .brand {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 20px;
        }
        .brand button,
        .brand > a {
          min-height: 36px;
          padding: 8px 10px;
          white-space: nowrap;
        }
        .brand > a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 6px;
          color: #f8f5ec;
          font-size: 12px;
          font-weight: 800;
          text-decoration: none;
        }
        .brand span {
          color: #c9a85f;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.18em;
        }
        .brand strong {
          font-size: 22px;
        }
        .error {
          border: 1px solid rgba(255, 82, 82, 0.34);
          background: rgba(95, 12, 18, 0.34);
          color: #ffd6d6;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 14px;
          line-height: 1.4;
        }
        .next-card,
        .capture-settings,
        .rapid-queue,
        .production-auth,
        .profile,
        .live-lighting,
        .card-linkage,
        .status,
        .warm-runner,
        .operator-workflow,
        .production-status,
        .slabbed-photos,
        .paths,
        .timing {
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.045);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 14px;
        }
        .next-card p {
          margin-top: 8px;
          color: #bdb5a8;
          line-height: 1.45;
        }
        .geometry-action-status {
          margin-top: 10px;
          border-left: 3px solid #7d827e;
          border-radius: 4px;
          padding: 8px 10px;
          color: #d5d8d5;
          background: rgba(255, 255, 255, 0.045);
          font-size: 12px;
          line-height: 1.4;
        }
        .geometry-action-status.adjust_card {
          border-left-color: #ffb700;
          color: #ffe2a0;
          background: rgba(255, 183, 0, 0.09);
        }
        .geometry-action-status.ready {
          border-left-color: #22c55e;
          color: #bfffd2;
          background: rgba(34, 197, 94, 0.1);
        }
        .capture-settings-head,
        .rapid-queue-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        .capture-settings-head h3,
        .rapid-queue-head h3 {
          margin: 4px 0 0;
          font-size: 16px;
        }
        .capture-settings-head > strong,
        .rapid-queue-head > strong {
          color: #f3db92;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .capture-settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .capture-settings-grid label {
          margin-top: 10px;
        }
        .grading-contract-readiness {
          margin-top: 10px;
          border-left: 3px solid #ffb700;
          border-radius: 4px;
          padding: 9px 10px;
          background: rgba(255, 183, 0, 0.09);
        }
        .grading-contract-readiness.ready {
          border-left-color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
        }
        .grading-contract-readiness strong {
          display: block;
          color: #fff;
          font-size: 12px;
        }
        .grading-contract-readiness code {
          display: block;
          margin-top: 8px;
          color: #d8d0c4;
          font-size: 9px;
          overflow-wrap: anywhere;
        }
        .capture-settings p,
        .capture-settings small,
        .rapid-queue p {
          display: block;
          margin: 9px 0 0;
          color: #bdb5a8;
          font-size: 10px;
          line-height: 1.45;
        }
        .rapid-queue-list {
          display: grid;
          gap: 7px;
          margin-top: 10px;
        }
        .rapid-queue-list article {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
        }
        .rapid-queue-list article.active {
          border-color: rgba(91, 255, 157, 0.35);
          background: rgba(91, 255, 157, 0.07);
        }
        .rapid-queue-list article > div {
          display: grid;
          min-width: 0;
          gap: 2px;
        }
        .rapid-queue-list small,
        .rapid-queue-list span {
          overflow: hidden;
          color: #aaa69b;
          font-size: 9px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rapid-queue-list button {
          min-height: 32px;
          padding: 6px 8px;
          font-size: 9px;
        }
        .production-auth {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
        }
        .production-auth h3 {
          margin: 4px 0 0;
          font-size: 16px;
        }
        .production-auth p {
          margin: 8px 0 0;
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .production-auth button {
          min-width: 112px;
        }
        .production-auth.signed-in {
          border-color: rgba(91, 255, 157, 0.28);
          background: rgba(91, 255, 157, 0.07);
        }
        .pipeline-steps {
          display: grid;
          gap: 6px;
          margin: 12px 0 4px;
          padding: 0;
          list-style: none;
        }
        .pipeline-steps li {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          min-height: 32px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.04);
        }
        .pipeline-steps li.active {
          border-color: rgba(228, 191, 105, 0.54);
          background: rgba(228, 191, 105, 0.1);
        }
        .pipeline-steps li.done {
          border-color: rgba(91, 255, 157, 0.28);
          background: rgba(91, 255, 157, 0.08);
        }
        .pipeline-steps span {
          color: #9d9688;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .pipeline-steps strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }
        .primary {
          width: 100%;
          margin-top: 14px;
          border-color: rgba(228, 191, 105, 0.7);
          color: #f7e4b4;
        }
        .profile {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .profile label {
          grid-column: span 3;
          margin-top: 0;
        }
        .live-lighting {
          display: grid;
          gap: 12px;
        }
        .lighting-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .lighting-head h3 {
          margin: 4px 0 0;
          font-size: 16px;
        }
        .toggle {
          min-width: 74px;
          min-height: 38px;
        }
        .toggle.active,
        .accept-lighting {
          border-color: rgba(91, 255, 157, 0.72);
          background: rgba(91, 255, 157, 0.14);
          color: #caffe0;
        }
        .lighting-status-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .lighting-status-grid span,
        .lighting-inputs span {
          display: block;
          color: #9d9688;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .lighting-status-grid strong {
          display: block;
          margin-top: 4px;
          font-size: 13px;
          overflow-wrap: anywhere;
        }
        .ring-control {
          position: relative;
          width: 158px;
          height: 158px;
          margin: 2px auto;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(228, 191, 105, 0.08) 0 34%, rgba(255, 255, 255, 0.04) 35% 100%);
        }
        .segment {
          position: absolute;
          width: 38px;
          height: 38px;
          min-height: 38px;
          padding: 0;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: rgba(255, 255, 255, 0.06);
          color: #cfc7b8;
          font-size: 12px;
          letter-spacing: 0;
        }
        .segment.active {
          border-color: rgba(91, 255, 157, 0.78);
          background: rgba(91, 255, 157, 0.18);
          color: #d8ffe6;
          box-shadow: 0 0 18px rgba(91, 255, 157, 0.18);
        }
        .segment-1 { left: 60px; top: 8px; }
        .segment-2 { right: 24px; top: 24px; }
        .segment-3 { right: 8px; top: 60px; }
        .segment-4 { right: 24px; bottom: 24px; }
        .segment-5 { left: 60px; bottom: 8px; }
        .segment-6 { left: 24px; bottom: 24px; }
        .segment-7 { left: 8px; top: 60px; }
        .segment-8 { left: 24px; top: 24px; }
        .lighting-inputs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .lighting-inputs label {
          margin-top: 0;
        }
        .live-lighting input[type="range"] {
          padding: 0;
          accent-color: #5bff9d;
        }
        .card-linkage h3 {
          margin: 6px 0;
          font-size: 17px;
        }
        .card-linkage p,
        .slabbed-photos p {
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .card-linkage .step-message.failed {
          border: 1px solid rgba(255, 82, 82, 0.3);
          border-radius: 8px;
          background: rgba(95, 12, 18, 0.26);
          color: #ffd6d6;
          padding: 8px;
        }
        .ocr-prefill-status {
          display: grid;
          gap: 7px;
          margin: 9px 0 11px;
          padding: 9px 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.04);
        }
        .ocr-prefill-status.ready {
          border-color: rgba(91, 255, 157, 0.3);
          background: rgba(91, 255, 157, 0.06);
        }
        .ocr-prefill-status.failed {
          border-color: rgba(255, 82, 82, 0.3);
          background: rgba(95, 12, 18, 0.2);
        }
        .ocr-prefill-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 12px;
        }
        .ocr-prefill-heading span {
          color: #aaa69b;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .ocr-prefill-status p {
          margin: 0;
        }
        .ocr-prefill-status small {
          color: #bdb5a8;
          font-size: 10px;
        }
        .ocr-prefill-status button {
          justify-self: start;
          min-height: 30px;
          padding: 5px 10px;
        }
        .ocr-prefill-indicators {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .ocr-prefill-indicators span {
          padding: 3px 6px;
          border: 1px solid rgba(91, 255, 157, 0.25);
          border-radius: 999px;
          color: #caffe0;
          background: rgba(91, 255, 157, 0.08);
          font-size: 9px;
          font-weight: 800;
        }
        .ocr-prefill-indicators span.review {
          border-color: rgba(255, 183, 0, 0.34);
          color: #ffe1a1;
          background: rgba(255, 183, 0, 0.09);
        }
        .confirmed-downstream {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin: 10px 0;
        }
        .confirmed-downstream > div {
          display: grid;
          gap: 3px;
          min-width: 0;
          padding: 9px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.04);
        }
        .confirmed-downstream span,
        .confirmed-downstream small {
          color: #aaa69b;
          font-size: 10px;
        }
        .confirmed-downstream strong {
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .identity-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .identity-grid label {
          margin-top: 0;
        }
        .identity-grid label:nth-child(2),
        .identity-grid label:nth-child(6) {
          grid-column: 1 / -1;
        }
        .identity-grid input,
        .identity-grid select {
          min-width: 0;
        }
        .check-row {
          display: flex;
          gap: 14px;
          align-items: center;
          margin-top: 10px;
          color: #d6cec0;
          font-size: 12px;
          font-weight: 800;
        }
        .check-row label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 0;
        }
        .check-row input {
          width: 16px;
          height: 16px;
          margin: 0;
        }
        .mini-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 10px;
        }
        .card-results {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }
        .card-results button {
          display: grid;
          gap: 3px;
          min-height: 0;
          text-align: left;
          letter-spacing: 0;
          text-transform: none;
        }
        .card-results span {
          color: #bdb5a8;
          font-size: 12px;
        }
        .profile span,
        .status span,
        .history-stats span {
          display: block;
          color: #9d9688;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .profile strong,
        .status strong,
        .history-stats strong {
          display: block;
          margin-top: 5px;
          font-size: 18px;
        }
        .status {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .status-note {
          grid-column: 1 / -1;
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .warm-runner {
          display: grid;
          gap: 12px;
        }
        .warm-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .warm-head h3 {
          margin: 4px 0 0;
          font-size: 16px;
        }
        .warm-head > strong {
          color: #f7e4b4;
          font-size: 13px;
          text-align: right;
          text-transform: uppercase;
        }
        .warm-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .warm-grid span,
        .evidence-side > div:first-child span,
        .phase-list span {
          display: block;
          color: #9d9688;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .warm-grid strong,
        .evidence-side strong {
          display: block;
          margin-top: 4px;
          font-size: 14px;
          overflow-wrap: anywhere;
        }
        .evidence-side {
          display: grid;
          gap: 8px;
        }
        .evidence-side > div:first-child {
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }
        .role-strip {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 5px;
        }
        .role {
          min-width: 0;
          min-height: 24px;
          border: 1px solid rgba(255, 255, 255, 0.13);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.05);
          color: #bdb5a8;
          display: grid;
          place-items: center;
          font-size: 10px;
          font-weight: 900;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .role.active {
          border-color: rgba(228, 191, 105, 0.76);
          background: rgba(228, 191, 105, 0.14);
          color: #f7e4b4;
        }
        .role.completed {
          border-color: rgba(87, 215, 132, 0.46);
          background: rgba(87, 215, 132, 0.12);
          color: #bff1cc;
        }
        .role.failed,
        .role.cancelled {
          border-color: rgba(255, 92, 92, 0.5);
          background: rgba(105, 19, 23, 0.28);
          color: #ffd7d7;
        }
        .phase-list {
          display: grid;
          gap: 6px;
        }
        .phase-list div {
          display: grid;
          grid-template-columns: 72px 1fr auto;
          gap: 8px;
          align-items: center;
          min-height: 28px;
          color: #dcd5ca;
          font-size: 12px;
        }
        .phase-list strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .phase-list em {
          color: #bdb5a8;
          font-style: normal;
        }
        .operator-workflow h3 {
          margin: 0 0 8px;
          font-size: 17px;
        }
        .operator-workflow p {
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.5;
        }
        .operator-workflow .action-row {
          margin-top: 12px;
        }
        .operator-workflow .action-row a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 42px;
          border: 1px solid rgba(225, 205, 155, 0.24);
          border-radius: 8px;
          padding: 10px 12px;
          color: #f3db92;
          text-decoration: none;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          overflow-wrap: anywhere;
        }
        .comps-select {
          display: grid;
          gap: 8px;
          margin-top: 12px;
        }
        .comps-select label {
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          margin: 0;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.04);
        }
        .comps-select input {
          width: 16px;
          height: 16px;
          margin: 0;
        }
        .comps-select span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #e4ddd2;
          font-size: 12px;
        }
        .comps-select strong {
          color: #f3db92;
          font-size: 12px;
        }
        .readiness-warning {
          margin-top: 12px;
          border: 1px solid rgba(240, 191, 96, 0.32);
          border-radius: 8px;
          background: rgba(240, 191, 96, 0.08);
          padding: 12px;
        }
        .readiness-warning strong {
          color: #f7e3aa;
        }
        .readiness-warning ul {
          margin: 8px 0 0;
          padding-left: 18px;
          color: #d5c8a7;
          font-size: 12px;
        }
        .production-status {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .production-status .eyebrow,
        .production-status p {
          grid-column: 1 / -1;
        }
        .production-status p {
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .production-status span {
          display: block;
          color: #9d9688;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .production-status strong {
          display: block;
          margin-top: 5px;
          font-size: 16px;
        }
        .production-status .link-line {
          display: grid;
          grid-template-columns: 82px minmax(0, 1fr) 70px;
          gap: 8px;
          align-items: center;
        }
        .production-status .link-line a {
          min-height: 34px;
          border: 1px solid rgba(225, 205, 155, 0.18);
          border-radius: 8px;
          padding: 8px;
          color: #f3db92;
          text-decoration: none;
          overflow-wrap: anywhere;
        }
        .production-status .link-line button {
          min-height: 34px;
          padding: 7px 8px;
          letter-spacing: 0.06em;
        }
        .action-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin-bottom: 12px;
        }
        .action-row button:first-child {
          border-color: #e1bd68;
          background: #e1bd68;
          color: #111;
        }
        .safe {
          width: 100%;
          border-color: rgba(255, 92, 92, 0.42);
          background: rgba(105, 19, 23, 0.36);
          color: #ffd7d7;
          margin-bottom: 14px;
        }
        .paths p {
          margin: 0 0 8px;
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .timing dl {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          margin: 0;
        }
        .timing dt {
          color: #a9a094;
        }
        .timing dd {
          margin: 0;
          font-weight: 800;
        }
        .timing-target {
          margin: 12px 0 0;
          color: #e5c16d;
          font-size: 10px;
          line-height: 1.4;
        }
        .timing-target.proven {
          color: #8fffb8;
        }
        .history {
          position: fixed;
          inset: 0;
          transform: translateX(100%);
          transition: transform 220ms ease;
          z-index: 10;
          background: #f4f0e8;
          color: #151411;
          padding: 26px;
          overflow-y: auto;
        }
        .history.open {
          transform: translateX(0);
        }
        .close-history {
          position: sticky;
          top: 0;
          z-index: 2;
          width: 44px;
          color: #151411;
          background: #fff;
          border-color: rgba(20, 20, 20, 0.14);
        }
        .history-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          max-width: 1240px;
          margin: 10px auto 20px;
        }
        .history-controls {
          display: flex;
          gap: 10px;
        }
        .history-controls select,
        .history-controls button {
          color: #151411;
          background: #fff;
          border-color: rgba(20, 20, 20, 0.14);
        }
        .history-stats,
        .history-list {
          max-width: 1240px;
          margin: 0 auto 18px;
        }
        .history-stats {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 12px;
        }
        .history-stats article,
        .history-list article {
          border: 1px solid rgba(20, 20, 20, 0.1);
          background: rgba(255, 255, 255, 0.78);
          border-radius: 8px;
          padding: 15px;
          box-shadow: 0 14px 48px rgba(39, 30, 12, 0.08);
        }
        .history-list {
          display: grid;
          gap: 10px;
        }
        .history-list.tiles {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .history-list article {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 110px 110px;
          gap: 12px;
          align-items: center;
        }
        .history-list.tiles article {
          grid-template-columns: 1fr;
          align-items: stretch;
        }
        .history-list span {
          color: #7a6b50;
          font-size: 12px;
        }
        .history-list strong {
          display: block;
          margin-top: 5px;
          overflow-wrap: anywhere;
        }
        .history-list p {
          margin-top: 7px;
          color: #5b554b;
          overflow-wrap: anywhere;
        }
        .history-list button {
          color: #111;
          background: #e0bd6c;
          border-color: #d4af58;
        }
        .history-grade {
          text-align: center;
        }
        .mathematical-authority {
          margin-top: 12px;
          padding: 12px;
          border: 1px solid rgba(224, 189, 108, 0.28);
          border-radius: 8px;
          background: rgba(224, 189, 108, 0.055);
        }
        .mathematical-identity-grid,
        .mathematical-profile-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }
        .mathematical-identity-grid label:first-child {
          grid-column: 1 / -1;
        }
        .mathematical-bound-summary {
          display: grid;
          gap: 4px;
          margin-top: 10px;
          padding: 9px;
          border-left: 3px solid #22c55e;
          background: rgba(34, 197, 94, 0.09);
          overflow-wrap: anywhere;
        }
        .mathematical-bound-summary span,
        .mathematical-bound-summary small {
          color: #d8d0c4;
          font-size: 10px;
        }
        .mathematical-review-shell {
          position: absolute;
          inset: 28px;
          z-index: 8;
          padding: 20px;
          border: 1px solid rgba(224, 189, 108, 0.34);
          border-radius: 8px;
          background: rgba(10, 12, 11, 0.98);
          overflow: auto;
          box-shadow: 0 22px 80px rgba(0, 0, 0, 0.48);
        }
        .mathematical-review-shell.insufficient {
          border-color: rgba(255, 183, 0, 0.5);
        }
        .mathematical-review-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(260px, 0.65fr);
          gap: 16px;
          align-items: start;
          position: sticky;
          top: -20px;
          z-index: 3;
          margin: -20px -20px 16px;
          padding: 20px;
          background: rgba(10, 12, 11, 0.98);
          border-bottom: 1px solid rgba(224, 189, 108, 0.22);
        }
        .mathematical-review-head h2 {
          margin: 4px 0;
        }
        .mathematical-review-head code {
          display: block;
          margin-top: 5px;
          font-size: 9px;
          overflow-wrap: anywhere;
          color: #e7d8af;
        }
        .mathematical-finding-list {
          display: grid;
          gap: 18px;
        }
        .mathematical-finding-review {
          padding: 16px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.035);
        }
        .mathematical-finding-review > header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }
        .mathematical-finding-review > header h3 {
          margin: 4px 0 0;
        }
        .mathematical-finding-review > header > strong {
          color: #ffd584;
          font-size: 24px;
        }
        .mathematical-review-true-view {
          position: relative;
          width: min(420px, 100%);
          margin: 14px auto;
          min-height: 120px;
          background: #050605;
        }
        .mathematical-review-true-view img {
          display: block;
          width: 100%;
          height: auto;
        }
        .mathematical-finding-box {
          position: absolute;
          border: 2px solid #ffbc30;
          background: rgba(255, 188, 48, 0.15);
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
          pointer-events: none;
        }
        .mathematical-directional-grid {
          display: grid;
          grid-template-columns: repeat(8, minmax(70px, 1fr));
          gap: 6px;
          overflow-x: auto;
        }
        .mathematical-mask-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(110px, 1fr));
          gap: 8px;
          margin-top: 8px;
        }
        .mathematical-directional-grid figure,
        .mathematical-mask-grid figure {
          margin: 0;
          background: #050605;
        }
        .mathematical-directional-grid img,
        .mathematical-mask-grid img {
          width: 100%;
          min-height: 72px;
          object-fit: contain;
        }
        .mathematical-directional-grid figcaption,
        .mathematical-mask-grid figcaption {
          padding: 5px;
          color: #d5c8a7;
          font-size: 9px;
          text-align: center;
        }
        .mathematical-measurements {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin: 12px 0;
        }
        .mathematical-measurements dl {
          margin: 0;
          padding: 9px;
          background: rgba(255, 255, 255, 0.045);
          overflow-wrap: anywhere;
        }
        .mathematical-measurements dt {
          color: #f3db92;
          font-size: 10px;
        }
        .mathematical-measurements dd {
          margin: 3px 0 8px;
          font-size: 11px;
          line-height: 1.45;
        }
        .mathematical-disposition {
          display: block;
          padding: 10px;
          border-left: 3px solid #e0bd6c;
          background: rgba(224, 189, 108, 0.08);
        }
        .mathematical-insufficient-flags {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin: 14px 0;
        }
        .mathematical-insufficient-flags span {
          padding: 9px;
          background: rgba(255, 183, 0, 0.09);
          border: 1px solid rgba(255, 183, 0, 0.24);
        }
        @media (max-width: 980px) {
          .station {
            grid-template-columns: 1fr;
            overflow: auto;
          }
          .viewer,
          .sidebar {
            min-height: auto;
            height: auto;
          }
          .camera-frame {
            min-height: 560px;
            height: 70vh;
          }
          .sidebar {
            border-left: 0;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
          }
          .history-head,
          .history-controls {
            display: grid;
            grid-template-columns: 1fr;
          }
          .history-stats,
          .history-list.tiles,
          .history-list article {
            grid-template-columns: 1fr;
          }
          .local-report {
            position: fixed;
            inset: 12px;
          }
          .local-report-head,
          .report-hero {
            grid-template-columns: 1fr;
          }
          .local-report-head {
            display: grid;
          }
          .mathematical-review-shell {
            position: fixed;
            inset: 12px;
          }
          .mathematical-review-head,
          .mathematical-identity-grid,
          .mathematical-profile-grid,
          .mathematical-mask-grid,
          .mathematical-measurements,
          .mathematical-insufficient-flags {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
