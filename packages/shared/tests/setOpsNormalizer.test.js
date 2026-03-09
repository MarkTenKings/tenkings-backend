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
  assert.equal(normalizeCardNumber(" dd-11 "), "DD-11");
  assert.equal(normalizeCardNumber(" ns-27 "), "NS-27");
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

test("buildSetOpsDuplicateKey distinguishes parallel rows by format when present", () => {
  const hobby = buildSetOpsDuplicateKey({
    setId: "2025 Topps Series 1 Baseball",
    cardNumber: null,
    parallel: "Base",
    playerSeed: "BASE CARDS",
    format: "hobby",
  });

  const mega = buildSetOpsDuplicateKey({
    setId: "2025 Topps Series 1 Baseball",
    cardNumber: null,
    parallel: "Base",
    playerSeed: "BASE CARDS",
    format: "mega-box-se",
  });

  assert.notEqual(hobby, mega);
});

test("buildSetOpsDuplicateKey distinguishes parallel rows by odds when present", () => {
  const first = buildSetOpsDuplicateKey({
    setId: "2025-26 Topps Chrome Basketball",
    cardNumber: null,
    parallel: "Green",
    playerSeed: "Loading... Refractors Geometric",
    format: "hta-breaker",
    odds: "1:1046",
  });

  const second = buildSetOpsDuplicateKey({
    setId: "2025-26 Topps Chrome Basketball",
    cardNumber: null,
    parallel: "Green",
    playerSeed: "Loading... Refractors Geometric",
    format: "hta-breaker",
    odds: "1:22",
  });

  assert.notEqual(first, second);
});

test("buildSetOpsDuplicateKey distinguishes checklist rows by team when present", () => {
  const first = buildSetOpsDuplicateKey({
    setId: "2024 Topps Finest Football",
    cardNumber: "MYST-10",
    parallel: "MYSTERY FINEST",
    playerSeed: "Tom Brady",
    team: "New England",
  });

  const second = buildSetOpsDuplicateKey({
    setId: "2024 Topps Finest Football",
    cardNumber: "MYST-10",
    parallel: "MYSTERY FINEST",
    playerSeed: "Tom Brady",
    team: "Tampa Bay",
  });

  assert.notEqual(first, second);
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
