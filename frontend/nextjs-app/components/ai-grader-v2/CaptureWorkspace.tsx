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
import {
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
import styles from "./CaptureWorkspace.module.css";

type Stage = "PHOTOS" | "FRONT_GEOMETRY" | "BACK_GEOMETRY" | "MAP_REGISTRATION_INTERRUPTED" | "MAP_REGISTRATION_RESCUE" | "FRONT_CENTERING" | "BACK_CENTERING" | "READY";

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
  activeMapRevisionId?: string | null;
  activeMapScope?: SpeedsterMapScope | null;
  activeMapName?: string | null;
  mapLookupFailed?: boolean;
  onReady: (bundle: SpeedsterCaptureBundle) => Promise<SpeedsterCaptureSaveResult> | SpeedsterCaptureSaveResult;
  onInstrumentationEvent: (event: SpeedsterCaptureInstrumentationEvent) => void | boolean | Promise<void | boolean>;
  imageRequestTimeoutMs?: number;
};

export type SpeedsterCaptureSaveResult = Readonly<{
  saved: boolean;
  message?: string;
}>;

export type SpeedsterCaptureInstrumentationEvent = Readonly<{
  eventId?: string;
  eventType: "PHOTOS_READY" | "GEOMETRY_PROPOSED" | "GEOMETRY_CONFIRMED" | "CENTERING_CONFIRMED" | "MAP_REGISTRATION_OPERATOR_DECISION";
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
    registrationDecision?: "RETRY_FAILED_SIDE" | "CONTINUE_WITHOUT_CARD_MAP";
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
  corners: SpeedsterQuad;
  automaticGeometry: boolean;
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
  proposedCentering?: SpeedsterQuad;
  detectedBorders?: readonly ("top" | "right" | "bottom" | "left")[];
  centering?: CenteringAssistResult;
  mapRegistration?: SpeedsterMapRegistration;
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

type RegistrationInterruptionState = Readonly<{
  interruptions: Partial<Record<SpeedsterCardSide, RegistrationInterruption>>;
  failures: RegistrationRescueState["failures"];
  failureRequestIds: RegistrationRescueState["failureRequestIds"];
  provisional: RegistrationRescueState["provisional"];
  operationId: string;
  attemptNumbers: Partial<Record<SpeedsterCardSide, number>>;
  decisionIds: Readonly<{
    continue: string;
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

type RegistrationFailureEvidence = NonNullable<
  NonNullable<SpeedsterCaptureInstrumentationEvent["details"]>["registrationFailures"]
>[number];

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

const CARD_ASPECT = 63.5 / 88.9;

function manualStartQuad(width: number, height: number): SpeedsterQuad {
  const frameAspect = width / height;
  const widthFraction = frameAspect > CARD_ASPECT ? 0.9 * CARD_ASPECT / frameAspect : 0.9;
  const heightFraction = frameAspect > CARD_ASPECT ? 0.9 : 0.9 * frameAspect / CARD_ASPECT;
  const left = (1 - widthFraction) / 2;
  const top = (1 - heightFraction) / 2;
  const right = 1 - left;
  const bottom = 1 - top;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function withMapRegistration(value: SideState, registration: SpeedsterMapRegistration): SideState {
  return {
    ...value,
    proposedCentering: registration.projectedDesignBoundary.kind === "QUAD"
      ? registration.projectedDesignBoundary.points
      : [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
    detectedBorders: registration.projectedDesignBoundary.kind === "QUAD"
      ? ["top", "right", "bottom", "left"]
      : [],
    mapRegistration: registration,
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
  activeMapRevisionId = null,
  activeMapScope = null,
  activeMapName = null,
  mapLookupFailed = false,
  onReady,
  onInstrumentationEvent,
  imageRequestTimeoutMs,
}: CaptureWorkspaceProps) {
  const [frontPhoto, setFrontPhoto] = useState<SpeedsterOriginalPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<SpeedsterOriginalPhoto | null>(null);
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
  const [captureSaveFailed, setCaptureSaveFailed] = useState(false);
  const [registrationRescue, setRegistrationRescue] = useState<RegistrationRescueState | null>(null);
  const [registrationInterruption, setRegistrationInterruption] = useState<RegistrationInterruptionState | null>(null);
  const [preparedImageRefresh, setPreparedImageRefresh] = useState(EMPTY_PREPARED_IMAGE_REFRESH);
  const geometryAttempt = useRef(0);
  const activeImageRequest = useRef<AbortController | null>(null);
  const photosStartedAt = useRef(Date.now());
  const photosReadyRecorded = useRef(false);
  const stageStartedAt = useRef(Date.now());
  const frontGeometryTiming = useRef<{ startedAtMs: number; endedAtMs: number } | null>(null);
  const mapRegistrationFailed = useRef(false);
  const registrationFailureSides = useRef<Partial<Record<SpeedsterCardSide, true>>>({});
  const captureActionInFlight = useRef(false);
  const registrationActionInFlight = useRef(false);
  const currentRegistrationOperationId = useRef<string | null>(null);
  const readyDispatched = useRef(false);
  const preparedImageRefreshInFlight = useRef<Partial<Record<SpeedsterCardSide, Promise<string>>>>({});
  const preparedImageAutomaticRetryUsed = useRef<Partial<Record<SpeedsterCardSide, boolean>>>({});
  const currentSessionId = useRef(sessionId);

  currentSessionId.current = sessionId;

  useEffect(() => {
    activeImageRequest.current?.abort();
    activeImageRequest.current = null;
    iphoneVersion.current = 0;
    photosStartedAt.current = Date.now();
    photosReadyRecorded.current = false;
    stageStartedAt.current = Date.now();
    frontGeometryTiming.current = null;
    mapRegistrationFailed.current = false;
    registrationFailureSides.current = {};
    captureActionInFlight.current = false;
    registrationActionInFlight.current = false;
    currentRegistrationOperationId.current = null;
    readyDispatched.current = false;
    setFrontPhoto(null);
    setBackPhoto(null);
    setFront(null);
    setBack(null);
    setStage("PHOTOS");
    setWorking(false);
    setMapRegistrationNotice(null);
    setWorkflowError(null);
    setCaptureSaveFailed(false);
    setRegistrationRescue(null);
    setRegistrationInterruption(null);
    setPreparedImageRefresh(EMPTY_PREPARED_IMAGE_REFRESH);
    preparedImageRefreshInFlight.current = {};
    preparedImageAutomaticRetryUsed.current = {};
  }, [sessionId]);

  useEffect(() => () => {
    activeImageRequest.current?.abort();
    activeImageRequest.current = null;
  }, []);

  const refreshPreparedImage = useCallback((side: SpeedsterCardSide) => {
    const existing = preparedImageRefreshInFlight.current[side];
    if (existing) return existing;
    const requestSessionId = sessionId;
    setPreparedImageRefresh((current) => ({
      ...current,
      [side]: { ...current[side], refreshing: true, error: null },
    }));
    const request = fetchSpeedsterPreparedRectifiedImageUrl({ token, sessionId, side })
      .then((imageUrl) => {
        if (currentSessionId.current !== requestSessionId) return imageUrl;
        const install = (current: SideState | null) => current ? {
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
        if (currentSessionId.current === requestSessionId) {
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
        if (preparedImageRefreshInFlight.current[side] === request) {
          delete preparedImageRefreshInFlight.current[side];
        }
      });
    preparedImageRefreshInFlight.current[side] = request;
    return request;
  }, [sessionId, token]);

  const handlePreparedImageError = useCallback((side: SpeedsterCardSide) => {
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
    preparedImageAutomaticRetryUsed.current[side] = true;
    void refreshPreparedImage(side).catch(() => undefined);
  }, [refreshPreparedImage]);

  const retryPreparedImage = useCallback((side: SpeedsterCardSide) => {
    preparedImageAutomaticRetryUsed.current[side] = false;
    void refreshPreparedImage(side).catch(() => undefined);
  }, [refreshPreparedImage]);

  const markPreparedImageReady = useCallback((side: SpeedsterCardSide) => {
    preparedImageAutomaticRetryUsed.current[side] = false;
    setPreparedImageRefresh((current) => current[side].error ? ({
      ...current,
      [side]: { refreshing: false, error: null },
    }) : current);
  }, []);

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
    if (stage !== "PHOTOS" || working) return;
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
          front?: { storageKey: string; readUrl: string };
          back?: { storageKey: string; readUrl: string };
        };
        if (
          !stopped
          && response.ok
          && payload.readyVersion
          && payload.readyVersion > iphoneVersion.current
          && payload.front
          && payload.back
        ) {
          iphoneVersion.current = payload.readyVersion;
          setFrontPhoto({ kind: "IPHONE", ...payload.front, captureVersion: payload.readyVersion });
          setBackPhoto({ kind: "IPHONE", ...payload.back, captureVersion: payload.readyVersion });
          setMessage("iPhone front + back received. Swap them if needed, then set geometry.");
        }
      } catch {
        // The next lightweight poll is enough; no second capture path is needed.
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
  }, [sessionId, stage, token, working]);

  const beginGeometry = async () => {
    if (!frontPhoto || !backPhoto || working || captureActionInFlight.current) return;
    captureActionInFlight.current = true;
    const attemptId = geometryAttempt.current + 1;
    const startedAtMs = Date.now();
    geometryAttempt.current = attemptId;
    activeImageRequest.current?.abort();
    const controller = new AbortController();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage("Uploading originals and locking onto the card geometry.");
    try {
      const uploadedFront = frontPhoto.kind === "IPHONE"
        ? frontPhoto
        : await uploadSpeedsterOriginal({ token, sessionId, side: "FRONT", file: frontPhoto.file, signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      const requestGeometry = async (side: SpeedsterCardSide, imageUrl: string) => {
        const startedAt = Date.now();
        try {
          const geometry = await speedsterImageService.proposeGeometry(token, imageUrl, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
          if (activeImageRequest.current !== controller) throw new Error("A newer Set geometry attempt replaced this request.");
          const corners = sanitizeSpeedsterUnitQuad(geometry.corners);
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
      const frontResult = await requestGeometry("FRONT", uploadedFront.readUrl);
      const uploadedBack = backPhoto.kind === "IPHONE"
        ? backPhoto
        : await uploadSpeedsterOriginal({ token, sessionId, side: "BACK", file: backPhoto.file, signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      const backResult = await requestGeometry("BACK", uploadedBack.readUrl);
      if (activeImageRequest.current !== controller) return;
      setFront({
        originalStorageKey: uploadedFront.storageKey,
        sourceUrl: uploadedFront.readUrl,
        corners: frontResult.corners ?? manualStartQuad(frontResult.geometry.width, frontResult.geometry.height),
        automaticGeometry: frontResult.corners !== null,
        geometryDiagnostic: frontResult.diagnostic,
      });
      setBack({
        originalStorageKey: uploadedBack.storageKey,
        sourceUrl: uploadedBack.readUrl,
        corners: backResult.corners ?? manualStartQuad(backResult.geometry.width, backResult.geometry.height),
        automaticGeometry: backResult.corners !== null,
        geometryDiagnostic: backResult.diagnostic,
      });
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
        setMessage("Set geometry did not finish. Both original photos are preserved; retry when ready.");
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
  }>) => {
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
    setStage("FRONT_CENTERING");
    stageStartedAt.current = endedAtMs;
    registrationFailureSides.current = failureSides;
    mapRegistrationFailed.current = hasFailure;
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
    onInstrumentationEvent?.({
      eventType: "GEOMETRY_CONFIRMED",
      ...frontTiming,
      details: detail("FRONT", frontRegistration),
    });
    onInstrumentationEvent?.({
      eventType: "GEOMETRY_CONFIRMED",
      startedAtMs: frontTiming.endedAtMs,
      endedAtMs,
      details: detail("BACK", backRegistration),
    });
    setMessage("Confirm the printed-border geometry.");
  };

  const surfaceRegistrationAuditWarning = (operationId: string, values: readonly unknown[]) => {
    const requestIds = Array.from(new Set(values.flatMap((value) => {
      const warning = registrationAuditWarningFrom(value);
      return warning ? [warning.requestId] : [];
    })));
    if (requestIds.length > 0) {
      setWorkflowError(`CARD MAP attempt audit write failed for request ${requestIds.join(" + ")}. The registration result and all operator work are preserved; retain operation ${operationId} for reconciliation.`);
    }
  };

  const confirmGeometry = async (side: SpeedsterCardSide) => {
    const current = side === "FRONT" ? front : back;
    if (!current || working || captureActionInFlight.current) return;
    captureActionInFlight.current = true;
    activeImageRequest.current?.abort();
    const controller = new AbortController();
    activeImageRequest.current = controller;
    setWorking(true);
    setWorkflowError(null);
    setMessage(`Preparing the ${side.toLowerCase()} card map.`);
    try {
      const outputPlan = await planSpeedsterPreparedOutputs({
        token,
        sessionId,
        side,
        signal: controller.signal,
        timeoutMs: imageRequestTimeoutMs,
      });
      const prepared = await speedsterImageService.prepare(
        token,
        current.sourceUrl,
        current.corners,
        outputPlan,
      );
      if (activeImageRequest.current !== controller) return;
      const next: SideState = {
        ...current,
        rectifiedUrl: outputPlan.RECTIFIED.readUrl,
        rectifiedImageRevision: 0,
        rectifiedStorageKey: outputPlan.RECTIFIED.storageKey,
        inspectionUrl: outputPlan.INSPECTION.readUrl,
        inspectionStorageKey: outputPlan.INSPECTION.storageKey,
        inspectionFrame: prepared.inspectionFrame,
        transform: prepared.transform,
        proposedCentering: prepared.borders,
        detectedBorders: prepared.detectedBorders,
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
      if (side === "FRONT") {
        setFront(next);
        setStage("BACK_GEOMETRY");
        frontGeometryTiming.current = { startedAtMs: stageStartedAt.current, endedAtMs: preparedAtMs };
        stageStartedAt.current = preparedAtMs;
        setMessage("Confirm the back geometry.");
        return;
      }

      if (!front?.rectifiedUrl || !front.proposedCentering) {
        throw new Error("Front geometry must be prepared before Back geometry.");
      }
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
          orchestration: SpeedsterMapRegistrationOrchestration,
        ) => speedsterImageService.registerMap(token, {
          sessionId,
          side: candidate,
          currentPhysicalQuad,
          orchestration,
        }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
        const initialResults = await Promise.allSettled([
          registerSide("FRONT", front.corners, {
            operationId,
            attemptNumber: 1,
            trigger: "INITIAL",
            successfulSiblingPreservedAtAttemptStart: false,
          }),
          registerSide("BACK", current.corners, {
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
            return registerSide(candidate, candidate === "FRONT" ? front.corners : current.corners, {
              operationId,
              attemptNumber: 2,
              trigger: "AUTOMATIC_RETRY",
              successfulSiblingPreservedAtAttemptStart: sibling.status === "fulfilled",
            });
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
            setMessage("Choose Retry failed side or Continue without Card Map. Nothing happens silently.");
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
    failed: boolean,
  ) => {
    if (!front || !back) return;
    const failedSides: Partial<Record<SpeedsterCardSide, true>> = failed ? {
      ...(registrationRescue?.failures.FRONT ? { FRONT: true as const } : {}),
      ...(registrationRescue?.failures.BACK ? { BACK: true as const } : {}),
    } : {};
    const abandonedSides = (["FRONT", "BACK"] as const).filter((side) => failedSides[side]);
    finishMapRegistrationFlow({
      frontState: front,
      backState: back,
      provisional: failed ? {} : provisional,
      failureSides: failedSides,
      notice: failed
        ? `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} was not applied by operator choice. ${abandonedSides.join(" + ")} unresolved Card Map work was explicitly abandoned; continuing with normal human review.`
        : `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} was human-corrected, server-validated, and is ready for Front + Back application.`,
    });
  };

  const recordRegistrationDecision = (
    decisionId: string,
    operationId: string,
    decision: "RETRY_FAILED_SIDE" | "CONTINUE_WITHOUT_CARD_MAP",
    failureEvidence: readonly RegistrationFailureEvidence[],
  ) => {
    const originatingSessionId = sessionId;
    const failedSides = failureEvidence.map(({ side }) => side);
    const atMs = Date.now();
    if (!onInstrumentationEvent) {
      setWorkflowError(`Operator-decision audit reporter is unavailable for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`);
      return;
    }
    const result = onInstrumentationEvent?.({
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
    void Promise.resolve(result).then((saved) => {
      if (saved === false
        && currentSessionId.current === originatingSessionId
        && currentRegistrationOperationId.current === operationId) {
        setWorkflowError(`Operator-decision audit write failed for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`);
      }
    }, () => {
      if (currentSessionId.current === originatingSessionId
        && currentRegistrationOperationId.current === operationId) {
        setWorkflowError(`Operator-decision audit write failed for ${decisionId}. Your work is preserved and the selected action continues; retain operation ${operationId} for reconciliation.`);
      }
    });
  };

  const retryInterruptedRegistration = async (side: SpeedsterCardSide) => {
    if (!registrationInterruption || !front || !back || working || registrationActionInFlight.current) return;
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
      const registration = await speedsterImageService.registerMap(token, {
        sessionId,
        side,
        currentPhysicalQuad: side === "FRONT" ? front.corners : back.corners,
        orchestration: {
          operationId: registrationInterruption.operationId,
          attemptNumber,
          trigger: "MANUAL_RETRY",
          successfulSiblingPreservedAtAttemptStart: Boolean(registrationInterruption.provisional[side === "FRONT" ? "BACK" : "FRONT"]),
        },
      }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs });
      if (activeImageRequest.current !== controller) return;
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
        setMessage("The failed side is still interrupted. Retry it again manually or Continue without Card Map.");
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

  const continueWithoutCardMap = () => {
    if (!registrationInterruption || !front || !back || registrationActionInFlight.current) return;
    registrationActionInFlight.current = true;
    const failedSides = (["FRONT", "BACK"] as const).filter((side) => (
      registrationInterruption.interruptions[side] || registrationInterruption.failures[side]
    ));
    const evidence = registrationFailureEvidence(
      registrationInterruption.interruptions,
      registrationInterruption.failures,
      registrationInterruption.failureRequestIds,
      failedSides,
    );
    recordRegistrationDecision(
      registrationInterruption.decisionIds.continue,
      registrationInterruption.operationId,
      "CONTINUE_WITHOUT_CARD_MAP",
      evidence,
    );
    finishMapRegistrationFlow({
      frontState: front,
      backState: back,
      provisional: {},
      failureSides: Object.fromEntries(failedSides.map((side) => [side, true])) as Partial<Record<SpeedsterCardSide, true>>,
      notice: `${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} was not applied by operator choice. ${failedSides.join(" + ")} unresolved Card Map work was explicitly abandoned; continuing with normal human review.`,
    });
  };

  const confirmRegistrationRescue = async (
    side: SpeedsterCardSide,
    correctedAnchors: readonly Readonly<{ anchorId: string; point: { x: number; y: number } }>[],
  ) => {
    if (!registrationRescue || working || !front || !back || registrationActionInFlight.current) return;
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
      const registration = await speedsterImageService.rescueMapRegistration(token, {
        sessionId,
        side,
        currentPhysicalQuad: side === "FRONT" ? front.corners : back.corners,
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
      surfaceRegistrationAuditWarning(registrationRescue.operationId, [registration]);
      const failures = { ...registrationRescue.failures };
      const failureRequestIds = { ...registrationRescue.failureRequestIds };
      delete failures[side];
      delete failureRequestIds[side];
      const provisional = { ...registrationRescue.provisional, [side]: registration };
      if (failures.FRONT || failures.BACK) {
        setRegistrationRescue({
          failures,
          failureRequestIds,
          provisional,
          attemptIds: registrationRescue.attemptIds,
          operationId: registrationRescue.operationId,
          attemptNumbers,
          continueDecisionId: registrationRescue.continueDecisionId,
        });
        setMessage("That side is saved. Correct the remaining side; neither map side is applied yet.");
      } else {
        finishRegistrationRescue(provisional, false);
      }
    } catch (error) {
      if (activeImageRequest.current !== controller) return;
      surfaceRegistrationAuditWarning(registrationRescue.operationId, [error]);
      setRegistrationRescue({ ...registrationRescue, attemptNumbers });
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
    if (!front?.centering || !finalBack) return;
    const toPreparedSide = (side: SpeedsterCardSide, value: SideState): SpeedsterPreparedSide => ({
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
      ...(value.mapRegistration ? { mapRegistration: value.mapRegistration } : {}),
    });
    const bundle = {
      sessionId,
      cardProfile,
      cornerShape,
      front: toPreparedSide("FRONT", front),
      back: toPreparedSide("BACK", finalBack),
    };
    readyDispatched.current = true;
    setCaptureSaveFailed(false);
    setStage("READY");
    setMessage("Saving the locked Front + Back geometry.");
    const saveResult = await onReady(bundle);
    if (saveResult && !saveResult.saved) {
      readyDispatched.current = false;
      setCaptureSaveFailed(true);
      setStage("BACK_CENTERING");
      setWorkflowError(saveResult.message ?? "Card geometry could not be saved. Retry without redrawing.");
      setMessage("Save did not finish. Front + Back photos and geometry are preserved; retry when ready.");
      return;
    }
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

  useEffect(() => {
    if (!activePreparedImageSide || captureSaveFailed) return;
    void refreshPreparedImage(activePreparedImageSide).catch(() => undefined);
    const timer = window.setInterval(
      () => void refreshPreparedImage(activePreparedImageSide).catch(() => undefined),
      SPEEDSTER_PREPARED_IMAGE_REFRESH_INTERVAL_MS,
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPreparedImage(activePreparedImageSide).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activePreparedImageSide, captureSaveFailed, refreshPreparedImage]);

  return (
    <section className={styles.workspace}>
      <header className={styles.progress}>
        <span>02 · CAPTURE + GEOMETRY</span>
        <p role="status">{working ? "RACING · " : ""}{message}</p>
      </header>

      {mapRegistrationNotice ? (
        <p className={mapRegistrationFailed.current || stage === "MAP_REGISTRATION_INTERRUPTED" ? styles.mapFallback : styles.appliedMap}>
          {mapRegistrationNotice}
        </p>
      ) : null}

      {workflowError ? <p role="alert" className={styles.errorBanner}>{workflowError}</p> : null}

      {stage === "PHOTOS" ? (
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
              photosStartedAt.current = Date.now();
              photosReadyRecorded.current = false;
              setMessage("Retake front + back, then run the Speedster Shortcut again.");
            }}
            onSwap={() => {
              setWorkflowError(null);
              setFrontPhoto(backPhoto);
              setBackPhoto(frontPhoto);
            }}
            disabled={working}
          />
          <button type="button" onClick={() => void beginGeometry()} disabled={!frontPhoto || !backPhoto || working}>
            {working
              ? "Preparing…"
              : frontPhoto && backPhoto
                ? workflowError
                  ? "Retry set geometry →"
                  : "Set geometry →"
                : "Add both photos to continue"}
          </button>
        </div>
      ) : null}

      {activeGeometry ? (
        <GeometryAssist
          key={`${activeSide}:${activeGeometry.sourceUrl}`}
          imageUrl={activeGeometry.sourceUrl}
          side={activeSide}
          proposedQuad={activeGeometry.corners}
          automaticPlacement={activeGeometry.automaticGeometry}
          diagnostic={activeGeometry.geometryDiagnostic}
          cornerShape={cornerShape}
          onQuadChange={(corners) => activeSide === "FRONT"
            ? setFront((current) => current ? { ...current, corners } : current)
            : setBack((current) => current ? { ...current, corners } : current)}
          onCornerShapeChange={setCornerShape}
          onContinue={() => void confirmGeometry(activeSide)}
          onImageError={setWorkflowError}
          disabled={working}
        />
      ) : null}

      {stage === "MAP_REGISTRATION_INTERRUPTED" && registrationInterruption && interruptionFailureEvidence.length ? (
        <section className={styles.registrationInterruption} aria-label="Card Map registration interruption">
          <header>
            <span>CARD MAP · ACTION REQUIRED</span>
            <h2>{interruptionFailureEvidence.map(({ side }) => side).join(" + ")} registration is unresolved.</h2>
          </header>
          <p role="alert">Resolve each listed side, or explicitly continue without any Card Map.</p>
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
          <p>
            Continue without Card Map abandons all unresolved sides: {interruptionFailureEvidence.map(({ side }) => side).join(" + ")}.
          </p>
          <div className={styles.interruptionActions}>
            <button type="button" onClick={continueWithoutCardMap} disabled={working}>
              Continue without Card Map
            </button>
          </div>
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
            <p>Continue without Card Map abandons all unresolved sides: {rescueFailureEvidence.map(({ side }) => side).join(" + ")}.</p>
          </section>
          <MapRegistrationRescue
            key={`${rescueSide}:${registrationRescue.failures[rescueSide]?.failureCode}`}
            side={rescueSide}
            imageUrl={(rescueSide === "FRONT" ? front : back)?.rectifiedUrl ?? ""}
            imageRevision={(rescueSide === "FRONT" ? front : back)?.rectifiedImageRevision ?? 0}
            imageRefreshError={preparedImageRefresh[rescueSide].error}
            imageRefreshing={preparedImageRefresh[rescueSide].refreshing}
            failure={registrationRescue.failures[rescueSide]!}
            disabled={working}
            onConfirm={(anchors) => confirmRegistrationRescue(rescueSide, anchors)}
            onContinueManual={() => {
              if (registrationActionInFlight.current) return;
              registrationActionInFlight.current = true;
              recordRegistrationDecision(
                registrationRescue.continueDecisionId,
                registrationRescue.operationId,
                "CONTINUE_WITHOUT_CARD_MAP",
                rescueFailureEvidence,
              );
              finishRegistrationRescue(registrationRescue.provisional, true);
            }}
            onImageError={() => handlePreparedImageError(rescueSide)}
            onImageReady={() => markPreparedImageReady(rescueSide)}
            onRetryImage={() => retryPreparedImage(rescueSide)}
          />
        </>
      ) : null}

      {activeCentering?.rectifiedUrl && activeCentering.proposedCentering ? (
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
          disabled={readyDispatched.current}
          continueLabel={captureSaveFailed && activeSide === "BACK" ? "Retry save" : "Continue"}
          onImageError={() => handlePreparedImageError(activeSide)}
          onImageReady={() => markPreparedImageReady(activeSide)}
          onRetryImage={() => retryPreparedImage(activeSide)}
        />
      ) : null}

      {stage === "READY" ? <div className={styles.ready}>Card map ready <span>→</span></div> : null}
    </section>
  );
}

export type { CaptureWorkspaceProps };
