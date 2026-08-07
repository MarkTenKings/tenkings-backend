import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { SPEEDSTER_RULE_VERSION } from "../lib/ai-grader-v2/contracts";
import { SPEEDSTER_TRACE_PIXEL_COUNT, encodeSpeedsterTraceRleV1 } from "../lib/ai-grader-v2/trace-codec";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { createAiGraderV2SessionsHandler } from "../pages/api/admin/ai-grader-v2/sessions";
import { createAiGraderV2SessionHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]";
import {
  sanitizeSpeedsterTraceProposalFailure,
  sanitizeSpeedsterGeometryPayload,
  speedsterServiceBody,
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
      identity: {
        cardName: "  Charizard  ",
        year: "1999",
        productSet: "Base Set",
        parallel: "Holo",
        cardNumber: "4/102",
      },
    }),
    res,
  );

  assert.equal(state.status, 201);
  assert.equal(saved?.createdByUserId, "admin-1");
  assert.equal(saved?.workflowState, "DRAFT");
  assert.equal(saved?.ruleVersion, SPEEDSTER_RULE_VERSION);
  assert.deepEqual(saved?.identity, {
    cardName: "Charizard",
    year: "1999",
    productSet: "Base Set",
    parallel: "Holo",
    cardNumber: "4/102",
  });
  assert.deepEqual(saved?.capture, {});
  assert.deepEqual(saved?.reviewedDefects, []);
  assert.deepEqual(saved?.gradeReport, {});
});

test("POST creates a Sports draft with only category-valid identity fields", async () => {
  let saved: Record<string, unknown> | undefined;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession(data) { saved = data; return data; },
  });
  const { state, res } = response();
  await handler(request("POST", {
    cardProfile: "SPORTS",
    identity: {
      playerName: "Victor Wembanyama",
      year: "2023",
      manufacturer: "Panini",
      productSet: "Prizm",
      parallel: null,
      insert: "Rookie",
      cardNumber: "136",
    },
  }), res);
  assert.equal(state.status, 201);
  assert.deepEqual(saved?.identity, {
    playerName: "Victor Wembanyama",
    year: "2023",
    manufacturer: "Panini",
    productSet: "Prizm",
    parallel: null,
    insert: "Rookie",
    cardNumber: "136",
  });
  assert.equal(JSON.stringify(saved?.identity).includes("cardName"), false);
});

test("POST rejects inactive category fields and arbitrary identity keys before persistence", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() { calls += 1; return {}; },
  });
  const attempts = [
    {
      cardProfile: "SPORTS",
      identity: {
        playerName: "Nick Bosa",
        cardName: "stale pokemon value",
        year: "2021",
        manufacturer: "Panini",
        productSet: "Obsidian",
      },
    },
    {
      cardProfile: "POKEMON",
      identity: {
        cardName: "Charizard",
        playerName: "stale sports value",
        year: "1999",
        productSet: "Base Set",
      },
    },
    {
      cardProfile: "POKEMON",
      identity: {
        cardName: "Charizard",
        year: "1999",
        productSet: "Base Set",
        manufacturer: "forbidden",
      },
    },
    {
      cardProfile: "POKEMON",
      identity: {
        cardName: "Charizard",
        year: "1999",
        productSet: "Base Set",
        centeringGrade: "10",
      },
    },
  ];
  for (const body of attempts) {
    const { state, res } = response();
    await handler(request("POST", body), res);
    assert.equal(state.status, 400);
  }
  assert.equal(calls, 0);
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

test("POST cannot inject capture, reviewed findings, or grade authority into a draft", async () => {
  let calls = 0;
  const handler = createAiGraderV2SessionsHandler({
    requireAdminSession: admin,
    async createSession() {
      calls += 1;
      return {};
    },
  });

  for (const injected of [
    { capture: { cornerShape: "SQUARE" } },
    { reviewedDefects: [{ id: "browser-owned" }] },
    { gradeReport: { detectorVersion: "browser-owned" } },
  ]) {
    const { state, res } = response();
    await handler(request("POST", { cardProfile: "POKEMON", ...injected }), res);
    assert.equal(state.status, 400);
  }
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

test("generic PATCH rejects client-owned reviewedDefects and gradeReport authority", async () => {
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

  assert.equal(state.status, 400);
  assert.equal(update, undefined);
});

test("generic PATCH permits only the DRAFT to CAPTURED transition with required capture", async () => {
  const attempts = [
    { workflowState: "REVIEWED", capture: {} },
    { workflowState: "CAPTURED" },
    { workflowState: "CAPTURED", capture: {}, identity: { cardName: "bypass" } },
    { cardProfile: "SPORTS" },
    { publicReportSlug: "client-owned" },
  ];
  for (const body of attempts) {
    let updateCalls = 0;
    const handler = createAiGraderV2SessionHandler({
      requireAdminSession: admin,
      async findSession() {
        return { id: "speedster-1", publicReportSlug: null, workflowState: "DRAFT", reviewedDefects: [] };
      },
      async updateSession() { updateCalls += 1; return {}; },
    });
    const result = response();
    await handler(request("PATCH", body, "speedster-1"), result.res);
    assert.equal(result.state.status, 400, JSON.stringify(body));
    assert.equal(updateCalls, 0, JSON.stringify(body));
  }
});

test("generic capture PATCH rejects a non-DRAFT session", async () => {
  let updateCalls = 0;
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() {
      return { id: "speedster-1", publicReportSlug: null, workflowState: "COMPLETED", reviewedDefects: [] };
    },
    async updateSession() { updateCalls += 1; return {}; },
  });
  const result = response();
  await handler(request("PATCH", { workflowState: "CAPTURED", capture: { cornerShape: "SQUARE" } }, "speedster-1"), result.res);
  assert.equal(result.state.status, 409);
  assert.equal(updateCalls, 0);
});

test("GET and PATCH responses strip private removal state from aggregate findings", async () => {
  const tracePixels = new Uint8Array(SPEEDSTER_TRACE_PIXEL_COUNT);
  tracePixels[1000] = 1;
  const finalTrace = encodeSpeedsterTraceRleV1(tracePixels);
  const privateFinding = {
    id: "FRONT:removed",
    side: "FRONT",
    zone: "SURFACE",
    defectType: "LIGHT_SCRATCH_SCUFF",
    origin: "DETECTOR",
    confidence: 0.9,
    canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
    sourceViewId: "FRONT:ORIGINAL",
    supportingViewIds: [],
    reviewResult: "REMOVED",
    reviewResultBeforeRemoval: "TYPE_CORRECTED",
    measurement: {
      widthMm: 1, heightMm: 1, areaMm2: 1, zonePercent: 1,
      multiplier: 1, weightedAreaMm2: 1, subgradeEffect: 0,
    },
  };
  const {
    zone: _zone,
    canonicalContour: _contour,
    measurement: _measurement,
    reviewResultBeforeRemoval: _prior,
    ...sourceCommon
  } = privateFinding;
  const existing = {
    id: "speedster-1",
    publicReportSlug: null,
    workflowState: "DRAFT",
    reviewedDefects: [privateFinding, {
      ...sourceCommon,
      id: "FRONT:trace-source",
      reviewResult: "TYPE_CORRECTED",
      finalTrace,
      traceProvenance: { finalTraceSha256: finalTrace.sha256 },
      measurementRegions: [{
        zone: "SURFACE",
        canonicalContour: privateFinding.canonicalContour,
        measurement: { ...privateFinding.measurement, pixelCount: 1 },
      }],
    }],
  };
  const handler = createAiGraderV2SessionHandler({
    requireAdminSession: admin,
    async findSession() { return existing; },
    async updateSession() { return { ...existing, workflowState: "CAPTURED" }; },
  });
  const getResult = response();
  await handler(request("GET", undefined, "speedster-1"), getResult.res);
  assert.equal(JSON.stringify(getResult.state.body).includes("reviewResultBeforeRemoval"), false);
  assert.equal(JSON.stringify(getResult.state.body).includes("\"runs\""), false);
  const patchResult = response();
  await handler(request("PATCH", { workflowState: "CAPTURED", capture: { cornerShape: "SQUARE" } }, "speedster-1"), patchResult.res);
  assert.equal(JSON.stringify(patchResult.state.body).includes("reviewResultBeforeRemoval"), false);
  assert.equal(JSON.stringify(patchResult.state.body).includes("\"runs\""), false);
});

test("review changes use the one owned review-action route and never call client measure or generic PATCH", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const start = page.indexOf("const runReviewRemeasurement");
  const end = page.indexOf("const traceProposal", start);
  const action = page.slice(start, end);

  assert.match(action, /\/review-action/);
  assert.match(action, /method: "POST"/);
  assert.doesNotMatch(action, /speedsterImageService\.measure/);
  assert.doesNotMatch(action, /method: "PATCH"/);
  assert.ok(action.indexOf("await fetch") < action.indexOf("setDefects(payload.reviewedDefects)"));
  assert.doesNotMatch(action, /hydratedById|new Map\(|setDefects\(nextDefects\)/);
  assert.doesNotMatch(action, /finalTrace:\s*undefined/);
  assert.match(action, /const \{ finalTrace, \.\.\.trace \} = action\.trace/);
  assert.match(action, /traceWire: encodeSpeedsterTraceBitmapWireV1/);

  const loaderStart = page.indexOf("const loadTrace", start);
  const loaderEnd = page.indexOf("const traceProposal", loaderStart);
  const loader = page.slice(loaderStart, loaderEnd);
  assert.match(loader, /method:\s*"GET"/);
  assert.match(loader, /\/review-action\?findingId=/);
  assert.match(loader, /decodeSpeedsterTraceBitmapWireV1/);
  assert.match(page, /onTraceLoad=\{loadTrace\}/);

  const workspace = readFileSync(
    `${root}/components/ai-grader-v2/ReviewWorkspace.tsx`,
    "utf8",
  );
  assert.match(workspace, /onTraceLoad\?:/);
  assert.match(workspace, /onTraceLoad=\{onTraceLoad\}/);

  const proposalEnd = page.indexOf("const saveTrace", loaderEnd);
  const proposal = page.slice(loaderEnd, proposalEnd);
  assert.match(proposal, /findingId: input\.target\.findingId/);
  assert.match(proposal, /currentTraceWire/);
  assert.doesNotMatch(proposal, /evidenceView|sourceImageUrls|sourceViewId|cornerShape/);

  assert.match(page, /JSON\.stringify\(\{ action: \{ type: "INITIALIZE" \} \}\)/);
  assert.doesNotMatch(page, /speedsterImageService\.detect|initialDefects|detectorVersion/);
  assert.match(page, /Retry server scan/);
  assert.match(page, /void initializeReview\(\)/);

  const imageProxy = readFileSync(`${root}/pages/api/admin/ai-grader-v2/image/[action].ts`, "utf8");
  assert.doesNotMatch(imageProxy, /ACTIONS[^\n]+detect/);
  const reviewRoute = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`,
    "utf8",
  );
  assert.match(reviewRoute, /z\.object\(\{ type: z\.literal\("INITIALIZE"\) \}\)\.strict\(\)/);
  assert.doesNotMatch(reviewRoute, /initialDefects/);
});

test("review CAS is short, serializable, and compares the exact persisted updatedAt after external work", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const core = readFileSync(`${root}/lib/server/aiGraderV2ReviewAction.ts`, "utf8");
  const route = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`,
    "utf8",
  );
  assert.ok(core.indexOf("await deps.measure") < core.lastIndexOf("await deps.persistReviewIfRevision"));
  assert.ok(core.indexOf("serverOwnedInitialization") < core.indexOf("await deps.persistReviewIfRevision"));
  assert.match(route, /current\.updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/);
  assert.match(route, /updatedAt: expectedUpdatedAt/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /isolationLevel: "Serializable"/);
  const casStart = route.indexOf("persistReviewIfRevision:");
  const casEnd = route.indexOf("},\n};", casStart);
  assert.doesNotMatch(route.slice(casStart, casEnd), /presignRead|fetch\(|\/measure|\/detect/);
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

test("trace proposal authorizes a persisted non-ORIGINAL source view and supplies server findings", async () => {
  const sessionId = "speedster-12345678901234567890";
  const prefix = `ai-grader-v2/admin-1/${sessionId}/prepared/front`;
  const body = await speedsterServiceBody("trace-proposal", {
    sessionId,
    side: "FRONT",
    findingId: "front-directional-1",
    stroke: { canonicalPoints: [{ x: 1, y: 1 }], strokeWidthPixels: 1, strokeWidthMm: 1 },
    currentTraceWire: null,
  }, "admin-1", {
    async findOwnedCapture() {
      return {
        capture: {
          cornerShape: "SQUARE",
          front: {
            inspectionStorageKey: `${prefix}/inspection.webp`,
            inspectionFrame: { width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
            viewStorageKeys: {
              NORMALIZED: `${prefix}/normalized.webp`,
              MICRO_DEFECT: `${prefix}/micro_defect.webp`,
              DIRECTIONAL: `${prefix}/directional.webp`,
            },
          },
        },
        reviewedDefects: [{
          id: "front-directional-1",
          side: "FRONT",
          zone: "SURFACE",
          defectType: "LIGHT_SCRATCH_SCUFF",
          confidence: 0.9,
          canonicalContour: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 }],
          sourceViewId: "FRONT:DIRECTIONAL",
          supportingViewIds: [],
          reviewResult: "UNREVIEWED",
          measurement: {
            widthMm: 1,
            heightMm: 1,
            areaMm2: 1,
            zonePercent: 1,
            multiplier: 1,
            weightedAreaMm2: 1,
            subgradeEffect: 0,
          },
        }],
      };
    },
    async presignRead(storageKey) {
      assert.equal(storageKey, `${prefix}/directional.webp`);
      return "https://fresh.example/directional.webp";
    },
  }, "sam-request-123");

  assert.equal((body.evidenceView as { imageUrl: string }).imageUrl, "https://fresh.example/directional.webp");
  assert.equal((body.evidenceView as { id: string }).id, "FRONT:DIRECTIONAL");
  assert.equal(body.sourceViewId, "FRONT:DIRECTIONAL");
  assert.equal(body.cornerShape, "SQUARE");
  assert.equal(body.requestTraceId, "sam-request-123");
  assert.deepEqual(body.findings, []);
  assert.equal("sessionId" in body, false);
  assert.equal("currentTraceWire" in body, false);
});

test("trace proposal proxy preserves a sanitized upstream failure with its request ID", () => {
  assert.deepEqual(sanitizeSpeedsterTraceProposalFailure({
    detail: "RuntimeError: CUDA failed at https://signed.example/object?token=secret\nBearer sk-secret12345678",
  }, "sam-request-123"), {
    message: "SAM proposal failed: RuntimeError: CUDA failed at [redacted-url] Bearer [redacted-credential] (request sam-request-123).",
    requestId: "sam-request-123",
  });
});

test("PATCH rejects public report slug mutation through the generic route", async () => {
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

  assert.equal(state.status, 400);
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
