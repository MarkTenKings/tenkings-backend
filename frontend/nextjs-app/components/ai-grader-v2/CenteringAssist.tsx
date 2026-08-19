"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";
import { sanitizeSpeedsterUnitQuad } from "../../lib/ai-grader-v2/geometry";
import {
  calculateCenteringBalance,
  measureSpeedsterCenteringBorders,
  type SpeedsterCenteringBorders,
} from "../../lib/ai-grader-v2/scoring";
import {
  gradientMapFromImage,
  snapSpeedsterPoint,
  type SpeedsterGradientMap,
} from "../../lib/ai-grader-v2/gradient-snap";

import styles from "./CenteringAssist.module.css";

export type CenteringAssistResult = {
  side: SpeedsterCardSide;
  innerQuad: SpeedsterQuad;
  borders: SpeedsterCenteringBorders;
};

type CenteringAssistProps = {
  imageUrl: string;
  imageRevision?: number;
  imageRefreshError?: string | null;
  imageRefreshing?: boolean;
  side: SpeedsterCardSide;
  initialInnerQuad: SpeedsterQuad | null;
  detectedBorders: readonly ("top" | "right" | "bottom" | "left")[];
  onContinue: (result: CenteringAssistResult) => void;
  disabled?: boolean;
  continueLabel?: string;
  onImageError?: () => void;
  onImageReady?: () => void;
  onRetryImage?: () => void;
};

const HANDLE_LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;
const OVERLAY_WIDTH = 635;
const OVERLAY_HEIGHT = 889;
const HANDLE_DIRECTIONS = [
  { inwardX: 1, inwardY: 1 },
  { inwardX: -1, inwardY: 1 },
  { inwardX: -1, inwardY: -1 },
  { inwardX: 1, inwardY: -1 },
] as const;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlayPoint(point: SpeedsterPoint): string {
  return `${point.x * OVERLAY_WIDTH},${point.y * OVERLAY_HEIGHT}`;
}

function millimeters(value: number): string {
  return `${value.toFixed(2)} mm`;
}

function balance(value: readonly [number, number]): string {
  return `${value[0].toFixed(1)} / ${value[1].toFixed(1)}`;
}

export function CenteringAssist({
  imageUrl,
  imageRevision = 0,
  imageRefreshError = null,
  imageRefreshing = false,
  side,
  initialInnerQuad,
  detectedBorders,
  onContinue,
  disabled = false,
  continueLabel = "Continue",
  onImageError,
  onImageReady,
  onRetryImage,
}: CenteringAssistProps) {
  const [innerQuad, setInnerQuad] = useState<SpeedsterQuad | null>(initialInnerQuad);
  const [manualPoints, setManualPoints] = useState<readonly SpeedsterPoint[]>([]);
  const [manualError, setManualError] = useState<string | null>(null);
  const [loadedImageIdentity, setLoadedImageIdentity] = useState<string | null>(null);
  const failedImageIdentity = useRef<string | null>(null);
  const activeHandle = useRef<{ index: number; pointerId: number } | null>(null);
  const gradientMap = useRef<SpeedsterGradientMap | null>(null);
  const imageIdentity = `${imageRevision}:${imageUrl}`;
  const imageReady = loadedImageIdentity === imageIdentity && !imageRefreshError;
  const measurements = useMemo(() => {
    if (!innerQuad) return null;
    const borders = measureSpeedsterCenteringBorders(innerQuad);
    return {
      borders,
      horizontal: calculateCenteringBalance(borders.leftMm, borders.rightMm),
      vertical: calculateCenteringBalance(borders.topMm, borders.bottomMm),
    };
  }, [innerQuad]);

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = activeHandle.current;
    if (!active || !innerQuad || active.pointerId !== event.pointerId) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const next = [...innerQuad] as [
      SpeedsterPoint,
      SpeedsterPoint,
      SpeedsterPoint,
      SpeedsterPoint,
    ];
    const draggedPoint = {
      x: clampUnit((event.clientX - bounds.left) / bounds.width),
      y: clampUnit((event.clientY - bounds.top) / bounds.height),
    };
    next[active.index] = snapSpeedsterPoint(gradientMap.current, draggedPoint, {
      ...HANDLE_DIRECTIONS[active.index],
      sampleStart: 4,
      sampleLength: 90,
    });
    setInnerQuad(next);
  };

  const placeManualCorner = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (innerQuad || disabled || !imageReady || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault();
    const point = {
      x: clampUnit((event.clientX - bounds.left) / bounds.width),
      y: clampUnit((event.clientY - bounds.top) / bounds.height),
    };
    const next = [...manualPoints, point];
    if (next.length < 4) {
      setManualPoints(next);
      setManualError(null);
      return;
    }
    const quad = sanitizeSpeedsterUnitQuad(next);
    if (!quad) {
      setManualPoints([]);
      setManualError("Those points do not form the printed frame in order. Start again: top left, top right, bottom right, bottom left.");
      return;
    }
    setManualPoints([]);
    setManualError(null);
    setInnerQuad(quad);
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
        <p>{innerQuad === null
          ? `No current-engine printed frame was found. Click its corners in order: top left, top right, bottom right, bottom left. ${manualPoints.length}/4 placed.`
          : detectedBorders.length === 4
          ? "All four printed borders found. Drag only if a marker needs adjustment."
          : `${detectedBorders.length}/4 printed borders found. Set missing sides; each drag snaps locally.`}</p>
      </header>

      <div className={styles.workspace}>
        <div className={styles.imageStage}>
          <div className={styles.imageFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={imageIdentity}
              className={styles.image}
              src={imageUrl}
              crossOrigin="anonymous"
              alt={`${side.toLowerCase()} rectified trading card`}
              draggable={false}
              onLoad={(event) => {
                if (event.currentTarget.naturalWidth <= 0 || event.currentTarget.naturalHeight <= 0) {
                  failedImageIdentity.current = imageIdentity;
                  setLoadedImageIdentity(null);
                  gradientMap.current = null;
                  onImageError?.();
                  return;
                }
                failedImageIdentity.current = null;
                setLoadedImageIdentity(imageIdentity);
                gradientMap.current = gradientMapFromImage(event.currentTarget);
                onImageReady?.();
              }}
              onError={() => {
                setLoadedImageIdentity(null);
                gradientMap.current = null;
                if (failedImageIdentity.current === imageIdentity) return;
                failedImageIdentity.current = imageIdentity;
                onImageError?.();
              }}
            />
            {imageReady ? <svg
              className={styles.overlay}
              viewBox={`0 0 ${OVERLAY_WIDTH} ${OVERLAY_HEIGHT}`}
              preserveAspectRatio="none"
              aria-label="Adjustable printed-border geometry"
              onPointerDown={placeManualCorner}
              onPointerMove={moveHandle}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {innerQuad ? <polygon
                className={styles.innerQuad}
                points={innerQuad.map(overlayPoint).join(" ")}
                vectorEffect="non-scaling-stroke"
              /> : null}
              {manualPoints.map((point, index) => (
                <g key={`manual-${index}`}>
                  <circle className={styles.manualPointRing} cx={point.x * OVERLAY_WIDTH} cy={point.y * OVERLAY_HEIGHT} r="18" vectorEffect="non-scaling-stroke" />
                  <text className={styles.manualPointLabel} x={point.x * OVERLAY_WIDTH + 22} y={point.y * OVERLAY_HEIGHT - 18}>{index + 1}</text>
                </g>
              ))}
              {innerQuad?.map((point, index) => {
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
            </svg> : null}

            {imageReady && measurements ? <><span className={`${styles.imageMetric} ${styles.topMetric}`}>
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
            </span></> : null}
            {!imageReady ? (
              <div className={styles.imageStatus} role={imageRefreshError ? "alert" : "status"}>
                <strong>{imageRefreshError ? "Card image unavailable" : imageRefreshing ? "Refreshing card image…" : "Loading card image…"}</strong>
                {imageRefreshError ? <span>{imageRefreshError}</span> : null}
                {imageRefreshError && onRetryImage ? (
                  <button type="button" onClick={onRetryImage} disabled={imageRefreshing}>Retry image</button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside className={styles.readout}>
          <div>
            <span className={styles.readoutLabel}>LIVE MEASUREMENTS</span>
            {measurements ? <><dl className={styles.measurementGrid}>
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
            </div></> : <p role="status">Place all four printed-frame corners before measurements are calculated.</p>}
            {manualError ? <p role="alert">{manualError}</p> : null}
            {!innerQuad && manualPoints.length > 0 ? (
              <button type="button" disabled={disabled} onClick={() => {
                setManualPoints([]);
                setManualError(null);
              }}>
                Restart corner placement
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className={styles.continueButton}
            disabled={disabled || !imageReady || !innerQuad || !measurements}
            onClick={() => {
              if (innerQuad && measurements) onContinue({ side, innerQuad, borders: measurements.borders });
            }}
          >
            {disabled ? "Saving…" : !imageReady ? "Image required" : !innerQuad ? "Place 4 corners" : continueLabel} {imageReady && innerQuad && !disabled ? <span aria-hidden="true">→</span> : null}
          </button>
        </aside>
      </div>
    </section>
  );
}

export type { CenteringAssistProps };
