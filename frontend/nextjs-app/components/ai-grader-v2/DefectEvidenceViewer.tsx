"use client";

import Image from "next/image";
import { useState } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterPoint,
} from "../../lib/ai-grader-v2/contracts";
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
const CARD_ASPECT = 63.5 / 88.9;

type DefectEvidenceViewerProps = {
  masterImageUrl: string;
  sourceImageUrls: Readonly<Record<string, string>>;
  side: SpeedsterCardSide;
  defects: readonly SpeedsterMeasuredDefect[];
  readOnly: boolean;
  selectedDefectId?: string | null;
  onSelectedDefectChange?: (defectId: string) => void;
  onRemoveDefect?: (defectId: string) => void;
  onDefectTypeChange?: (defectId: string, defectType: SpeedsterDefectType) => void;
};

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

function crop(contour: readonly SpeedsterPoint[]): [number, number, number, number] {
  const xs = contour.map(({ x }) => x);
  const ys = contour.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const halfWidth = Math.min(
    0.5,
    Math.max((maxX - minX) * 0.9, ((maxY - minY) * 0.9) / CARD_ASPECT, 0.065),
  );
  const halfHeight = halfWidth * CARD_ASPECT;
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
  sourceImageUrls,
  side,
  defects,
  readOnly,
  selectedDefectId,
  onSelectedDefectChange,
  onRemoveDefect,
  onDefectTypeChange,
}: DefectEvidenceViewerProps) {
  const [localId, setLocalId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const visibleDefects = defects.filter((defect) => defect.side === side);
  const selectedId =
    selectedDefectId === undefined ? localId ?? visibleDefects[0]?.id : selectedDefectId;
  const activeId = hoveredId ?? selectedId;
  const active = visibleDefects.find(({ id }) => id === activeId);
  const activeCrop = active ? crop(active.canonicalContour) : null;
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

  return (
    <section className={styles.viewer} aria-label={`${side.toLowerCase()} defect evidence`}>
      <div className={styles.masterPanel}>
        <header className={styles.header}>
          <div><span>MASTER CARD MAP</span><h2>{side === "FRONT" ? "Front" : "Back"} evidence</h2></div>
          <b>{visibleDefects.length.toString().padStart(2, "0")}</b>
        </header>
        <div className={styles.cardStage}>
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
              const marker = center(defect.canonicalContour);
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
                  <polygon className={styles.contour} points={points(defect.canonicalContour, 1000)} />
                  <circle className={styles.halo} cx={marker.x * 1000} cy={marker.y * 1000} r="25" />
                  <circle className={styles.marker} cx={marker.x * 1000} cy={marker.y * 1000} r="11" />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <aside className={styles.detail} aria-live="polite">
        {active && activeCrop ? (
          <>
            <div className={styles.closeUp}>
              <svg viewBox={activeCrop.join(" ")} preserveAspectRatio="none">
                <image href={sourceImageUrls[active.sourceViewId]} width="1" height="1" preserveAspectRatio="none" />
                <polygon className={styles.closeContour} points={points(active.canonicalContour)} />
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
          <div className={styles.empty}><span>DEFECT EVIDENCE</span><p>Select a marker to inspect its measurements.</p></div>
        )}
      </aside>
    </section>
  );
}

export type { DefectEvidenceViewerProps };
