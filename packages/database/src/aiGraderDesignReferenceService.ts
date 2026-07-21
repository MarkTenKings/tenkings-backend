import { createHash } from "node:crypto";
import { validateMathematicalDesignReferencePixelContourV1 } from "@tenkings/shared";

export const AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE = "registered_design_template_v1" as const;
export const AI_GRADER_DESIGN_REFERENCE_PROVENANCE_SCHEMA_VERSION =
  "ai-grader-design-reference-provenance-v1" as const;
export const AI_GRADER_DESIGN_REFERENCE_TRANSFORM_ACCEPTANCE_SCHEMA_VERSION =
  "ai-grader-design-reference-transform-acceptance-v1" as const;
export const AI_GRADER_INTENDED_DESIGN_BOUNDARY_SCHEMA_VERSION =
  "ai-grader-intended-design-boundary-v1" as const;
export const AI_GRADER_DESIGN_REFERENCE_SUPERSEDED_REASON =
  "superseded_by_new_approved_design_reference" as const;

export type AiGraderDesignReferenceStatus = "draft" | "approved" | "retired";
export type AiGraderDesignReferenceSide = "front" | "back";
export type AiGraderDesignReferenceProfile = typeof AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE;

export type AiGraderDesignReferenceIdentity = {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
  side: AiGraderDesignReferenceSide;
  profile: AiGraderDesignReferenceProfile;
};

export type AiGraderDesignReferenceProvenance = Record<string, unknown> & {
  schemaVersion: typeof AI_GRADER_DESIGN_REFERENCE_PROVENANCE_SCHEMA_VERSION;
  sourceKind: string;
  approvedForPrecisionReference: true;
};

export type AiGraderDesignReferenceTransformAcceptance = Record<string, unknown> & {
  schemaVersion: typeof AI_GRADER_DESIGN_REFERENCE_TRANSFORM_ACCEPTANCE_SCHEMA_VERSION;
  registrationAlgorithmVersion: string;
  maxResidualPx: number;
  minInlierFraction: number;
};

export type AiGraderIntendedDesignBoundary = Record<string, unknown> & {
  schemaVersion: typeof AI_GRADER_INTENDED_DESIGN_BOUNDARY_SCHEMA_VERSION;
  coordinateFrame: "design_reference_pixels";
  contour: ReadonlyArray<readonly [number, number]>;
};

export type CreateVerifiedAiGraderDesignReferenceDraftInput = AiGraderDesignReferenceIdentity & {
  version: number;
  artifactStorageKey: string;
  intendedDesignBoundary: AiGraderIntendedDesignBoundary;
  provenance: AiGraderDesignReferenceProvenance;
  transformAcceptanceMetadata: AiGraderDesignReferenceTransformAcceptance;
  createdByUserId: string;
};

export type ListAiGraderDesignReferencesInput = AiGraderDesignReferenceIdentity;

export type ResolveExactApprovedAiGraderDesignReferenceInput = AiGraderDesignReferenceIdentity & {
  version: number;
  expectedArtifactSha256: string;
};

export type ApproveAiGraderDesignReferenceInput = ResolveExactApprovedAiGraderDesignReferenceInput & {
  referenceId: string;
  approvedByUserId: string;
};

export type RetireAiGraderDesignReferenceInput = ResolveExactApprovedAiGraderDesignReferenceInput & {
  referenceId: string;
  retiredByUserId: string;
  retirementReason: string;
};

export type AiGraderDesignReferenceRow = {
  id: string;
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  variantKey: string;
  parallelId: string | null;
  parallelKey: string;
  side: AiGraderDesignReferenceSide;
  profile: AiGraderDesignReferenceProfile;
  version: number;
  status: AiGraderDesignReferenceStatus;
  artifactStorageKey: string;
  artifactSha256: string;
  artifactMimeType: string;
  artifactWidthPx: number;
  artifactHeightPx: number;
  intendedDesignBoundary: unknown;
  provenance: unknown;
  transformAcceptanceMetadata: unknown;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  retiredByUserId: string | null;
  retiredAt: Date | null;
  retirementReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};

export type AiGraderDesignReferenceDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<AiGraderDesignReferenceRow>;
  findFirst(args: { where: Record<string, unknown> }): Promise<AiGraderDesignReferenceRow | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: ReadonlyArray<Record<string, "asc" | "desc">>;
  }): Promise<AiGraderDesignReferenceRow[]>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
};

export type AiGraderDesignReferenceTransactionClient = {
  aiGraderDesignReference: AiGraderDesignReferenceDelegate;
};

export type AiGraderDesignReferencePrismaClient = AiGraderDesignReferenceTransactionClient & {
  $transaction<T>(operation: (tx: AiGraderDesignReferenceTransactionClient) => Promise<T>): Promise<T>;
};

export type AiGraderDesignReferenceServiceOptions = {
  now?: () => Date;
  readArtifactBytes?: (storageKey: string) => Promise<Uint8Array>;
  maximumArtifactBytes?: number;
};

export type AiGraderDesignReferenceServiceErrorCode =
  | "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT"
  | "AI_GRADER_DESIGN_REFERENCE_EXACT_DRAFT_NOT_FOUND"
  | "AI_GRADER_DESIGN_REFERENCE_EXACT_APPROVED_NOT_FOUND"
  | "AI_GRADER_DESIGN_REFERENCE_EXACT_RETIRE_TARGET_NOT_FOUND"
  | "AI_GRADER_DESIGN_REFERENCE_EXACT_ROW_MISMATCH"
  | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_UNAVAILABLE"
  | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_FAILED"
  | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_UNSUPPORTED"
  | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_INTEGRITY_MISMATCH"
  | "AI_GRADER_DESIGN_REFERENCE_STATE_CONFLICT";

export class AiGraderDesignReferenceServiceError extends Error {
  readonly code: AiGraderDesignReferenceServiceErrorCode;
  readonly field?: string;

  constructor(code: AiGraderDesignReferenceServiceErrorCode, message: string, field?: string) {
    super(message);
    this.name = "AiGraderDesignReferenceServiceError";
    this.code = code;
    this.field = field;
  }
}

type NormalizedIdentity = AiGraderDesignReferenceIdentity & {
  variantKey: string;
  parallelKey: string;
};

function invalid(field: string, message: string): never {
  throw new AiGraderDesignReferenceServiceError(
    "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    `${field}: ${message}`,
    field,
  );
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

function requireOwn(record: Record<string, unknown>, field: string) {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    invalid(field, "is required, including an explicit null where allowed");
  }
}

function requireCanonicalString(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== "string") return invalid(field, "must be a string");
  if (value.length < 1 || value.length > maxLength) {
    return invalid(field, `must contain 1-${maxLength} characters`);
  }
  if (value !== value.trim()) return invalid(field, "must not contain leading or trailing whitespace");
  return value;
}

function requireNullableIdentityString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireCanonicalString(value, field);
}

function requireVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    return invalid("version", "must be a positive 32-bit integer");
  }
  return value as number;
}

function requirePositiveDimension(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100_000) {
    return invalid(field, "must be an integer from 1 through 100000 pixels");
  }
  return value as number;
}

function requireSha256(value: unknown, field = "artifactSha256"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    return invalid(field, "must be an exact lowercase 64-character SHA-256 digest");
  }
  return value;
}

function requireArtifactStorageKey(value: unknown): string {
  const storageKey = requireCanonicalString(value, "artifactStorageKey", 1024);
  if (
    storageKey.startsWith("/") ||
    storageKey.includes(String.fromCharCode(92)) ||
    storageKey.includes("://") ||
    storageKey.includes("?") ||
    storageKey.includes("#") ||
    storageKey.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return invalid("artifactStorageKey", "must be a private relative object key without URL, query, fragment, or traversal syntax");
  }
  return storageKey;
}

function requireMimeType(value: unknown): string {
  const mimeType = requireCanonicalString(value, "artifactMimeType", 128);
  if (!/^image\/[a-z0-9.+-]+$/.test(mimeType)) {
    return invalid("artifactMimeType", "must be a canonical lowercase image MIME type");
  }
  return mimeType;
}

type VerifiedArtifactBytes = {
  artifactSha256: string;
  artifactMimeType: "image/png" | "image/jpeg";
  artifactWidthPx: number;
  artifactHeightPx: number;
  byteLength: number;
};

function artifactError(
  code: Extract<AiGraderDesignReferenceServiceErrorCode,
    | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_UNAVAILABLE"
    | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_FAILED"
    | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_UNSUPPORTED"
    | "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_INTEGRITY_MISMATCH">,
  message: string,
): never {
  throw new AiGraderDesignReferenceServiceError(code, message, "artifactStorageKey");
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!;
}

function crc32Range(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectCompletePng(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 57) return undefined;
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32Be(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const next = crcOffset + 4;
    if (length > bytes.byteLength || next > bytes.byteLength) return undefined;
    const type = String.fromCharCode(
      bytes[typeStart]!,
      bytes[typeStart + 1]!,
      bytes[typeStart + 2]!,
      bytes[typeStart + 3]!,
    );
    if (crc32Range(bytes, typeStart, crcOffset) !== readUint32Be(bytes, crcOffset)) {
      return undefined;
    }
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return undefined;
      width = readUint32Be(bytes, dataStart);
      height = readUint32Be(bytes, dataStart + 4);
      sawHeader = true;
    } else if (type === "IHDR") {
      return undefined;
    }
    if (type === "IDAT") {
      if (length < 1) return undefined;
      sawImageData = true;
    }
    if (type === "IEND") {
      if (length !== 0 || !sawImageData || next !== bytes.byteLength) return undefined;
      sawEnd = true;
      break;
    }
    offset = next;
  }
  return sawHeader && sawImageData && sawEnd && width > 0 && height > 0
    ? { width, height }
    : undefined;
}

function inspectRasterArtifact(bytes: Uint8Array, maximumBytes: number): VerifiedArtifactBytes {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 24 || bytes.byteLength > maximumBytes) {
    return artifactError(
      "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_UNSUPPORTED",
      `Design-reference bytes must contain a supported image from 24 through ${maximumBytes} bytes.`,
    );
  }
  let artifactMimeType: VerifiedArtifactBytes["artifactMimeType"] | undefined;
  let artifactWidthPx = 0;
  let artifactHeightPx = 0;
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const png = pngSignature.every((value, index) => bytes[index] === value)
    ? inspectCompletePng(bytes) : undefined;
  if (png) {
    artifactMimeType = "image/png";
    artifactWidthPx = png.width;
    artifactHeightPx = png.height;
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    artifactMimeType = "image/jpeg";
    let offset = 2;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 4 <= bytes.byteLength) {
      while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.byteLength) break;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.byteLength) break;
      const segmentLength = (bytes[offset]! << 8) + bytes[offset + 1]!;
      if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
      if (startOfFrame.has(marker) && segmentLength >= 7) {
        artifactHeightPx = (bytes[offset + 3]! << 8) + bytes[offset + 4]!;
        artifactWidthPx = (bytes[offset + 5]! << 8) + bytes[offset + 6]!;
        break;
      }
      offset += segmentLength;
    }
  }
  if (artifactMimeType === "image/jpeg" &&
      !(bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9)) {
    artifactMimeType = undefined;
  }
  if (!artifactMimeType || artifactWidthPx < 1 || artifactHeightPx < 1) {
    return artifactError(
      "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_UNSUPPORTED",
      "Design-reference storage bytes must be a structurally identifiable PNG or JPEG with server-readable dimensions.",
    );
  }
  requirePositiveDimension(artifactWidthPx, "artifactWidthPx");
  requirePositiveDimension(artifactHeightPx, "artifactHeightPx");
  return {
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    artifactMimeType,
    artifactWidthPx,
    artifactHeightPx,
    byteLength: bytes.byteLength,
  };
}

function assertJsonValue(value: unknown, field: string, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(field, "must not contain a non-finite number");
    return;
  }
  if (typeof value !== "object") invalid(field, "must contain only JSON values");
  const objectValue = value as object;
  if (ancestors.has(objectValue)) invalid(field, "must not contain a cycle");
  ancestors.add(objectValue);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${field}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid(field, "must contain only plain JSON objects");
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        invalid(`${field}.${key}`, "is not an allowed JSON property");
      }
      assertJsonValue(entry, `${field}.${key}`, ancestors);
    }
  }
  ancestors.delete(objectValue);
}

function cloneJsonObject(value: unknown, field: string): Record<string, unknown> {
  const objectValue = requireRecord(value, field);
  if (Object.keys(objectValue).length === 0) invalid(field, "must not be empty");
  assertJsonValue(objectValue, field, new Set());
  return JSON.parse(JSON.stringify(objectValue)) as Record<string, unknown>;
}

function requireIntendedDesignBoundary(
  value: unknown,
  artifactWidthPx: number,
  artifactHeightPx: number,
): Record<string, unknown> {
  const boundary = cloneJsonObject(value, "intendedDesignBoundary");
  if (boundary.schemaVersion !== AI_GRADER_INTENDED_DESIGN_BOUNDARY_SCHEMA_VERSION) {
    invalid("intendedDesignBoundary.schemaVersion", `must equal ${AI_GRADER_INTENDED_DESIGN_BOUNDARY_SCHEMA_VERSION}`);
  }
  if (boundary.coordinateFrame !== "design_reference_pixels") {
    invalid("intendedDesignBoundary.coordinateFrame", "must equal design_reference_pixels");
  }
  const contour = validateMathematicalDesignReferencePixelContourV1(
    boundary.contour,
    artifactWidthPx,
    artifactHeightPx,
  );
  if (!contour.valid) {
    invalid("intendedDesignBoundary.contour", contour.issues.join("; "));
  }
  boundary.contour = contour.contour.map((point) => [...point]);
  return boundary;
}

function requireProvenance(value: unknown): Record<string, unknown> {
  const provenance = cloneJsonObject(value, "provenance");
  if (provenance.schemaVersion !== AI_GRADER_DESIGN_REFERENCE_PROVENANCE_SCHEMA_VERSION) {
    invalid("provenance.schemaVersion", `must equal ${AI_GRADER_DESIGN_REFERENCE_PROVENANCE_SCHEMA_VERSION}`);
  }
  const sourceKind = requireCanonicalString(provenance.sourceKind, "provenance.sourceKind", 128);
  const provenanceText = JSON.stringify(provenance);
  if (/(?:ebay|internet|marketplace|search(?:_|-)?result|listing|scraped|unknown)/i.test(sourceKind)) {
    invalid("provenance.sourceKind", "must identify a controlled precision source, not arbitrary internet or marketplace imagery");
  }
  if (/(?:ebay|marketplace|search(?:_|-)?result|scraped)/i.test(provenanceText)) {
    invalid("provenance", "must not contain marketplace or scraped-image provenance");
  }
  if (provenance.approvedForPrecisionReference !== true) {
    invalid("provenance.approvedForPrecisionReference", "must be explicitly true");
  }
  return provenance;
}

function requireTransformAcceptance(value: unknown): Record<string, unknown> {
  const metadata = cloneJsonObject(value, "transformAcceptanceMetadata");
  if (metadata.schemaVersion !== AI_GRADER_DESIGN_REFERENCE_TRANSFORM_ACCEPTANCE_SCHEMA_VERSION) {
    invalid(
      "transformAcceptanceMetadata.schemaVersion",
      `must equal ${AI_GRADER_DESIGN_REFERENCE_TRANSFORM_ACCEPTANCE_SCHEMA_VERSION}`,
    );
  }
  requireCanonicalString(
    metadata.registrationAlgorithmVersion,
    "transformAcceptanceMetadata.registrationAlgorithmVersion",
    256,
  );
  if (typeof metadata.maxResidualPx !== "number" || !Number.isFinite(metadata.maxResidualPx) || metadata.maxResidualPx < 0) {
    invalid("transformAcceptanceMetadata.maxResidualPx", "must be a finite non-negative number");
  }
  if (
    typeof metadata.minInlierFraction !== "number" ||
    !Number.isFinite(metadata.minInlierFraction) ||
    metadata.minInlierFraction < 0 ||
    metadata.minInlierFraction > 1
  ) {
    invalid("transformAcceptanceMetadata.minInlierFraction", "must be a finite number from 0 through 1");
  }
  return metadata;
}

function normalizeIdentity(value: unknown): NormalizedIdentity {
  const input = requireRecord(value, "identity");
  for (const field of [
    "tenantId",
    "setId",
    "programId",
    "cardNumber",
    "variantId",
    "parallelId",
    "side",
    "profile",
  ]) requireOwn(input, field);

  const variantId = requireNullableIdentityString(input.variantId, "variantId");
  const parallelId = requireNullableIdentityString(input.parallelId, "parallelId");
  const side = input.side;
  if (side !== "front" && side !== "back") invalid("side", "must equal front or back");
  if (input.profile !== AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE) {
    invalid("profile", `must equal ${AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE}`);
  }

  return {
    tenantId: requireCanonicalString(input.tenantId, "tenantId"),
    setId: requireCanonicalString(input.setId, "setId"),
    programId: requireCanonicalString(input.programId, "programId"),
    cardNumber: requireCanonicalString(input.cardNumber, "cardNumber", 128),
    variantId,
    variantKey: variantId ?? "",
    parallelId,
    parallelKey: parallelId ?? "",
    side,
    profile: AI_GRADER_REGISTERED_DESIGN_REFERENCE_PROFILE,
  };
}

function exactIdentityWhere(identity: NormalizedIdentity): Record<string, unknown> {
  return {
    tenantId: identity.tenantId,
    setId: identity.setId,
    programId: identity.programId,
    cardNumber: identity.cardNumber,
    variantId: identity.variantId,
    variantKey: identity.variantKey,
    parallelId: identity.parallelId,
    parallelKey: identity.parallelKey,
    side: identity.side,
    profile: identity.profile,
  };
}

function exactActiveSideWhere(identity: NormalizedIdentity): Record<string, unknown> {
  return {
    tenantId: identity.tenantId,
    setId: identity.setId,
    programId: identity.programId,
    cardNumber: identity.cardNumber,
    variantId: identity.variantId,
    variantKey: identity.variantKey,
    parallelId: identity.parallelId,
    parallelKey: identity.parallelKey,
    side: identity.side,
  };
}

function assertExactRow(
  row: AiGraderDesignReferenceRow,
  identity: NormalizedIdentity,
  version: number,
  artifactSha256: string,
  status: AiGraderDesignReferenceStatus,
): AiGraderDesignReferenceRow {
  const artifactWidthPx = requirePositiveDimension(row.artifactWidthPx, "artifactWidthPx");
  const artifactHeightPx = requirePositiveDimension(row.artifactHeightPx, "artifactHeightPx");
  requireIntendedDesignBoundary(row.intendedDesignBoundary, artifactWidthPx, artifactHeightPx);
  const expected = {
    ...exactIdentityWhere(identity),
    version,
    artifactSha256,
    status,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (row[field] !== expectedValue) {
      throw new AiGraderDesignReferenceServiceError(
        "AI_GRADER_DESIGN_REFERENCE_EXACT_ROW_MISMATCH",
        `resolved design reference did not match exact ${field}`,
        field,
      );
    }
  }
  return row;
}

function requireReferenceId(value: unknown): string {
  return requireCanonicalString(value, "referenceId", 256);
}

export function createAiGraderDesignReferenceService(
  db: AiGraderDesignReferencePrismaClient,
  options: AiGraderDesignReferenceServiceOptions = {},
) {
  if (!db || !db.aiGraderDesignReference || typeof db.$transaction !== "function") {
    invalid("db", "must provide the AiGraderDesignReference Prisma delegate and transaction boundary");
  }
  const now = options.now ?? (() => new Date());
  const maximumArtifactBytes = options.maximumArtifactBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumArtifactBytes) || maximumArtifactBytes < 24 ||
      maximumArtifactBytes > 256 * 1024 * 1024) {
    invalid("maximumArtifactBytes", "must be an integer from 24 bytes through 256 MiB");
  }

  const readVerifiedArtifact = async (storageKey: string): Promise<VerifiedArtifactBytes> => {
    if (typeof options.readArtifactBytes !== "function") {
      return artifactError(
        "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_UNAVAILABLE",
        "Private design-reference storage-byte verification is not configured.",
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await options.readArtifactBytes(storageKey);
    } catch {
      return artifactError(
        "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_FAILED",
        "Private design-reference storage bytes could not be read.",
      );
    }
    return inspectRasterArtifact(bytes, maximumArtifactBytes);
  };

  const assertStoredArtifactExact = async (row: AiGraderDesignReferenceRow) => {
    const storageKey = requireArtifactStorageKey(row.artifactStorageKey);
    const verified = await readVerifiedArtifact(storageKey);
    if (verified.artifactSha256 !== requireSha256(row.artifactSha256) ||
        verified.artifactMimeType !== requireMimeType(row.artifactMimeType) ||
        verified.artifactWidthPx !== requirePositiveDimension(row.artifactWidthPx, "artifactWidthPx") ||
        verified.artifactHeightPx !== requirePositiveDimension(row.artifactHeightPx, "artifactHeightPx")) {
      return artifactError(
        "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_INTEGRITY_MISMATCH",
        "Current private storage bytes do not match the immutable design-reference hash, MIME type, and dimensions.",
      );
    }
    return verified;
  };

  return {
    async createVerifiedDraft(
      input: CreateVerifiedAiGraderDesignReferenceDraftInput,
    ): Promise<AiGraderDesignReferenceRow> {
      const identity = normalizeIdentity(input);
      const version = requireVersion(input.version);
      const artifactStorageKey = requireArtifactStorageKey(input.artifactStorageKey);
      const verified = await readVerifiedArtifact(artifactStorageKey);
      const {
        artifactSha256,
        artifactMimeType,
        artifactWidthPx,
        artifactHeightPx,
      } = verified;
      const data = {
        ...exactIdentityWhere(identity),
        version,
        status: "draft",
        artifactStorageKey,
        artifactSha256,
        artifactMimeType,
        artifactWidthPx,
        artifactHeightPx,
        intendedDesignBoundary: requireIntendedDesignBoundary(
          input.intendedDesignBoundary,
          artifactWidthPx,
          artifactHeightPx,
        ),
        provenance: requireProvenance(input.provenance),
        transformAcceptanceMetadata: requireTransformAcceptance(input.transformAcceptanceMetadata),
        createdByUserId: requireCanonicalString(input.createdByUserId, "createdByUserId"),
      };
      const created = await db.aiGraderDesignReference.create({ data });
      return assertExactRow(created, identity, version, artifactSha256, "draft");
    },

    async list(input: ListAiGraderDesignReferencesInput): Promise<AiGraderDesignReferenceRow[]> {
      const identity = normalizeIdentity(input);
      const rows = await db.aiGraderDesignReference.findMany({
        where: exactIdentityWhere(identity),
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      });
      rows.forEach((row) => {
        const artifactWidthPx = requirePositiveDimension(row.artifactWidthPx, "artifactWidthPx");
        const artifactHeightPx = requirePositiveDimension(row.artifactHeightPx, "artifactHeightPx");
        requireIntendedDesignBoundary(row.intendedDesignBoundary, artifactWidthPx, artifactHeightPx);
      });
      return rows;
    },

    async resolveExactApproved(
      input: ResolveExactApprovedAiGraderDesignReferenceInput,
    ): Promise<AiGraderDesignReferenceRow> {
      const identity = normalizeIdentity(input);
      const version = requireVersion(input.version);
      const artifactSha256 = requireSha256(input.expectedArtifactSha256, "expectedArtifactSha256");
      const row = await db.aiGraderDesignReference.findFirst({
        where: {
          ...exactIdentityWhere(identity),
          version,
          artifactSha256,
          status: "approved",
        },
      });
      if (!row) {
        throw new AiGraderDesignReferenceServiceError(
          "AI_GRADER_DESIGN_REFERENCE_EXACT_APPROVED_NOT_FOUND",
          "no approved design reference matched the complete identity, side, profile, version, and artifact hash",
        );
      }
      const exact = assertExactRow(row, identity, version, artifactSha256, "approved");
      await assertStoredArtifactExact(exact);
      return exact;
    },

    async approve(input: ApproveAiGraderDesignReferenceInput): Promise<AiGraderDesignReferenceRow> {
      const identity = normalizeIdentity(input);
      const version = requireVersion(input.version);
      const artifactSha256 = requireSha256(input.expectedArtifactSha256, "expectedArtifactSha256");
      const referenceId = requireReferenceId(input.referenceId);
      const approvedByUserId = requireCanonicalString(input.approvedByUserId, "approvedByUserId");
      const approvedAt = now();
      if (!(approvedAt instanceof Date) || !Number.isFinite(approvedAt.getTime())) {
        return invalid("now", "must produce a valid Date");
      }

      return db.$transaction(async (tx) => {
        const draft = await tx.aiGraderDesignReference.findFirst({
          where: {
            id: referenceId,
            ...exactIdentityWhere(identity),
            version,
            artifactSha256,
            status: "draft",
          },
        });
        if (!draft) {
          throw new AiGraderDesignReferenceServiceError(
            "AI_GRADER_DESIGN_REFERENCE_EXACT_DRAFT_NOT_FOUND",
            "no draft design reference matched the exact id, identity, side, profile, version, and artifact hash",
          );
        }
        const exactDraft = assertExactRow(draft, identity, version, artifactSha256, "draft");
        await assertStoredArtifactExact(exactDraft);

        await tx.aiGraderDesignReference.updateMany({
          where: {
            ...exactActiveSideWhere(identity),
            status: "approved",
            id: { not: referenceId },
          },
          data: {
            status: "retired",
            retiredByUserId: approvedByUserId,
            retiredAt: approvedAt,
            retirementReason: AI_GRADER_DESIGN_REFERENCE_SUPERSEDED_REASON,
          },
        });

        const promoted = await tx.aiGraderDesignReference.updateMany({
          where: {
            id: referenceId,
            ...exactIdentityWhere(identity),
            version,
            artifactSha256,
            status: "draft",
          },
          data: {
            status: "approved",
            approvedByUserId,
            approvedAt,
          },
        });
        if (promoted.count !== 1) {
          throw new AiGraderDesignReferenceServiceError(
            "AI_GRADER_DESIGN_REFERENCE_STATE_CONFLICT",
            "the exact draft changed before approval completed",
          );
        }

        const approved = await tx.aiGraderDesignReference.findFirst({
          where: {
            id: referenceId,
            ...exactIdentityWhere(identity),
            version,
            artifactSha256,
            status: "approved",
          },
        });
        if (!approved) {
          throw new AiGraderDesignReferenceServiceError(
            "AI_GRADER_DESIGN_REFERENCE_STATE_CONFLICT",
            "the exact approved reference could not be reread inside the approval transaction",
          );
        }
        return assertExactRow(approved, identity, version, artifactSha256, "approved");
      });
    },

    async retire(input: RetireAiGraderDesignReferenceInput): Promise<AiGraderDesignReferenceRow> {
      const identity = normalizeIdentity(input);
      const version = requireVersion(input.version);
      const artifactSha256 = requireSha256(input.expectedArtifactSha256, "expectedArtifactSha256");
      const referenceId = requireReferenceId(input.referenceId);
      const retiredByUserId = requireCanonicalString(input.retiredByUserId, "retiredByUserId");
      const retirementReason = requireCanonicalString(input.retirementReason, "retirementReason", 1024);
      const retiredAt = now();
      if (!(retiredAt instanceof Date) || !Number.isFinite(retiredAt.getTime())) {
        return invalid("now", "must produce a valid Date");
      }

      return db.$transaction(async (tx) => {
        const retired = await tx.aiGraderDesignReference.updateMany({
          where: {
            id: referenceId,
            ...exactIdentityWhere(identity),
            version,
            artifactSha256,
            status: "approved",
          },
          data: {
            status: "retired",
            retiredByUserId,
            retiredAt,
            retirementReason,
          },
        });
        if (retired.count !== 1) {
          throw new AiGraderDesignReferenceServiceError(
            "AI_GRADER_DESIGN_REFERENCE_EXACT_RETIRE_TARGET_NOT_FOUND",
            "no approved design reference matched the exact id, identity, side, profile, version, and artifact hash",
          );
        }
        const row = await tx.aiGraderDesignReference.findFirst({
          where: {
            id: referenceId,
            ...exactIdentityWhere(identity),
            version,
            artifactSha256,
            status: "retired",
          },
        });
        if (!row) {
          throw new AiGraderDesignReferenceServiceError(
            "AI_GRADER_DESIGN_REFERENCE_STATE_CONFLICT",
            "the exact retired reference could not be reread inside the retirement transaction",
          );
        }
        return assertExactRow(row, identity, version, artifactSha256, "retired");
      });
    },
  };
}
