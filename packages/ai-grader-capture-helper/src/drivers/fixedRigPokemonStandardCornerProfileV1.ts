import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER,
  POKEMON_TCG_STANDARD_CORNER_PROFILE,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
  canonicalJsonV1,
  trustedPokemonCardFormatAuthorityV1Schema,
  type TrustedPokemonCardFormatAuthorityV1,
} from "@tenkings/shared";
import type { FixedRigMathematicalCardIdentityV1 } from "./fixedRigMathematicalCalibrationOrchestratorV1";
import {
  buildFixedRigRoundedRectangleBoundaryV1,
} from "./fixedRigStandardCardFormatV1";

export const FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID =
  POKEMON_TCG_STANDARD_CORNER_PROFILE_ID;
export const FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_VERSION =
  POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function verifyPokemonTcgStandardCornerProfileBytesV1(input: {
  bytes?: Uint8Array;
  declaredSha256?: string;
} = {}) {
  const bytes = input.bytes ?? Buffer.from(
    POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON,
    "utf8",
  );
  const declaredSha256 = input.declaredSha256 ??
    POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256;
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== declaredSha256 ||
      observedSha256 !== POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256) {
    throw new Error("Pokémon standard corner-profile bytes do not match the canonical SHA-256.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Pokémon standard corner-profile bytes are not exact JSON.");
  }
  if (canonicalJsonV1(parsed) !== POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON ||
      JSON.stringify(parsed) !== JSON.stringify(POKEMON_TCG_STANDARD_CORNER_PROFILE)) {
    throw new Error("Pokémon standard corner-profile bytes are not canonical.");
  }
  return {
    profile: POKEMON_TCG_STANDARD_CORNER_PROFILE,
    artifactSha256: observedSha256,
  };
}

function exactIdentityMatches(
  left: TrustedPokemonCardFormatAuthorityV1["artifact"]["cardIdentity"],
  right: FixedRigMathematicalCardIdentityV1,
): boolean {
  return left.title === right.title && left.sideCount === right.sideCount &&
    left.tenantId === right.tenantId && left.setId === right.setId &&
    left.programId === right.programId && left.cardNumber === right.cardNumber &&
    left.variantId === right.variantId && left.parallelId === right.parallelId;
}

export function verifyTrustedPokemonCardFormatAuthorityV1(input: {
  authority: unknown;
  hmacKey: string | undefined;
  expectedKeyId: string | undefined;
  expectedCardIdentity?: FixedRigMathematicalCardIdentityV1;
}): TrustedPokemonCardFormatAuthorityV1 {
  verifyPokemonTcgStandardCornerProfileBytesV1();
  const parsed = trustedPokemonCardFormatAuthorityV1Schema.safeParse(input.authority);
  if (!parsed.success) {
    throw new Error("Trusted Pokémon card-format authority does not match the strict V1 contract.");
  }
  if (!input.hmacKey || Buffer.byteLength(input.hmacKey, "utf8") < 32 ||
      !input.expectedKeyId || parsed.data.authentication.keyId !== input.expectedKeyId) {
    throw new Error("Trusted Pokémon card-format authority verification is not configured for this station.");
  }
  const artifactBytes = canonicalJsonV1(parsed.data.artifact);
  const observedArtifactSha256 = sha256(artifactBytes);
  if (observedArtifactSha256 !== parsed.data.artifactSha256) {
    throw new Error("Trusted Pokémon card-format authority artifact SHA-256 is invalid.");
  }
  const expectedSignature = createHmac("sha256", input.hmacKey)
    .update(artifactBytes, "utf8")
    .digest("hex");
  if (!sameSecret(expectedSignature, parsed.data.authentication.signature)) {
    throw new Error("Trusted Pokémon card-format authority signature is invalid.");
  }
  if (input.expectedCardIdentity &&
      !exactIdentityMatches(parsed.data.artifact.cardIdentity, input.expectedCardIdentity)) {
    throw new Error("Trusted Pokémon physical-format authority does not match the exact card identity.");
  }
  return structuredClone(parsed.data);
}

export function buildFixedRigPokemonTcgStandardBoundaryV1(input: {
  normalizedWidthPx: number;
  normalizedHeightPx: number;
}) {
  verifyPokemonTcgStandardCornerProfileBytesV1();
  return buildFixedRigRoundedRectangleBoundaryV1({
    normalizedWidthPx: input.normalizedWidthPx,
    normalizedHeightPx: input.normalizedHeightPx,
    profileId: POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
    profileVersion: POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
    widthMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM,
    heightMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM,
    radiusMm: POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM,
    contourArcSegmentsPerCorner:
      POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER,
  });
}
