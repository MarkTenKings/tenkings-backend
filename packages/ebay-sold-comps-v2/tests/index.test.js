const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EBAY_SOLD_COMPS_V2_ENGINE_VERSION,
  EbaySoldCompsV2Error,
  buildEbaySoldCompsV2Query,
  calculateEbaySoldCompsV2AverageCents,
  mergeEbaySoldCompsV2Candidates,
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

const item = (id, overrides = {}) => ({
  title: `1990 SkyBox Michael Jordan #41 PSA 9 ${id}`,
  link: `https://www.ebay.com/itm/${id}`,
  thumbnail: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
  price: { raw: "$100.00", extracted: 100 },
  shipping: { raw: "+$12.00 shipping", extracted: 12 },
  sold_date: "Sold Aug 5, 2026",
  condition: "Graded",
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
  shipping: "+$100.00 shipping",
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
  assert.equal(buildEbaySoldCompsV2Query({ ...sportsInput, queryOverride: "  exact admin query  " }), "exact admin query");
});

test("rejects unsafe or incomplete search contracts", () => {
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, targetGrade: 11 }), /between 1 and 10/);
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, requestedResultCount: 31 }), /between 1 and 30/);
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, queryOverride: "x".repeat(401) }), /400 characters/);
  assert.throws(() => buildEbaySoldCompsV2Query({ ...sportsInput, playerName: "", queryOverride: "" }), /player name/);
});

test("normalizes only supported, real calendar sold dates", () => {
  assert.equal(normalizeEbaySoldCompsV2Date("Sold Aug 5, 2026"), "2026-08-05");
  assert.equal(normalizeEbaySoldCompsV2Date("2024-02-29"), "2024-02-29");
  assert.equal(normalizeEbaySoldCompsV2Date("2023-02-29"), null);
  assert.equal(normalizeEbaySoldCompsV2Date("yesterday"), null);
});

test("parses a safe sold candidate and retains shipping without including it in price", () => {
  const parsed = parseEbaySoldCompsV2Candidate(item("123456789012"), sportsInput);
  assert.deepEqual({
    id: parsed.id,
    productId: parsed.productId,
    price: parsed.soldPriceCents,
    shipping: parsed.shipping,
    date: parsed.soldDate,
    group: parsed.group,
    image: parsed.imageUrl,
  }, {
    id: "ebay:123456789012",
    productId: "123456789012",
    price: 10000,
    shipping: "+$12.00 shipping",
    date: "2026-08-05",
    group: "PSA_TARGET",
    image: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
  });
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789013", { unsold_date: "Aug 5, 2026" }), sportsInput), null);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789014", { link: "https://example.com/itm/123456789014" }), sportsInput), null);
  assert.equal(parseEbaySoldCompsV2Candidate(item("123456789015", { sold_date: undefined }), sportsInput).soldDate, null);
});

test("rejects misleading range prices instead of inventing one sold price", () => {
  const parsed = parseEbaySoldCompsV2Candidate(item("123456789016", { price: "$20.00 to $40.00" }), sportsInput);
  assert.equal(parsed.soldPriceCents, null);
  const extractedRange = parseEbaySoldCompsV2Candidate(item("123456789025", {
    price: { raw: "$20.00 – $40.00", extracted: 20 },
  }), sportsInput);
  assert.equal(extractedRange.soldPriceCents, null);
  const foreignCurrency = parseEbaySoldCompsV2Candidate(item("123456789026", {
    price: { raw: "GBP 100.00", extracted: 100 },
  }), sportsInput);
  assert.equal(foreignCurrency.soldPriceCents, null);
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

test("averages only unique human-selected sold prices and excludes shipping", () => {
  const rows = [
    candidate("one", { soldPriceCents: 10000, shipping: "$50 shipping" }),
    candidate("two", { soldPriceCents: 11000, shipping: "Free shipping" }),
    candidate("three", { soldPriceCents: 9000, shipping: "$999 shipping" }),
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
});

test("merges 30+30 candidates by stable listing identity without mutating inputs", () => {
  const current = [candidate("ebay:1"), candidate("ebay:2")];
  const appended = [candidate("ebay:2", { soldPriceCents: 1 }), candidate("ebay:3")];
  const merged = mergeEbaySoldCompsV2Candidates(current, appended);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((row) => row.id === "ebay:2").soldPriceCents, 10000);
  assert.equal(appended[0].soldPriceCents, 1);
});

test("search sends the exact sold-only contract and returns a redacted deterministic result", async () => {
  const urls = [];
  const result = await searchEbaySoldCompsV2({ ...sportsInput, requestedResultCount: 1 }, {
    apiKey: "top-secret",
    now: () => new Date("2026-08-06T12:00:00.000Z"),
    fetch: async (url) => {
      urls.push(url);
      return jsonResponse({ organic_results: [item("123456789018")] });
    },
  });
  const request = new URL(urls[0]);
  assert.equal(request.searchParams.get("engine"), "ebay");
  assert.equal(request.searchParams.get("show_only"), "Sold");
  assert.equal(request.searchParams.get("_ipg"), "50");
  assert.equal(request.searchParams.has("_sop"), false);
  assert.equal(request.searchParams.get("api_key"), "top-secret");
  assert.equal(JSON.stringify(result).includes("top-secret"), false);
  assert.equal(result.engineVersion, EBAY_SOLD_COMPS_V2_ENGINE_VERSION);
  assert.equal(result.retrievedAt, "2026-08-06T12:00:00.000Z");
  assert.equal(result.candidates.length, 1);
});

test("search omits explicit unsold rows but keeps sold-filter rows with an absent sold date", async () => {
  const result = await searchEbaySoldCompsV2({ ...sportsInput, requestedResultCount: 1 }, {
    apiKey: "key",
    fetch: async () => jsonResponse({ organic_results: [
      item("123456789019", { unsold_date: "Aug 1, 2026" }),
      item("123456789020", { sold_date: undefined }),
    ] }),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].productId, "123456789020");
  assert.equal(result.candidates[0].soldDate, null);
});

test("offset contract retrieves the next 30 unique raw results across provider pages", async () => {
  const calls = [];
  const page = (start) => Array.from({ length: 50 }, (_, index) => item(String(start + index).padStart(12, "0")));
  const fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    return jsonResponse({
      organic_results: parsed.searchParams.get("_pgn") === "2" ? page(51) : page(1),
      serpapi_pagination: { next: "https://serpapi.com/next" },
    });
  };
  const first = await searchEbaySoldCompsV2(sportsInput, { apiKey: "key", fetch });
  const second = await searchEbaySoldCompsV2({ ...sportsInput, offset: first.nextOffset }, { apiKey: "key", fetch });
  const merged = mergeEbaySoldCompsV2Candidates(first.candidates, second.candidates);
  assert.equal(first.candidates.length, 30);
  assert.equal(first.nextOffset, 30);
  assert.equal(second.candidates.length, 30);
  assert.equal(second.nextOffset, 60);
  assert.equal(merged.length, 60);
  assert.deepEqual(calls.map((url) => url.searchParams.get("_pgn")), [null, null, "2"]);
});

test("duplicate rows do not consume a requested result slot", async () => {
  const duplicate = item("123456789021");
  const result = await searchEbaySoldCompsV2({ ...sportsInput, requestedResultCount: 2 }, {
    apiKey: "key",
    fetch: async () => jsonResponse({ organic_results: [duplicate, duplicate, item("123456789022")] }),
  });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.nextOffset, 3);
});

test("retries only retryable HTTP failures with bounded backoff", async () => {
  let calls = 0;
  const sleeps = [];
  const result = await searchEbaySoldCompsV2({ ...sportsInput, requestedResultCount: 1 }, {
    apiKey: "key",
    fetch: async () => (++calls === 1 ? jsonResponse({}, 429) : jsonResponse({ organic_results: [item("123456789023")] })),
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [250]);
});

test("fails once on non-retryable provider HTTP errors without leaking credentials", async () => {
  let calls = 0;
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "never-print-this",
    fetch: async () => {
      calls += 1;
      return jsonResponse("bad", 400);
    },
  }), "SERPAPI_HTTP_ERROR");
  assert.equal(calls, 1);
  try {
    await searchEbaySoldCompsV2(sportsInput, { apiKey: "never-print-this", fetch: async () => jsonResponse("bad", 400) });
  } catch (error) {
    assert.equal(String(error).includes("never-print-this"), false);
  }
});

test("maps provider errors, invalid JSON, and missing credentials to typed safe errors", async () => {
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, { apiKey: "", fetch: async () => jsonResponse({}) }), "SERPAPI_CREDENTIAL_MISSING");
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, { apiKey: "key", fetch: async () => jsonResponse("not json") }), "SERPAPI_INVALID_RESPONSE");
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, { apiKey: "key", fetch: async () => jsonResponse({ error: "account detail" }) }), "SERPAPI_PROVIDER_ERROR");
});

test("aborts a hung request at the configured timeout", async () => {
  await assertErrorCode(() => searchEbaySoldCompsV2(sportsInput, {
    apiKey: "key",
    timeoutMs: 2,
    maxAttempts: 1,
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  }), "SERPAPI_TIMEOUT");
});
