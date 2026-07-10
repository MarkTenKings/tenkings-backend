import { sanitizeAiGraderPublicReportBundleForRead } from "@tenkings/database";
import { mergeAiGraderPublishedReportReadData } from "./aiGraderPublicReportRead";
import { publicUrlFor, readStorageBuffer } from "./storage";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStoredJson(value: Buffer | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value.toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Loads the persisted, publication-scoped bundle and applies only the legacy
 * enrichments that the existing public API exposes. It deliberately returns
 * untrusted JSON; callers that render it must use the sanitized reader below.
 */
export async function readAiGraderPublishedBundle(reportId: string): Promise<JsonRecord | null> {
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

  const bundle = parseStoredJson(await readStorageBuffer(report.reportBundleStorageKey).catch(() => null));
  if (!bundle) return null;
  if (bundle.schemaVersion === "ai-grader-report-bundle-v0.2") {
    return mergeAiGraderPublishedReportReadData(bundle, {});
  }

  let productionRelease = bundle.productionRelease;
  if (report.productionReleaseStorageKey) {
    productionRelease = parseStoredJson(await readStorageBuffer(report.productionReleaseStorageKey).catch(() => null)) ?? productionRelease;
  }
  let labelData: JsonRecord | null = null;
  if (report.labelDataStorageKey) {
    labelData = parseStoredJson(await readStorageBuffer(report.labelDataStorageKey).catch(() => null));
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

/**
 * The only server data source that cinematic SSR may serialize to the browser.
 * It mirrors the public API sanitizer so local paths, signed URLs, bodies,
 * credentials, and hardware controls cannot cross the page boundary.
 */
export async function readAiGraderPublicReportBundle(reportId: string): Promise<JsonRecord | null> {
  const bundle = await readAiGraderPublishedBundle(reportId);
  if (!bundle) return null;
  const sanitized = sanitizeAiGraderPublicReportBundleForRead(bundle, {
    expectedReportId: reportId,
    publicUrlFor,
  });
  return isRecord(sanitized) ? sanitized : null;
}
