import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "node:crypto";
import {
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  mathematicalDesignReferenceV1Schema,
  type MathematicalDesignReferenceV1,
} from "@tenkings/shared";
import {
  inspectAiGraderDesignReferenceArtifactBytes,
  AiGraderDesignReferenceRow,
  ApproveAiGraderDesignReferenceInput,
  CreateVerifiedAiGraderDesignReferenceDraftInput,
  ListAiGraderDesignReferencesInput,
  ResolveExactApprovedAiGraderDesignReferenceInput,
  RetireAiGraderDesignReferenceInput,
} from "@tenkings/database";
import type {
  AiGraderDesignReferenceUploadManifestV1,
  AiGraderDesignReferenceUploadReceiptAuthorityV1,
  AiGraderDesignReferenceUploadReceiptClaimsV1,
} from "./aiGraderDesignReferenceUploadReceipt";

type AdminIdentity = { user: { id: string } };
type DesignReferenceService = {
  createVerifiedDraft(input: CreateVerifiedAiGraderDesignReferenceDraftInput): Promise<AiGraderDesignReferenceRow>;
  list(input: ListAiGraderDesignReferencesInput): Promise<AiGraderDesignReferenceRow[]>;
  resolveExactApproved(input: ResolveExactApprovedAiGraderDesignReferenceInput): Promise<AiGraderDesignReferenceRow>;
  approve(input: ApproveAiGraderDesignReferenceInput): Promise<AiGraderDesignReferenceRow>;
  retire(input: RetireAiGraderDesignReferenceInput): Promise<AiGraderDesignReferenceRow>;
};

export type AiGraderDesignReferenceApiDependencies = {
  requireAdminSession(req: NextApiRequest): Promise<AdminIdentity>;
  service: DesignReferenceService;
  readArtifactBytes?(storageKey: string): Promise<Uint8Array>;
  planArtifactUpload?(input: AiGraderDesignReferenceUploadPlanInput): Promise<AiGraderDesignReferenceUploadPlan>;
  uploadReceiptAuthority?: AiGraderDesignReferenceUploadReceiptAuthorityV1;
};

export type AiGraderDesignReferenceUploadPlanInput =
  AiGraderDesignReferenceUploadManifestV1;

export type AiGraderDesignReferenceUploadPlan = {
  storageKey: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  contentType: "image/png" | "image/jpeg";
  byteSize: number;
  checksumSha256: string;
};

export type AiGraderDesignReferenceSafeUploadPlan = Omit<
  AiGraderDesignReferenceUploadPlan,
  "storageKey"
> & {
  uploadReceipt: string;
  receiptExpiresAt: string;
};

type AiGraderDesignReferenceDraftReceiptBody = {
  uploadReceipt: string;
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
  side: "front" | "back";
  profile: "registered_design_template_v1";
  version: number;
  intendedDesignBoundary: unknown;
  provenance: unknown;
  transformAcceptanceMetadata: unknown;
};

const MAXIMUM_DESIGN_REFERENCE_UPLOAD_BYTES = 50 * 1024 * 1024;
const SAFE_IDENTITY_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,190}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,190}\.(?:png|jpe?g)$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export type AiGraderApprovedDesignReferenceOperatorAuthority = {
  databaseReferenceId: string;
  mathematicalReference: MathematicalDesignReferenceV1;
  artifactMimeType: "image/png" | "image/jpeg";
  intendedDesignBoundaryPixels: {
    schemaVersion: "ai-grader-intended-design-boundary-v1";
    coordinateFrame: "design_reference_pixels";
    contour: Array<[number, number]>;
  };
  registrationAcceptance: {
    schemaVersion: "ai-grader-design-reference-transform-acceptance-v1";
    registrationAlgorithmVersion: string;
    maxResidualPx: number;
    minInlierFraction: number;
  };
  provenance: {
    schemaVersion: "ai-grader-design-reference-provenance-v1";
    sourceKind: string;
    approvedForPrecisionReference: true;
  };
};

function actionFrom(req: NextApiRequest) {
  const value = Array.isArray(req.query.action) ? req.query.action : [req.query.action];
  return value.filter((part): part is string => typeof part === "string" && part.length > 0).join("/");
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Request body must be an exact JSON object."), { statusCode: 400 });
  }
  return value as Record<string, unknown>;
}

function uploadPlanInput(value: Record<string, unknown>): AiGraderDesignReferenceUploadPlanInput {
  const exactKeys = new Set([
    "tenantId", "setId", "programId", "cardNumber", "variantId", "parallelId",
    "side", "profile", "version", "fileName", "contentType", "byteSize", "checksumSha256",
  ]);
  if (Object.keys(value).some((key) => !exactKeys.has(key)) ||
      [...exactKeys].some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw Object.assign(new Error("Design-reference upload planning requires the exact identity and file manifest."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  const identityText = (field: "tenantId" | "setId" | "programId" | "cardNumber") => {
    const candidate = value[field];
    if (typeof candidate !== "string" || !SAFE_IDENTITY_TEXT.test(candidate)) {
      throw Object.assign(new Error(`Design-reference ${field} is invalid.`), {
        statusCode: 400,
        code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
      });
    }
    return candidate;
  };
  const nullableIdentityText = (field: "variantId" | "parallelId") => {
    const candidate = value[field];
    if (candidate === null) return null;
    if (typeof candidate !== "string" || !SAFE_IDENTITY_TEXT.test(candidate)) {
      throw Object.assign(new Error(`Design-reference ${field} must be an exact value or explicit null.`), {
        statusCode: 400,
        code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
      });
    }
    return candidate;
  };
  if (value.side !== "front" && value.side !== "back") {
    throw Object.assign(new Error("Design-reference side must be front or back."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  if (value.profile !== "registered_design_template_v1") {
    throw Object.assign(new Error("Design-reference profile must be registered_design_template_v1."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) {
    throw Object.assign(new Error("Design-reference version must be a positive integer."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  if (typeof value.fileName !== "string" || !SAFE_FILE_NAME.test(value.fileName)) {
    throw Object.assign(new Error("Design-reference file name must be one PNG or JPEG leaf name."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  if (value.contentType !== "image/png" && value.contentType !== "image/jpeg") {
    throw Object.assign(new Error("Design-reference content type must be image/png or image/jpeg."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  const extension = value.fileName.toLowerCase().split(".").pop();
  if ((value.contentType === "image/png" && extension !== "png") ||
      (value.contentType === "image/jpeg" && extension !== "jpg" && extension !== "jpeg")) {
    throw Object.assign(new Error("Design-reference file extension and declared content type disagree."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  if (!Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 24 ||
      Number(value.byteSize) > MAXIMUM_DESIGN_REFERENCE_UPLOAD_BYTES) {
    throw Object.assign(new Error("Design-reference byte size must be 24 bytes through 50 MiB."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  if (typeof value.checksumSha256 !== "string" || !SHA256.test(value.checksumSha256)) {
    throw Object.assign(new Error("Design-reference upload SHA-256 must be an exact lowercase digest."), {
      statusCode: 400,
      code: "AI_GRADER_DESIGN_REFERENCE_INVALID_INPUT",
    });
  }
  return {
    tenantId: identityText("tenantId"),
    setId: identityText("setId"),
    programId: identityText("programId"),
    cardNumber: identityText("cardNumber"),
    variantId: nullableIdentityText("variantId"),
    parallelId: nullableIdentityText("parallelId"),
    side: value.side,
    profile: value.profile,
    version: Number(value.version),
    fileName: value.fileName,
    contentType: value.contentType,
    byteSize: Number(value.byteSize),
    checksumSha256: value.checksumSha256,
  };
}

function exactUploadPlan(
  input: AiGraderDesignReferenceUploadPlanInput,
  value: AiGraderDesignReferenceUploadPlan,
): AiGraderDesignReferenceUploadPlan {
  const uploadHeaders = value?.uploadHeaders && typeof value.uploadHeaders === "object"
    ? Object.fromEntries(Object.entries(value.uploadHeaders).map(([name, headerValue]) => [name.toLowerCase(), String(headerValue)]))
    : {};
  if (!value || typeof value !== "object" ||
      typeof value.storageKey !== "string" || !value.storageKey || value.storageKey.includes("://") ||
      typeof value.uploadUrl !== "string" || !value.uploadUrl.startsWith("https://") ||
      value.uploadMethod !== "PUT" || !value.uploadHeaders || typeof value.uploadHeaders !== "object" ||
      uploadHeaders["x-amz-acl"] !== "private" ||
      Object.values(uploadHeaders).some((headerValue) => /public-read/i.test(headerValue)) ||
      value.contentType !== input.contentType || value.byteSize !== input.byteSize ||
      value.checksumSha256 !== input.checksumSha256) {
    throw Object.assign(new Error("Private storage returned an invalid exact design-reference upload plan."), {
      statusCode: 503,
      code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_PLAN_UNAVAILABLE",
    });
  }
  return value;
}

function safeReferenceRow(row: AiGraderDesignReferenceRow) {
  const { artifactStorageKey: _privateStorageKey, ...safe } = row;
  return safe;
}

function draftReceiptBody(value: Record<string, unknown>): AiGraderDesignReferenceDraftReceiptBody {
  const exactKeys = new Set([
    "uploadReceipt", "tenantId", "setId", "programId", "cardNumber", "variantId",
    "parallelId", "side", "profile", "version", "intendedDesignBoundary", "provenance",
    "transformAcceptanceMetadata",
  ]);
  if (Object.keys(value).length !== exactKeys.size ||
      Object.keys(value).some((key) => !exactKeys.has(key)) ||
      [...exactKeys].some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
      typeof value.uploadReceipt !== "string" || !value.uploadReceipt) {
    throw Object.assign(
      new Error("Draft creation requires one exact upload receipt, identity, version, and reference metadata."),
      {
        statusCode: 400,
        code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_INVALID",
      },
    );
  }
  return value as AiGraderDesignReferenceDraftReceiptBody;
}

function receiptIdentity(
  claims: AiGraderDesignReferenceUploadManifestV1,
): ListAiGraderDesignReferencesInput {
  return {
    tenantId: claims.tenantId,
    setId: claims.setId,
    programId: claims.programId,
    cardNumber: claims.cardNumber,
    variantId: claims.variantId,
    parallelId: claims.parallelId,
    side: claims.side,
    profile: claims.profile,
  };
}

function assertDraftMatchesReceipt(
  body: AiGraderDesignReferenceDraftReceiptBody,
  claims: AiGraderDesignReferenceUploadReceiptClaimsV1,
  adminUserId: string,
) {
  const bindingFields = [
    "tenantId", "setId", "programId", "cardNumber", "variantId", "parallelId",
    "side", "profile", "version",
  ] as const;
  if (claims.issuedToUserId !== adminUserId ||
      bindingFields.some((field) => body[field] !== claims[field])) {
    throw Object.assign(
      new Error("Draft identity, side, profile, version, or admin does not match its exact upload receipt."),
      {
        statusCode: 409,
        code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_BINDING_MISMATCH",
      },
    );
  }
}

async function assertReceiptVersionUnused(
  service: DesignReferenceService,
  claims: AiGraderDesignReferenceUploadReceiptClaimsV1 | AiGraderDesignReferenceUploadPlanInput,
) {
  const listed = await service.list(receiptIdentity(claims));
  if (listed.some((row) => row.version === claims.version)) {
    throw Object.assign(
      new Error("This exact card side/version already has an immutable design-reference record."),
      {
        statusCode: 409,
        code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_REPLAYED",
      },
    );
  }
}

async function verifyReceiptArtifactBeforeCreate(
  deps: AiGraderDesignReferenceApiDependencies,
  claims: AiGraderDesignReferenceUploadReceiptClaimsV1,
) {
  if (!deps.readArtifactBytes) {
    throw Object.assign(new Error("Private design-reference byte verification is unavailable."), {
      statusCode: 503,
      code: "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_UNAVAILABLE",
    });
  }
  let bytes: Uint8Array;
  try {
    bytes = await deps.readArtifactBytes(claims.storageKey);
  } catch {
    throw Object.assign(new Error("The receipt-bound private design-reference object could not be read."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_STORAGE_MISMATCH",
    });
  }
  const verified = inspectAiGraderDesignReferenceArtifactBytes(
    bytes,
    MAXIMUM_DESIGN_REFERENCE_UPLOAD_BYTES,
  );
  if (verified.byteLength !== claims.byteSize ||
      verified.artifactMimeType !== claims.contentType ||
      verified.artifactSha256 !== claims.checksumSha256) {
    throw Object.assign(
      new Error("The receipt-bound private object does not match its exact byte size, MIME type, and SHA-256."),
      {
        statusCode: 409,
        code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_STORAGE_MISMATCH",
      },
    );
  }
  return verified;
}

function exactString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${field} is missing from the approved design reference.`), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return value.trim();
}

function exactPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw Object.assign(new Error(`${field} is invalid on the approved design reference.`), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return Number(value);
}

function approvedReferenceTimestamp(value: unknown): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    throw Object.assign(new Error("approvedAt is invalid on the approved design reference."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return date.toISOString();
}

function exactPixelBoundary(
  value: unknown,
  widthPx: number,
  heightPx: number,
): AiGraderApprovedDesignReferenceOperatorAuthority["intendedDesignBoundaryPixels"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("The approved intended-design boundary is malformed."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  const boundary = value as Record<string, unknown>;
  if (boundary.schemaVersion !== "ai-grader-intended-design-boundary-v1" ||
      boundary.coordinateFrame !== "design_reference_pixels" ||
      !Array.isArray(boundary.contour) || boundary.contour.length < 4 || boundary.contour.length > 64) {
    throw Object.assign(new Error("The approved intended-design boundary contract is invalid."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  const contour = boundary.contour.map((entry, index): [number, number] => {
    if (!Array.isArray(entry) || entry.length !== 2 ||
        typeof entry[0] !== "number" || !Number.isFinite(entry[0]) ||
        typeof entry[1] !== "number" || !Number.isFinite(entry[1]) ||
        entry[0] < 0 || entry[0] > widthPx || entry[1] < 0 || entry[1] > heightPx) {
      throw Object.assign(new Error(`Approved intended-design point ${index} is invalid.`), {
        statusCode: 409,
        code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
      });
    }
    return [entry[0], entry[1]];
  });
  return {
    schemaVersion: "ai-grader-intended-design-boundary-v1",
    coordinateFrame: "design_reference_pixels",
    contour,
  };
}

function exactObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${field} is malformed on the approved design reference.`), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return value as Record<string, unknown>;
}

function projectedRegistrationAcceptance(
  value: unknown,
): AiGraderApprovedDesignReferenceOperatorAuthority["registrationAcceptance"] {
  const record = exactObject(value, "registrationAcceptance");
  if (record.schemaVersion !== "ai-grader-design-reference-transform-acceptance-v1" ||
      typeof record.maxResidualPx !== "number" || !Number.isFinite(record.maxResidualPx) || record.maxResidualPx < 0 ||
      typeof record.minInlierFraction !== "number" || !Number.isFinite(record.minInlierFraction) ||
      record.minInlierFraction < 0 || record.minInlierFraction > 1) {
    throw Object.assign(new Error("The approved registration acceptance policy is invalid."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return {
    schemaVersion: "ai-grader-design-reference-transform-acceptance-v1",
    registrationAlgorithmVersion: exactString(
      record.registrationAlgorithmVersion,
      "registrationAlgorithmVersion",
    ),
    maxResidualPx: record.maxResidualPx,
    minInlierFraction: record.minInlierFraction,
  };
}

function projectedProvenance(
  value: unknown,
): AiGraderApprovedDesignReferenceOperatorAuthority["provenance"] {
  const record = exactObject(value, "provenance");
  if (record.schemaVersion !== "ai-grader-design-reference-provenance-v1" ||
      record.approvedForPrecisionReference !== true) {
    throw Object.assign(new Error("The approved precision-reference provenance is invalid."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return {
    schemaVersion: "ai-grader-design-reference-provenance-v1",
    sourceKind: exactString(record.sourceKind, "provenance.sourceKind"),
    approvedForPrecisionReference: true,
  };
}

function operatorAuthority(
  row: AiGraderDesignReferenceRow,
): AiGraderApprovedDesignReferenceOperatorAuthority {
  if (row.status !== "approved" || row.profile !== "registered_design_template_v1") {
    throw Object.assign(new Error("The resolved design reference is not an approved registered-design template."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  const widthPx = exactPositiveInteger(row.artifactWidthPx, "artifactWidthPx");
  const heightPx = exactPositiveInteger(row.artifactHeightPx, "artifactHeightPx");
  const boundary = exactPixelBoundary(row.intendedDesignBoundary, widthPx, heightPx);
  const mathematicalReference = mathematicalDesignReferenceV1Schema.parse({
    schemaVersion: MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
    designReferenceId: exactString(row.id, "id"),
    profile: "registered_design_template_v1",
    tenantId: exactString(row.tenantId, "tenantId"),
    setId: exactString(row.setId, "setId"),
    programId: exactString(row.programId, "programId"),
    cardNumber: exactString(row.cardNumber, "cardNumber"),
    variantId: row.variantId === null ? null : exactString(row.variantId, "variantId"),
    parallelId: row.parallelId === null ? null : exactString(row.parallelId, "parallelId"),
    side: row.side,
    artifactId: `designref:${exactString(row.id, "id")}:artifact`,
    artifactSha256: exactString(row.artifactSha256, "artifactSha256").toLowerCase(),
    version: exactPositiveInteger(row.version, "version"),
    widthPx,
    heightPx,
    intendedPrintBoundary: boundary.contour.map(([x, y]) => ({
      x: x / widthPx,
      y: y / heightPx,
    })),
    approvedBy: exactString(row.approvedByUserId, "approvedByUserId"),
    approvedAt: approvedReferenceTimestamp(row.approvedAt),
  });
  const artifactMimeType = row.artifactMimeType;
  if (artifactMimeType !== "image/png" && artifactMimeType !== "image/jpeg") {
    throw Object.assign(new Error("The approved design-reference MIME type is unsupported."), {
      statusCode: 409,
      code: "AI_GRADER_DESIGN_REFERENCE_ROW_MISMATCH",
    });
  }
  return {
    databaseReferenceId: mathematicalReference.designReferenceId,
    mathematicalReference,
    artifactMimeType,
    intendedDesignBoundaryPixels: boundary,
    registrationAcceptance: projectedRegistrationAcceptance(row.transformAcceptanceMetadata),
    provenance: projectedProvenance(row.provenance),
  };
}

function safeError(error: unknown) {
  const row = error as { message?: unknown; statusCode?: unknown; code?: unknown };
  const code = typeof row?.code === "string" ? row.code : "AI_GRADER_DESIGN_REFERENCE_REQUEST_FAILED";
  const status = typeof row?.statusCode === "number"
    ? row.statusCode
    : code.endsWith("NOT_FOUND") ? 404
      : code.endsWith("STATE_CONFLICT") ? 409
        : code.endsWith("ARTIFACT_INTEGRITY_MISMATCH") ? 409
          : code.endsWith("ARTIFACT_READ_UNAVAILABLE") || code.endsWith("ARTIFACT_READ_FAILED") ? 503
            : code.endsWith("ARTIFACT_UNSUPPORTED") ? 400
        : code.endsWith("INVALID_INPUT") || code.endsWith("ROW_MISMATCH") ? 400
          : 500;
  return {
    status,
    code,
    message: status === 500 ? "Design-reference request failed." : String(row.message ?? "Design-reference request failed."),
  };
}

/** Admin-only exact identity/version/hash lifecycle. No loose lookup is exposed. */
export function createAiGraderDesignReferenceApiHandler(deps: AiGraderDesignReferenceApiDependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
      const admin = await deps.requireAdminSession(req);
      const action = actionFrom(req);
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed." });
      }
      const body = objectBody(req.body);
      if (action === "upload-plan") {
        if (!deps.planArtifactUpload || !deps.uploadReceiptAuthority) {
          throw Object.assign(new Error("Private design-reference direct upload is unavailable."), {
            statusCode: 503,
            code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_PLAN_UNAVAILABLE",
          });
        }
        const input = uploadPlanInput(body);
        await assertReceiptVersionUnused(deps.service, input);
        const uploadPlan = exactUploadPlan(input, await deps.planArtifactUpload(input));
        const receipt = deps.uploadReceiptAuthority.issue({
          ...input,
          storageKey: uploadPlan.storageKey,
          issuedToUserId: admin.user.id,
        });
        const safeUploadPlan: AiGraderDesignReferenceSafeUploadPlan = {
          uploadUrl: uploadPlan.uploadUrl,
          uploadMethod: uploadPlan.uploadMethod,
          uploadHeaders: { ...uploadPlan.uploadHeaders },
          contentType: uploadPlan.contentType,
          byteSize: uploadPlan.byteSize,
          checksumSha256: uploadPlan.checksumSha256,
          ...receipt,
        };
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        return res.status(200).json({ ok: true, uploadPlan: safeUploadPlan });
      }
      if (action === "list") {
        const result = await deps.service.list(body as unknown as ListAiGraderDesignReferencesInput);
        return res.status(200).json({ ok: true, references: result.map(safeReferenceRow) });
      }
      if (action === "active") {
        const identity = body as unknown as ListAiGraderDesignReferencesInput;
        const listed = await deps.service.list(identity);
        const approved = listed.filter((row) => row.status === "approved");
        if (approved.length === 0) {
          throw Object.assign(new Error("No active approved design reference exists for the exact card identity and side."), {
            statusCode: 404,
            code: "AI_GRADER_DESIGN_REFERENCE_ACTIVE_NOT_FOUND",
          });
        }
        if (approved.length !== 1) {
          throw Object.assign(new Error("More than one active approved design reference exists for the exact card identity and side."), {
            statusCode: 409,
            code: "AI_GRADER_DESIGN_REFERENCE_ACTIVE_STATE_CONFLICT",
          });
        }
        const selected = approved[0]!;
        const result = await deps.service.resolveExactApproved({
          ...identity,
          version: selected.version,
          expectedArtifactSha256: selected.artifactSha256,
        });
        return res.status(200).json({ ok: true, authority: operatorAuthority(result) });
      }
      if (action === "resolve") {
        const result = await deps.service.resolveExactApproved(
          body as unknown as ResolveExactApprovedAiGraderDesignReferenceInput,
        );
        return res.status(200).json({ ok: true, authority: operatorAuthority(result) });
      }
      if (action === "artifact") {
        if (!deps.readArtifactBytes) {
          throw Object.assign(new Error("Private design-reference byte transport is unavailable."), {
            statusCode: 503,
            code: "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_READ_UNAVAILABLE",
          });
        }
        const result = await deps.service.resolveExactApproved(
          body as unknown as ResolveExactApprovedAiGraderDesignReferenceInput,
        );
        const authority = operatorAuthority(result);
        const bytes = Buffer.from(await deps.readArtifactBytes(result.artifactStorageKey));
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        if (actualSha256 !== authority.mathematicalReference.artifactSha256) {
          throw Object.assign(new Error("Current private design-reference bytes changed after exact resolution."), {
            statusCode: 409,
            code: "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_INTEGRITY_MISMATCH",
          });
        }
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.setHeader("Content-Type", authority.artifactMimeType);
        res.setHeader("Content-Length", String(bytes.byteLength));
        res.setHeader("X-Ten-Kings-Design-Reference-Id", authority.databaseReferenceId);
        res.setHeader("X-Ten-Kings-Design-Reference-Sha256", actualSha256);
        res.status(200);
        return res.send(bytes);
      }
      if (action === "draft") {
        if (!deps.uploadReceiptAuthority) {
          throw Object.assign(new Error("Exact design-reference upload receipt verification is unavailable."), {
            statusCode: 503,
            code: "AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_UNAVAILABLE",
          });
        }
        const draft = draftReceiptBody(body);
        const claims = deps.uploadReceiptAuthority.verify(draft.uploadReceipt);
        assertDraftMatchesReceipt(draft, claims, admin.user.id);
        await assertReceiptVersionUnused(deps.service, claims);
        await verifyReceiptArtifactBeforeCreate(deps, claims);
        const result = await deps.service.createVerifiedDraft({
          ...receiptIdentity(claims),
          version: claims.version,
          artifactStorageKey: claims.storageKey,
          expectedArtifactByteSize: claims.byteSize,
          expectedArtifactMimeType: claims.contentType,
          expectedArtifactSha256: claims.checksumSha256,
          intendedDesignBoundary: draft.intendedDesignBoundary,
          provenance: draft.provenance,
          transformAcceptanceMetadata: draft.transformAcceptanceMetadata,
          createdByUserId: admin.user.id,
        } as CreateVerifiedAiGraderDesignReferenceDraftInput);
        return res.status(201).json({ ok: true, reference: safeReferenceRow(result) });
      }
      if (action === "approve") {
        const result = await deps.service.approve({
          ...(body as unknown as Omit<ApproveAiGraderDesignReferenceInput, "approvedByUserId">),
          approvedByUserId: admin.user.id,
        });
        return res.status(200).json({ ok: true, reference: safeReferenceRow(result) });
      }
      if (action === "retire") {
        const result = await deps.service.retire({
          ...(body as unknown as Omit<RetireAiGraderDesignReferenceInput, "retiredByUserId">),
          retiredByUserId: admin.user.id,
        });
        return res.status(200).json({ ok: true, reference: safeReferenceRow(result) });
      }
      return res.status(404).json({ ok: false, code: "ACTION_NOT_FOUND", message: "Unknown exact design-reference action." });
    } catch (error) {
      const failure = safeError(error);
      return res.status(failure.status).json({ ok: false, code: failure.code, message: failure.message });
    }
  };
}
