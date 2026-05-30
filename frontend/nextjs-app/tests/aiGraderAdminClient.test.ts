import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderAdminApiError,
  fetchAiGraderAdminStatus,
  generateAiGraderSimulatorManifest,
  postAiGraderAdminOperation,
  type AiGraderAdminFetch,
} from "../lib/aiGraderAdminClient";
import {
  canRunAiGraderSimulator as canRunSimulatorFromUi,
  canSubmitAiGraderOperation as canSubmitFromUi,
  hasAiGraderAdminAccess as hasAccessFromUi,
  resolveAiGraderAdminGateState as resolveGateFromUi,
} from "../lib/aiGraderAdminUi";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("disabled status response is returned without throwing", async () => {
  let fetchCalls = 0;
  const fetchImpl: AiGraderAdminFetch = async (input, init) => {
    fetchCalls += 1;
    assert.equal(input, "/api/admin/ai-grader/status");
    assert.deepEqual(init?.headers, { Authorization: "Bearer token-1" });
    return jsonResponse(503, {
      ok: false,
      enabled: false,
      code: "AI_GRADER_API_DISABLED",
      message: "AI Grader admin API is disabled.",
    });
  };

  const status = await fetchAiGraderAdminStatus({ Authorization: "Bearer token-1" }, fetchImpl);

  assert.equal(fetchCalls, 1);
  assert.deepEqual(status, {
    enabled: false,
    message: "AI Grader admin API is disabled.",
    code: "AI_GRADER_API_DISABLED",
    simulator: {
      enabled: false,
      code: "AI_GRADER_SIMULATOR_DISABLED",
      message: "AI Grader simulator status is unavailable while the admin API is disabled.",
    },
  });
  assert.equal(canSubmitFromUi(status), false);
  assert.equal(canRunSimulatorFromUi(status), false);
});

test("enabled status response exposes routes and allows submit", async () => {
  const status = await fetchAiGraderAdminStatus({}, async () =>
    jsonResponse(200, {
      ok: true,
      enabled: true,
      service: "ai-grader-admin-api",
      routes: ["status", "capture-sessions/draft"],
      simulator: { enabled: true, message: "Simulator enabled." },
      user: { id: "admin-1", phone: "+15555550100", displayName: "Admin" },
    })
  );

  assert.equal(status.enabled, true);
  assert.equal(status.simulator?.enabled, true);
  assert.deepEqual(status.routes, ["status", "capture-sessions/draft"]);
  assert.equal(status.user?.id, "admin-1");
  assert.equal(canSubmitFromUi(status), true);
  assert.equal(canRunSimulatorFromUi(status), true);
});

test("operation client maps validation errors to typed api errors", async () => {
  const issues = [{ path: "tenantId", message: "tenantId is required." }];

  await assert.rejects(
    () =>
      postAiGraderAdminOperation(
        "captureSessionDraft",
        {},
        { Authorization: "Bearer token-1" },
        async (input, init) => {
          assert.equal(input, "/api/admin/ai-grader/capture-sessions/draft");
          assert.equal(init?.method, "POST");
          assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
          assert.equal(init?.body, "{}");
          return jsonResponse(400, {
            ok: false,
            message: "Invalid capture session draft input.",
            issues,
          });
        }
      ),
    (error) => {
      assert.equal(error instanceof AiGraderAdminApiError, true);
      const apiError = error as AiGraderAdminApiError;
      assert.equal(apiError.status, 400);
      assert.equal(apiError.message, "Invalid capture session draft input.");
      assert.deepEqual(apiError.issues, issues);
      return true;
    }
  );
});

test("simulator client maps disabled response to typed api error", async () => {
  await assert.rejects(
    () =>
      generateAiGraderSimulatorManifest("QUICK", { Authorization: "Bearer token-1" }, async (input, init) => {
        assert.equal(input, "/api/admin/ai-grader/simulator/generate");
        assert.equal(init?.method, "POST");
        assert.equal(init?.body, JSON.stringify({ mode: "QUICK" }));
        return jsonResponse(503, {
          ok: false,
          enabled: false,
          code: "AI_GRADER_SIMULATOR_DISABLED",
          message: "AI Grader simulator mode is disabled.",
        });
      }),
    (error) => {
      assert.equal(error instanceof AiGraderAdminApiError, true);
      const apiError = error as AiGraderAdminApiError;
      assert.equal(apiError.status, 503);
      assert.equal(apiError.code, "AI_GRADER_SIMULATOR_DISABLED");
      assert.equal(apiError.disabled, true);
      return true;
    }
  );
});

test("simulator client maps valid simulator response", async () => {
  const result = await generateAiGraderSimulatorManifest("AUTH_ONLY", {}, async (input, init) => {
    assert.equal(input, "/api/admin/ai-grader/simulator/generate");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(init?.body, JSON.stringify({ mode: "AUTH_ONLY" }));
    return jsonResponse(200, {
      ok: true,
      enabled: true,
      operation: "generateSimulatorManifest",
      result: {
        simulator: true,
        mode: "AUTH_ONLY",
        summary: {
          mode: "AUTH_ONLY",
          frameCount: 6,
          microSpotPackageCount: 0,
          evidenceArtifactCount: 0,
          deviceCapabilityCount: 0,
          helperInstanceId: "helper-1",
          calibrationSnapshotIds: ["cal-1"],
          storageKeyExamples: ["simulated-captures/tenant/session/seed/auth-only/auth-patch-1.jpg"],
          validation: { valid: true, issues: [] },
        },
        captureManifest: { id: "manifest-1" },
      },
    });
  });

  assert.equal(result.simulator, true);
  assert.equal(result.mode, "AUTH_ONLY");
  assert.equal(result.summary.validation.valid, true);
  assert.equal(result.summary.frameCount, 6);
  assert.equal(result.summary.helperInstanceId, "helper-1");
});

test("admin gate state follows existing admin auth shape", () => {
  assert.equal(resolveGateFromUi({ loading: true, session: null, isAdmin: false }), "loading");
  assert.equal(resolveGateFromUi({ loading: false, session: null, isAdmin: false }), "signed_out");
  assert.equal(
    resolveGateFromUi({
      loading: false,
      session: { token: "token-1", user: { id: "user-1", phone: "+15555550100" } },
      isAdmin: false,
    }),
    "forbidden"
  );
  assert.equal(
    resolveGateFromUi({
      loading: false,
      session: { token: "token-1", user: { id: "admin-1", phone: "+15555550100" } },
      isAdmin: true,
    }),
    "ready"
  );
});

test("admin access helper delegates to admin id and phone checks", () => {
  const accessors = {
    hasAdminAccess: (id?: string | null) => id === "admin-1",
    hasAdminPhoneAccess: (phone?: string | null) => phone === "+15555550100",
  };

  assert.equal(hasAccessFromUi({ user: { id: "admin-1", phone: null } }, accessors), true);
  assert.equal(hasAccessFromUi({ user: { id: "user-1", phone: "+15555550100" } }, accessors), true);
  assert.equal(hasAccessFromUi({ user: { id: "user-1", phone: "+15555550101" } }, accessors), false);
});
