import type { NextApiRequest, NextApiResponse } from "next";
import type {
  AiGraderConfirmedPublishAuthority,
  AiGraderConfirmedPublishAuthorityInput,
  AiGraderConfirmCardReferencePlan,
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
  applyAiGraderConfirmedPublishAuthority,
  applyAiGraderServerPublishedRuntimeState,
  assertAiGraderConfirmedPublishIdentitySnapshot,
  assertAiGraderPublishPackageMatchesAuthority,
  aiGraderSha256,
  buildAiGraderPublishAuthorityRecord,
  buildAiGraderConfirmCardReferencePlan,
  buildAiGraderCompsSearchQuery,
  buildAiGraderProductionStoragePlan,
  CardAssetStatus,
  CardEvidenceKind,
  CardReviewStage,
  computeAiGraderValuationStatus,
  getAiGraderNfcStatus,
  readCachedAiGraderNfcSchemaReadiness,
  normalizeAiGraderPublicCaptureTiming,
  normalizeAiGraderPublicOcrPrefill,
  sanitizeAiGraderPublicReportBundleForRead,
  persistAiGraderSlabbedPhotoAsset,
  persistAiGraderProductionRelease,
  persistAiGraderValuationResult,
  parseAiGraderPublishAuthorityRecord,
  resolveAiGraderConfirmedPublishAuthority,
  type Prisma,
  type AiGraderPublishAuthorityRecord,
} from "@tenkings/database";
import {
  AI_GRADER_REPORT_BUNDLE_V01_VERSION,
  AI_GRADER_REPORT_BUNDLE_V02_VERSION,
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  createClassificationPayloadFromAttributes,
  type CardAttributes,
  type NormalizedClassification,
} from "@tenkings/shared";
import type { AdminSession } from "./admin";
import type { UserSession } from "./session";
import { buildAiGraderLabelPreviewUrl } from "../aiGraderOperatorWorkflow";
import {
  ensureCardItemOwnershipTx,
  ensureInventoryReadyArtifactsTx,
  PRICE_REQUIRED_MESSAGE,
  resolveAiGraderItemOwner,
} from "./inventoryReadyArtifacts";
import {
  aiGraderProductionAuthStatus,
  requireAiGraderProductionActor,
  type AiGraderProductionAction,
  type AiGraderProductionActor,
  type AiGraderProductionActorAudit,
} from "./aiGraderProductionAuth";
import type { AiGraderLabelSheetsResult } from "../aiGraderLabelSheets";
import { readStorageBuffer } from "./storage";
import { AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION } from "../aiGraderLocalStation";
import {
  completePublishedAiGraderCardTx,
  type AiGraderPublishedLabelAssignmentResult,
  type AiGraderPreparedLabelSheetResult,
  type AiGraderPrintedLabelSheetResult,
  type AiGraderRenderedLabelSheetFile,
} from "./aiGraderLabelSheetRuntime";
import type {
  AiGraderOcrPrefillResult,
  AiGraderOcrPrefillSide,
  AiGraderOcrPrefillSourceImage,
  AiGraderOcrProviderDiagnostics,
} from "./aiGraderOcrPrefill";
import {
  effectiveAiGraderOcrModel,
} from "./aiGraderOcrStructuredExtraction";
import { aiGraderNfcProgrammingReadiness, aiGraderNfcRequired } from "./aiGraderNfcPolicy";
import type { AiGraderPublicNfcRegistration } from "./aiGraderNfcPublic";
import { readAiGraderNfcStatusesForReports } from "./aiGraderNfcReadProjection";
import {
  AiGraderOcrFailure,
  isAiGraderOcrFailureCode,
} from "../aiGraderOcrFailure";
import { AI_GRADER_STORAGE_MAX_OBJECT_BYTES, sha256Base64ToHex } from "./storage";
import {
  aiGraderMathematicalNormalizedEvidenceIssue,
  aiGraderMathematicalReleaseEnvelopeIssue,
  parseAiGraderMathematicalBoundaryBundle,
} from "./aiGraderMathematicalReleaseBoundary";

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
  sourceImageWidthPx?: number;
  sourceImageHeightPx?: number;
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
  widthPx: number;
  heightPx: number;
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
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  cardAssetId: string;
  itemId: string;
  batchId: string;
  title: string;
  set: string;
  publicImageUrl: string;
  cardIdentity: AiGraderCardItemSearchResult;
  productionRelease: AiGraderProductionReleaseLike;
  itemLinkage: {
    itemNumberConvention: "Item.number = CardAsset.id";
  };
};

export type AiGraderProductionPublishPersistResult = AiGraderProductionPersistResult & {
  labelSheetAssignment?: AiGraderPublishedLabelAssignmentResult;
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
    widthPx: number;
    heightPx: number;
  };
};

export type AiGraderOcrPrefillImageUpload = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  side: AiGraderOcrPrefillSide;
  artifactRole: "normalized_card";
  fileName: string;
  mimeType: string;
  checksumSha256: string;
  byteSize: number;
  widthPx: 1200;
  heightPx: 1680;
  storageKey: string;
};

export type AiGraderOcrPrefillUploadInitResult = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
  reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
  uploadSessionId: string;
  humanConfirmationRequired: true;
  uploadPlan: Array<
    AiGraderOcrPrefillImageUpload & {
      publicUrl: string;
      uploadUrl: string;
      uploadMethod: "PUT";
      uploadHeaders: Record<string, string>;
    }
  >;
  requiredFinalizeManifest: {
    queueItemId: string;
    gradingSessionId: string;
    reportId: string;
    reportProducerContractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
    uploadSessionId: string;
    images: AiGraderOcrPrefillImageUpload[];
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
  nfcSchemaReadiness?: () => Promise<boolean>;
  requireAdminSession(req: NextApiRequest): Promise<AdminSession>;
  requireUserSession?(req: NextApiRequest): Promise<UserSession>;
  requireProductionActor?(
    req: NextApiRequest,
    action: AiGraderProductionAction,
    env: EnvLike
  ): Promise<AiGraderProductionActor>;
  publicUrlFor(storageKey: string): string;
  resolvePublishAuthority?(
    input: AiGraderConfirmedPublishAuthorityInput
  ): Promise<AiGraderConfirmedPublishAuthority>;
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
    widthPx?: number;
    heightPx?: number;
    message?: string;
  }>;
  persist(input: {
    queueItemId: string;
    tenantId: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    storagePlan: AiGraderProductionStoragePlan;
    publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
    operatorUserId?: string | null;
    cardAssetId?: string | null;
    itemId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderProductionPublishPersistResult>;
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
    queueItemId: string;
    tenantId: string;
    reportBundle: AiGraderProductionReportBundleLike;
    productionRelease: AiGraderProductionReleaseLike;
    storagePlan: AiGraderConfirmCardReferencePlan;
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
    widthPx: number;
    heightPx: number;
    operatorUserId?: string | null;
    actorAudit?: AiGraderProductionActorAudit | null;
  }): Promise<AiGraderSlabbedPhotoUploadResult>;
  runOcrPrefill?(input: {
    queueItemId: string;
    gradingSessionId: string;
    reportId: string;
    images: AiGraderOcrPrefillSourceImage[];
  }): Promise<AiGraderOcrPrefillResult & { internalProviderDiagnostics?: AiGraderOcrProviderDiagnostics }>;
  recordOcrProviderDiagnostics?(diagnostics: AiGraderOcrProviderDiagnostics): void;
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
  }): Promise<{
    reportId?: string;
    status?: string;
    valuation?: { searchQuery?: string | null };
  }>;
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
  renderLabelSheetPdf?(input: {
    tenantId: string;
    sheetId: string;
    expectedRevision: string;
    operatorUserId?: string | null;
  }): Promise<AiGraderRenderedLabelSheetFile>;
  renderLabelSheetCutSvg?(input: {
    tenantId: string;
    sheetId: string;
    expectedRevision: string;
    operatorUserId?: string | null;
  }): Promise<AiGraderRenderedLabelSheetFile>;
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

export type AiGraderFinishNfcStatus =
  | "missing"
  | "reserved"
  | "programming"
  | "verified"
  | "active"
  | "revoked"
  | "unavailable"
  | "error";

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
  nfcRequired: boolean;
  nfcStatus: AiGraderFinishNfcStatus;
  nfcTagUrl?: string | null;
  publicTagId?: string | null;
  chipType?: string | null;
  securityMode?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  queueStatus: AiGraderFinishCardsQueueStatus;
  statusText: "Needs Comps Review" | "Needs Slab Photos" | "Ready for Inventory" | "Complete";
  needs: Array<"Comps Review" | "Slab Photos" | "Program NFC" | "Add To Inventory">;
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
  nfcRequired: boolean;
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
  nfcRequired?: boolean;
};

export type AiGraderPublicReportApiDependencies = {
  env?: EnvLike;
  readPublishedBundle(reportId: string): Promise<AiGraderProductionReportBundleLike | null>;
  readNfcRegistration?(reportId: string): Promise<AiGraderPublicNfcRegistration | null>;
  readEnrichment?(reportId: string): Promise<unknown>;
  publicUrlFor?: (storageKey: string) => string;
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

export function aiGraderProductionReadiness(env: EnvLike = process.env, nfcSchemaReady = false) {
  let effectiveModel: string;
  try {
    effectiveModel = effectiveAiGraderOcrModel(env);
  } catch {
    effectiveModel = "invalid_configuration";
  }
  return {
    googleVisionConfigured: Boolean(String(env.GOOGLE_VISION_API_KEY ?? "").trim()),
    openAiConfigured: Boolean(String(env.OPENAI_API_KEY ?? "").trim()),
    effectiveAiGraderModel: effectiveModel,
    ebayCompsEnabled: isEnabled(env, AI_GRADER_EBAY_COMPS_ENABLED_ENV),
    serpApiConfigured: Boolean(String(env.SERPAPI_KEY ?? "").trim()),
    ...aiGraderNfcProgrammingReadiness(
      env,
      String(env.AI_GRADER_PRODUCTION_TENANT_ID ?? "").trim() || "ten-kings",
      nfcSchemaReady,
    ),
  };
}

export function aiGraderPublicReportDbReadsEnabled(env: EnvLike | undefined = process.env) {
  return isEnabled(env, AI_GRADER_PUBLIC_REPORT_DB_ENABLED_ENV);
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

function unsafePublishUrlValue(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = host.split(".").map((part) => Number(part));
  const isIpv4 = ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const privateIpv4 = isIpv4 && (
    ipv4[0] === 0 ||
    ipv4[0] === 10 ||
    ipv4[0] === 127 ||
    (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
    (ipv4[0] === 169 && ipv4[1] === 254) ||
    (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
    (ipv4[0] === 192 && ipv4[1] === 168) ||
    (ipv4[0] === 198 && (ipv4[1] === 18 || ipv4[1] === 19)) ||
    ipv4[0] >= 224
  );
  const privateIpv6 =
    host === "::" ||
    host === "::1" ||
    host.startsWith("::ffff:") ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89ab]/.test(host);
  const queryKeys = Array.from(parsed.searchParams.keys()).map((key) => key.toLowerCase());
  const signedQuery = queryKeys.some(
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
  );
  return (
    parsed.protocol === "file:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    host === "localhost" ||
    privateIpv4 ||
    privateIpv6 ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    (!isIpv4 && !host.includes(".") && !host.includes(":")) ||
    signedQuery
  );
}

function unsafePublishString(value: string) {
  const embeddedUrls = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return (
    /(^|[\s('"=:])(data|blob):/i.test(value) ||
    /\bfile:\/\//i.test(value) ||
    /\b[a-z]:[\\/]/i.test(value) ||
    /\\TenKings\\/i.test(value) ||
    /(^|\s)\\\\[^\\]+\\/i.test(value) ||
    /(^|[\s('"=:])(\/Users\/|\/home\/|\/root\/|\/tmp\/|\/var\/tmp\/|\/app\/|\/workspace\/)/i.test(value) ||
    embeddedUrls.some((url) => unsafePublishUrlValue(url)) ||
    /x-ai-grader-station-token|stationToken\s*[=:]|service-token|DATABASE_URL|Authorization\s*:\s*Bearer|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)/i.test(value) ||
    /\b(?:localhost|[a-z0-9-]+\.(?:local|internal|localhost)|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[789]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}|198\.(?:18|19)(?:\.\d{1,3}){2})(?::\d{1,5})?\b/i.test(value) ||
    /(^|[\s([])(?:\[?::1\]?|fc(?=[0-9a-f:]*:)[0-9a-f:]+|fd(?=[0-9a-f:]*:)[0-9a-f:]+|fe[89ab](?=[0-9a-f:]*:)[0-9a-f:]+)(?::\d{1,5})?(?=$|[\s)\],;])/i.test(value)
  );
}

function unsafePublishKey(key: string) {
  const compact = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return (
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
    compact.includes("secret") ||
    new Set([
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
    ]).has(compact)
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
      unsafePublishKey(key) ||
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

function aiGraderPublishBoundaryError(code: string, message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
  (error as Error & { statusCode?: number; code?: string }).code = code;
  return error;
}

function assertNoUnauthorizedAiGraderClaimFlags(value: unknown, path: string) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUnauthorizedAiGraderClaimFlags(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const claimKey = key === "certifiedClaim" || key === "certificationClaim" || key === "certificateGenerated";
    if (claimKey && entry !== false) {
      throw aiGraderPublishBoundaryError(
        "AI_GRADER_CERTIFIED_CLAIM_REJECTED",
        `AI Grader publish rejects ${path}.${key}; certification is not authorized.`,
      );
    }
    assertNoUnauthorizedAiGraderClaimFlags(entry, `${path}.${key}`);
  }
}

export function assertAiGraderPublishBundleBoundary(
  reportBundle: AiGraderProductionReportBundleLike,
  productionRelease: AiGraderProductionReleaseLike,
) {
  const schemaVersion = reportBundle.schemaVersion;
  if (
    schemaVersion !== AI_GRADER_REPORT_BUNDLE_V01_VERSION &&
    schemaVersion !== AI_GRADER_REPORT_BUNDLE_V02_VERSION &&
    schemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION
  ) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_UNSUPPORTED_REPORT_BUNDLE_VERSION",
      `AI Grader publish supports only ${AI_GRADER_REPORT_BUNDLE_V01_VERSION}, ${AI_GRADER_REPORT_BUNDLE_V02_VERSION}, and ${AI_GRADER_REPORT_BUNDLE_V03_VERSION}.`,
    );
  }
  assertNoUnauthorizedAiGraderClaimFlags(reportBundle, "reportBundle");
  assertNoUnauthorizedAiGraderClaimFlags(productionRelease, "productionRelease");
  if (schemaVersion === AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    const parsedV1 = parseAiGraderMathematicalBoundaryBundle(reportBundle);
    if (!parsedV1.success) throw aiGraderPublishBoundaryError('AI_GRADER_INVALID_MATHEMATICAL_REPORT_V1', parsedV1.message);
    const envelopeIssue = aiGraderMathematicalReleaseEnvelopeIssue(parsedV1.bundle, productionRelease);
    if (envelopeIssue) throw aiGraderPublishBoundaryError('AI_GRADER_MATHEMATICAL_RELEASE_MISMATCH', envelopeIssue);
  }
}

function parseProductionPublishSmallBody(body: unknown) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader publish request");
  assertNoUnsafePublishPayload(body);
  const parsed = parsePublishBody(body);
  assertAiGraderPublishBundleBoundary(parsed.reportBundle, parsed.productionRelease);
  const source = body as JsonRecord;
  const reportId = stringValue(source.reportId ?? parsed.productionRelease.reportId ?? parsed.reportBundle.reportId, "");
  if (!reportId) throw new Error("reportId is required.");
  const reportBundle: AiGraderProductionReportBundleLike = {
    ...parsed.reportBundle,
    captureTiming: normalizeAiGraderPublicCaptureTiming(parsed.reportBundle.captureTiming),
    ocrPrefill: normalizeAiGraderPublicOcrPrefill(parsed.reportBundle.ocrPrefill),
  };
  return {
    ...parsed,
    reportBundle,
    reportId,
    certId: optionalString(source.certId ?? parsed.productionRelease.label?.certId),
    gradingSessionId: optionalString(source.gradingSessionId ?? parsed.productionRelease.gradingSessionId ?? parsed.reportBundle.gradingSessionId),
    assetManifest: source.assetManifest,
    checksums: source.checksums,
  };
}

function parseConfirmedPublishSmallBody(body: unknown) {
  const parsed = parseProductionPublishSmallBody(body);
  const source = body as JsonRecord;
  const queueItemId = parseOcrExactIdentityValue(source.queueItemId, "queueItemId");
  const reportId = optionalString(source.reportId);
  const gradingSessionId = optionalString(source.gradingSessionId);
  const cardAssetId = optionalString(source.cardAssetId);
  const itemId = optionalString(source.itemId);
  const bundleReportId = optionalString(parsed.reportBundle.reportId);
  const releaseReportId = optionalString(parsed.productionRelease.reportId);
  const bundleSessionId = optionalString(parsed.reportBundle.gradingSessionId);
  const releaseSessionId = optionalString(parsed.productionRelease.gradingSessionId);
  const mathematicalV1 = parsed.reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V03_VERSION;
  const bundleIdentity = isRecord(parsed.reportBundle.cardIdentity) ? parsed.reportBundle.cardIdentity : {};
  const releaseLabel = isRecord(parsed.productionRelease.label) ? parsed.productionRelease.label : {};
  const requestedCertId = optionalString(source.certId);
  const releaseCertId = optionalString(releaseLabel.certId);
  const labelIdentity = isRecord(releaseLabel.cardIdentity) ? releaseLabel.cardIdentity : {};
  const inventoryLinkage = isRecord(parsed.productionRelease.cardInventoryLinkage)
    ? parsed.productionRelease.cardInventoryLinkage
    : {};
  const embeddedCardAssetIds = [
    optionalString(bundleIdentity.cardAssetId),
    optionalString(labelIdentity.cardAssetId),
    optionalString(inventoryLinkage.cardAssetId),
  ].filter((value): value is string => Boolean(value));
  const embeddedItemIds = [
    optionalString(bundleIdentity.itemId),
    optionalString(labelIdentity.itemId),
    optionalString(inventoryLinkage.itemId),
  ].filter((value): value is string => Boolean(value));
  if (
    !reportId ||
    !gradingSessionId ||
    !cardAssetId ||
    !itemId ||
    !bundleReportId ||
    !releaseReportId ||
    reportId !== bundleReportId ||
    reportId !== releaseReportId ||
    (!mathematicalV1 && !bundleSessionId) ||
    !releaseSessionId ||
    (bundleSessionId && gradingSessionId !== bundleSessionId) ||
    gradingSessionId !== releaseSessionId ||
    (bundleSessionId && bundleSessionId !== releaseSessionId) ||
    embeddedCardAssetIds.some((value) => value !== cardAssetId) ||
    embeddedItemIds.some((value) => value !== itemId) ||
    (optionalString(releaseLabel.reportId) && optionalString(releaseLabel.reportId) !== reportId) ||
    (requestedCertId && requestedCertId !== releaseCertId)
  ) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
      "Publish requires one exact queue, report, grading-session, CardAsset, and Item linkage.",
    );
  }
  return {
    ...parsed,
    queueItemId,
    reportId,
    gradingSessionId,
    cardAssetId,
    itemId,
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
      if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > AI_GRADER_STORAGE_MAX_OBJECT_BYTES) {
        throw new Error(
          `uploadManifest.artifacts[${index}].byteSize must be between 1 and ${AI_GRADER_STORAGE_MAX_OBJECT_BYTES}.`,
        );
      }
      const sourceImageWidthPx = entry.sourceImageWidthPx;
      const sourceImageHeightPx = entry.sourceImageHeightPx;
      const hasSourceImageDimensions = sourceImageWidthPx !== undefined || sourceImageHeightPx !== undefined;
      if (
        hasSourceImageDimensions &&
        (!Number.isSafeInteger(sourceImageWidthPx) ||
          (sourceImageWidthPx as number) < 1 ||
          (sourceImageWidthPx as number) > 100_000 ||
          !Number.isSafeInteger(sourceImageHeightPx) ||
          (sourceImageHeightPx as number) < 1 ||
          (sourceImageHeightPx as number) > 100_000)
      ) {
        throw new Error(`uploadManifest.artifacts[${index}] must include valid sourceImageWidthPx and sourceImageHeightPx together.`);
      }
      return {
        artifactId,
        storageKey,
        publicUrl: optionalString(entry.publicUrl),
        checksumSha256: checksumSha256.toLowerCase(),
        byteSize: Math.round(byteSize),
        contentType: optionalString(entry.contentType),
        ...(hasSourceImageDimensions
          ? {
              sourceImageWidthPx: sourceImageWidthPx as number,
              sourceImageHeightPx: sourceImageHeightPx as number,
            }
          : {}),
        uploadedAt: optionalString(entry.uploadedAt),
      };
    }),
  };
}

function publishSessionIdForPlan(
  identity: { queueItemId: string; gradingSessionId: string; reportId: string },
  plan: AiGraderProductionStoragePlan,
) {
  const basis = {
    ...identity,
    storageKeyPrefix: plan.storageKeyPrefix,
    artifacts: plan.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      storageKey: artifact.storageKey,
      checksumSha256: artifact.checksumSha256,
      byteSize: artifact.byteSize,
      sourceImageWidthPx: artifact.sourceImageWidthPx,
      sourceImageHeightPx: artifact.sourceImageHeightPx,
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

export function sanitizeAiGraderUploadHeadersForResponse(
  headers: Record<string, string> | undefined,
  expectedChecksumSha256: string,
) {
  const expectedChecksum = expectedChecksumSha256.trim().toLowerCase();
  const result: Record<string, string> = {};
  let checksumHeaderCount = 0;
  let contentTypeHeaderCount = 0;
  let aclHeaderCount = 0;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || normalized === "x-amz-meta-sha256") continue;
    if (normalized === "x-amz-checksum-sha256") {
      checksumHeaderCount += 1;
      if (sha256Base64ToHex(value) !== expectedChecksum) {
        throw aiGraderPublishBoundaryError(
          "AI_GRADER_UPLOAD_CHECKSUM_HEADER_INVALID",
          "AI Grader direct upload checksum header is missing or invalid.",
        );
      }
      result["x-amz-checksum-sha256"] = value.trim();
      continue;
    }
    if (normalized === "content-type") {
      contentTypeHeaderCount += 1;
      result["Content-Type"] = String(value);
      continue;
    }
    if (normalized === "x-amz-acl") {
      aclHeaderCount += 1;
      result["x-amz-acl"] = String(value);
    }
  }
  if (
    !/^[a-f0-9]{64}$/.test(expectedChecksum) ||
    checksumHeaderCount !== 1 ||
    contentTypeHeaderCount > 1 ||
    aclHeaderCount > 1
  ) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_UPLOAD_CHECKSUM_HEADER_INVALID",
      "AI Grader direct upload checksum header is missing or invalid.",
    );
  }
  return result;
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
    sourceImageWidthPx: artifact.sourceImageWidthPx,
    sourceImageHeightPx: artifact.sourceImageHeightPx,
    uploadUrl: presigned.uploadUrl,
    uploadMethod: presigned.uploadMethod,
    uploadHeaders: sanitizeAiGraderUploadHeadersForResponse(presigned.uploadHeaders, artifact.checksumSha256),
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
  reportId: string;
  gradingSessionId?: string;
  cardAssetId?: string;
  itemId?: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
}) {
  const fail = (code: string, message: string) => {
    const error = new Error(message);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = code;
    throw error;
  };
  if (
    input.publicationStatus !== "published" ||
    !input.reportId ||
    !input.gradingSessionId ||
    !input.cardAssetId ||
    !input.itemId
  ) {
    fail(
      "AI_GRADER_PUBLISH_LINKAGE_REQUIRED",
      "Publish requires explicit report, grading-session, CardAsset, and Item linkage.",
    );
  }
  const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
  const overall = typeof finalGrade.overall === "number" ? finalGrade.overall : Number.NaN;
  const elements = isRecord(finalGrade.elements) ? finalGrade.elements : {};
  const validElementScore = (key: string) => {
    const element = isRecord(elements[key]) ? elements[key] : {};
    return typeof element.score === "number" && Number.isFinite(element.score) && element.score >= 1 && element.score <= 10;
  };
  const requiredElementScoresComplete = ["corners", "edges", "surface"].every(validElementScore);
  const optionalCenteringValid = !Object.prototype.hasOwnProperty.call(elements, "centering") ||
    validElementScore("centering");
  const releaseLabel = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const mathematicalV1 = input.reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V03_VERSION;
  if (mathematicalV1) {
    const parsedV1 = parseAiGraderMathematicalBoundaryBundle(input.reportBundle);
    if (!parsedV1.success) {
      fail('AI_GRADER_PUBLISH_INVALID_MATHEMATICAL_REPORT_V1', parsedV1.message);
      return;
    }
    const envelopeIssue = aiGraderMathematicalReleaseEnvelopeIssue(parsedV1.bundle, input.productionRelease);
    if (envelopeIssue) fail('AI_GRADER_PUBLISH_MATHEMATICAL_RELEASE_MISMATCH', envelopeIssue);
  }
  if (
    !mathematicalV1 && (
    input.productionRelease.finalGradeComputed !== true ||
    input.productionRelease.reportStatus !== "final_ai_grader_report_v0" ||
    input.productionRelease.finalStatus !== "final_grade_computed" ||
    finalGrade.status !== "final_ai_grader_grade_v0" ||
    finalGrade.finalGradeComputed !== true ||
    !Number.isFinite(overall) ||
    overall < 1 ||
    overall > 10 ||
    !requiredElementScoresComplete ||
    !optionalCenteringValid
    )
  ) {
    fail(
      "AI_GRADER_PUBLISH_FINAL_GRADE_REQUIRED",
      "Publish requires a complete valid final grade from the authoritative release.",
    );
  }
  const gates = Array.isArray(input.productionRelease.gates) ? input.productionRelease.gates : [];
  const failedGate = firstFailedConfirmGate(input.reportBundle, input.productionRelease);
  const gateIds = gates.map((gate) => isRecord(gate) ? optionalString(gate.id) : undefined);
  const acceptedWarningGateIds = gates
    .filter((gate) => isRecord(gate) && gate.status === "accepted_warning")
    .map((gate) => optionalString((gate as JsonRecord).id));
  const finalization = isRecord(input.productionRelease.operatorFinalization)
    ? input.productionRelease.operatorFinalization
    : {};
  const acceptedIds = Array.isArray(finalization.acceptedWarningGateIds)
    ? finalization.acceptedWarningGateIds
    : [];
  if (
    failedGate ||
    gates.length === 0 ||
    gates.some((gate) =>
      !isRecord(gate) ||
      !optionalString(gate.id) ||
      !optionalString(gate.reason) ||
      !["pass", "accepted_warning"].includes(String(gate.status))
    ) ||
    gateIds.some((gateId) => !gateId) ||
    new Set(gateIds).size !== gateIds.length ||
    !optionalString(finalization.operatorId) ||
    !optionalString(finalization.finalizedAt) ||
    Number.isNaN(Date.parse(String(finalization.finalizedAt))) ||
    typeof finalization.warningsAccepted !== "boolean" ||
    !Array.isArray(finalization.acceptedWarningGateIds) ||
    acceptedIds.some((gateId) => typeof gateId !== "string" || !gateId.trim() || !gateIds.includes(gateId.trim())) ||
    new Set(acceptedIds).size !== acceptedIds.length ||
    acceptedWarningGateIds.some((gateId) => !acceptedIds.includes(gateId)) ||
    (acceptedWarningGateIds.length > 0 && finalization.warningsAccepted !== true)
  ) {
    fail(
      "AI_GRADER_PUBLISH_GATE_FAILED",
      failedGate
        ? "Publish failed authoritative gate " + failedGate.id + ": " + failedGate.reason
        : "Publish requires complete passing or explicitly accepted authoritative gate evidence.",
    );
  }
  const reportUrl = optionalString(releaseLabel.publicReportUrl);
  const qrPayloadUrl = optionalString(releaseLabel.qrPayloadUrl);
  const publication = isRecord(input.productionRelease.publication) ? input.productionRelease.publication : {};
  let reportUrlValid = false;
  try {
    const parsed = reportUrl ? new URL(reportUrl) : null;
    reportUrlValid = Boolean(
      parsed &&
      parsed.protocol === "https:" &&
      !parsed.search &&
      !parsed.hash &&
      decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "") === input.reportId
    );
  } catch {
    reportUrlValid = false;
  }
  if (
    input.productionRelease.labelDataGenerated !== true ||
    input.productionRelease.qrPayloadGenerated !== true ||
    optionalString(releaseLabel.status) !== "label_data_ready" ||
    optionalString(releaseLabel.reportId) !== input.reportId ||
    !optionalString(releaseLabel.certId) ||
    optionalString(releaseLabel.labelGradeText) !== overall.toFixed(1) ||
    optionalString(releaseLabel.certificateStatus) !== "report_id_issued_not_certified" ||
    !reportUrlValid ||
    !qrPayloadUrl ||
    qrPayloadUrl !== reportUrl ||
    optionalString(publication.reportId) !== input.reportId ||
    optionalString(publication.publicReportUrl) !== reportUrl ||
    optionalString(publication.qrPayloadUrl) !== qrPayloadUrl
  ) {
    fail(
      "AI_GRADER_PUBLISH_LABEL_NOT_READY",
      "Publish requires complete, internally consistent label data and QR payload evidence.",
    );
  }
}

function assertResolvedPublishAuthority(input: {
  authority: AiGraderConfirmedPublishAuthority;
  tenantId: string;
  queueItemId: string;
  reportId: string;
  gradingSessionId: string;
  cardAssetId: string;
  itemId: string;
  productionRelease: AiGraderProductionReleaseLike;
}) {
  const { authority } = input;
  const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
  const confirmedIdentity = isRecord(authority.confirmedIdentity) ? authority.confirmedIdentity : {};
  if (
    authority.tenantId !== input.tenantId ||
    authority.queueItemId !== input.queueItemId ||
    authority.reportId !== input.reportId ||
    authority.gradingSessionId !== input.gradingSessionId ||
    authority.cardAssetId !== input.cardAssetId ||
    authority.itemId !== input.itemId ||
    !optionalString(authority.sessionId) ||
    typeof authority.finalOverallGrade !== "number" ||
    authority.finalOverallGrade !== finalGrade.overall ||
    optionalString(confirmedIdentity.source) !== "card_asset" ||
    optionalString(confirmedIdentity.status) !== "linked" ||
    optionalString(confirmedIdentity.cardAssetId) !== input.cardAssetId ||
    optionalString(confirmedIdentity.itemId) !== input.itemId
  ) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_PUBLISH_AUTHORITY_MISMATCH",
      "Publish linkage does not match the durable confirmed queue, report, session, CardAsset, Item, and final-grade authority.",
    );
  }
  parseConfirmedCardIdentity(authority.confirmedIdentity);
}

const AI_GRADER_CONFIRM_REQUIRED_PRODUCER_CAPABILITIES = [
  "finding-validation-v1",
  "capture-profile-provenance-v1",
  "raster-dimensions-v1",
] as const;

function aiGraderConfirmBoundaryError(code: string, message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
  (error as Error & { statusCode?: number; code?: string }).code = code;
  return error;
}

function safeConfirmGateText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 320);
  return normalized && !unsafePublishString(normalized) ? normalized : fallback;
}

function firstFailedConfirmGate(
  reportBundle: AiGraderProductionReportBundleLike,
  productionRelease: AiGraderProductionReleaseLike,
) {
  const releaseGate = Array.isArray(productionRelease.gates)
    ? productionRelease.gates.find((entry) => isRecord(entry) && entry.status === "fail")
    : undefined;
  if (isRecord(releaseGate)) {
    return {
      id: safeConfirmGateText(releaseGate.id, "production_release"),
      reason: safeConfirmGateText(releaseGate.reason, "The production release gate failed."),
    };
  }
  const provisionalGrade = isRecord(reportBundle.provisionalGrade) ? reportBundle.provisionalGrade : {};
  const provisionalGates = isRecord(provisionalGrade.gates) ? provisionalGrade.gates : {};
  const result = Array.isArray(provisionalGates.results)
    ? provisionalGates.results.find((entry) => isRecord(entry) && entry.status === "fail")
    : undefined;
  if (isRecord(result)) {
    return {
      id: safeConfirmGateText(result.gate, "source_grade"),
      reason: safeConfirmGateText(result.summary, "The source grading gate failed."),
    };
  }
  const blocker = Array.isArray(provisionalGates.blockers)
    ? provisionalGates.blockers.find((entry) => typeof entry === "string")
    : undefined;
  if (typeof blocker === "string") {
    const separator = blocker.indexOf(":");
    return {
      id: safeConfirmGateText(separator > 0 ? blocker.slice(0, separator) : "source_grade", "source_grade"),
      reason: safeConfirmGateText(separator > 0 ? blocker.slice(separator + 1) : blocker, "The source grading gate failed."),
    };
  }
  return undefined;
}

function assertExplicitOperatorFinalization(
  productionRelease: AiGraderProductionReleaseLike,
) {
  const finalization = isRecord(productionRelease.operatorFinalization)
    ? productionRelease.operatorFinalization
    : undefined;
  const acceptedWarningGateIds = finalization?.acceptedWarningGateIds;
  if (
    !finalization ||
    !optionalString(finalization.operatorId) ||
    !optionalString(finalization.finalizedAt) ||
    Number.isNaN(Date.parse(String(finalization.finalizedAt))) ||
    typeof finalization.warningsAccepted !== "boolean" ||
    !Array.isArray(acceptedWarningGateIds) ||
    acceptedWarningGateIds.some((gateId) => typeof gateId !== "string" || !gateId.trim()) ||
    new Set(acceptedWarningGateIds).size !== acceptedWarningGateIds.length
  ) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_OPERATOR_FINALIZATION_REQUIRED",
      "Confirm Card requires an explicit authoritative operator finalization.",
    );
  }
  const gates = Array.isArray(productionRelease.gates) ? productionRelease.gates : [];
  const gateIds = gates.map((gate) => isRecord(gate) ? optionalString(gate.id) : undefined);
  const acceptedGateIds = gates
    .filter((gate) => isRecord(gate) && gate.status === "accepted_warning")
    .map((gate) => optionalString((gate as JsonRecord).id));
  if (
    gates.length === 0 ||
    gates.some((gate) =>
      !isRecord(gate) ||
      !optionalString(gate.id) ||
      !["pass", "accepted_warning", "fail"].includes(String(gate.status)) ||
      !optionalString(gate.reason) ||
      !Array.isArray(gate.evidenceRefs) ||
      gate.evidenceRefs.length === 0 ||
      gate.evidenceRefs.length > 64 ||
      gate.evidenceRefs.some((evidenceRef) =>
        typeof evidenceRef !== "string" ||
        !evidenceRef.trim() ||
        evidenceRef.length > 500
      )
    ) ||
    gateIds.some((gateId) => !gateId) ||
    new Set(gateIds).size !== gateIds.length ||
    acceptedGateIds.some((gateId) => !gateId) ||
    acceptedGateIds.length !== acceptedWarningGateIds.length ||
    acceptedGateIds.some((gateId) => !acceptedWarningGateIds.includes(gateId)) ||
    (acceptedGateIds.length > 0 && finalization.warningsAccepted !== true)
  ) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_RELEASE_GATES_INVALID",
      "Confirm Card requires complete authoritative production gate evidence.",
    );
  }
}

export function assertAuthoritativeConfirmReleaseIdentity(
  reportBundle: AiGraderProductionReportBundleLike,
  productionRelease: AiGraderProductionReleaseLike,
) {
  const reportId = optionalString(reportBundle.reportId);
  const gradingSessionId = optionalString(reportBundle.gradingSessionId);
  const embeddedRelease = isRecord(reportBundle.productionRelease)
    ? reportBundle.productionRelease
    : undefined;
  const embeddedFinalGrade = embeddedRelease && isRecord(embeddedRelease.finalGrade)
    ? embeddedRelease.finalGrade
    : {};
  const submittedFinalGrade = isRecord(productionRelease.finalGrade)
    ? productionRelease.finalGrade
    : {};
  if (
    !reportId ||
    !gradingSessionId ||
    productionRelease.schemaVersion !== "ai-grader-production-release-v0.1" ||
    optionalString(productionRelease.reportId) !== reportId ||
    optionalString(productionRelease.gradingSessionId) !== gradingSessionId ||
    !optionalString(productionRelease.generatedAt) ||
    !embeddedRelease ||
    optionalString(embeddedRelease.reportId) !== reportId ||
    optionalString(embeddedRelease.gradingSessionId) !== gradingSessionId ||
    optionalString(embeddedRelease.generatedAt) !== optionalString(productionRelease.generatedAt) ||
    embeddedRelease.finalGradeComputed !== productionRelease.finalGradeComputed ||
    embeddedFinalGrade.status !== submittedFinalGrade.status ||
    embeddedFinalGrade.overall !== submittedFinalGrade.overall ||
    embeddedFinalGrade.finalGradeComputed !== submittedFinalGrade.finalGradeComputed
  ) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_RELEASE_IDENTITY_MISMATCH",
      "Confirm Card requires the authoritative release for the same report and grading session.",
    );
  }
  if (stableStringify(embeddedRelease) !== stableStringify(productionRelease)) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_RELEASE_IDENTITY_MISMATCH",
      "Confirm Card requires the authoritative release exactly as returned with the fetched report bundle.",
    );
  }
  const embeddedFinalization = isRecord(embeddedRelease.operatorFinalization)
    ? embeddedRelease.operatorFinalization
    : {};
  const submittedFinalization = isRecord(productionRelease.operatorFinalization)
    ? productionRelease.operatorFinalization
    : {};
  if (
    optionalString(embeddedFinalization.operatorId) !== optionalString(submittedFinalization.operatorId) ||
    optionalString(embeddedFinalization.finalizedAt) !== optionalString(submittedFinalization.finalizedAt)
  ) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_RELEASE_IDENTITY_MISMATCH",
      "Confirm Card requires the authoritative release for the same report and grading session.",
    );
  }
}

function assertConfirmNormalizedEvidence(reportBundle: AiGraderProductionReportBundleLike) {
  const assets = Array.isArray(reportBundle.assets) ? reportBundle.assets : [];
  const normalized = assets.filter((asset) => isRecord(asset) && asset.evidenceRole === "normalized_card");
  const normalizedIds = normalized.map((asset) => optionalString((asset as JsonRecord).id));
  const validAsset = (asset: JsonRecord, side: "front" | "back") => {
    const checksumSha256 = optionalString(asset.checksumSha256);
    const sha256 = optionalString(asset.sha256);
    if (checksumSha256 && sha256 && checksumSha256.toLowerCase() !== sha256.toLowerCase()) return false;
    const checksum = checksumSha256 ?? sha256;
    return (
      asset.side === side &&
      asset.contentType === "image/png" &&
      asset.widthPx === 1200 &&
      asset.heightPx === 1680 &&
      Boolean(checksum && /^[a-f0-9]{64}$/i.test(checksum)) &&
      Number.isSafeInteger(asset.byteSize) &&
      Number(asset.byteSize) > 0 &&
      Boolean(optionalString(asset.id))
    );
  };
  const front = normalized.filter((asset) => isRecord(asset) && validAsset(asset, "front"));
  const back = normalized.filter((asset) => isRecord(asset) && validAsset(asset, "back"));
  if (
    normalized.length !== 2 ||
    front.length !== 1 ||
    back.length !== 1 ||
    normalizedIds.some((id) => !id) ||
    new Set(normalizedIds).size !== normalizedIds.length
  ) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_NORMALIZED_EVIDENCE_REQUIRED",
      "Confirm Card requires exactly one verified 1200x1680 PNG normalized-card asset for each side.",
    );
  }
}

function assertAiGraderMathematicalConfirmReady(
  reportBundle: AiGraderProductionReportBundleLike,
  productionRelease: AiGraderProductionReleaseLike,
) {
  const parsed = parseAiGraderMathematicalBoundaryBundle(reportBundle);
  if (!parsed.success) throw aiGraderConfirmBoundaryError('AI_GRADER_CONFIRM_INVALID_MATHEMATICAL_REPORT_V1', parsed.message);
  const envelopeIssue = aiGraderMathematicalReleaseEnvelopeIssue(parsed.bundle, productionRelease);
  if (envelopeIssue) throw aiGraderConfirmBoundaryError('AI_GRADER_CONFIRM_MATHEMATICAL_RELEASE_MISMATCH', envelopeIssue);
  assertExplicitOperatorFinalization(productionRelease);
  const failedGate = firstFailedConfirmGate(reportBundle, productionRelease);
  if (failedGate) throw aiGraderConfirmBoundaryError('AI_GRADER_CONFIRM_GATE_FAILED', 'Confirm Card failed gate ' + failedGate.id + ': ' + failedGate.reason);
  const evidenceIssue = aiGraderMathematicalNormalizedEvidenceIssue(parsed.bundle);
  if (evidenceIssue) throw aiGraderConfirmBoundaryError('AI_GRADER_CONFIRM_NORMALIZED_EVIDENCE_REQUIRED', evidenceIssue);
}

export function assertAiGraderConfirmCardReady(input: {
  publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
}) {
  if (input.publicationStatus !== "finalized") {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_FINALIZED_STATUS_REQUIRED",
      "Confirm Card requires finalized, unpublished report semantics.",
    );
  }
  if (input.reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    assertAiGraderMathematicalConfirmReady(input.reportBundle, input.productionRelease);
    return;
  }
  const producer = isRecord(input.reportBundle.reportProducer) ? input.reportBundle.reportProducer : {};
  const capabilities = Array.isArray(producer.capabilities) ? producer.capabilities : [];
  if (
    input.reportBundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V01_VERSION ||
    producer.contractVersion !== AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION ||
    AI_GRADER_CONFIRM_REQUIRED_PRODUCER_CAPABILITIES.some((capability) => !capabilities.includes(capability))
  ) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_CURRENT_PRODUCER_REQUIRED",
      "Confirm Card requires a current report-producer v0.2 package with complete validation provenance.",
    );
  }
  assertAuthoritativeConfirmReleaseIdentity(input.reportBundle, input.productionRelease);
  assertExplicitOperatorFinalization(input.productionRelease);
  const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
  const overall = typeof finalGrade.overall === "number" ? finalGrade.overall : Number.NaN;
  if (
    input.productionRelease.finalGradeComputed !== true ||
    input.productionRelease.reportStatus !== "final_ai_grader_report_v0" ||
    input.productionRelease.finalStatus !== "final_grade_computed" ||
    finalGrade.status !== "final_ai_grader_grade_v0" ||
    finalGrade.finalGradeComputed !== true ||
    !Number.isFinite(overall) ||
    overall < 1 ||
    overall > 10
  ) {
    const failedGate = firstFailedConfirmGate(input.reportBundle, input.productionRelease);
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_FINAL_GRADE_REQUIRED",
      failedGate
        ? "Confirm Card requires an actual final grade. Failed gate " + failedGate.id + ": " + failedGate.reason
        : "Confirm Card requires an actual final grade from the authoritative production release.",
    );
  }
  const failedGate = firstFailedConfirmGate(input.reportBundle, input.productionRelease);
  if (failedGate) {
    throw aiGraderConfirmBoundaryError(
      "AI_GRADER_CONFIRM_GATE_FAILED",
      "Confirm Card failed gate " + failedGate.id + ": " + failedGate.reason,
    );
  }
  assertConfirmNormalizedEvidence(input.reportBundle);
}

function reportBundleRequiresPlannedImageDimensions(reportBundle: AiGraderProductionReportBundleLike) {
  if (reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V02_VERSION ||
      reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V03_VERSION) return true;
  const visionLab = isRecord(reportBundle.visionLab) ? reportBundle.visionLab : undefined;
  return Boolean(visionLab && isRecord(visionLab.findingValidation));
}

function assertStorageReadyPlan(
  plan: AiGraderProductionStoragePlan,
  publicationStatus: string,
  requirePlannedImageDimensions: boolean,
) {
  const reportImageAssets = plan.artifacts.filter((artifact) => artifact.artifactClass === "report_asset");
  if (
    plan.artifacts.some(
      (artifact) =>
        !Number.isSafeInteger(artifact.byteSize) ||
        artifact.byteSize < 1 ||
        artifact.byteSize > AI_GRADER_STORAGE_MAX_OBJECT_BYTES,
    )
  ) {
    const error = new Error(
      `AI Grader upload artifacts must be between 1 and ${AI_GRADER_STORAGE_MAX_OBJECT_BYTES} bytes.`,
    );
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_STORAGE_OBJECT_SIZE_LIMIT";
    throw error;
  }
  if (publicationStatus === "published" && reportImageAssets.length < 1) {
    const error = new Error("AI Grader publish requires storage-ready report image asset metadata with checksum and byte size.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_REPORT_IMAGES_REQUIRED";
    throw error;
  }
  if (
    requirePlannedImageDimensions &&
    reportImageAssets.some(
      (artifact) =>
        !Number.isSafeInteger(artifact.sourceImageWidthPx) ||
        (artifact.sourceImageWidthPx ?? 0) < 1 ||
        !Number.isSafeInteger(artifact.sourceImageHeightPx) ||
        (artifact.sourceImageHeightPx ?? 0) < 1,
    )
  ) {
    const error = new Error("AI Grader report image upload plans require source pixel dimensions.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_REPORT_IMAGE_DIMENSIONS_REQUIRED";
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
    if (
      artifact.artifactClass === "report_asset" &&
      (uploaded.sourceImageWidthPx !== artifact.sourceImageWidthPx ||
        uploaded.sourceImageHeightPx !== artifact.sourceImageHeightPx)
    ) {
      throw new Error(`Upload manifest source image dimensions mismatch for ${artifact.kind}.`);
    }
  }
}

function normalizedContentType(value: string | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function storageContentTypeMatches(actual: string | undefined, expected: string | undefined) {
  if (!actual || !expected) return false;
  return normalizedContentType(actual) === normalizedContentType(expected);
}

type VerifiedStorageArtifact = {
  ok: boolean;
  byteSize?: number;
  contentType?: string;
  checksumSha256?: string | null;
  widthPx?: number;
  heightPx?: number;
};

export function assertAiGraderStorageArtifactIntegrity(input: {
  verified: VerifiedStorageArtifact;
  expectedByteSize: number;
  expectedContentType: string | undefined;
  expectedChecksumSha256: string;
  label: string;
}) {
  if (!Number.isSafeInteger(input.verified.byteSize) || input.verified.byteSize !== input.expectedByteSize) {
    throw new Error("Storage byte size mismatch for " + input.label + ".");
  }
  const checksum = typeof input.verified.checksumSha256 === "string"
    ? input.verified.checksumSha256.toLowerCase()
    : "";
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    const error = new Error("Storage did not return a verified SHA-256 checksum for " + input.label + ". Finalize stopped.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 502;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_STORAGE_CHECKSUM_UNAVAILABLE";
    throw error;
  }
  if (checksum !== input.expectedChecksumSha256.toLowerCase()) {
    throw new Error("Storage-provided SHA-256 checksum mismatch for " + input.label + ".");
  }
  if (!storageContentTypeMatches(input.verified.contentType, input.expectedContentType)) {
    throw new Error("Storage content type mismatch for " + input.label + ".");
  }
  if (!input.verified.ok) throw new Error("Storage verification failed for " + input.label + ".");
}

async function verifyUploadedArtifacts(
  deps: AiGraderProductionApiDependencies,
  manifest: AiGraderProductionUploadManifest
) {
  if (!deps.verifyUploadedArtifact) throw new Error("AI Grader storage verification is not configured.");
  for (const artifact of manifest.artifacts) {
    const verified = await deps.verifyUploadedArtifact(artifact);
    assertAiGraderStorageArtifactIntegrity({
      verified,
      expectedByteSize: artifact.byteSize,
      expectedContentType: artifact.contentType,
      expectedChecksumSha256: artifact.checksumSha256,
      label: "publish artifact",
    });
    if (
      artifact.sourceImageWidthPx !== undefined ||
      artifact.sourceImageHeightPx !== undefined
    ) {
      if (
        verified.widthPx !== artifact.sourceImageWidthPx ||
        verified.heightPx !== artifact.sourceImageHeightPx
      ) {
        throw new Error("Storage-decoded source image dimensions mismatch for publish artifact.");
      }
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
  const queueItemId = parseOcrExactIdentityValue(source.queueItemId, "queueItemId");
  const identity = parseConfirmedCardIdentity(source.identity ?? parsed.reportBundle.cardIdentity);
  return {
    ...parsed,
    queueItemId,
    identity,
  };
}

function assertNoOcrUploadBodyFields(entry: JsonRecord, path: string) {
  for (const key of ["base64", "body", "bodyBase64", "dataUrl", "localPath", "publicUrl", "url", "uploadUrl"]) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      const error = new Error(`OCR prefill image bytes and URLs are not accepted at ${path}.${key}; use direct storage upload metadata.`);
      (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
      (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_OCR_DIRECT_UPLOAD_REQUIRED";
      throw error;
    }
  }
}

type AiGraderOcrExactIdentity = {
  queueItemId: string;
  gradingSessionId: string;
  reportId: string;
};

function parseOcrExactIdentityValue(value: unknown, name: keyof AiGraderOcrExactIdentity) {
  const normalized = stringValue(value, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(normalized)) {
    throw new Error(`${name} is required and must be an exact safe identifier.`);
  }
  return normalized;
}

function ocrIdentityMismatch(message: string): never {
  const error = new Error(message);
  (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
  (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_OCR_IDENTITY_MISMATCH";
  throw error;
}

function parseOcrPrefillImageMetadata(
  value: unknown,
  index: number,
  allowStorageKey: boolean,
  identity: AiGraderOcrExactIdentity,
): AiGraderOcrPrefillImageUpload {
  if (!isRecord(value)) throw new Error(`images[${index}] must be an object.`);
  assertNoOcrUploadBodyFields(value, `images[${index}]`);
  const queueItemId = parseOcrExactIdentityValue(value.queueItemId, "queueItemId");
  const gradingSessionId = parseOcrExactIdentityValue(value.gradingSessionId, "gradingSessionId");
  const reportId = parseOcrExactIdentityValue(value.reportId, "reportId");
  if (
    queueItemId !== identity.queueItemId ||
    gradingSessionId !== identity.gradingSessionId ||
    reportId !== identity.reportId
  ) {
    ocrIdentityMismatch(`images[${index}] does not match the exact OCR queue/session/report identity.`);
  }
  const side = stringValue(value.side, "") as AiGraderOcrPrefillSide;
  const artifactRole = stringValue(value.artifactRole, "");
  const fileName = stringValue(value.fileName, "");
  const mimeType = stringValue(value.mimeType, "").toLowerCase();
  const checksumSha256 = stringValue(value.checksumSha256, "").toLowerCase();
  const byteSize = Math.round(numericValue(value.byteSize, 0));
  const widthPx = Math.round(numericValue(value.widthPx, 0));
  const heightPx = Math.round(numericValue(value.heightPx, 0));
  const storageKey = allowStorageKey ? stringValue(value.storageKey, "") : "";
  if (side !== "front" && side !== "back") throw new Error(`images[${index}].side must be front or back.`);
  if (artifactRole !== "normalized_card") throw new Error(`images[${index}].artifactRole must be normalized_card.`);
  if (fileName !== `${side}-normalized-card.png`) {
    throw new Error(`images[${index}].fileName must be the exact safe PNG file name ${side}-normalized-card.png.`);
  }
  if (mimeType !== "image/png") throw new Error(`images[${index}].mimeType must be image/png.`);
  if (widthPx !== 1200 || heightPx !== 1680) {
    throw new Error(`images[${index}] must be exactly 1200x1680.`);
  }
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) {
    throw new Error(`images[${index}].checksumSha256 must be a SHA-256 hex digest.`);
  }
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > AI_GRADER_STORAGE_MAX_OBJECT_BYTES) {
    throw new Error(`images[${index}].byteSize must be between 1 and ${AI_GRADER_STORAGE_MAX_OBJECT_BYTES}.`);
  }
  if (allowStorageKey && !storageKey) throw new Error(`images[${index}].storageKey is required.`);
  return {
    queueItemId,
    gradingSessionId,
    reportId,
    side,
    artifactRole: "normalized_card",
    fileName,
    mimeType,
    checksumSha256,
    byteSize,
    widthPx: 1200,
    heightPx: 1680,
    storageKey,
  };
}

function buildOcrPrefillStorageKey(image: Omit<AiGraderOcrPrefillImageUpload, "storageKey">) {
  const exactIdentityDigest = aiGraderSha256(stableStringify({
    queueItemId: image.queueItemId,
    gradingSessionId: image.gradingSessionId,
    reportId: image.reportId,
  })).slice(0, 24);
  return `ai-grader/reports/${safeStorageSegment(image.reportId)}/ocr-prefill/${safeStorageSegment(image.queueItemId)}-${exactIdentityDigest}/${safeStorageSegment(image.gradingSessionId)}/${image.side}-normalized-${image.checksumSha256.slice(0, 16)}-${image.fileName}`;
}

function normalizeOcrPrefillImages(images: AiGraderOcrPrefillImageUpload[]) {
  const sides = new Set(images.map((image) => image.side));
  if (images.length !== 2 || sides.size !== 2 || !sides.has("front") || !sides.has("back")) {
    throw new Error("OCR prefill requires exactly one normalized front image and one normalized back image.");
  }
  return [...images]
    .map((image) => ({
      ...image,
      storageKey: buildOcrPrefillStorageKey(image),
    }))
    .sort((left, right) => (left.side === right.side ? 0 : left.side === "front" ? -1 : 1));
}

function ocrPrefillUploadSessionId(identity: AiGraderOcrExactIdentity, images: AiGraderOcrPrefillImageUpload[]) {
  return `aigocr_${aiGraderSha256(
    stableStringify({
      ...identity,
      reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
      images: images.map(({ side, artifactRole, storageKey, checksumSha256, byteSize, mimeType, widthPx, heightPx }) => ({
        side,
        artifactRole,
        storageKey,
        checksumSha256,
        byteSize,
        mimeType,
        widthPx,
        heightPx,
      })),
    })
  ).slice(0, 32)}`;
}

function parseOcrPrefillBody(body: unknown, finalize: boolean) {
  assertSmallJsonPayload(body, AI_GRADER_PRODUCTION_SAFE_BODY_LIMIT_BYTES, "AI Grader OCR prefill request");
  assertNoUnsafePublishPayload(body);
  if (!isRecord(body)) throw new Error("JSON object body is required.");
  const identity: AiGraderOcrExactIdentity = {
    queueItemId: parseOcrExactIdentityValue(body.queueItemId, "queueItemId"),
    gradingSessionId: parseOcrExactIdentityValue(body.gradingSessionId, "gradingSessionId"),
    reportId: parseOcrExactIdentityValue(body.reportId, "reportId"),
  };
  const reportProducerContractVersion = stringValue(body.reportProducerContractVersion, "");
  if (reportProducerContractVersion !== AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION) {
    throw new Error("OCR Prefill accepts only current report-producer v0.2 packages.");
  }
  const rawImages = Array.isArray(body.images) ? body.images : [];
  const parsedImages = rawImages.map((image, index) => parseOcrPrefillImageMetadata(image, index, finalize, identity));
  const expectedImages = normalizeOcrPrefillImages(parsedImages);
  if (finalize) {
    for (const [index, image] of parsedImages
      .sort((left, right) => (left.side === right.side ? 0 : left.side === "front" ? -1 : 1))
      .entries()) {
      if (image.storageKey !== expectedImages[index]?.storageKey) {
        const error = new Error(`images[${index}].storageKey does not match the OCR prefill upload plan.`);
        (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
        (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_OCR_UPLOAD_PLAN_MISMATCH";
        throw error;
      }
    }
  }
  const uploadSessionId = ocrPrefillUploadSessionId(identity, expectedImages);
  if (finalize && stringValue(body.uploadSessionId, "") !== uploadSessionId) {
    const error = new Error("OCR prefill finalize does not match the upload plan from OCR prefill init.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 409;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_OCR_UPLOAD_SESSION_MISMATCH";
    throw error;
  }
  return {
    ...identity,
    reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
    images: expectedImages,
    uploadSessionId,
  };
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((entry) => Number(entry));
  if (parts.length !== 4 || parts.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function safeOcrSourceUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OCR storage URL is invalid.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const unsafeIpv6 = hostname === "::1" || hostname === "[::1]" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe8") || hostname.startsWith("fe9") || hostname.startsWith("fea") || hostname.startsWith("feb");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    hostname === "localhost" ||
    unsafeIpv6 ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost") ||
    isPrivateIpv4(hostname)
  ) {
    const error = new Error("OCR storage URL must be a public HTTPS object URL without credentials or query parameters.");
    (error as Error & { statusCode?: number; code?: string }).statusCode = 400;
    (error as Error & { statusCode?: number; code?: string }).code = "AI_GRADER_OCR_UNSAFE_SOURCE_URL";
    throw error;
  }
  return parsed.toString();
}

function assertOcrPrefillResultSafe(value: unknown, path = "result") {
  if (typeof value === "string") {
    if (/https?:\/\//i.test(value) || /^data:/i.test(value) || /^[a-z]:\\/i.test(value) || /x-amz-/i.test(value)) {
      throw new Error(`Unsafe URL, local path, or signed-upload data rejected from OCR prefill output at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertOcrPrefillResultSafe(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (/url|path|token|secret|base64|body/i.test(key)) {
      throw new Error(`Unsafe OCR prefill output field rejected at ${path}.${key}.`);
    }
    assertOcrPrefillResultSafe(entry, `${path}.${key}`);
  }
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
  const widthPx = numericValue(body.widthPx, 0);
  const heightPx = numericValue(body.heightPx, 0);
  if (!reportId) throw new Error("reportId is required.");
  if (side !== "front" && side !== "back") throw new Error("side must be front or back.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType.split(";", 1)[0].trim().toLowerCase())) {
    throw new Error("Slabbed photos must use PNG, JPEG, or WebP raster images.");
  }
  if (!/^[a-f0-9]{64}$/i.test(checksumSha256)) throw new Error("checksumSha256 must be a SHA-256 hex digest.");
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > AI_GRADER_STORAGE_MAX_OBJECT_BYTES) {
    throw new Error(`byteSize must be between 1 and ${AI_GRADER_STORAGE_MAX_OBJECT_BYTES}.`);
  }
  if (!Number.isSafeInteger(widthPx) || widthPx < 1 || widthPx > 100_000) throw new Error("widthPx must be a safe positive image dimension.");
  if (!Number.isSafeInteger(heightPx) || heightPx < 1 || heightPx > 100_000) throw new Error("heightPx must be a safe positive image dimension.");
  return {
    reportId,
    side,
    fileName,
    mimeType,
    checksumSha256: checksumSha256.toLowerCase(),
    byteSize: Math.round(byteSize),
    widthPx,
    heightPx,
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

const AI_GRADER_FINISH_NFC_STATUSES = new Set<AiGraderFinishNfcStatus>([
  "missing",
  "reserved",
  "programming",
  "verified",
  "active",
  "revoked",
  "unavailable",
  "error",
]);

function finishNfcProjection(value: unknown) {
  const nfc = isRecord(value) ? value : {};
  const rawStatus = optionalString(nfc.status)?.toLowerCase();
  const status = rawStatus && AI_GRADER_FINISH_NFC_STATUSES.has(rawStatus as AiGraderFinishNfcStatus)
    ? rawStatus as AiGraderFinishNfcStatus
    : "missing";
  const publicTagId = optionalString(nfc.publicTagId);
  const safePublicTagId = publicTagId && /^[A-Za-z0-9_-]{32}$/.test(publicTagId) ? publicTagId : null;
  const expectedTagUrl = safePublicTagId ? `https://collect.tenkings.co/nfc/${safePublicTagId}` : null;
  const nfcTagUrl = optionalString(nfc.nfcTagUrl) === expectedTagUrl ? expectedTagUrl : null;
  const chipType = optionalString(nfc.chipType);
  const rawSecurityMode = optionalString(nfc.securityMode);
  const securityMode = rawSecurityMode === "STATIC_URL_V1"
    ? "static_url_v1"
    : rawSecurityMode === "NTAG424_SUN_V1"
      ? "ntag424_sun_v1"
      : rawSecurityMode;
  return {
    status,
    publicTagId: safePublicTagId,
    nfcTagUrl,
    chipType: chipType === "NTAG215" || chipType === "FEIJU_F8215" || chipType === "NTAG424_DNA" ? chipType : null,
    securityMode: securityMode === "static_url_v1" || securityMode === "ntag424_sun_v1" ? securityMode : null,
  };
}

export function buildAiGraderFinishCardsQueueResult(rows: unknown[], options: AiGraderFinishCardsQueueBuildOptions = {}): AiGraderFinishCardsQueueResult {
  const allItems = rows
    .filter(isRecord)
    .filter((row) => {
      const reportId = optionalString(row.reportId);
      const session = firstRecord(row.session);
      const sessionStatus = optionalString(session?.status);
      return Boolean(reportId) && optionalString(session?.reportId) === reportId &&
        optionalString(row.publicationStatus) === "published" &&
        (sessionStatus === "published" || sessionStatus === "inventory_ready");
    })
    .map((row): AiGraderFinishCardsQueueItem => {
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
    const nfcRequired = options.nfcRequired === true;
    const nfc = finishNfcProjection(row.nfc);
    const nfcReady = nfc.status === "active";
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
    if (nfcRequired && !nfcReady && !inventoryComplete) needs.push("Program NFC");
    if (slabComplete && valuationComplete && !inventoryComplete) needs.push("Add To Inventory");

    return {
      reportId: stringValue(row.reportId, "unknown-report"),
      certId: optionalString(label?.certId),
      cardTitle: queueCardTitle(row),
      grade: numberOrNull(row.finalOverallGrade),
      cardAssetId: optionalString(row.cardAssetId),
      itemId: optionalString(row.itemId),
      publicReportUrl: safeAiGraderDownstreamUrl(row.publicReportUrl),
      labelPreviewUrl: safeAiGraderDownstreamUrl(buildAiGraderLabelPreviewUrl(stringValue(row.reportId, "unknown-report"))),
      qrPayloadUrl: safeAiGraderDownstreamUrl(row.qrPayloadUrl) ?? safeAiGraderDownstreamUrl(label?.qrPayloadUrl),
      nfcRequired,
      nfcStatus: nfc.status,
      nfcTagUrl: nfc.nfcTagUrl,
      publicTagId: nfc.publicTagId,
      chipType: nfc.chipType,
      securityMode: nfc.securityMode,
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
        canAddToInventory: labelPrinted && slabComplete && valuationComplete && (!nfcRequired || nfcReady) && !inventoryComplete,
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
    nfcRequired: options.nfcRequired === true,
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
        nfcRequired: aiGraderNfcRequired(env),
        actions: [
          "auth-check",
          "publish-init",
          "publish-finalize",
          "ocr-prefill-init",
          "ocr-prefill-finalize",
          "create-card-from-report",
          "history",
          "finish-queue",
          "label-sheets",
          "render-label-sheet-pdf",
          "render-label-sheet-cut-svg",
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
      "ocr-prefill-init",
      "ocr-prefill-finalize",
      "create-card-from-report",
      "history",
      "finish-queue",
      "label-sheets",
      "render-label-sheet-pdf",
      "render-label-sheet-cut-svg",
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
    if (key !== "run-comps" && key !== "auth-check" && !isEnabled(env, AI_GRADER_PRODUCTION_PUBLISH_ENABLED_ENV)) {
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
        key === "ocr-prefill-init" ||
        key === "ocr-prefill-finalize" ||
        key === "create-card-from-report" ||
        key === "render-label-sheet-pdf" ||
        key === "render-label-sheet-cut-svg" ||
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
        let nfcSchemaReady = false;
        try {
          nfcSchemaReady = deps.nfcSchemaReadiness ? await deps.nfcSchemaReadiness() : false;
        } catch {
          // Authenticated readiness stays redacted. NFC mutations use their
          // stricter schema check and distinguish absent from failed probes.
        }
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
            readiness: aiGraderProductionReadiness(env, nfcSchemaReady),
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
          : buildAiGraderFinishCardsQueueResult([], { nfcRequired: aiGraderNfcRequired(env) });
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderFinishCardsQueue", result });
      }
      if (key === "label-sheets") {
        if (!deps.listLabelSheets) throw new Error("AI Grader label sheet listing is not configured.");
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const result = await deps.listLabelSheets({ tenantId });
        return res.status(200).json({ ok: true, enabled: true, operation: "aiGraderLabelSheets", result });
      }
      if (key === "render-label-sheet-pdf" || key === "render-label-sheet-cut-svg") {
        const input = parseLabelSheetMutationBody(req.body);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const common = {
          tenantId,
          sheetId: input.sheetId,
          expectedRevision: input.expectedRevision,
          operatorUserId: actorOperatorUserId(authorizedActor),
        };
        const result =
          key === "render-label-sheet-pdf"
            ? await deps.renderLabelSheetPdf?.(common)
            : await deps.renderLabelSheetCutSvg?.(common);
        if (!result) throw new Error("AI Grader Label V1 rendering is not configured.");
        res.setHeader("Content-Type", result.contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.setHeader("X-Ten-Kings-Label-Revision", result.revision);
        return res.status(200).send(result.body);
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
      if (key === "ocr-prefill-init") {
        if (!deps.presignUpload) throw new Error("AI Grader OCR prefill direct upload planning is not configured.");
        const input = parseOcrPrefillBody(req.body, false);
        const uploadPlan: AiGraderOcrPrefillUploadInitResult["uploadPlan"] = [];
        for (const image of input.images) {
          const presigned = await deps.presignUpload({
            storageKey: image.storageKey,
            contentType: image.mimeType,
            checksumSha256: image.checksumSha256,
          });
          const publicUrl = safeOcrSourceUrl(deps.publicUrlFor(image.storageKey));
          uploadPlan.push({
            ...image,
            publicUrl,
            uploadUrl: presigned.uploadUrl,
            uploadMethod: presigned.uploadMethod,
            uploadHeaders: sanitizeAiGraderUploadHeadersForResponse(presigned.uploadHeaders, image.checksumSha256),
          });
        }
        const result: AiGraderOcrPrefillUploadInitResult = {
          queueItemId: input.queueItemId,
          gradingSessionId: input.gradingSessionId,
          reportId: input.reportId,
          reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
          uploadSessionId: input.uploadSessionId,
          humanConfirmationRequired: true,
          uploadPlan,
          requiredFinalizeManifest: {
            queueItemId: input.queueItemId,
            gradingSessionId: input.gradingSessionId,
            reportId: input.reportId,
            reportProducerContractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
            uploadSessionId: input.uploadSessionId,
            images: input.images,
          },
        };
        assertSmallJsonPayload(result, AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES, "AI Grader OCR prefill init response");
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderOcrPrefillInit",
          result,
        });
      }
      if (key === "ocr-prefill-finalize") {
        if (!deps.verifyUploadedArtifact) throw new Error("AI Grader OCR prefill upload verification is not configured.");
        if (!deps.runOcrPrefill) throw new Error("AI Grader OCR prefill runtime is not configured.");
        const input = parseOcrPrefillBody(req.body, true);
        for (const image of input.images) {
          const verified = await deps.verifyUploadedArtifact({
            artifactId: `ocr-prefill:${input.queueItemId}:${input.gradingSessionId}:${input.reportId}:${image.side}`,
            storageKey: image.storageKey,
            checksumSha256: image.checksumSha256,
            byteSize: image.byteSize,
            contentType: image.mimeType,
            sourceImageWidthPx: image.widthPx,
            sourceImageHeightPx: image.heightPx,
          });
          assertAiGraderStorageArtifactIntegrity({
            verified,
            expectedByteSize: image.byteSize,
            expectedContentType: image.mimeType,
            expectedChecksumSha256: image.checksumSha256,
            label: "normalized " + image.side + " OCR image",
          });
          if (verified.widthPx !== image.widthPx || verified.heightPx !== image.heightPx) {
            throw new Error("Storage-decoded normalized OCR image dimensions mismatch.");
          }
        }
        let runtimeResult: AiGraderOcrPrefillResult & {
          internalProviderDiagnostics?: AiGraderOcrProviderDiagnostics;
        };
        try {
          runtimeResult = await deps.runOcrPrefill({
            queueItemId: input.queueItemId,
            gradingSessionId: input.gradingSessionId,
            reportId: input.reportId,
            images: input.images.map((image) => ({
              side: image.side,
              url: safeOcrSourceUrl(deps.publicUrlFor(image.storageKey)),
            })),
          });
        } catch (error) {
          if (isRecord(error) && isAiGraderOcrFailureCode(error.code)) throw error;
          throw new AiGraderOcrFailure("AI_GRADER_OCR_INTERNAL_FAILED");
        }
        if (
          runtimeResult.queueItemId !== input.queueItemId ||
          runtimeResult.gradingSessionId !== input.gradingSessionId ||
          runtimeResult.reportId !== input.reportId
        ) {
          ocrIdentityMismatch("OCR provider result does not match the exact queue/session/report identity.");
        }
        if (runtimeResult.internalProviderDiagnostics && deps.recordOcrProviderDiagnostics) {
          try {
            deps.recordOcrProviderDiagnostics(runtimeResult.internalProviderDiagnostics);
          } catch {
            // Diagnostics recording must never alter the OCR result.
          }
        }
        const safeResult: AiGraderOcrPrefillResult = {
          queueItemId: input.queueItemId,
          gradingSessionId: input.gradingSessionId,
          reportId: input.reportId,
          status: runtimeResult.status,
          humanConfirmationRequired: true,
          inventoryMutationPerformed: false,
          publishMutationPerformed: false,
          sourceSides: runtimeResult.sourceSides,
          fields: runtimeResult.fields,
          reviewFieldNames: runtimeResult.reviewFieldNames,
          provenance: runtimeResult.provenance,
          warnings: runtimeResult.warnings,
        };
        assertOcrPrefillResultSafe(safeResult);
        assertSmallJsonPayload(safeResult, AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES, "AI Grader OCR prefill result");
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderOcrPrefillFinalize",
          result: safeResult,
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
          uploadHeaders: sanitizeAiGraderUploadHeadersForResponse(presigned.uploadHeaders, input.checksumSha256),
          requiredFinalizeManifest: {
            reportId: input.reportId,
            side: input.side,
            storageKey,
            publicUrl: presigned.publicUrl,
            checksumSha256: input.checksumSha256,
            byteSize: input.byteSize,
            mimeType: input.mimeType,
            widthPx: input.widthPx,
            heightPx: input.heightPx,
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
        if (!deps.verifyUploadedArtifact) throw new Error("AI Grader slabbed photo upload verification is not configured.");
        const input = parseSlabbedPhotoFinalizeBody(req.body);
        {
          const verified = await deps.verifyUploadedArtifact({
            artifactId: `slabbed-photo:${input.reportId}:${input.side}`,
            storageKey: input.storageKey,
            publicUrl: input.publicUrl,
            checksumSha256: input.checksumSha256,
            byteSize: input.byteSize,
            contentType: input.mimeType,
            sourceImageWidthPx: input.widthPx,
            sourceImageHeightPx: input.heightPx,
          });
          assertAiGraderStorageArtifactIntegrity({
            verified,
            expectedByteSize: input.byteSize,
            expectedContentType: input.mimeType,
            expectedChecksumSha256: input.checksumSha256,
            label: "slabbed " + input.side + " photo",
          });
          if (verified.widthPx !== input.widthPx || verified.heightPx !== input.heightPx) {
            throw new Error("Storage-decoded slabbed photo dimensions mismatch.");
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
          widthPx: input.widthPx,
          heightPx: input.heightPx,
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
        if (!isEnabled(env, AI_GRADER_EBAY_COMPS_ENABLED_ENV)) {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "ready",
              liveExecutionEnabled: false,
              compsRefs: [],
              persisted: false,
              message: `Live eBay comps are ready but disabled. Set ${AI_GRADER_EBAY_COMPS_ENABLED_ENV}=true with SERPAPI_KEY and operator approval to execute.`,
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!String(env.SERPAPI_KEY ?? "").trim()) {
          return res.status(200).json({
            ok: true,
            enabled: true,
            operation: "aiGraderEbayComps",
            result: {
              status: "failed",
              liveExecutionEnabled: false,
              compsRefs: [],
              persisted: false,
              retryable: true,
              errorCode: "AI_GRADER_SERPAPI_NOT_CONFIGURED",
              message: "eBay sold comps are enabled but SerpApi is not configured. Retry after configuration is restored.",
            } satisfies AiGraderCompsRunResult,
          });
        }
        if (!deps.runComps) throw new Error("AI Grader eBay comps runner is not configured.");
        if (!deps.persistComps) throw new Error("AI Grader eBay comps persistence is not configured.");
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const requestedByUserId = actorOperatorUserId(authorizedActor);
        const startedAt = new Date().toISOString();
        const attemptId = `aigc_${aiGraderSha256(`${input.reportId}:${startedAt}:${Math.random()}`).slice(0, 24)}`;
        const claim = await deps.persistComps({
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
        const confirmedSearchQuery = optionalString(claim.valuation?.searchQuery);
        if (!confirmedSearchQuery) {
          throw new Error("Confirmed card identity did not provide a persisted comps search query.");
        }
        try {
          const comps = await deps.runComps({
            reportId: input.reportId,
            searchQuery: confirmedSearchQuery,
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
            searchQuery: confirmedSearchQuery,
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
              searchQuery: confirmedSearchQuery,
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
            searchQuery: confirmedSearchQuery,
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
        assertAiGraderConfirmCardReady(input);
        assertAiGraderPublishBundleBoundary(input.reportBundle, input.productionRelease);
        const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
        const plan = buildAiGraderConfirmCardReferencePlan({
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
          publicReportBaseUrl: "https://collect.tenkings.co",
          publicUrlFor: deps.publicUrlFor,
        });
        const result = await deps.createCardFromReport({
          queueItemId: input.queueItemId,
          tenantId,
          reportBundle: input.reportBundle,
          productionRelease: input.productionRelease,
          storagePlan: plan,
          identity: input.identity,
          operatorUserId: actorOperatorUserId(authorizedActor),
          actorAudit: authorizedActor.audit,
        });
        if (result.queueItemId !== input.queueItemId ||
            result.gradingSessionId !== input.reportBundle.gradingSessionId ||
            result.reportId !== input.productionRelease.reportId) {
          throw aiGraderPublishBoundaryError(
            "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
            "Card linkage returned a different queue, grading-session, or report identity.",
          );
        }
        assertSmallJsonPayload(result, AI_GRADER_PRODUCTION_VERCEL_PAYLOAD_LIMIT_BYTES, "AI Grader create-card-from-report response");
        return res.status(200).json({
          ok: true,
          enabled: true,
          operation: "aiGraderCreateCardFromReport",
          result,
        });
      }
      const requestedInput = parseConfirmedPublishSmallBody(req.body);
      assertPublishedReleaseReady(requestedInput);
      const tenantId = env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
      if (!deps.resolvePublishAuthority) {
        throw aiGraderPublishBoundaryError(
          "AI_GRADER_PUBLISH_AUTHORITY_UNAVAILABLE",
          "Durable Confirm authority is unavailable; Publish stopped before storage or database changes.",
        );
      }
      const authority = await deps.resolvePublishAuthority({
        tenantId,
        queueItemId: requestedInput.queueItemId,
        reportId: requestedInput.reportId,
        gradingSessionId: requestedInput.gradingSessionId,
        cardAssetId: requestedInput.cardAssetId,
        itemId: requestedInput.itemId,
      });
      assertResolvedPublishAuthority({
        authority,
        tenantId,
        queueItemId: requestedInput.queueItemId,
        reportId: requestedInput.reportId,
        gradingSessionId: requestedInput.gradingSessionId,
        cardAssetId: requestedInput.cardAssetId,
        itemId: requestedInput.itemId,
        productionRelease: requestedInput.productionRelease,
      });
      assertAiGraderPublishPackageMatchesAuthority({
        reportBundle: requestedInput.reportBundle,
        productionRelease: requestedInput.productionRelease,
        publishAuthority: authority.publishAuthority,
      });
      const canonical = applyAiGraderConfirmedPublishAuthority({
        reportBundle: requestedInput.reportBundle,
        productionRelease: requestedInput.productionRelease,
        authority,
      });
      const input = {
        ...requestedInput,
        ...canonical,
      };
      const plan = buildAiGraderProductionStoragePlan({
        reportBundle: input.reportBundle,
        productionRelease: input.productionRelease,
        publicReportBaseUrl: "https://collect.tenkings.co",
        publicUrlFor: deps.publicUrlFor,
      });
      assertStorageReadyPlan(
        plan,
        input.publicationStatus,
        reportBundleRequiresPlannedImageDimensions(input.reportBundle),
      );
      const publishSessionId = publishSessionIdForPlan({
        queueItemId: input.queueItemId,
        gradingSessionId: input.gradingSessionId,
        reportId: input.reportId,
      }, plan);

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
          queueItemId: input.queueItemId,
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
            queueItemId: input.queueItemId,
            gradingSessionId: input.gradingSessionId,
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
                sourceImageWidthPx: artifact.sourceImageWidthPx,
                sourceImageHeightPx: artifact.sourceImageHeightPx,
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
        queueItemId: input.queueItemId,
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
      if (result.queueItemId !== input.queueItemId ||
          result.gradingSessionId !== input.gradingSessionId ||
          result.reportId !== input.reportId) {
        throw aiGraderPublishBoundaryError(
          "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
          "Publish persistence returned a different queue, grading-session, or report identity.",
        );
      }
      return res.status(200).json({
        ok: true,
        enabled: true,
        operation: "aiGraderProductionPublishFinalize",
        result: {
          queueItemId: result.queueItemId,
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
          ...(result.labelSheetAssignment
            ? {
                labelSheetAssignment: {
                  sheetNumber: result.labelSheetAssignment.sheetNumber,
                  slot: result.labelSheetAssignment.slot,
                  capacity: result.labelSheetAssignment.capacity,
                  status: result.labelSheetAssignment.status,
                  existing: result.labelSheetAssignment.existing,
                },
              }
            : {}),
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
    if (!aiGraderPublicReportDbReadsEnabled(env)) {
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
    const publicBundle = sanitizeAiGraderPublicReportBundleForRead(bundle, {
      expectedReportId: reportId,
      publicUrlFor: deps.publicUrlFor,
    });
    if (!publicBundle) return res.status(500).json({ ok: false, message: "Published AI Grader report is invalid." });
    const nfcRegistration = deps.readNfcRegistration
      ? await deps.readNfcRegistration(reportId).catch(() => null)
      : null;
    const rawEnrichment = deps.readEnrichment
      ? await deps.readEnrichment(reportId).catch(() => null)
      : null;
    const enrichment = isRecord(rawEnrichment) ? rawEnrichment : null;
    return res.status(200).json({
      ok: true,
      reportId,
      bundle: publicBundle,
      readOnly: true,
      noHardwareControls: true,
      ...(nfcRegistration ? { nfcRegistration } : {}),
      ...(enrichment ? { enrichment } : {}),
    });
  };
}

export async function resolveAiGraderPublishAuthorityRuntime(
  input: AiGraderConfirmedPublishAuthorityInput & { dbClient?: any },
) {
  const { prisma } = await import("@tenkings/database");
  return resolveAiGraderConfirmedPublishAuthority(
    input.dbClient ?? (prisma as any),
    {
      tenantId: input.tenantId,
      queueItemId: input.queueItemId,
      gradingSessionId: input.gradingSessionId,
      reportId: input.reportId,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
    },
  );
}

export async function persistProductionReleaseRuntime(input: {
  queueItemId: string;
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderProductionStoragePlan;
  publicationStatus: "draft" | "finalized" | "published" | "unpublished" | "revoked" | "error";
  operatorUserId?: string | null;
  cardAssetId?: string | null;
  itemId?: string | null;
  actorAudit?: AiGraderProductionActorAudit | null;
  dbClient?: any;
  persistRelease?: typeof persistAiGraderProductionRelease;
  resolveAuthority?: typeof resolveAiGraderConfirmedPublishAuthority;
}): Promise<AiGraderProductionPublishPersistResult> {
  const { prisma } = await import("@tenkings/database");
  const { dbClient, persistRelease, resolveAuthority, ...persistInput } = input;
  const db = dbClient ?? (prisma as any);
  const queueItemId = optionalString(input.queueItemId);
  const reportId = optionalString(input.reportBundle.reportId);
  const releaseReportId = optionalString(input.productionRelease.reportId);
  const bundleSessionId = optionalString(input.reportBundle.gradingSessionId);
  const releaseSessionId = optionalString(input.productionRelease.gradingSessionId);
  const mathematicalV1 = input.reportBundle.schemaVersion === AI_GRADER_REPORT_BUNDLE_V03_VERSION;
  const gradingSessionId = mathematicalV1 ? releaseSessionId : bundleSessionId;
  const cardAssetId = optionalString(input.cardAssetId);
  const itemId = optionalString(input.itemId);
  const operatorUserId = optionalString(input.operatorUserId);
  const bundleIdentity = isRecord(input.reportBundle.cardIdentity) ? input.reportBundle.cardIdentity : {};
  const releaseLabel = isRecord(input.productionRelease.label) ? input.productionRelease.label : {};
  const labelIdentity = isRecord(releaseLabel.cardIdentity) ? releaseLabel.cardIdentity : {};
  const inventoryLinkage = isRecord(input.productionRelease.cardInventoryLinkage)
    ? input.productionRelease.cardInventoryLinkage
    : {};
  const embeddedCardIds = [
    optionalString(bundleIdentity.cardAssetId),
    optionalString(labelIdentity.cardAssetId),
    optionalString(inventoryLinkage.cardAssetId),
  ].filter((value): value is string => Boolean(value));
  const embeddedItemIds = [
    optionalString(bundleIdentity.itemId),
    optionalString(labelIdentity.itemId),
    optionalString(inventoryLinkage.itemId),
  ].filter((value): value is string => Boolean(value));
  if (
    !queueItemId ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(queueItemId) ||
    !reportId ||
    !releaseReportId ||
    reportId !== releaseReportId ||
    !gradingSessionId ||
    !releaseSessionId ||
    gradingSessionId !== releaseSessionId ||
    !cardAssetId ||
    !itemId ||
    embeddedCardIds.some((value) => value !== cardAssetId) ||
    embeddedItemIds.some((value) => value !== itemId)
  ) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
      "Verified Publish requires one exact queue, report, session, CardAsset, and Item linkage.",
    );
  }
  const authority = await (resolveAuthority ?? resolveAiGraderConfirmedPublishAuthority)(db, {
    tenantId: input.tenantId,
    queueItemId,
    reportId,
    gradingSessionId,
    cardAssetId,
    itemId,
  });
  assertResolvedPublishAuthority({
    authority,
    tenantId: input.tenantId,
    queueItemId,
    reportId,
    gradingSessionId,
    cardAssetId,
    itemId,
    productionRelease: input.productionRelease,
  });
  assertAiGraderPublishPackageMatchesAuthority({
    reportBundle: input.reportBundle,
    productionRelease: input.productionRelease,
    publishAuthority: authority.publishAuthority,
  });
  const canonical = applyAiGraderConfirmedPublishAuthority({
    reportBundle: input.reportBundle,
    productionRelease: input.productionRelease,
    authority,
  });
  const canonicalProductionRelease = applyAiGraderServerPublishedRuntimeState(
    canonical.productionRelease,
    input.storagePlan,
  );
  const canonicalReportBundle = mathematicalV1
    ? canonical.reportBundle
    : { ...canonical.reportBundle, productionRelease: canonicalProductionRelease };
  assertPublishedReleaseReady({
    publicationStatus: input.publicationStatus,
    reportId,
    gradingSessionId,
    cardAssetId,
    itemId,
    reportBundle: canonicalReportBundle,
    productionRelease: canonicalProductionRelease,
  });
  assertAiGraderConfirmedPublishIdentitySnapshot({
    reportBundle: canonicalReportBundle,
    productionRelease: canonicalProductionRelease,
    authority,
  });
  const persistAtomically = async (tx: any) => {
    const exactPersistInput = {
      ...persistInput,
      queueItemId,
      reportBundle: canonicalReportBundle,
      productionRelease: canonicalProductionRelease,
      cardAssetId,
      itemId,
    };
    const persisted = await (persistRelease
      ? persistRelease(tx, exactPersistInput)
      : persistAiGraderProductionRelease(tx, exactPersistInput, {
          readDesignReferenceArtifactBytes: readStorageBuffer,
        }));
    if (persisted.queueItemId !== queueItemId ||
        persisted.gradingSessionId !== gradingSessionId ||
        persisted.reportId !== reportId) {
      throw aiGraderPublishBoundaryError(
        "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
        "Atomic persistence returned a different queue, grading-session, or report identity.",
      );
    }
    if (persisted.publicationStatus !== "published") return persisted;
    const labelSheetAssignment = await completePublishedAiGraderCardTx({
      tx,
      tenantId: input.tenantId,
      gradingSessionId,
      reportId,
      productionRelease: canonicalProductionRelease,
      cardAssetId,
      itemId,
      publishAuthority: authority,
      ...(operatorUserId ? { operatorUserId } : {}),
    });
    return { ...persisted, labelSheetAssignment };
  };
  return typeof db.$transaction === "function"
    ? db.$transaction(persistAtomically)
    : persistAtomically(db);
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

function primaryConfirmImage(plan: AiGraderConfirmCardReferencePlan) {
  return plan.imageReferences.find((reference) => reference.sourceAssetSide === "front");
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
  const existingLabel = isRecord(productionRelease.label) ? productionRelease.label : undefined;
  return sanitizeAiGraderReleaseLike({
    ...productionRelease,
    ...(existingLabel
      ? {
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
        }
      : {}),
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
  queueItemId: string;
  reportId: string;
  gradingSessionId?: string | null;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  identity: AiGraderConfirmedCardIdentity;
  operatorUserId: string;
  publishAuthority: AiGraderPublishAuthorityRecord;
  env?: EnvLike;
}): Promise<AiGraderCreateCardFromReportResult | null> {
  const session = input.gradingSessionId
    ? await input.db.aiGraderSession?.findUnique?.({
        where: { gradingSessionId: input.gradingSessionId },
        select: { cardAssetId: true, itemId: true, cardIdentity: true },
      })
    : null;
  const report = await input.db.aiGraderReport?.findUnique?.({
    where: { reportId: input.reportId },
    select: { cardAssetId: true, itemId: true },
  });
  const sessionCardAssetId = optionalString(isRecord(session) ? session.cardAssetId : null);
  const reportCardAssetId = optionalString(isRecord(report) ? report.cardAssetId : null);
  const sessionItemId = optionalString(isRecord(session) ? session.itemId : null);
  const reportItemId = optionalString(isRecord(report) ? report.itemId : null);
  if (
    (sessionCardAssetId && reportCardAssetId && sessionCardAssetId !== reportCardAssetId) ||
    (sessionItemId && reportItemId && sessionItemId !== reportItemId)
  ) {
    throw new Error("AI Grader report and session CardAsset/Item linkage do not match.");
  }
  const cardAssetId = sessionCardAssetId ?? reportCardAssetId;
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
      classificationSourcesJson: true,
      aiGradingJson: true,
    },
  });
  if (!isRecord(card)) return null;
  const classificationSources = isRecord(card.classificationSourcesJson)
    ? card.classificationSourcesJson
    : {};
  const aiGradingJson = isRecord(card.aiGradingJson) ? card.aiGradingJson : {};
  const expectedRapidIdentity = {
    queueItemId: input.queueItemId,
    gradingSessionId: input.gradingSessionId,
    reportId: input.reportId,
  };
  const exactRapidIdentity = (value: unknown) => {
    const record = isRecord(value) ? value : {};
    return optionalString(record.queueItemId) === expectedRapidIdentity.queueItemId &&
      optionalString(record.gradingSessionId) === expectedRapidIdentity.gradingSessionId &&
      optionalString(record.reportId) === expectedRapidIdentity.reportId;
  };
  const sessionIdentity = isRecord(session) && isRecord(session.cardIdentity) ? session.cardIdentity : {};
  if (!exactRapidIdentity(sessionIdentity.rapidQueueIdentity) ||
      !exactRapidIdentity(classificationSources.rapidQueueIdentity) ||
      !exactRapidIdentity(aiGradingJson.rapidQueueIdentity)) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_PUBLISH_LINKAGE_MISMATCH",
      "The existing confirmed card does not match the exact Rapid queue, grading-session, and report identity.",
    );
  }
  const storedPublishAuthority = parseAiGraderPublishAuthorityRecord(
    classificationSources.aiGraderPublishAuthority,
  );
  const mirroredPublishAuthority = parseAiGraderPublishAuthorityRecord(
    aiGradingJson.publishAuthority,
  );
  if (
    storedPublishAuthority.digestSha256 !== mirroredPublishAuthority.digestSha256 ||
    storedPublishAuthority.digestSha256 !== input.publishAuthority.digestSha256
  ) {
    throw aiGraderPublishBoundaryError(
      "AI_GRADER_PUBLISH_AUTHORITY_CONTRADICTORY",
      "The confirmed card does not match its immutable Publish authority. Stop and re-grade or re-confirm it through the current workflow.",
    );
  }
  assertAiGraderPublishPackageMatchesAuthority({
    reportBundle: input.reportBundle,
    productionRelease: input.productionRelease,
    publishAuthority: storedPublishAuthority,
  });
  const linkedItemId = sessionItemId ?? reportItemId;
  const itemLinkage = await ensureCardItemOwnershipTx(input.db, cardAssetId, {
    env: input.env,
    ...(linkedItemId ? { expectedItemId: linkedItemId } : {}),
  });
  const itemId = itemLinkage.itemId;
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
    queueItemId: input.queueItemId,
    gradingSessionId: input.gradingSessionId ?? "",
    reportId: input.reportId,
    cardAssetId,
    itemId,
    batchId: stringValue(card.batchId, ""),
    title,
    set,
    publicImageUrl,
    cardIdentity,
    productionRelease: linkedProductionRelease(input.productionRelease, cardAssetId, itemId, cardIdentity),
    itemLinkage: {
      itemNumberConvention: "Item.number = CardAsset.id",
    },
  };
}

export async function createAiGraderCardFromReportRuntime(input: {
  queueItemId: string;
  tenantId: string;
  reportBundle: AiGraderProductionReportBundleLike;
  productionRelease: AiGraderProductionReleaseLike;
  storagePlan: AiGraderConfirmCardReferencePlan;
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
  const queueItemId = stringValue(input.queueItemId, "");
  const reportId = stringValue(input.productionRelease.reportId ?? input.reportBundle.reportId, "");
  const gradingSessionId = optionalString(input.productionRelease.gradingSessionId ?? input.reportBundle.gradingSessionId);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(queueItemId)) throw new Error("queueItemId is required.");
  if (!reportId) throw new Error("reportId is required.");
  if (!gradingSessionId) throw new Error("gradingSessionId is required.");
  const primary = primaryConfirmImage(input.storagePlan);
  if (!primary) {
    throw new Error("AI Grader card creation requires verified front normalized-card evidence.");
  }
  const publicImageUrl = "";
  const publishAuthority = buildAiGraderPublishAuthorityRecord({
    reportBundle: input.reportBundle,
    productionRelease: input.productionRelease,
  });
  const rapidQueueIdentity = { queueItemId, gradingSessionId, reportId };

  const { prisma } = await import("@tenkings/database");
  const db = input.dbClient ?? (prisma as any);
  return db.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw !== "function") {
      throw new Error("AI Grader report lifecycle transaction locking is unavailable.");
    }
    await tx.$queryRaw`
      SELECT 1 AS "lockAcquired"
      FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))
    `;
    const existing = await existingAiGraderCreatedCardResult({
      db: tx,
      tenantId: input.tenantId,
      queueItemId,
      reportId,
      gradingSessionId,
      reportBundle: input.reportBundle,
      productionRelease: input.productionRelease,
      identity: input.identity,
      operatorUserId,
      publishAuthority,
      env: input.env,
    });
    if (existing) return existing;

    const owner = await resolveAiGraderItemOwner(tx, input.env ?? process.env);
    const now = new Date();
    const classification = classificationFromIdentity(input.identity);
    const title = identityTitle(input.identity) || stringValue(input.reportBundle.cardIdentity?.title, `AI Grader ${reportId}`);
    const set = identitySet(input.identity);
    const category = collectibleCategoryFromIdentity(input.identity);
    const finalGrade = isRecord(input.productionRelease.finalGrade) ? input.productionRelease.finalGrade : {};
    const label = isRecord(input.productionRelease.label) ? input.productionRelease.label : undefined;
    const finalOverallGrade = firstNumber(finalGrade.overall, (input.reportBundle as JsonRecord).finalOverallGrade);
    const labelGrade = optionalString(label?.labelGradeText) ?? null;
    const gradeJson = {
      source: "ai_grader_new_card_intake_v0",
      reportId,
      certId: optionalString(label?.certId),
      finalGrade,
      ...(label ? { label } : {}),
      actorAudit: input.actorAudit ?? null,
      publishAuthority,
      rapidQueueIdentity,
    };

    const batch = await tx.cardBatch.create({
      data: {
        label: `AI Grader ${optionalString(label?.certId) ?? reportId}`,
        notes: `Created from AI Grader report ${reportId}`,
        uploadedById: operatorUserId,
        totalCount: 1,
        processedCount: 0,
        status: "UPLOADING",
        tags: ["ai-grader", "new-card-intake"],
      },
    });

    const card = await tx.cardAsset.create({
      data: {
        batchId: batch.id,
        storageKey: primary.reservedStorageKey,
        fileName: fileNameFromStorageKey(primary.sourceAssetId, "ai-grader-normalized-front.png"),
        fileSize: primary.byteSize,
        mimeType: primary.contentType,
        imageUrl: publicImageUrl,
        thumbnailUrl: null,
        cdnHdUrl: null,
        cdnThumbUrl: null,
        status: CardAssetStatus.UPLOADING,
        classificationJson: jsonInput(classification),
        classificationSourcesJson: jsonInput({
          source: "ai_grader_confirmed_identity",
          reportId,
          rapidQueueIdentity,
          confirmedAt: now.toISOString(),
          aiGraderPublishAuthority: publishAuthority,
          normalizedEvidence: input.storagePlan.imageReferences.map((reference) => ({
            assetId: reference.sourceAssetId,
            side: reference.sourceAssetSide,
            checksumSha256: reference.checksumSha256,
            byteSize: reference.byteSize,
          })),
          storageStatus: "awaiting_publish_upload",
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

    const itemLinkage = await ensureCardItemOwnershipTx(tx, card.id, {
      env: input.env ?? process.env,
      owner,
    });
    const cardIdentity = cardIdentityResult({
      cardAssetId: card.id,
      itemId: itemLinkage.itemId,
      title,
      set,
      identity: input.identity,
      details: classification,
      imageUrl: publicImageUrl,
    });
    const linkedRelease = linkedProductionRelease(input.productionRelease, card.id, itemLinkage.itemId, cardIdentity);
    const linkedIdentity = {
      ...input.identity,
      ...cardIdentity,
      source: "card_asset",
      status: "linked",
      itemNumberConvention: "Item.number = CardAsset.id",
      rapidQueueIdentity,
    };

    await tx.aiGraderSession.upsert({
      where: { gradingSessionId },
      update: {
        tenantId: input.tenantId,
        reportId,
        operatorUserId,
        cardAssetId: card.id,
        itemId: itemLinkage.itemId,
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
        itemId: itemLinkage.itemId,
        status: "card_created",
        source: "browser_station",
        cardIdentity: jsonInput(linkedIdentity),
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      queueItemId,
      gradingSessionId,
      reportId,
      cardAssetId: card.id,
      itemId: itemLinkage.itemId,
      batchId: batch.id,
      title,
      set,
      publicImageUrl,
      cardIdentity,
      productionRelease: linkedRelease,
      itemLinkage: {
        itemNumberConvention: "Item.number = CardAsset.id",
      },
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
  widthPx: number;
  heightPx: number;
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
    widthPx: input.widthPx,
    heightPx: input.heightPx,
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
    widthPx: input.widthPx,
    heightPx: input.heightPx,
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

function aiGraderInventoryGateError(message: string, code: string, statusCode = 400) {
  const error = new Error(message);
  (error as Error & { statusCode?: number; code?: string }).statusCode = statusCode;
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

export async function validateAiGraderInventoryReadiness(
  db: any,
  reportId: string,
  options: { tenantId?: string; env?: EnvLike; nfcRequired?: boolean } = {},
) {
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
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      certId: true,
      physicalPrintStatus: true,
    },
  });
  if (!isRecord(label) || optionalString(label.physicalPrintStatus) !== "printed") {
    throw aiGraderInventoryGateError("AI Grader label must be marked printed before inventory transition.", "AI_GRADER_LABEL_PRINT_REQUIRED");
  }
  const nfcRequired = options.nfcRequired ?? aiGraderNfcRequired(options.env ?? process.env);
  let nfc: Awaited<ReturnType<typeof getAiGraderNfcStatus>> | null = null;
  if (nfcRequired) {
    let schemaReady: boolean;
    try {
      schemaReady = (await readCachedAiGraderNfcSchemaReadiness(db)).ready;
    } catch {
      throw aiGraderInventoryGateError(
        "NFC persistence readiness could not be verified. Inventory remains blocked.",
        "AI_GRADER_NFC_SCHEMA_CHECK_FAILED",
        503,
      );
    }
    if (!schemaReady) {
      throw aiGraderInventoryGateError(
        "NFC persistence is unavailable until the approved database migration is applied.",
        "AI_GRADER_NFC_SCHEMA_UNAVAILABLE",
        503,
      );
    }
    try {
      nfc = await getAiGraderNfcStatus({
        tenantId: options.tenantId ?? stringValue(report.tenantId, ""),
        reportId,
        cardAssetId,
        itemId,
        certId: stringValue(label.certId, ""),
        dbClient: db,
      });
    } catch (error) {
      const code = isRecord(error) ? optionalString(error.code) : null;
      if (
        code === "AI_GRADER_NFC_CONFIRM_AUTHORITY_MISMATCH" ||
        code === "AI_GRADER_NFC_LINKAGE_MISMATCH" ||
        code === "AI_GRADER_NFC_LINKAGE_INVALID"
      ) {
        throw aiGraderInventoryGateError(
          "The active NFC registration does not match this report, CardAsset, Item, and grading label.",
          "AI_GRADER_NFC_LINKAGE_INVALID",
        );
      }
      throw aiGraderInventoryGateError(
        "NFC registration status could not be verified. Inventory remains blocked.",
        "AI_GRADER_NFC_STATUS_CHECK_FAILED",
        503,
      );
    }
    if (nfc.status !== "active" || nfc.revokedAt) {
      throw aiGraderInventoryGateError(
        "An active, non-revoked NFC registration is required before inventory transition.",
        "AI_GRADER_NFC_ACTIVE_REQUIRED",
      );
    }
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
    nfcRequired,
    nfc,
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
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${input.reportId}))
  `;
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
    await tx.$queryRaw`
      SELECT 1 AS "lockAcquired"
      FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${input.reportId}))
    `;
    const valuationId = `ai-grader-valuation:${input.reportId}`;
    const current = await tx.aiGraderValuation.findUnique({
      where: { id: valuationId },
      select: { status: true, searchQuery: true, resultSummary: true, updatedAt: true },
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
    if (
      input.status === "running" &&
      currentStatus === "ready" &&
      optionalString(currentSummary.lifecycleStatus) === "ready"
    ) {
      throw conflict(
        "eBay sold comps are already ready for review for this card.",
        "AI_GRADER_COMPS_ALREADY_READY"
      );
    }
    const persistedSearchQuery = optionalString(current?.searchQuery);
    if (input.status === "running" && !persistedSearchQuery) {
      throw conflict(
        "Confirmed card identity has not queued an eBay sold-comps search yet.",
        "AI_GRADER_COMPS_CONFIRMED_IDENTITY_REQUIRED"
      );
    }
    return persistAiGraderValuationResult(tx as any, {
      tenantId: input.tenantId,
      reportId: input.reportId,
      status: input.status,
      source: "ebay_sold",
      searchQuery: persistedSearchQuery ?? input.searchQuery ?? null,
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
  dbClient?: any;
  env?: EnvLike;
}): Promise<AiGraderAddToInventoryResult> {
  if (!input.operatorUserId) {
    const error = new Error("A human operator session is required to move an AI Grader card into inventory.");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
  const operatorUserId = input.operatorUserId;
  const { prisma } = await import("@tenkings/database");
  const db = input.dbClient ?? (prisma as any);
  return db.$transaction(async (tx: any) => {
    if (typeof tx.$queryRaw !== "function") {
      throw new Error("AI Grader inventory transaction locking is unavailable.");
    }
    await tx.$queryRaw`
      SELECT 1 AS "lockAcquired"
      FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${input.reportId}))
    `;
    await tx.$queryRaw`
      SELECT 1 AS "lockAcquired"
      FROM pg_advisory_xact_lock(hashtext('ai-grader-label-sheets'), hashtext(${input.tenantId}))
    `;
    const readiness = await validateAiGraderInventoryReadiness(tx, input.reportId, {
      tenantId: input.tenantId,
      env: input.env ?? process.env,
    });
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
    const inventory = await ensureInventoryReadyArtifactsTx(tx, cardAssetId, operatorUserId, {
      env: input.env ?? process.env,
      expectedItemId: readiness.itemId,
    });
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

async function hydrateAiGraderFinishCardsQueueRows(
  db: any,
  reportRows: unknown[],
  options: { tenantId: string },
) {
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
  const nfcByReportId = await readAiGraderNfcStatusesForReports({
    dbClient: db,
    tenantId: options.tenantId,
    reports: reports.flatMap((row) => {
      const reportId = optionalString(row.reportId);
      const label = firstRecord(row.labels) ?? firstRecord(row.label);
      return reportId ? [{
        reportId,
        reportRowId: optionalString(row.id),
        cardAssetId: optionalString(row.cardAssetId),
        itemId: optionalString(row.itemId),
        labelId: optionalString(label?.id),
        certId: optionalString(label?.certId),
      }] : [];
    }),
  });
  return reports.map((row) => ({
    ...row,
    cardAsset: cardById.get(optionalString(row.cardAssetId)),
    item: itemById.get(optionalString(row.itemId)),
    nfc: nfcByReportId.get(stringValue(row.reportId, "")) ?? { status: "missing" },
  }));
}

export async function listAiGraderFinishCardsQueueRuntime(input?: {
  tenantId?: string;
  env?: EnvLike;
}): Promise<AiGraderFinishCardsQueueResult> {
  const { prisma } = await import("@tenkings/database");
  const db = prisma as any;
  const tenantId = input?.tenantId ?? process.env[AI_GRADER_PRODUCTION_TENANT_ID_ENV] ?? "ten-kings";
  const nfcRequired = aiGraderNfcRequired(input?.env ?? process.env);
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
        reportId: true,
      },
    },
    labels: {
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: {
        id: true,
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

    hydratedRows.push(...(await hydrateAiGraderFinishCardsQueueRows(db, reports, { tenantId })));
    const activeCount = buildAiGraderFinishCardsQueueResult(hydratedRows, {
      activeLimit: AI_GRADER_FINISH_QUEUE_ACTIVE_LIMIT,
      nfcRequired,
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
    hydratedRows.push(...(await hydrateAiGraderFinishCardsQueueRows(db, recentCompletedRows, { tenantId })));
  }

  return buildAiGraderFinishCardsQueueResult(hydratedRows, {
    activeLimit: AI_GRADER_FINISH_QUEUE_ACTIVE_LIMIT,
    recentCompletedLimit: AI_GRADER_FINISH_QUEUE_RECENT_COMPLETED_LIMIT,
    nfcRequired,
  });
}
