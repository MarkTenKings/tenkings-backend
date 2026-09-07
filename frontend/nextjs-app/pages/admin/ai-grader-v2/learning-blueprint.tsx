import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import styles from "../../../styles/SpeedsterLearningBlueprint.module.css";

type CardSide = "FRONT" | "BACK";
type Layer = "DEFECTS" | "PHYSICAL_OUTER" | "PRINTED_FRAME";
type VerdictStatus = "USED" | "REJECTED" | "SKIPPED" | "UNPROVEN" | "NOT_TESTABLE";
type ComparePhase = "IDLE" | "LOADING" | "READY" | "ERROR";

type BlueprintCardSummary = {
  sessionId: string;
  completionOrder: number;
  completedAt: string;
  cardProfile: string;
  title: string;
  details: string[];
  grade: number | null;
  corrections: { defects: number; physicalGeometry: number; printedFrame: number };
  warnings: string[];
};

type TraceShape = {
  kind: "TRACE_RLE";
  trace: { width: number; height: number; runs: number[] };
};
type ContourShape = {
  kind: "CONTOURS";
  contours: Array<Array<{ x: number; y: number }>>;
};
type BlueprintShape = TraceShape | ContourShape;

type DefectOverlay = {
  findingId: string;
  side: CardSide;
  coordinateSpace: "CANONICAL_CARD";
  origin: string;
  detectedDefectType: string | null;
  finalDefectType: string | null;
  reviewResult: string;
  aiShapes: BlueprintShape[];
  correctionShape: BlueprintShape | null;
  filteredByMap: boolean;
  shapeUnavailableReason: string | null;
};

type GeometryOverlay = {
  evidenceId: string;
  side: CardSide;
  mode: "PHYSICAL_OUTER" | "PRINTED_FRAME";
  coordinateSpace: "ORIGINAL_UNIT" | "RECTIFIED_UNIT";
  aiProposal: Array<{ x: number; y: number }> | null;
  humanConfirmed: Array<{ x: number; y: number }> | null;
  corrected: boolean;
};

type InspectionFrame = {
  width: number;
  height: number;
  cardBounds: { x: number; y: number; width: number; height: number };
};

type BlueprintSide = {
  images: {
    original: string | null;
    rectified: string | null;
    inspection: string | null;
    inspectionFrame: InspectionFrame | null;
  };
  geometry: GeometryOverlay[];
  defects: DefectOverlay[];
  warnings: string[];
};

type BlueprintCard = {
  summary: BlueprintCardSummary;
  sides: Record<CardSide, BlueprintSide>;
};

type EvidenceAnchor = {
  kind: "FINDING" | "GEOMETRY";
  evidenceId: string;
  side: CardSide;
};

type LessonTrail = {
  id: string;
  kind: "MEMORY" | "PHYSICAL_GEOMETRY" | "PRINTED_FRAME";
  side: CardSide;
  title: string;
  sourceAnchor: EvidenceAnchor;
  corrected: "PROVEN";
  savedToRecord: "PROVEN";
  learningBank: "PROVEN_FOR_SELECTED_SCAN" | "ELIGIBLE_RECORD" | "UNPROVEN";
  nextScan: {
    status: VerdictStatus;
    reasonCodes: string[];
    reasons: string[];
    finalCaptureLinked: boolean | null;
    lessonDraftChangedByOperator: boolean | null;
    targetAnchors: EvidenceAnchor[];
  };
  repeatedMistake: "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE";
};

type BlueprintComparison = {
  version: "speedster-learning-blueprint-v1";
  earlier: BlueprintCard;
  later: BlueprintCard;
  trails: LessonTrail[];
  pairSummary: {
    used: number;
    rejected: number;
    skipped: number;
    unproven: number;
    notTested: number;
    repeatedMistakesProven: 0;
  };
};

const SIDES: CardSide[] = ["FRONT", "BACK"];
const LAYERS: Array<{ value: Layer; label: string; helper: string }> = [
  { value: "DEFECTS", label: "Defects", helper: "inspection photo" },
  { value: "PHYSICAL_OUTER", label: "Card edge", helper: "original photo" },
  { value: "PRINTED_FRAME", label: "Printed border", helper: "straightened photo" },
];

const object = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
);
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const sideValue = (value: unknown): value is CardSide => value === "FRONT" || value === "BACK";

function isUnitPoint(value: unknown): value is { x: number; y: number } {
  const row = object(value);
  return Boolean(row && finiteNumber(row.x) && row.x >= 0 && row.x <= 1
    && finiteNumber(row.y) && row.y >= 0 && row.y <= 1);
}

function isAnchor(value: unknown): value is EvidenceAnchor {
  const row = object(value);
  return Boolean(row && (row.kind === "FINDING" || row.kind === "GEOMETRY")
    && typeof row.evidenceId === "string" && sideValue(row.side));
}

function isShape(value: unknown): value is BlueprintShape {
  const row = object(value);
  if (!row) return false;
  if (row.kind === "CONTOURS") {
    return Array.isArray(row.contours) && row.contours.every((contour) => (
      Array.isArray(contour) && contour.length >= 3 && contour.every(isUnitPoint)
    ));
  }
  const trace = object(row.trace);
  if (row.kind !== "TRACE_RLE" || !trace
    || !Number.isSafeInteger(trace.width) || Number(trace.width) <= 1
    || !Number.isSafeInteger(trace.height) || Number(trace.height) <= 1
    || !Array.isArray(trace.runs) || trace.runs.length === 0
    || !trace.runs.every((run, index) => Number.isSafeInteger(run) && Number(run) >= 0
      && (index === 0 || Number(run) > 0))) return false;
  const expectedPixels = Number(trace.width) * Number(trace.height);
  return Number.isSafeInteger(expectedPixels)
    && trace.runs.reduce((total, run) => total + Number(run), 0) === expectedPixels
    && trace.runs.some((run, index) => index % 2 === 1 && Number(run) > 0);
}

function isCardSummary(value: unknown): value is BlueprintCardSummary {
  const row = object(value);
  const corrections = object(row?.corrections);
  return Boolean(row
    && typeof row.sessionId === "string"
    && Number.isSafeInteger(row.completionOrder) && Number(row.completionOrder) >= 0
    && typeof row.completedAt === "string"
    && typeof row.cardProfile === "string"
    && typeof row.title === "string"
    && stringList(row.details)
    && (row.grade === null || finiteNumber(row.grade))
    && corrections
    && Number.isSafeInteger(corrections.defects) && Number(corrections.defects) >= 0
    && Number.isSafeInteger(corrections.physicalGeometry) && Number(corrections.physicalGeometry) >= 0
    && Number.isSafeInteger(corrections.printedFrame) && Number(corrections.printedFrame) >= 0
    && stringList(row.warnings));
}

function isInspectionFrame(value: unknown): value is InspectionFrame {
  const row = object(value);
  const bounds = object(row?.cardBounds);
  return Boolean(row && bounds
    && finiteNumber(row.width) && row.width > 1
    && finiteNumber(row.height) && row.height > 1
    && finiteNumber(bounds.x) && bounds.x >= 0
    && finiteNumber(bounds.y) && bounds.y >= 0
    && finiteNumber(bounds.width) && bounds.width >= 2
    && finiteNumber(bounds.height) && bounds.height >= 2
    && bounds.x + bounds.width <= row.width
    && bounds.y + bounds.height <= row.height);
}

function isBlueprintSide(value: unknown): value is BlueprintSide {
  const row = object(value);
  const images = object(row?.images);
  if (!row || !images || !Array.isArray(row.geometry) || !Array.isArray(row.defects) || !stringList(row.warnings)) return false;
  const imageValuesValid = [images.original, images.rectified, images.inspection]
    .every((entry) => entry === null || typeof entry === "string");
  const geometryValid = row.geometry.every((entry) => {
    const geometry = object(entry);
    const coordinateSpaceMatchesMode = geometry?.mode === "PHYSICAL_OUTER"
      ? geometry.coordinateSpace === "ORIGINAL_UNIT"
      : geometry?.mode === "PRINTED_FRAME" && geometry.coordinateSpace === "RECTIFIED_UNIT";
    const validQuad = (quad: unknown) => quad === null || (
      Array.isArray(quad) && quad.length === 4 && quad.every(isUnitPoint)
    );
    return Boolean(geometry && typeof geometry.evidenceId === "string" && sideValue(geometry.side)
      && (geometry.mode === "PHYSICAL_OUTER" || geometry.mode === "PRINTED_FRAME")
      && coordinateSpaceMatchesMode
      && validQuad(geometry.aiProposal)
      && validQuad(geometry.humanConfirmed)
      && typeof geometry.corrected === "boolean");
  });
  const defectsValid = row.defects.every((entry) => {
    const defect = object(entry);
    return Boolean(defect && typeof defect.findingId === "string" && sideValue(defect.side)
      && defect.coordinateSpace === "CANONICAL_CARD"
      && typeof defect.origin === "string"
      && typeof defect.reviewResult === "string"
      && (defect.detectedDefectType === null || typeof defect.detectedDefectType === "string")
      && (defect.finalDefectType === null || typeof defect.finalDefectType === "string")
      && Array.isArray(defect.aiShapes) && defect.aiShapes.every(isShape)
      && (defect.correctionShape === null || isShape(defect.correctionShape))
      && typeof defect.filteredByMap === "boolean"
      && (defect.shapeUnavailableReason === null || typeof defect.shapeUnavailableReason === "string"));
  });
  return imageValuesValid && (images.inspectionFrame === null || isInspectionFrame(images.inspectionFrame))
    && geometryValid && defectsValid;
}

function isBlueprintCard(value: unknown): value is BlueprintCard {
  const row = object(value);
  const sides = object(row?.sides);
  return Boolean(row && isCardSummary(row.summary) && sides
    && isBlueprintSide(sides.FRONT) && isBlueprintSide(sides.BACK));
}

function isLessonTrail(value: unknown): value is LessonTrail {
  const row = object(value);
  const nextScan = object(row?.nextScan);
  const statuses: VerdictStatus[] = ["USED", "REJECTED", "SKIPPED", "UNPROVEN", "NOT_TESTABLE"];
  return Boolean(row && typeof row.id === "string" && typeof row.title === "string" && sideValue(row.side)
    && (row.kind === "MEMORY" || row.kind === "PHYSICAL_GEOMETRY" || row.kind === "PRINTED_FRAME")
    && isAnchor(row.sourceAnchor) && row.sourceAnchor.side === row.side
    && nextScan && statuses.includes(nextScan.status as VerdictStatus)
    && row.corrected === "PROVEN" && row.savedToRecord === "PROVEN"
    && (row.learningBank === "PROVEN_FOR_SELECTED_SCAN" || row.learningBank === "ELIGIBLE_RECORD" || row.learningBank === "UNPROVEN")
    && stringList(nextScan.reasonCodes) && stringList(nextScan.reasons)
    && (nextScan.finalCaptureLinked === null || typeof nextScan.finalCaptureLinked === "boolean")
    && (nextScan.lessonDraftChangedByOperator === null || typeof nextScan.lessonDraftChangedByOperator === "boolean")
    && Array.isArray(nextScan.targetAnchors) && nextScan.targetAnchors.every(isAnchor)
    && row.repeatedMistake === "UNPROVEN_NO_EXPLICIT_REPEAT_EVIDENCE");
}

function parseCardsPayload(value: unknown) {
  const row = object(value);
  if (!row || row.version !== "speedster-learning-blueprint-v1"
    || !Array.isArray(row.cards) || !row.cards.every(isCardSummary)
    || !(row.nextCursor === null || Number.isSafeInteger(row.nextCursor))) return null;
  return { cards: row.cards, nextCursor: row.nextCursor as number | null };
}

function parseComparison(value: unknown): BlueprintComparison | null {
  const row = object(value);
  const summary = object(row?.pairSummary);
  if (!row || row.version !== "speedster-learning-blueprint-v1" || !isBlueprintCard(row.earlier)
    || !isBlueprintCard(row.later) || !Array.isArray(row.trails) || !row.trails.every(isLessonTrail)
    || !summary || ![summary.used, summary.rejected, summary.skipped, summary.unproven, summary.notTested]
      .every((entry) => Number.isSafeInteger(entry) && Number(entry) >= 0)
    || summary.repeatedMistakesProven !== 0) return null;
  return value as BlueprintComparison;
}

function responseMessage(value: unknown, fallback: string) {
  const row = object(value);
  return row && typeof row.message === "string" ? row.message : fallback;
}

function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function completionTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown completion time" : date.toLocaleString();
}

function correctionCount(card: BlueprintCardSummary) {
  return card.corrections.defects + card.corrections.physicalGeometry + card.corrections.printedFrame;
}

function verdictPresentation(status: VerdictStatus) {
  if (status === "USED") return { symbol: "✓", label: "Lesson reused", tone: styles.used };
  if (status === "NOT_TESTABLE") return { symbol: "—", label: "Not tested", tone: styles.notTested };
  if (status === "REJECTED") return { symbol: "?", label: "Rejected · not reused", tone: styles.unproven };
  if (status === "SKIPPED") return { symbol: "?", label: "Skipped · not tested", tone: styles.unproven };
  return { symbol: "?", label: "Unproven", tone: styles.unproven };
}

function cardBounds(frame: InspectionFrame | null, width: number, height: number) {
  if (!frame) return { x: 0, y: 0, width: Math.max(1, width - 1), height: Math.max(1, height - 1) };
  const outputWidth = Math.max(1, width - 1);
  const outputHeight = Math.max(1, height - 1);
  const frameWidth = Math.max(1, frame.width - 1);
  const frameHeight = Math.max(1, frame.height - 1);
  const left = frame.cardBounds.x / frameWidth * outputWidth;
  const top = frame.cardBounds.y / frameHeight * outputHeight;
  const right = (frame.cardBounds.x + frame.cardBounds.width - 1) / frameWidth * outputWidth;
  const bottom = (frame.cardBounds.y + frame.cardBounds.height - 1) / frameHeight * outputHeight;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function drawTrace(
  context: CanvasRenderingContext2D,
  shape: TraceShape,
  frame: InspectionFrame | null,
  width: number,
  height: number,
  color: string,
  dashed: boolean,
) {
  const bounds = cardBounds(frame, width, height);
  const xScale = bounds.width / Math.max(1, shape.trace.width - 1);
  const yScale = bounds.height / Math.max(1, shape.trace.height - 1);
  let offset = 0;
  let minX = shape.trace.width;
  let minY = shape.trace.height;
  let maxX = 0;
  let maxY = 0;
  context.fillStyle = color;
  shape.trace.runs.forEach((run, index) => {
    if (index % 2 === 1) {
      let cursor = offset;
      const end = offset + run;
      while (cursor < end) {
        const y = Math.floor(cursor / shape.trace.width);
        const rowEnd = Math.min(end, (y + 1) * shape.trace.width);
        const x = cursor % shape.trace.width;
        const span = rowEnd - cursor;
        context.fillRect(bounds.x + x * xScale, bounds.y + y * yScale, Math.max(1, (span - 1) * xScale + 1), Math.max(1, yScale + 1));
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + span);
        maxY = Math.max(maxY, y + 1);
        cursor = rowEnd;
      }
    }
    offset += run;
  });
  if (dashed && minX <= maxX && minY <= maxY) {
    context.save();
    context.strokeStyle = "#f97316";
    context.lineWidth = Math.max(2, width / 300);
    context.setLineDash([Math.max(8, width / 45), Math.max(6, width / 60)]);
    context.strokeRect(
      bounds.x + minX * xScale,
      bounds.y + minY * yScale,
      Math.max(4, (maxX - minX) * xScale),
      Math.max(4, (maxY - minY) * yScale),
    );
    context.restore();
  }
}

function drawContours(
  context: CanvasRenderingContext2D,
  shape: ContourShape,
  frame: InspectionFrame | null,
  width: number,
  height: number,
  color: string,
  dashed: boolean,
) {
  const bounds = cardBounds(frame, width, height);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(3, width / 220);
  context.fillStyle = color === "#2f80ed" ? "rgba(47,128,237,.18)" : "rgba(249,115,22,.12)";
  context.setLineDash(dashed ? [Math.max(8, width / 45), Math.max(6, width / 60)] : []);
  shape.contours.forEach((contour) => {
    if (contour.length < 2) return;
    context.beginPath();
    contour.forEach((point, index) => {
      const x = bounds.x + point.x * bounds.width;
      const y = bounds.y + point.y * bounds.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
    context.stroke();
  });
  context.restore();
}

function drawShape(
  context: CanvasRenderingContext2D,
  shape: BlueprintShape,
  frame: InspectionFrame | null,
  width: number,
  height: number,
  color: string,
  dashed: boolean,
) {
  if (shape.kind === "TRACE_RLE") {
    drawTrace(context, shape, frame, width, height, color === "#2f80ed" ? "rgba(47,128,237,.34)" : "rgba(249,115,22,.28)", dashed);
  } else {
    drawContours(context, shape, frame, width, height, color, dashed);
  }
}

function drawQuad(
  context: CanvasRenderingContext2D,
  quad: Array<{ x: number; y: number }> | null,
  width: number,
  height: number,
  color: string,
  dashed: boolean,
) {
  if (!quad || quad.length !== 4) return;
  context.save();
  context.beginPath();
  quad.forEach((point, index) => {
    const x = point.x * Math.max(1, width - 1);
    const y = point.y * Math.max(1, height - 1);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = color;
  context.lineWidth = Math.max(4, width / 180);
  context.setLineDash(dashed ? [Math.max(10, width / 35), Math.max(8, width / 45)] : []);
  context.stroke();
  context.restore();
}

function shapeCenter(
  shape: BlueprintShape,
  frame: InspectionFrame | null,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const bounds = cardBounds(frame, width, height);
  if (shape.kind === "CONTOURS") {
    const points = shape.contours.flat();
    if (!points.length) return null;
    const xs = points.map(({ x }) => bounds.x + x * bounds.width);
    const ys = points.map(({ y }) => bounds.y + y * bounds.height);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  let offset = 0;
  let minX = shape.trace.width;
  let minY = shape.trace.height;
  let maxX = -1;
  let maxY = -1;
  shape.trace.runs.forEach((run, index) => {
    if (index % 2 === 1 && run > 0) {
      let cursor = offset;
      const end = offset + run;
      while (cursor < end) {
        const y = Math.floor(cursor / shape.trace.width);
        const rowEnd = Math.min(end, (y + 1) * shape.trace.width);
        const x = cursor % shape.trace.width;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + rowEnd - cursor - 1);
        maxY = Math.max(maxY, y);
        cursor = rowEnd;
      }
    }
    offset += run;
  });
  if (maxX < minX || maxY < minY) return null;
  return {
    x: bounds.x + ((minX + maxX) / 2) / Math.max(1, shape.trace.width - 1) * bounds.width,
    y: bounds.y + ((minY + maxY) / 2) / Math.max(1, shape.trace.height - 1) * bounds.height,
  };
}

function anchorLayer(anchor: EvidenceAnchor, side: BlueprintSide): Layer | null {
  if (anchor.kind === "FINDING") {
    return side.defects.some(({ findingId }) => findingId === anchor.evidenceId) ? "DEFECTS" : null;
  }
  return side.geometry.find(({ evidenceId }) => evidenceId === anchor.evidenceId)?.mode ?? null;
}

function anchorHasDrawableEvidence(anchor: EvidenceAnchor, side: BlueprintSide) {
  if (anchor.kind === "FINDING") {
    const finding = side.defects.find(({ findingId }) => findingId === anchor.evidenceId);
    return Boolean(finding && (finding.aiShapes.length || finding.correctionShape));
  }
  const geometry = side.geometry.find(({ evidenceId }) => evidenceId === anchor.evidenceId);
  return Boolean(geometry && (geometry.humanConfirmed || geometry.aiProposal));
}

function anchorCenter(
  anchor: EvidenceAnchor,
  side: BlueprintSide,
  layer: Layer,
  width: number,
  height: number,
) {
  if (anchor.kind === "FINDING") {
    if (layer !== "DEFECTS") return null;
    const finding = side.defects.find(({ findingId }) => findingId === anchor.evidenceId);
    const shape = finding?.aiShapes[0] ?? finding?.correctionShape ?? null;
    return shape ? shapeCenter(shape, side.images.inspectionFrame, width, height) : null;
  }
  const geometry = side.geometry.find(({ evidenceId }) => evidenceId === anchor.evidenceId);
  if (!geometry || geometry.mode !== layer) return null;
  const quad = geometry.humanConfirmed ?? geometry.aiProposal;
  if (!quad?.length) return null;
  return {
    x: quad.reduce((total, point) => total + point.x, 0) / quad.length * Math.max(1, width - 1),
    y: quad.reduce((total, point) => total + point.y, 0) / quad.length * Math.max(1, height - 1),
  };
}

function drawOutcomeMarker(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  status: VerdictStatus,
  width: number,
  height: number,
  offsetIndex: number,
) {
  const used = status === "USED";
  const notTested = status === "NOT_TESTABLE";
  const radius = Math.max(13, Math.min(24, width / 26));
  const x = Math.min(width - radius - 2, Math.max(radius + 2, point.x + offsetIndex * radius * 1.4));
  const y = Math.min(height - radius - 2, Math.max(radius + 2, point.y));
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = used ? "#0ca51b" : notTested ? "#88857f" : "#f2a20d";
  context.fill();
  context.strokeStyle = "white";
  context.lineWidth = Math.max(3, radius / 5);
  context.stroke();
  context.fillStyle = "white";
  context.font = `900 ${Math.round(radius * 1.35)}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(used ? "✓" : notTested ? "—" : "?", x, y + 1);
  context.restore();
}

function EvidenceCanvas({
  side,
  layer,
  cardLabel,
  outcomeMarkers,
}: {
  side: BlueprintSide;
  layer: Layer;
  cardLabel: string;
  outcomeMarkers: Array<{ anchor: EvidenceAnchor; status: VerdictStatus }>;
}) {
  const imageUrl = layer === "DEFECTS" ? side.images.inspection
    : layer === "PHYSICAL_OUTER" ? side.images.original
      : side.images.rectified;
  const [dimensions, setDimensions] = useState(() => ({
    width: layer === "DEFECTS" ? side.images.inspectionFrame?.width ?? 1270 : 1270,
    height: layer === "DEFECTS" ? side.images.inspectionFrame?.height ?? 1778 : 1778,
  }));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    if (layer === "DEFECTS") {
      side.defects.forEach((defect) => {
        defect.aiShapes.forEach((shape) => drawShape(
          context,
          shape,
          side.images.inspectionFrame,
          dimensions.width,
          dimensions.height,
          "#2f80ed",
          false,
        ));
        if (defect.correctionShape) drawShape(
          context,
          defect.correctionShape,
          side.images.inspectionFrame,
          dimensions.width,
          dimensions.height,
          "#f97316",
          true,
        );
      });
    } else {
      side.geometry.filter(({ mode }) => mode === layer).forEach((geometry) => {
        drawQuad(context, geometry.aiProposal, dimensions.width, dimensions.height, "#2f80ed", false);
        if (geometry.corrected) drawQuad(context, geometry.humanConfirmed, dimensions.width, dimensions.height, "#f97316", true);
      });
    }
    const drawnPerAnchor = new Map<string, number>();
    outcomeMarkers.forEach(({ anchor, status }) => {
      const point = anchorCenter(anchor, side, layer, dimensions.width, dimensions.height);
      if (!point) return;
      const key = `${anchor.kind}:${anchor.evidenceId}`;
      const offsetIndex = drawnPerAnchor.get(key) ?? 0;
      drawnPerAnchor.set(key, offsetIndex + 1);
      drawOutcomeMarker(context, point, status, dimensions.width, dimensions.height, offsetIndex);
    });
  }, [dimensions.height, dimensions.width, layer, outcomeMarkers, side]);

  if (!imageUrl) {
    return <div className={styles.noImage}>The authorized {LAYERS.find(({ value }) => value === layer)?.helper} is unavailable.</div>;
  }

  return (
    <div className={styles.canvasFrame} style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`${cardLabel} ${LAYERS.find(({ value }) => value === layer)?.label.toLowerCase()} evidence`}
        src={imageUrl}
        onLoad={(event) => {
          const width = event.currentTarget.naturalWidth;
          const height = event.currentTarget.naturalHeight;
          if (width > 0 && height > 0 && (width !== dimensions.width || height !== dimensions.height)) {
            setDimensions({ width, height });
          }
        }}
      />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  );
}

function CardPicker({
  card,
  selected,
  position,
  onSelect,
}: {
  card: BlueprintCardSummary;
  selected: boolean;
  position: "A" | "B" | null;
  onSelect: () => void;
}) {
  return (
    <button
      className={`${styles.cardChoice} ${selected ? styles.cardChoiceSelected : ""} ${position === "A" ? styles.cardA : position === "B" ? styles.cardB : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      {position ? <span className={styles.cardTag}>CARD {position}</span> : null}
      <span className={styles.grade}>{card.grade?.toFixed(1) ?? "—"}</span>
      <strong>{card.title}</strong>
      <small>{card.details.join(" · ") || card.cardProfile}</small>
      <time>{completionTime(card.completedAt)}</time>
      <span className={correctionCount(card) ? styles.correctionPill : styles.nonePill}>
        {correctionCount(card) ? `${correctionCount(card)} correction${correctionCount(card) === 1 ? "" : "s"}` : "No corrections"}
      </span>
    </button>
  );
}

function ComparisonCard({
  card,
  label,
  side,
  layer,
  trails,
}: {
  card: BlueprintCard;
  label: "A" | "B";
  side: CardSide;
  layer: Layer;
  trails: LessonTrail[];
}) {
  const visibleTrails = trails.filter((trail) => label === "A"
    ? trail.sourceAnchor.side === side
    : trail.nextScan.targetAnchors.some((anchor) => anchor.side === side)
      || (trail.nextScan.targetAnchors.length === 0 && trail.side === side));
  const sideEvidence = card.sides[side];
  const outcomeMarkers = label === "B" ? visibleTrails.flatMap((trail) => (
    trail.nextScan.targetAnchors
      .filter((anchor) => anchor.side === side && anchorLayer(anchor, sideEvidence) === layer)
      .map((anchor) => ({ anchor, status: trail.nextScan.status }))
  )) : [];
  const undrawable = layer === "DEFECTS"
    ? sideEvidence.defects.filter(({ shapeUnavailableReason }) => shapeUnavailableReason)
    : [];
  const unanchoredVerdicts = label === "B"
    ? visibleTrails.filter((trail) => trail.nextScan.targetAnchors.length === 0)
    : [];
  const relevantAnchors = visibleTrails.flatMap((trail) => label === "A"
    ? [trail.sourceAnchor]
    : trail.nextScan.targetAnchors.filter((anchor) => anchor.side === side));
  const uniqueAnchors = [...new Map(relevantAnchors.map((anchor) => [
    `${anchor.kind}:${anchor.evidenceId}`,
    anchor,
  ])).values()];
  const missingAnchors = uniqueAnchors.filter((anchor) => anchorLayer(anchor, sideEvidence) === null);
  const undrawableAnchors = uniqueAnchors.filter((anchor) => (
    anchorLayer(anchor, sideEvidence) === layer && !anchorHasDrawableEvidence(anchor, sideEvidence)
  ));
  return (
    <article className={styles.comparisonCard}>
      <header>
        <span className={label === "A" ? styles.orangeLabel : styles.blueLabel}>
          CARD {label} — {label === "A" ? "corrections made here" : "the next scan"}
        </span>
        <h2>{card.summary.title}</h2>
        <p>{completionTime(card.summary.completedAt)} · Grade {card.summary.grade?.toFixed(1) ?? "—"}</p>
      </header>
      <EvidenceCanvas side={sideEvidence} layer={layer} cardLabel={`Card ${label}`} outcomeMarkers={outcomeMarkers} />
      <div className={styles.evidenceNotes}>
        {layer === "DEFECTS" ? (
          <>
            <span><i className={styles.blueDot} />{sideEvidence.defects.length} saved AI finding{sideEvidence.defects.length === 1 ? "" : "s"}</span>
            <span><i className={styles.orangeBox} />{sideEvidence.defects.filter(({ correctionShape }) => correctionShape).length} drawn correction{sideEvidence.defects.filter(({ correctionShape }) => correctionShape).length === 1 ? "" : "s"}</span>
          </>
        ) : (
          <>
            <span><i className={styles.blueDot} />AI outline</span>
            <span><i className={styles.orangeBox} />{sideEvidence.geometry.some((entry) => entry.mode === layer && entry.corrected) ? "Approved correction" : "No correction on this layer"}</span>
          </>
        )}
      </div>
      {label === "B" && visibleTrails.length ? (
        <div className={styles.cardVerdicts} aria-label={`Card B ${side.toLowerCase()} verdicts`}>
          {visibleTrails.map((trail) => {
            const view = verdictPresentation(trail.nextScan.status);
            return <span className={view.tone} key={trail.id}><b>{view.symbol}</b>{view.label}</span>;
          })}
        </div>
      ) : null}
      {undrawable.map((defect) => (
        <p className={styles.evidenceGap} role="status" key={defect.findingId}>
          ? {friendly(defect.detectedDefectType ?? defect.finalDefectType ?? "finding")}: {defect.shapeUnavailableReason}
        </p>
      ))}
      {unanchoredVerdicts.map((trail) => (
        <p className={styles.evidenceGap} role="status" key={`unanchored:${trail.id}`}>
          ? {trail.title}: the saved evidence has no exact on-card target to mark.
        </p>
      ))}
      {missingAnchors.map((anchor) => (
        <p className={styles.evidenceGap} role="status" key={`missing:${anchor.kind}:${anchor.evidenceId}`}>
          ? Saved target {anchor.evidenceId} is missing from this card&apos;s {side.toLowerCase()} evidence.
        </p>
      ))}
      {undrawableAnchors.map((anchor) => (
        <p className={styles.evidenceGap} role="status" key={`undrawable:${anchor.kind}:${anchor.evidenceId}`}>
          ? Saved target {anchor.evidenceId} exists, but it has no exact shape to draw on this layer.
        </p>
      ))}
      {sideEvidence.warnings.length ? (
        <details className={styles.warning}><summary>Evidence warning</summary>{sideEvidence.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>
      ) : null}
    </article>
  );
}

function TrailStep({ proven, children }: { proven: boolean; children: React.ReactNode }) {
  return <span className={proven ? styles.stepProven : styles.stepUnknown}>{proven ? "✓" : "?"} {children}</span>;
}

function TrailRow({ trail }: { trail: LessonTrail }) {
  const verdict = verdictPresentation(trail.nextScan.status);
  const bankProven = trail.learningBank === "PROVEN_FOR_SELECTED_SCAN";
  return (
    <article className={styles.trailRow}>
      <div className={styles.trailHeading}>
        <div><small>{trail.kind === "MEMORY" ? "✎ MEMORY" : trail.kind === "PHYSICAL_GEOMETRY" ? "◩ CARD EDGE" : "▦ PRINTED BORDER"} · {trail.side}</small><h3>{trail.title}</h3></div>
        <span className={verdict.tone}>{verdict.symbol} {verdict.label}</span>
      </div>
      <div className={styles.steps}>
        <TrailStep proven>Corrected</TrailStep><b>→</b>
        <TrailStep proven>Saved to record</TrailStep><b>→</b>
        <TrailStep proven={bankProven}>{bankProven ? "Learning bank" : trail.kind === "PRINTED_FRAME" ? "No learning path yet" : "Learning bank unproven"}</TrailStep><b>→</b>
        <TrailStep proven={trail.nextScan.status === "USED"}>{trail.nextScan.status === "USED" ? "Next scan used it" : trail.nextScan.status === "NOT_TESTABLE" ? "Next scan not testable" : `Next scan: ${friendly(trail.nextScan.status)}`}</TrailStep>
      </div>
      <p className={styles.reason}>{trail.nextScan.reasons.join(" ") || "No exact reason was recorded."}</p>
      {trail.nextScan.status === "USED" && trail.nextScan.lessonDraftChangedByOperator !== null ? (
        <p className={styles.detail}>{trail.nextScan.lessonDraftChangedByOperator ? "The lesson supplied the draft, then you adjusted it." : "The lesson supplied the draft and it stayed unchanged."}</p>
      ) : null}
    </article>
  );
}

export default function SpeedsterLearningBlueprintPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );
  const [cards, setCards] = useState<BlueprintCardSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [listMessage, setListMessage] = useState("Loading graded cards…");
  const [comparison, setComparison] = useState<BlueprintComparison | null>(null);
  const [comparePhase, setComparePhase] = useState<ComparePhase>("IDLE");
  const [compareRetry, setCompareRetry] = useState(0);
  const [compareMessage, setCompareMessage] = useState("Pick two graded cards to trace their learning.");
  const [side, setSide] = useState<CardSide>("FRONT");
  const [layer, setLayer] = useState<Layer>("DEFECTS");

  const loadCards = async (cursor: number | null, append: boolean) => {
    if (!session?.token) return;
    setListMessage(append ? "Loading more graded cards…" : "Loading graded cards…");
    try {
      const suffix = cursor !== null ? `?beforeCompletionOrder=${cursor}` : "";
      const response = await fetch(`/api/admin/ai-grader-v2/learning-blueprint/cards${suffix}`, {
        headers: buildAdminHeaders(session.token),
        cache: "no-store",
      });
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(raw, "Graded cards could not be loaded."));
      const payload = parseCardsPayload(raw);
      if (!payload) throw new Error("The graded-card response was incomplete or malformed.");
      setCards((current) => append ? [...current, ...payload.cards] : payload.cards);
      setNextCursor(payload.nextCursor);
      setSelectedIds((current) => current.length ? current : payload.cards.slice(0, 2).map(({ sessionId }) => sessionId));
      setListMessage(payload.cards.length ? "Newest first · choose any two cards" : "No completed Speedster cards are available yet.");
    } catch (error) {
      setListMessage(error instanceof Error ? error.message : "Graded cards could not be loaded.");
    }
  };

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    void loadCards(null, false);
    // loadCards intentionally depends only on the active authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!session?.token || selectedIds.length !== 2) {
      setComparison(null);
      setComparePhase("IDLE");
      setCompareMessage("Pick two graded cards to trace their learning.");
      return;
    }
    const controller = new AbortController();
    setComparison(null);
    setComparePhase("LOADING");
    setCompareMessage("Tracing the exact saved evidence…");
    const query = new URLSearchParams({ firstSessionId: selectedIds[0], secondSessionId: selectedIds[1] });
    void fetch(`/api/admin/ai-grader-v2/learning-blueprint/compare?${query}`, {
      headers: buildAdminHeaders(session.token),
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const raw: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseMessage(raw, "Learning evidence could not be compared."));
      const payload = parseComparison(raw);
      if (!payload) throw new Error("The learning comparison response was incomplete or malformed.");
      setComparison(payload);
      setComparePhase("READY");
      setCompareMessage("Exact saved evidence only. Unknowns stay unknown.");
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setComparison(null);
      setComparePhase("ERROR");
      setCompareMessage(error instanceof Error ? error.message : "Learning evidence could not be compared.");
    });
    return () => controller.abort();
  }, [compareRetry, selectedIds, session?.token]);

  const positions = useMemo(() => {
    const selected = cards.filter(({ sessionId }) => selectedIds.includes(sessionId)).sort((left, right) => left.completionOrder - right.completionOrder);
    return new Map(selected.map((card, index) => [card.sessionId, index === 0 ? "A" as const : "B" as const]));
  }, [cards, selectedIds]);

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.center}><button type="button" onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  const amberVerdicts = comparison ? comparison.pairSummary.rejected + comparison.pairSummary.skipped + comparison.pairSummary.unproven : 0;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>Learning Blueprint | Speedster</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <span>⚡ SPEEDSTER · INTERNAL · READ ONLY</span>
            <h1>Learning Blueprint</h1>
            <p>See what the AI found, what you corrected, and whether the next scan truly used the lesson. {compareMessage}</p>
          </div>
          <nav><Link href="/admin/ai-grader-v2/completed">Graded cards</Link><Link href="/admin/ai-grader-v2">New card</Link></nav>
        </header>

        <section className={styles.summaryGrid} aria-label="Learning comparison totals">
          <div><strong>{comparison?.trails.length ?? 0}</strong><span>Correction trails</span></div>
          <div><strong>{comparison?.pairSummary.used ?? 0}</strong><span><i className={styles.greenDot} />Lessons reused ✓</span></div>
          <div><strong>{comparison?.pairSummary.repeatedMistakesProven ?? 0}</strong><span><i className={styles.redDot} />Same mistake proven ✕</span></div>
          <div><strong>{amberVerdicts}</strong><span><i className={styles.amberDot} />Rejected / skipped / unproven ?</span></div>
          <div><strong>{comparison?.pairSummary.notTested ?? 0}</strong><span><i className={styles.grayDot} />Not tested —</span></div>
        </section>

        <div className={styles.workspace}>
          <aside className={styles.cardRail}>
            <header><h2>Graded cards</h2><p>{listMessage}</p></header>
            <div className={styles.cardList}>
              {cards.map((card) => <CardPicker
                card={card}
                key={card.sessionId}
                selected={selectedIds.includes(card.sessionId)}
                position={positions.get(card.sessionId) ?? null}
                onSelect={() => setSelectedIds((current) => {
                  if (current.includes(card.sessionId)) return current;
                  return [...current.slice(-1), card.sessionId];
                })}
              />)}
            </div>
            {nextCursor ? <button className={styles.loadMore} type="button" onClick={() => void loadCards(nextCursor, true)}>Load older cards</button> : null}
          </aside>

          <section className={styles.blueprint}>
            <div className={styles.controls}>
              <div className={styles.legend} aria-label="Overlay legend">
                <span><i className={styles.blueDot} />AI detected</span>
                <span><i className={styles.orangeBox} />Your correction</span>
                <span><i className={styles.greenDot} />✓ lesson used</span>
                <span><i className={styles.redDot} />✕ same mistake</span>
                <span><i className={styles.amberDot} />? unproven</span>
              </div>
              <div className={styles.toggles}>
                <div role="group" aria-label="Card side">{SIDES.map((value) => <button type="button" aria-pressed={side === value} className={side === value ? styles.activeToggle : ""} key={value} onClick={() => setSide(value)}>{friendly(value)}</button>)}</div>
                <div role="group" aria-label="Evidence layer">{LAYERS.map((entry) => <button type="button" title={`Uses the ${entry.helper}`} aria-pressed={layer === entry.value} className={layer === entry.value ? styles.activeToggle : ""} key={entry.value} onClick={() => setLayer(entry.value)}>{entry.label}</button>)}</div>
              </div>
            </div>

            {!comparison ? <div className={styles.emptyState} role={comparePhase === "ERROR" ? "alert" : "status"}>
              <strong>{comparePhase === "ERROR" ? "Could not load this comparison" : comparePhase === "LOADING" ? "Loading the exact evidence…" : "Choose two cards"}</strong>
              <p>{comparePhase === "IDLE" ? "Card A is the earlier correction. Card B is the later scan that could use it." : compareMessage}</p>
              {comparePhase === "ERROR" ? <button className={styles.retryButton} type="button" onClick={() => setCompareRetry((value) => value + 1)}>Try again</button> : null}
            </div> : (
              <>
                <div className={styles.comparisonGrid}>
                  <ComparisonCard card={comparison.earlier} label="A" side={side} layer={layer} trails={comparison.trails} />
                  <div className={styles.nextScanArrow} aria-hidden="true"><span>NEXT SCAN</span><b>→</b><small>did it learn?</small></div>
                  <ComparisonCard card={comparison.later} label="B" side={side} layer={layer} trails={comparison.trails} />
                </div>
                <section className={styles.lessonTrail}>
                  <header><div><span>EXACT AUDIT CHAIN</span><h2>Lesson Trail</h2></div><p>Rejected and skipped are not red failures. They stay ? with the logged reason.</p></header>
                  {comparison.trails.length ? comparison.trails.map((trail) => <TrailRow trail={trail} key={trail.id} />) : <div className={styles.emptyTrail}>Card A has no correction that can create a lesson trail.</div>}
                </section>
              </>
            )}
          </section>
        </div>
        <footer className={styles.readOnlyNote}>This page reads saved grading evidence. It has no save, edit, delete, or learning controls.</footer>
      </main>
    </AppShell>
  );
}
