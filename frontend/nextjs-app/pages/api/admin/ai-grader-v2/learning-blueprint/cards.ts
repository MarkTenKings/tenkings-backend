import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";

import {
  projectLearningBlueprintCard,
  SPEEDSTER_LEARNING_BLUEPRINT_PAGE_SIZE,
  SPEEDSTER_LEARNING_BLUEPRINT_VERSION,
  type LearningBlueprintCompletionLabel,
  type LearningBlueprintSessionRow,
} from "../../../../../lib/server/speedsterLearningBlueprint";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { nonVoidSpeedsterCardFilter } from "../../../../../lib/server/tenKingsV2PublicReport";

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<unknown>;
  listLabels: (beforeCompletionOrder: number | null, take: number) => Promise<LearningBlueprintCompletionLabel[]>;
  listSessions: (sessionIds: readonly string[]) => Promise<LearningBlueprintSessionRow[]>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  listLabels: (beforeCompletionOrder, take) => prisma.$queryRaw<LearningBlueprintCompletionLabel[]>(Prisma.sql`
    SELECT
      label."sourceSessionId",
      label."certificateSequence",
      label."createdAt"
    FROM "HumanGradeLabel" AS label
    INNER JOIN "AiGraderV2Session" AS session
      ON session."id" = label."sourceSessionId"
    LEFT JOIN "CollectibleCardV2" AS card
      ON card."speedsterSessionId" = session."id"
    WHERE label."source"::text = 'SPEEDSTER'
      AND label."sourceSessionId" IS NOT NULL
      AND session."workflowState" = 'COMPLETED'
      AND (card."id" IS NULL OR card."lifecycleState"::text <> 'VOID')
      ${beforeCompletionOrder === null
        ? Prisma.empty
        : Prisma.sql`AND label."certificateSequence" < ${beforeCompletionOrder}`}
    ORDER BY label."certificateSequence" DESC
    LIMIT ${take}
  `),
  listSessions: async (sessionIds) => {
    if (sessionIds.length === 0) return [];
    const rows = await prisma.aiGraderV2Session.findMany({
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
        colorGeometryEvidence: {
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
        },
      },
    });
    return rows.map(({ colorGeometryEvidence, ...session }) => ({
      ...session,
      geometry: colorGeometryEvidence,
    }));
  },
};

function setPrivateNoStore(res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Cookie, Authorization");
}

function cursorFrom(req: NextApiRequest) {
  const raw = Array.isArray(req.query.beforeCompletionOrder)
    ? req.query.beforeCompletionOrder[0]
    : req.query.beforeCompletionOrder;
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function createLearningBlueprintCardsHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    setPrivateNoStore(res);
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      await deps.requireAdminSession(req);
      const cursor = cursorFrom(req);
      if (cursor === undefined) {
        return res.status(400).json({ message: "Invalid completion cursor" });
      }
      const labels = await deps.listLabels(cursor, SPEEDSTER_LEARNING_BLUEPRINT_PAGE_SIZE + 1);
      const pageLabels = labels.slice(0, SPEEDSTER_LEARNING_BLUEPRINT_PAGE_SIZE);
      const sessions = await deps.listSessions(pageLabels.flatMap(({ sourceSessionId }) => sourceSessionId ? [sourceSessionId] : []));
      const byId = new Map(sessions.map((session) => [session.id, session]));
      const cards = pageLabels.flatMap((label) => {
        const session = label.sourceSessionId ? byId.get(label.sourceSessionId) : undefined;
        return session ? [projectLearningBlueprintCard(session, label)] : [];
      });
      return res.status(200).json({
        version: SPEEDSTER_LEARNING_BLUEPRINT_VERSION,
        cards,
        nextCursor: labels.length > SPEEDSTER_LEARNING_BLUEPRINT_PAGE_SIZE
          ? pageLabels.at(-1)?.certificateSequence ?? null
          : null,
      });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createLearningBlueprintCardsHandler();
