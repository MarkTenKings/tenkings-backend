import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";

import {
  projectLearningBlueprintComparison,
  SPEEDSTER_LEARNING_BLUEPRINT_MAX_EVENTS,
  SPEEDSTER_LEARNING_BLUEPRINT_MAX_FILTERED_FINDINGS,
  type LearningBlueprintCompletionLabel,
  type LearningBlueprintEventRow,
  type LearningBlueprintGeometryRow,
  type LearningBlueprintMapFilterRow,
  type LearningBlueprintSessionRow,
} from "../../../../../lib/server/speedsterLearningBlueprint";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { presignReadUrl } from "../../../../../lib/server/storage";
import { nonVoidSpeedsterCardFilter } from "../../../../../lib/server/tenKingsV2PublicReport";

const SESSION_ID = /^[A-Za-z0-9_-]{10,100}$/;
const EVENT_TYPES = [
  "FINDING_PROPOSED",
  "FINDING_REVIEWED",
  "RAW_DETECTOR_CANDIDATE_PRESERVED",
  "MEMORY_LESSON_SCAN_VERDICTS_RECORDED",
  "PHYSICAL_GEOMETRY_LESSON_SCAN_VERDICTS_RECORDED",
] as const;

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<unknown>;
  findSessions: (sessionIds: readonly string[]) => Promise<LearningBlueprintSessionRow[]>;
  findLabels: (sessionIds: readonly string[]) => Promise<LearningBlueprintCompletionLabel[]>;
  findGeometry: (sessionIds: readonly string[]) => Promise<LearningBlueprintGeometryRow[]>;
  findEvents: (sessionIds: readonly string[], take: number) => Promise<LearningBlueprintEventRow[]>;
  findFiltered: (sessionIds: readonly string[], take: number) => Promise<LearningBlueprintMapFilterRow[]>;
  presignRead: (storageKey: string, expiresInSeconds: number) => Promise<string>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSessions: (sessionIds) => prisma.aiGraderV2Session.findMany({
    where: {
      id: { in: [...sessionIds] },
      workflowState: "COMPLETED",
      ...nonVoidSpeedsterCardFilter,
    },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      identity: true,
      capture: true,
      reviewedDefects: true,
      gradeReport: true,
      mapRevisionId: true,
      mapRevision: { select: { mapId: true } },
      createdAt: true,
    },
  }),
  findLabels: (sessionIds) => prisma.humanGradeLabel.findMany({
    where: { source: "SPEEDSTER", sourceSessionId: { in: [...sessionIds] } },
    select: { sourceSessionId: true, certificateSequence: true, createdAt: true },
  }),
  findGeometry: (sessionIds) => prisma.aiGraderV2ColorGeometryEvidence.findMany({
    where: { sessionId: { in: [...sessionIds] } },
    orderBy: [{ sessionId: "asc" }, { side: "asc" }, { mode: "asc" }],
    select: {
      id: true,
      sessionId: true,
      createdByUserId: true,
      side: true,
      mode: true,
      matColor: true,
      outcome: true,
      engineVersion: true,
      policyProvenance: true,
      sourceImageSha256: true,
      proposal: true,
      confirmedQuad: true,
      diagnostics: true,
      proposalChanged: true,
      createdAt: true,
    },
  }),
  findEvents: (sessionIds, take) => prisma.aiGraderV2InstrumentationEvent.findMany({
    where: { sessionId: { in: [...sessionIds] }, eventType: { in: [...EVENT_TYPES] } },
    orderBy: [{ createdAt: "asc" }, { eventKey: "asc" }],
    take,
    select: {
      eventKey: true,
      sessionId: true,
      createdByUserId: true,
      category: true,
      eventType: true,
      findingId: true,
      details: true,
      createdAt: true,
    },
  }),
  findFiltered: (sessionIds, take) => prisma.aiGraderV2MapFilterDecision.findMany({
    where: { sessionId: { in: [...sessionIds] } },
    orderBy: [{ filteredAt: "asc" }, { id: "asc" }],
    take,
    select: {
      sessionId: true,
      findingId: true,
      side: true,
      findingSnapshot: true,
      restoreEvent: { select: { outcome: true } },
    },
  }),
  presignRead: presignReadUrl,
};

function setPrivateNoStore(res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Cookie, Authorization");
}

function queryText(req: NextApiRequest, key: string) {
  const value = req.query[key];
  return Array.isArray(value) ? value[0] : value;
}

export function createLearningBlueprintCompareHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    setPrivateNoStore(res);
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      await deps.requireAdminSession(req);
      const firstSessionId = queryText(req, "firstSessionId");
      const secondSessionId = queryText(req, "secondSessionId");
      if (!firstSessionId || !secondSessionId || firstSessionId === secondSessionId
        || !SESSION_ID.test(firstSessionId) || !SESSION_ID.test(secondSessionId)) {
        return res.status(400).json({ message: "Select exactly two different completed Speedster cards" });
      }
      const sessionIds = [firstSessionId, secondSessionId] as const;
      const [sessions, labels, geometry, events, filtered] = await Promise.all([
        deps.findSessions(sessionIds),
        deps.findLabels(sessionIds),
        deps.findGeometry(sessionIds),
        deps.findEvents(sessionIds, SPEEDSTER_LEARNING_BLUEPRINT_MAX_EVENTS + 1),
        deps.findFiltered(sessionIds, SPEEDSTER_LEARNING_BLUEPRINT_MAX_FILTERED_FINDINGS + 1),
      ]);
      if (sessions.length !== 2) {
        return res.status(404).json({ message: "Completed Speedster cards not found" });
      }
      if (events.length > SPEEDSTER_LEARNING_BLUEPRINT_MAX_EVENTS) {
        return res.status(422).json({ message: "Learning Blueprint evidence exceeds its safe event bound" });
      }
      if (filtered.length > SPEEDSTER_LEARNING_BLUEPRINT_MAX_FILTERED_FINDINGS) {
        return res.status(422).json({ message: "Learning Blueprint evidence exceeds its safe filtered-finding bound" });
      }
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const labelById = new Map(labels.flatMap((label) => label.sourceSessionId
        ? [[label.sourceSessionId, label] as const]
        : []));
      const first = sessionById.get(firstSessionId);
      const second = sessionById.get(secondSessionId);
      const firstLabel = labelById.get(firstSessionId);
      const secondLabel = labelById.get(secondSessionId);
      if (!first || !second || !firstLabel || !secondLabel) {
        return res.status(409).json({ message: "Completed Speedster cards are missing completion authority" });
      }
      try {
        const comparison = await projectLearningBlueprintComparison({
          first,
          second,
          firstLabel,
          secondLabel,
          geometry,
          events,
          filtered,
          presignRead: deps.presignRead,
        });
        return res.status(200).json(comparison);
      } catch (error) {
        if (error instanceof Error && error.message.includes("safe response budget")) {
          return res.status(422).json({ message: error.message });
        }
        throw error;
      }
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createLearningBlueprintCompareHandler();
