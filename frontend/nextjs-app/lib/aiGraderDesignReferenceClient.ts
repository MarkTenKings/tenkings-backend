import {
  mathematicalDesignReferenceV1Schema,
  type MathematicalDesignReferenceV1,
} from "@tenkings/shared";

export const AI_GRADER_DESIGN_REFERENCE_API_ROOT =
  "/api/admin/ai-grader/design-references" as const;
export const AI_GRADER_DESIGN_REFERENCE_MAX_BYTES = 64 * 1024 * 1024;

export type AiGraderExactDesignReferenceIdentity = {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
  side: "front" | "back";
  profile: "registered_design_template_v1";
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
  registrationAcceptance: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

export type AiGraderExactDesignReferenceArtifact = {
  referenceId: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  bytes: Uint8Array;
};

function exactIdentityString(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,190}$/.test(normalized)) {
    throw new Error(`Exact design-reference ${field} is invalid.`);
  }
  return normalized;
}

function nullableIdentityString(value: string | null, field: string): string | null {
  if (value === null) return null;
  return exactIdentityString(value, field);
}

export function normalizeAiGraderExactDesignReferenceIdentity(
  input: AiGraderExactDesignReferenceIdentity,
): AiGraderExactDesignReferenceIdentity {
  if (input.side !== "front" && input.side !== "back") {
    throw new Error("Exact design-reference side must be front or back.");
  }
  if (input.profile !== "registered_design_template_v1") {
    throw new Error("Exact design-reference profile must be registered_design_template_v1.");
  }
  return {
    tenantId: exactIdentityString(input.tenantId, "tenantId"),
    setId: exactIdentityString(input.setId, "setId"),
    programId: exactIdentityString(input.programId, "programId"),
    cardNumber: exactIdentityString(input.cardNumber, "cardNumber"),
    variantId: nullableIdentityString(input.variantId, "variantId"),
    parallelId: nullableIdentityString(input.parallelId, "parallelId"),
    side: input.side,
    profile: input.profile,
  };
}

async function jsonFailure(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as {
    message?: unknown;
    code?: unknown;
  };
  const message = typeof payload.message === "string" && payload.message.trim()
    ? payload.message.trim()
    : fallback;
  const error = new Error(message) as Error & { code?: string; status?: number };
  if (typeof payload.code === "string") error.code = payload.code;
  error.status = response.status;
  return error;
}

function exactAuthority(value: unknown): AiGraderApprovedDesignReferenceOperatorAuthority {
  if (!value || typeof value !== "object") {
    throw new Error("The design-reference resolver returned no exact authority.");
  }
  const candidate = value as Record<string, unknown>;
  const mathematicalReference = mathematicalDesignReferenceV1Schema.parse(
    candidate.mathematicalReference,
  );
  if (
    typeof candidate.databaseReferenceId !== "string" ||
    candidate.databaseReferenceId !== mathematicalReference.designReferenceId
  ) {
    throw new Error("The resolved database and Mathematical V1 reference identities disagree.");
  }
  if (candidate.artifactMimeType !== "image/png" && candidate.artifactMimeType !== "image/jpeg") {
    throw new Error("The resolved design-reference artifact MIME type is unsupported.");
  }
  const boundary = candidate.intendedDesignBoundaryPixels;
  if (!boundary || typeof boundary !== "object") {
    throw new Error("The resolved design-reference pixel boundary is absent.");
  }
  const pixelBoundary = boundary as Record<string, unknown>;
  if (
    pixelBoundary.schemaVersion !== "ai-grader-intended-design-boundary-v1" ||
    pixelBoundary.coordinateFrame !== "design_reference_pixels" ||
    !Array.isArray(pixelBoundary.contour)
  ) {
    throw new Error("The resolved design-reference pixel boundary is malformed.");
  }
  return {
    databaseReferenceId: candidate.databaseReferenceId,
    mathematicalReference,
    artifactMimeType: candidate.artifactMimeType,
    intendedDesignBoundaryPixels: boundary as AiGraderApprovedDesignReferenceOperatorAuthority["intendedDesignBoundaryPixels"],
    registrationAcceptance:
      candidate.registrationAcceptance && typeof candidate.registrationAcceptance === "object"
        ? candidate.registrationAcceptance as Record<string, unknown>
        : {},
    provenance:
      candidate.provenance && typeof candidate.provenance === "object"
        ? candidate.provenance as Record<string, unknown>
        : {},
  };
}

export async function resolveActiveAiGraderDesignReference(input: {
  identity: AiGraderExactDesignReferenceIdentity;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<AiGraderApprovedDesignReferenceOperatorAuthority> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${AI_GRADER_DESIGN_REFERENCE_API_ROOT}/active`, {
    method: "POST",
    headers: { ...input.headers, "content-type": "application/json" },
    body: JSON.stringify(normalizeAiGraderExactDesignReferenceIdentity(input.identity)),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await jsonFailure(response, "The active approved design reference could not be resolved.");
  }
  const payload = await response.json().catch(() => ({})) as {
    ok?: unknown;
    authority?: unknown;
  };
  if (payload.ok !== true) {
    throw new Error("The active design-reference response was not successful.");
  }
  return exactAuthority(payload.authority);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Browser SHA-256 verification is unavailable.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function fetchExactAiGraderDesignReferenceArtifact(input: {
  identity: AiGraderExactDesignReferenceIdentity;
  authority: AiGraderApprovedDesignReferenceOperatorAuthority;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<AiGraderExactDesignReferenceArtifact> {
  const identity = normalizeAiGraderExactDesignReferenceIdentity(input.identity);
  const reference = input.authority.mathematicalReference;
  if (
    reference.tenantId !== identity.tenantId || reference.setId !== identity.setId ||
    reference.programId !== identity.programId || reference.cardNumber !== identity.cardNumber ||
    reference.variantId !== identity.variantId || reference.parallelId !== identity.parallelId ||
    reference.side !== identity.side
  ) {
    throw new Error("The approved design reference does not match the exact requested card identity and side.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${AI_GRADER_DESIGN_REFERENCE_API_ROOT}/artifact`, {
    method: "POST",
    headers: { ...input.headers, "content-type": "application/json" },
    body: JSON.stringify({
      ...identity,
      version: reference.version,
      expectedArtifactSha256: reference.artifactSha256,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw await jsonFailure(response, "The exact approved design-reference bytes could not be read.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 ||
      contentLength > AI_GRADER_DESIGN_REFERENCE_MAX_BYTES) {
    throw new Error("The design-reference response has an invalid or oversized Content-Length.");
  }
  const mimeType = response.headers.get("content-type");
  const referenceId = response.headers.get("x-ten-kings-design-reference-id");
  const declaredSha256 = response.headers.get("x-ten-kings-design-reference-sha256");
  if (
    mimeType !== input.authority.artifactMimeType ||
    referenceId !== input.authority.databaseReferenceId ||
    declaredSha256 !== reference.artifactSha256
  ) {
    throw new Error("The design-reference response headers do not match the resolved exact authority.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== contentLength || bytes.byteLength > AI_GRADER_DESIGN_REFERENCE_MAX_BYTES) {
    throw new Error("The design-reference byte length does not match its bounded response authority.");
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== reference.artifactSha256) {
    throw new Error("The downloaded design-reference bytes do not match the approved SHA-256.");
  }
  return {
    referenceId,
    sha256: actualSha256,
    mimeType,
    bytes,
  };
}
