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

type ReviewCapture = Readonly<Record<Lowercase<SpeedsterCardSide>, {
  centeringBorders: SpeedsterCenteringBorders;
}>>;

const isIncluded = (defect: SpeedsterMeasuredDefect) => defect.reviewResult !== "REMOVED";

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
