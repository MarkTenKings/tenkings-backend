import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderAdminApiError,
  fetchAiGraderAdminStatus,
  postAiGraderAdminOperation,
  type AiGraderAdminFetch,
} from "../lib/aiGraderAdminClient";
import {
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
  });
  assert.equal(canSubmitFromUi(status), false);
});

test("enabled status response exposes routes and allows submit", async () => {
  const status = await fetchAiGraderAdminStatus({}, async () =>
    jsonResponse(200, {
      ok: true,
      enabled: true,
      service: "ai-grader-admin-api",
      routes: ["status", "capture-sessions/draft"],
      user: { id: "admin-1", phone: "+15555550100", displayName: "Admin" },
    })
  );

  assert.equal(status.enabled, true);
  assert.deepEqual(status.routes, ["status", "capture-sessions/draft"]);
  assert.equal(status.user?.id, "admin-1");
  assert.equal(canSubmitFromUi(status), true);
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
