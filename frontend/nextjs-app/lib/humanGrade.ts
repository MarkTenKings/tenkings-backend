export const HUMAN_GRADE_SHEET_CAPACITY = 16 as const;
export const HUMAN_GRADE_CERTIFICATE_PREFIX = "TKH" as const;
export const HUMAN_GRADE_FORMULA_WEIGHTS = {
  LEGACY_30_25_25_20: {
    centering: 0.3,
    corners: 0.25,
    edges: 0.25,
    surface: 0.2,
  },
  EQUAL_25: {
    centering: 0.25,
    corners: 0.25,
    edges: 0.25,
    surface: 0.25,
  },
} as const;
export type HumanGradeFormulaVersion = keyof typeof HUMAN_GRADE_FORMULA_WEIGHTS;
export const NEW_HUMAN_GRADE_FORMULA_VERSION: HumanGradeFormulaVersion = "EQUAL_25";

export type HumanGradeCardType = "SPORTS" | "POKEMON";

export type HumanGradeLabelEditorValue = {
  cardType: HumanGradeCardType;
  playerName: string;
  cardName: string;
  year: string;
  manufacturer: string;
  productSet: string;
  parallel: string;
  insert: string;
  cardNumber: string;
  centeringGrade: string;
  cornersGrade: string;
  edgesGrade: string;
  surfaceGrade: string;
};

export const EMPTY_HUMAN_GRADE_LABEL_EDITOR_VALUE: HumanGradeLabelEditorValue = {
  cardType: "SPORTS",
  playerName: "",
  cardName: "",
  year: "",
  manufacturer: "",
  productSet: "",
  parallel: "",
  insert: "",
  cardNumber: "",
  centeringGrade: "",
  cornersGrade: "",
  edgesGrade: "",
  surfaceGrade: "",
};

export type HumanGradeSubgrades = {
  centeringGrade: string | number;
  cornersGrade: string | number;
  edgesGrade: string | number;
  surfaceGrade: string | number;
};

export type HumanGradeLabelSnapshot = {
  id?: string;
  certificateNumber: string;
  gradingFormulaVersion: HumanGradeFormulaVersion;
  cardType: HumanGradeCardType;
  playerName?: string | null;
  cardName?: string | null;
  year: string;
  manufacturer?: string | null;
  productSet: string;
  parallel?: string | null;
  insert?: string | null;
  cardNumber?: string | null;
  centeringGrade: string | number;
  cornersGrade: string | number;
  edgesGrade: string | number;
  surfaceGrade: string | number;
  grade: string | number;
};

export type HumanGradeLabelContent = {
  primary: string;
  metadata: string;
  descriptor?: string;
  cardNumberAboveGrade?: string;
  certificateNumber: string;
  subgrades: readonly [
    { label: "CENTERING"; grade: string },
    { label: "CORNERS"; grade: string },
    { label: "EDGES"; grade: string },
    { label: "SURFACE"; grade: string },
  ];
  grade: string;
};

export type HumanGradeLabelDto = HumanGradeLabelSnapshot & {
  id: string;
  slot: number;
  createdAt: string;
};

export type HumanGradeLabelSheetDto = {
  id: string;
  sheetNumber: number;
  status: "OPEN" | "READY";
  capacity: typeof HUMAN_GRADE_SHEET_CAPACITY;
  readyAt: string | null;
  createdAt: string;
  labels: HumanGradeLabelDto[];
};

export type HumanGradeQueueDto = {
  sheets: HumanGradeLabelSheetDto[];
  totals: {
    cards: number;
    readySheets: number;
  };
};

export type HumanGradeSheetSlot = {
  slot: number;
  row: number;
  column: number;
  xPt: number;
  yFromTopPt: number;
};

export const HUMAN_GRADE_LABEL_GEOMETRY = {
  paper: { widthPt: 612, heightPt: 792, widthIn: 8.5, heightIn: 11 },
  label: { widthPt: 196.56, heightPt: 59.76, widthIn: 2.73, heightIn: 0.83 },
  xPositionsPt: [72, 343.44],
  yPositionsFromTopPt: [72, 149.76, 227.52, 305.28, 383.04, 460.8, 538.56, 616.32],
} as const;

export const HUMAN_GRADE_SHEET_SLOTS: readonly HumanGradeSheetSlot[] =
  HUMAN_GRADE_LABEL_GEOMETRY.yPositionsFromTopPt.flatMap((yFromTopPt, rowIndex) =>
    HUMAN_GRADE_LABEL_GEOMETRY.xPositionsPt.map((xPt, columnIndex) => ({
      slot: rowIndex * 2 + columnIndex + 1,
      row: rowIndex + 1,
      column: columnIndex + 1,
      xPt,
      yFromTopPt,
    }))
  );

function normalized(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function upper(value: string | null | undefined) {
  return normalized(value).toUpperCase();
}

function roundHalfAwayFromZero(value: number, decimals: number) {
  const factor = 10 ** decimals;
  const absolute = Math.abs(value) * factor;
  const rounded = Math.floor(absolute + 0.5 + Number.EPSILON);
  return (Math.sign(value) * rounded) / factor;
}

export function formatHumanGrade(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("Human grade must be a number from 1 through 10.");
  }
  const rounded = roundHalfAwayFromZero(parsed, 1);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function calculateHumanGrade(
  subgrades: HumanGradeSubgrades,
  formulaVersion: HumanGradeFormulaVersion = NEW_HUMAN_GRADE_FORMULA_VERSION
) {
  const weights = HUMAN_GRADE_FORMULA_WEIGHTS[formulaVersion];
  if (!weights) throw new Error(`Unsupported Human Grade formula version: ${formulaVersion}.`);
  const centering = Number(formatHumanGrade(subgrades.centeringGrade));
  const corners = Number(formatHumanGrade(subgrades.cornersGrade));
  const edges = Number(formatHumanGrade(subgrades.edgesGrade));
  const surface = Number(formatHumanGrade(subgrades.surfaceGrade));
  const weightedGrade = roundHalfAwayFromZero(
    centering * weights.centering +
      corners * weights.corners +
      edges * weights.edges +
      surface * weights.surface,
    2
  );
  return {
    weightedGrade,
    labelGrade: formatHumanGrade(weightedGrade),
  };
}

export function formatHumanGradeCertificateNumber(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Human grade certificate sequence must be a positive integer.");
  }
  return `${HUMAN_GRADE_CERTIFICATE_PREFIX}-${String(sequence).padStart(6, "0")}`;
}

export function buildHumanGradeLabelContent(snapshot: HumanGradeLabelSnapshot): HumanGradeLabelContent {
  const certificateNumber = upper(snapshot.certificateNumber);
  if (!/^TKH-\d{6,}$/.test(certificateNumber)) {
    throw new Error("Human grade certificate number is invalid.");
  }
  const calculated = calculateHumanGrade(snapshot, snapshot.gradingFormulaVersion);
  if (formatHumanGrade(snapshot.grade) !== calculated.labelGrade) {
    throw new Error(`Human grade does not match its ${snapshot.gradingFormulaVersion} weighted subgrades.`);
  }
  const subgrades = [
    { label: "CENTERING", grade: formatHumanGrade(snapshot.centeringGrade) },
    { label: "CORNERS", grade: formatHumanGrade(snapshot.cornersGrade) },
    { label: "EDGES", grade: formatHumanGrade(snapshot.edgesGrade) },
    { label: "SURFACE", grade: formatHumanGrade(snapshot.surfaceGrade) },
  ] as const;

  if (snapshot.cardType === "SPORTS") {
    const primary = upper(snapshot.playerName);
    const cardNumber = upper(snapshot.cardNumber).replace(/^#/, "");
    const metadata = [
      upper(snapshot.year),
      upper(snapshot.manufacturer),
      upper(snapshot.productSet),
      cardNumber ? `#${cardNumber}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const descriptor = [upper(snapshot.parallel), upper(snapshot.insert)].filter(Boolean).join(" / ");
    if (!primary || !metadata) throw new Error("Sports labels require player, year, and product/set.");
    return {
      primary,
      metadata,
      ...(descriptor ? { descriptor } : {}),
      certificateNumber,
      subgrades,
      grade: calculated.labelGrade,
    };
  }

  const primary = upper(snapshot.cardName);
  const cardNumber = upper(snapshot.cardNumber).replace(/^#/, "");
  const metadata = [upper(snapshot.year), upper(snapshot.productSet), cardNumber ? `#${cardNumber}` : ""]
    .filter(Boolean)
    .join(" ");
  const descriptor = upper(snapshot.parallel);
  if (!primary || !metadata) throw new Error("Pokemon labels require card name, year, and set.");
  return {
    primary,
    metadata,
    ...(descriptor ? { descriptor } : {}),
    certificateNumber,
    subgrades,
    grade: calculated.labelGrade,
  };
}
