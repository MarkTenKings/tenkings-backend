import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAiGraderTrustedPokemonMathematicalGradingAuthorityV1,
  resolveAiGraderTrustedPokemonCardFormatAuthorityV1,
} from "../lib/aiGraderStationBridgeClient";
import type { TrustedPokemonCardFormatAuthorityV1 } from "@tenkings/shared";

const trustedAuthority: TrustedPokemonCardFormatAuthorityV1 = {
  schemaVersion: "ten-kings-trusted-card-format-authority-v1",
  artifact: {
    resolverVersion: "ten-kings-hosted-card-format-resolver-v1",
    cardIdentity: {
      title: "Pikachu",
      sideCount: 2,
      tenantId: "ten-kings",
      setId: "pokemon-base",
      programId: "pokemon",
      cardNumber: "58/102",
      variantId: null,
      parallelId: null,
    },
    formatSelection: {
      game: "pokemon_tcg",
      physicalFormat: "standard",
      widthMm: 63.5,
      heightMm: 88.9,
      profileId: "pokemon_tcg_standard",
      profileVersion: "1.0.0",
      profileArtifactSha256: "691124bc600aeffe0106a6db81a64e45b78b7ce39665153ebf24972e5e6105ab",
    },
    sourceRecord: {
      recordType: "hosted_set_card",
      recordId: "hosted-pikachu",
      recordUpdatedAt: "2026-07-21T12:00:00.000Z",
      recordSha256: "a".repeat(64),
    },
    identitySourceArtifact: {
      artifactType: "set_taxonomy_source",
      artifactId: "pokemon-source",
      artifactSha256: "b".repeat(64),
      trustStatus: "trusted",
    },
    provenance: {
      authority: "ten_kings_hosted_immutable_card_identity",
      physicalFormatAuthority: "ten_kings_owner_approved_card_format_record",
      browserSelfDeclarationAccepted: false,
    },
  },
  artifactSha256: "c".repeat(64),
  authentication: {
    algorithm: "hmac-sha256",
    keyId: "pokemon-authority-v1",
    signature: "d".repeat(64),
  },
};

test("the browser sends identity fields only and binds the returned trusted identity", async () => {
  let requestBody: unknown;
  const fetchImpl: typeof fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      ok: true,
      result: { authority: trustedAuthority },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const authority = await resolveAiGraderTrustedPokemonCardFormatAuthorityV1({
    identity: trustedAuthority.artifact.cardIdentity,
    headers: { authorization: "Bearer test" },
  }, fetchImpl);
  assert.deepEqual(requestBody, {
    lookup: {
      title: "Pikachu",
      setId: "pokemon-base",
      programId: "pokemon",
      cardNumber: "58/102",
      variantId: null,
      parallelId: null,
    },
  });
  const grading = buildAiGraderTrustedPokemonMathematicalGradingAuthorityV1({
    trustedCardFormatAuthority: authority,
    profiles: { front: "printed_border_v1", back: "printed_border_v1" },
  });
  assert.equal(grading.cardFormatId, "pokemon_tcg_standard");
  assert.equal(grading.cardIdentity.title, "Pikachu");
  if (grading.cardFormatId !== "pokemon_tcg_standard") {
    throw new Error("Expected the exact trusted Pokémon profile.");
  }
  assert.deepEqual(grading.trustedCardFormatAuthority, trustedAuthority);
});
