import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";

import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import {
  insertSpeedsterInstrumentationEvents,
  type SpeedsterInstrumentationEvent,
} from "../../../../../../lib/server/aiGraderV2Instrumentation";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const eventType = z.enum([
  "FIRST_SPEEDSTER_INTERACTION",
  "DRAFT_CREATED",
  "PHOTOS_READY",
  "GEOMETRY_PROPOSED",
  "GEOMETRY_CONFIRMED",
  "CENTERING_CONFIRMED",
  "CAPTURE_SAVED",
  "SAM_MEMORY_COMPLETED",
  "REVIEW_RENDERED",
  "REVIEW_ACTION_COMPLETED",
  "GRADE_COMPLETION_REQUESTED",
  "GRADE_COMPLETION_RESPONSE",
  "MEMORY_READY",
  "NEXT_READY_RENDERED",
  "NEXT_CARD_SELECTED",
  "POST_CYCLE_WORK_STARTED",
  "WORKFLOW_ERROR",
]);
const details = z.object({
  side: z.enum(["FRONT", "BACK"]).optional(),
  findingIds: z.array(z.string().trim().min(1).max(180)).max(64).optional(),
  actionType: z.enum(["REMOVE", "UNDO", "TRACE_SAVE", "CHANGE_TYPE", "SMART_MARK"]).optional(),
  startBasis: z.literal("FIRST_SPEEDSTER_INTERACTION").optional(),
  lowerBound: z.boolean().optional(),
  automaticGeometryCount: z.number().int().min(0).max(2).optional(),
  photoSource: z.enum(["IPHONE", "LOCAL", "MIXED"]).optional(),
  mapAppliedScope: z.enum(["EXACT", "FAMILY", "NONE"]).optional(),
  mapName: z.string().trim().min(1).max(1024).optional(),
  mapRevisionId: z.string().trim().min(1).max(80).optional(),
  mapFailureCode: z.enum(["LOOKUP_FAILED", "REGISTRATION_FAILED"]).optional(),
  findingCount: z.number().int().min(0).max(2048).optional(),
  filteredCount: z.number().int().min(0).max(2048).optional(),
  retryCount: z.number().int().min(0).max(1).optional(),
  retrySide: z.enum(["FRONT", "BACK"]).optional(),
  retryRequestId: z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9:._-]+$/).optional(),
  outcome: z.enum(["SUCCEEDED", "FAILED"]).optional(),
  postCycleWork: z.enum(["PHOTOROOM", "COMPS", "NFC"]).optional(),
  errorCode: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_:-]+$/).optional(),
}).strict();
const bodySchema = z.object({
  eventId: z.string().uuid(),
  eventType,
  clientStartedAt: z.string().datetime({ offset: true }),
  clientEndedAt: z.string().datetime({ offset: true }),
  details: details.optional(),
}).strict();

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findOwnedSession: (sessionId: string, createdByUserId: string) => Promise<{ id: string } | null>;
  insertEvents: (events: readonly SpeedsterInstrumentationEvent[]) => Promise<number>;
  now: () => Date;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findOwnedSession: (sessionId, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id: sessionId, createdByUserId },
    select: { id: true },
  }),
  insertEvents: (events) => insertSpeedsterInstrumentationEvents(prisma, events),
  now: () => new Date(),
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

export function createSpeedsterInstrumentationHandler(deps: Dependencies = dependencies) {
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
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid Speedster instrumentation event" });
      const session = await deps.findOwnedSession(sessionId, admin.user.id);
      if (!session) return res.status(404).json({ message: "Speedster session not found" });

      const startedAt = new Date(parsed.data.clientStartedAt);
      const endedAt = new Date(parsed.data.clientEndedAt);
      const durationMs = endedAt.getTime() - startedAt.getTime();
      const nowMs = deps.now().getTime();
      if (
        durationMs < 0 || durationMs > 12 * 60 * 60 * 1000 ||
        endedAt.getTime() > nowMs + 5 * 60 * 1000 ||
        startedAt.getTime() < nowMs - 24 * 60 * 60 * 1000
      ) {
        return res.status(400).json({ message: "Invalid Speedster instrumentation time range" });
      }

      const inserted = await deps.insertEvents([{
        eventKey: `${sessionId}:client:${parsed.data.eventId}`,
        sessionId,
        createdByUserId: admin.user.id,
        category: "CLIENT_TIMING",
        eventType: parsed.data.eventType,
        clientStartedAt: startedAt,
        clientEndedAt: endedAt,
        durationMs,
        details: parsed.data.details ?? {},
      }]);
      return res.status(inserted === 0 ? 200 : 201).json({ ok: true, duplicate: inserted === 0 });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createSpeedsterInstrumentationHandler();
