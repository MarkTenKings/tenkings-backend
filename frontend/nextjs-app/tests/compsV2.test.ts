import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { EbaySoldCompsV2Error } from "@tenkings/ebay-sold-comps-v2";

import {
  compsStateRevision,
  createCompsV2ReviewProof,
  parseCompsV2Snapshot,
  projectPublicCompsV2,
  runCompsV2Search,
  verifyCompsV2ReviewProof,
} from "../lib/server/compsV2";
import {
  COMPS_V2_INITIAL_VISIBLE_COUNT,
  COMPS_V2_MAX_VISIBLE_COUNT,
  handleFetch30MoreCompsV2Click,
  initialCompsV2VisibleCount,
  isCompsV2QueryReadOnly,
  revealCompsV2Locally,
  shouldAutoRunCompsV2Search,
  visibleCompsV2Candidates,
} from "../lib/compsV2Ui";
import { compsV2ProviderAdminError, createCompsV2ApiHandler, parseCompsV2ConfirmRequest } from "../pages/api/v2/admin/comps/[...action]";

const candidate = (id: string, price: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Sold card ${id}`,
  listingUrl: `https://www.ebay.com/itm/${id}`,
  imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
  soldPriceCents: price,
  soldDate: "2026-08-01",
  condition: "Graded",
  grader: "PSA",
  numericGrade: 9,
  raw: false,
  group: "PSA_TARGET",
  parallelMatch: "MATCH",
  matchScore: 90,
  matchReason: "identity match",
  included: true,
  ...overrides,
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  source: "EBAY_SOLD",
  engineVersion: "ebay-sold-comps-v2.3.0",
  query: "1990 SkyBox Michael Jordan #41 PSA 9",
  retrievedAt: "2026-08-06T12:00:00.000Z",
  nextOffset: 30,
  hasMore: true,
  candidates: [candidate("123456789001", 10000), candidate("123456789002", 11000), candidate("123456789003", 9000)],
  selection: {},
  confirmation: { marketValueCents: 10000, confirmedAt: "2026-08-06T12:00:00.000Z", confirmedByAdminId: "admin-1" },
  ...overrides,
});

const revisionCard = (overrides: Record<string, unknown> = {}) => ({
  compsSnapshot: snapshot(),
  marketValueCents: 10000,
  marketValueConfirmedAt: new Date("2026-08-06T12:00:00.000Z"),
  marketValueConfirmedByAdminId: "admin-1",
  compsPublic: false,
  ...overrides,
});

const searchCard = (overrides: Record<string, unknown> = {}) => ({
  id: "card-v2-1",
  publicToken: "tk2c_test",
  publicReportSlug: "report-1",
  category: "SPORTS",
  playerName: "Michael Jordan",
  cardName: null,
  year: "1990",
  manufacturer: "SkyBox",
  productSet: "1990 SkyBox",
  parallel: "Base",
  insert: null,
  cardNumber: "41",
  gradeSnapshot: { finalGrade: "9" },
  lifecycleState: "GRADED",
  speedsterSession: { slabFrontKey: null, capture: {} },
  humanGradeLabel: { certificateNumber: "TK-1" },
  ...revisionCard(),
  ...overrides,
});

test("full-state revision changes for snapshot, confirmed-value facts, or public visibility", () => {
  const base = compsStateRevision(revisionCard() as never);
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.notEqual(compsStateRevision(revisionCard({ compsSnapshot: snapshot({ query: "changed" }) }) as never), base);
  assert.notEqual(compsStateRevision(revisionCard({ marketValueCents: 10001 }) as never), base);
  assert.notEqual(compsStateRevision(revisionCard({ marketValueConfirmedAt: new Date("2026-08-06T12:00:01.000Z") }) as never), base);
  assert.notEqual(compsStateRevision(revisionCard({ marketValueConfirmedByAdminId: "admin-2" }) as never), base);
  assert.notEqual(compsStateRevision(revisionCard({ compsPublic: true }) as never), base);
});

test("snapshot parser reconstructs the bounded shape and excludes unknown provider data", () => {
  const parsed = parseCompsV2Snapshot(snapshot({
    providerPayload: { shipping: "$99" },
    candidates: [candidate("123456789001", 10000, { shipping: "$88" })],
  }));
  assert.ok(parsed);
  assert.equal(JSON.stringify(parsed).toLowerCase().includes("shipping"), false);
  assert.equal(parsed.selection.averageSoldPriceCents, 10000);
  assert.equal(parseCompsV2Snapshot(snapshot({
    candidates: [candidate("123456789001", 2_147_483_648, { included: false })],
  })), null);
  const capped = parseCompsV2Snapshot(snapshot({
    candidates: Array.from({ length: 60 }, (_, index) => candidate(String(123456780000 + index), 10000, { included: false })),
    confirmation: null,
    hasMore: true,
  }));
  assert.ok(capped);
  assert.equal(capped.hasMore, false);
});

test("selected-snapshot refresh proof is bounded, revision-bound, expiring, and tamper-evident", () => {
  const parsed = parseCompsV2Snapshot(snapshot());
  assert.ok(parsed);
  const revision = "a".repeat(64);
  const issued = new Date("2026-08-06T12:00:00.000Z");
  const proof = createCompsV2ReviewProof(parsed, revision, "test-only-secret", issued);
  assert.deepEqual(verifyCompsV2ReviewProof(proof, revision, "test-only-secret", new Date("2026-08-06T12:01:00.000Z")), proof);
  assert.throws(() => verifyCompsV2ReviewProof({ ...proof, snapshot: { ...proof.snapshot, query: "tampered" } }, revision, "test-only-secret", issued), /proof is invalid/);
  assert.throws(() => verifyCompsV2ReviewProof(proof, "b".repeat(64), "test-only-secret", issued), /proof is invalid/);
  assert.throws(() => verifyCompsV2ReviewProof(proof, revision, "test-only-secret", new Date("2026-08-06T12:16:00.000Z")), /expired/);
});

test("one-call 60-row review proof fits the bounded API envelope while oversized snapshots fail before confirmation", () => {
  const longImage = `https://i.ebayimg.com/images/g/example/s-l1600.jpg?${"a".repeat(850)}`;
  const candidates = Array.from({ length: 60 }, (_, index) => candidate(String(123456780000 + index), 10000 + index, {
    title: `Sold card ${"T".repeat(480)}${index}`,
    imageUrl: longImage,
    condition: "C".repeat(190),
    matchReason: "M".repeat(490),
    included: false,
  }));
  const parsed = parseCompsV2Snapshot(snapshot({ candidates }));
  assert.ok(parsed);
  const proof = createCompsV2ReviewProof(parsed, "a".repeat(64), "test-only-secret");
  const envelopeBytes = Buffer.byteLength(JSON.stringify({
    cardId: "card-v2-1",
    expectedCompsStateRevision: "a".repeat(64),
    selectedCandidateIds: [candidates[0].id],
    compsPublic: false,
    reviewProof: proof,
  }));
  assert.ok(envelopeBytes > 64 * 1024, `expected proof envelope above old 64 KB limit, got ${envelopeBytes}`);
  assert.ok(envelopeBytes < 320 * 1024, `proof envelope exceeded 320 KB API bound: ${envelopeBytes}`);
  assert.deepEqual(verifyCompsV2ReviewProof(proof, "a".repeat(64), "test-only-secret"), proof);
  assert.equal(parseCompsV2Snapshot({ ...snapshot(), ignored: "x".repeat(257 * 1024) }), null);
  const api = readFileSync(join(process.cwd(), "pages/api/v2/admin/comps/[...action].ts"), "utf8");
  assert.equal(api.includes('sizeLimit: "320kb"'), true);
  assert.equal(api.includes("maxDuration: 60"), true);
});

test("card search rejects stale state before provider I/O", async () => {
  let providerCalls = 0;
  const search = async () => { providerCalls += 1; throw new Error("provider must not run"); };
  const base = searchCard();
  await assert.rejects(runCompsV2Search({
    cardId: base.id,
    query: snapshot().query,
    operation: "REFRESH",
    expectedCompsStateRevision: "b".repeat(64),
    adminId: "admin-1",
  }, {
    getCard: async () => base as never,
    search: search as never,
  }), (error: unknown) => (error as { code?: string }).code === "STALE_COMPS_STATE");
  assert.equal(providerCalls, 0);
});

test("card refresh ignores client query overrides and searches the mapped PSA grade from authoritative identity", async () => {
  const previousKey = process.env.SOLDCOMPS_API_KEY;
  process.env.SOLDCOMPS_API_KEY = "test-only-review-key";
  const base = searchCard({ gradeSnapshot: { finalGrade: "9.2" } });
  const revision = compsStateRevision(base as never);
  const receivedInputs: Array<{ targetGrade?: number | null; queryOverride?: string | null }> = [];
  try {
    const result = await runCompsV2Search({
      cardId: base.id,
      query: "malicious TK 9.2 override",
      operation: "REFRESH",
      expectedCompsStateRevision: revision,
      acknowledgeReplaceSelected: true,
      adminId: "admin-1",
    }, {
      getCard: async () => base as never,
      search: (async (input: { targetGrade?: number | null; queryOverride?: string | null }) => {
        receivedInputs.push(input);
        return {
          source: "EBAY_SOLD" as const,
          engineVersion: "ebay-sold-comps-v2.3.0" as const,
          query: "1990 SkyBox Michael Jordan #41 PSA 9",
          retrievedAt: "2026-08-06T12:00:00.000Z",
          offset: 0,
          nextOffset: 1,
          requestedResultCount: 60,
          hasMore: false,
          candidates: [{
            ...candidate("123456789010", 10000, { included: false }),
            source: "EBAY_SOLD" as const,
            productId: "123456789010",
            soldPriceDisplay: "$100.00",
          }],
        };
      }) as never,
    });
    assert.equal(result.mode, "CARD_REVIEW");
    assert.equal(receivedInputs[0]?.targetGrade, 9.2);
    assert.equal(receivedInputs[0]?.queryOverride, null);
    assert.equal(result.review.snapshot.query.includes("PSA 9"), true);
    assert.equal(result.review.snapshot.query.includes("9.2"), false);
  } finally {
    if (previousKey === undefined) delete process.env.SOLDCOMPS_API_KEY;
    else process.env.SOLDCOMPS_API_KEY = previousKey;
  }
});

test("zero-write research uses one provider result and retains at most 60 candidates", async () => {
  let providerCalls = 0;
  const search = async () => {
    providerCalls += 1;
    return {
      source: "EBAY_SOLD" as const,
      engineVersion: "ebay-sold-comps-v2.3.0" as const,
      query: snapshot().query,
      retrievedAt: "2026-08-06T12:00:00.000Z",
      offset: 0,
      nextOffset: 60,
      requestedResultCount: 60,
      hasMore: false,
      candidates: Array.from({ length: 60 }, (_, index) => ({
        ...candidate(String(123456780000 + index), 10000, { included: false }),
        source: "EBAY_SOLD" as const,
        productId: String(123456780000 + index),
        soldPriceDisplay: "$100.00",
      })),
    };
  };
  const identity = { category: "SPORTS" as const, playerName: "Michael Jordan", year: "1990", manufacturer: "SkyBox", productSet: "1990 SkyBox", parallel: "Base", cardNumber: "41", targetGrade: 9 };
  const result = await runCompsV2Search({ researchIdentity: identity, query: snapshot().query, operation: "FIND", adminId: "admin-1" }, { search: search as never });
  assert.equal(result.mode, "RESEARCH");
  assert.equal(result.result.candidates.length, 60);
  assert.equal(result.result.hasMore, false);
  assert.equal(providerCalls, 1);
});

test("the wired Fetch 30 More click controller changes only 30-to-60 visibility", () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({ id: index + 1 }));
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("local reveal must never fetch");
  }) as typeof fetch;
  try {
    const initial = initialCompsV2VisibleCount(0);
    assert.equal(initial, COMPS_V2_INITIAL_VISIBLE_COUNT);
    assert.equal(visibleCompsV2Candidates(rows, initial).length, 30);
    const selectedIds = ["one", "three"] as const;
    let appliedVisibleCount = initial;
    const result = handleFetch30MoreCompsV2Click({
      currentVisibleCount: initial,
      candidateCount: rows.length,
      selectedIds,
      compsPublic: true,
      setVisibleCount: (nextVisibleCount) => { appliedVisibleCount = nextVisibleCount; },
    });
    assert.equal(appliedVisibleCount, COMPS_V2_MAX_VISIBLE_COUNT);
    assert.equal(result.visibleCount, COMPS_V2_MAX_VISIBLE_COUNT);
    assert.equal(visibleCompsV2Candidates(rows, result.visibleCount).length, 60);
    assert.strictEqual(result.selectedIds, selectedIds);
    assert.equal(result.compsPublic, true);
    assert.equal(revealCompsV2Locally(result.visibleCount, rows.length), 60);
    assert.equal(initialCompsV2VisibleCount(3), 60);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("card query state is read-only and automatic search runs once without replacing retained state", () => {
  assert.equal(isCompsV2QueryReadOnly("CARD"), true);
  assert.equal(isCompsV2QueryReadOnly("RESEARCH"), false);
  const ready = {
    mode: "CARD" as const,
    cardId: "card-1",
    hasSnapshot: false,
    candidateCount: 0,
    query: "1990 SkyBox Michael Jordan #41 PSA 9",
    busy: false,
    autoAttemptedCardId: null,
  };
  assert.equal(shouldAutoRunCompsV2Search(ready), true);
  assert.equal(shouldAutoRunCompsV2Search({ ...ready, autoAttemptedCardId: "card-1" }), false);
  assert.equal(shouldAutoRunCompsV2Search({ ...ready, hasSnapshot: true }), false);
  assert.equal(shouldAutoRunCompsV2Search({ ...ready, candidateCount: 30 }), false);
  assert.equal(shouldAutoRunCompsV2Search({ ...ready, busy: true }), false);
  assert.equal(shouldAutoRunCompsV2Search({ ...ready, mode: "RESEARCH" }), false);
});

test("public projection is absent unless explicitly enabled and every selected row is complete", () => {
  assert.equal(projectPublicCompsV2({ compsPublic: false, compsSnapshot: snapshot() as never }), null);
  assert.equal(projectPublicCompsV2({ compsPublic: true, compsSnapshot: snapshot({
    confirmation: { marketValueCents: 10000, confirmedAt: "not-a-date", confirmedByAdminId: "admin-1" },
  }) as never }), null);
  assert.equal(projectPublicCompsV2({ compsPublic: true, compsSnapshot: snapshot({
    confirmation: { marketValueCents: 9999, confirmedAt: "2026-08-06T12:00:00.000Z", confirmedByAdminId: "admin-1" },
  }) as never }), null);
  assert.equal(projectPublicCompsV2({ compsPublic: true, compsSnapshot: snapshot({
    candidates: [candidate("123456789001", 10000, { imageUrl: null })],
  }) as never }), null);
  const projected = projectPublicCompsV2({ compsPublic: true, compsSnapshot: snapshot() as never });
  assert.deepEqual(projected, {
    averageSoldPriceCents: 10000,
    comps: [
      { id: "123456789001", imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg", soldPriceCents: 10000, soldDate: "2026-08-01", listingUrl: "https://www.ebay.com/itm/123456789001" },
      { id: "123456789002", imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg", soldPriceCents: 11000, soldDate: "2026-08-01", listingUrl: "https://www.ebay.com/itm/123456789002" },
      { id: "123456789003", imageUrl: "https://i.ebayimg.com/images/g/example/s-l1600.jpg", soldPriceCents: 9000, soldDate: "2026-08-01", listingUrl: "https://www.ebay.com/itm/123456789003" },
    ],
  });
  assert.equal(JSON.stringify(projected).includes("matchReason"), false);
  assert.equal(JSON.stringify(projected).includes("engineVersion"), false);
});

test("admin surface keeps engine server-only, exact groups/label, one-shot auto trigger, CAS, and safe return path", () => {
  const page = readFileSync(join(process.cwd(), "pages/admin/comps.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "pages/api/v2/admin/comps/[...action].ts"), "utf8");
  const server = readFileSync(join(process.cwd(), "lib/server/compsV2.ts"), "utf8");
  const finish = readFileSync(join(process.cwd(), "pages/admin/ai-grader-v2/completed/[sessionId].tsx"), "utf8");
  for (const required of [
    "PSA — Same Grade", "PSA — Other Grades", "BGS / SGC / CGC", "Raw", "Fetch 30 More",
    "Show selected comps on the public card page", "Confirm Market Value", "Search without a card",
    "TK {card.targetGrade} — comping against PSA {card.psaTargetGrade}",
    'void runSearch("FIND")',
    "^\\/admin\\/ai-grader-v2\\/completed\\/",
  ]) assert.equal(page.includes(required), true, `missing UI contract: ${required}`);
  assert.equal(page.includes("@tenkings/ebay-sold-comps-v2"), false);
  assert.equal(api.indexOf("requireAdminSession(req)"), api.lastIndexOf("requireAdminSession(req)"));
  for (const required of ["FOR UPDATE", "assertRevision", "STALE_COMPS_STATE", "lockedCard", "publicEligible"]) {
    assert.equal(server.includes(required), true, `missing server trust contract: ${required}`);
  }
  assert.equal(server.includes("const marketValueCents = selection.averageSoldPriceCents"), true);
  assert.equal(api.includes("marketValueCents: z.number"), false);
  assert.equal(page.includes("Selected average becomes market value when confirmed"), true);
  assert.equal(page.includes("candidate.matchScore"), true);
  for (const helper of ["visibleCompsV2Candidates", "handleFetch30MoreCompsV2Click", "isCompsV2QueryReadOnly", "shouldAutoRunCompsV2Search"]) {
    assert.equal(page.includes(helper), true, `page is not wired to ${helper}`);
  }
  assert.equal(page.includes("onClick={() => handleFetch30MoreCompsV2Click({"), true);
  assert.equal(page.includes("[...candidates"), false);
  assert.equal(page.includes('mode === "CARD" && id'), true);
  assert.equal(page.includes('router.replace({ pathname: "/admin/comps"'), true);
  assert.equal(page.includes('const chooseCard = (id: string) => {\n    setMode("CARD");'), true);
  assert.equal(page.includes('onClick={() => chooseCard(match.id)}'), true);
  assert.equal(page.includes("setMarketValue"), false);
  assert.equal(server.includes("researchProof: createCompsV2ReviewProof"), false);
  assert.equal(server.includes("const selectedIds = current.candidates.filter"), true);
  for (const required of ["CARD_REVIEW", "createCompsV2ReviewProof", "verifyCompsV2ReviewProof", "proof?.snapshot ?? parseCompsV2Snapshot"]) {
    assert.equal(server.includes(required), true, `missing durable refresh contract: ${required}`);
  }
  assert.equal(server.includes("!proof &&"), true);
  assert.equal(page.includes("FETCH_MORE"), false);
  assert.equal(api.includes("FETCH_MORE"), false);
  assert.equal(server.includes("FETCH_MORE"), false);
  assert.equal(finish.includes("Open Sold Comps"), true);
  assert.equal(finish.includes("from=${encodeURIComponent"), true);
});

test("confirmation request rejects a client-supplied market-value override", () => {
  const base = {
    cardId: "card-v2-1",
    expectedCompsStateRevision: "a".repeat(64),
    selectedCandidateIds: ["123456789001"],
    compsPublic: false,
  };
  assert.equal(parseCompsV2ConfirmRequest(base).success, true);
  assert.equal(parseCompsV2ConfirmRequest({ ...base, marketValueCents: 1 }).success, false);
});

test("API operational logs expose typed safe signals without query, key, listing, or customer fields", () => {
  const api = readFileSync(join(process.cwd(), "pages/api/v2/admin/comps/[...action].ts"), "utf8");
  for (const required of ["request_succeeded", "request_rejected", "provider_rate_limited", "providerCode", "statusCode", "retryable", "rateLimited", "safeCardReference"]) {
    assert.equal(api.includes(required), true, `missing safe operational signal: ${required}`);
  }
  const logHelper = api.slice(api.indexOf("const logSuccess"), api.indexOf("const cardPayload"));
  for (const forbidden of ["query:", "apiKey", "listing", "customer", "token"]) assert.equal(logHelper.includes(forbidden), false);
});

test("SoldComps provider statuses map to the locked safe admin messages", () => {
  for (const statusCode of [429, 502, 503]) {
    const mapped = compsV2ProviderAdminError(new EbaySoldCompsV2Error(
      "SOLDCOMPS_TEMPORARY_UNAVAILABLE",
      "safe",
      { statusCode, retryable: true },
    ));
    assert.equal(mapped?.message, "eBay sold comps are temporarily unavailable.");
    assert.equal(mapped?.code, "COMPS_PROVIDER_UNAVAILABLE");
    assert.equal(mapped?.status, 503);
  }
  const quota = compsV2ProviderAdminError(new EbaySoldCompsV2Error(
    "SOLDCOMPS_QUOTA_REACHED",
    "safe",
    { statusCode: 403 },
  ));
  assert.equal(quota?.message, "Monthly comps quota reached.");
  assert.equal(quota?.code, "COMPS_PROVIDER_QUOTA_REACHED");
  const configuration = compsV2ProviderAdminError(new EbaySoldCompsV2Error(
    "SOLDCOMPS_CONFIGURATION_ERROR",
    "safe",
    { statusCode: 401 },
  ));
  assert.equal(configuration?.message, "eBay sold comps are temporarily unavailable.");
  assert.equal(configuration?.logEvent, "[CompsV2] provider_configuration_error");
});

test("public page renders selected projection only and has no empty-state comps copy", () => {
  const report = readFileSync(join(process.cwd(), "pages/ai-grader-v2/reports/[slug].tsx"), "utf8");
  assert.equal(report.includes("{publicComps ? ("), true);
  assert.equal(report.includes("No comps"), false);
  assert.equal(report.includes("no comps"), false);
  assert.equal(report.includes("View sold listing"), true);
});

test("every API action authenticates before card/provider work and returns no-store", async () => {
  const state: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const req = { method: "GET", query: { action: ["cards"], q: "Jordan" }, headers: {} } as unknown as NextApiRequest;
  const res = {
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
    status(status: number) { state.status = status; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  await createCompsV2ApiHandler()(req, res);
  assert.equal(state.status, 401);
  assert.equal(state.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(state.body, { message: "Missing or invalid Authorization header", code: "ADMIN_AUTH_REQUIRED" });
});
