import type {
  SpeedsterCardSide,
  SpeedsterConditionZone,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterReviewFinding,
  SpeedsterTraceProvenance,
} from "./contracts";
import { isSpeedsterSourceMeasuredDefect } from "./contracts";
import {
  SPEEDSTER_TRACE_HEIGHT,
  SPEEDSTER_TRACE_WIDTH,
  parseSpeedsterTraceRleV1,
  type SpeedsterTraceRleV1,
} from "./trace-codec";
import {
  SPEEDSTER_DEFECT_MULTIPLIERS,
  calculateDefectSubgradeEffect,
  calculateSpeedsterGrade,
  type SpeedsterCenteringBorders,
  type SpeedsterConditionInput,
} from "./scoring";

const SIDES = ["FRONT", "BACK"] as const;
const ZONES = ["CORNERS", "EDGES", "SURFACE"] as const;

type DetectorSide = {
  side: SpeedsterCardSide;
  rectifiedUrl: string;
  inspectionUrl?: string;
  views: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
};
type DetectorCapture = {
  cornerShape: "ROUNDED_3_18_MM" | "SQUARE";
  front: DetectorSide;
  back: DetectorSide;
};
type DetectRequest = {
  side: SpeedsterCardSide;
  cornerShape: DetectorCapture["cornerShape"];
  views: readonly { id: string; imageUrl: string }[];
};
type DetectResponse = {
  detectorVersion: string;
  defects: SpeedsterMeasuredDefect[];
};

type ReviewCapture = Readonly<Record<Lowercase<SpeedsterCardSide>, {
  centeringBorders: SpeedsterCenteringBorders;
}>>;

const isIncluded = (defect: SpeedsterReviewFinding) => defect.reviewResult !== "REMOVED";
const canonicalViewId = (side: SpeedsterCardSide, viewId: string) =>
  viewId.startsWith(`${side}:`) ? viewId : `${side}:${viewId}`;

export function speedsterDetectorViews(side: DetectorSide) {
  return [
    { id: `${side.side}:ORIGINAL`, imageUrl: side.inspectionUrl ?? side.rectifiedUrl },
    { id: `${side.side}:NORMALIZED`, imageUrl: side.views.NORMALIZED },
    { id: `${side.side}:MICRO_DEFECT`, imageUrl: side.views.MICRO_DEFECT },
    { id: `${side.side}:DIRECTIONAL`, imageUrl: side.views.DIRECTIONAL },
  ];
}

function canonicalDefects(
  side: SpeedsterCardSide,
  defects: readonly SpeedsterMeasuredDefect[],
  reviewResult: SpeedsterMeasuredDefect["reviewResult"],
) {
  return defects.map((defect) => {
    const rawId = canonicalViewId(side, defect.id);
    const origin = defect.origin === "MEMORY" ? "MEMORY" as const : "DETECTOR" as const;
    return {
      ...defect,
      id: rawId.endsWith(`:${defect.zone}`) ? rawId : `${rawId}:${defect.zone}`,
      side,
      origin,
      detectedDefectType: defect.detectedDefectType ?? defect.defectType,
      sourceViewId: canonicalViewId(side, defect.sourceViewId),
      supportingViewIds: defect.supportingViewIds.map((id) => canonicalViewId(side, id)),
      reviewResult,
    };
  });
}

export async function scanSpeedsterCapture(input: {
  capture: DetectorCapture;
  detect: (request: DetectRequest) => Promise<DetectResponse>;
  onSide?: (side: SpeedsterCardSide) => void;
}) {
  input.onSide?.("FRONT");
  const front = await input.detect({
    side: "FRONT",
    cornerShape: input.capture.cornerShape,
    views: speedsterDetectorViews(input.capture.front),
  });
  input.onSide?.("BACK");
  const back = await input.detect({
    side: "BACK",
    cornerShape: input.capture.cornerShape,
    views: speedsterDetectorViews(input.capture.back),
  });
  return {
    detectorVersion: front.detectorVersion,
    defects: [
      ...canonicalDefects("FRONT", front.defects, "UNREVIEWED"),
      ...canonicalDefects("BACK", back.defects, "UNREVIEWED"),
    ],
  };
}

function conditionInput(
  defects: readonly SpeedsterReviewFinding[],
  side: SpeedsterCardSide,
  zone: SpeedsterConditionZone,
): SpeedsterConditionInput {
  const matching = defects.flatMap((defect) => {
    if (!isIncluded(defect) || defect.side !== side) return [];
    if (isSpeedsterSourceMeasuredDefect(defect)) {
      return defect.measurementRegions
        .filter((region) => region.zone === zone)
        .map((region) => ({ defectType: defect.defectType, measurement: region.measurement }));
    }
    return defect.zone === zone
      ? [{ defectType: defect.defectType, measurement: defect.measurement }]
      : [];
  });
  const measured = matching.find(
    (defect) => defect.measurement.areaMm2 > 0 && defect.measurement.zonePercent > 0,
  );
  const eligibleAreaMm2 = measured
    ? measured.measurement.areaMm2 / (measured.measurement.zonePercent / 100)
    : 1;
  return {
    eligibleAreaMm2,
    defects: matching.map(({ measurement, defectType }) => ({
      areaMm2: measurement.areaMm2,
      defectType,
    })),
  };
}

export function calculateSpeedsterReview(
  capture: ReviewCapture,
  defects: readonly SpeedsterMeasuredDefect[],
): { defects: SpeedsterMeasuredDefect[]; grade: ReturnType<typeof calculateSpeedsterGrade> };
export function calculateSpeedsterReview(
  capture: ReviewCapture,
  defects: readonly SpeedsterReviewFinding[],
): { defects: SpeedsterReviewFinding[]; grade: ReturnType<typeof calculateSpeedsterGrade> };
export function calculateSpeedsterReview(
  capture: ReviewCapture,
  defects: readonly SpeedsterReviewFinding[],
) {
  const conditions = Object.fromEntries(SIDES.map((side) => [
    side,
    Object.fromEntries(ZONES.map((zone) => [zone, conditionInput(defects, side, zone)])),
  ])) as Record<SpeedsterCardSide, Record<SpeedsterConditionZone, SpeedsterConditionInput>>;

  const grade = calculateSpeedsterGrade({
    front: {
      centering: capture.front.centeringBorders,
      corners: conditions.FRONT.CORNERS,
      edges: conditions.FRONT.EDGES,
      surface: conditions.FRONT.SURFACE,
    },
    back: {
      centering: capture.back.centeringBorders,
      corners: conditions.BACK.CORNERS,
      edges: conditions.BACK.EDGES,
      surface: conditions.BACK.SURFACE,
    },
  });

  const measuredDefects = defects.map((defect): SpeedsterReviewFinding => {
    if (!isIncluded(defect)) return defect;
    if (isSpeedsterSourceMeasuredDefect(defect)) {
      return {
        ...defect,
        measurementRegions: defect.measurementRegions.map((region) => {
          const group = defects.flatMap((candidate) => {
            if (!isIncluded(candidate) || candidate.side !== defect.side) return [];
            if (isSpeedsterSourceMeasuredDefect(candidate)) {
              return candidate.measurementRegions
                .filter((candidateRegion) => candidateRegion.zone === region.zone)
                .map((candidateRegion) => ({
                  id: candidate.id,
                  region: candidateRegion,
                  defectType: candidate.defectType,
                  measurement: candidateRegion.measurement,
                }));
            }
            return candidate.zone === region.zone
              ? [{ id: candidate.id, region: candidate, defectType: candidate.defectType, measurement: candidate.measurement }]
              : [];
          });
          const index = group.findIndex((candidate) => candidate.id === defect.id && candidate.region === region);
          const input = conditions[defect.side][region.zone];
          const multiplier = SPEEDSTER_DEFECT_MULTIPLIERS[defect.defectType];
          return {
            ...region,
            measurement: {
              ...region.measurement,
              multiplier,
              weightedAreaMm2: region.measurement.areaMm2 * multiplier,
              subgradeEffect: calculateDefectSubgradeEffect(
                defect.side,
                input.eligibleAreaMm2,
                group.map(({ measurement, defectType }) => ({ areaMm2: measurement.areaMm2, defectType })),
                index,
              ),
            },
          };
        }),
      };
    }
    const group = defects.flatMap((candidate) => {
      if (!isIncluded(candidate) || candidate.side !== defect.side) return [];
      if (isSpeedsterSourceMeasuredDefect(candidate)) {
        return candidate.measurementRegions
          .filter((region) => region.zone === defect.zone)
          .map((region) => ({ id: candidate.id, defectType: candidate.defectType, measurement: region.measurement }));
      }
      return candidate.zone === defect.zone
        ? [{ id: candidate.id, defectType: candidate.defectType, measurement: candidate.measurement }]
        : [];
    });
    const index = group.findIndex(({ id }) => id === defect.id);
    const input = conditions[defect.side][defect.zone];
    const multiplier = SPEEDSTER_DEFECT_MULTIPLIERS[defect.defectType];
    return {
      ...defect,
      measurement: {
        ...defect.measurement,
        multiplier,
        weightedAreaMm2: defect.measurement.areaMm2 * multiplier,
        subgradeEffect: calculateDefectSubgradeEffect(
          defect.side,
          input.eligibleAreaMm2,
          group.map(({ measurement, defectType }) => ({ areaMm2: measurement.areaMm2, defectType })),
          index,
        ),
      },
    };
  });

  return { defects: measuredDefects, grade };
}

export function removeSpeedsterDefect(
  defects: readonly SpeedsterMeasuredDefect[],
  defectId: string,
): SpeedsterMeasuredDefect[];
export function removeSpeedsterDefect(
  defects: readonly SpeedsterReviewFinding[],
  defectId: string,
): SpeedsterReviewFinding[];
export function removeSpeedsterDefect(
  defects: readonly SpeedsterReviewFinding[],
  defectId: string,
): SpeedsterReviewFinding[] {
  return defects.map((defect) => defect.id === defectId
    ? { ...defect, reviewResult: "REMOVED" }
    : defect);
}

export function restoreSpeedsterDefect(
  defects: readonly SpeedsterReviewFinding[],
  restored: SpeedsterReviewFinding,
): SpeedsterReviewFinding[] {
  return defects.map((defect) => defect.id === restored.id ? restored : defect);
}

export function replaceSpeedsterSideMeasurements(
  defects: readonly SpeedsterMeasuredDefect[],
  side: SpeedsterCardSide,
  measured: readonly SpeedsterMeasuredDefect[],
): SpeedsterMeasuredDefect[];
export function replaceSpeedsterSideMeasurements(
  defects: readonly SpeedsterReviewFinding[],
  side: SpeedsterCardSide,
  measured: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[];
export function replaceSpeedsterSideMeasurements(
  defects: readonly SpeedsterReviewFinding[],
  side: SpeedsterCardSide,
  measured: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[] {
  return [
    ...defects.filter(
      (defect) => defect.side !== side || defect.reviewResult === "REMOVED",
    ),
    ...measured,
  ];
}

type SpeedsterSmartMark = {
  id: string;
  defectType: SpeedsterDefectType;
  sourceViewId: string;
  finalTrace: SpeedsterTraceRleV1;
  traceProvenance: SpeedsterTraceProvenance;
};

type SpeedsterTraceEdit = Pick<SpeedsterSmartMark, "finalTrace" | "traceProvenance">;

export type SpeedsterReviewMeasurementAction =
  | { type: "TRACE_SAVE"; side: SpeedsterCardSide; findingId: null; trace: SpeedsterSmartMark }
  | { type: "TRACE_SAVE"; side: SpeedsterCardSide; findingId: string; trace: SpeedsterTraceEdit }
  | { type: "REMOVE"; defectId: string }
  | { type: "UNDO"; defectId: string }
  | { type: "CHANGE_TYPE"; defectId: string; defectType: SpeedsterDefectType };

type SpeedsterReviewMeasurementPass = (input: {
  side: SpeedsterCardSide;
  findings: readonly SpeedsterReviewFinding[];
  marks: readonly SpeedsterSmartMark[];
}) => Promise<{ defects: SpeedsterReviewFinding[] }>;

function validateTraceSave(action: Extract<SpeedsterReviewMeasurementAction, { type: "TRACE_SAVE" }>) {
  const finalTrace = parseSpeedsterTraceRleV1(action.trace.finalTrace);
  const provenance = action.trace.traceProvenance;
  const crop = provenance.cropTransform.crop;
  const validCrop = [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) &&
    crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 &&
    crop.x + crop.width <= SPEEDSTER_TRACE_WIDTH - 1 &&
    crop.y + crop.height <= SPEEDSTER_TRACE_HEIGHT - 1;
  const validStrokes = Array.isArray(provenance.highlighterStrokes) &&
    provenance.highlighterStrokes.every((stroke) => (
      Number.isFinite(stroke.strokeWidthMm) && stroke.strokeWidthMm > 0 &&
      Array.isArray(stroke.canonicalPoints) && stroke.canonicalPoints.length > 0 &&
      stroke.canonicalPoints.every(({ x, y }: { x: number; y: number }) => (
        Number.isInteger(x) && x >= 0 && x < SPEEDSTER_TRACE_WIDTH &&
        Number.isInteger(y) && y >= 0 && y < SPEEDSTER_TRACE_HEIGHT
      ))
    ));
  if (
    provenance.version !== "speedster-trace-provenance-v1" ||
    provenance.finalTraceSha256 !== finalTrace.sha256 ||
    provenance.cropTransform.version !== "speedster-canonical-crop-affine-v1" ||
    !provenance.sourceViewId.startsWith(`${action.side}:`) ||
    !validCrop || !validStrokes
  ) {
    throw new Error("Speedster trace provenance does not bind the saved final trace.");
  }
  return { ...action.trace, finalTrace };
}

function preserveRemeasuredFinding(
  measured: SpeedsterReviewFinding,
  prior: SpeedsterReviewFinding,
): SpeedsterReviewFinding {
  if (isSpeedsterSourceMeasuredDefect(measured)) {
    const { zone: _zone, canonicalContour: _contour, measurement: _measurement, ...stablePrior } =
      prior as SpeedsterMeasuredDefect & Record<string, unknown>;
    return { ...measured, ...stablePrior, measurementRegions: measured.measurementRegions } as SpeedsterReviewFinding;
  }
  const { canonicalContour: _contour, measurement: _measurement, zone: _zone, ...stablePrior } =
    prior as SpeedsterMeasuredDefect;
  return {
    ...measured,
    ...stablePrior,
    zone: measured.zone,
    canonicalContour: measured.canonicalContour,
    measurement: measured.measurement,
  } as SpeedsterReviewFinding;
}

export async function remeasureSpeedsterReviewAction(input: {
  defects: readonly SpeedsterReviewFinding[];
  action: SpeedsterReviewMeasurementAction;
  measure: SpeedsterReviewMeasurementPass;
}): Promise<SpeedsterReviewFinding[]> {
  const defectId = input.action.type === "REMOVE" || input.action.type === "UNDO" || input.action.type === "CHANGE_TYPE"
    ? input.action.defectId
    : null;
  const target = defectId === null
    ? null
    : input.defects.find(({ id }) => id === defectId);
  if ((input.action.type === "REMOVE" || input.action.type === "UNDO" || input.action.type === "CHANGE_TYPE") && !target) {
    throw new Error("Speedster review finding was not found.");
  }

  const traceSave = input.action.type === "TRACE_SAVE" ? validateTraceSave(input.action) : null;
  const traceFindingId = input.action.type === "TRACE_SAVE" ? input.action.findingId : null;
  const newTraceSourceViewId = input.action.type === "TRACE_SAVE" && input.action.findingId === null
    ? input.action.trace.sourceViewId
    : null;
  const existingTraceTarget = traceFindingId
    ? input.defects.find(({ id }) => id === traceFindingId)
    : null;
  if (traceFindingId && !existingTraceTarget) {
    throw new Error("Speedster review finding was not found.");
  }
  if (
    input.action.type === "TRACE_SAVE" && traceSave &&
    (traceFindingId === null
      ? newTraceSourceViewId !== traceSave.traceProvenance.sourceViewId
      : existingTraceTarget?.sourceViewId !== traceSave.traceProvenance.sourceViewId)
  ) {
    throw new Error("Speedster trace provenance source view does not match its finding.");
  }

  const side = input.action.type === "TRACE_SAVE"
    ? input.action.side
    : input.action.type === "UNDO"
      ? target!.side
      : target!.side;
  const nextDefects = input.action.type === "REMOVE"
    ? input.defects.map((finding) => finding.id === defectId ? {
        ...finding,
        reviewResultBeforeRemoval: finding.reviewResult,
        reviewResult: "REMOVED" as const,
      } : finding)
    : input.action.type === "UNDO"
      ? input.defects.map((finding) => {
          if (finding.id !== defectId) return finding;
          const privateFinding = finding as SpeedsterReviewFinding & { reviewResultBeforeRemoval?: unknown };
          const prior = privateFinding.reviewResultBeforeRemoval;
          const { reviewResultBeforeRemoval: _removed, ...restored } = privateFinding;
          return { ...restored, reviewResult: prior as SpeedsterReviewFinding["reviewResult"] };
        })
      : input.action.type === "CHANGE_TYPE"
        ? correctSpeedsterDefectType(input.defects, input.action.defectId, input.action.defectType)
        : input.action.type === "TRACE_SAVE" && existingTraceTarget && traceSave
          ? input.defects.map((finding) => finding.id === existingTraceTarget.id ? {
              ...finding,
              finalTrace: traceSave.finalTrace,
              traceProvenance: traceSave.traceProvenance,
            } : finding)
        : [...input.defects];
  const measured = await input.measure({
    side,
    findings: nextDefects.filter(
      (finding) => finding.side === side && finding.reviewResult !== "REMOVED",
    ),
    marks: input.action.type === "TRACE_SAVE" && input.action.findingId === null && traceSave
      ? [traceSave as SpeedsterSmartMark]
      : [],
  });
  const newTraceId = input.action.type === "TRACE_SAVE" && input.action.findingId === null
    ? input.action.trace.id
    : null;
  const preservedMeasurements = measured.defects.map((finding): SpeedsterReviewFinding => {
    const prior = nextDefects.find(({ id }) => id === finding.id);
    if (prior) return preserveRemeasuredFinding(finding, prior);
    if (newTraceId && finding.id === newTraceId && traceSave) {
      const learning = finding.smartMarkLearning?.fingerprintProvenance === "SAM_TRACE"
        ? finding.smartMarkLearning
        : undefined;
      return {
        ...finding,
        origin: "SMART_MARK",
        detectedDefectType: undefined,
        smartMarkLearning: learning,
        reviewResult: "SMART_MARKED",
        finalTrace: traceSave.finalTrace,
        traceProvenance: traceSave.traceProvenance,
      };
    }
    return finding;
  });
  return replaceSpeedsterSideMeasurements(nextDefects, side, preservedMeasurements);
}

export function correctSpeedsterDefectType(
  defects: readonly SpeedsterMeasuredDefect[],
  defectId: string,
  defectType: SpeedsterDefectType,
): SpeedsterMeasuredDefect[];
export function correctSpeedsterDefectType(
  defects: readonly SpeedsterReviewFinding[],
  defectId: string,
  defectType: SpeedsterDefectType,
): SpeedsterReviewFinding[];
export function correctSpeedsterDefectType(
  defects: readonly SpeedsterReviewFinding[],
  defectId: string,
  defectType: SpeedsterDefectType,
): SpeedsterReviewFinding[] {
  return defects.map((defect) => defect.id === defectId
    ? { ...defect, defectType, reviewResult: "TYPE_CORRECTED" }
    : defect);
}

export function completeSpeedsterReview(
  defects: readonly SpeedsterMeasuredDefect[],
): SpeedsterMeasuredDefect[];
export function completeSpeedsterReview(
  defects: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[];
export function completeSpeedsterReview(
  defects: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[] {
  return defects.map((defect) => defect.reviewResult === "UNREVIEWED"
    ? { ...defect, reviewResult: "ACCEPTED" }
    : defect);
}

export function publicSpeedsterDefects(
  defects: readonly SpeedsterMeasuredDefect[],
): SpeedsterMeasuredDefect[];
export function publicSpeedsterDefects(
  defects: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[];
export function publicSpeedsterDefects(
  defects: readonly SpeedsterReviewFinding[],
): SpeedsterReviewFinding[] {
  return defects.map((defect) => {
    const { reviewResultBeforeRemoval: _privateReviewState, traceSha256: _hydrationHash, ...safe } =
      defect as SpeedsterReviewFinding & { reviewResultBeforeRemoval?: unknown };
    return {
      ...safe,
      sourceViewId: defect.sourceViewId.replace(`${defect.side}:`, ""),
      supportingViewIds: defect.supportingViewIds.map((id) => id.replace(`${defect.side}:`, "")),
    } as SpeedsterReviewFinding;
  });
}

export function prepareSpeedsterCompletion(
  defects: readonly SpeedsterMeasuredDefect[],
  grade: ReturnType<typeof calculateSpeedsterGrade>,
  detectorVersion: string,
) {
  const completedDefects = completeSpeedsterReview(defects);
  return {
    completedDefects,
    body: {
      reviewedDefects: publicSpeedsterDefects(completedDefects),
      gradeReport: { ...grade, detectorVersion },
    },
  };
}
