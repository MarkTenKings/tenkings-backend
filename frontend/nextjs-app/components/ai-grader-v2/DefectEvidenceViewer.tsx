"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  isSpeedsterSourceMeasuredDefect,
  type SpeedsterCardSide,
  type SpeedsterDefectType,
  type SpeedsterPoint,
  type SpeedsterReviewFinding,
} from "../../lib/ai-grader-v2/contracts";
import { speedsterFindingRegions } from "../../lib/ai-grader-v2/review-findings";
import {
  isSpeedsterMapZoneV2,
  type SpeedsterMapRegistration,
  type SpeedsterMapZoneOverlap,
} from "../../lib/ai-grader-v2/card-type-map-contracts";
import { speedsterBestAuthorizedMapZoneDiagnostic } from "../../lib/ai-grader-v2/map-filter";
import {
  SPEEDSTER_CANONICAL_FRAME,
  canonicalContourToInspection,
  canonicalPointToInspection,
  inspectionPointToCanonical,
  type SpeedsterInspectionFrame,
} from "../../lib/ai-grader-v2/inspection-frame";
import {
  createEmptySpeedsterTrace,
  createSpeedsterCanonicalCropTransform,
  createSpeedsterContourCropTransform,
  createSpeedsterTraceCropTransform,
  clipSpeedsterTraceToMaterial,
  rasterizeSpeedsterCanonicalContour,
  type SpeedsterTraceCornerShape,
} from "../../lib/ai-grader-v2/trace-editor";
import {
  decodeSpeedsterTraceRleV1,
  speedsterTraceRleV1Spans,
  type SpeedsterTraceRleV1,
} from "../../lib/ai-grader-v2/trace-codec";
import {
  speedsterSelectionBox,
  speedsterSelectionIds,
} from "../../lib/ai-grader-v2/multi-select";
import {
  DefectTraceEditor,
  type SpeedsterInMemoryTraceSave,
  type SpeedsterTraceProposalInput,
  type SpeedsterTraceSaveResult,
} from "./DefectTraceEditor";
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
  cornerShape?: SpeedsterTraceCornerShape;
  side: SpeedsterCardSide;
  defects: readonly SpeedsterReviewFinding[];
  mapRegistration?: SpeedsterMapRegistration;
  readOnly: boolean;
  busy?: boolean;
  selectedDefectId?: string | null;
  onSelectedDefectChange?: (defectId: string) => void;
  onRemoveDefects?: (
    defectIds: readonly string[],
  ) => boolean | void | Promise<boolean | void>;
  onDefectTypeChange?: (defectId: string, defectType: SpeedsterDefectType) => void;
  onTraceProposal?: (
    input: SpeedsterTraceProposalInput,
  ) => Uint8Array | null | void | Promise<Uint8Array | null | void>;
  onTraceSave?: (
    input: SpeedsterInMemoryTraceSave,
  ) => SpeedsterTraceSaveResult | Promise<SpeedsterTraceSaveResult>;
  onTraceLoad?: (findingId: string) => Promise<SpeedsterTraceRleV1 | null>;
  onImageError?: () => void;
};

type ReviewMode = "INSPECT" | "MAGNIFY" | "SMART_MARK" | "SELECT";

function points(contour: readonly SpeedsterPoint[], scale = 1): string {
  return contour.map(({ x, y }) => `${x * scale},${y * scale}`).join(" ");
}

function memorySimilarity(finding?: SpeedsterReviewFinding): string | null {
  const similarity = finding?.origin === "MEMORY"
    ? finding.memoryProposal?.similarity
    : undefined;
  return typeof similarity === "number" && Number.isFinite(similarity)
    ? similarity.toFixed(3)
    : null;
}

function center(contour: readonly SpeedsterPoint[]): SpeedsterPoint {
  if (contour.length === 0) return { x: 0.5, y: 0.5 };
  const sum = contour.reduce(
    (value, point) => ({ x: value.x + point.x, y: value.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / contour.length, y: sum.y / contour.length };
}

function traceCenter(trace: SpeedsterTraceRleV1): SpeedsterPoint {
  let minimumX: number = trace.width;
  let maximumX: number = 0;
  let minimumY: number = trace.height;
  let maximumY: number = 0;
  for (const span of speedsterTraceRleV1Spans(trace)) {
    minimumX = Math.min(minimumX, span.x);
    maximumX = Math.max(maximumX, span.x + span.width - 1);
    minimumY = Math.min(minimumY, span.y);
    maximumY = Math.max(maximumY, span.y);
  }
  return {
    x: ((minimumX + maximumX) / 2) / (trace.width - 1),
    y: ((minimumY + maximumY) / 2) / (trace.height - 1),
  };
}

function findingMarker(
  finding: SpeedsterReviewFinding,
  inspectionFrame: SpeedsterInspectionFrame,
  trace?: SpeedsterTraceRleV1,
): SpeedsterPoint {
  if (trace) return canonicalPointToInspection(traceCenter(trace), inspectionFrame);
  return center(speedsterFindingRegions(finding).flatMap((region) =>
    canonicalContourToInspection(region.canonicalContour, inspectionFrame)));
}

function mapOverlapCounts(overlap: SpeedsterMapZoneOverlap) {
  return "totalPixels" in overlap
    ? {
        covered: overlap.coveredPixels,
        total: overlap.totalPixels,
        unit: "canonical-mask pixels",
      }
    : {
        covered: overlap.coveredVertices,
        total: overlap.totalVertices,
        unit: "contour vertices",
      };
}

function ExactTraceOverlay({
  trace,
  inspectionFrame,
}: {
  trace?: SpeedsterTraceRleV1;
  inspectionFrame: SpeedsterInspectionFrame;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, 1270, 1778);
    context.fillStyle = "rgba(243, 213, 139, 0.42)";
    if (trace) {
      for (const span of speedsterTraceRleV1Spans(trace)) {
        context.fillRect(span.x, span.y, span.width, 1);
      }
    }
  }, [trace]);
  const { cardBounds } = inspectionFrame;
  const style = {
    left: `${(cardBounds.x / (inspectionFrame.width - 1)) * 100}%`,
    top: `${(cardBounds.y / (inspectionFrame.height - 1)) * 100}%`,
    width: `${((cardBounds.width - 1) / (inspectionFrame.width - 1)) * 100}%`,
    height: `${((cardBounds.height - 1) / (inspectionFrame.height - 1)) * 100}%`,
  };
  return <canvas ref={canvasRef} className={styles.traceOverlay} style={style} width={1270} height={1778} aria-hidden="true" />;
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
  cornerShape = "SQUARE",
  side,
  defects,
  mapRegistration,
  readOnly,
  busy = false,
  selectedDefectId,
  onSelectedDefectChange,
  onRemoveDefects,
  onDefectTypeChange,
  onTraceProposal,
  onTraceSave,
  onTraceLoad,
  onImageError,
}: DefectEvidenceViewerProps) {
  const [localId, setLocalId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mode, setMode] = useState<ReviewMode>("INSPECT");
  const [pointer, setPointer] = useState<SpeedsterPoint | null>(null);
  const [newTraceAnchor, setNewTraceAnchor] = useState<SpeedsterPoint | null>(null);
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [traceError, setTraceError] = useState("");
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionStart, setSelectionStart] = useState<SpeedsterPoint | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<SpeedsterPoint | null>(null);
  const [batchRemovePending, setBatchRemovePending] = useState(false);
  const [showMapZones, setShowMapZones] = useState(Boolean(mapRegistration));
  const [readyMasterKey, setReadyMasterKey] = useState<string | null>(null);
  const [failedMasterKey, setFailedMasterKey] = useState<string | null>(null);
  const [hydratedTrace, setHydratedTrace] = useState<{
    findingId: string;
    trace: SpeedsterTraceRleV1;
  } | null>(null);
  const requestedTraceKey = useRef<string | null>(null);
  const selectionDragged = useRef(false);
  const masterKey = `${side}:${masterImageUrl}`;
  const masterReady = readyMasterKey === masterKey;
  const masterFailed = failedMasterKey === masterKey;
  const visibleDefects = useMemo(
    () => defects.filter((defect) => defect.side === side),
    [defects, side],
  );
  const visibleIds = useMemo(
    () => new Set(visibleDefects.map(({ id }) => id)),
    [visibleDefects],
  );
  useEffect(() => {
    setBatchSelectedIds((current) => {
      const retained = new Set([...current].filter((id) => visibleIds.has(id)));
      return retained.size === current.size ? current : retained;
    });
  }, [visibleIds]);
  const selectedId =
    selectedDefectId === undefined
      ? localId && visibleIds.has(localId) ? localId : visibleDefects[0]?.id
      : selectedDefectId;
  const activeId = readOnly && hoveredId && visibleIds.has(hoveredId) ? hoveredId : selectedId;
  const active = visibleDefects.find(({ id }) => id === activeId);
  const activeMapDiagnostic = useMemo(() => {
    if (!active || !mapRegistration || mapRegistration.side !== side) return null;
    return speedsterBestAuthorizedMapZoneDiagnostic(active, mapRegistration.projectedZones);
  }, [active, mapRegistration, side]);
  const activeTrace = active?.finalTrace ?? active?.detectorMask ?? (
    active && hydratedTrace?.findingId === active.id && hydratedTrace.trace.sha256 === active.traceSha256
      ? hydratedTrace.trace
      : undefined
  );
  useEffect(() => {
    const findingId = active?.id;
    const traceSha256 = active?.traceSha256;
    setHydratedTrace((current) => (
      current && current.findingId === findingId && current.trace.sha256 === traceSha256
        ? current
        : null
    ));
    if (!findingId || !traceSha256 || active?.finalTrace || !onTraceLoad) {
      if (!findingId || !traceSha256) requestedTraceKey.current = null;
      if (!traceSha256 || active?.finalTrace) setTraceError("");
      return;
    }
    if (hydratedTrace?.findingId === findingId && hydratedTrace.trace.sha256 === traceSha256) return;
    const requestKey = `${findingId}:${traceSha256}`;
    if (requestedTraceKey.current === requestKey) return;
    requestedTraceKey.current = requestKey;
    let cancelled = false;
    setTraceError("");
    void onTraceLoad(findingId).then((trace) => {
      if (cancelled || requestedTraceKey.current !== requestKey) return;
      if (!trace || trace.sha256 !== traceSha256) {
        setTraceError("The exact saved trace could not be loaded. The finding remains unchanged.");
        return;
      }
      setHydratedTrace({ findingId, trace });
      setTraceError("");
    }).catch(() => {
      if (!cancelled && requestedTraceKey.current === requestKey) {
        setTraceError("The exact saved trace could not be loaded. The finding remains unchanged.");
      }
    });
    return () => { cancelled = true; };
  }, [active?.finalTrace, active?.id, active?.traceSha256, hydratedTrace, onTraceLoad]);
  const activeRegions = useMemo(
    () => active ? speedsterFindingRegions(active) : [],
    [active],
  );
  const frameAspect = inspectionFrame.width / inspectionFrame.height;
  const activeContours = activeRegions.map((region) =>
    canonicalContourToInspection(region.canonicalContour, inspectionFrame));
  const activeContour = activeContours.length > 0 ? activeContours.flat() : null;
  const activeCrop = activeContour ? crop(activeContour, frameAspect) : null;
  const activeSimilarity = memorySimilarity(active);
  const traceTarget = useMemo(() => {
    if (!readOnly && newTraceAnchor) {
      return {
        side,
        findingId: null,
        sourceViewId: `${side}:ORIGINAL`,
        cropTransform: createSpeedsterCanonicalCropTransform({ anchor: newTraceAnchor }),
        initialTrace: createEmptySpeedsterTrace(),
        initialTraceProvenance: undefined,
      };
    }
    if (readOnly || !active || editingFindingId !== active.id) return null;
    if (isSpeedsterSourceMeasuredDefect(active) && !activeTrace) return null;
    if (active.traceSha256 && !activeTrace) return null;
    const representative = activeRegions[0];
    if (!representative) return null;
    const sourceTrace = activeTrace
      ? decodeSpeedsterTraceRleV1(activeTrace)
      : rasterizeSpeedsterCanonicalContour(representative.canonicalContour);
    const initialTrace = clipSpeedsterTraceToMaterial(sourceTrace, cornerShape);
    return {
      side,
      findingId: active.id,
      sourceViewId: active.sourceViewId,
      cropTransform: activeTrace
        ? createSpeedsterTraceCropTransform(initialTrace)
        : createSpeedsterContourCropTransform(representative.canonicalContour),
      initialTrace,
      initialTraceProvenance: activeTrace ? active.traceProvenance : undefined,
    };
  }, [active, activeRegions, activeTrace, cornerShape, editingFindingId, newTraceAnchor, readOnly, side]);
  const activeTypes = !active || active.defectType === "FAINT_COLOR_VARIATION"
    ? Object.keys(LABELS) as SpeedsterDefectType[]
    : SURFACE_TYPES.includes(active.defectType)
      ? SURFACE_TYPES
      : EDGE_CORNER_TYPES;
  const metrics = activeRegions.flatMap((region) => [
    [`${region.zone} · WIDTH`, `${region.measurement.widthMm.toFixed(2)} mm`],
    [`${region.zone} · HEIGHT`, `${region.measurement.heightMm.toFixed(2)} mm`],
    [`${region.zone} · AREA`, `${region.measurement.areaMm2.toFixed(2)} mm²`],
    [`${region.zone} · ZONE`, `${region.measurement.zonePercent.toFixed(2)}%`],
    [`${region.zone} · MULTIPLIER`, `${region.measurement.multiplier.toFixed(2)}×`],
    [`${region.zone} · SUBGRADE EFFECT`, `−${Math.abs(region.measurement.subgradeEffect).toFixed(2)}`],
  ]);

  const select = (id: string) => {
    if (selectedDefectId === undefined) setLocalId(id);
    onSelectedDefectChange?.(id);
  };

  const pointFromEvent = (event: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLDivElement;
  }): SpeedsterPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const openTraceEditorAtMasterAnchor = (point: SpeedsterPoint) => {
    const canonical = inspectionPointToCanonical(point, inspectionFrame);
    if (!canonical) {
      setTraceError("Choose a point on the physical card to open the trace editor.");
      return;
    }
    setTraceError("");
    setEditingFindingId(null);
    setNewTraceAnchor(canonical);
    setMode("INSPECT");
  };

  const lensStyle = pointer ? {
    "--lens-x": `${pointer.x * 100}%`,
    "--lens-y": `${pointer.y * 100}%`,
    backgroundImage: `url(${magnifyImageUrl ?? masterImageUrl})`,
  } as CSSProperties : undefined;
  const selection = selectionStart && selectionCurrent
    ? speedsterSelectionBox(selectionStart, selectionCurrent)
    : null;
  const selectionStyle = selection ? {
    left: `${selection.left * 100}%`,
    top: `${selection.top * 100}%`,
    width: `${(selection.right - selection.left) * 100}%`,
    height: `${(selection.bottom - selection.top) * 100}%`,
  } as CSSProperties : undefined;

  const clearBatchSelection = () => {
    setBatchSelectedIds(new Set());
    setSelectionStart(null);
    setSelectionCurrent(null);
  };

  const toggleBatchSelection = (defectId: string) => {
    setBatchSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(defectId)) next.delete(defectId);
      else next.add(defectId);
      return next;
    });
  };

  const removeBatchSelection = () => {
    if (batchRemovePending || batchSelectedIds.size === 0) return;
    const defectIds = visibleDefects.flatMap(({ id }) => batchSelectedIds.has(id) ? [id] : []);
    setBatchRemovePending(true);
    void Promise.resolve(onRemoveDefects?.(defectIds)).then((applied) => {
      if (applied !== false) clearBatchSelection();
    }).finally(() => setBatchRemovePending(false));
  };

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
                clearBatchSelection();
                setPointer(null);
                setMode(mode === "MAGNIFY" ? "INSPECT" : "MAGNIFY");
              }}
            >Magnify</button>
            {!readOnly ? (
              <button
                type="button"
                disabled={busy}
                className={mode === "SELECT" ? styles.toolActive : undefined}
                onClick={() => {
                  setTraceError("");
                  setNewTraceAnchor(null);
                  setEditingFindingId(null);
                  setPointer(null);
                  if (mode === "SELECT") clearBatchSelection();
                  setMode(mode === "SELECT" ? "INSPECT" : "SELECT");
                }}
              >Select</button>
            ) : null}
            {!readOnly ? (
              <button
                type="button"
                disabled={busy}
                className={mode === "SMART_MARK" ? styles.toolActive : undefined}
                onClick={() => {
                  clearBatchSelection();
                  setTraceError("");
                  setNewTraceAnchor(null);
                  setMode(mode === "SMART_MARK" ? "INSPECT" : "SMART_MARK");
                }}
              >Smart-Mark</button>
            ) : null}
            {mapRegistration ? (
              <button
                type="button"
                className={showMapZones ? styles.toolActive : undefined}
                onClick={() => setShowMapZones((current) => !current)}
              >Map zones</button>
            ) : null}
            <b>{visibleDefects.length.toString().padStart(2, "0")}</b>
          </div>
        </header>
        <div
          className={`${styles.cardStage} ${mode === "SMART_MARK" ? styles.marking : ""} ${mode === "SELECT" ? styles.selecting : ""}`}
          style={{ aspectRatio: `${inspectionFrame.width} / ${inspectionFrame.height}` }}
          onPointerDown={(event) => {
            if (mode !== "SELECT" || event.button !== 0) return;
            const point = pointFromEvent(event);
            selectionDragged.current = false;
            setSelectionStart(point);
            setSelectionCurrent(point);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (mode === "MAGNIFY") setPointer(pointFromEvent(event));
            if (mode === "SELECT" && selectionStart) setSelectionCurrent(pointFromEvent(event));
          }}
          onPointerUp={(event) => {
            if (mode !== "SELECT" || !selectionStart) return;
            const end = pointFromEvent(event);
            const dragged = Math.hypot(end.x - selectionStart.x, end.y - selectionStart.y) >= 0.006;
            if (dragged) {
              const box = speedsterSelectionBox(selectionStart, end);
              setBatchSelectedIds(new Set(speedsterSelectionIds(
                visibleDefects.map((defect) => ({
                  id: defect.id,
                  point: findingMarker(
                    defect,
                    inspectionFrame,
                    defect.id === activeId ? activeTrace : undefined,
                  ),
                })),
                box,
              )));
              selectionDragged.current = true;
            }
            setSelectionStart(null);
            setSelectionCurrent(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            setSelectionStart(null);
            setSelectionCurrent(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerLeave={() => setPointer(null)}
          onClick={(event) => {
            if (mode === "SELECT") {
              if (selectionDragged.current) selectionDragged.current = false;
              else clearBatchSelection();
              return;
            }
            if (mode !== "SMART_MARK") return;
            openTraceEditorAtMasterAnchor(pointFromEvent(event));
          }}
        >
          <Image
            key={masterKey}
            className={styles.masterImage}
            src={masterImageUrl}
            alt={`${side.toLowerCase()} card with measured defect overlays`}
            fill
            sizes="(max-width: 860px) 100vw, 55vw"
            unoptimized
            onLoad={() => {
              setFailedMasterKey(null);
              setReadyMasterKey(masterKey);
            }}
            onError={() => {
              setReadyMasterKey(null);
              setFailedMasterKey(masterKey);
              onImageError?.();
            }}
          />
          {!masterReady ? (
            <div className={styles.imageReadiness} role="status">
              {masterFailed
                ? `${side === "FRONT" ? "Front" : "Back"} evidence image unavailable.`
                : `Loading ${side === "FRONT" ? "Front" : "Back"} evidence…`}
            </div>
          ) : null}
          {masterReady ? <svg
            className={styles.overlay}
            data-evidence-overlay={side}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {showMapZones && mapRegistration?.side === side ? (
              <g className={styles.mapZones} aria-label="Applied Card Map zones">
                {mapRegistration.projectedZones.map((zone) => {
                  const inspectionPolygon = zone.polygon.map((point) => (
                    canonicalPointToInspection(point, inspectionFrame)
                  ));
                  const authorized = !isSpeedsterMapZoneV2(zone) || zone.filterAuthority;
                  return <polygon
                    key={`map-zone:${zone.id}`}
                    className={authorized ? styles.authorizedMapZone : styles.contentOnlyMapZone}
                    points={points(inspectionPolygon, 1000)}
                  />;
                })}
              </g>
            ) : null}
            {visibleDefects.map((defect, index) => {
              const inspectionContours = speedsterFindingRegions(defect).map((region) =>
                canonicalContourToInspection(region.canonicalContour, inspectionFrame));
              const resolvedTrace = defect.id === activeId ? activeTrace : undefined;
              const marker = findingMarker(
                defect,
                inspectionFrame,
                resolvedTrace ?? defect.detectorMask,
              );
              const similarity = memorySimilarity(defect);
              const activeClass = batchSelectedIds.has(defect.id)
                ? styles.batchSelected
                : defect.id === activeId ? styles.active : styles.defect;
              return (
                <g
                  key={defect.id}
                  className={activeClass}
                  role="button"
                  tabIndex={0}
                  aria-label={`Defect ${index + 1}: ${LABELS[defect.defectType]}${similarity ? `, Memory similarity ${similarity}` : ""}`}
                  aria-pressed={mode === "SELECT" ? batchSelectedIds.has(defect.id) : defect.id === activeId}
                  onPointerDown={(event) => {
                    if (mode === "SELECT") event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (mode === "SELECT") {
                      if (selectionDragged.current) selectionDragged.current = false;
                      else toggleBatchSelection(defect.id);
                      return;
                    }
                    setNewTraceAnchor(null);
                    setEditingFindingId(defect.id);
                    if (!defect.traceSha256) setTraceError("");
                    setMode("INSPECT");
                    select(defect.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (mode === "SELECT") {
                        toggleBatchSelection(defect.id);
                        return;
                      }
                      setNewTraceAnchor(null);
                      setEditingFindingId(defect.id);
                      if (!defect.traceSha256) setTraceError("");
                      setMode("INSPECT");
                      select(defect.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredId(defect.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(defect.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  {!resolvedTrace ? inspectionContours.map((inspectionContour, regionIndex) => (
                    <polygon
                      key={`${defect.id}:region:${regionIndex}`}
                      className={styles.contour}
                      points={points(inspectionContour, 1000)}
                    />
                  )) : null}
                  <circle className={styles.hitTarget} cx={marker.x * 1000} cy={marker.y * 1000} r="34" />
                  <circle className={styles.halo} cx={marker.x * 1000} cy={marker.y * 1000} r="25" />
                  <circle className={styles.marker} cx={marker.x * 1000} cy={marker.y * 1000} r="11" />
                  {similarity ? <text
                    className={styles.memoryScore}
                    x={marker.x * 1000}
                    y={marker.y < 0.08 ? marker.y * 1000 + 52 : marker.y * 1000 - 34}
                  >{similarity}</text> : null}
                </g>
              );
            })}
          </svg> : null}
          {masterReady && selectionStyle ? <div className={styles.selectionBox} style={selectionStyle} aria-hidden="true" /> : null}
          {masterReady ? <ExactTraceOverlay trace={activeTrace} inspectionFrame={inspectionFrame} /> : null}
          {masterReady && mode === "MAGNIFY" && pointer ? <div className={styles.lens} style={lensStyle} /> : null}
        </div>
      </div>

      <aside className={styles.detail} aria-live="polite">
        {!masterReady ? (
          <div className={styles.empty}>
            <span>{masterFailed ? "EVIDENCE UNAVAILABLE" : "LOADING EVIDENCE"}</span>
            <p>{masterFailed
              ? `The ${side === "FRONT" ? "Front" : "Back"} master image could not be loaded.`
              : `Loading ${side === "FRONT" ? "Front" : "Back"} evidence…`}</p>
          </div>
        ) : mode === "SELECT" ? (
          <div className={styles.selectionPanel}>
            <span>MULTI-SELECT</span>
            <h3>{batchSelectedIds.size > 0
              ? `${batchSelectedIds.size} defects selected`
              : "Drag over false defects"}</h3>
            <p>Drag a box around defect pins, then click any pin to add or remove it.</p>
            {batchSelectedIds.size > 0 ? (
              <button
                className={styles.remove}
                type="button"
                disabled={batchRemovePending || busy}
                onClick={removeBatchSelection}
              >Remove {batchSelectedIds.size} selected</button>
            ) : null}
          </div>
        ) : traceTarget ? (
          <>
            <DefectTraceEditor
              key={traceTarget.findingId ?? `new:${newTraceAnchor?.x}:${newTraceAnchor?.y}`}
              target={{
                side: traceTarget.side,
                findingId: traceTarget.findingId,
                sourceViewId: traceTarget.sourceViewId,
              }}
              imageUrl={sourceImageUrls[traceTarget.sourceViewId] ?? masterImageUrl}
              inspectionFrame={inspectionFrame}
              cropTransform={traceTarget.cropTransform}
              cornerShape={cornerShape}
              initialTrace={traceTarget.initialTrace}
              initialTraceProvenance={traceTarget.initialTraceProvenance}
              onHighlighterStrokeEnd={onTraceProposal}
              onSave={async (saved) => {
                const applied = await onTraceSave?.(saved);
                if (applied === false) return false;
                setTraceError("");
                if (!saved.target.findingId) {
                  setNewTraceAnchor(null);
                  if (typeof applied === "string") {
                    setEditingFindingId(applied);
                    select(applied);
                  }
                }
                return applied;
              }}
              onCancel={newTraceAnchor ? () => {
                setTraceError("");
                setNewTraceAnchor(null);
                setEditingFindingId(null);
              } : undefined}
              onImageError={onImageError}
              onError={setTraceError}
            />
            {active && !newTraceAnchor ? (
              <>
                <div className={styles.title}>
                  <div className={styles.titleMeta}>
                    <span>{activeRegions.map(({ zone }) => zone).join(" · ")}</span>
                    {active.origin === "MEMORY" ? <small className={styles.memoryLabel}>
                      {activeSimilarity ? `memory · sim ${activeSimilarity}` : "memory"}
                    </small> : null}
                  </div>
                  <h3>{LABELS[active.defectType]}</h3>
                </div>
                <dl className={styles.metrics}>
                  {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              </>
            ) : null}
            {active && !newTraceAnchor ? (
              <div className={styles.actions}>
                <span>DEFECT TYPE</span>
                <div className={styles.pills}>
                  {activeTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={busy}
                      className={type === active.defectType ? styles.selectedPill : undefined}
                      onClick={() => onDefectTypeChange?.(active.id, type)}
                    >{LABELS[type]}</button>
                  ))}
                </div>
                <button className={styles.remove} type="button" disabled={busy} onClick={() => onRemoveDefects?.([active.id])}>Remove</button>
              </div>
            ) : null}
          </>
        ) : active ? (
          <>
            {activeContour && activeCrop ? <div className={styles.closeUp}>
              <svg viewBox={activeCrop.join(" ")} preserveAspectRatio="none">
                <image
                  href={sourceImageUrls[active.sourceViewId]}
                  width="1"
                  height="1"
                  preserveAspectRatio="none"
                  onError={onImageError}
                />
                {activeContours.map((inspectionContour, regionIndex) => (
                  <polygon
                    key={`${active.id}:close:${regionIndex}`}
                    className={styles.closeContour}
                    points={points(inspectionContour)}
                  />
                ))}
              </svg>
              <span>EVIDENCE CLOSE-UP</span>
            </div> : null}
            <div className={styles.title}>
              <div className={styles.titleMeta}>
                <span>{activeRegions.map(({ zone }) => zone).join(" · ")}</span>
                {active.origin === "MEMORY" ? <small className={styles.memoryLabel}>
                  {activeSimilarity ? `memory · sim ${activeSimilarity}` : "memory"}
                </small> : null}
              </div>
              <h3>{LABELS[active.defectType]}</h3>
            </div>
            <dl className={styles.metrics}>
              {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </>
        ) : (
          <div className={styles.empty}>
            <span>{mode === "SMART_MARK" ? "SMART-MARK" : "DEFECT EVIDENCE"}</span>
            <p>{mode === "SMART_MARK" ? "Choose the missed-defect location on the master map." : "Select a marker to inspect its measurements."}</p>
          </div>
        )}
        {masterReady && traceError ? <p className={styles.traceError}>{traceError}</p> : null}
        {masterReady && active && mapRegistration ? (
          <section className={styles.mapDiagnostic} aria-label="Card Map containment diagnostic">
            <span>APPLIED MAP DIAGNOSTIC</span>
            {activeMapDiagnostic ? (
              <>
                <strong>{activeMapDiagnostic.zone.label}</strong>
                <p>{(() => {
                  const counts = mapOverlapCounts(activeMapDiagnostic.overlap);
                  return active.origin === "SMART_MARK"
                    ? `Retained: Smart Marks always remain, including inside this zone (${counts.covered}/${counts.total} ${counts.unit} inside).`
                    : activeMapDiagnostic.overlap.fullyContained
                    ? `Filtered: ${counts.covered}/${counts.total} ${counts.unit} inside; all authoritative evidence stayed inside.`
                    : `Retained: ${counts.covered}/${counts.total} ${counts.unit} inside; ${counts.total - counts.covered} outside or the authority boundary crossed outside.`;
                })()}</p>
                <small>{isSpeedsterMapZoneV2(activeMapDiagnostic.zone)
                  ? `v2 · filter ${activeMapDiagnostic.zone.filterAuthority ? "ON" : "OFF"} · ${activeMapDiagnostic.zone.filterPaddingMm} mm padding`
                  : "v1 · strict full-contour containment · no padding"}</small>
              </>
            ) : <p>No filter-authorized zone applies on this side.</p>}
          </section>
        ) : null}
      </aside>
    </section>
  );
}

export type { DefectEvidenceViewerProps };
