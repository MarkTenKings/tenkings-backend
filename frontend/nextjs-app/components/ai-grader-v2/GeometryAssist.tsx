"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterQuad,
} from "../../lib/ai-grader-v2/contracts";
import type { SpeedsterPhysicalGeometryPlacement } from "../../lib/ai-grader-v2/color-geometry";
import { sanitizeSpeedsterUnitQuad } from "../../lib/ai-grader-v2/geometry";
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
  proposedQuad: SpeedsterQuad | null;
  placement: SpeedsterPhysicalGeometryPlacement | "HUMAN_EDITED";
  diagnostic: SpeedsterGeometryAttemptDiagnostic;
  cornerShape: SpeedsterCornerShape;
  onQuadChange: (quad: SpeedsterQuad) => void;
  onCornerShapeChange: (shape: SpeedsterCornerShape) => void;
  onContinue: () => void;
  onImageError: (message: string) => void;
  onRefreshImage?: () => void;
  disabled?: boolean;
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

export function orderedSpeedsterManualQuad(points: readonly SpeedsterPoint[]): SpeedsterQuad | null {
  return sanitizeSpeedsterUnitQuad(points);
}

export function GeometryAssist({
  imageUrl,
  side,
  proposedQuad,
  placement,
  diagnostic,
  cornerShape,
  onQuadChange,
  onCornerShapeChange,
  onContinue,
  onImageError,
  onRefreshImage,
  disabled = false,
}: GeometryAssistProps) {
  const activeHandle = useRef<{ index: number; pointerId: number } | null>(null);
  const imageElement = useRef<HTMLImageElement | null>(null);
  const gradientMap = useRef<SpeedsterGradientMap | null>(null);
  const outcomeLogged = useRef(false);
  const [manualPoints, setManualPoints] = useState<readonly SpeedsterPoint[]>([]);
  const [manualError, setManualError] = useState<string | null>(null);
  const [imageVisible, setImageVisible] = useState(false);

  const reportImageOutcome = (outcome: SpeedsterGeometryImageOutcome) => {
    if (outcomeLogged.current) return;
    outcomeLogged.current = true;
    logSpeedsterGeometryAttempt(diagnostic, outcome);
  };

  const inspectLoadedImage = (image: HTMLImageElement) => {
    const nextGradientMap = gradientMapFromImage(image);
    gradientMap.current = nextGradientMap;
    window.requestAnimationFrame(() => {
      if (!image.isConnected) return;
      if (!hasVisibleRenderedArea(image)) {
        setImageVisible(false);
        onImageError(
          `The ${side.toLowerCase()} card image loaded but has no visible rendered area. Geometry confirmation remains blocked.`,
        );
        reportImageOutcome("render-error");
        return;
      }
      setImageVisible(true);
      if (!nextGradientMap) {
        onImageError(
          `The ${side.toLowerCase()} card image is visible, but edge snapping could not read it. Human corner controls remain available.`,
        );
        reportImageOutcome("loaded-without-edge-map");
        return;
      }
      reportImageOutcome("loaded");
    });
  };

  useEffect(() => {
    const image = imageElement.current;
    // Browsers expose non-zero natural dimensions for an already-decoded image even
    // when the cached-image `complete` flag is observed during a React mount race.
    // The dimensions are the useful authority here; a genuinely pending image still
    // reports zero and will be handled by its load event.
    if (image && image.naturalWidth > 0 && image.naturalHeight > 0) inspectLoadedImage(image);
    // The component is keyed by source URL; inspect only the exact mounted source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = activeHandle.current;
    if (!active || !proposedQuad || active.pointerId !== event.pointerId) return;

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
    const validated = sanitizeSpeedsterUnitQuad(next);
    if (!validated) {
      setManualError("That move would cross, collapse, or reorder the physical card corners. The last valid geometry is unchanged.");
      return;
    }
    setManualError(null);
    onQuadChange(validated);
  };

  const placeManualCorner = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (proposedQuad || disabled || !imageVisible || event.button !== 0) return;
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
    const quad = orderedSpeedsterManualQuad(next);
    if (!quad) {
      setManualPoints([]);
      setManualError("Those points do not form the card in the required order. Start again: top left, top right, bottom right, bottom left.");
      return;
    }
    setManualPoints([]);
    setManualError(null);
    onQuadChange(quad);
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (activeHandle.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeHandle.current = null;
  };

  const placementCopy = placement === "AUTO_ACCEPTED"
    ? "CURRENT ENGINE OUTLINE · REVIEW REQUIRED"
    : placement === "DIAGNOSTIC_DRAFT"
      ? "REJECTED DIAGNOSTIC · HUMAN REVIEW ONLY"
      : placement === "HUMAN_EDITED"
        ? "HUMAN-AUTHORED DRAFT"
        : "MANUAL FOUR-CORNER MODE";
  const validatedQuad = proposedQuad ? sanitizeSpeedsterUnitQuad(proposedQuad) : null;
  const geometryReady = Boolean(validatedQuad && imageVisible);
  const geometryError = proposedQuad && !validatedQuad
    ? "The four physical corners do not form a valid perimeter. Reposition them before continuing."
    : manualError;

  return (
    <section className={styles.assist} aria-label={`${side.toLowerCase()} card geometry`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{side} · GEOMETRY</span>
          <h2>Set the four corners.</h2>
        </div>
        <p>{placement === "AUTO_ACCEPTED"
          ? "The current engine found and displayed all four corners. Check every edge before confirming."
          : placement === "DIAGNOSTIC_DRAFT"
            ? "The best contour failed automatic checks. It is not authoritative; inspect and edit every side."
            : proposedQuad
              ? "This geometry was placed or changed by a human. Check every edge before confirming."
              : `Click the physical corners in order: top left, top right, bottom right, bottom left. ${manualPoints.length}/4 placed.`}</p>
      </header>

      <div className={styles.workspace}>
        <div className={styles.imageFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageElement}
            className={styles.image}
            src={imageUrl}
            crossOrigin="anonymous"
            alt={`${side.toLowerCase()} trading card`}
            draggable={false}
            onLoad={(event) => inspectLoadedImage(event.currentTarget)}
            onError={() => {
              setImageVisible(false);
              onImageError(
                `The ${side.toLowerCase()} card image failed to load. Geometry confirmation remains blocked until the exact source is visible.`,
              );
              reportImageOutcome("load-error");
            }}
          />
          <svg
            className={styles.overlay}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            aria-label="Adjustable card corner geometry"
            onPointerDown={placeManualCorner}
            onPointerMove={moveHandle}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {proposedQuad ? cornerShape === "ROUNDED_3_18_MM" ? (
              <path
                className={placement === "AUTO_ACCEPTED" ? styles.automaticQuad
                  : placement === "DIAGNOSTIC_DRAFT" ? styles.diagnosticQuad : styles.humanQuad}
                d={roundedQuadPath(proposedQuad)}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <polygon
                className={placement === "AUTO_ACCEPTED" ? styles.automaticQuad
                  : placement === "DIAGNOSTIC_DRAFT" ? styles.diagnosticQuad : styles.humanQuad}
                points={proposedQuad.map(overlayPoint).join(" ")}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {manualPoints.map((point, index) => (
              <g key={`manual-${index}`}>
                <circle className={styles.manualPointRing} cx={point.x * 1000} cy={point.y * 1000} r="24" vectorEffect="non-scaling-stroke" />
                <text className={styles.manualPointLabel} x={point.x * 1000 + 34} y={point.y * 1000 - 28}>{index + 1}</text>
              </g>
            ))}
            {proposedQuad?.map((point, index) => {
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
            <span className={styles.placementLabel}>{placementCopy}</span>
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

          {geometryError ? <p className={styles.manualError} role="alert">{geometryError}</p> : null}
          {!imageVisible ? (
            <div className={styles.imageBlocker} role="status">
              <span>Waiting for the exact source image to be visibly rendered.</span>
              {onRefreshImage ? (
                <button type="button" onClick={onRefreshImage} disabled={disabled}>Refresh exact source image</button>
              ) : null}
            </div>
          ) : null}

          <button type="button" className={styles.continueButton} onClick={onContinue} disabled={disabled || !geometryReady}>
            {disabled
              ? "Preparing…"
              : !imageVisible
                ? "Source image unavailable"
                : proposedQuad
                  ? `Confirm ${side === "FRONT" ? "Front" : "Back"} geometry · Continue`
                  : `Place ${4 - manualPoints.length} corners`}
            {!disabled && geometryReady ? <span aria-hidden="true">→</span> : null}
          </button>
        </aside>
      </div>
    </section>
  );
}

export type { GeometryAssistProps };
