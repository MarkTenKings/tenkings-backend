"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import type { SpeedsterCardProfile, SpeedsterCardSide, SpeedsterQuad } from "../../lib/ai-grader-v2/contracts";
import type { SpeedsterCenteringBorders } from "../../lib/ai-grader-v2/scoring";
import type { SpeedsterInspectionFrame } from "../../lib/ai-grader-v2/inspection-frame";
import type {
  SpeedsterMapRegistration,
  SpeedsterMapRegistrationFailure,
  SpeedsterMapScope,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import { sanitizeSpeedsterUnitQuad } from "../../lib/ai-grader-v2/geometry";
import {
  fetchSpeedsterPreparedRectifiedImageUrl,
  SPEEDSTER_PREPARED_IMAGE_REFRESH_INTERVAL_MS,
} from "../../lib/ai-grader-v2/prepared-image-urls";
import { fetchSpeedsterOriginalImageUrl } from "../../lib/ai-grader-v2/original-image-urls";
import {
  SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_CURRENT_VERSION,
  SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION,
  readSpeedsterCaptureRegistrationDraft,
  readSpeedsterCaptureRegistrationDraftForCommittedSession,
  removeSpeedsterCaptureRegistrationDraft,
  speedsterCaptureDraftExpiredRegistrationSides,
  speedsterCaptureRegistrationDraftStorageKey,
  writeSpeedsterCaptureRegistrationDraft,
  type SpeedsterCaptureDraftCorrectedAnchor,
  type SpeedsterCaptureDraftMapBindingStatus,
  type SpeedsterCaptureDraftSide,
  type SpeedsterCaptureDraftSideV2,
  type SpeedsterCaptureDraftSurface,
  type SpeedsterCaptureRegistrationDraft,
} from "../../lib/ai-grader-v2/capture-registration-draft";
import {
  speedsterColorCenteringDraft,
  speedsterColorPhysicalDraftState,
  type SpeedsterColorGeometryCaptureEvidence,
  type SpeedsterColorGeometryProposal,
  type SpeedsterMatColor,
  type SpeedsterPhysicalGeometryPlacement,
} from "../../lib/ai-grader-v2/color-geometry";
import {
  runSpeedsterImageRequest,
  speedsterImageService,
  SpeedsterMapRegistrationError,
  SpeedsterMapRegistrationRequestError,
  speedsterMapRegistrationAuditWarningFor,
  type SpeedsterMapRegistrationAuditWarning,
  type SpeedsterMapRegistrationRequestFailure,
  type SpeedsterMapRegistrationOrchestration,
  planSpeedsterPreparedOutputs,
  uploadSpeedsterOriginal,
} from "../../lib/ai-grader-v2/image-service";
import { CenteringAssist, type CenteringAssistResult } from "./CenteringAssist";
import {
  GeometryAssist,
  logSpeedsterGeometryAttempt,
  type SpeedsterCornerShape,
  type SpeedsterGeometryAttemptDiagnostic,
} from "./GeometryAssist";
import PhotoUploadPair, { type SpeedsterOriginalPhoto } from "./PhotoUploadPair";
import { MapRegistrationRescue } from "./MapRegistrationRescue";
import { ColorGeometryScoreboard } from "./ColorGeometryScoreboard";
import type { SpeedsterColorGeometryScore } from "../../lib/ai-grader-v2/color-geometry-score";
import styles from "./CaptureWorkspace.module.css";

type Stage = "PHOTOS" | "FRONT_GEOMETRY" | "BACK_GEOMETRY" | "MAP_REGISTRATION_INTERRUPTED" | "MAP_REGISTRATION_RESCUE" | "FRONT_CENTERING" | "BACK_CENTERING" | "READY";

const captureDraftBindingKey = (input: Readonly<{
  surface: SpeedsterCaptureDraftSurface;
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  mapBindingStatus: SpeedsterCaptureDraftMapBindingStatus;
  activeMapRevisionId: string | null;
  activeMapScope: SpeedsterMapScope | null;
}>) => JSON.stringify([
  input.surface,
  input.sessionId,
  input.cardProfile,
  input.mapBindingStatus,
  input.activeMapRevisionId,
  input.activeMapScope,
]);

const captureDraftBindingLabel = (draft: SpeedsterCaptureRegistrationDraft) => {
  if (draft.mapBindingStatus === "LOADED") {
    return `${draft.activeMapScope} · ${draft.activeMapName ?? "Card Map"}`;
  }
  if (draft.mapBindingStatus === "LOOKUP_FAILED") return "Card Map lookup failed · no map authority applied";
  if (draft.mapBindingStatus === "INTEGRITY_ERROR") return "Card Map integrity error · no map authority applied";
  if (draft.mapBindingStatus === "HUMAN_REVIEW_WITHOUT_MAP") return "Explicit human review · failed Card Map not applied";
  return "No applicable Card Map · manual geometry";
};

export type SpeedsterPreparedSide = {
  side: SpeedsterCardSide;
  originalStorageKey: string;
  sourceUrl: string;
  sourceCorners: SpeedsterQuad;
  rectifiedUrl: string;
  rectifiedStorageKey: string;
  inspectionUrl: string;
  inspectionStorageKey: string;
  inspectionFrame: SpeedsterInspectionFrame;
  transform: readonly number[];
  views: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
  viewStorageKeys: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
  centeringQuad: SpeedsterQuad;
  centeringBorders: SpeedsterCenteringBorders;
  mapRegistration?: SpeedsterMapRegistration;
  colorGeometryEvidence?: readonly [
    SpeedsterColorGeometryCaptureEvidence,
    SpeedsterColorGeometryCaptureEvidence,
  ];
};

export type SpeedsterCaptureBundle = {
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  cornerShape: SpeedsterCornerShape;
  front: SpeedsterPreparedSide;
  back: SpeedsterPreparedSide;
};

export function SpeedsterAppliedMapBadge({
  capture,
  selectedRevisionId,
  scope,
  name,
}: Readonly<{
  capture: SpeedsterCaptureBundle;
  selectedRevisionId: string | null;
  scope: SpeedsterMapScope | null;
  name: string | null;
}>) {
  const frontRevisionId = capture.front.mapRegistration?.mapRevisionId;
  const backRevisionId = capture.back.mapRegistration?.mapRevisionId;
  const applied = Boolean(
    selectedRevisionId
    && frontRevisionId === selectedRevisionId
    && backRevisionId === selectedRevisionId,
  );
  return (
    <p className={applied ? styles.appliedMap : styles.mapFallback} aria-label="Applied Card Map">
      {applied ? `${scope ?? "EXACT"} · ${name ?? "Card map"}` : "NO CARD MAP · MANUAL"}
    </p>
  );
}

type CaptureWorkspaceProps = {
  token: string;
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  draftSurface?: SpeedsterCaptureDraftSurface;
  activeMapRevisionId?: string | null;
  activeMapRevisionHash?: string | null;
  activeMapScope?: SpeedsterMapScope | null;
  activeMapName?: string | null;
  mapBindingStatus?: SpeedsterCaptureDraftMapBindingStatus;
  mapLookupFailed?: boolean;
  onReady: (
    bundle: SpeedsterCaptureBundle,
    clearPreservedBrowserDraft: () => boolean,
  ) => Promise<SpeedsterCaptureSaveResult> | SpeedsterCaptureSaveResult;
  onDraftCleanupFailure?: (message: string) => void;
  onInstrumentationEvent: (event: SpeedsterCaptureInstrumentationEvent) => void | boolean | Promise<void | boolean>;
  imageRequestTimeoutMs?: number;
  decisionAuditConfirmationTimeoutMs?: number;
};

export type SpeedsterCaptureSaveResult = Readonly<{
  saved: boolean;
  message?: string;
  colorGeometryReceiptExpired?: Readonly<{
    side: SpeedsterCardSide;
    mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
  }>;
}>;

export type SpeedsterCaptureInstrumentationEvent = Readonly<{
  eventId?: string;
  eventType: "PHOTOS_READY" | "GEOMETRY_PROPOSED" | "GEOMETRY_CONFIRMED" | "CENTERING_CONFIRMED" | "MAP_REGISTRATION_OPERATOR_DECISION" | "MAP_AUTHORITY_OPERATOR_DECISION";
  startedAtMs: number;
  endedAtMs: number;
  details?: Readonly<{
    side?: SpeedsterCardSide;
    automaticGeometryCount?: number;
    photoSource?: "IPHONE" | "LOCAL" | "MIXED";
    mapAppliedScope?: SpeedsterMapScope | "NONE";
    mapName?: string;
    mapRevisionId?: string;
    mapFailureCode?: "LOOKUP_FAILED" | "REGISTRATION_FAILED";
    registrationDecision?: "RETRY_FAILED_SIDE";
    mapAuthorityOperationId?: string;
    mapAuthorityDecisionId?: string;
    obsoleteMapBindingStatus?: SpeedsterCaptureDraftMapBindingStatus;
    obsoleteMapRevisionId?: string;
    obsoleteMapScope?: SpeedsterMapScope;
    obsoleteMapName?: string;
    registrationErrorSource?: SpeedsterMapRegistrationRequestFailure["source"] | "HUMAN_CORRECTION";
    registrationErrorCode?: string;
    registrationHttpStatus?: number;
    registrationRequestId?: string;
    registrationFailedSides?: readonly SpeedsterCardSide[];
    registrationOperationId?: string;
    registrationDecisionId?: string;
    registrationFailures?: readonly Readonly<{
      side: SpeedsterCardSide;
      source: SpeedsterMapRegistrationRequestFailure["source"] | "HUMAN_CORRECTION";
      code: string;
      httpStatus: number | null;
      requestId?: string;
    }>[];
  }>;
}>;

type SideState = {
  originalStorageKey: string;
  sourceUrl: string;
  corners: SpeedsterQuad | null;
  automaticGeometry: boolean;
  geometryPlacement: SpeedsterPhysicalGeometryPlacement | "HUMAN_EDITED";
  geometryDiagnostic: SpeedsterGeometryAttemptDiagnostic;
  rectifiedUrl?: string;
  rectifiedImageRevision?: number;
  rectifiedStorageKey?: string;
  inspectionUrl?: string;
  inspectionStorageKey?: string;
  inspectionFrame?: SpeedsterInspectionFrame;
  transform?: readonly number[];
  views?: SpeedsterPreparedSide["views"];
  viewStorageKeys?: SpeedsterPreparedSide["viewStorageKeys"];
  proposedCentering?: SpeedsterQuad | null;
  detectedBorders?: readonly ("top" | "right" | "bottom" | "left")[];
  centering?: CenteringAssistResult;
  mapRegistration?: SpeedsterMapRegistration;
  matColor: SpeedsterMatColor;
  physicalColorGeometry: SpeedsterColorGeometryProposal;
  physicalColorGeometryReceipt: string;
  printedColorGeometry?: SpeedsterColorGeometryProposal;
  printedColorGeometryReceipt?: string;
};

type RegistrationRescueState = Readonly<{
  failures: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistrationFailure>>;
  failureRequestIds: Partial<Record<SpeedsterCardSide, string>>;
  provisional: Partial<Record<SpeedsterCardSide, SpeedsterMapRegistration>>;
  attemptIds: Partial<Record<SpeedsterCardSide, string>>;
  operationId: string;
  attemptNumbers: Partial<Record<SpeedsterCardSide, number>>;
  continueDecisionId: string;
}>;

type RegistrationInterruption = Readonly<{
  message: string;
  failure: SpeedsterMapRegistrationRequestFailure;
}>;

type ColorGeometryRecoveryTarget = Readonly<{
  side: SpeedsterCardSide;
  mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
}>;

type RegistrationInterruptionState = Readonly<{
  interruptions: Partial<Record<SpeedsterCardSide, RegistrationInterruption>>;
  failures: RegistrationRescueState["failures"];
  failureRequestIds: RegistrationRescueState["failureRequestIds"];
  provisional: RegistrationRescueState["provisional"];
  operationId: string;
  attemptNumbers: Partial<Record<SpeedsterCardSide, number>>;
  decisionIds: Readonly<{
    continue: string;
    abandonObsoleteMap: string;
    retry: Partial<Record<SpeedsterCardSide, string>>;
  }>;
}>;

function registrationAuditWarningFrom(value: unknown): SpeedsterMapRegistrationAuditWarning | null {
  if (value instanceof SpeedsterMapRegistrationError || value instanceof SpeedsterMapRegistrationRequestError) {
    return value.auditWarning;
  }
  return speedsterMapRegistrationAuditWarningFor(value);
}

type PreparedImageRefreshState = Readonly<{
  refreshing: boolean;
  error: string | null;
}>;

const EMPTY_PREPARED_IMAGE_REFRESH: Readonly<Record<SpeedsterCardSide, PreparedImageRefreshState>> = {
  FRONT: { refreshing: false, error: null },
  BACK: { refreshing: false, error: null },
};

// Confirmation only: operator work proceeds immediately; two seconds bounds silent audit uncertainty.
export const SPEEDSTER_REGISTRATION_DECISION_AUDIT_CONFIRMATION_TIMEOUT_MS = 2_000;

export async function settleSpeedsterRegistrationDecisionAuditConfirmation(
  reporterResult: void | boolean | Promise<void | boolean>,
  waitMs = SPEEDSTER_REGISTRATION_DECISION_AUDIT_CONFIRMATION_TIMEOUT_MS,
): Promise<"CONFIRMED" | "WRITE_FAILED" | "TIMED_OUT"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tracked = Promise.resolve(reporterResult).then(
    (saved) => saved === false ? "WRITE_FAILED" as const : "CONFIRMED" as const,
    () => "WRITE_FAILED" as const,
  );
  const deadline = new Promise<"TIMED_OUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMED_OUT"), Math.max(0, waitMs));
  });
  const result = await Promise.race([tracked, deadline]);
  if (timer) clearTimeout(timer);
  return result;
}

export function isCurrentSpeedsterRegistrationDecisionAudit(input: Readonly<{
  currentSessionId: string;
  currentOperationId: string | null;
  originatingSessionId: string;
  originatingOperationId: string;
}>) {
  return input.currentSessionId === input.originatingSessionId
    && input.currentOperationId === input.originatingOperationId;
}

type RegistrationFailureEvidence = NonNullable<
  NonNullable<SpeedsterCaptureInstrumentationEvent["details"]>["registrationFailures"]
>[number];

type AuditReconciliationNotice = Readonly<{
  noticeId: string;
  message: string;
}>;

function registrationFailureEvidence(
  interruptions: RegistrationInterruptionState["interruptions"],
  failures: RegistrationRescueState["failures"],
  failureRequestIds: RegistrationRescueState["failureRequestIds"],
  onlySides: readonly SpeedsterCardSide[] = ["FRONT", "BACK"],
): readonly RegistrationFailureEvidence[] {
  const evidence: RegistrationFailureEvidence[] = [];
  for (const side of onlySides) {
    const interruption = interruptions[side];
    if (interruption) {
      evidence.push({
        side,
        source: interruption.failure.source,
        code: interruption.failure.code,
        httpStatus: interruption.failure.httpStatus,
        ...(interruption.failure.requestId ? { requestId: interruption.failure.requestId } : {}),
      });
      continue;
    }
    const failure = failures[side];
    if (failure) evidence.push({
      side,
      source: "HUMAN_CORRECTION",
      code: failure.failureCode,
      httpStatus: 422,
      ...(failureRequestIds[side] ? { requestId: failureRequestIds[side] } : {}),
    });
  }
  return evidence;
}

function withMapRegistration(value: SideState, registration: SpeedsterMapRegistration): SideState {
  const mapCenteringDraft: SpeedsterQuad | null = registration.projectedDesignBoundary.kind === "QUAD"
    ? registration.projectedDesignBoundary.points
    : null;
  const colorCanSeedCentering = value.printedColorGeometry?.outcome === "ACCEPTED";
  const proposedCentering = colorCanSeedCentering && value.proposedCentering
    ? value.proposedCentering
    : mapCenteringDraft;
  return {
    ...value,
    // Color is only a CenteringAssist draft. Registration remains independently
    // server-derived and still owns projected zones/filter policy.
    proposedCentering,
    detectedBorders: proposedCentering && (colorCanSeedCentering || registration.projectedDesignBoundary.kind === "QUAD")
      ? ["top", "right", "bottom", "left"]
      : [],
    mapRegistration: registration,
  };
}

function durableCaptureSide(value: SideState): SpeedsterCaptureDraftSideV2 | null {
  if (!value.corners || !value.rectifiedStorageKey || !value.inspectionStorageKey || !value.inspectionFrame
    || !value.transform || !value.viewStorageKeys || value.proposedCentering === undefined || !value.detectedBorders
    || !value.printedColorGeometry || !value.printedColorGeometryReceipt) return null;
  return {
    originalStorageKey: value.originalStorageKey,
    corners: value.corners,
    automaticGeometry: value.automaticGeometry,
    geometryDiagnostic: value.geometryDiagnostic,
    rectifiedStorageKey: value.rectifiedStorageKey,
    inspectionStorageKey: value.inspectionStorageKey,
    inspectionFrame: value.inspectionFrame,
    transform: value.transform,
    viewStorageKeys: value.viewStorageKeys,
    proposedCentering: value.proposedCentering,
    detectedBorders: value.detectedBorders,
    matColor: value.matColor,
    physicalColorGeometry: value.physicalColorGeometry,
    physicalColorGeometryReceipt: value.physicalColorGeometryReceipt,
    printedColorGeometry: value.printedColorGeometry,
    printedColorGeometryReceipt: value.printedColorGeometryReceipt,
    ...(value.centering ? { centering: value.centering } : {}),
    ...(value.mapRegistration ? { mapRegistration: value.mapRegistration } : {}),
  };
}

function restoredCaptureSide(value: SpeedsterCaptureDraftSideV2, rectifiedUrl: string): SideState {
  return {
    ...value,
    sourceUrl: "",
    geometryPlacement: value.automaticGeometry ? "AUTO_ACCEPTED" : "HUMAN_EDITED",
    rectifiedUrl,
    rectifiedImageRevision: 0,
    inspectionUrl: "",
    views: { NORMALIZED: "", MICRO_DEFECT: "", DIRECTIONAL: "" },
  };
}

function registrationInterruptionFrom(error: unknown): RegistrationInterruption {
  if (error instanceof SpeedsterMapRegistrationRequestError) {
    return { message: error.message, failure: error.failure };
  }
  return {
    message: error instanceof Error ? error.message : "CARD MAP registration did not finish.",
    failure: {
      version: "speedster-map-registration-error-v1",
      source: "CLIENT_PROTOCOL",
      code: "UNCLASSIFIED_REGISTRATION_FAILURE",
      httpStatus: null,
      retryable: false,
      requestId: null,
    },
  };
}

export function isAutomaticSpeedsterMapRegistrationRetryEligible(error: unknown) {
  if (!(error instanceof SpeedsterMapRegistrationRequestError) || !error.failure.retryable) return false;
  const { source, code, httpStatus } = error.failure;
  return (
    source === "PROVIDER_GATEWAY"
    && (code === "PROVIDER_GATEWAY_HTTP_502" || code === "PROVIDER_GATEWAY_HTTP_503")
    && (httpStatus === 502 || httpStatus === 503)
  ) || (
    (source === "PROVIDER_NETWORK" || source === "CLIENT_NETWORK")
    && code === "NETWORK_NO_HTTP_RESPONSE"
    && (httpStatus === 502 || httpStatus === null)
  );
}

function registrationDecisionIds(
  interruptions: RegistrationInterruptionState["interruptions"],
): RegistrationInterruptionState["decisionIds"] {
  return {
    continue: crypto.randomUUID(),
    abandonObsoleteMap: crypto.randomUUID(),
    retry: {
      ...(interruptions.FRONT ? { FRONT: crypto.randomUUID() } : {}),
      ...(interruptions.BACK ? { BACK: crypto.randomUUID() } : {}),
    },
  };
}

export function CaptureWorkspace({
  token,
  sessionId,
  cardProfile,
  draftSurface = "AI_GRADER",
  activeMapRevisionId = null,
  activeMapRevisionHash = null,
  activeMapScope = null,
  activeMapName = null,
  mapBindingStatus: requestedMapBindingStatus,
  mapLookupFailed = false,
  onReady,
  onDraftCleanupFailure,
  onInstrumentationEvent,
  imageRequestTimeoutMs,
  decisionAuditConfirmationTimeoutMs = SPEEDSTER_REGISTRATION_DECISION_AUDIT_CONFIRMATION_TIMEOUT_MS,
}: CaptureWorkspaceProps) {
  const mapBindingStatus: SpeedsterCaptureDraftMapBindingStatus = requestedMapBindingStatus
    ?? (activeMapRevisionId && activeMapScope ? "LOADED" : mapLookupFailed ? "LOOKUP_FAILED" : "NO_MAP");
  const [frontPhoto, setFrontPhoto] = useState<SpeedsterOriginalPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<SpeedsterOriginalPhoto | null>(null);
  const [matColors, setMatColors] = useState<Readonly<Record<SpeedsterCardSide, SpeedsterMatColor>>>({
    FRONT: "BLACK",
    BACK: "WHITE",
  });
  const [recaptureSide, setRecaptureSide] = useState<SpeedsterCardSide | null>(null);
  const [iphonePairingUrl, setIphonePairingUrl] = useState<string>();
  const iphoneVersion = useRef(0);
  const [front, setFront] = useState<SideState | null>(null);
  const [back, setBack] = useState<SideState | null>(null);
  const [stage, setStage] = useState<Stage>("PHOTOS");
  const [cornerShape, setCornerShape] = useState<SpeedsterCornerShape>("ROUNDED_3_18_MM");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Add one original image of each side.");
  const [mapRegistrationNotice, setMapRegistrationNotice] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [auditReconciliationNotices, setAuditReconciliationNotices] = useState<readonly AuditReconciliationNotice[]>([]);
  const [captureSaveFailed, setCaptureSaveFailed] = useState(false);
  const [registrationRescue, setRegistrationRescue] = useState<RegistrationRescueState | null>(null);
  const [registrationInterruption, setRegistrationInterruption] = useState<RegistrationInterruptionState | null>(null);
  const [correctedAnchorDrafts, setCorrectedAnchorDrafts] = useState<Partial<
    Record<SpeedsterCardSide, readonly SpeedsterCaptureDraftCorrectedAnchor[]>
  >>({});
  const [pendingCaptureDraft, setPendingCaptureDraft] = useState<SpeedsterCaptureRegistrationDraft | null>(null);
  const [mapMismatchedCaptureDraft, setMapMismatchedCaptureDraft] = useState<SpeedsterCaptureRegistrationDraft | null>(null);
  const [captureDraftHydratedSessionId, setCaptureDraftHydratedSessionId] = useState<string | null>(null);
  const [invalidCaptureDraftPresent, setInvalidCaptureDraftPresent] = useState(false);
  const [captureDraftError, setCaptureDraftError] = useState<string | null>(null);
  const [colorGeometryRecoveryTarget, setColorGeometryRecoveryTarget] = useState<ColorGeometryRecoveryTarget | null>(null);
  const [preparedImageRefresh, setPreparedImageRefresh] = useState(EMPTY_PREPARED_IMAGE_REFRESH);
  const [colorScore, setColorScore] = useState<SpeedsterColorGeometryScore | null>(null);
  const colorScoreGeneration = useRef(0);
  const colorScoreRequest = useRef<AbortController | null>(null);
  const geometryAttempt = useRef(0);
  const activeImageRequest = useRef<AbortController | null>(null);
  const photosStartedAt = useRef(Date.now());
  const photosReadyRecorded = useRef(false);
  const stageStartedAt = useRef(Date.now());
  const frontGeometryTiming = useRef<{ startedAtMs: number; endedAtMs: number } | null>(null);
  const mapRegistrationFailed = useRef(false);
  const mapAuthorityAbandoned = useRef(false);
  const registrationFailureSides = useRef<Partial<Record<SpeedsterCardSide, true>>>({});
  const captureActionInFlight = useRef(false);
  const registrationActionInFlight = useRef(false);
  const currentRegistrationOperationId = useRef<string | null>(null);
  const readyDispatched = useRef(false);
  const preparedImageRefreshInFlight = useRef<Partial<Record<SpeedsterCardSide, Readonly<{
    storageKey: string;
    promise: Promise<string>;
  }>>>>({});
  const preparedImageAutomaticRetryUsed = useRef<Partial<Record<SpeedsterCardSide, boolean>>>({});
  const currentSessionId = useRef(sessionId);
  const captureDraftCreatedAtMs = useRef<number | null>(null);
  const captureDraftDecisionIds = useRef<RegistrationInterruptionState["decisionIds"] | null>(null);
  const registrationRecordedAtMs = useRef<Partial<Record<SpeedsterCardSide, number>>>({});
  const captureDraftBindingGeneration = useRef(0);
  const captureWorkspaceMounted = useRef(true);
  const currentCaptureDraftBinding = useRef("");

  const persistRegistrationBlock = useCallback(async (
    operationId: string,
    failures: readonly RegistrationFailureEvidence[],
  ) => {
    if (!activeMapRevisionId || !activeMapRevisionHash || !activeMapScope || failures.length === 0) {
      setCaptureDraftError("Card Map registration stopped, but its exact revision evidence is unavailable. No continuation is allowed; retain this page and retry after authority is restored.");
      return false;
    }
    try {
      const { response, payload } = await runSpeedsterImageRequest(
        "Card Map registration blocker recording",
        { timeoutMs: imageRequestTimeoutMs },
        async (signal) => {
          const response = await fetch(
            `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(sessionId)}/map-authority`,
            {
              method: "POST",
              headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
              body: JSON.stringify({
                action: "BLOCK_REGISTRATION",
                mapRevisionId: activeMapRevisionId,
                mapRevisionHash: activeMapRevisionHash,
                mapScope: activeMapScope,
                operationId,
                failures,
              }),
              cache: "no-store",
              signal,
            },
          );
          const payload = await response.json().catch(() => ({})) as { message?: string };
          return { response, payload };
        },
      );
      if (!response.ok) throw new Error(payload.message ?? "Card Map registration blocker could not be recorded.");
      setCaptureDraftError(null);
      return true;
    } catch (error) {
      setCaptureDraftError(`${error instanceof Error ? error.message : "Card Map registration blocker could not be recorded."} The failure remains blocked in this browser; do not reload until Retry succeeds.`);
      return false;
    }
  }, [activeMapRevisionHash, activeMapRevisionId, activeMapScope, imageRequestTimeoutMs, sessionId, token]);

  currentSessionId.current = sessionId;
  currentCaptureDraftBinding.current = captureDraftBindingKey({
    surface: draftSurface,
    sessionId,
    cardProfile,
    mapBindingStatus,
    activeMapRevisionId,
    activeMapScope,
  });

  useEffect(() => {
    captureDraftBindingGeneration.current += 1;
    activeImageRequest.current?.abort();
    activeImageRequest.current = null;
    iphoneVersion.current = 0;
    photosStartedAt.current = Date.now();
    photosReadyRecorded.current = false;
    stageStartedAt.current = Date.now();
    frontGeometryTiming.current = null;
    mapRegistrationFailed.current = false;
    mapAuthorityAbandoned.current = mapBindingStatus === "HUMAN_REVIEW_WITHOUT_MAP";
    registrationFailureSides.current = {};
    captureActionInFlight.current = false;
    registrationActionInFlight.current = false;
    currentRegistrationOperationId.current = null;
    readyDispatched.current = false;
    setFrontPhoto(null);
    setBackPhoto(null);
    setMatColors({ FRONT: "BLACK", BACK: "WHITE" });
    setRecaptureSide(null);
    setFront(null);
    setBack(null);
    setStage("PHOTOS");
    setWorking(false);
    setMapRegistrationNotice(null);
    setWorkflowError(null);
    setAuditReconciliationNotices([]);
    setCaptureSaveFailed(false);
    setRegistrationRescue(null);
    setRegistrationInterruption(null);
    setCorrectedAnchorDrafts({});
    setPendingCaptureDraft(null);
    setMapMismatchedCaptureDraft(null);
    setCaptureDraftHydratedSessionId(null);
    setInvalidCaptureDraftPresent(false);
    setCaptureDraftError(null);
    setColorGeometryRecoveryTarget(null);
    setPreparedImageRefresh(EMPTY_PREPARED_IMAGE_REFRESH);
    preparedImageRefreshInFlight.current = {};
    preparedImageAutomaticRetryUsed.current = {};
    captureDraftCreatedAtMs.current = null;
    captureDraftDecisionIds.current = null;
    registrationRecordedAtMs.current = {};
    if (typeof window !== "undefined") {
      try {
        const storageKey = speedsterCaptureRegistrationDraftStorageKey(sessionId);
        const rawDraft = window.localStorage.getItem(storageKey);
        if (rawDraft) {
          const restored = readSpeedsterCaptureRegistrationDraft(window.localStorage, {
            surface: draftSurface,
            sessionId,
            cardProfile,
            mapBindingStatus,
            activeMapRevisionId,
            activeMapScope,
          });
          if (restored) {
            captureDraftCreatedAtMs.current = restored.createdAtMs;
            setPendingCaptureDraft(restored);
            setMessage("A preserved capture draft is available. Choose Resume or Discard; nothing has been applied or retried.");
          } else {
            const selfBound = readSpeedsterCaptureRegistrationDraftForCommittedSession(window.localStorage, {
              surface: draftSurface,
              sessionId,
              cardProfile,
            });
            if (selfBound && selfBound.version !== SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION
              && mapBindingStatus === "HUMAN_REVIEW_WITHOUT_MAP"
              && selfBound.mapAuthorityAbandoned) {
              const humanReviewDraft: SpeedsterCaptureRegistrationDraft = {
                ...selfBound,
                mapBindingStatus: "HUMAN_REVIEW_WITHOUT_MAP",
                activeMapRevisionId: null,
                activeMapScope: null,
                activeMapName: null,
                front: { ...selfBound.front, mapRegistration: undefined },
                back: { ...selfBound.back, mapRegistration: undefined },
                provisional: {},
                registrationRecordedAtMs: {},
              };
              writeSpeedsterCaptureRegistrationDraft(window.localStorage, humanReviewDraft);
              setPendingCaptureDraft(humanReviewDraft);
              setMessage("The preserved work was rebound to its durable human-review-without-map decision. Choose Resume or Discard; no map will be applied.");
            } else if (selfBound) {
              setMapMismatchedCaptureDraft(selfBound);
              setCaptureDraftError("The preserved draft belongs to a different Card Map revision or lookup state. Its old map authority was not applied. Keep the unchanged draft for incident review, or explicitly discard it and restart against the current exact revision.");
            } else {
              setInvalidCaptureDraftPresent(true);
              setCaptureDraftError("A preserved capture draft exists but failed strict session validation. Fresh capture is blocked; the draft remains stored until you explicitly discard it.");
            }
          }
        }
      } catch {
        setInvalidCaptureDraftPresent(true);
        setCaptureDraftError("The preserved capture draft could not be read. No draft was deleted or resumed.");
      }
    }
    setCaptureDraftHydratedSessionId(sessionId);
  }, [activeMapRevisionId, activeMapScope, cardProfile, draftSurface, mapBindingStatus, sessionId]);

  useEffect(() => {
    captureWorkspaceMounted.current = true;
    return () => {
      captureWorkspaceMounted.current = false;
      activeImageRequest.current?.abort();
      activeImageRequest.current = null;
      colorScoreRequest.current?.abort();
      colorScoreRequest.current = null;
      currentRegistrationOperationId.current = null;
    };
  }, []);

  const refreshColorScore = useCallback((clearCurrent = false) => {
    colorScoreRequest.current?.abort();
    const controller = new AbortController();
    colorScoreRequest.current = controller;
    const generation = ++colorScoreGeneration.current;
    if (clearCurrent) setColorScore(null);
    void (async () => {
      try {
        const response = await fetch("/api/admin/ai-grader-v2/color-geometry-score", {
          headers: buildAdminHeaders(token),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as { score?: SpeedsterColorGeometryScore };
        if (!controller.signal.aborted && generation === colorScoreGeneration.current
          && response.ok && payload.score) {
          setColorScore(payload.score);
        }
      } catch {
        // Score visibility is observational and must never block capture/manual review.
      } finally {
        if (colorScoreRequest.current === controller) colorScoreRequest.current = null;
      }
    })();
    return controller;
  }, [token]);

  useEffect(() => {
    const controller = refreshColorScore(true);
    return () => {
      controller.abort();
      if (colorScoreRequest.current === controller) {
        colorScoreRequest.current = null;
        colorScoreGeneration.current += 1;
      }
    };
  }, [refreshColorScore, sessionId]);

  const changeMatAndRecapture = (
    side: SpeedsterCardSide,
    recommendedMat: SpeedsterMatColor | null,
  ) => {
    if (working || captureActionInFlight.current || registrationActionInFlight.current) return;
    if (activeMapRevisionId && (!front?.mapRegistration || !back?.mapRegistration)) {
      setWorkflowError("One-side mat recapture is unavailable because the loaded Card Map was explicitly left unapplied. Existing decision provenance and completed geometry remain preserved; continue with human centering or start a fresh capture by explicit choice.");
      return;
    }
    activeImageRequest.current?.abort();
    activeImageRequest.current = null;
    geometryAttempt.current += 1;
    side === "FRONT" ? setFrontPhoto(null) : setBackPhoto(null);
    if (recommendedMat) {
      setMatColors((current) => ({ ...current, [side]: recommendedMat }));
    }
    side === "FRONT" ? setFront(null) : setBack(null);
    setRecaptureSide(side);
    setRegistrationRescue(null);
    setRegistrationInterruption(null);
    currentRegistrationOperationId.current = null;
    delete registrationRecordedAtMs.current[side];
    setMapRegistrationNotice(null);
    setWorkflowError(null);
    setCaptureSaveFailed(false);
    setWorking(false);
    setStage("PHOTOS");
    photosStartedAt.current = Date.now();
    photosReadyRecorded.current = false;
    stageStartedAt.current = Date.now();
    frontGeometryTiming.current = null;
    mapRegistrationFailed.current = false;
    registrationFailureSides.current = {};
    readyDispatched.current = false;
    setMessage(`${side === "FRONT" ? "Front" : "Back"} mat change selected. Recapture only that side; its prior original and dependent geometry were cleared. The completed sibling side is retained.`);
  };

  const refreshPreparedImage = useCallback((side: SpeedsterCardSide, storageKey: string) => {
    const existing = preparedImageRefreshInFlight.current[side];
    if (existing?.storageKey === storageKey) return existing.promise;
    const requestSessionId = sessionId;
    setPreparedImageRefresh((current) => ({
      ...current,
      [side]: { ...current[side], refreshing: true, error: null },
    }));
    const request = fetchSpeedsterPreparedRectifiedImageUrl({ token, sessionId, side, storageKey })
      .then((imageUrl) => {
        if (currentSessionId.current !== requestSessionId
          || preparedImageRefreshInFlight.current[side]?.promise !== request) return imageUrl;
        const install = (current: SideState | null) => current?.rectifiedStorageKey === storageKey ? {
          ...current,
          rectifiedUrl: imageUrl,
          rectifiedImageRevision: (current.rectifiedImageRevision ?? 0) + 1,
        } : current;
        side === "FRONT" ? setFront(install) : setBack(install);
        setPreparedImageRefresh((current) => ({
          ...current,
          [side]: { refreshing: false, error: null },
        }));
        return imageUrl;
      })
      .catch((error) => {
        if (currentSessionId.current === requestSessionId
          && preparedImageRefreshInFlight.current[side]?.promise === request) {
          const detail = error instanceof Error ? error.message : `The ${side.toLowerCase()} card image could not be refreshed.`;
          setPreparedImageRefresh((current) => ({
            ...current,
            [side]: {
              refreshing: false,
              error: `${detail} Your geometry and anchor corrections are preserved.`,
            },
          }));
        }
        throw error;
      })
      .finally(() => {
        if (preparedImageRefreshInFlight.current[side]?.promise === request) {
          delete preparedImageRefreshInFlight.current[side];
        }
      });
    preparedImageRefreshInFlight.current[side] = { storageKey, promise: request };
    return request;
  }, [sessionId, token]);

  const handlePreparedImageError = useCallback((side: SpeedsterCardSide, storageKey?: string) => {
    if (preparedImageAutomaticRetryUsed.current[side]) {
      setPreparedImageRefresh((current) => ({
        ...current,
        [side]: {
          refreshing: false,
          error: `The refreshed ${side.toLowerCase()} card image still did not load. Your geometry and anchor corrections are preserved.`,
        },
      }));
      return;
    }
    if (!storageKey) {
      setPreparedImageRefresh((current) => ({
        ...current,
        [side]: {
          refreshing: false,
          error: `The exact ${side.toLowerCase()} prepared image key is unavailable. Your geometry and anchor corrections are preserved.`,
        },
      }));
      return;
    }
    preparedImageAutomaticRetryUsed.current[side] = true;
    void refreshPreparedImage(side, storageKey).catch(() => undefined);
  }, [refreshPreparedImage]);

  const retryPreparedImage = useCallback((side: SpeedsterCardSide, storageKey?: string) => {
    preparedImageAutomaticRetryUsed.current[side] = false;
    if (!storageKey) {
      handlePreparedImageError(side, storageKey);
      return;
    }
    void refreshPreparedImage(side, storageKey).catch(() => undefined);
  }, [handlePreparedImageError, refreshPreparedImage]);

  const refreshOriginalImage = useCallback(async (side: SpeedsterCardSide) => {
    const current = side === "FRONT" ? front : back;
    if (!current || working || captureActionInFlight.current) return;
    const storageKey = current.originalStorageKey;
    const requestSessionId = sessionId;
    setWorking(true);
    setWorkflowError(null);
    setMessage(`Refreshing the exact ${side.toLowerCase()} source URL without changing its storage identity.`);
    try {
      const imageUrl = await fetchSpeedsterOriginalImageUrl({
        token,
        sessionId,
        side,
        storageKey,
        timeoutMs: imageRequestTimeoutMs,
      });
      if (currentSessionId.current !== requestSessionId) return;
      const install = (value: SideState | null) => value?.originalStorageKey === storageKey
        ? { ...value, sourceUrl: imageUrl }
        : value;
      side === "FRONT" ? setFront(install) : setBack(install);
      setMessage(`The exact ${side.toLowerCase()} source URL was refreshed. Confirm only after the image is visibly rendered.`);
    } catch (error) {
      if (currentSessionId.current === requestSessionId) {
        setWorkflowError(`${error instanceof Error ? error.message : `The ${side.toLowerCase()} source URL could not be refreshed.`} Existing geometry remains unchanged.`);
      }
    } finally {
      if (currentSessionId.current === requestSessionId) setWorking(false);
    }
  }, [back, front, imageRequestTimeoutMs, sessionId, token, working]);

  const markPreparedImageReady = useCallback((side: SpeedsterCardSide) => {
    preparedImageAutomaticRetryUsed.current[side] = false;
    setPreparedImageRefresh((current) => current[side].error ? ({
      ...current,
      [side]: { refreshing: false, error: null },
    }) : current);
  }, []);

  const discardPreservedCaptureDraft = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      removeSpeedsterCaptureRegistrationDraft(window.localStorage, sessionId);
      setPendingCaptureDraft(null);
      setMapMismatchedCaptureDraft(null);
      setInvalidCaptureDraftPresent(false);
      setCaptureDraftError(null);
      captureDraftCreatedAtMs.current = null;
      setMessage("Preserved capture draft discarded by explicit operator choice. Add front + back photos to start again.");
    } catch {
      setCaptureDraftError("The preserved capture draft could not be discarded. It remains stored; no work was resumed or changed.");
    }
  }, [sessionId]);

  const recoverLegacyColorGeometry = useCallback(async (
    draft: SpeedsterCaptureRegistrationDraft,
    source: "MATCHED" | "MAP_MISMATCHED",
  ) => {
    if (draft.version !== SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION || working) return;
    const originatingSessionId = sessionId;
    activeImageRequest.current?.abort();
    const controller = new AbortController();
    activeImageRequest.current = controller;
    setWorking(true);
    setCaptureDraftError(null);
    setMessage("Explicitly rerunning Color Geometry against the preserved originals. No photo, handle, prepared artifact, or Card Map evidence is being replaced.");
    try {
      const recover = (
        side: SpeedsterCardSide,
        mode: "PHYSICAL_OUTER" | "PRINTED_FRAME",
      ) => {
        const preserved = side === "FRONT" ? draft.front : draft.back;
        return speedsterImageService.recoverColorGeometry(token, {
          sessionId,
          side,
          sourceImageStorageKey: preserved.originalStorageKey,
          mode,
          matColor: matColors[side],
          corners: preserved.corners,
        }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      };
      const [frontPhysical, frontPrinted, backPhysical, backPrinted] = await Promise.all([
        recover("FRONT", "PHYSICAL_OUTER"),
        recover("FRONT", "PRINTED_FRAME"),
        recover("BACK", "PHYSICAL_OUTER"),
        recover("BACK", "PRINTED_FRAME"),
      ]);
      if (activeImageRequest.current !== controller
        || !captureWorkspaceMounted.current
        || currentSessionId.current !== originatingSessionId) return;
      const upgradeSide = (
        side: SpeedsterCardSide,
        physical: Awaited<ReturnType<typeof recover>>,
        printed: Awaited<ReturnType<typeof recover>>,
      ): SpeedsterCaptureDraftSideV2 => ({
        ...(side === "FRONT" ? draft.front : draft.back),
        matColor: matColors[side],
        physicalColorGeometry: physical.colorGeometry,
        physicalColorGeometryReceipt: physical.colorGeometryReceipt,
        printedColorGeometry: printed.colorGeometry,
        printedColorGeometryReceipt: printed.colorGeometryReceipt,
      });
      const upgraded: SpeedsterCaptureRegistrationDraft = {
        ...draft,
        version: SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_CURRENT_VERSION,
        updatedAtMs: Date.now(),
        front: upgradeSide("FRONT", frontPhysical, frontPrinted),
        back: upgradeSide("BACK", backPhysical, backPrinted),
      };
      if (typeof window === "undefined") throw new Error("Browser draft storage is unavailable.");
      writeSpeedsterCaptureRegistrationDraft(window.localStorage, upgraded);
      captureDraftCreatedAtMs.current = upgraded.createdAtMs;
      if (source === "MATCHED") setPendingCaptureDraft(upgraded);
      else setMapMismatchedCaptureDraft(upgraded);
      setMessage("Color Geometry evidence recovered. All four preserved physical/printed handle quads were explicitly reconfirmed unchanged; choose the visible Resume action to continue.");
    } catch (error) {
      if (activeImageRequest.current === controller) {
        setCaptureDraftError(`${error instanceof Error ? error.message : "Color Geometry recovery did not finish."} The original v1 draft, photos, handles, prepared artifacts, and map evidence remain unchanged.`);
        setMessage("Legacy Color Geometry recovery did not finish; the preserved v1 draft is still intact.");
      }
    } finally {
      if (activeImageRequest.current === controller) {
        activeImageRequest.current = null;
        setWorking(false);
      }
    }
  }, [imageRequestTimeoutMs, matColors, sessionId, token, working]);

  const recoverExpiredColorGeometry = useCallback(async () => {
    const target = colorGeometryRecoveryTarget;
    const current = target?.side === "FRONT" ? front : target?.side === "BACK" ? back : null;
    if (!target || !current || !current.corners || !front || !back || working) return;
    activeImageRequest.current?.abort();
    const controller = new AbortController();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage(`Rerunning only ${target.side} ${target.mode}. The sibling side, other three receipts, and all confirmed quads remain retained.`);
    try {
      const recovered = await speedsterImageService.recoverColorGeometry(token, {
        sessionId,
        side: target.side,
        sourceImageStorageKey: current.originalStorageKey,
        mode: target.mode,
        matColor: current.matColor,
        corners: current.corners,
      }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      if (activeImageRequest.current !== controller) return;
      const recoveredSide: SideState = target.mode === "PHYSICAL_OUTER"
        ? {
            ...current,
            physicalColorGeometry: recovered.colorGeometry,
            physicalColorGeometryReceipt: recovered.colorGeometryReceipt,
          }
        : {
            ...current,
            printedColorGeometry: recovered.colorGeometry,
            printedColorGeometryReceipt: recovered.colorGeometryReceipt,
          };
      target.side === "FRONT" ? setFront(recoveredSide) : setBack(recoveredSide);
      readyDispatched.current = false;
      setCaptureSaveFailed(true);
      setStage("BACK_CENTERING");
      setColorGeometryRecoveryTarget(null);
      setMessage(`${target.side} ${target.mode} was rerun and its preserved confirmed quad was explicitly reconfirmed unchanged. The other three receipts/evidence were not replaced; choose Retry save.`);
    } catch (error) {
      if (activeImageRequest.current === controller) {
        setWorkflowError(`${error instanceof Error ? error.message : "Targeted Color Geometry recovery did not finish."} No completed sibling, nonexpired mode, or confirmed quad was changed.`);
      }
    } finally {
      if (activeImageRequest.current === controller) {
        activeImageRequest.current = null;
        setWorking(false);
      }
    }
  }, [back, colorGeometryRecoveryTarget, front, imageRequestTimeoutMs, sessionId, token, working]);

  const resumePreservedCaptureDraft = useCallback(async () => {
    const draft = pendingCaptureDraft;
    if (!draft || working) return;
    if (draft.version === SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION) {
      setCaptureDraftError("This preserved v1 draft predates Color Geometry receipts. Its photos, confirmed quads, registration evidence, and handle positions remain intact; explicitly recover its Color evidence before continuing.");
      return;
    }
    const originatingSessionId = sessionId;
    const originatingGeneration = captureDraftBindingGeneration.current;
    const originatingBinding = captureDraftBindingKey({
      surface: draft.surface,
      sessionId: draft.sessionId,
      cardProfile: draft.cardProfile,
      mapBindingStatus: draft.mapBindingStatus,
      activeMapRevisionId: draft.activeMapRevisionId,
      activeMapScope: draft.activeMapScope,
    });
    if (originatingBinding !== currentCaptureDraftBinding.current) {
      setCaptureDraftError("The capture binding changed before Resume. The preserved draft remains intact; review the current session and map before choosing again.");
      return;
    }
    setWorking(true);
    setCaptureDraftError(null);
    setMessage("Refreshing prepared Front + Back images before resuming the preserved draft.");
    try {
      const [frontUrl, backUrl] = await Promise.all([
        fetchSpeedsterPreparedRectifiedImageUrl({ token, sessionId, side: "FRONT", storageKey: draft.front.rectifiedStorageKey }),
        fetchSpeedsterPreparedRectifiedImageUrl({ token, sessionId, side: "BACK", storageKey: draft.back.rectifiedStorageKey }),
      ]);
      if (!captureWorkspaceMounted.current
        || captureDraftBindingGeneration.current !== originatingGeneration
        || currentCaptureDraftBinding.current !== originatingBinding
        || currentSessionId.current !== originatingSessionId) return;
      let frontDraft = draft.front;
      let backDraft = draft.back;
      let stage: Stage = draft.stage;
      let interruption: RegistrationInterruptionState | null = null;
      let rescue: RegistrationRescueState | null = null;
      const expiredRegistrationSides = new Set(speedsterCaptureDraftExpiredRegistrationSides(draft));
      const restoredRegistrationRecordedAtMs = { ...draft.registrationRecordedAtMs };
      if (expiredRegistrationSides.size > 0) {
        const interruptions: RegistrationInterruptionState["interruptions"] = { ...draft.interruptions };
        const provisional = { ...draft.provisional };
        const retry: Partial<Record<SpeedsterCardSide, string>> = { ...draft.decisionIds.retry };
        for (const side of (["FRONT", "BACK"] as const)) {
          const candidate = provisional[side] ?? (side === "FRONT" ? frontDraft.mapRegistration : backDraft.mapRegistration);
          if (!candidate || !expiredRegistrationSides.has(side)) continue;
          interruptions[side] = {
            message: `The preserved ${side.toLowerCase()} registration receipt is older than 24 hours. Re-register this side, or explicitly continue through human review without applying the map.`,
            failure: {
              version: "speedster-map-registration-error-v1",
              source: "CLIENT_PROTOCOL",
              code: "DRAFT_REGISTRATION_RECEIPT_EXPIRED",
              httpStatus: null,
              retryable: false,
              requestId: null,
            },
          };
          delete provisional[side];
          delete restoredRegistrationRecordedAtMs[side];
          retry[side] = crypto.randomUUID();
          if (side === "FRONT") {
            const { mapRegistration: _mapRegistration, ...withoutRegistration } = frontDraft;
            frontDraft = withoutRegistration;
          } else {
            const { mapRegistration: _mapRegistration, ...withoutRegistration } = backDraft;
            backDraft = withoutRegistration;
          }
        }
        interruption = {
          interruptions,
          failures: draft.failures,
          failureRequestIds: draft.failureRequestIds,
          provisional,
          operationId: draft.operationId,
          attemptNumbers: draft.attemptNumbers,
          decisionIds: {
            continue: draft.decisionIds.continue,
            abandonObsoleteMap: draft.decisionIds.abandonObsoleteMap,
            retry,
          },
        };
        stage = "MAP_REGISTRATION_INTERRUPTED";
        await persistRegistrationBlock(
          draft.operationId,
          registrationFailureEvidence(interruptions, draft.failures, draft.failureRequestIds),
        );
        setCaptureDraftError("The draft was resumed, but one or more registration receipts expired. No map was applied. Re-register every listed side, or explicitly continue through human review without the map.");
      } else if (draft.stage === "MAP_REGISTRATION_INTERRUPTED") {
        interruption = {
          interruptions: draft.interruptions,
          failures: draft.failures,
          failureRequestIds: draft.failureRequestIds,
          provisional: draft.provisional,
          operationId: draft.operationId,
          attemptNumbers: draft.attemptNumbers,
          decisionIds: draft.decisionIds,
        };
      } else if (draft.stage === "MAP_REGISTRATION_RESCUE") {
        rescue = {
          failures: draft.failures,
          failureRequestIds: draft.failureRequestIds,
          provisional: draft.provisional,
          attemptIds: draft.attemptIds,
          operationId: draft.operationId,
          attemptNumbers: draft.attemptNumbers,
          continueDecisionId: draft.decisionIds.continue,
        };
      }
      setFront(restoredCaptureSide(frontDraft, frontUrl));
      setBack(restoredCaptureSide(backDraft, backUrl));
      setCornerShape(draft.cornerShape);
      setRegistrationInterruption(interruption);
      setRegistrationRescue(rescue);
      setRecaptureSide(draft.version === SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_CURRENT_VERSION
        ? draft.recaptureSide ?? null
        : null);
      setCorrectedAnchorDrafts(draft.correctedAnchors);
      setCaptureSaveFailed(draft.captureSavePendingRetry);
      registrationRecordedAtMs.current = restoredRegistrationRecordedAtMs;
      setStage(stage);
      currentRegistrationOperationId.current = draft.operationId;
      captureDraftDecisionIds.current = draft.decisionIds;
      registrationFailureSides.current = draft.registrationFailureSides;
      mapRegistrationFailed.current = draft.mapRegistrationFailed;
      mapAuthorityAbandoned.current = draft.mapAuthorityAbandoned;
      setMapRegistrationNotice(draft.notice);
      setPendingCaptureDraft(null);
      setMessage(stage === "MAP_REGISTRATION_INTERRUPTED"
        ? "Preserved draft resumed. Retry the listed side, or explicitly continue through human review without applying the map."
        : stage === "MAP_REGISTRATION_RESCUE"
          ? "Preserved anchor-rescue draft resumed. Confirm the retained handle positions when ready."
          : "Preserved prepared-card draft resumed. Confirm the printed-border geometry.");
    } catch (error) {
      if (captureWorkspaceMounted.current
        && captureDraftBindingGeneration.current === originatingGeneration
        && currentCaptureDraftBinding.current === originatingBinding
        && currentSessionId.current === originatingSessionId) {
        setCaptureDraftError(`${error instanceof Error ? error.message : "Prepared images could not be refreshed."} The preserved draft remains intact; retry Resume or explicitly Discard.`);
        setMessage("Preserved draft was not resumed because its prepared images are unavailable.");
      }
    } finally {
      if (captureWorkspaceMounted.current
        && captureDraftBindingGeneration.current === originatingGeneration
        && currentCaptureDraftBinding.current === originatingBinding
        && currentSessionId.current === originatingSessionId) setWorking(false);
    }
  }, [pendingCaptureDraft, persistRegistrationBlock, sessionId, token, working]);

  useEffect(() => {
    if (typeof window === "undefined" || pendingCaptureDraft
      || !front || !back || ![
        "MAP_REGISTRATION_INTERRUPTED", "MAP_REGISTRATION_RESCUE", "FRONT_CENTERING", "BACK_CENTERING",
      ].includes(stage)) return;
    const durableFront = durableCaptureSide(front);
    const durableBack = durableCaptureSide(back);
    const operationId = currentRegistrationOperationId.current;
    if (!durableFront || !durableBack || !operationId) return;
    const stableDecisionIds = registrationInterruption?.decisionIds
      ?? captureDraftDecisionIds.current
      ?? { continue: crypto.randomUUID(), abandonObsoleteMap: crypto.randomUUID(), retry: {} };
    captureDraftDecisionIds.current = stableDecisionIds;
    const now = Date.now();
    const createdAtMs = captureDraftCreatedAtMs.current ?? now;
    captureDraftCreatedAtMs.current = createdAtMs;
    const draft: SpeedsterCaptureRegistrationDraft = {
      version: SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_CURRENT_VERSION,
      createdAtMs,
      updatedAtMs: now,
      surface: draftSurface,
      sessionId,
      cardProfile,
      mapBindingStatus,
      activeMapRevisionId,
      activeMapScope,
      activeMapName,
      cornerShape,
      stage: stage as SpeedsterCaptureRegistrationDraft["stage"],
      front: durableFront,
      back: durableBack,
      interruptions: registrationInterruption?.interruptions ?? {},
      failures: registrationInterruption?.failures ?? registrationRescue?.failures ?? {},
      failureRequestIds: registrationInterruption?.failureRequestIds ?? registrationRescue?.failureRequestIds ?? {},
      provisional: registrationInterruption?.provisional ?? registrationRescue?.provisional ?? {
        ...(front.mapRegistration ? { FRONT: front.mapRegistration } : {}),
        ...(back.mapRegistration ? { BACK: back.mapRegistration } : {}),
      },
      registrationRecordedAtMs: registrationRecordedAtMs.current,
      attemptIds: registrationRescue?.attemptIds ?? {},
      operationId,
      attemptNumbers: registrationInterruption?.attemptNumbers ?? registrationRescue?.attemptNumbers ?? {},
      decisionIds: registrationInterruption?.decisionIds ?? {
        continue: registrationRescue?.continueDecisionId ?? stableDecisionIds.continue,
        abandonObsoleteMap: stableDecisionIds.abandonObsoleteMap,
        retry: {},
      },
      correctedAnchors: correctedAnchorDrafts,
      registrationFailureSides: registrationFailureSides.current,
      mapRegistrationFailed: mapRegistrationFailed.current,
      mapAuthorityAbandoned: mapAuthorityAbandoned.current,
      captureSavePendingRetry: captureSaveFailed,
      notice: mapRegistrationNotice,
      ...(recaptureSide ? { recaptureSide } : {}),
    };
    try {
      writeSpeedsterCaptureRegistrationDraft(window.localStorage, draft);
    } catch (error) {
      setCaptureDraftError(`${error instanceof Error ? error.message : "The capture draft could not be preserved."} Current in-memory work is unchanged; do not reload until this is resolved.`);
    }
  }, [
    activeMapName, activeMapRevisionId, activeMapScope, back, cardProfile, cornerShape,
    correctedAnchorDrafts, draftSurface, front, mapRegistrationNotice, mapBindingStatus,
    captureSaveFailed, pendingCaptureDraft, recaptureSide, registrationInterruption, registrationRescue, sessionId, stage,
  ]);

  useEffect(() => {
    if (!frontPhoto || !backPhoto || photosReadyRecorded.current) return;
    photosReadyRecorded.current = true;
    const photoSource = frontPhoto.kind === backPhoto.kind
      ? frontPhoto.kind
      : "MIXED";
    onInstrumentationEvent?.({
      eventType: "PHOTOS_READY",
      startedAtMs: photosStartedAt.current,
      endedAtMs: Date.now(),
      details: { photoSource },
    });
  }, [backPhoto, frontPhoto, onInstrumentationEvent]);

  useEffect(() => {
    if (stage !== "PHOTOS" || working || captureDraftHydratedSessionId !== sessionId
      || pendingCaptureDraft || mapMismatchedCaptureDraft || invalidCaptureDraftPresent) return;
    if (recaptureSide) {
      setIphonePairingUrl(undefined);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/admin/ai-grader-v2/iphone-capture?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: buildAdminHeaders(token), cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          readyVersion?: number;
          storageGeneration?: "VERSIONED";
          front?: { storageKey: string; readUrl: string };
          back?: { storageKey: string; readUrl: string };
          message?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "iPhone capture status check failed.");
        }
        if (payload.readyVersion && payload.storageGeneration !== "VERSIONED") {
          throw new Error("A non-versioned iPhone capture pair was rejected. Capture a new Front + Back pair with the current Shortcut.");
        }
        if (
          !stopped
          && payload.readyVersion
          && payload.readyVersion > iphoneVersion.current
          && payload.front
          && payload.back
        ) {
          iphoneVersion.current = payload.readyVersion;
          if (recaptureSide === "FRONT") {
            setFrontPhoto({ kind: "IPHONE", ...payload.front, captureVersion: payload.readyVersion });
            setMessage("Fresh Front received. The retained Back remains unchanged; rerun Front geometry.");
          } else if (recaptureSide === "BACK") {
            setBackPhoto({ kind: "IPHONE", ...payload.back, captureVersion: payload.readyVersion });
            setMessage("Fresh Back received. The retained Front remains unchanged; rerun Back geometry.");
          } else {
            setFrontPhoto({ kind: "IPHONE", ...payload.front, captureVersion: payload.readyVersion });
            setBackPhoto({ kind: "IPHONE", ...payload.back, captureVersion: payload.readyVersion });
            setMessage("Current versioned iPhone front + back received. Swap them if needed, then set geometry.");
          }
        }
      } catch (error) {
        if (!stopped) {
          const detail = error instanceof Error ? error.message : "iPhone capture status check failed.";
          setMessage(`${detail} Existing photos and operator work are preserved; the status check will retry.`);
        }
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 2000);
      }
    };

    void (async () => {
      try {
        const response = await fetch("/api/admin/ai-grader-v2/iphone-capture", {
          method: "POST",
          headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ sessionId }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          pairingUrl?: string;
          message?: string;
        };
        if (!response.ok || !payload.pairingUrl) {
          throw new Error(payload.message ?? "iPhone pairing could not start.");
        }
        if (stopped) return;
        setIphonePairingUrl(payload.pairingUrl);
        await poll();
      } catch (error) {
        if (!stopped) setMessage(error instanceof Error ? error.message : "iPhone pairing could not start.");
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [captureDraftHydratedSessionId, invalidCaptureDraftPresent, mapMismatchedCaptureDraft, pendingCaptureDraft, recaptureSide, sessionId, stage, token, working]);

  const beginGeometry = async () => {
    if (!frontPhoto || !backPhoto || working || captureActionInFlight.current
      || captureDraftHydratedSessionId !== sessionId || pendingCaptureDraft
      || mapMismatchedCaptureDraft || invalidCaptureDraftPresent) return;
    captureActionInFlight.current = true;
    const attemptId = geometryAttempt.current + 1;
    const startedAtMs = Date.now();
    geometryAttempt.current = attemptId;
    activeImageRequest.current?.abort();
    const controller = new AbortController();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage(recaptureSide
      ? `Uploading the replacement ${recaptureSide === "FRONT" ? "Front" : "Back"} and preserving the completed sibling side.`
      : "Uploading originals and locking onto the card geometry.");
    try {
      const uploadPhoto = async (side: SpeedsterCardSide, photo: SpeedsterOriginalPhoto) => photo.kind === "IPHONE"
        ? photo
        : uploadSpeedsterOriginal({
            token,
            sessionId,
            side,
            file: photo.file,
            ...(recaptureSide ? { targetedRecapture: true } : {}),
            signal: controller.signal,
            timeoutMs: imageRequestTimeoutMs,
          });
      const requestGeometry = async (side: SpeedsterCardSide, imageUrl: string, storageKey: string) => {
        const startedAt = Date.now();
        try {
          const geometry = await speedsterImageService.proposeGeometry(
            token,
            {
              sessionId,
              side,
              imageUrl,
              sourceImageStorageKey: storageKey,
              matColor: matColors[side],
            },
            { signal: controller.signal, timeoutMs: imageRequestTimeoutMs },
          );
          if (activeImageRequest.current !== controller) throw new Error("A newer Set geometry attempt replaced this request.");
          const corners = sanitizeSpeedsterUnitQuad(geometry.corners);
          const colorAccepted = geometry.colorGeometry.outcome === "ACCEPTED";
          if (colorAccepted !== Boolean(corners)
            || (colorAccepted && JSON.stringify(corners) !== JSON.stringify(geometry.colorGeometry.proposal))) {
            throw new Error("Physical geometry corners contradict the Color outcome authority. No automatic geometry was applied.");
          }
          return {
            geometry,
            corners,
            diagnostic: {
              sessionId,
              attemptId,
              side,
              durationMs: Date.now() - startedAt,
              corners: corners ? "present" as const : "null" as const,
            },
          };
        } catch (error) {
          logSpeedsterGeometryAttempt({
            sessionId,
            attemptId,
            side,
            durationMs: Date.now() - startedAt,
            corners: "unavailable",
          }, "not-rendered");
          const detail = error instanceof Error ? error.message : "Speedster geometry failed.";
          throw new Error(`${side === "FRONT" ? "Front" : "Back"} geometry failed: ${detail}`);
        }
      };
      const toSideState = (
        side: SpeedsterCardSide,
        uploaded: Readonly<{ storageKey: string; readUrl: string }>,
        result: Awaited<ReturnType<typeof requestGeometry>>,
      ): SideState => {
        const draft = speedsterColorPhysicalDraftState(result.geometry.colorGeometry);
        const corners = result.corners ?? draft.quad;
        const geometryPlacement = result.corners ? "AUTO_ACCEPTED" : draft.placement;
        return {
          originalStorageKey: uploaded.storageKey,
          sourceUrl: uploaded.readUrl,
          corners,
          automaticGeometry: geometryPlacement === "AUTO_ACCEPTED",
          geometryPlacement,
          geometryDiagnostic: result.diagnostic,
          matColor: matColors[side],
          physicalColorGeometry: result.geometry.colorGeometry,
          physicalColorGeometryReceipt: result.geometry.colorGeometryReceipt,
        };
      };
      if (recaptureSide) {
        const retainedSibling = recaptureSide === "FRONT" ? back : front;
        if (!retainedSibling) {
          throw new Error("The retained sibling geometry is unavailable. No recapture authority was changed.");
        }
        const replacementPhoto = recaptureSide === "FRONT" ? frontPhoto : backPhoto;
        const uploaded = await uploadPhoto(recaptureSide, replacementPhoto);
        const result = await requestGeometry(recaptureSide, uploaded.readUrl, uploaded.storageKey);
        if (activeImageRequest.current !== controller) return;
        const replacement = toSideState(recaptureSide, uploaded, result);
        recaptureSide === "FRONT" ? setFront(replacement) : setBack(replacement);
        setStage(recaptureSide === "FRONT" ? "FRONT_GEOMETRY" : "BACK_GEOMETRY");
        stageStartedAt.current = Date.now();
        onInstrumentationEvent?.({
          eventType: "GEOMETRY_PROPOSED",
          startedAtMs,
          endedAtMs: Date.now(),
          details: { side: recaptureSide, automaticGeometryCount: Number(result.corners !== null) },
        });
        setMessage(`${recaptureSide === "FRONT" ? "Front" : "Back"} geometry was recomputed from the replacement image. The completed sibling side and its receipts/evidence remain retained.`);
        return;
      }
      const uploadedFront = await uploadPhoto("FRONT", frontPhoto);
      const frontResult = await requestGeometry("FRONT", uploadedFront.readUrl, uploadedFront.storageKey);
      const uploadedBack = await uploadPhoto("BACK", backPhoto);
      const backResult = await requestGeometry("BACK", uploadedBack.readUrl, uploadedBack.storageKey);
      if (activeImageRequest.current !== controller) return;
      setFront(toSideState("FRONT", uploadedFront, frontResult));
      setBack(toSideState("BACK", uploadedBack, backResult));
      setStage("FRONT_GEOMETRY");
      stageStartedAt.current = Date.now();
      const automaticCount = Number(frontResult.corners !== null) + Number(backResult.corners !== null);
      onInstrumentationEvent?.({
        eventType: "GEOMETRY_PROPOSED",
        startedAtMs,
        endedAtMs: Date.now(),
        details: { automaticGeometryCount: automaticCount },
      });
      setMessage(automaticCount === 2
        ? "Both physical cards found. Move only points that need correction."
        : `${automaticCount}/2 physical cards found. Set the visible manual start points where needed.`);
    } catch (error) {
      if (activeImageRequest.current === controller) {
        setWorkflowError(error instanceof Error ? error.message : "Speedster could not prepare these photos.");
        setMessage(recaptureSide
          ? `The ${recaptureSide === "FRONT" ? "Front" : "Back"} rerun did not finish. Its replacement photo and the completed sibling side are preserved; retry when ready.`
          : "Set geometry did not finish. Both original photos are preserved; retry when ready.");
      }
    } finally {
      if (activeImageRequest.current === controller) {
        activeImageRequest.current = null;
        setWorking(false);
      }
      captureActionInFlight.current = false;
    }
  };

  const finishMapRegistrationFlow = (input: Readonly<{
    frontState: SideState;
    backState: SideState;
    provisional: RegistrationRescueState["provisional"];
    failureSides?: Partial<Record<SpeedsterCardSide, true>>;
    notice?: string | null;
    resumeCenteringSide?: SpeedsterCardSide;
    instrumentationSides?: readonly SpeedsterCardSide[];
    instrumentationStartedAtMs?: number;
  }>) => {
    currentRegistrationOperationId.current ??= crypto.randomUUID();
    const failureSides = input.failureSides ?? {};
    const hasFailure = Boolean(failureSides.FRONT || failureSides.BACK);
    const hasBothRegistrations = Boolean(input.provisional.FRONT && input.provisional.BACK);
    if (hasBothRegistrations && (
      input.provisional.FRONT!.mapRevisionId !== activeMapRevisionId
      || input.provisional.BACK!.mapRevisionId !== activeMapRevisionId
    )) {
      throw new Error("Both registered sides must validate against the same immutable CARD MAP revision.");
    }
    if (!hasFailure && activeMapRevisionId && !hasBothRegistrations) {
      throw new Error("A selected CARD MAP requires validated Front + Back registration before application.");
    }
    const frontRegistration = hasBothRegistrations ? input.provisional.FRONT : undefined;
    const backRegistration = hasBothRegistrations ? input.provisional.BACK : undefined;
    const finalFront = frontRegistration
      ? withMapRegistration(input.frontState, frontRegistration)
      : { ...input.frontState, mapRegistration: undefined };
    const finalBack = backRegistration
      ? withMapRegistration(input.backState, backRegistration)
      : { ...input.backState, mapRegistration: undefined };
    const endedAtMs = Date.now();
    setFront(finalFront);
    setBack(finalBack);
    setRegistrationInterruption(null);
    setRegistrationRescue(null);
    setCorrectedAnchorDrafts({});
    setStage(input.resumeCenteringSide === "BACK" ? "BACK_CENTERING" : "FRONT_CENTERING");
    setRecaptureSide(null);
    stageStartedAt.current = endedAtMs;
    registrationFailureSides.current = failureSides;
    mapRegistrationFailed.current = hasFailure;
    if (!hasBothRegistrations) registrationRecordedAtMs.current = {};
    if (input.notice !== undefined) setMapRegistrationNotice(input.notice);
    const detail = (
      side: SpeedsterCardSide,
      registration?: SpeedsterMapRegistration,
    ): NonNullable<SpeedsterCaptureInstrumentationEvent["details"]> => ({
      side,
      mapAppliedScope: hasBothRegistrations ? (activeMapScope ?? "EXACT") : "NONE",
      ...(hasBothRegistrations && activeMapName ? { mapName: activeMapName } : {}),
      ...(registration ? { mapRevisionId: registration.mapRevisionId } : {}),
      ...(failureSides[side]
        ? { mapFailureCode: "REGISTRATION_FAILED" as const }
        : mapLookupFailed
          ? { mapFailureCode: "LOOKUP_FAILED" as const }
          : {}),
    });
    const frontTiming = frontGeometryTiming.current ?? { startedAtMs: stageStartedAt.current, endedAtMs };
    const instrumentationSides = input.instrumentationSides ?? (["FRONT", "BACK"] as const);
    if (instrumentationSides.includes("FRONT")) {
      onInstrumentationEvent?.({
        eventType: "GEOMETRY_CONFIRMED",
        startedAtMs: input.instrumentationStartedAtMs ?? frontTiming.startedAtMs,
        endedAtMs: input.instrumentationStartedAtMs === undefined ? frontTiming.endedAtMs : endedAtMs,
        details: detail("FRONT", frontRegistration),
      });
    }
    if (instrumentationSides.includes("BACK")) {
      onInstrumentationEvent?.({
        eventType: "GEOMETRY_CONFIRMED",
        startedAtMs: input.instrumentationStartedAtMs ?? frontTiming.endedAtMs,
        endedAtMs,
        details: detail("BACK", backRegistration),
      });
    }
    setMessage(input.resumeCenteringSide
      ? `Confirm only the recomputed ${input.resumeCenteringSide === "FRONT" ? "Front" : "Back"} printed-border geometry. The sibling side remains confirmed.`
      : "Confirm the printed-border geometry.");
  };

  const continueRegistrationWithoutMap = async () => {
    if (working || !front || !back || (!registrationInterruption && !registrationRescue)) return;
    const failures = registrationInterruption
      ? registrationFailureEvidence(
          registrationInterruption.interruptions,
          registrationInterruption.failures,
          registrationInterruption.failureRequestIds,
        )
      : registrationRescue
        ? registrationFailureEvidence({}, registrationRescue.failures, registrationRescue.failureRequestIds)
        : [];
    if (failures.length === 0) {
      setWorkflowError("No durable Card Map failure is available for human-review continuation.");
      return;
    }
    const decisionId = registrationInterruption?.decisionIds.continue
      ?? registrationRescue?.continueDecisionId
      ?? crypto.randomUUID();
    const operationId = registrationInterruption?.operationId
      ?? registrationRescue?.operationId
      ?? currentRegistrationOperationId.current;
    setWorking(true);
    setWorkflowError(null);
    try {
      const { response, payload } = await runSpeedsterImageRequest(
        "Card Map human-review decision",
        { timeoutMs: imageRequestTimeoutMs },
        async (signal) => {
          const response = await fetch(
            `/api/admin/ai-grader-v2/sessions/${encodeURIComponent(sessionId)}/map-authority`,
            {
              method: "POST",
              headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
              body: JSON.stringify({ action: "CONTINUE_WITHOUT_MAP", decisionId }),
              cache: "no-store",
              signal,
            },
          );
          const payload = await response.json().catch(() => ({})) as {
            authority?: { status?: string; message?: string };
            message?: string;
          };
          return { response, payload };
        },
      );
      if (!response.ok || payload.authority?.status !== "HUMAN_REVIEW_WITHOUT_MAP") {
        throw new Error(payload.message ?? payload.authority?.message ?? "Human-review continuation was not recorded.");
      }
      mapAuthorityAbandoned.current = true;
      registrationRecordedAtMs.current = {};
      const failureSides = Object.fromEntries(failures.map(({ side }) => [side, true])) as Partial<Record<SpeedsterCardSide, true>>;
      onInstrumentationEvent?.({
        eventId: decisionId,
        eventType: "MAP_AUTHORITY_OPERATOR_DECISION",
        startedAtMs: Date.now(),
        endedAtMs: Date.now(),
        details: {
          mapAppliedScope: "NONE",
          mapAuthorityDecisionId: decisionId,
          ...(operationId ? { mapAuthorityOperationId: operationId } : {}),
          registrationFailedSides: failures.map(({ side }) => side),
          registrationFailures: failures,
        },
      });
      finishMapRegistrationFlow({
        frontState: { ...front, mapRegistration: undefined },
        backState: { ...back, mapRegistration: undefined },
        provisional: {},
        failureSides,
        notice: "HUMAN REVIEW · Card Map failure retained · no map or projected zones applied.",
      });
      setMessage("Card Map failure is preserved. Continue with human centering; no map, fallback map, or guessed zones will be applied.");
    } catch (error) {
      setWorkflowError(`${error instanceof Error ? error.message : "Human-review continuation was not recorded."} All photos, geometry, and registration evidence remain preserved.`);
    } finally {
      setWorking(false);
    }
  };

  const appendAuditReconciliationNotice = (notice: AuditReconciliationNotice) => {
    setAuditReconciliationNotices((current) => (
      current.some(({ noticeId }) => noticeId === notice.noticeId)
        ? current
        : [...current, notice]
    ));
  };

  const surfaceRegistrationAuditWarning = (operationId: string, values: readonly unknown[]) => {
    const originatingSessionId = sessionId;
    const requestIds = Array.from(new Set(values.flatMap((value) => {
      const warning = registrationAuditWarningFrom(value);
      return warning ? [warning.requestId] : [];
    }))).sort();
    if (requestIds.length === 0 || !isCurrentSpeedsterRegistrationDecisionAudit({
      currentSessionId: currentSessionId.current,
      currentOperationId: currentRegistrationOperationId.current,
      originatingSessionId,
      originatingOperationId: operationId,
    })) return;
    requestIds.forEach((requestId) => appendAuditReconciliationNotice({
      noticeId: `attempt:${operationId}:${requestId}`,
      message: `CARD MAP attempt audit write failed for request ${requestId}. The registration result and all operator work are preserved; retain operation ${operationId} for reconciliation.`,
    }));
  };

  const confirmGeometry = async (side: SpeedsterCardSide) => {
    const current = side === "FRONT" ? front : back;
    if (!current || working || captureActionInFlight.current) return;
    const currentCorners = sanitizeSpeedsterUnitQuad(current.corners);
    if (!currentCorners) {
      setWorkflowError(`Place all four ${side === "FRONT" ? "Front" : "Back"} physical corners before confirming geometry.`);
      return;
    }
    captureActionInFlight.current = true;
    activeImageRequest.current?.abort();
    const controller = new AbortController();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage(`Preparing the ${side.toLowerCase()} card map.`);
    try {
      const freshSourceUrl = await fetchSpeedsterOriginalImageUrl({
        token,
        sessionId,
        side,
        storageKey: current.originalStorageKey,
        signal: controller.signal,
        timeoutMs: imageRequestTimeoutMs,
      });
      if (activeImageRequest.current !== controller) return;
      const installSourceUrl = (value: SideState | null) => value?.originalStorageKey === current.originalStorageKey
        ? { ...value, sourceUrl: freshSourceUrl }
        : value;
      side === "FRONT" ? setFront(installSourceUrl) : setBack(installSourceUrl);
      const outputPlan = await planSpeedsterPreparedOutputs({
        token,
        sessionId,
        side,
        sourceImageStorageKey: current.originalStorageKey,
        signal: controller.signal,
        timeoutMs: imageRequestTimeoutMs,
      });
      const prepared = await speedsterImageService.prepare(
        token,
        freshSourceUrl,
        {
          sessionId,
          side,
          sourceImageStorageKey: current.originalStorageKey,
        },
        currentCorners,
        current.matColor,
        { signal: controller.signal, timeoutMs: imageRequestTimeoutMs },
      );
      if (activeImageRequest.current !== controller) return;
      const next: SideState = {
        ...current,
        sourceUrl: freshSourceUrl,
        rectifiedUrl: outputPlan.RECTIFIED.readUrl,
        rectifiedImageRevision: 0,
        rectifiedStorageKey: outputPlan.RECTIFIED.storageKey,
        inspectionUrl: outputPlan.INSPECTION.readUrl,
        inspectionStorageKey: outputPlan.INSPECTION.storageKey,
        inspectionFrame: prepared.inspectionFrame,
        transform: prepared.transform,
        proposedCentering: speedsterColorCenteringDraft(prepared.colorGeometry, prepared.borders),
        detectedBorders: prepared.detectedBorders,
        printedColorGeometry: prepared.colorGeometry,
        printedColorGeometryReceipt: prepared.colorGeometryReceipt,
        mapRegistration: undefined,
        views: {
          NORMALIZED: outputPlan.NORMALIZED.readUrl,
          MICRO_DEFECT: outputPlan.MICRO_DEFECT.readUrl,
          DIRECTIONAL: outputPlan.DIRECTIONAL.readUrl,
        },
        viewStorageKeys: {
          NORMALIZED: outputPlan.NORMALIZED.storageKey,
          MICRO_DEFECT: outputPlan.MICRO_DEFECT.storageKey,
          DIRECTIONAL: outputPlan.DIRECTIONAL.storageKey,
        },
      };
      const preparedAtMs = Date.now();
      if (recaptureSide === side) {
        const siblingSide: SpeedsterCardSide = side === "FRONT" ? "BACK" : "FRONT";
        const sibling = siblingSide === "FRONT" ? front : back;
        if (!sibling?.rectifiedUrl || !sibling.proposedCentering) {
          throw new Error(`The retained ${siblingSide === "FRONT" ? "Front" : "Back"} preparation is unavailable. Its evidence was not changed.`);
        }
        let targetRegistration: SpeedsterMapRegistration | undefined;
        const siblingRegistration = sibling.mapRegistration;
        if (activeMapRevisionId) {
          if (siblingRegistration?.mapRevisionId !== activeMapRevisionId) {
            throw new Error(`The retained ${siblingSide === "FRONT" ? "Front" : "Back"} registration is unavailable or no longer matches the pinned CARD MAP revision.`);
          }
          const operationId = crypto.randomUUID();
          currentRegistrationOperationId.current = operationId;
          const registerTarget = (attemptNumber: number, trigger: "INITIAL" | "AUTOMATIC_RETRY") => (
            speedsterImageService.registerMap(token, {
              sessionId,
              side,
              currentPhysicalQuad: currentCorners,
              currentOriginalStorageKey: next.originalStorageKey,
              currentInspectionStorageKey: next.inspectionStorageKey!,
              orchestration: {
                operationId,
                attemptNumber,
                trigger,
                successfulSiblingPreservedAtAttemptStart: true,
              },
            }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs })
          );
          let result = await Promise.allSettled([registerTarget(1, "INITIAL")]).then(([value]) => value);
          const auditResults: PromiseSettledResult<SpeedsterMapRegistration>[] = [result];
          let attemptNumber = 1;
          if (result.status === "rejected" && isAutomaticSpeedsterMapRegistrationRetryEligible(result.reason)) {
            attemptNumber = 2;
            setMapRegistrationNotice(
              `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} registration was interrupted on ${side}. Retrying only that side once; the completed ${siblingSide === "FRONT" ? "Front" : "Back"} registration remains provisional.`,
            );
            setMessage(`Visible automatic retry 1/1 for ${side.toLowerCase()} Card Map registration.`);
            result = await Promise.allSettled([registerTarget(2, "AUTOMATIC_RETRY")]).then(([value]) => value);
            auditResults.push(result);
          }
          if (activeImageRequest.current !== controller) return;
          surfaceRegistrationAuditWarning(
            operationId,
            auditResults.map((value) => value.status === "fulfilled" ? value.value : value.reason),
          );
          if (result.status === "fulfilled") {
            targetRegistration = result.value;
            if (targetRegistration.mapRevisionId !== activeMapRevisionId) {
              throw new Error("The selected CARD MAP changed while the replacement side was being registered.");
            }
            registrationRecordedAtMs.current[side] = Date.now();
          } else {
            const targetState = { ...next, mapRegistration: undefined };
            side === "FRONT" ? setFront(targetState) : setBack(targetState);
            const durableFailureEvidence = result.reason instanceof SpeedsterMapRegistrationError
              ? registrationFailureEvidence(
                  {},
                  { [side]: result.reason.failure },
                  result.reason.requestId ? { [side]: result.reason.requestId } : {},
                )
              : registrationFailureEvidence({ [side]: registrationInterruptionFrom(result.reason) }, {}, {});
            await persistRegistrationBlock(operationId, durableFailureEvidence);
            if (result.reason instanceof SpeedsterMapRegistrationError) {
              setRegistrationRescue({
                failures: { [side]: result.reason.failure },
                failureRequestIds: result.reason.requestId
                  ? { [side]: result.reason.requestId }
                  : {},
                provisional: { [siblingSide]: siblingRegistration },
                attemptIds: { [side]: crypto.randomUUID() },
                operationId,
                attemptNumbers: { [side]: attemptNumber },
                continueDecisionId: crypto.randomUUID(),
              });
              setStage("MAP_REGISTRATION_RESCUE");
              setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} is provisional. Correct only the replacement ${side} anchors; the ${siblingSide} registration remains retained and is not rerun.`);
              setMessage("Correct the replacement side's Card Map registration anchors. The sibling side remains preserved.");
            } else {
              const interruption = registrationInterruptionFrom(result.reason);
              setRegistrationInterruption({
                interruptions: { [side]: interruption },
                failures: {},
                failureRequestIds: interruption.failure.requestId
                  ? { [side]: interruption.failure.requestId }
                  : {},
                provisional: { [siblingSide]: siblingRegistration },
                operationId,
                attemptNumbers: { [side]: attemptNumber },
                decisionIds: registrationDecisionIds({ [side]: interruption }),
              });
              setStage("MAP_REGISTRATION_INTERRUPTED");
              setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} registration is interrupted only on replacement ${side}. The ${siblingSide} registration remains retained and is not rerun.`);
              setMessage("Retry the failed side. Card Map authority remains blocked and cannot fall back to mapless review.");
            }
            return;
          }
        }
        const finalFront = side === "FRONT" ? next : sibling;
        const finalBack = side === "BACK" ? next : sibling;
        finishMapRegistrationFlow({
          frontState: finalFront,
          backState: finalBack,
          provisional: activeMapRevisionId ? {
            [side]: targetRegistration,
            [siblingSide]: siblingRegistration,
          } : {},
          notice: activeMapRevisionId
            ? `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} replacement ${side} registration is verified; the ${siblingSide} registration was retained byte-for-byte.`
            : undefined,
          resumeCenteringSide: side,
          instrumentationSides: [side],
          instrumentationStartedAtMs: stageStartedAt.current,
        });
        return;
      }
      if (side === "FRONT") {
        setFront(next);
        setStage("BACK_GEOMETRY");
        frontGeometryTiming.current = { startedAtMs: stageStartedAt.current, endedAtMs: preparedAtMs };
        stageStartedAt.current = preparedAtMs;
        setMessage("Confirm the back geometry.");
        return;
      }

      if (!front?.rectifiedUrl || !front.proposedCentering || !front.corners) {
        throw new Error("Front geometry must be prepared before Back geometry.");
      }
      const frontCorners = front.corners;
      let finalFront: SideState = { ...front, mapRegistration: undefined };
      let finalBack: SideState = { ...next, mapRegistration: undefined };
      let frontRegistration: SpeedsterMapRegistration | undefined;
      let backRegistration: SpeedsterMapRegistration | undefined;
      if (activeMapRevisionId) {
        const operationId = crypto.randomUUID();
        currentRegistrationOperationId.current = operationId;
        const attemptNumbers: Partial<Record<SpeedsterCardSide, number>> = { FRONT: 1, BACK: 1 };
        const registerSide = (
          candidate: SpeedsterCardSide,
          currentPhysicalQuad: SpeedsterQuad,
          currentInspectionStorageKey: string,
          orchestration: SpeedsterMapRegistrationOrchestration,
        ) => speedsterImageService.registerMap(token, {
          sessionId,
          side: candidate,
          currentPhysicalQuad,
          currentOriginalStorageKey: candidate === "FRONT" ? front.originalStorageKey : next.originalStorageKey,
          currentInspectionStorageKey,
          orchestration,
        }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs }).then((registration) => {
          if (activeImageRequest.current === controller && currentSessionId.current === sessionId) {
            registrationRecordedAtMs.current[candidate] = Date.now();
          }
          return registration;
        });
        const initialResults = await Promise.allSettled([
          registerSide("FRONT", frontCorners, front.inspectionStorageKey!, {
            operationId,
            attemptNumber: 1,
            trigger: "INITIAL",
            successfulSiblingPreservedAtAttemptStart: false,
          }),
          registerSide("BACK", currentCorners, next.inspectionStorageKey!, {
            operationId,
            attemptNumber: 1,
            trigger: "INITIAL",
            successfulSiblingPreservedAtAttemptStart: false,
          }),
        ]);
        if (activeImageRequest.current !== controller) return;
        const retrySides = (["FRONT", "BACK"] as const).filter((candidate) => {
          const result = initialResults[candidate === "FRONT" ? 0 : 1];
          return result.status === "rejected"
            && isAutomaticSpeedsterMapRegistrationRetryEligible(result.reason);
        });
        let results: [typeof initialResults[0], typeof initialResults[1]] = [...initialResults];
        const auditResults: Array<(typeof initialResults)[number]> = [...initialResults];
        if (retrySides.length > 0) {
          const requestIds = retrySides.flatMap((candidate) => {
            const result = initialResults[candidate === "FRONT" ? 0 : 1];
            return result.status === "rejected"
              && result.reason instanceof SpeedsterMapRegistrationRequestError
              && result.reason.failure.requestId
              ? [result.reason.failure.requestId]
              : [];
          });
          setMapRegistrationNotice(
            `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} registration was interrupted on ${retrySides.join(" + ")}. Retrying only ${retrySides.length === 1 ? "that side" : "those sides"} once${requestIds.length ? ` after request ${requestIds.join(" + ")}` : ""}; completed sibling work is preserved.`,
          );
          setMessage(`Visible automatic retry 1/1 for ${retrySides.join(" + ").toLowerCase()} Card Map registration.`);
          const retried = await Promise.allSettled(retrySides.map((candidate) => {
            attemptNumbers[candidate] = 2;
            const sibling = candidate === "FRONT" ? initialResults[1] : initialResults[0];
            return registerSide(
              candidate,
              candidate === "FRONT" ? frontCorners : currentCorners,
              candidate === "FRONT" ? front.inspectionStorageKey! : next.inspectionStorageKey!,
              {
              operationId,
              attemptNumber: 2,
              trigger: "AUTOMATIC_RETRY",
              successfulSiblingPreservedAtAttemptStart: sibling.status === "fulfilled",
              },
            );
          }));
          auditResults.push(...retried);
          retrySides.forEach((candidate, index) => {
            results[candidate === "FRONT" ? 0 : 1] = retried[index];
          });
        }
        if (activeImageRequest.current !== controller) return;
        surfaceRegistrationAuditWarning(
          operationId,
          auditResults.map((result) => result.status === "fulfilled" ? result.value : result.reason),
        );
        const frontResult = results[0];
        const backResult = results[1];
        if (frontResult.status === "fulfilled" && backResult.status === "fulfilled") {
          frontRegistration = frontResult.value;
          backRegistration = backResult.value;
          if (
            frontRegistration.mapRevisionId !== activeMapRevisionId
            || backRegistration.mapRevisionId !== activeMapRevisionId
          ) throw new Error("The selected CARD MAP changed while geometry was being registered.");
          finalFront = withMapRegistration(finalFront, frontRegistration);
          finalBack = withMapRegistration(finalBack, backRegistration);
        } else {
          const failures: RegistrationRescueState["failures"] = {
            ...(frontResult.status === "rejected" && frontResult.reason instanceof SpeedsterMapRegistrationError
              ? { FRONT: frontResult.reason.failure }
              : {}),
            ...(backResult.status === "rejected" && backResult.reason instanceof SpeedsterMapRegistrationError
              ? { BACK: backResult.reason.failure }
              : {}),
          };
          const failureRequestIds: RegistrationRescueState["failureRequestIds"] = {
            ...(frontResult.status === "rejected"
              && frontResult.reason instanceof SpeedsterMapRegistrationError
              && frontResult.reason.requestId
              ? { FRONT: frontResult.reason.requestId }
              : {}),
            ...(backResult.status === "rejected"
              && backResult.reason instanceof SpeedsterMapRegistrationError
              && backResult.reason.requestId
              ? { BACK: backResult.reason.requestId }
              : {}),
          };
          const provisional: RegistrationRescueState["provisional"] = {
            ...(frontResult.status === "fulfilled" ? { FRONT: frontResult.value } : {}),
            ...(backResult.status === "fulfilled" ? { BACK: backResult.value } : {}),
          };
          const interruptions: RegistrationInterruptionState["interruptions"] = {
            ...(frontResult.status === "rejected" && !(frontResult.reason instanceof SpeedsterMapRegistrationError)
              ? { FRONT: registrationInterruptionFrom(frontResult.reason) }
              : {}),
            ...(backResult.status === "rejected" && !(backResult.reason instanceof SpeedsterMapRegistrationError)
              ? { BACK: registrationInterruptionFrom(backResult.reason) }
              : {}),
          };
          await persistRegistrationBlock(
            operationId,
            registrationFailureEvidence(interruptions, failures, failureRequestIds),
          );
          if (interruptions.FRONT || interruptions.BACK) {
            setFront(finalFront);
            setBack(finalBack);
            setRegistrationInterruption({
              interruptions,
              failures,
              failureRequestIds,
              provisional,
              operationId,
              attemptNumbers,
              decisionIds: registrationDecisionIds(interruptions),
            });
            setStage("MAP_REGISTRATION_INTERRUPTED");
            setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} registration is interrupted. Completed side work and valid anchor diagnostics are retained provisionally; no map is applied.`);
            setMessage("Retry or correct every failed side. Card Map authority remains blocked and cannot fall back to mapless review.");
            return;
          }
          if (failures.FRONT || failures.BACK) {
            setFront(finalFront);
            setBack(finalBack);
            setRegistrationRescue({
              failures,
              failureRequestIds,
              provisional,
              attemptIds: {
                ...(failures.FRONT ? { FRONT: crypto.randomUUID() } : {}),
                ...(failures.BACK ? { BACK: crypto.randomUUID() } : {}),
              },
              operationId,
              attemptNumbers,
              continueDecisionId: crypto.randomUUID(),
            });
            setStage("MAP_REGISTRATION_RESCUE");
            setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} is provisional. Correct the marked anchor${failures.FRONT && failures.BACK ? "s on each side" : ""}; neither side is applied yet.`);
            setMessage("Correct the Card Map registration anchors. Your photos and geometry are preserved.");
            return;
          }
        }
      }
      finishMapRegistrationFlow({
        frontState: finalFront,
        backState: finalBack,
        provisional: {
          ...(frontRegistration ? { FRONT: frontRegistration } : {}),
          ...(backRegistration ? { BACK: backRegistration } : {}),
        },
        notice: activeMapRevisionId
          ? `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} applied to Front + Back.`
          : undefined,
      });
    } catch (error) {
      if (activeImageRequest.current === controller) {
        setWorkflowError(error instanceof Error ? error.message : "Speedster image preparation failed.");
        setMessage(`${side === "FRONT" ? "Front" : "Back"} preparation did not finish. Your original photos and geometry are preserved; retry when ready.`);
      }
    } finally {
      if (activeImageRequest.current === controller) {
        activeImageRequest.current = null;
        setWorking(false);
      }
      captureActionInFlight.current = false;
    }
  };

  const finishRegistrationRescue = (
    provisional: RegistrationRescueState["provisional"],
    exactAttemptNumbers: Partial<Record<SpeedsterCardSide, number>> = registrationRescue?.attemptNumbers ?? {},
  ) => {
    if (!front || !back) return;
    const touchedSides = (["FRONT", "BACK"] as const).filter((side) => (
      exactAttemptNumbers[side] !== undefined
    ));
    finishMapRegistrationFlow({
      frontState: front,
      backState: back,
      provisional,
      notice: `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} was human-corrected, server-validated, and is ready for Front + Back application.`,
      ...(recaptureSide ? {
        resumeCenteringSide: recaptureSide,
        instrumentationSides: touchedSides,
        instrumentationStartedAtMs: stageStartedAt.current,
      } : {}),
    });
  };

  const recordRegistrationDecision = (
    decisionId: string,
    operationId: string,
    decision: "RETRY_FAILED_SIDE",
    failureEvidence: readonly RegistrationFailureEvidence[],
  ) => {
    const originatingSessionId = sessionId;
    const failedSides = failureEvidence.map(({ side }) => side);
    const atMs = Date.now();
    const surfaceDecisionAuditWarning = (message: string) => {
      if (!isCurrentSpeedsterRegistrationDecisionAudit({
        currentSessionId: currentSessionId.current,
        currentOperationId: currentRegistrationOperationId.current,
        originatingSessionId,
        originatingOperationId: operationId,
      })) return;
      appendAuditReconciliationNotice({
        noticeId: `decision:${operationId}:${decisionId}`,
        message,
      });
    };
    if (!onInstrumentationEvent) {
      surfaceDecisionAuditWarning(`Operator-decision audit reporter is unavailable for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`);
      return;
    }
    let result: void | boolean | Promise<void | boolean>;
    try {
      result = onInstrumentationEvent({
        eventId: decisionId,
        eventType: "MAP_REGISTRATION_OPERATOR_DECISION",
        startedAtMs: atMs,
        endedAtMs: atMs,
        details: {
          registrationDecision: decision,
          registrationOperationId: operationId,
          registrationDecisionId: decisionId,
          registrationFailedSides: failedSides,
          registrationFailures: failureEvidence,
          ...(failedSides.length === 1 ? { side: failedSides[0] } : {}),
          ...(failureEvidence[0] ? {
            registrationErrorSource: failureEvidence[0].source,
            registrationErrorCode: failureEvidence[0].code,
            ...(failureEvidence[0].httpStatus !== null
              ? { registrationHttpStatus: failureEvidence[0].httpStatus }
              : {}),
            ...(failureEvidence[0].requestId
              ? { registrationRequestId: failureEvidence[0].requestId }
              : {}),
          } : {}),
        },
      });
    } catch {
      surfaceDecisionAuditWarning(`Operator-decision audit write failed for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`);
      return;
    }
    void settleSpeedsterRegistrationDecisionAuditConfirmation(
      result,
      decisionAuditConfirmationTimeoutMs,
    ).then((outcome) => {
      if (outcome === "CONFIRMED") return;
      surfaceDecisionAuditWarning(outcome === "TIMED_OUT"
        ? `Operator-decision audit write was not confirmed within ${decisionAuditConfirmationTimeoutMs} ms for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`
        : `Operator-decision audit write failed for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`);
    });
  };

  const retryInterruptedRegistration = async (side: SpeedsterCardSide) => {
    if (!registrationInterruption || !front || !back || working || registrationActionInFlight.current) return;
    if (!front.corners || !back.corners) return;
    if (!registrationInterruption.interruptions[side]) return;
    const priorInterruption = registrationInterruption.interruptions[side]!;
    const decisionId = registrationInterruption.decisionIds.retry[side]!;
    const attemptNumber = (registrationInterruption.attemptNumbers[side] ?? 0) + 1;
    const attemptNumbers = { ...registrationInterruption.attemptNumbers, [side]: attemptNumber };
    registrationActionInFlight.current = true;
    recordRegistrationDecision(
      decisionId,
      registrationInterruption.operationId,
      "RETRY_FAILED_SIDE",
      registrationFailureEvidence(
        registrationInterruption.interruptions,
        registrationInterruption.failures,
        registrationInterruption.failureRequestIds,
        [side],
      ),
    );
    const controller = new AbortController();
    activeImageRequest.current?.abort();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage(`Retrying only the failed ${side.toLowerCase()} Card Map registration. Completed sibling work remains provisional.`);
    try {
      const sideState = side === "FRONT" ? front : back;
      if (!sideState.inspectionStorageKey) throw new Error(`The prepared ${side.toLowerCase()} inspection image is unavailable.`);
      const registration = await speedsterImageService.registerMap(token, {
        sessionId,
        side,
        currentPhysicalQuad: side === "FRONT" ? front.corners : back.corners,
        currentOriginalStorageKey: sideState.originalStorageKey,
        currentInspectionStorageKey: sideState.inspectionStorageKey,
        orchestration: {
          operationId: registrationInterruption.operationId,
          attemptNumber,
          trigger: "MANUAL_RETRY",
          successfulSiblingPreservedAtAttemptStart: Boolean(registrationInterruption.provisional[side === "FRONT" ? "BACK" : "FRONT"]),
        },
      }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      if (activeImageRequest.current !== controller) return;
      registrationRecordedAtMs.current[side] = Date.now();
      surfaceRegistrationAuditWarning(registrationInterruption.operationId, [registration]);
      const interruptions = { ...registrationInterruption.interruptions };
      delete interruptions[side];
      const provisional = { ...registrationInterruption.provisional, [side]: registration };
      const nextState: RegistrationInterruptionState = {
        interruptions,
        failures: registrationInterruption.failures,
        failureRequestIds: registrationInterruption.failureRequestIds,
        provisional,
        operationId: registrationInterruption.operationId,
        attemptNumbers,
        decisionIds: registrationDecisionIds(interruptions),
      };
      const remainingFailureEvidence = registrationFailureEvidence(
        interruptions,
        nextState.failures,
        nextState.failureRequestIds,
      );
      if (remainingFailureEvidence.length) {
        await persistRegistrationBlock(nextState.operationId, remainingFailureEvidence);
      }
      if (interruptions.FRONT || interruptions.BACK) {
        setRegistrationInterruption(nextState);
        setMessage("That side registered successfully and remains provisional. Resolve the remaining failed side.");
      } else if (nextState.failures.FRONT || nextState.failures.BACK) {
        setRegistrationInterruption(null);
        setRegistrationRescue({
          failures: nextState.failures,
          failureRequestIds: nextState.failureRequestIds,
          provisional,
          attemptIds: {
            ...(nextState.failures.FRONT ? { FRONT: crypto.randomUUID() } : {}),
            ...(nextState.failures.BACK ? { BACK: crypto.randomUUID() } : {}),
          },
          operationId: nextState.operationId,
          attemptNumbers,
          continueDecisionId: crypto.randomUUID(),
        });
        setStage("MAP_REGISTRATION_RESCUE");
        setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} is provisional. Correct the retained anchor diagnostics; neither side is applied yet.`);
        setMessage("The infrastructure interruption is resolved. Correct the Card Map registration anchors.");
      } else {
        finishMapRegistrationFlow({
          frontState: front,
          backState: back,
          provisional,
          notice: `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} applied to Front + Back after the operator retry.`,
          ...(recaptureSide ? {
            resumeCenteringSide: recaptureSide,
            instrumentationSides: (["FRONT", "BACK"] as const).filter((candidate) => (
              attemptNumbers[candidate] !== undefined || nextState.failures[candidate]
            )),
            instrumentationStartedAtMs: stageStartedAt.current,
          } : {}),
        });
      }
    } catch (error) {
      if (activeImageRequest.current !== controller) return;
      surfaceRegistrationAuditWarning(registrationInterruption.operationId, [error]);
      const interruptions = { ...registrationInterruption.interruptions };
      const failures = { ...registrationInterruption.failures };
      const failureRequestIds = { ...registrationInterruption.failureRequestIds };
      if (error instanceof SpeedsterMapRegistrationError) {
        delete interruptions[side];
        failures[side] = error.failure;
        if (error.requestId) failureRequestIds[side] = error.requestId;
        else delete failureRequestIds[side];
      } else {
        interruptions[side] = registrationInterruptionFrom(error);
      }
      const nextState: RegistrationInterruptionState = {
        interruptions,
        failures,
        failureRequestIds,
        provisional: registrationInterruption.provisional,
        operationId: registrationInterruption.operationId,
        attemptNumbers,
        decisionIds: registrationDecisionIds(interruptions),
      };
      if (interruptions.FRONT || interruptions.BACK) {
        setRegistrationInterruption(nextState);
        setMessage("The failed side is still interrupted. Retry it again, or explicitly continue through human review without applying the map.");
      } else {
        setRegistrationInterruption(null);
        setRegistrationRescue({
          failures,
          failureRequestIds,
          provisional: registrationInterruption.provisional,
          attemptIds: {
            ...(failures.FRONT ? { FRONT: crypto.randomUUID() } : {}),
            ...(failures.BACK ? { BACK: crypto.randomUUID() } : {}),
          },
          operationId: registrationInterruption.operationId,
          attemptNumbers,
          continueDecisionId: crypto.randomUUID(),
        });
        setStage("MAP_REGISTRATION_RESCUE");
        setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} is provisional. The retry returned valid anchor diagnostics; neither side is applied yet.`);
        setMessage("Correct the Card Map registration anchors. Your photos and geometry are preserved.");
      }
    } finally {
      if (activeImageRequest.current === controller) {
        activeImageRequest.current = null;
        setWorking(false);
      }
      registrationActionInFlight.current = false;
    }
  };

  const confirmRegistrationRescue = async (
    side: SpeedsterCardSide,
    correctedAnchors: readonly Readonly<{ anchorId: string; point: { x: number; y: number } }>[],
  ) => {
    if (!registrationRescue || working || !front || !back || registrationActionInFlight.current) return;
    if (!front.corners || !back.corners) return;
    const failure = registrationRescue.failures[side];
    if (!failure) return;
    const attemptNumber = (registrationRescue.attemptNumbers[side] ?? 0) + 1;
    const attemptNumbers = { ...registrationRescue.attemptNumbers, [side]: attemptNumber };
    registrationActionInFlight.current = true;
    const controller = new AbortController();
    activeImageRequest.current?.abort();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage(`Validating and saving the corrected ${side.toLowerCase()} anchors.`);
    try {
      const sideState = side === "FRONT" ? front : back;
      if (!sideState.inspectionStorageKey) throw new Error(`The prepared ${side.toLowerCase()} inspection image is unavailable.`);
      const registration = await speedsterImageService.rescueMapRegistration(token, {
        sessionId,
        side,
        currentPhysicalQuad: side === "FRONT" ? front.corners : back.corners,
        currentOriginalStorageKey: sideState.originalStorageKey,
        currentInspectionStorageKey: sideState.inspectionStorageKey,
        rescueAttemptId: registrationRescue.attemptIds[side]!,
        automaticFailure: failure,
        correctedAnchors,
        orchestration: {
          operationId: registrationRescue.operationId,
          attemptNumber,
          trigger: "HUMAN_RESCUE",
          successfulSiblingPreservedAtAttemptStart: Boolean(registrationRescue.provisional[side === "FRONT" ? "BACK" : "FRONT"]),
        },
      }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      if (activeImageRequest.current !== controller) return;
      registrationRecordedAtMs.current[side] = Date.now();
      surfaceRegistrationAuditWarning(registrationRescue.operationId, [registration]);
      const failures = { ...registrationRescue.failures };
      const failureRequestIds = { ...registrationRescue.failureRequestIds };
      const attemptIds = { ...registrationRescue.attemptIds };
      delete failures[side];
      delete failureRequestIds[side];
      delete attemptIds[side];
      setCorrectedAnchorDrafts((current) => {
        const next = { ...current };
        delete next[side];
        return next;
      });
      const provisional = { ...registrationRescue.provisional, [side]: registration };
      if (failures.FRONT || failures.BACK) {
        setRegistrationRescue({
          failures,
          failureRequestIds,
          provisional,
          attemptIds,
          operationId: registrationRescue.operationId,
          attemptNumbers,
          continueDecisionId: registrationRescue.continueDecisionId,
        });
        setMessage("That side is saved. Correct the remaining side; neither map side is applied yet.");
      } else {
        finishRegistrationRescue(provisional, attemptNumbers);
      }
    } catch (error) {
      if (activeImageRequest.current !== controller) return;
      surfaceRegistrationAuditWarning(registrationRescue.operationId, [error]);
      setRegistrationRescue({ ...registrationRescue, attemptNumbers });
      await persistRegistrationBlock(
        registrationRescue.operationId,
        registrationFailureEvidence({}, registrationRescue.failures, registrationRescue.failureRequestIds),
      );
      setMessage(`The corrected ${side.toLowerCase()} anchors were not saved. Your positions are preserved; retry.`);
      throw error;
    } finally {
      if (activeImageRequest.current === controller) {
        activeImageRequest.current = null;
        setWorking(false);
      }
      registrationActionInFlight.current = false;
    }
  };

  const confirmCentering = async (result: CenteringAssistResult) => {
    if (readyDispatched.current) return;
    const endedAtMs = Date.now();
    const frontRegistration = front?.mapRegistration;
    const backRegistration = back?.mapRegistration;
    const mapApplied = Boolean(
      activeMapRevisionId
      && frontRegistration?.mapRevisionId === activeMapRevisionId
      && backRegistration?.mapRevisionId === activeMapRevisionId,
    );
    const registration = result.side === "FRONT" ? frontRegistration : backRegistration;
    onInstrumentationEvent?.({
      eventType: "CENTERING_CONFIRMED",
      startedAtMs: stageStartedAt.current,
      endedAtMs,
      details: {
        side: result.side,
        mapAppliedScope: mapApplied ? (activeMapScope ?? "EXACT") : "NONE",
        ...(mapApplied && activeMapName ? { mapName: activeMapName } : {}),
        ...(mapApplied && registration ? { mapRevisionId: registration.mapRevisionId } : {}),
        ...(registrationFailureSides.current[result.side]
          ? { mapFailureCode: "REGISTRATION_FAILED" as const }
          : mapLookupFailed
            ? { mapFailureCode: "LOOKUP_FAILED" as const }
            : {}),
      },
    });
    stageStartedAt.current = endedAtMs;
    if (result.side === "FRONT") {
      setFront((current) => current ? { ...current, centering: result } : current);
      setStage("BACK_CENTERING");
      return;
    }
    const finalBack = back ? { ...back, centering: result } : null;
    setBack(finalBack);
    if (!front?.centering || !front.corners || !finalBack?.corners) return;
    const toPreparedSide = (side: SpeedsterCardSide, value: SideState): SpeedsterPreparedSide => {
      if (!value.corners) throw new Error(`${side} physical geometry is incomplete.`);
      return ({
      side,
      originalStorageKey: value.originalStorageKey,
      sourceUrl: value.sourceUrl,
      sourceCorners: value.corners,
      rectifiedUrl: value.rectifiedUrl!,
      rectifiedStorageKey: value.rectifiedStorageKey!,
      inspectionUrl: value.inspectionUrl!,
      inspectionStorageKey: value.inspectionStorageKey!,
      inspectionFrame: value.inspectionFrame!,
      transform: value.transform!,
      views: value.views!,
      viewStorageKeys: value.viewStorageKeys!,
      centeringQuad: value.centering!.innerQuad,
      centeringBorders: value.centering!.borders,
      colorGeometryEvidence: [
        {
          side,
          sourceImageStorageKey: value.originalStorageKey,
          mode: "PHYSICAL_OUTER",
          matColor: value.matColor,
          result: value.physicalColorGeometry,
          serverReceipt: value.physicalColorGeometryReceipt,
          confirmedQuad: value.corners,
        },
        {
          side,
          sourceImageStorageKey: value.originalStorageKey,
          mode: "PRINTED_FRAME",
          matColor: value.matColor,
          result: value.printedColorGeometry!,
          serverReceipt: value.printedColorGeometryReceipt!,
          confirmedQuad: value.centering!.innerQuad,
        },
      ],
      ...(value.mapRegistration ? { mapRegistration: value.mapRegistration } : {}),
      });
    };
    const bundle = {
      sessionId,
      cardProfile,
      cornerShape,
      front: toPreparedSide("FRONT", front),
      back: toPreparedSide("BACK", finalBack),
    };
    const durableFront = durableCaptureSide(front);
    const durableBack = durableCaptureSide(finalBack);
    const operationId = currentRegistrationOperationId.current ?? crypto.randomUUID();
    currentRegistrationOperationId.current = operationId;
    const stableDecisionIds = captureDraftDecisionIds.current ?? {
      continue: crypto.randomUUID(),
      abandonObsoleteMap: crypto.randomUUID(),
      retry: {},
    };
    captureDraftDecisionIds.current = stableDecisionIds;
    if (!durableFront || !durableBack || typeof window === "undefined") {
      setCaptureSaveFailed(true);
      setWorkflowError("The complete Front + Back capture could not be preserved before save. No server save was attempted; retry without redrawing.");
      setMessage("Final capture draft preservation failed before the save request.");
      return;
    }
    const now = Date.now();
    const createdAtMs = captureDraftCreatedAtMs.current ?? now;
    captureDraftCreatedAtMs.current = createdAtMs;
    try {
      writeSpeedsterCaptureRegistrationDraft(window.localStorage, {
        version: SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_CURRENT_VERSION,
        createdAtMs,
        updatedAtMs: now,
        surface: draftSurface,
        sessionId,
        cardProfile,
        mapBindingStatus,
        activeMapRevisionId,
        activeMapScope,
        activeMapName,
        cornerShape,
        stage: "BACK_CENTERING",
        front: durableFront,
        back: durableBack,
        interruptions: {},
        failures: {},
        failureRequestIds: {},
        provisional: {
          ...(front.mapRegistration ? { FRONT: front.mapRegistration } : {}),
          ...(finalBack.mapRegistration ? { BACK: finalBack.mapRegistration } : {}),
        },
        registrationRecordedAtMs: registrationRecordedAtMs.current,
        attemptIds: {},
        operationId,
        attemptNumbers: {},
        decisionIds: stableDecisionIds,
        correctedAnchors: {},
        registrationFailureSides: registrationFailureSides.current,
        mapRegistrationFailed: mapRegistrationFailed.current,
        mapAuthorityAbandoned: mapAuthorityAbandoned.current,
        captureSavePendingRetry: true,
        notice: mapRegistrationNotice,
      });
    } catch (error) {
      setCaptureSaveFailed(true);
      setWorkflowError(`${error instanceof Error ? error.message : "The final capture draft could not be preserved."} No server save was attempted; retry without redrawing.`);
      setMessage("Final capture draft preservation failed before the save request.");
      return;
    }
    readyDispatched.current = true;
    setCaptureSaveFailed(true);
    setStage("READY");
    setMessage("Saving the locked Front + Back geometry.");
    let browserDraftCleanupAttempted = false;
    const clearPreservedBrowserDraft = () => {
      browserDraftCleanupAttempted = true;
      if (typeof window === "undefined") return true;
      try {
        removeSpeedsterCaptureRegistrationDraft(window.localStorage, sessionId);
        captureDraftCreatedAtMs.current = null;
        return true;
      } catch {
        const cleanupFailure = "Capture saved successfully, but the obsolete browser draft could not be cleared. Use the visible retry action before reusing this session URL.";
        onDraftCleanupFailure?.(cleanupFailure);
        return false;
      }
    };
    const saveResult = await onReady(bundle, clearPreservedBrowserDraft);
    if (saveResult && !saveResult.saved) {
      readyDispatched.current = false;
      setCaptureSaveFailed(true);
      setStage("BACK_CENTERING");
      setColorGeometryRecoveryTarget(saveResult.colorGeometryReceiptExpired ?? null);
      setWorkflowError(saveResult.message ?? "Card geometry could not be saved. Retry without redrawing.");
      setMessage(saveResult.colorGeometryReceiptExpired
        ? `Save stopped on expired ${saveResult.colorGeometryReceiptExpired.side} ${saveResult.colorGeometryReceiptExpired.mode} authority. Use the visible exact-mode recovery; all other work remains preserved.`
        : "Save did not finish. Front + Back photos and geometry are preserved; retry when ready.");
      return;
    }
    setColorGeometryRecoveryTarget(null);
    if (!browserDraftCleanupAttempted) clearPreservedBrowserDraft();
    refreshColorScore();
    setMessage("Geometry locked. The card is ready for defect detection.");
  };

  const activeGeometry = stage === "FRONT_GEOMETRY" ? front : stage === "BACK_GEOMETRY" ? back : null;
  const rescueSide = registrationRescue?.failures.FRONT ? "FRONT"
    : registrationRescue?.failures.BACK ? "BACK"
      : null;
  const interruptionSide = registrationInterruption?.interruptions.FRONT ? "FRONT"
    : registrationInterruption?.interruptions.BACK ? "BACK"
      : null;
  const interruptionFailureEvidence = registrationInterruption
    ? registrationFailureEvidence(
        registrationInterruption.interruptions,
        registrationInterruption.failures,
        registrationInterruption.failureRequestIds,
      )
    : [];
  const rescueFailureEvidence = registrationRescue
    ? registrationFailureEvidence({}, registrationRescue.failures, registrationRescue.failureRequestIds)
    : [];
  const activeSide = stage.startsWith("FRONT") ? "FRONT" : "BACK";
  const activeCentering = stage === "FRONT_CENTERING" ? front : stage === "BACK_CENTERING" ? back : null;
  const activePreparedImageSide = interruptionSide ?? rescueSide ?? (activeCentering ? activeSide : null);
  const activePreparedImageStorageKey = activePreparedImageSide === "FRONT"
    ? front?.rectifiedStorageKey
    : activePreparedImageSide === "BACK"
      ? back?.rectifiedStorageKey
      : undefined;

  useEffect(() => {
    if (!activePreparedImageSide || !activePreparedImageStorageKey || captureSaveFailed) return;
    void refreshPreparedImage(activePreparedImageSide, activePreparedImageStorageKey).catch(() => undefined);
    const timer = window.setInterval(
      () => void refreshPreparedImage(activePreparedImageSide, activePreparedImageStorageKey).catch(() => undefined),
      SPEEDSTER_PREPARED_IMAGE_REFRESH_INTERVAL_MS,
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPreparedImage(activePreparedImageSide, activePreparedImageStorageKey).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activePreparedImageSide, activePreparedImageStorageKey, captureSaveFailed, refreshPreparedImage]);

  return (
    <section className={styles.workspace}>
      <header className={styles.progress}>
        <span>02 · CAPTURE + GEOMETRY</span>
        <p role="status">{working ? "RACING · " : ""}{message}</p>
      </header>
      <ColorGeometryScoreboard score={colorScore} />

      {mapRegistrationNotice ? (
        <p className={mapRegistrationFailed.current || stage === "MAP_REGISTRATION_INTERRUPTED" ? styles.mapFallback : styles.appliedMap}>
          {mapRegistrationNotice}
        </p>
      ) : null}

      {workflowError ? <p role="alert" className={styles.errorBanner}>{workflowError}</p> : null}

      {captureDraftError ? <p role="alert" className={styles.errorBanner}>{captureDraftError}</p> : null}
      {auditReconciliationNotices.map((notice) => (
        <p
          key={notice.noticeId}
          role="alert"
          data-audit-reconciliation-notice={notice.noticeId}
          className={styles.errorBanner}
        >
          {notice.message}
        </p>
      ))}

      {mapMismatchedCaptureDraft ? (
        <section className={styles.registrationInterruption} aria-label="Preserved capture draft Card Map mismatch">
          <header>
            <span>CAPTURE DRAFT · CARD MAP CHANGED · BLOCKED</span>
            <h2>The preserved work cannot continue under obsolete map authority.</h2>
          </header>
          <p>
            Front + Back storage evidence, corners, transforms, completed centering, old revision, receipts, projected zones, and registration decisions remain preserved.
            Keep this draft for incident review, or explicitly discard it and restart against the current exact revision.
          </p>
          <div className={styles.interruptionActions}>
            <button type="button" onClick={discardPreservedCaptureDraft} disabled={working}>
              Discard preserved draft
            </button>
          </div>
        </section>
      ) : pendingCaptureDraft ? (
        <section className={styles.registrationInterruption} aria-label="Preserved capture draft">
          <header>
            <span>CAPTURE DRAFT · EXPLICIT CHOICE</span>
            <h2>Prepared Front + Back work is preserved from this session.</h2>
          </header>
          <p>
            Saved {new Date(pendingCaptureDraft.updatedAtMs).toLocaleString()} for {captureDraftBindingLabel(pendingCaptureDraft)}.
            {" "}Nothing has been applied, retried, or discarded.
          </p>
          {pendingCaptureDraft.version === SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION ? (
            <LegacyColorRecoveryControls
              matColors={matColors}
              disabled={working}
              onMatColorChange={(side, matColor) => setMatColors((current) => ({ ...current, [side]: matColor }))}
              onRecover={() => void recoverLegacyColorGeometry(pendingCaptureDraft, "MATCHED")}
            />
          ) : null}
          <div className={styles.interruptionActions}>
            {pendingCaptureDraft.version !== SPEEDSTER_CAPTURE_REGISTRATION_DRAFT_VERSION ? (
              <button type="button" onClick={() => void resumePreservedCaptureDraft()} disabled={working}>
                {working ? "Refreshing prepared images…" : "Resume preserved draft"}
              </button>
            ) : null}
            <button type="button" onClick={discardPreservedCaptureDraft} disabled={working}>
              Discard preserved draft
            </button>
          </div>
        </section>
      ) : invalidCaptureDraftPresent && stage === "PHOTOS" ? (
          <button type="button" onClick={discardPreservedCaptureDraft} disabled={working}>
            Discard invalid preserved draft
          </button>
        ) : null}

      {stage === "PHOTOS" && captureDraftHydratedSessionId === sessionId
        && !pendingCaptureDraft && !mapMismatchedCaptureDraft && !invalidCaptureDraftPresent ? (
        <div className={styles.photos}>
          <PhotoUploadPair
            front={frontPhoto}
            back={backPhoto}
            pairingUrl={iphonePairingUrl}
            onChange={(side, file) => {
              setWorkflowError(null);
              side === "FRONT"
                ? setFrontPhoto({ kind: "LOCAL", file })
                : setBackPhoto({ kind: "LOCAL", file });
            }}
            onRetake={() => {
              setWorkflowError(null);
              setFrontPhoto(null);
              setBackPhoto(null);
              setRecaptureSide(null);
              photosStartedAt.current = Date.now();
              photosReadyRecorded.current = false;
              setMessage("Retake front + back, then run the Speedster Shortcut again.");
            }}
            onSwap={() => {
              setWorkflowError(null);
              setFrontPhoto(backPhoto);
              setBackPhoto(frontPhoto);
              setMatColors({ FRONT: matColors.BACK, BACK: matColors.FRONT });
            }}
            matColors={matColors}
            onMatColorChange={(side, matColor) => setMatColors((current) => ({ ...current, [side]: matColor }))}
            lockedSide={recaptureSide === "FRONT" ? "BACK" : recaptureSide === "BACK" ? "FRONT" : null}
            allowSwap={!recaptureSide}
            disabled={working}
          />
          {recaptureSide ? (
            <p role="note">
              Targeted mat recapture uses only the unlocked local file slot. The paired iPhone Shortcut always captures Front + Back, so it is unavailable here and cannot replace the retained sibling evidence.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void beginGeometry()}
            disabled={!frontPhoto || !backPhoto || working}
          >
            {working
              ? "Preparing…"
              : frontPhoto && backPhoto
                ? workflowError
                  ? `Retry ${recaptureSide ? `${recaptureSide === "FRONT" ? "Front" : "Back"} ` : ""}set geometry →`
                  : recaptureSide
                    ? `Set ${recaptureSide === "FRONT" ? "Front" : "Back"} geometry →`
                    : "Set geometry →"
                : !frontPhoto || !backPhoto
                  ? recaptureSide
                    ? `Add replacement ${recaptureSide === "FRONT" ? "Front" : "Back"} photo to continue`
                    : "Add both photos to continue"
                  : "Add both photos to continue"}
          </button>
        </div>
      ) : null}

      {activeGeometry ? (
        <>
        <ColorGeometryStatus
          proposal={activeGeometry.physicalColorGeometry}
          side={activeSide}
          disabled={working}
        />
        <GeometryAssist
          key={`${activeSide}:${activeGeometry.sourceUrl}`}
          imageUrl={activeGeometry.sourceUrl}
          side={activeSide}
          proposedQuad={activeGeometry.corners}
          placement={activeGeometry.geometryPlacement}
          diagnostic={activeGeometry.geometryDiagnostic}
          cornerShape={cornerShape}
          onQuadChange={(corners) => activeSide === "FRONT"
            ? setFront((current) => current ? { ...current, corners, automaticGeometry: false, geometryPlacement: "HUMAN_EDITED" } : current)
            : setBack((current) => current ? { ...current, corners, automaticGeometry: false, geometryPlacement: "HUMAN_EDITED" } : current)}
          onCornerShapeChange={setCornerShape}
          onContinue={() => void confirmGeometry(activeSide)}
          onImageError={setWorkflowError}
          onRefreshImage={() => void refreshOriginalImage(activeSide)}
          disabled={working}
        />
        </>
      ) : null}

      {stage === "MAP_REGISTRATION_INTERRUPTED" && registrationInterruption && interruptionFailureEvidence.length ? (
        <section className={styles.registrationInterruption} aria-label="Card Map registration interruption">
          <header>
            <span>CARD MAP · ACTION REQUIRED</span>
            <h2>{interruptionFailureEvidence.map(({ side }) => side).join(" + ")} registration is unresolved.</h2>
          </header>
          <p role="alert">Retry each listed side, or explicitly continue through human review without applying the failed map.</p>
          <p>
            Any completed sibling registration and valid anchor diagnostics are retained provisionally.
            No Card Map side is authoritative until Front + Back both validate.
          </p>
          {interruptionFailureEvidence.map((evidence) => (
            <div className={styles.interruptionEvidence} key={evidence.side}>
              <strong>{evidence.side}</strong>
              <span>{evidence.code}</span>
              <span>{evidence.httpStatus === null ? "No HTTP status" : `HTTP ${evidence.httpStatus}`}</span>
              <span>{evidence.requestId ? `Request ${evidence.requestId}` : "No HTTP request ID was returned."}</span>
              {registrationInterruption.interruptions[evidence.side] ? (
                <span>{registrationInterruption.interruptions[evidence.side]!.message}</span>
              ) : null}
              {registrationInterruption.interruptions[evidence.side] ? (
                <button
                  type="button"
                  onClick={() => void retryInterruptedRegistration(evidence.side)}
                  disabled={working}
                >
                  {working ? `Retrying ${evidence.side}…` : `${evidence.side}: Retry failed side`}
                </button>
              ) : (
                <span>Human anchor diagnostics retained; correct this side after infrastructure interruptions resolve.</span>
              )}
            </div>
          ))}
          <p>The map remains unapplied unless every side validates. Human review is a separate, durable operator decision.</p>
          <button type="button" onClick={() => void continueRegistrationWithoutMap()} disabled={working}>
            CONTINUE WITHOUT CARD MAP · HUMAN REVIEW
          </button>
        </section>
      ) : null}

      {stage === "MAP_REGISTRATION_RESCUE" && rescueSide && registrationRescue?.failures[rescueSide] ? (
        <>
          <section className={styles.registrationInterruption} aria-label="Card Map correction summary">
            <strong>Unresolved human-correction sides</strong>
            {rescueFailureEvidence.map((evidence) => (
              <div className={styles.interruptionEvidence} key={evidence.side}>
                <strong>{evidence.side}</strong>
                <span>{evidence.code}</span>
                <span>HTTP 422</span>
                <span>{evidence.requestId ? `Request ${evidence.requestId}` : "No HTTP request ID was returned."}</span>
              </div>
            ))}
            <p>Correct every unresolved side. The exact map remains blocked until Front + Back both validate.</p>
            <button type="button" onClick={() => void continueRegistrationWithoutMap()} disabled={working}>
              CONTINUE WITHOUT CARD MAP · HUMAN REVIEW
            </button>
          </section>
          <MapRegistrationRescue
            key={`${rescueSide}:${registrationRescue.failures[rescueSide]?.failureCode}`}
            side={rescueSide}
            imageUrl={(rescueSide === "FRONT" ? front : back)?.rectifiedUrl ?? ""}
            imageRevision={(rescueSide === "FRONT" ? front : back)?.rectifiedImageRevision ?? 0}
            imageRefreshError={preparedImageRefresh[rescueSide].error}
            imageRefreshing={preparedImageRefresh[rescueSide].refreshing}
            failure={registrationRescue.failures[rescueSide]!}
            initialCorrectedAnchors={correctedAnchorDrafts[rescueSide]}
            disabled={working}
            onDraftChange={(anchors) => setCorrectedAnchorDrafts((current) => ({
              ...current,
              [rescueSide]: anchors,
            }))}
            onConfirm={(anchors) => confirmRegistrationRescue(rescueSide, anchors)}
            onImageError={() => handlePreparedImageError(rescueSide, (rescueSide === "FRONT" ? front : back)?.rectifiedStorageKey)}
            onImageReady={() => markPreparedImageReady(rescueSide)}
            onRetryImage={() => retryPreparedImage(rescueSide, (rescueSide === "FRONT" ? front : back)?.rectifiedStorageKey)}
          />
        </>
      ) : null}

      {colorGeometryRecoveryTarget ? (
        <section className={styles.registrationInterruption} aria-label="Expired Color Geometry receipt recovery">
          <header>
            <span>COLOR GEOMETRY · EXACT MODE RECOVERY</span>
            <h2>{colorGeometryRecoveryTarget.side} · {colorGeometryRecoveryTarget.mode.replace("_", " ")}</h2>
          </header>
          <p role="alert">
            Only this expired receipt will be rerun. Its currently confirmed quad will be explicitly reconfirmed unchanged.
            The sibling side, other three receipts/evidence, original photos, prepared artifacts, registrations, and handle positions remain retained.
          </p>
          <button type="button" onClick={() => void recoverExpiredColorGeometry()} disabled={working}>
            {working
              ? `Recovering ${colorGeometryRecoveryTarget.side} ${colorGeometryRecoveryTarget.mode}…`
              : `Rerun and reconfirm only ${colorGeometryRecoveryTarget.side} ${colorGeometryRecoveryTarget.mode}`}
          </button>
        </section>
      ) : null}

      {activeCentering?.rectifiedUrl && activeCentering.proposedCentering !== undefined ? (
        <>
        <ColorGeometryStatus
          proposal={activeCentering.physicalColorGeometry}
          side={activeSide}
          onChangeMatRecapture={!activeMapRevisionId || (front?.mapRegistration && back?.mapRegistration)
            ? changeMatAndRecapture
            : undefined}
          recaptureLockedReason={activeMapRevisionId && (!front?.mapRegistration || !back?.mapRegistration)
            ? "One-side mat recapture is locked because the loaded Card Map was explicitly left unapplied. That decision and all completed geometry remain preserved; continue with human centering."
            : undefined}
          disabled={working}
        />
        {activeCentering.printedColorGeometry ? <ColorGeometryStatus proposal={activeCentering.printedColorGeometry} /> : null}
        <CenteringAssist
          key={activeSide}
          imageUrl={activeCentering.rectifiedUrl}
          imageRevision={activeCentering.rectifiedImageRevision ?? 0}
          imageRefreshError={preparedImageRefresh[activeSide].error}
          imageRefreshing={preparedImageRefresh[activeSide].refreshing}
          side={activeSide}
          initialInnerQuad={activeCentering.centering?.innerQuad ?? activeCentering.proposedCentering}
          detectedBorders={activeCentering.detectedBorders ?? []}
          onContinue={(result) => void confirmCentering(result)}
          disabled={readyDispatched.current || Boolean(colorGeometryRecoveryTarget)}
          continueLabel={captureSaveFailed && activeSide === "BACK" ? "Retry save" : "Continue"}
          onImageError={() => handlePreparedImageError(activeSide, activeCentering.rectifiedStorageKey)}
          onImageReady={() => markPreparedImageReady(activeSide)}
          onRetryImage={() => retryPreparedImage(activeSide, activeCentering.rectifiedStorageKey)}
        />
        </>
      ) : null}

      {stage === "READY" ? <div className={styles.ready}>Card map ready <span>→</span></div> : null}
    </section>
  );
}

export type { CaptureWorkspaceProps };

function LegacyColorRecoveryControls({
  matColors,
  disabled,
  onMatColorChange,
  onRecover,
}: Readonly<{
  matColors: Readonly<Record<SpeedsterCardSide, SpeedsterMatColor>>;
  disabled: boolean;
  onMatColorChange: (side: SpeedsterCardSide, matColor: SpeedsterMatColor) => void;
  onRecover: () => void;
}>) {
  return (
    <fieldset disabled={disabled}>
      <legend>Legacy draft Color Geometry recovery</legend>
      <p>
        This v1 draft predates Color Geometry receipts. The mat label is retained only as diagnostic evidence; it cannot accept or reject corners.
        Recovery reads the existing original images only; it does not upload, recapture, rewrite prepared artifacts, move handles, or apply Card Map authority.
      </p>
      {(["FRONT", "BACK"] as const).map((side) => (
        <div key={side}>
          <label>
            {side === "FRONT" ? "Front" : "Back"} mat
            <select
              aria-label={`${side === "FRONT" ? "Front" : "Back"} preserved draft mat`}
              value={matColors[side]}
              onChange={(event) => onMatColorChange(side, event.target.value as SpeedsterMatColor)}
            >
              <option value="BLACK">Black</option>
              <option value="WHITE">White</option>
              <option value="MAGENTA">Magenta</option>
            </select>
          </label>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={onRecover}
      >
        {disabled ? "Recovering Color evidence…" : "Recover Color evidence and reconfirm all four preserved quads"}
      </button>
    </fieldset>
  );
}

function ColorGeometryStatus({
  proposal,
  side,
  onChangeMatRecapture,
  recaptureLockedReason,
  disabled = false,
}: Readonly<{
  proposal: SpeedsterColorGeometryProposal;
  side?: SpeedsterCardSide;
  onChangeMatRecapture?: (side: SpeedsterCardSide, recommendedMat: SpeedsterMatColor | null) => void;
  recaptureLockedReason?: string;
  disabled?: boolean;
}>) {
  const accepted = proposal.outcome === "ACCEPTED";
  const diagnostic = proposal.mode === "PHYSICAL_OUTER" ? proposal.diagnosticCandidate : null;
  const canRecapture = proposal.mode === "PHYSICAL_OUTER" && proposal.advisory && side && onChangeMatRecapture;
  return (
    <div className={`${accepted ? styles.colorAccepted : styles.colorFallback} ${styles.colorStatus}`} role="status">
      <span>
        {proposal.mode === "PHYSICAL_OUTER" && accepted
          ? "PHYSICAL OUTLINE FOUND · REVIEW AND CONFIRM"
          : `COLOR ${proposal.mode.replace("_", " ")} · ${proposal.outcome.replaceAll("_", " ")}`}
        {proposal.advisory
          ? ` · ${proposal.advisory.message}`
          : proposal.mode === "PHYSICAL_OUTER"
            ? " · Mat and percentage diagnostics never hide this outline."
            : " · Draft requires human confirmation."}
      </span>
      {diagnostic && !accepted ? (
        <div className={styles.colorDiagnostic} role="note">
          <strong>NOT AUTO-ACCEPTED · HUMAN REVIEW ONLY</strong>
          <span>
            Candidate rank {diagnostic.rank} · frame coverage {diagnostic.frameCoverage.toFixed(4)} · contour score {diagnostic.contourScore.toFixed(2)}
          </span>
          <ul>
            {diagnostic.rejectedGates.map((gate) => (
              <li key={`${gate.code}:${gate.side ?? "global"}`}>
                {gate.side ? `${gate.side.toUpperCase()} · ` : ""}{gate.metric}: {gate.observed.toFixed(4)}; requires {gate.comparison === "GTE" ? "≥" : "<"} {gate.threshold.toFixed(4)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {proposal.mode === "PHYSICAL_OUTER" && proposal.advisory && !onChangeMatRecapture ? (
        <span>{recaptureLockedReason ?? "One-side mat recapture unlocks after both sides are prepared and registered so completed sibling evidence can be retained."}</span>
      ) : null}
      {canRecapture ? (
        <button
          type="button"
          className={styles.colorRecapture}
          disabled={disabled}
          onClick={() => onChangeMatRecapture(side, proposal.advisory?.recommendedMat ?? null)}
        >
          Change {side === "FRONT" ? "Front" : "Back"} mat / recapture {side === "FRONT" ? "Front" : "Back"}
          {proposal.advisory?.recommendedMat ? ` — ${proposal.advisory.recommendedMat}` : ""}
        </button>
      ) : null}
    </div>
  );
}
