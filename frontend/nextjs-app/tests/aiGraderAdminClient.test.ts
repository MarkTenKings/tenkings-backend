import assert from "node:assert/strict";
import test from "node:test";
import {
  AiGraderAdminApiError,
  fetchAiGraderAdminStatus,
  fetchAiGraderHelperCapabilities,
  fetchAiGraderHelperHealth,
  generateAiGraderSimulatedSessionWorkflow,
  generateAiGraderHelperManifest,
  generateAiGraderSimulatorManifest,
  postAiGraderAdminOperation,
  type AiGraderAdminFetch,
} from "../lib/aiGraderAdminClient";
import {
  canRunAiGraderHelperBridge as canRunHelperBridgeFromUi,
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
  assert.equal(canRunHelperBridgeFromUi(status), false);
});

test("enabled status response exposes routes and allows submit", async () => {
  const status = await fetchAiGraderAdminStatus({}, async () =>
    jsonResponse(200, {
      ok: true,
      enabled: true,
      service: "ai-grader-admin-api",
      routes: ["status", "capture-sessions/draft"],
      simulator: { enabled: true, message: "Simulator enabled." },
      helperBridge: {
        enabled: true,
        configured: true,
        message: "Helper bridge enabled.",
        baseUrl: "http://127.0.0.1:47650",
      },
      user: { id: "admin-1", phone: "+15555550100", displayName: "Admin" },
    })
  );

  assert.equal(status.enabled, true);
  assert.equal(status.simulator?.enabled, true);
  assert.deepEqual(status.routes, ["status", "capture-sessions/draft"]);
  assert.equal(status.user?.id, "admin-1");
  assert.equal(canSubmitFromUi(status), true);
  assert.equal(canRunSimulatorFromUi(status), true);
  assert.equal(canRunHelperBridgeFromUi(status), true);
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

test("simulated session client maps disabled response to typed api error", async () => {
  await assert.rejects(
    () =>
      generateAiGraderSimulatedSessionWorkflow({ Authorization: "Bearer token-1" }, async (input, init) => {
        assert.equal(input, "/api/admin/ai-grader/simulator/session");
        assert.equal(init?.method, "POST");
        assert.equal(init?.body, JSON.stringify({}));
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

test("simulated session client maps success response", async () => {
  const result = await generateAiGraderSimulatedSessionWorkflow({}, async (input, init) => {
    assert.equal(input, "/api/admin/ai-grader/simulator/session");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(init?.body, JSON.stringify({}));
    return jsonResponse(200, {
      ok: true,
      enabled: true,
      operation: "generateSimulatedSessionWorkflow",
      result: {
        simulator: true,
        workflow: "STANDARD_SESSION",
        session: {
          sessionId: "simulated-session",
          tenantId: "simulated-tenant",
          mode: "STANDARD",
          helperInstanceId: "helper-1",
          calibrationSnapshotIds: ["cal-1"],
        },
        manifest: {
          id: "manifest-1",
          checksumSha256: "a".repeat(64),
          frameCount: 15,
          validation: { valid: true, issues: [] },
        },
        macro: {
          frameCount: 4,
          frames: [],
        },
        micro: {
          packageCount: 11,
          evidenceFrameCount: 110,
          surfaceSuspectCount: 3,
          packages: [],
        },
        gradeRunDraft: {
          status: "SIMULATED_DRAFT",
          captureSessionId: "simulated-session",
          captureManifestId: "manifest-1",
          algorithmVersionId: "simulated-standard-grader-v0",
          thresholdSetVersionId: "simulated-standard-thresholds-v0",
          runtimeEnvironmentId: "simulated-admin-workflow-runtime",
          inputChecksum: "a".repeat(64),
          computesGrades: false,
        },
        certificateReadiness: {
          ready: false,
          status: "SIMULATION_ONLY",
          message: "simulation only; production DB migration and hardware capture required",
        },
        validation: { valid: true, issues: [] },
      },
    });
  });

  assert.equal(result.workflow, "STANDARD_SESSION");
  assert.equal(result.session.mode, "STANDARD");
  assert.equal(result.manifest.frameCount, 15);
  assert.equal(result.micro.packageCount, 11);
  assert.equal(result.micro.surfaceSuspectCount, 3);
  assert.equal(result.certificateReadiness.ready, false);
});

test("helper bridge client maps disabled response to typed api error", async () => {
  await assert.rejects(
    () =>
      fetchAiGraderHelperHealth({ Authorization: "Bearer token-1" }, async (input, init) => {
        assert.equal(input, "/api/admin/ai-grader/helper/health");
        assert.equal(init?.method, undefined);
        return jsonResponse(503, {
          ok: false,
          enabled: false,
          code: "AI_GRADER_HELPER_BRIDGE_DISABLED",
          message: "AI Grader helper bridge is disabled.",
        });
      }),
    (error) => {
      assert.equal(error instanceof AiGraderAdminApiError, true);
      const apiError = error as AiGraderAdminApiError;
      assert.equal(apiError.status, 503);
      assert.equal(apiError.code, "AI_GRADER_HELPER_BRIDGE_DISABLED");
      assert.equal(apiError.disabled, true);
      return true;
    }
  );
});

test("helper bridge client maps health success response", async () => {
  const result = await fetchAiGraderHelperHealth({}, async (input) => {
    assert.equal(input, "/api/admin/ai-grader/helper/health");
    return jsonResponse(200, {
      ok: true,
      enabled: true,
      operation: "helperBridgeHealth",
      result: {
        service: "ai-grader-capture-helper",
        mode: "simulator",
        driverSet: "mock",
        status: "simulator_offline",
        hardwareAccess: "disabled",
      },
    });
  });

  assert.equal(result.service, "ai-grader-capture-helper");
  assert.equal(result.mode, "simulator");
  assert.equal(result.driverSet, "mock");
  assert.equal(result.status, "simulator_offline");
});

test("helper bridge client maps capabilities success response", async () => {
  const result = await fetchAiGraderHelperCapabilities({}, async (input) => {
    assert.equal(input, "/api/admin/ai-grader/helper/capabilities");
    return jsonResponse(200, {
      ok: true,
      enabled: true,
      operation: "helperBridgeCapabilities",
      result: {
        validation: { valid: true, issues: [] },
        deviceCapabilityManifests: [{ deviceKind: "MACRO_CAMERA" }, { deviceKind: "LED_CONTROLLER" }],
      },
    });
  });

  assert.equal(result.validation?.valid, true);
  assert.equal(result.deviceCapabilityManifests?.length, 2);
});

test("helper bridge client maps manifest success response", async () => {
  const result = await generateAiGraderHelperManifest("STANDARD", {}, async (input, init) => {
    assert.equal(input, "/api/admin/ai-grader/helper/manifest");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
    assert.equal(init?.body, JSON.stringify({ mode: "STANDARD" }));
    return jsonResponse(200, {
      ok: true,
      enabled: true,
      operation: "helperBridgeManifest",
      result: {
        captureMode: "STANDARD",
        validation: { valid: true, issues: [] },
        captureManifest: {
          helperInstanceId: "helper-1",
          calibrationSnapshotIds: ["cal-1"],
          frameList: Array.from({ length: 15 }, (_, index) => ({ frameId: `frame-${index}` })),
        },
        microSpotPackages: Array.from({ length: 11 }, (_, index) => ({ id: `spot-${index}` })),
      },
    });
  });

  assert.equal(result.validation?.valid, true);
  assert.equal(result.captureManifest?.frameList?.length, 15);
  assert.equal(result.captureManifest?.helperInstanceId, "helper-1");
  assert.equal(result.microSpotPackages?.length, 11);
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
