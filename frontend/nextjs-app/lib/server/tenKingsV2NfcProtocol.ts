import {
  createHash,
  createPublicKey,
  randomBytes,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";

export const TEN_KINGS_V2_NFC_JOB_SCHEMA = "ten-kings-v2-nfc-job-v1" as const;
export const TEN_KINGS_V2_NFC_RESULT_SCHEMA = "ten-kings-v2-nfc-result-v1" as const;
export const TEN_KINGS_V2_NFC_ALGORITHM = "ecdsa-p256-sha256-p1363" as const;
export const TEN_KINGS_V2_NFC_JOB_PURPOSE = "program-permanent-card-url" as const;
export const TEN_KINGS_V2_NFC_ORIGIN = "https://collect.tenkings.co" as const;
export const TEN_KINGS_V2_NFC_CHIP_TYPE = "FEIJU_F8215" as const;
export const TEN_KINGS_V2_NFC_SECURITY_MODE = "static_url_v1" as const;
export const TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE = "gototags_manual_start_v1" as const;
export const TEN_KINGS_V2_NFC_READER_MODEL = "ACS_ACR1552U" as const;
export const TEN_KINGS_V2_NFC_ADAPTER_IDENTITY = "gototags_desktop" as const;
export const TEN_KINGS_V2_NFC_ADAPTER_VERSION = "4.37.0.1" as const;
export const TEN_KINGS_V2_NFC_WRITE_PROTECTION_STATE = "permanently_read_only_verified" as const;
export const TEN_KINGS_V2_NFC_READER_RESULT_CODE = "write_locked_verified_gototags_readback" as const;
export const TEN_KINGS_V2_NFC_HELPER_CAPABILITY = "ten-kings-v2-f8215-static-url-v1" as const;
export const TEN_KINGS_V2_NFC_DEFAULT_JOB_TTL_MS = 10 * 60 * 1000;
export const TEN_KINGS_V2_NFC_MAX_JOB_TTL_MS = 15 * 60 * 1000;
export const TEN_KINGS_V2_NFC_MAX_CLOCK_SKEW_MS = 30 * 1000;

const JOB_KEYS = [
  "algorithm",
  "cardId",
  "chipType",
  "expiresAt",
  "issuedAt",
  "nonce",
  "programmingProfile",
  "publicToken",
  "purpose",
  "schemaVersion",
  "securityMode",
  "signature",
  "signingKeyId",
  "url",
] as const;

const UNSIGNED_JOB_KEYS = JOB_KEYS.filter((key) => key !== "signature");

const RESULT_KEYS = [
  "adapterIdentity",
  "adapterVersion",
  "algorithm",
  "cardId",
  "chipType",
  "helperCapability",
  "jobEnvelopeSha256",
  "nonce",
  "observedAt",
  "programmingProfile",
  "publicToken",
  "readbackPayloadSha256",
  "readerModel",
  "readerResultCode",
  "schemaVersion",
  "securityMode",
  "signature",
  "url",
  "workstationKeyId",
  "writeProtectionState",
] as const;

const UNSIGNED_RESULT_KEYS = RESULT_KEYS.filter((key) => key !== "signature");

type StringRecord = Record<string, string>;
export type TenKingsV2NfcTrustedKeys = Readonly<Record<string, KeyObject>>;

export type TenKingsV2NfcUnsignedJob = {
  schemaVersion: typeof TEN_KINGS_V2_NFC_JOB_SCHEMA;
  algorithm: typeof TEN_KINGS_V2_NFC_ALGORITHM;
  signingKeyId: string;
  purpose: typeof TEN_KINGS_V2_NFC_JOB_PURPOSE;
  nonce: string;
  cardId: string;
  publicToken: string;
  url: string;
  chipType: typeof TEN_KINGS_V2_NFC_CHIP_TYPE;
  securityMode: typeof TEN_KINGS_V2_NFC_SECURITY_MODE;
  programmingProfile: typeof TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE;
  issuedAt: string;
  expiresAt: string;
};

export type TenKingsV2NfcSignedJob = TenKingsV2NfcUnsignedJob & { signature: string };

export type TenKingsV2NfcUnsignedResult = {
  schemaVersion: typeof TEN_KINGS_V2_NFC_RESULT_SCHEMA;
  algorithm: typeof TEN_KINGS_V2_NFC_ALGORITHM;
  workstationKeyId: string;
  jobEnvelopeSha256: string;
  nonce: string;
  cardId: string;
  publicToken: string;
  url: string;
  chipType: typeof TEN_KINGS_V2_NFC_CHIP_TYPE;
  securityMode: typeof TEN_KINGS_V2_NFC_SECURITY_MODE;
  programmingProfile: typeof TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE;
  readerModel: typeof TEN_KINGS_V2_NFC_READER_MODEL;
  adapterIdentity: typeof TEN_KINGS_V2_NFC_ADAPTER_IDENTITY;
  adapterVersion: typeof TEN_KINGS_V2_NFC_ADAPTER_VERSION;
  readbackPayloadSha256: string;
  writeProtectionState: typeof TEN_KINGS_V2_NFC_WRITE_PROTECTION_STATE;
  readerResultCode: typeof TEN_KINGS_V2_NFC_READER_RESULT_CODE;
  helperCapability: typeof TEN_KINGS_V2_NFC_HELPER_CAPABILITY;
  observedAt: string;
};

export type TenKingsV2NfcSignedResult = TenKingsV2NfcUnsignedResult & { signature: string };

export class TenKingsV2NfcProtocolError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TenKingsV2NfcProtocolError";
  }
}

function invalid(code: string, message: string): never {
  throw new TenKingsV2NfcProtocolError(code, message);
}

function exactStringRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: string,
  label: string,
): StringRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(code, `${label} must be an exact JSON object.`);
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    return invalid(code, `${label} contains missing or unknown fields.`);
  }
  for (const key of actualKeys) {
    if (typeof record[key] !== "string") return invalid(code, `${label}.${key} must be a string.`);
  }
  return record as StringRecord;
}

function exact(value: string, expected: string, code: string, label: string) {
  if (value !== expected) invalid(code, `${label} is not supported.`);
}

function shaped(value: string, pattern: RegExp, code: string, label: string) {
  if (!pattern.test(value)) invalid(code, `${label} has an invalid shape.`);
  return value;
}

function strictUtcMillis(value: string, code: string, label: string) {
  shaped(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, code, label);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    invalid(code, `${label} is not a canonical UTC timestamp.`);
  }
  return milliseconds;
}

function canonicalBase64Url(value: string, bytes: number, code: string, label: string) {
  shaped(value, /^[A-Za-z0-9_-]+$/, code, label);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    return invalid(code, `${label} is not base64url.`);
  }
  if (decoded.length !== bytes || decoded.toString("base64url") !== value) {
    invalid(code, `${label} is not canonical base64url.`);
  }
  return decoded;
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function publicP256Key(key: KeyObject, code: string) {
  let publicKey: KeyObject;
  try {
    publicKey = key.type === "public" ? key : createPublicKey(key);
  } catch {
    return invalid(code, "The NFC signing key is invalid.");
  }
  if (
    publicKey.asymmetricKeyType !== "ec" ||
    publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    invalid(code, "The NFC signing key must be an ECDSA P-256 key.");
  }
  return publicKey;
}

export function tenKingsV2NfcKeyId(key: KeyObject) {
  const publicKey = publicP256Key(key, "TEN_KINGS_V2_NFC_KEY_INVALID");
  return sha256Hex(publicKey.export({ type: "spki", format: "der" }));
}

function signP1363(statement: string, privateKey: KeyObject) {
  if (privateKey.type !== "private") invalid("TEN_KINGS_V2_NFC_KEY_INVALID", "A private P-256 key is required.");
  publicP256Key(privateKey, "TEN_KINGS_V2_NFC_KEY_INVALID");
  const signature = signBytes("sha256", Buffer.from(statement, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  if (signature.length !== 64) invalid("TEN_KINGS_V2_NFC_SIGNATURE_INVALID", "The NFC signature is not P1363.");
  return signature.toString("base64url");
}

function verifyP1363(statement: string, signature: string, publicKey: KeyObject) {
  const decoded = canonicalBase64Url(
    signature,
    64,
    "TEN_KINGS_V2_NFC_SIGNATURE_INVALID",
    "signature",
  );
  return verifyBytes("sha256", Buffer.from(statement, "utf8"), {
    key: publicP256Key(publicKey, "TEN_KINGS_V2_NFC_KEY_INVALID"),
    dsaEncoding: "ieee-p1363",
  }, decoded);
}

function exactCardUrl(token: string, url: string, code: string) {
  shaped(token, /^tk2c_[A-Za-z0-9_-]{32}$/, code, "publicToken");
  const expected = `${TEN_KINGS_V2_NFC_ORIGIN}/c/${token}`;
  if (url !== expected) invalid(code, "url does not exactly match publicToken.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid(code, "url is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "collect.tenkings.co" ||
    parsed.host !== "collect.tenkings.co" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== `/c/${token}`
  ) {
    invalid(code, "url is not the exact permanent Ten Kings V2 card URL.");
  }
}

function validateUnsignedJob(value: unknown): TenKingsV2NfcUnsignedJob {
  const record = exactStringRecord(
    value,
    UNSIGNED_JOB_KEYS,
    "TEN_KINGS_V2_NFC_JOB_INVALID",
    "NFC job",
  );
  exact(record.schemaVersion, TEN_KINGS_V2_NFC_JOB_SCHEMA, "TEN_KINGS_V2_NFC_JOB_INVALID", "schemaVersion");
  exact(record.algorithm, TEN_KINGS_V2_NFC_ALGORITHM, "TEN_KINGS_V2_NFC_JOB_INVALID", "algorithm");
  shaped(record.signingKeyId, /^[a-f0-9]{64}$/, "TEN_KINGS_V2_NFC_JOB_INVALID", "signingKeyId");
  exact(record.purpose, TEN_KINGS_V2_NFC_JOB_PURPOSE, "TEN_KINGS_V2_NFC_JOB_INVALID", "purpose");
  canonicalBase64Url(record.nonce, 32, "TEN_KINGS_V2_NFC_JOB_INVALID", "nonce");
  shaped(record.cardId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/, "TEN_KINGS_V2_NFC_JOB_INVALID", "cardId");
  exactCardUrl(record.publicToken, record.url, "TEN_KINGS_V2_NFC_JOB_INVALID");
  exact(record.chipType, TEN_KINGS_V2_NFC_CHIP_TYPE, "TEN_KINGS_V2_NFC_JOB_INVALID", "chipType");
  exact(record.securityMode, TEN_KINGS_V2_NFC_SECURITY_MODE, "TEN_KINGS_V2_NFC_JOB_INVALID", "securityMode");
  exact(
    record.programmingProfile,
    TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE,
    "TEN_KINGS_V2_NFC_JOB_INVALID",
    "programmingProfile",
  );
  const issuedAt = strictUtcMillis(record.issuedAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "issuedAt");
  const expiresAt = strictUtcMillis(record.expiresAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "expiresAt");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > TEN_KINGS_V2_NFC_MAX_JOB_TTL_MS) {
    invalid("TEN_KINGS_V2_NFC_JOB_INVALID", "The NFC job lifetime is invalid.");
  }
  return record as TenKingsV2NfcUnsignedJob;
}

export function tenKingsV2NfcJobCanonicalStatement(value: unknown) {
  let unsignedValue = value;
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "signature")) {
    const record = exactStringRecord(value, JOB_KEYS, "TEN_KINGS_V2_NFC_JOB_INVALID", "Signed NFC job");
    unsignedValue = Object.fromEntries(UNSIGNED_JOB_KEYS.map((key) => [key, record[key]]));
  }
  const job = validateUnsignedJob(unsignedValue);
  return [
    job.schemaVersion,
    job.algorithm,
    job.signingKeyId,
    job.purpose,
    job.nonce,
    job.cardId,
    job.publicToken,
    job.url,
    job.chipType,
    job.securityMode,
    job.programmingProfile,
    job.issuedAt,
    job.expiresAt,
  ].join("\n");
}

export function signTenKingsV2NfcJob(value: unknown, privateKey: KeyObject): TenKingsV2NfcSignedJob {
  const job = validateUnsignedJob(value);
  const derivedKeyId = tenKingsV2NfcKeyId(privateKey);
  if (!timingSafeEqual(Buffer.from(derivedKeyId, "ascii"), Buffer.from(job.signingKeyId, "ascii"))) {
    invalid("TEN_KINGS_V2_NFC_KEY_MISMATCH", "signingKeyId does not match the server signing key.");
  }
  return { ...job, signature: signP1363(tenKingsV2NfcJobCanonicalStatement(job), privateKey) };
}

export function issueTenKingsV2NfcJob(input: {
  cardId: string;
  publicToken: string;
  privateKey: KeyObject;
  now?: Date;
  ttlMs?: number;
  nonce?: string;
}) {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? TEN_KINGS_V2_NFC_DEFAULT_JOB_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > TEN_KINGS_V2_NFC_MAX_JOB_TTL_MS) {
    invalid("TEN_KINGS_V2_NFC_JOB_INVALID", "The NFC job TTL is invalid.");
  }
  if (!Number.isFinite(now.getTime())) invalid("TEN_KINGS_V2_NFC_JOB_INVALID", "The NFC job issue time is invalid.");
  const publicToken = input.publicToken;
  const job: TenKingsV2NfcUnsignedJob = {
    schemaVersion: TEN_KINGS_V2_NFC_JOB_SCHEMA,
    algorithm: TEN_KINGS_V2_NFC_ALGORITHM,
    signingKeyId: tenKingsV2NfcKeyId(input.privateKey),
    purpose: TEN_KINGS_V2_NFC_JOB_PURPOSE,
    nonce: input.nonce ?? randomBytes(32).toString("base64url"),
    cardId: input.cardId,
    publicToken,
    url: `${TEN_KINGS_V2_NFC_ORIGIN}/c/${publicToken}`,
    chipType: TEN_KINGS_V2_NFC_CHIP_TYPE,
    securityMode: TEN_KINGS_V2_NFC_SECURITY_MODE,
    programmingProfile: TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  return signTenKingsV2NfcJob(job, input.privateKey);
}

function signedJob(value: unknown): TenKingsV2NfcSignedJob {
  const record = exactStringRecord(value, JOB_KEYS, "TEN_KINGS_V2_NFC_JOB_INVALID", "Signed NFC job");
  const unsigned = Object.fromEntries(UNSIGNED_JOB_KEYS.map((key) => [key, record[key]]));
  const job = validateUnsignedJob(unsigned);
  canonicalBase64Url(record.signature, 64, "TEN_KINGS_V2_NFC_JOB_INVALID", "signature");
  return { ...job, signature: record.signature };
}

export function verifyTenKingsV2NfcJob(value: unknown, trustedKeys: TenKingsV2NfcTrustedKeys) {
  const job = signedJob(value);
  if (!Object.hasOwn(trustedKeys, job.signingKeyId)) {
    invalid("TEN_KINGS_V2_NFC_JOB_KEY_UNTRUSTED", "The NFC job signing key is not trusted.");
  }
  const trustedKey = trustedKeys[job.signingKeyId];
  if (tenKingsV2NfcKeyId(trustedKey) !== job.signingKeyId) {
    invalid("TEN_KINGS_V2_NFC_JOB_KEY_UNTRUSTED", "The NFC job trust entry is mislabeled.");
  }
  if (!verifyP1363(tenKingsV2NfcJobCanonicalStatement(job), job.signature, trustedKey)) {
    invalid("TEN_KINGS_V2_NFC_JOB_SIGNATURE_INVALID", "The NFC job signature is invalid.");
  }
  return job;
}

export function assertTenKingsV2NfcJobMayStart(value: TenKingsV2NfcSignedJob, now = new Date()) {
  const job = signedJob(value);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) invalid("TEN_KINGS_V2_NFC_JOB_TIME_INVALID", "The helper clock is invalid.");
  const issuedAt = strictUtcMillis(job.issuedAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "issuedAt");
  const expiresAt = strictUtcMillis(job.expiresAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "expiresAt");
  if (nowMs < issuedAt - TEN_KINGS_V2_NFC_MAX_CLOCK_SKEW_MS) {
    invalid("TEN_KINGS_V2_NFC_JOB_NOT_YET_VALID", "The NFC job is not valid yet.");
  }
  if (nowMs > expiresAt) invalid("TEN_KINGS_V2_NFC_JOB_EXPIRED", "The NFC job expired before it started.");
  return job;
}

export function tenKingsV2NfcJobEnvelopeSha256(value: TenKingsV2NfcSignedJob) {
  const job = signedJob(value);
  return sha256Hex(`${tenKingsV2NfcJobCanonicalStatement(job)}\n${job.signature}`);
}

function validateUnsignedResult(value: unknown): TenKingsV2NfcUnsignedResult {
  const result = exactStringRecord(
    value,
    UNSIGNED_RESULT_KEYS,
    "TEN_KINGS_V2_NFC_RESULT_INVALID",
    "NFC result",
  );
  exact(result.schemaVersion, TEN_KINGS_V2_NFC_RESULT_SCHEMA, "TEN_KINGS_V2_NFC_RESULT_INVALID", "schemaVersion");
  exact(result.algorithm, TEN_KINGS_V2_NFC_ALGORITHM, "TEN_KINGS_V2_NFC_RESULT_INVALID", "algorithm");
  shaped(result.workstationKeyId, /^[a-f0-9]{64}$/, "TEN_KINGS_V2_NFC_RESULT_INVALID", "workstationKeyId");
  shaped(result.jobEnvelopeSha256, /^[a-f0-9]{64}$/, "TEN_KINGS_V2_NFC_RESULT_INVALID", "jobEnvelopeSha256");
  canonicalBase64Url(result.nonce, 32, "TEN_KINGS_V2_NFC_RESULT_INVALID", "nonce");
  shaped(result.cardId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/, "TEN_KINGS_V2_NFC_RESULT_INVALID", "cardId");
  exactCardUrl(result.publicToken, result.url, "TEN_KINGS_V2_NFC_RESULT_INVALID");
  exact(result.chipType, TEN_KINGS_V2_NFC_CHIP_TYPE, "TEN_KINGS_V2_NFC_RESULT_INVALID", "chipType");
  exact(result.securityMode, TEN_KINGS_V2_NFC_SECURITY_MODE, "TEN_KINGS_V2_NFC_RESULT_INVALID", "securityMode");
  exact(result.programmingProfile, TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE, "TEN_KINGS_V2_NFC_RESULT_INVALID", "programmingProfile");
  exact(result.readerModel, TEN_KINGS_V2_NFC_READER_MODEL, "TEN_KINGS_V2_NFC_RESULT_INVALID", "readerModel");
  exact(result.adapterIdentity, TEN_KINGS_V2_NFC_ADAPTER_IDENTITY, "TEN_KINGS_V2_NFC_RESULT_INVALID", "adapterIdentity");
  exact(result.adapterVersion, TEN_KINGS_V2_NFC_ADAPTER_VERSION, "TEN_KINGS_V2_NFC_RESULT_INVALID", "adapterVersion");
  shaped(result.readbackPayloadSha256, /^[a-f0-9]{64}$/, "TEN_KINGS_V2_NFC_RESULT_INVALID", "readbackPayloadSha256");
  if (result.readbackPayloadSha256 !== sha256Hex(result.url)) {
    invalid("TEN_KINGS_V2_NFC_READBACK_DIGEST_MISMATCH", "readbackPayloadSha256 does not prove the exact signed URL bytes.");
  }
  exact(
    result.writeProtectionState,
    TEN_KINGS_V2_NFC_WRITE_PROTECTION_STATE,
    "TEN_KINGS_V2_NFC_RESULT_INVALID",
    "writeProtectionState",
  );
  exact(result.readerResultCode, TEN_KINGS_V2_NFC_READER_RESULT_CODE, "TEN_KINGS_V2_NFC_RESULT_INVALID", "readerResultCode");
  exact(result.helperCapability, TEN_KINGS_V2_NFC_HELPER_CAPABILITY, "TEN_KINGS_V2_NFC_RESULT_INVALID", "helperCapability");
  strictUtcMillis(result.observedAt, "TEN_KINGS_V2_NFC_RESULT_INVALID", "observedAt");
  return result as TenKingsV2NfcUnsignedResult;
}

export function tenKingsV2NfcResultCanonicalStatement(value: unknown) {
  let unsignedValue = value;
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "signature")) {
    const record = exactStringRecord(value, RESULT_KEYS, "TEN_KINGS_V2_NFC_RESULT_INVALID", "Signed NFC result");
    unsignedValue = Object.fromEntries(UNSIGNED_RESULT_KEYS.map((key) => [key, record[key]]));
  }
  const result = validateUnsignedResult(unsignedValue);
  return [
    result.schemaVersion,
    result.algorithm,
    result.workstationKeyId,
    result.jobEnvelopeSha256,
    result.nonce,
    result.cardId,
    result.publicToken,
    result.url,
    result.chipType,
    result.securityMode,
    result.programmingProfile,
    result.readerModel,
    result.adapterIdentity,
    result.adapterVersion,
    result.readbackPayloadSha256,
    result.writeProtectionState,
    result.readerResultCode,
    result.helperCapability,
    result.observedAt,
  ].join("\n");
}

function signTenKingsV2NfcResult(
  value: unknown,
  jobValue: TenKingsV2NfcSignedJob,
  privateKey: KeyObject,
): TenKingsV2NfcSignedResult {
  const result = validateUnsignedResult(value);
  const job = signedJob(jobValue);
  assertResultMatchesJob(result, job);
  const derivedKeyId = tenKingsV2NfcKeyId(privateKey);
  if (result.workstationKeyId !== derivedKeyId) {
    invalid("TEN_KINGS_V2_NFC_KEY_MISMATCH", "workstationKeyId does not match the workstation signing key.");
  }
  return { ...result, signature: signP1363(tenKingsV2NfcResultCanonicalStatement(result), privateKey) };
}

export function createTenKingsV2NfcResult(input: {
  job: TenKingsV2NfcSignedJob;
  trustedJobSigningKeys: TenKingsV2NfcTrustedKeys;
  workstationPrivateKey: KeyObject;
  readbackPayloadSha256: string;
  observedAt: string;
}) {
  const job = verifyTenKingsV2NfcJob(input.job, input.trustedJobSigningKeys);
  const result: TenKingsV2NfcUnsignedResult = {
    schemaVersion: TEN_KINGS_V2_NFC_RESULT_SCHEMA,
    algorithm: TEN_KINGS_V2_NFC_ALGORITHM,
    workstationKeyId: tenKingsV2NfcKeyId(input.workstationPrivateKey),
    jobEnvelopeSha256: tenKingsV2NfcJobEnvelopeSha256(job),
    nonce: job.nonce,
    cardId: job.cardId,
    publicToken: job.publicToken,
    url: job.url,
    chipType: TEN_KINGS_V2_NFC_CHIP_TYPE,
    securityMode: TEN_KINGS_V2_NFC_SECURITY_MODE,
    programmingProfile: TEN_KINGS_V2_NFC_PROGRAMMING_PROFILE,
    readerModel: TEN_KINGS_V2_NFC_READER_MODEL,
    adapterIdentity: TEN_KINGS_V2_NFC_ADAPTER_IDENTITY,
    adapterVersion: TEN_KINGS_V2_NFC_ADAPTER_VERSION,
    readbackPayloadSha256: input.readbackPayloadSha256,
    writeProtectionState: TEN_KINGS_V2_NFC_WRITE_PROTECTION_STATE,
    readerResultCode: TEN_KINGS_V2_NFC_READER_RESULT_CODE,
    helperCapability: TEN_KINGS_V2_NFC_HELPER_CAPABILITY,
    observedAt: input.observedAt,
  };
  return signTenKingsV2NfcResult(result, job, input.workstationPrivateKey);
}

function signedResult(value: unknown): TenKingsV2NfcSignedResult {
  const record = exactStringRecord(value, RESULT_KEYS, "TEN_KINGS_V2_NFC_RESULT_INVALID", "Signed NFC result");
  const unsigned = Object.fromEntries(UNSIGNED_RESULT_KEYS.map((key) => [key, record[key]]));
  const result = validateUnsignedResult(unsigned);
  canonicalBase64Url(record.signature, 64, "TEN_KINGS_V2_NFC_RESULT_INVALID", "signature");
  return { ...result, signature: record.signature };
}

function assertResultMatchesJob(result: TenKingsV2NfcUnsignedResult, job: TenKingsV2NfcSignedJob) {
  if (
    result.jobEnvelopeSha256 !== tenKingsV2NfcJobEnvelopeSha256(job) ||
    result.nonce !== job.nonce ||
    result.cardId !== job.cardId ||
    result.publicToken !== job.publicToken ||
    result.url !== job.url ||
    result.chipType !== job.chipType ||
    result.securityMode !== job.securityMode ||
    result.programmingProfile !== job.programmingProfile
  ) {
    invalid("TEN_KINGS_V2_NFC_RESULT_JOB_MISMATCH", "The NFC result does not match the exact signed job.");
  }
  const observedAt = strictUtcMillis(result.observedAt, "TEN_KINGS_V2_NFC_RESULT_INVALID", "observedAt");
  const issuedAt = strictUtcMillis(job.issuedAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "issuedAt");
  const expiresAt = strictUtcMillis(job.expiresAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "expiresAt");
  if (observedAt < issuedAt || observedAt > expiresAt) {
    invalid("TEN_KINGS_V2_NFC_RESULT_OUTSIDE_JOB_WINDOW", "The NFC operation did not complete inside its signed job window.");
  }
}

function verifyTenKingsV2NfcResultForVerifiedJob(
  value: unknown,
  jobValue: TenKingsV2NfcSignedJob,
  trustedWorkstationKeys: TenKingsV2NfcTrustedKeys,
) {
  const result = signedResult(value);
  const job = signedJob(jobValue);
  assertResultMatchesJob(result, job);
  if (!Object.hasOwn(trustedWorkstationKeys, result.workstationKeyId)) {
    invalid("TEN_KINGS_V2_NFC_WORKSTATION_UNTRUSTED", "The NFC workstation is not allowlisted.");
  }
  const trustedKey = trustedWorkstationKeys[result.workstationKeyId];
  if (tenKingsV2NfcKeyId(trustedKey) !== result.workstationKeyId) {
    invalid("TEN_KINGS_V2_NFC_WORKSTATION_UNTRUSTED", "The NFC workstation trust entry is mislabeled.");
  }
  if (!verifyP1363(tenKingsV2NfcResultCanonicalStatement(result), result.signature, trustedKey)) {
    invalid("TEN_KINGS_V2_NFC_RESULT_SIGNATURE_INVALID", "The NFC workstation result signature is invalid.");
  }
  return result;
}

export function verifyTenKingsV2NfcCompletion(input: {
  job: unknown;
  result: unknown;
  trustedJobSigningKeys: TenKingsV2NfcTrustedKeys;
  trustedWorkstationKeys: TenKingsV2NfcTrustedKeys;
}) {
  const job = verifyTenKingsV2NfcJob(input.job, input.trustedJobSigningKeys);
  const result = verifyTenKingsV2NfcResultForVerifiedJob(input.result, job, input.trustedWorkstationKeys);
  return { job, result };
}

export function decideTenKingsV2NfcVerificationWrite(input: {
  jobIssuedAt: string;
  existingNfcVerifiedAt: string | null;
}): "WRITE_SERVER_TRANSACTION_TIME" | "NOOP_REPLAY_OR_STALE_JOB" {
  const issuedAt = strictUtcMillis(input.jobIssuedAt, "TEN_KINGS_V2_NFC_JOB_INVALID", "jobIssuedAt");
  if (input.existingNfcVerifiedAt === null) return "WRITE_SERVER_TRANSACTION_TIME";
  const existing = strictUtcMillis(
    input.existingNfcVerifiedAt,
    "TEN_KINGS_V2_NFC_EXISTING_FACT_INVALID",
    "existingNfcVerifiedAt",
  );
  return issuedAt <= existing ? "NOOP_REPLAY_OR_STALE_JOB" : "WRITE_SERVER_TRANSACTION_TIME";
}
