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

test("simulator API is disabled when simulator flag is off and does not load service", async () => {
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

  await handler(
    mockRequest({
      method: "POST",
      action: ["simulator", "generate"],
      body: { mode: "QUICK" },
    }),
    res
  );

  assert.equal(res.statusCodeValue, 503);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    enabled: false,
    code: "AI_GRADER_SIMULATOR_DISABLED",
    message: "AI Grader simulator mode is disabled. Set AI_GRADER_SIMULATOR_ENABLED=true to enable.",
  });
  assert.equal(serviceLoads, 0);
  assert.equal(authCalls, 0);
});

test("simulator API returns a valid manifest when enabled without loading DB service", async () => {
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true", AI_GRADER_SIMULATOR_ENABLED: "true" },
    requireAdminSession: async () => adminSession,
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["simulator", "generate"],
      body: { mode: "STANDARD" },
    }),
    res
  );

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as {
    ok: boolean;
    operation: string;
    result: {
      simulator: true;
      mode: string;
      summary: {
        frameCount: number;
        microSpotPackageCount: number;
        helperInstanceId: string | null;
        calibrationSnapshotIds: string[];
        storageKeyExamples: string[];
        validation: { valid: boolean };
      };
      captureManifest?: { helperInstanceId: string; frameList: unknown[] };
      microSpotPackages?: unknown[];
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.operation, "generateSimulatorManifest");
  assert.equal(body.result.simulator, true);
  assert.equal(body.result.mode, "STANDARD");
  assert.equal(body.result.summary.validation.valid, true);
  assert.equal(body.result.summary.frameCount, 15);
  assert.equal(body.result.summary.microSpotPackageCount, 11);
  assert.equal(body.result.summary.helperInstanceId, "simulated-helper-instance");
  assert.ok(body.result.summary.calibrationSnapshotIds.length > 0);
  assert.ok(body.result.summary.storageKeyExamples.length > 0);
  assert.equal(body.result.captureManifest?.frameList.length, 15);
  assert.equal(body.result.microSpotPackages?.length, 11);
  assert.equal(serviceLoads, 0);
});

test("simulated session API is disabled when API gate is off", async () => {
  let authCalls = 0;
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_SIMULATOR_ENABLED: "true" },
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
      action: ["simulator", "session"],
      body: {},
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

test("simulated session API is disabled when simulator gate is off", async () => {
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

  await handler(
    mockRequest({
      method: "POST",
      action: ["simulator", "session"],
      body: {},
    }),
    res
  );

  assert.equal(res.statusCodeValue, 503);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    enabled: false,
    code: "AI_GRADER_SIMULATOR_DISABLED",
    message: "AI Grader simulator mode is disabled. Set AI_GRADER_SIMULATOR_ENABLED=true to enable.",
  });
  assert.equal(authCalls, 0);
  assert.equal(serviceLoads, 0);
});

test("simulated session API returns a full STANDARD workflow without loading DB service", async () => {
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true", AI_GRADER_SIMULATOR_ENABLED: "true" },
    requireAdminSession: async () => adminSession,
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["simulator", "session"],
      body: {},
    }),
    res
  );

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as {
    ok: boolean;
    operation: string;
    result: {
      simulator: true;
      workflow: string;
      session: { sessionId: string; mode: string; helperInstanceId: string; calibrationSnapshotIds: string[] };
      manifest: { id: string; checksumSha256: string; frameCount: number; validation: { valid: boolean } };
      macro: { frameCount: number; frames: unknown[] };
      micro: { packageCount: number; evidenceFrameCount: number; surfaceSuspectCount: number; packages: unknown[] };
      gradeRunDraft: { status: string; computesGrades: boolean; inputChecksum: string };
      certificateReadiness: { ready: boolean; message: string };
      validation: { valid: boolean };
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.operation, "generateSimulatedSessionWorkflow");
  assert.equal(body.result.simulator, true);
  assert.equal(body.result.workflow, "STANDARD_SESSION");
  assert.equal(body.result.session.mode, "STANDARD");
  assert.equal(body.result.session.sessionId, "simulated-session");
  assert.equal(body.result.session.helperInstanceId, "simulated-helper-instance");
  assert.ok(body.result.session.calibrationSnapshotIds.length > 0);
  assert.equal(body.result.manifest.frameCount, 15);
  assert.match(body.result.manifest.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(body.result.manifest.validation.valid, true);
  assert.equal(body.result.macro.frameCount, 4);
  assert.equal(body.result.macro.frames.length, 4);
  assert.equal(body.result.micro.packageCount, 11);
  assert.equal(body.result.micro.evidenceFrameCount, 110);
  assert.equal(body.result.micro.surfaceSuspectCount, 3);
  assert.equal(body.result.micro.packages.length, 11);
  assert.equal(body.result.gradeRunDraft.status, "SIMULATED_DRAFT");
  assert.equal(body.result.gradeRunDraft.computesGrades, false);
  assert.equal(body.result.gradeRunDraft.inputChecksum, body.result.manifest.checksumSha256);
  assert.equal(body.result.certificateReadiness.ready, false);
  assert.equal(body.result.certificateReadiness.message, "simulation only; production DB migration and hardware capture required");
  assert.equal(body.result.validation.valid, true);
  assert.equal(serviceLoads, 0);
});

test("simulator device capability action returns manifests without hardware or service calls", async () => {
  let serviceLoads = 0;
  let generatorCalls = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true", AI_GRADER_SIMULATOR_ENABLED: "true" },
    requireAdminSession: async () => adminSession,
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
    generateSimulatorManifest: async (input) => {
      generatorCalls += 1;
      assert.equal(input.mode, "DEVICE_CAPABILITIES");
      return {
        simulator: true,
        mode: "DEVICE_CAPABILITIES",
        summary: {
          mode: "DEVICE_CAPABILITIES",
          frameCount: 0,
          microSpotPackageCount: 0,
          evidenceArtifactCount: 0,
          deviceCapabilityCount: 5,
          helperInstanceId: "helper-test",
          calibrationSnapshotIds: [],
          storageKeyExamples: [],
          validation: { valid: true, issues: [] },
        },
        deviceCapabilityManifests: [],
      };
    },
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["simulator", "generate"],
      body: { mode: "DEVICE_CAPABILITIES" },
    }),
    res
  );

  assert.equal(res.statusCodeValue, 200);
  assert.equal(generatorCalls, 1);
  assert.equal(serviceLoads, 0);
});

test("helper bridge disabled returns before auth, fetch, or service loading", async () => {
  let authCalls = 0;
  let fetchCalls = 0;
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
    helperBridgeFetch: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const res = mockResponse();

  await handler(mockRequest({ method: "GET", action: ["helper", "health"] }), res);

  assert.equal(res.statusCodeValue, 503);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    enabled: false,
    code: "AI_GRADER_HELPER_BRIDGE_DISABLED",
    message: "AI Grader helper bridge is disabled. Set AI_GRADER_HELPER_BRIDGE_ENABLED=true to enable.",
  });
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(serviceLoads, 0);
});

test("helper bridge rejects non-loopback base URL before network call", async () => {
  let authCalls = 0;
  let fetchCalls = 0;
  const handler = createAiGraderAdminApiHandler({
    env: {
      AI_GRADER_API_ENABLED: "true",
      AI_GRADER_HELPER_BRIDGE_ENABLED: "true",
      AI_GRADER_HELPER_BASE_URL: "http://192.168.1.10:47650",
    },
    requireAdminSession: async () => {
      authCalls += 1;
      return adminSession;
    },
    getService: () => mockService(),
    helperBridgeFetch: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  const res = mockResponse();

  await handler(mockRequest({ method: "GET", action: ["helper", "health"] }), res);

  assert.equal(res.statusCodeValue, 400);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    code: "AI_GRADER_HELPER_BRIDGE_CONFIG_INVALID",
    message: "AI Grader helper bridge base URL must use http and a loopback host.",
  });
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("helper bridge health success maps cleanly without loading DB service", async () => {
  let fetchCalls = 0;
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: {
      AI_GRADER_API_ENABLED: "true",
      AI_GRADER_HELPER_BRIDGE_ENABLED: "true",
      AI_GRADER_HELPER_BASE_URL: "http://127.0.0.1:47650",
    },
    requireAdminSession: async () => adminSession,
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
    helperBridgeFetch: async (input, init) => {
      fetchCalls += 1;
      assert.equal(input, "http://127.0.0.1:47650/health");
      assert.equal(init?.method, undefined);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          service: "ai-grader-capture-helper",
          status: "simulator_offline",
          mode: "simulator",
          driverSet: "mock",
        }),
      };
    },
  });
  const res = mockResponse();

  await handler(mockRequest({ method: "GET", action: ["helper", "health"] }), res);

  assert.equal(res.statusCodeValue, 200);
  assert.deepEqual(res.jsonBody, {
    ok: true,
    enabled: true,
    operation: "helperBridgeHealth",
    result: {
      ok: true,
      service: "ai-grader-capture-helper",
      status: "simulator_offline",
      mode: "simulator",
      driverSet: "mock",
    },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(serviceLoads, 0);
});

test("helper bridge timeout maps to clear JSON error", async () => {
  const handler = createAiGraderAdminApiHandler({
    env: {
      AI_GRADER_API_ENABLED: "true",
      AI_GRADER_HELPER_BRIDGE_ENABLED: "true",
      AI_GRADER_HELPER_BASE_URL: "http://127.0.0.1:47650",
    },
    requireAdminSession: async () => adminSession,
    getService: () => mockService(),
    helperBridgeFetch: async () => {
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    },
  });
  const res = mockResponse();

  await handler(mockRequest({ method: "GET", action: ["helper", "capabilities"] }), res);

  assert.equal(res.statusCodeValue, 504);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    code: "AI_GRADER_HELPER_BRIDGE_TIMEOUT",
    message: "AI Grader helper bridge request timed out.",
  });
});

test("helper bridge manifest proxies valid simulator/mock manifest without loading service", async () => {
  let fetchCalls = 0;
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: {
      AI_GRADER_API_ENABLED: "true",
      AI_GRADER_HELPER_BRIDGE_ENABLED: "true",
      AI_GRADER_HELPER_BASE_URL: "http://localhost:47650",
    },
    requireAdminSession: async () => adminSession,
    getService: () => {
      serviceLoads += 1;
      return mockService();
    },
    helperBridgeFetch: async (input, init) => {
      fetchCalls += 1;
      assert.equal(input, "http://localhost:47650/manifest");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ mode: "STANDARD" }));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          service: "ai-grader-capture-helper",
          simulator: true,
          captureMode: "STANDARD",
          validation: { valid: true, issues: [] },
          captureManifest: {
            helperInstanceId: "helper-1",
            calibrationSnapshotIds: ["cal-1"],
            frameList: Array.from({ length: 15 }, (_, index) => ({ frameId: `frame-${index}` })),
          },
          microSpotPackages: Array.from({ length: 11 }, (_, index) => ({ id: `spot-${index}` })),
        }),
      };
    },
  });
  const res = mockResponse();

  await handler(
    mockRequest({
      method: "POST",
      action: ["helper", "manifest"],
      body: { mode: "STANDARD" },
    }),
    res
  );

  assert.equal(res.statusCodeValue, 200);
  const body = res.jsonBody as {
    ok: boolean;
    operation: string;
    result: {
      captureMode: string;
      validation: { valid: boolean };
      captureManifest: { frameList: unknown[]; helperInstanceId: string };
      microSpotPackages: unknown[];
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.operation, "helperBridgeManifest");
  assert.equal(body.result.captureMode, "STANDARD");
  assert.equal(body.result.validation.valid, true);
  assert.equal(body.result.captureManifest.frameList.length, 15);
  assert.equal(body.result.captureManifest.helperInstanceId, "helper-1");
  assert.equal(body.result.microSpotPackages.length, 11);
  assert.equal(fetchCalls, 1);
  assert.equal(serviceLoads, 0);
});

test("enabled status returns route list without loading service", async () => {
  let serviceLoads = 0;
  const handler = createAiGraderAdminApiHandler({
    env: { AI_GRADER_API_ENABLED: "true", AI_GRADER_SIMULATOR_ENABLED: "true" },
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
    simulator: {
      enabled: true,
      message: "AI Grader simulator mode is enabled for local-only manifest generation.",
    },
    helperBridge: {
      enabled: false,
      configured: false,
      code: "AI_GRADER_HELPER_BRIDGE_DISABLED",
      message: "AI Grader helper bridge is disabled. Set AI_GRADER_HELPER_BRIDGE_ENABLED=true to enable.",
    },
    user: adminSession.user,
    routes: [
      "status",
      "health",
      "simulator/generate",
      "simulator/session",
      "helper/health",
      "helper/capabilities",
      "helper/manifest",
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
