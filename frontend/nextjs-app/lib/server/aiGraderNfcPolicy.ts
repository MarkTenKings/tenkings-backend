export const AI_GRADER_NFC_REQUIRED_ENV = "AI_GRADER_NFC_REQUIRED" as const;

type EnvLike = Record<string, string | undefined>;

/**
 * NFC is an additive inventory policy and remains disabled unless production
 * operators explicitly enable the exact server-side flag.
 */
export function aiGraderNfcRequired(env: EnvLike = process.env) {
  return env[AI_GRADER_NFC_REQUIRED_ENV] === "true";
}
