import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import {
  buildSpeedsterColorGeometryScoreFromAggregates,
  type SpeedsterColorGeometryScoreAggregateRow,
  type SpeedsterColorGeometryScoreRow,
} from "../../../../lib/ai-grader-v2/color-geometry-score";

const RECENT_CARD_LIMIT = 20;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }
  try {
    const admin = await requireAdminSession(req);
    const [aggregateRows, recentSessions] = await Promise.all([
      prisma.aiGraderV2ColorGeometryEvidence.groupBy({
        by: ["side", "matColor", "outcome", "proposalChanged"],
        where: { createdByUserId: admin.user.id },
        _count: { _all: true },
      }),
      prisma.aiGraderV2ColorGeometryEvidence.groupBy({
        by: ["sessionId"],
        where: { createdByUserId: admin.user.id },
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: RECENT_CARD_LIMIT,
      }),
    ]);
    const recentRows = recentSessions.length ? await prisma.aiGraderV2ColorGeometryEvidence.findMany({
      where: {
        createdByUserId: admin.user.id,
        sessionId: { in: recentSessions.map(({ sessionId }) => sessionId) },
      },
      orderBy: [{ createdAt: "desc" }, { sessionId: "desc" }, { side: "asc" }, { mode: "asc" }],
      select: {
        sessionId: true,
        side: true,
        mode: true,
        matColor: true,
        outcome: true,
        proposalChanged: true,
        createdAt: true,
        session: { select: { cardProfile: true, identity: true } },
      },
    }) : [];
    const scoreAggregates = aggregateRows.map(({ _count, ...row }) => ({
      ...row,
      count: _count._all,
    })) as SpeedsterColorGeometryScoreAggregateRow[];
    return res.status(200).json({
      score: buildSpeedsterColorGeometryScoreFromAggregates(
        scoreAggregates,
        recentRows as SpeedsterColorGeometryScoreRow[],
        RECENT_CARD_LIMIT,
      ),
    });
  } catch (error) {
    const mapped = toErrorResponse(error);
    return res.status(mapped.status).json({ message: mapped.message });
  }
}
