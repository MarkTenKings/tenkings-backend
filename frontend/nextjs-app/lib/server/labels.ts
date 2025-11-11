import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { CardAttributes } from "@tenkings/shared/cardAttributes";
import type { PackLabelSummary, QrCodeSummary } from "./qrCodes";

type PdfDoc = InstanceType<typeof PDFDocument>;

const mmToPoints = (mm: number) => (mm / 25.4) * 72;

// DK-1201 roll dimensions (1.1" x 3.5")
const LABEL_WIDTH = mmToPoints(89);
const LABEL_HEIGHT = mmToPoints(28);
const SAFE_MARGIN = mmToPoints(2.5);
const QR_SIZE = LABEL_HEIGHT - SAFE_MARGIN * 2;
const CARD_TEXT_WIDTH = LABEL_WIDTH - SAFE_MARGIN * 3 - QR_SIZE;

const COLOR_BG = "#05070e";
const COLOR_PANEL = "#0b101d";
const COLOR_ACCENT = "#f5d37a";
const COLOR_TEXT = "#f5f7ff";
const COLOR_MUTED = "#93a0c6";

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
    .roundedRect(SAFE_MARGIN / 2, SAFE_MARGIN / 2, LABEL_WIDTH - SAFE_MARGIN, LABEL_HEIGHT - SAFE_MARGIN, 3)
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

  const qrX = (LABEL_WIDTH - QR_SIZE) / 2;
  doc.image(qr, qrX, SAFE_MARGIN, { fit: [QR_SIZE, QR_SIZE] });

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor(COLOR_ACCENT)
    .text("SCAN TO RIP IT LIVE", SAFE_MARGIN, LABEL_HEIGHT - SAFE_MARGIN - 10, {
      width: LABEL_WIDTH - SAFE_MARGIN * 2,
      align: "center",
      characterSpacing: 0.8,
    });
};

const drawCardSticker = async (doc: PdfDoc, entry: PrintableLabelEntry) => {
  drawLabelBackground(doc);

  const cardTarget = entry.card.payloadUrl ?? entry.card.code;
  const qr = await createQrBuffer(cardTarget);

  const qrX = LABEL_WIDTH - SAFE_MARGIN - QR_SIZE;
  doc.image(qr, qrX, SAFE_MARGIN, { fit: [QR_SIZE, QR_SIZE] });

  const textX = SAFE_MARGIN;
  const player = formatPlayer(entry);
  const brand = formatBrand(entry);
  const variant = formatVariant(entry);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(COLOR_TEXT)
    .text(player, textX, SAFE_MARGIN, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLOR_ACCENT)
    .text(brand, textX, SAFE_MARGIN + 12, {
      width: CARD_TEXT_WIDTH,
      ellipsis: true,
    });

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(COLOR_MUTED)
    .text(variant, textX, SAFE_MARGIN + 22, {
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
