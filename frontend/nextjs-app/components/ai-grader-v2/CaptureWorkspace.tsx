"use client";

import { useEffect, useRef, useState } from "react";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import type { SpeedsterCardProfile, SpeedsterCardSide, SpeedsterQuad } from "../../lib/ai-grader-v2/contracts";
import type { SpeedsterCenteringBorders } from "../../lib/ai-grader-v2/scoring";
import {
  speedsterImageService,
  planSpeedsterPreparedOutputs,
  uploadSpeedsterOriginal,
} from "../../lib/ai-grader-v2/image-service";
import { CenteringAssist, type CenteringAssistResult } from "./CenteringAssist";
import { GeometryAssist, type SpeedsterCornerShape } from "./GeometryAssist";
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
  transform: readonly number[];
  views: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
  viewStorageKeys: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
  centeringQuad: SpeedsterQuad;
  centeringBorders: SpeedsterCenteringBorders;
};

export type SpeedsterCaptureBundle = {
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  cornerShape: SpeedsterCornerShape;
  front: SpeedsterPreparedSide;
  back: SpeedsterPreparedSide;
};

type CaptureWorkspaceProps = {
  token: string;
  sessionId: string;
  cardProfile: SpeedsterCardProfile;
  onReady: (bundle: SpeedsterCaptureBundle) => void;
};

type SideState = {
  originalStorageKey: string;
  sourceUrl: string;
  corners: SpeedsterQuad;
  automaticGeometry: boolean;
  rectifiedUrl?: string;
  rectifiedStorageKey?: string;
  transform?: readonly number[];
  views?: SpeedsterPreparedSide["views"];
  viewStorageKeys?: SpeedsterPreparedSide["viewStorageKeys"];
  proposedCentering?: SpeedsterQuad;
  detectedBorders?: readonly ("top" | "right" | "bottom" | "left")[];
  centering?: CenteringAssistResult;
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

export function CaptureWorkspace({ token, sessionId, cardProfile, onReady }: CaptureWorkspaceProps) {
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

  useEffect(() => {
    if (stage !== "PHOTOS" || working) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    iphoneVersion.current = 0;

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
    setWorking(true);
    setMessage("Uploading originals and locking onto the card geometry.");
    try {
      const uploadedFront = frontPhoto.kind === "IPHONE"
        ? frontPhoto
        : await uploadSpeedsterOriginal({ token, sessionId, side: "FRONT", file: frontPhoto.file });
      const frontGeometry = await speedsterImageService.proposeGeometry(token, uploadedFront.readUrl);
      const uploadedBack = backPhoto.kind === "IPHONE"
        ? backPhoto
        : await uploadSpeedsterOriginal({ token, sessionId, side: "BACK", file: backPhoto.file });
      const backGeometry = await speedsterImageService.proposeGeometry(token, uploadedBack.readUrl);
      setFront({
        originalStorageKey: uploadedFront.storageKey,
        sourceUrl: uploadedFront.readUrl,
        corners: frontGeometry.corners ?? manualStartQuad(frontGeometry.width, frontGeometry.height),
        automaticGeometry: frontGeometry.corners !== null,
      });
      setBack({
        originalStorageKey: uploadedBack.storageKey,
        sourceUrl: uploadedBack.readUrl,
        corners: backGeometry.corners ?? manualStartQuad(backGeometry.width, backGeometry.height),
        automaticGeometry: backGeometry.corners !== null,
      });
      setStage("FRONT_GEOMETRY");
      const automaticCount = Number(frontGeometry.corners !== null) + Number(backGeometry.corners !== null);
      setMessage(automaticCount === 2
        ? "Both physical cards found. Move only points that need correction."
        : `${automaticCount}/2 physical cards found. Set the visible manual start points where needed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speedster could not prepare these photos.");
    } finally {
      setWorking(false);
    }
  };

  const confirmGeometry = async (side: SpeedsterCardSide) => {
    const current = side === "FRONT" ? front : back;
    if (!current || working) return;
    setWorking(true);
    setMessage(`Preparing the ${side.toLowerCase()} card map.`);
    try {
      const outputPlan = await planSpeedsterPreparedOutputs({ token, sessionId, side });
      const prepared = await speedsterImageService.prepare(token, current.sourceUrl, current.corners, outputPlan);
      const next: SideState = {
        ...current,
        rectifiedUrl: outputPlan.RECTIFIED.readUrl,
        rectifiedStorageKey: outputPlan.RECTIFIED.storageKey,
        transform: prepared.transform,
        proposedCentering: prepared.borders,
        detectedBorders: prepared.detectedBorders,
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
      if (side === "FRONT") {
        setFront(next);
        setStage("BACK_GEOMETRY");
      } else {
        setBack(next);
        setStage("FRONT_CENTERING");
      }
      setMessage(side === "FRONT" ? "Confirm the back geometry." : "Confirm the printed-border geometry.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speedster image preparation failed.");
    } finally {
      setWorking(false);
    }
  };

  const confirmCentering = (result: CenteringAssistResult) => {
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
      transform: value.transform!,
      views: value.views!,
      viewStorageKeys: value.viewStorageKeys!,
      centeringQuad: value.centering!.innerQuad,
      centeringBorders: value.centering!.borders,
    });
    const bundle = {
      sessionId,
      cardProfile,
      cornerShape,
      front: toPreparedSide("FRONT", front),
      back: toPreparedSide("BACK", finalBack),
    };
    setStage("READY");
    setMessage("Geometry locked. The card is ready for defect detection.");
    onReady(bundle);
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

      {stage === "PHOTOS" ? (
        <div className={styles.photos}>
          <PhotoUploadPair
            front={frontPhoto}
            back={backPhoto}
            pairingUrl={iphonePairingUrl}
            onChange={(side, file) => side === "FRONT"
              ? setFrontPhoto({ kind: "LOCAL", file })
              : setBackPhoto({ kind: "LOCAL", file })}
            onRetake={() => {
              setFrontPhoto(null);
              setBackPhoto(null);
              setMessage("Retake front + back, then run the Speedster Shortcut again.");
            }}
            onSwap={() => {
              setFrontPhoto(backPhoto);
              setBackPhoto(frontPhoto);
            }}
          />
          <button type="button" onClick={() => void beginGeometry()} disabled={!frontPhoto || !backPhoto || working}>
            {working ? "Preparing…" : frontPhoto && backPhoto ? "Set geometry →" : "Add both photos to continue"}
          </button>
        </div>
      ) : null}

      {activeGeometry ? (
        <GeometryAssist
          imageUrl={activeGeometry.sourceUrl}
          side={activeSide}
          proposedQuad={activeGeometry.corners}
          automaticPlacement={activeGeometry.automaticGeometry}
          cornerShape={cornerShape}
          onQuadChange={(corners) => activeSide === "FRONT"
            ? setFront((current) => current ? { ...current, corners } : current)
            : setBack((current) => current ? { ...current, corners } : current)}
          onCornerShapeChange={setCornerShape}
          onContinue={() => void confirmGeometry(activeSide)}
        />
      ) : null}

      {activeCentering?.rectifiedUrl && activeCentering.proposedCentering ? (
        <CenteringAssist
          key={activeSide}
          imageUrl={activeCentering.rectifiedUrl}
          side={activeSide}
          initialInnerQuad={activeCentering.proposedCentering}
          detectedBorders={activeCentering.detectedBorders ?? []}
          onContinue={confirmCentering}
        />
      ) : null}

      {stage === "READY" ? <div className={styles.ready}>Card map ready <span>→</span></div> : null}
    </section>
  );
}

export type { CaptureWorkspaceProps };
