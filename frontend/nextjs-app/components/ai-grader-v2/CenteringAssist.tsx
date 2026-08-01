"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";
import {
  SPEEDSTER_CARD_HEIGHT_MM,
  SPEEDSTER_CARD_WIDTH_MM,
} from "../../lib/ai-grader-v2/geometry";
import {
  calculateCenteringBalance,
  type SpeedsterCenteringBorders,
} from "../../lib/ai-grader-v2/scoring";

import styles from "./CenteringAssist.module.css";

export type CenteringAssistResult = {
  side: SpeedsterCardSide;
  innerQuad: SpeedsterQuad;
  borders: SpeedsterCenteringBorders;
};

type CenteringAssistProps = {
  imageUrl: string;
  side: SpeedsterCardSide;
  initialInnerQuad: SpeedsterQuad;
  onContinue: (result: CenteringAssistResult) => void;
};

const HANDLE_LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;
const OVERLAY_WIDTH = 635;
const OVERLAY_HEIGHT = 889;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlayPoint(point: SpeedsterPoint): string {
  return `${point.x * OVERLAY_WIDTH},${point.y * OVERLAY_HEIGHT}`;
}

function measureBorders(quad: SpeedsterQuad): SpeedsterCenteringBorders {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  return {
    leftMm: ((topLeft.x + bottomLeft.x) / 2) * SPEEDSTER_CARD_WIDTH_MM,
    rightMm: (1 - (topRight.x + bottomRight.x) / 2) * SPEEDSTER_CARD_WIDTH_MM,
    topMm: ((topLeft.y + topRight.y) / 2) * SPEEDSTER_CARD_HEIGHT_MM,
    bottomMm: (1 - (bottomLeft.y + bottomRight.y) / 2) * SPEEDSTER_CARD_HEIGHT_MM,
  };
}

function millimeters(value: number): string {
  return `${value.toFixed(2)} mm`;
}

function balance(value: readonly [number, number]): string {
  return `${value[0].toFixed(1)} / ${value[1].toFixed(1)}`;
}

export function CenteringAssist({
  imageUrl,
  side,
  initialInnerQuad,
  onContinue,
}: CenteringAssistProps) {
  const [innerQuad, setInnerQuad] = useState<SpeedsterQuad>(initialInnerQuad);
  const activeHandle = useRef<{ index: number; pointerId: number } | null>(null);
  const measurements = useMemo(() => {
    const borders = measureBorders(innerQuad);
    return {
      borders,
      horizontal: calculateCenteringBalance(borders.leftMm, borders.rightMm),
      vertical: calculateCenteringBalance(borders.topMm, borders.bottomMm),
    };
  }, [innerQuad]);

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = activeHandle.current;
    if (!active || active.pointerId !== event.pointerId) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const next = [...innerQuad] as [
      SpeedsterPoint,
      SpeedsterPoint,
      SpeedsterPoint,
      SpeedsterPoint,
    ];
    next[active.index] = {
      x: clampUnit((event.clientX - bounds.left) / bounds.width),
      y: clampUnit((event.clientY - bounds.top) / bounds.height),
    };
    setInnerQuad(next);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activeHandle.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeHandle.current = null;
  };

  return (
    <section className={styles.assist} aria-label={`${side.toLowerCase()} centering geometry`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{side} · CENTERING</span>
          <h2>Set the printed borders.</h2>
        </div>
        <p>Drag only if the gold markers need adjustment.</p>
      </header>

      <div className={styles.workspace}>
        <div className={styles.imageStage}>
          <div className={styles.imageFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.image}
              src={imageUrl}
              alt={`${side.toLowerCase()} rectified trading card`}
              draggable={false}
            />
            <svg
              className={styles.overlay}
              viewBox={`0 0 ${OVERLAY_WIDTH} ${OVERLAY_HEIGHT}`}
              preserveAspectRatio="none"
              aria-label="Adjustable printed-border geometry"
              onPointerMove={moveHandle}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <polygon
                className={styles.innerQuad}
                points={innerQuad.map(overlayPoint).join(" ")}
                vectorEffect="non-scaling-stroke"
              />
              {innerQuad.map((point, index) => {
                const x = point.x * OVERLAY_WIDTH;
                const y = point.y * OVERLAY_HEIGHT;
                return (
                  <g
                    key={HANDLE_LABELS[index]}
                    className={styles.handle}
                    aria-label={HANDLE_LABELS[index]}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      activeHandle.current = { index, pointerId: event.pointerId };
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                    }}
                  >
                    <circle className={styles.handleHit} cx={x} cy={y} r="30" />
                    <circle className={styles.handleRing} cx={x} cy={y} r="18" vectorEffect="non-scaling-stroke" />
                    <line className={styles.crosshair} x1={x - 27} y1={y} x2={x + 27} y2={y} vectorEffect="non-scaling-stroke" />
                    <line className={styles.crosshair} x1={x} y1={y - 27} x2={x} y2={y + 27} vectorEffect="non-scaling-stroke" />
                    <circle className={styles.handleCore} cx={x} cy={y} r="4" />
                  </g>
                );
              })}
            </svg>

            <span className={`${styles.imageMetric} ${styles.topMetric}`}>
              T {millimeters(measurements.borders.topMm)}
            </span>
            <span className={`${styles.imageMetric} ${styles.rightMetric}`}>
              R {millimeters(measurements.borders.rightMm)}
            </span>
            <span className={`${styles.imageMetric} ${styles.bottomMetric}`}>
              B {millimeters(measurements.borders.bottomMm)}
            </span>
            <span className={`${styles.imageMetric} ${styles.leftMetric}`}>
              L {millimeters(measurements.borders.leftMm)}
            </span>
          </div>
        </div>

        <aside className={styles.readout}>
          <div>
            <span className={styles.readoutLabel}>LIVE MEASUREMENTS</span>
            <dl className={styles.measurementGrid}>
              <div><dt>Left</dt><dd>{millimeters(measurements.borders.leftMm)}</dd></div>
              <div><dt>Right</dt><dd>{millimeters(measurements.borders.rightMm)}</dd></div>
              <div><dt>Top</dt><dd>{millimeters(measurements.borders.topMm)}</dd></div>
              <div><dt>Bottom</dt><dd>{millimeters(measurements.borders.bottomMm)}</dd></div>
            </dl>

            <div className={styles.balanceGrid}>
              <div>
                <span>LEFT / RIGHT</span>
                <strong>{balance(measurements.horizontal)}</strong>
              </div>
              <div>
                <span>TOP / BOTTOM</span>
                <strong>{balance(measurements.vertical)}</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            className={styles.continueButton}
            onClick={() => onContinue({ side, innerQuad, borders: measurements.borders })}
          >
            Continue <span aria-hidden="true">→</span>
          </button>
        </aside>
      </div>
    </section>
  );
}

export type { CenteringAssistProps };
