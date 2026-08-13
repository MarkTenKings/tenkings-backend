import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SpeedsterMapRegistration } from "../ai-grader-v2/card-type-map-contracts";

const RECEIPT_VERSION = "speedster-map-registration-receipt-v1" as const;
/** Allows a careful operator to finish both-side centering without losing a valid draft. */
export const SPEEDSTER_MAP_REGISTRATION_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SECRET_ENV = "SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY";
const KEY_ID_ENV = "SPEEDSTER_MAP_REGISTRATION_RECEIPT_HMAC_KEY_ID";
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,256}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

function normalized(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Registration receipt contains a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalized(record[key])]));
  }
  throw new Error("Registration receipt contains a non-JSON value.");
}

export function speedsterMapRegistrationAuthorityHash(registration: SpeedsterMapRegistration) {
  return createHash("sha256").update(JSON.stringify(normalized(registration))).digest("hex");
}

type Claims = Readonly<{
  v: typeof RECEIPT_VERSION;
  kid: string;
  issuedAt: number;
  operatorAdminId: string;
  sessionId: string;
  mapRevisionId: string;
  side: "FRONT" | "BACK";
  currentInspectionSha256: string;
  currentPhysicalQuadSha256: string;
  registrationSha256: string;
}>;

function authority(env: NodeJS.ProcessEnv = process.env) {
  const secret = env[SECRET_ENV]?.trim() ?? "";
  const keyId = env[KEY_ID_ENV]?.trim() ?? "";
  if (!SECRET_PATTERN.test(secret) || Buffer.byteLength(secret, "utf8") < 32 || !KEY_ID_PATTERN.test(keyId)) {
    throw new Error("Speedster registration receipt authority is unavailable.");
  }
  return { secret, keyId };
}

function encodedClaims(claims: Claims) {
  return Buffer.from(JSON.stringify(normalized(claims)), "utf8").toString("base64url");
}

export function issueSpeedsterMapRegistrationReceipt(input: Readonly<{
  operatorAdminId: string;
  sessionId: string;
  registration: SpeedsterMapRegistration;
  now?: number;
  env?: NodeJS.ProcessEnv;
}>) {
  const { secret, keyId } = authority(input.env);
  const claims: Claims = {
    v: RECEIPT_VERSION,
    kid: keyId,
    issuedAt: input.now ?? Date.now(),
    operatorAdminId: input.operatorAdminId,
    sessionId: input.sessionId,
    mapRevisionId: input.registration.mapRevisionId,
    side: input.registration.side,
    currentInspectionSha256: input.registration.currentInspectionSha256,
    currentPhysicalQuadSha256: input.registration.currentPhysicalQuadSha256,
    registrationSha256: speedsterMapRegistrationAuthorityHash(input.registration),
  };
  const payload = encodedClaims(claims);
  const signature = createHmac("sha256", secret).update(`${RECEIPT_VERSION}\0${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySpeedsterMapRegistrationReceipt(input: Readonly<{
  receipt: string;
  operatorAdminId: string;
  sessionId: string;
  registration: SpeedsterMapRegistration;
  now?: number;
  env?: NodeJS.ProcessEnv;
}>) {
  const { secret, keyId } = authority(input.env);
  const [payload, supplied, extra] = input.receipt.split(".");
  if (!payload || !supplied || extra) throw new Error("Speedster registration receipt is malformed.");
  const expected = createHmac("sha256", secret).update(`${RECEIPT_VERSION}\0${payload}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, "base64url"); } catch { throw new Error("Speedster registration receipt is malformed."); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Speedster registration receipt signature is invalid.");
  }
  let claims: Claims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch {
    throw new Error("Speedster registration receipt claims are malformed.");
  }
  const now = input.now ?? Date.now();
  if (claims.v !== RECEIPT_VERSION || claims.kid !== keyId
    || !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt > now + 5_000
    || now - claims.issuedAt > SPEEDSTER_MAP_REGISTRATION_RECEIPT_MAX_AGE_MS
    || claims.operatorAdminId !== input.operatorAdminId || claims.sessionId !== input.sessionId
    || claims.mapRevisionId !== input.registration.mapRevisionId || claims.side !== input.registration.side
    || claims.currentInspectionSha256 !== input.registration.currentInspectionSha256
    || claims.currentPhysicalQuadSha256 !== input.registration.currentPhysicalQuadSha256
    || claims.registrationSha256 !== speedsterMapRegistrationAuthorityHash(input.registration)) {
    throw new Error("Speedster registration receipt does not match the exact server result.");
  }
}
