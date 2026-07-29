export const HUMAN_GRADE_SHEET_CAPACITY = 16 as const;
export const HUMAN_GRADE_CERTIFICATE_PREFIX = "TKH" as const;

export type HumanGradeCardType = "SPORTS" | "POKEMON";

export type HumanGradeLabelSnapshot = {
  id?: string;
  certificateNumber: string;
  cardType: HumanGradeCardType;
  playerName?: string | null;
  cardName?: string | null;
  year: string;
  manufacturer?: string | null;
  productSet: string;
  parallel?: string | null;
  insert?: string | null;
  cardNumber?: string | null;
  grade: string | number;
};

export type HumanGradeLabelContent = {
  primary: string;
  metadata: string;
  descriptor?: string;
  cardNumberAboveGrade?: string;
  certificateNumber: string;
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

export function formatHumanGrade(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
    throw new Error("Human grade must be a number from 1 through 10.");
  }
  const rounded = Math.round(parsed * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
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

  if (snapshot.cardType === "SPORTS") {
    const primary = upper(snapshot.playerName);
    const metadata = [upper(snapshot.year), upper(snapshot.manufacturer), upper(snapshot.productSet)]
      .filter(Boolean)
      .join(" ");
    const descriptor = [upper(snapshot.parallel), upper(snapshot.insert)].filter(Boolean).join(" / ");
    if (!primary || !metadata) throw new Error("Sports labels require player, year, and product/set.");
    return {
      primary,
      metadata,
      ...(descriptor ? { descriptor } : {}),
      ...(upper(snapshot.cardNumber) ? { cardNumberAboveGrade: `#${upper(snapshot.cardNumber).replace(/^#/, "")}` } : {}),
      certificateNumber,
      grade: formatHumanGrade(snapshot.grade),
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
    grade: formatHumanGrade(snapshot.grade),
  };
}
