import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { HttpError } from "../lib/server/adminSessionAuthority";
import { SpeedsterMapIntegrityError } from "../lib/server/speedsterCardTypeMaps";
import type { SpeedsterMapAuthorityEvent } from "../lib/ai-grader-v2/map-authority";
import { createSpeedsterMapAuthorityHandler } from "../pages/api/admin/ai-grader-v2/sessions/[sessionId]/map-authority";

const SESSION_ID = "speedster-map-authority-0001";
const REVISION_ID = "speedster-map-revision-0001";
const REVISION_HASH = "a".repeat(64);
const identity = {
  playerName: "Nick Bosa",
  year: "2021",
  manufacturer: "Panini",
  productSet: "Obsidian",
  parallel: "Orange",
  insert: null,
  cardNumber: "12",
} as const;
type DraftRecord = Readonly<{
  id: string;
  createdByUserId: string;
  cardProfile: string;
  workflowState: string;
  identity: unknown;
  capture: unknown;
  updatedAt: Date;
}>;

function draft(capture: unknown = {}): DraftRecord {
  return {
    id: SESSION_ID,
    createdByUserId: "admin-1",
    cardProfile: "SPORTS",
    workflowState: "DRAFT",
    identity,
    capture,
    updatedAt: new Date("2026-08-18T11:30:00.000Z"),
  };
}

function selectedMap() {
  return {
    appliedScope: "EXACT" as const,
    appliedMapName: "2021 · Panini · Obsidian · Orange · Nick Bosa · #12",
    sourceProvenance: { sourceSessionId: "map-source-session-0001", sourceIdentity: identity },
    revision: {
      mapId: "map-1",
      revisionId: REVISION_ID,
      version: 7,
      revisionHash: REVISION_HASH,
      displayIdentity: identity,
      mapSchemaVersion: "speedster-card-type-map-v1",
      filterPolicyVersion: "speedster-map-filter-v1",
      createdAt: new Date("2026-08-18T10:00:00.000Z"),
    },
  } as never;
}

function request(body: unknown): NextApiRequest {
  return {
    method: "POST",
    query: { sessionId: SESSION_ID },
    body,
    headers: {},
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; allow?: string } = {};
  const res = {
    setHeader(name: string, value: string) { if (name === "Allow") state.allow = value; return this; },
    status(status: number) { state.status = status; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function dependencies(input: Readonly<{
  load?: () => Promise<ReturnType<typeof selectedMap> | null>;
  auth?: () => Promise<{ user: { id: string } }>;
  capture?: unknown;
}> = {}) {
  const persisted: SpeedsterMapAuthorityEvent[] = [];
  return {
    persisted,
    deps: {
      requireAdminSession: input.auth ?? (async () => ({ user: { id: "admin-1" } })),
      async findSession() { return draft(input.capture); },
      loadEffectiveMap: input.load ?? (async () => selectedMap()),
      async persistEvidence(session: DraftRecord, adminId: string, event: SpeedsterMapAuthorityEvent) {
        assert.equal(adminId, "admin-1");
        persisted.push(event);
        return { ...session, capture: { mapAuthority: { current: event, history: [event] } } };
      },
      now: () => new Date("2026-08-18T12:00:00.000Z"),
      randomId: () => `attempt-${persisted.length + 1}`,
    },
  };
}

test("Card Map authority rejects unauthenticated resolution before lookup or persistence", async () => {
  let lookedUp = false;
  const harness = dependencies({
    auth: async () => { throw new HttpError(401, "Missing or invalid Authorization header"); },
    load: async () => { lookedUp = true; return selectedMap(); },
  });
  const result = response();
  await createSpeedsterMapAuthorityHandler(harness.deps)(request({ action: "RESOLVE_LOOKUP" }), result.res);
  assert.equal(result.state.status, 401);
  assert.equal(lookedUp, false);
  assert.equal(harness.persisted.length, 0);
});

test("transport and hash failures become distinct durable blockers", async () => {
  for (const candidate of [
    {
      error: new Error("database transport unavailable"),
      status: 503,
      authority: "LOOKUP_FAILED",
      code: "CARD_MAP_LOOKUP_TRANSPORT_FAILED",
    },
    {
      error: new SpeedsterMapIntegrityError("Card Map revision hash verification failed."),
      status: 409,
      authority: "INTEGRITY_ERROR",
      code: "CARD_MAP_INTEGRITY_FAILURE",
    },
  ] as const) {
    const harness = dependencies({ load: async () => { throw candidate.error; } });
    const result = response();
    await createSpeedsterMapAuthorityHandler(harness.deps)(request({ action: "RESOLVE_LOOKUP" }), result.res);
    assert.equal(result.state.status, candidate.status);
    assert.equal(harness.persisted.length, 1);
    assert.equal(harness.persisted[0].status, candidate.authority);
    assert.equal(harness.persisted[0].failureCode, candidate.code);
    assert.equal(harness.persisted[0].revision, null);
  }
});

test("retry resolves and returns the exact immutable revision selected by the server", async () => {
  const harness = dependencies();
  const result = response();
  await createSpeedsterMapAuthorityHandler(harness.deps)(request({ action: "RESOLVE_LOOKUP" }), result.res);
  assert.equal(result.state.status, 200);
  assert.equal(harness.persisted[0].status, "LOADED");
  assert.equal(harness.persisted[0].revision?.revisionId, REVISION_ID);
  assert.equal(harness.persisted[0].revision?.revisionHash, REVISION_HASH);
  const body = result.state.body as { map: { revision: { revisionId: string; revisionHash: string } } };
  assert.equal(body.map.revision.revisionId, REVISION_ID);
  assert.equal(body.map.revision.revisionHash, REVISION_HASH);
});

test("registration blockers require the exact resolved revision and persist side failures", async () => {
  const mismatch = dependencies();
  const mismatchResult = response();
  await createSpeedsterMapAuthorityHandler(mismatch.deps)(request({
    action: "BLOCK_REGISTRATION",
    mapRevisionId: "stale-revision",
    mapRevisionHash: REVISION_HASH,
    mapScope: "EXACT",
    operationId: "operation-1",
    failures: [{ side: "BACK", source: "PROVIDER_GATEWAY", code: "PROVIDER_GATEWAY_HTTP_502", httpStatus: 502 }],
  }), mismatchResult.res);
  assert.equal(mismatchResult.state.status, 409);
  assert.equal(mismatch.persisted[0].status, "INTEGRITY_ERROR");
  assert.equal(mismatch.persisted[0].failureCode, "CARD_MAP_REGISTRATION_REVISION_MISMATCH");

  const exact = dependencies();
  const exactResult = response();
  await createSpeedsterMapAuthorityHandler(exact.deps)(request({
    action: "BLOCK_REGISTRATION",
    mapRevisionId: REVISION_ID,
    mapRevisionHash: REVISION_HASH,
    mapScope: "EXACT",
    operationId: "operation-2",
    failures: [{ side: "BACK", source: "PROVIDER_GATEWAY", code: "PROVIDER_GATEWAY_HTTP_502", httpStatus: 502, requestId: "request-2" }],
  }), exactResult.res);
  assert.equal(exactResult.state.status, 200);
  assert.equal(exact.persisted[0].status, "REGISTRATION_BLOCKED");
  assert.equal(exact.persisted[0].revision?.revisionId, REVISION_ID);
  assert.deepEqual(exact.persisted[0].registrationFailures, [{
    side: "BACK",
    source: "PROVIDER_GATEWAY",
    code: "PROVIDER_GATEWAY_HTTP_502",
    httpStatus: 502,
    requestId: "request-2",
  }]);
});

test("reload preserves an unresolved registration blocker for the same exact revision", async () => {
  const blocked: SpeedsterMapAuthorityEvent = {
    attemptId: "attempt-blocked",
    recordedAt: "2026-08-18T11:00:00.000Z",
    status: "REGISTRATION_BLOCKED",
    failureCode: "CARD_MAP_REGISTRATION_BLOCKED",
    message: "Registration is blocked.",
    revision: {
      revisionId: REVISION_ID,
      revisionHash: REVISION_HASH,
      version: 7,
      scope: "EXACT",
      name: "Nick Bosa",
    },
    registrationOperationId: "operation-blocked",
    registrationFailures: [{
      side: "BACK",
      source: "PROVIDER_GATEWAY",
      code: "PROVIDER_GATEWAY_HTTP_502",
      httpStatus: 502,
    }],
  };
  const harness = dependencies({
    capture: {
      mapAuthority: {
        version: "speedster-map-authority-evidence-v1",
        current: blocked,
        history: [blocked],
      },
    },
  });
  const result = response();
  await createSpeedsterMapAuthorityHandler(harness.deps)(request({ action: "RESOLVE_LOOKUP" }), result.res);
  assert.equal(result.state.status, 200);
  assert.equal(harness.persisted.length, 0, "reload must not overwrite the unresolved registration blocker");
  assert.equal((result.state.body as { authority: SpeedsterMapAuthorityEvent }).authority.status, "REGISTRATION_BLOCKED");
});

test("Production persistence compare-and-swaps the exact draft revision before replacing capture JSON", () => {
  const route = readFileSync(
    fileURLToPath(new URL("../pages/api/admin/ai-grader-v2/sessions/[sessionId]/map-authority.ts", import.meta.url)),
    "utf8",
  );
  assert.match(route, /updatedAt:\s*session\.updatedAt/);
  assert.match(route, /if \(updated\.count !== 1\) return null/);
});

test("AI Grader UI keeps reload lookup failures blocked and exposes only Retry", () => {
  const page = readFileSync(fileURLToPath(new URL("../pages/admin/ai-grader-v2.tsx", import.meta.url)), "utf8");
  const capture = readFileSync(fileURLToPath(new URL("../components/ai-grader-v2/CaptureWorkspace.tsx", import.meta.url)), "utf8");
  assert.match(page, /!mapAuthorityBlock && !committedCaptureRecovery/);
  assert.match(page, /RETRY CARD MAP AUTHORITY/);
  assert.match(page, /No photos, geometry, or mapless capture can begin while this blocker is active/);
  assert.doesNotMatch(capture, /Continue without Card Map/);
  assert.doesNotMatch(capture, /resumeGeometryWithoutObsoleteMap/);
});
