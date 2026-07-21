import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN,
  canonicalJsonV1,
} from "@tenkings/shared";
import {
  parseTrustedPokemonCardLookupBody,
  signHostedPokemonStandardCardAuthorityV1,
  type HostedPokemonCardAuthorityRecordV1,
} from "../lib/server/aiGraderTrustedCardFormatAuthority";
import {
  aiGraderTrustedPokemonCardFormatAuthorityIssue,
  aiGraderTrustedPokemonCornerMeasurementAuthorityIssue,
} from "../lib/server/aiGraderMathematicalReleaseBoundary";

const HMAC_KEY = "test-only-hosted-pokemon-authority-key-0001";
const LOOKUP = {
  setId: "pokemon-base",
  programId: "pokemon",
  cardNumber: "4/102",
  variantId: null,
  parallelId: null,
} as const;

type FormatVariant =
  | "japanese"
  | "international"
  | "wizards_era"
  | "vintage"
  | "modern"
  | "standard_foil"
  | "standard_promo";

function hostedRecord(input: {
  formatVariant?: FormatVariant;
  physicalFormat?: "standard" | "jumbo" | "oversize" | "nonstandard" | "unresolved";
  game?: string;
  widthMm?: number;
  contradictory?: boolean;
  sourceTrusted?: boolean;
} = {}): HostedPokemonCardAuthorityRecordV1 {
  return {
    id: "hosted-card-1",
    setId: LOOKUP.setId,
    programId: LOOKUP.programId,
    cardNumber: LOOKUP.cardNumber,
    playerName: "Charizard",
    metadataJson: {
      aiGraderPhysicalFormatAuthority: {
        schemaVersion: "ten-kings-card-physical-format-authority-v1",
        trustStatus: "trusted",
        game: input.game ?? "pokemon_tcg",
        physicalFormat: input.physicalFormat ?? "standard",
        widthMm: input.widthMm ?? 63.5,
        heightMm: 88.9,
        cardTitle: "Charizard",
        formatVariant: input.formatVariant ?? "modern",
        contradictory: input.contradictory ?? false,
        provenance: "ten_kings_owner_approved_card_format_record",
      },
    },
    sourceId: "source-1",
    updatedAt: "2026-07-21T12:00:00.000Z",
    source: {
      id: "source-1",
      setId: LOOKUP.setId,
      sourceKind: "CHECKLIST",
      parserVersion: "pokemon-checklist-v1",
      sourceTimestamp: "2026-07-20T12:00:00.000Z",
      metadataJson: {
        aiGraderIdentityAuthority: {
          schemaVersion: "ten-kings-set-taxonomy-identity-authority-v1",
          trustStatus: input.sourceTrusted === false ? "untrusted" : "trusted",
          immutableIdentityResolution: true,
        },
      },
    },
    variation: null,
    parallel: null,
  };
}

function sign(record: HostedPokemonCardAuthorityRecordV1) {
  return signHostedPokemonStandardCardAuthorityV1({
    tenantId: "ten-kings",
    lookup: LOOKUP,
    record,
    hmacKey: HMAC_KEY,
    hmacKeyId: "pokemon-authority-test-v1",
  });
}

test("every trusted standard Pokemon format selects one exact deterministic profile", () => {
  const variants: FormatVariant[] = [
    "japanese",
    "international",
    "wizards_era",
    "vintage",
    "modern",
    "standard_foil",
    "standard_promo",
  ];
  for (const formatVariant of variants) {
    const first = sign(hostedRecord({ formatVariant }));
    const second = sign(hostedRecord({ formatVariant }));
    assert.deepEqual(first, second);
    assert.deepEqual(first.artifact.formatSelection, {
      game: "pokemon_tcg",
      physicalFormat: "standard",
      widthMm: 63.5,
      heightMm: 88.9,
      profileId: "pokemon_tcg_standard",
      profileVersion: "1.0.0",
      profileArtifactSha256: "691124bc600aeffe0106a6db81a64e45b78b7ce39665153ebf24972e5e6105ab",
    });
    assert.equal(first.artifact.provenance.browserSelfDeclarationAccepted, false);
  }
});

test("jumbo, oversize, nonstandard, unresolved, contradictory, and non-Pokemon records fail closed", () => {
  for (const physicalFormat of ["jumbo", "oversize", "nonstandard", "unresolved"] as const) {
    assert.throws(() => sign(hostedRecord({ physicalFormat })), /no nearest profile was selected/);
  }
  assert.throws(() => sign(hostedRecord({ contradictory: true })), /unresolved or untrusted/);
  assert.throws(() => sign(hostedRecord({ sourceTrusted: false })), /unresolved or untrusted/);
  assert.throws(() => sign(hostedRecord({ game: "sports" })), /no Pokémon profile was selected/);
  assert.throws(() => sign(hostedRecord({ widthMm: 64 })), /do not match 63.50 mm/);
});

test("the browser request cannot self-declare a trusted profile or measurement", () => {
  assert.deepEqual(parseTrustedPokemonCardLookupBody({ lookup: LOOKUP }), LOOKUP);
  assert.throws(() => parseTrustedPokemonCardLookupBody({
    lookup: LOOKUP,
    cardFormatId: "pokemon_tcg_standard",
  }), /only one exact lookup object/);
  assert.throws(() => parseTrustedPokemonCardLookupBody({
    lookup: { ...LOOKUP, trusted: true },
  }));
  assert.throws(() => parseTrustedPokemonCardLookupBody({
    lookup: { ...LOOKUP, measurements: [] },
  }));
});

test("the Production report boundary rejects a caller-created or forged authority", () => {
  const authority = sign(hostedRecord());
  const env = {
    AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY: HMAC_KEY,
    AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID: "pokemon-authority-test-v1",
  };
  assert.equal(aiGraderTrustedPokemonCardFormatAuthorityIssue(authority, env), undefined);
  const forged = structuredClone(authority);
  forged.authentication.signature = "0".repeat(64);
  assert.match(
    aiGraderTrustedPokemonCardFormatAuthorityIssue(forged, env) ?? "",
    /authentication failed/,
  );
  assert.match(
    aiGraderTrustedPokemonCardFormatAuthorityIssue(authority, {}) ?? "",
    /not configured/,
  );
});

test("a replayed valid card authority cannot authenticate caller-created corner measurements", () => {
  const artifact = {
    gradingSessionId: "grading-session-1",
    reportId: "report-1",
    measurements: [{ side: "front", location: "top_left", deviationMm: 0.01 }],
  };
  const artifactBytes = canonicalJsonV1(artifact);
  const pokemonCornerAuthority = {
    productionMeasurementAuthority: {
      schemaVersion: "ten-kings-pokemon-standard-corner-measurement-authority-v1",
      artifact,
      artifactSha256: createHash("sha256").update(artifactBytes, "utf8").digest("hex"),
      authentication: {
        algorithm: "hmac-sha256",
        keyId: "pokemon-authority-test-v1",
        signature: createHmac("sha256", HMAC_KEY)
          .update(POKEMON_TCG_STANDARD_MEASUREMENT_AUTHENTICATION_DOMAIN, "utf8")
          .update(artifactBytes, "utf8")
          .digest("hex"),
      },
    },
  } as any;
  const env = {
    AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY: HMAC_KEY,
    AI_GRADER_CARD_FORMAT_AUTHORITY_HMAC_KEY_ID: "pokemon-authority-test-v1",
  };
  assert.equal(
    aiGraderTrustedPokemonCornerMeasurementAuthorityIssue(pokemonCornerAuthority, env),
    undefined,
  );
  pokemonCornerAuthority.productionMeasurementAuthority.artifact.measurements[0].deviationMm = 1;
  assert.match(
    aiGraderTrustedPokemonCornerMeasurementAuthorityIssue(pokemonCornerAuthority, env) ?? "",
    /not produced by the authenticated station analyzer/,
  );
});
