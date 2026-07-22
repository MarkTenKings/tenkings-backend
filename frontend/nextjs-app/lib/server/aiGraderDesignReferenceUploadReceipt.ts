import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

export const AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SCHEMA_VERSION =
  "ai-grader-design-reference-upload-receipt-v1" as const;
export const AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SECRET_ENV =
  "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SECRET" as const;

export type AiGraderDesignReferenceUploadManifestV1 = {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
  side: "front" | "back";
  profile: "registered_design_template_v1";
  version: number;
  fileName: string;
  contentType: "image/png" | "image/jpeg";
  byteSize: number;
  checksumSha256: string;
};

export type AiGraderDesignReferenceUploadReceiptBindingV1 =
  AiGraderDesignReferenceUploadManifestV1 & {
    storageKey: string;
    issuedToUserId: string;
  };

export type AiGraderDesignReferenceUploadReceiptClaimsV1 =
  AiGraderDesignReferenceUploadReceiptBindingV1 & {
    schemaVersion: typeof AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SCHEMA_VERSION;
    receiptId: string;
    issuedAtEpochMs: number;
    expiresAtEpochMs: number;
  };

export type AiGraderDesignReferenceUploadReceiptAuthorityV1 = {
  issue(binding: AiGraderDesignReferenceUploadReceiptBindingV1): {
    uploadReceipt: string;
    receiptExpiresAt: string;
  };
  verify(uploadReceipt: string): AiGraderDesignReferenceUploadReceiptClaimsV1;
};

type ReceiptAuthorityOptions = {
  secret: string;
  now?: () => number;
  ttlMs?: number;
  randomBytesImpl?: (size: number) => Buffer;
  randomUuidImpl?: () => string;
};

const RECEIPT_PREFIX = "tkadr1";
const RECEIPT_AAD = Buffer.from(AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SCHEMA_VERSION, "utf8");
const IDENTITY_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,190}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,190}\.(?:png|jpe?g)$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const STORAGE_KEY = /^ai-grader\/design-references\/imports\/[a-f0-9]{64}\/v[1-9][0-9]*-(?:front|back)-[a-f0-9-]{36}\.(?:png|jpg)$/;
const RECEIPT_ID = /^[a-f0-9-]{36}$/;
const TOKEN_PART = /^[A-Za-z0-9_-]+$/;
const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const MAXIMUM_TTL_MS = 10 * 60 * 1_000;
const MAXIMUM_REFERENCE_BYTES = 50 * 1024 * 1024;

function receiptFailure(
  code:
    | "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_INVALID"
    | "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_EXPIRED"
    | "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_UNAVAILABLE",
  message: string,
  statusCode: number,
): Error {
  return Object.assign(new Error(message), { code, statusCode });
}

function invalidReceipt(): never {
  throw receiptFailure(
    "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_INVALID",
    "The exact design-reference upload receipt is invalid or has been modified.",
    400,
  );
}

function canonicalRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidReceipt();
  return value as Record<string, unknown>;
}

function canonicalIdentity(value: unknown): string {
  return typeof value === "string" && IDENTITY_TEXT.test(value) ? value : invalidReceipt();
}

function canonicalNullableIdentity(value: unknown): string | null {
  if (value === null) return null;
  return canonicalIdentity(value);
}

function validateClaims(value: unknown, now: number): AiGraderDesignReferenceUploadReceiptClaimsV1 {
  const claims = canonicalRecord(value);
  const exactKeys = new Set([
    "schemaVersion", "receiptId", "issuedAtEpochMs", "expiresAtEpochMs", "storageKey",
    "issuedToUserId", "tenantId", "setId", "programId", "cardNumber", "variantId",
    "parallelId", "side", "profile", "version", "fileName", "contentType", "byteSize",
    "checksumSha256",
  ]);
  if (Object.keys(claims).length !== exactKeys.size ||
      Object.keys(claims).some((key) => !exactKeys.has(key))) {
    return invalidReceipt();
  }
  if (claims.schemaVersion !== AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SCHEMA_VERSION ||
      typeof claims.receiptId !== "string" || !RECEIPT_ID.test(claims.receiptId) ||
      typeof claims.storageKey !== "string" || !STORAGE_KEY.test(claims.storageKey) ||
      typeof claims.issuedToUserId !== "string" || !claims.issuedToUserId.trim() ||
      claims.issuedToUserId.length > 256 ||
      (claims.side !== "front" && claims.side !== "back") ||
      claims.profile !== "registered_design_template_v1" ||
      !Number.isSafeInteger(claims.version) || Number(claims.version) < 1 ||
      typeof claims.fileName !== "string" || !FILE_NAME.test(claims.fileName) ||
      (claims.contentType !== "image/png" && claims.contentType !== "image/jpeg") ||
      !Number.isSafeInteger(claims.byteSize) || Number(claims.byteSize) < 24 ||
      Number(claims.byteSize) > MAXIMUM_REFERENCE_BYTES ||
      typeof claims.checksumSha256 !== "string" || !SHA256.test(claims.checksumSha256) ||
      !Number.isSafeInteger(claims.issuedAtEpochMs) ||
      !Number.isSafeInteger(claims.expiresAtEpochMs) ||
      Number(claims.expiresAtEpochMs) <= Number(claims.issuedAtEpochMs) ||
      Number(claims.expiresAtEpochMs) - Number(claims.issuedAtEpochMs) > MAXIMUM_TTL_MS ||
      Number(claims.issuedAtEpochMs) > now + 30_000) {
    return invalidReceipt();
  }
  const extension = claims.fileName.toLowerCase().split(".").pop();
  if ((claims.contentType === "image/png" && extension !== "png") ||
      (claims.contentType === "image/jpeg" && extension !== "jpg" && extension !== "jpeg")) {
    return invalidReceipt();
  }
  if (Number(claims.expiresAtEpochMs) <= now) {
    throw receiptFailure(
      "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_EXPIRED",
      "The exact design-reference upload receipt has expired.",
      409,
    );
  }
  return {
    schemaVersion: AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SCHEMA_VERSION,
    receiptId: claims.receiptId,
    issuedAtEpochMs: Number(claims.issuedAtEpochMs),
    expiresAtEpochMs: Number(claims.expiresAtEpochMs),
    storageKey: claims.storageKey,
    issuedToUserId: claims.issuedToUserId,
    tenantId: canonicalIdentity(claims.tenantId),
    setId: canonicalIdentity(claims.setId),
    programId: canonicalIdentity(claims.programId),
    cardNumber: canonicalIdentity(claims.cardNumber),
    variantId: canonicalNullableIdentity(claims.variantId),
    parallelId: canonicalNullableIdentity(claims.parallelId),
    side: claims.side,
    profile: claims.profile,
    version: Number(claims.version),
    fileName: claims.fileName,
    contentType: claims.contentType,
    byteSize: Number(claims.byteSize),
    checksumSha256: claims.checksumSha256,
  };
}

function decodeTokenPart(value: string): Buffer {
  if (!value || !TOKEN_PART.test(value)) return invalidReceipt();
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.byteLength || decoded.toString("base64url") !== value) return invalidReceipt();
  return decoded;
}

export function createAiGraderDesignReferenceUploadReceiptAuthorityV1(
  options: ReceiptAuthorityOptions,
): AiGraderDesignReferenceUploadReceiptAuthorityV1 {
  const secret = String(options.secret ?? "");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw receiptFailure(
      "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_UNAVAILABLE",
      `${AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SECRET_ENV} must contain at least 32 server-only bytes.`,
      503,
    );
  }
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAXIMUM_TTL_MS) {
    throw new Error("Design-reference upload receipt TTL must be from 1 second through 10 minutes.");
  }
  const now = options.now ?? Date.now;
  const randomBytesForReceipt = options.randomBytesImpl ?? randomBytes;
  const randomUuidForReceipt = options.randomUuidImpl ?? randomUUID;
  const key = createHash("sha256")
    .update("ten-kings-design-reference-upload-receipt-v1\0", "utf8")
    .update(secret, "utf8")
    .digest();

  return {
    issue(binding) {
      const issuedAtEpochMs = now();
      const claims = validateClaims({
        schemaVersion: AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SCHEMA_VERSION,
        receiptId: randomUuidForReceipt(),
        issuedAtEpochMs,
        expiresAtEpochMs: issuedAtEpochMs + ttlMs,
        ...binding,
      }, issuedAtEpochMs);
      const iv = randomBytesForReceipt(12);
      if (!(iv instanceof Buffer) || iv.byteLength !== 12) throw new Error("Receipt IV source is invalid.");
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(RECEIPT_AAD);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(claims), "utf8"),
        cipher.final(),
      ]);
      const authenticationTag = cipher.getAuthTag();
      return {
        uploadReceipt: [
          RECEIPT_PREFIX,
          iv.toString("base64url"),
          ciphertext.toString("base64url"),
          authenticationTag.toString("base64url"),
        ].join("."),
        receiptExpiresAt: new Date(claims.expiresAtEpochMs).toISOString(),
      };
    },

    verify(uploadReceipt) {
      try {
        if (typeof uploadReceipt !== "string" || uploadReceipt.length > 8_192) return invalidReceipt();
        const parts = uploadReceipt.split(".");
        if (parts.length !== 4 || parts[0] !== RECEIPT_PREFIX) return invalidReceipt();
        const iv = decodeTokenPart(parts[1]!);
        const ciphertext = decodeTokenPart(parts[2]!);
        const authenticationTag = decodeTokenPart(parts[3]!);
        if (iv.byteLength !== 12 || authenticationTag.byteLength !== 16) return invalidReceipt();
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(RECEIPT_AAD);
        decipher.setAuthTag(authenticationTag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return validateClaims(JSON.parse(plaintext.toString("utf8")), now());
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_EXPIRED" ||
            code === "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_INVALID") {
          throw error;
        }
        return invalidReceipt();
      }
    },
  };
}
