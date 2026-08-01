import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterSubgrades,
} from "./contracts";

export type SpeedsterCenteringBorders = {
  leftMm: number;
  rightMm: number;
  topMm: number;
  bottomMm: number;
};

export type SpeedsterDefectArea = {
  areaMm2: number;
  defectType: SpeedsterDefectType;
};

export type SpeedsterConditionInput = {
  eligibleAreaMm2: number;
  defects: readonly SpeedsterDefectArea[];
};

export type SpeedsterSideGradeInput = {
  centering: SpeedsterCenteringBorders;
  corners: SpeedsterConditionInput;
  edges: SpeedsterConditionInput;
  surface: SpeedsterConditionInput;
};

export type SpeedsterSideGradeResult = {
  centering: {
    leftRightBalance: readonly [number, number];
    topBottomBalance: readonly [number, number];
    score: number;
  };
  corners: { weightedDamagePercent: number; score: number };
  edges: { weightedDamagePercent: number; score: number };
  surface: { weightedDamagePercent: number; score: number };
};

export const SPEEDSTER_DEFECT_MULTIPLIERS: Readonly<
  Record<SpeedsterDefectType, number>
> = {
  FAINT_COLOR_VARIATION: 0.5,
  VISIBLE_WHITENING: 1,
  FRAYING: 1.25,
  CHIPPING_EXPOSED_STOCK: 1.5,
  LIFTING_DEFORMATION: 2,
  LIGHT_SCRATCH_SCUFF: 1,
  VISIBLE_SCRATCH_PRINT_COATING_LOSS: 1.25,
  DENT_MATERIAL_DAMAGE: 1.5,
  PEELING_HEAVY_DAMAGE: 2,
};

function normalizeMeasurement(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

export function calculateCenteringBalance(
  firstBorderMm: number,
  secondBorderMm: number,
): readonly [number, number] {
  const totalMm = firstBorderMm + secondBorderMm;
  if (totalMm <= Number.EPSILON) return [50, 50];
  return [
    normalizeMeasurement((firstBorderMm / totalMm) * 100),
    normalizeMeasurement((secondBorderMm / totalMm) * 100),
  ];
}

export function calculateCenteringScore(
  borders: SpeedsterCenteringBorders,
): number {
  const horizontal = calculateCenteringBalance(borders.leftMm, borders.rightMm);
  const vertical = calculateCenteringBalance(borders.topMm, borders.bottomMm);
  const worstPercent = normalizeMeasurement(
    Math.max(...horizontal, ...vertical),
  );

  if (worstPercent <= 55) return 10;
  if (worstPercent <= 95) return 10 - (worstPercent - 55) / 5;
  return 1;
}

export function combineFrontBackScore(
  frontScore: number,
  backScore: number,
): number {
  return (frontScore * 7 + backScore * 3) / 10;
}

export function calculateWeightedDamagePercent(
  zoneAreaMm2: number,
  defects: readonly SpeedsterDefectArea[],
): number {
  const weightedDamageAreaMm2 = defects.reduce(
    (total, defect) =>
      total +
      defect.areaMm2 * SPEEDSTER_DEFECT_MULTIPLIERS[defect.defectType],
    0,
  );
  return normalizeMeasurement((weightedDamageAreaMm2 / zoneAreaMm2) * 100);
}

export function calculateConditionScore(weightedDamagePercent: number): number {
  if (weightedDamagePercent <= 0.2) return 10;
  if (weightedDamagePercent <= 1) return 9;
  if (weightedDamagePercent <= 2) return 8;
  if (weightedDamagePercent <= 3.5) return 7;
  if (weightedDamagePercent < 5) return 6;
  if (weightedDamagePercent < 6) return 5;
  if (weightedDamagePercent < 7) return 4;
  if (weightedDamagePercent < 8) return 3;
  if (weightedDamagePercent < 10) return 2;
  return 1;
}

export function calculateDefectSubgradeEffect(
  side: SpeedsterCardSide,
  eligibleAreaMm2: number,
  defects: readonly SpeedsterDefectArea[],
  targetDefectIndex: number,
): number {
  const scoreWithAll = calculateConditionScore(
    calculateWeightedDamagePercent(eligibleAreaMm2, defects),
  );
  const scoreWithoutTarget = calculateConditionScore(
    calculateWeightedDamagePercent(
      eligibleAreaMm2,
      defects.filter((_, index) => index !== targetDefectIndex),
    ),
  );
  const sideWeightTenths = side === "FRONT" ? 7 : 3;
  return Math.max(
    0,
    ((scoreWithoutTarget - scoreWithAll) * sideWeightTenths) / 10,
  );
}

export function calculateOverallGrade(
  subgrades: SpeedsterSubgrades,
): { rawGrade: number; displayGrade: number } {
  const rawGrade =
    (subgrades.centering +
      subgrades.corners +
      subgrades.edges +
      subgrades.surface) /
    4;

  return {
    rawGrade,
    displayGrade: Math.round((rawGrade + Number.EPSILON) * 10) / 10,
  };
}

function calculateSideGrade(
  input: SpeedsterSideGradeInput,
): SpeedsterSideGradeResult {
  const condition = (value: SpeedsterConditionInput) => {
    const weightedDamagePercent = calculateWeightedDamagePercent(
      value.eligibleAreaMm2,
      value.defects,
    );
    return {
      weightedDamagePercent,
      score: calculateConditionScore(weightedDamagePercent),
    };
  };

  return {
    centering: {
      leftRightBalance: calculateCenteringBalance(
        input.centering.leftMm,
        input.centering.rightMm,
      ),
      topBottomBalance: calculateCenteringBalance(
        input.centering.topMm,
        input.centering.bottomMm,
      ),
      score: calculateCenteringScore(input.centering),
    },
    corners: condition(input.corners),
    edges: condition(input.edges),
    surface: condition(input.surface),
  };
}

export function calculateSpeedsterGrade(input: {
  front: SpeedsterSideGradeInput;
  back: SpeedsterSideGradeInput;
}): {
  front: SpeedsterSideGradeResult;
  back: SpeedsterSideGradeResult;
  subgrades: SpeedsterSubgrades;
  overall: { rawGrade: number; displayGrade: number };
} {
  const front = calculateSideGrade(input.front);
  const back = calculateSideGrade(input.back);
  const subgrades = {
    centering: combineFrontBackScore(
      front.centering.score,
      back.centering.score,
    ),
    corners: combineFrontBackScore(front.corners.score, back.corners.score),
    edges: combineFrontBackScore(front.edges.score, back.edges.score),
    surface: combineFrontBackScore(front.surface.score, back.surface.score),
  };

  return {
    front,
    back,
    subgrades,
    overall: calculateOverallGrade(subgrades),
  };
}
