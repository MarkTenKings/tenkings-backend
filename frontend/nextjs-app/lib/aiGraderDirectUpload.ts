export type AiGraderDirectUploadPurpose = "ocr" | "publish" | "slab-photo";
export type AiGraderDirectUploadErrorCode = "invalid_plan" | "network" | "http";

export class AiGraderDirectUploadError extends Error {
  readonly code: AiGraderDirectUploadErrorCode;
  readonly status?: number;

  constructor(code: AiGraderDirectUploadErrorCode, status?: number) {
    const message = code === "invalid_plan"
      ? "Direct storage upload plan is invalid."
      : code === "network"
        ? "Direct storage upload could not reach storage."
        : "Direct storage upload was rejected by storage" +
          (Number.isInteger(status) ? " (HTTP " + status + ")." : ".");
    super(message);
    this.name = "AiGraderDirectUploadError";
    this.code = code;
    this.status = status;
  }
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function checksumBase64ToHex(value: string) {
  const normalized = value.trim();
  if (!SHA256_BASE64_PATTERN.test(normalized)) return null;
  let decoded: string;
  try {
    decoded = atob(normalized);
  } catch {
    return null;
  }
  if (decoded.length !== 32) return null;
  return Array.from(decoded, (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

export function sanitizeAiGraderDirectUploadHeaders(
  headers: Record<string, string> | undefined,
  contentType: string,
  checksumSha256: string,
) {
  const expectedChecksum = checksumSha256.trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(expectedChecksum) || !contentType.trim()) {
    throw new AiGraderDirectUploadError("invalid_plan");
  }
  const safeHeaders: Record<string, string> = {};
  let checksumHeaderCount = 0;
  let contentTypeHeaderCount = 0;
  let aclHeaderCount = 0;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName || normalizedName === "x-amz-meta-sha256") continue;
    if (normalizedName === "x-amz-checksum-sha256") {
      checksumHeaderCount += 1;
      if (checksumBase64ToHex(String(value)) !== expectedChecksum) {
        throw new AiGraderDirectUploadError("invalid_plan");
      }
      safeHeaders["x-amz-checksum-sha256"] = String(value).trim();
      continue;
    }
    if (normalizedName === "content-type") {
      contentTypeHeaderCount += 1;
      if (String(value).trim().toLowerCase() !== contentType.trim().toLowerCase()) {
        throw new AiGraderDirectUploadError("invalid_plan");
      }
      continue;
    }
    if (normalizedName === "x-amz-acl") {
      aclHeaderCount += 1;
      safeHeaders["x-amz-acl"] = String(value);
    }
  }
  if (checksumHeaderCount !== 1 || contentTypeHeaderCount > 1 || aclHeaderCount > 1) {
    throw new AiGraderDirectUploadError("invalid_plan");
  }
  safeHeaders["Content-Type"] = contentType;
  return safeHeaders;
}

export async function uploadAiGraderArtifactDirectly(
  input: {
    purpose: AiGraderDirectUploadPurpose;
    uploadUrl: string;
    uploadMethod?: string;
    uploadHeaders?: Record<string, string>;
    contentType: string;
    checksumSha256: string;
    body: BodyInit;
  },
  fetchImpl: typeof fetch = fetch,
) {
  let target: URL;
  try {
    target = new URL(input.uploadUrl);
  } catch {
    throw new AiGraderDirectUploadError("invalid_plan");
  }
  if (target.protocol !== "https:" || target.username || target.password ||
      (input.uploadMethod ?? "PUT").toUpperCase() !== "PUT" || !input.contentType.trim()) {
    throw new AiGraderDirectUploadError("invalid_plan");
  }
  const uploadHeaders = sanitizeAiGraderDirectUploadHeaders(
    input.uploadHeaders,
    input.contentType,
    input.checksumSha256,
  );
  let response: Response;
  try {
    response = await fetchImpl(input.uploadUrl, {
      method: "PUT",
      mode: "cors",
      credentials: "omit",
      headers: uploadHeaders,
      body: input.body,
    });
  } catch {
    throw new AiGraderDirectUploadError("network");
  }
  if (!response.ok) throw new AiGraderDirectUploadError("http", response.status);
}
