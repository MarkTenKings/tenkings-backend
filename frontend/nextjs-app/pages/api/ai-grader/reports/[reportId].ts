import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderPublicReportApiHandler } from "../../../../lib/server/aiGraderProductionApi";
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
  return {
    ...bundle,
    ...(productionRelease
      ? {
          productionRelease: {
            ...productionRelease,
            ...(labelData ? { label: { ...(productionRelease.label ?? {}), ...labelData } } : {}),
            slabbedPhotoContract: {
              ...(productionRelease.slabbedPhotoContract ?? {}),
              status: slabbedPhotos.length ? "uploaded" : productionRelease.slabbedPhotoContract?.status ?? "reserved_not_uploaded",
              photos: slabbedPhotos,
            },
            ebayCompsContract: {
              ...(productionRelease.ebayCompsContract ?? {}),
              status: valuation?.status ?? productionRelease.ebayCompsContract?.status ?? "not_run",
              searchQuery: valuation?.searchQuery ?? productionRelease.ebayCompsContract?.searchQuery,
              valuationMinor: valuation?.valuationMinor ?? productionRelease.ebayCompsContract?.valuationMinor,
              valuationCurrency: valuation?.valuationCurrency ?? productionRelease.ebayCompsContract?.valuationCurrency,
              compsRefs: valuation?.compsRefs ?? productionRelease.ebayCompsContract?.compsRefs ?? [],
              resultSummary: valuation?.resultSummary ?? productionRelease.ebayCompsContract?.resultSummary,
            },
          },
          finalGradeComputed: productionRelease.finalGradeComputed === true,
          labelGenerated: productionRelease.labelDataGenerated === true,
          qrGenerated: productionRelease.qrPayloadGenerated === true,
          reportStatus: productionRelease.reportStatus ?? bundle.reportStatus,
          finalStatus: productionRelease.finalStatus ?? bundle.finalStatus,
        }
      : {}),
  };
}

export default createAiGraderPublicReportApiHandler({
  readPublishedBundle,
  publicUrlFor,
});
