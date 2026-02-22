const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSetOpsDuplicateKey,
  buildSetDeleteConfirmationPhrase,
  decodeHtmlEntities,
  isSetDeleteConfirmationValid,
  normalizeCardNumber,
  normalizeParallelLabel,
  normalizeSetLabel,
} = require("../dist/setOpsNormalizer");

test("normalizeSetLabel decodes legacy HTML entities for 2020 set strings", () => {
  assert.equal(
    normalizeSetLabel("2020 Panini Stars &#038; Stripes USA Baseball Cards"),
    "2020 Panini Stars & Stripes USA Baseball Cards"
  );
  assert.equal(
    normalizeSetLabel("2020 Panini Stars &amp; Stripes USA Baseball Cards"),
    "2020 Panini Stars & Stripes USA Baseball Cards"
  );
});

test("normalizeParallelLabel handles JSON-like name payloads", () => {
  assert.equal(
    normalizeParallelLabel('{\"name\":[\"USA Baseball\",\"Blue\"]}'),
    "USA Baseball / Blue"
  );
  assert.equal(
    normalizeParallelLabel('{\"name\":\"Stars &#038; Stripes\"}'),
    "Stars & Stripes"
  );
});

test("normalizeParallelLabel falls back to decoded plain labels", () => {
  assert.equal(normalizeParallelLabel("  Blue &amp; Gold  "), "Blue & Gold");
  assert.equal(normalizeParallelLabel("  "), "");
});

test("normalizeCardNumber normalizes legacy ALL/NULL and common noise", () => {
  assert.equal(normalizeCardNumber(" all "), "ALL");
  assert.equal(normalizeCardNumber(" NULL "), null);
  assert.equal(normalizeCardNumber(" # 113a "), "113A");
  assert.equal(normalizeCardNumber(""), null);
});

test("buildSetOpsDuplicateKey is stable between dirty and clean inputs", () => {
  const dirty = buildSetOpsDuplicateKey({
    setId: "2020 Panini Stars &#038; Stripes USA Baseball Cards",
    cardNumber: " #113 ",
    parallel: '{\"name\":[\"USA Baseball\"]}',
    playerSeed: " Bobby Witt Jr ",
    listingId: "https://www.ebay.com/itm/123456789012?mkcid=16",
  });

  const clean = buildSetOpsDuplicateKey({
    setId: "2020 Panini Stars & Stripes USA Baseball Cards",
    cardNumber: "113",
    parallel: "USA Baseball",
    playerSeed: "Bobby Witt Jr",
    listingId: "123456789012",
  });

  assert.equal(dirty, clean);
});

test("decodeHtmlEntities decodes numeric entities and collapses whitespace", () => {
  assert.equal(decodeHtmlEntities("A&#038;B &#8211; C"), "A&B - C");
  assert.equal(decodeHtmlEntities("  A   B  "), "A B");
});

test("buildSetDeleteConfirmationPhrase normalizes dirty set labels", () => {
  assert.equal(
    buildSetDeleteConfirmationPhrase("2020 Panini Stars &#038; Stripes USA Baseball Cards"),
    "DELETE 2020 Panini Stars & Stripes USA Baseball Cards"
  );
  assert.equal(buildSetDeleteConfirmationPhrase(""), "DELETE");
});

test("isSetDeleteConfirmationValid enforces exact typed confirmation phrase", () => {
  const setId = "2020 Panini Stars &#038; Stripes USA Baseball Cards";
  assert.equal(
    isSetDeleteConfirmationValid(setId, "DELETE 2020 Panini Stars & Stripes USA Baseball Cards"),
    true
  );
  assert.equal(
    isSetDeleteConfirmationValid(setId, " delete 2020 Panini Stars & Stripes USA Baseball Cards "),
    false
  );
});
