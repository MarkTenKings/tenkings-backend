import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderDesignReferenceApiHandler } from "../lib/server/aiGraderDesignReferenceApi";
import { parseAiGraderIntendedDesignBoundaryDraft } from "../lib/aiGraderDesignReferenceDraft";

function response() {
  const state: { status?: number; body?: unknown; sent?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    send(body: unknown) { state.sent = body; return this; },
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function request(action: string, body: Record<string, unknown>, method = "POST") {
  return { method, query: { action: [action] }, body, headers: {} } as unknown as NextApiRequest;
}

function service(overrides: Record<string, unknown> = {}) {
  return {
    async createVerifiedDraft() { return { id: "draft-1" }; },
    async list() { return []; },
    async resolveExactApproved() { return approvedRow(); },
    async approve() { return { id: "approved-1" }; },
    async retire() { return { id: "retired-1" }; },
    ...overrides,
  } as any;
}

function approvedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ref-approved-1",
    tenantId: "tenant-1",
    setId: "set-1",
    programId: "program-1",
    cardNumber: "7",
    variantId: null,
    variantKey: "",
    parallelId: null,
    parallelKey: "",
    side: "front",
    profile: "registered_design_template_v1",
    version: 3,
    status: "approved",
    artifactStorageKey: "private/design-reference.png",
    artifactSha256: "a".repeat(64),
    artifactMimeType: "image/png",
    artifactWidthPx: 100,
    artifactHeightPx: 200,
    intendedDesignBoundary: {
      schemaVersion: "ai-grader-intended-design-boundary-v1",
      coordinateFrame: "design_reference_pixels",
      contour: [[10, 20], [90, 20], [90, 180], [10, 180]],
    },
    provenance: { schemaVersion: "ai-grader-design-reference-provenance-v1", sourceKind: "controlled_scan", approvedForPrecisionReference: true },
    transformAcceptanceMetadata: { schemaVersion: "ai-grader-design-reference-transform-acceptance-v1", registrationAlgorithmVersion: "v1", maxResidualPx: 2, minInlierFraction: 0.8 },
    createdByUserId: "admin-create",
    approvedByUserId: "admin-approve",
    approvedAt: new Date("2026-07-18T12:00:00.000Z"),
    retiredByUserId: null,
    retiredAt: null,
    retirementReason: null,
    createdAt: new Date("2026-07-18T11:00:00.000Z"),
    updatedAt: new Date("2026-07-18T12:00:00.000Z"),
    ...overrides,
  };
}

test("draft authority always comes from the authenticated admin", async () => {
  let received: Record<string, unknown> | undefined;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({ async createVerifiedDraft(input: Record<string, unknown>) { received = input; return { id: "draft-1" }; } }),
  });
  const { state, res } = response();
  await runtime(request("draft", { tenantId: "tenant-1", createdByUserId: "spoofed" }), res);
  assert.equal(state.status, 201);
  assert.equal(received?.createdByUserId, "admin-exact");
  assert.equal(received?.tenantId, "tenant-1");
});

test("list preserves explicit null variant and parallel identity", async () => {
  let received: Record<string, unknown> | undefined;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({ async list(input: Record<string, unknown>) { received = input; return []; } }),
  });
  const identity = { tenantId: "tenant-1", setId: "set-1", programId: "program-1", cardNumber: "7", variantId: null, parallelId: null, side: "front", profile: "registered_design_template_v1" };
  const { state, res } = response();
  await runtime(request("list", identity), res);
  assert.equal(state.status, 200);
  assert.ok(Object.prototype.hasOwnProperty.call(received, "variantId"));
  assert.equal(received?.variantId, null);
  assert.equal(received?.parallelId, null);
});

test("approve forwards exact id/version/hash and maps service conflicts", async () => {
  let received: Record<string, unknown> | undefined;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({
      async approve(input: Record<string, unknown>) {
        received = input;
        throw Object.assign(new Error("Exact draft changed."), { code: "AI_GRADER_DESIGN_REFERENCE_STATE_CONFLICT" });
      },
    }),
  });
  const { state, res } = response();
  await runtime(request("approve", { referenceId: "ref-1", version: 4, expectedArtifactSha256: "a".repeat(64) }), res);
  assert.equal(state.status, 409);
  assert.deepEqual(
    { referenceId: received?.referenceId, version: received?.version, hash: received?.expectedArtifactSha256, actor: received?.approvedByUserId },
    { referenceId: "ref-1", version: 4, hash: "a".repeat(64), actor: "admin-exact" },
  );
});

test("authentication failure occurs before any reference mutation", async () => {
  let called = false;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); },
    service: service({ async createVerifiedDraft() { called = true; return { id: "never" }; } }),
  });
  const { state, res } = response();
  await runtime(request("draft", {}), res);
  assert.equal(state.status, 401);
  assert.equal(called, false);
});

test("admin boundary draft requires a finite measured contour inside the exact artifact", () => {
  const valid = parseAiGraderIntendedDesignBoundaryDraft(JSON.stringify({
    schemaVersion: "ai-grader-intended-design-boundary-v1",
    coordinateFrame: "design_reference_pixels",
    contour: [[20, 30], [1180, 30], [1180, 1650], [20, 1650]],
  }), 1200, 1680);
  assert.equal((valid.contour as unknown[]).length, 4);
  assert.throws(
    () => parseAiGraderIntendedDesignBoundaryDraft('{"schemaVersion":"ai-grader-intended-design-boundary-v1","coordinateFrame":"design_reference_pixels","contour":[]}', 1200, 1680),
    /4-64 measured pixel points/,
  );
  assert.throws(
    () => parseAiGraderIntendedDesignBoundaryDraft('{"schemaVersion":"ai-grader-intended-design-boundary-v1","coordinateFrame":"design_reference_pixels","contour":[[0,0],[1201,0],[1201,1],[0,1]]}', 1200, 1680),
    /outside the exact artifact dimensions/,
  );
  assert.throws(
    () => parseAiGraderIntendedDesignBoundaryDraft('{"schemaVersion":"ai-grader-intended-design-boundary-v1","coordinateFrame":"design_reference_pixels","contour":[[0,0],[1,0],[2,0],[3,0]]}', 1200, 1680),
    /non-zero area/,
  );
});

test("design-reference lifecycle accepts exact POST bodies only", async () => {
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service(),
  });
  const { state, res } = response();
  await runtime(request("list", {}, "GET"), res);
  assert.equal(state.status, 405);
  assert.equal(state.headers.Allow, "POST");
});

test("operator resolve projects approved pixel authority without exposing its private storage key", async () => {
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service(),
  });
  const { state, res } = response();
  await runtime(request("resolve", { version: 3, expectedArtifactSha256: "a".repeat(64) }), res);
  assert.equal(state.status, 200);
  const body = state.body as any;
  assert.equal(body.authority.databaseReferenceId, "ref-approved-1");
  assert.equal(body.authority.mathematicalReference.artifactSha256, "a".repeat(64));
  assert.deepEqual(body.authority.mathematicalReference.intendedPrintBoundary[0], { x: 0.1, y: 0.1 });
  assert.equal(JSON.stringify(body).includes("private/design-reference.png"), false);
});

test("operator active lookup selects one exact approved row and never returns its storage key", async () => {
  let resolved: Record<string, unknown> | undefined;
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({
      async list() {
        return [approvedRow({ status: "retired", version: 2 }), approvedRow()];
      },
      async resolveExactApproved(input: Record<string, unknown>) {
        resolved = input;
        return approvedRow();
      },
    }),
  });
  const identity = { tenantId: "tenant-1", setId: "set-1", programId: "program-1", cardNumber: "7", variantId: null, parallelId: null, side: "front", profile: "registered_design_template_v1" };
  const { state, res } = response();
  await runtime(request("active", identity), res);
  assert.equal(state.status, 200);
  assert.equal(resolved?.version, 3);
  assert.equal(resolved?.expectedArtifactSha256, "a".repeat(64));
  assert.equal(JSON.stringify(state.body).includes("private/design-reference.png"), false);

  const missing = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({ async list() { return []; } }),
  });
  const missingResponse = response();
  await missing(request("active", identity), missingResponse.res);
  assert.equal(missingResponse.state.status, 404);
  assert.equal((missingResponse.state.body as any).code, "AI_GRADER_DESIGN_REFERENCE_ACTIVE_NOT_FOUND");

  const ambiguous = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({ async list() { return [approvedRow(), approvedRow({ id: "ref-approved-2", version: 4 })]; } }),
  });
  const ambiguousResponse = response();
  await ambiguous(request("active", identity), ambiguousResponse.res);
  assert.equal(ambiguousResponse.state.status, 409);
  assert.equal((ambiguousResponse.state.body as any).code, "AI_GRADER_DESIGN_REFERENCE_ACTIVE_STATE_CONFLICT");
});

test("artifact transport rehashes the exact bytes after service resolution", async () => {
  const bytes = Buffer.from("exact-approved-reference");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const runtime = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({ async resolveExactApproved() { return approvedRow({ artifactSha256: hash }); } }),
    async readArtifactBytes(storageKey) {
      assert.equal(storageKey, "private/design-reference.png");
      return bytes;
    },
  });
  const { state, res } = response();
  await runtime(request("artifact", { version: 3, expectedArtifactSha256: hash }), res);
  assert.equal(state.status, 200);
  assert.deepEqual(state.sent, bytes);
  assert.equal(state.headers["X-Ten-Kings-Design-Reference-Sha256"], hash);

  const tampered = createAiGraderDesignReferenceApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: service({ async resolveExactApproved() { return approvedRow({ artifactSha256: hash }); } }),
    async readArtifactBytes() { return Buffer.from("changed"); },
  });
  const failed = response();
  await tampered(request("artifact", { version: 3, expectedArtifactSha256: hash }), failed.res);
  assert.equal(failed.state.status, 409);
  assert.equal((failed.state.body as any).code, "AI_GRADER_DESIGN_REFERENCE_ARTIFACT_INTEGRITY_MISMATCH");
});
