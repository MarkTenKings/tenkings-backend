import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN,
  aiGraderReportBundleV03Schema,
  canonicalJsonV1,
  type AiGraderReportBundleV03,
  type TrustedPokemonCardFormatAuthorityV1,
} from "@tenkings/shared";
import { aiGraderMathematicalReleaseEnvelopeIssue } from "../aiGraderMathematicalReportV1";
import {
  AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV,
  AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV,
} from "./aiGraderTrustedCardFormatAuthority";

export { aiGraderMathematicalReleaseEnvelopeIssue } from "../aiGraderMathematicalReportV1";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export type AiGraderMathematicalBoundaryResult =
  | { success: true; bundle: AiGraderReportBundleV03 }
  | { success: false; message: string };

export function aiGraderTrustedPokemonCardFormatAuthorityIssue(
  trustedAuthority: TrustedPokemonCardFormatAuthorityV1,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV]?.trim() ?? "";
  const keyId = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV]?.trim() ?? "";
  if (Buffer.byteLength(key, "utf8") < 32 || !keyId ||
      trustedAuthority.authentication.keyId !== keyId) {
    return "Trusted Pokémon profile publication verification is not configured for this Production boundary.";
  }
  const artifactBytes = canonicalJsonV1(trustedAuthority.artifact);
  const artifactSha256 = createHash("sha256").update(artifactBytes, "utf8").digest("hex");
  const signature = createHmac("sha256", key).update(artifactBytes, "utf8").digest("hex");
  const supplied = Buffer.from(trustedAuthority.authentication.signature, "hex");
  const expected = Buffer.from(signature, "hex");
  if (artifactSha256 !== trustedAuthority.artifactSha256 ||
      supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    return "Trusted Pokémon card-format authority authentication failed at the Production boundary.";
  }
  return undefined;
}

export function aiGraderTrustedPokemonCornerMeasurementAuthorityIssue(
  authority: NonNullable<AiGraderReportBundleV03["pokemonStandardCornerAuthority"]>,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ENV]?.trim() ?? "";
  const keyId = env[AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID_ENV]?.trim() ?? "";
  const measurementAuthority = authority.productionMeasurementAuthority;
  if (Buffer.byteLength(key, "utf8") < 32 || !keyId ||
      measurementAuthority.authentication.keyId !== keyId) {
    return "Trusted Pokémon corner-measurement publication verification is not configured for this Production boundary.";
  }
  const artifactBytes = canonicalJsonV1(measurementAuthority.artifact);
  const artifactSha256 = createHash("sha256").update(artifactBytes, "utf8").digest("hex");
  const signature = createHmac("sha256", key)
    .update(POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN, "utf8")
    .update(artifactBytes, "utf8")
    .digest("hex");
  const supplied = Buffer.from(measurementAuthority.authentication.signature, "hex");
  const expected = Buffer.from(signature, "hex");
  if (artifactSha256 !== measurementAuthority.artifactSha256 ||
      supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    return "Trusted Pokémon corner measurements were not produced by the authenticated station analyzer.";
  }
  return undefined;
}

/** Strict schema validation also recomputes every formula, U95, deduction, cap, and four-element score. */
export function parseAiGraderMathematicalBoundaryBundle(
  value: unknown,
  env: Record<string, string | undefined> = process.env,
): AiGraderMathematicalBoundaryResult {
  if (!isRecord(value) || value.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    return { success: false, message: "A strict Mathematical Grading V1 report bundle v0.3 is required." };
  }
  const parsed = aiGraderReportBundleV03Schema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "bundle"}: ${issue.message}`).join("; ");
    return { success: false, message: `Mathematical Grading V1 validation failed: ${detail}` };
  }
  const pokemonAuthority = parsed.data.pokemonStandardCornerAuthority;
  if (pokemonAuthority) {
    const cardIssue = aiGraderTrustedPokemonCardFormatAuthorityIssue(
      pokemonAuthority.trustedCardFormatAuthority,
      env,
    );
    if (cardIssue) return { success: false, message: cardIssue };
    const measurementIssue = aiGraderTrustedPokemonCornerMeasurementAuthorityIssue(
      pokemonAuthority,
      env,
    );
    if (measurementIssue) return { success: false, message: measurementIssue };
  }
  return { success: true, bundle: parsed.data };
}

export function aiGraderMathematicalNormalizedEvidenceIssue(bundle: AiGraderReportBundleV03): string | undefined {
  const expectedWidth = bundle.calibrationProfile.normalizedWidthPx;
  const expectedHeight = bundle.calibrationProfile.normalizedHeightPx;
  const normalized = bundle.publicAssets.filter((asset) => asset.evidenceRole === "normalized_card");
  const valid = (side: "front" | "back") => normalized.filter((asset) => {
    const digest = asset.checksumSha256 ?? asset.sha256;
    return asset.side === side &&
      asset.contentType === "image/png" &&
      asset.widthPx === expectedWidth &&
      asset.heightPx === expectedHeight &&
      typeof digest === "string" && /^[a-f0-9]{64}$/i.test(digest) &&
      Number.isSafeInteger(asset.byteSize) && Number(asset.byteSize) > 0;
  });
  if (normalized.length !== 2 || valid("front").length !== 1 || valid("back").length !== 1) {
    return "Confirm Card requires one immutable normalized PNG for each side at the finalized calibration dimensions.";
  }
  return undefined;
}
