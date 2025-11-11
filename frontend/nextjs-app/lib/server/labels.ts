import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { CardAttributes } from "@tenkings/shared/cardAttributes";
import type { PackLabelSummary, QrCodeSummary } from "./qrCodes";

type PdfDoc = InstanceType<typeof PDFDocument>;

const mmToPoints = (mm: number) => (mm / 25.4) * 72;

// DK-1201 roll dimensions (1.1" x 3.5")
const LABEL_WIDTH = mmToPoints(89);
const LABEL_HEIGHT = mmToPoints(28);
const H_PADDING = LABEL_WIDTH * 0.1; // 10% horizontal padding
const V_PADDING = LABEL_HEIGHT * 0.1; // 10% vertical padding
const QR_SIZE = LABEL_HEIGHT - V_PADDING * 2;
const CARD_TEXT_WIDTH = LABEL_WIDTH - H_PADDING * 2 - QR_SIZE - 4;

const COLOR_BG = "#ffffff";
const COLOR_PANEL = "#f4f5f8";
const COLOR_ACCENT = "#111111";
const COLOR_TEXT = "#000000";
const COLOR_MUTED = "#4b5567";

export interface PrintableLabelEntry {
  pairId: string;
  card: QrCodeSummary;
  pack: QrCodeSummary;
  label: PackLabelSummary;
  item?: {
    id: string;
    name: string | null;
    imageUrl: string | null;
    attributes?: CardAttributes | null;
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

  const doc = new PDFDocument({
    size: [LABEL_WIDTH, LABEL_HEIGHT],
    margin: 0,
    info: {
      Author: generatedBy ?? "Ten Kings",
      Title: "Ten Kings Pack/Card Labels",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  const completion = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const ensurePage = (() => {
    let isFirst = true;
    return () => {
      if (isFirst) {
        isFirst = false;
        return;
      }
      doc.addPage({ size: [LABEL_WIDTH, LABEL_HEIGHT], margin: 0 });
    };
  })();

  for (const entry of labels) {
    ensurePage();
    await drawPackSticker(doc, entry);
    ensurePage();
    await drawCardSticker(doc, entry);
  }

  doc.end();
  return completion;
}

const drawLabelBackground = (doc: PdfDoc) => {
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT).fill(COLOR_BG);
  doc
    .roundedRect(H_PADDING / 2, V_PADDING / 2, LABEL_WIDTH - H_PADDING, LABEL_HEIGHT - V_PADDING, 3)
    .fill(COLOR_PANEL);
};

const createQrBuffer = async (value: string) =>
  QRCode.toBuffer(value, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: Math.max(256, Math.round(QR_SIZE * 5)),
  });

const drawPackSticker = async (doc: PdfDoc, entry: PrintableLabelEntry) => {
  drawLabelBackground(doc);

  const packTarget = entry.pack.payloadUrl ?? entry.pack.code;
  const qr = await createQrBuffer(packTarget);

  const qrX = LABEL_WIDTH - H_PADDING - QR_SIZE;
  doc.image(qr, qrX, V_PADDING, { fit: [QR_SIZE, QR_SIZE] });

  const textWidth = qrX - H_PADDING * 0.8;
  const textY = LABEL_HEIGHT / 2 - 8;

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLOR_TEXT)
    .text("SCAN TO", H_PADDING, textY - 8, {
      width: textWidth,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLOR_TEXT)
    .text("RIP IT LIVE", H_PADDING, textY + 8, {
      width: textWidth,
    });
};

const drawCardSticker = async (doc: PdfDoc, entry: PrintableLabelEntry) => {
  drawLabelBackground(doc);

  const cardTarget = entry.card.payloadUrl ?? entry.card.code;
  const qr = await createQrBuffer(cardTarget);

  const qrX = LABEL_WIDTH - H_PADDING - QR_SIZE;
  doc.image(qr, qrX, V_PADDING, { fit: [QR_SIZE, QR_SIZE] });

  const textX = H_PADDING;
  const player = formatPlayer(entry);
  const brand = formatBrand(entry);
  const variant = formatVariant(entry);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text(player, textX, V_PADDING, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text(brand, textX, V_PADDING + 12, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text(variant, textX, V_PADDING + 24, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
    });
};

const formatPlayer = (entry: PrintableLabelEntry) => {
  const attributes = entry.item?.attributes;
  return attributes?.playerName?.trim() || entry.item?.name || "PLAYER TBD";
};

const formatBrand = (entry: PrintableLabelEntry) => {
  const attributes = entry.item?.attributes;
  return (
    attributes?.brand?.trim() ||
    attributes?.setName?.trim() ||
    entry.item?.name?.split(/\s+-\s+/)[0]?.trim() ||
    "Brand TBD"
  );
};

const formatVariant = (entry: PrintableLabelEntry) => {
  const attributes = entry.item?.attributes;
  const keywords = attributes?.variantKeywords ?? [];
  if (keywords.length === 0) {
    return "Variant TBD";
  }
  const phrase = keywords.map((word) => word.trim()).filter(Boolean).join(" · ");
  return phrase || "Variant TBD";
};
