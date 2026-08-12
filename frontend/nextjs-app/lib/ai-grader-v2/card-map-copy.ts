export function toCardMapOperatorMessage(message: string): string {
  return message.replace(/\btrain\b/gi, "CARD MAP");
}

export type CardMapSafeFailure = Readonly<{
  message?: unknown;
  code?: unknown;
  diagnostics?: unknown;
}>;

const FAILURE_STAGES = new Set([
  "VALIDATION",
  "SOURCE",
  "EVIDENCE",
  "TRANSACTION",
  "PERSISTED_HASH_VERIFICATION",
]);

export function toCardMapSaveFailure(payload: CardMapSafeFailure, fallback: string) {
  const message = typeof payload.message === "string" && payload.message.trim()
    ? toCardMapOperatorMessage(payload.message.trim()).slice(0, 360)
    : fallback;
  const code = typeof payload.code === "string" && /^[A-Z0-9_]{3,80}$/.test(payload.code)
    ? payload.code
    : null;
  const raw = payload.diagnostics;
  const diagnostics = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  const stage = typeof diagnostics?.stage === "string" && FAILURE_STAGES.has(diagnostics.stage)
    ? diagnostics.stage
    : null;
  const scope = diagnostics?.scope === "FAMILY" || diagnostics?.scope === "EXACT"
    ? diagnostics.scope
    : null;
  const field = typeof diagnostics?.field === "string" && /^[a-zA-Z0-9_.[\]-]{1,120}$/.test(diagnostics.field)
    ? diagnostics.field
    : null;
  const detail = [code, stage, scope, field].filter(Boolean).join(" · ");
  return detail ? `${message} (${detail})` : message;
}
