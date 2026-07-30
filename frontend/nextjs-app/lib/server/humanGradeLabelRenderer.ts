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

const LABEL_ZONES = {
  brandCrown: { xPt: 9.496192, yPt: 12.6, widthPt: 25.007616, heightPt: 16.258954 },
  brandWordmark: { xPt: 2.52, yPt: 27.4, widthPt: 38.96 },
  brandCertificate: { xPt: 2.52, yPt: 39, widthPt: 38.96 },
  leftSeparator: { xPt: 44, yPt: 8, heightPt: 43.76 },
  identity: { xPt: 48, widthPt: 81.5 },
  rightSeparator: { xPt: 132.5, yPt: 8, heightPt: 43.76 },
  rightThird: {
    xPt: 136,
    widthPt: 57.8,
    gradeCenterYPt: 29.88,
    gradeCenterFromTextTopEm: 0.55,
  },
  separatorCrowns: { centerYPt: 29.88, widthPt: 3.4, heightPt: 2.2, lineGapPt: 0.7 },
} as const;

export const HUMAN_GRADE_HUD_GEOMETRY = {
  frameWidthPt: 38,
  frameHeightPt: 46.2,
  frameCenterYPt: 29.88,
  frameStrokePt: 0.42,
  axisStrokePt: 0.32,
  cornerReticleRadiusPt: 1.7,
  cornerReticleArmPt: 2.6,
  cornerLineClearancePt: 2.65,
  gradeClearanceXPt: 2.2,
  gradeClearanceYPt: 1.2,
  nodeRadiusPt: 5.15,
  nodeStrokePt: 0.42,
  nodeLineClearancePt: 0.7,
  nodeScoreFontSizePt: 9.6,
} as const;

const TEXT_TIERS = {
  metadata: [9, 8, 7, 6, 5],
  primary: [19, 17, 15, 13, 11],
  descriptor: [10, 9, 8, 7, 6, 5],
  certificate: [6.2, 5.8, 5.4, 5],
  grade: [25, 24, 23, 22, 21],
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
  const horizontalScale = 0.88;
  const unscaledWidth = zone.widthPt / horizontalScale;
  const unscaledX = centerX - unscaledWidth / 2;
  doc.save().translate(centerX, 0).scale(horizontalScale, 1).translate(-centerX, 0);
  doc.font("TKHumanWordmark").fontSize(9.005493).fillColor(COLORS.ink).text("TEN KINGS", unscaledX, zone.yPt, {
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

type HudNode = {
  grade: string;
};

function drawHudNode(doc: PdfDoc, node: HudNode, centerX: number, centerY: number) {
  const geometry = HUMAN_GRADE_HUD_GEOMETRY;
  const nodeDiameter = geometry.nodeRadiusPt * 2;
  const score = fitBlock(
    doc,
    node.grade,
    nodeDiameter - 1.3,
    [geometry.nodeScoreFontSizePt, 9.1, 8.6],
    {
      maxLines: 1,
      fontName: "TKHumanDisplay",
      lineHeightEm: 0.88,
      characterSpacingPt: 0,
    }
  );
  const scoreTop = centerY - score.fontSize * 0.55;

  doc.lineWidth(geometry.nodeStrokePt).strokeColor(COLORS.ink).circle(centerX, centerY, geometry.nodeRadiusPt).stroke();
  drawCenteredBlock(doc, score, centerX - geometry.nodeRadiusPt, scoreTop, nodeDiameter);
}

function drawHudReticle(doc: PdfDoc, x: number, y: number) {
  const geometry = HUMAN_GRADE_HUD_GEOMETRY;
  doc.lineWidth(geometry.axisStrokePt).strokeColor(COLORS.ink);
  doc.circle(x, y, geometry.cornerReticleRadiusPt).stroke();
  doc
    .moveTo(x - geometry.cornerReticleArmPt, y)
    .lineTo(x + geometry.cornerReticleArmPt, y)
    .stroke();
  doc
    .moveTo(x, y - geometry.cornerReticleArmPt)
    .lineTo(x, y + geometry.cornerReticleArmPt)
    .stroke();
  doc.circle(x, y, 0.55).stroke();
}

function drawHudSegment(doc: PdfDoc, x1: number, y1: number, x2: number, y2: number, width: number) {
  if (x2 < x1 || y2 < y1) return;
  doc.lineWidth(width).strokeColor(COLORS.ink).moveTo(x1, y1).lineTo(x2, y2).stroke();
}

function drawRightThird(doc: PdfDoc, content: ReturnType<typeof buildHumanGradeLabelContent>) {
  const zone = LABEL_ZONES.rightThird;
  const geometry = HUMAN_GRADE_HUD_GEOMETRY;
  const centerX = zone.xPt + zone.widthPt / 2;
  const centerY = geometry.frameCenterYPt;
  const frameLeft = centerX - geometry.frameWidthPt / 2;
  const frameRight = centerX + geometry.frameWidthPt / 2;
  const frameTop = centerY - geometry.frameHeightPt / 2;
  const frameBottom = centerY + geometry.frameHeightPt / 2;
  const grade = fitBlock(doc, content.grade, geometry.frameWidthPt - 8, TEXT_TIERS.grade, {
    maxLines: 1,
    fontName: "TKHumanDisplay",
    lineHeightEm: 0.88,
    characterSpacingPt: 0,
  });
  const gradeTop = centerY - grade.fontSize * zone.gradeCenterFromTextTopEm;
  const gradeTextWidth = measure(doc, content.grade, grade.fontSize, grade.fontName, grade.characterSpacingPt);
  const gradeLeft = centerX - gradeTextWidth / 2 - geometry.gradeClearanceXPt;
  const gradeRight = centerX + gradeTextWidth / 2 + geometry.gradeClearanceXPt;
  const gradeVisualTop = centerY - grade.fontSize * 0.4 - geometry.gradeClearanceYPt;
  const gradeVisualBottom = centerY + grade.fontSize * 0.4 + geometry.gradeClearanceYPt;
  const subgradeByLabel = new Map(content.subgrades.map((subgrade) => [subgrade.label, subgrade.grade]));
  const nodes: HudNode[] = [
    { grade: subgradeByLabel.get("CENTERING") ?? "" },
    { grade: subgradeByLabel.get("CORNERS") ?? "" },
    { grade: subgradeByLabel.get("EDGES") ?? "" },
    { grade: subgradeByLabel.get("SURFACE") ?? "" },
  ];
  const topNode = nodes[0];
  const leftNode = nodes[1];
  const rightNode = nodes[2];
  const bottomNode = nodes[3];
  const nodeGap = geometry.nodeRadiusPt + geometry.nodeLineClearancePt;
  const cornerClearance = geometry.cornerLineClearancePt;

  drawHudSegment(
    doc,
    frameLeft + cornerClearance,
    frameTop,
    centerX - nodeGap,
    frameTop,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    centerX + nodeGap,
    frameTop,
    frameRight - cornerClearance,
    frameTop,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    frameLeft + cornerClearance,
    frameBottom,
    centerX - nodeGap,
    frameBottom,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    centerX + nodeGap,
    frameBottom,
    frameRight - cornerClearance,
    frameBottom,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    frameLeft,
    frameTop + cornerClearance,
    frameLeft,
    centerY - nodeGap,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    frameLeft,
    centerY + nodeGap,
    frameLeft,
    frameBottom - cornerClearance,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    frameRight,
    frameTop + cornerClearance,
    frameRight,
    centerY - nodeGap,
    geometry.frameStrokePt
  );
  drawHudSegment(
    doc,
    frameRight,
    centerY + nodeGap,
    frameRight,
    frameBottom - cornerClearance,
    geometry.frameStrokePt
  );

  drawHudSegment(
    doc,
    centerX,
    frameTop + nodeGap,
    centerX,
    gradeVisualTop,
    geometry.axisStrokePt
  );
  drawHudSegment(
    doc,
    centerX,
    gradeVisualBottom,
    centerX,
    frameBottom - nodeGap,
    geometry.axisStrokePt
  );
  drawHudSegment(
    doc,
    frameLeft + nodeGap,
    centerY,
    gradeLeft,
    centerY,
    geometry.axisStrokePt
  );
  drawHudSegment(
    doc,
    gradeRight,
    centerY,
    frameRight - nodeGap,
    centerY,
    geometry.axisStrokePt
  );

  drawHudReticle(doc, frameLeft, frameTop);
  drawHudReticle(doc, frameRight, frameTop);
  drawHudReticle(doc, frameLeft, frameBottom);
  drawHudReticle(doc, frameRight, frameBottom);

  drawHudNode(doc, topNode, centerX, frameTop);
  drawHudNode(doc, leftNode, frameLeft, centerY);
  drawHudNode(doc, rightNode, frameRight, centerY);
  drawHudNode(doc, bottomNode, centerX, frameBottom);
  drawCenteredBlock(doc, grade, centerX - geometry.frameWidthPt / 2, gradeTop, geometry.frameWidthPt);
}

function drawLabel(doc: PdfDoc, crown: PdfImage, snapshot: HumanGradeLabelSnapshot, x: number, y: number) {
  const content = buildHumanGradeLabelContent(snapshot);
  doc.save().translate(x, y);
  // Deliberately no background fill: human-grade labels retain transparent artwork.
  drawBrand(doc, crown, content);
  drawVerticalSeparator(doc, crown, LABEL_ZONES.leftSeparator.xPt, LABEL_ZONES.leftSeparator.yPt, LABEL_ZONES.leftSeparator.heightPt);
  drawVerticalSeparator(doc, crown, LABEL_ZONES.rightSeparator.xPt, LABEL_ZONES.rightSeparator.yPt, LABEL_ZONES.rightSeparator.heightPt);
  drawIdentity(doc, content);
  drawRightThird(doc, content);
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
    if (snapshot) drawLabel(doc, crown, snapshot, slot.xPt, slot.yFromTopPt);
  }
  return pdfBuffer(doc);
}
