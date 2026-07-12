import assert from "node:assert/strict";
import test from "node:test";
import type { IdentifySetResult } from "../lib/server/cardSetIdentification";
import type { LookupSetResult } from "../lib/server/setLookup";
import {
  canonicalizeAiGraderOcrCatalog,
  resolveAiGraderCatalogOption,
  type AiGraderOcrPrefillFields,
} from "../lib/server/aiGraderOcrPrefill";

function supported<T extends string | boolean>(value: T, confidence = 0.92) {
  return {
    state: "supported" as const,
    value,
    confidence,
    reviewRequired: confidence < 0.8,
    evidenceRefs: ["image.front"],
  };
}

function unknown() {
  return {
    state: "unknown" as const,
    value: null,
    confidence: 0,
    reviewRequired: true,
    evidenceRefs: [] as string[],
  };
}

function fields(overrides: Partial<AiGraderOcrPrefillFields> = {}): AiGraderOcrPrefillFields {
  return {
    category: supported("sport"),
    playerName: supported("Michael Jordan"),
    cardName: unknown(),
    year: supported("1990"),
    manufacturer: supported("SkyBox"),
    sport: supported("basketball"),
    game: unknown(),
    productSet: supported("1990 SkyBox Basketball"),
    cardNumber: supported("41"),
    insert: supported("Base Set"),
    parallel: supported("Red White Blue"),
    numbered: supported("12/99"),
    autograph: supported(false),
    memorabilia: supported(false),
    ...overrides,
  };
}

function identified(overrides: Partial<IdentifySetResult> = {}): IdentifySetResult {
  return {
    setId: "1990-skybox-basketball",
    setName: "1990 SkyBox Basketball",
    programId: "base-set",
    programLabel: "Base Set",
    cardNumber: "41",
    playerName: "Michael Jordan",
    teamName: null,
    confidence: "exact",
    reason: "single_set_card_match",
    candidateSetIds: ["1990-skybox-basketball"],
    candidateCount: 1,
    scopedSetCount: 1,
    candidates: [],
    tiebreaker: "none",
    textSource: "none",
    ...overrides,
  };
}

function lookup(overrides: Partial<LookupSetResult> = {}): LookupSetResult {
  return {
    match: "exact",
    setId: "1990-skybox-basketball",
    insertLabel: "Base Set",
    programId: "base-set",
    scopedParallels: [{
      parallelId: "red-white-blue",
      label: "Red / White / Blue",
      serialDenominator: 99,
      serialText: "/99",
      finishFamily: "foil",
    }],
    parallels: [],
    candidates: [],
    ...overrides,
  };
}

test("catalog option resolution distinguishes exact, normalized alias, multiple, and none", () => {
  assert.deepEqual(resolveAiGraderCatalogOption("Gold", [{ label: "gold" }]), {
    match: "exact",
    value: "gold",
  });
  assert.deepEqual(resolveAiGraderCatalogOption("Red White Blue", [{ label: "Red / White / Blue" }]), {
    match: "alias",
    value: "Red / White / Blue",
  });
  assert.equal(resolveAiGraderCatalogOption("Red Blue", [
    { label: "Red/Blue" },
    { label: "Red-Blue" },
  ]).match, "multiple");
  assert.equal(resolveAiGraderCatalogOption("Invented", [{ label: "Gold" }]).match, "none");
});

test("catalog validation canonicalizes supported identity and retains explicit boolean negatives", () => {
  const result = canonicalizeAiGraderOcrCatalog({
    fields: fields(),
    category: "sport",
    identified: identified(),
    lookup: lookup(),
  });
  assert.equal(result.playerName.value, "Michael Jordan");
  assert.equal(result.productSet.value, "1990 SkyBox Basketball");
  assert.equal(result.cardNumber.value, "41");
  assert.equal(result.insert.value, "Base Set");
  assert.equal(result.parallel.value, "Red / White / Blue");
  assert.equal(result.numbered.value, "12/99");
  assert.equal(result.autograph.value, false);
  assert.equal(result.memorabilia.value, false);
  assert.equal(result.cardName.state, "unknown");
});

test("catalog conflicts and unsupported values become disagreement rather than autofill", () => {
  const result = canonicalizeAiGraderOcrCatalog({
    fields: fields({
      playerName: supported("Magic Johnson"),
      productSet: supported("Invented Set"),
      parallel: supported("Invented Parallel"),
      numbered: supported("41"),
    }),
    category: "sport",
    identified: identified(),
    lookup: lookup(),
  });
  for (const key of ["playerName", "productSet", "parallel", "numbered"] as const) {
    assert.equal(result[key].state, "disagreement");
    assert.equal(result[key].value, null);
    assert.equal(result[key].reviewRequired, true);
  }
});

test("multiple and missing catalog matches preserve disagreement and unknown states", () => {
  const multiple = canonicalizeAiGraderOcrCatalog({
    fields: fields(),
    category: "sport",
    identified: identified({ confidence: "none", candidateCount: 2 }),
    lookup: lookup({ match: "multiple" }),
  });
  assert.equal(multiple.playerName.state, "disagreement");
  assert.equal(multiple.productSet.state, "disagreement");

  const none = canonicalizeAiGraderOcrCatalog({
    fields: fields(),
    category: "sport",
    identified: identified({
      setId: null,
      setName: null,
      playerName: null,
      cardNumber: null,
      confidence: "none",
      candidateCount: 0,
    }),
    lookup: lookup({ match: "none", setId: null, insertLabel: null, scopedParallels: [] }),
  });
  assert.equal(none.playerName.state, "unknown");
  assert.equal(none.productSet.state, "unknown");
  assert.equal(none.cardNumber.state, "unknown");
});

test("numbered validation rejects impossible and wrong-denominator serial evidence", () => {
  for (const numbered of ["100/99", "12/50", "99", "41/10"]) {
    const result = canonicalizeAiGraderOcrCatalog({
      fields: fields({ numbered: supported(numbered) }),
      category: "sport",
      identified: identified(),
      lookup: lookup(),
    });
    assert.equal(result.numbered.state, "disagreement");
    assert.equal(result.numbered.value, null);
  }
});
