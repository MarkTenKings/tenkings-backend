import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { CardAttributes } from "@tenkings/shared/cardAttributes";
import type { PackLabelSummary, QrCodeSummary } from "./qrCodes";

type PdfDoc = InstanceType<typeof PDFDocument>;

const mmToPoints = (mm: number) => (mm / 25.4) * 72;

// DK-1201 roll dimensions (1.1" x 3.5")
const LABEL_WIDTH = mmToPoints(89);
const LABEL_HEIGHT = mmToPoints(28);
const PACK_H_PADDING = LABEL_WIDTH * 0.1; // 10%
const PACK_V_PADDING = LABEL_HEIGHT * 0.1;
const CARD_H_PADDING = LABEL_WIDTH * 0.05; // 5%
const CARD_V_PADDING = LABEL_HEIGHT * 0.05;
const PACK_QR_SIZE = LABEL_HEIGHT - PACK_V_PADDING * 2;
const CARD_QR_SIZE = LABEL_HEIGHT - CARD_V_PADDING * 2;
const CARD_TEXT_WIDTH = LABEL_WIDTH - CARD_H_PADDING * 2 - CARD_QR_SIZE - 4;

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

const drawLabelBackground = (doc: PdfDoc, paddingX: number, paddingY: number) => {
  doc.rect(0, 0, LABEL_WIDTH, LABEL_HEIGHT).fill(COLOR_BG);
  doc
    .roundedRect(paddingX / 2, paddingY / 2, LABEL_WIDTH - paddingX, LABEL_HEIGHT - paddingY, 3)
    .fill(COLOR_PANEL);
};

const createQrBuffer = async (value: string, size: number) =>
  QRCode.toBuffer(value, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: Math.max(256, Math.round(size * 5)),
  });

const drawPackSticker = async (doc: PdfDoc, entry: PrintableLabelEntry) => {
  drawLabelBackground(doc, PACK_H_PADDING, PACK_V_PADDING);

  const packTarget = entry.pack.payloadUrl ?? entry.pack.code;
  const qr = await createQrBuffer(packTarget, PACK_QR_SIZE);

  const qrX = LABEL_WIDTH - PACK_H_PADDING - PACK_QR_SIZE;
  doc.image(qr, qrX, PACK_V_PADDING, { fit: [PACK_QR_SIZE, PACK_QR_SIZE] });

  const textWidth = qrX - PACK_H_PADDING * 0.8;
  const textY = LABEL_HEIGHT / 2 - 8;

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(COLOR_TEXT)
    .text("SCAN TO", PACK_H_PADDING, textY - 8, {
      width: textWidth,
      lineBreak: false,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(COLOR_TEXT)
    .text("RIP IT LIVE", PACK_H_PADDING, textY + 8, {
      width: textWidth,
      lineBreak: false,
    });
};

const drawCardSticker = async (doc: PdfDoc, entry: PrintableLabelEntry) => {
  drawLabelBackground(doc, CARD_H_PADDING, CARD_V_PADDING);

  const cardTarget = entry.card.payloadUrl ?? entry.card.code;
  const qr = await createQrBuffer(cardTarget, CARD_QR_SIZE);

  const qrX = LABEL_WIDTH - CARD_H_PADDING - CARD_QR_SIZE;
  doc.image(qr, qrX, CARD_V_PADDING, { fit: [CARD_QR_SIZE, CARD_QR_SIZE] });

  const textX = CARD_H_PADDING;
  const player = formatPlayer(entry);
  const brand = formatBrand(entry);
  const variant = formatVariant(entry);

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLOR_TEXT)
    .text(player, textX, CARD_V_PADDING, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLOR_TEXT)
    .text(brand, textX, CARD_V_PADDING + 12, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLOR_TEXT)
    .text(variant, textX, CARD_V_PADDING + 22, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
      lineBreak: false,
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
