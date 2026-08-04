"use client";

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";
import {
  gradientMapFromImage,
  snapSpeedsterPoint,
  type SpeedsterGradientMap,
} from "../../lib/ai-grader-v2/gradient-snap";

import styles from "./GeometryAssist.module.css";

export type SpeedsterCornerShape = "ROUNDED_3_18_MM" | "SQUARE";

type GeometryAssistProps = {
  imageUrl: string;
  side: SpeedsterCardSide;
  proposedQuad: SpeedsterQuad;
  automaticPlacement: boolean;
  diagnostic: SpeedsterGeometryAttemptDiagnostic;
  cornerShape: SpeedsterCornerShape;
  onQuadChange: (quad: SpeedsterQuad) => void;
  onCornerShapeChange: (shape: SpeedsterCornerShape) => void;
  onContinue: () => void;
  onImageError: (message: string) => void;
};

export type SpeedsterGeometryAttemptDiagnostic = {
  sessionId: string;
  attemptId: number;
  side: SpeedsterCardSide;
  durationMs: number;
  corners: "present" | "null" | "unavailable";
};

export type SpeedsterGeometryImageOutcome =
  | "loaded"
  | "loaded-without-edge-map"
  | "load-error"
  | "render-error"
  | "not-rendered";

export function logSpeedsterGeometryAttempt(
  diagnostic: SpeedsterGeometryAttemptDiagnostic,
  imageLoadOutcome: SpeedsterGeometryImageOutcome,
) {
  console.info(`[Speedster geometry attempt] ${JSON.stringify({
    ...diagnostic,
    imageLoadOutcome,
  })}`);
}

function hasVisibleRenderedArea(image: HTMLImageElement) {
  const imageBounds = image.getBoundingClientRect();
  const frameBounds = image.parentElement?.getBoundingClientRect();
  if (!frameBounds) return false;
  const intersectionWidth = Math.min(imageBounds.right, frameBounds.right) - Math.max(imageBounds.left, frameBounds.left);
  const intersectionHeight = Math.min(imageBounds.bottom, frameBounds.bottom) - Math.max(imageBounds.top, frameBounds.top);
  return image.clientWidth > 0
    && image.clientHeight > 0
    && imageBounds.width > 0
    && imageBounds.height > 0
    && intersectionWidth > 0
    && intersectionHeight > 0;
}

const CORNER_LABELS = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;
const CORNER_DIRECTIONS = [
  { inwardX: 1, inwardY: 1 },
  { inwardX: -1, inwardY: 1 },
  { inwardX: -1, inwardY: -1 },
  { inwardX: 1, inwardY: -1 },
] as const;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlayPoint(point: SpeedsterPoint): string {
  return `${point.x * 1000},${point.y * 1000}`;
}

function between(first: SpeedsterPoint, second: SpeedsterPoint, fraction: number): SpeedsterPoint {
  return {
    x: first.x + (second.x - first.x) * fraction,
    y: first.y + (second.y - first.y) * fraction,
  };
}

function svgPoint(point: SpeedsterPoint): string {
  return `${point.x * 1000} ${point.y * 1000}`;
}

function roundedQuadPath(quad: SpeedsterQuad): string {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  const horizontalRadius = 3.18 / 63.5;
  const verticalRadius = 3.18 / 88.9;
  const topLeftTop = between(topLeft, topRight, horizontalRadius);
  const topRightTop = between(topRight, topLeft, horizontalRadius);
  const topRightRight = between(topRight, bottomRight, verticalRadius);
  const bottomRightRight = between(bottomRight, topRight, verticalRadius);
  const bottomRightBottom = between(bottomRight, bottomLeft, horizontalRadius);
  const bottomLeftBottom = between(bottomLeft, bottomRight, horizontalRadius);
  const bottomLeftLeft = between(bottomLeft, topLeft, verticalRadius);
  const topLeftLeft = between(topLeft, bottomLeft, verticalRadius);
  return [
    `M ${svgPoint(topLeftTop)}`,
    `L ${svgPoint(topRightTop)} Q ${svgPoint(topRight)} ${svgPoint(topRightRight)}`,
    `L ${svgPoint(bottomRightRight)} Q ${svgPoint(bottomRight)} ${svgPoint(bottomRightBottom)}`,
    `L ${svgPoint(bottomLeftBottom)} Q ${svgPoint(bottomLeft)} ${svgPoint(bottomLeftLeft)}`,
    `L ${svgPoint(topLeftLeft)} Q ${svgPoint(topLeft)} ${svgPoint(topLeftTop)} Z`,
  ].join(" ");
}

export function GeometryAssist({
  imageUrl,
  side,
  proposedQuad,
  automaticPlacement,
  diagnostic,
  cornerShape,
  onQuadChange,
  onCornerShapeChange,
  onContinue,
  onImageError,
}: GeometryAssistProps) {
  const activeHandle = useRef<{ index: number; pointerId: number } | null>(null);
  const gradientMap = useRef<SpeedsterGradientMap | null>(null);
  const outcomeLogged = useRef(false);

  const reportImageOutcome = (outcome: SpeedsterGeometryImageOutcome) => {
    if (outcomeLogged.current) return;
    outcomeLogged.current = true;
    logSpeedsterGeometryAttempt(diagnostic, outcome);
  };

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = activeHandle.current;
    if (!active || active.pointerId !== event.pointerId) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const draggedPoint = {
      x: clampUnit((event.clientX - bounds.left) / bounds.width),
      y: clampUnit((event.clientY - bounds.top) / bounds.height),
    };
    const point = snapSpeedsterPoint(gradientMap.current, draggedPoint, {
      ...CORNER_DIRECTIONS[active.index],
      sampleStart: cornerShape === "ROUNDED_3_18_MM" ? 30 : 8,
      sampleLength: 125,
    });
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
        <p>{automaticPlacement
          ? "Physical card found. Drag only if a gold marker needs adjustment."
          : "Set the four physical corners. Each drag snaps to the nearby card edge."}</p>
      </header>

      <div className={styles.workspace}>
        <div className={styles.imageFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.image}
            src={imageUrl}
            crossOrigin="anonymous"
            alt={`${side.toLowerCase()} trading card`}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              const nextGradientMap = gradientMapFromImage(image);
              gradientMap.current = nextGradientMap;
              window.requestAnimationFrame(() => {
                if (!image.isConnected) return;
                if (!hasVisibleRenderedArea(image)) {
                  onImageError(
                    `The ${side.toLowerCase()} card image loaded but has no visible rendered area. Manual corner controls remain available.`,
                  );
                  reportImageOutcome("render-error");
                  return;
                }
                if (!nextGradientMap) {
                  onImageError(
                    `The ${side.toLowerCase()} card image loaded, but edge snapping could not read it. Manual corner controls remain available.`,
                  );
                  reportImageOutcome("loaded-without-edge-map");
                  return;
                }
                reportImageOutcome("loaded");
              });
            }}
            onError={() => {
              onImageError(
                `The ${side.toLowerCase()} card image failed to load. Manual corner controls remain available.`,
              );
              reportImageOutcome("load-error");
            }}
          />
          <svg
            className={styles.overlay}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="Adjustable card corner geometry"
            onPointerMove={moveHandle}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {cornerShape === "ROUNDED_3_18_MM" ? (
              <path className={styles.quad} d={roundedQuadPath(proposedQuad)} vectorEffect="non-scaling-stroke" />
            ) : (
              <polygon
                className={styles.quad}
                points={proposedQuad.map(overlayPoint).join(" ")}
                vectorEffect="non-scaling-stroke"
              />
            )}
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
