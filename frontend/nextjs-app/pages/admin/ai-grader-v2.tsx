import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../../components/AppShell";
import {
  CaptureWorkspace,
  SpeedsterAppliedMapBadge,
  type SpeedsterCaptureBundle,
  type SpeedsterCaptureInstrumentationEvent,
} from "../../components/ai-grader-v2/CaptureWorkspace";
import { ReviewWorkspace } from "../../components/ai-grader-v2/ReviewWorkspace";
import type { SpeedsterTrainMapState } from "../../components/ai-grader-v2/SpeedsterTrainWorkspace";
import type {
  SpeedsterInMemoryTraceSave,
  SpeedsterTraceProposalInput,
} from "../../components/ai-grader-v2/DefectTraceEditor";
import SharedLabelEditor from "../../components/human-grade/SharedLabelEditor";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE,
  type HumanGradeLabelEditorValue,
} from "../../lib/humanGrade";
import { canonicalizeSpeedsterSessionIdentity } from "../../lib/ai-grader-v2/identity";
import type {
  SpeedsterDefectType,
  SpeedsterReviewFinding,
} from "../../lib/ai-grader-v2/contracts";
import { toCardMapOperatorMessage } from "../../lib/ai-grader-v2/card-map-copy";
import { speedsterImageService } from "../../lib/ai-grader-v2/image-service";
import {
  SPEEDSTER_REVIEW_IMAGE_REFRESH_INTERVAL_MS,
  createCoalescedReviewImageRefresh,
  fetchSpeedsterReviewImageUrls,
  type SpeedsterReviewImageUrls,
} from "../../lib/ai-grader-v2/review-image-urls";
import {
  calculateSpeedsterReview,
  completeSpeedsterReview,
  speedsterDetectorViews,
  type SpeedsterReviewMeasurementAction,
} from "../../lib/ai-grader-v2/review";
import {
  decodeSpeedsterTraceRleV1,
  encodeSpeedsterTraceRleV1,
} from "../../lib/ai-grader-v2/trace-codec";
import {
  decodeSpeedsterTraceBitmapWireV1,
  encodeSpeedsterTraceBitmapWireV1,
} from "../../lib/ai-grader-v2/trace-bitmap-wire";
import {
  buildSpeedsterTraceProvenanceRevision,
  isNonEmptySpeedsterTrace,
} from "../../lib/ai-grader-v2/trace-editor";
import styles from "../../styles/AiGraderV2Admin.module.css";

type SpeedsterDraft = { id: string; cardProfile: "POKEMON" | "SPORTS" };
type SpeedsterReviewRemeasurementResult =
  | Readonly<{ applied: true }>
  | Readonly<{ applied: false; message: string }>;
type SpeedsterCompletion = {
  label: { certificateNumber: string; slot: number };
  publicReportSlug: string;
  learning: {
    catchUpStatus: string;
    ready: boolean;
    bankCursor: { completionOrder: number } | null;
    harvest: { admittedLessons: number; skippedLessons: number };
  };
};
type SpeedsterClientInstrumentationDetails = Readonly<{
  side?: "FRONT" | "BACK";
  findingIds?: readonly string[];
  actionType?: "REMOVE" | "UNDO" | "TRACE_SAVE" | "CHANGE_TYPE";
  startBasis?: "FIRST_SPEEDSTER_INTERACTION";
  lowerBound?: boolean;
  automaticGeometryCount?: number;
  photoSource?: "IPHONE" | "LOCAL" | "MIXED";
  mapAppliedScope?: "EXACT" | "FAMILY" | "NONE";
  mapName?: string;
  mapRevisionId?: string;
  mapFailureCode?: "LOOKUP_FAILED" | "REGISTRATION_FAILED";
  findingCount?: number;
  filteredCount?: number;
  outcome?: "SUCCEEDED" | "FAILED";
  postCycleWork?: "PHOTOROOM" | "COMPS" | "NFC";
  errorCode?: string;
}>;

export default function AiGraderV2AdminPage() {
  const { session, loading, ensureSession } = useSession();
  const [identity, setIdentity] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [draft, setDraft] = useState<SpeedsterDraft | null>(null);
  const [mapState, setMapState] = useState<SpeedsterTrainMapState | null>(null);
  const [mapLookupFailed, setMapLookupFailed] = useState(false);
  const [capture, setCapture] = useState<SpeedsterCaptureBundle | null>(null);
  const [defects, setDefects] = useState<SpeedsterReviewFinding[] | null>(null);
  const [lastRemovedDefectIds, setLastRemovedDefectIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<SpeedsterCompletion | null>(null);
  const [reviewImageUrls, setReviewImageUrls] = useState<SpeedsterReviewImageUrls | null>(null);
  const [initializeFailed, setInitializeFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Enter the exact information that belongs on the Ten Kings label.");
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );
  const review = useMemo(
    () => capture ? calculateSpeedsterReview(capture, defects ?? []) : null,
    [capture, defects],
  );
  const sourceImageUrls = useMemo(() => {
    if (reviewImageUrls) {
      return Object.fromEntries(([
        "FRONT",
        "BACK",
      ] as const).flatMap((side) => Object.entries(reviewImageUrls[side].views)
        .map(([view, imageUrl]) => [`${side}:${view}`, imageUrl])));
    }
    return capture ? Object.fromEntries([
      ...speedsterDetectorViews(capture.front),
      ...speedsterDetectorViews(capture.back),
    ].map(({ id, imageUrl }) => [id, imageUrl])) : {};
  }, [capture, reviewImageUrls]);
  const reviewActive = Boolean(capture && review && defects !== null && !completion);
  const imageErrorRetryUsed = useRef(false);
  const cycleStartedAt = useRef<number | null>(null);
  const nextReadyRecorded = useRef(false);
  const reviewRenderedRecorded = useRef(false);

  const beginCycle = useCallback(() => {
    if (cycleStartedAt.current === null) cycleStartedAt.current = Date.now();
    return cycleStartedAt.current;
  }, []);

  const recordInstrumentation = useCallback((input: {
    sessionId: string;
    eventType:
      | "FIRST_SPEEDSTER_INTERACTION"
      | "DRAFT_CREATED"
      | "PHOTOS_READY"
      | "GEOMETRY_PROPOSED"
      | "GEOMETRY_CONFIRMED"
      | "CENTERING_CONFIRMED"
      | "CAPTURE_SAVED"
      | "SAM_MEMORY_COMPLETED"
      | "REVIEW_RENDERED"
      | "REVIEW_ACTION_COMPLETED"
      | "GRADE_COMPLETION_REQUESTED"
      | "GRADE_COMPLETION_RESPONSE"
      | "NEXT_READY_RENDERED"
      | "NEXT_CARD_SELECTED"
      | "POST_CYCLE_WORK_STARTED"
      | "WORKFLOW_ERROR";
    startedAtMs: number;
    endedAtMs: number;
    details?: SpeedsterClientInstrumentationDetails;
  }) => {
    if (!session?.token) return;
    void fetch(
      `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(input.sessionId)}/instrumentation`,
      {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          eventType: input.eventType,
          clientStartedAt: new Date(input.startedAtMs).toISOString(),
          clientEndedAt: new Date(input.endedAtMs).toISOString(),
          ...(input.details ? { details: input.details } : {}),
        }),
        keepalive: true,
      },
    ).catch(() => undefined);
  }, [session?.token]);

  const recordCaptureInstrumentation = useCallback((event: SpeedsterCaptureInstrumentationEvent) => {
    if (!draft) return;
    recordInstrumentation({ sessionId: draft.id, ...event });
  }, [draft, recordInstrumentation]);
  const refreshReviewImages = useMemo(() => {
    if (!session?.token || !draft?.id) return null;
    return createCoalescedReviewImageRefresh(async () => {
      const urls = await fetchSpeedsterReviewImageUrls({ token: session.token!, sessionId: draft.id });
      setReviewImageUrls(urls);
      return urls;
    });
  }, [draft?.id, session?.token]);

  const silentlyRefreshReviewImages = useCallback(() => {
    imageErrorRetryUsed.current = false;
    void refreshReviewImages?.().catch(() => undefined);
  }, [refreshReviewImages]);

  const retryReviewImagesOnce = useCallback(() => {
    if (imageErrorRetryUsed.current) return;
    imageErrorRetryUsed.current = true;
    void refreshReviewImages?.().catch(() => undefined);
  }, [refreshReviewImages]);

  useEffect(() => {
    setReviewImageUrls(null);
    imageErrorRetryUsed.current = false;
    reviewRenderedRecorded.current = false;
  }, [draft?.id]);

  useEffect(() => {
    if (!reviewActive || !draft || !defects || reviewRenderedRecorded.current) return;
    reviewRenderedRecorded.current = true;
    const atMs = Date.now();
    recordInstrumentation({
      sessionId: draft.id,
      eventType: "REVIEW_RENDERED",
      startedAtMs: atMs,
      endedAtMs: atMs,
      details: { findingCount: defects.length },
    });
  }, [defects, draft, recordInstrumentation, reviewActive]);

  useEffect(() => {
    if (!completion || !draft || nextReadyRecorded.current) return;
    nextReadyRecorded.current = true;
    const endedAtMs = Date.now();
    recordInstrumentation({
      sessionId: draft.id,
      eventType: "NEXT_READY_RENDERED",
      startedAtMs: cycleStartedAt.current ?? endedAtMs,
      endedAtMs,
      details: {
        startBasis: "FIRST_SPEEDSTER_INTERACTION",
        lowerBound: true,
        outcome: "SUCCEEDED",
      },
    });
  }, [completion, draft, recordInstrumentation]);

  useEffect(() => {
    if (!reviewActive || !refreshReviewImages) return;
    silentlyRefreshReviewImages();
    const timer = window.setInterval(
      silentlyRefreshReviewImages,
      SPEEDSTER_REVIEW_IMAGE_REFRESH_INTERVAL_MS,
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") silentlyRefreshReviewImages();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshReviewImages, reviewActive, silentlyRefreshReviewImages]);

  const updateIdentity = (field: keyof HumanGradeLabelEditorValue, value: string) => {
    beginCycle();
    setIdentity((current) => field === "cardType"
      ? {
          ...current,
          cardType: value as HumanGradeLabelEditorValue["cardType"],
          playerName: "",
          cardName: "",
          manufacturer: "",
          insert: "",
        }
      : { ...current, [field]: value });
  };

  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.token || working) return;
    const startedAtMs = beginCycle();
    setWorking(true);
    setMessage("Creating the Speedster card.");
    try {
      const printedIdentity = canonicalizeSpeedsterSessionIdentity(
        identity.cardType,
        identity.cardType === "SPORTS"
          ? {
              playerName: identity.playerName,
              year: identity.year,
              manufacturer: identity.manufacturer,
              productSet: identity.productSet,
              parallel: identity.parallel,
              insert: identity.insert,
              cardNumber: identity.cardNumber,
            }
          : {
              cardName: identity.cardName,
              year: identity.year,
              productSet: identity.productSet,
              parallel: identity.parallel,
              cardNumber: identity.cardNumber,
            },
      );
      const response = await fetch("/api/admin/ai-grader-v2/sessions", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ cardProfile: identity.cardType, identity: printedIdentity }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        session?: SpeedsterDraft;
        message?: string;
      };
      if (!response.ok || !payload.session) throw new Error(payload.message ?? "Speedster card could not be created.");
      setDraft(payload.session);
      const endedAtMs = Date.now();
      recordInstrumentation({
        sessionId: payload.session.id,
        eventType: "FIRST_SPEEDSTER_INTERACTION",
        startedAtMs,
        endedAtMs: startedAtMs,
        details: { startBasis: "FIRST_SPEEDSTER_INTERACTION", lowerBound: true },
      });
      recordInstrumentation({
        sessionId: payload.session.id,
        eventType: "DRAFT_CREATED",
        startedAtMs,
        endedAtMs,
        details: { startBasis: "FIRST_SPEEDSTER_INTERACTION", lowerBound: true, outcome: "SUCCEEDED" },
      });
      const mapResponse = await fetch(
        `/api/admin/ai-grader-v2/maps/current?sessionId=${encodeURIComponent(payload.session.id)}&scope=EFFECTIVE`,
        { headers: buildAdminHeaders(session.token), cache: "no-store" },
      );
      const mapPayload = (await mapResponse.json().catch(() => ({}))) as {
        map?: SpeedsterTrainMapState;
        message?: string;
      };
      if (!mapResponse.ok || !mapPayload.map) {
        const failure = toCardMapOperatorMessage(mapPayload.message ?? "CARD MAP lookup failed.");
        setMapState({ status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null });
        setMapLookupFailed(true);
        recordInstrumentation({
          sessionId: payload.session.id,
          eventType: "WORKFLOW_ERROR",
          startedAtMs: endedAtMs,
          endedAtMs: Date.now(),
          details: { errorCode: "CARD_MAP_LOOKUP_FAILED", mapAppliedScope: "NONE" },
        });
        setMessage(`${failure} Continuing with normal human review; no map will be applied.`);
        return;
      }
      setMapState(mapPayload.map);
      setMapLookupFailed(false);
      setMessage(mapPayload.map.status === "LOADED"
        ? `${mapPayload.map.scope ?? "EXACT"} CARD MAP · ${mapPayload.map.name ?? "Card map"} · revision ${mapPayload.map.revision?.version} loaded.`
        : "No applicable CARD MAP exists. Normal human review will apply; nothing will be guessed.");
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Speedster card could not be created.";
      setMessage(failure);
    } finally {
      setWorking(false);
    }
  };

  const initializeReview = useCallback(async () => {
    if (!session?.token || !draft) throw new Error("Speedster detector state cannot initialize without its draft.");
    const startedAtMs = Date.now();
    setInitializeFailed(false);
    setMessage("SAM 3 is scanning the server-owned Front and Back card views.");
    const initializeResponse = await fetch(
      `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/review-action`,
      {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: { type: "INITIALIZE" } }),
      },
    );
    const initialized = (await initializeResponse.json().catch(() => ({}))) as {
      reviewedDefects?: SpeedsterReviewFinding[];
      message?: string;
    };
    if (!initializeResponse.ok || !initialized.reviewedDefects) {
      throw new Error(initialized.message ?? "Speedster detector state could not be initialized.");
    }
    setDefects(initialized.reviewedDefects);
    const endedAtMs = Date.now();
    recordInstrumentation({
      sessionId: draft.id,
      eventType: "SAM_MEMORY_COMPLETED",
      startedAtMs,
      endedAtMs,
      details: { findingCount: initialized.reviewedDefects.length, outcome: "SUCCEEDED" },
    });
    setMessage("SAM 3 scan complete. Review the measured card map.");
  }, [draft, recordInstrumentation, session?.token]);

  const saveCapture = async (bundle: SpeedsterCaptureBundle) => {
    if (!session?.token || !draft) return;
    const startedAtMs = Date.now();
    setWorking(true);
    setMessage("Saving the locked card geometry.");
    const compactSide = (side: SpeedsterCaptureBundle["front"]) => ({
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
    try {
      const response = await fetch(`/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}`, {
        method: "PATCH",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          workflowState: "CAPTURED",
          capture: {
            cornerShape: bundle.cornerShape,
            front: compactSide(bundle.front),
            back: compactSide(bundle.back),
          },
          ...(bundle.front.mapRegistration && bundle.back.mapRegistration ? {
            mapBinding: {
              revisionId: bundle.front.mapRegistration.mapRevisionId,
              filterPolicyVersion: mapState?.status === "LOADED"
                ? mapState.revision?.filterPolicyVersion ?? "speedster-map-filter-containment-v1"
                : "speedster-map-filter-containment-v1",
              registration: {
                front: bundle.front.mapRegistration,
                back: bundle.back.mapRegistration,
              },
            },
          } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Card geometry could not be saved.");
      setCapture(bundle);
      recordInstrumentation({
        sessionId: draft.id,
        eventType: "CAPTURE_SAVED",
        startedAtMs,
        endedAtMs: Date.now(),
        details: { outcome: "SUCCEEDED" },
      });
      await initializeReview();
    } catch (error) {
      setInitializeFailed(true);
      setMessage(error instanceof Error ? error.message : "Card geometry could not be saved.");
    } finally {
      setWorking(false);
    }
  };

  const runReviewRemeasurement = async (
    action: SpeedsterReviewMeasurementAction,
    pendingMessage: string,
    successMessage: string,
    fallbackErrorMessage: string,
  ): Promise<SpeedsterReviewRemeasurementResult> => {
    if (!session?.token || !draft || !capture || !defects || working) {
      return { applied: false, message: fallbackErrorMessage };
    }
    const startedAtMs = Date.now();
    setWorking(true);
    setMessage(pendingMessage);
    try {
      const wireAction = action.type === "TRACE_SAVE"
        ? (() => {
            const { finalTrace, ...trace } = action.trace;
            return {
              ...action,
              trace: {
                ...trace,
                traceWire: encodeSpeedsterTraceBitmapWireV1(
                  decodeSpeedsterTraceRleV1(finalTrace),
                  finalTrace.sha256,
                ),
              },
            };
          })()
        : action;
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/review-action`,
        {
          method: "POST",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ action: wireAction }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        reviewedDefects?: SpeedsterReviewFinding[];
        message?: string;
      };
      if (!response.ok || !payload.reviewedDefects) {
        throw new Error(payload.message ?? "Measured review changes could not be saved to the draft.");
      }
      setDefects(payload.reviewedDefects);
      const findingIds = action.type === "REMOVE" || action.type === "UNDO"
        ? action.defectIds
        : action.type === "CHANGE_TYPE"
          ? [action.defectId]
          : [action.findingId === null ? action.trace.id : action.findingId];
      recordInstrumentation({
        sessionId: draft.id,
        eventType: "REVIEW_ACTION_COMPLETED",
        startedAtMs,
        endedAtMs: Date.now(),
        details: { actionType: action.type, findingIds, outcome: "SUCCEEDED" },
      });
      setMessage(successMessage);
      return { applied: true };
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : fallbackErrorMessage;
      setMessage(failureMessage);
      return { applied: false, message: failureMessage };
    } finally {
      setWorking(false);
    }
  };

  const loadTrace = useCallback(async (findingId: string) => {
    if (!session?.token || !draft) return null;
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/review-action?findingId=${encodeURIComponent(findingId)}`,
        {
          method: "GET",
          headers: buildAdminHeaders(session.token),
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { traceWire?: unknown };
      if (!response.ok || !payload.traceWire) return null;
      return encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(payload.traceWire));
    } catch {
      return null;
    }
  }, [draft, session?.token]);

  const traceProposal = async (input: SpeedsterTraceProposalInput): Promise<Uint8Array | null> => {
    if (!session?.token || !draft) return null;
    const currentTraceWire = isNonEmptySpeedsterTrace(input.visibleTrace)
      ? (() => {
          const rle = encodeSpeedsterTraceRleV1(input.visibleTrace);
          return encodeSpeedsterTraceBitmapWireV1(input.visibleTrace, rle.sha256);
        })()
      : null;
    const proposal = await speedsterImageService.traceProposal(session.token, {
      sessionId: draft.id,
      side: input.target.side,
      findingId: input.target.findingId,
      stroke: {
        canonicalPoints: input.canonicalPoints,
        strokeWidthPixels: input.strokeWidthPixels,
        strokeWidthMm: input.strokeWidthMm,
        cropTransformVersion: input.cropTransform.version,
      },
      currentTraceWire,
    });
    return decodeSpeedsterTraceBitmapWireV1(proposal.traceWire);
  };

  const saveTrace = async (input: SpeedsterInMemoryTraceSave): Promise<boolean | string> => {
    const finalTrace = encodeSpeedsterTraceRleV1(input.trace);
    const traceProvenance = buildSpeedsterTraceProvenanceRevision({
      sourceViewId: input.target.sourceViewId,
      cropTransform: input.cropTransform,
      highlighterStrokes: input.highlighterStrokes,
      priorTraceProvenance: input.priorTraceProvenance,
      finalTraceSha256: finalTrace.sha256,
    });
    const newFindingId = input.target.findingId
      ? null
      : `${input.target.side}:smart-${crypto.randomUUID()}`;
    const action: SpeedsterReviewMeasurementAction = input.target.findingId
      ? {
          type: "TRACE_SAVE",
          side: input.target.side,
          findingId: input.target.findingId,
          trace: { finalTrace, traceProvenance },
        }
      : {
          type: "TRACE_SAVE",
          side: input.target.side,
          findingId: null,
          trace: {
            id: newFindingId as string,
            defectType: "FAINT_COLOR_VARIATION",
            sourceViewId: input.target.sourceViewId,
            finalTrace,
            traceProvenance,
          },
        };
    const measurement = await runReviewRemeasurement(
      action,
      "Measuring the saved trace.",
      "Trace measured. Select its defect type if needed.",
      "Trace measurement failed. The visible trace remains editable.",
    );
    if (!measurement.applied) throw new Error(measurement.message);
    return newFindingId ?? true;
  };

  const completeGrade = async () => {
    if (!session?.token || !draft || !review || working) return;
    const startedAtMs = Date.now();
    setWorking(true);
    recordInstrumentation({
      sessionId: draft.id,
      eventType: "GRADE_COMPLETION_REQUESTED",
      startedAtMs,
      endedAtMs: startedAtMs,
    });
    setMessage("Completing the grade and adding its label to the print queue.");
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/complete-label`,
        {
          method: "POST",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as SpeedsterCompletion & { message?: string };
      if (!response.ok || !payload.label || !payload.publicReportSlug) {
        throw new Error(payload.message ?? "Speedster grade could not be completed.");
      }
      recordInstrumentation({
        sessionId: draft.id,
        eventType: "GRADE_COMPLETION_RESPONSE",
        startedAtMs,
        endedAtMs: Date.now(),
        details: { outcome: "SUCCEEDED" },
      });
      const postCycleStartedAt = Date.now();
      recordInstrumentation({
        sessionId: draft.id,
        eventType: "POST_CYCLE_WORK_STARTED",
        startedAtMs: postCycleStartedAt,
        endedAtMs: postCycleStartedAt,
        details: { postCycleWork: "PHOTOROOM" },
      });
      void fetch(
        `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(draft.id)}/presentation`,
        {
          method: "POST",
          headers: buildAdminHeaders(session.token),
          keepalive: true,
        },
      ).catch(() => undefined);
      setDefects(completeSpeedsterReview(defects ?? []));
      setCompletion(payload);
      setMessage("Grade complete. The public evidence report and label are ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speedster grade could not be completed.");
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) {
    return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  }
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>AI Grader V2 Speedster | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div><span>TEN KINGS · AI GRADER V2</span><h1>Speedster</h1><p>{working ? "Racing · " : ""}{message}</p></div>
          <nav>
            <Link href="/card-maps">Card Maps</Link>
            <Link href="/admin/ai-grader-v2/completed">Completed cards</Link>
            <Link href="/admin">Admin Home</Link>
          </nav>
        </header>

        {!draft ? (
          <SharedLabelEditor
            mode="SPEEDSTER"
            value={identity}
            onChange={updateIdentity}
            onSubmit={(event) => void createDraft(event)}
            onFirstInteraction={beginCycle}
            saving={working}
            certificateNumber="TKS-DRAFT"
          />
        ) : null}

        {draft && mapState && !capture ? (
          <section className={styles.statusPanel}>
            <span>{mapState.status === "LOADED" ? `${mapState.scope ?? "EXACT"} CARD MAP` : "NO CARD MAP · MANUAL"}</span>
            <h2>{mapState.status === "LOADED"
              ? mapState.name || `Loaded revision ${mapState.revision?.version}`
              : "Normal human review"}</h2>
            <p>{mapState.status === "LOADED"
              ? `r${mapState.revision?.version} · ${mapState.revision?.revisionHash.slice(0, 12)} · This selected map will register to the card's physical geometry.`
              : "No fuzzy, nearby, or fallback map will be guessed. Existing Speedster review remains unchanged."}</p>
          </section>
        ) : null}

        {capture && mapState ? (
          <SpeedsterAppliedMapBadge
            capture={capture}
            selectedRevisionId={mapState.status === "LOADED" ? mapState.revision?.revisionId ?? null : null}
            scope={mapState.status === "LOADED" ? mapState.scope ?? "EXACT" : null}
            name={mapState.status === "LOADED" ? mapState.name ?? "Card map" : null}
          />
        ) : null}

        {draft && !capture && mapState ? (
          <CaptureWorkspace
            token={session.token}
            sessionId={draft.id}
            cardProfile={draft.cardProfile}
            activeMapRevisionId={mapState.status === "LOADED" ? mapState.revision?.revisionId ?? null : null}
            activeMapScope={mapState.status === "LOADED" ? mapState.scope ?? "EXACT" : null}
            activeMapName={mapState.status === "LOADED" ? mapState.name ?? "Card map" : null}
            mapLookupFailed={mapLookupFailed}
            onReady={(bundle) => void saveCapture(bundle)}
            onInstrumentationEvent={recordCaptureInstrumentation}
          />
        ) : null}

        {capture && defects === null ? (
          <section className={styles.statusPanel}>
            <span>03 · SAM 3</span>
            <h2>Scanning card views.</h2>
            <p>Every finding lands on one measured card map.</p>
            {initializeFailed ? (
              <button type="button" disabled={working} onClick={() => {
                if (working) return;
                setWorking(true);
                void initializeReview()
                  .catch((error) => {
                    setInitializeFailed(true);
                    setMessage(error instanceof Error ? error.message : "Speedster detector state could not be initialized.");
                  })
                  .finally(() => setWorking(false));
              }}>Retry server scan</button>
            ) : null}
          </section>
        ) : null}

        {capture && review && defects !== null && !completion ? (
          <ReviewWorkspace
            cornerShape={capture.cornerShape}
            masterImageUrls={reviewImageUrls ? {
              FRONT: reviewImageUrls.FRONT.master,
              BACK: reviewImageUrls.BACK.master,
            } : { FRONT: capture.front.inspectionUrl, BACK: capture.back.inspectionUrl }}
            inspectionFrames={{ FRONT: capture.front.inspectionFrame, BACK: capture.back.inspectionFrame }}
            sourceImageUrls={sourceImageUrls}
            defects={review.defects.filter((defect) => defect.reviewResult !== "REMOVED")}
            mapRegistrations={capture.front.mapRegistration && capture.back.mapRegistration
              && capture.front.mapRegistration.mapRevisionId === capture.back.mapRegistration.mapRevisionId
              ? { FRONT: capture.front.mapRegistration, BACK: capture.back.mapRegistration }
              : undefined}
            grade={review.grade}
            canUndo={lastRemovedDefectIds.length > 0}
            onRemoveDefects={async (defectIds) => {
              if (defectIds.length === 0 || defectIds.some((defectId) =>
                !defects.some((defect) => defect.id === defectId))) return false;
              const measurement = await runReviewRemeasurement(
                { type: "REMOVE", defectIds },
                "Removing the finding and recalculating its card measurements.",
                `${defectIds.length} finding${defectIds.length === 1 ? "" : "s"} removed from grading and saved as reviewer feedback.`,
                "Finding removal measurement failed.",
              );
              if (measurement.applied) setLastRemovedDefectIds([...defectIds]);
              return measurement.applied;
            }}
            onUndo={() => {
              if (lastRemovedDefectIds.length === 0) return;
              void runReviewRemeasurement(
                { type: "UNDO", defectIds: lastRemovedDefectIds },
                "Restoring the findings and recalculating their card measurements.",
                "Last removed finding set restored.",
                "Finding restore measurement failed.",
              ).then((measurement) => {
                if (measurement.applied) setLastRemovedDefectIds([]);
              });
            }}
            onDefectTypeChange={(defectId: string, defectType: SpeedsterDefectType) => {
              void runReviewRemeasurement(
                { type: "CHANGE_TYPE", defectId, defectType },
                "Changing the defect type and recalculating its card measurements.",
                "Defect type and grade math updated.",
                "Defect type measurement failed.",
              );
            }}
            onTraceProposal={traceProposal}
            onTraceSave={saveTrace}
            onTraceLoad={loadTrace}
            onImageError={retryReviewImagesOnce}
            onComplete={() => void completeGrade()}
          />
        ) : null}

        {completion ? (
          <section className={styles.completePanel}>
            <span>04 · COMPLETE</span>
            <h2>{completion.label.certificateNumber}</h2>
            <p>Label queue slot {completion.label.slot} · Grade {review?.grade.overall.displayGrade.toFixed(1)}</p>
            <p>
              Memory {completion.learning.ready ? "ready" : completion.learning.catchUpStatus.toLowerCase()}
              {" · "}{completion.learning.harvest.admittedLessons} lessons saved
              {" · "}{completion.learning.harvest.skippedLessons} skipped
              {" · cursor "}{completion.learning.bankCursor?.completionOrder ?? "none"}
            </p>
            <Link href={`/ai-grader-v2/reports/${completion.publicReportSlug}`}>
              Open public evidence report →
            </Link>
            <Link href="/admin/ai-grader-v2/completed">Open completed cards →</Link>
            <Link href="/admin/ai-grader-v2" onClick={(event) => {
              event.preventDefault();
              const atMs = Date.now();
              if (draft) {
                recordInstrumentation({
                  sessionId: draft.id,
                  eventType: "NEXT_CARD_SELECTED",
                  startedAtMs: atMs,
                  endedAtMs: atMs,
                });
              }
              window.location.assign("/admin/ai-grader-v2");
            }}>Next card →</Link>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
