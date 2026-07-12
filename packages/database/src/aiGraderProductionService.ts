import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import {
  AI_GRADER_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_REPORT_BUNDLE_V02_VERSION,
  aiGraderPublishedDefectFindingV1Schema,
  aiGraderReportBundleV01Schema,
  aiGraderReportBundleV02Schema,
  aiGraderStoredDefectFindingV1Schema,
  isSafeAiGraderPublicAssetId,
  parseAiGraderDefectFindings,
  type AiGraderDefectFindingV1,
  type AiGraderPublishedDefectFindingV1,
} from "@tenkings/shared";

type JsonRecord = Record<string, unknown>;

type AiGraderPublicEvidenceRole =
  | "normalized_card"
  | "surface_heatmap"
  | "surface_vision"
  | "confidence_mask"
  | "measurement_overlay"
  | "directional_channel"
  | "roi_crop"
  | "other_evidence";

const AI_GRADER_PUBLIC_EVIDENCE_ROLES = new Set<AiGraderPublicEvidenceRole>([
  "normalized_card",
  "surface_heatmap",
  "surface_vision",
  "confidence_mask",
  "measurement_overlay",
  "directional_channel",
  "roi_crop",
  "other_evidence",
]);

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
  $queryRaw?: (...args: any[]) => Promise<unknown>;
  aiGraderSession: AiGraderProductionDbDelegate;
  aiGraderReport: AiGraderProductionDbDelegate;
  aiGraderEvidenceAsset: AiGraderProductionDbDelegate;
  aiGraderGrade: AiGraderProductionDbDelegate;
  aiGraderLabel: AiGraderProductionDbDelegate;
  aiGraderPublication: AiGraderProductionDbDelegate;
  aiGraderValuation: AiGraderProductionDbDelegate;
  cardAsset?: Pick<AiGraderProductionDbDelegate, "findUnique" | "updateMany">;
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
  geometry?: JsonRecord;
  geometryCaptureDecisions?: JsonRecord;
  captureTiming?: JsonRecord;
  ocrPrefill?: JsonRecord;
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
  sourceAssetSide?: "front" | "back";
  sourceEvidenceRole?: AiGraderPublicEvidenceRole;
  sourceImageWidthPx?: number;
  sourceImageHeightPx?: number;
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

export type AiGraderConfirmedPublishAuthorityInput = {
  tenantId: string;
  gradingSessionId: string;
  reportId: string;
  cardAssetId: string;
  itemId: string;
};

export type AiGraderConfirmedPublishAuthority = AiGraderConfirmedPublishAuthorityInput & {
  sessionId: string;
  reportRowId: string;
  confirmedIdentity: JsonRecord;
  finalOverallGrade?: number;
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

function boundedIdentityString(value: unknown) {
  const normalized = trimmedString(value).replace(/\s+/g, " ").slice(0, 240);
  return normalized || undefined;
}

function normalizeDurableConfirmedIdentity(
  value: unknown,
  cardAssetId: string,
  itemId: string,
): JsonRecord {
  const source = isRecord(value) ? value : {};
  const category = boundedIdentityString(source.category);
  const title = boundedIdentityString(source.title ?? source.displayTitle);
  const productSet = boundedIdentityString(source.productSet ?? source.set);
  return {
    ...(category === "sport" || category === "tcg" || category === "comics" ? { category } : {}),
    ...(title ? { title } : {}),
    ...(boundedIdentityString(source.playerName) ? { playerName: boundedIdentityString(source.playerName) } : {}),
    ...(boundedIdentityString(source.cardName) ? { cardName: boundedIdentityString(source.cardName) } : {}),
    ...(boundedIdentityString(source.teamName) ? { teamName: boundedIdentityString(source.teamName) } : {}),
    ...(boundedIdentityString(source.year) ? { year: boundedIdentityString(source.year) } : {}),
    ...(boundedIdentityString(source.manufacturer ?? source.company ?? source.brand)
      ? { manufacturer: boundedIdentityString(source.manufacturer ?? source.company ?? source.brand) }
      : {}),
    ...(boundedIdentityString(source.sport) ? { sport: boundedIdentityString(source.sport) } : {}),
    ...(boundedIdentityString(source.game) ? { game: boundedIdentityString(source.game) } : {}),
    ...(productSet ? { productSet, set: productSet } : {}),
    ...(boundedIdentityString(source.productLine) ? { productLine: boundedIdentityString(source.productLine) } : {}),
    ...(boundedIdentityString(source.insert) ? { insert: boundedIdentityString(source.insert) } : {}),
    ...(boundedIdentityString(source.insertSet) ? { insertSet: boundedIdentityString(source.insertSet) } : {}),
    ...(boundedIdentityString(source.parallel) ? { parallel: boundedIdentityString(source.parallel) } : {}),
    ...(boundedIdentityString(source.cardNumber ?? source.number)
      ? { cardNumber: boundedIdentityString(source.cardNumber ?? source.number) }
      : {}),
    ...(boundedIdentityString(source.numbered) ? { numbered: boundedIdentityString(source.numbered) } : {}),
    ...(typeof source.autograph === "boolean" ? { autograph: source.autograph } : {}),
    ...(typeof source.memorabilia === "boolean" ? { memorabilia: source.memorabilia } : {}),
    source: "card_asset",
    status: "linked",
    sideCount: 2,
    cardAssetId,
    itemId,
  };
}

function aiGraderPublishAuthorityError(code: string, message: string, statusCode = 409) {
  const error = new Error(message);
  (error as Error & { code?: string; statusCode?: number }).code = code;
  (error as Error & { code?: string; statusCode?: number }).statusCode = statusCode;
  return error;
}

export function applyAiGraderConfirmedPublishAuthority(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  authority: AiGraderConfirmedPublishAuthority;
}): {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
} {
  const { authority } = input;
  const confirmedIdentity = normalizeDurableConfirmedIdentity(
    authority.confirmedIdentity,
    authority.cardAssetId,
    authority.itemId,
  );
  const releaseLabel = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const linkage = isRecord(input.productionRelease.cardInventoryLinkage)
    ? input.productionRelease.cardInventoryLinkage
    : {};
  return {
    reportBundle: {
      ...input.reportBundle,
      gradingSessionId: authority.gradingSessionId,
      reportId: authority.reportId,
      cardIdentity: confirmedIdentity,
    },
    productionRelease: {
      ...input.productionRelease,
      gradingSessionId: authority.gradingSessionId,
      reportId: authority.reportId,
      label: {
        ...releaseLabel,
        reportId: authority.reportId,
        cardIdentity: confirmedIdentity,
      },
      cardInventoryLinkage: {
        ...linkage,
        status: "linked",
        cardAssetId: authority.cardAssetId,
        itemId: authority.itemId,
      },
    },
  };
}

function hasExactConfirmedIdentitySnapshot(
  value: unknown,
  authority: AiGraderConfirmedPublishAuthority,
) {
  if (!isRecord(value)) return false;
  const expected = normalizeDurableConfirmedIdentity(
    authority.confirmedIdentity,
    authority.cardAssetId,
    authority.itemId,
  );
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => value[key] === expected[key]);
}

function hasMatchingDurableConfirmedIdentity(
  value: unknown,
  authority: AiGraderConfirmedPublishAuthority,
) {
  if (!isRecord(value)) return false;
  if (
    trimmedString(value.source) !== "card_asset" ||
    trimmedString(value.status) !== "linked" ||
    trimmedString(value.cardAssetId) !== authority.cardAssetId ||
    trimmedString(value.itemId) !== authority.itemId
  ) {
    return false;
  }
  const expected = normalizeDurableConfirmedIdentity(
    authority.confirmedIdentity,
    authority.cardAssetId,
    authority.itemId,
  );
  const actual = normalizeDurableConfirmedIdentity(
    value,
    authority.cardAssetId,
    authority.itemId,
  );
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => actual[key] === expected[key]);
}

export function assertAiGraderDurableConfirmedIdentityMatchesAuthority(
  value: unknown,
  authority: AiGraderConfirmedPublishAuthority,
) {
  if (!hasMatchingDurableConfirmedIdentity(value, authority)) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_IDENTITY_AUTHORITY_CHANGED",
      "The durable confirmed identity changed after this Publish package was authorized; restart Publish from the authoritative confirmed report.",
    );
  }
}

export function assertAiGraderConfirmedPublishIdentitySnapshot(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  authority: AiGraderConfirmedPublishAuthority;
}) {
  const releaseLabel = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  if (
    !hasExactConfirmedIdentitySnapshot(input.reportBundle.cardIdentity, input.authority) ||
    !hasExactConfirmedIdentitySnapshot(releaseLabel.cardIdentity, input.authority)
  ) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_IDENTITY_AUTHORITY_CHANGED",
      "The durable confirmed identity changed after this Publish package was authorized; restart Publish from the authoritative confirmed report.",
    );
  }
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

function mergePersistedLabelPayload(existing: unknown, canonical: JsonRecord): Prisma.InputJsonValue {
  const existingPayload = isRecord(existing) ? existing : {};
  return {
    ...existingPayload,
    ...canonical,
    ...(existingPayload.labelSheet !== undefined ? { labelSheet: existingPayload.labelSheet } : {}),
    ...(existingPayload.physicalPrint !== undefined ? { physicalPrint: existingPayload.physicalPrint } : {}),
  } as Prisma.InputJsonValue;
}

function invalidatePersistedLabelPrint(payload: unknown, now: Date): Prisma.InputJsonValue {
  const current = isRecord(payload) ? payload : {};
  const labelSheet = isRecord(current.labelSheet) ? { ...current.labelSheet } : null;
  if (labelSheet) {
    delete labelSheet.printedAt;
    delete labelSheet.printedByUserId;
  }
  return {
    ...current,
    ...(labelSheet ? { labelSheet } : {}),
    physicalPrint: {
      status: "not_printed",
      invalidatedAt: now.toISOString(),
      reason: "printable_label_content_changed",
    },
  } as Prisma.InputJsonValue;
}

function hasProgressedRuntimeValuation(value: unknown) {
  if (!isRecord(value)) return false;
  return ["ready", "running", "completed", "failed"].includes(stringValue(value.status, ""));
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

function unsafeAiGraderPublicUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv4 = host.split(".").map((part) => Number(part));
    const isIpv4 = ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "::" ||
      host.startsWith("::ffff:") ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      /^fe[89ab]/.test(host) ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".localhost") ||
      (!isIpv4 && !host.includes(".") && !host.includes(":")) ||
      (isIpv4 && (ipv4[0] === 0 || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127))) ||
      (isIpv4 && ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19)) ||
      (isIpv4 && ipv4[0] >= 224) ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return true;
    const queryKeys = Array.from(parsed.searchParams.keys()).map((key) => key.toLowerCase());
    if (
      queryKeys.some(
        (key) =>
          key === "sig" ||
          key === "access_key" ||
          key.includes("signature") ||
          key.includes("credential") ||
          key.includes("security-token") ||
          key === "token" ||
          key.endsWith("_token") ||
          key.startsWith("x-amz-") ||
          key.startsWith("x-goog-")
      )
    ) return true;
    if (parsed.username || parsed.password) return true;
  } catch {}
  return false;
}

function looksLikeLocalPathOrLoopback(value: string) {
  if (/\b[a-z]:[\\/]/i.test(value) || /\\TenKings\\/i.test(value) || /(^|\s)\\\\[^\\]+\\/i.test(value)) return true;
  if (/(^|[\s('"=:])(\/Users\/|\/home\/|\/root\/|\/tmp\/|\/var\/tmp\/|\/app\/|\/workspace\/)/i.test(value)) return true;
  if (/(^|[\s('"=:])(data|blob):/i.test(value) || /\bfile:\/\//i.test(value)) return true;
  if (
    /x-ai-grader-station-token|stationToken\s*[=:]|service-token|DATABASE_URL|Authorization\s*:\s*Bearer|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)/i.test(value)
  ) return true;
  if (
    /\b(?:localhost|[a-z0-9-]+\.(?:local|internal|localhost)|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[789]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}|198\.(?:18|19)(?:\.\d{1,3}){2})(?::\d{1,5})?\b/i.test(value) ||
    /(^|[\s([])(?:\[?::1\]?|fc[0-9a-f:]+|fd[0-9a-f:]+|fe[89ab][0-9a-f:]+)(?::\d{1,5})?(?=$|[\s)\],;])/i.test(value)
  ) return true;
  const embeddedUrls = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return embeddedUrls.some((url) => unsafeAiGraderPublicUrl(url));
}

function unsafeAiGraderPublicKey(entryKey: string) {
  const compact = entryKey.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const credentialKey =
    compact === "bearer" ||
    compact === "authorization" ||
    compact.endsWith("token") ||
    compact.endsWith("apikey") ||
    compact.endsWith("accesskey") ||
    compact.endsWith("accesskeyid") ||
    compact.endsWith("secretkey") ||
    compact.endsWith("privatekey") ||
    compact.endsWith("password") ||
    compact.endsWith("credential") ||
    compact.endsWith("credentials") ||
    compact.includes("secret");
  const hardwareControlKey = new Set([
    "bridgeurl",
    "stationurl",
    "leimachost",
    "leimacport",
    "baslerbridgescript",
    "pylonroot",
    "hardwarecontrol",
    "hardwarecontrols",
    "hardwareaction",
    "hardwareactions",
    "hardwareactionsenabled",
    "cameracontrol",
    "cameracontrols",
    "lightingcontrol",
    "lightingcontrols",
  ]).has(compact);
  return credentialKey || hardwareControlKey;
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
          unsafeAiGraderPublicKey(entryKey) ||
          lowerKey.includes("stationtoken") ||
          lowerKey.includes("bridgetoken") ||
          lowerKey.includes("pairingcode") ||
          lowerKey.includes("presigned") ||
          lowerKey === "uploadurl" ||
          lowerKey === "bodybase64" ||
          lowerKey === "bodyencoding" ||
          lowerKey.includes("secret") ||
          lowerKey.includes("authorization")
        ) continue;
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

const AI_GRADER_UNAUTHORIZED_CLAIM_KEYS = new Set([
  "certifiedclaim",
  "certificationclaim",
  "certificategenerated",
]);

export function assertAiGraderNoCertifiedClaim(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAiGraderNoCertifiedClaim(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const compactKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (AI_GRADER_UNAUTHORIZED_CLAIM_KEYS.has(compactKey) && entry !== false) {
      throw new Error(`AI Grader certification claims are not authorized at ${path}.${key}.`);
    }
    assertAiGraderNoCertifiedClaim(entry, `${path}.${key}`);
  }
}

function stripAiGraderUnversionedPhysicalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAiGraderUnversionedPhysicalFields);
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const compactKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const physicalKey =
      compactKey === "dimensions" ||
      compactKey.startsWith("mmperpixel") ||
      compactKey.endsWith("mm") ||
      compactKey.includes("millimeter") ||
      compactKey.endsWith("inch") ||
      compactKey.endsWith("inches");
    if (physicalKey) continue;
    result[key] = stripAiGraderUnversionedPhysicalFields(entry);
  }
  return result;
}

const PUBLIC_GEOMETRY_CAPTURE_MODES = new Set(["detected_geometry", "manual_capture"]);
const PUBLIC_GEOMETRY_PLACEMENT_STATES = new Set(["not_detected", "adjust_card", "ready"]);
const SAFE_GEOMETRY_SOURCE_FRAME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function publicGeometryTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function publicManualBoundaryRect(value: unknown) {
  if (!isRecord(value) || value.coordinateFrame !== "basler_sensor_pixels") return undefined;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height, coordinateFrame: "basler_sensor_pixels" as const };
}

/**
 * Geometry capture decisions cross the local-station/production boundary, so
 * persist an explicit allowlist rather than recursively copying bridge state.
 */
export function normalizeAiGraderPublicGeometryCaptureDecisions(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const decisions: JsonRecord = {};
  for (const side of ["front", "back"] as const) {
    const raw = value[side];
    if (!isRecord(raw) || !PUBLIC_GEOMETRY_CAPTURE_MODES.has(String(raw.mode))) continue;
    const mode = String(raw.mode) as "detected_geometry" | "manual_capture";
    const rawPlacement = PUBLIC_GEOMETRY_PLACEMENT_STATES.has(String(raw.placementState))
      ? String(raw.placementState) as "not_detected" | "adjust_card" | "ready"
      : "not_detected";
    const placementState = mode === "manual_capture" && rawPlacement === "ready" ? "not_detected" : rawPlacement;
    const timestamp = publicGeometryTimestamp(raw.timestamp);
    const sourceFrameId =
      typeof raw.sourceFrameId === "string" && SAFE_GEOMETRY_SOURCE_FRAME_ID.test(raw.sourceFrameId)
        ? raw.sourceFrameId
        : undefined;

    if (mode === "manual_capture") {
      const manualBoundaryRect = publicManualBoundaryRect(raw.manualBoundaryRect);
      if (
        raw.explicitOperatorAction !== true ||
        raw.manualOverrideUsed !== true ||
        raw.detectionUsed !== false ||
        !manualBoundaryRect
      ) continue;
      decisions[side] = {
        mode,
        geometrySource: "manual_override",
        captureMode: "manual_capture",
        placementState,
        explicitOperatorAction: true,
        detectionUsed: false,
        manualOverrideUsed: true,
        manualBoundaryRect,
        ...(timestamp ? { timestamp } : {}),
        ...(sourceFrameId ? { sourceFrameId } : {}),
      };
      continue;
    }

    if (raw.detectionUsed !== true || raw.manualOverrideUsed === true) continue;
    decisions[side] = {
      mode,
      geometrySource: "detected",
      captureMode: "automatic_detection",
      placementState,
      explicitOperatorAction: false,
      detectionUsed: true,
      manualOverrideUsed: false,
      ...(timestamp ? { timestamp } : {}),
      ...(sourceFrameId ? { sourceFrameId } : {}),
    };
  }
  return Object.keys(decisions).length ? decisions : undefined;
}

const PUBLIC_CAPTURE_TIMING_SUMMARY_KEYS = [
  "previewReadyMs",
  "frontEdgeDetectionReadyMs",
  "backEdgeDetectionReadyMs",
  "frontPositioningMs",
  "backPositioningMs",
  "totalFrontMs",
  "totalBackMs",
  "frontProcessingMs",
  "backProcessingMs",
  "frontProcessingDuringFlipMs",
  "reportGenerationMs",
  "totalCardMs",
  "reportReadyTotalMs",
  "safeQueueLatencyMs",
] as const;
const PUBLIC_CAPTURE_TIMING_EVENT_IDS = new Set([
  "session_started",
  "preview_stream_started",
  "preview_ready",
  "edge_detection_ready",
  "capture_trigger",
  "raw_capture_completed",
  "side_processing_started",
  "side_processing_completed",
  "back_positioning_started",
  "report_generation_started",
  "report_ready",
  "safely_queued",
]);
const PUBLIC_CAPTURE_TIMING_PHASE_IDS = new Set([
  "lighting_profile",
  "frame_capture",
  "file_writes",
  "file_hashes",
  "crop_deskew",
  "grading_forensic_runner",
  "side_processing",
  "report_generation",
]);
const PUBLIC_OCR_FIELD_NAMES = [
  "category",
  "playerName",
  "cardName",
  "year",
  "manufacturer",
  "sport",
  "game",
  "productSet",
  "cardNumber",
  "parallel",
  "insert",
  "numbered",
  "autograph",
  "memorabilia",
] as const;
type PublicOcrFieldName = (typeof PUBLIC_OCR_FIELD_NAMES)[number];
const LEGACY_PUBLIC_OCR_FIELD_ALIASES: Partial<Record<PublicOcrFieldName, "auto" | "mem">> = {
  autograph: "auto",
  memorabilia: "mem",
};

function boundedPublicDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24 * 60 * 60 * 1000
    ? Math.round(value * 10) / 10
    : undefined;
}

/**
 * Browser publication input is not a hardware attestation. Preserve bounded
 * diagnostic timing, but never allow a caller-provided proof boolean to become
 * a public five-second claim.
 */
export function normalizeAiGraderPublicCaptureTiming(value: unknown): JsonRecord | undefined {
  if (!isRecord(value) || value.schemaVersion !== "ten-kings-ai-grader-capture-timing-v1") return undefined;
  const captureProfile = value.captureProfile === "production_fast" ? "production_fast" : "full_forensic";
  const rawSummary = isRecord(value.summary) ? value.summary : {};
  const summary: JsonRecord = {
    frontProcessingOverlappedFlip: rawSummary.frontProcessingOverlappedFlip === true,
  };
  for (const key of PUBLIC_CAPTURE_TIMING_SUMMARY_KEYS) {
    const duration = boundedPublicDuration(rawSummary[key]);
    if (duration !== undefined) summary[key] = duration;
  }
  const events = (Array.isArray(value.events) ? value.events : [])
    .filter(isRecord)
    .slice(0, 100)
    .flatMap((entry) => {
      const id = stringValue(entry.id, "");
      const at = stringValue(entry.at, "");
      const side = entry.side === "front" || entry.side === "back" ? entry.side : undefined;
      const triggerMode = entry.triggerMode === "operator" || entry.triggerMode === "auto" ? entry.triggerMode : undefined;
      if (!PUBLIC_CAPTURE_TIMING_EVENT_IDS.has(id) || !Number.isFinite(Date.parse(at))) return [];
      return [{ id, at: new Date(at).toISOString(), ...(side ? { side } : {}), ...(triggerMode ? { triggerMode } : {}) }];
    });
  const phases = (Array.isArray(value.phases) ? value.phases : [])
    .filter(isRecord)
    .slice(0, 100)
    .flatMap((entry) => {
      const id = stringValue(entry.id, "");
      const durationMs = boundedPublicDuration(entry.durationMs);
      const side = entry.side === "front" || entry.side === "back" ? entry.side : undefined;
      if (!PUBLIC_CAPTURE_TIMING_PHASE_IDS.has(id) || durationMs === undefined) return [];
      return [{ id, durationMs, ...(side ? { side } : {}) }];
    });
  const totalFrontMs = boundedPublicDuration(rawSummary.totalFrontMs);
  const totalBackMs = boundedPublicDuration(rawSummary.totalBackMs);
  return {
    schemaVersion: "ten-kings-ai-grader-capture-timing-v1",
    captureProfile,
    targetSideMs: 5000,
    hardwareMeasurement: false,
    events,
    phases,
    summary,
    target: {
      ...(totalFrontMs !== undefined ? { frontWithinTarget: totalFrontMs <= 5000 } : {}),
      ...(totalBackMs !== undefined ? { backWithinTarget: totalBackMs <= 5000 } : {}),
      fiveSecondsPerSideProven: false,
      hardwareMeasurementRequired: true,
      note: "Published browser timing is diagnostic only; five seconds per side requires a trusted supervised Dell hardware attestation.",
    },
  };
}

/**
 * OCR metadata may assist display, but it can never carry caller-controlled
 * claims that confirmation, publication, or inventory mutation occurred.
 */
function publicOcrEvidenceRefs(raw: JsonRecord) {
  const entries = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs
    : Array.isArray(raw.sources)
      ? raw.sources
      : [];
  return Array.from(new Set(entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(entry))))
    .slice(0, 24);
}

function publicOcrProvenanceIdentifier(value: unknown, fallback?: string) {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim().slice(0, 120);
  if (
    !candidate ||
    candidate.includes("..") ||
    candidate.includes(String.fromCharCode(92)) ||
    /^(?:https?|data|file):/i.test(candidate) ||
    /^[A-Za-z]:[\\/]/.test(candidate)
  ) return fallback;
  if (/^@[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(candidate)) return candidate;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(candidate) ? candidate : fallback;
}

function canonicalPublicOcrReviewFieldName(value: unknown): PublicOcrFieldName | null {
  if (value === "auto") return "autograph";
  if (value === "mem") return "memorabilia";
  return (PUBLIC_OCR_FIELD_NAMES as readonly unknown[]).includes(value)
    ? value as PublicOcrFieldName
    : null;
}

export function normalizeAiGraderPublicOcrPrefill(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const rawFields = isRecord(value.fields) ? value.fields : {};
  const fields: JsonRecord = {};
  for (const name of PUBLIC_OCR_FIELD_NAMES) {
    const legacyName = LEGACY_PUBLIC_OCR_FIELD_ALIASES[name];
    const raw = rawFields[name] ?? (legacyName ? rawFields[legacyName] : undefined);
    if (!isRecord(raw)) continue;
    const booleanField = name === "autograph" || name === "memorabilia";
    let fieldValue: string | boolean | null = booleanField
      ? typeof raw.value === "boolean" ? raw.value : null
      : typeof raw.value === "string" ? raw.value.slice(0, 240) : null;
    let state = raw.state === "supported" || raw.state === "unknown" || raw.state === "disagreement"
      ? raw.state
      : fieldValue === null
        ? "unknown"
        : "supported";
    if (state !== "supported") fieldValue = null;
    if (state === "supported" && fieldValue === null) state = "unknown";
    const confidence =
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? Math.max(0, Math.min(1, Math.round(raw.confidence * 1000) / 1000))
        : 0;
    fields[name] = {
      state,
      value: fieldValue,
      confidence,
      reviewRequired: state !== "supported" || raw.reviewRequired === true,
      evidenceRefs: publicOcrEvidenceRefs(raw),
    };
  }
  const provenance = isRecord(value.provenance) ? value.provenance : {};
  const requestedReviewFields = (Array.isArray(value.reviewFieldNames) ? value.reviewFieldNames : [])
    .map(canonicalPublicOcrReviewFieldName)
    .filter((name): name is PublicOcrFieldName => Boolean(name) && isRecord(fields[name!]));
  const reviewFieldNames = requestedReviewFields.length
    ? Array.from(new Set(requestedReviewFields))
    : Object.entries(fields)
      .filter(([, field]) => isRecord(field) && field.reviewRequired === true)
      .map(([name]) => name);
  const structuredExtractor = publicOcrProvenanceIdentifier(provenance.structuredExtractor);
  const structuredExtractionModel = publicOcrProvenanceIdentifier(provenance.structuredExtractionModel);
  return {
    ...(typeof value.reportId === "string" ? { reportId: value.reportId.slice(0, 200) } : {}),
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: Array.from(new Set((Array.isArray(value.sourceSides) ? value.sourceSides : [])
      .filter((side) => side === "front" || side === "back"))).slice(0, 2),
    fields,
    reviewFieldNames,
    provenance: {
      ocrEngine: publicOcrProvenanceIdentifier(provenance.ocrEngine, "existing_ten_kings_ocr"),
      attributeExtractor: publicOcrProvenanceIdentifier(
        provenance.attributeExtractor,
        "@tenkings/shared/extractCardAttributes"
      ),
      ...(structuredExtractor ? { structuredExtractor } : {}),
      ...(structuredExtractionModel ? { structuredExtractionModel } : {}),
      setLookupUsed: provenance.setLookupUsed === true,
      setIdentificationUsed: provenance.setIdentificationUsed === true,
    },
    warnings: (Array.isArray(value.warnings) ? value.warnings : [])
      .filter((warning): warning is string => typeof warning === "string")
      .slice(0, 20)
      .map((warning) => warning.slice(0, 500)),
  };
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
  const rawAssets = Array.isArray(input.reportBundle.publicAssets)
    ? input.reportBundle.publicAssets
    : Array.isArray(input.reportBundle.assets)
      ? input.reportBundle.assets
      : [];
  const seenStorageKeys = new Set<string>();
  const seenSourceAssetIds = new Set<string>();
  const artifacts: AiGraderProductionArtifactPlan[] = [];
  rawAssets.filter(isRecord).forEach((asset, index) => {
    const bodyBase64 = stringValue(asset.bodyBase64, "");
    const contentType = stringValue(asset.contentType, "application/octet-stream").toLowerCase();
    if (!contentType.startsWith("image/")) return;
    if (!AI_GRADER_PUBLIC_IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new Error("AI Grader public report image assets must use an approved raster image type.");
    }
    if (!isImageAssetRecord(asset)) return;
    const id = stringValue(asset.id, "");
    if (!isSafeAiGraderPublicAssetId(id)) {
      throw new Error("AI Grader report contains an unsafe public image asset ID.");
    }
    const canonicalId = id.toLowerCase();
    if (seenSourceAssetIds.has(canonicalId)) {
      throw new Error("AI Grader report contains duplicate public image asset IDs.");
    }
    seenSourceAssetIds.add(canonicalId);
    const sourceAssetSide = asset.side === "front" || asset.side === "back" ? asset.side : undefined;
    const sourceEvidenceRole =
      typeof asset.evidenceRole === "string" && AI_GRADER_PUBLIC_EVIDENCE_ROLES.has(asset.evidenceRole as AiGraderPublicEvidenceRole)
        ? asset.evidenceRole as AiGraderPublicEvidenceRole
        : undefined;
    if (asset.evidenceRole !== undefined && !sourceEvidenceRole) {
      throw new Error("AI Grader report contains an unsupported public image evidence role.");
    }
    if (sourceEvidenceRole && !sourceAssetSide) {
      throw new Error("AI Grader report evidence-role image assets require a front or back side.");
    }
    const sourceImageWidthPx = positiveIntegerValue(asset.widthPx);
    const sourceImageHeightPx = positiveIntegerValue(asset.heightPx);
    if ((sourceImageWidthPx && !sourceImageHeightPx) || (!sourceImageWidthPx && sourceImageHeightPx)) {
      throw new Error("AI Grader report image dimensions must include both widthPx and heightPx.");
    }
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
        ...(sourceAssetSide ? { sourceAssetSide } : {}),
        ...(sourceEvidenceRole ? { sourceEvidenceRole } : {}),
        ...(sourceImageWidthPx && sourceImageHeightPx ? { sourceImageWidthPx, sourceImageHeightPx } : {}),
    });
  });
  return artifacts;
}

type AiGraderPublicCalibrationProfile =
  | { isCalibrated: false }
  | {
      isCalibrated: true;
      calibrationVersion: string;
      coordinateFrame: "normalized_card_portrait_pixels";
      mmPerPixelX: number;
      mmPerPixelY: number;
    };

function publicCalibrationProfile(value: unknown): AiGraderPublicCalibrationProfile | undefined {
  if (!isRecord(value)) return undefined;
  if (value.isCalibrated !== true) return { isCalibrated: false };
  const calibrationVersion = typeof value.calibrationVersion === "string" ? value.calibrationVersion.trim() : "";
  const mmPerPixelX = numberValue(value.mmPerPixelX);
  const mmPerPixelY = numberValue(value.mmPerPixelY);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(calibrationVersion) ||
    value.coordinateFrame !== "normalized_card_portrait_pixels" ||
    mmPerPixelX === undefined ||
    mmPerPixelY === undefined ||
    mmPerPixelX <= 0 ||
    mmPerPixelY <= 0
  ) {
    throw new Error("AI Grader calibrated measurement projection requires a complete versioned normalized-card calibration profile.");
  }
  return {
    isCalibrated: true,
    calibrationVersion,
    coordinateFrame: "normalized_card_portrait_pixels",
    mmPerPixelX,
    mmPerPixelY,
  };
}

function findingFractionBounds(finding: AiGraderDefectFindingV1) {
  const shape = finding.geometry.shape;
  if (shape.type === "box") return { width: shape.width, height: shape.height };
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function roundPublishedMeasurement(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function publishedFindingMeasurements(
  finding: AiGraderDefectFindingV1,
  asset: JsonRecord | undefined,
  calibration: AiGraderPublicCalibrationProfile | undefined,
) {
  if (!calibration || calibration.isCalibrated !== true) return undefined;
  const widthPx = positiveIntegerValue(asset?.widthPx);
  const heightPx = positiveIntegerValue(asset?.heightPx);
  if (!widthPx || !heightPx) {
    throw new Error("AI Grader calibrated finding projection requires normalized image dimensions.");
  }
  const bounds = findingFractionBounds(finding);
  const horizontalMm = bounds.width * widthPx * calibration.mmPerPixelX;
  const verticalMm = bounds.height * heightPx * calibration.mmPerPixelY;
  return {
    lengthMm: roundPublishedMeasurement(Math.max(horizontalMm, verticalMm)),
    widthMm: roundPublishedMeasurement(Math.min(horizontalMm, verticalMm)),
    calibrationVersion: calibration.calibrationVersion,
  };
}

function publicDefectFindings(
  value: unknown,
  publicAssets: JsonRecord[],
  strict: boolean,
  calibration?: AiGraderPublicCalibrationProfile,
): AiGraderPublishedDefectFindingV1[] {
  if (strict && Array.isArray(value)) {
    value.forEach((finding, index) => {
      const stored = aiGraderStoredDefectFindingV1Schema.safeParse(finding);
      if (!stored.success) {
        throw new Error(`AI Grader stored defect finding ${index} does not satisfy the v1 runtime schema.`);
      }
    });
  }
  const assetById = new Map(
    publicAssets
      .filter((asset) => isSafeAiGraderPublicAssetId(asset.id))
      .map((asset) => [String(asset.id), asset] as const),
  );
  const parsed = parseAiGraderDefectFindings(value, {
    knownAssetIds: new Set(assetById.keys()),
    requireTrueViewAsset: true,
  });
  let semanticIssueCount = 0;
  const matches = (assetId: string | undefined, side: "front" | "back", role: AiGraderPublicEvidenceRole) => {
    if (!assetId) return true;
    const asset = assetById.get(assetId);
    return asset?.side === side && asset.evidenceRole === role;
  };
  const findings = parsed.findings.flatMap<AiGraderPublishedDefectFindingV1>((finding) => {
    const evidence = finding.evidence;
    const valid =
      matches(evidence.trueViewAssetId, finding.side, "normalized_card") &&
      matches(evidence.heatmapAssetId, finding.side, "surface_heatmap") &&
      matches(evidence.surfaceVisionAssetId, finding.side, "surface_vision") &&
      matches(evidence.maskAssetId, finding.side, "confidence_mask") &&
      matches(evidence.overlayAssetId, finding.side, "measurement_overlay") &&
      evidence.channelAssetIds.every((assetId) => matches(assetId, finding.side, "directional_channel")) &&
      evidence.roiAssetIds.every((assetId) => matches(assetId, finding.side, "roi_crop"));
    if (!valid) {
      semanticIssueCount += 1;
      return [];
    }
    const measurements = publishedFindingMeasurements(
      finding,
      evidence.trueViewAssetId ? assetById.get(evidence.trueViewAssetId) : undefined,
      calibration,
    );
    const shape = finding.geometry.shape.type === "box"
      ? { kind: "box" as const, x: finding.geometry.shape.x, y: finding.geometry.shape.y, width: finding.geometry.shape.width, height: finding.geometry.shape.height }
      : { kind: "polygon" as const, points: finding.geometry.shape.points };
    const published = aiGraderPublishedDefectFindingV1Schema.safeParse({
      schemaVersion: finding.schemaVersion,
      findingId: finding.findingId,
      side: finding.side,
      category: finding.category,
      detector: finding.detector,
      severity: finding.severity,
      confidence: finding.confidence,
      review: { status: "unreviewed" as const },
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape,
      },
      evidence: {
        trueViewAssetId: evidence.trueViewAssetId,
        ...(evidence.heatmapAssetId ? { heatmapAssetId: evidence.heatmapAssetId } : {}),
        ...(evidence.maskAssetId ? { maskAssetId: evidence.maskAssetId } : {}),
        channelAssetIds: evidence.channelAssetIds,
        roiAssetIds: evidence.roiAssetIds,
      },
      ...(measurements ? { measurements } : {}),
      explanation: `AI-detected provisional ${finding.category.replace(/_/g, " ")} finding. Review the linked evidence before relying on this finding.`,
    });
    if (!published.success) {
      semanticIssueCount += 1;
      return [];
    }
    return [published.data];
  });
  if (strict && (parsed.issues.length || semanticIssueCount)) {
    throw new Error("AI Grader report contains invalid public defect findings.");
  }
  return findings;
}

function storedFindingsFromPublishedProjection(value: unknown): AiGraderDefectFindingV1[] {
  if (!Array.isArray(value)) {
    throw new Error("AI Grader v0.2 report bundles require top-level published defectFindings.");
  }
  const seenFindingIds = new Set<string>();
  return value.map((entry, index) => {
    const published = aiGraderPublishedDefectFindingV1Schema.safeParse(entry);
    if (!published.success) {
      throw new Error(`AI Grader published defect finding ${index} does not satisfy the v1 runtime schema.`);
    }
    const canonicalId = published.data.findingId.toLowerCase();
    if (seenFindingIds.has(canonicalId)) {
      throw new Error("AI Grader report contains duplicate public defect finding IDs.");
    }
    seenFindingIds.add(canonicalId);
    const shape = published.data.geometry.shape.kind === "box"
      ? {
          type: "box" as const,
          x: published.data.geometry.shape.x,
          y: published.data.geometry.shape.y,
          width: published.data.geometry.shape.width,
          height: published.data.geometry.shape.height,
        }
      : { type: "polygon" as const, points: published.data.geometry.shape.points };
    const stored = aiGraderStoredDefectFindingV1Schema.safeParse({
      schemaVersion: published.data.schemaVersion,
      findingId: published.data.findingId,
      side: published.data.side,
      category: published.data.category,
      detector: published.data.detector,
      severity: published.data.severity,
      confidence: published.data.confidence,
      review: { status: "unreviewed" },
      geometry: {
        coordinateFrame: "normalized_card",
        units: "fraction",
        shape,
      },
      evidence: {
        trueViewAssetId: published.data.evidence.trueViewAssetId,
        ...(published.data.evidence.heatmapAssetId
          ? { heatmapAssetId: published.data.evidence.heatmapAssetId }
          : {}),
        ...(published.data.evidence.maskAssetId
          ? { maskAssetId: published.data.evidence.maskAssetId }
          : {}),
        channelAssetIds: published.data.evidence.channelAssetIds,
        roiAssetIds: published.data.evidence.roiAssetIds,
      },
      explanation: published.data.explanation,
    });
    if (!stored.success) {
      throw new Error(`AI Grader published defect finding ${index} cannot be projected to fraction-only storage.`);
    }
    return stored.data;
  });
}

function legacyPublicDefectFindingsForRead(value: unknown, publicAssets: JsonRecord[]): AiGraderDefectFindingV1[] {
  const assetById = new Map(
    publicAssets
      .filter((asset) => isSafeAiGraderPublicAssetId(asset.id))
      .map((asset) => [String(asset.id), asset] as const),
  );
  const parsed = parseAiGraderDefectFindings(value, {
    knownAssetIds: new Set(assetById.keys()),
    requireTrueViewAsset: true,
  });
  const matches = (assetId: string | undefined, side: "front" | "back", role: AiGraderPublicEvidenceRole) => {
    if (!assetId) return true;
    const asset = assetById.get(assetId);
    return asset?.side === side && asset.evidenceRole === role;
  };
  return parsed.findings.filter((finding) => {
    const evidence = finding.evidence;
    return (
      matches(evidence.trueViewAssetId, finding.side, "normalized_card") &&
      matches(evidence.heatmapAssetId, finding.side, "surface_heatmap") &&
      matches(evidence.surfaceVisionAssetId, finding.side, "surface_vision") &&
      matches(evidence.maskAssetId, finding.side, "confidence_mask") &&
      matches(evidence.overlayAssetId, finding.side, "measurement_overlay") &&
      evidence.channelAssetIds.every((assetId) => matches(assetId, finding.side, "directional_channel")) &&
      evidence.roiAssetIds.every((assetId) => matches(assetId, finding.side, "roi_crop"))
    );
  }).map((finding) => ({
    ...finding,
    review: { status: "unreviewed" as const },
    explanation: `AI-detected provisional ${finding.category.replace(/_/g, " ")} finding. Review the linked evidence before relying on this finding.`,
  }));
}

function hasOwn(value: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasAiGraderFindingCandidateEvidence(reportBundle: JsonRecord, visionLab: JsonRecord) {
  return (
    hasOwn(visionLab, "defectFindings") ||
    hasOwn(visionLab, "findingContractVersion") ||
    hasOwn(reportBundle, "defectFindings")
  );
}

function assertValidAiGraderFindingExtraction(
  value: unknown,
  rawFindings: unknown,
  reportBundle: JsonRecord,
  visionLab: JsonRecord,
) {
  const findingCount = Array.isArray(rawFindings) ? rawFindings.length : 0;
  if (value === undefined) {
    const isCandidateFreeLegacyV01 =
      reportBundle.schemaVersion === "ai-grader-report-bundle-v0.1" &&
      !hasAiGraderFindingCandidateEvidence(reportBundle, visionLab);
    if (!isCandidateFreeLegacyV01) {
      throw new Error("AI Grader defect findings require a valid extraction status.");
    }
    return;
  }
  if (!isRecord(value)) throw new Error("AI Grader defect finding validation must be an object.");
  const status = value.status;
  const sourceCandidateCount = positiveIntegerValue(value.sourceCandidateCount) ?? (value.sourceCandidateCount === 0 ? 0 : undefined);
  const publishedFindingCount = positiveIntegerValue(value.publishedFindingCount) ?? (value.publishedFindingCount === 0 ? 0 : undefined);
  const issues = value.issues;
  if (
    status !== "valid" ||
    sourceCandidateCount === undefined ||
    publishedFindingCount === undefined ||
    !Array.isArray(issues) ||
    issues.length > 0 ||
    sourceCandidateCount !== publishedFindingCount ||
    publishedFindingCount !== findingCount
  ) {
    throw new Error("AI Grader defect finding extraction did not complete cleanly.");
  }
}

function validateFindingIdReferences(value: unknown, knownFindingIds: ReadonlySet<string>) {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (!isRecord(entry) || entry.findingIds === undefined) continue;
    if (
      !Array.isArray(entry.findingIds) ||
      entry.findingIds.some((findingId) => typeof findingId !== "string" || !knownFindingIds.has(findingId))
    ) {
      throw new Error("AI Grader report contains an invalid defect finding reference.");
    }
  }
}

function filterFindingIdReferences(value: unknown, knownFindingIds: ReadonlySet<string>) {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (!isRecord(entry) || entry.findingIds === undefined) return entry;
    const { findingIds: rawFindingIds, ...rest } = entry;
    if (!Array.isArray(rawFindingIds)) return rest;
    const findingIds = rawFindingIds.filter((findingId): findingId is string =>
      typeof findingId === "string" && knownFindingIds.has(findingId)
    );
    return findingIds.length ? { ...rest, findingIds } : rest;
  });
}

const LEGACY_AI_GRADER_PUBLIC_ASSET_ID = /^[a-z0-9][a-z0-9._-]{0,220}:[1-9][0-9]{0,3}$/;
const AI_GRADER_PUBLIC_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeAiGraderStorageKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024) return false;
  if (/^[\\/]|[\\?#\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== ".." && /^[A-Za-z0-9][A-Za-z0-9._-]{0,240}$/.test(segment));
}

function safeAiGraderReadAssetUrl(value: unknown, storageKey: string) {
  if (typeof value !== "string" || !value || looksLikeLocalPathOrLoopback(value)) return undefined;
  const expectedSuffix = `/${storageKey}`;
  if (value.startsWith("/") && !value.startsWith("//") && !/[?#]/.test(value)) {
    return value.endsWith(expectedSuffix) ? value : undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.search || parsed.hash || parsed.username || parsed.password || unsafeAiGraderPublicUrl(value)) {
      return undefined;
    }
    return parsed.pathname.endsWith(expectedSuffix) ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAiGraderReadPublicAssets(
  value: unknown,
  expectedStorageKeyPrefix: string,
  publicUrlFor: (storageKey: string) => string,
): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  const assets: JsonRecord[] = [];
  const seenIds = new Set<string>();
  const seenStorageKeys = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!isSafeAiGraderPublicAssetId(id) && !LEGACY_AI_GRADER_PUBLIC_ASSET_ID.test(id)) continue;
    const canonicalId = id.toLowerCase();
    if (seenIds.has(canonicalId)) continue;
    const contentType = typeof raw.contentType === "string" ? raw.contentType.toLowerCase() : "";
    const checksumSha256 = checksumValue(raw.checksumSha256 ?? raw.sha256);
    const byteSize = positiveIntegerValue(raw.byteSize);
    const storageKey = safeAiGraderStorageKey(raw.storageKey) ? raw.storageKey : undefined;
    if (!storageKey?.startsWith(expectedStorageKeyPrefix) || seenStorageKeys.has(storageKey)) continue;
    const publicUrl = safeAiGraderReadAssetUrl(publicUrlFor(storageKey), storageKey);
    if (!AI_GRADER_PUBLIC_IMAGE_CONTENT_TYPES.has(contentType) || !checksumSha256 || !byteSize || !storageKey || !publicUrl) continue;
    const side = raw.side === "front" || raw.side === "back" ? raw.side : undefined;
    const widthPx = positiveIntegerValue(raw.widthPx);
    const heightPx = positiveIntegerValue(raw.heightPx);
    if ((widthPx && !heightPx) || (!widthPx && heightPx)) continue;
    const evidenceRole =
      typeof raw.evidenceRole === "string" && AI_GRADER_PUBLIC_EVIDENCE_ROLES.has(raw.evidenceRole as AiGraderPublicEvidenceRole)
        ? raw.evidenceRole as AiGraderPublicEvidenceRole
        : undefined;
    if (evidenceRole && !side) continue;
    seenIds.add(canonicalId);
    seenStorageKeys.add(storageKey);
    assets.push({
      id,
      kind: "report-image",
      fileName: safeAssetFileName(stringValue(raw.fileName, id), "report-image"),
      contentType,
      storageKey,
      publicUrl,
      byteSize,
      checksumSha256,
      ...(widthPx && heightPx ? { widthPx, heightPx } : {}),
      ...(side ? { side } : {}),
      ...(evidenceRole ? { evidenceRole } : {}),
    });
  }
  return assets;
}

export function sanitizeAiGraderPublicReportBundleForRead(
  value: unknown,
  options: {
    expectedReportId?: string;
    publicUrlFor?: (storageKey: string) => string;
  } = {},
): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized = sanitizeAiGraderPublicJson(value);
  if (!isRecord(sanitized)) return undefined;
  try {
    assertAiGraderNoCertifiedClaim(sanitized, "storedReportBundle");
  } catch {
    return undefined;
  }
  const bundleReportId = typeof sanitized.reportId === "string" ? sanitized.reportId.trim() : "";
  const expectedReportId = options.expectedReportId?.trim() || bundleReportId;
  if (!expectedReportId || (bundleReportId && bundleReportId !== expectedReportId)) return undefined;
  const expectedStorageKeyPrefix = `ai-grader/reports/${safeSegment(expectedReportId)}/assets/`;
  const publicUrlFor = options.publicUrlFor ?? ((storageKey: string) => `/storage/${storageKey}`);
  const selectedAssets = Array.isArray(sanitized.publicAssets)
    ? sanitized.publicAssets
    : Array.isArray(sanitized.assets)
      ? sanitized.assets
      : [];
  const publicAssets = normalizeAiGraderReadPublicAssets(selectedAssets, expectedStorageKeyPrefix, publicUrlFor);
  if (sanitized.schemaVersion === AI_GRADER_REPORT_BUNDLE_V02_VERSION) {
    const parsed = aiGraderReportBundleV02Schema.safeParse({
      ...sanitized,
      assets: publicAssets,
      publicAssets,
    });
    return parsed.success ? parsed.data : undefined;
  }
  if (sanitized.schemaVersion === undefined) {
    return sanitizeLegacyAiGraderPublicReportBundleForRead(sanitized, publicAssets);
  }
  if (sanitized.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V01_VERSION) return undefined;
  const legacyParsed = aiGraderReportBundleV01Schema.safeParse({
    ...sanitized,
    assets: publicAssets,
    publicAssets,
  });
  if (!legacyParsed.success) return undefined;
  return sanitizeLegacyAiGraderPublicReportBundleForRead(legacyParsed.data as JsonRecord, publicAssets);
}

/**
 * Read-only compatibility for public reports persisted before bundle versioning.
 * Publish remains strict v0.1/v0.2; a present-but-unknown version never enters
 * this path. Do not synthesize generatedAt, certifiedClaim, or any grade data.
 */
function sanitizeLegacyAiGraderPublicReportBundleForRead(
  legacyBundle: JsonRecord,
  publicAssets: JsonRecord[],
): JsonRecord {
  const visionLab = isRecord(legacyBundle.visionLab) ? legacyBundle.visionLab : {};
  const findings = legacyPublicDefectFindingsForRead(visionLab.defectFindings, publicAssets);
  const knownFindingIds = new Set(findings.map((finding) => finding.findingId));
  const provisionalGrade = isRecord(legacyBundle.provisionalGrade) ? legacyBundle.provisionalGrade : undefined;
  const productionRelease = isRecord(legacyBundle.productionRelease) ? legacyBundle.productionRelease : undefined;
  const finalGrade = productionRelease && isRecord(productionRelease.finalGrade) ? productionRelease.finalGrade : undefined;
  return {
    ...legacyBundle,
    assets: publicAssets,
    publicAssets,
    ...(provisionalGrade
      ? { provisionalGrade: { ...provisionalGrade, gradeImpactCandidates: filterFindingIdReferences(provisionalGrade.gradeImpactCandidates, knownFindingIds) } }
      : {}),
    ...(productionRelease
      ? {
          productionRelease: {
            ...productionRelease,
            ...(finalGrade
              ? { finalGrade: { ...finalGrade, gradeImpactReasons: filterFindingIdReferences(finalGrade.gradeImpactReasons, knownFindingIds) } }
              : {}),
          },
        }
      : {}),
    visionLab: {
      ...visionLab,
      ...(findings.length ? { defectFindings: findings } : { defectFindings: [] }),
    },
  };
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

function validatedAiGraderReportEvidence(input: {
  reportId: string;
  storageKeyPrefix: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  publicUrlFor: (storageKey: string) => string;
  canonicalAssetsOnly?: boolean;
}) {
  const reportAssets = reportAssetArtifacts({
    reportId: input.reportId,
    storageKeyPrefix: input.storageKeyPrefix,
    reportBundle: input.canonicalAssetsOnly
      ? { ...input.reportBundle, publicAssets: undefined }
      : input.reportBundle,
    publicUrlFor: input.publicUrlFor,
  });
  const calibrationProfile = publicCalibrationProfile(input.reportBundle.calibrationProfile);
  const publicAssets = reportAssets.map((entry) => ({
    id: entry.sourceAssetId,
    kind: entry.kind,
    fileName: entry.storageKey.split("/").pop(),
    contentType: entry.contentType,
    storageKey: entry.storageKey,
    publicUrl: entry.publicUrl,
    byteSize: entry.byteSize,
    checksumSha256: entry.checksumSha256,
    ...(entry.sourceImageWidthPx && entry.sourceImageHeightPx
      ? { widthPx: entry.sourceImageWidthPx, heightPx: entry.sourceImageHeightPx }
      : {}),
    ...(entry.sourceAssetSide ? { side: entry.sourceAssetSide } : {}),
    ...(entry.sourceEvidenceRole ? { evidenceRole: entry.sourceEvidenceRole } : {}),
  }));
  const rawVisionLab = isRecord(input.reportBundle.visionLab) ? input.reportBundle.visionLab : {};
  const storedFindings = input.reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V02_VERSION
    ? storedFindingsFromPublishedProjection(input.reportBundle.defectFindings)
    : rawVisionLab.defectFindings;
  if (input.reportBundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V02_VERSION) {
    assertValidAiGraderFindingExtraction(
      rawVisionLab.findingValidation,
      rawVisionLab.defectFindings,
      input.reportBundle,
      rawVisionLab,
    );
  }
  const defectFindings = publicDefectFindings(storedFindings, publicAssets, true, calibrationProfile);
  const knownFindingIds = new Set(defectFindings.map((finding) => finding.findingId));
  const provisionalGrade = isRecord(input.reportBundle.provisionalGrade) ? input.reportBundle.provisionalGrade : {};
  validateFindingIdReferences(provisionalGrade.gradeImpactCandidates, knownFindingIds);
  const releaseFinalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
  validateFindingIdReferences(releaseFinalGrade.gradeImpactReasons, knownFindingIds);
  return { reportAssets, calibrationProfile, publicAssets, defectFindings };
}

export type AiGraderConfirmCardImageReference = {
  artifactId: string;
  artifactClass: "report_asset";
  kind: "report-image";
  sourceAssetId: string;
  sourceAssetSide: "front" | "back";
  sourceEvidenceRole: "normalized_card";
  reservedStorageKey: string;
  contentType: "image/png";
  checksumSha256: string;
  byteSize: number;
  sourceImageWidthPx: 1200;
  sourceImageHeightPx: 1680;
};

export type AiGraderConfirmCardReferencePlan = {
  planVersion: "ai-grader-confirm-card-reference-plan-v1";
  reportId: string;
  gradingSessionId: string;
  storageKeyPrefix: string;
  imageReferences: [AiGraderConfirmCardImageReference, AiGraderConfirmCardImageReference];
};

type AiGraderConfirmCardReferenceInput = {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  publicReportBaseUrl?: string;
  storageKeyPrefix?: string;
  publicUrlFor?: (storageKey: string) => string;
};

/** Confirm validates evidence but never projects publication, label, or QR artifacts. */
export function buildAiGraderConfirmCardReferencePlan(input: AiGraderConfirmCardReferenceInput): AiGraderConfirmCardReferencePlan {
  assertAiGraderNoCertifiedClaim(input.reportBundle, "reportBundle");
  assertAiGraderNoCertifiedClaim(input.productionRelease, "productionRelease");
  return finishAiGraderConfirmCardReferencePlan(input);
}

function finishAiGraderConfirmCardReferencePlan(input: AiGraderConfirmCardReferenceInput): AiGraderConfirmCardReferencePlan {
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "");
  const gradingSessionId = stringValue(input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId, "");
  return finishAiGraderConfirmIdentity(input, reportId, gradingSessionId);
}

function finishAiGraderConfirmIdentity(input: AiGraderConfirmCardReferenceInput, reportId: string, gradingSessionId: string) {
  if (!reportId || !gradingSessionId) throw new Error("AI Grader report and grading session identity are required for confirmation.");
  return finishAiGraderConfirmEvidence(input, reportId, gradingSessionId);
}

function finishAiGraderConfirmEvidence(
  input: AiGraderConfirmCardReferenceInput,
  reportId: string,
  gradingSessionId: string,
) {
  const visionLab = isRecord(input.reportBundle.visionLab) ? input.reportBundle.visionLab : {};
  if (!isRecord(visionLab.findingValidation)) {
    throw new Error("Current AI Grader Confirm Card packages require a valid finding extraction status.");
  }
  const assets = Array.isArray(input.reportBundle.assets) ? input.reportBundle.assets.filter(isRecord) : [];
  for (const asset of assets) {
    if (asset.evidenceRole !== "normalized_card") continue;
    const checksumSha256 = checksumValue(asset.checksumSha256);
    const sha256 = checksumValue(asset.sha256);
    if (checksumSha256 && sha256 && checksumSha256 !== sha256) {
      throw new Error("AI Grader normalized-card evidence contains conflicting SHA-256 values.");
    }
  }
  return finishAiGraderConfirmReferences(input, reportId, gradingSessionId);
}

function finishAiGraderConfirmReferences(
  input: AiGraderConfirmCardReferenceInput,
  reportId: string,
  gradingSessionId: string,
) {
  const prefix = (input.storageKeyPrefix ?? `ai-grader/reports/${safeSegment(reportId)}/`)
    .replace(/^\/+/, "")
    .replace(/\/?$/, "/");
  const base = publicBase(input.publicReportBaseUrl);
  const publicUrlFor = input.publicUrlFor ?? ((key: string) => `${base}/storage/${key}`);
  const validated = validatedAiGraderReportEvidence({
    reportId,
    storageKeyPrefix: prefix,
    reportBundle: input.reportBundle,
    productionRelease: input.productionRelease,
    publicUrlFor,
    canonicalAssetsOnly: true,
  });
  return buildAiGraderConfirmReferences(reportId, gradingSessionId, prefix, validated.reportAssets);
}

function aiGraderConfirmReferenceForSide(
  normalized: AiGraderProductionArtifactPlan[],
  side: "front" | "back",
): AiGraderConfirmCardImageReference | undefined {
  const matches = normalized.filter((entry) => entry.sourceAssetSide === side);
  const entry = matches.length === 1 ? matches[0] : undefined;
  if (!entry || entry.contentType !== "image/png" || entry.sourceImageWidthPx !== 1200 || entry.sourceImageHeightPx !== 1680) {
    return undefined;
  }
  if (!entry.sourceAssetId || !/^[a-f0-9]{64}$/.test(entry.checksumSha256)) return undefined;
  if (!Number.isSafeInteger(entry.byteSize) || entry.byteSize < 1) return undefined;
  return aiGraderConfirmReference(entry, side);
}

function aiGraderConfirmReference(
  entry: AiGraderProductionArtifactPlan,
  side: "front" | "back",
): AiGraderConfirmCardImageReference {
  return {
    artifactId: entry.artifactId,
    artifactClass: "report_asset",
    kind: "report-image",
    sourceAssetId: entry.sourceAssetId as string,
    sourceAssetSide: side,
    sourceEvidenceRole: "normalized_card",
    reservedStorageKey: entry.storageKey,
    contentType: "image/png",
    checksumSha256: entry.checksumSha256,
    byteSize: entry.byteSize,
    sourceImageWidthPx: 1200,
    sourceImageHeightPx: 1680,
  };
}

function buildAiGraderConfirmReferences(
  reportId: string,
  gradingSessionId: string,
  storageKeyPrefix: string,
  reportAssets: AiGraderProductionArtifactPlan[],
): AiGraderConfirmCardReferencePlan {
  const normalized = reportAssets.filter((entry) => entry.sourceEvidenceRole === "normalized_card");
  const front = aiGraderConfirmReferenceForSide(normalized, "front");
  const back = aiGraderConfirmReferenceForSide(normalized, "back");
  if (normalized.length !== 2 || !front || !back || front.sourceAssetId.toLowerCase() === back.sourceAssetId.toLowerCase()) {
    throw new Error("Confirm Card requires exactly one verified 1200x1680 PNG normalized-card asset for each side.");
  }
  return {
    planVersion: "ai-grader-confirm-card-reference-plan-v1",
    reportId,
    gradingSessionId,
    storageKeyPrefix,
    imageReferences: [front, back],
  };
}

function publicElementScoreProjection(value: unknown) {
  if (!isRecord(value)) return undefined;
  const score = value;
  return {
    score: score.score,
    confidence: score.confidence,
    explanation: score.explanation,
  };
}

function publicGradeImpactReasonProjection(value: unknown) {
  const reason = isRecord(value) ? value : {};
  return {
    id: reason.id,
    category: reason.category,
    side: reason.side,
    severity: reason.severity,
    confidence: reason.confidence,
    explanation: reason.explanation,
    ...(Array.isArray(reason.evidenceRefs) ? { evidenceRefs: reason.evidenceRefs } : {}),
    ...(Array.isArray(reason.findingIds) ? { findingIds: reason.findingIds } : {}),
  };
}

function publicWhyNot10Projection(value: unknown) {
  const reason = isRecord(value) ? value : {};
  return {
    id: reason.id,
    title: reason.title,
    explanation: reason.explanation,
    ...(Array.isArray(reason.evidenceRefs) ? { evidenceRefs: reason.evidenceRefs } : {}),
  };
}

function publicProductionReleaseProjection(
  release: AiGraderProductionReleaseLike,
  publicReportUrl: string,
) {
  const finalGrade = isRecord(release.finalGrade) ? release.finalGrade : {};
  const elements = isRecord(finalGrade.elements) ? finalGrade.elements : {};
  const confidence = isRecord(finalGrade.confidence) ? finalGrade.confidence : {};
  const label = isRecord(release.label) ? release.label : {};
  const publicElements = Object.fromEntries(
    (["centering", "corners", "edges", "surface"] as const).flatMap((element) => {
      const projected = publicElementScoreProjection(elements[element]);
      return projected ? [[element, projected] as const] : [];
    }),
  );
  return {
    finalGrade: {
      ...(finalGrade.status !== undefined ? { status: finalGrade.status } : {}),
      overall: finalGrade.overall,
      elements: publicElements,
      confidence: {
        score: confidence.score,
        band: confidence.band,
        ...(Array.isArray(confidence.warnings) ? { warnings: confidence.warnings } : {}),
      },
      ...(Array.isArray(finalGrade.gradeImpactReasons)
        ? { gradeImpactReasons: finalGrade.gradeImpactReasons.map(publicGradeImpactReasonProjection) }
        : {}),
      ...(Array.isArray(finalGrade.whyNot10)
        ? { whyNot10: finalGrade.whyNot10.map(publicWhyNot10Projection) }
        : {}),
      finalGradeComputed: true,
      certifiedClaim: false,
    },
    label: {
      certId: label.certId,
      labelGradeText: label.labelGradeText,
      publicReportUrl,
      qrPayloadUrl: publicReportUrl,
    },
    publication: { publicReportUrl },
  };
}

export function buildAiGraderProductionStoragePlan(input: {
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  publicReportBaseUrl?: string;
  storageKeyPrefix?: string;
  publicUrlFor?: (storageKey: string) => string;
}): AiGraderProductionStoragePlan {
  assertAiGraderNoCertifiedClaim(input.reportBundle, "reportBundle");
  assertAiGraderNoCertifiedClaim(input.productionRelease, "productionRelease");
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "");
  if (!reportId) throw new Error("AI Grader reportId is required for publication.");
  const storageKeyPrefix = (input.storageKeyPrefix ?? `ai-grader/reports/${safeSegment(reportId)}/`).replace(/^\/+/, "").replace(/\/?$/, "/");
  const base = publicBase(input.publicReportBaseUrl);
  const generatedAt = stringValue(input.productionRelease.generatedAt ?? input.reportBundle.generatedAt, "");
  if (!generatedAt) throw new Error("AI Grader generatedAt is required for publication.");
  const publicReportUrl = `${base}/ai-grader/reports/${encodeURIComponent(reportId)}`;
  const qrPayloadUrl = publicReportUrl;
  const publicUrlFor = input.publicUrlFor ?? ((storageKey: string) => `${base}/storage/${storageKey}`);
  const reportAssets = reportAssetArtifacts({ reportId, storageKeyPrefix, reportBundle: input.reportBundle, publicUrlFor });
  const calibrationProfile = publicCalibrationProfile(input.reportBundle.calibrationProfile);
  const publicCaptureTiming = normalizeAiGraderPublicCaptureTiming(input.reportBundle.captureTiming);
  const publicOcrPrefill = normalizeAiGraderPublicOcrPrefill(input.reportBundle.ocrPrefill);
  const publicGeometryCaptureDecisions = normalizeAiGraderPublicGeometryCaptureDecisions(
    input.reportBundle.geometryCaptureDecisions,
  );
  const publicGeometry = isRecord(input.reportBundle.geometry)
    ? stripAiGraderUnversionedPhysicalFields(sanitizeAiGraderPublicJson(input.reportBundle.geometry))
    : undefined;
  const publicAssets = reportAssets.map((entry) => ({
    id: entry.sourceAssetId,
    kind: entry.kind,
    fileName: entry.storageKey.split("/").pop(),
    contentType: entry.contentType,
    storageKey: entry.storageKey,
    publicUrl: entry.publicUrl,
    byteSize: entry.byteSize,
    checksumSha256: entry.checksumSha256,
    ...(entry.sourceImageWidthPx && entry.sourceImageHeightPx
      ? { widthPx: entry.sourceImageWidthPx, heightPx: entry.sourceImageHeightPx }
      : {}),
    ...(entry.sourceAssetSide ? { side: entry.sourceAssetSide } : {}),
    ...(entry.sourceEvidenceRole ? { evidenceRole: entry.sourceEvidenceRole } : {}),
  }));
  const rawVisionLab = isRecord(input.reportBundle.visionLab) ? input.reportBundle.visionLab : {};
  const storedFindings = input.reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V02_VERSION
    ? storedFindingsFromPublishedProjection(input.reportBundle.defectFindings)
    : rawVisionLab.defectFindings;
  if (input.reportBundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V02_VERSION) {
    assertValidAiGraderFindingExtraction(
      rawVisionLab.findingValidation,
      rawVisionLab.defectFindings,
      input.reportBundle,
      rawVisionLab,
    );
  }
  const defectFindings = publicDefectFindings(storedFindings, publicAssets, true, calibrationProfile);
  const knownFindingIds = new Set(defectFindings.map((finding) => finding.findingId));
  const provisionalGrade = isRecord(input.reportBundle.provisionalGrade) ? input.reportBundle.provisionalGrade : {};
  validateFindingIdReferences(provisionalGrade.gradeImpactCandidates, knownFindingIds);
  const releaseFinalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
  validateFindingIdReferences(releaseFinalGrade.gradeImpactReasons, knownFindingIds);
  const publicRelease = publicProductionReleaseProjection(input.productionRelease, publicReportUrl);
  const cardIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const parsedBundle = aiGraderReportBundleV02Schema.safeParse({
    schemaVersion: AI_GRADER_REPORT_BUNDLE_V02_VERSION,
    generatedAt,
    reportId,
    certifiedClaim: false,
    certificateGenerated: false,
    gradingSessionId: input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId,
    reportStatus: input.productionRelease.reportStatus ?? input.reportBundle.reportStatus,
    finalStatus: input.productionRelease.finalStatus ?? input.reportBundle.finalStatus,
    finalGradeComputed: true,
    labelGenerated: true,
    qrGenerated: true,
    cardIdentity: {
      title: cardIdentity.title,
      sideCount: cardIdentity.sideCount,
      ...(cardIdentity.cardAssetId !== undefined ? { cardAssetId: cardIdentity.cardAssetId } : {}),
      ...(cardIdentity.itemId !== undefined ? { itemId: cardIdentity.itemId } : {}),
      ...(cardIdentity.set !== undefined ? { set: cardIdentity.set } : {}),
      ...(cardIdentity.cardNumber !== undefined ? { cardNumber: cardIdentity.cardNumber } : {}),
    },
    productionRelease: publicRelease,
    ...(calibrationProfile ? { calibrationProfile } : {}),
    defectFindings,
    assets: publicAssets,
    publicAssets,
    ...(publicGeometry ? { geometry: publicGeometry } : {}),
    ...(publicGeometryCaptureDecisions ? { geometryCaptureDecisions: publicGeometryCaptureDecisions } : {}),
    ...(publicCaptureTiming ? { captureTiming: publicCaptureTiming } : {}),
    ...(publicOcrPrefill ? { ocrPrefill: publicOcrPrefill } : {}),
    ...(Array.isArray(input.reportBundle.warnings) ? { warnings: input.reportBundle.warnings } : {}),
    ...(Array.isArray(input.reportBundle.limitations) ? { limitations: input.reportBundle.limitations } : {}),
  });
  if (!parsedBundle.success) {
    const summary = parsedBundle.error.issues
      .slice(0, 8)
      .map((entry) => `${entry.path.join(".") || "bundle"}: ${entry.message}`)
      .join("; ");
    throw new Error(`AI Grader public report bundle v0.2 validation failed: ${summary}`);
  }
  const sanitizedBundle = parsedBundle.data;
  const sanitizedRelease = sanitizeAiGraderPublicJson({
    schemaVersion: input.productionRelease.schemaVersion,
    generatedAt,
    gradingSessionId: input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId,
    reportId,
    reportStatus: input.productionRelease.reportStatus,
    finalStatus: input.productionRelease.finalStatus,
    finalGradeComputed: true,
    certifiedClaim: false,
    certificateGenerated: false,
    ...publicRelease,
    publication: {
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
    cardIdentity: sanitizedBundle.cardIdentity,
    finalGrade: publicRelease.finalGrade,
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

function primaryPublishedReportAsset(plan: AiGraderProductionStoragePlan) {
  const images = plan.artifacts.filter((artifact) => artifact.artifactClass === "report_asset");
  return images.find((artifact) =>
    artifact.sourceEvidenceRole === "normalized_card" && artifact.sourceAssetSide === "front") ??
    images.find((artifact) => artifact.sourceAssetSide === "front") ??
    images[0];
}

function publishedArtifactUrl(plan: AiGraderProductionStoragePlan, artifact: AiGraderProductionArtifactPlan | undefined) {
  if (!artifact) return undefined;
  return artifact.publicUrl ?? plan.assetManifest.find((entry) => entry.artifactId === artifact.artifactId)?.publicUrl;
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
    captureSummary: nullableJson({
      evidenceReferences: input.reportBundle.evidenceReferences,
      geometry: sanitizeAiGraderPublicJson(input.reportBundle.geometry),
      geometryCaptureDecisions: normalizeAiGraderPublicGeometryCaptureDecisions(
        input.reportBundle.geometryCaptureDecisions
      ),
      captureTiming: normalizeAiGraderPublicCaptureTiming(input.reportBundle.captureTiming),
      ocrPrefill: normalizeAiGraderPublicOcrPrefill(input.reportBundle.ocrPrefill),
    }),
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

async function resolveAiGraderConfirmedPublishAuthorityTx(
  tx: AiGraderProductionTransactionClient,
  input: AiGraderConfirmedPublishAuthorityInput,
): Promise<AiGraderConfirmedPublishAuthority> {
  const tenantId = trimmedString(input.tenantId);
  const gradingSessionId = trimmedString(input.gradingSessionId);
  const reportId = trimmedString(input.reportId);
  const cardAssetId = trimmedString(input.cardAssetId);
  const itemId = trimmedString(input.itemId);
  if (!tenantId || !gradingSessionId || !reportId || !cardAssetId || !itemId) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_LINKAGE_REQUIRED",
      "Publish requires explicit report, grading-session, CardAsset, and Item linkage.",
      400,
    );
  }
  if (
    typeof tx.aiGraderSession.findUnique !== "function" ||
    typeof tx.aiGraderReport.findUnique !== "function" ||
    typeof tx.cardAsset?.findUnique !== "function" ||
    typeof tx.item?.findUnique !== "function"
  ) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_AUTHORITY_UNAVAILABLE",
      "Durable Confirm authority is unavailable; Publish stopped before storage or database changes.",
      503,
    );
  }
  const [session, report, card, item] = await Promise.all([
    tx.aiGraderSession.findUnique({
      where: { gradingSessionId },
      select: {
        id: true,
        tenantId: true,
        gradingSessionId: true,
        reportId: true,
        cardAssetId: true,
        itemId: true,
        status: true,
        cardIdentity: true,
      },
    }),
    tx.aiGraderReport.findUnique({
      where: { reportId },
      select: {
        id: true,
        tenantId: true,
        sessionId: true,
        reportId: true,
        publicationStatus: true,
        cardAssetId: true,
        itemId: true,
        finalOverallGrade: true,
      },
    }),
    tx.cardAsset.findUnique({
      where: { id: cardAssetId },
      select: { id: true, batchId: true },
    }),
    tx.item.findUnique({
      where: { id: itemId },
      select: { id: true, number: true },
    }),
  ]);
  const sessionRecord = isRecord(session) ? session : {};
  const reportRecord = isRecord(report) ? report : {};
  const cardRecord = isRecord(card) ? card : {};
  const itemRecord = isRecord(item) ? item : {};
  const sessionId = trimmedString(sessionRecord.id);
  const reportRowId = trimmedString(reportRecord.id);
  const sessionStatus = trimmedString(sessionRecord.status);
  const reportPublicationStatus = trimmedString(reportRecord.publicationStatus);
  if (
    !sessionId ||
    !reportRowId ||
    trimmedString(sessionRecord.tenantId) !== tenantId ||
    trimmedString(reportRecord.tenantId) !== tenantId ||
    trimmedString(sessionRecord.gradingSessionId) !== gradingSessionId ||
    trimmedString(sessionRecord.reportId) !== reportId ||
    trimmedString(reportRecord.reportId) !== reportId ||
    trimmedString(reportRecord.sessionId) !== sessionId ||
    trimmedString(sessionRecord.cardAssetId) !== cardAssetId ||
    trimmedString(reportRecord.cardAssetId) !== cardAssetId ||
    trimmedString(sessionRecord.itemId) !== itemId ||
    trimmedString(reportRecord.itemId) !== itemId ||
    !["card_created", "published"].includes(sessionStatus) ||
    !["draft", "published"].includes(reportPublicationStatus) ||
    trimmedString(cardRecord.id) !== cardAssetId ||
    !trimmedString(cardRecord.batchId) ||
    trimmedString(itemRecord.id) !== itemId ||
    trimmedString(itemRecord.number) !== cardAssetId
  ) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_AUTHORITY_MISMATCH",
      "Publish linkage does not match the durable confirmed report, session, CardAsset, and Item authority.",
    );
  }
  const durableIdentity = isRecord(sessionRecord.cardIdentity) ? sessionRecord.cardIdentity : {};
  if (
    trimmedString(durableIdentity.source) !== "card_asset" ||
    trimmedString(durableIdentity.status) !== "linked" ||
    trimmedString(durableIdentity.cardAssetId) !== cardAssetId ||
    trimmedString(durableIdentity.itemId) !== itemId
  ) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_CONFIRMED_IDENTITY_INVALID",
      "Publish could not verify the durable operator-confirmed card identity.",
    );
  }
  const confirmedIdentity = normalizeDurableConfirmedIdentity(durableIdentity, cardAssetId, itemId);
  const category = trimmedString(confirmedIdentity.category);
  const missingCommon = [
    confirmedIdentity.title,
    confirmedIdentity.year,
    confirmedIdentity.manufacturer,
    confirmedIdentity.productSet,
    confirmedIdentity.cardNumber,
  ].some((value) => !trimmedString(value));
  const categoryIdentityMissing =
    (category === "sport" && (!trimmedString(confirmedIdentity.playerName) || !trimmedString(confirmedIdentity.sport))) ||
    (category === "tcg" && (!trimmedString(confirmedIdentity.cardName) || !trimmedString(confirmedIdentity.game))) ||
    (category === "comics" && !trimmedString(confirmedIdentity.cardName));
  const finalOverallGrade = numberValue(reportRecord.finalOverallGrade);
  if (
    !["sport", "tcg", "comics"].includes(category) ||
    missingCommon ||
    categoryIdentityMissing ||
    finalOverallGrade === undefined ||
    finalOverallGrade < 1 ||
    finalOverallGrade > 10
  ) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_CONFIRMED_IDENTITY_INVALID",
      "Publish could not verify a complete durable operator-confirmed identity and final grade.",
    );
  }
  return {
    tenantId,
    gradingSessionId,
    reportId,
    cardAssetId,
    itemId,
    sessionId,
    reportRowId,
    confirmedIdentity,
    finalOverallGrade,
  };
}

async function runInTransaction<T>(db: AiGraderProductionPrismaClient, fn: (tx: AiGraderProductionTransactionClient) => Promise<T>) {
  if (typeof db.$transaction === "function") return db.$transaction(fn);
  return fn(db);
}

export async function resolveAiGraderConfirmedPublishAuthority(
  db: AiGraderProductionPrismaClient,
  input: AiGraderConfirmedPublishAuthorityInput,
) {
  return runInTransaction(db, (tx) => resolveAiGraderConfirmedPublishAuthorityTx(tx, input));
}

function aiGraderPersistAuthorityInput(input: AiGraderProductionPersistInput): AiGraderConfirmedPublishAuthorityInput {
  const bundleReportId = trimmedString(input.reportBundle.reportId);
  const releaseReportId = trimmedString(input.productionRelease.reportId);
  const bundleSessionId = trimmedString(input.reportBundle.gradingSessionId);
  const releaseSessionId = trimmedString(input.productionRelease.gradingSessionId);
  const bundleIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const label = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const labelIdentity = isRecord(label.cardIdentity) ? label.cardIdentity : {};
  const linkage = isRecord(input.productionRelease.cardInventoryLinkage)
    ? input.productionRelease.cardInventoryLinkage
    : {};
  const cardAssetId = trimmedString(input.cardAssetId) ||
    trimmedString(bundleIdentity.cardAssetId) ||
    trimmedString(linkage.cardAssetId) ||
    trimmedString(labelIdentity.cardAssetId);
  const itemId = trimmedString(input.itemId) ||
    trimmedString(bundleIdentity.itemId) ||
    trimmedString(linkage.itemId) ||
    trimmedString(labelIdentity.itemId);
  const cardIds = [
    input.cardAssetId,
    bundleIdentity.cardAssetId,
    linkage.cardAssetId,
    labelIdentity.cardAssetId,
  ].map(trimmedString).filter(Boolean);
  const itemIds = [
    input.itemId,
    bundleIdentity.itemId,
    linkage.itemId,
    labelIdentity.itemId,
  ].map(trimmedString).filter(Boolean);
  if (
    !trimmedString(input.tenantId) ||
    !bundleReportId ||
    !releaseReportId ||
    bundleReportId !== releaseReportId ||
    !bundleSessionId ||
    !releaseSessionId ||
    bundleSessionId !== releaseSessionId ||
    !cardAssetId ||
    !itemId ||
    cardIds.some((value) => value !== cardAssetId) ||
    itemIds.some((value) => value !== itemId) ||
    (trimmedString(label.reportId) && trimmedString(label.reportId) !== bundleReportId)
  ) {
    throw aiGraderPublishAuthorityError(
      "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
      "Publish requires one exact report, grading-session, CardAsset, and Item linkage.",
      400,
    );
  }
  return {
    tenantId: trimmedString(input.tenantId),
    gradingSessionId: bundleSessionId,
    reportId: bundleReportId,
    cardAssetId,
    itemId,
  };
}

async function acquireAiGraderLabelSheetLock(tx: AiGraderProductionTransactionClient, tenantId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader label sheet transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${tenantId}))`;
}

async function acquireAiGraderReportLifecycleLock(tx: AiGraderProductionTransactionClient, reportId: string) {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader report lifecycle transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))`;
}

export async function persistAiGraderProductionRelease(
  db: AiGraderProductionPrismaClient,
  input: AiGraderProductionPersistInput
): Promise<AiGraderProductionPersistResult> {
  const linkage = aiGraderPersistAuthorityInput(input);
  const gradingSessionId = linkage.gradingSessionId;
  const reportId = linkage.reportId;
  const now = dateValue(input.persistedAt);
  const publicationStatus = input.publicationStatus ?? "published";

  return runInTransaction(db, async (tx) => {
    await acquireAiGraderReportLifecycleLock(tx, reportId);
    const authority = await resolveAiGraderConfirmedPublishAuthorityTx(tx, linkage);
    const releaseOverall = finalOverallGrade(input.productionRelease);
    if (releaseOverall === undefined || releaseOverall !== authority.finalOverallGrade) {
      throw aiGraderPublishAuthorityError(
        "AI_GRADER_PUBLISH_FINAL_GRADE_MISMATCH",
        "Publish final grade does not match the durable grade confirmed for this report.",
      );
    }
    assertAiGraderConfirmedPublishIdentitySnapshot({
      reportBundle: input.reportBundle,
      productionRelease: input.productionRelease,
      authority,
    });
    const baseSessionData = sessionData(input, gradingSessionId, reportId, now);
    const {
      tenantId: _sessionTenantId,
      gradingSessionId: _sessionGradingSessionId,
      reportId: _sessionReportId,
      cardAssetId: _sessionCardAssetId,
      itemId: _sessionItemId,
      cardIdentity: _confirmedIdentity,
      ...sessionUpdateData
    } = baseSessionData;
    if (typeof tx.aiGraderSession.updateMany !== "function") {
      throw aiGraderPublishAuthorityError(
        "AI_GRADER_PUBLISH_AUTHORITY_UNAVAILABLE",
        "Durable Confirm authority cannot be updated safely; Publish stopped before database publication changes.",
        503,
      );
    }
    const sessionUpdate = await tx.aiGraderSession.updateMany({
      where: {
        id: authority.sessionId,
        tenantId: authority.tenantId,
        gradingSessionId: authority.gradingSessionId,
        reportId: authority.reportId,
        cardAssetId: authority.cardAssetId,
        itemId: authority.itemId,
        status: { in: ["card_created", "published"] },
      },
      data: sessionUpdateData,
    });
    if (sessionUpdate.count !== 1) {
      throw aiGraderPublishAuthorityError(
        "AI_GRADER_PUBLISH_AUTHORITY_MISMATCH",
        "Publish linkage changed after durable Confirm authority was verified.",
      );
    }
    const sessionId = authority.sessionId;
    const session = {
      id: authority.sessionId,
      tenantId: authority.tenantId,
      gradingSessionId: authority.gradingSessionId,
      reportId: authority.reportId,
      cardAssetId: authority.cardAssetId,
      itemId: authority.itemId,
      cardIdentity: authority.confirmedIdentity,
      ...sessionUpdateData,
    };
    const baseReportData = reportData(input, sessionId, reportId, publicationStatus, now);
    const {
      tenantId: _reportTenantId,
      sessionId: _reportSessionId,
      reportId: _reportId,
      cardAssetId: _reportCardAssetId,
      itemId: _reportItemId,
      ...reportUpdateData
    } = baseReportData;
    if (typeof tx.aiGraderReport.updateMany !== "function") {
      throw aiGraderPublishAuthorityError(
        "AI_GRADER_PUBLISH_AUTHORITY_UNAVAILABLE",
        "Durable Confirm authority cannot be updated safely; Publish stopped before database publication changes.",
        503,
      );
    }
    const reportUpdate = await tx.aiGraderReport.updateMany({
      where: {
        id: authority.reportRowId,
        tenantId: authority.tenantId,
        sessionId: authority.sessionId,
        reportId: authority.reportId,
        cardAssetId: authority.cardAssetId,
        itemId: authority.itemId,
        publicationStatus: { in: ["draft", "published"] },
      },
      data: reportUpdateData,
    });
    if (reportUpdate.count !== 1) {
      throw aiGraderPublishAuthorityError(
        "AI_GRADER_PUBLISH_AUTHORITY_MISMATCH",
        "Publish linkage changed after durable Confirm authority was verified.",
      );
    }
    const reportRowId = authority.reportRowId;
    const report = {
      id: authority.reportRowId,
      tenantId: authority.tenantId,
      sessionId: authority.sessionId,
      reportId: authority.reportId,
      cardAssetId: authority.cardAssetId,
      itemId: authority.itemId,
      ...reportUpdateData,
    };
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
    await acquireAiGraderLabelSheetLock(tx, input.tenantId);
    const label = labelData(input.productionRelease, reportId, input.storagePlan.publicReportUrl);
    const certId = stringValue(label.certId, reportId);
    const nextLabelGradeText = stringValue(label.labelGradeText, "PENDING");
    const reportLabels =
      (await tx.aiGraderLabel.findMany?.({
        where: { reportId: reportRowId },
        take: 2,
        select: {
          id: true,
          reportId: true,
          certId: true,
          payload: true,
          physicalPrintStatus: true,
          labelGradeText: true,
          qrPayloadUrl: true,
          publicReportUrl: true,
        },
      })) ?? [];
    const reportLabel = reportLabels[0] as JsonRecord | undefined;
    const certLabel = await tx.aiGraderLabel.findUnique?.({
      where: { certId },
      select: {
        id: true,
        reportId: true,
        certId: true,
        payload: true,
        physicalPrintStatus: true,
        labelGradeText: true,
        qrPayloadUrl: true,
        publicReportUrl: true,
      },
    });
    if (reportLabel && stringValue(reportLabel.certId, "") && stringValue(reportLabel.certId, "") !== certId) {
      throw new Error("AI Grader report already has a different cert ID; refusing to create a duplicate label row.");
    }
    if (isRecord(certLabel) && stringValue(certLabel.reportId, "") && stringValue(certLabel.reportId, "") !== reportRowId) {
      throw new Error("AI Grader cert ID is already linked to another report.");
    }
    const existingLabel = reportLabel ?? certLabel;
    const printableLabelChanged = Boolean(
      isRecord(existingLabel) &&
        existingLabel.physicalPrintStatus === "printed" &&
        (existingLabel.labelGradeText !== nextLabelGradeText ||
          existingLabel.qrPayloadUrl !== input.storagePlan.qrPayloadUrl ||
          existingLabel.publicReportUrl !== input.storagePlan.publicReportUrl)
    );
    const mergedLabelPayload = mergePersistedLabelPayload(
      isRecord(existingLabel) ? existingLabel.payload : undefined,
      label
    );
    const persistedLabelPayload = printableLabelChanged
      ? invalidatePersistedLabelPrint(mergedLabelPayload, now)
      : mergedLabelPayload;
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
        labelGradeText: nextLabelGradeText,
        labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
        labelPreviewKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
        labelPreviewUrl: input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl,
        ...(printableLabelChanged ? { physicalPrintStatus: "not_printed" } : {}),
        payload: persistedLabelPayload,
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
        labelGradeText: nextLabelGradeText,
        labelDataStorageKey: `${input.storagePlan.storageKeyPrefix}label-data.json`,
        labelPreviewKey: `${input.storagePlan.storageKeyPrefix}label-preview.html`,
        labelPreviewUrl: input.storagePlan.assetManifest.find((asset) => asset.kind === "label-preview.html")?.publicUrl,
        payload: persistedLabelPayload,
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
    const existingValuation = await tx.aiGraderValuation.findUnique?.({
      where: { id: valuationId },
      select: {
        status: true,
        source: true,
        searchQuery: true,
        valuationMinor: true,
        valuationCurrency: true,
        compsRefs: true,
        resultSummary: true,
        requestedByUserId: true,
        requestedAt: true,
        completedAt: true,
        errorCode: true,
      },
    });
    const preserveRuntimeValuation = hasProgressedRuntimeValuation(existingValuation);
    const valuation = await tx.aiGraderValuation.upsert({
      where: { id: valuationId },
      update: {
        tenantId: input.tenantId,
        sessionId,
        ...(!preserveRuntimeValuation
          ? {
              status: valuationStatus,
              source: "ebay_sold",
              searchQuery: stringValue(input.reportBundle.cardIdentity?.title, "") || null,
              compsRefs: nullableJson(input.productionRelease.ebayCompsContract?.compsRefs),
              resultSummary: nullableJson(withActorAudit(input.productionRelease.ebayCompsContract, input.actorAudit)),
              updatedAt: now,
            }
          : {}),
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
    const publishedImage = primaryPublishedReportAsset(input.storagePlan);
    const publishedImageUrl = publishedArtifactUrl(input.storagePlan, publishedImage);
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
          ...(publicationStatus === "published" && publishedImage && publishedImageUrl
            ? {
                storageKey: publishedImage.storageKey,
                fileName: publishedImage.storageKey.split("/").pop(),
                fileSize: publishedImage.byteSize,
                mimeType: publishedImage.contentType,
                imageUrl: publishedImageUrl,
                thumbnailUrl: publishedImageUrl,
                cdnHdUrl: publishedImageUrl,
                cdnThumbUrl: publishedImageUrl,
                status: "READY",
              }
            : {}),
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
          ...(publicationStatus === "published" && publishedImageUrl
            ? {
                imageUrl: publishedImageUrl,
                thumbnailUrl: publishedImageUrl,
                cdnHdUrl: publishedImageUrl,
                cdnThumbUrl: publishedImageUrl,
              }
            : {}),
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
