import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession, type SessionPayload } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import { uploadAiGraderArtifactDirectly } from "../../lib/aiGraderDirectUpload";
import { assertAiGraderBrowserRaster } from "../../lib/aiGraderRasterValidation";

type QueueStage = "needs_comps_review" | "needs_slab_photos" | "ready_for_inventory" | "complete";
type StageFilter = "active" | QueueStage;
type NoticeTone = "info" | "success" | "error";

type ProductionActor = {
  actorType: string;
  role: string;
  displayName: string;
};

type CompsCandidate = {
  id?: string | null;
  source?: string | null;
  title?: string | null;
  url?: string | null;
  price?: string | null;
  soldDate?: string | null;
  listingImageUrl?: string | null;
  screenshotUrl?: string | null;
  thumbnail?: string | null;
  matchScore?: number | null;
  matchQuality?: string | null;
};

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
  queueStatus: QueueStage;
  statusText?: string | null;
  label: {
    printed: boolean;
    physicalPrintStatus?: string | null;
    sheetNumber?: number | null;
    slot?: number | null;
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
    compsRefs?: CompsCandidate[] | null;
    resultSummary?: Record<string, unknown> | null;
    searchQuery?: string | null;
    searchUrl?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryable?: boolean | null;
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
  stats?: Record<string, number>;
};

type CardNotice = {
  tone: NoticeTone;
  message: string;
};

type UploadState = {
  front?: "uploading" | "uploaded" | "failed";
  back?: "uploading" | "uploaded" | "failed";
};

type ApiError = Error & {
  statusCode?: number;
  code?: string;
};

const emptyQueue: FinishQueueResult = {
  source: "persisted_records",
  orderedBy: "chronological",
  items: [],
};

const stageFilters: Array<{ id: StageFilter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "needs_comps_review", label: "Comps review" },
  { id: "needs_slab_photos", label: "Slab photos" },
  { id: "ready_for_inventory", label: "Ready for inventory" },
  { id: "complete", label: "Complete" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function apiError(response: Response, payload: Record<string, unknown>, fallback: string): ApiError {
  const error = new Error(typeof payload.message === "string" ? payload.message : fallback) as ApiError;
  error.statusCode = response.status;
  if (typeof payload.code === "string") error.code = payload.code;
  return error;
}

async function readPayload(response: Response) {
  return asRecord(await response.json().catch(() => ({})));
}

async function verifyProductionSession(token: string): Promise<ProductionActor> {
  const response = await fetch("/api/admin/ai-grader/production/auth-check", {
    method: "GET",
    headers: buildAdminHeaders(token),
    cache: "no-store",
  });
  const payload = await readPayload(response);
  if (!response.ok || payload.ok !== true) {
    throw apiError(response, payload, "AI Grader production access could not be verified.");
  }
  const result = asRecord(payload.result);
  return {
    actorType: typeof result.actorType === "string" ? result.actorType : "human_operator",
    role: typeof result.role === "string" ? result.role : "ai_grader_operator",
    displayName:
      typeof result.displayName === "string" && result.displayName.trim() ? result.displayName.trim() : "Ten Kings operator",
  };
}

function stageLabel(stage: QueueStage) {
  if (stage === "needs_comps_review") return "Needs comps review";
  if (stage === "needs_slab_photos") return "Needs slab photos";
  if (stage === "ready_for_inventory") return "Ready for inventory";
  return "Complete";
}

function gradeLabel(grade?: number | null) {
  if (typeof grade !== "number" || !Number.isFinite(grade)) return "Grade pending";
  return `Grade ${grade.toFixed(1).replace(/\.0$/, "")}`;
}

function formatDate(value?: string | null) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(minor?: number | null, currency = "USD") {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "Not set";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

function priceMinor(value?: string | null) {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) return null;
  const minor = Math.round(Number(match[1]) * 100);
  return Number.isFinite(minor) && minor > 0 ? minor : null;
}

function compKey(comp: CompsCandidate, index: number) {
  return comp.id?.trim() || `comp-${index + 1}`;
}

function safeHttpsUrl(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function compsStatusPending(status?: string | null) {
  return status === "running";
}

function actionMessage(item: FinishQueueItem) {
  if (item.queueStatus === "complete") {
    return { title: "Complete", message: "This card has passed every gate and is in inventory." };
  }
  if (item.queueStatus === "needs_comps_review") {
    if (item.valuation.errorMessage) {
      return { title: "Retry comps", message: item.valuation.errorMessage };
    }
    if (compsStatusPending(item.valuation.status)) {
      return { title: "Comps are processing", message: "The sold-listing lookup is running in the background." };
    }
    if (item.valuation.compsRefs?.length) {
      return { title: "Review sold comps", message: "Select the matching sold listings and save their automatic average." };
    }
    return { title: "Run comps", message: "Start or retry the sold-listing lookup for this card." };
  }
  if (item.queueStatus === "needs_slab_photos") {
    const missing = [!item.slabPhotos.frontUploaded ? "front" : "", !item.slabPhotos.backUploaded ? "back" : ""].filter(Boolean);
    return { title: "Upload slab photos", message: `Add the ${missing.join(" and ")} slab photo${missing.length > 1 ? "s" : ""}.` };
  }
  if (!item.label.printed) {
    return { title: "Label print required", message: "Mark the assigned label sheet printed before the final inventory action." };
  }
  return { title: "Add to inventory", message: "All required evidence is ready for the final inventory action." };
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export default function AiGraderFinishPage() {
  const { session, loading: sessionLoading, ensureSession, logout } = useSession();
  const [actor, setActor] = useState<ProductionActor | null>(null);
  const [authState, setAuthState] = useState<"checking" | "signed_out" | "authorized" | "error">("checking");
  const [authMessage, setAuthMessage] = useState("Checking production access.");
  const [queue, setQueue] = useState<FinishQueueResult>(emptyQueue);
  const [queueState, setQueueState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [queueMessage, setQueueMessage] = useState("Sign in to load the finishing queue.");
  const [filter, setFilter] = useState<StageFilter>("active");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedCompIds, setSelectedCompIds] = useState<Record<string, string[]>>({});
  const [notices, setNotices] = useState<Record<string, CardNotice>>({});
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const bootTokenRef = useRef<string | null>(null);

  const loadQueueWithToken = useCallback(async (token: string, preferredReportId?: string | null, silent = false) => {
    if (!silent) {
      setQueueState("loading");
      setQueueMessage("Loading cards in chronological order.");
    }
    const response = await fetch("/api/admin/ai-grader/production/finish-queue?includeCompleted=true", {
      method: "GET",
      headers: buildAdminHeaders(token, { accept: "application/json" }),
      cache: "no-store",
    });
    const payload = await readPayload(response);
    if (!response.ok || payload.ok !== true) {
      const error = apiError(response, payload, "The finishing queue could not be loaded.");
      if (error.statusCode === 401 || error.statusCode === 403) {
        bootTokenRef.current = null;
        setActor(null);
        setAuthState("error");
        setAuthMessage(error.statusCode === 403 ? "This account does not have AI Grader operator access." : "Sign in again to continue.");
        setQueue(emptyQueue);
        setSelectedReportId(null);
      }
      if (!silent) {
        setQueueState("error");
        setQueueMessage(error.message);
      }
      throw error;
    }
    if (bootTokenRef.current !== token) return null;
    const rawResult = asRecord(payload.result);
    const result: FinishQueueResult = {
      source: "persisted_records",
      orderedBy: typeof rawResult.orderedBy === "string" ? rawResult.orderedBy : "chronological",
      items: Array.isArray(rawResult.items) ? (rawResult.items as FinishQueueItem[]) : [],
      stats: asRecord(rawResult.stats) as Record<string, number>,
    };
    setQueue(result);
    setSelectedReportId((current) => {
      const preferred = preferredReportId && result.items.some((item) => item.reportId === preferredReportId) ? preferredReportId : null;
      const retained = current && result.items.some((item) => item.reportId === current) ? current : null;
      return preferred || retained || result.items.find((item) => item.queueStatus !== "complete")?.reportId || result.items[0]?.reportId || null;
    });
    setQueueState("ready");
    setQueueMessage(result.items.length ? `${result.items.length} card${result.items.length === 1 ? "" : "s"} loaded.` : "No cards are in the queue.");
    return result;
  }, []);

  const ensureAuthorizedSession = useCallback(
    async (actionLabel: string): Promise<SessionPayload> => {
      let activeSession = await ensureSession();
      try {
        const verified = await verifyProductionSession(activeSession.token);
        bootTokenRef.current = activeSession.token;
        setActor(verified);
        setAuthState("authorized");
        setAuthMessage(`Signed in as ${verified.displayName}.`);
        return activeSession;
      } catch (error) {
        const requestError = error as ApiError;
        bootTokenRef.current = null;
        setActor(null);
        setQueue(emptyQueue);
        setSelectedReportId(null);
        if (requestError.statusCode !== 401) {
          setAuthState("error");
          setAuthMessage(
            requestError.statusCode === 403
              ? "This account does not have AI Grader operator access."
              : requestError.message || "Production access could not be verified."
          );
          throw requestError;
        }
        activeSession = await ensureSession({
          force: true,
          message: `Your saved sign-in expired. Sign in again to ${actionLabel}.`,
        });
        const verified = await verifyProductionSession(activeSession.token);
        bootTokenRef.current = activeSession.token;
        setActor(verified);
        setAuthState("authorized");
        setAuthMessage(`Signed in as ${verified.displayName}.`);
        return activeSession;
      }
    },
    [ensureSession]
  );

  const authenticatedHeaders = useCallback(
    async (extra: Record<string, string> = {}, actionLabel = "continue") => {
      const activeSession = await ensureAuthorizedSession(actionLabel);
      return buildAdminHeaders(activeSession.token, extra);
    },
    [ensureAuthorizedSession]
  );

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.token) {
      bootTokenRef.current = null;
      setActor(null);
      setAuthState("signed_out");
      setAuthMessage("Ten Kings SMS sign-in is required.");
      setQueue(emptyQueue);
      setQueueState("idle");
      setQueueMessage("Sign in to load the finishing queue.");
      return;
    }
    if (bootTokenRef.current === session.token) return;
    bootTokenRef.current = session.token;
    let cancelled = false;
    setAuthState("checking");
    setAuthMessage("Verifying production access.");
    void (async () => {
      try {
        const verified = await verifyProductionSession(session.token);
        if (cancelled) return;
        setActor(verified);
        setAuthState("authorized");
        setAuthMessage(`Signed in as ${verified.displayName}.`);
        await loadQueueWithToken(session.token);
      } catch (error) {
        if (cancelled) return;
        const requestError = error as ApiError;
        bootTokenRef.current = null;
        setActor(null);
        setAuthState("error");
        setQueue(emptyQueue);
        setSelectedReportId(null);
        setAuthMessage(
          requestError.statusCode === 403
            ? "This account does not have AI Grader operator access."
            : requestError.message || "Production access could not be verified."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadQueueWithToken, session?.token, sessionLoading]);

  const hasPendingComps = queue.items.some((item) => compsStatusPending(item.valuation.status));

  useEffect(() => {
    if (!hasPendingComps || !session?.token || authState !== "authorized") return;
    const timer = window.setInterval(() => {
      void loadQueueWithToken(session.token, selectedReportId, true).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [authState, hasPendingComps, loadQueueWithToken, selectedReportId, session?.token]);

  const counts = useMemo(() => {
    const result: Record<StageFilter, number> = {
      active: 0,
      needs_comps_review: 0,
      needs_slab_photos: 0,
      ready_for_inventory: 0,
      complete: 0,
    };
    for (const item of queue.items) {
      result[item.queueStatus] += 1;
      if (item.queueStatus !== "complete") result.active += 1;
    }
    return result;
  }, [queue.items]);

  const visibleItems = useMemo(
    () => queue.items.filter((item) => (filter === "active" ? item.queueStatus !== "complete" : item.queueStatus === filter)),
    [filter, queue.items]
  );

  useEffect(() => {
    if (!visibleItems.length) {
      setSelectedReportId(null);
      return;
    }
    if (!selectedReportId || !visibleItems.some((item) => item.reportId === selectedReportId)) {
      setSelectedReportId(visibleItems[0].reportId);
    }
  }, [selectedReportId, visibleItems]);

  const selectedItem = queue.items.find((item) => item.reportId === selectedReportId) ?? null;
  const selectedCandidates = selectedItem?.valuation.compsRefs ?? [];
  const checkedIds = selectedItem ? selectedCompIds[selectedItem.reportId] ?? [] : [];
  const selectedComps = selectedCandidates.filter((comp, index) => checkedIds.includes(compKey(comp, index)));
  const selectedPrices = selectedComps.map((comp) => priceMinor(comp.price)).filter((value): value is number => value !== null);
  const selectedAverage = selectedComps.length > 0 && selectedPrices.length === selectedComps.length
    ? Math.round(selectedPrices.reduce((sum, value) => sum + value, 0) / selectedPrices.length)
    : null;

  const setNotice = (reportId: string, tone: NoticeTone, message: string) => {
    setNotices((current) => ({ ...current, [reportId]: { tone, message } }));
  };

  const signIn = async () => {
    setBusyAction("sign-in");
    setAuthState("checking");
    setAuthMessage("Opening secure sign-in.");
    try {
      const activeSession = await ensureSession({
        force: Boolean(session),
        message: "Sign in with an approved Ten Kings operator or admin account.",
      });
      const verified = await verifyProductionSession(activeSession.token);
      bootTokenRef.current = activeSession.token;
      setActor(verified);
      setAuthState("authorized");
      setAuthMessage(`Signed in as ${verified.displayName}.`);
      await loadQueueWithToken(activeSession.token);
    } catch (error) {
      const requestError = error as ApiError;
      setActor(null);
      setAuthState("error");
      setAuthMessage(
        requestError.statusCode === 403
          ? "This account does not have AI Grader operator access."
          : requestError.message || "Sign-in was not completed."
      );
    } finally {
      setBusyAction(null);
    }
  };

  const signOut = () => {
    logout();
    bootTokenRef.current = null;
    setActor(null);
    setAuthState("signed_out");
    setAuthMessage("Ten Kings SMS sign-in is required.");
    setQueue(emptyQueue);
    setSelectedReportId(null);
  };

  const refreshQueue = async () => {
    setBusyAction("refresh");
    try {
      const activeSession = await ensureAuthorizedSession("refresh the finishing queue");
      await loadQueueWithToken(activeSession.token, selectedReportId);
    } catch (error) {
      setQueueState("error");
      setQueueMessage(error instanceof Error ? error.message : "The finishing queue could not be refreshed.");
    } finally {
      setBusyAction(null);
    }
  };

  const toggleComp = (reportId: string, id: string) => {
    setSelectedCompIds((current) => {
      const next = new Set(current[reportId] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [reportId]: Array.from(next) };
    });
  };

  const retryComps = async (item: FinishQueueItem) => {
    setBusyAction(`comps:${item.reportId}`);
    setNotice(item.reportId, "info", "Starting the sold-listing lookup.");
    try {
      const reportResponse = await fetch(`/api/ai-grader/reports/${encodeURIComponent(item.reportId)}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const reportPayload = await readPayload(reportResponse);
      const fullBundle = asRecord(reportPayload.bundle);
      if (!reportResponse.ok || reportPayload.ok !== true || !Object.keys(fullBundle).length) {
        throw apiError(reportResponse, reportPayload, "The published report could not be loaded for comps.");
      }
      const fullRelease = asRecord(fullBundle.productionRelease);
      if (!Object.keys(fullRelease).length) throw new Error("The published report does not contain a production release.");
      const identity = asRecord(fullBundle.cardIdentity);
      const finalGrade = asRecord(fullRelease.finalGrade);
      const reportBundle = {
        reportId: item.reportId,
        cardIdentity: {
          title: typeof identity.title === "string" && identity.title.trim() ? identity.title : item.cardTitle,
          set: typeof identity.set === "string" ? identity.set : undefined,
          cardNumber: typeof identity.cardNumber === "string" ? identity.cardNumber : undefined,
        },
      };
      const productionRelease = {
        reportId: item.reportId,
        finalGradeComputed: fullRelease.finalGradeComputed === true,
        finalGrade: {
          overall: typeof finalGrade.overall === "number" ? finalGrade.overall : item.grade,
        },
      };
      const response = await fetch("/api/admin/ai-grader/production/run-comps", {
        method: "POST",
        headers: await authenticatedHeaders({ "content-type": "application/json" }, "retry eBay sold comps"),
        body: JSON.stringify({
          reportId: item.reportId,
          reportBundle,
          productionRelease,
          selection: {
            cardAssetId: item.cardAssetId,
            itemId: item.itemId,
            title: item.cardTitle,
          },
          limit: 10,
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || payload.ok !== true) throw apiError(response, payload, "The comps lookup could not be started.");
      const result = asRecord(payload.result);
      if (result.status === "failed") {
        throw new Error(typeof result.message === "string" ? result.message : "The comps lookup failed.");
      }
      if (result.liveExecutionEnabled === false && result.persisted !== true) {
        throw new Error(typeof result.message === "string" ? result.message : "The comps lookup is not available.");
      }
      setNotice(
        item.reportId,
        "success",
        result.status === "ready" ? "Comps are ready for review." : "Comps queued. Results will appear here when ready."
      );
      const activeSession = await ensureAuthorizedSession("refresh comps status");
      await loadQueueWithToken(activeSession.token, item.reportId, true);
    } catch (error) {
      setNotice(item.reportId, "error", error instanceof Error ? error.message : "The comps lookup failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const saveSelectedComps = async (item: FinishQueueItem) => {
    if (!selectedComps.length || selectedAverage === null) return;
    setBusyAction(`save-comps:${item.reportId}`);
    setNotice(item.reportId, "info", "Saving selected comps and their automatic average.");
    try {
      const response = await fetch("/api/admin/ai-grader/production/save-comps-selection", {
        method: "POST",
        headers: await authenticatedHeaders({ "content-type": "application/json" }, "save selected comps"),
        body: JSON.stringify({
          reportId: item.reportId,
          selectedComps,
          searchQuery: item.valuation.searchQuery,
          searchUrl: item.valuation.searchUrl,
          valuationCurrency: item.valuation.valuationCurrency ?? "USD",
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || payload.ok !== true) throw apiError(response, payload, "Selected comps could not be saved.");
      const result = asRecord(payload.result);
      const savedValue = typeof result.valuationMinor === "number" ? result.valuationMinor : selectedAverage;
      setSelectedCompIds((current) => ({ ...current, [item.reportId]: [] }));
      setNotice(item.reportId, "success", `Valuation saved at ${formatMoney(savedValue, item.valuation.valuationCurrency ?? "USD")}.`);
      const activeSession = await ensureAuthorizedSession("refresh the card");
      await loadQueueWithToken(activeSession.token, item.reportId, true);
    } catch (error) {
      setNotice(item.reportId, "error", error instanceof Error ? error.message : "Selected comps could not be saved.");
    } finally {
      setBusyAction(null);
    }
  };

  const uploadSlabPhoto = async (item: FinishQueueItem, side: "front" | "back", file: File | null) => {
    if (!file) return;
    setBusyAction(`slab:${item.reportId}:${side}`);
    setUploads((current) => ({
      ...current,
      [item.reportId]: { ...current[item.reportId], [side]: "uploading" },
    }));
    setNotice(item.reportId, "info", `Uploading the ${side} slab photo directly to storage.`);
    try {
      const bytes = await file.arrayBuffer();
      const checksumSha256 = await sha256Hex(bytes);
      const slabMimeType = file.type || "image/jpeg";
      const slabDimensions = await assertAiGraderBrowserRaster(bytes, slabMimeType);
      const initResponse = await fetch("/api/admin/ai-grader/production/slabbed-photo-init", {
        method: "POST",
        headers: await authenticatedHeaders({ "content-type": "application/json" }, `upload the ${side} slab photo`),
        body: JSON.stringify({
          reportId: item.reportId,
          side,
          fileName: file.name,
          mimeType: slabMimeType,
          byteSize: bytes.byteLength,
          checksumSha256,
          widthPx: slabDimensions.widthPx,
          heightPx: slabDimensions.heightPx,
        }),
      });
      const initPayload = await readPayload(initResponse);
      if (!initResponse.ok || initPayload.ok !== true) {
        throw apiError(initResponse, initPayload, `The ${side} slab upload could not be prepared.`);
      }
      const plan = asRecord(initPayload.result);
      if (typeof plan.uploadUrl !== "string" || typeof plan.requiredFinalizeManifest !== "object") {
        throw new Error("The storage upload plan was incomplete.");
      }
      await uploadAiGraderArtifactDirectly({
        purpose: "slab-photo",
        uploadUrl: plan.uploadUrl,
        uploadMethod: typeof plan.uploadMethod === "string" ? plan.uploadMethod : "PUT",
        uploadHeaders: asRecord(plan.uploadHeaders) as Record<string, string>,
        contentType: slabMimeType,
        checksumSha256,
        body: bytes,
      });
      const finalizeResponse = await fetch("/api/admin/ai-grader/production/slabbed-photo-finalize", {
        method: "POST",
        headers: await authenticatedHeaders({ "content-type": "application/json" }, `attach the ${side} slab photo`),
        body: JSON.stringify(plan.requiredFinalizeManifest),
      });
      const finalizePayload = await readPayload(finalizeResponse);
      if (!finalizeResponse.ok || finalizePayload.ok !== true) {
        throw apiError(finalizeResponse, finalizePayload, `The ${side} slab photo could not be attached.`);
      }
      setUploads((current) => ({
        ...current,
        [item.reportId]: { ...current[item.reportId], [side]: "uploaded" },
      }));
      setNotice(item.reportId, "success", `${side === "front" ? "Front" : "Back"} slab photo attached.`);
      const activeSession = await ensureAuthorizedSession("refresh slab photo status");
      await loadQueueWithToken(activeSession.token, item.reportId, true);
    } catch (error) {
      setUploads((current) => ({
        ...current,
        [item.reportId]: { ...current[item.reportId], [side]: "failed" },
      }));
      setNotice(item.reportId, "error", error instanceof Error ? error.message : `The ${side} slab photo upload failed.`);
    } finally {
      setBusyAction(null);
    }
  };

  const addToInventory = async (item: FinishQueueItem) => {
    setBusyAction(`inventory:${item.reportId}`);
    setNotice(item.reportId, "info", "Completing the final inventory action.");
    try {
      const response = await fetch("/api/admin/ai-grader/production/add-to-inventory", {
        method: "POST",
        headers: await authenticatedHeaders({ "content-type": "application/json" }, "add the card to inventory"),
        body: JSON.stringify({ reportId: item.reportId }),
      });
      const payload = await readPayload(response);
      if (!response.ok || payload.ok !== true) throw apiError(response, payload, "The card could not be added to inventory.");
      setNotice(item.reportId, "success", "Inventory action complete.");
      const activeSession = await ensureAuthorizedSession("refresh the completed card");
      await loadQueueWithToken(activeSession.token, item.reportId, true);
      setFilter("complete");
      setSelectedReportId(item.reportId);
    } catch (error) {
      setNotice(item.reportId, "error", error instanceof Error ? error.message : "The card could not be added to inventory.");
    } finally {
      setBusyAction(null);
    }
  };

  const selectedAction = selectedItem ? actionMessage(selectedItem) : null;
  const selectedUpload = selectedItem ? uploads[selectedItem.reportId] ?? {} : {};
  const selectedNotice = selectedItem ? notices[selectedItem.reportId] : undefined;
  const selectedCompsPending = selectedItem ? compsStatusPending(selectedItem.valuation.status) : false;
  const selectedCanRetry = Boolean(
    selectedItem &&
      !selectedItem.valuation.complete &&
      !selectedCompsPending &&
      (selectedItem.valuation.retryable || selectedItem.valuation.errorCode || !selectedCandidates.length)
  );
  const selectedPublicReportUrl = safeHttpsUrl(selectedItem?.publicReportUrl);
  const selectedLabelPreviewUrl = safeHttpsUrl(selectedItem?.labelPreviewUrl);
  const selectedSearchUrl = safeHttpsUrl(selectedItem?.valuation.searchUrl);
  const signedIn = authState === "authorized" && Boolean(actor);

  return (
    <>
      <Head>
        <title>AI Grader Finish Queue | Ten Kings</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="page-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Ten Kings AI Grader</p>
            <h1>Finish queue</h1>
            <p className="subhead">Process cards in the same order as the physical stack.</p>
          </div>
          <div className="account-actions">
            <Link className="button secondary sheets-link" href="/ai-grader/labels/sheets">
              Label sheets
            </Link>
            <div className={`auth-state ${signedIn ? "authorized" : ""}`}>
              <span className="auth-dot" aria-hidden="true" />
              <div>
                <strong>{signedIn ? actor?.displayName : authState === "checking" ? "Checking access" : "Sign-in required"}</strong>
                <small>{authMessage}</small>
              </div>
            </div>
            {signedIn ? (
              <button type="button" className="button secondary" onClick={signOut} disabled={busyAction !== null}>
                Sign out
              </button>
            ) : (
              <button type="button" className="button primary" onClick={() => void signIn()} disabled={sessionLoading || busyAction === "sign-in"}>
                {busyAction === "sign-in" ? "Opening sign-in" : session ? "Use another account" : "Sign in"}
              </button>
            )}
          </div>
        </header>

        <section className="queue-toolbar" aria-label="Queue controls">
          <div className="tabs" role="tablist" aria-label="Queue stage">
            {stageFilters.map((stage) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === stage.id}
                className={filter === stage.id ? "tab active" : "tab"}
                key={stage.id}
                onClick={() => setFilter(stage.id)}
                disabled={!signedIn}
              >
                <span>{stage.label}</span>
                <strong>{counts[stage.id]}</strong>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button secondary refresh-button"
            onClick={() => void refreshQueue()}
            disabled={!signedIn || busyAction !== null || queueState === "loading"}
          >
            {busyAction === "refresh" || queueState === "loading" ? "Refreshing" : "Refresh"}
          </button>
        </section>

        {queueState === "error" ? <div className="global-message error" role="alert">{queueMessage}</div> : null}

        <div className="workspace">
          <aside className="queue-pane" aria-label="Cards in queue">
            <div className="pane-heading">
              <div>
                <p className="eyebrow">Chronological queue</p>
                <h2>{stageFilters.find((stage) => stage.id === filter)?.label}</h2>
              </div>
              <span>{visibleItems.length}</span>
            </div>
            <div className="queue-list">
              {signedIn && visibleItems.length ? (
                visibleItems.map((item) => {
                  const position = queue.items.findIndex((candidate) => candidate.reportId === item.reportId) + 1;
                  return (
                    <button
                      type="button"
                      className={item.reportId === selectedReportId ? "queue-row selected" : "queue-row"}
                      key={item.reportId}
                      onClick={() => setSelectedReportId(item.reportId)}
                    >
                      <span className="position">{position}</span>
                      <span className="queue-copy">
                        <strong>{item.cardTitle}</strong>
                        <small>
                          {item.certId ?? item.reportId}
                          {item.label.sheetNumber && item.label.slot ? ` / Sheet ${item.label.sheetNumber}, slot ${item.label.slot}` : ""}
                        </small>
                        <small>{formatDate(item.publishedAt ?? item.createdAt)}</small>
                      </span>
                      <span className="queue-meta">
                        <strong>{gradeLabel(item.grade)}</strong>
                        <em className={`stage-badge ${item.queueStatus}`}>{stageLabel(item.queueStatus)}</em>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="empty-state">
                  <strong>{signedIn ? "No cards in this stage" : "Sign in to view cards"}</strong>
                  <p>{signedIn ? queueMessage : "Approved operator access is required."}</p>
                </div>
              )}
            </div>
          </aside>

          <section className="detail-pane" aria-live="polite">
            {selectedItem && selectedAction ? (
              <>
                <div className="detail-heading">
                  <div>
                    <p className="eyebrow">Selected card</p>
                    <h2>{selectedItem.cardTitle}</h2>
                    <p>
                      {selectedItem.certId ?? selectedItem.reportId} / {gradeLabel(selectedItem.grade)}
                      {selectedItem.label.sheetNumber && selectedItem.label.slot
                        ? ` / Sheet ${selectedItem.label.sheetNumber}, slot ${selectedItem.label.slot}`
                        : ""}
                      {` / ${formatDate(selectedItem.publishedAt ?? selectedItem.createdAt)}`}
                    </p>
                  </div>
                  <span className={`stage-badge large ${selectedItem.queueStatus}`}>{stageLabel(selectedItem.queueStatus)}</span>
                </div>

                <div className={`next-action ${selectedItem.valuation.errorMessage ? "blocked" : selectedItem.queueStatus === "complete" ? "done" : ""}`}>
                  <div>
                    <span>Next action</span>
                    <strong>{selectedAction.title}</strong>
                    <p>{selectedAction.message}</p>
                  </div>
                  {selectedItem.queueStatus === "needs_comps_review" && selectedCanRetry ? (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => void retryComps(selectedItem)}
                      disabled={busyAction !== null}
                    >
                      {busyAction === `comps:${selectedItem.reportId}` ? "Starting comps" : "Retry comps"}
                    </button>
                  ) : null}
                  {selectedItem.queueStatus === "ready_for_inventory" ? (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => void addToInventory(selectedItem)}
                      disabled={!selectedItem.inventory.canAddToInventory || busyAction !== null}
                    >
                      {busyAction === `inventory:${selectedItem.reportId}` ? "Adding" : "Add to inventory"}
                    </button>
                  ) : null}
                </div>

                {selectedNotice ? <div className={`card-notice ${selectedNotice.tone}`} role={selectedNotice.tone === "error" ? "alert" : "status"}>{selectedNotice.message}</div> : null}

                <ol className="progress-steps" aria-label="Finishing progress">
                  <li className={selectedItem.valuation.complete ? "done" : selectedItem.queueStatus === "needs_comps_review" ? "current" : ""}>
                    <span>1</span>
                    <div><strong>Comps reviewed</strong><small>{selectedItem.valuation.complete ? formatMoney(selectedItem.valuation.valuationMinor, selectedItem.valuation.valuationCurrency ?? "USD") : "Pending"}</small></div>
                  </li>
                  <li className={selectedItem.slabPhotos.complete ? "done" : selectedItem.queueStatus === "needs_slab_photos" ? "current" : ""}>
                    <span>2</span>
                    <div><strong>Slab photos</strong><small>{selectedItem.slabPhotos.complete ? "Front and back attached" : "Pending"}</small></div>
                  </li>
                  <li className={selectedItem.inventory.complete ? "done" : selectedItem.queueStatus === "ready_for_inventory" ? "current" : ""}>
                    <span>3</span>
                    <div><strong>Inventory</strong><small>{selectedItem.inventory.complete ? "Complete" : "Pending"}</small></div>
                  </li>
                </ol>

                <div className="resource-links">
                  {selectedPublicReportUrl ? <a href={selectedPublicReportUrl} target="_blank" rel="noreferrer">Open public report</a> : null}
                  {selectedLabelPreviewUrl ? <a href={selectedLabelPreviewUrl}>Open label sheets</a> : null}
                  {selectedSearchUrl ? <a href={selectedSearchUrl} target="_blank" rel="noreferrer">Open comps search</a> : null}
                </div>

                <section className={selectedItem.queueStatus === "needs_comps_review" ? "work-section current-section" : "work-section"}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Step 1</p>
                      <h3>eBay sold comps</h3>
                    </div>
                    <strong>{selectedItem.valuation.complete ? formatMoney(selectedItem.valuation.valuationMinor, selectedItem.valuation.valuationCurrency ?? "USD") : selectedCompsPending ? "Processing" : `${selectedCandidates.length} candidates`}</strong>
                  </div>

                  {selectedItem.valuation.errorMessage ? (
                    <div className="comps-error" role="alert">
                      <strong>{selectedItem.valuation.errorCode ?? "Comps lookup failed"}</strong>
                      <p>{selectedItem.valuation.errorMessage}</p>
                      {selectedItem.valuation.retryable ? <span>Retryable</span> : null}
                    </div>
                  ) : null}

                  {selectedCandidates.length ? (
                    <div className="comps-list">
                      {selectedCandidates.map((comp, index) => {
                        const id = compKey(comp, index);
                        const imageUrl = safeHttpsUrl(comp.listingImageUrl ?? comp.screenshotUrl ?? comp.thumbnail);
                        const listingUrl = safeHttpsUrl(comp.url);
                        return (
                          <div className={checkedIds.includes(id) ? "comp-row checked" : "comp-row"} key={id}>
                            <label className="comp-check">
                              <input
                                type="checkbox"
                                checked={checkedIds.includes(id)}
                                onChange={() => toggleComp(selectedItem.reportId, id)}
                                disabled={selectedItem.valuation.complete || busyAction !== null}
                              />
                              <span className="sr-only">Select {comp.title ?? `sold comp ${index + 1}`}</span>
                            </label>
                            {imageUrl ? <img src={imageUrl} alt="" /> : <span className="image-placeholder">Sold</span>}
                            <span className="comp-copy">
                              <strong>{comp.title ?? "eBay sold listing"}</strong>
                              <small>{[comp.soldDate, comp.matchQuality].filter(Boolean).join(" / ") || "Sold listing"}</small>
                              {listingUrl ? <a href={listingUrl} target="_blank" rel="noreferrer">View listing</a> : null}
                            </span>
                            <strong className="comp-price">{comp.price ?? "Price unavailable"}</strong>
                          </div>
                        );
                      })}
                    </div>
                  ) : selectedCompsPending ? (
                    <div className="processing-state"><span aria-hidden="true" /><p>Background lookup in progress. This queue refreshes automatically.</p></div>
                  ) : (
                    <div className="section-empty"><p>No persisted sold-comp candidates are ready.</p></div>
                  )}

                  {!selectedItem.valuation.complete && selectedCandidates.length ? (
                    <div className="selection-bar">
                      <div>
                        <span>Selected average</span>
                        <strong>{selectedAverage === null ? "Select priced comps" : formatMoney(selectedAverage, selectedItem.valuation.valuationCurrency ?? "USD")}</strong>
                        <small>{selectedComps.length} selected / {selectedPrices.length} with prices</small>
                      </div>
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => void saveSelectedComps(selectedItem)}
                        disabled={!selectedComps.length || selectedAverage === null || busyAction !== null}
                      >
                        {busyAction === `save-comps:${selectedItem.reportId}` ? "Saving average" : "Save selected comps"}
                      </button>
                    </div>
                  ) : null}

                  {!selectedItem.valuation.complete && selectedCanRetry && selectedItem.queueStatus !== "needs_comps_review" ? (
                    <button type="button" className="button secondary" onClick={() => void retryComps(selectedItem)} disabled={busyAction !== null}>
                      Retry comps
                    </button>
                  ) : null}
                </section>

                <section className={selectedItem.queueStatus === "needs_slab_photos" ? "work-section current-section" : "work-section"}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Step 2</p>
                      <h3>Slab photos</h3>
                    </div>
                    <strong>{selectedItem.slabPhotos.complete ? "Complete" : "Front + back required"}</strong>
                  </div>
                  <div className="photo-grid">
                    {(["front", "back"] as const).map((side) => {
                      const persisted = side === "front" ? selectedItem.slabPhotos.frontUploaded : selectedItem.slabPhotos.backUploaded;
                      const publicUrl = safeHttpsUrl(side === "front" ? selectedItem.slabPhotos.frontUrl : selectedItem.slabPhotos.backUrl);
                      const uploadState = selectedUpload[side];
                      return (
                        <div className={persisted || uploadState === "uploaded" ? "photo-slot complete" : "photo-slot"} key={side}>
                          {publicUrl ? <img src={publicUrl} alt={`${side} slab`} /> : <div className="photo-placeholder"><strong>{side === "front" ? "Front" : "Back"}</strong><span>Photo required</span></div>}
                          <div className="photo-actions">
                            <div><strong>{side === "front" ? "Front slab" : "Back slab"}</strong><small>{uploadState === "uploading" ? "Uploading" : persisted || uploadState === "uploaded" ? "Attached" : uploadState === "failed" ? "Upload failed" : "Needed"}</small></div>
                            <label className={busyAction !== null ? "file-button disabled" : "file-button"}>
                              {persisted ? "Replace" : "Upload"}
                              <input
                                type="file"
                                accept="image/*"
                                disabled={busyAction !== null}
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0] ?? null;
                                  event.currentTarget.value = "";
                                  void uploadSlabPhoto(selectedItem, side, file);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className={selectedItem.queueStatus === "ready_for_inventory" ? "work-section current-section" : "work-section"}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Step 3</p>
                      <h3>Inventory gates</h3>
                    </div>
                    <strong>{selectedItem.inventory.complete ? "Complete" : selectedItem.inventory.canAddToInventory ? "Ready" : "Waiting"}</strong>
                  </div>
                  <div className="gate-list">
                    <div className={selectedItem.valuation.complete ? "gate passed" : "gate"}><span>{selectedItem.valuation.complete ? "Pass" : "Wait"}</span><strong>Selected comps and value</strong></div>
                    <div className={selectedItem.slabPhotos.complete ? "gate passed" : "gate"}><span>{selectedItem.slabPhotos.complete ? "Pass" : "Wait"}</span><strong>Front and back slab photos</strong></div>
                    <div className={selectedItem.label.printed ? "gate passed" : "gate"}><span>{selectedItem.label.printed ? "Pass" : "Wait"}</span><strong>Label sheet marked printed</strong></div>
                  </div>
                  {!selectedItem.inventory.complete ? (
                    <button
                      type="button"
                      className="button primary inventory-button"
                      onClick={() => void addToInventory(selectedItem)}
                      disabled={!selectedItem.inventory.canAddToInventory || busyAction !== null}
                    >
                      {busyAction === `inventory:${selectedItem.reportId}` ? "Adding to inventory" : "Add to inventory"}
                    </button>
                  ) : (
                    <div className="inventory-complete"><strong>Inventory complete</strong><span>This card needs no further action.</span></div>
                  )}
                </section>
              </>
            ) : (
              <div className="detail-empty">
                <strong>{signedIn ? "Select a card" : "Production access required"}</strong>
                <p>{signedIn ? "Choose a queue row to review its next action." : "Sign in with an approved Ten Kings account to continue."}</p>
              </div>
            )}
          </section>
        </div>
      </main>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f4f6f7;
        }
        :global(*) {
          box-sizing: border-box;
        }
        .page-shell {
          min-height: 100vh;
          color: #172026;
          background: #f4f6f7;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          min-height: 96px;
          padding: 18px 28px;
          background: #ffffff;
          border-bottom: 1px solid #dbe1e4;
        }
        h1,
        h2,
        h3,
        p {
          margin: 0;
        }
        h1 {
          margin-top: 2px;
          font-size: 28px;
          line-height: 1.15;
        }
        h2 {
          font-size: 20px;
          line-height: 1.25;
        }
        h3 {
          font-size: 17px;
          line-height: 1.3;
        }
        .eyebrow {
          color: #63717a;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .subhead {
          margin-top: 5px;
          color: #63717a;
          font-size: 13px;
        }
        .account-actions,
        .auth-state,
        .queue-toolbar,
        .tabs,
        .pane-heading,
        .detail-heading,
        .section-heading,
        .resource-links,
        .selection-bar,
        .photo-actions,
        .inventory-complete {
          display: flex;
          align-items: center;
        }
        .account-actions {
          gap: 12px;
        }
        .auth-state {
          gap: 9px;
          min-width: 220px;
          padding: 8px 10px;
          border-left: 3px solid #c7cfd3;
        }
        .auth-state.authorized {
          border-left-color: #16855b;
        }
        .auth-state div {
          display: grid;
          gap: 2px;
        }
        .auth-state strong,
        .auth-state small {
          max-width: 280px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .auth-state strong {
          font-size: 13px;
        }
        .auth-state small {
          color: #63717a;
          font-size: 11px;
        }
        .auth-dot {
          width: 9px;
          height: 9px;
          flex: 0 0 9px;
          border-radius: 50%;
          background: #a9b3b8;
        }
        .authorized .auth-dot {
          background: #16855b;
        }
        .button,
        .tab,
        .queue-row,
        .file-button {
          font: inherit;
          cursor: pointer;
        }
        .button {
          min-height: 38px;
          padding: 8px 14px;
          border-radius: 6px;
          border: 1px solid transparent;
          font-size: 13px;
          font-weight: 750;
        }
        .button.primary {
          color: #ffffff;
          background: #176b87;
          border-color: #176b87;
        }
        .button.secondary {
          color: #26343c;
          background: #ffffff;
          border-color: #cbd3d7;
        }
        .sheets-link {
          display: inline-grid;
          place-items: center;
          text-decoration: none;
        }
        .button:hover:not(:disabled),
        .file-button:hover:not(.disabled) {
          filter: brightness(0.96);
        }
        .button:disabled,
        .tab:disabled,
        .file-button.disabled {
          cursor: not-allowed;
          opacity: 0.52;
        }
        .queue-toolbar {
          justify-content: space-between;
          gap: 18px;
          padding: 12px 28px;
          background: #ffffff;
          border-bottom: 1px solid #dbe1e4;
          overflow-x: auto;
        }
        .tabs {
          gap: 4px;
        }
        .tab {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 38px;
          padding: 7px 11px;
          color: #53616a;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          white-space: nowrap;
        }
        .tab strong {
          display: grid;
          place-items: center;
          min-width: 23px;
          height: 21px;
          padding: 0 6px;
          color: #53616a;
          background: #edf0f2;
          border-radius: 5px;
          font-size: 11px;
        }
        .tab.active {
          color: #172026;
          background: #eef5f7;
          border-color: #a9cbd6;
          font-weight: 750;
        }
        .tab.active strong {
          color: #ffffff;
          background: #176b87;
        }
        .refresh-button {
          flex: 0 0 auto;
        }
        .global-message {
          margin: 14px 28px 0;
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 13px;
        }
        .global-message.error {
          color: #8f2722;
          background: #fff1ef;
          border: 1px solid #e8b4af;
        }
        .workspace {
          display: grid;
          grid-template-columns: minmax(320px, 0.7fr) minmax(520px, 1.3fr);
          width: 100%;
          min-height: calc(100vh - 159px);
        }
        .queue-pane {
          min-width: 0;
          background: #eef1f2;
          border-right: 1px solid #d2d9dc;
        }
        .pane-heading {
          justify-content: space-between;
          min-height: 70px;
          padding: 14px 18px;
          border-bottom: 1px solid #d2d9dc;
        }
        .pane-heading > span {
          min-width: 32px;
          padding: 5px 8px;
          text-align: center;
          color: #53616a;
          background: #ffffff;
          border: 1px solid #d2d9dc;
          border-radius: 5px;
          font-size: 12px;
          font-weight: 800;
        }
        .queue-list {
          display: grid;
          gap: 6px;
          padding: 10px;
        }
        .queue-row {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          width: 100%;
          min-height: 82px;
          padding: 10px;
          text-align: left;
          color: #26343c;
          background: #ffffff;
          border: 1px solid #d7dddf;
          border-radius: 6px;
        }
        .queue-row:hover {
          border-color: #9fb3bc;
        }
        .queue-row.selected {
          border-color: #176b87;
          box-shadow: inset 3px 0 0 #176b87;
        }
        .position {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          color: #53616a;
          background: #edf0f2;
          border-radius: 5px;
          font-size: 12px;
          font-weight: 850;
        }
        .queue-copy,
        .queue-meta {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .queue-copy > strong {
          overflow: hidden;
          font-size: 13px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .queue-copy small,
        .queue-meta > strong {
          color: #6a777e;
          font-size: 11px;
          font-style: normal;
        }
        .queue-meta {
          justify-items: end;
        }
        .queue-meta > strong {
          color: #26343c;
        }
        .stage-badge {
          display: inline-flex;
          align-items: center;
          min-height: 23px;
          padding: 3px 7px;
          border-radius: 5px;
          font-size: 10px;
          font-style: normal;
          font-weight: 800;
          white-space: nowrap;
        }
        .stage-badge.large {
          min-height: 30px;
          padding: 5px 9px;
          font-size: 11px;
        }
        .stage-badge.needs_comps_review {
          color: #73510d;
          background: #fff4cf;
          border: 1px solid #e8ce79;
        }
        .stage-badge.needs_slab_photos {
          color: #81501e;
          background: #fff0df;
          border: 1px solid #e5bd91;
        }
        .stage-badge.ready_for_inventory {
          color: #155f4a;
          background: #e7f6ef;
          border: 1px solid #98d2bd;
        }
        .stage-badge.complete {
          color: #41505a;
          background: #e9edef;
          border: 1px solid #c2cbd0;
        }
        .empty-state,
        .detail-empty {
          display: grid;
          place-items: center;
          align-content: center;
          min-height: 220px;
          padding: 28px;
          text-align: center;
          color: #63717a;
        }
        .empty-state strong,
        .detail-empty strong {
          color: #26343c;
        }
        .empty-state p,
        .detail-empty p {
          margin-top: 5px;
          font-size: 13px;
        }
        .detail-pane {
          min-width: 0;
          padding: 22px 26px 48px;
          background: #ffffff;
        }
        .detail-heading {
          justify-content: space-between;
          gap: 18px;
          padding-bottom: 18px;
          border-bottom: 1px solid #dde2e4;
        }
        .detail-heading h2 {
          margin-top: 3px;
        }
        .detail-heading p:last-child {
          margin-top: 5px;
          color: #63717a;
          font-size: 12px;
        }
        .next-action {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          margin: 18px 0;
          padding: 14px 16px;
          background: #edf6f8;
          border: 1px solid #a9cbd6;
          border-left: 4px solid #176b87;
          border-radius: 6px;
        }
        .next-action.blocked {
          background: #fff1ef;
          border-color: #e8b4af;
          border-left-color: #b13c34;
        }
        .next-action.done {
          background: #eaf6f0;
          border-color: #a8d5c3;
          border-left-color: #16855b;
        }
        .next-action div {
          display: grid;
          gap: 3px;
        }
        .next-action span {
          color: #63717a;
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
        }
        .next-action strong {
          font-size: 15px;
        }
        .next-action p {
          color: #53616a;
          font-size: 12px;
        }
        .card-notice {
          margin: -8px 0 18px;
          padding: 9px 11px;
          border-radius: 6px;
          font-size: 12px;
        }
        .card-notice.info {
          color: #315a6a;
          background: #edf6f8;
          border: 1px solid #b8d6df;
        }
        .card-notice.success {
          color: #155f4a;
          background: #eaf6f0;
          border: 1px solid #a8d5c3;
        }
        .card-notice.error {
          color: #8f2722;
          background: #fff1ef;
          border: 1px solid #e8b4af;
        }
        .progress-steps {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1px;
          margin: 0;
          padding: 0;
          list-style: none;
          background: #d8dee1;
          border: 1px solid #d8dee1;
          border-radius: 6px;
          overflow: hidden;
        }
        .progress-steps li {
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr);
          gap: 9px;
          align-items: center;
          min-height: 62px;
          padding: 9px 11px;
          background: #f6f7f8;
        }
        .progress-steps li > span {
          display: grid;
          place-items: center;
          width: 26px;
          height: 26px;
          color: #65737b;
          background: #e3e7e9;
          border-radius: 50%;
          font-size: 11px;
          font-weight: 850;
        }
        .progress-steps li div {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .progress-steps strong,
        .progress-steps small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .progress-steps strong {
          font-size: 12px;
        }
        .progress-steps small {
          color: #6a777e;
          font-size: 10px;
        }
        .progress-steps li.done {
          background: #edf7f2;
        }
        .progress-steps li.done > span {
          color: #ffffff;
          background: #16855b;
        }
        .progress-steps li.current {
          background: #eef5f7;
        }
        .progress-steps li.current > span {
          color: #ffffff;
          background: #176b87;
        }
        .resource-links {
          flex-wrap: wrap;
          gap: 12px;
          min-height: 48px;
          padding: 8px 0;
          border-bottom: 1px solid #e0e5e7;
        }
        .resource-links a,
        .comp-copy a {
          color: #176b87;
          font-size: 12px;
          font-weight: 750;
          text-decoration: none;
        }
        .resource-links a:hover,
        .comp-copy a:hover {
          text-decoration: underline;
        }
        .work-section {
          padding: 22px 0;
          border-bottom: 1px solid #dde2e4;
        }
        .work-section.current-section {
          box-shadow: inset 3px 0 0 #176b87;
          padding-left: 16px;
        }
        .section-heading {
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 14px;
        }
        .section-heading > strong {
          color: #53616a;
          font-size: 12px;
        }
        .comps-error {
          margin-bottom: 12px;
          padding: 11px 12px;
          color: #8f2722;
          background: #fff1ef;
          border: 1px solid #e8b4af;
          border-radius: 6px;
        }
        .comps-error p {
          margin-top: 3px;
          font-size: 12px;
        }
        .comps-error span {
          display: inline-block;
          margin-top: 7px;
          padding: 2px 6px;
          color: #8f2722;
          background: #ffffff;
          border: 1px solid #d9918b;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 850;
        }
        .comps-list {
          display: grid;
          gap: 6px;
          max-height: 480px;
          overflow-y: auto;
        }
        .comp-row {
          display: grid;
          grid-template-columns: 20px 58px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          min-height: 72px;
          padding: 7px 9px;
          background: #f8f9f9;
          border: 1px solid #dce2e4;
          border-radius: 6px;
          cursor: pointer;
        }
        .comp-row.checked {
          background: #eef6f8;
          border-color: #7fb4c4;
        }
        .comp-row input {
          width: 16px;
          height: 16px;
          accent-color: #176b87;
        }
        .comp-check {
          display: grid;
          place-items: center;
          width: 20px;
          height: 34px;
          cursor: pointer;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .comp-row img,
        .image-placeholder {
          width: 58px;
          height: 58px;
          border-radius: 4px;
        }
        .comp-row img {
          object-fit: cover;
          background: #e7ebed;
        }
        .image-placeholder {
          display: grid;
          place-items: center;
          color: #68767e;
          background: #e7ebed;
          font-size: 10px;
          font-weight: 800;
        }
        .comp-copy {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .comp-copy > strong {
          overflow: hidden;
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .comp-copy small {
          color: #6a777e;
          font-size: 10px;
        }
        .comp-price {
          max-width: 110px;
          color: #26343c;
          font-size: 12px;
          text-align: right;
        }
        .processing-state,
        .section-empty {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 74px;
          padding: 14px;
          color: #63717a;
          background: #f7f8f8;
          border: 1px solid #dce2e4;
          border-radius: 6px;
          font-size: 12px;
        }
        .processing-state > span {
          width: 12px;
          height: 12px;
          flex: 0 0 12px;
          border: 2px solid #b7c8cf;
          border-top-color: #176b87;
          border-radius: 50%;
          animation: spin 0.9s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .selection-bar {
          justify-content: space-between;
          gap: 18px;
          margin-top: 10px;
          padding: 11px 12px;
          background: #eef5f7;
          border: 1px solid #a9cbd6;
          border-radius: 6px;
        }
        .selection-bar > div {
          display: grid;
          gap: 2px;
        }
        .selection-bar span,
        .selection-bar small {
          color: #63717a;
          font-size: 10px;
        }
        .selection-bar strong {
          font-size: 17px;
        }
        .photo-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .photo-slot {
          min-width: 0;
          background: #f7f8f8;
          border: 1px solid #d5dcdf;
          border-radius: 6px;
          overflow: hidden;
        }
        .photo-slot.complete {
          border-color: #8dc8b1;
        }
        .photo-slot > img,
        .photo-placeholder {
          width: 100%;
          aspect-ratio: 4 / 3;
        }
        .photo-slot > img {
          display: block;
          object-fit: cover;
          background: #e4e8ea;
        }
        .photo-placeholder {
          display: grid;
          place-items: center;
          align-content: center;
          gap: 4px;
          color: #6a777e;
          background: #e9edef;
        }
        .photo-placeholder strong {
          color: #44535b;
          font-size: 14px;
          text-transform: capitalize;
        }
        .photo-placeholder span {
          font-size: 11px;
        }
        .photo-actions {
          justify-content: space-between;
          gap: 12px;
          min-height: 58px;
          padding: 8px 10px;
          background: #ffffff;
          border-top: 1px solid #dce2e4;
        }
        .photo-actions > div {
          display: grid;
          gap: 2px;
        }
        .photo-actions strong {
          font-size: 12px;
        }
        .photo-actions small {
          color: #6a777e;
          font-size: 10px;
        }
        .file-button {
          position: relative;
          min-width: 72px;
          padding: 7px 10px;
          text-align: center;
          color: #26343c;
          background: #ffffff;
          border: 1px solid #bdc8cd;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 800;
          overflow: hidden;
        }
        .file-button input {
          position: absolute;
          inset: 0;
          width: 100%;
          opacity: 0;
          cursor: pointer;
        }
        .gate-list {
          display: grid;
          gap: 6px;
          margin-bottom: 12px;
        }
        .gate {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          min-height: 42px;
          padding: 7px 9px;
          background: #f7f8f8;
          border: 1px solid #dce2e4;
          border-radius: 6px;
        }
        .gate span {
          padding: 3px 5px;
          text-align: center;
          color: #73510d;
          background: #fff4cf;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 850;
          text-transform: uppercase;
        }
        .gate strong {
          font-size: 12px;
        }
        .gate.passed {
          background: #f0f8f4;
          border-color: #b2d9ca;
        }
        .gate.passed span {
          color: #155f4a;
          background: #dff2e9;
        }
        .inventory-button {
          width: 100%;
        }
        .inventory-complete {
          justify-content: space-between;
          min-height: 48px;
          padding: 9px 11px;
          color: #155f4a;
          background: #eaf6f0;
          border: 1px solid #a8d5c3;
          border-radius: 6px;
        }
        .inventory-complete span {
          font-size: 11px;
        }
        @media (max-width: 980px) {
          .workspace {
            grid-template-columns: 1fr;
          }
          .queue-pane {
            border-right: 0;
            border-bottom: 1px solid #d2d9dc;
          }
          .queue-list {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 700px) {
          .topbar {
            align-items: flex-start;
            padding: 16px;
          }
          .topbar,
          .account-actions {
            flex-direction: column;
          }
          .account-actions,
          .auth-state,
          .account-actions .button,
          .sheets-link {
            width: 100%;
          }
          .queue-toolbar {
            padding: 10px 16px;
          }
          .refresh-button {
            position: sticky;
            right: 0;
          }
          .queue-list,
          .photo-grid,
          .progress-steps {
            grid-template-columns: 1fr;
          }
          .detail-pane {
            padding: 18px 16px 38px;
          }
          .detail-heading,
          .next-action,
          .selection-bar,
          .inventory-complete {
            align-items: flex-start;
            flex-direction: column;
          }
          .next-action .button,
          .selection-bar .button,
          .inventory-complete {
            width: 100%;
          }
          .comp-row {
            grid-template-columns: 20px 48px minmax(0, 1fr);
          }
          .comp-row img,
          .image-placeholder {
            width: 48px;
            height: 48px;
          }
          .comp-price {
            grid-column: 3;
            max-width: none;
            text-align: left;
          }
        }
      `}</style>
    </>
  );
}
