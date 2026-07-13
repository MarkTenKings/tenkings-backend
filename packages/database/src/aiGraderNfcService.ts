import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { prisma as defaultPrisma } from "./client";
import {
  canonicalAiGraderPublishAuthorityJson,
  parseAiGraderPublishAuthorityRecord,
  type AiGraderPublishAuthorityRecord,
} from "./aiGraderProductionService";

export const AI_GRADER_NFC_PUBLIC_ORIGIN = "https://collect.tenkings.co" as const;
export const AI_GRADER_NFC_NDEF_PAYLOAD_VERSION = 1 as const;
export const AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET_ENV = "AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET" as const;
export const AI_GRADER_NFC_DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

const PUBLIC_TAG_ID = /^[A-Za-z0-9_-]{32}$/;
const ATTEMPT_ID = /^nfc_attempt_[A-Za-z0-9_-]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CODE = /^[A-Z0-9_]{1,80}$/;
const OPEN_STATUSES = ["reserved", "programming", "verified", "active"] as const;
const ACTIVE_ATTEMPT_STATES = ["initialized", "writing"] as const;

export type AiGraderNfcChipTypeValue = "NTAG215" | "NTAG424_DNA";
export type AiGraderNfcSecurityModeValue = "static_url_v1" | "ntag424_sun_v1";
export type AiGraderNfcTagStatusValue = "missing" | "reserved" | "programming" | "verified" | "active" | "revoked" | "error";
export type AiGraderNfcRegistrationKind = "registered_link" | "cryptographically_verified" | "not_active";

export type AiGraderNfcSecurityStrategyDescriptor = {
  chipType: AiGraderNfcChipTypeValue;
  securityMode: AiGraderNfcSecurityModeValue;
  implemented: boolean;
  registrationKind: "registered_link" | null;
  cryptographicVerificationAvailable: boolean;
};

/** Future seam only; keys and SUN evidence never belong in application JSON. */
export interface AiGraderNtag424SunVerifier {
  readonly mode: "ntag424_sun_v1";
  verify(input: { url: string; keyVersionReference: string; observedAt: Date }): Promise<{
    verified: boolean;
    counter?: bigint;
    verifierVersion: string;
  }>;
}

export function describeAiGraderNfcSecurityStrategy(
  chipType: AiGraderNfcChipTypeValue,
  securityMode: AiGraderNfcSecurityModeValue,
): AiGraderNfcSecurityStrategyDescriptor {
  if (chipType === "NTAG215" && securityMode === "static_url_v1") {
    return { chipType, securityMode, implemented: true, registrationKind: "registered_link", cryptographicVerificationAvailable: false };
  }
  if (chipType === "NTAG424_DNA" && securityMode === "ntag424_sun_v1") {
    return { chipType, securityMode, implemented: false, registrationKind: null, cryptographicVerificationAvailable: false };
  }
  throw nfcError("AI_GRADER_NFC_STRATEGY_MISMATCH", 400, "NFC chip type and security mode do not match.");
}

export class AiGraderNfcServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "AiGraderNfcServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

type JsonRecord = Record<string, unknown>;
type DbClient = any;
type ExactLinkageInput = { tenantId: string; reportId: string; cardAssetId: string; itemId: string; certId: string };
type ActorInput = { requestedByUserId: string };

export type AiGraderNfcSafeStatus = {
  status: AiGraderNfcTagStatusValue;
  reportId: string;
  cardAssetId?: string;
  itemId?: string;
  certId?: string;
  publicTagId?: string;
  nfcTagUrl?: string;
  chipType?: AiGraderNfcChipTypeValue;
  securityMode?: AiGraderNfcSecurityModeValue;
  ndefPayloadVersion?: number;
  registrationKind: AiGraderNfcRegistrationKind;
  cryptographicallyVerified: false;
  activatedAt?: string | null;
  revokedAt?: string | null;
  revocationReason?: string | null;
  errorCode?: string | null;
};

export type InitAiGraderNfcProgrammingInput = ExactLinkageInput & ActorInput & {
  idempotencyKey: string;
  tokenSecret?: string;
  attemptTtlMs?: number;
  operatorNote?: string | null;
  dbClient?: DbClient;
  now?: Date;
};
export type AiGraderNfcProgrammingInitResult = AiGraderNfcSafeStatus & {
  attemptId?: string;
  attemptToken?: string;
  attemptExpiresAt?: string;
  expectedNdefUrl?: string;
  expectedPayloadSha256?: string;
};
export type CompleteAiGraderNfcProgrammingInput = ExactLinkageInput & ActorInput & {
  attemptId: string;
  attemptToken: string;
  uidFingerprintSha256: string;
  normalizedNdefUrl: string;
  readbackPayloadSha256: string;
  chipType: AiGraderNfcChipTypeValue;
  securityMode: AiGraderNfcSecurityModeValue;
  idempotencyKey: string;
  readerCode?: string | null;
  resultCode?: string | null;
  helperProtocolVersion?: string | null;
  dbClient?: DbClient;
  now?: Date;
};
export type GetAiGraderNfcStatusInput = {
  tenantId: string;
  reportId: string;
  cardAssetId?: string;
  itemId?: string;
  certId?: string;
  dbClient?: DbClient;
};
export type RevokeAiGraderNfcTagInput = ExactLinkageInput & ActorInput & {
  publicTagId: string;
  reason: string;
  idempotencyKey: string;
  reasonCode?: string | null;
  dbClient?: DbClient;
  now?: Date;
};
export type ReplaceAiGraderNfcTagInput = InitAiGraderNfcProgrammingInput & {
  replacedPublicTagId: string;
  revocationReason: string;
  revocationReasonCode?: string | null;
};
type ConfirmAuthority = {
  tenantId: string;
  reportRowId: string;
  reportId: string;
  gradingSessionId: string;
  cardAssetId: string;
  itemId: string;
  labelId: string;
  certId: string;
};
type ExpiredAttemptResult = { readonly __aiGraderNfcAttemptExpired: true };
const EXPIRED_ATTEMPT_RESULT: ExpiredAttemptResult = { __aiGraderNfcAttemptExpired: true };

function isExpiredAttemptResult(value: unknown): value is ExpiredAttemptResult {
  return isRecord(value) && value.__aiGraderNfcAttemptExpired === true;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function nfcError(code: string, statusCode: number, message: string) {
  return new AiGraderNfcServiceError(code, statusCode, message);
}
function required(value: unknown, field: string, max = 256) {
  const normalized = text(value);
  if (!normalized || normalized.length > max) {
    throw nfcError("AI_GRADER_NFC_INVALID_REQUEST", 400, `${field} is required and must be ${max} characters or fewer.`);
  }
  return normalized;
}
function boundedCode(value: unknown, fallback: string) {
  const normalized = text(value).toUpperCase();
  return normalized && SAFE_CODE.test(normalized) ? normalized : fallback;
}
function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function safeEqualHex(left: string, right: string) {
  return SHA256.test(left) && SHA256.test(right) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function date(value: unknown) {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function iso(value: unknown) {
  return date(value)?.toISOString() ?? null;
}
function validateExactLinkage(input: ExactLinkageInput): ExactLinkageInput {
  return {
    tenantId: required(input.tenantId, "tenantId", 128),
    reportId: required(input.reportId, "reportId"),
    cardAssetId: required(input.cardAssetId, "cardAssetId", 128),
    itemId: required(input.itemId, "itemId", 128),
    certId: required(input.certId, "certId"),
  };
}
function validateActor(value: unknown) {
  return required(value, "requestedByUserId", 128);
}
function validateIdempotencyKey(value: unknown) {
  const normalized = required(value, "idempotencyKey", 200);
  if (normalized.length < 8) throw nfcError("AI_GRADER_NFC_INVALID_IDEMPOTENCY_KEY", 400, "NFC idempotency key must be at least 8 characters.");
  return normalized;
}
function validateTokenSecret(value: unknown) {
  const secret = text(value || process.env[AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET_ENV]);
  if (Buffer.byteLength(secret, "utf8") < 32) throw nfcError("AI_GRADER_NFC_TOKEN_SECRET_UNAVAILABLE", 503, "NFC programming token service is not configured.");
  return secret;
}
function attemptTtl(value: unknown) {
  const ttl = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : AI_GRADER_NFC_DEFAULT_ATTEMPT_TTL_MS;
  if (ttl < 60_000 || ttl > 30 * 60_000) throw nfcError("AI_GRADER_NFC_INVALID_ATTEMPT_TTL", 400, "NFC attempt lifetime is outside the allowed range.");
  return ttl;
}
function safeMetadata(operatorNote?: string | null) {
  const note = text(operatorNote);
  return {
    schemaVersion: "ai-grader-nfc-safe-metadata-v1",
    workflow: "dedicated_nfc_workstation",
    evidenceSemantics: "registered_link_not_cryptographic_attestation",
    ...(note ? { operatorNote: note.slice(0, 240) } : {}),
  };
}
function rawUidWasSupplied(input: unknown) {
  return isRecord(input) && Object.keys(input).some((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === "rawuid");
}

export function generateAiGraderNfcPublicTagId(random: (size: number) => Buffer = randomBytes) {
  const id = random(24).toString("base64url");
  if (!PUBLIC_TAG_ID.test(id)) throw nfcError("AI_GRADER_NFC_RANDOM_ID_FAILED", 500, "NFC identity generation failed.");
  return id;
}
function generateAttemptId(random: (size: number) => Buffer = randomBytes) {
  const id = `nfc_attempt_${random(18).toString("base64url")}`;
  if (!ATTEMPT_ID.test(id)) throw nfcError("AI_GRADER_NFC_RANDOM_ID_FAILED", 500, "NFC attempt identity generation failed.");
  return id;
}
export function buildAiGraderNfcTagUrl(publicTagId: string) {
  const normalized = text(publicTagId);
  if (!PUBLIC_TAG_ID.test(normalized)) throw nfcError("AI_GRADER_NFC_INVALID_PUBLIC_TAG_ID", 400, "NFC public tag ID is invalid.");
  return `${AI_GRADER_NFC_PUBLIC_ORIGIN}/nfc/${normalized}`;
}
function deriveAttemptToken(secret: string, attemptId: string) {
  return createHmac("sha256", secret).update(`ai-grader-nfc-attempt-v1\n${attemptId}`, "utf8").digest("base64url");
}
function attemptIdempotencyHash(actorUserId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-init-v1\n${actorUserId}\n${idempotencyKey}`);
}
function completionIdempotencyHash(actorUserId: string, attemptId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-complete-v1\n${actorUserId}\n${attemptId}\n${idempotencyKey}`);
}
function mutationIdempotencyHash(action: string, actorUserId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-${action}-v1\n${actorUserId}\n${idempotencyKey}`);
}
function asTagStatus(value: unknown): Exclude<AiGraderNfcTagStatusValue, "missing"> {
  const normalized = text(value) as Exclude<AiGraderNfcTagStatusValue, "missing">;
  if (!OPEN_STATUSES.includes(normalized as any) && normalized !== "revoked" && normalized !== "error") {
    throw nfcError("AI_GRADER_NFC_STATE_CONTRADICTION", 409, "NFC state is contradictory.");
  }
  return normalized;
}
function assertStaticStrategy(chipType: unknown, securityMode: unknown) {
  if (chipType !== "NTAG215" || securityMode !== "static_url_v1") {
    throw nfcError("AI_GRADER_NFC_STRATEGY_NOT_IMPLEMENTED", 409, "This NFC security strategy is not implemented.");
  }
  return describeAiGraderNfcSecurityStrategy("NTAG215", "static_url_v1");
}
function safeStatus(tag: any, fallbackReportId = ""): AiGraderNfcSafeStatus {
  if (!tag) return { status: "missing", reportId: fallbackReportId, registrationKind: "not_active", cryptographicallyVerified: false };
  const status = asTagStatus(tag.status);
  const strategy = describeAiGraderNfcSecurityStrategy(tag.chipType, tag.securityMode);
  return {
    status,
    reportId: text(tag.reportId),
    cardAssetId: text(tag.cardAssetId),
    itemId: text(tag.itemId),
    certId: text(tag.certId),
    publicTagId: text(tag.publicTagId),
    nfcTagUrl: buildAiGraderNfcTagUrl(tag.publicTagId),
    chipType: tag.chipType,
    securityMode: tag.securityMode,
    ndefPayloadVersion: Number(tag.ndefPayloadVersion),
    registrationKind: status === "active" && strategy.registrationKind === "registered_link" ? "registered_link" : "not_active",
    cryptographicallyVerified: false,
    activatedAt: iso(tag.activatedAt),
    revokedAt: iso(tag.revokedAt),
    revocationReason: status === "revoked" ? text(tag.revocationReason) || null : null,
    errorCode: status === "error" ? text(tag.errorCode) || null : null,
  };
}

function assertTagLinkage(tag: any, linkage: ExactLinkageInput) {
  if (
    !tag ||
    text(tag.tenantId) !== linkage.tenantId ||
    text(tag.reportId) !== linkage.reportId ||
    text(tag.cardAssetId) !== linkage.cardAssetId ||
    text(tag.itemId) !== linkage.itemId ||
    text(tag.certId) !== linkage.certId
  ) throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC linkage does not match the confirmed card.");
}
function assertAttemptLinkage(attempt: any, linkage: ExactLinkageInput, actorUserId: string) {
  if (
    !attempt ||
    text(attempt.tenantId) !== linkage.tenantId ||
    text(attempt.reportId) !== linkage.reportId ||
    text(attempt.cardAssetId) !== linkage.cardAssetId ||
    text(attempt.itemId) !== linkage.itemId ||
    text(attempt.certId) !== linkage.certId ||
    text(attempt.requestedByUserId) !== actorUserId
  ) throw nfcError("AI_GRADER_NFC_ATTEMPT_MISMATCH", 409, "NFC programming attempt does not match this actor and card.");
}
function authorityRecord(value: unknown): AiGraderPublishAuthorityRecord {
  try {
    return parseAiGraderPublishAuthorityRecord(value);
  } catch {
    throw nfcError("AI_GRADER_NFC_CONFIRM_AUTHORITY_INVALID", 409, "The confirmed card has invalid immutable Publish authority.");
  }
}
function record(value: unknown) {
  return isRecord(value) ? value : {};
}

async function loadConfirmAuthority(
  tx: DbClient,
  linkage: ExactLinkageInput,
  options: { requirePublished: boolean },
): Promise<ConfirmAuthority> {
  const report = await tx.aiGraderReport?.findUnique?.({
    where: { reportId: linkage.reportId },
    select: {
      id: true, tenantId: true, sessionId: true, reportId: true, publicationStatus: true,
      publishedAt: true, cardAssetId: true, itemId: true, finalOverallGrade: true,
    },
  });
  if (!report) throw nfcError("AI_GRADER_NFC_REPORT_NOT_FOUND", 404, "Published AI Grader report was not found.");
  const [session, card, item, label, publication] = await Promise.all([
    tx.aiGraderSession?.findUnique?.({
      where: { id: report.sessionId },
      select: {
        id: true, tenantId: true, gradingSessionId: true, reportId: true, status: true,
        cardAssetId: true, itemId: true, cardIdentity: true,
      },
    }),
    tx.cardAsset?.findUnique?.({
      where: { id: linkage.cardAssetId },
      select: { id: true, batchId: true, classificationSourcesJson: true, aiGradingJson: true },
    }),
    tx.item?.findUnique?.({ where: { id: linkage.itemId }, select: { id: true, number: true } }),
    tx.aiGraderLabel?.findUnique?.({
      where: { certId: linkage.certId },
      select: { id: true, tenantId: true, reportId: true, certId: true },
    }),
    tx.aiGraderPublication?.findUnique?.({
      where: { reportId: report.id },
      select: { tenantId: true, status: true, publishedAt: true, revokedAt: true },
    }),
  ]);
  const identity = record(session?.cardIdentity);
  const exact =
    text(report.tenantId) === linkage.tenantId &&
    text(report.reportId) === linkage.reportId &&
    text(report.cardAssetId) === linkage.cardAssetId &&
    text(report.itemId) === linkage.itemId &&
    text(session?.tenantId) === linkage.tenantId &&
    text(session?.reportId) === linkage.reportId &&
    text(session?.cardAssetId) === linkage.cardAssetId &&
    text(session?.itemId) === linkage.itemId &&
    ["published", "inventory_ready"].includes(text(session?.status)) &&
    text(identity.source) === "card_asset" &&
    text(identity.status) === "linked" &&
    text(identity.cardAssetId) === linkage.cardAssetId &&
    text(identity.itemId) === linkage.itemId &&
    text(card?.id) === linkage.cardAssetId &&
    Boolean(text(card?.batchId)) &&
    text(item?.id) === linkage.itemId &&
    text(item?.number) === linkage.cardAssetId &&
    text(label?.tenantId) === linkage.tenantId &&
    text(label?.reportId) === text(report.id) &&
    text(label?.certId) === linkage.certId &&
    text(publication?.tenantId) === linkage.tenantId;
  if (!exact) throw nfcError("AI_GRADER_NFC_CONFIRM_AUTHORITY_MISMATCH", 409, "NFC linkage does not match durable Confirm authority.");
  if (
    options.requirePublished &&
    (text(report.publicationStatus) !== "published" || !date(report.publishedAt) ||
      text(publication?.status) !== "published" || !date(publication?.publishedAt) || publication?.revokedAt)
  ) throw nfcError("AI_GRADER_NFC_REPORT_NOT_PUBLISHED", 409, "AI Grader report must be durably published before NFC programming.");

  const sources = record(card.classificationSourcesJson);
  const grading = record(card.aiGradingJson);
  const primary = authorityRecord(sources.aiGraderPublishAuthority);
  const mirror = authorityRecord(grading.publishAuthority);
  if (
    primary.digestSha256 !== mirror.digestSha256 ||
    canonicalAiGraderPublishAuthorityJson(primary) !== canonicalAiGraderPublishAuthorityJson(mirror)
  ) throw nfcError("AI_GRADER_NFC_CONFIRM_AUTHORITY_CONTRADICTORY", 409, "The confirmed card has contradictory Publish authority.");
  const reportProjection = record(primary.projection.report);
  const releaseProjection = record(primary.projection.release);
  const labelProjection = record(releaseProjection.label);
  const finalGradeProjection = record(releaseProjection.finalGrade);
  if (
    text(reportProjection.reportId) !== linkage.reportId ||
    text(releaseProjection.reportId) !== linkage.reportId ||
    text(labelProjection.reportId) !== linkage.reportId ||
    text(reportProjection.gradingSessionId) !== text(session.gradingSessionId) ||
    text(releaseProjection.gradingSessionId) !== text(session.gradingSessionId) ||
    Number(finalGradeProjection.overall) !== Number(report.finalOverallGrade)
  ) throw nfcError("AI_GRADER_NFC_CONFIRM_AUTHORITY_CONTRADICTORY", 409, "Publish authority contradicts the durable report linkage.");
  return {
    tenantId: linkage.tenantId,
    reportRowId: text(report.id),
    reportId: linkage.reportId,
    gradingSessionId: text(session.gradingSessionId),
    cardAssetId: linkage.cardAssetId,
    itemId: linkage.itemId,
    labelId: text(label.id),
    certId: linkage.certId,
  };
}

async function acquireReportLock(tx: DbClient, reportId: string) {
  if (typeof tx.$queryRaw !== "function") throw nfcError("AI_GRADER_NFC_LOCK_UNAVAILABLE", 503, "NFC report lifecycle locking is unavailable.");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))`;
}
async function transaction<T>(db: DbClient, callback: (tx: DbClient) => Promise<T>) {
  if (!db || typeof db.$transaction !== "function") throw nfcError("AI_GRADER_NFC_TRANSACTION_UNAVAILABLE", 503, "NFC transaction service is unavailable.");
  return db.$transaction(callback);
}
async function audit(tx: DbClient, input: {
  tagId: string; attemptId?: string | null; tenantId: string; reportId: string; action: string;
  fromStatus?: Exclude<AiGraderNfcTagStatusValue, "missing"> | null;
  toStatus?: Exclude<AiGraderNfcTagStatusValue, "missing"> | null;
  actorUserId: string; reasonCode?: string | null; safeDetails?: JsonRecord | null; createdAt: Date;
}) {
  return tx.aiGraderNfcAuditEvent.create({ data: {
    tagId: input.tagId, attemptId: input.attemptId ?? null, tenantId: input.tenantId,
    reportId: input.reportId, action: input.action.slice(0, 80), fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null, actorUserId: input.actorUserId,
    reasonCode: input.reasonCode ? boundedCode(input.reasonCode, "AI_GRADER_NFC_EVENT") : null,
    safeDetails: input.safeDetails ?? undefined, createdAt: input.createdAt,
  } });
}
async function uniquePublicTagId(tx: DbClient) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicTagId = generateAiGraderNfcPublicTagId();
    if (!(await tx.aiGraderNfcTag.findUnique({ where: { publicTagId }, select: { id: true } }))) return publicTagId;
  }
  throw nfcError("AI_GRADER_NFC_RANDOM_ID_COLLISION", 503, "NFC identity allocation could not complete.");
}
async function expireAttempt(tx: DbClient, attempt: any, now: Date) {
  const expiresAt = date(attempt.expiresAt);
  if (expiresAt && expiresAt.getTime() > now.getTime()) return false;
  if (ACTIVE_ATTEMPT_STATES.includes(attempt.state)) {
    await tx.aiGraderNfcProgrammingAttempt.update({
      where: { id: attempt.id },
      data: { state: "expired", failureCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED", updatedAt: now },
    });
  }
  return true;
}

async function createProgrammingAttemptTx(tx: DbClient, input: {
  linkage: ExactLinkageInput; authority: ConfirmAuthority; actorUserId: string; idempotencyKey: string;
  tokenSecret: string; ttlMs: number; now: Date; operatorNote?: string | null;
}): Promise<AiGraderNfcProgrammingInitResult | ExpiredAttemptResult> {
  const idempotencyKeyHash = attemptIdempotencyHash(input.actorUserId, input.idempotencyKey);
  const existingAttempt = await tx.aiGraderNfcProgrammingAttempt.findUnique({
    where: { tenantId_requestedByUserId_idempotencyKeyHash: {
      tenantId: input.linkage.tenantId, requestedByUserId: input.actorUserId, idempotencyKeyHash,
    } },
    include: { tag: true },
  });
  if (existingAttempt) {
    assertAttemptLinkage(existingAttempt, input.linkage, input.actorUserId);
    assertTagLinkage(existingAttempt.tag, input.linkage);
    if (existingAttempt.state === "consumed") return { ...safeStatus(existingAttempt.tag), attemptId: existingAttempt.id };
    if (await expireAttempt(tx, existingAttempt, input.now)) return EXPIRED_ATTEMPT_RESULT;
    if (!ACTIVE_ATTEMPT_STATES.includes(existingAttempt.state)) throw nfcError("AI_GRADER_NFC_ATTEMPT_TERMINAL", 409, "NFC programming attempt is no longer usable.");
    const attemptToken = deriveAttemptToken(input.tokenSecret, existingAttempt.id);
    if (!safeEqualHex(sha256(attemptToken), text(existingAttempt.tokenHash))) throw nfcError("AI_GRADER_NFC_TOKEN_STATE_INVALID", 503, "NFC token state is invalid.");
    return {
      ...safeStatus(existingAttempt.tag), attemptId: existingAttempt.id, attemptToken,
      attemptExpiresAt: iso(existingAttempt.expiresAt) ?? undefined,
      expectedNdefUrl: buildAiGraderNfcTagUrl(existingAttempt.tag.publicTagId),
      expectedPayloadSha256: text(existingAttempt.tag.expectedPayloadSha256),
    };
  }
  let tag = await tx.aiGraderNfcTag.findFirst({
    where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
  if (tag?.status === "active") return safeStatus(tag);
  if (!tag) tag = await tx.aiGraderNfcTag.findFirst({
    where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: "error" },
    orderBy: { createdAt: "desc" },
  });
  if (tag) {
    assertTagLinkage(tag, input.linkage);
    const liveAttempt = await tx.aiGraderNfcProgrammingAttempt.findFirst({
      where: { tagId: tag.id, state: { in: [...ACTIVE_ATTEMPT_STATES] }, expiresAt: { gt: input.now } },
      orderBy: { requestedAt: "desc" },
    });
    if (liveAttempt) throw nfcError("AI_GRADER_NFC_ATTEMPT_IN_PROGRESS", 409, "Another NFC programming attempt is already in progress.");
  } else {
    const publicTagId = await uniquePublicTagId(tx);
    const expectedUrl = buildAiGraderNfcTagUrl(publicTagId);
    tag = await tx.aiGraderNfcTag.create({ data: {
      tenantId: input.linkage.tenantId, publicTagId, chipType: "NTAG215", securityMode: "static_url_v1",
      status: "reserved", ndefPayloadVersion: AI_GRADER_NFC_NDEF_PAYLOAD_VERSION,
      expectedPayloadSha256: sha256(expectedUrl), aiGraderReportId: input.authority.reportRowId,
      reportId: input.linkage.reportId, cardAssetId: input.linkage.cardAssetId, itemId: input.linkage.itemId,
      aiGraderLabelId: input.authority.labelId, certId: input.linkage.certId, createdByUserId: input.actorUserId,
      metadata: safeMetadata(input.operatorNote), createdAt: input.now, updatedAt: input.now,
    } });
    await audit(tx, {
      tagId: tag.id, tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, action: "reserve",
      toStatus: "reserved", actorUserId: input.actorUserId,
      safeDetails: { chipType: "NTAG215", securityMode: "static_url_v1", ndefPayloadVersion: 1 },
      createdAt: input.now,
    });
  }
  assertStaticStrategy(tag.chipType, tag.securityMode);
  if (text(tag.aiGraderReportId) !== input.authority.reportRowId || text(tag.aiGraderLabelId) !== input.authority.labelId) {
    throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal report and label linkage changed.");
  }
  const attemptId = generateAttemptId();
  const attemptToken = deriveAttemptToken(input.tokenSecret, attemptId);
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  const attempt = await tx.aiGraderNfcProgrammingAttempt.create({ data: {
    id: attemptId, tagId: tag.id, tenantId: input.linkage.tenantId, reportId: input.linkage.reportId,
    cardAssetId: input.linkage.cardAssetId, itemId: input.linkage.itemId, certId: input.linkage.certId,
    requestedByUserId: input.actorUserId, idempotencyKeyHash, tokenHash: sha256(attemptToken),
    state: "initialized", requestedAt: input.now, expiresAt, createdAt: input.now, updatedAt: input.now,
  } });
  const fromStatus = asTagStatus(tag.status);
  tag = await tx.aiGraderNfcTag.update({
    where: { id: tag.id }, data: { status: "programming", errorCode: null, updatedAt: input.now },
  });
  await audit(tx, {
    tagId: tag.id, attemptId: attempt.id, tenantId: input.linkage.tenantId, reportId: input.linkage.reportId,
    action: "programming_attempt_initialized", fromStatus, toStatus: "programming", actorUserId: input.actorUserId,
    safeDetails: { expiresAt: expiresAt.toISOString(), evidenceSemantics: "local_pcsc_readback_not_attestation" },
    createdAt: input.now,
  });
  return {
    ...safeStatus(tag), attemptId, attemptToken, attemptExpiresAt: expiresAt.toISOString(),
    expectedNdefUrl: buildAiGraderNfcTagUrl(tag.publicTagId), expectedPayloadSha256: text(tag.expectedPayloadSha256),
  };
}

export async function initAiGraderNfcProgramming(input: InitAiGraderNfcProgrammingInput) {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const tokenSecret = validateTokenSecret(input.tokenSecret);
  const ttlMs = attemptTtl(input.attemptTtlMs);
  const now = input.now ?? new Date();
  const result = await transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
    return createProgrammingAttemptTx(tx, {
      linkage, authority, actorUserId, idempotencyKey, tokenSecret, ttlMs, now, operatorNote: input.operatorNote,
    });
  });
  if (isExpiredAttemptResult(result)) {
    throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "NFC programming attempt expired.");
  }
  return result;
}

export async function completeAiGraderNfcProgramming(
  input: CompleteAiGraderNfcProgrammingInput,
): Promise<AiGraderNfcSafeStatus> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const attemptId = required(input.attemptId, "attemptId", 64);
  if (!ATTEMPT_ID.test(attemptId)) throw nfcError("AI_GRADER_NFC_INVALID_ATTEMPT", 400, "NFC attempt ID is invalid.");
  const attemptToken = required(input.attemptToken, "attemptToken", 256);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const completionHash = completionIdempotencyHash(actorUserId, attemptId, idempotencyKey);
  const uidFingerprintSha256 = text(input.uidFingerprintSha256).toLowerCase();
  const readbackPayloadSha256 = text(input.readbackPayloadSha256).toLowerCase();
  if (!SHA256.test(uidFingerprintSha256) || !SHA256.test(readbackPayloadSha256)) {
    throw nfcError("AI_GRADER_NFC_INVALID_FINGERPRINT", 400, "NFC readback fingerprints are invalid.");
  }
  assertStaticStrategy(input.chipType, input.securityMode);
  const normalizedNdefUrl = required(input.normalizedNdefUrl, "normalizedNdefUrl", 512);
  const now = input.now ?? new Date();
  try {
    const result = await transaction(input.dbClient ?? defaultPrisma, async (tx) => {
      await acquireReportLock(tx, linkage.reportId);
      const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
      const attempt = await tx.aiGraderNfcProgrammingAttempt.findUnique({
        where: { id: attemptId }, include: { tag: true },
      });
      if (!attempt) throw nfcError("AI_GRADER_NFC_ATTEMPT_NOT_FOUND", 404, "NFC programming attempt was not found.");
      assertAttemptLinkage(attempt, linkage, actorUserId);
      assertTagLinkage(attempt.tag, linkage);
      if (text(attempt.tag.aiGraderReportId) !== authority.reportRowId || text(attempt.tag.aiGraderLabelId) !== authority.labelId) {
        throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal linkage changed.");
      }
      if (!safeEqualHex(sha256(attemptToken), text(attempt.tokenHash))) throw nfcError("AI_GRADER_NFC_TOKEN_REJECTED", 401, "NFC programming token was rejected.");
      if (attempt.state === "consumed") {
        if (
          text(attempt.completionIdempotencyKeyHash) === completionHash &&
          attempt.tag.status === "active" &&
          text(attempt.tag.uidFingerprintSha256) === uidFingerprintSha256 &&
          text(attempt.tag.readbackPayloadSha256) === readbackPayloadSha256 &&
          normalizedNdefUrl === buildAiGraderNfcTagUrl(attempt.tag.publicTagId)
        ) return safeStatus(attempt.tag);
        throw nfcError("AI_GRADER_NFC_TOKEN_REPLAY", 409, "NFC programming token was already consumed.");
      }
      if (await expireAttempt(tx, attempt, now)) return EXPIRED_ATTEMPT_RESULT;
      if (!ACTIVE_ATTEMPT_STATES.includes(attempt.state)) throw nfcError("AI_GRADER_NFC_ATTEMPT_TERMINAL", 409, "NFC programming attempt is no longer usable.");
      if (attempt.tag.status !== "programming") throw nfcError("AI_GRADER_NFC_STATE_CONTRADICTION", 409, "NFC tag is not in programming state.");
      const expectedUrl = buildAiGraderNfcTagUrl(attempt.tag.publicTagId);
      const expectedDigest = sha256(expectedUrl);
      if (
        normalizedNdefUrl !== expectedUrl || readbackPayloadSha256 !== expectedDigest ||
        text(attempt.tag.expectedPayloadSha256) !== expectedDigest
      ) throw nfcError("AI_GRADER_NFC_READBACK_MISMATCH", 409, "NFC readback does not match the reserved Ten Kings URL.");
      const duplicateUid = await tx.aiGraderNfcTag.findFirst({
        where: { uidFingerprintSha256, status: "active", id: { not: attempt.tag.id } },
        select: { id: true },
      });
      if (duplicateUid) throw nfcError("AI_GRADER_NFC_UID_ALREADY_ACTIVE", 409, "This NFC tag is already active on another card.");

      await tx.aiGraderNfcProgrammingAttempt.update({
        where: { id: attempt.id }, data: { state: "writing", updatedAt: now },
      });
      const verifiedTag = await tx.aiGraderNfcTag.update({ where: { id: attempt.tag.id }, data: {
        status: "verified", uidFingerprintSha256, readbackPayloadSha256,
        programmedByUserId: actorUserId, verifiedByUserId: actorUserId,
        programmedAt: now, verifiedAt: now, updatedAt: now,
      } });
      const readbackEvidence = {
        schemaVersion: "ai-grader-nfc-readback-evidence-v1",
        source: "local_pcsc_readback_plus_human_operator",
        cryptographicAttestation: false,
        payloadSha256: readbackPayloadSha256,
        readerCode: boundedCode(input.readerCode, "READER_OK"),
        resultCode: boundedCode(input.resultCode, "WRITE_READBACK_OK"),
        ...(text(input.helperProtocolVersion) && /^[A-Za-z0-9._-]{1,64}$/.test(text(input.helperProtocolVersion))
          ? { helperProtocolVersion: text(input.helperProtocolVersion) }
          : {}),
      };
      await tx.aiGraderNfcProgrammingAttempt.update({ where: { id: attempt.id }, data: {
        state: "verified", readbackEvidence, updatedAt: now,
      } });
      await audit(tx, {
        tagId: verifiedTag.id, attemptId: attempt.id, tenantId: linkage.tenantId, reportId: linkage.reportId,
        action: "local_pcsc_readback_verified", fromStatus: "programming", toStatus: "verified",
        actorUserId, safeDetails: readbackEvidence, createdAt: now,
      });
      const activeTag = await tx.aiGraderNfcTag.update({ where: { id: verifiedTag.id }, data: {
        status: "active", activatedByUserId: actorUserId, activatedAt: now, updatedAt: now,
      } });
      await tx.aiGraderNfcProgrammingAttempt.update({ where: { id: attempt.id }, data: {
        state: "consumed", completionIdempotencyKeyHash: completionHash,
        readbackEvidence, consumedAt: now, updatedAt: now,
      } });
      await audit(tx, {
        tagId: activeTag.id, attemptId: attempt.id, tenantId: linkage.tenantId, reportId: linkage.reportId,
        action: "activate_registered_link", fromStatus: "verified", toStatus: "active", actorUserId,
        safeDetails: { registrationKind: "registered_link", cryptographicAttestation: false }, createdAt: now,
      });
      return safeStatus(activeTag);
    });
    if (isExpiredAttemptResult(result)) {
      throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "NFC programming attempt expired.");
    }
    return result;
  } catch (error) {
    if (error instanceof AiGraderNfcServiceError) throw error;
    if (isRecord(error) && error.code === "P2002") {
      throw nfcError("AI_GRADER_NFC_UNIQUENESS_CONFLICT", 409, "NFC identity conflicts with an existing active registration.");
    }
    throw error;
  }
}

export async function getAiGraderNfcStatus(input: GetAiGraderNfcStatusInput): Promise<AiGraderNfcSafeStatus> {
  const tenantId = required(input.tenantId, "tenantId", 128);
  const reportId = required(input.reportId, "reportId");
  const db = input.dbClient ?? defaultPrisma;
  const report = await db.aiGraderReport?.findUnique?.({
    where: { reportId },
    select: {
      id: true,
      tenantId: true,
      reportId: true,
      publicationStatus: true,
      cardAssetId: true,
      itemId: true,
      labels: { orderBy: { updatedAt: "desc" }, take: 2, select: { id: true, certId: true } },
    },
  });
  if (!report || text(report.tenantId) !== tenantId) return safeStatus(null, reportId);
  const labels = Array.isArray(report.labels) ? report.labels : [];
  const cardAssetId = text(report.cardAssetId);
  const itemId = text(report.itemId);
  const certId = labels.length === 1 ? text(labels[0].certId) : "";
  if (text(report.publicationStatus) !== "published" || !cardAssetId || !itemId || !certId) {
    throw nfcError("AI_GRADER_NFC_CONFIRM_AUTHORITY_MISMATCH", 409, "NFC status requires exact published card and certificate linkage.");
  }
  if (
    (input.cardAssetId && cardAssetId !== text(input.cardAssetId)) ||
    (input.itemId && itemId !== text(input.itemId)) ||
    (input.certId && certId !== text(input.certId))
  ) throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC status linkage does not match the report.");
  const tag = await db.aiGraderNfcTag.findFirst({
    where: { tenantId, reportId }, orderBy: { createdAt: "desc" },
  });
  if (!tag) return {
    ...safeStatus(null, reportId),
    cardAssetId,
    itemId,
    certId,
  };
  if (
    text(tag.aiGraderReportId) !== text(report.id) ||
    text(tag.cardAssetId) !== cardAssetId ||
    text(tag.itemId) !== itemId ||
    text(tag.certId) !== certId
  ) throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC status linkage is contradictory.");
  return safeStatus(tag);
}

function validatePublicTagId(value: unknown) {
  const publicTagId = required(value, "publicTagId", 64);
  if (!PUBLIC_TAG_ID.test(publicTagId)) {
    throw nfcError("AI_GRADER_NFC_INVALID_PUBLIC_TAG_ID", 400, "NFC public tag ID is invalid.");
  }
  return publicTagId;
}

function validateRevocationReason(value: unknown) {
  const reason = required(value, "reason", 240);
  if (reason.length < 8) {
    throw nfcError("AI_GRADER_NFC_REVOCATION_REASON_REQUIRED", 400, "NFC revocation reason must be at least 8 characters.");
  }
  return reason;
}

async function revokeTagTx(tx: DbClient, input: {
  linkage: ExactLinkageInput;
  authority: ConfirmAuthority;
  actorUserId: string;
  publicTagId: string;
  reason: string;
  reasonCode?: string | null;
  idempotencyKey: string;
  now: Date;
}) {
  const tag = await tx.aiGraderNfcTag.findUnique({ where: { publicTagId: input.publicTagId } });
  if (!tag || text(tag.tenantId) !== input.linkage.tenantId || text(tag.reportId) !== input.linkage.reportId) {
    throw nfcError("AI_GRADER_NFC_TAG_NOT_FOUND", 404, "NFC registration was not found for this report.");
  }
  assertTagLinkage(tag, input.linkage);
  if (text(tag.aiGraderReportId) !== input.authority.reportRowId || text(tag.aiGraderLabelId) !== input.authority.labelId) {
    throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal report and label linkage changed.");
  }
  const idempotencyHash = mutationIdempotencyHash("revoke", input.actorUserId, input.idempotencyKey);
  const reasonHash = sha256(input.reason);
  if (tag.status === "revoked") {
    const prior = await tx.aiGraderNfcAuditEvent.findFirst({
      where: { tagId: tag.id, action: "revoke" },
      orderBy: { createdAt: "desc" },
      select: { safeDetails: true },
    });
    const details = record(prior?.safeDetails);
    if (text(details.idempotencyHash) === idempotencyHash && text(details.reasonHash) === reasonHash) {
      return tag;
    }
    throw nfcError("AI_GRADER_NFC_ALREADY_REVOKED", 409, "NFC registration is already revoked.");
  }
  if (![...OPEN_STATUSES, "error"].includes(tag.status)) {
    throw nfcError("AI_GRADER_NFC_STATE_CONTRADICTION", 409, "NFC registration cannot transition to revoked.");
  }
  await tx.aiGraderNfcProgrammingAttempt.updateMany({
    where: { tagId: tag.id, state: { in: [...ACTIVE_ATTEMPT_STATES] } },
    data: { state: "failed", failureCode: "AI_GRADER_NFC_REVOKED", updatedAt: input.now },
  });
  const revoked = await tx.aiGraderNfcTag.update({
    where: { id: tag.id },
    data: {
      status: "revoked",
      revokedByUserId: input.actorUserId,
      revokedAt: input.now,
      revocationReason: input.reason,
      errorCode: null,
      updatedAt: input.now,
    },
  });
  await audit(tx, {
    tagId: tag.id,
    tenantId: input.linkage.tenantId,
    reportId: input.linkage.reportId,
    action: "revoke",
    fromStatus: asTagStatus(tag.status),
    toStatus: "revoked",
    actorUserId: input.actorUserId,
    reasonCode: input.reasonCode ?? "AI_GRADER_NFC_OPERATOR_REVOKED",
    safeDetails: { idempotencyHash, reasonHash, replacementRequiredForNewTag: true },
    createdAt: input.now,
  });
  return revoked;
}

export async function revokeAiGraderNfcTag(input: RevokeAiGraderNfcTagInput): Promise<AiGraderNfcSafeStatus> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const publicTagId = validatePublicTagId(input.publicTagId);
  const reason = validateRevocationReason(input.reason);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  return transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: false });
    return safeStatus(await revokeTagTx(tx, {
      linkage,
      authority,
      actorUserId,
      publicTagId,
      reason,
      reasonCode: input.reasonCode,
      idempotencyKey,
      now,
    }));
  });
}

export async function replaceAiGraderNfcTag(input: ReplaceAiGraderNfcTagInput): Promise<AiGraderNfcProgrammingInitResult> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const replacedPublicTagId = validatePublicTagId(input.replacedPublicTagId);
  const revocationReason = validateRevocationReason(input.revocationReason);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const tokenSecret = validateTokenSecret(input.tokenSecret);
  const ttlMs = attemptTtl(input.attemptTtlMs);
  const now = input.now ?? new Date();
  const result = await transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
    await revokeTagTx(tx, {
      linkage,
      authority,
      actorUserId,
      publicTagId: replacedPublicTagId,
      reason: revocationReason,
      reasonCode: input.revocationReasonCode ?? "AI_GRADER_NFC_REPLACED",
      idempotencyKey,
      now,
    });
    return createProgrammingAttemptTx(tx, {
      linkage,
      authority,
      actorUserId,
      idempotencyKey,
      tokenSecret,
      ttlMs,
      now,
      operatorNote: input.operatorNote,
    });
  });
  if (isExpiredAttemptResult(result)) {
    throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "NFC programming attempt expired.");
  }
  return result;
}
