"use client";

import { useEffect, useRef, useState } from "react";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import type { SpeedsterCardProfile, SpeedsterCardSide, SpeedsterQuad } from "../../lib/ai-grader-v2/contracts";
import type { SpeedsterCenteringBorders } from "../../lib/ai-grader-v2/scoring";
import type { SpeedsterInspectionFrame } from "../../lib/ai-grader-v2/inspection-frame";
import type {
  SpeedsterMapRegistration,
  SpeedsterMapScope,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import { sanitizeSpeedsterUnitQuad } from "../../lib/ai-grader-v2/geometry";
import {
  speedsterImageService,
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
import styles from "./CaptureWorkspace.module.css";

type Stage = "PHOTOS" | "FRONT_GEOMETRY" | "BACK_GEOMETRY" | "FRONT_CENTERING" | "BACK_CENTERING" | "READY";

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
  onInstrumentationEvent?: (event: SpeedsterCaptureInstrumentationEvent) => void;
  imageRequestTimeoutMs?: number;
};

export type SpeedsterCaptureSaveResult = Readonly<{
  saved: boolean;
  message?: string;
}>;

export type SpeedsterCaptureInstrumentationEvent = Readonly<{
  eventType: "PHOTOS_READY" | "GEOMETRY_PROPOSED" | "GEOMETRY_CONFIRMED" | "CENTERING_CONFIRMED";
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
  }>;
}>;

type SideState = {
  originalStorageKey: string;
  sourceUrl: string;
  corners: SpeedsterQuad;
  automaticGeometry: boolean;
  geometryDiagnostic: SpeedsterGeometryAttemptDiagnostic;
  rectifiedUrl?: string;
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
  const geometryAttempt = useRef(0);
  const activeImageRequest = useRef<AbortController | null>(null);
  const photosStartedAt = useRef(Date.now());
  const photosReadyRecorded = useRef(false);
  const stageStartedAt = useRef(Date.now());
  const frontGeometryTiming = useRef<{ startedAtMs: number; endedAtMs: number } | null>(null);
  const mapRegistrationFailed = useRef(false);
  const readyDispatched = useRef(false);

  useEffect(() => {
    activeImageRequest.current?.abort();
    activeImageRequest.current = null;
    iphoneVersion.current = 0;
    photosStartedAt.current = Date.now();
    photosReadyRecorded.current = false;
    stageStartedAt.current = Date.now();
    frontGeometryTiming.current = null;
    mapRegistrationFailed.current = false;
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
  }, [sessionId]);

  useEffect(() => () => {
    activeImageRequest.current?.abort();
    activeImageRequest.current = null;
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
    if (!frontPhoto || !backPhoto || working) return;
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
    }
  };

  const confirmGeometry = async (side: SpeedsterCardSide) => {
    const current = side === "FRONT" ? front : back;
    if (!current || working) return;
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
      let finalBack: SideState = next;
      let frontRegistration: SpeedsterMapRegistration | undefined;
      let backRegistration: SpeedsterMapRegistration | undefined;
      if (activeMapRevisionId) {
        try {
          [frontRegistration, backRegistration] = await Promise.all([
            speedsterImageService.registerMap(token, {
              sessionId,
              side: "FRONT",
              currentPhysicalQuad: front.corners,
            }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs }),
            speedsterImageService.registerMap(token, {
              sessionId,
              side: "BACK",
              currentPhysicalQuad: current.corners,
            }, { signal: controller.signal, timeoutMs: imageRequestTimeoutMs }),
          ]);
          if (activeImageRequest.current !== controller) return;
          if (
            frontRegistration.mapRevisionId !== activeMapRevisionId
            || backRegistration.mapRevisionId !== activeMapRevisionId
          ) throw new Error("The selected CARD MAP changed while geometry was being registered.");
          const applyRegistration = (value: SideState, registration: SpeedsterMapRegistration): SideState => ({
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
          });
          finalFront = applyRegistration(finalFront, frontRegistration);
          finalBack = applyRegistration(finalBack, backRegistration);
          setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} applied to Front + Back.`);
        } catch {
          if (activeImageRequest.current !== controller) return;
          frontRegistration = undefined;
          backRegistration = undefined;
          mapRegistrationFailed.current = true;
          setMapRegistrationNotice(`${activeMapScope ?? "EXACT"} · ${activeMapName ?? "Card map"} could not register safely on both sides. No map will be applied; continuing with normal human review.`);
        }
      }
      const endedAtMs = Date.now();
      setFront(finalFront);
      setBack(finalBack);
      setStage("FRONT_CENTERING");
      const frontTiming = frontGeometryTiming.current ?? { startedAtMs: stageStartedAt.current, endedAtMs };
      const registrationFailure = mapRegistrationFailed.current;
      const detailsFor = (
        candidate: SpeedsterCardSide,
        registration?: SpeedsterMapRegistration,
      ): NonNullable<SpeedsterCaptureInstrumentationEvent["details"]> => ({
        side: candidate,
        mapAppliedScope: registration ? (activeMapScope ?? "EXACT") : "NONE",
        ...(registration && activeMapName ? { mapName: activeMapName } : {}),
        ...(registration ? { mapRevisionId: registration.mapRevisionId } : {}),
        ...(registrationFailure
          ? { mapFailureCode: "REGISTRATION_FAILED" as const }
          : mapLookupFailed
            ? { mapFailureCode: "LOOKUP_FAILED" as const }
            : {}),
      });
      onInstrumentationEvent?.({
        eventType: "GEOMETRY_CONFIRMED",
        ...frontTiming,
        details: detailsFor("FRONT", frontRegistration),
      });
      onInstrumentationEvent?.({
        eventType: "GEOMETRY_CONFIRMED",
        startedAtMs: stageStartedAt.current,
        endedAtMs,
        details: detailsFor("BACK", backRegistration),
      });
      stageStartedAt.current = endedAtMs;
      setMessage("Confirm the printed-border geometry.");
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
        ...(mapRegistrationFailed.current
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
  const activeSide = stage.startsWith("FRONT") ? "FRONT" : "BACK";
  const activeCentering = stage === "FRONT_CENTERING" ? front : stage === "BACK_CENTERING" ? back : null;

  return (
    <section className={styles.workspace}>
      <header className={styles.progress}>
        <span>02 · CAPTURE + GEOMETRY</span>
        <p role="status">{working ? "RACING · " : ""}{message}</p>
      </header>

      {mapRegistrationNotice ? (
        <p className={mapRegistrationFailed.current ? styles.mapFallback : styles.appliedMap}>
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

      {activeCentering?.rectifiedUrl && activeCentering.proposedCentering ? (
        <CenteringAssist
          key={activeSide}
          imageUrl={activeCentering.rectifiedUrl}
          side={activeSide}
          initialInnerQuad={activeCentering.centering?.innerQuad ?? activeCentering.proposedCentering}
          detectedBorders={activeCentering.detectedBorders ?? []}
          onContinue={(result) => void confirmCentering(result)}
          disabled={readyDispatched.current}
          continueLabel={captureSaveFailed && activeSide === "BACK" ? "Retry save" : "Continue"}
        />
      ) : null}

      {stage === "READY" ? <div className={styles.ready}>Card map ready <span>→</span></div> : null}
    </section>
  );
}

export type { CaptureWorkspaceProps };
