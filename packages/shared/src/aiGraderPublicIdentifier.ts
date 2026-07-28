export const AI_GRADER_SAFE_PUBLIC_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isSafeAiGraderPublicIdentifier(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    AI_GRADER_SAFE_PUBLIC_IDENTIFIER_PATTERN.test(value)
  );
}

export function canonicalizeAiGraderPublicIdentifier(
  value: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (AI_GRADER_SAFE_PUBLIC_IDENTIFIER_PATTERN.test(trimmed)) return trimmed;
  const canonical = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^[._:-]+|[._:-]+$/g, "");
  return isSafeAiGraderPublicIdentifier(canonical)
    ? canonical
    : null;
}
