export const AI_GRADER_LABEL_V1_SCHEMA_VERSION = "ten-kings-label-spec-v1" as const;
export const AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID = "ten-kings-sports-label-v1" as const;
export const AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID = "ten-kings-pokemon-label-v1" as const;
export const AI_GRADER_LABEL_V1_RUNTIME_SCHEMA_VERSION = "ten-kings-label-runtime-v1" as const;
export const AI_GRADER_LABEL_V1_DESIGN_APPROVAL = {
  status: "approved",
  phrase: "Label V1 design approved",
  approvedOn: "2026-07-13",
  physicalCalibrationStatus: "provisional_not_physically_calibrated",
} as const;

export type AiGraderLabelV1TemplateId =
  | typeof AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID
  | typeof AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID;

export type AiGraderLabelV1Asset = {
  assetId: string;
  version: string;
  role: "logo" | "ornament" | "font" | "design_reference";
  fileName: string;
  mimeType: string;
  sha256: string;
  widthPx?: number;
  heightPx?: number;
  dpi?: number;
  approvedForProduction: boolean;
};

export const AI_GRADER_LABEL_V1_ASSETS = {
  logoSource: {
    assetId: "ten-kings-logo-2026",
    version: "v1",
    role: "design_reference",
    fileName: "ten-kings-logo-2026-v1.png",
    mimeType: "image/png",
    sha256: "c7461cc51eefdf5c259c9895eca1ceab870865c660988273cc8241c1ea8ae470",
    widthPx: 1500,
    heightPx: 1170,
    dpi: 300,
    approvedForProduction: false,
  },
  logo: {
    assetId: "ten-kings-logo-2026-monochrome",
    version: "v1-derived-from-ten-kings-logo-2026-v1",
    role: "logo",
    fileName: "ten-kings-logo-2026-monochrome-v1.png",
    mimeType: "image/png",
    sha256: "801b4071499af546102c3d703f27deb3dabc7a4374d5d621eb8ad672ceeeae88",
    widthPx: 1500,
    heightPx: 1170,
    dpi: 300,
    approvedForProduction: true,
  },
  crown: {
    assetId: "ten-kings-crown-2026-monochrome",
    version: "v1-crop-from-ten-kings-logo-2026-v1",
    role: "ornament",
    fileName: "ten-kings-crown-2026-monochrome-v1.png",
    mimeType: "image/png",
    sha256: "064156a51ee3e7c49bdf102752bbbd5d21ed41eaf2d58c6be7d5b9994aa307ed",
    widthPx: 1206,
    heightPx: 784,
    dpi: 300,
    approvedForProduction: true,
  },
  font: {
    assetId: "bebas-neue",
    version: "regular-400-ofl-v1",
    role: "font",
    fileName: "fonts/BebasNeue-Regular.ttf",
    mimeType: "font/ttf",
    sha256: "830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04",
    approvedForProduction: true,
  },
  sportsReference: {
    assetId: "ten-kings-sports-label-design-reference",
    version: "v1",
    role: "design_reference",
    fileName: "references/ten-kings-sports-label-reference-v1.png",
    mimeType: "image/png",
    sha256: "0da40a07ad789106af0498a1fd62703d33d98fa1680c4b4a30fd20d634ee01d6",
    widthPx: 2559,
    heightPx: 778,
    dpi: 937.006,
    approvedForProduction: false,
  },
  pokemonReference: {
    assetId: "ten-kings-pokemon-label-design-reference",
    version: "v1",
    role: "design_reference",
    fileName: "references/ten-kings-pokemon-label-reference-v1.png",
    mimeType: "image/png",
    sha256: "554a99edbec8806e7b03182e00de32f02a3d9dcbfcc29adac3d2d2191997f1a5",
    widthPx: 2559,
    heightPx: 778,
    dpi: 937.006,
    approvedForProduction: false,
  },
} as const satisfies Record<string, AiGraderLabelV1Asset>;

const INCH = 72;

export const AI_GRADER_LABEL_V1_COORDINATE_MANIFEST = {
  schemaVersion: AI_GRADER_LABEL_V1_SCHEMA_VERSION,
  coordinateAuthority: "top_left_pdf_points",
  pointsPerInch: INCH,
  paper: {
    widthIn: 8.5,
    heightIn: 12,
    widthPt: 612,
    heightPt: 864,
    orientation: "portrait",
  },
  label: {
    widthIn: 2.73,
    heightIn: 0.83,
    widthPt: 196.56,
    heightPt: 59.76,
  },
  sheet: {
    columns: 2,
    rows: 8,
    capacity: 16,
    marginLeftPt: 72,
    marginTopPt: 72,
    marginRightPt: 72,
    marginBottomPt: 72,
    columnGapPt: 74.88,
    rowGapPt: 34.56,
    xPositionsPt: [72, 343.44],
    yPositionsFromTopPt: [72, 166.32, 260.64, 354.96, 449.28, 543.6, 637.92, 732.24],
    slotOrder: "row_major_left_to_right_top_to_bottom",
  },
  labelZones: {
    safeInsetPt: 2.52,
    logo: { xPt: 5.04, yPt: 15.2, widthPt: 25.92, heightPt: 20.22, scaleFromInitialProof: 0.6 },
    gradingText: { xPt: 4.2, yPt: 37.1, widthPt: 27.6, fontSizePt: 3.8 },
    leftSeparator: { xPt: 36, yPt: 8, heightPt: 43.76 },
    identity: { xPt: 40, yPt: 3.5, widthPt: 89.5, heightPt: 52.76 },
    rightSeparator: { xPt: 132.5, yPt: 8, heightPt: 43.76 },
    nfcReserved: {
      xPt: 134.25,
      yPt: 14.29,
      widthPt: 31.18,
      heightPt: 31.18,
      orientation: "portrait",
      diameterMm: 11,
      centerXPt: 149.84,
      centerYPt: 29.88,
      certTopPt: 47.05,
      provisional: true,
    },
    grade: {
      xPt: 168.25,
      widthPt: 26.2,
      cardNumberTopPt: 4.2,
      glyphCenterYPt: 29.88,
      glyphCenterFromTextTopEm: 0.55,
    },
    divider: { yPt: 38.4, crownWidthPt: 5.7, crownHeightPt: 3.7 },
    separatorCrowns: { centerYPt: 29.88, widthPt: 3.4, heightPt: 2.2, lineGapPt: 0.7 },
  },
  pdf: {
    coordinateOrigin: "bottom_left",
    topLeftToPdfYFormula: "paperHeightPt - topLeftYPt - labelHeightPt",
  },
  svg: {
    coordinateOrigin: "top_left",
    viewBox: "0 0 612 864",
  },
  calibration: {
    status: "provisional_not_physically_calibrated",
    printProfileId: "ten-kings-foil-express-provisional-v1",
    cutProfileId: "ten-kings-cricut-provisional-v1",
    printOffsetXPt: 0,
    printOffsetYPt: 0,
    printScaleX: 1,
    printScaleY: 1,
    cutOffsetXPt: 0,
    cutOffsetYPt: 0,
    cutScaleX: 1,
    cutScaleY: 1,
    cutRotationDeg: 0,
  },
} as const;

export type AiGraderLabelV1SheetSlot = {
  slot: number;
  row: number;
  column: number;
  xPt: number;
  yFromTopPt: number;
  pdfYPt: number;
};

export const AI_GRADER_LABEL_V1_SHEET_SLOTS: readonly AiGraderLabelV1SheetSlot[] =
  AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.sheet.yPositionsFromTopPt.flatMap((yFromTopPt, rowIndex) =>
    AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.sheet.xPositionsPt.map((xPt, columnIndex) => ({
      slot: rowIndex * AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.sheet.columns + columnIndex + 1,
      row: rowIndex + 1,
      column: columnIndex + 1,
      xPt,
      yFromTopPt,
      pdfYPt:
        AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.paper.heightPt -
        yFromTopPt -
        AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.heightPt,
    }))
  );

export type AiGraderLabelV1Identity = {
  category?: "sport" | "tcg" | "comics";
  title?: string;
  playerName?: string;
  cardName?: string;
  teamName?: string;
  year?: string;
  manufacturer?: string;
  sport?: string;
  game?: string;
  productSet?: string;
  productLine?: string;
  insert?: string;
  insertSet?: string;
  parallel?: string;
  cardNumber?: string;
  numbered?: string;
  autograph?: boolean;
  memorabilia?: boolean;
};

export type AiGraderLabelV1Snapshot = {
  templateId: AiGraderLabelV1TemplateId;
  reportId: string;
  certId: string;
  grade: string | number;
  publicReportUrl: string;
  identity: AiGraderLabelV1Identity;
};

export type AiGraderLabelV1Content = {
  metadata: string;
  primary: string;
  descriptor?: string;
  cardNumberAboveGrade?: string;
  certId: string;
  grade: string;
};

export type AiGraderLabelV1RuntimeRecord = {
  schemaVersion: typeof AI_GRADER_LABEL_V1_RUNTIME_SCHEMA_VERSION;
  designApproval: typeof AI_GRADER_LABEL_V1_DESIGN_APPROVAL;
  templateId: AiGraderLabelV1TemplateId;
  templateDigestSha256: string;
  renderAssets: Array<{
    assetId: string;
    version: string;
    sha256: string;
  }>;
  calibrationProfile: typeof AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.calibration;
  immutableSheetAssignment: {
    sheetId: string;
    sheetNumber: number;
    slot: number;
    assignedAt: string;
  };
  immutableIdentitySnapshot: AiGraderLabelV1Identity;
  renderSnapshot: AiGraderLabelV1Snapshot;
};

export const AI_GRADER_LABEL_V1_TEXT_TIERS = {
  metadata: [9, 8, 7, 6],
  primary: [19, 17, 15, 13, 11],
  descriptor: [10, 9, 8, 7, 6],
  cert: [6.2, 5.6, 5],
  cardNumber: [7, 6.2, 5.5],
  grade: [34, 31, 28, 25, 22, 19],
  minimumReadablePt: 5,
} as const;

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : undefined;
}

function uppercaseParts(values: Array<unknown>) {
  return values.map(clean).filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase());
}

function joinParts(values: Array<unknown>, separator = " ") {
  return uppercaseParts(values).join(separator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function strictAiGraderLabelV1JsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => strictAiGraderLabelV1JsonEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
    return leftKeys.every((key) => strictAiGraderLabelV1JsonEqual(left[key], right[key]));
  }
  return false;
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableJsonValue(value[key]);
      return result;
    }, {});
}

function immutableSheetAssignment(value: {
  sheetId: string;
  sheetNumber: number;
  slot: number;
  assignedAt: string;
}) {
  const sheetId = clean(value.sheetId);
  const assignedAtDate = typeof value.assignedAt === "string" ? new Date(value.assignedAt) : new Date(Number.NaN);
  if (
    !sheetId ||
    !Number.isInteger(value.sheetNumber) ||
    value.sheetNumber < 1 ||
    !Number.isInteger(value.slot) ||
    value.slot < 1 ||
    value.slot > 16 ||
    !Number.isFinite(assignedAtDate.getTime())
  ) {
    throw new Error("Label V1 requires one valid immutable sheet assignment.");
  }
  return {
    sheetId,
    sheetNumber: value.sheetNumber,
    slot: value.slot,
    assignedAt: assignedAtDate.toISOString(),
  };
}

function stableIdentity(value: unknown): AiGraderLabelV1Identity {
  const source = isRecord(value) ? value : {};
  const identity: AiGraderLabelV1Identity = {};
  for (const key of [
    "category",
    "title",
    "playerName",
    "cardName",
    "teamName",
    "year",
    "manufacturer",
    "sport",
    "game",
    "productSet",
    "productLine",
    "insert",
    "insertSet",
    "parallel",
    "cardNumber",
    "numbered",
  ] as const) {
    const normalized = clean(source[key]);
    if (normalized) (identity as Record<string, unknown>)[key] = normalized;
  }
  for (const key of ["autograph", "memorabilia"] as const) {
    if (typeof source[key] === "boolean") identity[key] = source[key];
  }
  return identity;
}

export function aiGraderLabelV1TemplateForIdentity(identity: AiGraderLabelV1Identity): AiGraderLabelV1TemplateId {
  if (identity.category === "sport") return AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID;
  const normalizedGame = clean(identity.game)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (identity.category === "tcg" && normalizedGame === "pokemon") return AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID;
  throw new Error("Label V1 currently supports Sports and Pokemon cards only.");
}

function renderAssetReferences() {
  return [AI_GRADER_LABEL_V1_ASSETS.logo, AI_GRADER_LABEL_V1_ASSETS.crown, AI_GRADER_LABEL_V1_ASSETS.font].map((asset) => ({
    assetId: asset.assetId,
    version: asset.version,
    sha256: asset.sha256,
  }));
}

export function buildAiGraderLabelV1RuntimeRecord(input: {
  templateDigestSha256: string;
  reportId: string;
  certId: string;
  grade: string | number;
  publicReportUrl: string;
  identity: AiGraderLabelV1Identity;
  sheetAssignment: {
    sheetId: string;
    sheetNumber: number;
    slot: number;
    assignedAt: string;
  };
}): AiGraderLabelV1RuntimeRecord {
  if (!/^[a-f0-9]{64}$/.test(input.templateDigestSha256)) throw new Error("Label V1 template digest must be SHA-256 hex.");
  const identity = stableIdentity(input.identity);
  const templateId = aiGraderLabelV1TemplateForIdentity(identity);
  const renderSnapshot: AiGraderLabelV1Snapshot = {
    templateId,
    reportId: clean(input.reportId) ?? "",
    certId: clean(input.certId) ?? "",
    grade: formatAiGraderLabelV1Grade(input.grade),
    publicReportUrl: clean(input.publicReportUrl) ?? "",
    identity,
  };
  if (!renderSnapshot.reportId || !renderSnapshot.certId || !renderSnapshot.publicReportUrl) {
    throw new Error("Label V1 runtime record requires report, certificate, and public report URL authority.");
  }
  buildAiGraderLabelV1Content(renderSnapshot);
  return {
    schemaVersion: AI_GRADER_LABEL_V1_RUNTIME_SCHEMA_VERSION,
    designApproval: AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
    templateId,
    templateDigestSha256: input.templateDigestSha256,
    renderAssets: renderAssetReferences(),
    calibrationProfile: AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.calibration,
    immutableSheetAssignment: immutableSheetAssignment(input.sheetAssignment),
    immutableIdentitySnapshot: identity,
    renderSnapshot,
  };
}

export function parseAiGraderLabelV1RuntimeRecord(value: unknown, expectedTemplateDigestSha256: string) {
  if (!isRecord(value) || value.schemaVersion !== AI_GRADER_LABEL_V1_RUNTIME_SCHEMA_VERSION) return null;
  if (value.templateDigestSha256 !== expectedTemplateDigestSha256) return null;
  if (!strictAiGraderLabelV1JsonEqual(value.designApproval, AI_GRADER_LABEL_V1_DESIGN_APPROVAL)) return null;
  const snapshot = isRecord(value.renderSnapshot) ? value.renderSnapshot : {};
  const identity = stableIdentity(snapshot.identity);
  const assignment = isRecord(value.immutableSheetAssignment) ? value.immutableSheetAssignment : {};
  let rebuilt: AiGraderLabelV1RuntimeRecord;
  try {
    rebuilt = buildAiGraderLabelV1RuntimeRecord({
      templateDigestSha256: expectedTemplateDigestSha256,
      reportId: snapshot.reportId as string,
      certId: snapshot.certId as string,
      grade: snapshot.grade as string,
      publicReportUrl: snapshot.publicReportUrl as string,
      identity,
      sheetAssignment: {
        sheetId: assignment.sheetId as string,
        sheetNumber: assignment.sheetNumber as number,
        slot: assignment.slot as number,
        assignedAt: assignment.assignedAt as string,
      },
    });
  } catch {
    return null;
  }
  return strictAiGraderLabelV1JsonEqual(value, rebuilt) ? rebuilt : null;
}

export function canonicalAiGraderLabelV1RuntimeRecord(value: AiGraderLabelV1RuntimeRecord) {
  return JSON.stringify(stableJsonValue(value));
}

export function formatAiGraderLabelV1Grade(value: string | number) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10) {
    throw new Error("Label V1 requires a final numeric grade between 1 and 10.");
  }
  const rounded = Math.round(numeric * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function buildAiGraderLabelV1Content(snapshot: AiGraderLabelV1Snapshot): AiGraderLabelV1Content {
  const identity = snapshot.identity ?? {};
  const productSet = clean(identity.productSet) ?? clean(identity.productLine);
  const cardNumber = clean(identity.cardNumber);
  const certId = clean(snapshot.certId);
  if (!certId) throw new Error("Label V1 requires a human-readable cert/report ID.");

  if (snapshot.templateId === AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID) {
    const primary = clean(identity.playerName) ?? clean(identity.title);
    const metadata = joinParts([identity.year, identity.manufacturer, productSet]);
    const descriptor = joinParts([identity.parallel, identity.insert], " / ");
    if (!primary || !metadata) throw new Error("Sports Label V1 requires year, manufacturer/set, and player/title.");
    return {
      metadata,
      primary: primary.toUpperCase(),
      ...(descriptor ? { descriptor } : {}),
      ...(cardNumber ? { cardNumberAboveGrade: `#${cardNumber.toUpperCase()}` } : {}),
      certId,
      grade: formatAiGraderLabelV1Grade(snapshot.grade),
    };
  }

  if (snapshot.templateId === AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID) {
    const primary = clean(identity.cardName) ?? clean(identity.title);
    const metadata = joinParts([identity.year, productSet, cardNumber ? `#${cardNumber}` : undefined]);
    const descriptor = joinParts([identity.parallel]);
    if (!primary || !metadata) throw new Error("Pokemon Label V1 requires year, set, and card name/title.");
    return {
      metadata,
      primary: primary.toUpperCase(),
      ...(descriptor ? { descriptor } : {}),
      certId,
      grade: formatAiGraderLabelV1Grade(snapshot.grade),
    };
  }

  throw new Error("Unsupported Label V1 template ID.");
}

export function aiGraderLabelV1AssetList() {
  return Object.values(AI_GRADER_LABEL_V1_ASSETS);
}
