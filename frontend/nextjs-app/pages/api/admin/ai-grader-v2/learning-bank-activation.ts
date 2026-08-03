import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";

import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import {
  SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS,
  runSpeedsterLearningActivation,
  runSpeedsterLearningPolicyCorrection,
  runSpeedsterLearningRollback,
  type SpeedsterLearningActivationClient,
  type SpeedsterLearningActivationInput,
  type SpeedsterLearningPolicyCorrectionInput,
  type SpeedsterLearningRollbackInput,
} from "../../../../lib/server/aiGraderV2LearningBankActivation";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const activationSchema = z.object({
  operation: z.enum(["DRY_RUN", "ACTIVATE"]).default("DRY_RUN"),
  typedConfirmation: z.string().optional(),
  expectedCurrentRowHash: sha256,
  calibrationEvidenceHash: sha256.optional(),
  dryRunStatus: z.literal(SPEEDSTER_LEARNING_ACTIVATION_DRY_RUN_STATUS).optional(),
  dryRunEvidenceHash: sha256.optional(),
}).strict();
const rollbackSchema = z.object({
  operation: z.literal("ROLLBACK"),
  typedConfirmation: z.string().min(1),
  expectedActiveRowHash: sha256,
}).strict();
const policyCorrectionSchema = z.object({
  operation: z.enum(["POLICY_DRY_RUN", "CORRECT_POLICY"]),
  typedConfirmation: z.string().optional(),
  expectedActiveRowHash: sha256,
  calibrationEvidenceHash: sha256.optional(),
}).strict();

type Dependencies = {
  requireAdminSession: typeof requireAdminSession;
  activate: (input: SpeedsterLearningActivationInput) => Promise<unknown>;
  correctPolicy: (input: SpeedsterLearningPolicyCorrectionInput) => Promise<unknown>;
  rollback: (input: SpeedsterLearningRollbackInput) => Promise<unknown>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  activate: (input) => runSpeedsterLearningActivation(
    prisma as unknown as SpeedsterLearningActivationClient,
    input,
  ),
  correctPolicy: (input) => runSpeedsterLearningPolicyCorrection(
    prisma as unknown as SpeedsterLearningActivationClient,
    input,
  ),
  rollback: (input) => runSpeedsterLearningRollback(
    prisma as unknown as SpeedsterLearningActivationClient,
    input,
  ),
};

export function createSpeedsterLearningBankActivationHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      const admin = await deps.requireAdminSession(req);
      if (req.body?.operation === "POLICY_DRY_RUN" || req.body?.operation === "CORRECT_POLICY") {
        const payload = policyCorrectionSchema.parse(req.body);
        const result = await deps.correctPolicy({
          mode: payload.operation === "CORRECT_POLICY" ? "CORRECT_POLICY" : "DRY_RUN",
          typedConfirmation: payload.typedConfirmation,
          expectedActiveRowHash: payload.expectedActiveRowHash,
          calibrationEvidenceHash: payload.calibrationEvidenceHash,
          actorUserId: admin.user.id,
        });
        return res.status(200).json(result);
      }
      if (req.body?.operation === "ROLLBACK") {
        const payload = rollbackSchema.parse(req.body);
        const result = await deps.rollback({
          typedConfirmation: payload.typedConfirmation,
          expectedActiveRowHash: payload.expectedActiveRowHash,
          actorUserId: admin.user.id,
        });
        return res.status(200).json(result);
      }
      const payload = activationSchema.parse(req.body ?? {});
      const result = await deps.activate({
        mode: payload.operation,
        typedConfirmation: payload.typedConfirmation,
        expectedCurrentRowHash: payload.expectedCurrentRowHash,
        calibrationEvidenceHash: payload.calibrationEvidenceHash,
        dryRunStatus: payload.dryRunStatus,
        dryRunEvidenceHash: payload.dryRunEvidenceHash,
        actorUserId: admin.user.id,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid SAM Memory operation" });
      }
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterLearningBankActivationHandler();
