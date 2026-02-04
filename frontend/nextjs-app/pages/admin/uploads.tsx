import Head from "next/head";
import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  cardNumber: string;
  serialNumber: string;
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
    cardNumber: "",
    serialNumber: "",
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
  const [intakeTiltSkipped, setIntakeTiltSkipped] = useState(false);
  const [pendingBackBlob, setPendingBackBlob] = useState<Blob | null>(null);
  const [pendingTiltBlob, setPendingTiltBlob] = useState<Blob | null>(null);
  const [flashActive, setFlashActive] = useState(false);
  const [intakeSuggested, setIntakeSuggested] = useState<Record<string, string>>({});
  const [intakeTouched, setIntakeTouched] = useState<Record<string, boolean>>({});
  const [intakeOptionalTouched, setIntakeOptionalTouched] = useState<Record<string, boolean>>({});
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
  const ocrBackupRef = useRef<IntakeRequiredFields | null>(null);
  const ocrAppliedFieldsRef = useRef<OcrApplyField[]>([]);
  const ocrOptionalBackupRef = useRef<IntakeOptionalFields | null>(null);
  const ocrAppliedOptionalFieldsRef = useRef<(keyof IntakeOptionalFields)[]>([]);

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

  const resetIntake = useCallback(() => {
    setIntakeStep("front");
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
      cardNumber: "",
      serialNumber: "",
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
    setIntakeTiltSkipped(false);
    setPendingBackBlob(null);
    setPendingTiltBlob(null);
    setIntakePhotoBusy(false);
    setIntakeSuggested({});
    setIntakeTouched({});
    setIntakeOptionalTouched({});
    setOcrStatus(null);
    setOcrAudit(null);
    setOcrApplied(false);
    setOcrMode(null);
    setOcrError(null);
    ocrSuggestRef.current = false;
    ocrRetryRef.current = 0;
    ocrBackupRef.current = null;
    ocrAppliedFieldsRef.current = [];
    ocrOptionalBackupRef.current = null;
    ocrAppliedOptionalFieldsRef.current = [];
  }, []);

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
    const parts = [year, manufacturer, productLine, primary, cardNumber, numbered, autograph, memorabilia, grade]
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

      const optimizedFile = await compressImage(file);
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
      if (presignPayload.storageMode !== "s3") {
        Object.assign(uploadHeaders, buildAdminHeaders(token));
      }

      const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
        method: "PUT",
        mode: isRemoteApi ? "cors" : "same-origin",
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

      const optimizedFile = await compressImage(file);
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
      if (presignPayload.storageMode !== "s3") {
        Object.assign(uploadHeaders, buildAdminHeaders(token));
      }

      const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
        method: "PUT",
        mode: isRemoteApi ? "cors" : "same-origin",
        headers: {
          ...uploadHeaders,
        },
        body: optimizedFile,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        throw new Error(text || "Failed to store file");
      }

      return presignPayload;
    },
    [intakeCardId, isRemoteApi, resolveApiUrl, session?.token]
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
      }
    },
    [uploadCardPhoto]
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
          setIntakeTiltSkipped(false);
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
          setIntakeStep("required");
          setIntakeCaptureTarget(null);
          if (intakeCardId) {
            void uploadQueuedPhoto(blob, "TILT");
          } else {
            setPendingTiltBlob(blob);
          }
          closeCamera();
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
    [closeCamera, intakeCardId, uploadCardAsset, uploadQueuedPhoto]
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

  const saveIntakeMetadata = useCallback(
    async (includeOptional: boolean) => {
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
        setName: intakeOptional.productLine.trim() || null,
        variantKeywords: [] as string[],
        serialNumber: intakeOptional.serialNumber.trim() || null,
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
        setCode: null,
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

  const validateRequiredIntake = useCallback(() => {
    if (!intakeCardId) {
      return "Capture the front of the card first.";
    }
    const hasBackCapture = Boolean(intakeBackPhotoId || intakeBackPreview || pendingBackBlob);
    if (!hasBackCapture) {
      return "Capture the back of the card before continuing.";
    }
    if (intakeRequired.category === "sport") {
      if (!intakeRequired.playerName.trim()) {
        return "Player name is required.";
      }
      if (!intakeRequired.sport.trim()) {
        return "Sport is required.";
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
  }, [intakeBackPhotoId, intakeBackPreview, intakeCardId, intakeRequired, pendingBackBlob]);

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
        if (suggestions.setName && !intakeOptionalTouched.productLine && !prev.productLine.trim()) {
          next.productLine = suggestions.setName;
          ocrAppliedOptionalFieldsRef.current.push("productLine");
        }
        if (suggestions.cardNumber && !intakeOptionalTouched.cardNumber && !prev.cardNumber.trim()) {
          next.cardNumber = suggestions.cardNumber;
          ocrAppliedOptionalFieldsRef.current.push("cardNumber");
        }
        if (suggestions.serialNumber && !intakeOptionalTouched.serialNumber && !prev.serialNumber.trim()) {
          next.serialNumber = suggestions.serialNumber;
          ocrAppliedOptionalFieldsRef.current.push("serialNumber");
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
      intakeRequired,
      ocrApplied,
      intakeOptionalTouched.cardNumber,
      intakeOptionalTouched.productLine,
      intakeOptionalTouched.serialNumber,
      intakeOptionalTouched.numbered,
      intakeOptionalTouched.autograph,
      intakeOptionalTouched.memorabilia,
      intakeOptionalTouched.graded,
      intakeOptionalTouched.gradeCompany,
      intakeOptionalTouched.gradeValue,
    ]
  );


  const fetchOcrSuggestions = useCallback(async () => {
    if (!session?.token) {
      setOcrStatus("error");
      setOcrError("Your session expired. Sign in again and retry.");
      return;
    }
    if (!intakeCardId) {
      setOcrStatus("error");
      setOcrError("Card asset not ready yet. Wait a moment and retry.");
      return;
    }
    try {
      setOcrStatus("running");
      setOcrError(null);
      const res = await fetch(`/api/admin/cards/${intakeCardId}/ocr-suggest`, {
        headers: buildAdminHeaders(session.token),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setOcrStatus("error");
        setOcrError(payload?.message ?? "OCR request failed");
        return;
      }
      const payload = await res.json();
      setOcrAudit(payload?.audit ?? null);
      if (payload?.status === "pending") {
        setOcrStatus("pending");
        if (ocrRetryRef.current < 6) {
          ocrRetryRef.current += 1;
          setTimeout(() => {
            ocrSuggestRef.current = false;
            void fetchOcrSuggestions();
          }, 1500);
        }
        return;
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
  }, [applySuggestions, intakeCardId, session?.token]);

  const buildSuggestionsFromAudit = useCallback(
    (threshold: number) => {
      const fields = (ocrAudit as { fields?: Record<string, string | null> } | null)?.fields ?? {};
      const confidence = (ocrAudit as { confidence?: Record<string, number | null> } | null)?.confidence ?? {};
      return Object.keys(fields).reduce<Record<string, string>>((acc, key) => {
        const value = fields[key];
        const score = confidence[key];
        if (typeof value === "string" && value.trim() && typeof score === "number" && score >= threshold) {
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
        void fetchOcrSuggestions();
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
          if (field === "serialNumber") {
            if (next.serialNumber === intakeSuggested.serialNumber) {
              next.serialNumber = optionalBackup.serialNumber;
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
  }, [applySuggestions, buildSuggestionsFromAudit, fetchOcrSuggestions, intakeSuggested, ocrApplied, ocrAudit, ocrStatus]);

  useEffect(() => {
    if (intakeStep !== "required" || !intakeCardId) {
      return;
    }
    if (ocrSuggestRef.current) {
      return;
    }
    ocrSuggestRef.current = true;
    void fetchOcrSuggestions();
  }, [fetchOcrSuggestions, intakeCardId, intakeStep]);

  const ocrSummary = useMemo(() => {
    const confidence = (ocrAudit as { confidence?: Record<string, number | null> } | null)?.confidence ?? null;
    if (!confidence) {
      return null;
    }
    const entries = Object.entries(confidence)
      .filter(([, value]) => typeof value === "number")
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 2)
      .map(([key, value]) => `${key} ${Math.round((value as number) * 100)}%`);
    return entries.length ? `Top OCR: ${entries.join(", ")}` : null;
  }, [ocrAudit]);

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

  const handleIntakeOptionalSave = useCallback(async () => {
    try {
      setIntakeBusy(true);
      await saveIntakeMetadata(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save optional fields.";
      setIntakeError(message);
    } finally {
      setIntakeBusy(false);
    }
  }, [saveIntakeMetadata]);

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
      await saveIntakeMetadata(true);
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
      resetIntake();
      void openIntakeCapture("front");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send to KingsReview.";
      setIntakeError(message);
    } finally {
      setIntakeBusy(false);
    }
  }, [
    buildIntakeQuery,
    intakeCardId,
    isRemoteApi,
    openIntakeCapture,
    resetIntake,
    resolveApiUrl,
    saveIntakeMetadata,
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
        const optimizedFile = await compressImage(file);

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
        if (presignPayload.storageMode !== "s3") {
          Object.assign(uploadHeaders, buildAdminHeaders(token));
        }

        const uploadRes = await fetch(resolveApiUrl(presignPayload.uploadUrl), {
          method: "PUT",
          mode: isRemoteApi ? "cors" : "same-origin",
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
  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Admin Uploads</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Admin Uploads</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Processing Console</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Add Cards</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Capture card photos and enter the required intake details.
          </p>
          <Link className="inline-flex text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white" href="/admin">
            ← Back to console
          </Link>
        </header>

        <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-night-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-sky-300">KingsReview Intake</p>
              <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">Add Cards/Items</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Guided workflow for staff: front photo → back photo → optional tilt → required fields → optional fields → send to KingsReview AI.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Step</span>
              <span className="rounded-full border border-white/10 bg-night-800 px-3 py-1 text-xs uppercase tracking-[0.28em] text-white">
                {intakeStep.replace("_", " ")}
              </span>
              <button
                type="button"
                onClick={resetIntake}
                className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/30 hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>

          {intakeError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {intakeError}
            </div>
          )}

          {intakeStep === "front" && (
            <div className="grid gap-4 md:grid-cols-[240px,1fr]">
              <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Step 1</p>
                <p className="mt-2">Capture the front of the card.</p>
                <button
                  type="button"
                  onClick={() => void openIntakeCapture("front")}
                  disabled={intakeBusy}
                  className="mt-4 inline-flex items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Capture front
                </button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                {intakeFrontPreview ? (
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
                <p className="mt-2">Optional: capture a tilt photo to reveal refractor patterns.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void openIntakeCapture("tilt")}
                    disabled={intakeBusy}
                    className="inline-flex items-center justify-center rounded-full border border-sky-400/60 bg-sky-400/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-sky-200 transition hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Capture tilt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIntakeTiltSkipped(true);
                      setIntakeCaptureTarget(null);
                      setIntakeStep("required");
                      closeCamera();
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
                  >
                    Skip tilt
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
                    <input
                      placeholder="Sport (NFL, NBA, MLB, etc.)"
                      value={intakeRequired.sport}
                      onChange={handleRequiredChange("sport")}
                      className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                        "sport",
                        intakeRequired.sport
                      )}`}
                    />
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
                </div>
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
                <input
                  placeholder="Product line / set (Prizm, Optic, etc.)"
                  value={intakeOptional.productLine}
                  onChange={handleOptionalChange("productLine")}
                  className={`w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                    "setName",
                    intakeOptional.productLine
                  )}`}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    placeholder="Card number"
                    value={intakeOptional.cardNumber}
                    onChange={handleOptionalChange("cardNumber")}
                    className={`rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                      "cardNumber",
                      intakeOptional.cardNumber
                    )}`}
                  />
                  <input
                    placeholder="Serial number (e.g. 17/199)"
                    value={intakeOptional.serialNumber}
                    onChange={handleOptionalChange("serialNumber")}
                    className={`rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white ${suggestedClass(
                      "serialNumber",
                      intakeOptional.serialNumber
                    )}`}
                  />
                </div>
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
                    Memorabilia
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
                    onClick={() => void handleIntakeOptionalSave()}
                    disabled={intakeBusy}
                    className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Save optional fields
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
              </div>
              <div className="rounded-2xl border border-white/10 bg-night-900/40 p-4 text-sm text-slate-400">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Intake summary</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  <li>Front: {intakeFrontPreview ? "Captured" : "Missing"}</li>
                  <li>Back: {intakeBackPreview ? "Captured" : "Missing"}</li>
                  <li>Tilt: {intakeTiltPreview ? "Captured" : "Optional"}</li>
                  <li>Category: {intakeRequired.category === "sport" ? "Sports" : "TCG"}</li>
                  <li>Manufacturer: {intakeRequired.manufacturer || "—"}</li>
                  <li>Year: {intakeRequired.year || "—"}</li>
                </ul>
              </div>
            </div>
          )}

        </section>

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

        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Recent uploads</p>
              <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">Batches</h2>
            </div>
            <Link
              href="/admin"
              className="text-xs uppercase tracking-[0.28em] text-slate-500 transition hover:text-slate-200"
            >
              Dashboard
            </Link>
          </div>

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
        </section>
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
              <div className="pointer-events-auto absolute bottom-28 left-0 right-0 flex justify-center px-12">
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
          </div>
          <div className="relative flex items-center justify-center gap-10 bg-gradient-to-t from-black via-black/70 to-transparent px-6 pb-10 pt-8">
            <div className="mr-auto flex items-center gap-3">
              {[
                { key: "front", label: "Front", preview: intakeFrontPreview, done: Boolean(intakeFrontPreview) },
                { key: "back", label: "Back", preview: intakeBackPreview, done: Boolean(intakeBackPreview) },
                ...(intakeTiltSkipped && !intakeTiltPreview
                  ? []
                  : [{ key: "tilt", label: "Tilt", preview: intakeTiltPreview, done: Boolean(intakeTiltPreview) }]),
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

async function compressImage(file: File): Promise<File> {
  const MIN_BYTES_FOR_COMPRESSION = 1_200_000; // ~1.2 MB
  const MAX_DIMENSION = 2000;

  if (!file.type.startsWith("image/") || file.size <= MIN_BYTES_FOR_COMPRESSION) {
    return file;
  }

  if (typeof window === "undefined") {
    return file;
  }

  const drawToCanvas = async (
    dimensions: { width: number; height: number },
    draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  ) => {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(dimensions.width, dimensions.height));
    const targetWidth = Math.max(1, Math.round(dimensions.width * scale));
    const targetHeight = Math.max(1, Math.round(dimensions.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas not supported");
    }
    draw(context, targetWidth, targetHeight);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }
    const newName = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], newName, { type: "image/webp", lastModified: Date.now() });
  };

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const optimized = await drawToCanvas(
        { width: bitmap.width, height: bitmap.height },
        (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height)
      );
      bitmap.close();
      return optimized;
    }
  } catch (error) {
    // fall through to HTMLImageElement path
  }

  try {
    const optimized = await new Promise<File>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = async () => {
        URL.revokeObjectURL(url);
        try {
          const result = await drawToCanvas(
            { width: image.width, height: image.height },
            (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height)
          );
          resolve(result);
        } catch (canvasError) {
          reject(canvasError);
        }
      };
      image.onerror = (event) => {
        URL.revokeObjectURL(url);
        reject(event);
      };
      image.src = url;
    });
    return optimized;
  } catch (error) {
    return file;
  }
}
