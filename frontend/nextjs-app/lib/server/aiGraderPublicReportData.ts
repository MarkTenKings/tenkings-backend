import {
  AI_GRADER_PUBLIC_OPAQUE_EVIDENCE_CONTENT_TYPES,
  aiGraderSha256,
  sanitizeAiGraderPublicReportBundleForRead,
} from "@tenkings/database";
import {
  aiGraderSafePublishedUrlSchema,
  isSafeAiGraderPublicAssetId,
} from "@tenkings/shared";
import { mergeAiGraderPublishedReportReadData } from "./aiGraderPublicReportRead";
import { publicUrlFor, readStorageBuffer } from "./storage";
import {
  aiGraderReportEditorialRevisionFromGradeStory,
  type AiGraderReportEditorialRevisionV1,
} from "../aiGraderReportRevision";

type JsonRecord = Record<string, unknown>;

export type AiGraderPublicReportEnrichment = {
  linkage: { cardAssetId?: string; itemId?: string };
  slabbedPhotos: Array<{
    artifactId: string;
    kind: string;
    side?: "front" | "back";
    publicUrl: string;
    checksumSha256: string;
    mimeType: string;
    byteSize: number;
  }>;
  valuation: {
    status: string;
    searchQuery?: string;
    valuationMinor?: number;
    valuationCurrency?: string;
    resultSummary?: string;
    comps: Array<{ title: string; url?: string; price?: string }>;
  } | null;
};

export type AiGraderPublicOpaqueEvidence = {
  bytes: Buffer;
  contentType: (typeof AI_GRADER_PUBLIC_OPAQUE_EVIDENCE_CONTENT_TYPES)[number];
  fileName: string;
  checksumSha256: string;
};

export type AiGraderPublicReportPresentation =
  | {
      reportVisibility: "public";
      editorialRevision: AiGraderReportEditorialRevisionV1 | null;
    }
  | {
      reportVisibility: "coming_soon";
      editorialRevision: null;
    };

export class AiGraderPublicReportPresentationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AiGraderPublicReportPresentationError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasValidOperatorRevisionAuditHead(
  value: unknown,
  revision: AiGraderReportEditorialRevisionV1,
) {
  return isRecord(value) &&
    value.schemaVersion === "ten-kings-ai-grader-report-editor-audit-head-v1" &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= revision.revision &&
    typeof value.headEventId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(value.headEventId) &&
    typeof value.headChecksum === "string" &&
    /^[a-f0-9]{64}$/.test(value.headChecksum) &&
    value.sourceBundleSha256 === revision.sourceBundleSha256;
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

export function safeAiGraderPublicReportUrl(value: unknown): string | undefined {
  const parsed = aiGraderSafePublishedUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Resolves the one persisted presentation state before any report bytes are
 * exposed. An invalid active operator revision is an error, never permission
 * to silently serve the original machine result.
 */
export async function readAiGraderPublicReportPresentation(
  reportId: string,
): Promise<AiGraderPublicReportPresentation | null> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      publicationStatus: true,
      visibilityStatus: true,
      gradeStory: true,
      reportBundleStorageKey: true,
    },
  });
  if (!report || report.publicationStatus !== "published") return null;
  if (report.visibilityStatus === "coming_soon") {
    return { reportVisibility: "coming_soon", editorialRevision: null };
  }
  if (report.visibilityStatus !== "public") return null;
  const story = isRecord(report.gradeStory) ? report.gradeStory : {};
  if (!Object.prototype.hasOwnProperty.call(story, "manualReportRevision")) {
    return { reportVisibility: "public", editorialRevision: null };
  }
  const editorialRevision = aiGraderReportEditorialRevisionFromGradeStory(
    story,
    reportId,
  );
  if (!editorialRevision) {
    throw new AiGraderPublicReportPresentationError(
      "AI_GRADER_OPERATOR_REVIEW_INVALID",
      "The active human-reviewed report revision is invalid. The original machine grade was not substituted.",
    );
  }
  if (!hasValidOperatorRevisionAuditHead(
    story.manualReportRevisionAudit,
    editorialRevision,
  )) {
    throw new AiGraderPublicReportPresentationError(
      "AI_GRADER_OPERATOR_REVIEW_AUDIT_INVALID",
      "The active human-reviewed report revision has no valid audit authority. The original machine grade was not substituted.",
    );
  }
  if (!safeStorageKey(report.reportBundleStorageKey)) {
    throw new AiGraderPublicReportPresentationError(
      "AI_GRADER_OPERATOR_REVIEW_SOURCE_UNAVAILABLE",
      "The active human-reviewed report revision cannot be bound to its source report bundle.",
    );
  }
  const sourceBytes = await readStorageBuffer(report.reportBundleStorageKey).catch(() => null);
  if (!sourceBytes || aiGraderSha256(sourceBytes) !== editorialRevision.sourceBundleSha256) {
    throw new AiGraderPublicReportPresentationError(
      "AI_GRADER_OPERATOR_REVIEW_SOURCE_MISMATCH",
      "The active human-reviewed report revision does not match the immutable source report bundle.",
    );
  }
  return { reportVisibility: "public", editorialRevision };
}

function safePublicText(value: unknown, maximum = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, maximum);
  if (
    !text ||
    /(?:data|blob|file):|[a-z]:[\\\\/]|\\\\\\\\|authorization\\s*:|bearer\\s+|token\\s*[=:]|secret\\s*[=:]|credential\\s*[=:]/i.test(text) ||
    /[<>]/.test(text)
  ) return undefined;
  return text;
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    ? value
    : undefined;
}

function safeStorageKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/^[\\\\/]|[\\\\?#\\u0000-\\u001f\\u007f]/.test(value) &&
    value.split("/").every((segment) =>
      Boolean(segment) &&
      segment !== "." &&
      segment !== ".." &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,240}$/.test(segment)
    );
}

function safeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "ai-grader-report";
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
      visibilityStatus: true,
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
  if (
    !report ||
    report.publicationStatus !== "published" ||
    report.visibilityStatus !== "public" ||
    !report.reportBundleStorageKey
  ) return null;

  const bundle = parseStoredJson(await readStorageBuffer(report.reportBundleStorageKey).catch(() => null));
  if (!bundle) return null;
  if (bundle.schemaVersion === "ai-grader-report-bundle-v0.2") {
    return mergeAiGraderPublishedReportReadData(bundle, {});
  }

  if (bundle.schemaVersion === 'ai-grader-report-bundle-v0.3') return bundle;

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

export async function readAiGraderPublicReportEnrichment(
  reportId: string,
): Promise<AiGraderPublicReportEnrichment | null> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      publicationStatus: true,
      visibilityStatus: true,
      cardAssetId: true,
      itemId: true,
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
          searchQuery: true,
          valuationMinor: true,
          valuationCurrency: true,
          compsRefs: true,
          resultSummary: true,
        },
      },
    },
  });
  if (
    !report ||
    report.publicationStatus !== "published" ||
    report.visibilityStatus !== "public"
  ) return null;
  const slabbedPhotos = (Array.isArray(report.evidenceAssets)
    ? report.evidenceAssets
    : []).flatMap((asset: JsonRecord) => {
      const artifactId = safeId(asset.artifactId);
      const kind = safePublicText(asset.kind, 128);
      const checksumSha256 =
        typeof asset.checksumSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(asset.checksumSha256)
          ? asset.checksumSha256
          : undefined;
      const mimeType =
        typeof asset.mimeType === "string" &&
        /^image\/(?:png|jpeg|webp)$/.test(asset.mimeType)
          ? asset.mimeType
          : undefined;
      const byteSize =
        typeof asset.byteSize === "number" &&
        Number.isInteger(asset.byteSize) &&
        asset.byteSize > 0
          ? asset.byteSize
          : undefined;
      const generatedUrl = safeStorageKey(asset.storageKey)
        ? safeAiGraderPublicReportUrl(publicUrlFor(asset.storageKey))
        : undefined;
      const publicUrl = safeAiGraderPublicReportUrl(asset.publicUrl) ?? generatedUrl;
      if (!artifactId || !kind || !checksumSha256 || !mimeType || !byteSize || !publicUrl) {
        return [];
      }
      return [{
        artifactId,
        kind,
        ...(asset.side === "front" || asset.side === "back"
          ? { side: asset.side }
          : {}),
        publicUrl,
        checksumSha256,
        mimeType,
        byteSize,
      }];
    });
  const rawValuation = Array.isArray(report.valuations)
    ? report.valuations[0]
    : undefined;
  const valuation = isRecord(rawValuation)
    ? {
        status: safePublicText(rawValuation.status, 128) ?? "not_run",
        ...(safePublicText(rawValuation.searchQuery, 500)
          ? { searchQuery: safePublicText(rawValuation.searchQuery, 500) }
          : {}),
        ...(typeof rawValuation.valuationMinor === "number" &&
        Number.isInteger(rawValuation.valuationMinor)
          ? { valuationMinor: rawValuation.valuationMinor }
          : {}),
        ...(safePublicText(rawValuation.valuationCurrency, 16)
          ? { valuationCurrency: safePublicText(rawValuation.valuationCurrency, 16) }
          : {}),
        ...(safePublicText(rawValuation.resultSummary, 1000)
          ? { resultSummary: safePublicText(rawValuation.resultSummary, 1000) }
          : {}),
        comps: (Array.isArray(rawValuation.compsRefs)
          ? rawValuation.compsRefs
          : []).flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const title =
              safePublicText(entry.title ?? entry.name ?? entry.label, 300) ??
              "Comparable sale";
            const url = safeAiGraderPublicReportUrl(entry.url ?? entry.publicUrl);
            const price = safePublicText(
              entry.price ?? entry.priceText ?? entry.soldPrice,
              64,
            );
            return [{ title, ...(url ? { url } : {}), ...(price ? { price } : {}) }];
          }).slice(0, 100),
      }
    : null;
  return {
    linkage: {
      ...(safeId(report.cardAssetId) ? { cardAssetId: report.cardAssetId } : {}),
      ...(safeId(report.itemId) ? { itemId: report.itemId } : {}),
    },
    slabbedPhotos,
    valuation,
  };
}

export async function readAiGraderPublicOpaqueEvidence(
  reportId: string,
  assetId: string,
): Promise<AiGraderPublicOpaqueEvidence | null> {
  if (!reportId || !isSafeAiGraderPublicAssetId(assetId)) return null;
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      publicationStatus: true,
      visibilityStatus: true,
      reportBundleStorageKey: true,
    },
  });
  if (
    !report ||
    report.publicationStatus !== "published" ||
    report.visibilityStatus !== "public" ||
    !safeStorageKey(report.reportBundleStorageKey)
  ) return null;
  const bundle = parseStoredJson(
    await readStorageBuffer(report.reportBundleStorageKey).catch(() => null),
  );
  if (!bundle || bundle.schemaVersion !== "ai-grader-report-bundle-v0.3") return null;
  const publicBundle = sanitizeAiGraderPublicReportBundleForRead(bundle, {
    expectedReportId: reportId,
    publicUrlFor,
  });
  if (!publicBundle) return null;
  const rawAsset = (Array.isArray(bundle.publicAssets) ? bundle.publicAssets : [])
    .find((asset) => isRecord(asset) && asset.id === assetId);
  const publicAsset = (Array.isArray(publicBundle.publicAssets)
    ? publicBundle.publicAssets
    : []).find((asset) => isRecord(asset) && asset.id === assetId);
  if (!isRecord(rawAsset) || !isRecord(publicAsset)) return null;
  const contentType = rawAsset.contentType;
  if (
    contentType !== "application/vnd.tenkings.calibrated-detector-plane-v1" &&
    contentType !== "application/json"
  ) return null;
  const evidenceRole = rawAsset.evidenceRole;
  if (
    (contentType === "application/json" && evidenceRole !== "other_evidence") ||
    (contentType === "application/vnd.tenkings.calibrated-detector-plane-v1" &&
      evidenceRole !== "segmentation_mask" &&
      evidenceRole !== "confidence_mask" &&
      evidenceRole !== "illumination_mask" &&
      evidenceRole !== "common_mode_response")
  ) return null;
  const storageKey = rawAsset.storageKey;
  const expectedPrefix =
    `ai-grader/reports/${safeSegment(reportId)}/assets/`;
  if (!safeStorageKey(storageKey) || !storageKey.startsWith(expectedPrefix)) return null;
  const checksumSha256 =
    typeof rawAsset.checksumSha256 === "string"
      ? rawAsset.checksumSha256
      : rawAsset.sha256;
  const byteSize = rawAsset.byteSize;
  if (
    typeof checksumSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(checksumSha256) ||
    typeof byteSize !== "number" ||
    !Number.isInteger(byteSize) ||
    byteSize <= 0 ||
    publicAsset.checksumSha256 !== checksumSha256
  ) return null;
  const bytes = await readStorageBuffer(storageKey).catch(() => null);
  if (
    !bytes ||
    bytes.byteLength !== byteSize ||
    aiGraderSha256(bytes) !== checksumSha256
  ) return null;
  const rawName =
    typeof rawAsset.fileName === "string"
      ? rawAsset.fileName.replace(/\\\\/g, "/").split("/").pop()
      : undefined;
  const fallbackName =
    contentType === "application/json" ? "evidence.json" : "evidence.tkplane";
  const fileName =
    rawName && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(rawName)
      ? rawName
      : fallbackName;
  return { bytes, contentType, fileName, checksumSha256 };
}
