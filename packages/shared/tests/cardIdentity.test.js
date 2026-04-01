const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCardIdentityPlayerName,
  normalizeCardIdentityPlayerNameBase,
} = require("../dist/cardIdentity");

test("normalizeCardIdentityPlayerName strips accents and punctuation", () => {
  assert.equal(normalizeCardIdentityPlayerName(" Hugo González "), "hugo gonzalez");
  assert.equal(normalizeCardIdentityPlayerName("O'Neil Cruz"), "oneil cruz");
});

test("normalizeCardIdentityPlayerNameBase normalizes suffix variants flexibly", () => {
  assert.equal(normalizeCardIdentityPlayerNameBase("Bobby Witt Jr."), "bobby witt");
  assert.equal(normalizeCardIdentityPlayerNameBase("Bobby Witt Junior"), "bobby witt");
  assert.equal(normalizeCardIdentityPlayerNameBase("Ken Griffey III"), "ken griffey");
});
