"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  SpeedsterCardSide,
  SpeedsterPoint,
  SpeedsterTraceProvenance,
} from "../../lib/ai-grader-v2/contracts";
import {
  canonicalPointToInspection,
  type SpeedsterInspectionFrame,
} from "../../lib/ai-grader-v2/inspection-frame";
import {
  SPEEDSTER_CANONICAL_TRACE_GRID,
  applyCompletedSpeedsterTraceStroke,
  canonicalCropToNormalizedBounds,
  canonicalPixelToPanelPoint,
  clipSpeedsterTraceToEditorBounds,
  copyVisibleSpeedsterTrace,
  isNonEmptySpeedsterTrace,
  initializeSpeedsterHighlighterStrokes,
  panelPointToCanonicalPixel,
  type SpeedsterCanonicalCropTransform,
  type SpeedsterCanonicalPixel,
  type SpeedsterHighlighterProposalRequest,
  type SpeedsterTraceCornerShape,
  type SpeedsterTraceTool,
} from "../../lib/ai-grader-v2/trace-editor";
import styles from "./DefectTraceEditor.module.css";

export type SpeedsterTraceEditorTarget = Readonly<{
  side: SpeedsterCardSide;
  findingId: string | null;
  sourceViewId: string;
}>;

export type SpeedsterTraceProposalInput = SpeedsterHighlighterProposalRequest & Readonly<{
  target: SpeedsterTraceEditorTarget;
  cropTransform: SpeedsterCanonicalCropTransform;
  visibleTrace: Uint8Array;
}>;

export type SpeedsterInMemoryTraceSave = Readonly<{
  target: SpeedsterTraceEditorTarget;
  cropTransform: SpeedsterCanonicalCropTransform;
  trace: Uint8Array;
  highlighterStrokes: readonly SpeedsterHighlighterProposalRequest[];
  priorTraceProvenance?: SpeedsterTraceProvenance;
}>;

type DefectTraceEditorProps = {
  target: SpeedsterTraceEditorTarget;
  imageUrl: string;
  inspectionFrame: SpeedsterInspectionFrame;
  cropTransform: SpeedsterCanonicalCropTransform;
  cornerShape: SpeedsterTraceCornerShape;
  initialTrace: Uint8Array;
  initialTraceProvenance?: SpeedsterTraceProvenance;
  onHighlighterStrokeEnd?: (
    input: SpeedsterTraceProposalInput,
  ) => Uint8Array | null | void | Promise<Uint8Array | null | void>;
  onSave?: (input: SpeedsterInMemoryTraceSave) => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  onImageError?: () => void;
  onError?: (message: string) => void;
};

const TOOL_WIDTH_PIXELS: Readonly<Record<SpeedsterTraceTool, number>> = {
  HIGHLIGHTER: 30,
  BRUSH: 12,
  ERASER: 20,
};

function normalizedPanelPoint(event: ReactPointerEvent<HTMLDivElement>): SpeedsterPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
}

function samePixel(left: SpeedsterCanonicalPixel | undefined, right: SpeedsterCanonicalPixel) {
  return left?.x === right.x && left.y === right.y;
}

export function DefectTraceEditor({
  target,
  imageUrl,
  inspectionFrame,
  cropTransform,
  cornerShape,
  initialTrace,
  initialTraceProvenance,
  onHighlighterStrokeEnd,
  onSave,
  onCancel,
  onImageError,
  onError,
}: DefectTraceEditorProps) {
  const [tool, setTool] = useState<SpeedsterTraceTool>("HIGHLIGHTER");
  const [trace, setTrace] = useState(() => (
    clipSpeedsterTraceToEditorBounds(initialTrace, cropTransform, cornerShape)
  ));
  const [activeStroke, setActiveStroke] = useState<readonly SpeedsterCanonicalPixel[]>([]);
  const [proposalPending, setProposalPending] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const traceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<SpeedsterCanonicalPixel[]>([]);
  const highlighterStrokesRef = useRef<SpeedsterHighlighterProposalRequest[]>(
    initializeSpeedsterHighlighterStrokes(initialTraceProvenance),
  );
  const editRevisionRef = useRef(0);
  const mountedGenerationRef = useRef(0);
  const latestProposalRef = useRef(0);

  const normalizedCrop = useMemo(
    () => canonicalCropToNormalizedBounds(cropTransform),
    [cropTransform],
  );
  const inspectionCrop = useMemo(() => {
    const topLeft = canonicalPointToInspection(
      { x: normalizedCrop.x, y: normalizedCrop.y },
      inspectionFrame,
    );
    const bottomRight = canonicalPointToInspection({
      x: normalizedCrop.x + normalizedCrop.width,
      y: normalizedCrop.y + normalizedCrop.height,
    }, inspectionFrame);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }, [inspectionFrame, normalizedCrop]);
  const traceCanvasWidth = Math.ceil(cropTransform.crop.width) + 1;
  const traceCanvasHeight = Math.ceil(cropTransform.crop.height) + 1;
  const strokePoints = activeStroke
    .map((point) => canonicalPixelToPanelPoint(point, cropTransform))
    .map(({ x, y }) => `${x * 1000},${y * 1000}`)
    .join(" ");
  const validTrace = isNonEmptySpeedsterTrace(trace);

  useEffect(() => {
    const canvas = traceCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let panelY = 0; panelY < canvas.height; panelY += 1) {
      for (let panelX = 0; panelX < canvas.width; panelX += 1) {
        const canonical = panelPointToCanonicalPixel({
          x: canvas.width === 1 ? 0 : panelX / (canvas.width - 1),
          y: canvas.height === 1 ? 0 : panelY / (canvas.height - 1),
        }, cropTransform);
        const traceOffset = canonical.y * SPEEDSTER_CANONICAL_TRACE_GRID.width + canonical.x;
        if (!trace[traceOffset]) continue;
        const pixelOffset = (panelY * canvas.width + panelX) * 4;
        pixels.data[pixelOffset] = 244;
        pixels.data[pixelOffset + 1] = 194;
        pixels.data[pixelOffset + 2] = 91;
        pixels.data[pixelOffset + 3] = 150;
      }
    }
    context.putImageData(pixels, 0, 0);
  }, [cropTransform, trace]);

  useEffect(() => () => {
    mountedGenerationRef.current += 1;
  }, []);

  const appendPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    const point = panelPointToCanonicalPixel(normalizedPanelPoint(event), cropTransform);
    if (samePixel(activeStrokeRef.current.at(-1), point)) return;
    activeStrokeRef.current = [...activeStrokeRef.current, point];
    setActiveStroke(activeStrokeRef.current);
  };

  const clearPointer = () => {
    activePointerIdRef.current = null;
    activeStrokeRef.current = [];
    setActiveStroke([]);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    appendPointer(event);
    const points = activeStrokeRef.current;
    clearPointer();
    if (points.length === 0) return;

    const result = applyCompletedSpeedsterTraceStroke({
      trace,
      tool,
      points,
      strokeWidthPixels: TOOL_WIDTH_PIXELS[tool],
    });
    if (!result.proposalRequest) {
      editRevisionRef.current += 1;
      setTrace(clipSpeedsterTraceToEditorBounds(result.trace, cropTransform, cornerShape));
      onError?.("");
      return;
    }

    const request = result.proposalRequest;
    highlighterStrokesRef.current = [...highlighterStrokesRef.current, request];
    const requestRevision = editRevisionRef.current;
    const requestGeneration = mountedGenerationRef.current;
    const proposalId = latestProposalRef.current + 1;
    latestProposalRef.current = proposalId;
    setProposalPending(true);
    Promise.resolve(onHighlighterStrokeEnd?.({
      ...request,
      target,
      cropTransform,
      visibleTrace: copyVisibleSpeedsterTrace(trace),
    })).then((proposal) => {
      if (
        requestGeneration !== mountedGenerationRef.current ||
        proposalId !== latestProposalRef.current ||
        requestRevision !== editRevisionRef.current
      ) return;
      if (!proposal || proposal.length !== trace.length) {
        onError?.("SAM could not propose a trace. The visible trace is unchanged and remains editable.");
        return;
      }
      editRevisionRef.current += 1;
      setTrace(clipSpeedsterTraceToEditorBounds(proposal, cropTransform, cornerShape));
      onError?.("");
    }).catch(() => {
      onError?.("SAM could not propose a trace. The visible trace is unchanged and remains editable.");
    }).finally(() => {
      if (
        requestGeneration === mountedGenerationRef.current &&
        proposalId === latestProposalRef.current
      ) setProposalPending(false);
    });
  };

  return (
    <section className={styles.editor} aria-label="Defect trace editor">
      <div className={styles.tools} aria-label="Trace tools">
        {(["HIGHLIGHTER", "BRUSH", "ERASER"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={tool === value ? styles.activeTool : undefined}
            onClick={() => setTool(value)}
          >{value === "HIGHLIGHTER" ? "Highlighter" : value === "BRUSH" ? "Brush" : "Eraser"}</button>
        ))}
      </div>
      <div
        className={styles.surface}
        onPointerDown={(event) => {
          if (savePending || activePointerIdRef.current !== null) return;
          activePointerIdRef.current = event.pointerId;
          const point = panelPointToCanonicalPixel(normalizedPanelPoint(event), cropTransform);
          activeStrokeRef.current = [point];
          setActiveStroke([point]);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={appendPointer}
        onPointerUp={finishPointer}
        onPointerCancel={clearPointer}
      >
        <svg
          className={styles.image}
          viewBox={`${inspectionCrop.x} ${inspectionCrop.y} ${inspectionCrop.width} ${inspectionCrop.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <image
            href={imageUrl}
            width="1"
            height="1"
            preserveAspectRatio="none"
            onError={onImageError}
          />
        </svg>
        <canvas
          ref={traceCanvasRef}
          className={styles.trace}
          width={traceCanvasWidth}
          height={traceCanvasHeight}
          aria-hidden="true"
        />
        {strokePoints ? (
          <svg className={styles.stroke} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              className={styles[tool.toLowerCase() as Lowercase<SpeedsterTraceTool>]}
              points={strokePoints}
            />
          </svg>
        ) : null}
        <span className={styles.label}>
          {target.findingId ? "EDIT FINDING TRACE" : "NEW FINDING TRACE"}
        </span>
      </div>
      <div className={styles.status} aria-live="polite">
        <span>{proposalPending ? "SAM proposal requested once for this stroke…" : savePending ? "Measuring the saved trace…" : "Visible pixels are the Save authority."}</span>
        <span>{(TOOL_WIDTH_PIXELS[tool] / SPEEDSTER_CANONICAL_TRACE_GRID.pixelsPerMm).toFixed(2)} mm</span>
      </div>
      <div className={styles.actions}>
        {onCancel ? <button type="button" onClick={onCancel}>Cancel</button> : null}
        <button
          type="button"
          className={styles.save}
          disabled={!validTrace || savePending}
          onClick={() => {
            if (!validTrace) {
              onError?.("Draw or accept a non-empty trace before Save.");
              return;
            }
            const saved = {
              target,
              cropTransform,
              trace: clipSpeedsterTraceToEditorBounds(trace, cropTransform, cornerShape),
              highlighterStrokes: highlighterStrokesRef.current.map((stroke) => ({
                ...stroke,
                canonicalPoints: stroke.canonicalPoints.map((point) => ({ ...point })),
              })),
              priorTraceProvenance: initialTraceProvenance,
            };
            mountedGenerationRef.current += 1;
            latestProposalRef.current += 1;
            setProposalPending(false);
            setSavePending(true);
            Promise.resolve(onSave?.(saved)).then((applied) => {
              if (applied === false) {
                onError?.("The trace was not saved. The visible trace remains editable.");
                return;
              }
              onError?.("");
            }).catch(() => {
              onError?.("The trace was not saved. The visible trace remains editable.");
            }).finally(() => setSavePending(false));
          }}
        >Save trace</button>
      </div>
    </section>
  );
}

export type { DefectTraceEditorProps, SpeedsterTraceCornerShape };
