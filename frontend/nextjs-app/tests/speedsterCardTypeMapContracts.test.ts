import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSpeedsterMapKeyJson,
  normalizeSpeedsterMapKeyText,
  speedsterCardTypeMapKey,
  speedsterFamilyCardTypeMapKey,
  speedsterMapScopeForKey,
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

test("Pokemon family keys omit card name and number while exact keys remain distinct", () => {
  const snorlax = {
    cardName: "Snorlax",
    layoutType: "POKEMON",
    year: "2022 Pokemon",
    productSet: "Lost Origin",
    parallel: "Holo",
    cardNumber: "143/196",
  } as const;
  const mewtwo = {
    ...snorlax,
    cardName: "Mewtwo",
    cardNumber: "056/196",
  } as const;

  assert.deepEqual(
    speedsterFamilyCardTypeMapKey("POKEMON", snorlax),
    speedsterFamilyCardTypeMapKey("POKEMON", mewtwo),
  );
  assert.notDeepEqual(
    speedsterCardTypeMapKey("POKEMON", snorlax),
    speedsterCardTypeMapKey("POKEMON", mewtwo),
  );
  assert.equal(speedsterMapScopeForKey(speedsterFamilyCardTypeMapKey("POKEMON", snorlax)), "FAMILY");
  assert.equal(speedsterMapScopeForKey(speedsterCardTypeMapKey("POKEMON", snorlax)), "EXACT");
  assert.deepEqual(speedsterFamilyCardTypeMapKey("POKEMON", snorlax), {
    scope: "FAMILY",
    keyVersion: "v2",
    category: "POKEMON",
    layoutType: "POKEMON",
    year: "2022 pokemon",
    productSet: "lost origin",
    parallel: "holo",
  });
  assert.notDeepEqual(
    speedsterFamilyCardTypeMapKey("POKEMON", snorlax),
    speedsterFamilyCardTypeMapKey("POKEMON", { ...mewtwo, layoutType: "TRAINER" }),
  );
});

test("Sports family keys omit player name and card number", () => {
  const base = {
    playerName: "Malik Nabers",
    year: "2025",
    manufacturer: "Panini",
    productSet: "Phoenix",
    insert: "Paragon",
    parallel: "Silver",
    cardNumber: "5",
  } as const;
  assert.deepEqual(speedsterFamilyCardTypeMapKey("SPORTS", base), {
    scope: "FAMILY",
    category: "SPORTS",
    year: "2025",
    manufacturer: "panini",
    productSet: "phoenix",
    insert: "paragon",
    parallel: "silver",
  });
});
