import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import AppShell from "../../components/AppShell";
import {
  CaptureWorkspace,
  SpeedsterAppliedMapBadge,
  type SpeedsterCaptureBundle,
  type SpeedsterCaptureInstrumentationEvent,
  type SpeedsterCaptureSaveResult,
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
import { canonicalizeNewSpeedsterSessionIdentity } from "../../lib/ai-grader-v2/identity";
import {
  SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2,
  readSpeedsterCaptureRegistrationDraftForCommittedSession,
  removeSpeedsterCaptureRegistrationDraft,
  speedsterCaptureDraftMatchesCommittedSession,
  type SpeedsterCaptureDraftSideV2,
  type SpeedsterCaptureRegistrationDraft,
} from "../../lib/ai-grader-v2/capture-registration-draft";
import type {
  SpeedsterDefectType,
  SpeedsterReviewFinding,
} from "../../lib/ai-grader-v2/contracts";
import { runSpeedsterImageRequest, speedsterImageService } from "../../lib/ai-grader-v2/image-service";
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
type SpeedsterCommittedCaptureRecovery = Readonly<{
  session: SpeedsterDraft & {
    workflowState: "CAPTURED";
    capture: unknown;
    mapRevisionId?: string | null;
    mapRegistration?: unknown;
  };
  browserDraft: SpeedsterCaptureRegistrationDraft;
}>;
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
type SpeedsterMapAuthorityBlock = Readonly<{
  status: "LOOKUP_FAILED" | "INTEGRITY_ERROR" | "REGISTRATION_BLOCKED";
  message: string;
  attemptId?: string;
}>;
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
  registrationDecision?: "RETRY_FAILED_SIDE";
  mapAuthorityOperationId?: string;
  mapAuthorityDecisionId?: string;
  obsoleteMapBindingStatus?: "LOADED" | "NO_MAP" | "LOOKUP_FAILED" | "INTEGRITY_ERROR";
  obsoleteMapRevisionId?: string;
  obsoleteMapScope?: "EXACT" | "FAMILY";
  obsoleteMapName?: string;
  registrationErrorSource?: "PROVIDER_GATEWAY" | "PROVIDER" | "PROVIDER_NETWORK" | "TEN_KINGS_API" | "CLIENT_NETWORK" | "CLIENT_PROTOCOL" | "HUMAN_CORRECTION";
  registrationErrorCode?: string;
  registrationHttpStatus?: number;
  registrationRequestId?: string;
  registrationFailedSides?: readonly ("FRONT" | "BACK")[];
  registrationOperationId?: string;
  registrationDecisionId?: string;
  registrationFailures?: readonly Readonly<{
    side: "FRONT" | "BACK";
    source: "PROVIDER_GATEWAY" | "PROVIDER" | "PROVIDER_NETWORK" | "TEN_KINGS_API" | "CLIENT_NETWORK" | "CLIENT_PROTOCOL" | "HUMAN_CORRECTION";
    code: string;
    httpStatus: number | null;
    requestId?: string;
  }>[];
  findingCount?: number;
  filteredCount?: number;
  retryCount?: number;
  retrySide?: "FRONT" | "BACK";
  retryRequestId?: string;
  outcome?: "SUCCEEDED" | "FAILED";
  postCycleWork?: "PHOTOROOM" | "COMPS" | "NFC";
  errorCode?: string;
}>;

export default function AiGraderV2AdminPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const [identity, setIdentity] = useState<HumanGradeLabelEditorValue>(EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE);
  const [draft, setDraft] = useState<SpeedsterDraft | null>(null);
  const [mapState, setMapState] = useState<SpeedsterTrainMapState | null>(null);
  const [mapLookupFailed, setMapLookupFailed] = useState(false);
  const [mapAuthorityBlock, setMapAuthorityBlock] = useState<SpeedsterMapAuthorityBlock | null>(null);
  const [capture, setCapture] = useState<SpeedsterCaptureBundle | null>(null);
  const [defects, setDefects] = useState<SpeedsterReviewFinding[] | null>(null);
  const [lastRemovedDefectIds, setLastRemovedDefectIds] = useState<string[]>([]);
  const [completion, setCompletion] = useState<SpeedsterCompletion | null>(null);
  const [reviewImageUrls, setReviewImageUrls] = useState<SpeedsterReviewImageUrls | null>(null);
  const [initializeFailed, setInitializeFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Enter the exact information that belongs on the Ten Kings label.");
  const [captureDraftCleanupFailure, setCaptureDraftCleanupFailure] = useState<Readonly<{
    sessionId: string;
    message: string;
  }> | null>(null);
  const [committedCaptureRecovery, setCommittedCaptureRecovery] = useState<SpeedsterCommittedCaptureRecovery | null>(null);
  const [reconciledMapDisplay, setReconciledMapDisplay] = useState<Readonly<{
    revisionId: string | null;
    scope: "EXACT" | "FAMILY" | null;
    name: string | null;
  }> | null>(null);
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );
  const captureDraftId = typeof router.query.captureDraftId === "string"
    ? router.query.captureDraftId
    : null;
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
  const captureSaveInFlight = useRef(false);

  const beginCycle = useCallback(() => {
    if (cycleStartedAt.current === null) cycleStartedAt.current = Date.now();
    return cycleStartedAt.current;
  }, []);

  const resolveMapAuthority = useCallback(async (sessionId: string) => {
    if (!session?.token) throw new Error("Card Map authority cannot resolve without an authenticated admin session.");
    let response: Response;
    let payload: {
      map?: SpeedsterTrainMapState;
      authority?: {
        status?: "LOADED" | "NO_MAP" | "LOOKUP_FAILED" | "INTEGRITY_ERROR" | "REGISTRATION_BLOCKED";
        message?: string;
        attemptId?: string;
      };
      message?: string;
    };
    try {
      ({ response, payload } = await runSpeedsterImageRequest(
        "Card Map authority lookup",
        {},
        async (signal) => {
          const response = await fetch(
            `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(sessionId)}/map-authority`,
            {
              method: "POST",
              headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
              body: JSON.stringify({ action: "RESOLVE_LOOKUP" }),
              cache: "no-store",
              signal,
            },
          );
          const payload = await response.json().catch(() => ({}));
          return { response, payload };
        },
      ));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Card Map authority could not reach Ten Kings.";
      const message = `${detail} Capture remains blocked and all preserved work is unchanged; retry the exact lookup.`;
      setMapState({ status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null });
      setMapLookupFailed(true);
      setMapAuthorityBlock({ status: "LOOKUP_FAILED", message });
      setMessage(message);
      return false;
    }
    if (!response.ok || !payload.map) {
      const status = payload.authority?.status === "INTEGRITY_ERROR"
        ? "INTEGRITY_ERROR" as const
        : payload.authority?.status === "REGISTRATION_BLOCKED"
          ? "REGISTRATION_BLOCKED" as const
          : "LOOKUP_FAILED" as const;
      const message = payload.authority?.message
        ?? payload.message
        ?? "Card Map authority could not be resolved. Capture remains blocked.";
      setMapState({ status: "MISSING", scope: null, name: "", revision: null, revisions: [], editable: null });
      setMapLookupFailed(status === "LOOKUP_FAILED");
      setMapAuthorityBlock({ status, message, ...(payload.authority?.attemptId ? { attemptId: payload.authority.attemptId } : {}) });
      setMessage(message);
      return false;
    }
    setMapState(payload.map);
    setMapLookupFailed(false);
    setMapAuthorityBlock(null);
    setMessage(payload.authority?.status === "REGISTRATION_BLOCKED"
      ? "The durable Card Map registration blocker was reloaded. Resume the preserved work or start the same exact revision again; mapless continuation remains unavailable."
      : payload.map.status === "LOADED"
        ? `${payload.map.scope ?? "EXACT"} CARD MAP · ${payload.map.name ?? "Card map"} · revision ${payload.map.revision?.version} loaded.`
      : "No eligible Exact or Family CARD MAP exists. Human review is authorized by the durable NO_MAP resolution; nothing was guessed.");
    return true;
  }, [session?.token]);

  useEffect(() => {
    if (!router.isReady || !captureDraftId || !session?.token || !isAdmin || draft || capture) return;
    let cancelled = false;
    void (async () => {
      setWorking(true);
      setMessage("Loading the preserved capture session. Resume remains an explicit choice.");
      try {
        const sessionResponse = await fetch(
          `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(captureDraftId)}`,
          { headers: buildAdminHeaders(session.token!), cache: "no-store" },
        );
        const sessionPayload = await sessionResponse.json().catch(() => ({})) as {
          session?: SpeedsterDraft & {
            workflowState?: string;
            capture?: unknown;
            mapRevisionId?: string | null;
            mapRegistration?: unknown;
          };
          message?: string;
        };
        if (!sessionResponse.ok || !sessionPayload.session) {
          throw new Error(sessionPayload.message ?? "Preserved capture session could not be loaded.");
        }
        const committed = sessionPayload.session.workflowState === "CAPTURED";
        if (sessionPayload.session.workflowState !== "DRAFT" && !committed) {
          throw new Error("The preserved capture session is neither DRAFT nor a reconcilable CAPTURED session. No browser draft was deleted.");
        }
        let committedBrowserDraft: SpeedsterCaptureRegistrationDraft | null = null;
        if (committed) {
          committedBrowserDraft = readSpeedsterCaptureRegistrationDraftForCommittedSession(window.localStorage, {
            surface: "AI_GRADER",
            sessionId: captureDraftId,
            cardProfile: sessionPayload.session.cardProfile,
          });
          if (!committedBrowserDraft
            || !speedsterCaptureDraftMatchesCommittedSession(committedBrowserDraft, sessionPayload.session)) {
            throw new Error("The server reports CAPTURED, but its exact capture/map binding does not match the preserved browser draft. Nothing was cleared or resumed; inspect the conflicting evidence.");
          }
        }
        if (cancelled) return;
        setDraft(sessionPayload.session);
        let authorityResolved = false;
        if (committed) {
          const mapResponse = await fetch(
            `/api/admin/ai-grader-v2/maps/current?sessionId=${encodeURIComponent(captureDraftId)}&scope=EFFECTIVE`,
            { headers: buildAdminHeaders(session.token!), cache: "no-store" },
          );
          const mapPayload = await mapResponse.json().catch(() => ({})) as {
            map?: SpeedsterTrainMapState;
            message?: string;
          };
          if (!mapResponse.ok || !mapPayload.map) {
            throw new Error(mapPayload.message ?? "The committed Card Map binding could not be reconciled.");
          }
          setMapState(mapPayload.map);
          setMapLookupFailed(false);
          setMapAuthorityBlock(null);
          authorityResolved = true;
        } else {
          authorityResolved = await resolveMapAuthority(captureDraftId);
        }
        if (cancelled) return;
        if (committed && committedBrowserDraft) {
          setCommittedCaptureRecovery({
            session: sessionPayload.session as SpeedsterCommittedCaptureRecovery["session"],
            browserDraft: committedBrowserDraft,
          });
          setMessage("Server save is verified as committed and exactly matches the preserved Front/Back capture and map binding. Choose Continue to review or keep the browser draft; nothing was cleared automatically.");
        } else if (authorityResolved) {
          setMessage("Preserved capture session and durable Card Map authority loaded. Choose Resume or Discard in the capture workspace; nothing was applied automatically.");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Preserved capture session could not be loaded.");
      } finally {
        if (!cancelled) setWorking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [capture, captureDraftId, draft, isAdmin, resolveMapAuthority, router.isReady, session?.token]);

  const recordInstrumentation = useCallback((input: {
    eventId?: string;
    sessionId: string;
    eventType:
      | "FIRST_SPEEDSTER_INTERACTION"
      | "DRAFT_CREATED"
      | "PHOTOS_READY"
      | "GEOMETRY_PROPOSED"
      | "GEOMETRY_CONFIRMED"
      | "CENTERING_CONFIRMED"
      | "MAP_REGISTRATION_OPERATOR_DECISION"
      | "MAP_AUTHORITY_OPERATOR_DECISION"
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
    if (!session?.token) return false;
    return fetch(
      `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(input.sessionId)}/instrumentation`,
      {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          eventId: input.eventId ?? crypto.randomUUID(),
          eventType: input.eventType,
          clientStartedAt: new Date(input.startedAtMs).toISOString(),
          clientEndedAt: new Date(input.endedAtMs).toISOString(),
          ...(input.details ? { details: input.details } : {}),
        }),
        keepalive: true,
      },
    ).then((response) => response.ok).catch(() => false);
  }, [session?.token]);

  const recordCaptureInstrumentation = useCallback((event: SpeedsterCaptureInstrumentationEvent) => {
    if (!draft) return false;
    return recordInstrumentation({ sessionId: draft.id, ...event });
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
          layoutType: "",
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
      const printedIdentity = canonicalizeNewSpeedsterSessionIdentity(
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
              layoutType: identity.layoutType,
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
      void router.replace(
        { pathname: "/admin/ai-grader-v2", query: { captureDraftId: payload.session.id } },
        undefined,
        { shallow: true },
      );
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
      await resolveMapAuthority(payload.session.id);
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
    setMessage("SAM 3 is scanning FRONT, then BACK, using the server-owned card views.");
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
      detectorAttempts?: readonly {
        side: "FRONT" | "BACK";
        requestTraceId: string;
        attemptNumber: 1 | 2;
        retryReason: "RUNPOD_HTTP_502" | null;
      }[];
      message?: string;
    };
    if (!initializeResponse.ok || !initialized.reviewedDefects) {
      throw new Error(initialized.message ?? "Speedster detector state could not be initialized.");
    }
    setDefects(initialized.reviewedDefects);
    const endedAtMs = Date.now();
    const retryAttempt = initialized.detectorAttempts?.find(({ attemptNumber }) => attemptNumber === 2);
    recordInstrumentation({
      sessionId: draft.id,
      eventType: "SAM_MEMORY_COMPLETED",
      startedAtMs,
      endedAtMs,
      details: {
        findingCount: initialized.reviewedDefects.length,
        outcome: "SUCCEEDED",
        retryCount: retryAttempt ? 1 : 0,
        ...(retryAttempt ? {
          retrySide: retryAttempt.side,
          retryRequestId: retryAttempt.requestTraceId,
        } : {}),
      },
    });
    setMessage(retryAttempt
      ? `SAM 3 scan complete after one automatic RunPod HTTP 502 retry on ${retryAttempt.side} (request ID ${retryAttempt.requestTraceId}). Review the measured card map.`
      : "SAM 3 sequential FRONT and BACK scan complete. Review the measured card map.");
  }, [draft, recordInstrumentation, session?.token]);

  const continueCommittedCapture = useCallback(async () => {
    if (!committedCaptureRecovery || !session?.token || working) return;
    setWorking(true);
    setMessage("Loading signed review images for the already committed capture.");
    try {
      const urls = await fetchSpeedsterReviewImageUrls({
        token: session.token,
        sessionId: committedCaptureRecovery.session.id,
      });
      const toPreparedSide = (side: "FRONT" | "BACK") => {
        const preserved = side === "FRONT"
          ? committedCaptureRecovery.browserDraft.front
          : committedCaptureRecovery.browserDraft.back;
        const preservedColor = committedCaptureRecovery.browserDraft.version === SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION_V2
          ? preserved as SpeedsterCaptureDraftSideV2
          : null;
        if (!preserved.centering) throw new Error(`The preserved ${side} centering result is unavailable.`);
        return {
          side,
          originalStorageKey: preserved.originalStorageKey,
          sourceUrl: urls[side].views.ORIGINAL,
          sourceCorners: preserved.corners,
          rectifiedUrl: urls[side].master,
          rectifiedStorageKey: preserved.rectifiedStorageKey,
          inspectionUrl: urls[side].master,
          inspectionStorageKey: preserved.inspectionStorageKey,
          inspectionFrame: preserved.inspectionFrame,
          transform: preserved.transform,
          views: {
            NORMALIZED: urls[side].views.NORMALIZED,
            MICRO_DEFECT: urls[side].views.MICRO_DEFECT,
            DIRECTIONAL: urls[side].views.DIRECTIONAL,
          },
          viewStorageKeys: preserved.viewStorageKeys,
          centeringQuad: preserved.centering.innerQuad,
          centeringBorders: preserved.centering.borders,
          ...(preservedColor ? {
            colorGeometryEvidence: [
              {
                side,
                sourceImageStorageKey: preserved.originalStorageKey,
                mode: "PHYSICAL_OUTER" as const,
                matColor: preservedColor.matColor,
                result: preservedColor.physicalColorGeometry,
                serverReceipt: preservedColor.physicalColorGeometryReceipt,
                confirmedQuad: preserved.corners,
              },
              {
                side,
                sourceImageStorageKey: preserved.originalStorageKey,
                mode: "PRINTED_FRAME" as const,
                matColor: preservedColor.matColor,
                result: preservedColor.printedColorGeometry,
                serverReceipt: preservedColor.printedColorGeometryReceipt,
                confirmedQuad: preserved.centering.innerQuad,
              },
            ] as const,
          } : {}),
          ...(preserved.mapRegistration ? { mapRegistration: preserved.mapRegistration } : {}),
        };
      };
      const bundle: SpeedsterCaptureBundle = {
        sessionId: committedCaptureRecovery.session.id,
        cardProfile: committedCaptureRecovery.session.cardProfile,
        cornerShape: committedCaptureRecovery.browserDraft.cornerShape,
        front: toPreparedSide("FRONT"),
        back: toPreparedSide("BACK"),
      };
      setReviewImageUrls(urls);
      setCapture(bundle);
      setReconciledMapDisplay({
        revisionId: committedCaptureRecovery.session.mapRevisionId ?? null,
        scope: committedCaptureRecovery.browserDraft.activeMapScope,
        name: committedCaptureRecovery.browserDraft.activeMapName,
      });
      try {
        removeSpeedsterCaptureRegistrationDraft(window.localStorage, committedCaptureRecovery.session.id);
      } catch {
        const failure = "Committed capture resumed, but the obsolete browser draft could not be cleared. Use the visible Retry cleanup action.";
        setCaptureDraftCleanupFailure({ sessionId: committedCaptureRecovery.session.id, message: failure });
      }
      setCommittedCaptureRecovery(null);
      void router.replace("/admin/ai-grader-v2", undefined, { shallow: true });
      try {
        await initializeReview();
      } catch (error) {
        setInitializeFailed(true);
        setMessage(error instanceof Error ? error.message : "Speedster detector state could not be initialized.");
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Committed capture could not continue."} The preserved browser draft remains intact.`);
    } finally {
      setWorking(false);
    }
  }, [committedCaptureRecovery, initializeReview, router, session?.token, working]);

  const saveCapture = async (
    bundle: SpeedsterCaptureBundle,
    clearPreservedBrowserDraft: () => boolean = () => true,
  ): Promise<SpeedsterCaptureSaveResult> => {
    if (!session?.token || !draft) return { saved: false, message: "Card geometry cannot save without its active draft." };
    if (captureSaveInFlight.current) return { saved: false, message: "Card geometry save is already in progress." };
    captureSaveInFlight.current = true;
    const startedAtMs = Date.now();
    setWorking(true);
    setMessage("Saving the locked card geometry.");
    if (!bundle.front.colorGeometryEvidence || !bundle.back.colorGeometryEvidence) {
      captureSaveInFlight.current = false;
      setWorking(false);
      return {
        saved: false,
        message: "Color Geometry evidence is incomplete. Existing photos and confirmed geometry remain preserved; explicitly recover the missing side and mode before save.",
      };
    }
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
      colorGeometryEvidence: side.colorGeometryEvidence!,
    });
    try {
      const frontRegistration = bundle.front.mapRegistration;
      const backRegistration = bundle.back.mapRegistration;
      const submittedRegistration = Boolean(frontRegistration && backRegistration);
      const exactFilterPolicyVersion = mapState?.status === "LOADED"
        ? mapState.revision?.filterPolicyVersion
        : null;
      if (submittedRegistration && !exactFilterPolicyVersion) {
        throw new Error("Card geometry registration cannot save without the immutable loaded revision filter policy.");
      }
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
          ...(submittedRegistration ? {
            mapBinding: {
              revisionId: frontRegistration!.mapRevisionId,
              filterPolicyVersion: exactFilterPolicyVersion,
              registration: {
                front: frontRegistration!,
                back: backRegistration!,
              },
            },
          } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        colorGeometryReceiptExpired?: {
          side?: unknown;
          mode?: unknown;
        };
      };
      if (!response.ok) {
        const expired = payload.colorGeometryReceiptExpired;
        if ((expired?.side === "FRONT" || expired?.side === "BACK")
          && (expired.mode === "PHYSICAL_OUTER" || expired.mode === "PRINTED_FRAME")) {
          return {
            saved: false,
            message: payload.message ?? "Color Geometry receipt expired.",
            colorGeometryReceiptExpired: {
              side: expired.side,
              mode: expired.mode,
            },
          };
        }
        throw new Error(payload.message ?? "Card geometry could not be saved.");
      }
      clearPreservedBrowserDraft();
      void router.replace("/admin/ai-grader-v2", undefined, { shallow: true });
      setCapture(bundle);
      recordInstrumentation({
        sessionId: draft.id,
        eventType: "CAPTURE_SAVED",
        startedAtMs,
        endedAtMs: Date.now(),
        details: { outcome: "SUCCEEDED" },
      });
      try {
        await initializeReview();
      } catch (error) {
        setInitializeFailed(true);
        setMessage(error instanceof Error ? error.message : "Speedster detector state could not be initialized.");
      }
      return { saved: true };
    } catch (error) {
      const failure = error instanceof Error ? error.message : "Card geometry could not be saved.";
      setMessage(failure);
      return { saved: false, message: failure };
    } finally {
      captureSaveInFlight.current = false;
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

        {captureDraftCleanupFailure ? (
          <section className={styles.statusPanel} role="alert">
            <span>BROWSER DRAFT CLEANUP REQUIRED</span>
            <p>{captureDraftCleanupFailure.message}</p>
            <button type="button" onClick={() => {
              try {
                removeSpeedsterCaptureRegistrationDraft(window.localStorage, captureDraftCleanupFailure.sessionId);
                setCaptureDraftCleanupFailure(null);
                setMessage("The obsolete browser capture draft was cleared explicitly.");
              } catch {
                setMessage("The obsolete browser capture draft still could not be cleared. Server-saved work is intact; retry this cleanup action.");
              }
            }}>RETRY CLEARING BROWSER DRAFT</button>
          </section>
        ) : null}

        {committedCaptureRecovery ? (
          <section className={styles.statusPanel} role="alert">
            <span>CAPTURE SAVE COMMITTED · EXPLICIT RECONCILIATION</span>
            <h2>The server Front + Back capture exactly matches the preserved browser draft.</h2>
            <p>The prior response was not received. No recapture or server overwrite is needed, and the browser draft has not been cleared.</p>
            <button type="button" disabled={working} onClick={() => void continueCommittedCapture()}>
              {working ? "LOADING COMMITTED CAPTURE…" : "CONTINUE TO REVIEW"}
            </button>
            <button type="button" disabled={working} onClick={() => {
              setMessage("Committed capture remains verified. The preserved browser draft was kept by explicit operator choice.");
            }}>KEEP BROWSER DRAFT FOR NOW</button>
          </section>
        ) : null}

        {captureDraftId && !draft && !committedCaptureRecovery ? (
          <section className={styles.statusPanel} role="alert">
            <span>CAPTURE RECOVERY BLOCKED</span>
            <h2>The preserved capture did not reconcile with committed server evidence.</h2>
            <p>{message} The browser draft remains intact. Fresh capture is unavailable on this recovery URL.</p>
            <Link href="/admin/ai-grader-v2">LEAVE RECOVERY AND START FROM THE BASE ROUTE</Link>
          </section>
        ) : null}

        {!draft && !captureDraftId ? (
          <SharedLabelEditor
            mode="SPEEDSTER"
            requirePokemonLayoutType
            value={identity}
            onChange={updateIdentity}
            onSubmit={(event) => void createDraft(event)}
            onFirstInteraction={beginCycle}
            saving={working}
            certificateNumber="TKS-DRAFT"
          />
        ) : null}

        {draft && mapState && !capture ? (
          <section className={styles.statusPanel} role={mapAuthorityBlock ? "alert" : undefined}>
            <span>{mapAuthorityBlock?.status === "INTEGRITY_ERROR" ? "CARD MAP INTEGRITY BLOCKED"
              : mapAuthorityBlock ? "CARD MAP LOOKUP BLOCKED"
                : mapState.status === "LOADED" ? `${mapState.scope ?? "EXACT"} CARD MAP`
                  : "NO CARD MAP · MANUAL"}</span>
            <h2>{mapState.status === "LOADED"
              ? mapState.name || `Loaded revision ${mapState.revision?.version}`
              : mapAuthorityBlock ? "Capture is stopped until authority resolves"
                : mapState.status === "INTEGRITY_ERROR" ? "Preserved draft is integrity-bound"
                  : "Normal human review"}</h2>
            <p>{mapAuthorityBlock
              ? `${mapAuthorityBlock.message} No photos, geometry, or mapless capture can begin while this blocker is active.`
              : mapState.status === "LOADED"
              ? `r${mapState.revision?.version} · ${mapState.revision?.revisionHash.slice(0, 12)} · This selected map will register to the card's physical geometry.`
              : mapState.status === "INTEGRITY_ERROR"
                  ? "The invalid map was not applied. The preserved browser draft remains auditable and requires an explicit Resume or Discard choice."
                  : "The authoritative lookup recorded NO_MAP. No fuzzy, nearby, or fallback map was guessed."}</p>
            {mapAuthorityBlock ? (
              <button type="button" disabled={working} onClick={() => {
                setWorking(true);
                void resolveMapAuthority(draft.id).finally(() => setWorking(false));
              }}>
                {working ? "RETRYING EXACT CARD MAP AUTHORITY…" : "RETRY CARD MAP AUTHORITY"}
              </button>
            ) : null}
          </section>
        ) : null}

        {capture && mapState ? (
          <SpeedsterAppliedMapBadge
            capture={capture}
            selectedRevisionId={reconciledMapDisplay?.revisionId
              ?? (mapState.status === "LOADED" ? mapState.revision?.revisionId ?? null : null)}
            scope={reconciledMapDisplay?.scope
              ?? (mapState.status === "LOADED" ? mapState.scope ?? "EXACT" : null)}
            name={reconciledMapDisplay?.name
              ?? (mapState.status === "LOADED" ? mapState.name ?? "Card map" : null)}
          />
        ) : null}

        {draft && !capture && mapState && !mapAuthorityBlock && !committedCaptureRecovery ? (
          <CaptureWorkspace
            token={session.token}
            sessionId={draft.id}
            cardProfile={draft.cardProfile}
            draftSurface="AI_GRADER"
            activeMapRevisionId={mapState.status === "LOADED" ? mapState.revision?.revisionId ?? null : null}
            activeMapRevisionHash={mapState.status === "LOADED" ? mapState.revision?.revisionHash ?? null : null}
            activeMapScope={mapState.status === "LOADED" ? mapState.scope ?? "EXACT" : null}
            activeMapName={mapState.status === "LOADED" ? mapState.name ?? "Card map" : null}
            mapBindingStatus={mapState.status === "LOADED" ? "LOADED"
              : mapState.status === "INTEGRITY_ERROR" ? "INTEGRITY_ERROR"
                : mapLookupFailed ? "LOOKUP_FAILED" : "NO_MAP"}
            mapLookupFailed={mapLookupFailed}
            onReady={saveCapture}
            onDraftCleanupFailure={(failure) => {
              setCaptureDraftCleanupFailure({ sessionId: draft.id, message: failure });
              setMessage(failure);
            }}
            onInstrumentationEvent={recordCaptureInstrumentation}
          />
        ) : null}

        {capture && defects === null ? (
          <section className={styles.statusPanel}>
            <span>03 · SAM 3</span>
            <h2>Scanning FRONT, then BACK.</h2>
            <p>A successful side is retained while the next side runs. Every finding lands on one measured card map.</p>
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
