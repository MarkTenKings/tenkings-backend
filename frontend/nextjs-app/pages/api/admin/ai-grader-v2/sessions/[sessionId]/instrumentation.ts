import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";

import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import {
  insertSpeedsterInstrumentationEventWithConflictDetection,
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
  "MAP_REGISTRATION_OPERATOR_DECISION",
  "MAP_AUTHORITY_OPERATOR_DECISION",
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
  registrationDecision: z.enum(["RETRY_FAILED_SIDE", "CONTINUE_WITHOUT_CARD_MAP"]).optional(),
  mapAuthorityDecision: z.literal("ABANDON_OBSOLETE_MAP_AUTHORITY").optional(),
  mapAuthorityOperationId: z.string().uuid().optional(),
  mapAuthorityDecisionId: z.string().uuid().optional(),
  obsoleteMapBindingStatus: z.enum(["LOADED", "NO_MAP", "LOOKUP_FAILED", "INTEGRITY_ERROR"]).optional(),
  obsoleteMapRevisionId: z.string().trim().min(1).max(80).optional(),
  obsoleteMapScope: z.enum(["EXACT", "FAMILY"]).optional(),
  obsoleteMapName: z.string().trim().min(1).max(1024).optional(),
  registrationErrorSource: z.enum([
    "PROVIDER_GATEWAY",
    "PROVIDER",
    "PROVIDER_NETWORK",
    "TEN_KINGS_API",
    "CLIENT_NETWORK",
    "CLIENT_PROTOCOL",
    "HUMAN_CORRECTION",
  ]).optional(),
  registrationErrorCode: z.string().trim().min(1).max(100).regex(/^[A-Z0-9_:-]+$/).optional(),
  registrationHttpStatus: z.number().int().min(100).max(599).optional(),
  registrationRequestId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9-]+$/).optional(),
  registrationFailedSides: z.array(z.enum(["FRONT", "BACK"])).min(1).max(2).refine(
    (sides) => new Set(sides).size === sides.length,
  ).optional(),
  registrationOperationId: z.string().uuid().optional(),
  registrationDecisionId: z.string().uuid().optional(),
  registrationFailures: z.array(z.object({
    side: z.enum(["FRONT", "BACK"]),
    source: z.enum([
      "PROVIDER_GATEWAY", "PROVIDER", "PROVIDER_NETWORK", "TEN_KINGS_API",
      "CLIENT_NETWORK", "CLIENT_PROTOCOL", "HUMAN_CORRECTION",
    ]),
    code: z.string().trim().min(1).max(100).regex(/^[A-Z0-9_:-]+$/),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    requestId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9-]+$/).optional(),
  }).strict()).min(1).max(2).refine(
    (failures) => new Set(failures.map(({ side }) => side)).size === failures.length,
  ).optional(),
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
}).strict().superRefine((value, context) => {
  if (value.eventType === "MAP_REGISTRATION_OPERATOR_DECISION") {
    if (!value.details?.registrationDecision
      || !value.details.registrationOperationId
      || !value.details.registrationDecisionId
      || !value.details.registrationFailedSides
      || !value.details.registrationFailures
      || value.details.registrationFailedSides.join("\0")
        !== value.details.registrationFailures.map(({ side }) => side).join("\0")
      || value.eventId !== value.details.registrationDecisionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registration decisions require stable matching operation and decision identity.",
      });
    }
    return;
  }
  if (value.eventType === "MAP_AUTHORITY_OPERATOR_DECISION") {
    const details = value.details;
    const loadedObsoleteMap = details?.obsoleteMapBindingStatus === "LOADED";
    if (details?.mapAuthorityDecision !== "ABANDON_OBSOLETE_MAP_AUTHORITY"
      || !details.mapAuthorityOperationId
      || !details.mapAuthorityDecisionId
      || value.eventId !== details.mapAuthorityDecisionId
      || details.mapAppliedScope !== "NONE"
      || !details.obsoleteMapBindingStatus
      || (loadedObsoleteMap
        ? (!details.obsoleteMapRevisionId || !details.obsoleteMapScope)
        : Boolean(details.obsoleteMapRevisionId || details.obsoleteMapScope))
      || details.registrationDecision !== undefined
      || details.registrationOperationId !== undefined
      || details.registrationDecisionId !== undefined
      || details.registrationFailedSides !== undefined
      || details.registrationFailures !== undefined
      || details.mapFailureCode !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Map-authority decisions require stable identity, exact obsolete binding, and no fabricated registration failure.",
      });
    }
  }
});

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
  insertEvents: async (events) => {
    if (events.length === 1 && [
      "MAP_REGISTRATION_OPERATOR_DECISION",
      "MAP_AUTHORITY_OPERATOR_DECISION",
    ].includes(events[0].eventType)) {
      return insertSpeedsterInstrumentationEventWithConflictDetection(prisma, events[0]);
    }
    return insertSpeedsterInstrumentationEvents(prisma, events);
  },
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
