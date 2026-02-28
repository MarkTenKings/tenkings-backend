export type OcrLlmAttemptFormat = "json_schema" | "json_object";

export type OcrLlmAttempt = {
  model: string;
  format: OcrLlmAttemptFormat;
};

export type OcrLlmAttemptResult<TParsed> = {
  ok: boolean;
  status: number;
  bodyText: string;
  parsed: TParsed | null;
};

export type ResolveOcrLlmAttemptInput<TParsed> = {
  primaryModel: string;
  fallbackModel?: string | null;
  execute: (attempt: OcrLlmAttempt) => Promise<OcrLlmAttemptResult<TParsed>>;
};

export type ResolveOcrLlmAttemptOutput<TParsed> = {
  attempt: OcrLlmAttempt;
  parsed: TParsed;
  fallbackUsed: boolean;
};

export function isStructuredOutputUnsupported(status: number, body: string): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  const normalized = String(body || "").toLowerCase();
  return (
    (normalized.includes("structured output") || normalized.includes("json_schema")) &&
    (normalized.includes("not support") || normalized.includes("unsupported"))
  );
}

export function isRetryableAttemptFailure(status: number, body: string): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  const normalized = String(body || "").toLowerCase();
  if (!normalized) {
    return status === 404;
  }
  const mentionsModel = normalized.includes("model");
  const unavailable =
    normalized.includes("not found") ||
    normalized.includes("does not exist") ||
    normalized.includes("unsupported value") ||
    normalized.includes("not available") ||
    normalized.includes("permission") ||
    normalized.includes("access denied");
  return mentionsModel && unavailable;
}

export function buildOcrLlmAttemptPlan(primaryModel: string, fallbackModel?: string | null): OcrLlmAttempt[] {
  const primary = String(primaryModel || "").trim();
  if (!primary) {
    return [];
  }

  const attempts: OcrLlmAttempt[] = [
    { model: primary, format: "json_schema" },
    { model: primary, format: "json_object" },
  ];

  const fallback = String(fallbackModel || "").trim();
  if (fallback && fallback !== primary) {
    attempts.push({ model: fallback, format: "json_schema" });
    attempts.push({ model: fallback, format: "json_object" });
  }

  return attempts;
}

export async function resolveOcrLlmAttempt<TParsed>(
  params: ResolveOcrLlmAttemptInput<TParsed>
): Promise<ResolveOcrLlmAttemptOutput<TParsed> | null> {
  const primary = String(params.primaryModel || "").trim();
  const attempts = buildOcrLlmAttemptPlan(primary, params.fallbackModel);
  if (!attempts.length) {
    return null;
  }

  for (const attempt of attempts) {
    const result = await params.execute(attempt);

    if (!result.ok) {
      if (attempt.format === "json_schema" && isStructuredOutputUnsupported(result.status, result.bodyText)) {
        continue;
      }
      if (isRetryableAttemptFailure(result.status, result.bodyText)) {
        continue;
      }
      throw new Error(
        `OpenAI responses parse failed (${result.status}) [${attempt.model}/${attempt.format}]: ${result.bodyText}`
      );
    }

    if (result.parsed == null) {
      continue;
    }

    return {
      attempt,
      parsed: result.parsed,
      fallbackUsed: attempt.model !== primary || attempt.format !== "json_schema",
    };
  }

  return null;
}
