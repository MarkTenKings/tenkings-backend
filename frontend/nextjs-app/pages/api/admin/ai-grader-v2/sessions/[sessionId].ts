import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  parseSpeedsterReviewFindings,
  stripSpeedsterTraceBodies,
} from "../../../../../lib/ai-grader-v2/review-findings";

const jsonObject = z.record(z.string(), z.unknown());
const patchSchema = z
  .object({
    workflowState: z.literal("CAPTURED"),
    capture: jsonObject.refine((value) => Object.keys(value).length > 0),
  })
  .strict();

type PersistedSession = {
  publicReportSlug?: string | null;
  workflowState?: string;
  reviewedDefects?: unknown;
  [key: string]: unknown;
};

type UpdateSessionData = {
  workflowState: "CAPTURED";
  capture: Prisma.InputJsonValue;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string, createdByUserId: string) => Promise<PersistedSession | null>;
  updateSession: (id: string, createdByUserId: string, data: UpdateSessionData) => Promise<PersistedSession | null>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id, createdByUserId) => prisma.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
  updateSession: (id, createdByUserId, data) => prisma.$transaction(async (tx) => {
    const updated = await tx.aiGraderV2Session.updateMany({
      where: { id, createdByUserId, workflowState: "DRAFT" },
      data,
    });
    if (updated.count !== 1) return null;
    return tx.aiGraderV2Session.findFirst({ where: { id, createdByUserId } });
  }),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

function safeSessionResponse(session: PersistedSession): PersistedSession {
  if (session.reviewedDefects === undefined) return session;
  return {
    ...session,
    reviewedDefects: stripSpeedsterTraceBodies(
      parseSpeedsterReviewFindings(session.reviewedDefects),
    ),
  };
}

export function createAiGraderV2SessionHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "PATCH") {
      res.setHeader("Allow", "GET, PATCH");
      return res.status(405).json({ message: "Method not allowed" });
    }

    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Session ID is required" });

      const existing = await deps.findSession(sessionId, admin.user.id);
      if (!existing) return res.status(404).json({ message: "Speedster session not found" });

      if (req.method === "GET") {
        return res.status(200).json({ session: safeSessionResponse(existing) });
      }

      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid Speedster session update" });
      }
      if (existing.workflowState !== "DRAFT") {
        return res.status(409).json({ message: "Only a DRAFT Speedster session can save its capture" });
      }
      const session = await deps.updateSession(sessionId, admin.user.id, {
        workflowState: "CAPTURED",
        capture: parsed.data.capture as Prisma.InputJsonValue,
      });
      if (!session) {
        return res.status(409).json({ message: "Speedster capture state changed before it could be saved" });
      }
      return res.status(200).json({ session: safeSessionResponse(session) });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2SessionHandler();
