"use client";

import { useRef, useState } from "react";
import type { SpeedsterCardProfile, SpeedsterCardSide, SpeedsterQuad } from "../../lib/ai-grader-v2/contracts";
import type { SpeedsterCenteringBorders } from "../../lib/ai-grader-v2/scoring";
import {
  speedsterImageService,
  uploadSpeedsterOriginal,
  webpDataUrl,
} from "../../lib/ai-grader-v2/image-service";
import { CenteringAssist, type CenteringAssistResult } from "./CenteringAssist";
import { GeometryAssist, type SpeedsterCornerShape } from "./GeometryAssist";
import PhotoUploadPair from "./PhotoUploadPair";
import styles from "./CaptureWorkspace.module.css";

type Stage = "PHOTOS" | "FRONT_GEOMETRY" | "BACK_GEOMETRY" | "FRONT_CENTERING" | "BACK_CENTERING" | "READY";

export type SpeedsterPreparedSide = {
  side: SpeedsterCardSide;
  originalStorageKey: string;
  sourceUrl: string;
  sourceCorners: SpeedsterQuad;
  rectifiedUrl: string;
  transform: readonly number[];
  views: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
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
  cardProfile: SpeedsterCardProfile;
  onReady: (bundle: SpeedsterCaptureBundle) => void;
};

type SideState = {
  originalStorageKey: string;
  sourceUrl: string;
  corners: SpeedsterQuad;
  rectifiedUrl?: string;
  transform?: readonly number[];
  views?: SpeedsterPreparedSide["views"];
  proposedCentering?: SpeedsterQuad;
  centering?: CenteringAssistResult;
};

const FULL_IMAGE_QUAD: SpeedsterQuad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function CaptureWorkspace({ token, cardProfile, onReady }: CaptureWorkspaceProps) {
  const sessionId = useRef(crypto.randomUUID());
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [front, setFront] = useState<SideState | null>(null);
  const [back, setBack] = useState<SideState | null>(null);
  const [stage, setStage] = useState<Stage>("PHOTOS");
  const [cornerShape, setCornerShape] = useState<SpeedsterCornerShape>("ROUNDED_3_18_MM");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Add one original image of each side.");

  const beginGeometry = async () => {
    if (!frontFile || !backFile || working) return;
    setWorking(true);
    setMessage("Uploading originals and locking onto the card geometry.");
    try {
      const uploadedFront = await uploadSpeedsterOriginal({
        token, sessionId: sessionId.current, side: "FRONT", file: frontFile,
      });
      const frontGeometry = await speedsterImageService.proposeGeometry(token, uploadedFront.readUrl);
      const uploadedBack = await uploadSpeedsterOriginal({
        token, sessionId: sessionId.current, side: "BACK", file: backFile,
      });
      const backGeometry = await speedsterImageService.proposeGeometry(token, uploadedBack.readUrl);
      setFront({
        originalStorageKey: uploadedFront.storageKey,
        sourceUrl: uploadedFront.readUrl,
        corners: frontGeometry.corners ?? FULL_IMAGE_QUAD,
      });
      setBack({
        originalStorageKey: uploadedBack.storageKey,
        sourceUrl: uploadedBack.readUrl,
        corners: backGeometry.corners ?? FULL_IMAGE_QUAD,
      });
      setStage("FRONT_GEOMETRY");
      setMessage("Move only the geometry points that need correction.");
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
      const prepared = await speedsterImageService.prepare(token, current.sourceUrl, current.corners);
      const next: SideState = {
        ...current,
        rectifiedUrl: webpDataUrl(prepared.rectified),
        transform: prepared.transform,
        proposedCentering: prepared.borders,
        views: {
          NORMALIZED: webpDataUrl(prepared.views.normalized),
          MICRO_DEFECT: webpDataUrl(prepared.views.microDefect),
          DIRECTIONAL: webpDataUrl(prepared.views.directional),
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
      transform: value.transform!,
      views: value.views!,
      centeringQuad: value.centering!.innerQuad,
      centeringBorders: value.centering!.borders,
    });
    const bundle = {
      sessionId: sessionId.current,
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
            front={frontFile}
            back={backFile}
            onChange={(side, file) => side === "FRONT" ? setFrontFile(file) : setBackFile(file)}
          />
          <button type="button" onClick={() => void beginGeometry()} disabled={!frontFile || !backFile || working}>
            {working ? "Preparing…" : "Set geometry →"}
          </button>
        </div>
      ) : null}

      {activeGeometry ? (
        <GeometryAssist
          imageUrl={activeGeometry.sourceUrl}
          side={activeSide}
          proposedQuad={activeGeometry.corners}
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
          onContinue={confirmCentering}
        />
      ) : null}

      {stage === "READY" ? <div className={styles.ready}>Card map ready <span>→</span></div> : null}
    </section>
  );
}

export type { CaptureWorkspaceProps };
