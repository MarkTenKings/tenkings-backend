import test from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  createAiGraderMathematicalCalibrationSnapshotApiHandler,
} from "../lib/server/aiGraderMathematicalCalibrationSnapshotApi";

function response() {
  const state: { status?: number; body?: any; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(value: unknown) { state.body = value; return this; },
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function request(action: string, body: Record<string, unknown>, method = "POST") {
  return { method, query: { action: [action] }, body } as unknown as NextApiRequest;
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    async importDraft() { return { id: "draft-1" }; },
    async listForRig() { return []; },
    async trust() { return { id: "trusted-1" }; },
    async revoke() { return { id: "revoked-1" }; },
    async supersede() { return { id: "replacement-1" }; },
    ...overrides,
  } as any;
}

test("import, trust, revoke, and supersede actors come only from authenticated admin", async () => {
  const received: Record<string, Record<string, unknown>> = {};
  const runtime = createAiGraderMathematicalCalibrationSnapshotApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({
      async importDraft(input: Record<string, unknown>) { received.import = input; return { id: "draft" }; },
      async trust(input: Record<string, unknown>) { received.trust = input; return { id: "trusted" }; },
      async revoke(input: Record<string, unknown>) { received.revoke = input; return { id: "revoked" }; },
      async supersede(input: Record<string, unknown>) { received.supersede = input; return { id: "new" }; },
    }),
  });
  for (const [action, actorField] of [
    ["import", "importedByOperatorId"],
    ["trust", "trustedByOperatorId"],
    ["revoke", "revokedByOperatorId"],
    ["supersede", "supersededByOperatorId"],
  ]) {
    const { state, res } = response();
    await runtime(request(action, { [actorField]: "spoofed", snapshotId: "snapshot-1" }), res);
    assert.ok(state.status === 200 || state.status === 201);
    assert.equal(received[action]?.[actorField], "admin-exact");
  }
});

test("list is exact rig scoped and storage integrity conflicts are public-safe", async () => {
  let rigId = "";
  const runtime = createAiGraderMathematicalCalibrationSnapshotApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({
      async listForRig(value: string) { rigId = value; return []; },
      async trust() {
        throw Object.assign(new Error("Current storage bytes changed."), {
          code: "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
        });
      },
    }),
  });
  const listed = response();
  await runtime(request("list", { rigId: "fixed-rig-1" }), listed.res);
  assert.equal(rigId, "fixed-rig-1");
  assert.equal(listed.state.status, 200);

  const conflict = response();
  await runtime(request("trust", {}), conflict.res);
  assert.equal(conflict.state.status, 409);
  assert.match(conflict.state.body.message, /storage bytes changed/i);
});

test("authentication and POST-only checks occur before lifecycle mutation", async () => {
  let called = false;
  const runtime = createAiGraderMathematicalCalibrationSnapshotApiHandler({
    async requireAdminSession() { throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); },
    service: service({ async trust() { called = true; return {}; } }),
  });
  const unauthorized = response();
  await runtime(request("trust", {}), unauthorized.res);
  assert.equal(unauthorized.state.status, 401);
  assert.equal(called, false);

  const allowedRuntime = createAiGraderMathematicalCalibrationSnapshotApiHandler({
    async requireAdminSession() { return { user: { id: "admin" } }; },
    service: service(),
  });
  const method = response();
  await allowedRuntime(request("list", {}, "GET"), method.res);
  assert.equal(method.state.status, 405);
  assert.equal(method.state.headers.Allow, "POST");
});
