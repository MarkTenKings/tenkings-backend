import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import path from "node:path";
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
const PREMIER_TEXT_LIGHT = "#ffffff";

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

export type LabelStyle = "generic" | "premier";

interface GenerateLabelSheetOptions {
  labels: PrintableLabelEntry[];
  generatedBy?: string | null;
  style?: LabelStyle;
}

export async function generateLabelSheetPdf(options: GenerateLabelSheetOptions): Promise<Buffer> {
  const { labels, generatedBy, style = "generic" } = options;

  if (!labels || labels.length === 0) {
    throw new Error("At least one QR code pair is required to build a label sheet");
  }

  if (style === "premier") {
    return generatePremierLabelSheet({ labels, generatedBy });
  }

  return generateGenericLabelSheet({ labels, generatedBy });
}

interface InternalGenerateOptions {
  labels: PrintableLabelEntry[];
  generatedBy?: string | null;
}

async function generateGenericLabelSheet(options: InternalGenerateOptions): Promise<Buffer> {
  const { labels, generatedBy } = options;

  const doc = createBaseDocument(generatedBy);
  const ensurePage = createPageIterator(doc);

  for (const entry of labels) {
    ensurePage();
    await drawPackSticker(doc, entry);
    ensurePage();
    await drawCardSticker(doc, entry);
  }

  doc.end();
  return collectDocument(doc);
}

async function generatePremierLabelSheet(options: InternalGenerateOptions): Promise<Buffer> {
  const { labels, generatedBy } = options;
  const doc = createBaseDocument(generatedBy);
  const ensurePage = createPageIterator(doc);
  const assets = loadPremierAssets();

  for (const entry of labels) {
    ensurePage();
    await drawPremierPackSticker(doc, entry, assets.pack);
    ensurePage();
    await drawPremierCardFrontSticker(doc, entry, assets.cardFront);
    ensurePage();
    await drawPremierCardBackSticker(doc, entry, assets.cardBack);
  }

  doc.end();
  return collectDocument(doc);
}

const drawGenericLabelBackground = (doc: PdfDoc, paddingX: number, paddingY: number) => {
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
  drawGenericLabelBackground(doc, PACK_H_PADDING, PACK_V_PADDING);

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
  drawGenericLabelBackground(doc, CARD_H_PADDING, CARD_V_PADDING);

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

const ASSET_DIR = path.join(process.cwd(), "assets/labels");

const loadPremierAssets = (() => {
  let cache:
    | null
    | {
        pack: Buffer;
        cardFront: Buffer;
        cardBack: Buffer;
      } = null;
  return () => {
    if (cache) {
      return cache;
    }
    cache = {
      pack: readAsset("tenkings-premier-pack.png"),
      cardFront: readAsset("tenkings-premier-card-front.png"),
      cardBack: readAsset("tenkings-premier-card-back.png"),
    };
    return cache;
  };
})();

const readAsset = (filename: string): Buffer => {
  const filePath = path.join(ASSET_DIR, filename);
  try {
    return readFileSync(filePath);
  } catch (error) {
    throw new Error(`Premier label asset missing: ${filePath}`);
  }
};

const createBaseDocument = (author?: string | null) =>
  new PDFDocument({
    size: [LABEL_WIDTH, LABEL_HEIGHT],
    margin: 0,
    info: {
      Author: author ?? "Ten Kings",
      Title: "Ten Kings Pack/Card Labels",
    },
  });

const collectDocument = (doc: PdfDoc) => {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
};

const createPageIterator = (doc: PdfDoc) => {
  let isFirst = true;
  return () => {
    if (isFirst) {
      isFirst = false;
      return;
    }
    doc.addPage({ size: [LABEL_WIDTH, LABEL_HEIGHT], margin: 0 });
  };
};

const PREMIER_LEFT = LABEL_WIDTH * 0.08;
const PREMIER_QR_MARGIN = LABEL_WIDTH * 0.08;
const PREMIER_QR_SIZE = LABEL_HEIGHT * 0.68;

const drawPremierPackSticker = async (doc: PdfDoc, entry: PrintableLabelEntry, background: Buffer) => {
  doc.image(background, 0, 0, { width: LABEL_WIDTH, height: LABEL_HEIGHT });
  const packTarget = entry.pack.payloadUrl ?? entry.pack.code;
  const qrSize = Math.min(PREMIER_QR_SIZE, LABEL_HEIGHT - PREMIER_QR_MARGIN);
  const qrX = LABEL_WIDTH - PREMIER_QR_MARGIN - qrSize;
  const qrY = (LABEL_HEIGHT - qrSize) / 2;
  const qr = await createQrBuffer(packTarget, qrSize);
  doc.image(qr, qrX, qrY, { fit: [qrSize, qrSize] });

  const textWidth = qrX - PREMIER_LEFT - mmToPoints(2);
  const textY = qrY + qrSize / 2;

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text("SCAN TO", PREMIER_LEFT, textY - 16, {
      width: textWidth,
      lineBreak: false,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text("RIP IT LIVE", PREMIER_LEFT, textY + 4, {
      width: textWidth,
      lineBreak: false,
    });
};

const drawPremierCardFrontSticker = async (
  doc: PdfDoc,
  entry: PrintableLabelEntry,
  background: Buffer
) => {
  doc.image(background, 0, 0, { width: LABEL_WIDTH, height: LABEL_HEIGHT });
  const cardTarget = entry.card.payloadUrl ?? entry.card.code;
  const qrSize = Math.min(PREMIER_QR_SIZE, LABEL_HEIGHT - PREMIER_QR_MARGIN);
  const qrX = LABEL_WIDTH - PREMIER_QR_MARGIN - qrSize;
  const qrY = (LABEL_HEIGHT - qrSize) / 2;
  const qr = await createQrBuffer(cardTarget, qrSize);
  doc.image(qr, qrX, qrY, { fit: [qrSize, qrSize] });

  const textWidth = qrX - PREMIER_LEFT - mmToPoints(2);
  const player = formatPlayer(entry);
  const brand = formatBrand(entry);
  const variant = formatVariant(entry);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text(player, PREMIER_LEFT, mmToPoints(5), {
      width: textWidth,
      lineBreak: false,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text(brand, PREMIER_LEFT, mmToPoints(12), {
      width: textWidth,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text(variant, PREMIER_LEFT, mmToPoints(19), {
      width: textWidth,
      lineBreak: false,
    });
};

const drawPremierCardBackSticker = async (
  doc: PdfDoc,
  entry: PrintableLabelEntry,
  background: Buffer
) => {
  doc.image(background, 0, 0, { width: LABEL_WIDTH, height: LABEL_HEIGHT });
  const cardTarget = entry.card.payloadUrl ?? entry.card.code;
  const qrSize = Math.min(PREMIER_QR_SIZE, LABEL_HEIGHT - PREMIER_QR_MARGIN);
  const qrX = LABEL_WIDTH - PREMIER_QR_MARGIN - qrSize;
  const qrY = (LABEL_HEIGHT - qrSize) / 2;
  const qr = await createQrBuffer(cardTarget, qrSize);
  doc.image(qr, qrX, qrY, { fit: [qrSize, qrSize] });

  const textWidth = qrX - PREMIER_LEFT - mmToPoints(2);
  const subtitle = `Pair ${entry.label.pairId ?? "--"}`;

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text("SCAN TO CLAIM", PREMIER_LEFT, qrY - 10, {
      width: textWidth,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text("SAVE & SELL", PREMIER_LEFT, qrY + 4, {
      width: textWidth,
      lineBreak: false,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(PREMIER_TEXT_LIGHT)
    .text(subtitle, PREMIER_LEFT, qrY + 28, {
      width: textWidth,
      lineBreak: false,
    });
};
