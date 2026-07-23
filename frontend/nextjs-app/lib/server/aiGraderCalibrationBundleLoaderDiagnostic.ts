const EVENT_NAME =
  "ai_grader_calibration_snapshot_canonical_bundle_loader_failed" as const;
const MAX_MESSAGE_LENGTH = 512;
const SAFE_PROVIDER_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;

type ErrorRecord = Record<string, unknown> & {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  Code?: unknown;
  requestId?: unknown;
  $metadata?: unknown;
};

export type AiGraderCalibrationBundleLoaderFailureEvent = {
  event: typeof EVENT_NAME;
  errorName: string;
  message: string;
  providerCode: string | null;
  httpStatusCode: number | null;
  requestId: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeIdentifier(
  value: unknown,
  pattern: RegExp,
  fallback: string | null,
) {
  return typeof value === "string" && pattern.test(value) ? value : fallback;
}

function sanitizedMessage(value: unknown) {
  const source = typeof value === "string" && value.trim()
    ? value
    : "Canonical calibration-bundle loader failed without a provider message.";
  return source
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(/(?:https?|s3):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(
      /\b([A-Za-z0-9_-]*(?:x-amz-(?:credential|signature|security-token)|authorization|bearer|token|password|private[_-]?key|access[_-]?key(?:[_-]?id)?|secret(?:[_-]?access)?[_-]?key|payload|request[_-]?body|object[_-]?bytes|environment)[A-Za-z0-9_-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_ACCESS_KEY]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[REDACTED_PATH]")
    .replace(
      /(?:[A-Za-z0-9._~-]+\/){2,}[A-Za-z0-9._~!$&'()*+,;=:@%/-]+/g,
      "[REDACTED_PATH]",
    )
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, "[REDACTED_VALUE]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH) ||
    "Canonical calibration-bundle loader failed with a fully redacted provider message.";
}

/** Produces only bounded, non-payload diagnostics suitable for server logs. */
export function calibrationBundleLoaderFailureEvent(
  error: unknown,
): AiGraderCalibrationBundleLoaderFailureEvent {
  const source = record(error) as ErrorRecord | null;
  const metadata = record(source?.$metadata);
  const status = metadata?.httpStatusCode;
  return {
    event: EVENT_NAME,
    errorName: safeIdentifier(source?.name, SAFE_PROVIDER_ID, "Error")!,
    message: sanitizedMessage(source?.message),
    providerCode: safeIdentifier(
      source?.code ?? source?.Code,
      SAFE_PROVIDER_ID,
      null,
    ),
    httpStatusCode:
      Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599
        ? Number(status)
        : null,
    requestId: safeIdentifier(
      metadata?.requestId ?? source?.requestId,
      SAFE_REQUEST_ID,
      null,
    ),
  };
}

export function withCalibrationBundleLoaderDiagnostics<TInput, TResult>(
  loader: (input: TInput) => Promise<TResult>,
  emit: (event: AiGraderCalibrationBundleLoaderFailureEvent) => void =
    (event) => console.error(event),
) {
  return async (input: TInput): Promise<TResult> => {
    try {
      return await loader(input);
    } catch (error) {
      try {
        emit(calibrationBundleLoaderFailureEvent(error));
      } catch {
        // Diagnostics must never replace or mutate the loader's exact failure.
      }
      throw error;
    }
  };
}
