"use client";

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";

import styles from "./GeometryAssist.module.css";

export type SpeedsterCornerShape = "ROUNDED_3_18_MM" | "SQUARE";

type GeometryAssistProps = {
  imageUrl: string;
  side: SpeedsterCardSide;
  proposedQuad: SpeedsterQuad;
  cornerShape: SpeedsterCornerShape;
  onQuadChange: (quad: SpeedsterQuad) => void;
  onCornerShapeChange: (shape: SpeedsterCornerShape) => void;
  onContinue: () => void;
};

const CORNER_LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlayPoint(point: SpeedsterPoint): string {
  return `${point.x * 1000},${point.y * 1000}`;
}

export function GeometryAssist({
  imageUrl,
  side,
  proposedQuad,
  cornerShape,
  onQuadChange,
  onCornerShapeChange,
  onContinue,
}: GeometryAssistProps) {
  const activeHandle = useRef<{ index: number; pointerId: number } | null>(null);

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = activeHandle.current;
    if (!active || active.pointerId !== event.pointerId) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: clampUnit((event.clientX - bounds.left) / bounds.width),
      y: clampUnit((event.clientY - bounds.top) / bounds.height),
    };
    const next = [...proposedQuad] as [
      SpeedsterPoint,
      SpeedsterPoint,
      SpeedsterPoint,
      SpeedsterPoint,
    ];
    next[active.index] = point;
    onQuadChange(next);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activeHandle.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeHandle.current = null;
  };

  return (
    <section className={styles.assist} aria-label={`${side.toLowerCase()} card geometry`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{side} · GEOMETRY</span>
          <h2>Set the four corners.</h2>
        </div>
        <p>Drag only if the gold markers need adjustment.</p>
      </header>

      <div className={styles.workspace}>
        <div className={styles.imageFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.image} src={imageUrl} alt={`${side.toLowerCase()} trading card`} draggable={false} />
          <svg
            className={styles.overlay}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="Adjustable card corner geometry"
            onPointerMove={moveHandle}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <polygon
              className={styles.quad}
              points={proposedQuad.map(overlayPoint).join(" ")}
              vectorEffect="non-scaling-stroke"
            />
            {proposedQuad.map((point, index) => {
              const x = point.x * 1000;
              const y = point.y * 1000;
              return (
                <g
                  key={CORNER_LABELS[index]}
                  className={styles.handle}
                  aria-label={CORNER_LABELS[index]}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    activeHandle.current = { index, pointerId: event.pointerId };
                    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                  }}
                >
                  <circle className={styles.handleHit} cx={x} cy={y} r="42" />
                  <circle className={styles.handleRing} cx={x} cy={y} r="23" vectorEffect="non-scaling-stroke" />
                  <line className={styles.crosshair} x1={x - 34} y1={y} x2={x + 34} y2={y} vectorEffect="non-scaling-stroke" />
                  <line className={styles.crosshair} x1={x} y1={y - 34} x2={x} y2={y + 34} vectorEffect="non-scaling-stroke" />
                  <circle className={styles.handleCore} cx={x} cy={y} r="5" />
                </g>
              );
            })}
          </svg>
        </div>

        <aside className={styles.controls}>
          <div>
            <span className={styles.controlLabel}>CORNER PROFILE</span>
            <div className={styles.pills}>
              <button
                type="button"
                className={cornerShape === "ROUNDED_3_18_MM" ? styles.activePill : styles.pill}
                aria-pressed={cornerShape === "ROUNDED_3_18_MM"}
                onClick={() => onCornerShapeChange("ROUNDED_3_18_MM")}
              >
                Rounded 3.18mm
              </button>
              <button
                type="button"
                className={cornerShape === "SQUARE" ? styles.activePill : styles.pill}
                aria-pressed={cornerShape === "SQUARE"}
                onClick={() => onCornerShapeChange("SQUARE")}
              >
                Square
              </button>
            </div>
          </div>

          <button type="button" className={styles.continueButton} onClick={onContinue}>
            Continue <span aria-hidden="true">→</span>
          </button>
        </aside>
      </div>
    </section>
  );
}

export type { GeometryAssistProps };
