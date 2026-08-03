"use client";

import Image from "next/image";
import { useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterPoint,
} from "../../lib/ai-grader-v2/contracts";
import {
  SPEEDSTER_CANONICAL_FRAME,
  canonicalContourToInspection,
  inspectionBoxToCanonical,
  type SpeedsterInspectionFrame,
} from "../../lib/ai-grader-v2/inspection-frame";
import styles from "./DefectEvidenceViewer.module.css";

const LABELS: Record<SpeedsterDefectType, string> = {
  FAINT_COLOR_VARIATION: "Faint print / color",
  VISIBLE_WHITENING: "Visible whitening",
  FRAYING: "Fraying",
  CHIPPING_EXPOSED_STOCK: "Chipping / exposed stock",
  LIFTING_DEFORMATION: "Lifting / deformation",
  LIGHT_SCRATCH_SCUFF: "Light scratch / scuff",
  VISIBLE_SCRATCH_PRINT_COATING_LOSS: "Visible scratch / coating loss",
  DENT_MATERIAL_DAMAGE: "Dent / material damage",
  PEELING_HEAVY_DAMAGE: "Peeling / heavy damage",
};

const EDGE_CORNER_TYPES: readonly SpeedsterDefectType[] = [
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
];
const SURFACE_TYPES: readonly SpeedsterDefectType[] = [
  "FAINT_COLOR_VARIATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
];
type DefectEvidenceViewerProps = {
  masterImageUrl: string;
  magnifyImageUrl?: string;
  inspectionFrame?: SpeedsterInspectionFrame;
  sourceImageUrls: Readonly<Record<string, string>>;
  side: SpeedsterCardSide;
  defects: readonly SpeedsterMeasuredDefect[];
  readOnly: boolean;
  selectedDefectId?: string | null;
  onSelectedDefectChange?: (defectId: string) => void;
  onRemoveDefect?: (defectId: string) => void;
  onDefectTypeChange?: (defectId: string, defectType: SpeedsterDefectType) => void;
  onSmartMark?: (box: { x: number; y: number; width: number; height: number }) => void;
};

type ReviewMode = "INSPECT" | "MAGNIFY" | "SMART_MARK";

function points(contour: readonly SpeedsterPoint[], scale = 1): string {
  return contour.map(({ x, y }) => `${x * scale},${y * scale}`).join(" ");
}

function center(contour: readonly SpeedsterPoint[]): SpeedsterPoint {
  const sum = contour.reduce(
    (value, point) => ({ x: value.x + point.x, y: value.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / contour.length, y: sum.y / contour.length };
}

function crop(
  contour: readonly SpeedsterPoint[],
  frameAspect: number,
): [number, number, number, number] {
  const xs = contour.map(({ x }) => x);
  const ys = contour.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const halfWidth = Math.min(
    0.5,
    Math.max((maxX - minX) * 0.9, ((maxY - minY) * 0.9) / frameAspect, 0.065),
  );
  const halfHeight = halfWidth * frameAspect;
  const width = halfWidth * 2;
  const height = halfHeight * 2;
  return [
    Math.min(Math.max((minX + maxX) / 2 - halfWidth, 0), 1 - width),
    Math.min(Math.max((minY + maxY) / 2 - halfHeight, 0), 1 - height),
    width,
    height,
  ];
}

export function DefectEvidenceViewer({
  masterImageUrl,
  magnifyImageUrl,
  inspectionFrame = SPEEDSTER_CANONICAL_FRAME,
  sourceImageUrls,
  side,
  defects,
  readOnly,
  selectedDefectId,
  onSelectedDefectChange,
  onRemoveDefect,
  onDefectTypeChange,
  onSmartMark,
}: DefectEvidenceViewerProps) {
  const [localId, setLocalId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mode, setMode] = useState<ReviewMode>("INSPECT");
  const [pointer, setPointer] = useState<SpeedsterPoint | null>(null);
  const [markStart, setMarkStart] = useState<SpeedsterPoint | null>(null);
  const [markEnd, setMarkEnd] = useState<SpeedsterPoint | null>(null);
  const visibleDefects = defects.filter((defect) => defect.side === side);
  const visibleIds = new Set(visibleDefects.map(({ id }) => id));
  const selectedId =
    selectedDefectId === undefined
      ? localId && visibleIds.has(localId) ? localId : visibleDefects[0]?.id
      : selectedDefectId;
  const activeId = hoveredId && visibleIds.has(hoveredId) ? hoveredId : selectedId;
  const active = visibleDefects.find(({ id }) => id === activeId);
  const frameAspect = inspectionFrame.width / inspectionFrame.height;
  const activeContour = active
    ? canonicalContourToInspection(active.canonicalContour, inspectionFrame)
    : null;
  const activeCrop = activeContour ? crop(activeContour, frameAspect) : null;
  const activeTypes = active?.zone === "SURFACE" ? SURFACE_TYPES : EDGE_CORNER_TYPES;
  const metrics = active
    ? [
        ["WIDTH", `${active.measurement.widthMm.toFixed(2)} mm`],
        ["HEIGHT", `${active.measurement.heightMm.toFixed(2)} mm`],
        ["AREA", `${active.measurement.areaMm2.toFixed(2)} mm²`],
        ["ZONE", `${active.measurement.zonePercent.toFixed(2)}%`],
        ["MULTIPLIER", `${active.measurement.multiplier.toFixed(2)}×`],
        ["SUBGRADE EFFECT", `−${Math.abs(active.measurement.subgradeEffect).toFixed(2)}`],
      ]
    : [];

  const select = (id: string) => {
    if (selectedDefectId === undefined) setLocalId(id);
    onSelectedDefectChange?.(id);
  };

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): SpeedsterPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const finishMark = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "SMART_MARK" || !markStart) return;
    const end = pointFromEvent(event);
    const inspectionBox = {
      x: Math.min(markStart.x, end.x),
      y: Math.min(markStart.y, end.y),
      width: Math.abs(end.x - markStart.x),
      height: Math.abs(end.y - markStart.y),
    };
    setMarkStart(null);
    setMarkEnd(null);
    const box = inspectionBoxToCanonical(inspectionBox, inspectionFrame);
    if (box && box.width > 0.005 && box.height > 0.005) onSmartMark?.(box);
    setMode("INSPECT");
  };

  const markBox = markStart && markEnd ? {
    x: Math.min(markStart.x, markEnd.x),
    y: Math.min(markStart.y, markEnd.y),
    width: Math.abs(markEnd.x - markStart.x),
    height: Math.abs(markEnd.y - markStart.y),
  } : null;

  const lensStyle = pointer ? {
    "--lens-x": `${pointer.x * 100}%`,
    "--lens-y": `${pointer.y * 100}%`,
    backgroundImage: `url(${magnifyImageUrl ?? masterImageUrl})`,
  } as CSSProperties : undefined;

  return (
    <section className={styles.viewer} aria-label={`${side.toLowerCase()} defect evidence`}>
      <div className={styles.masterPanel}>
        <header className={styles.header}>
          <div><span>MASTER CARD MAP</span><h2>{side === "FRONT" ? "Front" : "Back"} evidence</h2></div>
          <div className={styles.headerTools}>
            <button
              type="button"
              className={mode === "MAGNIFY" ? styles.toolActive : undefined}
              onClick={() => {
                setPointer(null);
                setMode(mode === "MAGNIFY" ? "INSPECT" : "MAGNIFY");
              }}
            >Magnify</button>
            {!readOnly ? (
              <button
                type="button"
                className={mode === "SMART_MARK" ? styles.toolActive : undefined}
                onClick={() => setMode(mode === "SMART_MARK" ? "INSPECT" : "SMART_MARK")}
              >Smart-Mark</button>
            ) : null}
            <b>{visibleDefects.length.toString().padStart(2, "0")}</b>
          </div>
        </header>
        <div
          className={`${styles.cardStage} ${mode === "SMART_MARK" ? styles.marking : ""}`}
          style={{ aspectRatio: `${inspectionFrame.width} / ${inspectionFrame.height}` }}
          onPointerMove={(event) => {
            if (mode === "MAGNIFY") setPointer(pointFromEvent(event));
            if (mode === "SMART_MARK" && markStart) setMarkEnd(pointFromEvent(event));
          }}
          onPointerLeave={() => setPointer(null)}
          onPointerDown={(event) => {
            if (mode !== "SMART_MARK") return;
            const next = pointFromEvent(event);
            setMarkStart(next);
            setMarkEnd(next);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={finishMark}
          onPointerCancel={() => { setMarkStart(null); setMarkEnd(null); }}
        >
          <Image
            className={styles.masterImage}
            src={masterImageUrl}
            alt={`${side.toLowerCase()} card with measured defect overlays`}
            fill
            sizes="(max-width: 860px) 100vw, 55vw"
            unoptimized
          />
          <svg className={styles.overlay} viewBox="0 0 1000 1000" preserveAspectRatio="none">
            {visibleDefects.map((defect, index) => {
              const inspectionContour = canonicalContourToInspection(
                defect.canonicalContour,
                inspectionFrame,
              );
              const marker = center(inspectionContour);
              const activeClass = defect.id === activeId ? styles.active : styles.defect;
              return (
                <g
                  key={defect.id}
                  className={activeClass}
                  role="button"
                  tabIndex={0}
                  aria-label={`Defect ${index + 1}: ${LABELS[defect.defectType]}`}
                  onClick={() => select(defect.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select(defect.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredId(defect.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(defect.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <polygon className={styles.contour} points={points(inspectionContour, 1000)} />
                  <circle className={styles.hitTarget} cx={marker.x * 1000} cy={marker.y * 1000} r="34" />
                  <circle className={styles.halo} cx={marker.x * 1000} cy={marker.y * 1000} r="25" />
                  <circle className={styles.marker} cx={marker.x * 1000} cy={marker.y * 1000} r="11" />
                </g>
              );
            })}
            {markBox ? (
              <rect
                className={styles.smartMarkBox}
                x={markBox.x * 1000}
                y={markBox.y * 1000}
                width={markBox.width * 1000}
                height={markBox.height * 1000}
              />
            ) : null}
          </svg>
          {mode === "MAGNIFY" && pointer ? <div className={styles.lens} style={lensStyle} /> : null}
        </div>
      </div>

      <aside className={styles.detail} aria-live="polite">
        {active && activeContour && activeCrop ? (
          <>
            <div className={styles.closeUp}>
              <svg viewBox={activeCrop.join(" ")} preserveAspectRatio="none">
                <image href={sourceImageUrls[active.sourceViewId]} width="1" height="1" preserveAspectRatio="none" />
                <polygon className={styles.closeContour} points={points(activeContour)} />
              </svg>
              <span>EVIDENCE CLOSE-UP</span>
            </div>
            <div className={styles.title}><span>{active.zone}</span><h3>{LABELS[active.defectType]}</h3></div>
            <dl className={styles.metrics}>
              {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            {!readOnly ? (
              <div className={styles.actions}>
                <span>DEFECT TYPE</span>
                <div className={styles.pills}>
                  {activeTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={type === active.defectType ? styles.selectedPill : undefined}
                      onClick={() => onDefectTypeChange?.(active.id, type)}
                    >{LABELS[type]}</button>
                  ))}
                </div>
                <button className={styles.remove} type="button" onClick={() => onRemoveDefect?.(active.id)}>Remove</button>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>
            <span>{mode === "SMART_MARK" ? "SMART-MARK" : "DEFECT EVIDENCE"}</span>
            <p>{mode === "SMART_MARK" ? "Drag a box around the missed defect." : "Select a marker to inspect its measurements."}</p>
          </div>
        )}
      </aside>
    </section>
  );
}

export type { DefectEvidenceViewerProps };
