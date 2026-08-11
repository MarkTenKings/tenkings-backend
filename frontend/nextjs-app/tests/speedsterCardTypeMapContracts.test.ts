import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSpeedsterMapKeyJson,
  normalizeSpeedsterMapKeyText,
  speedsterCardTypeMapKey,
} from "../lib/ai-grader-v2/card-type-map-contracts";

test("builds exact category-aware Sports keys including existing card identity", () => {
  assert.deepEqual(speedsterCardTypeMapKey("SPORTS", {
    playerName: "  J.J.   MCCARTHY ",
    year: "2025",
    manufacturer: " PANINI ",
    productSet: "PHOENIX",
    insert: "PARAGON",
    parallel: "SILVER",
    cardNumber: "8",
  }), {
    category: "SPORTS",
    year: "2025",
    manufacturer: "panini",
    productSet: "phoenix",
    insert: "paragon",
    parallel: "silver",
    playerName: "j.j. mccarthy",
    cardNumber: "8",
  });
});

test("builds Pokemon keys without inventing manufacturer or insert", () => {
  const key = speedsterCardTypeMapKey("POKEMON", {
    cardName: "Cubone",
    year: "1999 Pokemon",
    productSet: "Jungle",
    parallel: null,
    cardNumber: "50/64",
  });
  assert.deepEqual(key, {
    category: "POKEMON",
    year: "1999 pokemon",
    productSet: "jungle",
    parallel: null,
    cardName: "cubone",
    cardNumber: "50/64",
  });
  assert.equal("manufacturer" in key, false);
  assert.equal("insert" in key, false);
});

test("normalization merges blank/case/spacing but preserves punctuation", () => {
  assert.equal(normalizeSpeedsterMapKeyText(" \t "), null);
  assert.equal(normalizeSpeedsterMapKeyText("  Electric   RED "), "electric red");
  assert.notEqual(normalizeSpeedsterMapKeyText("J.J."), normalizeSpeedsterMapKeyText("JJ"));
});

test("subject and card number prevent unsafe shorter-key collisions", () => {
  const malik = speedsterCardTypeMapKey("SPORTS", {
    playerName: "Malik Nabers",
    year: "2025",
    manufacturer: "Panini",
    productSet: "Phoenix",
    insert: "Paragon",
    parallel: "Silver",
    cardNumber: "5",
  });
  const mccarthy = speedsterCardTypeMapKey("SPORTS", {
    playerName: "J.J. McCarthy",
    year: "2025",
    manufacturer: "Panini",
    productSet: "Phoenix",
    insert: "Paragon",
    parallel: "Silver",
    cardNumber: "8",
  });
  assert.notEqual(canonicalSpeedsterMapKeyJson(malik), canonicalSpeedsterMapKeyJson(mccarthy));
});
