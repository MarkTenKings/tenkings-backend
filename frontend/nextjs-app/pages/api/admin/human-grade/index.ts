import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import {
  HUMAN_GRADE_SHEET_CAPACITY,
  formatHumanGrade,
  formatHumanGradeCertificateNumber,
  type HumanGradeLabelSheetDto,
  type HumanGradeQueueDto,
} from "../../../../lib/humanGrade";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const optionalLabelText = z.string().trim().max(120).optional().nullable();
const createSchema = z
  .object({
    cardType: z.enum(["SPORTS", "POKEMON"]),
    playerName: optionalLabelText,
    cardName: optionalLabelText,
    year: z.string().trim().min(1).max(24),
    manufacturer: optionalLabelText,
    productSet: z.string().trim().min(1).max(120),
    parallel: optionalLabelText,
    insert: optionalLabelText,
    cardNumber: optionalLabelText,
    grade: z.coerce.number().min(1).max(10),
  })
  .superRefine((value, context) => {
    if (value.cardType === "SPORTS" && !value.playerName?.trim()) {
      context.addIssue({ code: "custom", path: ["playerName"], message: "Player name is required." });
    }
    if (value.cardType === "SPORTS" && !value.manufacturer?.trim()) {
      context.addIssue({ code: "custom", path: ["manufacturer"], message: "Manufacturer is required." });
    }
    if (value.cardType === "POKEMON" && !value.cardName?.trim()) {
      context.addIssue({ code: "custom", path: ["cardName"], message: "Card name is required." });
    }
  });

type SheetRecord = {
  id: string;
  sheetNumber: number;
  status: "OPEN" | "READY";
  readyAt: Date | null;
  createdAt: Date;
  labels: Array<{
    id: string;
    certificateNumber: string | null;
    certificateSequence: number;
    slot: number;
    cardType: "SPORTS" | "POKEMON";
    playerName: string | null;
    cardName: string | null;
    year: string;
    manufacturer: string | null;
    productSet: string;
    parallel: string | null;
    insert: string | null;
    cardNumber: string | null;
    grade: { toString(): string };
    createdAt: Date;
  }>;
};

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function serializeSheet(sheet: SheetRecord): HumanGradeLabelSheetDto {
  return {
    id: sheet.id,
    sheetNumber: sheet.sheetNumber,
    status: sheet.status,
    capacity: HUMAN_GRADE_SHEET_CAPACITY,
    readyAt: sheet.readyAt?.toISOString() ?? null,
    createdAt: sheet.createdAt.toISOString(),
    labels: sheet.labels.map((label) => ({
      id: label.id,
      slot: label.slot,
      certificateNumber: label.certificateNumber ?? formatHumanGradeCertificateNumber(label.certificateSequence),
      cardType: label.cardType,
      playerName: label.playerName,
      cardName: label.cardName,
      year: label.year,
      manufacturer: label.manufacturer,
      productSet: label.productSet,
      parallel: label.parallel,
      insert: label.insert,
      cardNumber: label.cardNumber,
      grade: formatHumanGrade(label.grade.toString()),
      createdAt: label.createdAt.toISOString(),
    })),
  };
}

async function loadQueue(): Promise<HumanGradeQueueDto> {
  const sheets = (await prisma.humanGradeLabelSheet.findMany({
    orderBy: { sheetNumber: "desc" },
    include: { labels: { orderBy: { slot: "asc" } } },
  })) as SheetRecord[];
  return {
    sheets: sheets.map(serializeSheet),
    totals: {
      cards: sheets.reduce((total, sheet) => total + sheet.labels.length, 0),
      readySheets: sheets.filter((sheet) => sheet.status === "READY").length,
    },
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HumanGradeQueueDto | { message: string; fields?: Record<string, string> }>
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    if (req.method === "GET") return res.status(200).json(await loadQueue());

    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const fields = Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join(".") || "form", issue.message])
      );
      return res.status(400).json({ message: "Complete the required label fields.", fields });
    }

    await prisma.$transaction(async (tx) => {
      let sheet = await tx.humanGradeLabelSheet.findFirst({
        where: { status: "OPEN" },
        orderBy: { sheetNumber: "asc" },
        include: { labels: { select: { slot: true }, orderBy: { slot: "asc" } } },
      });

      if (sheet && sheet.labels.length >= HUMAN_GRADE_SHEET_CAPACITY) {
        await tx.humanGradeLabelSheet.update({
          where: { id: sheet.id },
          data: { status: "READY", readyAt: sheet.readyAt ?? new Date() },
        });
        sheet = null;
      }
      if (!sheet) {
        sheet = await tx.humanGradeLabelSheet.create({
          data: {},
          include: { labels: { select: { slot: true }, orderBy: { slot: "asc" } } },
        });
      }

      const slot = sheet.labels.length + 1;
      const input = parsed.data;
      const created = await tx.humanGradeLabel.create({
        data: {
          sheetId: sheet.id,
          slot,
          cardType: input.cardType,
          playerName: input.cardType === "SPORTS" ? optionalText(input.playerName) : null,
          cardName: input.cardType === "POKEMON" ? optionalText(input.cardName) : null,
          year: input.year.trim(),
          manufacturer: input.cardType === "SPORTS" ? optionalText(input.manufacturer) : null,
          productSet: input.productSet.trim(),
          parallel: optionalText(input.parallel),
          insert: input.cardType === "SPORTS" ? optionalText(input.insert) : null,
          cardNumber: optionalText(input.cardNumber),
          grade: formatHumanGrade(input.grade),
          createdByUserId: admin.user.id,
        },
      });
      await tx.humanGradeLabel.update({
        where: { id: created.id },
        data: { certificateNumber: formatHumanGradeCertificateNumber(created.certificateSequence) },
      });
      if (slot === HUMAN_GRADE_SHEET_CAPACITY) {
        await tx.humanGradeLabelSheet.update({
          where: { id: sheet.id },
          data: { status: "READY", readyAt: new Date() },
        });
      }
    });

    return res.status(201).json(await loadQueue());
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
