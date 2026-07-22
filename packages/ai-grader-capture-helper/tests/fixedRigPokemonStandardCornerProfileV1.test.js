const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, createHmac } = require("node:crypto");

const shared = require("@tenkings/shared");
const drivers = require("../dist/drivers");

const HMAC_KEY = "test-only-pokemon-format-authority-key-0001";
const KEY_ID = "test-key-v1";
const identity = {
  title: "Charizard",
  sideCount: 2,
  tenantId: "ten-kings",
  setId: "base-set",
  programId: "pokemon",
  cardNumber: "4/102",
  variantId: null,
  parallelId: null,
};

function signedAuthority() {
  const artifact = {
    resolverVersion: "ten-kings-hosted-card-format-resolver-v1",
    cardIdentity: identity,
    formatSelection: {
      game: "pokemon_tcg",
      physicalFormat: "standard",
      widthMm: 63.5,
      heightMm: 88.9,
      profileId: "pokemon_tcg_standard",
      profileVersion: "1.0.0",
      profileArtifactSha256: shared.POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    },
    sourceRecord: {
      recordType: "hosted_set_card",
      recordId: "set-card-1",
      recordUpdatedAt: "2026-07-21T12:00:00.000Z",
      recordSha256: "a".repeat(64),
    },
    identitySourceArtifact: {
      artifactType: "set_taxonomy_source",
      artifactId: "taxonomy-source-1",
      artifactSha256: "b".repeat(64),
      trustStatus: "trusted",
    },
    provenance: {
      authority: "ten_kings_hosted_immutable_card_identity",
      physicalFormatAuthority: "ten_kings_owner_approved_card_format_record",
      browserSelfDeclarationAccepted: false,
    },
  };
  const bytes = shared.canonicalJsonV1(artifact);
  return {
    schemaVersion: "ten-kings-trusted-card-format-authority-v1",
    artifact,
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    authentication: {
      algorithm: "hmac-sha256",
      keyId: KEY_ID,
      signature: createHmac("sha256", HMAC_KEY).update(bytes).digest("hex"),
    },
  };
}

test("mutated profile bytes fail even when the canonical hash is still declared", () => {
  const mutated = Buffer.from(
    shared.POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON.replace("3.18", "3.19"),
    "utf8",
  );
  assert.throws(
    () => drivers.verifyPokemonTcgStandardCornerProfileBytesV1({
      bytes: mutated,
      declaredSha256: shared.POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
    }),
    /canonical SHA-256/,
  );
});

test("the helper accepts only an exact hosted signature and exact card identity", () => {
  const authority = signedAuthority();
  assert.deepEqual(drivers.verifyTrustedPokemonCardFormatAuthorityV1({
    authority,
    hmacKey: HMAC_KEY,
    expectedKeyId: KEY_ID,
    expectedCardIdentity: identity,
  }), authority);

  const forged = structuredClone(authority);
  forged.authentication.signature = "0".repeat(64);
  assert.throws(() => drivers.verifyTrustedPokemonCardFormatAuthorityV1({
    authority: forged,
    hmacKey: HMAC_KEY,
    expectedKeyId: KEY_ID,
    expectedCardIdentity: identity,
  }), /signature is invalid/);
  assert.throws(() => drivers.verifyTrustedPokemonCardFormatAuthorityV1({
    authority,
    hmacKey: HMAC_KEY,
    expectedKeyId: KEY_ID,
    expectedCardIdentity: { ...identity, cardNumber: "999" },
  }), /exact card identity/);
});

test("the exact 63.5 x 88.9 mm and R3.18 contour is deterministic and separate from generic", () => {
  const first = drivers.buildFixedRigPokemonTcgStandardBoundaryV1({
    normalizedWidthPx: 1000,
    normalizedHeightPx: 1400,
  });
  const second = drivers.buildFixedRigPokemonTcgStandardBoundaryV1({
    normalizedWidthPx: 1000,
    normalizedHeightPx: 1400,
  });
  const generic = drivers.buildFixedRigStandardTradingCardBoundaryV1({
    normalizedWidthPx: 1000,
    normalizedHeightPx: 1400,
  });
  assert.deepEqual(first, second);
  assert.equal(first.profileId, "pokemon_tcg_standard");
  assert.equal(first.profileVersion, "1.0.0");
  assert.equal(first.contour.length, 65);
  assert.equal(first.contour[0].x, 1000 * 3.18 / 63.5);
  assert.notEqual(generic.profileId, first.profileId);
});
