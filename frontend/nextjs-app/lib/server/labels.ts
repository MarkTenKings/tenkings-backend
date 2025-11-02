import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { QrCodePair } from "./qrCodes";

type PdfDoc = InstanceType<typeof PDFDocument>;

const mmToPoints = (mm: number) => (mm / 25.4) * 72;

const LABEL_WIDTH = mmToPoints(70);
const LABEL_HEIGHT = mmToPoints(20);
const LABEL_RADIUS = 6;
const LABEL_GAP = 26;
const HEADER_OFFSET = 24;

const COLOR_GOLD = "#f5d37a";
const COLOR_DARK = "#0b0f15";
const COLOR_SLATE = "#c7cedd";
const COLOR_MUTED = "#8e97ab";
const COLOR_ACCENT = "#1a2231";
const COLOR_ACCENT_DARK = "#131a26";
const COLOR_META = "#606b82";

interface GenerateLabelSheetOptions {
  pairs: QrCodePair[];
  generatedBy?: string | null;
}

export async function generateLabelSheetPdf(options: GenerateLabelSheetOptions): Promise<Buffer> {
  const { pairs, generatedBy } = options;

  if (!pairs || pairs.length === 0) {
    throw new Error("At least one QR code pair is required to build a label sheet");
  }

  const generatedAt = new Date();
  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  const completion = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelX = doc.page.margins.left + (usableWidth - LABEL_WIDTH) / 2;

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];

    if (index > 0) {
      doc.addPage();
    }

    renderHeader(doc, pair, index, pairs.length, generatedAt, generatedBy ?? undefined);

    const frontY = doc.page.margins.top + HEADER_OFFSET;
    const backY = frontY + LABEL_HEIGHT + LABEL_GAP;

    drawFrontLabel(doc, pair, labelX, frontY);
    await drawBackLabel(doc, pair, labelX, backY);
  }

  doc.end();
  return completion;
}

const renderHeader = (
  doc: PdfDoc,
  pair: QrCodePair,
  index: number,
  total: number,
  generatedAt: Date,
  generatedBy?: string
) => {
  const headerTitleY = doc.page.margins.top - 28;
  const headerMetaY = doc.page.margins.top - 14;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLOR_GOLD)
    .text("Ten Kings Collectibles · Label Preview", doc.page.margins.left, headerTitleY, {
      width: contentWidth,
    });

  const metaParts = [
    `Pair ${pair.pairId}`,
    `Page ${index + 1} of ${total}`,
    `Generated ${generatedAt.toISOString().replace("T", " · ").replace("Z", "UTC")}`,
  ];

  if (generatedBy) {
    metaParts.push(`Operator ${generatedBy}`);
  }

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_META)
    .text(metaParts.join(" · "), doc.page.margins.left, headerMetaY, {
      width: contentWidth,
    });
};

const drawFrontLabel = (doc: PdfDoc, pair: QrCodePair, x: number, y: number) => {
  const outerGradient = doc.linearGradient(x, y, x + LABEL_WIDTH, y + LABEL_HEIGHT);
  outerGradient.stop(0, "#111723").stop(1, "#1f2836");

  doc.save();
  doc.roundedRect(x, y, LABEL_WIDTH, LABEL_HEIGHT, LABEL_RADIUS).fill(outerGradient);
  doc.restore();

  doc.save();
  doc
    .roundedRect(x + 1.8, y + 1.8, LABEL_WIDTH - 3.6, LABEL_HEIGHT - 3.6, LABEL_RADIUS - 1.5)
    .fill(COLOR_DARK);
  doc.restore();

  const bannerGradient = doc.linearGradient(x + 2.2, y + 2.2, x + LABEL_WIDTH - 2.2, y + 2.2);
  bannerGradient.stop(0, "#c89b2d").stop(0.5, COLOR_GOLD).stop(1, "#c89b2d");

  doc.save();
  doc.roundedRect(x + 2.2, y + 2.2, LABEL_WIDTH - 4.4, 6.5, LABEL_RADIUS - 2.2).fill(bannerGradient);
  doc.restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#101014")
    .text("TEN KINGS COLLECTIBLES", x + 6, y + 3.4, {
      characterSpacing: 0.4,
      width: LABEL_WIDTH - 12,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#f0f4ff")
    .text("Card Placeholder", x + 6, y + 12, {
      width: LABEL_WIDTH - 52,
      lineGap: 2,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLOR_SLATE)
    .text(`Pair ${pair.pairId}`, x + 6, y + 26);

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text(`Card QR ${pair.card.code}`, x + 6, y + 34, {
      width: LABEL_WIDTH - 54,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text(`Pack QR ${pair.pack.code}`, x + 6, y + 42, {
      width: LABEL_WIDTH - 54,
    });

  const gradeBoxWidth = 38;
  const gradeBoxHeight = 24;
  const gradeX = x + LABEL_WIDTH - gradeBoxWidth - 6;
  const gradeY = y + 12;

  const gradeGradient = doc.linearGradient(gradeX, gradeY, gradeX + gradeBoxWidth, gradeY + gradeBoxHeight);
  gradeGradient.stop(0, COLOR_ACCENT_DARK).stop(1, COLOR_ACCENT);

  doc.save();
  doc.roundedRect(gradeX, gradeY, gradeBoxWidth, gradeBoxHeight, 4).fill(gradeGradient);
  doc.restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor(COLOR_GOLD)
    .text("--", gradeX, gradeY + 2, {
      width: gradeBoxWidth,
      align: "center",
    });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_SLATE)
    .text("GRADE", gradeX, gradeY + gradeBoxHeight - 10, {
      width: gradeBoxWidth,
      align: "center",
      characterSpacing: 1.1,
    });

  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor(COLOR_META)
    .text("TEMP PREVIEW", gradeX, gradeY + gradeBoxHeight - 4.5, {
      width: gradeBoxWidth,
      align: "center",
      characterSpacing: 1.3,
    });
};

const drawBackLabel = async (doc: PdfDoc, pair: QrCodePair, x: number, y: number) => {
  const outerGradient = doc.linearGradient(x, y, x + LABEL_WIDTH, y + LABEL_HEIGHT);
  outerGradient.stop(0, "#0b0f17").stop(1, "#161d2b");

  doc.save();
  doc.roundedRect(x, y, LABEL_WIDTH, LABEL_HEIGHT, LABEL_RADIUS).fill(outerGradient);
  doc.restore();

  doc.save();
  doc
    .roundedRect(x + 1.8, y + 1.8, LABEL_WIDTH - 3.6, LABEL_HEIGHT - 3.6, LABEL_RADIUS - 1.5)
    .fill(COLOR_DARK);
  doc.restore();

  const qrSize = LABEL_HEIGHT - 12;
  const qrX = x + 6;
  const qrY = y + (LABEL_HEIGHT - qrSize) / 2;
  const qrTarget = pair.card.payloadUrl ?? pair.card.code;

  const qrBuffer = await QRCode.toBuffer(qrTarget, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: Math.max(256, Math.round(qrSize * 6)),
  });

  doc.image(qrBuffer, qrX, qrY, { fit: [qrSize, qrSize] });

  const textX = qrX + qrSize + 10;
  const textWidth = LABEL_WIDTH - (textX - x) - 6;

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLOR_GOLD)
    .text("SCAN FOR CARD PROFILE", textX, y + 10, {
      width: textWidth,
      characterSpacing: 0.6,
    });

  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLOR_SLATE)
    .text(qrTarget, textX, y + 22, {
      width: textWidth,
    });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_MUTED)
    .text(`Card Serial ${pair.card.serial ?? "pending"}`, textX, y + 34, {
      width: textWidth,
    });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_MUTED)
    .text(`Pack Serial ${pair.pack.serial ?? "pending"}`, textX, y + 42, {
      width: textWidth,
    });

  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor(COLOR_META)
    .text("Temporary label preview · Final artwork coming soon", textX, y + LABEL_HEIGHT - 8, {
      width: textWidth,
    });
};
