import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  createCoalescedReviewImageRefresh,
  fetchSpeedsterReviewImageUrls,
} from "../lib/ai-grader-v2/review-image-urls";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createSpeedsterReviewImagesHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-images";

function request(method: string, sessionId = "speedster-session-123456789"): NextApiRequest {
  return {
    method,
    query: { sessionId },
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

function preparedCapture(userId = "admin-1", sessionId = "speedster-session-123456789") {
  const side = (value: "front" | "back") => {
    const prefix = `ai-grader-v2/${userId}/${sessionId}/prepared/${value}`;
    return {
      inspectionStorageKey: `${prefix}/inspection.webp`,
      viewStorageKeys: {
        NORMALIZED: `${prefix}/normalized.webp`,
        MICRO_DEFECT: `${prefix}/micro_defect.webp`,
        DIRECTIONAL: `${prefix}/directional.webp`,
      },
    };
  };
  return { front: side("front"), back: side("back") };
}

test("review image refresh authenticates ownership and returns every fresh review URL without writes", async () => {
  const calls: string[] = [];
  const sessionId = "speedster-session-123456789";
  const handler = createSpeedsterReviewImagesHandler({
    async requireAdminSession() {
      calls.push("auth");
      return { user: { id: "admin-1" } };
    },
    async findOwnedCapture(id, userId) {
      calls.push(`find:${id}:${userId}`);
      return { capture: preparedCapture(userId, id) };
    },
    async presignRead(storageKey) {
      calls.push(`sign:${storageKey}`);
      return `https://fresh.example/${encodeURIComponent(storageKey)}`;
    },
  });
  const { state, res } = response();

  await handler(request("GET", sessionId), res);

  assert.equal(state.status, 200);
  assert.equal(state.cacheControl, "private, no-store");
  assert.deepEqual(calls.slice(0, 2), ["auth", `find:${sessionId}:admin-1`]);
  assert.equal(calls.filter((value) => value.startsWith("sign:")).length, 8);
  const body = state.body as {
    urls: Record<"FRONT" | "BACK", { master: string; views: Record<string, string> }>;
  };
  assert.equal(body.urls.FRONT.master, body.urls.FRONT.views.ORIGINAL);
  assert.match(body.urls.FRONT.views.NORMALIZED, /prepared%2Ffront%2Fnormalized\.webp/);
  assert.match(body.urls.FRONT.views.MICRO_DEFECT, /prepared%2Ffront%2Fmicro_defect\.webp/);
  assert.match(body.urls.BACK.views.DIRECTIONAL, /prepared%2Fback%2Fdirectional\.webp/);
});

test("review image refresh rejects missing ownership before signing", async () => {
  let signCalls = 0;
  const handler = createSpeedsterReviewImagesHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedCapture(id, userId) {
      assert.equal(id, "speedster-session-123456789");
      assert.equal(userId, "admin-1");
      return null;
    },
    async presignRead() {
      signCalls += 1;
      return "unexpected";
    },
  });
  const { state, res } = response();

  await handler(request("GET"), res);

  assert.equal(state.status, 404);
  assert.equal(signCalls, 0);
});

test("review image refresh requires authentication and accepts only GET", async () => {
  let reads = 0;
  const dependencies = {
    async requireAdminSession() {
      throw new HttpError(401, "Missing or invalid Authorization header");
    },
    async findOwnedCapture() {
      reads += 1;
      return null;
    },
    async presignRead() {
      throw new Error("not used");
    },
  };
  const unauthorized = createSpeedsterReviewImagesHandler(dependencies);
  const first = response();
  await unauthorized(request("GET"), first.res);
  assert.equal(first.state.status, 401);
  assert.equal(reads, 0);

  const method = response();
  await unauthorized(request("POST"), method.res);
  assert.equal(method.state.status, 405);
  assert.equal(method.state.allow, "GET");
});

test("review image refresh refuses persisted keys outside the owned session", async () => {
  let signCalls = 0;
  const capture = preparedCapture();
  capture.back.viewStorageKeys.DIRECTIONAL = "ai-grader-v2/another-admin/private.webp";
  const handler = createSpeedsterReviewImagesHandler({
    async requireAdminSession() { return { user: { id: "admin-1" } }; },
    async findOwnedCapture() { return { capture }; },
    async presignRead() {
      signCalls += 1;
      return "unused";
    },
  });
  const { state, res } = response();

  await handler(request("GET"), res);

  assert.equal(state.status, 409);
  assert.equal(signCalls, 0);
});

test("simultaneous review image failures coalesce into one all-image refresh", async () => {
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const refresh = createCoalescedReviewImageRefresh(() => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  });

  const masterFailure = refresh();
  const closeUpFailure = refresh();
  const backFailure = refresh();
  assert.equal(masterFailure, closeUpFailure);
  assert.equal(closeUpFailure, backFailure);
  assert.equal(calls, 0);

  await Promise.resolve();
  assert.equal(calls, 1);
  release?.("fresh-map");
  assert.deepEqual(await Promise.all([masterFailure, closeUpFailure, backFailure]), [
    "fresh-map",
    "fresh-map",
    "fresh-map",
  ]);

  const later = refresh();
  await Promise.resolve();
  assert.equal(calls, 2);
  release?.("new-map");
  assert.equal(await later, "new-map");
});

test("browser refresh client requests the read-only owned-session action", async () => {
  let input = "";
  let init: RequestInit | undefined;
  const urls = {
    FRONT: { master: "front", views: { ORIGINAL: "front", NORMALIZED: "fn", MICRO_DEFECT: "fm", DIRECTIONAL: "fd" } },
    BACK: { master: "back", views: { ORIGINAL: "back", NORMALIZED: "bn", MICRO_DEFECT: "bm", DIRECTIONAL: "bd" } },
  } as const;
  const result = await fetchSpeedsterReviewImageUrls({
    token: "admin-token",
    sessionId: "speedster-session-123456789",
    async fetcher(nextInput, nextInit) {
      input = nextInput;
      init = nextInit;
      return { ok: true, async json() { return { urls }; } };
    },
  });

  assert.equal(input, "/api/admin/ai-grader-v2/sessions/speedster-session-123456789/review-images");
  assert.equal(init?.method, "GET");
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer admin-token");
  assert.equal(init?.cache, "no-store");
  assert.equal(result, urls);
});
