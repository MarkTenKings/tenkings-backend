import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { SPEEDSTER_RULE_VERSION } from "../lib/ai-grader-v2/contracts";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createAiGraderV2SessionsHandler } from "../pages/api/admin/ai-grader-v2/sessions";
import { createAiGraderV2SessionHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]";
import {
  freshSpeedsterMeasureEvidence,
  sanitizeSpeedsterGeometryPayload,
  speedsterServiceHeaders,
} from "../pages/api/admin/ai-grader-v2/image/[action]";

function request(method: string, body?: unknown, sessionId?: string): NextApiRequest {
  return {
    method,
    body,
    query: sessionId ? { sessionId } : {},
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string } = {};
  const res = {
    setHeader(name: string, value: string) {
      if (name === "Allow") state.allow = value;
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

const admin = async () => ({ user: { id: "admin-1" } });

test("geometry proxy clamps automatic handles to the reachable image boundary", () => {
  assert.deepEqual(sanitizeSpeedsterGeometryPayload({
    width: 1200,
    height: 1600,
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: -0.3, y: 1.4 },
    ],
  }), {
    width: 1200,
    height: 1600,
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0, y: 1 },
    ],
  });
});

test("POST creates one compact draft with server-owned rule and creator identity", async () => {
  let saved: Record<string, unknown> | undefined;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession(data) {
      saved = data;
      return { id: "speedster-1", ...data };
    },
  });
  const { state, res } = response();

  await handler(
    request("POST", {
      cardProfile: "POKEMON",
      identity: { cardName: "Charizard" },
    }),
    res,
  );

  assert.equal(state.status, 201);
  assert.equal(saved?.createdByUserId, "admin-1");
  assert.equal(saved?.workflowState, "DRAFT");
  assert.equal(saved?.ruleVersion, SPEEDSTER_RULE_VERSION);
  assert.deepEqual(saved?.capture, {});
  assert.deepEqual(saved?.reviewedDefects, []);
  assert.deepEqual(saved?.gradeReport, {});
});

test("POST accepts only the two Speedster card profiles", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() {
      calls += 1;
      return {};
    },
  });
  const { state, res } = response();

  await handler(request("POST", { cardProfile: "BASEBALL" }), res);

  assert.equal(state.status, 400);
  assert.equal(calls, 0);
});

test("POST requires the existing admin session", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    async requireAdminSession() {
      throw new HttpError(401, "Missing or invalid Authorization header");
    },
    async createSession() {
      calls += 1;
      return {};
    },
  });
  const { state, res } = response();

  await handler(request("POST", { cardProfile: "SPORTS" }), res);

  assert.equal(state.status, 401);
  assert.equal(calls, 0);
});

test("GET returns one V2 session after admin authentication", async () => {
  let authenticated = false;
  const existing = { id: "speedster-1", publicReportSlug: null };
  const handler = createAiGraderV2SessionHandler({
    async requireAdminSession() {
      authenticated = true;
      return { user: { id: "admin-1" } };
    },
    async findSession(id, createdByUserId) {
      assert.equal(authenticated, true);
      assert.equal(id, "speedster-1");
      assert.equal(createdByUserId, "admin-1");
      return existing;
    },
    async updateSession() {
      throw new Error("not used");
    },
  });
  const { state, res } = response();

  await handler(request("GET", undefined, "speedster-1"), res);

  assert.equal(state.status, 200);
  assert.deepEqual(state.body, { session: existing });
});

test("PATCH sends only supplied V2 fields", async () => {
  let update: Record<string, unknown> | undefined;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return { id: "speedster-1", publicReportSlug: null };
    },
    async updateSession(id, createdByUserId, data) {
      assert.equal(id, "speedster-1");
      assert.equal(createdByUserId, "admin-1");
      update = data;
      return { id, ...data };
    },
  });
  const { state, res } = response();

  await handler(
    request("PATCH", { reviewedDefects: [{ id: "defect-1", reviewResult: "ACCEPTED" }] }, "speedster-1"),
    res,
  );

  assert.equal(state.status, 200);
  assert.deepEqual(update, {
    reviewedDefects: [{ id: "defect-1", reviewResult: "ACCEPTED" }],
  });
});

test("upload planning binds the requested session to the existing admin identity", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = readFileSync(`${root}/pages/api/admin/ai-grader-v2/upload-plan.ts`, "utf8");
  assert.match(source, /where: \{ id: sessionId, createdByUserId: admin\.user\.id \}/);
  assert.match(source, /if \(!session\) return res\.status\(404\)/);
  assert.match(source, /"RECTIFIED", "INSPECTION", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"/);
});

test("SAM proxy adds its one optional server-only bearer header", () => {
  const original = process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
  try {
    delete process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
    assert.deepEqual(speedsterServiceHeaders(), { "Content-Type": "application/json" });
    process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY = "runpod-key";
    assert.deepEqual(speedsterServiceHeaders(), {
      "Content-Type": "application/json",
      Authorization: "Bearer runpod-key",
    });
  } finally {
    if (original === undefined) delete process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY;
    else process.env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY = original;
  }
});

test("Smart-Mark proxy replaces a stale browser URL from the owned persisted inspection key", async () => {
  const calls: unknown[] = [];
  const body = {
    sessionId: "speedster-1",
    side: "BACK",
    cornerShape: "SQUARE",
    evidenceView: {
      id: "BACK:ORIGINAL",
      imageUrl: "https://stale.example/back.webp",
      inspectionFrame: { width: 1350, height: 1858 },
    },
    marks: [{ id: "smart-1" }],
  };
  const refreshed = await freshSpeedsterMeasureEvidence(body, "admin-1", {
    async findOwnedCapture(sessionId, createdByUserId) {
      calls.push(["find", sessionId, createdByUserId]);
      return {
        capture: {
          front: { inspectionStorageKey: "ai-grader-v2/admin-1/speedster-1/prepared/front/inspection.webp" },
          back: { inspectionStorageKey: "ai-grader-v2/admin-1/speedster-1/prepared/back/inspection.webp" },
        },
      };
    },
    async presignRead(storageKey, expiresInSeconds) {
      calls.push(["sign", storageKey, expiresInSeconds]);
      return "https://fresh.example/back.webp";
    },
  });

  assert.deepEqual(calls, [
    ["find", "speedster-1", "admin-1"],
    ["sign", "ai-grader-v2/admin-1/speedster-1/prepared/back/inspection.webp", 600],
  ]);
  assert.equal("sessionId" in refreshed, false);
  assert.deepEqual(refreshed, {
    side: body.side,
    cornerShape: body.cornerShape,
    evidenceView: { ...body.evidenceView, imageUrl: "https://fresh.example/back.webp" },
    marks: body.marks,
  });
});

test("Smart-Mark evidence refresh is side-bound, owner-bound, and nonblocking", async () => {
  const body = {
    sessionId: "speedster-1",
    side: "BACK",
    evidenceView: { id: "BACK:ORIGINAL", imageUrl: "https://stale.example/back.webp" },
  };
  let signCalls = 0;
  const missingRequestedSide = await freshSpeedsterMeasureEvidence(body, "admin-1", {
    async findOwnedCapture() {
      return { capture: { front: { inspectionStorageKey: "private/front.webp" } } };
    },
    async presignRead() {
      signCalls += 1;
      return "unexpected";
    },
  });
  assert.equal(signCalls, 0);
  assert.equal((missingRequestedSide.evidenceView as Record<string, unknown>).imageUrl, body.evidenceView.imageUrl);

  const wrongPersistedKey = await freshSpeedsterMeasureEvidence(body, "admin-1", {
    async findOwnedCapture() {
      return { capture: { back: { inspectionStorageKey: "ai-grader-v2/another-admin/speedster-1/prepared/back/inspection.webp" } } };
    },
    async presignRead() {
      signCalls += 1;
      return "unexpected";
    },
  });
  assert.equal(signCalls, 0);
  assert.equal((wrongPersistedKey.evidenceView as Record<string, unknown>).imageUrl, body.evidenceView.imageUrl);

  const unowned = await freshSpeedsterMeasureEvidence(body, "another-admin", {
    async findOwnedCapture() { return null; },
    async presignRead() {
      signCalls += 1;
      return "unexpected";
    },
  });
  assert.equal(signCalls, 0);
  assert.equal((unowned.evidenceView as Record<string, unknown>).imageUrl, body.evidenceView.imageUrl);

  const signingFailure = await freshSpeedsterMeasureEvidence(body, "admin-1", {
    async findOwnedCapture() {
      return { capture: { back: { inspectionStorageKey: "ai-grader-v2/admin-1/speedster-1/prepared/back/inspection.webp" } } };
    },
    async presignRead() { throw new Error("signer unavailable"); },
  });
  assert.equal((signingFailure.evidenceView as Record<string, unknown>).imageUrl, body.evidenceView.imageUrl);
  assert.equal("sessionId" in signingFailure, false);
});

test("PATCH keeps an assigned public report slug stable", async () => {
  let updateCalls = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return { id: "speedster-1", publicReportSlug: "tk-charizard-1" };
    },
    async updateSession() {
      updateCalls += 1;
      return {};
    },
  });
  const { state, res } = response();

  await handler(
    request("PATCH", { publicReportSlug: "tk-charizard-2" }, "speedster-1"),
    res,
  );

  assert.equal(state.status, 409);
  assert.equal(updateCalls, 0);
});

test("session routes expose only their direct methods", async () => {
  const create = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() {
      return {};
    },
  });
  const detail = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return null;
    },
    async updateSession() {
      return {};
    },
  });
  const first = response();
  const second = response();

  await create(request("GET"), first.res);
  await detail(request("POST", {}, "speedster-1"), second.res);

  assert.equal(first.state.status, 405);
  assert.equal(first.state.allow, "POST");
  assert.equal(second.state.status, 405);
  assert.equal(second.state.allow, "GET, PATCH");
});
