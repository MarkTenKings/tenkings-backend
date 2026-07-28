const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aiGraderOcrFieldRequiresReview,
} = require("../dist");

test("OCR review requirement is one shared state, confidence, and evidence contract", () => {
  assert.equal(aiGraderOcrFieldRequiresReview({
    state: "supported",
    confidence: 0.95,
    evidenceRefs: ["provider.front.card_name"],
  }), false);
  assert.equal(aiGraderOcrFieldRequiresReview({
    state: "supported",
    confidence: 0.95,
    evidenceRefs: ["provider.front.card_name", "catalog.identity.unresolved"],
  }), true);
  assert.equal(aiGraderOcrFieldRequiresReview({
    state: "supported",
    confidence: 0.79,
    evidenceRefs: ["provider.front.card_name"],
  }), true);
  assert.equal(aiGraderOcrFieldRequiresReview({
    state: "unknown",
    confidence: 0,
    evidenceRefs: [],
  }), true);
});
