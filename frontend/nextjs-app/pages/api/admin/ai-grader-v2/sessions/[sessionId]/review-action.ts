import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { applySpeedsterReviewAction, type SpeedsterReviewActionDependencies } from "../../../../../../lib/server/aiGraderV2ReviewAction";
import { findSpeedsterPersistedTrace, parsePersistedSpeedsterReviewFindings } from "../../../../../../lib/ai-grader-v2/review-findings";
import { encodeSpeedsterTraceBitmapWireV1 } from "../../../../../../lib/ai-grader-v2/trace-bitmap-wire";
import { decodeSpeedsterTraceRleV1 } from "../../../../../../lib/ai-grader-v2/trace-codec";
import { speedsterReviewPostSchema as postSchema } from "../../../../../../lib/ai-grader-v2/review-action-contract";
import { createSpeedsterReviewDependencies } from "../../../../../../lib/server/speedsterReviewDependencies";
export { fetchSpeedsterDetectUpstream, assertSpeedsterDetectionRuntimeAuthority } from "../../../../../../lib/server/speedsterReviewDependencies";
const SESSION_ID = /^[a-z0-9-]{20,40}$/i;

type HandlerDependencies = SpeedsterReviewActionDependencies & {
  requireAdminSession: typeof requireAdminSession;
  findOwnedTraces: (sessionId: string, createdByUserId: string) => Promise<{ reviewedDefects: unknown } | null>;
};


const dependencies: HandlerDependencies = {
  ...createSpeedsterReviewDependencies(prisma),
  requireAdminSession,
  findOwnedTraces: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId }, select: { reviewedDefects: true },
  }),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

export function createSpeedsterReviewActionHandler(deps: HandlerDependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST" && req.method !== "GET") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });

      if (req.method === "GET") {
        const findingId = Array.isArray(req.query.findingId) ? req.query.findingId[0] : req.query.findingId;
        if (typeof findingId !== "string" || !findingId.trim()) {
          return res.status(400).json({ message: "Speedster finding ID is required" });
        }
        const row = await deps.findOwnedTraces(sessionId, admin.user.id);
        if (!row) return res.status(404).json({ message: "Speedster session not found" });
        const trace = findSpeedsterPersistedTrace(
          parsePersistedSpeedsterReviewFindings(row.reviewedDefects),
          findingId.trim(),
        );
        if (!trace) return res.status(404).json({ message: "Speedster trace not found" });
        return res.status(200).json({
          traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(trace), trace.sha256),
        });
      }

      const parsed = postSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid Speedster review action" });
      const result = await applySpeedsterReviewAction({
        sessionId,
        createdByUserId: admin.user.id,
        action: parsed.data.action,
      }, deps);
      return res.status(200).json(result);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return res.status(mapped.status).json({ message: mapped.message });
    }
  };
}

export default createSpeedsterReviewActionHandler();
