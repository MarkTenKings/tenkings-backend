import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const jsonObject = z.record(z.string(), z.unknown());
const publicReportSlug = z
  .string()
  .min(3)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens");

const patchSchema = z
  .object({
    cardProfile: z.enum(["POKEMON", "SPORTS"]).optional(),
    workflowState: z.string().trim().min(1).max(64).optional(),
    publicReportSlug: publicReportSlug.optional(),
    identity: jsonObject.optional(),
    capture: jsonObject.optional(),
    reviewedDefects: z.array(z.unknown()).optional(),
    gradeReport: jsonObject.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

type PersistedSession = {
  publicReportSlug: string | null;
  [key: string]: unknown;
};

type UpdateSessionData = {
  cardProfile?: "POKEMON" | "SPORTS";
  workflowState?: string;
  publicReportSlug?: string;
  identity?: Prisma.InputJsonValue;
  capture?: Prisma.InputJsonValue;
  reviewedDefects?: Prisma.InputJsonValue;
  gradeReport?: Prisma.InputJsonValue;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string, createdByUserId: string) => Promise<PersistedSession | null>;
  updateSession: (id: string, createdByUserId: string, data: UpdateSessionData) => Promise<unknown>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id, createdByUserId) => prisma.aiGraderV2Session.findFirst({ where: { id, createdByUserId } }),
  updateSession: (id, createdByUserId, data) =>
    prisma.aiGraderV2Session.update({ where: { id, createdByUserId }, data }),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

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

      if (req.method === "GET") return res.status(200).json({ session: existing });

      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid Speedster session update" });
      }
      if (
        parsed.data.publicReportSlug &&
        existing.publicReportSlug &&
        parsed.data.publicReportSlug !== existing.publicReportSlug
      ) {
        return res.status(409).json({ message: "Public report slug is already fixed" });
      }

      const data: UpdateSessionData = {};
      if (parsed.data.cardProfile !== undefined) data.cardProfile = parsed.data.cardProfile;
      if (parsed.data.workflowState !== undefined) data.workflowState = parsed.data.workflowState;
      if (parsed.data.publicReportSlug !== undefined) data.publicReportSlug = parsed.data.publicReportSlug;
      if (parsed.data.identity !== undefined) data.identity = parsed.data.identity as Prisma.InputJsonValue;
      if (parsed.data.capture !== undefined) data.capture = parsed.data.capture as Prisma.InputJsonValue;
      if (parsed.data.reviewedDefects !== undefined) {
        data.reviewedDefects = parsed.data.reviewedDefects as Prisma.InputJsonValue;
      }
      if (parsed.data.gradeReport !== undefined) {
        data.gradeReport = parsed.data.gradeReport as Prisma.InputJsonValue;
      }

      const session = await deps.updateSession(sessionId, admin.user.id, data);
      return res.status(200).json({ session });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2SessionHandler();
