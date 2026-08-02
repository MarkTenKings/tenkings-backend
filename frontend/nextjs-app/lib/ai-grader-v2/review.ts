import type {
  SpeedsterCardSide,
  SpeedsterConditionZone,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
} from "./contracts";
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

const isIncluded = (defect: SpeedsterMeasuredDefect) => defect.reviewResult !== "REMOVED";
const canonicalViewId = (side: SpeedsterCardSide, viewId: string) =>
  viewId.startsWith(`${side}:`) ? viewId : `${side}:${viewId}`;

export function speedsterDetectorViews(side: DetectorSide) {
  return [
    { id: `${side.side}:ORIGINAL`, imageUrl: side.rectifiedUrl },
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
    return {
      ...defect,
      id: rawId.endsWith(`:${defect.zone}`) ? rawId : `${rawId}:${defect.zone}`,
      side,
      origin: "DETECTOR" as const,
      detectedDefectType: defect.defectType,
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
  defects: readonly SpeedsterMeasuredDefect[],
  side: SpeedsterCardSide,
  zone: SpeedsterConditionZone,
): SpeedsterConditionInput {
  const matching = defects.filter(
    (defect) => isIncluded(defect) && defect.side === side && defect.zone === zone,
  );
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

  const measuredDefects = defects.map((defect) => {
    if (!isIncluded(defect)) return defect;
    const group = defects.filter(
      (candidate) => isIncluded(candidate) && candidate.side === defect.side && candidate.zone === defect.zone,
    );
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
): SpeedsterMeasuredDefect[] {
  return defects.map((defect) => defect.id === defectId
    ? { ...defect, reviewResult: "REMOVED" }
    : defect);
}

export function restoreSpeedsterDefect(
  defects: readonly SpeedsterMeasuredDefect[],
  restored: SpeedsterMeasuredDefect,
): SpeedsterMeasuredDefect[] {
  return defects.map((defect) => defect.id === restored.id ? restored : defect);
}

export function correctSpeedsterDefectType(
  defects: readonly SpeedsterMeasuredDefect[],
  defectId: string,
  defectType: SpeedsterDefectType,
): SpeedsterMeasuredDefect[] {
  return defects.map((defect) => defect.id === defectId
    ? { ...defect, defectType, reviewResult: "TYPE_CORRECTED" }
    : defect);
}

export function completeSpeedsterReview(
  defects: readonly SpeedsterMeasuredDefect[],
): SpeedsterMeasuredDefect[] {
  return defects.map((defect) => defect.reviewResult === "UNREVIEWED"
    ? { ...defect, reviewResult: "ACCEPTED" }
    : defect);
}

export function publicSpeedsterDefects(
  defects: readonly SpeedsterMeasuredDefect[],
): SpeedsterMeasuredDefect[] {
  return defects.map((defect) => ({
    ...defect,
    sourceViewId: defect.sourceViewId.replace(`${defect.side}:`, ""),
    supportingViewIds: defect.supportingViewIds.map((id) => id.replace(`${defect.side}:`, "")),
  }));
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
