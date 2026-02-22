import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type SetRow = {
  setId: string;
  lastSeedStatus: string | null;
  lastSeedAt: string | null;
  variantCount: number;
};

type ResponseBody = { sets: SetRow[]; total: number } | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60) || 60));
    const q = String(req.query.q ?? "").trim().toLowerCase();

    const recentSeedJobs = await prisma.setSeedJob.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: Math.max(limit * 20, 400),
      select: {
        status: true,
        createdAt: true,
        draft: {
          select: { setId: true },
        },
      },
    });

    const bySet = new Map<string, { lastSeedStatus: string | null; lastSeedAt: Date | null }>();
    const orderedSetIds: string[] = [];

    for (const job of recentSeedJobs) {
      const setId = String(job.draft?.setId || "").trim();
      if (!setId) continue;
      const key = setId.toLowerCase();
      if (q && !key.includes(q)) continue;
      if (!bySet.has(setId)) {
        bySet.set(setId, {
          lastSeedStatus: job.status ?? null,
          lastSeedAt: job.createdAt ?? null,
        });
        orderedSetIds.push(setId);
      }
      if (orderedSetIds.length >= limit) break;
    }

    if (orderedSetIds.length < limit) {
      const variantSetCounts = await prisma.cardVariant.groupBy({
        by: ["setId"],
        _count: { _all: true },
      });
      const sortedSetIds = variantSetCounts
        .map((row) => String(row.setId || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      for (const setId of sortedSetIds) {
        if (orderedSetIds.length >= limit) break;
        const key = setId.toLowerCase();
        if (q && !key.includes(q)) continue;
        if (!bySet.has(setId)) {
          bySet.set(setId, { lastSeedStatus: null, lastSeedAt: null });
          orderedSetIds.push(setId);
        }
      }
    }

    const finalSetIds = orderedSetIds.slice(0, limit);
    const counts =
      finalSetIds.length > 0
        ? await prisma.cardVariant.groupBy({
            by: ["setId"],
            where: {
              setId: {
                in: finalSetIds,
              },
            },
            _count: { _all: true },
          })
        : [];
    const countBySetId = new Map<string, number>();
    for (const row of counts) {
      countBySetId.set(row.setId, row._count._all);
    }

    const sets = finalSetIds.map((setId) => {
      const meta = bySet.get(setId);
      return {
        setId,
        lastSeedStatus: meta?.lastSeedStatus ?? null,
        lastSeedAt: meta?.lastSeedAt ? meta.lastSeedAt.toISOString() : null,
        variantCount: countBySetId.get(setId) ?? 0,
      } satisfies SetRow;
    });

    return res.status(200).json({ sets, total: sets.length });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
