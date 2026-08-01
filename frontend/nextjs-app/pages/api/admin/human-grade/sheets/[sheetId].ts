import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { HUMAN_GRADE_SHEET_CAPACITY, formatHumanGradeCertificateNumber } from "../../../../../lib/humanGrade";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { renderHumanGradeLabelSheetPdf } from "../../../../../lib/server/humanGradeLabelRenderer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const sheetId = Array.isArray(req.query.sheetId) ? req.query.sheetId[0] : req.query.sheetId;
    if (!sheetId) return res.status(400).json({ message: "Sheet id is required." });

    const sheet = await prisma.humanGradeLabelSheet.findUnique({
      where: { id: sheetId },
      include: { labels: { orderBy: { slot: "asc" } } },
    });
    if (!sheet) return res.status(404).json({ message: "Human-grade label page not found." });
    if (sheet.status !== "READY" || sheet.labels.length !== HUMAN_GRADE_SHEET_CAPACITY) {
      return res.status(409).json({ message: "This label page is still filling and is not ready to print." });
    }

    const pdf = await renderHumanGradeLabelSheetPdf(
      sheet.labels.map((label) => ({
        slot: label.slot,
        snapshot: {
          id: label.id,
          certificateNumber:
            label.certificateNumber ?? formatHumanGradeCertificateNumber(label.certificateSequence),
          source: label.source,
          gradingFormulaVersion: label.gradingFormulaVersion,
          cardType: label.cardType,
          playerName: label.playerName,
          cardName: label.cardName,
          year: label.year,
          manufacturer: label.manufacturer,
          productSet: label.productSet,
          parallel: label.parallel,
          insert: label.insert,
          cardNumber: label.cardNumber,
          centeringGrade: label.centeringGrade.toString(),
          cornersGrade: label.cornersGrade.toString(),
          edgesGrade: label.edgesGrade.toString(),
          surfaceGrade: label.surfaceGrade.toString(),
          grade: label.grade.toString(),
        },
      }))
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="ten-kings-human-grade-page-${sheet.sheetNumber}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(pdf);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
