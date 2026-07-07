import { createHash } from "crypto";
import { Prisma } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

export type AiGraderProductionPublicationStatus =
  | "draft"
  | "finalized"
  | "published"
  | "unpublished"
  | "revoked"
  | "error";

export type AiGraderValuationStatus =
  | "not_ready_missing_grade"
  | "not_ready_missing_identity"
  | "ready"
  | "running"
  | "completed"
  | "failed";

export type AiGraderProductionDbDelegate = {
  upsert(args: unknown): Promise<unknown>;
  findUnique?(args: unknown): Promise<unknown | null>;
  findMany?(args: unknown): Promise<unknown[]>;
  updateMany?(args: unknown): Promise<{ count: number }>;
};

export type AiGraderProductionTransactionClient = {
  aiGraderSession: AiGraderProductionDbDelegate;
  aiGraderReport: AiGraderProductionDbDelegate;
  aiGraderEvidenceAsset: AiGraderProductionDbDelegate;
  aiGraderGrade: AiGraderProductionDbDelegate;
  aiGraderLabel: AiGraderProductionDbDelegate;
  aiGraderPublication: AiGraderProductionDbDelegate;
  aiGraderValuation: AiGraderProductionDbDelegate;
  cardAsset?: Pick<AiGraderProductionDbDelegate, "updateMany">;
  item?: Pick<AiGraderProductionDbDelegate, "findUnique" | "updateMany">;
};

export type AiGraderProductionPrismaClient = AiGraderProductionTransactionClient & {
  $transaction?: <T>(fn: (tx: AiGraderProductionTransactionClient) => Promise<T>) => Promise<T>;
};

export type AiGraderProductionReportBundleLike = JsonRecord & {
  gradingSessionId?: string;
  reportId?: string;
  generatedAt?: string;
  reportStatus?: string;
  cardIdentity?: JsonRecord;
  provisionalGrade?: JsonRecord;
  evidenceReferences?: JsonRecord;
  visionLab?: JsonRecord;
  calibrationProfile?: JsonRecord;
  rulerCalibration?: JsonRecord;
  lightingProfile?: JsonRecord;
  assets?: unknown[];
  publicAssets?: unknown[];
  warnings?: unknown[];
};

export type AiGraderProductionReleaseLike = JsonRecord & {
  gradingSessionId?: string;
  reportId?: string;
  reportStatus?: string;
  finalStatus?: string;
  finalGradeComputed?: boolean;
  finalGrade?: JsonRecord;
  label?: JsonRecord;
  publication?: JsonRecord;
  operatorFinalization?: JsonRecord;
  gates?: unknown[];
  warnings?: unknown[];
  slabbedPhotoContract?: JsonRecord;
  ebayCompsContract?: JsonRecord;
  cardInventoryLinkage?: JsonRecord;
};

export type AiGraderProductionArtifactPlan = {
  artifactId: string;
  artifactClass:
    | "report_bundle"
    | "production_release"
    | "label_data"
    | "publication_manifest"
    | "integration_contract"
    | "asset_manifest"
    | "checksums"
    | "label_preview"
    | "report_asset";
  kind: string;
  storageKey: string;
  contentType: string;
  body?: string;
  bodyEncoding?: "utf8" | "base64";
  checksumSha256: string;
  byteSize: number;
  publicUrl?: string;
  sourceAssetId?: string;
};

export type AiGraderProductionStoragePlan = {
  storageKeyPrefix: string;
  publicReportUrl: string;
  qrPayloadUrl: string;
  artifacts: AiGraderProductionArtifactPlan[];
  assetManifest: Array<{
    artifactId: string;
    kind: string;
    storageKey: string;
    checksumSha256: string;
    byteSize: number;
    publicUrl?: string;
  }>;
};

export type AiGraderProductionActorAudit = JsonRecord & {
  actorType: "human_operator" | "service_account";
  action: string;
  requestedAt: string;
  userId?: string | null;
  serviceAccountId?: string | null;
  role?: string | null;
};

export type AiGraderProductionPersistInput = {
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  publicationStatus?: AiGraderProductionPublicationStatus;
  operatorUserId?: string | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  persistedAt?: string | Date;
};

export type AiGraderProductionPersistResult = {
  gradingSessionId: string;
  reportId: string;
  publicationStatus: AiGraderProductionPublicationStatus;
  session: unknown;
  report: unknown;
  grade: unknown;
  label: unknown;
  publication: unknown;
  valuation: unknown;
  evidenceAssetCount: number;
  cardAssetUpdatedCount: number;
  itemUpdatedCount: number;
  storagePlan: AiGraderProductionStoragePlan;
};

export type AiGraderCardItemSelection = {
  source: "card_asset" | "item" | "manual_draft";
  cardAssetId?: string | null;
  itemId?: string | null;
  title?: string | null;
  set?: string | null;
  cardNumber?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  details?: JsonRecord;
};

export type AiGraderSlabbedPhotoSide = "front" | "back";

export type AiGraderSlabbedPhotoPersistInput = {
  tenantId: string;
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
  operatorUserId?: string | null;
  uploadedAt?: string | Date;
  metadata?: JsonRecord;
  actorAudit?: AiGraderProductionActorAudit | null;
};

export type AiGraderSlabbedPhotoPersistResult = {
  reportId: string;
  artifactId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  asset: unknown;
};

export type AiGraderValuationPersistInput = {
  tenantId: string;
  reportId: string;
  status: AiGraderValuationStatus;
  source?: string;
  searchQuery?: string | null;
  compsRefs?: unknown;
  resultSummary?: unknown;
  valuationMinor?: number | null;
  valuationCurrency?: string | null;
  requestedByUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  requestedAt?: string | Date;
  completedAt?: string | Date | null;
  errorCode?: string | null;
};

export type AiGraderValuationPersistResult = {
  reportId: string;
  status: AiGraderValuationStatus;
  valuation: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function trimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerValue(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
}

function dateValue(value: string | Date | undefined, fallback = new Date()) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function json(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return {};
  return value as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function actorAuditJson(value: AiGraderProductionActorAudit | null | undefined): JsonRecord | null {
  if (!isRecord(value)) return null;
  return {
    actorType: stringValue(value.actorType, "unknown"),
    action: stringValue(value.action, "unknown"),
    requestedAt: stringValue(value.requestedAt, new Date().toISOString()),
    userId: stringValue(value.userId, "") || null,
    serviceAccountId: stringValue(value.serviceAccountId, "") || null,
    role: stringValue(value.role, "") || null,
  };
}

function withActorAudit(value: unknown, audit: AiGraderProductionActorAudit | null | undefined): JsonRecord {
  const base = isRecord(value) ? value : {};
  const cleanedAudit = actorAuditJson(audit);
  return cleanedAudit ? { ...base, actorAudit: cleanedAudit } : base;
}

export function aiGraderSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "ai-grader-report";
}

function safeAssetFileName(value: string, fallback: string) {
  const normalized = value.replace(/\\/g, "/").split("/").pop() || fallback;
  const cleaned = normalized
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function fileExtensionForContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("image/png")) return ".png";
  if (normalized.includes("image/jpeg")) return ".jpg";
  if (normalized.includes("image/webp")) return ".webp";
  return ".bin";
}

function checksumValue(value: unknown) {
  const text = stringValue(value, "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : "";
}

function isImageAssetRecord(asset: JsonRecord) {
  const haystack = `${asset.contentType ?? ""} ${asset.fileName ?? ""} ${asset.id ?? ""} ${asset.kind ?? ""}`.toLowerCase();
  return haystack.includes("image") || /\.(png|jpe?g|webp)$/i.test(String(asset.fileName ?? asset.storageKey ?? asset.id ?? ""));
}

function looksLikeLocalPathOrLoopback(value: string) {
  return /^[a-z]:\\/i.test(value) || value.includes("\\TenKings\\") || /https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)/i.test(value);
}

export function sanitizeAiGraderPublicJson<T>(value: T): T {
  function visit(current: unknown, key = ""): unknown {
    if (typeof current === "string") {
      if (looksLikeLocalPathOrLoopback(current)) return undefined;
      return current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => visit(item)).filter((item) => item !== undefined);
    }
    if (isRecord(current)) {
      const next: JsonRecord = {};
      for (const [entryKey, entryValue] of Object.entries(current)) {
        const lowerKey = entryKey.toLowerCase();
        if (
          lowerKey.includes("local") ||
          lowerKey.endsWith("path") ||
          lowerKey.endsWith("dir") ||
          lowerKey.endsWith("folder")
        ) {
          const cleaned = visit(entryValue, entryKey);
          if (cleaned !== undefined && !looksLikeLocalPathOrLoopback(String(cleaned))) next[entryKey] = cleaned;
          continue;
        }
        const cleaned = visit(entryValue, entryKey);
        if (cleaned !== undefined) next[entryKey] = cleaned;
      }
      return next;
    }
    return current;
  }
  return visit(value) as T;
}

function publicBase(publicReportBaseUrl?: string) {
  const base = publicReportBaseUrl?.trim() || "https://collect.tenkings.co";
  return base.replace(/\/$/, "");
}

function artifact(input: {
  artifactId: string;
  artifactClass: AiGraderProductionArtifactPlan["artifactClass"];
  kind: string;
  storageKey: string;
  contentType: string;
  body: string;
  bodyEncoding?: "utf8" | "base64";
  publicUrl?: string;
}): AiGraderProductionArtifactPlan {
  const bytes = Buffer.from(input.body, input.bodyEncoding === "base64" ? "base64" : "utf8");
  return {
    ...input,
    checksumSha256: aiGraderSha256(bytes),
    byteSize: bytes.length,
  };
}

function reportAssetArtifacts(input: {
  reportId: string;
  storageKeyPrefix: string;
  reportBundle: AiGraderProductionReportBundleLike;
  publicUrlFor: (storageKey: string) => string;
}): AiGraderProductionArtifactPlan[] {
  const rawAssets = Array.isArray(input.reportBundle.assets) ? input.reportBundle.assets : [];
  const seenStorageKeys = new Set<string>();
  const artifacts: AiGraderProductionArtifactPlan[] = [];
  rawAssets.filter(isRecord).forEach((asset, index) => {
    const bodyBase64 = stringValue(asset.bodyBase64, "");
    const contentType = stringValue(asset.contentType, "application/octet-stream");
    if (!contentType.toLowerCase().startsWith("image/")) return;
    if (!isImageAssetRecord(asset)) return;
    const id = stringValue(asset.id, `image-${index + 1}`);
    const checksumSha256 = bodyBase64
      ? aiGraderSha256(Buffer.from(bodyBase64, "base64"))
      : checksumValue(asset.checksumSha256 ?? asset.sha256);
    const byteSize = bodyBase64 ? Buffer.from(bodyBase64, "base64").length : positiveIntegerValue(asset.byteSize);
    if (!checksumSha256 || !byteSize) return;
    const fileName = safeAssetFileName(
      stringValue(asset.fileName ?? asset.storageKey ?? id, ""),
      `${safeSegment(id)}${fileExtensionForContentType(contentType)}`
    );
    const uniqueName = `${String(index + 1).padStart(3, "0")}-${fileName}`;
    const storageKey = `${input.storageKeyPrefix}assets/${uniqueName}`;
    if (seenStorageKeys.has(storageKey)) return;
    seenStorageKeys.add(storageKey);
    artifacts.push({
        artifactId: `${input.reportId}:report-asset:${safeSegment(id)}:${index + 1}`,
        artifactClass: "report_asset",
        kind: "report-image",
        storageKey,
        contentType,
        ...(bodyBase64 ? { body: bodyBase64, bodyEncoding: "base64" as const } : {}),
        checksumSha256,
        byteSize,
        publicUrl: input.publicUrlFor(storageKey),
        sourceAssetId: id,
    });
  });
  return artifacts;
}

export function buildAiGraderLabelPreviewHtml(productionRelease: AiGraderProductionReleaseLike) {
  const label = isRecord(productionRelease.label) ? productionRelease.label : {};
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  const reportId = stringValue(productionRelease.reportId ?? label.reportId, "pending-report");
  const gradeText = stringValue(label.labelGradeText, numberValue(finalGrade.overall)?.toFixed(1) ?? "PENDING");
  const qrPayloadUrl = stringValue(label.qrPayloadUrl, `/ai-grader/reports/${reportId}`);
  const certId = stringValue(label.certId, reportId);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ten Kings AI Grader Label ${reportId}</title>
  <style>
    body { margin: 0; background: #f3efe5; color: #111; font-family: Inter, Arial, sans-serif; }
    .label { width: 3.5in; min-height: 2.1in; margin: 24px auto; padding: 0.18in; border: 1px solid #141414; background: #fffaf0; box-sizing: border-box; }
    .brand { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #8b6c2d; font-weight: 900; }
    .grade { margin-top: 8px; font-size: 48px; line-height: .95; font-weight: 900; }
    .meta { margin-top: 8px; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
    .warning { margin-top: 10px; padding-top: 8px; border-top: 1px solid #ddd0af; font-size: 9px; color: #7a2b2b; font-weight: 800; text-transform: uppercase; }
  </style>
</head>
<body>
  <section class="label">
    <div class="brand">Ten Kings AI Grader</div>
    <div class="grade">${gradeText}</div>
    <div class="meta">Report ID: ${reportId}<br />Cert/Report ID: ${certId}<br />QR URL: ${qrPayloadUrl}</div>
    <div class="warning">AI-Grader Report V0. Certification claim disabled until approved.</div>
  </section>
</body>
</html>
`;
}

export function buildAiGraderProductionStoragePlan(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  publicReportBaseUrl?: string;
  storageKeyPrefix?: string;
  publicUrlFor?: (storageKey: string) => string;
}): AiGraderProductionStoragePlan {
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "pending-report");
  const storageKeyPrefix = (input.storageKeyPrefix ?? `ai-grader/reports/${safeSegment(reportId)}/`).replace(/^\/+/, "").replace(/\/?$/, "/");
  const base = publicBase(input.publicReportBaseUrl);
  const generatedAt = stringValue(input.productionRelease.generatedAt ?? input.reportBundle.generatedAt, new Date().toISOString());
  const publicReportUrl = `${base}/ai-grader/reports/${encodeURIComponent(reportId)}`;
  const qrPayloadUrl = publicReportUrl;
  const publicUrlFor = input.publicUrlFor ?? ((storageKey: string) => `${base}/storage/${storageKey}`);
  const reportAssets = reportAssetArtifacts({ reportId, storageKeyPrefix, reportBundle: input.reportBundle, publicUrlFor });
  const publicAssets = reportAssets.map((entry) => ({
    id: entry.artifactId.replace(`${reportId}:report-asset:`, ""),
    kind: entry.kind,
    fileName: entry.storageKey.split("/").pop(),
    contentType: entry.contentType,
    storageKey: entry.storageKey,
    publicUrl: entry.publicUrl,
    byteSize: entry.byteSize,
    checksumSha256: entry.checksumSha256,
  }));
  const sanitizedBundle = sanitizeAiGraderPublicJson({
    ...input.reportBundle,
    reportId,
    assets: publicAssets,
    publicAssets,
    publicPathPlaceholders: {
      reportViewerRoute: "/ai-grader/reports/[reportId]",
      reportUrlTemplate: "/ai-grader/reports/{reportId}",
      assetBaseUrlTemplate: `${storageKeyPrefix}assets/`,
    },
  });
  const sanitizedRelease = sanitizeAiGraderPublicJson({
    ...input.productionRelease,
    reportId,
    publication: {
      ...(isRecord(input.productionRelease.publication) ? input.productionRelease.publication : {}),
      status: "published",
      publicReportUrl,
      qrPayloadUrl,
      storageMode: "managed_storage",
      dbWritesPerformed: true,
      uploadPerformed: true,
      storageKeyPrefix,
    },
  });
  const labelData = sanitizeAiGraderPublicJson({
    ...(isRecord(sanitizedRelease.label) ? sanitizedRelease.label : {}),
    reportId,
    publicReportUrl,
    qrPayloadUrl,
  });
  const publicationManifest = sanitizeAiGraderPublicJson({
    reportId,
    status: "published",
    publicReportUrl,
    qrPayloadUrl,
    storageKeyPrefix,
    generatedAt,
    certificationClaim: false,
  });
  const integrationContract = sanitizeAiGraderPublicJson({
    reportId,
    gradingSessionId: input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId,
    cardIdentity: input.reportBundle.cardIdentity,
    finalGrade: input.productionRelease.finalGrade,
    label: labelData,
    publication: publicationManifest,
    slabbedPhotoContract: input.productionRelease.slabbedPhotoContract,
    ebayCompsContract: input.productionRelease.ebayCompsContract,
    cardInventoryLinkage: input.productionRelease.cardInventoryLinkage,
    noLocalDellPaths: true,
  });
  const artifacts: AiGraderProductionArtifactPlan[] = [
    artifact({
      artifactId: `${reportId}:report-bundle`,
      artifactClass: "report_bundle",
      kind: "report-bundle.json",
      storageKey: `${storageKeyPrefix}report-bundle.json`,
      contentType: "application/json",
      body: stableJson(sanitizedBundle),
    }),
    artifact({
      artifactId: `${reportId}:production-release`,
      artifactClass: "production_release",
      kind: "production-release.json",
      storageKey: `${storageKeyPrefix}production-release.json`,
      contentType: "application/json",
      body: stableJson(sanitizedRelease),
    }),
    artifact({
      artifactId: `${reportId}:label-data`,
      artifactClass: "label_data",
      kind: "label-data.json",
      storageKey: `${storageKeyPrefix}label-data.json`,
      contentType: "application/json",
      body: stableJson(labelData),
    }),
    artifact({
      artifactId: `${reportId}:publication-manifest`,
      artifactClass: "publication_manifest",
      kind: "publication-manifest.json",
      storageKey: `${storageKeyPrefix}publication-manifest.json`,
      contentType: "application/json",
      body: stableJson(publicationManifest),
    }),
    artifact({
      artifactId: `${reportId}:integration-contract`,
      artifactClass: "integration_contract",
      kind: "integration-contract.json",
      storageKey: `${storageKeyPrefix}integration-contract.json`,
      contentType: "application/json",
      body: stableJson(integrationContract),
    }),
    artifact({
      artifactId: `${reportId}:label-preview`,
      artifactClass: "label_preview",
      kind: "label-preview.html",
      storageKey: `${storageKeyPrefix}label-preview.html`,
      contentType: "text/html; charset=utf-8",
      body: buildAiGraderLabelPreviewHtml(sanitizedRelease),
    }),
    ...reportAssets,
  ];
  const assetManifest = artifacts.map((entry) => ({
    artifactId: entry.artifactId,
    kind: entry.kind,
    storageKey: entry.storageKey,
    checksumSha256: entry.checksumSha256,
    byteSize: entry.byteSize,
    publicUrl: publicUrlFor(entry.storageKey),
  }));
  const assetManifestArtifact = artifact({
    artifactId: `${reportId}:asset-manifest`,
    artifactClass: "asset_manifest",
    kind: "asset-manifest.json",
    storageKey: `${storageKeyPrefix}asset-manifest.json`,
    contentType: "application/json",
    body: stableJson({ reportId, assets: assetManifest }),
  });
  const checksumsArtifact = artifact({
    artifactId: `${reportId}:checksums`,
    artifactClass: "checksums",
    kind: "checksums.json",
    storageKey: `${storageKeyPrefix}checksums.json`,
    contentType: "application/json",
    body: stableJson({
      reportId,
      checksums: [...assetManifest, {
        artifactId: assetManifestArtifact.artifactId,
        kind: assetManifestArtifact.kind,
        storageKey: assetManifestArtifact.storageKey,
        checksumSha256: assetManifestArtifact.checksumSha256,
        byteSize: assetManifestArtifact.byteSize,
        publicUrl: publicUrlFor(assetManifestArtifact.storageKey),
      }].map((entry) => ({
        artifactId: entry.artifactId,
        kind: entry.kind,
        storageKey: entry.storageKey,
        checksumSha256: entry.checksumSha256,
        byteSize: entry.byteSize,
      })),
    }),
  });
  const allArtifacts = [...artifacts, assetManifestArtifact, checksumsArtifact].map((entry) => ({
    ...entry,
    publicUrl: publicUrlFor(entry.storageKey),
  }));
  return {
    storageKeyPrefix,
    publicReportUrl,
    qrPayloadUrl,
    artifacts: allArtifacts,
    assetManifest: allArtifacts.map((entry) => ({
      artifactId: entry.artifactId,
      kind: entry.kind,
      storageKey: entry.storageKey,
      checksumSha256: entry.checksumSha256,
      byteSize: entry.byteSize,
      publicUrl: entry.publicUrl,
    })),
  };
}

export function computeAiGraderValuationStatus(input: {
  productionRelease: AiGraderProductionReleaseLike;
  reportBundle: AiGraderProductionReportBundleLike;
}): AiGraderValuationStatus {
  if (input.productionRelease.finalGradeComputed !== true) return "not_ready_missing_grade";
  const cardIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const title = stringValue(cardIdentity.title, "");
  const set = stringValue(cardIdentity.set, "");
  const cardNumber = stringValue(cardIdentity.cardNumber, "");
  if (!title && (!set || !cardNumber)) return "not_ready_missing_identity";
  return "ready";
}

export function buildAiGraderCompsSearchQuery(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease?: AiGraderProductionReleaseLike;
  selection?: AiGraderCardItemSelection | null;
}) {
  const cardIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const selection = input.selection ?? null;
  const finalGrade = isRecord(input.productionRelease?.finalGrade) ? input.productionRelease?.finalGrade : {};
  const title = trimmedString(selection?.title) || trimmedString(cardIdentity.title);
  const setName = trimmedString(selection?.set) || trimmedString(cardIdentity.set);
  const cardNumber = trimmedString(selection?.cardNumber) || trimmedString(cardIdentity.cardNumber);
  const grade = numberValue(finalGrade?.overall);
  const parts = [title, setName, cardNumber ? `#${cardNumber}` : "", grade ? `AI Grade ${grade.toFixed(1)}` : ""].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function finalOverallGrade(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return numberValue(finalGrade.overall);
}

function elementScores(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return isRecord(finalGrade.elements) ? finalGrade.elements : {};
}

function confidence(productionRelease: AiGraderProductionReleaseLike) {
  const finalGrade = isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : {};
  return isRecord(finalGrade.confidence) ? finalGrade.confidence : {};
}

function labelData(productionRelease: AiGraderProductionReleaseLike, reportId: string, publicReportUrl: string) {
  return isRecord(productionRelease.label)
    ? productionRelease.label
    : {
        status: "label_data_ready",
        certId: reportId,
        reportId,
        publicReportUrl,
        qrPayloadUrl: publicReportUrl,
        labelGradeText: finalOverallGrade(productionRelease)?.toFixed(1) ?? "PENDING",
      };
}

function sessionData(input: AiGraderProductionPersistInput, gradingSessionId: string, reportId: string, now: Date) {
  const cardAssetId = input.cardAssetId ?? stringValue(input.reportBundle.cardIdentity?.cardAssetId, "");
  const itemId = input.itemId ?? stringValue(input.reportBundle.cardIdentity?.itemId, "");
  return {
    tenantId: input.tenantId,
    gradingSessionId,
    reportId,
    operatorUserId: input.operatorUserId ?? null,
    operatorId: stringValue(input.productionRelease.operatorFinalization?.operatorId, input.operatorUserId ?? "") || null,
    cardAssetId: cardAssetId || null,
    itemId: itemId || null,
    status: input.publicationStatus === "published" ? "published" : "finalized",
    source: "browser_station",
    cardIdentity: nullableJson(input.reportBundle.cardIdentity),
    acceptedProfile: nullableJson(input.reportBundle.lightingProfile),
    calibrationProfile: nullableJson(input.reportBundle.calibrationProfile ?? input.reportBundle.rulerCalibration),
    captureSummary: nullableJson(input.reportBundle.evidenceReferences),
    safetySummary: nullableJson({
      finalGradeComputed: input.productionRelease.finalGradeComputed === true,
      certifiedClaim: false,
      warnings: input.productionRelease.warnings ?? input.reportBundle.warnings ?? [],
      actorAudit: actorAuditJson(input.actorAudit),
    }),
    updatedAt: now,
  };
}

function reportData(input: AiGraderProductionPersistInput, sessionId: string, reportId: string, status: AiGraderProductionPublicationStatus, now: Date) {
  const release = input.productionRelease;
  const grade = finalOverallGrade(release);
  const cardAssetId = input.cardAssetId ?? stringValue(input.reportBundle.cardIdentity?.cardAssetId, "");
  const itemId = input.itemId ?? stringValue(input.reportBundle.cardIdentity?.itemId, "");
  return {
    tenantId: input.tenantId,
    sessionId,
    reportId,
    reportStatus: stringValue(release.reportStatus, "final_ai_grader_report_v0"),
    finalGradeStatus: stringValue(release.finalStatus, release.finalGradeComputed ? "final_grade_computed" : "insufficient_evidence"),
    visibilityStatus: status === "published" ? "public" : "private",
    publicationStatus: status,
    cardAssetId: cardAssetId || null,
    itemId: itemId || null,
    publicReportUrl: input.storagePlan.publicReportUrl,
    qrPayloadUrl: input.storagePlan.qrPayloadUrl,
    reportBundleStorageKey: `${input.storagePlan.storageKeyPrefix}report-bundle.json`,
    productionReleaseStorageKey: `${input.storagePlan.storageKeyPrefix}production-release.json`,
    labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
    assetManifestStorageKey: `${input.storagePlan.storageKeyPrefix}asset-manifest.json`,
    reportHtmlStorageKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
    finalOverallGrade: grade ?? null,
    elementScores: nullableJson(elementScores(release)),
    confidence: nullableJson(confidence(release)),
    gradeStory: nullableJson(input.reportBundle.provisionalGrade?.gradeStory),
    whyNot10: nullableJson(isRecord(release.finalGrade) ? release.finalGrade.whyNot10 : undefined),
    gradeImpactCandidates: nullableJson(isRecord(release.finalGrade) ? release.finalGrade.gradeImpactReasons : undefined),
    gates: nullableJson(release.gates),
    warnings: nullableJson(release.warnings ?? input.reportBundle.warnings),
    calibrationProfile: nullableJson(input.reportBundle.calibrationProfile ?? input.reportBundle.rulerCalibration),
    repeatabilitySummary: nullableJson(input.reportBundle.repeatabilitySummary),
    lightingProfile: nullableJson(input.reportBundle.lightingProfile),
    visionLabArtifacts: nullableJson(input.reportBundle.visionLab),
    valuationSummary: nullableJson(release.ebayCompsContract),
    checksumSummary: nullableJson({
      assets: input.storagePlan.assetManifest,
      actorAudit: actorAuditJson(input.actorAudit),
    }),
    finalizedAt: now,
    publishedAt: status === "published" ? now : null,
    updatedAt: now,
  };
}

async function runInTransaction<T>(db: AiGraderProductionPrismaClient, fn: (tx: AiGraderProductionTransactionClient) => Promise<T>) {
  if (typeof db.$transaction === "function") return db.$transaction(fn);
  return fn(db);
}

export async function persistAiGraderProductionRelease(
  db: AiGraderProductionPrismaClient,
  input: AiGraderProductionPersistInput
): Promise<AiGraderProductionPersistResult> {
  const gradingSessionId = stringValue(input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId, "");
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "");
  if (!input.tenantId.trim()) throw new Error("tenantId is required.");
  if (!gradingSessionId) throw new Error("gradingSessionId is required.");
  if (!reportId) throw new Error("reportId is required.");
  const now = dateValue(input.persistedAt);
  const publicationStatus = input.publicationStatus ?? "published";

  return runInTransaction(db, async (tx) => {
    const baseSessionData = sessionData(input, gradingSessionId, reportId, now);
    const session = await tx.aiGraderSession.upsert({
      where: { gradingSessionId },
      update: baseSessionData,
      create: {
        ...baseSessionData,
        createdAt: now,
      },
    });
    const sessionId = stringValue((session as JsonRecord).id, gradingSessionId);
    const baseReportData = reportData(input, sessionId, reportId, publicationStatus, now);
    const report = await tx.aiGraderReport.upsert({
      where: { reportId },
      update: baseReportData,
      create: {
        ...baseReportData,
        createdAt: now,
      },
    });
    const reportRowId = stringValue((report as JsonRecord).id, reportId);
    const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
    const elements = elementScores(input.productionRelease);
    const confidenceData = confidence(input.productionRelease);
    const operatorFinalizationJson = withActorAudit(input.productionRelease.operatorFinalization, input.actorAudit);
    const grade = await tx.aiGraderGrade.upsert({
      where: { reportId: reportRowId },
      update: {
        tenantId: input.tenantId,
        status: stringValue(finalGrade.status, "final_ai_grader_grade_v0"),
        overall: finalOverallGrade(input.productionRelease) ?? null,
        centeringScore: numberValue((elements.centering as JsonRecord | undefined)?.score) ?? null,
        cornersScore: numberValue((elements.corners as JsonRecord | undefined)?.score) ?? null,
        edgesScore: numberValue((elements.edges as JsonRecord | undefined)?.score) ?? null,
        surfaceScore: numberValue((elements.surface as JsonRecord | undefined)?.score) ?? null,
        confidenceScore: numberValue(confidenceData.score) ?? null,
        confidenceBand: stringValue(confidenceData.band, "") || null,
        gradeImpactReasons: nullableJson(finalGrade.gradeImpactReasons),
        whyNot10: nullableJson(finalGrade.whyNot10),
        gates: nullableJson(input.productionRelease.gates),
        warnings: nullableJson(input.productionRelease.warnings),
        operatorFinalization: nullableJson(operatorFinalizationJson),
        overrideReason: stringValue(input.productionRelease.operatorFinalization?.overrideReason, "") || null,
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        reportId: reportRowId,
        status: stringValue(finalGrade.status, "final_ai_grader_grade_v0"),
        overall: finalOverallGrade(input.productionRelease) ?? null,
        centeringScore: numberValue((elements.centering as JsonRecord | undefined)?.score) ?? null,
        cornersScore: numberValue((elements.corners as JsonRecord | undefined)?.score) ?? null,
        edgesScore: numberValue((elements.edges as JsonRecord | undefined)?.score) ?? null,
        surfaceScore: numberValue((elements.surface as JsonRecord | undefined)?.score) ?? null,
        confidenceScore: numberValue(confidenceData.score) ?? null,
        confidenceBand: stringValue(confidenceData.band, "") || null,
        gradeImpactReasons: nullableJson(finalGrade.gradeImpactReasons),
        whyNot10: nullableJson(finalGrade.whyNot10),
        gates: nullableJson(input.productionRelease.gates),
        warnings: nullableJson(input.productionRelease.warnings),
        operatorFinalization: nullableJson(operatorFinalizationJson),
        overrideReason: stringValue(input.productionRelease.operatorFinalization?.overrideReason, "") || null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const label = labelData(input.productionRelease, reportId, input.storagePlan.publicReportUrl);
    const certId = stringValue(label.certId, reportId);
    const labelRow = await tx.aiGraderLabel.upsert({
      where: { certId },
      update: {
        tenantId: input.tenantId,
        sessionId,
        reportId: reportRowId,
        labelStatus: stringValue(label.status, "label_data_ready"),
        certificateStatus: stringValue(label.certificateStatus, "report_id_issued_not_certified"),
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        publicReportUrl: input.storagePlan.publicReportUrl,
        labelGradeText: stringValue(label.labelGradeText, "PENDING"),
        labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
        labelPreviewKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
        labelPreviewUrl: input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl,
        payload: json(label),
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        sessionId,
        reportId: reportRowId,
        certId,
        labelStatus: stringValue(label.status, "label_data_ready"),
        certificateStatus: stringValue(label.certificateStatus, "report_id_issued_not_certified"),
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        publicReportUrl: input.storagePlan.publicReportUrl,
        labelGradeText: stringValue(label.labelGradeText, "PENDING"),
        labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
        labelPreviewKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
        labelPreviewUrl: input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl,
        payload: json(label),
        createdAt: now,
        updatedAt: now,
      },
    });
    const publication = await tx.aiGraderPublication.upsert({
      where: { reportId: reportRowId },
      update: {
        tenantId: input.tenantId,
        status: publicationStatus,
        publicReportUrl: input.storagePlan.publicReportUrl,
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        reportBundleStorageKey: `${input.storagePlan.storageKeyPrefix}report-bundle.json`,
        storageKeyPrefix: input.storagePlan.storageKeyPrefix,
        assetManifest: json(input.storagePlan.assetManifest),
        publicationManifest: nullableJson(withActorAudit(input.productionRelease.publication, input.actorAudit)),
        publishedByUserId: input.operatorUserId ?? null,
        publishedAt: publicationStatus === "published" ? now : null,
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        reportId: reportRowId,
        status: publicationStatus,
        publicReportUrl: input.storagePlan.publicReportUrl,
        qrPayloadUrl: input.storagePlan.qrPayloadUrl,
        reportBundleStorageKey: `${input.storagePlan.storageKeyPrefix}report-bundle.json`,
        storageKeyPrefix: input.storagePlan.storageKeyPrefix,
        assetManifest: json(input.storagePlan.assetManifest),
        publicationManifest: nullableJson(withActorAudit(input.productionRelease.publication, input.actorAudit)),
        publishedByUserId: input.operatorUserId ?? null,
        publishedAt: publicationStatus === "published" ? now : null,
        createdAt: now,
        updatedAt: now,
      },
    });
    let evidenceAssetCount = 0;
    for (const asset of input.storagePlan.artifacts) {
      await tx.aiGraderEvidenceAsset.upsert({
        where: { tenantId_artifactId: { tenantId: input.tenantId, artifactId: asset.artifactId } },
        update: {
          sessionId,
          reportId: reportRowId,
          artifactClass: asset.artifactClass,
          kind: asset.kind,
          storageKey: asset.storageKey,
          publicUrl: asset.publicUrl,
          checksumSha256: asset.checksumSha256,
          mimeType: asset.contentType,
          byteSize: asset.byteSize,
          metadata: json({
            source: "ai_grader_production_release_v0",
            actorAudit: actorAuditJson(input.actorAudit),
          }),
        },
        create: {
          tenantId: input.tenantId,
          sessionId,
          reportId: reportRowId,
          artifactId: asset.artifactId,
          artifactClass: asset.artifactClass,
          kind: asset.kind,
          storageKey: asset.storageKey,
          publicUrl: asset.publicUrl,
          checksumSha256: asset.checksumSha256,
          mimeType: asset.contentType,
          byteSize: asset.byteSize,
          metadata: json({
            source: "ai_grader_production_release_v0",
            actorAudit: actorAuditJson(input.actorAudit),
          }),
          createdAt: now,
        },
      });
      evidenceAssetCount += 1;
    }
    const valuationStatus = computeAiGraderValuationStatus(input);
    const valuationId = `ai-grader-valuation:${reportId}`;
    const valuation = await tx.aiGraderValuation.upsert({
      where: { id: valuationId },
      update: {
        tenantId: input.tenantId,
        sessionId,
        status: valuationStatus,
        source: "ebay_sold",
        searchQuery: stringValue(input.reportBundle.cardIdentity?.title, "") || null,
        compsRefs: nullableJson(input.productionRelease.ebayCompsContract?.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.productionRelease.ebayCompsContract, input.actorAudit)),
        updatedAt: now,
      },
      create: {
        id: valuationId,
        tenantId: input.tenantId,
        sessionId,
        reportId: reportRowId,
        status: valuationStatus,
        source: "ebay_sold",
        searchQuery: stringValue(input.reportBundle.cardIdentity?.title, "") || null,
        compsRefs: nullableJson(input.productionRelease.ebayCompsContract?.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.productionRelease.ebayCompsContract, input.actorAudit)),
        createdAt: now,
        updatedAt: now,
      },
    });
    let cardAssetUpdatedCount = 0;
    const cardAssetId = input.cardAssetId ?? stringValue(input.reportBundle.cardIdentity?.cardAssetId, "");
    if (cardAssetId && tx.cardAsset?.updateMany) {
      const update = await tx.cardAsset.updateMany({
        where: { id: cardAssetId },
        data: {
          aiGradeFinal: finalOverallGrade(input.productionRelease) ?? null,
          aiGradeLabel: label.labelGradeText ?? null,
          aiGradingJson: json({
            reportId,
            publicReportUrl: input.storagePlan.publicReportUrl,
            publicationStatus,
            finalGrade: input.productionRelease.finalGrade,
            label,
            actorAudit: actorAuditJson(input.actorAudit),
          }),
          aiGradeGeneratedAt: now,
        },
      });
      cardAssetUpdatedCount = update.count;
    }
    let itemUpdatedCount = 0;
    const itemId = input.itemId ?? stringValue(input.reportBundle.cardIdentity?.itemId, "");
    if (itemId && tx.item?.updateMany) {
      const existingItem = await tx.item.findUnique?.({
        where: { id: itemId },
        select: { detailsJson: true },
      });
      const existingDetails = isRecord(existingItem) && isRecord(existingItem.detailsJson) ? existingItem.detailsJson : {};
      const update = await tx.item.updateMany({
        where: { id: itemId },
        data: {
          detailsJson: json({
            ...existingDetails,
            aiGraderReportId: reportId,
            aiGraderPublicReportUrl: input.storagePlan.publicReportUrl,
            aiGraderFinalGrade: finalOverallGrade(input.productionRelease) ?? null,
            aiGraderLabel: label.labelGradeText ?? null,
            aiGraderActorAudit: actorAuditJson(input.actorAudit),
          }),
        },
      });
      itemUpdatedCount = update.count;
    }

    return {
      gradingSessionId,
      reportId,
      publicationStatus,
      session,
      report,
      grade,
      label: labelRow,
      publication,
      valuation,
      evidenceAssetCount,
      cardAssetUpdatedCount,
      itemUpdatedCount,
      storagePlan: input.storagePlan,
    };
  });
}

async function findAiGraderReportForProductionAsset(
  db: AiGraderProductionPrismaClient,
  reportId: string
): Promise<JsonRecord> {
  if (typeof db.aiGraderReport.findUnique !== "function") {
    throw new Error("AiGraderReport.findUnique is required for this production operation.");
  }
  const report = await db.aiGraderReport.findUnique({
    where: { reportId },
    select: {
      id: true,
      tenantId: true,
      sessionId: true,
      reportId: true,
      cardAssetId: true,
      itemId: true,
    },
  });
  if (!isRecord(report)) {
    throw new Error(`AI Grader report ${reportId} was not found.`);
  }
  return report;
}

export async function persistAiGraderSlabbedPhotoAsset(
  db: AiGraderProductionPrismaClient,
  input: AiGraderSlabbedPhotoPersistInput
): Promise<AiGraderSlabbedPhotoPersistResult> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required.");
  if (!input.reportId.trim()) throw new Error("reportId is required.");
  if (input.side !== "front" && input.side !== "back") throw new Error("side must be front or back.");
  if (!input.storageKey.trim()) throw new Error("storageKey is required.");
  if (!input.publicUrl.trim()) throw new Error("publicUrl is required.");
  if (!input.mimeType.trim()) throw new Error("mimeType is required.");
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) throw new Error("byteSize must be positive.");

  return runInTransaction(db, async (tx) => {
    const report = await findAiGraderReportForProductionAsset(tx as AiGraderProductionPrismaClient, input.reportId);
    const now = dateValue(input.uploadedAt);
    const artifactId = `slabbed-photo:${input.reportId}:${input.side}`;
    const asset = await tx.aiGraderEvidenceAsset.upsert({
      where: { tenantId_artifactId: { tenantId: input.tenantId, artifactId } },
      update: {
        sessionId: stringValue(report.sessionId, "") || null,
        reportId: stringValue(report.id, ""),
        artifactClass: "slabbed_photo",
        kind: `slabbed_${input.side}_color_photo`,
        side: input.side,
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        checksumSha256: input.checksumSha256 ?? null,
        mimeType: input.mimeType,
        byteSize: Math.round(input.byteSize),
        widthPx: input.widthPx ?? null,
        heightPx: input.heightPx ?? null,
        metadata: json({
          ...(input.metadata ?? {}),
          source: "ai_grader_slabbed_photo_upload_v0",
          uploadedByUserId: input.operatorUserId ?? null,
          uploadedAt: now.toISOString(),
          cardAssetId: report.cardAssetId ?? null,
          itemId: report.itemId ?? null,
          actorAudit: actorAuditJson(input.actorAudit),
        }),
      },
      create: {
        tenantId: input.tenantId,
        sessionId: stringValue(report.sessionId, "") || null,
        reportId: stringValue(report.id, ""),
        artifactId,
        artifactClass: "slabbed_photo",
        kind: `slabbed_${input.side}_color_photo`,
        side: input.side,
        storageKey: input.storageKey,
        publicUrl: input.publicUrl,
        checksumSha256: input.checksumSha256 ?? null,
        mimeType: input.mimeType,
        byteSize: Math.round(input.byteSize),
        widthPx: input.widthPx ?? null,
        heightPx: input.heightPx ?? null,
        metadata: json({
          ...(input.metadata ?? {}),
          source: "ai_grader_slabbed_photo_upload_v0",
          uploadedByUserId: input.operatorUserId ?? null,
          uploadedAt: now.toISOString(),
          cardAssetId: report.cardAssetId ?? null,
          itemId: report.itemId ?? null,
          actorAudit: actorAuditJson(input.actorAudit),
        }),
        createdAt: now,
      },
    });
    return {
      reportId: input.reportId,
      artifactId,
      side: input.side,
      storageKey: input.storageKey,
      publicUrl: input.publicUrl,
      asset,
    };
  });
}

export async function persistAiGraderValuationResult(
  db: AiGraderProductionPrismaClient,
  input: AiGraderValuationPersistInput
): Promise<AiGraderValuationPersistResult> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required.");
  if (!input.reportId.trim()) throw new Error("reportId is required.");
  const now = dateValue(input.requestedAt);
  const completedAt = input.completedAt === null ? null : input.status === "completed" ? dateValue(input.completedAt ?? now) : null;

  return runInTransaction(db, async (tx) => {
    const report = await findAiGraderReportForProductionAsset(tx as AiGraderProductionPrismaClient, input.reportId);
    const valuationId = `ai-grader-valuation:${input.reportId}`;
    const valuation = await tx.aiGraderValuation.upsert({
      where: { id: valuationId },
      update: {
        tenantId: input.tenantId,
        sessionId: stringValue(report.sessionId, "") || null,
        status: input.status,
        source: stringValue(input.source, "ebay_sold"),
        searchQuery: input.searchQuery ?? null,
        compsRefs: nullableJson(input.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.resultSummary, input.actorAudit)),
        valuationMinor: input.valuationMinor ?? null,
        valuationCurrency: input.valuationCurrency ?? "USD",
        requestedByUserId: input.requestedByUserId ?? null,
        requestedAt: now,
        completedAt,
        errorCode: input.errorCode ?? null,
        updatedAt: now,
      },
      create: {
        id: valuationId,
        tenantId: input.tenantId,
        sessionId: stringValue(report.sessionId, "") || null,
        reportId: stringValue(report.id, ""),
        status: input.status,
        source: stringValue(input.source, "ebay_sold"),
        searchQuery: input.searchQuery ?? null,
        compsRefs: nullableJson(input.compsRefs),
        resultSummary: nullableJson(withActorAudit(input.resultSummary, input.actorAudit)),
        valuationMinor: input.valuationMinor ?? null,
        valuationCurrency: input.valuationCurrency ?? "USD",
        requestedByUserId: input.requestedByUserId ?? null,
        requestedAt: now,
        completedAt,
        errorCode: input.errorCode ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      reportId: input.reportId,
      status: input.status,
      valuation,
    };
  });
}

export function createAiGraderProductionService(db: AiGraderProductionPrismaClient) {
  return {
    buildStoragePlan: buildAiGraderProductionStoragePlan,
    persistProductionRelease: (input: AiGraderProductionPersistInput) => persistAiGraderProductionRelease(db, input),
    persistSlabbedPhotoAsset: (input: AiGraderSlabbedPhotoPersistInput) => persistAiGraderSlabbedPhotoAsset(db, input),
    persistValuationResult: (input: AiGraderValuationPersistInput) => persistAiGraderValuationResult(db, input),
  };
}
