import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from "crypto";
import { Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "./client";
import {
  canonicalAiGraderPublishAuthorityJson,
  parseAiGraderPublishAuthorityRecord,
  type AiGraderPublishAuthorityRecord,
} from "./aiGraderProductionService";

export const AI_GRADER_NFC_PUBLIC_ORIGIN = "https://collect.tenkings.co" as const;
export const AI_GRADER_NFC_NDEF_PAYLOAD_VERSION = 1 as const;
export const AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET_ENV = "AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET" as const;
export const AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_ENV = "AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_JSON" as const;
export const AI_GRADER_NFC_PROGRAMMING_ENABLED_ENV = "AI_GRADER_NFC_PROGRAMMING_ENABLED" as const;
export const AI_GRADER_NFC_MANUAL_IOS_ENABLED_ENV = "AI_GRADER_NFC_MANUAL_IOS_ENABLED" as const;
export const AI_GRADER_NFC_FEIJU_PROFILE_VERSION = "feiju_iso_dep_ios_static_v1" as const;
export const AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE = "ios_read_only_status_observed" as const;
export const AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION = "tenkings-ai-grader-nfc-loopback-v2" as const;
export const AI_GRADER_NFC_ATTESTATION_ALGORITHM = "ecdsa-p256-sha256-p1363" as const;
export const AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION = "ai-grader-nfc-helper-attestation-v1" as const;
export const AI_GRADER_NFC_DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

const PUBLIC_TAG_ID = /^[A-Za-z0-9_-]{32}$/;
const ATTEMPT_ID = /^nfc_attempt_[A-Za-z0-9_-]{43}$/;
const MANUAL_IOS_ATTEMPT_ID = /^nfc_ios_attempt_[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ATTESTATION_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const ATTESTATION_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const OBSERVED_AT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SAFE_TENANT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_CODE = /^[A-Z0-9_]{1,80}$/;
const OPEN_STATUSES = ["reserved", "programming", "verified", "active"] as const;
const ACTIVE_ATTEMPT_STATES = ["initialized", "writing"] as const;
const ACTIVE_MANUAL_IOS_ATTEMPT_STATES = [
  "awaiting_prelock_tap",
  "awaiting_lock_confirmation",
  "awaiting_postlock_tap",
  "ready_to_complete",
] as const;
const ATTESTATION_CLOCK_SKEW_MS = 2 * 60 * 1000;
const WORKSTATION_ALLOWLIST_MAX_BYTES = 16 * 1024;
const WORKSTATION_ALLOWLIST_MAX_ENTRIES = 8;
const WORKSTATION_ALLOWLIST_ENTRY_FIELDS = ["algorithm", "publicSpkiDerBase64", "tenantId"] as const;
const REPLACEMENT_AUTHORIZATION = Symbol("ai-grader-nfc-replacement-authorization");

export type AiGraderNfcChipTypeValue = "NTAG215" | "NTAG424_DNA" | "FEIJU_PROPRIETARY_ISODEP";
export type AiGraderNfcSecurityModeValue = "static_url_v1" | "ntag424_sun_v1" | "manual_ios_locked_static_url_v1";
export type AiGraderNfcTagStatusValue = "missing" | "reserved" | "programming" | "verified" | "active" | "revoked" | "error";
export type AiGraderNfcRegistrationKind = "registered_link" | "cryptographically_verified" | "not_active";

export type AiGraderNfcSecurityStrategyDescriptor = {
  chipType: AiGraderNfcChipTypeValue;
  securityMode: AiGraderNfcSecurityModeValue;
  implemented: boolean;
  registrationKind: "registered_link" | null;
  cryptographicVerificationAvailable: boolean;
  consumerWriteProtection?: boolean;
  cryptographicTagAuthentication?: false;
  clonableStaticUrl?: true;
  workstationOperationalAttestation?: boolean;
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
  if (chipType === "FEIJU_PROPRIETARY_ISODEP" && securityMode === "manual_ios_locked_static_url_v1") {
    return {
      chipType,
      securityMode,
      implemented: true,
      registrationKind: "registered_link",
      cryptographicVerificationAvailable: false,
      consumerWriteProtection: true,
      cryptographicTagAuthentication: false,
      clonableStaticUrl: true,
      workstationOperationalAttestation: false,
    };
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
type ProgrammingRuntimeInput = {
  tokenSecret?: string;
  workstationPublicKeysJson?: string;
  programmingEnabled?: boolean;
};

export type AiGraderNfcOperationalAttestationInput = {
  schemaVersion: typeof AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION;
  workstationKeyId: string;
  algorithm: typeof AI_GRADER_NFC_ATTESTATION_ALGORITHM;
  attestationChallenge: string;
  observedAt: string;
  signature: string;
};

export type AiGraderNfcOperationalAttestationStatementInput = {
  attemptId: string;
  attestationChallenge: string;
  publicTagId: string;
  normalizedUrl: string;
  uidFingerprintSha256: string;
  readbackPayloadSha256: string;
  readerResultCode: string;
  helperProtocolVersion: string;
  observedAt: string;
};

export type AiGraderNfcWorkstationPublicKey = {
  keyId: string;
  tenantId: string;
  algorithm: typeof AI_GRADER_NFC_ATTESTATION_ALGORITHM;
  publicKey: KeyObject;
};

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
  manualIosAttempt?: AiGraderNfcManualIosSafeEvidence;
};

export type InitAiGraderNfcProgrammingInput = ExactLinkageInput & ActorInput & ProgrammingRuntimeInput & {
  idempotencyKey: string;
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
  attestationChallenge?: string;
};
export type CompleteAiGraderNfcProgrammingInput = ExactLinkageInput & ActorInput & ProgrammingRuntimeInput & {
  attemptId: string;
  attemptToken: string;
  publicTagId: string;
  uidFingerprintSha256: string;
  normalizedNdefUrl: string;
  readbackPayloadSha256: string;
  chipType: AiGraderNfcChipTypeValue;
  securityMode: AiGraderNfcSecurityModeValue;
  idempotencyKey: string;
  readerResultCode: string;
  helperProtocolVersion: string;
  operationalAttestation: AiGraderNfcOperationalAttestationInput;
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

export type AiGraderNfcManualIosAttemptStateValue =
  | "awaiting_prelock_tap"
  | "awaiting_lock_confirmation"
  | "awaiting_postlock_tap"
  | "ready_to_complete"
  | "failed"
  | "expired"
  | "consumed";

export type AiGraderNfcManualIosSafeEvidence = {
  attemptId: string;
  state: AiGraderNfcManualIosAttemptStateValue;
  profileVersion: typeof AI_GRADER_NFC_FEIJU_PROFILE_VERSION;
  qualificationProfile: typeof AI_GRADER_NFC_FEIJU_PROFILE_VERSION;
  attemptExpiresAt: string;
  preLockTapObserved: boolean;
  lockStatusConfirmed: boolean;
  postLockTapObserved: boolean;
  writeProtectionEvidence?: typeof AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE;
  workstationOperationalAttestation: false;
  cryptographicTagAuthentication: false;
};

export type InitAiGraderNfcManualIosInput = ExactLinkageInput & ActorInput & {
  idempotencyKey: string;
  attemptTtlMs?: number;
  operatorNote?: string | null;
  manualIosEnabled?: boolean;
  programmingEnabled?: boolean;
  dbClient?: DbClient;
  now?: Date;
};

export type AiGraderNfcManualIosInitResult = AiGraderNfcSafeStatus & {
  attemptId?: string;
  attemptExpiresAt?: string;
  expectedNdefUrl?: string;
  expectedPayloadSha256?: string;
  manualIosAttempt?: AiGraderNfcManualIosSafeEvidence;
};

export type ConfirmAiGraderNfcManualIosLockInput = ExactLinkageInput & ActorInput & {
  attemptId: string;
  publicTagId: string;
  writableNoConfirmed: true;
  manualIosEnabled?: boolean;
  programmingEnabled?: boolean;
  dbClient?: DbClient;
  now?: Date;
};

export type CompleteAiGraderNfcManualIosInput = ExactLinkageInput & ActorInput & {
  attemptId: string;
  publicTagId: string;
  normalizedNdefUrl: string;
  idempotencyKey: string;
  manualIosEnabled?: boolean;
  programmingEnabled?: boolean;
  dbClient?: DbClient;
  now?: Date;
};

export type ReplaceAiGraderNfcManualIosInput = InitAiGraderNfcManualIosInput & {
  replacedPublicTagId: string;
  revocationReason: string;
  revocationReasonCode?: string | null;
};

export type ObserveAiGraderNfcManualIosTapResult =
  | { state: "not_applicable" }
  | { state: "setup_verification"; stage: "pre_lock" | "lock_confirmation" | "post_lock" | "ready_to_complete" };
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
function sha256(value: string | Buffer) {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value, "utf8");
  else hash.update(value);
  return hash.digest("hex");
}
function safeEqualHex(left: string, right: string) {
  return SHA256.test(left) && SHA256.test(right) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function workstationConfigurationError() {
  return nfcError(
    "AI_GRADER_NFC_WORKSTATION_ATTESTATION_UNAVAILABLE",
    503,
    "NFC workstation operational attestation is not configured.",
  );
}

function strictStandardBase64(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 || !STANDARD_BASE64.test(value)) {
    throw workstationConfigurationError();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < 64 || decoded.length > 512 || decoded.toString("base64") !== value) {
    throw workstationConfigurationError();
  }
  return decoded;
}

export function parseAiGraderNfcWorkstationPublicKeys(rawJson: unknown): Map<string, AiGraderNfcWorkstationPublicKey> {
  const raw = typeof rawJson === "string" ? rawJson : "";
  if (!raw.trim()) return new Map();
  if (Buffer.byteLength(raw, "utf8") > WORKSTATION_ALLOWLIST_MAX_BYTES) {
    throw workstationConfigurationError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw workstationConfigurationError();
  }
  if (!isRecord(parsed)) throw workstationConfigurationError();
  const keyIds = Object.keys(parsed);
  if (keyIds.length > WORKSTATION_ALLOWLIST_MAX_ENTRIES) throw workstationConfigurationError();

  // JSON.parse otherwise silently accepts duplicate properties. Valid key IDs
  // cannot be escaped and must occur exactly once as top-level property names.
  const rawKeyIds = Array.from(raw.matchAll(/"([a-f0-9]{64})"\s*:/g), (match) => match[1]);
  if (rawKeyIds.length !== keyIds.length || new Set(rawKeyIds).size !== rawKeyIds.length) {
    throw workstationConfigurationError();
  }
  // Required entry property names must also be literal and occur exactly once
  // per entry. JSON.parse would otherwise silently keep only the final duplicate.
  for (const field of WORKSTATION_ALLOWLIST_ENTRY_FIELDS) {
    const occurrences = Array.from(raw.matchAll(new RegExp(`"${field}"\\s*:`, "g"))).length;
    if (occurrences !== keyIds.length) throw workstationConfigurationError();
  }

  const result = new Map<string, AiGraderNfcWorkstationPublicKey>();
  for (const keyId of keyIds) {
    if (!SHA256.test(keyId) || result.has(keyId)) throw workstationConfigurationError();
    const entry = parsed[keyId];
    if (!isRecord(entry)) throw workstationConfigurationError();
    const fields = Object.keys(entry).sort();
    if (fields.join("\n") !== [...WORKSTATION_ALLOWLIST_ENTRY_FIELDS].sort().join("\n")) {
      throw workstationConfigurationError();
    }
    const tenantId = typeof entry.tenantId === "string" ? entry.tenantId : "";
    if (!SAFE_TENANT_ID.test(tenantId)) throw workstationConfigurationError();
    if (entry.algorithm !== AI_GRADER_NFC_ATTESTATION_ALGORITHM) throw workstationConfigurationError();
    const der = strictStandardBase64(entry.publicSpkiDerBase64);
    if (sha256(der) !== keyId) throw workstationConfigurationError();
    let publicKey: KeyObject;
    try {
      publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
      const details = publicKey.asymmetricKeyDetails;
      const exported = Buffer.from(publicKey.export({ format: "der", type: "spki" }));
      if (
        publicKey.asymmetricKeyType !== "ec" ||
        details?.namedCurve !== "prime256v1" ||
        !exported.equals(der)
      ) {
        throw workstationConfigurationError();
      }
    } catch {
      throw workstationConfigurationError();
    }
    result.set(keyId, {
      keyId,
      tenantId,
      algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
      publicKey,
    });
  }
  return result;
}

export function getAiGraderNfcWorkstationKeyReadiness(rawJson: unknown, tenantId: string) {
  try {
    const normalizedTenantId = text(tenantId);
    if (!normalizedTenantId) return { configured: false, keyCount: 0 };
    const keys = parseAiGraderNfcWorkstationPublicKeys(rawJson);
    const keyCount = Array.from(keys.values()).filter((entry) => entry.tenantId === normalizedTenantId).length;
    return { configured: keyCount > 0, keyCount };
  } catch {
    return { configured: false, keyCount: 0 };
  }
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
  const source = value === undefined ? process.env[AI_GRADER_NFC_ATTEMPT_TOKEN_SECRET_ENV] : value;
  const secret = text(source);
  if (Buffer.byteLength(secret, "utf8") < 32) throw nfcError("AI_GRADER_NFC_TOKEN_SECRET_UNAVAILABLE", 503, "NFC programming token service is not configured.");
  return secret;
}
function resolveProgrammingRuntime(input: ProgrammingRuntimeInput, tenantId: string) {
  const enabled = input.programmingEnabled === undefined
    ? process.env[AI_GRADER_NFC_PROGRAMMING_ENABLED_ENV] === "true"
    : input.programmingEnabled === true;
  if (!enabled) {
    throw nfcError("AI_GRADER_NFC_PROGRAMMING_DISABLED", 503, "NFC programming is disabled.");
  }
  const tokenSecret = validateTokenSecret(input.tokenSecret);
  const rawKeys = input.workstationPublicKeysJson === undefined
    ? process.env[AI_GRADER_NFC_WORKSTATION_PUBLIC_KEYS_ENV]
    : input.workstationPublicKeysJson;
  const workstationKeys = parseAiGraderNfcWorkstationPublicKeys(rawKeys);
  if (!Array.from(workstationKeys.values()).some((entry) => entry.tenantId === tenantId)) {
    throw workstationConfigurationError();
  }
  return { tokenSecret, workstationKeys };
}
function resolveManualIosRuntime(input: { manualIosEnabled?: boolean; programmingEnabled?: boolean }) {
  const programmingEnabled = input.programmingEnabled === undefined
    ? process.env[AI_GRADER_NFC_PROGRAMMING_ENABLED_ENV] === "true"
    : input.programmingEnabled === true;
  if (!programmingEnabled) {
    throw nfcError("AI_GRADER_NFC_PROGRAMMING_DISABLED", 503, "NFC programming is disabled.");
  }
  const manualIosEnabled = input.manualIosEnabled === undefined
    ? process.env[AI_GRADER_NFC_MANUAL_IOS_ENABLED_ENV] === "true"
    : input.manualIosEnabled === true;
  if (!manualIosEnabled) {
    throw nfcError("AI_GRADER_NFC_MANUAL_IOS_DISABLED", 503, "The Feiju iPhone-assisted NFC workflow is disabled.");
  }
}
function attemptTtl(value: unknown) {
  const ttl = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : AI_GRADER_NFC_DEFAULT_ATTEMPT_TTL_MS;
  if (ttl < 60_000 || ttl > 30 * 60_000) throw nfcError("AI_GRADER_NFC_INVALID_ATTEMPT_TTL", 400, "NFC attempt lifetime is outside the allowed range.");
  return ttl;
}

function strictBase64url(value: unknown, pattern: RegExp, decodedLength: number, code: string) {
  const normalized = typeof value === "string" ? value : "";
  if (!pattern.test(normalized)) throw nfcError(code, 400, "NFC workstation operational attestation is invalid.");
  const decoded = Buffer.from(normalized, "base64url");
  if (decoded.length !== decodedLength || decoded.toString("base64url") !== normalized) {
    throw nfcError(code, 400, "NFC workstation operational attestation is invalid.");
  }
  return { normalized, decoded };
}

function validateObservedAt(value: unknown) {
  const observedAt = typeof value === "string" ? value : "";
  const parsed = OBSERVED_AT_UTC.test(observedAt) ? new Date(observedAt) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString() !== observedAt) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_TIME_INVALID", 400, "NFC workstation attestation time is invalid.");
  }
  return { observedAt, parsed };
}

function validateReaderResultCode(value: unknown) {
  if (value !== "write_verified_pcsc_readback" && value !== "already_programmed_exact") {
    throw nfcError("AI_GRADER_NFC_READER_RESULT_REJECTED", 400, "NFC helper readback result is not accepted.");
  }
  return value;
}

function validateHelperProtocolVersion(value: unknown) {
  if (value !== AI_GRADER_NFC_EXPECTED_HELPER_PROTOCOL_VERSION) {
    throw nfcError("AI_GRADER_NFC_HELPER_PROTOCOL_REJECTED", 409, "NFC helper protocol version is not accepted.");
  }
  return value;
}

function validateOperationalAttestation(value: unknown): AiGraderNfcOperationalAttestationInput {
  if (!isRecord(value)) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_INVALID", 400, "NFC workstation operational attestation is required.");
  }
  const fields = Object.keys(value).sort();
  if (
    fields.join("\n") !==
    ["algorithm", "attestationChallenge", "observedAt", "schemaVersion", "signature", "workstationKeyId"].join("\n")
  ) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_INVALID", 400, "NFC workstation operational attestation is invalid.");
  }
  if (
    value.schemaVersion !== AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION ||
    value.algorithm !== AI_GRADER_NFC_ATTESTATION_ALGORITHM
  ) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_CONTRACT_REJECTED", 400, "NFC workstation attestation contract is not accepted.");
  }
  const workstationKeyId = typeof value.workstationKeyId === "string" ? value.workstationKeyId : "";
  if (!SHA256.test(workstationKeyId)) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_INVALID", 400, "NFC workstation operational attestation is invalid.");
  }
  const attestationChallenge = strictBase64url(
    value.attestationChallenge,
    ATTESTATION_CHALLENGE,
    32,
    "AI_GRADER_NFC_ATTESTATION_INVALID",
  ).normalized;
  const signature = strictBase64url(
    value.signature,
    ATTESTATION_SIGNATURE,
    64,
    "AI_GRADER_NFC_ATTESTATION_SIGNATURE_INVALID",
  ).normalized;
  const observedAt = validateObservedAt(value.observedAt).observedAt;
  return {
    schemaVersion: AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
    workstationKeyId,
    algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
    attestationChallenge,
    observedAt,
    signature,
  };
}

export function buildAiGraderNfcOperationalAttestationStatement(
  input: AiGraderNfcOperationalAttestationStatementInput,
) {
  const attemptId = text(input.attemptId);
  const publicTagId = text(input.publicTagId);
  const uidFingerprintSha256 = text(input.uidFingerprintSha256).toLowerCase();
  const readbackPayloadSha256 = text(input.readbackPayloadSha256).toLowerCase();
  if (!ATTEMPT_ID.test(attemptId) || !PUBLIC_TAG_ID.test(publicTagId)) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_INVALID", 400, "NFC workstation operational attestation is invalid.");
  }
  const attestationChallenge = strictBase64url(
    input.attestationChallenge,
    ATTESTATION_CHALLENGE,
    32,
    "AI_GRADER_NFC_ATTESTATION_INVALID",
  ).normalized;
  if (!SHA256.test(uidFingerprintSha256) || !SHA256.test(readbackPayloadSha256)) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_INVALID", 400, "NFC workstation operational attestation is invalid.");
  }
  const normalizedUrl = required(input.normalizedUrl, "normalizedUrl", 512);
  const readerResultCode = validateReaderResultCode(input.readerResultCode);
  const helperProtocolVersion = validateHelperProtocolVersion(input.helperProtocolVersion);
  const observedAt = validateObservedAt(input.observedAt).observedAt;
  return [
    AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
    attemptId,
    attestationChallenge,
    publicTagId,
    normalizedUrl,
    uidFingerprintSha256,
    readbackPayloadSha256,
    readerResultCode,
    helperProtocolVersion,
    observedAt,
  ].join("\n");
}
function safeMetadata(operatorNote?: string | null) {
  const note = text(operatorNote);
  return {
    schemaVersion: "ai-grader-nfc-safe-metadata-v1",
    workflow: "dedicated_nfc_workstation",
    evidenceSemantics: "workstation_signed_pcsc_readback_not_tag_authentication",
    workstationOperationalAttestationRequired: true,
    cryptographicTagAuthentication: false,
    ...(note ? { operatorNote: note.slice(0, 240) } : {}),
  };
}
function safeManualIosMetadata(operatorNote?: string | null) {
  const note = text(operatorNote);
  return {
    schemaVersion: "ai-grader-nfc-safe-metadata-v1",
    workflow: "manual_ios_locked_static_url_v1",
    qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
    evidenceSemantics: "consumer_ios_write_protection_not_tag_authentication",
    workstationOperationalAttestationRequired: false,
    cryptographicTagAuthentication: false,
    clonableStaticUrl: true,
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
  const id = `nfc_attempt_${random(32).toString("base64url")}`;
  if (!ATTEMPT_ID.test(id)) throw nfcError("AI_GRADER_NFC_RANDOM_ID_FAILED", 500, "NFC attempt identity generation failed.");
  return id;
}
function generateManualIosAttemptId(random: (size: number) => Buffer = randomBytes) {
  const id = `nfc_ios_attempt_${random(32).toString("base64url")}`;
  if (!MANUAL_IOS_ATTEMPT_ID.test(id)) throw nfcError("AI_GRADER_NFC_RANDOM_ID_FAILED", 500, "NFC manual attempt identity generation failed.");
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
function deriveAttestationChallenge(secret: string, attemptId: string) {
  return createHmac("sha256", secret)
    .update(`ai-grader-nfc-attestation-challenge-v1\n${attemptId}`, "utf8")
    .digest("base64url");
}
function attemptIdempotencyHash(actorUserId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-attempt-v1\n${actorUserId}\n${idempotencyKey}`);
}
function completionIdempotencyHash(actorUserId: string, attemptId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-complete-v1\n${actorUserId}\n${attemptId}\n${idempotencyKey}`);
}
function manualIosAttemptIdempotencyHash(actorUserId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-manual-ios-attempt-v1\n${actorUserId}\n${idempotencyKey}`);
}
function manualIosCompletionIdempotencyHash(actorUserId: string, attemptId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-manual-ios-complete-v1\n${actorUserId}\n${attemptId}\n${idempotencyKey}`);
}
function mutationIdempotencyHash(action: string, actorUserId: string, idempotencyKey: string) {
  return sha256(`ai-grader-nfc-${action}-v1\n${actorUserId}\n${idempotencyKey}`);
}
function replacementRequestHash(input: {
  linkage: ExactLinkageInput;
  actorUserId: string;
  publicTagId: string;
  reason: string;
  idempotencyKey: string;
}) {
  return sha256([
    "ai-grader-nfc-replacement-request-v1",
    input.linkage.tenantId,
    input.linkage.reportId,
    input.linkage.cardAssetId,
    input.linkage.itemId,
    input.linkage.certId,
    input.actorUserId,
    input.publicTagId,
    sha256(input.reason),
    input.idempotencyKey,
  ].join("\n"));
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
function assertManualIosStrategy(chipType: unknown, securityMode: unknown) {
  if (chipType !== "FEIJU_PROPRIETARY_ISODEP" || securityMode !== "manual_ios_locked_static_url_v1") {
    throw nfcError("AI_GRADER_NFC_STRATEGY_NOT_IMPLEMENTED", 409, "This NFC registration belongs to a different workflow profile.");
  }
  return describeAiGraderNfcSecurityStrategy("FEIJU_PROPRIETARY_ISODEP", "manual_ios_locked_static_url_v1");
}
function safeManualIosEvidence(attempt: any): AiGraderNfcManualIosSafeEvidence | undefined {
  if (!attempt || !MANUAL_IOS_ATTEMPT_ID.test(text(attempt.id))) return undefined;
  const state = text(attempt.state) as AiGraderNfcManualIosAttemptStateValue;
  if (![...ACTIVE_MANUAL_IOS_ATTEMPT_STATES, "failed", "expired", "consumed"].includes(state as any)) return undefined;
  const expiresAt = iso(attempt.expiresAt);
  if (!expiresAt || attempt.profileVersion !== AI_GRADER_NFC_FEIJU_PROFILE_VERSION || attempt.qualificationProfile !== AI_GRADER_NFC_FEIJU_PROFILE_VERSION) return undefined;
  return {
    attemptId: text(attempt.id),
    state,
    profileVersion: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
    qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
    attemptExpiresAt: expiresAt,
    preLockTapObserved: Boolean(attempt.preLockTapObservedAt),
    lockStatusConfirmed: Boolean(attempt.lockStatusConfirmedAt),
    postLockTapObserved: Boolean(attempt.postLockTapObservedAt),
    ...(attempt.writeProtectionEvidence === AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE
      ? { writeProtectionEvidence: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE }
      : {}),
    workstationOperationalAttestation: false,
    cryptographicTagAuthentication: false,
  };
}
function safeStatus(tag: any, fallbackReportId = ""): AiGraderNfcSafeStatus {
  if (!tag) return { status: "missing", reportId: fallbackReportId, registrationKind: "not_active", cryptographicallyVerified: false };
  const status = asTagStatus(tag.status);
  const strategy = describeAiGraderNfcSecurityStrategy(tag.chipType, tag.securityMode);
  const manualIosAttempt = Array.isArray(tag.manualIosAttempts)
    ? safeManualIosEvidence(tag.manualIosAttempts[0])
    : safeManualIosEvidence(tag.manualIosAttempt);
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
    ...(manualIosAttempt ? { manualIosAttempt } : {}),
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
  // Prisma 5 cannot deserialize PostgreSQL's `void` lock result. Selecting a
  // constant from the locking function preserves transaction-scoped blocking.
  await tx.$queryRaw`
    SELECT 1 AS "lockAcquired"
    FROM pg_advisory_xact_lock(hashtext('ai-grader-report-lifecycle'), hashtext(${reportId}))
  `;
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
async function expireTimedOutAttemptsTx(
  tx: DbClient,
  input: { tag: any; now: Date; actorUserId: string },
) {
  const expiredAttempts = await tx.aiGraderNfcProgrammingAttempt.findMany({
    where: {
      tagId: input.tag.id,
      state: { in: [...ACTIVE_ATTEMPT_STATES] },
      expiresAt: { lte: input.now },
    },
    orderBy: { requestedAt: "asc" },
  });
  const expiredAttemptIds = new Set<string>();
  for (const attempt of expiredAttempts) {
    expiredAttemptIds.add(text(attempt.id));
    await tx.aiGraderNfcProgrammingAttempt.update({
      where: { id: attempt.id },
      data: {
        state: "expired",
        failureCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED",
        completionIdempotencyKeyHash: null,
        completedWorkstationKeyId: null,
        readbackEvidence: Prisma.DbNull,
        consumedAt: null,
        updatedAt: input.now,
      },
    });
    await audit(tx, {
      tagId: input.tag.id,
      attemptId: attempt.id,
      tenantId: text(input.tag.tenantId),
      reportId: text(input.tag.reportId),
      action: "programming_attempt_expired",
      actorUserId: input.actorUserId,
      reasonCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED",
      safeDetails: {
        expiresAt: iso(attempt.expiresAt),
        programmingTagRecoveryPending: true,
      },
      createdAt: input.now,
    });
  }
  if (!expiredAttemptIds.size) return { tag: input.tag, expiredAttemptIds };

  const remaining = await tx.aiGraderNfcProgrammingAttempt.findFirst({
    where: {
      tagId: input.tag.id,
      state: { in: [...ACTIVE_ATTEMPT_STATES] },
      expiresAt: { gt: input.now },
    },
    orderBy: { requestedAt: "desc" },
  });
  if (!remaining && input.tag.status === "programming") {
    const recoveredTag = await tx.aiGraderNfcTag.update({
      where: { id: input.tag.id },
      data: { status: "reserved", errorCode: null, updatedAt: input.now },
    });
    await audit(tx, {
      tagId: input.tag.id,
      tenantId: text(input.tag.tenantId),
      reportId: text(input.tag.reportId),
      action: "programming_attempts_expired_recover_reservation",
      fromStatus: "programming",
      toStatus: "reserved",
      actorUserId: input.actorUserId,
      reasonCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED",
      safeDetails: { expiredAttemptCount: expiredAttemptIds.size },
      createdAt: input.now,
    });
    return { tag: recoveredTag, expiredAttemptIds };
  }
  return { tag: input.tag, expiredAttemptIds };
}

async function createProgrammingAttemptTx(tx: DbClient, input: {
  linkage: ExactLinkageInput; authority: ConfirmAuthority; actorUserId: string; idempotencyKey: string;
  tokenSecret: string; ttlMs: number; now: Date; operatorNote?: string | null;
  replacementAuthorization?: typeof REPLACEMENT_AUTHORIZATION;
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
    if (
      text(existingAttempt.tag.aiGraderReportId) !== input.authority.reportRowId ||
      text(existingAttempt.tag.aiGraderLabelId) !== input.authority.labelId
    ) {
      throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal report and label linkage changed.");
    }
    if (existingAttempt.state === "consumed") return { ...safeStatus(existingAttempt.tag), attemptId: existingAttempt.id };
    if (existingAttempt.state === "expired") return EXPIRED_ATTEMPT_RESULT;
    const expiry = await expireTimedOutAttemptsTx(tx, {
      tag: existingAttempt.tag,
      now: input.now,
      actorUserId: input.actorUserId,
    });
    if (expiry.expiredAttemptIds.has(existingAttempt.id)) return EXPIRED_ATTEMPT_RESULT;
    if (!ACTIVE_ATTEMPT_STATES.includes(existingAttempt.state)) throw nfcError("AI_GRADER_NFC_ATTEMPT_TERMINAL", 409, "NFC programming attempt is no longer usable.");
    const attemptToken = deriveAttemptToken(input.tokenSecret, existingAttempt.id);
    const attestationChallenge = deriveAttestationChallenge(input.tokenSecret, existingAttempt.id);
    if (!safeEqualHex(sha256(attemptToken), text(existingAttempt.tokenHash))) throw nfcError("AI_GRADER_NFC_TOKEN_STATE_INVALID", 503, "NFC token state is invalid.");
    if (
      !safeEqualHex(sha256(attestationChallenge), text(existingAttempt.attestationChallengeHash)) ||
      existingAttempt.expectedAttestationAlgorithm !== AI_GRADER_NFC_ATTESTATION_ALGORITHM
    ) {
      throw nfcError("AI_GRADER_NFC_ATTESTATION_STATE_INVALID", 503, "NFC workstation attestation state is invalid.");
    }
    return {
      ...safeStatus(existingAttempt.tag), attemptId: existingAttempt.id, attemptToken,
      attemptExpiresAt: iso(existingAttempt.expiresAt) ?? undefined,
      expectedNdefUrl: buildAiGraderNfcTagUrl(existingAttempt.tag.publicTagId),
      expectedPayloadSha256: text(existingAttempt.tag.expectedPayloadSha256),
      attestationChallenge,
    };
  }
  let tag = await tx.aiGraderNfcTag.findFirst({
    where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
  if (tag?.status === "active") return safeStatus(tag);
  if (tag) {
    assertTagLinkage(tag, input.linkage);
    tag = (await expireTimedOutAttemptsTx(tx, {
      tag,
      now: input.now,
      actorUserId: input.actorUserId,
    })).tag;
    const liveAttempt = await tx.aiGraderNfcProgrammingAttempt.findFirst({
      where: { tagId: tag.id, state: { in: [...ACTIVE_ATTEMPT_STATES] }, expiresAt: { gt: input.now } },
      orderBy: { requestedAt: "desc" },
    });
    if (liveAttempt) throw nfcError("AI_GRADER_NFC_ATTEMPT_IN_PROGRESS", 409, "Another NFC programming attempt is already in progress.");
  } else {
    const priorRevoked = await tx.aiGraderNfcTag.findFirst({
      where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: "revoked" },
      orderBy: { createdAt: "desc" },
    });
    if (priorRevoked && input.replacementAuthorization !== REPLACEMENT_AUTHORIZATION) {
      throw nfcError(
        "AI_GRADER_NFC_REPLACEMENT_REQUIRED",
        409,
        "A revoked NFC registration requires the authorized replacement workflow.",
      );
    }
    tag = await tx.aiGraderNfcTag.findFirst({
      where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: "error" },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!tag) {
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
  const attestationChallenge = deriveAttestationChallenge(input.tokenSecret, attemptId);
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  const attempt = await tx.aiGraderNfcProgrammingAttempt.create({ data: {
    id: attemptId, tagId: tag.id, tenantId: input.linkage.tenantId, reportId: input.linkage.reportId,
    cardAssetId: input.linkage.cardAssetId, itemId: input.linkage.itemId, certId: input.linkage.certId,
    requestedByUserId: input.actorUserId, idempotencyKeyHash, tokenHash: sha256(attemptToken),
    attestationChallengeHash: sha256(attestationChallenge),
    expectedAttestationAlgorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
    state: "initialized", requestedAt: input.now, expiresAt, createdAt: input.now, updatedAt: input.now,
  } });
  const fromStatus = asTagStatus(tag.status);
  tag = await tx.aiGraderNfcTag.update({
    where: { id: tag.id }, data: { status: "programming", errorCode: null, updatedAt: input.now },
  });
  await audit(tx, {
    tagId: tag.id, attemptId: attempt.id, tenantId: input.linkage.tenantId, reportId: input.linkage.reportId,
    action: "programming_attempt_initialized", fromStatus, toStatus: "programming", actorUserId: input.actorUserId,
    safeDetails: {
      expiresAt: expiresAt.toISOString(),
      expectedAttestationAlgorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
      workstationOperationalAttestationRequired: true,
      cryptographicTagAuthentication: false,
    },
    createdAt: input.now,
  });
  return {
    ...safeStatus(tag), attemptId, attemptToken, attemptExpiresAt: expiresAt.toISOString(),
    expectedNdefUrl: buildAiGraderNfcTagUrl(tag.publicTagId), expectedPayloadSha256: text(tag.expectedPayloadSha256),
    attestationChallenge,
  };
}

export async function initAiGraderNfcProgramming(input: InitAiGraderNfcProgrammingInput) {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const { tokenSecret } = resolveProgrammingRuntime(input, linkage.tenantId);
  const ttlMs = attemptTtl(input.attemptTtlMs);
  const now = input.now ?? new Date();
  const result = await transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
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

function verifyOperationalAttestationForAttempt(input: {
  attempt: any;
  workstationKeys: Map<string, AiGraderNfcWorkstationPublicKey>;
  linkage: ExactLinkageInput;
  publicTagId: string;
  normalizedUrl: string;
  uidFingerprintSha256: string;
  readbackPayloadSha256: string;
  readerResultCode: string;
  helperProtocolVersion: string;
  operationalAttestation: AiGraderNfcOperationalAttestationInput;
  now: Date;
}) {
  const attestation = input.operationalAttestation;
  if (
    input.attempt.expectedAttestationAlgorithm !== AI_GRADER_NFC_ATTESTATION_ALGORITHM ||
    !safeEqualHex(
      sha256(attestation.attestationChallenge),
      text(input.attempt.attestationChallengeHash),
    )
  ) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_CHALLENGE_REJECTED", 403, "NFC workstation attestation was rejected.");
  }
  const workstationKey = input.workstationKeys.get(attestation.workstationKeyId);
  if (!workstationKey || workstationKey.tenantId !== input.linkage.tenantId) {
    throw nfcError("AI_GRADER_NFC_WORKSTATION_KEY_REJECTED", 403, "NFC workstation attestation was rejected.");
  }
  const requestedAt = date(input.attempt.requestedAt);
  const expiresAt = date(input.attempt.expiresAt);
  const observed = validateObservedAt(attestation.observedAt).parsed;
  if (
    !requestedAt ||
    !expiresAt ||
    observed.getTime() < requestedAt.getTime() - ATTESTATION_CLOCK_SKEW_MS ||
    observed.getTime() > expiresAt.getTime() + ATTESTATION_CLOCK_SKEW_MS ||
    observed.getTime() > input.now.getTime() + ATTESTATION_CLOCK_SKEW_MS
  ) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_TIME_REJECTED", 409, "NFC workstation attestation time is outside the attempt window.");
  }
  const statement = buildAiGraderNfcOperationalAttestationStatement({
    attemptId: input.attempt.id,
    attestationChallenge: attestation.attestationChallenge,
    publicTagId: input.publicTagId,
    normalizedUrl: input.normalizedUrl,
    uidFingerprintSha256: input.uidFingerprintSha256,
    readbackPayloadSha256: input.readbackPayloadSha256,
    readerResultCode: input.readerResultCode,
    helperProtocolVersion: input.helperProtocolVersion,
    observedAt: attestation.observedAt,
  });
  const signature = strictBase64url(
    attestation.signature,
    ATTESTATION_SIGNATURE,
    64,
    "AI_GRADER_NFC_ATTESTATION_SIGNATURE_INVALID",
  ).decoded;
  let valid = false;
  try {
    valid = verifySignature(
      "sha256",
      Buffer.from(statement, "utf8"),
      { key: workstationKey.publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw nfcError("AI_GRADER_NFC_ATTESTATION_SIGNATURE_REJECTED", 403, "NFC workstation attestation was rejected.");
  }
  return {
    schemaVersion: AI_GRADER_NFC_ATTESTATION_SCHEMA_VERSION,
    workstationKeyId: attestation.workstationKeyId,
    algorithm: AI_GRADER_NFC_ATTESTATION_ALGORITHM,
    statementSha256: sha256(statement),
    signature: attestation.signature,
    observedAt: attestation.observedAt,
    helperProtocolVersion: input.helperProtocolVersion,
    readerResultCode: input.readerResultCode,
    cryptographicTagAuthentication: false,
    workstationOperationalAttestation: true,
  };
}

function exactReadbackEvidenceMatches(value: unknown, expected: JsonRecord) {
  if (!isRecord(value)) return false;
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(value).sort();
  return (
    expectedKeys.join("\n") === actualKeys.join("\n") &&
    expectedKeys.every((key) => value[key] === expected[key])
  );
}

export async function completeAiGraderNfcProgramming(
  input: CompleteAiGraderNfcProgrammingInput,
): Promise<AiGraderNfcSafeStatus> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const { workstationKeys } = resolveProgrammingRuntime(input, linkage.tenantId);
  const actorUserId = validateActor(input.requestedByUserId);
  const attemptId = required(input.attemptId, "attemptId", 64);
  if (!ATTEMPT_ID.test(attemptId)) throw nfcError("AI_GRADER_NFC_INVALID_ATTEMPT", 400, "NFC attempt ID is invalid.");
  const attemptToken = required(input.attemptToken, "attemptToken", 256);
  const publicTagId = validatePublicTagId(input.publicTagId);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const completionHash = completionIdempotencyHash(actorUserId, attemptId, idempotencyKey);
  const uidFingerprintSha256 = text(input.uidFingerprintSha256).toLowerCase();
  const readbackPayloadSha256 = text(input.readbackPayloadSha256).toLowerCase();
  if (!SHA256.test(uidFingerprintSha256) || !SHA256.test(readbackPayloadSha256)) {
    throw nfcError("AI_GRADER_NFC_INVALID_FINGERPRINT", 400, "NFC readback fingerprints are invalid.");
  }
  assertStaticStrategy(input.chipType, input.securityMode);
  const normalizedNdefUrl = required(input.normalizedNdefUrl, "normalizedNdefUrl", 512);
  const readerResultCode = validateReaderResultCode(input.readerResultCode);
  const helperProtocolVersion = validateHelperProtocolVersion(input.helperProtocolVersion);
  const operationalAttestation = validateOperationalAttestation(input.operationalAttestation);
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
      if (attempt.state === "expired") return EXPIRED_ATTEMPT_RESULT;
      const expectedUrl = buildAiGraderNfcTagUrl(attempt.tag.publicTagId);
      const expectedDigest = sha256(expectedUrl);
      if (
        publicTagId !== text(attempt.tag.publicTagId) ||
        normalizedNdefUrl !== expectedUrl ||
        readbackPayloadSha256 !== expectedDigest ||
        text(attempt.tag.expectedPayloadSha256) !== expectedDigest
      ) {
        throw nfcError("AI_GRADER_NFC_READBACK_MISMATCH", 409, "NFC readback does not match the reserved Ten Kings URL.");
      }
      const readbackEvidence = verifyOperationalAttestationForAttempt({
        attempt,
        workstationKeys,
        linkage,
        publicTagId,
        normalizedUrl: normalizedNdefUrl,
        uidFingerprintSha256,
        readbackPayloadSha256,
        readerResultCode,
        helperProtocolVersion,
        operationalAttestation,
        now,
      });
      if (attempt.state === "consumed") {
        if (
          text(attempt.completionIdempotencyKeyHash) === completionHash &&
          text(attempt.completedWorkstationKeyId) === operationalAttestation.workstationKeyId &&
          exactReadbackEvidenceMatches(attempt.readbackEvidence, readbackEvidence) &&
          attempt.tag.status === "active" &&
          text(attempt.tag.uidFingerprintSha256) === uidFingerprintSha256 &&
          text(attempt.tag.readbackPayloadSha256) === readbackPayloadSha256 &&
          normalizedNdefUrl === expectedUrl
        ) return safeStatus(attempt.tag);
        throw nfcError("AI_GRADER_NFC_TOKEN_REPLAY", 409, "NFC programming token was already consumed.");
      }
      const expiry = await expireTimedOutAttemptsTx(tx, {
        tag: attempt.tag,
        now,
        actorUserId,
      });
      if (expiry.expiredAttemptIds.has(attempt.id)) return EXPIRED_ATTEMPT_RESULT;
      if (!ACTIVE_ATTEMPT_STATES.includes(attempt.state)) throw nfcError("AI_GRADER_NFC_ATTEMPT_TERMINAL", 409, "NFC programming attempt is no longer usable.");
      if (attempt.tag.status !== "programming") throw nfcError("AI_GRADER_NFC_STATE_CONTRADICTION", 409, "NFC tag is not in programming state.");
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
      await tx.aiGraderNfcProgrammingAttempt.update({ where: { id: attempt.id }, data: {
        state: "verified",
        completionIdempotencyKeyHash: completionHash,
        completedWorkstationKeyId: operationalAttestation.workstationKeyId,
        readbackEvidence,
        updatedAt: now,
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
        state: "consumed",
        completionIdempotencyKeyHash: completionHash,
        completedWorkstationKeyId: operationalAttestation.workstationKeyId,
        readbackEvidence,
        consumedAt: now,
        updatedAt: now,
      } });
      await audit(tx, {
        tagId: activeTag.id, attemptId: attempt.id, tenantId: linkage.tenantId, reportId: linkage.reportId,
        action: "activate_registered_link", fromStatus: "verified", toStatus: "active", actorUserId,
        safeDetails: {
          registrationKind: "registered_link",
          workstationOperationalAttestation: true,
          cryptographicTagAuthentication: false,
          statementSha256: readbackEvidence.statementSha256,
        },
        createdAt: now,
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
    where: { tenantId, reportId },
    orderBy: { createdAt: "desc" },
    include: {
      manualIosAttempts: { orderBy: { requestedAt: "desc" }, take: 1 },
    },
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
  replacementRequestHash?: string | null;
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
  const mutationAction = input.replacementRequestHash ? "replace" : "revoke";
  const idempotencyHash = mutationIdempotencyHash(mutationAction, input.actorUserId, input.idempotencyKey);
  const reasonHash = sha256(input.reason);
  if (tag.status === "revoked") {
    const priorRevoke = await tx.aiGraderNfcAuditEvent.findFirst({
      where: { tagId: tag.id, action: "revoke" },
      orderBy: { createdAt: "desc" },
      select: { safeDetails: true },
    });
    const priorRevokeDetails = record(priorRevoke?.safeDetails);
    const matchesExactRequest = (details: JsonRecord) => (
      text(details.idempotencyHash) === idempotencyHash &&
      text(details.reasonHash) === reasonHash &&
      text(details.replacementRequestHash) === text(input.replacementRequestHash)
    );
    if (input.replacementRequestHash) {
      const priorAuthorization = await tx.aiGraderNfcAuditEvent.findFirst({
        where: { tagId: tag.id, action: "replacement_authorized" },
        orderBy: { createdAt: "desc" },
        select: { safeDetails: true },
      });
      if (priorAuthorization) {
        if (matchesExactRequest(record(priorAuthorization.safeDetails))) return tag;
        throw nfcError(
          "AI_GRADER_NFC_REPLACEMENT_ALREADY_AUTHORIZED",
          409,
          "A different replacement request was already authorized for this NFC registration.",
        );
      }
      if (priorRevokeDetails.replacementAuthorized === true) {
        if (matchesExactRequest(priorRevokeDetails)) return tag;
        throw nfcError(
          "AI_GRADER_NFC_REPLACEMENT_ALREADY_AUTHORIZED",
          409,
          "A different replacement request was already authorized for this NFC registration.",
        );
      }
      await audit(tx, {
        tagId: tag.id,
        tenantId: input.linkage.tenantId,
        reportId: input.linkage.reportId,
        action: "replacement_authorized",
        fromStatus: "revoked",
        toStatus: "revoked",
        actorUserId: input.actorUserId,
        reasonCode: input.reasonCode ?? "AI_GRADER_NFC_REPLACED",
        safeDetails: {
          schemaVersion: "ai-grader-nfc-replacement-authorization-v1",
          idempotencyHash,
          reasonHash,
          replacementRequestHash: input.replacementRequestHash,
          replacedPublicTagIdHash: sha256(input.publicTagId),
          priorRevocationPreserved: true,
        },
        createdAt: input.now,
      });
      return tag;
    }
    if (matchesExactRequest(priorRevokeDetails)) return tag;
    throw nfcError("AI_GRADER_NFC_ALREADY_REVOKED", 409, "NFC registration is already revoked.");
  }
  if (![...OPEN_STATUSES, "error"].includes(tag.status)) {
    throw nfcError("AI_GRADER_NFC_STATE_CONTRADICTION", 409, "NFC registration cannot transition to revoked.");
  }
  await tx.aiGraderNfcProgrammingAttempt.updateMany({
    where: { tagId: tag.id, state: { in: [...ACTIVE_ATTEMPT_STATES] } },
    data: { state: "failed", failureCode: "AI_GRADER_NFC_REVOKED", updatedAt: input.now },
  });
  await tx.aiGraderNfcManualIosAttempt.updateMany({
    where: { tagId: tag.id, state: { in: [...ACTIVE_MANUAL_IOS_ATTEMPT_STATES] } },
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
    safeDetails: {
      idempotencyHash,
      reasonHash,
      replacementRequiredForNewTag: !input.replacementRequestHash,
      replacementAuthorized: Boolean(input.replacementRequestHash),
      ...(input.replacementRequestHash ? { replacementRequestHash: input.replacementRequestHash } : {}),
    },
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
  const { tokenSecret } = resolveProgrammingRuntime(input, linkage.tenantId);
  const ttlMs = attemptTtl(input.attemptTtlMs);
  const now = input.now ?? new Date();
  const exactReplacementRequestHash = replacementRequestHash({
    linkage,
    actorUserId,
    publicTagId: replacedPublicTagId,
    reason: revocationReason,
    idempotencyKey,
  });
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
      replacementRequestHash: exactReplacementRequestHash,
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
      replacementAuthorization: REPLACEMENT_AUTHORIZATION,
    });
  });
  if (isExpiredAttemptResult(result)) {
    throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "NFC programming attempt expired.");
  }
  return result;
}
function manualIosResult(tag: any, attempt?: any): AiGraderNfcManualIosInitResult {
  const manualIosAttempt = safeManualIosEvidence(attempt);
  return {
    ...safeStatus({ ...tag, manualIosAttempt: attempt }),
    ...(attempt ? {
      attemptId: text(attempt.id),
      attemptExpiresAt: iso(attempt.expiresAt) ?? undefined,
      expectedNdefUrl: buildAiGraderNfcTagUrl(tag.publicTagId),
      expectedPayloadSha256: text(tag.expectedPayloadSha256),
    } : {}),
    ...(manualIosAttempt ? { manualIosAttempt } : {}),
  };
}

async function expireTimedOutManualIosAttemptsTx(
  tx: DbClient,
  input: { tag: any; now: Date; actorUserId: string },
) {
  const expiredAttempts = await tx.aiGraderNfcManualIosAttempt.findMany({
    where: {
      tagId: input.tag.id,
      state: { in: [...ACTIVE_MANUAL_IOS_ATTEMPT_STATES] },
      expiresAt: { lte: input.now },
    },
    orderBy: { requestedAt: "asc" },
  });
  const expiredAttemptIds = new Set<string>();
  for (const attempt of expiredAttempts) {
    expiredAttemptIds.add(text(attempt.id));
    await tx.aiGraderNfcManualIosAttempt.update({
      where: { id: attempt.id },
      data: { state: "expired", failureCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED", updatedAt: input.now },
    });
    await audit(tx, {
      tagId: input.tag.id,
      tenantId: text(input.tag.tenantId),
      reportId: text(input.tag.reportId),
      action: "manual_ios_attempt_expired",
      actorUserId: input.actorUserId,
      reasonCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED",
      safeDetails: {
        expiresAt: iso(attempt.expiresAt),
        qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
        programmingTagRecoveryPending: true,
      },
      createdAt: input.now,
    });
  }
  if (!expiredAttemptIds.size) return { tag: input.tag, expiredAttemptIds };

  const remaining = await tx.aiGraderNfcManualIosAttempt.findFirst({
    where: {
      tagId: input.tag.id,
      state: { in: [...ACTIVE_MANUAL_IOS_ATTEMPT_STATES] },
      expiresAt: { gt: input.now },
    },
    orderBy: { requestedAt: "desc" },
  });
  if (!remaining && input.tag.status === "programming") {
    const recoveredTag = await tx.aiGraderNfcTag.update({
      where: { id: input.tag.id },
      data: { status: "reserved", errorCode: null, updatedAt: input.now },
    });
    await audit(tx, {
      tagId: input.tag.id,
      tenantId: text(input.tag.tenantId),
      reportId: text(input.tag.reportId),
      action: "manual_ios_attempts_expired_recover_reservation",
      fromStatus: "programming",
      toStatus: "reserved",
      actorUserId: input.actorUserId,
      reasonCode: "AI_GRADER_NFC_ATTEMPT_EXPIRED",
      safeDetails: {
        expiredAttemptCount: expiredAttemptIds.size,
        qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
      },
      createdAt: input.now,
    });
    return { tag: recoveredTag, expiredAttemptIds };
  }
  return { tag: input.tag, expiredAttemptIds };
}

async function createManualIosAttemptTx(tx: DbClient, input: {
  linkage: ExactLinkageInput;
  authority: ConfirmAuthority;
  actorUserId: string;
  idempotencyKey: string;
  ttlMs: number;
  now: Date;
  operatorNote?: string | null;
  replacementAuthorization?: typeof REPLACEMENT_AUTHORIZATION;
}): Promise<AiGraderNfcManualIosInitResult | ExpiredAttemptResult> {
  const idempotencyKeyHash = manualIosAttemptIdempotencyHash(input.actorUserId, input.idempotencyKey);
  const existingAttempt = await tx.aiGraderNfcManualIosAttempt.findUnique({
    where: { tenantId_requestedByUserId_idempotencyKeyHash: {
      tenantId: input.linkage.tenantId,
      requestedByUserId: input.actorUserId,
      idempotencyKeyHash,
    } },
    include: { tag: true },
  });
  if (existingAttempt) {
    assertAttemptLinkage(existingAttempt, input.linkage, input.actorUserId);
    assertTagLinkage(existingAttempt.tag, input.linkage);
    assertManualIosStrategy(existingAttempt.tag.chipType, existingAttempt.tag.securityMode);
    if (
      text(existingAttempt.tag.aiGraderReportId) !== input.authority.reportRowId ||
      text(existingAttempt.tag.aiGraderLabelId) !== input.authority.labelId
    ) throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal report and label linkage changed.");
    if (existingAttempt.state === "consumed") return manualIosResult(existingAttempt.tag, existingAttempt);
    if (existingAttempt.state === "expired") return EXPIRED_ATTEMPT_RESULT;
    const expiry = await expireTimedOutManualIosAttemptsTx(tx, {
      tag: existingAttempt.tag,
      now: input.now,
      actorUserId: input.actorUserId,
    });
    if (expiry.expiredAttemptIds.has(existingAttempt.id)) return EXPIRED_ATTEMPT_RESULT;
    if (!ACTIVE_MANUAL_IOS_ATTEMPT_STATES.includes(existingAttempt.state)) {
      throw nfcError("AI_GRADER_NFC_ATTEMPT_TERMINAL", 409, "The Feiju iPhone-assisted attempt is no longer usable.");
    }
    return manualIosResult(existingAttempt.tag, existingAttempt);
  }

  let tag = await tx.aiGraderNfcTag.findFirst({
    where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
  if (tag?.status === "active") return safeStatus(tag);
  if (tag) {
    assertTagLinkage(tag, input.linkage);
    assertManualIosStrategy(tag.chipType, tag.securityMode);
    tag = (await expireTimedOutManualIosAttemptsTx(tx, {
      tag,
      now: input.now,
      actorUserId: input.actorUserId,
    })).tag;
    const liveAttempt = await tx.aiGraderNfcManualIosAttempt.findFirst({
      where: { tagId: tag.id, state: { in: [...ACTIVE_MANUAL_IOS_ATTEMPT_STATES] }, expiresAt: { gt: input.now } },
      orderBy: { requestedAt: "desc" },
    });
    if (liveAttempt) throw nfcError("AI_GRADER_NFC_ATTEMPT_IN_PROGRESS", 409, "Another Feiju iPhone-assisted attempt is already in progress.");
  } else {
    const priorRevoked = await tx.aiGraderNfcTag.findFirst({
      where: { tenantId: input.linkage.tenantId, reportId: input.linkage.reportId, status: "revoked" },
      orderBy: { createdAt: "desc" },
    });
    if (priorRevoked && input.replacementAuthorization !== REPLACEMENT_AUTHORIZATION) {
      throw nfcError("AI_GRADER_NFC_REPLACEMENT_REQUIRED", 409, "A revoked NFC registration requires the authorized replacement workflow.");
    }
  }
  if (!tag) {
    const publicTagId = await uniquePublicTagId(tx);
    const expectedUrl = buildAiGraderNfcTagUrl(publicTagId);
    tag = await tx.aiGraderNfcTag.create({ data: {
      tenantId: input.linkage.tenantId,
      publicTagId,
      chipType: "FEIJU_PROPRIETARY_ISODEP",
      securityMode: "manual_ios_locked_static_url_v1",
      status: "reserved",
      ndefPayloadVersion: AI_GRADER_NFC_NDEF_PAYLOAD_VERSION,
      expectedPayloadSha256: sha256(expectedUrl),
      aiGraderReportId: input.authority.reportRowId,
      reportId: input.linkage.reportId,
      cardAssetId: input.linkage.cardAssetId,
      itemId: input.linkage.itemId,
      aiGraderLabelId: input.authority.labelId,
      certId: input.linkage.certId,
      createdByUserId: input.actorUserId,
      metadata: safeManualIosMetadata(input.operatorNote),
      createdAt: input.now,
      updatedAt: input.now,
    } });
    await audit(tx, {
      tagId: tag.id,
      tenantId: input.linkage.tenantId,
      reportId: input.linkage.reportId,
      action: "reserve",
      toStatus: "reserved",
      actorUserId: input.actorUserId,
      safeDetails: {
        chipType: "FEIJU_PROPRIETARY_ISODEP",
        securityMode: "manual_ios_locked_static_url_v1",
        qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
        workstationOperationalAttestation: false,
        cryptographicTagAuthentication: false,
      },
      createdAt: input.now,
    });
  }
  assertManualIosStrategy(tag.chipType, tag.securityMode);
  if (text(tag.aiGraderReportId) !== input.authority.reportRowId || text(tag.aiGraderLabelId) !== input.authority.labelId) {
    throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal report and label linkage changed.");
  }
  const attemptId = generateManualIosAttemptId();
  const expiresAt = new Date(input.now.getTime() + input.ttlMs);
  const attempt = await tx.aiGraderNfcManualIosAttempt.create({ data: {
    id: attemptId,
    tagId: tag.id,
    tenantId: input.linkage.tenantId,
    reportId: input.linkage.reportId,
    cardAssetId: input.linkage.cardAssetId,
    itemId: input.linkage.itemId,
    certId: input.linkage.certId,
    requestedByUserId: input.actorUserId,
    idempotencyKeyHash,
    state: "awaiting_prelock_tap",
    profileVersion: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
    qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
    expectedPayloadSha256: text(tag.expectedPayloadSha256),
    workstationOperationalAttestation: false,
    cryptographicTagAuthentication: false,
    requestedAt: input.now,
    expiresAt,
    createdAt: input.now,
    updatedAt: input.now,
  } });
  const fromStatus = asTagStatus(tag.status);
  tag = await tx.aiGraderNfcTag.update({
    where: { id: tag.id },
    data: { status: "programming", errorCode: null, updatedAt: input.now },
  });
  await audit(tx, {
    tagId: tag.id,
    tenantId: input.linkage.tenantId,
    reportId: input.linkage.reportId,
    action: "manual_ios_attempt_initialized",
    fromStatus,
    toStatus: "programming",
    actorUserId: input.actorUserId,
    safeDetails: {
      qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
      expiresAt: expiresAt.toISOString(),
      workstationOperationalAttestation: false,
      cryptographicTagAuthentication: false,
    },
    createdAt: input.now,
  });
  return manualIosResult(tag, attempt);
}

export async function initAiGraderNfcManualIos(input: InitAiGraderNfcManualIosInput) {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  resolveManualIosRuntime(input);
  const ttlMs = attemptTtl(input.attemptTtlMs);
  const now = input.now ?? new Date();
  const result = await transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
    return createManualIosAttemptTx(tx, {
      linkage,
      authority,
      actorUserId,
      idempotencyKey,
      ttlMs,
      now,
      operatorNote: input.operatorNote,
    });
  });
  if (isExpiredAttemptResult(result)) throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "The Feiju iPhone-assisted attempt expired.");
  return result;
}

export async function observeAiGraderNfcManualIosTap(input: {
  publicTagId: string;
  manualIosEnabled?: boolean;
  programmingEnabled?: boolean;
  dbClient?: DbClient;
  now?: Date;
}): Promise<ObserveAiGraderNfcManualIosTapResult> {
  const publicTagId = validatePublicTagId(input.publicTagId);
  const programmingEnabled = input.programmingEnabled === undefined
    ? process.env[AI_GRADER_NFC_PROGRAMMING_ENABLED_ENV] === "true"
    : input.programmingEnabled === true;
  const manualIosEnabled = input.manualIosEnabled === undefined
    ? process.env[AI_GRADER_NFC_MANUAL_IOS_ENABLED_ENV] === "true"
    : input.manualIosEnabled === true;
  if (!programmingEnabled || !manualIosEnabled) return { state: "not_applicable" };
  const now = input.now ?? new Date();
  return transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    let tag = await tx.aiGraderNfcTag.findUnique({ where: { publicTagId } });
    if (!tag || tag.status !== "programming" || tag.chipType !== "FEIJU_PROPRIETARY_ISODEP" || tag.securityMode !== "manual_ios_locked_static_url_v1") {
      return { state: "not_applicable" } as const;
    }
    await acquireReportLock(tx, text(tag.reportId));
    tag = await tx.aiGraderNfcTag.findUnique({ where: { publicTagId } });
    if (!tag || tag.status !== "programming") return { state: "not_applicable" } as const;
    const attempt = await tx.aiGraderNfcManualIosAttempt.findFirst({
      where: { tagId: tag.id, state: { in: [...ACTIVE_MANUAL_IOS_ATTEMPT_STATES] } },
      orderBy: { requestedAt: "desc" },
    });
    if (!attempt) return { state: "not_applicable" } as const;
    if ((await expireTimedOutManualIosAttemptsTx(tx, { tag, now, actorUserId: "public_nfc_tap" })).expiredAttemptIds.has(attempt.id)) {
      return { state: "not_applicable" } as const;
    }
    if (attempt.state === "awaiting_prelock_tap") {
      await tx.aiGraderNfcManualIosAttempt.update({
        where: { id: attempt.id },
        data: { state: "awaiting_lock_confirmation", preLockTapObservedAt: now, updatedAt: now },
      });
      await audit(tx, {
        tagId: tag.id,
        tenantId: text(tag.tenantId),
        reportId: text(tag.reportId),
        action: "manual_ios_prelock_tap_observed",
        fromStatus: "programming",
        toStatus: "programming",
        actorUserId: "public_nfc_tap",
        safeDetails: { qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION },
        createdAt: now,
      });
      return { state: "setup_verification", stage: "pre_lock" } as const;
    }
    if (attempt.state === "awaiting_postlock_tap") {
      await tx.aiGraderNfcManualIosAttempt.update({
        where: { id: attempt.id },
        data: { state: "ready_to_complete", postLockTapObservedAt: now, updatedAt: now },
      });
      await audit(tx, {
        tagId: tag.id,
        tenantId: text(tag.tenantId),
        reportId: text(tag.reportId),
        action: "manual_ios_postlock_tap_observed",
        fromStatus: "programming",
        toStatus: "programming",
        actorUserId: "public_nfc_tap",
        safeDetails: {
          qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
          writeProtectionEvidence: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE,
        },
        createdAt: now,
      });
      return { state: "setup_verification", stage: "post_lock" } as const;
    }
    if (attempt.state === "awaiting_lock_confirmation") {
      return { state: "setup_verification", stage: "lock_confirmation" } as const;
    }
    return { state: "setup_verification", stage: "ready_to_complete" } as const;
  });
}

export async function confirmAiGraderNfcManualIosLock(
  input: ConfirmAiGraderNfcManualIosLockInput,
): Promise<AiGraderNfcSafeStatus> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  if (input.writableNoConfirmed !== true) {
    throw nfcError("AI_GRADER_NFC_WRITE_PROTECTION_CONFIRMATION_REQUIRED", 400, "Confirm that NFC Tools reports Writable: No.");
  }
  resolveManualIosRuntime(input);
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const attemptId = required(input.attemptId, "attemptId", 80);
  if (!MANUAL_IOS_ATTEMPT_ID.test(attemptId)) throw nfcError("AI_GRADER_NFC_INVALID_ATTEMPT", 400, "The Feiju iPhone-assisted attempt ID is invalid.");
  const publicTagId = validatePublicTagId(input.publicTagId);
  const now = input.now ?? new Date();
  return transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
    const attempt = await tx.aiGraderNfcManualIosAttempt.findUnique({ where: { id: attemptId }, include: { tag: true } });
    if (!attempt) throw nfcError("AI_GRADER_NFC_ATTEMPT_NOT_FOUND", 404, "The Feiju iPhone-assisted attempt was not found.");
    assertAttemptLinkage(attempt, linkage, actorUserId);
    assertTagLinkage(attempt.tag, linkage);
    assertManualIosStrategy(attempt.tag.chipType, attempt.tag.securityMode);
    if (text(attempt.tag.publicTagId) !== publicTagId || text(attempt.tag.aiGraderReportId) !== authority.reportRowId || text(attempt.tag.aiGraderLabelId) !== authority.labelId) {
      throw nfcError("AI_GRADER_NFC_LINKAGE_MISMATCH", 409, "NFC internal linkage changed.");
    }
    if (attempt.state === "consumed") return safeStatus(attempt.tag);
    if ((await expireTimedOutManualIosAttemptsTx(tx, { tag: attempt.tag, now, actorUserId })).expiredAttemptIds.has(attempt.id)) {
      throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "The Feiju iPhone-assisted attempt expired.");
    }
    if (attempt.state === "awaiting_prelock_tap") {
      throw nfcError("AI_GRADER_NFC_PRELOCK_TAP_REQUIRED", 409, "The exact URL must be opened once before lock confirmation.");
    }
    if (attempt.state === "awaiting_lock_confirmation") {
      const updated = await tx.aiGraderNfcManualIosAttempt.update({
        where: { id: attempt.id },
        data: {
          state: "awaiting_postlock_tap",
          lockStatusConfirmedAt: now,
          lockStatusConfirmedByUserId: actorUserId,
          writeProtectionEvidence: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE,
          updatedAt: now,
        },
      });
      await audit(tx, {
        tagId: attempt.tag.id,
        tenantId: linkage.tenantId,
        reportId: linkage.reportId,
        action: "manual_ios_write_protection_confirmed",
        fromStatus: "programming",
        toStatus: "programming",
        actorUserId,
        safeDetails: {
          qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
          writeProtectionEvidence: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE,
          workstationOperationalAttestation: false,
          cryptographicTagAuthentication: false,
        },
        createdAt: now,
      });
      return safeStatus({ ...attempt.tag, manualIosAttempt: updated });
    }
    if (["awaiting_postlock_tap", "ready_to_complete"].includes(attempt.state)) {
      return safeStatus({ ...attempt.tag, manualIosAttempt: attempt });
    }
    throw nfcError("AI_GRADER_NFC_ATTEMPT_TERMINAL", 409, "The Feiju iPhone-assisted attempt is no longer usable.");
  });
}

export async function completeAiGraderNfcManualIos(
  input: CompleteAiGraderNfcManualIosInput,
): Promise<AiGraderNfcSafeStatus> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  resolveManualIosRuntime(input);
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const attemptId = required(input.attemptId, "attemptId", 80);
  if (!MANUAL_IOS_ATTEMPT_ID.test(attemptId)) throw nfcError("AI_GRADER_NFC_INVALID_ATTEMPT", 400, "The Feiju iPhone-assisted attempt ID is invalid.");
  const publicTagId = validatePublicTagId(input.publicTagId);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const completionHash = manualIosCompletionIdempotencyHash(actorUserId, attemptId, idempotencyKey);
  const normalizedNdefUrl = required(input.normalizedNdefUrl, "normalizedNdefUrl", 512);
  const now = input.now ?? new Date();
  return transaction(input.dbClient ?? defaultPrisma, async (tx) => {
    await acquireReportLock(tx, linkage.reportId);
    const authority = await loadConfirmAuthority(tx, linkage, { requirePublished: true });
    const attempt = await tx.aiGraderNfcManualIosAttempt.findUnique({ where: { id: attemptId }, include: { tag: true } });
    if (!attempt) throw nfcError("AI_GRADER_NFC_ATTEMPT_NOT_FOUND", 404, "The Feiju iPhone-assisted attempt was not found.");
    assertAttemptLinkage(attempt, linkage, actorUserId);
    assertTagLinkage(attempt.tag, linkage);
    assertManualIosStrategy(attempt.tag.chipType, attempt.tag.securityMode);
    const expectedUrl = buildAiGraderNfcTagUrl(attempt.tag.publicTagId);
    const expectedDigest = sha256(expectedUrl);
    if (
      publicTagId !== text(attempt.tag.publicTagId) ||
      normalizedNdefUrl !== expectedUrl ||
      text(attempt.expectedPayloadSha256) !== expectedDigest ||
      text(attempt.tag.expectedPayloadSha256) !== expectedDigest ||
      text(attempt.tag.aiGraderReportId) !== authority.reportRowId ||
      text(attempt.tag.aiGraderLabelId) !== authority.labelId
    ) throw nfcError("AI_GRADER_NFC_READBACK_MISMATCH", 409, "The final iPhone tap does not match the reserved Ten Kings URL.");
    if (attempt.state === "consumed") {
      if (
        text(attempt.completionIdempotencyKeyHash) === completionHash &&
        text(attempt.readbackPayloadSha256) === expectedDigest &&
        attempt.tag.status === "active" &&
        text(attempt.tag.readbackPayloadSha256) === expectedDigest
      ) return safeStatus({ ...attempt.tag, manualIosAttempt: attempt });
      throw nfcError("AI_GRADER_NFC_TOKEN_REPLAY", 409, "The Feiju iPhone-assisted completion was already consumed.");
    }
    if ((await expireTimedOutManualIosAttemptsTx(tx, { tag: attempt.tag, now, actorUserId })).expiredAttemptIds.has(attempt.id)) {
      throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "The Feiju iPhone-assisted attempt expired.");
    }
    if (attempt.state !== "ready_to_complete" || !attempt.preLockTapObservedAt || !attempt.lockStatusConfirmedAt || !attempt.postLockTapObservedAt || attempt.writeProtectionEvidence !== AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE) {
      throw nfcError("AI_GRADER_NFC_MANUAL_IOS_EVIDENCE_INCOMPLETE", 409, "Both exact URL taps and Writable: No confirmation are required before activation.");
    }
    const verifiedTag = await tx.aiGraderNfcTag.update({
      where: { id: attempt.tag.id },
      data: {
        status: "verified",
        uidFingerprintSha256: null,
        readbackPayloadSha256: expectedDigest,
        programmedByUserId: actorUserId,
        verifiedByUserId: actorUserId,
        programmedAt: now,
        verifiedAt: now,
        updatedAt: now,
      },
    });
    await audit(tx, {
      tagId: verifiedTag.id,
      tenantId: linkage.tenantId,
      reportId: linkage.reportId,
      action: "manual_ios_locked_static_url_verified",
      fromStatus: "programming",
      toStatus: "verified",
      actorUserId,
      safeDetails: {
        payloadSha256: expectedDigest,
        qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
        writeProtectionEvidence: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE,
        workstationOperationalAttestation: false,
        cryptographicTagAuthentication: false,
      },
      createdAt: now,
    });
    const activeTag = await tx.aiGraderNfcTag.update({
      where: { id: verifiedTag.id },
      data: { status: "active", activatedByUserId: actorUserId, activatedAt: now, updatedAt: now },
    });
    const consumedAttempt = await tx.aiGraderNfcManualIosAttempt.update({
      where: { id: attempt.id },
      data: {
        state: "consumed",
        completionIdempotencyKeyHash: completionHash,
        readbackPayloadSha256: expectedDigest,
        consumedAt: now,
        updatedAt: now,
      },
    });
    await audit(tx, {
      tagId: activeTag.id,
      tenantId: linkage.tenantId,
      reportId: linkage.reportId,
      action: "activate_registered_link",
      fromStatus: "verified",
      toStatus: "active",
      actorUserId,
      safeDetails: {
        registrationKind: "registered_link",
        publicWording: "Write-protected registered NFC link",
        payloadSha256: expectedDigest,
        qualificationProfile: AI_GRADER_NFC_FEIJU_PROFILE_VERSION,
        writeProtectionEvidence: AI_GRADER_NFC_FEIJU_WRITE_PROTECTION_EVIDENCE,
        workstationOperationalAttestation: false,
        cryptographicTagAuthentication: false,
        clonableStaticUrl: true,
      },
      createdAt: now,
    });
    return safeStatus({ ...activeTag, manualIosAttempt: consumedAttempt });
  });
}

export async function replaceAiGraderNfcManualIos(
  input: ReplaceAiGraderNfcManualIosInput,
): Promise<AiGraderNfcManualIosInitResult> {
  if (rawUidWasSupplied(input)) throw nfcError("AI_GRADER_NFC_RAW_UID_REJECTED", 400, "Raw NFC UID input is not accepted.");
  resolveManualIosRuntime(input);
  const linkage = validateExactLinkage(input);
  const actorUserId = validateActor(input.requestedByUserId);
  const replacedPublicTagId = validatePublicTagId(input.replacedPublicTagId);
  const revocationReason = validateRevocationReason(input.revocationReason);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const ttlMs = attemptTtl(input.attemptTtlMs);
  const now = input.now ?? new Date();
  const exactReplacementRequestHash = replacementRequestHash({
    linkage,
    actorUserId,
    publicTagId: replacedPublicTagId,
    reason: revocationReason,
    idempotencyKey,
  });
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
      replacementRequestHash: exactReplacementRequestHash,
      now,
    });
    return createManualIosAttemptTx(tx, {
      linkage,
      authority,
      actorUserId,
      idempotencyKey,
      ttlMs,
      now,
      operatorNote: input.operatorNote,
      replacementAuthorization: REPLACEMENT_AUTHORIZATION,
    });
  });
  if (isExpiredAttemptResult(result)) throw nfcError("AI_GRADER_NFC_ATTEMPT_EXPIRED", 410, "The Feiju iPhone-assisted attempt expired.");
  return result;
}
