import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  fetchSpeedsterPreparedRectifiedImageUrl,
  SPEEDSTER_PREPARED_IMAGE_REFRESH_INTERVAL_MS,
} from "../lib/ai-grader-v2/prepared-image-urls";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createSpeedsterPreparedImageHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/prepared-image";

const SESSION_ID = "speedster-session-123456789";

function request(method: string, side: string = "FRONT", sessionId: string = SESSION_ID): NextApiRequest {
  return {
    method,
    query: { sessionId, side },
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string; cacheControl?: string } = {};
  const res = {
    setHeader(name: string, value: string) {
      if (name === "Allow") state.allow = value;
      if (name === "Cache-Control") state.cacheControl = value;
      return this;
    },
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as NextApiResponse;
  return { state, res };
}

test("prepared image refresh signs only the owned already-written Front rectified artifact", async () => {
  const calls: string[] = [];
  const handler = createSpeedsterPreparedImageHandler({
    async requireAdminSession() {
      calls.push("auth");
      return { user: { id: "admin-1" } };
    },
    async findOwnedSession(sessionId, userId) {
      calls.push(`find:${sessionId}:${userId}`);
      return { id: sessionId };
    },
    async headPreparedObject(storageKey) {
      calls.push(`head:${storageKey}`);
      return { byteSize: 42_000, contentType: "image/webp" };
    },
    async presignRead(storageKey) {
      calls.push(`sign:${storageKey}`);
      return `https://fresh.example/${encodeURIComponent(storageKey)}`;
    },
  });
  const { state, res } = response();

  await handler(request("GET"), res);

  const expectedKey = `ai-grader-v2/admin-1/${SESSION_ID}/prepared/front/rectified.webp`;
  assert.equal(state.status, 200);
  assert.equal(state.cacheControl, "private, no-store");
  assert.deepEqual(calls, [
    "auth",
    `find:${SESSION_ID}:admin-1`,
    `head:${expectedKey}`,
    `sign:${expectedKey}`,
  ]);
  assert.deepEqual(state.body, {
    side: "FRONT",
    imageUrl: `https://fresh.example/${encodeURIComponent(expectedKey)}`,
  });
});

test("prepared image refresh supports Back independently and never accepts a caller storage key", async () => {
  let signedKey = "";
  const handler = createSpeedsterPreparedImageHandler({
    async requireAdminSession() { return { user: { id: "admin-2" } }; },
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async headPreparedObject() { return { byteSize: 1, contentType: "image/webp; charset=binary" }; },
    async presignRead(storageKey) {
      signedKey = storageKey;
      return "https://fresh.example/back";
    },
  });
  const req = request("GET", "BACK") as NextApiRequest & { query: Record<string, string> };
  req.query.storageKey = "ai-grader-v2/another-admin/private.webp";
  const { state, res } = response();

  await handler(req, res);

  assert.equal(state.status, 200);
  assert.equal(signedKey, `ai-grader-v2/admin-2/${SESSION_ID}/prepared/back/rectified.webp`);
});

test("prepared image refresh rejects missing ownership and missing artifacts before signing", async () => {
  let heads = 0;
  let signs = 0;
  const dependencies = {
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession() { return null; },
    async headPreparedObject() { heads += 1; return { byteSize: 1, contentType: "image/webp" }; },
    async presignRead() { signs += 1; return "unexpected"; },
  };
  const missingOwner = createSpeedsterPreparedImageHandler(dependencies);
  const first = response();
  await missingOwner(request("GET"), first.res);
  assert.equal(first.state.status, 404);
  assert.equal(heads, 0);
  assert.equal(signs, 0);

  const missingArtifact = createSpeedsterPreparedImageHandler({
    ...dependencies,
    async findOwnedSession(sessionId) { return { id: sessionId }; },
    async headPreparedObject() { heads += 1; throw new Error("NoSuchKey"); },
  });
  const second = response();
  await missingArtifact(request("GET"), second.res);
  assert.equal(second.state.status, 409);
  assert.equal(heads, 1);
  assert.equal(signs, 0);
  assert.doesNotMatch(JSON.stringify(second.state.body), /NoSuchKey|storage|credential/i);
});

test("prepared image refresh is authenticated, GET-only, and validates session and side", async () => {
  let reads = 0;
  const unauthorized = createSpeedsterPreparedImageHandler({
    async requireAdminSession() { throw new HttpError(401, "Missing or invalid Authorization header"); },
    async findOwnedSession() { reads += 1; return null; },
    async headPreparedObject() { throw new Error("not used"); },
    async presignRead() { throw new Error("not used"); },
  });
  const auth = response();
  await unauthorized(request("GET"), auth.res);
  assert.equal(auth.state.status, 401);
  assert.equal(reads, 0);

  const method = response();
  await unauthorized(request("POST"), method.res);
  assert.equal(method.state.status, 405);
  assert.equal(method.state.allow, "GET");

  const validating = createSpeedsterPreparedImageHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedSession() { reads += 1; return null; },
    async headPreparedObject() { throw new Error("not used"); },
    async presignRead() { throw new Error("not used"); },
  });
  const side = response();
  await validating(request("GET", "LEFT"), side.res);
  assert.equal(side.state.status, 400);
  const session = response();
  await validating(request("GET", "FRONT", "short"), session.res);
  assert.equal(session.state.status, 400);
  assert.equal(reads, 0);
});

test("prepared image browser client renews Front and Back with no-store before the ten-minute URL lifetime", async () => {
  const requests: Array<{ input: string; init: RequestInit }> = [];
  for (const side of ["FRONT", "BACK"] as const) {
    const result = await fetchSpeedsterPreparedRectifiedImageUrl({
      token: "admin-token",
      sessionId: SESSION_ID,
      side,
      async fetcher(input, init) {
        requests.push({ input, init });
        return { ok: true, async json() { return { side, imageUrl: `https://fresh.example/${side}` }; } };
      },
    });
    assert.equal(result, `https://fresh.example/${side}`);
  }

  assert.deepEqual(requests.map(({ input }) => input), [
    `/api/admin/ai-grader-v2/sessions/${SESSION_ID}/prepared-image?side=FRONT`,
    `/api/admin/ai-grader-v2/sessions/${SESSION_ID}/prepared-image?side=BACK`,
  ]);
  assert.ok(requests.every(({ init }) => init.method === "GET" && init.cache === "no-store"));
  assert.ok(requests.every(({ init }) => (init.headers as Record<string, string>).Authorization === "Bearer admin-token"));
  assert.ok(SPEEDSTER_PREPARED_IMAGE_REFRESH_INTERVAL_MS < 10 * 60 * 1000);
});
