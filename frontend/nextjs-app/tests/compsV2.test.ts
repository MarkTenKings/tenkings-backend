import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";

import {
  compsStateRevision,
  createCompsV2ReviewProof,
  parseCompsV2Snapshot,
  projectPublicCompsV2,
  runCompsV2Search,
  verifyCompsV2ReviewProof,
} from "../lib/server/compsV2";
import { createCompsV2ApiHandler, parseCompsV2ConfirmRequest } from "../pages/api/v2/admin/comps/[...action]";

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
  engineVersion: "ebay-sold-comps-v2.1.1",
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

const engineCandidate = (id: string, price: number, overrides: Record<string, unknown> = {}) => ({
  ...candidate(id, price, overrides),
  source: "EBAY_SOLD" as const,
  productId: id,
  soldPriceDisplay: `$${(price / 100).toFixed(2)}`,
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

test("30+30 review proof fits the bounded API envelope while oversized snapshots fail before confirmation", () => {
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
});

test("card fetch-more rejects known stale state, query mismatch, and 60-row cap before provider I/O", async () => {
  let providerCalls = 0;
  const search = async () => { providerCalls += 1; throw new Error("provider must not run"); };
  const base = searchCard();
  const revision = compsStateRevision(base as never);
  const common = { cardId: base.id, query: snapshot().query, operation: "FETCH_MORE" as const, adminId: "admin-1" };
  await assert.rejects(runCompsV2Search({ ...common, expectedCompsStateRevision: "b".repeat(64) }, {
    getCard: async () => base as never,
    search: search as never,
  }), (error: unknown) => (error as { code?: string }).code === "STALE_COMPS_STATE");
  await assert.rejects(runCompsV2Search({ ...common, query: "changed query", expectedCompsStateRevision: revision }, {
    getCard: async () => base as never,
    search: search as never,
  }), (error: unknown) => (error as { code?: string }).code === "STALE_COMPS_STATE");
  const sixty = Array.from({ length: 60 }, (_, index) => candidate(String(123456780000 + index), 10000, { included: false }));
  const capped = searchCard({ compsSnapshot: snapshot({ candidates: sixty, confirmation: null }) });
  await assert.rejects(runCompsV2Search({ ...common, expectedCompsStateRevision: compsStateRevision(capped as never) }, {
    getCard: async () => capped as never,
    search: search as never,
  }), (error: unknown) => (error as { code?: string }).code === "COMPS_LIMIT_REACHED");
  assert.equal(providerCalls, 0);
});

test("zero-write research 30+30 merge stays signed, server-ranked, capped, and has no third provider call", async () => {
  const previousKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-only-research-signing-key";
  let providerCalls = 0;
  const search = async (_input: unknown) => {
    providerCalls += 1;
    const newer = providerCalls === 2;
    return {
      source: "EBAY_SOLD" as const,
      engineVersion: "ebay-sold-comps-v2.1.1" as const,
      query: snapshot().query,
      retrievedAt: newer ? "2026-08-07T12:00:00.000Z" : "2026-08-06T12:00:00.000Z",
      offset: newer ? 30 : 0,
      nextOffset: newer ? 60 : 30,
      requestedResultCount: 30,
      hasMore: true,
      candidates: Array.from({ length: 30 }, (_, index) => engineCandidate(String((newer ? 223456780000 : 123456780000) + index), 10000, {
        soldDate: newer ? "2026-08-07" : "2026-08-01",
      })),
    };
  };
  const identity = { category: "SPORTS" as const, playerName: "Michael Jordan", year: "1990", manufacturer: "SkyBox", productSet: "1990 SkyBox", parallel: "Base", cardNumber: "41", targetGrade: 9 };
  try {
    const first = await runCompsV2Search({ researchIdentity: identity, query: snapshot().query, operation: "FIND", adminId: "admin-1" }, { search: search as never });
    assert.equal(first.mode, "RESEARCH");
    const second = await runCompsV2Search({ researchIdentity: identity, query: snapshot().query, operation: "FETCH_MORE", reviewProof: first.researchProof, adminId: "admin-1" }, { search: search as never });
    assert.equal(second.result.candidates.length, 60);
    assert.equal(second.result.candidates[0].soldDate, "2026-08-07");
    assert.equal(second.result.hasMore, false);
    await assert.rejects(runCompsV2Search({ researchIdentity: identity, query: snapshot().query, operation: "FETCH_MORE", reviewProof: second.researchProof, adminId: "admin-1" }, { search: search as never }), (error: unknown) => (error as { code?: string }).code === "COMPS_LIMIT_REACHED");
    assert.equal(providerCalls, 2);
  } finally {
    if (previousKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = previousKey;
  }
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
    "autoAttemptedCardId === card.id", 'void runSearch("FIND")',
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
  assert.equal(page.includes("candidates.length < 60"), true);
  assert.equal(page.includes("[...candidates"), false);
  assert.equal(page.includes('mode === "CARD" && id'), true);
  assert.equal(page.includes('router.replace({ pathname: "/admin/comps"'), true);
  assert.equal(page.includes("setMarketValue"), false);
  assert.equal(server.includes("researchProof: createCompsV2ReviewProof"), true);
  assert.equal(server.includes("const selectedIds = current.candidates.filter"), true);
  for (const required of ["CARD_REVIEW", "createCompsV2ReviewProof", "verifyCompsV2ReviewProof", "reviewProof?.snapshot ?? currentSnapshot"]) {
    assert.equal(server.includes(required), true, `missing durable refresh contract: ${required}`);
  }
  assert.equal(server.includes("!proof &&"), true);
  assert.equal(page.includes('operation === "FETCH_MORE" ? payload.review.snapshot.candidates.filter'), true);
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
