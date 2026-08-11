import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";

import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { HttpError } from "../../../../../../lib/server/adminSessionAuthority";
import {
  insertSpeedsterInstrumentationEvents,
  speedsterServerTimingEvent,
  type SpeedsterInstrumentationEvent,
} from "../../../../../../lib/server/aiGraderV2Instrumentation";
import { completeSpeedsterPresentationImages } from "../../../../../../lib/server/aiGraderV2PresentationWorkflow";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  completePresentation: (input: { sessionId: string; createdByUserId: string }) => Promise<unknown>;
  insertEvents: (events: readonly SpeedsterInstrumentationEvent[]) => Promise<number>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  completePresentation: completeSpeedsterPresentationImages,
  insertEvents: (events) => insertSpeedsterInstrumentationEvents(prisma, events),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

async function recordPresentationFailOpen(
  deps: Dependencies,
  input: {
    sessionId: string;
    createdByUserId: string;
    startedAt: number;
    outcome: "SUCCEEDED" | "FAILED";
  },
) {
  try {
    await deps.insertEvents([speedsterServerTimingEvent({
      eventKey: `${input.sessionId}:server:presentation:${input.startedAt}:${input.outcome.toLowerCase()}`,
      sessionId: input.sessionId,
      createdByUserId: input.createdByUserId,
      eventType: "PHOTOROOM_POST_CYCLE",
      durationMs: Date.now() - input.startedAt,
      details: { outcome: input.outcome, cycleClassification: "POST_CYCLE" },
    })]);
  } catch (error) {
    console.error(`[Speedster] Presentation instrumentation failed for ${input.sessionId}:`, error);
  }
}

export function createSpeedsterPresentationHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      const startedAt = Date.now();
      try {
        await deps.completePresentation({ sessionId, createdByUserId: admin.user.id });
        await recordPresentationFailOpen(deps, {
          sessionId,
          createdByUserId: admin.user.id,
          startedAt,
          outcome: "SUCCEEDED",
        });
        return res.status(200).json({ ok: true, cycleClassification: "POST_CYCLE" });
      } catch (error) {
        await recordPresentationFailOpen(deps, {
          sessionId,
          createdByUserId: admin.user.id,
          startedAt,
          outcome: "FAILED",
        });
        console.error(`[Speedster] Post-cycle presentation failed for ${sessionId}:`, error);
        throw new HttpError(502, "Post-cycle Speedster presentation images failed.");
      }
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterPresentationHandler();
