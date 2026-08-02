import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type CompletedSession = {
  id: string;
  cardProfile: string;
  publicReportSlug: string | null;
  identity: Prisma.JsonValue;
  gradeReport: Prisma.JsonValue;
  slabFrontKey: string | null;
  slabBackKey: string | null;
  nfcDone: boolean;
  compsDone: boolean;
  inventoryDone: boolean;
  createdAt: Date;
};
type Label = {
  sourceSessionId: string | null;
  certificateNumber: string | null;
  sheet: { sheetNumber: number };
  slot: number;
};
type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  listSessions: () => Promise<CompletedSession[]>;
  listLabels: (sessionIds: string[]) => Promise<Label[]>;
};

const record = (value: Prisma.JsonValue): Record<string, Prisma.JsonValue> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
const text = (value: Prisma.JsonValue | undefined) => typeof value === "string" && value.trim() ? value.trim() : null;
const numeric = (value: Prisma.JsonValue | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function completedCardTitle(session: Pick<CompletedSession, "cardProfile" | "identity">) {
  const identity = record(session.identity);
  return text(session.cardProfile === "POKEMON" ? identity.cardName : identity.playerName) ?? "Ten Kings card";
}

export function mapCompletedCard(session: CompletedSession, label?: Label) {
  const identity = record(session.identity);
  const grade = record(record(session.gradeReport).overall);
  return {
    id: session.id,
    cardProfile: session.cardProfile,
    title: completedCardTitle(session),
    details: [identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.cardNumber]
      .map(text)
      .filter((value): value is string => Boolean(value)),
    grade: numeric(grade.displayGrade),
    publicReportSlug: session.publicReportSlug,
    certificateNumber: label?.certificateNumber ?? null,
    labelSheetNumber: label?.sheet.sheetNumber ?? null,
    labelSlot: label?.slot ?? null,
    slabPhotosDone: Boolean(session.slabFrontKey && session.slabBackKey),
    nfcDone: session.nfcDone,
    compsDone: session.compsDone,
    inventoryDone: session.inventoryDone,
    createdAt: session.createdAt.toISOString(),
  };
}

const dependencies: Dependencies = {
  requireAdminSession,
  listSessions: () => prisma.aiGraderV2Session.findMany({
    where: { workflowState: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cardProfile: true,
      publicReportSlug: true,
      identity: true,
      gradeReport: true,
      slabFrontKey: true,
      slabBackKey: true,
      nfcDone: true,
      compsDone: true,
      inventoryDone: true,
      createdAt: true,
    },
  }),
  listLabels: (sessionIds) => prisma.humanGradeLabel.findMany({
    where: { sourceSessionId: { in: sessionIds } },
    select: { sourceSessionId: true, certificateNumber: true, slot: true, sheet: { select: { sheetNumber: true } } },
  }),
};

export function createCompletedCardsHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      await deps.requireAdminSession(req);
      const sessions = await deps.listSessions();
      const labels = sessions.length ? await deps.listLabels(sessions.map(({ id }) => id)) : [];
      const bySession = new Map(labels.flatMap((label) => label.sourceSessionId ? [[label.sourceSessionId, label] as const] : []));
      return res.status(200).json({ cards: sessions.map((session) => mapCompletedCard(session, bySession.get(session.id))) });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createCompletedCardsHandler();
