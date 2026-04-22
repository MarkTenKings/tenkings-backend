import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { customAlphabet } from "nanoid";
import { CollectibleCategory, GoldenTicketStatus, Prisma } from "@prisma/client";
import { buildSiteUrl } from "./urls";

const GOLDEN_TICKET_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const GOLDEN_TICKET_DEFAULT_CODE_LENGTH = 12;
const GOLDEN_TICKET_MIN_CODE_LENGTH = 8;
const GOLDEN_TICKET_MAX_CODE_LENGTH = 32;
const GOLDEN_TICKET_SET_NAME = "Golden Ticket Prize";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const PAGE_MARGIN = 42;

const GOLD = "#D4AF37";
const GOLD_DARK = "#8B6A18";
const GOLD_LIGHT = "#F4DE9A";
const PAPER = "#F8F1DC";
const INK = "#14110F";
const MIDNIGHT = "#09090B";
const MUTED = "#756F63";

const GOLDEN_TICKET_STATUS_VALUES = Object.values(GoldenTicketStatus);

type PdfDoc = InstanceType<typeof PDFDocument>;

export interface GoldenTicketPrizeDetails {
  prizeGroupId: string | null;
  description: string | null;
  category: CollectibleCategory | null;
  photoGallery: string[];
  requiresSize: boolean;
  sizeOptions: string[];
}

export interface GoldenTicketPrizeDetailsInput {
  prizeGroupId: string;
  description?: string | null;
  category?: CollectibleCategory | null;
  photoGallery?: string[];
  requiresSize?: boolean;
  sizeOptions?: string[];
}

export interface GoldenTicketPrizeListRow {
  id: string;
  ticketNumber: number;
  code: string;
  status: GoldenTicketStatus;
  createdAt: Date;
  claimedAt: Date | null;
  revealVideoAssetUrl: string | null;
  revealVideoPoster: string | null;
  prizeItem: {
    id: string;
    name: string;
    set: string;
    estimatedValue: number | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    detailsJson: Prisma.JsonValue | null;
  };
}

export interface AdminGoldenTicketPrizeSummary {
  prizeGroupId: string;
  title: string;
  description: string | null;
  category: CollectibleCategory | null;
  estimatedValue: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  photoGallery: string[];
  requiresSize: boolean;
  sizeOptions: string[];
  revealVideoAssetUrl: string | null;
  revealVideoPoster: string | null;
  ticketCount: number;
  statusBreakdown: Record<GoldenTicketStatus, number>;
  createdAt: string;
  updatedAt: string;
  tickets: Array<{
    id: string;
    ticketNumber: number;
    ticketLabel: string;
    code: string;
    claimUrl: string;
    status: GoldenTicketStatus;
    createdAt: string;
    claimedAt: string | null;
    pdfPath: string;
    pdfFileName: string;
  }>;
}

const isJsonObject = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: Prisma.JsonValue | undefined) => (typeof value === "string" && value.trim() ? value.trim() : null);

const readStringArray = (value: Prisma.JsonValue | undefined) =>
  Array.isArray(value) ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean) : [];

const coerceCategory = (value: Prisma.JsonValue | undefined): CollectibleCategory | null =>
  typeof value === "string" && value in CollectibleCategory ? (value as CollectibleCategory) : null;

export function getGoldenTicketSetName() {
  return GOLDEN_TICKET_SET_NAME;
}

export function getGoldenTicketCodeLength() {
  const raw = Number.parseInt(process.env.GOLDEN_TICKET_CODE_LENGTH ?? "", 10);
  if (!Number.isFinite(raw)) {
    return GOLDEN_TICKET_DEFAULT_CODE_LENGTH;
  }
  return Math.min(Math.max(raw, GOLDEN_TICKET_MIN_CODE_LENGTH), GOLDEN_TICKET_MAX_CODE_LENGTH);
}

export function generateGoldenTicketCode() {
  return customAlphabet(GOLDEN_TICKET_CODE_ALPHABET, getGoldenTicketCodeLength())();
}

export function generateGoldenTicketCodeBatch(count: number) {
  const seen = new Set<string>();
  while (seen.size < count) {
    seen.add(generateGoldenTicketCode());
  }
  return Array.from(seen);
}

export function buildGoldenTicketClaimUrl(code: string) {
  return buildSiteUrl(`/golden/claim/${code}`);
}

export function formatGoldenTicketLabel(ticketNumber: number) {
  return `#${String(ticketNumber).padStart(4, "0")}`;
}

export function buildGoldenTicketPdfFileName(ticketNumber: number) {
  return `tenkings-golden-ticket-${String(ticketNumber).padStart(4, "0")}.pdf`;
}

export function buildGoldenTicketPdfStorageKey(ticketNumber: number, code: string) {
  return `golden-tickets/pdfs/${String(ticketNumber).padStart(6, "0")}-${code}.pdf`;
}

export function buildGoldenTicketPrizeDetails(input: GoldenTicketPrizeDetailsInput): Prisma.InputJsonValue {
  return {
    goldenTicketPrizeGroupId: input.prizeGroupId,
    goldenTicketDescription: input.description?.trim() || null,
    goldenTicketCategory: input.category ?? null,
    goldenTicketPhotoGallery: [...new Set((input.photoGallery ?? []).map((entry) => entry.trim()).filter(Boolean))],
    goldenTicketRequiresSize: Boolean(input.requiresSize),
    goldenTicketSizeOptions: [...new Set((input.sizeOptions ?? []).map((entry) => entry.trim()).filter(Boolean))],
  } satisfies Prisma.InputJsonObject;
}

export function parseGoldenTicketPrizeDetails(value: Prisma.JsonValue | null): GoldenTicketPrizeDetails {
  const record = isJsonObject(value) ? value : null;
  return {
    prizeGroupId: readString(record?.goldenTicketPrizeGroupId),
    description: readString(record?.goldenTicketDescription),
    category: coerceCategory(record?.goldenTicketCategory),
    photoGallery: readStringArray(record?.goldenTicketPhotoGallery),
    requiresSize: record?.goldenTicketRequiresSize === true,
    sizeOptions: readStringArray(record?.goldenTicketSizeOptions),
  };
}

export function createGoldenTicketStatusBreakdown(): Record<GoldenTicketStatus, number> {
  return GOLDEN_TICKET_STATUS_VALUES.reduce(
    (accumulator, status) => {
      accumulator[status] = 0;
      return accumulator;
    },
    {} as Record<GoldenTicketStatus, number>
  );
}

export function groupGoldenTicketPrizes(rows: GoldenTicketPrizeListRow[]): AdminGoldenTicketPrizeSummary[] {
  const grouped = new Map<string, AdminGoldenTicketPrizeSummary>();

  for (const row of rows) {
    const details = parseGoldenTicketPrizeDetails(row.prizeItem.detailsJson);
    const prizeGroupId = details.prizeGroupId ?? row.id;
    const createdAtIso = row.createdAt.toISOString();
    const existing = grouped.get(prizeGroupId);

    if (!existing) {
      grouped.set(prizeGroupId, {
        prizeGroupId,
        title: row.prizeItem.name,
        description: details.description,
        category: details.category,
        estimatedValue: row.prizeItem.estimatedValue ?? null,
        imageUrl: row.prizeItem.imageUrl ?? details.photoGallery[0] ?? null,
        thumbnailUrl: row.prizeItem.thumbnailUrl ?? row.prizeItem.imageUrl ?? details.photoGallery[0] ?? null,
        photoGallery: details.photoGallery,
        requiresSize: details.requiresSize,
        sizeOptions: details.sizeOptions,
        revealVideoAssetUrl: row.revealVideoAssetUrl ?? null,
        revealVideoPoster: row.revealVideoPoster ?? null,
        ticketCount: 0,
        statusBreakdown: createGoldenTicketStatusBreakdown(),
        createdAt: createdAtIso,
        updatedAt: createdAtIso,
        tickets: [],
      });
    }

    const summary = grouped.get(prizeGroupId);
    if (!summary) {
      continue;
    }

    summary.ticketCount += 1;
    summary.statusBreakdown[row.status] += 1;
    summary.createdAt = summary.createdAt < createdAtIso ? summary.createdAt : createdAtIso;
    summary.updatedAt = summary.updatedAt > createdAtIso ? summary.updatedAt : createdAtIso;
    summary.tickets.push({
      id: row.id,
      ticketNumber: row.ticketNumber,
      ticketLabel: formatGoldenTicketLabel(row.ticketNumber),
      code: row.code,
      claimUrl: buildGoldenTicketClaimUrl(row.code),
      status: row.status,
      createdAt: createdAtIso,
      claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
      pdfPath: `/api/admin/golden/tickets/${row.id}/pdf`,
      pdfFileName: buildGoldenTicketPdfFileName(row.ticketNumber),
    });
  }

  return Array.from(grouped.values())
    .map((summary) => ({
      ...summary,
      tickets: summary.tickets.sort((left, right) => left.ticketNumber - right.ticketNumber),
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function generateGoldenTicketPdf({
  ticketNumber,
  code,
  title,
  claimUrl,
  imageUrl,
  estimatedValue,
}: {
  ticketNumber: number;
  code: string;
  title: string;
  claimUrl: string;
  imageUrl?: string | null;
  estimatedValue?: number | null;
}) {
  const doc = new PDFDocument({
    size: [LETTER_WIDTH, LETTER_HEIGHT],
    margin: 0,
    info: {
      Author: "Ten Kings",
      Title: `Golden Ticket ${formatGoldenTicketLabel(ticketNumber)}`,
    },
  });

  const qrBuffer = await QRCode.toBuffer(claimUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 1200,
    color: {
      dark: INK,
      light: "#FFFFFF",
    },
  });

  drawGoldenTicketPdf(doc, {
    ticketNumber,
    code,
    title,
    claimUrl,
    qrBuffer,
    imageUrl: imageUrl ?? null,
    estimatedValue: estimatedValue ?? null,
  });

  doc.end();
  return collectPdfBuffer(doc);
}

function drawGoldenTicketPdf(
  doc: PdfDoc,
  {
    ticketNumber,
    code,
    title,
    claimUrl,
    qrBuffer,
    imageUrl,
    estimatedValue,
  }: {
    ticketNumber: number;
    code: string;
    title: string;
    claimUrl: string;
    qrBuffer: Buffer;
    imageUrl: string | null;
    estimatedValue: number | null;
  }
) {
  const cardX = PAGE_MARGIN;
  const cardY = PAGE_MARGIN;
  const cardWidth = LETTER_WIDTH - PAGE_MARGIN * 2;
  const cardHeight = LETTER_HEIGHT - PAGE_MARGIN * 2;
  const qrSize = 188;
  const rightPanelWidth = 220;
  const safeX = cardX + 30;
  const safeY = cardY + 30;
  const safeWidth = cardWidth - 60;
  const safeHeight = cardHeight - 60;

  doc.rect(0, 0, LETTER_WIDTH, LETTER_HEIGHT).fill(MIDNIGHT);
  doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 30).fill("#120E08");
  doc.lineWidth(3).strokeColor(GOLD).roundedRect(cardX, cardY, cardWidth, cardHeight, 30).stroke();
  doc.lineWidth(1).strokeColor(GOLD_DARK).roundedRect(cardX + 10, cardY + 10, cardWidth - 20, cardHeight - 20, 24).stroke();

  doc.roundedRect(safeX, safeY, safeWidth, 96, 20).fill(GOLD);
  doc.fillColor(MIDNIGHT).font("Times-Bold").fontSize(16).text("TEN KINGS", safeX + 24, safeY + 18, {
    width: safeWidth - 48,
    align: "center",
  });
  doc.font("Times-Bold").fontSize(31).text("GOLDEN TICKET", safeX + 24, safeY + 38, {
    width: safeWidth - 48,
    align: "center",
  });

  doc.roundedRect(safeX, safeY + 120, safeWidth - rightPanelWidth - 20, safeHeight - 140, 24).fill(PAPER);
  doc.roundedRect(safeX + safeWidth - rightPanelWidth, safeY + 120, rightPanelWidth, safeHeight - 140, 24).fill("#F3E3AF");

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text("TICKET NUMBER", safeX + 24, safeY + 146);
  doc.font("Times-Bold").fontSize(38).text(formatGoldenTicketLabel(ticketNumber), safeX + 24, safeY + 164, {
    width: safeWidth - rightPanelWidth - 68,
  });

  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(11).text("PRIZE", safeX + 24, safeY + 234);
  doc.fillColor(INK).font("Times-Bold").fontSize(28).text(title, safeX + 24, safeY + 252, {
    width: safeWidth - rightPanelWidth - 68,
    height: 112,
  });

  if (estimatedValue !== null) {
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(11).text("ESTIMATED VALUE", safeX + 24, safeY + 382);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(formatUsdMinor(estimatedValue), safeX + 24, safeY + 399);
  }

  doc.fillColor(INK).font("Helvetica").fontSize(12).text(
    "Scan this QR to launch the winner claim flow, go live, and lock in the reveal.",
    safeX + 24,
    safeY + 452,
    {
      width: safeWidth - rightPanelWidth - 68,
      lineGap: 4,
    }
  );

  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(10).text("CLAIM URL", safeX + 24, safeY + 550);
  doc.fillColor(INK).font("Helvetica").fontSize(10).text(claimUrl, safeX + 24, safeY + 566, {
    width: safeWidth - rightPanelWidth - 68,
  });

  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(10).text("TICKET CODE", safeX + 24, safeY + 616);
  doc.fillColor(INK).font("Helvetica").fontSize(11).text(code, safeX + 24, safeY + 632);

  doc.image(qrBuffer, safeX + safeWidth - rightPanelWidth + 16, safeY + 156, {
    fit: [qrSize, qrSize],
    align: "center",
    valign: "center",
  });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text("SCAN TO CLAIM", safeX + safeWidth - rightPanelWidth + 18, safeY + 360, {
    width: rightPanelWidth - 36,
    align: "center",
  });
  doc.font("Helvetica").fontSize(10).text("This QR links to the Golden Ticket reveal experience.", safeX + safeWidth - rightPanelWidth + 18, safeY + 380, {
    width: rightPanelWidth - 36,
    align: "center",
    lineGap: 3,
  });

  if (imageUrl) {
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(10).text("PRIZE IMAGE", safeX + safeWidth - rightPanelWidth + 18, safeY + 468, {
      width: rightPanelWidth - 36,
      align: "center",
    });
    doc.fillColor(INK).font("Helvetica").fontSize(9).text(imageUrl, safeX + safeWidth - rightPanelWidth + 18, safeY + 484, {
      width: rightPanelWidth - 36,
      align: "center",
      lineGap: 2,
    });
  }

  doc.fillColor(GOLD_LIGHT).font("Helvetica-Bold").fontSize(10).text("TENKINGS.CO", cardX, LETTER_HEIGHT - PAGE_MARGIN - 18, {
    width: cardWidth,
    align: "center",
  });
}

function formatUsdMinor(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function collectPdfBuffer(doc: PdfDoc) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (error) => reject(error));
  });
}
