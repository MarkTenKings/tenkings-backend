import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  HUMAN_GRADE_LABEL_GEOMETRY,
  HUMAN_GRADE_SHEET_CAPACITY,
  HUMAN_GRADE_SHEET_SLOTS,
  buildHumanGradeLabelContent,
  type HumanGradeLabelSnapshot,
} from "../humanGrade";

type PdfDoc = InstanceType<typeof PDFDocument>;
type PdfImage = {
  width: number;
  height: number;
  obj?: unknown;
  embed(doc: PdfDoc): void;
};

type FontName = "TKHumanDisplay" | "TKHumanSmall";
type FittedBlock = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  fontName: FontName;
  characterSpacingPt: number;
};

export type HumanGradeLabelSheetEntry = {
  slot: number;
  snapshot: HumanGradeLabelSnapshot;
};

const ASSET_DIRECTORY_CANDIDATES = [
  path.join(process.cwd(), "assets", "ai-grader-label-v1"),
  path.join(process.cwd(), "frontend", "nextjs-app", "assets", "ai-grader-label-v1"),
];

const ASSETS = {
  crown: {
    fileName: "ten-kings-crown-2026-monochrome-v1.png",
    sha256: "064156a51ee3e7c49bdf102752bbbd5d21ed41eaf2d58c6be7d5b9994aa307ed",
  },
  displayFont: {
    fileName: "fonts/BebasNeue-Regular.ttf",
    sha256: "830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04",
  },
  smallFont: {
    fileName: "fonts/barlow/Barlow-Regular.ttf",
    sha256: "77fb1ac54d2ceb980e3ebdfa7a9d0f64e85a66e4fdfb7f914a7b0aa08fb33a5d",
  },
  wordmarkFont: {
    fileName: "fonts/barlow/Barlow-SemiBold.ttf",
    sha256: "07ea3ff2743cf6716122a520c5e6f1aed0e75c079bc3b75e512fbf1a85caef9b",
  },
} as const;

const COLORS = {
  ink: "#0f0f0f",
} as const;

export const HUMAN_GRADE_LABEL_FINISH_GEOMETRY = {
  safeInsetIn: 0.08,
  safeInsetPt: 5.76,
  cutGuideStrokePt: 0.75,
  cutGuidePathOffsetPt: -0.375,
} as const;

const LABEL_SECTION_BOUNDARIES = {
  brandEndPt: 44,
  identityEndPt: 132.5,
  labelEndPt: HUMAN_GRADE_LABEL_GEOMETRY.label.widthPt,
} as const;

const BRAND_SECTION_CENTER_PT = LABEL_SECTION_BOUNDARIES.brandEndPt / 2;
const RIGHT_THIRD_CENTER_PT =
  (LABEL_SECTION_BOUNDARIES.identityEndPt + LABEL_SECTION_BOUNDARIES.labelEndPt) / 2;
const BRAND_SAFE_WIDTH_PT =
  (BRAND_SECTION_CENTER_PT - HUMAN_GRADE_LABEL_FINISH_GEOMETRY.safeInsetPt) * 2;
const RIGHT_THIRD_SAFE_WIDTH_PT =
  (LABEL_SECTION_BOUNDARIES.labelEndPt -
    HUMAN_GRADE_LABEL_FINISH_GEOMETRY.safeInsetPt -
    RIGHT_THIRD_CENTER_PT) *
  2;

const LABEL_ZONES = {
  brandCrown: { xPt: 9.496192, yPt: 12.6, widthPt: 25.007616, heightPt: 16.258954 },
  brandWordmark: {
    xPt: HUMAN_GRADE_LABEL_FINISH_GEOMETRY.safeInsetPt,
    yPt: 27.4,
    widthPt: BRAND_SAFE_WIDTH_PT,
  },
  brandCertificate: {
    xPt: HUMAN_GRADE_LABEL_FINISH_GEOMETRY.safeInsetPt,
    yPt: 39,
    widthPt: BRAND_SAFE_WIDTH_PT,
  },
  leftSeparator: { xPt: LABEL_SECTION_BOUNDARIES.brandEndPt, yPt: 8, heightPt: 43.76 },
  identity: { xPt: 48, widthPt: 81.5 },
  rightSeparator: { xPt: LABEL_SECTION_BOUNDARIES.identityEndPt, yPt: 8, heightPt: 43.76 },
  rightThird: {
    xPt: RIGHT_THIRD_CENTER_PT - RIGHT_THIRD_SAFE_WIDTH_PT / 2,
    widthPt: RIGHT_THIRD_SAFE_WIDTH_PT,
    gradeCenterYPt: 23,
    gradeCenterFromTextTopEm: 0.55,
  },
  separatorCrowns: { centerYPt: 29.88, widthPt: 3.4, heightPt: 2.2, lineGapPt: 0.7 },
} as const;

export const HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY = {
  gridTopPt: 33.7,
  rowHeightPt: 8.2,
  paddingXPt: 0,
  columnGapPt: 0.8,
  codeFontSizePt: 8,
  equalsFontSizePt: 8,
  scoreFontSizePt: 9.6,
  codeToEqualsGapPt: 1,
  equalsToScoreGapPt: 1,
  scoreTopOffsetPt: -0.8,
  horizontalScale: 0.84,
  rightThirdCenterXPt: RIGHT_THIRD_CENTER_PT,
  dividerTopPt: 8,
  dividerBottomPt: 51.76,
} as const;

const TEXT_TIERS = {
  metadata: [9, 8, 7, 6, 5],
  primary: [19, 17, 15, 13, 11],
  descriptor: [10, 9, 8, 7, 6, 5],
  certificate: [6.2, 5.8, 5.4, 5],
  grade: [31, 29, 27, 25, 23],
} as const;

function assetDirectory() {
  const selected = ASSET_DIRECTORY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error("Approved Ten Kings label assets are missing.");
  return selected;
}

function readAsset(fileName: string, expectedSha256: string) {
  const bytes = readFileSync(path.join(assetDirectory(), fileName));
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Ten Kings label asset hash mismatch for ${fileName}.`);
  }
  return bytes;
}

function registerFonts(doc: PdfDoc) {
  doc.registerFont("TKHumanDisplay", readAsset(ASSETS.displayFont.fileName, ASSETS.displayFont.sha256));
  doc.registerFont("TKHumanSmall", readAsset(ASSETS.smallFont.fileName, ASSETS.smallFont.sha256));
  doc.registerFont("TKHumanWordmark", readAsset(ASSETS.wordmarkFont.fileName, ASSETS.wordmarkFont.sha256));
}

function openCrown(doc: PdfDoc) {
  const openImage = (source: Buffer) => (doc as unknown as { openImage(source: Buffer): PdfImage }).openImage(source);
  return openImage(readAsset(ASSETS.crown.fileName, ASSETS.crown.sha256));
}

function measure(doc: PdfDoc, text: string, fontSize: number, fontName: FontName, characterSpacingPt: number) {
  return doc.font(fontName).fontSize(fontSize).widthOfString(text, { characterSpacing: characterSpacingPt });
}

function wrapWholeWords(
  doc: PdfDoc,
  value: string,
  widthPt: number,
  fontSize: number,
  maxLines: number,
  fontName: FontName,
  characterSpacingPt: number
) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!words.length) return [] as string[];
  if (measure(doc, words.join(" "), fontSize, fontName, characterSpacingPt) <= widthPt) return [words.join(" ")];
  if (maxLines < 2 || words.some((word) => measure(doc, word, fontSize, fontName, characterSpacingPt) > widthPt)) {
    return undefined;
  }

  const candidates: string[][] = [];
  const visit = (start: number, lines: string[]) => {
    for (let end = start + 1; end <= words.length; end += 1) {
      const line = words.slice(start, end).join(" ");
      if (measure(doc, line, fontSize, fontName, characterSpacingPt) > widthPt) break;
      if (end === words.length) candidates.push([...lines, line]);
      else if (lines.length + 1 < maxLines) visit(end, [...lines, line]);
    }
  };
  visit(0, []);
  candidates.sort((left, right) => {
    const score = (lines: string[]) => {
      const widths = lines.map((line) => measure(doc, line, fontSize, fontName, characterSpacingPt));
      const orphanPenalty = lines.some((line) => !line.includes(" ")) ? 100_000 : 0;
      return orphanPenalty + (Math.max(...widths) - Math.min(...widths)) ** 2;
    };
    return score(left) - score(right);
  });
  return candidates[0];
}

function fitBlock(
  doc: PdfDoc,
  value: string,
  widthPt: number,
  tiers: readonly number[],
  options: {
    maxLines: number;
    fontName: FontName;
    lineHeightEm: number;
    characterSpacingPt: number;
    maxHeightPt?: number;
  }
): FittedBlock {
  for (const fontSize of tiers) {
    const lines = wrapWholeWords(
      doc,
      value,
      widthPt,
      fontSize,
      options.maxLines,
      options.fontName,
      options.characterSpacingPt
    );
    const lineHeight = fontSize * options.lineHeightEm;
    if (lines?.length && (!options.maxHeightPt || lines.length * lineHeight <= options.maxHeightPt)) {
      return {
        lines,
        fontSize,
        lineHeight,
        fontName: options.fontName,
        characterSpacingPt: options.characterSpacingPt,
      };
    }
  }
  throw new Error(`Label text does not fit its approved zone: ${value}`);
}

function drawCenteredBlock(doc: PdfDoc, fitted: FittedBlock, x: number, y: number, width: number) {
  fitted.lines.forEach((line, index) => {
    doc.font(fitted.fontName).fontSize(fitted.fontSize).fillColor(COLORS.ink).text(line, x, y + index * fitted.lineHeight, {
      width,
      align: "center",
      characterSpacing: fitted.characterSpacingPt,
      lineBreak: false,
    });
  });
}

function drawVerticalSeparator(doc: PdfDoc, crown: PdfImage, x: number, y: number, height: number) {
  const ornament = LABEL_ZONES.separatorCrowns;
  const crownTop = ornament.centerYPt - ornament.heightPt / 2;
  const crownBottom = ornament.centerYPt + ornament.heightPt / 2;
  doc.lineWidth(0.55).strokeColor(COLORS.ink);
  doc.moveTo(x, y).lineTo(x, crownTop - ornament.lineGapPt).stroke();
  doc.moveTo(x, crownBottom + ornament.lineGapPt).lineTo(x, y + height).stroke();
  doc.image(crown as unknown as Parameters<PdfDoc["image"]>[0], x - ornament.widthPt / 2, crownTop, {
    fit: [ornament.widthPt, ornament.heightPt],
    align: "center",
    valign: "center",
  });
}

function drawBrand(doc: PdfDoc, crown: PdfImage, content: ReturnType<typeof buildHumanGradeLabelContent>) {
  const brandCrown = LABEL_ZONES.brandCrown;
  doc.image(crown as unknown as Parameters<PdfDoc["image"]>[0], brandCrown.xPt, brandCrown.yPt, {
    fit: [brandCrown.widthPt, brandCrown.heightPt],
    align: "center",
    valign: "center",
  });

  const zone = LABEL_ZONES.brandWordmark;
  const centerX = zone.xPt + zone.widthPt / 2;
  const horizontalScale = 0.84;
  const fontSize = 7.8;
  const unscaledWidth = zone.widthPt / horizontalScale;
  const unscaledX = centerX - unscaledWidth / 2;
  doc.save().translate(centerX, 0).scale(horizontalScale, 1).translate(-centerX, 0);
  doc.font("TKHumanWordmark").fontSize(fontSize).fillColor(COLORS.ink).text("TEN KINGS", unscaledX, zone.yPt, {
    width: unscaledWidth,
    align: "center",
    characterSpacing: 0.12,
    lineBreak: false,
  });
  doc.restore();

  const certificateZone = LABEL_ZONES.brandCertificate;
  const certificate = fitBlock(doc, content.certificateNumber, certificateZone.widthPt, TEXT_TIERS.certificate, {
    maxLines: 1,
    fontName: "TKHumanSmall",
    lineHeightEm: 1,
    characterSpacingPt: 0.08,
  });
  drawCenteredBlock(doc, certificate, certificateZone.xPt, certificateZone.yPt, certificateZone.widthPt);
}

function drawIdentity(doc: PdfDoc, content: ReturnType<typeof buildHumanGradeLabelContent>) {
  const zone = LABEL_ZONES.identity;
  const primary = fitBlock(doc, content.primary, zone.widthPt, TEXT_TIERS.primary, {
    maxLines: 2,
    fontName: "TKHumanDisplay",
    lineHeightEm: 0.88,
    characterSpacingPt: 0,
    maxHeightPt: 24,
  });
  const metadata = fitBlock(doc, content.metadata, zone.widthPt, TEXT_TIERS.metadata, {
    maxLines: 2,
    fontName: "TKHumanSmall",
    lineHeightEm: 1.02,
    characterSpacingPt: 0.12,
    maxHeightPt: 18,
  });
  const topHeight = primary.lines.length * primary.lineHeight + 1 + metadata.lines.length * metadata.lineHeight;
  const topStartY = 2.7 + (34.5 - topHeight) / 2;
  drawCenteredBlock(doc, primary, zone.xPt, topStartY, zone.widthPt);
  drawCenteredBlock(doc, metadata, zone.xPt, topStartY + primary.lines.length * primary.lineHeight + 1, zone.widthPt);

  if (content.descriptor) {
    const descriptor = fitBlock(doc, content.descriptor, zone.widthPt, TEXT_TIERS.descriptor, {
      maxLines: 2,
      fontName: "TKHumanSmall",
      lineHeightEm: 1.02,
      characterSpacingPt: 0.12,
      maxHeightPt: 13,
    });
    const descriptorY = 40.2 + (13 - descriptor.lines.length * descriptor.lineHeight) / 2;
    drawCenteredBlock(doc, descriptor, zone.xPt, descriptorY, zone.widthPt);
  }
}

const SUBGRADE_CODES = {
  CENTERING: "CTR",
  CORNERS: "CRN",
  EDGES: "EDG",
  SURFACE: "SUR",
} as const;

function drawSubgradePair(
  doc: PdfDoc,
  code: string,
  score: string,
  cellX: number,
  cellY: number,
  cellWidth: number
) {
  const geometry = HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY;
  const codeWidth = doc.font("TKHumanSmall").fontSize(geometry.codeFontSizePt).widthOfString(code);
  const equalsWidth = doc.font("TKHumanSmall").fontSize(geometry.equalsFontSizePt).widthOfString("=");
  const scoreWidth = doc.font("TKHumanDisplay").fontSize(geometry.scoreFontSizePt).widthOfString(score);
  const pairWidth =
    codeWidth +
    geometry.codeToEqualsGapPt +
    equalsWidth +
    geometry.equalsToScoreGapPt +
    scoreWidth;
  const scaledPairWidth = pairWidth * geometry.horizontalScale;
  if (scaledPairWidth > cellWidth) {
    throw new Error(`Human-grade subgrade pair does not fit its safe cell: ${code} = ${score}`);
  }
  const centerX = cellX + cellWidth / 2;
  const startX = centerX - pairWidth / 2;

  doc.save().translate(centerX, 0).scale(geometry.horizontalScale, 1).translate(-centerX, 0);
  doc
    .font("TKHumanSmall")
    .fontSize(geometry.codeFontSizePt)
    .fillColor(COLORS.ink)
    .text(code, startX, cellY, { lineBreak: false });
  const equalsX = startX + codeWidth + geometry.codeToEqualsGapPt;
  doc
    .font("TKHumanSmall")
    .fontSize(geometry.equalsFontSizePt)
    .fillColor(COLORS.ink)
    .text("=", equalsX, cellY, { lineBreak: false });
  doc
    .font("TKHumanDisplay")
    .fontSize(geometry.scoreFontSizePt)
    .fillColor(COLORS.ink)
    .text(score, equalsX + equalsWidth + geometry.equalsToScoreGapPt, cellY + geometry.scoreTopOffsetPt, {
      lineBreak: false,
    });
  doc.restore();
}

function drawRightThird(doc: PdfDoc, content: ReturnType<typeof buildHumanGradeLabelContent>) {
  const zone = LABEL_ZONES.rightThird;
  const zoneCenterX = zone.xPt + zone.widthPt / 2;
  if (Math.abs(zoneCenterX - HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.rightThirdCenterXPt) > 0.001) {
    throw new Error("Human-grade right-third content is not centered within its physical section.");
  }
  const grade = fitBlock(doc, content.grade, zone.widthPt, TEXT_TIERS.grade, {
    maxLines: 1,
    fontName: "TKHumanDisplay",
    lineHeightEm: 0.88,
    characterSpacingPt: 0,
  });
  const gradeTop = zone.gradeCenterYPt - grade.fontSize * zone.gradeCenterFromTextTopEm;
  drawCenteredBlock(doc, grade, zone.xPt, gradeTop, zone.widthPt);

  const geometry = HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY;
  const gridInnerWidth = zone.widthPt - geometry.paddingXPt * 2;
  const cellWidth = (gridInnerWidth - geometry.columnGapPt) / 2;
  content.subgrades.forEach((subgrade, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const cellX = zone.xPt + geometry.paddingXPt + column * (cellWidth + geometry.columnGapPt);
    const cellY = geometry.gridTopPt + row * geometry.rowHeightPt;
    const code = SUBGRADE_CODES[subgrade.label as keyof typeof SUBGRADE_CODES];
    if (!code) throw new Error(`Unsupported human-grade subgrade label: ${subgrade.label}`);
    drawSubgradePair(doc, code, subgrade.grade, cellX, cellY, cellWidth);
  });
}

function drawHandCutGuide(doc: PdfDoc) {
  const strokeWidth = HUMAN_GRADE_LABEL_FINISH_GEOMETRY.cutGuideStrokePt;
  const pathOffset = HUMAN_GRADE_LABEL_FINISH_GEOMETRY.cutGuidePathOffsetPt;
  doc
    .save()
    .lineWidth(strokeWidth)
    .strokeColor(COLORS.ink)
    .rect(
      pathOffset,
      pathOffset,
      HUMAN_GRADE_LABEL_GEOMETRY.label.widthPt + strokeWidth,
      HUMAN_GRADE_LABEL_GEOMETRY.label.heightPt + strokeWidth
    )
    .stroke()
    .restore();
}

function drawLabel(
  doc: PdfDoc,
  crown: PdfImage,
  snapshot: HumanGradeLabelSnapshot,
  x: number,
  y: number,
  drawCutGuide: boolean
) {
  const content = buildHumanGradeLabelContent(snapshot);
  doc.save().translate(x, y);
  // Deliberately no background fill: human-grade labels retain transparent artwork.
  drawBrand(doc, crown, content);
  drawVerticalSeparator(doc, crown, LABEL_ZONES.leftSeparator.xPt, LABEL_ZONES.leftSeparator.yPt, LABEL_ZONES.leftSeparator.heightPt);
  drawVerticalSeparator(doc, crown, LABEL_ZONES.rightSeparator.xPt, LABEL_ZONES.rightSeparator.yPt, LABEL_ZONES.rightSeparator.heightPt);
  drawIdentity(doc, content);
  drawRightThird(doc, content);
  if (drawCutGuide) drawHandCutGuide(doc);
  doc.restore();
}

function pdfBuffer(doc: PdfDoc) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export async function renderHumanGradeLabelSheetPdf(entries: readonly HumanGradeLabelSheetEntry[]) {
  if (entries.length > HUMAN_GRADE_SHEET_CAPACITY) throw new Error("Human-grade sheets support at most 16 labels.");
  const slots = new Set<number>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.slot) || entry.slot < 1 || entry.slot > HUMAN_GRADE_SHEET_CAPACITY || slots.has(entry.slot)) {
      throw new Error("Human-grade sheet slots must be unique integers from 1 through 16.");
    }
    slots.add(entry.slot);
  }

  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    compress: false,
    info: {
      Title: "Ten Kings Human Grade Label Sheet",
      Author: "Ten Kings",
      Creator: "Ten Kings Human Grade",
    },
  });
  doc.addPage({ size: [HUMAN_GRADE_LABEL_GEOMETRY.paper.widthPt, HUMAN_GRADE_LABEL_GEOMETRY.paper.heightPt], margin: 0 });
  registerFonts(doc);
  const crown = openCrown(doc);
  const bySlot = new Map(entries.map((entry) => [entry.slot, entry.snapshot]));
  for (const slot of HUMAN_GRADE_SHEET_SLOTS) {
    const snapshot = bySlot.get(slot.slot);
    if (snapshot) drawLabel(doc, crown, snapshot, slot.xPt, slot.yFromTopPt, slot.slot === 15);
  }
  return pdfBuffer(doc);
}
