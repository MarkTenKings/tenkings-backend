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

const FORBIDDEN_SHA_HEADERS = new Set([
  "x-amz-meta-sha256",
  "x-amz-checksum-sha256",
]);

export function sanitizeAiGraderDirectUploadHeaders(
  headers: Record<string, string> | undefined,
  contentType: string,
) {
  const safeHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName || FORBIDDEN_SHA_HEADERS.has(normalizedName) || normalizedName === "content-type") continue;
    safeHeaders[name] = String(value);
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
  let response: Response;
  try {
    response = await fetchImpl(input.uploadUrl, {
      method: "PUT",
      mode: "cors",
      credentials: "omit",
      headers: sanitizeAiGraderDirectUploadHeaders(input.uploadHeaders, input.contentType),
      body: input.body,
    });
  } catch {
    throw new AiGraderDirectUploadError("network");
  }
  if (!response.ok) throw new AiGraderDirectUploadError("http", response.status);
}
