import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { fetchSpeedsterOriginalImageUrl } from "../lib/ai-grader-v2/original-image-urls";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createSpeedsterOriginalImageHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/original-image";

const SESSION_ID = "speedster-session-123456789";
const FRONT_KEY = `ai-grader-v2/admin-1/${SESSION_ID}/original/front.jpg`;

function request(method = "GET", side = "FRONT", storageKey = FRONT_KEY): NextApiRequest {
  return {
    method,
    query: { sessionId: SESSION_ID, side, storageKey },
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string; cache?: string } = {};
  const res = {
    setHeader(name: string, value: string) {
      if (name === "Allow") state.allow = value;
      if (name === "Cache-Control") state.cache = value;
      return this;
    },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

test("original image refresh re-signs only an exact owned DRAFT source key", async () => {
  const calls: string[] = [];
  const handler = createSpeedsterOriginalImageHandler({
    async requireAdminSession() { calls.push("auth"); return { user: { id: "admin-1" } }; },
    async findOwnedDraft(sessionId, userId) { calls.push(`find:${sessionId}:${userId}`); return { id: sessionId }; },
    async headOriginalObject(storageKey) { calls.push(`head:${storageKey}`); return { byteSize: 42, contentType: "image/jpeg" }; },
    async presignRead(storageKey) { calls.push(`sign:${storageKey}`); return "https://fresh.example/front"; },
  });
  const { state, res } = response();

  await handler(request(), res);

  assert.equal(state.status, 200);
  assert.equal(state.cache, "private, no-store");
  assert.deepEqual(calls, ["auth", `find:${SESSION_ID}:admin-1`, `head:${FRONT_KEY}`, `sign:${FRONT_KEY}`]);
  assert.deepEqual(state.body, { side: "FRONT", storageKey: FRONT_KEY, imageUrl: "https://fresh.example/front" });
});

test("original image refresh rejects cross-side keys and unavailable objects before signing", async () => {
  let heads = 0;
  let signs = 0;
  const handler = createSpeedsterOriginalImageHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedDraft(sessionId) { return { id: sessionId }; },
    async headOriginalObject() { heads += 1; return { byteSize: 42, contentType: "image/jpeg" }; },
    async presignRead() { signs += 1; return "unexpected"; },
  });
  const crossSide = response();
  await handler(request("GET", "BACK", FRONT_KEY), crossSide.res);
  assert.equal(crossSide.state.status, 400);
  assert.equal(heads, 0);
  assert.equal(signs, 0);

  const missing = createSpeedsterOriginalImageHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedDraft(sessionId) { return { id: sessionId }; },
    async headOriginalObject() { heads += 1; throw Object.assign(new Error("missing"), { name: "NoSuchKey" }); },
    async presignRead() { signs += 1; return "unexpected"; },
  });
  const unavailable = response();
  await missing(request(), unavailable.res);
  assert.equal(unavailable.state.status, 409);
  assert.equal(heads, 1);
  assert.equal(signs, 0);
  assert.doesNotMatch(JSON.stringify(unavailable.state.body), /NoSuchKey|credential/i);
});

test("original image refresh is authenticated and GET-only", async () => {
  let reads = 0;
  const handler = createSpeedsterOriginalImageHandler({
    async requireAdminSession() { throw new HttpError(401, "Missing or invalid Authorization header"); },
    async findOwnedDraft() { reads += 1; return null; },
    async headOriginalObject() { throw new Error("not used"); },
    async presignRead() { throw new Error("not used"); },
  });
  const unauthorized = response();
  await handler(request(), unauthorized.res);
  assert.equal(unauthorized.state.status, 401);
  assert.equal(reads, 0);

  const method = response();
  await handler(request("POST"), method.res);
  assert.equal(method.state.status, 405);
  assert.equal(method.state.allow, "GET");
});

test("original image browser client rejects a refreshed URL for a different source identity", async () => {
  const requests: Array<{ input: string; init: RequestInit }> = [];
  const url = await fetchSpeedsterOriginalImageUrl({
    token: "admin-token",
    sessionId: SESSION_ID,
    side: "FRONT",
    storageKey: FRONT_KEY,
    async fetcher(input, init) {
      requests.push({ input, init });
      return { ok: true, async json() { return { side: "FRONT", storageKey: FRONT_KEY, imageUrl: "https://fresh.example/front" }; } };
    },
  });
  assert.equal(url, "https://fresh.example/front");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal((requests[0].init.headers as Record<string, string>).Authorization, "Bearer admin-token");

  await assert.rejects(fetchSpeedsterOriginalImageUrl({
    token: "admin-token",
    sessionId: SESSION_ID,
    side: "FRONT",
    storageKey: FRONT_KEY,
    async fetcher() {
      return { ok: true, async json() { return { side: "FRONT", storageKey: FRONT_KEY.replace("front", "back"), imageUrl: "https://wrong.example" }; } };
    },
  }), /exact front original image could not be refreshed/i);
});

test("original image browser client bounds a stalled refresh and supplies an abort signal", async () => {
  const signals: AbortSignal[] = [];
  await assert.rejects(fetchSpeedsterOriginalImageUrl({
    token: "admin-token",
    sessionId: SESSION_ID,
    side: "FRONT",
    storageKey: FRONT_KEY,
    timeoutMs: 5,
    async fetcher(_input, init) {
      signals.push(init.signal as AbortSignal);
      return new Promise(() => {});
    },
  }), /timed out.*photos and current geometry are preserved/i);
  assert.equal(signals[0]?.aborted, true);
});

test("original image browser client also bounds a stalled response body", async () => {
  await assert.rejects(fetchSpeedsterOriginalImageUrl({
    token: "admin-token",
    sessionId: SESSION_ID,
    side: "FRONT",
    storageKey: FRONT_KEY,
    timeoutMs: 5,
    async fetcher() {
      return { ok: true, json: async () => new Promise(() => {}) };
    },
  }), /timed out.*photos and current geometry are preserved/i);
});
