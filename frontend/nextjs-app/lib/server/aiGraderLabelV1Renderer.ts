import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AI_GRADER_LABEL_V1_ASSETS,
  AI_GRADER_LABEL_V1_COORDINATE_MANIFEST,
  AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
  AI_GRADER_LABEL_V1_SCHEMA_VERSION,
  AI_GRADER_LABEL_V1_SHEET_SLOTS,
  AI_GRADER_LABEL_V1_TEXT_TIERS,
  aiGraderLabelV1AssetList,
  buildAiGraderLabelV1Content,
  type AiGraderLabelV1Snapshot,
} from "../aiGraderLabelV1";

type PdfDoc = InstanceType<typeof PDFDocument>;
type PdfImage = {
  width: number;
  height: number;
  label: string;
  obj?: unknown;
  embed(doc: PdfDoc): void;
};

type FittedBlock = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  wrapped: boolean;
};

type LabelLayout = {
  metadata: FittedBlock;
  primary: FittedBlock;
  descriptor?: FittedBlock;
  cert: FittedBlock;
  grade: FittedBlock;
  cardNumber?: FittedBlock;
  topStartY: number;
  descriptorStartY?: number;
};

export type AiGraderLabelV1SheetEntry = {
  slot: number;
  snapshot: AiGraderLabelV1Snapshot;
};

const FIXED_PDF_DATE = new Date("2026-07-13T00:00:00.000Z");
const ASSET_DIRECTORY_CANDIDATES = [
  path.join(process.cwd(), "assets", "ai-grader-label-v1"),
  path.join(process.cwd(), "frontend", "nextjs-app", "assets", "ai-grader-label-v1"),
];

function assetDirectory() {
  const selected = ASSET_DIRECTORY_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!selected) throw new Error("Label V1 approved-source asset directory is missing.");
  return selected;
}

function assetPath(fileName: string) {
  return path.join(assetDirectory(), fileName);
}

function sha256(bytes: Buffer | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readApprovedAsset(fileName: string, expectedSha256: string) {
  const bytes = readFileSync(assetPath(fileName));
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Label V1 asset hash mismatch for ${fileName}.`);
  }
  return bytes;
}

function pngDimensions(bytes: Buffer) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Label V1 expected a valid PNG asset.");
  }
  return { widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) };
}

export function assertAiGraderLabelV1Assets() {
  for (const asset of aiGraderLabelV1AssetList()) {
    const bytes = readApprovedAsset(asset.fileName, asset.sha256);
    if (asset.mimeType === "image/png") {
      const dimensions = pngDimensions(bytes);
      if (dimensions.widthPx !== asset.widthPx || dimensions.heightPx !== asset.heightPx) {
        throw new Error(`Label V1 asset dimensions do not match the manifest for ${asset.fileName}.`);
      }
    }
  }
}

export function aiGraderLabelV1TemplateDigest() {
  return sha256(
    JSON.stringify({
      schemaVersion: AI_GRADER_LABEL_V1_SCHEMA_VERSION,
      designApproval: AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
      assets: aiGraderLabelV1AssetList().map((asset) => ({
        assetId: asset.assetId,
        version: asset.version,
        sha256: asset.sha256,
        approvedForProduction: asset.approvedForProduction,
      })),
      coordinates: AI_GRADER_LABEL_V1_COORDINATE_MANIFEST,
      textTiers: AI_GRADER_LABEL_V1_TEXT_TIERS,
      fieldMappingVersion: "ten-kings-label-field-map-approved-v1",
      overflowPolicyVersion: "balanced-whole-word-hyphen-approved-v1",
    })
  );
}

function registerFonts(doc: PdfDoc) {
  const font = readApprovedAsset(AI_GRADER_LABEL_V1_ASSETS.font.fileName, AI_GRADER_LABEL_V1_ASSETS.font.sha256);
  doc.registerFont("TKLabelRegular", font);
  doc.registerFont("TKLabelBold", font);
}

function openVerifiedImages(doc: PdfDoc) {
  const openImage = (source: Buffer) => (doc as unknown as { openImage(source: Buffer): PdfImage }).openImage(source);
  return {
    logo: openImage(readApprovedAsset(AI_GRADER_LABEL_V1_ASSETS.logo.fileName, AI_GRADER_LABEL_V1_ASSETS.logo.sha256)),
    crown: openImage(readApprovedAsset(AI_GRADER_LABEL_V1_ASSETS.crown.fileName, AI_GRADER_LABEL_V1_ASSETS.crown.sha256)),
  };
}

function measure(doc: PdfDoc, value: string, fontSize: number) {
  return doc.font("TKLabelRegular").fontSize(fontSize).widthOfString(value, { characterSpacing: 0 });
}

type WrapToken = {
  text: string;
  attachToPrevious: boolean;
};

function wrapTokens(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .flatMap((word) =>
      word.split(/(?=-[A-Za-z])/g).map((text, index) => ({
        text,
        attachToPrevious: index > 0,
      }))
    );
}

function joinWrapTokens(tokens: readonly WrapToken[]) {
  return tokens.reduce((line, token) => {
    if (!line || token.attachToPrevious) return `${line}${token.text}`;
    return `${line} ${token.text}`;
  }, "");
}

function wrapWholeWords(doc: PdfDoc, value: string, widthPt: number, fontSize: number, maxLines: number) {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return [];
  if (measure(doc, text, fontSize) <= widthPt) return [text];
  if (maxLines < 2) return undefined;

  const tokens = wrapTokens(text);
  if (!tokens.length || tokens.some((token) => measure(doc, token.text, fontSize) > widthPt)) return undefined;

  const candidates: Array<{ lines: string[]; widths: number[]; tokenCounts: number[]; startsWithHyphen: boolean[] }> = [];
  const visit = (start: number, lines: string[], widths: number[], tokenCounts: number[], startsWithHyphen: boolean[]) => {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      const lineTokens = tokens.slice(start, end);
      const line = joinWrapTokens(lineTokens);
      const lineWidth = measure(doc, line, fontSize);
      if (lineWidth > widthPt) break;
      if (end === tokens.length) {
        candidates.push({
          lines: [...lines, line],
          widths: [...widths, lineWidth],
          tokenCounts: [...tokenCounts, lineTokens.length],
          startsWithHyphen: [...startsWithHyphen, line.startsWith("-")],
        });
      } else if (lines.length + 1 < maxLines) {
        visit(
          end,
          [...lines, line],
          [...widths, lineWidth],
          [...tokenCounts, lineTokens.length],
          [...startsWithHyphen, line.startsWith("-")]
        );
      }
    }
  };
  visit(0, [], [], [], []);
  if (!candidates.length) return undefined;

  candidates.sort((left, right) => {
    const score = (candidate: (typeof candidates)[number]) => {
      const orphanCount =
        tokens.length >= 4
          ? candidate.tokenCounts.filter((count, index) => count === 1 && !candidate.startsWithHyphen[index]).length
          : 0;
      const widest = Math.max(...candidate.widths);
      const narrowest = Math.min(...candidate.widths);
      return orphanCount * 1_000_000 + (widest - narrowest) ** 2;
    };
    return score(left) - score(right);
  });
  return candidates[0].lines;
}

function fitBlock(
  doc: PdfDoc,
  value: string,
  widthPt: number,
  tiers: readonly number[],
  input: { maxLines: number; lineHeightRatio?: number; maxHeightPt?: number }
): FittedBlock {
  for (const fontSize of tiers) {
    const lines = wrapWholeWords(doc, value, widthPt, fontSize, input.maxLines);
    const lineHeight = fontSize * (input.lineHeightRatio ?? 0.92);
    if (lines && (!input.maxHeightPt || lines.length * lineHeight <= input.maxHeightPt)) {
      return { lines, fontSize, lineHeight, wrapped: lines.length > 1 };
    }
  }
  throw new Error(`Label V1 cannot fit whole words inside the approved fixed tiers: ${value}`);
}

function buildLayout(doc: PdfDoc, snapshot: AiGraderLabelV1Snapshot): LabelLayout {
  const content = buildAiGraderLabelV1Content(snapshot);
  const identityWidth = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.identity.widthPt;
  let metadata: FittedBlock | undefined;
  let primary: FittedBlock | undefined;
  for (const primaryTier of AI_GRADER_LABEL_V1_TEXT_TIERS.primary) {
    const primaryLines = wrapWholeWords(doc, content.primary, identityWidth, primaryTier, 2);
    if (!primaryLines) continue;
    for (const metadataTier of AI_GRADER_LABEL_V1_TEXT_TIERS.metadata) {
      const metadataLines = wrapWholeWords(doc, content.metadata, identityWidth, metadataTier, 2);
      if (!metadataLines || metadataLines.length + primaryLines.length > 4) continue;
      const candidateMetadata = { lines: metadataLines, fontSize: metadataTier, lineHeight: metadataTier * 0.9, wrapped: metadataLines.length > 1 };
      const candidatePrimary = { lines: primaryLines, fontSize: primaryTier, lineHeight: primaryTier * 0.9, wrapped: primaryLines.length > 1 };
      const totalHeight = candidateMetadata.lines.length * candidateMetadata.lineHeight + 1 + candidatePrimary.lines.length * candidatePrimary.lineHeight;
      if (totalHeight <= 34.5) {
        metadata = candidateMetadata;
        primary = candidatePrimary;
        break;
      }
    }
    if (metadata && primary) break;
  }
  if (!metadata || !primary) throw new Error("Label V1 cannot fit metadata and primary text without splitting or truncating a word.");

  const topHeight = metadata.lines.length * metadata.lineHeight + 1 + primary.lines.length * primary.lineHeight;
  const topStartY = 2.7 + (34.5 - topHeight) / 2;
  const descriptor = content.descriptor
    ? fitBlock(doc, content.descriptor, identityWidth - 7, AI_GRADER_LABEL_V1_TEXT_TIERS.descriptor, {
        maxLines: 2,
        maxHeightPt: 13,
      })
    : undefined;
  const cert = fitBlock(
    doc,
    content.certId,
    AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.nfcReserved.widthPt,
    AI_GRADER_LABEL_V1_TEXT_TIERS.cert,
    { maxLines: 1 }
  );
  const grade = fitBlock(
    doc,
    content.grade,
    AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.grade.widthPt,
    AI_GRADER_LABEL_V1_TEXT_TIERS.grade,
    { maxLines: 1 }
  );
  const cardNumber = content.cardNumberAboveGrade
    ? fitBlock(doc, content.cardNumberAboveGrade, AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.grade.widthPt, AI_GRADER_LABEL_V1_TEXT_TIERS.cardNumber, { maxLines: 1 })
    : undefined;
  return {
    metadata,
    primary,
    ...(descriptor ? { descriptor, descriptorStartY: 40.2 + (13 - descriptor.lines.length * descriptor.lineHeight) / 2 } : {}),
    cert,
    grade,
    ...(cardNumber ? { cardNumber } : {}),
    topStartY,
  };
}

function drawCenteredBlock(doc: PdfDoc, fitted: FittedBlock, x: number, y: number, width: number) {
  fitted.lines.forEach((line, index) => {
    doc.font("TKLabelRegular").fontSize(fitted.fontSize).fillColor("#0f0f0f").text(line, x, y + index * fitted.lineHeight, {
      width,
      align: "center",
      lineBreak: false,
    });
  });
}

function drawDivider(doc: PdfDoc, crown: PdfImage, x: number, y: number, width: number) {
  const divider = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.divider;
  const centerX = x + width / 2;
  doc.lineWidth(0.45).strokeColor("#000000");
  doc.moveTo(x + 2, y).lineTo(centerX - divider.crownWidthPt / 2 - 1.2, y).stroke();
  doc.moveTo(centerX + divider.crownWidthPt / 2 + 1.2, y).lineTo(x + width - 2, y).stroke();
  doc.image(crown as unknown as Parameters<PdfDoc["image"]>[0], centerX - divider.crownWidthPt / 2, y - divider.crownHeightPt / 2, {
    fit: [divider.crownWidthPt, divider.crownHeightPt],
    align: "center",
    valign: "center",
  });
}

function drawVerticalSeparator(doc: PdfDoc, crown: PdfImage, x: number, y: number, height: number) {
  const ornament = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.separatorCrowns;
  const crownTop = ornament.centerYPt - ornament.heightPt / 2;
  const crownBottom = ornament.centerYPt + ornament.heightPt / 2;
  doc.lineWidth(0.55).strokeColor("#0f0f0f");
  doc.moveTo(x, y).lineTo(x, crownTop - ornament.lineGapPt).stroke();
  doc.moveTo(x, crownBottom + ornament.lineGapPt).lineTo(x, y + height).stroke();
  doc.image(crown as unknown as Parameters<PdfDoc["image"]>[0], x - ornament.widthPt / 2, crownTop, {
    fit: [ornament.widthPt, ornament.heightPt],
    align: "center",
    valign: "center",
  });
}

function drawNfcSymbol(doc: PdfDoc) {
  const zone = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.nfcReserved;
  const centerX = zone.centerXPt;
  const centerY = zone.centerYPt;
  const radius = zone.widthPt / 2;
  doc.lineWidth(0.55).strokeColor("#0f0f0f").circle(centerX, centerY, radius).stroke();
  doc.path(`M ${centerX - 8.2} ${centerY - 3.3} C ${centerX - 4.7} ${centerY - 8.2}, ${centerX + 4.7} ${centerY - 8.2}, ${centerX + 8.2} ${centerY - 3.3}`).stroke();
  doc.path(`M ${centerX - 8.2} ${centerY + 3.3} C ${centerX - 4.7} ${centerY + 8.2}, ${centerX + 4.7} ${centerY + 8.2}, ${centerX + 8.2} ${centerY + 3.3}`).stroke();
  doc.font("TKLabelRegular").fontSize(5.4).fillColor("#0f0f0f").text("NFC", centerX - 8, centerY - 2.7, {
    width: 16,
    align: "center",
    lineBreak: false,
  });
}

function drawLabelPdf(
  doc: PdfDoc,
  images: { logo: PdfImage; crown: PdfImage },
  snapshot: AiGraderLabelV1Snapshot,
  x: number,
  y: number,
  inspectionOutline = false
) {
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  const identity = manifest.labelZones.identity;
  const layout = buildLayout(doc, snapshot);
  doc.save().translate(x, y);
  doc.rect(0, 0, manifest.label.widthPt, manifest.label.heightPt).fill("#ffffff");
  if (inspectionOutline) {
    doc.rect(0.25, 0.25, manifest.label.widthPt - 0.5, manifest.label.heightPt - 0.5).lineWidth(0.5).stroke("#c8c8c8");
  }
  doc.image(images.logo as unknown as Parameters<PdfDoc["image"]>[0], manifest.labelZones.logo.xPt, manifest.labelZones.logo.yPt, {
    fit: [manifest.labelZones.logo.widthPt, manifest.labelZones.logo.heightPt],
    align: "center",
    valign: "center",
  });
  const grading = manifest.labelZones.gradingText;
  doc.font("TKLabelRegular").fontSize(grading.fontSizePt).fillColor("#0f0f0f").text("GRADING", grading.xPt, grading.yPt, {
    width: grading.widthPt,
    align: "center",
    characterSpacing: 0.55,
    lineBreak: false,
  });
  drawVerticalSeparator(
    doc,
    images.crown,
    manifest.labelZones.leftSeparator.xPt,
    manifest.labelZones.leftSeparator.yPt,
    manifest.labelZones.leftSeparator.heightPt
  );
  drawVerticalSeparator(
    doc,
    images.crown,
    manifest.labelZones.rightSeparator.xPt,
    manifest.labelZones.rightSeparator.yPt,
    manifest.labelZones.rightSeparator.heightPt
  );

  drawCenteredBlock(doc, layout.metadata, identity.xPt, layout.topStartY, identity.widthPt);
  const primaryY = layout.topStartY + layout.metadata.lines.length * layout.metadata.lineHeight + 1;
  drawCenteredBlock(doc, layout.primary, identity.xPt, primaryY, identity.widthPt);
  drawDivider(doc, images.crown, identity.xPt, manifest.labelZones.divider.yPt, identity.widthPt);
  if (layout.descriptor && layout.descriptorStartY !== undefined) {
    drawCenteredBlock(doc, layout.descriptor, identity.xPt + 3.5, layout.descriptorStartY, identity.widthPt - 7);
  }
  drawNfcSymbol(doc);
  const nfc = manifest.labelZones.nfcReserved;
  drawCenteredBlock(doc, layout.cert, nfc.xPt, nfc.certTopPt, nfc.widthPt);

  const grade = manifest.labelZones.grade;
  if (layout.cardNumber) drawCenteredBlock(doc, layout.cardNumber, grade.xPt, grade.cardNumberTopPt, grade.widthPt);
  const gradeTop = grade.glyphCenterYPt - layout.grade.fontSize * grade.glyphCenterFromTextTopEm;
  drawCenteredBlock(doc, layout.grade, grade.xPt, gradeTop, grade.widthPt);
  doc.restore();
  return layout;
}

function createPdf(size: [number, number], title: string) {
  const doc = new PDFDocument({
    size,
    margin: 0,
    compress: false,
    info: {
      Title: title,
      Author: "Ten Kings",
      Creator: "Ten Kings Label V1 deterministic renderer",
      Producer: "Ten Kings Label V1 deterministic renderer",
      CreationDate: FIXED_PDF_DATE,
      ModDate: FIXED_PDF_DATE,
    },
  });
  registerFonts(doc);
  return doc;
}

function fillPageWhite(doc: PdfDoc, widthPt: number, heightPt: number) {
  doc.save().rect(0, 0, widthPt, heightPt).fill("#ffffff").restore();
}

async function collectPdf(doc: PdfDoc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.end();
  return done;
}

export async function renderAiGraderLabelV1Pdf(snapshot: AiGraderLabelV1Snapshot) {
  assertAiGraderLabelV1Assets();
  const label = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label;
  const doc = createPdf([label.widthPt, label.heightPt], `${snapshot.templateId} ${snapshot.certId}`);
  const images = openVerifiedImages(doc);
  fillPageWhite(doc, label.widthPt, label.heightPt);
  drawLabelPdf(doc, images, snapshot, 0, 0);
  return collectPdf(doc);
}

function pdfKitTopYFromPdfBottomY(pdfYPt: number) {
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  return manifest.paper.heightPt - pdfYPt - manifest.label.heightPt;
}

function validateSheetEntries(entries: readonly AiGraderLabelV1SheetEntry[]) {
  const occupied = new Set<number>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.slot) || entry.slot < 1 || entry.slot > 16) throw new Error("Label V1 sheet slot must be 1 through 16.");
    if (occupied.has(entry.slot)) throw new Error("Label V1 sheet contains a duplicate slot.");
    occupied.add(entry.slot);
  }
}

export async function renderAiGraderLabelSheetV1Pdf(input: {
  entries: readonly AiGraderLabelV1SheetEntry[];
  title: string;
  proofMarks?: boolean;
}) {
  assertAiGraderLabelV1Assets();
  validateSheetEntries(input.entries);
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  const doc = createPdf([manifest.paper.widthPt, manifest.paper.heightPt], input.title);
  const images = openVerifiedImages(doc);
  fillPageWhite(doc, manifest.paper.widthPt, manifest.paper.heightPt);
  const bySlot = new Map(input.entries.map((entry) => [entry.slot, entry]));
  for (const slot of AI_GRADER_LABEL_V1_SHEET_SLOTS) {
    const topY = pdfKitTopYFromPdfBottomY(slot.pdfYPt);
    if (Math.abs(topY - slot.yFromTopPt) > 0.0001) throw new Error("Label V1 PDF top/bottom coordinate conversion failed.");
    const entry = bySlot.get(slot.slot);
    if (entry) drawLabelPdf(doc, images, entry.snapshot, slot.xPt, topY, input.proofMarks === true);
    if (input.proofMarks) {
      doc
        .rect(slot.xPt, topY, manifest.label.widthPt, manifest.label.heightPt)
        .lineWidth(0.25)
        .dash(2, { space: 2 })
        .stroke(entry ? "#8f8f8f" : "#d6d6d6")
        .undash();
      doc.font("TKLabelRegular").fontSize(4.5).fillColor("#8f8f8f").text(`SLOT ${slot.slot}`, slot.xPt + 2, topY + 2, {
        lineBreak: false,
      });
    }
  }
  return collectPdf(doc);
}

export async function renderAiGraderLabelV1InspectionPdf(snapshots: readonly AiGraderLabelV1Snapshot[]) {
  assertAiGraderLabelV1Assets();
  const doc = createPdf([612, 792], "Ten Kings Label V1 enlarged inspection proofs");
  const images = openVerifiedImages(doc);
  const scale = 2.45;
  snapshots.forEach((snapshot, index) => {
    if (index > 0) doc.addPage({ size: [612, 792], margin: 0 });
    fillPageWhite(doc, 612, 792);
    doc.font("TKLabelBold").fontSize(17).fillColor("#111111").text("LABEL V1 DESIGN PROOF - NOT PHYSICALLY CALIBRATED", 54, 48, {
      width: 504,
      align: "center",
    });
    doc.font("TKLabelRegular").fontSize(10).text(`${snapshot.templateId} | ${snapshot.certId}`, 54, 78, { width: 504, align: "center" });
    const x = (612 - AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.widthPt * scale) / 2;
    const y = 150;
    doc.save().translate(x, y).scale(scale);
    drawLabelPdf(doc, images, snapshot, 0, 0, true);
    doc.restore();
    doc.font("TKLabelRegular").fontSize(10).fillColor("#333333").text(
      "Enlarged 2.45x inspection view. Production source remains 2.73in x 0.83in. Exact authorized dark-black Ten Kings artwork and OFL Bebas Neue Regular are embedded. NFC diameter and sheet coordinates require physical calibration.",
      72,
      340,
      { width: 468, align: "center", lineGap: 4 }
    );
    doc.font("TKLabelBold").fontSize(10).fillColor("#8a2d2d").text(
      "DESIGN APPROVED - PHYSICAL PRINT/CUT CALIBRATION STILL REQUIRED",
      72,
      410,
      { width: 468, align: "center" }
    );
  });
  return collectPdf(doc);
}

export async function renderAiGraderLabelV1CalibrationPdf() {
  assertAiGraderLabelV1Assets();
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  const doc = createPdf([manifest.paper.widthPt, manifest.paper.heightPt], "Ten Kings Label V1 calibration sheet");
  fillPageWhite(doc, manifest.paper.widthPt, manifest.paper.heightPt);
  doc.font("TKLabelBold").fontSize(10).fillColor("#000000").text(
    "CALIBRATION ONLY - DO NOT MARK SHEET PRINTED",
    72,
    28,
    { width: 468, align: "center" }
  );
  doc.font("TKLabelRegular").fontSize(6).text(
    `${manifest.calibration.printProfileId} / ${manifest.calibration.cutProfileId} / ${aiGraderLabelV1TemplateDigest().slice(0, 16)}`,
    72,
    43,
    { width: 468, align: "center" }
  );
  for (const slot of AI_GRADER_LABEL_V1_SHEET_SLOTS) {
    const topY = pdfKitTopYFromPdfBottomY(slot.pdfYPt);
    doc.rect(slot.xPt, topY, manifest.label.widthPt, manifest.label.heightPt).lineWidth(0.35).stroke("#000000");
    doc.font("TKLabelBold").fontSize(6).text(String(slot.slot), slot.xPt + 3, topY + 3, { lineBreak: false });
    doc.moveTo(slot.xPt - 4, topY).lineTo(slot.xPt + 4, topY).stroke();
    doc.moveTo(slot.xPt, topY - 4).lineTo(slot.xPt, topY + 4).stroke();
  }
  doc.font("TKLabelRegular").fontSize(6).text(
    "Source geometry: 8.50in x 12.00in portrait; labels 2.73in x 0.83in; 2 columns x 8 rows; provisional 1.00in margins. Print at 100% with all fit/scale options disabled.",
    72,
    824,
    { width: 468, align: "center" }
  );
  return collectPdf(doc);
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character] ?? character));
}

function svgBlock(fitted: FittedBlock, x: number, topY: number, width: number) {
  return fitted.lines
    .map((line, index) => {
      const baselineY = topY + index * fitted.lineHeight + fitted.fontSize * 0.84;
      return `<text x="${(x + width / 2).toFixed(2)}" y="${baselineY.toFixed(2)}" text-anchor="middle" class="label-font" font-size="${fitted.fontSize}">${escapeXml(line)}</text>`;
    })
    .join("");
}

function svgDivider(x: number, y: number, width: number, crownBase64: string) {
  const divider = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.divider;
  const centerX = x + width / 2;
  return `<path d="M ${(x + 2).toFixed(2)} ${y.toFixed(2)} H ${(centerX - divider.crownWidthPt / 2 - 1.2).toFixed(2)} M ${(centerX + divider.crownWidthPt / 2 + 1.2).toFixed(2)} ${y.toFixed(2)} H ${(x + width - 2).toFixed(2)}"/><image href="data:image/png;base64,${crownBase64}" x="${(centerX - divider.crownWidthPt / 2).toFixed(2)}" y="${(y - divider.crownHeightPt / 2).toFixed(2)}" width="${divider.crownWidthPt}" height="${divider.crownHeightPt}" preserveAspectRatio="xMidYMid meet"/>`;
}

function svgVerticalSeparator(x: number, y: number, height: number, crownBase64: string) {
  const ornament = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones.separatorCrowns;
  const crownTop = ornament.centerYPt - ornament.heightPt / 2;
  const crownBottom = ornament.centerYPt + ornament.heightPt / 2;
  return `<path d="M ${x.toFixed(2)} ${y.toFixed(2)} V ${(crownTop - ornament.lineGapPt).toFixed(2)} M ${x.toFixed(2)} ${(crownBottom + ornament.lineGapPt).toFixed(2)} V ${(y + height).toFixed(2)}"/><image href="data:image/png;base64,${crownBase64}" x="${(x - ornament.widthPt / 2).toFixed(2)}" y="${crownTop.toFixed(2)}" width="${ornament.widthPt}" height="${ornament.heightPt}" preserveAspectRatio="xMidYMid meet"/>`;
}

function svgGrade(fitted: FittedBlock, x: number, width: number, centerYPt: number) {
  const baselineY = centerYPt + fitted.fontSize * 0.35;
  return `<text x="${(x + width / 2).toFixed(2)}" y="${baselineY.toFixed(2)}" text-anchor="middle" class="label-font" font-size="${fitted.fontSize}">${escapeXml(fitted.lines[0])}</text>`;
}

export function renderAiGraderLabelV1Svg(snapshot: AiGraderLabelV1Snapshot, input?: { inspectionOutline?: boolean }) {
  assertAiGraderLabelV1Assets();
  const measurement = createPdf([10, 10], "Label V1 SVG measurement");
  const layout = buildLayout(measurement, snapshot);
  measurement.end();
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  const identity = manifest.labelZones.identity;
  const nfc = manifest.labelZones.nfcReserved;
  const grade = manifest.labelZones.grade;
  const logo = readApprovedAsset(AI_GRADER_LABEL_V1_ASSETS.logo.fileName, AI_GRADER_LABEL_V1_ASSETS.logo.sha256).toString("base64");
  const crown = readApprovedAsset(AI_GRADER_LABEL_V1_ASSETS.crown.fileName, AI_GRADER_LABEL_V1_ASSETS.crown.sha256).toString("base64");
  const font = readApprovedAsset(AI_GRADER_LABEL_V1_ASSETS.font.fileName, AI_GRADER_LABEL_V1_ASSETS.font.sha256).toString("base64");
  const centerX = nfc.centerXPt;
  const centerY = nfc.centerYPt;
  const primaryY = layout.topStartY + layout.metadata.lines.length * layout.metadata.lineHeight + 1;
  const inspectionOutline = input?.inspectionOutline
    ? `<rect x=".25" y=".25" width="${manifest.label.widthPt - 0.5}" height="${manifest.label.heightPt - 0.5}" fill="none" stroke="#c8c8c8" stroke-width=".5"/>`
    : undefined;
  const cardNumber = layout.cardNumber
    ? svgBlock(layout.cardNumber, grade.xPt, grade.cardNumberTopPt, grade.widthPt)
    : undefined;
  const centerContent = [
    svgBlock(layout.metadata, identity.xPt, layout.topStartY, identity.widthPt),
    svgBlock(layout.primary, identity.xPt, primaryY, identity.widthPt),
    svgDivider(identity.xPt, manifest.labelZones.divider.yPt, identity.widthPt, crown),
    layout.descriptor && layout.descriptorStartY !== undefined
      ? svgBlock(layout.descriptor, identity.xPt + 3.5, layout.descriptorStartY, identity.widthPt - 7)
      : "",
  ].join("");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2.73in" height="0.83in" viewBox="0 0 ${manifest.label.widthPt} ${manifest.label.heightPt}">
  <defs>
    <style>
      @font-face { font-family: "Bebas Neue"; src: url(data:font/ttf;base64,${font}); font-weight: 400; font-style: normal; }
      text { fill: #0f0f0f; }
      .label-font { font-family: "Bebas Neue", sans-serif; font-weight: 400; font-style: normal; }
      path, circle, line { fill: none; stroke: #0f0f0f; stroke-width: .55; }
    </style>
  </defs>
  <rect width="${manifest.label.widthPt}" height="${manifest.label.heightPt}" fill="#fff"/>`,
    inspectionOutline ? `  ${inspectionOutline}` : undefined,
    `  <image href="data:image/png;base64,${logo}" x="${manifest.labelZones.logo.xPt}" y="${manifest.labelZones.logo.yPt}" width="${manifest.labelZones.logo.widthPt}" height="${manifest.labelZones.logo.heightPt}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${(manifest.labelZones.gradingText.xPt + manifest.labelZones.gradingText.widthPt / 2).toFixed(2)}" y="${(manifest.labelZones.gradingText.yPt + manifest.labelZones.gradingText.fontSizePt * 0.84).toFixed(2)}" text-anchor="middle" class="label-font" font-size="${manifest.labelZones.gradingText.fontSizePt}" letter-spacing=".55">GRADING</text>
  ${svgVerticalSeparator(manifest.labelZones.leftSeparator.xPt, manifest.labelZones.leftSeparator.yPt, manifest.labelZones.leftSeparator.heightPt, crown)}
  ${svgVerticalSeparator(manifest.labelZones.rightSeparator.xPt, manifest.labelZones.rightSeparator.yPt, manifest.labelZones.rightSeparator.heightPt, crown)}
  ${centerContent}
  <circle cx="${centerX}" cy="${centerY}" r="${nfc.widthPt / 2}"/>
  <path d="M ${centerX - 8.2} ${centerY - 3.3} C ${centerX - 4.7} ${centerY - 8.2}, ${centerX + 4.7} ${centerY - 8.2}, ${centerX + 8.2} ${centerY - 3.3} M ${centerX - 8.2} ${centerY + 3.3} C ${centerX - 4.7} ${centerY + 8.2}, ${centerX + 4.7} ${centerY + 8.2}, ${centerX + 8.2} ${centerY + 3.3}"/>
  <text x="${centerX}" y="${centerY + 1.8}" text-anchor="middle" class="label-font" font-size="5.4">NFC</text>
  ${svgBlock(layout.cert, nfc.xPt, nfc.certTopPt, nfc.widthPt)}`,
    cardNumber ? `  ${cardNumber}` : undefined,
    `  ${svgGrade(layout.grade, grade.xPt, grade.widthPt, grade.glyphCenterYPt)}
</svg>`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function renderAiGraderLabelSheetCutSvg(input?: { calibrationMarks?: boolean }) {
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  const rectangles = AI_GRADER_LABEL_V1_SHEET_SLOTS.map(
    (slot) => `<rect id="slot-${slot.slot}" x="${slot.xPt}" y="${slot.yFromTopPt}" width="${manifest.label.widthPt}" height="${manifest.label.heightPt}" rx="0" ry="0"/>`
  ).join("\n  ");
  const calibration = input?.calibrationMarks
    ? `<g id="calibration-marks"><path d="M 64 72 H 80 M 72 64 V 80 M 532 792 H 548 M 540 784 V 800"/><text x="306" y="42" text-anchor="middle">CALIBRATION ONLY - PROVISIONAL</text></g>`
    : "";
  return [
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="8.5in" height="12in" viewBox="0 0 612 864">
  <title>Ten Kings Label V1 Cricut cut geometry</title>
  <desc>Provisional 2 column by 8 row cut paths. Physical Cricut calibration is required.</desc>
  <g id="cut-paths" fill="none" stroke="#000000" stroke-width="0.25">
  ${rectangles}
  </g>`,
    calibration ? `  ${calibration}` : undefined,
    `</svg>`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
