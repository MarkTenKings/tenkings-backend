import { z } from "zod";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
} from "./aiGraderMathematicalCalibrationV1";

export const POKEMON_TCG_STANDARD_CORNER_PROFILE_SCHEMA_VERSION =
  "ten-kings-card-corner-profile-v1" as const;
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_ID = "pokemon_tcg_standard" as const;
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION = "1.0.0" as const;
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM = 63.5 as const;
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM = 88.9 as const;
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM = 3.18 as const;
export const POKEMON_TCG_STANDARD_CONTOUR_GENERATION_VERSION =
  "ten-kings-circular-rounded-rectangle-contour-v1.0.0" as const;
export const POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER = 16 as const;
export const POKEMON_TCG_STANDARD_MEASUREMENT_AUTHORITY_SCHEMA_VERSION =
  "ten-kings-pokemon-standard-corner-measurement-authority-v1" as const;
export const POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN =
  `${POKEMON_TCG_STANDARD_MEASUREMENT_AUTHORITY_SCHEMA_VERSION}\n` as const;

/**
 * Exact UTF-8 bytes for the owner-approved Production operational profile.
 * The object intentionally contains no self-declared hash. Node trust
 * boundaries recompute SHA-256 from these bytes before accepting the profile.
 */
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON =
  '{"applicableFormat":{"excludedPhysicalFormats":["jumbo","oversize","nonstandard","unresolved"],"game":"pokemon_tcg","includedStandardVariants":["japanese","international","wizards_era","vintage","modern","standard_foil","standard_promo"],"physicalFormat":"standard"},"contourGeneration":{"arcSegmentsPerCorner":16,"coordinateFrame":"normalized_card_portrait_pixels","version":"ten-kings-circular-rounded-rectangle-contour-v1.0.0"},"cornerModel":"circular","cornerRadiusMm":3.18,"physicalDimensionsMm":{"height":88.9,"width":63.5},"productionAuthority":true,"profileFamily":"pokemon_tcg_standard","profileId":"pokemon_tcg_standard","provenance":{"approvedBy":"Mark","authority":"ten_kings_owner_approved_operational_standard","claimBoundary":"not_an_official_pokemon_manufacturer_specification","owner":"Ten Kings","recordedOn":"2026-07-21"},"schemaVersion":"ten-kings-card-corner-profile-v1","semanticVersion":"1.0.0","thresholdSet":{"id":"ten-kings-mathematical-grading-v1.0.1","sha256":"6f4fe21980a14458468d7526278c7b6cff70e39f8a80b07172b1991dfa1187c7"}}' as const;

/** SHA-256 of POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON UTF-8 bytes. */
export const POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256 =
  "691124bc600aeffe0106a6db81a64e45b78b7ce39665153ebf24972e5e6105ab" as const;

export const pokemonTcgStandardCornerProfileV1Schema = z.strictObject({
  applicableFormat: z.strictObject({
    excludedPhysicalFormats: z.tuple([
      z.literal("jumbo"),
      z.literal("oversize"),
      z.literal("nonstandard"),
      z.literal("unresolved"),
    ]),
    game: z.literal("pokemon_tcg"),
    includedStandardVariants: z.tuple([
      z.literal("japanese"),
      z.literal("international"),
      z.literal("wizards_era"),
      z.literal("vintage"),
      z.literal("modern"),
      z.literal("standard_foil"),
      z.literal("standard_promo"),
    ]),
    physicalFormat: z.literal("standard"),
  }),
  contourGeneration: z.strictObject({
    arcSegmentsPerCorner: z.literal(POKEMON_TCG_STANDARD_CONTOUR_ARC_SEGMENTS_PER_CORNER),
    coordinateFrame: z.literal("normalized_card_portrait_pixels"),
    version: z.literal(POKEMON_TCG_STANDARD_CONTOUR_GENERATION_VERSION),
  }),
  cornerModel: z.literal("circular"),
  cornerRadiusMm: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM),
  physicalDimensionsMm: z.strictObject({
    height: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM),
    width: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM),
  }),
  productionAuthority: z.literal(true),
  profileFamily: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_ID),
  profileId: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_ID),
  provenance: z.strictObject({
    approvedBy: z.literal("Mark"),
    authority: z.literal("ten_kings_owner_approved_operational_standard"),
    claimBoundary: z.literal("not_an_official_pokemon_manufacturer_specification"),
    owner: z.literal("Ten Kings"),
    recordedOn: z.literal("2026-07-21"),
  }),
  schemaVersion: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_SCHEMA_VERSION),
  semanticVersion: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION),
  thresholdSet: z.strictObject({
    id: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
    sha256: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
  }),
});

export type PokemonTcgStandardCornerProfileV1 = z.infer<
  typeof pokemonTcgStandardCornerProfileV1Schema
>;

export const POKEMON_TCG_STANDARD_CORNER_PROFILE =
  pokemonTcgStandardCornerProfileV1Schema.parse(
    JSON.parse(POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON),
  );

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const trustedPokemonCardFormatAuthorityArtifactV1Schema = z.strictObject({
  resolverVersion: z.literal("ten-kings-hosted-card-format-resolver-v1"),
  cardIdentity: z.strictObject({
    title: z.string().trim().min(1).max(300),
    sideCount: z.literal(2),
    tenantId: identifierSchema,
    setId: identifierSchema,
    programId: identifierSchema,
    cardNumber: z.string().trim().min(1).max(128),
    variantId: identifierSchema.nullable(),
    parallelId: identifierSchema.nullable(),
  }),
  formatSelection: z.strictObject({
    game: z.literal("pokemon_tcg"),
    physicalFormat: z.literal("standard"),
    widthMm: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_WIDTH_MM),
    heightMm: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_HEIGHT_MM),
    profileId: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_ID),
    profileVersion: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION),
    profileArtifactSha256: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256),
  }),
  sourceRecord: z.strictObject({
    recordType: z.literal("hosted_set_card"),
    recordId: identifierSchema,
    recordUpdatedAt: z.string().datetime({ offset: true }),
    recordSha256: sha256Schema,
  }),
  identitySourceArtifact: z.strictObject({
    artifactType: z.literal("set_taxonomy_source"),
    artifactId: identifierSchema,
    artifactSha256: sha256Schema,
    trustStatus: z.literal("trusted"),
  }),
  provenance: z.strictObject({
    authority: z.literal("ten_kings_hosted_immutable_card_identity"),
    physicalFormatAuthority: z.literal("ten_kings_owner_approved_card_format_record"),
    browserSelfDeclarationAccepted: z.literal(false),
  }),
});

export type TrustedPokemonCardFormatAuthorityArtifactV1 = z.infer<
  typeof trustedPokemonCardFormatAuthorityArtifactV1Schema
>;

export const trustedPokemonCardFormatAuthorityV1Schema = z.strictObject({
  schemaVersion: z.literal("ten-kings-trusted-card-format-authority-v1"),
  artifact: trustedPokemonCardFormatAuthorityArtifactV1Schema,
  artifactSha256: sha256Schema,
  authentication: z.strictObject({
    algorithm: z.literal("hmac-sha256"),
    keyId: identifierSchema,
    signature: sha256Schema,
  }),
});

export type TrustedPokemonCardFormatAuthorityV1 = z.infer<
  typeof trustedPokemonCardFormatAuthorityV1Schema
>;

export function canonicalJsonV1(value: unknown): string {
  const canonical = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonical);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([key, nested]) => [key, canonical(nested)]),
      );
    }
    return entry;
  };
  return JSON.stringify(canonical(value));
}
