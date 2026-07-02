import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderPublicReportApiHandler } from "../../../../lib/server/aiGraderProductionApi";
import { readStorageBuffer } from "../../../../lib/server/storage";

async function readPublishedBundle(reportId: string) {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      reportId: true,
      publicationStatus: true,
      reportBundleStorageKey: true,
    },
  });
  if (!report || report.publicationStatus !== "published" || !report.reportBundleStorageKey) return null;
  const raw = await readStorageBuffer(report.reportBundleStorageKey);
  return JSON.parse(raw.toString("utf8"));
}

export default createAiGraderPublicReportApiHandler({
  readPublishedBundle,
});
