import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderAdminApiHandler, type AiGraderAdminApiService } from "../lib/server/aiGraderApi";

type MockRequestInput = {
  method: string;
  action?: string[];
  body?: unknown;
};

type MockResponse = NextApiResponse & {
  statusCodeValue: number | null;
  headers: Record<string, string | number | readonly string[]>;
  jsonBody: unknown;
};

const adminSession = {
  sessionId: "session-1",
  tokenHash: "token-hash",
  user: {
    id: "admin-1",
    phone: "+15555550100",
    displayName: "Admin",
  },
};

function mockRequest(input: MockRequestInput): NextApiRequest {
  return {
    method: input.method,
    query: input.action ? { action: input.action } : {},
    body: input.body,
    headers: {},
  } as NextApiRequest;
}

function mockResponse(): MockResponse {
  const res = {
    statusCodeValue: null,
    headers: {},
    jsonBody: undefined,
    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers[name] = value;
      return this;
    },
    status(statusCode: number) {
      this.statusCodeValue = statusCode;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      return this;
    },
  } as MockResponse;
  return res;
}

function mockService(overrides: Partial<AiGraderAdminApiService> = {}): AiGraderAdminApiService {
  const defaultCall = async () => ({ id: "result-1" });
  return {
    createCaptureSessionDraft: defaultCall,
    persistOrchestratorTransition: defaultCall,
    persistMacroSuspectRegions: defaultCall,
    createGradeRunDraft: defaultCall,
    finalizeGradeRun: defaultCall,
    createAuthRunDraft: defaultCall,
    finalizeAuthRun: defaultCall,
    ...overrides,
  };
}

test("disabled feature gate returns before auth or service loading", async () => {
  let authCalls = 0;
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: {},
    requireAdminSession: async () => {
      authCalls += 1;
      return adminSession;
    },
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["capture-sessions", "draft"],
      body: { tenantId: "tenant-1" },
    }),
    res
  );

  assert.equal(res.statusCodeValue, 503);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    enabled: false,
    code: "AI_GRADER_API_DISABLED",
    message: "AI Grader admin API is disabled. Set AI_GRADER_API_ENABLED=true to enable.",
  });
  assert.equal(authCalls, 0);
  assert.equal(serviceLoads, 0);
});

test("unsupported method returns 405", async () => {
  let authCalls = 0;
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true" },
    requireAdminSession: async () => {
      authCalls += 1;
      return adminSession;
    },
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
  });
  const res = mockResponse();

  await handler(mockRequest({ method: "GET", action: ["grade-runs", "draft"] }), res);

  assert.equal(res.statusCodeValue, 405);
  assert.equal(res.headers.Allow, "POST");
  assert.deepEqual(res.jsonBody, { ok: false, message: "Method not allowed" });
  assert.equal(authCalls, 0);
  assert.equal(serviceLoads, 0);
});

test("unauthorized admin request is rejected before service loading", async () => {
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true" },
    requireAdminSession: async () => {
      throw Object.assign(new Error("Admin privileges required"), { statusCode: 403 });
    },
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["macro", "suspect-regions"],
      body: { tenantId: "tenant-1" },
    }),
    res
  );

  assert.equal(res.statusCodeValue, 403);
  assert.deepEqual(res.jsonBody, { ok: false, message: "Admin privileges required" });
  assert.equal(serviceLoads, 0);
});

test("validation errors map to 400", async () => {
  const issues = [{ path: "captureSession.tenantId", code: "REQUIRED", message: "tenantId is required." }];
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true" },
    requireAdminSession: async () => adminSession,
    getService: () =>
      mockService({
        createCaptureSessionDraft: async () => {
          throw Object.assign(new Error("Invalid capture session draft input."), {
            name: "AiGraderServiceValidationError",
            issues,
          });
        },
      }),
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["capture-sessions", "draft"],
      body: {},
    }),
    res
  );

  assert.equal(res.statusCodeValue, 400);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    message: "Invalid capture session draft input.",
    issues,
  });
});

test("successful mocked service call returns operation JSON", async () => {
  let receivedBody: unknown = null;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true" },
    requireAdminSession: async () => adminSession,
    getService: () =>
      mockService({
        finalizeAuthRun: async (body) => {
          receivedBody = body;
          return { updatedCount: 1 };
        },
      }),
  });
  const res = mockResponse();
  const body = {
    tenantId: "tenant-1",
    authRunId: "auth-run-1",
    requestedVerdict: "AUTHENTIC",
    measurements: {},
    evidence: {},
  };

  await handler(
    mockRequest({
      method: "POST",
      action: ["auth-runs", "finalize"],
      body,
    }),
    res
  );

  assert.equal(res.statusCodeValue, 200);
  assert.deepEqual(res.jsonBody, {
    ok: true,
    enabled: true,
    operation: "finalizeAuthRun",
    result: { updatedCount: 1 },
  });
  assert.deepEqual(receivedBody, body);
});

test("enabled status returns route list without loading service", async () => {
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true" },
    requireAdminSession: async () => adminSession,
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
  });
  const res = mockResponse();

  await handler(mockRequest({ method: "GET", action: ["status"] }), res);

  assert.equal(res.statusCodeValue, 200);
  assert.equal(serviceLoads, 0);
  assert.deepEqual(res.jsonBody, {
    ok: true,
    enabled: true,
    service: "ai-grader-admin-api",
    user: adminSession.user,
    routes: [
      "status",
      "health",
      "capture-sessions/draft",
      "orchestrator/transition",
      "macro/suspect-regions",
      "grade-runs/draft",
      "grade-runs/finalize",
      "auth-runs/draft",
      "auth-runs/finalize",
    ],
  });
});
