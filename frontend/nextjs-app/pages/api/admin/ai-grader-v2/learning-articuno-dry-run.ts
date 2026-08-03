import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";

import {
  runLockedSpeedsterArticunoDryRun,
  type SpeedsterArticunoDryRunResult,
} from "../../../../lib/ai-grader-v2/learning-articuno-dry-run-v2";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type Calibration = { tau: number; margin: number };
type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<unknown>;
  runDryRun: (calibration?: Calibration) => Promise<SpeedsterArticunoDryRunResult>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  runDryRun: (calibration) => prisma.$transaction((tx) => runLockedSpeedsterArticunoDryRun({
    acquireCompletionAdvisoryLock: async () => {
      await tx.$queryRaw`
        SELECT 1 AS "lockAcquired"
        FROM pg_advisory_xact_lock(hashtext('ten-kings-human-grade-label-slots'))
      `;
    },
    listCompletionLabels: () => tx.humanGradeLabel.findMany({
      where: { source: "SPEEDSTER" },
      orderBy: { certificateSequence: "asc" },
      select: { sourceSessionId: true, certificateSequence: true, createdAt: true },
    }),
    listCompletedSessions: () => tx.aiGraderV2Session.findMany({
      where: { workflowState: "COMPLETED" },
      select: { id: true, reviewedDefects: true, capture: true, gradeReport: true },
    }),
    readGlobalLearningBank: () => tx.aiGraderV2LearningBank.findUnique({
      where: { id: "GLOBAL" },
      select: { state: true, updatedAt: true },
    }),
  }, calibration)),
};

const oneQueryValue = (value: string | string[] | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function calibrationFrom(req: NextApiRequest): Calibration | undefined | null {
  const tauText = oneQueryValue(req.query.tau);
  const marginText = oneQueryValue(req.query.margin);
  if (!tauText && !marginText) return undefined;
  if (!tauText || !marginText) return null;
  const tau = Number(tauText);
  const margin = Number(marginText);
  return Number.isFinite(tau) && tau >= 0 && tau <= 1
    && Number.isFinite(margin) && margin >= 0 && margin <= 1
    ? { tau, margin }
    : null;
}

export function createSpeedsterArticunoDryRunHandler(deps: Dependencies = dependencies) {
  return async function handler(
    req: NextApiRequest,
    res: NextApiResponse<SpeedsterArticunoDryRunResult | { message: string }>,
  ) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      await deps.requireAdminSession(req);
      const calibration = calibrationFrom(req);
      if (calibration === null) {
        return res.status(400).json({ message: "Supply both read-only tau and margin values between 0 and 1" });
      }
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(await deps.runDryRun(calibration));
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterArticunoDryRunHandler();
