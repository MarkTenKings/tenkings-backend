import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  AI_GRADER_STATION_STEPS,
  buildAiGraderLocalStationStatus,
  buildSampleAiGraderReportHistory,
  type AiGraderWarmRunnerPhase,
  type AiGraderLocalReportHistory,
  type AiGraderLocalReportHistoryItem,
  type AiGraderLocalStationStatus,
  type AiGraderStationAction,
} from "../../lib/aiGraderLocalStation";
import {
  AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY,
  AI_GRADER_STATION_TOKEN_STORAGE_KEY,
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  acceptAiGraderLiveLightingProfile,
  applyAiGraderLiveLighting,
  callAiGraderStationBridge,
  fetchAiGraderLiveLightingStatus,
  fetchAiGraderStationBridgeHealth,
  fetchAiGraderStationPreviewStatus,
  fetchAiGraderStationReportAsset,
  fetchAiGraderStationReportBundle,
  fetchAiGraderStationReportHistory,
  heartbeatAiGraderLiveLighting,
  openAiGraderStationPreviewStream,
  pairAiGraderStationBridge,
  safeOffAiGraderLiveLighting,
  stopAiGraderStationPreview,
} from "../../lib/aiGraderStationBridgeClient";
import type { AiGraderReportBundle } from "../../lib/aiGraderReportBundle";
import { findReportImage, reportImageAssets } from "../../lib/aiGraderReportImages";
import {
  aiGraderOperatorStepCopy,
  buildAiGraderCompsReadiness,
  buildAiGraderPublishReadiness,
} from "../../lib/aiGraderOperatorWorkflow";

type HistorySort = "most_recent" | "oldest" | "grade" | "category";
type HistoryView = "list" | "tiles";
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
type BridgeConnectionState = "checking" | "connected" | "not_running" | "pairing_required" | "error";
type LocalReportState = {
  open: boolean;
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  reportId?: string;
  bundle?: AiGraderReportBundle;
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

function productionAssetManifest(bundle: AiGraderReportBundle | null) {
  return (bundle?.assets ?? [])
    .filter((asset) => {
      const haystack = `${asset.contentType ?? ""} ${asset.fileName ?? ""} ${asset.id ?? ""} ${asset.kind ?? ""}`.toLowerCase();
      return haystack.includes("image") || /\.(png|jpe?g|webp)$/i.test(asset.fileName ?? asset.id ?? "");
    })
    .map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      fileName: asset.fileName,
      contentType: asset.contentType,
      checksumSha256: asset.checksumSha256 ?? asset.sha256,
      byteSize: asset.byteSize,
      side: asset.side,
      required: true,
    }))
    .filter((asset) => typeof asset.checksumSha256 === "string" && /^[a-f0-9]{64}$/i.test(asset.checksumSha256) && typeof asset.byteSize === "number" && asset.byteSize > 0);
}

function sanitizeReportBundleForProduction(bundle: AiGraderReportBundle): AiGraderReportBundle {
  const sanitized = sanitizePublishJson(bundle) as AiGraderReportBundle;
  return {
    ...sanitized,
    assets: productionAssetManifest(bundle) as AiGraderReportBundle["assets"],
    publicAssets: (sanitized.publicAssets ?? []).map((asset) => sanitizePublishJson(asset)),
  };
}

function sanitizeProductionReleaseForProduction(release: AiGraderReportBundle["productionRelease"], bundle: AiGraderReportBundle, selectedCard: CardSelectionState | null) {
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
  });
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

export default function AiGraderStationPage() {
  const { ensureSession } = useSession();
  const [status, setStatus] = useState<AiGraderLocalStationStatus>(() => buildAiGraderLocalStationStatus({ action: "status" }));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  const [stationToken, setStationToken] = useState("");
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeConnectionState, setBridgeConnectionState] = useState<BridgeConnectionState>("checking");
  const [previewStatus, setPreviewStatus] = useState(status.previewStatus);
  const [previewFrameUrl, setPreviewFrameUrl] = useState<string | null>(null);
  const previewFrameUrlRef = useRef<string | null>(null);
  const [liveLighting, setLiveLighting] = useState(status.liveLighting);
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
  const [identityStatus, setIdentityStatus] = useState<StepState>({
    status: "idle",
    message: "Card identity has not been confirmed.",
  });
  const [slabUploads, setSlabUploads] = useState<SlabUploadState>({});
  const [compsState, setCompsState] = useState<CompsState>({
    status: "idle",
    message: "Comps have not been run.",
  });
  const [labelPrintState, setLabelPrintState] = useState<StepState>({
    status: "idle",
    message: "Label has not been marked printed.",
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
  const [profileDraft, setProfileDraft] = useState({
    dutyPercent: status.acceptedProfile.dutyPercent,
    exposureUs: status.acceptedProfile.exposureUs,
    gain: status.acceptedProfile.gain,
  });
  const [liveLightingDraft, setLiveLightingDraft] = useState({
    enabled: false,
    dutyPercent: status.acceptedProfile.dutyPercent,
    channels: status.acceptedProfile.channels,
  });

  const connectBridgeWithCredentials = async (targetBridgeUrl: string, targetStationToken: string) => {
    const next = await callAiGraderStationBridge({ baseUrl: targetBridgeUrl, stationToken: targetStationToken, action: "status" });
    window.localStorage.setItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY, targetBridgeUrl);
    window.localStorage.setItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY, targetStationToken);
    setBridgeUrl(targetBridgeUrl);
    setStationToken(targetStationToken);
    setStatus(next);
    setPreviewStatus(next.previewStatus);
    setLiveLighting(next.liveLighting);
    setBridgeConnected(true);
    setBridgeConnectionState("connected");
    setProfileDraft({
      dutyPercent: next.acceptedProfile.dutyPercent,
      exposureUs: next.acceptedProfile.exposureUs,
      gain: next.acceptedProfile.gain,
    });
    setLiveLightingDraft({
      enabled: next.liveLighting.profile.enabled,
      dutyPercent: next.liveLighting.profile.dutyPercent,
      channels: next.liveLighting.profile.channels,
    });
    setHistory(await fetchAiGraderStationReportHistory({ baseUrl: targetBridgeUrl, stationToken: targetStationToken }));
    return next;
  };

  useEffect(() => {
    setPreviewStatus(status.previewStatus);
    setLiveLighting(status.liveLighting);
  }, [status.previewStatus, status.liveLighting]);

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
      } catch {
        if (!cancelled) setBridgeConnectionState("not_running");
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
      if (previewFrameUrlRef.current) {
        window.URL.revokeObjectURL(previewFrameUrlRef.current);
        previewFrameUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!bridgeConnected || !stationToken.trim() || !liveLighting.applied.enabled) return;
    const timer = setInterval(() => {
      void heartbeatAiGraderLiveLighting({ baseUrl: bridgeUrl, stationToken }).then(setLiveLighting).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [bridgeConnected, bridgeUrl, liveLighting.applied.enabled, stationToken]);

  useEffect(() => {
    const handlePageExit = () => {
      if (!bridgeConnected || !stationToken.trim() || !liveLighting.applied.enabled) return;
      void safeOffAiGraderLiveLighting({
        baseUrl: bridgeUrl,
        stationToken,
        reason: "browser page closed or hidden",
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
    };
  }, [bridgeConnected, bridgeUrl, liveLighting.applied.enabled, stationToken]);

  useEffect(() => {
    const previewHeldForFullForensicRun = status.warmRunnerStatus.previewPolicy.holdActive === true;
    const previewSuspendedForStationAction =
      previewHeldForFullForensicRun ||
      busy === "start-grading" ||
      busy === "back" ||
      busy === "capture-front" ||
      busy === "capture-back" ||
      busy === "safe-off" ||
      status.warmRunnerStatus.captureLock.held ||
      status.warmRunnerStatus.status === "capturing";
    if (!bridgeConnected || !stationToken.trim()) {
      if (previewFrameUrlRef.current) {
        window.URL.revokeObjectURL(previewFrameUrlRef.current);
        previewFrameUrlRef.current = null;
      }
      setPreviewFrameUrl(null);
      return;
    }
    if (previewSuspendedForStationAction) {
      const holdReason = status.warmRunnerStatus.previewPolicy.holdReason;
      setPreviewStatus((currentStatus) => ({
        ...currentStatus,
        status: "paused_for_capture",
        cameraOwnership: status.warmRunnerStatus.captureLock.held || status.warmRunnerStatus.status === "capturing" ? "capture_action" : "released",
        lastStopReason: previewHeldForFullForensicRun
          ? holdReason ?? "Preview paused during full forensic capture and report generation."
          : "Preview suspended while station action is running.",
      }));
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const startPreview = async () => {
      try {
        const current = await fetchAiGraderStationPreviewStatus({ baseUrl: bridgeUrl, stationToken });
        if (cancelled) return;
        setPreviewStatus({ ...current, status: current.status === "live" ? "live" : "starting" });
        await openAiGraderStationPreviewStream(
          { baseUrl: bridgeUrl, stationToken },
          {
            signal: controller.signal,
            onOpen() {
              if (cancelled) return;
              setPreviewStatus((currentStatus) => ({
                ...currentStatus,
                status: "starting",
                implementationType: "mjpeg_fetch_stream",
              }));
            },
            onFrame(frame) {
              if (cancelled) return;
              const objectUrl = window.URL.createObjectURL(frame.blob);
              if (previewFrameUrlRef.current) window.URL.revokeObjectURL(previewFrameUrlRef.current);
              previewFrameUrlRef.current = objectUrl;
              setPreviewFrameUrl(objectUrl);
              setPreviewStatus((currentStatus) => ({
                ...currentStatus,
                status: "live",
                frameCount: frame.frameIndex ?? currentStatus.frameCount + 1,
                firstFrameAt: currentStatus.firstFrameAt ?? frame.capturedAt ?? new Date().toISOString(),
                lastFrameAt: frame.capturedAt ?? new Date().toISOString(),
                cameraOwnership: "preview_stream",
              }));
            },
            onError(streamError) {
              if (cancelled) return;
              setPreviewStatus((currentStatus) => ({
                ...currentStatus,
                status: "error",
                lastError: streamError.message,
                cameraOwnership: "released",
              }));
            },
          }
        );
      } catch (requestError) {
        if (cancelled || controller.signal.aborted) return;
        setPreviewStatus((currentStatus) => ({
          ...currentStatus,
          status: "error",
          lastError: requestError instanceof Error ? requestError.message : "AI Grader preview stream is unavailable.",
          cameraOwnership: "released",
        }));
      }
    };
    void startPreview();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    bridgeConnected,
    bridgeUrl,
    busy,
    stationToken,
    status.warmRunnerStatus.captureLock.held,
    status.warmRunnerStatus.previewPolicy.holdActive,
    status.warmRunnerStatus.previewPolicy.holdReason,
    status.warmRunnerStatus.status,
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
  const finalReady = status.safety.finalGradeComputed || Boolean(status.productionRelease?.finalGradeComputed);
  const labelReady = status.safety.labelGenerated || Boolean(status.outputs?.labelDataPath) || status.productionRelease?.label.status === "label_data_ready";
  const linkedCardReady = Boolean((selectedCard?.cardAssetId || selectedCard?.itemId) && selectedCard.source !== "manual_draft");
  const labelPrinted = labelPrintState.status === "completed";
  const slabbedPhotosReady = slabUploads.front?.status === "uploaded" && slabUploads.back?.status === "uploaded";
  const compsSaved = compsState.saved === true || compsState.status === "saved";
  const inventoryComplete = inventoryState.status === "completed";
  const publishReadiness = buildAiGraderPublishReadiness({
    bundle: status.reportBundle,
    productionRelease: status.productionRelease,
    published: productionPublish.status === "published",
  });
  const compsReadiness = buildAiGraderCompsReadiness({
    bundle: status.reportBundle,
    productionRelease: status.productionRelease,
    selectedCard,
  });
  const productionPublished = productionPublish.status === "published";
  const reportIdForLinks = productionPublish.reportId ?? publishReadiness.reportId ?? status.latestReport.reportId;
  const labelPreviewUrl = productionPublished ? productionPublish.labelPreviewUrl : undefined;
  const publicReportUrl = productionPublished ? productionPublish.publicReportUrl : undefined;
  const qrPayloadUrl = productionPublished ? productionPublish.qrPayloadUrl : undefined;
  const certId = productionPublish.certId ?? publishReadiness.certId;
  const identityDraftMissing = identityDraftMissingFields(identityDraft);
  const identityDraftComplete = identityDraftMissing.length === 0;
  const canCreateCardFromReport = finalReady && reportReady && identityDraftComplete && !linkedCardReady && identityStatus.status !== "pending";
  const canPublishToTenKings = linkedCardReady && publishReadiness.ready && productionPublish.status !== "published" && productionPublish.status !== "pending";
  const canSaveSelectedComps =
    productionPublished &&
    Array.isArray(compsState.compsRefs) &&
    (compsState.selectedIds?.length ?? 0) > 0 &&
    compsState.status === "completed";
  const canAddToInventory = productionPublished && labelPrinted && slabbedPhotosReady && compsSaved && linkedCardReady && inventoryState.status !== "completed";
  const pipelineSteps = [
    {
      id: "grade",
      label: "Grade",
      done: finalReady,
      action: finalReady ? "Final grade exists." : "Run capture and final grading.",
    },
    {
      id: "confirm",
      label: "Confirm Card",
      done: linkedCardReady,
      action: linkedCardReady ? "CardAsset and Item are linked." : "Confirm identity and create the Ten Kings card/item.",
    },
    {
      id: "publish",
      label: "Publish + Print Label",
      done: productionPublished && labelPrinted,
      action: productionPublished ? (labelPrinted ? "Public report and print action are complete." : "Print the label and mark it printed.") : "Publish to Ten Kings DB/storage.",
    },
    {
      id: "slab",
      label: "Mark Slabbed",
      done: slabbedPhotosReady,
      action: slabbedPhotosReady ? "Slabbed front/back photos are attached." : "Upload slabbed front and back photos.",
    },
    {
      id: "comps",
      label: "eBay Evaluate",
      done: compsSaved,
      action: compsSaved ? "Selected comps and valuation are saved." : "Run eBay comps, select matches, and save value.",
    },
    {
      id: "inventory",
      label: "Add To Inventory",
      done: inventoryComplete,
      action: inventoryComplete ? "Inventory-ready transition complete." : "Move the card into the inventory flow.",
    },
  ];
  const activePipelineStep = pipelineSteps.find((step) => !step.done) ?? pipelineSteps[pipelineSteps.length - 1];
  const publicationStatusLabel =
    productionPublish.status === "idle" ? formatStationValue(publishReadiness.status) : formatStationValue(productionPublish.status);
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
  const localReportReadiness = buildAiGraderPublishReadiness({
    bundle: localReport.bundle,
    productionRelease: localReport.bundle?.productionRelease,
  });
  const localReportRelease = localReport.bundle?.productionRelease;
  const localReportFinalGrade = localReportRelease?.finalGrade;
  const localReportStory = localReport.bundle?.provisionalGrade;
  const localReportGateRows = localReportRelease?.gates.length
    ? localReportRelease.gates.map((gate) => ({
        key: gate.id,
        status: gate.status,
        label: gate.label,
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
  const canUseBridge = bridgeConnected || contractPreviewEnabled;
  const warmRunner = status.warmRunnerStatus;
  const warmRunnerCapturing = warmRunner.status === "capturing" || warmRunner.captureLock.held || busy === "start-grading" || busy === "back";
  const liveLightingAvailable =
    bridgeConnected &&
    liveLighting.controlsEnabled &&
    previewStatus.status === "live" &&
    !warmRunner.captureLock.held &&
    warmRunner.status !== "capturing";
  const liveLightingCommandable =
    bridgeConnected &&
    liveLighting.controlsEnabled &&
    !warmRunner.captureLock.held &&
    warmRunner.status !== "capturing";
  const liveLightingAppliedLabel = liveLighting.applied.enabled
    ? `${liveLighting.applied.dutyPercent}% / PWM ${String(liveLighting.applied.actualLeimacPwmStep).padStart(4, "0")} / Ch ${liveLighting.applied.channels.join(", ")}`
    : "off";
  const warmEvidenceCounts = {
    front: warmRunner.evidencePlan.rolesBySide.front.filter((role) => role.status === "completed").length,
    back: warmRunner.evidencePlan.rolesBySide.back.filter((role) => role.status === "completed").length,
    total: warmRunner.evidencePlan.rolesBySide.front.length,
  };
  const latestWarmPhases = [...warmRunner.phases].slice(-4).reverse();

  const productionAuthHeaders = async (extra: Record<string, string> = {}) => {
    const activeSession = await ensureSession();
    return buildAdminHeaders(activeSession.token, extra);
  };

  const refreshHistory = async () => {
    if (!bridgeConnected) {
      setHistory(buildSampleAiGraderReportHistory());
      return;
    }
    const nextHistory = await fetchAiGraderStationReportHistory({ baseUrl: bridgeUrl, stationToken });
    setHistory(nextHistory);
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

  const actionBody = (
    overrides: Record<string, unknown> = {},
    sourceStatus: AiGraderLocalStationStatus = status,
    useDraftProfile = true
  ) => {
    const profile = useDraftProfile
      ? {
          dutyPercent: Number(profileDraft.dutyPercent),
          exposureUs: Number(profileDraft.exposureUs),
          gain: Number(profileDraft.gain),
          channels: sourceStatus.acceptedProfile.channels,
          source: "bridge_operator",
        }
      : {
          dutyPercent: sourceStatus.acceptedProfile.dutyPercent,
          exposureUs: sourceStatus.acceptedProfile.exposureUs,
          gain: sourceStatus.acceptedProfile.gain,
          channels: sourceStatus.acceptedProfile.channels,
          source: sourceStatus.acceptedProfile.source,
        };
    return {
    confirmations: {
      lightIdleOff: true,
      fixtureRulersVisible: true,
      ...overrides,
    },
      acceptedProfile: profile,
    };
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
    setPreviewStatus(next.previewStatus);
    setLiveLighting(next.liveLighting);
    setProfileDraft({
      dutyPercent: next.acceptedProfile.dutyPercent,
      exposureUs: next.acceptedProfile.exposureUs,
      gain: next.acceptedProfile.gain,
    });
    return next;
  };

  const waitForPreviewReleaseBeforeCapture = async (reason: string) => {
    if (!canUseBridge) throw new Error("Connect the Dell local station bridge before starting capture.");
    await safeOffAiGraderLiveLighting({ baseUrl: bridgeUrl, stationToken, reason: `${reason}; browser live lighting safe-off before capture` });
    setLiveLighting(await fetchAiGraderLiveLightingStatus({ baseUrl: bridgeUrl, stationToken }));
    setPreviewStatus((currentStatus) => ({
      ...currentStatus,
      status: "paused_for_capture",
      cameraOwnership: "capture_action",
      lastStopReason: reason,
    }));
    const stopped = await stopAiGraderStationPreview({ baseUrl: bridgeUrl, stationToken, reason });
    setPreviewStatus(stopped);
    const releaseStates = new Set(["released", "idle"]);
    if (releaseStates.has(stopped.cameraOwnership)) return;

    const deadline = Date.now() + 7000;
    let latest = stopped;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      latest = await fetchAiGraderStationPreviewStatus({ baseUrl: bridgeUrl, stationToken });
      setPreviewStatus(latest);
      if (releaseStates.has(latest.cameraOwnership)) return;
    }
    throw new Error(`AI Grader preview did not release the Basler camera before capture. Current preview owner: ${latest.cameraOwnership}.`);
  };

  const ensureLiveLightingSession = async () => {
    if (status.currentStep === "start_new_card" || status.currentStep === "safe_off_end_session") {
      return runAction("start-session");
    }
    return status;
  };

  const applyLiveLightingDraft = async (
    draft = liveLightingDraft,
    reason = "browser live lighting apply"
  ) => {
    if (!bridgeConnected || !stationToken.trim()) throw new Error("Connect the Dell local station bridge before live lighting tuning.");
    await ensureLiveLightingSession();
    const next = await applyAiGraderLiveLighting({
      baseUrl: bridgeUrl,
      stationToken,
      enabled: draft.enabled,
      dutyPercent: Number(draft.dutyPercent),
      channels: draft.channels,
      reason,
    });
    setLiveLighting(next);
    return next;
  };

  const scheduleLiveLightingApply = (draft = liveLightingDraft, reason = "browser live lighting adjustment") => {
    if (liveLightingApplyTimerRef.current) clearTimeout(liveLightingApplyTimerRef.current);
    liveLightingApplyTimerRef.current = setTimeout(() => {
      liveLightingApplyTimerRef.current = null;
      void applyLiveLightingDraft(draft, reason).catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Live lighting apply failed.");
      });
    }, 120);
  };

  const updateLiveLightingDraft = (nextDraft: typeof liveLightingDraft, reason: string) => {
    setLiveLightingDraft(nextDraft);
    if (nextDraft.enabled && liveLightingCommandable) scheduleLiveLightingApply(nextDraft, reason);
  };

  const safeOffLiveLighting = async (reason = "operator requested browser live lighting safe-off") => {
    if (liveLightingApplyTimerRef.current) {
      clearTimeout(liveLightingApplyTimerRef.current);
      liveLightingApplyTimerRef.current = null;
    }
    setLiveLightingDraft((current) => ({ ...current, enabled: false }));
    const next = await safeOffAiGraderLiveLighting({ baseUrl: bridgeUrl, stationToken, reason });
    setLiveLighting(next);
    return next;
  };

  const acceptLiveLightingProfile = async () => {
    setBusy("lighting-accept");
    setError(null);
    try {
      const nextLighting = await acceptAiGraderLiveLightingProfile({
        baseUrl: bridgeUrl,
        stationToken,
        dutyPercent: Number(liveLightingDraft.dutyPercent),
        channels: liveLightingDraft.channels,
        exposureUs: Number(profileDraft.exposureUs),
        gain: Number(profileDraft.gain),
      });
      setLiveLighting(nextLighting);
      const nextStatus = await callAiGraderStationBridge({ baseUrl: bridgeUrl, stationToken, action: "status" });
      setStatus(nextStatus);
      setProfileDraft({
        dutyPercent: nextStatus.acceptedProfile.dutyPercent,
        exposureUs: nextStatus.acceptedProfile.exposureUs,
        gain: nextStatus.acceptedProfile.gain,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not accept live lighting profile.");
    } finally {
      setBusy(null);
    }
  };

  const setLiveLightingEnabled = (enabled: boolean) => {
    const nextDraft = { ...liveLightingDraft, enabled };
    setLiveLightingDraft(nextDraft);
    if (enabled) {
      if (liveLightingCommandable) scheduleLiveLightingApply(nextDraft, "browser live lighting enabled");
    } else {
      void safeOffLiveLighting("browser live lighting disabled").catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Live lighting safe-off failed.");
      });
    }
  };

  const setAllLiveLightingChannels = (channels: number[]) => {
    const nextDraft = { ...liveLightingDraft, enabled: channels.length > 0, channels };
    setLiveLightingDraft(nextDraft);
    if (channels.length === 0) {
      void safeOffLiveLighting("browser live lighting all off").catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Live lighting safe-off failed.");
      });
      return;
    }
    if (liveLightingCommandable) scheduleLiveLightingApply(nextDraft, "browser live lighting channels changed");
  };

  const toggleLiveLightingChannel = (channel: number) => {
    const selected = new Set(liveLightingDraft.channels);
    if (selected.has(channel)) selected.delete(channel);
    else selected.add(channel);
    setAllLiveLightingChannels(Array.from(selected).sort((a, b) => a - b));
  };

  const setLiveLightingDuty = (dutyPercent: number) => {
    const nextDraft = { ...liveLightingDraft, dutyPercent };
    updateLiveLightingDraft(nextDraft, "browser live lighting duty changed");
  };

  const startNewCard = async () => {
    setBusy("start");
    setError(null);
    try {
      setSelectedCard(null);
      setIdentityDraft(defaultIdentityDraft);
      setIdentityStatus({ status: "idle", message: "Card identity has not been confirmed." });
      setProductionPublish({ status: "idle", message: "Ten Kings DB/storage publish has not been run." });
      setSlabUploads({});
      setCompsState({ status: "idle", message: "Comps have not been run." });
      setLabelPrintState({ status: "idle", message: "Label has not been marked printed." });
      setInventoryState({ status: "idle", message: "Card has not been added to inventory." });
      await runAction("start-session");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start an AI Grader card session.");
    } finally {
      setBusy(null);
    }
  };

  const startGrading = async () => {
    setBusy("start-grading");
    setError(null);
    try {
      if (!canUseBridge) throw new Error("Connect the Dell local station bridge before starting grading.");
      let latest = status;
      if (latest.currentStep === "start_new_card") latest = await runAction("start-session");
      latest = await runAction("confirm-light-idle-off", actionBody({ lightIdleOff: true }, latest, false));
      latest = await runAction("confirm-fixture-rulers", actionBody({ fixtureRulersVisible: true }, latest, false));
      latest = await runAction("accept-profile", actionBody({}, latest, false));
      await waitForPreviewReleaseBeforeCapture("operator starting front full forensic capture");
      await runAction("capture-front", actionBody({}, latest, false));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Start grading failed.");
    } finally {
      setBusy(null);
    }
  };

  const confirmFlipAndContinue = async () => {
    setBusy("back");
    setError(null);
    try {
      await runAction("confirm-flip", { confirmations: { flipComplete: true } });
      await waitForPreviewReleaseBeforeCapture("operator starting back full forensic capture");
      await runAction("capture-back", { confirmations: { flipComplete: true, lightIdleOff: true, fixtureRulersVisible: true } });
      await runAction("run-diagnostics");
      await runAction("export-report-bundle");
      await prepareLocalProductionRelease();
      await refreshHistory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Back capture or report generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const productionReleaseBody = () => ({
    operatorId: "local-browser-operator",
    warningsAccepted: true,
    overrideReason: "Operator accepted Production Release V0 warning gates from the browser station.",
  });

  const prepareLocalProductionRelease = async () => {
    let next = await runAction("calculate-final-grade", productionReleaseBody());
    if (next.productionRelease?.finalGradeComputed === true) {
      next = await runAction("finalize-report", productionReleaseBody());
      next = await runAction("generate-label-data", productionReleaseBody());
    }
    await refreshHistory();
    return next;
  };

  const buildReportBundleForProduction = (baseBundle: AiGraderReportBundle | undefined = status.reportBundle) => {
    if (!baseBundle) return null;
    if (!selectedCardIdentity) return baseBundle;
    return {
      ...baseBundle,
      cardIdentity: {
        ...baseBundle.cardIdentity,
        ...selectedCardIdentity,
        sideCount: 2 as const,
        futureSlabbedPhotoRefsReserved: true as const,
        futureEbayCompsRefsReserved: true as const,
      },
    };
  };

  const updateIdentityDraft = <K extends keyof IdentityDraftState>(key: K, value: IdentityDraftState[K]) => {
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

  const createCardFromConfirmedIdentity = async () => {
    setBusy("create-card-from-report");
    setError(null);
    setIdentityStatus({ status: "pending", message: "Creating Ten Kings CardAsset and Item from confirmed AI Grader identity." });
    try {
      let latestStatus = status;
      if (!latestStatus.productionRelease?.finalGradeComputed && reportReady) {
        latestStatus = await prepareLocalProductionRelease();
      }
      const reportId = latestStatus.productionRelease?.reportId ?? latestStatus.reportBundle?.reportId ?? latestStatus.latestReport.reportId;
      let sourceBundle = latestStatus.reportBundle;
      if (bridgeConnected && stationToken.trim() && reportId) {
        sourceBundle = await fetchAiGraderStationReportBundle({
          baseUrl: bridgeUrl,
          stationToken,
          reportId,
        });
      }
      const productionRelease = latestStatus.productionRelease ?? sourceBundle?.productionRelease;
      if (!sourceBundle || !productionRelease) {
        throw new Error("A finalized production release and report bundle are required before card creation.");
      }
      const draftIdentity = identityDraftPayload();
      const draftTitle = identityDraftTitle();
      const reportBundleWithIdentity: AiGraderReportBundle = {
        ...sourceBundle,
        cardIdentity: {
          ...sourceBundle.cardIdentity,
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
      const sanitizedRelease = sanitizeProductionReleaseForProduction(productionRelease, sanitizedBundle, null);
      const response = await fetch("/api/admin/ai-grader/production/create-card-from-report", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          publicationStatus: "published",
          reportId: sanitizedRelease?.reportId ?? sanitizedBundle.reportId,
          certId: sanitizedRelease?.label?.certId,
          gradingSessionId: sanitizedRelease?.gradingSessionId ?? sanitizedBundle.gradingSessionId,
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
      setStatus((current) => ({
        ...current,
        productionRelease: result.productionRelease ?? current.productionRelease,
        reportBundle: current.reportBundle
          ? {
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
    } catch (requestError) {
      setIdentityStatus({
        status: "failed",
        message: requestError instanceof Error ? requestError.message : "Card creation failed.",
      });
    } finally {
      setBusy(null);
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
      const response = await fetch(`/api/ai-grader/reports/${encodeURIComponent(reportId)}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
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
    throw new Error(lastMessage);
  };

  const publishToTenKingsSystem = async () => {
    setBusy("ten-kings-publish");
    setError(null);
    setProductionPublish((current) => ({ ...current, status: "pending", message: "Preparing canonical local publish package." }));
    try {
      let latestStatus = status;
      if (!latestStatus.productionRelease?.finalGradeComputed && reportReady) {
        latestStatus = await prepareLocalProductionRelease();
      }
      let sourceBundle = latestStatus.reportBundle;
      const reportId = latestStatus.productionRelease?.reportId ?? latestStatus.reportBundle?.reportId ?? latestStatus.latestReport.reportId;
      if (bridgeConnected && stationToken.trim() && reportId) {
        setProductionPublish((current) => ({ ...current, status: "pending", message: "Reading local package manifest from the paired Dell bridge." }));
        sourceBundle = await fetchAiGraderStationReportBundle({
          baseUrl: bridgeUrl,
          stationToken,
          reportId,
        });
      }
      const reportBundleWithIdentity = buildReportBundleForProduction(sourceBundle);
      const productionRelease = latestStatus.productionRelease ?? sourceBundle?.productionRelease;
      const readiness = buildAiGraderPublishReadiness({
        bundle: reportBundleWithIdentity,
        productionRelease,
      });
      if (!reportBundleWithIdentity || !productionRelease) {
        throw new Error("A finalized production release and report bundle are required before Ten Kings publish.");
      }
      if (!readiness.ready) {
        throw new Error(readiness.message);
      }
      const localAssetManifest = productionAssetManifest(reportBundleWithIdentity);
      if (localAssetManifest.length < 1) {
        throw new Error("Publish package is missing storage-ready image asset metadata with SHA-256 checksums and byte sizes.");
      }
      const sanitizedBundle = sanitizeReportBundleForProduction(reportBundleWithIdentity);
      const sanitizedRelease = sanitizeProductionReleaseForProduction(productionRelease, sanitizedBundle, selectedCard);
      setProductionPublish((current) => ({ ...current, status: "pending", message: "Initializing publish and requesting direct storage upload URLs." }));
      const initResponse = await fetch("/api/admin/ai-grader/production/publish-init", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          publicationStatus: "published",
          reportId: sanitizedRelease?.reportId ?? sanitizedBundle.reportId,
          certId: sanitizedRelease?.label?.certId,
          gradingSessionId: sanitizedRelease?.gradingSessionId ?? sanitizedBundle.gradingSessionId,
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
          cardAssetId: selectedCard?.cardAssetId ?? sanitizedBundle.cardIdentity.cardAssetId,
          itemId: selectedCard?.itemId ?? sanitizedBundle.cardIdentity.itemId,
        }),
      });
      const initText = await initResponse.text();
      let initPayload: any = {};
      try {
        initPayload = initText ? JSON.parse(initText) : {};
      } catch {
        initPayload = {};
      }
      if (!initResponse.ok || initPayload.ok !== true) {
        setProductionPublish({
          status: initPayload.code === "AI_GRADER_PRODUCTION_PUBLISH_DISABLED" ? "disabled" : "error",
          message: initPayload.message ?? (initText.slice(0, 240) || `Publish init failed with HTTP ${initResponse.status}.`),
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
        if (typeof artifact.body === "string") {
          bytes = utf8Bytes(artifact.body);
        } else if (artifact.sourceAssetId) {
          if (!bridgeConnected || !stationToken.trim()) {
            throw new Error(`Local bridge connection is required to upload ${artifact.kind}.`);
          }
          const localAsset = await fetchAiGraderStationReportAsset({
            baseUrl: bridgeUrl,
            stationToken,
            reportId: reportBundleWithIdentity.reportId,
            assetId: artifact.sourceAssetId,
          });
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
        const uploadResponse = await fetch(artifact.uploadUrl, {
          method: artifact.uploadMethod ?? "PUT",
          headers: {
            ...artifact.uploadHeaders,
            "Content-Type": contentType,
          },
          body: bytes,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Direct storage upload failed for ${artifact.kind} with HTTP ${uploadResponse.status}.`);
        }
        uploadedArtifacts.push({
          artifactId: artifact.artifactId,
          storageKey: artifact.storageKey,
          publicUrl: artifact.publicUrl,
          checksumSha256,
          byteSize: bytes.byteLength,
          contentType,
          uploadedAt: new Date().toISOString(),
        });
      }
      setProductionPublish((current) => ({ ...current, status: "pending", message: "Finalizing production DB records." }));
      const finalizeResponse = await fetch("/api/admin/ai-grader/production/publish-finalize", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          publicationStatus: "published",
          reportId: initPayload.result.reportId,
          publishSessionId: initPayload.result.publishSessionId,
          reportBundle: sanitizedBundle,
          productionRelease: sanitizedRelease,
          uploadManifest: { artifacts: uploadedArtifacts },
          cardAssetId: selectedCard?.cardAssetId ?? sanitizedBundle.cardIdentity.cardAssetId,
          itemId: selectedCard?.itemId ?? sanitizedBundle.cardIdentity.itemId,
        }),
      });
      const finalizeText = await finalizeResponse.text();
      let finalizePayload: any = {};
      try {
        finalizePayload = finalizeText ? JSON.parse(finalizeText) : {};
      } catch {
        finalizePayload = {};
      }
      if (!finalizeResponse.ok || finalizePayload.ok !== true) {
        setProductionPublish({
          status: finalizePayload.code === "AI_GRADER_PRODUCTION_PUBLISH_DISABLED" ? "disabled" : "error",
          message: finalizePayload.message ?? (finalizeText.slice(0, 240) || `Publish finalize failed with HTTP ${finalizeResponse.status}.`),
        });
        return;
      }
      const publishedReportId = finalizePayload.result.reportId;
      if (!publishedReportId || !finalizePayload.result.publicReportUrl || !finalizePayload.result.labelPreviewUrl) {
        throw new Error("Publish finalize response did not include reportId, publicReportUrl, and labelPreviewUrl.");
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
      await refreshHistory();
    } catch (requestError) {
      setProductionPublish({
        status: "error",
        message: requestError instanceof Error ? requestError.message : "Ten Kings publish failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const uploadSlabbedPhoto = async (side: "front" | "back", file: File | null) => {
    if (!file) return;
    setBusy(`slab-${side}`);
    setError(null);
    setSlabUploads((current) => ({
      ...current,
      [side]: { status: "uploading", message: `Preparing direct storage upload for slabbed ${side} photo.` },
    }));
    try {
      const reportId = status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
      if (!reportId) throw new Error("A report ID is required before uploading slabbed photos.");
      const bytes = await file.arrayBuffer();
      const checksumSha256 = await sha256Hex(bytes);
      const initResponse = await fetch("/api/admin/ai-grader/production/slabbed-photo-init", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          reportId,
          side,
          fileName: file.name,
          mimeType: file.type || "image/jpeg",
          byteSize: bytes.byteLength,
          checksumSha256,
        }),
      });
      const initPayload = await initResponse.json().catch(() => ({}));
      if (!initResponse.ok || initPayload.ok !== true) {
        throw new Error(initPayload.message ?? `Slabbed ${side} photo upload init failed.`);
      }
      const plan = initPayload.result;
      setSlabUploads((current) => ({
        ...current,
        [side]: { status: "uploading", message: `Uploading slabbed ${side} photo directly to storage.` },
      }));
      const uploadResponse = await fetch(plan.uploadUrl, {
        method: plan.uploadMethod ?? "PUT",
        headers: {
          ...(plan.uploadHeaders ?? {}),
          "Content-Type": file.type || "image/jpeg",
        },
        body: bytes,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Direct slabbed ${side} photo upload failed with HTTP ${uploadResponse.status}.`);
      }
      const finalizeResponse = await fetch("/api/admin/ai-grader/production/slabbed-photo-finalize", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(plan.requiredFinalizeManifest),
      });
      const finalizePayload = await finalizeResponse.json().catch(() => ({}));
      if (!finalizeResponse.ok || finalizePayload.ok !== true) {
        throw new Error(finalizePayload.message ?? `Slabbed ${side} photo finalize failed.`);
      }
      setSlabUploads((current) => ({
        ...current,
        [side]: {
          status: "uploaded",
          publicUrl: finalizePayload.result.publicUrl,
          message: `Slabbed ${side} photo uploaded and attached.`,
        },
      }));
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

  const runEbayComps = async () => {
    setBusy("run-comps");
    setError(null);
    setCompsState({ status: "running", message: "Preparing operator-triggered eBay comps." });
    try {
      const reportBundle = buildReportBundleForProduction();
      if (!reportBundle || !status.productionRelease) {
        throw new Error("A finalized production release and selected report bundle are required before comps.");
      }
      const readiness = buildAiGraderCompsReadiness({
        bundle: reportBundle,
        productionRelease: status.productionRelease,
        selectedCard,
      });
      if (!readiness.ready) {
        setCompsState({ status: readiness.status, message: readiness.message });
        return;
      }
      const response = await fetch("/api/admin/ai-grader/production/run-comps", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          reportId: status.productionRelease.reportId,
          reportBundle,
          productionRelease: status.productionRelease,
          selection: selectedCardIdentity,
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

  const saveSelectedComps = async () => {
    setBusy("save-comps");
    setError(null);
    try {
      const reportId = productionPublish.reportId ?? status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
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

  const markLabelPrinted = async () => {
    setBusy("mark-label-printed");
    setError(null);
    setLabelPrintState({
      status: "pending",
      message: "Persisting label print confirmation.",
    });
    try {
      const reportId = productionPublish.reportId ?? status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
      if (!reportId) throw new Error("A published report ID is required before marking the label printed.");
      const response = await fetch("/api/admin/ai-grader/production/mark-label-printed", {
        method: "POST",
        headers: await productionAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ reportId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Marking the label printed failed.");
      }
      setLabelPrintState({
        status: "completed",
        message: `Printed label persisted for cert ${payload.result?.certId ?? certId ?? "AI Grader label"}.`,
      });
    } catch (requestError) {
      setLabelPrintState({
        status: "failed",
        message: requestError instanceof Error ? requestError.message : "Marking the label printed failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const addToInventory = async () => {
    setBusy("add-to-inventory");
    setError(null);
    setInventoryState({ status: "pending", message: "Moving card to inventory-ready flow." });
    try {
      const reportId = productionPublish.reportId ?? status.productionRelease?.reportId ?? status.reportBundle?.reportId ?? status.latestReport.reportId;
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
    } catch (requestError) {
      setInventoryState({
        status: "failed",
        message: requestError instanceof Error ? requestError.message : "Add To Inventory failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const safeOff = async () => {
    setBusy("safe-off");
    setError(null);
    try {
      if (bridgeConnected && stationToken.trim()) {
        await safeOffLiveLighting("operator station safe-off");
      }
      await runAction("safe-off", { confirmations: { finalLightOff: true, lightIdleOff: true } });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Safe Off failed.");
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
      : busy === "start-grading" || busy === "back"
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

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Station</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="station">
        <section className="viewer" aria-label="AI Grader camera cockpit">
          <div className="camera-frame">
            {previewFrameUrl ? (
              <img className="preview-image" src={previewFrameUrl} alt="Live AI Grader Basler preview" />
            ) : (
              <div className="preview-placeholder">
                <span>{previewStatusLabel}</span>
              </div>
            )}
            <div className="guide-card" />
            <div className="crosshair horizontal" />
            <div className="crosshair vertical" />
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
                <h2>Flip Card to Back</h2>
                <p>Seat the card in the fixture, then continue. The system will capture the back and generate the report.</p>
                <button type="button" onClick={confirmFlipAndContinue} disabled={busy !== null}>
                  {busy === "back" ? "Capturing Back" : "Confirm Back Is Ready"}
                </button>
              </div>
            </div>
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
                      <strong>{formatStationValue(localReport.bundle.reportStatus)}</strong>
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
                      <h3>{localReportFinalGrade?.finalGradeComputed ? "Final AI-Grader Grade V0" : "Diagnostic Report"}</h3>
                      <p>{localReportStory?.gradeStory?.summary ?? "This report did not compute a final grade. Review the evidence gates and warnings below."}</p>
                      <dl>
                        <dt>Confidence</dt>
                        <dd>{localReportFinalGrade?.confidence.band ?? localReportStory?.confidence?.band ?? "pending"}</dd>
                        <dt>Strongest positive</dt>
                        <dd>{localReportStory?.gradeStory?.strongestPositiveFinding ?? "Not computed"}</dd>
                        <dt>Strongest warning</dt>
                        <dd>{localReportStory?.gradeStory?.strongestWarning ?? localReport.bundle.warnings[0] ?? "No warning recorded"}</dd>
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
                            <p>{finalElement?.explanation ?? provisionalElement?.explanation ?? "Insufficient evidence."}</p>
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
                            <strong>{reason.title}</strong>
                            <p>{reason.explanation}</p>
                          </article>
                        ))
                      ) : (
                        <p>No grade-impact story was computed.</p>
                      )}
                    </section>
                    <section>
                      <p className="eyebrow">Vision Lab</p>
                      <dl>
                        <dt>Available</dt>
                        <dd>{localReport.bundle.visionLab.available ? "Yes" : "No"}</dd>
                        <dt>Surface candidates</dt>
                        <dd>{localReport.bundle.visionLab.candidateCount}</dd>
                        <dt>Heatmaps</dt>
                        <dd>{localReport.bundle.visionLab.heatmapRefs.join(", ") || "none"}</dd>
                        <dt>Light sweep</dt>
                        <dd>{localReport.bundle.visionLab.channelImageRefs.join(", ") || "none"}</dd>
                      </dl>
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
                  {localReport.bundle.warnings.length ? (
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
            <span>Ten Kings</span>
            <strong>AI Grader Station</strong>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <section className="next-card">
            <p className="eyebrow">Current Step</p>
            <h2>{activePipelineStep.label}</h2>
            <p>{activePipelineStep.action}</p>
            <ol className="pipeline-steps">
              {pipelineSteps.map((step) => (
                <li key={step.id} className={step.done ? "done" : step.id === activePipelineStep.id ? "active" : ""}>
                  <span>{step.done ? "Done" : step.id === activePipelineStep.id ? "Now" : "Next"}</span>
                  <strong>{step.label}</strong>
                </li>
              ))}
            </ol>
            <button type="button" className="primary" onClick={startNewCard} disabled={busy !== null}>
              {busy === "start" ? "Starting" : "Start New Card"}
            </button>
            <button type="button" className="start-grading" onClick={startGrading} disabled={busy !== null}>
              {busy === "start-grading" ? "Working" : "Start Grading"}
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
                className={liveLightingDraft.enabled ? "toggle active" : "toggle"}
                onClick={() => setLiveLightingEnabled(!liveLightingDraft.enabled)}
                disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held}
              >
                {liveLightingDraft.enabled ? "Live" : "Off"}
              </button>
            </div>
            <div className="lighting-status-grid">
              <div>
                <span>Applied</span>
                <strong>{liveLightingAppliedLabel}</strong>
              </div>
              <div>
                <span>Safe Off</span>
                <strong>{liveLighting.applied.enabled ? "Armed" : "Off"}</strong>
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
                  disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held}
                  aria-label={`Toggle Leimac channel ${channel}`}
                  title={`Channel ${channel}`}
                >
                  {channel}
                </button>
              ))}
            </div>
            <div className="mini-actions">
              <button type="button" onClick={() => setAllLiveLightingChannels([1, 2, 3, 4, 5, 6, 7, 8])} disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held}>
                All On
              </button>
              <button type="button" onClick={() => setAllLiveLightingChannels([])} disabled={!bridgeConnected || busy !== null}>
                All Off
              </button>
            </div>
            <label>
              Brightness %
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                value={liveLightingDraft.dutyPercent}
                onChange={(event) => setLiveLightingDuty(Number(event.target.value))}
                disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held}
              />
            </label>
            <div className="lighting-inputs">
              <label>
                Duty %
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={liveLightingDraft.dutyPercent}
                  onChange={(event) => setLiveLightingDuty(Number(event.target.value))}
                  disabled={!bridgeConnected || busy !== null || warmRunner.captureLock.held}
                />
              </label>
              <label>
                Exposure us
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1000"
                  value={profileDraft.exposureUs}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, exposureUs: Number(event.target.value) }))}
                />
              </label>
            </div>
            <button
              type="button"
              className="accept-lighting"
              onClick={acceptLiveLightingProfile}
              disabled={!bridgeConnected || busy !== null || liveLightingDraft.channels.length === 0 || Number(liveLightingDraft.dutyPercent) <= 0}
            >
              {busy === "lighting-accept" ? "Accepting" : "Use This Profile For Capture"}
            </button>
            {liveLighting.lastError ? <p className="status-note">{liveLighting.lastError}</p> : null}
          </section>

          <section className="card-linkage">
            <p className="eyebrow">Confirm Card</p>
            <h3>{selectedCard?.displayTitle ?? "Create From AI Grader"}</h3>
            <p>{identityStatus.status === "idle" ? selectedCard?.subtitle ?? cardSearchMessage : identityStatus.message}</p>
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
            <button type="button" className="primary" onClick={createCardFromConfirmedIdentity} disabled={!canCreateCardFromReport || busy !== null}>
              {busy === "create-card-from-report" ? "Creating Card" : linkedCardReady ? "Card Created" : "Confirm + Create Card"}
            </button>
            {!identityDraftComplete && !linkedCardReady ? <p className="status-note">Required before create: {identityDraftMissing.join(", ")}.</p> : null}
            {linkedCardReady ? <p className="status-note">CardAsset {selectedCard?.cardAssetId} / Item {selectedCard?.itemId}</p> : null}
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
              <span>Final V0</span>
              <strong>{finalReady ? "Computed" : "Pending"}</strong>
            </div>
            <div>
              <span>Safe Off</span>
              <strong>{status.confirmations?.finalLightOff ? "Confirmed" : "Available"}</strong>
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
                <strong>{warmRunner.executionPath === "cold_command_fallback" ? "Cold Fallback" : "Warm Runner"}</strong>
              </div>
              <div>
                <span>Fallback</span>
                <strong>{warmRunner.fallbackUsed || warmRunner.fallback.active ? "Used" : "No"}</strong>
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
            {(warmRunner.fallbackUsed || warmRunner.fallback.active) && (
              <p className="status-note">{warmRunner.fallbackReason ?? warmRunner.fallback.reason ?? "Cold fallback was used; this run does not count for speed acceptance."}</p>
            )}
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
            <h3>{productionPublish.status === "published" ? "Published Outputs Ready" : "Review and Publish"}</h3>
            <p>{publishReadiness.message}</p>
            <div className="action-row">
              <button type="button" onClick={() => void openReport()} disabled={!reportReady || busy !== null}>
                {busy === "open-report" ? "Opening Report" : "Review Report"}
              </button>
              <button type="button" className="primary" onClick={publishToTenKingsSystem} disabled={!canPublishToTenKings || busy !== null}>
                {busy === "ten-kings-publish" ? "Publishing" : "Publish to Ten Kings"}
              </button>
              {productionPublish.status === "published" && publicReportUrl ? (
                <a href={publicReportUrl} target="_blank" rel="noreferrer">View Public Report</a>
              ) : null}
              {productionPublish.status === "published" && labelPreviewUrl ? (
                <a href={labelPreviewUrl} target="_blank" rel="noreferrer">Print Label</a>
              ) : null}
              <button type="button" onClick={markLabelPrinted} disabled={!productionPublished || labelPrinted || busy !== null}>
                {busy === "mark-label-printed" ? "Marking Printed" : labelPrinted ? "Label Printed" : "Mark Label Printed"}
              </button>
              <button type="button" onClick={runEbayComps} disabled={!productionPublished || !labelPrinted || !slabbedPhotosReady || !compsReadiness.ready || busy !== null}>
                {busy === "run-comps" ? "Running Comps" : compsState.status === "completed" ? "Refresh Comps" : "Run eBay Comps"}
              </button>
              <button type="button" onClick={saveSelectedComps} disabled={!canSaveSelectedComps || busy !== null}>
                {busy === "save-comps" ? "Saving Comps" : compsSaved ? "Comps Saved" : "Save Selected Comps"}
              </button>
              <button type="button" className="primary" onClick={addToInventory} disabled={!canAddToInventory || busy !== null}>
                {busy === "add-to-inventory" ? "Adding" : inventoryComplete ? "In Inventory Flow" : "Add To Inventory"}
              </button>
              <button type="button" onClick={openHistory}>
                Card History Reports
              </button>
            </div>
            {Array.isArray(compsState.compsRefs) && compsState.compsRefs.length ? (
              <div className="comps-select">
                {compsState.compsRefs.map((comp, index) => {
                  const compId = comp.id ?? `comp-${index + 1}`;
                  return (
                    <label key={compId}>
                      <input
                        type="checkbox"
                        checked={(compsState.selectedIds ?? []).includes(compId)}
                        onChange={() => toggleSelectedComp(compId)}
                        disabled={busy !== null || compsSaved}
                      />
                      <span>{comp.title ?? "Sold comp"}</span>
                      <strong>{comp.price ?? "price n/a"}</strong>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {!canPublishToTenKings && productionPublish.status !== "published" ? (
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
                <span>Label preview</span>
                <a href={labelPreviewUrl} target="_blank" rel="noreferrer">{labelPreviewUrl}</a>
                <button type="button" onClick={() => void copyLink(labelPreviewUrl, "Label preview URL")}>Copy</button>
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
            <p>Print action: {labelPrintState.message}</p>
            <p>Card linkage: {linkedCardReady ? selectedCard?.cardAssetId ?? selectedCard?.itemId : "not linked"}</p>
            <p>Slabbed photos: {slabbedPhotosReady ? "front/back attached" : "pending"}</p>
            <p>Comps: {compsState.status === "idle" ? compsReadiness.status : compsState.status} - {compsState.status === "idle" ? compsReadiness.message : compsState.message}</p>
            <p>Inventory: {inventoryState.message}</p>
            {compsState.searchQuery ? <p>Comps query: {compsState.searchQuery}</p> : null}
          </section>

          <section className="slabbed-photos">
            <p className="eyebrow">Slabbed Color Photos</p>
            <p>Attach post-slab color photos. These are separate from Basler monochrome evidence.</p>
            <label>
              Front color photo
              <input type="file" accept="image/*" disabled={!productionPublished || !labelPrinted || busy !== null} onChange={(event) => uploadSlabbedPhoto("front", event.target.files?.[0] ?? null)} />
            </label>
            <p>{slabUploads.front?.message ?? "Front photo not uploaded."}</p>
            <label>
              Back color photo
              <input type="file" accept="image/*" disabled={!productionPublished || !labelPrinted || busy !== null} onChange={(event) => uploadSlabbedPhoto("back", event.target.files?.[0] ?? null)} />
            </label>
            <p>{slabUploads.back?.message ?? "Back photo not uploaded."}</p>
          </section>

          <button type="button" className="safe" onClick={safeOff} disabled={busy !== null}>
            {busy === "safe-off" ? "Safe Off Running" : "Safe Off / End Session"}
          </button>

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
                  <span>{item.finalOverallGrade ? "Final V0" : "Provisional"}</span>
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
        .guide-card {
          position: absolute;
          z-index: 2;
          left: 50%;
          top: 50%;
          width: min(36vw, 330px);
          aspect-ratio: 2.5 / 3.5;
          transform: translate(-50%, -50%);
          border: 2px solid rgba(89, 255, 166, 0.78);
          border-radius: 8px;
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.16), 0 0 40px rgba(89, 255, 166, 0.12);
        }
        .guide-card:before,
        .guide-card:after {
          content: "";
          position: absolute;
          inset: 12%;
          border: 1px solid rgba(89, 255, 166, 0.28);
        }
        .guide-card:after {
          inset: 28% 18%;
        }
        .crosshair {
          position: absolute;
          z-index: 2;
          background: rgba(237, 219, 174, 0.38);
        }
        .crosshair.horizontal {
          top: 50%;
          left: 24px;
          right: 24px;
          height: 1px;
        }
        .crosshair.vertical {
          left: 50%;
          top: 24px;
          bottom: 24px;
          width: 1px;
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
          background: rgba(115, 14, 20, 0.48);
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
          display: grid;
          gap: 4px;
          margin-bottom: 20px;
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
        }
      `}</style>
    </>
  );
}
