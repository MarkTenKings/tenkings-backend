const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseStaleReviewSafeOffReceiptConfigV1,
} = require("../dist/drivers/staleInvalidRapidCaptureSafeOffReceiptConfigV1");

const config = {
  leimacHost: "169.254.191.156",
  leimacPort: 1000,
};
const json = JSON.stringify(config);

test("safe-off receipt config parser preserves ordinary non-BOM JSON behavior", () => {
  assert.deepEqual(parseStaleReviewSafeOffReceiptConfigV1(json), config);
});

test("safe-off receipt config parser accepts exactly one leading UTF-8 BOM", () => {
  const decoded = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)]).toString("utf8");
  assert.deepEqual(parseStaleReviewSafeOffReceiptConfigV1(decoded), config);
});

test("safe-off receipt config parser rejects malformed JSON after an allowed leading BOM", () => {
  assert.throws(() => parseStaleReviewSafeOffReceiptConfigV1("\uFEFF{\"leimacHost\":"), SyntaxError);
});

test("safe-off receipt config parser rejects multiple leading BOMs", () => {
  assert.throws(
    () => parseStaleReviewSafeOffReceiptConfigV1(`\uFEFF\uFEFF${json}`),
    /unexpected UTF-8 BOM/,
  );
});

test("safe-off receipt config parser rejects an interior BOM outside a string", () => {
  assert.throws(
    () => parseStaleReviewSafeOffReceiptConfigV1(`{\uFEFF\"leimacHost\":\"169.254.191.156\",\"leimacPort\":1000}`),
    /unexpected UTF-8 BOM/,
  );
});

test("safe-off receipt config parser rejects an interior BOM inside a JSON string", () => {
  assert.throws(
    () => parseStaleReviewSafeOffReceiptConfigV1(`{\"leimacHost\":\"169.254.\uFEFF191.156\",\"leimacPort\":1000}`),
    /unexpected UTF-8 BOM/,
  );
});
