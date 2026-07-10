import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderPublicReportApiHandler } from "../../../../lib/server/aiGraderProductionApi";
import { mergeAiGraderPublishedReportReadData } from "../../../../lib/server/aiGraderPublicReportRead";
import { publicUrlFor, readStorageBuffer } from "../../../../lib/server/storage";

async function readPublishedBundle(reportId: string) {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      reportId: true,
      publicationStatus: true,
      reportBundleStorageKey: true,
      productionReleaseStorageKey: true,
      labelDataStorageKey: true,
      evidenceAssets: {
        where: { artifactClass: "slabbed_photo" },
        select: {
          artifactId: true,
          kind: true,
          side: true,
          publicUrl: true,
          storageKey: true,
          checksumSha256: true,
          mimeType: true,
          byteSize: true,
        },
      },
      valuations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          status: true,
          source: true,
          searchQuery: true,
          valuationMinor: true,
          valuationCurrency: true,
          compsRefs: true,
          resultSummary: true,
          completedAt: true,
        },
      },
    },
  });
  if (!report || report.publicationStatus !== "published" || !report.reportBundleStorageKey) return null;
  const raw = await readStorageBuffer(report.reportBundleStorageKey).catch(() => null);
  if (!raw) return null;
  const bundle = JSON.parse(raw.toString("utf8"));
  if (bundle?.schemaVersion === "ai-grader-report-bundle-v0.2") {
    return mergeAiGraderPublishedReportReadData(bundle, {});
  }
  let productionRelease = bundle.productionRelease;
  if (report.productionReleaseStorageKey) {
    const releaseRaw = await readStorageBuffer(report.productionReleaseStorageKey).catch(() => null);
    if (releaseRaw) {
      productionRelease = JSON.parse(releaseRaw.toString("utf8"));
    }
  }
  let labelData = null;
  if (report.labelDataStorageKey) {
    const labelRaw = await readStorageBuffer(report.labelDataStorageKey).catch(() => null);
    if (labelRaw) {
      labelData = JSON.parse(labelRaw.toString("utf8"));
    }
  }
  const slabbedPhotos = Array.isArray(report.evidenceAssets) ? report.evidenceAssets : [];
  const valuation = Array.isArray(report.valuations) ? report.valuations[0] ?? null : null;
  return mergeAiGraderPublishedReportReadData(bundle, {
    productionRelease,
    labelData,
    slabbedPhotos,
    valuation,
  });
}

export default createAiGraderPublicReportApiHandler({
  readPublishedBundle,
  publicUrlFor,
});
