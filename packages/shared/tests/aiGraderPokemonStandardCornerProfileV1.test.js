const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const shared = require("../dist");

test("the owner-approved Pokemon standard profile has exact deterministic bytes", () => {
  const bytes = Buffer.from(
    shared.POKEMON_TCG_STANDARD_CORNER_PROFILE_CANONICAL_JSON,
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    shared.POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  );
  assert.deepEqual(
    JSON.parse(bytes.toString("utf8")),
    shared.POKEMON_TCG_STANDARD_CORNER_PROFILE,
  );
  assert.deepEqual(shared.POKEMON_TCG_STANDARD_CORNER_PROFILE.physicalDimensionsMm, {
    height: 88.9,
    width: 63.5,
  });
  assert.equal(shared.POKEMON_TCG_STANDARD_CORNER_PROFILE.cornerRadiusMm, 3.18);
  assert.equal(
    shared.POKEMON_TCG_STANDARD_CORNER_PROFILE.provenance.claimBoundary,
    "not_an_official_pokemon_manufacturer_specification",
  );
});

test("runtime profile mutations fail the exact contract", () => {
  const base = shared.POKEMON_TCG_STANDARD_CORNER_PROFILE;
  const invalid = [
    { ...base, productionAuthority: false },
    { ...base, cornerModel: "elliptical" },
    { ...base, physicalDimensionsMm: { ...base.physicalDimensionsMm, width: 63.6 } },
    { ...base, cornerRadiusMm: 3.2 },
    { ...base, semanticVersion: "1.0.1" },
    { ...base, provenance: { ...base.provenance, approvedBy: "caller" } },
    { ...base, applicableFormat: { ...base.applicableFormat, physicalFormat: "jumbo" } },
  ];
  for (const candidate of invalid) {
    assert.equal(shared.pokemonTcgStandardCornerProfileV1Schema.safeParse(candidate).success, false);
  }
});
