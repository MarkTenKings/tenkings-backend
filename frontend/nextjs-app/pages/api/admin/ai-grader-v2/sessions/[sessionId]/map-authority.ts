import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, type Prisma } from "@tenkings/database";
import { appendSpeedsterMapAuthorityEvidence } from "../../../../../../lib/ai-grader-v2/map-authority";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { loadEffectiveActiveSpeedsterMapRevision } from "../../../../../../lib/server/speedsterCardTypeMaps";
import { resolveSpeedsterMapAuthority, type SpeedsterMapAuthorityDependencies } from "../../../../../../lib/server/speedsterMapAuthority";

type Dependencies = SpeedsterMapAuthorityDependencies & Readonly<{
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
}>;

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (sessionId, adminId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId: adminId },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      capture: true,
      updatedAt: true,
    },
  }),
  loadEffectiveMap: loadEffectiveActiveSpeedsterMapRevision,
  persistEvidence: async (session, adminId, event) => {
    const capture = appendSpeedsterMapAuthorityEvidence(session.capture, event) as Prisma.InputJsonValue;
    const updated = await prisma.aiGraderV2Session.updateMany({
      where: {
        id: session.id,
        createdByUserId: adminId,
        workflowState: "DRAFT",
        updatedAt: session.updatedAt,
      },
      data: { capture },
    });
    if (updated.count !== 1) return null;
    return prisma.aiGraderV2Session.findFirst({
      where: { id: session.id, createdByUserId: adminId },
      select: {
        id: true,
        createdByUserId: true,
        cardProfile: true,
        workflowState: true,
        identity: true,
        capture: true,
        updatedAt: true,
      },
    });
  },
};

export function createSpeedsterMapAuthorityHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      const admin = await deps.requireAdminSession(req);
      const raw = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
      const result = await resolveSpeedsterMapAuthority(deps, { sessionId: typeof raw === "string" ? raw : "",
        createdByUserId: admin.user.id, body: req.body ?? {} });
      return res.status(result.status).json(result.body);
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterMapAuthorityHandler();
