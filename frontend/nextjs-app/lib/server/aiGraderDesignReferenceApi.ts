import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "node:crypto";
import {
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  mathematicalDesignReferenceV1Schema,
  type MathematicalDesignReferenceV1,
} from "@tenkings/shared";
import type {
  AiGraderDesignReferenceRow,
  ApproveAiGraderDesignReferenceInput,
  CreateVerifiedAiGraderDesignReferenceDraftInput,
  ListAiGraderDesignReferencesInput,
  ResolveExactApprovedAiGraderDesignReferenceInput,
  RetireAiGraderDesignReferenceInput,
} from "@tenkings/database";

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
};

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
      if (action === "list") {
        const result = await deps.service.list(body as unknown as ListAiGraderDesignReferencesInput);
        return res.status(200).json({ ok: true, references: result });
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
        const result = await deps.service.createVerifiedDraft({
          ...(body as unknown as Omit<CreateVerifiedAiGraderDesignReferenceDraftInput, "createdByUserId">),
          createdByUserId: admin.user.id,
        });
        return res.status(201).json({ ok: true, reference: result });
      }
      if (action === "approve") {
        const result = await deps.service.approve({
          ...(body as unknown as Omit<ApproveAiGraderDesignReferenceInput, "approvedByUserId">),
          approvedByUserId: admin.user.id,
        });
        return res.status(200).json({ ok: true, reference: result });
      }
      if (action === "retire") {
        const result = await deps.service.retire({
          ...(body as unknown as Omit<RetireAiGraderDesignReferenceInput, "retiredByUserId">),
          retiredByUserId: admin.user.id,
        });
        return res.status(200).json({ ok: true, reference: result });
      }
      return res.status(404).json({ ok: false, code: "ACTION_NOT_FOUND", message: "Unknown exact design-reference action." });
    } catch (error) {
      const failure = safeError(error);
      return res.status(failure.status).json({ ok: false, code: failure.code, message: failure.message });
    }
  };
}
