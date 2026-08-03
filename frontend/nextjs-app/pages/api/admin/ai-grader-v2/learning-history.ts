import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";

import {
  inventorySpeedsterLearningHistory,
  type SpeedsterLearningHistoryInventory,
} from "../../../../lib/ai-grader-v2/learning-history";
import {
  replaySpeedsterLearningCalibrationV2,
  speedsterLearningCardKeyV2,
  speedsterLearningFingerprintVersionForDetectorV2,
  type SpeedsterLearningCalibrationReplayV2,
} from "../../../../lib/ai-grader-v2/learning-calibration-v2";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type CompletedHistoryRow = {
  id: string;
  cardProfile: string;
  identity: Prisma.JsonValue;
  reviewedDefects: Prisma.JsonValue;
  gradeReport: Prisma.JsonValue;
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
    select: {
      id: true,
      cardProfile: true,
      identity: true,
      reviewedDefects: true,
      gradeReport: true,
    },
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
    res: NextApiResponse<{
      inventory: SpeedsterLearningHistoryInventory;
      calibration: SpeedsterLearningCalibrationReplayV2;
    } | { message: string }>,
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
      const detectorVersion = (gradeReport: Prisma.JsonValue) =>
        gradeReport && typeof gradeReport === "object" && !Array.isArray(gradeReport)
          ? gradeReport.detectorVersion
          : undefined;
      return res.status(200).json({
        inventory: inventorySpeedsterLearningHistory(rows.map((row) => ({
          id: row.id,
          completedAt: completionBySession.get(row.id)?.createdAt ?? "",
          completionOrder: completionBySession.get(row.id)?.certificateSequence ?? 0,
          reviewedDefects: row.reviewedDefects,
        }))),
        calibration: replaySpeedsterLearningCalibrationV2(rows.flatMap((row) => {
          const completion = completionBySession.get(row.id);
          return completion ? [{
            sessionId: row.id,
            completedAt: completion.createdAt,
            completionOrder: completion.certificateSequence,
            fingerprintVersion: speedsterLearningFingerprintVersionForDetectorV2(
              detectorVersion(row.gradeReport),
            ),
            reviewedDefects: Array.isArray(row.reviewedDefects) ? row.reviewedDefects : [],
            cardKey: speedsterLearningCardKeyV2(row.cardProfile, row.identity),
          }] : [];
        })),
      });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterLearningHistoryHandler();
