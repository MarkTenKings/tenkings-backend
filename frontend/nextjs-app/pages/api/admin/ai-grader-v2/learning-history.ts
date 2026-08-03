import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";

import {
  inventorySpeedsterLearningHistory,
  type SpeedsterLearningHistoryInventory,
} from "../../../../lib/ai-grader-v2/learning-history";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type CompletedHistoryRow = {
  id: string;
  reviewedDefects: Prisma.JsonValue;
};

type CompletionLabel = {
  sourceSessionId: string | null;
  certificateSequence: number;
  createdAt: Date;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<unknown>;
  listCompletedHistory: () => Promise<CompletedHistoryRow[]>;
  listCompletionLabels: (sessionIds: string[]) => Promise<CompletionLabel[]>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  listCompletedHistory: () => prisma.aiGraderV2Session.findMany({
    where: { workflowState: "COMPLETED" },
    orderBy: { id: "asc" },
    select: { id: true, reviewedDefects: true },
  }),
  listCompletionLabels: (sessionIds) => prisma.humanGradeLabel.findMany({
    where: { source: "SPEEDSTER", sourceSessionId: { in: sessionIds } },
    orderBy: { certificateSequence: "asc" },
    select: { sourceSessionId: true, certificateSequence: true, createdAt: true },
  }),
};

export function createSpeedsterLearningHistoryHandler(deps: Dependencies = dependencies) {
  return async function handler(
    req: NextApiRequest,
    res: NextApiResponse<{ inventory: SpeedsterLearningHistoryInventory } | { message: string }>,
  ) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      await deps.requireAdminSession(req);
      const rows = await deps.listCompletedHistory();
      const labels = rows.length ? await deps.listCompletionLabels(rows.map(({ id }) => id)) : [];
      const completionBySession = new Map(labels.flatMap((label) => label.sourceSessionId
        ? [[label.sourceSessionId, label] as const]
        : []));
      return res.status(200).json({
        inventory: inventorySpeedsterLearningHistory(rows.map((row) => ({
          id: row.id,
          completedAt: completionBySession.get(row.id)?.createdAt ?? "",
          completionOrder: completionBySession.get(row.id)?.certificateSequence ?? 0,
          reviewedDefects: row.reviewedDefects,
        }))),
      });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterLearningHistoryHandler();
