import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE } from "../lib/aiGraderReportBundle";
import {
  createAiGraderReportEditorApiHandler,
  createAiGraderReportEditorService,
  type AiGraderReportEditorState,
} from "../lib/server/aiGraderReportEditor";

function response() {
  const state: {
    status?: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { headers: {} };
  const res = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    setHeader(name: string, value: string) { state.headers[name] = value; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function request(
  action: string,
  options: { method?: string; reportId?: string; body?: unknown } = {},
) {
  return {
    method: options.method ?? (action === "state" ? "GET" : "POST"),
    query: {
      action: [action],
      ...(options.reportId ? { reportId: options.reportId } : {}),
    },
    body: options.body,
    headers: { "user-agent": "report-editor-test" },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as NextApiRequest;
}

function exactState(overrides: Partial<AiGraderReportEditorState> = {}): AiGraderReportEditorState {
  return {
    reportId: "report-editor-1",
    visibilityStatus: "public",
    completionStatus: "machine_failed",
    revisionToken: "a".repeat(64),
    sourceReportSchemaVersion: "ai-grader-report-bundle-v0.1",
    sourceBundleSha256: "b".repeat(64),
    baseScores: { centering: 10 },
    baseContent: { reportSummary: "Machine evidence was incomplete." },
    severeDefectCapProvenance: "none_source_report_has_no_v1_cap",
    machineFailure: { failed: true, codes: ["MACHINE_SUBGRADES_INCOMPLETE"] },
    editorialRevision: null,
    ...overrides,
  };
}

test("admin report editor exposes one exact state and authenticates before reads", async () => {
  let authenticated = false;
  const runtime = createAiGraderReportEditorApiHandler({
    async requireAdminSession() {
      authenticated = true;
      return { user: { id: "admin-1" } };
    },
    service: {
      async getState(input) {
        assert.equal(authenticated, true);
        assert.equal(input.reportId, "report-editor-1");
        return exactState();
      },
      async save() { throw new Error("not used"); },
      async setVisibility() { throw new Error("not used"); },
    },
  });
  const { state, res } = response();
  await runtime(request("state", { reportId: "report-editor-1" }), res);
  assert.equal(state.status, 200);
  assert.deepEqual(state.body, { ok: true, state: exactState() });
  assert.equal(JSON.stringify(state.body).includes("sourceBundle\""), false);
});

test("save binds source checksum, uses the authenticated admin, and accepts no client overall", async () => {
  let received: any;
  const runtime = createAiGraderReportEditorApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: {
      async getState() { throw new Error("not used"); },
      async save(input) { received = input; return exactState(); },
      async setVisibility() { throw new Error("not used"); },
    },
  });
  const body = {
    reportId: "report-editor-1",
    expectedRevisionToken: "a".repeat(64),
    expectedSourceBundleSha256: "b".repeat(64),
    scores: { centering: 9, corners: 8, edges: 9, surface: 9 },
    content: { cornersExplanation: "Confirmed corner wear." },
    reason: "Human adjudication after machine evidence failure.",
  };
  const { state, res } = response();
  await runtime(request("save", { body }), res);
  assert.equal(state.status, 200);
  assert.equal(received.actorUserId, "admin-exact");
  assert.equal(received.expectedSourceBundleSha256, "b".repeat(64));
  assert.equal(received.scores.corners, 8);

  const rejected = response();
  await runtime(request("save", { body: { ...body, overall: 10 } }), rejected.res);
  assert.equal(rejected.state.status, 400);
  assert.equal((rejected.state.body as any).code, "AI_GRADER_REPORT_EDITOR_INVALID_INPUT");
});

test("visibility has one source-bound revision token and rejects the save-only source field", async () => {
  let received: any;
  const runtime = createAiGraderReportEditorApiHandler({
    async requireAdminSession() { return { user: { id: "admin-exact" } }; },
    service: {
      async getState() { throw new Error("not used"); },
      async save() { throw new Error("not used"); },
      async setVisibility(input) { received = input; return exactState({ visibilityStatus: "coming_soon" }); },
    },
  });
  const body = {
    reportId: "report-editor-1",
    expectedRevisionToken: "a".repeat(64),
    visibilityStatus: "coming_soon",
    reason: "Hold the public presentation for review.",
  };
  const { state, res } = response();
  await runtime(request("visibility", { body }), res);
  assert.equal(state.status, 200);
  assert.equal(received.visibilityStatus, "coming_soon");
  assert.equal(received.expectedSourceBundleSha256, undefined);

  const rejected = response();
  await runtime(request("visibility", {
    body: { ...body, expectedSourceBundleSha256: "b".repeat(64) },
  }), rejected.res);
  assert.equal(rejected.state.status, 400);
});

function editorHarness(sourceBundle?: Record<string, unknown>) {
  const reportId = "report-editor-machine-failure";
  const bundle = structuredClone(
    sourceBundle ?? SAMPLE_AI_GRADER_REPORT_BUNDLE,
  ) as any;
  bundle.reportId = reportId;
  if (!sourceBundle) delete bundle.provisionalGrade.elementScores.corners;
  const bytes = Buffer.from(JSON.stringify(bundle), "utf8");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `ai-grader/reports/${reportId}/report-bundle.json`;
  const manifestEntry = {
    artifactId: `${reportId}:report-bundle`,
    kind: "report-bundle.json",
    storageKey,
    checksumSha256: checksum,
    byteSize: bytes.byteLength,
  };
  const row: any = {
    id: "report-row-1",
    tenantId: "ten-kings",
    reportId,
    publicationStatus: "published",
    visibilityStatus: "public",
    publicReportUrl: `/ai-grader/reports/${reportId}`,
    reportBundleStorageKey: storageKey,
    checksumSummary: { assets: [manifestEntry] },
    gradeStory: bundle.provisionalGrade?.gradeStory ?? {},
    publishedAt: new Date("2026-07-21T18:00:00.000Z"),
    publication: {
      status: "published",
      reportBundleStorageKey: storageKey,
      assetManifest: [manifestEntry],
      publishedAt: new Date("2026-07-21T18:00:00.000Z"),
      revokedAt: null,
    },
  };
  const events = new Map<string, any>();
  const tx: any = {
    async $queryRaw() { return [{ lockAcquired: 1 }]; },
    aiGraderReport: {
      async findUnique() { return row; },
      async update(args: any) {
        Object.assign(row, args.data);
        return row;
      },
    },
    auditEvent: {
      async create(args: any) {
        events.set(args.data.id, { ...args.data });
        return args.data;
      },
      async findFirst() {
        return events.size ? { id: events.keys().next().value } : null;
      },
      async findUnique(args: any) {
        return events.get(args.where.id) ?? null;
      },
    },
  };
  const db: any = {
    aiGraderReport: { async findUnique() { return row; } },
    async $transaction(callback: (value: any) => Promise<unknown>) {
      return callback(tx);
    },
  };
  return {
    reportId,
    row,
    events,
    service: createAiGraderReportEditorService({
      db,
      async readBundleBytes(key) {
        assert.equal(key, storageKey);
        return bytes;
      },
      publicUrlFor: (key) => `/storage/${key}`,
    }),
  };
}

test("a published machine hard failure can be explicitly completed by one admin adjudication", async () => {
  const harness = editorHarness();
  const initial = await harness.service.getState({ reportId: harness.reportId });
  assert.equal(initial.completionStatus, "machine_failed");
  assert.equal(initial.baseScores.corners, undefined);
  assert.equal(initial.machineFailure.failed, true);
  assert.ok(initial.machineFailure.codes.includes("MACHINE_SUBGRADES_INCOMPLETE"));

  const completed = await harness.service.save({
    reportId: harness.reportId,
    expectedRevisionToken: initial.revisionToken,
    expectedSourceBundleSha256: initial.sourceBundleSha256,
    scores: { centering: 9.5, corners: 8, edges: 9, surface: 8.5 },
    content: { cornersExplanation: "Admin confirmed corner wear from the evidence." },
    reason: "Complete the report by authenticated human review after machine failure.",
    actorUserId: "admin-exact",
  });

  assert.equal(completed.completionStatus, "human_reviewed_complete");
  assert.equal(completed.editorialRevision?.revisionKind, "operator_adjudication_v1");
  assert.equal(completed.editorialRevision?.effectiveReportStatus, "completed_human_reviewed");
  assert.equal(completed.editorialRevision?.sourceBundleSha256, initial.sourceBundleSha256);
  assert.ok(completed.editorialRevision?.adjudicatedMachineFailures.includes("MACHINE_SUBGRADES_INCOMPLETE"));
  assert.equal(harness.events.size, 1);
  assert.equal(harness.row.finalOverallGrade, undefined);
  assert.equal(harness.row.elementScores, undefined);
  assert.equal(harness.row.gradeStory.manualReportRevision.calculation.overall, completed.editorialRevision?.calculation.overall);
});

test("stale saves fail closed and a corrupt active revision never falls back to the machine report", async () => {
  const harness = editorHarness();
  const initial = await harness.service.getState({ reportId: harness.reportId });
  await assert.rejects(
    harness.service.save({
      reportId: harness.reportId,
      expectedRevisionToken: "f".repeat(64),
      expectedSourceBundleSha256: initial.sourceBundleSha256,
      scores: { centering: 9, corners: 9, edges: 9, surface: 9 },
      reason: "Stale test.",
      actorUserId: "admin-exact",
    }),
    (error: any) => error?.code === "AI_GRADER_REPORT_EDITOR_STALE_REVISION",
  );

  harness.row.gradeStory = {
    ...harness.row.gradeStory,
    manualReportRevision: { schemaVersion: "tampered" },
  };
  await assert.rejects(
    harness.service.getState({ reportId: harness.reportId }),
    (error: any) => error?.code === "AI_GRADER_REPORT_EDITOR_REVISION_INVALID",
  );
});

test("an immutable failed V1 shell is adjudicable, but a corrupt source claiming success is not", async () => {
  const failed = editorHarness({
    schemaVersion: "ai-grader-report-bundle-v0.3",
    generatedAt: "2026-07-21T18:00:00.000Z",
    finalGradeComputed: false,
    finalStatus: "insufficient_evidence",
    reportStatus: "insufficient_evidence",
    certifiedClaim: false,
    cardIdentity: { title: "Failed V1 evidence" },
    provisionalGrade: {
      status: "insufficient_evidence",
      gates: {
        requiredGatesPassed: false,
        blockers: ["calibration bundle missing"],
      },
    },
  });
  const failedState = await failed.service.getState({ reportId: failed.reportId });
  assert.equal(failedState.completionStatus, "machine_failed");
  assert.ok(failedState.machineFailure.codes.includes("MACHINE_FINAL_GRADE_NOT_COMPUTED"));

  const corruptSuccess = editorHarness({
    schemaVersion: "ai-grader-report-bundle-v0.3",
    generatedAt: "2026-07-21T18:00:00.000Z",
    finalGradeComputed: true,
    finalStatus: "final_grade_computed",
    reportStatus: "final_ai_grader_report_v1",
    certifiedClaim: false,
    cardIdentity: { title: "Corrupt success" },
    productionRelease: {
      finalGradeComputed: true,
      finalGrade: { status: "mathematical_calibration_v1_final", overall: 9 },
    },
  });
  await assert.rejects(
    corruptSuccess.service.getState({ reportId: corruptSuccess.reportId }),
    (error: any) => error?.code === "AI_GRADER_REPORT_EDITOR_SOURCE_INVALID",
  );
});
