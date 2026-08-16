import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { SPEEDSTER_RULE_VERSION } from "../../../../../lib/ai-grader-v2/contracts";
import {
  SpeedsterIdentityValidationError,
  canonicalizeNewSpeedsterSessionIdentity,
} from "../../../../../lib/ai-grader-v2/identity";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const publicReportSlug = z
  .string()
  .min(3)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens");

const createSchema = z
  .object({
    cardProfile: z.enum(["POKEMON", "SPORTS"]),
    publicReportSlug: publicReportSlug.optional(),
    identity: z.unknown(),
  })
  .strict();

type CreateSessionData = {
  createdByUserId: string;
  cardProfile: "POKEMON" | "SPORTS";
  workflowState: "DRAFT";
  ruleVersion: typeof SPEEDSTER_RULE_VERSION;
  publicReportSlug?: string;
  identity: Prisma.InputJsonValue;
  capture: Prisma.InputJsonValue;
  reviewedDefects: Prisma.InputJsonValue;
  gradeReport: Prisma.InputJsonValue;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  createSession: (data: CreateSessionData) => Promise<unknown>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  createSession: (data) => prisma.aiGraderV2Session.create({ data }),
};

export function createAiGraderV2SessionsHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    try {
      const admin = await deps.requireAdminSession(req);
      const parsed = createSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid Speedster session" });
      }
      let identity;
      try {
        identity = canonicalizeNewSpeedsterSessionIdentity(parsed.data.cardProfile, parsed.data.identity);
      } catch (error) {
        if (error instanceof SpeedsterIdentityValidationError) {
          return res.status(400).json({ message: error.message, fields: error.fields });
        }
        throw error;
      }

      const session = await deps.createSession({
        createdByUserId: admin.user.id,
        cardProfile: parsed.data.cardProfile,
        workflowState: "DRAFT",
        ruleVersion: SPEEDSTER_RULE_VERSION,
        ...(parsed.data.publicReportSlug
          ? { publicReportSlug: parsed.data.publicReportSlug }
          : {}),
        identity: identity as Prisma.InputJsonValue,
        capture: {} as Prisma.InputJsonValue,
        reviewedDefects: [] as Prisma.InputJsonValue,
        gradeReport: {} as Prisma.InputJsonValue,
      });

      return res.status(201).json({ session });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2SessionsHandler();
