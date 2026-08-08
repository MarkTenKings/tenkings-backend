const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const {
  EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
  EBAY_SOLD_COMPS_V2_MAX_CENTS,
  EbaySoldCompsV2Error,
  canonicalEbaySoldCompsV2ListingUrl,
  isApprovedEbaySoldCompsV2ImageUrl,
  buildEbaySoldCompsV2Query,
  calculateEbaySoldCompsV2AverageCents,
  mapTenKingsGradeToPsaGrade,
  normalizeEbaySoldCompsV2Date,
  parseEbaySoldCompsV2Candidate,
  rankEbaySoldCompsV2Candidates,
  searchEbaySoldCompsV2,
  summarizeEbaySoldCompsV2Selection,
} = require("../dist");

const sportsInput = Object.freeze({
  category: "SPORTS",
  playerName: "Michael Jordan",
  year: "1990",
  manufacturer: "SkyBox",
  productSet: "1990 SkyBox",
  parallel: "Base",
  cardNumber: "41",
  targetGrade: 9,
});

const contractInput = Object.freeze({
  category: "SPORTS",
  playerName: "JALEN HURTS",
  year: "2025",
  manufacturer: "PANINI",
  productSet: "2025 PANINI PHOENIX",
  insert: "THUNDERBIRDS",
  parallel: "SILVER",
  cardNumber: "41",
  targetGrade: 9.2,
});
const contractQuery = "2025 PANINI PHOENIX JALEN HURTS THUNDERBIRDS SILVER #41 PSA 9";

const item = (id, overrides = {}) => ({
  itemId: id,
  url: `https://www.ebay.com/itm/${id}?nordt=true`,
  thumbnailUrl: "https://i.ebayimg.com/images/g/example/s-l300.jpg",
  title: `1990 SkyBox Michael Jordan #41 PSA 9 ${id}`,
  soldPrice: "100.00",
  soldCurrency: "USD",
  endedAt: "2026-08-05",
  bestOfferAccepted: false,
  condition: "Graded",
  listingType: "sold",
  shippingPrice: "12.00",
  ...overrides,
});

const providerPayload = (items, overrides = {}) => ({
  keyword: "1990 SkyBox Michael Jordan #41 PSA 9",
  page: 1,
  totalItems: items.length,
  hasNextPage: false,
  items,
  ...overrides,
});

const candidate = (id, overrides = {}) => ({
  id,
  source: "EBAY_SOLD",
  productId: id.replace(/^ebay:/, "") || null,
  title: `Candidate ${id}`,
  listingUrl: `https://www.ebay.com/itm/${id.replace(/\D/g, "") || "123456"}`,
  imageUrl: null,
  soldPriceCents: 10000,
  soldPriceDisplay: "$100.00",
  soldDate: "2026-08-01",
  condition: "Graded",
  grader: "PSA",
  numericGrade: 9,
  raw: false,
  group: "PSA_TARGET",
  parallelMatch: "MATCH",
  matchScore: 90,
  matchReason: "fixture",
  ...overrides,
});

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return typeof payload === "string" ? payload : JSON.stringify(payload);
  },
});

const assertErrorCode = async (work, code) => {
  await assert.rejects(work, (error) => error instanceof EbaySoldCompsV2Error && error.code === code);
};

test("builds one visible deterministic query without duplicating set identity", () => {
  assert.equal(buildEbaySoldCompsV2Query(sportsInput), "1990 SkyBox Michael Jordan #41 PSA 9");
  assert.equal(buildEbaySoldCompsV2Query({
    category: "POKEMON",
    cardName: "Pikachu",
    year: "2023",
    manufacturer: "Pokemon",
    productSet: "Scarlet & Violet 151",
    parallel: "Cosmos Holo",
    cardNumber: "025",
    targetGrade: 10,
    serialNumber: "7/50",
  }), "2023 Pokemon Scarlet & Violet 151 Pikachu Cosmos Holo #025 PSA 10");
  assert.equal(buildEbaySoldCompsV2Query({ ...sportsInput, targetGrade: null }), "1990 SkyBox Michael Jordan #41");
  assert.equal(buildEbaySoldCompsV2Query({ ...sportsInput, targetGrade: 9.2 }), "1990 SkyBox Michael Jordan #41 PSA 9");
  assert.equal(buildEbaySoldCompsV2Query({ ...sportsInput, targetGrade: 9.5 }), "1990 SkyBox Michael Jordan #41 PSA 9");
  assert.equal(buildEbaySoldCompsV2Query({ ...sportsInput, targetGrade: 9.6 }), "1990 SkyBox Michael Jordan #41 PSA 10");
  assert.equal(buildEbaySoldCompsV2Query({ ...sportsInput, queryOverride: "  exact admin query  " }), "exact admin query");
  assert.equal(buildEbaySoldCompsV2Query({
    ...sportsInput,
    playerName: "Freddie Freeman",
    year: "2024",
    manufacturer: "Topps",
    productSet: "2024 Topps Chrome",
    parallel: "Red",
    cardNumber: "24",
  }), "2024 Topps Chrome Freddie Freeman Red #24 PSA 9");
  assert.equal(buildEbaySoldCompsV2Query({
    ...sportsInput,
    playerName: "Draymond Green",
    parallel: "Green",
  }), "1990 SkyBox Draymond Green Green #41 PSA 9");
  assert.equal(buildEbaySoldCompsV2Query({
    ...sportsInput,
    productSet: "1990 SkyBox #41",
  }), "1990 SkyBox #41 Michael Jordan PSA 9");
  assert.equal(buildEbaySoldCompsV2Query(contractInput), contractQuery);
  assert.equal(Buffer.byteLength(contractQuery), 61);
  assert.equal(createHash("sha256").update(contractQuery).digest("hex"), "c499160625eb8519e4e7e2db58fd9c1ff49a52fa00bc2c860b5d4dbad64c572c");
});

test("rejects unsafe or incomplete search contracts", () => {
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, targetGrade: 11 }), /between 1 and 10/);
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, queryOverride: "x".repeat(401) }), /400 characters/);
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, playerName: "", queryOverride: "" }), /player name/);
});

test("maps Ten Kings decimals to one documented whole PSA grade with exact ties down", () => {
  assert.equal(mapTenKingsGradeToPsaGrade(1), 1);
  assert.equal(mapTenKingsGradeToPsaGrade(8.49), 8);
  assert.equal(mapTenKingsGradeToPsaGrade(8.5), 8);
  assert.equal(mapTenKingsGradeToPsaGrade(8.51), 9);
  assert.equal(mapTenKingsGradeToPsaGrade(10), 10);
});

test("normalizes only supported, real calendar sold dates", () => {
  assert.equal(normalizeEbaySoldCompsV2Date("Sold Aug 5, 2026"), "2026-08-05");
  assert.equal(normalizeEbaySoldCompsV2Date("2024-02-29"), "2024-02-29");
  assert.equal(normalizeEbaySoldCompsV2Date("2023-02-29"), null);
  assert.equal(normalizeEbaySoldCompsV2Date("yesterday"), null);
});

test("maps only the approved SoldComps facts and discards provider shipping", () => {
  const parsed = parseEbaySoldCompsV2Candidate(item("123456789012"), sportsInput);
  assert.deepEqual({
    id: parsed.id,
    productId: parsed.productId,
    price: parsed.soldPriceCents,
    date: parsed.soldDate,
    group: parsed.group,
    image: parsed.imageUrl,
  }, {
    id: "ebay:123456789012",
    productId: "123456789012",
    price: 10000,
    date: "2026-08-05",
    group: "PSA_TARGET",
    image: "https://i.ebayimg.com/images/g/example/s-l300.jpg",
  });
  assert.equal(JSON.stringify(parsed).toLowerCase().includes("shipping"), false);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789015", { endedAt: undefined }), sportsInput).soldDate, null);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789039", { url: "https://example.com/itm/123456789039" }), sportsInput), null);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789040", { itemId: "123456789041" }), sportsInput), null);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789041", { itemId: "not-numeric" }), sportsInput), null);
  for (const url of [
    "https://www.ebay.com/p/14088354918",
    "https://www.ebay.com/help/home",
    "https://www.ebay.com/sch/i.html?_nkw=card",
    "https://www.ebay.com/arbitrary/path",
  ]) {
    assert.equal(parseEbaySoldCompsV2Candidate(item("123456789052", {
      url,
    }), sportsInput), null);
  }
});

test("emits only canonical numeric eBay item links and approved image hosts", () => {
  assert.equal(canonicalEbaySoldCompsV2ListingUrl("https://www.ebay.com/itm/Card-Title/123456789012?hash=secret#x"), "https://www.ebay.com/itm/123456789012");
  assert.equal(canonicalEbaySoldCompsV2ListingUrl("https://www.ebay.com/p/123?iid=123456789012"), null);
  assert.equal(canonicalEbaySoldCompsV2ListingUrl("https://www.ebay.com/sch/i.html?_nkw=card"), null);
  assert.equal(canonicalEbaySoldCompsV2ListingUrl("https://www.ebay.com/help/home?iid=123456789012"), null);
  assert.equal(canonicalEbaySoldCompsV2ListingUrl("https://evil.example/itm/123456789012"), null);
  assert.equal(isApprovedEbaySoldCompsV2ImageUrl("https://i.ebayimg.com/images/g/example/s-l1600.jpg"), true);
  assert.equal(isApprovedEbaySoldCompsV2ImageUrl("https://images.evil.example/card.jpg"), false);
});

test("uses only explicit SoldComps price, currency, and Best Offer facts", () => {
  const exact = parseEbaySoldCompsV2Candidate(item("123456789016", { soldPrice: "20.00" }), sportsInput);
  assert.equal(exact.soldPriceCents, 2000);
  assert.equal(exact.soldPriceDisplay, "USD 20.00");

  const bestOffer = parseEbaySoldCompsV2Candidate(item("123456789017", {
    soldPrice: "110.00",
    bestOfferAccepted: true,
  }), sportsInput);
  assert.equal(bestOffer.soldPriceCents, null);
  assert.equal(bestOffer.soldPriceDisplay, "USD 110.00");
  assert.match(bestOffer.matchReason, /SoldComps reported USD 110\.00, an upper bound/);

  const foreignCurrency = parseEbaySoldCompsV2Candidate(item("123456789018", {
    soldPrice: "90.00",
    soldCurrency: "EUR",
  }), sportsInput);
  assert.equal(foreignCurrency.soldPriceCents, null);
  assert.match(foreignCurrency.matchReason, /Non-USD sold price EUR 90\.00 is not selectable/);

  for (const soldPrice of [undefined, "", "20-40", "$20.00", "1e2", "0.00", "20.001"]) {
    const unsafe = parseEbaySoldCompsV2Candidate(item("123456789019", { soldPrice }), sportsInput);
    assert.equal(unsafe.soldPriceCents, null);
    assert.match(unsafe.matchReason, /missing or unsafe/);
  }
});

test("ranks exact PSA, other PSA by grade, other graders, then raw", () => {
  const inputRows = [
    candidate("raw", { group: "RAW", grader: null, numericGrade: null, raw: true }),
    candidate("sgc", { group: "OTHER_GRADED", grader: "SGC", numericGrade: 10 }),
    candidate("psa8", { group: "PSA_OTHER", numericGrade: 8 }),
    candidate("psa9", { group: "PSA_TARGET", numericGrade: 9 }),
    candidate("psa10", { group: "PSA_OTHER", numericGrade: 10 }),
  ];
  assert.deepEqual(rankEbaySoldCompsV2Candidates(inputRows).map((row) => row.id), ["psa9", "psa10", "psa8", "sgc", "raw"]);
  assert.deepEqual(inputRows.map((row) => row.id), ["raw", "sgc", "psa8", "psa9", "psa10"]);
});

test("sorts same-group matches before contradictions, newest dated first, missing dates last", () => {
  const rows = [
    candidate("missing", { soldDate: null }),
    candidate("old", { soldDate: "2026-01-01" }),
    candidate("new", { soldDate: "2026-08-01" }),
    candidate("wrong", { soldDate: "2026-12-01", parallelMatch: "CONTRADICTORY" }),
  ];
  assert.deepEqual(rankEbaySoldCompsV2Candidates(rows).map((row) => row.id), ["new", "old", "missing", "wrong"]);
});

test("recognizes variant contradictions without rejecting human-review candidates", () => {
  const parsed = parseEbaySoldCompsV2Candidate(item("123456789017", {
    title: "1990 SkyBox Michael Jordan #41 Gold PSA 9",
  }), sportsInput);
  assert.equal(parsed.parallelMatch, "CONTRADICTORY");
  assert.match(parsed.matchReason, /contradiction/);
});

test("variant matching subtracts authoritative set and color-surname identity tokens", () => {
  const draymond = {
    ...sportsInput,
    playerName: "Draymond Green",
    year: "2024",
    manufacturer: "Panini",
    productSet: "2024 Panini Prizm",
    cardNumber: "24",
  };
  const baseTitle = "2024 Panini Prizm Draymond Green #24 PSA 9";
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789031", { title: baseTitle }), { ...draymond, parallel: "Base" }).parallelMatch, "MATCH");
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789032", { title: baseTitle }), { ...draymond, parallel: "Green" }).parallelMatch, "UNKNOWN");
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789033", { title: `${baseTitle} Green` }), { ...draymond, parallel: "Green" }).parallelMatch, "MATCH");
});

test("identity and variant phrases match whole tokens, not substrings", () => {
  const wrongCardNumber = parseEbaySoldCompsV2Candidate(item("123456789027", {
    title: "1990 SkyBox Michael Jordan #141 PSA 9",
  }), sportsInput);
  assert.doesNotMatch(wrongCardNumber.matchReason, /card number match/);

  const exactCardNumber = parseEbaySoldCompsV2Candidate(item("123456789028", {
    title: "1990 SkyBox Michael Jordan #41 PSA 9",
  }), sportsInput);
  assert.match(exactCardNumber.matchReason, /card number match/);

  const goldInput = { ...sportsInput, parallel: "Gold" };
  const substringVariant = parseEbaySoldCompsV2Candidate(item("123456789029", {
    title: "1990 SkyBox Michael Jordan #41 Golden Anniversary PSA 9",
  }), goldInput);
  const exactVariant = parseEbaySoldCompsV2Candidate(item("123456789030", {
    title: "1990 SkyBox Michael Jordan #41 Gold PSA 9",
  }), goldInput);
  assert.equal(substringVariant.parallelMatch, "UNKNOWN");
  assert.equal(exactVariant.parallelMatch, "MATCH");
});

test("normalizes common manufacturer and grader aliases without treating a BGS label as a card parallel", () => {
  assert.equal(
    buildEbaySoldCompsV2Query({ ...sportsInput, manufacturer: "Upper Deck", productSet: "1990 UD" }),
    "1990 UD Michael Jordan #41 PSA 9",
  );
  const parsed = parseEbaySoldCompsV2Candidate(item("123456789024", {
    title: "1990 SkyBox Michael Jordan #41 Beckett Grading Services 10 Black Label",
  }), sportsInput);
  assert.equal(parsed.grader, "BGS");
  assert.equal(parsed.numericGrade, 10);
  assert.equal(parsed.parallelMatch, "MATCH");
  assert.equal(parsed.group, "OTHER_GRADED");
});

test("averages only unique human-selected sold prices", () => {
  const rows = [
    candidate("one", { soldPriceCents: 10000 }),
    candidate("two", { soldPriceCents: 11000 }),
    candidate("three", { soldPriceCents: 9000 }),
  ];
  assert.equal(calculateEbaySoldCompsV2AverageCents(rows, ["one", "two", "three", "one"]), 10000);
  assert.equal(calculateEbaySoldCompsV2AverageCents(rows, []), null);
  assert.deepEqual(summarizeEbaySoldCompsV2Selection(rows, ["one", "two", "three", "one"]), {
    includedCandidateIds: ["one", "two", "three"],
    includedCount: 3,
    averageSoldPriceCents: 10000,
    lowestSoldPriceCents: 9000,
    highestSoldPriceCents: 11000,
  });
  assert.deepEqual(summarizeEbaySoldCompsV2Selection(rows, []), {
    includedCandidateIds: [],
    includedCount: 0,
    averageSoldPriceCents: null,
    lowestSoldPriceCents: null,
    highestSoldPriceCents: null,
  });
  assert.throws(() => calculateEbaySoldCompsV2AverageCents(rows, ["missing"]), /not a returned candidate/);
  assert.throws(() => calculateEbaySoldCompsV2AverageCents([candidate("empty", { soldPriceCents: null })], ["empty"]), /positive sold price/);
  const maxRows = Array.from({ length: 60 }, (_, index) => candidate(`max-${index}`, { soldPriceCents: EBAY_SOLD_COMPS_V2_MAX_CENTS }));
  assert.equal(calculateEbaySoldCompsV2AverageCents(maxRows, maxRows.map(({ id }) => id)), EBAY_SOLD_COMPS_V2_MAX_CENTS);
  assert.throws(() => calculateEbaySoldCompsV2AverageCents([candidate("too-large", { soldPriceCents: EBAY_SOLD_COMPS_V2_MAX_CENTS + 1 })], ["too-large"]), /positive sold price/);
});

test("provider prices must fit the PostgreSQL integer cents boundary", () => {
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789034", { soldPrice: "21474836.47" }), sportsInput).soldPriceCents, EBAY_SOLD_COMPS_V2_MAX_CENTS);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789035", { soldPrice: "21474836.48" }), sportsInput).soldPriceCents, null);
});

test("search sends the exact sold-only contract and returns a redacted deterministic result", async () => {
  const urls = [];
  const inits = [];
  let calls = 0;
  const result = await searchEbaySoldCompsV2(contractInput, {
    apiKey: "top-secret",
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    fetch: async (url, init) => {
      calls += 1;
      urls.push(url);
      inits.push(init);
      return jsonResponse(providerPayload([item("123456789018", {
        title: "2025 Panini Phoenix Jalen Hurts Thunderbirds Silver #41 PSA 9",
      })], { keyword: contractQuery, hasNextPage: true }));
    },
  });
  const request = new URL(urls[0]);
  assert.equal(request.origin, "https://api.sold-comps.com");
  assert.equal(request.pathname, "/v1/scrape");
  assert.deepEqual([...request.searchParams.keys()].sort(), ["count", "ebaySite", "keyword", "page"]);
  assert.equal(request.searchParams.get("keyword"), contractQuery);
  assert.equal(request.searchParams.get("ebaySite"), "ebay.com");
  assert.equal(request.searchParams.get("count"), "240");
  assert.equal(request.searchParams.get("page"), "1");
  assert.equal(inits[0].headers.Authorization, "Bearer top-secret");
  assert.equal(request.toString().includes("top-secret"), false);
  assert.equal(JSON.stringify(result).includes("top-secret"), false);
  assert.equal(result.engineVersion, EBAY_SOLD_COMPS_V2_ENGINE_VERSION);
  assert.equal(result.engineVersion, "ebay-sold-comps-v2.3.0");
  assert.equal(result.retrievedAt, "2026-08-06T12:00:00.000Z");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.hasMore, false);
  assert.equal(calls, 1);
});

test("one provider response is deduplicated and capped at 60 safe candidates", async () => {
  const duplicate = item("123456789021");
  const result = await searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    fetch: async () => jsonResponse(providerPayload([
      duplicate,
      duplicate,
      item("123456789022", { url: "https://example.com/itm/123456789022" }),
      ...Array.from({ length: 70 }, (_, index) => item(String(123456780000 + index))),
    ])),
  });
  assert.equal(result.candidates.length, 60);
  assert.equal(new Set(result.candidates.map(({ id }) => id)).size, 60);
  assert.equal(result.nextOffset, 60);
});

test("parses all 200 observed provider rows before ranking and retains a late PSA target", async () => {
  const rawRows = Array.from({ length: 199 }, (_, index) => item(String(123456700000 + index), {
    title: `1990 SkyBox Michael Jordan #41 raw card ${index}`,
  }));
  const lateTarget = item("123456799999", {
    title: "1990 SkyBox Michael Jordan #41 PSA 9 late exact target",
  });
  const result = await searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    fetch: async () => jsonResponse(providerPayload([...rawRows, lateTarget])),
  });
  assert.equal(result.candidates.length, 60);
  assert.equal(result.candidates[0].productId, "123456799999");
  assert.equal(result.candidates[0].group, "PSA_TARGET");
});

test("maps supplier statuses exactly and never retries", async () => {
  for (const [status, code] of [
    [401, "SOLDCOMPS_CONFIGURATION_ERROR"],
    [403, "SOLDCOMPS_QUOTA_REACHED"],
    [429, "SOLDCOMPS_TEMPORARY_UNAVAILABLE"],
    [502, "SOLDCOMPS_TEMPORARY_UNAVAILABLE"],
    [503, "SOLDCOMPS_TEMPORARY_UNAVAILABLE"],
  ]) {
    let calls = 0;
    await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
      apiKey: "key",
      fetch: async () => {
        calls += 1;
        return jsonResponse({}, status);
      },
    }), code);
    assert.equal(calls, 1);
  }
});

test("fails once on non-retryable provider HTTP errors without leaking credentials", async () => {
  let calls = 0;
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "never-print-this",
    fetch: async () => {
      calls += 1;
      return jsonResponse("bad", 400);
    },
  }), "SOLDCOMPS_HTTP_ERROR");
  assert.equal(calls, 1);
  try {
    await searchEbaySoldCompsV2(sportsInput, { apiKey: "never-print-this", fetch: async () => jsonResponse("bad", 400) });
  } catch (error) {
    assert.equal(String(error).includes("never-print-this"), false);
  }
});

test("maps provider errors, invalid JSON, and missing credentials to typed safe errors", async () => {
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, { apiKey: "", fetch: async () => jsonResponse({}) }), "SOLDCOMPS_CREDENTIAL_MISSING");
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, { apiKey: "key", fetch: async () => jsonResponse("not json") }), "SOLDCOMPS_INVALID_RESPONSE");
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    fetch: async () => ({
      ...jsonResponse(providerPayload([])),
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html" : null },
    }),
  }), "SOLDCOMPS_INVALID_RESPONSE");
  for (const payload of [
    {},
    providerPayload([], { keyword: "wrong query" }),
    providerPayload([], { page: 2 }),
    providerPayload([], { totalItems: -1 }),
    providerPayload([], { hasNextPage: "false" }),
    providerPayload([], { items: {} }),
  ]) {
    await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
      apiKey: "key",
      fetch: async () => jsonResponse(payload),
    }), "SOLDCOMPS_INVALID_RESPONSE");
  }
});

test("accepts a structurally valid empty first page without pagination", async () => {
  const result = await searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    fetch: async () => jsonResponse(providerPayload([])),
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.hasMore, false);
});

test("rejects oversized provider bodies before unbounded parsing", async () => {
  let textCalls = 0;
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-length" ? String(6 * 1024 * 1024) : null },
      async text() { textCalls += 1; return "{}"; },
    }),
  }), "SOLDCOMPS_INVALID_RESPONSE");
  assert.equal(textCalls, 0);

  let cancelled = false;
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    fetch: async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({
        async read() { return { done: false, value: new Uint8Array(6 * 1024 * 1024) }; },
        async cancel() { cancelled = true; },
      }) },
      async text() { throw new Error("stream path required"); },
    }),
  }), "SOLDCOMPS_INVALID_RESPONSE");
  assert.equal(cancelled, true);
});

test("aborts a hung request at the configured timeout", async () => {
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    timeoutMs: 2,
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  }), "SOLDCOMPS_TIMEOUT");
});
