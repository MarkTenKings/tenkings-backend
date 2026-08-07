import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import type { HumanGradeLabelSnapshot } from "../../../../../../lib/humanGrade";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { renderHumanGradeLabelPdf } from "../../../../../../lib/server/humanGradeLabelRenderer";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;

type DecimalText = { toString(): string };
type LinkedLabel = {
  id: string;
  source: "HUMAN" | "SPEEDSTER";
  sourceSessionId: string | null;
  certificateNumber: string | null;
  gradingFormulaVersion: "LEGACY_30_25_25_20" | "EQUAL_25";
  cardType: "SPORTS" | "POKEMON";
  playerName: string | null;
  cardName: string | null;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  insert: string | null;
  cardNumber: string | null;
  centeringGrade: DecimalText;
  cornersGrade: DecimalText;
  edgesGrade: DecimalText;
  surfaceGrade: DecimalText;
  grade: DecimalText;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<unknown>;
  findSession: (sessionId: string) => Promise<{ id: string; workflowState: string } | null>;
  findLabel: (sessionId: string) => Promise<LinkedLabel | null>;
  renderLabel: (snapshot: HumanGradeLabelSnapshot) => Promise<Buffer>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id) => prisma.aiGraderV2Session.findUnique({
    where: { id },
    select: { id: true, workflowState: true },
  }),
  findLabel: (id) => prisma.humanGradeLabel.findUnique({
    where: { sourceSessionId: id },
    select: {
      id: true,
      source: true,
      sourceSessionId: true,
      certificateNumber: true,
      gradingFormulaVersion: true,
      cardType: true,
      playerName: true,
      cardName: true,
      year: true,
      manufacturer: true,
      productSet: true,
      parallel: true,
      insert: true,
      cardNumber: true,
      centeringGrade: true,
      cornersGrade: true,
      edgesGrade: true,
      surfaceGrade: true,
      grade: true,
    },
  }),
  renderLabel: renderHumanGradeLabelPdf,
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

const snapshotFrom = (label: LinkedLabel): HumanGradeLabelSnapshot => ({
  id: label.id,
  certificateNumber: label.certificateNumber as string,
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
});

export function createCompletedCardLabelHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      const session = await deps.findSession(sessionId);
      if (!session || session.workflowState !== "COMPLETED") {
        return res.status(404).json({ message: "Completed Speedster card not found" });
      }
      const label = await deps.findLabel(sessionId);
      if (
        !label ||
        label.source !== "SPEEDSTER" ||
        label.sourceSessionId !== session.id ||
        !label.certificateNumber
      ) {
        return res.status(404).json({ message: "Linked Speedster label not found" });
      }

      const pdf = await deps.renderLabel(snapshotFrom(label));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="ten-kings-${label.certificateNumber}.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(pdf);
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createCompletedCardLabelHandler();
