import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { SPEEDSTER_RULE_VERSION } from "../lib/ai-grader-v2/contracts";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createAiGraderV2SessionsHandler } from "../pages/api/admin/ai-grader-v2/sessions";
import { createAiGraderV2SessionHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]";

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
    async findSession(id) {
      assert.equal(authenticated, true);
      assert.equal(id, "speedster-1");
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
    async updateSession(id, data) {
      assert.equal(id, "speedster-1");
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
