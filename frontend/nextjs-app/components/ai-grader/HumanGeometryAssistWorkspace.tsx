import {
  aiGraderHumanGeometryRoundedCornerRadiusPxV1,
  deriveAiGraderHumanGeometryRegionsV1,
  type AiGraderHumanGeometryAssistDraftV1,
  type AiGraderHumanGeometryCorner,
  type AiGraderHumanGeometryEdge,
  type AiGraderHumanGeometrySide,
  type AiGraderHumanGeometrySideV1,
} from "@tenkings/shared";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { snapHumanGeometryPointToGradientV1 } from "../../lib/humanGeometryGradientSnap";
import HumanGeometryOverlay from "./HumanGeometryOverlay";
import styles from "./HumanGeometryAssistWorkspace.module.css";

type DragState =
  | { kind: "border"; edge: AiGraderHumanGeometryEdge; start: { x: number; y: number }; original: AiGraderHumanGeometrySideV1 }
  | { kind: "corner"; corner: AiGraderHumanGeometryCorner; start: { x: number; y: number }; original: AiGraderHumanGeometrySideV1 }
  | { kind: "pan"; start: { x: number; y: number }; original: { x: number; y: number } };

type Props = {
  draft: AiGraderHumanGeometryAssistDraftV1;
  frontImageUrl: string;
  backImageUrl: string;
  busy?: boolean;
  onLock: (sides: {
    front: AiGraderHumanGeometrySideV1;
    back: AiGraderHumanGeometrySideV1;
  }) => Promise<void>;
};

const EDGES: AiGraderHumanGeometryEdge[] = ["top", "right", "bottom", "left"];
const CORNERS: AiGraderHumanGeometryCorner[] =
  ["top_left", "top_right", "bottom_right", "bottom_left"];

const title = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

function sideConfirmed(side: AiGraderHumanGeometrySideV1) {
  return side.confirmed &&
    EDGES.every((edge) => side.printedBorders[edge].reviewed) &&
    CORNERS.every((corner) => side.physicalCorners[corner].reviewed) &&
    side.edgeRegionsReviewed &&
    side.surfaceRegionReviewed;
}

export default function HumanGeometryAssistWorkspace({
  draft,
  frontImageUrl,
  backImageUrl,
  busy = false,
  onLock,
}: Props) {
  const [activeSide, setActiveSide] = useState<AiGraderHumanGeometrySide>("front");
  const [sides, setSides] = useState(() => structuredClone(draft.sides));
  const [history, setHistory] = useState<typeof sides[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [activeCorner, setActiveCorner] = useState<AiGraderHumanGeometryCorner>("top_left");
  const [magnifier, setMagnifier] = useState<{ x: number; y: number; imageX: number; imageY: number } | null>(null);
  const [snapFeedback, setSnapFeedback] = useState("Manual tools ready");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const current = sides[activeSide];
  const imageUrl = activeSide === "front" ? frontImageUrl : backImageUrl;

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1680;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context?.drawImage(image, 0, 0, 1200, 1680);
      imageDataRef.current = context?.getImageData(0, 0, 1200, 1680) ?? null;
    };
    image.src = imageUrl;
  }, [imageUrl]);

  const updateSide = (next: AiGraderHumanGeometrySideV1, recordHistory = true) => {
    if (recordHistory) setHistory((entries) => [...entries.slice(-39), structuredClone(sides)]);
    setSides((value) => ({ ...value, [activeSide]: next }));
  };

  const clientToImage = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1200, (clientX - rect.left) / rect.width * 1200)),
      y: Math.max(0, Math.min(1680, (clientY - rect.top) / rect.height * 1680)),
    };
  };

  const snapPoint = (
    position: { x: number; y: number },
    axis: "x" | "y",
  ) => snapHumanGeometryPointToGradientV1(
    imageDataRef.current,
    position,
    axis,
  );

  const selectCandidate = (edge: AiGraderHumanGeometryEdge, candidateId: string) => {
    const candidate = current.printedBorders[edge].candidates.find((entry) => entry.id === candidateId);
    if (!candidate) return;
    updateSide({
      ...current,
      printedBorders: {
        ...current.printedBorders,
        [edge]: {
          ...current.printedBorders[edge],
          selectedCandidateId: candidate.id,
          finalLine: structuredClone(candidate.line),
          adjustment: { source: "candidate", snapApplied: false, snapDistancePx: 0, gradientStrength: 0 },
          reviewed: true,
        },
      },
      confirmed: false,
    });
    setSnapFeedback(`${title(edge)} candidate selected`);
  };

  const beginBorderDrag = (edge: AiGraderHumanGeometryEdge, event: React.PointerEvent<SVGLineElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setHistory((entries) => [...entries.slice(-39), structuredClone(sides)]);
    setDrag({ kind: "border", edge, start: clientToImage(event.clientX, event.clientY), original: structuredClone(current) });
  };

  const beginCornerDrag = (corner: AiGraderHumanGeometryCorner, event: React.PointerEvent<SVGGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveCorner(corner);
    setHistory((entries) => [...entries.slice(-39), structuredClone(sides)]);
    setDrag({ kind: "corner", corner, start: clientToImage(event.clientX, event.clientY), original: structuredClone(current) });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      setPan({
        x: drag.original.x + event.clientX - drag.start.x,
        y: drag.original.y + event.clientY - drag.start.y,
      });
      return;
    }
    const position = clientToImage(event.clientX, event.clientY);
    const delta = { x: position.x - drag.start.x, y: position.y - drag.start.y };
    if (drag.kind === "border") {
      const axis = drag.edge === "left" || drag.edge === "right" ? "x" : "y";
      const original = drag.original.printedBorders[drag.edge].finalLine;
      const anchor = {
        x: (original.start.x + original.end.x) / 2 + (axis === "x" ? delta.x : 0),
        y: (original.start.y + original.end.y) / 2 + (axis === "y" ? delta.y : 0),
      };
      const snapped = snapPoint(anchor, axis);
      const applied = snapped.strength >= 0.08;
      const offset = applied
        ? (axis === "x" ? snapped.x - (original.start.x + original.end.x) / 2 : snapped.y - (original.start.y + original.end.y) / 2)
        : (axis === "x" ? delta.x : delta.y);
      const finalLine = axis === "x"
        ? {
            start: { x: original.start.x + offset, y: original.start.y },
            end: { x: original.end.x + offset, y: original.end.y },
          }
        : {
            start: { x: original.start.x, y: original.start.y + offset },
            end: { x: original.end.x, y: original.end.y + offset },
          };
      const next = {
        ...drag.original,
        printedBorders: {
          ...drag.original.printedBorders,
          [drag.edge]: {
            ...drag.original.printedBorders[drag.edge],
            selectedCandidateId: null,
            finalLine,
            reviewed: true,
            adjustment: {
              source: "manual" as const,
              snapApplied: applied,
              snapDistancePx: applied ? snapped.distance : 0,
              gradientStrength: snapped.strength,
            },
          },
        },
        confirmed: false,
      };
      setSides((value) => ({ ...value, [activeSide]: next }));
      setSnapFeedback(applied ? "Snapped to image gradient" : "Manual position");
    } else {
      const originalCorner = drag.original.physicalCorners[drag.corner];
      const snappedX = snapPoint({ x: originalCorner.vertex.x + delta.x, y: originalCorner.vertex.y + delta.y }, "x");
      const snapped = snapPoint(snappedX, "y");
      const applied = Math.max(snappedX.strength, snapped.strength) >= 0.08;
      const vertex = {
        x: applied ? snapped.x : originalCorner.vertex.x + delta.x,
        y: applied ? snapped.y : originalCorner.vertex.y + delta.y,
      };
      const shift = { x: vertex.x - originalCorner.vertex.x, y: vertex.y - originalCorner.vertex.y };
      const corner = {
        ...originalCorner,
        vertex,
        horizontalTangent: {
          x: originalCorner.horizontalTangent.x + shift.x,
          y: originalCorner.horizontalTangent.y + shift.y,
        },
        verticalTangent: {
          x: originalCorner.verticalTangent.x + shift.x,
          y: originalCorner.verticalTangent.y + shift.y,
        },
        reviewed: true,
        adjustment: {
          source: "manual" as const,
          snapApplied: applied,
          snapDistancePx: applied ? Math.hypot(snappedX.distance, snapped.distance) : 0,
          gradientStrength: Math.max(snappedX.strength, snapped.strength),
        },
      };
      const physicalCorners = { ...drag.original.physicalCorners, [drag.corner]: corner };
      setSides((value) => ({
        ...value,
        [activeSide]: {
          ...drag.original,
          physicalCorners,
          derivedRegions: deriveAiGraderHumanGeometryRegionsV1(physicalCorners),
          edgeRegionsReviewed: false,
          surfaceRegionReviewed: false,
          confirmed: false,
        },
      }));
      setSnapFeedback(applied ? "Corner snapped to physical contour" : "Manual corner position");
    }
    const viewport = event.currentTarget.getBoundingClientRect();
    setMagnifier({
      x: event.clientX - viewport.left,
      y: event.clientY - viewport.top,
      imageX: position.x,
      imageY: position.y,
    });
  };

  const selectCornerTool = (toolType: "rounded_3_18_mm" | "square_90_degree") => {
    const selected = current.physicalCorners[activeCorner];
    const right = activeCorner === "top_right" || activeCorner === "bottom_right";
    const bottom = activeCorner === "bottom_left" || activeCorner === "bottom_right";
    const referenceRadius = aiGraderHumanGeometryRoundedCornerRadiusPxV1();
    const radiusX = toolType === "rounded_3_18_mm" ? referenceRadius.x : 28;
    const radiusY = toolType === "rounded_3_18_mm" ? referenceRadius.y : 28;
    const corner = {
      ...selected,
      toolType,
      horizontalTangent: { x: selected.vertex.x + (right ? -radiusX : radiusX), y: selected.vertex.y },
      verticalTangent: { x: selected.vertex.x, y: selected.vertex.y + (bottom ? -radiusY : radiusY) },
      reviewed: true,
    };
    const physicalCorners = { ...current.physicalCorners, [activeCorner]: corner };
    updateSide({
      ...current,
      physicalCorners,
      derivedRegions: deriveAiGraderHumanGeometryRegionsV1(physicalCorners),
      edgeRegionsReviewed: false,
      surfaceRegionReviewed: false,
      confirmed: false,
    });
  };

  const markCornerReviewed = (corner: AiGraderHumanGeometryCorner) => {
    setActiveCorner(corner);
    updateSide({
      ...current,
      physicalCorners: {
        ...current.physicalCorners,
        [corner]: { ...current.physicalCorners[corner], reviewed: true },
      },
      confirmed: false,
    });
  };

  const bordersReady =
    EDGES.every((edge) => current.printedBorders[edge].reviewed);
  const cornersReady =
    bordersReady &&
    CORNERS.every((corner) => current.physicalCorners[corner].reviewed);
  const canConfirmSide =
    cornersReady &&
    current.edgeRegionsReviewed &&
    current.surfaceRegionReviewed;
  const allConfirmed = useMemo(
    () => sideConfirmed(sides.front) && sideConfirmed(sides.back),
    [sides],
  );
  const currentStep = !bordersReady
    ? 1
    : !cornersReady
      ? 2
      : !current.edgeRegionsReviewed
        ? 3
        : !current.surfaceRegionReviewed
          ? 4
          : 5;

  return (
    <section className={styles.workspace} aria-label="Human Geometry Assist">
      <div className={styles.head}>
        <div>
          <span className={styles.eyebrow}>TEN KINGS · HUMAN REVIEW</span>
          <h2>Geometry Assist</h2>
          <p>Finish the numbered steps. Drag only when a suggestion is wrong.</p>
        </div>
        <span className={`${styles.status} ${allConfirmed ? styles.confirmed : ""}`}>
          {allConfirmed
            ? "Ready to lock"
            : current.confirmed
              ? `${title(activeSide)} confirmed`
              : `${title(activeSide)} · Step ${currentStep} of 5`}
        </span>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Card side">
        {(["front", "back"] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="tab"
            aria-selected={activeSide === side}
            className={sideConfirmed(sides[side]) ? styles.sideComplete : ""}
            onClick={() => { setActiveSide(side); setDrag(null); setMagnifier(null); }}
          >
            {title(side)} {sideConfirmed(sides[side]) ? "✓" : "•"}
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <div>
          <button type="button" disabled={!history.length} onClick={() => {
            const prior = history.at(-1);
            if (!prior) return;
            setSides(prior);
            setHistory((entries) => entries.slice(0, -1));
          }}>Undo</button>
          <button type="button" onClick={() => {
            setHistory((entries) => [...entries.slice(-39), structuredClone(sides)]);
            setSides((value) => ({ ...value, [activeSide]: structuredClone(draft.sides[activeSide]) }));
          }}>Reset to suggestion</button>
          <button
            type="button"
            aria-pressed={panMode}
            className={panMode ? styles.selected : ""}
            onClick={() => setPanMode((value) => !value)}
          >Pan</button>
        </div>
        <label>
          Zoom
          <input type="range" min="0.75" max="4" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          {Math.round(zoom * 100)}%
        </label>
      </div>
      <div className={styles.layout}>
        <div
          className={styles.viewport}
          onPointerDown={(event) => {
            if (!panMode) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              kind: "pan",
              start: { x: event.clientX, y: event.clientY },
              original: pan,
            });
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={() => { setDrag(null); setMagnifier(null); }}
          onPointerCancel={() => { setDrag(null); setMagnifier(null); }}
          onWheel={(event) => {
            event.preventDefault();
            if (event.ctrlKey) setZoom((value) => Math.max(0.75, Math.min(4, value - event.deltaY * 0.003)));
            else setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY }));
          }}
        >
          <div
            ref={canvasRef}
            className={styles.canvas}
            style={{
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
              pointerEvents: panMode ? "none" : "auto",
            }}
          >
            <img src={imageUrl} alt={`${title(activeSide)} full-resolution normalized card`} />
            <HumanGeometryOverlay
              geometry={current}
              showCandidates={!bordersReady}
              showRegions={false}
              showEdgeRegions={
                cornersReady &&
                (!current.edgeRegionsReviewed || current.surfaceRegionReviewed)
              }
              showSurfaceRegion={current.edgeRegionsReviewed}
              showCorners={bordersReady}
              activeCorner={activeCorner}
              onBorderPointerDown={beginBorderDrag}
              onCornerPointerDown={bordersReady ? beginCornerDrag : undefined}
            />
          </div>
          {magnifier ? (
            <div
              className={styles.magnifier}
              style={{
                left: Math.min(magnifier.x + 28, 640),
                top: Math.max(8, magnifier.y - 170),
                backgroundImage: `url(${imageUrl})`,
                backgroundSize: `${1200 * 2.4}px ${1680 * 2.4}px`,
                backgroundPosition: `${-magnifier.imageX * 2.4 + 71}px ${-magnifier.imageY * 2.4 + 71}px`,
              }}
            />
          ) : null}
          <span className={styles.snap}>{snapFeedback}</span>
        </div>
        <aside className={styles.panel}>
          <section className={`${styles.step} ${!bordersReady ? styles.stepActive : styles.stepComplete}`}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>1</span>
              <div>
                <h3>Printed borders</h3>
                <p>Tap the best line. If none fit, drag the solid line.</p>
              </div>
              <span className={styles.stepState}>{bordersReady ? "Done" : "Now"}</span>
            </div>
            {EDGES.map((edge) => (
              <div className={styles.borderChoice} key={edge}>
                <strong>{title(edge)}</strong>
                <div className={styles.candidateRow}>
                  {current.printedBorders[edge].candidates.map((candidate) => (
                    <button
                      type="button"
                      key={candidate.id}
                      aria-label={`${title(edge)} candidate ${candidate.rank}`}
                      className={
                        current.printedBorders[edge].selectedCandidateId === candidate.id
                          ? current.printedBorders[edge].reviewed
                            ? styles.done
                            : styles.selected
                          : ""
                      }
                      onClick={() => selectCandidate(edge, candidate.id)}
                    >
                      {candidate.rank}
                    </button>
                  ))}
                  <span className={current.printedBorders[edge].reviewed ? styles.check : styles.pending}>
                    {current.printedBorders[edge].reviewed ? "✓" : "Choose"}
                  </span>
                </div>
              </div>
            ))}
          </section>
          <section className={`${styles.step} ${cornersReady ? styles.stepComplete : bordersReady ? styles.stepActive : styles.stepLocked}`}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>2</span>
              <div>
                <h3>Physical corners</h3>
                <p>Tap if correct. Press and drag if adjustment is needed.</p>
              </div>
              <span className={styles.stepState}>{cornersReady ? "Done" : bordersReady ? "Next" : "Locked"}</span>
            </div>
            <div className={styles.cornerList}>
              {CORNERS.map((corner) => (
                <button
                  type="button"
                  key={corner}
                  disabled={!bordersReady}
                  className={`${activeCorner === corner ? styles.activeCorner : ""} ${current.physicalCorners[corner].reviewed ? styles.done : ""}`}
                  onClick={() => markCornerReviewed(corner)}
                >
                  <span>{title(corner)}</span>
                  <span>{current.physicalCorners[corner].reviewed ? "✓" : "Tap"}</span>
                </button>
              ))}
            </div>
            <div className={styles.cornerTools}>
              <button
                type="button"
                disabled={!bordersReady}
                className={current.physicalCorners[activeCorner].toolType === "rounded_3_18_mm" ? styles.selected : ""}
                onClick={() => selectCornerTool("rounded_3_18_mm")}
              >Rounded 3.18 mm</button>
              <button
                type="button"
                disabled={!bordersReady}
                className={current.physicalCorners[activeCorner].toolType === "square_90_degree" ? styles.selected : ""}
                onClick={() => selectCornerTool("square_90_degree")}
              >Square 90°</button>
            </div>
          </section>
          <section className={`${styles.step} ${current.edgeRegionsReviewed ? styles.stepComplete : cornersReady ? styles.stepActive : styles.stepLocked}`}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>3</span>
              <div>
                <h3>Straight edges</h3>
                <p>Review the four gold edge bands.</p>
              </div>
              <span className={styles.stepState}>{current.edgeRegionsReviewed ? "Done" : cornersReady ? "Next" : "Locked"}</span>
            </div>
            <button
              type="button"
              disabled={!cornersReady}
              className={`${styles.reviewButton} ${current.edgeRegionsReviewed ? styles.done : ""}`}
              onClick={() => updateSide({ ...current, edgeRegionsReviewed: true, confirmed: false })}
            >Confirm straight edges {current.edgeRegionsReviewed ? "✓" : ""}</button>
          </section>
          <section className={`${styles.step} ${current.surfaceRegionReviewed ? styles.stepComplete : current.edgeRegionsReviewed ? styles.stepActive : styles.stepLocked}`}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>4</span>
              <div>
                <h3>Surface</h3>
                <p>Review the lightly shaded interior.</p>
              </div>
              <span className={styles.stepState}>{current.surfaceRegionReviewed ? "Done" : current.edgeRegionsReviewed ? "Next" : "Locked"}</span>
            </div>
            <button
              type="button"
              disabled={!current.edgeRegionsReviewed}
              className={`${styles.reviewButton} ${current.surfaceRegionReviewed ? styles.done : ""}`}
              onClick={() => updateSide({ ...current, surfaceRegionReviewed: true, confirmed: false })}
            >Confirm surface {current.surfaceRegionReviewed ? "✓" : ""}</button>
          </section>
        </aside>
      </div>
      <div className={styles.footer}>
        <div className={styles.finalStep}>
          <span className={styles.stepNumber}>5</span>
          <span>{sideConfirmed(current) ? `${title(activeSide)} confirmed` : `Confirm ${title(activeSide)}`}</span>
        </div>
        <button
          type="button"
          disabled={!canConfirmSide || current.confirmed}
          className={current.confirmed ? styles.done : ""}
          onClick={() => updateSide({ ...current, confirmed: true })}
        >{current.confirmed ? `${title(activeSide)} confirmed ✓` : `Confirm ${title(activeSide)}`}</button>
        <button
          type="button"
          className={styles.lock}
          disabled={!allConfirmed || busy}
          onClick={() => void onLock(structuredClone(sides))}
        >{busy ? "Locking geometry…" : "Lock Front & Back Geometry"}</button>
      </div>
    </section>
  );
}
