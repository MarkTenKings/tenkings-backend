import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { PackLabelStatus } from "@tenkings/database";
import type { PackLabelSummary, QrCodeSummary } from "./qrCodes";

const imageCache = new Map<string, Buffer>();

async function fetchImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) {
    return null;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

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

export interface PrintableLabelEntry {
  pairId: string;
  card: QrCodeSummary;
  pack: QrCodeSummary;
  label: PackLabelSummary;
  item?: {
    id: string;
    name: string | null;
    imageUrl: string | null;
  } | null;
}

interface GenerateLabelSheetOptions {
  labels: PrintableLabelEntry[];
  generatedBy?: string | null;
}

export async function generateLabelSheetPdf(options: GenerateLabelSheetOptions): Promise<Buffer> {
  const { labels, generatedBy } = options;

  if (!labels || labels.length === 0) {
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

  for (let index = 0; index < labels.length; index += 1) {
    const entry = labels[index];

    if (index > 0) {
      doc.addPage();
    }

    renderHeader(doc, entry, index, labels.length, generatedAt, generatedBy ?? undefined);

    let imageBuffer: Buffer | null = null;
    if (entry.item?.imageUrl) {
      imageBuffer = imageCache.get(entry.item.imageUrl) ?? null;
      if (!imageBuffer) {
        imageBuffer = await fetchImageBuffer(entry.item.imageUrl);
        if (imageBuffer) {
          imageCache.set(entry.item.imageUrl, imageBuffer);
        }
      }
    }

    const frontY = doc.page.margins.top + HEADER_OFFSET;
    const backY = frontY + LABEL_HEIGHT + LABEL_GAP;

    drawFrontLabel(doc, entry, labelX, frontY, imageBuffer);
    await drawBackLabel(doc, entry, labelX, backY);
  }

  doc.end();
  return completion;
}

const renderHeader = (
  doc: PdfDoc,
  entry: PrintableLabelEntry,
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
    `Pair ${entry.pairId}`,
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

const drawFrontLabel = (doc: PdfDoc, entry: PrintableLabelEntry, x: number, y: number, image?: Buffer | null) => {
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

  const cardTitle = entry.item?.name ?? "Pending metadata";
  const cardSubtitle = entry.item ? `Item ${entry.item.id.slice(0, 8)}…` : "Assign card metadata";

  const imageSize = LABEL_HEIGHT - 8;
  const imageX = x + LABEL_WIDTH - imageSize - 6;
  const textWidth = imageX - (x + 6);

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#f0f4ff")
    .text(cardTitle, x + 6, y + 12, {
      width: textWidth,
      lineGap: 2,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLOR_SLATE)
    .text(`Pair ${entry.pairId}`, x + 6, y + 26, { width: textWidth });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text(cardSubtitle, x + 6, y + 31, {
      width: textWidth,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text(`Card QR ${entry.card.code}`, x + 6, y + 39, {
      width: textWidth,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text(`Pack QR ${entry.pack.code}`, x + 6, y + 45, {
      width: textWidth,
    });

  if (image) {
    doc.save();
    doc
      .roundedRect(imageX - 2, y + 4, imageSize + 4, imageSize + 4, 6)
      .fill("#0f1729");
    doc.restore();
    doc.image(image, imageX, y + (LABEL_HEIGHT - imageSize) / 2, {
      fit: [imageSize, imageSize],
      align: "center",
      valign: "center",
    });
  }

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_META)
    .text(
      entry.label.status === PackLabelStatus.BOUND ? "Label status: Bound" : "Label status: Reserved",
      x + 6,
      y + LABEL_HEIGHT - 8,
      {
        width: textWidth,
      }
    );
};

const drawBackLabel = async (doc: PdfDoc, entry: PrintableLabelEntry, x: number, y: number) => {
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

  const qrSize = LABEL_HEIGHT - 18;
  const cardQrX = x + 6;
  const cardQrY = y + 6;
  const packQrX = cardQrX + qrSize + 8;
  const packQrY = cardQrY;

  const cardTarget = entry.card.payloadUrl ?? entry.card.code;
  const packTarget = entry.pack.payloadUrl ?? entry.pack.code;

  const qrOptions = {
    errorCorrectionLevel: "M" as const,
    margin: 1,
    width: Math.max(256, Math.round(qrSize * 6)),
  };

  const [cardQrBuffer, packQrBuffer] = await Promise.all([
    QRCode.toBuffer(cardTarget, qrOptions),
    QRCode.toBuffer(packTarget, qrOptions),
  ]);

  doc.image(cardQrBuffer, cardQrX, cardQrY, { fit: [qrSize, qrSize] });
  doc.image(packQrBuffer, packQrX, packQrY, { fit: [qrSize, qrSize] });

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLOR_GOLD)
    .text("SCAN TO CLAIM, SAVE, & SELL", x + 6, cardQrY + qrSize + 6, {
      width: LABEL_WIDTH - 12,
      align: "center",
      characterSpacing: 0.6,
    });

  const infoY = cardQrY + qrSize + 18;

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_SLATE)
    .text(`Card: ${cardTarget}`, x + 6, infoY, {
      width: LABEL_WIDTH - 12,
    });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_SLATE)
    .text(`Pack: ${packTarget}`, x + 6, infoY + 8, {
      width: LABEL_WIDTH - 12,
    });

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(COLOR_MUTED)
    .text(`Card Serial ${entry.card.serial ?? "pending"}`, x + 6, infoY + 18, {
      width: LABEL_WIDTH - 12,
    });

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(COLOR_MUTED)
    .text(`Pack Serial ${entry.pack.serial ?? "pending"}`, x + 6, infoY + 26, {
      width: LABEL_WIDTH - 12,
    });

  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor(COLOR_META)
    .text("Temporary label preview · Final artwork coming soon", x + 6, y + LABEL_HEIGHT - 8, {
      width: LABEL_WIDTH - 12,
      align: "center",
    });
};
