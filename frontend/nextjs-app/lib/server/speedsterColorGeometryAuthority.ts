import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  parseSpeedsterColorGeometryProposal,
  type SpeedsterColorGeometryMode,
  type SpeedsterColorGeometryProposal,
  type SpeedsterMatColor,
} from "../ai-grader-v2/color-geometry";
import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";

const RECEIPT_VERSION = "speedster-color-geometry-receipt-v1" as const;
export const SPEEDSTER_COLOR_GEOMETRY_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SECRET_ENV = "SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY";
const KEY_ID_ENV = "SPEEDSTER_COLOR_GEOMETRY_RECEIPT_HMAC_KEY_ID";
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,256}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export class SpeedsterColorGeometryReceiptExpiredError extends Error {
  constructor() {
    super("Color geometry receipt expired.");
    this.name = "SpeedsterColorGeometryReceiptExpiredError";
  }
}

function normalized(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Color geometry receipt contains a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, normalized(source[key])]));
  }
  throw new Error("Color geometry receipt contains a non-JSON value.");
}

export function speedsterColorGeometryResultHash(result: SpeedsterColorGeometryProposal) {
  return createHash("sha256").update(JSON.stringify(normalized(result))).digest("hex");
}

export type SpeedsterColorGeometryReceiptBinding = Readonly<{
  operatorAdminId: string;
  sessionId: string;
  side: SpeedsterCardSide;
  mode: SpeedsterColorGeometryMode;
  sourceImageStorageKey: string;
  sourceImageSha256: string;
  matColor: SpeedsterMatColor;
  physicalQuadSha256: string | null;
  result: SpeedsterColorGeometryProposal;
}>;

type Claims = Readonly<{
  v: typeof RECEIPT_VERSION;
  kid: string;
  issuedAt: number;
  operatorAdminId: string;
  sessionId: string;
  side: SpeedsterCardSide;
  mode: SpeedsterColorGeometryMode;
  sourceImageStorageKey: string;
  sourceImageSha256: string;
  matColor: SpeedsterMatColor;
  physicalQuadSha256: string | null;
  resultSha256: string;
}>;

function authority(env: NodeJS.ProcessEnv = process.env) {
  const secret = env[SECRET_ENV]?.trim() ?? "";
  const keyId = env[KEY_ID_ENV]?.trim() ?? "";
  if (!SECRET_PATTERN.test(secret) || Buffer.byteLength(secret, "utf8") < 32 || !KEY_ID_PATTERN.test(keyId)) {
    throw new Error("Speedster color geometry receipt authority is unavailable.");
  }
  return { secret, keyId };
}

export function issueSpeedsterColorGeometryReceipt(
  binding: SpeedsterColorGeometryReceiptBinding,
  options: Readonly<{ now?: number; env?: NodeJS.ProcessEnv }> = {},
) {
  const { secret, keyId } = authority(options.env);
  // Receipt issue is a server authority boundary; nominal TS types are not evidence.
  const result = parseSpeedsterColorGeometryProposal(binding.result, {
    mode: binding.mode,
    matColor: binding.matColor,
  });
  const claims: Claims = {
    v: RECEIPT_VERSION,
    kid: keyId,
    issuedAt: options.now ?? Date.now(),
    operatorAdminId: binding.operatorAdminId,
    sessionId: binding.sessionId,
    side: binding.side,
    mode: binding.mode,
    sourceImageStorageKey: binding.sourceImageStorageKey,
    sourceImageSha256: binding.sourceImageSha256,
    matColor: binding.matColor,
    physicalQuadSha256: binding.physicalQuadSha256,
    resultSha256: speedsterColorGeometryResultHash(result),
  };
  const payload = Buffer.from(JSON.stringify(normalized(claims)), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`${RECEIPT_VERSION}\0${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySpeedsterColorGeometryReceipt(
  receipt: string,
  binding: SpeedsterColorGeometryReceiptBinding,
  options: Readonly<{ now?: number; env?: NodeJS.ProcessEnv }> = {},
) {
  const { secret, keyId } = authority(options.env);
  const [payload, supplied, extra] = receipt.split(".");
  if (!payload || !supplied || extra) throw new Error("Color geometry receipt is malformed.");
  const expected = createHmac("sha256", secret).update(`${RECEIPT_VERSION}\0${payload}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(supplied, "base64url"); } catch { throw new Error("Color geometry receipt is malformed."); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Color geometry receipt signature is invalid.");
  }
  let claims: Claims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch {
    throw new Error("Color geometry receipt claims are malformed.");
  }
  const now = options.now ?? Date.now();
  if (claims.v !== RECEIPT_VERSION || claims.kid !== keyId
    || !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt > now + 5_000
    || claims.operatorAdminId !== binding.operatorAdminId
    || claims.sessionId !== binding.sessionId
    || claims.side !== binding.side
    || claims.mode !== binding.mode
    || claims.sourceImageStorageKey !== binding.sourceImageStorageKey
    || claims.sourceImageSha256 !== binding.sourceImageSha256
    || claims.matColor !== binding.matColor
    || claims.physicalQuadSha256 !== binding.physicalQuadSha256
    || claims.resultSha256 !== speedsterColorGeometryResultHash(binding.result)) {
    throw new Error("Color geometry receipt does not match the exact server result and source geometry.");
  }
  if (now - claims.issuedAt > SPEEDSTER_COLOR_GEOMETRY_RECEIPT_MAX_AGE_MS) {
    throw new SpeedsterColorGeometryReceiptExpiredError();
  }
}
