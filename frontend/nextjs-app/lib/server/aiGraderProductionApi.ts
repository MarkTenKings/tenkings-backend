import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderCardItemSelection,
  AiGraderProductionArtifactPlan,
  AiGraderProductionPersistResult,
  AiGraderProductionReleaseLike,
  AiGraderProductionReportBundleLike,
  AiGraderProductionStoragePlan,
  AiGraderSlabbedPhotoSide,
  AiGraderValuationStatus,
} from "@tenkings/database";
import {
  aiGraderSha256,
  buildAiGraderCompsSearchQuery,
  buildAiGraderProductionStoragePlan,
  CardAssetStatus,
  CardEvidenceKind,
  CardPhotoKind,
  CardReviewStage,
  computeAiGraderValuationStatus,
  persistAiGraderSlabbedPhotoAsset,
  persistAiGraderProductionRelease,
  persistAiGraderValuationResult,
  type Prisma,
} from "@tenkings/database";
import {
  createClassificationPayloadFromAttributes,
  type CardAttributes,
  type NormalizedClassification,
} from "@tenkings/shared";
import type { AdminSession } from "./admin";
import type { UserSession } from "./session";
import { buildAiGraderLabelPreviewUrl } from "../aiGraderOperatorWorkflow";
import {
  ensureInventoryReadyArtifactsTx,
  PRICE_REQUIRED_MESSAGE,
  resolveInventoryReadyOwner,
} from "./inventoryReadyArtifacts";
import {
  aiGraderProductionAuthStatus,
  requireAiGraderProductionActor,
  type AiGraderProductionAction,
  type AiGraderProductionActor,
  type AiGraderProductionActorAudit,
} from "./aiGraderProductionAuth";
import type { AiGraderLabelSheetsResult } from "../aiGraderLabelSheets";
import {
  queueConfirmedAiGraderLabelTx,
  type AiGraderConfirmedLabelQueueResult,
  type AiGraderPreparedLabelSheetResult,
  type AiGraderPrintedLabelSheetResult,
} from "./aiGraderLabelSheetRuntime";

export const AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV = "AI_GRADER_PRODUCTION_PUBLISH_ENABLED";
export const AI_GRADER_PRODUCTION_TENANT_ID_ENV = "AI_GRADER_PRODUCTION_TENANT_ID";
export const AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV = "AI_GRADER_PUBLIC_REPORT_DB_ENABLED";
export const AI_GRADER_EBAY_COMPS_ENABLED_ENV = "AI_GRADER_EBAY_COMPS_ENABLED";
export const AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES = 1024 * 1024;
export const AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES = 4.5 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type EnvLike = Record<string, string | undefined>;

export type AiGraderProductionUploadResult = {
  storageKey: string;
  publicUrl: string;
};

export type AiGraderProductionPresignedUpload = {
  storageKey: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  publicUrl: string;
};

export type AiGraderProductionUploadPlanArtifact = Omit<AiGraderProductionArtifactPlan, "body" | "bodyEncoding"> & {
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  body?: string;
  bodyEncoding?: "utf8";
};

export type AiGraderProductionUploadManifestArtifact = {
  artifactId: string;
  storageKey: string;
  publicUrl?: string;
  checksumSha256: string;
  byteSize: number;
  contentType?: string;
  uploadedAt?: string;
};

export type AiGraderProductionUploadManifest = {
  artifacts: AiGraderProductionUploadManifestArtifact[];
};

export type AiGraderCardItemSearchResult = AiGraderCardItemSelection & {
  displayTitle: string;
  subtitle?: string | null;
};

export type AiGraderSlabbedPhotoUploadResult = {
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  byteSize: number;
  checksumSha256: string;
  persisted: boolean;
};

export type AiGraderCompsRunResult = {
  status: AiGraderValuationStatus;
  liveExecutionEnabled: boolean;
  searchQuery?: string;
  searchUrl?: string;
  compsRefs: unknown[];
  resultSummary?: unknown;
  persisted: boolean;
  message?: string;
  errorCode?: string | null;
  retryable?: boolean;
};

export type AiGraderConfirmedCardIdentity = {
  category: "sport" | "tcg" | "comics";
  playerName?: string | null;
  cardName?: string | null;
  teamName?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  sport?: string | null;
  game?: string | null;
  productSet?: string | null;
  productLine?: string | null;
  insert?: string | null;
  insertSet?: string | null;
  parallel?: string | null;
  cardNumber?: string | null;
  numbered?: string | null;
  autograph?: boolean | null;
  memorabilia?: boolean | null;
};

export type AiGraderCreateCardFromReportResult = {
  reportId: string;
  cardAssetId: string;
  itemId: string;
  batchId: string;
  title: string;
  set: string;
  publicImageUrl: string;
  cardIdentity: AiGraderCardItemSearchResult;
  productionRelease: AiGraderProductionReleaseLike;
  inventoryReady: {
    itemNumberConvention: "Item.number = CardAsset.id";
    labelPairId?: string | null;
  };
  downstream?: AiGraderConfirmedLabelQueueResult;
};

export type AiGraderSlabbedPhotoUploadInitResult = {
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  requiredFinalizeManifest: {
    reportId: string;
    side: AiGraderSlabbedPhotoSide;
    storageKey: string;
    publicUrl: string;
    checksumSha256: string;
    byteSize: number;
    mimeType: string;
  };
};

export type AiGraderSelectedCompsPersistResult = {
  reportId: string;
  cardAssetId: string;
  itemId?: string | null;
  evidenceItemCount: number;
  valuationMinor: number | null;
  valuationCurrency: string;
  valuationStatus: AiGraderValuationStatus;
};

export type AiGraderAddToInventoryResult = {
  reportId: string;
  cardAssetId: string;
  itemId: string;
  reviewStage: string;
  labelPairId?: string | null;
};

export type AiGraderProductionApiDependencies = {
  env?: EnvLike;
  requireAdminSession(req: NextApiRequest): Promise<AdminSession>;
  requireUserSession?(req: NextApiRequest): Promise<UserSession>;
  requireProductionActor?(
    req: NextApiRequest,
    action: AiGraderProductionAction,
    env: EnvLike
  ): Promise<AiGraderProductionActor>;
  publicUrlFor(storageKey: string): string;
  presignUpload?(input: {
    storageKey: string;
    contentType: string;
    checksumSha256: string;
  }): Promise<AiGraderProductionPresignedUpload>;
  verifyUploadedArtifact?(input: AiGraderProductionUploadManifestArtifact): Promise<{
    ok: boolean;
    byteSize?: number;
    contentType?: string;
    checksumSha256?: string | null;
    message?: string;
  }>;
  persist(input: {
    tenantId: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    storagePlan: AiGraderProductionStoragePlan;
    publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
    operatorUserId?: string | null;
    cardAssetId?: string | null;
    itemId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderProductionPersistResult>;
  listHistory?(): Promise<AiGraderProductionHistoryResult>;
  listFinishQueue?(input: { tenantId: string }): Promise<AiGraderFinishCardsQueueResult>;
  listLabelSheets?(input: { tenantId: string }): Promise<AiGraderLabelSheetsResult>;
  searchCards?(input: {
    query: string;
    limit: number;
    admin?: AdminSession | null;
    actor: AiGraderProductionActor;
  }): Promise<AiGraderCardItemSearchResult[]>;
  createCardFromReport?(input: {
    tenantId: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    storagePlan: AiGraderProductionStoragePlan;
    identity: AiGraderConfirmedCardIdentity;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderCreateCardFromReportResult>;
  finalizeSlabbedPhotoUpload?(input: {
    tenantId: string;
    reportId: string;
    side: AiGraderSlabbedPhotoSide;
    storageKey: string;
    publicUrl: string;
    mimeType: string;
    byteSize: number;
    checksumSha256: string;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderSlabbedPhotoUploadResult>;
  runComps?(input: {
    reportId: string;
    searchQuery: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    limit: number;
    admin?: AdminSession | null;
    actor: AiGraderProductionActor;
  }): Promise<Omit<AiGraderCompsRunResult, "status" | "liveExecutionEnabled" | "persisted">>;
  persistComps?(input: {
    tenantId: string;
    reportId: string;
    status: AiGraderValuationStatus;
    searchQuery?: string | null;
    compsRefs?: unknown;
    resultSummary?: unknown;
    requestedByUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
    errorCode?: string | null;
    attemptId?: string | null;
  }): Promise<unknown>;
  persistSelectedComps?(input: {
    tenantId: string;
    reportId: string;
    selectedComps: unknown[];
    searchQuery?: string | null;
    searchUrl?: string | null;
    valuationCurrency?: string | null;
    requestedByUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderSelectedCompsPersistResult>;
  addToInventory?(input: {
    tenantId: string;
    reportId: string;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderAddToInventoryResult>;
  prepareLabelSheetPrint?(input: {
    tenantId: string;
    sheetId: string;
    expectedRevision: string;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderPreparedLabelSheetResult>;
  markLabelSheetPrinted?(input: {
    tenantId: string;
    sheetId: string;
    expectedRevision: string;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderPrintedLabelSheetResult>;
};

export type AiGraderProductionHistoryItem = {
  reportId: string;
  gradingSessionId?: string | null;
  reportStatus: string;
  publicationStatus: string;
  visibilityStatus: string;
  publicReportUrl?: string | null;
  qrPayloadUrl?: string | null;
  finalOverallGrade?: number | null;
  confidence?: unknown;
  warnings?: unknown;
  cardAssetId?: string | null;
  itemId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  finalizedAt?: string | null;
  publishedAt?: string | null;
};

export type AiGraderProductionHistoryResult = {
  source: "persisted_records";
  items: AiGraderProductionHistoryItem[];
  stats: {
    total: number;
    published: number;
    finalized: number;
    draft: number;
    averageFinalGrade: number | null;
    gradeDistribution: Record<string, number>;
    warningCount: number;
  };
};

export type AiGraderFinishCardsQueueStatus =
  | "needs_comps_review"
  | "needs_slab_photos"
  | "ready_for_inventory"
  | "complete";

export type AiGraderFinishCardsQueueItem = {
  reportId: string;
  certId?: string | null;
  cardTitle: string;
  grade?: number | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  publicReportUrl?: string | null;
  labelPreviewUrl?: string | null;
  qrPayloadUrl?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  queueStatus: AiGraderFinishCardsQueueStatus;
  statusText: "Needs Comps Review" | "Needs Slab Photos" | "Ready for Inventory" | "Complete";
  needs: Array<"Comps Review" | "Slab Photos" | "Add To Inventory">;
  label: {
    printed: boolean;
    physicalPrintStatus?: string | null;
    sheetNumber?: number | null;
    slot?: number | null;
  };
  slabPhotos: {
    frontUploaded: boolean;
    backUploaded: boolean;
    complete: boolean;
    frontUrl?: string | null;
    backUrl?: string | null;
  };
  valuation: {
    complete: boolean;
    status?: string | null;
    valuationMinor?: number | null;
    valuationCurrency?: string | null;
    searchQuery?: string | null;
    searchUrl?: string | null;
    compsRefs: unknown[];
    errorCode?: string | null;
    errorMessage?: string | null;
    retryable: boolean;
  };
  inventory: {
    complete: boolean;
    reviewStage?: string | null;
    canAddToInventory: boolean;
  };
};

export type AiGraderFinishCardsQueueResult = {
  source: "persisted_records";
  orderedBy: "labelSheet_asc_slot_asc_createdAt_asc";
  items: AiGraderFinishCardsQueueItem[];
  stats: {
    total: number;
    needsCompsReview: number;
    needsSlabPhotos: number;
    readyForInventory: number;
    /** @deprecated Use needsCompsReview. */
    needsEbayEvaluate: number;
    /** @deprecated Use readyForInventory. */
    needsInventory: number;
    complete: number;
  };
};

type AiGraderFinishCardsQueueBuildOptions = {
  activeLimit?: number;
  includeCompleted?: boolean;
  recentCompletedLimit?: number;
};

export type AiGraderPublicReportApiDependencies = {
  env?: EnvLike;
  readPublishedBundle(reportId: string): Promise<AiGraderProductionReportBundleLike | null>;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionKey(req: NextApiRequest) {
  const action = req.query.action;
  if (Array.isArray(action)) return action.join("/");
  if (typeof action === "string") return action;
  return "status";
}

function isEnabled(env: EnvLike | undefined, key: string) {
  return env?.[key] === "true";
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numericValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorStatus(error: unknown, fallback = 400) {
  if (isRecord(error) && typeof error.statusCode === "number" && Number.isFinite(error.statusCode)) {
    return Math.max(400, Math.min(599, Math.round(error.statusCode)));
  }
  return fallback;
}

function aiGraderCompsFailure(error: unknown) {
  const statusCode = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : null;
  const rawMessage = error instanceof Error ? error.message : stringValue(error, "eBay sold comps failed.");
  const message =
    rawMessage
      .replace(/([?&](?:api[_-]?key|token|secret|signature)=)[^&\s]+/gi, "$1[redacted]")
      .replace(/\b((?:api[_-]?key|token|secret|signature)\s*[=:]\s*)\S+/gi, "$1[redacted]")
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
      .replace(/\b((?:SERPAPI_KEY|DATABASE_URL|AI_GRADER_[A-Z0-9_]*TOKEN)\s*[=:]\s*)\S+/gi, "$1[redacted]")
      .replace(/[a-z]:\\[^\r\n]*/gi, "[local path redacted]")
      .replace(/(^|[\s"'(:])\/(?:var|root|tmp|home|app|workspace)\/[^\s"'<>)]*/gi, "$1[local path redacted]")
      .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?[^\s]*/gi, "[local endpoint redacted]")
      .replace(/data:image\/[^\s]+/gi, "[embedded image redacted]")
      .trim()
      .slice(0, 1000) || "eBay sold comps failed.";
  const retryable =
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode != null && statusCode >= 500) ||
    /network|timeout|timed out|fetch|econn|socket|temporar|thrott|quota|capacity|rate.?limit|\b429\b|\b5\d\d\b/i.test(
      message
    );
  const suppliedCode = isRecord(error) && typeof error.code === "string" ? error.code.trim() : "";
  const errorCode = /^[A-Za-z0-9_.-]{1,80}$/.test(suppliedCode)
    ? suppliedCode
    : retryable
      ? "AI_GRADER_EBAY_COMPS_RETRYABLE"
      : "AI_GRADER_EBAY_COMPS_FAILED";
  return {
    errorCode,
    message,
    retryable,
  };
}

function jsonByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function assertSmallJsonPayload(value: unknown, limitBytes: number, label: string) {
  const byteLength = jsonByteLength(value);
  if (byteLength > limitBytes) {
    const error = new Error(`${label} must be ${Math.floor(limitBytes / 1024 / 1024)} MB or smaller.`);
    (error as Error & { statusCode?: number }).statusCode = 413;
    throw error;
  }
  return byteLength;
}

function unsafePublishString(value: string) {
  return (
    /^data:image/i.test(value) ||
    /^[a-z]:\\/i.test(value) ||
    value.includes("\\TenKings\\") ||
    /https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)/i.test(value) ||
    /x-ai-grader-station-token|stationToken|service-token|DATABASE_URL/i.test(value)
  );
}

function assertNoUnsafePublishPayload(value: unknown, path = "body") {
  if (typeof value === "string") {
    if (unsafePublishString(value)) {
      const error = new Error(`Unsafe AI Grader publish payload field rejected at ${path}.`);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUnsafePublishPayload(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "bodybase64" ||
      lowerKey === "dataurl" ||
      lowerKey === "localpath" ||
      lowerKey.endsWith("localpath") ||
      lowerKey.includes("stationtoken") ||
      lowerKey.includes("bridgetoken")
    ) {
      const error = new Error(`Unsafe AI Grader publish payload field rejected at ${path}.${key}.`);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    assertNoUnsafePublishPayload(entry, `${path}.${key}`);
  }
}

function actorOperatorUserId(actor: AiGraderProductionActor) {
  return actor.type === "human_operator" ? actor.user.id : null;
}

function adminSessionForActor(actor: AiGraderProductionActor): AdminSession | null {
  if (actor.type !== "human_operator") return null;
  if (actor.adminSession) return actor.adminSession;
  return {
    sessionId: actor.sessionId,
    tokenHash: actor.tokenHash,
    user: {
      id: actor.user.id,
      phone: actor.user.phone,
      displayName: actor.user.displayName,
    },
  };
}

function parsePublishBody(body: unknown) {
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  if (!isRecord(body.reportBundle)) throw new Error("reportBundle is required.");
  if (!isRecord(body.productionRelease)) throw new Error("productionRelease is required.");
  const status = stringValue(body.publicationStatus, "published");
  if (!["draft", "finalized", "published", "unpublished", "revoked", "error"].includes(status)) {
    throw new Error("publicationStatus must be draft, finalized, published, unpublished, revoked, or error.");
  }
  return {
    reportBundle: body.reportBundle as AiGraderProductionReportBundleLike,
    productionRelease: body.productionRelease as AiGraderProductionReleaseLike,
    publicationStatus: status as "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error",
    cardAssetId: typeof body.cardAssetId === "string" ? body.cardAssetId : undefined,
    itemId: typeof body.itemId === "string" ? body.itemId : undefined,
  };
}

function parseProductionPublishSmallBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader publish request");
  assertNoUnsafePublishPayload(body);
  const parsed = parsePublishBody(body);
  const source = body as JsonRecord;
  const reportId = stringValue(source.reportId ?? parsed.productionRelease.reportId ?? parsed.reportBundle.reportId, "");
  if (!reportId) throw new Error("reportId is required.");
  return {
    ...parsed,
    reportId,
    certId: optionalString(source.certId ?? parsed.productionRelease.label?.certId),
    gradingSessionId: optionalString(source.gradingSessionId ?? parsed.productionRelease.gradingSessionId ?? parsed.reportBundle.gradingSessionId),
    assetManifest: source.assetManifest,
    checksums: source.checksums,
  };
}

function parseUploadManifest(value: unknown): AiGraderProductionUploadManifest {
  const manifest = isRecord(value) ? value : {};
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!artifacts.length) throw new Error("uploadManifest.artifacts is required.");
  return {
    artifacts: artifacts.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`uploadManifest.artifacts[${index}] must be an object.`);
      const artifactId = stringValue(entry.artifactId, "");
      const storageKey = stringValue(entry.storageKey, "");
      const checksumSha256 = stringValue(entry.checksumSha256, "");
      const byteSize = numericValue(entry.byteSize, 0);
      if (!artifactId) throw new Error(`uploadManifest.artifacts[${index}].artifactId is required.`);
      if (!storageKey) throw new Error(`uploadManifest.artifacts[${index}].storageKey is required.`);
      if (!/^[a-f0-9]{64}$/i.test(checksumSha256)) {
        throw new Error(`uploadManifest.artifacts[${index}].checksumSha256 must be a SHA-256 hex digest.`);
      }
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        throw new Error(`uploadManifest.artifacts[${index}].byteSize must be positive.`);
      }
      return {
        artifactId,
        storageKey,
        publicUrl: optionalString(entry.publicUrl),
        checksumSha256: checksumSha256.toLowerCase(),
        byteSize: Math.round(byteSize),
        contentType: optionalString(entry.contentType),
        uploadedAt: optionalString(entry.uploadedAt),
      };
    }),
  };
}

function publishSessionIdForPlan(reportId: string, plan: AiGraderProductionStoragePlan) {
  const basis = {
    reportId,
    storageKeyPrefix: plan.storageKeyPrefix,
    artifacts: plan.assetManifest.map((artifact) => ({
      artifactId: artifact.artifactId,
      storageKey: artifact.storageKey,
      checksumSha256: artifact.checksumSha256,
      byteSize: artifact.byteSize,
    })),
  };
  return `aigpub_${aiGraderSha256(stableStringify(basis)).slice(0, 32)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function artifactForResponse(artifact: AiGraderProductionArtifactPlan, presigned: AiGraderProductionPresignedUpload): AiGraderProductionUploadPlanArtifact {
  return {
    artifactId: artifact.artifactId,
    artifactClass: artifact.artifactClass,
    kind: artifact.kind,
    storageKey: artifact.storageKey,
    contentType: artifact.contentType,
    checksumSha256: artifact.checksumSha256,
    byteSize: artifact.byteSize,
    publicUrl: artifact.publicUrl ?? presigned.publicUrl,
    sourceAssetId: artifact.sourceAssetId,
    uploadUrl: presigned.uploadUrl,
    uploadMethod: presigned.uploadMethod,
    uploadHeaders: presigned.uploadHeaders,
    ...(artifact.artifactClass !== "report_asset" && typeof artifact.body === "string"
      ? { body: artifact.body, bodyEncoding: "utf8" as const }
      : {}),
  };
}

function planWithoutBodies(plan: AiGraderProductionStoragePlan): AiGraderProductionStoragePlan {
  return {
    ...plan,
    artifacts: plan.artifacts.map(({ body: _body, bodyEncoding: _bodyEncoding, ...artifact }) => artifact),
  };
}

function assertPublishedReleaseReady(input: {
  publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
  productionRelease: AiGraderProductionReleaseLike;
}) {
  const releaseLabel = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const releaseBlocked =
    input.publicationStatus === "published" &&
    (input.productionRelease.finalGradeComputed !== true ||
      stringValue(input.productionRelease.reportStatus, "") === "insufficient_evidence" ||
      stringValue(releaseLabel.status, "") === "blocked_insufficient_evidence");
  if (releaseBlocked) {
    const error = new Error("AI Grader report is not publish-ready. Final grade, label data, and QR payload are required before publishing.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_REPORT_NOT_PUBLISH_READY";
    throw error;
  }
}

function assertStorageReadyPlan(plan: AiGraderProductionStoragePlan, publicationStatus: string) {
  const reportImageAssetCount = plan.artifacts.filter((artifact) => artifact.artifactClass === "report_asset").length;
  if (publicationStatus === "published" && reportImageAssetCount < 1) {
    const error = new Error("AI Grader publish requires storage-ready report image asset metadata with checksum and byte size.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_REPORT_IMAGES_REQUIRED";
    throw error;
  }
}

function assertUploadManifestMatchesPlan(manifest: AiGraderProductionUploadManifest, plan: AiGraderProductionStoragePlan) {
  const byId = new Map(manifest.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  for (const artifact of plan.artifacts) {
    const uploaded = byId.get(artifact.artifactId);
    if (!uploaded) throw new Error(`Upload manifest is missing ${artifact.kind}.`);
    if (uploaded.storageKey !== artifact.storageKey) throw new Error(`Upload manifest storage key mismatch for ${artifact.kind}.`);
    if (uploaded.checksumSha256.toLowerCase() !== artifact.checksumSha256.toLowerCase()) {
      throw new Error(`Upload manifest checksum mismatch for ${artifact.kind}.`);
    }
    if (uploaded.byteSize !== artifact.byteSize) throw new Error(`Upload manifest byte size mismatch for ${artifact.kind}.`);
    if (uploaded.publicUrl && artifact.publicUrl && uploaded.publicUrl !== artifact.publicUrl) {
      throw new Error(`Upload manifest public URL mismatch for ${artifact.kind}.`);
    }
  }
}

function normalizedContentType(value: string | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function storageContentTypeMatches(actual: string | undefined, expected: string | undefined) {
  if (!actual || !expected) return true;
  return normalizedContentType(actual) === normalizedContentType(expected);
}

async function verifyUploadedArtifacts(
  deps: AiGraderProductionApiDependencies,
  manifest: AiGraderProductionUploadManifest
) {
  if (!deps.verifyUploadedArtifact) return;
  for (const artifact of manifest.artifacts) {
    const verified = await deps.verifyUploadedArtifact(artifact);
    if (!verified.ok) throw new Error(verified.message ?? `Uploaded artifact ${artifact.artifactId} was not found in storage.`);
    if (typeof verified.byteSize === "number" && verified.byteSize !== artifact.byteSize) {
      throw new Error(`Storage byte size mismatch for ${artifact.artifactId}.`);
    }
    if (!storageContentTypeMatches(verified.contentType, artifact.contentType)) {
      throw new Error(`Storage content type mismatch for ${artifact.artifactId}.`);
    }
    if (
      typeof verified.checksumSha256 === "string" &&
      verified.checksumSha256 &&
      verified.checksumSha256.toLowerCase() !== artifact.checksumSha256.toLowerCase()
    ) {
      throw new Error(`Storage checksum metadata mismatch for ${artifact.artifactId}.`);
    }
  }
}

function parseCardSearchQuery(req: NextApiRequest) {
  const query = stringValue(Array.isArray(req.query.q) ? req.query.q[0] : req.query.q, "");
  const limit = Math.max(
    1,
    Math.min(25, Math.trunc(numericValue(Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit, 10)))
  );
  if (!query) throw new Error("q is required.");
  return { query, limit };
}

function parseCompsBody(body: unknown) {
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  if (!isRecord(body.reportBundle)) throw new Error("reportBundle is required.");
  if (!isRecord(body.productionRelease)) throw new Error("productionRelease is required.");
  const reportBundle = body.reportBundle as AiGraderProductionReportBundleLike;
  const productionRelease = body.productionRelease as AiGraderProductionReleaseLike;
  const reportId = stringValue(body.reportId ?? productionRelease.reportId ?? reportBundle.reportId, "");
  if (!reportId) throw new Error("reportId is required.");
  const selection = isRecord(body.selection) ? (body.selection as AiGraderCardItemSelection) : null;
  const searchQuery =
    stringValue(body.searchQuery, "") ||
    buildAiGraderCompsSearchQuery({
      reportBundle,
      productionRelease,
      selection,
    });
  const limit = Math.max(1, Math.min(25, Math.trunc(numericValue(body.limit, 10))));
  return { reportId, reportBundle, productionRelease, searchQuery, limit };
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "no", "n", "0"].includes(normalized)) return false;
  }
  return fallback;
}

function parseConfirmedCardIdentity(value: unknown): AiGraderConfirmedCardIdentity {
  if (!isRecord(value)) throw new Error("identity is required.");
  const categoryRaw = stringValue(value.category, "sport").toLowerCase();
  if (categoryRaw !== "sport" && categoryRaw !== "tcg" && categoryRaw !== "comics") {
    throw new Error("identity.category must be sport, tcg, or comics.");
  }
  const category = categoryRaw;
  const identity: AiGraderConfirmedCardIdentity = {
    category,
    playerName: optionalString(value.playerName),
    cardName: optionalString(value.cardName),
    teamName: optionalString(value.teamName),
    year: optionalString(value.year),
    manufacturer: optionalString(value.manufacturer ?? value.brand),
    sport: optionalString(value.sport),
    game: optionalString(value.game),
    productSet: optionalString(value.productSet ?? value.productLine ?? value.setName),
    productLine: optionalString(value.productLine ?? value.productSet ?? value.setName),
    insert: optionalString(value.insert ?? value.insertSet),
    insertSet: optionalString(value.insertSet ?? value.insert),
    parallel: optionalString(value.parallel),
    cardNumber: optionalString(value.cardNumber),
    numbered: optionalString(value.numbered),
    autograph: booleanValue(value.autograph, false),
    memorabilia: booleanValue(value.memorabilia, false),
  };
  const missing: string[] = [];
  if (!identity.year) missing.push("year");
  if (!identity.manufacturer) missing.push("manufacturer");
  if (!identity.productSet) missing.push("productSet");
  if (!identity.cardNumber) missing.push("cardNumber");
  if (identity.category === "sport") {
    if (!identity.playerName) missing.push("playerName");
    if (!identity.sport) missing.push("sport");
  }
  if (identity.category === "tcg") {
    if (!identity.cardName) missing.push("cardName");
    if (!identity.game) missing.push("game");
  }
  if (identity.category === "comics" && !identity.cardName) {
    missing.push("cardName");
  }
  if (missing.length) {
    const error = new Error(`Confirmed card identity is incomplete: ${Array.from(new Set(missing)).join(", ")} required.`);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_INCOMPLETE_CARD_IDENTITY";
    throw error;
  }
  return identity;
}

function parseCreateCardFromReportBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader create-card request");
  assertNoUnsafePublishPayload(body);
  const parsed = parseProductionPublishSmallBody(body);
  const source = body as JsonRecord;
  const identity = parseConfirmedCardIdentity(source.identity ?? parsed.reportBundle.cardIdentity);
  return {
    ...parsed,
    identity,
  };
}

function parseSlabbedPhotoInitBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader slabbed photo init request");
  assertNoUnsafePublishPayload(body);
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  const reportId = stringValue(body.reportId, "");
  const side = stringValue(body.side, "") as AiGraderSlabbedPhotoSide;
  const fileName = stringValue(body.fileName, `${side || "slabbed"}-photo.jpg`);
  const mimeType = stringValue(body.mimeType, "image/jpeg");
  const checksumSha256 = stringValue(body.checksumSha256, "");
  const byteSize = numericValue(body.byteSize, 0);
  if (!reportId) throw new Error("reportId is required.");
  if (side !== "front" && side !== "back") throw new Error("side must be front or back.");
  if (!/^image\//i.test(mimeType)) throw new Error("Only image uploads are supported for slabbed photos.");
  if (!/^[a-f0-9]{64}$/i.test(checksumSha256)) throw new Error("checksumSha256 must be a SHA-256 hex digest.");
  if (!Number.isFinite(byteSize) || byteSize <= 0) throw new Error("byteSize must be positive.");
  return {
    reportId,
    side,
    fileName,
    mimeType,
    checksumSha256: checksumSha256.toLowerCase(),
    byteSize: Math.round(byteSize),
  };
}

function parseSlabbedPhotoFinalizeBody(body: unknown) {
  const input = parseSlabbedPhotoInitBody(body);
  const storageKey = stringValue(isRecord(body) ? body.storageKey : "", "");
  const publicUrl = stringValue(isRecord(body) ? body.publicUrl : "", "");
  if (!storageKey) throw new Error("storageKey is required.");
  if (!publicUrl) throw new Error("publicUrl is required.");
  return {
    ...input,
    storageKey,
    publicUrl,
  };
}

function parseSelectedCompsBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader selected comps request");
  assertNoUnsafePublishPayload(body);
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  const reportId = stringValue(body.reportId, "");
  const selectedComps = Array.isArray(body.selectedComps) ? body.selectedComps : Array.isArray(body.compsRefs) ? body.compsRefs : [];
  if (!reportId) throw new Error("reportId is required.");
  if (!selectedComps.length) throw new Error("selectedComps is required.");
  return {
    reportId,
    selectedComps,
    searchQuery: optionalString(body.searchQuery),
    searchUrl: optionalString(body.searchUrl),
    valuationCurrency: optionalString(body.valuationCurrency) ?? "USD",
  };
}

function parseAddToInventoryBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader add-to-inventory request");
  assertNoUnsafePublishPayload(body);
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  const reportId = stringValue(body.reportId, "");
  if (!reportId) throw new Error("reportId is required.");
  return { reportId };
}

function parseLabelSheetMutationBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader label sheet request");
  assertNoUnsafePublishPayload(body);
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  const sheetId = stringValue(body.sheetId, "");
  const expectedRevision = stringValue(body.expectedRevision, "");
  if (!sheetId) throw new Error("sheetId is required.");
  if (!expectedRevision) throw new Error("expectedRevision is required.");
  return { sheetId, expectedRevision };
}

function dateString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function warningCount(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return value ? 1 : 0;
}

export function buildAiGraderProductionHistoryResult(rows: unknown[]): AiGraderProductionHistoryResult {
  const items = rows.filter(isRecord).map((row) => {
    const session = isRecord(row.session) ? row.session : {};
    return {
      reportId: stringValue(row.reportId, "unknown-report"),
      gradingSessionId: typeof session.gradingSessionId === "string" ? session.gradingSessionId : null,
      reportStatus: stringValue(row.reportStatus, "draft"),
      publicationStatus: stringValue(row.publicationStatus, "draft"),
      visibilityStatus: stringValue(row.visibilityStatus, "private"),
      publicReportUrl: typeof row.publicReportUrl === "string" ? row.publicReportUrl : null,
      qrPayloadUrl: typeof row.qrPayloadUrl === "string" ? row.qrPayloadUrl : null,
      finalOverallGrade: asNumber(row.finalOverallGrade),
      confidence: row.confidence,
      warnings: row.warnings,
      cardAssetId: typeof row.cardAssetId === "string" ? row.cardAssetId : null,
      itemId: typeof row.itemId === "string" ? row.itemId : null,
      createdAt: dateString(row.createdAt),
      updatedAt: dateString(row.updatedAt),
      finalizedAt: dateString(row.finalizedAt),
      publishedAt: dateString(row.publishedAt),
    };
  });
  const graded = items
    .map((item) => item.finalOverallGrade)
    .filter((grade): grade is number => typeof grade === "number" && Number.isFinite(grade));
  const gradeDistribution: Record<string, number> = {};
  for (const grade of graded) {
    const bucket = String(Math.floor(grade));
    gradeDistribution[bucket] = (gradeDistribution[bucket] ?? 0) + 1;
  }
  return {
    source: "persisted_records",
    items,
    stats: {
      total: items.length,
      published: items.filter((item) => item.publicationStatus === "published").length,
      finalized: items.filter((item) => item.publicationStatus === "finalized").length,
      draft: items.filter((item) => item.publicationStatus === "draft").length,
      averageFinalGrade: graded.length ? Number((graded.reduce((sum, grade) => sum + grade, 0) / graded.length).toFixed(2)) : null,
      gradeDistribution,
      warningCount: items.reduce((sum, item) => sum + warningCount(item.warnings), 0),
    },
  };
}

function firstRecord(value: unknown) {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasQueueSlabbedSide(asset: unknown, side: "front" | "back") {
  if (!isRecord(asset)) return false;
  if (optionalString(asset.side) !== side) return false;
  return Boolean(optionalString(asset.storageKey) && optionalString(asset.publicUrl) && numericValue(asset.byteSize, 0) > 0);
}

function queueCardTitle(row: JsonRecord) {
  const item = firstRecord(row.item);
  const cardAsset = firstRecord(row.cardAsset);
  const itemName = optionalString(item?.name);
  const itemSet = optionalString(item?.set);
  const itemNumber = optionalString(item?.number);
  if (itemName) return [itemSet, itemName, itemNumber ? `#${itemNumber}` : ""].filter(Boolean).join(" ");
  const customTitle = optionalString(cardAsset?.customTitle);
  if (customTitle) return customTitle;
  const resolvedPlayer = optionalString(cardAsset?.resolvedPlayerName);
  if (resolvedPlayer) return resolvedPlayer;
  const fileName = optionalString(cardAsset?.fileName);
  if (fileName) return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
  return optionalString(row.reportId) ?? "AI Grader card";
}

function finishStatusText(status: AiGraderFinishCardsQueueStatus): AiGraderFinishCardsQueueItem["statusText"] {
  if (status === "needs_comps_review") return "Needs Comps Review";
  if (status === "needs_slab_photos") return "Needs Slab Photos";
  if (status === "ready_for_inventory") return "Ready for Inventory";
  return "Complete";
}

function positiveQueueInteger(value: unknown) {
  const parsed = numberOrNull(value);
  return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function queueLabelSheetPosition(label: JsonRecord | null) {
  const payload = firstRecord(label?.payload);
  const labelSheet = firstRecord(payload?.labelSheet);
  return {
    sheetNumber: positiveQueueInteger(labelSheet?.sheetNumber),
    slot: positiveQueueInteger(labelSheet?.slot),
  };
}

function safeAiGraderDownstreamUrl(value: unknown, options: { allowQuery?: boolean } = {}) {
  const text = optionalString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      unwrappedHostname.includes(":") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      /^0\./.test(hostname) ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) ||
      /^198\.1[89]\./.test(hostname) ||
      /^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(hostname)
    ) {
      return null;
    }
    for (const key of url.searchParams.keys()) {
      if (/^(?:x-amz-|x-goog-|awsaccesskeyid$|signature$|sig$|credential$|security.?token$|access.?token$|api.?key$|token$|expires$|se$|sp$|sv$)/i.test(key)) {
        return null;
      }
    }
    if ((!options.allowQuery && url.search) || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeQueueCompRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const url = safeAiGraderDownstreamUrl(entry.url ?? entry.href, { allowQuery: true });
    if (!url) return [];
    const listingImageUrl = safeAiGraderDownstreamUrl(entry.listingImageUrl ?? entry.thumbnail, { allowQuery: true });
    const screenshotUrl = safeAiGraderDownstreamUrl(entry.screenshotUrl, { allowQuery: true });
    return [
      {
        id: optionalString(entry.id) ?? `comp-${index + 1}`,
        source: optionalString(entry.source) ?? "ebay_sold",
        title: optionalString(entry.title) ?? null,
        url,
        price: optionalString(entry.price) ?? null,
        soldDate: optionalString(entry.soldDate ?? entry.dateOfSale) ?? null,
        matchScore: numberOrNull(entry.matchScore),
        matchQuality: optionalString(entry.matchQuality) ?? null,
        ...(listingImageUrl ? { listingImageUrl } : {}),
        ...(screenshotUrl ? { screenshotUrl } : {}),
      },
    ];
  });
}

function compareFinishQueueItems(left: AiGraderFinishCardsQueueItem, right: AiGraderFinishCardsQueueItem) {
  const leftHasPosition = left.label.sheetNumber != null && left.label.slot != null;
  const rightHasPosition = right.label.sheetNumber != null && right.label.slot != null;
  if (leftHasPosition && rightHasPosition) {
    const sheetOrder = Number(left.label.sheetNumber) - Number(right.label.sheetNumber);
    if (sheetOrder) return sheetOrder;
    const slotOrder = Number(left.label.slot) - Number(right.label.slot);
    if (slotOrder) return slotOrder;
  } else if (leftHasPosition !== rightHasPosition) {
    return leftHasPosition ? -1 : 1;
  }
  const leftTime = left.createdAt ?? left.publishedAt ?? "";
  const rightTime = right.createdAt ?? right.publishedAt ?? "";
  const timeOrder = leftTime.localeCompare(rightTime);
  return timeOrder || left.reportId.localeCompare(right.reportId);
}

export function buildAiGraderFinishCardsQueueResult(rows: unknown[], options: AiGraderFinishCardsQueueBuildOptions = {}): AiGraderFinishCardsQueueResult {
  const allItems = rows.filter(isRecord).map((row): AiGraderFinishCardsQueueItem => {
    const label = firstRecord(row.labels) ?? firstRecord(row.label);
    const valuation = firstRecord(row.valuations) ?? firstRecord(row.valuation);
    const valuationSummary = firstRecord(valuation?.resultSummary);
    const valuationError = firstRecord(valuationSummary?.error);
    const cardAsset = firstRecord(row.cardAsset);
    const session = firstRecord(row.session);
    const assets = Array.isArray(row.evidenceAssets) ? row.evidenceAssets : [];
    const frontAsset = assets.find((asset) => hasQueueSlabbedSide(asset, "front"));
    const backAsset = assets.find((asset) => hasQueueSlabbedSide(asset, "back"));
    const slabComplete = Boolean(frontAsset && backAsset);
    const persistedValuationStatus = optionalString(valuation?.status);
    const valuationUpdatedAt = dateString(valuation?.updatedAt);
    const valuationUpdatedTime = valuationUpdatedAt ? new Date(valuationUpdatedAt).getTime() : Number.NaN;
    const staleRunning =
      persistedValuationStatus === "running" &&
      Number.isFinite(valuationUpdatedTime) &&
      Date.now() - valuationUpdatedTime >= 5 * 60 * 1000;
    const valuationStatus = staleRunning ? "failed" : persistedValuationStatus;
    const valuationMinor = numberOrNull(valuation?.valuationMinor);
    const valuationComplete = valuationStatus === "completed" && valuationMinor != null && valuationMinor > 0;
    const compsRefs = safeQueueCompRefs(valuation?.compsRefs);
    const errorCode =
      optionalString(valuation?.errorCode) ??
      optionalString(valuationSummary?.errorCode) ??
      optionalString(valuationError?.code) ??
      (staleRunning ? "AI_GRADER_COMPS_STALE_RUNNING" : null);
    const persistedErrorMessage =
      optionalString(valuationSummary?.errorMessage) ??
      optionalString(valuationError?.message) ??
      null;
    const errorMessage = persistedErrorMessage
      ? aiGraderCompsFailure(new Error(persistedErrorMessage)).message
      : staleRunning
        ? "The previous eBay sold comps attempt stopped before completing. Retry the lookup."
        : null;
    const retryable = staleRunning || booleanValue(valuationSummary?.retryable, booleanValue(valuationError?.retryable, false));
    const reviewStage = optionalString(cardAsset?.reviewStage);
    const inventoryComplete = reviewStage === CardReviewStage.INVENTORY_READY_FOR_SALE || optionalString(session?.status) === "inventory_ready";
    const labelPrinted = optionalString(label?.physicalPrintStatus) === "printed";
    const labelSheetPosition = queueLabelSheetPosition(label);
    const queueStatus: AiGraderFinishCardsQueueStatus = !valuationComplete
      ? "needs_comps_review"
      : !slabComplete
        ? "needs_slab_photos"
        : inventoryComplete
          ? "complete"
          : "ready_for_inventory";
    const needs: AiGraderFinishCardsQueueItem["needs"] = [];
    if (!valuationComplete) needs.push("Comps Review");
    if (!slabComplete) needs.push("Slab Photos");
    if (slabComplete && valuationComplete && !inventoryComplete) needs.push("Add To Inventory");

    return {
      reportId: stringValue(row.reportId, "unknown-report"),
      certId: optionalString(label?.certId),
      cardTitle: queueCardTitle(row),
      grade: numberOrNull(row.finalOverallGrade),
      cardAssetId: optionalString(row.cardAssetId),
      itemId: optionalString(row.itemId),
      publicReportUrl: safeAiGraderDownstreamUrl(row.publicReportUrl),
      labelPreviewUrl:
        safeAiGraderDownstreamUrl(label?.labelPreviewUrl) ??
        safeAiGraderDownstreamUrl(buildAiGraderLabelPreviewUrl(stringValue(row.reportId, "unknown-report"))),
      qrPayloadUrl: safeAiGraderDownstreamUrl(row.qrPayloadUrl) ?? safeAiGraderDownstreamUrl(label?.qrPayloadUrl),
      publishedAt: dateString(row.publishedAt),
      createdAt: dateString(row.createdAt),
      queueStatus,
      statusText: finishStatusText(queueStatus),
      needs,
      label: {
        printed: labelPrinted,
        physicalPrintStatus: optionalString(label?.physicalPrintStatus),
        sheetNumber: labelSheetPosition.sheetNumber,
        slot: labelSheetPosition.slot,
      },
      slabPhotos: {
        frontUploaded: Boolean(frontAsset),
        backUploaded: Boolean(backAsset),
        complete: slabComplete,
        frontUrl: isRecord(frontAsset) ? safeAiGraderDownstreamUrl(frontAsset.publicUrl) : null,
        backUrl: isRecord(backAsset) ? safeAiGraderDownstreamUrl(backAsset.publicUrl) : null,
      },
      valuation: {
        complete: valuationComplete,
        status: valuationStatus ?? null,
        valuationMinor,
        valuationCurrency: optionalString(valuation?.valuationCurrency) ?? "USD",
        searchQuery: optionalString(valuation?.searchQuery) ?? null,
        searchUrl: safeAiGraderDownstreamUrl(valuationSummary?.searchUrl, { allowQuery: true }),
        compsRefs,
        errorCode,
        errorMessage,
        retryable,
      },
      inventory: {
        complete: inventoryComplete,
        reviewStage: reviewStage ?? null,
        canAddToInventory: labelPrinted && slabComplete && valuationComplete && !inventoryComplete,
      },
    };
  });
  allItems.sort(compareFinishQueueItems);
  const activeItems = allItems.filter((item) => item.queueStatus !== "complete");
  const completedItems = allItems.filter((item) => item.queueStatus === "complete");
  const activeLimit = options.activeLimit ?? 100;
  const limitedActiveItems = activeLimit > 0 ? activeItems.slice(0, activeLimit) : activeItems;
  const recentCompletedLimit = Math.max(0, Math.trunc(options.recentCompletedLimit ?? 0));
  const includedCompletedItems = options.includeCompleted
    ? completedItems
    : recentCompletedLimit > 0
      ? completedItems.slice(-recentCompletedLimit)
      : [];
  const items = [...limitedActiveItems, ...includedCompletedItems].sort(compareFinishQueueItems);
  return {
    source: "persisted_records",
    orderedBy: "labelSheet_asc_slot_asc_createdAt_asc",
    items,
    stats: {
      total: items.length,
      needsCompsReview: items.filter((item) => item.queueStatus === "needs_comps_review").length,
      needsSlabPhotos: items.filter((item) => item.queueStatus === "needs_slab_photos").length,
      readyForInventory: items.filter((item) => item.queueStatus === "ready_for_inventory").length,
      needsEbayEvaluate: items.filter((item) => item.queueStatus === "needs_comps_review").length,
      needsInventory: items.filter((item) => item.queueStatus === "ready_for_inventory").length,
      complete: allItems.filter((item) => item.queueStatus === "complete").length,
    },
  };
}

export function createAiGraderProductionApiHandler(deps: AiGraderProductionApiDependencies) {
  const env = deps.env ?? process.env;
  return async function aiGraderProductionApiHandler(req: NextApiRequest, res: NextApiResponse) {
    const key = actionKey(req);
    if (key === "status") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ ok: false, message: "Method not allowed" });
      }
      return res.status(200).json({
        ok: true,
        enabled: isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV),
        service: "ai-grader-production-publication",
        writesRequireEnv: AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV,
        publicReportDbReadsEnabled: isEnabled(env, AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV),
        liveEbayCompsEnabled: isEnabled(env, AI_GRADER_EBAY_COMPS_ENABLED_ENV),
        actions: [
          "auth-check",
          "publish-init",
          "publish-finalize",
          "create-card-from-report",
          "history",
          "finish-queue",
          "label-sheets",
          "prepare-label-sheet-print",
          "mark-label-sheet-printed",
          "card-search",
          "slabbed-photo-init",
          "slabbed-photo-finalize",
          "upload-slab-photo",
          "run-comps",
          "save-comps-selection",
          "add-to-inventory",
        ],
        auth: aiGraderProductionAuthStatus(env),
        noHardwareControls: true,
      });
    }

    if (key === "publish") {
      return res.status(410).json({
        ok: false,
        code: "AI_GRADER_LEGACY_PUBLISH_REJECTED",
        message: "Use publish-init, direct storage uploads, and publish-finalize. AI Grader image/base64 bundles are not accepted by Vercel.",
      });
    }

    if (key === "mark-label-printed") {
      return res.status(410).json({
        ok: false,
        code: "AI_GRADER_PER_LABEL_PRINT_RETIRED",
        message: "Use the label sheets page to prepare a sheet and mark every label on that sheet printed together.",
      });
    }

    const allowedActions = [
      "auth-check",
      "publish-init",
      "publish-finalize",
      "create-card-from-report",
      "history",
      "finish-queue",
      "label-sheets",
      "prepare-label-sheet-print",
      "mark-label-sheet-printed",
      "card-search",
      "slabbed-photo-init",
      "slabbed-photo-finalize",
      "upload-slab-photo",
      "run-comps",
      "save-comps-selection",
      "add-to-inventory",
    ];
    if (!allowedActions.includes(key)) {
      return res.status(404).json({ ok: false, message: "AI Grader production API route not found" });
    }
    const allow =
      key === "auth-check" || key === "history" || key === "finish-queue" || key === "label-sheets" || key === "card-search"
        ? "GET"
        : "POST";
    if (req.method !== allow) {
      res.setHeader("Allow", allow);
      return res.status(405).json({ ok: false, message: "Method not allowed" });
    }
    if (key !== "run-comps" && !isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_PRODUCTION_PUBLISH_DISABLED",
        message: "AI Grader production persistence/upload is disabled. Set AI_GRADER_PRODUCTION_PUBLISH_ENABLED=true after migrations and storage are approved.",
      });
    }

    try {
      if (allow === "POST") {
        assertSmallJsonPayload(req.body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader production request");
        assertNoUnsafePublishPayload(req.body);
      }
      const authAction: AiGraderProductionAction =
        key === "auth-check" ||
        key === "publish-init" ||
        key === "publish-finalize" ||
        key === "create-card-from-report" ||
        key === "prepare-label-sheet-print" ||
        key === "mark-label-sheet-printed" ||
        key === "add-to-inventory"
          ? "publish"
          : key === "finish-queue" || key === "label-sheets"
            ? "history"
            : key === "slabbed-photo-init" || key === "slabbed-photo-finalize" || key === "upload-slab-photo"
            ? "upload-slab-photo"
            : key === "save-comps-selection"
              ? "run-comps"
              : (key as AiGraderProductionAction);
      const actor =
        deps.requireProductionActor?.(req, authAction, env) ??
        requireAiGraderProductionActor(req, authAction, {
          env,
          requireUserSession: deps.requireUserSession,
          requireAdminSession: deps.requireAdminSession,
        });
      const authorizedActor = await actor;
      const admin = adminSessionForActor(authorizedActor);
      if (key === "auth-check") {
        const displayName =
          authorizedActor.type === "human_operator"
            ? authorizedActor.user.displayName || authorizedActor.user.phone || "Ten Kings operator"
            : authorizedActor.serviceAccountId;
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderProductionAuthCheck",
          result: {
            actorType: authorizedActor.type,
            role: authorizedActor.role,
            displayName,
            action: authorizedActor.audit.action,
          },
        });
      }
      if (key === "history") {
        const result = deps.listHistory ? await deps.listHistory() : { status: "not_implemented", items: [] };
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderProductionHistory", result });
      }
      if (key === "finish-queue") {
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const result = deps.listFinishQueue
          ? await deps.listFinishQueue({ tenantId })
          : buildAiGraderFinishCardsQueueResult([]);
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderFinishCardsQueue", result });
      }
      if (key === "label-sheets") {
        if (!deps.listLabelSheets) throw new Error("AI Grader label sheet listing is not configured.");
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const result = await deps.listLabelSheets({ tenantId });
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderLabelSheets", result });
      }
      if (key === "card-search") {
        if (!deps.searchCards) throw new Error("AI Grader card/item search is not configured.");
        const query = parseCardSearchQuery(req);
        const results = await deps.searchCards({ ...query, admin, actor: authorizedActor });
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderCardItemSearch",
          result: {
            query: query.query,
            items: results,
            manualDraftAllowed: false,
            createCardFromReportRequired: true,
          },
        });
      }
      if (key === "upload-slab-photo") {
        return res.status(410).json({
          ok: false,
          code: "AI_GRADER_LEGACY_SLAB_UPLOAD_REJECTED",
          message: "Use slabbed-photo-init, direct storage upload, and slabbed-photo-finalize. Slabbed image bodies are not accepted by Vercel.",
        });
      }
      if (key === "slabbed-photo-init") {
        if (!deps.presignUpload) throw new Error("AI Grader presigned slabbed photo upload planning is not configured.");
        const input = parseSlabbedPhotoInitBody(req.body);
        const fileName = sanitizeUploadFileName(input.fileName);
        const storageKey = `ai-grader/reports/${safeStorageSegment(input.reportId)}/slabbed/${input.side}-${Date.now()}-${fileName}`;
        const presigned = await deps.presignUpload({
          storageKey,
          contentType: input.mimeType,
          checksumSha256: input.checksumSha256,
        });
        const result: AiGraderSlabbedPhotoUploadInitResult = {
          reportId: input.reportId,
          side: input.side,
          storageKey,
          publicUrl: presigned.publicUrl,
          uploadUrl: presigned.uploadUrl,
          uploadMethod: presigned.uploadMethod,
          uploadHeaders: presigned.uploadHeaders,
          requiredFinalizeManifest: {
            reportId: input.reportId,
            side: input.side,
            storageKey,
            publicUrl: presigned.publicUrl,
            checksumSha256: input.checksumSha256,
            byteSize: input.byteSize,
            mimeType: input.mimeType,
          },
        };
        assertSmallJsonPayload(result, AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES, "AI Grader slabbed-photo-init response");
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderSlabbedPhotoUploadInit",
          result,
        });
      }
      if (key === "slabbed-photo-finalize") {
        if (!deps.finalizeSlabbedPhotoUpload) throw new Error("AI Grader slabbed photo finalize is not configured.");
        const input = parseSlabbedPhotoFinalizeBody(req.body);
        if (deps.verifyUploadedArtifact) {
          const verified = await deps.verifyUploadedArtifact({
            artifactId: `slabbed-photo:${input.reportId}:${input.side}`,
            storageKey: input.storageKey,
            publicUrl: input.publicUrl,
            checksumSha256: input.checksumSha256,
            byteSize: input.byteSize,
            contentType: input.mimeType,
          });
          if (!verified.ok) throw new Error(verified.message ?? `Uploaded slabbed ${input.side} photo was not found in storage.`);
          if (typeof verified.byteSize === "number" && verified.byteSize !== input.byteSize) {
            throw new Error(`Storage byte size mismatch for slabbed ${input.side} photo.`);
          }
          if (!storageContentTypeMatches(verified.contentType, input.mimeType)) {
            throw new Error(`Storage content type mismatch for slabbed ${input.side} photo.`);
          }
          if (
            typeof verified.checksumSha256 === "string" &&
            verified.checksumSha256 &&
            verified.checksumSha256.toLowerCase() !== input.checksumSha256.toLowerCase()
          ) {
            throw new Error(`Storage checksum metadata mismatch for slabbed ${input.side} photo.`);
          }
        }
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const result = await deps.finalizeSlabbedPhotoUpload({
          tenantId,
          reportId: input.reportId,
          side: input.side,
          mimeType: input.mimeType,
          storageKey: input.storageKey,
          publicUrl: input.publicUrl,
          checksumSha256: input.checksumSha256,
          byteSize: input.byteSize,
          operatorUserId: actorOperatorUserId(authorizedActor),
          actorAudit: authorizedActor.audit,
        });
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderSlabbedPhotoUploadFinalize",
          result,
        });
      }
      if (key === "run-comps") {
        const input = parseCompsBody(req.body);
        const readiness = computeAiGraderValuationStatus({
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
        });
        if (readiness !== "ready") {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: readiness,
              liveExecutionEnabled: false,
              compsRefs: [],
              persisted: false,
              message:
                readiness === "not_ready_missing_grade"
                  ? "Final grade is required before comps execution."
                  : "Card identity is required before comps execution.",
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!input.searchQuery) {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "not_ready_missing_identity",
              liveExecutionEnabled: false,
              compsRefs: [],
              persisted: false,
              message: "A searchable card identity is required before comps execution.",
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!isEnabled(env, AI_GRADER_EBAY_COMPS_ENABLED_ENV)) {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "ready",
              liveExecutionEnabled: false,
              searchQuery: input.searchQuery,
              compsRefs: [],
              persisted: false,
              message: `Live eBay comps are ready but disabled. Set ${AI_GRADER_EBAY_COMPS_ENABLED_ENV}=true with SERPAPI_KEY and operator approval to execute.`,
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!deps.runComps) throw new Error("AI Grader eBay comps runner is not configured.");
        if (!deps.persistComps) throw new Error("AI Grader eBay comps persistence is not configured.");
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const requestedByUserId = actorOperatorUserId(authorizedActor);
        const startedAt = new Date().toISOString();
        const attemptId = `aigc_${aiGraderSha256(`${input.reportId}:${startedAt}:${Math.random()}`).slice(0, 24)}`;
        await deps.persistComps({
          tenantId,
          reportId: input.reportId,
          status: "running",
          searchQuery: input.searchQuery,
          compsRefs: [],
          resultSummary: {
            source: "ebay_sold",
            lifecycleStatus: "running",
            startedAt,
            attemptId,
          },
          requestedByUserId,
          actorAudit: authorizedActor.audit,
          attemptId,
        });
        try {
          const comps = await deps.runComps({
            reportId: input.reportId,
            searchQuery: input.searchQuery,
            reportBundle: input.reportBundle,
            productionRelease: input.productionRelease,
            limit: input.limit,
            admin,
            actor: authorizedActor,
          });
          const safeCompsRefs = safeQueueCompRefs(comps.compsRefs);
          const safeSearchUrl = safeAiGraderDownstreamUrl(comps.searchUrl, { allowQuery: true });
          const providerSummary = isRecord(comps.resultSummary) ? comps.resultSummary : {};
          const resultSummary = {
            source: "ebay_sold",
            lifecycleStatus: "ready",
            searchUrl: safeSearchUrl,
            candidateCount: safeCompsRefs.length,
            valuationMinor: numberOrNull(providerSummary.valuationMinor),
            valuationCurrency: optionalString(providerSummary.valuationCurrency) ?? "USD",
            startedAt,
            readyAt: new Date().toISOString(),
            attemptId,
          };
          await deps.persistComps({
            tenantId,
            reportId: input.reportId,
            status: "ready",
            searchQuery: input.searchQuery,
            compsRefs: safeCompsRefs,
            resultSummary,
            requestedByUserId,
            actorAudit: authorizedActor.audit,
            errorCode: null,
            attemptId,
          });
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "ready",
              liveExecutionEnabled: true,
              searchQuery: input.searchQuery,
              searchUrl: safeSearchUrl ?? undefined,
              compsRefs: safeCompsRefs,
              resultSummary,
              persisted: true,
              message: "Comps are ready for review. Select the correct sold comps to set valuation.",
            } satisfies AiGraderCompsRunResult,
          });
        } catch (error) {
          const failure = aiGraderCompsFailure(error);
          const failedAt = new Date().toISOString();
          await deps.persistComps({
            tenantId,
            reportId: input.reportId,
            status: "failed",
            searchQuery: input.searchQuery,
            compsRefs: [],
            resultSummary: {
              source: "ebay_sold",
              lifecycleStatus: "failed",
              startedAt,
              failedAt,
              errorCode: failure.errorCode,
              errorMessage: failure.message,
              retryable: failure.retryable,
              error: {
                code: failure.errorCode,
                message: failure.message,
                retryable: failure.retryable,
              },
              attemptId,
            },
            requestedByUserId,
            actorAudit: authorizedActor.audit,
            errorCode: failure.errorCode,
            attemptId,
          });
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "failed",
              liveExecutionEnabled: true,
              searchQuery: input.searchQuery,
              compsRefs: [],
              persisted: true,
              errorCode: failure.errorCode,
              retryable: failure.retryable,
              message: failure.message,
            } satisfies AiGraderCompsRunResult,
          });
        }
      }
      if (key === "save-comps-selection") {
        if (!deps.persistSelectedComps) throw new Error("AI Grader selected comps persistence is not configured.");
        const input = parseSelectedCompsBody(req.body);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const requestedByUserId = actorOperatorUserId(authorizedActor);
        if (!requestedByUserId) {
          const error = new Error("A human operator session is required to review and select sold comps.");
          (error as Error & { statusCode?: number }).statusCode = 403;
          throw error;
        }
        const result = await deps.persistSelectedComps({
          tenantId,
          reportId: input.reportId,
          selectedComps: input.selectedComps,
          searchQuery: input.searchQuery,
          searchUrl: input.searchUrl,
          valuationCurrency: input.valuationCurrency,
          requestedByUserId,
          actorAudit: authorizedActor.audit,
        });
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderSelectedCompsSave",
          result,
        });
      }
      if (key === "prepare-label-sheet-print" || key === "mark-label-sheet-printed") {
        const input = parseLabelSheetMutationBody(req.body);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const common = {
          tenantId,
          sheetId: input.sheetId,
          expectedRevision: input.expectedRevision,
          operatorUserId: actorOperatorUserId(authorizedActor),
          actorAudit: authorizedActor.audit,
        };
        if (key === "prepare-label-sheet-print") {
          if (!deps.prepareLabelSheetPrint) throw new Error("AI Grader label sheet print preparation is not configured.");
          const result = await deps.prepareLabelSheetPrint(common);
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderPrepareLabelSheetPrint",
            result,
          });
        }
        if (!deps.markLabelSheetPrinted) throw new Error("AI Grader label sheet print persistence is not configured.");
        const result = await deps.markLabelSheetPrinted(common);
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderMarkLabelSheetPrinted",
          result,
        });
      }
      if (key === "add-to-inventory") {
        if (!deps.addToInventory) throw new Error("AI Grader inventory transition is not configured.");
        const input = parseAddToInventoryBody(req.body);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const result = await deps.addToInventory({
          tenantId,
          reportId: input.reportId,
          operatorUserId: actorOperatorUserId(authorizedActor),
          actorAudit: authorizedActor.audit,
        });
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderAddToInventory",
          result,
        });
      }
      if (key === "create-card-from-report") {
        if (!deps.createCardFromReport) throw new Error("AI Grader create-card-from-report is not configured.");
        const input = parseCreateCardFromReportBody(req.body);
        assertPublishedReleaseReady(input);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const plan = buildAiGraderProductionStoragePlan({
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
          publicReportBaseUrl: "https://collect.tenkings.co",
          publicUrlFor: deps.publicUrlFor,
        });
        assertStorageReadyPlan(plan, "published");
        const result = await deps.createCardFromReport({
          tenantId,
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
          storagePlan: planWithoutBodies(plan),
          identity: input.identity,
          operatorUserId: actorOperatorUserId(authorizedActor),
          actorAudit: authorizedActor.audit,
        });
        assertSmallJsonPayload(result, AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES, "AI Grader create-card-from-report response");
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderCreateCardFromReport",
          result,
        });
      }
      const input = parseProductionPublishSmallBody(req.body);
      assertPublishedReleaseReady(input);
      const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
      const plan = buildAiGraderProductionStoragePlan({
        reportBundle: input.reportBundle,
        productionRelease: input.productionRelease,
        publicReportBaseUrl: "https://collect.tenkings.co",
        publicUrlFor: deps.publicUrlFor,
      });
      assertStorageReadyPlan(plan, input.publicationStatus);
      const publishSessionId = publishSessionIdForPlan(input.reportId, plan);

      if (key === "publish-init") {
        if (!deps.presignUpload) throw new Error("AI Grader presigned upload planning is not configured.");
        const artifacts: AiGraderProductionUploadPlanArtifact[] = [];
        for (const artifact of plan.artifacts) {
          const presigned = await deps.presignUpload({
            storageKey: artifact.storageKey,
            contentType: artifact.contentType,
            checksumSha256: artifact.checksumSha256,
          });
          artifacts.push(artifactForResponse(artifact, presigned));
        }
        const result = {
          reportId: input.reportId,
          certId: input.certId ?? stringValue(input.productionRelease.label?.certId, input.reportId),
          gradingSessionId: input.gradingSessionId,
          publishSessionId,
          storageKeyPrefix: plan.storageKeyPrefix,
          publicReportUrl: plan.publicReportUrl,
          labelPreviewUrl: buildAiGraderLabelPreviewUrl(input.reportId),
          qrPayloadUrl: plan.qrPayloadUrl,
          uploadPlan: {
            storageMode: "direct_presigned_upload",
            maxVercelPayloadBytes: AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES,
            artifacts,
          },
          finalizeManifestShape: {
            reportId: input.reportId,
            publishSessionId,
            uploadManifest: {
              artifacts: plan.artifacts.map((artifact) => ({
                artifactId: artifact.artifactId,
                storageKey: artifact.storageKey,
                publicUrl: artifact.publicUrl,
                checksumSha256: artifact.checksumSha256,
                byteSize: artifact.byteSize,
                contentType: artifact.contentType,
              })),
            },
          },
        };
        assertSmallJsonPayload(result, AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES, "AI Grader publish-init response");
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderProductionPublishInit",
          result,
        });
      }

      if (key !== "publish-finalize") {
        return res.status(404).json({ ok: false, message: "AI Grader production API route not found" });
      }
      const body = req.body as JsonRecord;
      const suppliedPublishSessionId = stringValue(body.publishSessionId, "");
      if (!suppliedPublishSessionId || suppliedPublishSessionId !== publishSessionId) {
        return res.status(409).json({
          ok: false,
          code: "AI_GRADER_PUBLISH_SESSION_MISMATCH",
          message: "Publish finalize does not match the upload plan from publish-init.",
        });
      }
      const uploadManifest = parseUploadManifest(body.uploadManifest);
      assertUploadManifestMatchesPlan(uploadManifest, plan);
      await verifyUploadedArtifacts(deps, uploadManifest);
      const uploadedPlan = planWithoutBodies(plan);
      const result = await deps.persist({
        tenantId,
        reportBundle: input.reportBundle,
        productionRelease: input.productionRelease,
        storagePlan: uploadedPlan,
        publicationStatus: input.publicationStatus,
        operatorUserId: actorOperatorUserId(authorizedActor),
        cardAssetId: input.cardAssetId,
        itemId: input.itemId,
        actorAudit: authorizedActor.audit,
      });
      return res.status(200).json({
        ok: true,
        enabled: true,
        operation: "aiGraderProductionPublishFinalize",
        result: {
          reportId: result.reportId,
          gradingSessionId: result.gradingSessionId,
          certId: stringValue(input.productionRelease.label?.certId, result.reportId),
          publicationStatus: result.publicationStatus,
          publicReportUrl: result.storagePlan.publicReportUrl,
          labelPreviewUrl: buildAiGraderLabelPreviewUrl(result.reportId),
          qrPayloadUrl: result.storagePlan.qrPayloadUrl,
          uploadedAssetCount: result.storagePlan.artifacts.length,
          evidenceAssetCount: result.evidenceAssetCount,
          cardAssetUpdatedCount: result.cardAssetUpdatedCount,
          itemUpdatedCount: result.itemUpdatedCount,
          storageKeyPrefix: result.storagePlan.storageKeyPrefix,
        },
      });
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
      return res.status(errorStatus(error)).json({
        ok: false,
        ...(code ? { code } : {}),
        message: error instanceof Error ? error.message : "AI Grader production publish failed.",
      });
    }
  };
}

export function createAiGraderPublicReportApiHandler(deps: AiGraderPublicReportApiDependencies) {
  const env = deps.env ?? process.env;
  return async function aiGraderPublicReportApiHandler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, message: "Method not allowed" });
    }
    if (!isEnabled(env, AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV)) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "AI_GRADER_PUBLIC_REPORT_DB_DISABLED",
        message: "Persisted AI Grader public report reads are disabled until migrations/storage are approved.",
      });
    }
    const reportId = Array.isArray(req.query.reportId) ? req.query.reportId[0] : req.query.reportId;
    if (!reportId) return res.status(400).json({ ok: false, message: "reportId is required." });
    const bundle = await deps.readPublishedBundle(reportId);
    if (!bundle) return res.status(404).json({ ok: false, message: "Published AI Grader report not found." });
    return res.status(200).json({
      ok: true,
      reportId,
      bundle,
      readOnly: true,
      noHardwareControls: true,
    });
  };
}

export async function persistProductionReleaseRuntime(input: {
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
  operatorUserId?: string | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
}) {
  const { prisma } = await import("@tenkings/database");
  return persistAiGraderProductionRelease(prisma as any, input);
}

function safeStorageSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "ai-grader"
  );
}

function sanitizeUploadFileName(value: string) {
  const fallback = "slabbed-photo.jpg";
  const cleaned = safeStorageSegment(value || fallback);
  return cleaned.includes(".") ? cleaned : `${cleaned}.jpg`;
}

function publicImageUrlFromCard(row: JsonRecord) {
  return optionalString(row.cdnThumbUrl) ?? optionalString(row.thumbnailUrl) ?? optionalString(row.cdnHdUrl) ?? optionalString(row.imageUrl) ?? null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstArtifactUrl(plan: AiGraderProductionStoragePlan, artifact: AiGraderProductionArtifactPlan | undefined) {
  if (!artifact) return null;
  return artifact.publicUrl ?? plan.assetManifest.find((entry) => entry.artifactId === artifact.artifactId)?.publicUrl ?? null;
}

function reportImageArtifacts(plan: AiGraderProductionStoragePlan) {
  return plan.artifacts.filter((artifact) => artifact.artifactClass === "report_asset" && /^image\//i.test(artifact.contentType));
}

function primaryReportImageArtifact(plan: AiGraderProductionStoragePlan) {
  const artifacts = reportImageArtifacts(plan);
  return (
    artifacts.find((artifact) => `${artifact.storageKey} ${artifact.sourceAssetId ?? ""}`.toLowerCase().includes("front")) ??
    artifacts[0]
  );
}

function photoKindForArtifact(artifact: AiGraderProductionArtifactPlan) {
  const haystack = `${artifact.storageKey} ${artifact.sourceAssetId ?? ""} ${artifact.kind}`.toLowerCase();
  if (haystack.includes("back")) return CardPhotoKind.BACK;
  if (haystack.includes("front")) return CardPhotoKind.FRONT;
  return null;
}

function fileNameFromStorageKey(storageKey: string, fallback: string) {
  return storageKey.split("/").filter(Boolean).pop() || fallback;
}

function identitySet(identity: AiGraderConfirmedCardIdentity) {
  return identity.productSet ?? identity.productLine ?? "Unknown Set";
}

function identityTitle(identity: AiGraderConfirmedCardIdentity) {
  const subject =
    identity.category === "sport"
      ? identity.playerName
      : identity.category === "tcg"
        ? identity.cardName
        : identity.cardName ?? identity.playerName;
  return [
    identity.year,
    identity.manufacturer,
    identity.productSet ?? identity.productLine,
    subject,
    identity.cardNumber ? `#${identity.cardNumber}` : null,
    identity.parallel,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function collectibleCategoryFromIdentity(identity: AiGraderConfirmedCardIdentity) {
  if (identity.category === "sport") return "SPORTS";
  const game = (identity.game ?? "").toLowerCase();
  if (identity.category === "tcg" && game.includes("one piece")) return "ONE_PIECE";
  if (identity.category === "tcg" && game.includes("pokemon")) return "POKEMON";
  if (identity.category === "comics") return "COMICS";
  return null;
}

function classificationFromIdentity(identity: AiGraderConfirmedCardIdentity) {
  const variantKeywords = [identity.insertSet ?? identity.insert, identity.parallel]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const attributes: CardAttributes = {
    playerName: identity.category === "sport" ? identity.playerName ?? null : null,
    teamName: identity.teamName ?? null,
    year: identity.year ?? null,
    brand: identity.manufacturer ?? null,
    setName: identity.productSet ?? identity.productLine ?? null,
    variantKeywords,
    numbered: identity.numbered ?? null,
    rookie: false,
    autograph: Boolean(identity.autograph),
    memorabilia: Boolean(identity.memorabilia),
    gradeCompany: null,
    gradeValue: null,
  };
  const normalized: NormalizedClassification = {
    categoryType: identity.category,
    displayName:
      identity.category === "sport"
        ? identity.playerName ?? null
        : identity.category === "tcg"
          ? identity.cardName ?? null
          : identity.cardName ?? identity.playerName ?? null,
    cardNumber: identity.cardNumber ?? null,
    setName: identity.productSet ?? identity.productLine ?? null,
    setCode: identity.insertSet ?? identity.insert ?? null,
    year: identity.year ?? null,
    company: identity.manufacturer ?? null,
    rarity: null,
    links: {},
    pricing: [],
    ...(identity.category === "sport"
      ? {
          sport: {
            playerName: identity.playerName ?? null,
            teamName: identity.teamName ?? null,
            league: null,
            sport: identity.sport ?? null,
            cardType: null,
            subcategory: null,
            autograph: Boolean(identity.autograph),
            foil: null,
            graded: null,
            gradeCompany: null,
            grade: null,
          },
        }
      : {}),
    ...(identity.category === "tcg"
      ? {
          tcg: {
            cardName: identity.cardName ?? null,
            game: identity.game ?? null,
            series: null,
            color: null,
            type: null,
            language: null,
            foil: null,
            rarity: null,
            outOf: identity.numbered ?? null,
            subcategory: null,
          },
        }
      : {}),
  };
  return createClassificationPayloadFromAttributes(attributes, normalized);
}

function linkedProductionRelease(
  productionRelease: AiGraderProductionReleaseLike,
  cardAssetId: string,
  itemId: string,
  cardIdentity: AiGraderCardItemSearchResult
): AiGraderProductionReleaseLike {
  const existingLabel = isRecord(productionRelease.label) ? productionRelease.label : {};
  return sanitizeAiGraderReleaseLike({
    ...productionRelease,
    label: {
      ...existingLabel,
      cardIdentity: {
        ...((isRecord(existingLabel.cardIdentity) ? existingLabel.cardIdentity : {}) as JsonRecord),
        ...cardIdentity,
        source: "card_asset",
        cardAssetId,
        itemId,
      },
    },
    cardInventoryLinkage: {
      ...(isRecord(productionRelease.cardInventoryLinkage) ? productionRelease.cardInventoryLinkage : {}),
      status: "linked",
      cardAssetId,
      itemId,
      note: "AI Grader confirmed identity created and linked a Ten Kings CardAsset/Item before publish.",
    },
  });
}

function sanitizeAiGraderReleaseLike(value: JsonRecord): AiGraderProductionReleaseLike {
  return JSON.parse(JSON.stringify(value)) as AiGraderProductionReleaseLike;
}

function cardIdentityResult(input: {
  cardAssetId: string;
  itemId: string;
  title: string;
  set: string;
  identity: AiGraderConfirmedCardIdentity;
  details: unknown;
  imageUrl: string;
}): AiGraderCardItemSearchResult {
  return {
    source: "card_asset",
    cardAssetId: input.cardAssetId,
    itemId: input.itemId,
    title: input.title,
    set: input.set,
    cardNumber: input.identity.cardNumber ?? undefined,
    category: input.identity.category,
    imageUrl: input.imageUrl,
    displayTitle: input.title,
    subtitle: [input.identity.year, input.identity.manufacturer, input.set, input.identity.cardNumber ? `#${input.identity.cardNumber}` : null]
      .filter(Boolean)
      .join(" / "),
    details: isRecord(input.details) ? input.details : undefined,
  };
}

export async function searchAiGraderCardItemsRuntime(input: {
  query: string;
  limit: number;
  admin?: AdminSession | null;
  actor?: AiGraderProductionActor;
}): Promise<AiGraderCardItemSearchResult[]> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const query = input.query.trim();
  const take = Math.max(1, Math.min(25, input.limit));
  const contains = { contains: query, mode: "insensitive" as const };
  const [cards, items] = await Promise.all([
    db.cardAsset?.findMany?.({
      where: {
        OR: [
          { customTitle: contains },
          { resolvedPlayerName: contains },
          { resolvedTeamName: contains },
          { fileName: contains },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        customTitle: true,
        resolvedPlayerName: true,
        resolvedTeamName: true,
        category: true,
        subCategory: true,
        imageUrl: true,
        thumbnailUrl: true,
        cdnHdUrl: true,
        cdnThumbUrl: true,
        classificationJson: true,
      },
    }) ?? [],
    db.item?.findMany?.({
      where: {
        OR: [{ name: contains }, { set: contains }, { number: contains }],
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        name: true,
        set: true,
        number: true,
        imageUrl: true,
        thumbnailUrl: true,
        cdnHdUrl: true,
        cdnThumbUrl: true,
        detailsJson: true,
      },
    }) ?? [],
  ]);
  const cardResults = (Array.isArray(cards) ? cards : []).map((row: JsonRecord) => {
    const title = optionalString(row.customTitle) ?? optionalString(row.resolvedPlayerName) ?? "Card asset";
    return {
      source: "card_asset" as const,
      cardAssetId: optionalString(row.id),
      title,
      category: optionalString(row.category) ?? optionalString(row.subCategory) ?? null,
      imageUrl: publicImageUrlFromCard(row),
      displayTitle: title,
      subtitle: [row.category, row.subCategory, row.resolvedTeamName].filter(Boolean).join(" / ") || "CardAsset",
      details: isRecord(row.classificationJson) ? row.classificationJson : undefined,
    };
  });
  const itemResults = (Array.isArray(items) ? items : []).map((row: JsonRecord) => {
    const title = optionalString(row.name) ?? "Inventory item";
    return {
      source: "item" as const,
      itemId: optionalString(row.id),
      title,
      set: optionalString(row.set) ?? null,
      cardNumber: optionalString(row.number) ?? null,
      imageUrl: publicImageUrlFromCard(row),
      displayTitle: title,
      subtitle: [row.set, row.number].filter(Boolean).join(" #") || "Item",
      details: isRecord(row.detailsJson) ? row.detailsJson : undefined,
    };
  });
  return [...cardResults, ...itemResults].slice(0, take);
}

async function existingAiGraderCreatedCardResult(input: {
  db: any;
  tenantId: string;
  reportId: string;
  gradingSessionId?: string | null;
  productionRelease: AiGraderProductionReleaseLike;
  identity: AiGraderConfirmedCardIdentity;
  operatorUserId: string;
}): Promise<AiGraderCreateCardFromReportResult | null> {
  const session = input.gradingSessionId
    ? await input.db.aiGraderSession?.findUnique?.({
        where: { gradingSessionId: input.gradingSessionId },
        select: { cardAssetId: true, itemId: true },
      })
    : null;
  const report = await input.db.aiGraderReport?.findUnique?.({
    where: { reportId: input.reportId },
    select: { cardAssetId: true, itemId: true },
  });
  const cardAssetId = optionalString((isRecord(session) ? session.cardAssetId : null) ?? (isRecord(report) ? report.cardAssetId : null));
  if (!cardAssetId) return null;
  const card = await input.db.cardAsset?.findUnique?.({
    where: { id: cardAssetId },
    select: {
      id: true,
      batchId: true,
      customTitle: true,
      fileName: true,
      imageUrl: true,
      thumbnailUrl: true,
      cdnHdUrl: true,
      cdnThumbUrl: true,
      classificationJson: true,
    },
  });
  if (!isRecord(card)) return null;
  const inventory = await ensureInventoryReadyArtifactsTx(input.db, cardAssetId, input.operatorUserId);
  const itemId = optionalString((isRecord(session) ? session.itemId : null) ?? (isRecord(report) ? report.itemId : null)) ?? inventory.itemId;
  const fallbackTitle = identityTitle(input.identity) || optionalString(card.fileName) || cardAssetId;
  const title = optionalString(card.customTitle) ?? fallbackTitle;
  const set = identitySet(input.identity);
  const publicImageUrl = publicImageUrlFromCard(card) ?? "";
  const cardIdentity = cardIdentityResult({
    cardAssetId,
    itemId,
    title,
    set,
    identity: input.identity,
    details: card.classificationJson,
    imageUrl: publicImageUrl,
  });
  return {
    reportId: input.reportId,
    cardAssetId,
    itemId,
    batchId: stringValue(card.batchId, ""),
    title,
    set,
    publicImageUrl,
    cardIdentity,
    productionRelease: linkedProductionRelease(input.productionRelease, cardAssetId, itemId, cardIdentity),
    inventoryReady: {
      itemNumberConvention: "Item.number = CardAsset.id",
      labelPairId: inventory.labelPair?.pairId ?? null,
    },
  };
}

export async function createAiGraderCardFromReportRuntime(input: {
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  identity: AiGraderConfirmedCardIdentity;
  operatorUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  dbClient?: any;
  env?: EnvLike;
}): Promise<AiGraderCreateCardFromReportResult> {
  if (!input.operatorUserId) {
    const error = new Error("A human operator session is required to create a CardAsset/Item from an AI Grader report.");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
  const operatorUserId = input.operatorUserId;
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "");
  const gradingSessionId = optionalString(input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId);
  if (!reportId) throw new Error("reportId is required.");
  if (!gradingSessionId) throw new Error("gradingSessionId is required.");
  const primary = primaryReportImageArtifact(input.storagePlan);
  const publicImageUrl = firstArtifactUrl(input.storagePlan, primary);
  if (!primary || !publicImageUrl) {
    throw new Error("AI Grader card creation requires at least one storage-backed report image artifact.");
  }

  const { prisma } = await import("@tenkings/database");
  const db = input.dbClient ?? (prisma as any);
  return db.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw !== "function") {
      throw new Error("AI Grader report lifecycle transaction locking is unavailable.");
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))`;
    const existing = await existingAiGraderCreatedCardResult({
      db: tx,
      tenantId: input.tenantId,
      reportId,
      gradingSessionId,
      productionRelease: input.productionRelease,
      identity: input.identity,
      operatorUserId,
    });
    if (existing) {
      const [existingSession, existingReport] = await Promise.all([
        tx.aiGraderSession?.findUnique?.({
          where: { gradingSessionId },
          select: { id: true },
        }),
        tx.aiGraderReport?.findUnique?.({
          where: { reportId },
          select: { sessionId: true },
        }),
      ]);
      const sessionId = optionalString(existingSession?.id ?? existingReport?.sessionId);
      if (!sessionId) throw new Error("AI Grader session could not be resolved for label sheet assignment.");
      const downstream = await queueConfirmedAiGraderLabelTx({
        tx,
        tenantId: input.tenantId,
        sessionId,
        gradingSessionId,
        reportId,
        reportBundle: input.reportBundle,
        productionRelease: existing.productionRelease,
        storagePlan: input.storagePlan,
        confirmedIdentity: input.identity,
        cardAssetId: existing.cardAssetId,
        itemId: existing.itemId,
        operatorUserId,
      });
      return { ...existing, downstream };
    }

    const owner = await resolveInventoryReadyOwner(tx, input.env ?? process.env);
    const now = new Date();
    const classification = classificationFromIdentity(input.identity);
    const title = identityTitle(input.identity) || stringValue(input.reportBundle.cardIdentity?.title, `AI Grader ${reportId}`);
    const set = identitySet(input.identity);
    const category = collectibleCategoryFromIdentity(input.identity);
    const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
    const label = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
    const finalOverallGrade = firstNumber(finalGrade.overall, (input.reportBundle as JsonRecord).finalOverallGrade);
    const labelGrade = optionalString(label.labelGradeText) ?? (finalOverallGrade != null ? finalOverallGrade.toFixed(1) : null);
    const gradeJson = {
      source: "ai_grader_new_card_intake_v0",
      reportId,
      certId: optionalString(label.certId),
      finalGrade,
      label,
      actorAudit: input.actorAudit ?? null,
    };

    const batch = await tx.cardBatch.create({
      data: {
        label: `AI Grader ${optionalString(label.certId) ?? reportId}`,
        notes: `Created from AI Grader report ${reportId}`,
        uploadedById: operatorUserId,
        totalCount: 1,
        processedCount: 1,
        status: "READY",
        stage: "INVENTORY_READY",
        tags: ["ai-grader", "new-card-intake"],
        stageChangedAt: now,
      },
    });

    const card = await tx.cardAsset.create({
      data: {
        batchId: batch.id,
        storageKey: primary.storageKey,
        fileName: fileNameFromStorageKey(primary.storageKey, "ai-grader-report-image"),
        fileSize: primary.byteSize,
        mimeType: primary.contentType,
        imageUrl: publicImageUrl,
        thumbnailUrl: publicImageUrl,
        cdnHdUrl: publicImageUrl,
        cdnThumbUrl: publicImageUrl,
        status: CardAssetStatus.READY,
        classificationJson: jsonInput(classification),
        classificationSourcesJson: jsonInput({
          source: "ai_grader_confirmed_identity",
          reportId,
          confirmedAt: now.toISOString(),
        }),
        customTitle: title,
        resolvedPlayerName: input.identity.playerName ?? input.identity.cardName ?? null,
        resolvedTeamName: input.identity.teamName ?? null,
        aiGradingJson: jsonInput(gradeJson),
        aiGradeFinal: finalOverallGrade,
        aiGradeLabel: labelGrade,
        aiGradeGeneratedAt: now,
        reviewStage: CardReviewStage.REVIEW_COMPLETE,
        reviewStageUpdatedAt: now,
        category: category ?? undefined,
        subCategory: input.identity.sport ?? input.identity.game ?? null,
      },
    });

    const seenPhotoKinds = new Set<string>();
    for (const artifact of reportImageArtifacts(input.storagePlan)) {
      const kind = photoKindForArtifact(artifact);
      const imageUrl = firstArtifactUrl(input.storagePlan, artifact);
      if (!kind || !imageUrl || seenPhotoKinds.has(kind)) continue;
      seenPhotoKinds.add(kind);
      await tx.cardPhoto.create({
        data: {
          cardAssetId: card.id,
          kind,
          storageKey: artifact.storageKey,
          fileName: fileNameFromStorageKey(artifact.storageKey, `${kind.toLowerCase()}-ai-grader-report-image`),
          fileSize: artifact.byteSize,
          mimeType: artifact.contentType,
          imageUrl,
          thumbnailUrl: imageUrl,
          cdnHdUrl: imageUrl,
          cdnThumbUrl: imageUrl,
          createdById: operatorUserId,
        },
      });
    }

    const inventory = await ensureInventoryReadyArtifactsTx(tx, card.id, operatorUserId, {
      env: input.env ?? process.env,
      owner,
    });
    const cardIdentity = cardIdentityResult({
      cardAssetId: card.id,
      itemId: inventory.itemId,
      title,
      set,
      identity: input.identity,
      details: classification,
      imageUrl: publicImageUrl,
    });
    const linkedRelease = linkedProductionRelease(input.productionRelease, card.id, inventory.itemId, cardIdentity);
    const linkedIdentity = {
      ...input.identity,
      ...cardIdentity,
      source: "card_asset",
      status: "linked",
      itemNumberConvention: "Item.number = CardAsset.id",
    };

    const aiGraderSession = await tx.aiGraderSession.upsert({
      where: { gradingSessionId },
      update: {
        tenantId: input.tenantId,
        reportId,
        operatorUserId,
        cardAssetId: card.id,
        itemId: inventory.itemId,
        status: "card_created",
        cardIdentity: jsonInput(linkedIdentity),
        updatedAt: now,
      },
      create: {
        tenantId: input.tenantId,
        gradingSessionId,
        reportId,
        operatorUserId,
        cardAssetId: card.id,
        itemId: inventory.itemId,
        status: "card_created",
        source: "browser_station",
        cardIdentity: jsonInput(linkedIdentity),
        createdAt: now,
        updatedAt: now,
      },
    });
    const downstream = await queueConfirmedAiGraderLabelTx({
      tx,
      tenantId: input.tenantId,
      sessionId: stringValue(aiGraderSession.id, ""),
      gradingSessionId,
      reportId,
      reportBundle: input.reportBundle,
      productionRelease: linkedRelease,
      storagePlan: input.storagePlan,
      confirmedIdentity: input.identity,
      cardAssetId: card.id,
      itemId: inventory.itemId,
      operatorUserId,
      now,
    });

    return {
      reportId,
      cardAssetId: card.id,
      itemId: inventory.itemId,
      batchId: batch.id,
      title,
      set,
      publicImageUrl,
      cardIdentity,
      productionRelease: linkedRelease,
      inventoryReady: {
        itemNumberConvention: "Item.number = CardAsset.id",
        labelPairId: inventory.labelPair?.pairId ?? null,
      },
      downstream,
    };
  });
}

export async function finalizeAiGraderSlabbedPhotoUploadRuntime(input: {
  tenantId: string;
  reportId: string;
  side: AiGraderSlabbedPhotoSide;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  operatorUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
}): Promise<AiGraderSlabbedPhotoUploadResult> {
  const { prisma } = await import("@tenkings/database");
  await persistAiGraderSlabbedPhotoAsset(prisma as any, {
    tenantId: input.tenantId,
    reportId: input.reportId,
    side: input.side,
    storageKey: input.storageKey,
    publicUrl: input.publicUrl,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    checksumSha256: input.checksumSha256,
    operatorUserId: input.operatorUserId,
    actorAudit: input.actorAudit ?? null,
  });
  return {
    reportId: input.reportId,
    side: input.side,
    storageKey: input.storageKey,
    publicUrl: input.publicUrl,
    byteSize: input.byteSize,
    checksumSha256: input.checksumSha256,
    persisted: true,
  };
}

function parseCurrencyMinor(price: string | null | undefined) {
  if (!price) return null;
  const match = price.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 100);
}

export async function runAiGraderEbayCompsRuntime(input: {
  searchQuery: string;
  limit: number;
  admin?: AdminSession | null;
  actor?: AiGraderProductionActor;
}): Promise<Omit<AiGraderCompsRunResult, "status" | "liveExecutionEnabled" | "persisted">> {
  const { fetchKingsreviewEbaySoldCompPage } = await import("./kingsreviewEbayComps");
  const page = await fetchKingsreviewEbaySoldCompPage({
    query: input.searchQuery,
    limit: input.limit,
  });
  const compsRefs = page.comps.map((comp, index) => ({
    id: `ebay-sold-${index + 1}`,
    source: comp.source,
    title: comp.title,
    url: comp.url,
    price: comp.price,
    soldDate: comp.soldDate,
    matchScore: comp.matchScore ?? null,
    matchQuality: comp.matchQuality ?? null,
    listingImageUrl: comp.listingImageUrl ?? comp.thumbnail ?? null,
  }));
  const prices = page.comps.map((comp) => parseCurrencyMinor(comp.price)).filter((value): value is number => value != null);
  const valuationMinor = prices.length ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null;
  return {
    searchQuery: input.searchQuery,
    searchUrl: page.searchUrl,
    compsRefs,
    resultSummary: {
      source: "ebay_sold",
      searchUrl: page.searchUrl,
      count: compsRefs.length,
      valuationMinor,
      valuationCurrency: "USD",
      comps: compsRefs,
    },
  };
}

function normalizeSelectedComp(comp: unknown, index: number) {
  const row = isRecord(comp) ? comp : {};
  const url = optionalString(row.url ?? row.href) ?? "";
  if (!url) return null;
  return {
    id: optionalString(row.id) ?? `selected-comp-${index + 1}`,
    source: optionalString(row.source) ?? "ebay_sold",
    title: optionalString(row.title),
    url,
    screenshotUrl: optionalString(row.screenshotUrl ?? row.listingImageUrl ?? row.thumbnail),
    price: optionalString(row.price),
    soldDate: optionalString(row.soldDate ?? row.dateOfSale),
    matchScore: typeof row.matchScore === "number" ? row.matchScore : null,
    matchQuality: optionalString(row.matchQuality),
  };
}

async function findAiGraderReportForStationAction(db: any, reportId: string) {
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      id: true,
      tenantId: true,
      sessionId: true,
      reportId: true,
      publicationStatus: true,
      cardAssetId: true,
      itemId: true,
    },
  });
  if (!isRecord(report)) {
    throw new Error(`AI Grader report ${reportId} was not found. Publish the report before this step.`);
  }
  return report;
}

function mergeJsonDetails(existing: unknown, patch: Record<string, unknown>): Prisma.InputJsonValue {
  return {
    ...(isRecord(existing) ? existing : {}),
    ...patch,
  } as Prisma.InputJsonValue;
}

function aiGraderInventoryGateError(message: string, code: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
  (error as Error & { statusCode?: number; code?: string }).code = code;
  return error;
}

function hasPersistedSlabbedSide(asset: unknown, side: "front" | "back") {
  if (!isRecord(asset)) return false;
  if (optionalString(asset.side) !== side) return false;
  const storageKey = optionalString(asset.storageKey);
  const publicUrl = optionalString(asset.publicUrl);
  const byteSize = numericValue(asset.byteSize, 0);
  return Boolean(storageKey && publicUrl && byteSize > 0);
}

export async function validateAiGraderInventoryReadiness(db: any, reportId: string) {
  const report = await findAiGraderReportForStationAction(db, reportId);
  if (stringValue(report.publicationStatus, "") !== "published") {
    throw aiGraderInventoryGateError("AI Grader report must be published before inventory transition.", "AI_GRADER_REPORT_NOT_PUBLISHED");
  }
  const cardAssetId = optionalString(report.cardAssetId);
  const itemId = optionalString(report.itemId);
  if (!cardAssetId || !itemId) {
    throw aiGraderInventoryGateError(
      "AI Grader report must be linked to a CardAsset and Item before inventory transition.",
      "AI_GRADER_CARD_ITEM_LINK_REQUIRED"
    );
  }

  const label = await db.aiGraderLabel?.findFirst?.({
    where: { reportId: report.id },
    select: {
      id: true,
      physicalPrintStatus: true,
    },
  });
  if (!isRecord(label) || optionalString(label.physicalPrintStatus) !== "printed") {
    throw aiGraderInventoryGateError("AI Grader label must be marked printed before inventory transition.", "AI_GRADER_LABEL_PRINT_REQUIRED");
  }

  const slabbedAssets = await db.aiGraderEvidenceAsset?.findMany?.({
    where: {
      reportId: report.id,
      artifactClass: "slabbed_photo",
    },
    select: {
      id: true,
      side: true,
      storageKey: true,
      publicUrl: true,
      byteSize: true,
    },
  });
  const assets = Array.isArray(slabbedAssets) ? slabbedAssets : [];
  if (!assets.some((asset) => hasPersistedSlabbedSide(asset, "front")) || !assets.some((asset) => hasPersistedSlabbedSide(asset, "back"))) {
    throw aiGraderInventoryGateError(
      "AI Grader slabbed front and back photos must be persisted before inventory transition.",
      "AI_GRADER_SLABBED_PHOTOS_REQUIRED"
    );
  }

  const valuation = await db.aiGraderValuation?.findFirst?.({
    where: {
      reportId: report.id,
      status: "completed",
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      valuationMinor: true,
    },
  });
  const valuationMinor = isRecord(valuation) && typeof valuation.valuationMinor === "number" ? valuation.valuationMinor : null;
  if (valuationMinor == null || !Number.isFinite(valuationMinor) || valuationMinor <= 0) {
    throw aiGraderInventoryGateError(
      "AI Grader selected comps and completed valuation are required before inventory transition.",
      "AI_GRADER_COMPLETED_VALUATION_REQUIRED"
    );
  }

  return {
    report,
    cardAssetId,
    itemId,
    label,
    slabbedAssetCount: assets.length,
    valuation,
    valuationMinor,
  };
}

export async function persistAiGraderSelectedCompsRuntime(input: {
  tenantId: string;
  reportId: string;
  selectedComps: unknown[];
  searchQuery?: string | null;
  searchUrl?: string | null;
  valuationCurrency?: string | null;
  requestedByUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  dbClient?: any;
}): Promise<AiGraderSelectedCompsPersistResult> {
  if (!input.requestedByUserId) {
    const error = new Error("A human operator session is required to review and select sold comps.");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
  const { prisma } = await import("@tenkings/database");
  const db = input.dbClient ?? (prisma as any);
  return db.$transaction(async (tx: any) => {
  if (typeof tx.$queryRaw !== "function") {
    throw new Error("AI Grader selected comps transaction locking is unavailable.");
  }
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${input.reportId}))`;
  const report = await findAiGraderReportForStationAction(tx, input.reportId);
  if (optionalString(report.tenantId) !== input.tenantId) {
    const error = new Error("AI Grader report was not found for this tenant.");
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }
  const cardAssetId = optionalString(report.cardAssetId);
  const itemId = optionalString(report.itemId);
  if (!cardAssetId) throw new Error("AI Grader report must be linked to a CardAsset before saving comps.");
  const currentValuation = await tx.aiGraderValuation.findUnique({
    where: { id: `ai-grader-valuation:${input.reportId}` },
    select: {
      status: true,
      searchQuery: true,
      compsRefs: true,
      resultSummary: true,
      valuationCurrency: true,
    },
  });
  if (!isRecord(currentValuation) || !["ready", "completed"].includes(stringValue(currentValuation.status, ""))) {
    throw aiGraderInventoryGateError(
      "Persisted sold-comp candidates must be ready before selections can be saved.",
      "AI_GRADER_COMPS_CANDIDATES_NOT_READY"
    );
  }
  const currentValuationSummary = isRecord(currentValuation.resultSummary) ? currentValuation.resultSummary : {};
  const persistedCandidates = (Array.isArray(currentValuation.compsRefs) ? currentValuation.compsRefs : [])
    .map((comp, index) => normalizeSelectedComp(comp, index))
    .filter((comp): comp is NonNullable<ReturnType<typeof normalizeSelectedComp>> => Boolean(comp))
    .flatMap((comp) => {
      const safeUrl = safeAiGraderDownstreamUrl(comp.url, { allowQuery: true });
      return safeUrl ? [{ ...comp, url: safeUrl }] : [];
    });
  if (!persistedCandidates.length) {
    throw aiGraderInventoryGateError(
      "No persisted sold-comp candidates are available for review.",
      "AI_GRADER_COMPS_CANDIDATES_MISSING"
    );
  }
  const persistedByUrl = new Map(persistedCandidates.map((comp) => [comp.url, comp]));
  const selectedByUrl = new Map<string, (typeof persistedCandidates)[number]>();
  for (const [index, requestedValue] of input.selectedComps.entries()) {
    const requested = normalizeSelectedComp(requestedValue, index);
    const requestedUrl = safeAiGraderDownstreamUrl(requested?.url, { allowQuery: true });
    const persisted = requestedUrl ? persistedByUrl.get(requestedUrl) : undefined;
    if (!persisted) {
      throw aiGraderInventoryGateError(
        "Every selected sold comp must match a persisted candidate for this report.",
        "AI_GRADER_SELECTED_COMP_NOT_PERSISTED"
      );
    }
    selectedByUrl.set(persisted.url, persisted);
  }
  const comps = [...selectedByUrl.values()];
  if (!comps.length) throw new Error("At least one persisted sold comp must be selected.");
  const prices = comps
    .map((comp) => parseCurrencyMinor(comp.price))
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  if (!prices.length || prices.length !== comps.length) {
    throw aiGraderInventoryGateError(
      "Every selected sold comp must have a positive parseable price before valuation can be saved.",
      "AI_GRADER_SELECTED_COMP_PRICE_REQUIRED"
    );
  }
  const automaticValuationMinor = Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
  const valuationMinor = automaticValuationMinor;
  if (!Number.isFinite(valuationMinor) || valuationMinor <= 0) {
    throw aiGraderInventoryGateError(
      "Selected comps valuation must be a positive amount.",
      "AI_GRADER_SELECTED_COMP_VALUATION_INVALID"
    );
  }
  const valuationCurrency = optionalString(currentValuation.valuationCurrency) ?? input.valuationCurrency ?? "USD";

  let evidenceItemCount = 0;
  for (const comp of comps) {
    const existing = await tx.cardEvidenceItem?.findFirst?.({
      where: {
        cardAssetId,
        kind: CardEvidenceKind.SOLD_COMP,
        url: comp.url,
      },
      select: { id: true },
    });
    if (existing) continue;
    await tx.cardEvidenceItem.create({
      data: {
        cardAssetId,
        kind: CardEvidenceKind.SOLD_COMP,
        source: "ai_grader_ebay_selected_comps",
        title: comp.title ?? null,
        url: comp.url,
        screenshotUrl: comp.screenshotUrl ?? null,
        price: comp.price ?? null,
        soldDate: comp.soldDate ?? null,
        note: JSON.stringify({
          reportId: input.reportId,
          compId: comp.id,
          matchScore: comp.matchScore,
          matchQuality: comp.matchQuality,
          selectedByUserId: input.requestedByUserId ?? null,
        }),
        createdById: input.requestedByUserId ?? null,
      },
    });
    evidenceItemCount += 1;
  }

  await tx.cardAsset.update({
    where: { id: cardAssetId },
    data: {
      valuationMinor,
      valuationCurrency,
      valuationSource: "ai_grader_ebay_selected_comps",
      ebaySoldUrlAiGrade: comps[0]?.url ?? null,
      reviewStage: CardReviewStage.REVIEW_COMPLETE,
      reviewStageUpdatedAt: new Date(),
    },
  });

  if (itemId) {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { id: true, detailsJson: true },
    });
    if (isRecord(item)) {
      await tx.item.update({
        where: { id: itemId },
        data: {
          estimatedValue: valuationMinor,
          detailsJson: mergeJsonDetails(item.detailsJson, {
            aiGraderValuation: {
              reportId: input.reportId,
              source: "ai_grader_ebay_selected_comps",
              valuationMinor,
              valuationCurrency,
              selectedCompCount: comps.length,
              savedAt: new Date().toISOString(),
            },
          }),
        },
      });
    }
  }

  await persistAiGraderValuationResult(tx as any, {
    tenantId: input.tenantId,
    reportId: input.reportId,
    status: "completed",
    source: "ebay_sold",
    searchQuery: optionalString(currentValuation.searchQuery) ?? null,
    compsRefs: comps,
    resultSummary: {
      source: "ebay_sold",
      searchUrl: safeAiGraderDownstreamUrl(currentValuationSummary.searchUrl, { allowQuery: true }),
      selectedCompCount: comps.length,
      automaticValuationMinor,
      valuationMinor,
      valuationCurrency,
      comps,
    },
    valuationMinor,
    valuationCurrency,
    requestedByUserId: input.requestedByUserId ?? null,
    actorAudit: input.actorAudit ?? null,
    completedAt: new Date(),
  });

  return {
    reportId: input.reportId,
    cardAssetId,
    itemId,
    evidenceItemCount,
    valuationMinor,
    valuationCurrency,
    valuationStatus: "completed",
  };
  });
}

export async function persistAiGraderCompsRuntime(input: {
  tenantId: string;
  reportId: string;
  status: AiGraderValuationStatus;
  searchQuery?: string | null;
  compsRefs?: unknown;
  resultSummary?: unknown;
  requestedByUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  errorCode?: string | null;
  attemptId?: string | null;
  dbClient?: any;
}) {
  const { prisma } = await import("@tenkings/database");
  const db = input.dbClient ?? (prisma as any);
  const resultSummary = isRecord(input.resultSummary) ? input.resultSummary : {};
  const conflict = (message: string, code: string) => {
    const error = new Error(message) as Error & { statusCode?: number; code?: string };
    error.statusCode = 409;
    error.code = code;
    return error;
  };
  return db.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw !== "function") {
      throw new Error("AI Grader comps transaction locking is unavailable.");
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${input.reportId}))`;
    const valuationId = `ai-grader-valuation:${input.reportId}`;
    const current = await tx.aiGraderValuation.findUnique({
      where: { id: valuationId },
      select: { status: true, resultSummary: true, updatedAt: true },
    });
    const currentStatus = optionalString(current?.status);
    const currentSummary = isRecord(current?.resultSummary) ? current.resultSummary : {};
    const currentAttemptId = optionalString(currentSummary.attemptId);
    if (currentStatus === "completed") {
      throw conflict(
        "Selected sold comps and valuation are already complete. Start a manual valuation revision instead of rerunning comps.",
        "AI_GRADER_COMPS_ALREADY_COMPLETED"
      );
    }
    if (input.status === "running" && currentStatus === "running") {
      const updatedAt = current?.updatedAt instanceof Date ? current.updatedAt : new Date(String(current?.updatedAt ?? ""));
      const isRecent = Number.isFinite(updatedAt.getTime()) && Date.now() - updatedAt.getTime() < 5 * 60 * 1000;
      if (isRecent) {
        throw conflict("eBay sold comps are already running for this card.", "AI_GRADER_COMPS_ALREADY_RUNNING");
      }
    }
    if (
      input.status !== "running" &&
      input.attemptId &&
      currentAttemptId &&
      currentAttemptId !== input.attemptId
    ) {
      throw conflict(
        "This eBay sold comps result belongs to an older attempt and was not saved.",
        "AI_GRADER_COMPS_STALE_ATTEMPT"
      );
    }
    return persistAiGraderValuationResult(tx as any, {
      tenantId: input.tenantId,
      reportId: input.reportId,
      status: input.status,
      source: "ebay_sold",
      searchQuery: input.searchQuery ?? null,
      compsRefs: input.compsRefs,
      resultSummary: {
        ...resultSummary,
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      },
      valuationMinor: typeof resultSummary.valuationMinor === "number" ? resultSummary.valuationMinor : null,
      valuationCurrency: typeof resultSummary.valuationCurrency === "string" ? resultSummary.valuationCurrency : "USD",
      requestedByUserId: input.requestedByUserId ?? null,
      actorAudit: input.actorAudit ?? null,
      completedAt: input.status === "completed" ? new Date() : null,
      errorCode: input.errorCode ?? null,
    });
  });
}

export async function addAiGraderCardToInventoryRuntime(input: {
  tenantId: string;
  reportId: string;
  operatorUserId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
}): Promise<AiGraderAddToInventoryResult> {
  if (!input.operatorUserId) {
    const error = new Error("A human operator session is required to move an AI Grader card into inventory.");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
  const operatorUserId = input.operatorUserId;
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  return db.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw !== "function") {
      throw new Error("AI Grader inventory transaction locking is unavailable.");
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${input.reportId}))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${input.tenantId}))`;
    const readiness = await validateAiGraderInventoryReadiness(tx, input.reportId);
    const report = readiness.report;
    if (optionalString(report.tenantId) !== input.tenantId) {
      const error = new Error("AI Grader report was not found for this tenant.");
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    const cardAssetId = readiness.cardAssetId;
    const card = await tx.cardAsset.findUnique({
      where: { id: cardAssetId },
      select: { id: true, valuationMinor: true },
    });
    if (!isRecord(card)) throw new Error("Linked CardAsset was not found.");
    const valuationMinor = typeof card.valuationMinor === "number" ? card.valuationMinor : readiness.valuationMinor;
    if (valuationMinor == null || !Number.isFinite(valuationMinor) || valuationMinor <= 0) {
      const error = new Error(PRICE_REQUIRED_MESSAGE);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    const inventory = await ensureInventoryReadyArtifactsTx(tx, cardAssetId, operatorUserId);
    const now = new Date();
    await tx.cardAsset.update({
      where: { id: cardAssetId },
      data: {
        reviewStage: CardReviewStage.INVENTORY_READY_FOR_SALE,
        reviewStageUpdatedAt: now,
      },
    });
    await tx.aiGraderSession.updateMany({
      where: { id: report.sessionId, tenantId: input.tenantId },
      data: {
        status: "inventory_ready",
        cardAssetId,
        itemId: inventory.itemId,
        updatedAt: now,
      },
    });
    await tx.aiGraderReport.updateMany({
      where: { reportId: input.reportId, tenantId: input.tenantId },
      data: {
        cardAssetId,
        itemId: inventory.itemId,
        updatedAt: now,
      },
    });
    return {
      reportId: input.reportId,
      cardAssetId,
      itemId: inventory.itemId,
      reviewStage: CardReviewStage.INVENTORY_READY_FOR_SALE,
      labelPairId: inventory.labelPair?.pairId ?? null,
    };
  });
}

export async function listProductionReportHistoryRuntime(): Promise<AiGraderProductionHistoryResult> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const rows = await db.aiGraderReport?.findMany?.({
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      reportId: true,
      reportStatus: true,
      publicationStatus: true,
      visibilityStatus: true,
      publicReportUrl: true,
      qrPayloadUrl: true,
      finalOverallGrade: true,
      confidence: true,
      warnings: true,
      cardAssetId: true,
      itemId: true,
      createdAt: true,
      updatedAt: true,
      finalizedAt: true,
      publishedAt: true,
      session: {
        select: {
          gradingSessionId: true,
        },
      },
    },
  });
  return buildAiGraderProductionHistoryResult(Array.isArray(rows) ? rows : []);
}

const AI_GRADER_FINISH_QUEUE_ACTIVE_LIMIT = 100;
const AI_GRADER_FINISH_QUEUE_PAGE_SIZE = 100;
const AI_GRADER_FINISH_QUEUE_RECENT_COMPLETED_LIMIT = 10;

async function hydrateAiGraderFinishCardsQueueRows(db: any, reportRows: unknown[]) {
  const reports = reportRows.filter(isRecord);
  const cardAssetIds = Array.from(new Set(reports.map((row) => optionalString(row.cardAssetId)).filter((id): id is string => Boolean(id))));
  const itemIds = Array.from(new Set(reports.map((row) => optionalString(row.itemId)).filter((id): id is string => Boolean(id))));
  const cards = cardAssetIds.length
    ? await db.cardAsset?.findMany?.({
        where: { id: { in: cardAssetIds } },
        select: {
          id: true,
          fileName: true,
          customTitle: true,
          resolvedPlayerName: true,
          reviewStage: true,
          valuationMinor: true,
          valuationCurrency: true,
          aiGradeFinal: true,
          aiGradeLabel: true,
        },
      })
    : [];
  const items = itemIds.length
    ? await db.item?.findMany?.({
        where: { id: { in: itemIds } },
        select: {
          id: true,
          name: true,
          set: true,
          number: true,
          estimatedValue: true,
          detailsJson: true,
        },
      })
    : [];
  const cardById = new Map((Array.isArray(cards) ? cards : []).filter(isRecord).map((card) => [optionalString(card.id), card] as const));
  const itemById = new Map((Array.isArray(items) ? items : []).filter(isRecord).map((item) => [optionalString(item.id), item] as const));
  return reports.map((row) => ({
    ...row,
    cardAsset: cardById.get(optionalString(row.cardAssetId)),
    item: itemById.get(optionalString(row.itemId)),
  }));
}

export async function listAiGraderFinishCardsQueueRuntime(input?: {
  tenantId?: string;
}): Promise<AiGraderFinishCardsQueueResult> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const tenantId = input?.tenantId ?? process.env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
  const hydratedRows: unknown[] = [];
  const reportSelect = {
    id: true,
    reportId: true,
    publicationStatus: true,
    publicReportUrl: true,
    qrPayloadUrl: true,
    finalOverallGrade: true,
    cardAssetId: true,
    itemId: true,
    createdAt: true,
    publishedAt: true,
    session: {
      select: {
        status: true,
        gradingSessionId: true,
      },
    },
    labels: {
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: {
        certId: true,
        labelPreviewUrl: true,
        qrPayloadUrl: true,
        physicalPrintStatus: true,
        payload: true,
      },
    },
    evidenceAssets: {
      where: { artifactClass: "slabbed_photo" },
      select: {
        side: true,
        storageKey: true,
        publicUrl: true,
        byteSize: true,
        mimeType: true,
        createdAt: true,
      },
    },
    valuations: {
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: {
        status: true,
        searchQuery: true,
        compsRefs: true,
        resultSummary: true,
        valuationMinor: true,
        valuationCurrency: true,
        errorCode: true,
        requestedAt: true,
        updatedAt: true,
        completedAt: true,
      },
    },
  } as const;
  let skip = 0;

  while (true) {
    const rows = await db.aiGraderReport?.findMany?.({
      where: {
        tenantId,
        publicationStatus: "published",
        OR: [{ cardAssetId: { not: null } }, { itemId: { not: null } }],
        session: { is: { status: { not: "inventory_ready" } } },
      },
      orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }],
      skip,
      take: AI_GRADER_FINISH_QUEUE_PAGE_SIZE,
      select: reportSelect,
    });
    const reports = Array.isArray(rows) ? rows : [];
    if (!reports.length) break;

    hydratedRows.push(...(await hydrateAiGraderFinishCardsQueueRows(db, reports)));
    const activeCount = buildAiGraderFinishCardsQueueResult(hydratedRows, {
      activeLimit: AI_GRADER_FINISH_QUEUE_ACTIVE_LIMIT,
    }).items.length;
    if (activeCount >= AI_GRADER_FINISH_QUEUE_ACTIVE_LIMIT || reports.length < AI_GRADER_FINISH_QUEUE_PAGE_SIZE) break;
    skip += reports.length;
  }

  const recentCompletedRows = await db.aiGraderReport?.findMany?.({
    where: {
      tenantId,
      publicationStatus: "published",
      OR: [{ cardAssetId: { not: null } }, { itemId: { not: null } }],
      session: { is: { status: "inventory_ready" } },
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: AI_GRADER_FINISH_QUEUE_RECENT_COMPLETED_LIMIT,
    select: reportSelect,
  });
  if (Array.isArray(recentCompletedRows) && recentCompletedRows.length) {
    hydratedRows.push(...(await hydrateAiGraderFinishCardsQueueRows(db, recentCompletedRows)));
  }

  return buildAiGraderFinishCardsQueueResult(hydratedRows, {
    activeLimit: AI_GRADER_FINISH_QUEUE_ACTIVE_LIMIT,
    recentCompletedLimit: AI_GRADER_FINISH_QUEUE_RECENT_COMPLETED_LIMIT,
  });
}
