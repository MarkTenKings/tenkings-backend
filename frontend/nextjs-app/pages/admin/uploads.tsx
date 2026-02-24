import Head from "next/head";
import Link from "next/link";
import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type ZoomConstraintSet = MediaTrackConstraintSet & { zoom?: number };

async function applyTrackZoom(track: MediaStreamTrack, value: number) {
  if (typeof track.applyConstraints !== "function") {
    return;
  }
  const constraints = {
    advanced: [{ zoom: value } as ZoomConstraintSet],
  } as MediaTrackConstraints;
  try {
    await track.applyConstraints(constraints);
  } catch {
    // Some browsers reject unsupported zoom values—ignore.
  }
}

type UploadStatus =
  | "pending"
  | "compressing"
  | "presigning"
  | "uploading"
  | "processing"
  | "recorded"
  | "error";

interface UploadResult {
  fileName: string;
  assetId: string | null;
  status: UploadStatus;
  message?: string;
  publicUrl?: string;
}

type IntakeStep = "front" | "back" | "tilt" | "required" | "optional" | "done";
type IntakeCategory = "sport" | "tcg";
type IntakeReviewMode = "capture" | "review";

type IntakeRequiredFields = {
  category: IntakeCategory;
  playerName: string;
  sport: string;
  manufacturer: string;
  year: string;
  cardName: string;
  game: string;
};

type IntakeOptionalFields = {
  teamName: string;
  productLine: string;
  insertSet: string;
  parallel: string;
  cardNumber: string;
  numbered: string;
  autograph: boolean;
  memorabilia: boolean;
  graded: boolean;
  gradeCompany: string;
  gradeValue: string;
  tcgSeries: string;
  tcgRarity: string;
  tcgFoil: boolean;
  tcgLanguage: string;
  tcgOutOf: string;
};

interface BatchAssignmentSummary {
  packDefinitionId: string;
  name: string;
  category: string;
  tier: string;
  price: number;
  count: number;
}

interface BatchSummary {
  id: string;
  label: string | null;
  status: string;
  totalCount: number;
  processedCount: number;
  createdAt: string;
  updatedAt: string;
  latestAssetAt: string | null;
  assignments: BatchAssignmentSummary[];
}

type VariantApiRow = {
  setId?: string;
  cardNumber?: string;
  parallelId?: string;
  parallelFamily?: string | null;
};

type VariantOptionItem = {
  label: string;
  kind: "insert" | "parallel";
  count: number;
  setIds: string[];
  primarySetId: string | null;
};

type OcrPhotoAudit = {
  id: "FRONT" | "BACK" | "TILT";
  hasImage: boolean;
  status: "missing_image" | "empty_text" | "ok";
  ocrText: string;
  tokenCount: number;
  sourceImageId: string | null;
};

type OcrAuditPayload = {
  fields?: Record<string, string | null>;
  confidence?: Record<string, number | null>;
  photoOcr?: Record<string, OcrPhotoAudit>;
  readiness?: {
    status?: string;
    required?: string[];
    missingRequired?: string[];
    processedCount?: number;
    capturedCount?: number;
  };
  memory?: {
    context?: Record<string, string | null>;
    consideredRows?: number;
    applied?: Array<{
      field?: string;
      value?: string;
      confidence?: number;
      support?: number;
    }>;
    error?: string;
  };
  variantMatch?: {
    ok?: boolean;
    message?: string;
    matchedSetId?: string;
    matchedCardNumber?: string;
    topCandidate?: { parallelId?: string; confidence?: number; reason?: string | null } | null;
  };
  taxonomyConstraints?: {
    fieldStatus?: Partial<
      Record<
        "setName" | "insertSet" | "parallel",
        "kept" | "cleared_low_confidence" | "cleared_out_of_pool" | "cleared_no_set_scope"
      >
    >;
  };
  regionTemplates?: {
    setId?: string | null;
    layoutClass?: string;
    loadedSides?: string[];
    regionCountBySide?: Partial<Record<"FRONT" | "BACK" | "TILT", number>>;
    error?: string;
  };
};

type TeachRegionSide = "FRONT" | "BACK" | "TILT";

type TeachRegionRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  targetField: string;
  targetValue: string;
  note: string;
};

type TeachRegionsBySide = Record<TeachRegionSide, TeachRegionRect[]>;

type TeachRegionDraft = {
  side: TeachRegionSide;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  pointerId: number;
};

type TeachRegionBindingField =
  | "playerName"
  | "sport"
  | "manufacturer"
  | "year"
  | "cardName"
  | "game"
  | "teamName"
  | "setName"
  | "insertSet"
  | "parallel"
  | "cardNumber"
  | "numbered"
  | "autograph"
  | "memorabilia"
  | "graded"
  | "gradeCompany"
  | "gradeValue";

type TeachRegionBindingOption = {
  key: TeachRegionBindingField;
  label: string;
  value: string;
};

type TeachRegionBindDraft = {
  side: TeachRegionSide;
  region: Pick<TeachRegionRect, "id" | "x" | "y" | "width" | "height">;
  targetField: TeachRegionBindingField;
  targetValue: string;
  note: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  SPORTS: "Sports",
  POKEMON: "Pokémon",
  COMICS: "Comics",
};

const TIER_LABELS: Record<string, string> = {
  TIER_25: "$25 Pack",
  TIER_50: "$50 Pack",
  TIER_100: "$100 Pack",
  TIER_500: "$500 Pack",
};

const CAMERA_STORAGE_KEY = "tenkings.adminUploads.cameraDeviceId";
const OCR_QUEUE_STORAGE_KEY = "tenkings.adminUploads.ocrQueue";
const OCR_DRAFT_STORAGE_KEY = "tenkings.adminUploads.ocrDraft";
const TEACH_REGION_SIDES: TeachRegionSide[] = ["FRONT", "BACK", "TILT"];

const clampFraction = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(5));
};

const normalizeTeachLayoutClass = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "base";
};

const buildEmptyTeachRegionsBySide = (): TeachRegionsBySide => ({
  FRONT: [],
  BACK: [],
  TILT: [],
});

const coerceTeachRegionsBySide = (raw: unknown): TeachRegionsBySide => {
  if (!raw || typeof raw !== "object") {
    return buildEmptyTeachRegionsBySide();
  }
  const input = raw as Record<string, unknown>;
  const output = buildEmptyTeachRegionsBySide();
  TEACH_REGION_SIDES.forEach((side) => {
    const list = Array.isArray(input[side]) ? input[side] : [];
    output[side] = list
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const region = entry as Record<string, unknown>;
        const x = clampFraction(typeof region.x === "number" ? region.x : NaN);
        const y = clampFraction(typeof region.y === "number" ? region.y : NaN);
        const width = clampFraction(typeof region.width === "number" ? region.width : NaN);
        const height = clampFraction(typeof region.height === "number" ? region.height : NaN);
        if (width < 0.01 || height < 0.01 || x + width > 1.001 || y + height > 1.001) {
          return null;
        }
        return {
          id: `region-${side}-${Math.random().toString(36).slice(2, 9)}`,
          x,
          y,
          width,
          height,
          label: typeof region.label === "string" ? region.label : "",
          targetField: typeof region.targetField === "string" ? region.targetField.trim() : "",
          targetValue: typeof region.targetValue === "string" ? region.targetValue.trim() : "",
          note: typeof region.note === "string" ? region.note.trim() : "",
        } as TeachRegionRect;
      })
      .filter((entry): entry is TeachRegionRect => Boolean(entry))
      .slice(0, 24);
  });
  return output;
};

const sanitizeNullableText = (value: string | null | undefined): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  const lowered = normalized.toLowerCase();
  if (lowered === "null" || lowered === "undefined" || lowered === "n/a" || lowered === "na") {
    return "";
  }
  return normalized;
};

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

const VARIANT_LABEL_STOP_WORDS = new Set(["the"]);
const GENERIC_PRODUCT_LINE_HINT_TOKENS = new Set([
  "topps",
  "panini",
  "bowman",
  "upper",
  "deck",
  "chrome",
  "finest",
  "prizm",
  "select",
  "mosaic",
  "optic",
  "donruss",
  "certified",
  "elite",
  "contenders",
  "origins",
  "revolution",
  "spectra",
  "status",
]);

const normalizeVariantLabelKey = (value: string): string =>
  tokenize(value)
    .filter((token) => !VARIANT_LABEL_STOP_WORDS.has(token))
    .join(" ")
    .trim();

const OCR_TAXONOMY_THRESHOLD: Record<"setName" | "insertSet" | "parallel", number> = {
  setName: 0.8,
  insertSet: 0.8,
  parallel: 0.8,
};

const ocrSuggestionThreshold = (field: string, baseThreshold: number): number => {
  if (field === "setName" || field === "insertSet" || field === "parallel") {
    return Math.max(baseThreshold, OCR_TAXONOMY_THRESHOLD[field]);
  }
  return baseThreshold;
};

const isActionableProductLineHint = (value: string): boolean => {
  const tokens = tokenize(value);
  if (tokens.length >= 2) {
    return true;
  }
  const token = tokens[0] ?? "";
  if (!token) {
    return false;
  }
  if (/^(19|20)\d{2}(?:[-/]\d{2,4})?$/.test(token)) {
    return true;
  }
  return !GENERIC_PRODUCT_LINE_HINT_TOKENS.has(token);
};

const scoreOption = (option: string, hints: string[]): number => {
  if (!option.trim() || hints.length === 0) {
    return 0;
  }
  const optionTokens = new Set(tokenize(option));
  const optionKey = normalizeVariantLabelKey(option);
  if (optionTokens.size === 0) {
    return 0;
  }
  let score = 0;
  hints.forEach((hint) => {
    const cleanedHint = sanitizeNullableText(hint);
    if (!cleanedHint) {
      return;
    }
    const hintLower = cleanedHint.toLowerCase();
    const optionLower = option.toLowerCase();
    const hintKey = normalizeVariantLabelKey(cleanedHint);
    if (hintLower === optionLower) {
      score += 1.5;
    } else if (optionKey && hintKey && optionKey === hintKey) {
      score += 1.2;
    } else if (optionLower.includes(hintLower) || hintLower.includes(optionLower)) {
      score += 0.9;
    }
    tokenize(cleanedHint).forEach((token) => {
      if (optionTokens.has(token)) {
        score += 0.25;
      }
    });
  });
  return score;
};

const pickBestCandidate = (options: string[], hints: string[], minScore = 0.8): string | null => {
  let best: string | null = null;
  let bestScore = 0;
  options.forEach((option) => {
    const score = scoreOption(option, hints);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  });
  return bestScore >= minScore ? best : null;
};

const inferSportFromProductLine = (value: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.includes("basketball") || normalized.includes("nba")) {
    return "Basketball";
  }
  if (normalized.includes("football") || normalized.includes("nfl")) {
    return "Football";
  }
  if (normalized.includes("baseball") || normalized.includes("mlb")) {
    return "Baseball";
  }
  if (normalized.includes("hockey") || normalized.includes("nhl")) {
    return "Hockey";
  }
  if (normalized.includes("soccer") || normalized.includes("fifa")) {
    return "Soccer";
  }
  return "";
};

export default function AdminUploads() {
  const { session, loading, ensureSession, logout } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const [intakeStep, setIntakeStep] = useState<IntakeStep>("front");
  const [intakeReviewMode, setIntakeReviewMode] = useState<IntakeReviewMode>("capture");
  const [queuedReviewCardIds, setQueuedReviewCardIds] = useState<string[]>([]);
  const [intakeRequired, setIntakeRequired] = useState<IntakeRequiredFields>({
    category: "sport",
    playerName: "",
    sport: "",
    manufacturer: "",
    year: "",
    cardName: "",
    game: "",
  });
  const [intakeOptional, setIntakeOptional] = useState<IntakeOptionalFields>({
    teamName: "",
    productLine: "",
    insertSet: "",
    parallel: "",
    cardNumber: "",
    numbered: "",
    autograph: false,
    memorabilia: false,
    graded: false,
    gradeCompany: "",
    gradeValue: "",
    tcgSeries: "",
    tcgRarity: "",
    tcgFoil: false,
    tcgLanguage: "",
    tcgOutOf: "",
  });
  const [intakeCardId, setIntakeCardId] = useState<string | null>(null);
  const [intakeBatchId, setIntakeBatchId] = useState<string | null>(null);
  const [intakeBackPhotoId, setIntakeBackPhotoId] = useState<string | null>(null);
  const [intakeTiltPhotoId, setIntakeTiltPhotoId] = useState<string | null>(null);
  const [intakeFrontPreview, setIntakeFrontPreview] = useState<string | null>(null);
  const [intakeBackPreview, setIntakeBackPreview] = useState<string | null>(null);
  const [intakeTiltPreview, setIntakeTiltPreview] = useState<string | null>(null);
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [intakePhotoBusy, setIntakePhotoBusy] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeCaptureTarget, setIntakeCaptureTarget] = useState<null | "front" | "back" | "tilt">(null);
  const [pendingBackBlob, setPendingBackBlob] = useState<Blob | null>(null);
  const [pendingTiltBlob, setPendingTiltBlob] = useState<Blob | null>(null);
  const [flashActive, setFlashActive] = useState(false);
  const [intakeSuggested, setIntakeSuggested] = useState<Record<string, string>>({});
  const [intakeTouched, setIntakeTouched] = useState<Record<string, boolean>>({});
  const [intakeOptionalTouched, setIntakeOptionalTouched] = useState<Record<string, boolean>>({});
  const [trainAiEnabled, setTrainAiEnabled] = useState(false);
  const [teachBusy, setTeachBusy] = useState(false);
  const [teachFeedback, setTeachFeedback] = useState<string | null>(null);
  const [teachLayoutClass, setTeachLayoutClass] = useState("base");
  const [teachRegionSide, setTeachRegionSide] = useState<TeachRegionSide>("FRONT");
  const [teachRegionsBySide, setTeachRegionsBySide] = useState<TeachRegionsBySide>(() => buildEmptyTeachRegionsBySide());
  const [teachRegionDraft, setTeachRegionDraft] = useState<TeachRegionDraft | null>(null);
  const [teachRegionLoading, setTeachRegionLoading] = useState(false);
  const [teachRegionBusy, setTeachRegionBusy] = useState(false);
  const [teachRegionFeedback, setTeachRegionFeedback] = useState<string | null>(null);
  const [teachRegionDrawEnabled, setTeachRegionDrawEnabled] = useState(true);
  const [teachRegionBindDraft, setTeachRegionBindDraft] = useState<TeachRegionBindDraft | null>(null);
  const [productLineOptions, setProductLineOptions] = useState<string[]>([]);
  const [insertSetOptions, setInsertSetOptions] = useState<string[]>([]);
  const [parallelOptions, setParallelOptions] = useState<string[]>([]);
  const [variantOptionItems, setVariantOptionItems] = useState<VariantOptionItem[]>([]);
  const [variantScopeSummary, setVariantScopeSummary] = useState<{
    approvedSetCount: number;
    variantCount: number;
  } | null>(null);
  const [selectedQueueCardId, setSelectedQueueCardId] = useState<string | null>(null);
  const [variantCatalog, setVariantCatalog] = useState<VariantApiRow[]>([]);
  const [optionPreviewUrls, setOptionPreviewUrls] = useState<Record<string, string>>({});
  const [pickerModalField, setPickerModalField] = useState<null | "insertSet" | "parallel">(null);
  type OcrApplyField = Exclude<keyof IntakeRequiredFields, "category">;
  const [ocrStatus, setOcrStatus] = useState<null | "idle" | "running" | "pending" | "ready" | "empty" | "error">(
    null
  );
  const [ocrAudit, setOcrAudit] = useState<Record<string, unknown> | null>(null);
  const [ocrApplied, setOcrApplied] = useState(false);
  const [ocrMode, setOcrMode] = useState<null | "high" | "low">(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [captureLocked, setCaptureLocked] = useState(false);
  const [supportsZoom, setSupportsZoom] = useState(false);
  const [zoomBounds, setZoomBounds] = useState({ min: 1, max: 1, step: 0.1 });
  const [zoom, setZoom] = useState(1);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(CAMERA_STORAGE_KEY);
  });
  const [devicesEnumerating, setDevicesEnumerating] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [streamVersion, setStreamVersion] = useState(0);
  const ocrSuggestRef = useRef(false);
  const ocrRetryRef = useRef(0);
  const ocrRequestIdRef = useRef(0);
  const ocrCardIdRef = useRef<string | null>(null);
  const ocrBackupRef = useRef<IntakeRequiredFields | null>(null);
  const ocrAppliedFieldsRef = useRef<OcrApplyField[]>([]);
  const ocrOptionalBackupRef = useRef<IntakeOptionalFields | null>(null);
  const ocrAppliedOptionalFieldsRef = useRef<(keyof IntakeOptionalFields)[]>([]);
  const photoroomRequestedRef = useRef<string | null>(null);
  const restoredDraftRef = useRef(false);

  const apiBase = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL ?? "";
    if (!raw) {
      return "";
    }
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
  }, []);

  const uploadConcurrency = useMemo(() => {
    const parsed = Number(process.env.NEXT_PUBLIC_UPLOAD_CONCURRENCY ?? "3");
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 3;
    }
    return Math.min(10, Math.max(1, Math.floor(parsed)));
  }, []);

  const statusLabels: Record<UploadStatus, string> = {
    pending: "Queued",
    compressing: "Optimizing",
    presigning: "Preparing",
    uploading: "Uploading",
    processing: "Recording",
    recorded: "Complete",
    error: "Error",
  };

  const statusTone: Record<UploadStatus, string> = {
    pending: "text-slate-500",
    compressing: "text-sky-300",
    presigning: "text-sky-300",
    uploading: "text-sky-300",
    processing: "text-sky-300",
    recorded: "text-emerald-300",
    error: "text-rose-300",
  };

  const uploadSummary = useMemo(() => {
    const total = results.length > 0 ? results.length : files.length;
    const completed = results.filter((result) => result.status === "recorded").length;
    const errors = results.filter((result) => result.status === "error").length;
    return { total, completed, errors };
  }, [results, files]);

  const appendFiles = useCallback((newFiles: File[]) => {
    if (!newFiles.length) {
      return;
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setResults([]);
    setFlash(null);
    setBatchId(null);
  }, []);

  const refreshVideoInputs = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setVideoInputs([]);
      return [];
    }
    setDevicesEnumerating(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((device): device is MediaDeviceInfo => device.kind === "videoinput");
      setVideoInputs(videos);
      return videos;
    } catch (error) {
      console.warn("[admin/uploads] Failed to enumerate devices", error);
      setVideoInputs([]);
      return [];
    } finally {
      setDevicesEnumerating(false);
    }
  }, []);

  useEffect(() => {
    void refreshVideoInputs();
  }, [refreshVideoInputs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(OCR_QUEUE_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      const ids = parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (ids.length > 0) {
        setQueuedReviewCardIds(ids);
      }
    } catch {
      // ignore malformed local storage payload
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(OCR_DRAFT_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const draft = JSON.parse(raw) as Record<string, unknown>;
      if (typeof draft.intakeStep === "string") {
        setIntakeStep(draft.intakeStep as IntakeStep);
      }
      if (typeof draft.intakeCardId === "string" && draft.intakeCardId.trim()) {
        setIntakeCardId(draft.intakeCardId);
      }
      if (typeof draft.intakeBatchId === "string") {
        setIntakeBatchId(draft.intakeBatchId || null);
      }
      if (typeof draft.intakeFrontPreview === "string") {
        setIntakeFrontPreview(draft.intakeFrontPreview || null);
      }
      if (typeof draft.intakeBackPreview === "string") {
        setIntakeBackPreview(draft.intakeBackPreview || null);
      }
      if (typeof draft.intakeTiltPreview === "string") {
        setIntakeTiltPreview(draft.intakeTiltPreview || null);
      }
      if (typeof draft.intakeBackPhotoId === "string") {
        setIntakeBackPhotoId(draft.intakeBackPhotoId || null);
      }
      if (typeof draft.intakeTiltPhotoId === "string") {
        setIntakeTiltPhotoId(draft.intakeTiltPhotoId || null);
      }
      if (draft.intakeRequired && typeof draft.intakeRequired === "object") {
        setIntakeRequired((prev) => ({ ...prev, ...(draft.intakeRequired as Partial<IntakeRequiredFields>) }));
      }
      if (draft.intakeOptional && typeof draft.intakeOptional === "object") {
        setIntakeOptional((prev) => ({ ...prev, ...(draft.intakeOptional as Partial<IntakeOptionalFields>) }));
      }
      if (typeof draft.trainAiEnabled === "boolean") {
        setTrainAiEnabled(draft.trainAiEnabled);
      }
      if (typeof draft.intakeReviewMode === "string") {
        setIntakeReviewMode(draft.intakeReviewMode as IntakeReviewMode);
      }
    } catch {
      // ignore malformed draft payload
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(OCR_QUEUE_STORAGE_KEY, JSON.stringify(queuedReviewCardIds));
  }, [queuedReviewCardIds]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!intakeCardId && intakeStep === "front") {
      return;
    }
    const draft = {
      intakeStep,
      intakeReviewMode,
      intakeCardId,
      intakeBatchId,
      intakeBackPhotoId,
      intakeTiltPhotoId,
      intakeFrontPreview,
      intakeBackPreview,
      intakeTiltPreview,
      intakeRequired,
      intakeOptional,
      trainAiEnabled,
    };
    window.localStorage.setItem(OCR_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [
    intakeBackPhotoId,
    intakeBackPreview,
    intakeBatchId,
    intakeCardId,
    intakeFrontPreview,
    intakeOptional,
    intakeRequired,
    intakeReviewMode,
    intakeStep,
    intakeTiltPhotoId,
    intakeTiltPreview,
    trainAiEnabled,
  ]);

  useEffect(() => {
    if (queuedReviewCardIds.length === 0) {
      setSelectedQueueCardId(null);
      return;
    }
    if (!selectedQueueCardId || !queuedReviewCardIds.includes(selectedQueueCardId)) {
      setSelectedQueueCardId(queuedReviewCardIds[0]);
    }
  }, [queuedReviewCardIds, selectedQueueCardId]);

  const stopCameraStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    trackRef.current = null;
    setSupportsZoom(false);
    setZoomBounds({ min: 1, max: 1, step: 0.1 });
    setZoom(1);
    setCameraReady(false);
  }, []);

  const startCameraStream = useCallback(
    async (deviceId: string | null) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera capture is not supported on this device.");
        return false;
      }

      setCameraLoading(true);
      setCameraReady(false);

      stopCameraStream();

      const highResConstraints: MediaTrackConstraints = deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: 30 },
          }
        : {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          };

      let activeDeviceId: string | null = deviceId;

      try {
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: highResConstraints,
            audio: false,
          });
        } catch (error) {
          if (deviceId) {
            console.warn("[admin/uploads] High resolution stream failed, falling back to default camera", error);
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1440 },
              },
              audio: false,
            });
            activeDeviceId = null;
          } else {
            throw error;
          }
        }

        streamRef.current = stream;
        const [track] = stream.getVideoTracks();
        trackRef.current = track ?? null;

        await refreshVideoInputs();

        if (activeDeviceId) {
          setSelectedDeviceId(activeDeviceId);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(CAMERA_STORAGE_KEY, activeDeviceId);
          }
        } else if (typeof window !== "undefined") {
          window.localStorage.removeItem(CAMERA_STORAGE_KEY);
        }

        if (track && typeof track.getCapabilities === "function") {
          const capabilities = track.getCapabilities();
          const zoomCap: any = (capabilities as any).zoom;
          if (zoomCap && typeof zoomCap.min !== "undefined") {
            const min = typeof zoomCap.min === "number" ? zoomCap.min : 1;
            const max = typeof zoomCap.max === "number" ? zoomCap.max : min;
            const step = typeof zoomCap.step === "number" && zoomCap.step > 0 ? zoomCap.step : 0.1;
            const initial = (() => {
              const settings = (track.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number };
              const settingZoom = typeof settings.zoom === "number" ? settings.zoom : null;
              if (settingZoom !== null) {
                return Math.min(max, Math.max(min, settingZoom));
              }
              if (typeof zoomCap.default === "number") {
                return Math.min(max, Math.max(min, zoomCap.default));
              }
              return min;
            })();
            setSupportsZoom(max - min > 0.01);
            setZoomBounds({ min, max, step });
            setZoom(initial);
            await applyTrackZoom(track, initial);
          } else {
            setSupportsZoom(false);
            setZoomBounds({ min: 1, max: 1, step: 0.1 });
            setZoom(1);
          }
        } else {
          setSupportsZoom(false);
          setZoomBounds({ min: 1, max: 1, step: 0.1 });
          setZoom(1);
        }

        setCapturedBlob(null);
        setCapturePreviewUrl(null);
        setCameraError(null);
        setStreamVersion((token) => token + 1);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to access camera.";
        setCameraError(message);
        return false;
      } finally {
        setCameraLoading(false);
      }
    },
    [refreshVideoInputs, stopCameraStream]
  );

  const closeCamera = useCallback(() => {
    if (capturePreviewUrl) {
      URL.revokeObjectURL(capturePreviewUrl);
    }
    setCapturePreviewUrl(null);
    setCapturedBlob(null);
    setCameraError(null);
    setCameraOpen(false);
    stopCameraStream();
  }, [capturePreviewUrl, stopCameraStream]);

  const openCamera = useCallback(async () => {
    if (cameraOpen) {
      return;
    }
    const devices = await refreshVideoInputs();

    let initialDeviceId: string | null = null;
    if (selectedDeviceId && devices.some((device) => device.deviceId === selectedDeviceId)) {
      initialDeviceId = selectedDeviceId;
    } else {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(CAMERA_STORAGE_KEY) : null;
      if (stored && devices.some((device) => device.deviceId === stored)) {
        initialDeviceId = stored;
      } else {
        const instaDevice = devices.find(
          (device) => /insta360/i.test(device.label) && !/virtual/i.test(device.label)
        );
        if (instaDevice) {
          initialDeviceId = instaDevice.deviceId;
        } else if (devices.length > 0) {
          initialDeviceId = devices[0].deviceId;
        }
      }
    }

    const success = await startCameraStream(initialDeviceId);
    setCameraOpen(true);
    if (!success) {
      setCameraError((prev) => prev ?? "Unable to access camera.");
    }
  }, [cameraOpen, refreshVideoInputs, selectedDeviceId, startCameraStream]);

  const handleCameraSelection = useCallback(
    async (deviceId: string) => {
      const nextId = deviceId || null;
      setSelectedDeviceId(nextId);
      if (typeof window !== "undefined") {
        if (nextId) {
          window.localStorage.setItem(CAMERA_STORAGE_KEY, nextId);
        } else {
          window.localStorage.removeItem(CAMERA_STORAGE_KEY);
        }
      }

      if (cameraOpen) {
        const success = await startCameraStream(nextId);
        if (!success) {
          setCameraError("Failed to switch camera. Check the device connection.");
        }
      }
    },
    [cameraOpen, startCameraStream]
  );

  const handleRetake = useCallback(() => {
    if (capturePreviewUrl) {
      URL.revokeObjectURL(capturePreviewUrl);
    }
    setCapturePreviewUrl(null);
    setCapturedBlob(null);
    setCameraError(null);
    setCameraReady(true);
  }, [capturePreviewUrl]);

  const handleZoomChange = useCallback((value: number) => {
    setZoom(value);
    const track = trackRef.current;
    if (!track || typeof track.applyConstraints !== "function") {
      return;
    }
    void applyTrackZoom(track, value);
  }, []);


  useEffect(() => {
    if (!cameraOpen) {
      return;
    }
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      const playResult = video.play();
      if (playResult && typeof playResult.then === "function") {
        playResult
          .then(() => setCameraReady(true))
          .catch(() => setCameraReady(true));
      } else {
        setCameraReady(true);
      }
    }
  }, [cameraOpen, streamVersion]);

  useEffect(() => {
    if (!cameraOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      if (capturePreviewUrl) {
        URL.revokeObjectURL(capturePreviewUrl);
      }
      stopCameraStream();
    };
  }, [capturePreviewUrl, stopCameraStream]);

  useEffect(() => {
    if (videoInputs.length === 0) {
      return;
    }
    if (selectedDeviceId && videoInputs.some((device) => device.deviceId === selectedDeviceId)) {
      return;
    }
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(CAMERA_STORAGE_KEY) : null;
    const preferredFromStorage = stored && videoInputs.some((device) => device.deviceId === stored) ? stored : null;
    const instaDevice = videoInputs.find(
      (device) => /insta360/i.test(device.label) && !/virtual/i.test(device.label)
    );
    const fallbackId = preferredFromStorage ?? instaDevice?.deviceId ?? videoInputs[0]?.deviceId ?? null;
    if (fallbackId) {
      setSelectedDeviceId(fallbackId);
    }
  }, [selectedDeviceId, videoInputs]);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const missingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  useEffect(() => {
    if (!submitting) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submitting]);

  const fetchBatches = useCallback(
    async (signal?: AbortSignal) => {
      if (!session?.token || !isAdmin) {
        return;
      }

      setBatchesLoading(true);
      setBatchesError(null);
      try {
        const res = await fetch("/api/admin/batches?limit=20", {
          headers: buildAdminHeaders(session.token),
          signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load batches");
        }
        const data = (await res.json()) as { batches: BatchSummary[] };
        setBatches(data.batches);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load batches";
        setBatchesError(message);
      } finally {
        if (!signal?.aborted) {
          setBatchesLoading(false);
        }
      }
    },
    [session?.token, isAdmin]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchBatches(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchBatches]);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      appendFiles(Array.from(event.target.files));
      event.target.value = "";
    }
  };

  const resolveApiUrl = useCallback(
    (path: string) => {
      if (/^https?:\/\//.test(path)) {
        return path;
      }
      if (!apiBase) {
        return path;
      }
      return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    },
    [apiBase]
  );

  const isRemoteApi = useMemo(
    () =>
      typeof window !== "undefined" &&
      apiBase.length > 0 &&
      !apiBase.startsWith(window.location.origin),
    [apiBase]
  );

  const resetOcrState = useCallback(() => {
    setOcrStatus(null);
    setOcrAudit(null);
    setOcrApplied(false);
    setOcrMode(null);
    setOcrError(null);
    ocrSuggestRef.current = false;
    ocrRetryRef.current = 0;
    ocrRequestIdRef.current = 0;
    ocrCardIdRef.current = null;
    ocrBackupRef.current = null;
    ocrAppliedFieldsRef.current = [];
    ocrOptionalBackupRef.current = null;
    ocrAppliedOptionalFieldsRef.current = [];
    photoroomRequestedRef.current = null;
  }, []);

  const clearActiveIntakeState = useCallback(() => {
    setIntakeStep("front");
    setIntakeReviewMode("capture");
    setIntakeRequired({
      category: "sport",
      playerName: "",
      sport: "",
      manufacturer: "",
      year: "",
      cardName: "",
      game: "",
    });
      setIntakeOptional({
        teamName: "",
        productLine: "",
        insertSet: "",
        parallel: "",
        cardNumber: "",
        numbered: "",
        autograph: false,
        memorabilia: false,
      graded: false,
      gradeCompany: "",
      gradeValue: "",
      tcgSeries: "",
      tcgRarity: "",
      tcgFoil: false,
      tcgLanguage: "",
      tcgOutOf: "",
    });
    setIntakeCardId(null);
    setIntakeBatchId(null);
    setIntakeBackPhotoId(null);
    setIntakeTiltPhotoId(null);
    setIntakeFrontPreview(null);
    setIntakeBackPreview(null);
    setIntakeTiltPreview(null);
    setIntakeError(null);
    setIntakeCaptureTarget(null);
    setPendingBackBlob(null);
    setPendingTiltBlob(null);
    setIntakePhotoBusy(false);
    setIntakeSuggested({});
    setIntakeTouched({});
    setIntakeOptionalTouched({});
    setTrainAiEnabled(false);
    setTeachBusy(false);
    setTeachFeedback(null);
    setTeachLayoutClass("base");
    setTeachRegionSide("FRONT");
    setTeachRegionsBySide(buildEmptyTeachRegionsBySide());
    setTeachRegionDraft(null);
    setTeachRegionBindDraft(null);
    setTeachRegionLoading(false);
    setTeachRegionBusy(false);
    setTeachRegionFeedback(null);
    setProductLineOptions([]);
    setInsertSetOptions([]);
    setParallelOptions([]);
    setVariantOptionItems([]);
    setVariantScopeSummary(null);
    setVariantCatalog([]);
    setOptionPreviewUrls({});
    resetOcrState();
    restoredDraftRef.current = false;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(OCR_DRAFT_STORAGE_KEY);
    }
  }, [resetOcrState]);

  const resetIntake = useCallback(() => {
    clearActiveIntakeState();
    setQueuedReviewCardIds([]);
    setSelectedQueueCardId(null);
  }, [clearActiveIntakeState]);

  const openIntakeCapture = useCallback(
    async (target: "front" | "back" | "tilt") => {
      setIntakeCaptureTarget(target);
      setIntakeError(null);
      await openCamera();
    },
    [openCamera]
  );

  const buildIntakeQuery = useCallback(() => {
    const year = intakeRequired.year.trim();
    const manufacturer = intakeRequired.manufacturer.trim();
    const primary =
      intakeRequired.category === "sport"
        ? intakeRequired.playerName.trim()
        : intakeRequired.cardName.trim();
    const productLineRaw = intakeOptional.productLine.trim();
    const insertSet = intakeOptional.insertSet.trim();
    const parallel = intakeOptional.parallel.trim();
    const cardNumber = intakeOptional.cardNumber.trim();
    const gradeCompany = intakeOptional.graded ? intakeOptional.gradeCompany.trim() : "";
    const gradeValue = intakeOptional.graded ? intakeOptional.gradeValue.trim() : "";
    const grade = [gradeCompany, gradeValue].filter((part) => part.length > 0).join(" ");
    const numbered = intakeOptional.numbered.trim();
    const normalizeProductLine = () => {
      if (!productLineRaw) {
        return "";
      }
      if (!manufacturer) {
        return productLineRaw;
      }
      const manufacturerTokens = manufacturer
        .split(/\s+/)
        .map((token) => token.toLowerCase())
        .filter(Boolean);
      if (!manufacturerTokens.length) {
        return productLineRaw;
      }
      const filteredTokens = productLineRaw
        .split(/\s+/)
        .filter((token) => !manufacturerTokens.includes(token.toLowerCase()));
      return filteredTokens.join(" ").trim() || productLineRaw;
    };
    const productLine = normalizeProductLine();
    const autograph = intakeOptional.autograph ? "Auto" : "";
    const memorabilia = intakeOptional.memorabilia ? "Patch" : "";
    const parts = [
      year,
      manufacturer,
      productLine,
      insertSet,
      primary,
      cardNumber,
      parallel,
      numbered,
      autograph,
      memorabilia,
      grade,
    ]
      .filter((part) => part.length > 0)
      .map((part) => part.trim());
    const seen = new Set<string>();
    const normalizedParts = parts.filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return normalizedParts.join(" ").replace(/\s+/g, " ").trim();
  }, [
    intakeOptional.cardNumber,
    intakeOptional.numbered,
    intakeOptional.insertSet,
    intakeOptional.parallel,
    intakeOptional.gradeCompany,
    intakeOptional.gradeValue,
    intakeOptional.graded,
    intakeOptional.productLine,
    intakeOptional.autograph,
    intakeOptional.memorabilia,
    intakeRequired.category,
    intakeRequired.cardName,
    intakeRequired.manufacturer,
    intakeRequired.playerName,
    intakeRequired.year,
  ]);

  const markTouched = useCallback((field: string) => {
    setIntakeTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const handleRequiredChange = useCallback(
    (field: keyof typeof intakeRequired) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      markTouched(field as string);
      setIntakeRequired((prev) => ({ ...prev, [field]: event.target.value }));
    },
    [markTouched]
  );

  const handleOptionalChange = useCallback(
    (field: keyof typeof intakeOptional) => (event: ChangeEvent<HTMLInputElement>) => {
      setIntakeOptionalTouched((prev) => ({ ...prev, [field]: true }));
      setIntakeOptional((prev) => ({ ...prev, [field]: event.target.value }));
    },
    []
  );

  const suggestedClass = (field: string, value: string) => {
    const suggestion = intakeSuggested[field];
    if (!suggestion) {
      return "";
    }
    if (intakeTouched[field]) {
      return "";
    }
    return value.trim() === suggestion.trim() ? "border-amber-400/70 bg-amber-500/10" : "";
  };

  const uploadCardAsset = useCallback(
    async (file: File) => {
      const token = session?.token;
      if (!token) {
        throw new Error("Your session expired. Sign in again and retry.");
      }

      const optimizedFile = file;
      const presignRes = await fetch(resolveApiUrl("/api/admin/uploads/presign"), {
        method: "POST",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(token),
        },
        body: JSON.stringify({
          fileName: optimizedFile.name,
          size: optimizedFile.size,
          mimeType: optimizedFile.type || file.type,
          reviewStage: "ADD_ITEMS",
        }),
      });

      if (!presignRes.ok) {
        const payload = await presignRes.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to generate upload URL");
      }

      const presignPayload = (await presignRes.json()) as {
        assetId: string;
        batchId: string;
        uploadUrl: string;
        fields: Record<string, string>;
        publicUrl: string;
        storageMode: string;
        acl?: string | null;
      };

      if (
        presignPayload.storageMode !== "local" &&
        presignPayload.storageMode !== "mock" &&
        presignPayload.storageMode !== "s3"
      ) {
        throw new Error("Unsupported storage mode returned by server");
      }

      const uploadHeaders: Record<string, string> = {
        "Content-Type": optimizedFile.type || file.type,
      };
      if (presignPayload.storageMode === "s3" && presignPayload.acl) {
        uploadHeaders["x-amz-acl"] = presignPayload.acl;
      } else if (presignPayload.storageMode !== "s3") {
        Object.assign(uploadHeaders, buildAdminHeaders(token));
      }

      const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
        method: "PUT",
        mode: presignPayload.storageMode === "s3" ? "cors" : isRemoteApi ? "cors" : "same-origin",
        headers: {
          ...uploadHeaders,
        },
        body: optimizedFile,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(text || "Failed to store file");
      }

      const completeRes = await fetch(resolveApiUrl("/api/admin/uploads/complete"), {
        method: "POST",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(token),
        },
        body: JSON.stringify({
          assetId: presignPayload.assetId,
          fileName: optimizedFile.name,
          mimeType: optimizedFile.type || file.type,
          size: optimizedFile.size,
        }),
      });

      if (!completeRes.ok) {
        const payload = await completeRes.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to record upload");
      }

      return presignPayload;
    },
    [isRemoteApi, resolveApiUrl, session?.token]
  );

  const uploadCardPhoto = useCallback(
    async (file: File, kind: "BACK" | "TILT") => {
      const token = session?.token;
      if (!token) {
        throw new Error("Your session expired. Sign in again and retry.");
      }
      if (!intakeCardId) {
        throw new Error("Card asset not found. Capture the front image first.");
      }

      const optimizedFile = file;
      const presignRes = await fetch(resolveApiUrl("/api/admin/kingsreview/photos/presign"), {
        method: "POST",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(token),
        },
        body: JSON.stringify({
          cardAssetId: intakeCardId,
          kind,
          fileName: optimizedFile.name,
          size: optimizedFile.size,
          mimeType: optimizedFile.type || file.type,
        }),
      });

      if (!presignRes.ok) {
        const payload = await presignRes.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to generate upload URL");
      }

      const presignPayload = (await presignRes.json()) as {
        photoId: string;
        uploadUrl: string;
        publicUrl: string;
        storageMode: string;
        acl?: string | null;
      };

      if (
        presignPayload.storageMode !== "local" &&
        presignPayload.storageMode !== "mock" &&
        presignPayload.storageMode !== "s3"
      ) {
        throw new Error("Unsupported storage mode returned by server");
      }

      const uploadHeaders: Record<string, string> = {
        "Content-Type": optimizedFile.type || file.type,
      };
      if (presignPayload.storageMode === "s3" && presignPayload.acl) {
        uploadHeaders["x-amz-acl"] = presignPayload.acl;
      } else if (presignPayload.storageMode !== "s3") {
        Object.assign(uploadHeaders, buildAdminHeaders(token));
      }

      const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
        method: "PUT",
        mode: presignPayload.storageMode === "s3" ? "cors" : isRemoteApi ? "cors" : "same-origin",
        headers: {
          ...uploadHeaders,
        },
        body: optimizedFile,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(text || "Failed to store file");
      }

      try {
        await fetch(resolveApiUrl("/api/admin/kingsreview/photos/process?mode=thumbnail"), {
          method: "POST",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify({ photoId: presignPayload.photoId }),
        });
      } catch (error) {
        console.warn("Thumbnail generation failed for card photo", error);
      }

      return presignPayload;
    },
    [intakeCardId, isRemoteApi, resolveApiUrl, session?.token]
  );

  const saveIntakeMetadata = useCallback(
    async (includeOptional: boolean, recordOcrFeedback = false, trainAi = false) => {
      const token = session?.token;
      if (!token) {
        throw new Error("Your session expired. Sign in again and retry.");
      }
      if (!intakeCardId) {
        throw new Error("Card asset not found.");
      }

      const attributes = {
        playerName: intakeRequired.category === "sport" ? intakeRequired.playerName.trim() : null,
        teamName: intakeOptional.teamName.trim() || null,
        year: intakeRequired.year.trim() || null,
        brand: intakeRequired.manufacturer.trim() || null,
        setName: intakeOptional.insertSet.trim() || null,
        variantKeywords: intakeOptional.parallel.trim() ? [intakeOptional.parallel.trim()] : [],
        numbered: intakeOptional.numbered.trim() || null,
        rookie: false,
        autograph: includeOptional ? intakeOptional.autograph : false,
        memorabilia: includeOptional ? intakeOptional.memorabilia : false,
        gradeCompany: includeOptional ? intakeOptional.gradeCompany.trim() || null : null,
        gradeValue: includeOptional ? intakeOptional.gradeValue.trim() || null : null,
      };

      const normalized = {
        categoryType: intakeRequired.category,
        displayName:
          intakeRequired.category === "sport"
            ? intakeRequired.playerName.trim()
            : intakeRequired.cardName.trim(),
        cardNumber: intakeOptional.cardNumber.trim() || null,
        setName: intakeOptional.productLine.trim() || null,
        setCode: intakeOptional.insertSet.trim() || null,
        year: intakeRequired.year.trim() || null,
        company: intakeRequired.manufacturer.trim() || null,
        rarity: includeOptional ? intakeOptional.tcgRarity.trim() || null : null,
        links: {},
        sport:
          intakeRequired.category === "sport"
            ? {
                playerName: intakeRequired.playerName.trim() || null,
                teamName: intakeOptional.teamName.trim() || null,
                league: null,
                sport: intakeRequired.sport.trim() || null,
                cardType: null,
                subcategory: null,
                autograph: includeOptional ? intakeOptional.autograph : null,
                foil: null,
                graded: includeOptional ? (intakeOptional.graded ? true : false) : null,
                gradeCompany: includeOptional ? intakeOptional.gradeCompany.trim() || null : null,
                grade: includeOptional ? intakeOptional.gradeValue.trim() || null : null,
              }
            : undefined,
        tcg:
          intakeRequired.category === "tcg"
            ? {
                cardName: intakeRequired.cardName.trim() || null,
                game: intakeRequired.game.trim() || null,
                series: includeOptional ? intakeOptional.tcgSeries.trim() || null : null,
                color: null,
                type: null,
                language: includeOptional ? intakeOptional.tcgLanguage.trim() || null : null,
                foil: includeOptional ? (intakeOptional.tcgFoil ? true : false) : null,
                rarity: includeOptional ? intakeOptional.tcgRarity.trim() || null : null,
                outOf: includeOptional ? intakeOptional.tcgOutOf.trim() || null : null,
                subcategory: null,
              }
            : undefined,
        comics: undefined,
      };

      const payload = {
        classificationUpdates: {
          attributes,
          normalized,
        },
        recordOcrFeedback,
        trainAiEnabled: trainAi,
      };

      const updateRes = await fetch(resolveApiUrl("/api/admin/cards/" + intakeCardId), {
        method: "PATCH",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(token),
        },
        body: JSON.stringify(payload),
      });

      if (!updateRes.ok) {
        const payload = await updateRes.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to save card metadata");
      }
    },
    [
      intakeCardId,
      intakeOptional,
      intakeRequired,
      isRemoteApi,
      resolveApiUrl,
      session?.token,
    ]
  );

  const loadQueuedCardForReview = useCallback(
    async (cardId: string) => {
      const token = session?.token;
      if (!token) {
        throw new Error("Your session expired. Sign in again and retry.");
      }
      const res = await fetch(resolveApiUrl(`/api/admin/cards/${cardId}`), {
        headers: buildAdminHeaders(token),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to load card for OCR review");
      }

      const payload = (await res.json()) as Record<string, any>;
      const photos = Array.isArray(payload.photos) ? payload.photos : [];
      const backPhoto = photos.find((photo: any) => photo?.kind === "BACK") ?? null;
      const tiltPhoto = photos.find((photo: any) => photo?.kind === "TILT") ?? null;
      const ocrFields = (payload.ocrSuggestions?.data?.fields ?? {}) as Record<string, string | null>;
      const normalized = (payload.classificationNormalized ?? {}) as Record<string, any>;
      const attributes = (payload.classification ?? {}) as Record<string, any>;
      const categoryType = normalized.categoryType === "tcg" ? "tcg" : "sport";

      setIntakeCardId(typeof payload.id === "string" ? payload.id : cardId);
      setIntakeBatchId(typeof payload.batchId === "string" ? payload.batchId : null);
      setIntakeFrontPreview(payload.imageUrl ?? null);
      setIntakeBackPreview(backPhoto?.imageUrl ?? null);
      setIntakeTiltPreview(tiltPhoto?.imageUrl ?? null);
      setIntakeBackPhotoId(backPhoto?.id ?? null);
      setIntakeTiltPhotoId(tiltPhoto?.id ?? null);

      const nextProductLineRaw = sanitizeNullableText(normalized.setName ?? ocrFields.setName ?? "");
      const nextProductLine = isActionableProductLineHint(nextProductLineRaw) ? nextProductLineRaw : "";
      const inferredSport = inferSportFromProductLine(nextProductLineRaw);
      setIntakeRequired({
        category: categoryType,
        playerName:
          categoryType === "sport"
            ? sanitizeNullableText(attributes.playerName ?? ocrFields.playerName ?? "")
            : "",
        sport:
          categoryType === "sport"
            ? sanitizeNullableText(attributes.sport ?? ocrFields.sport ?? inferredSport)
            : "",
        manufacturer: sanitizeNullableText(attributes.brand ?? normalized.company ?? ocrFields.manufacturer ?? ""),
        year: sanitizeNullableText(attributes.year ?? normalized.year ?? ocrFields.year ?? ""),
        cardName:
          categoryType === "tcg"
            ? sanitizeNullableText(attributes.cardName ?? normalized.displayName ?? ocrFields.cardName ?? "")
            : "",
        game:
          categoryType === "tcg" ? sanitizeNullableText(attributes.game ?? ocrFields.game ?? "") : "",
      });

      setIntakeOptional({
        teamName: sanitizeNullableText(attributes.teamName ?? ""),
        productLine: nextProductLine,
        insertSet: sanitizeNullableText(normalized.setCode ?? ""),
        parallel: sanitizeNullableText((attributes.variantKeywords ?? [])[0] ?? ocrFields.parallel ?? ""),
        cardNumber: sanitizeNullableText(normalized.cardNumber ?? ocrFields.cardNumber ?? ""),
        numbered: sanitizeNullableText(attributes.numbered ?? ocrFields.numbered ?? ""),
        autograph: Boolean(attributes.autograph ?? false),
        memorabilia: Boolean(attributes.memorabilia ?? false),
        graded:
          String(ocrFields.graded ?? "").toLowerCase() === "true" ||
          (Boolean(ocrFields.gradeCompany) && Boolean(ocrFields.gradeValue)),
        gradeCompany: sanitizeNullableText(attributes.gradeCompany ?? ocrFields.gradeCompany ?? ""),
        gradeValue: sanitizeNullableText(attributes.gradeValue ?? ocrFields.gradeValue ?? ""),
        tcgSeries: "",
        tcgRarity: sanitizeNullableText(normalized.rarity ?? ""),
        tcgFoil: false,
        tcgLanguage: "",
        tcgOutOf: "",
      });
      const nextInsertSet = sanitizeNullableText(normalized.setCode ?? "");
      const nextParallel = sanitizeNullableText((attributes.variantKeywords ?? [])[0] ?? ocrFields.parallel ?? "");
      const nextAutograph =
        Boolean(attributes.autograph ?? false) || String(ocrFields.autograph ?? "").toLowerCase() === "true";
      if (nextInsertSet) {
        setTeachLayoutClass(`insert_${normalizeTeachLayoutClass(nextInsertSet)}`);
      } else if (nextParallel) {
        setTeachLayoutClass(`parallel_${normalizeTeachLayoutClass(nextParallel)}`);
      } else if (nextAutograph) {
        setTeachLayoutClass("autograph");
      } else {
      setTeachLayoutClass("base");
      }
      setTeachRegionSide("FRONT");
      setTeachRegionsBySide(buildEmptyTeachRegionsBySide());
      setTeachRegionDraft(null);
      setTeachRegionBindDraft(null);
      setTeachRegionFeedback(null);

      setIntakeSuggested(
        Object.entries(ocrFields).reduce<Record<string, string>>((acc, [key, value]) => {
          const cleaned = sanitizeNullableText(typeof value === "string" ? value : "");
          if (cleaned) {
            acc[key] = cleaned;
          }
          return acc;
        }, {})
      );
      setIntakeTouched({});
      setIntakeOptionalTouched({});
      setOcrAudit((payload.ocrSuggestions?.data as Record<string, unknown> | null) ?? null);
      setTeachBusy(false);
      setTeachFeedback(null);
      setOcrStatus(payload.ocrSuggestions?.data ? "ready" : "empty");
      setOcrError(null);
      setOcrApplied(false);
      setOcrMode(null);
      setIntakeReviewMode("review");
      setIntakeStep("required");
      setIntakeError(null);
      setQueuedReviewCardIds((prev) => prev.filter((id) => id !== cardId));
    },
    [resolveApiUrl, session?.token]
  );

  useEffect(() => {
    if (restoredDraftRef.current) {
      return;
    }
    if (!session?.token || !intakeCardId || (intakeStep !== "required" && intakeStep !== "optional")) {
      return;
    }
    restoredDraftRef.current = true;
    void loadQueuedCardForReview(intakeCardId).catch(() => undefined);
  }, [intakeCardId, intakeStep, loadQueuedCardForReview, session?.token]);

  const validateRequiredIntake = useCallback(() => {
    if (!intakeCardId) {
      return "Capture the front of the card first.";
    }
    const hasBackCapture = Boolean(intakeBackPhotoId || intakeBackPreview || pendingBackBlob);
    if (!hasBackCapture) {
      return "Capture the back of the card before continuing.";
    }
    const hasTiltCapture = Boolean(intakeTiltPhotoId || intakeTiltPreview || pendingTiltBlob);
    if (!hasTiltCapture) {
      return "Capture the tilt photo before continuing.";
    }
    if (intakeRequired.category === "sport") {
      if (!intakeRequired.playerName.trim()) {
        return "Player name is required.";
      }
      if (!intakeOptional.productLine.trim()) {
        return "Product line / set is required.";
      }
    } else {
      if (!intakeRequired.cardName.trim()) {
        return "Card name is required.";
      }
      if (!intakeRequired.game.trim()) {
        return "Game is required.";
      }
    }
    if (!intakeRequired.manufacturer.trim()) {
      return "Manufacturer is required.";
    }
    if (!intakeRequired.year.trim()) {
      return "Year is required.";
    }
    return null;
  }, [
    intakeBackPhotoId,
    intakeBackPreview,
    intakeCardId,
    intakeOptional.productLine,
    intakeRequired,
    intakeTiltPhotoId,
    intakeTiltPreview,
    pendingBackBlob,
    pendingTiltBlob,
  ]);

  useEffect(() => {
    if (intakeRequired.category !== "sport") {
      return;
    }
    const inferred = inferSportFromProductLine(intakeOptional.productLine);
    if (!inferred || inferred === intakeRequired.sport) {
      return;
    }
    setIntakeRequired((prev) => ({ ...prev, sport: inferred }));
  }, [intakeOptional.productLine, intakeRequired.category, intakeRequired.sport]);

  useEffect(() => {
    if (intakeRequired.category !== "sport" || productLineOptions.length === 0) {
      return;
    }
    const current = sanitizeNullableText(intakeOptional.productLine);
    if (current && productLineOptions.some((option) => option.toLowerCase() === current.toLowerCase())) {
      return;
    }
    if (current) {
      return;
    }
    const suggestedSetName = sanitizeNullableText(intakeSuggested.setName);
    const actionableSuggestedSetName = isActionableProductLineHint(suggestedSetName) ? suggestedSetName : "";
    // Phase 3 unknown-first policy: avoid heuristic-only set auto-picks.
    if (!actionableSuggestedSetName) {
      return;
    }
    const candidate = pickBestCandidate(productLineOptions, [
      actionableSuggestedSetName,
    ], 1.1);
    if (candidate) {
      setIntakeOptional((prev) => ({ ...prev, productLine: candidate }));
    }
  }, [
    intakeOptional.productLine,
    intakeRequired.category,
    intakeSuggested.setName,
    productLineOptions,
  ]);

  useEffect(() => {
    if (intakeRequired.category !== "sport" || insertSetOptions.length === 0) {
      return;
    }
    if (sanitizeNullableText(intakeOptional.insertSet) || intakeOptionalTouched.insertSet) {
      return;
    }
    const suggestedInsertSet = sanitizeNullableText(intakeSuggested.insertSet);
    if (!suggestedInsertSet) {
      return;
    }
    const candidate = pickBestCandidate(
      insertSetOptions,
      [suggestedInsertSet, sanitizeNullableText(intakeSuggested.parallel), sanitizeNullableText(intakeOptional.productLine)],
      0.6
    );
    if (candidate) {
      setIntakeOptional((prev) => ({ ...prev, insertSet: candidate }));
    }
  }, [
    intakeOptional.insertSet,
    intakeOptional.productLine,
    intakeOptionalTouched.insertSet,
    intakeRequired.category,
    intakeSuggested.insertSet,
    intakeSuggested.parallel,
    insertSetOptions,
  ]);

  useEffect(() => {
    if (intakeRequired.category !== "sport" || parallelOptions.length === 0) {
      return;
    }
    if (sanitizeNullableText(intakeOptional.parallel) || intakeOptionalTouched.parallel) {
      return;
    }
    const suggestedParallel = sanitizeNullableText(intakeSuggested.parallel);
    if (!suggestedParallel) {
      return;
    }
    const candidate = pickBestCandidate(
      parallelOptions,
      [suggestedParallel, sanitizeNullableText(intakeSuggested.insertSet), sanitizeNullableText(intakeOptional.productLine)],
      0.6
    );
    if (candidate) {
      setIntakeOptional((prev) => ({ ...prev, parallel: candidate }));
    }
  }, [
    intakeOptional.parallel,
    intakeOptional.productLine,
    intakeOptionalTouched.parallel,
    intakeRequired.category,
    intakeSuggested.insertSet,
    intakeSuggested.parallel,
    parallelOptions,
  ]);

  const applySuggestions = useCallback(
    (suggestions: Record<string, string>) => {
      if (!ocrApplied) {
        ocrBackupRef.current = intakeRequired;
        ocrAppliedFieldsRef.current = [];
        ocrOptionalBackupRef.current = intakeOptional;
        ocrAppliedOptionalFieldsRef.current = [];
      }
      setIntakeSuggested((prev) => ({ ...prev, ...suggestions }));
      setIntakeRequired((prev) => {
        const next = { ...prev };
        if (prev.category === "sport" && suggestions.playerName && !intakeTouched.playerName && !prev.playerName.trim()) {
          next.playerName = suggestions.playerName;
          ocrAppliedFieldsRef.current.push("playerName");
        }
        if (suggestions.year && !intakeTouched.year && !prev.year.trim()) {
          next.year = suggestions.year;
          ocrAppliedFieldsRef.current.push("year");
        }
        if (suggestions.manufacturer && !intakeTouched.manufacturer && !prev.manufacturer.trim()) {
          next.manufacturer = suggestions.manufacturer;
          ocrAppliedFieldsRef.current.push("manufacturer");
        }
        if (prev.category === "sport" && suggestions.sport && !intakeTouched.sport && !prev.sport.trim()) {
          next.sport = suggestions.sport;
          ocrAppliedFieldsRef.current.push("sport");
        }
        if (prev.category === "tcg" && suggestions.game && !intakeTouched.game && !prev.game.trim()) {
          next.game = suggestions.game;
          ocrAppliedFieldsRef.current.push("game");
        }
        if (prev.category === "tcg" && suggestions.cardName && !intakeTouched.cardName && !prev.cardName.trim()) {
          next.cardName = suggestions.cardName;
          ocrAppliedFieldsRef.current.push("cardName");
        }
        return next;
      });
      setIntakeOptional((prev) => {
        const next = { ...prev };
        const rawSuggestedProductLine = sanitizeNullableText(suggestions.setName);
        const suggestedProductLine = isActionableProductLineHint(rawSuggestedProductLine)
          ? rawSuggestedProductLine
          : "";
        const suggestedInsertSet = sanitizeNullableText(suggestions.insertSet);
        const suggestedParallel = sanitizeNullableText(suggestions.parallel);
        const constrainedProductLine =
          suggestedProductLine && productLineOptions.length > 0
            ? pickBestCandidate(productLineOptions, [
                suggestedProductLine,
                `${sanitizeNullableText(intakeRequired.year)} ${sanitizeNullableText(intakeRequired.manufacturer)} ${sanitizeNullableText(
                  intakeRequired.sport
                )}`.trim(),
              ], 1.1)
            : null;
        if (constrainedProductLine && !intakeOptionalTouched.productLine && !prev.productLine.trim()) {
          next.productLine = constrainedProductLine;
          ocrAppliedOptionalFieldsRef.current.push("productLine");
        }
        const constrainedInsert =
          suggestedInsertSet && insertSetOptions.length > 0
            ? pickBestCandidate(insertSetOptions, [suggestedInsertSet, suggestedProductLine, suggestedParallel], 0.6)
            : null;
        if (constrainedInsert && !intakeOptionalTouched.insertSet && !prev.insertSet.trim()) {
          next.insertSet = constrainedInsert;
          ocrAppliedOptionalFieldsRef.current.push("insertSet");
        }
        const constrainedParallel =
          suggestedParallel && parallelOptions.length > 0
            ? pickBestCandidate(parallelOptions, [suggestedParallel, suggestedInsertSet, suggestedProductLine], 0.6)
            : null;
        if (constrainedParallel && !intakeOptionalTouched.parallel && !prev.parallel.trim()) {
          next.parallel = constrainedParallel;
          ocrAppliedOptionalFieldsRef.current.push("parallel");
        }
        if (suggestions.cardNumber && !intakeOptionalTouched.cardNumber && !prev.cardNumber.trim()) {
          next.cardNumber = suggestions.cardNumber;
          ocrAppliedOptionalFieldsRef.current.push("cardNumber");
        }
        if (suggestions.numbered && !intakeOptionalTouched.numbered && !prev.numbered.trim()) {
          next.numbered = suggestions.numbered;
          ocrAppliedOptionalFieldsRef.current.push("numbered");
        }
        if (
          suggestions.graded &&
          !intakeOptionalTouched.graded &&
          !prev.graded &&
          ["true", "yes", "1"].includes(suggestions.graded.toLowerCase())
        ) {
          next.graded = true;
          ocrAppliedOptionalFieldsRef.current.push("graded");
        }
        if (
          suggestions.autograph &&
          !intakeOptionalTouched.autograph &&
          !prev.autograph &&
          ["true", "yes", "1"].includes(suggestions.autograph.toLowerCase())
        ) {
          next.autograph = true;
          ocrAppliedOptionalFieldsRef.current.push("autograph");
        }
        if (
          suggestions.memorabilia &&
          !intakeOptionalTouched.memorabilia &&
          !prev.memorabilia &&
          ["true", "yes", "1"].includes(suggestions.memorabilia.toLowerCase())
        ) {
          next.memorabilia = true;
          ocrAppliedOptionalFieldsRef.current.push("memorabilia");
        }
        if (suggestions.gradeCompany && !intakeOptionalTouched.gradeCompany && !prev.gradeCompany.trim()) {
          next.gradeCompany = suggestions.gradeCompany;
          ocrAppliedOptionalFieldsRef.current.push("gradeCompany");
        }
        if (suggestions.gradeValue && !intakeOptionalTouched.gradeValue && !prev.gradeValue.trim()) {
          next.gradeValue = suggestions.gradeValue;
          ocrAppliedOptionalFieldsRef.current.push("gradeValue");
        }
        return next;
      });
      setOcrApplied(true);
    },
    [
      intakeTouched.cardName,
      intakeTouched.game,
      intakeTouched.manufacturer,
      intakeTouched.playerName,
      intakeTouched.sport,
      intakeTouched.year,
      intakeOptional,
      intakeRequired,
      productLineOptions,
      ocrApplied,
      intakeOptionalTouched.cardNumber,
      intakeOptionalTouched.productLine,
      intakeOptionalTouched.insertSet,
      intakeOptionalTouched.parallel,
      insertSetOptions,
      parallelOptions,
      intakeOptionalTouched.numbered,
      intakeOptionalTouched.autograph,
      intakeOptionalTouched.memorabilia,
      intakeOptionalTouched.graded,
      intakeOptionalTouched.gradeCompany,
      intakeOptionalTouched.gradeValue,
    ]
  );

  const triggerPhotoroomForCard = useCallback(
    async (cardId: string) => {
      if (!session?.token) {
        return { ok: false as const, message: "Your session expired. Sign in again and retry." };
      }
      try {
        const res = await fetch(resolveApiUrl(`/api/admin/cards/${cardId}/photoroom`), {
          method: "POST",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(session.token),
          },
        });
        const payload = (await res.json().catch(() => ({}))) as { message?: string; processed?: number; skipped?: number };
        if (!res.ok) {
          return { ok: false as const, message: payload?.message ?? "PhotoRoom background removal failed." };
        }
        const message = typeof payload?.message === "string" ? payload.message : "PhotoRoom processed.";
        if (/not configured/i.test(message)) {
          return { ok: false as const, message: "PhotoRoom is not configured in this environment." };
        }
        return { ok: true as const, message };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : "PhotoRoom background removal failed.",
        };
      }
    },
    [isRemoteApi, resolveApiUrl, session?.token]
  );


  const fetchOcrSuggestions = useCallback(async (cardId: string) => {
    if (!session?.token) {
      setOcrStatus("error");
      setOcrError("Your session expired. Sign in again and retry.");
      return;
    }
    if (!cardId) {
      setOcrStatus("error");
      setOcrError("Card asset not ready yet. Wait a moment and retry.");
      return;
    }
    const requestId = ocrRequestIdRef.current + 1;
    ocrRequestIdRef.current = requestId;
    ocrCardIdRef.current = cardId;
    try {
      setOcrStatus("running");
      setOcrError(null);
      const params = new URLSearchParams();
      const hintYear = sanitizeNullableText(intakeRequired.year);
      const hintManufacturer = sanitizeNullableText(intakeRequired.manufacturer);
      const hintSport = sanitizeNullableText(intakeRequired.sport);
      const hintProductLine = sanitizeNullableText(intakeOptional.productLine);
      const hintLayoutClass = normalizeTeachLayoutClass(teachLayoutClass);
      if (hintYear) {
        params.set("year", hintYear);
      }
      if (hintManufacturer) {
        params.set("manufacturer", hintManufacturer);
      }
      if (hintSport) {
        params.set("sport", hintSport);
      }
      if (hintProductLine) {
        params.set("productLine", hintProductLine);
        params.set("setId", hintProductLine);
      }
      if (hintLayoutClass) {
        params.set("layoutClass", hintLayoutClass);
      }
      const endpoint =
        params.size > 0
          ? `/api/admin/cards/${cardId}/ocr-suggest?${params.toString()}`
          : `/api/admin/cards/${cardId}/ocr-suggest`;
      const res = await fetch(endpoint, {
        headers: buildAdminHeaders(session.token),
      });
      if (ocrRequestIdRef.current !== requestId || ocrCardIdRef.current !== cardId) {
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setOcrStatus("error");
        setOcrError(payload?.message ?? "OCR request failed");
        return;
      }
      const payload = await res.json();
      if (ocrRequestIdRef.current !== requestId || ocrCardIdRef.current !== cardId) {
        return;
      }
      setOcrAudit(payload?.audit ?? null);
      if (payload?.status === "pending") {
        setOcrStatus("pending");
        if (ocrRetryRef.current < 6) {
          ocrRetryRef.current += 1;
          setTimeout(() => {
            if (ocrCardIdRef.current !== cardId) {
              return;
            }
            void fetchOcrSuggestions(cardId);
          }, 1500);
        }
        return;
      }
      if (photoroomRequestedRef.current !== cardId) {
        photoroomRequestedRef.current = cardId;
        void triggerPhotoroomForCard(cardId).then((result) => {
          if (!result.ok) {
            console.warn("PhotoRoom background removal failed", result.message);
          }
        });
      }
      const suggestions = payload?.suggestions ?? {};
      if (Object.keys(suggestions).length > 0) {
        applySuggestions(suggestions);
        setOcrMode("high");
        setOcrStatus("ready");
      } else {
        setOcrApplied(false);
        setOcrMode(null);
        setOcrStatus("empty");
      }
    } catch {
      setOcrStatus("error");
      setOcrError("OCR request failed");
      // ignore suggestion failures
    }
  }, [
    applySuggestions,
    intakeOptional.productLine,
    intakeRequired.manufacturer,
    intakeRequired.sport,
    intakeRequired.year,
    teachLayoutClass,
    session?.token,
    triggerPhotoroomForCard,
  ]);

  const startOcrForCard = useCallback(
    (cardId: string) => {
      if (!cardId) {
        return;
      }
      if (!session?.token) {
        setOcrStatus("error");
        setOcrError("Your session expired. Sign in again and retry.");
        return;
      }
      resetOcrState();
      ocrSuggestRef.current = true;
      void fetchOcrSuggestions(cardId);
    },
    [fetchOcrSuggestions, resetOcrState, session?.token]
  );

  const uploadQueuedPhoto = useCallback(
    async (blob: Blob, kind: "BACK" | "TILT") => {
      const mime = blob.type || "image/jpeg";
      const extension = mime.endsWith("png") ? "png" : mime.endsWith("webp") ? "webp" : "jpg";
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `intake-${kind.toLowerCase()}-${timestamp}.${extension}`;
      const file = new File([blob], fileName, { type: mime, lastModified: Date.now() });
      setIntakePhotoBusy(true);
      try {
        const presign = await uploadCardPhoto(file, kind);
        if (kind === "BACK") {
          setIntakeBackPhotoId(presign.photoId);
        } else {
          setIntakeTiltPhotoId(presign.photoId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to upload photo.";
        setIntakeError(message);
      } finally {
        setIntakePhotoBusy(false);
        if (intakeCardId) {
          setTimeout(() => {
            if (ocrCardIdRef.current === null || ocrCardIdRef.current === intakeCardId) {
              startOcrForCard(intakeCardId);
            }
          }, 300);
        }
      }
    },
    [intakeCardId, startOcrForCard, uploadCardPhoto]
  );

  useEffect(() => {
    if (!intakeCardId) {
      return;
    }
    if (pendingBackBlob) {
      const blob = pendingBackBlob;
      setPendingBackBlob(null);
      void uploadQueuedPhoto(blob, "BACK");
    }
    if (pendingTiltBlob) {
      const blob = pendingTiltBlob;
      setPendingTiltBlob(null);
      void uploadQueuedPhoto(blob, "TILT");
    }
  }, [intakeCardId, pendingBackBlob, pendingTiltBlob, uploadQueuedPhoto]);

  const confirmIntakeCapture = useCallback(
    async (target: "front" | "back" | "tilt", blob: Blob) => {
      try {
        setIntakeError(null);
        const mime = blob.type || "image/jpeg";
        const extension = mime.endsWith("png") ? "png" : mime.endsWith("webp") ? "webp" : "jpg";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `intake-${target}-${timestamp}.${extension}`;
        const file = new File([blob], fileName, { type: mime, lastModified: Date.now() });

        if (target === "front") {
          setIntakePhotoBusy(true);
          setIntakeFrontPreview(URL.createObjectURL(blob));
          setIntakeStep("back");
          setIntakeCaptureTarget("back");
          void (async () => {
            try {
              const presign = await uploadCardAsset(file);
              setIntakeCardId(presign.assetId);
              setIntakeBatchId(presign.batchId);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to capture photo.";
              setIntakeError(message);
            } finally {
              setIntakePhotoBusy(false);
            }
          })();
        } else if (target === "back") {
          setIntakeBackPreview(URL.createObjectURL(blob));
          setIntakeStep("tilt");
          setIntakeCaptureTarget("tilt");
          if (intakeCardId) {
            void uploadQueuedPhoto(blob, "BACK");
          } else {
            setPendingBackBlob(blob);
          }
        } else {
          setIntakeTiltPreview(URL.createObjectURL(blob));
          setIntakeStep("front");
          setIntakeCaptureTarget(null);
          if (intakeCardId) {
            void uploadQueuedPhoto(blob, "TILT");
            setQueuedReviewCardIds((prev) =>
              prev.includes(intakeCardId) ? prev : [...prev, intakeCardId]
            );
          } else {
            setPendingTiltBlob(blob);
          }
          clearActiveIntakeState();
          setIntakeReviewMode("capture");
          closeCamera();
          void openIntakeCapture("front");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to capture photo.";
        setIntakeError(message);
      } finally {
        if (target === "front" || target === "back") {
          setIntakeCaptureTarget((prev) => prev ?? null);
        }
      }
    },
    [clearActiveIntakeState, closeCamera, intakeCardId, openIntakeCapture, uploadCardAsset, uploadQueuedPhoto]
  );

  const handleCapture = useCallback(async () => {
    if (captureLocked) {
      return;
    }
    setCaptureLocked(true);
    setTimeout(() => setCaptureLocked(false), 250);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      setCameraError("Camera not ready yet.");
      return;
    }
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) {
      setCameraError("Camera is warming up—try again.");
      return;
    }
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Canvas not supported in this browser.");
      return;
    }
    context.drawImage(video, 0, 0, videoWidth, videoHeight);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) {
      setCameraError("Failed to capture image.");
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(30);
    }
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 120);
    if (intakeCaptureTarget) {
      void confirmIntakeCapture(intakeCaptureTarget, blob);
      return;
    }
    if (capturePreviewUrl) {
      URL.revokeObjectURL(capturePreviewUrl);
    }
    setCapturedBlob(blob);
    setCapturePreviewUrl(URL.createObjectURL(blob));
  }, [captureLocked, capturePreviewUrl, confirmIntakeCapture, intakeCaptureTarget]);

  const handleConfirmCapture = useCallback(() => {
    if (!capturedBlob) {
      setCameraError("Capture an image first.");
      return;
    }
    if (intakeCaptureTarget) {
      void confirmIntakeCapture(intakeCaptureTarget, capturedBlob);
      return;
    }
    const mime = capturedBlob.type || "image/jpeg";
    const extension = mime.endsWith("png") ? "png" : mime.endsWith("webp") ? "webp" : "jpg";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `capture-${timestamp}.${extension}`;
    const file = new File([capturedBlob], fileName, {
      type: mime,
      lastModified: Date.now(),
    });
    appendFiles([file]);
    closeCamera();
  }, [appendFiles, capturedBlob, closeCamera, confirmIntakeCapture, intakeCaptureTarget]);

  const buildSuggestionsFromAudit = useCallback(
    (threshold: number) => {
      const fields = (ocrAudit as OcrAuditPayload | null)?.fields ?? {};
      const confidence = (ocrAudit as OcrAuditPayload | null)?.confidence ?? {};
      return Object.keys(fields).reduce<Record<string, string>>((acc, key) => {
        const value = fields[key];
        const score = confidence[key];
        if (
          typeof value === "string" &&
          value.trim() &&
          typeof score === "number" &&
          score >= ocrSuggestionThreshold(key, threshold)
        ) {
          acc[key] = value;
        }
        return acc;
      }, {});
    },
    [ocrAudit]
  );

  const toggleOcrSuggestions = useCallback(() => {
    if (!ocrApplied) {
      if (Object.keys(intakeSuggested).length === 0) {
        if (ocrStatus === "empty" && ocrAudit) {
          const lowSuggestions = buildSuggestionsFromAudit(0.5);
          if (Object.keys(lowSuggestions).length > 0) {
            applySuggestions(lowSuggestions);
            setOcrMode("low");
            setOcrStatus("ready");
            return;
          }
        }
        if (intakeCardId) {
          void fetchOcrSuggestions(intakeCardId);
        } else {
          setOcrStatus("error");
          setOcrError("Card asset not ready yet. Wait a moment and retry.");
        }
        return;
      }
      applySuggestions(intakeSuggested);
      setOcrMode("high");
      return;
    }

    const backup = ocrBackupRef.current;
    const appliedFields = ocrAppliedFieldsRef.current;
    if (backup) {
      setIntakeRequired((prev) => {
        const next: IntakeRequiredFields = { ...prev };
        appliedFields.forEach((field) => {
          const suggestedValue = intakeSuggested[field];
          if (suggestedValue && next[field] === suggestedValue) {
            next[field] = backup[field] ?? "";
          }
        });
        return next;
      });
    }
    const optionalBackup = ocrOptionalBackupRef.current;
    const optionalFields = ocrAppliedOptionalFieldsRef.current;
    if (optionalBackup) {
      setIntakeOptional((prev) => {
        const next: IntakeOptionalFields = { ...prev };
        optionalFields.forEach((field) => {
          if (field === "graded") {
            if (typeof intakeSuggested.graded !== "undefined") {
              next.graded = optionalBackup.graded;
            }
            return;
          }
          if (field === "autograph") {
            if (typeof intakeSuggested.autograph !== "undefined") {
              next.autograph = optionalBackup.autograph;
            }
            return;
          }
          if (field === "memorabilia") {
            if (typeof intakeSuggested.memorabilia !== "undefined") {
              next.memorabilia = optionalBackup.memorabilia;
            }
            return;
          }
          if (field === "productLine") {
            if (next.productLine === intakeSuggested.setName) {
              next.productLine = optionalBackup.productLine;
            }
            return;
          }
          if (field === "cardNumber") {
            if (next.cardNumber === intakeSuggested.cardNumber) {
              next.cardNumber = optionalBackup.cardNumber;
            }
            return;
          }
          if (field === "insertSet") {
            if (next.insertSet === intakeSuggested.insertSet) {
              next.insertSet = optionalBackup.insertSet;
            }
            return;
          }
          if (field === "parallel") {
            if (next.parallel === intakeSuggested.parallel) {
              next.parallel = optionalBackup.parallel;
            }
            return;
          }
          if (field === "numbered") {
            if (next.numbered === intakeSuggested.numbered) {
              next.numbered = optionalBackup.numbered;
            }
            return;
          }
          if (field === "gradeCompany") {
            if (next.gradeCompany === intakeSuggested.gradeCompany) {
              next.gradeCompany = optionalBackup.gradeCompany;
            }
            return;
          }
          if (field === "gradeValue") {
            if (next.gradeValue === intakeSuggested.gradeValue) {
              next.gradeValue = optionalBackup.gradeValue;
            }
          }
        });
        return next;
      });
    }
    setOcrApplied(false);
    setOcrMode(null);
  }, [applySuggestions, buildSuggestionsFromAudit, fetchOcrSuggestions, intakeCardId, intakeSuggested, ocrApplied, ocrAudit, ocrStatus]);

  useEffect(() => {
    if (!session?.token || intakeRequired.category !== "sport") {
      setVariantCatalog([]);
      setProductLineOptions([]);
      setInsertSetOptions([]);
      setParallelOptions([]);
      setVariantOptionItems([]);
      setVariantScopeSummary(null);
      return;
    }
    const year = sanitizeNullableText(intakeRequired.year);
    const manufacturer = sanitizeNullableText(intakeRequired.manufacturer);
    if (!year || !manufacturer) {
      setVariantCatalog([]);
      setProductLineOptions([]);
      setInsertSetOptions([]);
      setParallelOptions([]);
      setVariantOptionItems([]);
      setVariantScopeSummary(null);
      return;
    }
    const sport = sanitizeNullableText(intakeRequired.sport);
    const productLine = sanitizeNullableText(intakeOptional.productLine);
    const controller = new AbortController();
    (async () => {
      const params = new URLSearchParams({
        year,
        manufacturer,
      });
      if (sport) {
        params.set("sport", sport);
      }
      if (productLine) {
        params.set("productLine", productLine);
        params.set("setId", productLine);
      }
      params.set("limit", "5000");
      const res = await fetch(`/api/admin/variants/options?${params.toString()}`, {
        headers: buildAdminHeaders(session.token),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error("Failed to load variant options");
      }
      const payload = await res.json().catch(() => null);
      const variants = Array.isArray(payload?.variants) ? (payload.variants as VariantApiRow[]) : [];
      const sets = Array.isArray(payload?.sets)
        ? payload.sets
            .map((entry: { setId?: string }) => sanitizeNullableText(entry?.setId))
            .filter(Boolean)
        : [];
      const insertItems = Array.isArray(payload?.insertOptions)
        ? (payload.insertOptions as VariantOptionItem[])
        : [];
      const parallelItems = Array.isArray(payload?.parallelOptions)
        ? (payload.parallelOptions as VariantOptionItem[])
        : [];
      const insertLabels = insertItems
        .map((entry) => sanitizeNullableText(entry.label))
        .filter(Boolean);
      const parallelLabels = parallelItems
        .map((entry) => sanitizeNullableText(entry.label))
        .filter(Boolean);

      setVariantCatalog(variants);
      setProductLineOptions(sets);
      setInsertSetOptions(insertLabels);
      setParallelOptions(parallelLabels);
      setVariantOptionItems([...insertItems, ...parallelItems]);
      setVariantScopeSummary({
        approvedSetCount:
          typeof payload?.scope?.approvedSetCount === "number" ? payload.scope.approvedSetCount : 0,
        variantCount: typeof payload?.scope?.variantCount === "number" ? payload.scope.variantCount : variants.length,
      });
    })().catch(() => {
      setVariantCatalog([]);
      setProductLineOptions([]);
      setInsertSetOptions([]);
      setParallelOptions([]);
      setVariantOptionItems([]);
      setVariantScopeSummary(null);
    });
    return () => controller.abort();
  }, [
    intakeOptional.productLine,
    intakeRequired.category,
    intakeRequired.manufacturer,
    intakeRequired.sport,
    intakeRequired.year,
    session?.token,
  ]);

  const optionSetIdMap = useMemo(() => {
    const map = new Map<string, string>();
    variantOptionItems.forEach((item) => {
      const label = normalizeVariantLabelKey(sanitizeNullableText(item.label));
      const primarySetId = sanitizeNullableText(item.primarySetId ?? item.setIds?.[0] ?? "");
      if (!label || !primarySetId || map.has(label)) {
        return;
      }
      map.set(label, primarySetId);
    });
    variantCatalog.forEach((row) => {
      const option = normalizeVariantLabelKey(sanitizeNullableText(row.parallelId));
      const setId = sanitizeNullableText(row.setId);
      if (!option || !setId || map.has(option)) {
        return;
      }
      map.set(option, setId);
    });
    return map;
  }, [variantCatalog, variantOptionItems]);

  useEffect(() => {
    if (!session?.token || intakeRequired.category !== "sport") {
      return;
    }
    const controller = new AbortController();
    const candidates = Array.from(
      new Set(
        [
          ...insertSetOptions.slice(0, 40),
          ...parallelOptions.slice(0, 40),
          intakeOptional.insertSet,
          intakeOptional.parallel,
        ]
          .map((value) => sanitizeNullableText(value))
          .filter(Boolean)
      )
    );
    const pending = candidates.filter((option) => !optionPreviewUrls[option]);
    if (!pending.length) {
      return;
    }
    (async () => {
      const results = await Promise.all(
        pending.map(async (option) => {
          const setId =
            optionSetIdMap.get(normalizeVariantLabelKey(option)) ?? sanitizeNullableText(variantCatalog[0]?.setId);
          if (!setId) {
            return [option, ""] as const;
          }
          const res = await fetch(
            `/api/admin/variants/reference?setId=${encodeURIComponent(setId)}&parallelId=${encodeURIComponent(option)}&limit=1`,
            {
              headers: buildAdminHeaders(session.token as string),
              signal: controller.signal,
            }
          );
          if (!res.ok) {
            return [option, ""] as const;
          }
          const payload = await res.json().catch(() => null);
          const row = Array.isArray(payload?.references) ? payload.references[0] : null;
          const preview = sanitizeNullableText(row?.cropUrls?.[0] ?? row?.rawImageUrl ?? "");
          return [option, preview] as const;
        })
      );
      setOptionPreviewUrls((prev) => {
        const next = { ...prev };
        results.forEach(([option, preview]) => {
          next[option] = preview;
        });
        return next;
      });
    })().catch(() => undefined);
    return () => controller.abort();
  }, [
    intakeOptional.insertSet,
    intakeOptional.parallel,
    intakeRequired.category,
    optionPreviewUrls,
    optionSetIdMap,
    insertSetOptions,
    parallelOptions,
    session?.token,
    variantCatalog,
  ]);

  useEffect(() => {
    if (!intakeCardId) {
      return;
    }
    if (ocrCardIdRef.current && ocrCardIdRef.current !== intakeCardId) {
      resetOcrState();
    }
  }, [intakeCardId, resetOcrState]);

  const typedOcrAudit = useMemo(() => (ocrAudit as OcrAuditPayload | null) ?? null, [ocrAudit]);

  const optionDetailByLabel = useMemo(() => {
    const map = new Map<string, VariantOptionItem>();
    variantOptionItems.forEach((item) => {
      const key = normalizeVariantLabelKey(sanitizeNullableText(item.label));
      if (!key || map.has(key)) {
        return;
      }
      map.set(key, item);
    });
    return map;
  }, [variantOptionItems]);

  const ocrSummary = useMemo(() => {
    const confidence = typedOcrAudit?.confidence ?? null;
    if (!confidence) {
      return null;
    }
    const entries = Object.entries(confidence)
      .filter(([, value]) => typeof value === "number")
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 2)
      .map(([key, value]) => `${key} ${Math.round((value as number) * 100)}%`);
    return entries.length ? `Top OCR: ${entries.join(", ")}` : null;
  }, [typedOcrAudit]);

  const ocrPhotoSummary = useMemo(() => {
    const photoOcr = typedOcrAudit?.photoOcr ?? null;
    if (!photoOcr || typeof photoOcr !== "object") {
      return [];
    }
    const order = ["FRONT", "BACK", "TILT"] as const;
    return order
      .map((key) => {
        const row = photoOcr[key];
        if (!row) {
          return null;
        }
        const textSize = sanitizeNullableText(row.ocrText).length;
        const statusLabel =
          row.status === "ok"
            ? "OCR ok"
            : row.status === "empty_text"
            ? "No readable text"
            : "No image";
        return `${key}: ${statusLabel}${textSize > 0 ? ` (${Math.min(120, textSize)} chars)` : ""}`;
      })
      .filter((value): value is string => Boolean(value));
  }, [typedOcrAudit]);

  const variantExplainability = useMemo(() => {
    const lines: string[] = [];
    const parallelSuggestion = sanitizeNullableText(intakeSuggested.parallel);
    const insertSuggestion = sanitizeNullableText(intakeSuggested.insertSet);
    const ocrConfidence = typedOcrAudit?.confidence ?? {};
    const parallelConfidence =
      typeof ocrConfidence.parallel === "number" ? Math.round(ocrConfidence.parallel * 100) : null;
    const insertConfidence =
      typeof ocrConfidence.insertSet === "number" ? Math.round(ocrConfidence.insertSet * 100) : null;

    if (parallelSuggestion) {
      const optionMeta = optionDetailByLabel.get(normalizeVariantLabelKey(parallelSuggestion));
      lines.push(
        `OCR parallel suggestion: ${parallelSuggestion}${parallelConfidence != null ? ` (${parallelConfidence}%)` : ""}`
      );
      if (optionMeta) {
        lines.push(
          `Option pool match: found in ${optionMeta.setIds.length} approved set${optionMeta.setIds.length === 1 ? "" : "s"}`
        );
      } else {
        lines.push("Option pool match: OCR parallel is not in current approved set option pool.");
      }
    }

    if (insertSuggestion) {
      lines.push(
        `OCR insert suggestion: ${insertSuggestion}${insertConfidence != null ? ` (${insertConfidence}%)` : ""}`
      );
    }

    const variantMatch = typedOcrAudit?.variantMatch;
    if (variantMatch?.ok && variantMatch.topCandidate?.parallelId) {
      const confidenceLabel =
        typeof variantMatch.topCandidate.confidence === "number"
          ? ` (${Math.round(variantMatch.topCandidate.confidence * 100)}%)`
          : "";
      lines.push(`Image matcher top candidate: ${variantMatch.topCandidate.parallelId}${confidenceLabel}`);
      if (variantMatch.topCandidate.reason) {
        lines.push(`Matcher reason: ${variantMatch.topCandidate.reason}`);
      }
      if (variantMatch.matchedSetId) {
        lines.push(`Matched set: ${variantMatch.matchedSetId}`);
      }
    } else if (variantMatch && !variantMatch.ok && variantMatch.message) {
      lines.push(`Image matcher status: ${variantMatch.message}`);
    }

    if (variantScopeSummary && variantScopeSummary.variantCount > 0) {
      lines.push(
        `Available option pool: ${variantScopeSummary.variantCount} variants across ${variantScopeSummary.approvedSetCount} approved sets`
      );
    }

    return lines;
  }, [intakeSuggested.insertSet, intakeSuggested.parallel, optionDetailByLabel, typedOcrAudit, variantScopeSummary]);

  const memoryAppliedCount = useMemo(() => {
    const applied = typedOcrAudit?.memory?.applied;
    return Array.isArray(applied) ? applied.length : 0;
  }, [typedOcrAudit]);

  const taxonomyUnknownReasons = useMemo(() => {
    const status = typedOcrAudit?.taxonomyConstraints?.fieldStatus ?? {};
    const confidence = typedOcrAudit?.confidence ?? {};

    const explain = (field: "setName" | "insertSet" | "parallel") => {
      const fieldStatus = status[field];
      if (!fieldStatus || fieldStatus === "kept") {
        return null;
      }
      if (fieldStatus === "cleared_low_confidence") {
        const raw = confidence[field];
        const scoreLabel = typeof raw === "number" ? ` (${Math.round(raw * 100)}%)` : "";
        return `Unknown: low confidence${scoreLabel}`;
      }
      if (fieldStatus === "cleared_out_of_pool") {
        return "Unknown: not in approved option pool";
      }
      return "Unknown: no set scope available";
    };

    return {
      setName: explain("setName"),
      insertSet: explain("insertSet"),
      parallel: explain("parallel"),
    };
  }, [typedOcrAudit]);

  const rankedInsertSetOptions = useMemo(() => {
    const options = [...insertSetOptions];
    const suggested = (intakeSuggested.insertSet ?? "").trim();
    if (!suggested) {
      return options;
    }
    const suggestedKey = normalizeVariantLabelKey(suggested);
    const idx = options.findIndex((value) => normalizeVariantLabelKey(value) === suggestedKey);
    if (idx <= 0) {
      return options;
    }
    const [hit] = options.splice(idx, 1);
    return [hit, ...options];
  }, [insertSetOptions, intakeSuggested.insertSet]);

  const rankedParallelOptions = useMemo(() => {
    const options = [...parallelOptions];
    const suggested = (intakeSuggested.parallel ?? "").trim();
    if (!suggested) {
      return options;
    }
    const suggestedKey = normalizeVariantLabelKey(suggested);
    const idx = options.findIndex((value) => normalizeVariantLabelKey(value) === suggestedKey);
    if (idx <= 0) {
      return options;
    }
    const [hit] = options.splice(idx, 1);
    return [hit, ...options];
  }, [intakeSuggested.parallel, parallelOptions]);

  const teachRegionBindingOptions = useMemo<TeachRegionBindingOption[]>(
    () => [
      { key: "playerName", label: "Player Name", value: sanitizeNullableText(intakeRequired.playerName) },
      { key: "sport", label: "Sport", value: sanitizeNullableText(intakeRequired.sport) },
      { key: "manufacturer", label: "Manufacturer", value: sanitizeNullableText(intakeRequired.manufacturer) },
      { key: "year", label: "Year", value: sanitizeNullableText(intakeRequired.year) },
      { key: "cardName", label: "Card Name", value: sanitizeNullableText(intakeRequired.cardName) },
      { key: "game", label: "Game", value: sanitizeNullableText(intakeRequired.game) },
      { key: "teamName", label: "Team Name", value: sanitizeNullableText(intakeOptional.teamName) },
      { key: "setName", label: "Product Set", value: sanitizeNullableText(intakeOptional.productLine) },
      { key: "insertSet", label: "Insert Set", value: sanitizeNullableText(intakeOptional.insertSet) },
      { key: "parallel", label: "Parallel", value: sanitizeNullableText(intakeOptional.parallel) },
      { key: "cardNumber", label: "Card Number", value: sanitizeNullableText(intakeOptional.cardNumber) },
      { key: "numbered", label: "Numbered", value: sanitizeNullableText(intakeOptional.numbered) },
      { key: "autograph", label: "Autographed", value: intakeOptional.autograph ? "true" : "" },
      { key: "memorabilia", label: "Memorabilia", value: intakeOptional.memorabilia ? "true" : "" },
      { key: "graded", label: "Graded", value: intakeOptional.graded ? "true" : "" },
      { key: "gradeCompany", label: "Grade Company", value: sanitizeNullableText(intakeOptional.gradeCompany) },
      { key: "gradeValue", label: "Grade Value", value: sanitizeNullableText(intakeOptional.gradeValue) },
    ],
    [intakeOptional, intakeRequired]
  );

  const teachRegionBindingOptionMap = useMemo(() => {
    const map = new Map<TeachRegionBindingField, TeachRegionBindingOption>();
    teachRegionBindingOptions.forEach((option) => {
      map.set(option.key, option);
    });
    return map;
  }, [teachRegionBindingOptions]);

  const teachRegionPreviewBySide = useMemo<Record<TeachRegionSide, string | null>>(
    () => ({
      FRONT: intakeFrontPreview,
      BACK: intakeBackPreview,
      TILT: intakeTiltPreview,
    }),
    [intakeBackPreview, intakeFrontPreview, intakeTiltPreview]
  );

  const activeTeachRegionPreview = teachRegionPreviewBySide[teachRegionSide] ?? null;
  const activeTeachRegions = teachRegionsBySide[teachRegionSide] ?? [];
  const beginTeachRegionDraft = useCallback(
    (container: HTMLDivElement, clientX: number, clientY: number, pointerId: number) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const x = clampFraction((clientX - rect.left) / rect.width);
      const y = clampFraction((clientY - rect.top) / rect.height);
      setTeachRegionDraft({
        side: teachRegionSide,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        pointerId,
      });
    },
    [teachRegionSide]
  );

  const openTeachRegionBindDraft = useCallback(
    (side: TeachRegionSide, region: Pick<TeachRegionRect, "id" | "x" | "y" | "width" | "height">) => {
      const preferredOrder: TeachRegionBindingField[] = ["insertSet", "parallel", "setName", "cardNumber", "playerName"];
      const selectedOption =
        preferredOrder
          .map((key) => teachRegionBindingOptionMap.get(key))
          .find((entry) => Boolean(entry?.value)) ||
        teachRegionBindingOptions.find((entry) => Boolean(entry.value)) ||
        teachRegionBindingOptions[0];
      if (!selectedOption) {
        setIntakeError("No card detail fields available to link this teach region.");
        return;
      }
      setTeachRegionBindDraft({
        side,
        region,
        targetField: selectedOption.key,
        targetValue: selectedOption.value,
        note: "",
      });
    },
    [teachRegionBindingOptionMap, teachRegionBindingOptions]
  );

  const safelySetPointerCapture = useCallback((target: HTMLDivElement, pointerId: number) => {
    const captureTarget = target as HTMLDivElement & {
      setPointerCapture?: (id: number) => void;
    };
    if (typeof captureTarget.setPointerCapture !== "function") {
      return;
    }
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // Some mobile browsers throw even when pointer events exist.
    }
  }, []);

  const safelyReleasePointerCapture = useCallback((target: HTMLDivElement, pointerId: number) => {
    const captureTarget = target as HTMLDivElement & {
      hasPointerCapture?: (id: number) => boolean;
      releasePointerCapture?: (id: number) => void;
    };
    if (
      typeof captureTarget.hasPointerCapture !== "function" ||
      typeof captureTarget.releasePointerCapture !== "function"
    ) {
      return;
    }
    try {
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore pointer capture release failures for mobile compatibility.
    }
  }, []);

  const handleTeachRegionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!teachRegionDrawEnabled || !activeTeachRegionPreview) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      beginTeachRegionDraft(event.currentTarget, event.clientX, event.clientY, event.pointerId);
      setTeachRegionFeedback(null);
      setTeachRegionBindDraft(null);
      safelySetPointerCapture(event.currentTarget, event.pointerId);
      event.preventDefault();
    },
    [activeTeachRegionPreview, beginTeachRegionDraft, safelySetPointerCapture, teachRegionDrawEnabled]
  );

  const handleTeachRegionPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setTeachRegionDraft((prev) => {
      if (!prev || prev.pointerId !== event.pointerId) {
        return prev;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return prev;
      }
      const x = clampFraction((event.clientX - rect.left) / rect.width);
      const y = clampFraction((event.clientY - rect.top) / rect.height);
      return {
        ...prev,
        currentX: x,
        currentY: y,
      };
    });
  }, []);

  const finishTeachRegionDraft = useCallback(
    (pointerId?: number) => {
      if (!teachRegionDraft) {
        return;
      }
      if (typeof pointerId === "number" && teachRegionDraft.pointerId !== pointerId) {
        return;
      }
      const x = clampFraction(Math.min(teachRegionDraft.startX, teachRegionDraft.currentX));
      const y = clampFraction(Math.min(teachRegionDraft.startY, teachRegionDraft.currentY));
      const width = clampFraction(Math.abs(teachRegionDraft.currentX - teachRegionDraft.startX));
      const height = clampFraction(Math.abs(teachRegionDraft.currentY - teachRegionDraft.startY));
      if (width >= 0.01 && height >= 0.01) {
        openTeachRegionBindDraft(teachRegionDraft.side, {
          id: `region-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          x,
          y,
          width,
          height,
        });
        setTeachRegionFeedback("Region captured. Link it to a card detail field to finish the teach step.");
      }
      setTeachRegionDraft(null);
    },
    [openTeachRegionBindDraft, teachRegionDraft]
  );

  const handleTeachRegionPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishTeachRegionDraft(event.pointerId);
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    },
    [finishTeachRegionDraft, safelyReleasePointerCapture]
  );

  const handleTeachRegionPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishTeachRegionDraft(event.pointerId);
      safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    },
    [finishTeachRegionDraft, safelyReleasePointerCapture]
  );

  const handleUndoTeachRegion = useCallback(() => {
    if (teachRegionDraft) {
      setTeachRegionDraft(null);
      return;
    }
    setTeachRegionsBySide((prev) => ({
      ...prev,
      [teachRegionSide]: prev[teachRegionSide].slice(0, -1),
    }));
    setTeachRegionFeedback(null);
  }, [teachRegionDraft, teachRegionSide]);

  const handleSaveTeachRegionBinding = useCallback(() => {
    if (!teachRegionBindDraft) {
      return;
    }
    const targetValue = sanitizeNullableText(teachRegionBindDraft.targetValue);
    if (!targetValue) {
      setIntakeError("Pick a card detail field/value before saving this teach region.");
      return;
    }
    const option = teachRegionBindingOptionMap.get(teachRegionBindDraft.targetField);
    const targetFieldLabel = option?.label ?? teachRegionBindDraft.targetField;
    const note = sanitizeNullableText(teachRegionBindDraft.note);
    const linkedRegion: TeachRegionRect = {
      ...teachRegionBindDraft.region,
      targetField: teachRegionBindDraft.targetField,
      targetValue,
      note,
      label: `${targetFieldLabel}: ${targetValue}`.slice(0, 120),
    };
    setTeachRegionsBySide((prev) => ({
      ...prev,
      [teachRegionBindDraft.side]: [...prev[teachRegionBindDraft.side], linkedRegion].slice(0, 24),
    }));
    setTeachRegionBindDraft(null);
    setTeachRegionFeedback(`Teach region linked to ${targetFieldLabel}.`);
    setIntakeError(null);
  }, [teachRegionBindDraft, teachRegionBindingOptionMap]);

  const handleCancelTeachRegionBinding = useCallback(() => {
    setTeachRegionBindDraft(null);
    setTeachRegionFeedback("Teach region draft canceled.");
  }, []);

  const handleClearTeachRegionsForSide = useCallback((side: TeachRegionSide) => {
    setTeachRegionsBySide((prev) => ({
      ...prev,
      [side]: [],
    }));
    setTeachRegionBindDraft((prev) => (prev && prev.side === side ? null : prev));
    setTeachRegionFeedback(null);
  }, []);

  const handleDeleteTeachRegion = useCallback((side: TeachRegionSide, regionId: string) => {
    setTeachRegionsBySide((prev) => ({
      ...prev,
      [side]: prev[side].filter((region) => region.id !== regionId),
    }));
    setTeachRegionFeedback(null);
  }, []);

  const loadTeachRegionTemplates = useCallback(async () => {
    const token = session?.token;
    const cardId = intakeCardId;
    const setId = sanitizeNullableText(intakeOptional.productLine);
    if (!token || !cardId || !setId) {
      setTeachRegionsBySide(buildEmptyTeachRegionsBySide());
      setTeachRegionFeedback(null);
      return;
    }
    try {
      setTeachRegionLoading(true);
      setTeachRegionFeedback(null);
      const params = new URLSearchParams({
        setId,
        layoutClass: normalizeTeachLayoutClass(teachLayoutClass),
      });
      const res = await fetch(resolveApiUrl(`/api/admin/cards/${cardId}/region-teach?${params.toString()}`), {
        method: "GET",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: buildAdminHeaders(token),
      });
      if (!res.ok) {
        setTeachRegionsBySide(buildEmptyTeachRegionsBySide());
        return;
      }
      const payload = (await res.json()) as { templatesBySide?: unknown };
      setTeachRegionsBySide(coerceTeachRegionsBySide(payload?.templatesBySide));
    } catch {
      setTeachRegionsBySide(buildEmptyTeachRegionsBySide());
    } finally {
      setTeachRegionLoading(false);
    }
  }, [
    intakeCardId,
    intakeOptional.productLine,
    isRemoteApi,
    resolveApiUrl,
    session?.token,
    teachLayoutClass,
  ]);

  useEffect(() => {
    void loadTeachRegionTemplates();
    setTeachRegionDraft(null);
    setTeachRegionBindDraft(null);
  }, [loadTeachRegionTemplates]);

  useEffect(() => {
    const insertSet = sanitizeNullableText(intakeOptional.insertSet);
    const parallel = sanitizeNullableText(intakeOptional.parallel);
    const inferredLayout = insertSet
      ? `insert_${normalizeTeachLayoutClass(insertSet)}`
      : parallel
      ? `parallel_${normalizeTeachLayoutClass(parallel)}`
      : intakeOptional.autograph
      ? "autograph"
      : "base";
    setTeachLayoutClass((prev) => {
      const normalizedPrev = normalizeTeachLayoutClass(prev);
      const autoManaged =
        normalizedPrev === "base" ||
        normalizedPrev === "autograph" ||
        normalizedPrev.startsWith("insert_") ||
        normalizedPrev.startsWith("parallel_");
      if (!autoManaged || normalizedPrev === inferredLayout) {
        return prev;
      }
      return inferredLayout;
    });
  }, [intakeOptional.autograph, intakeOptional.insertSet, intakeOptional.parallel]);

  const handleSaveTeachRegions = useCallback(async () => {
    const token = session?.token;
    if (!token) {
      setIntakeError("Your session expired. Sign in again and retry.");
      return;
    }
    if (!intakeCardId) {
      setIntakeError("Card asset not found.");
      return;
    }
    const setId = sanitizeNullableText(intakeOptional.productLine);
    if (!setId) {
      setIntakeError("Select Product Set before saving teach regions.");
      return;
    }
    const templates = TEACH_REGION_SIDES.map((side) => ({
      photoSide: side,
      regions: teachRegionsBySide[side].map((region) => ({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        label: region.label || undefined,
        targetField: region.targetField || undefined,
        targetValue: region.targetValue || undefined,
        note: region.note || undefined,
      })),
    })).filter((entry) => entry.regions.length > 0);
    if (!templates.length) {
      setIntakeError("Draw at least one teach region before saving.");
      return;
    }
    try {
      setTeachRegionBusy(true);
      setTeachRegionFeedback(null);
      const res = await fetch(resolveApiUrl(`/api/admin/cards/${intakeCardId}/region-teach`), {
        method: "POST",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(token),
        },
        body: JSON.stringify({
          setId,
          layoutClass: normalizeTeachLayoutClass(teachLayoutClass),
          templates,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to save teach regions.");
      }
      const payload = (await res.json()) as { updatedCount?: number; templatesBySide?: unknown };
      setTeachRegionsBySide(coerceTeachRegionsBySide(payload?.templatesBySide));
      setTeachRegionFeedback(
        `Teach regions saved (${payload?.updatedCount ?? templates.length} side${(payload?.updatedCount ?? templates.length) === 1 ? "" : "s"}).`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save teach regions.";
      setIntakeError(message);
      setTeachRegionFeedback(null);
    } finally {
      setTeachRegionBusy(false);
    }
  }, [
    intakeCardId,
    intakeOptional.productLine,
    isRemoteApi,
    resolveApiUrl,
    session?.token,
    teachLayoutClass,
    teachRegionsBySide,
  ]);

  const handleIntakeRequiredContinue = useCallback(async () => {
    const error = validateRequiredIntake();
    if (error) {
      setIntakeError(error);
      return;
    }
    try {
      setIntakeBusy(true);
      await saveIntakeMetadata(false);
      setIntakeStep("optional");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save required fields.";
      setIntakeError(message);
    } finally {
      setIntakeBusy(false);
    }
  }, [saveIntakeMetadata, validateRequiredIntake]);

  const handleTeachFromCorrections = useCallback(async () => {
    const error = validateRequiredIntake();
    if (error) {
      setIntakeError(error);
      return;
    }
    if (!intakeCardId) {
      setIntakeError("Card asset not found.");
      return;
    }
    try {
      setTeachBusy(true);
      setTeachFeedback(null);
      await saveIntakeMetadata(true, true, true);
      setTrainAiEnabled(true);
      setTeachFeedback("Teach captured from current corrections.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to capture teach signal.";
      setIntakeError(message);
      setTeachFeedback(null);
    } finally {
      setTeachBusy(false);
    }
  }, [intakeCardId, saveIntakeMetadata, validateRequiredIntake]);

  const handleSendToKingsReview = useCallback(async () => {
    const error = validateRequiredIntake();
    if (error) {
      setIntakeError(error);
      return;
    }
    if (!intakeCardId) {
      setIntakeError("Card asset not found.");
      return;
    }
    const token = session?.token;
    if (!token) {
      setIntakeError("Your session expired. Sign in again and retry.");
      return;
    }
    try {
      setIntakeBusy(true);
      await saveIntakeMetadata(true, trainAiEnabled, trainAiEnabled);
      const photoRoomResult = await triggerPhotoroomForCard(intakeCardId);
      if (!photoRoomResult.ok) {
        throw new Error(photoRoomResult.message);
      }
      photoroomRequestedRef.current = intakeCardId;
      const query = buildIntakeQuery();
      const sourceList =
        intakeRequired.category === "tcg"
          ? ["ebay_sold", "tcgplayer", "pricecharting"]
          : ["ebay_sold", "pricecharting"];
      const res = await fetch(resolveApiUrl("/api/admin/kingsreview/enqueue"), {
        method: "POST",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...buildAdminHeaders(token),
        },
        body: JSON.stringify({
          cardAssetId: intakeCardId,
          query,
          sources: sourceList,
          categoryType: intakeRequired.category,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to enqueue KingsReview job.");
      }
      const nextReviewCardId = queuedReviewCardIds[0] ?? null;
      if (nextReviewCardId) {
        clearActiveIntakeState();
        await loadQueuedCardForReview(nextReviewCardId);
      } else {
        clearActiveIntakeState();
        void openIntakeCapture("front");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send to KingsReview.";
      setIntakeError(message);
    } finally {
      setIntakeBusy(false);
    }
  }, [
    buildIntakeQuery,
    clearActiveIntakeState,
    intakeCardId,
    intakeRequired.category,
    isRemoteApi,
    loadQueuedCardForReview,
    openIntakeCapture,
    queuedReviewCardIds,
    resolveApiUrl,
    saveIntakeMetadata,
    triggerPhotoroomForCard,
    trainAiEnabled,
    session?.token,
    validateRequiredIntake,
  ]);

  const submitUploads = async (event: FormEvent) => {
    event.preventDefault();
    if (!files.length) {
      setFlash("Select one or more images first.");
      return;
    }

    const token = session?.token;
    if (!token) {
      setFlash("Your session expired. Sign in again and retry.");
      return;
    }

    setSubmitting(true);
    setFlash(null);

    const fileEntries = files.map((file, index) => ({ file, index }));
    const initialResults: UploadResult[] = fileEntries.map(({ file }) => ({
      fileName: file.name,
      assetId: null,
      status: "pending",
    }));
    setResults(initialResults);

    const resultsBuffer = initialResults.slice();

    const updateResult = (index: number, updates: Partial<UploadResult>) => {
      resultsBuffer[index] = { ...resultsBuffer[index], ...updates };
      setResults((prev) => {
        if (prev.length === resultsBuffer.length) {
          const next = [...prev];
          next[index] = { ...next[index], ...updates };
          return next;
        }
        return [...resultsBuffer];
      });
    };

    let sharedBatchId: string | null = null;
    let latestBatchId: string | null = null;

    const processEntry = async (entry: { file: File; index: number }) => {
      const { file, index } = entry;
      try {
        updateResult(index, { status: "compressing", message: undefined });
        const optimizedFile = file;

        updateResult(index, { status: "presigning" });
        const presignBody: {
          fileName: string;
          size: number;
          mimeType: string;
          batchId?: string;
        } = {
          fileName: optimizedFile.name,
          size: optimizedFile.size,
          mimeType: optimizedFile.type || file.type,
        };

        if (sharedBatchId) {
          presignBody.batchId = sharedBatchId;
        }

        const presignRes = await fetch(resolveApiUrl("/api/admin/uploads/presign"), {
          method: "POST",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify(presignBody),
        });

        if (!presignRes.ok) {
          const payload = await presignRes.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to generate upload URL");
        }

        const presignPayload = (await presignRes.json()) as {
          assetId: string;
          batchId: string;
          uploadUrl: string;
          fields: Record<string, string>;
          publicUrl: string;
          storageMode: string;
          acl?: string | null;
        };

        if (!sharedBatchId) {
          sharedBatchId = presignPayload.batchId;
          latestBatchId = presignPayload.batchId;
          setBatchId(presignPayload.batchId);
        }

        if (
          presignPayload.storageMode !== "local" &&
          presignPayload.storageMode !== "mock" &&
          presignPayload.storageMode !== "s3"
        ) {
          throw new Error("Unsupported storage mode returned by server");
        }

        updateResult(index, { status: "uploading" });
        const uploadHeaders: Record<string, string> = {
          "Content-Type": optimizedFile.type || file.type,
        };
        if (presignPayload.storageMode === "s3" && presignPayload.acl) {
          uploadHeaders["x-amz-acl"] = presignPayload.acl;
        } else if (presignPayload.storageMode !== "s3") {
          Object.assign(uploadHeaders, buildAdminHeaders(token));
        }

        const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
          method: "PUT",
          mode: presignPayload.storageMode === "s3" ? "cors" : isRemoteApi ? "cors" : "same-origin",
          headers: {
            ...uploadHeaders,
          },
          body: optimizedFile,
        });

        if (!uploadRes.ok) {
          const text = await uploadRes.text().catch(() => "");
          throw new Error(text || "Failed to store file");
        }

        updateResult(index, { status: "processing" });
        const completeRes = await fetch(resolveApiUrl("/api/admin/uploads/complete"), {
          method: "POST",
          mode: isRemoteApi ? "cors" : "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify({
            assetId: presignPayload.assetId,
            fileName: optimizedFile.name,
            mimeType: optimizedFile.type || file.type,
            size: optimizedFile.size,
          }),
        });

        if (!completeRes.ok) {
          const payload = await completeRes.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to record upload");
        }

        updateResult(index, {
          assetId: presignPayload.assetId,
          status: "recorded",
          publicUrl: presignPayload.publicUrl,
          message: undefined,
        });
        latestBatchId = sharedBatchId ?? presignPayload.batchId;
        return { success: true, batchId: presignPayload.batchId };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        updateResult(index, { status: "error", message });
        return { success: false, batchId: null };
      }
    };

    try {
      let nextIndex = 0;
      for (; nextIndex < fileEntries.length; nextIndex += 1) {
        await processEntry(fileEntries[nextIndex]);
        if (sharedBatchId) {
          nextIndex += 1;
          break;
        }
      }

      if (!sharedBatchId) {
        latestBatchId = null;
        return;
      }

      const queue = fileEntries.slice(nextIndex);
      let pointer = 0;

      const worker = async () => {
        while (pointer < queue.length) {
          const current = queue[pointer];
          pointer += 1;
          if (!current) {
            break;
          }
          await processEntry(current);
        }
      };

      const workerCount = Math.min(uploadConcurrency, queue.length);
      await Promise.all(Array.from({ length: workerCount }, worker));
      latestBatchId = sharedBatchId;
    } finally {
      const successes = resultsBuffer.filter((result) => result.status === "recorded").length;
      const errors = resultsBuffer.filter((result) => result.status === "error").length;
      if (successes === resultsBuffer.length && resultsBuffer.length > 0) {
        setFlash("Upload complete.");
      } else if (errors > 0) {
        setFlash(`Uploads finished with ${errors} error${errors === 1 ? "" : "s"}.`);
      } else if (resultsBuffer.length > 0) {
        setFlash("Uploads finished.");
      }

      setSubmitting(false);
      setBatchId(latestBatchId);
      fetchBatches().catch(() => undefined);
    }
  };

  const renderGate = () => {
    if (loading) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators can enter the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {missingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> or <code className="font-mono">NEXT_PUBLIC_ADMIN_PHONES</code> to authorize operators.
            </p>
          )}
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This console is restricted to Ten Kings operators. Contact an administrator if you need elevated permissions.
          </p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      );
    }

    return null;
  };

  const gate = renderGate();
  const showLegacyCapturePanels = false;
  if (gate) {
    return (
      <AppShell hideHeader hideFooter>
        <Head>
          <title>Ten Kings · Admin Uploads</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell hideHeader hideFooter>
      <Head>
        <title>Ten Kings · Admin Uploads</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-6 px-6 py-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link className="inline-flex text-[10px] uppercase tracking-[0.28em] text-slate-400 transition hover:text-white" href="/admin">
              ← Console
            </Link>
            <Link
              className="inline-flex text-[10px] uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
              href="/admin/kingsreview"
            >
              KingsReview →
            </Link>
          </div>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-4">
          <div className="flex flex-wrap items-center justify-end gap-4">
            <button
              type="button"
              onClick={resetIntake}
              className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/30 hover:text-white"
            >
              Reset
            </button>
          </div>

          {intakeError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {intakeError}
            </div>
          )}

          {intakeStep === "front" && (
            <div className="grid gap-4 md:grid-cols-[280px,1fr]">
              <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-300">
                <div className="flex flex-col items-center text-center">
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Capture Queue</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Cards waiting for OCR review:{" "}
                    <span className="font-semibold text-gold-300">{queuedReviewCardIds.length}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => void openIntakeCapture("front")}
                    disabled={intakeBusy}
                    className="mt-4 inline-flex min-w-[210px] items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-12 py-6 text-lg font-semibold uppercase tracking-[0.2em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Add Card
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedQueueCardId) {
                        return;
                      }
                      void loadQueuedCardForReview(selectedQueueCardId);
                    }}
                    disabled={intakeBusy || !selectedQueueCardId}
                    className="mt-4 inline-flex min-w-[210px] items-center justify-center rounded-full border border-gold-500/60 bg-transparent px-8 py-4 text-sm font-semibold uppercase tracking-[0.24em] text-gold-300 transition hover:border-gold-400 hover:text-gold-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    OCR Review →
                  </button>
                  <div className="mt-4 w-full space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">OCR Queue</p>
                    {queuedReviewCardIds.length ? (
                      <div className="max-h-48 space-y-1 overflow-auto rounded-xl border border-white/10 bg-night-900/50 p-2">
                        {queuedReviewCardIds.map((id) => (
                          <label
                            key={id}
                            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-1 text-xs text-slate-200 hover:bg-white/5"
                          >
                            <input
                              type="radio"
                              name="ocr-queue"
                              checked={selectedQueueCardId === id}
                              onChange={() => setSelectedQueueCardId(id)}
                              className="h-3.5 w-3.5 accent-gold-400"
                            />
                            <span className="truncate font-mono">{id}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No cards in OCR queue.</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                {queuedReviewCardIds.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.26em] text-slate-500">Queued Card IDs</p>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {queuedReviewCardIds.slice(0, 8).map((id) => (
                        <li key={id} className="truncate font-mono">
                          {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : intakeFrontPreview ? (
                  <img src={intakeFrontPreview} alt="Front preview" className="h-full max-h-[320px] w-full rounded-xl object-contain" />
                ) : (
                  <p>No front photo yet.</p>
                )}
              </div>
            </div>
          )}

          {intakeStep === "back" && (
            <div className="grid gap-4 md:grid-cols-[240px,1fr]">
              <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Step 2</p>
                <p className="mt-2">Capture the back of the card (required).</p>
                <button
                  type="button"
                  onClick={() => void openIntakeCapture("back")}
                  disabled={intakeBusy}
                  className="mt-4 inline-flex items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Capture back
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                {intakeBackPreview ? (
                  <img src={intakeBackPreview} alt="Back preview" className="h-full max-h-[320px] w-full rounded-xl object-contain" />
                ) : (
                  <p>No back photo yet.</p>
                )}
              </div>
            </div>
          )}

          {intakeStep === "tilt" && (
            <div className="grid gap-4 md:grid-cols-[240px,1fr]">
              <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Step 3</p>
                <p className="mt-2">Capture a tilt photo (required) before OCR/LLM analysis runs.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void openIntakeCapture("tilt")}
                    disabled={intakeBusy}
                    className="inline-flex items-center justify-center rounded-full border border-sky-400/60 bg-sky-400/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-sky-200 transition hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Capture tilt
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                {intakeTiltPreview ? (
                  <img src={intakeTiltPreview} alt="Tilt preview" className="h-full max-h-[320px] w-full rounded-xl object-contain" />
                ) : (
                  <p>No tilt photo yet.</p>
                )}
              </div>
            </div>
          )}

          {intakeStep === "required" && (
            <div className="grid gap-6 md:grid-cols-[1fr,1fr]">
              <div className="space-y-4 rounded-2xl border border-white/10 bg-night-900/60 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Required fields</p>
                <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
                  Category
                  <select
                    value={intakeRequired.category}
                    onChange={(event) => {
                      handleRequiredChange("category")(event);
                      ocrSuggestRef.current = false;
                    }}
                    className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                  >
                    <option value="sport">Sports</option>
                    <option value="tcg">TCG</option>
                  </select>
                </label>
                {intakeRequired.category === "sport" ? (
                  <>
                    <input
                      placeholder="Player name"
                      value={intakeRequired.playerName}
                      onChange={handleRequiredChange("playerName")}
                      className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                        "playerName",
                        intakeRequired.playerName
                      )}`}
                    />
                    {productLineOptions.length > 0 ? (
                      <select
                        value={intakeOptional.productLine}
                        onChange={(event) => {
                          setIntakeOptionalTouched((prev) => ({ ...prev, productLine: true }));
                          setIntakeOptional((prev) => ({ ...prev, productLine: event.target.value }));
                        }}
                        className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                          "setName",
                          intakeOptional.productLine
                        )}`}
                      >
                        <option value="">Product line / set (select)</option>
                        {productLineOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        placeholder="Product line / set (e.g. Topps Basketball)"
                        value={intakeOptional.productLine}
                        onChange={handleOptionalChange("productLine")}
                        className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                          "setName",
                          intakeOptional.productLine
                        )}`}
                      />
                    )}
                    {!sanitizeNullableText(intakeOptional.productLine) && taxonomyUnknownReasons.setName ? (
                      <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-rose-200">
                        {taxonomyUnknownReasons.setName}
                      </p>
                    ) : null}
                    <div className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs uppercase tracking-[0.22em] text-slate-400">
                      Sport (auto): <span className="text-slate-200">{intakeRequired.sport || "Unknown"}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      placeholder="Card name"
                      value={intakeRequired.cardName}
                      onChange={handleRequiredChange("cardName")}
                      className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                        "cardName",
                        intakeRequired.cardName
                      )}`}
                    />
                    <input
                      placeholder="Game (Pokémon, MTG, etc.)"
                      value={intakeRequired.game}
                      onChange={handleRequiredChange("game")}
                      className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                        "game",
                        intakeRequired.game
                      )}`}
                    />
                  </>
                )}
                <input
                  placeholder="Manufacturer (Topps, Panini, etc.)"
                  value={intakeRequired.manufacturer}
                  onChange={handleRequiredChange("manufacturer")}
                  className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                    "manufacturer",
                    intakeRequired.manufacturer
                  )}`}
                />
                <input
                  placeholder="Year (e.g. 2017)"
                  value={intakeRequired.year}
                  onChange={handleRequiredChange("year")}
                  className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                    "year",
                    intakeRequired.year
                  )}`}
                />
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-amber-200/80">
                  <button
                    type="button"
                    onClick={toggleOcrSuggestions}
                    className="rounded-full border border-amber-300/40 px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-amber-200 transition hover:border-amber-200 hover:text-amber-100"
                  >
                    {ocrApplied ? "Clear OCR" : ocrStatus === "empty" ? "Try Low-Conf OCR" : "Auto-fill OCR"}
                  </button>
                  <span>
                    {ocrStatus === "running"
                      ? "OCR running…"
                      : ocrStatus === "pending"
                      ? "OCR pending (retrying)…"
                      : ocrStatus === "empty"
                      ? "No confident OCR suggestions yet"
                      : ocrStatus === "ready"
                      ? `Suggested fields highlight in amber${ocrMode === "low" ? " (low-confidence applied)" : ""}`
                      : ocrStatus === "error"
                      ? ocrError ?? "OCR failed"
                      : "Tap to try OCR autofill"}
                    {ocrSummary ? ` · ${ocrSummary}` : ""}
                  </span>
                  {ocrStatus === "error" && ocrError?.includes("Card asset not ready") ? (
                    <span className="text-[10px] normal-case tracking-normal text-slate-400">
                      Card ID: {intakeCardId ?? "none"} · Front: {intakeFrontPreview ? "yes" : "no"} · Back:{" "}
                      {intakeBackPreview ? "yes" : "no"} · Tilt: {intakeTiltPreview ? "yes" : "no"}
                      {intakeError ? ` · Upload error: ${intakeError}` : ""}
                    </span>
                  ) : null}
                </div>
                {ocrPhotoSummary.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-night-900/70 p-3 text-[10px] text-slate-300">
                    <p className="uppercase tracking-[0.26em] text-slate-500">OCR By Photo</p>
                    <div className="mt-2 space-y-1">
                      {ocrPhotoSummary.map((line) => (
                        <p key={line} className="leading-relaxed">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {variantExplainability.length > 0 && (
                  <div className="rounded-2xl border border-sky-400/20 bg-sky-500/5 p-3 text-[10px] text-sky-100">
                    <p className="uppercase tracking-[0.26em] text-sky-300">Variant Explainability</p>
                    <div className="mt-2 space-y-1">
                      {variantExplainability.map((line) => (
                        <p key={line} className="leading-relaxed">
                          {line}
                        </p>
                      ))}
                    </div>
                    {memoryAppliedCount > 0 && (
                      <p className="mt-2 text-[10px] text-emerald-200">
                        Teach memory applied {memoryAppliedCount} learned field
                        {memoryAppliedCount === 1 ? "" : "s"} from prior human-confirmed cards.
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleIntakeRequiredContinue()}
                  disabled={intakeBusy}
                  className="mt-2 inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue to optional fields
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Captured photos</p>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-night-900/60 p-2 text-xs">
                    <p className="uppercase tracking-[0.2em] text-slate-500">Front</p>
                    {intakeFrontPreview ? <img src={intakeFrontPreview} alt="Front" className="mt-2 rounded-lg" /> : <p className="mt-2 text-slate-600">Missing</p>}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-night-900/60 p-2 text-xs">
                    <p className="uppercase tracking-[0.2em] text-slate-500">Back</p>
                    {intakeBackPreview ? <img src={intakeBackPreview} alt="Back" className="mt-2 rounded-lg" /> : <p className="mt-2 text-slate-600">Missing</p>}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-night-900/60 p-2 text-xs">
                    <p className="uppercase tracking-[0.2em] text-slate-500">Tilt</p>
                    {intakeTiltPreview ? <img src={intakeTiltPreview} alt="Tilt" className="mt-2 rounded-lg" /> : <p className="mt-2 text-slate-600">Optional</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {intakeStep === "optional" && (
            <div className="grid gap-6 md:grid-cols-[1fr,1fr]">
              <div className="space-y-4 rounded-2xl border border-white/10 bg-night-900/60 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Optional fields</p>
                <input
                  placeholder="Team name"
                  value={intakeOptional.teamName}
                  onChange={handleOptionalChange("teamName")}
                  className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                    "teamName",
                    intakeOptional.teamName
                  )}`}
                />
                {intakeRequired.category === "tcg" && (
                  <input
                    placeholder="Product line / set"
                    value={intakeOptional.productLine}
                    onChange={handleOptionalChange("productLine")}
                    className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                      "setName",
                      intakeOptional.productLine
                    )}`}
                  />
                )}
                {intakeRequired.category === "sport" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPickerModalField("insertSet")}
                      className={`flex w-full items-center justify-between rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-left text-sm text-white ${suggestedClass(
                        "insertSet",
                        intakeOptional.insertSet
                      )}`}
                    >
                      <span className={intakeOptional.insertSet ? "text-white" : "text-slate-400"}>
                        {intakeOptional.insertSet || "Insert set (tap to choose)"}
                      </span>
                      <span className="text-xs uppercase tracking-[0.22em] text-slate-400">Select</span>
                    </button>
                    {intakeOptional.insertSet && optionPreviewUrls[intakeOptional.insertSet] ? (
                      <img
                        src={optionPreviewUrls[intakeOptional.insertSet]}
                        alt={`${intakeOptional.insertSet} example`}
                        className="h-14 w-14 rounded-lg border border-white/10 object-cover"
                      />
                    ) : null}
                    {!sanitizeNullableText(intakeOptional.insertSet) && taxonomyUnknownReasons.insertSet ? (
                      <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-rose-200">
                        {taxonomyUnknownReasons.insertSet}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPickerModalField("parallel")}
                      className={`flex w-full items-center justify-between rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-left text-sm text-white ${suggestedClass(
                        "parallel",
                        intakeOptional.parallel
                      )}`}
                    >
                      <span className={intakeOptional.parallel ? "text-white" : "text-slate-400"}>
                        {intakeOptional.parallel || "Variant / parallel (tap to choose)"}
                      </span>
                      <span className="text-xs uppercase tracking-[0.22em] text-slate-400">Select</span>
                    </button>
                    {intakeOptional.parallel && optionPreviewUrls[intakeOptional.parallel] ? (
                      <img
                        src={optionPreviewUrls[intakeOptional.parallel]}
                        alt={`${intakeOptional.parallel} example`}
                        className="h-14 w-14 rounded-lg border border-white/10 object-cover"
                      />
                    ) : null}
                    {!sanitizeNullableText(intakeOptional.parallel) && taxonomyUnknownReasons.parallel ? (
                      <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-rose-200">
                        {taxonomyUnknownReasons.parallel}
                      </p>
                    ) : null}
                  </>
                )}
                <input
                  placeholder="Card number"
                  value={intakeOptional.cardNumber}
                  onChange={handleOptionalChange("cardNumber")}
                  className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                    "cardNumber",
                    intakeOptional.cardNumber
                  )}`}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    placeholder="Numbered (e.g. 3/10)"
                    value={intakeOptional.numbered}
                    onChange={handleOptionalChange("numbered")}
                    className={`rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                      "numbered",
                      intakeOptional.numbered
                    )}`}
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-xs uppercase tracking-[0.24em] text-slate-400">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={intakeOptional.autograph}
                      onChange={(event) => {
                        setIntakeOptionalTouched((prev) => ({ ...prev, autograph: true }));
                        setIntakeOptional((prev) => ({ ...prev, autograph: event.target.checked }));
                      }}
                      className="h-4 w-4 accent-sky-400"
                    />
                    Autograph
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={intakeOptional.memorabilia}
                      onChange={(event) => {
                        setIntakeOptionalTouched((prev) => ({ ...prev, memorabilia: true }));
                        setIntakeOptional((prev) => ({ ...prev, memorabilia: event.target.checked }));
                      }}
                      className="h-4 w-4 accent-sky-400"
                    />
                    Patch
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={intakeOptional.graded}
                      onChange={(event) => {
                        setIntakeOptionalTouched((prev) => ({ ...prev, graded: true }));
                        setIntakeOptional((prev) => ({ ...prev, graded: event.target.checked }));
                      }}
                      className="h-4 w-4 accent-sky-400"
                    />
                    Graded
                  </label>
                </div>
                {intakeOptional.graded && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      placeholder="Grade company (PSA, BGS)"
                      value={intakeOptional.gradeCompany}
                      onChange={handleOptionalChange("gradeCompany")}
                      className={`rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                        "gradeCompany",
                        intakeOptional.gradeCompany
                      )}`}
                    />
                    <input
                      placeholder="Grade value"
                      value={intakeOptional.gradeValue}
                      onChange={handleOptionalChange("gradeValue")}
                      className={`rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                        "gradeValue",
                        intakeOptional.gradeValue
                      )}`}
                    />
                  </div>
                )}
                {intakeRequired.category === "tcg" && (
                  <div className="space-y-2">
                    <input
                      placeholder="Series / Set"
                      value={intakeOptional.tcgSeries}
                      onChange={(event) => setIntakeOptional((prev) => ({ ...prev, tcgSeries: event.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <input
                      placeholder="Rarity"
                      value={intakeOptional.tcgRarity}
                      onChange={(event) => setIntakeOptional((prev) => ({ ...prev, tcgRarity: event.target.value }))}
                      className="w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                    />
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        placeholder="Language"
                        value={intakeOptional.tcgLanguage}
                        onChange={(event) => setIntakeOptional((prev) => ({ ...prev, tcgLanguage: event.target.value }))}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                      />
                      <input
                        placeholder="Out of"
                        value={intakeOptional.tcgOutOf}
                        onChange={(event) => setIntakeOptional((prev) => ({ ...prev, tcgOutOf: event.target.value }))}
                        className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
                      <input
                        type="checkbox"
                        checked={intakeOptional.tcgFoil}
                        onChange={(event) => setIntakeOptional((prev) => ({ ...prev, tcgFoil: event.target.checked }))}
                        className="h-4 w-4 accent-sky-400"
                      />
                      Foil
                    </label>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIntakeStep("required")}
                    disabled={intakeBusy}
                    className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrainAiEnabled((prev) => !prev)}
                    className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] transition ${
                      trainAiEnabled
                        ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-200"
                        : "border-rose-400/70 bg-transparent text-rose-300 hover:border-rose-300 hover:text-rose-200"
                    }`}
                  >
                    {trainAiEnabled ? "Train AI On" : "Train AI Off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTeachFromCorrections()}
                    disabled={intakeBusy || teachBusy}
                    className="inline-flex items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-500/15 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {teachBusy ? "Saving Teach..." : "Teach From Corrections"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendToKingsReview()}
                    disabled={intakeBusy}
                    className="inline-flex items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Send to KingsReview AI
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  {trainAiEnabled
                    ? "Training enabled for this card."
                    : "Training off for this card."}
                </p>
                {teachFeedback ? (
                  <p className="text-xs text-emerald-300">{teachFeedback}</p>
                ) : null}
                <div className="space-y-3 rounded-2xl border border-white/10 bg-night-900/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-slate-300">Teach Regions (Phase 4)</p>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                      {teachRegionLoading ? "Loading..." : `${activeTeachRegions.length} region${activeTeachRegions.length === 1 ? "" : "s"} on ${teachRegionSide}`}
                    </span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      value={teachLayoutClass}
                      onChange={(event) => setTeachLayoutClass(normalizeTeachLayoutClass(event.target.value))}
                      placeholder="Layout class (base, insert_daily_dribble)"
                      className="rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTeachRegionDrawEnabled((prev) => !prev)}
                        className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${
                          teachRegionDrawEnabled
                            ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-200"
                            : "border-white/20 text-slate-300 hover:border-white/40"
                        }`}
                      >
                        {teachRegionDrawEnabled ? "Draw Mode On" : "Draw Mode Off"}
                      </button>
                      {TEACH_REGION_SIDES.map((side) => (
                        <button
                          key={side}
                          type="button"
                          onClick={() => {
                            setTeachRegionSide(side);
                            setTeachRegionDraft(null);
                            setTeachRegionBindDraft(null);
                          }}
                          className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${
                            teachRegionSide === side
                              ? "border-gold-400/70 bg-gold-500/20 text-gold-200"
                              : "border-white/20 text-slate-300 hover:border-white/40"
                          }`}
                        >
                          {side}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    1) Draw Mode On 2) Drag finger/mouse on image 3) Link region to field 4) Save Region Teach
                  </p>
                  <div
                    className={`relative overflow-hidden rounded-xl border border-white/10 bg-night-800/70 select-none touch-none ${
                      teachRegionDrawEnabled ? "cursor-crosshair" : "cursor-default"
                    }`}
                    style={{ touchAction: "none" }}
                    onPointerDown={handleTeachRegionPointerDown}
                    onPointerMove={handleTeachRegionPointerMove}
                    onPointerUp={handleTeachRegionPointerUp}
                    onPointerCancel={handleTeachRegionPointerCancel}
                    onPointerLeave={handleTeachRegionPointerCancel}
                  >
                    {activeTeachRegionPreview ? (
                      <>
                        <img
                          src={activeTeachRegionPreview}
                          alt={`${teachRegionSide} teach preview`}
                          draggable={false}
                          className="pointer-events-none block w-full select-none"
                        />
                        {activeTeachRegions.map((region) => (
                          <div
                            key={region.id}
                            className="pointer-events-none absolute border-2 border-rose-300/95 bg-rose-400/30"
                            style={{
                              left: `${region.x * 100}%`,
                              top: `${region.y * 100}%`,
                              width: `${region.width * 100}%`,
                              height: `${region.height * 100}%`,
                            }}
                          />
                        ))}
                        {teachRegionDraft && teachRegionDraft.side === teachRegionSide ? (
                          <div
                            className="pointer-events-none absolute border-2 border-rose-300/95 bg-rose-400/30"
                            style={{
                              left: `${Math.min(teachRegionDraft.startX, teachRegionDraft.currentX) * 100}%`,
                              top: `${Math.min(teachRegionDraft.startY, teachRegionDraft.currentY) * 100}%`,
                              width: `${Math.abs(teachRegionDraft.currentX - teachRegionDraft.startX) * 100}%`,
                              height: `${Math.abs(teachRegionDraft.currentY - teachRegionDraft.startY) * 100}%`,
                            }}
                          />
                        ) : null}
                      </>
                    ) : (
                      <div className="flex h-40 items-center justify-center text-xs uppercase tracking-[0.2em] text-slate-500">
                        Missing {teachRegionSide} photo
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleUndoTeachRegion}
                      disabled={!teachRegionDraft && activeTeachRegions.length < 1}
                      className="rounded-full border border-gold-400/60 bg-gold-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-gold-200 hover:bg-gold-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClearTeachRegionsForSide(teachRegionSide)}
                      className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300 hover:border-white/40"
                    >
                      Clear {teachRegionSide}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveTeachRegions()}
                      disabled={teachRegionBusy || intakeBusy}
                      className="rounded-full border border-emerald-400/70 bg-emerald-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {teachRegionBusy ? "Saving..." : "Save Region Teach"}
                    </button>
                  </div>
                  {activeTeachRegions.length > 0 ? (
                    <div className="max-h-24 space-y-1 overflow-auto pr-1 text-[10px] text-slate-400">
                      {activeTeachRegions.map((region, index) => (
                        <div key={`${teachRegionSide}-${region.id}`} className="flex items-center justify-between rounded border border-white/10 px-2 py-1">
                          <span>
                            Region {index + 1}: {region.label || "Unlinked"} · x {Math.round(region.x * 100)}% y {Math.round(region.y * 100)}% w{" "}
                            {Math.round(region.width * 100)}% h {Math.round(region.height * 100)}%
                            {region.note ? ` · note: ${region.note}` : ""}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteTeachRegion(teachRegionSide, region.id)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {teachRegionFeedback ? <p className="text-xs text-emerald-300">{teachRegionFeedback}</p> : null}
                  {typedOcrAudit?.regionTemplates?.loadedSides?.length ? (
                    <p className="text-[10px] text-slate-500">
                      OCR replay loaded region templates for {typedOcrAudit.regionTemplates.loadedSides.join(", ")}.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Intake summary</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  <li>Front: {intakeFrontPreview ? "Captured" : "Missing"}</li>
                  <li>Back: {intakeBackPreview ? "Captured" : "Missing"}</li>
                  <li>Tilt: {intakeTiltPreview ? "Captured" : "Missing"}</li>
                  <li>Category: {intakeRequired.category === "sport" ? "Sports" : "TCG"}</li>
                  <li>Manufacturer: {intakeRequired.manufacturer || "—"}</li>
                  <li>Year: {intakeRequired.year || "—"}</li>
                  <li>Product Set: {intakeOptional.productLine || "—"}</li>
                  <li>Insert Set: {intakeOptional.insertSet || "—"}</li>
                  <li>Parallel: {intakeOptional.parallel || "—"}</li>
                </ul>
              </div>
            </div>
          )}

        </section>

        {teachRegionBindDraft ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-night-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-300">Link Teach Region</p>
                <button
                  type="button"
                  onClick={handleCancelTeachRegionBinding}
                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300"
                >
                  Cancel
                </button>
              </div>
              <p className="mb-3 text-xs text-slate-400">
                Connect this marked region to a card detail field so memory replay understands what this area represents.
              </p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Card detail field</label>
                  <select
                    value={teachRegionBindDraft.targetField}
                    onChange={(event) => {
                      const nextField = event.target.value as TeachRegionBindingField;
                      const fallbackValue = teachRegionBindingOptionMap.get(nextField)?.value ?? "";
                      setTeachRegionBindDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              targetField: nextField,
                              targetValue: fallbackValue,
                            }
                          : prev
                      );
                    }}
                    className="w-full rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                  >
                    {teachRegionBindingOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                        {option.value ? ` (${option.value})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Value to teach</label>
                  <input
                    value={teachRegionBindDraft.targetValue}
                    onChange={(event) =>
                      setTeachRegionBindDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              targetValue: event.target.value,
                            }
                          : prev
                      )
                    }
                    placeholder="Example: No Limit"
                    className="w-full rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Optional note</label>
                  <textarea
                    rows={2}
                    value={teachRegionBindDraft.note}
                    onChange={(event) =>
                      setTeachRegionBindDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              note: event.target.value,
                            }
                          : prev
                      )
                    }
                    placeholder="Optional context to improve future review."
                    className="w-full rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelTeachRegionBinding}
                    className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-300"
                  >
                    Discard Region
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTeachRegionBinding}
                    className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-night-900 shadow-glow"
                  >
                    Link Region
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {pickerModalField && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-night-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-300">
                  {pickerModalField === "insertSet" ? "Insert Set Examples" : "Variant / Parallel Examples"}
                </p>
                <button
                  type="button"
                  onClick={() => setPickerModalField(null)}
                  className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300"
                >
                  Close
                </button>
              </div>
              <div className="grid max-h-[70vh] grid-cols-1 gap-2 overflow-auto pr-1 md:grid-cols-2">
                {[
                  "__NONE__",
                  ...(pickerModalField === "insertSet" ? rankedInsertSetOptions : rankedParallelOptions),
                ].map((option) => {
                  const optionMeta =
                    option === "__NONE__" ? null : optionDetailByLabel.get(normalizeVariantLabelKey(option));
                  return (
                    <button
                      key={`${pickerModalField}-${option}`}
                      type="button"
                      onClick={() => {
                        if (pickerModalField === "insertSet") {
                          setIntakeOptionalTouched((prev) => ({ ...prev, insertSet: true }));
                          setIntakeOptional((prev) => ({ ...prev, insertSet: option === "__NONE__" ? "" : option }));
                        } else {
                          setIntakeOptionalTouched((prev) => ({ ...prev, parallel: true }));
                          setIntakeOptional((prev) => ({ ...prev, parallel: option === "__NONE__" ? "" : option }));
                        }
                        setPickerModalField(null);
                      }}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-night-800/70 p-2 text-left hover:border-gold-400/40"
                    >
                      {option === "__NONE__" ? (
                        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/10 text-[10px] uppercase tracking-[0.2em] text-slate-300">
                          None
                        </div>
                      ) : optionPreviewUrls[option] ? (
                        <img src={optionPreviewUrls[option]} alt={`${option} example`} className="h-16 w-16 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-white/10 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                          No Img
                        </div>
                      )}
                      <div>
                        <div className="text-sm text-slate-200">{option === "__NONE__" ? "None" : option}</div>
                        {optionMeta && (
                          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                            {optionMeta.setIds.length} set{optionMeta.setIds.length === 1 ? "" : "s"} · {optionMeta.count} variants
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {showLegacyCapturePanels && (
        <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-night-900/70 p-6">
          <form className="flex flex-col gap-4" onSubmit={submitUploads}>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void openCamera()}
                disabled={submitting}
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cameraOpen ? "Camera active" : "Open camera"}
              </button>
              <span className="text-xs text-slate-500">Capture card photos directly from this device.</span>
            </div>
            <label className="flex flex-col gap-2 text-sm uppercase tracking-[0.24em] text-slate-300">
              Select card images
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={onFileChange}
                className="rounded-2xl border border-dashed border-slate-500/60 bg-night-900/60 p-6 text-xs uppercase tracking-[0.3em] text-slate-400"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || files.length === 0}
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-slate-500"
            >
              {submitting
                ? `Uploading… (${uploadSummary.completed}/${uploadSummary.total || files.length})`
                : "Upload & queue"}
            </button>
          </form>

          {flash && <p className="text-sm text-slate-300">{flash}</p>}

          {batchId && (
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
              Batch ID: <span className="font-mono tracking-normal text-slate-200">{batchId}</span>
            </p>
          )}

          {files.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Selected files</p>
              <ul className="grid gap-2 text-sm text-slate-300">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3">
                    {file.name} <span className="text-xs text-slate-500">· {Math.round(file.size / 1024)} KB</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Upload results</p>
              <ul className="grid gap-2 text-sm text-slate-300">
                {results.map((result, index) => (
                  <li
                    key={`${result.fileName}-${index}`}
                    className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span>{result.fileName}</span>
                      <span className={statusTone[result.status] ?? "text-slate-400"}>
                        {statusLabels[result.status] ?? result.status}
                      </span>
                    </div>
                    {result.assetId && <p className="text-xs text-slate-500">assetId: {result.assetId}</p>}
                    {result.publicUrl && (
                      <p className="text-xs text-slate-500">
                        preview: <span className="break-all">{result.publicUrl}</span>
                      </p>
                    )}
                    {result.message && result.status === "error" && (
                      <p className="text-xs text-rose-300">{result.message}</p>
                    )}
                    {result.message && result.status !== "error" && (
                      <p className="text-xs text-slate-400">{result.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        )}

        {showLegacyCapturePanels && (
        <section className="rounded-3xl border border-white/10 bg-night-900/50 p-4">
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between text-sm uppercase tracking-[0.3em] text-slate-300">
              <span>Recent Uploads · Batches</span>
              <span className="text-xs text-slate-500 transition group-open:text-slate-300">Toggle</span>
            </summary>

            <div className="mt-4 flex flex-col gap-4">
              {batchesLoading && <p className="text-sm text-slate-400">Loading batches…</p>}
              {batchesError && <p className="text-sm text-rose-300">{batchesError}</p>}

              {!batchesLoading && !batchesError && batches.length === 0 && (
                <p className="text-sm text-slate-400">No batches yet. Upload card images to start a new batch.</p>
              )}

              {!batchesLoading && batches.length > 0 && (
                <ul className="grid gap-3">
                  {batches.map((batch) => (
                    <li key={batch.id} className="rounded-2xl border border-white/10 bg-night-900/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                          {batch.label ?? "Untitled Batch"}
                        </p>
                        <h3 className="font-heading text-lg uppercase tracking-[0.18em] text-white">{batch.id.slice(0, 8)}</h3>
                        <p className="text-xs text-slate-500">
                          Created {new Date(batch.createdAt).toLocaleString()} · {batch.totalCount} uploads
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-xs text-slate-400">
                          <p>
                            Status: <span className={`text-slate-200 ${batch.status === "READY" ? "text-emerald-300" : "text-slate-200"}`}>
                              {batch.status}
                            </span>
                          </p>
                          <p>
                            {batch.status === "ASSIGNED" ? "Assigned" : "Processed"} {batch.processedCount}/{batch.totalCount}
                          </p>
                          {batch.latestAssetAt && (
                            <p>Last upload {new Date(batch.latestAssetAt).toLocaleString()}</p>
                          )}
                        </div>
                        <Link
                          href={`/admin/batches/${batch.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                    {batch.assignments.length > 0 && (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-night-900/60 p-3 text-xs text-slate-300">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack Assignments</p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {batch.assignments.map((assignment) => (
                            <li
                              key={`${batch.id}-${assignment.packDefinitionId}`}
                              className="rounded-full border border-emerald-400/30 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-emerald-200"
                            >
                              {CATEGORY_LABELS[assignment.category] ?? assignment.category} · {TIER_LABELS[assignment.tier] ?? assignment.tier}
                              <span className="ml-2 text-slate-300">×{assignment.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </section>
        )}
      </div>

      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="absolute inset-0 bg-black" />
          <div className="relative flex-1 overflow-hidden">
            {capturePreviewUrl && capturedBlob ? (
              <img
                src={capturePreviewUrl}
                alt="Captured card preview"
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full object-cover"
                  onLoadedMetadata={() => setCameraReady(true)}
                />
                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full border border-white/40 px-5 py-2 text-xs uppercase tracking-[0.28em] text-white/80">
                      Initializing camera…
                    </div>
                  </div>
                )}
              </>
            )}
            {flashActive && (
              <div className="pointer-events-none absolute inset-0 bg-white/50" />
            )}
            <div className="pointer-events-auto absolute left-4 top-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-full border border-white/40 bg-black/60 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-100 backdrop-blur transition hover:border-white/60 hover:text-white"
              >
                Close
              </button>
            </div>
            {videoInputs.length > 0 && (
              <div className="pointer-events-auto absolute right-4 top-6 flex flex-col items-end gap-2 text-right text-[10px] uppercase tracking-[0.32em] text-slate-200">
                <span>Camera</span>
                <select
                  value={selectedDeviceId ?? ""}
                  onChange={(event) => handleCameraSelection(event.currentTarget.value)}
                  disabled={devicesEnumerating || cameraLoading}
                  className="min-w-[220px] rounded-full border border-white/30 bg-black/60 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-slate-100 outline-none transition hover:border-white/50"
                >
                  {videoInputs.map((device, index) => {
                    const label = device.label || `Camera ${index + 1}`;
                    return (
                      <option key={device.deviceId} value={device.deviceId} className="text-black">
                        {label}
                      </option>
                    );
                  })}
                </select>
                {devicesEnumerating && <span className="text-[9px] text-slate-400">Refreshing…</span>}
              </div>
            )}
            {supportsZoom && !capturePreviewUrl && zoomBounds.max - zoomBounds.min > 0.01 && (
              <div className="pointer-events-auto absolute bottom-24 left-0 right-0 flex justify-center px-12">
                <input
                  type="range"
                  min={zoomBounds.min}
                  max={zoomBounds.max}
                  step={zoomBounds.step}
                  value={zoom}
                  onChange={(event) => handleZoomChange(Number(event.currentTarget.value))}
                  className="h-1 w-full max-w-md accent-emerald-400"
                />
              </div>
            )}
            {cameraError && (
              <div className="pointer-events-none absolute top-24 left-1/2 w-[80%] max-w-sm -translate-x-1/2 rounded-2xl border border-rose-400/40 bg-rose-500/20 px-4 py-3 text-center text-xs uppercase tracking-[0.28em] text-rose-100">
                {cameraError}
              </div>
            )}
            <div className="pointer-events-auto absolute bottom-6 left-0 right-0 flex items-center justify-center gap-10 px-6">
              <div className="mr-auto flex items-center gap-3">
                {[
                  { key: "front", label: "Front", preview: intakeFrontPreview, done: Boolean(intakeFrontPreview) },
                  { key: "back", label: "Back", preview: intakeBackPreview, done: Boolean(intakeBackPreview) },
                  { key: "tilt", label: "Tilt", preview: intakeTiltPreview, done: Boolean(intakeTiltPreview) },
                ].map((entry) => (
                  <div
                    key={entry.key}
                    className={`relative h-12 w-12 overflow-hidden rounded-xl border text-[9px] uppercase tracking-[0.2em] ${
                      entry.done ? "border-emerald-400/70" : "border-white/20"
                    }`}
                  >
                    {entry.preview ? (
                      <img src={entry.preview} alt={`${entry.label} preview`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-black/40 text-slate-400">
                        {entry.label}
                      </div>
                    )}
                    {entry.done && (
                      <span className="absolute right-1 top-1 rounded-full bg-emerald-400 px-1 py-[1px] text-[8px] font-semibold text-night-900">
                        ✓
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {capturedBlob ? (
                <>
                  <button
                    type="button"
                    onClick={handleRetake}
                    className="rounded-full border border-white/30 bg-white/10 px-6 py-3 text-xs uppercase tracking-[0.32em] text-slate-100 transition hover:border-white/60 hover:text-white"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCapture}
                    className="rounded-full border border-gold-500/70 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
                  >
                    Use photo
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCapture}
                  onTouchStart={handleCapture}
                  disabled={cameraLoading}
                  className="rounded-full border border-white/30 bg-white/10 px-10 py-3 text-xs uppercase tracking-[0.32em] text-slate-100 transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cameraLoading ? "Loading…" : "Capture"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />

      {submitting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-night-900/60 backdrop-blur-sm">
          <div className="rounded-3xl border border-white/10 bg-night-900/90 px-8 py-6 text-center text-slate-100">
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Uploading</p>
            <p className="mt-2 text-sm text-white">
              {uploadSummary.completed}/{uploadSummary.total || files.length} files complete
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Keep this tab open until all uploads finish.
            </p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
